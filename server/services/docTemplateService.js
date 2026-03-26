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

  // Replace all runs with a single run carrying first run's rPr + new text
  if (runs.length === 0) return paraXml;

  const firstRun = runs[0].full;
  const rPrMatch = firstRun.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  const rPr = rPrMatch ? rPrMatch[0] : '';
  const newRun = `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(newCombined)}</w:t></w:r>`;

  // Remove all matched runs from the paragraph and insert the new one
  let result = paraXml;
  // Remove in reverse order to preserve indices
  for (let i = runs.length - 1; i >= 0; i--) {
    result = result.slice(0, runs[i].index) + result.slice(runs[i].index + runs[i].full.length);
  }
  // Insert newRun before </w:p>
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
    const PizZip        = require('pizzip');
    const Docxtemplater = require('docxtemplater');

    const zip = new PizZip(tplBuf);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.render(inputData);
    const out = doc.getZip().generate({ type: 'nodebuffer' });

    outPath = path.join(outDir, `${outputId}.docx`);
    await fs.writeFile(outPath, out);

  } else if (tpl.format === 'xlsx') {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tplBuf);

    wb.eachSheet(sheet => {
      sheet.eachRow(row => {
        row.eachCell(cell => {
          if (typeof cell.value === 'string') {
            let v = cell.value;
            for (const [k, val] of Object.entries(inputData)) {
              v = v.replaceAll(`{{${k}}}`, String(val ?? ''));
            }
            cell.value = v;
          }
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
  // Get all accessible templates
  const userId = user.id;
  const roleId = user.role_id || '';
  const dept   = user.department || '';
  const cc     = user.profit_center || '';
  const div    = user.org_section || '';
  const og     = user.org_group || '';

  let sql = `
    SELECT DISTINCT t.*,
      CASE
        WHEN t.creator_id = :userId THEN 'owner'
        WHEN EXISTS (
          SELECT 1 FROM doc_template_shares s
          WHERE s.template_id = t.id AND s.share_type = 'edit'
            AND (
              (s.grantee_type='user'        AND s.grantee_id=:userId2) OR
              (s.grantee_type='role'        AND s.grantee_id=:roleId) OR
              (s.grantee_type='department'  AND s.grantee_id=:dept) OR
              (s.grantee_type='cost_center' AND s.grantee_id=:cc) OR
              (s.grantee_type='division'    AND s.grantee_id=:div) OR
              (s.grantee_type='org_group'   AND s.grantee_id=:og)
            )
        ) THEN 'edit'
        ELSE 'use'
      END AS access_level
    FROM doc_templates t
    WHERE (
      t.creator_id = :userId3
      OR t.is_public = 1
      OR EXISTS (
        SELECT 1 FROM doc_template_shares s2
        WHERE s2.template_id = t.id
          AND (
            (s2.grantee_type='user'        AND s2.grantee_id=:userId4) OR
            (s2.grantee_type='role'        AND s2.grantee_id=:roleId2) OR
            (s2.grantee_type='department'  AND s2.grantee_id=:dept2) OR
            (s2.grantee_type='cost_center' AND s2.grantee_id=:cc2) OR
            (s2.grantee_type='division'    AND s2.grantee_id=:div2) OR
            (s2.grantee_type='org_group'   AND s2.grantee_id=:og2)
          )
      )
    )
  `;

  const binds = {
    userId: String(userId), userId2: String(userId), userId3: String(userId), userId4: String(userId),
    roleId, roleId2: roleId,
    dept, dept2: dept,
    cc, cc2: cc,
    div, div2: div,
    og, og2: og,
  };

  if (format) { sql += ' AND t.format = :format'; binds.format = format; }
  if (search) { sql += ' AND (UPPER(t.name) LIKE :search OR UPPER(t.description) LIKE :search2)'; binds.search = `%${search.toUpperCase()}%`; binds.search2 = `%${search.toUpperCase()}%`; }

  sql += ' ORDER BY t.updated_at DESC';

  let rows = await db.prepare(sql).all(binds);

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
