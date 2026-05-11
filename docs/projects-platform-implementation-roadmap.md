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

## Phase 1 開發切片(~6 週 / 12 sprints)

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

### Sprint 2 — Multi-Channel 戰情會議室(W1 後半 ~ W2 前半)

**目標**:Slack-like 多 channel + 訊息流

**任務**:
- migration 005:確認 ticket_messages 加的欄位都 ready
- `routes/channels.js`:CRUD channel + invite/remove participants
- `services/channelService.js`:7 default channels 自動建立邏輯
- WebSocket 整合(沿用既有 ticket_messages WebSocket)
- 訊息色語言邏輯(NORMAL / PROGRESS / BLOCKER / DECISION / AI_INSIGHT)
- Pin / 已讀回執 機制
- DM 1:1 私聊(channel_type = 'dm')
- 訊息刪除(標準 + emergency purge)
- super_user self-join 機制(走既有 `project_super_users` 表)

**Deliverable**:7 channels 可運作 + DM + 訊息色語言 + Pin

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
