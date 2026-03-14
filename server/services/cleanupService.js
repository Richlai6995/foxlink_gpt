const cron = require('node-cron');
const fs   = require('fs');
const path = require('path');

let scheduledTask = null;

const { UPLOAD_DIR: UPLOADS_DIR } = require('../config/paths');

function isoDate(daysAgo) {
  return new Date(Date.now() - daysAgo * 86400000).toISOString();
}
function dateStr(iso) { return iso.slice(0, 10); }

/** Delete a file silently */
function tryUnlink(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
}

/**
 * Execute cleanup based on settings map.
 * settings keys: audit_days, audit_sensitive_days, llm_days,
 *                scheduled_task_days, dify_days, kb_query_days,
 *                skill_days, research_days
 * Returns stats object.
 */
async function runCleanup(db, settings) {
  const {
    audit_days           = 90,
    audit_sensitive_days = 365,
    llm_days             = 90,
    scheduled_task_days  = 90,
    dify_days            = 90,
    kb_query_days        = 90,
    skill_days           = 90,
    research_days        = 90,
    token_usage_days     = 365,
  } = settings;

  const stats = {
    audit_normal: 0, audit_sensitive: 0,
    llm_sessions: 0,
    scheduled_task_runs: 0,
    dify_call_logs: 0,
    kb_query_logs: 0,
    skill_call_logs: 0,
    research_jobs: 0,
    token_usage: 0,
  };

  // ── 1. Audit logs ────────────────────────────────────────────────────────────
  const auditCutoff     = isoDate(audit_days);
  const sensCutoff      = isoDate(audit_sensitive_days);

  const r1 = await db.prepare(`
    DELETE FROM audit_logs WHERE has_sensitive = 0
    AND created_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
  `).run(auditCutoff);
  stats.audit_normal = r1.changes;

  const r2 = await db.prepare(`
    DELETE FROM audit_logs WHERE has_sensitive = 1
    AND created_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
  `).run(sensCutoff);
  stats.audit_sensitive = r2.changes;

  // ── 2. LLM 問答 (chat_sessions + chat_messages + uploaded files) ─────────────
  if (llm_days > 0) {
    const llmCutoff = isoDate(llm_days);

    // Collect generated files before deletion
    const oldSessions = await db.prepare(`
      SELECT id FROM chat_sessions
      WHERE updated_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
    `).all(llmCutoff);

    if (oldSessions.length > 0) {
      const ids = oldSessions.map((s) => s.id);
      // Delete uploaded files referenced in messages
      for (const sid of ids) {
        const msgs = await db.prepare(
          `SELECT files_json FROM chat_messages WHERE session_id=? AND files_json IS NOT NULL`
        ).all(sid);
        for (const m of msgs) {
          try {
            const files = JSON.parse(m.files_json || '[]');
            for (const f of files) {
              if (f.path) tryUnlink(f.path);
              else if (f.name) tryUnlink(path.join(UPLOADS_DIR, 'chat', f.name));
            }
          } catch (_) {}
        }
      }
      await db.prepare(`DELETE FROM chat_messages WHERE session_id IN (
        SELECT id FROM chat_sessions
        WHERE updated_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
      )`).run(llmCutoff);

      const r3 = await db.prepare(`
        DELETE FROM chat_sessions
        WHERE updated_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
      `).run(llmCutoff);
      stats.llm_sessions = r3.changes;
    }
  }

  // ── 3. Scheduled task runs + attachments ──────────────────────────────────────
  if (scheduled_task_days > 0) {
    const stCutoff = isoDate(scheduled_task_days);

    // Collect generated files
    const oldRuns = await db.prepare(`
      SELECT generated_files_json FROM scheduled_task_runs
      WHERE run_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
      AND generated_files_json IS NOT NULL
    `).all(stCutoff);
    for (const run of oldRuns) {
      try {
        const files = JSON.parse(run.generated_files_json || '[]');
        for (const f of files) {
          if (f.path) tryUnlink(f.path);
          else if (f.filename) tryUnlink(path.join(UPLOADS_DIR, 'generated', f.filename));
        }
      } catch (_) {}
    }

    const r4 = await db.prepare(`
      DELETE FROM scheduled_task_runs
      WHERE run_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
    `).run(stCutoff);
    stats.scheduled_task_runs = r4.changes;
  }

  // ── 4. DIFY call logs ─────────────────────────────────────────────────────────
  if (dify_days > 0) {
    const difyCutoff = isoDate(dify_days);
    const r5 = await db.prepare(`
      DELETE FROM dify_call_logs
      WHERE called_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
    `).run(difyCutoff);
    stats.dify_call_logs = r5.changes;
  }

  // ── 5. KB query logs (kb_retrieval_tests) ────────────────────────────────────
  if (kb_query_days > 0) {
    const kbCutoff = isoDate(kb_query_days);
    const r6 = await db.prepare(`
      DELETE FROM kb_retrieval_tests
      WHERE created_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
    `).run(kbCutoff);
    stats.kb_query_logs = r6.changes;
  }

  // ── 6. Skill call logs ────────────────────────────────────────────────────────
  if (skill_days > 0) {
    const skillCutoff = isoDate(skill_days);
    const r7 = await db.prepare(`
      DELETE FROM skill_call_logs
      WHERE called_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
    `).run(skillCutoff);
    stats.skill_call_logs = r7.changes;
  }

  // ── 7. Research jobs + result files ──────────────────────────────────────────
  if (research_days > 0) {
    const resCutoff = isoDate(research_days);

    const oldJobs = await db.prepare(`
      SELECT result_files_json FROM research_jobs
      WHERE created_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
      AND result_files_json IS NOT NULL
    `).all(resCutoff);
    for (const job of oldJobs) {
      try {
        const files = JSON.parse(job.result_files_json || '[]');
        for (const f of files) {
          if (f.path) tryUnlink(f.path);
          else if (f.filename) tryUnlink(path.join(UPLOADS_DIR, 'research', f.filename));
        }
      } catch (_) {}
    }

    const r8 = await db.prepare(`
      DELETE FROM research_jobs
      WHERE created_at < TO_TIMESTAMP(?, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
    `).run(resCutoff);
    stats.research_jobs = r8.changes;
  }

  // ── 8. Token usage statistics ─────────────────────────────────────────────
  if (token_usage_days > 0) {
    const tokenCutoff = isoDate(token_usage_days);
    const r9 = await db.prepare(
      `DELETE FROM token_usage WHERE usage_date < TO_DATE(?, 'YYYY-MM-DD')`
    ).run(tokenCutoff.slice(0, 10));
    stats.token_usage = r9.changes;
  }

  return stats;
}

/** Load all cleanup settings from DB */
async function loadSettings(db) {
  const rows = await db.prepare(
    `SELECT key, value FROM system_settings WHERE key LIKE 'cleanup_%'`
  ).all();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    audit_days:          parseInt(map.cleanup_audit_days           || map.cleanup_retention_days  || '90'),
    audit_sensitive_days:parseInt(map.cleanup_audit_sensitive_days || map.cleanup_sensitive_days  || '365'),
    llm_days:            parseInt(map.cleanup_llm_days             || '90'),
    scheduled_task_days: parseInt(map.cleanup_scheduled_task_days  || '90'),
    dify_days:           parseInt(map.cleanup_dify_days            || '90'),
    kb_query_days:       parseInt(map.cleanup_kb_query_days        || '90'),
    skill_days:          parseInt(map.cleanup_skill_days           || '90'),
    research_days:       parseInt(map.cleanup_research_days        || '90'),
    token_usage_days:    parseInt(map.cleanup_token_usage_days     || '365'),
  };
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
    console.log(`[Cleanup] Scheduled run at ${cronExpr}`);
    try {
      const settings = await loadSettings(db);
      const stats = await runCleanup(db, settings);
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

module.exports = { runCleanup, loadSettings, startScheduler, stopScheduler };
