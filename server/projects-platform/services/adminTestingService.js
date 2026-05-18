/**
 * Admin Testing Mode Service — spec §17.4
 *
 * 沿用 Cortex 既有的 a-admin-test 機制概念,但在 projects-platform 層獨立 session 表
 *
 * 流程:
 *   1. admin enter() — 填 reason + expected_duration_minutes(預設 60)→ 開 session
 *   2. 1 小時自動 timeout(背景檢查 + middleware lazy check)
 *   3. 在 session 期間,middleware 偵測到 admin → 業務操作 audit 加 [ADMIN_TEST] prefix
 *   4. admin exit() — manual_exit / timeout / session_expired
 *
 * Phase 1 Sprint H minimal:
 *   - Session 表 CRUD
 *   - getActiveSession(userId)
 *   - middleware injectAdminTestingMode(req)
 *
 * Phase 2 補:
 *   - 真的把 audit log prefix 化(需先有 cortex audit 寫入 hook)
 *   - 通知 BU 主管
 */

const { makeLogger } = require('./logger');
const log = makeLogger('adminTestingService');

const DEFAULT_DURATION_MIN = 60;
const MAX_DURATION_MIN = 240;

/**
 * Admin enter testing mode
 */
async function enter(db, { userId, reason, durationMinutes }) {
  if (!userId) throw new Error('userId required');
  reason = String(reason || '').trim();
  if (reason.length < 3) throw new Error('reason required (min 3 chars)');

  const dur = Math.min(MAX_DURATION_MIN, Math.max(1, Number(durationMinutes) || DEFAULT_DURATION_MIN));

  // 已在 testing mode → 直接回 existing(不重開新 session)
  const active = await getActiveSession(db, userId);
  if (active) {
    return { id: active.id, already_in_testing: true, session: active };
  }

  const ins = await db.prepare(`
    INSERT INTO admin_testing_sessions
      (user_id, reason, expected_duration_minutes, notified_bu_director_user_ids)
    VALUES (?, ?, ?, ?)
  `).run(userId, reason.slice(0, 500), dur, JSON.stringify([]));

  const id = Number(ins.lastInsertRowid);
  log.log(`admin testing entered: user=${userId} reason="${reason.slice(0,40)}" dur=${dur}min`);
  return { id, expected_duration_minutes: dur };
}

/**
 * Admin exit testing mode
 */
async function exit(db, { userId, sessionId, endedReason = 'manual_exit' }) {
  let session;
  if (sessionId) {
    session = await db.prepare(
      `SELECT id, user_id, ended_at FROM admin_testing_sessions WHERE id = ?`,
    ).get(sessionId);
  } else {
    session = await getActiveSession(db, userId);
  }
  if (!session) return { ok: false, reason: 'no active session' };
  if (session.ended_at) return { ok: false, reason: 'already ended' };

  await db.prepare(`
    UPDATE admin_testing_sessions
       SET ended_at = SYSTIMESTAMP, ended_reason = ?
     WHERE id = ?
  `).run(endedReason, session.id);

  log.log(`admin testing exited: user=${session.user_id} session=${session.id} reason=${endedReason}`);
  return { ok: true, session_id: session.id };
}

/**
 * Get current active session for a user(自動 timeout 過期的 session)
 */
async function getActiveSession(db, userId) {
  if (!userId) return null;
  const row = await db.prepare(`
    SELECT id, user_id, reason, expected_duration_minutes, started_at, ended_at, ended_reason
      FROM admin_testing_sessions
     WHERE user_id = ? AND ended_at IS NULL
     ORDER BY started_at DESC
     FETCH FIRST 1 ROWS ONLY
  `).get(userId).catch(() => null);
  if (!row) return null;

  // 檢查是否該 timeout
  const startMs = new Date(row.started_at).getTime();
  const durMs = (Number(row.expected_duration_minutes) || DEFAULT_DURATION_MIN) * 60000;
  if (Date.now() - startMs > durMs) {
    await db.prepare(`
      UPDATE admin_testing_sessions
         SET ended_at = SYSTIMESTAMP, ended_reason = 'timeout'
       WHERE id = ?
    `).run(row.id);
    return null;
  }
  return row;
}

/** 列最近 N 筆 sessions(admin audit 用)*/
async function listRecent(db, { limit = 50 } = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  const rows = await db.prepare(`
    SELECT s.id, s.user_id, s.reason, s.expected_duration_minutes,
           s.started_at, s.ended_at, s.ended_reason,
           u.username, u.name
      FROM admin_testing_sessions s
      LEFT JOIN users u ON u.id = s.user_id
     ORDER BY s.started_at DESC
     FETCH FIRST ${lim} ROWS ONLY
  `).all().catch(() => []);
  return rows;
}

module.exports = {
  enter,
  exit,
  getActiveSession,
  listRecent,
};
