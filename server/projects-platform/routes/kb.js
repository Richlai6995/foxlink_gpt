/**
 * /api/projects/kb — Live KB + 沉澱 KB(Sprint J production)
 *
 * GET  /search?q=&layer=live|archived&project_id=&mode=auto|vector|fulltext|like
 * GET  /chunks/:projectId?layer=live|archived
 * GET  /audit/:projectId               — sediment fork / embed audit log
 * POST /fork/:projectId                — manual re-fork(PM/admin · body { force: bool })
 * POST /embed/:projectId               — manual embedding batch(admin · body { sediment_only, force })
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorBoundary');
const kb = require('../services/kbPipeline');
const kbEmbed = require('../services/kbEmbeddingService');

const router = express.Router();

function getDb() { return require('../../database-oracle').db; }

router.get('/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ results: [] });
  const isSediment = req.query.layer === 'archived';
  const projectId = req.query.project_id ? Number(req.query.project_id) : undefined;
  const mode = String(req.query.mode || 'auto').toLowerCase();
  const topK = Math.min(Number(req.query.top_k) || 30, 100);

  const r = await kb.search(getDb(), q, { isSediment, projectId, topK, mode });
  res.json({
    results: r,
    query: q,
    layer: isSediment ? 'archived' : 'live',
    mode,
    count: r.length,
  });
}));

router.get('/chunks/:projectId', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  const isSediment = req.query.layer === 'archived';
  const rows = await getDb().prepare(
    `SELECT id, project_id, kind, content, title, tags, is_sediment, scrubbed, scrub_note,
            sediment_from_chunk_id, embedding_model, embedded_at, created_at,
            (CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS has_embedding,
            (CASE WHEN title_embedding IS NOT NULL THEN 1 ELSE 0 END) AS has_title_embedding
       FROM project_kb_chunks
      WHERE project_id = ? AND is_sediment = ?
      ORDER BY created_at DESC
      FETCH FIRST 100 ROWS ONLY`,
  ).all(projectId, isSediment ? 1 : 0).catch(() => []);
  res.json({ chunks: rows, project_id: projectId, layer: isSediment ? 'archived' : 'live' });
}));

/** GET /audit/:projectId — sediment fork / embed audit log */
router.get('/audit/:projectId', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  const list = await kb.listAuditForProject(getDb(), projectId, { limit: Number(req.query.limit) || 20 });
  res.json({ audit: list, project_id: projectId });
}));

/**
 * POST /fork/:projectId — manual re-fork(PM 或 admin)
 *   body: { force: bool, notes? }
 *   - force=true → 可重 fork(會刪舊沉澱 chunk)
 *   - 等同 lifecycle CLOSED 觸發的 fork,但可獨立呼叫(若 fork 失敗 / 想重整 scrub)
 */
router.post('/fork/:projectId', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  const db = getDb();
  // PM / sales / admin check
  const row = await db.prepare(
    `SELECT pm_user_id, sales_user_id, created_by_user_id FROM projects WHERE id = ?`,
  ).get(projectId).catch(() => null);
  if (!row) return res.status(404).json({ error: 'project not found' });
  const isAdmin = req.user?.role === 'admin';
  const isPm = Number(row.pm_user_id) === Number(req.user?.id);
  if (!isAdmin && !isPm) return res.status(403).json({ error: 'only PM or admin can manual fork' });

  try {
    const r = await kb.forkToSediment(db, projectId, {
      force: !!req.body?.force,
      actorUserId: req.user.id,
      notes: req.body?.notes || 'manual',
    });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

/**
 * POST /embed/:projectId — manual 重算 embedding
 *   body: { sediment_only?: bool, force?: bool, limit?: number }
 */
router.post('/embed/:projectId', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'admin only' });
  }
  try {
    const r = await kbEmbed.embedProjectChunks(getDb(), {
      projectId,
      sedimentOnly: !!req.body?.sediment_only,
      force: !!req.body?.force,
      limit: Number(req.body?.limit) || 200,
    });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

module.exports = router;
