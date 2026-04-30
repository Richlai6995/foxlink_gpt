/**
 * excel_query.js — Excel 精確查詢 skill
 *
 * 用 DuckDB 跑 LLM 給的 SQL,讓「依 X 排序、Top N、groupby、篩選」這類數值彙總
 * 不再依賴 LLM 估算。SheetJS 讀 xlsx → CREATE TABLE + bulk INSERT → 跑 SQL。
 *
 * Input body:
 *   {
 *     file_name: string,         // 從 attached_files 中選
 *     sheet_name?: string,       // 留空 = 第一個有資料的工作表
 *     sql: string,               // DuckDB SQL,主表名永遠用 t
 *     attached_files: [          // 由 chat.js 自動注入
 *       { name, path, sheets: [{name, rows, columns}] }
 *     ],
 *   }
 *
 * Output: { content: markdown, data: {...} }
 *
 * 注意:
 *  - 主表名永遠是 t,LLM 不需要記真實 sheet 名
 *  - 多 sheet 時,每個 sheet 也以 sanitized 名建表(可被 SQL JOIN)
 *  - DuckDB 限 256MB / 2 threads,避免 OOM 影響 main app
 *  - 路徑檢查:必須在 UPLOAD_DIR 底下,擋 path traversal
 */
'use strict';

const fs = require('fs');
const path = require('path');
const duckdb = require('duckdb');
const XLSX = require('xlsx');

const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || '/app/uploads');
const MAX_ROWS_PER_SHEET = 200000;   // 防 xlsx 炸 memory
const RESULT_PREVIEW_ROWS = 200;     // 給 LLM 看的最大列數

// ── Schema 推斷 ────────────────────────────────────────────────────────────────
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

// ── Sheet 讀取 ────────────────────────────────────────────────────────────────
function readSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  if (rows.length === 0) return { headers: [], data: [] };
  const headers = (rows[0] || []).map((h, i) => sanitizeIdent(h || `col_${i + 1}`));
  const finalHeaders = dedupNames(headers);
  const data = rows.slice(1, MAX_ROWS_PER_SHEET + 1);
  return { headers: finalHeaders, data, originalHeaders: rows[0] || [] };
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

// ── DuckDB ────────────────────────────────────────────────────────────────────
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

  // 用 prepared statement bulk insert(appender API 在 npm duckdb 不穩定,prepare 比較保險)
  return new Promise((resolve, reject) => {
    const placeholders = headers.map(() => '?').join(',');
    const stmt = conn.prepare(`INSERT INTO "${tableName}" VALUES (${placeholders})`);
    let errored = false;
    for (const row of data) {
      const vals = headers.map((_, i) => {
        const v = row?.[i];
        if (v === undefined || v === '') return null;
        if (types[i] === 'DOUBLE' && typeof v === 'string') {
          const n = parseFloat(v);
          return isNaN(n) ? null : n;
        }
        return v;
      });
      try { stmt.run(...vals); } catch (e) {
        if (!errored) { errored = true; reject(e); }
      }
    }
    stmt.finalize((err) => err ? reject(err) : resolve({ types }));
  });
}

// ── Markdown 輸出 ─────────────────────────────────────────────────────────────
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

// ── 主 handler ────────────────────────────────────────────────────────────────
module.exports = async function handler(body) {
  const t0 = Date.now();
  const { file_name, sheet_name, sql, attached_files } = body || {};

  if (!sql || typeof sql !== 'string') return { content: '❌ 缺少 sql 參數(必須是 SQL 字串)' };
  if (!file_name) return { content: '❌ 缺少 file_name 參數' };
  if (!Array.isArray(attached_files) || attached_files.length === 0) {
    return {
      content:
        '❌ 此對話沒有偵測到 Excel 檔案附件。\n' +
        '請使用者先上傳 .xlsx 或 .xls 檔案,再呼叫此工具。',
    };
  }

  // ── 找檔(fuzzy match)─────────────────────────────────────────────────────
  let target = attached_files.find(f => f.name === file_name)
    || attached_files.find(f => f.name && f.name.toLowerCase() === file_name.toLowerCase())
    || attached_files.find(f => f.name && f.name.includes(file_name))
    || attached_files.find(f => f.name && file_name.includes(f.name));

  if (!target) {
    return {
      content:
        `❌ 找不到檔案 "${file_name}"。\n\n可用檔案:\n` +
        attached_files.map((f, i) => `${i + 1}. ${f.name}`).join('\n'),
    };
  }

  if (!target.path) return { content: `❌ 檔案 "${target.name}" 路徑未提供` };

  // ── 路徑安全:必須在 UPLOAD_ROOT 底下 ─────────────────────────────────────
  let realPath;
  try {
    realPath = fs.realpathSync(target.path);
  } catch (e) {
    return { content: `❌ 檔案已被清除或不存在:${target.name}\n(${target.path})` };
  }
  if (!realPath.startsWith(UPLOAD_ROOT)) {
    return { content: `❌ 拒絕讀取此路徑(超出允許範圍):${target.name}` };
  }

  // ── 讀 xlsx ──────────────────────────────────────────────────────────────
  let wb;
  try {
    wb = XLSX.readFile(realPath, { cellDates: true });
  } catch (e) {
    return { content: `❌ 無法解析 Excel 檔案:${e.message}` };
  }

  let pickedSheet;
  try {
    pickedSheet = pickSheet(wb, sheet_name);
  } catch (e) {
    return { content: `❌ ${e.message}` };
  }

  // ── 開 DuckDB ────────────────────────────────────────────────────────────
  const db = new duckdb.Database(':memory:');
  const conn = db.connect();

  try {
    await dbRun(conn, `SET memory_limit='256MB'`);
    await dbRun(conn, `SET threads=2`);

    // 載入主 sheet 為 t,並把所有非空 sheet 也建成獨立 table(供 JOIN)
    const loadedSheets = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws || !ws['!ref'] || ws['!ref'] === 'A1') continue;
      const { headers, data } = readSheet(ws);
      if (headers.length === 0) continue;

      const tblName = name === pickedSheet ? 't' : sanitizeIdent(name);
      try {
        await loadTable(conn, tblName, headers, data);
        loadedSheets.push({ original: name, table: tblName, rows: data.length, columns: headers });
      } catch (e) {
        console.warn(`[excel_query] Failed to load sheet "${name}": ${e.message}`);
      }
    }

    if (loadedSheets.length === 0) {
      return { content: `⚠️ 此 Excel 沒有可讀取的工作表(全部空白)` };
    }

    // ── 跑 LLM 給的 SQL ─────────────────────────────────────────────────────
    let result;
    try {
      result = await dbAll(conn, sql);
    } catch (e) {
      const tableInfo = loadedSheets.map(s =>
        `  - ${s.table}${s.original !== s.table ? ` (原名:${s.original})` : ''} — ${s.rows} 列, 欄位:${s.columns.join(', ')}`
      ).join('\n');
      return {
        content:
          `❌ SQL 執行失敗:${e.message}\n\n**你下的 SQL**:\n\`\`\`sql\n${sql}\n\`\`\`\n\n` +
          `**可用的表**(主工作表別名為 t):\n${tableInfo}\n\n` +
          `常見原因:欄位名拼錯、引號用錯(欄位名含中文/空格用 "雙引號")、聚合沒 GROUP BY。請依錯誤訊息修正後重試。`,
      };
    }

    const md = rowsToMarkdown(result);
    const elapsed = Date.now() - t0;
    const sheetNote = loadedSheets.length > 1
      ? ` (本檔共 ${loadedSheets.length} 工作表:${loadedSheets.map(s => s.original).join(', ')})`
      : '';

    return {
      content:
        `**檔案**:${target.name}\n` +
        `**主工作表**:${pickedSheet}${sheetNote}\n` +
        `**SQL**:\n\`\`\`sql\n${sql}\n\`\`\`\n\n` +
        `**結果**(${result.length} 列, ${elapsed}ms):\n\n${md}`,
      data: {
        rows_returned: result.length,
        sheet: pickedSheet,
        sql,
        elapsed_ms: elapsed,
        all_sheets: loadedSheets.map(s => ({ name: s.original, table: s.table, rows: s.rows })),
      },
    };
  } finally {
    try { conn.close(); } catch (_) {}
    try { db.close(); } catch (_) {}
  }
};
