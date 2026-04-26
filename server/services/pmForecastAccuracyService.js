'use strict';

/**
 * PM Forecast Accuracy Service — Phase 5 Track B 核心
 *
 * 兩個職責:
 *   1. **每日校驗 (B1)**:撈所有 forecast_history WHERE target_date = T-1 (昨天) AND
 *      尚未在 pm_forecast_accuracy 出現的 → JOIN pm_price_history 取 actual_value →
 *      算 abs_error / pct_error / in_band → INSERT pm_forecast_accuracy
 *   2. **MAPE 連 3 次告警 (B5)**:跑完校驗後 query「per-metal 最近 3 天 MAPE > 30%」→
 *      INSERT pm_alert_history(severity='warning', rule_code='pm_mape_streak'),由既有
 *      pipelineAlerter 通知通道(email / webex)接走
 *
 * 排程方式:setInterval(24h),server 啟動 60 秒後跑第一次,之後每 24 小時跑一次。
 * 也可由 admin 手動觸發 POST /api/pm/accuracy/recompute(見 routes/pmAccuracy.js)。
 *
 * 為什麼不走 scheduled_tasks 表:這是「系統自我校驗」,跟業務 LLM prompt 排程無關;
 * 只有 SQL JOIN + 寫表,純 server-side function,setInterval 最簡單。
 * 若日後要可觀測性(Track F),會在 admin 健康儀表板顯示 last_run / row_count。
 */

const ENTITY_TYPE_METAL = 'metal';
const STREAK_THRESHOLD_PCT = 30;   // |pct_error| > 30 算「不準」
const STREAK_DAYS = 3;             // 連 3 天觸發 alert
const RUN_EVERY_HOURS = 24;
const FIRST_RUN_DELAY_MS = 60 * 1000;

let _interval = null;
let _lastRun = null;
let _lastResult = null;

function startAccuracyCron() {
  console.log(`[PmAccuracy] Starting cron — every ${RUN_EVERY_HOURS}h, first run in ${FIRST_RUN_DELAY_MS / 1000}s`);
  setTimeout(() => runOnce().catch(e => console.error('[PmAccuracy] initial error:', e.message)), FIRST_RUN_DELAY_MS);
  _interval = setInterval(
    () => runOnce().catch(e => console.error('[PmAccuracy] error:', e.message)),
    RUN_EVERY_HOURS * 60 * 60 * 1000,
  );
}

function stopAccuracyCron() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

function getLastRunMeta() {
  return { lastRun: _lastRun, lastResult: _lastResult };
}

/**
 * Compute accuracy for forecasts whose target_date has passed and we haven't
 * scored yet. Returns { computed, alerts } counts.
 */
async function runOnce() {
  const db = require('../database-oracle').db;
  if (!db) {
    console.warn('[PmAccuracy] db not ready, skipping');
    return { computed: 0, alerts: 0 };
  }

  const startedAt = new Date();
  let computed = 0;
  let alerts = 0;

  try {
    computed = await computeNewAccuracyRows(db);
    alerts = await detectMapeStreakAlerts(db);
    _lastRun = startedAt.toISOString();
    _lastResult = { ok: true, computed, alerts, startedAt: _lastRun, finishedAt: new Date().toISOString() };
    console.log(`[PmAccuracy] Done — computed=${computed} new accuracy rows, fired ${alerts} streak alerts`);
  } catch (e) {
    _lastResult = { ok: false, error: e.message, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString() };
    console.error('[PmAccuracy] runOnce failed:', e.message);
    throw e;
  }
  return { computed, alerts };
}

/**
 * 找所有「target_date 已過 + 還沒寫進 accuracy」的 forecast,JOIN pm_price_history 取
 * 該 target_date 的實際 price(取多源平均、或最權威源:依 source 排序取第一筆),算 metric。
 *
 * 邊界情況:
 *   - 目標日無 actual price → skip(可能週末 / 無交易日)
 *   - 同一 (forecast_id, target_date) 已存在 → skip(idempotent)
 */
async function computeNewAccuracyRows(db) {
  // 1. 撈待校驗的 forecast(target_date <= TRUNC(SYSDATE) AND 還沒寫過 accuracy)
  const candidates = await db.prepare(`
    SELECT f.id            AS forecast_id,
           f.entity_type   AS entity_type,
           f.entity_code   AS entity_code,
           f.forecast_date AS forecast_date,
           f.target_date   AS target_date,
           f.horizon_days  AS horizon_days,
           f.predicted_mean  AS predicted_mean,
           f.predicted_lower AS predicted_lower,
           f.predicted_upper AS predicted_upper,
           f.model_used    AS model_used
    FROM forecast_history f
    WHERE f.target_date <= TRUNC(SYSDATE)
      AND NOT EXISTS (
        SELECT 1 FROM pm_forecast_accuracy a
        WHERE a.forecast_id = f.id AND a.target_date = f.target_date
      )
    ORDER BY f.target_date
    FETCH FIRST 500 ROWS ONLY
  `).all();

  if (!candidates || candidates.length === 0) return 0;

  let inserted = 0;
  for (const c of candidates) {
    try {
      const actual = await fetchActualValue(db, c.entity_type, c.entity_code, c.target_date);
      if (!actual || actual.value == null) continue;  // 無實際值 → 跳過
      const predicted = Number(c.predicted_mean);
      if (!Number.isFinite(predicted)) continue;

      const absErr = Math.abs(predicted - actual.value);
      const pctErr = actual.value !== 0 ? (absErr / Math.abs(actual.value)) * 100 : null;
      const inBand = (
        c.predicted_lower != null && c.predicted_upper != null &&
        actual.value >= Number(c.predicted_lower) && actual.value <= Number(c.predicted_upper)
      ) ? 1 : 0;

      await db.prepare(`
        INSERT INTO pm_forecast_accuracy (
          forecast_id, entity_type, entity_code, forecast_date, target_date, horizon_days,
          predicted_mean, predicted_lower, predicted_upper,
          actual_value, actual_source, abs_error, pct_error, in_band, model_used
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        c.forecast_id, c.entity_type, c.entity_code, c.forecast_date, c.target_date, c.horizon_days,
        predicted, c.predicted_lower, c.predicted_upper,
        actual.value, actual.source || null, absErr, pctErr, inBand, c.model_used || null,
      );
      inserted++;
    } catch (e) {
      // UNIQUE conflict 視為 idempotent re-run,跳過即可
      if (!/ORA-00001/.test(e.message)) {
        console.warn(`[PmAccuracy] insert failed for forecast_id=${c.forecast_id}:`, e.message);
      }
    }
  }
  return inserted;
}

/**
 * 取得 (entity_type, entity_code, target_date) 的實際值。
 * 目前只實作 metal — 從 pm_price_history 取該日 price_usd(多源 → AVG)。
 * 若日後支援其他 entity_type(fx / stock),這裡 dispatch。
 */
async function fetchActualValue(db, entityType, entityCode, targetDate) {
  if (String(entityType).toLowerCase() === ENTITY_TYPE_METAL) {
    const row = await db.prepare(`
      SELECT AVG(price_usd) AS avg_price,
             MIN(source)     AS sample_source
      FROM pm_price_history
      WHERE metal_code = ?
        AND TRUNC(as_of_date) = TRUNC(?)
        AND price_usd IS NOT NULL
    `).get(entityCode, targetDate);
    if (!row) return null;
    const v = row.avg_price ?? row.AVG_PRICE;
    if (v == null) return null;
    return { value: Number(v), source: row.sample_source || row.SAMPLE_SOURCE || 'pm_price_history.avg' };
  }
  // 其他 entity_type 待擴充
  return null;
}

/**
 * B5 — 找 per-metal 最近 STREAK_DAYS 個校驗,**全部** |pct_error| > STREAK_THRESHOLD_PCT
 * 的金屬,寫進 pm_alert_history 給既有警示通道接走。
 *
 * dedup 機制:同一 metal 在 cooldown 24 小時內只發一次。
 */
async function detectMapeStreakAlerts(db) {
  const metals = await db.prepare(`
    SELECT DISTINCT entity_code
    FROM pm_forecast_accuracy
    WHERE entity_type = 'metal'
      AND target_date >= TRUNC(SYSDATE) - 7
  `).all();
  if (!metals || metals.length === 0) return 0;

  let alertsFired = 0;

  for (const m of metals) {
    const code = m.entity_code || m.ENTITY_CODE;
    if (!code) continue;
    const recent = await db.prepare(`
      SELECT pct_error
      FROM pm_forecast_accuracy
      WHERE entity_type = 'metal' AND entity_code = ?
      ORDER BY target_date DESC
      FETCH FIRST ${STREAK_DAYS} ROWS ONLY
    `).all(code);

    if (!recent || recent.length < STREAK_DAYS) continue;
    const allBad = recent.every(r => {
      const p = r.pct_error ?? r.PCT_ERROR;
      return p != null && Math.abs(Number(p)) > STREAK_THRESHOLD_PCT;
    });
    if (!allBad) continue;

    // dedup: 24 小時內已發過 → skip
    const recentAlert = await db.prepare(`
      SELECT id FROM pm_alert_history
      WHERE rule_code = 'pm_mape_streak'
        AND entity_code = ?
        AND triggered_at > SYSTIMESTAMP - INTERVAL '24' HOUR
      FETCH FIRST 1 ROWS ONLY
    `).get(code);
    if (recentAlert) continue;

    // 寫 alert(由既有 pipelineAlerter / dashboard alert 列表呈現)
    // 用 llm_analysis CLOB 存 streak 細節 JSON(沒有 payload_json 欄位)
    try {
      const avgPct = recent.reduce((s, r) => s + Math.abs(Number(r.pct_error ?? r.PCT_ERROR)), 0) / recent.length;
      const payload = {
        metal: code,
        streak_days: STREAK_DAYS,
        threshold_pct: STREAK_THRESHOLD_PCT,
        recent_errors: recent.map(r => Number(r.pct_error ?? r.PCT_ERROR)),
        avg_abs_pct_error: Number(avgPct.toFixed(2)),
        suggested_action: 'review pm_prompt_review_queue or run [PM] Prompt Self-Improve',
      };
      await db.prepare(`
        INSERT INTO pm_alert_history (
          rule_code, severity, entity_type, entity_code,
          trigger_value, threshold_value, message, llm_analysis
        ) VALUES (?, 'warning', 'metal', ?, ?, ?, ?, ?)
      `).run(
        'pm_mape_streak',
        code,
        Number(avgPct.toFixed(2)),
        STREAK_THRESHOLD_PCT,
        `${code} 連續 ${STREAK_DAYS} 天 |pct_error| > ${STREAK_THRESHOLD_PCT}%(平均 ${avgPct.toFixed(1)}%)— 模型可能需要調整 prompt / 換 baseline`,
        JSON.stringify(payload),
      );
      alertsFired++;
    } catch (e) {
      console.warn('[PmAccuracy] alert insert failed:', e.message);
    }
  }
  return alertsFired;
}

module.exports = {
  startAccuracyCron,
  stopAccuracyCron,
  runOnce,
  getLastRunMeta,
};
