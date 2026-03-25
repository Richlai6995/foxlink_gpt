# FOXLINK GPT v2.0 測試計畫

# TAG 自動路由 + Workflow 引擎 + 技能進階功能

> 版本：v2.0
> 建立日期：2026-03-25
> 涵蓋範圍：TAG 自動路由、Workflow 引擎、技能版本控制、prompt_variables、tool_schema、output_schema、速率限制、KB 綁定、Tags 欄位

---

## 目錄

1. [測試環境準備](#1-測試環境準備)
2. [TAG 自動路由](#2-tag-自動路由)
3. [Workflow 工作流程引擎](#3-workflow-工作流程引擎)
4. [技能版本控制](#4-技能版本控制)
5. [Prompt 輸入變數 (prompt_variables)](#5-prompt-輸入變數-prompt_variables)
6. [Tool Schema (Gemini Function Calling)](#6-tool-schema-gemini-function-calling)
7. [Output Schema](#7-output-schema)
8. [速率限制 (Rate Limiting)](#8-速率限制-rate-limiting)
9. [知識庫綁定 (KB Binding)](#9-知識庫綁定-kb-binding)
10. [MCP 伺服器 Tags](#10-mcp-伺服器-tags)
11. [DIFY 知識庫 Tags](#11-dify-知識庫-tags)
12. [自建知識庫 Tags + 行內編輯](#12-自建知識庫-tags--行內編輯)
13. [Workflow 視覺化編輯器 (React Flow)](#13-workflow-視覺化編輯器-react-flow)
14. [技能市集 UI 完整性](#14-技能市集-ui-完整性)
15. [整合測試（End-to-End）](#15-整合測試end-to-end)
16. [邊界與異常測試](#16-邊界與異常測試)

---

## 1. 測試環境準備

### 1.1 前置條件

| 項目 | 說明 |
|------|------|
| Server | `cd server && npm run dev`（port 3001） |
| Client | `cd client && npm run dev`（port 5173） |
| DB | Oracle 23 AI，schema migration 已執行完成 |
| 管理員帳號 | ADMIN / 123456 |
| 測試使用者 | 至少建立 2 個一般使用者帳號（UserA、UserB） |
| MCP 伺服器 | 至少 1 個已同步的 MCP 伺服器 |
| DIFY 知識庫 | 至少 1 個已啟用的 DIFY KB |
| 自建知識庫 | 至少 1 個已上傳文件的自建 KB |
| 技能 | 至少各 1 個 builtin / external / code 技能 |

### 1.2 DB Schema 驗證

在開始測試前，確認以下欄位已存在：

```sql
-- 檢查新增欄位
SELECT column_name FROM user_tab_columns WHERE table_name = 'SKILLS' AND column_name IN (
  'SELF_KB_IDS', 'DIFY_KB_IDS', 'KB_MODE', 'TOOL_SCHEMA', 'OUTPUT_SCHEMA',
  'RATE_LIMIT_PER_USER', 'RATE_LIMIT_GLOBAL', 'RATE_LIMIT_WINDOW',
  'PROMPT_VERSION', 'PUBLISHED_PROMPT', 'DRAFT_PROMPT', 'WORKFLOW_JSON'
);

SELECT column_name FROM user_tab_columns WHERE table_name = 'MCP_SERVERS' AND column_name = 'TAGS';
SELECT column_name FROM user_tab_columns WHERE table_name = 'DIFY_KNOWLEDGE_BASES' AND column_name = 'TAGS';
SELECT column_name FROM user_tab_columns WHERE table_name = 'KNOWLEDGE_BASES' AND column_name = 'TAGS';
SELECT column_name FROM user_tab_columns WHERE table_name = 'SESSION_SKILLS' AND column_name = 'VARIABLES_JSON';

-- 檢查新增表
SELECT table_name FROM user_tables WHERE table_name IN ('SKILL_PROMPT_VERSIONS', 'SKILL_WORKFLOWS');
```

- [ ] 所有欄位皆存在
- [ ] 兩張新表皆存在

---

## 2. TAG 自動路由

> 對應檔案：`server/services/tagRouter.js`、`server/routes/chat.js`

### 2.1 TAG 設定

#### TC-2.1.1 MCP 伺服器設定 Tags

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 管理員登入 → 系統管理 → MCP 伺服器 | 看到 MCP 伺服器清單 |
| 2 | 編輯一個 MCP 伺服器，在 Tags 輸入框輸入「ERP」按 Enter | Tag chip 出現「ERP」 |
| 3 | 繼續輸入「工單」「庫存」，用逗號分隔 | 出現 3 個 tag chips |
| 4 | 點選「儲存」 | 儲存成功，重新整理後 tags 仍顯示正確 |
| 5 | DB 驗證：`SELECT tags FROM mcp_servers WHERE id = :id` | 回傳 `["ERP","工單","庫存"]` |

- [ ] 通過

#### TC-2.1.2 DIFY 知識庫設定 Tags

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 系統管理 → DIFY 知識庫 → 編輯 | 看到 Tags 輸入欄位 |
| 2 | 輸入「產品規格」「零件」 | 出現 2 個 tag chips |
| 3 | 儲存 | 儲存成功 |
| 4 | DB 驗證 | `["產品規格","零件"]` |

- [ ] 通過

#### TC-2.1.3 自建知識庫設定 Tags

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 知識庫市集 → 進入已有 KB → 設定頁籤 | 看到 Tags 輸入欄位 |
| 2 | 輸入「SOP」「技術手冊」 | 出現 2 個 tag chips |
| 3 | 儲存設定 | 儲存成功 |
| 4 | DB 驗證 | `["SOP","技術手冊"]` |

- [ ] 通過

#### TC-2.1.4 技能設定 Tags

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 技能市集 → 編輯技能 → 基本頁籤 | 看到 Tags 輸入欄位 |
| 2 | 輸入「翻譯」「日文」 | 出現 2 個 tag chips |
| 3 | 儲存 | 儲存成功 |

- [ ] 通過

#### TC-2.1.5 Tags 移除操作

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 編輯已有 3 個 tags 的 MCP 伺服器 | 顯示 3 個 chips |
| 2 | 點選第 2 個 chip 的 X 按鈕 | 第 2 個 tag 被移除，剩 2 個 |
| 3 | 在輸入框按 Backspace（輸入框為空） | 最後一個 tag 被移除 |
| 4 | 儲存 | 只剩 1 個 tag |

- [ ] 通過

#### TC-2.1.6 Tags 重複防護

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 輸入「ERP」按 Enter | Tag 出現 |
| 2 | 再次輸入「ERP」按 Enter | 不新增重複 tag，輸入框清空 |

- [ ] 通過

### 2.2 TAG 路由運作

#### TC-2.2.1 精準 TAG 匹配

**前置**：MCP 伺服器 A 設定 tags=["ERP","工單"]，MCP 伺服器 B 設定 tags=["HR","人資"]

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 開啟新對話 | — |
| 2 | 輸入「查一下工單 WO12345 的狀態」 | — |
| 3 | 觀察 server console 日誌 | 顯示 `[TAG Router] intent tags: ["工單", ...]` |
| 4 | 觀察 TAG 匹配結果 | 匹配到 MCP 伺服器 A（因「工單」命中） |
| 5 | AI 回覆 | 使用 MCP 伺服器 A 的工具回答 |

- [ ] 通過

#### TC-2.2.2 TAG 模糊匹配（部分包含）

**前置**：DIFY KB 設定 tags=["HR人資管理"]

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 輸入「人資相關的請假規定」 | — |
| 2 | 觀察 console | Flash 萃取標籤含「人資」 |
| 3 | 匹配結果 | 「人資」⊂「HR人資管理」→ 命中 DIFY KB |

- [ ] 通過

#### TC-2.2.3 TAG+Description 精篩

**前置**：設定 5 個以上工具都有相似 tags（如都包含「查詢」）

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 輸入一個明確意圖的訊息 | — |
| 2 | 觀察 console | TAG 比對命中多個候選 |
| 3 | 觀察 Description 精篩 | Flash 根據描述進一步篩選，回傳最精準的 |
| 4 | method 為 `tag+description` | 日誌顯示 method 值 |

- [ ] 通過

#### TC-2.2.4 Fallback 到傳統 intent

**前置**：所有工具/KB 都不設定 tags（tags=[]）

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 發送訊息 | — |
| 2 | 觀察 console | TAG 比對結果為空 |
| 3 | 系統回退 | 使用傳統 intent 篩選（filterDifyDeclsByIntent / filterMcpDeclsByIntent） |
| 4 | method 為 `fallback` | 日誌顯示 method 值 |

- [ ] 通過

#### TC-2.2.5 一般閒聊不觸發工具

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 輸入「你好，今天天氣如何？」 | — |
| 2 | 觀察 console | Flash 萃取 tags 為空 `[]` 或只有通用詞 |
| 3 | 結果 | 不啟用任何特定工具，AI 直接回答 |

- [ ] 通過

#### TC-2.2.6 TAG 路由 API 異常容錯

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 暫時修改 GEMINI_API_KEY 為無效值 | — |
| 2 | 發送訊息 | — |
| 3 | 觀察 | extractIntentTags 失敗 → 回傳 [] → fallback |
| 4 | 系統不崩潰 | 正常回退到傳統篩選或直接回覆 |
| 5 | 還原 API Key | — |

- [ ] 通過

---

## 3. Workflow 工作流程引擎

> 對應檔案：`server/services/workflowEngine.js`、`client/src/components/workflow/WorkflowEditor.tsx`

### 3.1 Workflow 建立

#### TC-3.1.1 建立 Workflow 類型技能

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 技能市集 → 建立技能 | 開啟編輯頁面 |
| 2 | 名稱：「測試工作流程」 | — |
| 3 | 類型選擇「workflow」 | 編輯器顯示 Workflow 視覺化編輯區域 |
| 4 | 儲存 | 技能建立成功，type=workflow |
| 5 | DB 驗證 | `SELECT type FROM skills WHERE name='測試工作流程'` → `workflow` |

- [ ] 通過

#### TC-3.1.2 最簡流程：Start → Output

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 在 Workflow 編輯器中 | 預設已有一個 Start 節點 |
| 2 | 從左側面板拖入 Output 節點 | 畫布上出現 Output 節點 |
| 3 | 從 Start 連線到 Output | 邊建立成功 |
| 4 | 點選 Output 節點 → 右側配置面板 | 設定 content=`{{start.input}}` |
| 5 | 儲存 Workflow | JSON 正確寫入 |
| 6 | 在對話中掛載此技能 → 發送「Hello」 | 回覆「Hello」（透傳輸入） |

- [ ] 通過

#### TC-3.1.3 LLM 節點流程：Start → LLM → Output

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 新增 LLM 節點，設定 system_prompt=「你是翻譯員，將輸入翻譯為英文」 | — |
| 2 | 連線：Start → LLM → Output | — |
| 3 | Output 的 content=`{{llm_1.output}}` | — |
| 4 | 儲存 | — |
| 5 | 對話中發送「你好」 | 回覆英文翻譯 |

- [ ] 通過

#### TC-3.1.4 知識庫節點流程：Start → KB → LLM → Output

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 新增 Knowledge Base 節點，選擇已有的 KB | — |
| 2 | KB 節點的 query=`{{start.input}}` | — |
| 3 | 新增 LLM 節點，system_prompt=「根據以下資料回答：{{kb_1.output}}」 | — |
| 4 | 連線：Start → KB → LLM → Output | — |
| 5 | 發送一個 KB 中有對應內容的問題 | AI 引用 KB 資料回答 |

- [ ] 通過

#### TC-3.1.5 條件分支流程

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 建立流程：Start → Condition → (default) LLM_A / (else) LLM_B → Output | — |
| 2 | Condition 規則：field=`start.input`、op=`contains`、value=`緊急` | — |
| 3 | LLM_A 的 system_prompt=「這是緊急事項，優先處理：」 | — |
| 4 | LLM_B 的 system_prompt=「一般事項處理：」 | — |
| 5 | 發送「緊急！機台故障」 | 走 LLM_A 路徑 |
| 6 | 發送「請問會議室怎麼預約」 | 走 LLM_B 路徑（else 分支） |

- [ ] 通過

#### TC-3.1.6 HTTP 請求節點

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 新增 HTTP Request 節點 | — |
| 2 | URL=`https://httpbin.org/post`、method=POST、body=`{"msg":"{{start.input}}"}` | — |
| 3 | 連線：Start → HTTP → Template → Output | — |
| 4 | Template: `API 回應：{{http_1.output}}` | — |
| 5 | 發送訊息 | 回覆包含 httpbin 的 echo 結果 |

- [ ] 通過

#### TC-3.1.7 Template 節點組合多個輸出

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 流程：Start → (並行) KB_1 + LLM_1 → Template → Output | — |
| 2 | Template: `知識庫結果：{{kb_1.output}}\n\nAI 分析：{{llm_1.output}}` | — |
| 3 | 發送訊息 | 回覆同時包含 KB 結果和 LLM 分析 |

- [ ] 通過

#### TC-3.1.8 Code 節點

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 新增 Code 節點 | — |
| 2 | code=`return JSON.stringify({result: input.toUpperCase()})` | — |
| 3 | 連線：Start → Code → Output | — |
| 4 | 發送「hello world」 | 回覆 `{"result":"HELLO WORLD"}` |

- [ ] 通過

### 3.2 Workflow 執行邊界

#### TC-3.2.1 空 Workflow（無節點）

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 建立 type=workflow 但 workflow_json 為空 | — |
| 2 | 在對話中掛載並發送訊息 | 系統回傳錯誤或空回覆，不崩潰 |

- [ ] 通過

#### TC-3.2.2 節點上限保護（50 節點）

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 嘗試建立超過 50 個節點的 Workflow | — |
| 2 | 執行 | 引擎在第 50 次迭代後停止，回傳已有結果 |

- [ ] 通過

#### TC-3.2.3 節點引用不存在的 nodeId

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | Template 中使用 `{{nonexistent.output}}` | — |
| 2 | 執行 | 佔位符不被替換或替換為空字串，不崩潰 |

- [ ] 通過

#### TC-3.2.4 Condition 節點無規則匹配

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 條件規則都不符合 | — |
| 2 | 執行 | 走第一條邊（預設路徑） |

- [ ] 通過

---

## 4. 技能版本控制

> 對應檔案：`server/routes/skills.js`（publish / versions / rollback）

### TC-4.1 發佈第一個版本

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 建立一個 builtin 技能，system_prompt=「你是助手 v1」 | prompt_version=1 |
| 2 | 進入技能編輯 → 版本歷史頁籤 | 顯示「尚無版本歷史」或空列表 |
| 3 | 點選「發佈新版本」 | 彈出確認或備註欄位 |
| 4 | 輸入備註「初始版本」→ 確認 | 發佈成功提示 |
| 5 | DB 驗證 `skill_prompt_versions` | 有一筆 skill_id=X, version=1 的記錄 |
| 6 | 技能的 `published_prompt` | = 「你是助手 v1」 |
| 7 | 技能的 `prompt_version` | = 2（已遞增） |

- [ ] 通過

### TC-4.2 修改後發佈第二版

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 修改 system_prompt=「你是助手 v2，更聰明」 → 儲存 | — |
| 2 | 發佈新版本，備註「增強能力」 | 版本號遞增到 3 |
| 3 | 版本歷史頁籤 | 顯示 2 個版本（v1, v2） |
| 4 | 點選 v1 查看 | 顯示原始 prompt「你是助手 v1」 |

- [ ] 通過

### TC-4.3 回滾到歷史版本

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 在版本歷史中找到 v1 | — |
| 2 | 點選「回滾」 | 確認對話框 |
| 3 | 確認回滾 | 成功提示 |
| 4 | 檢查 system_prompt | 恢復為「你是助手 v1」 |
| 5 | 在對話中使用此技能 | AI 行為符合 v1 的 prompt |

- [ ] 通過

### TC-4.4 回滾不存在的版本

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | API 呼叫 `POST /api/skills/:id/rollback/999` | — |
| 2 | 預期 | 回傳 404「版本不存在」 |

- [ ] 通過

### TC-4.5 非擁有者無法發佈/回滾

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 以 UserB 登入（非技能擁有者、非管理員） | — |
| 2 | 呼叫 `POST /api/skills/:id/publish` | 回傳 403 |
| 3 | 呼叫 `POST /api/skills/:id/rollback/1` | 回傳 403 |

- [ ] 通過

### TC-4.6 Workflow 技能的版本控制

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 建立 workflow 技能，設計簡單流程 | — |
| 2 | 發佈 v1 | workflow_json 記錄在版本歷史中 |
| 3 | 修改流程（新增節點）→ 發佈 v2 | — |
| 4 | 回滾到 v1 | workflow_json 恢復為 v1 的流程 |
| 5 | 在對話中執行 | 使用 v1 的流程 |

- [ ] 通過

---

## 5. Prompt 輸入變數 (prompt_variables)

> 對應檔案：`server/routes/chat.js`、`client/src/pages/ChatPage.tsx`、`client/src/pages/SkillMarket.tsx`

### TC-5.1 定義 prompt_variables

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 技能市集 → 編輯技能 → I/O 頁籤 | 看到 prompt_variables 欄位 |
| 2 | 輸入 JSON：`[{"name":"target_lang","label":"目標語言","type":"select","required":true,"options":["日文","韓文","英文"]},{"name":"style","label":"風格","type":"text","default":"正式"}]` | JSON 格式驗證通過 |
| 3 | system_prompt 設為：`你是翻譯員，翻譯為 {{target_lang}}，風格：{{style}}` | — |
| 4 | 儲存 | 儲存成功 |

- [ ] 通過

### TC-5.2 掛載技能時顯示變數表單

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 開啟對話 → 頂部「技能」按鈕 → 選擇此技能 | — |
| 2 | 點選「確認掛載」 | 彈出變數填寫表單 |
| 3 | 表單內容 | 「目標語言」下拉選單（日文/韓文/英文）＋「風格」文字輸入框（預設值「正式」） |
| 4 | 選擇「日文」、風格改為「口語」→ 確認 | 表單關閉，技能掛載成功 |
| 5 | DB 驗證 `session_skills.variables_json` | `{"target_lang":"日文","style":"口語"}` |

- [ ] 通過

### TC-5.3 變數替換實際生效

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 在掛載了上述技能的對話中發送「你好世界」 | — |
| 2 | AI 回覆 | 將「你好世界」翻譯為日文，口語風格 |
| 3 | 觀察 server console | system_prompt 中 `{{target_lang}}` 已替換為「日文」 |

- [ ] 通過

### TC-5.4 各種變數類型測試

| 變數類型 | 設定 | 預期表單元件 |
|----------|------|-------------|
| `text` | `{"name":"a","type":"text"}` | 單行文字輸入框 |
| `textarea` | `{"name":"b","type":"textarea"}` | 多行文字區域 |
| `select` | `{"name":"c","type":"select","options":["X","Y"]}` | 下拉選單 |
| `number` | `{"name":"d","type":"number"}` | 數字輸入框 |
| `date` | `{"name":"e","type":"date"}` | 日期選擇器 |
| `checkbox` | `{"name":"f","type":"checkbox"}` | 勾選框 |

- [ ] 所有類型均正確渲染

### TC-5.5 必填變數驗證

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 定義 `required: true` 的變數 | — |
| 2 | 掛載時不填寫必填欄位，點確認 | 表單顯示錯誤提示或無法送出 |
| 3 | 填寫後再確認 | 成功掛載 |

- [ ] 通過

### TC-5.6 無 prompt_variables 的技能

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 掛載一個沒有定義 prompt_variables 的技能 | — |
| 2 | 預期 | 直接掛載成功，不彈出變數表單 |

- [ ] 通過

---

## 6. Tool Schema (Gemini Function Calling)

> 對應檔案：`server/routes/chat.js`（codeSkillToolMap / toolHandler）

### TC-6.1 定義 tool_schema

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 建立 type=code 技能 | — |
| 2 | 在 I/O 頁籤的 tool_schema 欄位輸入 JSON：`{"name":"get_stock_price","description":"查詢股票即時股價","parameters":{"type":"object","properties":{"stock_code":{"type":"string","description":"股票代號"}},"required":["stock_code"]}}` | — |
| 3 | 撰寫 code_snippet（回傳股價資料） | — |
| 4 | 儲存，啟動 Code Runner | — |

- [ ] 通過

### TC-6.2 LLM 自主決定呼叫

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 掛載此技能到對話 | — |
| 2 | 發送「台積電現在股價多少」 | — |
| 3 | 觀察 | AI 自動呼叫 get_stock_price function，參數 stock_code=「2330」 |
| 4 | Code Runner 處理 | 回傳股價資料 |
| 5 | AI 整合結果回覆 | 自然語言回覆股價 |

- [ ] 通過

### TC-6.3 不相關問題不觸發 tool

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 同一對話發送「今天中午吃什麼好？」 | — |
| 2 | 觀察 | AI 不呼叫 get_stock_price，直接回答 |

- [ ] 通過

### TC-6.4 無 tool_schema 的 Code 技能

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 掛載一個沒有 tool_schema 的 code 技能 | — |
| 2 | 發送訊息 | 按原有 inject/answer 模式運作 |
| 3 | tool_schema 不影響原有行為 | 正常回覆 |

- [ ] 通過

---

## 7. Output Schema

> 對應檔案：`server/routes/chat.js`

### TC-7.1 設定 output_schema

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 編輯技能 → I/O 頁籤 → output_schema | — |
| 2 | 輸入：`{"type":"object","properties":{"summary":{"type":"string"},"score":{"type":"number"},"tags":{"type":"array","items":{"type":"string"}}}}` | — |
| 3 | 儲存 | — |

- [ ] 通過

### TC-7.2 AI 依 schema 格式回覆

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 掛載此技能，發送「分析一下 React 框架」 | — |
| 2 | AI 回覆 | JSON 格式，包含 summary、score、tags 欄位 |
| 3 | 回覆可被 `JSON.parse()` | 格式正確 |

- [ ] 通過

### TC-7.3 無 output_schema 不影響原有行為

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 掛載無 output_schema 的技能 | — |
| 2 | 發送訊息 | AI 以自由格式回覆（markdown 等） |

- [ ] 通過

---

## 8. 速率限制 (Rate Limiting)

> 對應檔案：`server/routes/chat.js`

### TC-8.1 設定速率限制

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 編輯技能 → 進階頁籤 | — |
| 2 | 每人上限=3，全域上限=10，時間窗口=minute | — |
| 3 | 儲存 | — |
| 4 | DB 驗證 | rate_limit_per_user=3, rate_limit_global=10, rate_limit_window='minute' |

- [ ] 通過

### TC-8.2 每人限制觸發

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 以 UserA 掛載此技能 | — |
| 2 | 連續發送 3 則訊息 | 正常回覆 |
| 3 | 發送第 4 則訊息 | 回傳速率限制提示（如「已超過使用者速率限制，請稍後再試」） |
| 4 | 等待 1 分鐘後再試 | 恢復正常 |

- [ ] 通過

### TC-8.3 全域限制觸發

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 設定 rate_limit_global=5，rate_limit_per_user=空 | — |
| 2 | UserA 發送 3 則 | 正常 |
| 3 | UserB 發送 2 則 | 正常 |
| 4 | UserA 或 UserB 發送第 6 則 | 回傳全域速率限制提示 |

- [ ] 通過

### TC-8.4 不同時間窗口

| 窗口 | 設定值 | 驗證方式 |
|------|--------|----------|
| minute | `rate_limit_window='minute'` | 1 分鐘內超過上限被擋 |
| hour | `rate_limit_window='hour'` | 同一小時內累計 |
| day | `rate_limit_window='day'` | 同一天內累計 |

- [ ] 所有窗口類型驗證通過

### TC-8.5 無速率限制（欄位為空）

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 技能的 rate_limit_per_user 和 rate_limit_global 都為空 | — |
| 2 | 連續發送多則訊息 | 不受限制 |

- [ ] 通過

---

## 9. 知識庫綁定 (KB Binding)

> 對應檔案：`server/routes/chat.js`、`client/src/pages/SkillMarket.tsx`

### TC-9.1 設定 KB 綁定

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 編輯技能 → 工具與知識庫頁籤 | — |
| 2 | 自建知識庫綁定：勾選已有的 KB | self_kb_ids 陣列更新 |
| 3 | DIFY 知識庫綁定：勾選已有的 DIFY KB | dify_kb_ids 陣列更新 |
| 4 | KB 模式選擇「append」 | — |
| 5 | 儲存 | — |

- [ ] 通過

### TC-9.2 append 模式

**前置**：技能綁定 KB_A，使用者手動掛載 KB_B

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 掛載此技能到對話 | — |
| 2 | 手動掛載 KB_B 到同一對話 | — |
| 3 | 發送訊息 | KB_A 和 KB_B 都被查詢 |
| 4 | AI 回覆 | 可能同時引用兩個 KB 的內容 |

- [ ] 通過

### TC-9.3 exclusive 模式

**前置**：技能綁定 KB_A，KB 模式=exclusive

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 掛載此技能 + 手動掛載 KB_B | — |
| 2 | 發送訊息 | 只查詢 KB_A，忽略 KB_B |
| 3 | AI 回覆 | 只引用 KB_A 的內容 |

- [ ] 通過

### TC-9.4 disable 模式

**前置**：技能設定 KB 模式=disable

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 掛載此技能 + 手動掛載多個 KB | — |
| 2 | 發送訊息 | 不查詢任何知識庫 |
| 3 | AI 回覆 | 純粹依賴 LLM 自身知識 |

- [ ] 通過

### TC-9.5 無綁定的技能

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 掛載一個 self_kb_ids=[] 的技能 | — |
| 2 | 手動掛載 KB_B | — |
| 3 | 發送訊息 | 正常查詢 KB_B（不受技能影響） |

- [ ] 通過

---

## 10. MCP 伺服器 Tags

> 對應檔案：`server/routes/mcpServers.js`、`client/src/components/admin/MCPServersPanel.tsx`

### TC-10.1 新增 MCP 伺服器時設定 Tags

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 系統管理 → MCP 伺服器 → 新增 | — |
| 2 | 填寫名稱、URL | — |
| 3 | Tags 欄位輸入「天氣」「查詢」 | 出現 2 個 chips |
| 4 | 儲存 | 成功 |
| 5 | DB 驗證 | tags=`["天氣","查詢"]` |

- [ ] 通過

### TC-10.2 編輯 MCP 伺服器 Tags

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 編輯已有 tags 的伺服器 | tags 正確回顯 |
| 2 | 移除一個 tag、新增一個 tag | — |
| 3 | 儲存 | tags 更新成功 |

- [ ] 通過

### TC-10.3 Tags 為空陣列

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 移除所有 tags → 儲存 | — |
| 2 | DB 驗證 | tags=`[]` |
| 3 | TAG 路由時 | 此伺服器不被 TAG 比對命中，走 fallback 路徑 |

- [ ] 通過

---

## 11. DIFY 知識庫 Tags

> 對應檔案：`server/routes/difyKnowledgeBases.js`、`client/src/components/admin/DifyKnowledgeBasesPanel.tsx`

### TC-11.1 新增 DIFY KB 時設定 Tags

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 系統管理 → DIFY 知識庫 → 新增 | — |
| 2 | 填寫名稱、API Server、API Key | — |
| 3 | Tags 輸入「產品」「規格」 | 出現 chips |
| 4 | 儲存 | 成功 |
| 5 | DB 驗證 | tags=`["產品","規格"]` |

- [ ] 通過

### TC-11.2 編輯 DIFY KB Tags

同 TC-10.2 流程，針對 DIFY KB。

- [ ] 通過

---

## 12. 自建知識庫 Tags + 行內編輯

> 對應檔案：`server/routes/knowledgeBase.js`、`client/src/pages/KnowledgeBaseDetailPage.tsx`

### TC-12.1 Tags 設定

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 進入 KB 詳情頁 → 設定頁籤 | 看到 Tags 輸入欄位 |
| 2 | 輸入「SOP」「ISO」 | 出現 chips |
| 3 | 儲存 | 成功 |

- [ ] 通過

### TC-12.2 行內編輯名稱

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 進入 KB 詳情頁 | 頂部顯示 KB 名稱，旁邊有鉛筆圖示 |
| 2 | 點選鉛筆圖示 | 名稱變為可編輯的輸入框 |
| 3 | 修改名稱為「新名稱」→ 確認 | 名稱更新成功 |
| 4 | 重新整理頁面 | 仍顯示「新名稱」 |

- [ ] 通過

### TC-12.3 行內編輯描述

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 點選描述旁的鉛筆圖示 | 描述變為可編輯 |
| 2 | 修改描述 → 確認 | 更新成功 |

- [ ] 通過

### TC-12.4 行內編輯權限控制

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 以非擁有者（僅有 use 權限）進入 KB 詳情 | — |
| 2 | 觀察 | 鉛筆圖示不顯示（或點選無效） |

- [ ] 通過

---

## 13. Workflow 視覺化編輯器 (React Flow)

> 對應檔案：`client/src/components/workflow/WorkflowEditor.tsx`

### TC-13.1 拖拉新增節點

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 在 Workflow 編輯器左側面板 | 顯示 11 種節點類型 |
| 2 | 從面板拖拉「LLM」到畫布 | 畫布上出現 LLM 節點 |
| 3 | 拖拉「Condition」到畫布 | Condition 節點出現，有 2 個 source handle（default + else） |

- [ ] 通過

### TC-13.2 節點連線

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 從 Start 節點的 source handle 拖向 LLM 的 target handle | 連線建立 |
| 2 | 嘗試反向連線（target → source） | 不允許或自動修正方向 |

- [ ] 通過

### TC-13.3 節點配置面板

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 點選 LLM 節點 | 右側顯示配置面板 |
| 2 | 面板內容 | model 下拉、system_prompt 文字區域、user_prompt 文字區域 |
| 3 | 點選 HTTP Request 節點 | 面板顯示 url、method、headers、body 欄位 |
| 4 | 點選 Condition 節點 | 面板顯示 rules 陣列編輯器（field、operator、value） |

- [ ] 通過

### TC-13.4 刪除節點

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 選取節點 → 按 Delete 或 Backspace | 節點及其連線被刪除 |
| 2 | 刪除 Start 節點 | 允許刪除（但執行時會出錯） |

- [ ] 通過

### TC-13.5 儲存與載入

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 設計一個包含 5 個節點的流程 | — |
| 2 | 點選技能的「儲存」 | workflow_json 正確序列化 |
| 3 | 重新開啟此技能的編輯頁面 | 流程圖完整還原（節點位置、連線、設定） |

- [ ] 通過

### TC-13.6 Condition 節點雙 Handle

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 新增 Condition 節點 | 節點顯示 2 個 source handle |
| 2 | 上方 handle 標示 default（符合條件） | — |
| 3 | 下方 handle 標示 else（不符合） | — |
| 4 | 分別連到不同節點 | 兩條分支路徑建立 |

- [ ] 通過

---

## 14. 技能市集 UI 完整性

> 對應檔案：`client/src/pages/SkillMarket.tsx`

### TC-14.1 五頁籤結構

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 建立或編輯技能 | — |
| 2 | 確認有 5 個頁籤 | 基本、工具與知識庫、I/O、進階、版本歷史 |
| 3 | 切換各頁籤 | 內容正確顯示，不閃爍或消失 |

- [ ] 通過

### TC-14.2 基本頁籤

| 欄位 | 操作 | 預期 |
|------|------|------|
| 名稱 | 輸入 | 必填驗證 |
| 描述 | 輸入 | 選填 |
| 圖示 | 選擇 | icon picker |
| 類型 | 選擇 builtin/external/code/workflow | 對應欄位顯示/隱藏 |
| Tags | 輸入 | TagInput 元件 |
| System Prompt | 輸入 | 大文字區域（builtin/external 時顯示） |

- [ ] 通過

### TC-14.3 工具與知識庫頁籤

| 欄位 | 操作 | 預期 |
|------|------|------|
| MCP 工具模式 | 選擇 append/exclusive/disable | — |
| MCP 工具選擇 | 勾選伺服器 | mcp_tool_ids 更新 |
| 自建 KB 綁定 | 勾選 KB | self_kb_ids 更新 |
| DIFY KB 綁定 | 勾選 DIFY KB | dify_kb_ids 更新 |
| KB 模式 | 選擇 append/exclusive/disable | kb_mode 更新 |

- [ ] 通過

### TC-14.4 I/O 頁籤

| 欄位 | 操作 | 預期 |
|------|------|------|
| prompt_variables | JSON 輸入 | 格式驗證 |
| tool_schema | JSON 輸入 | 僅 type=code 時顯示 |
| output_schema | JSON 輸入 | JSON 格式驗證 |

- [ ] 通過

### TC-14.5 進階頁籤

| 欄位 | 操作 | 預期 |
|------|------|------|
| 模型選擇 | 下拉 | model_key 更新 |
| 速率限制 - 每人上限 | 數字輸入 | 正整數或空 |
| 速率限制 - 全域上限 | 數字輸入 | 正整數或空 |
| 速率限制 - 時間窗口 | 選擇 minute/hour/day | — |
| Workflow 編輯器 | 僅 type=workflow 時顯示 | React Flow 畫布 |

- [ ] 通過

### TC-14.6 版本歷史頁籤

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | 無歷史版本 | 顯示提示文字（如「尚無版本歷史」） |
| 2 | 有歷史版本 | 列表顯示：版本號、時間、備註、操作按鈕 |
| 3 | 點選「發佈新版本」 | 新版本加入列表 |
| 4 | 點選「回滾」 | 確認後恢復 |

- [ ] 通過

### TC-14.7 Workflow 類型切換

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | 類型從 builtin 切換為 workflow | System Prompt 區域隱藏，Workflow 編輯器顯示 |
| 2 | 類型從 workflow 切換為 code | Workflow 編輯器隱藏，Code Snippet 區域顯示 |

- [ ] 通過

---

## 15. 整合測試（End-to-End）

### TC-15.1 完整流程：建立 Workflow 技能 → TAG 路由 → 對話

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 建立 workflow 技能，名稱=「智慧客服」 | — |
| 2 | 設定 tags=["客服","FAQ","問題"] | — |
| 3 | 設計 workflow：Start → KB（公司FAQ庫）→ LLM → Output | — |
| 4 | 定義 prompt_variables：`[{"name":"dept","label":"部門","type":"select","options":["IT","HR","財務"]}]` | — |
| 5 | KB 節點 query=`{{var.dept}} {{start.input}}` | — |
| 6 | 設定 rate_limit_per_user=20, window=hour | — |
| 7 | 發佈 v1 | — |
| 8 | 開啟新對話，不手動選擇任何工具 | — |
| 9 | 輸入「客服相關的問題怎麼處理」 | TAG 路由自動匹配到此技能 |
| 10 | 彈出變數表單，選擇部門=「IT」 | — |
| 11 | 回覆 | KB 查詢「IT 客服相關的問題怎麼處理」→ LLM 整合回答 |

- [ ] 通過

### TC-15.2 完整流程：Code 技能 + Tool Schema + Output Schema

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 建立 type=code 技能，名稱=「匯率查詢」 | — |
| 2 | 設定 tool_schema（function: get_exchange_rate, params: currency_pair） | — |
| 3 | 設定 output_schema：`{"type":"object","properties":{"rate":{"type":"number"},"timestamp":{"type":"string"}}}` | — |
| 4 | 設定 tags=["匯率","外幣","exchange"] | — |
| 5 | 撰寫 code_snippet → 安裝套件 → 啟動 Code Runner | — |
| 6 | 開啟新對話，不手動掛載 | — |
| 7 | 輸入「美金對台幣匯率」 | TAG 路由命中「匯率」 |
| 8 | AI 自動呼叫 get_exchange_rate({"currency_pair":"USD/TWD"}) | — |
| 9 | Code Runner 回傳結果 | — |
| 10 | AI 以 JSON 格式回覆（含 rate 和 timestamp） | 符合 output_schema |

- [ ] 通過

### TC-15.3 多技能疊加 + KB 綁定衝突

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 技能 A：kb_mode=append，綁定 KB_1 | — |
| 2 | 技能 B：kb_mode=exclusive，綁定 KB_2 | — |
| 3 | 同時掛載技能 A 和技能 B | — |
| 4 | 發送訊息 | 觀察哪個 kb_mode 優先（後掛載的覆蓋？或以 exclusive 優先？） |
| 5 | 記錄實際行為 | 文件化衝突解決規則 |

- [ ] 通過（記錄行為）

### TC-15.4 版本回滾後對話驗證

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 技能 v1 prompt=「回覆限制 50 字」，v2 prompt=「回覆不限字數」 | — |
| 2 | 掛載技能發送訊息 → 觀察回覆長度（v2 行為） | 較長回覆 |
| 3 | 回滾到 v1 | — |
| 4 | 同一對話再發送訊息 | 回覆限制 50 字（v1 行為生效） |

- [ ] 通過

### TC-15.5 TAG 路由 + 傳統路由共存

**前置**：部分工具有 tags，部分沒有

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | MCP_A 有 tags=["ERP"]，MCP_B 沒有 tags | — |
| 2 | 發送「查 ERP 工單」 | TAG 路由命中 MCP_A |
| 3 | 發送一個跟 MCP_B 相關但無 TAG 的問題 | fallback 到 intent 篩選，可能命中 MCP_B |

- [ ] 通過

---

## 16. 邊界與異常測試

### TC-16.1 無效 JSON 欄位

| 場景 | 輸入 | 預期 |
|------|------|------|
| prompt_variables 非 JSON | `"not json"` | 前端驗證錯誤或後端忽略 |
| tool_schema 非 JSON | `{broken` | 前端驗證錯誤 |
| output_schema 非 JSON | `[}` | 前端驗證錯誤 |
| workflow_json 非 JSON | `"abc"` | 執行時回傳錯誤，不崩潰 |
| tags 非陣列 | `"string"` | 後端將其包裝為 `["string"]` 或拒絕 |

- [ ] 所有場景通過

### TC-16.2 空值與 null 處理

| 場景 | 預期 |
|------|------|
| self_kb_ids = null | 視為空陣列 [] |
| dify_kb_ids = null | 視為空陣列 [] |
| rate_limit_per_user = null | 不限制 |
| rate_limit_global = null | 不限制 |
| tool_schema = null | 不註冊 function declaration |
| output_schema = null | 不注入結構要求 |
| published_prompt = null | 使用 system_prompt |
| workflow_json = null | type=workflow 時回傳空結果 |
| variables_json = null | 視為空物件 {} |

- [ ] 所有場景通過

### TC-16.3 併發速率限制

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 設定 rate_limit_per_user=1, window=minute | — |
| 2 | 同時開兩個瀏覽器分頁，幾乎同時發送 | — |
| 3 | 預期 | 第 1 則成功，第 2 則被擋（或兩則都因 race condition 成功，但第 3 則一定被擋） |

- [ ] 通過

### TC-16.4 Workflow 節點異常

| 場景 | 預期 |
|------|------|
| LLM 節點 API Key 失效 | 該節點輸出 `[Error: ...]`，後續節點可引用錯誤訊息 |
| HTTP 節點目標 URL 不存在 | timeout 後輸出錯誤 |
| Code 節點語法錯誤 | 輸出 `[Error: ...]` |
| KB 節點指定不存在的 kb_id | 輸出 `[Error: ...]` |
| Condition 引用不存在的節點 | 走 default/else 路徑 |

- [ ] 所有場景通過

### TC-16.5 大量 Tags

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 為一個 MCP 伺服器設定 50 個 tags | — |
| 2 | 儲存 | 成功（CLOB 欄位無長度限制） |
| 3 | TAG 路由 | 比對仍正常運作 |

- [ ] 通過

### TC-16.6 Session Skill Variables 持久性

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 掛載有 prompt_variables 的技能，填寫變數 | — |
| 2 | 關閉瀏覽器 → 重新登入 → 回到同一對話 | — |
| 3 | 發送新訊息 | 技能仍掛載，variables_json 值仍在，行為一致 |

- [ ] 通過

### TC-16.7 Fork 技能保留新欄位

| 步驟 | 操作 | 預期結果 |
|------|------|----------|
| 1 | 一個技能設定了 tags, tool_schema, output_schema, rate_limit 等 | — |
| 2 | 另一使用者 Fork 此技能 | — |
| 3 | 檢查 Fork 後的技能 | 所有新欄位正確複製 |
| 4 | prompt_version 重置為 1 | 新技能的版本歷史獨立 |

- [ ] 通過

---

## 測試結果總表

| # | 測試區域 | 案例數 | 通過 | 失敗 | 備註 |
|---|----------|--------|------|------|------|
| 2 | TAG 自動路由 | 11 | | | |
| 3 | Workflow 引擎 | 12 | | | |
| 4 | 版本控制 | 6 | | | |
| 5 | prompt_variables | 6 | | | |
| 6 | Tool Schema | 4 | | | |
| 7 | Output Schema | 3 | | | |
| 8 | 速率限制 | 5 | | | |
| 9 | KB 綁定 | 5 | | | |
| 10 | MCP Tags | 3 | | | |
| 11 | DIFY Tags | 2 | | | |
| 12 | 自建 KB Tags + 行內編輯 | 4 | | | |
| 13 | Workflow 編輯器 UI | 6 | | | |
| 14 | 技能市集 UI | 7 | | | |
| 15 | 整合測試 E2E | 5 | | | |
| 16 | 邊界與異常 | 7 | | | |
| **合計** | | **86** | | | |
