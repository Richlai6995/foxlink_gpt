/**
 * Feedback Attachment Processor
 *
 * 工單附件 → 文字描述（供脫敏 + embed 進 KB）
 * - 圖片 → Gemini Vision caption（重用 kbDocParser.imageToText）
 * - PDF/Word/Excel/PPT → parseDocument 解析
 * - txt/md → 直接讀
 * - 其他 → 返回空字串（skip）
 *
 * 原檔 URL 保留在 metadata 供 KB 召回時附下載連結
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseDocument, imageToText } = require('./kbDocParser');

const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);
const DOC_EXTS = new Set(['pdf', 'docx', 'xlsx', 'xls', 'pptx']);
const TEXT_EXTS = new Set(['txt', 'md', 'csv', 'json', 'log']);

function _resolvePath(fp) {
  return path.isAbsolute(fp) ? fp : path.join(UPLOAD_ROOT, fp);
}

function _extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

/**
 * 處理單一附件 → 文字
 * @param {{file_name, file_path, mime_type}} attachment
 * @returns {Promise<{caption: string, kind: 'image'|'doc'|'text'|'skip', tokens: {in, out}, error?: string}>}
 */
async function processAttachment(attachment) {
  const absPath = _resolvePath(attachment.file_path);
  if (!fs.existsSync(absPath)) {
    return { caption: '', kind: 'skip', tokens: { in: 0, out: 0 }, error: 'file not found' };
  }

  const ext = _extOf(attachment.file_name) || _extOf(attachment.file_path);

  try {
    if (IMAGE_EXTS.has(ext)) {
      const buf = fs.readFileSync(absPath);
      const mime = attachment.mime_type || (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`);
      const { text, inputTokens, outputTokens } = await imageToText(buf, mime);
      return {
        caption: text || '',
        kind: 'image',
        tokens: { in: inputTokens || 0, out: outputTokens || 0 },
      };
    }

    if (DOC_EXTS.has(ext)) {
      const { text, ocrInputTokens, ocrOutputTokens } = await parseDocument(absPath, ext);
      return {
        caption: text || '',
        kind: 'doc',
        tokens: { in: ocrInputTokens || 0, out: ocrOutputTokens || 0 },
      };
    }

    if (TEXT_EXTS.has(ext)) {
      const text = fs.readFileSync(absPath, 'utf8').slice(0, 20000);
      return { caption: text, kind: 'text', tokens: { in: 0, out: 0 } };
    }

    return { caption: '', kind: 'skip', tokens: { in: 0, out: 0 } };
  } catch (e) {
    return { caption: '', kind: 'skip', tokens: { in: 0, out: 0 }, error: e.message };
  }
}

/**
 * 批次處理（循序跑，避免 Gemini rate limit）
 * @param {Array} attachments - feedback_attachments rows
 * @returns {Promise<Array<{attachment, caption, kind, tokens, error?}>>}
 */
async function processAttachments(attachments) {
  const results = [];
  for (const att of attachments) {
    const r = await processAttachment(att);
    results.push({ attachment: att, ...r });
    // 保護 rate limit（Gemini Flash 15 RPM free tier）
    if (r.kind === 'image' || r.kind === 'doc') {
      await new Promise(res => setTimeout(res, 400));
    }
  }
  return results;
}

module.exports = {
  processAttachment,
  processAttachments,
};
