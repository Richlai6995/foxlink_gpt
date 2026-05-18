/**
 * Project ACL Middleware — 成員權限驗證
 *
 * 對應 spec §6(身份體系)+ §12(機密欄位機制 — 此處只做粗粒度成員檢查)
 *
 * Sprint 1 最小版:
 *   - loadProject:讀 :projectId 進 req.project(失敗 404)
 *   - requireProjectMember:必須是 PM / sales / member / admin
 *   - requirePmOrAdmin:PM 或 admin(lifecycle / 邀人)
 *   - requireAdmin:Cortex admin only
 *
 * Phase 3 補:requireRole('DPM') / requireFieldGrant(...)
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('project-acl');

let _dbRef = null;
function setDb(db) { _dbRef = db; }
function getDb() {
  if (_dbRef) return _dbRef;
  // Fallback:從 database-oracle 全域取(init 完後會 set on module.exports.db)
  try { _dbRef = require('../../database-oracle').db; } catch {}
  return _dbRef;
}

/**
 * 載入 :projectId 對應的 project 進 req.project,並判斷 user 是否為成員。
 * 失敗回 404(找不到專案)或 403(不是成員 + 不是 admin)。
 */
function loadProject(opts = {}) {
  const { allowNonMember = false } = opts;

  return async (req, res, next) => {
    try {
      const projectId = Number(req.params.projectId || req.params.id);
      if (!projectId || isNaN(projectId)) {
        return res.status(400).json({ error: 'invalid project id' });
      }
      const db = getDb();
      if (!db) return res.status(500).json({ error: 'db not ready' });

      const project = await db.prepare(
        `SELECT id, project_code, project_type_id, pm_user_id, sales_user_id,
                created_by_user_id, lifecycle_status, status, bu_id, is_confidential
           FROM projects WHERE id = ?`,
      ).get(projectId);

      if (!project) {
        return res.status(404).json({ error: 'project not found', project_id: projectId });
      }

      // 計算 user 對此專案的角色 mask
      const isAdmin = req.user?.role === 'admin';
      const isPm = Number(project.pm_user_id) === Number(req.user?.id);
      const isSales = Number(project.sales_user_id) === Number(req.user?.id);
      const isCreator = Number(project.created_by_user_id) === Number(req.user?.id);

      let memberRow = null;
      if (!isAdmin && !isPm && !isSales && !isCreator) {
        memberRow = await db.prepare(
          `SELECT role, sub_role, field_grants
             FROM project_members
            WHERE project_id = ? AND user_id = ?`,
        ).get(projectId, req.user.id);
      }

      // Sprint H — super_user / director 也算 member(看得到專案)
      let isSuperUser = false;
      let isDirector = false;
      if (!isAdmin && !isPm && !isSales && !isCreator && !memberRow) {
        try {
          // 1. self-joined project_super_users
          const sRow = await db.prepare(
            `SELECT via_role_code FROM project_super_users
              WHERE project_id = ? AND user_id = ? AND left_at IS NULL`,
          ).get(projectId, req.user.id);
          if (sRow) isSuperUser = true;

          // 2. project.bu_director 含此 bu_id 在 scope_values[],或 project.top_director (GLOBAL)
          if (!isSuperUser) {
            const userRoles = require('../services/userRoleService');
            // top_director GLOBAL → 全公司可看
            const isTop = await userRoles.hasRole(db, req.user.id, 'project.top_director');
            // bu_director 含此 bu_id
            const isBuDir = await userRoles.hasRole(db, req.user.id, 'project.bu_director', { buId: project.bu_id });
            // hq_super GLOBAL(read-only,等同 director)
            const isHqSuper = await userRoles.hasRole(db, req.user.id, 'project.hq_super');
            // bu_super 含此 bu_id(read-only)
            const isBuSuper = await userRoles.hasRole(db, req.user.id, 'project.bu_super', { buId: project.bu_id });
            isDirector = isTop || isBuDir || isHqSuper || isBuSuper;
          }
        } catch (_) { /* ignore */ }
      }

      const isMember = isAdmin || isPm || isSales || isCreator || !!memberRow || isSuperUser || isDirector;

      if (!isMember && !allowNonMember) {
        log.warn(
          `forbid ${req.method} ${req.path} — user=${req.user?.id} not member of project=${projectId}`,
        );
        return res.status(403).json({ error: 'not a member of this project' });
      }

      req.project = project;
      req.projectAcl = {
        is_admin: isAdmin,
        is_pm: isPm,
        is_sales: isSales,
        is_creator: isCreator,
        is_member: isMember,
        is_super_user: isSuperUser,
        is_director: isDirector,
        member_role: memberRow?.role || null,
        sub_role: memberRow?.sub_role || null,
      };
      next();
    } catch (e) {
      log.error(`loadProject error:`, e.message);
      res.status(500).json({ error: 'project acl error', message: e.message });
    }
  };
}

function requireProjectMember(req, res, next) {
  if (!req.projectAcl?.is_member) {
    return res.status(403).json({ error: 'not a member of this project' });
  }
  next();
}

function requirePmOrAdmin(req, res, next) {
  const acl = req.projectAcl;
  if (!acl) return res.status(500).json({ error: 'projectAcl not loaded' });
  if (!acl.is_admin && !acl.is_pm) {
    return res.status(403).json({ error: 'PM or admin only' });
  }
  next();
}

module.exports = {
  setDb,
  loadProject,
  requireProjectMember,
  requirePmOrAdmin,
};
