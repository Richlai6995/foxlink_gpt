/**
 * External Access Control Middleware
 *
 * Env:
 *   EXTERNAL_ACCESS_MODE    = internal_only | webhook_only | full
 *   INTERNAL_NETWORKS       = CIDR list (comma-separated)
 *   EXTERNAL_ALLOWED_PATHS  = paths allowed in webhook_only mode (comma-separated)
 *   INTERNAL_ONLY_PATHS     = paths restricted to internal even in full mode (comma-separated prefixes)
 *   EXTERNAL_LOGIN_RATE_LIMIT = max login attempts per IP per minute (full mode)
 */

// ── CIDR helpers (IPv4 + ::ffff: mapped) ────────────────────────────

function ipToLong(ip) {
  const v4 = ip.replace(/^::ffff:/, '');
  const parts = v4.split('.');
  if (parts.length !== 4) return null;
  const n = ((+parts[0]) << 24 | (+parts[1]) << 16 | (+parts[2]) << 8 | (+parts[3])) >>> 0;
  return Number.isNaN(n) ? null : n;
}

function isInCIDR(ip, cidr) {
  const long = ipToLong(ip);
  if (long === null) return false;
  const [net, bits] = cidr.split('/');
  const netLong = ipToLong(net);
  if (netLong === null) return false;
  const mask = bits ? (~0 << (32 - parseInt(bits))) >>> 0 : 0xFFFFFFFF;
  return (long & mask) === (netLong & mask);
}

function getClientIp(req) {
  // X-Forwarded-For: client, proxy1, proxy2 — take first
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  // X-Real-IP (nginx)
  if (req.headers['x-real-ip']) return req.headers['x-real-ip'];
  return req.ip || req.connection?.remoteAddress || '';
}

function isInternal(ip, cidrs) {
  return cidrs.some(cidr => isInCIDR(ip, cidr));
}

// ── Login rate limiter (full mode) ──────────────────────────────────

const loginAttempts = new Map(); // ip → { count, resetAt }

function checkLoginRate(ip, max) {
  if (!max) return true;
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= max;
}

// Periodic cleanup — prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.resetAt) loginAttempts.delete(ip);
  }
}, 5 * 60_000).unref();

// ── Middleware factory ───────────────────────────────────────────────

function createAccessControl() {
  const mode = (process.env.EXTERNAL_ACCESS_MODE || 'webhook_only').toLowerCase().trim();

  const internalNets = (process.env.INTERNAL_NETWORKS || '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16')
    .split(',').map(s => s.trim()).filter(Boolean);

  const allowedPaths = (process.env.EXTERNAL_ALLOWED_PATHS || '/api/webex/webhook')
    .split(',').map(s => s.trim()).filter(Boolean);

  const internalOnlyPrefixes = (process.env.INTERNAL_ONLY_PATHS || '/uploads,/api/v1')
    .split(',').map(s => s.trim()).filter(Boolean);

  const loginRateMax = parseInt(process.env.EXTERNAL_LOGIN_RATE_LIMIT || '10') || 0;

  // Paths allowed from anywhere (K8s probes, favicon)
  const ALWAYS_ALLOWED = new Set(['/api/health', '/favicon.ico']);

  console.log(`[AccessControl] mode=${mode} | internalNets=${internalNets.join(',')} | extPaths=${allowedPaths.join(',')}`);
  console.log(`[AccessControl] internalOnlyPrefixes=${internalOnlyPrefixes.join(',')}`);
  if (mode === 'full') {
    console.log(`[AccessControl] ⚠️  FULL external access | loginRateLimit=${loginRateMax}/min`);
  }

  return function accessControl(req, res, next) {
    // 1. Always allowed (health probe etc.)
    if (ALWAYS_ALLOWED.has(req.path)) return next();

    // 2. Internal IP → pass everything
    const ip = getClientIp(req);
    if (isInternal(ip, internalNets)) return next();

    // 3. Internal-only paths → block external regardless of mode
    if (internalOnlyPrefixes.some(prefix => req.path.startsWith(prefix))) {
      console.warn(`[AccessControl] blocked internal-only path from external | ip=${ip} ${req.method} ${req.path}`);
      return res.status(403).json({ error: 'Access denied' });
    }

    // 4. Mode-specific logic
    switch (mode) {
      case 'full':
        // Login brute-force protection
        if (req.path === '/api/auth/login' && req.method === 'POST') {
          if (!checkLoginRate(ip, loginRateMax)) {
            console.warn(`[AccessControl] login rate limit hit | ip=${ip}`);
            return res.status(429).json({ error: 'Too many login attempts, try again later' });
          }
        }
        return next();

      case 'webhook_only':
        if (req.method === 'POST' && allowedPaths.some(p => req.path === p)) {
          return next();
        }
        console.warn(`[AccessControl] blocked external | ip=${ip} ${req.method} ${req.path}`);
        return res.status(403).json({ error: 'Access denied' });

      case 'internal_only':
      default:
        console.warn(`[AccessControl] blocked external | ip=${ip} ${req.method} ${req.path}`);
        return res.status(403).json({ error: 'Access denied' });
    }
  };
}

module.exports = { createAccessControl, getClientIp, isInCIDR };
