# Phase 2 + 3:Pipeline 擴充與貴金屬平台落地

> **建立日期**:2026-04-25  
> **預計工期**:4 週(20 工作天)  
> **基礎**:Phase 1(commit `c8b00e6`)— Pipeline `db_write` 節點 + AI 戰情 metal_price_history seed + Help 文件

---

## 0. Phase 1 回顧

| 已完成 | commit |
|--------|--------|
| Pipeline `db_write` 節點 + 兩層白名單 + Dry-run | `5bb9d54` |
| `metal_price_history` schema(11 欄擴充)| `6d51e11` |
| 排程貴金屬抓取走通(Westmetall + TradingEconomics)| 排程任務 144 |
| AI 戰情「金屬行情分析」Project + 5 Design + Schema seed | `c8b00e6` |
| Help 文件 db_write 節點 + 白名單管理章節 | `c8b00e6` |
| `is_pipeline_admin` flag + UI checkbox | `5bb9d54` |
| Debug log 強化(`[Pipeline db_write] OK`)| `f23d7ed` |

---

## 1. Phase 2+3 範圍總覽

```
Week 1(基礎建設) ✅
  D1   既有 4 痛點修 + rename metal_price_history → pm_price_history ✅
  D2-3 排程彈性化:interval + multi_time 模式 + UI ✅
  D4   AI 戰情自動註冊機制(白名單核准 → auto register)✅
  D5   Schema 擴 5 張新表 ✅

Week 2(寫入機制 + 通用 Skill)
  D6-8 kb_write 節點(寫 KB,複用既有 KB 權限)✅ 2026-04-25
  D9   forecast_timeseries_llm 通用 Skill ✅ 2026-04-25
  D10  新聞排程(scrape → LLM Flash 摘要+情緒 → db_write + kb_write)✅ 2026-04-25

Week 3(資料管線完成)✅
  D11  總體經濟排程(FRED 或備援源)✅ 提前在 D10 同 seed 完成
  D12  每日金屬日報排程(LLM Pro 分析 → forecast + DOCX + KB)✅ 2026-04-25
  D13  AI 戰情 Designs + 採購/主管 Dashboard ✅ 2026-04-25
  D14  每週/月報排程 ✅ 2026-04-25(在同 seed 提前完成)

Week 4(Phase 3 警示)✅
  D15-16 alert 節點 backend(4 模式 + 4 動作 + 模板/LLM 雙模式)✅ 2026-04-25
  D17-18 alert 節點 admin UI(AlertForm + AlertRulesPanel + sync-pipeline)✅ 2026-04-25
  D19    pm_alert_history + 告警查看頁(內含於 AlertRulesPanel.history view)✅ 2026-04-25
  D20    Help docs 補完 ✅ 2026-04-25(Pipeline 警示節點完整章節進 helpSeedData)
         端到端測試 → 留 user 實際在 Cortex 操作驗證

附加(Phase 3.1 / 全網收集)— 2026-04-25 同日完成
  ✅ pmKnowledgeBaseSeed:自動建 PM-{新聞,分析,原始資料}庫 3 個 KB
  ✅ pmScheduledTaskSeed 重構:kb_write.kb_id 直接帶入 + patchExistingTaskKbIds
     掃既有 [PM]% 任務空 kb_id 自動補上(免 admin 重新拖拽)
  ✅ 新任務「[PM] 全網金屬資料收集」(daily 06:00,Pro)
     18 個 {{scrape:URL}} 整合 → pm_news + PM-原始資料庫 + DOCX 綜述
  ✅ Phase 3.1 alert_rules.schedule_interval_minutes + alertRuleScheduler
     node-cron 每分鐘 tick + Redis 多 pod 鎖
  ✅ AlertRuleEditor modal:獨立規則 admin 端到端建立 / 編輯 / 試跑
     + AlertRulesPanel 表格新增「輪詢」欄 + ✏ 編輯按鈕
  ✅ Help docs 加「獨立規則(Phase 3.1)」subsection
```

---

## 2. Week 1 D1:既有 4 痛點修正

### 2.1 Email body 不再過濾 db_write 訊息
[scheduledTaskService.js:469](server/services/scheduledTaskService.js#L469) 的 `.filter(v => !v.startsWith('['))` 會把 `[DB 寫入 metal_price_history: 11 inserted...]` 砍掉。改成保留 db_write/kb_write 摘要,讓收件人看到資料落地狀態。

### 2.2 Dry-run 自動帶最近一次 ai_output
PipelineTab.tsx 的 `_dry_run_sample` 預設要從最近一次 scheduled_task_runs.response_preview 載入,免 user 手動 copy-paste。

### 2.3 admin role 自動繼承 is_pipeline_admin
目前 admin user 還要手動勾「Pipeline 管理員」。改成 `verifyPipelineAdmin` middleware:`role==='admin' || is_pipeline_admin===1` 就 pass(現已是這個邏輯,但前端 UI 顯示要對齊)。

### 2.4 UPSERT log 區分 inserted vs updated
pipelineDbWriter.js 的 `execUpsert` 全部回 `'inserted'`(因為 Oracle MERGE 沒有 RETURNING)。改用兩段邏輯:先 SELECT 看 key 存在否,再決定動作回傳。

### 2.5 Rename metal_price_history → pm_price_history

```sql
-- Migration:用 RENAME(table 已有 22 筆資料)
ALTER TABLE metal_price_history RENAME TO pm_price_history;
ALTER INDEX idx_mph_date RENAME TO idx_pmph_date;
ALTER INDEX idx_mph_code RENAME TO idx_pmph_code;
ALTER INDEX idx_mph_source RENAME TO idx_pmph_source;
```

連帶修:
- `pipeline_writable_tables` 的 entry rename
- `aiDashboardMetalPriceSeed.js` 的 table_name
- 所有 design few_shot SQL 的 table_name
- Help 文件的 table 名稱

---

## 3. Week 1 D2-3:排程彈性化

### 3.1 新增兩種 schedule_type

| 類型 | 設定方式 | cron 表達式 |
|------|---------|------------|
| `daily`(既有)| 單一時:分 | `M H * * *` |
| `weekly`(既有)| 週幾 + 時:分 | `M H * * W` |
| `monthly`(既有)| 月幾日 + 時:分 | `M H D * *` |
| **`interval`(新)** | 每 N 小時 | `0 */N * * *` |
| **`multi_time`(新)** | 多時段 [HH:MM, ...] | `M h1,h2,h3 * * *` |

### 3.2 DB 改動

```sql
ALTER TABLE scheduled_tasks ADD schedule_interval_hours NUMBER;
ALTER TABLE scheduled_tasks ADD schedule_times_json    VARCHAR2(500);
```

### 3.3 cron builder 邏輯

```js
function buildCronExpr(task) {
  const m = task.schedule_minute ?? 0;
  const h = task.schedule_hour ?? 8;
  switch (task.schedule_type) {
    case 'weekly':     return `${m} ${h} * * ${task.schedule_weekday ?? 1}`;
    case 'monthly':    return `${m} ${h} ${task.schedule_monthday ?? 1} * *`;
    case 'interval':   return `0 */${task.schedule_interval_hours || 4} * * *`;
    case 'multi_time': {
      const times = JSON.parse(task.schedule_times_json || '[]');
      const hours = times.map(t => t.split(':')[0]).join(',');
      const minute = times[0]?.split(':')[1] || '0';
      return `${minute} ${hours} * * *`;
    }
    default:           return `${m} ${h} * * *`;
  }
}
```

### 3.4 UI

ScheduleTab 新增:
- `schedule_type` 下拉加 `interval` / `multi_time`
- `interval` 模式:「每 ___ 小時」number input(1-24)
- `multi_time` 模式:多時段 chip input,可加可刪,顯示順序排序
- **「下次執行預估」**:依 cron 顯示下 5 次執行時間(用 [cron-parser](https://www.npmjs.com/package/cron-parser) lib)

---

## 4. Week 1 D4:AI 戰情自動註冊機制

### 流程
1. Admin 在「Pipeline 可寫表」核准新表 + 填描述
2. 勾選「**同步註冊到 AI 戰情**」(預設勾)
3. 系統自動:
   - 在 `ai_schema_definitions` 加入此表
   - 從 `pipeline_writable_tables.column_metadata` 自動產 column descriptions
   - 加進預設的「Pipeline 自動落地」Project(若不存在則建立)
   - 1 個基本 Design(today snapshot)+ 1 個趨勢 Design(30 天)

之後新表只要 admin approve,**0 人工就能在 AI 戰情用自然語言查**。

### 程式變更
- `server/routes/pipelineWritableTables.js`:POST / 加參數 `register_to_ai_dashboard: boolean`
- 新 Service:`server/services/aiSchemaAutoRegister.js`
- 既有的 `aiDashboardCostAnalysisSeed.js` / `aiDashboardMetalPriceSeed.js` 模式不動,但抽出共用 helper

---

## 5. Week 1 D5:Schema 擴 5 張新表

### 5.1 `pm_macro_history`(總體經濟指標)
```sql
CREATE TABLE pm_macro_history (
  id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  as_of_date      DATE NOT NULL,
  indicator_code  VARCHAR2(20) NOT NULL,   -- DXY/VIX/UST10Y/WTI/EURUSD 等
  indicator_name  VARCHAR2(100),
  value           NUMBER(18,6),
  unit            VARCHAR2(30),            -- 'index', 'percent', 'USD/bbl' 等
  source          VARCHAR2(50),            -- 'FRED' / 'TradingEconomics' / 'Investing'
  source_url      VARCHAR2(500),
  meta_run_id     NUMBER,
  meta_pipeline   VARCHAR2(200),
  creation_date   TIMESTAMP DEFAULT SYSTIMESTAMP,
  last_updated_date TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT uq_macro_indicator_day UNIQUE (indicator_code, as_of_date, source)
);
```

### 5.2 `pm_news`(新聞 metadata)
```sql
CREATE TABLE pm_news (
  id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  url_hash        VARCHAR2(64) NOT NULL,    -- SHA256(url),unique key
  url             VARCHAR2(1000) NOT NULL,
  title           VARCHAR2(500),
  source          VARCHAR2(50),             -- Reuters/cnyes/Bloomberg 等
  language        VARCHAR2(10),             -- zh-TW / en / vi
  published_at    TIMESTAMP,
  scraped_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
  summary         VARCHAR2(2000),           -- LLM 摘要
  sentiment_score NUMBER(5,4),              -- -1.0 ~ 1.0
  sentiment_label VARCHAR2(20),             -- 'positive' / 'neutral' / 'negative'
  related_metals  VARCHAR2(100),            -- 'CU,AL,NI' csv
  topics          VARCHAR2(200),            -- 'policy,supply,etf' csv
  kb_chunk_id     NUMBER,                   -- 對應寫入 KB 的 chunk id(用於追溯)
  meta_run_id     NUMBER,
  meta_pipeline   VARCHAR2(200),
  creation_date   TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT uq_news_url_hash UNIQUE (url_hash)
);
CREATE INDEX idx_pmnews_published ON pm_news(published_at);
CREATE INDEX idx_pmnews_metal ON pm_news(related_metals);
```

### 5.3 `forecast_history`(通用預測表 — 不只金屬)
```sql
CREATE TABLE forecast_history (
  id               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type      VARCHAR2(20) NOT NULL,    -- 'metal' / 'fx' / 'stock' / 'demand' / ...
  entity_code      VARCHAR2(50) NOT NULL,    -- 'CU', 'EUR/USD', 'TSLA', 'PROD-001'
  forecast_date    DATE NOT NULL,            -- 預測產生日
  target_date      DATE NOT NULL,            -- 預測目標日
  horizon_days     NUMBER,
  predicted_mean   NUMBER(18,6),
  predicted_lower  NUMBER(18,6),
  predicted_upper  NUMBER(18,6),
  confidence       VARCHAR2(20),             -- 'low' / 'medium' / 'high'
  rationale        CLOB,                     -- LLM 推理過程
  key_drivers      VARCHAR2(500),
  model_used       VARCHAR2(50),
  context_snapshot CLOB,                     -- 當時餵給 LLM 的 context
  meta_run_id      NUMBER,
  meta_pipeline    VARCHAR2(200),
  creation_date    TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT uq_forecast UNIQUE (entity_type, entity_code, forecast_date, target_date, model_used)
);
CREATE INDEX idx_fh_entity ON forecast_history(entity_type, entity_code);
CREATE INDEX idx_fh_target ON forecast_history(target_date);
```

### 5.4 `pm_alert_history`(警示日誌)
```sql
CREATE TABLE pm_alert_history (
  id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  triggered_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
  rule_id         NUMBER,                   -- alert_rules.id(若用獨立規則表)
  rule_code       VARCHAR2(50),             -- 'threshold'/'historical_avg'/'rate_change'/'zscore'
  severity        VARCHAR2(10),             -- 'info'/'warning'/'critical'
  source_node_id  VARCHAR2(50),             -- pipeline 節點 id
  source_task_id  NUMBER,                   -- scheduled_tasks.id
  entity_type     VARCHAR2(20),
  entity_code     VARCHAR2(50),
  trigger_value   NUMBER(18,6),             -- 觸發當下的數值
  threshold_value NUMBER(18,6),             -- 對應閾值
  message         VARCHAR2(2000),           -- 模板組好的訊息
  llm_analysis    CLOB,                     -- 若啟用 LLM 分析,結果存這
  channels_sent   VARCHAR2(200),            -- 'email,webex,webhook' csv
  ack_user_id     NUMBER,                   -- 使用者 ack
  ack_at          TIMESTAMP,
  meta_run_id     NUMBER,
  creation_date   TIMESTAMP DEFAULT SYSTIMESTAMP
);
CREATE INDEX idx_alert_triggered ON pm_alert_history(triggered_at);
CREATE INDEX idx_alert_entity ON pm_alert_history(entity_type, entity_code);
```

### 5.5 `pm_analysis_report`(LLM 日報/週報精華)
```sql
CREATE TABLE pm_analysis_report (
  id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_type     VARCHAR2(20),             -- 'daily'/'weekly'/'monthly'
  as_of_date      DATE NOT NULL,
  title           VARCHAR2(200),
  summary         VARCHAR2(2000),           -- 200-500 字精華
  full_content    CLOB,                     -- 完整 LLM 輸出
  key_findings    CLOB,                     -- JSON array of bullet points
  sentiment_overall VARCHAR2(20),           -- 'bullish'/'bearish'/'neutral'
  related_files   VARCHAR2(500),            -- DOCX/PDF 相對路徑
  kb_chunk_ids    VARCHAR2(500),            -- 寫入 KB 的 chunk ids
  model_used      VARCHAR2(50),
  meta_run_id     NUMBER,
  meta_pipeline   VARCHAR2(200),
  creation_date   TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT uq_analysis_type_date UNIQUE (report_type, as_of_date)
);
```

---

## 6. Week 2 D6-8:`kb_write` 節點 ✅(2026-04-25 完成)

> **實作狀態**:✅ 已上線。檔案參考:
> - Backend: [server/services/pipelineKbWriter.js](../server/services/pipelineKbWriter.js)、[server/routes/pipelineKbWrite.js](../server/routes/pipelineKbWrite.js)、[server/services/pipelineRunner.js#case kb_write](../server/services/pipelineRunner.js)
> - Frontend: `KbWriteForm` in [client/src/components/admin/PipelineTab.tsx](../client/src/components/admin/PipelineTab.tsx)
> - Schema: `kb_documents` 加 `source_url / source_hash / meta_run_id / meta_pipeline / published_at` 欄位 + `kb_documents_uhash` UNIQUE(kb_id, source_hash)。([database-oracle.js](../server/database-oracle.js))
>
> **與規劃差異**:
> - dedupe 改成 `dedupe_mode` 四選一:`url`(預設)/ `title` / `url_or_title` / `none`,沒做「7 天 + 90% 相似」(那個成本高且 false positive 多;同 URL hash 就足夠了)
> - URL 自動正規化(剝 utm/fbclid/gclid、砍 fragment、trailing slash)再算 sha256
> - 沒有把 chunks metadata 細到 `sentiment_score / related_entities`(那是 Week 2 D10 新聞排程的事,kb_write 本身不關心 domain 語意;若要存這些,新聞 LLM 直接寫進 chunk content/summary 即可)
> - 短內容(<600 字)只切 1 chunk,不再切 body

### 6.1 設計原則(跟 db_write 對稱但不複製)

| 面向 | db_write | kb_write |
|------|----------|----------|
| 寫入目標 | DB table | KB chunks |
| 權限 | pipeline_admin | 對該 KB 有寫入權的任何 user(沿用既有 KB 權限) |
| 白名單 | `pipeline_writable_tables` | **不需要**(用 KB 既有權限) |
| 寫入 unit | row | text chunk(會自動切片 + embedding) |
| Idempotency | UPSERT key | URL hash unique + title 軟比對 |
| 上限 | per-table max_rows | 單次 100 chunks(per-pipeline-run cap) |

### 6.2 Chunking 策略(混合模式)

每筆 input(以新聞為例)切成多 chunks:
```
Chunk 1(優先召回)
  内容: title + summary + metadata
  metadata: { type: 'summary', weight: 'high' }

Chunk 2..N(細粒度)
  内容: 全文每 ~512 字一片
  metadata: { type: 'body', chunk_index: i, weight: 'normal' }

所有 chunks 共享:
  metadata: {
    source: 'pipeline',
    pipeline_run_id, pipeline_task_id, node_id,
    url, url_hash, published_at, sentiment_score,
    related_entities: ['CU', 'AL'],
    domain_metadata: {...}  // user-defined free-form
  }
```

### 6.3 Dedupe 策略

寫入前查詢 KB chunks 是否已有:
1. `metadata.url_hash` 完全相符 → skip(同一文章已寫過)
2. 同 KB 內,過去 7 天 + title 相似度 > 90% → skip(改寫但內容相同)
3. 都 unique → 寫入

### 6.4 寫入流程(pipelineKbWriter.js)

```
executeKbWrite(db, nodeConfig, sourceText, context):
  1. 權限檢查:user 對該 KB 有寫入權(沿用既有 KB 權限規則)
  2. 解析 input:從 sourceText 抽 JSON 陣列(extractJsonRows 共用 db_write 的)
  3. 每筆:
     a. dedupe 檢查
     b. chunk 切片(混合策略)
     c. metadata 組合
     d. 呼叫既有 KB ingestion service(server/services/knowledgeBaseService.js)
        對每 chunk:
          embedding 呼叫 → 寫 kb_chunks 表(含 vector + metadata)
  4. 累計 chunks 寫入數,超過 per-run cap 100 就停
  5. 回傳:{ chunks_written, chunks_skipped, errors }
```

### 6.5 節點 UI 配置欄位

| 欄位 | 說明 |
|------|------|
| Target KB(下拉) | 列出該 user 有寫入權的所有 KB |
| Input source | `{{ai_output}}` / `{{node_X_output}}` |
| 解析模式 | `json_array`(預設,從 input 抽 JSON 陣列)/ `single_text`(整個 input 當一筆) |
| Field mapping | 對 `json_array` 模式:JSONPath → metadata 欄位 |
| Chunking | `mixed`(預設)/ `single_chunk` / `body_only` |
| URL hash field | 哪個 JSON 欄位拿來算 hash(預設 `$.url`) |
| Dedupe window days | 預設 7 |
| Max chunks per run | 預設 100 |

### 6.6 i18n / Help 章節

文件補在 u-schedule 的 Pipeline 子章節下,跟 db_write 平行。

---

## 7. Week 2 D9:`forecast_timeseries_llm` 通用 Skill ✅(2026-04-25 完成)

> **實作狀態**:✅ 已上線。檔案:[server/services/forecastSkillSeed.js](../server/services/forecastSkillSeed.js)。
> 透過 server 啟動時 `autoSeedForecastSkill(db)` 自動 INSERT/UPGRADE 一筆 builtin skill,完全 generic
> (不寫死金屬語意),pipeline `skill` 節點直接 name='forecast_timeseries_llm' 即可呼叫。
>
> **與規劃差異**:
> - 改用 builtin skill(LLM Prompt 型)而非 standalone tool — 沿用既有的 skill 權限 / tool-calling
>   pipeline,免另外做 service registry。is_public=1 + is_admin_approved=1 所有 user 立即可用。
> - 升級策略改成 prompt diff(描述/system_prompt 變了就 UPDATE),不用版號 hash 儲到 DB
> - 加 `as_of_date` optional 欄位、加「容錯」prompt 要求(輸入非合法 JSON / series 為空時的回應規範)

### 7.1 Skill 規格

**type**:`builtin`(內建 Prompt 型,純 LLM,沒有 code subprocess)  
**name**:`forecast_timeseries_llm`  
**description**:依時序資料 + 上下文,以 LLM 推測未來 N 天走勢,適用任何具時序特性的指標(金屬、匯率、股價、需求量等)。

### 7.2 Tool schema(讓 LLM 可 tool-call,也可 pipeline 直呼)

```json
{
  "name": "forecast_timeseries_llm",
  "description": "用 LLM 對時序資料做未來 N 天預測,回傳 mean/lower/upper + 推理 + 主要驅動因子",
  "parameters": {
    "type": "object",
    "properties": {
      "series": {
        "type": "array",
        "description": "歷史時序,每筆 {date, value}",
        "items": { "type": "object" }
      },
      "horizon_days": { "type": "number", "default": 7 },
      "context_text": {
        "type": "string",
        "description": "自由文字背景:近期事件、相關指標、政策變化等"
      },
      "target_description": {
        "type": "string",
        "description": "預測目標的人類可讀描述(例 USD/ton 銅價)"
      },
      "model_override": {
        "type": "string",
        "description": "指定 LLM,預設用排程 task 的 model"
      }
    },
    "required": ["series", "horizon_days", "target_description"]
  }
}
```

### 7.3 Output schema(LLM 強制 JSON 輸出)

```json
{
  "forecast": [
    {"date": "2026-04-26", "mean": 13280, "lower": 13100, "upper": 13450}
  ],
  "confidence": "medium",
  "rationale": "...",
  "key_drivers": ["LME 庫存", "USD 強弱", "中國需求"],
  "model_used": "gemini-3-pro-preview",
  "horizon_days": 7
}
```

### 7.4 在金屬 pipeline 的用法

每日金屬日報 pipeline:
```
[1] AI 主體(Pro)讀 pm_price_history 過去 30 天 + pm_macro_history 最新 + 
   {{kb:PM-新聞庫}} RAG → 寫一段分析
[2] ai 節點呼叫 forecast_timeseries_llm tool
    args: { 
      series: [...30 天資料...], 
      horizon_days: 7, 
      context_text: 上一節點的分析,
      target_description: "USD/ton 銅價"
    }
[3] db_write 寫入 forecast_history(entity_type=metal, entity_code=CU)
[4] generate_file 產 DOCX 日報
[5] kb_write 把日報精華寫進 PM-分析庫 KB
```

### 7.5 未來其他用例(設計時要考慮)
- **匯率預測**:從 fx_rate_history → forecast_history(`entity_type=fx`)
- **股價預測**:從 stock_history → forecast_history(`entity_type=stock`)
- **產品需求**:從 ERP 訂單歷史 → forecast_history(`entity_type=demand`)

不寫死任何金屬語意。

---

## 8. Week 2 D10:新聞排程 ✅(2026-04-25 完成)

> **實作狀態**:✅ 已上線。檔案:
> - 新 transform `sha256` / `json_stringify` / `array_join_comma`:[server/config/pipelineSecurity.js](../server/config/pipelineSecurity.js)
> - 自動 seed:[server/services/pmScheduledTaskSeed.js](../server/services/pmScheduledTaskSeed.js)
> - Server 啟動時自動 INSERT(若 task name 不存在),預設 `status='paused'`,
>   admin 必須:(a) 檢查 prompt 來源 URL 是否在防火牆白名單;(b) 給 kb_write 節點補 kb_id;
>   (c) 加 recipients;(d) 改 status='active'
>
> **與規劃差異**:
> - 同時 seed 了 D10(新聞)+ D11(總體經濟)兩個任務(D11 提前在 same seeder 處理)
> - sha256 transform 自動做 URL 正規化(剝 utm/fbclid 等),跟 pipelineKbWriter 的 dedupe 一致
> - kb_write 節點留空 kb_id 防呆 — 確保 admin 真的看過再 enable



### 8.1 排程設定
- 任務名:`[PM] 每日金屬新聞抓取`
- schedule_type:**`multi_time`**(用新功能!)
- 時段:`["09:00", "14:30"]`
- task.model:`gemini-3-flash-preview`(per-article 量大,Flash)

### 8.2 Prompt 結構

```
今天是 {{date}}({{weekday}}),抓取以下來源最新金屬相關新聞。

═══ 資料源 ═══
{{fetch:https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?limit=20}}
{{scrape:https://www.kitco.com/news/}}
... 其他白名單通的源 ...

═══ 任務 ═══
從上述資料中,過濾出與「銅/鋁/鎳/錫/鋅/鉛/金/銀/鉑/鈀/銠」相關的新聞。
每篇做以下處理:
1. 抽出 title / url / source / published_at / 全文
2. 寫 80-150 字繁體中文摘要
3. 情緒打分 -1 到 +1(LLM 判斷對該金屬價格的影響面)
4. 標註相關金屬代碼

輸出 JSON 陣列(若無相關新聞輸出空陣列):

```json
[
  {
    "url": "https://...",
    "title": "...",
    "source": "Kitco",
    "published_at": "2026-04-25T08:00:00Z",
    "language": "en",
    "full_text": "完整內文...",
    "summary": "繁體中文摘要 80-150 字",
    "sentiment_score": -0.6,
    "sentiment_label": "negative",
    "related_metals": ["CU","AL"],
    "topics": ["supply","policy"]
  }
]
```
```

### 8.3 Pipeline 節點

```
[1] db_write
    table: pm_news
    operation: insert(URL hash 衝突 skip)
    column_mapping: title / url / source / published_at / summary / sentiment_score / ...
    *unique key: url_hash(由節點自動算 SHA256(url))*

[2] kb_write
    target_kb: PM-新聞庫
    input: {{ai_output}}(同一 JSON 陣列)
    chunking: mixed
    dedupe: url_hash(7 天窗口)
    field_mapping:
      $.url → metadata.url
      $.title → chunk_summary 的內容(混合 chunk 1)
      $.summary → chunk_summary 內容
      $.full_text → chunk_body 內容
      $.sentiment_score → metadata.sentiment_score
      $.related_metals → metadata.entity_codes
```

---

## 9. Week 3 D11:總體經濟排程

### 9.1 資料源策略
- **首選**:FRED API(`https://api.stlouisfed.org/fred/series/observations?series_id=DTWEXBGS&api_key=...`)— 需 free API key
- **備援**:`{{scrape:https://tradingeconomics.com/united-states/...}}`(TradingEconomics 已驗證可達)
- **補強**:`{{scrape:https://www.investing.com/economic-calendar/}}`

### 9.2 抓取指標清單

| 指標 | code | 用途 |
|------|------|------|
| DXY 美元指數 | DXY | 與金價長期負相關 |
| VIX 恐慌指數 | VIX | 風險偏好 |
| Fed Funds Rate | FED_FUNDS | 利率決策 |
| 美 10 年公債 | UST10Y | 與金價反向 |
| WTI 原油 | WTI | 通膨代理 |
| EUR/USD | EURUSD | 影響金屬 USD 計價 |
| TWD/USD | TWDUSD | 台灣採購相關 |

### 9.3 排程
- schedule_type:`daily` 09:00
- 寫入 `pm_macro_history`
- 同樣的 db_write pattern

---

## 10. Week 3 D12:每日金屬日報排程 ✅(2026-04-25 完成)

> **實作狀態**:✅ 任務 seed 已在 [pmScheduledTaskSeed.js](../server/services/pmScheduledTaskSeed.js)。
> 預設 status='paused',admin 必須:(a) 把 prompt 中的 `{{kb:PM-新聞庫}}` / `{{kb:PM-分析庫}}`
> 改成實際存在的 KB 名;(b) 補 kb_write 節點的 kb_id;(c) 加 recipients。
>
> **已知設計取捨**:
> - **forecast 落地節點是 placeholder** — pipelineDbWriter 預設只能解析頂層 JSON 陣列;`$.forecasts[*]`
>   嵌套陣列需要 admin 額外加一個 `ai` 節點先抽出來,或 LLM 直接吐 forecasts 為頂層陣列(再用一個
>   db_write 處理 pm_analysis_report)。已在節點加 `_note_for_admin` 欄位提示。
> - DOCX 透過 generate_file 節點輸出,內容直接是 LLM 的 markdown 報告(經 Pandoc-style 轉換)。
> - 不直接呼叫 forecast_timeseries_llm tool,改用 LLM Pro 直接 inline-推論 11 個金屬預測值,簡化 pipeline。
>   (forecast_timeseries_llm tool 可給未來 ad-hoc / 單金屬深度 forecast 用)



### 10.1 排程設定
- 任務名:`[PM] 每日金屬市場日報`
- schedule_type:`daily` 18:30(在 price 抓完之後)
- task.model:`gemini-3-pro-preview`(深度分析)

### 10.2 Prompt 結構

```
今天是 {{date}},撰寫一份金屬市場日報。

═══ 資料(系統自動撈)═══
最新價格:從 pm_price_history 撈今日 / 過去 7 天 / 過去 30 天
總體經濟:從 pm_macro_history 撈最新 DXY/VIX/UST10Y/原油
新聞背景:{{kb:PM-新聞庫}} 查近 24 小時新聞(會 RAG)

═══ 撰寫要求 ═══
1. 開場 200 字市場概覽
2. 11 種金屬逐一講當日表現 + 主要驅動
3. 連結最近新聞與宏觀指標的影響
4. 對未來 7 天的展望(每金屬 1-2 句)
5. 給採購單位的具體建議

═══ 額外輸出(供 forecast_history 落地)═══
請呼叫 forecast_timeseries_llm tool,對 6 種基本金屬 + 4 種貴金屬各跑一次 7 日預測,
context_text 用上述分析摘要。

═══ 落地 JSON ═══
分析報告 JSON(供 db_write):
```json
{
  "report_type": "daily",
  "as_of_date": "{{date}}",
  "title": "...",
  "summary": "...",
  "full_content": "...",
  "key_findings": [...],
  "sentiment_overall": "neutral"
}
```
```

### 10.3 Pipeline 節點

```
[1] db_write
    table: forecast_history
    操作: 從 LLM tool-call 結果撈 11 個金屬的預測,逐筆寫入

[2] db_write
    table: pm_analysis_report
    操作: 寫入今日報告 metadata + 全文

[3] generate_file
    DOCX 格式: 金屬市場日報_{{date}}.docx

[4] kb_write
    target_kb: PM-分析庫
    input: 報告精華($.summary + $.key_findings)
    chunking: single_chunk(整篇當一筆)

[5] (寄 email,既有功能)
```

---

## 11. Week 3 D13:AI 戰情擴充 ✅(2026-04-25 完成)

> **實作狀態**:✅ Server 啟動時自動 seed:
> - Project「[PM] 貴金屬情報」+ 3 個 Topic(採購視角 / 主管視角 / 分析師視角)
> - 12 個預設 Design(完整列表見 [pmDashboardSeed.js](../server/services/pmDashboardSeed.js))
>
> **採購視角(6 個)**:11 金屬今日報價 / 銅鋁鎳鋅 30 天 / 金銀鉑鈀 30 天 / 7 天預測走廊 /
> 24h 新聞情緒分布 / 7 日宏觀指標
>
> **主管視角(4 個)**:11 金屬月變化 KPI / 最新報告摘要 / 30 天警示 / 模型預測 vs 實際
>
> **分析師視角(2 個)**:同金屬多源價差 / 估算誤差追蹤
>
> **與規劃差異**:
> - 沒做專屬「Dashboard 拼盤」UI(系統現有 Project + Topic + Designs 三層架構就是 dashboard 的形態,每個 Design 是一張可獨立查的圖表)
> - 「AI 採購建議 Tile」改用「最新報告摘要」Design,query pm_analysis_report 給最近一份
> - 模型預測 vs 實際用 UNION ALL 拼 forecast_history + pm_price_history,不寫 dual-axis(Echarts 雙軸 / 多 series 由 chart_config 決定)
> - 完全 idempotent;Design 一旦存在,admin 改了也不會被覆蓋



### 11.1 新增 Designs(現有 5 個 → 12 個)

| 新增 | 名稱 | 圖表 |
|------|------|------|
| D-06 | 金銀比走勢(30天) | line |
| D-07 | DXY vs 金價(60天)| dual-axis |
| D-08 | LME 庫存熱力圖 | heatmap |
| D-09 | 預測 vs 實際對比 | line + scatter |
| D-10 | 7 日情緒趨勢(per metal) | line |
| D-11 | 新聞量 vs 價格波動 | scatter |
| D-12 | 模型 MAPE 滾動 | line |

### 11.2 採購視角 Dashboard
組合 6 個 Tile:
1. 4 大常用金屬今日報價 + 漲跌(KPI Card)
2. 未來 7 天預測走廊(line + band)
3. 今日 Top 5 新聞摘要(table)
4. 庫存變動異動(bar)
5. 30 天均價 vs 當前(comparison)
6. AI 採購建議(text — 從最新 pm_analysis_report 撈)

### 11.3 主管視角 Dashboard(只做這個 + 採購,共 2 個)
組合 4 個 Tile:
1. 11 金屬今日總覽(table 大字)
2. 本月 vs 上月變化(百分比 KPI)
3. 本週展望摘要(從最新 weekly report 撈)
4. 重大事件警示(從 pm_alert_history 撈最近 critical)

---

## 12. Week 3 D14:週報 / 月報排程 ✅(2026-04-25 完成)

> **實作狀態**:✅ 兩任務 seed 已上線:
> - `[PM] 金屬市場週報` — weekly Mon 08:30,Pro 模型,pipeline:db_write(report)→ DOCX → kb_write
> - `[PM] 金屬市場月報` — monthly day 1 09:00,Pro 模型,同 pipeline 結構
>
> 都預設 status='paused' + 同樣需 admin 補 kb_id / 改 KB 名 / 加 recipients。



### 週報
- schedule_type:`weekly` 週一 08:30
- task.model:Pro
- 撈過去 7 天 pm_price_history / pm_news / pm_macro_history / pm_alert_history
- LLM 寫週報(類似日報但時段 7 天)
- generate DOCX → email
- kb_write 寫入 PM-分析庫

### 月報
- schedule_type:`monthly` 每月 1 號 10:00
- task.model:Pro
- 撈過去 1 個月資料
- LLM 寫月報 + ROI 分析(若有採購資料)
- generate DOCX + PPTX(董事會用)→ email

---

## 13. Week 4:Phase 3 警示節點 ✅(2026-04-25 backend + UI 全部完成)

> **實作狀態**:✅ 上線。檔案:
> - Backend service:[server/services/pipelineAlerter.js](../server/services/pipelineAlerter.js) — executeAlert + 4 比較模式 + 4 動作 + cooldown
> - Routes:[server/routes/alertRules.js](../server/routes/alertRules.js) — CRUD + /test + /history + /sync-pipeline
> - Schema:`alert_rules` 表 + UNIQUE (task_id, node_id) + 加入 FORBIDDEN_TABLES
> - Pipeline UI:`AlertForm` in [client/src/components/admin/PipelineTab.tsx](../client/src/components/admin/PipelineTab.tsx)
> - Admin UI:[client/src/components/admin/AlertRulesPanel.tsx](../client/src/components/admin/AlertRulesPanel.tsx) — 列表 + 啟用/暫停 + 觸發歷史
> - 排程儲存時自動 sync alert 節點對應 alert_rules(by task_id+node_id)
>
> **與規劃差異**:
> - 沒做獨立規則(`bound_to='standalone'`)的 admin UI 編輯器 — API 已支援,但 UI 不做(留 Phase 3.1)
> - Pipeline 節點儲存時 sync 是 best-effort(失敗只記 console.warn 不阻擋 task 儲存)
> - LLM 分析在 dry-run mode 跳過(避免測試耗 token)
> - threshold operator 加 eq / ne 比規格多 2 種(實用)
> - rate_change operator 支援 abs / up / down 三種方向(規格只 abs)
> - data_source='sql_query' 強制只允許 SELECT 開頭(防注入)
> - dedup_key 支援(同 key 在 cooldown 期間不重複觸發,適合多 entity 同規則)

### 13.1 節點 type:`alert`

(規格已在前面對話拍板,這裡只列 schema)

### 13.2 alert_rules 表(獨立規則表)

```sql
CREATE TABLE alert_rules (
  id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_name       VARCHAR2(100),
  owner_user_id   NUMBER,
  bound_to        VARCHAR2(20),     -- 'pipeline_node' / 'standalone' 
  task_id         NUMBER,           -- 若 bound_to='pipeline_node',記排程任務 id
  node_id         VARCHAR2(50),     -- 對應 pipeline node id
  data_source     VARCHAR2(20),     -- 'upstream_json' / 'sql_query' / 'literal'
  data_config     CLOB,             -- JSON: { jsonpath, sql_query, literal_value }
  comparison      VARCHAR2(30),     -- 'threshold' / 'historical_avg' / 'rate_change' / 'zscore'
  comparison_config CLOB,           -- JSON: { operator, value, period_days, sigma, threshold_pct }
  severity        VARCHAR2(10),
  actions         CLOB,             -- JSON array: [{type:'email',to:[]},{type:'webex',room},...]
  message_template VARCHAR2(2000),
  use_llm_analysis NUMBER(1) DEFAULT 0,
  cooldown_minutes NUMBER DEFAULT 1440,
  dedup_key       VARCHAR2(200),
  is_active       NUMBER(1) DEFAULT 1,
  creation_date   TIMESTAMP DEFAULT SYSTIMESTAMP,
  last_modified   TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

### 13.3 Admin UI(獨立頁「警示規則」)
- list view:篩選 active / 嚴重等級 / 擁有者
- 編輯規則:資料源 / 比較模式 / 動作 / 訊息模板
- 觸發歷史 drill-down(點規則看 pm_alert_history)

### 13.4 與 Pipeline 節點的關係
- Pipeline 節點型 `alert` 可在排程中加,儲存時自動建立對應 alert_rules entry(`bound_to='pipeline_node'`)
- 也可獨立建立規則(`bound_to='standalone'`),由獨立排程 cron 輪詢觸發
- 兩者共用同一 alert_rules + pm_alert_history schema

### 13.5 Phase 3 範圍
- 4 比較模式:absolute / historical_avg / rate_of_change / **z-score**(都做)
- 4 動作:alert_history(必)+ Email + Webex + Webhook(都做)
- 訊息:模板字串(必)+ LLM 分析(必,可關)
- Cooldown / dedup:Redis 實作

---

## 13.X Phase 3.1 / 全網收集 — 2026-04-25 同日加碼完成

### 13.X.1 自動建 KB:`pmKnowledgeBaseSeed.js`

Server 啟動時 idempotent 建 3 個 KB(by name):
- `PM-新聞庫` — chunk_size 600,給日常新聞 RAG
- `PM-分析庫` — chunk_size 800,給日/週/月報沿革 RAG
- `PM-原始資料庫` — chunk_size 1000,給全網 raw scrape 資料(較長)

owner=admin、is_public=1、自動加 KB_CHUNKS partition。回傳 `Map<name,id>` 給 task seed。

### 13.X.2 全網收集任務:`buildMasterScrapeTask`

```
名稱:  [PM] 全網金屬資料收集
排程:  daily 06:00(早盤前)
模型:  Pro
prompt: 18 個 {{scrape:URL}}(11 金屬 commodity 頁 + Kitco / Westmetall /
        TradingEconomics / Mining.com / OilPrice / LME / Investing.com)
        LLM 整合 → 中文綜述 + JSON 落地段(每 source 一筆 ~10-18 items)
pipeline:
  [1] db_write → pm_news(URL hash unique,~10-18 筆)
  [2] kb_write → PM-原始資料庫(max_chunks_per_run=200)
  [3] generate_file → DOCX 全網綜述
```

防火牆未通的 source LLM 自動 skip,JSON 不放;summary 必繁中、content 可英中混。

### 13.X.3 Patch 既有任務:`patchExistingTaskKbIds`

掃 `[PM]%` 開頭任務,逐個 parse pipeline_json,kb_write 節點若 `kb_id` 空但 `kb_name` 對得到 kbMap → 自動填回。讓既有 paused 任務不用 admin 手動拖,KB 一建好就準備好。

### 13.X.4 Phase 3.1 獨立規則 scheduler

Schema:
- `alert_rules.schedule_interval_minutes` — > 0 才會被 scheduler 撈
- `alert_rules.last_evaluated_at` / `next_evaluate_at` / `last_eval_result`

Service [`alertRuleScheduler.js`](../server/services/alertRuleScheduler.js):
- node-cron `* * * * *` Asia/Taipei 每分鐘 tick
- 撈 active + bound_to=standalone + interval 已到的規則(top 100)
- 每條規則 Redis tryLock(`alert_rule_eval:{ruleId}:{minute}`,TTL 90s)避多 pod 重複
- 透過 `_inline_rule` 餵給 `pipelineAlerter.executeAlert`(no upstream JSON,context 帶 owner_user_id)
- 不論 triggered / skipped / error,都更新 next_evaluate_at = NOW + interval(避免 stuck)
- Redis 失敗時 fail-open(可能多發,cooldown 還是會擋實際通知)

UI [`AlertRuleEditor`](../client/src/components/admin/AlertRulesPanel.tsx) modal:
- 獨立規則 admin CRUD 端到端介面
- standalone 防呆:必填 schedule_interval_minutes;不允許 upstream_json
- 試跑流程:POST 暫存 rule → /test → DELETE 暫存(乾淨)
- AlertRulesPanel 表格加「輪詢」欄(每 N 分 + next_evaluate_at hover)+ ✏ 編輯按鈕

### 13.X.5 與 pipeline_node 規則的角色切割

| 面向 | pipeline_node 繫結 | standalone 獨立 |
|------|-------------------|-----------------|
| 觸發時機 | 排程任務跑完 LLM 主回應 + pipeline 後 | 背景 cron 每分鐘 tick |
| 資料源 | upstream_json(常用)/ sql_query / literal | sql_query(常用)/ literal |
| LLM 分析 | 適合(已在 LLM context 內) | 可用但不必,純 SQL 監控免燒 token |
| 評估頻率 | 跟著任務(daily / weekly / multi_time) | 任意分鐘級(min 1 分) |
| 適合場景 | 新聞情緒突變 / 日報關鍵發現 / 預測值偏離 | 高頻價格監控 / 資料新鮮度 / DB 健康度 |

---

## 14. Phase 4 待辦(本次不做,寫進規劃)

### 14.1 PM_BOM_METAL — What-if 模擬
**為何延後**:跟 ERP 整合複雜,需採購提供「產品代碼 → 金屬含量(克/kg)」mapping 資料,且要考慮替代料、合金成分變動等業務細節。

**未來實作**:
- Schema:`pm_bom_metal(product_code, metal_code, content_gram, content_source, valid_from, valid_to)`
- Skill:`pm_what_if_cost_impact` — 給定金屬漲跌幅 → 算各產品線毛利衝擊
- Pipeline:整合 ERP BOM 表 → 算 → LLM 解讀 → 產出 DOCX 成本分析報告
- 估工:5-8 天

### 14.2 Multi-Agent Workflow Skill
**為何延後**:需要 code skill 子行程,corp firewall 對 subprocess egress 限制嚴(已踩過坑)。

**未來實作**:用 Cortex Workflow Skill 設計 5 個 LLM 節點 DAG(News/Macro/Technical/Risk/Synthesizer)。先確認 firewall 後評估。

### 14.3 Python ML 預測模型
**為何延後**:同上 firewall 限制 + 模型訓練 / MLOps 是大工程。LLM 預測先頂著。

**未來實作**:Code Skill 包 Python 子服務(FastAPI + Darts/PyTorch Forecasting),搭配模型版本管理 + walk-forward 回測。

### 14.4 Webex Bot 行動端互動
**為何延後**:現在 alert 已會推 Webex,進階互動(按鈕、卡片、Adaptive Card)留 Phase 4。

### 14.5 cron_raw 自訂排程
**為何延後**:interval + multi_time 涵蓋 95% 需求,真有特殊需求(月底跑、跳過週末)再做。

---

## 15. 關鍵架構決策捕捉

| 決策 | 拍板日期 | 原因 |
|------|---------|------|
| db_write 走 pipeline_admin、kb_write 走既有 KB 權限 | 2026-04-25 | DB 動系統 schema、KB 是 user 自有資產 |
| forecast 表通用名 `forecast_history` | 2026-04-25 | 預測 Skill 設計時就要支援匯率/股票/需求等 |
| KB chunking 用混合策略(title+summary 一片 + 全文細片) | 2026-04-25 | RAG 召回精準度最佳 |
| KB dedupe 用 URL hash unique + title 軟比對 | 2026-04-25 | 防同 article 重複寫 + 改寫版本 |
| 排程模式擴 interval + multi_time(不做 cron_raw) | 2026-04-25 | 跨時區資料源需求 + UI 友善 |
| 不做 Webex Bot / Multi-Agent Workflow / Python ML | 2026-04-25 | corp firewall 限制 + 投資產出比 |
| 預測用 LLM(不上 ML 模型) | 2026-04-25 | 模型能力會持續變強,LLM 已能 70% 場景 |
| Dashboard 只做採購 + 主管 2 個 | 2026-04-25 | 過度設計避免 |
| 報表只做週 + 月(不做日 + 董事會) | 2026-04-25 | 日報用既有 markdown email 即可 |
| 新聞排程用 Flash、日報用 Pro | 2026-04-25 | per-article 量大 Flash 省、深度分析 Pro 強 |
| 新聞全文 + 摘要都存(不省 token) | 2026-04-25 | RAG 召回看全文,但 chunk_summary 為高權重 |

---

## 16. 排程任務清單(實作後完整列表)

| 任務名 | 模式 | 時段 | 主要 Pipeline 節點 |
|--------|------|------|------------------|
| `[PM] 每日金屬行情` | daily | 18:00 | scrape → db_write(pm_price_history)|
| `[PM] 每日金屬新聞` | multi_time | 09:00, 14:30 | fetch + scrape → Flash 摘要+情緒 → db_write(pm_news) + kb_write(PM-新聞庫) |
| `[PM] 每日總體經濟` | daily | 09:00 | fetch FRED / scrape → db_write(pm_macro_history) |
| `[PM] 每日金屬日報` | daily | 18:30 | RAG + Pro 分析 → forecast_timeseries_llm × 11 → db_write(forecast/analysis) + DOCX + kb_write(PM-分析庫) + email |
| `[PM] 每週市場回顧` | weekly | 週一 08:30 | 撈 7 天資料 → Pro 寫週報 → DOCX + kb_write |
| `[PM] 每月深度分析` | monthly | 1 號 10:00 | 撈 30 天 → Pro 寫月報 + ROI → DOCX + PPTX |

---

## 17. 知識庫清單(實作後完整列表)

| KB 名稱 | 用途 | 寫入方 | 讀取方 |
|---------|------|--------|--------|
| `PM-新聞庫` | 金屬相關新聞 RAG | `[PM] 每日金屬新聞` 排程的 kb_write | 對話 RAG / 日報 prompt |
| `PM-分析庫` | 過往日/週/月報精華 | 各分析排程的 kb_write | 對話 RAG「上次類似情境怎麼走」 |
| `PM-市場情境庫` | 歷史重大事件(手動)| Admin 手動上傳 | 預測 Skill 拉 context |

---

## 18. 文件變更檢核

實作完後要更新:
- [ ] `CLAUDE.md` 補 Pipeline 寫入機制 + 通用 forecast skill
- [ ] Help 系統(server/data/helpSeedData.js)補 kb_write 章節 + 排程彈性化操作
- [ ] AI 戰情 schema 註冊機制操作說明
- [ ] 規劃書 v2 對齊本 Phase 完成度

---

> **下一步**:本規劃書 commit 後,從 Week 1 D1 開始實作。
