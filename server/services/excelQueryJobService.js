'use strict';
/**
 * Excel 精確查詢背景 Job 服務
 *
 * 設計動機(摘要):
 *   舊架構:chat.js LLM tool call → HTTP fetch 到 skill_runner 子程序 → DuckDB 跑 SQL。
 *   問題:多 pod 下 DB.endpoint_url race 一直把 endpoint 寫成 NULL,chat.js 拿不到
 *        本 pod localhost 之外的真實 URL → ECONNREFUSED → LLM 回「無法連線」降級訊息。
 *        + deploy 中斷 in-flight 查詢 + xlsx sync I/O 卡 event loop 被健檢誤砍。
 *   新架構:LLM tool call → submitJob → web pod 內 setImmediate worker(同 transcribeJobService
 *        pattern)→ DB lock_token + heartbeat + recovery cron。chat.js 同步等 90s,拿到結果就回
 *        LLM;超時 → 回 LLM「背景執行中」+ 完成時自動 append chat_message + push user_notification。
 *
 * Pattern 來源:server/services/transcribeJobService.js
 * Schema:server/database-oracle.js — table excel_query_jobs
 *
 * 主流程:
 *   POST → createJob() → INSERT job + 立刻 setImmediate(runJob)
 *                     ↓
 *   worker 取 lock + 啟動 heartbeat(60s)
 *                     ↓
 *   1) readXlsx(progress 0→20)  2) loadDuckDB(20→60)  3) executeSql(60→100)
 *                     ↓
 *   UPDATE result_md + status=done(失敗 → status=failed + error_msg)
 *                     ↓
 *   若 chat 端仍在 waitForResult → 同步回給 LLM
 *   若超時放棄等候(>90s)→ 完成時 INSERT chat_messages + push user_notification
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const duckdb = require('duckdb');
const XLSX = require('xlsx');

// 重要:預設值必須對齊 chat.js / transcribeJobService 用的 `path.join(__dirname, '../uploads')`,
// 不可寫死 '/app/uploads'。Windows 開發機 env 沒設時,/app/uploads 會 resolve 成 D:\app\uploads,
// 跟 chat.js 算出來的 D:\vibe_coding\foxlink_gpt\server\uploads 不一致 → startsWith 失敗 →
// 拋「拒絕讀取此路徑」→ LLM 看到 error 會合理化成「檔名特殊字元問題」誤導 user。
const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

// ─── 配置 ────────────────────────────────────────────────────────────────────
const MAX_ROWS_PER_SHEET    = 100000;
const RESULT_PREVIEW_ROWS   = 200;
const INSERT_BATCH_SIZE     = 1000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const STALE_HEARTBEAT_MIN   = 5;
const MAX_RECOVERY_COUNT    = 3;
// XLSX.readFile 對 PDF / 其他二進位也會「成功 parse」但結果是垃圾表(40000+ 列 100+ 欄),
// DuckDB load 會卡 event loop 數分鐘 → K8s liveness fail(2026-06-02 事故)。在進 XLSX 前擋。
const ALLOWED_EXCEL_EXTS = new Set(['.xlsx', '.xls', '.xlsm', '.xlsb']);
// DuckDB SQL 結構性錯誤 — retry 一定也是同樣錯,不該再 parse 一遍 xlsx 燒 CPU。
const PERMANENT_SQL_ERROR_RE = /Binder Error|Parser Error|Catalog Error|Conversion Error/i;

// 跟 transcribeJobService 一樣的 active set,SIGTERM 時 mark for recovery
const ACTIVE_JOBS = new Set();

// ─── Helpers(原 excel_query.js skill 程式碼直接搬過來)──────────────────────

function inferType(values) {
  let allNum = true, allDate = true, allBool = true, hasAny = false;
  for (const v of values) {
    if (v == null || v === '') continue;
    hasAny = true;
    if (!(typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())))) allNum = false;
    if (!(v instanceof Date)) allDate = false;
    if (typeof v !== 'boolean') allBool = false;
    if (!allNum && !allDate && !allBool) break;
  }
  if (!hasAny) return 'VARCHAR';
  if (allBool) return 'BOOLEAN';
  if (allDate) return 'TIMESTAMP';
  if (allNum) return 'DOUBLE';
  return 'VARCHAR';
}

function sanitizeIdent(s) {
  const cleaned = String(s ?? '').replace(/[^\w一-鿿]/g, '_').replace(/^(\d)/, '_$1');
  return cleaned || '_col';
}

function dedupNames(names) {
  const seen = new Map();
  return names.map(n => {
    const k = (seen.get(n) || 0) + 1;
    seen.set(n, k);
    return k === 1 ? n : `${n}_${k}`;
  });
}

// BOM / 報表類 xls 第 1 列常常是 metadata(Creator: 某人 / Title: BOM / 空白裝飾列),
// 真正的 header(Item Number / Qty / Ref Des 等)在第 N 列。死板抓 rows[0] 當 header
// 會讓 LLM 看到 col_2, col_3 不知所云,寫 SQL 必錯。
// 算法:找前 10 列中,「非空 cell ≥ max(4, width*0.5) 且 全部 cells 看起來像 header
//      (字串、無空值連續、不是純數字)」的第一列當 header。
function detectHeaderRow(rows) {
  const sampleLen = Math.min(rows.length, 10);
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < sampleLen; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const nonNull = row.filter(v => v !== null && v !== undefined && v !== '').length;
    const totalCells = row.length;
    if (totalCells === 0) continue;
    // 80% 以上非空 + 至少 4 cells + 大多是非數字 string → 強候選
    const stringCount = row.filter(v => typeof v === 'string' && v.trim() && !/^-?\d+(\.\d+)?$/.test(v.trim())).length;
    const score =
      (nonNull >= 4 ? 50 : 0) +
      (nonNull / totalCells) * 30 +
      (stringCount / Math.max(nonNull, 1)) * 20 +
      // 早出現的列加分(同樣強度優先取上面)
      (sampleLen - i) * 0.5;
    if (score > bestScore && nonNull >= 4) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function readSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  if (rows.length === 0) return { headers: [], data: [], headerRowIdx: 0 };
  const headerRowIdx = detectHeaderRow(rows);
  const headers = (rows[headerRowIdx] || []).map((h, i) => sanitizeIdent(h || `col_${i + 1}`));
  const finalHeaders = dedupNames(headers);
  const data = rows.slice(headerRowIdx + 1, MAX_ROWS_PER_SHEET + 1 + headerRowIdx);
  return { headers: finalHeaders, data, headerRowIdx };
}

function pickSheet(wb, requested) {
  if (requested) {
    const exact = wb.SheetNames.find(n => n === requested);
    if (exact) return exact;
    const fuzzy = wb.SheetNames.find(n => n.toLowerCase() === requested.toLowerCase());
    if (fuzzy) return fuzzy;
    const partial = wb.SheetNames.find(n => n.includes(requested) || requested.includes(n));
    if (partial) return partial;
    throw new Error(`找不到工作表 "${requested}"。可用:${wb.SheetNames.join(', ')}`);
  }
  for (const n of wb.SheetNames) {
    const ws = wb.Sheets[n];
    if (!ws || !ws['!ref'] || ws['!ref'] === 'A1') continue;
    const csv = XLSX.utils.sheet_to_csv(ws);
    if (csv.replace(/[,\s]/g, '').length > 0) return n;
  }
  return wb.SheetNames[0];
}

function dbAll(conn, sql, params) {
  return new Promise((resolve, reject) => {
    const cb = (err, rows) => err ? reject(err) : resolve(rows);
    if (params && params.length) conn.all(sql, ...params, cb);
    else conn.all(sql, cb);
  });
}
function dbRun(conn, sql) {
  return new Promise((resolve, reject) => conn.run(sql, (err) => err ? reject(err) : resolve()));
}

async function loadTable(conn, tableName, headers, data) {
  const types = headers.map((_, i) => inferType(data.map(r => r?.[i])));
  const colDefs = headers.map((h, i) => `"${h}" ${types[i]}`).join(', ');
  await dbRun(conn, `CREATE TABLE "${tableName}" (${colDefs})`);

  if (data.length === 0) return { types };

  const placeholders = headers.map(() => '?').join(',');
  const stmt = conn.prepare(`INSERT INTO "${tableName}" VALUES (${placeholders})`);
  try {
    for (let i = 0; i < data.length; i += INSERT_BATCH_SIZE) {
      const end = Math.min(i + INSERT_BATCH_SIZE, data.length);
      for (let j = i; j < end; j++) {
        const row = data[j];
        const vals = headers.map((_, k) => {
          const v = row?.[k];
          if (v === undefined || v === '') return null;
          if (types[k] === 'DOUBLE' && typeof v === 'string') {
            const n = parseFloat(v);
            return isNaN(n) ? null : n;
          }
          return v;
        });
        stmt.run(...vals);
      }
      if (end < data.length) await new Promise(r => setImmediate(r));
    }
  } finally {
    await new Promise((resolve) => stmt.finalize(() => resolve()));
  }
  return { types };
}

function fmtCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') {
    if (!isFinite(v)) return String(v);
    if (Number.isInteger(v)) return v.toLocaleString('en-US');
    return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/\r/g, '');
}

function rowsToMarkdown(rows) {
  if (!rows || rows.length === 0) return '_(查無資料)_';
  const cols = Object.keys(rows[0]);
  const lines = [];
  lines.push('| ' + cols.join(' | ') + ' |');
  lines.push('| ' + cols.map(() => '---').join(' | ') + ' |');

  let display = rows;
  let truncated = false;
  if (rows.length > RESULT_PREVIEW_ROWS) {
    const half = Math.floor(RESULT_PREVIEW_ROWS / 2);
    display = [...rows.slice(0, half), ...rows.slice(-half)];
    truncated = true;
  }
  for (const r of display) {
    lines.push('| ' + cols.map(c => fmtCell(r[c])).join(' | ') + ' |');
  }
  if (truncated) lines.push(`\n_共 ${rows.length} 列,顯示前 ${Math.floor(RESULT_PREVIEW_ROWS/2)} + 後 ${Math.floor(RESULT_PREVIEW_ROWS/2)} 列_`);
  return lines.join('\n');
}

// ─── createJob ───────────────────────────────────────────────────────────────

/**
 * 建 Excel 查詢 job(從 chat.js excel_query tool call 進來)
 * @param {object} db
 * @param {object} opts
 *   @param {number}  opts.userId
 *   @param {string}  opts.sessionId
 *   @param {number}  [opts.messageId]   chat_messages id(LLM 提早結束時用來 append 完成訊息)
 *   @param {string}  opts.fileName      LLM 給的 file_name(對應主表 t)
 *   @param {string}  opts.filePath      解析後實際 NFS path(已經過 attached_files 比對 + UPLOAD_ROOT 安全檢查)
 *   @param {string}  [opts.sheetName]
 *   @param {string}  opts.sql
 *   @param {Array}   [opts.extraFiles]  其他 session 內的附檔 [{name, path}, ...],會被 load 成 f1/f2/f3
 *                                       讓 LLM 在同個 DuckDB instance 內 cross-file JOIN
 * @returns {Promise<string>} jobId
 */
async function createJob(db, opts) {
  const jobId = crypto.randomUUID();
  const extraFilesJson = opts.extraFiles && opts.extraFiles.length > 0
    ? JSON.stringify(opts.extraFiles.map(f => ({ name: f.name, path: f.path })))
    : null;
  await db.prepare(`
    INSERT INTO excel_query_jobs (
      id, user_id, session_id, message_id, file_name, file_path, sheet_name, sql_text, status, extra_files_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    jobId,
    opts.userId,
    opts.sessionId || null,
    opts.messageId || null,
    opts.fileName,
    opts.filePath,
    opts.sheetName || null,
    opts.sql,
    extraFilesJson,
  );
  console.log(`[ExcelJob] created ${jobId} user=${opts.userId} file=${opts.fileName} sheet=${opts.sheetName || '(auto)'} sql.len=${opts.sql.length} extras=${opts.extraFiles?.length || 0}`);

  // 同 process setImmediate worker(跟 transcribeJobService 一致)
  setImmediate(() => runJob(db, jobId).catch(e =>
    console.error(`[ExcelJob] ${jobId} worker error:`, e.message)
  ));
  return jobId;
}

/**
 * 同步等候 job 結果,最多 maxWaitMs。
 * 達標就回 { done: true, ... },超時回 { done: false }(chat.js 用這個決定 LLM 是要拿結果還是回「背景中」)
 * @param {object} db
 * @param {string} jobId
 * @param {object} opts
 *   @param {number}   [opts.maxWaitMs=90000]
 *   @param {function} [opts.onProgress]      每次 poll 拿到進度更新時 callback({status, progress, stage})
 *   @param {number}   [opts.pollIntervalMs=800]
 */
async function waitForResult(db, jobId, opts = {}) {
  const maxWaitMs = opts.maxWaitMs ?? 90_000;
  const pollMs = opts.pollIntervalMs ?? 800;
  const deadline = Date.now() + maxWaitMs;
  let lastProgress = -1;
  let lastStage = '';

  while (Date.now() < deadline) {
    const row = await db.prepare(
      `SELECT status, progress, progress_stage, result_md, error_msg, rows_returned
       FROM excel_query_jobs WHERE id=?`
    ).get(jobId);
    if (!row) return { done: false, error: 'job not found' };

    const status = row.status || row.STATUS;
    const progress = Number(row.progress ?? row.PROGRESS ?? 0);
    const stage = row.progress_stage || row.PROGRESS_STAGE || '';

    if ((progress !== lastProgress || stage !== lastStage) && opts.onProgress) {
      try { opts.onProgress({ status, progress, stage }); } catch (_) {}
      lastProgress = progress;
      lastStage = stage;
    }

    if (status === 'done') {
      return {
        done: true,
        resultMd: row.result_md || row.RESULT_MD,
        rowsReturned: Number(row.rows_returned ?? row.ROWS_RETURNED ?? 0),
      };
    }
    if (status === 'failed') {
      return { done: true, failed: true, error: row.error_msg || row.ERROR_MSG };
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  return { done: false }; // timeout
}

// ─── SIGTERM / Recovery(對齊 transcribeJobService)──────────────────────────

async function _markJobForRecovery(db, jobId) {
  try {
    await db.prepare(`
      UPDATE excel_query_jobs SET
        lock_token = NULL,
        heartbeat_at = SYSTIMESTAMP - INTERVAL '10' MINUTE,
        updated_at = SYSTIMESTAMP
      WHERE id = ? AND status = 'running'
    `).run(jobId);
  } catch (e) {
    console.warn(`[ExcelJob] _markJobForRecovery ${jobId} error:`, e.message);
  }
}

async function gracefullyPauseActiveJobs(db) {
  const ids = Array.from(ACTIVE_JOBS);
  if (!ids.length) return;
  console.log(`[ExcelJob] SIGTERM: marking ${ids.length} active jobs for recovery`);
  for (const id of ids) {
    await _markJobForRecovery(db, id);
  }
}

async function recoverStaleJobs(db) {
  try {
    await db.prepare(`
      UPDATE excel_query_jobs SET
        status='failed',
        error_msg='已嘗試 ${MAX_RECOVERY_COUNT} 次恢復仍失敗',
        updated_at=SYSTIMESTAMP
      WHERE status='running'
        AND COALESCE(recovery_count, 0) >= ${MAX_RECOVERY_COUNT}
        AND (heartbeat_at IS NULL OR heartbeat_at < SYSTIMESTAMP - INTERVAL '${STALE_HEARTBEAT_MIN}' MINUTE)
    `).run();

    const stale = await db.prepare(`
      SELECT id, COALESCE(recovery_count, 0) AS recovery_count
      FROM excel_query_jobs
      WHERE status='running'
        AND COALESCE(recovery_count, 0) < ${MAX_RECOVERY_COUNT}
        AND (heartbeat_at IS NULL OR heartbeat_at < SYSTIMESTAMP - INTERVAL '${STALE_HEARTBEAT_MIN}' MINUTE)
    `).all();

    for (const row of stale) {
      try {
        const res = await db.prepare(`
          UPDATE excel_query_jobs SET
            recovery_count = COALESCE(recovery_count,0) + 1,
            lock_token = NULL,
            heartbeat_at = SYSTIMESTAMP,
            updated_at = SYSTIMESTAMP
          WHERE id = ? AND status = 'running'
            AND COALESCE(recovery_count, 0) = ?
            AND (heartbeat_at IS NULL OR heartbeat_at < SYSTIMESTAMP - INTERVAL '${STALE_HEARTBEAT_MIN}' MINUTE)
        `).run(row.id, row.recovery_count);

        const affected = res?.rowsAffected || res?.changes || 0;
        if (affected > 0) {
          console.log(`[ExcelJob] Recovering job ${row.id} (attempt ${row.recovery_count + 1}/${MAX_RECOVERY_COUNT})`);
          setImmediate(() => runJob(db, row.id).catch((e) =>
            console.error(`[ExcelJob] Recovery ${row.id} failed:`, e.message)
          ));
        }
      } catch (e) {
        console.warn(`[ExcelJob] Recovery ${row.id} update error:`, e.message);
      }
    }
  } catch (e) {
    console.error('[ExcelJob] recoverStaleJobs error:', e.message);
  }
}

// ─── Main worker ─────────────────────────────────────────────────────────────

async function _updateProgress(db, jobId, progress, stage) {
  try {
    await db.prepare(`
      UPDATE excel_query_jobs SET progress=?, progress_stage=?, updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(progress, stage, jobId);
  } catch (e) {
    console.warn(`[ExcelJob] ${jobId} progress update failed: ${e.message}`);
  }
}

async function runJob(db, jobId) {
  let job;
  let heartbeatTimer = null;
  let lockToken = null;
  let duckdbInstance = null;
  let duckdbConn = null;
  ACTIVE_JOBS.add(jobId);

  try {
    job = await db.prepare('SELECT * FROM excel_query_jobs WHERE id=?').get(jobId);
    if (!job) { ACTIVE_JOBS.delete(jobId); return; }

    // 1. 取 lock
    lockToken = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    await db.prepare(`
      UPDATE excel_query_jobs SET
        lock_token=?, heartbeat_at=SYSTIMESTAMP, started_at=COALESCE(started_at, SYSTIMESTAMP),
        updated_at=SYSTIMESTAMP, status='running'
      WHERE id=? AND (lock_token IS NULL OR lock_token=?)
    `).run(lockToken, jobId, lockToken);

    // 2. heartbeat
    heartbeatTimer = setInterval(async () => {
      try {
        await db.prepare(
          `UPDATE excel_query_jobs SET heartbeat_at=SYSTIMESTAMP WHERE id=? AND lock_token=?`
        ).run(jobId, lockToken);
      } catch (_) {}
    }, HEARTBEAT_INTERVAL_MS);

    const tagId = `${jobId.slice(0,8)}|${path.basename(job.file_path)}`;
    console.log(`[ExcelJob] start ${tagId} sheet=${job.sheet_name || '(auto)'} recovery_count=${job.recovery_count || 0}`);

    // 3. 解析 extra_files_json,組「要 load 的所有檔案」清單
    //    主檔 → 主 sheet 為 t,其他 sheet 為 sanitize(sheet name)
    //    extras → 每檔第一個有資料的 sheet 為 f1, f2, ...,其他 sheet 為 alias_sheet 命名
    let extraFiles = [];
    try {
      extraFiles = job.extra_files_json ? JSON.parse(job.extra_files_json) : [];
      if (!Array.isArray(extraFiles)) extraFiles = [];
    } catch (_) { extraFiles = []; }

    const allFiles = [
      { name: job.file_name, path: job.file_path, alias: 't', isMain: true },
      ...extraFiles.map((f, i) => ({ name: f.name, path: f.path, alias: `f${i + 1}`, isMain: false })),
    ];

    // 4. 對所有檔案做安全 + 存在性 + 副檔名檢查
    for (const f of allFiles) {
      let rp;
      try { rp = fs.realpathSync(f.path); }
      catch (e) { throw new Error(`檔案已被清除或不存在: ${f.name} (${f.path})`); }
      if (!rp.startsWith(UPLOAD_ROOT)) {
        throw new Error(`拒絕讀取此路徑(超出 ${UPLOAD_ROOT}): ${f.name}`);
      }
      const ext = path.extname(rp).toLowerCase();
      if (!ALLOWED_EXCEL_EXTS.has(ext)) {
        throw new Error(`不支援的檔案類型: ${f.name}(副檔名 ${ext || '(無)'} 不是 Excel)。excel_query 僅支援 ${Array.from(ALLOWED_EXCEL_EXTS).join('/')}`);
      }
      f.realPath = rp;
    }

    // 5. DuckDB instance + 對每檔讀 xlsx + 建表
    duckdbInstance = new duckdb.Database(':memory:');
    duckdbConn = duckdbInstance.connect();
    await dbRun(duckdbConn, `SET memory_limit='256MB'`);
    await dbRun(duckdbConn, `SET threads=2`);

    await _updateProgress(db, jobId, 5, 'reading_xlsx');
    const tRead = Date.now();
    const loadedSheets = [];  // { original, table, rows, columns, fileName, alias }

    for (let fi = 0; fi < allFiles.length; fi++) {
      const f = allFiles[fi];
      const fileSize = fs.statSync(f.realPath).size;
      const tFile = Date.now();
      const wb = XLSX.readFile(f.realPath, { cellDates: true });
      console.log(`[ExcelJob] ${tagId} read "${f.name}" (alias=${f.alias}) ${(fileSize/1024/1024).toFixed(2)}MB in ${Date.now()-tFile}ms, sheets=${wb.SheetNames.length}`);

      // 主檔的 pickedSheet 用 LLM 指定的 sheet_name;extras 自動選第一個有資料的
      let pickedSheet;
      try { pickedSheet = pickSheet(wb, f.isMain ? job.sheet_name : null); }
      catch (e) { throw new Error(`${f.name}: ${e.message}`); }

      // loading 階段 5→60,按檔案數 + sheet 數平均分配進度
      const baseProg = 5 + Math.round(55 * fi / allFiles.length);
      await _updateProgress(db, jobId, baseProg, 'loading_duckdb');

      for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        if (!ws || !ws['!ref'] || ws['!ref'] === 'A1') continue;
        const tSheet = Date.now();
        const { headers, data } = readSheet(ws);
        if (headers.length === 0) continue;

        // 主 sheet:用 alias 本身(t / f1 / f2);其他 sheet:alias_<sanitize_name>
        const tblName = name === pickedSheet
          ? f.alias
          : `${f.alias}_${sanitizeIdent(name)}`;
        try {
          await loadTable(duckdbConn, tblName, headers, data);
          console.log(`[ExcelJob] ${tagId} "${f.name}" sheet "${name}" → table "${tblName}": ${data.length} rows, ${headers.length} cols, ${Date.now()-tSheet}ms`);
          loadedSheets.push({
            original: name, table: tblName, rows: data.length, columns: headers,
            fileName: f.name, alias: f.alias, isMain: f.isMain && name === pickedSheet,
          });
        } catch (e) {
          console.warn(`[ExcelJob] ${tagId} Failed to load "${f.name}" sheet "${name}": ${e.message}`);
        }
      }
    }

    await _updateProgress(db, jobId, 60, 'loading_duckdb');

    if (loadedSheets.length === 0) {
      throw new Error('所有 Excel 都沒有可讀取的工作表(全部空白)');
    }

    // 6. 跑 SQL
    await _updateProgress(db, jobId, 65, 'executing_sql');
    const tSql = Date.now();
    let result;
    try {
      result = await dbAll(duckdbConn, job.sql_text);
    } catch (e) {
      // SQL 結構性錯誤 = 同樣 SQL 再 retry 也是同樣錯,不該再 parse 一遍 xlsx 燒 CPU。
      // mark recovery_count=MAX,讓 recoverStaleJobs 不會把這個 job 撿起來重跑。
      // (2026-06-02 事故:同一 job 重跑 3 次,每次 273s 卡 event loop → K8s liveness fail)
      if (PERMANENT_SQL_ERROR_RE.test(e.message)) {
        try {
          await db.prepare(`UPDATE excel_query_jobs SET recovery_count=? WHERE id=?`)
            .run(MAX_RECOVERY_COUNT, jobId);
        } catch (_) {}
      }
      const tableInfo = loadedSheets.map(s => {
        const fileTag = s.fileName ? ` [檔:${s.fileName}]` : '';
        return `  - ${s.table}${s.original !== s.table.replace(/^[tf]\d*_?/, '') ? ` (原名:${s.original})` : ''}${fileTag} — ${s.rows} 列, 欄位:${s.columns.join(', ')}`;
      }).join('\n');
      throw new Error(
        `SQL 執行失敗: ${e.message}\n` +
        `\n你下的 SQL:\n\`\`\`sql\n${job.sql_text}\n\`\`\`\n` +
        `\n可用的表(主檔=t,其他檔=f1/f2/...):\n${tableInfo}\n` +
        `\n常見原因:欄位名拼錯、引號用錯(欄位名含中文/空格用 "雙引號")、聚合沒 GROUP BY。`
      );
    }
    console.log(`[ExcelJob] ${tagId} SQL OK: ${result.length} rows in ${Date.now()-tSql}ms`);

    await _updateProgress(db, jobId, 90, 'executing_sql');

    // 7. 組 markdown 結果
    const md = rowsToMarkdown(result);
    const multiFileNote = extraFiles.length > 0
      ? ` + ${extraFiles.length} 個附檔(f1..f${extraFiles.length})`
      : '';
    const elapsed = Date.now() - (job.started_at ? new Date(job.started_at).getTime() : tRead);
    const mainSheet = loadedSheets.find(s => s.isMain);
    const allTablesNote = loadedSheets.length > 1
      ? `\n**所有 table**(主檔=t):\n` + loadedSheets.map(s =>
          `  - ${s.table} (${s.fileName} / sheet="${s.original}", ${s.rows} 列)`
        ).join('\n') + '\n'
      : '';
    const resultMd =
      `**主檔**:${job.file_name}${multiFileNote}\n` +
      `**主工作表**:${mainSheet?.original || '(unknown)'}${allTablesNote}\n` +
      `**SQL**:\n\`\`\`sql\n${job.sql_text}\n\`\`\`\n\n` +
      `**結果**(${result.length} 列, ${elapsed}ms):\n\n${md}`;

    // 8. UPDATE done
    await db.prepare(`
      UPDATE excel_query_jobs SET
        status='done', progress=100, progress_stage='done',
        rows_returned=?, result_md=?,
        completed_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(result.length, resultMd, jobId);

    console.log(`[ExcelJob] ${tagId} DONE rows=${result.length} chars=${resultMd.length}`);

    // 9. 若 chat.js 那邊已放棄等(超過 waitForResult 的 90s) → 推 user_notification + 補 chat_message
    //    判定方式:job 還沒被 notified;若 chat 還在等,它會自己 sendEvent 結果,但這支推播是兜底
    //    (假設 chat 還在,user 看不到重複內容也沒事;假設 chat 已死,user 靠通知拿到結果)
    //    => 為了避免「快查詢(< 90s) 也彈通知干擾」,只在「elapsed > 70s」時推。
    //    這是個工程取捨:elapsed 短 = chat 八成還在 stream,不打擾;elapsed 長 = chat 八成死了,要救
    if (elapsed > 70_000) {
      await _pushCompletionNotification(db, job, 'done', resultMd, result.length);
    }

  } catch (e) {
    console.error(`[ExcelJob] ${jobId} FATAL: ${e.message}`);
    try {
      await db.prepare(`
        UPDATE excel_query_jobs SET
          status='failed', error_msg=?,
          completed_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
        WHERE id=?
      `).run(String(e.message || 'unknown error').slice(0, 1900), jobId);
    } catch (_) {}
    // 失敗也推通知(若 job 跑超過 70s)
    if (job) {
      const started = job.started_at ? new Date(job.started_at).getTime() : Date.now();
      if (Date.now() - started > 70_000) {
        try { await _pushCompletionNotification(db, job, 'failed', null, 0, e.message); } catch (_) {}
      }
    }
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    ACTIVE_JOBS.delete(jobId);
    try { if (duckdbConn) duckdbConn.close(); } catch (_) {}
    try { if (duckdbInstance) duckdbInstance.close(); } catch (_) {}
  }
}

async function _pushCompletionNotification(db, job, status, resultMd, rowsReturned, errorMsg) {
  // 防重(同 job 只推一次)
  try {
    const row = await db.prepare(`SELECT is_notified FROM excel_query_jobs WHERE id=?`).get(job.id);
    if (Number(row?.is_notified ?? row?.IS_NOTIFIED ?? 0) === 1) return;
  } catch (_) {}

  // 1) 補 chat_message,讓 user 點通知連回對話時看到結果
  if (job.session_id) {
    try {
      const content = status === 'done'
        ? `📊 Excel 查詢完成(背景):${job.file_name}\n\n${resultMd}`
        : `❌ Excel 查詢失敗(背景):${job.file_name}\n\n${errorMsg || 'unknown error'}`;
      await db.prepare(
        `INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)`
      ).run(job.session_id, content);
    } catch (e) {
      console.warn(`[ExcelJob] ${job.id} append chat_message failed: ${e.message}`);
    }
  }

  // 2) 推 user_notification
  try {
    const userNotificationService = require('./userNotificationService');
    const linkUrl = job.session_id ? `/chat?session=${job.session_id}` : null;
    if (status === 'done') {
      await userNotificationService.create(db, {
        userId: job.user_id,
        type: userNotificationService.TYPE_EXCEL_QUERY_DONE,
        title: `Excel 查詢完成:${job.file_name}`,
        message: `回傳 ${rowsReturned} 列,點此回對話查看`,
        linkUrl,
        payload: {
          jobId: job.id,
          sessionId: job.session_id,
          fileName: job.file_name,
          rowsReturned,
        },
      });
    } else {
      await userNotificationService.create(db, {
        userId: job.user_id,
        type: userNotificationService.TYPE_EXCEL_QUERY_FAILED,
        title: `Excel 查詢失敗:${job.file_name}`,
        message: (errorMsg || 'unknown error').slice(0, 500),
        linkUrl,
        payload: { jobId: job.id, sessionId: job.session_id, error: errorMsg },
      });
    }
    await db.prepare(`UPDATE excel_query_jobs SET is_notified=1 WHERE id=?`).run(job.id);
  } catch (e) {
    console.warn(`[ExcelJob] ${job.id} push user_notification failed: ${e.message}`);
  }
}

// ─── Cleanup cron(> 7 天 done/failed 的 job 清掉 result_md / data_json)──────
// xlsx 原檔不在這支管(留給上傳系統);這支只清 DB 行的大欄位節省空間。
const CLEANUP_AFTER_DAYS = 7;

async function cleanupOldJobs(db) {
  try {
    const r = await db.prepare(`
      UPDATE excel_query_jobs SET
        result_md = NULL,
        result_data_json = NULL
      WHERE status IN ('done','failed')
        AND completed_at IS NOT NULL
        AND completed_at < SYSTIMESTAMP - INTERVAL '${CLEANUP_AFTER_DAYS}' DAY
        AND (result_md IS NOT NULL OR result_data_json IS NOT NULL)
    `).run();
    const affected = r?.rowsAffected || r?.changes || 0;
    if (affected > 0) {
      console.log(`[ExcelJob] cleanup: wiped result_md/data_json on ${affected} old rows (>${CLEANUP_AFTER_DAYS}d)`);
    }
  } catch (e) {
    console.error('[ExcelJob] cleanupOldJobs error:', e.message);
  }
}

module.exports = {
  createJob,
  waitForResult,
  runJob,
  recoverStaleJobs,
  gracefullyPauseActiveJobs,
  cleanupOldJobs,
  // 給 chat.js xlsx preview 用 — preview 餵 LLM 的欄位名必須跟這裡建表後一致,
  // 否則 LLM 看到 "Material Var" 但 DuckDB 實際是 Material_Var → Binder Error。
  sanitizeIdent,
  dedupNames,
};
