'use strict';
/**
 * .eml (RFC 5322) parser — 給 KB / chat 兩條路徑共用。
 *
 * 為什麼不直接 readFileSync('utf-8') 塞給 LLM:
 *   1. eml 內 multipart 附件是 base64,塞進去會把 token 燒光也無資訊量
 *   2. quoted-printable / =?utf-8?B?...?= encoded-word headers LLM 看不懂
 *   3. HTML body 一堆 inline CSS / tracking pixel,會稀釋語意
 *
 * 用 mailparser:headers / text / html / attachments 都拆好,
 * 我們把它組成 LLM 友善的純文字結構。
 *
 * KB 路徑加開 parseAttachments=true:附件落 temp 後 lazy-require kbDocParser
 * 遞迴 parse(PDF/DOCX/XLSX/PPTX/image/eml ...),OCR token 加總回傳。
 * chat 路徑維持關 — 附件內容若塞進 chat context 易爆 token,且 chat 沒有
 * 「索引」概念,LLM 想看附件 user 直接傳就好。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { simpleParser } = require('mailparser');
const { convert: htmlToText } = require('html-to-text');

const MAX_BODY_CHARS = 200 * 1024;          // 單封 email body 上限 200KB
const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024; // 單一附件 > 50MB 跳過
const ATTACHMENT_RECURSION_LIMIT = 2;       // eml 內可內含 eml,但只遞迴到深度 2

// 副檔名遞迴白名單 — 走 kbDocParser.parseDocument 認得的格式
const ATTACHMENT_PARSE_EXTS = new Set([
  'pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'eml',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
  'txt', 'md', 'csv', 'tsv', 'log', 'json', 'xml', 'html', 'htm',
]);

// 黑名單 — 即便進到 attachment 也不抽
const ATTACHMENT_BLACKLIST_EXTS = new Set([
  'exe', 'dll', 'so', 'dylib', 'msi', 'com', 'bin',
  'app', 'dmg', 'deb', 'rpm', 'apk', 'ipa',
  'pem', 'key', 'p12', 'pfx', 'keystore', 'jks',
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'tbz2',
]);

function _extOf(filename) {
  const m = String(filename || '').match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : '';
}

function _formatAddr(addr) {
  if (!addr) return '';
  if (addr.text) return addr.text;
  if (Array.isArray(addr.value)) {
    return addr.value
      .map((a) => (a.name ? `${a.name} <${a.address}>` : a.address))
      .filter(Boolean)
      .join(', ');
  }
  return '';
}

function _bodyText(parsed) {
  if (parsed.text && parsed.text.trim()) return parsed.text;
  if (parsed.html) {
    return htmlToText(parsed.html, {
      wordwrap: false,
      selectors: [
        { selector: 'img', format: 'skip' },
        { selector: 'style', format: 'skip' },
        { selector: 'script', format: 'skip' },
        { selector: 'a', options: { ignoreHref: false, hideLinkHrefIfSameAsText: true } },
      ],
    });
  }
  return '';
}

async function _parseAttachmentRecursive(att, ocrModel, depth) {
  const filename = att.filename || `attachment_${crypto.randomBytes(4).toString('hex')}`;
  const ext = _extOf(filename);
  const size = Buffer.isBuffer(att.content) ? att.content.length : (att.size || 0);

  // 過濾條件 — 失敗就回 null,讓 caller 跳過
  if (!ext) return null;
  if (ATTACHMENT_BLACKLIST_EXTS.has(ext)) {
    return { skipReason: `黑名單副檔名: .${ext}` };
  }
  if (!ATTACHMENT_PARSE_EXTS.has(ext)) {
    return { skipReason: `未支援的附件類型: .${ext}` };
  }
  if (size > ATTACHMENT_MAX_BYTES) {
    return { skipReason: `附件過大 (${size} bytes > ${ATTACHMENT_MAX_BYTES})` };
  }
  if (!Buffer.isBuffer(att.content) || size === 0) {
    return { skipReason: '附件無內容' };
  }

  // 寫到 temp file → call parseDocument。用 mkdtemp 確保隔離,finally 統一清理。
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eml-att-'));
  const safeName = filename.replace(/[^a-zA-Z0-9一-鿿._-]/g, '_');
  const tmpPath = path.join(tmpDir, safeName);

  try {
    fs.writeFileSync(tmpPath, att.content);
    // Lazy require 避免 emlParser ↔ kbDocParser 循環(雙方都 lazy 就安全)
    const { parseDocument } = require('./kbDocParser');

    // 嵌套 .eml 要傳 depth,kbDocParser case 'eml' 會接收
    const result = await parseDocument(tmpPath, ext, ocrModel, 'text_only', 'off', {
      emlDepth: depth + 1,
    });
    return {
      filename,
      ext,
      size,
      text: result.text || '',
      ocrInputTokens: result.ocrInputTokens || 0,
      ocrOutputTokens: result.ocrOutputTokens || 0,
    };
  } catch (e) {
    console.warn(`[emlParser] attachment parse failed (${filename}): ${e.message}`);
    return { filename, ext, size, skipReason: `解析失敗: ${e.message}` };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

/**
 * Parse .eml file → plain text suitable for LLM / embedding.
 * @param {string} filePath
 * @param {object} [opts]
 * @param {boolean} [opts.parseAttachments=false] KB 用 true,chat 用 false
 * @param {string|null} [opts.ocrModel] 傳給附件 PDF/image 的 OCR model
 * @param {number} [opts.depth=0] 內部遞迴計數,防止 eml 內含 eml 內含 eml...
 * @returns {Promise<{text: string, ocrInputTokens: number, ocrOutputTokens: number}>}
 */
async function parseEml(filePath, opts = {}) {
  const { parseAttachments = false, ocrModel = null, depth = 0 } = opts;

  const buf = fs.readFileSync(filePath);
  const parsed = await simpleParser(buf, {
    skipImageLinks: true,
    skipHtmlToText: true,
  });

  const lines = [];
  if (parsed.subject) lines.push(`Subject: ${parsed.subject}`);
  const from = _formatAddr(parsed.from);
  if (from) lines.push(`From: ${from}`);
  const to = _formatAddr(parsed.to);
  if (to) lines.push(`To: ${to}`);
  const cc = _formatAddr(parsed.cc);
  if (cc) lines.push(`Cc: ${cc}`);
  if (parsed.date) lines.push(`Date: ${parsed.date.toISOString()}`);
  if (parsed.messageId) lines.push(`Message-ID: ${parsed.messageId}`);

  let body = _bodyText(parsed).trim();
  if (body.length > MAX_BODY_CHARS) {
    body = body.slice(0, MAX_BODY_CHARS) + `\n\n[⚠️ Email body 過長,已截斷在 ${MAX_BODY_CHARS} 字]`;
  }

  const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
  const attachmentLines = [];
  const attachmentBodies = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  if (attachments.length > 0) {
    attachmentLines.push('Attachments:');
    for (const a of attachments) {
      const name = a.filename || '(unnamed)';
      const size = a.size != null ? `${a.size} bytes` : '?';
      const type = a.contentType || 'application/octet-stream';
      attachmentLines.push(`  - ${name} (${type}, ${size})`);
    }

    if (parseAttachments && depth < ATTACHMENT_RECURSION_LIMIT) {
      for (const a of attachments) {
        const r = await _parseAttachmentRecursive(a, ocrModel, depth);
        if (!r) continue;
        if (r.skipReason) {
          attachmentBodies.push(`\n[Attachment: ${a.filename || '(unnamed)'}] — 跳過 (${r.skipReason})`);
          continue;
        }
        totalInputTokens += r.ocrInputTokens;
        totalOutputTokens += r.ocrOutputTokens;
        if (r.text && r.text.trim()) {
          attachmentBodies.push(`\n[Attachment: ${r.filename}]\n${r.text}`);
        }
      }
    } else if (parseAttachments && depth >= ATTACHMENT_RECURSION_LIMIT) {
      attachmentBodies.push(`\n[⚠️ 達到附件遞迴上限 (depth=${depth}),不再展開]`);
    }
  }

  const sections = [
    lines.join('\n'),
    body,
    attachmentLines.join('\n'),
    attachmentBodies.join('\n'),
  ].filter((s) => s && s.trim());

  return {
    text: sections.join('\n\n'),
    ocrInputTokens: totalInputTokens,
    ocrOutputTokens: totalOutputTokens,
  };
}

module.exports = { parseEml };
