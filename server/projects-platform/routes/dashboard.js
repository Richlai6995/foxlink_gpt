/**
 * /api/projects/dashboard — 跨專案儀表板 + Status SUMMARY
 *
 * Sprint D:
 *   GET /                            7 widget data
 *   GET /summary/:projectId          單一 project status summary
 *   POST /summary/:projectId/refresh 強制刷 SUMMARY(@bot summary)
 *   POST /summary/:projectId/pin     Pin SUMMARY 到 announcement(PM/admin)
 *   POST /summary/batch              批次 summary(給 projects list 列表行下用)
 *     Body: { project_ids: number[] }
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorBoundary');
const dashboardService = require('../services/dashboardService');
const statusSummary = require('../ai/statusSummary');

const router = express.Router();

function getDb() {
  return require('../../database-oracle').db;
}

// ─── GET /dashboard ──────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const data = await dashboardService.getDashboard(getDb(), req.user);
  res.json(data);
}));

// ─── GET /dashboard/summary/:projectId ───────────────────────────────
router.get('/summary/:projectId', asyncHandler(async (req, res) => {
  const summary = await statusSummary.getSummary(getDb(), Number(req.params.projectId));
  if (!summary) return res.status(404).json({ error: 'project not found' });
  res.json({ summary });
}));

// ─── POST /dashboard/summary/:projectId/refresh ──────────────────────
router.post('/summary/:projectId/refresh', asyncHandler(async (req, res) => {
  const summary = await statusSummary.refresh(getDb(), Number(req.params.projectId));
  if (!summary) return res.status(404).json({ error: 'project not found' });
  res.json({ summary });
}));

// ─── POST /dashboard/summary/:projectId/pin ──────────────────────────
router.post('/summary/:projectId/pin', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  const db = getDb();

  // 驗:必須是 PM / admin
  const row = await db.prepare(
    `SELECT pm_user_id, created_by_user_id FROM projects WHERE id = ?`,
  ).get(projectId);
  if (!row) return res.status(404).json({ error: 'project not found' });

  const isAdmin = req.user.role === 'admin';
  const isPm = Number(row.pm_user_id) === Number(req.user.id);
  if (!isAdmin && !isPm) {
    return res.status(403).json({ error: 'PM or admin only' });
  }

  try {
    const r = await statusSummary.pinToAnnouncement(db, projectId, req.user.id);
    res.json(r);
  } catch (e) {
    if (/announcement channel missing/.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
}));

// ─── POST /dashboard/summary/batch ───────────────────────────────────
router.post('/summary/batch', asyncHandler(async (req, res) => {
  const ids = (req.body?.project_ids || []).map(Number).filter(Boolean);
  if (ids.length === 0) return res.json({ summaries: [] });
  if (ids.length > 50) {
    return res.status(400).json({ error: 'project_ids exceeds 50 per request' });
  }
  const summaries = await statusSummary.getSummariesForProjects(getDb(), ids);
  res.json({ summaries });
}));

module.exports = router;
