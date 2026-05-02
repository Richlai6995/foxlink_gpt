'use strict';

/**
 * Auth audit log — 認證稽核紀錄
 *
 * Fire-and-forget pattern:不阻塞主流程,寫失敗只 console.warn,
 * 不讓使用者登入因為 audit DB 卡住而 fail。
 *
 * 永久保留(由 ops 後續視情況歸檔)。
 *
 * Event types(對應 docs/MFA plan):
 *   login_success_internal              — 內網登入成功
 *   login_success_external_skip_mfa     — 外網但 IP 已信任,跳過 MFA
 *   login_success_external_mfa          — 外網 + MFA 通過
 *   login_failed_credentials            — 帳密錯
 *   login_failed_no_email               — 外網 + 無 email 被拒
 *   login_failed_account_disabled       — 停用 / 過期
 *   mfa_challenge_created               — DM 已送出
 *   mfa_dm_failed                       — Webex DM 失敗(hard error)
 *   mfa_webex_person_not_found          — email 在 Webex 找不到 person
 *   mfa_verify_failed                   — OTP 錯
 *   mfa_verify_too_many                 — 5 次失敗刷 challenge
 *   mfa_resend                          — 重發 OTP
 *   mfa_trusted_ip_added                — 通過 MFA 後寫入 trusted IP
 *   trusted_ip_revoked_password_change  — 改密碼自動清
 */

const MAX_UA_LEN = 512;
const MAX_ERR_LEN = 512;
const truncate = (s, n) => (s == null ? null : String(s).slice(0, n));

/**
 * @param {object} db - database-oracle wrapper
 * @param {object} entry - audit entry
 * @param {number|null} entry.user_id
 * @param {string|null} entry.username
 * @param {string} entry.event_type
 * @param {string|null} entry.ip
 * @param {string|null} entry.user_agent
 * @param {string|null} entry.challenge_id
 * @param {boolean|number|null} entry.success
 * @param {string|null} entry.error_msg
 * @param {object|null} entry.metadata - 任意額外欄位,JSON.stringify 後寫 CLOB
 */
async function logAuthEvent(db, entry) {
  try {
    const successInt = entry.success == null ? null : (entry.success ? 1 : 0);
    const metaJson = entry.metadata ? JSON.stringify(entry.metadata) : null;
    await db.prepare(
      `INSERT INTO auth_audit_logs
         (user_id, username, event_type, ip, user_agent, challenge_id, success, error_msg, metadata)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      entry.user_id ?? null,
      truncate(entry.username, 64),
      entry.event_type,
      truncate(entry.ip, 64),
      truncate(entry.user_agent, MAX_UA_LEN),
      truncate(entry.challenge_id, 64),
      successInt,
      truncate(entry.error_msg, MAX_ERR_LEN),
      metaJson
    );
  } catch (e) {
    console.warn(`[AuthAudit] write failed (${entry.event_type}): ${e.message}`);
  }
}

/**
 * Fire-and-forget wrapper — caller 不需 await,寫失敗也不影響主流程
 */
function logAuthEventAsync(db, entry) {
  logAuthEvent(db, entry).catch(() => {});
}

module.exports = { logAuthEvent, logAuthEventAsync };
