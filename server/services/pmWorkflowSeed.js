'use strict';

/**
 * PM Multi-Agent Workflow Skill 自動 seed(Phase 4 14.2)
 *
 * 利用既有的 workflowEngine + skills.workflow_json 機制,seed 一個 5-agent DAG
 * 給 PM 平台做「深度市場分析」用。完全純 LLM,無 Python ML 子行程依賴。
 *
 * DAG 結構:
 *
 *   start ─┬─→ news_agent ──┐
 *          ├─→ macro_agent ─┼─→ risk_agent ─→ synthesizer ─→ output
 *          └─→ tech_agent ──┘
 *
 * 每個 agent 是獨立 LLM 呼叫(預設 Flash),可平行執行;
 * synthesizer 收三個 agent + risk 結果,用 Pro 寫整合分析報告。
 *
 * 使用方式:
 *   - chat 端:user 說 /pm-deep 觸發,或在「貴金屬」任意問題自動 route(by tags)
 *   - pipeline:`skill` 節點選 name='pm_deep_analysis_workflow',input 帶今日問題
 *   - 排程:可掛在「[PM] 每日金屬日報」之前當 prelim 分析(取代 prompt 內 inline 分析)
 *
 * 升級策略:跟 forecastSkillSeed 一樣 — workflow_json diff,版號 bump 才更新
 */

const SKILL_NAME = 'pm_deep_analysis_workflow';
const SKILL_VERSION = '1.0.0';

const DESCRIPTION = '貴金屬深度分析 5-agent workflow:News(新聞情緒)+ Macro(總體經濟)+ Technical(技術面)→ Risk(風險評估)→ Synthesizer(整合報告)。完全 LLM-based,無 Python ML 依賴。';

const TAGS = ['PM', 'workflow', 'multi-agent', 'analysis', '貴金屬', '深度分析', 'pm_deep'];
const ICON = '🤖';

// ── DAG 定義 ────────────────────────────────────────────────────────────────
// 使用者輸入(自然語言問題或標的)透過 {{start.output}} 進入。
// 每個 agent prompt 用 {{nodeId.output}} 引用前面節點的結果。
const WORKFLOW = {
  nodes: [
    {
      id: 'start',
      type: 'start',
      data: {},
    },
    // ─── Agent 1:News(新聞 + 情緒)— Flash,平行 ─────────────────────
    {
      id: 'news_agent',
      type: 'llm',
      data: {
        model_key: 'flash',
        system_prompt:
          '你是「金屬新聞情緒分析師」。任務:從近 24-48 小時的全網新聞中,撈出與使用者標的相關的 3-5 條最重要事件。每條給:標題、來源、單句摘要、情緒分數(-1~+1,對標的價格的影響)、影響時間框架(1-3 天 / 1-2 週 / 月度+)。最後給一段 100 字「新聞面綜合判斷」。直接回中文,不要 markdown 標題。',
        user_prompt:
          '使用者問題或標的:\n{{start.output}}\n\n請從你已掌握的近期新聞知識回答(若有 RAG / scrape 工具可用會更新)。輸出格式:\n\n[事件 1] 標題 — 來源 / 情緒 / 時間框架\n單句摘要\n\n[事件 2] ...\n\n──── 新聞面綜合判斷 ────\n100 字內。',
      },
    },
    // ─── Agent 2:Macro(總體經濟)— Flash,平行 ────────────────────
    {
      id: 'macro_agent',
      type: 'llm',
      data: {
        model_key: 'flash',
        system_prompt:
          '你是「總體經濟分析師」。任務:評估當前 DXY、UST10Y、原油、VIX、Fed 利率路徑、主要貨幣對(EURUSD/CNY)對使用者標的的影響。給每個指標當前狀態 + 對標的影響方向(利多/利空/中性)+ 強度(弱/中/強)。最後一段 100 字「宏觀面綜合判斷」。',
        user_prompt:
          '使用者問題或標的:\n{{start.output}}\n\n請依你掌握的最新宏觀指標狀態分析。輸出格式:\n\n• DXY:當前讀數 / 趨勢 / 對標的影響方向 + 強度\n• UST10Y:...\n• WTI 原油:...\n• VIX:...\n• Fed 路徑:...\n• 主要貨幣對:...\n\n──── 宏觀面綜合判斷 ────\n100 字內。',
      },
    },
    // ─── Agent 3:Technical(技術面)— Flash,平行 ────────────────────
    {
      id: 'tech_agent',
      type: 'llm',
      data: {
        model_key: 'flash',
        system_prompt:
          '你是「技術分析師」。任務:從你掌握的價格時序資料(若 KB / DB 有則用,否則用一般市場理解),評估標的的:當前位階 vs 50/100/200 日均線、近期動能(RSI/MACD 概念)、關鍵支撐 / 壓力、波動率水準。最後一段 80 字「技術面綜合判斷」+ 短期方向偏好(看漲 / 看跌 / 整理)。',
        user_prompt:
          '使用者問題或標的:\n{{start.output}}\n\n請給技術面解讀。輸出格式:\n\n• 位階:當前 vs 均線(高位 / 中性 / 低檔)\n• 動能:RSI / MACD 概念狀態\n• 關鍵價位:支撐 / 壓力\n• 波動率:近期擴大 / 收縮\n\n──── 技術面綜合判斷 ────\n80 字 + 方向偏好。',
      },
    },
    // ─── Agent 4:Risk(風險評估)— Flash,需 News+Macro+Tech 結果 ────
    {
      id: 'risk_agent',
      type: 'llm',
      data: {
        model_key: 'flash',
        system_prompt:
          '你是「風險評估師」。整合三個前置 agent 的判斷(新聞情緒 / 宏觀 / 技術),給出:1) 三面是否一致(共振 / 分歧)、2) 主要下行風險(地緣 / 政策 / 流動性 / 黑天鵝)、3) 主要上行風險(供給瓶頸 / 需求驚喜)、4) 採購單位最該注意的 1-3 個關鍵變數。',
        user_prompt:
          '使用者標的:\n{{start.output}}\n\n── News Agent ──\n{{news_agent.output}}\n\n── Macro Agent ──\n{{macro_agent.output}}\n\n── Technical Agent ──\n{{tech_agent.output}}\n\n請整合上述,給風險評估。輸出格式:\n\n[三面共振度] 一致 / 部分分歧 / 完全分歧 + 一句說明\n\n[下行風險]\n• ...\n• ...\n\n[上行風險]\n• ...\n• ...\n\n[採購最該注意的關鍵變數]\n1. ...\n2. ...\n3. ...',
      },
    },
    // ─── Agent 5:Synthesizer(整合報告)— Pro,最終彙整 ─────────────
    {
      id: 'synthesizer',
      type: 'llm',
      data: {
        model_key: 'pro',
        system_prompt:
          '你是「資深市場策略師」,給採購單位看的最終整合報告。整合 News / Macro / Technical / Risk 四個 agent 的結論,寫一份 400-600 字的決策建議。語氣專業、避免空話、給具體數字 / 日期 / 動作建議。最後給「明日可執行動作」3 條(進貨節奏 / 避險 / 觀望)。',
        user_prompt:
          '使用者標的 / 問題:\n{{start.output}}\n\n══════ 4 個 agent 的判斷 ══════\n\n── News ──\n{{news_agent.output}}\n\n── Macro ──\n{{macro_agent.output}}\n\n── Technical ──\n{{tech_agent.output}}\n\n── Risk ──\n{{risk_agent.output}}\n\n══════ 你的任務 ══════\n寫一份 400-600 字的整合策略報告(繁體中文 markdown),結構:\n\n## 標題(包含標的 + 短期方向偏好)\n\n### 一句話摘要\n\n### 核心判斷(3-4 句,引用三面共振狀態)\n\n### 主要驅動 / 風險(2-4 條 bullet)\n\n### 給採購單位的具體建議(1-2 段)\n\n### 明日可執行動作\n1. ...\n2. ...\n3. ...',
      },
    },
    // ─── Output ─────────────────────────────────────────────────────────
    {
      id: 'out',
      type: 'output',
      data: {},
    },
  ],
  edges: [
    { source: 'start', target: 'news_agent' },
    { source: 'start', target: 'macro_agent' },
    { source: 'start', target: 'tech_agent' },
    { source: 'news_agent', target: 'risk_agent' },
    { source: 'macro_agent', target: 'risk_agent' },
    { source: 'tech_agent', target: 'risk_agent' },
    { source: 'risk_agent', target: 'synthesizer' },
    { source: 'synthesizer', target: 'out' },
  ],
};

async function autoSeedPmWorkflowSkill(db) {
  if (!db) return;

  // 找 admin 當 owner
  let ownerId = null;
  try {
    const r = await db.prepare(`SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id FETCH FIRST 1 ROWS ONLY`).get();
    ownerId = r?.id || null;
  } catch (_) {}

  let existing;
  try {
    existing = await db.prepare(`SELECT id, workflow_json, description FROM skills WHERE UPPER(name)=UPPER(?)`).get(SKILL_NAME);
  } catch (e) {
    console.warn('[PMWorkflowSeed] SELECT failed:', e.message);
    return;
  }

  const workflowJson = JSON.stringify(WORKFLOW);
  const tagsJson = JSON.stringify(TAGS);

  if (!existing) {
    try {
      await db.prepare(`
        INSERT INTO skills
          (name, description, icon, type, workflow_json, tags, owner_user_id,
           is_public, is_admin_approved, endpoint_mode)
        VALUES (?, ?, ?, 'workflow', ?, ?, ?, 1, 1, 'inject')
      `).run(SKILL_NAME, DESCRIPTION, ICON, workflowJson, tagsJson, ownerId);
      console.log(`[PMWorkflowSeed] Created workflow skill ${SKILL_NAME} v${SKILL_VERSION}`);
    } catch (e) {
      console.error('[PMWorkflowSeed] INSERT failed:', e.message);
    }
    return;
  }

  // 既有 row — 比對 workflow_json 是否要升級
  const existingWf = existing.workflow_json || existing.WORKFLOW_JSON || '';
  const existingDesc = existing.description || existing.DESCRIPTION || '';
  if (existingWf === workflowJson && existingDesc === DESCRIPTION) return;

  try {
    await db.prepare(`
      UPDATE skills
      SET description=?, workflow_json=?, tags=?, icon=?, type='workflow',
          is_public=1, is_admin_approved=1
      WHERE id=?
    `).run(DESCRIPTION, workflowJson, tagsJson, ICON, existing.id || existing.ID);
    console.log(`[PMWorkflowSeed] Upgraded ${SKILL_NAME} to v${SKILL_VERSION}`);
  } catch (e) {
    console.error('[PMWorkflowSeed] UPDATE failed:', e.message);
  }
}

module.exports = { autoSeedPmWorkflowSkill, SKILL_NAME, SKILL_VERSION, WORKFLOW };
