# ERP Tools 模組設計文件

> ERP 資料庫 FUNCTION / PROCEDURE 工具化,提供給 LLM 與使用者呼叫
> 版本:v1.1(實作完成)
> 最後更新:2026-04-17
> 狀態:**Phase 1–5 全部上線**,v2 擴充(鏈式 LOV、Rate limit、Dry-run、Metadata drift cron、Topbar 整合)全部完成

---

## 1. 目的

將 ERP(Oracle EBS / Custom)的 FUNCTION / PROCEDURE 包裝成平台工具,讓:

- **LLM** 透過 Gemini Function Calling 自動呼叫(tool-calling 模式)
- **使用者** 在對話中手動觸發(manual 模式)
- **平台** 在每次訊息前自動執行取 context(inject 模式)

---

## 2. 架構定位

### 2.1 與既有模組的關係

| 模組 | 關係 |
|------|------|
| `api_connectors`(REST / DIFY) | **UI 同 tab,後端獨立表** — 管理介面放在 apiConnectors 面板內的子類 chip,資料表自成一組 |
| `skills` | **自動建代理 row**(type=`erp_proc`)— 復用 TAG router / session 掛載 / 共享權限 / LLM function calling 管線 |
| `mcp_servers` | 平行關係,ERP tool 不走 MCP 協定 |
| `erpDb.js` | 沿用,但 executor 另外實作針對 PL/SQL 的 bind 處理 |

### 2.2 TopBar 不新增類別

- AdminDashboard 的 `dify` tab(label = `apiConnectors`)內的 `DifyKnowledgeBasesPanel` 子 chip 新增 `ERP Procedure`
- chip 切到 `erp_proc` 時,render 獨立的 `<ErpToolsPanel />` 組件

### 2.3 代理 skill row 機制

建立 ERP tool 時,後端自動:

1. INSERT `erp_tools` → 取得 `tool_id`
2. 自動生成 Gemini `tool_schema`(含 code、description、參數定義)
3. INSERT `skills` row(`type='erp_proc'`,`erp_tool_id=tool_id`,帶 tool_schema)
4. 回寫 `erp_tools.proxy_skill_id`

更新 / 刪除 ERP tool → cascade 同步代理 skill。

---

## 3. 資料表 DDL

加進 [server/database-oracle.js](../server/database-oracle.js) `runMigrations()`。

### 3.1 `erp_tools` 主表

```sql
CREATE TABLE erp_tools (
  id                 NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code               VARCHAR2(120) UNIQUE NOT NULL,    -- LLM 呼叫識別字
  name               VARCHAR2(200) NOT NULL,
  description        CLOB,
  tags               CLOB,                              -- JSON array,給 TAG router

  -- Oracle metadata
  db_owner           VARCHAR2(30)  NOT NULL,
  package_name       VARCHAR2(128),                     -- NULL = standalone
  object_name        VARCHAR2(128) NOT NULL,
  overload           VARCHAR2(10),
  routine_type       VARCHAR2(20)  NOT NULL,            -- FUNCTION | PROCEDURE
  metadata_json      CLOB,                              -- ALL_ARGUMENTS 快照
  metadata_hash      VARCHAR2(64),                      -- SHA1 of metadata
  metadata_checked_at TIMESTAMP,
  metadata_drifted   NUMBER(1) DEFAULT 0,

  -- 安全 / 呼叫模式
  access_mode        VARCHAR2(20) DEFAULT 'READ_ONLY',  -- READ_ONLY | WRITE
  requires_approval  NUMBER(1)    DEFAULT 0,
  allow_llm_auto     NUMBER(1)    DEFAULT 1,
  allow_inject       NUMBER(1)    DEFAULT 0,
  allow_manual       NUMBER(1)    DEFAULT 1,

  -- 設定 JSON
  params_json        CLOB,
  returns_json       CLOB,
  tool_schema_json   CLOB,                              -- 自動生成 + 可手動調整
  inject_config_json CLOB,                              -- result_template 等

  -- 限制
  max_rows_llm       NUMBER DEFAULT 50,
  max_rows_ui        NUMBER DEFAULT 1000,
  timeout_sec        NUMBER DEFAULT 30,

  -- 關聯
  proxy_skill_id     NUMBER REFERENCES skills(id) ON DELETE SET NULL,
  enabled            NUMBER(1) DEFAULT 1,
  created_by         NUMBER REFERENCES users(id),
  created_at         TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at         TIMESTAMP DEFAULT SYSTIMESTAMP
);
CREATE INDEX idx_erp_tools_code   ON erp_tools(code);
CREATE INDEX idx_erp_tools_object ON erp_tools(db_owner, package_name, object_name);
```

### 3.2 翻譯表 `erp_tool_translations`

```sql
CREATE TABLE erp_tool_translations (
  id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tool_id             NUMBER NOT NULL REFERENCES erp_tools(id) ON DELETE CASCADE,
  lang                VARCHAR2(10) NOT NULL,    -- zh-TW | en | vi
  name                VARCHAR2(200),
  description         CLOB,
  params_labels_json  CLOB,                     -- { "P_EMP_NO": "Employee No.", ... }
  updated_at          TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT uq_erp_tool_lang UNIQUE (tool_id, lang)
);
```

### 3.3 審計 `erp_tool_audit_log`

```sql
CREATE TABLE erp_tool_audit_log (
  id               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tool_id          NUMBER NOT NULL REFERENCES erp_tools(id) ON DELETE CASCADE,
  user_id          NUMBER REFERENCES users(id),
  session_id       VARCHAR2(36),
  trigger_source   VARCHAR2(30),    -- llm_tool_call | manual_form | inject | test
  access_mode      VARCHAR2(20),
  input_json       CLOB,
  output_sample    CLOB,
  result_cache_key VARCHAR2(100),   -- Redis key(完整結果)
  duration_ms      NUMBER,
  rows_returned    NUMBER,
  error_code       VARCHAR2(20),
  error_message    VARCHAR2(2000),
  created_at       TIMESTAMP DEFAULT SYSTIMESTAMP
);
CREATE INDEX idx_erp_audit_tool_time ON erp_tool_audit_log(tool_id, created_at DESC);
CREATE INDEX idx_erp_audit_user_time ON erp_tool_audit_log(user_id, created_at DESC);
```

### 3.4 待審批 `erp_tool_pending_approval`(WRITE 型)

```sql
CREATE TABLE erp_tool_pending_approval (
  id                  VARCHAR2(36) PRIMARY KEY,
  tool_id             NUMBER NOT NULL REFERENCES erp_tools(id) ON DELETE CASCADE,
  user_id             NUMBER REFERENCES users(id),
  session_id          VARCHAR2(36),
  input_json          CLOB,
  reason              VARCHAR2(500),
  status              VARCHAR2(20) DEFAULT 'pending',   -- pending|approved|rejected|expired
  approved_by         NUMBER REFERENCES users(id),
  approved_at         TIMESTAMP,
  execution_result_id NUMBER,                            -- 對應 audit_log.id
  expires_at          TIMESTAMP,
  created_at          TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

### 3.5 `skills` 表 migration

```sql
ALTER TABLE skills ADD COLUMN erp_tool_id NUMBER;
-- type 新增合法值 'erp_proc' 僅 runtime check,無 DB constraint
```

### 3.6 `params_json` 格式規範

```json
[{
  "name": "P_EMP_NO",
  "position": 1,
  "in_out": "IN",
  "data_type": "VARCHAR2",
  "pls_type": null,
  "data_length": 50,
  "required": true,
  "ai_hint": "台灣員工工號,8 碼數字",
  "default_value": null,
  "lov_config": {
    "type": "sql",
    "sql": "SELECT emp_no v, emp_name l FROM fl_employee WHERE factory=:factory AND status='A' AND ROWNUM<=500",
    "binds": [{ "name": "factory", "source": "system_user_factory" }],
    "value_col": "v",
    "label_col": "l",
    "cache_sec": 300
  },
  "inject_value": null,
  "inject_source": "system_user_employee_id"
}]
```

---

## 4. Metadata 自動擷取

### 4.1 查詢語句

```sql
SELECT owner, package_name, object_name, subprogram_id, overload,
       argument_name, position, sequence, data_level,
       data_type, pls_type, in_out, data_length, data_precision, data_scale,
       type_owner, type_name, type_subname
FROM   ALL_ARGUMENTS
WHERE  UPPER(owner)        = :owner
  AND  UPPER(object_name)  = :name
  AND  (UPPER(package_name) = :pkg OR (:pkg IS NULL AND package_name IS NULL))
ORDER BY subprogram_id, sequence
```

### 4.2 陷阱與處理

| 陷阱 | 處理 |
|------|------|
| Package vs Standalone | `package_name IS NULL` = standalone |
| Overload | 同名多簽章,UI 顯示 overload 清單讓使用者選 |
| Function return value | `position=0` 且 `argument_name IS NULL` → 填入 `returns_json.function_return` |
| 複合型別(`data_level>0`)| v1 拒絕註冊(RECORD / TABLE OF / OBJECT TYPE) |
| SYS_REFCURSOR | OUT 常見,用 `oracledb.CURSOR` bind,回來 `getRows()` |
| CLOB | `fetchInfo { COL: { type: oracledb.STRING }}` 或 `getData()` |

### 4.3 MVP 支援型別

- `VARCHAR2` / `CHAR` / `NUMBER` / `DATE` / `TIMESTAMP`
- `CLOB`
- `REF CURSOR`(SYS_REFCURSOR)
- 其他標灰不可用

### 4.4 白名單

`.env` 設定 `ERP_ALLOWED_SCHEMAS=APPS,CUSTOM_FL`,註冊時比對 owner,不在清單拒絕。

### 4.5 Drift 檢查

- 背景 cron(`ERP_TOOL_METADATA_CHECK_CRON`,預設每小時):比對 hash,不一致 → `metadata_drifted=1` + 通知 admin
- 執行前:快速 hash check,不一致時視設定 拒絕 / 警告
- Admin 手動觸發 `POST /api/erp-tools/:id/refresh-metadata` → 比對差異並提供合併策略

---

## 5. 三種呼叫入口

### 5.1 Tool-calling(LLM 自動)

```
chat.js 載入 session 掛載的 ERP tool
  → tool_schema 加入 Gemini functionDeclarations
  → LLM 自主決定呼叫
  → toolHandler 找 erpToolMap[toolName]
  → erpToolExecutor.execute({ trigger_source: 'llm_tool_call' })
  → 回傳 function response
```

WRITE 型且 `allow_llm_auto=0`:LLM 呼叫時 executor 回 `{ requires_confirmation, confirmation_token, summary }`,前端攔截 token 跳確認 dialog,使用者按執行後帶 token 再呼叫一次。

### 5.2 手動觸發(使用者)

ChatWindow 多「工具」按鈕:

```
點開 → 列可用 ERP tools(經 TAG router 或顯示全部)
  → 選一個 → InvokeModal(參數填寫,LOV 下拉)
  → 執行 → 結果卡片三模式:
      [A] 僅顯示結果 — 表格展示,不丟 LLM
      [B] 讓 AI 解釋 — 結果塞回對話,LLM 生成自然語言
      [C] 以此提問   — 結果當下一則訊息 context
```

WRITE 型額外確認 dialog(含 reason 輸入)。

### 5.3 Inject(平台自動,每輪)

```
使用者發訊息 → sessionBuilder 組 system prompt 前
  → 平行跑 session 掛載 + allow_inject=1 的所有 ERP tool
  → 結果用 inject_config_json.result_template(Handlebars)渲染
  → append 到 system prompt
  → 交給 LLM
```

**參數限制**:Inject tool 所有參數必須設「固定值」或「系統值」,不能需要使用者輸入或 AI 提取。註冊時驗證,不合規擋下。

典型適用:當前使用者待辦事項、本部門公告、今日指標等固定 context。

---

## 6. LOV(List Of Values)

### 6.1 四種來源

```js
// 1. 靜態
{ type: 'static', items: [{value:'Y',label:'是'},{value:'N',label:'否'}] }

// 2. SQL(最常用,禁 DML)
{ type: 'sql',
  sql: 'SELECT dept_code v, dept_desc l FROM fl_emp_dept WHERE factory=:factory',
  binds: [{ name: 'factory', source: 'system_user_factory' }],
  value_col: 'v', label_col: 'l', cache_sec: 300 }

// 3. 系統值(唯讀直填)
{ type: 'system', source: 'system_user_employee_id' }

// 4. 鏈式(v2,呼叫另一個 ERP tool)
{ type: 'erp_tool', tool_id: 42, param_map: {...} }
```

### 6.2 SQL 安全驗證

```js
function validateLovSql(sql) {
  const n = sql.trim().toUpperCase();
  if (!/^SELECT\s/.test(n)) throw new Error('LOV SQL 必須以 SELECT 開頭');
  if (/\b(UPDATE|DELETE|INSERT|DROP|TRUNCATE|ALTER|GRANT|REVOKE|EXEC|EXECUTE|BEGIN|CALL|MERGE)\b/.test(n))
    throw new Error('LOV SQL 只能查詢,不可包含寫入');
  if ((sql.match(/;/g) || []).length > 1) throw new Error('LOV SQL 只能單一查詢');
  return true;
}
```

執行時 wrap `ROWNUM <= ERP_TOOL_LOV_MAX_ROWS`(預設 500)防爆 UI。

### 6.3 系統參數擴充

`resolveSystemParam()` 於 `apiConnectorService.js` 現有基礎上補:

- `system_user_factory`
- `system_user_profit_center`
- (其餘沿用)

---

## 7. 結果處理

### 7.1 截斷策略(C + Redis 快取)

| 對象 | 上限 | 說明 |
|------|------|------|
| LLM tool-calling | `max_rows_llm`(預設 50,可設到 1000) | tool response 標 `truncated=true` + `_cache_key` |
| 使用者 UI | `max_rows_ui`(預設 1000) | 分頁顯示 + Excel 匯出 |
| 完整結果 | Redis | TTL = `ERP_TOOL_RESULT_CACHE_TTL`(預設 1800 秒) |

### 7.2 Redis 結果快取

```js
// Key 格式
erp:result:{audit_log_id}
// Value:gzip(JSON) 完整結果

// Endpoint
GET /api/erp-tools/results/:cacheKey       → 前端「查看完整結果」
GET /api/erp-tools/results/:cacheKey/export → Excel 下載
```

LLM 對話流:結果卡旁邊出「查看完整結果」按鈕(使用者看完整表格)+ 可接著說「用完整結果畫個圖」觸發 code 技能讀 Redis 分析。

### 7.3 OUT 結構

```json
{
  "function_return": <function 回傳值>,
  "params": {
    "P_STATUS": "SUCCESS",
    "P_ROWS": {
      "rows": [...],
      "truncated": true,
      "total_fetched": 50
    }
  }
}
```

### 7.4 CLOB 處理

- 欄位值 > 2KB 截斷 + 標記「已截斷,請至完整結果查看」
- Redis 快取存完整

---

## 8. WRITE 型安全設計

| 面向 | 設計 |
|------|------|
| 連線帳號 | 沿用現有 `ERP_DB_USER`(write 權限在 procedure 內部,平台不區分 pool) |
| `access_mode` 標記 | 由註冊者手動勾選,UI 紅色警告 |
| LLM 自動觸發 | `allow_llm_auto=0` 預設;執行時先回 `requires_confirmation` + token,前端跳 dialog,使用者確認後帶 token 重新呼叫 |
| 手動觸發 | 前端強制 ConfirmDialog(含 reason 輸入) |
| 需審批(`requires_approval=1`) | 寫入 `erp_tool_pending_approval`,admin 於審批面板處理 |
| Audit log | 必寫,不可關 |

---

## 9. 多語化

### 9.1 範圍

- `erp_tools.name`(zh-TW 原始)
- `erp_tools.description`(zh-TW 原始)
- `params_labels`(每個參數的顯示名)
- 其餘(ai_hint、lov SQL、metadata)不譯

### 9.2 翻譯流程

沿用 `helpTranslator.js` 模式:

```
ErpToolEditor 的 Translate tab
  → POST /api/erp-tools/:id/translate (SSE)
  → LLM 批次譯出 zh-TW → en / vi
  → 寫入 erp_tool_translations
```

### 9.3 讀取

所有列表 / 詳情 API 接受 `?lang=` 參數,LEFT JOIN `erp_tool_translations` 後 merge。

---

## 10. 檔案清單

### 10.1 後端

```
server/
├── routes/
│   └── erpTools.js
├── services/
│   ├── erpToolExecutor.js          # 核心執行器
│   ├── erpToolMetadata.js          # ALL_ARGUMENTS + hash + overload
│   ├── erpToolSchemaGen.js         # metadata → Gemini tool_schema
│   ├── erpToolLovResolver.js       # static / sql / system
│   ├── erpToolProxySkill.js        # 代理 skill row 同步
│   ├── erpToolResultCache.js       # Redis TTL 30min
│   └── erpToolCronService.js       # 每小時 drift 檢查
```

### 10.2 前端

```
client/src/components/admin/
├── ErpToolsPanel.tsx               # 子 chip 面板列表
├── ErpToolEditor.tsx               # 註冊 / 編輯(含 inspect)
├── ErpToolParamEditor.tsx          # 單一參數(LOV / ai_hint / i18n)
├── ErpToolTestRunner.tsx           # 試跑
├── ErpToolAuditLogPanel.tsx
└── ErpToolApprovalsPanel.tsx

client/src/components/chat/
├── ErpToolPicker.tsx
├── ErpToolInvokeModal.tsx
├── ErpToolResultCard.tsx
└── ErpToolConfirmDialog.tsx
```

---

## 11. API 路由

```
# 註冊 / CRUD (admin)
POST   /api/erp-tools/inspect              { owner, package, name } → 回所有 overloads metadata
POST   /api/erp-tools                      註冊(自動建代理 skill)
GET    /api/erp-tools                      列表(filter by access_mode / enabled / tag)
GET    /api/erp-tools/:id                  詳情 + 翻譯
PUT    /api/erp-tools/:id
DELETE /api/erp-tools/:id

# Metadata
POST   /api/erp-tools/:id/refresh-metadata 手動刷新
GET    /api/erp-tools/:id/metadata-diff    最新 vs 已存的差異

# 翻譯
POST   /api/erp-tools/:id/translate        LLM 批次翻譯 (SSE)

# LOV
POST   /api/erp-tools/:id/lov/:paramName   解析 LOV(支援 search query 做 autocomplete)

# 執行
POST   /api/erp-tools/:id/execute          { inputs, trigger_source?, confirmation_token? }

# WRITE 審批
GET    /api/erp-tools/pending-approvals
POST   /api/erp-tools/pending-approvals/:id/approve
POST   /api/erp-tools/pending-approvals/:id/reject

# 結果快取
GET    /api/erp-tools/results/:cacheKey
GET    /api/erp-tools/results/:cacheKey/export

# 審計
GET    /api/erp-tools/:id/audit-log
```

---

## 12. Chat 整合點

### 12.1 [chat.js](../server/routes/chat.js) 修改

**Tool schema 註冊**(第 1642 行附近迴圈):

```js
// 現有:
if ((sk.type === 'code' || sk.type === 'external') && sk.tool_schema && ...) { ... }

// 修改為:
if ((sk.type === 'code' || sk.type === 'external' || sk.type === 'erp_proc')
    && sk.tool_schema && ...) {
  // erp_proc 額外從 erp_tools 反查最新 tool_schema_json(防 drift)
}
```

**toolHandler 分支**(第 2420 行):

```js
if (erpToolMap[toolName]) {
  const erpTool = erpToolMap[toolName];
  sendEvent({ type: 'status', message: `呼叫 ERP:${erpTool.name}` });
  const result = await erpToolExecutor.execute(erpTool.id, args, req.user, {
    trigger_source: 'llm_tool_call',
    session_id: sessionId,
  });
  if (result.requires_confirmation) {
    sendEvent({ type: 'erp_confirm', tool_id: erpTool.id, token: result.token, ... });
    return `[需要使用者確認:${result.summary}]`;
  }
  return JSON.stringify(result);
}
```

### 12.2 [sessionBuilder.js](../server/services/sessionBuilder.js) Inject 整合

```js
// 組 system prompt 前
const injectTools = await loadSessionInjectErpTools(sessionId);
const injectResults = await Promise.allSettled(
  injectTools.map(t => erpToolExecutor.execute(t.id, resolveInjectInputs(t, userCtx), userCtx, {
    trigger_source: 'inject',
    timeout_sec: 5,  // inject 超時較短
  }))
);
const renderedContext = renderWithHandlebars(injectTools, injectResults);
systemPrompt += `\n\n## ERP 即時資訊\n${renderedContext}`;
```

---

## 13. 環境變數

```bash
# 沿用
ERP_DB_HOST=
ERP_DB_PORT=1521
ERP_DB_SERVICE_NAME=
ERP_DB_USER=
ERP_DB_USER_PASSWORD=

# 新增
ERP_ALLOWED_SCHEMAS=APPS,CUSTOM_FL
ERP_TOOL_LOV_MAX_ROWS=500
ERP_TOOL_RESULT_CACHE_TTL=1800
ERP_TOOL_METADATA_CHECK_CRON=0 * * * *
ERP_TOOL_DEFAULT_TIMEOUT_SEC=30
```

---

## 14. Phase 實作狀態

### Phase 1 — MVP ✅ 完成

- ✅ DDL + migrations
- ✅ `erpToolMetadata.js`(ALL_ARGUMENTS + hash + overload 選擇)
- ✅ `erpToolSchemaGen.js`(auto 生 code + tool_schema)
- ✅ `erpToolExecutor.js` 核心(scalar + REF CURSOR + CLOB,READ_ONLY)
- ✅ `erpToolLovResolver.js`(static / sql / system)
- ✅ Routes:inspect / CRUD / lov / execute / audit-log
- ✅ `ErpToolsPanel` + `ErpToolEditor` + 內嵌 ParamEditor + `ErpToolTestRunner`
- ✅ apiConnectors 子 chip 整合

### Phase 2 — WRITE + 翻譯 + 代理 skill ✅ 完成

- ✅ WRITE 執行路徑 + 一次性 confirmation token(5 分鐘 TTL)
- ⏳ `ErpToolApprovalsPanel`(`requires_approval` 欄位與 pending_approval 表已建立,UI 未做,目前走一次性 token)
- ✅ `erp_tool_translations` + LLM 批次翻譯(`POST /translate`)
- ✅ `erpToolProxySkill.js`(CRUD sync + backfill migration)
- ✅ 代理 skill 的 `skill_access` 共享(復用)
- ✅ Metadata drift cron + drift 旗標 UI(橘色徽章)

### Phase 3 — Chat 整合 + Redis 結果快取 ✅ 完成

- ✅ `chat.js` 第 1642 行 tool_schema 註冊 + 第 2420 行 toolHandler 的 ERP 分支
- ✅ `ErpToolPicker` + `ErpToolInvokeModal`(含三模式後處理:view / AI 解釋 / 以此提問)
- ✅ `ErpConfirmDialog`(WRITE 在對話中的確認對話框)
- ✅ `erpToolResultCache.js`(Redis gzip + TTL 1800s)
- ✅ `GET /results/:cacheKey` endpoint
- ⏳ Excel 匯出 endpoint(暫未做,可由 AI 呼叫 xlsx 技能替代)
- ✅ WRITE function calling 完整確認 UX(SSE `erp_confirm` event)

### Phase 4 — Inject mode ✅ 完成

- ✅ Inject 參數校驗(註冊時擋)
- ✅ `chat.js` 在 skill 處理迴圈加 `erp_proc` 分支,Inject 執行後 append 到 system prompt
- ✅ `result_template` 簡易 `{{var}}` / `{{obj.field}}` 變數替換
- ✅ Inject 錯誤降級(不 block 對話)

### Phase 5 — v2 擴充 ✅ 完成

- ✅ 鏈式 LOV(`type: erp_tool`,支援遞迴防呆)
- ✅ Rate limit(per-user / global,window=minute/hour/day,Redis counter)
- ✅ Dry-run SAVEPOINT 模式(WRITE 型預覽)
- ✅ Metadata drift cron(`ERP_TOOL_METADATA_CHECK_CRON`,預設每小時)
- ✅ Topbar 整合:ERP 合併進 ⚡ API 連接器 popup,跟 DIFY/REST 並列
- ✅ 手動觸發 🛢 入口(MessageInput 左側按鈕)
- ✅ SkillManagement / SkillMarket / AdminOverride 過濾掉 `erp_proc` 代理 row

### 未做(可延伸)

- Admin 審批 UI(`ErpToolApprovalsPanel`):目前 `requires_approval=1` 走一次性 token,沒有「存進 DB 等 admin 核可」的非同步流程
- Excel 匯出 endpoint(目前使用者可請 AI 產生,或前端前端自行轉 CSV)
- Monitor dashboard(呼叫量 / 錯誤率 / 慢查詢的統計圖表)

---

## 15. 風險與注意事項

1. **`node-oracledb` REF CURSOR**:必須 `OUT_FORMAT_OBJECT`,`erpDb.js` 已設定
2. **PL/SQL OUT CLOB**:`bindOut` + `getData()`,executor 需測試
3. **白名單 owner**:`ERP_ALLOWED_SCHEMAS` 未設預設**拒絕全部**,防誤註冊 `SYS.*`
4. **tool_schema 長度**:參數過多時 description 需縮短,避免吃太多 Gemini token
5. **Oracle 連線池**:現有 `erpDb.js` 每次 `getConnection` 新建,K8s 多 pod 會開很多連線;建議本模組改用 `oracledb.createPool`(獨立 issue 處理)
6. **Redis 結果快取 key**:`erp:result:{audit_log_id}`,value 為 gzip JSON,TTL 自動清
7. **LOV cache**:同參數查 LOV 的結果快取 `cache_sec`(Redis),避免每次開下拉都打 DB
8. **Overload 註冊限制**:同 owner/package/name/overload 組合唯一,避免重複
9. **參數型別驗證**:執行前 coerce(字串→NUMBER/DATE),失敗 early return 不送 DB

---

## 16. 驗收檢查點(全數通過)

| Phase | 檢查點 | 狀態 |
|-------|--------|------|
| P1 | 註冊 `APPS.FL_DIS_PKG.GET_ITEM_NO` → metadata 正確抓 → 填 LOV → 試跑成功回結果 | ✅ |
| P2 | WRITE proc 執行前跳紅色確認、audit log 有紀錄、翻譯按鈕產 en/vi | ✅ |
| P3 | 對話中 LLM 自動呼叫 → 結果回灌 → 使用者點「查看完整結果」開啟完整表 | ✅ |
| P4 | Inject tool(全參數系統值)→ 發訊息 → system prompt 含 ERP context | ✅ |
| P5 | Topbar ⚡ API 按鈕勾 ERP → 白名單生效 / Rate limit 擋超速 / Dry-run 標記 rollback | ✅ |

---

## 17. 使用者手冊位置

- **一般使用者手冊**:`u-erp-tools`(sort_order=32)於 `server/data/helpSeedData.js` + `_helpSeed_part2.js`
- **管理員手冊**:`a-erp-tools` 於 `client/src/pages/HelpPage.tsx` 的 `AdminManual()` 函數內
- **結構索引**:`docs/help-manual-structure.md`

---
