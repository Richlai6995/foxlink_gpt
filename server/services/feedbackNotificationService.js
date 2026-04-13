/**
 * Feedback Notification Service — 統一通知整合
 * Email + Webex + 站內 + WebSocket
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

// ─── Webex 通知 ───────────────────────────────────────────────────────────────

async function sendTicketWebex(type, ticket, extra = {}) {
  // Webex 只通知：新單 + 使用者發訊息（減少 noise）
  if (!['new_ticket', 'new_message'].includes(type)) return;
  // new_message 只有申請者發的才通知（管理員回覆不發 webex）
  if (type === 'new_message' && extra.senderRole === 'admin') return;

  const priorityEmoji = { urgent: '🔴', high: '🟠', medium: '🔵', low: '⚪' };
  const pEmoji = priorityEmoji[ticket.priority] || '🔵';

  const messages = {
    new_ticket: `🎫 **新問題反饋**\n━━━━━━━━━━━━\n**單號：** ${ticket.ticket_no}\n**申請者：** ${ticket.applicant_name} (${ticket.applicant_dept || '-'})\n**優先級：** ${pEmoji} ${ticket.priority}\n**主旨：** ${ticket.subject}\n━━━━━━━━━━━━\n回覆：\`feedback reply ${ticket.ticket_no} 你的回覆\``,
    new_message: `💬 **工單訊息** ${ticket.ticket_no}\n**來自：** ${extra.senderName || '-'}\n**內容：** ${(extra.content || '').slice(0, 200)}`,
  };

  const md = messages[type];
  if (!md) return;

  // Webex Bot → 自動建立/取得 feedback admin room → 發送
  try {
    const roomId = await ensureFeedbackWebexRoom();
    if (roomId) {
      const { getWebexService } = require('./webexService');
      const webex = getWebexService();
      await webex.sendMessage(roomId, md, { markdown: md });
      return;
    }
  } catch (e) {
    console.warn(`[FeedbackNotif] webex ${type} error:`, e.message);
  }
}

// ─── 自動建立/維護 Feedback Admin Room ───────────────────────────────────────

let _roomIdCache = null;

async function ensureFeedbackWebexRoom() {
  // 快取避免每次都查 DB
  if (_roomIdCache) return _roomIdCache;

  try {
    if (!process.env.WEBEX_BOT_TOKEN) return null;
    const db = require('../database-oracle').db;
    const { getWebexService } = require('./webexService');
    const webex = getWebexService();

    // 1. 查 system_settings 是否已有 room id
    let row = await db.prepare("SELECT value FROM system_settings WHERE key = 'feedback_webex_room_id'").get();
    let roomId = row?.value || null;

    // 2. 驗證 room 是否還存在
    if (roomId) {
      try {
        await webex.client.get(`/rooms/${roomId}`);
        // room 存在，同步管理員
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

    // 3. 建立新 room
    const room = await webex.createRoom('Cortex - 問題反饋通知');
    roomId = room.id;
    console.log(`[FeedbackNotif] Created Webex room: ${roomId}`);

    // 4. 儲存到 system_settings
    const existing = await db.prepare("SELECT key FROM system_settings WHERE key = 'feedback_webex_room_id'").get();
    if (existing) {
      await db.prepare("UPDATE system_settings SET value = ? WHERE key = 'feedback_webex_room_id'").run(roomId);
    } else {
      await db.prepare("INSERT INTO system_settings (key, value) VALUES ('feedback_webex_room_id', ?)").run(roomId);
    }

    // 5. 邀請所有管理員
    await _syncAdminMembers(db, webex, roomId);

    _roomIdCache = roomId;
    return roomId;
  } catch (e) {
    console.warn('[FeedbackNotif] ensureFeedbackWebexRoom error:', e.message);
    return null;
  }
}

/** 同步所有 admin 到 feedback webex room（新增缺少的成員） */
async function _syncAdminMembers(db, webex, roomId) {
  try {
    const admins = await db.prepare(
      "SELECT email FROM users WHERE role = 'admin' AND status != 'disabled' AND email IS NOT NULL"
    ).all();

    for (const admin of admins) {
      if (admin.email) {
        await webex.addRoomMember(roomId, admin.email);
      }
    }
  } catch (e) {
    console.warn('[FeedbackNotif] syncAdminMembers error:', e.message);
  }
}

// ─── 站內通知 + WebSocket ─────────────────────────────────────────────────────

async function notifyAdmins(db, ticket, type, title, message) {
  try {
    const admins = await db.prepare("SELECT id FROM users WHERE role = 'admin' AND status != 'disabled'").all();
    for (const admin of admins) {
      await feedbackService.createNotification(db, {
        user_id: admin.id,
        ticket_id: ticket.id,
        type,
        title,
        message,
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
      user_id: userId,
      ticket_id: ticket.id,
      type,
      title,
      message,
    });
    emitUserNotification(userId, { ticket_id: ticket.id, type, title, message });
  } catch (e) {
    console.warn('[FeedbackNotif] notifyUser error:', e.message);
  }
}

// ─── 統一事件分派 ─────────────────────────────────────────────────────────────

async function onTicketCreated(db, ticket) {
  await Promise.allSettled([
    notifyAdmins(db, ticket, 'new_ticket', `新問題反饋: ${ticket.ticket_no}`, `${ticket.applicant_name} 提交了問題: ${ticket.subject}`),
    sendTicketEmail(db, 'new_ticket', ticket),
    sendTicketWebex('new_ticket', ticket),
  ]);
  emitNewTicket(ticket);
}

async function onTicketResolved(db, ticket, note, resolverName) {
  await Promise.allSettled([
    notifyUser(db, ticket.user_id, ticket, 'resolved', `工單已解決: ${ticket.ticket_no}`, note || '您的問題已被解決'),
    // Email/Webex 不通知結案（減少 noise），只站內通知
  ]);
}

async function onTicketReopened(db, ticket) {
  await Promise.allSettled([
    notifyAdmins(db, ticket, 'reopened', `工單重開: ${ticket.ticket_no}`, `申請者表示問題尚未解決`),
    // Email/Webex 不通知重開（減少 noise），只站內通知
  ]);
}

async function onNewMessage(db, ticket, senderName, content, isInternal, senderRole) {
  if (isInternal) return; // 內部備註不外發通知

  await Promise.allSettled([
    // Webex 群組通知
    sendTicketWebex('new_message', ticket, { senderName, content, senderRole }),
    // 申請者發訊息 → 通知管理員群組（站內 + webex）
    senderRole === 'applicant'
      ? notifyAdmins(db, ticket, 'new_message', `工單回覆: ${ticket.ticket_no}`, `${senderName}: ${content.slice(0, 200)}`)
      : Promise.resolve(),
    // 管理員回覆 → 通知申請者（站內）
    senderRole === 'admin'
      ? notifyUser(db, ticket.user_id, ticket, 'new_message', `工單回覆: ${ticket.ticket_no}`, `${senderName}: ${content.slice(0, 200)}`)
      : Promise.resolve(),
  ]);
}

module.exports = {
  sendTicketEmail,
  sendTicketWebex,
  notifyAdmins,
  notifyUser,
  onTicketCreated,
  onTicketResolved,
  onTicketReopened,
  onNewMessage,
};
