/**
 * Announcement routes
 *
 * User-facing:
 *   GET  /api/announcements/active          列出當前可見公告(已過濾 dismiss / 過期 / 受眾)
 *   POST /api/announcements/:id/dismiss     使用者按掉
 *
 * Admin-only:
 *   GET    /api/announcements/admin                 列表(含 archived)
 *   GET    /api/announcements/admin/:id             單筆 + translations + audiences
 *   POST   /api/announcements/admin                 建立
 *   PUT    /api/announcements/admin/:id             更新(可選 bumpRevision reset 所有 dismiss)
 *   POST   /api/announcements/admin/:id/archive     軟下架
 *   POST   /api/announcements/admin/:id/translate   翻譯到 en / vi
 *   DELETE /api/announcements/admin/:id             永久刪除(連同翻譯/受眾/dismiss);用於清理不重要的舊公告
 */
const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('./auth');
const svc = require('../services/announcementService');

// ── User endpoints ───────────────────────────────────────────────────────────

router.get('/active', verifyToken, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const lang = String(req.query.lang || 'zh-TW');
    const rows = await svc.listActiveForUser(db, req.user, lang);
    res.json(rows);
  } catch (e) {
    console.error('[announcements] active error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * 批次標記已讀 — 前端打開鈴鐺時呼叫,清 badge 但不從清單移除
 * body: { ids: number[] }
 */
router.post('/read', verifyToken, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const n = await svc.markReadForUser(db, req.user.id, ids);
    res.json({ ok: true, marked: n });
  } catch (e) {
    console.error('[announcements] mark read error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/dismiss', verifyToken, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    const ok = await svc.dismissForUser(db, req.user.id, id);
    if (!ok) return res.status(400).json({ error: 'cannot dismiss(不存在或不可關閉)' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[announcements] dismiss error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Admin endpoints ──────────────────────────────────────────────────────────

router.get('/admin', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const result = await svc.listAdmin(db, {
      status:        req.query.status,
      level:         req.query.level,
      q:             req.query.q,
      created_from:  req.query.created_from,
      created_to:    req.query.created_to,
      audience_mode: req.query.audience_mode,
      created_by:    req.query.created_by ? Number(req.query.created_by) : null,
      limit:         req.query.limit  ? Number(req.query.limit)  : undefined,
      offset:        req.query.offset ? Number(req.query.offset) : undefined,
      lang:          String(req.query.lang || 'zh-TW'),
    });
    res.json(result);  // { rows, total, limit, offset }
  } catch (e) {
    console.error('[announcements][admin] list error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const id = Number(req.params.id);
    const row = await svc.getById(db, id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (e) {
    console.error('[announcements][admin] get error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const id = await svc.create(db, req.user.id, req.body || {});
    res.json({ ok: true, id });
  } catch (e) {
    console.error('[announcements][admin] create error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.put('/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const id = Number(req.params.id);
    await svc.update(db, id, req.body || {});
    res.json({ ok: true });
  } catch (e) {
    console.error('[announcements][admin] update error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/:id/archive', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const id = Number(req.params.id);
    await svc.archive(db, id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[announcements][admin] archive error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/:id/publish', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const id = Number(req.params.id);
    await svc.publish(db, id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[announcements][admin] publish error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/:id/unpublish', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const id = Number(req.params.id);
    await svc.unpublish(db, id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[announcements][admin] unpublish error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.put('/admin/:id/translations/:lang', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const id = Number(req.params.id);
    const lang = String(req.params.lang);
    const { title, body } = req.body || {};
    await svc.upsertTranslation(db, id, lang, title, body);
    res.json({ ok: true });
  } catch (e) {
    console.error('[announcements][admin] upsert translation error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/:id/translate', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const id = Number(req.params.id);
    const { lang, modelKey } = req.body || {};
    if (!lang) return res.status(400).json({ error: 'lang is required' });
    const result = await svc.translateOne(db, id, String(lang), modelKey || 'flash');
    if (!result.ok) return res.status(500).json({ error: result.error || 'translate failed' });
    res.json(result);
  } catch (e) {
    console.error('[announcements][admin] translate error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const id = Number(req.params.id);
    await svc.remove(db, id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[announcements][admin] delete error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
