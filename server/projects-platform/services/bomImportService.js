/**
 * bomImportService.js — BOM Excel 匯入正規化表(B-1 EE / B-2b ME+PKG · config-driven)
 *
 * 對應 docs/cortex-bom-import-plan.md §3(013b 映射)+ §5 B-1/B-2b。
 *
 * 三張 sheet 佈局各異 → SHEET_CONFIGS 每 sheet 一組 colMap(0-based 欄)。
 * importBom 建一個 bom_instance,把 EE/ME/PKG 各匯成一個 section(→ rollup 自動含全材料)。
 *
 *   EE  (EE bom 0227)          : 有 S(U/P)=item;無價 K/L=替代供應商 → mfg;類別=G 欄
 *   ME  (ME bom 0618_Black)    : 有 U(U/P)=item;類別=B 欄(1.Plastic…);V=sub-total;r29 Total(text 略過)
 *   PKG (PKG BOM 20241023_Amber): 有 L(U/P)=item;K=qty;M=amount;固定類別 Packaging
 *
 * 對帳(Unit Cost China · Black):EE 6.0174 + ME 1.6713 + PKG 0.8281 = Material Cost 8.5168。
 *
 * ⚠️ 版本/廠別:B-2b 鎖 Black + China(EE 0227 / ME 0618_Black / PKG 20241023_Amber)。
 *    White 變體、其他廠/Option/PKG 版本選擇 = B-4。
 * ⚠️ 生產上傳路徑(route + 上傳)= 後續;本 service 收 filePath(fixture/驗證用)。
 */

const XLSX = require('xlsx');
const { makeLogger } = require('./logger');
const log = makeLogger('bomImportService');

const num = (v) => (typeof v === 'number' ? v : (v == null || v === '' ? 0 : Number(v) || 0));
const isNum = (v) => typeof v === 'number';
const str = (v) => (v == null ? null : String(v).trim() || null);
const pick = (row, name) => { if (!row) return undefined; const lc = name.toLowerCase(); for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k]; return undefined; };

// 每 sheet 一組欄位映射(0-based)· startRow 為 0-based 資料首列
const SHEET_CONFIGS = {
  EE: {
    sheet: 'EE bom 0227', moduleCategory: 'EE', sectionName: 'EE BOM', startRow: 4, hasAltVendor: true,
    col: { itemNo: 1, qty: 4, price: 18, desc: 8, fpn: 5, ref: 9, category: 6, procType: 7, vendor: 10, partNo: 11 },
  },
  ME: {
    sheet: 'ME bom 0618_Black', moduleCategory: 'ME', sectionName: 'ME BOM (Black)', startRow: 7, hasAltVendor: false,
    col: { itemNo: 0, qty: 8, price: 20, desc: 5, fpn: 6, category: 1, vendor: 15 },
  },
  PKG: {
    sheet: 'PKG BOM 20241023_Amber', moduleCategory: 'PKG', sectionName: 'Packaging BOM', startRow: 4, hasAltVendor: false,
    fixedCategory: 'Packaging', col: { itemNo: 0, qty: 10, price: 11, desc: 8, fpn: 2 },
  },
};

/**
 * importBom — 建一個 bom_instance,把指定 sheet 各匯成一 section。
 * idempotent:同 (project_id, version_no, variant_key) 先刪舊 instance(CASCADE)。
 * @returns { bomInstanceId, itemCount, mfgCount, sections: [{category, itemCount}] }
 */
async function importBom(db, opts = {}) {
  const { filePath, projectId, variantKey = null, versionNo = 1, sheetKeys = ['EE', 'ME', 'PKG'] } = opts;
  if (!filePath) throw new Error('bomImportService: filePath required');
  if (!projectId) throw new Error('bomImportService: projectId required');

  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const wb = XLSX.readFile(filePath);

  // idempotent:刪舊 instance(CASCADE 清所有子表)
  const old = await get(
    `SELECT id FROM bom_instance WHERE project_id=? AND version_no=? AND ${variantKey == null ? 'variant_key IS NULL' : 'variant_key=?'}`,
    ...(variantKey == null ? [projectId, versionNo] : [projectId, versionNo, variantKey]),
  );
  if (old) await run(`DELETE FROM bom_instance WHERE id=?`, Number(pick(old, 'id')));

  // bom_instance
  const inst = await run(
    `INSERT INTO bom_instance (project_id, version_no, variant_scope, variant_key, state, price_period_months, price_strategy)
     VALUES (?, ?, ?, ?, 'DRAFT', 12, 'AVG')`,
    projectId, versionNo, variantKey ? 'per_variant' : 'shared', variantKey,
  );
  const bomInstanceId = Number(inst.lastInsertRowid);

  let itemCount = 0, mfgCount = 0, categoryCount = 0;
  const sections = [];

  for (let si = 0; si < sheetKeys.length; si++) {
    const cfg = SHEET_CONFIGS[sheetKeys[si]];
    if (!cfg) { log.warn(`importBom: unknown sheetKey ${sheetKeys[si]}`); continue; }
    const ws = wb.Sheets[cfg.sheet];
    if (!ws) { log.warn(`importBom: sheet '${cfg.sheet}' not found`); continue; }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

    // section
    const sec = await run(
      `INSERT INTO bom_section (bom_instance_id, module_code, module_category, display_order, name)
       VALUES (?, ?, ?, ?, ?)`,
      bomInstanceId, cfg.moduleCategory, cfg.moduleCategory, si * 10 + 10, cfg.sectionName,
    );
    const sectionId = Number(sec.lastInsertRowid);

    const catCache = {};
    let curItemId = null, seq = 0, secItems = 0;
    const ensureCategory = async (name, procType) => {
      const key = name || cfg.fixedCategory || cfg.moduleCategory;
      if (catCache[key]) return catCache[key];
      const c = await run(
        `INSERT INTO bom_category (bom_section_id, display_order, name, process_type) VALUES (?, ?, ?, ?)`,
        sectionId, Object.keys(catCache).length * 10 + 10, key, procType || null,
      );
      catCache[key] = Number(c.lastInsertRowid);
      return catCache[key];
    };

    for (let r = cfg.startRow; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const cq = cfg.col.qty, cp = cfg.col.price;
      const price = row[cp], qty = row[cq];
      const K = str(cfg.col.vendor != null ? row[cfg.col.vendor] : null);
      const L = str(cfg.col.partNo != null ? row[cfg.col.partNo] : null);

      if (isNum(price) && isNum(qty)) {
        // 成本料列 → bom_item
        const catName = cfg.fixedCategory || str(row[cfg.col.category]) || cfg.moduleCategory;
        const procType = cfg.col.procType != null ? str(row[cfg.col.procType]) : null;
        const catId = await ensureCategory(catName, procType);
        const B = cfg.col.itemNo != null ? row[cfg.col.itemNo] : null;
        const desc = str(row[cfg.col.desc]);
        const fpn = cfg.col.fpn != null ? str(row[cfg.col.fpn]) : null;
        const ref = cfg.col.ref != null ? str(row[cfg.col.ref]) : null;
        seq += 1;
        const it = await run(
          `INSERT INTO bom_item (bom_category_id, item_sequence, qty, description, reference, customer_item, fpn, variant_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          catId, seq, num(qty), desc, ref, fpn, fpn, variantKey,
        );
        curItemId = Number(it.lastInsertRowid);
        itemCount += 1; secItems += 1;

        const snap = await run(
          `INSERT INTO bom_item_price_snapshot (bom_item_id, period_months, strategy_used, price_avg_usd, applied_price_usd, po_line_count, vendor_count)
           VALUES (?, 0, 'EXCEL', ?, ?, 0, 0)`,
          curItemId, num(price), num(price),
        );
        const snapId = Number(snap.lastInsertRowid);
        await run(
          `INSERT INTO bom_item_price_tier (snapshot_id, tier_seq, source_currency, true_cost_source, fx_rate, quote_price_usd, is_chosen)
           VALUES (?, 1, 'USD', ?, 1, ?, 1)`,
          snapId, num(price), num(price),
        );
        if (K || L) {
          await run(
            `INSERT INTO bom_item_mfg (bom_item_id, display_order, manufacturer_name, mfg_part_number, source, is_preferred) VALUES (?, 10, ?, ?, 'EXCEL', 1)`,
            curItemId, K, L,
          );
          mfgCount += 1;
        }
      } else if (cfg.hasAltVendor && !isNum(price) && (K || L) && curItemId) {
        await run(
          `INSERT INTO bom_item_mfg (bom_item_id, display_order, manufacturer_name, mfg_part_number, source, is_preferred) VALUES (?, ?, ?, ?, 'EXCEL', 0)`,
          curItemId, mfgCount * 10 + 20, K, L,
        );
        mfgCount += 1;
      }
    }
    categoryCount += Object.keys(catCache).length;
    sections.push({ category: cfg.moduleCategory, itemCount: secItems });
  }

  log.log(`importBom: instance=${bomInstanceId} items=${itemCount} mfg=${mfgCount} sections=${sections.map((s) => `${s.category}:${s.itemCount}`).join(',')}`);
  return { bomInstanceId, itemCount, mfgCount, categoryCount, sections };
}

/** EE-only 匯入(向下相容 B-1 test)*/
async function importEeBom(db, opts = {}) {
  const r = await importBom(db, { ...opts, sheetKeys: ['EE'] });
  return { bomInstanceId: r.bomInstanceId, sectionId: null, itemCount: r.itemCount, mfgCount: r.mfgCount, categoryCount: r.categoryCount };
}

// rollupMaterial 已移至獨立 service(引擎解耦)· 此處 re-export 維持 API 相容
const { rollupMaterial } = require('./bomMaterialRollup');

module.exports = { importBom, importEeBom, rollupMaterial, SHEET_CONFIGS };
