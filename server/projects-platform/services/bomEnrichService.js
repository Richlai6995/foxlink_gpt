/**
 * bomEnrichService.js — B-5b 採購手動 enrich(per-vendor 報價)· 獨立 service
 *
 * 對應 docs/cortex-bom-import-plan.md §10 B-5b。
 * 一料件多 vendor:每 vendor 一筆 snapshot(bom_item_mfg_id)+ N 個 tier(qty 級距 · true/quote)。
 * 採購比價選 chosen snapshot → rollup 取其 applied_price → 料件脫離 PENDING。
 * 純寫 013b/013j 結構表,不碰引擎/rollup 計算邏輯。
 *
 * 不變式:每 item 恰一筆 snapshot.is_chosen=1(pending 時 = placeholder · applied=NULL)。
 * applied_price 先取 chosen tier 的 quote(單軌 · 相容現況);true/quote 雙軌併 §9.3 主線。
 */

const num = (v) => (typeof v === 'number' ? v : (v == null || v === '' ? 0 : Number(v) || 0));
const str = (v) => (v == null ? null : String(v).trim() || null);
const pick = (row, name) => { if (!row) return undefined; const lc = name.toLowerCase(); for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k]; return undefined; };
const lc = (row) => { const o = {}; if (row) for (const k of Object.keys(row)) o[k.toLowerCase()] = row[k]; return o; };

async function getItem(db, itemId) {
  return db.prepare(`SELECT id, bom_category_id, item_sequence, qty, description, fpn, final_flk_id FROM bom_item WHERE id=?`).get(itemId);
}

/** item 明細:item + vendors(mfg)+ 每 vendor 的 snapshot(含 tiers)+ 狀態 */
async function getItemDetail(db, itemId) {
  const item = await getItem(db, itemId);
  if (!item) return null;
  const mfgs = await db.prepare(
    `SELECT id, bom_item_flk_id, manufacturer_name, mfg_part_number, source, is_preferred FROM bom_item_mfg WHERE bom_item_id=? ORDER BY display_order, id`,
  ).all(itemId).catch(() => []);
  const snaps = await db.prepare(
    `SELECT id, bom_item_mfg_id, strategy_used, applied_price_usd, is_chosen FROM bom_item_price_snapshot WHERE bom_item_id=? ORDER BY is_chosen DESC, id`,
  ).all(itemId).catch(() => []);
  const snapOut = snaps.map((s) => ({ ...lc(s), tiers: [] }));
  const byId = {}; snapOut.forEach((o) => { byId[num(o.id)] = o; });
  const snapIds = snapOut.map((o) => num(o.id));
  if (snapIds.length) {
    const tiers = await db.prepare(
      `SELECT tier_id, snapshot_id, tier_seq, qty_min, qty_max, qty_tier_label, source_currency,
              true_cost_source, fx_rate, true_cost_usd, quote_price_usd, markup_pct, is_chosen
         FROM bom_item_price_tier WHERE snapshot_id IN (${snapIds.map(() => '?').join(',')}) ORDER BY snapshot_id, tier_seq`,
    ).all(...snapIds).catch(() => []);
    for (const t of tiers) { const o = byId[num(pick(t, 'snapshot_id'))]; if (o) o.tiers.push(lc(t)); }
  }
  const chosen = snapOut.find((s) => Number(s.is_chosen) === 1);
  const appliedPrice = chosen ? chosen.applied_price_usd : null;
  return { item: lc(item), mfgs: mfgs.map(lc), snapshots: snapOut, status: appliedPrice == null ? 'pending' : 'priced', appliedPrice };
}

/** 加 vendor(採購新增替代供應商)→ 回 mfgId */
async function addVendor(db, itemId, { vendor, mfgPn }) {
  const item = await getItem(db, itemId);
  if (!item) throw new Error('item not found');
  if (!str(vendor) && !str(mfgPn)) throw new Error('vendor or mfgPn required');
  const flkId = num(pick(item, 'final_flk_id')) || null;
  const res = await db.prepare(
    `INSERT INTO bom_item_mfg (bom_item_id, bom_item_flk_id, display_order, manufacturer_name, mfg_part_number, source, is_preferred) VALUES (?, ?, 100, ?, ?, 'MANUAL', 0)`,
  ).run(itemId, flkId, str(vendor), str(mfgPn));
  return { mfgId: Number(res.lastInsertRowid) };
}

/**
 * 加報價(一 vendor 一 snapshot + N tier)。tiers:[{qtyMin,qtyMax,label,sourceCurrency,trueCostSource,fxRate,quotePrice,isChosen}]
 * 若此料件目前無「已有價的 chosen」(仍 pending)→ 自動選這筆為 chosen(首個報價即脫離 PENDING)。
 */
async function addPrice(db, itemId, { mfgId = null, sourceCurrency = 'USD', tiers = [] }) {
  const item = await getItem(db, itemId);
  if (!item) throw new Error('item not found');
  if (!Array.isArray(tiers) || !tiers.length) throw new Error('tiers required (>=1)');
  const flkId = num(pick(item, 'final_flk_id')) || null;
  let chosenIdx = tiers.findIndex((t) => t.isChosen);
  if (chosenIdx < 0) chosenIdx = 0;
  const appliedQuote = num(tiers[chosenIdx].quotePrice);

  const snapRes = await db.prepare(
    `INSERT INTO bom_item_price_snapshot (bom_item_id, bom_item_flk_id, bom_item_mfg_id, period_months, strategy_used, applied_price_usd, po_line_count, vendor_count, is_chosen)
     VALUES (?, ?, ?, 0, 'MANUAL', ?, 0, 1, 0)`,
  ).run(itemId, flkId, mfgId ? num(mfgId) : null, appliedQuote);
  const snapshotId = Number(snapRes.lastInsertRowid);

  let seq = 0;
  for (const t of tiers) {
    seq += 1;
    await db.prepare(
      `INSERT INTO bom_item_price_tier (snapshot_id, tier_seq, qty_min, qty_max, qty_tier_label, source_currency, true_cost_source, fx_rate, quote_price_usd, is_chosen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(snapshotId, seq,
      t.qtyMin != null ? num(t.qtyMin) : null,
      t.qtyMax != null ? num(t.qtyMax) : null,
      str(t.label),
      str(t.sourceCurrency || sourceCurrency) || 'USD',
      t.trueCostSource != null ? num(t.trueCostSource) : null,
      t.fxRate != null ? num(t.fxRate) : 1,
      t.quotePrice != null ? num(t.quotePrice) : null,
      (seq - 1) === chosenIdx ? 1 : 0,
    );
  }

  // 目前是否已有「有價的 chosen」?沒有(仍 pending placeholder)→ 自動選這筆
  const cur = await db.prepare(
    `SELECT id FROM bom_item_price_snapshot WHERE bom_item_id=? AND is_chosen=1 AND applied_price_usd IS NOT NULL FETCH FIRST 1 ROWS ONLY`,
  ).get(itemId).catch(() => null);
  let autoChosen = false;
  if (!cur) { await chooseSnapshot(db, itemId, snapshotId); autoChosen = true; }
  return { snapshotId, appliedPrice: appliedQuote, autoChosen };
}

/** 選定某 vendor snapshot 為此料件的價(rollup 取 chosen 的 applied_price)*/
async function chooseSnapshot(db, itemId, snapshotId) {
  const s = await db.prepare(`SELECT id FROM bom_item_price_snapshot WHERE id=? AND bom_item_id=?`).get(snapshotId, itemId);
  if (!s) throw new Error('snapshot not found for item');
  await db.prepare(`UPDATE bom_item_price_snapshot SET is_chosen=0 WHERE bom_item_id=?`).run(itemId);
  await db.prepare(`UPDATE bom_item_price_snapshot SET is_chosen=1 WHERE id=?`).run(snapshotId);
  return { itemId, snapshotId };
}

module.exports = { getItemDetail, addVendor, addPrice, chooseSnapshot };
