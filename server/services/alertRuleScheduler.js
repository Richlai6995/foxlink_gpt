'use strict';

/**
 * Alert Rule Scheduler — 獨立規則 schedule-level 輪詢
 *
 * 每分鐘 tick:撈所有 active rule + active schedule + next_evaluate_at ≤ NOW 的 (rule, schedule)
 * pair,逐一評估。
 *
 * 設計演進歷史:
 *   v1 (Phase 3.1):rule-level 輪詢 — 每條 standalone rule 一個 schedule_interval_minutes
 *   v2 (本版):schedule-level — 一條 rule 可掛多個 schedule(alert_schedules 子表)
 *             每個 schedule 獨立 cron + lookback_days + cooldown + next_evaluate_at
 *             語意:同一個「PT 漲幅警示」rule,可同時設「日/週/月」三個 schedule
 *
 * Backward compat:
 *   若 alert_rules 有 schedule_interval_minutes 或 schedule_cron_expr 但沒任何 alert_schedules
 *   row,以前 v1 邏輯 fallback 跑(用 rule 自己的欄位算 next_at)。新規則建議走 schedules 子表。
 *
 * 多 pod 安全:Redis tryLock with key 含 (schedule_id, minute)
 * 失敗時 fail-open:寧可多發,讓 cooldown 擋
 *
 * 啟動時機:server.js 等 db pool ready 後呼叫 initAlertRuleScheduler(db)
 */

const cron = require('node-cron');
const { tryLock } = require('./redisClient');
const { nextFire: cronNextFire, isSupportedCron } = require('./cronNext');

let _tickJob = null;
let _running = false;

async function tickOnce(db) {
  if (_running) {
    console.log('[AlertRuleScheduler] previous tick still running, skip');
    return;
  }
  _running = true;
  try {
    // 1) v2:撈 due alert_schedules + 對應 rule
    const scheduleRows = await db.prepare(`
      SELECT
        s.id              AS sched_id,
        s.rule_id         AS rule_id,
        s.schedule_key    AS schedule_key,
        s.schedule_cron_expr AS sched_cron,
        s.schedule_interval_minutes AS sched_interval,
        s.lookback_days   AS lookback_days,
        s.cooldown_minutes AS sched_cooldown,
        r.rule_name       AS rule_name
      FROM alert_schedules s
      JOIN alert_rules r ON r.id = s.rule_id
      WHERE r.is_active = 1
        AND s.is_active = 1
        AND r.bound_to = 'standalone'
        AND (s.next_evaluate_at IS NULL OR s.next_evaluate_at <= SYSTIMESTAMP)
      ORDER BY s.next_evaluate_at NULLS FIRST
      FETCH FIRST 100 ROWS ONLY
    `).all();

    // 2) v1 fallback:rule 本身有 cron_expr / interval 但完全沒 schedules row
    const legacyRows = await db.prepare(`
      SELECT
        r.id              AS rule_id,
        r.rule_name       AS rule_name,
        r.schedule_interval_minutes AS interval_min,
        r.schedule_cron_expr AS rule_cron,
        r.next_evaluate_at AS next_at
      FROM alert_rules r
      WHERE r.is_active = 1
        AND r.bound_to = 'standalone'
        AND (
          (r.schedule_interval_minutes IS NOT NULL AND r.schedule_interval_minutes > 0)
          OR r.schedule_cron_expr IS NOT NULL
        )
        AND NOT EXISTS (SELECT 1 FROM alert_schedules s WHERE s.rule_id = r.id)
        AND (r.next_evaluate_at IS NULL OR r.next_evaluate_at <= SYSTIMESTAMP)
      ORDER BY r.next_evaluate_at NULLS FIRST
      FETCH FIRST 100 ROWS ONLY
    `).all();

    const totalTasks = (scheduleRows?.length || 0) + (legacyRows?.length || 0);
    if (totalTasks === 0) {
      _running = false;
      return;
    }

    const minute = Math.floor(Date.now() / 60000);
    const { executeAlert } = require('./pipelineAlerter');

    // ── v2: 跑 schedule-level ─────────────────────────────────────────────
    for (const s of (scheduleRows || [])) {
      const schedId = s.sched_id || s.SCHED_ID;
      const ruleId = s.rule_id || s.RULE_ID;
      const schedKey = s.schedule_key || s.SCHEDULE_KEY || '';
      const schedCron = s.sched_cron || s.SCHED_CRON || null;
      const schedInterval = Number(s.sched_interval ?? s.SCHED_INTERVAL) || 0;
      const lookbackDays = (s.lookback_days ?? s.LOOKBACK_DAYS);
      const ruleName = s.rule_name || s.RULE_NAME || `rule_${ruleId}`;

      const lockKey = `alert_sched_eval:${schedId}:${minute}`;
      let acquired = false;
      try { acquired = await tryLock(lockKey, 90); }
      catch (e) {
        console.warn(`[AlertRuleScheduler] tryLock failed for sched ${schedId}: ${e.message}`);
        acquired = true;  // fail-open
      }
      if (!acquired) continue;

      // 撈完整 rule
      let fullRule;
      try {
        fullRule = await db.prepare(`SELECT * FROM alert_rules WHERE id=?`).get(ruleId);
      } catch (e) {
        console.warn(`[AlertRuleScheduler] fetch rule ${ruleId} failed: ${e.message}`);
        continue;
      }
      if (!fullRule) continue;

      // 算下次 fire:cron 優先(明確時點),否則用 interval(隔 N 分鐘),最後 60min fallback
      let nextAt = null;
      if (schedCron && isSupportedCron(schedCron)) {
        nextAt = cronNextFire(schedCron, new Date());
      } else if (schedInterval > 0) {
        nextAt = new Date(Date.now() + schedInterval * 60 * 1000);
      }
      if (!nextAt) {
        nextAt = new Date(Date.now() + 60 * 60 * 1000);  // 60min fallback
      }
      const nextSql = isoToOracleTs(nextAt);

      // 跑 executeAlert(把 schedule 資訊塞進 context,inline rule 內 SQL 用 {{lookback_days}} 替換)
      let resultLabel = '';
      try {
        const inlineRule = normalizeRuleForExecutor(fullRule);
        // 把 schedule-level 的 cooldown / dedup 蓋 rule-level
        if (s.sched_cooldown ?? s.SCHED_COOLDOWN) {
          inlineRule.cooldown_minutes = Number(s.sched_cooldown ?? s.SCHED_COOLDOWN);
        }
        // dedup_key 加 schedule_key 後綴,確保同 rule 不同 schedule 各自 cooldown
        inlineRule.dedup_key = `${inlineRule.dedup_key || `rule_${ruleId}`}_${schedKey || `sched_${schedId}`}`;
        // SQL template 替換
        if (lookbackDays != null && inlineRule.data_config) {
          inlineRule.data_config = injectLookback(inlineRule.data_config, lookbackDays);
        }

        // 把 schedule meta 注入 vars(message_template 可用 {{timeframe_label}} 等)
        const TIMEFRAME_LABELS = { daily: '日', weekly: '週', monthly: '月', interval: '間隔' };
        const extraVars = {
          schedule_key: schedKey,
          timeframe_label: TIMEFRAME_LABELS[schedKey] || schedKey,
          lookback_days: lookbackDays != null ? String(lookbackDays) : '',
        };

        const result = await executeAlert(db, {
          id: `standalone_${ruleId}_sched_${schedId}`,
          _inline_rule: inlineRule,
        }, '', {
          user: { id: fullRule.OWNER_USER_ID || fullRule.owner_user_id, role: 'admin' },
          userId: fullRule.OWNER_USER_ID || fullRule.owner_user_id,
          runId: Date.now(),
          taskId: null,
          nodeId: `standalone_${ruleId}_sched_${schedId}`,
          dryRun: false,
          extraVars,
        });
        if (result.triggered) resultLabel = `triggered → ${(result.channels_sent || []).join(',')}`;
        else if (result.skipped) resultLabel = `skipped: ${result.reason || ''}`;
        else if (result.error) resultLabel = `error: ${result.error}`;
        else resultLabel = `not_triggered: ${result.reason || ''}`;
        console.log(`[AlertRuleScheduler] rule #${ruleId} "${ruleName}" [${schedKey}] → ${resultLabel}`);
      } catch (e) {
        resultLabel = `exception: ${e.message}`;
        console.error(`[AlertRuleScheduler] rule #${ruleId} sched #${schedId} eval threw:`, e.message);
      }

      // Update schedule next_evaluate_at + last_evaluated_at + last_eval_result
      try {
        await db.prepare(`
          UPDATE alert_schedules
          SET last_evaluated_at = SYSTIMESTAMP,
              next_evaluate_at  = TO_TIMESTAMP(?, 'YYYY-MM-DD HH24:MI:SS'),
              last_eval_result  = ?,
              last_modified     = SYSTIMESTAMP
          WHERE id=?
        `).run(nextSql, (resultLabel || '').slice(0, 500), schedId);
      } catch (e) {
        console.warn(`[AlertRuleScheduler] update schedule ${schedId} next_at failed: ${e.message}`);
      }
    }

    // ── v1 legacy: rule-level fallback(沒 schedules 子記錄)─────────────
    for (const r of (legacyRows || [])) {
      const ruleId = r.rule_id || r.RULE_ID;
      const ruleName = r.rule_name || r.RULE_NAME || `rule_${ruleId}`;
      const intervalMin = Number(r.interval_min || r.INTERVAL_MIN) || 0;
      const ruleCron = r.rule_cron || r.RULE_CRON || null;

      const lockKey = `alert_rule_eval:${ruleId}:${minute}`;
      let acquired = false;
      try { acquired = await tryLock(lockKey, 90); }
      catch (e) { acquired = true; }
      if (!acquired) continue;

      let fullRule;
      try { fullRule = await db.prepare(`SELECT * FROM alert_rules WHERE id=?`).get(ruleId); }
      catch (e) { continue; }
      if (!fullRule) continue;

      let nextAt = null;
      if (ruleCron && isSupportedCron(ruleCron)) nextAt = cronNextFire(ruleCron, new Date());
      if (!nextAt) nextAt = new Date(Date.now() + (intervalMin || 60) * 60 * 1000);
      const nextSql = isoToOracleTs(nextAt);

      let resultLabel = '';
      try {
        const result = await executeAlert(db, {
          id: `standalone_${ruleId}`,
          _inline_rule: normalizeRuleForExecutor(fullRule),
        }, '', {
          user: { id: fullRule.OWNER_USER_ID || fullRule.owner_user_id, role: 'admin' },
          userId: fullRule.OWNER_USER_ID || fullRule.owner_user_id,
          runId: Date.now(),
          taskId: null,
          nodeId: `standalone_${ruleId}`,
          dryRun: false,
        });
        if (result.triggered) resultLabel = `triggered → ${(result.channels_sent || []).join(',')}`;
        else if (result.skipped) resultLabel = `skipped: ${result.reason || ''}`;
        else if (result.error) resultLabel = `error: ${result.error}`;
        else resultLabel = `not_triggered: ${result.reason || ''}`;
        console.log(`[AlertRuleScheduler] (legacy) rule #${ruleId} "${ruleName}" → ${resultLabel}`);
      } catch (e) {
        resultLabel = `exception: ${e.message}`;
      }

      try {
        await db.prepare(`
          UPDATE alert_rules
          SET last_evaluated_at = SYSTIMESTAMP,
              next_evaluate_at  = TO_TIMESTAMP(?, 'YYYY-MM-DD HH24:MI:SS'),
              last_eval_result  = ?
          WHERE id=?
        `).run(nextSql, (resultLabel || '').slice(0, 500), ruleId);
      } catch (e) {}
    }
  } catch (e) {
    console.error('[AlertRuleScheduler] tick error:', e.message);
  } finally {
    _running = false;
  }
}

// rule 從 DB 出來的欄位是大寫(Oracle),executeAlert 預期小寫
function normalizeRuleForExecutor(r) {
  const out = {};
  for (const [k, v] of Object.entries(r)) out[k.toLowerCase()] = v;
  return out;
}

// 把 data_config(JSON string 或 object)內的 SQL 做 {{lookback_days}} 替換,回 JSON string
function injectLookback(dataConfig, lookbackDays) {
  let cfg;
  if (typeof dataConfig === 'string') {
    try { cfg = JSON.parse(dataConfig); } catch { cfg = { sql: dataConfig }; }
  } else if (dataConfig && typeof dataConfig === 'object') {
    cfg = { ...dataConfig };
  } else {
    return dataConfig;
  }
  if (typeof cfg.sql === 'string') {
    cfg.sql = cfg.sql.replace(/\{\{lookback_days\}\}/g, String(lookbackDays));
  }
  return JSON.stringify(cfg);
}

// Date → 'YYYY-MM-DD HH24:MI:SS'(UTC-naive,延續既有 schema 慣例)
function isoToOracleTs(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
}

function initAlertRuleScheduler(db) {
  if (_tickJob) return;
  _tickJob = cron.schedule('* * * * *', async () => {
    try { await tickOnce(db); } catch (e) { console.error('[AlertRuleScheduler] cron tick error:', e.message); }
  }, { timezone: 'Asia/Taipei' });
  console.log('[AlertRuleScheduler] started (tick every minute, Asia/Taipei) — v2 schedule-level');
}

function stopAlertRuleScheduler() {
  if (_tickJob) { _tickJob.stop(); _tickJob = null; }
}

module.exports = {
  initAlertRuleScheduler,
  stopAlertRuleScheduler,
  tickOnce,
  // export utility for testing
  injectLookback,
};
