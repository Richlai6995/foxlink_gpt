/**
 * /api/projects/kb — Live KB + 沉澱 KB(Phase 1 minimal)
 *
 * GET /search?q=&layer=live|archived&project_id=
 * GET /chunks/:projectId?layer=live|archived
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorBoundary');
const kb = require('../services/kbPipeline');

const router = express.Router();

function getDb() { return require('../../database-oracle').db; }

router.get('/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ results: [] });
  const isSediment = req.query.layer === 'archived';
  const projectId = req.query.project_id ? Number(req.query.project_id) : undefined;
  const r = await kb.search(getDb(), q, { isSediment, projectId, limit: 30 });
  res.json({ results: r, query: q, layer: isSediment ? 'archived' : 'live' });
}));

router.get('/chunks/:projectId', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  const isSediment = req.query.layer === 'archived';
  const rows = await getDb().prepare(
    `SELECT id, project_id, kind, content, tags, is_sediment, scrubbed, scrub_note,
            sediment_from_chunk_id, created_at
       FROM project_kb_chunks
      WHERE project_id = ? AND is_sediment = ?
      ORDER BY created_at DESC
      FETCH FIRST 100 ROWS ONLY`,
  ).all(projectId, isSediment ? 1 : 0).catch(() => []);
  res.json({ chunks: rows, project_id: projectId, layer: isSediment ? 'archived' : 'live' });
}));

module.exports = router;
