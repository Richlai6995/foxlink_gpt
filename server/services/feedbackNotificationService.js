/**
 * Feedback Notification Service — 統一通知整合
 * Email + Webex + 站內 + WebSocket
 *
 * Webex 分流（2026-04 B 方案）：
 *   Stage 1 — 未指派 → 群組廣播（所有 admin 都在 feedback group）
 *   Stage 2 — 已指派 → DM 接單者（thread 串接）
 *   關鍵里程碑（認領/結案/重開/轉單）→ 群組 summary
 */

const feedbackService = require('./feedbackService');
const { emitUserNotification, emitNewTicket } = require('./socketService');

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Email 通知 ───────────────────────────────────────────────────────────────

async function sendTicketEmail(db, type, ticket, extra = {}) {
  try {
    const { sendMail } = require('./mailService');
    const templates = {
      new_ticket: {
        to: () => process.env.ADMIN_NOTIFY_EMAIL,
        subject: () => `[Cortex] 新問題反饋 ${ticket.ticket_no} - ${escapeHtml(ticket.subject)}`,
        html: () => `
          <h3>新問題反饋</h3>
          <table style="border-collapse:collapse">
            <tr><td style="padding:4px 12px 4px 0;font-weight:bold">單號</td><td>${escapeHtml(ticket.ticket_no)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;font-weight:bold">申請者</td><td>${escapeHtml(ticket.applicant_name)} (${escapeHtml(ticket.applicant_dept || '-')})</td></tr>
            <tr><td style="padding:4px 12px 4px 0;font-weight:bold">優先級</td><td>${escapeHtml(ticket.priority)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;font-weight:bold">分類</td><td>${escapeHtml(ticket.category_name || '-')}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;font-weight:bold">主旨</td><td>${escapeHtml(ticket.subject)}</td></tr>
          </table>
          <p style="margin-top:12px">${escapeHtml(ticket.description || '').slice(0, 500)}</p>
        `,
      },
      resolved: {
        to: () => ticket.applicant_email,
        subject: () => `[Cortex] 工單已解決 ${ticket.ticket_no}`,
        html: () => `
          <h3>工單已解決</h3>
          <p><b>單號：</b>${escapeHtml(ticket.ticket_no)}</p>
          <p><b>主旨：</b>${escapeHtml(ticket.subject)}</p>
          <p><b>解決說明：</b>${escapeHtml(extra.note || '-')}</p>
        `,
      },
      reopened: {
        to: () => process.env.ADMIN_NOTIFY_EMAIL,
        subject: () => `[Cortex] 工單重開 ${ticket.ticket_no}`,
        html: () => `
          <h3>工單重開</h3>
          <p><b>單號：</b>${escapeHtml(ticket.ticket_no)}</p>
          <p><b>主旨：</b>${escapeHtml(ticket.subject)}</p>
          <p>申請者表示問題尚未解決，已重新開啟。</p>
        `,
      },
    };

    const tpl = templates[type];
    if (!tpl) return;
    const to = tpl.to();
    if (!to) return;
    await sendMail({ to, subject: tpl.subject(), html: tpl.html() });
  } catch (e) {
    console.warn(`[FeedbackNotif] email ${type} error:`, e.message);
  }
}

// ─── Webex helpers ────────────────────────────────────────────────────────────

const PRIORITY_EMOJI = { urgent: '🔴', high: '🟠', medium: '🔵', low: '⚪' };

function _ticketLink(ticket) {
  const base = process.env.PUBLIC_URL || process.env.APP_URL || process.env.WEBEX_PUBLIC_URL || '';
  const tail = `/feedback/${ticket.id}`;
  return base ? `${base.replace(/\/$/, '')}${tail}` : tail;
}

async function _getUserEmail(db, userId) {
  if (!userId) return null;
  const u = await db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
  return u?.email || null;
}

async function _getUserInfo(db, userId) {
  if (!userId) return null;
  return db.prepare('SELECT id, email, name, username FROM users WHERE id = ?').get(userId);
}

/** 發到對應的 feedback 群組（依 ticket.category_is_erp 分流） */
async function _sendToRoom(ticket, markdown) {
  try {
    if (!process.env.WEBEX_BOT_TOKEN) return null;
    const isErp = !!(ticket && Number(ticket.category_is_erp) === 1);
    console.log(`[FeedbackNotif] _sendToRoom isErp=${isErp} (category_is_erp=${ticket?.category_is_erp}, ticket_no=${ticket?.ticket_no})`);
    const roomId = isErp ? await ensureFeedbackErpWebexRoom() : await ensureFeedbackWebexRoom();
    if (!roomId) return null;
    const { getWebexService } = require('./webexService');
    const webex = getWebexService();
    return await webex.sendMessage(roomId, markdown, { markdown });
  } catch (e) {
    console.warn('[FeedbackNotif] _sendToRoom error:', e.message);
    return null;
  }
}

/**
 * DM 給指定使用者。admin 工單 assignee 可用 thread 串接（parentId 存在 ticket）。
 * 若 email 找不到或發送失敗，caller 可透過回傳 null 判斷是否需要 fallback 到群組。
 */
async function _sendDm(email, markdown, { parentId } = {}) {
  if (!email) return null;
  if (!process.env.WEBEX_BOT_TOKEN) return null;
  try {
    const { getWebexService } = require('./webexService');
    const webex = getWebexService();
    return await webex.sendDirectMessage(email, markdown, { parentId });
  } catch (e) {
    console.warn(`[FeedbackNotif] _sendDm ${email} error:`, e.message);
    return null;
  }
}

async function _recordWebexParent(db, ticketId, messageId) {
  if (!messageId) return;
  try {
    await db.prepare('UPDATE feedback_tickets SET webex_parent_message_id = ? WHERE id = ?').run(messageId, ticketId);
  } catch (e) {
    console.warn('[FeedbackNotif] _recordWebexParent error:', e.message);
  }
}

async function _clearWebexParent(db, ticketId) {
  try {
    await db.prepare('UPDATE feedback_tickets SET webex_parent_message_id = NULL WHERE id = ?').run(ticketId);
  } catch {}
}

// ─── 自動建立/維護 Feedback Admin Room ───────────────────────────────────────

let _roomIdCache = null;

async function ensureFeedbackWebexRoom() {
  if (_roomIdCache) return _roomIdCache;

  try {
    if (!process.env.WEBEX_BOT_TOKEN) return null;
    const db = require('../database-oracle').db;
    const { getWebexService } = require('./webexService');
    const webex = getWebexService();

    let row = await db.prepare("SELECT value FROM system_settings WHERE key = 'feedback_webex_room_id'").get();
    let roomId = row?.value || null;

    if (roomId) {
      try {
        await webex.client.get(`/rooms/${roomId}`);
        await _syncAdminMembers(db, webex, roomId);
        _roomIdCache = roomId;
        return roomId;
      } catch (e) {
        if (e.response?.status === 404) {
          console.warn('[FeedbackNotif] Webex room no longer exists, recreating...');
          roomId = null;
        } else {
          throw e;
        }
      }
    }

    const room = await webex.createRoom('Cortex - 問題反饋通知');
    roomId = room.id;
    console.log(`[FeedbackNotif] Created Webex room: ${roomId}`);

    const existing = await db.prepare("SELECT key FROM system_settings WHERE key = 'feedback_webex_room_id'").get();
    if (existing) {
      await db.prepare("UPDATE system_settings SET value = ? WHERE key = 'feedback_webex_room_id'").run(roomId);
    } else {
      await db.prepare("INSERT INTO system_settings (key, value) VALUES ('feedback_webex_room_id', ?)").run(roomId);
    }

    await _syncAdminMembers(db, webex, roomId);
    _roomIdCache = roomId;
    return roomId;
  } catch (e) {
    console.warn('[FeedbackNotif] ensureFeedbackWebexRoom error:', e.message);
    return null;
  }
}

async function _syncAdminMembers(db, webex, roomId) {
  try {
    // Cortex 群組：純 Cortex admin（排除僅為 ERP admin 的使用者）
    const admins = await db.prepare(
      "SELECT email FROM users WHERE role = 'admin' AND status != 'disabled' AND email IS NOT NULL"
    ).all();
    for (const admin of admins) {
      if (admin.email) await webex.addRoomMember(roomId, admin.email);
    }
  } catch (e) {
    console.warn('[FeedbackNotif] syncAdminMembers error:', e.message);
  }
}

// ─── ERP Feedback Room ────────────────────────────────────────────────────────

let _erpRoomIdCache = null;

async function ensureFeedbackErpWebexRoom() {
  if (_erpRoomIdCache) return _erpRoomIdCache;

  try {
    if (!process.env.WEBEX_BOT_TOKEN) return null;
    const db = require('../database-oracle').db;
    const { getWebexService } = require('./webexService');
    const webex = getWebexService();

    let row = await db.prepare("SELECT value FROM system_settings WHERE key = 'feedback_erp_webex_room_id'").get();
    let roomId = row?.value || null;

    if (roomId) {
      try {
        await webex.client.get(`/rooms/${roomId}`);
        await _syncErpAdminMembers(db, webex, roomId);
        _erpRoomIdCache = roomId;
        return roomId;
      } catch (e) {
        if (e.response?.status === 404) {
          console.warn('[FeedbackNotif] ERP Webex room no longer exists, recreating...');
          roomId = null;
        } else {
          throw e;
        }
      }
    }

    const room = await webex.createRoom('Cortex - ERP問題反饋通知');
    roomId = room.id;
    console.log(`[FeedbackNotif] Created ERP Webex room: ${roomId}`);

    const existing = await db.prepare("SELECT key FROM system_settings WHERE key = 'feedback_erp_webex_room_id'").get();
    if (existing) {
      await db.prepare("UPDATE system_settings SET value = ? WHERE key = 'feedback_erp_webex_room_id'").run(roomId);
    } else {
      await db.prepare("INSERT INTO system_settings (key, value) VALUES ('feedback_erp_webex_room_id', ?)").run(roomId);
    }

    await _syncErpAdminMembers(db, webex, roomId);
    _erpRoomIdCache = roomId;
    return roomId;
  } catch (e) {
    console.warn('[FeedbackNotif] ensureFeedbackErpWebexRoom error:', e.message);
    return null;
  }
}

async function _syncErpAdminMembers(db, webex, roomId) {
  try {
    const erpAdmins = await db.prepare(
      "SELECT email FROM users WHERE is_erp_admin = 1 AND status != 'disabled' AND email IS NOT NULL"
    ).all();
    for (const u of erpAdmins) {
      if (u.email) await webex.addRoomMember(roomId, u.email);
    }
  } catch (e) {
    console.warn('[FeedbackNotif] syncErpAdminMembers error:', e.message);
  }
}

// ─── 站內通知 + WebSocket ─────────────────────────────────────────────────────

async function notifyAdmins(db, ticket, type, title, message) {
  try {
    const isErp = !!(ticket && Number(ticket.category_is_erp) === 1);
    // ERP 工單：通知 Cortex admin + ERP admin
    // 非 ERP 工單：只通知 Cortex admin（ERP admin 看不到，不必通知）
    const sql = isErp
      ? "SELECT id FROM users WHERE status != 'disabled' AND (role = 'admin' OR is_erp_admin = 1)"
      : "SELECT id FROM users WHERE status != 'disabled' AND role = 'admin'";
    const admins = await db.prepare(sql).all();
    for (const admin of admins) {
      await feedbackService.createNotification(db, {
        user_id: admin.id, ticket_id: ticket.id, type, title, message,
      });
      emitUserNotification(admin.id, { ticket_id: ticket.id, type, title, message });
    }
  } catch (e) {
    console.warn('[FeedbackNotif] notifyAdmins error:', e.message);
  }
}

async function notifyUser(db, userId, ticket, type, title, message) {
  try {
    await feedbackService.createNotification(db, {
      user_id: userId, ticket_id: ticket.id, type, title, message,
    });
    emitUserNotification(userId, { ticket_id: ticket.id, type, title, message });
  } catch (e) {
    console.warn('[FeedbackNotif] notifyUser error:', e.message);
  }
}

// ─── 訊息模板 ─────────────────────────────────────────────────────────────────

function _tplNewTicket(ticket) {
  const p = PRIORITY_EMOJI[ticket.priority] || '🔵';
  return [
    `🎫 **新問題反饋** \`${ticket.ticket_no}\``,
    '━━━━━━━━━━━━',
    `**申請者**：${ticket.applicant_name || '-'} (${ticket.applicant_dept || '-'})`,
    `**分類**：${ticket.category_name || '-'}`,
    `**優先級**：${p} ${ticket.priority}`,
    `**主旨**：${ticket.subject}`,
    ticket.description ? `\n> ${(ticket.description || '').slice(0, 300).replace(/\n/g, ' ')}` : '',
    '',
    `🔗 [查看詳情 / 認領](${_ticketLink(ticket)})`,
  ].filter(Boolean).join('\n');
}

function _tplNewMessage(ticket, senderName, content) {
  return [
    `💬 **${ticket.ticket_no}** 申請者追問`,
    '',
    `> ${(content || '').slice(0, 300).replace(/\n/g, ' / ')}`,
    '',
    `🔗 [回覆](${_ticketLink(ticket)})`,
  ].join('\n');
}

function _tplAssignedGroup(ticket, assignerName) {
  return `👤 **${ticket.ticket_no}** 已由 **${assignerName || '-'}** 認領`;
}

function _tplAssignedDm(ticket) {
  const p = PRIORITY_EMOJI[ticket.priority] || '🔵';
  return [
    `👤 您已接單 **${ticket.ticket_no}**`,
    '━━━━━━━━━━━━',
    `**申請者**：${ticket.applicant_name || '-'} (${ticket.applicant_dept || '-'})`,
    `**優先級**：${p} ${ticket.priority}`,
    `**主旨**：${ticket.subject}`,
    ticket.description ? `\n> ${(ticket.description || '').slice(0, 300).replace(/\n/g, ' ')}` : '',
    '',
    `本工單後續訊息將串在此 thread 中。`,
    `🔗 [處理工單](${_ticketLink(ticket)})`,
  ].filter(Boolean).join('\n');
}

function _tplResolvedGroup(ticket, note) {
  return [
    `✅ **${ticket.ticket_no}** 已結案`,
    note ? `\n**解法**：${note.slice(0, 300)}` : '',
    `\n已同步進公開知識庫。`,
  ].filter(Boolean).join('\n');
}

function _tplResolvedDmApplicant(ticket, note) {
  return [
    `✅ 您的工單 **${ticket.ticket_no}** 已解決`,
    `**主旨**：${ticket.subject}`,
    note ? `**解決說明**：${note}` : '',
    `\n🔗 [查看 / 評分](${_ticketLink(ticket)})`,
  ].filter(Boolean).join('\n');
}

function _tplResolvedDmAssignee(ticket) {
  return `✅ 已結案 **${ticket.ticket_no}**，感謝處理。`;
}

function _tplReopenedGroup(ticket) {
  return `🔄 **${ticket.ticket_no}** 申請者重開（問題尚未解決）`;
}

function _tplReopenedDmAssignee(ticket) {
  return [
    `🔄 **${ticket.ticket_no}** 申請者重開`,
    `**主旨**：${ticket.subject}`,
    `\n🔗 [查看](${_ticketLink(ticket)})`,
  ].join('\n');
}

function _tplReassignedOld(ticket, newAssigneeName) {
  return `➡️ **${ticket.ticket_no}** 已轉給 **${newAssigneeName || '-'}**，不用再跟進。`;
}

function _tplReassignedNew(ticket, oldAssigneeName) {
  const p = PRIORITY_EMOJI[ticket.priority] || '🔵';
  return [
    `👤 您接到轉單 **${ticket.ticket_no}**（原處理者：${oldAssigneeName || '-'}）`,
    '━━━━━━━━━━━━',
    `**申請者**：${ticket.applicant_name || '-'} (${ticket.applicant_dept || '-'})`,
    `**優先級**：${p} ${ticket.priority}`,
    `**主旨**：${ticket.subject}`,
    '',
    `🔗 [處理工單](${_ticketLink(ticket)})`,
  ].join('\n');
}

// ─── 統一事件分派 ─────────────────────────────────────────────────────────────

async function onTicketCreated(db, ticket) {
  const tasks = [
    notifyAdmins(db, ticket, 'new_ticket', `新問題反饋: ${ticket.ticket_no}`, `${ticket.applicant_name} 提交了問題: ${ticket.subject}`),
    sendTicketEmail(db, 'new_ticket', ticket),
    _sendToRoom(ticket, _tplNewTicket(ticket)),
  ];
  await Promise.allSettled(tasks);
  emitNewTicket(ticket);
}

/**
 * 工單被認領（首次 admin 回覆自動指派 or 明確 assign）。
 * 群組發 summary，DM 接單者起 thread 存 parent。
 */
async function onTicketAssigned(db, ticket, assignerId, assignerName) {
  if (!ticket.assigned_to) return;

  // DM 接單者
  const assigneeEmail = await _getUserEmail(db, ticket.assigned_to);
  let assigneeMsgId = null;
  if (assigneeEmail) {
    assigneeMsgId = await _sendDm(assigneeEmail, _tplAssignedDm(ticket));
    if (assigneeMsgId) await _recordWebexParent(db, ticket.id, assigneeMsgId);
  }

  // 群組 summary
  await _sendToRoom(ticket, _tplAssignedGroup(ticket, assignerName));

  // 站內通知申請者
  await notifyUser(db, ticket.user_id, ticket, 'assigned', `工單已接單: ${ticket.ticket_no}`, `由 ${assignerName || '管理員'} 處理`);
}

async function onTicketResolved(db, ticket, note, resolverName) {
  const assigneeEmail = await _getUserEmail(db, ticket.assigned_to);

  await Promise.allSettled([
    // 站內
    notifyUser(db, ticket.user_id, ticket, 'resolved', `工單已解決: ${ticket.ticket_no}`, note || '您的問題已被解決'),
    // Email 申請者
    sendTicketEmail(db, 'resolved', ticket, { note }),
    // DM 申請者（webex email）
    ticket.applicant_email ? _sendDm(ticket.applicant_email, _tplResolvedDmApplicant(ticket, note)) : null,
    // DM 接單者（thread 接續）
    assigneeEmail ? _sendDm(assigneeEmail, _tplResolvedDmAssignee(ticket), { parentId: ticket.webex_parent_message_id }) : null,
    // 群組 summary
    _sendToRoom(ticket, _tplResolvedGroup(ticket, note)),
  ]);

  // 結案後清 thread parent（若 reopen 會重新建）
  await _clearWebexParent(db, ticket.id);
}

async function onTicketReopened(db, ticket) {
  const assigneeEmail = await _getUserEmail(db, ticket.assigned_to);

  await Promise.allSettled([
    notifyAdmins(db, ticket, 'reopened', `工單重開: ${ticket.ticket_no}`, `申請者表示問題尚未解決`),
    sendTicketEmail(db, 'reopened', ticket),
    assigneeEmail ? _sendDm(assigneeEmail, _tplReopenedDmAssignee(ticket)) : null,
    _sendToRoom(ticket, _tplReopenedGroup(ticket)),
  ]);
  // reopen 後新 thread：清舊 parent，下次 DM 會 re-record
  await _clearWebexParent(db, ticket.id);
}

/**
 * 轉單（assigned_to 從 A 變 B）。
 */
async function onTicketReassigned(db, ticket, oldAssigneeId, newAssigneeId, actorName) {
  const [oldUser, newUser] = await Promise.all([
    _getUserInfo(db, oldAssigneeId),
    _getUserInfo(db, newAssigneeId),
  ]);

  const oldName = oldUser?.name || oldUser?.username;
  const newName = newUser?.name || newUser?.username;

  // 舊 assignee DM「轉出」
  if (oldUser?.email) {
    await _sendDm(oldUser.email, _tplReassignedOld(ticket, newName));
  }

  // 新 assignee DM「接單 + 上下文」 → 建立新 thread
  let newMsgId = null;
  if (newUser?.email) {
    newMsgId = await _sendDm(newUser.email, _tplReassignedNew(ticket, oldName));
    if (newMsgId) await _recordWebexParent(db, ticket.id, newMsgId);
  }

  // 站內通知新 assignee
  if (newAssigneeId) {
    await notifyUser(db, newAssigneeId, ticket, 'reassigned', `工單轉入: ${ticket.ticket_no}`, `由 ${actorName || '管理員'} 轉給您`);
  }
}

async function onNewMessage(db, ticket, senderName, content, isInternal, senderRole) {
  if (isInternal) return;

  const tasks = [];

  // 申請者發訊息：通知所有 admin（站內）+ Webex 分流
  if (senderRole === 'applicant') {
    tasks.push(notifyAdmins(db, ticket, 'new_message', `工單回覆: ${ticket.ticket_no}`, `${senderName}: ${content.slice(0, 200)}`));

    if (ticket.assigned_to) {
      // Stage 2：DM assignee（thread）
      const email = await _getUserEmail(db, ticket.assigned_to);
      if (email) {
        tasks.push(_sendDm(email, _tplNewMessage(ticket, senderName, content), { parentId: ticket.webex_parent_message_id }));
      } else {
        // assignee 無 email → fallback 群組
        tasks.push(_sendToRoom(ticket, _tplNewMessage(ticket, senderName, content)));
      }
    } else {
      // Stage 1：群組
      tasks.push(_sendToRoom(ticket, _tplNewMessage(ticket, senderName, content)));
    }
  }

  // admin 回覆：站內通知 applicant（Webex 不發群組，reduce noise）
  if (senderRole === 'admin') {
    tasks.push(notifyUser(db, ticket.user_id, ticket, 'new_message', `工單回覆: ${ticket.ticket_no}`, `${senderName}: ${content.slice(0, 200)}`));
  }

  await Promise.allSettled(tasks);
}

// 舊 API（保留供外部 caller 相容）
async function sendTicketWebex(type, ticket, extra = {}) {
  // 新事件流請用 onTicketCreated / onTicketAssigned / ... 等事件函式
  if (type === 'new_ticket') {
    return _sendToRoom(ticket, _tplNewTicket(ticket));
  }
  if (type === 'new_message' && extra.senderRole === 'applicant') {
    if (ticket.assigned_to) {
      const db = require('../database-oracle').db;
      const email = await _getUserEmail(db, ticket.assigned_to);
      if (email) return _sendDm(email, _tplNewMessage(ticket, extra.senderName || '-', extra.content || ''), { parentId: ticket.webex_parent_message_id });
    }
    return _sendToRoom(ticket, _tplNewMessage(ticket, extra.senderName || '-', extra.content || ''));
  }
  return null;
}

module.exports = {
  sendTicketEmail,
  sendTicketWebex,
  notifyAdmins,
  notifyUser,
  onTicketCreated,
  onTicketAssigned,
  onTicketResolved,
  onTicketReopened,
  onTicketReassigned,
  onNewMessage,
  ensureFeedbackWebexRoom,
  ensureFeedbackErpWebexRoom,
};
