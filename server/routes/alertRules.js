'use strict';

/**
 * Alert Rules Admin API
 *
 * Mount 在 /api/alert-rules:
 *   GET    /                  list(admin 看全部 / 一般 user 只看 owner=自己)
 *   GET    /:id               get one
 *   POST   /                  create(rule_name + comparison + actions 必填)
 *   PUT    /:id               update
 *   DELETE /:id               delete
 *   POST   /:id/test          dry-run 模擬觸發(不真發通知)
 *   GET    /:id/history       撈該規則最近 N 次 pm_alert_history
 *   POST   /sync-pipeline     pipeline 節點儲存時呼叫,upsert 對應 alert_rules
 *
 * 權限:
 *   - admin role 可看 / 改所有規則
 *   - 一般 user 只能看自己 owner 的規則(owner_user_id = self)
 *   - is_active toggle 與 cooldown_minutes 等 admin-only 欄位:UI 自行 disable
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');

router.use(verifyToken);

const db = () => require('../database-oracle').db;

// ── Permission helper ───────────────────────────────────────────────────────
function isAdmin(user) {
  return user?.role === 'admin' || user?.is_pipeline_admin === 1 || user?.is_pipeline_admin === true;
}

async function fetchRule(id) {
  const row = await db().prepare(`SELECT * FROM alert_rules WHERE id=?`).get(Number(id));
  if (!row) return null;
  // 大小寫容錯 + JSON 欄解析
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k.toLowerCase()] = v;
  for (const f of ['data_config', 'comparison_config', 'actions']) {
    try { out[f] = out[f] ? JSON.parse(out[f]) : null; } catch (_) {}
  }
  return out;
}

// ── GET / — list ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const u = req.user;
    let rows;
    if (isAdmin(u)) {
      rows = await db().prepare(
        `SELECT id, rule_name, owner_user_id, bound_to, task_id, node_id,
                entity_type, entity_code, comparison, severity, is_active,
                cooldown_minutes, schedule_interval_minutes,
                last_evaluated_at, next_evaluate_at, last_eval_result,
                creation_date, last_modified
         FROM alert_rules ORDER BY is_active DESC, last_modified DESC`
      ).all();
    } else {
      rows = await db().prepare(
        `SELECT id, rule_name, owner_user_id, bound_to, task_id, node_id,
                entity_type, entity_code, comparison, severity, is_active,
                cooldown_minutes, schedule_interval_minutes,
                last_evaluated_at, next_evaluate_at, last_eval_result,
                creation_date, last_modified
         FROM alert_rules WHERE owner_user_id=? ORDER BY is_active DESC, last_modified DESC`
      ).all(u.id);
    }
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /:id ────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const r = await fetchRule(req.params.id);
    if (!r) return res.status(404).json({ error: 'not found' });
    if (!isAdmin(req.user) && Number(r.owner_user_id) !== req.user.id) {
      return res.status(403).json({ error: '無權存取' });
    }
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST / — create ────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const u = req.user;
    const b = req.body || {};
    if (!b.rule_name) return res.status(400).json({ error: 'rule_name 必填' });
    if (!b.comparison) return res.status(400).json({ error: 'comparison 必填' });
    const validComp = ['threshold', 'historical_avg', 'rate_change', 'zscore'];
    if (!validComp.includes(b.comparison)) return res.status(400).json({ error: `comparison 必為 ${validComp.join('/')}` });

    const boundTo = b.bound_to || 'standalone';
    const scheduleMin = boundTo === 'standalone' && b.schedule_interval_minutes
      ? Math.max(1, Number(b.schedule_interval_minutes))
      : null;

    const ins = await db().prepare(`
      INSERT INTO alert_rules
        (rule_name, owner_user_id, bound_to, task_id, node_id,
         entity_type, entity_code, data_source, data_config,
         comparison, comparison_config, severity, actions,
         message_template, use_llm_analysis, cooldown_minutes, dedup_key, is_active,
         schedule_interval_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.rule_name, u.id,
      boundTo,
      b.task_id || null, b.node_id || null,
      b.entity_type || null, b.entity_code || null,
      b.data_source || (boundTo === 'standalone' ? 'sql_query' : 'upstream_json'),
      typeof b.data_config === 'string' ? b.data_config : JSON.stringify(b.data_config || {}),
      b.comparison,
      typeof b.comparison_config === 'string' ? b.comparison_config : JSON.stringify(b.comparison_config || {}),
      b.severity || 'warning',
      typeof b.actions === 'string' ? b.actions : JSON.stringify(b.actions || []),
      b.message_template || null,
      b.use_llm_analysis ? 1 : 0,
      Number(b.cooldown_minutes) || 60,
      b.dedup_key || null,
      b.is_active === 0 ? 0 : 1,
      scheduleMin,
    );
    const id = ins.lastInsertRowid;
    res.json(await fetchRule(id));
  } catch (e) {
    if (/ORA-00001/.test(e.message)) {
      return res.status(409).json({ error: '同 (task_id, node_id) 已存在規則,請改用 PUT 更新' });
    }
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /:id ────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const r = await fetchRule(req.params.id);
    if (!r) return res.status(404).json({ error: 'not found' });
    if (!isAdmin(req.user) && Number(r.owner_user_id) !== req.user.id) {
      return res.status(403).json({ error: '無權修改' });
    }
    const b = req.body || {};
    // schedule_interval_minutes:只有 standalone 規則才有意義;<= 0 視為 null(等於停止輪詢)
    let nextSchedMin = r.schedule_interval_minutes;
    if (b.schedule_interval_minutes !== undefined) {
      const n = Number(b.schedule_interval_minutes);
      nextSchedMin = (n > 0) ? Math.max(1, n) : null;
    }

    await db().prepare(`
      UPDATE alert_rules SET
        rule_name=?, entity_type=?, entity_code=?,
        data_source=?, data_config=?,
        comparison=?, comparison_config=?, severity=?,
        actions=?, message_template=?, use_llm_analysis=?,
        cooldown_minutes=?, dedup_key=?, is_active=?,
        schedule_interval_minutes=?,
        last_modified=SYSTIMESTAMP
      WHERE id=?
    `).run(
      b.rule_name ?? r.rule_name,
      b.entity_type ?? r.entity_type,
      b.entity_code ?? r.entity_code,
      b.data_source ?? r.data_source,
      typeof b.data_config === 'string' ? b.data_config : (b.data_config !== undefined ? JSON.stringify(b.data_config) : (r.data_config ? JSON.stringify(r.data_config) : null)),
      b.comparison ?? r.comparison,
      typeof b.comparison_config === 'string' ? b.comparison_config : (b.comparison_config !== undefined ? JSON.stringify(b.comparison_config) : (r.comparison_config ? JSON.stringify(r.comparison_config) : null)),
      b.severity ?? r.severity,
      typeof b.actions === 'string' ? b.actions : (b.actions !== undefined ? JSON.stringify(b.actions) : (r.actions ? JSON.stringify(r.actions) : '[]')),
      b.message_template ?? r.message_template,
      b.use_llm_analysis !== undefined ? (b.use_llm_analysis ? 1 : 0) : r.use_llm_analysis,
      b.cooldown_minutes !== undefined ? Number(b.cooldown_minutes) : r.cooldown_minutes,
      b.dedup_key ?? r.dedup_key,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : r.is_active,
      nextSchedMin,
      Number(req.params.id),
    );
    res.json(await fetchRule(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /:id ─────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const r = await fetchRule(req.params.id);
    if (!r) return res.status(404).json({ error: 'not found' });
    if (!isAdmin(req.user) && Number(r.owner_user_id) !== req.user.id) {
      return res.status(403).json({ error: '無權刪除' });
    }
    await db().prepare(`DELETE FROM alert_rules WHERE id=?`).run(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /:id/test — dry-run ────────────────────────────────────────────────
router.post('/:id/test', async (req, res) => {
  try {
    const r = await fetchRule(req.params.id);
    if (!r) return res.status(404).json({ error: 'not found' });
    if (!isAdmin(req.user) && Number(r.owner_user_id) !== req.user.id) {
      return res.status(403).json({ error: '無權測試' });
    }
    const sourceText = req.body?.source_text || '';
    const { executeAlert } = require('../services/pipelineAlerter');
    // 用 _inline_rule 模式,不走 DB lookup,免影響真實 cooldown
    const inlineRule = {
      ...r,
      data_config: typeof r.data_config === 'string' ? r.data_config : JSON.stringify(r.data_config || {}),
      comparison_config: typeof r.comparison_config === 'string' ? r.comparison_config : JSON.stringify(r.comparison_config || {}),
      actions: typeof r.actions === 'string' ? r.actions : JSON.stringify(r.actions || []),
    };
    const result = await executeAlert(db(), { id: 'test', _inline_rule: inlineRule }, sourceText, {
      user: req.user,
      userId: req.user.id,
      runId: Date.now(),
      taskId: r.task_id || null,
      taskName: 'TEST',
      nodeId: 'test',
      dryRun: true,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message, partial: e._partialResult || null });
  }
});

// ── GET /:id/history ────────────────────────────────────────────────────────
router.get('/:id/history', async (req, res) => {
  try {
    const r = await fetchRule(req.params.id);
    if (!r) return res.status(404).json({ error: 'not found' });
    if (!isAdmin(req.user) && Number(r.owner_user_id) !== req.user.id) {
      return res.status(403).json({ error: '無權查看' });
    }
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const rows = await db().prepare(`
      SELECT id, triggered_at, severity, entity_type, entity_code,
             trigger_value, threshold_value, message, llm_analysis,
             channels_sent, ack_user_id, ack_at
      FROM pm_alert_history
      WHERE rule_id=?
      ORDER BY triggered_at DESC
      FETCH FIRST ${limit} ROWS ONLY
    `).all(Number(req.params.id));
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /sync-pipeline — pipeline 節點儲存後呼叫 ─────────────────────────
// body: { task_id, node_id, rule: { rule_name, comparison, ... } }
// 用 (task_id, node_id) UNIQUE 做 upsert
router.post('/sync-pipeline', async (req, res) => {
  try {
    const { task_id, node_id, rule } = req.body || {};
    if (!task_id || !node_id || !rule) return res.status(400).json({ error: 'task_id, node_id, rule 必填' });

    const existing = await db().prepare(
      `SELECT id, owner_user_id FROM alert_rules WHERE task_id=? AND node_id=?`
    ).get(Number(task_id), node_id);

    if (existing) {
      if (!isAdmin(req.user) && Number(existing.owner_user_id) !== req.user.id) {
        return res.status(403).json({ error: '無權修改該節點對應規則(owner 不符)' });
      }
      await db().prepare(`
        UPDATE alert_rules SET
          rule_name=?, entity_type=?, entity_code=?,
          data_source=?, data_config=?,
          comparison=?, comparison_config=?, severity=?,
          actions=?, message_template=?, use_llm_analysis=?,
          cooldown_minutes=?, dedup_key=?, is_active=?,
          last_modified=SYSTIMESTAMP
        WHERE id=?
      `).run(
        rule.rule_name, rule.entity_type || null, rule.entity_code || null,
        rule.data_source || 'upstream_json',
        typeof rule.data_config === 'string' ? rule.data_config : JSON.stringify(rule.data_config || {}),
        rule.comparison,
        typeof rule.comparison_config === 'string' ? rule.comparison_config : JSON.stringify(rule.comparison_config || {}),
        rule.severity || 'warning',
        typeof rule.actions === 'string' ? rule.actions : JSON.stringify(rule.actions || []),
        rule.message_template || null,
        rule.use_llm_analysis ? 1 : 0,
        Number(rule.cooldown_minutes) || 60,
        rule.dedup_key || null,
        rule.is_active === 0 ? 0 : 1,
        existing.id || existing.ID,
      );
    } else {
      await db().prepare(`
        INSERT INTO alert_rules
          (rule_name, owner_user_id, bound_to, task_id, node_id,
           entity_type, entity_code, data_source, data_config,
           comparison, comparison_config, severity, actions,
           message_template, use_llm_analysis, cooldown_minutes, dedup_key, is_active)
        VALUES (?, ?, 'pipeline_node', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        rule.rule_name, req.user.id,
        Number(task_id), node_id,
        rule.entity_type || null, rule.entity_code || null,
        rule.data_source || 'upstream_json',
        typeof rule.data_config === 'string' ? rule.data_config : JSON.stringify(rule.data_config || {}),
        rule.comparison,
        typeof rule.comparison_config === 'string' ? rule.comparison_config : JSON.stringify(rule.comparison_config || {}),
        rule.severity || 'warning',
        typeof rule.actions === 'string' ? rule.actions : JSON.stringify(rule.actions || []),
        rule.message_template || null,
        rule.use_llm_analysis ? 1 : 0,
        Number(rule.cooldown_minutes) || 60,
        rule.dedup_key || null,
        rule.is_active === 0 ? 0 : 1,
      );
    }

    const r = await db().prepare(
      `SELECT * FROM alert_rules WHERE task_id=? AND node_id=?`
    ).get(Number(task_id), node_id);
    res.json({ ok: true, rule: r || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
