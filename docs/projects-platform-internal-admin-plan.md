# Cortex 通用專案管理平台 — Internal Admin 規劃

> 對應規格書:[projects-platform-spec.md](./projects-platform-spec.md) v0.4
> 解耦設計:[projects-platform-decoupling-architecture.md](./projects-platform-decoupling-architecture.md)
> 實作 Roadmap:[projects-platform-implementation-roadmap.md](./projects-platform-implementation-roadmap.md)
> 日期:2026-05-04
>
> **核心原則**:
> 1. **Sidebar Menu 可見性逐步開放**(Phase 0 admin only → GA 對所有有 project role 的人)
> 2. **平台專屬設定有自己的 Admin 頁**(不擠進 Cortex 主 admin 介面)
> 3. **未來那些 admin 功能讓 BU 主管 / workflow editor 等自己進去管**(分權)

---

## A. Sidebar Menu 可見性演進

### A.1 可見性矩陣

| Phase | User Role | 看得到 Sidebar Menu | 進去看到的 |
|---|---|:-:|---|
| **Phase 0**(現在,scaffold)| 所有 user | ❌ 隱藏 | — |
| **Phase 0**(現在,scaffold)| Cortex `admin` | ✅ 顯示 | 只有 `/projects/_health` + Admin scaffold 頁(空) |
| **Phase 1 開發中**(W1-7)| 所有 user | ❌ 隱藏 | — |
| **Phase 1 開發中**| Cortex `admin` | ✅ 顯示 | 逐步出現 Internal Admin 頁(各 sprint 完成一塊) |
| **Phase 1 Pilot**(W9-12)| Pilot user 名單 | ✅ 顯示 | 完整功能 |
| **Phase 1 Pilot**| 非 Pilot user | ❌ 隱藏 | — |
| **Phase 1 Pilot**| Cortex `admin` | ✅ 顯示 | Admin + User 雙模式 |
| **Phase 1 GA**(W13+)| 有任一 `project.*` role 的 user | ✅ 顯示 | 對應 role 的功能 |
| **Phase 1 GA**| 完全沒 project role 的 user | ❌ 隱藏 | (例:不參與報價的工程師預設看不到)|
| **Phase 1 GA**| 被邀進任一 project member 的 user | ✅ 顯示 | 看得到他被邀的專案 |

### A.2 為什麼這樣設計

| 階段 | 理由 |
|---|---|
| Phase 0-1 admin only | 避免一般 user 誤入未完成功能;Cortex 系統穩定第一 |
| Phase 1 Pilot 限名單 | 1-2 個真實 RFQ 案 + 陪跑 PM,其他人不打擾 |
| Phase 1 GA 開放 | role-based;沒 role 不會誤入 |

### A.3 技術實作

#### A.3.1 後端 API 提供 sidebar 可見性 flag

```
GET /api/users/me/sidebar-permissions

Response:
{
  "can_see_projects_platform": true | false,
  "projects_platform_mode": "admin" | "user" | "pilot" | "hidden",
  "available_features": ["dashboard", "projects", "wizard", "internal_admin", ...]
}
```

判定邏輯(在 `projects-platform/middleware/sidebarPermissionMiddleware.js`):

```javascript
function determineVisibility(user) {
  // Phase 0/1 開發中
  if (!process.env.PROJECTS_PLATFORM_GA_MODE) {
    if (user.is_admin) return { can_see: true, mode: 'admin' };
    if (process.env.PILOT_USERS?.split(',').includes(user.id)) {
      return { can_see: true, mode: 'pilot' };
    }
    return { can_see: false, mode: 'hidden' };
  }

  // Phase 1 GA
  if (user.is_admin) return { can_see: true, mode: 'admin' };
  if (hasAnyProjectRole(user)) return { can_see: true, mode: 'user' };
  if (isMemberOfAnyProject(user)) return { can_see: true, mode: 'user' };
  return { can_see: false, mode: 'hidden' };
}
```

#### A.3.2 前端 Sidebar 動態顯示

```typescript
// client/src/components/Sidebar.tsx
const { canSeeProjectsPlatform, projectsPlatformMode } = useUserSidebarPermissions();

return (
  <Sidebar>
    {/* ... existing menu items ... */}
    {canSeeProjectsPlatform && (
      <SidebarItem icon="📁" label="專案管理" to="/projects">
        {projectsPlatformMode === 'admin' && (
          <SidebarSubItem to="/projects/internal-admin">⚙ 平台設定</SidebarSubItem>
        )}
      </SidebarItem>
    )}
  </Sidebar>
);
```

#### A.3.3 後端 ACL middleware

所有 `/api/projects/*` 路由都過 `sidebarPermissionMiddleware`:

```javascript
// 在 routes 入口加
router.use(requireSidebarVisible);

// 內部 admin 路由再加一層
router.use('/internal-admin', requireAdminMode);
```

### A.4 控制變數(env)

```bash
# Phase 控制
PROJECTS_PLATFORM_GA_MODE=false       # 預設 false(開發中)
                                       # 設 true 開放 role-based

# Pilot 名單(逗號分隔 user_id)
PILOT_USERS=42,55,67                   # Pilot 期間額外允許看到的 user

# Feature flag(沿用)
ENABLE_PROJECTS_PLATFORM=true          # module 是否啟用
```

→ Phase 1 GA 時 env 改成 `PROJECTS_PLATFORM_GA_MODE=true` 一鍵切換。

---

## B. Internal Admin 頁面清單(10 個子頁)

> 平台專屬設定都在 `/projects/internal-admin/*` 下,**不擠進 Cortex 主 admin 介面**。
>
> 每個子頁對應 spec 的某個設定需求,逐步在 Sprint 1-12 實作。

### B.1 設定總覽頁

`/projects/internal-admin`

```
┌─ 平台設定總覽 ──────────────────────────────────┐
│                                                  │
│  ⚙ 系統設定                                      │
│  ┌─────────────────────────────────────────┐    │
│  │ ▸ Project Types 管理                     │    │
│  │ ▸ Workflow Templates(SYSTEM)            │    │
│  │ ▸ Confidential Field Policies            │    │
│  │ ▸ Notification Rules(SYSTEM)            │    │
│  │ ▸ Data Connections(ERP / SFC / BI)      │    │
│  │ ▸ Data Source Definitions(SQL 庫)       │    │
│  │ ▸ KB Routes(per project_type)           │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  👥 身份 / 組織                                   │
│  ┌─────────────────────────────────────────┐    │
│  │ ▸ Role 授予 / 撤銷                       │    │
│  │ ▸ 組織層級(BG / BU / sub-BU)             │    │
│  │ ▸ User 隸屬                              │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  📊 系統健康                                      │
│  ┌─────────────────────────────────────────┐    │
│  │ ▸ Module Status(Feature flag / Workers) │    │
│  │ ▸ LLM 用量(per-project / per-day)        │    │
│  │ ▸ Audit Log Browser                      │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
└──────────────────────────────────────────────────┘
```

### B.2 各子頁詳細

#### B.2.1 Project Types 管理

**Path**:`/projects/internal-admin/project-types`
**Role**:Cortex `admin` only
**Sprint**:Sprint 1(配 schema)

```
┌─ Project Types 管理 ──────────────────────────────────┐
│                                                       │
│  type_code  名稱        Enabled  預設 Workflow         │
│  ─────────  ─────────  ───────  ────────────────       │
│  QUOTE      業務報價    ✅       QUOTE_STANDARD        │
│  GENERAL    一般專案    ✅       GENERAL_BASIC         │
│  IT         IT 任務     ❌       (Phase 3)             │
│  TRAINING   教育訓練    ❌       (Phase 4)             │
│                                                       │
│  ─── 編輯 ───                                          │
│  ⚠ 注意:type_code 必須對應 server plugin code         │
│      新 type 需 RD release(非 admin 介面新增)        │
│                                                       │
│  Default Workflow:  [QUOTE_STANDARD ▾]                │
│  Default 機密分類:  [CONFIDENTIAL ▾]                  │
│  Icon:              [📋]                              │
│  Sort Order:        [1]                                │
│  Enabled:           [✓]                                │
│                                                       │
│  [儲存]                                                │
└───────────────────────────────────────────────────────┘
```

對應 spec §3.2

#### B.2.2 Workflow Templates 管理

**Path**:`/projects/internal-admin/workflow-templates`
**Role**:`workflow.admin`(SYSTEM)/ `workflow.bu_editor`(BU)/ user 個人(USER)
**Sprint**:Sprint 6-7

- 列表頁:依 scope 分組顯示(SYSTEM / BU / USER)
- 編輯頁:Stage 拖拉重排 / 改 SLA / 設 on_enter hook
- Phase 2 加 Excel Import/Export

對應 spec §5

#### B.2.3 Confidential Field Policies 管理

**Path**:`/projects/internal-admin/confidential-policies`
**Role**:`confidential.policy_editor`(admin + 法務 / 財務)
**Sprint**:Sprint 3(配機密欄位機制)

- 每 project_type 一張表
- 每 field 設 displayStrategy(TIER / ALIAS / MASK / RANGE)
- Tier 邊界編輯(50K / 200K / 1M / 5M / 20M)
- Alias 對應表(customer_aliases 客戶代號)

對應 spec §4.2

#### B.2.4 Notification Rules 管理

**Path**:`/projects/internal-admin/notification-rules`
**Role**:`notification.editor`
**Sprint**:Sprint 7

- SYSTEM scope rules 列表 + CRUD
- Escalation chains 編輯(steps + recipients + channels)
- Trigger event 對照表(`TASK_OVERDUE` / `BLOCKER_NEW` / 等)

對應 spec §14.9

#### B.2.5 Data Connections 管理

**Path**:`/projects/internal-admin/data-connections`
**Role**:`data.connection_manager`
**Sprint**:Sprint 5

- 列表:ERP-CN / ERP-VN / SFC / BI / MCP / API
- 編輯:endpoint / read-only role / pool max / 健康檢查
- 健康狀態 dashboard

對應 spec §15.5

#### B.2.6 Data Source Definitions 管理

**Path**:`/projects/internal-admin/data-sources`
**Role**:`data.connection_manager`
**Sprint**:Sprint 5

- custom_sql / custom_plsql / api / mcp 各類 source
- 版本鏈
- 「執行測試」按鈕(走 dummy 參數驗證)
- 視覺化 Field Mapping UI(連到 form template)

對應 spec §15.7

#### B.2.7 KB Routes 管理

**Path**:`/projects/internal-admin/kb-routes`
**Role**:Cortex `admin`
**Sprint**:Sprint 4(配 KB sediment)

- per project_type 的 KB 寫入路由
- internal KB / public KB 對應
- trigger event(STAGE_DONE / PROJECT_CLOSED)

對應 spec §3.6

#### B.2.8 Role 授予 / 撤銷

**Path**:`/projects/internal-admin/roles`
**Role**:Cortex `admin`
**Sprint**:Sprint 11

- 13 個身份的授予介面
- scope 控制(SYSTEM / BU 列表選擇 / USER 個人)
- 任期管理(super_user 可選 expires_at)
- Audit log

對應 spec §17

#### B.2.9 組織層級維護

**Path**:`/projects/internal-admin/org-units`
**Role**:Cortex `admin`
**Sprint**:Sprint 11

- BG / BU / sub-BU 樹狀編輯
- User 隸屬批次匯入(CSV)
- 兼任處理(`user_organization_memberships` 多筆)

對應 spec §17.5

#### B.2.10 系統健康監控

**Path**:`/projects/internal-admin/system-health`
**Role**:Cortex `admin`
**Sprint**:Sprint 12

- Feature flag 狀態(ENABLE_PROJECTS_PLATFORM / ENABLE_PROJECTS_WORKERS)
- Workers 跑狀態(last run / failure rate)
- LLM 用量 dashboard(per-project / per-day / per-feature)
- LLM Queue stats(available_tokens / burst_capacity)
- Audit log browser(`project_audit_log`)
- DB partition 容量(per kb_id partition size)

對應 spec §10.7.3 監控

### B.3 Admin 子頁實作 Sprint 對應表

| Sprint | 對應 Admin 子頁 |
|---|---|
| Sprint 1 | B.2.1 Project Types(scaffold)|
| Sprint 3 | B.2.3 Confidential Policies |
| Sprint 4 | B.2.7 KB Routes |
| Sprint 5 | B.2.5 Connections + B.2.6 Data Sources |
| Sprint 6-7 | B.2.2 Workflow Templates |
| Sprint 7 | B.2.4 Notification Rules |
| Sprint 11 | B.2.8 Roles + B.2.9 Org Units |
| Sprint 12 | B.2.10 System Health |

每個 sprint 結束時,對應的 Admin 子頁也 ship,讓 Cortex admin 立刻能設定。

---

## C. Schema / 程式碼影響

### C.1 不需要新表

所有 Admin 子頁設定的資料**都在 spec 既有 schema**(spec §3 / §5 / §15 / §17 等),不需要為 Admin UI 另建表。

### C.2 新增的程式碼

```
server/projects-platform/
├── routes/
│   ├── adminProjectTypes.js         B.2.1
│   ├── adminWorkflowTemplates.js    B.2.2
│   ├── adminConfidentialPolicies.js B.2.3
│   ├── adminNotificationRules.js    B.2.4
│   ├── adminConnections.js          B.2.5
│   ├── adminDataSources.js          B.2.6
│   ├── adminKbRoutes.js             B.2.7
│   ├── adminRoles.js                B.2.8
│   ├── adminOrgUnits.js             B.2.9
│   └── adminSystemHealth.js         B.2.10
├── middleware/
│   ├── sidebarPermissionMiddleware.js   A.3.1
│   └── requireAdminMode.js              A.3.3
└── services/
    └── adminService.js               統一 audit log / 權限驗證
```

```
client/src/projects-platform/
├── pages/
│   └── InternalAdmin/
│       ├── index.tsx                  總覽
│       ├── ProjectTypes/
│       ├── WorkflowTemplates/
│       ├── ConfidentialPolicies/
│       ├── NotificationRules/
│       ├── Connections/
│       ├── DataSources/
│       ├── KbRoutes/
│       ├── Roles/
│       ├── OrgUnits/
│       └── SystemHealth/
└── hooks/
    └── useSidebarPermissions.ts
```

### C.3 與 Cortex 主 admin 的關係

| Cortex 主 admin(/admin) | Projects-platform Internal Admin(/projects/internal-admin) |
|---|---|
| User / Role 全公司管理 | Projects-platform 特有的 role 授予(在這管才合理) |
| KB 市集(全公司) | KB Routes(per project_type) |
| 技能 / MCP / API 連接器(全公司) | Data Connections(專案平台專用) |
| 系統設定 / 監控 | Projects-platform Module Health |

**邊界**:
- **Cortex 主 admin** 管「跨模組共用的東西」(user / role / KB / 技能)
- **Projects-platform Internal Admin** 管「專案平台專用的東西」(workflow template / confidential policy / project_types)

→ 不重複,各管各的。

---

## D. UX 提案(Internal Admin 入口設計)

### D.1 Sidebar 結構(Phase 1 GA 時)

```
Cortex Sidebar:
  💬 對話
  🛠 技能
  📚 知識庫
  📊 AI 戰情
  🎓 教育訓練
  ❓ 問題反饋
  ─────────────
  📁 專案管理 ★(對有 project role 的人顯示)
     ├─ 跨案儀表板         ← 預設進這
     ├─ 我的專案
     ├─ 我的任務
     ├─ 開案 Wizard
     └─ ⚙ 平台設定 ←★(只有 admin 看到)
            ├─ Project Types
            ├─ Workflow Templates
            ├─ Confidential Policies
            ├─ Notification Rules
            ├─ Data Connections
            ├─ Data Sources
            ├─ KB Routes
            ├─ Roles 授予
            ├─ 組織層級
            └─ 系統健康
  ─────────────
  ⚙ 設定(Cortex 主)
  🛟 說明
```

### D.2 Phase 0(現在)只給 admin 看的形式

```
Cortex Sidebar:
  💬 對話
  ...
  ─────────────
  (一般 user 完全看不到 "專案管理" menu)
  ─────────────
  ⚙ 設定
  🛟 說明


Cortex Sidebar(admin only):
  💬 對話
  ...
  ─────────────
  📁 專案管理(beta - admin only)★ ← 灰色或加 badge
     └─ ⚙ 平台設定(scaffold)
  ─────────────
  ⚙ 設定
  🛟 說明
```

### D.3 Admin 進去看到的 Internal Admin 頁(Phase 0 scaffold)

```
┌─ 專案管理平台設定 ────────────────────────────────────┐
│  ⚠ 這是 beta 版,目前 scaffold 階段;功能逐步開發中    │
│                                                       │
│  ─── 系統健康(已可用)─────────────────────────────  │
│  Feature flag:        ENABLE_PROJECTS_PLATFORM = true │
│  Module version:      v0.4-scaffold                   │
│  Workers:             啟用 0 / 預計 3                 │
│  LLM Queue:           available 20 / 20               │
│  Plugins registered:  QUOTE / GENERAL                 │
│                                                       │
│  ─── 子頁(逐步啟用)─────────────────────────────  │
│  ⏳ Project Types(Sprint 1 啟用)                     │
│  ⏳ Workflow Templates(Sprint 6 啟用)                │
│  ⏳ Confidential Policies(Sprint 3 啟用)             │
│  ⏳ Notification Rules(Sprint 7 啟用)                │
│  ⏳ Data Connections(Sprint 5 啟用)                  │
│  ⏳ Data Sources(Sprint 5 啟用)                      │
│  ⏳ KB Routes(Sprint 4 啟用)                         │
│  ⏳ Roles 授予(Sprint 11 啟用)                       │
│  ⏳ 組織層級(Sprint 11 啟用)                          │
└───────────────────────────────────────────────────────┘
```

→ Admin 一進來就看到「目前進度」,各 sprint 完成後對應子頁亮起來。

---

## E. 對 Phase 0 Scaffold 的補強(本週可加)

### E.1 立即可做(無風險)

```
server/projects-platform/
├── routes/
│   └── internalAdmin.js              ★ 新增,只 mount /internal-admin/_health + 總覽
├── middleware/
│   └── sidebarPermissionMiddleware.js ★ 新增
```

```
client/src/  (如果 user 同意動 client)
├── hooks/
│   └── useProjectsPlatformVisibility.ts  ★ 新增
└── components/
    └── Sidebar.tsx                       ★ 加 條件式顯示
```

### E.2 Phase 0 Scaffold 補強後的可見狀態

```
Cortex admin 登入:
  Sidebar 出現 "📁 專案管理(beta)" menu
  → 點進去看到 "⚙ 平台設定" 子項
  → 進入 Internal Admin Overview 頁
  → 顯示 Module Health + 子頁 stub(灰色 disabled)

一般 user 登入:
  Sidebar 完全看不到 "專案管理"
  即使打 URL `/projects/*` 也會 403
```

### E.3 不需要動的東西

- 既有 Cortex sidebar logic(只是加條件分支,不改既有 item)
- 既有 admin 介面(完全不動)
- 既有 user role 系統(沿用)

---

## F. 風險 + 緩解

| 風險 | 緩解 |
|---|---|
| Sidebar 條件式顯示 bug 導致一般 user 看到 | 後端 API 也擋(403),前端只是 visibility hint |
| Phase 1 GA 時忘記切 env | runbook 加 GA 切換 checklist;升版 PR 包含 env 更新 |
| Pilot user 名單忘記更新 | 改成 DB-driven(table `pilot_users` admin 介面維護),不依賴 env |
| Internal Admin 跟 Cortex 主 admin 邊界不清 | 文件 §C.3 邊界表;UI 加 cross-link 提示 |
| Admin 子頁實作落後 sprint | scaffold 出空頁 + "Phase X 啟用" 訊息;不阻塞主開發 |

---

## G. 對 Implementation Roadmap 的補充

[implementation-roadmap.md](./projects-platform-implementation-roadmap.md) 各 sprint 都要加一行 Internal Admin 子頁:

| Sprint | 加 Internal Admin 子頁 |
|---|---|
| Sprint 0(完成) | 補:Sidebar 條件式顯示 + Internal Admin Overview scaffold + System Health |
| Sprint 1 | + Project Types Admin |
| Sprint 3 | + Confidential Policies Admin |
| Sprint 4 | + KB Routes Admin |
| Sprint 5 | + Connections + Data Sources Admin |
| Sprint 6-7 | + Workflow Templates Admin |
| Sprint 7 | + Notification Rules Admin |
| Sprint 11 | + Roles + Org Units Admin |
| Sprint 12 | + System Health(完整版)|

### G.1 Sprint 0 補強(本週可做)

> 不阻塞主開發,但對齊「先給 admin 看到 menu」目標。

```
☐ server: routes/internalAdmin.js(總覽頁 + Module Health API)
☐ server: middleware/sidebarPermissionMiddleware.js
☐ server: routes/users.js 加 sidebar-permissions endpoint
☐ client: useProjectsPlatformVisibility hook
☐ client: Sidebar 條件式顯示 menu
☐ client: InternalAdmin Overview 頁(讀 Module Health API)
☐ client: 子頁 stub 列表(灰色 + "Sprint X 啟用" 提示)
☐ env: PROJECTS_PLATFORM_GA_MODE=false 預設
☐ env: PILOT_USERS=(空)預設
```

預估工時:**2-3 人天**(client 1-2 天 + server 1 天)

---

## H. 結論

```
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ✅ Phase 0(現在)— Sidebar 只給 Cortex admin 看到           ║
║                                                               ║
║   ✅ Phase 1 開發中 — admin 仍只看 menu;子頁逐步上線           ║
║                                                               ║
║   ✅ Phase 1 Pilot — Pilot 名單 + admin 看 menu                ║
║                                                               ║
║   ✅ Phase 1 GA — 開放給所有 project.* role 持有者              ║
║                                                               ║
║   ─── Internal Admin 設計原則 ───                              ║
║   ▸ 平台專屬設定有自己的 Admin(不擠進 Cortex 主 admin)        ║
║   ▸ 10 個子頁分散在 12 個 sprint 實作                          ║
║   ▸ 不需新 schema,設定資料用 spec 既有表                       ║
║   ▸ 跟 Cortex 主 admin 邊界清楚:平台特有 vs 全公司共用         ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

— 本文件結束 —
