/**
 * AI Cleansheet Analyze — Sprint M-12(spec §12.10.4 #12 Cleansheet 草稿)
 *
 * 三廠成本拆解 + 對比分析。
 *
 * Input:
 *   factories: [
 *     { code: 'VN', name: '越南', cost_breakdown: { pcb: 1.20, smt: 0.80, assembly: 1.50, test: 0.30, total: 3.80 } },
 *     { code: 'CN', name: '中國', cost_breakdown: { ... } },
 *     { code: 'IN', name: '印度', cost_breakdown: { ... } },
 *   ]
 *   target_quantity, target_due_date
 *
 * Output:
 *   {
 *     recommended_factory: 'VN',
 *     summary: '推薦越南廠,綜合最佳',
 *     analysis_md: 'markdown 詳細分析',
 *     comparisons: [{ factor: 'cost', winner: 'VN', delta_pct: 8.5 }, ...],
 *     risks: [...],
 *     advantages: [...]
 *   }
 */

const { makeLogger } = require('./logger');
const log = makeLogger('aiCleansheetService');

const USE_LLM = process.env.PROJECTS_PLATFORM_USE_LLM === 'true';

/**
 * @param {object} db
 * @param {object} input
 * @param {number} input.projectId
 * @param {object[]} input.factories
 * @param {object} input.target            — { quantity, due_date, customer? }
 * @param {object} input.user
 */
async function analyze(db, { projectId, factories, target = {}, user }) {
  if (!Array.isArray(factories) || factories.length < 2) {
    throw new Error('factories required (at least 2 to compare)');
  }
  // 規則式做數值比對(client-side 也可,server 加 LLM 補語意分析)
  const computed = _computeComparisons(factories);

  if (!USE_LLM) {
    return _stubAnalysis(factories, target, computed);
  }
  try {
    const llmResult = await _callLlm(factories, target, computed);
    return {
      ...computed,
      ...llmResult,
      llm_used: true,
    };
  } catch (e) {
    log.warn(`cleansheet LLM failed: ${e.message}`);
    return {
      ..._stubAnalysis(factories, target, computed),
      fallback_reason: e.message,
    };
  }
}

function _computeComparisons(factories) {
  const totalCosts = factories.map((f) => ({
    code: f.code,
    name: f.name || f.code,
    total: _safeNum(f.cost_breakdown?.total) || _sumBreakdown(f.cost_breakdown),
  }));
  const sortedByCost = [...totalCosts].sort((a, b) => a.total - b.total);
  const cheapest = sortedByCost[0];
  const mostExpensive = sortedByCost[sortedByCost.length - 1];

  const delta = mostExpensive.total - cheapest.total;
  const deltaPct = cheapest.total > 0 ? (delta / cheapest.total) * 100 : 0;

  // 各 cost 項目比對
  const componentWinners = {};
  const components = new Set();
  for (const f of factories) {
    for (const k of Object.keys(f.cost_breakdown || {})) {
      if (k !== 'total') components.add(k);
    }
  }
  for (const comp of components) {
    const sorted = factories
      .map((f) => ({ code: f.code, val: _safeNum(f.cost_breakdown?.[comp]) }))
      .filter((x) => x.val > 0)
      .sort((a, b) => a.val - b.val);
    if (sorted.length > 0) {
      componentWinners[comp] = {
        winner: sorted[0].code,
        value: sorted[0].val,
        max_value: sorted[sorted.length - 1].val,
      };
    }
  }

  return {
    totals: totalCosts,
    sorted_by_cost: sortedByCost,
    cheapest: cheapest.code,
    most_expensive: mostExpensive.code,
    cost_delta: Number(delta.toFixed(4)),
    cost_delta_percent: Number(deltaPct.toFixed(2)),
    component_winners: componentWinners,
  };
}

async function _callLlm(factories, target, computed) {
  const { getGenerativeModel, extractText } = require('../../services/geminiClient');
  const llmQueue = require('./llmQueue');

  const systemPrompt = `你是 Cortex 通用專案管理平台的 AI 助手(#12 Cleansheet 草稿)。
分析三廠成本拆解,**只回 JSON**(不要 markdown,不要 \`\`\`):
{
  "recommended_factory": "廠代碼(VN/CN/IN/...)",
  "summary": "< 60 字 結論",
  "analysis_md": "markdown 詳細分析(各 cost 項目 + 廠區優勢 + 適配性)< 800 字",
  "advantages": [{ "factory": "VN", "points": ["優勢 1", "優勢 2"] }],
  "risks":      [{ "factory": "VN", "points": ["風險 1"] }]
}

⚠ 規則:
- 推薦廠不一定是最便宜的(要綜合 quantity / due_date / 風險)
- analysis_md 用繁中,條列式
- 數值要對到 input(不要捏造)
- 無充足資訊回 recommended_factory=null + summary 說明缺什麼`;

  const userPrompt = `=== 比較對象 ===
${factories.map((f) => `[${f.code}] ${f.name || f.code}\n  cost_breakdown: ${JSON.stringify(f.cost_breakdown || {})}`).join('\n')}

=== 目標 ===
quantity: ${target.quantity || '—'}
due_date: ${target.due_date || '—'}
customer: ${target.customer || '—'}

=== 規則式計算 ===
最便宜: ${computed.cheapest}(${(computed.cost_delta_percent || 0).toFixed(1)}% 比最貴低)
total 排序: ${computed.sorted_by_cost.map((t) => `${t.code}=${t.total}`).join(' / ')}

請回 JSON。`;

  const model = getGenerativeModel({
    model: process.env.GEMINI_MODEL_FLASH || 'gemini-2.5-flash',
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048, responseMimeType: 'application/json' },
    systemInstruction: systemPrompt,
  });

  const res = await llmQueue.withLLM(async () => {
    return model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    });
  }, { label: 'cleansheet_analyze', timeoutMs: 45_000 });

  const text = extractText(res).trim();
  let parsed;
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Gemini response not valid JSON: ${text.slice(0, 200)}`);
  }

  return {
    recommended_factory: parsed.recommended_factory || null,
    summary: String(parsed.summary || '').slice(0, 200),
    analysis_md: String(parsed.analysis_md || '').slice(0, 4000),
    advantages: Array.isArray(parsed.advantages) ? parsed.advantages.slice(0, 5) : [],
    risks:      Array.isArray(parsed.risks)      ? parsed.risks.slice(0, 5)      : [],
  };
}

function _safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function _sumBreakdown(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return 0;
  let sum = 0;
  for (const [k, v] of Object.entries(breakdown)) {
    if (k === 'total') continue;
    sum += _safeNum(v);
  }
  return sum;
}

function _stubAnalysis(factories, target, computed) {
  return {
    ...computed,
    recommended_factory: computed.cheapest,
    summary: `📌 Stub 模式 · 規則式推薦最便宜廠 ${computed.cheapest}(${(computed.cost_delta_percent || 0).toFixed(1)}% 比最貴低)`,
    analysis_md: `# 規則式分析(無 LLM)\n\n` +
                 `## 總成本排序\n${computed.sorted_by_cost.map((t) => `- ${t.code}: ${t.total}`).join('\n')}\n\n` +
                 `## 各項目最佳廠\n${Object.entries(computed.component_winners || {}).map(([k, v]) => `- **${k}**: ${v.winner} (${v.value})`).join('\n')}\n\n` +
                 `_設 \`PROJECTS_PLATFORM_USE_LLM=true\` 看真實 LLM 分析(會考慮 quantity / due_date / 風險)_`,
    advantages: [{ factory: computed.cheapest, points: ['總成本最低', '規則式推薦'] }],
    risks: [{ factory: computed.most_expensive, points: ['總成本偏高'] }],
    llm_used: false,
    _stub: true,
  };
}

module.exports = {
  analyze,
};
