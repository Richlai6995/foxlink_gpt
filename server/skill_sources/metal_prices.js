/**
 * metal_prices.js — 全球主要金屬即時報價(passthrough 範例)
 *
 * 這是 docs/tool-artifact-passthrough.md §5.4 的示範實作:
 *   1. system_prompt 不再塞整張 markdown table → token 省 ~95%
 *   2. artifact 欄位走 passthrough 直接渲染給使用者
 *   3. data 留給 LLM 作後續加工(例如台幣換算)
 *
 * 啟用步驟:
 *   1. Admin 在「技能管理」建立或編輯 skill,名稱含「金屬報價」/「metal price」
 *   2. 「進階」分頁勾選「啟用自動 Passthrough」
 *   3. 部署後 syncSkillSources(skill_sources/manifest.json)會把 source 推到 DB
 *
 * 此版本回傳 mock 數據(無外部依賴),正式上線可改打 LME / MetalsAPI / 自家爬蟲。
 */

const { toMarkdownArtifact } = require('../services/skillHelpers');

module.exports = async function handler(_body) {
  const today = new Date().toISOString().slice(0, 10);

  // Mock 數據 — 實際應該打外部 API 或爬蟲
  const prices = {
    copper:    { name: '銅 (Copper)',     usd: 4.52,    unit: 'USD/lb',    chg: '+1.23%' },
    aluminum:  { name: '鋁 (Aluminum)',   usd: 1.06,    unit: 'USD/lb',    chg: '-0.45%' },
    nickel:    { name: '鎳 (Nickel)',     usd: 7.84,    unit: 'USD/lb',    chg: '+0.82%' },
    zinc:      { name: '鋅 (Zinc)',       usd: 1.32,    unit: 'USD/lb',    chg: '-0.18%' },
    gold:      { name: '黃金 (Gold)',     usd: 3128.50, unit: 'USD/oz',    chg: '+0.34%' },
    silver:    { name: '白銀 (Silver)',   usd: 38.62,   unit: 'USD/oz',    chg: '+1.05%' },
    palladium: { name: '鈀金 (Palladium)', usd: 1245.80, unit: 'USD/oz',    chg: '-0.92%' },
    platinum:  { name: '鉑金 (Platinum)', usd: 1008.30, unit: 'USD/oz',    chg: '+0.21%' },
  };

  const tableLines = [
    `# 📊 全球主要金屬即時報價 (USD, ${today})`,
    '',
    '| 金屬 | 最新報價 | 計價單位 | 漲跌幅 |',
    '|------|---------:|----------|-------:|',
  ];
  for (const p of Object.values(prices)) {
    tableLines.push(`| ${p.name} | ${p.usd.toFixed(2)} | ${p.unit} | ${p.chg} |`);
  }
  tableLines.push('');
  tableLines.push(`*資料更新時間:${today}(mock data)*`);
  const table = tableLines.join('\n');

  return {
    // LLM 收到的精簡指引(取代原本整張 table 直接塞 prompt)
    system_prompt:
      `已產出「全球主要金屬即時報價 (${today})」markdown artifact。\n` +
      `Artifact 已直接顯示給使用者,請勿重複表格內容。\n` +
      `若使用者問具體價格或要換算成台幣,請引用 data 欄位的數值。`,
    // 開啟 passthrough 後直接渲染給使用者
    artifact: toMarkdownArtifact(table, `全球主要金屬即時報價 (${today})`),
    // 給 LLM 後續加工的結構化資料
    data: {
      as_of: today,
      currency: 'USD',
      prices,
    },
  };
};
