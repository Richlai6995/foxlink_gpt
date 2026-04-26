'use strict';
/**
 * toolResultPassthrough.js
 *
 * 單一入口偵測 MCP / Skill 工具回傳是否為 MD / HTML artifact。
 * 命中 → 回 { passthrough:true, artifact, summaryStruct, summaryText }
 *        artifact = { mime, title, content } (前端 SSE 直送)
 *        summaryStruct = JSON.stringify 後存 DB
 *        summaryText = 給 LLM 的字串(取代原 tool result)
 *
 * 不命中 / 全域關閉 → 回 { passthrough:false, reason }
 *
 * 詳見 docs/tool-artifact-passthrough.md §6.1
 */

const FEATURE_DISABLED = process.env.PASSTHROUGH_FEATURE_DISABLED === '1';

const HARD_DEFAULT_MIMES = ['text/markdown', 'text/html'];
const HARD_DEFAULT_MAX_BYTES = 512_000;

function parseMimeWhitelist(raw) {
  if (!raw) return HARD_DEFAULT_MIMES.slice();
  return String(raw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// ── Sniffers ────────────────────────────────────────────────────────────────
function looksLikeHtml(s) {
  if (typeof s !== 'string') return false;
  const head = s.trimStart().slice(0, 200).toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return true;
  // 寬鬆:<head> / <body> 開頭也認
  if (/^<(head|body|table|div|article|section)\b/.test(head)) return true;
  return false;
}

function looksLikeMarkdown(s) {
  if (typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (!trimmed) return false;
  // 第一行 # heading / | table / horizontal rule / list 都當 markdown 訊號
  const firstLine = trimmed.split('\n', 1)[0];
  const hasMdSignal =
    /^#{1,6}\s/.test(firstLine) ||                  // # heading
    /^\|.*\|/.test(firstLine) ||                    // | table |
    /^-{3,}$/.test(firstLine) ||                    // ---
    /^\*\s|^\d+\.\s/.test(firstLine);               // bullet / numbered

  if (!hasMdSignal) return false;
  // 進一步驗證:全文要有 table 或多個 heading 才算成品
  const tableLines = (trimmed.match(/^\|.+\|$/gm) || []).length;
  const headingLines = (trimmed.match(/^#{1,6}\s/gm) || []).length;
  return tableLines >= 2 || headingLines >= 1;
}

function sniffMime(content) {
  if (looksLikeHtml(content)) return 'text/html';
  if (looksLikeMarkdown(content)) return 'text/markdown';
  return null;
}

// ── Summary extraction ──────────────────────────────────────────────────────
function extractMarkdownSummary(md, toolMeta) {
  const lines = md.split('\n');
  let title = null;
  for (const ln of lines) {
    const m = /^#\s+(.+)$/.exec(ln);
    if (m) { title = m[1].trim(); break; }
  }
  const headings = [];
  for (const ln of lines) {
    const m = /^(#{2,3})\s+(.+)$/.exec(ln);
    if (m) headings.push(m[2].trim());
    if (headings.length >= 10) break;
  }
  // 表格首列 + 第一筆資料
  let tableHeader = null, tableFirstRow = null;
  for (let i = 0; i < lines.length; i++) {
    if (/^\|.+\|$/.test(lines[i].trim()) && /^\|[\s\-:|]+\|$/.test((lines[i + 1] || '').trim())) {
      tableHeader = lines[i].trim();
      tableFirstRow = (lines[i + 2] || '').trim();
      break;
    }
  }
  // 前 500 字(去除 fenced code blocks)
  const noCode = md.replace(/```[\s\S]*?```/g, '').trim();
  const firstChars = noCode.slice(0, 500);

  return {
    tool: toolMeta,
    mime: 'text/markdown',
    title: title || toolMeta?.name || null,
    headings,
    table_header: tableHeader,
    table_first_row: tableFirstRow,
    first_chars: firstChars,
    size: Buffer.byteLength(md, 'utf8'),
  };
}

function extractHtmlSummary(html, toolMeta) {
  // 輕量 regex,避免拉 cheerio 依賴
  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  let title = titleMatch ? titleMatch[1].trim() : null;
  if (!title) {
    const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    if (h1Match) title = h1Match[1].replace(/<[^>]+>/g, '').trim();
  }
  const headings = [];
  const headRegex = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let m;
  while ((m = headRegex.exec(html)) && headings.length < 10) {
    headings.push(m[1].replace(/<[^>]+>/g, '').trim());
  }
  // 第一個 <table> 的 <th> + 第一個 <tr> 資料
  let tableHeader = null, tableFirstRow = null;
  const tableMatch = /<table[\s\S]*?<\/table>/i.exec(html);
  if (tableMatch) {
    const tbl = tableMatch[0];
    const ths = [...tbl.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(x => x[1].replace(/<[^>]+>/g, '').trim());
    if (ths.length) tableHeader = '| ' + ths.join(' | ') + ' |';
    // 找第一個非空 tr(跳過 header tr)
    const trMatches = [...tbl.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
    for (const tr of trMatches) {
      const tds = [...tr[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x => x[1].replace(/<[^>]+>/g, '').trim());
      if (tds.length) { tableFirstRow = '| ' + tds.join(' | ') + ' |'; break; }
    }
  }
  // innerText 前 500 字
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    tool: toolMeta,
    mime: 'text/html',
    title: title || toolMeta?.name || null,
    headings,
    table_header: tableHeader,
    table_first_row: tableFirstRow,
    first_chars: text.slice(0, 500),
    size: Buffer.byteLength(html, 'utf8'),
  };
}

function extractSummary(content, mime, toolMeta) {
  if (mime === 'text/markdown') return extractMarkdownSummary(content, toolMeta);
  if (mime === 'text/html')     return extractHtmlSummary(content, toolMeta);
  return null;
}

// ── Render summary 給 LLM(取代原 tool result) ─────────────────────────────
function renderSummaryForLLM(summary) {
  const tool = summary.tool || {};
  const lines = [];
  lines.push(
    `[工具 ${tool.name || tool.tool_name || 'unknown'} 已產出 ${summary.mime} artifact「${summary.title || '(no title)'}」,${summary.size} bytes]`
  );
  if (summary.headings?.length) lines.push(`主要小節:${summary.headings.slice(0, 5).join(' / ')}`);
  if (summary.table_header)     lines.push(`表格欄位:${summary.table_header}`);
  if (summary.table_first_row)  lines.push(`第一列:${summary.table_first_row}`);
  if (summary.first_chars)      lines.push(`內容首段:${summary.first_chars.slice(0, 240)}`);
  lines.push(`(artifact 已直接顯示給使用者,請勿重複內容,可針對 data 欄位做補充說明或回應後續追問)`);
  return lines.join('\n');
}

// ── 主入口 ────────────────────────────────────────────────────────────────
/**
 * @param {object} arg
 * @param {string|object} arg.result           原始 tool result
 *   - mcp:可傳 string(legacy)或 { text, parts, isError }(returnRaw 版)
 *   - skill:可傳 raw HTTP body / 已 parse JSON / { artifact: {...} } / string
 * @param {string} [arg.mimeHint]              呼叫端能直接給 mime(skill artifact、MCP resource part)
 * @param {object} arg.source
 *   - type: 'mcp' | 'skill' | 'dify'
 *   - id, name, config: { passthrough_enabled, passthrough_max_bytes, passthrough_mime_whitelist }
 * @param {object} [arg.toolMeta]              { name, args }
 */
function detectPassthrough({ result, mimeHint, source, toolMeta }) {
  if (FEATURE_DISABLED) return { passthrough: false, reason: 'feature_disabled_env' };
  const cfg = source?.config || {};
  if (Number(cfg.passthrough_enabled) !== 1) return { passthrough: false, reason: 'disabled_in_config' };

  const maxBytes = Number(cfg.passthrough_max_bytes) || HARD_DEFAULT_MAX_BYTES;
  const whitelist = parseMimeWhitelist(cfg.passthrough_mime_whitelist);

  // ─ 1. 抽出 artifact 候選(content + mime)──
  let artifact = null;          // { mime, title, content }
  let detectionMethod = null;

  // a) skill 顯式 artifact
  if (result && typeof result === 'object' && result.artifact?.content) {
    const a = result.artifact;
    if (a.mime && a.content) {
      artifact = { mime: String(a.mime).toLowerCase(), title: String(a.title || ''), content: String(a.content) };
      detectionMethod = 'skill_opt_in';
    }
  }

  // b) MCP returnRaw — parts 內第一個帶 mimeType 的 part
  //    MCP spec:resource part 是 { type:'resource', resource:{ mimeType, text|blob } } — nested
  //    text/image part 也可能直接帶 mimeType
  if (!artifact && result && typeof result === 'object' && Array.isArray(result.parts)) {
    for (const p of result.parts) {
      const r = p && p.resource ? p.resource : null;
      const mime = (r?.mimeType || r?.mime_type || p?.mimeType || p?.mime_type || '').toLowerCase();
      const content = r?.text || r?.blob || p?.text || p?.data || null;
      if (mime && content) {
        artifact = {
          mime,
          title: p.title || r?.title || r?.uri || '',
          content: String(content),
        };
        detectionMethod = 'mime';
        break;
      }
    }
  }

  // c) mimeHint + raw text
  if (!artifact && mimeHint) {
    const text = typeof result === 'string'
      ? result
      : (result?.text || result?.content || null);
    if (typeof text === 'string') {
      artifact = { mime: String(mimeHint).toLowerCase(), title: '', content: text };
      detectionMethod = 'mime';
    }
  }

  // d) content sniff(最後手段)
  if (!artifact) {
    const text = typeof result === 'string'
      ? result
      : (result?.text || result?.content || null);
    if (typeof text === 'string') {
      const sniffed = sniffMime(text);
      if (sniffed) {
        artifact = { mime: sniffed, title: '', content: text };
        detectionMethod = 'sniff';
      }
    }
  }

  if (!artifact) return { passthrough: false, reason: 'no_artifact_detected' };

  // ─ 2. mime whitelist gate ─
  if (!whitelist.includes(artifact.mime)) {
    return { passthrough: false, reason: `mime_not_whitelisted:${artifact.mime}` };
  }

  // ─ 3. size gate ─
  const size = Buffer.byteLength(artifact.content, 'utf8');
  if (size > maxBytes) {
    return { passthrough: false, reason: `oversize:${size}>${maxBytes}` };
  }

  // ─ 4. summary + 補 title fallback ─
  const meta = { ...(toolMeta || {}), source_type: source?.type, source_id: source?.id };
  if (!artifact.title) artifact.title = meta.name || `${source?.type || 'tool'} artifact`;
  const summary = extractSummary(artifact.content, artifact.mime, meta);
  const summaryText = renderSummaryForLLM(summary);

  return {
    passthrough: true,
    artifact: {
      mime: artifact.mime,
      title: artifact.title,
      content: artifact.content,
      size,
    },
    detectionMethod,
    summaryStruct: summary,
    summaryText,
  };
}

module.exports = {
  detectPassthrough,
  sniffMime,            // 給單元測試
  extractSummary,       // 給單元測試
  renderSummaryForLLM,  // 給單元測試
  FEATURE_DISABLED,
};
