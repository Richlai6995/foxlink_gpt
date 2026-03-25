# 多資料來源支援計畫 — Oracle / MySQL / MS SQL

> 初版日期：2026-03-17
> 更新日期：2026-03-25
> 狀態：**規劃中，尚未實作**

---

## 背景

目前 AI 戰情的資料查詢目標固定為單一 Oracle ERP DB（由 `.env` 設定）。
未來需要支援多個資料來源（Oracle / MySQL / MS SQL），讓 Schema 設計時可選擇不同的 DB 連線。

---

## 系統兩層 DB 概念

```
Layer 1: 系統 DB（Oracle 23 AI）
  → 存 users, chat_sessions, ai_schema_definitions, ai_vector_store 等系統 metadata
  → 不動，永遠是 Oracle 23 AI
  → 向量搜尋（VECTOR_DISTANCE）永遠在這層執行

Layer 2: 資料查詢 DB（目前只有 Oracle ERP）
  → AI 戰情 schema 查詢的目標 DB
  → 這層是本計畫要改成多來源的部分
  → 支援 Oracle / MySQL / MS SQL
```

改動只涉及 Layer 2，Layer 1 完全不動。

---

## 向量搜尋策略

MySQL / MSSQL 沒有原生向量型別（MySQL 9.0 以下、MSSQL 全版本），因此：

- **向量庫（ai_vector_store）永遠在 Layer 1 Oracle 23 AI**
- ETL 跨 DB 流程：`MySQL/MSSQL (source_sql)` → 取資料 → Gemini embedding → `Oracle ai_vector_store`
- Layer 2 adapter 不需要實作 `vectorSearch()`

---

## Adapter 架構

### 目錄結構

```
server/services/dbAdapters/
├── base.js             → 抽象基底類（介面定義 + 共用邏輯）
├── oracleAdapter.js    → 現有 ERP 邏輯抽出
├── mysqlAdapter.js     → 新寫（npm: mysql2）
└── mssqlAdapter.js     → 新寫（npm: mssql/tedious）
```

### Adapter 完整介面

```javascript
class BaseDbAdapter {
  // ── 連線管理 ──
  async createPool(config) {}           // 建立連線池
  async getConnection(pool) {}          // 取得 ReadOnlyProxy 包裝連線
  async releaseConnection(conn) {}      // 釋放連線
  async closePool(pool) {}              // 關閉連線池
  async ping(config) {}                 // 測試連線

  // ── SQL 執行 ──
  async execute(conn, sql, binds, opts) {}
  //   opts: { maxRows, timeout }
  //   回傳: { rows: Object[], columns: string[] }

  // ── DB 方言元資訊 ──
  get dialect() {}                      // 'oracle' | 'mysql' | 'mssql'
  get defaultPort() {}                  // 1521 | 3306 | 1433
  get maxInClauseSize() {}              // Oracle: 999, MySQL: 65535, MSSQL: 2100
  get bindSyntax() {}                   // ':name' | '?' | '@name'

  // ── SQL 安全驗證 ──
  getReadOnlyValidator() {}             // 回傳 assertReadOnly(sql) 函數
  getForbiddenPatterns() {}             // 回傳 RegExp（禁止的 DML/DDL/危險語法）

  // ── AI Prompt 方言注入 ──
  getDialectPrompt() {}                 // 回傳 { expertTitle, rules, forbidden }

  // ── 正規化 ──
  normalizeRows(rawRows) {}             // 統一輸出格式（欄位小寫、Date→ISO 等）
  normalizeBinds(sql, namedBinds) {}    // :param → 目標語法轉換
}
```

### Bind Variable 轉換

存入 DB 的 `source_sql` 統一用 `:name` 語法（Oracle 風格），adapter 自動轉成目標語法：

| DB | 原生語法 | 轉換範例 |
|---|---|---|
| Oracle | `:name` | 不轉換 |
| MySQL | `?`（位置） | `:last_run` → `?`，binds 轉為 Array |
| MSSQL | `@name` | `:last_run` → `@last_run` |

```javascript
// mysqlAdapter.normalizeBinds()
normalizeBinds(sql, namedBinds) {
  const values = [];
  const converted = sql.replace(/:(\w+)/g, (_, name) => {
    values.push(namedBinds[name]);
    return '?';
  });
  return { sql: converted, binds: values };
}

// mssqlAdapter.normalizeBinds()
normalizeBinds(sql, namedBinds) {
  const converted = sql.replace(/:(\w+)/g, (_, name) => `@${name}`);
  return { sql: converted, binds: namedBinds };  // mssql 套件接受 {name: value}
}
```

---

## SQL 安全驗證（per Dialect）

### 共用規則

所有 adapter 都必須：
- 只允許 `SELECT` 開頭
- 移除註解後再驗證（防止 `--` / `/* */` 繞過）
- 禁止多語句（`;` 後接 SQL）
- 禁止 `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`, `ALTER`, `TRUNCATE`, `MERGE`

### 各 DB 額外封鎖

| 類別 | Oracle（現有） | MySQL（新增） | MSSQL（新增） |
|---|---|---|---|
| 系統命令 | `EXECUTE IMMEDIATE` | `LOAD DATA`, `INTO OUTFILE`, `INTO DUMPFILE` | `EXEC`, `EXECUTE`, `xp_cmdshell`, `sp_` |
| 危險函數 | — | `SLEEP()`, `BENCHMARK()` | `WAITFOR DELAY`, `OPENROWSET`, `OPENDATASOURCE` |
| 鎖定 | `FOR UPDATE` | `LOCK TABLES`, `FOR UPDATE` | `WITH (UPDLOCK)`, `WITH (XLOCK)`, `HOLDLOCK` |
| 寫入變體 | — | `REPLACE INTO` | `OUTPUT INSERTED` |
| 變數 | — | `SET @`, `SET @@` | `DECLARE`, `SET @` |
| 資料庫切換 | — | `USE` | `USE` |

---

## AI Prompt 方言注入

### 各 Adapter 回傳的 Prompt

```javascript
// oracleAdapter.getDialectPrompt()
{
  expertTitle: 'Oracle SQL 專家',
  rules: [
    '用 NVL() 或 COALESCE() 處理 NULL',
    '用 FETCH FIRST N ROWS ONLY 限制筆數',
    '日期函數用 TO_DATE() / TO_CHAR()',
    '字串串接用 ||',
    '條件表達式用 CASE WHEN 或 DECODE()',
    '目前時間用 SYSDATE 或 SYSTIMESTAMP',
  ],
  forbidden: [
    'LIMIT（MySQL 語法）',
    'TOP（MSSQL 語法）',
    'IFNULL（MySQL 語法）',
    'ISNULL（MSSQL 語法）',
    'NOW()（MySQL 語法）',
    'GETDATE()（MSSQL 語法）',
  ],
}

// mysqlAdapter.getDialectPrompt()
{
  expertTitle: 'MySQL 8.0 SQL 專家',
  rules: [
    '用 IFNULL() 或 COALESCE() 處理 NULL',
    '用 LIMIT N 限制筆數',
    '日期函數用 DATE_FORMAT() / STR_TO_DATE()',
    '字串串接用 CONCAT()',
    '條件表達式用 CASE WHEN 或 IF()',
    '目前時間用 NOW() 或 CURRENT_TIMESTAMP',
    '欄位名稱用反引號 ` 包裹（若為保留字）',
  ],
  forbidden: [
    'NVL（Oracle 語法）',
    'ROWNUM（Oracle 語法）',
    'FETCH FIRST（Oracle 語法）',
    'DECODE（Oracle 語法）',
    'TO_DATE / TO_CHAR（Oracle 語法）',
    'SYSTIMESTAMP（Oracle 語法）',
    'TOP（MSSQL 語法）',
    'ISNULL（MSSQL 語法）',
    '||（Oracle 字串串接，MySQL 中為 OR）',
  ],
}

// mssqlAdapter.getDialectPrompt()
{
  expertTitle: 'Microsoft SQL Server T-SQL 專家',
  rules: [
    '用 ISNULL() 或 COALESCE() 處理 NULL',
    '用 TOP N 或 OFFSET/FETCH NEXT 限制筆數',
    '日期函數用 CONVERT() / FORMAT()',
    '字串串接用 + 或 CONCAT()',
    '條件表達式用 CASE WHEN',
    '目前時間用 GETDATE() 或 SYSDATETIME()',
    '欄位名稱用方括號 [] 包裹（若為保留字）',
  ],
  forbidden: [
    'NVL（Oracle 語法）',
    'ROWNUM（Oracle 語法）',
    'DECODE（Oracle 語法）',
    'TO_DATE / TO_CHAR（Oracle 語法）',
    'LIMIT（MySQL 語法）',
    'IFNULL（MySQL 語法）',
    'NOW()（MySQL 語法）',
    '||（Oracle 字串串接，MSSQL 中無此用法）',
  ],
}
```

### `buildPrompt()` 改動

```javascript
// dashboardService.js — buildPrompt() 注入方言
function buildPrompt(design, schemas, ..., dbAdapter) {
  const dialect = dbAdapter.getDialectPrompt();

  const systemPrompt =
    `你是${dialect.expertTitle}，根據以下資料表定義生成 SELECT 查詢。\n` +
    `\n## 語法規則\n${dialect.rules.map(r => `- ${r}`).join('\n')}\n` +
    `\n## 禁止使用的語法（會造成執行錯誤）\n${dialect.forbidden.map(f => `- ❌ ${f}`).join('\n')}\n` +
    `\n## 安全規則\n- 只能生成 SELECT\n- 禁止 INSERT/UPDATE/DELETE/DROP\n- 禁止子查詢中的寫入操作\n`;

  // ...其餘 schema/join/few-shot 邏輯不變
}
```

---

## `ai_db_sources` 資料表

```sql
CREATE TABLE ai_db_sources (
  id             NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           VARCHAR2(100) NOT NULL,        -- 顯示名稱 e.g. "ERP Oracle", "BI MySQL"
  db_type        VARCHAR2(20) NOT NULL,          -- 'oracle' | 'mysql' | 'mssql'
  host           VARCHAR2(200) NOT NULL,
  port           NUMBER,                         -- 預設依 db_type: 1521/3306/1433
  -- Oracle 專用
  service_name   VARCHAR2(100),                  -- Oracle service name
  -- MySQL / MSSQL 專用
  database_name  VARCHAR2(100),                  -- 目標資料庫名稱
  schema_name    VARCHAR2(100),                  -- MySQL: 同 database; MSSQL: 'dbo'; Oracle: username
  -- 通用
  username       VARCHAR2(100),
  password_enc   CLOB,                           -- AES-256 加密（禁止明文！）
  is_default     NUMBER(1) DEFAULT 0,            -- 1 = env 預設的 ERP DB（migration 自動建立）
  is_active      NUMBER(1) DEFAULT 1,
  -- 連線池設定
  pool_min       NUMBER DEFAULT 1,
  pool_max       NUMBER DEFAULT 5,
  pool_timeout   NUMBER DEFAULT 60,
  -- SSL
  ssl_enabled    NUMBER(1) DEFAULT 0,
  ssl_ca_cert    CLOB,
  -- 狀態
  last_ping_at   TIMESTAMP,
  last_ping_ok   NUMBER(1),
  created_at     TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at     TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

### Migration 策略

1. 建立 `ai_db_sources` 表
2. 自動插入一筆 `is_default=1` 記錄（從 `.env` 的 `ERP_DB_*` 讀取）
3. `ai_schema_definitions` 新增 `source_db_id NUMBER`
4. 將所有 `db_connection = 'erp'` 的 schema 更新為 `source_db_id = (SELECT id FROM ai_db_sources WHERE is_default=1)`
5. `ai_etl_jobs.source_connection` 同理轉為 `source_db_id`

---

## `buildInChunks()` 的 IN 子句限制

| DB | 限制 | 原因 |
|---|---|---|
| Oracle | 999 個元素 | ORA-01795 |
| MySQL | 無硬性限制 | 受 `max_allowed_packet` 影響，建議 10000 |
| MSSQL | 2100 個參數 | 參數上限 |

```javascript
// dashboardService.js 改用 adapter 提供的值
function buildInChunks(colRef, values, adapter) {
  const chunkSize = adapter.maxInClauseSize;
  // ...分塊邏輯不變
}
```

---

## NPM 套件

| DB | 套件 | Docker 額外需求 | 連線池 |
|---|---|---|---|
| Oracle | `oracledb`（已安裝） | Oracle Instant Client（已設定） | 內建 `createPool()` |
| MySQL | `mysql2` | 無（純 JS） | 內建 `createPool()` |
| MSSQL | `mssql`（底層 `tedious`） | 無（純 JS） | 內建 `ConnectionPool` |

MySQL 和 MSSQL 都是純 JS 實作，**不需要改 Dockerfile**。

---

## ReadOnly 安全架構（每種 DB）

現有的 `ReadOnlyConnectionProxy` / `ReadOnlyPoolProxy` 模式適用於所有 DB，只需：

1. 每種 adapter 實作自己的 Proxy class
2. 封鎖寫入方法（`commit`, `rollback`, `executeMany` 等）
3. 所有 `execute()` 先過 `assertReadOnly(sql)` 再執行

```javascript
// 每種 adapter 的 ReadOnly Proxy 都遵循同一模式
class ReadOnlyMysqlProxy {
  #conn
  constructor(conn) { this.#conn = conn; }

  async execute(sql, binds) {
    mysqlAdapter.assertReadOnly(sql);  // 驗證
    return this.#conn.execute(sql, binds);
  }

  // ❌ 封鎖
  async beginTransaction() { throw new Error('[MySQL 唯讀保護] 禁止 beginTransaction'); }
  async commit()           { throw new Error('[MySQL 唯讀保護] 禁止 commit'); }
  // ...
}
```

---

## 資料型別對應

AI 生成 SQL 時不太受影響（Gemini 已知各 DB 型別），但 `ai_schema_columns.data_type` 儲存的值會不同：

| 概念 | Oracle | MySQL | MSSQL |
|---|---|---|---|
| 整數 | `NUMBER` | `INT`, `BIGINT` | `INT`, `BIGINT` |
| 小數 | `NUMBER(p,s)` | `DECIMAL(p,s)` | `DECIMAL(p,s)` |
| 短字串 | `VARCHAR2(n)` | `VARCHAR(n)` | `NVARCHAR(n)` |
| 長文本 | `CLOB` | `TEXT`, `LONGTEXT` | `NVARCHAR(MAX)` |
| 日期 | `DATE` | `DATE`, `DATETIME` | `DATE`, `DATETIME2` |
| 時間戳 | `TIMESTAMP` | `TIMESTAMP`, `DATETIME` | `DATETIME2`, `DATETIMEOFFSET` |
| 布林 | `NUMBER(1)` | `TINYINT(1)`, `BOOLEAN` | `BIT` |

前端 Schema 設計時，data_type 欄位應顯示該 DB 的原生型別名稱（從 adapter 提供）。

---

## 實作分階段

### Phase 1 — Adapter 基礎架構 + 多 Oracle（~2 天）

| 項目 | 說明 |
|---|---|
| `server/services/dbAdapters/base.js` | 抽象基底類，定義完整介面 |
| `server/services/dbAdapters/oracleAdapter.js` | 現有 `getErpPool()` + `ReadOnlyConnectionProxy` 抽出 |
| `ai_db_sources` 表 | migration + 自動插入 env 預設 |
| `server/routes/dbSources.js` | CRUD API + 測試連線 + 密碼加密 |
| `dashboardService.js` 改造 | `getErpPool()` → `getPoolBySourceId(id)` + adapter 分派 |
| 前端 DB 管理頁 | 新增/編輯/刪除/測試連線 |
| 前端 Schema 表單 | `db_connection` → `source_db_id` 下拉 |

### Phase 2 — MySQL Adapter（~3-4 天）

| 項目 | 說明 |
|---|---|
| `npm install mysql2` | 安裝套件 |
| `dbAdapters/mysqlAdapter.js` | 完整 adapter 實作 |
| MySQL ReadOnly Proxy | 封鎖寫入 + MySQL 專屬危險語法 |
| bind variable 轉換 | `:name` → `?` 位置參數 |
| MySQL 方言 prompt | `getDialectPrompt()` 回傳 MySQL 規則 |
| `buildPrompt()` 改造 | 注入 adapter 方言（此處改一次，後續 DB 自動適用） |
| 整合測試 | schema 定義 → AI 生成 MySQL SQL → 執行 → 結果回傳 |

### Phase 3 — MSSQL Adapter（~3-4 天）

| 項目 | 說明 |
|---|---|
| `npm install mssql` | 安裝套件 |
| `dbAdapters/mssqlAdapter.js` | 完整 adapter 實作 |
| MSSQL ReadOnly Proxy | 封鎖寫入 + T-SQL 專屬危險語法 |
| bind variable 轉換 | `:name` → `@name` |
| T-SQL 方言 prompt | `getDialectPrompt()` 回傳 MSSQL 規則 |
| 整合測試 | schema 定義 → AI 生成 T-SQL → 執行 → 結果回傳 |

### Phase 4 — ETL 跨 DB 支援（~2 天）

| 項目 | 說明 |
|---|---|
| `ai_etl_jobs.source_db_id` | 替代 `source_connection` 字串 |
| ETL `runEtlJob()` 改造 | 用 adapter 取得 source 連線 |
| 跨 DB ETL 流程 | MySQL/MSSQL source → Gemini embedding → Oracle ai_vector_store |
| bind variable 轉換 | ETL source_sql 的 `:last_run` 自動轉換 |

### 總計工時估算

| Phase | 工時 | 累計 |
|---|---|---|
| Phase 1: Adapter 架構 + 多 Oracle | 2 天 | 2 天 |
| Phase 2: MySQL | 3-4 天 | 5-6 天 |
| Phase 3: MSSQL | 3-4 天 | 8-10 天 |
| Phase 4: ETL 跨 DB | 2 天 | 10-12 天 |

---

## 現有程式碼影響範圍

### `dashboardService.js`（最大改動）

| 功能 | 目前狀態 | 需要改的部分 |
|---|---|---|
| `getErpPool()` | 單一 Oracle pool | → `getPoolBySourceId(id)` + adapter dispatch |
| `ReadOnlyConnectionProxy` | Oracle 專用 | → 移至 `oracleAdapter.js`，各 adapter 各自實作 |
| `assertErpReadOnly()` | 共用正則 | → 各 adapter 擴充自己的黑名單 |
| `buildPrompt()` | 硬編碼 Oracle 語法規則 | → 從 adapter 動態注入 |
| `buildInChunks()` | 硬編碼 999 | → 從 adapter 取 `maxInClauseSize` |
| `runEtlJob()` | 用 ERP pool | → 用 `source_db_id` 對應 adapter |

### `database-oracle.js`

| 功能 | 改動 |
|---|---|
| migration | 新增 `ai_db_sources` 表 |
| migration | `ai_schema_definitions` 加 `source_db_id` 欄位 |
| migration | `ai_etl_jobs` 加 `source_db_id` 欄位 |

### `server/routes/dashboard.js`

| 功能 | 改動 |
|---|---|
| schema CRUD | 處理 `source_db_id` 欄位 |
| 查詢路由 | 從 design → schema → `source_db_id` 取得 adapter |

### 前端

| 元件 | 改動 |
|---|---|
| 管理頁新增 | DB 來源管理（CRUD + 測試連線） |
| Schema 編輯表單 | `db_connection` 改為 `source_db_id` 下拉 |
| ETL Job 表單 | `source_connection` 改為 `source_db_id` 下拉 |

---

## 風險與緩解

| 風險 | 影響 | 緩解方式 |
|---|---|---|
| AI 混用 SQL 方言 | 生成的 SQL 執行失敗 | system prompt 明確列出禁止語法 + 失敗時回傳友好錯誤 + 重試 |
| 密碼安全 | DB 密碼外洩 | AES-256 加密存放，API 回傳時 mask，前端不顯示 |
| 連線池洩漏 | 連線耗盡 | adapter 統一 try/finally release，idle timeout |
| MySQL 無向量支援 | 語意搜尋不可用 | 向量庫留在 Oracle Layer 1，ETL 跨 DB 取資料 |
| MSSQL 參數上限 2100 | 大量 IN 條件失敗 | `buildInChunks()` 用 adapter 提供的限制值 |

---

## 未來擴充（Phase 5+）

### MongoDB（不在本次範圍）

- 不走 SQL，AI 生成 aggregation pipeline JSON
- 需要全新的 prompt engineering
- 預估 20+ 天

### PostgreSQL

- 若支援 PostgreSQL，可用 pgvector 做向量搜尋（替代 Oracle 23 AI）
- adapter 實作量與 MySQL 相近
- 套件：`pg`

---

## 完整架構圖

```
使用者問題
  ↓
[Route] POST /api/dashboard/query
  ↓
[dashboardService.runDashboardQuery]
  ├── 從 design → schema → source_db_id
  ├── adapterFactory.getAdapter(source.db_type)
  │     ├── oracleAdapter    (db_type='oracle')
  │     ├── mysqlAdapter     (db_type='mysql')
  │     └── mssqlAdapter     (db_type='mssql')
  │
  ├── [向量搜尋] （永遠走 Layer 1 Oracle）
  │     ├── Gemini embedding
  │     └── Oracle VECTOR_DISTANCE
  │
  ├── [buildPrompt] 注入 adapter.getDialectPrompt()
  │     └── 「你是 ${expertTitle}，語法規則：...，禁止使用：...」
  │
  ├── [Gemini 生成 SQL]（依方言生成）
  │
  ├── [安全驗證] adapter.getReadOnlyValidator()
  │     └── 共用規則 + DB 專屬黑名單
  │
  ├── [執行查詢] adapter.execute(conn, sql, binds)
  │     └── ReadOnlyProxy 強制唯讀
  │
  └── [結果正規化] adapter.normalizeRows()
        └── 欄位小寫、Date→ISO、統一格式
              ↓
        [SSE 串流推送] send('result', { rows, columns })
```
