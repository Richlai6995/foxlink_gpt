/**
 * PM Review / Feedback / Accuracy routes — Phase 5 Track B
 *
 * 路徑統一掛 /api/pm/*
 *
 * Permission gate(關鍵設計):
 *   - admin 一律通過
 *   - non-admin:必須是「貴金屬說明書(help_books.code='precious-metals')」的 share 對象
 *   - 復用 help_book_shares 表 → admin 在「特殊說明書管理」設誰能讀,自動就是誰能用 PM 功能
 *
 * 三組 endpoint:
 *   1. accuracy — admin 手動 recompute / 看 last run / 列各金屬 MAPE
 *   2. feedback — 任何 PM book 授權對象都可 thumbs(對 forecast/report/alert)
 *   3. review queue — 採購員看 LLM 改的 prompt v2,approve / reject / list
 */

const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('./auth');

const VALID_TARGET_TYPES = ['forecast', 'report', 'alert'];

// ─── PM Permission Helper(復用 help_book_shares for 'precious-metals')───
function userGranteeTuples(user) {
  const map = [
    ['user',        String(user?.id ?? '')],
    ['role',        String(user?.role_id ?? '')],
    ['factory',     String(user?.factory_code ?? '')],
    ['department',  String(user?.dept_code ?? '')],
    ['cost_center', String(user?.profit_center ?? '')],
    ['division',    String(user?.org_section ?? '')],
    ['org_group',   String(user?.org_group_name ?? '')],
  ];
  return map.filter(([, v]) => v && v !== 'null' && v !== 'undefined');
}

async function userHasPmAccess(db, user) {
  if (!user) return false;
  if (user.role === 'admin') return true;

  const book = await db.prepare(
    `SELECT id, is_special, is_active FROM help_books WHERE code = 'precious-metals'`
  ).get();
  if (!book || Number(book.is_active) === 0) return false;
  if (Number(book.is_special) === 0) return true;

  const tuples = userGranteeTuples(user);
  if (tuples.length === 0) return false;
  const orClauses = tuples.map(() => '(grantee_type = ? AND grantee_id = ?)').join(' OR ');
  const params = tuples.flatMap(([t, v]) => [t, v]);
  const row = await db.prepare(`
    SELECT 1 AS hit FROM help_book_shares
    WHERE book_id = ? AND (${orClauses})
    FETCH FIRST 1 ROWS ONLY
  `).get(book.id, ...params);
  return !!row;
}

async function verifyPmUser(req, res, next) {
  try {
    const db = require('../database-oracle').db;
    const ok = await userHasPmAccess(db, req.user);
    if (!ok) return res.status(403).json({ error: '需要貴金屬平台閱讀權限' });
    next();
  } catch (e) {
    console.error('[PmReview] verifyPmUser error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Accuracy — admin 手動觸發 / 看 last run / 列 MAPE
// ────────────────────────────────────────────────────────────────────────────

// POST /api/pm/accuracy/recompute — admin only
router.post('/accuracy/recompute', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { runOnce } = require('../services/pmForecastAccuracyService');
    const result = await runOnce();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[PmReview] /accuracy/recompute error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pm/accuracy/status — admin only:看 cron 上次跑的時間 + 結果
router.get('/accuracy/status', verifyToken, verifyAdmin, (req, res) => {
  try {
    const { getLastRunMeta } = require('../services/pmForecastAccuracyService');
    res.json(getLastRunMeta());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pm/accuracy/by-metal?days=30 — 任何 PM 授權對象都可看
// 回:每金屬最近 N 天 avg/min/max MAPE + 樣本數 + in_band 比例
router.get('/accuracy/by-metal', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const days = Math.min(Math.max(Number(req.query.days || 30), 1), 365);
    const rows = await db.prepare(`
      SELECT entity_code,
             COUNT(*)                           AS samples,
             AVG(ABS(pct_error))                AS avg_mape,
             MIN(ABS(pct_error))                AS min_mape,
             MAX(ABS(pct_error))                AS max_mape,
             SUM(CASE WHEN in_band=1 THEN 1 ELSE 0 END) AS in_band_count
      FROM pm_forecast_accuracy
      WHERE entity_type = 'metal'
        AND target_date >= TRUNC(SYSDATE) - ?
        AND pct_error IS NOT NULL
      GROUP BY entity_code
      ORDER BY avg_mape ASC
    `).all(days);
    res.json(rows.map(r => ({
      entity_code:   r.entity_code,
      samples:       Number(r.samples || 0),
      avg_mape:      r.avg_mape != null ? Number(Number(r.avg_mape).toFixed(2)) : null,
      min_mape:      r.min_mape != null ? Number(Number(r.min_mape).toFixed(2)) : null,
      max_mape:      r.max_mape != null ? Number(Number(r.max_mape).toFixed(2)) : null,
      in_band_pct:   r.samples ? Number(((Number(r.in_band_count || 0) / Number(r.samples)) * 100).toFixed(1)) : null,
    })));
  } catch (err) {
    console.error('[PmReview] /accuracy/by-metal error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pm/accuracy/timeseries?metal=Au&days=60 — 個別金屬時序 (predicted vs actual)
router.get('/accuracy/timeseries', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const metal = String(req.query.metal || '').trim();
    const days = Math.min(Math.max(Number(req.query.days || 60), 1), 365);
    if (!metal) return res.status(400).json({ error: 'metal 必填' });
    const rows = await db.prepare(`
      SELECT target_date, predicted_mean, predicted_lower, predicted_upper,
             actual_value, abs_error, pct_error, in_band
      FROM pm_forecast_accuracy
      WHERE entity_type = 'metal' AND entity_code = ?
        AND target_date >= TRUNC(SYSDATE) - ?
      ORDER BY target_date
    `).all(metal, days);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Feedback — thumbs up/down on forecast / report / alert
// ────────────────────────────────────────────────────────────────────────────

// POST /api/pm/feedback  body: { target_type, target_ref, vote(+1/-1), comment? }
router.post('/feedback', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { target_type, target_ref, vote, comment, context_meta } = req.body || {};
    if (!VALID_TARGET_TYPES.includes(target_type)) return res.status(400).json({ error: 'target_type 無效' });
    if (!target_ref) return res.status(400).json({ error: 'target_ref 必填' });
    const voteNum = Number(vote);
    if (![-1, 1].includes(voteNum)) return res.status(400).json({ error: 'vote 必須為 1 或 -1' });

    // upsert (user 重複按會更新)
    const existing = await db.prepare(`
      SELECT id FROM pm_feedback_signal WHERE target_type=? AND target_ref=? AND user_id=?
    `).get(target_type, String(target_ref), req.user.id);

    if (existing) {
      await db.prepare(`
        UPDATE pm_feedback_signal
        SET vote=?, comment=?, context_meta=?, created_at=SYSTIMESTAMP
        WHERE id=?
      `).run(voteNum, comment || null, context_meta ? JSON.stringify(context_meta) : null, existing.id);
    } else {
      await db.prepare(`
        INSERT INTO pm_feedback_signal (target_type, target_ref, user_id, vote, comment, context_meta)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(target_type, String(target_ref), req.user.id, voteNum,
             comment || null, context_meta ? JSON.stringify(context_meta) : null);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[PmReview] POST /feedback error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pm/feedback/my?target_type=&target_ref=  — 查 user 自己的 vote(回 vote=0 表示沒投)
router.get('/feedback/my', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { target_type, target_ref } = req.query;
    if (!target_type || !target_ref) return res.status(400).json({ error: 'target_type 與 target_ref 必填' });
    const row = await db.prepare(`
      SELECT vote, comment FROM pm_feedback_signal
      WHERE target_type=? AND target_ref=? AND user_id=?
    `).get(target_type, String(target_ref), req.user.id);
    res.json({ vote: row?.vote || 0, comment: row?.comment || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pm/feedback/summary?target_type=&target_ref= — aggregate(任何 PM user 可看)
router.get('/feedback/summary', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { target_type, target_ref } = req.query;
    if (!target_type || !target_ref) return res.status(400).json({ error: 'target_type 與 target_ref 必填' });
    const row = await db.prepare(`
      SELECT
        SUM(CASE WHEN vote = 1  THEN 1 ELSE 0 END) AS up_count,
        SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) AS down_count,
        COUNT(*) AS total
      FROM pm_feedback_signal
      WHERE target_type=? AND target_ref=?
    `).get(target_type, String(target_ref));
    res.json({
      up:    Number(row?.up_count || 0),
      down:  Number(row?.down_count || 0),
      total: Number(row?.total || 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Prompt Review Queue — 採購員審 LLM 改的 v2 prompt
// ────────────────────────────────────────────────────────────────────────────

// GET /api/pm/review/queue?status=pending|approved|rejected|all
router.get('/review/queue', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const status = String(req.query.status || 'pending').toLowerCase();
    const where = status === 'all' ? '' : `WHERE q.status = ?`;
    const params = status === 'all' ? [] : [status];
    const rows = await db.prepare(`
      SELECT q.id, q.skill_name, q.skill_id, q.status, q.submitted_by, q.submitted_at,
             q.reviewed_by, q.decided_at, q.review_comment,
             u.name AS reviewed_by_name
      FROM pm_prompt_review_queue q
      LEFT JOIN users u ON u.id = q.reviewed_by
      ${where}
      ORDER BY q.submitted_at DESC
      FETCH FIRST 100 ROWS ONLY
    `).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pm/review/queue/:id — 含完整 original / proposed prompt + rationale + eval
router.get('/review/queue/:id', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const row = await db.prepare(`
      SELECT q.*, u.name AS reviewed_by_name
      FROM pm_prompt_review_queue q
      LEFT JOIN users u ON u.id = q.reviewed_by
      WHERE q.id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pm/review/queue/:id/decide  body: { action: 'approve'|'reject', comment? }
// approve → 套到 skills.system_prompt;reject → 不動 skill
router.post('/review/queue/:id/decide', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { action, comment } = req.body || {};
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action 必須 approve / reject' });

    const item = await db.prepare(`SELECT * FROM pm_prompt_review_queue WHERE id=?`).get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (item.status !== 'pending') return res.status(400).json({ error: '已經處理過,目前狀態 ' + item.status });

    if (action === 'approve') {
      // 套用到 skills 表(若有對應 skill_id 或 skill_name)
      let target = null;
      if (item.skill_id) {
        target = await db.prepare(`SELECT id FROM skills WHERE id=?`).get(item.skill_id);
      }
      if (!target && item.skill_name) {
        target = await db.prepare(`SELECT id FROM skills WHERE UPPER(name)=UPPER(?)`).get(item.skill_name);
      }
      if (target?.id) {
        await db.prepare(`UPDATE skills SET system_prompt=? WHERE id=?`).run(item.proposed_prompt, target.id);
      }
    }

    await db.prepare(`
      UPDATE pm_prompt_review_queue
      SET status=?, reviewed_by=?, decided_at=SYSTIMESTAMP, review_comment=?
      WHERE id=?
    `).run(action === 'approve' ? 'approved' : 'rejected', req.user.id, comment || null, req.params.id);

    res.json({ ok: true });
  } catch (err) {
    console.error('[PmReview] POST /review/queue/:id/decide error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Webex Push Subscription — user 訂閱「每天 8:00 推 PM snapshot」
// ────────────────────────────────────────────────────────────────────────────

// GET /api/pm/subscriptions — 自己的訂閱
router.get('/subscriptions', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(`
      SELECT id, kind, schedule_hhmm, target_room_id, is_active,
             TO_CHAR(last_sent_at, 'YYYY-MM-DD HH24:MI') AS last_sent_at, last_sent_date,
             TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
      FROM pm_webex_subscription WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(req.user.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pm/subscriptions  body: { kind, schedule_hhmm? }
// kind 目前只支援 'daily_snapshot'(預留之後 weekly_summary / forecast_changed)
router.post('/subscriptions', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { kind, schedule_hhmm } = req.body || {};
    if (kind !== 'daily_snapshot') return res.status(400).json({ error: '目前只支援 daily_snapshot' });
    const hhmm = String(schedule_hhmm || '08:00').trim();
    if (!/^\d{2}:\d{2}$/.test(hhmm)) return res.status(400).json({ error: 'schedule_hhmm 需為 HH:MM 格式' });

    try {
      await db.prepare(`
        INSERT INTO pm_webex_subscription (user_id, kind, schedule_hhmm, is_active)
        VALUES (?, ?, ?, 1)
      `).run(req.user.id, kind, hhmm);
    } catch (e) {
      if (String(e.message || '').match(/ORA-00001|UNIQUE/)) {
        // 已存在 → 改成 update(視為 enable + 改時間)
        await db.prepare(`
          UPDATE pm_webex_subscription SET schedule_hhmm=?, is_active=1
          WHERE user_id=? AND kind=?
        `).run(hhmm, req.user.id, kind);
      } else throw e;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/pm/subscriptions/:id  body: { is_active?, schedule_hhmm? }
router.patch('/subscriptions/:id', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { is_active, schedule_hhmm } = req.body || {};
    const own = await db.prepare(`SELECT user_id FROM pm_webex_subscription WHERE id=?`).get(req.params.id);
    if (!own || own.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    if (schedule_hhmm && !/^\d{2}:\d{2}$/.test(String(schedule_hhmm))) {
      return res.status(400).json({ error: 'schedule_hhmm 格式錯誤' });
    }
    await db.prepare(`
      UPDATE pm_webex_subscription
      SET is_active = COALESCE(?, is_active),
          schedule_hhmm = COALESCE(?, schedule_hhmm)
      WHERE id = ?
    `).run(
      is_active != null ? Number(is_active) : null,
      schedule_hhmm || null,
      req.params.id,
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pm/subscriptions/:id
router.delete('/subscriptions/:id', verifyToken, verifyPmUser, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const own = await db.prepare(`SELECT user_id FROM pm_webex_subscription WHERE id=?`).get(req.params.id);
    if (!own || own.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    await db.prepare(`DELETE FROM pm_webex_subscription WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Phase 5 Track F: 健康儀表板 / Source / Token / KB 維護(admin only)
// ────────────────────────────────────────────────────────────────────────────

// GET /api/pm/admin/health/tasks?days=7 — F1 健康儀表板:每個 [PM] task 統計
router.get('/admin/health/tasks', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const days = Math.min(Math.max(Number(req.query.days || 7), 1), 90);
    const rows = await db.prepare(`
      SELECT t.id, t.name, t.status, t.daily_token_budget, t.token_budget_paused_at,
             COUNT(r.id)                                                AS run_count,
             SUM(CASE WHEN r.status='ok' THEN 1 ELSE 0 END)             AS success_count,
             SUM(CASE WHEN r.status<>'ok' THEN 1 ELSE 0 END)            AS fail_count,
             AVG(r.duration_ms)                                          AS avg_duration_ms,
             MAX(r.run_at)                                               AS last_run_at,
             MAX(r.status) KEEP (DENSE_RANK LAST ORDER BY r.run_at)      AS last_status,
             (SELECT SUM(input_tokens + output_tokens)
                FROM pm_task_token_usage u
                WHERE u.task_id = t.id AND u.usage_date >= TO_CHAR(SYSDATE - ?, 'YYYY-MM-DD')) AS total_tokens,
             (SELECT SUM(cost)
                FROM pm_task_token_usage u
                WHERE u.task_id = t.id AND u.usage_date >= TO_CHAR(SYSDATE - ?, 'YYYY-MM-DD')) AS total_cost
      FROM scheduled_tasks t
      LEFT JOIN scheduled_task_runs r ON r.task_id = t.id AND r.run_at >= SYSDATE - ?
      WHERE t.name LIKE '[PM]%'
      GROUP BY t.id, t.name, t.status, t.daily_token_budget, t.token_budget_paused_at
      ORDER BY t.name
    `).all(days, days, days);
    res.json(rows);
  } catch (err) {
    console.error('[PmReview] /admin/health/tasks error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pm/admin/health/run-errors?task_id=&limit=20 — 看最近 N 次 fail 詳情
router.get('/admin/health/run-errors', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const taskId = Number(req.query.task_id);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    if (!taskId) return res.status(400).json({ error: 'task_id required' });
    const rows = await db.prepare(`
      SELECT id, run_at, status, duration_ms, error_msg, response_preview
      FROM scheduled_task_runs
      WHERE task_id = ? AND status <> 'ok'
      ORDER BY run_at DESC
      FETCH FIRST ? ROWS ONLY
    `).all(taskId, limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/pm/admin/tasks/:id/budget body: { daily_token_budget }
router.patch('/admin/tasks/:id/budget', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { daily_token_budget } = req.body || {};
    const v = daily_token_budget == null ? null : Math.max(0, Number(daily_token_budget));
    await db.prepare(`UPDATE scheduled_tasks SET daily_token_budget=? WHERE id=?`).run(v, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pm/admin/tasks/:id/clear-budget-pause
router.post('/admin/tasks/:id/clear-budget-pause', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(`UPDATE scheduled_tasks SET token_budget_paused_at=NULL WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pm/admin/sources — F3 source 健康列表
router.get('/admin/sources', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(`
      SELECT id, source_url, source_label,
             TO_CHAR(last_check_at, 'YYYY-MM-DD HH24:MI') AS last_check_at,
             last_status, last_http_status, last_error, last_response_ms,
             consecutive_failures, is_disabled,
             TO_CHAR(last_alerted_at, 'YYYY-MM-DD HH24:MI') AS last_alerted_at
      FROM pm_source_health
      ORDER BY is_disabled DESC, consecutive_failures DESC, source_label
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pm/admin/sources/check-now — F3 手動觸發
router.post('/admin/sources/check-now', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { runOnce } = require('../services/pmSourceHealthService');
    const r = await runOnce();
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pm/admin/cost?days=30 — F5 cost dashboard:per-task 月度成本
router.get('/admin/cost', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const days = Math.min(Math.max(Number(req.query.days || 30), 1), 365);
    const rows = await db.prepare(`
      SELECT u.task_id, t.name AS task_name, u.usage_date, u.model,
             SUM(u.input_tokens) AS input_tokens,
             SUM(u.output_tokens) AS output_tokens,
             SUM(u.cost) AS cost,
             SUM(u.run_count) AS run_count
      FROM pm_task_token_usage u
      JOIN scheduled_tasks t ON t.id = u.task_id
      WHERE u.usage_date >= TO_CHAR(SYSDATE - ?, 'YYYY-MM-DD')
      GROUP BY u.task_id, t.name, u.usage_date, u.model
      ORDER BY u.usage_date DESC, t.name
    `).all(days);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pm/admin/token/aggregate-now — F5 手動觸發 aggregator
router.post('/admin/token/aggregate-now', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { tick } = require('../services/pmTokenBudgetService');
    await tick();

    // 跑完回診斷,讓 admin 知道為什麼空(若空)
    const taskCount = await db.prepare(
      `SELECT COUNT(*) AS n FROM scheduled_tasks WHERE name LIKE '[PM]%' AND user_id IS NOT NULL`
    ).get();
    const runCount = await db.prepare(
      `SELECT COUNT(*) AS n FROM scheduled_task_runs r
       JOIN scheduled_tasks t ON t.id = r.task_id
       WHERE t.name LIKE '[PM]%' AND r.run_at >= SYSDATE - 30`
    ).get();
    const usagePresent = await db.prepare(
      `SELECT COUNT(*) AS n FROM token_usage tu
       WHERE tu.user_id IN (SELECT user_id FROM scheduled_tasks WHERE name LIKE '[PM]%' AND user_id IS NOT NULL)
         AND tu.usage_date >= SYSDATE - 30`
    ).get();
    const aggregatedRows = await db.prepare(
      `SELECT COUNT(*) AS n FROM pm_task_token_usage WHERE usage_date >= SYSDATE - 30`
    ).get();

    res.json({
      ok: true,
      diagnostics: {
        pm_tasks_with_user_id: Number(taskCount?.n ?? taskCount?.N ?? 0),
        pm_task_runs_30d:      Number(runCount?.n ?? runCount?.N ?? 0),
        token_usage_rows_30d_for_pm_owners: Number(usagePresent?.n ?? usagePresent?.N ?? 0),
        pm_task_token_usage_after_aggregate: Number(aggregatedRows?.n ?? aggregatedRows?.N ?? 0),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pm/admin/kb-maintenance/run-now body: { dry_run? } — F4 手動 / kb maintenance
router.post('/admin/kb-maintenance/run-now', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { runOnce } = require('../services/pmKbMaintenanceService');
    const dryRun = req.body?.dry_run !== false;  // 預設 dry_run
    const r = await runOnce({ dryRun });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pm/admin/kb-maintenance/restore body: { kb_id }
router.post('/admin/kb-maintenance/restore', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { restoreArchived } = require('../services/pmKbMaintenanceService');
    const kbId = Number(req.body?.kb_id);
    if (!kbId) return res.status(400).json({ error: 'kb_id required' });
    const r = await restoreArchived({ kbId });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Phase 5 Track A: ERP Sync framework — admin only
// ────────────────────────────────────────────────────────────────────────────

// GET /api/pm/admin/erp-sync/jobs
router.get('/admin/erp-sync/jobs', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(`
      SELECT id, name, description, source_db_id, target_pm_table,
             upsert_mode, upsert_keys, schedule_interval_minutes,
             is_active, is_dry_run, last_status, last_rows_synced, last_error,
             TO_CHAR(last_run_at, 'YYYY-MM-DD HH24:MI') AS last_run_at,
             TO_CHAR(created_at,  'YYYY-MM-DD HH24:MI') AS created_at,
             TO_CHAR(last_modified, 'YYYY-MM-DD HH24:MI') AS last_modified
      FROM pm_erp_sync_job ORDER BY name
    `).all();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/pm/admin/erp-sync/jobs/:id  含完整 source_query / mapping_json
router.get('/admin/erp-sync/jobs/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const r = await db.prepare(`SELECT * FROM pm_erp_sync_job WHERE id = ?`).get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/pm/admin/erp-sync/jobs — create new
router.post('/admin/erp-sync/jobs', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const f = req.body || {};
    if (!f.name || !f.target_pm_table || !f.source_query) {
      return res.status(400).json({ error: 'name / target_pm_table / source_query 必填' });
    }
    if (!/^pm_[a-z_]+$/.test(String(f.target_pm_table).toLowerCase())) {
      return res.status(400).json({ error: 'target_pm_table 必須 pm_* 開頭' });
    }
    await db.prepare(`
      INSERT INTO pm_erp_sync_job (
        name, description, source_db_id, target_pm_table, source_query,
        bind_params_json, mapping_json, upsert_mode, upsert_keys,
        schedule_interval_minutes, is_active, is_dry_run
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      f.name, f.description || null, f.source_db_id || null, f.target_pm_table,
      f.source_query, f.bind_params_json || '[]', f.mapping_json || '{}',
      f.upsert_mode || 'upsert', f.upsert_keys || null,
      Number(f.schedule_interval_minutes || 1440),
      Number(f.is_active || 0), Number(f.is_dry_run != null ? f.is_dry_run : 1),
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/pm/admin/erp-sync/jobs/:id
router.patch('/admin/erp-sync/jobs/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const f = req.body || {};
    const fields = [];
    const values = [];
    const allowed = ['name', 'description', 'source_db_id', 'target_pm_table', 'source_query',
                     'bind_params_json', 'mapping_json', 'upsert_mode', 'upsert_keys',
                     'schedule_interval_minutes', 'is_active', 'is_dry_run'];
    for (const k of allowed) {
      if (f[k] !== undefined) {
        fields.push(`${k} = ?`);
        values.push(f[k]);
      }
    }
    if (fields.length === 0) return res.json({ ok: true, noop: true });
    fields.push(`last_modified = SYSTIMESTAMP`);
    values.push(req.params.id);
    await db.prepare(`UPDATE pm_erp_sync_job SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/pm/admin/erp-sync/jobs/:id
router.delete('/admin/erp-sync/jobs/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(`DELETE FROM pm_erp_sync_job WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/pm/admin/erp-sync/jobs/:id/run-now  body: { force_dry_run? }
router.post('/admin/erp-sync/jobs/:id/run-now', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const job = await db.prepare(`SELECT * FROM pm_erp_sync_job WHERE id = ?`).get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    const { runJob } = require('../services/pmErpSyncService');
    const r = await runJob(db, job, { forceDryRun: !!req.body?.force_dry_run });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pm/admin/erp-sync/jobs/:id/preview — 跑 SELECT 不寫,回前 10 row
router.post('/admin/erp-sync/jobs/:id/preview', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const job = await db.prepare(`SELECT * FROM pm_erp_sync_job WHERE id = ?`).get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    const { previewJob } = require('../services/pmErpSyncService');
    const r = await previewJob(db, job, 10);
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pm/admin/erp-sync/jobs/:id/logs?limit=20
router.get('/admin/erp-sync/jobs/:id/logs', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const rows = await db.prepare(`
      SELECT id, status, rows_fetched, rows_synced, duration_ms, error_msg,
             TO_CHAR(started_at,  'YYYY-MM-DD HH24:MI:SS') AS started_at,
             TO_CHAR(finished_at, 'YYYY-MM-DD HH24:MI:SS') AS finished_at,
             sample_row
      FROM pm_erp_sync_log
      WHERE job_id = ?
      ORDER BY started_at DESC
      FETCH FIRST ? ROWS ONLY
    `).all(req.params.id, limit);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/pm/review/run-self-improve — admin 手動觸發 meta-job
router.post('/review/run-self-improve', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { runSelfImproveOnce } = require('../services/pmPromptSelfImproveService');
    const result = await runSelfImproveOnce();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[PmReview] POST /review/run-self-improve error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
