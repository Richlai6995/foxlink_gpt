# FOXLINK GPT 工具呼叫架構文件

> 版本：v2.0 — TAG 自動路由 + Workflow 引擎
> 最後更新：2026-03-25

---

## 1. 系統總覽

FOXLINK GPT 的工具呼叫系統整合了四大類外部能力來源，透過 TAG 自動路由引擎在每次對話中動態決定啟用哪些工具與知識庫：

```
使用者訊息
    │
    ▼
┌──────────────────────────────┐
│   TAG 自動路由引擎            │
│   (tagRouter.js)             │
│                              │
│  1. Flash LLM 萃取意圖標籤    │
│  2. TAG 比對候選工具          │
│  3. Description 精篩         │
│  4. Fallback → 傳統 intent   │
└──────────────────────────────┘
    │
    ├─→ MCP 伺服器 (Gemini Function Calling)
    ├─→ DIFY 知識庫 (RAG 注入)
    ├─→ 自建知識庫 (向量 + 全文檢索)
    ├─→ 技能 Skill (Prompt / Endpoint / Code / Workflow)
    │
    ▼
┌──────────────────────────────┐
│   Gemini LLM 生成回覆         │
│   (含 Tool Declarations)     │
└──────────────────────────────┘
```

---

## 2. 工具類型

### 2.1 MCP 伺服器

| 項目 | 說明 |
|------|------|
| 協定 | MCP Streamable HTTP (`/mcp` 端點) |
| 註冊方式 | 管理員在後台新增 URL + API Key，同步取得工具清單 |
| 呼叫機制 | 工具以 Gemini Function Declaration 註冊，由 LLM 自主決定是否呼叫 |
| TAG 欄位 | `tags` (CLOB, JSON array) — 用於自動路由比對 |
| 路由層級 | 管理員啟用 → TAG 路由篩選 → 角色權限過濾 → 技能 MCP 模式覆蓋 |

### 2.2 DIFY 知識庫

| 項目 | 說明 |
|------|------|
| 來源 | 正崴內部 DIFY 平台 (fldify-api.foxlink.com.tw) |
| 查詢方式 | 每則訊息同時送出查詢，結果注入 System Prompt |
| TAG 欄位 | `tags` (CLOB, JSON array) — 用於自動路由比對 |
| 管理 | 管理員設定 API Server + API Key，支援測試連線 |

### 2.3 自建知識庫

| 項目 | 說明 |
|------|------|
| 儲存 | Oracle 23 AI 向量資料庫 |
| 檢索模式 | 向量檢索 / 全文檢索 / 混合檢索（可配置） |
| 分塊策略 | 常規分段 / 父子分塊 |
| TAG 欄位 | `tags` (CLOB, JSON array) — 用於自動路由比對 |
| 共享 | 支援使用者 / 角色 / 部門 / 利潤中心 / 課室，權限分 use / edit |
| 行內編輯 | 詳情頁頂部可直接編輯名稱與描述 |

### 2.4 技能 (Skill)

技能分為四種類型：

| 類型 | 說明 | 端點模式 |
|------|------|----------|
| `builtin` | System Prompt 角色設定 | — |
| `external` | 呼叫外部 API | inject / answer |
| `code` | 平台內 Node.js 程式碼 | inject / answer / tool_schema |
| `workflow` | DAG 多步驟流程編排 | — (workflow 引擎處理) |

---

## 3. TAG 自動路由引擎

### 3.1 檔案位置

`server/services/tagRouter.js`

### 3.2 核心流程

```
autoRouteByTags(userMessage, recentContext, allTools, db)
    │
    ▼
extractIntentTags(userMessage, recentContext)
    │  使用 Flash LLM 從使用者訊息萃取 0~5 個意圖標籤
    │  輸出: ["股票", "台積電", "即時行情"] (範例)
    ▼
tagsMatch(intentTags, toolTags)
    │  雙向部分匹配（intent 包含 tool 或 tool 包含 intent）
    │  任一方向匹配即命中
    ▼
candidates = allTools.filter(tagsMatch)
    │
    ├─ 命中 ≤ 閾值 → 直接回傳 { selected, method: 'tag' }
    │
    ├─ 命中 > 閾值 → filterByDescription(userMessage, candidates)
    │                  Flash LLM 根據工具描述精篩
    │                  回傳 { selected, method: 'tag+description' }
    │
    └─ 命中 0 個 → 回退傳統 intent 過濾
                   回傳 { selected, method: 'fallback' }
```

### 3.3 TAG 比對演算法

```javascript
function tagsMatch(intentTags, toolTags) {
  // intentTags: Flash LLM 從訊息萃取的標籤
  // toolTags: 工具/知識庫上設定的標籤
  // 雙向部分匹配: "股票查詢".includes("股票") 或 "股票".includes("股")
  return intentTags.some(it =>
    toolTags.some(tt =>
      it.includes(tt) || tt.includes(it)
    )
  )
}
```

### 3.4 設定建議

- 每個工具/知識庫設定 2~5 個精準標籤
- 標籤應反映工具的核心功能領域，避免過於通用（如「資料」「查詢」）
- 標籤支援自由輸入，使用 Enter 或逗號分隔
- 未設定 TAG 的工具會在 fallback 階段被傳統 intent 機制處理

---

## 4. 技能進階功能

### 4.1 Prompt 輸入變數 (prompt_variables)

技能可定義 JSON 格式的輸入變數陣列，使用者掛載技能時彈出表單填寫：

```json
[
  {
    "name": "target_language",
    "label": "目標語言",
    "type": "select",
    "required": true,
    "options": ["日文", "韓文", "英文", "法文"]
  },
  {
    "name": "formality",
    "label": "語氣正式度",
    "type": "select",
    "options": ["正式", "半正式", "口語"]
  }
]
```

**支援的 type**: `text` | `textarea` | `select` | `number` | `date` | `checkbox`

在 System Prompt 中以 `{{變數名稱}}` 引用：

```
你是專業翻譯員，將使用者文字翻譯為 {{target_language}}，語氣為 {{formality}}。
```

**資料流**:

```
掛載技能 → 彈出變數表單 → 使用者填寫
    → POST /api/chat/sessions/:id/skills (variables_json)
    → session_skills.variables_json 欄位
    → chat.js 載入時替換 System Prompt 中的 {{var}}
```

### 4.2 Tool Schema (Gemini Function Calling)

Code 類型技能可定義 `tool_schema`（JSON），符合 Gemini Function Declaration 格式：

```json
{
  "name": "get_stock_price",
  "description": "查詢台灣股票即時股價",
  "parameters": {
    "type": "object",
    "properties": {
      "stock_code": {
        "type": "string",
        "description": "台灣股票代號，例如 2330"
      }
    },
    "required": ["stock_code"]
  }
}
```

**運作機制**:

1. `chat.js` 載入 session 掛載的 Code 技能中有 `tool_schema` 的項目
2. 將 `tool_schema` 加入 Gemini `tools[].functionDeclarations` 陣列
3. Gemini LLM 在對話中自主決定是否呼叫
4. 呼叫時，`chat.js` 的 `toolHandler` 將參數轉發給 Code Runner HTTP 端點
5. 回傳結果作為 function response 繼續對話

### 4.3 Output Schema

技能可定義 JSON Schema 格式的輸出結構，注入到 System Prompt 末尾：

```
請嚴格按照以下 JSON 格式回覆：
{schema JSON}
```

### 4.4 知識庫綁定 (KB Binding)

技能可綁定特定知識庫，掛載技能時自動啟用：

| 欄位 | 說明 |
|------|------|
| `self_kb_ids` | 綁定的自建知識庫 ID 陣列 (JSON) |
| `dify_kb_ids` | 綁定的 DIFY 知識庫 ID 陣列 (JSON) |
| `kb_mode` | `append` / `exclusive` / `disable` |

**kb_mode 行為**:

- `append`: 技能綁定的 KB + 使用者手動掛載的 KB 同時生效
- `exclusive`: 僅使用技能綁定的 KB，忽略使用者掛載的
- `disable`: 不使用任何知識庫

### 4.5 速率限制 (Rate Limiting)

| 欄位 | 型別 | 說明 |
|------|------|------|
| `rate_limit_per_user` | NUMBER | 每人在時間窗口內的呼叫上限 |
| `rate_limit_global` | NUMBER | 全域呼叫上限 |
| `rate_limit_window` | VARCHAR2(10) | `minute` / `hour` / `day` |

**檢查邏輯** (`chat.js`):

```sql
-- 每人限制
SELECT COUNT(*) FROM chat_messages
WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id = :uid)
  AND created_at > SYSTIMESTAMP - INTERVAL '1' :window
  AND role = 'user'

-- 全域限制 (類似，不過濾 user_id)
```

### 4.6 版本控制

| 欄位 | 說明 |
|------|------|
| `prompt_version` | 目前版本號 (NUMBER, 預設 1) |
| `published_prompt` | 目前線上使用的 Prompt (CLOB) |
| `draft_prompt` | 草稿 Prompt (CLOB) |

**API**:

| 端點 | 說明 |
|------|------|
| `POST /api/skills/:id/publish` | 將草稿發佈為新版本，版本號 +1 |
| `GET /api/skills/:id/versions` | 列出所有歷史版本 |
| `GET /api/skills/:id/versions/:ver` | 取得特定版本內容 |
| `POST /api/skills/:id/rollback/:ver` | 回滾到指定版本 |

**版本歷史表**: `skill_prompt_versions`

```sql
CREATE TABLE skill_prompt_versions (
  id           NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  skill_id     NUMBER NOT NULL,
  version      NUMBER NOT NULL,
  prompt       CLOB,
  workflow_json CLOB,
  published_by NUMBER,
  published_at TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

---

## 5. Workflow 引擎

### 5.1 檔案位置

`server/services/workflowEngine.js`

### 5.2 架構

```
WorkflowEngine.execute(workflow, userInput, variables)
    │
    ▼
解析 workflow.nodes + workflow.edges
    │
    ▼
拓撲排序 (Topological Sort)
    │
    ▼
依序執行各節點 (max 50 iterations guard)
    │
    ├─ start       → 設定 output = userInput
    ├─ llm         → 呼叫 Gemini API
    ├─ knowledge_base → 查詢自建 KB
    ├─ dify        → 查詢 DIFY KB
    ├─ mcp_tool    → 呼叫 MCP 伺服器工具
    ├─ skill       → 呼叫其他技能
    ├─ code        → eval 自訂 JavaScript
    ├─ http_request → fetch 外部 API
    ├─ condition   → 條件分支 (→ default / else)
    ├─ template    → 模板變數替換
    └─ output      → 最終輸出
    │
    ▼
回傳最後一個 output 節點的內容
```

### 5.3 節點類型詳述

#### Start 節點
- 每個 Workflow 必須有一個 start 節點
- `output` = 使用者原始訊息

#### LLM 節點
- 設定: `model`、`system_prompt`、`temperature`
- 支援模板變數: `{{nodeId.output}}`、`{{start.input}}`、`{{var.name}}`

#### Knowledge Base 節點
- 設定: `kb_id`、`top_k`
- 查詢自建知識庫，回傳最相關的 chunk

#### DIFY 節點
- 設定: `dify_id`
- 查詢 DIFY 知識庫

#### MCP Tool 節點
- 設定: `server_id`、`tool_name`、`arguments`
- 呼叫指定 MCP 伺服器的工具

#### Skill 節點
- 設定: `skill_id`
- 呼叫另一個技能（Prompt / Endpoint / Code）

#### Code 節點
- 設定: `code` (JavaScript)
- 在沙箱中執行，可存取前置節點的輸出

#### HTTP Request 節點
- 設定: `url`、`method`、`headers`、`body`
- 發送 HTTP 請求到外部服務

#### Condition 節點
- 設定: `field`、`operator`、`value`
- 運算子: `contains` | `equals` | `not_equals` | `gt` | `lt` | `is_empty` | `not_empty`
- 兩條輸出邊: `default`（條件成立）、`else`（條件不成立）

#### Template 節點
- 設定: `template` (字串)
- 使用 `{{nodeId.output}}` 組合多個節點的輸出

#### Output 節點
- 設定: `content` (模板字串)
- Workflow 的最終輸出

### 5.4 模板變數語法

| 語法 | 說明 |
|------|------|
| `{{start.input}}` | 使用者原始訊息 |
| `{{nodeId.output}}` | 指定節點的執行結果 |
| `{{var.name}}` | prompt_variables 中的變數值 |

### 5.5 React Flow 視覺化編輯器

**檔案**: `client/src/components/workflow/WorkflowEditor.tsx`

功能:
- 左側面板: 11 種節點類型拖拉板
- 中央畫布: React Flow v12 (`@xyflow/react`) 畫布
- 右側面板: 選取節點後顯示配置表單
- Condition 節點自動產生 `default` + `else` 兩個 source handle
- 儲存時將 nodes + edges 序列化為 JSON，存入 `skills.workflow_json`

---

## 6. 對話請求完整流程

```
POST /api/chat/sessions/:id/messages (multipart/form-data)
│
├─ 1. 驗證 Token + 載入 session
├─ 2. 載入 session 掛載的 skills + variables_json
├─ 3. 速率限制檢查 (rate_limit_per_user / rate_limit_global)
│
├─ 4. 判斷技能類型
│   ├─ workflow → WorkflowEngine.execute() → 回傳結果
│   ├─ code (tool_schema) → 註冊為 Gemini Function Declaration
│   ├─ code (inject/answer) → 呼叫 Code Runner HTTP
│   ├─ external (inject/answer) → 呼叫外部 Endpoint
│   └─ builtin → 注入 System Prompt
│
├─ 5. Output Schema 注入 (若技能定義了 output_schema)
├─ 6. prompt_variables 替換 System Prompt 中的 {{var}}
│
├─ 7. TAG 自動路由
│   ├─ 載入所有啟用的 MCP / DIFY / KB 工具，附帶 tags
│   ├─ tagRouter.autoRouteByTags() 篩選
│   └─ 技能 KB binding (kb_mode) 覆蓋
│
├─ 8. 知識庫查詢 (自建 KB + DIFY KB)
│   └─ 結果注入 System Prompt
│
├─ 9. MCP 工具聲明 (Gemini Function Declarations)
│   ├─ 角色授權的 MCP 伺服器工具
│   ├─ 技能 MCP 模式覆蓋 (append/exclusive/disable)
│   └─ Code 技能 tool_schema 聲明
│
├─ 10. Gemini generateContentStream()
│   ├─ SSE 串流回傳 chunk
│   ├─ Function Call → toolHandler 處理
│   │   ├─ MCP 工具 → HTTP 呼叫 MCP 伺服器
│   │   └─ Code 技能 tool → HTTP 呼叫 Code Runner
│   └─ Function Response → 繼續生成
│
├─ 11. 儲存 chat_message + 更新 token_usage
├─ 12. 敏感用語稽核 (audit_logs)
└─ 13. SSE: done event
```

---

## 7. 資料庫 Schema（新增欄位與表）

### 7.1 新增欄位

```sql
-- MCP 伺服器
ALTER TABLE mcp_servers ADD tags CLOB DEFAULT '[]';

-- DIFY 知識庫
ALTER TABLE dify_knowledge_bases ADD tags CLOB DEFAULT '[]';

-- 自建知識庫
ALTER TABLE knowledge_bases ADD tags CLOB DEFAULT '[]';

-- 技能擴充欄位
ALTER TABLE skills ADD self_kb_ids      CLOB DEFAULT '[]';
ALTER TABLE skills ADD dify_kb_ids      CLOB DEFAULT '[]';
ALTER TABLE skills ADD kb_mode          VARCHAR2(20) DEFAULT 'append';
ALTER TABLE skills ADD tool_schema      CLOB;
ALTER TABLE skills ADD output_schema    CLOB;
ALTER TABLE skills ADD rate_limit_per_user NUMBER;
ALTER TABLE skills ADD rate_limit_global  NUMBER;
ALTER TABLE skills ADD rate_limit_window  VARCHAR2(10) DEFAULT 'hour';
ALTER TABLE skills ADD prompt_version   NUMBER DEFAULT 1;
ALTER TABLE skills ADD published_prompt CLOB;
ALTER TABLE skills ADD draft_prompt     CLOB;
ALTER TABLE skills ADD workflow_json    CLOB;

-- Session 技能變數
ALTER TABLE session_skills ADD variables_json CLOB DEFAULT '{}';
```

### 7.2 新增表

```sql
-- 技能版本歷史
CREATE TABLE skill_prompt_versions (
  id            NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  skill_id      NUMBER NOT NULL,
  version       NUMBER NOT NULL,
  prompt        CLOB,
  workflow_json CLOB,
  published_by  NUMBER,
  published_at  TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- Workflow 執行紀錄（備用）
CREATE TABLE skill_workflows (
  id            NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  skill_id      NUMBER NOT NULL,
  execution_id  VARCHAR2(64),
  status        VARCHAR2(20) DEFAULT 'running',
  input_json    CLOB,
  output_json   CLOB,
  error_message CLOB,
  started_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
  completed_at  TIMESTAMP
);
```

---

## 8. 檔案索引

| 檔案 | 說明 |
|------|------|
| `server/services/tagRouter.js` | TAG 自動路由引擎 |
| `server/services/workflowEngine.js` | Workflow DAG 執行引擎 |
| `server/routes/chat.js` | 對話主路由（含 TAG 路由、速率限制、tool_schema 註冊） |
| `server/routes/skills.js` | 技能 CRUD + 版本控制 API |
| `server/routes/mcpServers.js` | MCP 伺服器管理（含 tags） |
| `server/routes/difyKnowledgeBases.js` | DIFY 知識庫管理（含 tags） |
| `server/routes/knowledgeBase.js` | 自建知識庫管理（含 tags） |
| `server/database-oracle.js` | Schema migration（safeAddColumn） |
| `client/src/pages/SkillMarket.tsx` | 技能市集前端（5 頁籤編輯器） |
| `client/src/pages/ChatPage.tsx` | 對話頁（prompt_variables 表單） |
| `client/src/components/workflow/WorkflowEditor.tsx` | React Flow 視覺化編輯器 |
| `client/src/components/common/TagInput.tsx` | 通用 TAG 輸入元件 |
| `client/src/pages/KnowledgeBaseDetailPage.tsx` | KB 詳情頁（行內編輯 + tags） |
| `client/src/components/admin/MCPServersPanel.tsx` | MCP 管理面板（tags） |
| `client/src/components/admin/DifyKnowledgeBasesPanel.tsx` | DIFY 管理面板（tags） |
