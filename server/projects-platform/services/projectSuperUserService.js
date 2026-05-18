/**
 * Project Super User Service — spec §13.3 / §17
 *
 * bu_super / hq_super 主動 self-join 專案(不需 PM 邀請)。
 *
 * 規則:
 *   - 必須有 project.bu_super 或 project.hq_super role grant
 *   - bu_super:該專案 bu_id 必須在 user 的 scope_values[]
 *   - hq_super:GLOBAL scope,全公司可進
 *   - 不寫 project_members,寫獨立 project_super_users 表(audit)
 *   - 進入後等同 member,可看訊息但不能發 announcement
 *   - 結案後仍可讀(read-only)
 */

const { makeLogger } = require('./logger');
const userRoles = require('./userRoleService');
const log = makeLogger('projectSuperUserService');

/**
 * Self-join a project as bu_super / hq_super
 */
async function selfJoin(db, { userId, projectId, reason }) {
  if (!userId || !projectId) throw new Error('userId / projectId required');

  const project = await db.prepare(
    `SELECT id, bu_id, lifecycle_status FROM projects WHERE id = ?`,
  ).get(projectId);
  if (!project) throw new Error('project not found');

  // 檢查 hq_super 先(全域不卡 bu_id)
  const isHqSuper = await userRoles.hasRole(db, userId, 'project.hq_super');
  let viaRole = null;
  if (isHqSuper) {
    viaRole = 'project.hq_super';
  } else {
    // 不是 hq → 看 bu_super 且 scope 含 project.bu_id
    const isBuSuper = await userRoles.hasRole(db, userId, 'project.bu_super', { buId: project.bu_id });
    if (!isBuSuper) {
      throw new Error('not authorized: requires project.hq_super or project.bu_super for this BU');
    }
    viaRole = 'project.bu_super';
  }

  // 已 self-join 過 → 直接回 idempotent
  const existing = await db.prepare(
    `SELECT id, left_at FROM project_super_users WHERE project_id = ? AND user_id = ?`,
  ).get(projectId, userId);

  if (existing && !existing.left_at) {
    return { id: Number(existing.id), already_joined: true, via_role: viaRole };
  }

  if (existing && existing.left_at) {
    // 復活
    await db.prepare(`
      UPDATE project_super_users
         SET left_at = NULL, via_role_code = ?, reason = ?, joined_at = SYSTIMESTAMP
       WHERE id = ?
    `).run(viaRole, reason || null, existing.id);
    log.log(`super_user re-joined: project=${projectId} user=${userId} via=${viaRole}`);
    return { id: Number(existing.id), rejoined: true, via_role: viaRole };
  }

  const ins = await db.prepare(`
    INSERT INTO project_super_users (project_id, user_id, via_role_code, reason)
    VALUES (?, ?, ?, ?)
  `).run(projectId, userId, viaRole, reason || null);

  const id = Number(ins.lastInsertRowid);
  log.log(`super_user joined: project=${projectId} user=${userId} via=${viaRole}`);
  return { id, via_role: viaRole };
}

/** 主動退出(self-leave)*/
async function selfLeave(db, { userId, projectId }) {
  const r = await db.prepare(
    `SELECT id FROM project_super_users
      WHERE project_id = ? AND user_id = ? AND left_at IS NULL`,
  ).get(projectId, userId);
  if (!r) return { ok: false, reason: 'not joined' };
  await db.prepare(
    `UPDATE project_super_users SET left_at = SYSTIMESTAMP WHERE id = ?`,
  ).run(r.id);
  log.log(`super_user left: project=${projectId} user=${userId}`);
  return { ok: true };
}

/** 列某 user 自己 self-joined 的專案(給「我的關注 super」清單)*/
async function listForUser(db, userId) {
  return db.prepare(`
    SELECT s.id, s.project_id, s.via_role_code, s.reason, s.joined_at,
           p.project_code, p.lifecycle_status, p.bu_id, p.data_payload
      FROM project_super_users s
      JOIN projects p ON p.id = s.project_id
     WHERE s.user_id = ? AND s.left_at IS NULL
     ORDER BY s.joined_at DESC
  `).all(userId).catch(() => []);
}

/** 列某專案的所有 super_users(audit / WarRoom 顯示用)*/
async function listForProject(db, projectId) {
  return db.prepare(`
    SELECT s.id, s.user_id, s.via_role_code, s.reason, s.joined_at,
           u.username, u.name, u.email
      FROM project_super_users s
      JOIN users u ON u.id = s.user_id
     WHERE s.project_id = ? AND s.left_at IS NULL
     ORDER BY s.joined_at DESC
  `).all(projectId).catch(() => []);
}

/** Check user 是否為某專案的 active super_user */
async function isSuperUser(db, userId, projectId) {
  const r = await db.prepare(
    `SELECT id FROM project_super_users
      WHERE user_id = ? AND project_id = ? AND left_at IS NULL`,
  ).get(userId, projectId).catch(() => null);
  return !!r;
}

module.exports = {
  selfJoin,
  selfLeave,
  listForUser,
  listForProject,
  isSuperUser,
};
