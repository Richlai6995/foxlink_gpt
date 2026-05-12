# Cortex 通用專案管理平台 — 實作 Roadmap

> 對應規格書:[projects-platform-spec.md](./projects-platform-spec.md) v0.4
> 解耦設計:[projects-platform-decoupling-architecture.md](./projects-platform-decoupling-architecture.md)
> Phase 1 啟動 checklist:[projects-platform-launch-checklist.md](./projects-platform-launch-checklist.md)
> 日期:2026-05-04(Phase 1 開工日 = 主管同意 + Day 0 名單 ready 後)

---

## ✅ Phase 0:Scaffolding 完成(2026-05-04)+ Sprint 0 補強(2026-05-04)

### 0.1 Phase 0 Scaffolding(2026-05-04 上午)

- ✅ `server/projects-platform/` directory + namespace 規範
- ✅ Feature flag `ENABLE_PROJECTS_PLATFORM` 邏輯
- ✅ Error boundary middleware(`asyncHandler` / `safeWorker`)
- ✅ LLM rate limiter(`llmQueue`,預設 5 req/s + burst 20)
- ✅ Logger wrapper(`[projects-platform]` prefix)
- ✅ Plugin registry + QUOTE / GENERAL plugin metadata
- ✅ Migration 001 scaffold(`project_types` / `projects` / `project_members` 3 張表 + ALTER ticket_messages 12 columns)
- ✅ Server.js mount 點(`/api/projects`,feature-flagged)
- ✅ database-oracle.js runMigrations hook
- ✅ Smoke test PASSED(load / feature flag on/off)

### 0.2 Sprint 0 補強(2026-05-04 下午)— 對齊 internal-admin-plan §G.1

- ✅ `middleware/sidebarPermissionMiddleware.js`(4 階段演進判定)
- ✅ `routes/internalAdmin.js`(/health + /overview + /system-health)
- ✅ `routes/me.js`(/me/visibility 給 client sidebar 用)
- ✅ 沿用 Cortex `verifyToken` auth middleware(只 import 不修改)
- ✅ Client: `hooks/useProjectsPlatformVisibility.ts`
- ✅ Client: `pages/ProjectsPlatform/index.tsx`(Overview + System Health 雙 tab)
- ✅ Client: `pages/ProjectsPlatform/InternalAdmin/Overview.tsx`(子頁清單 + sprint roadmap)
- ✅ Client: `pages/ProjectsPlatform/InternalAdmin/SystemHealth.tsx`(Feature flag / LLM queue / Plugins / 10s auto-refresh)
- ✅ App.tsx 加 `/projects-platform/*` route(lazy + Suspense)
- ✅ Sidebar.tsx 加 「📁 專案管理(beta)」 menu(只在 `can_see=true` 才顯示)
- ✅ Smoke test PASSED(admin / normal user / no user 三場景)
- ✅ TypeScript compile clean(我加的檔案 0 errors)

### 0.3 部署 Sprint 0 補強後的效果

```
Cortex admin 登入:
  → Sidebar 看到 "📁 專案管理(beta)" menu
  → 點進去 → /projects-platform
  → 看到 Internal Admin Overview(10 個子頁狀態列表)
  → 切到 System Health tab(Feature flag / LLM Queue / Plugins / 10s auto-refresh)

一般 user 登入:
  → Sidebar 看不到 "專案管理" menu
  → 直接訪問 /projects-platform → 自動 redirect 回 /chat
  → API /api/projects/* 全部 403
```

### 0.4 啟用方式

```bash
# .env 加:
ENABLE_PROJECTS_PLATFORM=true       # 啟用 module
ENABLE_PROJECTS_WORKERS=true        # 啟用 workers(預設 = ENABLED)
PROJECTS_PLATFORM_GA_MODE=false     # 預設 false(只給 admin 看)
PILOT_USERS=                        # 預設空(Pilot 啟動時填 user_id list)
```

### 0.2 檔案清單(2026-05-04)

```
server/projects-platform/
├── README.md                          5 條硬規則 + 目錄結構 + Feature flag
├── index.js                            入口 + buildRouter + runMigrations + startWorkers
├── middleware/
│   └── errorBoundary.js                asyncHandler + safeWorker
├── services/
│   ├── llmQueue.js                     Token bucket rate limiter
│   └── logger.js                       [projects-platform] prefix logger
├── plugins/
│   ├── registry.js                     plugin 註冊表
│   ├── quote/index.js                  QUOTE plugin(7 default channels + 8 stages)
│   └── general/index.js                GENERAL plugin(2 default channels + 4 stages)
├── migrations/
│   └── 001_init.js                     PROJECT_TYPES / PROJECTS / PROJECT_MEMBERS
│                                       + ALTER TICKET_MESSAGES x 12 columns
├── routes/                             (空,Phase 1 各 sprint 實作)
├── workers/                            (空)
└── ai/                                 (空)
```

---

## Phase 1 開發切片

> **2026-05-12 重大調整** — 對齊新增的三份規格文件:
> - `docs/Cortex_通用專案管理平台_UI模擬與操作流程.pdf`(29 slide)
> - `docs/Cortex_Demo操作手冊.pdf`(21 頁)
> - `docs/Cortex_互動Demo.html`(11322 行,**設計風格 source of truth**)
>
> Sprint 1+2 後端 schema / service / routes 全部保留(channel + message + task DB schema 已 ready);
> **Sprint 1+2 React UI 改走新 Ocean Depth 亮色 shell**(navy topbar + slide-in sidebar + main 容器),
> 走 Sprint A-F 新節奏(原 Sprint 3-12 對應到 Sprint C-F)。

### ✅ Sprint A — Demo Shell + 我的專案 + 戰情會議室 stub(2026-05-12 完成)

**目標**:對齊 docs/Cortex_互動Demo.html 風格,進 /projects-platform 整個畫面切換成獨立 shell

**已完成**:
- ✅ Tailwind config 加 `cortex.*` brand colors(navy / cyan / teal / ocean / amber / red / green + ink/text/muted/line/bg)
- ✅ `tokens.ts`:LIFECYCLE_COLORS / MESSAGE_STYLE / DEMO_ROLES 設計 token
- ✅ Shell:`PlatformShell` + `Topbar`(navy + brand + breadcrumb + 通知 + avatar)+ `Sidebar`(slide-in 主入口 / Project Types / 管理 三段)+ `RoleSwitcher`(6 demo 視角 dropdown)
- ✅ `PlatformContext`:sidebar 開關 / demoRole / crumbs + 鍵盤 M 快捷
- ✅ `Projects/ProjectsList`:卡片 grid 4 columns,filter chips(全部/進行中/暫停/已結案/機密案)+ 搜尋
- ✅ `Projects/ProjectCard`:對齊 HTML demo .proj-card(ID/type/機密 → 標題 → meta → conditional banner → SLA 燈/progress bar/avatars)
- ✅ `WarRoom`:8-stage ribbon + 4 分頁(聊天/任務/Form/成員)各先 stub
- ✅ `WarRoom/StageRibbon`:5 種 stage 狀態(PENDING/ACTIVE/READY_FOR_GATE/DONE/SKIPPED)+ ⚖ Gate 標記
- ✅ Internal Admin Overview + System Health 重寫為 light theme(對齊 shell)
- ✅ Routes:`/projects-platform` index = ProjectsList,`projects/:id` = WarRoom,`internal-admin/*` admin only
- ✅ TypeScript compile clean(我加的檔案 0 errors)
- ✅ 砍掉 Sprint 1+2 的 5 個深色 React UI 檔(HomeTabs/ProjectsList/NewProjectDialog/ProjectDetail/WarRoom)

**Deliverable**:整個 Cortex Projects Platform UI 切換到 Ocean Depth 亮色;進 `/projects-platform` 看到獨立 shell ✓

---

### ✅ Sprint B — ⭐ 開案 Wizard 7 步驟(2026-05-12 完成)

**目標**:對齊 PPT slide 5-8 + Demo 手冊 §7;UI 完整,AI mock,Sprint F 接真實 Gemini Flash

**已完成**:
- ✅ `wizardState.ts`:WizardData type + INITIAL_WIZARD + generateProjectCode(Q-YYYY-NNNN)
- ✅ `WizardStepper`:7 圓點 + 連接線(active gradient / done cyan / pending grey),點圓可跳
- ✅ `WizardSteps`(Step 1-7 同檔):
  - Step 1 客戶來信 — 拖檔 + AI 預填 4 欄位 + 信心度(92%)+ AI 助手 navy panel + 規格不清提示
  - Step 2 歷史參考 — 3 案推薦卡(WIN/LOSS)+ AI 推薦 PM(Mike Wang)+ 推薦 Workflow + 預估週期 + 交期合理性綠燈
  - Step 3 機密設定 — 6 欄位 TIER/ALIAS/MASK/RANGE/NONE 策略 + toggle + AI 判定理由
  - Step 4 PM/Team — 業務 + 助理 + 4 PM 指派(DPM/BPM/MPM/EPM)+ AI 推薦來源
  - Step 5 流程模板 — 8 stages 卡片(⚖ GATE / ⚡ 並行 / SLA)+ Dependency 列表 navy panel
  - Step 6 priority 矩陣 — 3×3 點擊選 score(高重/中重/低重 × 低急/中急/高急)+ AI 推薦理由
  - Step 7 確認啟動 — 6 區預覽 + 5 件事清單(建 channels / stages / 通知 / Pin / SLA)
- ✅ `WizardModal`:navy header + stepper + content + 上/下步 + 「✓ 啟動專案」
- ✅ 啟動接 backend POST /projects(project_code 自動產生 / data_payload 帶 wizard 所有 step 結果 / importance 從 priorityScore 推)
- ✅ 啟動成功 → 自動跳 WarRoom(因 backend 已建 7 channels + 8 stages)
- ✅ ProjectsList「+ 新增專案」按鈕觸發 + reload after close
- ✅ TypeScript compile clean(我加的檔案 0 errors)

**Deliverable**:demo 跑得起來,30min → 5min 開案流程完整呈現 ✓

**Sprint F 補**(real AI):
- ⏳ Step 1 RFQ PDF 真實上傳 + Gemini Flash 解析(#1)
- ⏳ Step 2 真實歷史相似案 RAG(#2)+ 真實 PM 推薦(#37)+ 真實交期合理性(#32)
- ⏳ Step 3 AI 預判機密欄位(rule-based)
- ⏳ Step 4 真實 PM team member 邀請邏輯
- ⏳ Step 6 AI 推薦 priority_score

---

### ✅ Sprint C — 戰情會議室填肉(2026-05-12 完成,Form 留 Sprint E)

**目標**:聊天 / 任務 / 成員 3 分頁完整功能;Form 待 Sprint E

**已完成 聊天分頁**:
- ✅ `WarRoom/ChannelList`:左欄,分組顯示(公告 / 頻道 / 私訊 DM),選 channel 切換
- ✅ `WarRoom/MessageList`:訊息流 + 5 色語言 + Pin/Unpin/Delete hover + 5s polling + 自動同步公告標記 + pinned banner
- ✅ `WarRoom/MessageInput`:類型 selector + Cmd/Ctrl+Enter 送出 + announcement 限制
- ✅ `WarRoom/ChatTab`:3 欄 layout(channels | messages | 右欄 Status SUMMARY placeholder + Stages 進度)
- ✅ Demo role(OBSERVER/OUTSIDER)時 input 自動 readonly + 提示

**已完成 任務分頁**:
- ✅ Backend `services/tasksService.js`:list / get / create / update / status / 自動算 computed_due_at(dependency-based)
- ✅ Backend `routes/tasks.js`:GET / POST / GET :id / PATCH :id / POST :id/status / DELETE
- ✅ Backend mount `/projects/:id/tasks` 進 projects route
- ✅ Frontend `api.ts` 加 `Task` type
- ✅ `WarRoom/TasksTab`:5 欄 Kanban(PENDING/IN_PROGRESS/BLOCKED/READY_FOR_REVIEW/DONE)
  - RACI:A 紅 pill(accountable_role)+ R 藍 pill(primary_owner_user_id)
  - Dependency chip:`⏰ 上游 task+Nd` 顯示
  - Overdue 紅框警示
  - 機密 task 🔒 標記
  - BLOCKED 顯示 blocker_reason
  - Progress bar(0-100%)
  - 點卡片開 detail modal:狀態快速切換 + 5 button
  - 「+ 新任務」quick-create modal(title / stage / accountable_role)

**已完成 成員分頁**:
- ✅ `WarRoom/MembersTab`:Multi-PM Team 分組(業務 HOST / DPM / BPM / MPM / EPM / 採購跨 team / 其他)
- ✅ Wizard 填的 PM 三劍客預覽卡
- ✅ 顯示 invited_by_pm_user_id 自然涌現箭頭

**Sprint 1 smoke test PASSED**(backend 不破壞);TypeScript compile clean

**Form 分頁** → 留 Sprint E(需新 migration 007-010 + form builder UI)

**Deliverable**:demo Story 2-7 跑得起來 — 聊天 + 任務 + 成員 視覺化完整 ✓

**聊天分頁**(對齊 Sprint 2 後端):
- 7 channel + DM 列表(sidebar 左側)
- 訊息流 + 5 色語言(NORMAL/PROGRESS/BLOCKER/DECISION/AI_INSIGHT)
- BLOCKER/DECISION/AI_INSIGHT 自動同步 #announcement 提示
- Pin / Unpin / 刪除 / Emergency Purge
- 對話 ⇄ 事件流 toggle(audit-friendly view)
- @bot summary 觸發(stub)

**任務分頁**:
- migration 007:project_tasks routes(Sprint 1 已 schema,補 service + route)
- Kanban / EPIC 樹 toggle
- RACI A/R pill(紅/藍)
- Dependency-based deadline chip(⏰ QA+1d / EE BOM+3d)
- 點 task 開細節 modal

**Form 分頁**:
- migration 008:`qp_form_templates` + `qp_form_template_fields` + `qp_form_instances` + `qp_form_field_values`
- 版本鏈 v1→v2→v3★→v4→FINAL
- 6 sections 進度導航
- 機密欄位 lock icon
- ERP 快照 tag(stub,Sprint E 接)

**成員分頁**:
- Multi-PM Team 分組(業務 HOST / DPM Team / MPM Team / BPM Team / EPM)
- `invited_by_pm_user_id` 自然涌現
- 邀請 / 踢人 / 改 role(host only)

**Deliverable**:戰情會議室 4 分頁可實際操作,demo Story 2-7 跑得起來

---

### ✅ Sprint D — 跨專案儀表板 + ⭐ Status SUMMARY 三處(2026-05-12 完成)

**目標**:對齊 PPT slide 13-14 + Demo 手冊 §8.4

**Backend(server/projects-platform/)**:
- ✅ `services/dashboardService.js`:7 widget data 聚合(SLA 燈號 / Watchlist / 我的 Task / 待 Review / Delay 熱點 / KPI / 成員負載)
- ✅ `ai/statusSummary.js`:三段式 SUMMARY 產生器(進度/風險/待辦)+ 30 min cache
  - 從 project + stages + tasks 算 mock 摘要(Sprint F 換 Gemini Flash)
  - `pinToAnnouncement` 自動寫 AI_INSIGHT 訊息 + 取代上一則 Pin
- ✅ `routes/dashboard.js`:
  - GET /  — 7 widget 一次回
  - GET /summary/:projectId — 單一 summary
  - POST /summary/:projectId/refresh — 強制刷
  - POST /summary/:projectId/pin — Pin 到 announcement(PM/admin)
  - POST /summary/batch — 批次拉(給 list 用)
- ✅ Mount `/api/projects/dashboard`

**Frontend(client/src/pages/ProjectsPlatform/Dashboard/)**:
- ✅ `Dashboard.tsx`:7 widget 完整 layout
  - Widget 1 SLA 燈號:4 卡點擊 drill-down
  - Widget 2 Watchlist:hover 顯示 ⭐ SUMMARY tooltip(navy 漸層卡)
  - Widget 3 我的 Task:紅/黃/綠 計數
  - Widget 4 待 Review:form / task
  - Widget 5 Delay 熱點:per stage bar(漸層紅)
  - Widget 6 本期 KPI:4 數字 grid
  - Widget 7 成員負載熱圖:per user load% + alert
  - AI 預測警示 3 phase 卡(A 規則式 ✓ / B RAG ⏳ / C ML ○)
- ✅ `WatchlistTooltip.tsx`:hover 顯示三段式 SUMMARY(進度/風險/待辦)
- ✅ `/projects-platform/dashboard` 路由 + sidebar link 啟用(不再 stub)
- ✅ ProjectsList 批次拉 `/dashboard/summary/batch`,one_liner 顯示在 ProjectCard 列表行下(⭐ 三處之二)

**⭐ Status SUMMARY 三處顯示**:
1. ✅ **#announcement Pin** — 走 `POST /dashboard/summary/:id/pin`(AI_INSIGHT 訊息,Sprint 2 後端的 announcement 同步 + Pin 機制)
2. ✅ **專案列表行下** — ProjectCard 的 ai_summary slot 接 one_liner
3. ✅ **Watchlist hover** — WatchlistTooltip 三段式完整摘要

**Sprint F 補**:
- ⏳ 真實 Gemini Flash 摘要(目前 mock,但結構對齊)
- ⏳ `workers/statusSummaryWorker.js`:每天 09:00 cron + Stage 切換 hook

**Sprint 1 smoke test PASSED**(regression OK);TypeScript compile clean

---

### ⏳ Sprint E.1 — Admin 後台 5 頁(2026-05-12 完成 UI demo;後端串接留 E.2 / F)

**已完成**(全 client UI,mock data,結構對齊 HTML demo + spec):
- ✅ `Admin/AdminPageShell.tsx`:共用 layout(page head + scope toggle SYSTEM/BU/USER)
- ✅ `Admin/FormTemplates.tsx`:3-pane designer(sections / fields / properties + 機密策略矩陣)
  - 6 sections × 18 fields(QUOTE)+ 4 type tabs + version card + scope toggle
- ✅ `Admin/TaskTemplates.tsx`:EPIC × SUBTASK 樹(6 EPIC × 24 SUBTASK QUOTE)
  - 收合 / 選中切換 properties / RACI A·R pill / Dependency chip
- ✅ `Admin/NotificationRules.tsx`:5 通道 + 8 規則 + 2 escalation chain
  - 規則 enable toggle / 優先序 pill / 通道 icon row
- ✅ `Admin/Connections.tsx`:5 source_type + 6 連線 + Field Mapping 視覺化
  - 拖拉箭頭 placeholder + 安全規範 banner
- ✅ `Admin/ConfidentialPolicies.tsx`:**4 顯示策略 + 6 角色 demo**(即時切換)
  - TIER / ALIAS / MASK / RANGE explainer 卡
  - 互動 demo 表格:切右上「視角」dropdown,即時看每個欄位顯示變化(HOST/PARTICIPANT/OBSERVER/CHAT_GUEST/SUPER/OUTSIDER)
- ✅ Routes:`/projects-platform/admin/{form-templates|task-templates|notification-rules|connections|confidential-policies}`
- ✅ Sidebar 5 個管理 link 啟用(只有「系統設定」still stub)

### ⏳ Sprint E.2 — 後端串接(待做)

- 機密欄位 `confidentialityMiddleware` 真實套 displayStrategy(目前前端 mock)
- Form template CRUD(qp_form_templates migration 007-010)
- Task template CRUD(沿用 Sprint 1 schema,UI 寫值進 DB)
- Notification rule routing engine + Webex / Email gateway 串接
- Connection CRUD + inboundResolver 真接 ERP / SQL
- 6 角色 demo 真實串到後端(X-Demo-Role header 切換)

---

### Sprint E — Admin 後台 + 機密 + Inbound(原計畫,已切成 E.1 UI + E.2 後端串接)

**目標**:對齊 demo Story 10, 11 + 機密 4 策略

**Admin 後台**:
- 表單範本(3-pane designer:sections / fields / 屬性面板 + 機密策略矩陣)
- 任務模板(EPIC × SUBTASK)
- 通知規則(5 通道 + 8 規則 + 2 escalation chain)
- 連線管理(ERP/SQL + Field Mapping UI)
- Workflow Template 三層 scope(SYSTEM/BU/USER)

**機密保護**:
- `confidentialityMiddleware`(集中)+ 4 顯示策略 TIER/ALIAS/MASK/RANGE
- AES-256-GCM 加密(沿用 Cortex KMS)
- field_grants 個別授權
- 6 角色切換 demo 真實接 displayStrategy

**Inbound**:
- `qp_data_connections` + `qp_data_source_definitions` + `qp_form_field_data_bindings`
- `inboundResolver.js`:custom_sql / custom_plsql
- 視覺化 Field Mapping UI(拖拉箭頭)
- snapshot 機制

**Deliverable**:admin 完整 + 機密 demo 6 角色切換可看到不同畫面

---

### Sprint F — AI 加速 10 項 + KB 雙層(2 週)

**目標**:對齊 PPT slide 21 + Demo 手冊 §8

**AI 10 項**(全走 Gemini Flash · LLM queue rate limit · USD $150-250/月預算):
- ⭐ #21 Status SUMMARY(Sprint D 已上,此處補三處顯示完整)
- #1 RFQ 自動解析(整合 Wizard Step 1)
- #2 歷史相似案推薦(整合 Wizard Step 2)
- #5 Q&A 問題自動草稿
- #23 AI 決策紀錄自動 Pin
- #24 訊息智慧排序
- #26 Bot 主動提醒(SLA 接近 @owner)
- #29 任務自動拆解(一句話 → 子任務)
- #32 交期合理性燈
- #37 歷史案主動推薦

**KB 雙層**:
- Live KB(per-project)+ Sediment KB(跨專案)
- 結案 Fork:AI 摘要 + 脫敏 + 不可逆
- RAG 查詢

**Deliverable**:demo Story 7 + 9 跑得完整;Phase 1 ready → Pilot

---

## 原 Sprint 1-12 對應到新 Sprint A-F

| 原 Sprint | 新 Sprint | 備註 |
|-----------|-----------|------|
| Sprint 1 (Schema + CRUD) | ✅ 後端保留 / UI 砍 → Sprint A 重寫 | DB 不動 |
| Sprint 2 (Multi-Channel) | ✅ 後端保留 / UI 砍 → Sprint C 聊天分頁接 | 後端 messages API 已 ready |
| Sprint 3 (機密欄位) | Sprint E | |
| Sprint 4 (Form GUI) | Sprint C / E | C 做使用,E 做 admin builder |
| Sprint 5 (Inbound) | Sprint E | |
| Sprint 6 (任務 + Dependency) | Sprint C | |
| Sprint 7 (Lifecycle + Notification) | Sprint E + D | lifecycle 已在後端,notification 規則 admin 在 E |
| Sprint 8 (跨專案儀表板) | Sprint D | |
| Sprint 9 (Wizard + Status SUMMARY) | Sprint B + D | Wizard 拆出來獨立 sprint |
| Sprint 10 (AI 其他 6 項) | Sprint F | |
| Sprint 11 (角色身份 + admin) | Sprint E | |
| Sprint 12 (Smoke + Pilot) | Sprint F 末 | |

---

## Phase 1 開發切片(舊版 ~6 週 / 12 sprints,2026-05-12 廢止)

依優先序排序,每個 sprint 約 0.5 週。Cortex 既有 user 完全不受影響(feature flag = false 預設,Pilot 才開)。

### ✅ Sprint 1 — Schema + 核心 CRUD(2026-05-11 完成)

**目標**:能建專案、列表、查詳細(無 task / form,channel 用預設清單建出來)

**已完成**:
- ✅ migration 002:`project_channels` + `channel_participants`(2 表)
- ✅ migration 003:`project_stages` + `workflow_templates` + `workflow_template_stages`(3 表)
- ✅ migration 004:`project_tasks`(RACI + Dependency + Multi-PM 欄位齊)
- ✅ migration 005-seed:plugin registry → DB(QUOTE 8 stages / GENERAL 4 stages 自動同步)
- ✅ `services/projectsService.js`:create / list / get / updateLifecycle(5-state 狀態機)
- ✅ `middleware/projectAclMiddleware.js`:loadProject + requireProjectMember + requirePmOrAdmin
- ✅ `routes/projects.js`:GET /types / GET /(列表) / POST /(建立) / GET /:id / POST /:id/lifecycle
- ✅ plugin registry bootAll 正式 require QUOTE/GENERAL
- ✅ mount `/projects` route 進 buildRouter
- ✅ smoke test `server/scripts/smoke-projects-platform-sprint1.js` PASSED
  - QUOTE 自動建 7 channels + 8 stages ✓
  - GENERAL 自動建 2 channels + 4 stages ✓
  - 5-state lifecycle DRAFT→ACTIVE→PAUSED→ACTIVE→CLOSED→REOPENED→ACTIVE ✓
  - 非法轉移 CLOSED→ACTIVE 被擋 ✓
  - 沿用 Cortex `verifyToken` middleware

**Deliverable**:`POST /api/projects/projects` 能建出最小 project + 自動建預設 channels + stages + PM membership ✓

---

### ✅ Sprint 2 — Multi-Channel 戰情會議室(2026-05-11 完成,WebSocket 留 Sprint 後段)

**目標**:Slack-like 多 channel + 訊息流(REST + polling demo)

**設計決定(2026-05-11 修正)**:
- 原寫「reuse ticket_messages」誤判 — Cortex 實際表叫 `feedback_messages` 且 schema 不適合
- 改為**新建 `project_messages` 表**(migration 006),真正符合解耦規則 1「不動既有 Cortex schema」
- migration 001 移除錯誤的 `ALTER TICKET_MESSAGES x12`(原本全部 ORA-00942 被靜默吞掉)

**已完成**:
- ✅ migration 006:`project_messages` + `project_message_read_receipts`(2 表)
- ✅ `services/channelsService.js`:listForProject / listForUser / create / findOrCreateDM / archive / participants / markRead
- ✅ `services/messagesService.js`:post / list / pin / unpin / softDelete / emergencyPurge / read receipts
- ✅ 訊息色語言:NORMAL / PROGRESS / BLOCKER / DECISION / AI_INSIGHT / SYSTEM
- ✅ **自動同步 announcement**:BLOCKER / DECISION / AI_INSIGHT 自動以 SYSTEM 訊息 post 到 announcement channel(含原 channel 參照 + 連結)
- ✅ Pin / Unpin + listPinned + 權限:author / PM / admin
- ✅ DM 1:1 私聊(`channel_type='dm'`,`name='dm:lo+hi'` idempotent)
- ✅ 訊息刪除雙模式:`standard` soft / `emergency_purge` 抹除 content(需 reason,PM/admin only)
- ✅ Read receipt(`requires_read_receipt=1` 才寫,UNIQUE 防重)
- ✅ `routes/channels.js`:project-scoped + message-scoped REST API
- ✅ announcement channel 禁止一般人發訊息(只 PM/admin)
- ✅ archive default channel 被擋
- ✅ smoke test `smoke-projects-platform-sprint2.js` PASSED(22 個 case)

**留 Sprint 後段**:
- ⏳ WebSocket / SSE 即時推送(Phase 1 demo 先用 polling)
- ⏳ Topic channel 動態拉群(Sprint 6 跟 task 一起做)
- ⏳ super_user self-join(走既有 `project_super_users` 表,Sprint 11 整理身份時做)

**Deliverable**:7 channels REST API 全運作 + DM + 訊息色語言 + Pin + Soft/Purge delete ✓

---

### Sprint 3 — 機密欄位機制(W2 後半)

**目標**:`confidentialityMiddleware` 集中 + 4 種顯示策略

**任務**:
- migration 006:`confidential_field_policies` + `confidentialityMiddleware` 表
- `middleware/confidentialityMiddleware.js`:
  - 偵測 is_confidential
  - 解密 / 套用 displayStrategy
  - 4 策略:TIER / ALIAS / MASK / RANGE
- AES-256-GCM 加解密(沿用 Cortex 既有 KMS / Vault Transit)
- field_grants 個別授權
- 機密旗標切換規則(non-conf → conf OK,反之禁)

**Deliverable**:機密欄位完整保護 + admin 介面設策略

---

### Sprint 4 — Form 引擎 + GUI Builder(W3)

**目標**:Form template + instance + 版本鏈 + GUI Builder UI

**任務**:
- migration 007-009:`qp_form_templates` + `qp_form_template_fields` + `qp_form_template_sections` + `qp_form_template_calculations`
- migration 010:`qp_form_instances` + `qp_form_field_values` + `qp_form_calc_results` + `qp_form_ai_suggestions`
- `routes/forms.js` + `services/formEngine.js`
- 版本鏈(single-edit lock)
- AJV schema 驗證
- RACI 欄位(accountable_role + responsible_role)
- GUI Form Builder(前端 React)— **這是 Phase 1 比較重的 UI 工作**

**Deliverable**:admin 用 GUI 建 form template;PM 在 form instance 填值

---

### Sprint 5 — Inbound 資料整合(W4 前半)

**目標**:`custom_sql` + `custom_plsql` + 視覺化 Field Mapping UI

**任務**:
- migration 011:`qp_data_connections` + `qp_data_source_definitions` + `qp_form_field_data_bindings` + `qp_data_fetch_jobs`
- `services/inboundResolver.js`:跑 custom_sql / custom_plsql
- SQL injection 防護(SELECT only,參數化)
- ERP read-only role 驗證
- 視覺化 Field Mapping UI(前端 — 拖拉箭頭建立 source field → form field)
- snapshot 機制(`project_erp_snapshots`)

**Deliverable**:admin 寫 SQL,form field 自動拉值

---

### Sprint 6 — 任務指派 + Dependency Deadlines(W4 後半)

**目標**:大項 / 小項 + RACI + Multi-PM + Stage Gate + Dependency

**任務**:
- migration 004 補完(若 sprint 1 未完整):RACI 欄位 + dependency 欄位
- `routes/tasks.js` + `services/taskEngine.js`
- 大項 / 小項 nesting(EPIC + SUBTASK 1 層深)
- RACI:`accountable_role` + `primary_owner_*` + `collaborator_user_ids`
- Multi-PM:`project_members.sub_role`
- PM Team 自然涌現:`invited_by_pm_user_id`
- Dependency-based deadlines(`depends_on_task_id` + `relative_deadline_days`)
- Stage Gate(`PENDING/ACTIVE/READY_FOR_GATE/DONE`)
- 完成度回報 + 文件附件

**Deliverable**:任務完整工作流 + 燈號 roll-up

---

### Sprint 7 — Lifecycle + Notification 引擎(W5 前半)

**目標**:5-state lifecycle + SYSTEM scope notification + Webex/Email 推送

**任務**:
- 5-state lifecycle 狀態機(DRAFT / ACTIVE / PAUSED / CLOSED / REOPENED)
- 各 lifecycle 操作控制
- migration 012:`notification_rules` + `notification_escalation_chains`
- `services/notificationEngine.js`(沿用 Cortex 既有 schedule + Webex Bot + SMTP)
- SYSTEM scope rules seed(TASK_OVERDUE / TASK_AT_70 / DECISION_NEW / BLOCKER_NEW)
- Escalation chain(stepped + recipients + channels)
- 站內 Badge UI(sidebar / toolbar)

**Deliverable**:Lifecycle 完整 + 通知推送順暢

---

### Sprint 8 — 跨專案儀表板(W5 後半)

**目標**:7 widget grid + Watchlist + 自動訂閱 + 規則式警示

**任務**:
- `routes/dashboard.js` + `services/dashboardService.js`
- 7 widget(SLA 燈號 / Watchlist / 我的 Task / 待 Review / Delay 熱點 / KPI / 成員負載)
- `project_watchlists` + `project_auto_subscriptions`
- Auto-subscribe(priority_score >= 6)
- 規則式警示 widget A(未來 24h 危險清單)
- 即時 query(Phase 1 不加 cache)
- 前端 dashboard 頁(預設進儀表板)

**Deliverable**:主管登入專案管理立刻看到燈號

---

### Sprint 9 — AI 加速核心:Status SUMMARY + 開案 Wizard(W6 前半)

**目標**:⭐ 2 個核心 AI 功能 ship

**任務**:
- `ai/statusSummary.js`(#21)— LLM + scrub + Pin to announcement
- `workers/statusSummaryWorker.js`:每天 09:00 + Stage 切換 + 手動觸發
- 顯示 3 處:#announcement Pin / 專案列表行 / Watchlist hover
- `ai/rfqParser.js`(#1)— PDF/Email/Excel 解析 → 預填 form
- `ai/similarProjects.js`(#2 #37)— RAG 搜沉澱 KB,推薦 PM
- `ai/scheduleSanity.js`(#32)— 交期合理性燈號
- `routes/wizard.js` + `services/wizardService.js`— 7 步驟流程
- 前端 Wizard UI(7 步驟,AI 預填 + confirm)

**Deliverable**:⭐ Wizard 跑起來 + Status SUMMARY 三處顯示

---

### Sprint 10 — AI 加速其他 6 項(W6 後半)

**目標**:Channel 內 AI + 任務拆解

**任務**:
- `ai/qaDrafter.js`(#5)— RFQ + PRD → Q&A 問題清單
- `ai/decisionRecorder.js`(#23)— 訊息流偵測 + Pin 建議
- `ai/messageRanker.js`(#24)— @我 / DECISION / BLOCKER 排前
- `ai/proactiveBot.js`(#26)— SLA 70% 自動 @owner
- `ai/taskBreakdown.js`(#29)— 一句話 → 子任務 + 估時
- 整合到對應 channel / task UI

**Deliverable**:10 項 AI 加速全 ship

---

### Sprint 11 — 角色身份 + admin 介面(W7 前半)

**目標**:13 個身份 + admin 授權介面 + admin testing mode

**任務**:
- migration 013-014:`user_role_definitions` + `user_role_grants` + `organization_units` + `user_organization_memberships`
- `routes/admin.js`(在 projects-platform namespace 內):授權 / 列表 / 刪除
- 沿用 Cortex `a-admin-test` 機制(admin testing mode)
- 13 個 role seed(SYSTEM 預設)
- 前端 admin 頁面

**Deliverable**:admin 介面可授權 + 13 身份 ready

---

### Sprint 12 — Smoke Test + Pilot 準備(W7 後半 ~ W8)

**目標**:完整流程 smoke test + Pilot 啟動

**任務**:
- E2E 測試:Wizard 開案 → 進入 channels → 填 form → 建 task → 完成 stage → Stage Gate → 結案
- Cortex 既有功能回歸測試
- Feature flag ON/OFF 演練
- Rollback 機制驗證
- Pilot user 邀請(1-2 個真實 RFQ 案陪跑)
- 監控 dashboard 設定(Loki + Alert)

**Deliverable**:Phase 1 Ready → Pilot W9 開跑

---

## Phase 1 完成檢核標準

依[launch-checklist](./projects-platform-launch-checklist.md):

```
✅ 通用 schema + project_types
✅ workflow_templates(SYSTEM scope only)
✅ QUOTE plugin 最小版
✅ 機密欄位機制 + 4 顯示策略
✅ 多 channel 戰情會議室(含 DM)+ 7 預設 channels
✅ 大項/小項雙層 task + 多 owner + RACI(A+R)
✅ Multi-PM(sub_role)+ PM Team
✅ Dependency-based deadlines
✅ 燈號 roll-up + Project Lifecycle 5-state
✅ GUI Form Builder
✅ Notification SYSTEM scope
✅ Inbound 資料整合層(custom_sql + 視覺化 mapping)
✅ 跨專案儀表板(7 widget + Watchlist + 自動訂閱)
✅ 規則式警示 widget A
✅ ⭐ AI 加速 10 項 + 開案 Wizard
```

**回歸測試 100% pass** = 既有 Cortex 任何功能不受影響。

---

## 開發守則(每個 sprint 都要做的)

1. **每個 commit 都 keep feature flag = false 預設**(production 不受影響)
2. **每個 PR 過 5 條硬規則 review**(見 README.md)
3. **migration 都 idempotent**(可重跑)
4. **新 route 都用 `asyncHandler` 包**
5. **新 worker 都用 `safeWorker` 包**
6. **LLM call 都走 `llmQueue.withLLM`**
7. **新 log 都加 prefix**(用 `services/logger`)
8. **新 schema 都 `project_*` / `qp_*` 前綴**
9. **回歸測試** — 每 sprint 末跑既有 Cortex 主流程 smoke test

---

## Phase 2 / 3 / 4(後續)

依 spec §19 Phase 規劃,不重複。Phase 1 完成後另起 roadmap。
