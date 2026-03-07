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
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: ocrModel || process.env.KB_OCR_MODEL || process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash',
    });
    const result = await model.generateContent([
      { inlineData: { data: imageBuffer.toString('base64'), mimeType } },
      {
        text: '請將這張圖片中的所有文字完整提取出來。如果是表格請保持表格格式，如果是圖表請描述圖表內容與數據。只輸出圖片中包含的資訊，不要加入額外說明。如果圖片沒有文字內容，輸出「(無文字)」。',
      },
    ]);
    const txt = result.response.text().trim();
    const usage = result.response.usageMetadata || {};
    return {
      text: txt === '(無文字)' ? '' : txt,
      inputTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0,
    };
  } catch (e) {
    console.warn('[KBParser] imageToText error:', e.message);
    return { text: '', inputTokens: 0, outputTokens: 0 };
  }
}

// ─── Document parsers ─────────────────────────────────────────────────────────

// PDF: use Gemini native PDF understanding (handles text + embedded images/OCR).
// Falls back to pdf-parse (text-layer only) if file too large or Gemini fails.
// Returns { text, ocrInputTokens, ocrOutputTokens }
const PDF_GEMINI_MAX_MB = Number(process.env.KB_PDF_OCR_MAX_MB || 18);

async function parsePdf(filePath, ocrModel = null) {
  const buf = fs.readFileSync(filePath);
  const sizeMb = buf.length / (1024 * 1024);

  if (sizeMb <= PDF_GEMINI_MAX_MB) {
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: ocrModel || process.env.KB_OCR_MODEL || process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash',
      });
      const result = await model.generateContent([
        { inlineData: { data: buf.toString('base64'), mimeType: 'application/pdf' } },
        {
          text: '請完整提取此 PDF 文件中所有內容，包括文字、表格、圖片中的文字與說明。保持段落結構，表格以文字形式呈現，圖片標記為 [圖片文字: <內容>]。',
        },
      ]);
      const usage = result.response.usageMetadata || {};
      return {
        text: result.response.text().trim(),
        ocrInputTokens: usage.promptTokenCount || 0,
        ocrOutputTokens: usage.candidatesTokenCount || 0,
      };
    } catch (e) {
      console.warn(`[KBParser] PDF Gemini OCR failed (${sizeMb.toFixed(1)}MB), fallback to text-only:`, e.message);
    }
  } else {
    console.log(`[KBParser] PDF too large for Gemini OCR (${sizeMb.toFixed(1)}MB > ${PDF_GEMINI_MAX_MB}MB), using text-only`);
  }

  // Fallback: pdf-parse text layer only
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buf);
  return { text: data.text || '', ocrInputTokens: 0, ocrOutputTokens: 0 };
}

async function parseDocx(filePath, ocrModel = null) {
  const JSZip = require('jszip');
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);

  // Main text
  let mainText = '';
  const docXml = await zip.file('word/document.xml')?.async('text');
  if (docXml) {
    mainText = docXml
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  // OCR images
  const imgTexts = [];
  let ocrInputTokens = 0, ocrOutputTokens = 0;
  for (const [name, file] of Object.entries(zip.files)) {
    if (/^word\/media\//i.test(name) && /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(name)) {
      const imgBuf = await file.async('nodebuffer');
      const ext  = path.extname(name).slice(1).toLowerCase();
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      const { text: txt, inputTokens, outputTokens } = await imageToText(imgBuf, mime, ocrModel);
      ocrInputTokens += inputTokens;
      ocrOutputTokens += outputTokens;
      if (txt) imgTexts.push(`[圖片文字]\n${txt}`);
    }
  }

  return {
    text: [mainText, ...imgTexts].filter(Boolean).join('\n\n'),
    ocrInputTokens,
    ocrOutputTokens,
  };
}

async function parsePptx(filePath, ocrModel = null) {
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

  // OCR images
  let ocrInputTokens = 0, ocrOutputTokens = 0;
  for (const [name, file] of Object.entries(zip.files)) {
    if (/^ppt\/media\//i.test(name) && /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(name)) {
      const imgBuf = await file.async('nodebuffer');
      const ext  = path.extname(name).slice(1).toLowerCase();
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      const { text: txt, inputTokens, outputTokens } = await imageToText(imgBuf, mime, ocrModel);
      ocrInputTokens += inputTokens;
      ocrOutputTokens += outputTokens;
      if (txt) parts.push(`[圖片文字]\n${txt}`);
    }
  }

  return { text: parts.join('\n\n'), ocrInputTokens, ocrOutputTokens };
}

async function parseExcel(filePath, ocrModel = null) {
  const JSZip = require('jszip');
  const xlsx  = require('xlsx');

  // Text: sheet data → CSV
  const wb = xlsx.readFile(filePath);
  const parts = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const csv = xlsx.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) parts.push(`[工作表: ${sheetName}]\n${csv}`);
  }

  // OCR: images embedded in xl/media/
  let ocrInputTokens = 0, ocrOutputTokens = 0;
  try {
    const buf = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(buf);
    for (const [name, file] of Object.entries(zip.files)) {
      if (/^xl\/media\//i.test(name) && /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(name)) {
        const imgBuf = await file.async('nodebuffer');
        const ext  = path.extname(name).slice(1).toLowerCase();
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        const { text: txt, inputTokens, outputTokens } = await imageToText(imgBuf, mime, ocrModel);
        ocrInputTokens += inputTokens;
        ocrOutputTokens += outputTokens;
        if (txt) parts.push(`[圖片文字]\n${txt}`);
      }
    }
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
 * @returns {Promise<{ text: string, ocrInputTokens: number, ocrOutputTokens: number }>}
 */
async function parseDocument(filePath, fileType, ocrModel = null, parseMode = 'text_only') {
  const ext = (fileType || path.extname(filePath)).toLowerCase().replace(/^\./, '');
  const fa = parseMode === 'format_aware';
  switch (ext) {
    case 'pdf':  return fa ? parsePdfFormatAware(filePath, ocrModel)  : parsePdf(filePath, ocrModel);
    case 'docx': return fa ? parseDocxFormatAware(filePath, ocrModel) : parseDocx(filePath, ocrModel);
    case 'xlsx': case 'xls': return fa ? parseExcelFormatAware(filePath, ocrModel) : parseExcel(filePath, ocrModel);
    case 'pptx': return await parsePptx(filePath, ocrModel); // pptx: no colour metadata, always text_only
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
 * Regular / paragraph chunking.
 * Splits by separator, merges paragraphs up to max_size, adds overlap.
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
  const paras = processed.split(sep).map((s) => s.trim()).filter(Boolean);

  const chunks = [];
  let current = '';

  for (const para of paras) {
    if (!current) {
      current = para;
    } else if ((current + sep + para).length <= max_size) {
      current += sep + para;
    } else {
      chunks.push(current);
      const overlapText = overlap > 0 && current.length > overlap
        ? current.slice(-overlap)
        : '';
      current = overlapText ? overlapText + sep + para : para;
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
    const childParts = parent.split(childSep).map((s) => s.trim()).filter(Boolean);
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

async function parsePdfFormatAware(filePath, ocrModel = null) {
  const buf = fs.readFileSync(filePath);
  const sizeMb = buf.length / (1024 * 1024);

  if (sizeMb <= PDF_GEMINI_MAX_MB) {
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: ocrModel || process.env.KB_OCR_MODEL || process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash',
      });
      const result = await model.generateContent([
        { inlineData: { data: buf.toString('base64'), mimeType: 'application/pdf' } },
        {
          text: `請完整提取此 PDF 文件中所有內容，並依照以下規則標注視覺格式：
1. 紅色文字或紅色底色 → 在該文字後緊接標注 [紅色]
2. 橙色文字或橙色底色 → 在該文字後緊接標注 [橙色]
3. 黃色底色或黃色螢光標記 → 在該文字後緊接標注 [黃色]
4. 綠色文字或綠色底色 → 在該文字後緊接標注 [綠色]
5. 藍色或青色文字/底色 → 在該文字後緊接標注 [藍色]
6. 刪除線文字 → 在該文字後緊接標注 [刪除線]
7. 表格：以文字形式逐列呈現，保留欄位名稱與對應值
8. 圖片中的文字：標記為 [圖片文字: <內容>]
9. 如果某段落沒有特殊格式，直接輸出純文字即可。僅輸出文件內容，不加額外說明或前言。`,
        },
      ]);
      const usage = result.response.usageMetadata || {};
      return {
        text: result.response.text().trim(),
        ocrInputTokens: usage.promptTokenCount || 0,
        ocrOutputTokens: usage.candidatesTokenCount || 0,
      };
    } catch (e) {
      console.warn(`[KBParser] PDF format-aware Gemini failed, fallback to text_only:`, e.message);
    }
  }
  // Fallback to text_only
  return parsePdf(filePath, ocrModel);
}

async function parseDocxFormatAware(filePath, ocrModel = null) {
  const JSZip = require('jszip');
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);

  let mainText = '';
  const docXml = await zip.file('word/document.xml')?.async('text');
  if (docXml) {
    const paragraphs = [];
    const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
    let pm;
    while ((pm = paraRegex.exec(docXml)) !== null) {
      const txt = extractParaFormatAware(pm[0]);
      if (txt.trim()) paragraphs.push(txt);
    }
    mainText = paragraphs.join('\n');
  }

  // OCR images (same as parseDocx)
  const imgTexts = [];
  let ocrInputTokens = 0, ocrOutputTokens = 0;
  for (const [name, file] of Object.entries(zip.files)) {
    if (/^word\/media\//i.test(name) && /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(name)) {
      const imgBuf = await file.async('nodebuffer');
      const ext  = path.extname(name).slice(1).toLowerCase();
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      const { text: txt, inputTokens, outputTokens } = await imageToText(imgBuf, mime, ocrModel);
      ocrInputTokens += inputTokens;
      ocrOutputTokens += outputTokens;
      if (txt) imgTexts.push(`[圖片文字]\n${txt}`);
    }
  }

  return {
    text: [mainText, ...imgTexts].filter(Boolean).join('\n\n'),
    ocrInputTokens,
    ocrOutputTokens,
  };
}

async function parseExcelFormatAware(filePath, ocrModel = null) {
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

    const range = xlsx.utils.decode_range(sheet['!ref']);
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
  }

  // 4. OCR embedded images
  let ocrInputTokens = 0, ocrOutputTokens = 0;
  try {
    for (const [name, file] of Object.entries(zip.files)) {
      if (/^xl\/media\//i.test(name) && /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(name)) {
        const imgBuf = await file.async('nodebuffer');
        const ext  = path.extname(name).slice(1).toLowerCase();
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        const { text: txt, inputTokens, outputTokens } = await imageToText(imgBuf, mime, ocrModel);
        ocrInputTokens += inputTokens;
        ocrOutputTokens += outputTokens;
        if (txt) parts.push(`[圖片文字]\n${txt}`);
      }
    }
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
