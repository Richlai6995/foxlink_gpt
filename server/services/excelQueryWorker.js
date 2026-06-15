'use strict';
/**
 * Excel 精確查詢 — parse / load / SQL 的 worker_thread 入口
 *
 * 2026-06-13 事故根因修正(P1 治本):
 *   `XLSX.readFile` + `sheet_to_json` + DuckDB load 全是同步/重 I/O,放在主執行緒跑時,
 *   一個多 sheet 大檔就能卡死 event loop 數十秒 → liveness `GET /api/health` 連 3 次逾時
 *   → kubelet SIGKILL(exit 137 / Reason=Error)→ recovery 重跑同檔 → CrashLoop。
 *   把整段 parse + load + SQL 搬到這個 worker_thread:主執行緒只留 DB bookkeeping(lock /
 *   heartbeat / progress / 結果落地),event loop 永遠有空回 liveness。
 *
 * 附帶好處:worker 有獨立 V8 isolate(resourceLimits.maxOldGenerationSizeMb),
 *   超大 workbook → 只有 worker isolate 丟 'heap out of memory',parent 收到 'error'
 *   事件把 job 標 failed,不會殺掉整個 pod。
 *
 * 通訊協定(postMessage → parent):
 *   { type:'progress', progress, stage }
 *   { type:'log', msg }                                   ← 保留原本診斷用的 read/sheet log
 *   { type:'done', rowsReturned, mdTable, loadedSheets }
 *   { type:'error', message, permanent }                  ← permanent=true 代表 SQL 結構性錯,parent 不再 recovery
 *
 * workerData: { allFiles:[{name, realPath, alias, isMain}], sheetName, sql, tagId }
 *   注意:realPath 已在主執行緒做完 UPLOAD_ROOT 安全檢查 + 副檔名白名單,worker 不再驗。
 */

const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');

const duckdb = require('duckdb');
const { INSERT_BATCH_SIZE, inferType, sanitizeIdent, readSheet, pickSheet, rowsToMarkdown } = require('./excelQueryUtils');
const XLSX = require('xlsx');

// DuckDB SQL 結構性錯誤 — retry 一定也是同樣錯,不該再 parse 一遍 xlsx 燒 CPU(2026-06-02 事故)。
const PERMANENT_SQL_ERROR_RE = /Binder Error|Parser Error|Catalog Error|Conversion Error/i;

function post(type, payload = {}) {
  parentPort.postMessage({ type, ...payload });
}

function dbAll(conn, sql, params) {
  return new Promise((resolve, reject) => {
    const cb = (err, rows) => (err ? reject(err) : resolve(rows));
    if (params && params.length) conn.all(sql, ...params, cb);
    else conn.all(sql, cb);
  });
}

function dbRun(conn, sql) {
  return new Promise((resolve, reject) => conn.run(sql, (err) => (err ? reject(err) : resolve())));
}

async function loadTable(conn, tableName, headers, data) {
  const types = headers.map((_, i) => inferType(data.map((r) => r?.[i])));
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
      if (end < data.length) await new Promise((r) => setImmediate(r));
    }
  } finally {
    await new Promise((resolve) => stmt.finalize(() => resolve()));
  }
  return { types };
}

function buildSqlErrorMsg(rawMsg, sql, loadedSheets) {
  const tableInfo = loadedSheets
    .map((s) => {
      const fileTag = s.fileName ? ` [檔:${s.fileName}]` : '';
      return `  - ${s.table}${s.original !== s.table.replace(/^[tf]\d*_?/, '') ? ` (原名:${s.original})` : ''}${fileTag} — ${s.rows} 列, 欄位:${s.columns.join(', ')}`;
    })
    .join('\n');
  return (
    `SQL 執行失敗: ${rawMsg}\n` +
    `\n你下的 SQL:\n\`\`\`sql\n${sql}\n\`\`\`\n` +
    `\n可用的表(主檔=t,其他檔=f1/f2/...):\n${tableInfo}\n` +
    `\n常見原因:欄位名拼錯、引號用錯(欄位名含中文/空格用 "雙引號")、聚合沒 GROUP BY。`
  );
}

async function run() {
  const { allFiles, sheetName, sql, tagId } = workerData;
  let db = null;
  let conn = null;
  const loadedSheets = []; // { original, table, rows, columns, fileName, alias, isMain }

  // 先關 DuckDB 再對 parent 發終局訊息(done/error)。parent 收到後會 worker.terminate(),
  // 若 terminate 搶在 conn.close()/db.close() 之前,worker 是被強制砍掉的執行緒,DuckDB 的
  // native 資源來不及釋放 → 因 worker_threads 共用 process heap,會洩漏到主程序(每個 job 累積)。
  // idempotent:關完設 null,finally 再呼叫也不會 double-close。
  const closeDuck = () => {
    try { if (conn) conn.close(); } catch (_) {}
    try { if (db) db.close(); } catch (_) {}
    conn = null;
    db = null;
  };

  try {
    db = new duckdb.Database(':memory:');
    conn = db.connect();
    await dbRun(conn, `SET memory_limit='256MB'`);
    await dbRun(conn, `SET threads=2`);

    post('progress', { progress: 5, stage: 'reading_xlsx' });

    for (let fi = 0; fi < allFiles.length; fi++) {
      const f = allFiles[fi];
      const fileSize = fs.statSync(f.realPath).size;
      const tFile = Date.now();
      const wb = XLSX.readFile(f.realPath, { cellDates: true });
      post('log', {
        msg: `read "${f.name}" (alias=${f.alias}) ${(fileSize / 1024 / 1024).toFixed(2)}MB in ${Date.now() - tFile}ms, sheets=${wb.SheetNames.length}`,
      });

      let pickedSheet;
      try {
        pickedSheet = pickSheet(wb, f.isMain ? sheetName : null);
      } catch (e) {
        throw new Error(`${f.name}: ${e.message}`);
      }

      const baseProg = 5 + Math.round((55 * fi) / allFiles.length);
      post('progress', { progress: baseProg, stage: 'loading_duckdb' });

      for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        if (!ws || !ws['!ref'] || ws['!ref'] === 'A1') continue;
        const tSheet = Date.now();
        const { headers, data } = readSheet(ws);
        if (headers.length === 0) continue;

        const tblName = name === pickedSheet ? f.alias : `${f.alias}_${sanitizeIdent(name)}`;
        try {
          await loadTable(conn, tblName, headers, data);
          post('log', {
            msg: `"${f.name}" sheet "${name}" → table "${tblName}": ${data.length} rows, ${headers.length} cols, ${Date.now() - tSheet}ms`,
          });
          loadedSheets.push({
            original: name,
            table: tblName,
            rows: data.length,
            columns: headers,
            fileName: f.name,
            alias: f.alias,
            isMain: f.isMain && name === pickedSheet,
          });
        } catch (e) {
          post('log', { msg: `Failed to load "${f.name}" sheet "${name}": ${e.message}` });
        }
      }
    }

    post('progress', { progress: 60, stage: 'loading_duckdb' });

    if (loadedSheets.length === 0) {
      throw new Error('所有 Excel 都沒有可讀取的工作表(全部空白)');
    }

    post('progress', { progress: 65, stage: 'executing_sql' });
    const tSql = Date.now();
    let result;
    try {
      result = await dbAll(conn, sql);
    } catch (e) {
      const permanent = PERMANENT_SQL_ERROR_RE.test(e.message);
      closeDuck(); // 先關再通知,parent terminate() 不會 race cleanup
      post('error', { message: buildSqlErrorMsg(e.message, sql, loadedSheets), permanent });
      return;
    }
    post('log', { msg: `SQL OK: ${result.length} rows in ${Date.now() - tSql}ms` });

    post('progress', { progress: 90, stage: 'executing_sql' });
    const mdTable = rowsToMarkdown(result); // result 已是純 JS array,可先關 DuckDB
    closeDuck();
    post('done', { rowsReturned: result.length, mdTable, loadedSheets });
  } catch (e) {
    closeDuck();
    post('error', { message: e.message || 'unknown worker error', permanent: false });
  } finally {
    closeDuck(); // 雙保險(idempotent)
  }
}

run();
