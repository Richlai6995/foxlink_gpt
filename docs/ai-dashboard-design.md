# AI 戰情功能設計文件

> 版本：1.0 | 日期：2026-03-07 | 狀態：設計確認

---

## 1. 功能概述

AI 戰情是一個以自然語言驅動的 ERP 資料分析平台，整合以下核心能力：

- **Text-to-SQL**：用中文提問，自動生成 Oracle ERP 查詢 SQL
- **語意搜尋**：特定欄位（如異常回覆）向量化後可用語意搜尋找相似紀錄
- **ETL 排程**：定期從 Oracle ERP 撈取資料並向量化存入 Oracle 23 AI
- **圖表視覺化**：每個查詢設計可配置 ECharts 圖表（Power BI 色調）
- **查詢快取**：相同問題 hash 命中快取，不重複打 LLM

入口：頂端 navbar 新增 `[AI 戰情]` icon，以主題/任務兩層結構組織查詢設計。

---

## 2. 環境與連線

| 資源 | 設定 |
|------|------|
| Oracle ERP DB | `hqdb01-vip.foxlink.com.tw:1586/ebs_T365`，user: `apps` |
| Oracle 23 AI DB | `10.8.93.70:1526/AI`，user: `FLGPT` |
| Embedding 模型 | `gemini-embedding-001`（env: `KB_EMBEDDING_MODEL`）|
| 預設向量維度 | `768`（env: `KB_EMBEDDING_DIMS`，可選 768/1536/3072）|
| LLM（SQL 生成）| `gemini-3-pro-preview`，fallback `gemini-3-flash-preview` |

### Embedding 呼叫位置決策：Server-side

**結論**：ETL 排程由 Node.js server 呼叫 `gemini-embedding-001` API 取得向量，再透過 `oracledb` VECTOR bind 變數 INSERT 進 Oracle 23 AI。Oracle 23 AI 負責儲存與 `VECTOR_DISTANCE()` 搜尋，不負責生成 embedding。

**理由**：
1. `gemini-embedding-001` 對繁體中文效果優於 Oracle DBMS_VECTOR_CHAIN 支援的模型
2. ETL 前可在 Node.js 層做資料清洗（去除特殊碼、欄位合併）
3. 避免 Oracle ACL 外部 REST 設定複雜度與授權風險
4. ETL log 在 server 層完整記錄，可除錯

---

## 3. 資料庫 Schema 設計

### 3.1 主系統 DB（Oracle 23 AI / FLGPT schema）

以下 table 建在 `FLGPT` schema（Oracle 23 AI）。

#### `AI_SCHEMA_DEFINITIONS` — Table schema 知識庫

```sql
CREATE TABLE FLGPT.AI_SCHEMA_DEFINITIONS (
  ID            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  TABLE_NAME    VARCHAR2(100)  NOT NULL,          -- e.g. APPS.WO_ABNORMAL_V
  DISPLAY_NAME  VARCHAR2(200),                    -- 中文顯示名稱
  DB_CONNECTION VARCHAR2(20) DEFAULT 'erp',       -- erp / system
  BUSINESS_NOTES CLOB,                            -- 商業邏輯、JOIN 注意事項（純文字）
  JOIN_HINTS    CLOB,                             -- JSON: 常用 JOIN 關係
  IS_ACTIVE     NUMBER(1) DEFAULT 1,
  CREATED_BY    NUMBER,
  UPDATED_AT    TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

#### `AI_SCHEMA_COLUMNS` — 欄位 metadata

```sql
CREATE TABLE FLGPT.AI_SCHEMA_COLUMNS (
  ID              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  SCHEMA_ID       NUMBER REFERENCES FLGPT.AI_SCHEMA_DEFINITIONS(ID),
  COLUMN_NAME     VARCHAR2(100) NOT NULL,
  DATA_TYPE       VARCHAR2(50),
  DESCRIPTION     VARCHAR2(500),                 -- 語意說明（LLM 理解用）
  IS_VECTORIZED   NUMBER(1) DEFAULT 0,           -- 此欄位需向量化
  VALUE_MAPPING   CLOB,                          -- JSON: {"01":"待審核","02":"完成"}
  SAMPLE_VALUES   CLOB,                          -- JSON array: 範例值
  VECTOR_TABLE_REF VARCHAR2(100)                 -- 對應的 vector table
);
```

#### `AI_SELECT_TOPICS` — 查詢主題（第一層）

```sql
CREATE TABLE FLGPT.AI_SELECT_TOPICS (
  ID          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  NAME        VARCHAR2(100) NOT NULL,             -- e.g. "異常分析"
  DESCRIPTION VARCHAR2(500),
  ICON        VARCHAR2(50),                       -- e.g. "alert-triangle"
  SORT_ORDER  NUMBER DEFAULT 0,
  IS_ACTIVE   NUMBER(1) DEFAULT 1,
  CREATED_BY  NUMBER,
  CREATED_AT  TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

#### `AI_SELECT_DESIGNS` — 查詢任務（第二層，掛在主題下）

```sql
CREATE TABLE FLGPT.AI_SELECT_DESIGNS (
  ID                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  TOPIC_ID              NUMBER REFERENCES FLGPT.AI_SELECT_TOPICS(ID),
  NAME                  VARCHAR2(100) NOT NULL,   -- e.g. "異常數量統計"
  DESCRIPTION           VARCHAR2(500),
  TARGET_SCHEMA_IDS     CLOB,                    -- JSON array of schema IDs
  VECTOR_SEARCH_ENABLED NUMBER(1) DEFAULT 0,     -- 是否啟用語意向量搜尋
  SYSTEM_PROMPT         CLOB,                    -- 可調整的 SQL 生成 prompt
  FEW_SHOT_EXAMPLES     CLOB,                    -- JSON: [{q:"...", sql:"..."}]
  CHART_CONFIG          CLOB,                    -- JSON: 圖表設定（見下方）
  CACHE_TTL_MINUTES     NUMBER DEFAULT 30,
  IS_PUBLIC             NUMBER(1) DEFAULT 0,     -- 公開給 can_use_ai_dashboard 用戶
  CREATED_BY            NUMBER,
  UPDATED_AT            TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

#### `AI_ETL_JOBS` — ETL 排程設定

```sql
CREATE TABLE FLGPT.AI_ETL_JOBS (
  ID                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  NAME                VARCHAR2(100) NOT NULL,
  SOURCE_SQL          CLOB NOT NULL,              -- Oracle ERP 撈取 SQL，支援 :last_run 綁定
  SOURCE_CONNECTION   VARCHAR2(20) DEFAULT 'erp',
  VECTORIZE_FIELDS    CLOB,                      -- JSON: ["ABNORMAL_REPLY","PLAN_NAME"]
  METADATA_FIELDS     CLOB,                      -- JSON: 帶入 metadata 的其他欄位
  EMBEDDING_DIMENSION NUMBER DEFAULT 768,        -- 768/1536/3072
  VECTOR_TABLE        VARCHAR2(100) DEFAULT 'FLGPT.AI_VECTOR_STORE',
  CRON_EXPRESSION     VARCHAR2(50),              -- e.g. "0 2 * * *"
  IS_INCREMENTAL      NUMBER(1) DEFAULT 1,       -- 1=增量(使用:last_run), 0=全量
  LAST_RUN_AT         TIMESTAMP,
  STATUS              VARCHAR2(20) DEFAULT 'active', -- active/paused
  CREATED_BY          NUMBER,
  CREATED_AT          TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

#### `AI_ETL_RUN_LOGS` — ETL 執行紀錄

```sql
CREATE TABLE FLGPT.AI_ETL_RUN_LOGS (
  ID               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  JOB_ID           NUMBER REFERENCES FLGPT.AI_ETL_JOBS(ID),
  STARTED_AT       TIMESTAMP,
  FINISHED_AT      TIMESTAMP,
  ROWS_FETCHED     NUMBER DEFAULT 0,
  ROWS_VECTORIZED  NUMBER DEFAULT 0,
  ERROR_MESSAGE    CLOB,
  STATUS           VARCHAR2(20)  -- success/partial/failed
);
```

#### `AI_VECTOR_STORE` — 向量儲存（Oracle 23 AI 原生 VECTOR 型別）

```sql
CREATE TABLE FLGPT.AI_VECTOR_STORE (
  ID           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ETL_JOB_ID   NUMBER REFERENCES FLGPT.AI_ETL_JOBS(ID),
  SOURCE_TABLE VARCHAR2(100),           -- 來源資料表
  SOURCE_PK    VARCHAR2(500),           -- 來源 PK（JSON 存複合鍵）
  FIELD_NAME   VARCHAR2(100),           -- 向量化的欄位名
  FIELD_VALUE  CLOB,                    -- 原始文字內容
  METADATA     CLOB,                    -- JSON: 其他欄位值（用於過濾/顯示）
  EMBEDDING    VECTOR(768, FLOAT32),    -- 維度依 job 設定
  CREATED_AT   TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 向量搜尋 index
CREATE VECTOR INDEX AI_VECTOR_IDX ON FLGPT.AI_VECTOR_STORE(EMBEDDING)
  ORGANIZATION NEIGHBOR PARTITIONS
  WITH DISTANCE COSINE;
```

#### `AI_QUERY_CACHE` — 查詢快取

```sql
CREATE TABLE FLGPT.AI_QUERY_CACHE (
  ID              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  DESIGN_ID       NUMBER REFERENCES FLGPT.AI_SELECT_DESIGNS(ID),
  QUESTION_HASH   VARCHAR2(64) NOT NULL,          -- SHA256(question)
  GENERATED_SQL   CLOB,
  RESULT_JSON     CLOB,                           -- 查詢結果 JSON
  ROW_COUNT       NUMBER,
  CREATED_AT      TIMESTAMP DEFAULT SYSTIMESTAMP,
  EXPIRES_AT      TIMESTAMP,
  CONSTRAINT AI_QUERY_CACHE_UQ UNIQUE (DESIGN_ID, QUESTION_HASH)
);
```

#### 用戶權限新增欄位

```sql
ALTER TABLE FLGPT.USERS ADD CAN_DESIGN_AI_SELECT NUMBER(1) DEFAULT 0;
ALTER TABLE FLGPT.USERS ADD CAN_USE_AI_DASHBOARD  NUMBER(1) DEFAULT 0;
```

---

## 4. AI 查詢 Pipeline

```
用戶輸入自然語言問題
        │
        ▼
[1. Cache 查詢]
  SHA256(question) → AI_QUERY_CACHE
  命中 & 未過期 → 直接回傳結果
        │ 未命中
        ▼
[2. 向量語意搜尋]（若 design.vector_search_enabled=1）
  呼叫 Gemini embedding-001 生成 query 向量
  SELECT source_pk, field_value, metadata
  FROM FLGPT.AI_VECTOR_STORE
  WHERE etl_job_id = ?
  ORDER BY VECTOR_DISTANCE(embedding, :query_vec, COSINE)
  FETCH FIRST 10 ROWS ONLY
        │
        ▼
[3. 組裝 Prompt]
  = design.system_prompt
  + schema 定義（TABLE_NAME + COLUMN descriptions + VALUE_MAPPING）
  + business_notes + join_hints
  + 向量搜尋結果（語意上下文，標記為 [相似案例]）
  + few_shot_examples
  + "用戶問題：{question}"
        │
        ▼
[4. Gemini 生成 SQL]
  模型：gemini-3-pro-preview
        │
        ▼
[5. SQL 安全審查]
  - 只允許 SELECT（禁止 INSERT/UPDATE/DELETE/DDL）
  - 禁止 DBMS_* / UTL_* 呼叫
  - 禁止 /* comment */ 注入
  - 校驗失敗 → 回傳錯誤，不執行
        │
        ▼
[6. 執行 Oracle ERP 查詢]
  oracledb 連線 ERP（apps@ebs_T365）
  設定 fetchArraySize=100, queryTimeout=30s
        │
        ▼
[7. 結果格式化]
  回傳 { sql, rows, columns, chart_config, row_count }
        │
        ▼
[8. 寫入 Cache]
  expires_at = now + design.cache_ttl_minutes
        │
        ▼
[9. SSE 推送前端]
  event: sql_preview → 給 can_design_ai_select 用戶
  event: result     → 查詢結果
  event: done
```

---

## 5. 圖表設定規格（chart_config JSON）

**圖表框架選擇：ECharts (echarts-for-react)**

理由：原生漸層、陰影、動畫支援完整，最接近 Power BI 視覺效果。

**Power BI 配色（標準色票）：**

```js
const PBI_PALETTE = [
  '#118DFF', '#12239E', '#E66C37', '#6B007B',
  '#E044A7', '#744EC2', '#D9B300', '#D64550'
]
```

**chart_config 結構：**

```json
{
  "default_chart": "bar",
  "allow_table": true,
  "allow_export": true,
  "charts": [
    {
      "type": "bar",
      "title": "計畫異常數量",
      "x_field": "PLAN_NAME",
      "y_field": "CNT",
      "gradient": true,
      "show_label": true
    },
    {
      "type": "line",
      "title": "異常趨勢",
      "x_field": "DATE_STR",
      "y_field": "CNT",
      "smooth": true,
      "area": true
    },
    {
      "type": "pie",
      "title": "異常類別分佈",
      "label_field": "CATEGORY",
      "value_field": "TOTAL",
      "donut": true
    },
    {
      "type": "bar",
      "title": "橫向排名",
      "x_field": "CNT",
      "y_field": "PART_NO",
      "horizontal": true
    }
  ]
}
```

支援圖表類型：`bar`、`line`、`pie`、`scatter`、`radar`、`gauge`

---

## 6. SQL 可見度設計

| 用戶類型 | SQL 可見 | SQL 可修改 | Prompt tokens | 快取狀態 |
|---------|---------|-----------|---------------|---------|
| 一般用戶（`can_use_ai_dashboard`）| ❌ | ❌ | ❌ | ❌ |
| 設計者/Admin（`can_design_ai_select`）| ✅ readonly | ❌ | ✅ | ✅ |

設計者在查詢結果頁可展開 **[開發模式] panel**，顯示：
- 生成的 SQL（readonly code block，可 copy）
- 向量搜尋命中的相似案例（top 10）
- Prompt 使用 token 數
- SQL 執行時間（ms）
- Cache 命中 / Miss 狀態

調整 Prompt 的入口在「設計介面」的 `system_prompt` 欄位 + `few_shot_examples`，不是在查詢頁直接改 SQL。

---

## 7. 角色權限

```
admin（系統管理員）
  ├── can_design_ai_select = 1（預設）
  ├── can_use_ai_dashboard = 1（預設）
  └── 可在後台編輯所有用戶的以上兩個 flag

user（一般使用者）
  ├── can_design_ai_select = 0（預設，管理員手動開啟）
  └── can_use_ai_dashboard = 0（預設，管理員手動開啟）
```

---

## 8. 前端 UI 結構

```
頂部 Navbar
└── [AI 戰情] icon → /dashboard

/dashboard（需 can_use_ai_dashboard）
├── 左側欄：主題/任務樹狀選單
│   ├── 📊 異常分析
│   │   ├── 異常數量統計
│   │   ├── 異常語意搜尋   ← 含向量搜尋徽章
│   │   └── 趨勢分析
│   ├── 📦 交期查詢
│   │   ├── 逾期訂單
│   │   └── 交期預測
│   └── ➕ 新增主題（設計者/admin 可見）
│
├── 主區域：查詢介面
│   ├── 自然語言輸入框（含送出按鈕）
│   ├── [開發模式] toggle（設計者/admin 可見）
│   │   ├── 生成 SQL（readonly）
│   │   ├── 語意相似案例
│   │   └── Token / 執行時間 / Cache 狀態
│   └── 結果區
│       ├── 圖表切換 tab（bar / line / pie / table）
│       └── ECharts 圖表（Power BI 色調 + 漸層）
│
└── 匯出按鈕：Excel / CSV / 圖表 PNG

/dashboard/designer（需 can_design_ai_select）
├── Schema 知識庫管理
│   ├── 新增/編輯 Table Schema
│   ├── 欄位 metadata 設定（is_vectorized / value_mapping）
│   └── business_notes / join_hints 編輯
│
├── AI SELECT 設計管理
│   ├── 主題 CRUD
│   ├── 任務 CRUD（含 system_prompt + few-shot 編輯器）
│   └── 圖表設定 JSON 編輯器（含預覽）
│
└── ETL 排程管理
    ├── 新增/編輯 ETL Job（source_sql / 向量化欄位）
    ├── 立即執行 / 暫停
    └── 執行紀錄 Log 查看
```

---

## 9. 後端 API 路由規劃

```
/api/dashboard
├── GET  /topics                          → 取得主題+任務清單
├── POST /query                           → 執行 AI 查詢（SSE streaming）
│   Body: { design_id, question }
│
├── GET  /designer/schemas                → Schema 知識庫清單
├── POST /designer/schemas                → 新增 Schema
├── PUT  /designer/schemas/:id            → 更新 Schema
├── DEL  /designer/schemas/:id            → 刪除 Schema
│
├── GET  /designer/topics                 → 主題清單（含任務）
├── POST /designer/topics                 → 新增主題
├── PUT  /designer/topics/:id             → 更新主題
├── DEL  /designer/topics/:id             → 刪除主題
│
├── POST /designer/designs                → 新增任務
├── PUT  /designer/designs/:id            → 更新任務
├── DEL  /designer/designs/:id            → 刪除任務
│
├── GET  /etl/jobs                        → ETL Job 清單
├── POST /etl/jobs                        → 新增 ETL Job
├── PUT  /etl/jobs/:id                    → 更新 ETL Job
├── DEL  /etl/jobs/:id                    → 刪除 ETL Job
├── POST /etl/jobs/:id/run                → 立即執行
└── GET  /etl/jobs/:id/logs               → 執行紀錄
```

---

## 10. 實作順序

### Phase 1 — 後端基礎（DB + API 骨架）
- [ ] Oracle 23 AI schema 建立（DDL 腳本）
- [ ] `server/routes/dashboard.js` API 路由骨架
- [ ] 用戶表新增 `can_design_ai_select` / `can_use_ai_dashboard` 欄位及後台 UI

### Phase 2 — 知識庫 + ETL
- [ ] Schema 知識庫 CRUD API + 前端管理介面
- [ ] ETL Job 設計 + `node-cron` 整合
- [ ] Gemini embedding 呼叫 → Oracle 23 AI VECTOR INSERT

### Phase 3 — AI SELECT Pipeline
- [ ] `server/services/dashboardService.js`
  - 向量搜尋（Oracle VECTOR_DISTANCE）
  - Text-to-SQL（Gemini + schema context 組裝）
  - SQL 安全審查
  - Oracle ERP 執行
  - 快取讀寫（AI_QUERY_CACHE）
- [ ] SSE streaming 回傳

### Phase 4 — 前端
- [ ] 安裝 `echarts-for-react`
- [ ] 頂部 navbar AI 戰情入口
- [ ] 主題/任務側欄
- [ ] 查詢介面 + ECharts 圖表（Power BI 色調）
- [ ] 設計者管理介面（Schema / 任務 / ETL）
- [ ] 開發模式 panel（SQL 預覽 / token / cache）

---

## 11. 新增 .env 設定

```env
# AI 戰情
DASHBOARD_EMBEDDING_MODEL=gemini-embedding-001
DASHBOARD_EMBEDDING_DIMS=768           # 768/1536/3072
DASHBOARD_SQL_TIMEOUT_SEC=30
DASHBOARD_MAX_ROWS=500
DASHBOARD_VECTOR_TOP_K=10
```
