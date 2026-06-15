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
 * 2026-06-13 CrashLoop 事故修正:
 *   parse(XLSX.readFile / sheet_to_json)+ DuckDB load + SQL 原本同步跑在主執行緒,多 sheet 大檔
 *   卡死 event loop → liveness 逾時 → kubelet SIGKILL(137/Error)→ recovery 重跑同檔 → CrashLoop。
 *   ④ 把整段搬進 worker_thread(excelQueryWorker.js),主執行緒只留 DB bookkeeping。
 *   ③ 再加 re-run fail-fast:背景重試遇大檔直接放棄,毒藥檔不再反覆重跑打掛服務。
 *
 * Pattern 來源:server/services/transcribeJobService.js
 * Schema:server/database-oracle.js — table excel_query_jobs
 * 純函式 helper:server/services/excelQueryUtils.js;parse worker:server/services/excelQueryWorker.js
 *
 * 主流程:
 *   POST → createJob() → INSERT job + 立刻 setImmediate(runJob)
 *                     ↓
 *   worker 取 lock + 啟動 heartbeat(60s)+ 安全檢查
 *                     ↓
 *   spawn worker_thread:1) readXlsx 2) loadDuckDB 3) executeSql(progress 回拋主執行緒)
 *                     ↓
 *   UPDATE result_md + status=done(失敗 → status=failed + error_msg)
 *                     ↓
 *   若 chat 端仍在 waitForResult → 同步回給 LLM
 *   若超時放棄等候(>90s)→ 完成時 INSERT chat_messages + push user_notification
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');

// parse / load / SQL 跑在 excelQueryWorker.js(forked **child_process**,2026-06-15 由 worker_thread 改:
// worker_thread 限不到 DuckDB/SheetJS 的 native 記憶體、又與主程序同 cgroup,native 爆 = pod 倒;
// 改子程序 + 子程序 oom_score_adj=1000 → cgroup 壓力時只砍子程序、主服務存活、pod 不倒)。
// 主執行緒不再 require duckdb/xlsx、不在 event loop 做同步 parse。純函式共用見 excelQueryUtils。
const { sanitizeIdent, dedupNames } = require('./excelQueryUtils');

// 重要:預設值必須對齊 chat.js / transcribeJobService 用的 `path.join(__dirname, '../uploads')`,
// 不可寫死 '/app/uploads'。Windows 開發機 env 沒設時,/app/uploads 會 resolve 成 D:\app\uploads,
// 跟 chat.js 算出來的 D:\vibe_coding\foxlink_gpt\server\uploads 不一致 → startsWith 失敗 →
// 拋「拒絕讀取此路徑」→ LLM 看到 error 會合理化成「檔名特殊字元問題」誤導 user。
const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

// ─── 配置 ────────────────────────────────────────────────────────────────────
const HEARTBEAT_INTERVAL_MS = 60_000;
const STALE_HEARTBEAT_MIN   = 5;
const MAX_RECOVERY_COUNT    = 3;
// XLSX.readFile 對 PDF / 其他二進位也會「成功 parse」但結果是垃圾表(40000+ 列 100+ 欄),
// DuckDB load 會卡數分鐘 → K8s liveness fail(2026-06-02 事故)。在丟進 worker 前擋。
const ALLOWED_EXCEL_EXTS = new Set(['.xlsx', '.xls', '.xlsm', '.xlsb']);

// ③ re-run fail-fast(2026-06-13 CrashLoop 事故):背景重試(recovery_count≥1)時對大檔直接放棄,
// 不再丟進 worker 重 parse。即使 parse 已隔離 event loop,毒藥檔反覆重跑仍可能讓 worker native
// buffer 堆爆 cgroup OOM,且每次重跑都浪費資源。一個檔不該打掛服務多次。
const RERUN_FAILFAST_RECOVERY = 1;            // 第 1 次 recovery 起就套用
const RERUN_FAILFAST_BYTES = 8 * 1024 * 1024; // 合計 > 8MB 視為大檔

// 子程序記憶體防線(pod-aware)。真正的 pod-crash 硬保證來自 child_process 的 oom_score_adj=1000
// (見 excelQueryWorker.js)— cgroup 壓力時 kernel 砍子程序、不砍主服務。以下是「讓子程序盡量在自己
// 範圍內優雅失敗、少觸發 cgroup 壓力」的輔助上限,非 pod 存活的唯一依賴:
//   CHILD_HEAP_MB     → fork execArgv --max-old-space-size,V8 heap 爆時子程序乾淨退
//   DUCKDB_MEM_LIMIT  → 傳進子程序給 DuckDB SET memory_limit(限 native arena)
// web pod 2Gi / scheduler pod 3Gi;大檔已路由到 scheduler,那邊給較大值。
const IS_SCHEDULER_POD = process.env.RUN_SCHEDULERS === 'true';
const CHILD_HEAP_MB = Number(process.env.EXCEL_CHILD_HEAP_MB) || (IS_SCHEDULER_POD ? 1024 : 512);
const DUCKDB_MEM_LIMIT = process.env.EXCEL_DUCKDB_MEM_LIMIT || (IS_SCHEDULER_POD ? '256MB' : '192MB');

// ── 大檔路由(2026-06-15 follow-up:避免過大 excel 撐爆 web pod)──────────────────
// web pod(2Gi、又要扛 SSE chat)不該做重 parse。三層分流:
//   ≤ INLINE          → web 本地 inline 跑(快、互動體驗不變)
//   INLINE ~ ABSOLUTE → web 不 spawn、留 pending,交給 scheduler(3Gi、無 SSE)背景撿來跑(runPendingJobs)
//   > ABSOLUTE        → 直接拒(連 scheduler 都別撐),回清楚訊息給 LLM
const LOCAL_INLINE_MAX_BYTES = Number(process.env.EXCEL_INLINE_MAX_BYTES) || 5 * 1024 * 1024;
const ABSOLUTE_MAX_BYTES = Number(process.env.EXCEL_ABSOLUTE_MAX_BYTES) || 50 * 1024 * 1024;
// scheduler poller 只撿「夠老」的 pending,避免搶到 web 正要 inline 的小檔(web inline 會先把它 claim 成
// running,poller 只看 pending,雙保險)。
const PENDING_POLL_AGE_SEC = Number(process.env.EXCEL_PENDING_POLL_AGE_SEC) || 5;
// pending 太久沒被撿(scheduler 掛掉/重啟空窗)→ 標 failed + 推鈴鐺,避免使用者等永不響的鈴。
const PENDING_MAX_AGE_MIN = Number(process.env.EXCEL_PENDING_MAX_AGE_MIN) || 20;

// 全域(per-process)worker 並發上限。web pod 2Gi 只容得下 1 個 worker 同時跑,所以預設 1:
// 多餘的 job(recovery 一次撿多個 stale、或多使用者同時 excel_query)排隊等,不並發 spawn → 不會
// 疊加 worker heap 把 pod cgroup OOM。chat 端 waitForResult 有 90s 容忍,排隊可接受。
const MAX_CONCURRENT_WORKERS = Number(process.env.EXCEL_WORKER_CONCURRENCY) || 1;

// worker wall-clock 逾時:防壞掉/失控的 parse 或 SQL 永遠不 exit。沒這個的話 main heartbeat 會一直
// 刷新(event loop 已不被卡)→ recoverStaleJobs 的 stale 判定永遠不成立 → job 卡 'running' 殭屍 +
// 洩漏 worker thread + 使用者等永不響的鈴。逾時 → terminate worker + 標 failed(__permanentSql 不重跑)。
const WORKER_TIMEOUT_MS = Number(process.env.EXCEL_WORKER_TIMEOUT_MS) || 8 * 60 * 1000;

// 跟 transcribeJobService 一樣的 active set,SIGTERM 時 mark for recovery
const ACTIVE_JOBS = new Set();

// ── 全域 worker 並發閘門(per-process semaphore)──────────────────────────────
// 限制同時運行的 excel parse worker 數量,避免並發 worker heap 疊加把 pod cgroup OOM。
let _activeWorkers = 0;
const _workerWaiters = [];
function _acquireWorkerSlot() {
  if (_activeWorkers < MAX_CONCURRENT_WORKERS) {
    _activeWorkers++;
    return Promise.resolve();
  }
  return new Promise((resolve) => _workerWaiters.push(resolve)); // 排隊,slot 數維持滿載
}
function _releaseWorkerSlot() {
  const next = _workerWaiters.shift();
  if (next) next(); // 把 slot 直接交給排隊者,_activeWorkers 不變
  else _activeWorkers = Math.max(0, _activeWorkers - 1);
}

// 合計主檔 + extraFiles 的位元組(用於大檔路由)。async fs.promises 並行 stat,避免在 web 主執行緒
// 同步戳 NFS。回 { total, anyFailed }:anyFailed=true(檔案還沒 flush 到 NFS / 暫時讀不到)時,
// caller 必須保守路由(別把可能很大的檔當小檔 inline 跑),否則 stat 失敗當 0 會誤判成小檔。
async function _statTotalBytes(filePath, extraFiles) {
  const paths = [filePath, ...((extraFiles || []).map((f) => f && f.path))].filter(Boolean);
  let total = 0;
  let anyFailed = false;
  const sizes = await Promise.all(paths.map((p) =>
    fs.promises.stat(p).then((s) => s.size).catch(() => { anyFailed = true; return 0; })
  ));
  for (const s of sizes) total += s;
  return { total, anyFailed };
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
  // 大檔路由 step 0:超過絕對上限直接拒,連 job row 都不建(連 scheduler 都別撐)。
  const { total: totalBytes, anyFailed: sizeUnknown } = await _statTotalBytes(opts.filePath, opts.extraFiles);
  if (totalBytes > ABSOLUTE_MAX_BYTES) {
    throw new Error(
      `Excel 檔過大(合計 ${(totalBytes / 1024 / 1024).toFixed(1)}MB,上限 ${Math.round(ABSOLUTE_MAX_BYTES / 1024 / 1024)}MB)。` +
      `請拆分工作表、移除不需要的欄位/sheet 或縮小檔案後再查詢。`
    );
  }

  // Dedupe:同 user + 同檔 + 同 SQL 已經有 pending/running 的 job,直接重用,不再建新。
  // 2026-06-05 事件:user 等不及又按了一次,同個 7.96MB xlsx 兩個 worker 同時 parse → CPU 爆。
  // 撈最近 30 分鐘候選(候選通常 < 5 筆,JS 比 sql_text 字串很快),不會掃全表。
  try {
    const candidates = await db.prepare(`
      SELECT id, sql_text FROM excel_query_jobs
      WHERE user_id = ?
        AND file_path = ?
        AND COALESCE(sheet_name, '') = COALESCE(?, '')
        AND status IN ('pending', 'running')
        AND created_at > SYSTIMESTAMP - INTERVAL '30' MINUTE
    `).all(opts.userId, opts.filePath, opts.sheetName || null);
    const match = (candidates || []).find(r => (r.sql_text || r.SQL_TEXT) === opts.sql);
    if (match) {
      const reusedId = match.id || match.ID;
      console.log(`[ExcelJob] dedupe hit → reusing ${reusedId} for user=${opts.userId} file=${opts.fileName}`);
      return reusedId;
    }
  } catch (e) {
    console.warn(`[ExcelJob] dedupe check failed (continuing to create new): ${e.message}`);
  }

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
  const sizeMB = (totalBytes / 1024 / 1024).toFixed(1);
  console.log(`[ExcelJob] created ${jobId} user=${opts.userId} file=${opts.fileName} sheet=${opts.sheetName || '(auto)'} sql.len=${opts.sql.length} extras=${opts.extraFiles?.length || 0} size=${sizeMB}MB`);

  // 大檔路由:小檔本地 inline 跑;大檔(或大小未知 = 保守當大檔)留 pending 交給 scheduler(3Gi、
  // 無 SSE)背景跑,避免撐爆 web pod。sizeUnknown(NFS 還沒 flush / 暫讀不到)走 defer,不冒險 inline。
  if (!sizeUnknown && totalBytes <= LOCAL_INLINE_MAX_BYTES) {
    // 小檔本地跑:先 atomic claim 成 running(scheduler poller 只撿 pending → 不會搶走重跑)。
    // 只有 claim 成功(rowsAffected>0)才 setImmediate(runJob);claim 沒中(0 row,理論上不會,
    // 防 race)就留 pending 讓 poller 撿,避免「claim 失敗卻照跑」變成跨 pod 雙跑。
    let claimed = 0;
    try {
      const r = await db.prepare(
        `UPDATE excel_query_jobs SET status='running', heartbeat_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
         WHERE id=? AND status='pending'`
      ).run(jobId);
      claimed = r?.rowsAffected || r?.changes || 0;
    } catch (e) {
      console.warn(`[ExcelJob] ${jobId} inline claim failed: ${e.message}`);
    }
    if (claimed > 0) {
      setImmediate(() => runJob(db, jobId).catch(e =>
        console.error(`[ExcelJob] ${jobId} worker error:`, e.message)
      ));
    } else {
      console.log(`[ExcelJob] ${jobId} inline claim 沒中 → 留 pending 交給 scheduler`);
    }
  } else {
    const why = sizeUnknown ? '檔案大小未知' : `${sizeMB}MB > ${Math.round(LOCAL_INLINE_MAX_BYTES / 1024 / 1024)}MB inline 上限`;
    console.log(`[ExcelJob] ${jobId} deferred to scheduler (${why})— 留 pending 等 scheduler 背景撿`);
  }
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
  // 不要把 heartbeat 設成「10 分鐘前」立刻變 stale — 那會讓新 pod 在 SIGTERM 後立刻撿走 job,
  // 但舊 pod 還在 graceful shutdown 60s 內可能繼續處理 → 兩顆 pod 同時跑同一個 job(2026-06-05 事件)。
  // 設成「現在」讓 recoverStaleJobs 等 STALE_HEARTBEAT_MIN(5 min)後才認為失蹤,
  // 期間舊 pod 60s graceful 自然結束 / 完成 job → 新舊不重疊。
  // 代價:job 在 deploy 後最多卡 5 分鐘才被撿回來重跑(可接受 — 比並發雪崩好太多)。
  try {
    await db.prepare(`
      UPDATE excel_query_jobs SET
        lock_token = NULL,
        heartbeat_at = SYSTIMESTAMP,
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

// 撿被 web pod 刻意 defer 的大檔(status='pending' 且夠老)→ 在 scheduler(3Gi、無 SSE)上跑。
// 只有 scheduler 跑這支(server.js gated on RUN_SCHEDULERS),所以同一個 deferred job 只會被一個
// pod 撿;atomic claim(pending→running + rowsAffected 檢查)再擋住自己重疊 tick 的雙撿。
// 注意:web inline 的小檔在 createJob 已被 claim 成 'running',poller 只看 'pending' → 不會被搶。
async function runPendingJobs(db) {
  try {
    // 0. 過老的 pending(scheduler 曾掛掉/重啟空窗沒撿到)→ 標 failed + 推鈴鐺,
    //    別讓使用者等永不響的鈴(chat 端早已回「背景中,完成會通知」)。
    try {
      const stale = await db.prepare(`
        SELECT * FROM excel_query_jobs
        WHERE status='pending'
          AND created_at < SYSTIMESTAMP - INTERVAL '${PENDING_MAX_AGE_MIN}' MINUTE
      `).all();
      for (const j of (stale || [])) {
        const id = j.id || j.ID;
        const res = await db.prepare(`
          UPDATE excel_query_jobs SET status='failed',
            error_msg='deferred Excel job 逾期未被排程執行(scheduler 不可用?),已中止',
            completed_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
          WHERE id=? AND status='pending'
        `).run(id);
        if ((res?.rowsAffected || res?.changes || 0) > 0) {
          console.warn(`[ExcelJob] aged-out pending job ${id} (>${PENDING_MAX_AGE_MIN}min) → failed + notify`);
          try {
            const job = { id, session_id: j.session_id || j.SESSION_ID, user_id: j.user_id || j.USER_ID, file_name: j.file_name || j.FILE_NAME };
            await _pushCompletionNotification(db, job, 'failed', null, 0, '查詢逾期未被執行(系統忙碌),請重試');
          } catch (_) {}
        }
      }
    } catch (e) {
      console.warn('[ExcelJob] aged-pending sweep error:', e.message);
    }

    const rows = await db.prepare(`
      SELECT id FROM excel_query_jobs
      WHERE status='pending'
        AND created_at < SYSTIMESTAMP - INTERVAL '${PENDING_POLL_AGE_SEC}' SECOND
    `).all();

    for (const row of rows) {
      const id = row.id || row.ID;
      try {
        // atomic claim:只有把 pending → running 成功的那一個才執行(擋重疊 tick)
        const res = await db.prepare(`
          UPDATE excel_query_jobs SET
            status='running', heartbeat_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
          WHERE id=? AND status='pending'
        `).run(id);
        const affected = res?.rowsAffected || res?.changes || 0;
        if (affected > 0) {
          console.log(`[ExcelJob] picking up deferred job ${id} (scheduler)`);
          setImmediate(() => runJob(db, id).catch((e) =>
            console.error(`[ExcelJob] deferred run ${id} failed:`, e.message)
          ));
        }
      } catch (e) {
        console.warn(`[ExcelJob] runPendingJobs claim ${id} error:`, e.message);
      }
    }
  } catch (e) {
    console.error('[ExcelJob] runPendingJobs error:', e.message);
  }
}

// ─── Main worker ─────────────────────────────────────────────────────────────

async function _updateProgress(db, jobId, progress, stage) {
  try {
    // AND status='running':晚到的 fire-and-forget progress UPDATE 不能蓋掉已 done/failed 的 row
    // (兩個 autoCommit 在不同 pooled connection,commit 順序無保證)。
    await db.prepare(`
      UPDATE excel_query_jobs SET progress=?, progress_stage=?, updated_at=SYSTIMESTAMP
      WHERE id=? AND status='running'
    `).run(progress, stage, jobId);
  } catch (e) {
    console.warn(`[ExcelJob] ${jobId} progress update failed: ${e.message}`);
  }
}

async function runJob(db, jobId) {
  let job;
  let heartbeatTimer = null;
  let lockToken = null;
  ACTIVE_JOBS.add(jobId);

  try {
    job = await db.prepare('SELECT * FROM excel_query_jobs WHERE id=?').get(jobId);
    if (!job) { ACTIVE_JOBS.delete(jobId); return; }

    // 1. 取 lock(authoritative:檢查 rowsAffected,搶輸就放棄,防跨 pod 雙跑 — 2026-06-05 類)。
    //    所有 claim 路徑(inline createJob / poller / recovery)都先把 lock_token 設 NULL + status='running'
    //    才 setImmediate(runJob),所以第一個把 lock_token NULL→token 的 runJob 贏,第二個 0 rows 退出。
    lockToken = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const lockRes = await db.prepare(`
      UPDATE excel_query_jobs SET
        lock_token=?, heartbeat_at=SYSTIMESTAMP, started_at=COALESCE(started_at, SYSTIMESTAMP),
        updated_at=SYSTIMESTAMP, status='running'
      WHERE id=? AND lock_token IS NULL AND status IN ('pending','running')
    `).run(lockToken, jobId);
    if ((lockRes?.rowsAffected || lockRes?.changes || 0) === 0) {
      console.warn(`[ExcelJob] ${jobId} 取 lock 失敗(已被其他 pod/worker 接走或非可執行狀態),放棄`);
      ACTIVE_JOBS.delete(jobId);
      return;
    }

    // 2. heartbeat(主執行緒不再被同步 parse 卡住 → heartbeat / liveness 都穩定)
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

    // 4. 對所有檔案做安全 + 存在性 + 副檔名檢查(主執行緒做完才把 realPath 丟進子程序)。
    //    用 async fs.promises:檔案在 NFS,同步 realpath/stat 在 NFS 卡頓時會 block event loop →
    //    /api/health 逾時 → 同一條 liveness SIGKILL(把 parse 移出主執行緒就不該再留同步 FS 呼叫)。
    let totalBytes = 0;
    for (const f of allFiles) {
      let rp;
      try { rp = await fs.promises.realpath(f.path); }
      catch (e) { throw new Error(`檔案已被清除或不存在: ${f.name} (${f.path})`); }
      if (!rp.startsWith(UPLOAD_ROOT)) {
        throw new Error(`拒絕讀取此路徑(超出 ${UPLOAD_ROOT}): ${f.name}`);
      }
      const ext = path.extname(rp).toLowerCase();
      if (!ALLOWED_EXCEL_EXTS.has(ext)) {
        throw new Error(`不支援的檔案類型: ${f.name}(副檔名 ${ext || '(無)'} 不是 Excel)。excel_query 僅支援 ${Array.from(ALLOWED_EXCEL_EXTS).join('/')}`);
      }
      f.realPath = rp;
      try { totalBytes += (await fs.promises.stat(rp)).size; } catch (_) {}
    }

    // ③ re-run fail-fast:背景重試遇大檔直接放棄,毒藥檔不再反覆重跑打掛服務(2026-06-13 事故)。
    // 門檻取 min(8MB, inline 上限):任何被 defer 到 scheduler 的檔(都 > inline 上限)在第 1 次
    // recovery 就 fail-fast,不留 5–8MB 縫隙(否則那段檔會被重跑到 MAX_RECOVERY_COUNT 次)。
    const failfastBytes = Math.min(RERUN_FAILFAST_BYTES, LOCAL_INLINE_MAX_BYTES);
    if ((job.recovery_count || 0) >= RERUN_FAILFAST_RECOVERY && totalBytes > failfastBytes) {
      throw new Error(
        `大型 Excel(合計 ${(totalBytes / 1024 / 1024).toFixed(1)}MB)在背景重試中曾導致服務逾時,` +
        `已停止自動重跑以保護服務;請拆 sheet 或縮小檔案後重新查詢`
      );
    }

    // 5. parse + DuckDB load + SQL 全進 forked 子程序(主 event loop 永遠有空回 liveness;native 爆
    //    只殺子程序、pod 不倒)。經全域 semaphore 限流:同時最多 MAX_CONCURRENT_WORKERS 個子程序,其餘
    //    排隊(排隊期間 heartbeat 照跑、status 仍 running,不會被 recovery 誤撿)。
    const tRead = Date.now();
    await _acquireWorkerSlot();
    let workerResult;
    try {
      workerResult = await _runInChild(db, jobId, tagId, {
        allFiles: allFiles.map((f) => ({ name: f.name, realPath: f.realPath, alias: f.alias, isMain: f.isMain })),
        sheetName: job.sheet_name || null,
        sql: job.sql_text,
        tagId,
        duckdbMemLimit: DUCKDB_MEM_LIMIT,
      });
    } finally {
      _releaseWorkerSlot(); // 子程序已 settle(done/error/timeout)→ 釋放給排隊者
    }
    const { rowsReturned, mdTable, loadedSheets } = workerResult;

    // 6. 組 markdown 結果(輕量,主執行緒)
    const multiFileNote = extraFiles.length > 0
      ? ` + ${extraFiles.length} 個附檔(f1..f${extraFiles.length})`
      : '';
    const elapsed = Date.now() - (job.started_at ? new Date(job.started_at).getTime() : tRead);
    const mainSheet = loadedSheets.find((s) => s.isMain);
    const allTablesNote = loadedSheets.length > 1
      ? `\n**所有 table**(主檔=t):\n` + loadedSheets.map((s) =>
          `  - ${s.table} (${s.fileName} / sheet="${s.original}", ${s.rows} 列)`
        ).join('\n') + '\n'
      : '';
    const resultMd =
      `**主檔**:${job.file_name}${multiFileNote}\n` +
      `**主工作表**:${mainSheet?.original || '(unknown)'}${allTablesNote}\n` +
      `**SQL**:\n\`\`\`sql\n${job.sql_text}\n\`\`\`\n\n` +
      `**結果**(${rowsReturned} 列, ${elapsed}ms):\n\n${mdTable}`;

    // 7. UPDATE done
    await db.prepare(`
      UPDATE excel_query_jobs SET
        status='done', progress=100, progress_stage='done',
        rows_returned=?, result_md=?,
        completed_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(rowsReturned, resultMd, jobId);

    console.log(`[ExcelJob] ${tagId} DONE rows=${rowsReturned} chars=${resultMd.length}`);

    // 8. 若 chat.js 那邊已放棄等(超過 waitForResult 的 90s) → 推 user_notification + 補 chat_message
    //    (假設 chat 還在,user 看不到重複內容也沒事;假設 chat 已死,user 靠通知拿到結果)
    //    => 只在「elapsed > 70s」時推,避免快查詢(< 90s)也彈通知干擾。
    if (elapsed > 70_000) {
      await _pushCompletionNotification(db, job, 'done', resultMd, rowsReturned);
    }

  } catch (e) {
    console.error(`[ExcelJob] ${jobId} FATAL: ${e.message}`);
    // SQL 結構性錯誤(worker 標 __permanentSql)或 worker 崩潰 → recovery_count=MAX,
    // recoverStaleJobs 不再撿起重跑(2026-06-02 / 2026-06-13 事故防護)。
    if (e && e.__permanentSql) {
      try {
        await db.prepare(`UPDATE excel_query_jobs SET recovery_count=? WHERE id=?`)
          .run(MAX_RECOVERY_COUNT, jobId);
      } catch (_) {}
    }
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
  }
}

/**
 * 把 parse / load / SQL 丟進 forked child_process 跑,progress/log 轉回 DB/console,
 * 完成 resolve { rowsReturned, mdTable, loadedSheets },失敗 reject(SQL 結構性錯 / 子程序崩潰 / 逾時
 * 會帶 __permanentSql=true 讓上層不再 recovery)。
 *
 * 子程序記憶體爆掉時:V8 heap 爆 → 子程序自己退(exit≠0);native 爆到 cgroup → kernel 砍子程序
 * (oom_score_adj=1000)→ 'exit' with signal=SIGKILL。兩者主程序都只收到 'exit' 把 job 標 failed,
 * **pod 不倒**。
 */
function _runInChild(db, jobId, tagId, wData) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = fork(path.join(__dirname, 'excelQueryWorker.js'), [], {
        // 子程序自己的 V8 heap 上限;native(DuckDB/SheetJS)靠 DUCKDB_MEM_LIMIT + oom_score_adj 那層。
        // 清掉繼承的 NODE_OPTIONS(prod 含 --max-old-space-size=2560)→ 子程序 heap 只由 execArgv 決定,
        // 不被父層的大 heap 設定汙染(否則 web 子程序可能用到 2560MB,失去 pod-aware 限制的意義)。
        execArgv: [`--max-old-space-size=${CHILD_HEAP_MB}`],
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        env: { ...process.env, NODE_OPTIONS: '' },
      });
    } catch (e) {
      return reject(e);
    }

    let settled = false;
    // wall-clock watchdog:子程序壞掉/失控(壞 SQL、cartesian blow-up、native stall)時可能永遠不
    // 回 done/error 也不 exit。沒這個 → main heartbeat 一直刷新 → recoverStaleJobs 永遠撿不回 →
    // 殭屍 'running' + 洩漏子程序。逾時就 SIGKILL 子程序 + reject(__permanentSql,別重跑同樣會 hang 的檔)。
    const watchdog = setTimeout(() => {
      finish(reject, Object.assign(
        new Error(`Excel parse 子程序逾時(>${Math.round(WORKER_TIMEOUT_MS / 1000)}s),已中止`),
        { __permanentSql: true },
      ));
    }, WORKER_TIMEOUT_MS);
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      try { child.kill('SIGKILL'); } catch (_) {}
      fn(arg);
    };

    child.on('message', (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'progress') {
        if (settled) return; // 終局後不再寫 progress(避免蓋掉 done row)
        _updateProgress(db, jobId, m.progress, m.stage); // fire-and-forget,best-effort
      } else if (m.type === 'log') {
        console.log(`[ExcelJob] ${tagId} ${m.msg}`);
      } else if (m.type === 'done') {
        finish(resolve, {
          rowsReturned: m.rowsReturned,
          mdTable: m.mdTable,
          loadedSheets: m.loadedSheets || [],
        });
      } else if (m.type === 'error') {
        const err = new Error(m.message || 'child error');
        if (m.permanent) err.__permanentSql = true;
        finish(reject, err);
      }
    });

    // fork/spawn 失敗(找不到檔、無法起 process)→ 標 __permanentSql,recovery 不重撿。
    child.on('error', (err) => {
      try { err.__permanentSql = true; } catch (_) {}
      finish(reject, err);
    });

    child.on('exit', (code, signal) => {
      if (settled) return; // 正常結束會先收到 done/error message → 這裡只處理沒回訊息就死掉的情況
      const err = new Error(`Excel parse 子程序異常結束 (code=${code}, signal=${signal || 'none'})`);
      // 非 0 exit 或被 signal 砍(含 OOM SIGKILL)→ 對「這個檔」不可恢復,別讓 recovery 再撿重跑
      if (code !== 0 || signal) err.__permanentSql = true;
      finish(reject, err);
    });

    // 送 init data 觸發子程序開工(child 內 process.once('message') 接)
    try {
      child.send({ type: 'init', data: wData });
    } catch (e) {
      finish(reject, e);
    }
  });
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
  runPendingJobs,
  gracefullyPauseActiveJobs,
  cleanupOldJobs,
  // 給 chat.js xlsx preview 用 — preview 餵 LLM 的欄位名必須跟 worker 建表後一致,
  // 否則 LLM 看到 "Material Var" 但 DuckDB 實際是 Material_Var → Binder Error。
  // 實作已移到 excelQueryUtils,這裡 re-export 維持 chat.js import 不變。
  sanitizeIdent,
  dedupNames,
};
