/**
 * Socket.io Service — 即時對話 + 通知推播
 *
 * 房間設計:
 *   ticket:{ticketId}     — 單一工單對話房間
 *   feedback:admin        — 管理員全局通知
 *   feedback:user:{userId} — 使用者個人通知
 */

const { Server } = require('socket.io');
let io = null;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    path: '/socket.io',
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // Redis adapter（多 Pod 環境，開發環境無 Redis 則跳過）
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    (async () => {
      try {
        const { createAdapter } = require('@socket.io/redis-adapter');
        const Redis = require('ioredis');
        const redisOpts = { maxRetriesPerRequest: 1, connectTimeout: 3000, lazyConnect: true, retryStrategy: () => null };
        const pubClient = new Redis(redisUrl, redisOpts);
        pubClient.on('error', (err) => console.warn('[Socket.io] Redis pub error:', err.message));
        // Test connection first — if Redis is unreachable, fall back gracefully
        await pubClient.connect();
        const subClient = pubClient.duplicate();
        subClient.on('error', (err) => console.warn('[Socket.io] Redis sub error:', err.message));
        await subClient.connect();
        io.adapter(createAdapter(pubClient, subClient));
        console.log('[Socket.io] Redis adapter connected');
      } catch (e) {
        console.warn('[Socket.io] Redis adapter failed, using in-memory:', e.message);
      }
    })();
  }

  // 認證 middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('unauthorized'));

    try {
      const redis = require('./redisClient');
      const session = await redis.getSession(token);
      if (!session) return next(new Error('unauthorized'));
      socket.user = session;
      next();
    } catch (e) {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    if (!user) return socket.disconnect();

    // 自動加入個人房間(feedback 既有 + projects-platform 共用同一個 user room)
    socket.join(`feedback:user:${user.id}`);
    socket.join(`user:${user.id}`);  // 通用 user channel(projects 用)

    // 管理員自動加入 admin 房間
    if (user.role === 'admin') {
      socket.join('feedback:admin');
    }

    // 加入工單房間
    socket.on('join_ticket', ({ ticketId }) => {
      if (ticketId) socket.join(`ticket:${ticketId}`);
    });

    socket.on('leave_ticket', ({ ticketId }) => {
      if (ticketId) socket.leave(`ticket:${ticketId}`);
    });

    // Typing indicator(feedback ticket)
    socket.on('typing', ({ ticketId }) => {
      socket.to(`ticket:${ticketId}`).emit('user_typing', {
        ticketId,
        userId: user.id,
        name: user.name || user.username,
      });
    });

    socket.on('stop_typing', ({ ticketId }) => {
      socket.to(`ticket:${ticketId}`).emit('user_stop_typing', {
        ticketId,
        userId: user.id,
      });
    });

    // ─── Projects-Platform rooms ───────────────────────────────────────
    // 加入專案房間 / 頻道房間(ACL 由 server 端 check)
    socket.on('join_project', async ({ projectId }) => {
      if (!projectId) return;
      if (await _canAccessProject(user, projectId)) {
        socket.join(`proj:${projectId}`);
      }
    });
    socket.on('leave_project', ({ projectId }) => {
      if (projectId) socket.leave(`proj:${projectId}`);
    });

    socket.on('join_project_channel', async ({ projectId, channelId }) => {
      if (!projectId || !channelId) return;
      if (await _canAccessProjectChannel(user, projectId, channelId)) {
        socket.join(`proj:channel:${channelId}`);
      }
    });
    socket.on('leave_project_channel', ({ channelId }) => {
      if (channelId) socket.leave(`proj:channel:${channelId}`);
    });

    // Project channel typing
    socket.on('proj_typing', ({ channelId }) => {
      if (channelId) {
        socket.to(`proj:channel:${channelId}`).emit('proj_user_typing', {
          channelId,
          userId: user.id,
          name: user.name || user.username,
        });
      }
    });
    socket.on('proj_stop_typing', ({ channelId }) => {
      if (channelId) {
        socket.to(`proj:channel:${channelId}`).emit('proj_user_stop_typing', {
          channelId, userId: user.id,
        });
      }
    });

    // ─── Comm rooms(Sprint K)─────────────────────────────────────────
    socket.on('join_comm_room', async ({ roomId }) => {
      if (!roomId) return;
      if (await _canAccessCommRoom(user, roomId)) {
        socket.join(`comm:room:${roomId}`);
      }
    });
    socket.on('leave_comm_room', ({ roomId }) => {
      if (roomId) socket.leave(`comm:room:${roomId}`);
    });

    socket.on('disconnect', () => {});
  });

  console.log('[Socket.io] Initialized');
  return io;
}

function getIO() {
  return io;
}

// ─── 推送事件 helpers ────────────────────────────────────────────────────────

/** 推送新訊息到工單房間 */
function emitNewMessage(ticketId, message) {
  if (!io) return;
  io.to(`ticket:${ticketId}`).emit('new_message', { message });
}

/** 推送狀態變更 */
function emitStatusChanged(ticketId, data) {
  if (!io) return;
  io.to(`ticket:${ticketId}`).emit('status_changed', data);
}

/** 通知管理員群組有新工單 */
function emitNewTicket(ticket) {
  if (!io) return;
  io.to('feedback:admin').emit('new_ticket', { ticket });
}

/** 推送到使用者個人通知 */
function emitUserNotification(userId, notification) {
  if (!io) return;
  io.to(`feedback:user:${userId}`).emit('notification', { notification });
}

/** 推送工單被接單 */
function emitTicketAssigned(ticketId, data) {
  if (!io) return;
  io.to(`ticket:${ticketId}`).emit('ticket_assigned', data);
}

/**
 * 廣播公告變動 — 所有 client 收到後 refetch /announcements/active
 * 不直接送公告內容(audience filter 留在 server),client 自己拉
 */
function emitAnnouncementChanged(payload = {}) {
  if (!io) return;
  io.emit('announcement:changed', { kind: payload.kind || 'invalidate', at: Date.now() });
}

// ─────────────────────────────────────────────────────────────────────
// Projects-Platform emit helpers
// ─────────────────────────────────────────────────────────────────────

/** 推送新訊息到專案頻道(ChatTab 即時更新)*/
function emitProjectMessage(channelId, message) {
  if (!io || !channelId) return;
  io.to(`proj:channel:${channelId}`).emit('proj_new_message', { channel_id: channelId, message });
}

/** 推送 stage 推進到全專案 room(WarRoom ribbon refresh)*/
function emitProjectStageAdvanced(projectId, data) {
  if (!io || !projectId) return;
  io.to(`proj:${projectId}`).emit('proj_stage_advanced', { project_id: projectId, ...data });
}

/** 推送 lifecycle 變動到全專案 room */
function emitProjectLifecycleChanged(projectId, data) {
  if (!io || !projectId) return;
  io.to(`proj:${projectId}`).emit('proj_lifecycle_changed', { project_id: projectId, ...data });
}

/** 推送 user 個人通知(in_app_badge — 鈴鐺立即跳)*/
function emitProjectUserNotification(userId, payload) {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit('proj_notification', payload);
}

/** 推送跨專案 comm room 訊息(Sprint K · 域內通訊)*/
function emitCommMessage(roomId, message) {
  if (!io || !roomId) return;
  io.to(`comm:room:${roomId}`).emit('comm_new_message', { room_id: roomId, message });
}

// ─────────────────────────────────────────────────────────────────────
// ACL helpers
// ─────────────────────────────────────────────────────────────────────

async function _canAccessProject(user, projectId) {
  if (!user?.id) return false;
  if (user.role === 'admin') return true;
  try {
    const db = require('../database-oracle').db;
    const row = await db.prepare(
      `SELECT id FROM projects WHERE id = ?
        AND (pm_user_id = ? OR sales_user_id = ? OR created_by_user_id = ?
             OR id IN (SELECT project_id FROM project_members WHERE user_id = ?))`,
    ).get(projectId, user.id, user.id, user.id, user.id);
    return !!row;
  } catch (e) {
    return false;
  }
}

async function _canAccessCommRoom(user, roomId) {
  if (!user?.id) return false;
  try {
    const db = require('../database-oracle').db;
    const commRoomService = require('../projects-platform/services/commRoomService');
    const room = await commRoomService.get(db, roomId);
    if (!room) return false;
    return commRoomService.canAccess(db, user.id, room);
  } catch (e) {
    return false;
  }
}

async function _canAccessProjectChannel(user, projectId, channelId) {
  if (!user?.id) return false;
  if (user.role === 'admin') return true;
  if (!(await _canAccessProject(user, projectId))) return false;
  try {
    const db = require('../database-oracle').db;
    // PM 全 channel 看;一般 member 看 default channel + 自己 participant 的 channel
    const proj = await db.prepare(
      `SELECT pm_user_id FROM projects WHERE id = ?`,
    ).get(projectId);
    if (Number(proj?.pm_user_id) === Number(user.id)) return true;
    const ch = await db.prepare(
      `SELECT is_default FROM project_channels WHERE id = ? AND project_id = ?`,
    ).get(channelId, projectId);
    if (!ch) return false;
    if (Number(ch.is_default) === 1) return true;
    const cp = await db.prepare(
      `SELECT id FROM channel_participants WHERE channel_id = ? AND user_id = ? AND left_at IS NULL`,
    ).get(channelId, user.id);
    return !!cp;
  } catch (e) {
    return false;
  }
}

module.exports = {
  initSocket,
  getIO,
  emitNewMessage,
  emitStatusChanged,
  emitNewTicket,
  emitUserNotification,
  emitTicketAssigned,
  emitAnnouncementChanged,
  // projects-platform
  emitProjectMessage,
  emitProjectStageAdvanced,
  emitProjectLifecycleChanged,
  emitProjectUserNotification,
  emitCommMessage,
};
