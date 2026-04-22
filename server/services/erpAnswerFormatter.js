'use strict';

/**
 * ERP Answer 模式輸出解析器
 *
 * 把 FUNCTION 回傳的 VARCHAR2 字串(通常 / 或 , 分隔多欄 + \n 分列)
 * 解析為結構化 rows,渲染為 Markdown 表格 + 選填的 ECharts 圖表。
 * 全後端解析,不經 LLM,速度快 + 結果穩定。
 *
 * answer_output_format 規格(存在 erp_tools.answer_output_format_json):
 * {
 *   "col_separator":  "/",      // 欄位分隔符,預設 /
 *   "row_separator":  "\n",     // 列分隔符 \n / space / ,  預設 \n
 *   "columns":        ["年月", "專案名稱", "類別", "料號", "幣別", "超額金額"],
 *   "numeric_columns": ["超額金額"],   // 這些欄會去千分位 + 右對齊
 *   "chart": {                        // 選填
 *     "type":       "bar",            // bar / line / pie
 *     "x_column":   "料號",
 *     "y_column":   "超額金額",
 *     "title":      "MRP 合理庫存超額金額排名"
 *   },
 *   "skip_first_row": false,          // 第一列是 header 時設 true
 *   "max_rows":       200             // 最多渲染幾列,避免訊息過長
 * }
 */

const DEFAULT_SEP = '/';
const DEFAULT_ROW_SEP = '\n';
const DEFAULT_MAX_ROWS = 200;

/**
 * 把 row_separator 的語意字串轉成實際分隔符
 */
function normalizeRowSep(rs) {
  if (!rs || rs === '\\n' || rs === '\n' || rs === 'newline') return '\n';
  if (rs === '\\t' || rs === '\t' || rs === 'tab') return '\t';
  if (rs === 'space') return ' ';
  return rs;
}

/**
 * 解析 function_return 字串 → rows 陣列
 */
function parseOutput(text, format) {
  if (!text || typeof text !== 'string') return [];
  const colSep = format.col_separator || DEFAULT_SEP;
  const rowSep = normalizeRowSep(format.row_separator);

  const lines = String(text).split(rowSep).map(l => l.trim()).filter(Boolean);
  const startIdx = format.skip_first_row ? 1 : 0;
  const cols = Array.isArray(format.columns) ? format.columns : [];
  const rows = [];
  for (let i = startIdx; i < lines.length; i++) {
    const parts = lines[i].split(colSep).map(s => s.trim());
    const row = {};
    for (let j = 0; j < cols.length; j++) {
      row[cols[j]] = parts[j] ?? '';
    }
    // 若沒設 columns,用 col_0/col_1 當 key
    if (cols.length === 0) {
      parts.forEach((p, j) => { row[`col_${j}`] = p; });
    }
    rows.push(row);
  }
  return rows;
}

function formatNumber(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return n.toLocaleString('en-US');
}

/**
 * rows → Markdown 表格
 */
function buildMarkdownTable(rows, format) {
  if (rows.length === 0) return '(查無資料)';
  const cols = Array.isArray(format.columns) && format.columns.length > 0
    ? format.columns
    : Object.keys(rows[0]);
  const numCols = new Set(format.numeric_columns || []);
  const maxRows = Number(format.max_rows) || DEFAULT_MAX_ROWS;
  const display = rows.slice(0, maxRows);

  const header = '| ' + cols.join(' | ') + ' |';
  // 數字欄靠右(---:)
  const sep = '| ' + cols.map(c => numCols.has(c) ? '---:' : '---').join(' | ') + ' |';
  const body = display.map(r =>
    '| ' + cols.map(c => {
      const v = r[c];
      if (v === null || v === undefined || v === '') return '-';
      return numCols.has(c) ? formatNumber(v) : String(v);
    }).join(' | ') + ' |'
  ).join('\n');

  let out = [header, sep, body].join('\n');
  if (rows.length > maxRows) {
    out += `\n\n_僅顯示前 ${maxRows} 列,共 ${rows.length} 列_`;
  }
  return out;
}

/**
 * 產生 generate_chart 區塊(符合 chartSpecParser 的 validateSpec schema)
 * 必要欄位:type, x_field(string), y_fields([{field}...]), data(array)
 */
function buildChartBlock(rows, format) {
  const cfg = format.chart;
  if (!cfg || !cfg.x_column || !cfg.y_column) return '';
  const type = cfg.type || 'bar';

  const spec = {
    version: 1,
    type,
    title: cfg.title || '',
    x_field: cfg.x_column,
    y_fields: [{ field: cfg.y_column }],
    data: rows.map(r => ({
      [cfg.x_column]: r[cfg.x_column],
      [cfg.y_column]: Number(r[cfg.y_column]) || 0,
    })),
  };

  return '\n\n```generate_chart:' + type + '\n' + JSON.stringify(spec, null, 2) + '\n```';
}

/**
 * 主入口:依 format 把 raw text parse 並渲染為 Markdown(含可選圖表)
 * @param {string} toolName
 * @param {string|object} functionReturn  ERP FUNCTION 的回傳值
 * @param {object|null}   format          answer_output_format_json parsed
 * @param {string|null}   cacheKey        ERP result cache key(選填)
 * @returns {string} Markdown
 */
function formatAnswer(toolName, functionReturn, format, cacheKey) {
  const title = `**${toolName}** 查詢結果\n`;
  if (!format || (!format.columns && !format.col_separator)) {
    // 沒設 output format,保留既有行為:純文字區塊
    const raw = functionReturn === null || functionReturn === undefined ? '(無資料)' : String(functionReturn);
    return title + '\n```\n' + raw + '\n```' + (cacheKey ? `\n\n_cache: \`${cacheKey}\`_` : '');
  }

  const rows = parseOutput(String(functionReturn || ''), format);
  if (rows.length === 0) {
    return title + '\n(查無資料)';
  }

  const table = buildMarkdownTable(rows, format);
  const chart = buildChartBlock(rows, format);
  const cache = cacheKey ? `\n\n_完整結果 cache: \`${cacheKey}\`(30 分鐘內有效)_` : '';

  return title + '\n' + table + chart + cache;
}

module.exports = {
  formatAnswer,
  parseOutput,
  buildMarkdownTable,
  buildChartBlock,
};
