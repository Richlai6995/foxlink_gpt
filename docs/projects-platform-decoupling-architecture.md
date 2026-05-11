# Cortex 通用專案管理平台 — 解耦架構設計

> 對應規格書:[projects-platform-spec.md](./projects-platform-spec.md) v0.4
> 日期:2026-05-04
> 目的:**保護既有 Cortex 不被影響,同時充分共用 Cortex 既有基礎建設**
>
> 核心問題:Cortex 已運行於 production(LLM 對話 + KB + 教育訓練 + 技能 + ERP / MCP / Webex Bot 等),新增專案平台會增加 ~4000+ 行 spec、預估 ~15K LoC 程式碼。如何在不影響既有上線狀況下開發 + 部署?

---

## TL;DR

| 解耦層級 | 策略 | 風險程度 |
|---|---|---|
| **Code** | 獨立 `server/projects-platform/` namespace + `/api/projects/*` mount point | 🟢 低 |
| **Schema** | 全新表 `project_*` / `qp_*` 前綴;**僅 1 張既有表加 column**(`ticket_messages`)| 🟡 中(但 ALTER 滾動安全) |
| **Deploy** | 同 Cortex Pod 同 process;**Feature flag** `ENABLE_PROJECTS_PLATFORM` 一鍵 enable/disable | 🟢 低 |
| **Runtime 隔離** | Middleware 嚴格 try/catch;新平台 exception 不冒泡;獨立 worker process | 🟢 低 |
| **監控** | Log prefix `[PROJECTS]` + 獨立 Loki dashboard | 🟢 低 |

→ **5 個層面同時做**,且都是「軟隔離」(同 process)而非「硬隔離」(microservice),保留充分共用 Cortex 既有基礎建設的好處。

→ Phase 4 可選評估是否要拆 microservice(目前不需要)。

---

## A. Code 層級解耦

### A.1 Directory 結構(獨立 namespace)

```
server/
  ├─ routes/                      # Cortex 既有 routes(不動)
  │   ├─ auth.js
  │   ├─ chat.js
  │   ├─ kb.js
  │   ├─ feedback.js
  │   ├─ training.js
  │   └─ ...
  │
  ├─ services/                    # Cortex 既有 services(只 import,不改)
  │   ├─ gemini.js
  │   ├─ geminiClient.js
  │   ├─ kbRetrieval.js
  │   ├─ kbEmbedding.js
  │   ├─ webexBot.js
  │   ├─ smtp.js
  │   └─ ...
  │
  ├─ projects-platform/ ★ 全新獨立 module
  │   ├─ index.js                # 入口 + feature flag 檢查
  │   ├─ routes/
  │   │   ├─ projects.js         # /api/projects/*
  │   │   ├─ channels.js         # /api/projects/:id/channels
  │   │   ├─ tasks.js            # /api/projects/:id/tasks
  │   │   ├─ forms.js
  │   │   ├─ dashboard.js
  │   │   └─ wizard.js           # 開案 Wizard
  │   ├─ services/
  │   │   ├─ workflowEngine.js
  │   │   ├─ stageGate.js
  │   │   ├─ formEngine.js
  │   │   ├─ taskEngine.js
  │   │   └─ inboundResolver.js  # ERP / SQL 拉值
  │   ├─ middleware/
  │   │   ├─ confidentialityMiddleware.js
  │   │   ├─ projectAclMiddleware.js
  │   │   └─ pluginResolver.js
  │   ├─ plugins/
  │   │   ├─ quote/               # QUOTE plugin
  │   │   │   ├─ index.js
  │   │   │   ├─ schema.json
  │   │   │   ├─ scrub.js
  │   │   │   ├─ formTemplate.js
  │   │   │   └─ stageHooks.js
  │   │   ├─ general/
  │   │   └─ registry.js
  │   ├─ workers/                # Background workers
  │   │   ├─ statusSummaryWorker.js   # Status SUMMARY 每天 09:00
  │   │   ├─ slaWatcherWorker.js      # SLA 接近預警
  │   │   ├─ kbArchiveWorker.js       # 結案 archive pipeline
  │   │   └─ erpSnapshotWorker.js
  │   ├─ ai/                     # AI 加速 10 項
  │   │   ├─ rfqParser.js        # #1 RFQ 解析
  │   │   ├─ similarProjects.js  # #2 #37 歷史相似案
  │   │   ├─ qaDrafter.js        # #5 Q&A 草稿
  │   │   ├─ statusSummary.js    # #21 ⭐ Status SUMMARY
  │   │   ├─ decisionRecorder.js # #23 決策紀錄
  │   │   ├─ messageRanker.js    # #24 訊息排序
  │   │   ├─ proactiveBot.js     # #26 主動提醒
  │   │   ├─ taskBreakdown.js    # #29 任務拆解
  │   │   └─ scheduleSanity.js   # #32 交期合理性
  │   └─ migrations/              # Schema migration(only this module's tables)
  │       └─ 001_init.js
  │
  ├─ shared/                     # 共用 utility(雙方都用)
  └─ index.js                    # Express app
```

### A.2 Mount Point(URL namespace 隔離)

```javascript
// server/index.js
const app = express();

// Cortex 既有 routes(完全不動)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/kb', require('./routes/kb'));
app.use('/api/feedback', require('./routes/feedback'));
// ... 其他既有

// ★ 新平台:Feature flag controlled
if (process.env.ENABLE_PROJECTS_PLATFORM === 'true') {
  const projectsPlatform = require('./projects-platform');
  app.use('/api/projects', projectsPlatform.routes);
  projectsPlatform.startWorkers();  // 啟動 background workers
  console.log('[projects-platform] Module enabled');
} else {
  console.log('[projects-platform] Module disabled (ENABLE_PROJECTS_PLATFORM != true)');
}
```

**好處**:
- 一個環境變數一鍵 enable/disable
- 新平台 routes 全部在 `/api/projects/*`,**永遠不衝突 Cortex 既有 URL**
- 既有 Cortex 完全不知道新平台存在(import 路徑都不相見)

### A.3 共用層 vs 專屬層(清楚分界)

#### A.3.1 共用(只 import,不修改)

| Cortex 既有 service | 新平台用法 |
|---|---|
| `services/geminiClient.js` | AI 加速 10 項全部走這個 LLM client |
| `services/kbRetrieval.js` | KB RAG 召回 |
| `services/kbEmbedding.js` | 寫入 Live KB / 沉澱 KB 都走 |
| `services/webexBot.js` | 通知推送 |
| `services/smtp.js` | Email 通知 |
| `services/schedule.js` | Status SUMMARY 排程、KB Archive 排程 |
| `services/mcpClient.js` | MCP server 整合 |
| `services/erpProcedures.js` | ERP procedure 調用 |
| `database-oracle.js` | DB pool / runMigrations 框架 |

**規則**:新平台**永遠只 import,不修改既有 service**。如果發現要改,先評估是否能透過 wrapper / decorator 解決;非改不可才動,且必須讓既有 user 完全無感(向後相容 + audit)。

#### A.3.2 專屬(新平台 own)

| 新平台 service | 用途 |
|---|---|
| `projects-platform/middleware/confidentialityMiddleware.js` | 機密欄位處理(集中) |
| `projects-platform/services/workflowEngine.js` | Stage 推進 + Stage Gate |
| `projects-platform/services/formEngine.js` | Form 引擎 + 版本鏈 |
| `projects-platform/services/taskEngine.js` | 任務 + Dependency 計算 |
| `projects-platform/services/inboundResolver.js` | custom_sql / PL-SQL 執行 |
| `projects-platform/plugins/quote/*` | QUOTE plugin |

→ **既有 Cortex 不需要知道這些 service 存在**。新平台 code 全在自己 namespace 內。

### A.4 Cross-cutting:既有 ticket_messages 的處理

唯一例外:`ticket_messages` 加 column(對應 §13 多 channel)

**做法**:
- 加的 column 都有 default 值,既有 feedback ticket 完全不感知
- 既有 feedback route handler 不動(本來不讀新 column 就沒事)
- 新平台寫入時帶新 column;既有寫入時不帶(走 default)

**新平台 Pin / 已讀回執 / 訊息色語言**:在新平台自己的 channel 內處理,既有 feedback 不會跑到新邏輯。

→ Schema 變更最小化,既有 feedback 0 影響。

---

## B. Schema 層級解耦

### B.1 Table 命名規則

| 前綴 | 用途 | 範例 |
|---|---|---|
| (無前綴) | Cortex 既有 | `users` / `kb_*` / `tickets` / `ticket_messages` / `skills` / ... |
| `project_*` | 新平台通用表 | `projects` / `project_members` / `project_channels` / `project_tasks` / `project_stages` |
| `qp_*` | QUOTE plugin 專屬 | `qp_form_templates` / `qp_excel_template_bindings` / `qp_data_source_definitions` |
| `*_general_*` / `*_it_*` | 其他 plugin(P3+) | `general_*` / `it_*` |
| `channel_*` / `dashboard_*` | 通用元件 | `channel_participants` / `dashboard_layouts` |

→ 規格書 §3 / §11 / §13 / §14 / §15 / §16 / §17 詳列每張表

### B.2 既有表的 ALTER(僅 1 張)

**唯一需要 ALTER 的既有表**:`ticket_messages`

```sql
ALTER TABLE ticket_messages ADD (
  channel_id            NUMBER,                      -- FK project_channels.id(可 NULL,既有 feedback 走 NULL)
  message_type          VARCHAR2(20) DEFAULT 'NORMAL',
  is_pinned             NUMBER(1) DEFAULT 0,
  pinned_by             NUMBER,
  pinned_at             TIMESTAMP,
  requires_read_receipt NUMBER(1) DEFAULT 0,
  synced_to_announcement NUMBER(1) DEFAULT 0,
  deleted_at            TIMESTAMP,
  deleted_by            NUMBER,
  deletion_mode         VARCHAR2(20),
  deletion_reason       VARCHAR2(500),
  content_hash          VARCHAR2(64)
);
```

**安全性評估**:

| 項目 | 評估 |
|---|---|
| ALTER 是否鎖表 | ❌ 不鎖(Oracle add column with default 是 online operation since 11g) |
| 既有 feedback ticket 影響 | ❌ 無影響(channel_id NULL → 走原邏輯;新 column 都有 default) |
| 既有 query 影響 | ❌ 無影響(SELECT * 不會少欄位;指名 column 的 query 不會碰新欄位) |
| Rollback 難度 | 🟡 中(可以 drop column 但需停機;**不建議 rollback ALTER**,改用 disable feature) |

→ ALTER 是必須的(無法用 JSON metadata 完全取代),但風險可控。

### B.3 Migration 機制

沿用 Cortex 既有 `runMigrations()`:

```javascript
// projects-platform/migrations/001_init.js
const { db } = require('../../database-oracle');

async function migrate001() {
  // 1. 建新表(check-if-exists)
  await createTable('PROJECTS', 'CREATE TABLE projects (...)');
  await createTable('PROJECT_MEMBERS', '...');
  // ... 全部新表

  // 2. ALTER ticket_messages(check column existence)
  await addColumnIfNotExists('TICKET_MESSAGES', 'CHANNEL_ID', 'NUMBER');
  await addColumnIfNotExists('TICKET_MESSAGES', 'MESSAGE_TYPE', 'VARCHAR2(20) DEFAULT \'NORMAL\'');
  // ... 其他 column
}

// 整合進現有 runMigrations
async function runMigrations() {
  // ... Cortex 既有 migrations
  if (process.env.ENABLE_PROJECTS_PLATFORM === 'true') {
    await migrate001();
  }
}
```

**規則**:
- 走 `createTable()` / `addColumnIfNotExists()` 包裝 → idempotent(可重跑)
- Feature flag 控制是否跑 migration
- 既有 Cortex migration 不動

### B.4 KB metadata 不需 ALTER

§7 提到 KB 寫入時 metadata 加 `project_id` / `source_type` 等 — 這是寫進既有 `kb_documents.metadata` CLOB 欄位的 JSON,**不需 ALTER**。

→ 既有 KB query 不受影響。

### B.5 Schema 風險矩陣

| 變更 | 風險 | 緩解 |
|---|---|---|
| ALTER `ticket_messages` 加 column | 🟡 中 | online ALTER + default 值 + audit |
| 新建 `project_*` 表 | 🟢 低 | 全新表,無人 query 過 |
| 新建 `qp_*` 表 | 🟢 低 | 同上 |
| 修改 `kb_documents.metadata` JSON | 🟢 低 | JSON 本來就 schemaless |
| 新建 KB 命名族 `projects-*` | 🟢 低 | 既有 KB 命名空間不衝突 |

→ 只有 1 個 🟡 風險點,且可控。

---

## C. Deploy 層級隔離

### C.1 同一個 Cortex Pod 跑(整合架構)

```
┌─ Kubernetes Cluster ────────────────────────────────────┐
│                                                         │
│  cortex-app Pod(3 replicas,既有)                      │
│  ┌─────────────────────────────────────────────┐       │
│  │  Express server (single process)              │       │
│  │  ┌──────────────────┬──────────────────────┐ │       │
│  │  │  Cortex 既有     │ projects-platform ★  │ │       │
│  │  │  routes/services │ (Feature flag)      │ │       │
│  │  └──────────────────┴──────────────────────┘ │       │
│  │                                              │       │
│  │  共用:Oracle pool / Redis / SSO / KB /     │       │
│  │       Bot / Schedule / SMTP / Webex          │       │
│  └─────────────────────────────────────────────┘       │
│                                                         │
│  ─── 不另起 Pod,不另建 Service ───                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**為什麼整合進同 Pod**:

| 優點 | 說明 |
|---|---|
| 充分共用基礎建設 | LLM / KB / SSO / token / DB pool 都直接拿 |
| Deploy 簡單 | 沿用 `deploy.sh`,不需新 K8s manifest |
| Cross-module call 快 | 同 process function call,不需 HTTP overhead |
| Pod 數不變 | 不需擴大 K8s resource quota |

**不採用 microservice 的理由**:

| Microservice 缺點 | 說明 |
|---|---|
| 開發複雜度增加 | 需做 inter-service auth / contract / error propagation |
| Cortex 既有 service 要包成 API | 大量 wrapping work |
| Token / session 跨服務難 | 需重新設計 auth flow |
| Deploy 流程要重做 | 兩個 image / 兩套 manifest |

→ Phase 1 走整合,Phase 4 再評估是否要拆 microservice。

### C.2 Feature Flag 一鍵 enable / disable

```bash
# .env / server-config
ENABLE_PROJECTS_PLATFORM=true   # production
ENABLE_PROJECTS_PLATFORM=false  # rollback 或測試
```

**效果**:

- `true`:
  - Routes mount(/api/projects/*)
  - Workers start
  - Migration 跑(idempotent)
  - Sidebar 顯示「專案管理」menu

- `false`:
  - Routes 不 mount(404)
  - Workers 不啟動
  - Migration 不跑(但已跑過的不會 rollback)
  - Sidebar 不顯示「專案管理」menu

→ 任何時候可以一行設定 disable,無風險。

### C.3 部署流程(沿用既有 `deploy.sh`)

```bash
# 既有 deploy.sh 不需改
./deploy.sh v0.4.1
```

**步驟**:
1. Build image(包含 projects-platform code)
2. Push 到 K8s registry
3. Apply deployment.yaml(image tag 更新)
4. Rolling restart(3 個 Pod 逐個更新)
5. Health check `/api/health`

**新平台啟用**:Pod env 加 `ENABLE_PROJECTS_PLATFORM=true`(K8s ConfigMap 或 Secret 控制)

### C.4 Rollback 計畫

| 情境 | Rollback 動作 |
|---|---|
| 新平台 bug 影響 Cortex | env 改 `ENABLE_PROJECTS_PLATFORM=false` + rolling restart(< 5 min) |
| 新平台 schema 出問題 | 同上(schema 留著無傷,只是 code 不跑) |
| 新平台 worker 吃 CPU 過頭 | env 加 `ENABLE_PROJECTS_WORKERS=false` 單獨關 workers |
| 需要完全移除 | `feature off` + 將來新版本不 ship 此 module |

→ **不需要 DB rollback**(新表留著不影響,ALTER column 留著也無感)。

---

## D. Runtime 隔離(Exception Containment)

### D.1 嚴格 Error Boundary

```javascript
// projects-platform/index.js
const router = express.Router();

router.use((req, res, next) => {
  try {
    next();
  } catch (e) {
    console.error('[projects-platform] uncaught:', e);
    res.status(500).json({ error: 'projects-platform internal error' });
  }
});

// 每個 route 都有 try/catch 包
router.get('/:id', async (req, res) => {
  try {
    const project = await projectsService.get(req.params.id);
    res.json(project);
  } catch (e) {
    logProjectsError(e, req);
    res.status(500).json({ error: e.message });
  }
});

// Workers 也要 try/catch
async function statusSummaryWorker() {
  try {
    // ... worker logic
  } catch (e) {
    console.error('[projects-platform] statusSummaryWorker:', e);
    // 不 throw 出去,worker 自己活著
  }
}
```

**規則**:
- 新平台**所有 route handler 都包 try/catch**
- 新平台**所有 worker / job 都包 try/catch**
- Exception 只 log,**不 throw 出 module 邊界**
- Cortex 既有 routes 完全感受不到新平台的 exception

### D.2 Worker 隔離

```javascript
// projects-platform/workers/index.js
function startWorkers() {
  if (process.env.ENABLE_PROJECTS_WORKERS === 'false') return;

  // Status SUMMARY worker(每天 09:00)
  const summaryWorker = setInterval(async () => {
    try {
      await statusSummaryWorker.run();
    } catch (e) {
      console.error('[projects-platform] summaryWorker fail:', e);
    }
  }, 60 * 60 * 1000);  // check every hour

  // SLA 預警 worker(每 5 min)
  const slaWorker = setInterval(...);

  // KB archive worker(結案觸發,event-driven)
  // ...
}
```

**規則**:
- Worker 用 `setInterval` 或既有 schedule service
- 每個 worker 獨立 try/catch
- 失敗時 log + 下次再試,**不 crash process**

### D.3 共用資源使用配額

```javascript
// 限制新平台 LLM call 不要把 Cortex token 用完
const projectsLLMQueue = new RateLimiter({
  tokensPerSecond: 5,    // 平均 5 calls/s
  burst: 20              // 突發最多 20
});

async function callLLMFromProjects(prompt, opts) {
  await projectsLLMQueue.wait();
  return geminiClient.call(prompt, opts);
}
```

**規則**:
- 新平台呼叫 LLM 走自己的 rate limiter,不擠爆 Cortex 帳本
- 新平台呼叫 Oracle / Redis 不會獨占 connection pool(`poolMax=25` × 3 pods,新平台用 ≤ 30%)
- Background worker 排程避開高峰時段

---

## E. 監控 / 告警隔離

### E.1 Log Namespace

```javascript
// 所有 projects-platform log 都加 prefix
console.log('[projects-platform] something');
console.error('[projects-platform] error:', e);

// Worker 加細分
console.log('[projects-platform/worker/status-summary] running');
console.log('[projects-platform/plugin/quote] form template loaded');
```

### E.2 Loki Dashboard

- Cortex 既有 dashboard 不動
- 新增 `projects-platform` dashboard:
  - Request rate `/api/projects/*`
  - Error rate
  - LLM call count(per AI 加速功能)
  - Worker run history
  - Slow query alerts

### E.3 Alert 設定

```yaml
# 新平台 alert(獨立)
- alert: ProjectsPlatformHighErrorRate
  expr: rate({app="cortex-app", message=~".*\\[projects-platform\\].*error.*"}[5m]) > 0.1
  
- alert: ProjectsPlatformWorkerStuck
  expr: time() - max(projects_worker_last_run_timestamp) > 3600
```

→ Cortex 既有 alert 完全不受影響。

---

## F. 風險預防 5 項硬規則

| # | 規則 | 違反後果 |
|---|---|---|
| **1** | **不直接 ALTER Cortex 既有 schema**(除 `ticket_messages` 加 column) | 可能影響既有 feedback / training / KB |
| **2** | **不直接動 Cortex 既有 route handler 程式碼** | 既有 user 操作可能炸 |
| **3** | **共用 service 只 import 不修改**(geminiClient / kbRetrieval / smtp 等) | 改了會影響全 Cortex |
| **4** | **新平台 exception 不冒泡出 namespace 邊界** | Cortex routes 會跟著炸 |
| **5** | **共用資源(LLM token / DB pool / Redis)走 rate limiter** | 新平台爆量會吃光 Cortex 配額 |

→ Code review 時必 check 這 5 項。違反就退件。

---

## G. 演進策略(Phase 1 → 4)

### Phase 1:整合 Module(同 process,~6 週)

- 走本文 A-F 所有設計
- 新平台 100% 在 cortex-app 內
- Feature flag 控制

**驗證重點**:
- Cortex 既有 feature 完全不受影響(回歸測試)
- 新平台 routes 正常運作
- Workers 不影響主 process 性能

### Phase 2:強化整合(無架構變更)

- 加 KB 沉澱 pipeline / 戰情會議室 / Bot 整合
- 仍同 process,規模擴大但架構不變

### Phase 3:進階分析(無架構變更)

- 加 What-if / ML 預測
- ML 模型可能放獨立 inference service(看資料量)

### Phase 4(可選):評估 Microservice 拆分

**評估條件**:
- 新平台 LoC > 50K 且管理痛
- 新平台 traffic 影響 Cortex 主 service
- 需要獨立 deploy cycle(更快 ship)

**拆分方式**:
- 新平台 + Cortex 走 HTTP 通訊
- 共享 Oracle DB
- Cortex 既有 service 包成 internal API
- Feature flag → service mesh routing

→ **Phase 1-3 不拆**,等真有需求再評估。

---

## H. 啟動 Checklist(對應 §18 Phase 1)

```
🔴 開發前必做

☐ 建立 server/projects-platform/ directory + namespace 規範
☐ 寫 Feature flag 邏輯(ENABLE_PROJECTS_PLATFORM)
☐ 寫 try/catch 包裝 middleware(error boundary)
☐ 寫 LLM rate limiter(projectsLLMQueue)
☐ Migration 整合進 runMigrations(idempotent)
☐ 既有 Cortex 主流程回歸測試 pass

🟡 開發中觀察

☐ Log prefix 都有 [projects-platform]
☐ 每個 route handler 都包 try/catch
☐ 每個 worker 都包 try/catch
☐ 共用 service 都是 import,沒有就地修改
☐ Schema ALTER 只動 ticket_messages

🟢 上線前驗證

☐ Cortex 既有 feature 回歸測試 100% pass
☐ Feature flag ON/OFF 都運作
☐ Rollback 演練(env 切 false → rolling restart)
☐ 監控 / Loki dashboard / Alert 設定完成
☐ Pilot user 開啟,其他 user 不開
```

---

## I. 風險矩陣(本文章設計)

| 風險 | 機率 | 衝擊 | 緩解後 |
|---|---|---|---|
| Cortex 既有 feature 因新平台 code 炸掉 | 🟢 低 | 🔴 高 | 🟢 極低(5 硬規則 + 嚴格 try/catch + feature flag) |
| Schema migration 影響既有 query | 🟢 低 | 🟡 中 | 🟢 極低(idempotent + check-if-exists + 1 張表加 column) |
| 新平台爆量影響 Cortex 性能 | 🟡 中 | 🟡 中 | 🟢 低(rate limiter + 監控) |
| Pod 重啟時間變長 | 🟢 低 | 🟢 低 | 🟢 極低(load 不變多) |
| Rollback 不順暢 | 🟢 低 | 🟡 中 | 🟢 極低(feature flag + rolling restart < 5 min) |

→ **整體風險可控**,不需要走 microservice 拆分。

---

## J. 結論

```
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   方案:同 Pod 同 process,但 5 層解耦                         ║
║                                                               ║
║   ▸ Code:獨立 namespace + URL mount point                    ║
║   ▸ Schema:全新表前綴 + 僅 1 張既有表加 column                ║
║   ▸ Deploy:Feature flag 一鍵 enable/disable                  ║
║   ▸ Runtime:嚴格 try/catch + exception 不冒泡                ║
║   ▸ 監控:Log prefix + 獨立 dashboard / alert                 ║
║                                                               ║
║   ─── 結果 ───                                                ║
║   ✅ 既有 Cortex 完全不受影響(回歸測試保證)                  ║
║   ✅ 充分共用 Cortex 既有 LLM / KB / Bot / ERP / SSO          ║
║   ✅ Rollback 5 分鐘內(env 切 false)                         ║
║   ✅ Microservice 拆分留作 Phase 4 可選                        ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

— 本文件結束 —
