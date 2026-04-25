/**
 * AI 戰情「金屬行情分析」Seed
 *
 * 冪等建立:
 *   - ai_db_sources: 沿用 cost analysis seed 已建的「FOXLINK GPT 本地 Oracle」(本機 Oracle 系統 DB)
 *   - ai_select_projects / topics: 「金屬行情分析」→ 「每日金屬行情查詢」
 *   - ai_schema_definitions: 1 張 schema (pm_price_history)
 *   - ai_select_designs: 5 張預設報表
 *       A. 今日金屬行情快照 (table)
 *       B. 近 30 天金屬價格趨勢 (line)
 *       C. 銀價估算誤差追蹤 (line + table)  — is_estimated=1 的觀察
 *       D. LME 庫存週變動 (bar)
 *       E. 多源價格交叉驗證 (table) — 同金屬在不同 source 的價差
 *
 * 維護策略同 aiDashboardCostAnalysisSeed.js:
 *   - DB source 已在 cost seed 建好,本檔只 lookup,不建立(避免重複)
 *   - Designs 強制 force-update;要自訂請另存新 design
 *   - 用 system_settings.metal_price_seeded_ids 記 cached id,user 改名後仍認得
 */

'use strict';

const PROJECT_NAME       = '金屬行情分析';
const TOPIC_NAME         = '每日金屬行情查詢';
const LOCAL_DB_SOURCE_NAME = 'FOXLINK GPT 本地 Oracle';   // 跟 cost seed 同一個 source

const DESIGN_A_NAME = 'A. 今日金屬行情快照';
const DESIGN_B_NAME = 'B. 近 30 天金屬價格趨勢';
const DESIGN_C_NAME = 'C. 銀價估算誤差追蹤';
const DESIGN_D_NAME = 'D. LME 庫存週變動';
const DESIGN_E_NAME = 'E. 多源價格交叉驗證';

const SEEDED_IDS_KEY = 'metal_price_seeded_ids';

// ── helpers ─────────────────────────────────────────────────────────────────
async function loadSeededIds(db) {
  try {
    const r = await db.prepare(`SELECT value FROM system_settings WHERE key=?`).get(SEEDED_IDS_KEY);
    if (!r) return {};
    const v = r.value || r.VALUE || '{}';
    return typeof v === 'string' ? JSON.parse(v) : (v || {});
  } catch { return {}; }
}

async function saveSeededIds(db, ids) {
  try {
    const v = JSON.stringify(ids);
    const exists = await db.prepare(`SELECT 1 FROM system_settings WHERE key=?`).get(SEEDED_IDS_KEY);
    if (exists) await db.prepare(`UPDATE system_settings SET value=? WHERE key=?`).run(v, SEEDED_IDS_KEY);
    else        await db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run(SEEDED_IDS_KEY, v);
  } catch (e) { console.warn('[MetalPriceSeed] saveSeededIds:', e.message); }
}

async function rowExists(db, table, id) {
  try {
    const r = await db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id);
    return !!r;
  } catch { return false; }
}

async function getLocalDbSourceId(db) {
  const row = await db.prepare(`SELECT id FROM ai_db_sources WHERE name=?`).get(LOCAL_DB_SOURCE_NAME);
  return row?.id || row?.ID || null;
}

async function ensureProject(db, adminUserId, seededIds) {
  if (seededIds?.project_id && await rowExists(db, 'ai_select_projects', seededIds.project_id)) {
    return seededIds.project_id;
  }
  const existing = await db.prepare(
    `SELECT id FROM ai_select_projects WHERE name=? ORDER BY id ASC FETCH FIRST 1 ROWS ONLY`
  ).get(PROJECT_NAME);
  if (existing?.id || existing?.ID) {
    const id = existing.id || existing.ID;
    if (seededIds) seededIds.project_id = id;
    return id;
  }

  await db.prepare(`
    INSERT INTO ai_select_projects (name, description, is_public, is_suspended, created_by)
    VALUES (?,?,0,0,?)
  `).run(
    PROJECT_NAME,
    '分析 pm_price_history 表的全球主要金屬(銅/鋁/鎳/錫/鋅/鉛/金/銀/鉑/鈀/銠)歷史行情,支援趨勢分析、估算準確度追蹤、LME 庫存變動、多資料源交叉驗證。預設僅 admin 可見,需透過 DesignerPanel 分享給其他角色。',
    adminUserId,
  );
  const row = await db.prepare(`SELECT id FROM ai_select_projects WHERE name=? ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`).get(PROJECT_NAME);
  const id = row?.id || row?.ID;
  if (seededIds) seededIds.project_id = id;
  console.log(`[MetalPriceSeed] 已建立 Project id=${id}`);
  return id;
}

async function ensureTopic(db, projectId, adminUserId, seededIds) {
  if (seededIds?.topic_id && await rowExists(db, 'ai_select_topics', seededIds.topic_id)) {
    return seededIds.topic_id;
  }
  const existing = await db.prepare(
    `SELECT id FROM ai_select_topics WHERE name=? AND project_id=? ORDER BY id ASC FETCH FIRST 1 ROWS ONLY`
  ).get(TOPIC_NAME, projectId);
  if (existing?.id || existing?.ID) {
    const id = existing.id || existing.ID;
    if (seededIds) seededIds.topic_id = id;
    return id;
  }

  await db.prepare(`
    INSERT INTO ai_select_topics (name, description, icon, sort_order, is_active, created_by, project_id)
    VALUES (?,?,?,0,1,?,?)
  `).run(
    TOPIC_NAME,
    '用自然語言查詢全球金屬行情歷史 — 趨勢、漲跌、庫存、估算準確度、多源比較。',
    'trending-up',
    adminUserId,
    projectId,
  );
  const row = await db.prepare(`SELECT id FROM ai_select_topics WHERE name=? AND project_id=? ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`).get(TOPIC_NAME, projectId);
  const id = row?.id || row?.ID;
  if (seededIds) seededIds.topic_id = id;
  console.log(`[MetalPriceSeed] 已建立 Topic id=${id}`);
  return id;
}

// ── Schema 定義 ────────────────────────────────────────────────────────────
const PM_PRICE_HISTORY_SCHEMA = {
  table_name:      'pm_price_history',
  alias:           'mph',
  display_name:    '金屬價格歷史',
  display_name_en: 'Metal Price History',
  display_name_vi: 'Lịch sử giá kim loại',
  business_notes:
    '排程任務「每日貴金屬行情」每天 08:00 透過 pipeline db_write 節點落地的歷史紀錄。' +
    'UNIQUE (metal_code, as_of_date, source) — 同金屬同日同來源只有一列(UPSERT 模式)。' +
    '11 種金屬:銅 CU / 鋁 AL / 鎳 NI / 錫 SN / 鋅 ZN / 鉛 PB(基本金屬,USD/ton)+ ' +
    '金 AU / 銀 AG / 鉑 PT / 鈀 PD / 銠 RH(貴金屬,USD/oz)。' +
    '**重要欄位設計**:同時保留「原始報價(original_price/original_currency/original_unit)」' +
    '與「USD 換算後(price_usd/unit/fx_rate_to_usd)」,可反推任何換算結果。' +
    '`is_estimated=1` 表此筆是經過換算估算(例:銀的 EUR/kg → USD/oz),非原始官方價,精準度較差。' +
    '`conversion_note` 存換算公式字串,事後追溯用。' +
    '`meta_run_id` = scheduled_task_runs.run_at 的 epoch ms,可 JOIN 回去看當次 run。' +
    '資料源:Westmetall(LME 基本金屬 + 倫敦定盤金銀)、TradingEconomics(PGM)、Kitco(PGM 備援)。',
  columns: [
    { column_name: 'id',                data_type: 'NUMBER',    description: '主鍵 ID' },
    { column_name: 'as_of_date',        data_type: 'DATE',      description: '資料日(來源網站標示的報價日期,通常為前一交易日)' },
    { column_name: 'scraped_at',        data_type: 'TIMESTAMP', description: '實際爬取時刻(server 端時間)' },
    { column_name: 'metal_code',        data_type: 'VARCHAR2',  description: '金屬代碼(大寫英文縮寫)',
      value_mapping: '{"CU":"銅","AL":"鋁","NI":"鎳","SN":"錫","ZN":"鋅","PB":"鉛","AU":"金","AG":"銀","PT":"鉑","PD":"鈀","RH":"銠"}' },
    { column_name: 'metal_name',        data_type: 'VARCHAR2',  description: '金屬中文名稱(冗存)' },
    { column_name: 'original_price',    data_type: 'NUMBER',    description: '原始報價數字(來源網頁實際看到,未換算)' },
    { column_name: 'original_currency', data_type: 'VARCHAR2',  description: '原始幣別',
      value_mapping: '{"USD":"美元","EUR":"歐元","TWD":"新台幣","CNY":"人民幣","GBP":"英鎊","JPY":"日圓"}' },
    { column_name: 'original_unit',     data_type: 'VARCHAR2',  description: '原始計價單位(完整字串,如 EUR/kg、USD/ton、USD/oz、USD/t.oz)',
      sample_values: '["USD/ton", "EUR/kg", "USD/oz", "USD/t.oz"]' },
    { column_name: 'price_usd',         data_type: 'NUMBER',    description: '換算後 USD 價格(基本金屬以 USD/ton 為主、貴金屬以 USD/oz 為主)' },
    { column_name: 'unit',              data_type: 'VARCHAR2',  description: '換算後統一單位(USD/ton 或 USD/oz)',
      sample_values: '["USD/ton", "USD/oz"]' },
    { column_name: 'fx_rate_to_usd',    data_type: 'NUMBER',    description: '匯率(1 原幣 = N USD;USD=1.0、EUR≈1.17、TWD≈0.032)' },
    { column_name: 'conversion_note',   data_type: 'VARCHAR2',  description: '換算公式字串(只在 is_estimated=1 才有,例 "2,119.35 EUR/kg × 1.1691 ÷ 32.1507 oz/kg")' },
    { column_name: 'is_estimated',      data_type: 'NUMBER',    description: '是否為換算估算值(1=是,精準度較差;0=原始官方價)',
      value_mapping: '{"0":"原始價","1":"換算估算"}' },
    { column_name: 'price_type',        data_type: 'VARCHAR2',  description: '報價類型',
      value_mapping: '{"spot":"現貨","futures":"期貨","fixing":"定盤(LBMA/LME Fix)","estimate":"估算"}' },
    { column_name: 'market',            data_type: 'VARCHAR2',  description: '交易市場',
      value_mapping: '{"LME":"倫敦金屬交易所","COMEX":"紐約商品交易所","LBMA":"倫敦金銀市場協會","SHFE":"上海期貨交易所"}' },
    { column_name: 'grade',             data_type: 'VARCHAR2',  description: '純度/等級(LME Grade A、COMEX Grade 1 等;多數源未提供,人工後補)',
      sample_values: '["Grade A", "99.95%", "99.99%", null]' },
    { column_name: 'day_change_pct',    data_type: 'NUMBER',    description: '當日漲跌百分比(來源有提供才有,例 -1.87 表跌 1.87%)' },
    { column_name: 'lme_stock',         data_type: 'NUMBER',    description: 'LME 倉庫當日庫存量(公噸,只基本金屬有)' },
    { column_name: 'stock_change',      data_type: 'NUMBER',    description: '庫存日變動量(正=增加、負=減少)' },
    { column_name: 'source',            data_type: 'VARCHAR2',  description: '資料來源網站簡稱',
      value_mapping: '{"Westmetall":"Westmetall(LME 基本金屬 + 倫敦定盤金銀)","TradingEconomics":"Trading Economics(PGM CFD)","Kitco":"Kitco(PGM 備援)"}' },
    { column_name: 'source_url',        data_type: 'VARCHAR2',  description: '實際抓取的完整 URL(可追溯)' },
    { column_name: 'raw_snippet',       data_type: 'CLOB',      description: '原始 HTML/JSON 片段(備援反推用,通常 NULL)' },
    { column_name: 'meta_run_id',       data_type: 'NUMBER',    description: 'pipeline 執行批次 ID(= scheduled_task_runs.run_at epoch ms,可 JOIN 回去看當次 LLM 輸出)' },
    { column_name: 'meta_pipeline',     data_type: 'VARCHAR2',  description: '寫入來源的 pipeline 標識(task_name::node_id)' },
    { column_name: 'creation_date',     data_type: 'TIMESTAMP', description: '本筆首次寫入時間(UPSERT 不會更新)' },
    { column_name: 'last_updated_date', data_type: 'TIMESTAMP', description: '本筆最後更新時間(每次 UPSERT 都更新,可看資料新鮮度)' },
  ],
};

// ── 共用 System Prompt ─────────────────────────────────────────────────────
function buildSystemPrompt() {
  return (
    '你是 FOXLINK GPT 金屬行情分析 SQL 產生器。規則:\n' +
    '1. 只能產出 SELECT 查詢,禁止 INSERT/UPDATE/DELETE/DDL。\n' +
    '2. 表 pm_price_history 是每日歷史快照(UPSERT 模式),`as_of_date` 是來源標示的報價日,通常為前一交易日。如使用者問「今天」金屬價,通常該查 `as_of_date = TRUNC(SYSDATE)` 或 `as_of_date = TRUNC(SYSDATE)-1`。\n' +
    '3. **金屬代碼用大寫**:CU(銅)/AL(鋁)/NI(鎳)/SN(錫)/ZN(鋅)/PB(鉛)/AU(金)/AG(銀)/PT(鉑)/PD(鈀)/RH(銠)。使用者用中文「銅、銀」等,請對應 metal_code。\n' +
    '4. **單位差異**:基本金屬(CU/AL/NI/SN/ZN/PB)用 USD/ton;貴金屬(AU/AG/PT/PD/RH)用 USD/oz。比較不同金屬時,先用 unit 欄位判斷,別把 oz 當 ton 比。\n' +
    '5. **估算 vs 原始**:`is_estimated=1` 是經過幣別/單位換算的估算值(主要是銀的 EUR/kg → USD/oz),精準度比原始官方價(is_estimated=0)差。比較準確度時務必過濾 / 標示。\n' +
    '6. **多源比較**:同 (metal_code, as_of_date) 可能有多筆 source(Westmetall + TradingEconomics 等),做趨勢分析時若不指定 source,結果會有重複 — 加 `WHERE source = \'Westmetall\'` 或 GROUP BY source。\n' +
    '7. **庫存欄位**(lme_stock, stock_change):僅基本金屬有,貴金屬一律 NULL。\n' +
    '8. **日期函式**:Oracle TRUNC(SYSDATE,\'MM\') 月初、ADD_MONTHS(SYSDATE, -N) 往前 N 個月、SYSDATE - N 往前 N 天。比較區間用 BETWEEN 或 >= / <。\n' +
    '9. **趨勢圖**:LINE chart 用 as_of_date 為 X 軸、price_usd 為 Y 軸,GROUP BY metal_code 跑多條線。\n' +
    '10. **數字格式**:價格保留 2-4 位小數,百分比加 % 註記。回前端時用有意義的 alias(price_usd → 美元價、day_change_pct → 日變動)。\n' +
    '11. 回傳 SQL 前加 ORDER BY,讓結果可閱讀。預設常用順序:`ORDER BY as_of_date DESC, metal_code`。\n' +
    '12. 不要查 raw_snippet 欄位(CLOB,內容大且 LLM 用不上),除非使用者明確要追溯原始爬取片段。\n'
  );
}

// ── Schema upsert helpers(從 cost analysis seed 同模式) ────────────────────
async function syncSchemaColumns(db, schemaId, schemaDef) {
  const existing = await db.prepare(
    `SELECT id, column_name FROM ai_schema_columns WHERE schema_id=?`
  ).all(schemaId);
  const existingMap = new Map(
    (existing || []).map(c => [String(c.column_name || c.COLUMN_NAME).toLowerCase(), c.id || c.ID])
  );

  let updated = 0, inserted = 0;
  for (const col of schemaDef.columns) {
    const colKey = col.column_name.toLowerCase();
    if (existingMap.has(colKey)) {
      await db.prepare(
        `UPDATE ai_schema_columns
           SET data_type=?, description=?, value_mapping=?, sample_values=?
         WHERE id=?`
      ).run(
        col.data_type || 'VARCHAR2',
        col.description || '',
        col.value_mapping || null,
        col.sample_values || null,
        existingMap.get(colKey),
      );
      updated++;
    } else {
      await db.prepare(
        `INSERT INTO ai_schema_columns
          (schema_id, column_name, data_type, description, is_visible, is_vectorized, value_mapping, sample_values)
         VALUES (?, ?, ?, ?, 1, 0, ?, ?)`
      ).run(
        schemaId, col.column_name, col.data_type || 'VARCHAR2', col.description || '',
        col.value_mapping || null, col.sample_values || null,
      );
      inserted++;
    }
  }
  return { inserted, updated };
}

async function ensureSchema(db, schemaDef, sourceDbId, projectId, adminUserId) {
  const existing = await db.prepare(
    `SELECT id FROM ai_schema_definitions WHERE table_name=? AND source_db_id=?`
  ).get(schemaDef.table_name, sourceDbId);

  let schemaId;
  if (existing?.id || existing?.ID) {
    schemaId = existing.id || existing.ID;
    await db.prepare(
      `UPDATE ai_schema_definitions
         SET display_name=?, display_name_en=?, display_name_vi=?, alias=?, business_notes=?
       WHERE id=?`
    ).run(
      schemaDef.display_name, schemaDef.display_name_en, schemaDef.display_name_vi,
      schemaDef.alias, schemaDef.business_notes, schemaId,
    );
  } else {
    await db.prepare(`
      INSERT INTO ai_schema_definitions
        (table_name, display_name, display_name_en, display_name_vi, alias,
         db_connection, source_db_id, source_type, business_notes,
         is_active, project_id, created_by)
      VALUES (?,?,?,?,?, 'system', ?, 'table', ?, 1, ?, ?)
    `).run(
      schemaDef.table_name, schemaDef.display_name, schemaDef.display_name_en, schemaDef.display_name_vi,
      schemaDef.alias, sourceDbId, schemaDef.business_notes, projectId, adminUserId,
    );
    const row = await db.prepare(
      `SELECT id FROM ai_schema_definitions WHERE table_name=? AND source_db_id=?`
    ).get(schemaDef.table_name, sourceDbId);
    schemaId = row?.id || row?.ID;
  }

  const { inserted, updated } = await syncSchemaColumns(db, schemaId, schemaDef);
  if (inserted > 0 || updated > 0) {
    const verb = existing?.id || existing?.ID ? '更新' : '建立';
    console.log(`[MetalPriceSeed] Schema ${verb} id=${schemaId} (${schemaDef.table_name}, columns: +${inserted}/~${updated})`);
  }
  return schemaId;
}

// ── 5 張 Design 定義 ────────────────────────────────────────────────────────
const DESIGN_A = {
  name: DESIGN_A_NAME,
  description: '今日(或最新一日)所有金屬最新報價總覽,顯示原始幣別 + USD 換算 + 來源,table 呈現',
  few_shot_examples: [
    {
      q_zh: '今天金屬價格?',
      q_en: 'Today metal prices',
      q_vi: 'Giá kim loại hôm nay',
      sql:
        "SELECT metal_code, metal_name, source, " +
        "       original_price, original_currency, original_unit, " +
        "       price_usd, unit, fx_rate_to_usd, is_estimated, " +
        "       price_type, market, day_change_pct, " +
        "       lme_stock, stock_change, " +
        "       TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of " +
        "FROM pm_price_history " +
        "WHERE as_of_date = (SELECT MAX(as_of_date) FROM pm_price_history) " +
        "ORDER BY metal_code, source",
    },
  ],
  chart_config: {
    default_chart: 'table',
    allow_table: true,
    allow_export: true,
    charts: [],
  },
};

const DESIGN_B = {
  name: DESIGN_B_NAME,
  description: '近 30 天每種金屬的 USD 價格趨勢,LINE 多線圖',
  few_shot_examples: [
    {
      q_zh: '近 30 天銅鋁鎳的價格趨勢',
      q_en: 'Copper / Aluminum / Nickel price trend last 30 days',
      q_vi: 'Xu hướng giá Cu/Al/Ni 30 ngày',
      sql:
        "SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS d, " +
        "       metal_code, metal_name, price_usd " +
        "FROM pm_price_history " +
        "WHERE as_of_date >= SYSDATE - 30 " +
        "  AND metal_code IN ('CU', 'AL', 'NI') " +
        "  AND source = 'Westmetall' " +
        "ORDER BY d, metal_code",
    },
    {
      q_zh: '貴金屬近一個月走勢',
      q_en: 'Precious metals trend last month',
      q_vi: 'Xu hướng kim loại quý tháng vừa qua',
      sql:
        "SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS d, " +
        "       metal_code, metal_name, price_usd " +
        "FROM pm_price_history " +
        "WHERE as_of_date >= SYSDATE - 30 " +
        "  AND metal_code IN ('AU', 'AG', 'PT', 'PD', 'RH') " +
        "  AND (is_estimated = 0 OR metal_code = 'AG') " +
        "ORDER BY d, metal_code",
    },
  ],
  chart_config: {
    default_chart: 'line',
    allow_table: true,
    allow_export: true,
    charts: [
      { type: 'line', title: '金屬價格趨勢', x_field: 'd', y_field: 'price_usd', series_field: 'metal_name' },
    ],
  },
};

const DESIGN_C = {
  name: DESIGN_C_NAME,
  description: '銀價(AG)EUR→USD 換算的歷史誤差追蹤 — is_estimated=1 的精準度檢視',
  few_shot_examples: [
    {
      q_zh: '銀價的估算誤差 — 列出近 30 天每筆 EUR 原始價、用的匯率、推算 USD 結果',
      q_en: 'Silver estimation accuracy — last 30 days EUR original price, fx rate, USD result',
      q_vi: 'Độ chính xác ước tính giá bạc — 30 ngày EUR gốc, tỷ giá, kết quả USD',
      sql:
        "SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS d, " +
        "       original_price || ' ' || original_unit AS origin_price, " +
        "       fx_rate_to_usd, " +
        "       price_usd, " +
        "       conversion_note, " +
        "       source " +
        "FROM pm_price_history " +
        "WHERE metal_code = 'AG' " +
        "  AND is_estimated = 1 " +
        "  AND as_of_date >= SYSDATE - 30 " +
        "ORDER BY d DESC",
    },
  ],
  chart_config: {
    default_chart: 'table',
    allow_table: true,
    allow_export: true,
    charts: [
      { type: 'line', title: '銀價(USD/oz)波動', x_field: 'd', y_field: 'price_usd' },
    ],
  },
};

const DESIGN_D = {
  name: DESIGN_D_NAME,
  description: '近 7 天 LME 基本金屬的庫存變動趨勢,觀察供需走向',
  few_shot_examples: [
    {
      q_zh: '近 7 天各基本金屬 LME 庫存變動',
      q_en: 'Last 7 days LME stock changes for base metals',
      q_vi: 'Biến động kho LME 7 ngày của các kim loại cơ bản',
      sql:
        "SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') AS d, " +
        "       metal_code, metal_name, " +
        "       lme_stock, stock_change, " +
        "       ROUND(stock_change / NULLIF(lme_stock - stock_change, 0) * 100, 2) AS change_pct " +
        "FROM pm_price_history " +
        "WHERE as_of_date >= SYSDATE - 7 " +
        "  AND market = 'LME' " +
        "  AND lme_stock IS NOT NULL " +
        "ORDER BY d DESC, ABS(stock_change) DESC",
    },
  ],
  chart_config: {
    default_chart: 'bar',
    allow_table: true,
    allow_export: true,
    charts: [
      { type: 'bar', title: '單日庫存變動量', x_field: 'metal_name', y_field: 'stock_change' },
    ],
  },
};

const DESIGN_E = {
  name: DESIGN_E_NAME,
  description: '同一金屬同一日從不同 source 抓取的價差檢測 — 偵測資料源是否漂移',
  few_shot_examples: [
    {
      q_zh: '今天 PGM 不同來源的報價差異',
      q_en: 'Today PGM price discrepancies across sources',
      q_vi: 'Chênh lệch giá PGM giữa các nguồn hôm nay',
      sql:
        "SELECT metal_code, metal_name, " +
        "       MAX(CASE WHEN source = 'TradingEconomics' THEN price_usd END) AS te_price, " +
        "       MAX(CASE WHEN source = 'Kitco' THEN price_usd END) AS kitco_price, " +
        "       MAX(CASE WHEN source = 'Westmetall' THEN price_usd END) AS westmetall_price, " +
        "       ROUND(ABS(MAX(CASE WHEN source = 'TradingEconomics' THEN price_usd END) - " +
        "                 MAX(CASE WHEN source = 'Kitco' THEN price_usd END)), 2) AS diff_te_kitco " +
        "FROM pm_price_history " +
        "WHERE as_of_date = (SELECT MAX(as_of_date) FROM pm_price_history) " +
        "  AND metal_code IN ('PT', 'PD', 'RH') " +
        "GROUP BY metal_code, metal_name " +
        "ORDER BY metal_code",
    },
  ],
  chart_config: { default_chart: 'table', allow_table: true, allow_export: true, charts: [] },
};

const ALL_DESIGNS = [DESIGN_A, DESIGN_B, DESIGN_C, DESIGN_D, DESIGN_E];

// ── upsertDesign(同 cost seed 模式) ────────────────────────────────────────
async function upsertDesign(db, topicId, schemaIds, spec, adminUserId, seededIds, cacheKey) {
  let existingId = null;
  if (seededIds && cacheKey && seededIds[cacheKey]) {
    if (await rowExists(db, 'ai_select_designs', seededIds[cacheKey])) {
      existingId = seededIds[cacheKey];
    }
  }
  if (!existingId) {
    const existing = await db.prepare(
      `SELECT id FROM ai_select_designs WHERE topic_id=? AND name=? ORDER BY id ASC FETCH FIRST 1 ROWS ONLY`
    ).get(topicId, spec.name);
    existingId = existing?.id || existing?.ID || null;
  }

  if (existingId) {
    if (seededIds && cacheKey) seededIds[cacheKey] = existingId;
    await db.prepare(
      `UPDATE ai_select_designs
         SET description=?, target_schema_ids=?, system_prompt=?,
             few_shot_examples=?, chart_config=?, share_type='none', is_suspended=0
       WHERE id=?`
    ).run(
      spec.description, JSON.stringify(schemaIds), buildSystemPrompt(),
      JSON.stringify(spec.few_shot_examples), JSON.stringify(spec.chart_config),
      existingId,
    );
    console.log(`[MetalPriceSeed] Design 更新 id=${existingId} (${spec.name})`);
    return existingId;
  }

  await db.prepare(`
    INSERT INTO ai_select_designs
      (topic_id, name, description, target_schema_ids, vector_search_enabled,
       system_prompt, few_shot_examples, chart_config, cache_ttl_minutes,
       is_public, share_type, is_suspended, created_by)
    VALUES (?,?,?,?,0, ?, ?, ?, 15, 0, 'none', 0, ?)
  `).run(
    topicId, spec.name, spec.description, JSON.stringify(schemaIds),
    buildSystemPrompt(),
    JSON.stringify(spec.few_shot_examples),
    JSON.stringify(spec.chart_config),
    adminUserId,
  );
  const row = await db.prepare(`SELECT id FROM ai_select_designs WHERE topic_id=? AND name=?`).get(topicId, spec.name);
  const id = row?.id || row?.ID;
  if (seededIds && cacheKey) seededIds[cacheKey] = id;
  console.log(`[MetalPriceSeed] Design 建立 id=${id} (${spec.name})`);
  return id;
}

// ── 主入口 ──────────────────────────────────────────────────────────────────
async function runSeed(db) {
  try {
    const adminRow = await db.prepare(
      `SELECT id FROM users WHERE UPPER(username) = UPPER(?) AND role='admin'`
    ).get(process.env.DEFAULT_ADMIN_ACCOUNT || 'ADMIN');
    const adminUserId = adminRow?.id || adminRow?.ID || null;
    if (!adminUserId) {
      console.warn('[MetalPriceSeed] 找不到 admin,跳過 seed');
      return;
    }

    // 沿用 cost analysis seed 已建的本地 DB source
    const sourceDbId = await getLocalDbSourceId(db);
    if (!sourceDbId) {
      console.warn('[MetalPriceSeed] 未找到「FOXLINK GPT 本地 Oracle」DB source(請先讓 cost analysis seed 跑過),跳過');
      return;
    }

    const seededIds = await loadSeededIds(db);

    const projectId = await ensureProject(db, adminUserId, seededIds);
    const topicId   = await ensureTopic(db, projectId, adminUserId, seededIds);
    const schemaId  = await ensureSchema(db, PM_PRICE_HISTORY_SCHEMA, sourceDbId, projectId, adminUserId);

    const designCacheKeys = ['design_A', 'design_B', 'design_C', 'design_D', 'design_E'];
    for (let i = 0; i < ALL_DESIGNS.length; i++) {
      await upsertDesign(db, topicId, [schemaId], ALL_DESIGNS[i], adminUserId, seededIds, designCacheKeys[i]);
    }

    await saveSeededIds(db, seededIds);
    console.log('[MetalPriceSeed] 完成 (cached ids:', JSON.stringify(seededIds), ')');
  } catch (e) {
    console.error('[MetalPriceSeed] error:', e.message);
  }
}

module.exports = { runSeed };
