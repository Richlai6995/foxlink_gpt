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
const { budgetGuard } = require('../middleware/budgetGuard');
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
  'audio/flac', 'audio/x-flac',
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
router.post('/', verifyToken, upload.single('audio'), budgetGuard, async (req, res) => {
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

// ── 長音訊背景轉錄 Job ───────────────────────────────────────────────────────
// 設計文件:docs/long-audio-background-job-plan.md
// 對齊 /api/research/jobs pattern,前端 polling 3s 拿進度

// 從 DB row 整理回前端可用的 JSON 結構
function _formatJob(row) {
  if (!row) return null;
  let segmentsLite = null;
  if (row.segments_json) {
    try {
      const segs = JSON.parse(row.segments_json);
      // 不回傳 segments[i].text(可能很大,前端只需要進度資訊)
      segmentsLite = segs.map(s => ({
        idx: s.idx,
        ok: s.ok,
        marker: s.marker,
        attempts: s.attempts,
        chars: s.text?.length || 0,
        error: s.error,
      }));
    } catch (_) {}
  }
  return {
    id: row.id,
    user_id: row.user_id,
    session_id: row.session_id,
    message_id: row.message_id,
    audio_filename: row.audio_filename,
    audio_size_mb: row.audio_size_mb,
    duration_sec: row.duration_sec,
    status: row.status,
    segment_total: row.segment_total,
    segment_done: row.segment_done,
    segments: segmentsLite,
    transcript_chars: row.transcript_chars,
    transcript_file: row.transcript_file,
    transcript_url: row.transcript_file ? `/uploads/generated/${row.transcript_file}` : null,
    in_tokens_total: row.in_tokens_total,
    out_tokens_total: row.out_tokens_total,
    error_msg: row.error_msg,
    is_notified: row.is_notified,
    recovery_count: row.recovery_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
  };
}

// GET /api/transcribe/jobs — 列當前 user 自己的 job(最新 50 筆)
router.get('/jobs', verifyToken, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(`
      SELECT * FROM transcribe_jobs
      WHERE user_id = ?
      ORDER BY created_at DESC
      FETCH FIRST 50 ROWS ONLY
    `).all(req.user.id);
    res.json(rows.map(_formatJob));
  } catch (e) {
    console.error('[TranscribeJob] list error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/transcribe/jobs/unnotified — 撈未通知的完成 job(前端鈴鐺/toast 用)
router.get('/jobs/unnotified', verifyToken, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(`
      SELECT * FROM transcribe_jobs
      WHERE user_id = ? AND is_notified = 0 AND status IN ('done','failed')
      ORDER BY completed_at DESC
    `).all(req.user.id);
    res.json(rows.map(_formatJob));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/transcribe/jobs/:id — 單一 job 詳情(前端 polling 主用)
router.get('/jobs/:id', verifyToken, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const row = await db.prepare('SELECT * FROM transcribe_jobs WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'job not found' });
    // 權限:本人 / admin
    if (row.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }
    res.json(_formatJob(row));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/transcribe/jobs/:id/notify — 標已通知(前端拿到 toast 後呼叫)
router.post('/jobs/:id/notify', verifyToken, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const row = await db.prepare('SELECT user_id FROM transcribe_jobs WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'job not found' });
    if (row.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
    await db.prepare('UPDATE transcribe_jobs SET is_notified = 1, updated_at = SYSTIMESTAMP WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/transcribe/admin/jobs — admin 監控(全系統)
router.get('/admin/jobs', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  try {
    const db = require('../database-oracle').db;
    const status = req.query.status;
    const limit = Math.min(parseInt(req.query.limit || '100'), 500);
    const offset = parseInt(req.query.offset || '0');
    let sql = 'SELECT * FROM transcribe_jobs';
    const params = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    sql += ` ORDER BY created_at DESC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    const rows = await db.prepare(sql).all(...params);
    res.json(rows.map(_formatJob));
  } catch (e) {
    res.status(500).json({ error: e.message });
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
