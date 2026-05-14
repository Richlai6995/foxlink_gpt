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
const { nextFire, isSupportedCron } = require('../services/cronNext');

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
  // schedules 子表 — 一條 rule 多個 schedule(日/週/月)
  out.schedules = await fetchSchedules(Number(id));
  return out;
}

async function fetchSchedules(ruleId) {
  const rows = await db().prepare(`
    SELECT id, rule_id, schedule_key, schedule_cron_expr, schedule_interval_minutes, lookback_days,
           cooldown_minutes, is_active, last_evaluated_at, next_evaluate_at, last_eval_result
    FROM alert_schedules WHERE rule_id=?
    ORDER BY id
  `).all(Number(ruleId));
  return (rows || []).map(r => {
    const out = {};
    for (const [k, v] of Object.entries(r)) out[k.toLowerCase()] = v;
    return out;
  });
}

// Date → 'YYYY-MM-DD HH24:MI:SS'(UTC-naive,與 alertRuleScheduler 一致)
function isoToOracleTs(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
}

// upsert schedules(by rule_id + schedule_key)— rule 儲存時呼叫
// schedules 傳 array,每個 item: { schedule_key, schedule_cron_expr, lookback_days, cooldown_minutes, is_active }
// 既有 schedule 不在新 array 內者 → 刪除(實作「同步」語意)
async function syncSchedules(ruleId, schedules) {
  if (!Array.isArray(schedules)) return { errors: ['schedules 必須是 array'] };
  const errors = [];

  // 驗:cron 跟 interval 必須二選一(至少一個);若兩者都填 cron 優先
  for (const [i, s] of schedules.entries()) {
    const hasCron = !!s.schedule_cron_expr;
    const hasInterval = s.schedule_interval_minutes != null && s.schedule_interval_minutes !== '' && Number(s.schedule_interval_minutes) > 0;
    if (!hasCron && !hasInterval) {
      errors.push(`schedule[${i}] 必須設 schedule_cron_expr 或 schedule_interval_minutes 其中之一`);
      continue;
    }
    if (hasCron && !isSupportedCron(s.schedule_cron_expr)) {
      errors.push(`schedule[${i}] cron "${s.schedule_cron_expr}" 不被支援(只支援 daily/weekly/monthly pattern)`);
    }
  }
  if (errors.length) return { errors };

  // 撈既有 schedules
  const existing = await db().prepare(
    `SELECT id, schedule_key FROM alert_schedules WHERE rule_id=?`
  ).all(Number(ruleId));
  const existingByKey = new Map();
  for (const r of (existing || [])) {
    const key = r.schedule_key || r.SCHEDULE_KEY || '';
    existingByKey.set(key, r.id || r.ID);
  }

  // 算 next_at:cron 優先,否則 interval
  function calcNext(s) {
    if (s.schedule_cron_expr) return nextFire(s.schedule_cron_expr, new Date());
    if (s.schedule_interval_minutes > 0) return new Date(Date.now() + Number(s.schedule_interval_minutes) * 60 * 1000);
    return null;
  }

  // 處理新 array
  const seenKeys = new Set();
  for (const s of schedules) {
    const key = String(s.schedule_key || '').trim();
    if (!key) { errors.push(`schedule.schedule_key 必填`); continue; }
    seenKeys.add(key);

    const cronExpr = s.schedule_cron_expr || null;
    const intervalMin = (s.schedule_interval_minutes != null && s.schedule_interval_minutes !== '' && Number(s.schedule_interval_minutes) > 0)
      ? Math.max(1, Number(s.schedule_interval_minutes))
      : null;
    const lookback = (s.lookback_days != null && s.lookback_days !== '') ? Number(s.lookback_days) : null;
    const cooldown = Number(s.cooldown_minutes) || 1440;
    const isActive = s.is_active === 0 ? 0 : 1;
    const nextAt = calcNext({ schedule_cron_expr: cronExpr, schedule_interval_minutes: intervalMin });
    const nextSql = nextAt ? isoToOracleTs(nextAt) : null;

    if (existingByKey.has(key)) {
      // UPDATE,若 cron 或 interval 變了重算 next_at(否則保留既有 — 避免無謂 reset)
      const schedId = existingByKey.get(key);
      const prev = await db().prepare(`SELECT schedule_cron_expr, schedule_interval_minutes FROM alert_schedules WHERE id=?`).get(schedId);
      const prevCron = prev?.schedule_cron_expr ?? prev?.SCHEDULE_CRON_EXPR ?? null;
      const prevInt = prev?.schedule_interval_minutes ?? prev?.SCHEDULE_INTERVAL_MINUTES ?? null;
      const changed = (prevCron !== cronExpr) || (Number(prevInt || 0) !== Number(intervalMin || 0));
      if (changed && nextSql) {
        await db().prepare(`
          UPDATE alert_schedules SET
            schedule_cron_expr=?, schedule_interval_minutes=?, lookback_days=?,
            cooldown_minutes=?, is_active=?,
            next_evaluate_at = TO_TIMESTAMP(?, 'YYYY-MM-DD HH24:MI:SS'),
            last_modified=SYSTIMESTAMP
          WHERE id=?
        `).run(cronExpr, intervalMin, lookback, cooldown, isActive, nextSql, schedId);
      } else {
        await db().prepare(`
          UPDATE alert_schedules SET
            schedule_cron_expr=?, schedule_interval_minutes=?, lookback_days=?,
            cooldown_minutes=?, is_active=?,
            last_modified=SYSTIMESTAMP
          WHERE id=?
        `).run(cronExpr, intervalMin, lookback, cooldown, isActive, schedId);
      }
    } else {
      // INSERT
      await db().prepare(`
        INSERT INTO alert_schedules
          (rule_id, schedule_key, schedule_cron_expr, schedule_interval_minutes, lookback_days,
           cooldown_minutes, is_active, next_evaluate_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, TO_TIMESTAMP(?, 'YYYY-MM-DD HH24:MI:SS'))
      `).run(Number(ruleId), key, cronExpr, intervalMin, lookback, cooldown, isActive, nextSql);
    }
  }

  // 刪除新 array 沒有的 keys
  for (const [key, schedId] of existingByKey.entries()) {
    if (!seenKeys.has(key)) {
      await db().prepare(`DELETE FROM alert_schedules WHERE id=?`).run(schedId);
    }
  }

  return { errors: [] };
}

// ── GET / — list ────────────────────────────────────────────────────────────
// LEFT JOIN alert_schedules 拉 schedule count + 最近的 next_evaluate_at(顯示用)
router.get('/', async (req, res) => {
  try {
    const u = req.user;
    const whereOwner = isAdmin(u) ? '' : `WHERE r.owner_user_id=${Number(u.id)}`;
    const rows = await db().prepare(
      `SELECT r.id, r.rule_name, r.owner_user_id, r.bound_to, r.task_id, r.node_id,
              r.entity_type, r.entity_code, r.comparison, r.severity, r.is_active,
              r.cooldown_minutes, r.schedule_interval_minutes,
              r.last_evaluated_at, r.next_evaluate_at, r.last_eval_result,
              r.creation_date, r.last_modified,
              (SELECT COUNT(*) FROM alert_schedules s WHERE s.rule_id=r.id) AS schedule_count,
              (SELECT COUNT(*) FROM alert_schedules s WHERE s.rule_id=r.id AND s.is_active=1) AS active_schedule_count,
              (SELECT MIN(s.next_evaluate_at) FROM alert_schedules s WHERE s.rule_id=r.id AND s.is_active=1) AS next_schedule_at,
              (SELECT LISTAGG(s.cooldown_minutes, '/') WITHIN GROUP (ORDER BY s.id) FROM alert_schedules s WHERE s.rule_id=r.id) AS schedule_cooldowns
       FROM alert_rules r
       ${whereOwner}
       ORDER BY r.is_active DESC, r.last_modified DESC`
    ).all();
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

    // schedules 子表 — 一條 rule 多個 schedule(日/週/月)
    if (Array.isArray(b.schedules) && b.schedules.length > 0) {
      const { errors } = await syncSchedules(id, b.schedules);
      if (errors.length) {
        // rule 已建,但 schedules 失敗 → 回 200 + errors warnings(不 rollback,讓 user 修)
        const saved = await fetchRule(id);
        return res.status(200).json({ ...saved, _schedule_warnings: errors });
      }
    }

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

    // schedules 子表 sync(若 payload 有 schedules,做 upsert-by-key + delete-not-in-array)
    let scheduleWarnings = [];
    if (Array.isArray(b.schedules)) {
      const { errors } = await syncSchedules(Number(req.params.id), b.schedules);
      scheduleWarnings = errors;
    }

    const saved = await fetchRule(req.params.id);
    if (scheduleWarnings.length) {
      return res.json({ ...saved, _schedule_warnings: scheduleWarnings });
    }
    res.json(saved);
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
    const { injectLookback } = require('../services/alertRuleScheduler');
    // 試跑強制視為 is_active=1(runTest 建 temp rule is_active=0 是為了避免 scheduler 撈到,試跑時要無視)
    // 若 SQL 含 {{lookback_days}} placeholder,試跑時用 schedules[0]?.lookback_days 或 fallback=1 替換,避免 raw template 進 Oracle
    let dataConfig = typeof r.data_config === 'string' ? r.data_config : JSON.stringify(r.data_config || {});
    if (dataConfig.includes('{{lookback_days}}')) {
      const firstSchedLookback = Array.isArray(r.schedules) && r.schedules[0]?.lookback_days != null
        ? Number(r.schedules[0].lookback_days)
        : 1;
      dataConfig = injectLookback(dataConfig, firstSchedLookback);
    }
    const inlineRule = {
      ...r,
      is_active: 1,
      data_config: dataConfig,
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
