/**
 * Feedback SLA Service — SLA 檢查 Cron + 自動結案
 */

const feedbackService = require('./feedbackService');
const feedbackNotif = require('./feedbackNotificationService');

let _interval = null;

function startSLACron() {
  const checkMinutes = 5;
  console.log(`[FeedbackSLA] Starting cron every ${checkMinutes} minutes`);
  _interval = setInterval(() => checkSLA().catch(e => console.error('[FeedbackSLA] error:', e.message)), checkMinutes * 60 * 1000);
  // 首次延遲 30 秒執行
  setTimeout(() => checkSLA().catch(e => console.error('[FeedbackSLA] initial error:', e.message)), 30000);
}

function stopSLACron() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

async function checkSLA() {
  const db = require('../database-oracle').db;
  if (!db) return;

  // 1. 即將到期（剩餘 < 30 分鐘）且尚未通知
  try {
    const warningTickets = await db.prepare(`
      SELECT id, ticket_no, subject, sla_due_first_response, sla_due_resolution, user_id, assigned_to
      FROM feedback_tickets
      WHERE status IN ('open', 'processing', 'pending_user', 'reopened')
      AND sla_breached = 0
      AND (
        (first_response_at IS NULL AND sla_due_first_response IS NOT NULL AND sla_due_first_response < SYSTIMESTAMP + INTERVAL '30' MINUTE AND sla_due_first_response > SYSTIMESTAMP)
        OR
        (resolved_at IS NULL AND sla_due_resolution IS NOT NULL AND sla_due_resolution < SYSTIMESTAMP + INTERVAL '30' MINUTE AND sla_due_resolution > SYSTIMESTAMP)
      )
      FETCH FIRST 50 ROWS ONLY
    `).all();

    for (const t of warningTickets) {
      const dueAt = t.sla_due_first_response && !t.first_response_at ? t.sla_due_first_response : t.sla_due_resolution;
      await feedbackNotif.sendTicketWebex('sla_warning', t, { dueAt: String(dueAt) });
      await feedbackNotif.notifyAdmins(db, t, 'sla_warning', `SLA 即將到期: ${t.ticket_no}`, `工單 ${t.ticket_no} 的 SLA 即將到期`);
    }
  } catch (e) {
    console.warn('[FeedbackSLA] warning check error:', e.message);
  }

  // 2. 已逾期
  try {
    const breachedTickets = await db.prepare(`
      SELECT id, ticket_no, subject, user_id, assigned_to
      FROM feedback_tickets
      WHERE status IN ('open', 'processing', 'pending_user', 'reopened')
      AND sla_breached = 0
      AND (
        (first_response_at IS NULL AND sla_due_first_response IS NOT NULL AND sla_due_first_response < SYSTIMESTAMP)
        OR
        (resolved_at IS NULL AND sla_due_resolution IS NOT NULL AND sla_due_resolution < SYSTIMESTAMP)
      )
      FETCH FIRST 100 ROWS ONLY
    `).all();

    for (const t of breachedTickets) {
      await db.prepare('UPDATE feedback_tickets SET sla_breached = 1, updated_at = SYSTIMESTAMP WHERE id = ?').run(t.id);
      await feedbackNotif.sendTicketWebex('sla_breached', t);
      await feedbackNotif.notifyAdmins(db, t, 'sla_breached', `SLA 已逾期: ${t.ticket_no}`, `工單 ${t.ticket_no} 已超過 SLA 時限`);
    }
    if (breachedTickets.length > 0) {
      console.log(`[FeedbackSLA] Marked ${breachedTickets.length} tickets as SLA breached`);
    }
  } catch (e) {
    console.warn('[FeedbackSLA] breach check error:', e.message);
  }

  // 3. 自動結案：resolved 超過 72hr → closed
  try {
    const autoCloseResult = await db.prepare(`
      UPDATE feedback_tickets SET status = 'closed', closed_at = SYSTIMESTAMP, updated_at = SYSTIMESTAMP
      WHERE status = 'resolved' AND resolved_at IS NOT NULL AND resolved_at < SYSTIMESTAMP - INTERVAL '72' HOUR
    `).run();
    if (autoCloseResult.changes > 0) {
      console.log(`[FeedbackSLA] Auto-closed ${autoCloseResult.changes} tickets`);
    }
  } catch (e) {
    console.warn('[FeedbackSLA] auto-close error:', e.message);
  }
}

module.exports = { startSLACron, stopSLACron, checkSLA };
