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
