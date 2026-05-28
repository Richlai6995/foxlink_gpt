/**
 * External Access Control Middleware
 *
 * Env:
 *   EXTERNAL_ACCESS_MODE    = internal_only | webhook_only | full
 *   INTERNAL_NETWORKS       = CIDR list (comma-separated)
 *   EXTERNAL_ALLOWED_PATHS  = paths allowed in webhook_only mode (comma-separated)
 *   EXTERNAL_ALLOWED_IPS    = 試營運外網白名單 CIDR/IP(逗號分隔,bare IP 視為 /32)。
 *                             命中此清單的外網 IP 走 full mode 行為(仍受 blacklist / UA /
 *                             internal-only paths / login rate limit 約束),其他外網照原 mode。
 *                             用途:準備開外網時只放自己進來測,等於是「窄門 full」。
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
  // 2026-05-28:架構改成 client → Akamai(WAF)→ nginx-ingress → pod 後,
  //   TRUST_PROXY=1 讓 req.ip = Akamai edge IP(只信任 nginx 1 跳)。
  //   Akamai edge 後面 N 個 user 共用同 IP → 一個 user 失敗 10 次 → 整個 edge 進黑名單 →
  //   全公司外網 user 中槍。
  //
  // 正確做法:Akamai 在 True-Client-IP header 帶 user 真實 IP(他們的標準 header),
  //   只信任「請求是經 Akamai 過來」的時候 — 否則 client 自己偽造 header 就能假裝。
  //
  // 「經 Akamai 過來」的判定:req.ip(即 trust-proxy 解析後的 source)落在 Akamai
  //   IP 段 / 或 True-Client-IP header 存在。後者較簡單:只要 req.ip 是公網 IP
  //   (非 internal CIDR) 且帶 True-Client-IP,就視為 Akamai forwarded。
  //   攻擊者直接打 nginx-ingress(繞 Akamai)沒有 True-Client-IP,走原本邏輯。
  //
  // 多個 header 名稱備援:Akamai=True-Client-IP, Cloudflare=CF-Connecting-IP。
  //
  // ⚠️ 不能用 X-Real-IP — 那是 nginx-ingress 自己寫的「nginx 看到的 source IP」,
  //    當 Akamai 過來時 = Akamai edge IP,不是 user 真實 IP,用了等於沒改。
  //
  // True-Client-IP 需 Akamai 後台「Forward True Client IP」開啟才會送來;
  // CF-Connecting-IP 是 Cloudflare 自動帶。沒開的話 fallback 到 req.ip(Akamai
  // edge),退回原本行為,但會在 5 分鐘節流的 warn 提醒 ops。
  const trueClient = req.headers['true-client-ip']
    || req.headers['cf-connecting-ip'];
  if (trueClient && typeof trueClient === 'string') {
    const first = trueClient.split(',')[0].trim();
    if (first) return first;
  }
  return req.ip || req.connection?.remoteAddress || '';
}

function isLoopback(ip) {
  const v4 = ip.replace(/^::ffff:/, '');
  return ip === '::1' || v4 === '127.0.0.1' || v4.startsWith('127.');
}

function isInternal(ip, cidrs) {
  if (isLoopback(ip)) return true;
  return cidrs.some(cidr => isInCIDR(ip, cidr));
}

// ── Login rate limiter (full mode) — Redis-backed,跨 pod 共享 ────────
// 改用 redisClient.incrSharedValue(2026-05-09)。原本用 module-level Map,
// K8s 多 pod 部署下 N pods × max/分鐘 = 攻擊者實際得到 N×max,失去 rate limit 意義。
// Redis 模式下 SET 第一次寫入時設 60s TTL,後續 INCR 不重設,精確 sliding-window。
// fail-open:Redis 出錯時放行 + warn(避免 Redis 抖動把全公司擋外)。
let _redis = null;
const getRedis = () => _redis || (_redis = require('../services/redisClient'));

async function checkLoginRate(ip, max) {
  if (!max) return true;
  try {
    const n = await getRedis().incrSharedValue(`auth:rate:login:${ip}`, 60);
    return n <= max;
  } catch (e) {
    console.warn(`[AccessControl] login rate check failed (allow): ${e.message}`);
    return true;  // fail-open
  }
}

// ── Middleware factory ───────────────────────────────────────────────

function createAccessControl() {
  const mode = (process.env.EXTERNAL_ACCESS_MODE || 'webhook_only').toLowerCase().trim();

  const internalNets = (process.env.INTERNAL_NETWORKS || '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16')
    .split(',').map(s => s.trim()).filter(Boolean);

  const allowedPaths = (process.env.EXTERNAL_ALLOWED_PATHS || '/api/webex/webhook')
    .split(',').map(s => s.trim()).filter(Boolean);

  // 試營運白名單:bare IP 補 /32,其餘原樣當 CIDR
  const externalAllowedIps = (process.env.EXTERNAL_ALLOWED_IPS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map(s => s.includes('/') ? s : `${s}/32`);

  // ?? 而非 ||:讓 ops 可以用 INTERNAL_ONLY_PATHS=(空字串)明確清空清單,把 /uploads /api/v1 也對外開。
  // 用 || 會把空字串當 falsy 退回預設值,等於沒法關。
  const internalOnlyPrefixes = (process.env.INTERNAL_ONLY_PATHS ?? '/uploads,/api/v1')
    .split(',').map(s => s.trim()).filter(Boolean);

  const loginRateMax = parseInt(process.env.EXTERNAL_LOGIN_RATE_LIMIT || '10') || 0;

  // Paths allowed from anywhere (K8s probes, favicon, SPA entry files)
  // 2026-05-28:加入 SPA static entry — 若黑名單擋掉 user,API 仍會擋但至少
  // 拿得到 HTML/JS 進到登入頁,避免「整頁全白」事故(Akamai edge IP 被當 client
  // IP 連坐黑名單 → 全公司外網無法用)。SPA 是純 static,不含 user data,洩漏風險 0。
  const ALWAYS_ALLOWED = new Set([
    '/api/health',
    '/favicon.ico',
    '/',                    // SPA root
    '/index.html',
    '/manifest.json',
    '/manifest.webmanifest',
    '/robots.txt',
    '/sitemap.xml',
  ]);
  // 路徑前綴白名單(SPA bundle + 公開靜態檔)
  const ALWAYS_ALLOWED_PREFIXES = [
    '/assets/',             // Vite build 產物(JS/CSS/font/image)
    '/static/',
    '/icons/',
    '/images/',
    '/fonts/',
    '/locales/',            // i18n JSON
  ];

  console.log(`[AccessControl] mode=${mode} | internalNets=${internalNets.join(',')} | extPaths=${allowedPaths.join(',')}`);
  console.log(`[AccessControl] internalOnlyPrefixes=${internalOnlyPrefixes.join(',')}`);
  if (externalAllowedIps.length) {
    console.log(`[AccessControl] ⚠️  EXTERNAL ALLOWLIST active | ips=${externalAllowedIps.join(',')} (treated as full-mode)`);
  }
  if (mode === 'full') {
    console.log(`[AccessControl] ⚠️  FULL external access | loginRateLimit=${loginRateMax}/min`);
  }

  // Lazy require to avoid circular dependency on startup ordering
  let _ipBlacklist = null;
  const getBlacklist = () => _ipBlacklist || (_ipBlacklist = require('../services/ipBlacklist'));

  return async function accessControl(req, res, next) {
    // 1. Always allowed (health probe, SPA static entry)
    //    SPA HTML/JS/CSS 跳過所有 access control,讓黑名單 / 限流不會把整頁打白
    if (ALWAYS_ALLOWED.has(req.path)) return next();
    if (ALWAYS_ALLOWED_PREFIXES.some((p) => req.path.startsWith(p))) return next();

    // 2. Internal IP → pass everything(blacklist 不對內網生效,防誤殺)
    const ip = getClientIp(req);
    if (isInternal(ip, internalNets)) return next();

    // 3. 外網 IP — 黑名單檢查(走 Redis cache,正常 case <1ms)
    try {
      if (await getBlacklist().isBlacklisted(ip)) {
        console.warn(`[AccessControl] blocked blacklisted ip | ip=${ip} ${req.method} ${req.path}`);
        return res.status(403).json({ error: 'Access denied' });
      }
    } catch (e) {
      // Redis / DB 異常時保守放行(避免 service 整個掛掉),只 log
      console.warn(`[AccessControl] blacklist check failed (allow): ${e.message}`);
    }

    // 4. UA 黑名單檢查(明確的攻擊工具)— 命中即加入 IP 黑名單(7 天)+ 拒絕
    const ua = req.headers['user-agent'] || '';
    const uaHit = getBlacklist().matchUaBlacklist(ua);
    if (uaHit) {
      console.warn(`[AccessControl] UA blacklist hit | ip=${ip} ua="${ua.slice(0, 100)}" pattern=${uaHit}`);
      const ttlHours = (getBlacklist().cfg().autoUaBlockDays) * 24;
      getBlacklist().addAsync({
        ip,
        reason: `auto: UA matched ${uaHit} ("${ua.slice(0, 200)}")`,
        source: 'auto_ua',
        ttlHours,
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    // 5. Internal-only paths → block external regardless of mode
    if (internalOnlyPrefixes.some(prefix => req.path.startsWith(prefix))) {
      console.warn(`[AccessControl] blocked internal-only path from external | ip=${ip} ${req.method} ${req.path}`);
      return res.status(403).json({ error: 'Access denied' });
    }

    // 5.5 EXTERNAL_ALLOWED_IPS — 試營運白名單,命中即走 full mode 行為(仍套 login rate limit)。
    //     注意:這裡 IP 仍當外網對待(MFA、isRequestInternal=false 都照舊),不會跳過 MFA。
    if (externalAllowedIps.length && externalAllowedIps.some(cidr => isInCIDR(ip, cidr))) {
      if (req.path === '/api/auth/login' && req.method === 'POST') {
        if (!(await checkLoginRate(ip, loginRateMax))) {
          console.warn(`[AccessControl] login rate limit hit (allowlisted) | ip=${ip}`);
          return res.status(429).json({ error: 'Too many login attempts, try again later' });
        }
      }
      return next();
    }

    // 6. Mode-specific logic
    switch (mode) {
      case 'full':
        // Login brute-force protection
        if (req.path === '/api/auth/login' && req.method === 'POST') {
          if (!(await checkLoginRate(ip, loginRateMax))) {
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

/**
 * 給 auth route 共用的內網判斷。讀同一個 INTERNAL_NETWORKS env,
 * 跟 access control middleware 結果一致(避免 MFA 跟 access control 標準分歧)。
 */
let _cachedNets = null;
function _getNets() {
  if (_cachedNets) return _cachedNets;
  _cachedNets = (process.env.INTERNAL_NETWORKS || '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16')
    .split(',').map(s => s.trim()).filter(Boolean);
  return _cachedNets;
}
function isRequestInternal(req) {
  return isInternal(getClientIp(req), _getNets());
}

// 不需 req,直接判斷一個 IP 字串是否落在內網 CIDR(用既有 cache 不重複 parse env)。
// 給 admin UI 標記黑名單筆每筆是內網/外網用,以及 throttle 跳過內網自動黑名單。
function isIpInternal(ip) {
  if (!ip || typeof ip !== 'string') return false;
  return isInternal(ip, _getNets());
}

module.exports = { createAccessControl, getClientIp, isInCIDR, isInternal, isRequestInternal, isIpInternal };
