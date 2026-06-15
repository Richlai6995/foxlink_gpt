'use strict';
/**
 * Excel 精確查詢 — parse / load / SQL 的 **child_process**(forked 子程序)入口
 *
 * 為什麼是 child_process 而非 worker_thread(2026-06-15 改):
 *   worker_thread 與主程序共用同一個 process / K8s cgroup,`maxOldGenerationSizeMb` 只能限 V8 heap,
 *   限不到 DuckDB native arena 與 SheetJS 解壓 Buffer。一個夠大的 xlsx 把 native 撐過 pod cgroup 時,
 *   是 kernel OOM-killer 砍「整個 process」(= pod 倒),不是優雅的 worker isolate OOM。
 *   改成獨立子程序 + 子程序自設 `oom_score_adj=1000`:cgroup 壓力時 kernel **一定先砍這個子程序、
 *   不砍主服務(web/SSE / scheduler)** → 失控 parse 只讓「這個 excel job 失敗」,pod 不倒。
 *   這是真正關掉 native/cgroup OOM pod-crash vector 的做法(2026-06-13/06-15 事故收尾)。
 *
 * 通訊(process IPC,fork 自帶 channel):
 *   parent → child:{ type:'init', data:{ allFiles, sheetName, sql, tagId, duckdbMemLimit } }
 *   child → parent:{type:'progress',progress,stage} / {type:'log',msg}
 *                  / {type:'done',rowsReturned,mdTable,loadedSheets} / {type:'error',message,permanent}
 *
 * 記憶體防線(雙層):
 *   ① fork 帶 --max-old-space-size(parent execArgv)→ V8 heap 爆 = 子程序乾淨退(parent 收 exit)
 *   ② oom_score_adj=1000 → 連 native 都爆到 cgroup 時,被砍的也是子程序、不是 pod 主程序
 *   ③ MAX_TOTAL_CELLS 早期 bail → 病態超大 sheet 給乾淨錯誤,不必等 OOM
 */

const fs = require('fs');
const path = require('path');

// 讓本子程序成為 cgroup OOM 的首選犧牲者。非特權程序可「調高」自己的 oom_score_adj(調低才需特權),
// best-effort;失敗就靠 --max-old-space-size 那層。
try {
  if (process.platform === 'linux') fs.writeFileSync('/proc/self/oom_score_adj', '1000');
} catch (_) {}

const duckdb = require('duckdb');
const { INSERT_BATCH_SIZE, inferType, sanitizeIdent, readSheet, pickSheet, rowsToMarkdown } = require('./excelQueryUtils');
const XLSX = require('xlsx');

// DuckDB SQL 結構性錯誤 — retry 一定也是同樣錯,不該再 parse 一遍 xlsx 燒 CPU(2026-06-02 事故)。
const PERMANENT_SQL_ERROR_RE = /Binder Error|Parser Error|Catalog Error|Conversion Error/i;
// 早期 bail 上限:XLSX.readFile 後、跑 sheet_to_json(大配置者)前先估總 cell 數,過大給乾淨錯誤。
const MAX_TOTAL_CELLS = Number(process.env.EXCEL_MAX_TOTAL_CELLS) || 20_000_000;

function send(type, payload = {}) {
  try { process.send({ type, ...payload }); } catch (_) {}
}
// 送完終局訊息再退出(IPC 開著不會自動退;直接 exit 會吞掉還沒 flush 的訊息)。
function sendThenExit(type, payload, code) {
  try { process.send({ type, ...payload }, () => process.exit(code)); }
  catch (_) { process.exit(code); }
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

// 估算 workbook 全部 sheet 的總 cell 數(用 '!ref' range,不展開資料)。
function _countCells(wb) {
  let total = 0;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) continue;
    try {
      const r = XLSX.utils.decode_range(ws['!ref']);
      total += (r.e.r - r.s.r + 1) * (r.e.c - r.s.c + 1);
    } catch (_) {}
  }
  return total;
}

async function run(workerData) {
  const { allFiles, sheetName, sql, duckdbMemLimit } = workerData;
  let db = null;
  let conn = null;
  const loadedSheets = []; // { original, table, rows, columns, fileName, alias, isMain }

  const closeDuck = () => {
    try { if (conn) conn.close(); } catch (_) {}
    try { if (db) db.close(); } catch (_) {}
    conn = null;
    db = null;
  };

  try {
    db = new duckdb.Database(':memory:');
    conn = db.connect();
    await dbRun(conn, `SET memory_limit='${duckdbMemLimit || '256MB'}'`);
    await dbRun(conn, `SET threads=2`);

    send('progress', { progress: 5, stage: 'reading_xlsx' });

    for (let fi = 0; fi < allFiles.length; fi++) {
      const f = allFiles[fi];
      const fileSize = fs.statSync(f.realPath).size;
      const tFile = Date.now();
      const wb = XLSX.readFile(f.realPath, { cellDates: true });
      send('log', {
        msg: `read "${f.name}" (alias=${f.alias}) ${(fileSize / 1024 / 1024).toFixed(2)}MB in ${Date.now() - tFile}ms, sheets=${wb.SheetNames.length}`,
      });

      // 早期 bail:sheet_to_json(展開成 array-of-arrays)是記憶體大戶,病態超大 sheet 先擋。
      const cells = _countCells(wb);
      if (cells > MAX_TOTAL_CELLS) {
        throw new Error(`${f.name}: 工作表太大(約 ${cells.toLocaleString()} 格,上限 ${MAX_TOTAL_CELLS.toLocaleString()})。請縮小範圍、刪除空白欄列或拆分後再查詢。`);
      }

      let pickedSheet;
      try {
        pickedSheet = pickSheet(wb, f.isMain ? sheetName : null);
      } catch (e) {
        throw new Error(`${f.name}: ${e.message}`);
      }

      const baseProg = 5 + Math.round((55 * fi) / allFiles.length);
      send('progress', { progress: baseProg, stage: 'loading_duckdb' });

      for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        if (!ws || !ws['!ref'] || ws['!ref'] === 'A1') continue;
        const tSheet = Date.now();
        const { headers, data } = readSheet(ws);
        if (headers.length === 0) continue;

        const tblName = name === pickedSheet ? f.alias : `${f.alias}_${sanitizeIdent(name)}`;
        try {
          await loadTable(conn, tblName, headers, data);
          send('log', {
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
          send('log', { msg: `Failed to load "${f.name}" sheet "${name}": ${e.message}` });
        }
      }
    }

    send('progress', { progress: 60, stage: 'loading_duckdb' });

    if (loadedSheets.length === 0) {
      throw new Error('所有 Excel 都沒有可讀取的工作表(全部空白)');
    }

    send('progress', { progress: 65, stage: 'executing_sql' });
    const tSql = Date.now();
    let result;
    try {
      result = await dbAll(conn, sql);
    } catch (e) {
      const permanent = PERMANENT_SQL_ERROR_RE.test(e.message);
      closeDuck();
      sendThenExit('error', { message: buildSqlErrorMsg(e.message, sql, loadedSheets), permanent }, 0);
      return;
    }
    send('log', { msg: `SQL OK: ${result.length} rows in ${Date.now() - tSql}ms` });

    send('progress', { progress: 90, stage: 'executing_sql' });
    const mdTable = rowsToMarkdown(result); // result 已是純 JS array,可先關 DuckDB
    closeDuck();
    sendThenExit('done', { rowsReturned: result.length, mdTable, loadedSheets }, 0);
  } catch (e) {
    closeDuck();
    sendThenExit('error', { message: e.message || 'unknown worker error', permanent: false }, 0);
  }
}

// 等 parent 送 init data 才開工(避免 import 即執行)。
process.once('message', (m) => {
  if (m && m.type === 'init') {
    run(m.data).catch((e) => {
      try { process.send({ type: 'error', message: e.message || 'child fatal', permanent: false }); } catch (_) {}
      process.exit(1);
    });
  }
});
