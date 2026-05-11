/**
 * /api/projects/projects/* — Projects CRUD
 *
 * Sprint 1 範圍(最小版,無 Wizard):
 *   GET    /projects              列表(user 可見的)
 *   GET    /projects/types        type 清單(plugin metadata + DB 設定)
 *   POST   /projects              建立(最小欄位)
 *   GET    /projects/:projectId   詳細(含 channels / stages / members)
 *   POST   /projects/:projectId/lifecycle  狀態轉移
 *
 * 後續 sprint 補:
 *   - Wizard (POST /wizard) — Sprint 9
 *   - Field-level confidential — Sprint 3
 *   - Member CRUD — Sprint 6
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorBoundary');
const { loadProject, requirePmOrAdmin } = require('../middleware/projectAclMiddleware');
const projectsService = require('../services/projectsService');
const pluginRegistry = require('../plugins/registry');
const channelsRoutes = require('./channels');

const router = express.Router();

// Sprint 2 — channel/message routes(scoped under project)
//   GET /:projectId/channels, POST /:projectId/channels, /dm, /:cid/archive,
//   /:cid/participants, /:cid/read, /:cid/messages, /:cid/messages/pinned
router.use('/:projectId/channels', channelsRoutes.projectScoped);

function getDb() {
  return require('../../database-oracle').db;
}

// ─── GET /projects/types ────────────────────────────────────────────
// 列出已 enabled 的 project_types(給 client 開案下拉用)
router.get('/types', asyncHandler(async (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'db not ready' });

  const rows = await db.prepare(
    `SELECT id, type_code, name_i18n, description_i18n, icon, sort_order,
            default_workflow_template_id, default_classification_label,
            default_is_confidential
       FROM project_types
      WHERE is_enabled = 1
      ORDER BY sort_order, type_code`,
  ).all();

  const types = rows.map((r) => ({
    id: Number(r.id),
    type_code: r.type_code,
    name_i18n: safeJson(r.name_i18n, {}),
    description_i18n: safeJson(r.description_i18n, {}),
    icon: r.icon,
    sort_order: Number(r.sort_order || 100),
    default_workflow_template_id: r.default_workflow_template_id ? Number(r.default_workflow_template_id) : null,
    default_is_confidential: Number(r.default_is_confidential) === 1,
    plugin_loaded: !!pluginRegistry.get(r.type_code),
  }));

  res.json({ types });
}));

// ─── GET /projects ──────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'db not ready' });

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const status = req.query.status || null;
  const type_code = req.query.type_code || null;

  const projects = await projectsService.list(db, req.user, { limit, offset, status, type_code });
  res.json({ projects, count: projects.length, limit, offset });
}));

// ─── POST /projects ─────────────────────────────────────────────────
// 最小版建立(無 Wizard,Wizard 在 Sprint 9 才上)
//
// Body:
//   {
//     project_code, type_code, title, bu_id,
//     [pm_user_id], [sales_user_id], [importance], [urgency], [data_payload]
//   }
router.post('/', asyncHandler(async (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'db not ready' });

  const {
    project_code,
    type_code,
    title,
    bu_id,
    pm_user_id,
    sales_user_id,
    importance,
    urgency,
    data_payload,
  } = req.body || {};

  try {
    const projectId = await projectsService.create(db, {
      project_code,
      type_code,
      title,
      bu_id,
      pm_user_id,
      sales_user_id,
      importance,
      urgency,
      data_payload,
      creator_id: req.user.id,
    });

    const detail = await projectsService.get(db, projectId, req.user);
    res.status(201).json({ project: detail });
  } catch (e) {
    if (/UNIQUE constraint failed/.test(e.message)) {
      return res.status(409).json({ error: 'project_code already exists', message: e.message });
    }
    if (/^[a-z_]+ required$/.test(e.message) || /unknown project type|not seeded/i.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
}));

// ─── GET /projects/:projectId ───────────────────────────────────────
router.get('/:projectId',
  loadProject(),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const detail = await projectsService.get(db, Number(req.params.projectId), req.user);
    if (!detail) return res.status(404).json({ error: 'not found' });
    res.json({ project: detail });
  }),
);

// ─── POST /projects/:projectId/lifecycle ────────────────────────────
// Body: { to_status: 'ACTIVE'|'PAUSED'|'CLOSED'|'REOPENED', reason?, pause_until? }
router.post('/:projectId/lifecycle',
  loadProject(),
  requirePmOrAdmin,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const { to_status, reason, pause_until } = req.body || {};
    if (!to_status) return res.status(400).json({ error: 'to_status required' });

    try {
      const r = await projectsService.updateLifecycle(
        db, Number(req.params.projectId), to_status, req.user,
        { reason, pause_until },
      );
      res.json({ ok: true, ...r });
    } catch (e) {
      if (/invalid lifecycle transition/.test(e.message)) {
        return res.status(400).json({ error: e.message });
      }
      throw e;
    }
  }),
);

// ─── helpers ────────────────────────────────────────────────────────
function safeJson(v, fallback) {
  if (!v) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

module.exports = router;
