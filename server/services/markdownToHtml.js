'use strict';
/**
 * Minimal Markdown → HTML(用於 email body 內嵌呈現,讓表格漂亮)
 *
 * 故意不裝新 dep(markdown-it / marked / showdown),自己寫一個夠用版本。
 * 支援:headers / table / list / bold / italic / code inline / 分隔線 / 段落 / 連結 / emoji。
 *
 * 不支援(因為 email use case 不需要):code fence / blockquote / nested table / image。
 *
 * 樣式策略:全 inline CSS,因為 Gmail / Outlook 對 <style> tag 處理不一致,inline 最 robust。
 */

const TABLE_BORDER = '#cbd5e1';   // slate-300
const TABLE_HEADER_BG = '#f1f5f9'; // slate-100
const HEADING_COLOR = '#1e293b';   // slate-800
const TEXT_COLOR = '#334155';      // slate-700
const LINK_COLOR = '#2563eb';      // blue-600

// HTML escape — 防 LLM 注入或自己亂寫的 < > & 被當 tag
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 燈號 emoji → 純 CSS 圓點:Lotus Notes / 老 mail client 對 U+1F7E2 🟢 / U+1F7E1 🟡 等
// 2019 新 emoji 渲染為黑點(fallback 字型不認),用純 CSS color + `●` (U+25CF 廣泛支援)
// 保證 Notes / Outlook / Gmail / Web 都看得到顏色。
//
// User 實測:Notes 對 hex #dc2626(red-600)不知為何渲染為黑,但 #16a34a/#eab308 正常。
// 解法:用 CSS named color(red/green/gold)— 90 年代就有的 spec,所有 mail client 一致認得。
// 同時 background 也加 named bg,避免某些 client 對深紅 hex 過濾(spam-like color)。
const COLORED_DOT = (color) =>
  `<span style="color:${color};font-size:1.2em;line-height:1;font-weight:bold;font-family:'Microsoft JhengHei',Arial,sans-serif">●</span>`;
const EMOJI_TO_DOT = {
  '🔴': COLORED_DOT('red'),       // 漲(named color,Notes 100% 認)
  '🟢': COLORED_DOT('green'),     // 跌
  '🟡': COLORED_DOT('gold'),      // 持平(gold 比 yellow 飽和度高,看起來更像燈號)
  '🔵': COLORED_DOT('blue'),
  '🟣': COLORED_DOT('purple'),
  '🟠': COLORED_DOT('orange'),
  '⚪': COLORED_DOT('lightgray'),
  '⚫': COLORED_DOT('black'),
  '🟤': COLORED_DOT('brown'),
};

// inline markdown 處理:**bold** / *italic* / `code` / [text](url) + emoji → CSS 圓點
// 也順手剝掉 LLM 可能塞的 <span style="..."> 之類的 HTML(避免雙重渲染 + 移除壞樣式)
function inlineMd(text) {
  let out = String(text);
  // 先把 LLM 自作主張的 <span style="..."> / <font color=...> 等剝掉,保留內部文字
  out = out.replace(/<span\s+[^>]*>([\s\S]*?)<\/span>/gi, '$1');
  out = out.replace(/<font\s+[^>]*>([\s\S]*?)<\/font>/gi, '$1');
  out = out.replace(/<(b|strong|i|em|u|small)\s+[^>]*>([\s\S]*?)<\/\1>/gi, '$2');
  // 把任何剩餘 inline HTML tag escape 掉(已過濾常見的,剩餘的當文字顯示)
  out = escapeHtml(out);
  // 套 markdown 語法
  out = out
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, `<a href="$2" style="color:${LINK_COLOR};text-decoration:underline">$1</a>`)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, '<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;font-family:monospace;font-size:0.92em">$1</code>');
  // 最後把燈號 emoji 替換成 CSS 圓點(用 raw HTML 不能再 escape)
  for (const [emoji, dot] of Object.entries(EMOJI_TO_DOT)) {
    out = out.split(emoji).join(dot);  // split-join 比 RegExp 安全(emoji 含特殊 codepoint)
  }
  return out;
}

// table 行判定
const isTableLine = (s) => /^\|.*\|\s*$/.test(s.trim());
const isTableSeparator = (s) => /^\|[\s\-:|]+\|\s*$/.test(s.trim()) && /-/.test(s);

// 解析 markdown table 區塊 → HTML <table>
function buildTable(blockLines) {
  const cleanCells = (l) => l.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
  const header = cleanCells(blockLines[0]);
  let dataStart = 1;
  if (blockLines.length > 1 && isTableSeparator(blockLines[1])) dataStart = 2;
  const data = blockLines.slice(dataStart).filter(l => isTableLine(l)).map(cleanCells);

  const colCount = header.length;
  const tdStyle = `border:1px solid ${TABLE_BORDER};padding:6px 10px;color:${TEXT_COLOR};font-size:14px`;
  const thStyle = `border:1px solid ${TABLE_BORDER};padding:8px 10px;background:${TABLE_HEADER_BG};color:${HEADING_COLOR};font-weight:600;text-align:center;font-size:14px`;

  let html = `<table style="border-collapse:collapse;width:100%;margin:12px 0;border:1px solid ${TABLE_BORDER};font-family:'Microsoft JhengHei',-apple-system,Segoe UI,sans-serif">`;
  html += '<thead><tr>';
  for (const h of header) html += `<th style="${thStyle}">${inlineMd(h)}</th>`;
  html += '</tr></thead><tbody>';
  for (const row of data) {
    html += '<tr>';
    while (row.length < colCount) row.push('');
    row.length = colCount;
    for (let i = 0; i < colCount; i++) {
      const cell = row[i];
      // 數值 / emoji / 排名置中
      const isNumeric = /^[\d\-+.%,$]+$/.test(cell.trim()) || /^[🟢🔴🟡🔵⚪⚫🟣🟠🟤]/.test(cell.trim()) || i === 0;
      const align = isNumeric ? 'center' : 'left';
      html += `<td style="${tdStyle};text-align:${align}">${inlineMd(cell)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

// 主 entry:markdown → HTML string
function mdToHtml(markdown) {
  if (!markdown) return '';
  // 1) 把 ```json ... ``` / ```generate_xxx ... ``` 整段移除(這些是內部用,email 不該秀)
  let md = String(markdown)
    .replace(/```generate_\w+:[^\n]+\n[\s\S]*?```/g, '')
    .replace(/```json\s*\n[\s\S]*?```/g, '')
    .replace(/```\w*\s*\n[\s\S]*?```/g, '');  // 其餘 code block 也移除(email 簡潔為主)

  const lines = md.split('\n');
  const out = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // table 區塊
    if (isTableLine(line)) {
      const block = [];
      while (i < lines.length && isTableLine(lines[i])) {
        block.push(lines[i]);
        i++;
      }
      if (block.length >= 2) {
        out.push(buildTable(block));
      } else {
        for (const bl of block) out.push(`<p style="color:${TEXT_COLOR};margin:6px 0">${inlineMd(bl)}</p>`);
      }
      continue;
    }

    // headers
    let m;
    if ((m = line.match(/^#\s+(.+)$/))) {
      out.push(`<h1 style="color:${HEADING_COLOR};font-size:22px;margin:18px 0 12px 0;border-bottom:2px solid ${TABLE_BORDER};padding-bottom:6px">${inlineMd(m[1])}</h1>`);
    } else if ((m = line.match(/^##\s+(.+)$/))) {
      out.push(`<h2 style="color:${HEADING_COLOR};font-size:18px;margin:16px 0 10px 0">${inlineMd(m[1])}</h2>`);
    } else if ((m = line.match(/^###\s+(.+)$/))) {
      out.push(`<h3 style="color:${HEADING_COLOR};font-size:16px;margin:14px 0 8px 0">${inlineMd(m[1])}</h3>`);
    } else if (/^---+\s*$/.test(line) || /^___+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      out.push(`<hr style="border:none;border-top:1px solid ${TABLE_BORDER};margin:14px 0">`);
    } else if ((m = line.match(/^(\s*)([-*●•])\s+(.+)$/))) {
      // bullet — 用 indent 推近似 nested list(簡化:不真做 ul/ol,用 padding-left)
      const indent = m[1].length;
      const pad = 16 + indent * 12;
      out.push(`<div style="color:${TEXT_COLOR};margin:4px 0;padding-left:${pad}px;position:relative">` +
        `<span style="position:absolute;left:${pad - 14}px;color:#94a3b8">•</span>${inlineMd(m[3])}</div>`);
    } else if ((m = line.match(/^(\s*)(\d+)\.\s+(.+)$/))) {
      const indent = m[1].length;
      const pad = 16 + indent * 12;
      out.push(`<div style="color:${TEXT_COLOR};margin:4px 0;padding-left:${pad}px;position:relative">` +
        `<span style="position:absolute;left:${pad - 22}px;color:${HEADING_COLOR};font-weight:600">${m[2]}.</span>${inlineMd(m[3])}</div>`);
    } else if (line.trim() === '') {
      // 連續空行壓成一個段落間隔
      if (out.length && !out[out.length - 1].endsWith('<br>')) out.push('<br>');
    } else {
      out.push(`<p style="color:${TEXT_COLOR};margin:6px 0;line-height:1.6">${inlineMd(line)}</p>`);
    }
    i++;
  }

  // 包一層 wrapper 統一字型 + 寬度
  return `<div style="font-family:'Microsoft JhengHei',-apple-system,Segoe UI,sans-serif;color:${TEXT_COLOR};max-width:780px;line-height:1.6">${out.join('\n')}</div>`;
}

module.exports = { mdToHtml };
