# Webex Bot 整合規格書

> 版本：1.0
> 日期：2026-03-29
> 狀態：待實作

---

## 1. 功能概述

將 FOXLINK GPT 系統擴充支援 Cisco Webex Bot 介面，讓企業員工可直接透過 Webex（1-on-1 DM 或群組 Room）與系統進行對話，享有與 Web UI 相同的 AI 問答、工具調用、檔案傳輸等核心能力，回應格式針對 Webex 視窗尺寸最佳化（簡化輸出）。

---

## 2. 系統架構

```
Webex App (User DM / Group Room)
        │
        │ HTTPS POST (webhook event)
        ▼
FOXLINK GPT Server (/api/webex/webhook)
        │
        ├─ 身分驗證 (email → users DB)
        ├─ Session 管理 (取得/建立 chat_session)
        ├─ 指令解析 (? / /new / 一般訊息)
        ├─ 檔案下載 (Webex file URL → 暫存)
        │
        ├─ AI Pipeline (reuse existing)
        │     ├─ tagRouter (intent tagging)
        │     ├─ gemini.generateWithTools (function calling)
        │     ├─ selfKB / DIFY KB / MCP tool calls
        │     ├─ pipelineRunner (post-answer nodes)
        │     └─ fileGenerator (xlsx/pdf/docx/pptx)
        │
        └─ Webex Messages API (送回回應 + 生成檔案)
```

---

## 3. 新增檔案清單

| 檔案路徑 | 說明 |
|---|---|
| `server/routes/webex.js` | Webhook HTTP handler，主邏輯入口 |
| `server/services/webexService.js` | Webex REST API 封裝（傳訊/下載/上傳） |
| `server/scripts/registerWebhook.js` | 一次性執行：向 Webex 平台登記 webhook URL |

### 修改既有檔案

| 檔案路徑 | 修改內容 |
|---|---|
| `server/server.js` | 新增 `app.use('/api/webex', require('./routes/webex'))` |
| `server/.env` | 新增 3 個環境變數 |

---

## 4. 環境變數

```env
# Webex Bot
WEBEX_BOT_TOKEN=<Bot Access Token from developer.webex.com>
WEBEX_WEBHOOK_SECRET=<自定義任意字串，用於 HMAC-SHA1 驗簽>
WEBEX_PUBLIC_URL=https://your-domain.com   # 不含尾斜線
```

> **注意**：`WEBEX_PUBLIC_URL` 在開發環境可用 ngrok，Production 用 K8s Ingress 域名。
> Webhook URL 最終為 `${WEBEX_PUBLIC_URL}/api/webex/webhook`

---

## 5. Email 正規化

Webex 使用 `@foxlink.com`，LDAP/系統 DB 可能存 `@foxlink.com.tw`，需統一正規化後比對。

```js
function normalizeEmail(email) {
  return (email || '').toLowerCase().replace(/@foxlink\.com\.tw$/i, '@foxlink.com');
}
```

**DB 查詢方式：**
```sql
SELECT * FROM users
WHERE LOWER(REPLACE(email, '.com.tw', '.com')) = :normalizedEmail
  AND status = 'active'
```

**驗證情境：**

| Webex email | DB email | 比對結果 |
|---|---|---|
| `alice@foxlink.com` | `alice@foxlink.com.tw` | ✅ 成功 |
| `alice@foxlink.com` | `alice@foxlink.com` | ✅ 成功 |
| `ALICE@Foxlink.COM` | `alice@foxlink.com.tw` | ✅ 成功 (大小寫) |
| `bob@gmail.com` | — | ❌ 拒絕 |

**拒絕回應（未知用戶）：**
```
⚠️ 您的帳號（alice@gmail.com）尚未在 FOXLINK GPT 系統中註冊。

請聯絡系統管理員申請帳號。
```

---

## 6. Session 管理策略

### 6.1 DM（1-on-1）

- 以 `webex_dm_{userId}_{YYYY-MM-DD}` 為 session 識別鍵
- 每日自動開新 session，同一天內的訊息延續同一 session
- 日期以台北時區（Asia/Taipei）判斷

### 6.2 群組 Room

- 以 `webex_room_{roomId}` 為 session 識別鍵
- 單一永久 session（不按日切割，群組討論具連續性）

### 6.3 DB 儲存

- `chat_sessions` 新增欄位 `source VARCHAR2(50)`（已存在）
- Webex session 的 `source` 值：`'webex_dm'` 或 `'webex_room'`
- 額外記錄 `webex_room_id VARCHAR2(200)`（新欄位，需 migration）
- 找 session 邏輯：

```js
// DM
SELECT id FROM chat_sessions
WHERE user_id = :userId AND source = 'webex_dm'
  AND TO_CHAR(created_at, 'YYYY-MM-DD') = :todayTaipei
ORDER BY created_at DESC FETCH FIRST 1 ROWS ONLY

// Room
SELECT id FROM chat_sessions
WHERE webex_room_id = :roomId AND source = 'webex_room'
ORDER BY created_at DESC FETCH FIRST 1 ROWS ONLY
```

### 6.4 Session 不存在時自動建立

```js
INSERT INTO chat_sessions (id, user_id, title, model, source, webex_room_id)
VALUES (:uuid, :userId, :title, 'pro', :source, :roomId)
```

---

## 7. Webhook Handler 流程

### 7.1 POST /api/webex/webhook

```
1. 驗簽（HMAC-SHA1）
   └── 失敗 → 401 + 不處理

2. 解析 event：只處理 resource='messages' + event='created'
   └── 其他 event → 200 忽略

3. 呼叫 Webex API 取得完整訊息
   (webhook event 只有 message ID，需另查)

4. 過濾 Bot 自己發的訊息（personId == BOT_PERSON_ID）
   └── 是自己 → 200 忽略（防止無限迴圈）

5. email 正規化 → DB 查 user
   └── 找不到 → 回覆拒絕訊息 → 200

6. 檢查 user status == 'active'
   └── inactive → 回覆帳號停用訊息 → 200

7. 解析訊息文字（去除 @Bot mention 前綴）

8. 下載附件（如有）→ 暫存 uploads/webex_tmp/

9. 指令分派：
   ├── text == '?'              → handleToolList()
   ├── text == '/new' | '/重置' → handleNewSession()
   ├── text == '/help'          → handleHelp()
   └── 其他                     → handleChat()

10. 所有步驟完成後回 200 給 Webex（15 秒內必須回應）
```

> **重要**：Webex 要求 webhook 在 **15 秒內** 回 HTTP 200，否則視為失敗並重試。
> AI 生成可能超時，需在回 200 後 async 發送回覆，或先回「處理中...」。

### 7.2 非同步回應策略

```
接收 webhook → 立即 res.sendStatus(200)
            → 背景執行 processMessage()
                └── AI 完成後呼叫 webexService.sendMessage()
```

---

## 8. 指令系統

| 指令 | 說明 |
|---|---|
| `?` | 列出該使用者可使用的所有工具清單 |
| `/new` 或 `/重置` | 強制開新對話 session |
| `/help` | 顯示使用說明 |
| 其他任何文字 | 送進 AI 問答 pipeline |

### 8.1 `?` 工具清單回應格式

Webex 視窗較小，格式盡量精簡：

```
📋 您可使用的工具（依您的帳號授權）

🔧 技能 (Skills)：
• 查詢工單 — ERP 工單資料查詢
• 產生月報 — 自動匯出 Excel/PDF

🧠 自建知識庫 (KB)：
• 技術手冊 — 產品技術文件查詢
• HR 規章 — 人事政策問答

🔌 DIFY 知識庫：
• 法規資料庫 — 法令遵循查詢

⚙️ MCP 工具：
• SQL 查詢工具 — 直接查詢指定資料庫

💡 直接輸入問題，AI 將自動判斷並使用合適工具。
```

**查詢邏輯：**
- **Skills**：`skills` 表，過濾 `is_public=1 OR owner_user_id=? OR skill_access` 授權
- **自建 KB**：`knowledge_bases` 表，`chunk_count > 0`，過濾 `is_public=1 OR kb_access` 授權
- **DIFY KB**：`dify_knowledge_bases` 表，`is_active=1`，過濾 `is_public=1 OR dify_access` 授權
- **MCP**：`mcp_servers` 表，`is_active=1`（全員可見，DB 層無 per-user 授權）

### 8.2 `/help` 回應格式

```
🤖 FOXLINK GPT Bot 使用說明

📌 基本指令：
• ?        — 查看可用工具清單
• /new     — 開啟新對話（清除記憶）
• /help    — 顯示此說明

📎 附件支援：
• 可傳送 PDF、Word、Excel、PPT、圖片、音訊
• AI 可讀取內容並回答相關問題
• AI 生成的檔案會以附件回傳

⚠️ 注意：
• 群組 Room 中請 @Bot 後輸入訊息
• 每次回覆可能需要 10-30 秒
• 回應格式已針對 Webex 簡化
```

### 8.3 `/new` 回應格式

```
✅ 已開啟新對話，之前的對話記憶已清除。
請輸入您的問題。
```

---

## 9. AI 問答整合（handleChat）

### 9.1 呼叫既有邏輯

Webex 不使用 SSE，改用 **buffer 收集模式**：

```js
// 複用 gemini.js 中的 generateWithTools
// 傳入 webex_system_prompt 覆蓋 system 指示
const WEBEX_SYSTEM_SUFFIX = `
【回覆格式規範 - Webex 模式】
你正在透過 Webex 訊息回覆，請遵守：
1. 回覆盡量簡短，重點優先
2. 使用 bullet list 取代長段落
3. 避免寬表格（改用清單）
4. Markdown 使用有限（粗體、清單、代碼塊可用）
5. 若需詳細說明，在最後加「💡 需要詳細版本請輸入：/詳細」
`;
```

### 9.2 歷史訊息載入

```js
// 從 chat_messages 取得該 session 的歷史（限最近 20 筆，防 context 過大）
SELECT role, content FROM chat_messages
WHERE session_id = :sessionId
ORDER BY created_at DESC
FETCH FIRST 20 ROWS ONLY
```

### 9.3 Token 使用記錄

- 複用現有 `token_usage` upsert 邏輯
- `model` 欄位記錄實際使用的 LLM key（`pro` / `flash` / 自訂）

### 9.4 稽核日誌

- 複用現有 `audit_logs` 邏輯
- `session_id` 記錄 Webex session ID
- 敏感字偵測 + 管理員通知同 Web UI 行為

### 9.5 生成檔案回傳

```js
// AI 回應含 ```generate_xlsx:...``` 代碼塊時
// 1. processGenerateBlocks() 生成實體檔案
// 2. 改呼叫 webexService.sendFile() 上傳附件
// 3. 同時在訊息中標註檔名
```

---

## 10. 檔案處理

### 10.1 接收來自 Webex 的附件

```
Webhook event → files[] (URL array)
  ↓
GET {fileUrl} with Authorization: Bearer {BOT_TOKEN}
  ↓ (response 含 Content-Disposition: filename)
暫存至 uploads/webex_tmp/{uuid}_{filename}
  ↓
送進 AI pipeline（同 Web UI 上傳流程）
  └── extractTextFromFile() 或 fileToGeminiPart()
  ↓
AI 回答後清除暫存檔
```

**支援的 Webex 附件格式：**

| 類型 | MIME |
|---|---|
| PDF | `application/pdf` |
| Word | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| Excel | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| PPT | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| 圖片 | `image/jpeg`, `image/png`, `image/gif`, `image/webp` |
| 音訊 | `audio/mpeg`, `audio/wav`, `audio/mp4`, `audio/ogg` |
| 文字 | `text/plain`, `text/csv` |

**不支援：** 影片檔（webm/mp4 video）→ 回覆錯誤訊息

**大小限制：** 依用戶 DB 設定（`allow_*_upload`, `*_max_mb`）

### 10.2 發送附件給 Webex 用戶

```js
// Webex Messages API: multipart/form-data
POST https://webexapis.com/v1/messages
{
  roomId: "...",
  text: "📄 已生成檔案：report.xlsx",
  files: [fs.createReadStream(localFilePath)]
}
```

**Webex 單檔上限：100 MB**（Webex 平台限制）

---

## 11. Webex Service（webexService.js）

### 11.1 提供的方法

```js
class WebexService {
  constructor(botToken)

  // 取得完整 message 物件（webhook 只給 ID）
  async getMessage(messageId): Promise<WebexMessage>

  // 取得 Bot 自身的 personId（用於過濾自己的訊息）
  async getBotPersonId(): Promise<string>

  // 傳送純文字訊息
  async sendMessage(roomId, text, { parentId } = {}): Promise<void>

  // 傳送含附件訊息（本地檔案路徑）
  async sendFile(roomId, text, localFilePath): Promise<void>

  // 從 Webex 下載附件到本地
  async downloadFile(fileUrl, destPath): Promise<{ filename, mimeType }>

  // 傳送「處理中...」預備訊息（避免 Webex timeout）
  async sendTypingIndicator(roomId): Promise<void>
}
```

### 11.2 HTTP 呼叫規格

所有呼叫加上：
```
Authorization: Bearer {WEBEX_BOT_TOKEN}
Content-Type: application/json
```

Webex API base URL：`https://webexapis.com/v1`

---

## 12. Webhook 安全驗簽

Webex 在 webhook header 帶 `X-Spark-Signature`（HMAC-SHA1）：

```js
const crypto = require('crypto');

function verifyWebexSignature(rawBody, signature, secret) {
  const hmac = crypto.createHmac('sha1', secret);
  hmac.update(rawBody);
  const expected = hmac.digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex')
  );
}
```

> 需使用 `express.raw()` 或在 multer 前取得 raw body，不可使用 `express.json()` parse 後的 body（會破壞簽名計算）。

---

## 13. Webhook 註冊腳本（registerWebhook.js）

一次性執行腳本，向 Webex 登記 webhook：

```
node server/scripts/registerWebhook.js
```

**執行動作：**
1. 列出既有 webhook，刪除舊的同名 webhook
2. 建立新 webhook：
   ```json
   {
     "name": "FOXLINK GPT Webhook",
     "targetUrl": "${WEBEX_PUBLIC_URL}/api/webex/webhook",
     "resource": "messages",
     "event": "created",
     "secret": "${WEBEX_WEBHOOK_SECRET}"
   }
   ```
3. 印出 webhook ID 與狀態

---

## 14. DB Schema 變更

### 14.1 chat_sessions 新增欄位

```sql
ALTER TABLE chat_sessions ADD webex_room_id VARCHAR2(200);
ALTER TABLE chat_sessions ADD webex_source VARCHAR2(20);
-- webex_source: 'dm' | 'room' | NULL（非 Webex 來源）
```

> `source` 欄位已存在，`webex_room_id` 為新增。

### 14.2 Migration 方式

在 `database-oracle.js` 的 `initSchema()` 中，依現有 `ALTER TABLE ... ADD` 模式新增欄位存在檢查邏輯。

---

## 15. 群組 Room 的 @mention 處理

在 Webex 群組 Room 中，Bot 只有被 @mention 才會觸發（Webex 預設行為）。訊息文字會含 `<spark-mention>` HTML 標籤：

```html
<spark-mention data-object-type="person" data-object-id="...">FOXLINK GPT</spark-mention> 請問...
```

處理方式：
```js
// 從 message.html 移除 mention 標籤，或從 message.text 去除 "FOXLINK GPT " 前綴
function stripMention(text, botDisplayName) {
  return (text || '')
    .replace(new RegExp(`^@?${botDisplayName}\\s*`, 'i'), '')
    .trim();
}
```

---

## 16. 錯誤處理與用戶提示

| 情境 | 回應訊息 |
|---|---|
| 用戶 email 不在系統 | `⚠️ 您的帳號（{email}）未在系統中，請聯絡系統管理員。` |
| 用戶帳號停用 | `⚠️ 您的帳號目前已停用，請聯絡系統管理員。` |
| AI 呼叫失敗 | `❌ AI 服務暫時發生錯誤，請稍後重試。（錯誤代碼：{code}）` |
| 附件格式不支援 | `❌ 不支援此附件格式（{filename}），請傳送 PDF/Word/Excel/PPT/圖片/音訊。` |
| 附件超過大小限制 | `❌ 附件 {filename} 超過大小限制（{limit}MB）。` |
| 影片檔 | `❌ 不支援影片檔。請傳送音訊檔（mp3/wav）代替。` |
| 超過 token 預算 | `⚠️ 您今日的使用量已達上限，請明日再試。` |

---

## 17. 回應長度最佳化

Webex 訊息有字元限制（約 7439 bytes），且視窗較小。系統在 Webex 模式下：

1. 注入 `WEBEX_SYSTEM_SUFFIX` 進 system prompt，要求 AI 簡化回應
2. 若回應超過 **4000 字元**，自動截斷並附上：
   ```
   [回應過長，已截斷。如需完整內容請使用 Web 介面：{WEBEX_PUBLIC_URL}]
   ```
3. AI 生成的 Markdown 表格寬度過大時由 AI 主動改用清單格式（在 system prompt 中要求）

---

## 18. 日誌記錄

在 `server/services/logger.js` 現有架構下，新增 Webex 相關 log prefix：

```
[Webex] Incoming event: messages/created from alice@foxlink.com
[Webex] User resolved: id=42 name=Alice
[Webex] Session reused: {sessionId}
[Webex] AI response generated: 342 chars, 1280 tokens
[Webex] File sent: report.xlsx (48KB)
[Webex] WARN Unknown email: external@gmail.com
[Webex] ERROR Signature mismatch from IP: 1.2.3.4
```

---

## 19. 開發/測試流程

### 19.1 ngrok 設定（本地開發）

```bash
ngrok http 3001
# 取得 https://xxxx.ngrok.io
# 更新 .env: WEBEX_PUBLIC_URL=https://xxxx.ngrok.io
# 重新執行: node server/scripts/registerWebhook.js
```

### 19.2 測試清單

| 測試項目 | 預期結果 |
|---|---|
| DM 傳送 `?` | 列出授權工具清單 |
| DM 傳送一般問題 | AI 回應（簡化格式） |
| DM 傳送 `/new` | 確認訊息 + 新 session |
| 未知 email DM | 拒絕訊息 |
| 停用帳號 DM | 停用提示訊息 |
| 傳送 PDF 附件 | AI 讀取 PDF 內容並回答 |
| AI 生成 Excel | 回傳 xlsx 附件 |
| 傳送影片檔 | 拒絕訊息 |
| 群組 Room @mention | 正確識別發訊人並回應 |
| 群組 Room 無 @mention | 不回應（靜默忽略） |
| 偽造 webhook 簽名 | 401 拒絕 |
| webhook 超時 15s | 先回 200，背景繼續處理後送訊息 |

---

## 20. 未來擴充考量（本版不實作）

- **Webex Adaptive Cards**：比純文字更豐富的互動 UI（按鈕選項、表單）
- **多語系**：偵測用戶 Webex 語系自動切換回應語言
- **Bot 主動通知**：排程任務完成時 Bot 主動 DM 用戶
- **Webex 管理員報表**：在後台查詢 Webex 使用統計
- **對話 thread 支援**：在 Webex thread 中保持對話上下文

---

## 21. 依賴套件

不需新增套件，使用現有：
- `axios` — Webex REST API 呼叫
- `crypto`（Node.js built-in）— HMAC-SHA1 驗簽
- `uuid` — session ID 生成
- `fs` — 附件暫存讀寫

---

*規格書結束*
