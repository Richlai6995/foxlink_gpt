'use strict';
/**
 * Deep Research — token & cost estimator + budget pre-check.
 *
 * 用途:
 *   1. 提交前預估(顯示給使用者 + 額度檢查)
 *   2. 找出在現有額度下可執行的最大 depth(suggested_max_depth)
 *   3. 執行中累計成本檢查(>2× 預估強制中止,防 ReAct loop 失控)
 *
 * 模型費率透過 token_prices 表,經 tokenService.calcCallCost 取得。
 * 額度透過 users.budget_* + roles.budget_* (與 tokenService.checkBudgetExceeded 同邏輯)。
 */

const { calcCallCost } = require('./tokenService');

// ── Stage 平均 token 基準(基於實測 + 適度 buffer) ──────────────────────────
// 注意:thinking tokens 在 Gemini 計費時併入 output(統一視為 generated tokens)
const STAGE = {
  // 一次/job
  plan_flash:        { in: 800,   out: 1500,  thinking: 0     },

  // 每個 SQ 的完整 pipeline (Tier 2/3)
  sub_sub_split:     { in: 2000,  out: 1000,  thinking: 0     },   // ×1, Flash
  react_turn_pro:    { in: 6000,  out: 2000,  thinking: 3000  },   // ×(M×T), Pro
  critic_flash:      { in: 8000,  out: 2000,  thinking: 0     },   // ×1, Flash
  section_write_pro: { in: 20000, out: 12000, thinking: 24000 },   // ×1, Pro

  // 一次/job
  synthesize_pro:    { in: 60000, out: 15000, thinking: 24000 },
};

// 預設參數
const DEFAULT_M = 4;        // sub-sub-questions per SQ
const DEFAULT_REACT_TURNS = 3;
const SAFETY_MULTIPLIER = 1.5;        // user-facing 預估
const HARD_KILL_MULTIPLIER = 2.0;     // 實際 actual_usd 超過 estimated × 2 時強制中止

/**
 * 估算 deep research job 各階段的 token 消耗。
 * @param {object} opts
 * @param {number} opts.depth    sub-question 數(2-12)
 * @param {number} [opts.subSubPerSq]   每 SQ 的 sub-sub-question 數(預設 4)
 * @param {number} [opts.reactTurns]    每 sub-sub 的 ReAct 平均輪數(預設 3)
 * @returns {{ totals: {pro:{in,out}, flash:{in,out}}, stages: object[] }}
 */
function estimateResearchTokens(opts = {}) {
  const N = Math.max(2, Math.min(8, opts.depth || 5));
  const M = opts.subSubPerSq ?? DEFAULT_M;
  const T = opts.reactTurns ?? DEFAULT_REACT_TURNS;

  const stages = [];
  const push = (stage, kind, count, base) =>
    stages.push({
      stage, kind, count,
      tokens_in:  base.in * count,
      tokens_out: (base.out + base.thinking) * count,  // thinking 計 output 費
    });

  push('plan', 'flash', 1, STAGE.plan_flash);

  for (let i = 1; i <= N; i++) {
    push(`sq${i}_split`,  'flash', 1,    STAGE.sub_sub_split);
    push(`sq${i}_react`,  'pro',   M * T, STAGE.react_turn_pro);
    push(`sq${i}_critic`, 'flash', 1,    STAGE.critic_flash);
    push(`sq${i}_write`,  'pro',   1,    STAGE.section_write_pro);
  }

  push('synthesize', 'pro', 1, STAGE.synthesize_pro);

  const totals = { pro: { in: 0, out: 0 }, flash: { in: 0, out: 0 } };
  for (const s of stages) {
    totals[s.kind].in  += s.tokens_in;
    totals[s.kind].out += s.tokens_out;
  }
  return { stages, totals };
}

/**
 * 把 token totals 換算成 USD。Pro / Flash 透過 calcCallCost 各算一次。
 * @returns {Promise<{ pro_usd, flash_usd, base_usd }>}
 */
async function tokensToUsd(db, totals, dateStr) {
  const today = dateStr || new Date().toISOString().slice(0, 10);
  const proRes   = await calcCallCost(db, 'pro',   today, totals.pro.in,   totals.pro.out,   0);
  const flashRes = await calcCallCost(db, 'flash', today, totals.flash.in, totals.flash.out, 0);
  const proUsd   = proRes.cost   || 0;
  const flashUsd = flashRes.cost || 0;
  return { pro_usd: proUsd, flash_usd: flashUsd, base_usd: proUsd + flashUsd };
}

/**
 * 抓使用者目前 daily/weekly/monthly 已花費 + 對應上限。
 * @returns {Promise<{ limits, current, remaining, action }>}
 */
async function getUserBudgetState(db, userId) {
  const row = await db.prepare(`
    SELECT u.budget_daily, u.budget_weekly, u.budget_monthly,
           u.quota_exceed_action AS user_action,
           r.budget_daily AS role_daily, r.budget_weekly AS role_weekly,
           r.budget_monthly AS role_monthly,
           r.quota_exceed_action AS role_action
    FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?
  `).get(userId);

  const limits = {
    daily:   row?.budget_daily   ?? row?.role_daily   ?? null,
    weekly:  row?.budget_weekly  ?? row?.role_weekly  ?? null,
    monthly: row?.budget_monthly ?? row?.role_monthly ?? null,
  };
  const action = row?.user_action || row?.role_action || 'block';

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow));
  const mondayStr = monday.toISOString().slice(0, 10);
  const firstOfMonth = `${todayStr.slice(0, 7)}-01`;
  const D = `TO_DATE(?, 'YYYY-MM-DD')`;

  const sumSpent = async (fromDate) => {
    try {
      const r = await db.prepare(
        `SELECT COALESCE(SUM(cost),0) AS total FROM token_usage
         WHERE user_id=? AND usage_date>=${D} AND usage_date<=${D}`
      ).get(userId, fromDate, todayStr);
      return Number(r?.total || 0);
    } catch { return 0; }
  };

  const current = {
    daily:   limits.daily   != null ? await sumSpent(todayStr)     : 0,
    weekly:  limits.weekly  != null ? await sumSpent(mondayStr)    : 0,
    monthly: limits.monthly != null ? await sumSpent(firstOfMonth) : 0,
  };
  const remaining = {
    daily:   limits.daily   != null ? Math.max(0, limits.daily   - current.daily)   : null,
    weekly:  limits.weekly  != null ? Math.max(0, limits.weekly  - current.weekly)  : null,
    monthly: limits.monthly != null ? Math.max(0, limits.monthly - current.monthly) : null,
  };

  return { limits, current, remaining, action };
}

/**
 * 主入口:預估成本 + 額度檢查 + 推薦最大可執行 depth。
 *
 * @returns {Promise<{
 *   estimated_usd: number,         // 含 ×1.5 buffer
 *   base_usd: number,              // 不含 buffer
 *   multiplier: number,
 *   tokens: { pro, flash },
 *   stages: object[],
 *   budget: { limits, current, remaining, action, would_exceed: { daily, weekly, monthly } },
 *   suggested_max_depth: number,   // 在現有額度下可執行的最大 depth
 *   blocked: boolean,              // action='block' 且確實超過
 * }>}
 */
async function previewResearchCost(db, userId, depth, options = {}) {
  const { totals, stages } = estimateResearchTokens({ depth, ...options });
  const { base_usd } = await tokensToUsd(db, totals);
  const estimatedUsd = base_usd * SAFETY_MULTIPLIER;

  const budgetState = await getUserBudgetState(db, userId);
  const { limits, current, action } = budgetState;

  const wouldExceed = {
    daily:   limits.daily   != null && (current.daily   + estimatedUsd) > limits.daily,
    weekly:  limits.weekly  != null && (current.weekly  + estimatedUsd) > limits.weekly,
    monthly: limits.monthly != null && (current.monthly + estimatedUsd) > limits.monthly,
  };
  const anyExceed = Object.values(wouldExceed).some(Boolean);

  // 推算可執行的最大 depth(只在 block + 超額時推算)
  let suggestedMaxDepth = depth;
  if (anyExceed && action === 'block') {
    suggestedMaxDepth = 0; // 0 表示連最低深度都不行
    for (let d = Math.max(2, depth - 1); d >= 2; d--) {
      const tEst = estimateResearchTokens({ depth: d, ...options });
      const { base_usd: tBase } = await tokensToUsd(db, tEst.totals);
      const tCost = tBase * SAFETY_MULTIPLIER;
      const ok =
        (limits.daily   == null || (current.daily   + tCost) <= limits.daily) &&
        (limits.weekly  == null || (current.weekly  + tCost) <= limits.weekly) &&
        (limits.monthly == null || (current.monthly + tCost) <= limits.monthly);
      if (ok) { suggestedMaxDepth = d; break; }
    }
  }

  return {
    estimated_usd: Number(estimatedUsd.toFixed(4)),
    base_usd:      Number(base_usd.toFixed(4)),
    multiplier:    SAFETY_MULTIPLIER,
    tokens:        totals,
    stages,
    budget: { ...budgetState, would_exceed: wouldExceed },
    suggested_max_depth: suggestedMaxDepth,
    blocked: anyExceed && action === 'block',
  };
}

/**
 * 執行階段計算單次 LLM call 的 USD,讓 runResearchJob 累計到 actual_usd。
 * apiModelOrKey 例如 'pro' / 'flash' / 'gemini-3.1-pro-preview'。
 */
async function calcCallUsd(db, apiModelOrKey, inputTokens, outputTokens) {
  const today = new Date().toISOString().slice(0, 10);
  const r = await calcCallCost(db, apiModelOrKey, today, inputTokens || 0, outputTokens || 0, 0);
  return r?.cost || 0;
}

module.exports = {
  estimateResearchTokens,
  tokensToUsd,
  getUserBudgetState,
  previewResearchCost,
  calcCallUsd,
  SAFETY_MULTIPLIER,
  HARD_KILL_MULTIPLIER,
};
