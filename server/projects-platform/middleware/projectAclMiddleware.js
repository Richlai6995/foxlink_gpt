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

      const isMember = isAdmin || isPm || isSales || isCreator || !!memberRow;

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
