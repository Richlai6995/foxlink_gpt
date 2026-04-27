'use strict';

/**
 * PM(貴金屬)排程任務自動 seed
 *
 * Server 啟動時 idempotent 註冊一系列 PM 平台的預設排程(news / macro / daily report / weekly / monthly)。
 *
 * 設計原則:
 *   - 只「INSERT if not exists」by name — 不覆蓋 admin 既有調整(prompt / schedule / pipeline_json 一旦動過就不再 touch)
 *   - status='paused' 預設 — admin 必須先檢查 prompt / 補 kb_id / 加收件人才 enable
 *   - owner = 預設 admin user(env DEFAULT_ADMIN_ACCOUNT)
 *   - 每個 task 含 _seed_version,跟程式裡的 SEED_VERSION 比對,差距太大 admin 可手動觸發 reseed(目前不自動)
 *
 * 包含的任務(Phase 2 D10-D14 + Phase 3.1 全網收集):
 *   - [PM] 每日金屬新聞抓取(D10)— multi_time 9:00 / 14:30        → KB: PM-新聞庫
 *   - [PM] 總體經濟指標日抓(D11)— daily 09:00
 *   - [PM] 每日金屬日報(D12)— daily 18:00                        → KB: PM-分析庫
 *   - [PM] 週報(D14)— weekly Mon 08:30                            → KB: PM-分析庫
 *   - [PM] 月報(D14)— monthly day 1 09:00                         → KB: PM-分析庫
 *   - [PM] 全網金屬資料收集(P3.1)— daily 06:00 + interval 8 小時 → KB: PM-原始資料庫
 *
 * 註:
 *   - 依賴 pmKnowledgeBaseSeed 先跑(autoSeedPmKnowledgeBases 回傳 kbMap),
 *     kb_write 節點的 kb_id 直接從 kbMap 帶入,admin 不用再手動選
 *   - 若 kbMap 缺對應 KB(seed 失敗 / 被刪),kb_id 留空,admin 還是可以手動補
 *   - 對於既有任務(已 INSERT 過的)會在最後跑一次 patchExistingTaskKbIds:
 *     掃 pipeline_json 的 kb_write 節點,若 kb_id 空但 kb_name 有值且能對到 kbMap,自動填回去
 *   - 部分 prompt 引用了 {{scrape:URL}} 以 LLM tool 自動抓網頁,前提是來源 URL 在公司防火牆白名單
 */

const SEED_VERSION = '1.0.0';

function newNodeId(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 8)}`; }

// ── [PM] 每日金屬新聞抓取(D10)──────────────────────────────────────────────
function buildNewsTask(kbMap, models = {}) {
  const flashModel = models.flash || 'flash';
  const dbWriteId = newNodeId('dbw');
  const kbWriteId = newNodeId('kbw');

  const prompt = `今天是 {{date}}。請抓取以下來源,過濾出與「銅(CU)/ 鋁(AL)/ 鎳(NI)/ 錫(SN)/ 鋅(ZN)/ 鉛(PB)/ 金(AU)/ 銀(AG)/ 鉑(PT)/ 鈀(PD)/ 銠(RH)」相關的近 24 小時新聞。

═══ 資料源(可調整,公司防火牆需放行)═══
{{scrape:https://www.kitco.com/news/}}
{{scrape:https://www.mining.com/}}
{{scrape:https://www.westmetall.com/en/news.php}}

═══ 任務 ═══
每篇相關新聞做以下處理:
1. 抽出 title / url / source / published_at / 全文
2. 寫 80-150 字繁體中文摘要(summary)
3. 情緒打分 sentiment_score(-1.0 ~ +1.0,LLM 判斷對該金屬「未來 1-7 天」價格的影響面)
4. 對應 sentiment_label("very_negative" / "negative" / "neutral" / "positive" / "very_positive")
5. 標註 related_metals(代碼陣列,例 ["CU","AL"])
6. 列出 topics(主題標籤,例 ["supply","policy","fed","inventory"])

**輸出兩段內容**:
A. 一段繁體中文簡報摘要(給人看的,放最前面)
B. 在 markdown 末尾另外一段 \`\`\`json [...] \`\`\` 陣列(給 db_write / kb_write 節點落地用),格式如下:

\`\`\`json
[
  {
    "url": "https://...",
    "title": "...",
    "source": "Kitco",
    "published_at": "2026-04-25T08:00:00Z",
    "language": "en",
    "content": "完整內文(英文或原文均可,kb_write 會自動切片 + embedding)",
    "summary": "繁體中文摘要 80-150 字",
    "sentiment_score": -0.6,
    "sentiment_label": "negative",
    "related_metals": ["CU","AL"],
    "topics": ["supply","policy"]
  }
]
\`\`\`

若無任何相關新聞,JSON 陣列輸出 \`[]\`,簡報摘要寫「今日無金屬相關重要新聞」。`;

  const pipeline = [
    {
      id: dbWriteId,
      type: 'db_write',
      label: '寫入 pm_news 表',
      table: 'pm_news',
      operation: 'insert',
      key_columns: [],
      input: '{{ai_output}}',
      on_row_error: 'skip',
      max_rows: 200,
      column_mapping: [
        { jsonpath: '$.url',             column: 'url',             transform: '',                required: true },
        { jsonpath: '$.url',             column: 'url_hash',        transform: 'sha256',          required: true },
        { jsonpath: '$.title',           column: 'title',           transform: '' },
        { jsonpath: '$.source',          column: 'source',          transform: '' },
        { jsonpath: '$.published_at',    column: 'published_at',    transform: 'date' },
        { jsonpath: '$.language',        column: 'language',        transform: '' },
        { jsonpath: '$.summary',         column: 'summary',         transform: '' },
        { jsonpath: '$.sentiment_score', column: 'sentiment_score', transform: 'number' },
        { jsonpath: '$.sentiment_label', column: 'sentiment_label', transform: '' },
        { jsonpath: '$.related_metals',  column: 'related_metals',  transform: 'array_join_comma' },
        { jsonpath: '$.topics',          column: 'topics',          transform: 'array_join_comma' },
      ],
    },
    {
      id: kbWriteId,
      type: 'kb_write',
      label: '寫入 PM-新聞庫',
      kb_id: (kbMap && kbMap.get('PM-新聞庫')) || '',
      kb_name: 'PM-新聞庫',
      title_field: '$.title',
      url_field: '$.url',
      summary_field: '$.summary',
      content_field: '$.content',
      source_field: '$.source',
      published_at_field: '$.published_at',
      chunk_strategy: 'mixed',
      dedupe_mode: 'url',
      max_chunks_per_run: 100,
      on_row_error: 'skip',
      input: '{{ai_output}}',
    },
  ];

  return {
    name: '[PM] 每日金屬新聞抓取',
    schedule_type: 'multi_time',
    schedule_hour: 9,
    schedule_minute: 0,
    schedule_times_json: JSON.stringify(['09:00', '14:30']),
    schedule_interval_hours: null,
    model: flashModel,
    prompt,
    output_type: 'text',
    file_type: null,
    filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 金屬新聞日報 — {{date}}',
    email_body: '今日金屬新聞重點如下,完整資料已落地到 pm_news + KB(若已配置)。',
    status: 'paused',
    pipeline_json: JSON.stringify(pipeline),
  };
}

// ── [PM] 總體經濟指標日抓(D11 — 設計留 placeholder,實作在 D11)──────────
function buildMacroTask(models = {}) {
  const flashModel = models.flash || 'flash';
  const dbWriteId = newNodeId('dbw');
  const prompt = `今天是 {{date}}。請取得以下總體經濟指標的「最新可得值」:

═══ 指標清單 ═══
- DXY(美元指數)
- VIX(恐慌指數)
- FED_FUNDS(聯邦基金利率,%)
- UST10Y(美國 10 年期公債殖利率,%)
- WTI(WTI 原油,USD/barrel)
- EURUSD(歐元兌美元)
- TWDUSD(美元兌台幣)

═══ 資料源(可選用)═══
{{scrape:https://tradingeconomics.com/united-states/currency}}
{{scrape:https://tradingeconomics.com/united-states/government-bond-yield}}
{{scrape:https://www.investing.com/economic-calendar/}}

═══ 輸出 ═══
A. 一段繁體中文簡報(列出每個指標的當前值 + 與前日 / 上週的變化)
B. markdown 末尾另外輸出 \`\`\`json [...] \`\`\` 給 db_write 落地:

\`\`\`json
[
  {
    "indicator_code": "DXY",
    "indicator_name": "美元指數",
    "as_of_date": "{{date}}",
    "value": 104.23,
    "unit": "index",
    "source": "TradingEconomics",
    "source_url": "https://tradingeconomics.com/...",
    "is_estimated": 0
  }
]
\`\`\`

若任何指標抓不到,該欄 value=null + is_estimated=1 + source_url 寫 "unavailable"。`;

  const pipeline = [
    {
      id: dbWriteId,
      type: 'db_write',
      label: '寫入 pm_macro_history',
      table: 'pm_macro_history',
      operation: 'upsert',
      key_columns: ['indicator_code', 'as_of_date', 'source'],
      input: '{{ai_output}}',
      on_row_error: 'skip',
      max_rows: 50,
      column_mapping: [
        { jsonpath: '$.indicator_code', column: 'indicator_code', transform: 'upper', required: true },
        { jsonpath: '$.indicator_name', column: 'indicator_name', transform: '' },
        { jsonpath: '$.as_of_date',     column: 'as_of_date',     transform: 'date',  required: true },
        { jsonpath: '$.value',          column: 'value',          transform: 'number' },
        { jsonpath: '$.unit',           column: 'unit',           transform: '' },
        { jsonpath: '$.source',         column: 'source',         transform: '',      required: true },
        { jsonpath: '$.source_url',     column: 'source_url',     transform: '' },
        { jsonpath: '$.is_estimated',   column: 'is_estimated',   transform: 'number' },
      ],
    },
  ];

  return {
    name: '[PM] 總體經濟指標日抓',
    schedule_type: 'daily',
    schedule_hour: 9,
    schedule_minute: 0,
    schedule_times_json: null,
    schedule_interval_hours: null,
    model: flashModel,
    prompt,
    output_type: 'text',
    file_type: null,
    filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 總體經濟指標日報 — {{date}}',
    email_body: '今日 7 大總體經濟指標已落地。',
    status: 'paused',
    pipeline_json: JSON.stringify(pipeline),
  };
}

// ── [PM] 每日金屬日報(D12)─────────────────────────────────────────────────
// Pipeline:ai 主回應 → db_write(forecast_history)→ db_write(pm_analysis_report)
//          → generate_file DOCX → kb_write(PM-分析庫)
function buildDailyReportTask(kbMap, models = {}) {
  const proModel = models.pro || 'pro';
  const dbForecastId  = newNodeId('dbw');
  const dbReportId    = newNodeId('dbw');
  const generateId    = newNodeId('gen');
  const kbWriteId     = newNodeId('kbw');

  const prompt = `今天是 {{date}}({{weekday}}),撰寫一份「金屬市場日報」。

═══ 上下文(admin 啟用前請把以下 placeholder 改成實際存在的 KB 名)═══
{{kb:PM-新聞庫}}    ← 近 24 小時新聞 RAG
{{kb:PM-分析庫}}    ← 過去日報沿革 RAG(若有)

═══ 撰寫要求 ═══
1. 開場 200 字市場概覽(整體情緒 + 主旋律事件)
2. 11 種金屬(CU 銅 / AL 鋁 / NI 鎳 / SN 錫 / ZN 鋅 / PB 鉛 / AU 金 / AG 銀 / PT 鉑 / PD 鈀 / RH 銠)逐一講當日表現 + 主要驅動
3. 連結最近新聞與宏觀指標(DXY / VIX / UST10Y / 原油)的影響
4. 對未來 7 天的展望(每金屬 1-2 句)
5. 給採購單位的具體建議

═══ 輸出格式(雙段)═══
A. **報告全文**(繁體中文 markdown,給人看 + 給 generate_file 寫 DOCX 用)

B. **JSON 落地段**(供 db_write 解析,放在 markdown 末尾的 \`\`\`json 區塊)

\`\`\`json
{
  "report_type": "daily",
  "as_of_date": "{{date}}",
  "title": "金屬市場日報 — {{date}}",
  "summary": "200-300 字摘要,給人快速掃過用",
  "full_content": "完整報告全文(把上方 A 段複製進來)",
  "key_findings": "用換行分隔的 3-7 條重點",
  "sentiment_overall": "negative" | "neutral" | "positive",
  "model_used": "{{model_used}}",

  "forecasts": [
    {
      "entity_type": "metal",
      "entity_code": "CU",
      "forecast_date": "{{date}}",
      "target_date": "<日期 YYYY-MM-DD,N=7 後的日期>",
      "horizon_days": 7,
      "predicted_mean": <number>,
      "predicted_lower": <number>,
      "predicted_upper": <number>,
      "confidence": "low" | "medium" | "high",
      "rationale": "...",
      "key_drivers": "LME 庫存,DXY,中國需求"
    }
    // 11 個金屬各一筆,共 11 筆
  ]
}
\`\`\`

注意:**只輸出一個 \`\`\`json\`\`\` 區塊**,不要分多個。forecasts 內 11 筆都要,缺資料時 predicted_* 給 null + confidence='low'。`;

  const pipeline = [
    {
      id: dbForecastId,
      type: 'db_write',
      label: '寫入 forecast_history(11 個金屬預測)',
      table: 'forecast_history',
      operation: 'upsert',
      key_columns: ['entity_type', 'entity_code', 'forecast_date', 'target_date', 'model_used'],
      input: '{{ai_output}}',
      array_path: '$.forecasts',  // drill 進 ai_output.forecasts 子陣列當 rows
      on_row_error: 'skip',
      max_rows: 50,
      column_mapping: [
        { jsonpath: '$.entity_type',     column: 'entity_type',     transform: 'lower', required: true },
        { jsonpath: '$.entity_code',     column: 'entity_code',     transform: 'upper', required: true },
        { jsonpath: '$.forecast_date',   column: 'forecast_date',   transform: 'date',  required: true },
        { jsonpath: '$.target_date',     column: 'target_date',     transform: 'date',  required: true },
        { jsonpath: '$.horizon_days',    column: 'horizon_days',    transform: 'number' },
        { jsonpath: '$.predicted_mean',  column: 'predicted_mean',  transform: 'number' },
        { jsonpath: '$.predicted_lower', column: 'predicted_lower', transform: 'number' },
        { jsonpath: '$.predicted_upper', column: 'predicted_upper', transform: 'number' },
        { jsonpath: '$.confidence',      column: 'confidence',      transform: '' },
        { jsonpath: '$.rationale',       column: 'rationale',       transform: '' },
        { jsonpath: '$.key_drivers',     column: 'key_drivers',     transform: '' },
        { jsonpath: '$.model_used',      column: 'model_used',      transform: '' },
      ],
    },
    {
      id: dbReportId,
      type: 'db_write',
      label: '寫入 pm_analysis_report(報告 metadata)',
      table: 'pm_analysis_report',
      operation: 'upsert',
      key_columns: ['report_type', 'as_of_date'],
      input: '{{ai_output}}',
      on_row_error: 'stop',
      max_rows: 1,
      column_mapping: [
        { jsonpath: '$.report_type',       column: 'report_type',       transform: '',     required: true },
        { jsonpath: '$.as_of_date',        column: 'as_of_date',        transform: 'date', required: true },
        { jsonpath: '$.title',             column: 'title',             transform: '' },
        { jsonpath: '$.summary',           column: 'summary',           transform: '' },
        { jsonpath: '$.full_content',      column: 'full_content',      transform: '' },
        { jsonpath: '$.key_findings',      column: 'key_findings',      transform: '' },
        { jsonpath: '$.sentiment_overall', column: 'sentiment_overall', transform: '' },
        { jsonpath: '$.model_used',        column: 'model_used',        transform: '' },
      ],
    },
    {
      id: generateId,
      type: 'generate_file',
      label: '產出 DOCX 日報',
      output_file: 'docx',
      filename: '金屬市場日報_{{date}}.docx',
      input: '{{ai_output}}',
    },
    {
      id: kbWriteId,
      type: 'kb_write',
      label: '寫入 PM-分析庫(日報)',
      kb_id: (kbMap && kbMap.get('PM-分析庫')) || '',
      kb_name: 'PM-分析庫',
      title_field: '$.title',
      url_field: '',  // 報告無 URL
      summary_field: '$.summary',
      content_field: '$.full_content',
      source_field: '',
      published_at_field: '$.as_of_date',
      chunk_strategy: 'mixed',
      dedupe_mode: 'title',  // 同標題視為同一份報告
      max_chunks_per_run: 50,
      on_row_error: 'skip',
      input: '{{ai_output}}',
    },
  ];

  return {
    name: '[PM] 每日金屬日報',
    schedule_type: 'daily',
    schedule_hour: 18,
    schedule_minute: 0,
    schedule_times_json: null,
    schedule_interval_hours: null,
    model: proModel,
    prompt,
    output_type: 'text',
    file_type: null,
    filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 金屬市場日報 — {{date}}',
    email_body: '今日金屬市場日報請參閱附件(若已啟用 generate_file 節點)。',
    status: 'paused',
    pipeline_json: JSON.stringify(pipeline),
  };
}

// ── [PM] 週報(D14)─────────────────────────────────────────────────────────
function buildWeeklyReportTask(kbMap, models = {}) {
  const proModel = models.pro || 'pro';
  const dbReportId = newNodeId('dbw');
  const generateId = newNodeId('gen');
  const kbWriteId  = newNodeId('kbw');

  const prompt = `今天是 {{date}}({{weekday}}),撰寫「金屬市場週報」(回顧過去 7 天)。

═══ 上下文 ═══
{{kb:PM-新聞庫}}     ← 過去 7 天新聞 RAG
{{kb:PM-分析庫}}     ← 過去 7 天日報 RAG

═══ 撰寫要求 ═══
1. 本週市場主軸(300 字內)
2. 11 金屬週漲跌幅統計 + 領漲 / 領跌排序
3. 本週重大事件回顧(政策 / 庫存 / 地緣)
4. 下週展望 + 關鍵觀察點
5. 採購策略建議(進貨節奏、避險建議)

═══ JSON 落地段(放 markdown 末尾)═══
\`\`\`json
{
  "report_type": "weekly",
  "as_of_date": "{{date}}",
  "title": "金屬市場週報 — {{date}}",
  "summary": "300 字內週報摘要",
  "full_content": "完整週報全文",
  "key_findings": "本週 3-5 條核心發現,換行分隔",
  "sentiment_overall": "negative" | "neutral" | "positive",
  "model_used": "{{model_used}}"
}
\`\`\``;

  const pipeline = [
    {
      id: dbReportId,
      type: 'db_write',
      label: '寫入 pm_analysis_report(週報)',
      table: 'pm_analysis_report',
      operation: 'upsert',
      key_columns: ['report_type', 'as_of_date'],
      input: '{{ai_output}}',
      on_row_error: 'stop',
      max_rows: 1,
      column_mapping: [
        { jsonpath: '$.report_type',       column: 'report_type',       transform: '',     required: true },
        { jsonpath: '$.as_of_date',        column: 'as_of_date',        transform: 'date', required: true },
        { jsonpath: '$.title',             column: 'title',             transform: '' },
        { jsonpath: '$.summary',           column: 'summary',           transform: '' },
        { jsonpath: '$.full_content',      column: 'full_content',      transform: '' },
        { jsonpath: '$.key_findings',      column: 'key_findings',      transform: '' },
        { jsonpath: '$.sentiment_overall', column: 'sentiment_overall', transform: '' },
        { jsonpath: '$.model_used',        column: 'model_used',        transform: '' },
      ],
    },
    {
      id: generateId,
      type: 'generate_file',
      label: '產出 DOCX 週報',
      output_file: 'docx',
      filename: '金屬市場週報_{{date}}.docx',
      input: '{{ai_output}}',
    },
    {
      id: kbWriteId,
      type: 'kb_write',
      label: '寫入 PM-分析庫(週報)',
      kb_id: (kbMap && kbMap.get('PM-分析庫')) || '',
      kb_name: 'PM-分析庫',
      title_field: '$.title',
      url_field: '',
      summary_field: '$.summary',
      content_field: '$.full_content',
      source_field: '',
      published_at_field: '$.as_of_date',
      chunk_strategy: 'mixed',
      dedupe_mode: 'title',
      max_chunks_per_run: 30,
      on_row_error: 'skip',
      input: '{{ai_output}}',
    },
  ];

  return {
    name: '[PM] 金屬市場週報',
    schedule_type: 'weekly',
    schedule_hour: 8,
    schedule_minute: 30,
    schedule_weekday: 1,  // Monday
    schedule_times_json: null,
    schedule_interval_hours: null,
    model: proModel,
    prompt,
    output_type: 'text',
    file_type: null,
    filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 金屬市場週報 — {{date}}',
    email_body: '本週金屬市場週報請參閱附件。',
    status: 'paused',
    pipeline_json: JSON.stringify(pipeline),
  };
}

// ── [PM] 月報(D14)─────────────────────────────────────────────────────────
function buildMonthlyReportTask(kbMap, models = {}) {
  const proModel = models.pro || 'pro';
  const dbReportId = newNodeId('dbw');
  const generateId = newNodeId('gen');
  const kbWriteId  = newNodeId('kbw');

  const prompt = `今天是 {{date}}(月初),撰寫「金屬市場月報」(回顧上個月)。

═══ 上下文 ═══
{{kb:PM-新聞庫}}     ← 過去 30 天重大新聞
{{kb:PM-分析庫}}     ← 過去 30 天週報 / 日報

═══ 撰寫要求 ═══
1. 上月市場總覽(主旋律 / 結構性變化)
2. 11 金屬月漲跌統計 + Top 3 漲幅 + Top 3 跌幅
3. 上月重大政策 / 地緣 / 供需事件回顧
4. 本月展望(主要事件日曆 + 關鍵觀察)
5. 對採購預算編列的影響評估

═══ JSON 落地段 ═══
\`\`\`json
{
  "report_type": "monthly",
  "as_of_date": "{{date}}",
  "title": "金屬市場月報 — {{date}}",
  "summary": "400 字內月報摘要",
  "full_content": "完整月報全文",
  "key_findings": "本月 5-8 條核心發現",
  "sentiment_overall": "negative" | "neutral" | "positive",
  "model_used": "{{model_used}}"
}
\`\`\``;

  const pipeline = [
    {
      id: dbReportId,
      type: 'db_write',
      label: '寫入 pm_analysis_report(月報)',
      table: 'pm_analysis_report',
      operation: 'upsert',
      key_columns: ['report_type', 'as_of_date'],
      input: '{{ai_output}}',
      on_row_error: 'stop',
      max_rows: 1,
      column_mapping: [
        { jsonpath: '$.report_type',       column: 'report_type',       transform: '',     required: true },
        { jsonpath: '$.as_of_date',        column: 'as_of_date',        transform: 'date', required: true },
        { jsonpath: '$.title',             column: 'title',             transform: '' },
        { jsonpath: '$.summary',           column: 'summary',           transform: '' },
        { jsonpath: '$.full_content',      column: 'full_content',      transform: '' },
        { jsonpath: '$.key_findings',      column: 'key_findings',      transform: '' },
        { jsonpath: '$.sentiment_overall', column: 'sentiment_overall', transform: '' },
        { jsonpath: '$.model_used',        column: 'model_used',        transform: '' },
      ],
    },
    {
      id: generateId,
      type: 'generate_file',
      label: '產出 DOCX 月報',
      output_file: 'docx',
      filename: '金屬市場月報_{{date}}.docx',
      input: '{{ai_output}}',
    },
    {
      id: kbWriteId,
      type: 'kb_write',
      label: '寫入 PM-分析庫(月報)',
      kb_id: (kbMap && kbMap.get('PM-分析庫')) || '',
      kb_name: 'PM-分析庫',
      title_field: '$.title',
      url_field: '',
      summary_field: '$.summary',
      content_field: '$.full_content',
      source_field: '',
      published_at_field: '$.as_of_date',
      chunk_strategy: 'mixed',
      dedupe_mode: 'title',
      max_chunks_per_run: 50,
      on_row_error: 'skip',
      input: '{{ai_output}}',
    },
  ];

  return {
    name: '[PM] 金屬市場月報',
    schedule_type: 'monthly',
    schedule_hour: 9,
    schedule_minute: 0,
    schedule_monthday: 1,
    schedule_times_json: null,
    schedule_interval_hours: null,
    model: proModel,
    prompt,
    output_type: 'text',
    file_type: null,
    filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 金屬市場月報 — {{date}}',
    email_body: '上月金屬市場月報請參閱附件。',
    status: 'paused',
    pipeline_json: JSON.stringify(pipeline),
  };
}

// ── [PM] 全網金屬資料收集(P3.1)───────────────────────────────────────────
// 每天凌晨 06:00 + 加 multi_time(若需要更頻繁)
// 預設只 daily 一次,因為這是「全網總覽」性質,8 個 source × Pro 模型成本不低。
// admin 想加密度可改 schedule_type='interval' + schedule_interval_hours=8
function buildMasterScrapeTask(kbMap, models = {}) {
  const proModel = models.pro || 'pro';
  const dbWriteId = newNodeId('dbw');
  const kbWriteId = newNodeId('kbw');
  const generateId = newNodeId('gen');

  const prompt = `今天是 {{date}}({{weekday}})。
這個任務是 PM 平台的「**全網金屬資料總覽收集**」,目的是把當日各官方 / 權威網站的金屬市場資料一次抓回來,
用 LLM 整合分析後寫進「PM-原始資料庫」KB,讓後續日報 / 週報 / RAG 查詢都能引用最新一手資料。

═══ 全網資料源(若 URL 在公司防火牆未通,LLM 會自動 skip 該源)═══
{{scrape:https://www.kitco.com/charts/livegold.html}}
{{scrape:https://www.kitco.com/charts/livesilver.html}}
{{scrape:https://www.kitco.com/news/}}
{{scrape:https://www.westmetall.com/en/markdaten.php}}
{{scrape:https://www.westmetall.com/en/news.php}}
{{scrape:https://tradingeconomics.com/commodity/copper}}
{{scrape:https://tradingeconomics.com/commodity/aluminum}}
{{scrape:https://tradingeconomics.com/commodity/nickel}}
{{scrape:https://tradingeconomics.com/commodity/zinc}}
{{scrape:https://tradingeconomics.com/commodity/lead}}
{{scrape:https://tradingeconomics.com/commodity/gold}}
{{scrape:https://tradingeconomics.com/commodity/silver}}
{{scrape:https://tradingeconomics.com/commodity/platinum}}
{{scrape:https://tradingeconomics.com/commodity/palladium}}
{{scrape:https://www.mining.com/news/}}
{{scrape:https://oilprice.com/Latest-Energy-News/}}
{{scrape:https://www.lme.com/Metals/Non-ferrous/LME-Copper}}
{{scrape:https://www.investing.com/commodities/metals}}

═══ 任務 ═══
1. 解析每個來源的「結構化資料」(報價 / 漲跌 / 庫存 / 圖表數值)+「市場敘事」(評論 / 新聞)
2. 撰寫一段 500-800 字的「當日全市場綜述」(中文)— 涵蓋:
   - 11 種金屬(銅/鋁/鎳/錫/鋅/鉛/金/銀/鉑/鈀/銠)的當日表現
   - 主要驅動事件(政策 / 庫存 / 地緣 / 美元動態)
   - 跨資產關聯觀察(金 vs 美元 / 銅 vs 中國需求 / 銀 vs 太陽能)
3. 每個 source 抽出一個「條目」做 KB 歸檔:title / url / source / 內容摘要 + 完整擷取的核心數據

═══ 輸出格式(雙段)═══
A. **綜述全文**(markdown,給人看 + DOCX 報告用,放最前面)

B. **JSON 落地段**(供 db_write + kb_write 解析,放在 markdown 末尾的 \`\`\`json 區塊)

\`\`\`json
[
  {
    "title": "Kitco 即時黃金 / 白銀報價快照 — {{date}}",
    "url": "https://www.kitco.com/charts/livegold.html",
    "source": "Kitco",
    "language": "en",
    "published_at": "{{date}}T06:00:00Z",
    "summary": "當下黃金 USD/oz、白銀 USD/oz、24小時漲跌 %、量能變化等繁體中文摘要 80-150 字",
    "content": "完整擷取的價格表 + Kitco 編輯短評(原文 + 必要中譯)。1500-3000 字之間,給 KB 切片做 RAG 用。",
    "sentiment_score": 0.1,
    "sentiment_label": "neutral",
    "related_metals": ["AU", "AG"],
    "topics": ["spot_price", "live_quote"]
  },
  {
    "title": "Westmetall 基本金屬日結報價 — {{date}}",
    "url": "https://www.westmetall.com/en/markdaten.php",
    "source": "Westmetall",
    "...": "..."
  }
  // 每個 source 一筆,共 ~10-18 個 items
]
\`\`\`

注意:
- 任何 source scrape 失敗就 skip,JSON 內不要放沒抓到的條目
- summary 必繁體中文;content 可英文 + 部分中譯
- sentiment_score -1 ~ +1 是「對該金屬未來 1-7 天價格的影響」`;

  const pipeline = [
    {
      id: dbWriteId,
      type: 'db_write',
      label: '寫入 pm_news(各 source 條目)',
      table: 'pm_news',
      operation: 'insert',
      key_columns: [],
      input: '{{ai_output}}',
      on_row_error: 'skip',
      max_rows: 50,
      column_mapping: [
        { jsonpath: '$.url',             column: 'url',             transform: '',                required: true },
        { jsonpath: '$.url',             column: 'url_hash',        transform: 'sha256',          required: true },
        { jsonpath: '$.title',           column: 'title',           transform: '' },
        { jsonpath: '$.source',          column: 'source',          transform: '' },
        { jsonpath: '$.published_at',    column: 'published_at',    transform: 'date' },
        { jsonpath: '$.language',        column: 'language',        transform: '' },
        { jsonpath: '$.summary',         column: 'summary',         transform: '' },
        { jsonpath: '$.sentiment_score', column: 'sentiment_score', transform: 'number' },
        { jsonpath: '$.sentiment_label', column: 'sentiment_label', transform: '' },
        { jsonpath: '$.related_metals',  column: 'related_metals',  transform: 'array_join_comma' },
        { jsonpath: '$.topics',          column: 'topics',          transform: 'array_join_comma' },
      ],
    },
    {
      id: kbWriteId,
      type: 'kb_write',
      label: '寫入 PM-原始資料庫(各 source 全文)',
      kb_id: (kbMap && kbMap.get('PM-原始資料庫')) || '',
      kb_name: 'PM-原始資料庫',
      title_field: '$.title',
      url_field: '$.url',
      summary_field: '$.summary',
      content_field: '$.content',
      source_field: '$.source',
      published_at_field: '$.published_at',
      chunk_strategy: 'mixed',
      dedupe_mode: 'url',
      max_chunks_per_run: 200,
      on_row_error: 'skip',
      input: '{{ai_output}}',
    },
    {
      id: generateId,
      type: 'generate_file',
      label: '產出 DOCX 全網綜述',
      output_file: 'docx',
      filename: '貴金屬全網綜述_{{date}}.docx',
      input: '{{ai_output}}',
    },
  ];

  return {
    name: '[PM] 全網金屬資料收集',
    schedule_type: 'daily',
    schedule_hour: 6,
    schedule_minute: 0,
    schedule_times_json: null,
    schedule_interval_hours: null,
    model: proModel,
    prompt,
    output_type: 'text',
    file_type: null,
    filename_template: null,
    recipients_json: '[]',
    email_subject: '[PM] 貴金屬全網資料綜述 — {{date}}',
    email_body: '今日全網金屬資料(Kitco / Westmetall / TradingEconomics 等)綜述已抓取整合,完整內文已寫入 PM-原始資料庫 KB。',
    status: 'paused',
    pipeline_json: JSON.stringify(pipeline),
  };
}

// ── Patch 既有任務:fill in kb_id where kb_name matches but kb_id is empty ───
async function patchExistingTaskKbIds(db, kbMap) {
  if (!kbMap || kbMap.size === 0) return;
  // 找所有 [PM] 開頭的任務,檢查 pipeline_json 內 kb_write 節點
  let rows;
  try {
    rows = await db.prepare(`SELECT id, name, pipeline_json FROM scheduled_tasks WHERE name LIKE '[PM]%'`).all();
  } catch (e) {
    console.warn('[PMScheduledTaskSeed] patch select failed:', e.message);
    return;
  }
  let patched = 0;
  for (const r of rows || []) {
    const raw = r.pipeline_json || r.PIPELINE_JSON;
    if (!raw) continue;
    let nodes;
    try { nodes = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); }
    catch { continue; }
    if (!Array.isArray(nodes)) continue;

    let dirty = false;
    for (const n of nodes) {
      if (n?.type !== 'kb_write') continue;
      if (n.kb_id && String(n.kb_id).trim()) continue;  // 已填,不動
      if (!n.kb_name) continue;
      const kbId = kbMap.get(n.kb_name);
      if (kbId) {
        n.kb_id = kbId;
        dirty = true;
      }
    }
    if (dirty) {
      try {
        await db.prepare(`UPDATE scheduled_tasks SET pipeline_json=?, updated_at=SYSTIMESTAMP WHERE id=?`)
          .run(JSON.stringify(nodes), r.id || r.ID);
        patched++;
        console.log(`[PMScheduledTaskSeed] patched kb_id for task #${r.id || r.ID} "${r.name || r.NAME}"`);
      } catch (e) {
        console.warn(`[PMScheduledTaskSeed] patch task #${r.id || r.ID} failed:`, e.message);
      }
    }
  }
  if (patched > 0) console.log(`[PMScheduledTaskSeed] patched ${patched} existing task(s) with seed kb_id`);
}

/**
 * 補既有 [PM]% task 的 db_write(table='pm_news')mapping 缺漏的 published_at 欄位
 * (Phase 5 後發現的 schema-mapping 漏洞:LLM 有輸出 $.published_at 但 mapping 沒撈)
 * Idempotent — 已含 published_at mapping 的不動
 */
async function patchExistingNewsPublishedAtMapping(db) {
  let rows;
  try {
    rows = await db.prepare(`SELECT id, name, pipeline_json FROM scheduled_tasks WHERE name LIKE '[PM]%'`).all();
  } catch (e) {
    console.warn('[PMScheduledTaskSeed] patch published_at: select failed:', e.message);
    return;
  }
  let patched = 0;
  for (const r of rows || []) {
    const raw = r.pipeline_json || r.PIPELINE_JSON;
    if (!raw) continue;
    let nodes;
    try { nodes = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); }
    catch { continue; }
    if (!Array.isArray(nodes)) continue;

    let dirty = false;
    for (const n of nodes) {
      if (n?.type !== 'db_write') continue;
      if (String(n.table || '').toLowerCase() !== 'pm_news') continue;
      if (!Array.isArray(n.column_mapping)) continue;
      const hasPublishedAt = n.column_mapping.some(m => String(m?.column || '').toLowerCase() === 'published_at');
      if (hasPublishedAt) continue;

      // insert published_at mapping 接在 'source' 之後(若沒 source 就放最後)
      const sourceIdx = n.column_mapping.findIndex(m => String(m?.column || '').toLowerCase() === 'source');
      const newRow = { jsonpath: '$.published_at', column: 'published_at', transform: 'date' };
      if (sourceIdx >= 0) n.column_mapping.splice(sourceIdx + 1, 0, newRow);
      else n.column_mapping.push(newRow);
      dirty = true;
    }
    if (dirty) {
      try {
        await db.prepare(`UPDATE scheduled_tasks SET pipeline_json=?, updated_at=SYSTIMESTAMP WHERE id=?`)
          .run(JSON.stringify(nodes), r.id || r.ID);
        patched++;
        console.log(`[PMScheduledTaskSeed] patched published_at mapping for task #${r.id || r.ID} "${r.name || r.NAME}"`);
      } catch (e) {
        console.warn(`[PMScheduledTaskSeed] patch published_at task #${r.id || r.ID} failed:`, e.message);
      }
    }
  }
  if (patched > 0) console.log(`[PMScheduledTaskSeed] patched ${patched} existing task(s) with published_at mapping`);
}

/**
 * 補既有 [PM]% task 的 db_write(table='forecast_history')缺漏的 array_path
 * (原 seed 的 column_mapping 第一筆是 placeholder marker '__expand__',實際 input
 *  是 {report:..., forecasts:[...]} 但沒 drill,導致 forecast_history 寫不進去)
 * Idempotent — 已有 array_path 的不動;順手把 placeholder marker mapping 拿掉
 */
async function patchExistingForecastArrayPath(db) {
  let rows;
  try {
    rows = await db.prepare(`SELECT id, name, pipeline_json FROM scheduled_tasks WHERE name LIKE '[PM]%'`).all();
  } catch (e) {
    console.warn('[PMScheduledTaskSeed] patch forecast array_path: select failed:', e.message);
    return;
  }
  let patched = 0;
  for (const r of rows || []) {
    const raw = r.pipeline_json || r.PIPELINE_JSON;
    if (!raw) continue;
    let nodes;
    try { nodes = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); }
    catch { continue; }
    if (!Array.isArray(nodes)) continue;

    let dirty = false;
    for (const n of nodes) {
      if (n?.type !== 'db_write') continue;
      if (String(n.table || '').toLowerCase() !== 'forecast_history') continue;

      // 補 array_path
      if (!n.array_path || !String(n.array_path).trim()) {
        n.array_path = '$.forecasts';
        dirty = true;
      }

      // 移除舊 placeholder mapping(column='__expand__')
      if (Array.isArray(n.column_mapping)) {
        const before = n.column_mapping.length;
        n.column_mapping = n.column_mapping.filter(m => String(m?.column || '').toLowerCase() !== '__expand__');
        if (n.column_mapping.length !== before) dirty = true;
      }

      // 移掉過時的 _note_for_admin
      if (n._note_for_admin) {
        delete n._note_for_admin;
        dirty = true;
      }
    }
    if (dirty) {
      try {
        await db.prepare(`UPDATE scheduled_tasks SET pipeline_json=?, updated_at=SYSTIMESTAMP WHERE id=?`)
          .run(JSON.stringify(nodes), r.id || r.ID);
        patched++;
        console.log(`[PMScheduledTaskSeed] patched forecast array_path for task #${r.id || r.ID} "${r.name || r.NAME}"`);
      } catch (e) {
        console.warn(`[PMScheduledTaskSeed] patch forecast array_path task #${r.id || r.ID} failed:`, e.message);
      }
    }
  }
  if (patched > 0) console.log(`[PMScheduledTaskSeed] patched ${patched} existing task(s) with forecast_history array_path`);
}

// ── 主 seed 入口 ────────────────────────────────────────────────────────────
async function autoSeedPmScheduledTasks(db, kbMap) {
  if (!db) {
    console.warn('[PMScheduledTaskSeed] db not ready, skip');
    return;
  }

  // 找一個 admin 當 owner
  let ownerId = null;
  try {
    const adminRow = await db.prepare(
      `SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id FETCH FIRST 1 ROWS ONLY`
    ).get();
    ownerId = adminRow?.id || null;
  } catch (_) {}
  if (!ownerId) {
    console.warn('[PMScheduledTaskSeed] no admin user, skip seeding');
    return;
  }

  // kbMap 沒給 → 自己跑一次 KB seed(獨立呼叫場景)
  if (!kbMap || !(kbMap instanceof Map)) {
    try {
      const { autoSeedPmKnowledgeBases } = require('./pmKnowledgeBaseSeed');
      kbMap = await autoSeedPmKnowledgeBases(db);
    } catch (e) {
      console.warn('[PMScheduledTaskSeed] inline pmKnowledgeBaseSeed failed:', e.message);
      kbMap = new Map();
    }
  }

  // 動態 pick model key — 優先 system_settings.pm_pro/pm_flash → default_chat → fuzzy match
  // 解決:dev 寫 'pro'/'flash',prod 是 'Gemini 3 Pro' lookup miss 崩潰
  const { pickModelKey } = require('./llmDefaults');
  const [proKey, flashKey] = await Promise.all([
    pickModelKey(db, 'pro').catch(() => ''),
    pickModelKey(db, 'flash').catch(() => ''),
  ]);
  const models = {
    pro: proKey || '',           // 空字串走 resolveTaskModel → default
    flash: flashKey || proKey || '',
  };
  console.log(`[PMScheduledTaskSeed] resolved models: pro="${models.pro}" flash="${models.flash}"`);
  if (!models.pro) {
    console.warn(`[PMScheduledTaskSeed] 找不到任何 active LLM 可當 PM Pro 模型;PM 任務 model 欄會空,執行時走系統 default_chat fallback。請到「PM 平台設定」UI 指定。`);
  }

  const tasks = [
    buildNewsTask(kbMap, models),
    buildMacroTask(models),
    buildDailyReportTask(kbMap, models),
    buildWeeklyReportTask(kbMap, models),
    buildMonthlyReportTask(kbMap, models),
    buildMasterScrapeTask(kbMap, models),
  ];

  let inserted = 0;
  let skippedExisting = 0;

  for (const t of tasks) {
    try {
      const existing = await db.prepare(`SELECT id FROM scheduled_tasks WHERE name=?`).get(t.name);
      if (existing) { skippedExisting++; continue; }

      await db.prepare(`
        INSERT INTO scheduled_tasks (
          user_id, name, schedule_type, schedule_hour, schedule_minute,
          schedule_weekday, schedule_monthday,
          schedule_times_json, schedule_interval_hours,
          model, prompt, output_type, file_type, filename_template,
          recipients_json, email_subject, email_body, status, pipeline_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ownerId, t.name, t.schedule_type, t.schedule_hour, t.schedule_minute,
        t.schedule_weekday ?? 1, t.schedule_monthday ?? 1,
        t.schedule_times_json, t.schedule_interval_hours,
        t.model, t.prompt, t.output_type, t.file_type, t.filename_template,
        t.recipients_json, t.email_subject, t.email_body, t.status, t.pipeline_json
      );
      inserted++;
      console.log(`[PMScheduledTaskSeed] Inserted (paused): ${t.name}`);
    } catch (e) {
      console.error(`[PMScheduledTaskSeed] INSERT ${t.name} failed:`, e.message);
    }
  }

  if (inserted > 0) {
    console.log(`[PMScheduledTaskSeed] v${SEED_VERSION} — ${inserted} inserted, ${skippedExisting} already existed`);
    console.log(`[PMScheduledTaskSeed] 提醒:這些任務預設 status='paused',admin 需檢查 prompt / 加收件人後才能 enable(kb_id 已自動帶入)`);
  } else if (skippedExisting > 0) {
    console.log(`[PMScheduledTaskSeed] All ${skippedExisting} tasks already exist, no insert needed`);
  }

  // Patch 既有任務:fill in kb_id where empty
  await patchExistingTaskKbIds(db, kbMap);

  // Patch 既有任務:把 model='pro'/'flash'(舊 seed 寫死的)替換成新 pickModelKey 結果
  await patchExistingTaskModels(db, models);

  // Patch 既有任務:db_write(pm_news)補 published_at mapping(Phase 5 後修正)
  await patchExistingNewsPublishedAtMapping(db);

  // Patch 既有任務:db_write(forecast_history)補 array_path(原 seed 是 placeholder)
  await patchExistingForecastArrayPath(db);
}

// ── 把既有 PM 任務的 model 從舊 alias('pro'/'flash')patch 到 pickModelKey 的結果 ───
async function patchExistingTaskModels(db, models) {
  if (!models || (!models.pro && !models.flash)) return;
  let rows;
  try {
    rows = await db.prepare(`SELECT id, name, model FROM scheduled_tasks WHERE name LIKE '[PM]%'`).all();
  } catch (e) {
    console.warn('[PMScheduledTaskSeed] patch model select failed:', e.message);
    return;
  }
  let patched = 0;
  for (const r of rows || []) {
    const cur = String(r.model || '').toLowerCase();
    // 只 patch 看起來像 alias 的(短字 / 完全等於 'pro'/'flash')— 不動 admin 已改成具體 api name 的
    const isOldAlias = cur === 'pro' || cur === 'flash';
    if (!isOldAlias) continue;

    const isFlashTask = /新聞|總體經濟/.test(r.name);
    const targetKey = isFlashTask ? (models.flash || models.pro) : models.pro;
    if (!targetKey || targetKey === r.model) continue;

    try {
      await db.prepare(`UPDATE scheduled_tasks SET model=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(targetKey, r.id);
      patched++;
      console.log(`[PMScheduledTaskSeed] patched task #${r.id} "${r.name || r.NAME}" model: ${cur} → ${targetKey}`);
    } catch (e) {
      console.warn(`[PMScheduledTaskSeed] patch model task #${r.id} failed:`, e.message);
    }
  }
  if (patched > 0) console.log(`[PMScheduledTaskSeed] patched ${patched} existing task(s) model alias → real key`);
}

module.exports = {
  autoSeedPmScheduledTasks,
  SEED_VERSION,
};
