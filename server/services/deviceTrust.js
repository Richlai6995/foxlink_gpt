'use strict';

/**
 * Device Trust — 改善 Trusted IP 機制的 UX 痛點
 *
 * 過去機制(/32 嚴格 IP 綁):
 *   外網過 MFA 後 7 天免重認,但 IP 一變(換網路 / 重撥 / 出差)立刻要重 OTP。
 *   使用者一天從多個地點登入會被多次挑戰 OTP。
 *
 * 新機制(device-bound):
 *   過 MFA 後簽一個 httpOnly + signed cookie 給 client(裡面是 device_id UUID),
 *   server 端 user_trusted_devices 表存 (user_id, device_id, ...)。
 *   後續登入只要 cookie 對得上(且未過期、user_id 一致)就免 MFA,IP 變不變都可以。
 *
 * 安全考量:
 *   - Cookie:HttpOnly + Secure(生產)+ SameSite=Lax + HMAC 簽章。JS 偷不到、跨站偷不到、無法偽造
 *   - IP 變化仍記錄(last_seen_ip),且新 IP 通過時繼續走「異常登入 DM 通知」邏輯,使用者可即時反應
 *   - 改密碼 / reset 自動清空所有 trusted devices(沿用 trusted IP 同樣 hook)
 *   - Phase B 預留 fingerprint_hash / fingerprint_json 欄位,加 fingerprint 漂移判斷後可進一步擋
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const COOKIE_NAME = 'flgpt_did';

const cfg = () => ({
  ttlDays:    parseInt(process.env.MFA_DEVICE_TRUST_TTL_DAYS || '30', 10),
  // 簽章 secret:優先用 DEVICE_COOKIE_SECRET,否則 fallback JWT_SECRET 衍生
  secret:     process.env.DEVICE_COOKIE_SECRET
              || crypto.createHash('sha256').update(process.env.JWT_SECRET || 'fallback-secret').digest('hex'),
  // 預設 production 才 secure(http localhost dev 不送)— 可用 env 強制覆寫
  forceSecure: process.env.DEVICE_COOKIE_SECURE === 'true',
  forceInsecure: process.env.DEVICE_COOKIE_SECURE === 'false',
});

// ── HMAC 簽章 ─────────────────────────────────────────────────────────────

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function buildCookieValue(deviceId, secret) {
  return `${deviceId}.${sign(deviceId, secret)}`;
}

function parseCookieValue(value, secret) {
  if (typeof value !== 'string' || !value.includes('.')) return null;
  const idx = value.lastIndexOf('.');
  const deviceId = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  if (!/^[0-9a-f-]{36}$/i.test(deviceId)) return null;
  const expected = sign(deviceId, secret);
  // timing-safe
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  return deviceId;
}

// ── Cookie 讀取 / 寫入 ────────────────────────────────────────────────────

/** 從 req.headers.cookie 抓 device_id(自帶 parser,不依賴 cookie-parser) */
function readDeviceIdFromRequest(req) {
  const raw = req.headers && req.headers.cookie;
  if (!raw || typeof raw !== 'string') return null;
  // 簡單 cookie 字串切片:不處理 quoted-string(我們的 value 沒空白)
  const parts = raw.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== COOKIE_NAME) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    return parseCookieValue(value, cfg().secret);
  }
  return null;
}

/** Set device cookie(在 createSession / verify 通過時呼用) */
function setDeviceCookie(res, req, deviceId) {
  const c = cfg();
  const value = buildCookieValue(deviceId, c.secret);
  // Secure 判斷:env 強制覆寫優先,否則看 req protocol
  let secure;
  if (c.forceSecure) secure = true;
  else if (c.forceInsecure) secure = false;
  else secure = !!(req && (req.secure || req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https'));

  // SameSite=Lax 支援同站 navigation,但 cross-site post 會被擋(防 CSRF)
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${c.ttlDays * 24 * 3600}`,
  ];
  if (secure) attrs.push('Secure');
  // append(不覆蓋既有 Set-Cookie,例如 i18n cookie)
  const prev = res.getHeader('Set-Cookie');
  const newHeader = attrs.join('; ');
  if (Array.isArray(prev)) {
    res.setHeader('Set-Cookie', [...prev, newHeader]);
  } else if (prev) {
    res.setHeader('Set-Cookie', [prev, newHeader]);
  } else {
    res.setHeader('Set-Cookie', newHeader);
  }
}

/** 清除 device cookie(過期 + 空值) */
function clearDeviceCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

// ── 推測 device label(讓 user UI 看得懂)──────────────────────────────

function guessDeviceLabel(ua) {
  if (!ua) return 'Unknown device';
  const s = ua;
  let browser = 'Browser';
  if (/Edg\//.test(s)) browser = 'Edge';
  else if (/Chrome\//.test(s) && !/Edg\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s) && !/Chrome\//.test(s)) browser = 'Safari';
  else if (/Firefox\//.test(s)) browser = 'Firefox';
  let os = '';
  if (/Windows NT/.test(s)) os = 'Windows';
  else if (/Mac OS X/.test(s) && !/Mobile/.test(s)) os = 'macOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/iPhone|iPad/.test(s)) os = 'iOS';
  else if (/Linux/.test(s)) os = 'Linux';
  return os ? `${browser} on ${os}` : browser;
}

// ── DB CRUD ────────────────────────────────────────────────────────────

/** 簽發新 device(MFA verify 通過時呼用) */
async function issueDevice(db, { userId, ip, userAgent }) {
  const ttlDays = cfg().ttlDays;
  if (ttlDays <= 0 || !userId) return null;
  const deviceId = uuidv4();
  const label = guessDeviceLabel(userAgent || '');
  await db.prepare(
    `INSERT INTO user_trusted_devices
     (user_id, device_id, device_label, created_via_ip, last_seen_ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, SYSTIMESTAMP + NUMTODSINTERVAL(?, 'DAY'))`
  ).run(
    userId,
    deviceId,
    label.slice(0, 200),
    ip || null,
    ip || null,
    (userAgent || '').slice(0, 512),
    ttlDays
  );
  return deviceId;
}

/**
 * 驗證 device cookie 並回傳對應紀錄(未過期、user_id 對得上)。
 * 沒驗到 → null。順帶把 last_seen_ip / last_seen_at 更新 + sliding TTL 延長。
 */
async function verifyAndTouch(db, { req, expectUserId }) {
  const deviceId = readDeviceIdFromRequest(req);
  if (!deviceId) return null;
  const row = await db.prepare(
    `SELECT id, user_id, device_id, device_label, last_seen_ip, expires_at
     FROM user_trusted_devices
     WHERE device_id = ? AND expires_at > SYSTIMESTAMP
     FETCH FIRST 1 ROWS ONLY`
  ).get(deviceId);
  if (!row) return null;
  if (expectUserId != null && Number(row.user_id) !== Number(expectUserId)) return null;

  // 更新 last_seen + sliding TTL 延長(每次成功使用就刷新 30 天)
  const ttlDays = cfg().ttlDays;
  const ip = require('../middleware/accessControl').getClientIp(req);
  const ua = (req.headers['user-agent'] || '').slice(0, 512);
  try {
    await db.prepare(
      `UPDATE user_trusted_devices
       SET last_seen_at = SYSTIMESTAMP,
           last_seen_ip = ?,
           user_agent   = ?,
           expires_at   = SYSTIMESTAMP + NUMTODSINTERVAL(?, 'DAY')
       WHERE id = ?`
    ).run(ip || row.last_seen_ip || null, ua, ttlDays, row.id);
  } catch (e) {
    console.warn(`[DeviceTrust] touch failed: ${e.message}`);
  }
  return row;
}

/** List user 的所有 active devices(自助頁 + admin UI 用) */
async function listForUser(db, userId, { activeOnly = true } = {}) {
  let sql = `SELECT id, user_id, device_id, device_label, created_via_ip, last_seen_ip,
                    user_agent, created_at, last_seen_at, expires_at
             FROM user_trusted_devices
             WHERE user_id = ?`;
  if (activeOnly) sql += ` AND expires_at > SYSTIMESTAMP`;
  sql += ` ORDER BY last_seen_at DESC`;
  return db.prepare(sql).all(userId);
}

async function revokeDevice(db, userId, deviceId) {
  if (!userId || !deviceId) return 0;
  const r = await db.prepare(
    `DELETE FROM user_trusted_devices WHERE user_id = ? AND device_id = ?`
  ).run(userId, deviceId);
  return r.changes || 0;
}

async function revokeAllForUser(db, userId) {
  if (!userId) return 0;
  const r = await db.prepare(
    `DELETE FROM user_trusted_devices WHERE user_id = ?`
  ).run(userId);
  return r.changes || 0;
}

module.exports = {
  COOKIE_NAME,
  cfg,
  guessDeviceLabel,

  setDeviceCookie,
  clearDeviceCookie,
  readDeviceIdFromRequest,

  issueDevice,
  verifyAndTouch,
  listForUser,
  revokeDevice,
  revokeAllForUser,
};
