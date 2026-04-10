'use strict';
/**
 * 語音轉文字 (Speech-to-Text) Route
 *
 * 提供麥克風語音輸入用的轉錄端點。沿用 services/gemini.js 的 transcribeAudio()，
 * 但用獨立的 model key 'gemini-flash-stt' 記帳，方便後台統計 STT 用量。
 *
 * Endpoints:
 *   GET  /api/transcribe/status         — 公開：回傳 voice_input.enabled 狀態（給前端 MicButton 判斷）
 *   POST /api/transcribe                — 上傳音訊 → 回傳轉錄文字
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { verifyToken } = require('./auth');
const { transcribeAudio } = require('../services/gemini');

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

const TMP_DIR = path.join(UPLOAD_DIR, 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// 接受常見音訊格式
const ALLOWED_AUDIO_MIMES = new Set([
  'audio/webm', 'audio/webm;codecs=opus',
  'audio/ogg',  'audio/ogg;codecs=opus',
  'audio/mp4',  'audio/x-m4a', 'audio/m4a',
  'audio/mpeg', 'audio/mp3',
  'audio/wav',  'audio/x-wav',
  'audio/aac',
]);

// 上限：feedback 最長 180s，opus 約 4MB；wav 比較大，留 20MB ceiling
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: MAX_AUDIO_BYTES },
  fileFilter: (req, file, cb) => {
    // Allow generic audio/* but be defensive
    const baseMime = (file.mimetype || '').split(';')[0].trim();
    if (!file.mimetype.startsWith('audio/') && !ALLOWED_AUDIO_MIMES.has(baseMime)) {
      return cb(new Error('Only audio files are allowed'), false);
    }
    cb(null, true);
  },
});

// ── GET /api/transcribe/status ───────────────────────────────────────────────
// 公開端點（仍需登入），讓前端 MicButton 判斷是否要顯示
router.get('/status', verifyToken, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(
      `SELECT key, value FROM system_settings WHERE key IN ('voice_input_enabled','voice_input_prefer_backend_only')`
    ).all();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.json({
      enabled: map.voice_input_enabled !== '0',  // 預設開啟
      preferBackendOnly: map.voice_input_prefer_backend_only === '1',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/transcribe ─────────────────────────────────────────────────────
router.post('/', verifyToken, upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file uploaded' });
  }
  const filePath = req.file.path;
  const mimeType = req.file.mimetype || 'audio/webm';
  const lang = (req.body?.lang || 'zh-TW').toString();
  const source = (req.body?.source || 'unknown').toString(); // chat | feedback

  // 檢查管理員開關
  try {
    const db = require('../database-oracle').db;
    const enabledRow = await db.prepare(
      `SELECT value FROM system_settings WHERE key='voice_input_enabled'`
    ).get();
    if (enabledRow && enabledRow.value === '0') {
      try { fs.unlinkSync(filePath); } catch (_) {}
      return res.status(403).json({ error: '管理員已關閉語音輸入功能' });
    }
  } catch (_) { /* 忽略，預設開啟 */ }

  const startedAt = Date.now();
  try {
    console.log(`[Transcribe] user=${req.user.id} source=${source} lang=${lang} mime=${mimeType} size=${req.file.size}`);
    // 60 秒上限給單次轉錄（前端通常 60/180s 內，這邊預留 buffer）
    const result = await transcribeAudio(filePath, mimeType, lang, 5 * 60 * 1000);
    const duration = Date.now() - startedAt;

    // 記錄 token 用量到 token_usage（model key = 'gemini-flash-stt'）
    if (result.inputTokens > 0 || result.outputTokens > 0) {
      try {
        const db = require('../database-oracle').db;
        const { upsertTokenUsage } = require('../services/tokenService');
        const today = new Date().toISOString().slice(0, 10);
        await upsertTokenUsage(
          db,
          req.user.id,
          today,
          'gemini-flash-stt',
          result.inputTokens,
          result.outputTokens,
          0
        );
      } catch (e) {
        console.error('[Transcribe] token accounting failed:', e.message);
      }
    }

    res.json({
      text: result.text || '',
      durationMs: duration,
      inputTokens: result.inputTokens || 0,
      outputTokens: result.outputTokens || 0,
    });
  } catch (e) {
    console.error('[Transcribe] failed:', e.message);
    res.status(500).json({ error: e.message || 'Transcription failed' });
  } finally {
    // 清除暫存檔
    try { fs.unlinkSync(filePath); } catch (_) {}
  }
});

// 對 multer 錯誤的友善處理（檔案過大等）
router.use((err, req, res, _next) => {
  if (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: '音訊檔案過大（上限 20MB）' });
    }
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
