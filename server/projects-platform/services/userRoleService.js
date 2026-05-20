/**
 * User Role Service — spec §17 角色身份體系
 *
 * 13 預定義 role,admin 手動授予,支援 GLOBAL / BU scope。
 *
 * Phase 2 Sprint H 範圍:
 *   - grant / revoke / listGrants / listRoleDefinitions
 *   - hasRole(userId, roleCode, { buId? }) → boolean
 *   - getEffectiveRoles(userId) → [{ role_code, scope_type, scope_values, ... }]
 *   - 自動處理 expires_at(到期 is_active=0)
 *   - 不可刪到 0 admin(技術防護)
 *
 * 主動 self-join:bu_super / hq_super → 走 projectSuperUserService(分檔)
 */

const { makeLogger } = require('./logger');
const log = makeLogger('userRoleService');

/**
 * 列所有 role definitions(13 個)
 */
async function listRoleDefinitions(db) {
  const rows = await db.prepare(
    `SELECT id, role_code, name_i18n, description_i18n, category,
            is_system, default_expires_days, requires_dual_sign,
            permissions_json, created_at, updated_at
       FROM user_role_definitions
      ORDER BY category, role_code`,
  ).all().catch(() => []);
  return rows.map(_formatRoleDef);
}

/**
 * 列 user 所有 active grants(自動 expire)
 */
async function getEffectiveRoles(db, userId) {
  if (!userId) return [];
  await _expireOverdueGrants(db);
  const rows = await db.prepare(
    `SELECT g.id, g.user_id, g.role_id, g.scope_type, g.scope_values,
            g.granted_by_admin_user_id, g.granted_at, g.expires_at, g.is_active,
            d.role_code, d.name_i18n, d.category
       FROM user_role_grants g
       JOIN user_role_definitions d ON d.id = g.role_id
      WHERE g.user_id = ? AND g.is_active = 1`,
  ).all(userId).catch(() => []);
  return rows.map(_formatGrant);
}

/**
 * 列 user grants(admin 視角,含 revoked)
 */
async function listGrants(db, userId, { includeRevoked = false } = {}) {
  await _expireOverdueGrants(db);
  const where = ['g.user_id = ?'];
  const params = [userId];
  if (!includeRevoked) where.push('g.is_active = 1');
  const rows = await db.prepare(
    `SELECT g.id, g.user_id, g.role_id, g.scope_type, g.scope_values,
            g.granted_by_admin_user_id, g.granted_at, g.expires_at, g.is_active,
            g.revoked_at, g.revoked_by_admin_user_id, g.revoke_reason,
            d.role_code, d.name_i18n, d.category,
            ab.name AS granted_by_name, ar.name AS revoked_by_name
       FROM user_role_grants g
       JOIN user_role_definitions d ON d.id = g.role_id
       LEFT JOIN users ab ON ab.id = g.granted_by_admin_user_id
       LEFT JOIN users ar ON ar.id = g.revoked_by_admin_user_id
      WHERE ${where.join(' AND ')}
      ORDER BY g.granted_at DESC`,
  ).all(...params).catch(() => []);
  return rows.map(_formatGrant);
}

/**
 * 列所有 grants(admin overview · 13 role × N users)
 */
async function listAllGrants(db, { roleCode, includeRevoked = false } = {}) {
  await _expireOverdueGrants(db);
  const where = [];
  const params = [];
  if (roleCode) {
    where.push(`d.role_code = ?`);
    params.push(roleCode);
  }
  if (!includeRevoked) where.push(`g.is_active = 1`);
  const sql = `
    SELECT g.id, g.user_id, g.role_id, g.scope_type, g.scope_values,
           g.granted_by_admin_user_id, g.granted_at, g.expires_at, g.is_active,
           d.role_code, d.name_i18n, d.category,
           u.username, u.name AS user_name, u.email AS user_email
      FROM user_role_grants g
      JOIN user_role_definitions d ON d.id = g.role_id
      JOIN users u ON u.id = g.user_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY d.category, d.role_code, g.granted_at DESC
     FETCH FIRST 500 ROWS ONLY
  `;
  const rows = await db.prepare(sql).all(...params).catch(() => []);
  return rows.map(_formatGrant);
}

/**
 * Admin 授予 role
 *
 * @param {object} input
 * @param {number} input.adminUserId       — admin 自己 user id
 * @param {number} input.userId            — 被授予 user id
 * @param {string} input.roleCode          — 'project.pm' 等
 * @param {'GLOBAL'|'BU'} [input.scopeType='GLOBAL']
 * @param {number[]} [input.scopeValues]   — 當 scope_type='BU' 時的 bu_ids
 * @param {string} [input.expiresAt]       — ISO date,過期自動 is_active=0
 * @param {string} [input.reason]
 */
async function grant(db, input) {
  const adminUserId = Number(input.adminUserId);
  const userId      = Number(input.userId);
  const roleCode    = String(input.roleCode || '').trim();
  const scopeType   = (input.scopeType || 'GLOBAL').toUpperCase();
  const scopeValues = Array.isArray(input.scopeValues) ? input.scopeValues : null;

  if (!adminUserId || !userId || !roleCode) throw new Error('adminUserId/userId/roleCode required');
  if (!['GLOBAL', 'BU'].includes(scopeType)) throw new Error(`invalid scope_type: ${scopeType}`);
  if (scopeType === 'BU' && (!scopeValues || scopeValues.length === 0)) {
    throw new Error('scope_type=BU requires scope_values (bu_ids array)');
  }

  // 找 role_id
  const role = await db.prepare(
    `SELECT id, role_code FROM user_role_definitions WHERE role_code = ?`,
  ).get(roleCode);
  if (!role) throw new Error(`unknown role_code: ${roleCode}`);

  // duplicate check(同 user + role + scope 已存在 active → 直接更新)
  const existing = await db.prepare(
    `SELECT id FROM user_role_grants
      WHERE user_id = ? AND role_id = ? AND scope_type = ? AND is_active = 1`,
  ).get(userId, role.id, scopeType);

  if (existing) {
    await db.prepare(`
      UPDATE user_role_grants
         SET scope_values = ?, expires_at = ?, updated_at = SYSTIMESTAMP,
             granted_by_admin_user_id = ?
       WHERE id = ?
    `).run(
      scopeValues ? JSON.stringify(scopeValues) : null,
      input.expiresAt ? new Date(input.expiresAt) : null,
      adminUserId,
      existing.id,
    );
    log.log(`grant updated: user=${userId} role=${roleCode} scope=${scopeType} grant_id=${existing.id}`);
    return { id: existing.id, updated: true };
  }

  const ins = await db.prepare(`
    INSERT INTO user_role_grants
      (user_id, role_id, scope_type, scope_values,
       granted_by_admin_user_id, expires_at, audit_metadata_clob)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    role.id,
    scopeType,
    scopeValues ? JSON.stringify(scopeValues) : null,
    adminUserId,
    input.expiresAt ? new Date(input.expiresAt) : null,
    JSON.stringify({ reason: input.reason || null, granted_at: new Date().toISOString() }),
  );

  const grantId = Number(ins.lastInsertRowid);
  log.log(`grant created: user=${userId} role=${roleCode} scope=${scopeType} grant_id=${grantId}`);
  return { id: grantId, updated: false };
}

/**
 * 撤回 role grant
 */
async function revoke(db, grantId, adminUserId, reason) {
  if (!grantId) throw new Error('grantId required');

  // 取 grant 看是不是 admin role
  const grant = await db.prepare(`
    SELECT g.id, g.user_id, g.role_id, g.is_active, d.role_code
      FROM user_role_grants g
      JOIN user_role_definitions d ON d.id = g.role_id
     WHERE g.id = ?
  `).get(grantId);
  if (!grant) throw new Error('grant not found');
  if (Number(grant.is_active) === 0) throw new Error('grant already revoked');

  // 技術防護:不准刪到 0 admin
  if (grant.role_code === 'admin') {
    const adminCount = await db.prepare(`
      SELECT COUNT(*) AS C FROM user_role_grants g
        JOIN user_role_definitions d ON d.id = g.role_id
       WHERE d.role_code = 'admin' AND g.is_active = 1
    `).get();
    if (Number(adminCount?.C || 0) <= 1) {
      throw new Error('cannot revoke the last admin grant (must keep at least 1)');
    }
  }

  await db.prepare(`
    UPDATE user_role_grants
       SET is_active = 0,
           revoked_at = SYSTIMESTAMP,
           revoked_by_admin_user_id = ?,
           revoke_reason = ?,
           updated_at = SYSTIMESTAMP
     WHERE id = ?
  `).run(adminUserId, reason || null, grantId);

  log.log(`grant revoked: id=${grantId} by admin=${adminUserId}`);
  return { ok: true };
}

/**
 * Check user 是否有 role
 *
 * @param {string} roleCode
 * @param {object} [opts]
 * @param {number} [opts.buId]  — 若指定,則 BU scope grant 要含此 bu_id
 */
async function hasRole(db, userId, roleCode, opts = {}) {
  if (!userId || !roleCode) return false;
  // 兼容 users.role='admin'(legacy)→ 視為 admin role
  if (roleCode === 'admin') {
    const u = await db.prepare(`SELECT role FROM users WHERE id = ?`).get(userId).catch(() => null);
    if (u?.role === 'admin') return true;
  }
  const grants = await db.prepare(`
    SELECT g.scope_type, g.scope_values
      FROM user_role_grants g
      JOIN user_role_definitions d ON d.id = g.role_id
     WHERE g.user_id = ? AND d.role_code = ? AND g.is_active = 1
       AND (g.expires_at IS NULL OR g.expires_at > SYSTIMESTAMP)
  `).all(userId, roleCode).catch(() => []);

  if (grants.length === 0) return false;

  // 沒指定 buId → 任何 active grant 都算
  if (!opts.buId) return true;

  const wantBu = Number(opts.buId);
  for (const g of grants) {
    if (g.scope_type === 'GLOBAL') return true;
    if (g.scope_type === 'BU') {
      try {
        const buIds = JSON.parse(g.scope_values || '[]');
        if (Array.isArray(buIds) && buIds.map(Number).includes(wantBu)) return true;
      } catch (_) { /* ignore */ }
    }
  }
  return false;
}

/**
 * 取 user 有哪些 BU(透過 role_grants + organization_memberships union)
 */
async function getUserBuIds(db, userId) {
  if (!userId) return [];
  const ids = new Set();

  // 從 user_role_grants 的 BU scope 撈
  const grantRows = await db.prepare(`
    SELECT scope_type, scope_values
      FROM user_role_grants
     WHERE user_id = ? AND is_active = 1
       AND scope_type = 'BU'
  `).all(userId).catch(() => []);
  for (const r of grantRows) {
    try {
      const arr = JSON.parse(r.scope_values || '[]');
      for (const id of arr) ids.add(Number(id));
    } catch (_) {}
  }

  // 從 user_organization_memberships 撈(BU level only)
  const memberRows = await db.prepare(`
    SELECT m.org_unit_id
      FROM user_organization_memberships m
      JOIN organization_units o ON o.id = m.org_unit_id
     WHERE m.user_id = ? AND m.left_at IS NULL AND o.org_level = 'BU'
  `).all(userId).catch(() => []);
  for (const r of memberRows) ids.add(Number(r.org_unit_id));

  return [...ids];
}

/**
 * 把過期 grant 自動 is_active=0(每次查時 idempotent 跑一下)
 */
async function _expireOverdueGrants(db) {
  try {
    await db.prepare(`
      UPDATE user_role_grants
         SET is_active = 0,
             revoked_at = SYSTIMESTAMP,
             revoke_reason = 'auto_expired',
             updated_at = SYSTIMESTAMP
       WHERE is_active = 1 AND expires_at IS NOT NULL AND expires_at < SYSTIMESTAMP
    `).run();
  } catch (_) { /* ignore */ }
}

function _formatRoleDef(row) {
  return {
    id: Number(row.id),
    role_code: row.role_code,
    name_i18n: _parseJson(row.name_i18n, {}),
    description_i18n: _parseJson(row.description_i18n, {}),
    category: row.category,
    is_system: Number(row.is_system) === 1,
    permissions: _parseJson(row.permissions_json, {}),
    default_expires_days: row.default_expires_days,
    requires_dual_sign: Number(row.requires_dual_sign) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function _formatGrant(row) {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    role_id: Number(row.role_id),
    role_code: row.role_code,
    category: row.category,
    name_i18n: _parseJson(row.name_i18n, {}),
    scope_type: row.scope_type || 'GLOBAL',
    scope_values: _parseJson(row.scope_values, []),
    granted_by_admin_user_id: row.granted_by_admin_user_id,
    granted_by_name: row.granted_by_name,
    granted_at: row.granted_at,
    expires_at: row.expires_at,
    is_active: Number(row.is_active) === 1,
    revoked_at: row.revoked_at,
    revoked_by_admin_user_id: row.revoked_by_admin_user_id,
    revoked_by_name: row.revoked_by_name,
    revoke_reason: row.revoke_reason,
    username: row.username,
    user_name: row.user_name,
    user_email: row.user_email,
  };
}

function _parseJson(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(String(s)); }
  catch { return fallback; }
}

module.exports = {
  listRoleDefinitions,
  listGrants,
  listAllGrants,
  getEffectiveRoles,
  grant,
  revoke,
  hasRole,
  getUserBuIds,
};
