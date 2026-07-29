/**
 * bomNreService.js — NRE 一次性工程費(Track N · 獨立 service)
 *
 * 對應 docs/cortex-bom-import-plan.md §8。NRE 掛 project 層,雙價 true/quote。
 * SEPARATE(預設):獨立彙總,不進 per-unit。AMORTIZED:Σ NRE(side)/ 分攤基數 → 每台攤提。
 * 純寫 013k 表;computeCase 只在 caller 傳 nrePerUnit 時加(引擎不硬依賴 NRE)。
 */

const num = (v) => (typeof v === 'number' ? v : (v == null || v === '' ? 0 : Number(v) || 0));
const pick = (row, name) => { if (!row) return undefined; const lc = name.toLowerCase(); for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k]; return undefined; };
const lc = (row) => { const o = {}; if (row) for (const k of Object.keys(row)) o[k.toLowerCase()] = row[k]; return o; };

async function rollupNre(db, projectId) {
  const rows = await db.prepare(
    `SELECT id, project_id, category, item_no, description, qty, unit_price_true, unit_price_quote,
            unit_price_negotiated, sub_total_true, sub_total_quote,
            (NVL(qty,0) * NVL(NVL(unit_price_negotiated, unit_price_quote),0)) AS sub_total_eff,
            factory_code, remark, sort_order
       FROM bom_nre_item WHERE project_id = ? ORDER BY sort_order, id`,
  ).all(projectId).catch(() => []);
  const items = rows.map(lc);
  // v0.16 #7:totalQuote = effective(NVL(negotiated, quote))→ 定版/攤提自動吃議價後;另回 original + 削減
  let totalTrue = 0, totalQuote = 0, totalQuoteOriginal = 0; const byCategory = {};
  for (const it of items) {
    const t = num(it.sub_total_true), q0 = num(it.sub_total_quote), q = num(it.sub_total_eff);
    totalTrue += t; totalQuote += q; totalQuoteOriginal += q0;
    const c = it.category || 'OTHER';
    byCategory[c] = byCategory[c] || { true: 0, quote: 0, count: 0 };
    byCategory[c].true += t; byCategory[c].quote += q; byCategory[c].count += 1;
  }
  const reductionUsd = totalQuoteOriginal - totalQuote;
  return {
    items, totalTrue, totalQuote, totalQuoteOriginal,
    reductionUsd, reductionPct: totalQuoteOriginal > 0 ? reductionUsd / totalQuoteOriginal : 0,
    marginUsd: totalQuote - totalTrue, byCategory,
  };
}

async function getConfig(db, projectId) {
  const r = await db.prepare(`SELECT project_id, nre_mode, nre_amortize_qty, amortize_side FROM bom_nre_config WHERE project_id = ?`).get(projectId).catch(() => null);
  if (!r) return { projectId: num(projectId), nreMode: 'SEPARATE', nreAmortizeQty: null, amortizeSide: 'quote' };
  const q = pick(r, 'nre_amortize_qty');
  return { projectId: num(projectId), nreMode: pick(r, 'nre_mode') || 'SEPARATE', nreAmortizeQty: q != null ? num(q) : null, amortizeSide: pick(r, 'amortize_side') || 'quote' };
}

async function setConfig(db, projectId, { nreMode, nreAmortizeQty, amortizeSide } = {}) {
  const mode = nreMode === 'AMORTIZED' ? 'AMORTIZED' : 'SEPARATE';
  const qty = nreAmortizeQty != null && nreAmortizeQty !== '' ? num(nreAmortizeQty) : null;
  const side = amortizeSide === 'true' ? 'true' : 'quote';
  const ex = await db.prepare(`SELECT project_id FROM bom_nre_config WHERE project_id = ?`).get(projectId).catch(() => null);
  if (ex) await db.prepare(`UPDATE bom_nre_config SET nre_mode=?, nre_amortize_qty=?, amortize_side=?, updated_at=SYSTIMESTAMP WHERE project_id=?`).run(mode, qty, side, projectId);
  else await db.prepare(`INSERT INTO bom_nre_config (project_id, nre_mode, nre_amortize_qty, amortize_side) VALUES (?,?,?,?)`).run(projectId, mode, qty, side);
  return getConfig(db, projectId);
}

async function addItem(db, projectId, it = {}) {
  const res = await db.prepare(
    `INSERT INTO bom_nre_item (project_id, category, item_no, description, qty, unit_price_true, unit_price_quote, factory_code, remark, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    projectId, it.category || 'OTHER', it.itemNo || null, it.description || null,
    it.qty != null ? num(it.qty) : 1,
    it.unitPriceTrue != null ? num(it.unitPriceTrue) : null,
    it.unitPriceQuote != null ? num(it.unitPriceQuote) : null,
    it.factoryCode || null, it.remark || null, it.sortOrder != null ? num(it.sortOrder) : 100,
  );
  return { id: Number(res.lastInsertRowid) };
}

async function deleteItem(db, id) {
  await db.prepare(`DELETE FROM bom_nre_item WHERE id = ?`).run(id);
  return { deleted: num(id) };
}

/** AMORTIZED 每台攤提 = Σ NRE / 分攤基數(quote+true 兩側)· SEPARATE 或無基數 → 0 */
async function amortizedPerUnit(db, projectId) {
  const cfg = await getConfig(db, projectId);
  if (cfg.nreMode !== 'AMORTIZED' || !cfg.nreAmortizeQty) return { nrePerUnit: 0, nrePerUnitQuote: 0, nrePerUnitTrue: 0, mode: cfg.nreMode };
  const roll = await rollupNre(db, projectId);
  const q = roll.totalQuote / cfg.nreAmortizeQty;
  const t = roll.totalTrue / cfg.nreAmortizeQty;
  return {
    nrePerUnit: cfg.amortizeSide === 'true' ? t : q,   // 沿用(主 side · NreRealSection 讀)
    nrePerUnitQuote: q, nrePerUnitTrue: t,
    mode: 'AMORTIZED', amortizeQty: cfg.nreAmortizeQty, side: cfg.amortizeSide,
    totalQuote: roll.totalQuote, totalTrue: roll.totalTrue,
  };
}

/** v0.16 #7:更新單項議價後價 / 備註('' → NULL 還原) */
async function updateItem(db, itemId, { unitPriceNegotiated, remark } = {}) {
  const sets = [], binds = [];
  if (unitPriceNegotiated !== undefined) { sets.push('unit_price_negotiated=?'); binds.push(unitPriceNegotiated === '' || unitPriceNegotiated == null ? null : num(unitPriceNegotiated)); }
  if (remark !== undefined) { sets.push('remark=?'); binds.push(remark ? String(remark).slice(0, 400) : null); }
  if (!sets.length) return { ok: false };
  binds.push(num(itemId));
  await db.prepare(`UPDATE bom_nre_item SET ${sets.join(', ')} WHERE id=?`).run(...binds);
  return { ok: true };
}

module.exports = { rollupNre, getConfig, setConfig, addItem, deleteItem, amortizedPerUnit, updateItem };
