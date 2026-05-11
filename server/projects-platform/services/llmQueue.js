/**
 * LLM Rate Limiter — 限制 projects-platform 對既有 geminiClient 的呼叫頻率
 *
 * 對應解耦設計 §D.3:共用資源(LLM token / DB pool / Redis)走 rate limiter
 * 避免新平台 AI 加速 workers 突發大量呼叫,佔光 Cortex token 配額。
 *
 * 預設參數可從 env 調整:
 *   PROJECTS_LLM_RATE_PER_SEC   平均速率(每秒幾次)
 *   PROJECTS_LLM_BURST          突發配額(短時間累積)
 */

const RATE_PER_SEC = Number(process.env.PROJECTS_LLM_RATE_PER_SEC) || 5;
const BURST = Number(process.env.PROJECTS_LLM_BURST) || 20;

// Simple token bucket
let _tokens = BURST;
let _lastRefill = Date.now();

function _refill() {
  const now = Date.now();
  const elapsed = (now - _lastRefill) / 1000;
  _tokens = Math.min(BURST, _tokens + elapsed * RATE_PER_SEC);
  _lastRefill = now;
}

/**
 * 等待直到可消耗 1 token,然後執行 fn。
 * fn 通常是 geminiClient call。
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{label?: string, timeoutMs?: number}} opts
 * @returns {Promise<T>}
 */
async function withLLM(fn, opts = {}) {
  const label = opts.label || 'llm';
  const timeoutMs = opts.timeoutMs ?? 30_000;

  // Wait for token
  const waitStart = Date.now();
  while (true) {
    _refill();
    if (_tokens >= 1) {
      _tokens -= 1;
      break;
    }
    if (Date.now() - waitStart > timeoutMs) {
      throw new Error(`[projects-platform/llmQueue] timeout waiting token for ${label}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  return fn();
}

/**
 * 目前 token 數(monitoring 用)
 */
function getStats() {
  _refill();
  return {
    available_tokens: Math.floor(_tokens),
    burst_capacity: BURST,
    rate_per_sec: RATE_PER_SEC,
  };
}

module.exports = {
  withLLM,
  getStats,
};
