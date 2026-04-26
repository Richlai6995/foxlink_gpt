'use strict';

/**
 * PM ERP Sync Service — Phase 5 Track A
 *
 * 通用同步 framework:DB-driven jobs(pm_erp_sync_job)從 EBS / 任何 ai_db_sources
 * 撈資料,經 mapping_json 轉成本地 PM 表的 row,upsert 寫入。
 *
 * Job 生命週期:
 *   1. cron tick(每 5 min)→ 找 active jobs WHERE last_run + interval <= now
 *   2. runJob(job):
 *      a. getPool(job.source_db_id || ERP env)
 *      b. conn.execute(source_query, binds)
 *      c. for each row:apply mapping_json → 組 INSERT/UPDATE 對 target_pm_table
 *      d. dry_run=1 → 只 log 樣本,不真寫
 *      e. 寫 pm_erp_sync_log
 *
 * Mapping format(mapping_json):
 *   { "ERP_COL_NAME": "pm_col_name", ... }
 *   {} 空 = 直接用 ERP 欄位名(全部 lowercase)當 PM 欄位名
 *
 * upsert_mode:
 *   - insert:純 INSERT(row 已存在會炸)
 *   - upsert:用 upsert_keys 判斷 → 存在則 UPDATE,不存在則 INSERT
 *   - truncate_insert:每次先 DELETE FROM target,再 INSERT(適用全表 snapshot)
 */

const TICK_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 4 * 60 * 1000;
const MAX_ROWS_PER_JOB = 100000;        // 安全上限

let _interval = null;

function startErpSyncCron() {
  console.log('[PmErpSync] Starting cron — checks every 5 min');
  setTimeout(() => tick().catch(e => console.error('[PmErpSync] initial:', e.message)), FIRST_RUN_DELAY_MS);
  _interval = setInterval(
    () => tick().catch(e => console.error('[PmErpSync] tick:', e.message)),
    TICK_INTERVAL_MS,
  );
}

function stopErpSyncCron() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

async function tick() {
  const db = require('../database-oracle').db;
  if (!db) return;

  const jobs = await db.prepare(`
    SELECT * FROM pm_erp_sync_job
    WHERE is_active = 1
      AND (last_run_at IS NULL
        OR last_run_at < SYSDATE - (schedule_interval_minutes / 1440))
    ORDER BY id
  `).all();

  if (!jobs || jobs.length === 0) return;
  console.log(`[PmErpSync] tick — ${jobs.length} job(s) due`);

  for (const job of jobs) {
    try {
      await runJob(db, job);
    } catch (e) {
      console.error(`[PmErpSync] job#${job.id} "${job.name}" failed:`, e.message);
    }
  }
}

/**
 * Run a single sync job. options.forceDryRun overrides job.is_dry_run(給 preview 用)
 */
async function runJob(db, job, options = {}) {
  const startedAt = new Date();
  const startMs = Date.now();
  const dryRun = options.forceDryRun ? true : Number(job.is_dry_run) === 1;

  let logId = null;
  try {
    const ins = await db.prepare(`
      INSERT INTO pm_erp_sync_log (job_id, started_at, status, rows_fetched, rows_synced)
      VALUES (?, SYSTIMESTAMP, 'running', 0, 0)
    `).run(job.id);
    // get the inserted log id (Oracle IDENTITY)
    const lastLog = await db.prepare(`SELECT MAX(id) AS id FROM pm_erp_sync_log WHERE job_id = ?`).get(job.id);
    logId = lastLog?.id || lastLog?.ID || null;
  } catch { /* log failure should not block job */ }

  let result;
  try {
    result = await executeJob(db, job, dryRun);
  } catch (err) {
    await finalizeLog(db, logId, {
      status: 'fail',
      duration_ms: Date.now() - startMs,
      error_msg: (err.message || String(err)).slice(0, 4000),
    });
    await db.prepare(`
      UPDATE pm_erp_sync_job
      SET last_run_at = SYSTIMESTAMP, last_status = 'fail',
          last_rows_synced = 0, last_error = ?
      WHERE id = ?
    `).run((err.message || String(err)).slice(0, 1900), job.id);
    throw err;
  }

  await finalizeLog(db, logId, {
    status: dryRun ? 'dry_run' : 'success',
    duration_ms: Date.now() - startMs,
    rows_fetched: result.rowsFetched,
    rows_synced: result.rowsSynced,
    sample_row: result.sampleRow ? JSON.stringify(result.sampleRow).slice(0, 4000) : null,
  });

  await db.prepare(`
    UPDATE pm_erp_sync_job
    SET last_run_at = SYSTIMESTAMP, last_status = ?,
        last_rows_synced = ?, last_error = NULL,
        last_modified = SYSTIMESTAMP
    WHERE id = ?
  `).run(dryRun ? 'dry_run' : 'success', result.rowsSynced, job.id);

  console.log(`[PmErpSync] job#${job.id} "${job.name}" ${dryRun ? '[DRY-RUN]' : ''} — fetched=${result.rowsFetched}, synced=${result.rowsSynced} in ${Date.now() - startMs}ms`);
  return { ok: true, dryRun, ...result };
}

async function finalizeLog(db, logId, fields) {
  if (!logId) return;
  try {
    await db.prepare(`
      UPDATE pm_erp_sync_log
      SET finished_at = SYSTIMESTAMP, status = ?, duration_ms = ?,
          rows_fetched = NVL(?, 0), rows_synced = NVL(?, 0),
          error_msg = ?, sample_row = ?
      WHERE id = ?
    `).run(
      fields.status,
      fields.duration_ms || null,
      fields.rows_fetched ?? null,
      fields.rows_synced ?? null,
      fields.error_msg || null,
      fields.sample_row || null,
      logId,
    );
  } catch (e) { console.warn('[PmErpSync] finalizeLog:', e.message); }
}

/**
 * 跑單一 job 的核心邏輯。回 { rowsFetched, rowsSynced, sampleRow, previewRows? }
 */
async function executeJob(db, job, dryRun, previewLimit = null) {
  // 1. 取對應的 source pool
  const { getErpPool, getPoolBySourceId } = require('./dashboardService');
  const pool = job.source_db_id
    ? await getPoolBySourceId(job.source_db_id, db)
    : await getErpPool();

  // 2. parse query + binds
  const sourceQuery = job.source_query;
  let binds = [];
  if (job.bind_params_json) {
    try { binds = JSON.parse(job.bind_params_json); } catch (e) { throw new Error(`bind_params_json 不是合法 JSON: ${e.message}`); }
    if (!Array.isArray(binds)) throw new Error('bind_params_json 必須為 array');
  }

  // 3. 執行 SELECT 從 ERP
  const conn = await pool.getConnection();
  let rows = [];
  let columnNames = [];
  try {
    const r = await conn.execute(sourceQuery, binds, { outFormat: require('oracledb').OUT_FORMAT_OBJECT });
    rows = r.rows || [];
    columnNames = (r.metaData || []).map(m => m.name);
  } finally {
    try { await conn.close(); } catch {}
  }

  if (rows.length > MAX_ROWS_PER_JOB) {
    throw new Error(`ERP 回傳 ${rows.length} > ${MAX_ROWS_PER_JOB} 上限,query 加 WHERE 縮範圍或拆 job`);
  }

  // 4. apply mapping
  let mapping = {};
  try { mapping = JSON.parse(job.mapping_json || '{}'); } catch (e) { throw new Error(`mapping_json 不是合法 JSON: ${e.message}`); }

  const mappedRows = rows.map(r => transformRow(r, mapping));
  if (previewLimit) {
    return { rowsFetched: rows.length, rowsSynced: 0, sampleRow: rows[0] || null, previewRows: rows.slice(0, previewLimit), columnNames };
  }
  if (dryRun) {
    return { rowsFetched: rows.length, rowsSynced: 0, sampleRow: mappedRows[0] || null };
  }
  if (mappedRows.length === 0) {
    return { rowsFetched: 0, rowsSynced: 0, sampleRow: null };
  }

  // 5. truncate_insert mode → DELETE 全表(限 PM_* 開頭表名,double protection)
  if (job.upsert_mode === 'truncate_insert') {
    const tName = String(job.target_pm_table || '').toLowerCase();
    if (!/^pm_[a-z_]+$/.test(tName)) throw new Error(`truncate_insert 限 pm_* 表,target=${tName}`);
    await db.prepare(`DELETE FROM ${tName}`).run();
  }

  // 6. write to target_pm_table
  let synced = 0;
  for (const row of mappedRows) {
    try {
      await writeRow(db, job, row);
      synced++;
    } catch (e) {
      console.warn(`[PmErpSync] job#${job.id} row write failed:`, e.message);
    }
  }
  return { rowsFetched: rows.length, rowsSynced: synced, sampleRow: mappedRows[0] || null };
}

/**
 * 把 ERP row(Oracle 預設大寫 column)透過 mapping 轉成 PM row
 * mapping = { "ERP_COL": "pm_col" }
 * 若 mapping 為空 {},直接全部 lowercase 當 PM col
 */
function transformRow(erpRow, mapping) {
  const out = {};
  if (!mapping || Object.keys(mapping).length === 0) {
    for (const [k, v] of Object.entries(erpRow || {})) {
      out[String(k).toLowerCase()] = v;
    }
    return out;
  }
  // upper-case both key sets to handle case-insensitive Oracle
  const upperRow = {};
  for (const [k, v] of Object.entries(erpRow || {})) upperRow[String(k).toUpperCase()] = v;
  for (const [erpCol, pmCol] of Object.entries(mapping)) {
    out[pmCol] = upperRow[String(erpCol).toUpperCase()];
  }
  return out;
}

async function writeRow(db, job, row) {
  const targetTable = String(job.target_pm_table || '').toLowerCase();
  if (!/^pm_[a-z_]+$/.test(targetTable)) throw new Error(`target_pm_table 必須 pm_* 開頭`);
  const cols = Object.keys(row);
  if (cols.length === 0) return;
  const values = cols.map(c => row[c]);

  if (job.upsert_mode === 'upsert' && job.upsert_keys) {
    // MERGE-style upsert
    const keys = String(job.upsert_keys).split(',').map(s => s.trim()).filter(Boolean);
    const nonKeys = cols.filter(c => !keys.includes(c));
    const usingCols = cols.map((c, i) => `? AS ${c}`).join(', ');
    const onClause = keys.map(k => `t.${k} = src.${k}`).join(' AND ');
    const setClause = nonKeys.map(c => `t.${c} = src.${c}`).join(', ');
    const insertCols = cols.join(', ');
    const insertVals = cols.map(c => `src.${c}`).join(', ');
    const sql = `
      MERGE INTO ${targetTable} t
      USING (SELECT ${usingCols} FROM dual) src
      ON (${onClause})
      ${nonKeys.length > 0 ? `WHEN MATCHED THEN UPDATE SET ${setClause}` : ''}
      WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})
    `;
    await db.prepare(sql).run(...values);
  } else {
    // 純 INSERT(insert / truncate_insert)
    const placeholders = cols.map(() => '?').join(', ');
    await db.prepare(`INSERT INTO ${targetTable} (${cols.join(', ')}) VALUES (${placeholders})`).run(...values);
  }
}

/** Preview 用:跑 SELECT 但不寫入,回前 N row */
async function previewJob(db, job, limit = 10) {
  const ret = await executeJob(db, job, true, limit);
  return ret;
}

module.exports = {
  startErpSyncCron,
  stopErpSyncCron,
  runJob,
  previewJob,
  tick,
};
