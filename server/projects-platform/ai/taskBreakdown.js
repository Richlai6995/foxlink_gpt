/**
 * AI #29 — 任務自動拆解
 *
 * 對齊 PPT slide 21 + Demo 手冊 §8.1
 *
 * 業務輸入一句話(例「跑越南成本」),AI 拆 3-6 個子任務 + 預估工時 + 建議 A/R。
 *
 * USE_LLM=true 走真 Gemini Flash;false 走 stub(對齊既有 statusSummary 模式)
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('ai/taskBreakdown');

const USE_LLM = process.env.PROJECTS_PLATFORM_USE_LLM === 'true';
const LLM_MODEL = process.env.PROJECTS_PLATFORM_BREAKDOWN_MODEL || process.env.GEMINI_MODEL_FLASH || 'gemini-flash';

// Lazy import
let _gemini = null;
let _queue = null;
function gemini() { if (!_gemini) _gemini = require('../../services/geminiClient'); return _gemini; }
function queue()  { if (!_queue)  _queue  = require('../services/llmQueue'); return _queue; }

/**
 * 拆解 user 一句話 → N 個 subtasks
 *
 * @param {string} prompt
 * @param {object} [ctx]  選用上下文(專案類型 / stage 等)
 * @returns {Promise<{ subtasks: Array, _llm: boolean }>}
 */
async function breakdown(prompt, ctx = {}) {
  if (!prompt || !prompt.trim()) throw new Error('prompt required');

  // Stub(預設 / 失敗 fallback)
  const stub = _stubBreakdown(prompt, ctx);

  if (!USE_LLM) {
    return { subtasks: stub, _llm: false, _model: null };
  }

  try {
    const subtasks = await _llmBreakdown(prompt, ctx);
    return { subtasks, _llm: true, _model: LLM_MODEL };
  } catch (e) {
    log.warn(`LLM breakdown failed (fallback to stub):`, e.message);
    return { subtasks: stub, _llm: false, _model: null, _error: e.message };
  }
}

/** Mock 拆解(規則式) */
function _stubBreakdown(prompt, ctx) {
  const projectType = ctx.type_code || 'QUOTE';
  const lower = String(prompt).toLowerCase();

  // 嘗試識別常見任務樣板
  if (lower.includes('成本') || lower.includes('cost')) {
    return [
      { title: `${prompt} - BOM 結構分析`,         sla_hours: 24, accountable_role: 'DPM', responsible_role: 'EE' },
      { title: `${prompt} - 採購詢價`,             sla_hours: 48, accountable_role: 'MPM', responsible_role: '工廠採購' },
      { title: `${prompt} - 工時 / 良率推估`,      sla_hours: 16, accountable_role: 'MPM', responsible_role: 'SMT team' },
      { title: `${prompt} - Cleansheet 整合`,      sla_hours: 8,  accountable_role: 'DPM', responsible_role: 'DPM' },
    ];
  }
  if (lower.includes('bom')) {
    return [
      { title: 'EE BOM 整理',  sla_hours: 24, accountable_role: 'DPM', responsible_role: 'EE' },
      { title: 'ME BOM 整理',  sla_hours: 24, accountable_role: 'DPM', responsible_role: 'ME' },
      { title: 'BOM Cost 整合', sla_hours: 12, accountable_role: 'DPM', responsible_role: '採購' },
    ];
  }
  if (lower.includes('q&a') || lower.includes('客戶') || lower.includes('問題')) {
    return [
      { title: `${prompt} - 整理客戶 Q&A 清單`, sla_hours: 4, accountable_role: 'DPM', responsible_role: 'DPM' },
      { title: `${prompt} - 內部研擬回覆`,      sla_hours: 8, accountable_role: 'DPM', responsible_role: 'engineering' },
      { title: `${prompt} - BPM 對客戶送出`,    sla_hours: 4, accountable_role: 'BPM', responsible_role: 'BPM' },
    ];
  }
  // Default 通用 3 段
  return [
    { title: `${prompt} - 規劃 / 拆解`, sla_hours: 4, accountable_role: 'PM',  responsible_role: 'PM' },
    { title: `${prompt} - 執行`,       sla_hours: 24, accountable_role: 'PM', responsible_role: 'engineering' },
    { title: `${prompt} - Review`,    sla_hours: 4, accountable_role: 'PM',  responsible_role: 'PM' },
  ];
}

/** 真 LLM 拆解 */
async function _llmBreakdown(prompt, ctx) {
  const sysPrompt = `你是專案管理 AI 助手 #29。把一句話的工作項目拆成 3-6 個具體 subtask。

規則:
1. 每個 subtask 有 title(15 字內,清晰)、sla_hours(整數小時)、accountable_role(A · 背鍋,通常 PM / DPM / BPM / MPM / EPM)、responsible_role(R · 實作,可填 role 或具體 team)
2. 對齊 OIBG flow RACI 概念(A/R 通常不同人)
3. 嚴格 JSON 回應,format:
   { "subtasks": [{"title": "...", "sla_hours": 24, "accountable_role": "DPM", "responsible_role": "EE"}, ...] }

輸入:
  專案類型: ${ctx.type_code || 'QUOTE'}
  ${ctx.stage_code ? `當前 stage: ${ctx.stage_code}` : ''}
  user 一句話: ${prompt}`;

  const text = await queue().withLLM(async () => {
    const model = gemini().getGenerativeModel({ model: LLM_MODEL });
    const resp = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: sysPrompt }] }],
    });
    return gemini().extractText(resp);
  });

  const json = String(text || '').match(/\{[\s\S]*\}/);
  if (!json) throw new Error('LLM did not return JSON');
  const parsed = JSON.parse(json[0]);
  if (!Array.isArray(parsed.subtasks) || parsed.subtasks.length === 0) {
    throw new Error('invalid subtasks structure');
  }
  // 規格化 + cap
  return parsed.subtasks.slice(0, 6).map((s) => ({
    title:             String(s.title || '').slice(0, 100) || '(未命名)',
    sla_hours:         Math.max(1, Math.min(168, Number(s.sla_hours) || 8)),
    accountable_role:  String(s.accountable_role || 'PM').slice(0, 30),
    responsible_role:  String(s.responsible_role || 'PM').slice(0, 30),
  }));
}

module.exports = { breakdown };
