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

/**
 * item 明細(R-3 分層):item + flks[](FLK 候選 · 每顆帶 vendors + snapshots(含 tiers))+ 狀態。
 * 採用料號 = final_flk;採用價 = chosen snapshot(不變式:chosen ∈ final_flk)。
 * 舊資料 snapshot.flk_id NULL → 歸到 final_flk 群(fallback)。
 */
async function getItemDetail(db, itemId) {
  const item = await getItem(db, itemId);
  if (!item) return null;
  const finalFlkId = num(pick(item, 'final_flk_id')) || null;
  const flkRows = await db.prepare(
    `SELECT id, flk_part_number, description, source, display_order FROM bom_item_flk WHERE bom_item_id=? ORDER BY display_order, id`,
  ).all(itemId).catch(() => []);
  const mfgs = await db.prepare(
    `SELECT id, bom_item_flk_id, manufacturer_name, mfg_part_number, source, is_preferred FROM bom_item_mfg WHERE bom_item_id=? ORDER BY display_order, id`,
  ).all(itemId).catch(() => []);
  const snaps = await db.prepare(
    `SELECT id, bom_item_flk_id, bom_item_mfg_id, strategy_used, applied_price_usd, is_chosen FROM bom_item_price_snapshot WHERE bom_item_id=? ORDER BY is_chosen DESC, id`,
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
    // 013ad per-region 料價:每 snapshot 附區域覆寫價
    snapOut.forEach((o) => { o.regionPrices = []; });
    const rps = await db.prepare(
      `SELECT snapshot_id, region_code, unit_price_usd, true_cost_usd
         FROM bom_item_price_region WHERE snapshot_id IN (${snapIds.map(() => '?').join(',')}) ORDER BY region_code`,
    ).all(...snapIds).catch(() => []);
    for (const rp of rps) { const o = byId[num(pick(rp, 'snapshot_id'))]; if (o) o.regionPrices.push(lc(rp)); }
  }
  // 分層組裝:flk → vendors + snapshots(flk_id NULL 的舊資料歸 final)
  let flks = flkRows.map(lc).map((f) => ({
    ...f, is_final: Number(f.id) === finalFlkId ? 1 : 0,
    mfgs: mfgs.map(lc).filter((m) => num(m.bom_item_flk_id) === num(f.id)),
    snapshots: snapOut.filter((s) => (num(s.bom_item_flk_id) || finalFlkId) === num(f.id) && s.strategy_used !== 'PENDING'),
  }));
  if (!flks.length) {   // 極舊資料無 flk 列 → 虛擬一顆(item.fpn)
    flks = [{ id: null, flk_part_number: pick(item, 'fpn') || null, description: null, is_final: 1, mfgs: mfgs.map(lc), snapshots: snapOut.filter((s) => s.strategy_used !== 'PENDING') }];
  }
  const chosen = snapOut.find((s) => Number(s.is_chosen) === 1 && s.strategy_used !== 'PENDING');
  const appliedPrice = chosen ? chosen.applied_price_usd : null;
  return { item: lc(item), finalFlkId, flks, status: appliedPrice == null ? 'pending' : 'priced', appliedPrice };
}

/** 清 PENDING placeholder(item 已有真 chosen 時的殘留)*/
async function _cleanPendingPlaceholder(db, itemId) {
  await db.prepare(`DELETE FROM bom_item_price_snapshot WHERE bom_item_id=? AND strategy_used='PENDING' AND applied_price_usd IS NULL AND is_chosen=0`).run(itemId).catch(() => {});
}

/** 加 FLK 候選(採購補替代料號)→ 回 flkId(R-3)*/
async function addFlk(db, itemId, { fpn, desc }) {
  const item = await getItem(db, itemId);
  if (!item) throw new Error('item not found');
  if (!str(fpn) && !str(desc)) throw new Error('fpn or desc required');
  const res = await db.prepare(
    `INSERT INTO bom_item_flk (bom_item_id, display_order, flk_part_number, description, source) VALUES (?, 900, ?, ?, 'MANUAL')`,
  ).run(itemId, str(fpn), str(desc) ? str(desc).slice(0, 500) : null);
  const flkId = Number(res.lastInsertRowid);
  // item 尚無採用料號 → 這顆直接成為 final
  if (!num(pick(item, 'final_flk_id'))) await db.prepare(`UPDATE bom_item SET final_flk_id=? WHERE id=?`).run(flkId, itemId);
  return { flkId };
}

/**
 * 選採用料號(FLK)(R-3):final_flk 切過去 + chosen 自動跳該 FLK 首個有價報價;無價 → item 轉待詢價。
 * 不變式維護:恰一 chosen(有價 → 該 FLK 首價;無價 → PENDING placeholder 掛此 FLK)。
 */
async function chooseFlk(db, itemId, flkId) {
  const f = await db.prepare(`SELECT id FROM bom_item_flk WHERE id=? AND bom_item_id=?`).get(flkId, itemId);
  if (!f) throw new Error('flk not found for item');
  await db.prepare(`UPDATE bom_item SET final_flk_id=? WHERE id=?`).run(flkId, itemId);
  await db.prepare(`UPDATE bom_item_price_snapshot SET is_chosen=0 WHERE bom_item_id=?`).run(itemId);
  await db.prepare(`DELETE FROM bom_item_price_snapshot WHERE bom_item_id=? AND strategy_used='PENDING' AND applied_price_usd IS NULL`).run(itemId).catch(() => {});
  const first = await db.prepare(
    `SELECT id FROM bom_item_price_snapshot WHERE bom_item_id=? AND bom_item_flk_id=? AND applied_price_usd IS NOT NULL ORDER BY id FETCH FIRST 1 ROWS ONLY`,
  ).get(itemId, flkId).catch(() => null);
  if (first) { await db.prepare(`UPDATE bom_item_price_snapshot SET is_chosen=1 WHERE id=?`).run(Number(pick(first, 'id'))); return { itemId, flkId, chosenSnapshotId: Number(pick(first, 'id')), pending: false }; }
  const item = await getItem(db, itemId);
  await db.prepare(
    `INSERT INTO bom_item_price_snapshot (bom_item_id, bom_item_flk_id, period_months, strategy_used, applied_price_usd, po_line_count, vendor_count, is_chosen)
     VALUES (?, ?, 0, 'PENDING', NULL, 0, 0, 1)`,
  ).run(itemId, flkId);
  void item;
  return { itemId, flkId, chosenSnapshotId: null, pending: true };
}

/** 加 vendor(採購新增替代供應商 · 可指定掛哪顆 FLK,預設 final)→ 回 mfgId */
async function addVendor(db, itemId, { vendor, mfgPn, flkId = null }) {
  const item = await getItem(db, itemId);
  if (!item) throw new Error('item not found');
  if (!str(vendor) && !str(mfgPn)) throw new Error('vendor or mfgPn required');
  const fid = num(flkId) || num(pick(item, 'final_flk_id')) || null;
  const res = await db.prepare(
    `INSERT INTO bom_item_mfg (bom_item_id, bom_item_flk_id, display_order, manufacturer_name, mfg_part_number, source, is_preferred) VALUES (?, ?, 100, ?, ?, 'MANUAL', 0)`,
  ).run(itemId, fid, str(vendor), str(mfgPn));
  return { mfgId: Number(res.lastInsertRowid) };
}

/**
 * 加報價(一 vendor 一 snapshot + N tier)。tiers:[{qtyMin,qtyMax,label,sourceCurrency,trueCostSource,fxRate,quotePrice,isChosen}]
 * 若此料件目前無「已有價的 chosen」(仍 pending)→ 自動選這筆為 chosen(首個報價即脫離 PENDING)。
 */
async function addPrice(db, itemId, { mfgId = null, flkId: flkIdIn = null, sourceCurrency = 'USD', tiers = [] }) {
  const item = await getItem(db, itemId);
  if (!item) throw new Error('item not found');
  if (!Array.isArray(tiers) || !tiers.length) throw new Error('tiers required (>=1)');
  const flkId = num(flkIdIn) || num(pick(item, 'final_flk_id')) || null;   // R-3:報價掛指定 FLK(預設 final)
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

/**
 * 更新既有報價(改供應商/mfgPn/true/fx/quote)· 只更新有帶的欄位。
 * vendor/mfgPn → upsert 連結的 mfg(無 mfg 則建);true/fx/quote → 改 chosen(或首個)tier;quote 同步 snapshot.applied。
 */
async function updatePrice(db, itemId, snapshotId, patch = {}) {
  const snap = await db.prepare(`SELECT id, bom_item_mfg_id FROM bom_item_price_snapshot WHERE id=? AND bom_item_id=?`).get(snapshotId, itemId);
  if (!snap) throw new Error('snapshot not found for item');
  let mfgId = num(pick(snap, 'bom_item_mfg_id')) || null;

  // 供應商 / Mfg P/N → upsert mfg
  if (patch.vendor !== undefined || patch.mfgPn !== undefined) {
    if (mfgId) {
      const sets = [], binds = [];
      if (patch.vendor !== undefined) { sets.push('manufacturer_name=?'); binds.push(str(patch.vendor)); }
      if (patch.mfgPn !== undefined) { sets.push('mfg_part_number=?'); binds.push(str(patch.mfgPn)); }
      if (sets.length) { binds.push(mfgId); await db.prepare(`UPDATE bom_item_mfg SET ${sets.join(', ')} WHERE id=?`).run(...binds); }
    } else if (str(patch.vendor) != null || str(patch.mfgPn) != null) {
      const item = await getItem(db, itemId);
      const flkId = num(pick(item, 'final_flk_id')) || null;
      const r = await db.prepare(
        `INSERT INTO bom_item_mfg (bom_item_id, bom_item_flk_id, display_order, manufacturer_name, mfg_part_number, source, is_preferred) VALUES (?, ?, 100, ?, ?, 'MANUAL', 0)`,
      ).run(itemId, flkId, str(patch.vendor), str(patch.mfgPn));
      mfgId = Number(r.lastInsertRowid);
      await db.prepare(`UPDATE bom_item_price_snapshot SET bom_item_mfg_id=? WHERE id=?`).run(mfgId, snapshotId);
    }
  }

  // true / fx / quote / 幣別 → chosen(或首個)tier
  const tier = await db.prepare(
    `SELECT tier_id FROM bom_item_price_tier WHERE snapshot_id=? ORDER BY is_chosen DESC, tier_seq FETCH FIRST 1 ROWS ONLY`,
  ).get(snapshotId).catch(() => null);
  if (tier) {
    const tid = num(pick(tier, 'tier_id'));
    const sets = [], binds = [];
    if (patch.sourceCurrency !== undefined) { sets.push('source_currency=?'); binds.push(str(patch.sourceCurrency) || 'USD'); }
    if (patch.trueCostSource !== undefined) { sets.push('true_cost_source=?'); binds.push(patch.trueCostSource === '' || patch.trueCostSource == null ? null : num(patch.trueCostSource)); }
    if (patch.fxRate !== undefined) { sets.push('fx_rate=?'); binds.push(patch.fxRate === '' || patch.fxRate == null ? 1 : num(patch.fxRate)); }
    if (patch.quotePrice !== undefined) { sets.push('quote_price_usd=?'); binds.push(patch.quotePrice === '' || patch.quotePrice == null ? null : num(patch.quotePrice)); }
    if (sets.length) { binds.push(tid); await db.prepare(`UPDATE bom_item_price_tier SET ${sets.join(', ')} WHERE tier_id=?`).run(...binds); }
  }
  // quote 同步 snapshot.applied_price_usd(相容現況單軌)
  if (patch.quotePrice !== undefined) {
    await db.prepare(`UPDATE bom_item_price_snapshot SET applied_price_usd=? WHERE id=?`)
      .run(patch.quotePrice === '' || patch.quotePrice == null ? null : num(patch.quotePrice), snapshotId);
  }
  return { snapshotId, mfgId };
}

/** 刪一筆報價(snapshot+tiers)· 若刪的是 chosen → 改選另一有價的,無則還原 PENDING placeholder */
async function deletePrice(db, itemId, snapshotId) {
  const snap = await db.prepare(`SELECT id, is_chosen FROM bom_item_price_snapshot WHERE id=? AND bom_item_id=?`).get(snapshotId, itemId);
  if (!snap) throw new Error('snapshot not found for item');
  const wasChosen = Number(pick(snap, 'is_chosen')) === 1;
  await db.prepare(`DELETE FROM bom_item_price_tier WHERE snapshot_id=?`).run(snapshotId);
  await db.prepare(`DELETE FROM bom_item_price_snapshot WHERE id=?`).run(snapshotId);
  if (wasChosen) {
    const other = await db.prepare(
      `SELECT id FROM bom_item_price_snapshot WHERE bom_item_id=? AND applied_price_usd IS NOT NULL ORDER BY id FETCH FIRST 1 ROWS ONLY`,
    ).get(itemId).catch(() => null);
    if (other) { await chooseSnapshot(db, itemId, Number(pick(other, 'id'))); }
    else {
      const item = await getItem(db, itemId);
      const flkId = num(pick(item, 'final_flk_id')) || null;
      await db.prepare(
        `INSERT INTO bom_item_price_snapshot (bom_item_id, bom_item_flk_id, period_months, strategy_used, applied_price_usd, po_line_count, vendor_count, is_chosen)
         VALUES (?, ?, 0, 'PENDING', NULL, 0, 0, 1)`,
      ).run(itemId, flkId);
    }
  }
  return { deleted: snapshotId };
}

/**
 * 選定某 vendor snapshot 為此料件的採用價(rollup 取 chosen 的 applied_price)。
 * R-3 連動:若該報價屬於別顆 FLK → 一鍵換料+換價(final_flk 自動切過去);清 PENDING 殘留。
 */
async function chooseSnapshot(db, itemId, snapshotId) {
  const s = await db.prepare(`SELECT id, bom_item_flk_id FROM bom_item_price_snapshot WHERE id=? AND bom_item_id=?`).get(snapshotId, itemId);
  if (!s) throw new Error('snapshot not found for item');
  await db.prepare(`UPDATE bom_item_price_snapshot SET is_chosen=0 WHERE bom_item_id=?`).run(itemId);
  await db.prepare(`UPDATE bom_item_price_snapshot SET is_chosen=1 WHERE id=?`).run(snapshotId);
  const snapFlk = num(pick(s, 'bom_item_flk_id')) || null;
  let flkSwitched = false;
  if (snapFlk) {
    const item = await getItem(db, itemId);
    if (num(pick(item, 'final_flk_id')) !== snapFlk) { await db.prepare(`UPDATE bom_item SET final_flk_id=? WHERE id=?`).run(snapFlk, itemId); flkSwitched = true; }
  }
  await _cleanPendingPlaceholder(db, itemId);
  return { itemId, snapshotId, flkSwitched };
}

module.exports = { getItemDetail, addVendor, addPrice, updatePrice, deletePrice, chooseSnapshot, addFlk, chooseFlk };
