'use strict';

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs').promises;
const { v4: uuid } = require('uuid');
const { verifyToken } = require('./auth');
const { db } = require('../database-oracle');
const svc = require('../services/docTemplateService');

const router = express.Router();
router.use(verifyToken);

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

const ALLOWED_FORMATS = { docx: true, xlsx: true, pdf: true, pptx: true };

// Temp upload storage
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tmp = path.join(UPLOAD_DIR, 'tmp');
      require('fs').mkdirSync(tmp, { recursive: true });
      cb(null, tmp);
    },
    filename: (req, file, cb) => cb(null, `${uuid()}_${Date.now()}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (ALLOWED_FORMATS[ext]) cb(null, true);
    else cb(new Error('不支援的格式，僅接受 DOCX / XLSX / PDF'));
  },
});

function formatFromFile(originalname) {
  return (originalname.split('.').pop() || '').toLowerCase();
}

// ─── Helper: attach creator name ──────────────────────────────────────────────
async function attachCreatorName(rows) {
  if (!rows.length) return rows;
  const ids = [...new Set(rows.map(r => r.creator_id))];
  const users = await db.prepare(
    `SELECT id, name, username FROM users WHERE id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids);
  const map = Object.fromEntries(users.map(u => [u.id, u.name || u.username]));
  return rows.map(r => ({ ...r, creator_name: map[r.creator_id] || '' }));
}

// ─── GET /  List ──────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { search, format, tag } = req.query;
    let rows = await svc.listTemplates(db, req.user, { search, format, tag });
    rows = await attachCreatorName(rows);
    res.json(rows);
  } catch (e) {
    console.error('[DocTemplates] list error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /upload  Analyze ────────────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請上傳檔案' });

  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const format = formatFromFile(originalName) || formatFromFile(req.file.originalname);
  console.log(`[DocTemplates] upload: file=${originalName}, format=${format}, size=${req.file.size}`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    // Step 1: extract text
    send('status', { step: 'parsing', message: '擷取文件內容中...' });
    let text = '';
    let schema;

    if (format === 'pdf') {
      // Try AcroForm first
      const { default: pdfLib } = await import('pdf-lib').catch(() => ({ default: require('pdf-lib') }));
      const buf = await fs.readFile(req.file.path);
      try {
        const pdfDoc = await pdfLib.PDFDocument.load(buf, { ignoreEncryption: true });
        const form = pdfDoc.getForm();
        const fields = form.getFields().map(f => ({
          key: f.getName().replace(/\s+/g, '_').toLowerCase(),
          label: f.getName(),
          type: 'text',
          required: false,
          original_text: f.getName(),
          description: 'PDF 表單欄位',
          options: null,
          children: [],
        }));
        if (fields.length > 0) {
          console.log(`[DocTemplates] PDF AcroForm 偵測到 ${fields.length} 個欄位`);
          schema = { variables: fields, confidence: 1.0, notes: 'PDF 表單欄位自動偵測', strategy: 'pdf_form' };
        }
      } catch (e) {
        console.log('[DocTemplates] PDF AcroForm 偵測失敗，改用 AI 分析:', e.message);
      }
    }

    if (!schema && format === 'pdf') {
      // Detect scanned (image-only) PDF: try pdf-parse first; if text too short → OCR
      try {
        const pdfParse = require('pdf-parse');
        const buf = await fs.readFile(req.file.path);
        const parsed = await pdfParse(buf);
        const nonWs = (parsed.text || '').replace(/\s/g, '').length;
        if (nonWs < 50) {
          send('status', { step: 'ocr', message: '偵測到掃描式 PDF，使用 Gemini Vision OCR...' });
          let ocrModel;
          try {
            const row = await db.prepare(`SELECT value FROM system_settings WHERE key=?`).get('template_analysis_model');
            if (row?.value === 'pro') ocrModel = svc.MODEL_PRO;
          } catch {}
          const ocrResult = await svc.ocrPdfFields(buf, ocrModel);
          schema = { ...ocrResult, strategy: 'ai_schema', extracted_at: new Date().toISOString(), is_ocr: true };
        }
      } catch (e) {
        console.warn('[DocTemplates] scanned-PDF detection error:', e.message);
      }
    }

    if (!schema) {
      text = await svc.extractText(req.file.path, format);
      console.log(`[DocTemplates] 擷取文字長度: ${text.length}`);

      // Step 2: AI analyze
      send('status', { step: 'analyzing', message: 'AI 分析變數中...' });

      // Read model from system_settings (allow admin to switch flash/pro)
      let model;
      try {
        const settingRow = await db.prepare(`SELECT value FROM system_settings WHERE key=?`).get('template_analysis_model');
        if (settingRow?.value === 'pro') model = svc.MODEL_PRO;
        else if (settingRow?.value === 'flash') model = svc.MODEL_FLASH;
      } catch { /* ignore */ }

      const aiResult = await svc.analyzeVariables(text, model);
      schema = { ...aiResult, strategy: format === 'pdf' ? 'ai_schema' : 'native', extracted_at: new Date().toISOString() };
    }

    send('result', {
      schema,
      temp_file: req.file.filename,
      format,
      original_name: originalName,
    });
    send('done', {});
  } catch (e) {
    console.error('[DocTemplates] upload error:', e.message, e.stack);
    send('error', { message: e.message });
  } finally {
    res.end();
    setTimeout(() => fs.unlink(req.file.path).catch(() => {}), 30 * 60 * 1000);
  }
});

// ─── POST /  Create ───────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, description, format, tags, is_public, is_fixed_format, schema_json, temp_file, original_name } = req.body;
  if (!name || !format || !temp_file || !schema_json) {
    return res.status(400).json({ error: '缺少必要欄位' });
  }
  if (!ALLOWED_FORMATS[format]) {
    return res.status(400).json({ error: '不支援的格式' });
  }

  const tempPath = path.join(UPLOAD_DIR, 'tmp', temp_file);
  try {
    await fs.access(tempPath);
  } catch {
    return res.status(400).json({ error: '暫存檔不存在或已過期，請重新上傳' });
  }

  try {
    const tpl = await svc.createTemplate(db, {
      creatorId: req.user.id,
      name,
      description,
      format,
      tags: typeof tags === 'string' ? JSON.parse(tags) : tags,
      isPublic: is_public,
      isFixedFormat: is_fixed_format,
      schemaJson: typeof schema_json === 'string' ? JSON.parse(schema_json) : schema_json,
      tempFilePath: tempPath,
    });

    // Clean up temp
    fs.unlink(tempPath).catch(() => {});

    res.json(tpl);
  } catch (e) {
    console.error('[DocTemplates] create error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const access = await svc.checkAccess(db, req.params.id, req.user);
    if (!access) return res.status(403).json({ error: '無存取權限' });

    const tpl = await db.prepare('SELECT * FROM doc_templates WHERE id=?').get(req.params.id);
    if (!tpl) return res.status(404).json({ error: '範本不存在' });

    res.json({ ...tpl, access_level: access });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /:id/preview-file  Serve original file (for PDF visual editor) ────────
router.get('/:id/preview-file', async (req, res) => {
  try {
    const access = await svc.checkAccess(db, req.params.id, req.user);
    if (!access) return res.status(403).json({ error: '無存取權限' });

    const tpl = await db.prepare('SELECT original_file, format FROM doc_templates WHERE id=?').get(req.params.id);
    if (!tpl) return res.status(404).json({ error: '範本不存在' });

    const filePath = path.join(UPLOAD_DIR, tpl.original_file);
    const mimeMap = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
    res.setHeader('Content-Type', mimeMap[tpl.format] || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PUT /:id  Update ─────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const access = await svc.checkAccess(db, req.params.id, req.user);
    if (!access || access === 'use') return res.status(403).json({ error: '無編輯權限' });

    const { name, description, tags, schema_json, is_public, is_fixed_format } = req.body;

    // Only owner/admin can toggle is_public
    if (is_public !== undefined && access !== 'owner') {
      return res.status(403).json({ error: '僅範本建立者可設定公開' });
    }

    const fields = [];
    const vals = [];

    if (name !== undefined)           { fields.push('name=?');            vals.push(name); }
    if (description !== undefined)    { fields.push('description=?');     vals.push(description); }
    if (tags !== undefined)           { fields.push('tags=?');            vals.push(JSON.stringify(tags)); }
    if (schema_json !== undefined)    { fields.push('schema_json=?');     vals.push(typeof schema_json === 'string' ? schema_json : JSON.stringify(schema_json)); }
    if (is_public !== undefined)      { fields.push('is_public=?');       vals.push(is_public ? 1 : 0); }
    if (is_fixed_format !== undefined){ fields.push('is_fixed_format=?'); vals.push(is_fixed_format ? 1 : 0); }

    if (fields.length) {
      fields.push('updated_at=SYSTIMESTAMP');
      vals.push(req.params.id);
      await db.prepare(`UPDATE doc_templates SET ${fields.join(',')} WHERE id=?`).run(...vals);
    }

    const tpl = await db.prepare('SELECT * FROM doc_templates WHERE id=?').get(req.params.id);
    res.json(tpl);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const access = await svc.checkAccess(db, req.params.id, req.user);
    if (access !== 'owner') return res.status(403).json({ error: '僅範本建立者可刪除' });

    const tpl = await db.prepare('SELECT * FROM doc_templates WHERE id=?').get(req.params.id);
    if (!tpl) return res.status(404).json({ error: '範本不存在' });

    // Remove files
    for (const f of [tpl.template_file, tpl.original_file]) {
      if (f) fs.unlink(path.join(UPLOAD_DIR, f)).catch(() => {});
    }

    await db.prepare('DELETE FROM doc_template_outputs WHERE template_id=?').run(req.params.id);
    await db.prepare('DELETE FROM doc_template_shares WHERE template_id=?').run(req.params.id);
    await db.prepare('DELETE FROM doc_templates WHERE id=?').run(req.params.id);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /:id/download  Download original file ────────────────────────────────
router.get('/:id/download', async (req, res) => {
  try {
    const access = await svc.checkAccess(db, req.params.id, req.user);
    if (!access) return res.status(403).json({ error: '無存取權限' });

    const tpl = await db.prepare('SELECT * FROM doc_templates WHERE id=?').get(req.params.id);
    if (!tpl) return res.status(404).json({ error: '範本不存在' });

    // type=template: download the {{placeholder}} file (edit only)
    const useTemplate = req.query.type === 'template';
    if (useTemplate && access === 'use') {
      return res.status(403).json({ error: '需要編輯權限才能下載範本檔' });
    }

    const filePath = path.join(UPLOAD_DIR, useTemplate ? tpl.template_file : tpl.original_file);
    const ext = tpl.format;
    const filename = encodeURIComponent(`${tpl.name}${useTemplate ? '_template' : ''}.${ext}`);

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /:id/generate ───────────────────────────────────────────────────────
router.post('/:id/generate', async (req, res) => {
  try {
    const access = await svc.checkAccess(db, req.params.id, req.user);
    if (!access) return res.status(403).json({ error: '無存取權限' });

    const { input_data, output_format } = req.body;
    const result = await svc.generateDocument(db, req.params.id, req.user.id, input_data || {}, output_format);

    res.json({
      output_id: result.outputId,
      download_url: `/uploads/${result.filePath}`,
    });
  } catch (e) {
    console.error('[DocTemplates] generate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /:id/outputs ─────────────────────────────────────────────────────────
router.get('/:id/outputs', async (req, res) => {
  try {
    const access = await svc.checkAccess(db, req.params.id, req.user);
    if (!access) return res.status(403).json({ error: '無存取權限' });

    const rows = await db.prepare(
      `SELECT o.*, u.name AS user_name FROM doc_template_outputs o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.template_id=? ORDER BY o.created_at DESC`
    ).all(req.params.id);

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /:id/fork ───────────────────────────────────────────────────────────
router.post('/:id/fork', async (req, res) => {
  try {
    const access = await svc.checkAccess(db, req.params.id, req.user);
    if (!access) return res.status(403).json({ error: '無存取權限' });

    const tpl = await svc.forkTemplate(db, req.params.id, req.user.id);
    res.json(tpl);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /:id/ocr-scan  Re-OCR a PDF template ──────────────────────────────
router.post('/:id/ocr-scan', async (req, res) => {
  try {
    const access = await svc.checkAccess(db, req.params.id, req.user);
    if (!access || access === 'use') return res.status(403).json({ error: '需要編輯權限' });

    const tpl = await db.prepare('SELECT * FROM doc_templates WHERE id=?').get(req.params.id);
    if (!tpl || tpl.format !== 'pdf') return res.status(400).json({ error: '僅支援 PDF 範本' });

    const filePath = path.join(UPLOAD_DIR, tpl.original_file);
    const buf = await fs.readFile(filePath);

    let ocrModel;
    try {
      const row = await db.prepare(`SELECT value FROM system_settings WHERE key=?`).get('template_analysis_model');
      if (row?.value === 'pro') ocrModel = svc.MODEL_PRO;
    } catch {}

    const ocrResult = await svc.ocrPdfFields(buf, ocrModel);

    // Merge: keep existing non-pdf_cell fields, update or append OCR fields
    const existing = JSON.parse(tpl.schema_json || '{}');
    const existingVars = existing.variables || [];
    const ocrVars = ocrResult.variables || [];

    // Map existing vars by key for quick lookup
    const varMap = Object.fromEntries(existingVars.map(v => [v.key, v]));
    for (const ov of ocrVars) {
      if (varMap[ov.key]) {
        // Update pdf_cell on existing var (preserve other settings)
        varMap[ov.key] = { ...varMap[ov.key], pdf_cell: ov.pdf_cell };
      } else {
        // New var detected by OCR
        varMap[ov.key] = ov;
      }
    }
    const mergedVars = Object.values(varMap);
    const merged = { ...existing, variables: mergedVars, is_ocr: true };

    await db.prepare(`UPDATE doc_templates SET schema_json=?, updated_at=SYSTIMESTAMP WHERE id=?`)
      .run(JSON.stringify(merged), req.params.id);

    res.json({ ok: true, schema: merged });
  } catch (e) {
    console.error('[DocTemplates] ocr-scan error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Shares CRUD ──────────────────────────────────────────────────────────────

router.get('/:id/shares', async (req, res) => {
  try {
    const access = await svc.checkAccess(db, req.params.id, req.user);
    if (access !== 'owner') return res.status(403).json({ error: '無存取權限' });

    const shares = await db.prepare(
      'SELECT * FROM doc_template_shares WHERE template_id=? ORDER BY created_at DESC'
    ).all(req.params.id);

    // Attach user names for grantee_type=user
    const userIds = shares.filter(s => s.grantee_type === 'user').map(s => Number(s.grantee_id));
    let userMap = {};
    if (userIds.length) {
      const users = await db.prepare(
        `SELECT id, name, username FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`
      ).all(...userIds);
      userMap = Object.fromEntries(users.map(u => [u.id, u.name || u.username]));
    }

    const result = shares.map(s => ({
      ...s,
      grantee_name: s.grantee_type === 'user' ? (userMap[Number(s.grantee_id)] || s.grantee_id) : s.grantee_id,
    }));

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/shares', async (req, res) => {
  try {
    const access = await svc.checkAccess(db, req.params.id, req.user);
    if (access !== 'owner') return res.status(403).json({ error: '無存取權限' });

    const { share_type, grantee_type, grantee_id } = req.body;
    if (!grantee_type || !grantee_id) return res.status(400).json({ error: '缺少 grantee_type / grantee_id' });

    // Upsert via merge or delete+insert (Oracle doesn't have ON CONFLICT easily)
    const existing = await db.prepare(
      'SELECT id FROM doc_template_shares WHERE template_id=? AND grantee_type=? AND grantee_id=?'
    ).get(req.params.id, grantee_type, String(grantee_id));

    if (existing) {
      await db.prepare(
        'UPDATE doc_template_shares SET share_type=? WHERE id=?'
      ).run(share_type || 'use', existing.id);
    } else {
      await db.prepare(`
        INSERT INTO doc_template_shares (template_id, share_type, grantee_type, grantee_id, granted_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(req.params.id, share_type || 'use', grantee_type, String(grantee_id), req.user.id);
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id/shares/:shareId', async (req, res) => {
  try {
    const access = await svc.checkAccess(db, req.params.id, req.user);
    if (access !== 'owner') return res.status(403).json({ error: '無存取權限' });

    await db.prepare('DELETE FROM doc_template_shares WHERE id=? AND template_id=?').run(
      req.params.shareId, req.params.id
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
