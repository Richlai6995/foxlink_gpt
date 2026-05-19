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

### ✅ Sprint E.2 — 機密 displayStrategy 真實後端(2026-05-12 完成)

**核心**:6 角色機密 demo 真實串到後端,不再前端 mock。

- ✅ `middleware/confidentialityMiddleware.js`:4 顯示策略中央集中
  - `applyStrategy(value, strategy)`:TIER / ALIAS / MASK / RANGE
  - `maskProject(project, role)`:依 role 決定 mask 邏輯
  - `maskProjects(list, role)`:批次
  - `maskSummary(summary, role)`:Status SUMMARY mask
  - `getDemoRole(req)`:從 `X-Demo-Role` header 推
- ✅ 套用到 `routes/projects.js`:
  - GET / list 套 mask
  - GET /:id 對 CHAT_GUEST/OUTSIDER 機密案 → 403
  - GET /:id 對 PARTICIPANT 等套 displayStrategy
- ✅ 套用到 `routes/dashboard.js`:
  - GET /summary/:id 套 mask
  - POST /summary/batch 套 mask
- ✅ Frontend `api.ts` 加 `_demoRole` 全域 + `X-Demo-Role` header
- ✅ `PlatformContext.setDemoRole` 同步 + 觸發 reload event
- ✅ ProjectsList / WarRoom / Dashboard 監聽 demoRole 變化 → 自動 reload
- ✅ 6 角色行為(對齊 Demo 手冊 §10):
  - HOST/OBSERVER/SUPER:全明文
  - PARTICIPANT:走 displayStrategy
  - CHAT_GUEST:機密案 form 403
  - OUTSIDER:機密案全 403

**Form/Task template CRUD / Connection inboundResolver / Notification routing engine** 留 Sprint G 後續(範圍大不在 Phase 1)

---

### ✅ Sprint F — AI 加速一覽 + KB 雙層 + Gemini 接真實 LLM(2026-05-12 完成)

**目標**:對齊 PPT slide 21 + 18 + Demo 手冊 §8-9

- ✅ `AiAccel/AiAcceleration.tsx`:AI 加速 10 項一覽頁
  - Hero banner(navy → teal → purple gradient)+ LIVE/DEMO/TBD 計數
  - ⭐ Wizard banner(30min → 5min)
  - 必上 8 項 + 加分 2 項(每張卡含整合到哪些功能)
  - Phase 2-4 roadmap + Phase 1 成本估算
- ✅ `KB/KnowledgeBase.tsx`:Live KB + 沉澱 KB 雙層 toggle
  - Live KB:5 mock chunks(chat/form/task/attach 4 種類型)
  - 沉澱 KB:4 mock 結案案 + scrub 註記
  - Archive Pipeline 5 步驟流程說明
  - 範例 RAG 查詢 navy 卡
- ✅ Sidebar「AI 加速 10」+「KB / 知識庫」link 啟用(不再 stub)
- ✅ Routes:`/ai-acceleration` + `/kb`
- ✅ **真接 Gemini Flash**(`ai/statusSummary.js`):
  - `PROJECTS_PLATFORM_USE_LLM=true` 啟用
  - 走 `llmQueue.withLLM` rate limit
  - Prompt 對齊 三段式結構 + JSON 回傳
  - 失敗自動 fallback 回 mock(永遠不破 demo)
  - 預設 model:`gemini-flash`(可 `PROJECTS_PLATFORM_SUMMARY_MODEL` override)
- ✅ Sprint 1 smoke test PASSED(backend regression OK)
- ✅ TypeScript compile clean

**Demo 操作劇本**:[docs/projects-platform-demo-script.md](./projects-platform-demo-script.md)— 9 個 Story / 30-45 min

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

## Phase 1 → Production-Ready 補丁(spec 列但 demo 走 stub / mock 的)

> Phase 1 demo 對齊 spec 範圍已 ship(Sprint A-F + Batch 1+2),但部分項目是 stub。
> 這些**算 Phase 1 production polish,不歸 Phase 2-4**,因為 spec 都把它們列在 Phase 1。

| 項目 | spec 出處 | 現況 | 估時 |
|------|----------|------|------|
| AI #1 RFQ PDF 真解析(Gemini Vision)| spec §12 Phase 1 + Demo §7 | Wizard Step 1 mock 固定 Apple 範例 | 1d |
| AI #5 Q&A 草稿 | spec Phase 1 + Demo §8.1 | 完全沒做 | 1d |
| AI #26 Bot 主動提醒(SLA 70% cron + LLM)| spec Phase 1 + Demo §8.1 | 完全沒做 | 1d |
| AI #37 歷史推薦(Form 填寫時 RAG hint)| spec Phase 1 + Demo §8.2 | 完全沒做 | 1d |
| ⭐ 狀態 SUMMARY 每天 09:00 cron + Stage 切換 hook | spec §16.4 / Demo §8.4 | 只手動 API 觸發 | 0.5d |
| Notification 真發送(Webex Bot DM + SMTP)| spec §14.9 / Admin notification rules | console.log stub | 1d |
| WebSocket / SSE 即時推送(取代 5s polling)| spec §13.1 | polling | 1d |
| field_grants 個別授權 enforce(per-member 欄位授權)| spec §12.2 | data_payload 有但 middleware 沒 check | 1d |
| task DONE → stage READY_FOR_GATE 自動 hook | spec §13.7 | task 狀態變更不通知 stage | 0.5d |
| EPIC × SUBTASK 巢狀視覺化(parent_task_id 收合)| spec §14.4 | schema 有,UI 平層 | 1d |
| AES-256-GCM at rest 加密 + KMS / Vault Transit | spec §12.5 | confidentialityMiddleware 只在 read 層 mask | 2d |

**估時合計 ~ 12 天**(2 週 sprint),做完 Phase 1 才算 production-ready。

---

## Phase 2(原 spec §19 + PDF §E,4-8 週)

> 來源:`docs/Cortex_通用專案管理平台_UI模擬與操作流程.pdf` §E slide 24
> ```
> super_user / Bot 整合 · 結案 fork + KB sediment ·
> 域內通訊(跨專案 channel)· AI 戰情 embed ·
> AI 13 項深化(智慧定價 / Cleansheet / 主管日報)
> ```

### Phase 2 任務切片

#### Sprint H — super_user 機制 + 13 角色身份完整 ✅ ship 2026-05-18

- ✅ migration 008(原 plan 011 — 整理改名):`user_role_definitions` / `user_role_grants` / `organization_units` / `user_organization_memberships` / `project_super_users` / `admin_testing_sessions`
- ✅ 13 個 role seed(對齊 spec §17):project.* 6 + workflow.* 2 + data / notification / confidential 3 + admin / admin.testing 2
- ✅ `project_super_users` 表 + self-join 機制(`POST /projects/:id/super-join`,bu_super 卡 BU scope / hq_super GLOBAL)
- ✅ Admin UI 真實授權介面 `Admin/RoleGrants.tsx`(13 role 左欄 + grants 表格 + 新增 modal + 撤回 + LOV user 搜尋)
- ✅ `userRoleService.hasRole / getEffectiveRoles / grant / revoke` 完整
- ✅ `adminTestingService.enter / exit / getActiveSession`(1h timeout)
- ✅ Visibility middleware GA mode 真接 `user_role_grants`(有 project.* role 自動 visible)
- ✅ Project ACL 中 super_user + director 算 member(可進 WarRoom)
- ✅ `notification engine admin + super_user` target 真 union user_role_grants 撈

API:
- `GET /api/projects/internal-admin/roles` — 13 role definitions
- `GET /api/projects/internal-admin/role-grants?role_code=` — 列 grants
- `POST /api/projects/internal-admin/role-grants` — 授予
- `DELETE /api/projects/internal-admin/role-grants/:id` — 撤回
- `POST /api/projects/internal-admin/testing-mode/enter|exit`
- `POST /api/projects/projects/:id/super-join | super-leave`
- `GET /api/projects/projects/me/super-projects` — 自己 self-joined 的
- `GET /api/projects/me/roles` — 自己 active grants

#### Sprint I — Bot 整合(Phase 1 MVP) ✅ ship 2026-05-18

Phase 1 MVP 範圍:
- ✅ `@bot` / `@ai` mention in any channel(MessageInput 自動偵測 prefix)
- ✅ Tier 1 問答檢索 — RAG over `project_kb_chunks`(live+sediment)+ 最近 25 channel 訊息
- ✅ Tier 3 內容生成 — Bot 回 AI_INSIGHT 訊息(自動同步 #announcement,user 可 Pin)
- ✅ **兩段 scrub**:
  1. confidentialityMiddleware 套 user 視角(機密欄位 Tier-? / [CUST_REDACTED])
  2. plugin scrub_rules 把 customer / amount 等 raw 換成 [CUST_01] / [PRICE_01] 才送 LLM
  3. LLM 回應 unscrub 替回 user 視角
- ✅ Bot 永遠以發起 user 身份(spec §12.3)— 機密 / KB / ERP 都受 user 權限
- ✅ LLM 失敗 graceful fallback(post stub message + log 原因,demo 不炸)
- ✅ Gemini Flash + llmQueue token bucket 限速

Phase 2 補:
- ⏳ Tier 2 read-only tool(ERP procedure / MCP / Cortex skill registry)
- ⏳ Tier 4 write action(白名單 + 二次確認 UI:改 form / 建任務 / 推進 stage)
- ⏳ Multi-turn 對話 context(Bot 記得上次問題)
- ⏳ Token 計量 per-project + 不卡 user(spec §12.6)
- ⏳ Form 內「✨ AI 建議」按鈕(Surface 2,spec §12.1)
- ⏳ Plugin scrub_rules production(目前 botService 內 hardcoded base map)

新增:
- backend `services/botService.js` — 主入口 `ask(db, {projectId, channelId, user, question, demoRole})`
- backend route `POST /api/projects/projects/:id/channels/:cid/bot`
- frontend `MessageInput.tsx` — `@bot` / `@ai` prefix 偵測 + 紫色 mode UI + bot thinking indicator

#### Sprint J — 結案 fork + KB sediment production ✅ ship 2026-05-18

- ✅ migration 009(原 plan 014 — 整理改名):
  - `project_kb_chunks.embedding VECTOR(768, FLOAT32)`(spec §7.9 主信號)
  - `project_kb_chunks.title_embedding VECTOR(768, FLOAT32)`(spec §7.9.3 Title boost)
  - `project_kb_chunks.title / embedding_model / embedded_at / scrub_map_json`
  - `project_kb_sediment_audit` 表(audit trail)
  - 3 個索引:VECTOR INDEX × 2(content + title) + Oracle Text INDEX(content)+ SYNC 1min
- ✅ Production fork:
  - 嚴格 audit trail(誰 fork、何時、chunks_total/copied/scrubbed、scrub_map JSON、duration_ms)
  - **不可逆**(預設一次性 — 已 fork → skip + audit 留 `skip` action)
  - **admin override**(`force:true` 刪舊重 fork,audit 留 `re_fork` action)
  - `scrub_map_json` 記下每個被替的 raw → placeholder 對應
  - 自動 kick off embedding pipeline(背景非同步,失敗 graceful)
- ✅ Embedding pipeline:
  - `kbEmbeddingService.embedChunk / embedProjectChunks`
  - Gemini embedding-001 → 768 vec(env override 換模型 / dim)
  - **三層 embedding**:content + title + (P3 可加 question-rewrite)
  - p-limit(8 並行)+ llmQueue token bucket 限速
  - Auto-embed on writeLiveChunk + on forkToSediment(可 `PROJECTS_KB_AUTO_EMBED=false` 關)
- ✅ Hybrid search production:
  - `mode=auto` — vector cosine + Oracle Text BM25 → Reciprocal Rank Fusion (K=60)
  - `mode=vector` / `fulltext` / `like` 手動切
  - Title embedding boost(content 70% + title 30%)
  - Graceful fallback:vector 失敗 → full-text → LIKE
- ✅ Live KB 自動 chunk(spec §7 規格 4 kinds 全上,2026-05-18 補):
  - **chat**(messagesService 既有)
  - **task DONE**(tasksService.update 加 hook,Sprint J 補)
  - **form**(projectsService.create 寫 form chunk,kind='form' · 2026-05-18 補)
  - **attach**(projectsService.create 偵測 `data_payload.rfqFilePath` 寫 attach chunk · 2026-05-18 補)
  - 未來 form builder / attach service 上線後,各自 endpoint 再加 hook(已有 writeLiveChunk 入口)

API:
- `GET /api/projects/kb/search?q=&layer=&project_id=&mode=auto|vector|fulltext|like`
- `GET /api/projects/kb/chunks/:projectId?layer=` — 補 `embedding_model / embedded_at / has_embedding / has_title_embedding`
- `GET /api/projects/kb/audit/:projectId` — audit log
- `POST /api/projects/kb/fork/:projectId { force, notes }` — PM/admin 手動 (re-)fork
- `POST /api/projects/kb/embed/:projectId { sediment_only, force, limit }` — admin 批次 embed

UI:
- `KnowledgeBase.tsx` 加 mode 下拉 + project_id filter + 審計 toggle + admin 重 fork 按鈕
- 搜尋結果每筆顯 signal badge(向量/全文索引/混合 RRF/LIKE 退化)+ score + embedding model

#### Sprint K — 域內通訊(跨專案 channel) ✅ ship 2026-05-18

對齊 spec §10.4 + §13.5。

- ✅ migration 010(原 plan 用 `organization_channels` — 改名 `communication_rooms` 對齊 spec §10.4.2):
  - `communication_rooms`(`room_type='org_group' | 'org_dm'`,`scope='cross_org' | 'cross_project' | 'global'`,DM 用 `dm_user_a_id / dm_user_b_id` UNIQUE)
  - `comm_room_participants`(`user_id × room_id` UNIQUE,role + last_read_at + muted)
  - `comm_room_messages`(獨立 schema,鏡像 project_messages 但不含 announcement_sync / project_id)
- ✅ Service:
  - `commRoomService.createGroup / findOrCreateDm / listForUser / listForBu / canAccess / selfJoin / addParticipant / removeParticipant / archive / markRead`
  - `commMessageService.post / list / get / pin / unpin / softDelete`
- ✅ ACL(spec §10.4 + §17):
  - admin / hq_super / top_director 全看
  - DM:只 dm_user_a_id / dm_user_b_id + admin
  - global group(bu_id NULL):所有 user 可看
  - BU group:`user_organization_memberships`(該 BU 成員)+ `project.bu_director / bu_super` scope_values 含 bu_id
- ✅ Socket.io 即時推播:`comm:room:{roomId}` + `emitCommMessage` + `join_comm_room / leave_comm_room` + ACL check
- ✅ Routes(`/api/projects/comm-rooms/*`):
  - `GET /` — 我的 rooms(含 unread_count / last_message_at)
  - `GET /bu/:buId` — 列 BU group rooms(super_user / director)
  - `POST /groups` / `POST /dm` — 建立
  - `GET / POST / DELETE /:roomId/participants/*`
  - `POST /:roomId/join` — self-join BU room
  - `POST /:roomId/read` — mark read
  - `POST /:roomId/archive` — archive(owner / admin)
  - `GET / POST /:roomId/messages`
  - `POST /messages/:mid/pin | unpin` + `DELETE /messages/:mid`
- ✅ Frontend:
  - 新頁 `Messages/MessagesPage.tsx`(sidebar 「💌 訊息 · 域內」入口)
  - 分割 layout:左欄 room 列表(含未讀紅點)+ 右欄 chat header / messages / input
  - 「+ 新 Group」modal(name + description + bu_id + confidential)
  - 「+ 新 DM」modal(user LOV 搜尋,reuse `/internal-admin/users/search`)
  - Socket 即時推 `comm_new_message` → 自動 reload messages
  - 不寫 KB(spec §10.4.4 DM 永不寫 / Group 預設不寫,P2C 補可選 pipeline)

未來(Phase 2C+):
- ⏳ Group 訊息可選寫 KB(spec §10.4.5)
- ⏳ 機密 group 雙簽邀請 enforcement
- ⏳ DM/Group typing indicator + read receipts
- ⏳ `comm_room_messages.content` 加 Bot mention(`@bot`)— 套 botService(Sprint I)

#### Sprint L — AI 戰情 embed ✅ ship 2026-05-18

對齊 spec §10.5。

- ✅ 走 **iframe 同源 embed**(非 module federation),零後端 migration
- ✅ WarRoom 加第 5 個 tab「📊 BI 戰情」(`BiTab.tsx`):
  - 左欄 design 清單 + 搜尋 + 「只看本案 BU」filter(client-side filter,reuse 既有 `GET /api/dashboard/topics`)
  - 右欄 iframe `/dashboard?design={id}&project_id={pid}&embed=1`
  - 「新分頁打開」link → 跳完整 AI 戰情頁
- ✅ `AiDashboardPage.tsx` 加 `?embed=1` URL param 偵測,**自動隱藏內建左側 sidebar**(避免 iframe 雙層導覽)
- ✅ 機密欄位繼承平台 `confidentialityMiddleware`(spec §10.5.2)— 不另寫 BI scrub
- ✅ Same-origin 不另設 sandbox,沿用 user 既有 cookie auth

未來(Phase 2C+):
- ⏳ Backend `/api/dashboard/topics?bu_id=N` filter(目前 client-side filter)
- ⏳ Dashboard query 真正吃 `project_id` filter(目前 URL 中是 metadata 不影響 query)
- ⏳ 加 CSP header 強化 iframe 安全(spec §10.5.2 提到的選配)
- ⏳ 主管「關注專案」頁的儀表板 tile / widget pin(spec §10.5.2)

#### Sprint M — AI 13 項深化 ✅ ship 2026-05-18

對齊 spec §12.10.4 / PDF §E。3 個明列項目全上(MVP 範圍)。

##### M-11 智慧定價建議(spec #16)

對齊 spec §12.5 Form Surface 2。
- ✅ Backend `services/aiPricingService.suggest(db, { projectId, field, context, user })`
- ✅ Route `POST /api/projects/ai/pricing-suggest`
- ✅ 撈沉澱 KB 內 part_no / specs 相似的歷史案(scrub 過 safe)
- ✅ Gemini Flash JSON 模式回 `{ suggested_value, confidence_percent, reasoning, references[] }`
- ✅ Form tab 每個機密欄位旁 ✨ AI 紫色按鈕 → `AiSuggestionModal.tsx`
- ✅ 走影子表(spec §12.5 — 不直寫,user accept 後標 「AI ✓」)
- ✅ Stub fallback + LLM 失敗 graceful

##### M-12 Cleansheet AI 三廠分析(spec #12)

- ✅ Backend `services/aiCleansheetService.analyze(db, { projectId, factories, target, user })`
- ✅ Route `POST /api/projects/ai/cleansheet-analyze`
- ✅ 規則式 base:總成本排序 + 各項目最低廠 + delta_pct
- ✅ LLM 補語意分析:`{ recommended_factory, summary, analysis_md, advantages, risks }`
- ✅ `CleansheetPanel.tsx` modal — 三廠 cost_breakdown 編輯表 + 分析結果
- ✅ Stub fallback + LLM 失敗 graceful(規則式仍可推薦最便宜廠)

##### M-13 主管日報自動生成(spec #33)

- ✅ Backend `services/dailyReportService.runForUser / runForAll`
- ✅ Route `POST /api/projects/ai/daily-report/run`(自己跑)
- ✅ Route `POST /api/projects/ai/daily-report/run-all`(admin 批次)
- ✅ 找 user 關注 active 專案(PM/sales/member/super_user_join)
- ✅ 對每個專案跑 `statusSummary.getSummary()`
- ✅ 紅燈專案排前 + 底部 AI 重點濃縮(LLM 模式)
- ✅ markdown → HTML 寄 email + 寫 user_notifications(鈴鐺)
- ✅ Dashboard 右上「☀️ 我的日報」琥珀按鈕 → modal 預覽 / 寄出
- ✅ Cron 排程已 register(`startCron / stopCron` in dailyReportService):
  - 由 `projects-platform.startWorkers()` 在 server boot 後自動呼叫
  - env `PROJECTS_DAILY_REPORT_ENABLED='true'` 才啟用(預設關)
  - `PROJECTS_DAILY_REPORT_CRON`(default `'0 9 * * *'` 每天 09:00)
  - `PROJECTS_WEEKLY_REPORT_CRON`(default `'0 9 * * 1'` 週一 09:00)
  - 自動受 `RUN_SCHEDULERS=false` gate(K8s web pod 不掛 cron,只 scheduler pod 掛)

未來(spec §12.10.4 list 中 Phase 2 加深的其他項目)
- ⏳ 跨 channel 懶人包(#22)
- ⏳ 離線 catch-up(#25)
- ⏳ BOM 自動展開(#8)
- ⏳ 結案 AI 摘要強化 map-reduce(#36)
- ⏳ Excel cell binding AI 推薦(#40)
- ⏳ 新人 onboarding 教練(#38)

(spec §12.10.4 列 9 項 Phase 2 加深;Sprint M 先 ship 最具 BU 價值的 3 項,其餘待後續 sprint)

---

## Phase 3(原 spec §19 + PDF §E,8-12 週)

> 來源同 PDF §E slide 24
> ```
> What-if / 贏單預測 / 多級簽核 · ML 預測警示
> ```

### Phase 3 任務切片

#### Sprint N — What-if 模擬器 ✅ ship 2026-05-19

對齊 spec §16.5(預測能力 B 層)+ slide 16。

- ✅ Backend `services/aiWhatIfService.analyze(db, { projectId, baseline, scenario, user })`
- ✅ Route `POST /api/projects/ai/what-if-analyze`
- ✅ **規則式 base** server + client 對稱(scaleCostMul / rawCostMul / fxCostMul / factoryCostMul/LeadMul)
- ✅ Risks 規則(margin < 5% 高危 / margin < 10% 中危 / 交期 +20% 中危 / 數量 +50% 高危 / 原料 +10% 鎖價建議)
- ✅ **LLM 補語意解讀**(optional · Gemini Flash markdown < 250 字)
- ✅ `WhatIfPanel.tsx` 三欄(Baseline / Scenario / Projected)
  - 4 個 slider(數量 / 原料 / 匯率)+ 1 個廠區 dropdown
  - **Client-side 規則式即時算**(改 slider 不卡 LLM)
  - Server side 跟 client 同步邏輯(避免 drift)
- ✅ 整合到 WarRoom Form tab「價格 / 成本」section 旁(紫色「What-if 模擬」按鈕)

對齊 spec slide 16 範例驗:
- "原料漲 5% → 毛利從 16% 降至 11%" ✓
- "匯率 -2% → 毛利從 16% 升至 18%" ✓

未來(Phase 3 後續):
- ⏳ 數量 sensitivity 不用 hardcode 0.15,改成 plugin per-product 配
- ⏳ 廠區 cost 不用 hardcode ±5%,改吃 Cleansheet 已輸入的三廠 cost(若 user 已填)
- ⏳ Sprint O ML 模型上線後,規則式 + ML 混合預測

#### Sprint O — 贏單機率預測(MVP) ✅ ship 2026-05-19

對齊 spec §16.4 + Demo §8.5「Phase 3 ML 預測模型」。

- ✅ `winRatePredictorService.extractFeatures` — 從沉澱 KB + projects 表抽 features
  - 歷史相似案 win/loss/hold ratio(沉澱 KB chunks LIKE)
  - BU 整體 win rate
  - priority_score / 季節 / task 健康度
- ✅ `_ruleBasedPredict` — 加權規則式(歷史 .7 / BU .15 / priority +.05 / blocker -.10 / Q4 -.03)
- ✅ LLM 解讀(optional Gemini Flash markdown)
- ✅ `WinRatePanel.tsx` — 環形 ring + features + factors + reasoning
- ✅ WarRoom header「贏單機率」紫色按鈕

未來(待 ML data 累積):
- ⏳ ML backend(Python sklearn / Vertex AI Custom Predictor)— 框架已備 `PROJECTS_WIN_RATE_BACKEND` env
- ⏳ 訓練資料:結案專案累積到 50+ 後試訓 logistic regression baseline

#### Sprint P — 多級簽核 + reviewer ✅ ship 2026-05-19

- ✅ migration 011:`project_approval_chains` + `project_approval_steps` + `project_approval_triggers`
- ✅ `approvalService.createChain / decide / cancel / listPendingForUser / listForProject`
- ✅ 4 default chainKinds:`high_amount` / `confidential_upgrade` / `lifecycle_close` / `stage_gate`
- ✅ ACL:approver_user_id / approver_role(走 userRoleService.hasRole)/ admin override
- ✅ 通知 in_app_badge(per step approver · 鈴鐺紅點)
- ✅ Approved → 自動 apply target action(`stagesService.advance` / `projectsService.updateLifecycle` / confidential upgrade)
- ✅ `ApprovalsPage.tsx`「📝 待批」+ sidebar 入口
- ✅ WarRoom header「申請結案簽核」琥珀按鈕(ACTIVE 才顯)
- ⏳ trigger 條件自動偵測(目前手動觸發 / 未來偵測 amount >= 100k 自動建 chain)

#### Sprint Q — ML 預測警示 widget C ✅ ship 2026-05-19

對齊儀表板 spec §16.4「C · ML 預測模型」格(原 stub「○ Phase 3 待評估」)。

- ✅ Backend `winRatePredictor.predictBatch(db, { projectIds?, limit })` — 跳過 LLM 純規則式
- ✅ Route `POST /api/projects/ai/win-rate-batch`
- ✅ Dashboard 新 `WidgetC` 元件:
  - 「跑批次預測」按鈕(on-demand)
  - 兩欄分組:🚨 高風險(WIN < 40%)/ ⭐ 高機率(WIN ≥ 70%)
  - 每筆顯 project_code + customer + win% + top_factor
  - 點 → 直接跳該 project WarRoom
- ✅ AI 預測警示 3 卡片改為 Phase A/B/C 全綠 ✓
- ⏳ Scheduled batch(每天 09:00 預跑 + cache)— Phase 3+ 補 cron

---

## Phase 4(原 spec §19 + PDF §E,持續)

> 來源同 PDF §E slide 24
> ```
> TRAINING / IT plugin · 客戶報價系統 API 對接 ·
> 長料件預警(試產轉量產)· 三廠成本對比 AI 解讀
> ```

### Phase 4 任務切片

#### Sprint R — TRAINING plugin

- 教育訓練專案 type
- 整合 Cortex 既有教育訓練平台(`/training/*`)
- 結案專案的 lesson 自動產出(可選功能)

#### Sprint S — IT plugin

- IT 維護專案 type
- 支援 ticket-like 流程(對應 Cortex `/feedback` 工單)

#### Sprint T — 客戶報價系統 API 對接

- Phase 1-3 純人工傳 Excel,Phase 4 雙向 API
- spec §E: ❌ 不做 Email gateway / 客戶 portal / 電子簽
- 等客戶報價系統提供 API

#### Sprint U — AI #10 長料件預警

- 試產轉量產(MP)階段才需要
- 移到此 phase 是因為 Phase 1 報價階段不需要(對齊 spec §12 v3 移除)

#### Sprint V — AI #14 三廠成本對比 AI 解讀

- 廠區是客戶指定(非 AI 推薦),Phase 1 不需 AI 解讀
- 移到此 phase:等客戶開放廠區選擇權時再上

---

## Phase 完成依賴關係

```
Phase 1 (✅ ship)
  └─ Phase 1 Production Polish (12d)
      └─ Phase 2
          ├─ Sprint H super_user (1w)
          ├─ Sprint I Bot 整合 (1w)
          ├─ Sprint J 結案 fork production (1.5w) ← Phase 3 ML 訓練資料來源
          ├─ Sprint K 域內通訊 (1w)
          ├─ Sprint L AI 戰情 embed (0.5w)
          └─ Sprint M AI 13 項深化 (2w)
              └─ Phase 3
                  ├─ Sprint N What-if (2w)
                  ├─ Sprint O ML 模型 (3-4w) ← 依賴 Sprint J sediment KB
                  ├─ Sprint P 多級簽核 (2w)
                  └─ Sprint Q ML 警示 (1-2w) ← 依賴 Sprint O
                      └─ Phase 4
                          ├─ Sprint R TRAINING plugin
                          ├─ Sprint S IT plugin
                          ├─ Sprint T 客戶 API (依客戶提供)
                          ├─ Sprint U 長料件預警 (MP 階段)
                          └─ Sprint V 三廠對比 AI (客戶開放後)
```

---

## Phase 2 / 3 / 4(後續)

> 上面已展開完整 roadmap,以下保留作 reference。

依 spec §19 Phase 規劃 + PDF §E。
