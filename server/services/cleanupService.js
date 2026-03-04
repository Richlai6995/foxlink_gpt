const cron = require('node-cron');

let scheduledTask = null;

/**
 * Execute cleanup. Returns stats object with rows deleted per category.
 */
function runCleanup(db, normalDays, sensitiveDays) {
  const stats = {
    normal_sessions: 0,
    sensitive_sessions: 0,
    normal_audit: 0,
    sensitive_audit: 0,
    token_usage: 0,
  };

  const normalPeriod = `-${normalDays} days`;
  const sensitivePeriod = `-${sensitiveDays} days`;

  // 1. Delete messages for non-sensitive sessions older than normalDays
  //    (sessions that have NO sensitive audit log entries)
  db.prepare(`
    DELETE FROM chat_messages WHERE session_id IN (
      SELECT id FROM chat_sessions
      WHERE updated_at < datetime('now', ?)
      AND id NOT IN (
        SELECT DISTINCT session_id FROM audit_logs
        WHERE has_sensitive = 1 AND session_id IS NOT NULL
      )
    )
  `).run(normalPeriod);

  const r1 = db.prepare(`
    DELETE FROM chat_sessions
    WHERE updated_at < datetime('now', ?)
    AND id NOT IN (
      SELECT DISTINCT session_id FROM audit_logs
      WHERE has_sensitive = 1 AND session_id IS NOT NULL
    )
  `).run(normalPeriod);
  stats.normal_sessions = r1.changes;

  // 2. Delete messages for sensitive sessions older than sensitiveDays
  db.prepare(`
    DELETE FROM chat_messages WHERE session_id IN (
      SELECT id FROM chat_sessions WHERE updated_at < datetime('now', ?)
    )
  `).run(sensitivePeriod);

  const r2 = db.prepare(`
    DELETE FROM chat_sessions WHERE updated_at < datetime('now', ?)
  `).run(sensitivePeriod);
  stats.sensitive_sessions = r2.changes;

  // 3. Audit logs
  const r3 = db.prepare(`
    DELETE FROM audit_logs WHERE has_sensitive = 0 AND created_at < datetime('now', ?)
  `).run(normalPeriod);
  stats.normal_audit = r3.changes;

  const r4 = db.prepare(`
    DELETE FROM audit_logs WHERE has_sensitive = 1 AND created_at < datetime('now', ?)
  `).run(sensitivePeriod);
  stats.sensitive_audit = r4.changes;

  // 4. Token usage — keep up to the longer of the two periods
  const keepDays = Math.max(normalDays, sensitiveDays);
  const r5 = db.prepare(`DELETE FROM token_usage WHERE date < date('now', ?)`).run(`-${keepDays} days`);
  stats.token_usage = r5.changes;

  return stats;
}

function startScheduler(db, hour) {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }

  const h = parseInt(hour);
  if (isNaN(h) || h < 0 || h > 23) return;

  const cronExpr = `0 ${h} * * *`;
  scheduledTask = cron.schedule(cronExpr, () => {
    const rows = db.prepare(
      `SELECT key, value FROM system_settings WHERE key IN ('cleanup_retention_days','cleanup_sensitive_days')`
    ).all();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const normalDays = parseInt(map.cleanup_retention_days || '90');
    const sensitiveDays = parseInt(map.cleanup_sensitive_days || '365');

    console.log(`[Cleanup] Scheduled run: normal=${normalDays}d, sensitive=${sensitiveDays}d`);
    try {
      const stats = runCleanup(db, normalDays, sensitiveDays);
      console.log('[Cleanup] Done:', stats);
    } catch (e) {
      console.error('[Cleanup] Error:', e.message);
    }
  });

  console.log(`[Cleanup] Scheduler active: ${cronExpr}`);
}

function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  console.log('[Cleanup] Scheduler stopped.');
}

module.exports = { runCleanup, startScheduler, stopScheduler };
