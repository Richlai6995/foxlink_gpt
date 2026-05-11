/**
 * /api/projects/* — Channels + Messages REST API
 *
 * Sprint 2 範圍:
 *   GET    /projects/:projectId/channels                  列 channels
 *   POST   /projects/:projectId/channels                  建 channel(PM/admin)
 *   POST   /projects/:projectId/channels/dm               findOrCreate DM
 *   POST   /projects/:projectId/channels/:cid/archive     archive(PM/admin)
 *
 *   GET    /projects/:projectId/channels/:cid/participants
 *   POST   /projects/:projectId/channels/:cid/participants    add (PM/admin)
 *   DELETE /projects/:projectId/channels/:cid/participants/:userId
 *   POST   /projects/:projectId/channels/:cid/read            標已讀
 *
 *   GET    /projects/:projectId/channels/:cid/messages         list
 *   POST   /projects/:projectId/channels/:cid/messages         post
 *   GET    /projects/:projectId/channels/:cid/messages/pinned  list pinned
 *
 *   POST   /projects/messages/:mid/pin           pin
 *   POST   /projects/messages/:mid/unpin         unpin
 *   DELETE /projects/messages/:mid               soft delete
 *   POST   /projects/messages/:mid/purge         emergency_purge (PM/admin only)
 *   POST   /projects/messages/:mid/receipt       mark read receipt
 *   GET    /projects/messages/:mid/receipts      list receipts
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorBoundary');
const { loadProject, requirePmOrAdmin } = require('../middleware/projectAclMiddleware');
const channelsService = require('../services/channelsService');
const messagesService = require('../services/messagesService');

const router = express.Router({ mergeParams: true });

function getDb() {
  return require('../../database-oracle').db;
}

// ============================================================================
// /projects/:projectId/channels — 跟 project 綁定的路由(走 loadProject middleware)
// ============================================================================

const projectScoped = express.Router({ mergeParams: true });

// 走 loadProject 注入 req.project + req.projectAcl
projectScoped.use(loadProject());

// ─── GET /:projectId/channels ─────────────────────────────────────────
projectScoped.get('/', asyncHandler(async (req, res) => {
  const db = getDb();
  const channels = req.projectAcl.is_admin || req.projectAcl.is_pm
    ? await channelsService.listForProject(db, req.project.id)
    : await channelsService.listForUser(db, req.project.id, req.user);
  res.json({ channels });
}));

// ─── POST /:projectId/channels ────────────────────────────────────────
// Body: { name, channel_type, visibility?, topic_summary? }
projectScoped.post('/', requirePmOrAdmin, asyncHandler(async (req, res) => {
  const db = getDb();
  const { name, channel_type, visibility, topic_summary } = req.body || {};
  try {
    const channelId = await channelsService.create(db, {
      projectId: req.project.id,
      name,
      channelType: channel_type,
      visibility,
      topicSummary: topic_summary,
      creatorId: req.user.id,
    });
    const channel = await channelsService.get(db, channelId);
    res.status(201).json({ channel });
  } catch (e) {
    if (/required|invalid|already exists/.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
}));

// ─── POST /:projectId/channels/dm ─────────────────────────────────────
// Body: { target_user_id }
projectScoped.post('/dm', asyncHandler(async (req, res) => {
  const db = getDb();
  const { target_user_id } = req.body || {};
  if (!target_user_id) return res.status(400).json({ error: 'target_user_id required' });

  const r = await channelsService.findOrCreateDM(db, {
    projectId: req.project.id,
    user1Id: req.user.id,
    user2Id: Number(target_user_id),
    creatorId: req.user.id,
  });
  const channel = await channelsService.get(db, r.channel_id);
  res.json({ channel, created: r.created });
}));

// ─── POST /:projectId/channels/:cid/archive ───────────────────────────
projectScoped.post('/:cid/archive', requirePmOrAdmin, asyncHandler(async (req, res) => {
  const db = getDb();
  const cid = Number(req.params.cid);
  await _assertChannelInProject(db, cid, req.project.id);
  try {
    await channelsService.archive(db, cid, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    if (/cannot archive default/.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
}));

// ─── Channel participants ─────────────────────────────────────────────
projectScoped.get('/:cid/participants', asyncHandler(async (req, res) => {
  const db = getDb();
  const cid = Number(req.params.cid);
  await _assertChannelInProject(db, cid, req.project.id);
  const participants = await channelsService.listParticipants(db, cid);
  res.json({ participants });
}));

projectScoped.post('/:cid/participants', requirePmOrAdmin, asyncHandler(async (req, res) => {
  const db = getDb();
  const cid = Number(req.params.cid);
  await _assertChannelInProject(db, cid, req.project.id);
  const { user_id, role } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const r = await channelsService.addParticipant(db, cid, Number(user_id), role || 'member', req.user.id);
  res.status(201).json(r);
}));

projectScoped.delete('/:cid/participants/:userId', requirePmOrAdmin, asyncHandler(async (req, res) => {
  const db = getDb();
  const cid = Number(req.params.cid);
  await _assertChannelInProject(db, cid, req.project.id);
  await channelsService.removeParticipant(db, cid, Number(req.params.userId));
  res.json({ ok: true });
}));

projectScoped.post('/:cid/read', asyncHandler(async (req, res) => {
  const db = getDb();
  const cid = Number(req.params.cid);
  await _assertChannelInProject(db, cid, req.project.id);
  await channelsService.markRead(db, cid, req.user.id);
  res.json({ ok: true });
}));

// ─── Channel messages ─────────────────────────────────────────────────
projectScoped.get('/:cid/messages', asyncHandler(async (req, res) => {
  const db = getDb();
  const cid = Number(req.params.cid);
  await _assertChannelInProject(db, cid, req.project.id);

  await _assertCanReadChannel(db, cid, req);

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const beforeId = req.query.before_id ? Number(req.query.before_id) : null;
  const afterId = req.query.after_id ? Number(req.query.after_id) : null;
  const messages = await messagesService.list(db, cid, { limit, beforeId, afterId });
  res.json({ messages, count: messages.length });
}));

projectScoped.get('/:cid/messages/pinned', asyncHandler(async (req, res) => {
  const db = getDb();
  const cid = Number(req.params.cid);
  await _assertChannelInProject(db, cid, req.project.id);
  await _assertCanReadChannel(db, cid, req);
  const messages = await messagesService.listPinned(db, cid);
  res.json({ messages });
}));

// Body: { content, message_type?, reply_to_message_id?, attachment_ids?, requires_read_receipt? }
projectScoped.post('/:cid/messages', asyncHandler(async (req, res) => {
  const db = getDb();
  const cid = Number(req.params.cid);
  await _assertChannelInProject(db, cid, req.project.id);
  await _assertCanReadChannel(db, cid, req);

  // announcement channel:只允許 PM/admin 發訊息(對齊 spec §13.1.2)
  const channel = await channelsService.get(db, cid);
  if (channel.channel_type === 'announcement' &&
      !req.projectAcl.is_admin && !req.projectAcl.is_pm) {
    return res.status(403).json({ error: 'announcement channel is PM/admin only' });
  }

  const { content, message_type, reply_to_message_id, attachment_ids, requires_read_receipt } = req.body || {};
  try {
    const r = await messagesService.post(db, {
      channelId: cid,
      userId: req.user.id,
      content,
      messageType: message_type,
      replyToMessageId: reply_to_message_id,
      attachmentIds: attachment_ids,
      requiresReadReceipt: !!requires_read_receipt,
    });
    const msg = await messagesService.get(db, r.id);
    res.status(201).json({ message: msg, announcement_msg_id: r.announcementMsgId });
  } catch (e) {
    if (/required|invalid|archived|not found/.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
}));

// ============================================================================
// /projects/messages/:mid — message-scoped routes(走 loadMessage)
// ============================================================================

const messageScoped = express.Router({ mergeParams: true });

// loadMessage:把 message + 對應 project 載到 req
async function loadMessage(req, res, next) {
  try {
    const db = getDb();
    const mid = Number(req.params.mid);
    if (!mid) return res.status(400).json({ error: 'invalid message id' });
    const msg = await messagesService.get(db, mid);
    if (!msg) return res.status(404).json({ error: 'message not found' });

    // 載 project + ACL
    const projectRow = await db.prepare(
      `SELECT id, project_code, pm_user_id, sales_user_id, created_by_user_id, lifecycle_status, is_confidential
         FROM projects WHERE id = ?`,
    ).get(Number(msg.project_id));
    if (!projectRow) return res.status(404).json({ error: 'project not found' });

    const isAdmin = req.user?.role === 'admin';
    const isPm = Number(projectRow.pm_user_id) === Number(req.user?.id);
    const isCreator = Number(projectRow.created_by_user_id) === Number(req.user?.id);
    const isSales = Number(projectRow.sales_user_id) === Number(req.user?.id);
    let memberRow = null;
    if (!isAdmin && !isPm && !isCreator && !isSales) {
      memberRow = await db.prepare(
        `SELECT role FROM project_members WHERE project_id=? AND user_id=?`,
      ).get(projectRow.id, req.user.id);
    }
    const isMember = isAdmin || isPm || isCreator || isSales || !!memberRow;
    if (!isMember) return res.status(403).json({ error: 'not a member of project' });

    req.message = msg;
    req.project = projectRow;
    req.projectAcl = {
      is_admin: isAdmin, is_pm: isPm, is_sales: isSales,
      is_creator: isCreator, is_member: isMember,
    };
    next();
  } catch (e) {
    next(e);
  }
}

messageScoped.post('/:mid/pin',
  loadMessage,
  asyncHandler(async (req, res) => {
    // 只有 author / PM / admin 可 pin
    const acl = req.projectAcl;
    const isAuthor = Number(req.message.user_id) === Number(req.user.id);
    if (!acl.is_admin && !acl.is_pm && !isAuthor) {
      return res.status(403).json({ error: 'only author/PM/admin can pin' });
    }
    await messagesService.pin(getDb(), Number(req.params.mid), req.user.id, req.body?.note);
    res.json({ ok: true });
  }),
);

messageScoped.post('/:mid/unpin',
  loadMessage,
  asyncHandler(async (req, res) => {
    const acl = req.projectAcl;
    const isAuthor = Number(req.message.user_id) === Number(req.user.id);
    if (!acl.is_admin && !acl.is_pm && !isAuthor) {
      return res.status(403).json({ error: 'only author/PM/admin can unpin' });
    }
    await messagesService.unpin(getDb(), Number(req.params.mid));
    res.json({ ok: true });
  }),
);

messageScoped.delete('/:mid',
  loadMessage,
  asyncHandler(async (req, res) => {
    const acl = req.projectAcl;
    const isAuthor = Number(req.message.user_id) === Number(req.user.id);
    if (!acl.is_admin && !acl.is_pm && !isAuthor) {
      return res.status(403).json({ error: 'only author/PM/admin can delete' });
    }
    await messagesService.softDelete(getDb(), Number(req.params.mid), req.user.id, req.body?.reason);
    res.json({ ok: true });
  }),
);

messageScoped.post('/:mid/purge',
  loadMessage,
  asyncHandler(async (req, res) => {
    const acl = req.projectAcl;
    if (!acl.is_admin && !acl.is_pm) {
      return res.status(403).json({ error: 'emergency purge requires PM/admin' });
    }
    const { reason } = req.body || {};
    if (!reason) return res.status(400).json({ error: 'reason required' });
    await messagesService.emergencyPurge(getDb(), Number(req.params.mid), req.user.id, reason);
    res.json({ ok: true });
  }),
);

messageScoped.post('/:mid/receipt',
  loadMessage,
  asyncHandler(async (req, res) => {
    await messagesService.markReadReceipt(getDb(), Number(req.params.mid), req.user.id);
    res.json({ ok: true });
  }),
);

messageScoped.get('/:mid/receipts',
  loadMessage,
  asyncHandler(async (req, res) => {
    const receipts = await messagesService.listReadReceipts(getDb(), Number(req.params.mid));
    res.json({ receipts });
  }),
);

// ─── helpers ──────────────────────────────────────────────────────────
async function _assertChannelInProject(db, channelId, projectId) {
  const r = await db.prepare(
    `SELECT id FROM project_channels WHERE id = ? AND project_id = ?`,
  ).get(channelId, projectId);
  if (!r) {
    const err = new Error('channel not in this project');
    err.status = 404;
    throw err;
  }
}

async function _assertCanReadChannel(db, channelId, req) {
  // admin / pm 全看,其他人必須是 participant
  if (req.projectAcl.is_admin || req.projectAcl.is_pm) return;
  const ok = await channelsService.isParticipant(db, channelId, req.user.id);
  if (!ok) {
    const err = new Error('not a participant of this channel');
    err.status = 403;
    throw err;
  }
}

// Error coercer for status-bearing errors
projectScoped.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  next(err);
});
messageScoped.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  next(err);
});

module.exports = {
  projectScoped,   // mount under /projects/:projectId/channels
  messageScoped,   // mount under /messages
};
