/**
 * /api/projects/comm-rooms — Sprint K · 域內通訊(跨專案 channel)
 *
 * Endpoints:
 *   GET    /                              我可見的 rooms(自動 join 的)
 *   GET    /bu/:buId                      列某 BU 所有 group rooms(super_user/director)
 *   POST   /groups                        建 group { name, description?, bu_id?, is_confidential? }
 *   POST   /dm   { target_user_id }       findOrCreate DM
 *   GET    /:roomId                       room metadata + 我的 role
 *   POST   /:roomId/join                  self-join group(BU 成員 / director / super)
 *   POST   /:roomId/archive               archive(owner / admin)
 *   GET    /:roomId/participants
 *   POST   /:roomId/participants { user_id, role? }
 *   DELETE /:roomId/participants/:userId
 *   POST   /:roomId/read                  mark read
 *   GET    /:roomId/messages?limit=&before_id=&after_id=
 *   POST   /:roomId/messages { content, message_type?, reply_to_message_id? }
 *   POST   /messages/:mid/pin | unpin
 *   DELETE /messages/:mid
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorBoundary');
const commRoom = require('../services/commRoomService');
const commMsg = require('../services/commMessageService');

const router = express.Router();
function getDb() { return require('../../database-oracle').db; }

// ─── GET / list rooms for me ─────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const rooms = await commRoom.listForUser(getDb(), req.user.id);
  res.json({ rooms, count: rooms.length });
}));

// ─── GET /bu/:buId list BU group rooms ───────────────────────────────
router.get('/bu/:buId', asyncHandler(async (req, res) => {
  const buId = Number(req.params.buId);
  if (!buId) return res.status(400).json({ error: 'invalid buId' });

  // ACL:該 BU 成員 / director / super / admin
  const db = getDb();
  const isAdmin = req.user.role === 'admin';
  let allowed = isAdmin;
  if (!allowed) {
    const userRoles = require('../services/userRoleService');
    allowed = (await userRoles.hasRole(db, req.user.id, 'project.bu_director', { buId })) ||
              (await userRoles.hasRole(db, req.user.id, 'project.bu_super',    { buId })) ||
              (await userRoles.hasRole(db, req.user.id, 'project.top_director')) ||
              (await userRoles.hasRole(db, req.user.id, 'project.hq_super'));
  }
  if (!allowed) {
    // 看 user_organization_memberships
    const mem = await db.prepare(`
      SELECT 1 FROM user_organization_memberships m
        JOIN organization_units o ON o.id = m.org_unit_id
       WHERE m.user_id = ? AND m.left_at IS NULL AND o.id = ?
    `).get(req.user.id, buId).catch(() => null);
    allowed = !!mem;
  }
  if (!allowed) return res.status(403).json({ error: 'not BU member / director' });

  const rooms = await commRoom.listForBu(db, buId);
  res.json({ rooms, bu_id: buId });
}));

// ─── POST /groups create group ───────────────────────────────────────
router.post('/groups', asyncHandler(async (req, res) => {
  const { name, description, bu_id, is_confidential } = req.body || {};
  try {
    const roomId = await commRoom.createGroup(getDb(), {
      name, description, buId: bu_id || null,
      isConfidential: !!is_confidential, ownerUserId: req.user.id,
    });
    const r = await commRoom.get(getDb(), roomId);
    res.status(201).json({ room: r });
  } catch (e) {
    if (/required|invalid/.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
}));

// ─── POST /dm find-or-create ─────────────────────────────────────────
router.post('/dm', asyncHandler(async (req, res) => {
  const targetUserId = Number(req.body?.target_user_id);
  if (!targetUserId) return res.status(400).json({ error: 'target_user_id required' });
  try {
    const r = await commRoom.findOrCreateDm(getDb(), {
      userAId: req.user.id, userBId: targetUserId, creatorId: req.user.id,
    });
    const room = await commRoom.get(getDb(), r.room_id);
    res.json({ room, created: r.created });
  } catch (e) {
    if (/required|invalid|cannot/.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
}));

// ─── room-scoped routes(load + ACL check)───────────────────────────
async function loadRoom(req, res, next) {
  try {
    const roomId = Number(req.params.roomId);
    if (!roomId) return res.status(400).json({ error: 'invalid roomId' });
    const r = await commRoom.get(getDb(), roomId);
    if (!r) return res.status(404).json({ error: 'room not found' });
    if (!(await commRoom.canAccess(getDb(), req.user.id, r))) {
      return res.status(403).json({ error: 'not authorized for this room' });
    }
    req.commRoom = r;
    next();
  } catch (e) {
    next(e);
  }
}

router.get('/:roomId', loadRoom, asyncHandler(async (req, res) => {
  res.json({ room: req.commRoom });
}));

router.post('/:roomId/join', asyncHandler(async (req, res) => {
  try {
    const r = await commRoom.selfJoin(getDb(), {
      userId: req.user.id, roomId: Number(req.params.roomId),
    });
    res.status(201).json(r);
  } catch (e) {
    if (/not authorized|not found|cannot/.test(e.message)) {
      return res.status(403).json({ error: e.message });
    }
    throw e;
  }
}));

router.post('/:roomId/archive', loadRoom, asyncHandler(async (req, res) => {
  // 只 owner / admin 可 archive
  const isAdmin = req.user.role === 'admin';
  const isOwner = Number(req.commRoom.created_by_user_id) === Number(req.user.id);
  if (!isAdmin && !isOwner) return res.status(403).json({ error: 'owner or admin only' });
  await commRoom.archive(getDb(), { roomId: req.commRoom.id, userId: req.user.id });
  res.json({ ok: true });
}));

router.get('/:roomId/participants', loadRoom, asyncHandler(async (req, res) => {
  const list = await commRoom.listParticipants(getDb(), req.commRoom.id);
  res.json({ participants: list });
}));

router.post('/:roomId/participants', loadRoom, asyncHandler(async (req, res) => {
  const userIdToAdd = Number(req.body?.user_id);
  if (!userIdToAdd) return res.status(400).json({ error: 'user_id required' });
  const r = await commRoom.addParticipant(getDb(), {
    roomId: req.commRoom.id, userId: userIdToAdd,
    role: req.body?.role, adderUserId: req.user.id,
  });
  res.status(201).json(r);
}));

router.delete('/:roomId/participants/:userId', loadRoom, asyncHandler(async (req, res) => {
  const userIdToRm = Number(req.params.userId);
  await commRoom.removeParticipant(getDb(), { roomId: req.commRoom.id, userId: userIdToRm });
  res.json({ ok: true });
}));

router.post('/:roomId/read', loadRoom, asyncHandler(async (req, res) => {
  await commRoom.markRead(getDb(), { roomId: req.commRoom.id, userId: req.user.id });
  res.json({ ok: true });
}));

// ─── messages ────────────────────────────────────────────────────────
router.get('/:roomId/messages', loadRoom, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const beforeId = req.query.before_id ? Number(req.query.before_id) : null;
  const afterId = req.query.after_id ? Number(req.query.after_id) : null;
  const messages = await commMsg.list(getDb(), req.commRoom.id, { limit, beforeId, afterId });
  res.json({ messages, count: messages.length });
}));

router.post('/:roomId/messages', loadRoom, asyncHandler(async (req, res) => {
  try {
    const { content, message_type, reply_to_message_id, attachment_ids } = req.body || {};
    const r = await commMsg.post(getDb(), {
      roomId: req.commRoom.id,
      userId: req.user.id,
      content, messageType: message_type,
      replyToMessageId: reply_to_message_id,
      attachmentIds: attachment_ids,
    });
    const msg = await commMsg.get(getDb(), r.id);
    res.status(201).json({ message: msg });
  } catch (e) {
    if (/required|invalid|archived|not found/.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
}));

// ─── message-scoped(pin / delete)────────────────────────────────────
async function loadCommMessage(req, res, next) {
  try {
    const mid = Number(req.params.mid);
    if (!mid) return res.status(400).json({ error: 'invalid message id' });
    const m = await commMsg.get(getDb(), mid);
    if (!m) return res.status(404).json({ error: 'message not found' });
    const room = await commRoom.get(getDb(), Number(m.room_id));
    if (!room) return res.status(404).json({ error: 'room not found' });
    if (!(await commRoom.canAccess(getDb(), req.user.id, room))) {
      return res.status(403).json({ error: 'not authorized' });
    }
    req.commMessage = m;
    req.commRoom = room;
    next();
  } catch (e) {
    next(e);
  }
}

router.post('/messages/:mid/pin', loadCommMessage, asyncHandler(async (req, res) => {
  const isAuthor = Number(req.commMessage.user_id) === Number(req.user.id);
  const isAdmin = req.user.role === 'admin';
  const isOwner = Number(req.commRoom.created_by_user_id) === Number(req.user.id);
  if (!isAuthor && !isAdmin && !isOwner) {
    return res.status(403).json({ error: 'only author / owner / admin' });
  }
  await commMsg.pin(getDb(), req.commMessage.id, req.user.id, req.body?.note);
  res.json({ ok: true });
}));

router.post('/messages/:mid/unpin', loadCommMessage, asyncHandler(async (req, res) => {
  const isAuthor = Number(req.commMessage.user_id) === Number(req.user.id);
  const isAdmin = req.user.role === 'admin';
  const isOwner = Number(req.commRoom.created_by_user_id) === Number(req.user.id);
  if (!isAuthor && !isAdmin && !isOwner) {
    return res.status(403).json({ error: 'only author / owner / admin' });
  }
  await commMsg.unpin(getDb(), req.commMessage.id);
  res.json({ ok: true });
}));

router.delete('/messages/:mid', loadCommMessage, asyncHandler(async (req, res) => {
  const isAuthor = Number(req.commMessage.user_id) === Number(req.user.id);
  const isAdmin = req.user.role === 'admin';
  const isOwner = Number(req.commRoom.created_by_user_id) === Number(req.user.id);
  if (!isAuthor && !isAdmin && !isOwner) {
    return res.status(403).json({ error: 'only author / owner / admin' });
  }
  await commMsg.softDelete(getDb(), req.commMessage.id, req.user.id, req.body?.reason);
  res.json({ ok: true });
}));

module.exports = router;
