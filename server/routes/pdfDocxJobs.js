'use strict';
/**
 * pdfDocxJobs.js — PDF 轉 Word 背景 job user-facing endpoints
 *
 * 路徑 base:/api/pdf-docx-jobs
 *
 * Endpoints:
 *   GET    /                   列當前 user 的 jobs(可 ?status=running 等 filter)
 *   GET    /:id                取單個 job(進度 / 結果)
 *   POST   /decrypt-submit     前端 password modal 用:{token, password, format?, vision_model?}
 *                              → 拿 pendingPasswordStore.consume(token) → inspect 驗密碼 → submitJob
 *   POST   /submit             直接 submit job(非加密 PDF;skill 內部走背景路徑用)
 *
 * 所有 endpoint 需 verifyToken。
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const { verifyToken } = require('./auth');
const pdfDocxJobService = require('../services/pdfDocxJobService');
const pendingStore = require('../services/pendingPasswordStore');
const { runWorker } = require('../python_workers/pdfWorker');

const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || '/app/uploads');

router.use(verifyToken);

// ── List my jobs ───────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const jobs = await pdfDocxJobService.listJobsForUser(db, req.user.id, {
      limit: Number(req.query.limit) || 50,
      status: req.query.status || null,
    });
    res.json({ ok: true, jobs });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Get one job(進度 polling 用)──────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { db } = require('../database-oracle');
  try {
    const job = await pdfDocxJobService.getJob(db, req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: 'job not found' });
    if (Number(job.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    // 不回傳 password_encrypted(雖然 done 後已 NULL,但 running 中還在)
    delete job.password_encrypted;
    res.json({ ok: true, job });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 提交 job(無密碼路徑,給 skill / 大檔直接走背景用)─────────────────────
router.post('/submit', async (req, res) => {
  const { db } = require('../database-oracle');
  const { pdfPath, pdfName, format, vision_model, pages, sessionId } = req.body || {};
  if (!pdfPath) return res.status(400).json({ ok: false, error: 'pdfPath required' });

  // 路徑安全
  let realPath;
  try { realPath = fs.realpathSync(pdfPath); }
  catch (_) { return res.status(404).json({ ok: false, error: 'PDF not found' }); }
  if (!realPath.startsWith(UPLOAD_ROOT)) {
    return res.status(403).json({ ok: false, error: 'path outside upload root' });
  }

  try {
    const jobId = await pdfDocxJobService.submitJob(db, {
      userId: req.user.id,
      sessionId,
      pdfPath: realPath,
      pdfName: pdfName || path.basename(realPath),
      format: format || 'auto',
      vision_model: vision_model || 'flash',
      pages: pages || null,
    });
    res.json({ ok: true, jobId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 加密 PDF:前端 modal 送密碼 → 驗密碼 → submit job ──────────────────────
// body: { token, password, format?, vision_model? }
router.post('/decrypt-submit', async (req, res) => {
  const { db } = require('../database-oracle');
  const { token, password, format, vision_model } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ ok: false, error: 'token and password required' });
  }

  // 1) peek + ownership check(密碼可能錯,還不要 consume)
  const pending = pendingStore.peek(token, { verifyUserId: req.user.id });
  if (!pending) {
    return res.status(404).json({ ok: false, error: 'token expired or invalid (or not your token)' });
  }

  // 2) inspect 驗密碼
  try {
    const ins = await runWorker(
      ['inspect', '--in', pending.pdfPath, '--password', password],
      { timeoutMs: 60_000 }
    );
    if (!ins.ok) {
      if (ins.error_code === 'PASSWORD_WRONG') {
        const stillTriable = pendingStore.recordWrongPassword(token);
        return res.status(401).json({
          ok: false,
          error_code: 'PASSWORD_WRONG',
          message: stillTriable ? '密碼錯誤,請再試一次' : '密碼錯誤次數過多,token 已失效;請重新請 AI 轉檔取得新 token',
          stillTriable,
        });
      }
      return res.status(500).json({ ok: false, error_code: ins.error_code, error: ins.error });
    }
    // 3) 密碼對 → consume token,submit job
    pendingStore.consume(token, { verifyUserId: req.user.id });
    const jobId = await pdfDocxJobService.submitJob(db, {
      userId: req.user.id,
      sessionId: pending.sessionId,
      pdfPath: pending.pdfPath,
      pdfName: pending.pdfName,
      password, // 入庫前 AES 加密(jobService 內處理)
      format: format || 'auto',
      vision_model: vision_model || 'flash',
      pages: ins.pages || null,
    });
    res.json({
      ok: true,
      jobId,
      pages: ins.pages,
      complexity_score: ins.complexity_score,
      recommended_mode: ins.recommended_mode,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
