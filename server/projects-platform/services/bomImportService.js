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
 * _insertBomRow — 建一筆料件(item + flk RD_MANUAL + mfg + snapshot 兩階段)· 供 template / multiboard 共用
 * f: { qty, price, desc, fpn, remark, vendor, mfgPn } · 回 { itemId, priced, mfg }
 */
async function _insertBomRow(db, catId, seq, f, variantKey) {
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const it = await run(
    `INSERT INTO bom_item (bom_category_id, item_sequence, qty, description, reference, customer_item, fpn, variant_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    catId, seq, num(f.qty), f.desc, f.remark, f.itemNo || null, f.fpn, variantKey,   // customer_item = 原始 Item No
  );
  const itemId = Number(it.lastInsertRowid);
  let flkId = null;
  if (f.fpn) {
    const flk = await run(`INSERT INTO bom_item_flk (bom_item_id, display_order, flk_part_number, source) VALUES (?, 100, ?, 'RD_MANUAL')`, itemId, f.fpn);
    flkId = Number(flk.lastInsertRowid);
    await run(`UPDATE bom_item SET final_flk_id=? WHERE id=?`, flkId, itemId);
  }
  let mfg = false;
  if (f.vendor || f.mfgPn) {
    await run(`INSERT INTO bom_item_mfg (bom_item_id, bom_item_flk_id, display_order, manufacturer_name, mfg_part_number, source, is_preferred) VALUES (?, ?, 10, ?, ?, 'TEMPLATE', 1)`, itemId, flkId, f.vendor, f.mfgPn);
    mfg = true;
  }
  const hasPrice = isNum(f.price);
  if (hasPrice) {
    const snap = await run(
      `INSERT INTO bom_item_price_snapshot (bom_item_id, bom_item_flk_id, period_months, strategy_used, price_avg_usd, applied_price_usd, po_line_count, vendor_count, is_chosen)
       VALUES (?, ?, 0, 'TEMPLATE', ?, ?, 0, 0, 1)`, itemId, flkId, num(f.price), num(f.price));
    await run(
      `INSERT INTO bom_item_price_tier (snapshot_id, tier_seq, source_currency, true_cost_source, fx_rate, quote_price_usd, is_chosen)
       VALUES (?, 1, 'USD', ?, 1, ?, 1)`, Number(snap.lastInsertRowid), num(f.price), num(f.price));
  } else {
    await run(
      `INSERT INTO bom_item_price_snapshot (bom_item_id, bom_item_flk_id, period_months, strategy_used, applied_price_usd, po_line_count, vendor_count, is_chosen)
       VALUES (?, ?, 0, 'PENDING', NULL, 0, 0, 1)`, itemId, flkId);
  }
  return { itemId, priced: hasPrice, mfg };
}

/**
 * _insertBomItemV2 — v2 三層(R-1):一 item + n 顆候選 FLK + 每 FLK n 組 vendor/價。
 * 首個 FLK = 預設採用(final_flk · 拍板4);chosen 價 = 主料 FLK 首個有價 vendor;主料無價 → PENDING。
 * g = { itemNo, desc, qty, remark, flks:[{fpn, desc, vendors:[{vendor,mfgPn,price}]}] }
 */
async function _insertBomItemV2(db, catId, seq, g, variantKey) {
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const firstFlk = g.flks[0] || {};
  const it = await run(
    `INSERT INTO bom_item (bom_category_id, item_sequence, qty, description, reference, customer_item, fpn, variant_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    catId, seq, num(g.qty), g.desc, g.remark, g.itemNo || null, firstFlk.fpn || null, variantKey,
  );
  const itemId = Number(it.lastInsertRowid);

  let finalFlkId = null, vendorCount = 0, chosenSnapId = null;
  for (let fi = 0; fi < g.flks.length; fi++) {
    const f = g.flks[fi];
    const flk = await run(
      `INSERT INTO bom_item_flk (bom_item_id, display_order, flk_part_number, description, source) VALUES (?, ?, ?, ?, 'RD_MANUAL')`,
      itemId, (fi + 1) * 10, f.fpn || null, (f.desc || '').slice(0, 500) || null,
    );
    const flkId = Number(flk.lastInsertRowid);
    if (fi === 0) { finalFlkId = flkId; await run(`UPDATE bom_item SET final_flk_id=? WHERE id=?`, flkId, itemId); }

    for (let vi = 0; vi < f.vendors.length; vi++) {
      const v = f.vendors[vi];
      let mfgId = null;
      if (v.vendor || v.mfgPn) {
        const m = await run(
          `INSERT INTO bom_item_mfg (bom_item_id, bom_item_flk_id, display_order, manufacturer_name, mfg_part_number, source, is_preferred)
           VALUES (?, ?, ?, ?, ?, 'TEMPLATE', ?)`,
          itemId, flkId, (vi + 1) * 10, v.vendor || null, v.mfgPn || null, fi === 0 && vi === 0 ? 1 : 0,
        );
        mfgId = Number(m.lastInsertRowid);
        vendorCount += 1;
      }
      if (isNum(v.price)) {
        const snap = await run(
          `INSERT INTO bom_item_price_snapshot (bom_item_id, bom_item_flk_id, bom_item_mfg_id, period_months, strategy_used, price_avg_usd, applied_price_usd, po_line_count, vendor_count, is_chosen)
           VALUES (?, ?, ?, 0, 'TEMPLATE', ?, ?, 0, 1, 0)`,
          itemId, flkId, mfgId, num(v.price), num(v.price),
        );
        const snapId = Number(snap.lastInsertRowid);
        await run(
          `INSERT INTO bom_item_price_tier (snapshot_id, tier_seq, source_currency, true_cost_source, fx_rate, quote_price_usd, is_chosen)
           VALUES (?, 1, 'USD', ?, 1, ?, 1)`, snapId, num(v.price), num(v.price),
        );
        if (chosenSnapId == null && flkId === finalFlkId) chosenSnapId = snapId;   // 主料首價 = 採用
      }
    }
  }

  if (chosenSnapId != null) {
    await run(`UPDATE bom_item_price_snapshot SET is_chosen=1 WHERE id=?`, chosenSnapId);
  } else {
    await run(
      `INSERT INTO bom_item_price_snapshot (bom_item_id, bom_item_flk_id, period_months, strategy_used, applied_price_usd, po_line_count, vendor_count, is_chosen)
       VALUES (?, ?, 0, 'PENDING', NULL, 0, 0, 1)`, itemId, finalFlkId,
    );
  }
  return { itemId, priced: chosenSnapId != null, flkCount: g.flks.length, vendorCount };
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
      const itemNo = H.itemNo != null ? str(row[H.itemNo]) : null;
      const desc = H.desc != null ? str(row[H.desc]) : null;
      const fpn = H.fpn != null ? str(row[H.fpn]) : null;
      const remark = H.remark != null ? str(row[H.remark]) : null;
      const vendor = H.vendor != null ? str(row[H.vendor]) : null;
      const mfgPn = H.mfgPn != null ? str(row[H.mfgPn]) : null;
      seq += 1;
      const res = await _insertBomRow(db, catId, seq, { qty, price, desc, fpn, remark, vendor, mfgPn, itemNo }, variantKey);
      itemCount += 1; secItems += 1;
      if (res.priced) pricedCount += 1; else pendingCount += 1;
      if (res.mfg) mfgCount += 1;
    }
    categoryCount += Object.keys(catCache).length;
    sections.push({ category: mod, itemCount: secItems });
  }

  log.log(`importBomTemplate: instance=${bomInstanceId} items=${itemCount} priced=${pricedCount} pending=${pendingCount} mfg=${mfgCount} sections=${sections.map((s) => `${s.category}:${s.itemCount}`).join(',')}`);
  return { bomInstanceId, itemCount, mfgCount, categoryCount, pricedCount, pendingCount, sections };
}

/**
 * importMultiBoardBom — 多板 BOM(每分頁一個 section · Category 欄=EE/ME/PKG)· W1a(WHOOP 等多片板)
 * 讀所有分頁(排除說明/空頁),每頁一 section(module_code=分頁名,module_category=Category 欄),
 * 一 section 一 bom_category 掛全料。兩階段同 template(price 可空 → PENDING)。
 */
async function importMultiBoardBom(db, opts = {}) {
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

  let itemCount = 0, mfgCount = 0, pricedCount = 0, pendingCount = 0, seq = 0, si = 0;
  const sections = [];
  const sheetNames = wb.SheetNames.filter((n) => !/說明|instruction|readme|工作表|^sheet\d/i.test(n));
  for (const sheetName of sheetNames) {
    const ws = wb.Sheets[sheetName]; if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (!rows.length) continue;
    const H = resolveTplHeader(rows[0] || []);
    if (H.qty == null) { log.warn(`importMultiBoardBom: sheet ${sheetName} 缺 Qty 標題,跳過`); continue; }
    // module_category = Category 欄(首個 EE/ME/PKG 值 · 全板同)· 預設 EE
    let moduleCat = 'EE';
    if (H.category != null) {
      for (let r = 1; r < rows.length; r++) { const c = rows[r] && str(rows[r][H.category]); if (c && /^(EE|ME|PKG)$/i.test(c)) { moduleCat = c.toUpperCase(); break; } }
    }
    si += 1;
    const sec = await run(
      `INSERT INTO bom_section (bom_instance_id, module_code, module_category, display_order, name) VALUES (?, ?, ?, ?, ?)`,
      bomInstanceId, sheetName.slice(0, 40), moduleCat, si * 10, sheetName.slice(0, 120),
    );
    const catId = Number((await run(`INSERT INTO bom_category (bom_section_id, display_order, name, process_type) VALUES (?, 10, ?, NULL)`, Number(sec.lastInsertRowid), sheetName.slice(0, 60))).lastInsertRowid);
    let secItems = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]; if (!row) continue;
      const qty = row[H.qty]; if (!isNum(qty)) continue;
      seq += 1; secItems += 1;
      const f = {
        qty, price: H.price != null ? row[H.price] : null,
        itemNo: H.itemNo != null ? str(row[H.itemNo]) : null,
        desc: H.desc != null ? str(row[H.desc]) : null, fpn: H.fpn != null ? str(row[H.fpn]) : null,
        remark: H.remark != null ? str(row[H.remark]) : null,
        vendor: H.vendor != null ? str(row[H.vendor]) : null, mfgPn: H.mfgPn != null ? str(row[H.mfgPn]) : null,
      };
      const res = await _insertBomRow(db, catId, seq, f, variantKey);
      itemCount += 1; if (res.priced) pricedCount += 1; else pendingCount += 1; if (res.mfg) mfgCount += 1;
    }
    sections.push({ section: sheetName, category: moduleCat, itemCount: secItems });
  }
  log.log(`importMultiBoardBom: instance=${bomInstanceId} sections=${sections.length} items=${itemCount} priced=${pricedCount} pending=${pendingCount}`);
  return { bomInstanceId, itemCount, mfgCount, pricedCount, pendingCount, sections };
}

/**
 * importCanonicalBom — 統一匯入器(U1):profile 轉 canonical rows → 按半成品(subAssembly)建 section。
 * 系統唯一匯入路徑 · 各專案差異全在 profile(CANONICAL 直讀 / MAPPED 用設定轉)。
 */
async function importCanonicalBom(db, opts = {}) {
  const { filePath, projectId, profileCode = 'CANONICAL', variantKey = null, versionNo = 1, mergeMode = false } = opts;
  if (!filePath) throw new Error('bomImportService: filePath required');
  if (!projectId) throw new Error('bomImportService: projectId required');
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const profileSvc = require('./bomImportProfileService');
  const profile = await profileSvc.getProfile(db, profileCode);
  if (!profile) throw new Error(`import profile not found: ${profileCode}`);
  const wb = XLSX.readFile(filePath);
  const rows = profileSvc.transformToCanonical(wb, profile);
  if (!rows.length) throw new Error(`no BOM rows parsed (profile=${profileCode} · 檢查格式/對映)`);

  // B-3a:變異值必須先定義(硬擋)· import 前置驗證,未定義 → 中止(不半匯入)
  const undef = await require('./bomVariantService').collectUndefinedValues(db, projectId, rows);
  if (undef.length) {
    const e = new Error(`BOM_UNDEFINED_VARIANT_VALUES: ${undef.map((u) => `${u.dimCode}=${u.valueCode}`).join(', ')} 未定義,請先在「變異軸設定」新增`);
    e.code = 'BOM_UNDEFINED_VARIANT_VALUES'; e.undefinedValues = undef;
    throw e;
  }

  const variantSvc = require('./bomVariantService');
  const old = await get(
    `SELECT id FROM bom_instance WHERE project_id=? AND version_no=? AND ${variantKey == null ? 'variant_key IS NULL' : 'variant_key=?'}`,
    ...(variantKey == null ? [projectId, versionNo] : [projectId, versionNo, variantKey]),
  );

  // ── v2 三層分組(R-1):(半成品, Item No) → 1..n FLK 候選 → 每 FLK 1..n Vendor ──
  //   一列 = 一個 (FLK, Vendor) 組合;同 (半成品,ItemNo) 多列自動歸群。
  //   itemNo 空 → 該列自成一 item(v1 相容);首個 FLK = 預設採用(final_flk)。
  const groups = []; const gIndex = {};
  rows.forEach((cr, i) => {
    // item 身分 = (半成品, 適用組合, Item No):不同顏色/包裝的同 Item No 是不同料件(Black P1 ≠ White P1)
    const effSig = (cr.effectivity || []).map((e) => `${e.dimCode}=${e.valueCode}`).sort().join('|');
    const key = cr.itemNo ? `${cr.subAssembly}||${effSig}||${cr.itemNo}` : `${cr.subAssembly}||${effSig}||__row${i}`;
    let g = gIndex[key];
    if (!g) {
      g = gIndex[key] = { subAssembly: cr.subAssembly, subAssemblyPn: cr.subAssemblyPn, category: cr.category, module: cr.module, itemNo: cr.itemNo, desc: cr.desc, qty: cr.qty, remark: cr.remark, effectivity: cr.effectivity || [], flks: [], _byFpn: {} };
      groups.push(g);
    }
    if (!g.subAssemblyPn && cr.subAssemblyPn) g.subAssemblyPn = cr.subAssemblyPn;
    if (!g.category && cr.category) g.category = cr.category;
    const vend = (cr.vendor || cr.mfgPn || cr.unitPrice != null) ? { vendor: cr.vendor, mfgPn: cr.mfgPn, price: cr.unitPrice } : null;
    const last = g.flks[g.flks.length - 1];
    let f = null;
    if (cr.fpn) { f = g._byFpn[cr.fpn]; if (!f) { f = g._byFpn[cr.fpn] = { fpn: cr.fpn, desc: cr.desc || g.desc, vendors: [] }; g.flks.push(f); } }
    else if (last && (!cr.desc || cr.desc === last.desc)) f = last;                       // vendor 續列(無 FLK · desc 同上)
    else { f = { fpn: null, desc: cr.desc || g.desc, vendors: [] }; g.flks.push(f); }    // 無料號的另一顆候選
    if (vend) f.vendors.push(vend);
  });
  for (const g of groups) if (!g.flks.length) g.flks.push({ fpn: null, desc: g.desc, vendors: [] });

  const secMap = {};   // subAssembly → { sectionId, module, partNumber, cats:{name→catId}, items }
  let bomInstanceId, si = 0;
  if (mergeMode && old) {
    // MERGE:併入既有 instance(不刪)· 載既有 sections + categories reuse
    bomInstanceId = Number(pick(old, 'id'));
    const secs = await db.prepare(
      `SELECT id, name, module_category, part_number FROM bom_section WHERE bom_instance_id = ? ORDER BY display_order`,
    ).all(bomInstanceId).catch(() => []);
    for (const s of secs) {
      const nm = pick(s, 'name');
      if (secMap[nm]) continue;
      const sec = { sectionId: Number(pick(s, 'id')), module: pick(s, 'module_category'), partNumber: pick(s, 'part_number'), cats: {}, items: 0 };
      const cats = await db.prepare(`SELECT id, name FROM bom_category WHERE bom_section_id = ? ORDER BY display_order`).all(sec.sectionId).catch(() => []);
      for (const c of cats) sec.cats[pick(c, 'name')] = Number(pick(c, 'id'));
      secMap[nm] = sec;
    }
    si = secs.length;
  } else {
    if (old) await run(`DELETE FROM bom_instance WHERE id=?`, Number(pick(old, 'id')));
    const inst = await run(
      `INSERT INTO bom_instance (project_id, version_no, variant_scope, variant_key, state, price_period_months, price_strategy)
       VALUES (?, ?, ?, ?, 'DRAFT', 12, 'AVG')`,
      projectId, versionNo, variantKey ? 'per_variant' : 'shared', variantKey,
    );
    bomInstanceId = Number(inst.lastInsertRowid);
  }

  // 每 category seq 從既有 max 續(merge 不撞 unique(cat,seq))
  const catSeq = {};
  const nextSeq = async (catId) => {
    if (catSeq[catId] == null) catSeq[catId] = Number(pick(await get(`SELECT NVL(MAX(item_sequence),0) AS m FROM bom_item WHERE bom_category_id=?`, catId), 'm')) || 0;
    return ++catSeq[catId];
  };
  // 半成品:料號可空 → 自動暫編 SA-{MOD}-{n}(報價階段允許無 ERP 半成品料號 · 拍板 1b)
  const ensureSection = async (subAssembly, module, subAssemblyPn) => {
    if (secMap[subAssembly]) return secMap[subAssembly];
    si += 1;
    const pn = (subAssemblyPn || `SA-${module}-${si}`).slice(0, 120);
    const s = await run(`INSERT INTO bom_section (bom_instance_id, module_code, module_category, display_order, name, part_number) VALUES (?, ?, ?, ?, ?, ?)`,
      bomInstanceId, subAssembly.slice(0, 40), module, si * 10, subAssembly.slice(0, 120), pn);
    return (secMap[subAssembly] = { sectionId: Number(s.lastInsertRowid), module, partNumber: pn, cats: {}, items: 0 });
  };
  const ensureCategory = async (sec, name) => {
    const key = (name || '一般').slice(0, 60);
    if (sec.cats[key]) return sec.cats[key];
    const c = await run(`INSERT INTO bom_category (bom_section_id, display_order, name, process_type) VALUES (?, ?, ?, NULL)`,
      sec.sectionId, Object.keys(sec.cats).length * 10 + 10, key);
    return (sec.cats[key] = Number(c.lastInsertRowid));
  };

  // MERGE:先刪各 scope 既有料(該 半成品 + 該 effectivity 集合)→ 覆蓋該變異,不動 EE/其他顏色包裝
  let deletedInMerge = 0;
  if (mergeMode) {
    const scopes = {};
    for (const g of groups) {
      const sig = (g.effectivity || []).map((e) => `${e.dimCode}=${e.valueCode}`).sort().join('|');
      const key = `${g.subAssembly}||${sig}`;
      if (!scopes[key]) scopes[key] = { subAssembly: g.subAssembly, effectivity: g.effectivity || [] };
    }
    for (const sc of Object.values(scopes)) {
      const secExisting = secMap[sc.subAssembly]; if (!secExisting) continue;
      const valueIds = [];
      for (const e of sc.effectivity) { const dv = await variantSvc.resolveDimensionValue(db, projectId, e.dimCode, e.valueCode); if (dv) valueIds.push(dv.valueId); }
      deletedInMerge += await variantSvc.deleteItemsByScope(db, secExisting.sectionId, valueIds);
    }
  }

  let itemCount = 0, flkCount = 0, mfgCount = 0, pricedCount = 0, pendingCount = 0, effTagged = 0;
  for (const g of groups) {
    const sec = await ensureSection(g.subAssembly, g.module, g.subAssemblyPn);
    const catId = await ensureCategory(sec, g.category);
    const seq = await nextSeq(catId);
    sec.items += 1;
    const res = await _insertBomItemV2(db, catId, seq, g, variantKey);
    itemCount += 1; flkCount += res.flkCount; mfgCount += res.vendorCount;
    if (res.priced) pricedCount += 1; else pendingCount += 1;
    if (g.effectivity && g.effectivity.length) { try { effTagged += await variantSvc.applyEffectivity(db, projectId, res.itemId, g.effectivity); } catch (e) { log.warn('applyEffectivity:', e.message); } }
  }
  const sections = Object.entries(secMap).filter(([, v]) => v.items > 0).map(([k, v]) => ({ section: k, partNumber: v.partNumber, category: v.module, itemCount: v.items }));
  log.log(`importCanonicalBom[${profileCode}]${mergeMode ? ' MERGE' : ''}: instance=${bomInstanceId} sections=${sections.length} items=${itemCount} flks=${flkCount} vendors=${mfgCount} priced=${pricedCount} pending=${pendingCount} effTagged=${effTagged} deleted=${deletedInMerge}`);
  return { bomInstanceId, itemCount, flkCount, mfgCount, pricedCount, pendingCount, sections, profileCode, effTagged, merged: !!mergeMode, deletedInMerge };
}

// rollupMaterial 已移至獨立 service(引擎解耦)· 此處 re-export 維持 API 相容
const { rollupMaterial } = require('./bomMaterialRollup');

module.exports = { importBom, importEeBom, importBomTemplate, importMultiBoardBom, importCanonicalBom, rollupMaterial, SHEET_CONFIGS };
