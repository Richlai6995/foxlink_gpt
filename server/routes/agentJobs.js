// -*- coding: utf-8 -*-
/**
 * agentJobs.js — type='agent' skill 背景 job 的 enqueue + 狀態輪詢。
 * 進度用輪詢(對齊 research/excel job,不走 SSE)。chat dispatch(S4)會直接呼叫
 * agentJobService.createJob,不一定經這支路由;POST / 主要給測試與直接觸發用。
 */
const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');
const agentJobService = require('../services/agentJobService');

router.use(verifyToken);

// ── POST /api/agent-jobs — 觸發一個 agent job ─────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { skill_id, task, session_id } = req.body;
    if (!skill_id) return res.status(400).json({ error: 'skill_id 必填' });
    const skill = await db.prepare('SELECT id, type, owner_user_id, is_public FROM skills WHERE id=?').get(skill_id);
    if (!skill || skill.type !== 'agent') return res.status(404).json({ error: '找不到 agent skill' });
    // 存取檢查:owner / admin / public(完整資料政策在 S4 chat 路徑會走 canUserAccessSkill)
    const isOwner = skill.owner_user_id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin && skill.is_public !== 1) {
      return res.status(403).json({ error: '無此 skill 的存取權限' });
    }
    const jobId = await agentJobService.createJob(db, {
      userId: req.user.id, sessionId: session_id || null, skillId: skill_id, task: task || '',
    });
    res.json({ jobId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/agent-jobs/:id — 輪詢狀態 ────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const job = await agentJobService.getJob(db, req.params.id);
    if (!job) return res.status(404).json({ error: '找不到 job' });
    if (job.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '無權限' });
    }
    let files = [];
    try { files = job.result_files_json ? JSON.parse(job.result_files_json) : []; } catch (_) {}
    let tokens = {};
    try { tokens = job.tokens_json ? JSON.parse(job.tokens_json) : {}; } catch (_) {}
    res.json({
      id: job.id,
      status: job.status,
      progress_label: job.progress_label,
      vision_score: job.vision_score,
      tokens,
      error: job.error_msg,
      files: files.map(f => ({ type: f.type, filename: f.filename, publicUrl: f.publicUrl })),
      created_at: job.created_at,
      completed_at: job.completed_at,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
