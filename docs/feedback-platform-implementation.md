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

### 對話附件 inline 顯示

- 訊息泡泡直接 inline 顯示圖片縮圖（max 240×180），點擊 Lightbox 放大
- 非圖片附件在泡泡中顯示檔名 + 下載 icon
- 根據 `feedback_attachments.message_id` 匹配訊息

### 對話輸入區拖放/貼圖

- Ctrl+V 剪貼簿貼圖 → 即時縮圖預覽
- 拖放檔案到輸入區/textarea → 加入附件
- 圖片有 16×16 縮圖預覽，非圖片顯示檔名
- hover 顯示紅色 × 刪除按鈕
- placeholder 提示「可拖放檔案或 Ctrl+V 貼圖」

### FAB 可拖動定位

- 預設位置上移到 bottom:100px 避免擋住送出按鈕
- 支援 pointer drag 拖動到任意位置（滑鼠+觸控）
- 表單 popover 跟隨 FAB 位置
- 拖動 vs 點擊自動區分（移動 > 4px 才算拖動）

### 使用者手冊

- 新增 `u-feedback` section（第 29 節）到 helpSeedData
- 包含草稿機制、拖放/貼圖說明、狀態表（含草稿）

---

## ERP 分流 + 分類管理升級（2026-04）

背景：ERP 類問題需要獨立處理團隊（非 IT 的 ERP 管理員）+ 獨立知識庫，不應與 Cortex 一般工單混在一起。

### Migration
- `feedback_categories.is_erp NUMBER(1) DEFAULT 0` — 分類 ERP flag
- `users.is_erp_admin NUMBER(1) DEFAULT 0` — 使用者 ERP 管理員 flag

### 身份模型（並存獨立 flag）
- `role`（admin / user）保持原樣
- `is_erp_admin` 獨立，可與 `role='admin'` 共存
- **Cortex admin**（`role='admin'`）可見所有工單、加入 `Cortex - 問題反饋通知` room
- **ERP admin**（`is_erp_admin=1`）只看自己 + ERP 分類工單、加入 `Cortex - ERP問題反饋通知` room
- 兩者可重疊 → 雙重 admin 兩邊 room 都進

### Webex 雙 Room（`feedbackNotificationService.js`）
- 新增 `ensureFeedbackErpWebexRoom()` + `_syncErpAdminMembers()`
- 新增 `system_settings.feedback_erp_webex_room_id`
- `_sendToRoom(ticket, md)` 依 `ticket.category_is_erp` 分派 room
- `notifyAdmins` 依 ticket 類型決定通知對象：
  - ERP 工單 → Cortex admin + ERP admin
  - 非 ERP → 僅 Cortex admin

### 雙 KB（`feedbackKBSync.js`）
- `PUBLIC_KB_NAME = 'feedback-public'` + 新增 `ERP_KB_NAME = 'feedback-erp'`
- `ensureFeedbackKB(db, name)` 支援指定名稱
- `syncTicketToKB` 依 `ticket.category_is_erp` 選 KB；兩邊都有同單號 doc 時刪舊立新（category 可能被改）
- `searchFeedbackKB(db, query, limit, { kbName })` 使用者可手動選擇搜哪個 KB（UI 在一般 KB 列表選擇）
- 兩個 KB 皆 `is_public=1`，使用者在知識庫列表看得到

### 工單可見性（`feedbackService.listTickets`）
- 新增參數 `isErpAdmin`，邏輯：
  - `isAdmin=true` → 全部
  - `isAdmin=false AND isErpAdmin=true` → `t.user_id = userId OR c.is_erp = 1`
  - 其他 → 僅 `t.user_id = userId`
- `COUNT(*)` query 加 LEFT JOIN `feedback_categories` 才能過濾
- `getTicketById` / listTickets 主 SELECT 帶回 `category_is_erp` 供後續分流判斷
- Session payload (`sessionBuilder.js`) 加 `is_erp_admin` → `req.user.is_erp_admin`

### 使用者管理（`routes/users.js` + UI）
- `PUT /api/users/:id` 支援 `is_erp_admin` 欄位
- `UserManagement.tsx` 權限區塊新增 ERP 管理員 checkbox（橘色 accent）

### 分類管理升級（`FeedbackCategoryManager.tsx`）
- **Icon picker**：內建 ~55 個常用 lucide icon grid + 搜尋 + 支援自訂名稱
- **拖曳排序**：HTML5 native drag-and-drop；drop 後呼叫 `PUT /feedback/admin/categories/reorder { ids }`，server 依陣列順序設 `sort_order = 1..N`
- **ERP flag checkbox**：新增/編輯都有，列表顯示橘色 `ERP` 徽章

### API 新增
- `PUT /feedback/admin/categories/reorder` → `{ ids: [1,3,2,4] }`
- 現有 `POST`/`PUT` `/feedback/admin/categories` 支援 `is_erp` 欄位

### 保留的相容性考量
- 舊分類 `is_erp` 預設 0（不影響現有流程）
- 未設 `is_erp_admin` 的 user 行為不變
- Webex Bot 未啟用時 ERP room 建立邏輯一樣 graceful skip

---

## KB 架構升級 + Webex 分流（2026-04）

背景：使用者透過對話紀錄學習解題方法，原架構雙 KB（`feedback-public` 脫敏 / `feedback-admin` 完整）只有摘要、不含完整對話與附件，且管理員群組所有人都收到每則留言，噪音大。

升級切成 4 個 PR，漸進上線：

### PR 1 — Archive 表 + admin KB 廢除 ✅

**DB migration**
- 新增 `feedback_conversation_archive`（append-only 完整原始快照，永久保留）
- 新增 `kb_chunks.metadata CLOB` 欄位（存 `ticket_no / position_type / attachment_url` 等）
- 一次性清理：DELETE 舊 `feedback-admin` KB + chunks/documents

**新增檔案**
- `server/services/feedbackArchive.js` — `writeSnapshot / listSnapshots / getSnapshot`
- `client/src/components/feedback/admin/TicketArchiveModal.tsx` — 歷史快照查閱 UI

**修改檔案**
- `server/routes/feedback.js`
  - `PUT /tickets/:id/resolve` / `reopen` 同步寫 archive snapshot
  - `PUT /tickets/:id/status`（closed）寫 snapshot
  - 新端點 `GET /tickets/:id/archive`（admin only，列快照）
  - 新端點 `GET /archive/:snapshotId`（admin only，讀快照全文）
- `server/services/feedbackKBSync.js` — 移除雙 KB 分支，`searchFeedbackKB(db, query, limit)` 簡化 signature
- `server/services/feedbackAIService.js` — 配合新 signature
- `client/src/pages/FeedbackDetailPage.tsx` — header 加 Archive icon button（admin）
- i18n 新增 `feedback.archiveTitle / noSnapshots / selectSnapshot`（3 語系）

### PR 2 — KB 內容升級（對話 + 附件 + LLM 脫敏 + parent/child）✅

**新增檔案**
- `server/services/feedbackRedactor.js`
  - LLM 脫敏（Gemini Flash，temperature=0）
  - system prompt 明確列出 REPLACE（人名/工號/email）和 KEEP（部門/機台 SN/技術內容）
  - `redactSafe()` 失敗自動 fallback regex
- `server/services/feedbackAttachmentProcessor.js`
  - 圖片 → `kbDocParser.imageToText`（Gemini Vision OCR）
  - PDF/DOCX/XLSX/PPTX → `kbDocParser.parseDocument`
  - TXT/MD/CSV → 直接讀取前 20KB
  - 循序跑 400ms 間隔保護 rate limit
- `server/scripts/feedbackRedactionDemo.js` — 脫敏 before/after 對照
- `server/scripts/testFeedbackKBSync.js` — 單張工單同步實測

**重寫 `server/services/feedbackKBSync.js`**
- 每張工單拆成多個 child chunks：
  - `header` × 1（問題描述）
  - `message` × N（對話逐則，`is_internal` / `is_system` 跳過）
  - `attachment` × M（附件 caption）
  - `resolution` × 1（最終解決方案）
- 所有 child 的 `parent_content` 存完整脫敏工單摘要
- metadata 欄位：`ticket_no / category / position_type / message_id / sender_role / attachment_id / attachment_url / mime_type / resolved_at`
- 脫敏 pipeline：parent summary + 每個 chunk 循序過 LLM（200ms gap）
- `embedBatch` 一次處理所有 chunks
- 單張工單同步約 60–90 秒，fire-and-forget 背景執行

**實測結果**
- FB-202604080944：6 chunks（含 1 附件 Vision OCR）
- FB-202604081014：5 chunks
- 跨工單檢索「問題處理進度」→ 兩張都命中相近 chunk（score ≥ 0.81）

### PR 3 — 歷史回填 migration ✅

**新增檔案**
- `server/scripts/backfillFeedbackKB.js`

**功能**
- `--dry-run` / `--resume` / `--force` / `--from-ticket-id=N` / `--limit=N`
- 掃所有 `status IN ('resolved', 'closed')` 工單
- 每張：先寫 archive snapshot（`trigger='migration'`）→ 再 syncTicketToKB
- 進度寫 `server/tmp/backfill-progress.json`，中斷可 `--resume` 續跑
- 失敗不中斷整批，記到 `progress.failed[]`
- 每張間 1.5s 保護 rate limit

**Idempotent**
- Archive：判斷 `(ticket_id, trigger='migration')` 已存在則跳過（除非 `--force`）
- KB sync：本身 `DELETE + INSERT`，可無限重跑

**Prod 執行建議**
```bash
kubectl exec -it <pod> -- node server/scripts/backfillFeedbackKB.js --dry-run
kubectl exec -it <pod> -- node server/scripts/backfillFeedbackKB.js --limit=5
kubectl exec -it <pod> -- node server/scripts/backfillFeedbackKB.js | tee /tmp/backfill.log
```

每張 60–90 秒，1000 張 ≈ 20–25 小時，建議離峰或分批跑。

### PR 4 — Webex 分流（B 方案）✅

**目的**：降低管理員群組噪音，已指派的工單改 DM 給接單者；群組只保留招領 + 結案/重開 summary。

**Migration**
- `feedback_tickets.webex_parent_message_id VARCHAR2(100)` — DM thread parent message id

**修改檔案**
- `server/services/webexService.js`
  - 新增 `sendDirectMessage(toPersonEmail, markdown, { parentId? })`
  - 遇到 `parentId` 指向對方看不到的 room → catch 400 自動 fallback 不帶 parentId 重送
- `server/services/feedbackNotificationService.js` — 整體重寫
  - 新增 `_sendToRoom` / `_sendDm` / `_recordWebexParent` / `_clearWebexParent` helper
  - 新增 event handlers：
    - `onTicketAssigned(db, ticket, assignerId, assignerName)` — 群組 summary + DM assignee 起 thread + 存 parent id
    - `onTicketReassigned(db, ticket, oldAssigneeId, newAssigneeId, actorName)` — 舊 assignee DM「轉出」+ 新 assignee DM「接單 + 上下文」+ 改存新 parent id
  - 強化 event handlers：
    - `onTicketResolved` — 加 DM applicant + DM assignee（thread 接續）+ 群組 summary + 清 parent id
    - `onTicketReopened` — 加 DM assignee + 群組 summary + 清 parent id（下次 admin 回覆會重起 thread）
    - `onNewMessage` — 已指派 → DM assignee (thread)；未指派 → 群組；admin 回覆只站內通知 applicant
  - 新訊息模板 `_tplNewTicket / _tplNewMessage / _tplAssignedGroup / _tplAssignedDm / _tplResolvedGroup / _tplResolvedDmApplicant / _tplResolvedDmAssignee / _tplReopenedGroup / _tplReopenedDmAssignee / _tplReassignedOld / _tplReassignedNew`
- `server/routes/feedback.js`
  - `PUT /tickets/:id/assign` — 判斷首次認領 / 轉單 → 觸發對應事件
  - `POST /tickets/:id/messages` — 抓 `addMessage` 前後 `assigned_to` 差異，admin 首次回覆自動指派時觸發 `onTicketAssigned`；`onNewMessage` 帶最新 ticket 確保 Stage 分流正確

**Fallback 規則**
- `assigned_to` 使用者無 email → `_sendDm` 回傳 null，`onNewMessage` 改走群組
- `WEBEX_BOT_TOKEN` 未設 → 所有 `_sendToRoom` / `_sendDm` 直接 return null，無副作用

**關鍵點**
- Thread 只在 admin DM room 中串；applicant DM room 是不同的 direct room，不共用 parent id
- `webex_parent_message_id` 生命週期：`onTicketAssigned` / `onTicketReassigned` 寫入 → `onTicketResolved` / `onTicketReopened` 清空 → 下次 re-assign 重新寫

---

## 架構決策紀錄

| 決策 | 選項 | 最終 | 理由 |
|------|------|------|------|
| KB 分級 | 雙 KB（public 脫敏 / admin 完整） vs 單 KB + archive 表 | **單 KB + archive** | 雙 KB 內容幾乎一樣只差脫敏級別，維護成本高；admin 要原文走 archive 表即可 |
| 脫敏方式 | 純 regex vs LLM vs 混合 | **LLM + regex fallback** | LLM 能處理對話內「其他同事姓名」等 regex 抓不到的情況；fallback 保底 |
| 脫敏範圍 | 嚴格（含部門/機台 SN）vs 寬鬆（只人名/工號/email） | **寬鬆** | 部門/機台對技術分類有用，不影響個資；人名/工號/email 只有 admin 透過 archive 看 |
| Chunk 切法 | 整包 1 chunk vs parent/child | **parent/child** | 細粒度召回 + 回傳 parent 給 LLM 組上下文，品質顯著提升 |
| 附件處理 | 原圖存 KB vs 文字描述 | **文字描述（Vision caption）** | 原圖 embedding 成本高、用處低；caption 可 embed 可搜尋，原檔連結放 metadata |
| Archive 保留期 | 定期清 vs 永久 | **永久（未來 partition）** | 稽核/爭議需要，純 CLOB 容量成本可接受 |
| Webex 分流 | 群組 @mention vs 狀態機 DM vs 每工單 room | **狀態機 DM（B 方案）** | 噪音最低，接單者專注，團隊仍能看到招領/結案 summary |
| KB sync 時機 | 即時 vs 結案時 | **結案時** | 對話過程含誤解/走錯路，不是最終「知識」；即時 re-embed 成本高 |

---

## 脫敏 Prompt 設計

`server/services/feedbackRedactor.js` system prompt 設計要點：

```
TASK: Replace personal identifiers with bracketed placeholders.
       DO NOT change any other content.

REPLACE:
- Personal names (中/英/越) → [使用者]
- Employee IDs → [工號]
- Email addresses → [email]

KEEP UNCHANGED:
- Department codes (e.g., FEC01)
- Machine SN (e.g., SN12345)
- Error codes, URLs, IP, paths, SQL, code
- Dates, times, amounts, technical terms

RULES:
- Output MUST have same structure (newlines, markdown)
- Do NOT explain, summarize, or reword
- Do NOT translate
- If unsure whether a token is PII, leave it unchanged
- Output ONLY the redacted text
```

`generationConfig: { temperature: 0, topP: 1 }` 確保可重現。

**已知限制**：LLM 偶爾對超短（< 5 char）或純技術內容誤判 → regex fallback 保底。

---

## Help 手冊同步更新（2026-04-17）

配合 PR 1-5 功能完成，同步更新使用者手冊與管理員手冊。

### 使用者手冊（`u-feedback`，DB seed）

編輯 `server/data/_helpSeed_part2.js` 的 `u-feedback` section，`last_modified` bump 至 `2026-04-17`。

**新增 subsection**
- **結案工單如何幫助其他人**：脫敏進 KB、附件 Vision 索引、細粒度檢索、知識庫列表可見
- **ERP 類問題特殊處理**：選 ERP 分類 → 通知不同團隊、進獨立 KB、處理流程不變
- **管理員指引 pointer**：一行說明「設定部分請參考管理員手冊 → 問題反饋管理」

**修改**
- 附件上傳 subsection 加：`Ctrl+V 貼上的截圖會自動加上時戳命名（paste_MMDDHHmmss.ext）`
- FAQ 更新可見性說明（含 Cortex admin / ERP admin 分別）、知識庫脫敏 FAQ
- 移除原「管理員專屬功能」subsection（設定內容遷移到 admin 手冊）

### 管理員手冊（`a-feedback`，React JSX）

在 `client/src/pages/HelpPage.tsx` 的 `AdminManual` 新增 `a-feedback` section。

**涵蓋**
- 身份與可見性矩陣表（Cortex admin / 雙重 / ERP admin / 一般）
- 分類管理操作（icon picker / drag 排序 / ERP flag / 翻譯）
- ERP 分流架構對照表（Webex room / 群組成員 / 站內通知 / 知識庫 / 接單權限）
- 指派 ERP 管理員操作步驟
- Webex 分流狀態機（B 方案 Stage 1 / 2 + 轉單流程）
- 知識庫架構（feedback-public / feedback-erp / archive 表 + 結案執行流）
- 歷史工單快照（Archive）admin 操作說明
- 歷史回填腳本 `backfillFeedbackKB.js` 用法 + 參數 + 特性表
- 脫敏規則表（REPLACE / KEEP 對照）
- 問題排除表（7 種常見問題 + 原因 + 解法）
- 相關檔案清單表
