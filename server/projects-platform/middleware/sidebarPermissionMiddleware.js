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
 * @param {object} user req.user 物件
 * @returns {{can_see: boolean, mode: 'admin'|'pilot'|'user'|'hidden', reason: string}}
 */
function determineVisibility(user) {
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

  // Phase 1 GA — role-based
  if (isAdmin) {
    return { can_see: true, mode: 'admin', reason: 'admin' };
  }
  // TODO Phase 1 GA:檢查 user 是否有任一 project.* role 或被邀進任一 project
  // 目前 Phase 0 簡化版,GA mode 直接 false 不會走到這
  return { can_see: false, mode: 'hidden', reason: 'no-role-no-membership' };
}

/**
 * Express middleware:把 visibility info 塞到 req,讓 downstream 用
 */
function injectVisibility(req, res, next) {
  req.projectsVisibility = determineVisibility(req.user);
  next();
}

/**
 * Express middleware:要求 visible(不 visible 直接 403)
 */
function requireVisible(req, res, next) {
  const v = req.projectsVisibility || determineVisibility(req.user);
  if (!v.can_see) {
    log.warn(`block ${req.method} ${req.path} — ${v.reason}`);
    return res.status(403).json({ error: 'projects-platform not accessible', reason: v.reason });
  }
  next();
}

/**
 * Express middleware:要求 admin mode(只給 Cortex admin)
 */
function requireAdminMode(req, res, next) {
  const v = req.projectsVisibility || determineVisibility(req.user);
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
