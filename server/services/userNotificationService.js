'use strict';
/**
 * 通用個人通知 service(per-user 通知)
 *
 * 跟 announcements(廣播公告)正交,跟 feedback_notifications(綁 ticket)解耦。
 * 設計給「個人 background job 完成」「系統訊息」「未來各 service 推送」共用。
 *
 * Schema: server/database-oracle.js — table user_notifications
 *
 * 設計文件:docs/long-audio-background-job-plan.md(P4a)
 */

const TYPE_TRANSCRIBE_JOB_DONE   = 'transcribe_job_done';
const TYPE_TRANSCRIBE_JOB_FAILED = 'transcribe_job_failed';
const TYPE_EXCEL_QUERY_DONE      = 'excel_query_done';
const TYPE_EXCEL_QUERY_FAILED    = 'excel_query_failed';

/**
 * 建一條通知給某 user。
 * @param {object} db
 * @param {object} opts
 * @param {number} opts.userId
 * @param {string} opts.type          - 例 'transcribe_job_done'
 * @param {string} opts.title         - 顯示標題(短)
 * @param {string} [opts.message]     - 內文(可 markdown)
 * @param {string} [opts.linkUrl]     - 點擊跳轉(例 '/chat/{sessionId}')
 * @param {object} [opts.payload]     - 結構化資料(自動 JSON.stringify)
 */
async function create(db, opts) {
  const payloadJson = opts.payload ? JSON.stringify(opts.payload) : null;
  const res = await db.prepare(`
    INSERT INTO user_notifications (user_id, type, title, message, link_url, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    opts.userId,
    opts.type,
    opts.title.slice(0, 500),
    opts.message || null,
    opts.linkUrl || null,
    payloadJson,
  );
  return res?.lastID || null;
}

/**
 * 列 user 通知(預設未 dismissed,最新 50 筆)。
 * @param {object} opts
 * @param {boolean} [opts.unreadOnly] - 只撈 is_read=0
 * @param {number}  [opts.limit]      - 預設 50
 */
async function listForUser(db, userId, opts = {}) {
  const limit = Math.min(opts.limit || 50, 200);
  let sql = `SELECT * FROM user_notifications WHERE user_id = ? AND is_dismissed = 0`;
  const params = [userId];
  if (opts.unreadOnly) {
    sql += ' AND is_read = 0';
  }
  sql += ` ORDER BY created_at DESC FETCH FIRST ${limit} ROWS ONLY`;
  const rows = await db.prepare(sql).all(...params);
  return rows.map(_format);
}

/** 未讀計數(鈴鐺紅點用)。 */
async function unreadCount(db, userId) {
  const r = await db.prepare(
    `SELECT COUNT(*) AS c FROM user_notifications WHERE user_id = ? AND is_read = 0 AND is_dismissed = 0`
  ).get(userId);
  return Number(r?.c || 0);
}

/** 標已讀(批次)。 */
async function markRead(db, userId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    // 全標已讀
    await db.prepare(
      `UPDATE user_notifications SET is_read = 1, read_at = SYSTIMESTAMP WHERE user_id = ? AND is_read = 0`
    ).run(userId);
    return;
  }
  const placeholders = ids.map(() => '?').join(',');
  await db.prepare(
    `UPDATE user_notifications SET is_read = 1, read_at = SYSTIMESTAMP
     WHERE user_id = ? AND id IN (${placeholders}) AND is_read = 0`
  ).run(userId, ...ids);
}

/** dismiss(user 按掉,從 list 移除)。 */
async function dismiss(db, userId, id) {
  await db.prepare(
    `UPDATE user_notifications SET is_dismissed = 1, is_read = 1, read_at = SYSTIMESTAMP
     WHERE user_id = ? AND id = ?`
  ).run(userId, id);
}

function _format(row) {
  if (!row) return null;
  let payload = null;
  if (row.payload_json) {
    try { payload = JSON.parse(row.payload_json); } catch (_) {}
  }
  return {
    id: row.id,
    user_id: row.user_id,
    type: row.type,
    title: row.title,
    message: row.message,
    link_url: row.link_url,
    payload,
    is_read: row.is_read === 1,
    is_dismissed: row.is_dismissed === 1,
    created_at: row.created_at,
    read_at: row.read_at,
  };
}

module.exports = {
  create,
  listForUser,
  unreadCount,
  markRead,
  dismiss,
  // 常用 type 常數
  TYPE_TRANSCRIBE_JOB_DONE,
  TYPE_TRANSCRIBE_JOB_FAILED,
  TYPE_EXCEL_QUERY_DONE,
  TYPE_EXCEL_QUERY_FAILED,
};
