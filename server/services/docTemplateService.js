'use strict';
/**
 * Document Template Service
 * Handles: analyze, createTemplate (DOCX/XLSX/PDF), generateDocument, download, fork
 */

const path = require('path');
const fs = require('fs').promises;
const { v4: uuid } = require('uuid');
const JSZip = require('jszip');
const mammoth = require('mammoth');

const { generateTextSync, MODEL_FLASH, MODEL_PRO } = require('./gemini');

// Allow override via env var or system_settings (read at call time via getAnalysisModel)
const TEMPLATE_ANALYSIS_MODEL = process.env.TEMPLATE_ANALYSIS_MODEL || null;

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

const TEMPLATES_DIR = path.join(UPLOAD_DIR, 'templates');

async function ensureTemplatesDir() {
  await fs.mkdir(TEMPLATES_DIR, { recursive: true });
}

// ─── Access Check ──────────────────────────────────────────────────────────────

/**
 * Returns 'owner' | 'edit' | 'use' | null
 */
async function checkAccess(db, templateId, user) {
  if (user.role === 'admin') return 'owner';

  const tpl = await db.prepare(
    'SELECT creator_id, is_public FROM doc_templates WHERE id=?'
  ).get(templateId);
  if (!tpl) return null;

  if (tpl.creator_id === user.id) return 'owner';

  const shares = await db.prepare(`
    SELECT share_type FROM doc_template_shares
    WHERE template_id = ? AND (
      (grantee_type='user'        AND grantee_id=?) OR
      (grantee_type='role'        AND grantee_id=?) OR
      (grantee_type='department'  AND grantee_id=?) OR
      (grantee_type='cost_center' AND grantee_id=?) OR
      (grantee_type='division'    AND grantee_id=?) OR
      (grantee_type='org_group'   AND grantee_id=?)
    )
  `).all(
    templateId,
    String(user.id),
    user.role_id   || '',
    user.department || '',
    user.profit_center || '',
    user.org_section || '',
    user.org_group   || ''
  );

  if (shares.some(s => s.share_type === 'edit')) return 'edit';
  if (shares.some(s => s.share_type === 'use'))  return 'use';
  if (tpl.is_public === 1) return 'use';

  return null;
}

// ─── Text Extraction ───────────────────────────────────────────────────────────

async function extractText(filePath, format) {
  console.log(`[DocTemplate] extractText: format=${format}, path=${filePath}`);
  const buf = await fs.readFile(filePath);
  console.log(`[DocTemplate] 檔案大小: ${buf.length} bytes`);

  if (format === 'docx') {
    const result = await mammoth.extractRawText({ buffer: buf });
    console.log(`[DocTemplate] mammoth 擷取完成，文字長度=${result.value.length}，警告數=${result.messages.length}`);
    if (result.messages.length) console.warn('[DocTemplate] mammoth 警告:', result.messages.map(m => m.message).join('; '));
    return result.value;
  }

  if (format === 'xlsx') {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const lines = [];
    wb.eachSheet(sheet => {
      sheet.eachRow(row => {
        const cells = [];
        row.eachCell(cell => cells.push(String(cell.value ?? '')));
        lines.push(cells.join('\t'));
      });
    });
    const text = lines.join('\n');
    console.log(`[DocTemplate] ExcelJS 擷取完成，文字長度=${text.length}`);
    return text;
  }

  if (format === 'pptx') {
    const zip = new JSZip();
    await zip.loadAsync(buf);
    const slideFiles = Object.keys(zip.files)
      .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort();
    const texts = [];
    for (const sf of slideFiles) {
      const xmlStr = await zip.file(sf).async('string');
      const matches = xmlStr.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [];
      const slideText = matches.map(m => m.replace(/<[^>]+>/g, '')).join(' ');
      if (slideText.trim()) texts.push(slideText.trim());
    }
    const text = texts.join('\n');
    console.log(`[DocTemplate] PPTX 擷取完成，投影片=${slideFiles.length}，文字長度=${text.length}`);
    return text;
  }

  if (format === 'pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buf);
      console.log(`[DocTemplate] pdf-parse 擷取完成，文字長度=${data.text.length}`);
      return data.text;
    } catch (e) {
      console.error('[DocTemplate] pdf-parse 失敗:', e.message);
      return '';
    }
  }

  console.warn(`[DocTemplate] 未知格式: ${format}`);
  return '';
}

// ─── AI Variable Analysis ──────────────────────────────────────────────────────

async function analyzeVariables(text, model) {
  const useModel = model || TEMPLATE_ANALYSIS_MODEL || MODEL_FLASH;
  console.log(`[DocTemplate] analyzeVariables: 文字長度=${text.length}, 模型=${useModel}`);

  if (!text || text.trim().length < 10) {
    console.warn('[DocTemplate] analyzeVariables: 擷取文字過短，無法分析');
    return { variables: [], confidence: 0, notes: '文件文字擷取失敗或內容過短' };
  }

  const prompt = `你是一個文件範本分析器。以下是一份文件的內容：

---
${text.slice(0, 8000)}
---

請分析這份文件，找出所有「每次使用時可能需要更改的欄位」（變數），例如：
- 人名、公司名、日期、地址、金額、合約編號
- 表格中重複的行（產品清單、品項明細等）

請以 JSON 格式回傳（不要加 markdown fence）：
{
  "variables": [
    {
      "key": "snake_case唯一識別碼",
      "label": "中文顯示名稱",
      "type": "text|number|date|select|loop",
      "required": true,
      "original_text": "文件中確實存在的對應文字",
      "description": "說明",
      "options": null,
      "children": []
    }
  ],
  "confidence": 0.85,
  "notes": "備註"
}

規則：
1. key 必須是唯一的英文 snake_case
2. original_text 必須是文件中確實存在的完整文字片段
3. 表格重複行用 type=loop，子欄位放 children
4. 固定不變的文字不要標為變數
5. 直接回傳 JSON，不要包在 markdown 中`;

  try {
    const raw = await generateTextSync(useModel, [], prompt);
    // generateTextSync returns { text, inputTokens, outputTokens } — extract .text
    const rawText = typeof raw === 'string' ? raw : raw.text;
    console.log(`[DocTemplate] AI 原始回應 (前200字): ${String(rawText).slice(0, 200)}`);
    let cleaned = String(rawText).replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) cleaned = m[0];
    const result = JSON.parse(cleaned);
    console.log(`[DocTemplate] 識別出 ${result.variables?.length ?? 0} 個變數，信心度 ${result.confidence}`);
    return result;
  } catch (e) {
    console.error('[DocTemplate] analyzeVariables error:', e.message);
    console.error('[DocTemplate] analyzeVariables stack:', e.stack);
    return { variables: [], confidence: 0, notes: `AI 分析失敗: ${e.message}` };
  }
}

// ─── DOCX Placeholder Injection ───────────────────────────────────────────────

/**
 * Merge split runs in a paragraph XML and replace original_text with {{key}}.
 * Simple approach: flatten runs into text, do string replacement, rebuild XML.
 */
/**
 * Build a Word XML run (or runs) for a text value.
 * Handles \n by inserting <w:br/> line-break runs between lines.
 */
function buildRunXml(rPr, text) {
  const lines = text.split('\n');
  if (lines.length === 1) {
    return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  }
  return lines.map((line, i) => {
    const t = `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`;
    return i === 0 ? t : `<w:r><w:br/></w:r>${t}`;
  }).join('');
}

function mergeRunsAndReplace(paraXml, original, replacement) {
  // Extract all run texts in order, track run boundaries
  const runPattern = /<w:r\b[^>]*>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t[^>]*>([\s\S]*?)<\/w:t><\/w:r>/g;
  const runs = [];
  let m;
  while ((m = runPattern.exec(paraXml)) !== null) {
    runs.push({ full: m[0], text: m[1], index: m.index });
  }

  const combined = runs.map(r => r.text).join('');
  if (!combined.includes(original)) return paraXml;

  // Build new combined text with replacement
  const newCombined = combined.replaceAll(original, replacement);

  if (runs.length === 0) return paraXml;

  const firstRun = runs[0].full;
  const rPrMatch = firstRun.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  const rPr = rPrMatch ? rPrMatch[0] : '';
  // Support \n → <w:br/> line breaks
  const newRun = buildRunXml(rPr, newCombined);

  // Remove all matched runs from the paragraph and insert the new one
  let result = paraXml;
  for (let i = runs.length - 1; i >= 0; i--) {
    result = result.slice(0, runs[i].index) + result.slice(runs[i].index + runs[i].full.length);
  }
  result = result.replace('</w:p>', newRun + '</w:p>');
  return result;
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── Style helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve a variable's value from inputData, respecting content_mode:
 *   'static' → always use default_value (fixed text)
 *   'empty'  → always return '' (clear the cell)
 *   'variable' (default) → inputData[key] ?? default_value ?? ''
 */
function resolveValue(v, inputData) {
  const mode = v.content_mode || 'variable';
  if (mode === 'static') return String(v.default_value ?? '');
  if (mode === 'empty')  return '';
  const raw = inputData[v.key];
  return raw !== undefined ? String(raw) : String(v.default_value ?? '');
}

/** Resolve effective style: override wins over detected, with 'wrap' as overflow default */
function getEffectiveStyle(variable) {
  const d = variable?.style?.detected || {};
  const o = variable?.style?.override  || {};
  const merged = { overflow: 'wrap', ...d, ...o };
  return Object.keys(merged).length ? merged : null;
}

/**
 * Merge style overrides into an existing <w:rPr>...</w:rPr> string.
 * Returns updated rPr string (may be empty string if nothing to add).
 */
function buildStyledRPr(baseRPr, style) {
  if (!style) return baseRPr || '';
  const { fontSize, bold, italic, color } = style;
  if (fontSize === undefined && bold === undefined && italic === undefined && color === undefined) return baseRPr || '';

  let inner = '';
  if (baseRPr) {
    const m = baseRPr.match(/^<w:rPr>([\s\S]*)<\/w:rPr>$/);
    if (m) inner = m[1];
  }

  if (fontSize !== undefined) {
    const halfPts = Math.round(fontSize * 2);
    inner = inner.replace(/<w:sz\s[^>]*\/>/g, '').replace(/<w:szCs\s[^>]*\/>/g, '');
    inner += `<w:sz w:val="${halfPts}"/><w:szCs w:val="${halfPts}"/>`;
  }
  if (bold !== undefined) {
    inner = inner.replace(/<w:b(?!Cs)[^>]*\/>/g, '');
    if (bold) inner = '<w:b/>' + inner;
  }
  if (italic !== undefined) {
    inner = inner.replace(/<w:i(?!Cs)[^>]*\/>/g, '');
    if (italic) inner = '<w:i/>' + inner;
  }
  if (color !== undefined) {
    const hex = color.replace('#', '');
    inner = inner.replace(/<w:color\s[^>]*\/>/g, '');
    inner += `<w:color w:val="${hex}"/>`;
  }
  return inner ? `<w:rPr>${inner}</w:rPr>` : '';
}

/**
 * Parse <w:rPr> inner XML → VariableStyleProps object (for style detection).
 */
function parseRPrStyle(rPrInner) {
  const s = {};
  const szM = rPrInner.match(/<w:sz\s+w:val="(\d+)"/);
  if (szM) s.fontSize = parseInt(szM[1]) / 2;
  if (/<w:b(?!Cs)/.test(rPrInner)) s.bold = true;
  if (/<w:i(?!Cs)/.test(rPrInner)) s.italic = true;
  const colorM = rPrInner.match(/<w:color\s+w:val="([0-9A-Fa-f]{6})"/);
  if (colorM && colorM[1].toLowerCase() !== 'auto') s.color = `#${colorM[1]}`;
  return s;
}

/**
 * Auto-detect style (fontSize/bold/italic/color) per variable from a DOCX buffer.
 * Finds each variable's value cell via label-match and reads its first <w:rPr>.
 * Returns { [key]: VariableStyleProps }
 */
async function detectStylesFromDocx(origBuf, variables) {
  const zip = await new JSZip().loadAsync(origBuf);
  const xmlFile = zip.file('word/document.xml');
  if (!xmlFile) return {};
  const xml = await xmlFile.async('string');
  const styles = {};

  const flatVars = [];
  for (const v of variables) {
    if (v.type === 'loop') {
      for (const c of (v.children || [])) flatVars.push(c);
    } else {
      flatVars.push(v);
    }
  }

  for (const v of flatVars) {
    const labelKey = (v.label || v.key).replace(/[:：\s]/g, '').slice(0, 6);
    if (!labelKey) continue;
    const trPat = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g;
    let m;
    while ((m = trPat.exec(xml)) !== null) {
      const cells = [];
      const cp = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
      let cm;
      while ((cm = cp.exec(m[0])) !== null) cells.push(cm[0]);
      if (cells.length < 2) continue;
      const firstText = getTcText(cells[0]).replace(/[:：\s]/g, '').slice(0, 6);
      if (!firstText.includes(labelKey) && !labelKey.includes(firstText)) continue;
      // Found label → inspect value cell's rPr
      const valCell = cells[1];
      const rPrM = valCell.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
      if (rPrM) {
        const s = parseRPrStyle(rPrM[1]);
        if (Object.keys(s).length) styles[v.key] = s;
      }
      break;
    }
  }
  return styles;
}

/**
 * Auto-detect style per variable from an XLSX buffer using ExcelJS.
 * Returns { [key]: VariableStyleProps }
 */
async function detectStylesFromXlsx(origBuf, variables) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(origBuf);
  const styles = {};

  const flatVars = variables.flatMap(v => v.type === 'loop' ? (v.children || []) : [v]);

  wb.eachSheet(sheet => {
    sheet.eachRow(row => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (typeof cell.value !== 'string') return;
        const cellText = String(cell.value).replace(/[:：\s]/g, '').slice(0, 6);
        const matched = flatVars.find(v => {
          const lk = (v.label || v.key).replace(/[:：\s]/g, '').slice(0, 6);
          return cellText.includes(lk) || lk.includes(cellText);
        });
        if (!matched) return;
        // Read style from the adjacent cell (same row, next column)
        const valCell = row.getCell(colNumber + 1);
        if (!valCell?.font) return;
        const s = {};
        if (valCell.font.size) s.fontSize = valCell.font.size;
        if (valCell.font.bold) s.bold = true;
        if (valCell.font.italic) s.italic = true;
        if (valCell.font.color?.argb) {
          // ARGB → #RRGGBB
          const argb = valCell.font.color.argb;
          if (argb && argb.length === 8) s.color = `#${argb.slice(2)}`;
        }
        if (Object.keys(s).length) styles[matched.key] = s;
      });
    });
  });
  return styles;
}

/**
 * Auto-detect style per variable from a PPTX buffer using JSZip + DrawingML.
 * Returns { [key]: VariableStyleProps }
 */
async function detectStylesFromPptx(origBuf, variables) {
  const zip = await new JSZip().loadAsync(origBuf);
  const styles = {};
  const slideFiles = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f));

  for (const sf of slideFiles) {
    const xml = await zip.file(sf).async('string');
    for (const v of variables) {
      if (v.type === 'loop' || !v.original_text) continue;
      if (styles[v.key]) continue;
      // Find <a:p> containing original_text
      const paraPat = /<a:p\b[^>]*>[\s\S]*?<\/a:p>/g;
      let m;
      while ((m = paraPat.exec(xml)) !== null) {
        const runTexts = [];
        const rPat = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
        let rm;
        while ((rm = rPat.exec(m[0])) !== null) runTexts.push(rm[1]);
        if (!runTexts.join('').includes(v.original_text)) continue;
        // Found the paragraph — read first run's rPr
        const rPrM = m[0].match(/<a:rPr\b([^>]*)>/);
        if (!rPrM) break;
        const attrs = rPrM[1];
        const s = {};
        const szM = attrs.match(/\bsz="(\d+)"/);
        if (szM) s.fontSize = parseInt(szM[1]) / 100; // EMU hundredths of a pt
        if (/\bb="1"/.test(attrs)) s.bold = true;
        if (/\bi="1"/.test(attrs)) s.italic = true;
        // solidFill hex
        const fillM = m[0].match(/<a:solidFill>[\s\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"[\s\S]*?<\/a:solidFill>/);
        if (fillM) s.color = `#${fillM[1]}`;
        if (Object.keys(s).length) styles[v.key] = s;
        break;
      }
    }
  }
  return styles;
}

/** Detect primary language of text: CJK ratio > 30% → 繁體中文, else English */
function detectLang(text) {
  if (!text) return '繁體中文';
  const cjk = [...text].filter(c => /[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef]/.test(c)).length;
  return cjk / text.length > 0.3 ? '繁體中文' : 'English';
}

/**
 * Summarize text to fit within maxChars using Gemini Flash.
 * Falls back to hard truncation if AI fails or result is still too long.
 */
async function summarizeText(text, maxChars) {
  const lang = detectLang(text);
  const prompt = `請用${lang}將以下文字壓縮至${maxChars}字以內。只輸出壓縮後內容，不加任何說明或標題：\n${text}`;
  try {
    const result = await generateTextSync(MODEL_FLASH, [], prompt);
    const summary = (typeof result === 'string' ? result : (result.text || '')).trim();
    console.log(`[DocTemplate] summarize: ${text.length}→${summary.length} chars`);
    return summary.length <= maxChars ? summary : summary.slice(0, maxChars - 1) + '…';
  } catch (e) {
    console.warn('[DocTemplate] summarize failed, truncating:', e.message);
    return text.slice(0, maxChars - 1) + '…';
  }
}

/**
 * Apply overflow strategy to a value given effective style.
 * Handles: truncate (immediate), summarize (async AI).
 * 'wrap' and 'shrink' are handled at render time, returned unchanged here.
 */
async function applyOverflow(value, eff) {
  if (!value || !eff) return value;
  const { overflow = 'wrap', maxChars } = eff;
  if (!maxChars || value.length <= maxChars) return value;

  if (overflow === 'truncate') return value.slice(0, maxChars - 1) + '…';
  if (overflow === 'summarize') return await summarizeText(value, maxChars);
  return value;
}

// ─── Cell-level helpers ────────────────────────────────────────────────────────

/** Extract all run text from a <w:tc>, decode XML entities, normalize whitespace */
function getTcText(tcXml) {
  const texts = [];
  const pat = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = pat.exec(tcXml)) !== null) texts.push(m[1]);
  return texts.join('')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** Replace entire content of a <w:tc>, preserving cell + text formatting.
 *  If style is provided, override rPr with style properties. */
function buildReplacedTc(tcXml, newText, style) {
  const tcOpenM = tcXml.match(/^(<w:tc\b[^>]*>)/);
  const tcOpen  = tcOpenM ? tcOpenM[1] : '<w:tc>';
  const tcPrM   = tcXml.match(/(<w:tcPr>[\s\S]*?<\/w:tcPr>)/);
  const tcPr    = tcPrM ? tcPrM[1] : '';

  let pPr = '', rPr = '';
  const firstParaM = tcXml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/);
  if (firstParaM) {
    const pPrM = firstParaM[0].match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
    if (pPrM) pPr = `<w:pPr>${pPrM[1]}</w:pPr>`;
    const rPrM = firstParaM[0].match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    if (rPrM) rPr = `<w:rPr>${rPrM[1]}</w:rPr>`;
  }
  if (style) rPr = buildStyledRPr(rPr, style);
  return `${tcOpen}${tcPr}<w:p>${pPr}${buildRunXml(rPr, newText)}</w:p><w:p>${pPr}</w:p></w:tc>`;
}

/**
 * Find ALL <w:tc> containing searchText (first-line snippet, normalized),
 * replace their content with newText.
 * Handles: original_text may have \n from mammoth; XML has no \n between paragraphs.
 */
function replaceTcContent(xml, searchText, newText, style) {
  const snippet = (searchText.split('\n').find(l => l.trim()) || searchText)
    .trim().slice(0, 80).replace(/\s+/g, ' ');
  if (!snippet) return { xml, found: false };

  let found = false;
  const newXml = xml.replace(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g, (tcXml) => {
    const cellText = getTcText(tcXml).replace(/\s+/g, ' ');
    if (!cellText.includes(snippet)) return tcXml;
    found = true;
    return buildReplacedTc(tcXml, newText, style);
  });
  return { xml: newXml, found };
}

/**
 * Label-based cell replacement: find <w:tr> whose FIRST cell fuzzy-matches
 * labelText, replace the SECOND cell's content with newText.
 * This is the PRIMARY strategy — works even when original_text is null/missing.
 * Replaces ALL matching rows (handles multi-copy template documents).
 */
function fillCellByLabel(xml, labelText, newText, style) {
  if (!labelText) return { xml, found: false };
  // Normalize: remove colons, spaces; take first 6 chars as key
  const labelKey = labelText.replace(/[:：\s]/g, '').slice(0, 6);
  if (labelKey.length < 2) return { xml, found: false };

  let found = false;
  const newXml = xml.replace(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g, (trXml) => {
    // Collect ALL cells with positions
    const cells = [];
    const tcPat = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
    let m;
    while ((m = tcPat.exec(trXml)) !== null) cells.push({ full: m[0], index: m.index });
    if (cells.length < 2) return trXml;

    // Scan ALL cells (not just first) for the label — handles multi-column form rows
    const labelIdx = cells.findIndex(c => {
      const txt = getTcText(c.full).replace(/[:：\s]/g, '');
      return txt.length >= 2 && (txt.includes(labelKey) || labelKey.includes(txt));
    });
    if (labelIdx === -1 || labelIdx + 1 >= cells.length) return trXml;

    found = true;
    // Replace the cell IMMEDIATELY AFTER the matched label cell
    const val = cells[labelIdx + 1];
    const newVal = buildReplacedTc(val.full, newText, style);
    return trXml.slice(0, val.index) + newVal + trXml.slice(val.index + val.full.length);
  });
  return { xml: newXml, found };
}

async function injectDocxPlaceholders(docxBuf, variables) {
  const zip = new JSZip();
  await zip.loadAsync(docxBuf);

  const xmlFile = zip.file('word/document.xml');
  if (!xmlFile) return docxBuf;

  let xml = await xmlFile.async('string');

  // Process paragraph by paragraph
  for (const v of variables) {
    if (!v.original_text || v.type === 'loop') continue;
    // Replace in all <w:p>...</w:p> blocks
    xml = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, para => {
      return mergeRunsAndReplace(para, v.original_text, `{{${v.key}}}`);
    });
  }

  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// ─── XLSX Placeholder Injection ────────────────────────────────────────────────

async function injectXlsxPlaceholders(xlsxBuf, variables) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsxBuf);

  for (const v of variables) {
    if (!v.original_text || v.type === 'loop') continue;
    wb.eachSheet(sheet => {
      sheet.eachRow(row => {
        row.eachCell(cell => {
          if (typeof cell.value === 'string' && cell.value.includes(v.original_text)) {
            cell.value = cell.value.replaceAll(v.original_text, `{{${v.key}}}`);
          }
        });
      });
    });
  }

  return wb.xlsx.writeBuffer();
}

// ─── PDF Form Detection ────────────────────────────────────────────────────────

async function detectPdfFormFields(pdfBuf) {
  try {
    const { PDFDocument } = require('pdf-lib');
    const doc = await PDFDocument.load(pdfBuf);
    const form = doc.getForm();
    const fields = form.getFields();
    return fields.map((f, i) => ({
      key: f.getName().replace(/\s+/g, '_').toLowerCase() || `field_${i}`,
      label: f.getName() || `欄位 ${i + 1}`,
      type: 'text',
      required: false,
      original_text: f.getName(),
      description: '',
      options: null,
      children: [],
    }));
  } catch {
    return [];
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyze uploaded file → return schema (no DB write)
 */
async function analyzeDocument(filePath, format) {
  let schema;

  if (format === 'pdf') {
    // First try AcroForm fields
    const buf = await fs.readFile(filePath);
    const fields = await detectPdfFormFields(buf);
    if (fields.length > 0) {
      schema = {
        variables: fields,
        confidence: 1.0,
        notes: 'PDF 表單欄位自動偵測',
        strategy: 'pdf_form',
      };
    }
  }

  if (!schema) {
    const text = await extractText(filePath, format);
    const aiResult = await analyzeVariables(text);
    schema = {
      ...aiResult,
      strategy: format === 'pdf' ? 'ai_schema' : 'native',
      extracted_at: new Date().toISOString(),
    };
  }

  return schema;
}

/**
 * Create template: inject placeholders into original file, save both
 */
async function createTemplate(db, { creatorId, name, description, format, tags, isPublic, isFixedFormat, schemaJson, tempFilePath }) {
  await ensureTemplatesDir();

  const id = uuid();
  const ext = format;
  const origDest = path.join(TEMPLATES_DIR, `${id}_orig.${ext}`);
  const tplDest  = path.join(TEMPLATES_DIR, `${id}.${ext}`);

  // Copy original
  await fs.copyFile(tempFilePath, origDest);

  // Inject placeholders
  const variables = schemaJson.variables || [];
  const strategy = schemaJson.strategy || 'native';

  let tplBuf;
  const origBuf = await fs.readFile(origDest);

  if (format === 'docx' && strategy === 'native') {
    tplBuf = await injectDocxPlaceholders(origBuf, variables);
  } else if (format === 'xlsx' && strategy === 'native') {
    tplBuf = await injectXlsxPlaceholders(origBuf, variables);
  } else {
    // pdf_form or ai_schema: template = original (fill at generate time)
    tplBuf = origBuf;
  }

  await fs.writeFile(tplDest, tplBuf);

  // ── Auto-detect styles from original file ──────────────────────────────────
  try {
    let detectedStyles = {};
    if (format === 'docx') detectedStyles = await detectStylesFromDocx(origBuf, variables);
    else if (format === 'xlsx') detectedStyles = await detectStylesFromXlsx(origBuf, variables);
    else if (format === 'pptx') detectedStyles = await detectStylesFromPptx(origBuf, variables);

    // Merge detected styles into schema variables
    let changed = false;
    const applyDetected = (vars) => vars.map(v => {
      const d = detectedStyles[v.key];
      const updated = d ? { ...v, style: { ...(v.style || {}), detected: d } } : v;
      if (updated.children) updated.children = applyDetected(updated.children);
      if (updated !== v) changed = true;
      return updated;
    });
    schemaJson = { ...schemaJson, variables: applyDetected(variables) };
    if (changed) console.log(`[DocTemplate] detectStyles: ${Object.keys(detectedStyles).length} vars styled`);
  } catch (e) {
    console.warn('[DocTemplate] detectStyles failed (non-fatal):', e.message);
  }

  await db.prepare(`
    INSERT INTO doc_templates
      (id, creator_id, name, description, format, strategy,
       template_file, original_file, schema_json, tags, is_public, is_fixed_format)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, creatorId, name, description || null, format, strategy,
    `templates/${id}.${ext}`,
    `templates/${id}_orig.${ext}`,
    JSON.stringify(schemaJson),
    tags ? JSON.stringify(tags) : null,
    isPublic ? 1 : 0,
    isFixedFormat ? 1 : 0
  );

  return db.prepare('SELECT * FROM doc_templates WHERE id=?').get(id);
}

/**
 * Generate document from template with user-supplied data
 */
async function generateDocument(db, templateId, userId, inputData, outputFormat, _skipDb = false) {
  const tpl = await db.prepare('SELECT * FROM doc_templates WHERE id=?').get(templateId);
  if (!tpl) throw new Error('範本不存在');

  const tplPath = path.join(UPLOAD_DIR, tpl.template_file);
  const tplBuf  = await fs.readFile(tplPath);
  const fmt     = outputFormat || tpl.format;
  const schema  = JSON.parse(tpl.schema_json || '{}');
  const outputId = uuid();
  const outDir   = path.join(UPLOAD_DIR, 'generated');
  await fs.mkdir(outDir, { recursive: true });

  let outPath;

  if (tpl.format === 'docx') {
    const JSZip = require('jszip');
    const origBuf = await fs.readFile(path.join(UPLOAD_DIR, tpl.original_file));

    // ── Detect docxtemplater mode: template contains {tag} placeholders ──────
    // Word splits runs when typing, so we check the raw XML for {word} patterns.
    const peekZip = await new JSZip().loadAsync(origBuf);
    const peekXml = await peekZip.file('word/document.xml').async('string');
    // Strip XML tags (empty string, NOT space) so split runs merge: {va</w:r><w:r>r} → {var}
    const allText = peekXml.replace(/<[^>]+>/g, '');
    const schemaVars = schema.variables || [];
    // Detect: any variable key appears as {key}, {#key}, or {/key}
    const usesDocxtemplater = schemaVars.some(v =>
      allText.includes(`{${v.key}}`) ||
      allText.includes(`{#${v.key}}`) ||
      allText.includes(`{/${v.key}}`)
    );

    if (usesDocxtemplater) {
      // ── Path A: docxtemplater ─────────────────────────────────────────────
      const PizZip        = require('pizzip');
      const Docxtemplater = require('docxtemplater');

      const variables = schema.variables || [];
      const renderData = {};
      for (const v of variables) {
        if (v.content_mode === 'static') {
          renderData[v.key] = (v.default_value ?? '').toString().trimEnd();
        } else if (v.content_mode === 'empty') {
          renderData[v.key] = '';
        } else if (v.type === 'loop') {
          // Trim string values inside each loop item too
          const rows = Array.isArray(inputData[v.key]) ? inputData[v.key] : [];
          renderData[v.key] = rows.map(row => {
            const cleaned = {};
            for (const [k, val] of Object.entries(row)) {
              cleaned[k] = typeof val === 'string' ? val.trimEnd() : val;
            }
            return cleaned;
          });
        } else {
          // Trim trailing newlines to prevent extra blank line in cell
          const raw = String(inputData[v.key] ?? v.default_value ?? '');
          renderData[v.key] = raw.trimEnd();
        }
      }

      const pzip = new PizZip(origBuf);
      const doc  = new Docxtemplater(pzip, {
        paragraphLoop: true,
        linebreaks:    true,
        delimiters:    { start: '{', end: '}' },
      });

      try {
        doc.render(renderData);
      } catch (e) {
        // Enrich error message for template author
        const msg = e.properties?.errors?.map(x => x.message).join('; ') || e.message;
        throw new Error(`docxtemplater 渲染失敗：${msg}`);
      }

      // ── Post-process: compact paragraph spacing inside table cells ────────
      // Word's Normal style has spaceAfter=8pt which makes loop items spread apart.
      // Schema can override via docx_settings.cellSpacingAfter (pt, default 0).
      const cellSpacingAfter = (schema.docx_settings?.cellSpacingAfter ?? 0) * 20; // twips
      const renderedPzip = doc.getZip();
      let renderedXml = renderedPzip.files['word/document.xml'].asText();

      // Within each <w:tc>, patch every <w:pPr>: replace or add <w:spacing>
      renderedXml = renderedXml.replace(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g, tcBlock => {
        return tcBlock.replace(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/g, pPrBlock => {
          // Remove any existing <w:spacing> tag
          const stripped = pPrBlock.replace(/<w:spacing\b[^/]*\/>/g, '');
          // Inject tight spacing: single line height, configurable space-after
          const spacingTag = `<w:spacing w:after="${cellSpacingAfter}" w:line="240" w:lineRule="auto"/>`;
          return stripped.replace(/<\/w:pPr>/, spacingTag + '</w:pPr>');
        });
      });

      renderedPzip.file('word/document.xml', renderedXml);
      const out = renderedPzip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
      outPath = path.join(outDir, `${outputId}.docx`);
      await fs.writeFile(outPath, out);

    } else {
    // ── Path B: legacy XML manipulation ──────────────────────────────────────

    const zip     = await new JSZip().loadAsync(origBuf);
    let xml = await zip.file('word/document.xml').async('string');

    const variables = schema.variables || [];

    // ── Strip <w:tblHeader/> to prevent rows from repeating on each page ────
    // Word's "repeat header rows" feature causes ALL marked rows to appear on
    // every page. Remove this to keep headers on page 1 only.
    xml = xml.replace(/<w:tblHeader\/>/g, '');
    // Clean up any trPr that became empty after removal
    xml = xml.replace(/<w:trPr>\s*<\/w:trPr>/g, '');

    // ── Fill variables ──────────────────────────────────────────────────────
    const isFixed = !!(tpl.is_fixed_format);
    for (const v of variables) {
      let value;
      const vStyle = isFixed ? getEffectiveStyle(v) : null;

      if (v.type === 'loop') {
        const items = Array.isArray(inputData[v.key]) ? inputData[v.key] : [];
        const children = v.children || [];
        if (!children.length || !items.length) continue;

        // ── Helper: apply fixed row height to a <w:tr> ─────────────────
        const applyRowHeight = (trXml) => {
          if (!isFixed || !v.docx_style?.rowHeightPt) return trXml;
          const twips = Math.round(v.docx_style.rowHeightPt * 20);
          const heightTag = `<w:trHeight w:val="${twips}" w:hRule="exact"/>`;
          const trPrM = trXml.match(/<w:trPr>([\s\S]*?)<\/w:trPr>/);
          if (trPrM) {
            const newInner = trPrM[1].replace(/<w:trHeight[^>]*\/>/g, '') + heightTag;
            return trXml.replace(/<w:trPr>[\s\S]*?<\/w:trPr>/, `<w:trPr>${newInner}</w:trPr>`);
          }
          return trXml.replace('<w:tr', `<w:tr><w:trPr>${heightTag}</w:trPr>`);
        };

        // ── Helper: fill blank template row by column index ──────────────
        const fillBlankRow = (blankRow, item) => {
          const cells = [...blankRow.matchAll(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g)];
          let row = blankRow;
          let offset = 0;
          children.forEach((c, idx) => {
            if (idx >= cells.length) return;
            const cell = cells[idx];
            const cStyle = isFixed ? getEffectiveStyle(c) : null;
            const val = String(item[c.key] ?? '');
            const newCell = buildReplacedTc(cell[0], val, cStyle);
            row = row.slice(0, cell.index + offset) + newCell + row.slice(cell.index + offset + cell[0].length);
            offset += newCell.length - cell[0].length;
          });
          return applyRowHeight(row);
        };

        // ── Strategy A & B: skip when loop_mode is 'text_list' ──────────
        if (v.loop_mode !== 'text_list') {

        // ── Strategy A: text-replacement (filled templates) ──────────────
        const firstChild = children.find(c => c.original_text);
        if (firstChild) {
          const escaped = firstChild.original_text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const trMatch = xml.match(new RegExp(
            `<w:tr\\b[^>]*>[\\s\\S]*?${escaped}[\\s\\S]*?<\\/w:tr>`
          ));
          if (trMatch && children.filter(c => c.original_text)
            .every(c => trMatch[0].includes(c.original_text))) {

            // Detect column-header row: original_text ≈ label (blank template)
            const isHeaderRow = children.filter(c => c.original_text).every(c => {
              const a = (c.original_text || '').replace(/\s+/g, '').toLowerCase();
              const b = (c.label || '').replace(/\s+/g, '').toLowerCase();
              return a === b || a.includes(b) || b.includes(a);
            });

            if (!isHeaderRow) {
              // Normal text-replacement row duplication
              const newRows = items.map(item => {
                let row = applyRowHeight(trMatch[0]);
                for (const c of children) {
                  if (!c.original_text) continue;
                  const cStyle = isFixed ? getEffectiveStyle(c) : null;
                  row = row.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
                    const replaced = mergeRunsAndReplace(para, c.original_text, String(item[c.key] ?? ''));
                    if (!cStyle || replaced === para) return replaced;
                    return replaced.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/, (_, inner) =>
                      buildStyledRPr(`<w:rPr>${inner}</w:rPr>`, cStyle)
                    );
                  });
                }
                return row;
              });
              xml = xml.replace(trMatch[0], newRows.join(''));
              continue;
            }
            // isHeaderRow → fall through to Strategy B
          }
        }

        // ── Strategy B: blank template row detection (blank form) ────────
        {
          const tblPat = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g;
          let tm;
          let blankHandled = false;
          while ((tm = tblPat.exec(xml)) !== null) {
            const tblXml = tm[0];
            const rows = [...tblXml.matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)];

            // Find a header row whose cells match child labels
            let headerIdx = -1;
            for (let ri = 0; ri < rows.length; ri++) {
              const cells = [...rows[ri][0].matchAll(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g)];
              const matched = children.filter(c => {
                const lk = (c.label || c.key).replace(/\s+/g, '').toLowerCase().slice(0, 8);
                return cells.some(rc => {
                  const ct = getTcText(rc[0]).replace(/\s+/g, '').toLowerCase();
                  return ct.includes(lk) || lk.includes(ct);
                });
              }).length;
              if (matched >= Math.ceil(children.length / 2)) { headerIdx = ri; break; }
            }
            if (headerIdx === -1) continue;

            // All rows after header → use first as template, replace all with generated
            const rowsAfterHeader = rows.slice(headerIdx + 1);
            if (rowsAfterHeader.length === 0) continue;

            const templateRow = rowsAfterHeader[0][0];
            const templateCells = [...templateRow.matchAll(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g)];
            if (templateCells.length === 0) continue;

            // Map children to column indices via header row
            const headerCells = [...rows[headerIdx][0].matchAll(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g)];
            const childColMap = children.map((c, fallback) => {
              const lk = (c.label || c.key).replace(/\s+/g, '').toLowerCase().slice(0, 8);
              const ci = headerCells.findIndex(hc => {
                const ht = getTcText(hc[0]).replace(/\s+/g, '').toLowerCase();
                return ht.includes(lk) || lk.includes(ht);
              });
              return { c, colIdx: ci >= 0 ? ci : fallback };
            });

            const newRows = items.map(item => {
              let row = templateRow;
              let offset = 0;
              const sorted = [...childColMap].sort((a, b) => a.colIdx - b.colIdx);
              for (const { c, colIdx } of sorted) {
                if (colIdx >= templateCells.length) continue;
                const cell = templateCells[colIdx];
                const cStyle = isFixed ? getEffectiveStyle(c) : null;
                const val = String(item[c.key] ?? '');
                const newCell = buildReplacedTc(cell[0], val, cStyle);
                row = row.slice(0, cell.index + offset) + newCell + row.slice(cell.index + offset + cell[0].length);
                offset += newCell.length - cell[0].length;
              }
              return applyRowHeight(row);
            });

            // Position-based replacement: keep everything up to and including header row,
            // then inject all generated rows, then close the table.
            const headerRow = rows[headerIdx];
            const afterHeaderStart = headerRow.index + headerRow[0].length;
            const tableCloseTag = '</w:tbl>';
            const tableCloseIdx = tblXml.lastIndexOf(tableCloseTag);
            const newTblXml = tblXml.slice(0, afterHeaderStart) + newRows.join('') + tblXml.slice(tableCloseIdx);
            xml = xml.slice(0, tm.index) + newTblXml + xml.slice(tm.index + tblXml.length);
            blankHandled = true;
            break;
          }
          if (blankHandled) continue;
        }

        } // end loop_mode !== 'text_list' block

        // ── Strategy C: flat fallback (always runs for text_list mode) ───
        const vals = items.map((item, idx) => {
          const parts = children.map(c => {
            const val = String(item[c.key] ?? '').trim();
            return children.length > 1 && c.label ? `${c.label}: ${val}` : val;
          }).filter(s => s);
          return parts.length ? `${idx + 1}. ${parts.join('　')}` : '';
        }).filter(s => s);
        value = vals.join('\n');
      } else {
        value = resolveValue(v, inputData);
      }

      // Apply overflow policy (truncate/summarize) when fixed mode is on
      if (isFixed && vStyle) value = await applyOverflow(value, vStyle);

      // 1. Label-based (primary — works regardless of original_text)
      const { xml: x1, found: f1 } = fillCellByLabel(xml, v.label, value, vStyle);
      if (f1) { xml = x1; continue; }

      // 2. Content-based (secondary — uses original_text snippet)
      const origText = v.type === 'loop'
        ? (v.children?.find(c => c.original_text)?.original_text || '')
        : (v.original_text || '');
      if (origText) {
        const { xml: x2, found: f2 } = replaceTcContent(xml, origText, value, vStyle);
        if (f2) { xml = x2; continue; }
      }

      // 3. Paragraph-level (last resort — only for simple vars with original_text)
      if (v.original_text && v.type !== 'loop') {
        xml = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) =>
          mergeRunsAndReplace(para, v.original_text, value)
        );
      }
    }

    // ── Remove body-level content after the last table ─────────────────────
    // Original filled documents often have free-form text or extra table copies
    // after the main form. Keep only up to (and including) the last </w:tbl>,
    // plus the section properties required by OOXML.
    {
      const lastTblClose = xml.lastIndexOf('</w:tbl>');
      const bodyClose    = xml.lastIndexOf('</w:body>');
      if (lastTblClose !== -1 && bodyClose > lastTblClose + 8) {
        const afterLastTbl = xml.slice(lastTblClose + 8, bodyClose);
        // Preserve <w:sectPr> (page size, margins, etc.)
        const sectPrMatch = afterLastTbl.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/);
        const sectPr = sectPrMatch ? sectPrMatch[0] : '';
        xml = xml.slice(0, lastTblClose + 8) + sectPr + '</w:body>' + xml.slice(bodyClose + 8);
      }
    }

    zip.file('word/document.xml', xml);
    const out = await zip.generateAsync({ type: 'nodebuffer',
      compression: 'DEFLATE', compressionOptions: { level: 6 } });

    outPath = path.join(outDir, `${outputId}.docx`);
    await fs.writeFile(outPath, out);

    } // end Path B (legacy XML)

  } else if (tpl.format === 'xlsx') {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    // Use original file to avoid broken {{}} injection
    const origBuf = await fs.readFile(path.join(UPLOAD_DIR, tpl.original_file));
    await wb.xlsx.load(origBuf);

    const variables = schema.variables || [];
    const xlsxSettings = schema.xlsx_settings || {};

    const toArgb = hex => hex ? 'FF' + hex.replace('#', '').toUpperCase() : null;
    const oddFill  = xlsxSettings.oddRowColor  ? { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(xlsxSettings.oddRowColor)  } } : null;
    const evenFill = xlsxSettings.evenRowColor ? { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(xlsxSettings.evenRowColor) } } : null;

    wb.eachSheet(sheet => {
      // ── Simple variables: text replacement ────────────────────────────────
      sheet.eachRow(row => {
        row.eachCell(cell => {
          if (typeof cell.value !== 'string') return;
          let v = cell.value;
          for (const varDef of variables) {
            if (!varDef.original_text || varDef.type === 'loop') continue;
            if (v.includes(varDef.original_text)) {
              v = v.replaceAll(varDef.original_text, resolveValue(varDef, inputData));
            }
          }
          cell.value = v;
        });
      });

      // ── Loop variables: find header row → insert data rows ───────────────
      for (const varDef of variables) {
        if (varDef.type !== 'loop') continue;
        const items = Array.isArray(inputData[varDef.key]) ? inputData[varDef.key] : [];
        const children = varDef.children || [];
        if (!items.length || !children.length) continue;

        // Find the header row: prefer explicit xlsx_settings.headerRowNum, else auto-detect
        let headerRowNum = xlsxSettings.headerRowNum ?? -1;
        let colMap = {};

        if (headerRowNum !== -1) {
          // Build colMap from the specified header row
          const hRow = sheet.getRow(headerRowNum);
          hRow.eachCell((cell, colNum) => {
            const cellTxt = String(cell.value ?? '').replace(/\s/g, '');
            for (const c of children) {
              const labelKey = (c.label || '').replace(/\s/g, '');
              const varKey   = (c.key   || '').toLowerCase();
              if ((labelKey && cellTxt.includes(labelKey)) ||
                  (varKey && cellTxt.toLowerCase().includes(varKey))) {
                colMap[c.key] = colNum;
              }
            }
          });
        } else {
          // Auto-detect: find a row where cells contain children labels/keys
          sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
            if (headerRowNum !== -1) return;
            const map = {};
            row.eachCell((cell, colNum) => {
              const cellTxt = String(cell.value ?? '').replace(/\s/g, '');
              for (const c of children) {
                const labelKey = (c.label || '').replace(/\s/g, '');
                const varKey   = (c.key   || '').toLowerCase();
                if ((labelKey && cellTxt.includes(labelKey)) ||
                    (varKey && cellTxt.toLowerCase().includes(varKey))) {
                  map[c.key] = colNum;
                }
              }
            });
            if (Object.keys(map).length >= Math.min(children.length, 2)) {
              headerRowNum = rowNum;
              colMap = map;
            }
          });
        }

        // Fallback: no header found → use sequential columns starting at 1
        if (headerRowNum === -1) {
          headerRowNum = sheet.lastRow?.number ?? 0;
          children.forEach((c, i) => { colMap[c.key] = i + 1; });
        }
        if (!Object.keys(colMap).length) {
          children.forEach((c, i) => { colMap[c.key] = i + 1; });
        }

        // Write data rows
        const existingLastRow = sheet.lastRow?.number ?? headerRowNum;
        items.forEach((item, idx) => {
          const rowNum = headerRowNum + 1 + idx;
          const row = sheet.getRow(rowNum);
          for (const [key, colNum] of Object.entries(colMap)) {
            row.getCell(colNum).value = String(item[key] ?? '');
          }

          const fill = idx % 2 === 0 ? oddFill : evenFill;
          if (fill) row.eachCell({ includeEmpty: false }, cell => { cell.fill = fill; });
          row.commit();
        });
        console.log(`[DocTemplate] XLSX loop ${varDef.key}: headerRow=${headerRowNum} items=${items.length} cols=${JSON.stringify(colMap)} existingRows=${existingLastRow}`);
      }
    });

    outPath = path.join(outDir, `${outputId}.xlsx`);
    await wb.xlsx.writeFile(outPath);

  } else if (tpl.format === 'pptx') {
    // PPTX: direct XML replacement in each slide (DrawingML <a:t> elements)
    const origBuf = await fs.readFile(path.join(UPLOAD_DIR, tpl.original_file));
    const zip = await new JSZip().loadAsync(origBuf);
    const variables = schema.variables || [];

    const slideFiles = Object.keys(zip.files)
      .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f));

    for (const sf of slideFiles) {
      let xml = await zip.file(sf).async('string');

      for (const v of variables) {
        if (v.type === 'loop' || !v.original_text) continue;
        const val = resolveValue(v, inputData);
        // Replace within <a:p> paragraphs (DrawingML runs: <a:r><a:t>text</a:t></a:r>)
        xml = xml.replace(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g, (para) => {
          const runPat = /<a:r\b[^>]*>(?:<a:rPr[^>]*(?:\/>|>[\s\S]*?<\/a:rPr>))?<a:t[^>]*>([\s\S]*?)<\/a:t><\/a:r>/g;
          const runs = [];
          let m;
          while ((m = runPat.exec(para)) !== null) runs.push({ full: m[0], text: m[1], index: m.index });
          const combined = runs.map(r => r.text).join('');
          if (!combined.includes(v.original_text)) return para;
          const newText = combined.replaceAll(v.original_text, val);
          const firstRun = runs[0].full;
          const rPrM = firstRun.match(/<a:rPr[^>]*(?:\/>|>[\s\S]*?<\/a:rPr>)/);
          const rPr = rPrM ? rPrM[0] : '';
          const newRun = `<a:r>${rPr}<a:t xml:space="preserve">${escapeXml(newText)}</a:t></a:r>`;
          let result = para;
          for (let i = runs.length - 1; i >= 0; i--) {
            result = result.slice(0, runs[i].index) + result.slice(runs[i].index + runs[i].full.length);
          }
          return result.replace('</a:p>', newRun + '</a:p>');
        });
      }

      zip.file(sf, xml);
    }

    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    outPath = path.join(outDir, `${outputId}.pptx`);
    await fs.writeFile(outPath, out);

  } else if (tpl.format === 'pdf' && fmt === 'docx') {
    // ── PDF template → DOCX output via LibreOffice ──────────────────────────
    // Step 1: generate PDF without DB recording
    const pdfResult  = await generateDocument(db, templateId, userId, inputData, 'pdf', true);
    const tmpPdfPath = path.join(UPLOAD_DIR, pdfResult.filePath);
    const tmpPdfId   = pdfResult.outputId;

    // Step 2: LibreOffice headless convert
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);

    const soffice = process.env.SOFFICE_PATH || 'soffice';
    try {
      await execFileAsync(soffice, [
        '--headless', '--convert-to', 'docx',
        '--outdir', outDir,
        tmpPdfPath,
      ], { timeout: 60000 });
    } catch (e) {
      await fs.unlink(tmpPdfPath).catch(() => {});
      throw new Error(`LibreOffice 轉換失敗: ${e.message}`);
    }

    // soffice outputs <stem>.docx in outDir
    outPath = path.join(outDir, `${outputId}.docx`);
    await fs.rename(path.join(outDir, `${tmpPdfId}.docx`), outPath);
    await fs.unlink(tmpPdfPath).catch(() => {});

  } else if (tpl.format === 'pdf' && tpl.strategy !== 'pdf_form') {
    const variables = schema.variables || [];
    const flatVars  = variables.flatMap(v => v.type === 'loop' ? (v.children || []) : [v]);
    const hasCells  = flatVars.some(v => v.pdf_cell);

    if (hasCells) {
      // ── PDF Overlay (always when cells defined; style only when is_fixed_format) ──
      const { PDFDocument, rgb, pushGraphicsState, popGraphicsState,
              moveTo, lineTo, closePath, clip, endPath } = require('pdf-lib');
      const fontkit = require('@pdf-lib/fontkit');

      const origDoc = await PDFDocument.load(tplBuf);
      origDoc.registerFontkit(fontkit);

      const fontPath     = path.join(__dirname, '../fonts/NotoSansTC-Regular.ttf');
      const fontBoldPath = path.join(__dirname, '../fonts/NotoSansTC-Bold.ttf');
      let regularFont, boldFont;
      try { regularFont = await origDoc.embedFont(await fs.readFile(fontPath)); }
      catch { regularFont = await origDoc.embedFont('Helvetica'); }
      try { boldFont = await origDoc.embedFont(await fs.readFile(fontBoldPath)); }
      catch { boldFont = null; }

      // Styles are always applied (override wins over detected; detected may be absent for non-fixed)

      // Flatten loop vars
      const flatData = { ...inputData };
      for (const v of variables) {
        if (v.type !== 'loop') continue;
        const items = Array.isArray(inputData[v.key]) ? inputData[v.key] : [];
        flatData[v.key] = items.map((item, i) => {
          const parts = (v.children || []).map(c => String(item[c.key] ?? '').trim()).filter(Boolean);
          return parts.length ? `${i + 1}. ${parts.join('　')}` : '';
        }).filter(Boolean).join('\n');
      }
      for (const v of flatVars) {
        if (v.content_mode && v.content_mode !== 'variable') flatData[v.key] = resolveValue(v, inputData);
      }

      // ── Helper: hex color string → {r,g,b} (0-1 range) ────────────────────
      const hexRgb = (hex) => {
        const h = (hex || '').replace('#', '');
        if (h.length !== 6) return null;
        return { r: parseInt(h.slice(0,2),16)/255, g: parseInt(h.slice(2,4),16)/255, b: parseInt(h.slice(4,6),16)/255 };
      };

      // ── Helper: wrap text to lines using font metrics ───────────────────────
      // Word-aware: CJK chars break anywhere; ASCII runs are treated as atomic tokens.
      function wrapLines(text, font, fontSize, maxWidth) {
        const isCJK = ch => ch.codePointAt(0) > 0x2E80;
        const cw = ch => { try { return font.widthOfTextAtSize(ch, fontSize); } catch { return fontSize * (isCJK(ch) ? 1.0 : 0.55); } };
        const tokW = s => [...s].reduce((a, c) => a + cw(c), 0);
        const lines = [];
        for (const para of text.split('\n')) {
          if (!para) { lines.push(''); continue; }
          // Tokenize: CJK → individual; space → break marker; ASCII run → single token
          const tokens = [];
          let cur = '';
          for (const ch of para) {
            if (isCJK(ch)) { if (cur) { tokens.push(cur); cur = ''; } tokens.push(ch); }
            else if (ch === ' ') { if (cur) { tokens.push(cur); cur = ''; } tokens.push(' '); }
            else cur += ch;
          }
          if (cur) tokens.push(cur);
          let line = '', lw = 0;
          for (const tok of tokens) {
            const tw = tokW(tok);
            if (tok === ' ') {
              if (lw + tw <= maxWidth) { if (line) { line += ' '; lw += tw; } }
              else if (line) { lines.push(line); line = ''; lw = 0; }
            } else if (lw + tw > maxWidth && line) {
              lines.push(line.trimEnd()); line = tok; lw = tw;
            } else { line += tok; lw += tw; }
          }
          if (line.trim()) lines.push(line.trimEnd());
        }
        while (lines.length && lines[lines.length - 1] === '') lines.pop();
        return lines;
      }

      // ── Helper: draw text lines with clip rect on a given page ─────────────
      function drawCellLines(pg, lines, cx, cyTop, cw, ch, cyBot, fontSize, isBold, fgColor) {
        const lineH = fontSize * 1.3;
        // Extend clip downward by one font-size so the last line (whose baseline may sit
        // just below the nominal cell boundary when linesPerCell uses Math.round) is visible.
        const clipBot = cyBot - fontSize;
        pg.pushOperators(
          pushGraphicsState(),
          moveTo(cx, clipBot), lineTo(cx + cw, clipBot), lineTo(cx + cw, cyTop), lineTo(cx, cyTop),
          closePath(), clip(), endPath()
        );
        const useFont = (isBold && boldFont) ? boldFont : regularFont;
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i]) continue;
          const x = cx + 2, y = cyTop - fontSize - 2 - i * lineH;
          pg.drawText(lines[i], { x, y, size: fontSize, font: useFont, color: rgb(fgColor.r, fgColor.g, fgColor.b) });
          if (isBold && !boldFont) {
            pg.drawText(lines[i], { x: x + 0.4, y, size: fontSize, font: regularFont, color: rgb(fgColor.r, fgColor.g, fgColor.b) });
          }
        }
        pg.pushOperators(popGraphicsState());
      }

      // ── Pre-compute wrapped lines for all cells ─────────────────────────────
      const cellData = new Map(); // key → { lines, fontSize, isBold, fgColor }
      for (const v of flatVars) {
        if (!v.pdf_cell || (v.content_mode || 'variable') === 'empty') continue;
        const value = String(flatData[v.key] ?? '').trim();
        if (!value) continue;
        const eff      = getEffectiveStyle(v) || {};
        const fontSize = eff.fontSize ?? 9;
        const isBold   = eff.bold === true;
        const fgColor  = hexRgb(eff.color) ?? { r: 0, g: 0, b: 0 };
        const text     = await applyOverflow(value, eff);
        const lines    = wrapLines(text, regularFont, fontSize, v.pdf_cell.width - 4);
        cellData.set(v.key, { lines, fontSize, isBold, fgColor });
      }

      // ── Separate anchor vars (pdf_anchor !== false) and float vars ──────────
      const anchorVars = flatVars.filter(v => v.pdf_cell && v.pdf_anchor !== false);
      const floatVars2 = flatVars.filter(v => v.pdf_cell && v.pdf_anchor === false)
        .sort((a, b) => (a.pdf_cell.page - b.pdf_cell.page) || (a.pdf_cell.y - b.pdf_cell.y));
      const unpositioned = flatVars.filter(v => !v.pdf_cell).map(v => v.label || v.key);

      // ── Calculate extra pages needed for anchor overflow ────────────────────
      const origPageCount = origDoc.getPageCount();
      let maxAnchorPage = origPageCount - 1;
      for (const v of anchorVars) {
        const cell = v.pdf_cell;
        const cd = cellData.get(v.key);
        if (!cd) continue;
        const linesPerCell = Math.max(1, Math.round((cell.height - 4) / (cd.fontSize * 1.3)));
        const lastPage = (cell.page ?? 0) + Math.ceil(cd.lines.length / linesPerCell) - 1;
        if (lastPage > maxAnchorPage) maxAnchorPage = lastPage;
      }

      // Add extra pages (copies of original template) for anchor overflow
      if (maxAnchorPage >= origPageCount) {
        const extraCount = maxAnchorPage - origPageCount + 1;
        const toCopy = Array.from({ length: extraCount }, (_, i) => Math.min(i, origPageCount - 1));
        const copied = await origDoc.copyPages(origDoc, toCopy);
        for (const p of copied) origDoc.addPage(p);
      }
      let allPages = origDoc.getPages();
      const { width: pgW, height: pgH0 } = allPages[0].getSize();

      // ── Draw anchor cells (overflow continues on template-copy pages) ───────
      for (const v of anchorVars) {
        const cell = v.pdf_cell;
        // empty mode: white rect on designated page
        if ((v.content_mode || 'variable') === 'empty') {
          const pg = allPages[cell.page ?? 0];
          if (pg) {
            const { height: pH } = pg.getSize();
            pg.drawRectangle({ x: cell.x, y: pH - cell.y - cell.height, width: cell.width, height: cell.height, color: rgb(1,1,1), borderWidth: 0 });
          }
          continue;
        }
        const cd = cellData.get(v.key);
        if (!cd) continue;
        const { lines, fontSize, isBold, fgColor } = cd;
        const lineH = fontSize * 1.3;
        const linesPerCell = Math.max(1, Math.round((cell.height - 4) / lineH));
        let lineIdx = 0, drawPageIdx = cell.page ?? 0;
        while (lineIdx < lines.length && drawPageIdx < allPages.length) {
          const pg = allPages[drawPageIdx];
          const { height: pH } = pg.getSize();
          const topY = pH - cell.y, botY = pH - cell.y - cell.height;
          const chunk = lines.slice(lineIdx, lineIdx + linesPerCell);
          lineIdx += chunk.length;
          drawCellLines(pg, chunk, cell.x, topY, cell.width, cell.height, botY, fontSize, isBold, fgColor);
          drawPageIdx++;
        }
        // Non-overflow anchor cells: repeat on all continuation pages so headers appear on every page
        const cellOverflows = lines.length > linesPerCell;
        if (!cellOverflows && allPages.length > origPageCount) {
          for (let pi = origPageCount; pi < allPages.length; pi++) {
            const pg = allPages[pi];
            const { height: pH } = pg.getSize();
            const topY = pH - cell.y, botY = pH - cell.y - cell.height;
            drawCellLines(pg, lines, cell.x, topY, cell.width, cell.height, botY, fontSize, isBold, fgColor);
          }
        }
      }

      // ── Draw float cells (on last anchor page, or original page if no overflow) ──
      if (floatVars2.length > 0) {
        const hadOverflow = maxAnchorPage >= origPageCount;
        for (const v of floatVars2) {
          const cell = v.pdf_cell;
          if ((v.content_mode || 'variable') === 'empty') continue;
          const cd = cellData.get(v.key);
          if (!cd) continue;
          const { lines, fontSize, isBold, fgColor } = cd;
          const lineH  = fontSize * 1.3;
          const needed = lines.length * lineH + fontSize + 4;
          // If anchor overflowed, float cells go to last continuation page; else original page
          const pgIdx = hadOverflow ? maxAnchorPage : (cell.page ?? 0);
          const pg = allPages[pgIdx];
          if (!pg) continue;
          const { height: pH } = pg.getSize();
          const topY = pH - cell.y;
          // Draw with extended height so clip doesn't cut off content
          drawCellLines(pg, lines, cell.x, topY, cell.width, Math.max(cell.height, needed), topY - Math.max(cell.height, needed), fontSize, isBold, fgColor);
        }
      }

      if (unpositioned.length) {
        console.warn(`[DocTemplate] pdf_overlay: unpositioned fields skipped: ${unpositioned.join(', ')}`);
      }

      const pdfBytes = await origDoc.save();
      outPath = path.join(outDir, `${outputId}.pdf`);
      await fs.writeFile(outPath, pdfBytes);

    } else {
    // ── PDF Regen (pdfkit dynamic height) ────────────────────────────────
    // Non-form PDF: regenerate with pdfkit so rows auto-expand with content
    const PDFKit = require('pdfkit');

    // ── Flatten loop variables → numbered text ──────────────────────────────
    const flatData = { ...inputData };
    for (const v of variables) {
      if (v.type !== 'loop') continue;
      const items = Array.isArray(inputData[v.key]) ? inputData[v.key] : [];
      const children = v.children || [];
      flatData[v.key] = items.map((item, i) => {
        const parts = children.map(c => String(item[c.key] ?? '').trim()).filter(Boolean);
        return parts.length ? `${i + 1}. ${parts.join('　')}` : '';
      }).filter(Boolean).join('\n');
    }

    // ── Try to extract JPEG logo from original PDF ──────────────────────────
    let logoBytes = null;
    let logoAspect = 0.4;
    try {
      const { PDFDocument: PDFLib, PDFName, PDFDict } = require('pdf-lib');
      const origPdfDoc = await PDFLib.load(tplBuf);
      const firstPage = origPdfDoc.getPage(0);
      const resources = firstPage.node.Resources();
      if (resources) {
        const xObjects = resources.lookup(PDFName.of('XObject'));
        if (xObjects instanceof PDFDict) {
          for (const [, valOrRef] of xObjects.dict.entries()) {
            try {
              const xObj = origPdfDoc.context.lookup(valOrRef);
              if (!xObj || !xObj.dict) continue;
              const subtype = xObj.dict.get(PDFName.of('Subtype'));
              if (!subtype || subtype.encodedName !== '/Image') continue;
              const filter = xObj.dict.get(PDFName.of('Filter'));
              if (filter && filter.encodedName === '/DCTDecode') {
                logoBytes = Buffer.from(xObj.contents);
                const w = xObj.dict.get(PDFName.of('Width'))?.numberValue ?? 100;
                const h = xObj.dict.get(PDFName.of('Height'))?.numberValue ?? 40;
                logoAspect = h / w;
                break;
              }
            } catch { /* skip xObject */ }
          }
        }
      }
    } catch (e) {
      console.log('[DocTemplate] Logo extraction skipped:', e.message);
    }

    const fontPath     = path.join(__dirname, '../fonts/NotoSansTC-Regular.ttf');
    const fontBoldPath = path.join(__dirname, '../fonts/NotoSansTC-Bold.ttf');
    const MX = 50; // margin x
    const doc = new PDFKit({ margin: MX, size: 'A4', bufferPages: true });
    doc.registerFont('CJK', fontPath);
    let hasBoldFont = false;
    try { doc.registerFont('CJK-Bold', fontBoldPath); hasBoldFont = true; } catch { /* no bold */ }
    doc.font('CJK');

    const pw       = doc.page.width;
    const ph       = doc.page.height;
    const tblW     = pw - MX * 2;
    const labelW   = 85;
    const valW     = tblW - labelW;
    const fzDefault = 9;
    const bgColors  = ['#c6efce', '#bdd7ee', '#bdd7ee', '#fce4d6', '#fce4d6', '#fff2cc'];

    // ── Logo (if extracted) ──────────────────────────────────────────────
    let curY = MX;
    if (logoBytes) {
      const logoW = 140;
      const logoH = Math.max(20, Math.round(logoW * logoAspect));
      doc.image(logoBytes, MX, curY, { width: logoW });
      curY += logoH + 14;
    }

    for (let idx = 0; idx < variables.length; idx++) {
      const v = variables[idx];
      const rawVal = String(flatData[v.key] ?? '').trim();
      // Always apply style overrides (even for non-fixed-format)
      const eff    = getEffectiveStyle(v) || {};
      const value  = (eff.overflow === 'summarize') ? await applyOverflow(rawVal, eff) : rawVal;
      const label  = (v.label || v.key) + ':';
      const bg     = bgColors[idx % bgColors.length];
      const fz     = eff.fontSize || fzDefault;
      const fgHex  = eff.color   || '#000000';
      const useBold = eff.bold === true && hasBoldFont;
      const valFont = useBold ? 'CJK-Bold' : 'CJK';

      // Measure value text height; pdfkit can under-report vs actual render,
      // so add generous buffer: 15% extra + 1 line height + 16pt padding
      doc.font(valFont).fontSize(fz);
      const measuredH = doc.heightOfString(value || ' ', { width: valW - 10 });
      const rowH = Math.max(22, Math.ceil(measuredH * 1.15) + fz + 16);

      // Page overflow: start a new page if remaining space is too small
      if (curY + rowH > ph - MX) {
        doc.addPage();
        doc.font(valFont).fontSize(fz);
        curY = MX;
      }

      const rowStartY = curY;

      // ── Label cell (coloured background) ───────────────────────────────────
      doc.rect(MX, rowStartY, labelW, rowH).fillAndStroke(bg, '#aaaaaa');
      doc.font('CJK').fontSize(fzDefault).fillColor('#000000')
        .text(label, MX + 4, rowStartY + 6, { width: labelW - 8, lineBreak: false, ellipsis: true });

      // ── Value cell (white background) ───────────────────────────────────────
      doc.rect(MX + labelW, rowStartY, valW, rowH).fillAndStroke('#ffffff', '#aaaaaa');
      if (value) {
        doc.font(valFont).fontSize(fz).fillColor(fgHex)
          .text(value, MX + labelW + 4, rowStartY + 6, { width: valW - 10 });
        // Use actual pdfkit cursor (doc.y) to advance; prevents gaps AND prevents overlap
        curY = Math.max(rowStartY + rowH, doc.y + 4);
      } else {
        curY = rowStartY + rowH;
      }
    }

    outPath = path.join(outDir, `${outputId}.pdf`);
    await new Promise((resolve, reject) => {
      const wStream = require('fs').createWriteStream(outPath);
      doc.pipe(wStream);
      wStream.on('finish', resolve);
      wStream.on('error', reject);
      doc.on('error', reject);
      doc.end();
    });

    } // end else (pdf_regen)

  } else if (tpl.format === 'pdf' && tpl.strategy === 'pdf_form') {
    const { PDFDocument } = require('pdf-lib');
    const doc  = await PDFDocument.load(tplBuf);
    const form = doc.getForm();

    for (const [k, v] of Object.entries(inputData)) {
      try {
        const field = form.getTextField(k);
        field.setText(String(v ?? ''));
      } catch { /* field not found */ }
    }

    form.flatten();
    const out = await doc.save();
    outPath = path.join(outDir, `${outputId}.pdf`);
    await fs.writeFile(outPath, out);

  } else {
    throw new Error(`不支援的格式: ${tpl.format}`);
  }

  // Record output — use actual file extension from outPath (may differ when cross-format output)
  const outExt  = path.extname(outPath).slice(1) || tpl.format;
  const relPath = `generated/${outputId}.${outExt}`;

  if (!_skipDb) {
    await db.prepare(`
      INSERT INTO doc_template_outputs (id, template_id, user_id, input_data, output_file, output_format)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(outputId, templateId, userId, JSON.stringify(inputData), relPath, fmt);

    await db.prepare('UPDATE doc_templates SET use_count = use_count + 1 WHERE id=?').run(templateId);
  }

  return { outputId, filePath: relPath };
}

/**
 * Fork a template for a new owner
 */
async function forkTemplate(db, templateId, newOwnerId) {
  await ensureTemplatesDir();
  const orig = await db.prepare('SELECT * FROM doc_templates WHERE id=?').get(templateId);
  if (!orig) throw new Error('範本不存在');

  const newId  = uuid();
  const ext    = orig.format;
  const newTpl  = `templates/${newId}.${ext}`;
  const newOrig = `templates/${newId}_orig.${ext}`;

  await fs.copyFile(path.join(UPLOAD_DIR, orig.template_file), path.join(UPLOAD_DIR, newTpl));
  await fs.copyFile(path.join(UPLOAD_DIR, orig.original_file), path.join(UPLOAD_DIR, newOrig));

  await db.prepare(`
    INSERT INTO doc_templates
      (id, creator_id, name, description, format, strategy,
       template_file, original_file, schema_json, tags, forked_from)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newId, newOwnerId,
    `${orig.name}（副本）`,
    orig.description,
    orig.format, orig.strategy,
    newTpl, newOrig,
    orig.schema_json, orig.tags,
    orig.id
  );

  await db.prepare('UPDATE doc_templates SET use_count = use_count + 1 WHERE id=?').run(templateId);

  return db.prepare('SELECT * FROM doc_templates WHERE id=?').get(newId);
}

/**
 * Build a list query for a user (mine + shared + public)
 * Returns raw rows with access info.
 */
async function listTemplates(db, user, { search, format, tag } = {}) {
  const uid = String(user.id);
  // Oracle NJS-044: empty string '' is invalid bind value → null
  const n = (v) => (v && String(v).trim()) ? String(v) : null;
  const role = n(user.role_id);
  const dept = n(user.department);
  const cc   = n(user.profit_center);
  const div  = n(user.org_section);
  const og   = n(user.org_group);

  // Oracle wrapper ONLY supports positional ? params (converts to :1 :2 ...).
  // Named bind objects are NOT supported → use array params in SQL order.
  //
  // Grantee clause appears twice (CASE + WHERE), each needs its own params.
  const granteeClause = (alias) => `(
      (${alias}.grantee_type='user'        AND ${alias}.grantee_id=?) OR
      (${alias}.grantee_type='role'        AND ${alias}.grantee_id=?) OR
      (${alias}.grantee_type='department'  AND ${alias}.grantee_id=?) OR
      (${alias}.grantee_type='cost_center' AND ${alias}.grantee_id=?) OR
      (${alias}.grantee_type='division'    AND ${alias}.grantee_id=?) OR
      (${alias}.grantee_type='org_group'   AND ${alias}.grantee_id=?)
    )`;

  // Admin shortcut: see all templates as owner
  const isAdmin = user.role === 'admin';

  let sql, params;

  if (isAdmin) {
    sql = `
      SELECT t.id, t.creator_id, t.name, t.description, t.format, t.strategy,
             t.template_file, t.original_file, t.schema_json, t.preview_url,
             t.is_public, t.is_fixed_format, t.tags, t.use_count, t.forked_from, t.created_at, t.updated_at,
             'owner' AS access_level
      FROM doc_templates t
      WHERE 1=1
    `;
    params = [];
  } else {
    sql = `
      SELECT t.id, t.creator_id, t.name, t.description, t.format, t.strategy,
             t.template_file, t.original_file, t.schema_json, t.preview_url,
             t.is_public, t.is_fixed_format, t.tags, t.use_count, t.forked_from, t.created_at, t.updated_at,
        CASE
          WHEN t.creator_id = ? THEN 'owner'
          WHEN EXISTS (
            SELECT 1 FROM doc_template_shares s
            WHERE s.template_id = t.id AND s.share_type = 'edit'
              AND ${granteeClause('s')}
          ) THEN 'edit'
          ELSE 'use'
        END AS access_level
      FROM doc_templates t
      WHERE (
        t.creator_id = ?
        OR t.is_public = 1
        OR EXISTS (
          SELECT 1 FROM doc_template_shares s2
          WHERE s2.template_id = t.id AND ${granteeClause('s2')}
        )
      )
    `;
    // Params in SQL order:
    // CASE: uid, uid role dept cc div og (7)
    // WHERE: uid, uid role dept cc div og (7)
    params = [
      uid,                          // CASE creator_id
      uid, role, dept, cc, div, og, // CASE grantee (s)
      uid,                          // WHERE creator_id
      uid, role, dept, cc, div, og, // WHERE grantee (s2)
    ];
  }

  if (format) { sql += ' AND t.format = ?'; params.push(format); }
  if (search) {
    sql += ' AND (UPPER(t.name) LIKE ? OR UPPER(t.description) LIKE ?)';
    params.push(`%${search.toUpperCase()}%`, `%${search.toUpperCase()}%`);
  }

  sql += ' ORDER BY t.updated_at DESC';

  console.log('[DocTemplate] listTemplates uid=', uid, 'admin=', isAdmin, 'format=', format || '-', 'search=', search || '-');
  let rows = await db.prepare(sql).all(...params);
  console.log('[DocTemplate] listTemplates 回傳', rows.length, '筆');

  // Tag filter (client-side since tags is JSON array)
  if (tag) {
    rows = rows.filter(r => {
      try { return (JSON.parse(r.tags || '[]')).includes(tag); } catch { return false; }
    });
  }

  return rows;
}

// ─── OCR for scanned / image-based PDFs ────────────────────────────────────────

/**
 * Use Gemini Vision (Pro) to OCR a PDF and return a schema with approximate pdf_cell coords.
 * Falls back to empty schema on failure.
 */
async function ocrPdfFields(pdfBuf, model) {
  const useModel = model || MODEL_PRO;
  console.log(`[DocTemplate] ocrPdfFields: buf=${pdfBuf.length} bytes, model=${useModel}`);

  // Get actual page dimensions from pdf-lib
  let pageWidthPt = 595, pageHeightPt = 842;
  try {
    const { PDFDocument } = require('pdf-lib');
    const pdfDoc = await PDFDocument.load(pdfBuf, { ignoreEncryption: true });
    const pg = pdfDoc.getPage(0);
    const sz = pg.getSize();
    pageWidthPt  = sz.width;
    pageHeightPt = sz.height;
  } catch (e) {
    console.warn('[DocTemplate] OCR: cannot read page size, using A4 default:', e.message);
  }

  const base64 = pdfBuf.toString('base64');
  const prompt =
`你是一個 PDF 表單 OCR 識別器。請仔細分析這份 PDF（可能是掃描圖片）。

此 PDF 第一頁尺寸：${pageWidthPt.toFixed(1)} x ${pageHeightPt.toFixed(1)} pt（座標原點在左上角，x 向右，y 向下）。

請識別所有「填寫欄位」（標籤旁的空白區域、底線欄位、方格欄位）。
回傳 JSON（不要加 markdown fence，直接輸出純 JSON）：
{
  "variables": [
    {
      "key": "snake_case唯一識別碼",
      "label": "欄位標籤（中文）",
      "original_text": "填寫區內的現有文字，若空白則填空字串",
      "type": "text|number|date|select",
      "required": true,
      "description": "",
      "options": null,
      "children": [],
      "pdf_cell": {
        "page": 0,
        "x": 欄位左邊界_pt,
        "y": 欄位上邊界_pt（從頁面頂部往下量）,
        "width": 欄位寬度_pt,
        "height": 欄位高度_pt
      }
    }
  ],
  "confidence": 0.85,
  "notes": "備註"
}`;

  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    const m = genAI.getGenerativeModel({ model: useModel });
    const result = await m.generateContent([
      { inlineData: { data: base64, mimeType: 'application/pdf' } },
      prompt,
    ]);
    const raw = result.response.text().trim();
    let cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) cleaned = match[0];
    const parsed = JSON.parse(cleaned);
    console.log(`[DocTemplate] OCR: identified ${parsed.variables?.length ?? 0} fields`);
    return parsed;
  } catch (e) {
    console.error('[DocTemplate] OCR failed:', e.message);
    return { variables: [], confidence: 0, notes: `OCR 失敗: ${e.message}` };
  }
}

module.exports = {
  checkAccess,
  extractText,
  analyzeVariables,
  analyzeDocument,
  createTemplate,
  generateDocument,
  forkTemplate,
  listTemplates,
  ocrPdfFields,
  TEMPLATES_DIR,
  MODEL_FLASH,
  MODEL_PRO,
};
