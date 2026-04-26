'use strict';

/**
 * Webex Adaptive Card Builders for PM(Phase 5 Track C-2)
 *
 * 三種 Card:
 *   1. buildSnapshotCard — Top 5 metals 今日報價 + 漲跌
 *   2. buildForecastCard — 7-day forecast + 信心區間 + Unicode sparkline
 *   3. buildWhatIfCard   — Quick what-if 按鈕(銅+10%、金-5% 等)
 *
 * Sparkline 用 Unicode block char(▁▂▃▄▅▆▇█),無需 server-side png 渲染,
 * 在 Webex Adaptive Card 內 monospace 顯示。
 *
 * 所有 Card 都遵循 Adaptive Card 1.3 schema(Webex 支援的最高版本)。
 */

const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * 把一組數字轉成 Unicode sparkline 字串
 */
function sparkline(values) {
  const nums = values.map(v => Number(v)).filter(Number.isFinite);
  if (nums.length === 0) return '';
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  return nums.map(v => SPARK_CHARS[Math.floor(((v - min) / range) * (SPARK_CHARS.length - 1))]).join('');
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

function fmtPrice(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10)   return v.toFixed(2);
  return v.toFixed(4);
}

// ─── Card 1: Top N Metals Snapshot ──────────────────────────────────────────

function buildSnapshotCard({ metals, asOfDate, lang = 'zh-TW' }) {
  const isZh = lang.startsWith('zh');
  const facts = metals.map(m => ({
    title: m.metal_code,
    value: `${fmtPrice(m.price_usd)} USD  ${m.day_change_pct != null ? `(${fmtPct(m.day_change_pct)})` : ''}`,
  }));

  return {
    type: 'AdaptiveCard',
    version: '1.3',
    body: [
      {
        type: 'TextBlock',
        text: isZh ? '📊 貴金屬今日快照' : '📊 Precious Metals Snapshot',
        weight: 'Bolder',
        size: 'Medium',
        color: 'Accent',
      },
      {
        type: 'TextBlock',
        text: `${isZh ? '日期' : 'As of'}: ${asOfDate}`,
        isSubtle: true,
        size: 'Small',
        spacing: 'None',
      },
      { type: 'FactSet', facts, spacing: 'Medium' },
      {
        type: 'TextBlock',
        text: isZh ? '💡 點下方按鈕看 7 日預測' : '💡 Tap below for 7-day forecast',
        isSubtle: true, size: 'Small', wrap: true,
      },
    ],
    actions: metals.slice(0, 4).map(m => ({
      type: 'Action.Submit',
      title: `${m.metal_code} ${isZh ? '預測' : 'Forecast'}`,
      data: { intent: 'pm_forecast', metal: m.metal_code },
    })),
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
  };
}

// ─── Card 2: 7-day Forecast(含 sparkline + in_band 標示)────────────────

function buildForecastCard({ metal, forecastRows, currentPrice, lang = 'zh-TW' }) {
  const isZh = lang.startsWith('zh');
  if (!forecastRows || forecastRows.length === 0) {
    return {
      type: 'AdaptiveCard',
      version: '1.3',
      body: [
        { type: 'TextBlock', text: `${metal} ${isZh ? '無預測資料' : 'no forecast available'}`, weight: 'Bolder' },
      ],
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    };
  }

  const means = forecastRows.map(r => Number(r.predicted_mean ?? r.PREDICTED_MEAN));
  const lastMean = means[means.length - 1];
  const firstMean = means[0];
  const trend = lastMean != null && firstMean != null
    ? ((lastMean - firstMean) / firstMean) * 100
    : null;

  // 產 facts:每天 mean / lower / upper
  const facts = forecastRows.slice(0, 7).map(r => {
    const date = String(r.target_date ?? r.TARGET_DATE).slice(0, 10);
    const mean = fmtPrice(r.predicted_mean ?? r.PREDICTED_MEAN);
    const lo = fmtPrice(r.predicted_lower ?? r.PREDICTED_LOWER);
    const hi = fmtPrice(r.predicted_upper ?? r.PREDICTED_UPPER);
    return { title: date, value: `${mean}  [${lo} ~ ${hi}]` };
  });

  return {
    type: 'AdaptiveCard',
    version: '1.3',
    body: [
      {
        type: 'TextBlock',
        text: `📈 ${metal} ${isZh ? '7 日預測' : '7-Day Forecast'}`,
        weight: 'Bolder', size: 'Medium', color: 'Accent',
      },
      currentPrice != null ? {
        type: 'TextBlock',
        text: `${isZh ? '目前' : 'Current'}: ${fmtPrice(currentPrice)} USD`,
        isSubtle: true, size: 'Small', spacing: 'None',
      } : null,
      {
        type: 'TextBlock',
        text: `${isZh ? '走勢' : 'Trend'}: ${sparkline(means)}  (${fmtPct(trend)})`,
        spacing: 'Small',
        fontType: 'Monospace',
      },
      { type: 'FactSet', facts, spacing: 'Medium' },
      {
        type: 'TextBlock',
        text: isZh
          ? '⚠️ mean = 預測中位;[low ~ high] = 80% 信心區間'
          : '⚠️ mean = forecast median; [low ~ high] = 80% confidence',
        isSubtle: true, size: 'Small', wrap: true,
      },
    ].filter(Boolean),
    actions: [
      { type: 'Action.Submit', title: isZh ? '🧮 What-if +10%' : '🧮 What-if +10%', data: { intent: 'pm_whatif', metal, delta: 10 } },
      { type: 'Action.Submit', title: isZh ? '🧮 What-if -10%' : '🧮 What-if -10%', data: { intent: 'pm_whatif', metal, delta: -10 } },
    ],
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
  };
}

// ─── Card 3: What-if 結果 ─────────────────────────────────────────────────

function buildWhatIfCard({ metal, delta, currentPrice, simulatedPrice, costImpact, lang = 'zh-TW' }) {
  const isZh = lang.startsWith('zh');
  return {
    type: 'AdaptiveCard',
    version: '1.3',
    body: [
      {
        type: 'TextBlock',
        text: `🧮 ${metal} What-if ${fmtPct(delta)}`,
        weight: 'Bolder', size: 'Medium', color: 'Accent',
      },
      {
        type: 'FactSet',
        facts: [
          { title: isZh ? '當前 USD' : 'Current USD',     value: fmtPrice(currentPrice) },
          { title: isZh ? '模擬 USD' : 'Simulated USD',   value: fmtPrice(simulatedPrice) },
          { title: isZh ? '成本影響' : 'Cost Impact',     value: costImpact || (isZh ? '需 BOM 才能算' : 'BOM data required') },
        ],
        spacing: 'Medium',
      },
      {
        type: 'TextBlock',
        text: isZh
          ? '💡 完整 BOM 影響 → 在 Cortex web 跑 pm_what_if_cost_impact skill'
          : '💡 Full BOM impact → run pm_what_if_cost_impact skill in Cortex web',
        isSubtle: true, size: 'Small', wrap: true,
      },
    ],
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
  };
}

// ─── Help / Hint Card ────────────────────────────────────────────────────────

function buildPmHelpCard({ lang = 'zh-TW' } = {}) {
  const isZh = lang.startsWith('zh');
  return {
    type: 'AdaptiveCard',
    version: '1.3',
    body: [
      { type: 'TextBlock', text: isZh ? '🤖 PM Bot 指令' : '🤖 PM Bot Commands', weight: 'Bolder', size: 'Medium', color: 'Accent' },
      {
        type: 'TextBlock',
        text: isZh
          ? `**直接打金屬代碼或關鍵字:**

• \`Au\` / \`金價\` / \`gold\` → 今日金價
• \`銅 預測\` / \`Cu forecast\` → 7 日預測
• \`top 5\` / \`快照\` → 4 大金屬 snapshot
• \`what if 銅 +10%\` / \`銅 +10%\` → What-if 模擬
• \`/pm help\` → 顯示這個說明`
          : `**Type metal symbols or keywords:**

• \`Au\` / \`gold\` → today's price
• \`Cu forecast\` / \`銅 預測\` → 7-day forecast
• \`top 5\` / \`snapshot\` → 4-metal snapshot
• \`what if Cu +10%\` → What-if simulation
• \`/pm help\` → show this help`,
        wrap: true, spacing: 'Small',
      },
    ],
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
  };
}

module.exports = {
  sparkline,
  buildSnapshotCard,
  buildForecastCard,
  buildWhatIfCard,
  buildPmHelpCard,
};
