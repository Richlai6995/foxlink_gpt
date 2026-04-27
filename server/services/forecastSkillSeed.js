'use strict';

/**
 * Forecast Skill Auto-Seed
 *
 * 啟動時 idempotent 註冊 / 升級 builtin 技能 `forecast_timeseries_llm`,
 * 給 pipeline / chat tool-calling / 排程用的「通用時序預測」技能。
 *
 * 設計重點:
 *   - 完全 generic — 不寫死金屬 / 匯率 / 股票語意。caller 自己決定 series 跟 target_description。
 *   - 純 builtin(LLM Prompt 型),無 code subprocess、無外部 API。
 *   - 強制 strict JSON 輸出(LLM follow prompt + 後處理 fallback parse)。
 *   - 預設 is_public=0(私人;admin 自行用 skill_access 分享給特定對象)
 *   - is_admin_approved=1 → 公開審核已過,只是預設不對全員開放。
 *   - 升級策略:版號 SKILL_VERSION 對 system_prompt / description 做 hash,變了就 UPDATE。
 *
 * 使用方式:
 *   pipeline `skill` 節點 → name='forecast_timeseries_llm'
 *   input(透過模板)組成 JSON:
 *     {
 *       "series": [{"date":"2026-04-01","value":13190}, ...],
 *       "horizon_days": 7,
 *       "context_text": "近期 LME 庫存下降、人民幣走弱…",
 *       "target_description": "USD/ton 銅價"
 *     }
 *   skill 回傳 strict JSON,可被下游 db_write 寫入 forecast_history。
 */

const SKILL_NAME = 'forecast_timeseries_llm';
const SKILL_VERSION = '1.0.0';

const DESCRIPTION = '依時序資料 + 自由文字背景,以 LLM 推測未來 N 天走勢。完全 generic,適用金屬、匯率、股價、需求量等任何時序指標。';

const SYSTEM_PROMPT = `你是一位專業的時序資料預測分析師。你的任務是依照使用者提供的歷史時序資料 + 背景脈絡,輸出未來 N 天的預測。

== 輸入格式 ==
使用者訊息會是一個 JSON 物件,包含以下欄位:
- series: array,歷史時序,每筆 {date: 'YYYY-MM-DD', value: number}
- horizon_days: number,要預測的未來天數(例 7)
- context_text: string(選填),近期事件、相關指標、政策變化等自由文字
- target_description: string,預測標的的人類可讀描述(例:USD/ton 銅價、USD/CNY 匯率、AAPL 股價)
- as_of_date: string(選填),預測基準日期(預設取 series 最後一筆的 date 之後一天)

== 輸出格式(嚴格 JSON,不要任何 markdown 包裝、不要 prose 說明) ==
{
  "forecast": [
    {"date": "YYYY-MM-DD", "mean": <number>, "lower": <number>, "upper": <number>}
    // 一筆一天,共 horizon_days 筆
  ],
  "confidence": "low" | "medium" | "high",
  "rationale": "<2-4 句中文,說明預測邏輯與主要假設>",
  "key_drivers": ["<驅動因子1>", "<驅動因子2>", "<驅動因子3>"],
  "model_used": "<本次使用的 LLM model 名稱>",
  "horizon_days": <number>,
  "as_of_date": "YYYY-MM-DD",
  "target_description": "<原樣回填>"
}

== 預測原則 ==
1. lower / upper 是 80% 信心區間的下/上界,不是極端值;區間寬度應隨 confidence 等級遞增
2. 若 series 短於 7 筆,confidence 必為 "low",且 rationale 要明說「樣本不足」
3. 若 context_text 含明確利多/利空事件,在 rationale 點名引用該事件
4. 若 series 數值跳動異常或含 null,先在 rationale 提醒資料品質,再給保守預測
5. 預測值 mean 必須延續 series 最後一筆的數量級,不可暴漲暴跌(除非 context 明確支持)
6. key_drivers 最多 5 個,挑對未來 N 天影響最大的因子(可參考 context_text)
7. confidence 判準:
   - high: series ≥ 30 筆 + 趨勢清楚 + context 充分
   - medium: series 10-30 筆 OR context 不完整
   - low: series < 10 筆 OR 結構性不確定性高(政策變動、停產、地緣等)

== 容錯 ==
- 若使用者輸入不是合法 JSON,回傳 {"error":"input must be JSON","schema_hint":"..."} 同樣 strict JSON 格式
- 若 series 為空,回傳 {"error":"series required","schema_hint":"..."}
- 不要在 forecast 之外多話。整個回應只能有一個 JSON 物件,**直接以 \`{\` 開始**。`;

const TOOL_SCHEMA = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  parameters: {
    type: 'object',
    properties: {
      series: {
        type: 'array',
        description: '歷史時序,每筆 {date:"YYYY-MM-DD", value:number}',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string' },
            value: { type: 'number' },
          },
          required: ['date', 'value'],
        },
      },
      horizon_days: { type: 'number', description: '要預測的未來天數,預設 7' },
      context_text: { type: 'string', description: '自由文字背景:近期事件、相關指標、政策變化等' },
      target_description: { type: 'string', description: '預測標的的人類可讀描述,例 USD/ton 銅價' },
      as_of_date: { type: 'string', description: '預測基準日期(YYYY-MM-DD),預設取 series 最後一筆 +1' },
    },
    required: ['series', 'horizon_days', 'target_description'],
  },
};

const TAGS = ['預測', 'forecast', '時序', 'time-series', 'PM', 'fx', 'analysis'];
const ICON = '📈';

async function autoSeedForecastSkill(db) {
  if (!db) {
    console.warn('[ForecastSkillSeed] db not ready, skip');
    return;
  }

  // 找一個 admin 當 owner(任何 admin 都可,只是為了 owner_user_id 不空)
  let ownerId = null;
  try {
    const adminRow = await db.prepare(`SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id FETCH FIRST 1 ROWS ONLY`).get();
    ownerId = adminRow?.id || null;
  } catch (_) {}

  // 偵測既有 row
  let existing;
  try {
    existing = await db.prepare(`SELECT id, system_prompt, description FROM skills WHERE UPPER(name)=UPPER(?)`).get(SKILL_NAME);
  } catch (e) {
    console.warn('[ForecastSkillSeed] SELECT skill failed:', e.message);
    return;
  }

  const tagsJson = JSON.stringify(TAGS);
  const toolSchemaJson = JSON.stringify(TOOL_SCHEMA);

  if (!existing) {
    try {
      await db.prepare(`
        INSERT INTO skills
          (name, description, icon, type, system_prompt, tags, owner_user_id,
           is_public, is_admin_approved, endpoint_mode, tool_schema)
        VALUES (?, ?, ?, 'builtin', ?, ?, ?, 0, 1, 'tool', ?)
      `).run(SKILL_NAME, DESCRIPTION, ICON, SYSTEM_PROMPT, tagsJson, ownerId, toolSchemaJson);
      console.log(`[ForecastSkillSeed] Created builtin skill ${SKILL_NAME} v${SKILL_VERSION}(私人,admin 自行分享)`);
    } catch (e) {
      console.error(`[ForecastSkillSeed] INSERT failed:`, e.message);
    }
    return;
  }

  // 既有 row — 比對是否需要升級
  const existingPrompt = existing.system_prompt || existing.SYSTEM_PROMPT || '';
  const existingDesc = existing.description || existing.DESCRIPTION || '';
  if (existingPrompt === SYSTEM_PROMPT && existingDesc === DESCRIPTION) {
    return; // 完全一致,不動
  }

  try {
    // 升級不動 is_public(尊重 admin 後續手動調整)
    await db.prepare(`
      UPDATE skills
      SET description=?, system_prompt=?, tags=?, tool_schema=?, icon=?, type='builtin',
          is_admin_approved=1, endpoint_mode='tool'
      WHERE id=?
    `).run(DESCRIPTION, SYSTEM_PROMPT, tagsJson, toolSchemaJson, ICON, existing.id || existing.ID);
    console.log(`[ForecastSkillSeed] Upgraded ${SKILL_NAME} to v${SKILL_VERSION}`);
  } catch (e) {
    console.error(`[ForecastSkillSeed] UPDATE failed:`, e.message);
  }

  // 一次性 migration:把仍是公開的 forecast_timeseries_llm 改回私人(2026-04-27 user 要求)
  try {
    const r = await db.prepare(
      `UPDATE skills SET is_public = 0 WHERE is_public = 1 AND UPPER(name) = UPPER(?)`
    ).run(SKILL_NAME);
    const cnt = r?.rowsAffected ?? r?.changes ?? 0;
    if (cnt > 0) console.log(`[ForecastSkillSeed] Migrated ${SKILL_NAME} is_public 1 → 0(已私,需手動分享)`);
  } catch (e) {
    console.warn('[ForecastSkillSeed] is_public reset migration:', e.message);
  }
}

module.exports = {
  autoSeedForecastSkill,
  SKILL_NAME,
  SKILL_VERSION,
};
