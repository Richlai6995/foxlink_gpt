'use strict';

/**
 * Alert Rule Scheduler — Phase 3.1 獨立規則 cron 輪詢
 *
 * 每分鐘 tick:撈所有 active 且 next_evaluate_at ≤ NOW 的 standalone 規則,逐一評估。
 *
 * 與 pipeline-bound 規則的差異:
 *   - bound_to='standalone'(不依附 task / node)
 *   - 必須有 schedule_interval_minutes(否則 scheduler 忽略)
 *   - data_source 通常是 'sql_query'(沒有 upstream JSON 來源)
 *   - 透過 executeAlert with empty sourceText + dryRun=false
 *
 * 多 pod 安全:
 *   - 每分鐘 tick 全 pod 一起跑,但每條規則用 Redis tryLock(key 含 minute bucket)避重
 *   - Redis 失敗時 fail-open(可能多發,但 cooldown_minutes 會擋)
 *
 * 啟動時機:server.js 等 db pool ready 後呼叫 initAlertRuleScheduler(db)
 */

const cron = require('node-cron');
const { tryLock } = require('./redisClient');

let _tickJob = null;
let _running = false;

async function tickOnce(db) {
  if (_running) {
    console.log('[AlertRuleScheduler] previous tick still running, skip');
    return;
  }
  _running = true;
  try {
    // 撈 due rules:active + standalone + 有 interval + (next_evaluate_at IS NULL OR <= SYSTIMESTAMP)
    const rows = await db.prepare(`
      SELECT id, rule_name, schedule_interval_minutes, next_evaluate_at, last_evaluated_at
      FROM alert_rules
      WHERE is_active=1
        AND bound_to='standalone'
        AND schedule_interval_minutes IS NOT NULL
        AND schedule_interval_minutes > 0
        AND (next_evaluate_at IS NULL OR next_evaluate_at <= SYSTIMESTAMP)
      ORDER BY next_evaluate_at NULLS FIRST
      FETCH FIRST 100 ROWS ONLY
    `).all();

    if (!rows || rows.length === 0) {
      _running = false;
      return;
    }

    const minute = Math.floor(Date.now() / 60000);
    const { executeAlert } = require('./pipelineAlerter');

    for (const r of rows) {
      const ruleId = r.id || r.ID;
      const ruleName = r.rule_name || r.RULE_NAME || `rule_${ruleId}`;
      const intervalMin = Number(r.schedule_interval_minutes || r.SCHEDULE_INTERVAL_MINUTES);

      // 多 pod 鎖:同 (ruleId, minute) 只一個 pod 拿到
      const lockKey = `alert_rule_eval:${ruleId}:${minute}`;
      let acquired = false;
      try {
        acquired = await tryLock(lockKey, 90);
      } catch (e) {
        console.warn(`[AlertRuleScheduler] tryLock failed for rule ${ruleId}: ${e.message}`);
        // fail-open:Redis 出問題還是繼續,讓 cooldown 擋重複
        acquired = true;
      }
      if (!acquired) continue;

      // 撈完整 rule(剛剛 SELECT 是 narrow column)
      let fullRule;
      try {
        fullRule = await db.prepare(`SELECT * FROM alert_rules WHERE id=?`).get(ruleId);
      } catch (e) {
        console.warn(`[AlertRuleScheduler] fetch rule ${ruleId} failed: ${e.message}`);
        continue;
      }
      if (!fullRule) continue;

      // 重新計算 next_evaluate_at(無論評估成功或失敗都要 advance,避免卡住)
      const advanceMs = intervalMin * 60 * 1000;
      const nextAt = new Date(Date.now() + advanceMs);
      const nextSql = `${nextAt.getUTCFullYear()}-${String(nextAt.getUTCMonth() + 1).padStart(2, '0')}-${String(nextAt.getUTCDate()).padStart(2, '0')} ${String(nextAt.getUTCHours()).padStart(2, '0')}:${String(nextAt.getUTCMinutes()).padStart(2, '0')}:${String(nextAt.getUTCSeconds()).padStart(2, '0')}`;

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
        if (result.triggered) {
          resultLabel = `triggered → ${(result.channels_sent || []).join(',')}`;
        } else if (result.skipped) {
          resultLabel = `skipped: ${result.reason || ''}`;
        } else if (result.error) {
          resultLabel = `error: ${result.error}`;
        } else {
          resultLabel = `not_triggered: ${result.reason || ''}`;
        }
        console.log(`[AlertRuleScheduler] rule #${ruleId} "${ruleName}" → ${resultLabel}`);
      } catch (e) {
        resultLabel = `exception: ${e.message}`;
        console.error(`[AlertRuleScheduler] rule #${ruleId} "${ruleName}" eval threw:`, e.message);
      }

      // Update last_evaluated_at + next_evaluate_at + last_eval_result
      try {
        await db.prepare(`
          UPDATE alert_rules
          SET last_evaluated_at = SYSTIMESTAMP,
              next_evaluate_at  = TO_TIMESTAMP(?, 'YYYY-MM-DD HH24:MI:SS'),
              last_eval_result  = ?
          WHERE id=?
        `).run(nextSql, (resultLabel || '').slice(0, 500), ruleId);
      } catch (e) {
        console.warn(`[AlertRuleScheduler] update next_evaluate_at for ${ruleId} failed: ${e.message}`);
      }
    }
  } catch (e) {
    console.error('[AlertRuleScheduler] tick error:', e.message);
  } finally {
    _running = false;
  }
}

// rule 從 DB 出來的欄位是大寫(Oracle),executeAlert 預期 normalizeRuleRow 過的小寫物件
function normalizeRuleForExecutor(r) {
  const out = {};
  for (const [k, v] of Object.entries(r)) out[k.toLowerCase()] = v;
  // CLOB 欄位:executeAlert 內 safeJsonParse 接受字串或物件,不需在這轉
  return out;
}

function initAlertRuleScheduler(db) {
  if (_tickJob) return;
  _tickJob = cron.schedule('* * * * *', async () => {
    try { await tickOnce(db); } catch (e) { console.error('[AlertRuleScheduler] cron tick error:', e.message); }
  }, { timezone: 'Asia/Taipei' });
  console.log('[AlertRuleScheduler] started (tick every minute, Asia/Taipei)');
}

function stopAlertRuleScheduler() {
  if (_tickJob) { _tickJob.stop(); _tickJob = null; }
}

module.exports = {
  initAlertRuleScheduler,
  stopAlertRuleScheduler,
  tickOnce,
};
