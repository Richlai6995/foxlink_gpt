# 問題反饋平台設計文件

> FOXLINK GPT — 使用者問題反饋 / 工單系統

---

## 目錄

1. [功能總覽](#1-功能總覽)
2. [單號編碼規則](#2-單號編碼規則)
3. [DB Schema](#3-db-schema)
4. [工單狀態流](#4-工單狀態流)
5. [SLA 機制](#5-sla-機制)
6. [即時對話系統 (WebSocket)](#6-即時對話系統-websocket)
7. [附件系統](#7-附件系統)
8. [AI 輔助分析 + RAG](#8-ai-輔助分析--rag)
9. [工單 RAG 隱私分級](#9-工單-rag-隱私分級)
10. [通知機制](#10-通知機制)
11. [Webex Bot 整合](#11-webex-bot-整合)
12. [統計儀表板](#12-統計儀表板)
13. [前端頁面規劃](#13-前端頁面規劃)
14. [API 設計](#14-api-設計)
15. [多語言 (i18n)](#15-多語言-i18n)
16. [檔案結構](#16-檔案結構)
17. [實作階段](#17-實作階段)

---

## 1. 功能總覽

| 功能 | 說明 |
|------|------|
| 工單管理 | 建立/編輯/結案/重開，完整生命週期 |
| 即時對話 | WebSocket 雙向即時通訊，申請者 ↔ 管理員群組 |
| 附件系統 | 檔案上傳 + Ctrl+V 貼圖 + 拖放 + inline 預覽 |
| AI 分析 | RAG 搜尋相似工單 + LLM 分析建議（模型可選） |
| SLA | 依優先級自動計時，逾期自動通知 |
| 通知 | Email + Webex Bot + 站內通知 |
| Webex Bot 快速回覆 | 管理員在 Webex 群組直接回覆工單 |
| 統計報表 | 工單量/處理時間/SLA 達標率/AI 解決率 |
| 匯出 | Excel 匯出工單資料 |
| 滿意度 | 結案後申請者評分 1-5 |
| 多語言 | zh-TW / en / vi 三語支援 |

**入口：**
- Sidebar 獨立導航項目「問題反饋」
- 全站右下角浮動按鈕 (FAB) — 一鍵快速開單
- AI 對話頁每條回覆下方「回答有誤？提交反饋」快捷按鈕

---

## 2. 單號編碼規則

**格式：** `FB-YYYYMMDDHHmm[-n]`

```
FB-202604071430        ← 該分鐘第一張
FB-202604071430-2      ← 同分鐘第二張
FB-202604071430-3      ← 同分鐘第三張
```

**產生邏輯（Server 端）：**
```javascript
async function generateTicketNo() {
  const now = new Date();
  const base = 'FB-' + format(now, 'YYYYMMDDHHmm');
  
  // 查詢同分鐘已有幾張單
  const count = await db.prepare(
    `SELECT COUNT(*) as cnt FROM feedback_tickets 
     WHERE ticket_no LIKE :1`
  ).get(base + '%');
  
  if (count.cnt === 0) return base;
  return `${base}-${count.cnt + 1}`;
}
```

- DB 欄位設 `UNIQUE` constraint 確保不重複
- 不依賴 app 層邏輯，DB 層保底

---

## 3. DB Schema

### 3.0 ERP 分流（2026-04 新增）

為了把 ERP 類別工單與 Cortex 一般工單分開處理（不同的接單群組、不同的知識庫），schema 增加兩個 flag：

- `feedback_categories.is_erp NUMBER(1) DEFAULT 0` — 分類層級；建單時工單歸屬此分類的工單走 ERP 分流
- `users.is_erp_admin NUMBER(1) DEFAULT 0` — 使用者層級；可以獨立於 `role='admin'` 存在（並存模型）

影響：
- **Webex 群組**：ERP 工單通知到 `Cortex - ERP問題反饋通知`，其他走原 `Cortex - 問題反饋通知`
- **知識庫**：ERP 工單結案後進 `feedback-erp` KB（獨立召回），其他走 `feedback-public`
- **工單可見性**（見 §1 可見性矩陣）：Cortex admin 看全部；純 ERP admin 只看 ERP + 自己建的；純使用者只看自己

#### 可見性矩陣

| 身份 | role | is_erp_admin | 可見範圍 |
|------|------|--------------|---------|
| Cortex admin | admin | 0 | 全部工單 |
| 雙重 admin | admin | 1 | 全部工單（同 Cortex admin）+ 加入 ERP webex room |
| ERP admin | user | 1 | 自己建的 + 所有 ERP 分類工單 |
| 一般使用者 | user | 0 | 僅自己建的 |

#### Webex Room 成員
- `Cortex - 問題反饋通知`：`role='admin'`（所有 Cortex 管理員）
- `Cortex - ERP問題反饋通知`：`is_erp_admin=1`（所有 ERP 管理員）
- 兩邊可重疊（雙重 admin 會同時在兩個 room）

---

### 3.1 FEEDBACK_CATEGORIES — 問題分類

```sql
CREATE TABLE feedback_categories (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          VARCHAR2(100) NOT NULL,
  description   VARCHAR2(500),
  icon          VARCHAR2(50),           -- lucide icon name
  sort_order    NUMBER DEFAULT 0,
  is_active     NUMBER(1) DEFAULT 1,
  is_erp        NUMBER(1) DEFAULT 0,    -- ERP 分類 flag（2026-04 新增）
  created_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at    TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 預設分類
-- 系統操作問題、AI 回答品質、教育訓練、帳號權限、功能建議、其他
```

### 3.2 FEEDBACK_CATEGORY_TRANSLATIONS — 分類多語言

```sql
CREATE TABLE feedback_category_translations (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id   NUMBER NOT NULL REFERENCES feedback_categories(id) ON DELETE CASCADE,
  lang          VARCHAR2(10) NOT NULL,   -- 'zh-TW', 'en', 'vi'
  name          VARCHAR2(100) NOT NULL,
  description   VARCHAR2(500),
  UNIQUE(category_id, lang)
);
```

### 3.3 FEEDBACK_SLA_CONFIGS — SLA 設定

```sql
CREATE TABLE feedback_sla_configs (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  priority              VARCHAR2(20) NOT NULL UNIQUE,  -- low/medium/high/urgent
  first_response_hours  NUMBER NOT NULL,    -- 首次回應時限（小時）
  resolution_hours      NUMBER NOT NULL,    -- 解決時限（小時）
  escalation_enabled    NUMBER(1) DEFAULT 0,
  escalation_to         NUMBER REFERENCES users(id),  -- 逾時升級給誰
  created_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at            TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 預設值
-- urgent:  first_response=1hr,  resolution=4hr
-- high:    first_response=4hr,  resolution=8hr
-- medium:  first_response=8hr,  resolution=24hr
-- low:     first_response=24hr, resolution=72hr
```

### 3.4 FEEDBACK_TICKETS — 工單主表

```sql
CREATE TABLE feedback_tickets (
  id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_no               VARCHAR2(30) NOT NULL UNIQUE,
  user_id                 NUMBER NOT NULL REFERENCES users(id),
  
  -- 申請者快照（避免改名/調部門後對不上）
  applicant_name          VARCHAR2(200),
  applicant_dept          VARCHAR2(200),
  applicant_employee_id   VARCHAR2(50),
  applicant_email         VARCHAR2(200),
  
  -- 工單內容
  subject                 VARCHAR2(500) NOT NULL,
  description             CLOB,
  share_link              VARCHAR2(1000),       -- 問答分享連結
  category_id             NUMBER REFERENCES feedback_categories(id),
  priority                VARCHAR2(20) DEFAULT 'medium',  -- low/medium/high/urgent
  tags                    CLOB,                 -- JSON array
  
  -- 狀態
  status                  VARCHAR2(20) DEFAULT 'open',
  -- open / processing / pending_user / resolved / closed / reopened
  
  -- 處理資訊
  assigned_to             NUMBER REFERENCES users(id),   -- 目前不自動指派，管理員自行接單
  resolved_by             NUMBER REFERENCES users(id),
  resolution_note         CLOB,
  
  -- AI 相關
  ai_assisted             NUMBER(1) DEFAULT 0,   -- 是否曾使用 AI 輔助
  ai_resolved             NUMBER(1) DEFAULT 0,   -- 是否由 AI 直接解決
  ai_model                VARCHAR2(100),          -- 使用的 AI 模型
  
  -- 滿意度
  satisfaction_rating     NUMBER(1),              -- 1-5 分
  satisfaction_comment    VARCHAR2(1000),          -- 評價留言
  
  -- SLA
  sla_due_first_response  TIMESTAMP,              -- 首次回應 SLA 到期
  sla_due_resolution      TIMESTAMP,              -- 解決 SLA 到期
  first_response_at       TIMESTAMP,              -- 實際首次回應時間
  sla_breached            NUMBER(1) DEFAULT 0,    -- 是否已違反 SLA
  
  -- 來源
  source                  VARCHAR2(50) DEFAULT 'web',  -- web / fab / chat_page / webex
  source_session_id       VARCHAR2(100),          -- 從 AI 對話頁開單時帶入 session id
  
  -- 時間戳
  created_at              TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at              TIMESTAMP DEFAULT SYSTIMESTAMP,
  resolved_at             TIMESTAMP,
  closed_at               TIMESTAMP,
  reopened_at             TIMESTAMP
);

CREATE INDEX idx_fb_tickets_user ON feedback_tickets(user_id);
CREATE INDEX idx_fb_tickets_status ON feedback_tickets(status);
CREATE INDEX idx_fb_tickets_category ON feedback_tickets(category_id);
CREATE INDEX idx_fb_tickets_priority ON feedback_tickets(priority);
CREATE INDEX idx_fb_tickets_created ON feedback_tickets(created_at);
```

### 3.5 FEEDBACK_ATTACHMENTS — 附件

```sql
CREATE TABLE feedback_attachments (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id     NUMBER NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
  message_id    NUMBER,                  -- 對話中的附件（nullable = 開單時的附件）
  file_name     VARCHAR2(500) NOT NULL,
  file_path     VARCHAR2(1000) NOT NULL,
  file_size     NUMBER,
  mime_type     VARCHAR2(100),
  uploaded_by   NUMBER NOT NULL REFERENCES users(id),
  created_at    TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE INDEX idx_fb_attach_ticket ON feedback_attachments(ticket_id);
CREATE INDEX idx_fb_attach_message ON feedback_attachments(message_id);
```

### 3.6 FEEDBACK_MESSAGES — 對話紀錄

```sql
CREATE TABLE feedback_messages (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id     NUMBER NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
  sender_id     NUMBER NOT NULL REFERENCES users(id),
  sender_role   VARCHAR2(20) NOT NULL,   -- 'applicant' / 'admin'
  content       CLOB NOT NULL,
  is_internal   NUMBER(1) DEFAULT 0,     -- 管理員內部備註（申請者不可見）
  is_email_sent NUMBER(1) DEFAULT 0,     -- 此訊息是否已發 email
  is_system     NUMBER(1) DEFAULT 0,     -- 系統自動訊息（狀態變更等）
  created_at    TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE INDEX idx_fb_msg_ticket ON feedback_messages(ticket_id);
CREATE INDEX idx_fb_msg_sender ON feedback_messages(sender_id);
CREATE INDEX idx_fb_msg_created ON feedback_messages(ticket_id, created_at);
```

### 3.7 FEEDBACK_AI_ANALYSES — AI 分析紀錄

```sql
CREATE TABLE feedback_ai_analyses (
  id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id       NUMBER NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
  triggered_by    NUMBER NOT NULL REFERENCES users(id),
  input_summary   CLOB,                   -- AI 看了什麼（檔案清單+摘要）
  suggestion      CLOB,                   -- AI 建議
  rag_sources     CLOB,                   -- JSON: 引用的歷史工單 [{ticket_no, subject, score}]
  model           VARCHAR2(100),           -- 使用的模型
  input_tokens    NUMBER DEFAULT 0,
  output_tokens   NUMBER DEFAULT 0,
  is_helpful      NUMBER(1),              -- 使用者回饋有沒有用（null=未回饋）
  created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE INDEX idx_fb_ai_ticket ON feedback_ai_analyses(ticket_id);
```

### 3.8 FEEDBACK_NOTIFICATIONS — 站內通知

```sql
CREATE TABLE feedback_notifications (
  id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       NUMBER NOT NULL REFERENCES users(id),
  ticket_id     NUMBER NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
  type          VARCHAR2(50) NOT NULL,
  -- new_ticket / new_message / status_changed / sla_warning / sla_breached / assigned / resolved / reopened
  title         VARCHAR2(500),
  message       CLOB,
  is_read       NUMBER(1) DEFAULT 0,
  created_at    TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE INDEX idx_fb_notif_user ON feedback_notifications(user_id, is_read);
CREATE INDEX idx_fb_notif_ticket ON feedback_notifications(ticket_id);
```

### 3.9 FEEDBACK_SETTINGS — 功能設定

透過現有 `system_settings` 表，key prefix `feedback_`：

```
feedback_ai_model          = 'gemini-2.5-flash'    -- AI 分析預設模型
feedback_ai_model_pro      = 'gemini-2.5-pro'      -- 深度分析模型
feedback_ai_temperature    = 0.3
feedback_ai_max_tokens     = 4096
feedback_ai_system_prompt  = '你是 FOXLINK 技術支援助手...'
feedback_kb_public_id      = null                   -- 自動建立的公開 KB id
feedback_kb_admin_id       = null                   -- 自動建立的管理員 KB id
feedback_webex_room_id     = ''                     -- Webex 管理員群組 Room ID
feedback_sla_check_interval = 5                     -- SLA 檢查間隔（分鐘）
```

---

## 4. 工單狀態流

```
                        ┌─────────────┐
             建立        │    open     │  申請者送出
                        └──────┬──────┘
                               │ 管理員首次回應 / 接單
                        ┌──────▼──────┐
                        │ processing  │  處理中
                        └──────┬──────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
       管理員等使用者回覆  管理員/申請者結案   AI解決→申請者結案
              │                │                │
       ┌──────▼──────┐        │                │
       │ pending_user│        │                │
       └──────┬──────┘        │                │
              │ 使用者回覆     │                │
              └───→ processing ┘                │
                               │                │
                        ┌──────▼──────┐         │
                        │  resolved   │ ◄───────┘
                        └──────┬──────┘
                               │ 
                    ┌──────────┼──────────┐
                    │                     │
             72hr 內可重開          自動/手動結案
                    │                     │
             ┌──────▼──────┐       ┌──────▼──────┐
             │  reopened   │       │   closed    │
             └──────┬──────┘       └─────────────┘
                    │                 不可再操作
                    └───→ processing
```

**狀態轉換規則：**

| 目前狀態 | 可轉換至 | 觸發者 | 條件 |
|----------|---------|--------|------|
| open | processing | 管理員 | 首次回應/接單 |
| processing | pending_user | 管理員 | 等待使用者回覆 |
| processing | resolved | 管理員/申請者 | 問題解決 |
| pending_user | processing | 申請者 | 使用者回覆（自動） |
| resolved | closed | 系統/管理員 | 結案確認（或 72hr 自動） |
| resolved | reopened | 申請者 | 72hr 內覺得沒解決 |
| reopened | processing | 管理員 | 重新處理 |

**自動狀態轉換：**
- 管理員回覆 → 自動 `open` → `processing`
- 申請者回覆 → 自動 `pending_user` → `processing`
- resolved 後 72hr 無操作 → 自動 `closed`

---

## 5. SLA 機制

### 5.1 SLA 計算

工單建立時自動計算 SLA 到期時間：

```javascript
// 建立工單時
const slaConfig = await getSlaConfig(priority);
ticket.sla_due_first_response = addHours(now, slaConfig.first_response_hours);
ticket.sla_due_resolution = addHours(now, slaConfig.resolution_hours);
```

**SLA 暫停：** 狀態為 `pending_user` 時 SLA 不計時（需記錄暫停/恢復時間點）。

### 5.2 SLA Cron Job

使用現有 `scheduledTaskService` 註冊定時任務：

```
每 5 分鐘掃描一次：
  1. 即將到期（剩餘 < 30 分鐘）→ 發 warning 通知
  2. 已逾期 → 標記 sla_breached=1 + 發 breached 通知
  3. resolved 超過 72hr → 自動 closed
```

### 5.3 預設 SLA 值

| Priority | 首次回應 | 解決時限 |
|----------|---------|---------|
| urgent | 1 小時 | 4 小時 |
| high | 4 小時 | 8 小時 |
| medium | 8 小時 | 24 小時 |
| low | 24 小時 | 72 小時 |

管理員可在後台修改。

---

## 6. 即時對話系統 (WebSocket)

### 6.1 技術選型

- **socket.io** — 與 Express 無縫整合
- **socket.io-redis** adapter — K8s 多 Pod 跨節點廣播
- 需新增 dependencies: `socket.io`, `@socket.io/redis-adapter`

### 6.2 房間設計

```
ticket:{ticketId}            ← 單一工單對話房間（申請者 + 管理員）
feedback:admin               ← 管理員全局通知房間（所有管理員自動加入）
feedback:user:{userId}       ← 使用者個人通知（工單狀態變更等）
```

### 6.3 事件定義

**Client → Server：**

| 事件 | Payload | 說明 |
|------|---------|------|
| `join_ticket` | `{ ticketId }` | 加入工單房間 |
| `leave_ticket` | `{ ticketId }` | 離開工單房間 |
| `send_message` | `{ ticketId, content, isInternal, attachmentIds }` | 發送訊息 |
| `typing` | `{ ticketId }` | 正在輸入 |
| `stop_typing` | `{ ticketId }` | 停止輸入 |

**Server → Client：**

| 事件 | Payload | 說明 |
|------|---------|------|
| `new_message` | `{ message, sender }` | 新訊息（含附件資訊） |
| `status_changed` | `{ ticketId, oldStatus, newStatus, changedBy }` | 狀態變更 |
| `user_typing` | `{ ticketId, userId, name }` | 某人正在輸入 |
| `user_stop_typing` | `{ ticketId, userId }` | 某人停止輸入 |
| `new_ticket` | `{ ticket }` | → `feedback:admin` 新工單通知 |
| `ticket_assigned` | `{ ticketId, assignedTo }` | 工單被接單 |
| `sla_warning` | `{ ticketId, type, dueAt }` | SLA 即將到期 |
| `notification` | `{ notification }` | → `feedback:user:{id}` 通知推送 |

### 6.4 認證

WebSocket 連線時用現有 token 驗證：

```javascript
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const user = tokenStore.get(token);
  if (!user) return next(new Error('unauthorized'));
  socket.user = user;
  next();
});
```

### 6.5 K8s 配置

```yaml
# ingress.yaml 追加
nginx.ingress.kubernetes.io/proxy-http-version: "1.1"
nginx.ingress.kubernetes.io/proxy-set-headers: "Upgrade"
nginx.ingress.kubernetes.io/upstream-hash-by: "$remote_addr"  # sticky for WS
```

```javascript
// socket.io Redis adapter
const { createAdapter } = require('@socket.io/redis-adapter');
const pubClient = redisClient.duplicate();
const subClient = redisClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));
```

---

## 7. 附件系統

### 7.1 上傳目錄

```
uploads/
└── feedback/
    └── ticket_{ticket_no}/
        ├── attachment_1.png
        ├── attachment_2.pdf
        └── msg_{message_id}/
            └── inline_image.png
```

### 7.2 上傳方式

| 方式 | 說明 |
|------|------|
| 檔案選擇 | `<input type="file" multiple>` |
| Ctrl+V 貼圖 | `onPaste` 事件 → `clipboardData.items` → Blob → 上傳 |
| 拖放 | `onDragOver` + `onDrop` → FileList → 上傳 |

### 7.3 Multer 配置

```javascript
const feedbackUpload = multer({
  dest: path.join(UPLOAD_DIR, 'feedback', 'tmp'),
  limits: { fileSize: 50 * 1024 * 1024 },  // 50MB per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      return cb(new Error('不允許上傳影片檔案'), false);
    }
    cb(null, true);
  }
});
```

### 7.4 圖片處理

- 上傳後生成 thumbnail（用 sharp 或 canvas）
- inline 圖片直接嵌入對話流
- 點擊放大 (lightbox)
- 支援格式：jpg, png, gif, webp, bmp

---

## 8. AI 輔助分析 + RAG

### 8.1 觸發流程

```
使用者按「AI 分析」按鈕（開單時 or 處理中）
    │
    ├─ 1. 收集工單資料
    │     • 問題主旨 + 描述
    │     • 附件內容（用 kbDocParser 解析）
    │     • 分享連結（fetch 頁面內容）
    │
    ├─ 2. RAG 搜尋
    │     • 用問題描述 embedding → 搜 feedback-public KB
    │     • 取 top 5 相似歷史工單
    │
    ├─ 3. 組合 Prompt
    │     system: feedback_ai_system_prompt（管理員可設定）
    │     user: {問題描述} + {附件摘要} + {相似歷史工單及解法}
    │
    ├─ 4. 呼叫 LLM（管理員選定的模型）
    │     SSE streaming 即時顯示回應
    │
    ├─ 5. 儲存到 FEEDBACK_AI_ANALYSES
    │
    └─ 6. 顯示引用：「參考了 #FB-xxx, #FB-yyy」
           ↓
    使用者可選：
      • 「已解決」→ ai_resolved=1, 結案, 通知管理員
      • 「沒幫助」→ 記錄 is_helpful=0, 繼續人工處理
      • 「有幫助但需要更多協助」→ is_helpful=1, 繼續
```

### 8.2 AI 模型管理

管理員在 Feedback 設定頁可配置：

| 設定 | 說明 |
|------|------|
| `feedback_ai_model` | 預設模型（下拉選 llmService 已註冊模型） |
| `feedback_ai_temperature` | 溫度 0-1 |
| `feedback_ai_max_tokens` | 最大回應 token |
| `feedback_ai_system_prompt` | 系統提示詞（指導語氣/格式） |

### 8.3 從 AI 對話頁開單

ChatPage 每條 AI 回覆下方加按鈕：「回答有誤？提交反饋」

自動帶入：
- `source` = `'chat_page'`
- `source_session_id` = 當前 chat session id
- `share_link` = 自動生成分享連結
- `description` = 預填「AI 對話摘要：{最近 3 輪對話}」
- `category_id` = 自動選「AI 回答品質」分類

---

## 9. 工單 RAG 隱私分級（2026-04 升級）

> **升級重點**：雙 KB 架構廢除 → 單一 `feedback-public` KB（脫敏完整對話 + 附件）+ `feedback_conversation_archive` 表（原始快照，admin only）
>
> **動機**：使用者透過對話紀錄學習解題方法，所以完整對話 + 附件都要進 KB；但敏感資料（人名/工號/email）必須脫敏。雙 KB 內容幾乎相同只是脫敏級別差異，維護成本高不划算。

### 9.1 架構

```
┌─────────────────────────────────────────┐
│ feedback-public KB（向量檢索來源）       │
│  - 完整對話逐則（LLM 脫敏後）            │
│  - 附件 → 圖片 caption / 文件解析文字   │
│  - parent/child chunk（細粒度召回）     │
│  - 所有使用者可搜                        │
└─────────────────────────────────────────┘
                  ⇅
┌─────────────────────────────────────────┐
│ feedback_conversation_archive（歸檔）    │
│  - 完整原始對話（不脫敏、含 internal）   │
│  - 附件原檔 URL                         │
│  - Admin UI 讀取（不進 RAG，永久保留）  │
└─────────────────────────────────────────┘
```

### 9.2 Chunk 切法（parent/child）

單張工單拆成多個 child chunks，每個 child 的 `parent_content` 存完整工單脫敏摘要；檢索時撈 child（細粒度命中），自動回傳 parent_content 給 LLM 組上下文。

```
kb_documents
  └─ filename = 'feedback:FB-202604071430'
  └─ content  = 脫敏後的工單摘要（parent summary）

kb_chunks (全部 chunk_type='child', parent_id=null,
           parent_content=<工單摘要>)
  ├─ position=0    type=header       問題主旨 + 描述
  ├─ position=1..N type=message      對話逐則（申請者/客服，is_internal 跳過）
  ├─ position=N+1..M type=attachment 附件 caption（圖片 Vision / 文件解析）
  └─ position=M+1  type=resolution   最終解決方案（召回權重高）

metadata: { ticket_no, category, priority, position_type,
            message_id, sender_role, attachment_id,
            attachment_url, mime_type, resolved_at }
```

### 9.3 脫敏規則（LLM-based，regex fallback）

- **替換**：人名（中/英/越）→ `[使用者]`、工號 → `[工號]`、email → `[email]`
- **保留**：部門代號、機台 SN、錯誤訊息、URL、IP、路徑、SQL、code snippet、時間、金額、技術術語
- **Prompt 特性**：
  - system prompt 明確列出 REPLACE / KEEP UNCHANGED 清單
  - `temperature = 0` 可重現
  - 不確定的 token 不替換（保守）
  - 不解釋、不摘要、不翻譯，輸出純脫敏文本
- **失敗 fallback**：LLM timeout / 錯誤 → 降級到 regex（`applicant_*` 已知欄位 + email pattern）
- **實作檔**：`server/services/feedbackRedactor.js`

### 9.4 附件處理

`server/services/feedbackAttachmentProcessor.js` 依 ext 分派：

| 類型 | 處理方式 | 重用 |
|------|---------|------|
| 圖片 (jpg/png/gif/webp/bmp) | Gemini Vision OCR + caption | `kbDocParser.imageToText` |
| PDF / DOCX / XLSX / PPTX | 文件解析（Gemini Vision PDF / XML 抽取） | `kbDocParser.parseDocument` |
| TXT / MD / CSV / JSON | 直接讀取（前 20KB） | fs.readFileSync |
| 其他 | skip | — |

附件原檔保留在 UPLOAD_DIR，KB 只存 caption 文字；召回時透過 `metadata.attachment_url` 附下載連結。

### 9.5 結案時執行流

```
PUT /tickets/:id/resolve
  ├─ [同步] feedbackService.changeStatus → 'resolved'
  ├─ [同步] feedback_conversation_archive snapshot（CLOB insert，快）
  ├─ [背景] syncTicketToKB（60–90 秒）
  │    ├─ 拉 messages + attachments
  │    ├─ 附件 → Vision / doc parser → caption
  │    ├─ Gemini Flash redaction pass（parent + 每個 chunk）
  │    ├─ 切 parent-content + N 個 child chunks
  │    ├─ embedBatch → INSERT kb_chunks
  │    └─ UPDATE kb_documents / knowledge_bases 統計
  └─ [背景] sendTicketWebex（DM + 群組 summary，詳見 §11）
```

同步寫 archive、背景跑 KB，確保使用者結案 UX 順暢。

### 9.6 archive 表

```sql
CREATE TABLE feedback_conversation_archive (
  id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id         NUMBER NOT NULL,
  ticket_no         VARCHAR2(30) NOT NULL,
  snapshot_at       TIMESTAMP DEFAULT SYSTIMESTAMP,
  snapshot_trigger  VARCHAR2(30),  -- 'resolved'|'reopened'|'closed'|'manual'|'migration'
  triggered_by      NUMBER,
  messages_json     CLOB,      -- 完整對話（含 internal_notes、system events）
  attachments_json  CLOB,      -- [{url, filename, size, mime}]
  ticket_snapshot   CLOB       -- 工單當時的 subject/description/status 等
);
CREATE INDEX idx_fca_ticket ON feedback_conversation_archive(ticket_id);
CREATE INDEX idx_fca_no ON feedback_conversation_archive(ticket_no);
CREATE INDEX idx_fca_snapshot_at ON feedback_conversation_archive(snapshot_at);
```

- **Append-only**：每次 resolve/reopen/close 都寫新一筆，不覆蓋舊的
- **永久保留**：將來容量大可用 `PARTITION BY RANGE (snapshot_at)` 做年度分區
- **Admin UI**：工單詳情頁 Archive icon → Modal 顯示歷史快照列表 + 完整對話
- **權限**：僅 `role=admin` 可查 `GET /feedback/tickets/:id/archive` 和 `GET /feedback/archive/:snapshotId`

### 9.7 搜尋 API

```
GET /api/feedback/search?q=<query>&limit=<N>
  → searchFeedbackKB(db, query, limit)
  → 撈 child chunks（chunk_type != 'parent'）
  → 回傳 { ticket_no, subject, resolution, chunk_content,
          parent_content, score, category, position_type,
          attachment_url }
```

所有使用者走同一端點、同一 KB，差別只在 admin 可另外透過 archive API 取得未脫敏原文。

### 9.8 歷史回填

`server/scripts/backfillFeedbackKB.js` 一次性掃所有 `status IN ('resolved', 'closed')` 工單：

1. 寫 archive snapshot（`trigger='migration'`）
2. `syncTicketToKB` 同步 KB

支援 `--dry-run` / `--resume` / `--force` / `--from-ticket-id=N` / `--limit=N`。進度寫 `server/tmp/backfill-progress.json` 支援中斷續跑。

---

## 10. 通知機制

### 10.1 通知觸發矩陣

> **2026-04 升級**：Webex 改走 B 方案（狀態機分流），降低管理員群組噪音。規則：
> - 新工單 / 未指派留言 → 群組（公開招領）
> - `assigned_to` 填入後 → DM 接單者（thread 串接）
> - 結案/重開 → DM 雙方 + 群組發一則 summary
> - 轉單 → 舊 assignee DM「轉出」+ 新 assignee DM「接單 + 上下文」

| 事件 | Email | Webex | 站內通知 | WebSocket |
|------|-------|-------|---------|-----------|
| 新工單建立 | ✅ 全部管理員 | ✅ 群組（招領） | ✅ 全部管理員 | ✅ `feedback:admin` |
| 工單被接單 | ✅ 申請者 | ✅ 群組 summary + DM 接單者 | ✅ 申請者 | ✅ `ticket:{id}` |
| 管理員回應 | ✅ 申請者 | — | ✅ 申請者 | ✅ `ticket:{id}` |
| 申請者追問（已指派） | ✅ assignee | ✅ DM assignee（thread） | ✅ 全部管理員 | ✅ `ticket:{id}` |
| 申請者追問（未指派） | ✅ 全部管理員 | ✅ 群組 | ✅ 全部管理員 | ✅ `ticket:{id}` |
| 狀態變更 | ✅ 雙方 | ✅ DM 雙方 | ✅ 雙方 | ✅ `ticket:{id}` |
| 工單結案 | ✅ 雙方 | ✅ DM 雙方 + 群組 summary | ✅ 雙方 | ✅ `ticket:{id}` |
| 工單重開 | ✅ assignee | ✅ DM assignee + 群組 summary | ✅ 全部管理員 | ✅ `feedback:admin` |
| 轉單 | ✅ 新舊 assignee | ✅ DM 新舊 assignee | ✅ 新舊 assignee | ✅ `ticket:{id}` |
| SLA 即將到期 | ✅ assignee | ✅ DM assignee | ✅ 全部管理員 | ✅ `feedback:admin` |
| SLA 已逾期 | ✅ 全部管理員 | ✅ 群組 + DM assignee | ✅ 全部管理員 | ✅ `feedback:admin` |
| AI 分析完成 | — | — | ✅ 申請者 | ✅ `ticket:{id}` |

### 10.2 Email 模板

使用 HTML email，復用現有 `mailService.sendMail()`：

```javascript
const emailTemplates = {
  new_ticket: {
    subject: '[FOXLINK GPT] 新問題反饋 {ticket_no} - {subject}',
    body: `
      <h3>新問題反饋</h3>
      <p><b>單號：</b>{ticket_no}</p>
      <p><b>申請者：</b>{applicant_name} ({applicant_dept})</p>
      <p><b>分類：</b>{category}</p>
      <p><b>優先級：</b>{priority}</p>
      <p><b>主旨：</b>{subject}</p>
      <p><b>說明：</b>{description}</p>
      <p><a href="{link}">點此查看</a></p>
    `
  },
  // ... 其他模板
};
```

---

## 11. Webex Bot 整合

### 11.1 指令擴充

在現有 `webexListener.js` 新增指令處理：

| 指令 | 說明 |
|------|------|
| `@bot feedback list` | 列出待處理工單 |
| `@bot feedback view #FB-xxx` | 查看工單詳情 |
| `@bot reply #FB-xxx 回覆內容` | 回覆工單（寫入 FEEDBACK_MESSAGES + 發 email 給申請者） |
| `@bot resolve #FB-xxx 結案說明` | 結案工單 |
| `@bot assign #FB-xxx` | 自行接單 |

### 11.2 分流策略（2026-04 升級：B 方案）

**問題**：原本所有管理員都在同一個 feedback group，每則對話都廣播，噪音大。

**解法**：依工單狀態 + `assigned_to` 分流：

```
┌─────────────────────────────────────────────────────────┐
│ Stage 1 — 招領階段（assigned_to IS NULL）                │
│   所有 Webex 通知 → 管理員群組（所有 admin 都在）        │
│   目的：讓團隊看到工單、認領                              │
│                                                          │
│   - 新工單：群組廣播 + @mention 所有 admin              │
│   - 申請者追問：群組廣播                                 │
│   - 首次 admin 回覆 → assigned_to 自動填入 → 切到 Stage 2│
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Stage 2 — 處理階段（assigned_to 已設定）                 │
│   對話類通知 → DM 接單者（不擾動群組）                   │
│   關鍵里程碑 → 群組發簡短 summary                        │
│                                                          │
│   - 申請者追問：DM assignee（parentId thread）           │
│   - admin 回覆 applicant：可選 DM applicant              │
│   - 認領事件：群組 summary「FB-xxx 已由 [X] 認領」      │
│   - 結案：DM 雙方 + 群組 summary                         │
│   - 重開：DM assignee + 群組 summary                     │
│   - 轉單：舊 DM「轉出」+ 新 DM「接單」+ 群組靜音         │
│   - SLA 逾期：群組 + DM assignee                         │
└─────────────────────────────────────────────────────────┘
```

### 11.3 Webex API 對應

| 場景 | API | 說明 |
|------|-----|------|
| 群組廣播 | `POST /messages { roomId, markdown }` | `roomId` 存 `system_settings.feedback_webex_room_id` |
| DM 1-on-1 | `POST /messages { toPersonEmail, markdown, parentId? }` | 自動建立 direct room，不需預先 create |
| Thread | `parentId=<first_message_id>` | 同工單後續 DM 串成 thread（見 §11.5） |

### 11.4 Schema 異動

```sql
ALTER TABLE feedback_tickets ADD webex_parent_message_id VARCHAR2(100);
```

首次 DM 該 assignee 時，將回傳的 Webex `message.id` 寫入此欄位，後續同工單的 DM 帶 `parentId` 串接 thread。轉單時清空或覆寫。

### 11.5 Fallback 規則

若 `assigned_to` 使用者沒設定 webex email 或 email 在 Webex 找不到人：
- fallback 回群組 + `@mention` 該 admin
- 記 `console.warn` 供維運追查

### 11.6 推播格式

**群組廣播（新工單）**

```markdown
🎫 **新問題反饋** `FB-202604071430`
━━━━━━━━━━━━━━
**申請者**：[使用者] (資訊部)
**分類**：系統操作問題
**優先級**：🔴 urgent
**主旨**：登入後畫面空白

> 今天早上開始，登入系統後畫面一片空白...

🔗 [查看詳情 / 認領](https://foxlink-gpt.example.com/feedback/FB-202604071430)
```

**DM 接單者（申請者追問）**

```markdown
💬 **FB-202604071430** 申請者追問

> 還是一樣空白，清了 cache 也沒用

🔗 [回覆](https://foxlink-gpt.example.com/feedback/FB-202604071430)
```

**群組 summary（結案）**

```markdown
✅ **FB-202604071430** 已結案 — by [X]

**解法**：清除瀏覽器 cookies + 重新登入即可。
已同步進公開知識庫。
```

---

## 12. 統計儀表板

### 12.1 指標

| 指標 | 計算方式 | 圖表 |
|------|---------|------|
| 工單狀態分布 | `GROUP BY status` | 圓餅圖 |
| 各分類佔比 | `GROUP BY category_id` | 圓餅圖 |
| 每週/月趨勢 | `GROUP BY TRUNC(created_at, 'IW')` | 折線圖 |
| 平均處理時間 | `AVG(resolved_at - created_at)` | 數字卡片 |
| 平均首次回應 | `AVG(first_response_at - created_at)` | 數字卡片 |
| SLA 達標率 | `COUNT(sla_breached=0) / total` | 數字卡片 + 儀表 |
| 管理員處理量 | `GROUP BY assigned_to` | 長條圖 |
| AI 解決率 | `COUNT(ai_resolved=1) / total` | 數字卡片 |
| 平均滿意度 | `AVG(satisfaction_rating)` | 數字卡片 + 星星 |
| 逾期工單 | `sla_breached=1 AND status NOT IN ('resolved','closed')` | 列表 |
| 優先級分布 | `GROUP BY priority` | 長條圖 |
| 來源分析 | `GROUP BY source` | 圓餅圖 |

### 12.2 篩選條件

- 時間範圍（今天/本週/本月/自訂）
- 分類
- 優先級
- 狀態
- 指派管理員

### 12.3 匯出 Excel

使用現有 `xlsx` 套件，匯出欄位：

```
單號, 申請者, 部門, 分類, 優先級, 狀態, 主旨, 
建立時間, 首次回應時間, 解決時間, SLA是否違反,
指派管理員, AI是否解決, 滿意度
```

---

## 13. 前端頁面規劃

### 13.1 頁面清單

| 路由 | 頁面 | 對象 | 說明 |
|------|------|------|------|
| `/feedback` | FeedbackPage | 使用者 | 我的工單列表 |
| `/feedback/new` | FeedbackNewPage | 使用者 | 建立工單表單 |
| `/feedback/:ticketNo` | FeedbackDetailPage | 雙方 | 工單詳情+對話+AI+附件 |
| Admin → Feedback Tab | FeedbackAdminPanel | 管理員 | 全部工單管理 |
| Admin → Feedback Stats | FeedbackStatsPanel | 管理員 | 統計儀表板 |
| Admin → Feedback Settings | FeedbackSettingsPanel | 管理員 | 分類/SLA/AI 模型設定 |

### 13.2 元件清單

```
client/src/
├── components/
│   └── feedback/
│       ├── FeedbackFAB.tsx              ← 右下角浮動按鈕（全站）
│       ├── FeedbackQuickForm.tsx         ← FAB 展開的迷你表單
│       ├── FeedbackList.tsx              ← 工單列表（含篩選/搜尋）
│       ├── FeedbackCard.tsx              ← 單張工單卡片
│       ├── FeedbackForm.tsx              ← 完整建立/編輯表單
│       ├── FeedbackDetail.tsx            ← 工單詳情
│       ├── FeedbackChat.tsx              ← 即時對話區（WebSocket）
│       ├── FeedbackChatMessage.tsx       ← 單條訊息（含內部備註樣式）
│       ├── FeedbackAttachments.tsx       ← 附件區（上傳+預覽+貼圖）
│       ├── FeedbackAIAnalysis.tsx        ← AI 分析面板
│       ├── FeedbackSatisfaction.tsx      ← 滿意度評分元件
│       ├── FeedbackStatusBadge.tsx       ← 狀態徽章
│       ├── FeedbackPriorityBadge.tsx     ← 優先級徽章
│       ├── FeedbackTimeline.tsx          ← 狀態變更時間軸
│       ├── ChatFeedbackButton.tsx        ← AI 對話頁「提交反饋」按鈕
│       │
│       └── admin/
│           ├── FeedbackAdminPanel.tsx     ← 管理員工單管理
│           ├── FeedbackStatsPanel.tsx     ← 統計儀表板
│           ├── FeedbackCategoryManager.tsx ← 分類管理
│           ├── FeedbackSLAConfig.tsx      ← SLA 設定
│           └── FeedbackAIConfig.tsx       ← AI 模型設定
│
├── pages/
│   ├── FeedbackPage.tsx                  ← 使用者主頁
│   ├── FeedbackNewPage.tsx               ← 新建工單頁
│   └── FeedbackDetailPage.tsx            ← 工單詳情頁
│
├── hooks/
│   ├── useFeedbackSocket.ts              ← WebSocket 連線 hook
│   └── useFeedbackNotifications.ts       ← 通知 hook
│
└── i18n/locales/
    ├── zh-TW.json  ← 新增 feedback.* keys
    ├── en.json
    └── vi.json
```

### 13.3 FeedbackFAB 行為

```
全站右下角 → 圓形按鈕 🎫
  │
  ├─ 點擊展開 → FeedbackQuickForm (popover/drawer)
  │   ├─ 主旨 (必填)
  │   ├─ 分類 (下拉)
  │   ├─ 描述 (textarea)
  │   ├─ 附件 (drag/paste/select)
  │   └─ [送出] → POST /api/feedback/tickets
  │
  └─ 右上角 badge → 未讀通知數量
```

### 13.4 FeedbackDetail 版面

```
┌─────────────────────────────────────────────────┐
│ #FB-202604071430  [🔴 urgent] [處理中]          │
│ 系統操作問題 · 王小明 (資訊部) · 2026-04-07 14:30│
├─────────────────────────┬───────────────────────┤
│                         │                       │
│   主旨：登入後空白       │   📎 附件 (3)         │
│                         │   ├─ screenshot.png   │
│   說明：                │   ├─ error.log        │
│   今天早上開始...        │   └─ config.json      │
│                         │                       │
│   🔗 分享連結           │   ⏱ SLA              │
│                         │   首次回應：✅ 達標    │
│                         │   解決時限：剩 2hr     │
├─────────────────────────┤                       │
│                         │   👤 處理者：(無)      │
│   💬 對話               │   [接單]              │
│   ─────────────         │                       │
│   [王小明] 14:30        │   🤖 AI 分析          │
│   登入後畫面空白...     │   [開始 AI 分析]       │
│                         │                       │
│   🔒[管理員備註] 14:45  │   ⭐ 滿意度           │
│   可能是 cache 問題      │   (結案後顯示)        │
│                         │                       │
│   [李管理] 14:50        │                       │
│   請清除瀏覽器快取...   │                       │
│                         │                       │
│   ┌─────────────────┐  │                       │
│   │ 輸入訊息...  📎 │  │                       │
│   └─────────────────┘  │                       │
│   □ 內部備註  [送出]    │                       │
├─────────────────────────┴───────────────────────┤
│ [結案] [重開]                    [匯出]          │
└─────────────────────────────────────────────────┘
```

---

## 14. API 設計

### 14.1 REST API

**工單：**

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/feedback/tickets` | 工單列表（含篩選分頁） |
| POST | `/api/feedback/tickets` | 建立工單 |
| GET | `/api/feedback/tickets/:id` | 工單詳情 |
| PUT | `/api/feedback/tickets/:id` | 更新工單 |
| PUT | `/api/feedback/tickets/:id/status` | 變更狀態 |
| PUT | `/api/feedback/tickets/:id/assign` | 接單 |
| PUT | `/api/feedback/tickets/:id/resolve` | 結案 |
| PUT | `/api/feedback/tickets/:id/reopen` | 重開 |
| PUT | `/api/feedback/tickets/:id/satisfaction` | 提交滿意度 |

**對話：**

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/feedback/tickets/:id/messages` | 對話紀錄 |
| POST | `/api/feedback/tickets/:id/messages` | 發送訊息（+附件） |

**附件：**

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/feedback/tickets/:id/attachments` | 上傳附件 |
| GET | `/api/feedback/attachments/:id` | 下載附件 |
| DELETE | `/api/feedback/attachments/:id` | 刪除附件 |

**AI：**

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/feedback/tickets/:id/ai-analyze` | 觸發 AI 分析（SSE） |
| PUT | `/api/feedback/ai-analyses/:id/helpful` | 回饋 AI 是否有幫助 |

**搜尋：**

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/feedback/search?q=...` | RAG 搜尋相似工單 |

**管理：**

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/feedback/categories` | 分類列表 |
| POST | `/api/feedback/categories` | 新增分類 |
| PUT | `/api/feedback/categories/:id` | 更新分類 |
| DELETE | `/api/feedback/categories/:id` | 刪除分類 |
| GET | `/api/feedback/sla-configs` | SLA 設定 |
| PUT | `/api/feedback/sla-configs/:priority` | 更新 SLA |
| GET | `/api/feedback/stats` | 統計數據 |
| GET | `/api/feedback/export` | 匯出 Excel |
| GET | `/api/feedback/settings` | 取得設定 |
| PUT | `/api/feedback/settings` | 更新設定 |

### 14.2 Query 參數（列表）

```
GET /api/feedback/tickets
  ?status=open,processing     ← 狀態篩選（逗號分隔多選）
  &priority=high,urgent       ← 優先級篩選
  &category_id=3              ← 分類篩選
  &assigned_to=5              ← 指派管理員
  &search=登入問題            ← 全文搜尋（主旨+描述）
  &date_from=2026-04-01       ← 日期範圍
  &date_to=2026-04-07
  &sort=created_at            ← 排序欄位
  &order=desc                 ← 排序方向
  &page=1&limit=20            ← 分頁
  &lang=zh-TW                 ← 語言
  &my=true                    ← 只看自己的（使用者用）
```

---

## 15. 多語言 (i18n)

### 15.1 前端靜態文字

所有 UI 文字使用 `t('feedback.xxx')` key：

```json
{
  "feedback": {
    "title": "問題反饋",
    "newTicket": "建立工單",
    "myTickets": "我的工單",
    "allTickets": "全部工單",
    "subject": "問題主旨",
    "description": "問題說明",
    "shareLink": "問答分享連結",
    "category": "問題分類",
    "priority": "優先級",
    "status": "狀態",
    "assignedTo": "處理者",
    "createdAt": "建立時間",
    "resolvedAt": "解決時間",
    "satisfaction": "滿意度",
    "aiAnalysis": "AI 分析",
    "internalNote": "內部備註",
    "resolve": "結案",
    "reopen": "重開",
    "export": "匯出 Excel",
    "statusLabels": {
      "open": "待處理",
      "processing": "處理中",
      "pending_user": "等待回覆",
      "resolved": "已解決",
      "closed": "已結案",
      "reopened": "已重開"
    },
    "priorityLabels": {
      "low": "低",
      "medium": "中",
      "high": "高",
      "urgent": "緊急"
    }
  }
}
```

### 15.2 DB 動態內容

- 分類名稱：`feedback_category_translations` 表
- 讀取 API 接受 `?lang=` 參數，LEFT JOIN 翻譯表

---

## 16. 檔案結構

### 16.1 Server

```
server/
├── routes/
│   └── feedback.js                    ← 所有 feedback REST API
├── services/
│   ├── feedbackService.js             ← 工單 CRUD + 狀態機 + 單號產生
│   ├── feedbackNotificationService.js ← 通知整合（email + webex + 站內 + socket）
│   ├── feedbackAIService.js           ← AI 分析 + RAG 搜尋
│   ├── feedbackKBSync.js              ← 工單 → KB 同步（脫敏+完整）
│   ├── feedbackSLAService.js          ← SLA 計算 + Cron 檢查
│   ├── feedbackExportService.js       ← Excel 匯出
│   └── socketService.js               ← socket.io 初始化 + 房間管理
├── database-oracle.js                 ← 新增 feedback 相關 table creation
```

### 16.2 Client

```
client/src/
├── components/feedback/               ← 見 §13.2 完整列表
├── pages/
│   ├── FeedbackPage.tsx
│   ├── FeedbackNewPage.tsx
│   └── FeedbackDetailPage.tsx
├── hooks/
│   ├── useFeedbackSocket.ts
│   └── useFeedbackNotifications.ts
├── i18n/locales/                      ← 三語言新增 feedback.* keys
```

---

## 17. 實作階段

> 實作詳情請見 `feedback-platform-implementation.md`

### Phase 1 — 基礎建設（DB + API + 基本 UI）✅

- [x] DB schema（8 張表 + 9 索引 + 預設分類 6 筆 + 預設 SLA 4 筆）
- [x] `feedbackService.js`（CRUD + 單號產生 + 狀態機）
- [x] `routes/feedback.js`（50+ REST API endpoints）
- [x] 前端：FeedbackPage + FeedbackNewPage + FeedbackDetailPage
- [x] 前端：附件上傳 + Ctrl+V 貼圖 + 拖放
- [x] Sidebar 新增入口
- [x] i18n 三語言 keys

### Phase 2 — 即時對話 + WebSocket ✅

- [x] 安裝 socket.io + redis adapter + socket.io-client
- [x] `socketService.js`（初始化 + Redis adapter + 認證 + 房間管理）
- [x] `useFeedbackSocket.ts` hook（事件驅動取代 polling）
- [x] FeedbackDetailPage 整合 WebSocket
- [x] 管理員內部備註功能
- [x] typing indicator

### Phase 3 — 通知 + Webex Bot ✅

- [x] `feedbackNotificationService.js`（統一通知：Email + Webex + 站內 + WS）
- [x] Email HTML 模板（new_ticket / resolved / reopened）
- [x] Webex Bot 指令（list / view / reply / resolve / assign）
- [x] 站內通知 + 未讀 badge（Sidebar）
- [x] `useFeedbackNotifications.ts` hook

### Phase 4 — AI 分析 + RAG ✅

- [x] `feedbackAIService.js`（prompt 組合 + RAG 關鍵字比對 + SSE streaming）
- [x] `FeedbackAIAnalysis.tsx`（AI 面板 + streaming + 有幫助回饋）
- [x] RAG 搜尋 API（隱私分級：使用者/管理員）
- [x] AI 模型設定透過 system_settings
- [x] KB embedding 正式版（feedbackKBSync.js — 雙 KB + 向量搜尋）
- [x] 工單結案自動 KB 同步（resolve → syncTicketToKB）

### Phase 5 — SLA + 統計 + 進階功能 ✅

- [x] `feedbackSLAService.js`（5 分鐘 Cron + 自動結案 72hr）
- [x] `FeedbackStatsPanel.tsx`（統計儀表板 + 長條圖 + Excel 匯出）
- [x] `FeedbackFAB.tsx`（全站浮動按鈕 + 快速開單）
- [x] 滿意度評分元件（結案後 1-5 星）
- [x] 工單重開功能（72hr 限制）
- [x] ChatPage 每條回覆「提交反饋」按鈕（ChatWindow.tsx onFeedback）
- [x] 管理員分類管理 UI 頁面（FeedbackCategoryManager.tsx in AdminDashboard）
- [x] SLA 管理設定 UI 頁面（FeedbackSLAConfig.tsx in AdminDashboard）

### 迭代優化 ✅

- [x] 全站亮色主題（白底）
- [x] 草稿（draft）機制 + 編輯表單 + 儲存/送出
- [x] AI 分析 Markdown 渲染 + 放大 modal
- [x] 圖片 Lightbox 點擊放大
- [x] FAB 加分享連結 + 圖片預覽 + 草稿
- [x] 處理者自動回寫（首次回覆/結案）
- [x] Webex 通知精簡（只通知新單+使用者訊息）
- [x] Webex Room 自動建立 + admin 同步
- [x] WebSocket 修復（Vite proxy + hook）
- [x] Toast 通知（管理員右上角彈出）
- [x] 使用者手冊 u-feedback section
- [x] 拖放/貼圖到草稿編輯表單
- [x] 對話附件 inline 顯示（圖片縮圖+非圖片檔案連結）
- [x] 對話輸入區拖放/Ctrl+V 貼圖 + 預覽
- [x] FAB 可拖動定位（避免擋住送出按鈕）
- [x] 工單列表快速狀態 tab 篩選

---

## 附錄：Dependencies 新增

```json
{
  "socket.io": "^4.x",
  "@socket.io/redis-adapter": "^8.x"
}
```

Client:
```json
{
  "socket.io-client": "^4.x"
}
```
