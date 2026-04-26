'use strict';
/**
 * chatArtifacts.js — Tool 產出的 MD/HTML artifact 讀取 / 下載 路由
 *
 * 詳見 docs/tool-artifact-passthrough.md §6.5
 *
 * 路由:
 *   GET  /api/chat/artifacts/:id                 — 取單筆 artifact 全文
 *   GET  /api/chat/sessions/:sid/artifacts       — session 復載時撈所有 artifacts
 *   GET  /api/chat/artifacts/:id/download        — 強制 attachment 下載
 *
 * 權限:只能撈自己 session 的 artifact(WHERE user_id = req.user.id)。
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');

const dbMod = require('../database-oracle');

// 共用:依 session 拿 user 自己 artifacts(用於 session 復載)
router.get('/sessions/:sid/artifacts', verifyToken, async (req, res) => {
  try {
    const db = dbMod.db;
    const rows = await db.prepare(
      `SELECT id, message_id, session_id, source_type, source_id, tool_name,
              mime_type, title, content, content_size, created_at
       FROM chat_artifacts
       WHERE session_id = ? AND user_id = ?
       ORDER BY id ASC`
    ).all(req.params.sid, req.user.id);
    res.json({ artifacts: rows || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 取單筆全文
router.get('/artifacts/:id', verifyToken, async (req, res) => {
  try {
    const db = dbMod.db;
    const row = await db.prepare(
      `SELECT id, message_id, session_id, source_type, source_id, tool_name, tool_args,
              mime_type, title, content, content_size, created_at
       FROM chat_artifacts
       WHERE id = ? AND user_id = ?`
    ).get(Number(req.params.id), req.user.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 強制下載
router.get('/artifacts/:id/download', verifyToken, async (req, res) => {
  try {
    const db = dbMod.db;
    const row = await db.prepare(
      `SELECT mime_type, title, content
       FROM chat_artifacts
       WHERE id = ? AND user_id = ?`
    ).get(Number(req.params.id), req.user.id);
    if (!row) return res.status(404).json({ error: 'not found' });

    const ext = row.mime_type === 'text/html' ? 'html'
              : row.mime_type === 'text/markdown' ? 'md'
              : 'txt';
    const safeTitle = String(row.title || 'artifact').replace(/[^\w一-龥\-_. ()]/g, '_').slice(0, 80);
    res.setHeader('Content-Type', `${row.mime_type}; charset=utf-8`);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeTitle)}.${ext}"`);
    res.send(row.content || '');
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
