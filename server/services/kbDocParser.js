'use strict';
/**
 * Knowledge Base Document Parser
 * Parses PDF / DOCX / PPTX / XLSX / TXT → plain text
 * Also OCRs embedded images using Gemini Vision.
 * Supports parse_mode: 'text_only' (default) | 'format_aware'
 *   format_aware annotates cell colors, text colors, strikethrough, highlights
 *   with color labels: 紅色/橙色/黃色/綠色/藍色/刪除線
 */

const fs   = require('fs');
const path = require('path');

// ─── Format-aware helpers ────────────────────────────────────────────────────

/**
 * Map an RGB hex string (6 chars, no #) to a semantic label.
 * Returns null for white/black/auto or unrecognised colours.
 */
function classifyRgbColor(hex) {
  if (!hex || hex === 'FFFFFF' || hex === 'ffffff' || hex === 'auto' || hex === '000000') return null;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  if (r > 245 && g > 245 && b > 245) return null; // near-white
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 25) return null; // near-gray / neutral

  // Yellow: r ≈ g (both elevated), b significantly lower
  if (Math.abs(r - g) < 30 && b < Math.min(r, g) - 30) return '黃色';

  // Cyan (both g and b dominate r, close to each other) → blue
  if (g >= r && b >= r && Math.abs(g - b) < 40 && Math.min(g, b) > r + 20) return '藍色';

  // Single dominant channel
  if (b > g && b > r) return '藍色';
  if (g > r + 10 && g > b) return '綠色';
  if (g > r && g >= b) return '綠色';
  if (r >= g && r >= b) return '紅色';
  return null;
}

// Standard XLSX indexed color table (indices 0-63)
const XLSX_INDEXED_COLORS = [
  '000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF', // 0-7
  '000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF', // 8-15
  '800000','008000','000080','808000','800080','008080','C0C0C0','808080', // 16-23
  '9999FF','993366','FFFFCC','CCFFFF','660066','FF8080','0066CC','CCCCFF', // 24-31
  '000080','FF00FF','FFFF00','00FFFF','800080','800000','008080','0000FF', // 32-39
  '00CCFF','CCFFFF','CCFFCC','FFFF99','99CCFF','FF99CC','CC99FF','FFCC99', // 40-47
  '3366FF','33CCCC','99CC00','FFCC00','FF9900','FF6600','666699','969696', // 48-55
  '003366','339966','003300','333300','993300','993366','333399','333333', // 56-63
];

// DOCX built-in highlight colour → color label
const DOCX_HIGHLIGHT_MAP = {
  red: '紅色', darkRed: '紅色',
  yellow: '黃色',
  green: '綠色', darkGreen: '綠色',
  cyan: '藍色', blue: '藍色', darkBlue: '藍色', darkCyan: '藍色',
  magenta: '橙色', darkMagenta: '橙色', darkYellow: '橙色',
};

/**
 * Extract text from a single DOCX <w:p> paragraph XML, annotating
 * runs with colour/highlight/strikethrough semantics.
 */
function extractParaFormatAware(paraXml) {
  // Replace <w:del> tracked-deletion blocks with [已刪除]
  const withoutDel = paraXml.replace(/<w:del\b[\s\S]*?<\/w:del>/g, '[已刪除]');

  const runParts = [];
  const runRegex = /<w:r[ >][\s\S]*?<\/w:r>/g;
  let rm;
  while ((rm = runRegex.exec(withoutDel)) !== null) {
    const runXml = rm[0];
    const textMatch = runXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/);
    const text = textMatch ? textMatch[1] : '';
    if (!text.trim()) continue;

    const rPrMatch = runXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    if (!rPrMatch) { runParts.push(text); continue; }
    const rPr = rPrMatch[1];

    const labels = [];
    if (/<w:strike\b/.test(rPr)) labels.push('刪除線');

    const hlMatch = rPr.match(/<w:highlight\s+w:val="([^"]+)"/);
    if (hlMatch) {
      const sem = DOCX_HIGHLIGHT_MAP[hlMatch[1]];
      if (sem) labels.push(sem);
    }

    const colorMatch = rPr.match(/<w:color\s+w:val="([^"]+)"/);
    if (colorMatch && colorMatch[1] !== 'auto') {
      const sem = classifyRgbColor(colorMatch[1]);
      if (sem) labels.push(sem);
    }

    runParts.push(labels.length ? `${text}[${labels.join('/')}]` : text);
  }
  return runParts.join('');
}

// ─── Image OCR ───────────────────────────────────────────────────────────────

// Returns { text, inputTokens, outputTokens }
async function imageToText(imageBuffer, mimeType = 'image/png', ocrModel = null) {
  try {
    const { getGenerativeModel, extractText, extractUsage } = require('./geminiClient');
    const model = getGenerativeModel({
      model: ocrModel || process.env.KB_OCR_MODEL || process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash',
    });
    const result = await model.generateContent([
      { inlineData: { data: imageBuffer.toString('base64'), mimeType } },
      {
        text: '請將這張圖片中的所有文字完整提取出來。如果是表格請保持表格格式，如果是圖表請描述圖表內容與數據。只輸出圖片中包含的資訊，不要加入額外說明。如果圖片沒有文字內容，輸出「(無文字)」。',
      },
    ]);
    const txt = extractText(result).trim();
    const usage = extractUsage(result);
    return {
      text: txt === '(無文字)' ? '' : txt,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
  } catch (e) {
    console.warn('[KBParser] imageToText error:', e.message);
    return { text: '', inputTokens: 0, outputTokens: 0 };
  }
}

// ─── Document parsers ─────────────────────────────────────────────────────────

// PDF parse mode: 'off' = text-layer only (fast, may miss image text)
//                 'auto' = per-page — pages with images ≥5% get OCR, others use text layer
//                 'force' = every page OCR (scanned docs / strong requirement)
// Auto also auto-detects pure-scan PDFs (≥90% pages have <30 chars text) → force-OCR all.
const PDF_OCR_PAGE_CONCURRENCY = Number(process.env.KB_PDF_OCR_CONCURRENCY || 20);
const PDF_IMAGE_AREA_THRESHOLD  = 0.05;  // 5% of page area → treat as content image
const PDF_SCAN_CHARS_THRESHOLD  = 30;    // <30 chars per page → likely scanned
const PDF_SCAN_RATIO_THRESHOLD  = 0.9;   // ≥90% of pages below → treat as scanned

const PDF_PROMPT_TEXT_ONLY = '請完整提取此 PDF 頁面中所有內容，包括文字、表格、圖片中的文字與說明。保持段落結構，表格以文字形式呈現，圖片標記為 [圖片文字: <內容>]。只輸出頁面內容，不要加入額外說明或前言。';
const PDF_PROMPT_FORMAT_AWARE = `請完整提取此 PDF 頁面中所有內容，並依照以下規則標注視覺格式：
1. 紅色文字或紅色底色 → 在該文字後緊接標注 [紅色]
2. 橙色文字或橙色底色 → 在該文字後緊接標注 [橙色]
3. 黃色底色或黃色螢光標記 → 在該文字後緊接標注 [黃色]
4. 綠色文字或綠色底色 → 在該文字後緊接標注 [綠色]
5. 藍色或青色文字/底色 → 在該文字後緊接標注 [藍色]
6. 刪除線文字 → 在該文字後緊接標注 [刪除線]
7. 表格：以文字形式逐列呈現，保留欄位名稱與對應值
8. 圖片中的文字：標記為 [圖片文字: <內容>]
9. 如果某段落沒有特殊格式，直接輸出純文字即可。僅輸出頁面內容，不加額外說明或前言。`;

// Per-page analysis — text layer + image area ratio (CTM-tracked).
async function _analyzePdfPage(page, OPS) {
  const viewport = page.getViewport({ scale: 1 });
  const pageArea = Math.abs(viewport.width * viewport.height) || 1;

  const tc = await page.getTextContent();
  const text = tc.items.map((x) => x.str || '').join(' ').trim();

  const ops = await page.getOperatorList();
  let m = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let totalImageArea = 0;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) {
      stack.push([...m]);
    } else if (fn === OPS.restore) {
      m = stack.pop() || [1, 0, 0, 1, 0, 0];
    } else if (fn === OPS.transform) {
      const [A, B, C, D, E, F] = args;
      const [a, b, c, d, e, f] = m;
      m = [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      // Image painted at CTM — rendered area is |det(CTM[0..3])|
      totalImageArea += Math.abs(m[0] * m[3] - m[1] * m[2]);
    }
  }
  return { text, imgAreaRatio: totalImageArea / pageArea };
}

// Detect Gemini rate-limit / quota errors.
function _isRateLimitError(e) {
  const s = String(e?.message || e || '');
  return /\b429\b|Too Many Requests|RESOURCE_EXHAUSTED|quota|rate limit/i.test(s);
}

// OCR a single-page PDF via Gemini — 5 retries with 429-aware backoff.
async function _ocrSinglePagePdf(pdfBytes, ocrModel, prompt) {
  const { getGenerativeModel, extractText, extractUsage } = require('./geminiClient');
  const model = getGenerativeModel({
    model: ocrModel || process.env.KB_OCR_MODEL || process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash',
  });
  const b64 = Buffer.from(pdfBytes).toString('base64');

  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await model.generateContent([
        { inlineData: { data: b64, mimeType: 'application/pdf' } },
        { text: prompt },
      ]);
      const usage = extractUsage(result);
      return {
        text: extractText(result).trim(),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      };
    } catch (e) {
      lastErr = e;
      if (attempt < 4) {
        const base = _isRateLimitError(e)
          ? Math.min(60000, 5000 * Math.pow(2, attempt))
          : 1000 * (attempt + 1);
        const jitter = Math.floor(Math.random() * 1000);
        await new Promise((r) => setTimeout(r, base + jitter));
      }
    }
  }
  throw lastErr || new Error('OCR failed');
}

// Smart PDF parser — per-page text/OCR decision based on mode.
async function parsePdfSmart(filePath, { ocrModel = null, pdfOcrMode = 'off', formatAware = false, saveTo = null } = {}) {
  const buf = fs.readFileSync(filePath);

  // Phase A:抽 PDF 內嵌圖(只抽 JPEG / DCTDecode,zero-decode 直接寫 .jpg)
  // FlateDecode PNG 需要解壓 + encoding,先跳過(避免加 sharp 依賴)
  let extractedImagePlaceholders = '';
  if (saveTo?.db && saveTo?.kbId) {
    try {
      const imgs = await _extractPdfEmbeddedImages(buf, saveTo);
      if (imgs.length > 0) {
        extractedImagePlaceholders = '\n\n[文件內嵌圖片]\n' +
          imgs.map((id) => `[圖片inline:${id}]`).join('\n');
        console.log(`[KBParser] PDF extracted ${imgs.length} JPEG embedded images`);
      }
    } catch (e) {
      console.warn('[KBParser] PDF image extract failed:', e.message);
    }
  }

  // Mode 'off' → fast pdf-parse text-layer only
  if (!pdfOcrMode || pdfOcrMode === 'off') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buf);
    return { text: (data.text || '') + extractedImagePlaceholders, ocrInputTokens: 0, ocrOutputTokens: 0 };
  }

  const prompt = formatAware ? PDF_PROMPT_FORMAT_AWARE : PDF_PROMPT_TEXT_ONLY;

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { PDFDocument } = require('pdf-lib');

  let pdfDoc;
  try {
    pdfDoc = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      disableWorker: true,
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;
  } catch (e) {
    console.warn(`[KBParser] pdfjs load failed: ${e.message} — fallback to text-only`);
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buf);
    return { text: data.text || '', ocrInputTokens: 0, ocrOutputTokens: 0 };
  }

  const numPages = pdfDoc.numPages;
  const OPS = pdfjs.OPS;

  // First pass: per-page text + image area ratio
  const pageInfo = [];
  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await pdfDoc.getPage(i);
      const info = await _analyzePdfPage(page, OPS);
      pageInfo.push({ pageNum: i, ...info });
      page.cleanup();
    } catch (e) {
      console.warn(`[KBParser] analyzePage ${i} failed: ${e.message}`);
      pageInfo.push({ pageNum: i, text: '', imgAreaRatio: 0 });
    }
  }

  // Auto-detect scanned: in 'auto' mode, if ≥90% of pages have <30 chars → scanned → force OCR
  let effectiveMode = pdfOcrMode;
  if (pdfOcrMode === 'auto') {
    const sparsePages = pageInfo.filter((p) => p.text.length < PDF_SCAN_CHARS_THRESHOLD).length;
    if (sparsePages / numPages >= PDF_SCAN_RATIO_THRESHOLD) {
      effectiveMode = 'force';
      console.log(`[KBParser] scanned PDF detected (${sparsePages}/${numPages} sparse pages) → force OCR`);
    }
  }

  const needsOcr = (p) => {
    if (effectiveMode === 'force') return true;
    if (effectiveMode === 'auto') return p.imgAreaRatio >= PDF_IMAGE_AREA_THRESHOLD;
    return false;
  };
  const ocrPageCount = pageInfo.filter(needsOcr).length;
  console.log(`[KBParser] PDF ${numPages} pages, ${ocrPageCount} need OCR (mode=${effectiveMode}, formatAware=${formatAware})`);

  if (ocrPageCount === 0) {
    return {
      text: pageInfo.map((p) => p.text).filter(Boolean).join('\n\n') + extractedImagePlaceholders,
      ocrInputTokens: 0,
      ocrOutputTokens: 0,
    };
  }

  let srcPdf;
  try {
    srcPdf = await PDFDocument.load(buf, { ignoreEncryption: true });
  } catch (e) {
    console.warn(`[KBParser] pdf-lib load failed: ${e.message} — using text layer only`);
    return {
      text: pageInfo.map((p) => p.text).filter(Boolean).join('\n\n') + extractedImagePlaceholders,
      ocrInputTokens: 0,
      ocrOutputTokens: 0,
    };
  }

  // Second pass: OCR pages in parallel (p-limit concurrency)
  const { default: pLimit } = await import('p-limit');
  const limit = pLimit(PDF_OCR_PAGE_CONCURRENCY);
  let ocrInputTokens = 0;
  let ocrOutputTokens = 0;

  const results = await Promise.all(pageInfo.map((p) => limit(async () => {
    if (!needsOcr(p)) return p.text;
    try {
      const dst = await PDFDocument.create();
      const [copied] = await dst.copyPages(srcPdf, [p.pageNum - 1]);
      dst.addPage(copied);
      const singleBytes = await dst.save();
      const r = await _ocrSinglePagePdf(singleBytes, ocrModel, prompt);
      ocrInputTokens += r.inputTokens;
      ocrOutputTokens += r.outputTokens;
      return r.text || p.text; // fallback to text layer if OCR returns empty
    } catch (e) {
      console.warn(`[KBParser] OCR page ${p.pageNum} failed: ${e.message} — using text layer`);
      return p.text;
    }
  })));

  return {
    text: results.filter(Boolean).join('\n\n') + extractedImagePlaceholders,
    ocrInputTokens,
    ocrOutputTokens,
  };
}

// Backwards-compatible wrapper — default mode='off' preserves the old fast path.
async function parsePdf(filePath, ocrModel = null, pdfOcrMode = 'off', opts = {}) {
  return parsePdfSmart(filePath, { ocrModel, pdfOcrMode, formatAware: false, saveTo: opts.saveTo || null });
}

// OCR all images in a zip archive that match pathRegex — in parallel (p-limit 20).
// Returns image texts in archive's iteration order (stable within same zip).
//
// Phase A 擴充(2026-05-12)— 如 opts.saveTo 提供 { db, kbId, docId },會把每張圖
// 持久化到 UPLOAD_BASE/kb/<kbId>/embedded/<uuid>.<ext> 並寫 kb_images row,
// 並在 OCR 文字段落內加上 `[圖片inline:<imageId>]` 佔位符 — chunker 後處理時
// 會把 imageId 抽到 chunk.metadata.image_ids,讓 chat 命中該 chunk 時能引用該圖。
const IMG_OCR_CONCURRENCY = Number(process.env.KB_IMG_OCR_CONCURRENCY || 20);
async function _ocrImagesInZip(zip, pathRegex, ocrModel, opts = {}) {
  const targets = [];
  for (const [name, file] of Object.entries(zip.files)) {
    if (pathRegex.test(name) && /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(name)) {
      targets.push({ name, file });
    }
  }
  if (targets.length === 0) return { imgTexts: [], ocrInputTokens: 0, ocrOutputTokens: 0 };

  const { default: pLimit } = await import('p-limit');
  const limit = pLimit(IMG_OCR_CONCURRENCY);
  let ocrInputTokens = 0;
  let ocrOutputTokens = 0;

  // 持久化準備(只有 saveTo 提供時才動)
  const saveTo = opts.saveTo;
  let crypto, UPLOAD_BASE, embedDir;
  if (saveTo?.db && saveTo?.kbId) {
    crypto = require('crypto');
    UPLOAD_BASE = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, '../uploads');
    embedDir = path.join(UPLOAD_BASE, 'kb', saveTo.kbId, 'embedded');
    try { fs.mkdirSync(embedDir, { recursive: true }); } catch (_) {}
  }

  const texts = await Promise.all(targets.map(({ name, file }) => limit(async () => {
    try {
      const imgBuf = await file.async('nodebuffer');
      const ext  = path.extname(name).slice(1).toLowerCase();
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      const { text: txt, inputTokens, outputTokens } = await imageToText(imgBuf, mime, ocrModel);
      ocrInputTokens += inputTokens;
      ocrOutputTokens += outputTokens;

      let imageId = null;
      if (saveTo && embedDir) {
        try {
          imageId = crypto.randomUUID();
          const storedFilename = `${imageId}.${ext}`;
          const absPath = path.join(embedDir, storedFilename);
          fs.writeFileSync(absPath, imgBuf);
          const relPath = path.posix.join('kb', saveTo.kbId, 'embedded', storedFilename);
          // OCR 文字當 caption(空字串時就 null)— 之後 user 可在圖庫改
          const caption = (txt || '').trim().slice(0, 500) || null;
          await saveTo.db.prepare(`
            INSERT INTO kb_images (id, kb_id, doc_id, chunk_id, source, filename, stored_path, mime_type, file_size, caption, created_by)
            VALUES (?, ?, ?, NULL, 'doc_embed', ?, ?, ?, ?, ?, ?)
          `).run(
            imageId, saveTo.kbId, saveTo.docId || null,
            path.basename(name), // 顯示用:原始 zip 內檔名(如 image1.png)
            relPath,
            mime,
            imgBuf.length,
            caption,
            saveTo.userId || null,
          );
        } catch (e) {
          console.warn(`[KBParser] persist embedded image ${name} failed:`, e.message);
          imageId = null;
        }
      }

      if (!txt && !imageId) return '';
      const lines = [];
      lines.push('[圖片文字]');
      if (txt) lines.push(txt);
      if (imageId) lines.push(`[圖片inline:${imageId}]`); // chunker 後處理會抽
      return lines.join('\n');
    } catch (e) {
      console.warn(`[KBParser] image OCR ${name} failed: ${e.message}`);
      return '';
    }
  })));

  return { imgTexts: texts.filter(Boolean), ocrInputTokens, ocrOutputTokens };
}

// Phase A:抽 PDF 內嵌圖 — 只抽 DCTDecode (JPEG),zero-encode 直接寫 .jpg。
// 回傳 [imageId, ...]。每張圖會建 kb_images row (source='doc_embed', caption_status='processing'),
// 並背景跑 vision caption(序列,避免一份 100 張圖瞬間打爆 API)。
async function _extractPdfEmbeddedImages(pdfBuf, saveTo) {
  const { PDFDocument, PDFRawStream, PDFName } = require('pdf-lib');
  const crypto = require('crypto');
  const UPLOAD_BASE = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, '../uploads');
  const embedDir = path.join(UPLOAD_BASE, 'kb', saveTo.kbId, 'embedded');
  try { fs.mkdirSync(embedDir, { recursive: true }); } catch (_) {}

  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(pdfBuf, { ignoreEncryption: true });
  } catch (e) {
    console.warn('[KBParser] pdf-lib load (image extract) failed:', e.message);
    return [];
  }

  const context = pdfDoc.context;
  const imageIds = [];
  const captionQueue = [];

  // 走所有 indirect objects,找 stream 且 /Subtype=/Image 且 Filter 含 DCTDecode
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    const subtype = dict.get(PDFName.of('Subtype'));
    if (!subtype || String(subtype) !== '/Image') continue;
    const filter = dict.get(PDFName.of('Filter'));
    const filterStr = filter ? String(filter) : '';
    if (!/DCT/.test(filterStr)) continue; // 只抽 JPEG 系列

    const bytes = obj.contents;
    if (!bytes || bytes.length === 0) continue;
    // 過濾迷你圖(像是裝飾線、bullet < 2KB)
    if (bytes.length < 2048) continue;

    const imageId = crypto.randomUUID();
    const storedFilename = `${imageId}.jpg`;
    const absPath = path.join(embedDir, storedFilename);
    try {
      fs.writeFileSync(absPath, Buffer.from(bytes));
      const relPath = path.posix.join('kb', saveTo.kbId, 'embedded', storedFilename);
      await saveTo.db.prepare(`
        INSERT INTO kb_images (id, kb_id, doc_id, chunk_id, source, filename, stored_path, mime_type, file_size, caption_status, created_by)
        VALUES (?, ?, ?, NULL, 'doc_embed', ?, ?, 'image/jpeg', ?, 'processing', ?)
      `).run(
        imageId, saveTo.kbId, saveTo.docId || null,
        `pdf-image-${imageIds.length + 1}.jpg`,
        relPath,
        bytes.length,
        saveTo.userId || null,
      );
      imageIds.push(imageId);
      captionQueue.push({ imageId, buffer: Buffer.from(bytes) });
    } catch (e) {
      console.warn(`[KBParser] PDF image persist failed: ${e.message}`);
      try { fs.unlinkSync(absPath); } catch (_) {}
    }
  }

  // 背景序列跑 caption(不 await,讓 parseDocument 趕快回)
  // 用序列避免一份 100 張圖瞬間爆 API quota
  if (captionQueue.length > 0) {
    setImmediate(async () => {
      for (const { imageId, buffer } of captionQueue) {
        try {
          const caption = await imageToText(buffer, 'image/jpeg', null);
          const text = (caption?.text || '').trim().slice(0, 500);
          await saveTo.db.prepare(`UPDATE kb_images SET caption=?, caption_status='done', updated_at=SYSTIMESTAMP WHERE id=?`)
            .run(text || null, imageId).catch(() => {});
        } catch (e) {
          await saveTo.db.prepare(`UPDATE kb_images SET caption_status='failed', caption_error=?, updated_at=SYSTIMESTAMP WHERE id=?`)
            .run(String(e.message || e).slice(0, 1000), imageId).catch(() => {});
        }
      }
      console.log(`[KBParser] PDF embedded image captioning done (${captionQueue.length} images)`);
    });
  }

  return imageIds;
}

async function parseDocx(filePath, ocrModel = null, opts = {}) {
  const JSZip = require('jszip');
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);

  // Main text — single-pass, yields every 1MB
  const docXml = await zip.file('word/document.xml')?.async('text');
  const mainText = await _stripDocxBodyXml(docXml);

  // OCR images (parallel) — 帶 saveTo 時會持久化進 kb_images
  const { imgTexts, ocrInputTokens, ocrOutputTokens } = await _ocrImagesInZip(zip, /^word\/media\//i, ocrModel, opts);

  return {
    text: [mainText, ...imgTexts].filter(Boolean).join('\n\n'),
    ocrInputTokens,
    ocrOutputTokens,
  };
}

/**
 * Legacy Word 97-2003 (.doc) parser — word-extractor npm, pure JS
 * 不支援嵌入圖 OCR（Word 97 binary 嵌圖複雜，成本不值得）；如需圖片解析，user 應改存 .docx。
 */
async function parseDoc(filePath) {
  const WordExtractor = require('word-extractor');
  const extractor = new WordExtractor();
  try {
    const doc = await extractor.extract(filePath);
    const text = [
      doc.getHeaders(),
      doc.getBody(),
      doc.getFootnotes(),
      doc.getEndnotes(),
      doc.getFooters(),
    ].filter(Boolean).join('\n\n').trim();
    return { text: text || '(無文字內容)', ocrInputTokens: 0, ocrOutputTokens: 0 };
  } catch (e) {
    throw new Error(`.doc 解析失敗：${e.message}（檔案可能損壞或加密）`);
  }
}

/**
 * Legacy PowerPoint 97-2003 (.ppt) parser
 * 作法：用 LibreOffice headless 轉成 .pptx，再走 parsePptx。
 * 環境：Docker image 已裝 libreoffice-impress + libreoffice-core。
 * 用 `timeout 60` 保險避免 soffice hang。
 */
async function parsePpt(filePath, ocrModel = null) {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);
  const os = require('os');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt2pptx-'));
  try {
    // soffice --headless --convert-to pptx --outdir <tmp> <input.ppt>
    await execFileAsync('soffice', [
      '--headless', '--convert-to', 'pptx', '--outdir', tmpDir, filePath,
    ], { timeout: 90000 });
    const base = path.basename(filePath, path.extname(filePath));
    const pptxPath = path.join(tmpDir, `${base}.pptx`);
    if (!fs.existsSync(pptxPath)) {
      throw new Error('LibreOffice 未產出 .pptx（轉檔失敗）');
    }
    const result = await parsePptx(pptxPath, ocrModel);
    return result;
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error('.ppt 需要 LibreOffice，但 image 未安裝（soffice not found）');
    }
    throw new Error(`.ppt 解析失敗：${e.message}`);
  } finally {
    // 清 tmp dir
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function parsePptx(filePath, ocrModel = null, opts = {}) {
  const JSZip = require('jszip');
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);

  const parts = [];

  // Slides (sorted numerically)
  const slideKeys = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
      const nb = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
      return na - nb;
    });

  for (const sk of slideKeys) {
    const xml = await zip.file(sk)?.async('text');
    if (!xml) continue;
    const txt = xml
      .replace(/<\/a:t>/g, ' ')
      .replace(/<a:br\s*\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/[ ]{2,}/g, ' ')
      .trim();
    if (txt) parts.push(txt);
  }

  // OCR images (parallel)
  const { imgTexts, ocrInputTokens, ocrOutputTokens } = await _ocrImagesInZip(zip, /^ppt\/media\//i, ocrModel, opts);
  parts.push(...imgTexts);

  return { text: parts.join('\n\n'), ocrInputTokens, ocrOutputTokens };
}

// Compute the tight bounding range of actually-populated cells.
// Excel often stores bloated !ref (e.g. A1:XEX16436) when users trigger
// phantom formatting — sheet_to_csv would iterate 100M+ empty cells and block
// the event loop for minutes. Override with the true occupied range.
function _tightenSheetRange(sheet) {
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const k of Object.keys(sheet)) {
    if (k.startsWith('!')) continue;
    const m = k.match(/^([A-Z]+)(\d+)$/);
    if (!m) continue;
    let c = 0;
    for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
    c -= 1;
    const r = parseInt(m[2], 10) - 1;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  if (minR === Infinity) return null; // empty sheet
  return { s: { r: minR, c: minC }, e: { r: maxR, c: maxC } };
}

// Return sheet_to_csv over the tight range (skips phantom blank cells).
function _sheetToCsvTight(sheet, xlsx) {
  const tight = _tightenSheetRange(sheet);
  if (!tight) return '';
  const origRef = sheet['!ref'];
  sheet['!ref'] = xlsx.utils.encode_range(tight);
  try {
    return xlsx.utils.sheet_to_csv(sheet, { blankrows: false });
  } finally {
    if (origRef !== undefined) sheet['!ref'] = origRef;
  }
}

// Yield control to the event loop so other HTTP requests (e.g. the client's
// status-poll GET) don't get starved while we crunch through many sheets.
const _yieldEventLoop = () => new Promise((r) => setImmediate(r));

// DOCX body XML → plain text.
// V8's native regex is very fast — a 6-replace chain on a 1MB XML is ~10ms.
// We keep that approach (don't reinvent it in JS) but yield between passes
// so a pathologically huge document.xml (tens of MB) doesn't starve other
// HTTP requests while each O(n) regex pass runs.
async function _stripDocxBodyXml(xml) {
  if (!xml) return '';
  let t = xml.replace(/<w:br[^>]*\/>/g, '\n');    await _yieldEventLoop();
  t = t.replace(/<\/w:p>/g, '\n');                await _yieldEventLoop();
  t = t.replace(/<[^>]+>/g, ' ');                 await _yieldEventLoop();
  t = t.replace(/&amp;/g, '&')
       .replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"')
       .replace(/&apos;/g, "'");                  await _yieldEventLoop();
  return t.replace(/ {2,}/g, ' ').trim();
}

async function parseExcel(filePath, ocrModel = null, opts = {}) {
  const JSZip = require('jszip');
  const xlsx  = require('xlsx');

  // Text: sheet data → CSV (use tight range to skip phantom empty cells)
  const wb = xlsx.readFile(filePath);
  const parts = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const csv = _sheetToCsvTight(sheet, xlsx);
    if (csv.trim()) parts.push(`[工作表: ${sheetName}]\n${csv}`);
    await _yieldEventLoop();
  }

  // OCR embedded images (parallel)
  let ocrInputTokens = 0, ocrOutputTokens = 0;
  try {
    const buf = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(buf);
    const r = await _ocrImagesInZip(zip, /^xl\/media\//i, ocrModel, opts);
    parts.push(...r.imgTexts);
    ocrInputTokens = r.ocrInputTokens;
    ocrOutputTokens = r.ocrOutputTokens;
  } catch (e) {
    console.warn('[KBParser] Excel image OCR error:', e.message);
  }

  return { text: parts.join('\n\n'), ocrInputTokens, ocrOutputTokens };
}

/**
 * Parse any supported file type to plain text.
 * @param {string} filePath
 * @param {string} [fileType] file extension without dot, e.g. 'pdf'
 * @param {string|null} [ocrModel]
 * @param {string} [parseMode]  'text_only' (default) | 'format_aware'
 * @param {string} [pdfOcrMode]
 * @param {object} [opts]  { emlDepth?: number — 遞迴 .eml 內附件時的層數 }
 * @returns {Promise<{ text: string, ocrInputTokens: number, ocrOutputTokens: number }>}
 */
async function parseDocument(filePath, fileType, ocrModel = null, parseMode = 'text_only', pdfOcrMode = 'off', opts = {}) {
  const ext = (fileType || path.extname(filePath)).toLowerCase().replace(/^\./, '');
  const fa = parseMode === 'format_aware';
  // Phase A:saveTo = { db, kbId, docId, userId } 提供時,zip-based parser 會把
  // 內嵌圖持久化進 kb_images,並在 OCR 文字裡塞 `[圖片inline:<imageId>]` 佔位符。
  const parseOpts = { saveTo: opts.saveTo };
  switch (ext) {
    case 'pdf':  return fa ? parsePdfFormatAware(filePath, ocrModel, pdfOcrMode, parseOpts) : parsePdf(filePath, ocrModel, pdfOcrMode, parseOpts);
    case 'docx': return fa ? parseDocxFormatAware(filePath, ocrModel, parseOpts) : parseDocx(filePath, ocrModel, parseOpts);
    case 'doc':  return await parseDoc(filePath); // legacy Word 97-2003 via word-extractor (pure JS)
    case 'xlsx': case 'xls': return fa ? parseExcelFormatAware(filePath, ocrModel, parseOpts) : parseExcel(filePath, ocrModel, parseOpts);
    case 'pptx': return await parsePptx(filePath, ocrModel, parseOpts);
    case 'ppt':  return await parsePpt(filePath, ocrModel); // legacy PPT 97-2003 via LibreOffice convert → pptx
    case 'eml': {
      const { parseEml } = require('./emlParser');
      return await parseEml(filePath, {
        parseAttachments: true,           // KB 路徑一律遞迴展開附件
        ocrModel,
        depth: opts.emlDepth || 0,        // 嵌套 eml 從 emlParser 帶 depth+1 進來
      });
    }
    case 'jpg': case 'jpeg': case 'png': case 'gif': case 'webp': case 'bmp': {
      const imgBuf = fs.readFileSync(filePath);
      const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : `image/${ext}`;
      const { text, inputTokens, outputTokens } = await imageToText(imgBuf, mime, ocrModel);
      return { text: text || '(無文字內容)', ocrInputTokens: inputTokens, ocrOutputTokens: outputTokens };
    }
    default: {
      try { return { text: fs.readFileSync(filePath, 'utf8'), ocrInputTokens: 0, ocrOutputTokens: 0 }; }
      catch { return { text: '', ocrInputTokens: 0, ocrOutputTokens: 0 }; }
    }
  }
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

function preprocessText(text, { replaceWhitespace = true, removeUrls = false } = {}) {
  let t = text;
  if (replaceWhitespace) {
    t = t.replace(/\r\n/g, '\n').replace(/\t/g, ' ').replace(/[ ]{2,}/g, ' ');
  }
  if (removeUrls) {
    t = t.replace(/https?:\/\/\S+/g, '[URL]');
    t = t.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');
  }
  return t.trim();
}

/**
 * Split a single oversized paragraph into sub-chunks ≤ max_size.
 * Tries progressively finer delimiters: '\n' → ',' → ' ' → hard char split.
 * Applies `overlap` at every cut point so context isn't lost between sub-chunks.
 * Returns an array of sub-chunks, each ≤ max_size.
 */
function _splitOversizedPara(para, max_size, overlap) {
  if (para.length <= max_size) return [para];

  // Try delimiters in order: newline → comma → space → hard split
  const delimiters = ['\n', ',', ' '];
  for (const delim of delimiters) {
    if (!para.includes(delim)) continue;
    const parts = para.split(delim);
    if (parts.length < 2) continue;

    const out = [];
    let cur = '';
    for (const p of parts) {
      if (!cur) {
        cur = p;
      } else if ((cur + delim + p).length <= max_size) {
        cur += delim + p;
      } else {
        out.push(cur);
        const tail = overlap > 0 && cur.length > overlap ? cur.slice(-overlap) : '';
        cur = tail ? tail + delim + p : p;
      }
    }
    if (cur) out.push(cur);

    // If any produced sub-chunk is still oversized, recurse into next delimiter.
    if (out.some((c) => c.length > max_size)) {
      const flat = [];
      for (const c of out) {
        flat.push(..._splitOversizedPara(c, max_size, overlap));
      }
      return flat;
    }
    return out;
  }

  // Last resort: hard character-level split with overlap
  const out = [];
  const step = Math.max(1, max_size - overlap);
  for (let i = 0; i < para.length; i += step) {
    out.push(para.slice(i, i + max_size));
  }
  return out;
}

/**
 * Regular / paragraph chunking.
 * Splits by separator, merges paragraphs up to max_size, adds overlap.
 * Paragraphs larger than max_size are themselves split by finer delimiters.
 * @returns {{ content: string }[]}
 */
function chunkRegular(text, cfg = {}) {
  const {
    separator    = '\n\n',
    max_size     = 1024,
    overlap      = 50,
    remove_urls  = false,
  } = cfg;

  const processed = preprocessText(text, { removeUrls: remove_urls });
  const sep = separator.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  const rawParas = processed.split(sep).map((s) => s.trim()).filter(Boolean);

  // Pre-expand oversized paragraphs so the merge loop below only deals with
  // paragraphs that already fit. Without this, a 15KB sheet CSV becomes one
  // giant unsplittable chunk and the embedding averages 15KB of content.
  const paras = [];
  for (const p of rawParas) {
    if (p.length <= max_size) { paras.push(p); continue; }
    paras.push(..._splitOversizedPara(p, max_size, overlap));
  }

  const chunks = [];
  let current = '';

  // xlsx parser 在每個 sheet 開頭插入 `[工作表: XXX]`。
  // 小 sheet 若被併入前一個 chunk，訊號會被稀釋（Matryoshka embedding 對 1000+
  // 字的混合內容語意區分度差）。遇到 sheet 邊界強制切開 chunk。
  const SHEET_BOUNDARY_RE = /^\[工作表:\s/;

  for (const para of paras) {
    const isSheetBoundary = SHEET_BOUNDARY_RE.test(para);
    if (!current) {
      current = para;
    } else if (isSheetBoundary) {
      // 硬分段：flush 現有 chunk，新 sheet 開新 chunk（不帶 overlap）
      chunks.push(current);
      current = para;
    } else if ((current + sep + para).length <= max_size) {
      current += sep + para;
    } else {
      chunks.push(current);
      // Apply overlap only if the resulting chunk still fits — otherwise
      // we'd create an oversized chunk (paragraph is already ≤ max_size
      // after the pre-expansion above).
      const tail = overlap > 0 && current.length > overlap ? current.slice(-overlap) : '';
      const withOverlap = tail ? tail + sep + para : para;
      current = withOverlap.length <= max_size ? withOverlap : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks.map((c) => ({ content: c }));
}

/**
 * Parent-child chunking.
 * Parent = large context chunk, child = smaller retrieval chunk.
 * @returns {{ content: string, parent_content: string | null, chunk_type: 'child' | 'regular' }[]}
 */
function chunkParentChild(text, cfg = {}) {
  const {
    parent_separator = '\n\n',
    parent_max_size  = 1024,
    child_separator  = '\n',
    child_max_size   = 512,
    remove_urls      = false,
  } = cfg;

  const processed = preprocessText(text, { removeUrls: remove_urls });

  // Build parent chunks
  const parents = chunkRegular(processed, {
    separator: parent_separator,
    max_size:  parent_max_size,
    overlap:   0,
  }).map((c) => c.content);

  const result = [];
  for (const parent of parents) {
    const childSep  = child_separator.replace(/\\n/g, '\n');
    const rawChildParts = parent.split(childSep).map((s) => s.trim()).filter(Boolean);

    // Pre-expand oversized child parts (same issue as regular chunking)
    const childParts = [];
    for (const p of rawChildParts) {
      if (p.length <= child_max_size) { childParts.push(p); continue; }
      childParts.push(..._splitOversizedPara(p, child_max_size, 0));
    }

    const children  = [];
    let cur = '';
    for (const part of childParts) {
      if (!cur) {
        cur = part;
      } else if ((cur + childSep + part).length <= child_max_size) {
        cur += childSep + part;
      } else {
        children.push(cur);
        cur = part;
      }
    }
    if (cur) children.push(cur);
    const childList = children.length > 0 ? children : [parent];
    for (const child of childList) {
      result.push({ content: child, parent_content: parent, chunk_type: 'child' });
    }
  }
  return result;
}

// ─── Format-aware document parsers ───────────────────────────────────────────

async function parsePdfFormatAware(filePath, ocrModel = null, pdfOcrMode = 'off', opts = {}) {
  return parsePdfSmart(filePath, { ocrModel, pdfOcrMode, formatAware: true, saveTo: opts.saveTo || null });
}

async function parseDocxFormatAware(filePath, ocrModel = null, opts = {}) {
  const JSZip = require('jszip');
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);

  let mainText = '';
  const docXml = await zip.file('word/document.xml')?.async('text');
  if (docXml) {
    const paragraphs = [];
    const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
    let pm;
    let count = 0;
    while ((pm = paraRegex.exec(docXml)) !== null) {
      const txt = extractParaFormatAware(pm[0]);
      if (txt.trim()) paragraphs.push(txt);
      // Yield every 500 paragraphs so huge docs don't starve the event loop
      if (++count % 500 === 0) await _yieldEventLoop();
    }
    mainText = paragraphs.join('\n');
  }

  // OCR images (parallel)
  const { imgTexts, ocrInputTokens, ocrOutputTokens } = await _ocrImagesInZip(zip, /^word\/media\//i, ocrModel, opts);

  return {
    text: [mainText, ...imgTexts].filter(Boolean).join('\n\n'),
    ocrInputTokens,
    ocrOutputTokens,
  };
}

async function parseExcelFormatAware(filePath, ocrModel = null, opts = {}) {
  const JSZip = require('jszip');
  const xlsx  = require('xlsx');

  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);

  // 1. Parse xl/styles.xml → array of label strings indexed by xf style index
  const stylesXml  = await zip.file('xl/styles.xml')?.async('text') || '';
  const styleLabels = _parseXlsxStyleLabels(stylesXml);

  // 2. Resolve sheet name → sheet file path via workbook rels
  const wbXml  = await zip.file('xl/workbook.xml')?.async('text') || '';
  const wbRels = await zip.file('xl/_rels/workbook.xml.rels')?.async('text') || '';
  const sheetPaths = _parseSheetPaths(wbXml, wbRels); // [{name, path}]

  // 3. Read workbook once for cell values (xlsx handles shared strings / formulas)
  const wb = xlsx.read(buf);
  const parts = [];

  for (const { name, path: sheetRelPath } of sheetPaths) {
    const sheet = wb.Sheets[name];
    if (!sheet || !sheet['!ref']) continue;

    // Build addr → style index map from raw sheet XML
    const sheetXml = await zip.file(`xl/${sheetRelPath}`)?.async('text') || '';
    const addrStyle = {};
    const cellRe = /<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(sheetXml)) !== null) {
      const attrs = cm[1];
      const r = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const s = attrs.match(/\bs="(\d+)"/)?.[1];
      if (r && s !== undefined) addrStyle[r] = parseInt(s);
    }

    // Use tight range (actual occupied cells) to avoid phantom-range blow-up
    const range = _tightenSheetRange(sheet) || xlsx.utils.decode_range(sheet['!ref']);
    const rows  = [];
    for (let R = range.s.r; R <= range.e.r; R++) {
      const rowCells = [];
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = xlsx.utils.encode_cell({ r: R, c: C });
        const cell = sheet[addr];
        if (!cell) { rowCells.push(''); continue; }
        const val   = cell.v !== undefined ? String(cell.v) : '';
        const sIdx  = addrStyle[addr];
        const label = sIdx !== undefined ? (styleLabels[sIdx] || null) : null;
        rowCells.push(label ? `${val}[${label}]` : val);
      }
      rows.push(rowCells.join(','));
    }
    if (rows.length) parts.push(`[工作表: ${name}]\n${rows.join('\n')}`);
    await _yieldEventLoop();
  }

  // 4. OCR embedded images (parallel)
  let ocrInputTokens = 0, ocrOutputTokens = 0;
  try {
    const r = await _ocrImagesInZip(zip, /^xl\/media\//i, ocrModel, opts);
    parts.push(...r.imgTexts);
    ocrInputTokens = r.ocrInputTokens;
    ocrOutputTokens = r.ocrOutputTokens;
  } catch (e) {
    console.warn('[KBParser] Excel format-aware image OCR error:', e.message);
  }

  return { text: parts.join('\n\n'), ocrInputTokens, ocrOutputTokens };
}

/**
 * Parse xl/_rels/workbook.xml.rels + xl/workbook.xml
 * → [{name, path}] in sheet order, path relative to xl/
 */
function _parseSheetPaths(wbXml, wbRels) {
  const relMap = {};
  const relRe = /<Relationship\b[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g;
  let rm;
  while ((rm = relRe.exec(wbRels)) !== null) relMap[rm[1]] = rm[2].replace(/^\.\.\//, '');

  const sheets = [];
  // Extract each <sheet ...> tag and parse its attributes independently (order-insensitive)
  const sheetTagRe = /<sheet\b([^>]*?)(?:\/>|>)/g;
  let sm;
  while ((sm = sheetTagRe.exec(wbXml)) !== null) {
    const attrs = sm[1];
    const name  = attrs.match(/\bname="([^"]+)"/)?.[1];
    const rId   = attrs.match(/\br:id="([^"]+)"/)?.[1] || attrs.match(/\bid="([^"]+)"/)?.[1];
    if (name && rId) {
      const target = relMap[rId];
      if (target) sheets.push({ name, path: target });
    }
  }
  return sheets;
}

/**
 * Parse xl/styles.xml → array of label strings indexed by cellXfs index.
 * Labels: '刪除線', '藍色', '紅色', '橙色', '黃色', '綠色' (or combinations joined by '/')
 */
function _parseXlsxStyleLabels(xml) {
  // --- fonts ---
  const fonts = [];
  const fontsXml = xml.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/)?.[1] || '';
  const fontRe = /<font\b[^>]*>([\s\S]*?)<\/font>/g;
  let fm;
  while ((fm = fontRe.exec(fontsXml)) !== null) {
    const fXml = fm[1];
    const strike     = /<strike\b/.test(fXml);
    const colorRgb   = fXml.match(/<color\b[^>]+rgb="([0-9A-Fa-f]{6,8})"/)?.[1];
    const colorTheme = fXml.match(/<color\b[^>]+theme="(\d+)"/)?.[1];
    const colorIdx   = fXml.match(/<color\b[^>]+indexed="(\d+)"/)?.[1];
    // Resolve indexed color → RGB
    const idxRgb = colorIdx !== undefined
      ? (XLSX_INDEXED_COLORS[parseInt(colorIdx)] || null)
      : null;
    fonts.push({
      strike,
      colorRgb:   colorRgb ? colorRgb.slice(-6) : (idxRgb || null),
      colorTheme: colorTheme !== undefined ? parseInt(colorTheme) : null,
    });
  }

  // --- fills ---
  const fills = [];
  const fillsXml = xml.match(/<fills\b[^>]*>([\s\S]*?)<\/fills>/)?.[1] || '';
  const fillRe = /<fill\b[^>]*>([\s\S]*?)<\/fill>/g;
  let flm;
  while ((flm = fillRe.exec(fillsXml)) !== null) {
    const flXml      = flm[1];
    const fgRgb      = flXml.match(/<fgColor\b[^>]+rgb="([0-9A-Fa-f]{6,8})"/)?.[1];
    const fgIdx      = flXml.match(/<fgColor\b[^>]+indexed="(\d+)"/)?.[1];
    const fgTheme    = flXml.match(/<fgColor\b[^>]+theme="(\d+)"/)?.[1];
    const idxRgb     = fgIdx !== undefined ? (XLSX_INDEXED_COLORS[parseInt(fgIdx)] || null) : null;
    fills.push({
      fgRgb:    fgRgb ? fgRgb.slice(-6) : (idxRgb || null),
      fgTheme:  fgTheme !== undefined ? parseInt(fgTheme) : null,
    });
  }

  // theme index → color label (Office default theme colors)
  const THEME_LABEL = { 4:'藍色', 5:'紅色', 6:'橙色', 7:'黃色', 8:'綠色', 9:'紅色', 10:'藍色' };

  // --- cellXfs → label per style index ---
  const styleLabels = [];
  const xfsXml = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || '';
  const xfRe = /<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g;
  let xm;
  while ((xm = xfRe.exec(xfsXml)) !== null) {
    const attrs  = xm[1];
    const fontId = parseInt(attrs.match(/fontId="(\d+)"/)?.[1] || '0');
    const fillId = parseInt(attrs.match(/fillId="(\d+)"/)?.[1] || '0');
    const font   = fonts[fontId] || {};
    const fill   = fills[fillId] || {};
    const labels = [];

    if (font.strike) labels.push('刪除線');
    if (font.colorRgb) {
      const l = classifyRgbColor(font.colorRgb);
      if (l) labels.push(l);
    }
    if (font.colorTheme !== null && THEME_LABEL[font.colorTheme]) {
      const l = THEME_LABEL[font.colorTheme];
      if (!labels.includes(l)) labels.push(l);
    }
    if (fill.fgRgb) {
      const l = classifyRgbColor(fill.fgRgb);
      if (l && !labels.includes(l)) labels.push(l);
    } else if (fill.fgTheme !== null && THEME_LABEL[fill.fgTheme]) {
      const l = THEME_LABEL[fill.fgTheme];
      if (!labels.includes(l)) labels.push(l);
    }
    styleLabels.push(labels.length ? labels.join('/') : null);
  }
  return styleLabels;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatch to the right chunking strategy.
 * @param {string} text
 * @param {object} config  KB chunk_config JSON
 * @param {string} strategy  'regular' | 'parent_child'
 * @returns {{ content: string, parent_content?: string, chunk_type?: string }[]}
 */
function chunkDocument(text, strategy = 'regular', config = {}) {
  if (strategy === 'parent_child') return chunkParentChild(text, config);
  return chunkRegular(text, config);
}

module.exports = { parseDocument, chunkDocument, imageToText };
