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

    // 自動加入個人房間
    socket.join(`feedback:user:${user.id}`);

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

    // Typing indicator
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

module.exports = {
  initSocket,
  getIO,
  emitNewMessage,
  emitStatusChanged,
  emitNewTicket,
  emitUserNotification,
  emitTicketAssigned,
};
