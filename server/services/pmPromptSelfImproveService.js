'use strict';

/**
 * PM Prompt Self-Improve Service — Phase 5 Track B-4
 *
 * 每月跑一次,把過去 30 天「準確率最差 + 採購員 thumbs-down」的案例餵給 LLM,
 * 讓 LLM 改進 forecast skill 的 system_prompt,產出 v2 進 pm_prompt_review_queue
 * 等採購員 approve(不直接套用)。
 *
 * Trigger:
 *   - 排程:每月 1 號 03:00(在月報前跑完,讓本月用上更新後的 prompt — 若有 approve)
 *   - admin 手動:POST /api/pm/review/run-self-improve
 *
 * 風險控制:
 *   - 同一 skill 7 天內已有 pending v2 → skip(避免堆積)
 *   - LLM 失敗或產出非 strict → 不寫 queue,記 console
 *   - 永遠不直接套用 prompt(只進 queue,人類 review)
 */

const TARGET_SKILL_NAME = 'forecast_timeseries_llm';
const LOOKBACK_DAYS = 30;
const SAMPLE_LIMIT = 20;
const MIN_BAD_CASES = 3;        // 少於這個就不跑(沒足夠 signal 改)
const RECENT_PENDING_DAYS = 7;  // 同 skill 7 天內已有 pending → skip

let _interval = null;
let _lastRun = null;
let _lastResult = null;

const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;       // server 啟動 5 分鐘後檢查一次
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;     // 每天檢查「今天是不是該跑」(月初才實際跑)

function startSelfImproveCron() {
  console.log('[PmSelfImprove] Starting cron — checks daily, fires only on day-1 of month');
  setTimeout(() => maybeRun().catch(e => console.error('[PmSelfImprove] initial error:', e.message)), FIRST_RUN_DELAY_MS);
  _interval = setInterval(
    () => maybeRun().catch(e => console.error('[PmSelfImprove] error:', e.message)),
    CHECK_EVERY_MS,
  );
}

function stopSelfImproveCron() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

function getLastRunMeta() {
  return { lastRun: _lastRun, lastResult: _lastResult };
}

async function maybeRun() {
  const now = new Date();
  if (now.getDate() !== 1) return; // 只在月初 1 號跑
  await runSelfImproveOnce();
}

async function runSelfImproveOnce() {
  const db = require('../database-oracle').db;
  if (!db) return { ok: false, reason: 'db not ready' };

  const startedAt = new Date();
  try {
    // 1. 找 target skill
    const skill = await db.prepare(`
      SELECT id, name, system_prompt FROM skills WHERE UPPER(name)=UPPER(?)
    `).get(TARGET_SKILL_NAME);
    if (!skill) {
      const r = { ok: false, reason: 'target skill not found' };
      _lastRun = startedAt.toISOString(); _lastResult = r;
      return r;
    }

    // 2. dedup — 7 天內已有 pending → skip
    const recentPending = await db.prepare(`
      SELECT id FROM pm_prompt_review_queue
      WHERE skill_name = ? AND status = 'pending'
        AND submitted_at > SYSTIMESTAMP - INTERVAL '${RECENT_PENDING_DAYS}' DAY
      FETCH FIRST 1 ROWS ONLY
    `).get(TARGET_SKILL_NAME);
    if (recentPending) {
      const r = { ok: false, reason: `recent pending (within ${RECENT_PENDING_DAYS}d) exists` };
      _lastRun = startedAt.toISOString(); _lastResult = r;
      return r;
    }

    // 3. 蒐集失敗案例 + thumbs-down
    const badCases = await collectBadCases(db);
    if (badCases.length < MIN_BAD_CASES) {
      const r = { ok: false, reason: `not enough bad cases (got ${badCases.length}, need >= ${MIN_BAD_CASES})` };
      _lastRun = startedAt.toISOString(); _lastResult = r;
      return r;
    }

    // 4. 餵 LLM 改 prompt
    const llmResult = await askLlmToImprovePrompt(skill.system_prompt, badCases);
    if (!llmResult || !llmResult.proposed_prompt) {
      const r = { ok: false, reason: 'LLM did not return valid v2 prompt' };
      _lastRun = startedAt.toISOString(); _lastResult = r;
      return r;
    }

    // 5. 寫進 review queue
    await db.prepare(`
      INSERT INTO pm_prompt_review_queue (
        skill_name, skill_id, original_prompt, proposed_prompt,
        rationale, eval_summary, status, submitted_by
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'meta_self_improve')
    `).run(
      skill.name, skill.id, skill.system_prompt, llmResult.proposed_prompt,
      llmResult.rationale || null,
      JSON.stringify({
        bad_cases_count: badCases.length,
        avg_pct_error: badCases.reduce((s, b) => s + Math.abs(b.pct_error || 0), 0) / badCases.length,
        sample: badCases.slice(0, 5).map(b => ({
          metal: b.entity_code, target_date: b.target_date,
          predicted: b.predicted_mean, actual: b.actual_value, pct_error: b.pct_error,
        })),
      }),
    );

    const r = { ok: true, queued: true, bad_cases_count: badCases.length };
    _lastRun = startedAt.toISOString();
    _lastResult = { ...r, startedAt: _lastRun, finishedAt: new Date().toISOString() };
    console.log('[PmSelfImprove] Queued v2 prompt for review:', JSON.stringify(r));
    return r;
  } catch (e) {
    _lastResult = { ok: false, error: e.message, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString() };
    console.error('[PmSelfImprove] runSelfImproveOnce failed:', e.message);
    throw e;
  }
}

async function collectBadCases(db) {
  // 過去 N 天 |pct_error| 排序 top N + 該 entity 是否有 thumbs-down(forecast 維度 join)
  const rows = await db.prepare(`
    SELECT a.id, a.entity_code, a.target_date, a.predicted_mean, a.actual_value,
           a.pct_error, a.in_band,
           (SELECT COUNT(*) FROM pm_feedback_signal f
              WHERE f.target_type='forecast' AND f.vote=-1
                AND f.target_ref = TO_CHAR(a.forecast_id)) AS down_count
    FROM pm_forecast_accuracy a
    WHERE a.entity_type = 'metal'
      AND a.target_date >= TRUNC(SYSDATE) - ?
      AND a.pct_error IS NOT NULL
    ORDER BY ABS(a.pct_error) DESC
    FETCH FIRST ${SAMPLE_LIMIT} ROWS ONLY
  `).all(LOOKBACK_DAYS);
  return rows || [];
}

async function askLlmToImprovePrompt(originalPrompt, badCases) {
  const { generateTextSync } = require('./gemini');
  const samples = badCases.slice(0, 10).map(b => (
    `- 金屬 ${b.entity_code} 目標日 ${b.target_date}:預測 ${b.predicted_mean}, 實際 ${b.actual_value}, 誤差 ${Number(b.pct_error).toFixed(2)}%${Number(b.down_count) > 0 ? ' (採購員 thumbs-down)' : ''}`
  )).join('\n');

  const userPrompt = `你是 prompt engineering 專家,專長改進 LLM 預測類 prompt 的準確率。請以嚴格 JSON 回覆。

以下是貴金屬時序預測 builtin skill \`forecast_timeseries_llm\` 的 system_prompt 與最近 30 天部分**誤差最大**的案例。請改進 system_prompt 以提升預測準確率。

== 原始 system_prompt ==
${originalPrompt}

== 失敗案例(top ${badCases.length}, 顯示前 ${Math.min(10, badCases.length)} 筆)==
${samples}

== 你的任務 ==
1. 分析這些失敗模式(過度樂觀?忽略 confidence interval?忽略 context?單純 metal 跳價)
2. 針對性微調 system_prompt 的「預測原則」段落,可加 1-3 條規則
3. 不要改 IO 格式 / strict JSON 規範 / 容錯段落 — 只改「預測原則」
4. 不要把整段 system_prompt 重寫,只做最小必要修改

== 輸出格式(嚴格 JSON,直接以 \`{\` 開始) ==
{
  "proposed_prompt": "<完整的 v2 system_prompt,含原本不動的部分 + 你修改的「預測原則」>",
  "rationale": "<2-4 句說明你做了什麼修改、為什麼這樣改能提升準確率>",
  "added_rules": ["<新增規則 1>", "<新增規則 2>"]
}`;

  let raw;
  try {
    const apiModel = process.env.GEMINI_MODEL_PRO || 'gemini-3.1-pro-preview';
    const r = await generateTextSync(apiModel, [], userPrompt);
    raw = r?.text || '';
  } catch (e) {
    console.warn('[PmSelfImprove] LLM call failed:', e.message);
    return null;
  }

  // strip 任何 markdown 包裝,找第一個 { 跟最後一個 }
  const text = String(raw || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (!obj.proposed_prompt) return null;
    return obj;
  } catch {
    return null;
  }
}

module.exports = {
  startSelfImproveCron,
  stopSelfImproveCron,
  runSelfImproveOnce,
  getLastRunMeta,
};
