'use strict';

/**
 * PM Task Token Budget Service — Phase 5 Track F-2 + F-5
 *
 * 職責:
 *   1. **F2 預算檢查**:per-task 設 daily_token_budget,超過自動 paused
 *      (scheduled_tasks.token_budget_paused_at 標時間,scheduledTaskService.shouldRun 檢查)
 *   2. **F5 cost 統計**:每 1 小時跑 aggregator 把 token_usage 撈來分配給 [PM]% 排程,
 *      寫進 pm_task_token_usage(per task / per day / per model)
 *
 * 設計:
 *   - token_usage 沒 task_id → 用 audit_logs 把對話跟 task run 串起來;
 *     若太複雜,fallback 到「以 task owner_user_id 為 proxy」(取 PM 排程 owner 的 token_usage)
 *   - 簡化版實作:本檔目前用 fallback(per-task owner aggregation)+
 *     scheduled_task_runs.duration_ms / 100 等估算機制(若 owner 跨多任務則退化為「該 owner 全部 PM 排程平均」)
 *
 * Trigger:
 *   - server.js startTokenBudgetCron()
 *   - admin: POST /api/pm/admin/token/aggregate-now
 */

const AGGREGATE_EVERY_HOURS = 1;
const FIRST_RUN_DELAY_MS = 3 * 60 * 1000;

let _interval = null;

function startTokenBudgetCron() {
  console.log(`[PmTokenBudget] Starting cron — aggregate every ${AGGREGATE_EVERY_HOURS}h + budget check`);
  setTimeout(() => tick().catch(e => console.error('[PmTokenBudget] initial error:', e.message)), FIRST_RUN_DELAY_MS);
  _interval = setInterval(
    () => tick().catch(e => console.error('[PmTokenBudget] tick error:', e.message)),
    AGGREGATE_EVERY_HOURS * 60 * 60 * 1000,
  );
}

function stopTokenBudgetCron() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

async function tick() {
  await aggregatePmTaskTokenUsage();
  await enforceBudget();
}

/**
 * 從 scheduled_task_runs JOIN token_usage(by owner_user_id + run_at date)估算
 * 每個 PM 排程當日 token 用量 → upsert pm_task_token_usage
 */
async function aggregatePmTaskTokenUsage() {
  const db = require('../database-oracle').db;
  if (!db) return 0;

  // 找所有今天有跑過的 [PM]% 排程 + 對應 owner 的 token_usage
  // 估算邏輯:把該 owner 當日所有 model 的 token_usage 平攤給該 owner 當日所有 [PM] 任務 run 數
  // 這是 proxy(因 token_usage 無 task_id),F5 dashboard 顯示時要標註「估算」
  const today = new Date().toISOString().slice(0, 10);

  const taskOwners = await db.prepare(`
    SELECT DISTINCT t.id AS task_id, t.owner_user_id, t.name
    FROM scheduled_tasks t
    WHERE t.name LIKE '[PM]%' AND t.owner_user_id IS NOT NULL
  `).all();

  for (const t of taskOwners) {
    // 該 task 今天跑了幾次
    const runs = await db.prepare(`
      SELECT COUNT(*) AS cnt FROM scheduled_task_runs
      WHERE task_id = ? AND TRUNC(run_at) = TRUNC(SYSDATE)
    `).get(t.task_id);
    const runCount = Number(runs?.cnt || 0);
    if (runCount === 0) continue;

    // 該 owner 今天所有 [PM] 任務的總 run 數
    const ownerTotalRuns = await db.prepare(`
      SELECT COUNT(*) AS cnt FROM scheduled_task_runs r
      JOIN scheduled_tasks tt ON tt.id = r.task_id
      WHERE tt.owner_user_id = ? AND tt.name LIKE '[PM]%'
        AND TRUNC(r.run_at) = TRUNC(SYSDATE)
    `).get(t.owner_user_id);
    const ownerRunsTotal = Number(ownerTotalRuns?.cnt || 0) || 1;

    // 該 owner 今天 token_usage(per model)
    const usages = await db.prepare(`
      SELECT model, SUM(input_tokens) AS in_t, SUM(output_tokens) AS out_t, SUM(cost) AS c
      FROM token_usage
      WHERE user_id = ? AND usage_date = ?
      GROUP BY model
    `).all(t.owner_user_id, today);

    for (const u of usages) {
      // 平攤 = 該 task run 占 owner 全 PM run 比例 × 該 owner 該 model 當日 token
      const ratio = runCount / ownerRunsTotal;
      const inT = Math.round(Number(u.in_t || 0) * ratio);
      const outT = Math.round(Number(u.out_t || 0) * ratio);
      const cost = Number(u.c || 0) * ratio;

      try {
        const exists = await db.prepare(`
          SELECT id FROM pm_task_token_usage
          WHERE task_id=? AND usage_date=? AND model=?
        `).get(t.task_id, today, u.model);

        if (exists) {
          await db.prepare(`
            UPDATE pm_task_token_usage
            SET input_tokens=?, output_tokens=?, cost=?, run_count=?, last_updated=SYSTIMESTAMP
            WHERE id=?
          `).run(inT, outT, cost, runCount, exists.id);
        } else {
          await db.prepare(`
            INSERT INTO pm_task_token_usage (task_id, usage_date, model, input_tokens, output_tokens, cost, run_count)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(t.task_id, today, u.model, inT, outT, cost, runCount);
        }
      } catch (e) { console.warn('[PmTokenBudget] upsert failed:', e.message); }
    }
  }
}

/**
 * 檢查 [PM]% 排程當日總 token 是否超 daily_token_budget;超過 → 設 token_budget_paused_at
 * scheduledTaskService.shouldRun 會看這欄(我們 patch 一下)。
 *
 * 預算重置:每天 00:00 自動 clear paused_at(在 tick 內判斷:若 paused_at 是昨天 → clear)
 */
async function enforceBudget() {
  const db = require('../database-oracle').db;
  if (!db) return;

  const tasks = await db.prepare(`
    SELECT id, name, daily_token_budget, token_budget_paused_at
    FROM scheduled_tasks
    WHERE name LIKE '[PM]%' AND daily_token_budget IS NOT NULL
  `).all();

  const today = new Date().toISOString().slice(0, 10);

  for (const t of tasks) {
    // reset:paused_at 若是昨天或更早,先解凍
    if (t.token_budget_paused_at) {
      const pausedDate = new Date(t.token_budget_paused_at).toISOString().slice(0, 10);
      if (pausedDate < today) {
        await db.prepare(`UPDATE scheduled_tasks SET token_budget_paused_at=NULL WHERE id=?`).run(t.id);
      }
    }

    // 計今日已用
    const used = await db.prepare(`
      SELECT SUM(input_tokens) + SUM(output_tokens) AS total
      FROM pm_task_token_usage WHERE task_id=? AND usage_date=?
    `).get(t.id, today);
    const usedTotal = Number(used?.total || 0);

    if (usedTotal > Number(t.daily_token_budget) && !t.token_budget_paused_at) {
      await db.prepare(`
        UPDATE scheduled_tasks SET token_budget_paused_at=SYSTIMESTAMP WHERE id=?
      `).run(t.id);
      await sendBudgetAlert({ task: t, usedTotal });
      console.warn(`[PmTokenBudget] Task#${t.id} "${t.name}" exceeded budget (${usedTotal} > ${t.daily_token_budget}) → paused`);
    }
  }
}

async function sendBudgetAlert({ task, usedTotal }) {
  try {
    const { sendMail } = require('./mailService');
    const adminEmail = process.env.ADMIN_NOTIFY_EMAIL;
    if (!adminEmail) return;
    await sendMail({
      to: adminEmail,
      subject: `[PM][Token 預算超標] ${task.name} 已暫停`,
      html: `
        <h3>PM Task Token 預算告警</h3>
        <p><b>Task:</b> ${task.name} (#${task.id})</p>
        <p><b>當日已用 tokens:</b> ${usedTotal.toLocaleString()}</p>
        <p><b>預算上限:</b> ${Number(task.daily_token_budget).toLocaleString()}</p>
        <p>系統已將此 task 標記為 <code>token_budget_paused_at</code>,今天不會再執行。</p>
        <p>明天 00:00 自動解除暫停。如需立即解除,至 admin → 排程任務頁手動清空欄位。</p>
      `,
    });
  } catch (e) { console.error('[PmTokenBudget] alert send failed:', e.message); }
}

module.exports = { startTokenBudgetCron, stopTokenBudgetCron, tick };
