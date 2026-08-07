/**
 * bomWhatifService.js — What-if 試算沙盒(R2 · 競價核心)
 *
 * start:私有化 baseline(COW)→ dump 全參數快照 + 記基準 costBreakdown → 進沙盒
 * (沙盒中 UI 照常改參數(真寫 DB)+ dryRun 試算(persist:false,不落 run 歷史))
 * discard:快照寫回(5 case 表 + qty DELETE+INSERT · baseline/idl_role 還原)→ 刪快照
 * apply:刪快照(保留現值)→ caller 正式 compute
 */

const { makeLogger } = require('./logger');
const log = makeLogger('bomWhatif');

const CASE_TABLES = [
  { name: 'bom_cs_case_process', key: 'case_factory_id' },
  { name: 'bom_cs_case_idl_alloc', key: 'case_factory_id' },
  { name: 'bom_cs_case_equip_area', key: 'case_factory_id' },
  { name: 'bom_cs_case_facility', key: 'case_factory_id' },
  { name: 'bom_cs_case_consumable', key: 'case_factory_id' },
  { name: 'bom_cs_case_qty_scenario', key: 'case_factory_id', skipCols: ['scenario_id'] },   // identity PK 排除
  { name: 'bom_cs_case_config_weight', key: 'case_factory_id', skipCols: ['weight_id'] },    // B-4 加成加權
];

// 快照經 JSON 後 DATE 變 ISO 字串;還原 bind 前轉回 Date(否則 Oracle DATE 欄 ORA-01861)
const _revive = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? new Date(v) : v);
const _reviveRow = (row) => row.map(_revive);

async function _tableCols(db, table, skip = []) {
  const rows = await db.prepare(
    `SELECT column_name FROM user_tab_cols WHERE table_name=UPPER(?) AND virtual_column='NO' AND hidden_column='NO' ORDER BY column_id`,
  ).all(table);
  return rows.map((r) => String(Object.values(r)[0])).filter((c) => !skip.map((x) => x.toUpperCase()).includes(c));
}

async function _dump(db, cfId) {
  const snap = { tables: {}, baseline: null, idlRoles: [], baselineId: null };
  for (const t of CASE_TABLES) {
    const cols = await _tableCols(db, t.name, t.skipCols || []);
    const rows = await db.prepare(`SELECT ${cols.join(',')} FROM ${t.name} WHERE ${t.key}=?`).all(cfId);
    snap.tables[t.name] = { cols, rows: rows.map((r) => cols.map((c) => { const v = r[c] ?? r[c.toLowerCase()] ?? Object.entries(r).find(([k]) => k.toUpperCase() === c)?.[1]; return v === undefined ? null : v; })) };
  }
  const cfRow = await db.prepare(`SELECT baseline_id FROM bom_cs_case_factory WHERE case_factory_id=?`).get(cfId);
  const blId = cfRow && Number(Object.values(cfRow)[0]);
  snap.baselineId = blId;
  if (blId) {
    const bCols = await _tableCols(db, 'bom_factory_baseline', ['baseline_id', 'created_at', 'updated_at']);
    const b = await db.prepare(`SELECT ${bCols.join(',')} FROM bom_factory_baseline WHERE baseline_id=?`).get(blId);
    snap.baseline = { cols: bCols, row: bCols.map((c) => { const v = b?.[c] ?? b?.[c.toLowerCase()] ?? Object.entries(b || {}).find(([k]) => k.toUpperCase() === c)?.[1]; return v === undefined ? null : v; }) };
    const rCols = await _tableCols(db, 'bom_factory_idl_role', []);
    const rr = await db.prepare(`SELECT ${rCols.join(',')} FROM bom_factory_idl_role WHERE baseline_id=?`).all(blId);
    snap.idlRoles = { cols: rCols, rows: rr.map((r) => rCols.map((c) => { const v = r[c] ?? r[c.toLowerCase()] ?? Object.entries(r).find(([k]) => k.toUpperCase() === c)?.[1]; return v === undefined ? null : v; })) };
  }
  return snap;
}

async function status(db, cfId) {
  const r = await db.prepare(`SELECT base_breakdown_json, created_at FROM bom_cs_whatif_snapshot WHERE case_factory_id=?`).get(cfId).catch(() => null);
  if (!r) return { active: false };
  let base = null;
  try { base = JSON.parse(String(r.base_breakdown_json || Object.values(r)[0] || 'null')); } catch (_) { /* noop */ }
  return { active: true, baseBreakdown: base, since: r.created_at || Object.values(r)[1] };
}

async function start(db, cfId, { userId = null, ensurePrivateBaseline, baseBreakdown = null } = {}) {
  const cur = await status(db, cfId);
  if (cur.active) return { ok: true, already: true, baseBreakdown: cur.baseBreakdown };
  if (ensurePrivateBaseline) await ensurePrivateBaseline(db, cfId);   // 沙盒起手先私有化(避免沙盒中改 baseline 觸發 COW 打亂還原)
  const snap = await _dump(db, cfId);
  await db.prepare(
    `INSERT INTO bom_cs_whatif_snapshot (case_factory_id, snapshot_json, base_breakdown_json, created_by) VALUES (?,?,?,?)`,
  ).run(cfId, JSON.stringify(snap), baseBreakdown ? JSON.stringify(baseBreakdown) : null, userId);
  log.log(`whatif start cf${cfId}`);
  return { ok: true, baseBreakdown };
}

async function discard(db, cfId) {
  const r = await db.prepare(`SELECT snapshot_json FROM bom_cs_whatif_snapshot WHERE case_factory_id=?`).get(cfId);
  if (!r) { const e = new Error('無 active 沙盒'); e.status = 400; throw e; }
  const snap = JSON.parse(String(r.snapshot_json || Object.values(r)[0]));
  // 5 case 表 + qty:DELETE + INSERT 快照 rows
  for (const t of CASE_TABLES) {
    const d = snap.tables[t.name];
    if (!d) continue;
    await db.prepare(`DELETE FROM ${t.name} WHERE ${t.key}=?`).run(cfId);
    for (const row of d.rows) {
      await db.prepare(`INSERT INTO ${t.name} (${d.cols.join(',')}) VALUES (${d.cols.map(() => '?').join(',')})`).run(..._reviveRow(row));
    }
  }
  // baseline 欄 + idl_role 還原(cf 進沙盒時已私有 → 安全)
  if (snap.baseline && snap.baselineId) {
    const sets = snap.baseline.cols.map((c) => `${c}=?`).join(',');
    await db.prepare(`UPDATE bom_factory_baseline SET ${sets} WHERE baseline_id=?`).run(..._reviveRow(snap.baseline.row), snap.baselineId);
    if (snap.idlRoles?.rows) {
      await db.prepare(`DELETE FROM bom_factory_idl_role WHERE baseline_id=?`).run(snap.baselineId);
      for (const row of snap.idlRoles.rows) {
        await db.prepare(`INSERT INTO bom_factory_idl_role (${snap.idlRoles.cols.join(',')}) VALUES (${snap.idlRoles.cols.map(() => '?').join(',')})`).run(..._reviveRow(row));
      }
    }
  }
  await db.prepare(`DELETE FROM bom_cs_whatif_snapshot WHERE case_factory_id=?`).run(cfId);
  log.log(`whatif discard cf${cfId}(restored)`);
  return { ok: true, restored: true };
}

async function apply(db, cfId) {
  await db.prepare(`DELETE FROM bom_cs_whatif_snapshot WHERE case_factory_id=?`).run(cfId);
  log.log(`whatif apply cf${cfId}`);
  return { ok: true, applied: true };
}

module.exports = { status, start, discard, apply, CASE_TABLES, _tableCols };
