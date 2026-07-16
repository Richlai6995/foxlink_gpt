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

// ── 標準範本匯入(使用者下載 bomTemplateService 範本填好上傳 · header-based)──────
const TPL_MODULES = ['EE', 'ME', 'PKG'];
// header 名(小寫 contains)→ 欄位
function resolveTplHeader(rawHeaders) {
  const map = {};
  rawHeaders.forEach((h, i) => {
    const s = String(h == null ? '' : h).trim().toLowerCase();
    if (!s) return;
    if (s === 'category' || s.includes('類別')) map.category = i;
    else if (s.includes('item no') || s.includes('item#') || s === 'item') map.itemNo = i;
    else if (s.includes('description') || s.includes('描述')) map.desc = i;
    else if (s.includes('foxlink') || s.includes('flk p/n') || s.includes('foxlink p/n')) map.fpn = i;
    else if (s === 'qty' || s.includes('數量') || s.includes("qt'y")) map.qty = i;
    else if (s.includes('unit price') || s.includes('u/p') || s.includes('單價')) map.price = i;
    else if (s.includes('mfg p/n') || s.includes('mfg part') || s.includes('廠商料號')) map.mfgPn = i;
    else if (s === 'vendor' || s.includes('供應商') || s.includes('廠商')) map.vendor = i;
    else if (s.includes('remark') || s.includes('備註')) map.remark = i;
  });
  return map;
}

/**
 * importBomTemplate — 解析標準範本(EE/ME/PKG 三分頁 · header-based)→ 正規化。
 * idempotent 同 importBom。回 { bomInstanceId, itemCount, mfgCount, categoryCount, sections }。
 */
async function importBomTemplate(db, opts = {}) {
  const { filePath, projectId, variantKey = null, versionNo = 1 } = opts;
  if (!filePath) throw new Error('bomImportService: filePath required');
  if (!projectId) throw new Error('bomImportService: projectId required');

  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const wb = XLSX.readFile(filePath);

  const old = await get(
    `SELECT id FROM bom_instance WHERE project_id=? AND version_no=? AND ${variantKey == null ? 'variant_key IS NULL' : 'variant_key=?'}`,
    ...(variantKey == null ? [projectId, versionNo] : [projectId, versionNo, variantKey]),
  );
  if (old) await run(`DELETE FROM bom_instance WHERE id=?`, Number(pick(old, 'id')));

  const inst = await run(
    `INSERT INTO bom_instance (project_id, version_no, variant_scope, variant_key, state, price_period_months, price_strategy)
     VALUES (?, ?, ?, ?, 'DRAFT', 12, 'AVG')`,
    projectId, versionNo, variantKey ? 'per_variant' : 'shared', variantKey,
  );
  const bomInstanceId = Number(inst.lastInsertRowid);

  let itemCount = 0, mfgCount = 0, categoryCount = 0, pricedCount = 0, pendingCount = 0;
  const sections = [];

  for (let si = 0; si < TPL_MODULES.length; si++) {
    const mod = TPL_MODULES[si];
    const ws = wb.Sheets[mod];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (!rows.length) continue;
    const H = resolveTplHeader(rows[0] || []);
    if (H.qty == null) { log.warn(`importBomTemplate: sheet ${mod} 缺 Qty 標題,跳過`); continue; }  // price 可空(B-5a 兩階段)

    const sec = await run(
      `INSERT INTO bom_section (bom_instance_id, module_code, module_category, display_order, name) VALUES (?, ?, ?, ?, ?)`,
      bomInstanceId, mod, mod, si * 10 + 10, `${mod} BOM`,
    );
    const sectionId = Number(sec.lastInsertRowid);
    const catCache = {};
    let seq = 0, secItems = 0;
    const ensureCategory = async (name) => {
      const key = name || mod;
      if (catCache[key]) return catCache[key];
      const c = await run(`INSERT INTO bom_category (bom_section_id, display_order, name, process_type) VALUES (?, ?, ?, NULL)`,
        sectionId, Object.keys(catCache).length * 10 + 10, key);
      catCache[key] = Number(c.lastInsertRowid);
      return catCache[key];
    };

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const qty = row[H.qty];
      if (!isNum(qty)) continue;                       // qty 必填;price 可空(B-5a 兩階段:RD 先無價)
      const price = H.price != null ? row[H.price] : null;
      const hasPrice = isNum(price);
      const catId = await ensureCategory(H.category != null ? str(row[H.category]) : null);
      const desc = H.desc != null ? str(row[H.desc]) : null;
      const fpn = H.fpn != null ? str(row[H.fpn]) : null;
      const remark = H.remark != null ? str(row[H.remark]) : null;
      const vendor = H.vendor != null ? str(row[H.vendor]) : null;
      const mfgPn = H.mfgPn != null ? str(row[H.mfgPn]) : null;
      seq += 1;
      const it = await run(
        `INSERT INTO bom_item (bom_category_id, item_sequence, qty, description, reference, customer_item, fpn, variant_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        catId, seq, num(qty), desc, remark, fpn, fpn, variantKey,
      );
      const itemId = Number(it.lastInsertRowid);
      itemCount += 1; secItems += 1;

      // RD 填了 Foxlink P/N → 建 flk 候選(RD_MANUAL)+ 設 final;mfg 掛此 flk 下(對齊 SD §2.2.5/2.2.6)
      let flkId = null;
      if (fpn) {
        const flk = await run(
          `INSERT INTO bom_item_flk (bom_item_id, display_order, flk_part_number, source) VALUES (?, 100, ?, 'RD_MANUAL')`,
          itemId, fpn,
        );
        flkId = Number(flk.lastInsertRowid);
        await run(`UPDATE bom_item SET final_flk_id=? WHERE id=?`, flkId, itemId);
      }
      if (vendor || mfgPn) {
        await run(
          `INSERT INTO bom_item_mfg (bom_item_id, bom_item_flk_id, display_order, manufacturer_name, mfg_part_number, source, is_preferred) VALUES (?, ?, 10, ?, ?, 'TEMPLATE', 1)`,
          itemId, flkId, vendor, mfgPn,
        );
        mfgCount += 1;
      }

      // 兩階段價:有價 → TEMPLATE snapshot + tier(is_chosen);無價 → PENDING snapshot(待採購詢價 · 無 tier)
      if (hasPrice) {
        const snap = await run(
          `INSERT INTO bom_item_price_snapshot (bom_item_id, bom_item_flk_id, period_months, strategy_used, price_avg_usd, applied_price_usd, po_line_count, vendor_count, is_chosen)
           VALUES (?, ?, 0, 'TEMPLATE', ?, ?, 0, 0, 1)`,
          itemId, flkId, num(price), num(price),
        );
        const snapId = Number(snap.lastInsertRowid);
        await run(
          `INSERT INTO bom_item_price_tier (snapshot_id, tier_seq, source_currency, true_cost_source, fx_rate, quote_price_usd, is_chosen)
           VALUES (?, 1, 'USD', ?, 1, ?, 1)`,
          snapId, num(price), num(price),
        );
        pricedCount += 1;
      } else {
        await run(
          `INSERT INTO bom_item_price_snapshot (bom_item_id, bom_item_flk_id, period_months, strategy_used, applied_price_usd, po_line_count, vendor_count, is_chosen)
           VALUES (?, ?, 0, 'PENDING', NULL, 0, 0, 1)`,
          itemId, flkId,
        );
        pendingCount += 1;
      }
    }
    categoryCount += Object.keys(catCache).length;
    sections.push({ category: mod, itemCount: secItems });
  }

  log.log(`importBomTemplate: instance=${bomInstanceId} items=${itemCount} priced=${pricedCount} pending=${pendingCount} mfg=${mfgCount} sections=${sections.map((s) => `${s.category}:${s.itemCount}`).join(',')}`);
  return { bomInstanceId, itemCount, mfgCount, categoryCount, pricedCount, pendingCount, sections };
}

// rollupMaterial 已移至獨立 service(引擎解耦)· 此處 re-export 維持 API 相容
const { rollupMaterial } = require('./bomMaterialRollup');

module.exports = { importBom, importEeBom, importBomTemplate, rollupMaterial, SHEET_CONFIGS };
