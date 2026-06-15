'use strict';
/**
 * Excel 精確查詢 — 純函式 helper(無 DuckDB 連線依賴)
 *
 * 2026-06-13 重構:原本這些 helper 跟 worker 邏輯全擠在 excelQueryJobService.js,
 * 且 XLSX.readFile / sheet_to_json 在主執行緒同步跑 → 多 sheet 大檔卡死 event loop
 * → liveness 探針逾時 → kubelet SIGKILL(137/Error)→ recovery 重跑同檔 → CrashLoop。
 * 把 parse 搬進 worker_thread(見 excelQueryWorker.js),純函式抽到這裡讓兩邊共用。
 *
 * 這裡只放「不碰 DuckDB conn」的東西:SheetJS 解析 + 型別推斷 + markdown 格式化。
 * 碰 conn 的 dbRun / dbAll / loadTable 在 worker 內。
 */

const XLSX = require('xlsx');

// ─── 配置 ────────────────────────────────────────────────────────────────────
const MAX_ROWS_PER_SHEET = 100000;
const RESULT_PREVIEW_ROWS = 200;
const INSERT_BATCH_SIZE = 1000;

function inferType(values) {
  let allNum = true,
    allDate = true,
    allBool = true,
    hasAny = false;
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
  const cleaned = String(s ?? '')
    .replace(/[^\w一-鿿]/g, '_')
    .replace(/^(\d)/, '_$1');
  return cleaned || '_col';
}

function dedupNames(names) {
  const seen = new Map();
  return names.map((n) => {
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
    const nonNull = row.filter((v) => v !== null && v !== undefined && v !== '').length;
    const totalCells = row.length;
    if (totalCells === 0) continue;
    // 80% 以上非空 + 至少 4 cells + 大多是非數字 string → 強候選
    const stringCount = row.filter(
      (v) => typeof v === 'string' && v.trim() && !/^-?\d+(\.\d+)?$/.test(v.trim()),
    ).length;
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
    const exact = wb.SheetNames.find((n) => n === requested);
    if (exact) return exact;
    const fuzzy = wb.SheetNames.find((n) => n.toLowerCase() === requested.toLowerCase());
    if (fuzzy) return fuzzy;
    const partial = wb.SheetNames.find((n) => n.includes(requested) || requested.includes(n));
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

function fmtCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') {
    if (!isFinite(v)) return String(v);
    if (Number.isInteger(v)) return v.toLocaleString('en-US');
    return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  return String(v)
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '');
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
    lines.push('| ' + cols.map((c) => fmtCell(r[c])).join(' | ') + ' |');
  }
  if (truncated)
    lines.push(
      `\n_共 ${rows.length} 列,顯示前 ${Math.floor(RESULT_PREVIEW_ROWS / 2)} + 後 ${Math.floor(RESULT_PREVIEW_ROWS / 2)} 列_`,
    );
  return lines.join('\n');
}

module.exports = {
  MAX_ROWS_PER_SHEET,
  RESULT_PREVIEW_ROWS,
  INSERT_BATCH_SIZE,
  inferType,
  sanitizeIdent,
  dedupNames,
  detectHeaderRow,
  readSheet,
  pickSheet,
  fmtCell,
  rowsToMarkdown,
};
