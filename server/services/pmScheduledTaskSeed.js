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
 * 包含的任務(Phase 2 D10-D14):
 *   - [PM] 每日金屬新聞抓取(D10)— multi_time 9:00 / 14:30
 *   - [PM] 總體經濟指標日抓(D11)— daily 09:00
 *   - [PM] 每日金屬日報(D12)— daily 18:00
 *   - [PM] 週報(D14)— weekly Mon 08:30
 *   - [PM] 月報(D14)— monthly day 1 09:00
 *
 * 註:
 *   - kb_write 節點的 kb_id 預設留空,admin 需自己選 KB 後再 enable
 *   - 部分 prompt 引用了 {{scrape:URL}} 以 LLM tool 自動抓網頁,前提是來源 URL 在公司防火牆白名單
 *   - 日報/週報/月報的 prompt 引用了 `{{kb:KB_NAME}}` 做 RAG;admin 需把 KB_NAME
 *     換成實際存在的 KB(預設留 「PM-新聞庫」 / 「PM-分析庫」字面 placeholder)
 */

const SEED_VERSION = '1.0.0';

function newNodeId(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 8)}`; }

// ── [PM] 每日金屬新聞抓取(D10)──────────────────────────────────────────────
function buildNewsTask() {
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
      label: '寫入 KB(請先選擇知識庫)',
      kb_id: '',  // ← admin 必填,啟用前要選 KB
      kb_name: '',
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
    model: 'flash',
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
function buildMacroTask() {
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
    model: 'flash',
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
function buildDailyReportTask() {
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
      on_row_error: 'skip',
      max_rows: 50,
      column_mapping: [
        { jsonpath: '$.forecasts[*]', column: '__expand__', transform: '' },  // marker — runtime 不認,但提示 admin 此 mapping 預期 array root
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
      _note_for_admin: '⚠ 此節點 input 預期是 forecasts 陣列。需在「輸入來源」欄改成 {{ai_output}}.forecasts 或先用 ai 節點抽出 forecasts 子陣列。pipelineDbWriter 預設只支援頂層陣列,此 mapping 是 placeholder。',
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
      label: '寫入 KB(PM-分析庫,啟用前請選 KB)',
      kb_id: '',
      kb_name: '',
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
    model: 'pro',
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
function buildWeeklyReportTask() {
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
      label: '寫入 KB(PM-分析庫)',
      kb_id: '',
      kb_name: '',
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
    model: 'pro',
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
function buildMonthlyReportTask() {
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
      label: '寫入 KB(PM-分析庫)',
      kb_id: '',
      kb_name: '',
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
    model: 'pro',
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

// ── 主 seed 入口 ────────────────────────────────────────────────────────────
async function autoSeedPmScheduledTasks(db) {
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

  const tasks = [
    buildNewsTask(),
    buildMacroTask(),
    buildDailyReportTask(),
    buildWeeklyReportTask(),
    buildMonthlyReportTask(),
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
    console.log(`[PMScheduledTaskSeed] 提醒:這些任務預設 status='paused',admin 需檢查 prompt + 補 kb_id + 加收件人後才能 enable`);
  } else if (skippedExisting > 0) {
    console.log(`[PMScheduledTaskSeed] All ${skippedExisting} tasks already exist, no insert needed`);
  }
}

module.exports = {
  autoSeedPmScheduledTasks,
  SEED_VERSION,
};
