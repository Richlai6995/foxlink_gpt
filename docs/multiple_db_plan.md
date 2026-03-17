# 多資料來源支援計畫（未實作，供未來參考）

> 討論日期：2026-03-17
> 狀態：**規劃中，尚未實作**

---

## 背景

目前 AI 戰情的資料查詢目標固定為單一 Oracle ERP DB（由 `.env` 設定）。
未來可能需要支援多個資料來源，讓 Schema 設計時可選擇不同的 DB 連線。

---

## 系統兩層 DB 概念

```
Layer 1: 系統 DB（Oracle 23 AI）
  → 存 users, chat_sessions, ai_schema_definitions 等系統 metadata
  → 不動，永遠是 Oracle 23 AI

Layer 2: 資料查詢 DB（目前只有 Oracle ERP）
  → AI 戰情 schema 查詢的目標 DB
  → 這層是本計畫要改成多來源的部分
```

改動只涉及 Layer 2，Layer 1 完全不動。

---

## 方案一：只新增其他 Oracle DB（推薦優先實作）

### 為何容易

- SQL 語法完全相容（NVL、ROWNUM、日期函數等），**AI prompt 不需要任何調整**
- `oracledb` 套件本身支援多個 connection pool，只是目前寫死一組
- 前端只需把「資料庫連結」改為從 `db_sources` 下拉選取

### 架構變化

```
目前                              改後
──────────────────────────────    ──────────────────────────────────
oracledb single pool → ERP DB    oracledb pool factory (map by id)
                                   ├── pool A → ERP DB（預設，env 設定）
                                   ├── pool B → 另一個 Oracle DB
                                   └── pool C → 第三個 Oracle DB
```

### 需要改動的檔案（估計 1.5 天）

| 檔案 | 改動內容 |
|------|---------|
| `server/database-oracle.js` | 單一 pool 改為 pool map，`getPool(sourceId)` |
| `server/routes/dbSources.js` | 新建，CRUD Oracle 連線設定 + 測試連線 API |
| `server/services/dashboardService.js` | 執行 SQL 時從 schema 拿 `source_db_id`，呼叫對應 pool |
| `server/database-oracle.js` migration | 新增 `ai_db_sources` 表 |
| 前端 Schema 編輯表單 | `db_connection` 改成從 `ai_db_sources` 下拉 |
| 前端 管理頁 | 新增 DB 來源管理頁（新增/編輯/刪除/測試連線）|

### 新資料表

```sql
CREATE TABLE ai_db_sources (
  id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         VARCHAR2(100) NOT NULL,   -- 顯示名稱，e.g. "ERP Oracle"
  db_type      VARCHAR2(20) DEFAULT 'oracle',
  host         VARCHAR2(200),
  port         NUMBER DEFAULT 1521,
  service_name VARCHAR2(100),
  username     VARCHAR2(100),
  password     CLOB,                     -- 加密存放
  is_default   NUMBER(1) DEFAULT 0,      -- 1 = env 預設的 ERP DB
  is_active    NUMBER(1) DEFAULT 1,
  created_at   TIMESTAMP DEFAULT SYSTIMESTAMP
)
```

`ai_schema_definitions.db_connection`（目前為字串 `'erp'`）改為 `source_db_id NUMBER`，
migration 時自動將舊的 `'erp'` 對應到 `is_default=1` 的那筆。

---

## 方案二：支援 MySQL / MS SQL

### 影響評估

**🔴 高影響：SQL 方言差異**

| 功能 | Oracle | MySQL | MS SQL |
|------|--------|-------|--------|
| Null 替換 | `NVL()` | `IFNULL()` | `ISNULL()` |
| 行數限制 | `ROWNUM` / `FETCH FIRST` | `LIMIT` | `TOP` / `FETCH` |
| 字串串接 | `\|\|` | `CONCAT()` | `+` / `CONCAT()` |
| 目前時間 | `SYSTIMESTAMP` | `NOW()` | `GETDATE()` |
| 條件表達式 | `DECODE()` / `CASE` | `IF()` / `CASE` | `CASE` |

**🔴 高影響：AI System Prompt 需注入 DB 類型**

```
// 目前固定
「你是 Oracle SQL 專家...」

// 改後，動態注入
「你是 MySQL 8.0 SQL 專家，使用 MySQL 語法，
  禁止使用 NVL/ROWNUM/DECODE 等 Oracle 專屬語法...」
```

**🟡 中影響：需要 adapter 抽象層**

```
server/services/dbAdapters/
├── oracleAdapter.js   → 現有邏輯抽出
├── mysqlAdapter.js    → 新寫（npm: mysql2）
└── mssqlAdapter.js    → 新寫（npm: mssql）
```

每個 adapter 實作統一介面：`execute(sql, binds)`, `ping()`, `close()`

**估計工作量**：Oracle 多 DB 的約 10 倍

### 主要風險

SQL 方言 + AI 幻覺：AI 可能混用 Oracle/MySQL 語法。
緩解方式：在 system prompt 列出「禁止使用的函數」清單，SQL 執行失敗時返回友好錯誤訊息。

---

## 方案三：支援 MongoDB

### 橋接方式比較

| 方法 | 需額外安裝 | 複雜度 | 結論 |
|------|-----------|-------|------|
| Atlas SQL Interface | 不用，但需 Atlas 雲端 | 低 | 僅限 MongoDB Atlas 用戶 |
| BI Connector Gateway | ✅ 需獨立 daemon process | 高 | 不推薦，官方逐漸淡化 |
| Native driver + aggregation pipeline | 不用 | 中 | ✅ 推薦（若要支援） |

### Native Driver 方案說明

不走 SQL，AI 直接生成 MongoDB aggregation pipeline JSON：

```
用戶問問題
    ↓
AI 根據 collection schema 生成 aggregation pipeline JSON
    ↓
server 用 mongodb driver 直接執行
    ↓
結果轉為統一的 rows/columns 格式（前端不需改動）
```

**難點**：AI 生成 aggregation pipeline 比 SQL 更容易出錯，需要精確描述 collection 結構（nested fields、array fields 等）。AI prompt 工程工作量最大。

---

## 建議實作順序

1. ✅ **多 Oracle DB**（最優先，改動小、風險低）
2. ⬜ **MySQL**（次之，SQL 相近，adapter 較好寫）
3. ⬜ **MS SQL**（與 MySQL 同批實作）
4. ⬜ **MongoDB**（最後，架構差異最大）

---

## 現有系統影響範圍總結

| 元件 | 只加 Oracle | 加 MySQL/MSSQL | 加 MongoDB |
|------|------------|---------------|-----------|
| 系統 DB（Layer 1） | 不動 | 不動 | 不動 |
| SQL 語法 / AI prompt | 不動 | 需調整 | 完全不同 |
| `dashboardService.js` | 小改（pool factory） | 中改（adapter） | 大改 |
| `database-oracle.js` | 加 pool map | 不動 | 不動 |
| 前端 | 小改（DB 選單） | 同左 | 同左 |
| 工作量估計 | 1.5 天 | ~15 天 | ~20 天+ |
