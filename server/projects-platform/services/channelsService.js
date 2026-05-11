/**
 * Channels Service — channel CRUD + participants + DM
 *
 * 對應 spec §13.1.2 / §13.1.3 / §13.5(DM)
 *
 * 約定:
 *   - 預設 channels(announcement / general)由 projectsService.create 自動建好
 *   - 此服務處理:後續 group/topic 建立、DM、participants 增刪、archive
 *   - DM 特殊規則:channel_type='dm',name 用 user_id 排序組合(e.g. 'dm:12+34')
 */

const { makeLogger } = require('./logger');
const log = makeLogger('channelsService');

/**
 * 列 project 的所有 channels(可選過濾 archive / type)
 */
async function listForProject(db, projectId, { includeArchived = false, type = null } = {}) {
  const params = [projectId];
  const wh = [`project_id = ?`];
  if (!includeArchived) wh.push(`is_archived = 0`);
  if (type) { wh.push(`channel_type = ?`); params.push(type); }

  const rows = await db.prepare(
    `SELECT id, project_id, name, channel_type, is_default, visibility,
            topic_summary, is_archived, archived_at, created_by, created_at
       FROM project_channels
      WHERE ${wh.join(' AND ')}
      ORDER BY is_default DESC, id`,
  ).all(...params);
  return rows;
}

/**
 * 列 user 可看的 channels(in project + is participant OR is admin)
 */
async function listForUser(db, projectId, user) {
  const isAdmin = user.role === 'admin';
  if (isAdmin) return listForProject(db, projectId);

  const rows = await db.prepare(
    `SELECT pc.id, pc.project_id, pc.name, pc.channel_type, pc.is_default,
            pc.visibility, pc.topic_summary, pc.is_archived, pc.archived_at,
            pc.created_by, pc.created_at
       FROM project_channels pc
       JOIN channel_participants cp ON cp.channel_id = pc.id
      WHERE pc.project_id = ?
        AND pc.is_archived = 0
        AND cp.user_id = ?
        AND cp.left_at IS NULL
      ORDER BY pc.is_default DESC, pc.id`,
  ).all(projectId, user.id);
  return rows;
}

/**
 * 建立 channel(非 default)— 只有 PM/admin 能建
 */
async function create(db, { projectId, name, channelType, creatorId, visibility = 'project', topicSummary }) {
  if (!projectId) throw new Error('projectId required');
  if (!name) throw new Error('name required');
  if (!channelType) throw new Error('channelType required');
  if (!creatorId) throw new Error('creatorId required');

  const allowed = ['announcement', 'general', 'group', 'topic', 'dm'];
  if (!allowed.includes(channelType)) {
    throw new Error(`invalid channelType: ${channelType}`);
  }

  // dm 走獨立 API(findOrCreateDM),不接受直接 create
  if (channelType === 'dm') throw new Error('use findOrCreateDM() for DM channels');

  try {
    const ins = await db.prepare(
      `INSERT INTO project_channels
         (project_id, name, channel_type, is_default, visibility, topic_summary, created_by)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
    ).run(projectId, name, channelType, visibility, topicSummary || null, creatorId);

    const channelId = Number(ins.lastInsertRowid);

    // creator 自動成為 owner
    await _joinChannel(db, channelId, creatorId, 'owner');

    log.log(`created channel ${name} (id=${channelId}) in project ${projectId}`);
    return channelId;
  } catch (e) {
    if (/UNIQUE constraint failed/.test(e.message)) {
      throw new Error(`channel name "${name}" already exists in project`);
    }
    throw e;
  }
}

/**
 * Find-or-create DM(1:1 私聊)— 2 個 user_id 配對
 *
 * DM 的 name 用 user_id 排序組合,確保 idempotent:
 *   user_id 12 vs 34 → name='dm:12+34'
 */
async function findOrCreateDM(db, { projectId, user1Id, user2Id, creatorId }) {
  if (Number(user1Id) === Number(user2Id)) {
    throw new Error('cannot create DM with self');
  }
  const [lo, hi] = [Number(user1Id), Number(user2Id)].sort((a, b) => a - b);
  const dmName = `dm:${lo}+${hi}`;

  // 找看看
  const existing = await db.prepare(
    `SELECT id FROM project_channels
      WHERE project_id = ? AND name = ? AND channel_type = 'dm'`,
  ).get(projectId, dmName);

  if (existing) {
    return { channel_id: Number(existing.id), created: false };
  }

  // 沒有 → 建
  const ins = await db.prepare(
    `INSERT INTO project_channels
       (project_id, name, channel_type, is_default, visibility, created_by)
     VALUES (?, ?, 'dm', 0, 'private', ?)`,
  ).run(projectId, dmName, creatorId || lo);

  const channelId = Number(ins.lastInsertRowid);

  await _joinChannel(db, channelId, lo, 'member');
  await _joinChannel(db, channelId, hi, 'member');

  log.log(`created DM ${dmName} (id=${channelId})`);
  return { channel_id: channelId, created: true };
}

/**
 * Archive channel(default channel 不可 archive)
 */
async function archive(db, channelId, byUserId) {
  const row = await db.prepare(
    `SELECT is_default FROM project_channels WHERE id = ?`,
  ).get(channelId);
  if (!row) throw new Error('channel not found');
  if (Number(row.is_default) === 1) {
    throw new Error('cannot archive default channel');
  }
  await db.prepare(
    `UPDATE project_channels
        SET is_archived = 1, archived_at = SYSTIMESTAMP, updated_at = SYSTIMESTAMP
      WHERE id = ?`,
  ).run(channelId);
  log.log(`channel ${channelId} archived by user ${byUserId}`);
}

/**
 * Add participant
 */
async function addParticipant(db, channelId, userId, role = 'member', _inviterId) {
  try {
    await db.prepare(
      `INSERT INTO channel_participants (channel_id, user_id, role)
       VALUES (?, ?, ?)`,
    ).run(channelId, userId, role);
    return { added: true };
  } catch (e) {
    if (/UNIQUE constraint failed/.test(e.message)) {
      // 已存在 — 如果 left_at 有值,重新激活
      await db.prepare(
        `UPDATE channel_participants
            SET left_at = NULL, role = ?
          WHERE channel_id = ? AND user_id = ?`,
      ).run(role, channelId, userId);
      return { added: true, reactivated: true };
    }
    throw e;
  }
}

/**
 * Remove participant(soft — left_at)
 */
async function removeParticipant(db, channelId, userId) {
  await db.prepare(
    `UPDATE channel_participants
        SET left_at = SYSTIMESTAMP
      WHERE channel_id = ? AND user_id = ? AND left_at IS NULL`,
  ).run(channelId, userId);
}

/**
 * List participants(active only)
 */
async function listParticipants(db, channelId) {
  const rows = await db.prepare(
    `SELECT cp.id, cp.channel_id, cp.user_id, cp.role, cp.muted,
            cp.last_read_at, cp.joined_at,
            u.username, u.name
       FROM channel_participants cp
       LEFT JOIN users u ON u.id = cp.user_id
      WHERE cp.channel_id = ? AND cp.left_at IS NULL
      ORDER BY cp.joined_at`,
  ).all(channelId);
  return rows;
}

/**
 * Mark channel as read(更新 last_read_at)
 */
async function markRead(db, channelId, userId) {
  await db.prepare(
    `UPDATE channel_participants
        SET last_read_at = SYSTIMESTAMP
      WHERE channel_id = ? AND user_id = ? AND left_at IS NULL`,
  ).run(channelId, userId);
}

/**
 * 確認 user 是否為 channel participant(active)
 */
async function isParticipant(db, channelId, userId) {
  const r = await db.prepare(
    `SELECT id FROM channel_participants
      WHERE channel_id = ? AND user_id = ? AND left_at IS NULL`,
  ).get(channelId, userId);
  return !!r;
}

/**
 * 取得 channel 基本 info + project_id(routes 驗證用)
 */
async function get(db, channelId) {
  const row = await db.prepare(
    `SELECT id, project_id, name, channel_type, is_default, visibility,
            topic_summary, is_archived, archived_at, created_by, created_at
       FROM project_channels
      WHERE id = ?`,
  ).get(channelId);
  return row;
}

// ─── internal helpers ────────────────────────────────────────────────
async function _joinChannel(db, channelId, userId, role) {
  try {
    await db.prepare(
      `INSERT INTO channel_participants (channel_id, user_id, role)
       VALUES (?, ?, ?)`,
    ).run(channelId, userId, role);
  } catch (e) {
    if (!/UNIQUE constraint failed/.test(e.message)) throw e;
  }
}

module.exports = {
  listForProject,
  listForUser,
  create,
  findOrCreateDM,
  archive,
  addParticipant,
  removeParticipant,
  listParticipants,
  markRead,
  isParticipant,
  get,
};
