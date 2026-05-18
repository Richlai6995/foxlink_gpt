/**
 * /api/projects/ai — Sprint M AI 13 項深化 routes
 *
 * Endpoints:
 *   POST /pricing-suggest                       — #16 智慧定價建議
 *     body: { project_id, field, context? }
 *   POST /cleansheet-analyze                    — #12 Cleansheet 三廠成本分析
 *     body: { project_id, factories: [], target: { quantity, due_date } }
 *   POST /daily-report/run                      — #33 主管日報手動觸發
 *     body: { period?: 'daily' | 'weekly', dry_run?: bool }
 *   POST /daily-report/run-all                  — admin 批次跑(scheduled job 用)
 *     body: { period?: 'daily' | 'weekly' }
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorBoundary');
const pricing = require('../services/aiPricingService');
const cleansheet = require('../services/aiCleansheetService');
const dailyReport = require('../services/dailyReportService');

const router = express.Router();
function getDb() { return require('../../database-oracle').db; }

/**
 * POST /pricing-suggest
 *   body: { project_id, field, context? }
 */
router.post('/pricing-suggest', asyncHandler(async (req, res) => {
  const projectId = Number(req.body?.project_id);
  const field = String(req.body?.field || '').trim();
  if (!projectId || !field) {
    return res.status(400).json({ error: 'project_id / field required' });
  }
  try {
    const r = await pricing.suggest(getDb(), {
      projectId,
      field,
      context: req.body?.context || {},
      user: req.user,
    });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

/**
 * POST /cleansheet-analyze
 *   body: { project_id, factories: [{ code, name, cost_breakdown }], target: { quantity, due_date, customer? } }
 */
router.post('/cleansheet-analyze', asyncHandler(async (req, res) => {
  const projectId = Number(req.body?.project_id);
  if (!projectId) return res.status(400).json({ error: 'project_id required' });
  try {
    const r = await cleansheet.analyze(getDb(), {
      projectId,
      factories: req.body?.factories || [],
      target: req.body?.target || {},
      user: req.user,
    });
    res.json(r);
  } catch (e) {
    if (/required|invalid/.test(e.message)) return res.status(400).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
}));

/**
 * POST /daily-report/run — 跑自己的日報(任何登入 user 都可)
 *   body: { period?: 'daily' | 'weekly', dry_run?: bool }
 */
router.post('/daily-report/run', asyncHandler(async (req, res) => {
  try {
    const r = await dailyReport.runForUser(getDb(), {
      userId: req.user.id,
      period: req.body?.period === 'weekly' ? 'weekly' : 'daily',
      dryRun: !!req.body?.dry_run,
    });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

/**
 * POST /daily-report/run-all — admin 批次跑(scheduled job 用)
 */
router.post('/daily-report/run-all', asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  try {
    const r = await dailyReport.runForAll(getDb(), {
      period: req.body?.period === 'weekly' ? 'weekly' : 'daily',
    });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

module.exports = router;
