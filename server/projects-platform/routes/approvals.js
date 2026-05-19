/**
 * /api/projects/approvals — Sprint P · 多級簽核 API
 *
 * Endpoints:
 *   GET    /pending                          列我待 approve 的 chain steps
 *   POST   /chains                           建 chain { project_id, chain_kind, title, reason?, target_payload?, target_stage_id?, expires_in_hours? }
 *   POST   /chains/:chainId/decide           decide { step_order, decision, comment? }
 *   POST   /chains/:chainId/cancel           cancel { reason? }
 *   GET    /by-project/:projectId            列某 project 的 chain history
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorBoundary');
const approval = require('../services/approvalService');

const router = express.Router();
function getDb() { return require('../../database-oracle').db; }

router.get('/pending', asyncHandler(async (req, res) => {
  const list = await approval.listPendingForUser(getDb(), req.user.id);
  res.json({ pending: list, count: list.length });
}));

router.post('/chains', asyncHandler(async (req, res) => {
  try {
    const r = await approval.createChain(getDb(), {
      projectId:        Number(req.body?.project_id),
      chainKind:        req.body?.chain_kind,
      title:            req.body?.title,
      reason:           req.body?.reason,
      requestedByUserId: req.user.id,
      targetPayload:    req.body?.target_payload,
      targetStageId:    req.body?.target_stage_id || null,
      expiresInHours:   Number(req.body?.expires_in_hours) || 72,
    });
    res.status(201).json(r);
  } catch (e) {
    if (/required|no approver|not found/.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
}));

router.post('/chains/:chainId/decide', asyncHandler(async (req, res) => {
  try {
    const r = await approval.decide(getDb(), {
      chainId: Number(req.params.chainId),
      stepOrder: Number(req.body?.step_order),
      decision: req.body?.decision,
      decidedByUserId: req.user.id,
      comment: req.body?.comment,
    });
    res.json(r);
  } catch (e) {
    if (/not authorized|required|invalid|already|not found/.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
}));

router.post('/chains/:chainId/cancel', asyncHandler(async (req, res) => {
  try {
    const r = await approval.cancel(getDb(), {
      chainId: Number(req.params.chainId),
      byUserId: req.user.id,
      reason: req.body?.reason,
    });
    res.json(r);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}));

router.get('/by-project/:projectId', asyncHandler(async (req, res) => {
  const list = await approval.listForProject(getDb(), Number(req.params.projectId));
  res.json({ chains: list, count: list.length });
}));

module.exports = router;
