'use strict';

/**
 * Pipeline Alerter (Phase 3 D15-18)
 *
 * 被 pipelineRunner.js 的 `alert` 節點呼叫。生命週期:
 *   1. 從 DB 找對應 alert_rules row(by task_id+node_id;若 inline 設定也接受 node 內含 rule 物件)
 *   2. 從 data_source 取值(upstream_json / sql_query / literal)
 *   3. 套 comparison(threshold / historical_avg / rate_change / zscore)→ 觸發 / 不觸發
 *   4. 觸發時:Cooldown 檢查(Redis SET NX EX with dedup_key)
 *   5. 組訊息(template + 可選 LLM 分析)
 *   6. 跑 actions(alert_history INSERT / Email / Webex / Webhook)
 *
 * 與 db_write / kb_write 共用模式:
 *   - 完全 idempotent
 *   - dry_run 支援(只計算 + 預覽 actions,不真寫 DB / 不發通知)
 *   - 單筆 row 失敗不影響其他 actions
 *
 * 4 種 comparison 模式(comparison_config 內部結構各異):
 *   1. threshold:        { operator: 'gt|lt|gte|lte|eq|ne', value: <num> }
 *   2. historical_avg:   { operator, period_days: 7, deviation_pct: 20 }
 *      → 取 sql_query 過去 N 天平均,當前值偏離 > deviation_pct 才觸發
 *   3. rate_change:      { operator, period_days: 1, threshold_pct: 5 }
 *      → 跟 N 天前同欄位比,變化率 > threshold_pct 才觸發
 *   4. zscore:           { period_days: 30, sigma: 2 }
 *      → 算過去 N 天均值 + 標準差,|當前值 - mean| / std > sigma 才觸發
 *
 * 4 種 action(actions 是 JSON array):
 *   - { type: 'alert_history' }            (永遠記到 pm_alert_history,不寫也會自動加)
 *   - { type: 'email', to: ['a@x.com'] }
 *   - { type: 'webex', room_id: '...' }
 *   - { type: 'webhook', url: 'https://...', method: 'POST', headers: {} }
 */

const { tryLock } = require('./redisClient');

// ── 取出 alert_rules row:支援 inline node config 或 DB row ───────────────
async function loadOrInlineRule(db, node, context) {
  // 1) inline node 直接帶 rule 完整設定 → 用節點上的(優先,適合 dry-run)
  if (node._inline_rule) {
    return { ...node._inline_rule, _from: 'inline' };
  }

  // 2) 查 DB:by (task_id, node_id) 唯一索引
  const taskId = context.taskId || null;
  const nodeId = node.id || null;
  if (taskId && nodeId) {
    try {
      const row = await db.prepare(
        `SELECT * FROM alert_rules WHERE task_id=? AND node_id=? FETCH FIRST 1 ROWS ONLY`
      ).get(taskId, nodeId);
      if (row) return { ...normalizeRuleRow(row), _from: 'db' };
    } catch (_) {}
  }

  // 3) Fallback:從 node 自己的 fields 拼一個臨時 rule(不含 actions / cooldown 等)
  if (node.comparison || node.message_template) {
    return {
      rule_name: node.label || `node_${nodeId || 'inline'}`,
      bound_to: 'pipeline_node',
      task_id: taskId,
      node_id: nodeId,
      data_source: node.data_source || 'upstream_json',
      data_config: typeof node.data_config === 'string' ? node.data_config : JSON.stringify(node.data_config || {}),
      comparison: node.comparison || 'threshold',
      comparison_config: typeof node.comparison_config === 'string' ? node.comparison_config : JSON.stringify(node.comparison_config || {}),
      severity: node.severity || 'warning',
      actions: typeof node.actions === 'string' ? node.actions : JSON.stringify(node.actions || []),
      message_template: node.message_template || '',
      use_llm_analysis: node.use_llm_analysis ? 1 : 0,
      cooldown_minutes: Number(node.cooldown_minutes) || 60,
      dedup_key: node.dedup_key || null,
      is_active: 1,
      _from: 'node_fallback',
    };
  }

  return null;
}

function normalizeRuleRow(r) {
  // Oracle 大小寫差異容錯
  const out = {};
  for (const [k, v] of Object.entries(r)) out[k.toLowerCase()] = v;
  return out;
}

function safeJsonParse(s, fallback = {}) {
  if (s == null || s === '') return fallback;
  if (typeof s === 'object') return s;
  try { return JSON.parse(String(s)); } catch { return fallback; }
}

// ── JSONPath 簡版(同 db_write / kb_write)──────────────────────────────
function getByJsonPath(obj, path) {
  if (!path) return obj;
  let p = path.trim();
  if (p.startsWith('$')) p = p.slice(1);
  if (p.startsWith('.')) p = p.slice(1);
  if (!p) return obj;
  p = p.replace(/\[(\d+|\*)\]/g, '.$1');
  const parts = p.split('.').filter(Boolean);
  let cur = obj;
  for (const part of parts) {
    if (cur == null) return null;
    if (part === '*') return Array.isArray(cur) ? cur : null;
    cur = cur[part];
  }
  return cur;
}

// ── 取資料(回傳 number 或 number[] 或 null)──────────────────────────────
async function fetchValue(db, dataSource, dataConfig, sourceText) {
  const cfg = safeJsonParse(dataConfig, {});

  if (dataSource === 'literal') {
    return cfg.value != null ? Number(cfg.value) : null;
  }

  if (dataSource === 'upstream_json') {
    // 從上游 sourceText 抽 JSON,再用 jsonpath 取
    let parsed;
    try {
      // 找 fenced block
      const fenced = String(sourceText || '').match(/```(?:json)?\s*\n([\s\S]*?)```/i);
      const raw = fenced ? fenced[1] : sourceText;
      parsed = JSON.parse(raw);
    } catch (_) {
      // 可能是純 JSON 也可能整段都是 markdown,試大括號 / 中括號抽取
      const arrM = String(sourceText || '').match(/(\[[\s\S]*\])/);
      const objM = String(sourceText || '').match(/(\{[\s\S]*\})/);
      if (arrM) { try { parsed = JSON.parse(arrM[1]); } catch (_) {} }
      if (!parsed && objM) { try { parsed = JSON.parse(objM[1]); } catch (_) {} }
    }
    if (parsed == null) return null;
    const v = getByJsonPath(parsed, cfg.jsonpath || '$.value');
    if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
    return Number.isFinite(Number(v)) ? Number(v) : null;
  }

  if (dataSource === 'sql_query') {
    if (!cfg.sql) throw new Error('sql_query mode 需 data_config.sql');
    // 限制:只允許 SELECT
    if (!/^\s*SELECT/i.test(cfg.sql)) throw new Error('alert sql_query 只允許 SELECT');
    const rows = await db.prepare(cfg.sql).all();
    if (!rows || !rows.length) return null;
    // 取第一個欄位的所有值;若 single value 就回 number
    const firstKey = Object.keys(rows[0])[0];
    const vals = rows.map(r => Number(r[firstKey])).filter(Number.isFinite);
    if (vals.length === 1) return vals[0];
    return vals;
  }

  return null;
}

// ── 4 種比較模式 ───────────────────────────────────────────────────────────
function compareThreshold(currentValue, cfg) {
  if (currentValue == null) return { triggered: false, reason: 'no value' };
  const op = cfg.operator || 'gt';
  const target = Number(cfg.value);
  if (!Number.isFinite(target)) return { triggered: false, reason: 'invalid threshold' };

  let triggered = false;
  switch (op) {
    case 'gt':  triggered = currentValue >  target; break;
    case 'lt':  triggered = currentValue <  target; break;
    case 'gte': triggered = currentValue >= target; break;
    case 'lte': triggered = currentValue <= target; break;
    case 'eq':  triggered = currentValue === target; break;
    case 'ne':  triggered = currentValue !== target; break;
    default: return { triggered: false, reason: `unknown op ${op}` };
  }
  return {
    triggered,
    reason: triggered ? `${currentValue} ${op} ${target}` : `not triggered (${currentValue} vs ${target})`,
    trigger_value: currentValue,
    threshold_value: target,
  };
}

function compareHistoricalAvg(historicalSeries, currentValue, cfg) {
  if (!Array.isArray(historicalSeries) || historicalSeries.length < 2) {
    return { triggered: false, reason: 'historical series too short' };
  }
  if (currentValue == null) return { triggered: false, reason: 'no current value' };
  const avg = historicalSeries.reduce((a, b) => a + b, 0) / historicalSeries.length;
  const deviationPct = avg !== 0 ? Math.abs((currentValue - avg) / avg) * 100 : 0;
  const limit = Number(cfg.deviation_pct) || 20;
  const triggered = deviationPct > limit;
  return {
    triggered,
    reason: triggered ? `${currentValue} 偏離 7d 均值 ${avg.toFixed(2)} (${deviationPct.toFixed(1)}%) > ${limit}%` :
                        `偏離 ${deviationPct.toFixed(1)}% 在容忍 ${limit}% 內`,
    trigger_value: currentValue,
    threshold_value: avg,
  };
}

function compareRateChange(historicalSeries, currentValue, cfg) {
  if (!Array.isArray(historicalSeries) || historicalSeries.length < 1) {
    return { triggered: false, reason: 'no historical baseline' };
  }
  if (currentValue == null) return { triggered: false, reason: 'no current value' };
  const baseline = historicalSeries[0]; // sql_query 應該回傳 [N 天前的值]
  if (!Number.isFinite(baseline) || baseline === 0) return { triggered: false, reason: 'invalid baseline' };
  const changePct = ((currentValue - baseline) / baseline) * 100;
  const limit = Number(cfg.threshold_pct) || 5;
  const op = cfg.operator || 'abs';  // abs / up / down
  let triggered;
  if (op === 'up')   triggered = changePct >  limit;
  else if (op === 'down') triggered = changePct < -limit;
  else                triggered = Math.abs(changePct) > limit;
  return {
    triggered,
    reason: triggered ? `變化率 ${changePct.toFixed(2)}% (${op}) 超過閾值 ${limit}%` :
                        `變化率 ${changePct.toFixed(2)}% 在閾值 ${limit}% 內`,
    trigger_value: currentValue,
    threshold_value: baseline,
  };
}

function compareZscore(historicalSeries, currentValue, cfg) {
  if (!Array.isArray(historicalSeries) || historicalSeries.length < 5) {
    return { triggered: false, reason: 'series too short for zscore (need ≥ 5)' };
  }
  if (currentValue == null) return { triggered: false, reason: 'no current value' };
  const n = historicalSeries.length;
  const mean = historicalSeries.reduce((a, b) => a + b, 0) / n;
  const variance = historicalSeries.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  if (std === 0) return { triggered: false, reason: 'zero variance, no signal' };
  const z = (currentValue - mean) / std;
  const limit = Number(cfg.sigma) || 2;
  const triggered = Math.abs(z) > limit;
  return {
    triggered,
    reason: triggered ? `z-score=${z.toFixed(2)} 超過 ±${limit}σ (mean=${mean.toFixed(2)}, std=${std.toFixed(2)})` :
                        `z-score=${z.toFixed(2)} 在 ±${limit}σ 內`,
    trigger_value: currentValue,
    threshold_value: mean,
  };
}

// ── Cooldown — Redis SET NX EX,key 包含 ruleId / dedup_key ──────────────
async function checkCooldown(rule) {
  const cooldownMin = Number(rule.cooldown_minutes) || 0;
  if (cooldownMin <= 0) return { ok: true, skipped: false };
  const ruleId = rule.id || `${rule.task_id || 'std'}:${rule.node_id || 'inline'}`;
  const dedup = rule.dedup_key || '';
  const key = `alert_cooldown:${ruleId}:${dedup}`;
  try {
    const acquired = await tryLock(key, cooldownMin * 60);
    if (!acquired) return { ok: false, skipped: true, reason: `cooldown ${cooldownMin}min not elapsed` };
    return { ok: true, skipped: false };
  } catch (e) {
    // Redis 失敗時 fail-open(寧可多發也不漏),但記 warning
    console.warn(`[Alerter] cooldown check failed (${e.message}), allowing trigger`);
    return { ok: true, skipped: false };
  }
}

// ── 訊息組合(template + 可選 LLM 分析)─────────────────────────────────
function renderTemplate(template, vars) {
  if (!template) return '';
  return String(template).replace(/\{\{([^}]+)\}\}/g, (_, k) => {
    const key = k.trim();
    return vars[key] != null ? String(vars[key]) : `{{${key}}}`;
  });
}

async function llmAnalyze(rule, vars, sourceText) {
  try {
    const { generateTextSync } = require('./gemini');
    const { resolveDefaultModel } = require('./llmDefaults');
    const apiModel = await resolveDefaultModel(require('../database-oracle').db, 'chat').catch(() => null);
    const prompt = `你是一位金屬市場分析師。剛收到一則警示:

規則名:${rule.rule_name}
嚴重等級:${rule.severity}
觸發條件:${vars.reason || '—'}
當前值:${vars.trigger_value}
基準值:${vars.threshold_value}
標的:${rule.entity_type || '?'}/${rule.entity_code || '?'}

上下文:
${(sourceText || '').slice(0, 2000)}

請用繁體中文寫:
1. 一句話摘要這個警示的意義
2. 2-3 句可能的原因 / 後續觀察點
3. 給採購單位的具體建議(若適用)

直接寫,不要 markdown 標題、不要重複條件數字。`;
    const { text } = await generateTextSync(apiModel, [], prompt);
    return text || '';
  } catch (e) {
    console.warn(`[Alerter] LLM analysis failed: ${e.message}`);
    return '';
  }
}

// ── Action runners ────────────────────────────────────────────────────────
async function runActions(db, rule, message, llmText, vars, dryRun) {
  const actions = safeJsonParse(rule.actions, []);
  // 永遠保證有 alert_history 動作(若 user 沒寫就自動加)
  const hasHist = Array.isArray(actions) && actions.some(a => a?.type === 'alert_history');
  const finalActions = hasHist ? actions : [{ type: 'alert_history' }, ...(Array.isArray(actions) ? actions : [])];

  const channelsSent = [];
  const channelErrors = [];

  for (const a of finalActions) {
    const t = String(a?.type || '').toLowerCase();
    try {
      if (t === 'alert_history') {
        if (!dryRun) {
          await db.prepare(`
            INSERT INTO pm_alert_history
              (rule_id, rule_code, severity, source_node_id, source_task_id,
               entity_type, entity_code, trigger_value, threshold_value,
               message, llm_analysis, channels_sent, meta_run_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            rule.id || null,
            rule.rule_name || null,
            rule.severity || 'warning',
            rule.node_id || null,
            rule.task_id || null,
            rule.entity_type || null,
            rule.entity_code || null,
            vars.trigger_value != null ? Number(vars.trigger_value) : null,
            vars.threshold_value != null ? Number(vars.threshold_value) : null,
            (message || '').slice(0, 2000),
            llmText || null,
            null,  // 待會在外面 update
            vars.runId || null,
          );
        }
        channelsSent.push('alert_history');
      } else if (t === 'email') {
        if (!dryRun) {
          const { sendMail } = require('./mailService');
          const to = Array.isArray(a.to) ? a.to.join(',') : (a.to || '');
          if (to) {
            await sendMail({
              to,
              subject: `[${(rule.severity || 'warning').toUpperCase()}] ${rule.rule_name}`,
              text: `${message}\n\n${llmText || ''}\n\n— FOXLINK GPT 警示`,
              html: `<p>${(message || '').replace(/\n/g, '<br>')}</p>${llmText ? `<hr><p>${llmText.replace(/\n/g, '<br>')}</p>` : ''}<p><small>— FOXLINK GPT 警示</small></p>`,
            });
          }
        }
        channelsSent.push('email');
      } else if (t === 'webex') {
        if (!dryRun) {
          const { getWebexService } = require('./webexService');
          const svc = getWebexService();
          if (svc && a.room_id) {
            const md = `**[${(rule.severity || 'warning').toUpperCase()}] ${rule.rule_name}**\n\n${message}${llmText ? `\n\n---\n${llmText}` : ''}`;
            await svc.sendMessage(a.room_id, md, { markdown: md });
          }
        }
        channelsSent.push('webex');
      } else if (t === 'webhook') {
        if (!dryRun && a.url) {
          const body = JSON.stringify({
            rule_name: rule.rule_name,
            severity: rule.severity,
            message,
            llm_analysis: llmText || null,
            entity_type: rule.entity_type,
            entity_code: rule.entity_code,
            trigger_value: vars.trigger_value,
            threshold_value: vars.threshold_value,
            triggered_at: new Date().toISOString(),
          });
          const res = await fetch(a.url, {
            method: a.method || 'POST',
            headers: { 'Content-Type': 'application/json', ...(a.headers || {}) },
            body,
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) throw new Error(`webhook ${a.url} → ${res.status}`);
        }
        channelsSent.push('webhook');
      } else {
        channelErrors.push(`unknown action type: ${t}`);
      }
    } catch (e) {
      channelErrors.push(`${t}: ${e.message}`);
    }
  }

  // 補回 channels_sent(僅 alert_history 成功時)
  if (!dryRun && channelsSent.includes('alert_history')) {
    try {
      const lastRow = await db.prepare(
        `SELECT id FROM pm_alert_history WHERE rule_id ${rule.id ? '=?' : 'IS NULL'} ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`
      ).get(...(rule.id ? [rule.id] : []));
      if (lastRow) {
        await db.prepare(
          `UPDATE pm_alert_history SET channels_sent=? WHERE id=?`
        ).run(channelsSent.join(','), lastRow.id || lastRow.ID);
      }
    } catch (_) {}
  }

  return { channelsSent, channelErrors };
}

// ── 主流程 ────────────────────────────────────────────────────────────────
async function executeAlert(db, node, sourceText, context = {}) {
  const dryRun = !!context.dryRun || !!node.dry_run;

  const rule = await loadOrInlineRule(db, node, context);
  if (!rule) {
    return { triggered: false, skipped: true, reason: '無 alert_rules 設定(請先在「警示規則」建立或在節點 inline)', dryRun };
  }
  if (rule.is_active === 0) {
    return { triggered: false, skipped: true, reason: '規則已停用', dryRun };
  }

  // ─── 1. 取資料 ──────────────────────────────────────────────────────────
  let dataValue;
  try {
    dataValue = await fetchValue(db, rule.data_source, rule.data_config, sourceText);
  } catch (e) {
    return { triggered: false, error: `fetch value failed: ${e.message}`, dryRun };
  }

  // 對 historical 模式而言,sql_query 應回 array(歷史 series),current 從另外管道
  // 為簡化:single value 模式只用 threshold;array 模式分開處理
  const dataCfg = safeJsonParse(rule.data_config, {});
  const compareCfg = safeJsonParse(rule.comparison_config, {});

  // 解析 currentValue 與 historicalSeries
  let currentValue = null;
  let historicalSeries = null;
  if (Array.isArray(dataValue)) {
    // 約定:array 最後一筆 = current,其餘 = 歷史
    if (dataValue.length > 0) {
      currentValue = dataValue[dataValue.length - 1];
      historicalSeries = dataValue.slice(0, -1);
    }
  } else {
    currentValue = dataValue;
  }
  // 若 user 顯式給了 current_value(literal override)
  if (dataCfg.current_value != null) currentValue = Number(dataCfg.current_value);

  // ─── 2. 比較 ────────────────────────────────────────────────────────────
  let result;
  switch ((rule.comparison || '').toLowerCase()) {
    case 'threshold':       result = compareThreshold(currentValue, compareCfg); break;
    case 'historical_avg':  result = compareHistoricalAvg(historicalSeries, currentValue, compareCfg); break;
    case 'rate_change':     result = compareRateChange(historicalSeries, currentValue, compareCfg); break;
    case 'zscore':          result = compareZscore(historicalSeries, currentValue, compareCfg); break;
    default: result = { triggered: false, reason: `unknown comparison: ${rule.comparison}` };
  }

  if (!result.triggered) {
    return { triggered: false, ...result, dryRun, rule_name: rule.rule_name };
  }

  // ─── 3. Cooldown ────────────────────────────────────────────────────────
  if (!dryRun) {
    const cd = await checkCooldown(rule);
    if (!cd.ok) {
      return { triggered: false, skipped: true, reason: cd.reason, dryRun, rule_name: rule.rule_name };
    }
  }

  // ─── 4. 訊息組合 ────────────────────────────────────────────────────────
  const vars = {
    rule_name: rule.rule_name,
    severity: rule.severity,
    entity_type: rule.entity_type || '',
    entity_code: rule.entity_code || '',
    trigger_value: result.trigger_value,
    threshold_value: result.threshold_value,
    reason: result.reason,
    runId: context.runId || null,
    date: new Date().toISOString().slice(0, 10),
  };
  const message = renderTemplate(rule.message_template || `[${rule.severity}] ${rule.rule_name} — ${result.reason}`, vars);

  let llmText = '';
  if (rule.use_llm_analysis === 1 || rule.use_llm_analysis === true) {
    if (!dryRun) llmText = await llmAnalyze(rule, vars, sourceText);
    else llmText = '(dry-run skipped LLM analysis)';
  }

  // ─── 5. Actions ─────────────────────────────────────────────────────────
  const { channelsSent, channelErrors } = await runActions(db, rule, message, llmText, vars, dryRun);

  return {
    triggered: true,
    skipped: false,
    rule_name: rule.rule_name,
    severity: rule.severity,
    reason: result.reason,
    trigger_value: result.trigger_value,
    threshold_value: result.threshold_value,
    message,
    llm_analysis: llmText || null,
    channels_sent: channelsSent,
    channel_errors: channelErrors,
    dryRun,
  };
}

module.exports = {
  executeAlert,
  // export internals for unit testing / dry-run UI
  compareThreshold,
  compareHistoricalAvg,
  compareRateChange,
  compareZscore,
  fetchValue,
  renderTemplate,
};
