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

/**
 * Find the FIRST <w:tc> whose combined run text contains searchText,
 * and replace its entire body content with newText (supports \n → <w:br/>).
 * Returns { xml: newXml, found: boolean }
 */
function replaceTcContent(xml, searchText, newText) {
  let found = false;
  const newXml = xml.replace(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g, (tcXml) => {
    if (found) return tcXml;

    // Collect all run texts in this cell (handles run-splitting)
    const runTexts = [];
    const runPat = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let m;
    while ((m = runPat.exec(tcXml)) !== null) runTexts.push(m[1]);

    // Decode common XML entities for comparison
    const cellText = runTexts.join('')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

    if (!cellText.includes(searchText)) return tcXml;
    found = true;

    // Preserve cell properties
    const tcOpenMatch = tcXml.match(/^(<w:tc\b[^>]*>)/);
    const tcOpen = tcOpenMatch ? tcOpenMatch[1] : '<w:tc>';
    const tcPrMatch = tcXml.match(/(<w:tcPr>[\s\S]*?<\/w:tcPr>)/);
    const tcPr = tcPrMatch ? tcPrMatch[1] : '';

    // Preserve paragraph + run formatting from first content paragraph
    let pPr = '', rPr = '';
    const firstParaMatch = tcXml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/);
    if (firstParaMatch) {
      const pPrM = firstParaMatch[0].match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
      if (pPrM) pPr = `<w:pPr>${pPrM[1]}</w:pPr>`;
      const rPrM = firstParaMatch[0].match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
      if (rPrM) rPr = `<w:rPr>${rPrM[1]}</w:rPr>`;
    }

    // Build replacement: one paragraph with new content + required empty trailing paragraph
    const newPara = `<w:p>${pPr}${buildRunXml(rPr, newText)}</w:p>`;
    const emptyPara = `<w:p>${pPr}</w:p>`;
    return `${tcOpen}${tcPr}${newPara}${emptyPara}</w:tc>`;
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
async function createTemplate(db, { creatorId, name, description, format, tags, isPublic, schemaJson, tempFilePath }) {
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

  await db.prepare(`
    INSERT INTO doc_templates
      (id, creator_id, name, description, format, strategy,
       template_file, original_file, schema_json, tags, is_public)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, creatorId, name, description || null, format, strategy,
    `templates/${id}.${ext}`,
    `templates/${id}_orig.${ext}`,
    JSON.stringify(schemaJson),
    tags ? JSON.stringify(tags) : null,
    isPublic ? 1 : 0
  );

  return db.prepare('SELECT * FROM doc_templates WHERE id=?').get(id);
}

/**
 * Generate document from template with user-supplied data
 */
async function generateDocument(db, templateId, userId, inputData, outputFormat) {
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
    // Use ORIGINAL file + direct XML replacement.
    // Docxtemplater {{}} approach fails when Word splits runs, causing duplicate-tag errors.
    const JSZip = require('jszip');
    const origBuf = await fs.readFile(path.join(UPLOAD_DIR, tpl.original_file));
    const zip     = await new JSZip().loadAsync(origBuf);
    let xml = await zip.file('word/document.xml').async('string');

    const variables = schema.variables || [];

    // ── Strip <w:tblHeader/> to prevent rows from repeating on each page ────
    // Word's "repeat header rows" feature causes ALL marked rows to appear on
    // every page. Remove this to keep headers on page 1 only.
    xml = xml.replace(/<w:tblHeader\/>/g, '');
    // Clean up any trPr that became empty after removal
    xml = xml.replace(/<w:trPr>\s*<\/w:trPr>/g, '');

    // ── Simple variables (text / number / date / select) ───────────────────
    for (const v of variables) {
      if (!v.original_text || v.type === 'loop') continue;
      const val = String(inputData[v.key] ?? v.default_value ?? '');
      // Try cell-level replacement first (more reliable for multi-paragraph cells)
      const { xml: x1, found } = replaceTcContent(xml, v.original_text, val);
      if (found) {
        xml = x1;
      } else {
        // Fallback: paragraph-level run merge + replace
        xml = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) =>
          mergeRunsAndReplace(para, v.original_text, val)
        );
      }
    }

    // ── Loop variables ──────────────────────────────────────────────────────
    // Strategy:
    //   1. ALL children's original_text in the SAME <w:tr> → row duplication
    //   2. Otherwise → replace each child's entire cell with numbered list text
    for (const v of variables) {
      if (v.type !== 'loop') continue;
      const items = Array.isArray(inputData[v.key]) ? inputData[v.key] : [];
      const children = v.children || [];
      if (!children.length || !items.length) continue;

      const firstChild = children.find(c => c.original_text);
      if (!firstChild) continue;

      const escapedText = firstChild.original_text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const trPattern = new RegExp(`<w:tr\\b[^>]*>[\\s\\S]*?${escapedText}[\\s\\S]*?<\\/w:tr>`);
      const trMatch = xml.match(trPattern);

      const isRepeatingRow = trMatch && children
        .filter(c => c.original_text)
        .every(c => trMatch[0].includes(c.original_text));

      if (isRepeatingRow) {
        // ── True repeating table row ──────────────────────────────────────
        const templateRow = trMatch[0];
        const newRows = items.map(item => {
          let row = templateRow;
          for (const c of children) {
            if (!c.original_text) continue;
            row = row.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) =>
              mergeRunsAndReplace(para, c.original_text, String(item[c.key] ?? ''))
            );
          }
          return row;
        });
        xml = xml.replace(templateRow, newRows.join(''));
      } else {
        // ── Flat: replace entire cell content per child ───────────────────
        // Each child gets its cell's content replaced with all items' values
        // joined as a numbered list (with Word line-breaks for multi-line)
        for (const c of children) {
          if (!c.original_text) continue;
          const vals = items
            .map((item, idx) => {
              const val = String(item[c.key] ?? '').trim();
              return val ? `${idx + 1}. ${val}` : '';
            })
            .filter(s => s);
          const newText = vals.join('\n');
          // Cell-level replacement (replaces all paragraphs in the matching cell)
          const { xml: newXml, found } = replaceTcContent(xml, c.original_text, newText);
          if (found) {
            xml = newXml;
          } else {
            // Fallback: paragraph-level
            xml = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) =>
              mergeRunsAndReplace(para, c.original_text, newText)
            );
          }
        }
      }
    }

    zip.file('word/document.xml', xml);
    const out = await zip.generateAsync({ type: 'nodebuffer',
      compression: 'DEFLATE', compressionOptions: { level: 6 } });

    outPath = path.join(outDir, `${outputId}.docx`);
    await fs.writeFile(outPath, out);

  } else if (tpl.format === 'xlsx') {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    // Use original file to avoid broken {{}} injection
    const origBuf = await fs.readFile(path.join(UPLOAD_DIR, tpl.original_file));
    await wb.xlsx.load(origBuf);

    const variables = schema.variables || [];
    wb.eachSheet(sheet => {
      sheet.eachRow(row => {
        row.eachCell(cell => {
          if (typeof cell.value !== 'string') return;
          let v = cell.value;
          for (const varDef of variables) {
            if (!varDef.original_text || varDef.type === 'loop') continue;
            if (v.includes(varDef.original_text)) {
              v = v.replaceAll(varDef.original_text, String(inputData[varDef.key] ?? ''));
            }
          }
          cell.value = v;
        });
      });
    });

    outPath = path.join(outDir, `${outputId}.xlsx`);
    await wb.xlsx.writeFile(outPath);

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

  // Record output
  const relPath = `generated/${outputId}.${tpl.format}`;
  await db.prepare(`
    INSERT INTO doc_template_outputs (id, template_id, user_id, input_data, output_file, output_format)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(outputId, templateId, userId, JSON.stringify(inputData), relPath, fmt);

  // Increment use_count
  await db.prepare('UPDATE doc_templates SET use_count = use_count + 1 WHERE id=?').run(templateId);

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
             t.is_public, t.tags, t.use_count, t.forked_from, t.created_at, t.updated_at,
             'owner' AS access_level
      FROM doc_templates t
      WHERE 1=1
    `;
    params = [];
  } else {
    sql = `
      SELECT t.id, t.creator_id, t.name, t.description, t.format, t.strategy,
             t.template_file, t.original_file, t.schema_json, t.preview_url,
             t.is_public, t.tags, t.use_count, t.forked_from, t.created_at, t.updated_at,
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

module.exports = {
  checkAccess,
  extractText,
  analyzeVariables,
  analyzeDocument,
  createTemplate,
  generateDocument,
  forkTemplate,
  listTemplates,
  TEMPLATES_DIR,
  MODEL_FLASH,
  MODEL_PRO,
};
