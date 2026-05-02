'use strict';

/**
 * Auth throttle / alert — 認證流量控制與告警
 *
 * 1. countAuthFailure       — 寫入失敗 → INCR Redis counter,達閾值寄 admin 信
 * 2. checkForgotPasswordRate — forgot-password 同 IP / username rate limit
 * 3. isNewLoginIp           — 判斷是否為新 IP(用於異常登入 DM 通知)
 *
 * Redis keys:
 *   auth:fail:user:{userId}  TTL 3600  — 同 user 1 小時失敗計數
 *   auth:fail:ip:{ip}        TTL 3600  — 同 IP 1 小時失敗計數
 *   auth:alerted:user:{uid}  TTL 3600  — 已寄信旗標,防同 user 1 小時內重複寄
 *   auth:alerted:ip:{ip}     TTL 3600  — 同上(per IP)
 *   auth:forgot:ip:{ip}      TTL 3600  — forgot-password per IP 計數
 *   auth:forgot:user:{u}     TTL 3600  — forgot-password per username 計數
 */

const redisClient = require('./redisClient');

const cfg = () => ({
  failAlertPerUser:    parseInt(process.env.AUTH_FAIL_ALERT_PER_USER || '5', 10),
  failAlertPerIp:      parseInt(process.env.AUTH_FAIL_ALERT_PER_IP || '10', 10),
  forgotPwdRate:       parseInt(process.env.FORGOT_PASSWORD_RATE_LIMIT || '3', 10),
  alertWindowSec:      3600,  // 1 hr — 計數 + 已寄信旗標 TTL 都是這個
});

// ── Redis INCR-ish helper(redisClient.getSharedValue/setSharedValue 沒 incr,自己模擬) ──
async function bumpCounter(key, ttlSec) {
  const raw = await redisClient.getSharedValue(key);
  const n = (parseInt(raw || '0', 10) || 0) + 1;
  await redisClient.setSharedValue(key, String(n), ttlSec);
  return n;
}

async function getCounter(key) {
  const raw = await redisClient.getSharedValue(key);
  return parseInt(raw || '0', 10) || 0;
}

async function setFlag(key, ttlSec) {
  await redisClient.setSharedValue(key, '1', ttlSec);
}

async function hasFlag(key) {
  const raw = await redisClient.getSharedValue(key);
  return !!raw;
}

// ── 失敗 alert ───────────────────────────────────────────────────────

/**
 * 登入 / MFA 失敗時呼叫。INCR Redis counter,達閾值寄 admin 信(同 user/ip 1 hr 防重)。
 * Fire-and-forget — 不阻塞主流程。
 */
function countAuthFailureAsync({ userId, username, ip, ua, eventType }) {
  countAuthFailure({ userId, username, ip, ua, eventType }).catch(e => {
    console.warn(`[AuthThrottle] countAuthFailure failed: ${e.message}`);
  });
}

async function countAuthFailure({ userId, username, ip, ua, eventType }) {
  const c = cfg();
  const w = c.alertWindowSec;

  let userCount = 0;
  let ipCount = 0;
  if (userId) userCount = await bumpCounter(`auth:fail:user:${userId}`, w);
  if (ip)     ipCount   = await bumpCounter(`auth:fail:ip:${ip}`, w);

  // 達閾值 → 寄信(寄完設旗標,1 小時內不重寄)
  if (userId && userCount >= c.failAlertPerUser) {
    if (!(await hasFlag(`auth:alerted:user:${userId}`))) {
      await setFlag(`auth:alerted:user:${userId}`, w);
      sendAdminAlert({
        scope: 'user',
        identifier: `user_id=${userId} (${username || '?'})`,
        count: userCount, window: '1 小時', ip, ua, eventType,
      }).catch(e => console.warn(`[AuthThrottle] alert mail failed: ${e.message}`));
    }
  }
  if (ip && ipCount >= c.failAlertPerIp) {
    if (!(await hasFlag(`auth:alerted:ip:${ip}`))) {
      await setFlag(`auth:alerted:ip:${ip}`, w);
      sendAdminAlert({
        scope: 'ip',
        identifier: `IP=${ip}`,
        count: ipCount, window: '1 小時', ip, ua, eventType,
      }).catch(e => console.warn(`[AuthThrottle] alert mail failed: ${e.message}`));
    }
  }
}

async function sendAdminAlert({ scope, identifier, count, window, ip, ua, eventType }) {
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || process.env.FROM_ADDRESS;
  if (!adminEmail) {
    console.warn('[AuthThrottle] ADMIN_NOTIFY_EMAIL 未設定,無法寄告警信');
    return;
  }
  const { sendMail } = require('./mailService');
  const html = `
    <div style="font-family:sans-serif;max-width:520px">
      <h2 style="color:#dc2626">⚠️ Cortex 登入失敗異常告警</h2>
      <p>偵測到 <strong>${identifier}</strong> 在 ${window} 內失敗 <strong>${count}</strong> 次,可能為攻擊嘗試。</p>
      <table style="border-collapse:collapse;font-size:13px;margin-top:12px">
        <tr><td style="padding:4px 8px;color:#64748b">Scope</td><td style="padding:4px 8px">${scope}</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b">Event</td><td style="padding:4px 8px"><code>${eventType}</code></td></tr>
        <tr><td style="padding:4px 8px;color:#64748b">IP</td><td style="padding:4px 8px"><code>${ip || '-'}</code></td></tr>
        <tr><td style="padding:4px 8px;color:#64748b">User-Agent</td><td style="padding:4px 8px;color:#475569">${ua || '-'}</td></tr>
      </table>
      <p style="color:#94a3b8;font-size:12px;margin-top:16px">
        前往 admin 「認證稽核」頁面查看完整紀錄。同 ${scope} 1 小時內不會重複告警。
      </p>
    </div>
  `;
  await sendMail({
    to: adminEmail,
    subject: `[Cortex] 登入失敗告警 — ${identifier}`,
    html,
  });
}

// ── forgot-password rate limit ──────────────────────────────────────

/**
 * @returns {{ allowed: boolean, reason?: string }}
 */
async function checkForgotPasswordRate(ip, username) {
  const c = cfg();
  const max = c.forgotPwdRate;
  if (max <= 0) return { allowed: true };
  const w = c.alertWindowSec;
  if (ip) {
    const n = await bumpCounter(`auth:forgot:ip:${ip}`, w);
    if (n > max) return { allowed: false, reason: 'ip_rate' };
  }
  if (username) {
    const u = String(username).toLowerCase();
    const n = await bumpCounter(`auth:forgot:user:${u}`, w);
    if (n > max) return { allowed: false, reason: 'user_rate' };
  }
  return { allowed: true };
}

// ── 異常登入(新 IP)判斷 ────────────────────────────────────────────

/**
 * 判斷該 user 過去 30 天有沒有用過這個 IP 成功登入過 — 沒有就是新 IP。
 * 用 auth_audit_logs 查(看 success login event)。
 */
async function isNewLoginIp(db, userId, ip) {
  if (!userId || !ip) return false;
  try {
    const row = await db.prepare(
      `SELECT id FROM auth_audit_logs
       WHERE user_id = ?
         AND ip = ?
         AND success = 1
         AND event_type LIKE 'login_success_%'
         AND created_at > SYSTIMESTAMP - INTERVAL '30' DAY
       FETCH FIRST 1 ROWS ONLY`
    ).get(userId, ip);
    return !row;
  } catch (e) {
    console.warn(`[AuthThrottle] isNewLoginIp lookup failed: ${e.message}`);
    return false;  // 失敗時保守:不判定新 IP,避免噪音
  }
}

module.exports = {
  cfg,
  countAuthFailureAsync,
  checkForgotPasswordRate,
  isNewLoginIp,
};
