/**
 * bomImportService.js — BOM Excel 匯入正規化表(B-1 · EE BOM)
 *
 * 對應 docs/cortex-bom-import-plan.md §3(013b 映射)+ §5 B-1。
 *
 * 匯入 Rival3 Gen2 BOM Excel 的 `EE bom 0227` sheet → bom_instance/section/category/item
 * + bom_item_price_snapshot/tier(單價=Excel S 欄)+ bom_item_mfg(替代供應商)。
 *
 * EE BOM 結構(B-0/B-1 逆向 · 0-based 欄):
 *   idx1=B item# · idx4=E qty(選中料 qty>0)· idx5=F FLK P/N · idx6=G 類別 · idx7=H SMD/DIP/ASSEMBLY
 *   idx8=I desc · idx9=J ref · idx10=K vendor · idx11=L part# · idx18=S U/P(USD)
 *   - 有 S(數字)= 成本料列(候選料;選中 qty>0、替代 qty=0)→ bom_item + price
 *   - 無 S、只有 K/L = 替代供應商 → bom_item_mfg(掛前一 item)
 *   - 類別取 G 欄(每列都帶),process_type 取 H
 *
 * rollup = Σ(bom_item.qty × applied_price)= 6.0168 ≈ Unit Cost EE_black 6.017395(ε<0.01)。
 *
 * ⚠️ B-1 範圍:僅 EE BOM · 單一廠/Option · S 欄單價。ME/PKG/三廠/Option/多版本 = B-4。
 * ⚠️ 生產上傳路徑(route + 檔案上傳)= 後續;本 service 收 filePath(fixture/驗證用)。
 */

const XLSX = require('xlsx');
const { makeLogger } = require('./logger');
const log = makeLogger('bomImportService');

const num = (v) => (typeof v === 'number' ? v : (v == null || v === '' ? 0 : Number(v) || 0));
const str = (v) => (v == null ? null : String(v).trim() || null);
const pick = (row, name) => { if (!row) return undefined; const lc = name.toLowerCase(); for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k]; return undefined; };

/**
 * 匯入 EE BOM。idempotent:同 (project_id, version_no, variant_key) 先刪舊 instance(CASCADE)。
 * @returns { bomInstanceId, sectionId, itemCount, mfgCount, categoryCount }
 */
async function importEeBom(db, opts = {}) {
  const { filePath, projectId, factoryCode = 'CN', variantKey = null, versionNo = 1, sheetName = 'EE bom 0227' } = opts;
  if (!filePath) throw new Error('bomImportService: filePath required');
  if (!projectId) throw new Error('bomImportService: projectId required');

  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const get = (sql, ...a) => db.prepare(sql).get(...a);

  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`bomImportService: sheet '${sheetName}' not found`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  // idempotent:刪舊 instance(CASCADE 清 section/category/item/mfg/snapshot/tier)
  const old = await get(
    `SELECT id FROM bom_instance WHERE project_id=? AND version_no=? AND ${variantKey == null ? 'variant_key IS NULL' : 'variant_key=?'}`,
    ...(variantKey == null ? [projectId, versionNo] : [projectId, versionNo, variantKey]),
  );
  if (old) await run(`DELETE FROM bom_instance WHERE id=?`, Number(pick(old, 'id')));

  // 1. bom_instance
  const inst = await run(
    `INSERT INTO bom_instance (project_id, version_no, variant_scope, variant_key, state, default_org_id, price_period_months, price_strategy)
     VALUES (?, ?, ?, ?, 'DRAFT', NULL, 12, 'AVG')`,
    projectId, versionNo, variantKey ? 'per_variant' : 'shared', variantKey,
  );
  const bomInstanceId = Number(inst.lastInsertRowid);

  // 2. bom_section(EE)
  const sec = await run(
    `INSERT INTO bom_section (bom_instance_id, module_code, module_category, display_order, name)
     VALUES (?, 'EE', 'EE', 10, 'EE BOM')`,
    bomInstanceId,
  );
  const sectionId = Number(sec.lastInsertRowid);

  // 3. 逐列:成本料列 → item + price;替代供應商列 → mfg
  const catCache = {};   // 類別名 → bom_category id
  let curItemId = null, itemCount = 0, mfgCount = 0, seq = 0;

  const ensureCategory = async (name, procType) => {
    const key = name || 'Uncategorized';
    if (catCache[key]) return catCache[key];
    const c = await run(
      `INSERT INTO bom_category (bom_section_id, display_order, name, process_type) VALUES (?, ?, ?, ?)`,
      sectionId, Object.keys(catCache).length * 10 + 10, key, procType || null,
    );
    catCache[key] = Number(c.lastInsertRowid);
    return catCache[key];
  };

  for (let r = 3; r < rows.length; r++) {   // r3(idx3)起(header 在 idx2/r3 顯示,資料 idx3+)
    const row = rows[r];
    if (!row) continue;
    const B = row[1], qE = row[4], G = str(row[6]), H = str(row[7]), I = str(row[8]), J = str(row[9]), K = str(row[10]), L = str(row[11]), F = str(row[5]), S = row[18];

    if (typeof S === 'number') {
      // 成本料列 → bom_item
      const catId = await ensureCategory(G, H);
      seq += 1;
      const it = await run(
        `INSERT INTO bom_item (bom_category_id, item_sequence, qty, description, reference, customer_item, fpn, variant_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        catId, (typeof B === 'number' ? B : seq), num(qE), I, J, F, F, variantKey,
      );
      curItemId = Number(it.lastInsertRowid);
      itemCount += 1;

      // price snapshot + 單一 tier(true=quote=S · fx=1 · Excel 來源)
      const snap = await run(
        `INSERT INTO bom_item_price_snapshot (bom_item_id, period_months, strategy_used, price_avg_usd, applied_price_usd, po_line_count, vendor_count)
         VALUES (?, 0, 'EXCEL', ?, ?, 0, 0)`,
        curItemId, num(S), num(S),
      );
      const snapId = Number(snap.lastInsertRowid);
      await run(
        `INSERT INTO bom_item_price_tier (snapshot_id, tier_seq, source_currency, true_cost_source, fx_rate, quote_price_usd, is_chosen)
         VALUES (?, 1, 'USD', ?, 1, ?, 1)`,
        snapId, num(S), num(S),
      );

      // 主供應商當 preferred mfg
      if (K || L) {
        await run(
          `INSERT INTO bom_item_mfg (bom_item_id, display_order, manufacturer_name, mfg_part_number, source, is_preferred) VALUES (?, 10, ?, ?, 'EXCEL', 1)`,
          curItemId, K, L,
        );
        mfgCount += 1;
      }
    } else if ((K || L) && curItemId) {
      // 替代供應商列 → mfg(掛前一 item)
      await run(
        `INSERT INTO bom_item_mfg (bom_item_id, display_order, manufacturer_name, mfg_part_number, source, is_preferred) VALUES (?, ?, ?, ?, 'EXCEL', 0)`,
        curItemId, mfgCount * 10 + 20, K, L,
      );
      mfgCount += 1;
    }
    // 其餘(header/空列 · 類別已由 G 欄取)→ 略過
  }

  log.log(`importEeBom: instance=${bomInstanceId} items=${itemCount} mfg=${mfgCount} categories=${Object.keys(catCache).length}`);
  return { bomInstanceId, sectionId, itemCount, mfgCount, categoryCount: Object.keys(catCache).length };
}

/**
 * material rollup:Σ(bom_item.qty × snapshot.applied_price)· 一個 bom_instance。
 * @returns { materialUsd, itemCount }
 */
async function rollupMaterial(db, bomInstanceId) {
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const row = await get(
    `SELECT NVL(SUM(i.qty * s.applied_price_usd),0) AS mat, COUNT(*) AS n
       FROM bom_item i
       JOIN bom_category c   ON c.id = i.bom_category_id
       JOIN bom_section  sec ON sec.id = c.bom_section_id
       JOIN bom_item_price_snapshot s ON s.bom_item_id = i.id
      WHERE sec.bom_instance_id = ?`,
    bomInstanceId,
  );
  return { materialUsd: num(pick(row, 'mat')), itemCount: num(pick(row, 'n')) };
}

module.exports = { importEeBom, rollupMaterial };
