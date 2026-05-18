/**
 * Messages Service — post / list / pin / delete + 訊息色語言 + 公告同步
 *
 * 對應 spec §13.1.1(訊息流)+ §13.4(色語言)+ §13.6(BLOCKER 同步)
 *
 * 色語言:
 *   NORMAL / PROGRESS / BLOCKER / DECISION / AI_INSIGHT / SYSTEM
 *
 * 自動同步 announcement:BLOCKER / DECISION / AI_INSIGHT(在 post 時觸發)
 *
 * 刪除:
 *   standard         — soft delete(deleted_at 標記,內容保留供稽核)
 *   emergency_purge  — 抹除 content(法遵情境,只留 metadata + reason)
 */

const crypto = require('crypto');
const { makeLogger } = require('./logger');
const channelsService = require('./channelsService');

const log = makeLogger('messagesService');

const ALLOWED_TYPES = ['NORMAL', 'PROGRESS', 'BLOCKER', 'DECISION', 'AI_INSIGHT', 'SYSTEM'];
const ANNOUNCEMENT_SYNC_TYPES = ['BLOCKER', 'DECISION', 'AI_INSIGHT'];

/** AI #23 — 規則式偵測「決議」字眼自動 Pin */
const DECISION_KEYWORDS = [
  '決定', '決議', 'decided', 'decision',
  '同意', '一致', '通過', 'approved',
  '結論', '定案', '採用',
];
function detectDecisionKeyword(content) {
  if (!content) return null;
  const s = String(content).toLowerCase();
  for (const kw of DECISION_KEYWORDS) {
    if (s.includes(kw.toLowerCase())) return kw;
  }
  return null;
}

function _hash(content) {
  return crypto.createHash('sha256').update(String(content || '')).digest('hex').slice(0, 64);
}

/**
 * 發訊息
 *
 * @param {object} db
 * @param {object} input
 * @param {number} input.channelId
 * @param {number} input.userId
 * @param {string} input.content
 * @param {string} [input.messageType='NORMAL']
 * @param {number} [input.replyToMessageId]
 * @param {number[]} [input.attachmentIds]
 * @param {boolean} [input.requiresReadReceipt=false]
 */
async function post(db, input) {
  const {
    channelId,
    userId,
    content,
    messageType = 'NORMAL',
    replyToMessageId,
    attachmentIds,
    requiresReadReceipt = false,
  } = input;

  if (!channelId) throw new Error('channelId required');
  if (!userId) throw new Error('userId required');
  if (content == null) throw new Error('content required');
  if (!ALLOWED_TYPES.includes(messageType)) {
    throw new Error(`invalid messageType: ${messageType}`);
  }

  // 取 channel 拿 project_id(denormalize 用)
  const channel = await channelsService.get(db, channelId);
  if (!channel) throw new Error('channel not found');
  if (Number(channel.is_archived) === 1) throw new Error('channel archived');

  const ins = await db.prepare(
    `INSERT INTO project_messages
       (channel_id, project_id, user_id, content, message_type,
        reply_to_message_id, attachment_ids,
        requires_read_receipt, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    channelId,
    Number(channel.project_id),
    userId,
    content,
    messageType,
    replyToMessageId || null,
    attachmentIds ? JSON.stringify(attachmentIds) : null,
    requiresReadReceipt ? 1 : 0,
    _hash(content),
  );

  const messageId = Number(ins.lastInsertRowid);

  // 順便更新 channel updated_at(便利 sort by latest)
  await db.prepare(
    `UPDATE project_channels SET updated_at = SYSTIMESTAMP WHERE id = ?`,
  ).run(channelId);

  // 自動同步 announcement(BLOCKER / DECISION / AI_INSIGHT)
  let announcementMsgId = null;
  if (ANNOUNCEMENT_SYNC_TYPES.includes(messageType)) {
    announcementMsgId = await _syncToAnnouncement(db, {
      projectId: Number(channel.project_id),
      sourceChannelName: channel.name,
      messageType,
      content,
      userId,
      originalMessageId: messageId,
    });
    if (announcementMsgId) {
      await db.prepare(
        `UPDATE project_messages
            SET synced_to_announcement = 1, announcement_msg_id = ?
          WHERE id = ?`,
      ).run(announcementMsgId, messageId);
    }
  }

  // AI #23 — DECISION 自動 Pin / NORMAL 訊息偵測決議字眼也自動 Pin
  let autoPinned = false;
  const isDecision = messageType === 'DECISION';
  const decisionKw = messageType === 'NORMAL' || messageType === 'PROGRESS'
    ? detectDecisionKeyword(content)
    : null;
  if (isDecision || decisionKw) {
    try {
      await db.prepare(
        `UPDATE project_messages
            SET is_pinned = 1, pinned_by = ?, pinned_at = SYSTIMESTAMP,
                pin_note = ?
          WHERE id = ?`,
      ).run(
        userId,
        isDecision ? '⭐ AI #23 · 自動 Pin (DECISION)' : `⭐ AI #23 · 自動 Pin (偵測「${decisionKw}」)`,
        messageId,
      );
      autoPinned = true;
      log.log(`AI #23 auto-pin msg ${messageId}: ${isDecision ? 'DECISION type' : `keyword "${decisionKw}"`}`);
    } catch (e) {
      log.warn(`AI #23 auto-pin failed:`, e.message);
    }
  }

  // #10 Live KB chunk(NORMAL / PROGRESS / DECISION / AI_INSIGHT / BLOCKER 都寫,SYSTEM 不寫)
  if (messageType !== 'SYSTEM') {
    try {
      const kb = require('./kbPipeline');
      await kb.writeLiveChunk(db, {
        projectId: Number(channel.project_id),
        kind: 'chat',
        sourceId: messageId,
        content,
        tags: [messageType, `channel:${channel.name}`],
      });
    } catch (e) {
      log.warn(`KB writeLiveChunk failed: ${e.message}`);
    }
  }

  // #9 Notification engine 觸發(fire-and-forget — 失敗不擋訊息)
  try {
    const notify = require('./notificationEngine');
    if (messageType === 'BLOCKER') {
      notify.dispatch(db, 'BLOCKER_NEW', {
        project_id: Number(channel.project_id),
        message_id: messageId,
        actor: userId,
        title: `🚨 BLOCKER in #${channel.name}`,
        body: String(content).slice(0, 200),
        link_url: `/projects-platform/projects/${channel.project_id}`,
      }).catch((e) => log.warn(`BLOCKER notify async failed: ${e.message}`));
    } else if (messageType === 'DECISION' || autoPinned) {
      notify.dispatch(db, 'DECISION_NEW', {
        project_id: Number(channel.project_id),
        message_id: messageId,
        actor: userId,
        title: autoPinned ? `✅ DECISION 自動偵測 in #${channel.name}` : `✅ DECISION in #${channel.name}`,
        body: String(content).slice(0, 200),
        link_url: `/projects-platform/projects/${channel.project_id}`,
      }).catch((e) => log.warn(`DECISION notify async failed: ${e.message}`));
    }
  } catch (e) {
    log.warn(`notify dispatch failed: ${e.message}`);
  }

  // WebSocket broadcast — 即時推給 channel 內所有 client
  try {
    const sock = require('../../services/socketService');
    const msgRow = await get(db, messageId);
    if (msgRow) {
      sock.emitProjectMessage(channelId, msgRow);
      // BLOCKER/DECISION 同步到 announcement → 也推給 announcement channel 的 client
      if (announcementMsgId) {
        const annMsgRow = await get(db, announcementMsgId);
        if (annMsgRow) sock.emitProjectMessage(Number(annMsgRow.channel_id), annMsgRow);
      }
    }
  } catch (e) {
    log.warn(`socket emit failed: ${e.message}`);
  }

  log.log(`message ${messageId} posted to channel ${channelId} type=${messageType}`);
  return { id: messageId, announcementMsgId, autoPinned };
}

/**
 * List messages(分頁,新到舊)
 */
async function list(db, channelId, { limit = 50, beforeId, afterId, includeDeleted = false } = {}) {
  const params = [channelId];
  const wh = [`m.channel_id = ?`];

  if (!includeDeleted) wh.push(`m.deleted_at IS NULL`);
  if (beforeId) { wh.push(`m.id < ?`); params.push(beforeId); }
  if (afterId)  { wh.push(`m.id > ?`); params.push(afterId); }

  params.push(limit);

  const rows = await db.prepare(
    `SELECT m.id, m.channel_id, m.project_id, m.user_id, m.content, m.message_type,
            m.reply_to_message_id, m.is_pinned, m.pinned_by, m.pinned_at, m.pin_note,
            m.requires_read_receipt,
            m.synced_to_announcement, m.announcement_msg_id,
            m.deleted_at, m.deleted_by, m.deletion_mode, m.deletion_reason,
            m.attachment_ids, m.content_hash, m.edited_at, m.edit_count, m.created_at,
            u.username AS user_username, u.name AS user_name
       FROM project_messages m
       LEFT JOIN users u ON u.id = m.user_id
      WHERE ${wh.join(' AND ')}
      ORDER BY m.id DESC
      OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY`,
  ).all(...params);

  // attachment_ids JSON parse
  return rows.map((r) => ({
    ...r,
    attachment_ids: r.attachment_ids ? safeJson(r.attachment_ids, []) : [],
    // 若 standard delete,content 仍保留;若 emergency_purge,content 已被 nullify
    content: r.deleted_at && r.deletion_mode === 'emergency_purge'
      ? '[訊息已抹除]'
      : r.content,
  }));
}

/**
 * Get pinned messages of a channel
 */
async function listPinned(db, channelId) {
  return db.prepare(
    `SELECT id, channel_id, project_id, user_id, content, message_type,
            is_pinned, pinned_by, pinned_at, pin_note, created_at
       FROM project_messages
      WHERE channel_id = ? AND is_pinned = 1 AND deleted_at IS NULL
      ORDER BY pinned_at DESC`,
  ).all(channelId);
}

/**
 * Pin / Unpin
 */
async function pin(db, messageId, byUserId, note) {
  await db.prepare(
    `UPDATE project_messages
        SET is_pinned = 1, pinned_by = ?, pinned_at = SYSTIMESTAMP, pin_note = ?
      WHERE id = ?`,
  ).run(byUserId, note || null, messageId);
  log.log(`message ${messageId} pinned by ${byUserId}`);
}

async function unpin(db, messageId) {
  await db.prepare(
    `UPDATE project_messages
        SET is_pinned = 0, pinned_by = NULL, pinned_at = NULL, pin_note = NULL
      WHERE id = ?`,
  ).run(messageId);
  log.log(`message ${messageId} unpinned`);
}

/**
 * Soft delete(standard)— 保留 content 供稽核
 */
async function softDelete(db, messageId, byUserId, reason) {
  await db.prepare(
    `UPDATE project_messages
        SET deleted_at = SYSTIMESTAMP, deleted_by = ?, deletion_mode = 'standard',
            deletion_reason = ?
      WHERE id = ?`,
  ).run(byUserId, reason || null, messageId);
  log.log(`message ${messageId} soft-deleted by ${byUserId}`);
}

/**
 * Emergency purge — 抹除 content(法遵,只能 admin / PM)
 */
async function emergencyPurge(db, messageId, byUserId, reason) {
  if (!reason) throw new Error('emergency_purge requires reason');
  await db.prepare(
    `UPDATE project_messages
        SET content = '[訊息已抹除]', content_hash = NULL,
            attachment_ids = NULL,
            deleted_at = SYSTIMESTAMP, deleted_by = ?,
            deletion_mode = 'emergency_purge', deletion_reason = ?
      WHERE id = ?`,
  ).run(byUserId, reason, messageId);
  log.log(`message ${messageId} emergency-purged by ${byUserId} reason=${reason}`);
}

/**
 * 標記訊息已讀(per-message receipt)— 只在 requires_read_receipt=1 時呼叫
 */
async function markReadReceipt(db, messageId, userId) {
  try {
    await db.prepare(
      `INSERT INTO project_message_read_receipts (message_id, user_id) VALUES (?, ?)`,
    ).run(messageId, userId);
  } catch (e) {
    if (!/UNIQUE constraint failed/.test(e.message)) throw e;
  }
}

/**
 * 列誰讀過此訊息
 */
async function listReadReceipts(db, messageId) {
  return db.prepare(
    `SELECT r.id, r.message_id, r.user_id, r.read_at,
            u.username, u.name
       FROM project_message_read_receipts r
       LEFT JOIN users u ON u.id = r.user_id
      WHERE r.message_id = ?
      ORDER BY r.read_at`,
  ).all(messageId);
}

/**
 * Get message + 權限 check helper
 */
async function get(db, messageId) {
  const row = await db.prepare(
    `SELECT m.id, m.channel_id, m.project_id, m.user_id, m.content, m.message_type,
            m.reply_to_message_id, m.is_pinned, m.pinned_by, m.pinned_at, m.pin_note,
            m.requires_read_receipt,
            m.synced_to_announcement, m.announcement_msg_id,
            m.deleted_at, m.deleted_by, m.deletion_mode, m.deletion_reason,
            m.attachment_ids, m.content_hash, m.edited_at, m.edit_count, m.created_at,
            u.username AS user_username, u.name AS user_name
       FROM project_messages m
       LEFT JOIN users u ON u.id = m.user_id
      WHERE m.id = ?`,
  ).get(messageId);
  if (!row) return null;
  row.attachment_ids = row.attachment_ids ? safeJson(row.attachment_ids, []) : [];
  return row;
}

// ─── internal ──────────────────────────────────────────────────────────────
async function _syncToAnnouncement(db, { projectId, sourceChannelName, messageType, content, userId, originalMessageId }) {
  // 找 announcement channel
  const ann = await db.prepare(
    `SELECT id FROM project_channels
      WHERE project_id = ? AND channel_type = 'announcement' AND is_archived = 0`,
  ).get(projectId);
  if (!ann) {
    log.warn(`project ${projectId} has no announcement channel — skip sync`);
    return null;
  }

  const prefix = {
    BLOCKER:    '🚨 BLOCKER',
    DECISION:   '✅ DECISION',
    AI_INSIGHT: '🤖 AI INSIGHT',
  }[messageType] || messageType;

  const syncedContent = `${prefix} (from #${sourceChannelName} · msg #${originalMessageId})\n\n${content}`;

  const ins = await db.prepare(
    `INSERT INTO project_messages
       (channel_id, project_id, user_id, content, message_type, content_hash)
     VALUES (?, ?, ?, ?, 'SYSTEM', ?)`,
  ).run(Number(ann.id), projectId, userId, syncedContent, _hash(syncedContent));

  return Number(ins.lastInsertRowid);
}

function safeJson(v, fb) {
  if (!v) return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fb; }
}

module.exports = {
  ALLOWED_TYPES,
  post,
  list,
  listPinned,
  pin,
  unpin,
  softDelete,
  emergencyPurge,
  markReadReceipt,
  listReadReceipts,
  get,
};
