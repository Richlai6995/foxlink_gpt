'use strict';
/**
 * 通用個人通知 API(/api/notifications)
 *
 * 設計文件:docs/long-audio-background-job-plan.md(P4a)
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');
const userNotificationService = require('../services/userNotificationService');

const _db = () => require('../database-oracle').db;

// GET /api/notifications — 列 user 自己的通知(預設未 dismissed,最新 50 筆)
//   ?unread_only=1 → 只撈未讀
router.get('/', verifyToken, async (req, res) => {
  try {
    const list = await userNotificationService.listForUser(_db(), req.user.id, {
      unreadOnly: req.query.unread_only === '1',
      limit: parseInt(req.query.limit || '50'),
    });
    res.json(list);
  } catch (e) {
    console.error('[Notifications] list error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/notifications/unread-count — 未讀數(鈴鐺紅點用)
router.get('/unread-count', verifyToken, async (req, res) => {
  try {
    const count = await userNotificationService.unreadCount(_db(), req.user.id);
    res.json({ count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/notifications/mark-read — 批次標已讀(body: {ids: [1,2,3]} 或不帶 ids 全標)
router.post('/mark-read', verifyToken, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
    await userNotificationService.markRead(_db(), req.user.id, ids);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/notifications/:id/dismiss — user 按掉(從 list 移除)
router.post('/:id/dismiss', verifyToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    await userNotificationService.dismiss(_db(), req.user.id, id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
