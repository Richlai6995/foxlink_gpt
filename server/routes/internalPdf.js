'use strict';
/**
 * internalPdf.js — 內部 endpoint,只給同機 skill child process 用。
 *
 * 為什麼要存在:skill child(sandbox node process)無法 require server services/,
 * 但 vision rebuild 需要 reuse 既有 geminiClient(GCP credentials / SDK 初始化)。
 * 走 HTTP 是最簡單的 IPC,且 GCP connection pool 仍集中在 main app。
 *
 * 安全:
 *   1. 只接受 source IP = 127.0.0.1 / ::1 / ::ffff:127.0.0.1
 *   2. 必須帶 X-Internal-Secret header,值對應 process.env.INTERNAL_API_SECRET
 *      (server.js 啟動時若未設會自動生成 UUID 並寫到 env)
 *   3. K8s pod 之間不會打到對方 — 因為 host 是 127.0.0.1
 *
 * Endpoints:
 *   POST /pdf-vision-rebuild
 *     body: { pdfPath, outDocxPath, password?, model?('flash'|'pro'), dpi?, concurrency? }
 *     resp: { ok, outDocxPath, totalPages, totalTokens, visionFailedPages, elapsedMs }
 */

const express = require('express');
const router = express.Router();

const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function requireInternalAuth(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || '';
  if (!LOCALHOST_IPS.has(ip)) {
    console.warn(`[internalPdf] reject non-local request from ${ip}`);
    return res.status(403).json({ error: 'forbidden: localhost only' });
  }
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    console.warn(`[internalPdf] reject bad secret from ${ip}`);
    return res.status(401).json({ error: 'invalid internal secret' });
  }
  next();
}

router.post('/pdf-vision-rebuild', requireInternalAuth, async (req, res) => {
  const { rebuildPdfWithVision } = require('../services/pdfVisionRebuild');
  const { pdfPath, outDocxPath, password, model, dpi, concurrency } = req.body || {};
  if (!pdfPath || !outDocxPath) {
    return res.status(400).json({ error: 'pdfPath and outDocxPath required' });
  }
  const t0 = Date.now();
  try {
    const result = await rebuildPdfWithVision({
      pdfPath,
      outDocxPath,
      password,
      model: model === 'pro' ? 'pro' : 'flash',
      dpi: Number(dpi) || 200,
      concurrency: Math.max(1, Math.min(6, Number(concurrency) || 3)),
      onProgress: (p) => {
        // 進度只 log,不 stream(skill 同步等)
        console.log(`[internalPdf] vision-rebuild progress: stage=${p.stage}${p.pageNo ? ` page=${p.pageNo}/${p.totalPages}` : ''} elapsed=${p.elapsedMs}ms`);
      },
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error(`[internalPdf] vision-rebuild failed after ${Date.now() - t0}ms:`, e.message);
    res.status(500).json({ ok: false, error: e.message, elapsedMs: Date.now() - t0 });
  }
});

module.exports = router;
