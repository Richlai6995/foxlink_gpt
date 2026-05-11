# projects-platform — Cortex 通用專案管理平台 module

> v0.4 / Phase 1 scaffolding
> 對應 spec:[../../docs/projects-platform-spec.md](../../docs/projects-platform-spec.md)
> 解耦設計:[../../docs/projects-platform-decoupling-architecture.md](../../docs/projects-platform-decoupling-architecture.md)

## 5 條硬規則(本 module 開發必檢查)

1. **不直接 ALTER Cortex 既有 schema**(除 `ticket_messages` 加 column,migrations/001_init.js 統一管理)
2. **不直接動 Cortex 既有 route handler 程式碼**(只在自己 namespace 內動)
3. **共用 service 只 import 不修改**(geminiClient / kbRetrieval / smtp / webexBot / schedule)
4. **新平台 exception 不冒泡出 namespace 邊界**(每個 route handler / worker 都包 try/catch)
5. **共用資源(LLM token / DB pool / Redis)走 rate limiter**(`services/llmQueue.js`)

## 目錄結構

```
projects-platform/
├─ index.js                  入口 + feature flag 檢查 + error boundary
├─ routes/                   /api/projects/* 各 endpoint
├─ services/                 通用層 service(workflowEngine, formEngine, taskEngine, ...)
├─ middleware/               middleware(confidentialityMiddleware, projectAclMiddleware, ...)
├─ plugins/                  各 project_type plugin
│   ├─ quote/               QUOTE plugin(業務報價)
│   ├─ general/             GENERAL plugin
│   └─ registry.js          plugin 註冊表
├─ workers/                  background workers(statusSummary, slaWatcher, kbArchive, ...)
├─ ai/                       AI 加速 10 項(rfqParser, statusSummary, taskBreakdown, ...)
└─ migrations/               schema migrations(idempotent,呼叫進 runMigrations)
```

## Feature Flag

```bash
ENABLE_PROJECTS_PLATFORM=true   # 啟用 module(mount routes + start workers + run migrations)
ENABLE_PROJECTS_PLATFORM=false  # 完全停用(Rollback 模式)
ENABLE_PROJECTS_WORKERS=false   # 單獨關 workers(routes 仍 enable,debug 用)
```

## Logging

```javascript
// 所有 log 加 prefix
console.log('[projects-platform] something');
console.error('[projects-platform] error:', e);

// Worker 加細分
console.log('[projects-platform/worker/status-summary] running');
console.log('[projects-platform/plugin/quote] form template loaded');
```

## Mount Point(URL namespace)

所有 endpoint 都在 `/api/projects/*` 下,絕對不衝突 Cortex 既有 URL。

```
GET    /api/projects                       列表
POST   /api/projects                       建立(或走 /wizard)
GET    /api/projects/:id                   詳細
PATCH  /api/projects/:id                   更新
POST   /api/projects/:id/close             結案

POST   /api/projects/wizard/start          開案 Wizard Step 1
POST   /api/projects/wizard/:id/step/:n    Wizard 各步驟
POST   /api/projects/wizard/:id/finalize   啟動專案

GET    /api/projects/:id/channels          channel 列表
POST   /api/projects/:id/channels          建 channel

GET    /api/projects/:id/tasks             任務列表
POST   /api/projects/:id/tasks             建任務
PATCH  /api/projects/:id/tasks/:tid        改任務 / 完成

GET    /api/projects/:id/forms/:formId     form
PATCH  /api/projects/:id/forms/:formId     更新欄位

GET    /api/projects/dashboard             跨案儀表板
GET    /api/projects/:id/summary           AI 狀態 SUMMARY(快取)
```

## Migrations

放在 `migrations/` 下,由 `index.js` 在 `boot()` 時呼叫(idempotent)。

## 開發前必做(對應解耦設計 §H)

- [x] 建立 server/projects-platform/ directory + namespace 規範
- [x] 寫 Feature flag 邏輯(ENABLE_PROJECTS_PLATFORM)
- [x] 寫 try/catch 包裝 middleware(error boundary)
- [x] 寫 LLM rate limiter(llmQueue)
- [x] Migration scaffold + 整合進 runMigrations(idempotent)
- [ ] 既有 Cortex 主流程回歸測試 pass(開工後驗證)
