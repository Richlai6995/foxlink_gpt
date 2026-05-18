/**
 * /api/projects/wizard — AI-assisted 開案 Wizard helpers
 *
 * Endpoints:
 *   POST /extract-rfq      multipart file → Gemini Vision 抽欄位
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { asyncHandler } = require('../middleware/errorBoundary');
const rfqExtractor = require('../services/rfqExtractor');

const router = express.Router();

// 上傳暫存:UPLOAD_ROOT/projects/rfq/{userId}/{uuid}.{ext}
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || process.env.UPLOAD_DIR || './uploads';
const RFQ_DIR = path.join(UPLOAD_ROOT, 'projects', 'rfq');
try { fs.mkdirSync(RFQ_DIR, { recursive: true }); } catch (_) {}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = path.join(RFQ_DIR, String(req.user?.id || 'unknown'));
    try { fs.mkdirSync(userDir, { recursive: true }); } catch (_) {}
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const stamp = Date.now();
    const rnd = Math.random().toString(36).slice(2, 8);
    cb(null, `rfq_${stamp}_${rnd}${ext}`);
  },
});

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'message/rfc822',  // .eml
]);

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) return cb(null, true);
    cb(new Error(`unsupported file type: ${file.mimetype}`));
  },
});

/**
 * POST /api/projects/wizard/extract-rfq
 *  multipart field: file (PDF/img/eml)
 *  回 {
 *    file_path, original_name, mime_type, size,
 *    extracted: { customer, part_no, quantity, due_date, specs, notes, confidence, missing, warnings }
 *  }
 */
router.post('/extract-rfq',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    try {
      const extracted = await rfqExtractor.extract(req.file.path, req.file.mimetype);
      res.json({
        file_path:     req.file.path,
        original_name: req.file.originalname,
        mime_type:     req.file.mimetype,
        size:          req.file.size,
        extracted,
      });
    } catch (e) {
      console.error('[wizard] extract-rfq error:', e);
      // 清掉 upload 殘檔
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      res.status(500).json({ error: e.message, code: 'EXTRACT_FAILED' });
    }
  }),
);

// multer error handler — 大檔 / 副檔限制
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  if (err && /unsupported file type/.test(err.message || '')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
