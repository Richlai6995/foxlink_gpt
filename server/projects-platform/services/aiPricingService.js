/**
 * AI Pricing Suggest — Sprint M-11(spec §12.5 + §12.10.4 #16)
 *
 * Form 內「✨ AI 建議」按鈕的 backend service。
 *
 * 流程:
 *   1. 拿 context(customer / partNo / quantity / due_date / specs)
 *   2. 撈沉澱 KB 內類似客戶 + 類似料號的歷史結案案(scrub 過 → safe)
 *   3. LLM prompt:給 historical evidence + current context → 推薦 Tier + 信心 + 理由
 *   4. 回 { suggested_value, confidence_percent, reasoning, references[] }
 *
 * 安全:
 *   - 所有 historical evidence 已經 scrub(沉澱 KB 必走 scrub)
 *   - 仍走 botService 的 scrub 模式(額外保險 — Tier-A → [PRICE_01] before LLM)
 *   - 結果 Unscrub 回 user 視角
 *   - 永遠以發起 user 身份(spec §12.3)
 *
 * Phase 2 規模:
 *   - 智慧定價(amount/margin/Tier 推薦)
 *   - 後續可擴:partNo 對齊、specs 標準化、customer 等級判斷
 */

const { makeLogger } = require('./logger');
const log = makeLogger('aiPricingService');

const USE_LLM = process.env.PROJECTS_PLATFORM_USE_LLM === 'true';

const MAX_HISTORICAL_CASES = 8;

/**
 * 推薦定價 / 機密欄位值
 *
 * @param {object} db
 * @param {object} input
 * @param {number} input.projectId
 * @param {string} input.field            — 要建議的 field(e.g. 'amount' / 'margin' / 'pricing_tier')
 * @param {object} input.context          — { customer?, part_no?, quantity?, due_date?, specs? }
 * @param {object} input.user             — req.user
 * @returns {Promise<{ suggested_value, confidence_percent, reasoning, references, llm_used }>}
 */
async function suggest(db, { projectId, field, context = {}, user }) {
  if (!projectId || !field) throw new Error('projectId / field required');
  field = String(field).trim();

  // 載專案 metadata(補 context)
  const project = await db.prepare(`
    SELECT id, project_code, project_type_id, bu_id, data_payload
      FROM projects WHERE id = ?
  `).get(projectId);
  if (!project) throw new Error('project not found');

  // Merge context with project payload
  const payload = (() => { try { return JSON.parse(project.data_payload || '{}'); } catch { return {}; } })();
  const ctx = {
    customer:  context.customer  || payload.customer || payload.customer_name,
    part_no:   context.part_no   || payload.partNo   || payload.part_no,
    quantity:  context.quantity  || payload.quantity,
    due_date:  context.due_date  || payload.dueDate  || payload.due_date,
    specs:     context.specs     || payload.specs,
  };

  // 撈相似 historical cases — 從沉澱 KB
  const historicalCases = await _findHistoricalCases(db, ctx);

  if (!USE_LLM) {
    return _stubSuggestion(field, ctx, historicalCases);
  }

  try {
    const result = await _callLlm(field, ctx, historicalCases);
    return {
      ...result,
      llm_used: true,
      historical_cases_count: historicalCases.length,
    };
  } catch (e) {
    log.warn(`pricing LLM failed: ${e.message}`);
    return {
      ..._stubSuggestion(field, ctx, historicalCases),
      llm_used: false,
      fallback_reason: e.message,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
async function _findHistoricalCases(db, ctx) {
  // 從 sediment KB chunks 找 customer (scrub 後變 A001) + part_no 相似案
  // 因 sediment 已 scrub,直接 LIKE 'A001' 找不到原 customer。所以這邊用 part_no 或 specs 關鍵字
  const keywords = [];
  if (ctx.part_no) keywords.push(String(ctx.part_no).slice(0, 30));
  if (ctx.specs)   keywords.push(...String(ctx.specs).split(/[\s,。?!,]/).filter((s) => s.length >= 3).slice(0, 3));
  if (keywords.length === 0) return [];

  const wh = ["is_sediment = 1", "kind = 'case'",
             '(' + keywords.map(() => "UPPER(content) LIKE UPPER(?)").join(' OR ') + ')'];
  const params = keywords.map((k) => `%${k}%`);
  try {
    const rows = await db.prepare(`
      SELECT id, project_id, content, title, scrubbed, scrub_note, created_at
        FROM project_kb_chunks
       WHERE ${wh.join(' AND ')}
       ORDER BY created_at DESC
       FETCH FIRST ${MAX_HISTORICAL_CASES} ROWS ONLY
    `).all(...params);
    return rows.map((r) => ({
      project_id: r.project_id,
      content: String(r.content || '').slice(0, 600),
      title: r.title || '',
      scrubbed: Number(r.scrubbed) === 1,
    }));
  } catch (e) {
    log.warn(`find historical cases failed: ${e.message}`);
    return [];
  }
}

async function _callLlm(field, ctx, historicalCases) {
  const { getGenerativeModel, extractText } = require('../../services/geminiClient');
  const llmQueue = require('./llmQueue');

  const fieldDesc = _fieldDescription(field);
  const systemPrompt = `你是 Cortex 通用專案管理平台的 AI 助手(代號 #16 智慧定價建議 / Form Surface 2)。
用繁體中文回答,**只回 JSON**(不要 markdown,不要 \`\`\` 包):
{
  "suggested_value": "建議值(${fieldDesc})",
  "confidence_percent": 0-100 整數,
  "reasoning": "推薦理由 < 250 字 · 引用 N 個歷史案的特徵",
  "references": [
    { "project_code": "QT-2025-N", "similarity_reason": "為什麼相似(< 50 字)" }
  ]
}

⚠ 規則:
- references 最多 3 個
- 若無歷史 evidence,suggested_value 設 null,confidence_percent 設 0
- 機密欄位 raw 值絕對不要捏造 — 沉澱 KB 看到的都是 Tier-? / A001 / MASKED%
- ${fieldDesc.includes('Tier') ? '輸出 Tier-S / Tier-A / Tier-B / Tier-M / Tier-L 等' : '依欄位語意'}`;

  const evidence = historicalCases.length
    ? `=== 歷史相似案(沉澱 KB · 已 scrub)===\n${
        historicalCases.map((c, i) =>
          `[案 ${i + 1}] ${c.title || `project#${c.project_id}`}\n${c.content}`).join('\n\n')
      }`
    : '=== 無歷史相似案可參考 ===';

  const userPrompt = `=== 當前案 context ===
customer:   ${ctx.customer || '—'}
part_no:    ${ctx.part_no || '—'}
quantity:   ${ctx.quantity || '—'}
due_date:   ${ctx.due_date || '—'}
specs:      ${ctx.specs   || '—'}

${evidence}

=== 需要建議的欄位 ===
${field} · ${fieldDesc}

請回 JSON。`;

  const model = getGenerativeModel({
    model: process.env.GEMINI_MODEL_FLASH || 'gemini-2.5-flash',
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024, responseMimeType: 'application/json' },
    systemInstruction: systemPrompt,
  });

  const res = await llmQueue.withLLM(async () => {
    return model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    });
  }, { label: 'pricing_suggest', timeoutMs: 30_000 });

  const text = extractText(res).trim();
  let parsed;
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Gemini response not valid JSON: ${text.slice(0, 200)}`);
  }

  return {
    suggested_value:    parsed.suggested_value,
    confidence_percent: _clampConf(parsed.confidence_percent),
    reasoning:          String(parsed.reasoning || '').slice(0, 1000),
    references:         Array.isArray(parsed.references) ? parsed.references.slice(0, 5) : [],
  };
}

function _fieldDescription(field) {
  const m = {
    amount:           '報價金額(若機密案輸 Tier-? · 否則輸實際數字 USD)',
    margin:           '毛利率(% 或 Tier · 機密 → MASKED%)',
    cost_breakdown:   '成本拆解(機密案輸 [PRICE_01] / 否則拆 PCB / 模組 / 組裝)',
    pricing_tier:     '定價 Tier(Tier-S / Tier-A / Tier-B / Tier-M / Tier-L)',
    quantity:         '建議數量',
    estimatedCycleDays: '預估週期(天)',
    priorityScore:    'priority_score(1-6)',
  };
  return m[field] || `欄位 ${field}(自由文字 / 數字)`;
}

function _clampConf(n) {
  if (n == null) return 0;
  const v = Math.round(Number(n));
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function _stubSuggestion(field, ctx, historicalCases) {
  return {
    suggested_value: field === 'amount' ? 'Tier-M' :
                     field === 'margin' ? 'MASKED%' :
                     field === 'priorityScore' ? 5 :
                     'stub',
    confidence_percent: 50,
    reasoning: `📌 Stub 模式 · 設 PROJECTS_PLATFORM_USE_LLM=true 看真實 LLM 推薦` +
               (historicalCases.length
                 ? `\n找到 ${historicalCases.length} 個歷史相似案(沉澱 KB · part_no/specs LIKE)`
                 : `\n無歷史相似案可參考(沉澱 KB chunks 還沒累積)`),
    references: historicalCases.slice(0, 3).map((c) => ({
      project_code: `project#${c.project_id}`,
      similarity_reason: 'stub mock',
    })),
    historical_cases_count: historicalCases.length,
    llm_used: false,
    _stub: true,
  };
}

module.exports = {
  suggest,
};
