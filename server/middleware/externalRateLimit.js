'use strict';

/**
 * External per-IP rate limit — 外網全域 request 限流(L7 anti-flood)
 *
 * 跨 pod 共享 quota(透過 Redis INCR + 60s TTL)。
 * 內網 IP 跳過(辦公室同 NAT 出來會共用 IP,套用會誤殺)。
 *
 * 跟 access control 內既有的 `EXTERNAL_LOGIN_RATE_LIMIT` 不同:
 *   - 那個是 in-memory + 只對 /api/auth/login(login brute-force 防護)
 *   - 這個是 Redis + 全 path(含 SSE / chat 但 SSE 是單一連線多 chunks,不會撞)
 *
 * 內網跳過 + 黑名單 IP 已被 accessControl 在更早擋下,所以這層只看「外網但合法 IP」。
 * Redis 故障時保守放行(避免 service 整個掛掉)。
 */

const { isRequestInternal, getClientIp } = require('./accessControl');
const redisClient = require('../services/redisClient');

const WINDOW_SEC = parseInt(process.env.EXTERNAL_RATE_WINDOW_SEC || '60', 10);
const MAX_REQ = parseInt(process.env.EXTERNAL_RATE_LIMIT_PER_MIN || '120', 10);
// SSE / 長連線路徑跳過 rate limit(這些是「單連線跑很久」,不該按 request 算)
const SKIP_PATHS = [
  '/api/health',
  '/api/chat/sessions',  // SSE chat
  '/api/research',       // SSE research
  '/api/training/sessions', // training SSE
];

console.log(`[ExternalRateLimit] enabled | external IPs: ${MAX_REQ} req per ${WINDOW_SEC}s`);

module.exports = async function externalRateLimit(req, res, next) {
  // 內網跳過(避免辦公室 NAT 誤殺)
  if (isRequestInternal(req)) return next();

  const path = req.path || '';
  if (SKIP_PATHS.some(p => path.startsWith(p))) return next();

  const ip = getClientIp(req);
  if (!ip) return next();

  try {
    const n = await redisClient.incrSharedValue(`rate:ext:ip:${ip}`, WINDOW_SEC);
    if (n > MAX_REQ) {
      res.set('Retry-After', String(WINDOW_SEC));
      console.warn(`[ExternalRateLimit] limit hit | ip=${ip} count=${n}/${MAX_REQ} ${req.method} ${path}`);
      return res.status(429).json({ error: 'Too many requests, please slow down' });
    }
  } catch (e) {
    // Redis 故障 → 不擋,只 log。anti-DDoS 還有 ingress 層 limit-rps 兜底
    console.warn(`[ExternalRateLimit] redis error (allow): ${e.message}`);
  }
  next();
};
