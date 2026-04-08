# 問題反饋平台 — 實施報告

> FOXLINK GPT 問題反饋/工單系統 Phase 1–5 實施記錄

---

## 實施總覽

| Phase | 內容 | 狀態 |
|-------|------|------|
| Phase 1 | 基礎建設（DB + API + 基本 UI） | ✅ 完成 |
| Phase 2 | WebSocket 即時對話 | ✅ 完成 |
| Phase 3 | 通知整合（Email + Webex Bot + 站內通知） | ✅ 完成 |
| Phase 4 | AI 分析 + RAG 搜尋 | ✅ 完成 |
| Phase 5 | SLA Cron + 統計圖表 + FAB + 匯出 | ✅ 完成 |
| 補完 | KB Embedding RAG + Admin UI + ChatPage 反饋按鈕 | ✅ 完成 |

---

## Phase 1 — 基礎建設

### 新增檔案

| 檔案 | 說明 |
|------|------|
| `server/services/feedbackService.js` | 工單 CRUD + 單號產生 + 狀態機 + SLA 計算 + 分類/SLA/通知管理 |
| `server/routes/feedback.js` | 50+ REST API endpoints |
| `client/src/pages/FeedbackPage.tsx` | 工單列表（篩選+搜尋+分頁） |
| `client/src/pages/FeedbackNewPage.tsx` | 建立工單表單（Ctrl+V 貼圖 + 拖放） |
| `client/src/pages/FeedbackDetailPage.tsx` | 工單詳情 + 即時對話 + 附件 + SLA + 滿意度 |
| `client/src/components/feedback/FeedbackStatusBadge.tsx` | 狀態標籤元件 |
| `client/src/components/feedback/FeedbackPriorityBadge.tsx` | 優先級標籤元件 |

### 修改檔案

| 檔案 | 修改 |
|------|------|
| `server/database-oracle.js` | 新增 8 張表 + 9 個索引 + 預設分類 6 筆 + 預設 SLA 4 筆 |
| `server/server.js` | 註冊 `/api/feedback` 路由 |
| `client/src/App.tsx` | 新增 3 個前端路由 |
| `client/src/components/Sidebar.tsx` | 新增「問題反饋」導航入口 |
| `client/src/i18n/locales/zh-TW.json` | 新增 `feedback.*` + `sidebar.feedback` keys |
| `client/src/i18n/locales/en.json` | 同上（英文） |
| `client/src/i18n/locales/vi.json` | 同上（越南文） |

### DB Schema

```
FEEDBACK_CATEGORIES              — 問題分類（管理員可管理）
FEEDBACK_CATEGORY_TRANSLATIONS   — 分類多語言翻譯
FEEDBACK_SLA_CONFIGS             — SLA 設定（依優先級）
FEEDBACK_TICKETS                 — 工單主表
FEEDBACK_ATTACHMENTS             — 附件
FEEDBACK_MESSAGES                — 對話紀錄
FEEDBACK_AI_ANALYSES             — AI 分析紀錄
FEEDBACK_NOTIFICATIONS           — 站內通知
```

### 單號格式

`FB-YYYYMMDDHHmm[-n]` — 含 retry loop 防並發碰撞。

### 狀態機

```
open → processing → pending_user → processing → resolved → closed
                  → resolved                  → reopened → processing
```

- 所有活躍狀態可直接 → `resolved`
- `resolved` → `reopened`（72hr 內，僅申請者）
- `resolved` → `closed`（自動 72hr 或管理員手動）
- 管理員回覆自動 `open → processing`
- 申請者回覆自動 `pending_user → processing`

### Bug 修復記錄（Phase 1 審查）

| 問題 | 修復 |
|------|------|
| `is_internal='false'` 字串導致 email 不寄 | 改用 `isInternalBool` 明確判斷 |
| CLOB 欄位 `lastInsertRowid = null` | 改用 `MAX(id)` 查回 |
| resolve/satisfaction/attachments 缺權限檢查 | 加 admin or owner 驗證 |
| `assignTicket` 兩步 UPDATE 非原子 | 合併為單一 UPDATE |
| 單號競爭條件 | retry loop + 重複檢查 + timestamp fallback |
| `category_id` FK 刪除報錯 | `ON DELETE SET NULL` |
| 缺索引 | 新增 9 個索引 |
| 硬編碼中文 | 改用 i18n keys |

---

## Phase 2 — WebSocket 即時對話

### 新增檔案

| 檔案 | 說明 |
|------|------|
| `server/services/socketService.js` | socket.io 初始化 + Redis adapter + 認證 + 房間管理 + 事件推送 |
| `client/src/hooks/useFeedbackSocket.ts` | WebSocket 連線 hook（事件監聽 + typing indicator） |

### 修改檔案

| 檔案 | 修改 |
|------|------|
| `server/server.js` | 整合 socket.io 到 http server |
| `server/routes/feedback.js` | 在 CRUD 操作後加 `emit*()` 推送 |
| `client/src/pages/FeedbackDetailPage.tsx` | 用 WebSocket 取代 5s polling |

### 新增 Dependencies

- Server: `socket.io`, `@socket.io/redis-adapter`
- Client: `socket.io-client`

### 房間設計

```
ticket:{ticketId}        — 單一工單對話
feedback:admin            — 管理員全局通知
feedback:user:{userId}    — 使用者個人通知
```

### 事件

- `new_message` — 新訊息推送到工單房間
- `status_changed` — 狀態變更通知
- `new_ticket` — 新工單通知管理員
- `ticket_assigned` — 接單通知
- `user_typing` / `user_stop_typing` — 輸入指示器

---

## Phase 3 — 通知整合

### 新增檔案

| 檔案 | 說明 |
|------|------|
| `server/services/feedbackNotificationService.js` | 統一通知分派（Email + Webex + 站內 + WebSocket） |
| `client/src/hooks/useFeedbackNotifications.ts` | 通知 badge hook（30s polling） |

### 修改檔案

| 檔案 | 修改 |
|------|------|
| `server/routes/feedback.js` | 用 `feedbackNotif.*` 取代 inline 通知 |
| `server/routes/webex.js` | 新增 feedback 指令處理 |
| `client/src/components/Sidebar.tsx` | 新增通知 badge |

### Email 模板

- `new_ticket` — 新工單通知管理員（HTML table 格式）
- `resolved` — 結案通知申請者
- `reopened` — 重開通知管理員

### Webex Bot 指令

| 指令 | 說明 |
|------|------|
| `feedback list` | 列出待處理工單 |
| `feedback view #FB-xxx` | 查看工單詳情 |
| `feedback reply #FB-xxx 回覆` | 回覆工單 |
| `feedback resolve #FB-xxx [說明]` | 結案 |
| `feedback assign #FB-xxx` | 接單 |

### 通知事件矩陣

| 事件 | Email | Webex | 站內 | WebSocket |
|------|-------|-------|------|-----------|
| 新工單 | ✅ 管理員 | ✅ | ✅ | ✅ |
| 管理員回應 | ✅ 申請者 | ✅ | — | ✅ |
| 結案 | ✅ 申請者 | ✅ | ✅ | ✅ |
| 重開 | ✅ 管理員 | ✅ | ✅ | ✅ |
| SLA 警告/逾期 | — | ✅ | ✅ | ✅ |

---

## Phase 4 — AI 分析 + RAG

### 新增檔案

| 檔案 | 說明 |
|------|------|
| `server/services/feedbackAIService.js` | AI 分析 + RAG 搜尋 + KB 同步 |
| `client/src/components/feedback/FeedbackAIAnalysis.tsx` | AI 分析面板（SSE streaming） |

### 功能

1. **AI 分析** — 使用者/管理員按按鈕觸發
   - 收集工單描述 + 附件清單 + 分享連結
   - RAG 搜尋類似已解決工單
   - 呼叫 LLM（管理員可設定模型/temperature/prompt）
   - SSE streaming 即時顯示回應
   - 儲存到 `FEEDBACK_AI_ANALYSES` 表

2. **RAG 搜尋** — 簡化版關鍵字比對
   - 搜尋已解決/已結案工單
   - 隱私分級：使用者看不到申請者名稱，管理員可看

3. **API 路由**
   - `POST /api/feedback/tickets/:id/ai-analyze` — 觸發 AI 分析（SSE）
   - `PUT /api/feedback/ai-analyses/:id/helpful` — 回饋有幫助/沒幫助
   - `GET /api/feedback/search?q=...` — RAG 搜尋

### AI 模型設定

透過 `system_settings` 表：
- `feedback_ai_model` — 預設模型
- `feedback_ai_temperature` — 溫度
- `feedback_ai_max_tokens` — 最大 token
- `feedback_ai_system_prompt` — 系統提示詞

---

## Phase 5 — SLA Cron + 統計 + FAB

### 新增檔案

| 檔案 | 說明 |
|------|------|
| `server/services/feedbackSLAService.js` | SLA Cron（5 分鐘檢查 + 自動結案 + 逾期標記） |
| `client/src/components/feedback/FeedbackFAB.tsx` | 右下角浮動按鈕（全站快速開單） |
| `client/src/components/feedback/FeedbackStatsPanel.tsx` | 統計儀表板（狀態/優先級/分類分布 + 摘要卡片） |

### 修改檔案

| 檔案 | 修改 |
|------|------|
| `server/server.js` | 啟動 SLA cron |
| `client/src/App.tsx` | 加入 FeedbackFAB 全站顯示 |

### SLA Cron 邏輯

每 5 分鐘執行：
1. **即將到期** — SLA 剩餘 < 30 分鐘 → 通知管理員
2. **已逾期** — 標記 `sla_breached = 1` + 通知管理員 + Webex
3. **自動結案** — `resolved` 超過 72hr → 自動 `closed`

### FAB 功能

- 全站右下角浮動按鈕
- 未讀通知 badge
- 點擊展開迷你開單表單（主旨+分類+描述+附件）
- 支援 Ctrl+V 貼圖
- 送出後跳轉到工單詳情頁

### 統計儀表板

- 摘要卡片：總數、SLA 達標率、逾期數、AI 解決數、平均滿意度
- 狀態分布長條圖
- 優先級分布長條圖
- 分類分布長條圖
- 日期篩選
- Excel 匯出

---

## 檔案總覽

### Server 新增

```
server/
├── services/
│   ├── feedbackService.js           — CRUD + 狀態機 + 單號 + 分類 + SLA + 通知
│   ├── feedbackNotificationService.js — 統一通知（Email + Webex + 站內 + WS）
│   ├── feedbackAIService.js          — AI 分析 + RAG
│   ├── feedbackSLAService.js         — SLA Cron
│   └── socketService.js              — socket.io 初始化
├── routes/
│   └── feedback.js                   — REST API (50+ endpoints)
```

### Client 新增

```
client/src/
├── pages/
│   ├── FeedbackPage.tsx              — 工單列表
│   ├── FeedbackNewPage.tsx           — 新建工單
│   └── FeedbackDetailPage.tsx        — 工單詳情+對話
├── components/feedback/
│   ├── FeedbackStatusBadge.tsx
│   ├── FeedbackPriorityBadge.tsx
│   ├── FeedbackAIAnalysis.tsx
│   ├── FeedbackFAB.tsx
│   └── FeedbackStatsPanel.tsx
├── hooks/
│   ├── useFeedbackSocket.ts
│   └── useFeedbackNotifications.ts
```

### 修改清單

```
server/database-oracle.js     — 8 張表 + 9 索引 + 種子資料
server/server.js               — 路由 + socket.io + SLA cron
server/routes/webex.js         — feedback 指令
client/src/App.tsx             — 路由 + FAB
client/src/components/Sidebar.tsx — 導航入口 + 通知 badge
client/src/i18n/locales/*.json — 三語言 feedback.* keys
```

---

## 設計變更記錄

| 原規劃 | 實際實施 | 原因 |
|--------|---------|------|
| WebSocket 全面取代 polling | WebSocket 事件觸發 → fetchAll API | 簡化實作，WebSocket 只做事件通知，資料一致性由 REST API 保證 |
| 完整 KB embedding RAG | ✅ 已補完 feedbackKBSync.js 正式版 | 初版用關鍵字比對，補完版接 kbEmbedding.js 向量搜尋 |
| ChatPage 每條回覆加反饋按鈕 | ✅ 已補完 ChatWindow.tsx onFeedback | 初版僅 FAB 覆蓋，補完版加到每條 AI 回覆 |
| 獨立管理員 Admin Panel tab | ✅ 已補完 AdminDashboard feedback tab | 包含統計+分類管理+SLA 設定 |
| SLA business hours | 24hr 全天計算 | 使用者要求先不做 business hours |
| 自動指派 | 管理員自行接單 | 使用者要求 |

---

## 補完實施 — KB Embedding + Admin UI + ChatPage 反饋

### 新增檔案

| 檔案 | 說明 |
|------|------|
| `server/services/feedbackKBSync.js` | 工單 → KB 雙 KB 同步（公開脫敏 + 管理員完整）+ 向量搜尋 |
| `client/src/components/feedback/admin/FeedbackCategoryManager.tsx` | 分類管理 CRUD（新增/編輯/刪除/啟停用） |
| `client/src/components/feedback/admin/FeedbackSLAConfig.tsx` | SLA 設定表格（優先級 × 回應/解決時限） |

### 修改檔案

| 檔案 | 修改 |
|------|------|
| `server/services/feedbackAIService.js` | RAG 搜尋改為優先向量搜尋，fallback 關鍵字 |
| `server/routes/feedback.js` | search API 改用向量搜尋 + resolve 觸發 KB sync |
| `client/src/components/ChatWindow.tsx` | 每條 AI 回覆加「問題反饋」按鈕 |
| `client/src/pages/ChatPage.tsx` | 傳入 onFeedback → navigate 到 /feedback/new 帶 context |
| `client/src/pages/AdminDashboard.tsx` | 新增 feedback tab（統計+分類管理+SLA 設定） |

### KB Embedding 架構

- 工單結案時自動觸發 `syncTicketToKB()`
- 建立兩個 Knowledge Base：
  - `feedback-public` — 脫敏（移除申請者姓名/工號/email/部門）
  - `feedback-admin` — 完整內容
- 使用 `kbEmbedding.js` 的 `embedText()` 做向量化
- 搜尋時依 `req.user.role` 決定搜哪個 KB
- 向量搜尋用 Oracle 23 AI 的 `VECTOR_DISTANCE(... COSINE)`

### ChatPage 反饋按鈕

- 每條 AI 回覆下方新增「問題反饋」按鈕
- 點擊帶入：`source=chat_page` + `source_session_id` + AI 回覆摘要
- 自動跳轉到 `/feedback/new` 預填表單

### Admin Dashboard 新增 Tab

- 統計儀表板（FeedbackStatsPanel）
- 分類管理（FeedbackCategoryManager）
- SLA 設定（FeedbackSLAConfig）
- 三個面板整合在同一個 tab 中

---

## 迭代優化（2026-04-08）

### UI 改版

- **全站亮色主題**：所有 feedback 頁面從暗色（slate-900）改為白底（white + gray）
- **FeedbackPage**：加返回按鈕
- **FAB**：加 X 關閉按鈕 + tooltip 說明未讀數量 + 分享連結欄位 + 圖片預覽 + 儲存草稿
- **右側面板重新設計**：白色卡片+陰影+彩色圓點標題、附件依檔案類型分色 icon（圖片粉紅/PDF紅/Office藍/壓縮檔橘）、SLA 用色標 tag、處理者有人綠色無人橘色

### 草稿（draft）機制

- 新增 `draft` 狀態：建單時可選「儲存」（草稿）或「送出」（直接 open）
- 草稿詳情頁顯示完整編輯表單（主旨/分類/優先級/描述/分享連結/附件）
- 支援 Ctrl+V 貼圖 + 拖放檔案到表單
- 草稿不計 SLA、不發通知，送出時才開始
- 送出 API：`PUT /api/feedback/tickets/:id/submit`

### AI 分析改進

- AI 回應改用 MarkdownRenderer 渲染（支援標題/粗體/列表/程式碼高亮）
- 新增放大按鈕 → 全螢幕 modal（max-w-4xl）閱讀 AI 分析

### 圖片預覽

- 附件圖片點擊放大（Lightbox modal）
- 草稿/FAB 新增檔案即時縮圖預覽 + hover 刪除

### 處理者自動回寫

- 管理員第一次回覆非內部備註 → 自動成為處理者（assigned_to）
- 結案時若無處理者 → 結案者自動成為處理者

### 通知精簡

- **Webex 只通知兩種事件**：新單送出 + 使用者發訊息（管理員回覆/結案/重開/SLA 不發 Webex）
- Webex Room 自動建立：首次通知時 bot 自動建 room + 邀請所有 admin
- 新增全站 Toast 通知（FeedbackToast）：管理員收到新單/使用者訊息時右上角彈出

### WebSocket 修復

- **Root cause**：Vite dev server 缺 `/socket.io` proxy（加 `ws: true`）
- Hook 改進：connect 後才 join_ticket、加 seq counter 防 shallow equality、reconnect 重新 join
- Redis adapter 加 error handler 防 `missing error handler` 警告

### 分享連結

- 工單詳情頁分享連結改為明顯藍色按鈕 + 外連 icon
- FAB 快速開單加分享連結欄位

### 使用者手冊

- 新增 `u-feedback` section（第 29 節，14 個 content blocks）到 helpSeedData
