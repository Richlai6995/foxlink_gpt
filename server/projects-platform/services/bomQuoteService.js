/**
 * bomQuoteService.js — 報價定版/送審(獨立 service)
 *
 * 對應 docs/cortex-bom-import-plan.md(定版/送審 · 流程終點)。
 * 送審:快照某廠最新 run 的單價(+ NRE)成一個 version(SUBMITTED)。
 * 核准:APPROVED = 官方報價 · 鎖 case_factory · 舊 APPROVED supersede。
 * 純寫 013m + 讀 run_result/NRE;細粒度審批權限 = S2。
 */

const num = (v) => (typeof v === 'number' ? v : (v == null || v === '' ? 0 : Number(v) || 0));
const pick = (row, name) => { if (!row) return undefined; const lc = name.toLowerCase(); for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k]; return undefined; };
const lc = (row) => { const o = {}; if (row) for (const k of Object.keys(row)) o[k.toLowerCase()] = row[k]; return o; };

/** 送審:快照某廠最新 run → SUBMITTED version */
async function submitQuote(db, { projectId, caseFactoryId, note = null, userId = null }) {
  if (!projectId || !caseFactoryId) throw new Error('projectId + caseFactoryId required');
  const row = await db.prepare(
    `SELECT cf.factory_code, cf.costing_model, r.run_id,
            rr.total_quote_usd, rr.total_true_usd, rr.nre_per_unit_quote_usd, rr.nre_per_unit_true_usd
       FROM bom_cs_case_factory cf
       LEFT JOIN bom_cs_run r ON r.run_id = (SELECT MAX(run_id) FROM bom_cs_run WHERE case_factory_id = cf.case_factory_id)
       LEFT JOIN bom_cs_run_result rr ON rr.run_id = r.run_id
      WHERE cf.case_factory_id = ? AND cf.case_id = ?`,
  ).get(caseFactoryId, projectId);
  if (!row) throw new Error('case_factory not found for project');
  const runId = pick(row, 'run_id');
  if (!runId) throw new Error('此廠尚未計算成本,無法定版');

  const unitQuote = num(pick(row, 'total_quote_usd')) + num(pick(row, 'nre_per_unit_quote_usd'));
  const unitTrue = num(pick(row, 'total_true_usd')) + num(pick(row, 'nre_per_unit_true_usd'));
  const nreCfg = await require('./bomNreService').getConfig(db, projectId);
  const nreRoll = await require('./bomNreService').rollupNre(db, projectId);
  const nreSeparate = nreCfg.nreMode === 'SEPARATE' ? nreRoll.totalQuote : 0;

  const vm = await db.prepare(`SELECT NVL(MAX(version_no),0) AS v FROM bom_quote_version WHERE project_id=?`).get(projectId);
  const versionNo = num(pick(vm, 'v')) + 1;

  // bind 必須綁 .run(...)(wrapper prepare(sql) 只吃 sql · 見 database-oracle.js:183)
  await db.prepare(
    `INSERT INTO bom_quote_version (project_id, version_no, case_factory_id, factory_code, run_id, status,
       unit_quote_usd, unit_true_usd, nre_total_quote_usd, nre_mode, costing_model, note, submitted_by)
     VALUES (?,?,?,?,?,'SUBMITTED',?,?,?,?,?,?,?)`,
  ).run(
    projectId, versionNo, caseFactoryId, pick(row, 'factory_code'), num(runId),
    unitQuote, unitTrue, nreSeparate, nreCfg.nreMode, pick(row, 'costing_model'), note, userId,
  );
  return { versionNo, factoryCode: pick(row, 'factory_code'), unitQuote, unitTrue, nreSeparate, nreMode: nreCfg.nreMode };
}

/** 核准:APPROVED = 官方 · 鎖 case_factory · 舊 APPROVED → SUPERSEDED
 *  職責分離:不可核准自己送審的版本(admin 可覆寫)· 細粒度「誰能核准」角色 = S2 三軸 RBAC */
async function approveQuote(db, { versionId, userId = null, isAdmin = false }) {
  const v = await db.prepare(`SELECT id, project_id, case_factory_id, status, submitted_by FROM bom_quote_version WHERE id=?`).get(versionId);
  if (!v) throw new Error('version not found');
  const submittedBy = pick(v, 'submitted_by');
  if (submittedBy != null && userId != null && Number(submittedBy) === Number(userId) && !isAdmin) {
    const e = new Error('不可核准自己送審的版本 — 需由另一人(主管 / DPM)核准');
    e.code = 'SELF_APPROVAL_BLOCKED';
    throw e;
  }
  const pid = num(pick(v, 'project_id'));
  await db.prepare(`UPDATE bom_quote_version SET status='SUPERSEDED' WHERE project_id=? AND status='APPROVED' AND id<>?`).run(pid, versionId);
  await db.prepare(`UPDATE bom_quote_version SET status='APPROVED', approved_by=?, approved_at=SYSTIMESTAMP WHERE id=?`).run(userId, versionId);
  const cfid = pick(v, 'case_factory_id');
  if (cfid) { try { await db.prepare(`UPDATE bom_cs_case_factory SET status='locked', locked_by=?, locked_at=SYSTIMESTAMP WHERE case_factory_id=?`).run(userId, cfid); } catch (_) {} }
  return { approved: num(versionId), projectId: pid };
}

/** 作廢一個 version(admin 解鎖 · SUPERSEDED)*/
async function supersedeQuote(db, versionId) {
  await db.prepare(`UPDATE bom_quote_version SET status='SUPERSEDED' WHERE id=?`).run(versionId);
  return { superseded: num(versionId) };
}

/** 列版本歷史 + 當前官方(APPROVED)*/
async function listQuotes(db, projectId) {
  const rows = await db.prepare(
    `SELECT v.id, v.version_no, v.case_factory_id, v.factory_code, v.run_id, v.status,
            v.unit_quote_usd, v.unit_true_usd, v.nre_total_quote_usd, v.nre_mode, v.costing_model, v.note,
            v.submitted_by, v.submitted_at, v.approved_by, v.approved_at,
            su.name AS submitted_by_name, au.name AS approved_by_name
       FROM bom_quote_version v
       LEFT JOIN users su ON su.id = v.submitted_by
       LEFT JOIN users au ON au.id = v.approved_by
      WHERE v.project_id=? ORDER BY v.version_no DESC`,
  ).all(projectId).catch(() => []);
  const versions = rows.map(lc);
  const official = versions.find((v) => v.status === 'APPROVED') || null;
  return { projectId: num(projectId), versions, official };
}

module.exports = { submitQuote, approveQuote, supersedeQuote, listQuotes };
