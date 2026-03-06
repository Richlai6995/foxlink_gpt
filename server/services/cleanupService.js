const cron = require('node-cron');

let scheduledTask = null;

/**
 * Execute cleanup. Returns stats object with rows deleted per category.
 */
async function runCleanup(db, normalDays, sensitiveDays) {
  const stats = {
    normal_sessions: 0,
    sensitive_sessions: 0,
    normal_audit: 0,
    sensitive_audit: 0,
    token_usage: 0,
  };

  // Use Oracle date arithmetic: SYSTIMESTAMP - INTERVAL 'n' DAY
  const normalCutoff  = new Date(Date.now() - normalDays * 86400000).toISOString();
  const sensitiveCutoff = new Date(Date.now() - sensitiveDays * 86400000).toISOString();
  const keepCutoff    = new Date(Date.now() - Math.max(normalDays, sensitiveDays) * 86400000).toISOString();

  // 1. Delete messages for non-sensitive sessions older than normalDays
  await db.prepare(`
    DELETE FROM chat_messages WHERE session_id IN (
      SELECT id FROM chat_sessions
      WHERE updated_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
      AND id NOT IN (
        SELECT DISTINCT session_id FROM audit_logs
        WHERE has_sensitive = 1 AND session_id IS NOT NULL
      )
    )
  `).run(normalCutoff);

  const r1 = await db.prepare(`
    DELETE FROM chat_sessions
    WHERE updated_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
    AND id NOT IN (
      SELECT DISTINCT session_id FROM audit_logs
      WHERE has_sensitive = 1 AND session_id IS NOT NULL
    )
  `).run(normalCutoff);
  stats.normal_sessions = r1.changes;

  // 2. Delete messages for sensitive sessions older than sensitiveDays
  await db.prepare(`
    DELETE FROM chat_messages WHERE session_id IN (
      SELECT id FROM chat_sessions
      WHERE updated_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
    )
  `).run(sensitiveCutoff);

  const r2 = await db.prepare(`
    DELETE FROM chat_sessions
    WHERE updated_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
  `).run(sensitiveCutoff);
  stats.sensitive_sessions = r2.changes;

  // 3. Audit logs
  const r3 = await db.prepare(`
    DELETE FROM audit_logs WHERE has_sensitive = 0
    AND created_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
  `).run(normalCutoff);
  stats.normal_audit = r3.changes;

  const r4 = await db.prepare(`
    DELETE FROM audit_logs WHERE has_sensitive = 1
    AND created_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
  `).run(sensitiveCutoff);
  stats.sensitive_audit = r4.changes;

  // 4. Token usage
  const r5 = await db.prepare(
    `DELETE FROM token_usage WHERE usage_date < TO_DATE(?, 'YYYY-MM-DD')`
  ).run(keepCutoff.slice(0, 10));
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
  scheduledTask = cron.schedule(cronExpr, async () => {
    const rows = await db.prepare(
      `SELECT key, value FROM system_settings WHERE key IN ('cleanup_retention_days','cleanup_sensitive_days')`
    ).all();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const normalDays = parseInt(map.cleanup_retention_days || '90');
    const sensitiveDays = parseInt(map.cleanup_sensitive_days || '365');

    console.log(`[Cleanup] Scheduled run: normal=${normalDays}d, sensitive=${sensitiveDays}d`);
    try {
      const stats = await runCleanup(db, normalDays, sensitiveDays);
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
