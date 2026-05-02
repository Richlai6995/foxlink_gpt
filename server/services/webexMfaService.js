'use strict';

/**
 * Webex MFA Service — 外網登入二階段驗證(OOB OTP via Webex DM)
 *
 * 流程:
 *   1. createChallenge(userId, email, ip, ua) → 產 OTP + 寫 redis(5min TTL)
 *   2. sendOtpToUser(user, otp, ip, lang)     → Webex Bot DM(失敗 throw)
 *   3. verifyChallenge(challengeId, code)     → 比對 OTP,通過刪 redis
 *   4. addTrustedIp(db, userId, ip, ua)       → MFA 通過後寫 user_trusted_ips
 *   5. isTrustedIp(db, userId, ip)            → 後續登入查信任 IP 跳過 MFA
 *
 * Redis keys:
 *   2fa:challenge:{uuid}  → JSON { user_id, otp, attempts, ip, ua, last_sent_at }
 *   2fa:resend:{uuid}     → "1"  (60s cooldown 標記)
 *   2fa:rate:user:{uid}   → JSON { count, reset_at }  (1 hour 上限)
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const redisClient = require('./redisClient');
const { getWebexService } = require('./webexService');

// ── Config(env 可覆寫)─────────────────────────────────────────────────
const cfg = () => ({
  enabled:           process.env.MFA_ENABLED === 'true',
  trustedIpTtlDays:  parseInt(process.env.MFA_TRUSTED_IP_TTL_DAYS || '7', 10),
  otpTtlSeconds:     parseInt(process.env.MFA_OTP_TTL_SECONDS || '300', 10),
  resendCooldownSec: parseInt(process.env.MFA_RESEND_COOLDOWN_SECONDS || '60', 10),
  maxVerifyAttempts: parseInt(process.env.MFA_MAX_VERIFY_ATTEMPTS || '5', 10),
  dmTimeoutMs:       parseInt(process.env.MFA_DM_TIMEOUT_MS || '8000', 10),
  ratePerUserPerHr:  parseInt(process.env.MFA_RATE_LIMIT_PER_USER_PER_HOUR || '20', 10),
});

const KEY_CHAL    = (id)  => `2fa:challenge:${id}`;
const KEY_RESEND  = (id)  => `2fa:resend:${id}`;
const KEY_RATE    = (uid) => `2fa:rate:user:${uid}`;

// ── Utilities ──────────────────────────────────────────────────────────

/** 產 6 位 OTP — crypto.randomInt 不用 Math.random */
function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Mask email for UI — `r***@foxlink.com` */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  if (local.length <= 1) return `${local}***@${domain}`;
  return `${local[0]}***@${domain}`;
}

/** Timing-safe OTP 比對 */
function safeOtpEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** 6 位數字驗證 */
function isValidOtpFormat(code) {
  return typeof code === 'string' && /^\d{6}$/.test(code);
}

/** uuid v4 格式驗證 */
function isValidChallengeId(id) {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** 給使用者看的 incident id(challenge_id 後 8 碼)— DM 失敗時提示給管理員比對 log */
function shortIncidentId(challengeId) {
  return (challengeId || '').replace(/-/g, '').slice(-8).toUpperCase();
}

// ── DM messages(三語)─────────────────────────────────────────────────

const DM_TEMPLATES = {
  'zh-TW': ({ otp, ip }) => [
    '🔐 **Cortex 登入驗證**',
    '',
    `驗證碼:**${otp}**(5 分鐘內有效)`,
    '',
    `來源 IP:\`${ip || 'unknown'}\``,
    '若非本人操作,請忽略此訊息並聯絡資安。',
  ].join('\n'),

  'en': ({ otp, ip }) => [
    '🔐 **Cortex Login Verification**',
    '',
    `Code: **${otp}** (valid for 5 minutes)`,
    '',
    `Source IP: \`${ip || 'unknown'}\``,
    'If this was not you, please ignore and contact IT security.',
  ].join('\n'),

  'vi': ({ otp, ip }) => [
    '🔐 **Xác thực đăng nhập Cortex**',
    '',
    `Mã: **${otp}** (có hiệu lực 5 phút)`,
    '',
    `IP nguồn: \`${ip || 'unknown'}\``,
    'Nếu không phải bạn thực hiện, vui lòng bỏ qua và liên hệ bộ phận bảo mật CNTT.',
  ].join('\n'),
};

const NEW_LOGIN_TEMPLATES = {
  'zh-TW': ({ ip, ua, when }) => [
    '🔔 **Cortex 新位置登入提醒**',
    '',
    `您的帳號剛從新 IP 登入:`,
    `- 時間:${when}`,
    `- IP:\`${ip || 'unknown'}\``,
    `- 裝置:${ua || 'unknown'}`,
    '',
    '若非本人操作,請立即:',
    '1. 變更密碼',
    '2. 聯絡資安通報',
  ].join('\n'),

  'en': ({ ip, ua, when }) => [
    '🔔 **Cortex New Location Login**',
    '',
    'Your account just logged in from a new IP:',
    `- Time: ${when}`,
    `- IP: \`${ip || 'unknown'}\``,
    `- Device: ${ua || 'unknown'}`,
    '',
    'If this was not you, immediately:',
    '1. Change your password',
    '2. Contact IT security',
  ].join('\n'),

  'vi': ({ ip, ua, when }) => [
    '🔔 **Đăng nhập Cortex từ vị trí mới**',
    '',
    'Tài khoản của bạn vừa đăng nhập từ IP mới:',
    `- Thời gian: ${when}`,
    `- IP: \`${ip || 'unknown'}\``,
    `- Thiết bị: ${ua || 'unknown'}`,
    '',
    'Nếu không phải bạn, vui lòng:',
    '1. Đổi mật khẩu ngay',
    '2. Liên hệ bộ phận bảo mật CNTT',
  ].join('\n'),
};

function buildDmMarkdown({ otp, ip, lang }) {
  const tpl = DM_TEMPLATES[lang] || DM_TEMPLATES['zh-TW'];
  return tpl({ otp, ip });
}

function buildNewLoginAlertMarkdown({ ip, ua, lang, when }) {
  const tpl = NEW_LOGIN_TEMPLATES[lang] || NEW_LOGIN_TEMPLATES['zh-TW'];
  // UA 太長截斷
  const uaShort = ua ? ua.slice(0, 100) + (ua.length > 100 ? '...' : '') : '';
  return tpl({ ip, ua: uaShort, when });
}

// ── Rate limit per user per hour ───────────────────────────────────────

async function checkAndBumpRate(userId) {
  const c = cfg();
  if (c.ratePerUserPerHr <= 0) return true;
  const key = KEY_RATE(userId);
  const raw = await redisClient.getSharedValue(key);
  const now = Date.now();
  let entry = null;
  if (raw) {
    try { entry = JSON.parse(raw); } catch { entry = null; }
  }
  if (!entry || now > entry.reset_at) {
    entry = { count: 1, reset_at: now + 3600_000 };
    await redisClient.setSharedValue(key, JSON.stringify(entry), 3600);
    return true;
  }
  if (entry.count >= c.ratePerUserPerHr) return false;
  entry.count++;
  const remainSec = Math.max(60, Math.ceil((entry.reset_at - now) / 1000));
  await redisClient.setSharedValue(key, JSON.stringify(entry), remainSec);
  return true;
}

// ── Challenge CRUD ─────────────────────────────────────────────────────

async function readChallenge(challengeId) {
  if (!isValidChallengeId(challengeId)) return null;
  const raw = await redisClient.getSharedValue(KEY_CHAL(challengeId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function writeChallenge(challengeId, data) {
  await redisClient.setSharedValue(
    KEY_CHAL(challengeId),
    JSON.stringify(data),
    cfg().otpTtlSeconds
  );
}

async function deleteChallenge(challengeId) {
  // redisClient 沒有直接 del shared,用 getStore().del
  try {
    const s = redisClient.getStore();
    await s.del(KEY_CHAL(challengeId));
  } catch (_) {}
}

/**
 * 建立 challenge → 寫 redis(此函式不發 DM,呼叫端拿 otp 自行送)
 * @returns {{challengeId, otp, masked} | null} — null 表 rate limit
 */
async function createChallenge({ userId, email, ip, userAgent }) {
  const ok = await checkAndBumpRate(userId);
  if (!ok) return { rateLimited: true };

  const challengeId = uuidv4();
  const otp = generateOtp();
  await writeChallenge(challengeId, {
    user_id: userId,
    otp,
    attempts: 0,
    ip: ip || null,
    user_agent: userAgent || null,
    last_sent_at: Date.now(),
  });
  return {
    challengeId,
    otp,
    masked: maskEmail(email),
    incidentId: shortIncidentId(challengeId),
  };
}

/**
 * Verify OTP — attempt++,過 max 直接刷掉 challenge
 * @returns {{ ok: true, userId, ip, ua } | { ok: false, reason }}
 *   reason: 'invalid_format' | 'not_found' | 'wrong_code' | 'too_many'
 */
async function verifyChallenge(challengeId, code) {
  if (!isValidChallengeId(challengeId)) return { ok: false, reason: 'invalid_format' };
  if (!isValidOtpFormat(code)) return { ok: false, reason: 'invalid_format' };

  const ch = await readChallenge(challengeId);
  if (!ch) return { ok: false, reason: 'not_found' };

  if (safeOtpEquals(ch.otp, code)) {
    await deleteChallenge(challengeId);
    return { ok: true, userId: ch.user_id, ip: ch.ip, userAgent: ch.user_agent };
  }

  const attempts = (ch.attempts || 0) + 1;
  if (attempts >= cfg().maxVerifyAttempts) {
    await deleteChallenge(challengeId);
    return { ok: false, reason: 'too_many' };
  }
  ch.attempts = attempts;
  await writeChallenge(challengeId, ch);
  return { ok: false, reason: 'wrong_code', attemptsLeft: cfg().maxVerifyAttempts - attempts };
}

/**
 * Resend — 60s cooldown,**重產 OTP** 並覆蓋舊的(舊碼立即失效)
 * @returns {{ ok: true, otp } | { ok: false, reason, retryInSec? }}
 */
async function regenerateChallengeOtp(challengeId) {
  if (!isValidChallengeId(challengeId)) return { ok: false, reason: 'invalid_format' };

  // cooldown 檢查
  const cdKey = KEY_RESEND(challengeId);
  const inCooldown = await redisClient.getSharedValue(cdKey);
  if (inCooldown) {
    return { ok: false, reason: 'cooldown', retryInSec: cfg().resendCooldownSec };
  }

  const ch = await readChallenge(challengeId);
  if (!ch) return { ok: false, reason: 'not_found' };

  // rate limit per user
  const ok = await checkAndBumpRate(ch.user_id);
  if (!ok) return { ok: false, reason: 'rate_limited' };

  const newOtp = generateOtp();
  ch.otp = newOtp;
  ch.attempts = 0;
  ch.last_sent_at = Date.now();
  await writeChallenge(challengeId, ch);
  await redisClient.setSharedValue(cdKey, '1', cfg().resendCooldownSec);

  return { ok: true, otp: newOtp, userId: ch.user_id, ip: ch.ip };
}

// ── Webex DM 發送 ─────────────────────────────────────────────────────

/**
 * 發 OTP DM 給使用者。失敗 throw — 呼叫端要 catch 後給使用者 hard error。
 * Webex API 會自動建立 1:1 room,不需預先建。
 * timeout 套 MFA_DM_TIMEOUT_MS(預設 8s),避免使用者乾等 axios 預設 30s。
 */
async function sendOtpDM({ email, otp, ip, lang }) {
  const markdown = buildDmMarkdown({ otp, ip, lang });
  const webex = getWebexService();
  const msgId = await webex.sendDirectMessage(email, markdown, {
    timeout: cfg().dmTimeoutMs,
  });
  if (!msgId) {
    throw new Error('Webex DM send failed (returned null)');
  }
  return msgId;
}

/**
 * 異常登入通知:user 從新 IP 成功 MFA 後,DM 提醒使用者。
 * 失敗只 console.warn,不影響 login 流程(non-critical)。
 */
async function sendNewLoginAlertDM({ email, ip, ua, lang }) {
  if (!email) return;
  const when = new Date().toLocaleString('zh-TW', { hour12: false });
  const markdown = buildNewLoginAlertMarkdown({ ip, ua, lang, when });
  const webex = getWebexService();
  try {
    await webex.sendDirectMessage(email, markdown, { timeout: cfg().dmTimeoutMs });
  } catch (e) {
    console.warn(`[MFA] new-login-alert DM failed for ${email}: ${e.message}`);
  }
}

// ── Trusted IP CRUD ────────────────────────────────────────────────────

/** /32 嚴格匹配 — IP 一變即重 MFA */
async function isTrustedIp(db, userId, ip) {
  if (cfg().trustedIpTtlDays <= 0) return false;
  if (!userId || !ip) return false;
  const row = await db.prepare(
    `SELECT id FROM user_trusted_ips
     WHERE user_id=? AND ip=? AND expires_at > SYSTIMESTAMP
     FETCH FIRST 1 ROWS ONLY`
  ).get(userId, ip);
  return !!row;
}

/** 更新 last_seen + 延長 expires_at */
async function touchTrustedIp(db, userId, ip) {
  const ttlDays = cfg().trustedIpTtlDays;
  if (ttlDays <= 0) return;
  await db.prepare(
    `UPDATE user_trusted_ips
     SET last_seen=SYSTIMESTAMP,
         expires_at=SYSTIMESTAMP + NUMTODSINTERVAL(?, 'DAY')
     WHERE user_id=? AND ip=?`
  ).run(ttlDays, userId, ip);
}

/** Upsert — MFA 通過後寫入(同 user+ip 已存在則更新 expires_at) */
async function addTrustedIp(db, userId, ip, ua) {
  const ttlDays = cfg().trustedIpTtlDays;
  if (ttlDays <= 0) return;
  if (!userId || !ip) return;
  const existing = await db.prepare(
    `SELECT id FROM user_trusted_ips WHERE user_id=? AND ip=?`
  ).get(userId, ip);
  if (existing) {
    await touchTrustedIp(db, userId, ip);
  } else {
    await db.prepare(
      `INSERT INTO user_trusted_ips (user_id, ip, user_agent, expires_at)
       VALUES (?, ?, ?, SYSTIMESTAMP + NUMTODSINTERVAL(?, 'DAY'))`
    ).run(userId, ip, (ua || '').slice(0, 512), ttlDays);
  }
}

/** 改密碼 / reset / 停用 帳號時呼叫,清光該 user 所有 trusted IPs */
async function revokeAllTrustedIps(db, userId) {
  if (!userId) return 0;
  const r = await db.prepare(`DELETE FROM user_trusted_ips WHERE user_id=?`).run(userId);
  return r.changes || 0;
}

// ── Webex Person ID cache 在 users 表 ──────────────────────────────────

/**
 * 確認 user 在 Webex 真的有 person。已快取就 reuse。
 * @returns {string|null} personId(查不到回 null)
 */
async function ensureWebexPerson(db, user) {
  if (user.webex_person_id) return user.webex_person_id;
  if (!user.email) return null;
  const webex = getWebexService();
  const person = await webex.findPersonByEmail(user.email);
  if (!person) return null;
  try {
    await db.prepare(`UPDATE users SET webex_person_id=? WHERE id=?`).run(person.id, user.id);
  } catch (e) {
    console.warn(`[MFA] cache webex_person_id failed: ${e.message}`);
  }
  return person.id;
}

module.exports = {
  cfg,
  generateOtp,
  maskEmail,
  shortIncidentId,
  isValidChallengeId,
  isValidOtpFormat,
  buildDmMarkdown,

  createChallenge,
  verifyChallenge,
  regenerateChallengeOtp,
  sendOtpDM,
  sendNewLoginAlertDM,

  isTrustedIp,
  addTrustedIp,
  touchTrustedIp,
  revokeAllTrustedIps,

  ensureWebexPerson,
};
