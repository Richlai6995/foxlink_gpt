/**
 * AI What-if Service — Sprint N(spec §16.5 預測能力 B 層 / slide 16)
 *
 * 改參數即時看影響(數量 +10% → 毛利變多少 / 改廠區 → cost / 交期動)。
 *
 * 兩段式:
 *   1. 規則式 base(client + server 都可算):
 *      - quantity_pct:scale 效應(每 +10% 數量,unit cost 預估 -1.5% 規模經濟)
 *      - raw_material_pct:cost.pcb / cost.smt 線性比例
 *      - fx_pct:USD 報價直接 × (1 + fx_pct)
 *      - factory_switch:用該廠 cost_breakdown / lead_time(預設 baseline VN)
 *   2. LLM 補語意解讀(spec §16.5):
 *      - 「為何匯率降低毛利上升 +2%」一段話
 *      - 風險提示(數量翻倍但 due_date 不變 → 產能風險)
 *
 * Phase 1 MVP:
 *   - 走 LLM 解讀 + 規則式數值
 *   - 不接 ML 模型(Phase 3 Sprint Q)
 */

const { makeLogger } = require('./logger');
const log = makeLogger('aiWhatIfService');

const USE_LLM = process.env.PROJECTS_PLATFORM_USE_LLM === 'true';

/**
 * @param {object} db
 * @param {object} input
 * @param {number} input.projectId
 * @param {object} input.baseline    — { quantity, cost_total, margin_pct, due_date_days, factory_code }
 * @param {object} input.scenario    — { quantity_pct?: number, raw_material_pct?: number, fx_pct?: number, factory_code?: string }
 * @param {object} input.user
 */
async function analyze(db, { projectId, baseline, scenario = {}, user }) {
  if (!baseline) throw new Error('baseline required');

  // 規則式 projected
  const projected = _ruleBasedProject(baseline, scenario);

  if (!USE_LLM) {
    return {
      ..._buildResult(baseline, projected, scenario),
      llm_used: false,
      _stub: true,
    };
  }

  let explanation = null;
  try {
    explanation = await _llmExplain({ baseline, projected, scenario });
  } catch (e) {
    log.warn(`what-if LLM explain failed: ${e.message}`);
  }

  return {
    ..._buildResult(baseline, projected, scenario),
    explanation_md: explanation,
    llm_used: !!explanation,
  };
}

function _ruleBasedProject(baseline, scenario) {
  const qPct  = _num(scenario.quantity_pct,       0);
  const rPct  = _num(scenario.raw_material_pct,   0);
  const fxPct = _num(scenario.fx_pct,             0);
  const factorySwitch = scenario.factory_code && scenario.factory_code !== baseline.factory_code;

  // 數量規模效應:每 +10% 數量,unit cost 下降 1.5%(規則式經驗值)
  const scaleFactor   = 1 + qPct / 100;
  const scaleCostMul  = 1 - (qPct / 100) * 0.15;   // 反向 · 15% sensitivity to quantity
  // 原料漲跌:對 PCB+SMT 兩項生效(60% 成本佔比假設)
  const rawCostMul    = 1 + (rPct / 100) * 0.60;
  // 匯率:對 USD 報價直接生效
  const fxCostMul     = 1 + fxPct / 100;
  // 換廠:不同廠 cost / lead_time 差異(若未提供 factory cost 表,假設 ±5%)
  const factoryCostMul   = factorySwitch ? 1.05  : 1;
  const factoryLeadMul   = factorySwitch ? 1.10  : 1;

  const newCostTotal = _round((Number(baseline.cost_total) || 0) * scaleCostMul * rawCostMul * fxCostMul * factoryCostMul, 4);
  // margin 假設 baseline.amount / cost_total 不變;cost 變則 margin 推算
  // simplification: baseline.margin_pct 已知,我們用 amount = cost / (1 - margin/100)
  const baselineMarginPct = Number(baseline.margin_pct) || 0;
  const baselineRevenue   = (Number(baseline.cost_total) || 0) / Math.max(0.01, 1 - baselineMarginPct / 100);
  // amount 假設不變(客戶不會因為廠 / 原料漲就接受漲價);scenario 提升 cost 直接吃毛利
  const newMarginPct  = baselineRevenue > 0
    ? _round((1 - newCostTotal / baselineRevenue) * 100, 2)
    : 0;

  const newDueDays = _round((Number(baseline.due_date_days) || 0) * factoryLeadMul * scaleFactor, 1);

  return {
    cost_total: newCostTotal,
    margin_pct: newMarginPct,
    due_date_days: newDueDays,
    factory_code: scenario.factory_code || baseline.factory_code,
  };
}

function _buildResult(baseline, projected, scenario) {
  const dCost   = _round((projected.cost_total  - baseline.cost_total), 4);
  const dMargin = _round((projected.margin_pct  - baseline.margin_pct), 2);
  const dDays   = _round((projected.due_date_days - baseline.due_date_days), 1);

  const dCostPct   = baseline.cost_total > 0   ? _round(dCost   / baseline.cost_total   * 100, 2) : 0;
  const dDaysPct   = baseline.due_date_days > 0 ? _round(dDays  / baseline.due_date_days * 100, 2) : 0;

  return {
    baseline,
    scenario,
    projected,
    delta: {
      cost_total:    dCost,
      cost_total_pct: dCostPct,
      margin_pct:    dMargin,                    // absolute pp delta(percentage points)
      due_date_days: dDays,
      due_date_pct:  dDaysPct,
    },
    risks: _identifyRisks(baseline, projected, scenario),
  };
}

function _identifyRisks(baseline, projected, scenario) {
  const risks = [];
  if (projected.margin_pct < 5) {
    risks.push({ level: 'high', message: `毛利率降至 ${projected.margin_pct}%(< 5% 警戒線)` });
  } else if (projected.margin_pct < 10) {
    risks.push({ level: 'mid', message: `毛利率低於 10%(${projected.margin_pct}%)` });
  }
  if (projected.due_date_days > baseline.due_date_days * 1.2) {
    risks.push({ level: 'mid', message: `交期延長 > 20%(${projected.due_date_days} vs ${baseline.due_date_days} 天)` });
  }
  if (_num(scenario.quantity_pct) > 50) {
    risks.push({ level: 'high', message: `數量翻倍 → 產能 / 良率風險,需 NPI 重評` });
  }
  if (_num(scenario.raw_material_pct) > 10) {
    risks.push({ level: 'mid', message: `原料漲 > 10% · 建議重評議價或鎖價契約` });
  }
  return risks;
}

async function _llmExplain({ baseline, projected, scenario }) {
  const { getGenerativeModel, extractText } = require('../../services/geminiClient');
  const llmQueue = require('./llmQueue');

  const sys = `你是 Cortex 平台的 AI 助手(#18 What-if 模擬器解讀)。
用繁體中文回答,markdown 格式,< 250 字。
- 解釋 baseline → projected 的關鍵 delta
- 指出影響最大的因素(數量 / 原料 / 匯率 / 廠區)
- 若 margin 降到危險區,建議補救方向(漲價 / 換廠 / 鎖匯)`;

  const usr = `# Baseline
quantity: ${baseline.quantity || '—'}
cost_total: ${baseline.cost_total}
margin_pct: ${baseline.margin_pct}
due_date_days: ${baseline.due_date_days}
factory: ${baseline.factory_code || '—'}

# Scenario(調整)
${Object.entries(scenario).map(([k, v]) => `${k}: ${v}`).join('\n')}

# Projected
cost_total: ${projected.cost_total}
margin_pct: ${projected.margin_pct}
due_date_days: ${projected.due_date_days}
factory: ${projected.factory_code}

請以 2-4 條 markdown bullet 解讀。`;

  const model = getGenerativeModel({
    model: process.env.GEMINI_MODEL_FLASH || 'gemini-2.5-flash',
    generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
    systemInstruction: sys,
  });
  const res = await llmQueue.withLLM(async () => {
    return model.generateContent({ contents: [{ role: 'user', parts: [{ text: usr }] }] });
  }, { label: 'what_if_explain', timeoutMs: 30_000 });
  return extractText(res).trim();
}

function _num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function _round(v, p) {
  const m = Math.pow(10, p);
  return Math.round(Number(v) * m) / m;
}

module.exports = {
  analyze,
};
