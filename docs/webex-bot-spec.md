# Webex Bot 整合規格書

> 版本：1.2
> 日期：2026-03-29
> 狀態：已實作（Polling + Redis 分散鎖，4 Pod K8s 生產環境驗證通過）

---

## 1. 功能概述

將 FOXLINK GPT 系統擴充支援 Cisco Webex Bot 介面，讓企業員工可直接透過 Webex（1-on-1 DM 或群組 Room）與系統進行對話，享有與 Web UI 相同的 AI 問答、工具調用、檔案傳輸等核心能力，回應格式針對 Webex 視窗尺寸最佳化（簡化輸出）。

---

## 2. 系統架構

### 2.1 Polling 模式（正式採用）

`flgpt.foxlink.com.tw` 為企業內網 DNS，Webex Cloud 無法主動 inbound 連線，因此採用 **Outbound Polling** 模式：

```
FOXLINK GPT K8s（4 Pods 同時運行）
        │
        │ 每 8 秒 outbound HTTPS
        ▼
GET /v1/rooms?sortBy=lastactivity&max=200
        │ 取最近活躍 rooms，新 DM 立即出現在頂端
        ▼
filter: rooms where lastActivity > prevLastChecked
        │
        ▼ (for each active room)
GET /v1/messages?roomId={id}&max=50  ← 最多翻 3 頁，150 則/room/cycle
        │
        ▼ (for each new message)
tryLock("webex:msg:{id}", 60s)  ← Redis 分散鎖
        │
        ├─ 搶到 lock → 處理此訊息（只有 1 個 Pod）
        └─ 搶不到   → skip（其他 Pod 已在處理）
        │
        ▼
handleWebexMessage(message)   ← 共用核心，webhook 模式也呼叫此函數
        │
        ├─ 身分驗證 (email → users DB，含 webex_bot_enabled 檢查)
        ├─ Session 管理 (取得/建立 chat_session)
        ├─ 指令解析 (? / /new / /help / 一般訊息)
        ├─ 檔案下載 (Webex file URL → 暫存)
        │
        ├─ AI Pipeline
        │     ├─ gemini.generateWithTools (function calling)
        │     ├─ selfKB / DIFY KB / MCP tool calls
        │     └─ fileGenerator (xlsx/pdf/docx/pptx)
        │
        └─ Webex Messages API (送回回應 + 生成檔案)
```

**Polling 優點：**
- 不需公網 inbound URL，適用企業內網防火牆
- 實作簡單，無 HMAC 驗簽需求（outbound 不需）
- `sortBy=lastactivity`：新 DM 房間立即排最前，首則訊息延遲 ≤ 8 秒
- 分頁拉取（最多 150 則/room/cycle）：高流量下不漏訊息
- Redis 分散鎖：多 Pod 並行，同一訊息只有一個 Pod 處理，不重複回應
- 不同用戶的訊息 lock key 各異，4 個 Pod 可同時處理 4 個不同用戶，並行能力 4 倍

### 2.2 Webhook 模式（備用，需公網）

`POST /api/webex/webhook` 端點仍保留，供未來開放公網時使用。Webex Cloud 主動 POST → HMAC-SHA1 驗簽 → `handleWebexMessage(message)`。

---

## 3. 新增檔案清單

| 檔案路徑 | 說明 |
|---|---|
| `server/routes/webex.js` | Webhook handler + `handleWebexMessage()` 核心邏輯 |
| `server/services/webexService.js` | Webex REST API 封裝（傳訊/下載/上傳） |
| `server/services/webexListener.js` | Outbound polling listener（主要運作模式） |
| `server/scripts/registerWebhook.js` | 一次性腳本：向 Webex 平台登記 webhook（備用模式用） |

### 修改既有檔案

| 檔案路徑 | 修改內容 |
|---|---|
| `server/server.js` | 新增 webex route + `startPolling()` 啟動 |
| `server/database-oracle.js` | Migration：`CHAT_SESSIONS.SOURCE`、`CHAT_SESSIONS.WEBEX_ROOM_ID`、`USERS.WEBEX_BOT_ENABLED` |
| `server/routes/users.js` | GET/POST/PUT 加入 `webex_bot_enabled` |
| `client/src/components/admin/UserManagement.tsx` | 加入「允許使用 Webex Bot」勾選框 |
| `server/.env` | 新增 3 個環境變數 |

---

## 4. 環境變數

```env
# Webex Bot
WEBEX_BOT_TOKEN=<Bot Access Token from developer.webex.com>
WEBEX_WEBHOOK_SECRET=<自定義任意字串，用於 HMAC-SHA1 驗簽（備用 webhook 模式才需要）>
WEBEX_PUBLIC_URL=https://your-domain.com   # 不含尾斜線（webhook 模式 + 回應截斷提示用）
WEBEX_POLL_INTERVAL_MS=8000                # Polling 間隔（毫秒），預設 8000，可選
WEBEX_ROOMS_PER_POLL=200                   # 每次取幾間房間，預設 200，可選

# Redis（多 Pod 防重複必要，本專案 K8s 已配置）
REDIS_URL=redis://redis:6379
```

**最低必要設定（Polling 模式）：** 只需 `WEBEX_BOT_TOKEN`，其他選填。

> `WEBEX_PUBLIC_URL` 即使在 polling 模式下也建議設定，因為 AI 回應截斷時會提示用戶到 Web 介面查看完整版。

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

## 7. 訊息處理流程

### 7.1 Polling 主流程（webexListener.js）

```
每 8 秒 pollOnce()
        │
        ├─ Step 1: GET /v1/rooms?sortBy=lastactivity&max=200
        │          filter: lastActivity > prevLastChecked
        │          無活躍房間 → return
        │
        └─ Step 2: for each active room
              ├─ GET /v1/messages?roomId={id}&max=50
              │   翻頁（最多 3 頁）直到碰到舊訊息
              │
              ├─ newMsgs.reverse()  ← oldest-first 確保順序正確
              │
              └─ for each msg
                    ├─ 跳過 Bot 自身訊息
                    ├─ tryLock("webex:msg:{id}", 60s)
                    │   ├─ 搶不到 → skip（另一 Pod 處理中）
                    │   └─ 搶到   → setImmediate → handleWebexMessage(msg)
                    └─ Redis 故障時 → 所有 Pod 都處理（保守降級）
```

### 7.2 Webhook 備用流程（/api/webex/webhook）

```
Webex POST → 立即回 200（15 秒限制）
           → setImmediate → handleWebexEvent(event)
                          → getMessage(event.data.id)
                          → handleWebexMessage(message)
```

HMAC-SHA1 驗簽邏輯保留，`req.rawBody` 由 `express.json({ verify })` 儲存（不影響其他路由）。

### 7.3 handleWebexMessage() 核心流程

```
1. email 正規化 → DB 查 user（含 webex_bot_enabled 欄位）
   ├─ 找不到 → 拒絕訊息
   ├─ status != 'active' → 停用提示
   └─ webex_bot_enabled == 0 → Webex Bot 未啟用提示

2. 去除 @Bot mention 前綴（群組 Room）

3. 取得/建立 Session
   ├─ DM: 每日新 session（以台北時區日期判斷）
   └─ Room: 永久 session（以 webex_room_id 識別）

4. 指令分派
   ├─ '?'              → 工具清單
   ├─ '/new' | '/重置' → 新 session
   ├─ '/help'          → 使用說明
   └─ 其他             → AI Pipeline

5. 下載附件 → 暫存 uploads/webex_tmp/

6. 呼叫 AI（generateWithTools，非 SSE）

7. processGenerateBlocks → 生成檔案

8. 截斷超長回應（> 4000 字元）

9. 儲存訊息、更新 session、記錄 token

10. sendMessage / sendFile 回傳
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

## 12. Webhook 安全驗簽（備用模式）

Webex 在 webhook header 帶 `X-Spark-Signature`（HMAC-SHA1）：

```js
const crypto = require('crypto');

function verifyWebexSignature(rawBody, signature, secret) {
  const hmac = crypto.createHmac('sha1', secret);
  hmac.update(rawBody);  // rawBody 必須是 Buffer
  const expected = hmac.digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature.toLowerCase(), 'hex'),
    Buffer.from(expected.toLowerCase(), 'hex')
  );
}
```

**Raw Body 取得方式：** 在 `express.json()` 的 `verify` 回呼中儲存：

```js
// server.js
app.use(express.json({
  limit: '100mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },  // ← 此行
}));
```

在 route 中直接用 `req.rawBody`（Buffer），不需另加 `express.raw()` middleware。

> **Polling 模式無需驗簽**，因為是 server 主動 outbound 呼叫，不存在偽造問題。

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

### 14.1 Migration 欄位（全部透過 safeAddColumn 自動執行）

```sql
-- chat_sessions
ALTER TABLE CHAT_SESSIONS ADD WEBEX_ROOM_ID VARCHAR2(200);  -- 群組 Room ID
ALTER TABLE CHAT_SESSIONS ADD SOURCE VARCHAR2(30);           -- 'webex_dm' | 'webex_room' | NULL

-- users（新增）
ALTER TABLE USERS ADD WEBEX_BOT_ENABLED NUMBER(1) DEFAULT 1;
-- 0 = 停用 Webex Bot 功能，1 = 啟用（預設全體啟用）
```

### 14.2 Migration 方式

`server/database-oracle.js` 的 `runMigrations()` 末尾：

```js
// ── Webex Bot 支援欄位
await safeAddColumn('CHAT_SESSIONS', 'WEBEX_ROOM_ID', 'VARCHAR2(200)');
await safeAddColumn('CHAT_SESSIONS', 'SOURCE', "VARCHAR2(30)");
await safeAddColumn('USERS', 'WEBEX_BOT_ENABLED', 'NUMBER(1) DEFAULT 1');
```

**Server 啟動時自動執行，idempotent，不需手動操作。**

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
| **webex_bot_enabled=0** | `⚠️ 您的帳號目前未開啟 Webex Bot 功能，如需使用請聯絡系統管理員。` |
| AI 呼叫失敗 | `❌ AI 服務暫時發生錯誤，請稍後重試。（{error message}）` |
| 附件格式不支援 | `❌ 不支援此附件格式（{filename}），請傳送 PDF/Word/Excel/PPT/圖片/音訊。` |
| 附件超過大小限制 | `❌ 附件 {filename} 超過大小限制（{limit}MB）。` |
| 影片檔 | `❌ 不支援影片檔（{filename}），請傳送音訊或文件。` |
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

### 19.1 本地開發啟動（Polling 模式）

```bash
# server/.env 只需設定 WEBEX_BOT_TOKEN，即可直接 polling
cd server && npm run dev

# log 應出現：
# [WebexListener] Polling started (interval=8000ms, redis-lock=enabled)
```

無需 ngrok，無需公網，直接發 Webex DM 測試。

### 19.2 ngrok 設定（Webhook 備用模式）

```bash
ngrok http 3001
# 取得 https://xxxx.ngrok.io
# 更新 .env: WEBEX_PUBLIC_URL=https://xxxx.ngrok.io
# 執行: node server/scripts/registerWebhook.js
```

### 19.3 測試清單

| 測試項目 | 預期結果 |
|---|---|
| DM 傳送 `?` | 列出授權工具清單 |
| DM 傳送一般問題 | AI 回應（簡化格式），5 秒內開始處理 |
| DM 傳送 `/new` | 確認訊息 + 新 session |
| DM 傳送 `/help` | 顯示使用說明 |
| 未知 email DM | 拒絕訊息 |
| 停用帳號 DM | 停用提示訊息 |
| webex_bot_enabled=0 的帳號 | 未開啟提示訊息 |
| 傳送 PDF 附件 | AI 讀取 PDF 內容並回答 |
| AI 生成 Excel | 回傳 xlsx 附件 |
| 傳送影片檔 | 拒絕訊息 |
| 群組 Room @mention | 正確識別發訊人並回應 |
| 群組 Room 無 @mention | 不回應（靜默忽略） |
| 偽造 webhook 簽名 | 驗簽失敗，靜默忽略 |
| 伺服器重啟 | 30 秒內恢復 polling，啟動期間訊息補掃 |

---

## 20. 未來擴充考量（本版不實作）

- **Webhook 模式切換**：未來若開放公網，可改回 webhook（更即時、無輪詢負擔）
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

---

## 22. 多 Pod K8s 架構（✅ 已解決）

### 22.1 問題背景

K8s 部署 `replicas: 4`，每個 Pod 都獨立執行 `startPolling()`。同一則 Webex 訊息若被 4 個 Pod 同時處理，用戶會收到 4 份相同回覆。

### 22.2 解決方案：Redis 分散鎖（v1.2 已實作）

**實作位置：** `server/services/webexListener.js`

```js
// 每則訊息處理前搶 Redis lock
const lockKey = `webex:msg:${msg.id}`;
const acquired = await tryLock(lockKey, 60); // TTL 60 秒
if (!acquired) {
  console.log(`Skipped (lock held by another pod): msg=${msg.id}`);
  continue;  // 另一個 Pod 已在處理，跳過
}
// 搶到 lock → 處理此訊息
```

**底層實作：** `server/services/redisClient.js` 的 `tryLock(key, ttlSeconds)`
- 使用 Redis `SET NX EX`（原子操作，不存在競爭條件）
- `REDIS_URL` 未設定時自動 fallback 到 MemoryStore（單 Pod 仍可正常運作）
- Redis 故障時保守降級：所有 Pod 都處理（避免訊息遺失）

### 22.3 生產環境驗證結果

K8s 4 Pod 環境實際運行輸出：
```
[WebexListener] Polling started (interval=8000ms, redis-lock=enabled)  # Pod 1
[WebexListener] Polling started (interval=8000ms, redis-lock=enabled)  # Pod 2
[WebexListener] Polling started (interval=8000ms, redis-lock=enabled)  # Pod 3
[WebexListener] Polling started (interval=8000ms, redis-lock=enabled)  # Pod 4
```

同一訊息到來時：
```
[Pod 1] Dispatch: type=direct from="alice@foxlink.com" text="..."  ← 搶到 lock，處理
[Pod 2] Skipped (lock held by another pod): msg=Y2lzY29zcGF...    ← 跳過
[Pod 3] Skipped (lock held by another pod): msg=Y2lzY29zcGF...    ← 跳過
[Pod 4] Skipped (lock held by another pod): msg=Y2lzY29zcGF...    ← 跳過
```

### 22.4 並行能力

不同用戶的訊息 lock key 各異（`webex:msg:{不同 id}`），所以：
- 4 個 Pod 可**同時**處理 4 個不同用戶的訊息
- 高並發下實際並行能力 = Pod 數量 × 1（每 Pod 同時處理 1 則）
- 擴充 Pod 數即可線性提升並行能力

---

*規格書結束*
