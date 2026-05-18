/**
 * Internal Admin Routes — /api/projects/internal-admin/*
 *
 * Phase 0 scaffold:Overview + Module Health
 * 後續 sprint 加各子頁(project-types / workflow-templates / etc.)
 *
 * 對應 docs/projects-platform-internal-admin-plan.md §B
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorBoundary');
const { requireAdminMode } = require('../middleware/sidebarPermissionMiddleware');
const llmQueue = require('../services/llmQueue');
const pluginRegistry = require('../plugins/registry');

const router = express.Router();

// 所有 internal-admin 路由都需要 admin mode
router.use(requireAdminMode);

/**
 * GET /api/projects/internal-admin/health
 * Module Health — Feature flag / Workers / LLM Queue / Plugins
 */
router.get('/health', asyncHandler(async (req, res) => {
  const projectsPlatform = require('..');
  res.json({
    module: 'projects-platform',
    version: '0.4-scaffold',
    feature_flag: {
      ENABLE_PROJECTS_PLATFORM: process.env.ENABLE_PROJECTS_PLATFORM === 'true',
      ENABLE_PROJECTS_WORKERS: process.env.ENABLE_PROJECTS_WORKERS !== 'false',
      PROJECTS_PLATFORM_GA_MODE: process.env.PROJECTS_PLATFORM_GA_MODE === 'true',
      PILOT_USERS_COUNT: (process.env.PILOT_USERS || '').split(',').filter(Boolean).length,
    },
    enabled: projectsPlatform.ENABLED,
    workers_enabled: projectsPlatform.WORKERS_ENABLED,
    llm_queue: llmQueue.getStats(),
    plugins: pluginRegistry.list(),
    server_time: new Date().toISOString(),
  });
}));

/**
 * GET /api/projects/internal-admin/overview
 * 子頁清單 + 啟用狀態(scaffold 階段全部 disabled,顯示 sprint roadmap)
 */
router.get('/overview', asyncHandler(async (req, res) => {
  res.json({
    title: '專案管理平台設定',
    status_note: 'Phase 0 scaffold:大部分子頁尚未啟用,逐 sprint 上線',
    sections: [
      {
        title: '系統設定',
        items: [
          { key: 'project-types',          name: 'Project Types 管理',         enabled: false, sprint: 'Sprint 1' },
          { key: 'workflow-templates',     name: 'Workflow Templates(SYSTEM)', enabled: false, sprint: 'Sprint 6-7' },
          { key: 'confidential-policies',  name: 'Confidential Field Policies', enabled: false, sprint: 'Sprint 3' },
          { key: 'notification-rules',     name: 'Notification Rules(SYSTEM)', enabled: false, sprint: 'Sprint 7' },
          { key: 'data-connections',       name: 'Data Connections(ERP/SFC/BI)', enabled: false, sprint: 'Sprint 5' },
          { key: 'data-sources',           name: 'Data Source Definitions(SQL 庫)', enabled: false, sprint: 'Sprint 5' },
          { key: 'kb-routes',              name: 'KB Routes(per project_type)', enabled: false, sprint: 'Sprint 4' },
        ],
      },
      {
        title: '身份 / 組織',
        items: [
          { key: 'roles',     name: 'Role 授予 / 撤銷',  enabled: false, sprint: 'Sprint 11' },
          { key: 'org-units', name: '組織層級維護',       enabled: false, sprint: 'Sprint 11' },
        ],
      },
      {
        title: '系統健康',
        items: [
          { key: 'system-health', name: 'Module Health / LLM 用量 / Audit Log', enabled: true, sprint: 'Sprint 0(✅ 已啟用)' },
        ],
      },
    ],
  });
}));

/**
 * GET /api/projects/internal-admin/system-health
 * 完整版 system health(目前等同 /health,Sprint 12 才加完整資訊)
 */
router.get('/system-health', asyncHandler(async (req, res) => {
  const projectsPlatform = require('..');
  res.json({
    module: 'projects-platform',
    version: '0.4-scaffold',
    feature_flag: {
      ENABLE_PROJECTS_PLATFORM: process.env.ENABLE_PROJECTS_PLATFORM === 'true',
      ENABLE_PROJECTS_WORKERS: process.env.ENABLE_PROJECTS_WORKERS !== 'false',
      PROJECTS_PLATFORM_GA_MODE: process.env.PROJECTS_PLATFORM_GA_MODE === 'true',
      pilot_users_count: (process.env.PILOT_USERS || '').split(',').filter(Boolean).length,
    },
    runtime: {
      enabled: projectsPlatform.ENABLED,
      workers_enabled: projectsPlatform.WORKERS_ENABLED,
      uptime_seconds: process.uptime(),
    },
    llm_queue: llmQueue.getStats(),
    plugins: pluginRegistry.list().map((code) => {
      const p = pluginRegistry.get(code);
      return {
        type_code: code,
        default_channels: p?.default_channels?.length || 0,
        default_stages: p?.default_workflow_stages?.length || 0,
      };
    }),
    sprint_progress: {
      sprint_0: 'completed (scaffold)',
      sprint_1: 'pending',
      // ...其他 sprint(待更新)
    },
    server_time: new Date().toISOString(),
  });
}));

/**
 * GET /notification-log — 通知 dispatch 記憶體 log(debug 用)
 */
router.get('/notification-log', asyncHandler(async (req, res) => {
  const notify = require('../services/notificationEngine');
  res.json({
    recent: notify.recentLog(Math.min(Number(req.query.limit) || 50, 200)),
    stats: notify.stats(),
    rules: notify.RULES,
  });
}));

// ============================================================================
// Sprint H — Role grants admin API(spec §17)
// ============================================================================
const userRoles = require('../services/userRoleService');
const adminTesting = require('../services/adminTestingService');
const _db = () => require('../../database-oracle').db;

/** GET /roles — 13 role definitions */
router.get('/roles', asyncHandler(async (req, res) => {
  const roles = await userRoles.listRoleDefinitions(_db());
  res.json({ roles, total: roles.length });
}));

/**
 * GET /users/search?q= — admin 用 user LOV(不卡 project membership)
 *   不帶 q → 前 30 active user
 *   帶 q   → username / name / employee_id 模糊
 */
router.get('/users/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const db = _db();
  let rows;
  if (q.length < 1) {
    rows = await db.prepare(
      `SELECT id, username, name, employee_id, email, dept_name
         FROM users WHERE status = 'active' ORDER BY id DESC FETCH FIRST 30 ROWS ONLY`,
    ).all().catch(() => []);
  } else {
    rows = await db.prepare(
      `SELECT id, username, name, employee_id, email, dept_name
         FROM users WHERE status = 'active'
           AND (UPPER(username) LIKE UPPER(?) OR UPPER(name) LIKE UPPER(?) OR employee_id LIKE ?)
         ORDER BY username FETCH FIRST 30 ROWS ONLY`,
    ).all(`%${q}%`, `%${q}%`, `%${q}%`).catch(() => []);
  }
  res.json({
    users: rows.map((u) => ({
      user_id: Number(u.id),
      username: u.username,
      name: u.name,
      employee_id: u.employee_id,
      email: u.email,
      dept_name: u.dept_name,
    })),
  });
}));

/** GET /role-grants — list all grants(可 filter role_code)*/
router.get('/role-grants', asyncHandler(async (req, res) => {
  const grants = await userRoles.listAllGrants(_db(), {
    roleCode: req.query.role_code || null,
    includeRevoked: req.query.include_revoked === '1',
  });
  res.json({ grants, total: grants.length });
}));

/** GET /role-grants/user/:userId — list grants for a specific user */
router.get('/role-grants/user/:userId', asyncHandler(async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) return res.status(400).json({ error: 'invalid userId' });
  const grants = await userRoles.listGrants(_db(), userId, {
    includeRevoked: req.query.include_revoked === '1',
  });
  res.json({ user_id: userId, grants });
}));

/**
 * POST /role-grants — admin grant a role
 *  body: { user_id, role_code, scope_type='GLOBAL', scope_values?, expires_at?, reason? }
 */
router.post('/role-grants', asyncHandler(async (req, res) => {
  try {
    const r = await userRoles.grant(_db(), {
      adminUserId: req.user.id,
      userId: Number(req.body?.user_id),
      roleCode: req.body?.role_code,
      scopeType: req.body?.scope_type,
      scopeValues: req.body?.scope_values,
      expiresAt: req.body?.expires_at,
      reason: req.body?.reason,
    });
    res.status(201).json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

/** DELETE /role-grants/:grantId — revoke */
router.delete('/role-grants/:grantId', asyncHandler(async (req, res) => {
  try {
    const r = await userRoles.revoke(
      _db(),
      Number(req.params.grantId),
      req.user.id,
      req.body?.reason,
    );
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

// ─── Admin testing mode ────────────────────────────────────────────────────
/** POST /testing-mode/enter — admin 切入 testing mode */
router.post('/testing-mode/enter', asyncHandler(async (req, res) => {
  try {
    const r = await adminTesting.enter(_db(), {
      userId: req.user.id,
      reason: req.body?.reason,
      durationMinutes: req.body?.duration_minutes,
    });
    res.status(201).json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

/** POST /testing-mode/exit — 結束 */
router.post('/testing-mode/exit', asyncHandler(async (req, res) => {
  const r = await adminTesting.exit(_db(), { userId: req.user.id });
  res.json(r);
}));

/** GET /testing-mode/active — 看自己是否在 testing mode */
router.get('/testing-mode/active', asyncHandler(async (req, res) => {
  const r = await adminTesting.getActiveSession(_db(), req.user.id);
  res.json({ in_testing_mode: !!r, session: r });
}));

/** GET /testing-mode/sessions — 列最近 N 筆(audit)*/
router.get('/testing-mode/sessions', asyncHandler(async (req, res) => {
  const list = await adminTesting.listRecent(_db(), { limit: Number(req.query.limit) || 50 });
  res.json({ sessions: list });
}));

module.exports = router;
