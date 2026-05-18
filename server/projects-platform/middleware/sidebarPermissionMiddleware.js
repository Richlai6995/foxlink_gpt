/**
 * Sidebar Permission Middleware — 判定 user 對 projects-platform 的可見性
 *
 * 對應 docs/projects-platform-internal-admin-plan.md §A.3
 *
 * 4 階段演進:
 *   Phase 0(現在)— 只給 admin 看
 *   Phase 1 開發中 — 同上
 *   Phase 1 Pilot — admin + PILOT_USERS env
 *   Phase 1 GA   — 所有有 project.* role 的人
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('sidebar-permission');

const GA_MODE = process.env.PROJECTS_PLATFORM_GA_MODE === 'true';
const PILOT_USERS = (process.env.PILOT_USERS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * 判定 user 對 projects-platform 的可見性
 *
 * Sprint H 後新增:GA mode 真正檢查 user_role_grants(任一 project.* role 都算)
 *                  + project_members(被邀進任一 project 也算)
 *                  + project_super_users(self-joined 也算)
 *
 * @param {object} user req.user 物件
 * @returns {Promise<{can_see: boolean, mode: 'admin'|'pilot'|'user'|'hidden', reason: string}>}
 */
async function determineVisibility(user) {
  if (!user) {
    return { can_see: false, mode: 'hidden', reason: 'no-user' };
  }
  const isAdmin = user.role === 'admin';

  // Phase 0 / 1 開發中 / Pilot
  if (!GA_MODE) {
    if (isAdmin) {
      return { can_see: true, mode: 'admin', reason: 'admin' };
    }
    if (PILOT_USERS.includes(String(user.id))) {
      return { can_see: true, mode: 'pilot', reason: 'pilot-user' };
    }
    return { can_see: false, mode: 'hidden', reason: 'not-admin-not-pilot' };
  }

  // Phase 1 GA — role-based(Sprint H 真接 user_role_grants + 既有 project membership)
  if (isAdmin) {
    return { can_see: true, mode: 'admin', reason: 'admin' };
  }
  try {
    const db = require('../../database-oracle').db;

    // 任一 active project.* role grant 都算 user mode
    const gRow = await db.prepare(`
      SELECT 1 FROM user_role_grants g
        JOIN user_role_definitions d ON d.id = g.role_id
       WHERE g.user_id = ? AND g.is_active = 1
         AND (g.expires_at IS NULL OR g.expires_at > SYSTIMESTAMP)
         AND d.role_code LIKE 'project.%'
         FETCH FIRST 1 ROWS ONLY
    `).get(user.id).catch(() => null);
    if (gRow) {
      return { can_see: true, mode: 'user', reason: 'has-project-role-grant' };
    }

    // 被邀進任一 project(active)
    const mRow = await db.prepare(`
      SELECT 1 FROM project_members WHERE user_id = ?
       FETCH FIRST 1 ROWS ONLY
    `).get(user.id).catch(() => null);
    if (mRow) {
      return { can_see: true, mode: 'user', reason: 'project-member' };
    }

    // self-joined super_user
    const sRow = await db.prepare(`
      SELECT 1 FROM project_super_users WHERE user_id = ? AND left_at IS NULL
       FETCH FIRST 1 ROWS ONLY
    `).get(user.id).catch(() => null);
    if (sRow) {
      return { can_see: true, mode: 'user', reason: 'super-user-joined' };
    }

    // 是 PM / Sales of any project(legacy 在 projects 表)
    const pmRow = await db.prepare(`
      SELECT 1 FROM projects WHERE pm_user_id = ? OR sales_user_id = ?
       FETCH FIRST 1 ROWS ONLY
    `).get(user.id, user.id).catch(() => null);
    if (pmRow) {
      return { can_see: true, mode: 'user', reason: 'pm-or-sales' };
    }
  } catch (e) {
    log.warn(`visibility db check failed: ${e.message}`);
  }
  return { can_see: false, mode: 'hidden', reason: 'no-role-no-membership' };
}

/**
 * Express middleware:把 visibility info 塞到 req,讓 downstream 用
 * Sprint H 後 determineVisibility 是 async(讀 user_role_grants),所以 inject 也要 async
 */
async function injectVisibility(req, res, next) {
  try {
    req.projectsVisibility = await determineVisibility(req.user);
    next();
  } catch (e) {
    log.warn(`injectVisibility failed: ${e.message}`);
    req.projectsVisibility = { can_see: false, mode: 'hidden', reason: 'inject-failed' };
    next();
  }
}

/**
 * Express middleware:要求 visible(不 visible 直接 403)
 */
async function requireVisible(req, res, next) {
  const v = req.projectsVisibility || await determineVisibility(req.user);
  if (!v.can_see) {
    log.warn(`block ${req.method} ${req.path} — ${v.reason}`);
    return res.status(403).json({ error: 'projects-platform not accessible', reason: v.reason });
  }
  next();
}

/**
 * Express middleware:要求 admin mode(只給 Cortex admin)
 */
async function requireAdminMode(req, res, next) {
  const v = req.projectsVisibility || await determineVisibility(req.user);
  if (v.mode !== 'admin') {
    log.warn(`block admin ${req.method} ${req.path} — mode=${v.mode}`);
    return res.status(403).json({ error: 'admin only', mode: v.mode });
  }
  next();
}

module.exports = {
  determineVisibility,
  injectVisibility,
  requireVisible,
  requireAdminMode,
  // for testing
  _config: { GA_MODE, PILOT_USERS },
};
