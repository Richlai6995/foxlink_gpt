/**
 * Communication Message Service — Sprint K(comm_room_messages CRUD)
 *
 * 跟 messagesService 解耦(獨立 schema)。
 *
 * 重要差異:
 *   - 不寫 announcement sync(沒有 announcement room 概念)
 *   - 不寫 KB chunk(spec §10.4.4 / §10.4.5):
 *       · DM 永不寫(私聊隱私)
 *       · Group 預設不寫 — Phase 2 補可選 group→KB pipeline
 *   - 不做 AI #23 自動 Pin(group 沒「決議」場景)
 *   - 走 socket.io broadcast `comm:room:{roomId}`
 */

const crypto = require('crypto');
const { makeLogger } = require('./logger');
const log = makeLogger('commMessageService');

const ALLOWED_TYPES = ['NORMAL', 'PROGRESS', 'BLOCKER', 'DECISION', 'AI_INSIGHT', 'SYSTEM'];

function _hash(content) {
  return crypto.createHash('sha256').update(String(content || '')).digest('hex').slice(0, 64);
}

async function post(db, input) {
  const {
    roomId,
    userId,
    content,
    messageType = 'NORMAL',
    replyToMessageId,
    attachmentIds,
  } = input;

  if (!roomId)  throw new Error('roomId required');
  if (!userId)  throw new Error('userId required');
  if (content == null) throw new Error('content required');
  if (!ALLOWED_TYPES.includes(messageType)) {
    throw new Error(`invalid messageType: ${messageType}`);
  }

  // 確認 room 存在 + 非 archived
  const room = await db.prepare(
    `SELECT id, room_type, is_archived FROM communication_rooms WHERE id = ?`,
  ).get(roomId);
  if (!room) throw new Error('room not found');
  if (Number(room.is_archived) === 1) throw new Error('room archived');

  const ins = await db.prepare(`
    INSERT INTO comm_room_messages
      (room_id, user_id, content, message_type, reply_to_message_id,
       attachment_ids, content_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    roomId,
    userId,
    content,
    messageType,
    replyToMessageId || null,
    attachmentIds ? JSON.stringify(attachmentIds) : null,
    _hash(content),
  );

  const messageId = Number(ins.lastInsertRowid);

  // 更新 room updated_at(讓列表 sort by latest)
  await db.prepare(
    `UPDATE communication_rooms SET updated_at = SYSTIMESTAMP WHERE id = ?`,
  ).run(roomId);

  // socket broadcast
  try {
    const sock = require('../../services/socketService');
    const msg = await get(db, messageId);
    if (msg && sock.emitCommMessage) {
      sock.emitCommMessage(roomId, msg);
    }
  } catch (e) {
    log.warn(`socket emit failed: ${e.message}`);
  }

  log.log(`comm msg ${messageId} posted to room ${roomId} type=${messageType}`);
  return { id: messageId };
}

async function list(db, roomId, { limit = 50, beforeId, afterId, includeDeleted = false } = {}) {
  const wh = ['m.room_id = ?'];
  const params = [roomId];
  if (!includeDeleted) wh.push('m.deleted_at IS NULL');
  if (beforeId) { wh.push('m.id < ?'); params.push(beforeId); }
  if (afterId)  { wh.push('m.id > ?'); params.push(afterId); }

  return db.prepare(`
    SELECT m.id, m.room_id, m.user_id, m.content, m.message_type,
           m.reply_to_message_id, m.is_pinned, m.pinned_by, m.pinned_at, m.pin_note,
           m.deleted_at, m.deleted_by, m.deletion_reason,
           m.attachment_ids, m.content_hash, m.edited_at, m.edit_count, m.created_at,
           u.username AS user_username, u.name AS user_name
      FROM comm_room_messages m
      LEFT JOIN users u ON u.id = m.user_id
     WHERE ${wh.join(' AND ')}
     ORDER BY m.created_at DESC
     FETCH FIRST ${Math.min(Number(limit) || 50, 200)} ROWS ONLY
  `).all(...params).catch(() => []);
}

async function get(db, messageId) {
  const row = await db.prepare(`
    SELECT m.id, m.room_id, m.user_id, m.content, m.message_type,
           m.reply_to_message_id, m.is_pinned, m.pinned_by, m.pinned_at, m.pin_note,
           m.deleted_at, m.deleted_by, m.deletion_reason,
           m.attachment_ids, m.content_hash, m.edited_at, m.edit_count, m.created_at,
           u.username AS user_username, u.name AS user_name
      FROM comm_room_messages m
      LEFT JOIN users u ON u.id = m.user_id
     WHERE m.id = ?
  `).get(messageId);
  return row || null;
}

async function pin(db, messageId, byUserId, note) {
  await db.prepare(`
    UPDATE comm_room_messages
       SET is_pinned = 1, pinned_by = ?, pinned_at = SYSTIMESTAMP, pin_note = ?
     WHERE id = ?
  `).run(byUserId, note || null, messageId);
}

async function unpin(db, messageId) {
  await db.prepare(`
    UPDATE comm_room_messages
       SET is_pinned = 0, pinned_by = NULL, pinned_at = NULL, pin_note = NULL
     WHERE id = ?
  `).run(messageId);
}

async function softDelete(db, messageId, byUserId, reason) {
  await db.prepare(`
    UPDATE comm_room_messages
       SET deleted_at = SYSTIMESTAMP, deleted_by = ?, deletion_reason = ?
     WHERE id = ? AND deleted_at IS NULL
  `).run(byUserId, reason || null, messageId);
}

module.exports = {
  post,
  list,
  get,
  pin,
  unpin,
  softDelete,
};
