'use strict';

/**
 * PM BOM What-if 模擬 Skill 自動 seed(Phase 4 14.1)
 *
 * 註冊 builtin skill `pm_what_if_cost_impact`:
 *   給定金屬代碼 + 漲跌幅 → 從 pm_bom_metal 表撈所有受影響產品,
 *   算每產品線成本變化(月成本 / 年成本),用 LLM 寫成本影響分析報告。
 *
 * 完全 LLM-based,無 Python ML / 子行程依賴。
 *
 * 使用流程:
 *   1. Admin 透過「BOM 管理」分頁(routes/pmBom.js)上傳 CSV / 手動填 pm_bom_metal
 *      格式:product_code, product_name, product_line, metal_code, content_gram, monthly_volume
 *   2. Chat / Pipeline 呼叫 pm_what_if_cost_impact skill,input 為 JSON:
 *      { "scenarios": [{ "metal_code": "CU", "pct_change": 10 }, ...] }
 *   3. Skill 回 markdown 報告 + JSON 落地段(可給 db_write 寫 pm_analysis_report)
 *
 * 注意:
 *   - 這是「LLM Prompt 型」skill,不直接查 DB(LLM 沒這能力);
 *     真正撈 pm_bom_metal + 計算數字的是「pm_what_if_cost_impact_compute」工具(由 chat / pipeline
 *     先 query 並把結果塞進 prompt),或者 admin 用 AI 戰情 design 直接查
 *   - 簡化版:此 skill 直接生成 prompt 範本指引,實際計算靠 user 在 chat 中給數據,
 *     未來可改 type='code' 加 subprocess 直接讀 DB
 */

const SKILL_NAME = 'pm_what_if_cost_impact';
const SKILL_VERSION = '1.0.0';

const DESCRIPTION = '貴金屬漲跌的成本衝擊 What-if 模擬:給定 metal_code + pct_change 場景,從 BOM 撈受影響產品,算月度 / 年度成本變化,LLM 寫採購策略建議報告。';

const SYSTEM_PROMPT = `你是「採購成本影響分析師」。任務:依 user 提供的金屬漲跌場景 + BOM 資料,算成本衝擊,寫出採購策略建議。

== 輸入格式 ==
user 訊息會是一個 JSON 物件,可能包含:
{
  "scenarios": [
    { "metal_code": "CU", "pct_change": 10, "duration_months": 3 },
    { "metal_code": "AU", "pct_change": -5, "duration_months": 6 }
  ],
  "current_prices": { "CU": 13190, "AU": 2580, ... }     // USD/ton 或 USD/oz
  "bom_data": [
    { "product_code": "P-001", "product_name": "...", "product_line": "Connector",
      "metal_code": "CU", "content_gram": 12.5, "monthly_volume": 100000 }
    // ...
  ]
}

如果 bom_data 沒給,你應該明確告知 user「請先在 Admin → BOM 管理 上傳產品物料含量」並停在這。

== 計算邏輯 ==
對 scenarios 的每個項目:
1. 找 bom_data 中 metal_code 相符的 entries
2. 對每筆:absolute_metal_cost_per_unit = (current_price * pct_change/100) * (content_gram / 1000)
   (對 USD/oz 標的記得換算 oz → g)
3. monthly_impact = absolute_metal_cost_per_unit * monthly_volume
4. yearly_impact = monthly_impact * 12

匯總:
- total_monthly_impact_usd
- top 5 受衝擊產品(by monthly_impact)
- per product_line 影響(group by product_line)

== 輸出格式 ==
A. **策略報告**(中文 markdown,給人看)
- 開場 100 字:這個場景對採購總體影響
- 表格:Top 5 受影響產品(product_code / metal / monthly_impact / yearly_impact)
- 表格:per product_line 月度影響
- 採購建議(3-5 條,例:鎖價 / 替代料評估 / 增加安全庫存 / 提前向客戶轉嫁 / 部分對沖)

B. **JSON 落地段**(給 db_write / 後續分析用,放 markdown 末尾的 \`\`\`json 區塊):
\`\`\`json
{
  "report_type": "what_if_cost_impact",
  "as_of_date": "{{date}}",
  "title": "...",
  "summary": "...",
  "scenarios_summary": [
    { "metal_code": "CU", "pct_change": 10, "total_monthly_impact_usd": 12345 }
  ],
  "top_impacted_products": [
    { "product_code": "P-001", "product_name": "...", "metal_code": "CU",
      "monthly_impact_usd": 1500, "yearly_impact_usd": 18000 }
  ],
  "by_product_line": [
    { "product_line": "Connector", "monthly_impact_usd": 5000, "yearly_impact_usd": 60000 }
  ],
  "recommendations": "用換行分隔的 3-5 條建議"
}
\`\`\`

== 防呆 ==
- 若 scenarios 為空 → 回 {"error":"scenarios required"}
- 若 bom_data 為空 → 提示先上傳 BOM,別給數字
- 若 current_prices 缺,用最近報價估(明確標註 estimated)
- 數字一律 round to 2 decimals,不要科學記號`;

const TOOL_SCHEMA = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  parameters: {
    type: 'object',
    properties: {
      scenarios: {
        type: 'array',
        description: '場景陣列,每筆 { metal_code, pct_change, duration_months }',
        items: { type: 'object' },
      },
      current_prices: {
        type: 'object',
        description: '當前金屬價格 map,例 { "CU": 13190 }(USD/ton 或 USD/oz)',
      },
      bom_data: {
        type: 'array',
        description: 'BOM rows(從 pm_bom_metal 撈),每筆 { product_code, product_name, product_line, metal_code, content_gram, monthly_volume }',
        items: { type: 'object' },
      },
    },
    required: ['scenarios'],
  },
};

const TAGS = ['PM', 'BOM', 'what-if', '成本分析', '採購', 'pm_what_if'];
const ICON = '📊';

async function autoSeedPmBomSkill(db) {
  if (!db) return;

  let ownerId = null;
  try {
    const r = await db.prepare(`SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id FETCH FIRST 1 ROWS ONLY`).get();
    ownerId = r?.id || null;
  } catch (_) {}

  let existing;
  try {
    existing = await db.prepare(`SELECT id, system_prompt, description FROM skills WHERE UPPER(name)=UPPER(?)`).get(SKILL_NAME);
  } catch (e) {
    console.warn('[PMBomSkillSeed] SELECT failed:', e.message);
    return;
  }

  const tagsJson = JSON.stringify(TAGS);
  const toolJson = JSON.stringify(TOOL_SCHEMA);

  if (!existing) {
    try {
      await db.prepare(`
        INSERT INTO skills
          (name, description, icon, type, system_prompt, tags, owner_user_id,
           is_public, is_admin_approved, endpoint_mode, tool_schema)
        VALUES (?, ?, ?, 'builtin', ?, ?, ?, 0, 1, 'tool', ?)
      `).run(SKILL_NAME, DESCRIPTION, ICON, SYSTEM_PROMPT, tagsJson, ownerId, toolJson);
      console.log(`[PMBomSkillSeed] Created builtin skill ${SKILL_NAME} v${SKILL_VERSION}(私人,admin 自行分享)`);
    } catch (e) {
      console.error('[PMBomSkillSeed] INSERT failed:', e.message);
    }
    return;
  }

  const existingPrompt = existing.system_prompt || existing.SYSTEM_PROMPT || '';
  const existingDesc = existing.description || existing.DESCRIPTION || '';
  if (existingPrompt === SYSTEM_PROMPT && existingDesc === DESCRIPTION) return;

  try {
    // 升級不動 is_public(尊重 admin 後續手動調整)
    await db.prepare(`
      UPDATE skills SET description=?, system_prompt=?, tags=?, tool_schema=?, icon=?, type='builtin',
                        is_admin_approved=1, endpoint_mode='tool'
      WHERE id=?
    `).run(DESCRIPTION, SYSTEM_PROMPT, tagsJson, toolJson, ICON, existing.id || existing.ID);
    console.log(`[PMBomSkillSeed] Upgraded ${SKILL_NAME} to v${SKILL_VERSION}`);
  } catch (e) {
    console.error('[PMBomSkillSeed] UPDATE failed:', e.message);
  }

  // 一次性 migration:把仍公開的改回私人(2026-04-27 user 要求)
  try {
    const r = await db.prepare(
      `UPDATE skills SET is_public = 0 WHERE is_public = 1 AND UPPER(name) = UPPER(?)`
    ).run(SKILL_NAME);
    const cnt = r?.rowsAffected ?? r?.changes ?? 0;
    if (cnt > 0) console.log(`[PMBomSkillSeed] Migrated ${SKILL_NAME} is_public 1 → 0(已私,需手動分享)`);
  } catch (e) {
    console.warn('[PMBomSkillSeed] is_public reset migration:', e.message);
  }
}

module.exports = { autoSeedPmBomSkill, SKILL_NAME, SKILL_VERSION };
