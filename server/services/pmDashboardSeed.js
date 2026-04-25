'use strict';

/**
 * PM AI 戰情 Dashboard 自動 seed
 *
 * Server 啟動時 idempotent 建立:
 *   - Project「[PM] 貴金屬情報」
 *   - 3 個 Topic:採購視角 / 主管視角 / 分析師視角
 *   - 一系列預設 Design(每個 = 一個可用自然語言查詢的圖表組合)
 *
 * 設計原則:
 *   - 完全 idempotent:Project / Topic / Design 都用 name 比對,already exists 就跳過
 *   - 不覆蓋 admin 既有調整 — 一旦 Design exists,不再 touch system_prompt / few_shot
 *   - 假設 PM 表(pm_price_history / pm_macro_history / pm_news / forecast_history /
 *     pm_alert_history / pm_analysis_report)已透過 aiSchemaAutoRegister 建好 schema_definitions
 *   - 找 schemaId 用 table_name + LOCAL source_db_id;若找不到就 skip 該 design(不報錯)
 */

const PROJECT_NAME = '[PM] 貴金屬情報';
const PROJECT_DESC = '貴金屬 / 基本金屬市場行情 / 預測 / 新聞 / 警示的 AI 戰情總覽,給採購、主管、分析師 3 種視角。';

const LOCAL_DB_SOURCE_NAME = 'FOXLINK GPT 本地 Oracle';

const TOPICS = [
  { name: '採購視角',     description: '4 大常用金屬今日報價 / 7 日預測 / 新聞情緒 / 宏觀指標 — 給採購單位日常決策',  icon: 'shopping_cart', sort_order: 1 },
  { name: '主管視角',     description: '11 金屬月變化 / 報告摘要 / 警示 / 模型表現 — 給主管月度檢視',                  icon: 'briefcase',     sort_order: 2 },
  { name: '分析師視角',   description: '原始時序 / 多源比對 / 異常追蹤 — 給分析師深度挖掘',                            icon: 'bar_chart_3',   sort_order: 3 },
];

const SQL_GENERATOR_SYSTEM = `你是一個 SQL 產生器。
只能產生 SELECT 語句,絕不能 INSERT / UPDATE / DELETE / DDL / TRUNCATE。
查詢前必須有適當的 WHERE 條件限制範圍,避免全表掃描。
若無 ORDER BY,自行加上合理排序。
回傳前必須有 FETCH FIRST N ROWS ONLY 限制(預設 200 筆)。
若 user 問題模糊,挑最接近語意的 schema 欄位,寫一句 -- 註解說明你的解讀。`;

// ── Design 規格(name 為 unique key) ────────────────────────────────────────
const DESIGNS = [
  // ─── 採購視角 ─────────────────────────────────────────────────────────────
  {
    topic: '採購視角',
    name: '11 金屬今日報價',
    description: '所有金屬的當日 / 最新一筆報價,table 形式給採購快速掃過',
    target_tables: ['pm_price_history'],
    chart: { default_chart: 'table', allow_table: true, allow_export: true, charts: [] },
    examples: [
      { q_zh: '今日所有金屬的最新報價',
        sql: `SELECT metal_code, metal_name, price_usd, original_price, original_currency, source, as_of_date
              FROM pm_price_history
              WHERE as_of_date = (SELECT MAX(as_of_date) FROM pm_price_history)
              ORDER BY metal_code FETCH FIRST 50 ROWS ONLY` },
      { q_zh: '今天 LME 的銅鋁鎳價',
        sql: `SELECT metal_code, price_usd, market, source, as_of_date
              FROM pm_price_history
              WHERE market='LME' AND metal_code IN ('CU','AL','NI')
                AND as_of_date >= TRUNC(SYSDATE) - 1
              ORDER BY metal_code, as_of_date DESC FETCH FIRST 30 ROWS ONLY` },
    ],
  },
  {
    topic: '採購視角',
    name: '近 30 天 銅鋁鎳鋅 趨勢',
    description: '4 大基本金屬的 30 天價格趨勢,多線疊圖',
    target_tables: ['pm_price_history'],
    chart: {
      default_chart: 'line', allow_table: true, allow_export: true,
      charts: [{ type: 'line', title: '近 30 天 銅 / 鋁 / 鎳 / 鋅 趨勢', x_field: 'as_of_date', y_field: 'price_usd', series_field: 'metal_code' }],
    },
    examples: [
      { q_zh: '近 30 天 銅 / 鋁 / 鎳 / 鋅 價格走勢',
        sql: `SELECT as_of_date, metal_code, AVG(price_usd) AS price_usd
              FROM pm_price_history
              WHERE metal_code IN ('CU','AL','NI','ZN')
                AND as_of_date >= SYSDATE - 30
              GROUP BY as_of_date, metal_code
              ORDER BY as_of_date FETCH FIRST 200 ROWS ONLY` },
    ],
  },
  {
    topic: '採購視角',
    name: '近 30 天 金銀鉑鈀 趨勢',
    description: '4 大貴金屬的 30 天趨勢,多線疊圖',
    target_tables: ['pm_price_history'],
    chart: {
      default_chart: 'line', allow_table: true, allow_export: true,
      charts: [{ type: 'line', title: '近 30 天 金 / 銀 / 鉑 / 鈀 趨勢', x_field: 'as_of_date', y_field: 'price_usd', series_field: 'metal_code' }],
    },
    examples: [
      { q_zh: '近 30 天 金 / 銀 / 鉑 / 鈀 價格走勢',
        sql: `SELECT as_of_date, metal_code, AVG(price_usd) AS price_usd
              FROM pm_price_history
              WHERE metal_code IN ('AU','AG','PT','PD')
                AND as_of_date >= SYSDATE - 30
              GROUP BY as_of_date, metal_code
              ORDER BY as_of_date FETCH FIRST 200 ROWS ONLY` },
    ],
  },
  {
    topic: '採購視角',
    name: '未來 7 天 預測走廊',
    description: '所有金屬的 7 日 mean / lower / upper 預測,給採購規劃進貨節奏',
    target_tables: ['forecast_history'],
    chart: {
      default_chart: 'line', allow_table: true, allow_export: true,
      charts: [{ type: 'line', title: '未來 7 天預測 (mean + 80% 區間)', x_field: 'target_date', y_field: 'predicted_mean', series_field: 'entity_code' }],
    },
    examples: [
      { q_zh: '所有金屬未來 7 天預測',
        sql: `SELECT entity_code, target_date, predicted_mean, predicted_lower, predicted_upper, confidence
              FROM forecast_history
              WHERE entity_type='metal'
                AND forecast_date = (SELECT MAX(forecast_date) FROM forecast_history WHERE entity_type='metal')
                AND target_date >= TRUNC(SYSDATE)
              ORDER BY entity_code, target_date FETCH FIRST 200 ROWS ONLY` },
      { q_zh: '銅未來 7 天預測',
        sql: `SELECT target_date, predicted_mean, predicted_lower, predicted_upper, confidence, rationale
              FROM forecast_history
              WHERE entity_type='metal' AND entity_code='CU'
                AND forecast_date = (SELECT MAX(forecast_date) FROM forecast_history WHERE entity_type='metal' AND entity_code='CU')
              ORDER BY target_date FETCH FIRST 30 ROWS ONLY` },
    ],
  },
  {
    topic: '採購視角',
    name: '過去 24h 新聞情緒分布',
    description: '每金屬最近 24 小時的新聞數量 + 平均情緒分數,bar / pie',
    target_tables: ['pm_news'],
    chart: {
      default_chart: 'bar', allow_table: true, allow_export: true,
      charts: [{ type: 'bar', title: '24h 新聞量 + 情緒', x_field: 'related_metals', y_field: 'news_count' }],
    },
    examples: [
      { q_zh: '過去 24 小時每金屬的新聞量與平均情緒',
        sql: `SELECT related_metals, COUNT(*) AS news_count, AVG(sentiment_score) AS avg_sentiment
              FROM pm_news
              WHERE published_at >= SYSDATE - 1
              GROUP BY related_metals
              ORDER BY news_count DESC FETCH FIRST 30 ROWS ONLY` },
      { q_zh: '今天最負面的 5 篇金屬新聞',
        sql: `SELECT title, source, summary, sentiment_score, related_metals, published_at
              FROM pm_news
              WHERE published_at >= TRUNC(SYSDATE)
              ORDER BY sentiment_score ASC FETCH FIRST 5 ROWS ONLY` },
    ],
  },
  {
    topic: '採購視角',
    name: '7 日宏觀指標趨勢',
    description: 'DXY / VIX / UST10Y / 原油 等宏觀指標的 7 日走勢,影響金屬定價的關鍵變數',
    target_tables: ['pm_macro_history'],
    chart: {
      default_chart: 'line', allow_table: true, allow_export: true,
      charts: [{ type: 'line', title: '7 日宏觀指標', x_field: 'as_of_date', y_field: 'value', series_field: 'indicator_code' }],
    },
    examples: [
      { q_zh: '近 7 天 DXY / UST10Y / VIX / 原油 趨勢',
        sql: `SELECT as_of_date, indicator_code, value
              FROM pm_macro_history
              WHERE indicator_code IN ('DXY','UST10Y','VIX','WTI')
                AND as_of_date >= SYSDATE - 7
              ORDER BY as_of_date, indicator_code FETCH FIRST 200 ROWS ONLY` },
    ],
  },

  // ─── 主管視角 ─────────────────────────────────────────────────────────────
  {
    topic: '主管視角',
    name: '11 金屬月變化 KPI',
    description: '本月最新價 vs 上月同期變化 % + 絕對值,KPI table 給主管掃過',
    target_tables: ['pm_price_history'],
    chart: {
      default_chart: 'table', allow_table: true, allow_export: true,
      charts: [{ type: 'bar', title: '本月 vs 上月變化', x_field: 'metal_code', y_field: 'pct_change' }],
    },
    examples: [
      { q_zh: '本月最新價 vs 上月同期變化',
        sql: `WITH cur AS (
                SELECT metal_code, AVG(price_usd) AS cur_price
                FROM pm_price_history
                WHERE as_of_date >= TRUNC(SYSDATE, 'MM')
                GROUP BY metal_code
              ), prev AS (
                SELECT metal_code, AVG(price_usd) AS prev_price
                FROM pm_price_history
                WHERE as_of_date >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -1)
                  AND as_of_date <  TRUNC(SYSDATE, 'MM')
                GROUP BY metal_code
              )
              SELECT c.metal_code,
                     ROUND(c.cur_price, 2)  AS cur_price,
                     ROUND(p.prev_price, 2) AS prev_price,
                     ROUND((c.cur_price - p.prev_price) / p.prev_price * 100, 2) AS pct_change
              FROM cur c LEFT JOIN prev p USING (metal_code)
              ORDER BY pct_change DESC FETCH FIRST 30 ROWS ONLY` },
    ],
  },
  {
    topic: '主管視角',
    name: '最新報告摘要',
    description: '最近 1 份日報 / 週報 / 月報的 summary + sentiment',
    target_tables: ['pm_analysis_report'],
    chart: { default_chart: 'table', allow_table: true, allow_export: true, charts: [] },
    examples: [
      { q_zh: '最新的日報週報月報',
        sql: `SELECT report_type, as_of_date, title, summary, sentiment_overall
              FROM pm_analysis_report
              WHERE (report_type, as_of_date) IN (
                SELECT report_type, MAX(as_of_date) FROM pm_analysis_report GROUP BY report_type
              )
              ORDER BY as_of_date DESC FETCH FIRST 10 ROWS ONLY` },
    ],
  },
  {
    topic: '主管視角',
    name: '近 30 天警示記錄',
    description: '最近 30 天觸發的 alert,給主管追溯異常事件',
    target_tables: ['pm_alert_history'],
    chart: { default_chart: 'table', allow_table: true, allow_export: true, charts: [] },
    examples: [
      { q_zh: '最近 30 天的警示',
        sql: `SELECT triggered_at, severity, entity_type, entity_code, trigger_value, threshold_value, message
              FROM pm_alert_history
              WHERE triggered_at >= SYSDATE - 30
              ORDER BY triggered_at DESC FETCH FIRST 100 ROWS ONLY` },
    ],
  },
  {
    topic: '主管視角',
    name: '模型預測 vs 實際',
    description: '過去 30 天 LLM 預測值與實際成交價對比,評估模型表現',
    target_tables: ['forecast_history', 'pm_price_history'],
    chart: {
      default_chart: 'line', allow_table: true, allow_export: true,
      charts: [{ type: 'line', title: '預測 vs 實際 (mean / actual)', x_field: 'target_date', y_field: 'value', series_field: 'series' }],
    },
    examples: [
      { q_zh: '過去 30 天銅的預測 vs 實際',
        sql: `SELECT target_date, 'predicted' AS series, predicted_mean AS value
              FROM forecast_history
              WHERE entity_type='metal' AND entity_code='CU'
                AND target_date >= SYSDATE - 30
              UNION ALL
              SELECT as_of_date AS target_date, 'actual' AS series, AVG(price_usd) AS value
              FROM pm_price_history
              WHERE metal_code='CU' AND as_of_date >= SYSDATE - 30
              GROUP BY as_of_date
              ORDER BY 1 FETCH FIRST 200 ROWS ONLY` },
    ],
  },

  // ─── 分析師視角 ───────────────────────────────────────────────────────────
  {
    topic: '分析師視角',
    name: '同金屬多源價差',
    description: '同個金屬不同 source(LME / Westmetall / Kitco)的報價差異,找套利機會 / 校驗異常',
    target_tables: ['pm_price_history'],
    chart: {
      default_chart: 'line', allow_table: true, allow_export: true,
      charts: [{ type: 'line', title: '多源價差', x_field: 'as_of_date', y_field: 'price_usd', series_field: 'source' }],
    },
    examples: [
      { q_zh: '近 14 天銅在不同來源的報價差異',
        sql: `SELECT as_of_date, source, price_usd
              FROM pm_price_history
              WHERE metal_code='CU' AND as_of_date >= SYSDATE - 14
              ORDER BY as_of_date, source FETCH FIRST 200 ROWS ONLY` },
    ],
  },
  {
    topic: '分析師視角',
    name: '估算誤差追蹤',
    description: '哪些報價是估算的(is_estimated=1),用了什麼換算公式',
    target_tables: ['pm_price_history'],
    chart: { default_chart: 'table', allow_table: true, allow_export: true, charts: [] },
    examples: [
      { q_zh: '近 7 天用估算的價格',
        sql: `SELECT as_of_date, metal_code, source, original_price, original_currency,
                     fx_rate_to_usd, conversion_note, price_usd
              FROM pm_price_history
              WHERE is_estimated = 1 AND as_of_date >= SYSDATE - 7
              ORDER BY as_of_date DESC FETCH FIRST 100 ROWS ONLY` },
    ],
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────
async function getLocalDbSourceId(db) {
  const row = await db.prepare(`SELECT id FROM ai_db_sources WHERE name=?`).get(LOCAL_DB_SOURCE_NAME);
  return row?.id || row?.ID || null;
}

async function ensureProject(db, ownerId) {
  const existing = await db.prepare(
    `SELECT id FROM ai_select_projects WHERE name=? ORDER BY id ASC FETCH FIRST 1 ROWS ONLY`
  ).get(PROJECT_NAME);
  if (existing) return existing.id || existing.ID;
  await db.prepare(`
    INSERT INTO ai_select_projects (name, description, is_public, is_suspended, created_by)
    VALUES (?, ?, 0, 0, ?)
  `).run(PROJECT_NAME, PROJECT_DESC, ownerId);
  const row = await db.prepare(`SELECT id FROM ai_select_projects WHERE name=? ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`).get(PROJECT_NAME);
  return row?.id || row?.ID;
}

async function ensureTopic(db, projectId, ownerId, topic) {
  const existing = await db.prepare(
    `SELECT id FROM ai_select_topics WHERE name=? AND project_id=? ORDER BY id ASC FETCH FIRST 1 ROWS ONLY`
  ).get(topic.name, projectId);
  if (existing) return existing.id || existing.ID;
  await db.prepare(`
    INSERT INTO ai_select_topics (name, description, icon, sort_order, is_active, created_by, project_id)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `).run(topic.name, topic.description, topic.icon, topic.sort_order, ownerId, projectId);
  const row = await db.prepare(`SELECT id FROM ai_select_topics WHERE name=? AND project_id=? ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`).get(topic.name, projectId);
  return row?.id || row?.ID;
}

async function getSchemaIds(db, sourceDbId, tableNames) {
  const ids = [];
  for (const t of tableNames || []) {
    try {
      const row = await db.prepare(
        `SELECT id FROM ai_schema_definitions WHERE LOWER(table_name)=LOWER(?) AND source_db_id=?`
      ).get(t, sourceDbId);
      if (row) ids.push(row.id || row.ID);
    } catch (_) {}
  }
  return ids;
}

async function ensureDesign(db, topicId, schemaIds, design, ownerId) {
  const existing = await db.prepare(
    `SELECT id FROM ai_select_designs WHERE topic_id=? AND name=? ORDER BY id ASC FETCH FIRST 1 ROWS ONLY`
  ).get(topicId, design.name);
  if (existing) return false;  // 已存在,不覆蓋

  await db.prepare(`
    INSERT INTO ai_select_designs
      (topic_id, name, description, target_schema_ids, vector_search_enabled,
       system_prompt, few_shot_examples, chart_config, cache_ttl_minutes,
       is_public, share_type, is_suspended, created_by)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?, 15, 0, 'none', 0, ?)
  `).run(
    topicId, design.name, design.description, JSON.stringify(schemaIds),
    SQL_GENERATOR_SYSTEM,
    JSON.stringify(design.examples),
    JSON.stringify(design.chart),
    ownerId,
  );
  return true;
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function autoSeedPmDashboard(db) {
  if (!db) return;

  let ownerId = null;
  try {
    const adminRow = await db.prepare(
      `SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id FETCH FIRST 1 ROWS ONLY`
    ).get();
    ownerId = adminRow?.id || null;
  } catch (_) {}
  if (!ownerId) {
    console.warn('[PMDashboardSeed] no admin user, skip');
    return;
  }

  const sourceDbId = await getLocalDbSourceId(db);
  if (!sourceDbId) {
    console.warn(`[PMDashboardSeed] '${LOCAL_DB_SOURCE_NAME}' ai_db_sources 不存在,skip`);
    console.warn(`[PMDashboardSeed] 提醒:先讓 admin 透過「Pipeline 可寫表」核准任一張 PM 表,系統會自動建 ai_db_sources`);
    return;
  }

  let projectId;
  try {
    projectId = await ensureProject(db, ownerId);
  } catch (e) {
    console.error('[PMDashboardSeed] ensureProject failed:', e.message);
    return;
  }

  // Build name→id map for topics
  const topicIdMap = {};
  for (const t of TOPICS) {
    try {
      topicIdMap[t.name] = await ensureTopic(db, projectId, ownerId, t);
    } catch (e) {
      console.error(`[PMDashboardSeed] ensureTopic ${t.name} failed:`, e.message);
    }
  }

  let inserted = 0;
  let skipped = 0;
  let missingSchema = 0;
  for (const d of DESIGNS) {
    const topicId = topicIdMap[d.topic];
    if (!topicId) { skipped++; continue; }
    const schemaIds = await getSchemaIds(db, sourceDbId, d.target_tables);
    if (!schemaIds.length) {
      missingSchema++;
      console.warn(`[PMDashboardSeed] design "${d.name}" — 找不到任一 schema(${d.target_tables.join(',')}),skip`);
      continue;
    }
    try {
      const created = await ensureDesign(db, topicId, schemaIds, d, ownerId);
      if (created) inserted++; else skipped++;
    } catch (e) {
      console.error(`[PMDashboardSeed] ensureDesign ${d.name} failed:`, e.message);
    }
  }

  if (inserted > 0 || missingSchema > 0) {
    console.log(`[PMDashboardSeed] project=${PROJECT_NAME} (id=${projectId}) — ${inserted} designs inserted, ${skipped} already existed, ${missingSchema} skipped (schema missing)`);
  } else {
    console.log(`[PMDashboardSeed] All ${skipped} designs already exist`);
  }
}

module.exports = {
  autoSeedPmDashboard,
  PROJECT_NAME,
  TOPICS,
  DESIGNS,
};
