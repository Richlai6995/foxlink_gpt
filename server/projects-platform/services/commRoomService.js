/**
 * Communication Room Service — Sprint K(spec §10.4 / §13.5)
 *
 * 跨專案 / 跨組織 room:
 *   - org_group:BU 或全公司範圍的常駐 group
 *   - org_dm:跨專案 user-to-user DM
 *
 * 與 project_channels 解耦(獨立 schema)。
 *
 * ACL 模型:
 *   - admin / hq_super → 全 room 可見可寫
 *   - org_group:
 *       · BU group(bu_id 設了):該 BU 成員(user_organization_memberships)+ project.bu_director scope_values 含 bu_id + project.bu_super
 *       · global group(bu_id NULL):所有 user 可見
 *   - org_dm:只兩個 user(dm_user_a_id / dm_user_b_id)+ admin
 */

const { makeLogger } = require('./logger');
const userRoles = require('./userRoleService');
const log = makeLogger('commRoomService');

/**
 * 建一個 group room
 *
 * @param {object} input
 * @param {string} input.name
 * @param {string} [input.description]
 * @param {string} [input.scope]            — cross_org | cross_project | global
 * @param {number} [input.buId]             — BU group;省略 = global group
 * @param {boolean} [input.isConfidential]  — 機密 group(成員需雙簽邀請,Phase 2 未啟用)
 * @param {number} input.ownerUserId
 */
async function createGroup(db, input) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('name required');
  const ownerId = Number(input.ownerUserId);
  if (!ownerId) throw new Error('ownerUserId required');

  const scope = input.buId ? 'cross_org' : 'global';

  const ins = await db.prepare(`
    INSERT INTO communication_rooms
      (room_type, name, description, scope, scope_owner_id, bu_id,
       is_confidential, created_by_user_id)
    VALUES ('org_group', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.slice(0, 200),
    input.description ? String(input.description).slice(0, 500) : null,
    scope,
    input.buId || null,
    input.buId || null,
    input.isConfidential ? 1 : 0,
    ownerId,
  );

  const roomId = Number(ins.lastInsertRowid);
  await _joinRoom(db, roomId, ownerId, 'owner');

  log.log(`created group room ${roomId} bu=${input.buId || 'global'} owner=${ownerId}`);
  return roomId;
}

/**
 * Find or create DM(idempotent · spec §10.4.5)
 */
async function findOrCreateDm(db, { userAId, userBId, creatorId }) {
  const a = Number(userAId);
  const b = Number(userBId);
  if (!a || !b) throw new Error('userAId / userBId required');
  if (a === b) throw new Error('cannot DM yourself');

  const [lo, hi] = a < b ? [a, b] : [b, a];

  // 找舊的(left_at 不會影響 — DM 是 1:1 永存)
  const existing = await db.prepare(
    `SELECT id FROM communication_rooms
      WHERE room_type='org_dm' AND dm_user_a_id=? AND dm_user_b_id=?`,
  ).get(lo, hi);
  if (existing) return { room_id: Number(existing.id), created: false };

  const ins = await db.prepare(`
    INSERT INTO communication_rooms
      (room_type, name, scope, created_by_user_id, dm_user_a_id, dm_user_b_id)
    VALUES ('org_dm', ?, 'cross_project', ?, ?, ?)
  `).run(`dm:u${lo}:u${hi}`, creatorId || lo, lo, hi);

  const roomId = Number(ins.lastInsertRowid);
  // 兩人都自動 join
  await _joinRoom(db, roomId, lo, 'member');
  await _joinRoom(db, roomId, hi, 'member');

  log.log(`created DM room ${roomId} users=${lo}/${hi}`);
  return { room_id: roomId, created: true };
}

/**
 * 列 user 可見的 rooms(我加入的 group + 我是 owner / member 的 + 我的 DM)
 */
async function listForUser(db, userId) {
  if (!userId) return [];
  const rows = await db.prepare(`
    SELECT r.id, r.room_type, r.name, r.description, r.scope, r.bu_id,
           r.is_confidential, r.is_archived, r.created_by_user_id, r.created_at,
           r.dm_user_a_id, r.dm_user_b_id,
           p.role AS my_role, p.last_read_at, p.muted,
           (SELECT COUNT(*) FROM comm_room_messages m
             WHERE m.room_id = r.id AND m.deleted_at IS NULL
               AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)) AS unread_count,
           (SELECT MAX(created_at) FROM comm_room_messages m WHERE m.room_id = r.id) AS last_message_at
      FROM communication_rooms r
      JOIN comm_room_participants p ON p.room_id = r.id AND p.user_id = ? AND p.left_at IS NULL
     WHERE r.is_archived = 0
     ORDER BY last_message_at DESC NULLS LAST, r.id DESC
  `).all(userId).catch(() => []);
  return rows.map(_formatRoom);
}

/**
 * 列 BU group rooms(super_user / director 視角)
 */
async function listForBu(db, buId) {
  if (!buId) return [];
  const rows = await db.prepare(`
    SELECT r.id, r.room_type, r.name, r.description, r.scope, r.bu_id,
           r.is_confidential, r.is_archived, r.created_by_user_id, r.created_at
      FROM communication_rooms r
     WHERE r.room_type = 'org_group' AND r.bu_id = ? AND r.is_archived = 0
     ORDER BY r.id DESC
  `).all(buId).catch(() => []);
  return rows.map(_formatRoom);
}

/**
 * 取 room metadata + ACL info
 */
async function get(db, roomId) {
  const r = await db.prepare(`
    SELECT id, room_type, name, description, topic_summary, scope, bu_id,
           is_confidential, is_archived, archived_at, archived_by_user_id,
           created_by_user_id, dm_user_a_id, dm_user_b_id,
           created_at, updated_at
      FROM communication_rooms WHERE id = ?
  `).get(roomId);
  return r ? _formatRoom(r) : null;
}

/**
 * ACL: 此 user 是否可看 room(read/write)
 */
async function canAccess(db, userId, room) {
  if (!userId || !room) return false;

  // admin 全看
  const u = await db.prepare(`SELECT role FROM users WHERE id = ?`).get(userId).catch(() => null);
  if (u?.role === 'admin') return true;

  // DM:只 dm_user_a_id / dm_user_b_id
  if (room.room_type === 'org_dm') {
    return Number(room.dm_user_a_id) === Number(userId) ||
           Number(room.dm_user_b_id) === Number(userId);
  }

  // Group:participant 或 BU 成員 / director / super
  // 先 fast path:已是 participant
  const p = await db.prepare(`
    SELECT 1 FROM comm_room_participants
     WHERE room_id = ? AND user_id = ? AND left_at IS NULL
  `).get(room.id, userId).catch(() => null);
  if (p) return true;

  // Global group(bu_id NULL):所有 user 可加(預設 read 公開)
  if (!room.bu_id) return true;

  // BU group:BU 成員 / director / super
  // 1. user_organization_memberships
  const mem = await db.prepare(`
    SELECT 1 FROM user_organization_memberships m
      JOIN organization_units o ON o.id = m.org_unit_id
     WHERE m.user_id = ? AND m.left_at IS NULL AND o.id = ?
  `).get(userId, room.bu_id).catch(() => null);
  if (mem) return true;

  // 2. bu_director / bu_super(scope_values 含此 bu_id)
  if (await userRoles.hasRole(db, userId, 'project.bu_director', { buId: room.bu_id })) return true;
  if (await userRoles.hasRole(db, userId, 'project.bu_super',    { buId: room.bu_id })) return true;
  // 3. top_director / hq_super(全公司)
  if (await userRoles.hasRole(db, userId, 'project.top_director')) return true;
  if (await userRoles.hasRole(db, userId, 'project.hq_super'))     return true;

  return false;
}

/**
 * Self-join 一個 group room(若 ACL 通過)
 */
async function selfJoin(db, { userId, roomId }) {
  const room = await get(db, roomId);
  if (!room) throw new Error('room not found');
  if (room.room_type === 'org_dm') throw new Error('cannot self-join a DM');
  if (!(await canAccess(db, userId, room))) {
    throw new Error('not authorized: not BU member / director');
  }
  // 已加 → idempotent
  const ex = await db.prepare(
    `SELECT id, left_at FROM comm_room_participants WHERE room_id = ? AND user_id = ?`,
  ).get(roomId, userId);
  if (ex && !ex.left_at) return { id: Number(ex.id), already_joined: true };
  if (ex && ex.left_at) {
    await db.prepare(
      `UPDATE comm_room_participants SET left_at = NULL, joined_at = SYSTIMESTAMP WHERE id = ?`,
    ).run(ex.id);
    return { id: Number(ex.id), rejoined: true };
  }
  return { id: await _joinRoom(db, roomId, userId, 'member') };
}

async function addParticipant(db, { roomId, userId, role, adderUserId }) {
  if (!roomId || !userId) throw new Error('roomId / userId required');
  // 簡易權限:owner / admin 才能加
  const ex = await db.prepare(
    `SELECT id, role, left_at FROM comm_room_participants WHERE room_id = ? AND user_id = ?`,
  ).get(roomId, userId);
  if (ex && !ex.left_at) return { id: Number(ex.id), already: true };
  if (ex && ex.left_at) {
    await db.prepare(
      `UPDATE comm_room_participants SET left_at = NULL, joined_at = SYSTIMESTAMP, role = ? WHERE id = ?`,
    ).run(role || 'member', ex.id);
    return { id: Number(ex.id), rejoined: true };
  }
  return { id: await _joinRoom(db, roomId, userId, role || 'member') };
}

async function removeParticipant(db, { roomId, userId }) {
  await db.prepare(`
    UPDATE comm_room_participants SET left_at = SYSTIMESTAMP
     WHERE room_id = ? AND user_id = ? AND left_at IS NULL
  `).run(roomId, userId);
  return { ok: true };
}

async function listParticipants(db, roomId) {
  return db.prepare(`
    SELECT cp.id, cp.user_id, cp.role, cp.joined_at, cp.muted,
           u.username, u.name, u.email
      FROM comm_room_participants cp
      LEFT JOIN users u ON u.id = cp.user_id
     WHERE cp.room_id = ? AND cp.left_at IS NULL
     ORDER BY cp.joined_at
  `).all(roomId).catch(() => []);
}

async function markRead(db, { roomId, userId }) {
  await db.prepare(`
    UPDATE comm_room_participants
       SET last_read_at = SYSTIMESTAMP
     WHERE room_id = ? AND user_id = ? AND left_at IS NULL
  `).run(roomId, userId);
}

async function archive(db, { roomId, userId }) {
  await db.prepare(`
    UPDATE communication_rooms
       SET is_archived = 1, archived_at = SYSTIMESTAMP, archived_by_user_id = ?
     WHERE id = ? AND is_archived = 0
  `).run(userId, roomId);
}

// ─────────────────────────────────────────────────────────────────────
// Internal
// ─────────────────────────────────────────────────────────────────────
async function _joinRoom(db, roomId, userId, role) {
  const ins = await db.prepare(`
    INSERT INTO comm_room_participants (room_id, user_id, role) VALUES (?, ?, ?)
  `).run(roomId, userId, role || 'member');
  return Number(ins.lastInsertRowid);
}

function _formatRoom(row) {
  return {
    id: Number(row.id),
    room_type: row.room_type,
    name: row.name,
    description: row.description,
    topic_summary: row.topic_summary,
    scope: row.scope,
    bu_id: row.bu_id,
    is_confidential: Number(row.is_confidential) === 1,
    is_archived: Number(row.is_archived) === 1,
    archived_at: row.archived_at,
    created_by_user_id: row.created_by_user_id,
    dm_user_a_id: row.dm_user_a_id,
    dm_user_b_id: row.dm_user_b_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    my_role: row.my_role,
    muted: row.muted ? Number(row.muted) === 1 : undefined,
    unread_count: row.unread_count != null ? Number(row.unread_count) : undefined,
    last_message_at: row.last_message_at,
    last_read_at: row.last_read_at,
  };
}

module.exports = {
  createGroup,
  findOrCreateDm,
  listForUser,
  listForBu,
  get,
  canAccess,
  selfJoin,
  addParticipant,
  removeParticipant,
  listParticipants,
  markRead,
  archive,
};
