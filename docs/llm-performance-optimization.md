# LLM 效能優化 — 規劃與實施記錄

> 日期：2026-04-07
> Commit：`49d80d7`
> 範圍：Chat streaming、AOAI 相容性、生成參數可調、Webex bot 改善

---

## 一、問題分析

### 1.1 使用者回報

| 問題 | 影響範圍 |
|------|---------|
| GPT-5.4 無法解析 PDF | AOAI 所有使用者 |
| Gemini 3.0 Pro 回應慢（TTFT 28-42 秒） | 全平台 |
| GPT-5.4 回應慢（總共 75 秒） | AOAI 使用者 |
| 有工具時無 streaming | 使用 KB/MCP/API connector 的使用者 |

### 1.2 根因分析

#### PDF 問題（AOAI）
- PDF ≤15MB 一律走 `fileToGeminiPart()` 轉成 base64 `inlineData`
- `streamChatAoai()` 只讀 `text` parts，`inlineData` 被忽略 → PDF 內容消失
- 同樣問題影響圖片（`inlineData` vs AOAI 的 `image_url` 格式）

#### Gemini TTFT 慢
- Google Search Grounding 是主因，搜尋完才吐第一個字
- 實測：「美國關稅」TTFT=42s，「法務AI工具」TTFT=28.6s
- 實際 token 生成速度正常（95-123 tok/s）

#### GPT-5.4 慢
- `isO1` 正則把 GPT-5.x 歸類為 o1 系列 → **不 streaming**
- System prompt 被 filter 掉（o1 的限制，但 GPT-5 支援）
- `reasoning_effort` 未設定（預設 medium）
- AOAI 本身比 openai.com 直連慢 1.5-3x

#### 工具路徑無 streaming
- `generateWithTools()` 用 `sendMessage()`（非 streaming）
- 等所有 tool call 輪次 + 最終回答全部完成才一次吐出

---

## 二、實施項目

### 2.1 Timing Breakdown（診斷工具）

**檔案**：`server/routes/chat.js`

在 chat request 生命週期中加入 5 個計時點：

```
[Chat][Timing] model=pro files=1ms skills=96ms ttft=42005ms llm_total=51758ms post=70ms total=51943ms in=1385 out=1202
```

| 計時點 | 量測什麼 |
|--------|---------|
| `files` | 檔案處理（PDF extraction、音訊轉錄） |
| `skills` | Skill load + KB/API connector 前置 + audit check |
| `ttft` | 首 Token 延遲（Time To First Token） |
| `llm_total` | LLM 呼叫完整時間（含 streaming） |
| `post` | 後處理（檔案生成、DB 寫入） |

### 2.2 AOAI PDF/圖片相容性修復

**檔案**：`server/routes/chat.js`、`server/services/llmService.js`

#### PDF
- 檔案處理前 early resolve `providerType`
- AOAI 時 PDF 跳過 inline → fall through 到 `extractTextFromFile()` 用 `pdf-parse` 提取純文字

#### 圖片
- 新增 `inlineDataToAoai()` — 把 Gemini 的 `{ inlineData }` 轉成 AOAI 的 `{ type: "image_url", image_url: { url: "data:mime;base64,..." } }`
- 新增 `geminiPartsToAoaiContent()` — 統一轉換 parts 陣列
- `contentsToOpenAI()` 和 `streamChatAoai()` 都改用新轉換函式

#### 最終支援矩陣

| 檔案類型 | Gemini | Azure OpenAI |
|----------|--------|-------------|
| PDF | inline base64（原生） | `extractTextFromFile()` 純文字 |
| Image | inline base64 | `image_url` data URI |
| Excel/Word/Text | text extraction | text extraction（本來就正常） |
| Audio | transcribe → text | transcribe → text（本來就正常） |

### 2.3 GPT-5.x Streaming 啟用

**檔案**：`server/services/llmService.js`

| | 之前 | 之後 |
|---|---|---|
| GPT-5.x 歸類 | `isO1` → 不 streaming | 獨立 `isGpt5` → 走 streaming |
| System prompt | 被 filter 掉 | 保留（GPT-5 支援） |
| Streaming | 等全部完才吐 | 逐 chunk 輸出 |
| `reasoning_effort` | 未設（預設 medium） | 可從 DB + 使用者即時調整 |

### 2.4 generateWithToolsStream（工具路徑 Streaming）

**檔案**：`server/services/gemini.js`、`server/routes/chat.js`

新增 `generateWithToolsStream()` 函式：
- Tool-call 輪次：Gemini 回傳 function calls → 執行 tools → 送回結果
- 最終回答輪次：`sendMessageStream` 逐 chunk 輸出
- `onToolStatus` callback 回傳「呼叫工具：xxx」到前端
- TTFT 從 = llm_total 改善為第一個 text chunk 就送出

### 2.5 Skill-attached 跳過 Auto-Routing

**檔案**：`server/routes/chat.js`

| 情境 | 之前 | 之後 |
|------|------|------|
| 有掛技能 + auto mode | TAG routing / intent filter（LLM 分類 200-1500ms） | 直接用 skill binding 結果，跳過 LLM |
| 沒掛技能 | 完整 auto routing | 完全不變 |

技能透過 `kb_mode`（exclusive/disable/append）和 `mcp_tool_mode` 控制工具需求，不需要再跑 intent classification。

### 2.6 Generation Config 可調參數

**檔案**：DB migration、`server/routes/admin.js`、`server/routes/chat.js`、`server/services/gemini.js`、`server/services/llmService.js`、前端 `LlmModels.tsx`

#### DB Schema
```sql
ALTER TABLE LLM_MODELS ADD GENERATION_CONFIG CLOB;
-- JSON: {temperature, max_output_tokens, top_p, reasoning_effort, thinking_budget, enable_search}
```

#### 參數對照

| 參數 | Gemini | Azure OpenAI (GPT-4o) | Azure OpenAI (GPT-5.x) | 影響速度 |
|------|--------|----------------------|------------------------|---------|
| temperature | ✅ | ✅ | ✅ | ❌ |
| max_output_tokens | ✅ (預設 65536) | ✅ (max_tokens) | ✅ (max_completion_tokens) | ✅ |
| top_p | ✅ | ✅ | ✅ | ❌ |
| reasoning_effort | — | — | ✅ (low/medium/high) | ✅✅✅ |
| thinking_budget | ✅ (Gemini 2.5+) | — | — | ✅✅✅ |
| enable_search | ✅ (Google Search) | — | — | ✅✅✅ |

#### 前端 Admin UI
- LLM 模型編輯 Dialog 新增「生成參數」區塊
- 依 provider 顯示不同欄位（Azure: reasoning_effort / Gemini: thinking_budget + search toggle）

### 2.7 使用者即時 Reasoning Effort 調整

**檔案**：前端 `Sidebar.tsx`、`ChatPage.tsx`、後端 `chat.js`

- Sidebar 模型選擇器下方新增 `預設 / Low / Med / High` 按鈕列
- 只在 Azure OpenAI 模型時顯示
- 選擇存 `localStorage`，每次送訊息帶在 `formData.reasoning_effort`
- 後端驗證後覆蓋 DB 預設值

優先順序：`User 即時選擇 > Admin DB 預設 > 程式碼預設`

### 2.8 Webex Bot Typing Indicator 改善

**檔案**：`server/routes/webex.js`、`server/services/webexService.js`

| 階段 | 之前 | 之後 |
|------|------|------|
| 收到訊息 | 發「⏳ 正在分析...」，不存 ID | 發「⏳ 正在分析...」，存 `typingMsgId` |
| AI 回覆完 | 另發一則新訊息（洗頻） | `PUT /messages/{id}` edit 為實際回覆 |
| edit 失敗 | — | fallback 送新訊息 |
| AI 沒回文字 | typing 留著 | 刪掉 typing |

新增 `webexService.editMessage()` 方法。

---

## 三、影響範圍

### 修改的檔案（14 files, +522/-108）

| 檔案 | 改動 |
|------|------|
| `server/routes/chat.js` | timing、PDF/AOAI fix、skill skip routing、streaming tools、genConfig、reasoning_effort |
| `server/services/gemini.js` | streamChat genConfig、generateWithToolsStream 新函式 |
| `server/services/llmService.js` | GPT-5 streaming、image_url 轉換、genConfig、reasoning_effort |
| `server/routes/admin.js` | generation_config CRUD |
| `server/database-oracle.js` | GENERATION_CONFIG 欄位 migration |
| `server/routes/webex.js` | typing indicator → edit |
| `server/services/webexService.js` | editMessage() |
| `client/src/types.ts` | LlmGenerationConfig interface |
| `client/src/components/admin/LlmModels.tsx` | 生成參數 UI |
| `client/src/components/Sidebar.tsx` | reasoning effort selector |
| `client/src/pages/ChatPage.tsx` | reasoningEffort state + formData |
| `client/src/i18n/locales/zh-TW.json` | i18n keys |
| `client/src/i18n/locales/en.json` | i18n keys |
| `client/src/i18n/locales/vi.json` | i18n keys |

---

## 四、預期效果

| 指標 | 改善前 | 改善後 |
|------|--------|--------|
| GPT-5.4 PDF 解析 | ❌ 失敗 | ✅ text extraction |
| GPT-5.4 TTFT | ~75s（等全部完） | ~10-20s（streaming 第一個 chunk） |
| Tools 路徑 TTFT | = llm_total（等全部完） | 第一個 text chunk 即送 |
| 有技能時 skill 階段 | 200-1500ms（LLM intent filter） | ~50ms（直接用 binding） |
| Webex 訊息數 | 2 則（typing + 回覆） | 1 則（edit 原地更新） |

---

## 五、後續可優化

1. **Gemini Search Grounding timeout fallback** — 搜超過 N 秒 fallback 到不帶 search 的純模型回答
2. **Webex streaming 模擬** — 定時 `editMessage()` 更新進度（需注意 rate limit）
3. **Gemini thinking_budget 使用者即時調整** — 類似 reasoning_effort 的 UI
4. **enable_search 使用者即時 toggle** — 讓使用者選擇是否要網路搜尋
