/**
 * /api/projects/projects/:projectId/stages — Stage Gate 推進
 *
 * GET  /                    list stages(同 project.get 的 stages,獨立 endpoint 給 lazy fetch 用)
 * POST /:stageId/advance    推進(業務確認 gate),Body: { notes? }
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorBoundary');
const { loadProject } = require('../middleware/projectAclMiddleware');
const stagesService = require('../services/stagesService');

const router = express.Router({ mergeParams: true });
router.use(loadProject());

function getDb() { return require('../../database-oracle').db; }

router.get('/', asyncHandler(async (req, res) => {
  const stages = await stagesService.list(getDb(), req.project.id);
  res.json({ stages });
}));

router.post('/:stageId/advance', asyncHandler(async (req, res) => {
  try {
    const r = await stagesService.advance(
      getDb(),
      Number(req.params.stageId),
      req.user,
      { notes: req.body?.notes },
    );
    res.json({ ok: true, ...r });
  } catch (e) {
    if (/not found|already|not active|only PM/.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
}));

module.exports = router;
