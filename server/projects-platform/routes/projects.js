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
const { getDemoRole, maskProject, maskProjects } = require('../middleware/confidentialityMiddleware');
const projectsService = require('../services/projectsService');
const pluginRegistry = require('../plugins/registry');
const channelsRoutes = require('./channels');

const router = express.Router();

// Sprint 2 — channel/message routes(scoped under project)
router.use('/:projectId/channels', channelsRoutes.projectScoped);

// Sprint C — tasks routes(scoped under project)
router.use('/:projectId/tasks', require('./tasks'));

// Sprint E.2 後續 — members invite / search / remove
router.use('/:projectId/members', require('./members'));

// Sprint G — Stage Gate 推進
router.use('/:projectId/stages', require('./stages'));

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
  // 套機密 mask(依 X-Demo-Role / req.user.role)
  const role = getDemoRole(req);
  const masked = maskProjects(projects, role);
  res.json({ projects: masked, count: masked.length, limit, offset, _viewer_role: role });
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
    const role = getDemoRole(req);
    // CHAT_GUEST 機密案 → 403(對齊 demo §10)
    if (role === 'CHAT_GUEST' && Number(detail.is_confidential) === 1) {
      return res.status(403).json({ error: 'chat_guest cannot view confidential project form', _viewer_role: role });
    }
    if (role === 'OUTSIDER' && Number(detail.is_confidential) === 1) {
      return res.status(403).json({ error: 'outsider cannot view confidential project', _viewer_role: role });
    }
    res.json({ project: maskProject(detail, role) });
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

// ─── POST /:projectId/super-join ───────────────────────────────────
// Sprint H — bu_super / hq_super 主動加入專案(spec §13.3)
router.post('/:projectId/super-join',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const projectSuperUserService = require('../services/projectSuperUserService');
    try {
      const r = await projectSuperUserService.selfJoin(db, {
        userId: req.user.id,
        projectId: Number(req.params.projectId),
        reason: req.body?.reason,
      });
      res.status(201).json(r);
    } catch (e) {
      if (/not authorized|not found/.test(e.message)) {
        return res.status(403).json({ error: e.message });
      }
      throw e;
    }
  }),
);

// ─── POST /:projectId/super-leave ──────────────────────────────────
router.post('/:projectId/super-leave',
  asyncHandler(async (req, res) => {
    const projectSuperUserService = require('../services/projectSuperUserService');
    const r = await projectSuperUserService.selfLeave(getDb(), {
      userId: req.user.id,
      projectId: Number(req.params.projectId),
    });
    res.json(r);
  }),
);

// ─── GET /:projectId/super-users ───────────────────────────────────
// 列某專案的所有 active super_users
router.get('/:projectId/super-users',
  loadProject(),
  asyncHandler(async (req, res) => {
    const projectSuperUserService = require('../services/projectSuperUserService');
    const list = await projectSuperUserService.listForProject(getDb(), Number(req.params.projectId));
    res.json({ super_users: list });
  }),
);

// ─── GET /me/super-projects ────────────────────────────────────────
// 列當前 user 自己 self-joined 的專案
router.get('/me/super-projects',
  asyncHandler(async (req, res) => {
    const projectSuperUserService = require('../services/projectSuperUserService');
    const list = await projectSuperUserService.listForUser(getDb(), req.user.id);
    res.json({ projects: list });
  }),
);

// ─── helpers ────────────────────────────────────────────────────────
function safeJson(v, fallback) {
  if (!v) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

module.exports = router;
