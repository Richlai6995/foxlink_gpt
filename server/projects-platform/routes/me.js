/**
 * /api/projects/me — 當前 user 對 projects-platform 的可見性 / mode
 *
 * 給 client sidebar 用,判定要不要顯示 menu。
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorBoundary');
const { determineVisibility } = require('../middleware/sidebarPermissionMiddleware');

const router = express.Router();

/**
 * GET /api/projects/me/visibility
 * 給 client 用,前端 sidebar 根據此判定要不要顯示 menu。
 *
 * Response:
 *   {
 *     can_see: true|false,
 *     mode: 'admin'|'pilot'|'user'|'hidden',
 *     reason: '...',
 *     features: { internal_admin: bool, dashboard: bool, ... }
 *   }
 */
router.get('/visibility', asyncHandler(async (req, res) => {
  const v = await determineVisibility(req.user);
  res.json({
    can_see: v.can_see,
    mode: v.mode,
    reason: v.reason,
    features: {
      internal_admin: v.mode === 'admin',
      dashboard:      v.can_see,
      projects_list:  v.can_see,
      wizard:         v.can_see && (v.mode === 'admin' || v.mode === 'pilot' || v.mode === 'user'),
    },
    // 給診斷頁顯示用 — admin 可以照這個 id 抄進 PILOT_USERS
    user: req.user ? {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
    } : null,
  });
}));

/**
 * GET /api/projects/me/roles — 列當前 user 的 active role grants
 * Sprint H 新增,給 sidebar / wizard / WarRoom 判定 super_user / director 等
 */
router.get('/roles', asyncHandler(async (req, res) => {
  if (!req.user?.id) return res.json({ roles: [] });
  const userRoles = require('../services/userRoleService');
  const roles = await userRoles.getEffectiveRoles(require('../../database-oracle').db, req.user.id);
  res.json({ roles, total: roles.length, user_id: req.user.id });
}));

module.exports = router;
