# 業務報價系統 — 規格書(基於 Cortex 擴充)

> 以 Cortex(Foxlink GPT)為基座建構快速客戶報價系統
> 作者:規劃於 2026-04-23
> 狀態:**v0.3.5 規格草稿(戰情會議室 §14 + AI 分析架構 §15)** — 對應 [docs/\_inbox/Cortex報價系統規劃文件_v0.1.pdf](./_inbox/Cortex報價系統規劃文件_v0.1.pdf)
>
> 本文件負責把 v0.1 的「要做什麼」轉成「怎麼做」:Oracle schema、API、狀態機、脫敏 Pipeline、**資料安全分層(L0–L5)**、授權模型、UI 設計、部署拓撲、戰情會議室、AI 分析架構、Review 計畫。
>
> v0.3.5 調整(戰情室 + AI):
> - ✅ 新增 **§14 戰情會議室 UX** — 三欄版面、任務 template、PROGRESS/BLOCKER/DECISION/AI_INSIGHT 訊息色語言、DECISION 強制已讀回執、Pin 機制、WebSocket 即時同步
> - ✅ **任務 template 機制**:PM 建主任務時套 template(BOM_EXPAND / SOURCING / COSTING_CN/VN / STRATEGY / CUSTOM)→ 負責人可改子任務;新增 `quote_task_templates` 表 + `quote_tasks.task_type/template_id/completion_note` 欄位
> - ✅ **完成子任務**:文字 completion_note 必填(≥10 字),附件 optional(不再強制上傳)
> - ✅ 訊息讀取回執新表 `ticket_message_read_receipts`;DECISION 訊息自動 `requires_read_receipt=1`
> - ✅ 新增 **§15 AI 分析架構** — 三層(即時建議 / 精確分析 / 統計聚合)+ Scrub→LLM→Unscrub + AI service 安全加固
> - ✅ **Layer 3 儀表板改即時**(非 4h cron):Oracle Incremental MV `REFRESH FAST ON COMMIT` + WebSocket push
> - ✅ LLM 呼叫一律走 Scrub(金額/客戶名換 placeholder),防止 LLM log 留明文
>
> v0.3.4 調整(部署拓撲定案):
> - ✅ 採 **Option C**:單一 React SPA + 單一 Express backend,但**前端獨立 hostname** `quote.foxlink.com.tw`(§1.2.1 / §8.0)
> - ✅ Nginx 雙 `server_name` 都 proxy 到同一 cortex-app upstream;Cookie domain / IP 白名單 / rate limit / CSP 各自設(§7.1)
> - ✅ hostname 驅動 JWT aud 簽發(`portalDetector` middleware,§7.2.1)
> - ✅ 前端 `App.tsx` 頂層 hostname 偵測,切 `<QuoteApp>` / `<CortexApp>`;共用 `components/` 基礎元件
> - ✅ 報價獨有元件放 `modules/quote/`,禁止複製共用元件(共同受益於升級)
> - 🟰 相較 Option A(完全獨立 SPA):省 ~4500 行 UI code 重建,維護成本長期 1× 而非 2×
> - 🟰 相較 Option B(共用 hostname sub-path):L0 網路隔離 / cookie domain / CSP 都有,安全強度幾乎等同 A
>
> v0.3.3 調整(離職處理):
> - ✅ 業務 / PM 離職走**方案 B**:專案進入 `pending_reassign`(SALES/PM/BOTH)
> - ✅ Pending 期間**鎖唯讀** + **SLA 暫停**(sla_paused_at),reassign 完成後延展 SLA
> - ✅ 新增 admin endpoints:`reassign-sales` / `reassign-pm` / `force-unlock`(§4.3.1)
> - ✅ 新增 `quote_projects` 欄位:`pending_reassign / pending_reason / pending_since / sla_paused_at`
> - ✅ 新增 `quote_audit_log` 事件:`PROJECT_LOCKED / SALES_REASSIGN / PM_REASSIGN / FORCE_UNLOCK`
> - ✅ 新增 admin 頁 `PendingReassignPage`(§8.7.1)+ 詳情頁 pending banner(§8.4.1)
> - ✅ 新增 RAID 4 項新風險(包含 admin 濫用 FORCE_UNLOCK / 離職 job reconcile)
>
> v0.3.2 調整(授權模型釐清):
> - ✅ **業務(Sales)**是專案**發起人**,建立專案時**指派 PM**(新 global role `quote.sales`)
> - ✅ **PM** 是執行 owner,被業務指派後才管專案(新 global role `quote.pm`)
> - ✅ 業務 + PM **共同**擁有邀請 / 踢成員 / 結案權,彼此等權
> - ✅ 只有**業務**能換 PM(走 `transfer-pm` API)
> - ✅ 高階主管(`quote.director`)看**權限內所有專案**完整流程 + 價格(不需被邀請)
> - ✅ `quote_project_members` 僅存被邀請成員(MEMBER/OBSERVER),Sales/PM 存 `quote_projects` 欄位
> - ✅ VPD / ACL middleware / API 權限全部對應調整
>
> v0.3.1 調整:
> - ❌ 移除「LDAP title 自動推導 role」(title 格式不一致,非權限依據)
> - ✅ LDAP 僅同步 mail / displayName / department / enabled
> - ➕ 新增 § 12 脫敏 tier Review 計畫
> - ➕ 新增 § 13 Pilot 規劃狀態
>
> v0.3 已決議:
> - KMS 階段式:P1 K8s Secret + HKDF → P2 Vault Transit(§ 7.4.2)
> - 加密混合:App AES-GCM BLOB(金額)+ Oracle TDE 表空間(其他)(§ 7.4.1)
> - UI 設計(§ 8)
> - 僅供內部使用,**不**實作 external_partner_mode

---

## 0. TL;DR

| 面向 | 作法 |
|------|------|
| **基座複用** | 擴充 Cortex feedback 工單模型 → `quote_projects`;群聊續用 `ticket_messages` WebSocket 通道,用 `room_type='quote_project'` 區隔 |
| **新建 schema** | `quote_projects`, `quote_project_members`, `quote_tasks`, `quote_cost_breakdowns`, `quote_factory_cost_master`, `quote_customer_aliases`, `quote_audit_log`(append-only) |
| **核算引擎** | Cortex Skill(Workflow/DAG)+ ERP Procedure(BOM)+ 新成本詢價 MCP/API 連接器 + Excel 範本 |
| **KB 三層** | `quote-cases-public`(脫敏) / `quote-cases-internal`(完整) / `bom-and-specs` |
| **資料安全** | **6 層 defense-in-depth**:網路(L0)/ 身份(L1)/ 授權 ABAC+VPD(L2)/ 加密(L3)/ DLP+浮水印(L4)/ 稽核(L5)— 詳 §7 |
| **保密敏感點** | **價格類欄位**(成本、毛利、合約價)比客戶資訊更敏感,欄位級 ACL + 加密 + 區間化顯示 |
| **Phase** | P1(2–4w)MVP:schema + 基礎核算 + ACL / P2(4–8w)群聊+live KB+結案 Pipeline / P3(8–12w)What-if+贏單率預測+多級簽核 |

---

## 1. 範圍與關鍵決策

### 1.1 刻意複用 Cortex 的機制(避免重造輪子)

| Cortex 現有 | 報價系統如何用 |
|------------|----------------|
| feedback 工單(`tickets`)+ `ticket_messages` WebSocket 群聊 | 擴充成 `quote_projects` + 同套群聊 |
| 知識庫市集(向量化 / OCR / Tags 路由) | 報價 KB 三層,沿用既有 `kb_chunks` / 同義詞 / `retrieval_config` |
| AI 戰情室 Board + ECharts | 報價戰情儀表板(Gantt/RAG/贏單率)|
| ERP Procedure 工具 | BOM 展開 / 採購成本查詢 |
| Webex Bot + SMTP | SLA 告警推播 |
| MCP 客戶端 + User Identity JWT | 新成本詢價系統接入 |

### 1.2 刻意**不**複用的部分

- ❌ **權限不能完全沿用**:報價系統比一般 Cortex 模組敏感一級,必須有**欄位級 ACL**(價格次權限)與 **Step-up 2FA**,詳 §7。
- ❌ **Auth token 不共用 audience**:同 SSO 但簽出 `aud=quote` 的獨立 JWT(由 hostname 驅動簽發,見 §7.2),避免一般 chat token 能打到 `/api/quote/*`。
- ❌ **Chrome Extension 不得讀 quote 模組**:extension manifest 的 `host_permissions` 不能含 `quote.foxlink.com.tw` 與 `/quote/*`,避免截圖工具意外錄到報價單。

### 1.2.1 部署拓撲決議(Option C — 共用程式碼 + 獨立 hostname)

**決議(v0.3.4)**:採 Option C — 單一 React SPA + 單一 Express backend,但**前端獨立 hostname**、**後端獨立 API path**。

| 維度 | 做法 |
|------|------|
| 前端入口 | `cortex.foxlink.com.tw`(主站) + `quote.foxlink.com.tw`(報價站) |
| 後端 API | 同一個 Express 服務,`/api/*`(主站) + `/api/quote/*`(報價獨立 path)|
| Code base | **單一 React SPA**,App.tsx 頂層 hostname detector 切 `<CortexApp>` / `<QuoteApp>` |
| 共用的 | `src/components/` 所有基礎 UI(Button/Modal/Table/Chat/Markdown/FileUpload/i18n/theme 基礎) |
| Quote 獨有的 | `src/modules/quote/` 下 Layout / Sidebar / 報價特有元件(SlaLight、CostBreakdownTable、StepUpModal、WatermarkedViewer 等)|
| Cookie domain | 分離 — `Domain=quote.foxlink.com.tw; HttpOnly; SameSite=Strict` |
| JWT audience | hostname 驅動:`quote.*` hostname 簽 `aud=quote`、`cortex.*` hostname 簽 `aud=cortex` |
| 部署 | **同一個 cortex-app Pod**,Nginx 雙 `server_name` 都 proxy 到同一 upstream |
| CSP / WAF | 各自設,`quote.*` 可額外加 IP 白名單 / 嚴格 rate limit |

**取捨**:
- ✅ 使用者感受上是兩個系統(URL、視覺、登入 token 都不同)
- ✅ 安全性幾乎等同完全獨立 SPA(L0 網路 / L2 cookie / L3 JWT aud 三層都隔離)
- ✅ Chat / Markdown / FileUploader 等底層元件**完全共用**,Cortex 升級自動帶到報價
- ✅ 單一 build、單一部署單位,維護成本僅比共用 sub-path 多 ~10%
- ➖ 唯一代價:Nginx 多一個 server block + 前端一個 `portalDetector`(< 1 人天)

**Option A/B/C 詳細對比**(供後續若要回顧決策)已在提案討論中,最終採 C。

### 1.3 術語

- **報價專案(Quote Project)**:系統核心物件,1 件 RFQ = 1 個 project。
- **主任務(Task)** vs **子任務(Subtask)**:layered WBS,Delay 狀態強制填 reason。
- **PM**:專案負責人(不是傳統 Project Manager,而是 Pricing Manager / Program Manager)。
- **BU(Business Unit)**:事業處,對應 Cortex 組織層級第 4 層。

---

## 2. Oracle Schema(可直接建表)

> 慣例遵照 [CLAUDE.md#DB 慣例](../CLAUDE.md):`NUMBER GENERATED ALWAYS AS IDENTITY` / `CLOB` JSON / `TIMESTAMP DEFAULT SYSTIMESTAMP` / migration 在 `runMigrations()` with column existence check。

### 2.1 專案主表

```sql
CREATE TABLE quote_projects (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_code          VARCHAR2(30) UNIQUE NOT NULL,       -- QT-2026-0001(YYYY+流水)
  customer_id           NUMBER NOT NULL,
  product_name          VARCHAR2(200),
  part_number           VARCHAR2(100),
  quantity              NUMBER,
  delivery_date         DATE,

  -- SLA
  rfq_received_at       TIMESTAMP DEFAULT SYSTIMESTAMP,
  sla_due_at            TIMESTAMP,                           -- rfq + 24h(高優) / 48h(低優)
  priority              VARCHAR2(10) DEFAULT 'NORMAL',       -- HIGH|NORMAL|LOW
  closed_at             TIMESTAMP,

  -- 狀態機(見 §3)
  status                VARCHAR2(20) DEFAULT 'DRAFT',

  -- 人員(業務 + PM 雙軌,允許同人)
  sales_user_id         NUMBER NOT NULL,                     -- 發起人 = 業務,必填
  pm_user_id            NUMBER NOT NULL,                     -- 業務建專案時指派,必填
  business_unit_id      NUMBER NOT NULL,                     -- ACL 用

  -- 廠區決策
  candidate_factories   VARCHAR2(50),                        -- 'CN,IN,VN'
  final_factory         VARCHAR2(10),                        -- CN|IN|VN

  -- ★ 價格類(加密,見 §7.3)
  final_quote_amount_enc    BLOB,                            -- AES-256-GCM 密文
  final_margin_rate_enc     BLOB,
  win_loss_type             VARCHAR2(10),                    -- WIN|LOSS|HOLD
  win_loss_reason_enc       BLOB,                            -- 含金額就加密
  fx_rate               NUMBER(10,6),
  fx_locked_at          TIMESTAMP,

  -- 資訊分級
  classification        VARCHAR2(15) DEFAULT 'CONFIDENTIAL', -- PUBLIC|INTERNAL|CONFIDENTIAL|RESTRICTED
  encryption_key_id     VARCHAR2(100),                       -- KMS key reference

  -- ★ 待指派狀態(人員離職時使用,見 §3.2)
  pending_reassign      VARCHAR2(10),                        -- NULL|SALES|PM|BOTH
  pending_reason        VARCHAR2(200),                       -- 'sales_resigned' / 'pm_resigned' / 'manual_lock'
  pending_since         TIMESTAMP,                           -- 進入 pending 時間
  sla_paused_at         TIMESTAMP,                           -- SLA 暫停時間點(恢復時 sla_due_at 自動延展)

  created_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at            TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE INDEX idx_qp_pm ON quote_projects(pm_user_id, status);
CREATE INDEX idx_qp_sales ON quote_projects(sales_user_id, status);
CREATE INDEX idx_qp_bu_status ON quote_projects(business_unit_id, status);
CREATE INDEX idx_qp_sla ON quote_projects(sla_due_at) WHERE status NOT LIKE 'CLOSED%';
CREATE INDEX idx_qp_pending ON quote_projects(pending_reassign, business_unit_id) WHERE pending_reassign IS NOT NULL;
```

### 2.2 成員 ACL(核心!)

**設計原則**:
- 業務 / PM 是 `quote_projects` 上的欄位(sales_user_id / pm_user_id),**不**存進 members 表
- `quote_project_members` 僅存**被邀請者**(MEMBER / OBSERVER)
- 三種進專案的管道:`sales_user_id == me` 或 `pm_user_id == me` 或 `members 表有我`
- 允許 sales_user_id == pm_user_id(同人身兼業務+PM),不會有 PK 重複問題
- 業務和 PM **不能互踢**(業務邏輯)— 換 PM 要另走 API:`PATCH /api/quote/projects/:id/transfer-pm`
- `can_view_price` / `can_export` 僅對 MEMBER/OBSERVER 有效;SALES/PM 一律 true(hard-coded)

```sql
CREATE TABLE quote_project_members (
  project_id        NUMBER NOT NULL,
  user_id           NUMBER NOT NULL,
  role              VARCHAR2(10) NOT NULL,
    -- MEMBER|OBSERVER
    -- CHECK (role IN ('MEMBER','OBSERVER'))
  -- ★ 欄位級次權限(由 Sales/PM 勾選)
  can_view_price    NUMBER(1) DEFAULT 0,      -- 看 unit_cost / margin_rate / contract_price
  can_export        NUMBER(1) DEFAULT 0,      -- 匯出 Excel/PDF
  -- can_close 不存,結案權一律由 sales_user_id/pm_user_id enforce
  joined_at         TIMESTAMP DEFAULT SYSTIMESTAMP,
  joined_by         NUMBER,                   -- 加人者 user_id(稽核用)
  left_at           TIMESTAMP,                -- 被踢 / 離職軟刪
  CONSTRAINT pk_qpm PRIMARY KEY (project_id, user_id),
  CONSTRAINT fk_qpm_project FOREIGN KEY (project_id) REFERENCES quote_projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_qpm_user ON quote_project_members(user_id) WHERE left_at IS NULL;
```

### 2.3 任務 / 子任務(擴充自 feedback `ticket_subtasks`)

```sql
CREATE TABLE quote_tasks (
  id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id        NUMBER NOT NULL,
  parent_task_id    NUMBER,                    -- NULL=主任務, NOT NULL=子任務
  sequence_order    NUMBER,
  title             VARCHAR2(200) NOT NULL,
  description       CLOB,
  assignee_user_id  NUMBER,
  due_date          DATE,
  status            VARCHAR2(15) DEFAULT 'TODO', -- TODO|DOING|DELAY|BLOCKED|DONE
  -- ★ Delay 強制填
  delay_reason      CLOB,
  delayed_at        TIMESTAMP,
  completed_at      TIMESTAMP,
  created_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT fk_qt_project FOREIGN KEY (project_id) REFERENCES quote_projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_qt_project ON quote_tasks(project_id, status);
CREATE INDEX idx_qt_assignee ON quote_tasks(assignee_user_id, status);
```

### 2.4 成本核算結果(所有金額欄位加密)

```sql
CREATE TABLE quote_cost_breakdowns (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id            NUMBER NOT NULL,
  factory_code          VARCHAR2(10) NOT NULL,     -- CN|IN|VN
  version               NUMBER DEFAULT 1,           -- 每次重算 +1,留歷史
  -- 核算輸入
  bom_snapshot          CLOB,                       -- JSON,凍結那一刻 BOM
  fx_rate               NUMBER(10,6),
  yield_rate            NUMBER(5,4),                -- 0.9500
  -- ★ 結果(密文)
  material_cost_enc     BLOB,
  labor_cost_enc        BLOB,
  overhead_cost_enc     BLOB,
  logistics_cost_enc    BLOB,
  tooling_nre_enc       BLOB,
  recommended_price_enc BLOB,
  margin_rate_enc       BLOB,
  -- metadata
  calculated_at         TIMESTAMP DEFAULT SYSTIMESTAMP,
  calculated_by         NUMBER,
  skill_run_id          NUMBER,                     -- 對應 Cortex skill_runs.id
  CONSTRAINT fk_qcb_project FOREIGN KEY (project_id) REFERENCES quote_projects(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_qcb_version ON quote_cost_breakdowns(project_id, factory_code, version);
```

### 2.5 廠區費用主檔(財務 PIC 維護)

```sql
CREATE TABLE quote_factory_cost_master (
  id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  factory_code          VARCHAR2(10) NOT NULL,       -- CN|IN|VN
  effective_from        DATE NOT NULL,
  effective_to          DATE,                        -- NULL = 目前有效
  -- 基期數據(加密,僅 finance + pm 可看完整)
  labor_rate_hour_enc   BLOB,                        -- 時薪
  overhead_rate_enc     BLOB,                        -- 管銷率
  tax_rate              NUMBER(5,4),                 -- 稅率公開
  logistics_formula     VARCHAR2(200),               -- 物流公式(非機密)
  currency              VARCHAR2(5),
  maintained_by         NUMBER,
  reviewed_at           TIMESTAMP,                   -- quarterly review 時間戳
  reviewed_by           NUMBER,
  notes                 CLOB
);

CREATE UNIQUE INDEX idx_qfcm_effective ON quote_factory_cost_master(factory_code, effective_from);
```

### 2.6 客戶代號映射(脫敏用,僅 admin 可查)

```sql
CREATE TABLE quote_customer_aliases (
  customer_id       NUMBER PRIMARY KEY,
  real_name_enc     BLOB NOT NULL,              -- 客戶真名密文
  alias_code        VARCHAR2(20) UNIQUE,        -- A001, A002...
  classification    VARCHAR2(15),               -- STRATEGIC|NORMAL
  created_at        TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

### 2.7 稽核日誌(append-only,7 年保留)

```sql
CREATE TABLE quote_audit_log (
  id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type      VARCHAR2(40) NOT NULL,
    -- VIEW_PROJECT|VIEW_COST|VIEW_PRICE|DOWNLOAD|EXPORT|
    -- ACL_CHANGE|CLOSE_PROJECT|REDACT_PUBLISH|STEP_UP_AUTH|FAILED_ACCESS|
    -- CREATE_PROJECT|TRANSFER_PM|
    -- PROJECT_LOCKED|SALES_REASSIGN|PM_REASSIGN|FORCE_UNLOCK
  user_id         NUMBER,
  project_id      NUMBER,
  resource_id     VARCHAR2(200),                -- file_id / task_id / chunk_id
  ip_address      VARCHAR2(50),
  user_agent      VARCHAR2(500),
  session_id      VARCHAR2(100),
  metadata        CLOB,                         -- JSON extra
  occurred_at     TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- ★ Trigger 阻擋 UPDATE/DELETE
CREATE OR REPLACE TRIGGER trg_audit_append_only
BEFORE UPDATE OR DELETE ON quote_audit_log
FOR EACH ROW
BEGIN
  RAISE_APPLICATION_ERROR(-20001, 'quote_audit_log is append-only');
END;
/

CREATE INDEX idx_qal_project ON quote_audit_log(project_id, occurred_at DESC);
CREATE INDEX idx_qal_user ON quote_audit_log(user_id, occurred_at DESC);
CREATE INDEX idx_qal_event ON quote_audit_log(event_type, occurred_at DESC);

-- Partition by month 方便歸檔(Oracle 23 AI)
-- ALTER TABLE quote_audit_log PARTITION BY RANGE(occurred_at) INTERVAL (NUMTOYMINTERVAL(1,'MONTH'));
```

### 2.8 群聊續用 feedback schema

```
room_type='quote_project', room_id=quote_projects.id
```
不新增表;`ticket_messages` / `ticket_attachments` 沿用,透過 `room_type` 區隔查詢。

---

## 3. 狀態機

### 3.1 主狀態機

```
┌─────────┐  建立  ┌──────────────┐  PM 認領  ┌────────────┐
│  DRAFT  │ ─────► │  EVALUATING  │ ────────► │  QUOTING   │
└─────────┘        └──────────────┘           └─────┬──────┘
                                                    ▼
                                         ┌────────────────┐
                                         │  COSTING (核算) │
                                         └────────┬───────┘
                                                  ▼
                                         ┌──────────────┐
                                         │  STRATEGY     │
                                         └──────┬───────┘
                                                ▼
                                         ┌──────────────┐
                                         │  APPROVING    │ (多級簽核,P3)
                                         └──────┬───────┘
                                                ▼
                                         ┌──────────────┐     ┌───────────────┐
                                         │  SUBMITTED    │ ──► │  CLOSED_WIN    │
                                         └──────────────┘  │  │  CLOSED_LOSS   │
                                                           └─►│  CLOSED_HOLD   │
                                                              └───────────────┘
```

**轉移規則**:
- `EVALUATING → QUOTING`:PM 填 BOM 展開結果
- `COSTING → STRATEGY`:至少 1 個廠區有 `quote_cost_breakdowns`
- `APPROVING`:金額 > threshold 才走(P3 才啟用,P1 跳過)
- `→ CLOSED_*`:觸發結案 Pipeline(§6),非專案成員不能改回開啟

### 3.2 待指派機制(PENDING_REASSIGN — 人員離職處理)

**設計決策(v0.3.3)**:採 **方案 B** — 業務或 PM 離職時,**專案鎖為唯讀**、**SLA 暫停**、等 admin 手動指派新人選。
- 不採方案 A(自動轉給主管):避免在主管沒預期時被塞專案
- 不採方案 C(PM 代理 sales):會模糊績效歸屬

**正交維度**:`pending_reassign` 與主狀態 `status` 互不干擾 — 例如一個 `COSTING` 專案可同時 `pending_reassign='SALES'`;reassign 完成後繼續 `COSTING`。

**取值**:

| pending_reassign | 意義 | 觸發 |
|------------------|------|------|
| `NULL` | 正常運作 | — |
| `SALES` | 等待指派新業務 | sales_user_id 所屬 user LDAP enabled=0 |
| `PM` | 等待指派新 PM | pm_user_id 所屬 user LDAP enabled=0 |
| `BOTH` | 業務+PM 都需指派 | 兩人同時或先後離職 |

```
                      ┌─────────────────────┐
                      │  NORMAL (正常運作)   │
                      │  pending_reassign=NULL│
                      └──────────┬──────────┘
                                 │
                ┌────────────────┼─────────────────┐
                ▼                ▼                 ▼
       業務離職 job           PM 離職 job      業務+PM 同時
      reassign=SALES      reassign=PM         reassign=BOTH
                │                │                 │
                ▼                ▼                 ▼
       ┌────────────────────────────────────────────┐
       │  PENDING(專案鎖唯讀 + SLA 暫停)            │
       │  - 成員可看、可討論,不可改狀態/核算/結案    │
       │  - SLA 倒數凍結,sla_paused_at 記錄暫停時刻 │
       └──────────────┬─────────────────────────────┘
                      │ admin POST /admin/.../reassign-sales
                      │ admin POST /admin/.../reassign-pm
                      │ (BOTH 需 2 次 reassign)
                      ▼
       ┌────────────────────────────────────────────┐
       │  reassign=NULL 恢復                         │
       │  sla_due_at += (now - sla_paused_at)       │
       │  sla_paused_at = NULL                       │
       │  寫 quote_audit_log PM_REASSIGN /           │
       │                   SALES_REASSIGN           │
       │  通知新指派者 + 原成員 + director           │
       └────────────────────────────────────────────┘
```

**pending 期間的行為**:

| 動作 | pending=SALES | pending=PM | pending=BOTH |
|------|---------------|------------|--------------|
| 查看專案 / 聊天 / 附件 | ✅ | ✅ | ✅ |
| 改專案欄位 / 狀態 | ❌ 唯讀 | ❌ 唯讀 | ❌ 唯讀 |
| 觸發核算 | ❌ | ❌ | ❌ |
| 結案 | ❌ | ❌ | ❌ |
| 邀請/踢成員 | ❌ | ❌ | ❌ |
| SLA 倒數 | ⏸ 暫停 | ⏸ 暫停 | ⏸ 暫停 |
| 新成本詢價 webhook | ✅(只讀 cache) | ✅ | ✅ |

**離職 job 流程(`server/services/quote/offboardingJob.js`)**:

```js
// 每 15 分鐘掃一次,或由 HR webhook 觸發
async function handleUserOffboarding(userId) {
  // 1. 撤 token
  await revokeQuoteTokens(userId);

  // 2. 標 quote_user_roles 為失效
  await db.execute(
    `UPDATE quote_user_roles SET effective_to = SYSTIMESTAMP
     WHERE user_id=:u AND effective_to IS NULL`,
    { u: userId },
  );

  // 3. 軟刪所有專案成員資格
  await db.execute(
    `UPDATE quote_project_members SET left_at = SYSTIMESTAMP
     WHERE user_id=:u AND left_at IS NULL`,
    { u: userId },
  );

  // 4. ★ 找出所有 active 專案,看他是 sales 還是 pm
  const affected = await db.many(
    `SELECT id, sales_user_id, pm_user_id, pending_reassign, business_unit_id
     FROM quote_projects
     WHERE status NOT LIKE 'CLOSED%'
       AND (sales_user_id=:u OR pm_user_id=:u)`,
    { u: userId },
  );

  for (const p of affected) {
    const wasSales = p.sales_user_id === userId;
    const wasPm = p.pm_user_id === userId;
    let newPending;
    if (p.pending_reassign === null) {
      newPending = wasSales && wasPm ? 'BOTH' : wasSales ? 'SALES' : 'PM';
    } else if (p.pending_reassign === 'SALES' && wasPm) {
      newPending = 'BOTH';
    } else if (p.pending_reassign === 'PM' && wasSales) {
      newPending = 'BOTH';
    } else {
      newPending = p.pending_reassign; // 已經 pending 了,不變
    }

    await db.execute(
      `UPDATE quote_projects
       SET pending_reassign = :pr,
           pending_reason = :pr_reason,
           pending_since = COALESCE(pending_since, SYSTIMESTAMP),
           sla_paused_at = COALESCE(sla_paused_at, SYSTIMESTAMP),
           updated_at = SYSTIMESTAMP
       WHERE id = :id`,
      { pr: newPending, pr_reason: `user_${userId}_offboarded`, id: p.id },
    );

    // 5. 通知 admin + director + 所有成員
    await notifyReassignNeeded(p.id, newPending, userId);
    await audit(null, 'PROJECT_LOCKED', {
      project_id: p.id,
      reason: newPending,
      triggered_by: 'offboarding_job',
      user_id: userId,
    });
  }
}
```

### 3.3 SLA 邏輯(含暫停)

```
正常:
  sla_due_at = rfq_received_at + (priority='HIGH' ? 24h : 'NORMAL' ? 48h : 72h)
  warn_at    = rfq_received_at + sla_duration * 0.7
  red_at     = sla_due_at

pending 期間(sla_paused_at IS NOT NULL):
  remaining = sla_due_at - sla_paused_at     # 凍結剩餘時間

reassign 完成:
  sla_due_at := sla_due_at + (now - sla_paused_at)
  sla_paused_at := NULL
```

排程 30 min 掃一次 → Webhook 到 sales/pm + director(Teams/Webex/LINE);
pending 專案**不**觸發 SLA 告警(避免連環轟炸 admin)。

---

## 4. API Spec(Express routes)

> 路徑規則:`/api/quote/*`。所有 endpoint 都過 `verifyQuoteToken`(JWT `aud=quote`)+ `quoteACL` middleware。

### 4.1 專案 CRUD

| Method | Path | 權限 | 說明 |
|--------|------|------|------|
| `POST` | `/api/quote/projects` | **`quote.sales`** or admin | 建立專案(body 需 `pm_user_id`,必須是 `quote.pm`);自動建群組 |
| `GET` | `/api/quote/projects` | any(VPD 過濾) | 列表;`?status=&bu=&priority=&q=&mine=sales\|pm\|member` |
| `GET` | `/api/quote/projects/:id` | sales / pm / member / director(BU) / admin | 回傳專案 + 群聊 + tasks;**價格欄位依 `canViewPrice` 回完整或 tier** |
| `PATCH` | `/api/quote/projects/:id` | sales / pm / admin | 更新欄位(status / priority / candidate_factories…)|
| `PATCH` | `/api/quote/projects/:id/transfer-pm` | **only sales** or admin | 換 PM,body `new_pm_user_id` |
| `POST` | `/api/quote/projects/:id/close` | sales / pm / admin | 觸發結案 Pipeline(§6) |

### 4.2 成員管理

> 業務 + PM **共同**管理成員,任一方都能加 / 踢;admin 可覆寫。

| Method | Path | 權限 | 說明 |
|--------|------|------|------|
| `POST` | `/api/quote/projects/:id/members` | sales / pm / admin | 用 email 邀請;role 只能是 MEMBER / OBSERVER |
| `DELETE` | `/api/quote/projects/:id/members/:userId` | sales / pm / admin | 軟刪(`left_at`);不能踢 sales_user_id / pm_user_id |
| `PATCH` | `/api/quote/projects/:id/members/:userId/permissions` | sales / pm / admin | 改 `can_view_price` / `can_export` |
| `GET` | `/api/quote/projects/:id/members` | 專案可讀者 | 含 sales + pm + 所有未離開的 members |

### 4.3 Global Role 管理(admin 專用)

| Method | Path | 權限 | 說明 |
|--------|------|------|------|
| `GET` | `/api/quote/admin/user-roles` | admin | 列出所有授予 |
| `POST` | `/api/quote/admin/user-roles` | admin | 授予 `quote.sales` / `quote.pm` / `quote.director` / `quote.finance_reviewer` |
| `DELETE` | `/api/quote/admin/user-roles/:id` | admin | 撤銷(設 `effective_to=now`)|
| `GET` | `/api/quote/users/search?q=email` | sales / pm | 搜 users(建立專案選 PM / 邀請成員用),回 {id, mail, displayName, dept}|

### 4.3.1 待指派專案處理(admin 專用)

| Method | Path | 權限 | 說明 |
|--------|------|------|------|
| `GET` | `/api/quote/admin/pending-reassign` | admin | 列出 `pending_reassign IS NOT NULL` 的專案,含 pending 天數、原業務/PM、BU |
| `POST` | `/api/quote/admin/projects/:id/reassign-sales` | admin | body `{new_sales_user_id, reason}`;驗新人有 `quote.sales` role;`UPDATE sales_user_id`;若 `pending='SALES'` 改 NULL、`='BOTH'` 改 `'PM'`;寫 audit |
| `POST` | `/api/quote/admin/projects/:id/reassign-pm` | admin | 同上針對 PM(驗 `quote.pm`);清 `PM` / `BOTH→SALES` |
| `POST` | `/api/quote/admin/projects/:id/force-unlock` | admin | 緊急:不指派直接解鎖(例:離職者短期回任),需填 reason,audit 特別標記 |

**Reassign 完成 side effect**:
```sql
UPDATE quote_projects
SET pending_reassign = :new_pending,
    pending_reason = CASE WHEN :new_pending IS NULL THEN NULL ELSE pending_reason END,
    pending_since  = CASE WHEN :new_pending IS NULL THEN NULL ELSE pending_since END,
    -- ★ 只有完全解鎖(NULL)時才延展 SLA
    sla_due_at     = CASE WHEN :new_pending IS NULL AND sla_paused_at IS NOT NULL
                          THEN sla_due_at + (SYSTIMESTAMP - sla_paused_at)
                          ELSE sla_due_at END,
    sla_paused_at  = CASE WHEN :new_pending IS NULL THEN NULL ELSE sla_paused_at END,
    updated_at     = SYSTIMESTAMP
WHERE id = :id;
```

> ⚠ `BOTH → SALES` 或 `BOTH → PM` 時 SLA 不恢復(還在鎖中);只有最後一個 reassign 完成才解凍。

### 4.4 任務

| Method | Path | 權限 | 說明 |
|--------|------|------|------|
| `GET` | `/api/quote/task-templates` | 可讀者 | 列 active template(§14.2) |
| `POST` | `/api/quote/projects/:id/tasks` | sales / pm | 建主任務,可指定 `template_id` 自動帶出子任務 |
| `PATCH` | `/api/quote/tasks/:taskId` | 負責人 OR sales OR pm | 更新 title / due_date / status;`status=DONE` 時 **`completion_note` ≥ 10 字必填**,附件 optional;`status=DELAY` 時 `delay_reason` 必填 |
| `DELETE` | `/api/quote/tasks/:taskId` | 負責人 OR sales OR pm | 刪子任務(主任務僅 sales/pm 可刪) |
| `POST` | `/api/quote/tasks/:taskId/subtasks` | 負責人 OR sales OR pm | 新增子任務到指定主任務(負責人可自行擴充 template) |
| `POST` | `/api/quote/admin/task-templates` | admin | 新增 / 編輯 template |

### 4.5 核算引擎

| Method | Path | 權限 | 說明 |
|--------|------|------|------|
| `POST` | `/api/quote/projects/:id/costing/run` | 可讀者 | 觸發 Skill DAG(§5),SSE 串回 |
| `GET` | `/api/quote/projects/:id/costing` | 可讀者(`canViewPrice=false` 回 tier)| 取最新核算版本 |
| `POST` | `/api/quote/projects/:id/costing/export` | `canExport=true` | 產生 Excel,**含浮水印**,稽核 |

### 4.6 戰情室

| Method | Path | 權限 | 說明 |
|--------|------|------|------|
| `GET` | `/api/quote/dashboard/overview` | `quote.director`(限綁的 BU) | SLA 燈號 / 贏單率 / Delay 熱點 / 該 BU 全專案 |
| `GET` | `/api/quote/dashboard/my-projects` | any | 我的專案(sales / pm / member 三類)|
| `GET` | `/api/quote/dashboard/my-watch` | any | 我的關注清單(手動訂閱)|

### 4.7 KB 查詢

| Method | Path | 權限 | 說明 |
|--------|------|------|------|
| `POST` | `/api/quote/kb/search` | any | 搜 `quote-cases-public` |
| `POST` | `/api/quote/kb/search?internal=1` | `quote.director` OR 該案成員(含 sales/pm)OR admin | 搜 internal,回完整 |

---

## 5. 報價核算 Skill DAG

以 Cortex Skill(Workflow 類型)實作,`skill.code = 'quote_costing_v1'`。

```
┌─────────────────────┐
│ IN: { project_id,   │
│       factory_code, │
│       part_number,  │
│       quantity }    │
└──────────┬──────────┘
           ▼
┌──────────────────────────┐
│ N1: ERP BOM 展開          │
│   call erp_bom_explode    │
│   (Oracle Procedure)      │
│ OUT: bom_tree (CLOB JSON) │
└──────────┬───────────────┘
           ▼
┌──────────────────────────┐
│ N2: 新成本詢價 (MCP/API)  │
│   for each bom leaf →     │
│     cost-inquiry.get_price│
│ OUT: price_map            │
└──────────┬───────────────┘
           ▼
┌──────────────────────────┐
│ N3: 料工費公式 (Code Node)│
│   material = Σ(qty×price) │
│   labor = hours × rate    │
│   overhead = material ×   │
│              oh_rate      │
│ OUT: cost_components      │
└──────────┬───────────────┘
           ▼
┌──────────────────────────┐
│ N4: 廠區對照              │
│   call quote_factory_cost │
│   _master for factory_code│
│   apply yield / fx        │
│ OUT: factory_cost         │
└──────────┬───────────────┘
           ▼
┌──────────────────────────┐
│ N5: 策略 LLM              │
│   context = factory_cost  │
│           + customer_hist │
│           + competitor_kb │
│   prompt → GPT/Gemini     │
│ OUT: strategy {激進|守價| │
│                放棄}      │
└──────────┬───────────────┘
           ▼
┌──────────────────────────┐
│ N6: 寫回 quote_cost_      │
│     breakdowns (version+1)│
│     欄位級加密             │
│ OUT: breakdown_id         │
└──────────┬───────────────┘
           ▼
┌──────────────────────────┐
│ N7: 產 Excel 範本         │
│   pptxgenjs/xlsx →        │
│   報價單_{customer}_{pn}_ │
│   {date}.xlsx             │
│   **浮水印**: 姓名/工號/時戳│
└──────────────────────────┘
```

節點 I/O schema 用 JSON Schema 定義,每個節點錯誤 → mark task DELAY + 發群聊。

---

## 6. 結案脫敏 Pipeline

`POST /api/quote/projects/:id/close` 觸發(SSE stream 回進度):

```
┌────────────────────────────────────────────────┐
│ Step 1: 抽取                                    │
│   - 專案欄位、cost_breakdowns、tasks           │
│   - 群聊訊息(ticket_messages WHERE room...)   │
│   - 附件 metadata                               │
└──────────┬─────────────────────────────────────┘
           ▼
┌────────────────────────────────────────────────┐
│ Step 2: LLM 結構化摘要                          │
│   prompt: 產 "關鍵決策 / 卡關原因 / 解法 / 贏輸│
│            單原因" 四段                         │
│   model: gemini-3.1-pro-preview (長脈絡)       │
└──────────┬─────────────────────────────────────┘
           ▼
┌────────────────────────────────────────────────┐
│ Step 3: 脫敏(2-pass)                         │
│   Pass A: regex + NER                          │
│     - 客戶名 → alias_code                       │
│     - 金額 → 區間帶(< 100萬 / 100-500萬 / ..)  │
│     - 單價 → 去除                               │
│     - 毛利率 → "高/中/低" 三檔                 │
│   Pass B: LLM 二次檢核                          │
│     "檢查下列文字是否仍有具體金額/客戶名"      │
└──────────┬─────────────────────────────────────┘
           ▼
┌────────────────────────────────────────────────┐
│ Step 4: Human-in-loop                          │
│   → PM + 業務主管 approve(內部 /quote/pending) │
│   → 重要案(strategic customer)+ 法務 approve   │
└──────────┬─────────────────────────────────────┘
           ▼
┌────────────────────────────────────────────────┐
│ Step 5: 雙寫 KB                                 │
│   - 完整版 → quote-cases-internal              │
│     (tags: bu, factory, customer_real)         │
│   - 脫敏版 → quote-cases-public                 │
│     (tags: bu, factory, alias_code)            │
│   - chunks 向量化,embed 前**金額再過一次**    │
│     (避免向量語意 leak)                        │
└──────────┬─────────────────────────────────────┘
           ▼
┌────────────────────────────────────────────────┐
│ Step 6: 寫稽核                                  │
│   REDACT_PUBLISH 事件                           │
└────────────────────────────────────────────────┘
```

### 6.2 脫敏閾值初步建議(**待財務/法務/業務 review**)

#### 6.2.1 金額 tier(USD,年度總值)

| Tier | 範圍 | 代稱 | 意義 |
|------|------|------|------|
| XS | < 50K | Tier-XS | 試樣 / 小量 |
| S | 50K – 200K | Tier-S | 小客戶 / 小項目 |
| A | 200K – 1M | Tier-A | 一般量產 |
| B | 1M – 5M | Tier-B | 主力客戶項目 |
| C | 5M – 20M | Tier-C | 戰略案 |
| D | > 20M | Tier-D | 超大案 |

**依據**:消費電子報價案平均落在 200K–2M,這粒度讓 public KB 檢索可辨識「同量級歷史案」但看不出具體金額。

#### 6.2.2 毛利率 tier

| Tier | 範圍 | 代稱 |
|------|------|------|
| Loss | < 0% | 🔴 Loss-making |
| Thin | 0 – 5% | Tier-T |
| Low | 5 – 10% | Tier-L |
| Mid | 10 – 18% | Tier-M |
| High | 18 – 30% | Tier-H |
| Premium | > 30% | Tier-P |

**依據**:10% 為連接器業損益平衡線,18% 以上為健康接單,30% 以上屬異常值(可能 NRE 補貼 / 單次特殊案)。

#### 6.2.3 客戶代號

```
Strategic 客戶(前 20 大,業務定):
  固定 mapping A001 – A020,存 quote_customer_aliases,僅 admin 可查

一般客戶:
  C-{base32(hmac_sha256(customer_id, salt))[:6]}
  穩定 mapping 但無法逆推,例:C-7K3M9P

高敏客戶(黑名單 + 競品母集團):
  特殊 flag,public KB 完全不入;僅 internal KB 留紀錄
```

#### 6.2.4 料號

```
通用料號(標準品): 保留完整,例 FL-USBC-0042

客戶專用料號(含客戶前綴):脫敏
  APPLE-X100-FL → FL-X-{hash}
  SAMSUNG-G24 → FL-G-{hash}
  regex match /^([A-Z]{3,})-/,前綴若在客戶詞庫則替換
```

#### 6.2.5 數量 tier(僅 public KB)

| 範圍 | 代稱 |
|------|------|
| < 10K | Small-batch |
| 10K – 100K | Medium-batch |
| 100K – 1M | Volume |
| 1M – 10M | High-volume |
| > 10M | Mega |

**依據**:極端數量 + 特殊規格能反推客戶(例 500 萬片 + 車用認證 = 某車廠專案),必須 bucketize。

#### 6.2.6 時間(public KB)

```
2026-03-15 → 2026-Q1    (到季)
2025-12     → 2025-Q4
避免「同季度反推同期競標」
internal KB 保留完整時間
```

#### 6.2.7 必保留的 metadata(知識價值所在)

```
廠區決策: CN | IN | VN(保留)

風險分類:
  SUPPLY_CHAIN | FX_VOLATILE | TARIFF_SENSITIVE |
  YIELD_RISK | SPEC_CHANGE | COMPLIANCE | NRE_HEAVY

贏輸原因分類(不含具體金額):
  PRICE_COMPETITIVE | PRICE_UNCOMPETITIVE |
  LEAD_TIME | CAPABILITY_MATCH | RELATIONSHIP |
  QUALITY_CERT | PAYMENT_TERMS
```

---

## 7. 資料安全(Defense-in-Depth)

> **這是本文件重點**。報價資料(成本、毛利、合約價)是 Foxlink 最敏感商業資訊之一。單靠 UI 隔離不夠,必須 6 層。

### 7.1 L0 — 網路層

| 項目 | 配置 |
|------|------|
| 入口 | **`quote.foxlink.com.tw`** 獨立 hostname(Option C,§1.2.1);Nginx 雙 server block 都 proxy 到同一 cortex-app upstream |
| Cookie domain | 分離 — `Domain=quote.foxlink.com.tw`,與 `cortex.foxlink.com.tw` cookie 互不相通 |
| IP 白名單 | 內網 CIDR + 授權 VPN pool,**在 `quote.*` server block 額外加嚴**(主站可能較寬鬆) |
| WAF | 各自設 rule;`quote.*` 設更嚴 rate limit(login 3/min, API 60/min) |
| CSP | `quote.*` 設嚴格 CSP,禁止 `unsafe-inline`;主站可較寬鬆 |
| MCP 對外連線 | mTLS(新成本詢價系統)+ User Identity JWT(`X-User-Token`) |
| 後端互打 | service mesh 內網(K8s NetworkPolicy 只允許 cortex-app ↔ oracle-db / redis / mcp) |

**Nginx / Ingress 雙 server block 範例**:

```nginx
# 主站
server {
  server_name cortex.foxlink.com.tw;
  listen 443 ssl http2;

  location / {
    proxy_pass http://cortex-app:3007;
    proxy_set_header Host $host;
    proxy_set_header X-Portal cortex;
    proxy_set_header X-Real-IP $remote_addr;
  }
}

# 報價站(同一後端,不同安全配置)
server {
  server_name quote.foxlink.com.tw;
  listen 443 ssl http2;

  # ★ 額外 IP 白名單(比主站嚴)
  allow 10.0.0.0/8;       # 內網
  allow 192.168.50.0/24;  # 授權 VPN pool
  deny all;

  # ★ 嚴格 rate limit
  limit_req zone=quote_api burst=20 nodelay;

  # ★ 嚴格 CSP / HSTS
  add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss://quote.foxlink.com.tw;";
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";
  add_header X-Frame-Options "DENY";

  location / {
    proxy_pass http://cortex-app:3007;
    proxy_set_header Host $host;
    proxy_set_header X-Portal quote;       # ★ 後端依此切 aud 簽發邏輯
    proxy_set_header X-Real-IP $remote_addr;

    # SSE 長連線
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_read_timeout 3600s;
  }
}

# Rate limit zone(http block)
limit_req_zone $binary_remote_addr zone=quote_api:10m rate=60r/m;
```

**K8s Ingress 同理**:兩個 Ingress 物件指向同一 Service,`quote.*` 的 Ingress 加 annotations `nginx.ingress.kubernetes.io/whitelist-source-range` 等。

**K8s NetworkPolicy 範例**:
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: quote-api-egress }
spec:
  podSelector: { matchLabels: { app: cortex, module: quote } }
  policyTypes: [Egress]
  egress:
    - to: [{ podSelector: { matchLabels: { app: oracle-db } } }]
      ports: [{ port: 1521 }]
    - to: [{ podSelector: { matchLabels: { app: redis } } }]
      ports: [{ port: 6379 }]
    - to: [{ namespaceSelector: { matchLabels: { name: mcp-servers } } }]
```

### 7.2 L1 — 身份驗證

| 項目 | 配置 |
|------|------|
| SSO | 沿用現有 LDAP / AD |
| Token | 獨立 JWT `aud=quote`,**由 hostname 驅動簽發**(見 §7.2.1);一般 Cortex token 不通 |
| Session | Redis key `quote:sess:*`,TTL **15 min idle / 4h absolute**(比一般 Cortex session 嚴) |
| **Step-up 2FA** | 進入專案詳情頁 / 查看價格欄位 / 下載檔案 時,前端檢查 `last_2fa_at < 10 min` 則推 TOTP 或 Webex push,簽出 `elevated` claim TTL 10 min |
| Device fingerprint | FingerprintJS → bind session;異裝置登入推通知 |
| 失敗鎖定 | 5 次失敗 → 15 min lock;10 次 → admin unlock |

#### 7.2.1 Portal detection + hostname 驅動 aud 簽發

**後端中間件**(`server/middleware/portalDetector.js`):

```js
// 在 Express app 最前面掛這個
function portalDetector(req, res, next) {
  // Nginx set X-Portal header(信任內網 proxy)
  const portalHeader = req.get('X-Portal');
  const host = (req.hostname || '').toLowerCase();

  if (portalHeader === 'quote' || host.startsWith('quote.')) {
    req.portal = 'quote';
  } else {
    req.portal = 'cortex';
  }
  next();
}
```

**Login endpoint 根據 portal 簽發**(`server/routes/auth.js`):

```js
app.post('/api/auth/login', portalDetector, async (req, res) => {
  const user = await verifySSO(req.body);

  if (req.portal === 'quote') {
    // ★ 報價入口必須有任一 quote.* role 才能登入
    const roles = await loadQuoteRoles(user.id);
    if (roles.length === 0 && !await isProjectMemberAnywhere(user.id)) {
      return res.status(403).json({
        error: 'NO_QUOTE_ACCESS',
        message: '您沒有報價系統權限,請聯絡系統管理員',
      });
    }

    const token = signJwt({
      sub: user.id,
      aud: 'quote',              // ★ hostname 驅動
      roles,
      director_bus: await loadDirectorBus(user.id),
      iss: 'cortex.foxlink.com.tw',
    }, { expiresIn: '4h' });

    res.cookie('quote_token', token, {
      domain: 'quote.foxlink.com.tw',  // ★ cookie 僅此 hostname
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 4 * 3600 * 1000,
    });
    return res.json({ ok: true });
  }

  // 一般 Cortex 登入(aud=cortex)
  const token = signJwt({ sub: user.id, aud: 'cortex' }, { expiresIn: '12h' });
  res.cookie('cortex_token', token, { domain: 'cortex.foxlink.com.tw', ... });
  res.json({ ok: true });
});
```

**驗證 middleware**(`verifyQuoteToken`):

```js
function verifyQuoteToken(req, res, next) {
  const token = req.cookies.quote_token;
  if (!token) return res.status(401).json({ error: 'NO_TOKEN' });

  try {
    const claims = jwt.verify(token, PUB_KEY, { audience: 'quote' });
    //                                         ^^^^^^^^^^^^^^^^^^
    //                      ★ 一般 cortex token 會因 aud 不符被拒
    req.user = claims;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}
```

#### 7.2.2 Step-up middleware

```js
function requireElevated(req, res, next) {
  const claims = req.user;
  if (!claims.elevated || claims.elevated_until < Date.now()) {
    return res.status(403).json({
      error: 'STEP_UP_REQUIRED',
      challenge: 'totp_or_webex_push',
    });
  }
  audit(req, 'STEP_UP_VERIFIED');
  next();
}

// 用法
app.get('/api/quote/projects/:id/costing',
  portalDetector,      // ★ 永遠第一個
  verifyQuoteToken,    // aud=quote 驗證
  quoteACL,            // ACL
  requireElevated,     // Step-up 2FA
  handler,
);
```

#### 7.2.3 前端 Portal detection

```tsx
// client/src/App.tsx
function App() {
  const portal = detectPortal(window.location.hostname);
  // portal === 'quote' | 'cortex'

  return (
    <AuthProvider portal={portal}>
      <I18nProvider>
        <ThemeProvider variant={portal === 'quote' ? 'quote' : 'default'}>
          {portal === 'quote' ? <QuoteApp /> : <CortexApp />}
        </ThemeProvider>
      </I18nProvider>
    </AuthProvider>
  );
}

function detectPortal(hostname: string): 'quote' | 'cortex' {
  if (hostname.startsWith('quote.')) return 'quote';
  if (hostname === 'localhost' && window.location.search.includes('portal=quote')) {
    return 'quote';  // 本地開發用 ?portal=quote 切換
  }
  return 'cortex';
}
```

**本地開發約定**:`npm run dev` 預設跑 cortex。切報價加 query string `?portal=quote`,或改 `/etc/hosts` 把 `quote.localhost` 指到 127.0.0.1。

### 7.3 L2 — 授權(ABAC + VPD 雙層)

#### 7.3.0 授權模型(admin 手動 global role + 業務/PM email 拉人)

**修訂說明(v0.3.2)**:
- 業務(Sales)是專案**發起人**,建立專案時指派 PM。
- 業務 + PM **共同**擁有成員管理權(邀請 / 踢除 / 改金額權限 / 結案)。
- 業務 / PM 身分由 **Cortex admin 手動授予 global role**(`quote.sales` / `quote.pm`)。
- 高階主管(`quote.director`)可看 **權限內所有專案** 的完整流程 + 價格。
- LDAP 只同步 mail / displayName / department / enabled,**不**看 title。

```
┌────────────────────────────────────────────────────────────┐
│ 權限結構(兩層)                                              │
│                                                              │
│ 第一層:Global Role(admin 手動授予,存 quote_user_roles)    │
│   quote.sales            ← 業務:能建專案、管專案成員、結案    │
│   quote.pm               ← PM:被業務指派後,管成員、結案     │
│   quote.director         ← 高階主管:看權限內所有專案(綁 BU)│
│   quote.finance_reviewer ← 財務:維護廠區費用主檔             │
│   quote.admin            ← 管理員:配置所有表 + 授 role        │
│   (一般使用者無 global role,只能被邀請成為成員)            │
│                                                              │
│ 第二層:Project Membership(業務/PM 用 email 邀請)            │
│   業務或 PM 任一方都能加/踢成員                              │
│   → 從 users 表以 mail 找人 → INSERT quote_project_members   │
│   → role: MEMBER|OBSERVER(SALES/PM 不進這表,存 projects 欄位)│
│   → 勾選: can_view_price / can_export                        │
│                                                              │
│ ※ can_view_price 是 per-project 旗標,由 Sales/PM 決定        │
│   同一業務 Amy 在 A 案可被賦予看價格、在 B 案可能只看 tier    │
└────────────────────────────────────────────────────────────┘
```

**Schema**:

```sql
-- Global role(admin 手動管理)
CREATE TABLE quote_user_roles (
  id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         NUMBER NOT NULL,
  role_name       VARCHAR2(30) NOT NULL,
    -- quote.sales|quote.pm|quote.director|quote.finance_reviewer|quote.admin
  bu_id           NUMBER,                      -- 僅 director 用(綁事業處,可多筆綁多 BU)
  effective_from  TIMESTAMP DEFAULT SYSTIMESTAMP,
  effective_to    TIMESTAMP,                   -- NULL = 無期限
  granted_by      NUMBER NOT NULL,
  reason          VARCHAR2(500),
  created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);
CREATE INDEX idx_qur_user ON quote_user_roles(user_id, role_name)
  WHERE effective_to IS NULL OR effective_to > SYSTIMESTAMP;

-- 同一 user 可持多 role(例:業務主管同時有 quote.sales + quote.director)
-- director 可綁多 BU → 多筆(user_id, role='quote.director', bu_id=...)

-- 部門 → BU 對應(LDAP dept 顯示用,admin 維護)
-- ※ 不再 drive role,僅用於:① 使用者頁籤顯示「所屬事業處」
--                           ② director 授權時選 bu_id 的 dropdown
CREATE TABLE quote_dept_to_bu (
  dept_code       VARCHAR2(50) PRIMARY KEY,
  dept_name_zh    VARCHAR2(100),
  bu_id           NUMBER NOT NULL,
  effective_from  DATE DEFAULT SYSDATE,
  effective_to    DATE
);
```

**LDAP 同步範圍大幅縮小**:

- ✅ 同步 `mail` / `displayName` / `department`(顯示用)
- ✅ 同步 `enabled`(離職禁用 → 撤 token + 從 active 專案移除)
- ❌ 不看 `title`(業務決策:不用 title 決定權限)
- ❌ 不看 `memberOf`(Distribution Group 變動慢)

**Login 流程**:
```
1. SSO 驗證成功 → 查 users 表
2. LOAD quote_user_roles WHERE user_id=? AND (effective_to IS NULL OR effective_to > NOW)
3. 組 JWT claims:
   {
     sub, mail, dept, bu_id,              // dept_to_bu 查出
     roles: ['quote.sales','quote.pm'],   // 多個 role 可共存
     director_bus: [3,7,12]               // quote.director 綁的 bu_id 陣列
   }
4. 無 global role 者 = 一般使用者,靠 quote_project_members 取得實際權限
```

**建立專案 API**(只有 `quote.sales` 能打):
```
POST /api/quote/projects
{
  "customer_id": 42,
  "product_name": "Type-C 連接器",
  "part_number": "FL-USBC-0042",
  "quantity": 500000,
  "delivery_date": "2026-06-15",
  "priority": "HIGH",
  "candidate_factories": "CN,VN",
  "pm_user_id": 12345,            // ★ 業務指派 PM(必填,必須是有 quote.pm 的人)
  "business_unit_id": 3
}

後端驗證:
  → req.user.roles.includes('quote.sales')  否則 403
  → SELECT 1 FROM quote_user_roles
    WHERE user_id=:pm_user_id AND role_name='quote.pm' AND (effective_to IS NULL OR ...)
  → 否則回 400 "指派的 PM 沒有 quote.pm 權限"
  → INSERT quote_projects (sales_user_id=req.user.id, pm_user_id, ...)
  → 自動建群聊 room(room_type='quote_project', room_id=new_id)
  → 寫 quote_audit_log CREATE_PROJECT
```

**邀請成員 API**(Sales 或 PM 都能打):
```
POST /api/quote/projects/:id/members
{
  "email": "amy.wang@foxlink.com",
  "role": "MEMBER",              // MEMBER|OBSERVER(SALES/PM 不在此授予)
  "can_view_price": true,        // 預設 false
  "can_export": false
}

後端驗證:
  → req.user.id IN (project.sales_user_id, project.pm_user_id)  OR  isAdmin
  → SELECT user_id FROM users WHERE mail=:email AND enabled=1
  → 找不到 → 回 "email 不存在或已離職"
  → INSERT quote_project_members (..., joined_by=req.user.id)
  → 寫 quote_audit_log ACL_CHANGE
  → WebSocket 通知成員加入群組
```

**踢成員 API**(Sales 或 PM 都能打):
```
DELETE /api/quote/projects/:id/members/:userId

後端驗證:
  → req.user.id IN (project.sales_user_id, project.pm_user_id)  OR  isAdmin
  → 不能踢 sales_user_id 本人
  → 不能踢 pm_user_id(若要換 PM → 走 transfer-pm API)
  → UPDATE quote_project_members SET left_at=SYSTIMESTAMP WHERE project_id=? AND user_id=?
  → 寫 audit
```

**換 PM API**(只有 Sales 能打):
```
PATCH /api/quote/projects/:id/transfer-pm
{ "new_pm_user_id": 67890 }

後端驗證:
  → req.user.id == project.sales_user_id  OR  isAdmin
  → 新 PM 必須有 quote.pm role
  → UPDATE quote_projects SET pm_user_id=?, updated_at=SYSTIMESTAMP
  → 寫 audit TRANSFER_PM {from, to}
  → WebSocket 通知新舊 PM
```

#### 7.3.1 角色定義 + 權限 Matrix

| 角色 | 授予方 | 範圍 | 核心權限 |
|------|--------|------|----------|
| (無 global role) | — | — | 僅能看到被邀請的專案(受 can_view_price 限制)|
| `quote.sales` | admin | global | 建專案 + 指派 PM + 管成員 + 結案 |
| `quote.pm` | admin | global | 被業務指派後,管成員 + 結案 |
| `quote.director` | admin | 綁 bu_id(可多) | 看權限內所有專案(流程 + 價格 + 跨專案儀表板)|
| `quote.finance_reviewer` | admin | global | 廠區費用主檔 CRUD |
| `quote.admin` | 原 Cortex admin | global | 所有配置 + 授予 global role |

**權限 Matrix(操作 × 角色)**:

| 操作 | Sales | PM(該案) | Member+price | Member | Observer | Director(該 BU) | Admin |
|------|-------|-----------|--------------|--------|----------|-------------------|-------|
| 列表查看專案 | 自己建的 | 自己被指派的 | 被邀請的 | 被邀請的 | 被邀請的 | **該 BU 全部** | 全部 |
| 建立專案 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 指派 / 更換 PM | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 邀請成員 | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 踢除成員 | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 改成員金額權限 | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 看金額完整值 | ✅ | ✅ | ✅ | ❌(看 tier)| ❌(看 tier) | ✅ | ✅ |
| 觸發成本核算 | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| 匯出 Excel/PDF | ✅ | ✅ | can_export | can_export | ❌ | ✅(帶浮水印)| ✅ |
| 改狀態 | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 結案 | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 看戰情儀表板 | 只本人 | 只本人 | ❌ | ❌ | ❌ | **該 BU 全部** | 全部 |
| 看 internal KB | 結案後 | 結案後 | 結案後 | 結案後 | 結案後 | ✅ 全時 | ✅ |

**關鍵設計理由**:

1. **業務是專案 owner,PM 是執行 owner**:業務擁有接案決定權 → 能換 PM;PM 不能換業務(否則業務的績效追蹤會斷)。
2. **業務+PM 共同管成員**:實務上 PM 可能忙於核算,業務臨時要加工程同仁進來討論 — 不應卡 PM。稽核時 `joined_by` 能追。
3. **Director 全時能看 internal KB**:高階主管要做跨案分析(贏單率、競品對標),不應等結案才能看。這是他們的管理工具。
4. **Director 不能改專案**:只讀,避免管理層越級指揮破壞 SLA 責任鏈。要介入就正式加入為成員。
5. **Member 預設看 tier 代稱**:Amy 被拉進來討論交期不代表要看成本,`can_view_price=1` 必須由 Sales/PM 明確勾選。
6. **離職處理**(v0.3.3 完整版,詳見 §3.2):LDAP `enabled=0` → 離職 job 一次做完:
   - 撤所有 active quote tokens
   - `quote_user_roles.effective_to = SYSTIMESTAMP`
   - `quote_project_members.left_at = SYSTIMESTAMP`(該人被邀請的所有案)
   - **若離職者是某專案 sales/pm** → 該專案進入 `pending_reassign`(SALES/PM/BOTH),**SLA 暫停**、專案鎖唯讀
   - 通知 admin + 該 BU director + 該案所有成員
   - admin 於 `/quote/admin/pending-reassign` 頁手動指派新人選,reassign 完成後自動解鎖 + SLA 延展(§4.3.1)

#### 7.3.2 Application-layer ACL(主防線)

```js
// server/middleware/quoteACL.js
async function quoteACL(req, res, next) {
  const projectId = req.params.id || req.body.project_id;
  const { userId, roles, director_bus } = req.user;
  // roles 來自 quote_user_roles,director_bus = quote.director 綁的 bu_id 陣列

  const project = await db.one(
    `SELECT id, sales_user_id, pm_user_id, business_unit_id, status,
            pending_reassign, pending_since, sla_paused_at
     FROM quote_projects WHERE id=:id`,
    { id: projectId },
  );
  const member = await db.oneOrNone(
    `SELECT * FROM quote_project_members
     WHERE project_id=:p AND user_id=:u AND left_at IS NULL`,
    { p: projectId, u: userId },
  );

  // 4 種進入管道
  const isSales = project.sales_user_id === userId;
  const isPm = project.pm_user_id === userId;
  const isMember = !!member;
  const isDirector = (director_bus || []).includes(project.business_unit_id);
  const isAdmin = roles.includes('quote.admin');

  if (!isSales && !isPm && !isMember && !isDirector && !isAdmin) {
    audit(req, 'FAILED_ACCESS', { project_id: projectId });
    return res.status(403).json({ error: 'NOT_AUTHORIZED' });
  }

  // 是否「專案管理者」(業務 / PM / admin)
  const isManager = isSales || isPm || isAdmin;

  // ★ pending_reassign 期間:除 admin 外全部鎖唯讀
  const isLocked = !!project.pending_reassign && !isAdmin;

  req.quoteCtx = {
    project,
    member,
    isSales, isPm, isMember, isDirector, isAdmin, isManager, isLocked,
    // 金額權限:管理者 + Director 一律可看;Member 看 can_view_price
    canViewPrice: isManager || isDirector || (member?.can_view_price === 1),
    canExport:    isManager || isDirector || (member?.can_export === 1),
    // ★ 以下寫入類權限,pending 期間全部強制 false(admin 例外)
    canClose:         !isLocked && isManager,
    canManageMembers: !isLocked && isManager,
    canTransferPm:    !isLocked && (isSales || isAdmin),
    canEdit:          !isLocked && isManager,
    canRunCosting:    !isLocked,
  };
  next();
}
```

#### 7.3.3 DB-layer VPD(Secondary defense)

> 即使 app 層 bypass(SQL injection / direct DB 連線),DB 也擋得住。

```sql
CREATE OR REPLACE FUNCTION fn_quote_vpd_policy(
  p_schema  IN VARCHAR2,
  p_object  IN VARCHAR2
) RETURN VARCHAR2 AS
  v_user_id      NUMBER := SYS_CONTEXT('QUOTE_CTX', 'USER_ID');
  v_director_bus VARCHAR2(500) := SYS_CONTEXT('QUOTE_CTX', 'DIRECTOR_BUS'); -- CSV,例 '3,7,12'
  v_is_adm       VARCHAR2(1)   := SYS_CONTEXT('QUOTE_CTX', 'IS_ADMIN');
BEGIN
  IF v_is_adm = 'Y' THEN RETURN '1=1'; END IF;
  -- 四種進入條件 OR:
  --   1. sales_user_id = 我
  --   2. pm_user_id = 我
  --   3. 我在 quote_project_members(且未離開)
  --   4. director 綁的 bu 命中 project.business_unit_id
  DECLARE
    v_base VARCHAR2(2000);
  BEGIN
    v_base := 'sales_user_id = ' || v_user_id ||
              ' OR pm_user_id = ' || v_user_id ||
              ' OR id IN (SELECT project_id FROM quote_project_members ' ||
                         'WHERE user_id = ' || v_user_id || ' AND left_at IS NULL)';
    IF v_director_bus IS NOT NULL THEN
      v_base := v_base || ' OR business_unit_id IN (' || v_director_bus || ')';
    END IF;
    RETURN v_base;
  END;
END;
/

BEGIN
  DBMS_RLS.ADD_POLICY(
    object_schema   => 'FOXLINK',
    object_name     => 'QUOTE_PROJECTS',
    policy_name     => 'QP_VPD',
    function_schema => 'FOXLINK',
    policy_function => 'fn_quote_vpd_policy',
    statement_types => 'SELECT,UPDATE,DELETE'
  );
END;
/
```

> ⚠ 注意:`v_director_bus` 是 CSV 塞進 SQL,**所有 bu_id 必須是數字**(app 層 parseInt 驗證過後才 set context),否則是 SQL injection 風險。

**App 連線 pool 初始化時 set context**(connection tag):
```js
// server/services/oracle/quoteContextInitializer.js
async function initQuoteContext(conn, user) {
  // director_bus: 從 quote_user_roles WHERE role='quote.director' AND effective_to IS NULL 查出的 bu_id 陣列
  const directorBusCsv = (user.director_bus || [])
    .map(Number)
    .filter(Number.isInteger)   // 防 SQL injection
    .join(',') || null;

  await conn.execute(
    `BEGIN
       DBMS_SESSION.SET_CONTEXT('QUOTE_CTX', 'USER_ID', :u);
       DBMS_SESSION.SET_CONTEXT('QUOTE_CTX', 'DIRECTOR_BUS', :db);
       DBMS_SESSION.SET_CONTEXT('QUOTE_CTX', 'IS_ADMIN', :adm);
     END;`,
    {
      u: user.id,
      db: directorBusCsv,
      adm: user.roles.includes('quote.admin') ? 'Y' : 'N',
    },
  );
}
```

#### 7.3.4 欄位級(價格類)

- **App 層**:serializer 判斷 `canViewPrice`;false 則 `final_quote_amount` 回區間代稱
- **DB 層**(選配):VPD `sec_relevant_cols` 對 `final_quote_amount_enc` 設 policy,無權限回 NULL

```js
// server/services/quote/projectSerializer.js
function serializeProject(p, ctx) {
  const base = { id: p.id, code: p.project_code, customer: p.customer_id, ... };
  if (ctx.canViewPrice) {
    base.final_quote_amount = decryptAmount(p.final_quote_amount_enc);
    base.final_margin_rate = decryptRate(p.final_margin_rate_enc);
  } else {
    base.final_quote_amount_tier = bucketize(decryptAmount(p.final_quote_amount_enc));
    base.final_margin_rate_tier = bucketizeRate(decryptRate(p.final_margin_rate_enc));
  }
  return base;
}
```

### 7.4 L3 — 資料保護(加密)

**混合策略**:App-level AES-GCM BLOB(金額) + Oracle TDE 表空間(其他)。只對真的最敏感金額欄位做 app-level,避免效能損耗擴散到全表。

#### 7.4.0 加密方法對比

| 面向 | App-level AES BLOB | Oracle TDE Column | Oracle TDE Tablespace |
|------|--------------------|--------------------|----------------------|
| 擋 DBA 看到明文 | ✅ | ❌ | ❌ |
| 效能 | 慢 5-15% | 原生快 | 幾乎無損 |
| SQL WHERE/ORDER | ❌ 需先 decrypt | ✅ 透明 | ✅ 透明 |
| per-row key | ✅ | ❌ | ❌ |
| 撤銷特定 project | ✅(刪 DEK) | ❌ | ❌ |
| Backup 自動加密 | ✅(就是密文) | 需另設 | ✅ |
| Insider threat | ✅ | ❌ | ❌ |

#### 7.4.1 欄位分層加密決議

| 欄位 | 方法 | 理由 |
|------|------|------|
| `final_quote_amount_enc` | **App AES-256-GCM BLOB** | 最敏感,DBA 看不到;per-project DEK 支援撤銷 |
| `final_margin_rate_enc` | **App AES-256-GCM BLOB** | 同上 |
| `quote_cost_breakdowns.*_enc` | **App AES-256-GCM BLOB** | 5 個欄位全加密(material/labor/overhead/logistics/recommended_price)|
| `quote_factory_cost_master.labor_rate_hour_enc` | **App AES-256-GCM BLOB** | 廠區時薪敏感 |
| `quote_customer_aliases.real_name_enc` | **App AES-256-GCM BLOB** | Alias 反查表,洩了就破整套脫敏 |
| 其他欄位(project metadata、tasks、tickets 等) | **Oracle TDE Tablespace** `QUOTE_DATA` | 擋 disk/backup,SQL 仍透明 |
| KB public 向量 | 金額脫敏後 embed | 避免相似度 leak |
| KB internal 向量 | embed 前金額再區間化 | 檢索可用,具體值在 re-rank 才解密 |
| 檔案附件(NFS uploads) | Envelope encryption:DEK per file + KEK in KMS | `/quote/*/files/*` 分 bucket |
| DB backup | RMAN 加密 + 異地存放 | 表空間已 TDE,RMAN 再加一層確保離線備份 |
| 傳輸 | TLS 1.3 only;HSTS 2y; includeSubDomains; preload | 標準 |

#### 7.4.2 KMS 分期實作

| 階段 | KMS 實作 | 理由 |
|------|----------|------|
| **P1 MVP** | K8s Secret(sealed-secrets commit) + Node `crypto` HKDF 派生 per-project DEK | 不卡 infra 決策;效能最好;可快速驗證 schema |
| **P2** | HashiCorp Vault Transit engine(self-hosted on K8s) | Encryption-as-a-service;app 不持久化 key;audit log 完整;支援 key rotation |
| **P3**(合規需求才上) | 硬體 HSM(Thales / Entrust) | FIPS 140-2 Level 3 需求;或客戶稽核要求 |

**重點:KMS 抽象化**,P1→P2 切換不動 schema、不動 `cryptoService.js` 外部 API,只換 adapter:

```js
// server/services/quote/kmsAdapter.js
const impl = process.env.KMS_PROVIDER === 'vault' ? vaultImpl : localImpl;
module.exports = {
  getDEK: (keyId) => impl.getDEK(keyId),
  wrapDEK: (dek) => impl.wrapDEK(dek),
  unwrapDEK: (wrapped) => impl.unwrapDEK(wrapped),
  rotateKEK: () => impl.rotateKEK(),
};
```

**P1 local 實作(HKDF 派生)**:
```js
// server/services/quote/kms/localImpl.js
const crypto = require('crypto');
const MASTER_KEY = Buffer.from(process.env.QUOTE_MASTER_KEY_B64, 'base64'); // 32B, 來自 K8s Secret

async function getDEK(keyId) {
  // HKDF: master_key + keyId → project-specific DEK
  return crypto.hkdfSync('sha256', MASTER_KEY, Buffer.from('quote-v1'), Buffer.from(keyId), 32);
}
// 撤銷:rotate MASTER_KEY(全體)或把 keyId 加入 revoked list
```

**P2 Vault Transit**:
```js
// server/services/quote/kms/vaultImpl.js
const vault = require('node-vault')({ endpoint: process.env.VAULT_ADDR });

async function getDEK(keyId) {
  const res = await vault.write(`transit/datakey/plaintext/quote-${keyId}`, {});
  return {
    plaintext: Buffer.from(res.data.plaintext, 'base64'),
    ciphertext: res.data.ciphertext, // 存 DB 用,下次 unwrap
  };
}
```

#### 7.4.3 加密欄位實作 shape

```js
// server/services/quote/cryptoService.js
const crypto = require('crypto');
const kms = require('./kmsAdapter');

async function encryptAmount(value, projectId) {
  const dek = await kms.getDEK(`quote:project:${projectId}`);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  const enc = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  dek.fill(0);
  // layout: [1B version][12B iv][16B tag][ciphertext]
  return Buffer.concat([Buffer.from([0x01]), iv, tag, enc]);
}
```

#### 7.4.4 TDE 表空間(DBA 一次設定)

```sql
-- Prereq: Oracle Wallet 配置好
ALTER SYSTEM SET WALLET OPEN IDENTIFIED BY "...";

CREATE TABLESPACE quote_data
  DATAFILE '/u01/oradata/FXLK/quote_data01.dbf' SIZE 10G
  AUTOEXTEND ON NEXT 1G MAXSIZE 100G
  ENCRYPTION USING 'AES256'
  DEFAULT STORAGE (ENCRYPT);

-- §2 所有 quote_* 表建表時指定
CREATE TABLE quote_projects (...) TABLESPACE quote_data;
```

#### 7.4.5 Key rotation 週期

| Key | 週期 |
|-----|------|
| Master (KEK) | 每年(Vault 自動) |
| Per-project DEK | 專案結案後 3 年銷毀(符合商業機密 retention) |
| Token signing key | 每 90 天 |
| TLS cert | 依 CA(通常 1 年)|

**Envelope encryption 範例**:
```js
// server/services/quote/fileCrypto.js
const { kmsGenerateDataKey, kmsDecrypt } = require('./kms');

async function encryptFile(buffer, projectId) {
  const { plaintext: dek, ciphertext: wrappedDek } = await kmsGenerateDataKey({
    KeyId: `alias/quote-project-${projectId}`,
  });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  dek.fill(0);                              // zeroize
  return { cipher: enc, iv, tag, wrappedDek };
}
```

### 7.5 L4 — DLP(防外洩)

| 機制 | 作法 |
|------|------|
| **可見浮水印** | Excel 匯出時 `header/footer` 放 `{工號} {姓名} {時間}`;PDF 用 pdfkit diagonal 半透明;PNG/JPG 用 sharp 疊圖 |
| **不可見浮水印** | 價格相關截圖可採 LSB steganography 嵌工號(事後追蹤來源) |
| **下載閾值** | 單日 > 10 檔 或 單次 > 50 筆 → PM 簽核 + admin 通知 |
| **整室匯出** | 一律走 workflow,管理員才能 approve |
| **複製/截圖偵測** | 前端 best-effort:`visibilitychange` + `oncopy` hook 記 event;screenshot 不可能 100% 擋,重點是**嚇阻 + 追蹤** |
| **OCR DLP** | 上傳圖片 → 走 Cortex OCR → regex match 價格類(`\$\d+` / `USD [\d.]+` / `毛利[::]\s*\d+%`)→ 命中自動 tag `contains-price`,KB 路由到 internal;通知 PM review |
| **外發信** | 若整合 Gmail API → outbound filter:scan 有 `Tier-C` 代稱外的具體金額 + customer real name,block + 通知安管 |

**OCR DLP 範例**:
```js
// server/services/quote/ocrDLP.js
const PRICE_PATTERNS = [
  /\$\s?\d+[\d,]*(?:\.\d+)?/g,
  /(?:USD|TWD|CNY|VND|INR)\s?[\d,.]+/gi,
  /毛利\s*[::]\s*\d+(?:\.\d+)?%/g,
  /單價\s*[::]\s*[\d,.]+/g,
];

function classifyImage(ocrText) {
  const hit = PRICE_PATTERNS.some((re) => re.test(ocrText));
  return hit ? 'CONTAINS_PRICE' : 'SAFE';
}
```

### 7.6 L5 — 稽核與偵測

| 機制 | 作法 |
|------|------|
| **Append-only log** | `quote_audit_log` + BEFORE UPDATE/DELETE trigger(§2.7) |
| **保留** | 7 年;partition by month,3 年以上轉冷儲 |
| **事件類別** | 14 類(§2.7 註解) |
| **異常偵測** | 排程 job 每 5 min 跑:單日下載 > 閾值 / 非工時(22:00–06:00)存取 / 大量 KB 查詢 / 失敗登入 burst → 推 SIEM |
| **月度 access review** | 每月 1 號自動寄 PM:你的專案現成員 list,請確認 / 移除。14 天無回 → 降為 OBSERVER |
| **結案後 retention** | 專案 CLOSED_* 後,非成員可看 internal KB 摘要但不能看原始群聊(透過 KB chunk 入口) |

**異常偵測 rule 範例**:
```sql
-- 單日下載 > 20 筆
SELECT user_id, COUNT(*) cnt, SYSDATE
FROM quote_audit_log
WHERE event_type IN ('DOWNLOAD','EXPORT')
  AND occurred_at > SYSDATE - 1
GROUP BY user_id
HAVING COUNT(*) > 20;

-- 非工作時間 + 大量 VIEW_PRICE
SELECT user_id, COUNT(*) cnt
FROM quote_audit_log
WHERE event_type = 'VIEW_PRICE'
  AND occurred_at > SYSDATE - 1/24
  AND TO_CHAR(occurred_at, 'HH24') NOT BETWEEN '08' AND '19'
GROUP BY user_id
HAVING COUNT(*) > 5;
```

### 7.7 威脅模型(STRIDE)

| 威脅 | 場景 | 緩解 |
|------|------|------|
| **S** 仿冒 | A 員工偷 B 員工 cookie | Step-up 2FA + device fingerprint + IP 綁定 |
| **T** 竄改 | 改 `can_view_price=1` 自己把自己升權 | API enforce 僅 sales/pm/admin 可改 + `joined_by` + audit + ACL 變更通知業務/PM |
| **T** 竄改 | 一般使用者直接 POST /api/quote/projects 建案 | API 驗 `quote.sales` role,非 sales 直接 403 |
| **E** 提權 | 有 `quote.pm` 者自己指派自己到不相干專案 | PM 授權只在「業務建案時指派」發生,PM 自己不能發起建案 |
| **R** 否認 | "我沒下載過" | 獨立 audit_log + 浮水印 |
| **I** 資訊洩漏 | 員工複製成本表貼 Line | OCR DLP(難擋人肉外流)+ 浮水印追蹤 + 月度 access review + 離職前 revoke |
| **D** 阻斷 | Rate limit / DoS | WAF + Redis rate limit |
| **E** 權限提升 | 一般 user 打 `/api/quote/*` | `aud=quote` JWT + VPD(即使 app 繞過) |

### 7.8 秘密管理

- KMS(Vault / Cloud KMS / HSM)統一管 encryption key
- `GEMINI_API_KEY`, `ERP_DB_PASSWORD`, MCP private key → K8s Secret + sealed-secrets(避免 plain yaml git push)
- **絕不 log 敏感資料**:logger 加 redactor(pino-redact pattern),scrub `final_quote_amount`, `customer_real_name`, `Authorization` header
- 離職:HR → LDAP 禁用 → job scan 10 min 內 revoke quote tokens + 撤 KB 讀取權

### 7.9 合規

- **台灣個資法(PDPA)**:客戶資訊屬個資,存取留 log
- **ISO 27001**:access control(A.9)、cryptography(A.10)、logging(A.12)— 建議對應到此文件章節做 mapping 表
- **SOC 2 Type II**(若客戶要求):全部稽核事件 append-only + retention 1 年 + change management

---

## 8. 前端設計(UI)

> 採 Cortex 現有 React 18 + Vite + TailwindCSS + lucide-react + echarts-for-react 技術棧。
> 視覺主軸:**SLA 紅/黃/綠色語言**。敏感資料一律 overlay 工號+時戳浮水印。

### 8.0 部署拓撲 + Code 組織(Option C 落地)

**單一 SPA + 雙 hostname**(見 §1.2.1):

```
User Browser
  │
  ├── quote.foxlink.com.tw  ─┐
  │                          ├─→ Nginx ─→ cortex-app:3007(同 Pod)
  └── cortex.foxlink.com.tw ─┘                    │
                                                  ├─ portalDetector middleware
                                                  ├─ /api/auth/*     共用 SSO
                                                  ├─ /api/quote/*    報價 API(aud=quote)
                                                  └─ /api/*          主站 API(aud=cortex)

同一個 Vite build:
  client/dist/ 包含 CortexApp + QuoteApp
  Nginx 為兩個 hostname 都 serve 這個 dist
  App.tsx 頂層依 hostname 切進 <QuoteApp> 或 <CortexApp>
```

**前端 code 組織**:

```
client/src/
├── App.tsx                   # ★ hostname detector,切 <QuoteApp>/<CortexApp>
├── components/               # ★★ 共用基礎元件(兩站都用)
│   ├── ui/                   #    Button / Modal / Table / Tabs / Toast
│   ├── chat/                 #    ChatWindow / MessageBubble / InputArea
│   ├── markdown/             #    MarkdownRenderer / StreamingText
│   └── file/                 #    FileUploader / FilePreview
├── hooks/                    # ★★ 共用(useAuth / useWebSocket / useI18n)
├── i18n/                     # ★★ 共用基礎,各模組有自己 namespace
│
├── pages/                    # Cortex 主站頁面(原有)
├── layouts/CortexLayout.tsx  # Cortex 主站 Layout(原有)
│
└── modules/quote/            # ★ 報價站獨有(本次新建)
    ├── QuoteApp.tsx          # 報價站根元件 + Router
    ├── QuoteLayout.tsx       # 報價站 Layout(冷色調 theme)
    ├── QuoteSidebar.tsx
    ├── pages/                # 報價頁面(§8.3 開始)
    ├── components/           # 報價特有(SlaLight / CostTable / StepUpModal...)
    └── hooks/                # 報價特有(useQuoteToken / useStepUp...)
```

**重點**:
- 聊天、Markdown、FileUploader、基礎 UI 全部**完全共用**
- 報價獨有元件放 `modules/quote/`
- Cortex 升級 `components/chat/` → 報價自動吃到
- **新寫的 UI code 只有 ~800 行 Layout 類 + ~2500 行報價特有元件 + ~1500 行 admin 頁**(合計 ~4800 行)

### 8.1 路由結構

**報價站(`quote.foxlink.com.tw`)— 進入後 path 從 `/` 開始**:

```
/                              → 我的專案列表(預設 tab 依身分)
/dashboard                     → 戰情室(director only)
/projects/:id                  → 專案詳情(hash tab)
   #war-room                   → 戰情會議室(預設,§14)
   #info                       → 基本資訊
   #tasks                      → 任務樹 + Gantt
   #costing                    → 成本核算(Step-up 觸發)
   #files                      → 附件
   #timeline                   → 稽核時間軸
/kb                            → 報價 KB 搜尋
/factory-master                → 廠區主檔(finance only)
/admin/user-roles              → 角色授予
/admin/pending-reassign        → 待指派專案(§8.7.1)
/admin/customer-aliases        → 客戶代號表
```

> 注意:因為 hostname 就是 quote,**前端路由不再需要 `/quote/` 前綴**。後端 API 仍保留 `/api/quote/*`(讓 Nginx 可以從 path 分流、後端 Express 清楚區隔)。

**主站(`cortex.foxlink.com.tw`)**:
- 一般 Cortex 路由(原有)
- `/quote/*` 路由**刻意不註冊** — 若 user 手動輸入 URL 會 404 + 顯示「請至 quote.foxlink.com.tw」連結
- 防禦深度:即使有人拿 cortex token 偽造路徑,aud 驗證也會 reject

### 8.0.1 共用元件使用約定

報價站 import 共用元件時**禁止修改元件內部**,只能透過 props 切換外觀:

```tsx
// ✅ 對:透過 prop variant 切換
<ChatWindow variant="quote" messages={messages} />
<MessageBubble severity="blocker" />

// ❌ 錯:去改 components/chat/ChatWindow.tsx 加報價邏輯
// ❌ 錯:複製 ChatWindow.tsx 到 modules/quote/ 改
```

若共用元件不夠用,**加 prop 擴充**(雙方受惠)或**在 modules/quote/ 寫 wrapper**(組合,不複製)。

### 8.2 Tailwind 色語言(新增)

```
SLA-red       bg-red-500 text-white animate-pulse    # 超期
SLA-yellow    bg-amber-400 text-gray-900             # 70% 接近
SLA-green     bg-emerald-500 text-white              # 正常
SLA-gray      bg-gray-400                            # 已結案

classification-CONFIDENTIAL  ring-red-400 ring-2
classification-RESTRICTED    ring-orange-400 ring-2
classification-INTERNAL      ring-blue-300 ring-1
classification-PUBLIC        (無 ring)

price-masked   blur-sm select-none                   # 無權限顯示
price-elevated ring-1 ring-red-300 bg-red-50         # 看金額時外框提示
```

### 8.3 QuoteListPage(列表)

Tab 依使用者身分顯示:

```
┌─────────────────────────────────────────────────────────────┐
│ 報價專案                                    [+ 建立新專案]    │ ← 僅 quote.sales 或 admin 可見
│                                                               │
│ ╭ 我發起的(12)╮ ╭ 我被指派 PM(8)╮ ╭ 我參與中(15)╮          │
│ ╰──────────────╯ ╰──────────────────╯ ╰─────────────╯         │
│ ╭ 觀察中(5)╮ ╭ BU 全部(58)⭐╮ ╭ 已結案(142)╮               │
│ ╰────────────╯ ╰──────────────────╯ ╰──────────────╯          │
│   ⭐ = director 角色才看得到                                  │
│                                                               │
│ 🔍 搜尋客戶/料號/project code     [All BU ▾] [All Status ▾]   │
│                                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🔴 QT-2026-0143  客戶 A001     Type-C 連接器            │ │
│ │    越南廠 │ 500K pcs │ SLA 剩 2h 14m │ COSTING          │ │
│ │    📣 Amy Wang(業務)👑 Rich Lai(PM)+ 3 成員          │ │
│ │    💬 12 則新                                            │ │
│ │    [查看] [加入觀察]                                     │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Tab 可見性**:

| Tab | 誰看得到 | 資料來源 |
|-----|----------|----------|
| 我發起的 | `quote.sales` | `WHERE sales_user_id=me` |
| 我被指派 PM | `quote.pm` | `WHERE pm_user_id=me` |
| 我參與中 | 任何人 | `WHERE id IN (members WHERE user_id=me)` |
| 觀察中 | 任何人 | 自訂關注清單 |
| BU 全部 ⭐ | `quote.director` | `WHERE business_unit_id IN director_bus` |
| 已結案 | 任何人(依 VPD) | `WHERE status LIKE 'CLOSED%'` |

**[+ 建立新專案]** 按鈕**僅 `quote.sales` 或 admin 可見**(無此 role 者 hide,不 disable — 避免誤解為 bug)。

**關鍵 UX**:
- SLA 燈號永遠最顯眼(最左大圓點 + 動畫)
- 金額**預設不顯示在列表**(避肩窺);hover 才顯,依 `canViewPrice` 回完整 or tier
- 業務用📣 icon,PM 用👑 icon,Member 無 icon,Observer 用👁
- infinite scroll(類比 Cortex `/chat` 現有分頁)

### 8.3.1 建立專案對話框(僅業務可開)

```
┌──────────────────────────────────────────────────┐
│ 建立報價專案                                  × │
├──────────────────────────────────────────────────┤
│ 客戶 *          [下拉搜尋 ▾]                      │
│ 品名 *          [_____________]                   │
│ 料號            [_____________]                   │
│ 數量 *          [_______] pcs                     │
│ 交期 *          [📅 2026-06-15]                  │
│ 優先級 *        ○HIGH(24h) ●NORMAL(48h) ○LOW    │
│ 候選廠區 *      ☑ CN  ☐ IN  ☑ VN                 │
│ 事業處 *        [業務二處 ▾](預設=我的 BU)       │
│ ──────────────────────────────────────────────── │
│ ★ 指派 PM *    [🔍 搜尋 email/姓名……]            │
│                候選清單僅顯示 quote.pm 角色持有者 │
│                選中者會收到 Webex 通知            │
│ ──────────────────────────────────────────────── │
│ RFQ 附件        [⬆ 上傳 PDF/Word/Excel]           │
│                                                   │
│                     [取消]   [建立並進入專案]     │
└──────────────────────────────────────────────────┘
```

**規則**:
- 業務預設 `business_unit_id = 我的 BU`,可改(跨 BU 報價罕見但不禁止)
- PM 搜尋 dropdown 會打 `GET /api/quote/users/search?q=...&role=quote.pm`,非 PM 不會進清單
- 建立後 POST body 帶 `pm_user_id`,後端再驗一次 role,前後端雙保險

### 8.4 QuoteDetailPage(詳情)

```
┌─────────────────────────────────────────────────────────────┐
│ ← 返回 │ QT-2026-0143 [🔴 SLA 2h 14m] [COSTING ▾] ⋮         │
│                                                               │
│ 客戶 A001(戰略客戶) │ Type-C 連接器 │ FL-USBC-0042           │
│ 500,000 pcs         │ 交期 2026-06-15                         │
│ ─────────────────────────────────────────────────────────── │
│                                                               │
│ [資訊] [任務⑦] [群聊⑫] [🔒 成本] [附件④] [📋 稽核]            │
│ ━━━━━━━                                                       │
│                                                               │
│ ╭─ 專案狀態 ──────────────╮ ╭─ 成員(5)   [+ 邀請]───╮      │
│ │ ● EVALUATING → ● QUOTING │ │ 📣 Amy Wang(業務)[換?] │      │
│ │ ● COSTING   ○ STRATEGY   │ │ 👑 Rich Lai(PM)       │      │
│ │ ○ APPROVING ○ SUBMITTED  │ │ 👤 John Liu 💰 [✕]    │      │
│ │ ○ CLOSED                 │ │ 👤 Sarah Wu    [✕]    │      │
│ │                          │ │ 👁 Kate Chen (觀察)[✕]│      │
│ ╰──────────────────────────╯ ╰────────────────────────╯      │
│                                                               │
│ 圖例:📣業務 👑PM 💰有金額權限 ✕ 踢除(僅業務/PM 可見)         │
│                                                               │
│ ╭─ 候選廠區 ──────────────╮ ╭─ 關鍵時間 ──────────────╮      │
│ │  🇨🇳 中國  ✓ 已核算       │ │ RFQ 收 2026-04-23 09:15 │      │
│ │  🇮🇳 印度  ⏳ 核算中      │ │ SLA 到 2026-04-24 09:15 │      │
│ │  🇻🇳 越南  ✓ 已核算       │ │ 預計送 2026-04-24 07:00 │      │
│ ╰──────────────────────────╯ ╰────────────────────────╯      │
│                                                               │
│ ⚠ 策略建議(AI):越南廠毛利 Tier-M 但 Yield 風險高            │
└─────────────────────────────────────────────────────────────┘
```

### 8.4.1 Pending Banner(業務 / PM 離職後顯示)

當 `project.pending_reassign IS NOT NULL`,頂部狀態列下方永遠顯示紅色 banner;**寫入類按鈕全部變 disabled + tooltip 解釋**。

```
┌─────────────────────────────────────────────────────────────┐
│ ← 返回 │ QT-2026-0143 [⏸ SLA 已暫停] [COSTING ▾] ⋮          │
│                                                               │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│ ⚠ 此專案等待指派新業務                                        │
│    原業務 Amy Wang 已於 2026-04-21 離職                       │
│    等候中:2 天 3 小時   SLA 已暫停                           │
│    [聯絡 admin 協助指派]                                      │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│                                                               │
│ 客戶 A001 │ Type-C 連接器 │ FL-USBC-0042        (唯讀模式)    │
│ ...                                                           │
│                                                               │
│ [+ 邀請] [✕ 踢除] [🔄 重新核算] [結案] ← 全部 disabled         │
│ 💬 群聊仍可發言                                               │
└─────────────────────────────────────────────────────────────┘
```

- `pending='SALES'`:banner 文字「等待指派新業務」
- `pending='PM'`:文字「等待指派新 PM」
- `pending='BOTH'`:文字「等待指派新業務與新 PM」
- 點「聯絡 admin 協助指派」→ 開 Webex 對話給 admin 群組(pre-filled 專案 code)

### 8.5 🔒 成本 Tab(Step-up 彈窗)

```
┌─────────────────────────────────────────┐
│  🔐 二階驗證                              │
│                                           │
│  您即將查看敏感成本資料                  │
│                                           │
│  請輸入 TOTP 或確認 Webex 推播           │
│  ┌─────────┐                              │
│  │ _ _ _ _ │  [Webex 推播]                │
│  └─────────┘                              │
│                                           │
│  此次驗證有效 10 分鐘                    │
└─────────────────────────────────────────┘
```

### 8.6 CostBreakdownTable

```
┌─────────────────────────────────────────────────────────────┐
│ [CN ⭐] [IN] [VN]        版本: v3(2026-04-23 14:22)           │
│                                                               │
│ 🔐 您正在查看加密資料 · 工號 12345 · 14:28:03                 │
│                                                               │
│ ┌──────────────────┬──────────────────────────────────┐     │
│ │ 項目             │ 中國廠(CNY → USD @ 7.15)         │     │
│ ├──────────────────┼──────────────────────────────────┤     │
│ │ 料費             │ $ 2.143 / pcs   ← can_view_price   │     │
│ │                  │ [Tier-A] ← 無 price 權限者        │     │
│ │ 工費             │ $ 0.382 / pcs                     │     │
│ │ 管銷             │ $ 0.215 / pcs                     │     │
│ │ 物流             │ $ 0.087 / pcs                     │     │
│ │ NRE 攤提         │ $ 0.050 / pcs                     │     │
│ ├──────────────────┼──────────────────────────────────┤     │
│ │ 總成本           │ $ 2.877 / pcs                     │     │
│ │ 建議報價         │ $ 3.450 / pcs                     │     │
│ │ 毛利率           │ 16.6%(Tier-M)                    │     │
│ └──────────────────┴──────────────────────────────────┘     │
│                                                               │
│ [🔄 重新核算] [📊 廠區比較] [📥 匯出 Excel + 浮水印]           │
└─────────────────────────────────────────────────────────────┘
```

**關鍵 UX**:
- 頂部一行永遠顯示 `🔐 + 工號 + 時間`(心理嚇阻 + 拍螢幕留跡)
- 無 `can_view_price` 只顯 Tier 代稱
- 匯出按鈕明確標示「+ 浮水印」

### 8.7 Dashboard(戰情室)

```
┌─────────────────────────────────────────────────────────────┐
│ 📊 報價戰情室                            業務二處 ▾           │
│                                                               │
│ ┌── Active SLA ──┬─ 本週 KPI ──────────────────────────┐    │
│ │  🔴  3   超期  │ 新單 12                              │    │
│ │  🟡  7   接近  │ 結案 8(Win 5 / Loss 3)              │    │
│ │  🟢 15   正常  │ 贏單率 62.5%                          │    │
│ │                │ 平均回應 21.3h                        │    │
│ └────────────────┴──────────────────────────────────────┘    │
│                                                               │
│ ┌─ Gantt(本月 active)───────────────────────────────┐       │
│ │ QT-0143 ██████░░░░ COSTING                          │       │
│ │ QT-0142 ████████░░ STRATEGY                         │       │
│ │ QT-0141 ██████████ APPROVING                        │       │
│ └─────────────────────────────────────────────────────┘       │
│                                                               │
│ ┌─ Delay 熱點 ────────┬─ 成員負載 ──────────────────┐         │
│ │ 新料詢價 ██████ 6   │ Rich  █████ 5 active         │         │
│ │ 成本核算 ████   4   │ Amy   ████  4                │         │
│ │ 策略決策 ██     2   │ John  ██    2                │         │
│ └─────────────────────┴──────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

### 8.7.1 PendingReassignPage(admin 專用)

```
┌─────────────────────────────────────────────────────────────┐
│ 待指派專案     共 3 件                                        │
│                                                               │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ QT-2026-0143   [SALES 待指派]  等候 2d 3h              │ │
│ │ 客戶 A001 · Type-C 連接器 · 業務二處                    │ │
│ │ 原業務 Amy Wang(2026-04-21 離職)                      │ │
│ │ 當前 PM:Rich Lai                                       │ │
│ │ [🔍 指派新業務 ▾] [⚡ 緊急解鎖(不指派)]                 │ │
│ ├──────────────────────────────────────────────────────┤ │
│ │ QT-2026-0098   [BOTH 待指派]   等候 5d 12h ⚠           │ │
│ │ 客戶 C-7K3M9P · HDMI 線材 · 業務一處                    │ │
│ │ 業務 + PM 皆已離職                                       │ │
│ │ [🔍 指派新業務] [🔍 指派新 PM]                           │ │
│ ├──────────────────────────────────────────────────────┤ │
│ │ QT-2026-0121   [PM 待指派]    等候 8h                   │ │
│ │ 客戶 A003 · USB Hub · 業務二處                          │ │
│ │ 業務:Tom Lin  · 原 PM Rich Lai(2026-04-23 離職)      │ │
│ │ [🔍 指派新 PM ▾]                                         │ │
│ └──────────────────────────────────────────────────────┘   │
│                                                               │
│ 排序:⦿ 等候時間 DESC    ○ SLA 緊急度    ○ BU                │
└─────────────────────────────────────────────────────────────┘
```

**關鍵 UX**:
- 等候超 3 天會紅色高亮(⚠ 標記)
- 指派 dropdown 打 `/api/quote/users/search?role=quote.sales|quote.pm`,只列有對應 role 的 user
- 指派後立即 toast「已通知 XXX」
- 「緊急解鎖(不指派)」需填 reason 並**二次確認**,audit 會特別標 `FORCE_UNLOCK` 事件

### 8.8 CloseWizard(4-step 結案精靈)

```
Step 1: 結案類型   → Win / Loss / Hold
Step 2: 關鍵學習   → AI 預產摘要 + 使用者補充
Step 3: 脫敏預覽   → 左右並排:完整版 vs public 版,
                    紅底標出被脫敏的段落,PM 可微調
Step 4: Approve   → PM 簽字 + 業務主管 approve(戰略案法務 approve)
                    → 觸發 §6 Pipeline
```

### 8.9 元件清單

```
client/src/modules/quote/
├── routes.tsx                        # /quote/* 路由
├── pages/
│   ├── QuoteListPage.tsx
│   ├── QuoteDetailPage.tsx
│   ├── QuoteDashboardPage.tsx
│   ├── QuoteKbPage.tsx
│   ├── FactoryCostMasterPage.tsx
│   └── admin/
│       ├── UserRolesPage.tsx         # Global role 授予(sales/pm/director/finance/admin)
│       ├── PendingReassignPage.tsx   # 待指派專案清單(§8.7.1)
│       ├── CustomerAliasPage.tsx     # 客戶代號表
│       └── KmsKeyPage.tsx            # KMS rotate 管理
├── components/
│   ├── SlaLight.tsx                  # 紅黃綠燈號 + 倒數
│   ├── StepUpModal.tsx               # 2FA 彈窗
│   ├── WatermarkedViewer.tsx         # canvas overlay 工號+時戳
│   ├── PriceCell.tsx                 # 自動判斷 price vs tier 顯示
│   ├── StatusPipeline.tsx            # 狀態機視覺化
│   ├── TaskGantt.tsx                 # echarts-for-react custom
│   ├── DelayReasonModal.tsx          # 強制填原因(tied to WebSocket 發群聊)
│   ├── CloseWizard.tsx               # 4-step 結案精靈
│   ├── CostBreakdownTable.tsx        # 含加密提示列
│   ├── FactoryCompareChart.tsx       # 三地對照 radar
│   └── ClassificationBadge.tsx       # 機密等級 ring
└── hooks/
    ├── useQuoteToken.ts              # aud=quote JWT 管理
    ├── useStepUp.ts                  # elevated claim 自動續驗
    └── usePriceMask.ts               # 統一判斷顯示 price 或 tier
```

### 8.10 i18n

遵循 [CLAUDE.md#多語言規則](../CLAUDE.md) — 所有靜態文字同步 zh-TW / en / vi:
- `client/src/i18n/locales/*/quote.json`(模組獨立 namespace)
- 動態內容(專案 title、客戶描述):不翻,因為是業務資訊

### 8.11 行動裝置 / Webex Bot

- 專案詳情頁 mobile-friendly(Tailwind 已有 responsive),但**成本 tab 預設在 mobile 不可查看**(政策嚴格,必須電腦上檢閱)
- Webex Bot 可發:SLA 倒數提醒、新訊息通知、待 approve 通知
- Webex Bot **不**能查看金額細節(回 `"請至電腦版查看"`)

---

## 9. 實作路徑

### Phase 1 — MVP(2–4 週)
- [ ] Migration:§2 全部建表 + seed 預設角色
- [ ] Auth:JWT `aud=quote` + Step-up 2FA
- [ ] CRUD:專案 / 成員 / 任務 / 群聊(room_type)
- [ ] ACL:middleware + VPD policy
- [ ] 欄位加密服務(KMS 整合)
- [ ] 基礎核算 Skill(N1–N4,N5 先 stub)
- [ ] 基礎戰情(SLA 燈號 + 列表)
- [ ] 稽核日誌 + 浮水印匯出

**驗收**:選 1 個 pilot 料號跑完 RFQ → 報價 → 結案,資料正確 + ACL 測通

### Phase 2 — 協作與知識沉澱(4–8 週)
- [ ] 子任務 thread + Delay 強制 reason
- [ ] 聊天 / 附件自動入 live KB
- [ ] 結案脫敏 Pipeline(§6 全流程)
- [ ] Human-in-loop approve UI
- [ ] AI Bot 加入專案群聊(@bot 查 BOM / 歷史)
- [ ] Gantt + RAG + 燃盡圖
- [ ] OCR DLP

### Phase 3 — 進階(8–12 週)
- [ ] What-if / 年降 / 關稅模擬
- [ ] 贏單率預測模型
- [ ] AI 智慧定價建議
- [ ] 多級簽核工作流
- [ ] 電子簽章(DocuSign)
- [ ] 客戶 RFQ Email 自動解析建案

### Phase 4 — 持續迭代
- [ ] NPI 量產成本 closed-loop
- [ ] 客戶畫像 / 競品對標
- [ ] SIEM 整合深化

---

## 10. 風險與決策記錄(RAID)

| 類型 | 項目 | 影響 | 緩解 |
|------|------|------|------|
| **R** | VPD 在 Oracle 23 AI 若有 bug 可能 silent leak | HIGH | defense-in-depth:app ACL 作主 + VPD 作 2nd;每季跑 pen test |
| **R** | Step-up 2FA 推 Webex 失敗 → 影響 24h SLA | MED | fallback TOTP;離線狀態允許預簽 elevated token 1h(audit) |
| **R** | 匯率浮動影響已定案報價 | MED | `fx_locked_at` 鎖匯率;超過 N 天自動觸發重算 warning |
| **R** | 財務沒 quarterly review 廠區主檔 | HIGH | 每 90 天自動發提醒;超期不允許核算 |
| **R** | 業務/PM 集體離職導致大量 pending,admin 負擔過重 | MED | pending 清單按等候時間 DESC;等候 > 3 天紅色告警;平均處理時長 KPI;必要時加 `quote.reassigner` 次級 role 由 director 代管 |
| **R** | admin 濫用 `FORCE_UNLOCK` 繞過指派 | MED | 該事件獨立 audit 標記;每月寄 admin 操作報告給 CIO;需填 reason 且二次確認 |
| **R** | 離職 job 執行失敗導致 sales_user_id 指向已 disabled user | HIGH | job 冪等設計 + retry;每小時 reconcile:掃 `WHERE sales_user_id/pm_user_id IN (SELECT id FROM users WHERE enabled=0) AND pending_reassign IS NULL` |
| **R** | SLA 暫停期間業務仍在催交期(客戶不知道內部換人) | LOW | pending 期間新成本詢價 webhook 仍處理;PM 的工作不因人選變更完全歸零;業務應 proactively 跟客戶溝通(流程問題非系統問題)|
| **A** | 脫敏區間帶粒度由誰定 | — | 財務 + 業務主管 + 法務 review `config.redaction_tier` |
| **A** | KMS 選型(Vault / Cloud KMS / HSM) | — | P1 啟動前 IT 決,本文件留 abstraction |
| **I** | 客戶代號表(quote_customer_aliases)誰維護 | — | 業務部 + admin 雙人維護 |
| **D** | Cortex feedback 工單結構會改嗎 | LOW | 穩定,rename-to-cortex 已完成 |

---

## 11. 後續需定案項目

### 11.1 已決議

| 項目 | 決議 | 版本 |
|------|------|------|
| 戰情會議室 | 三欄版面、task template、completion_note 必填(檔案 optional)、DECISION 強制已讀回執、自動 pin(§14)| v0.3.5 |
| AI 分析架構 | 三層(即時 / 精確 / 統計)、Scrub→LLM→Unscrub、Layer 3 走 Incremental MV 即時(§15)| v0.3.5 |
| 部署拓撲 | **Option C**:單一 SPA + 獨立 hostname(`quote.foxlink.com.tw`);共用 `components/` 共用 backend(§1.2.1 / §7.1 / §7.2.1 / §8.0)| v0.3.4 |
| 離職處理 | **方案 B**:專案進 `pending_reassign` → 鎖唯讀 + SLA 暫停 → admin 手動指派新 sales/pm(§3.2 / §4.3.1)| v0.3.3 |
| 專案發起流程 | **業務發起 → 指派 PM** → 業務+PM 共管成員 → 業務獨享換 PM 權 | v0.3.2 |
| Global roles | `quote.sales` / `quote.pm` / `quote.director` / `quote.finance_reviewer` / `quote.admin`(§7.3.0) | v0.3.2 |
| Director 行為 | 看權限綁定 BU 內**所有專案**完整流程+價格,不需被邀請(§7.3.1)| v0.3.2 |
| 成員表內容 | 僅存 MEMBER/OBSERVER(被邀請者);Sales/PM 用 `quote_projects` 欄位(§2.2)| v0.3.2 |
| KMS 選型 | P1:K8s Secret + HKDF / P2:Vault Transit / P3 如合規需要才上 HSM(§7.4.2)| v0.3 |
| 加密方案 | App AES-GCM BLOB(金額)+ Oracle TDE Tablespace(其他)(§7.4.1)| v0.3 |
| UI 設計 | §8 完整 wireframe(含建立專案 dialog) | v0.3.2 |
| external_partner_mode | **不做**,僅內部使用 | v0.3 |
| 脫敏 tier 閾值 | 初步版本已列(§6.2),**進入 Review 流程**(§12)| v0.3.1 |

### 11.2 P1 kickoff 前仍需定案

| # | 項目 | Owner | 狀態 | 細節章節 |
|---|------|-------|------|----------|
| 1 | 脫敏 tier 閾值 | 業務 + 財務 + 法務 | **Review 中** | §12 |
| 2 | Pilot 客戶 + 料號 | 業務 | **規劃中** | §13 |
| 3 | Strategic 客戶前 20 大名單 | 業務 | 未開始 | — |
| 4 | 客戶代碼詞庫(料號脫敏用) | 業務 | 未開始 | §6.2.4 |
| 5 | LDAP 部門 → BU 對應表 | HR + 業務 | 未開始 | `quote_dept_to_bu` seed |
| 6 | Global Role 初始授予名單(sales / pm / director / finance / admin) | Quote Owner + 業務主管 | 未開始 | §7.3.1 |
| 7 | Step-up 2FA factor 選型 | IT + 資安 | 未開始 | §7.2 |
| 8 | IP 白名單範圍 | 網管 | 未開始 | §7.1 |
| 9 | 價格敏感詞詞庫 | 業務 + 資安 | 未開始 | §7.5 OCR DLP |
| 10 | 法務 review 脫敏規則 SLA | 法務 | 未開始 | 目標:戰略案 24h / 一般案 8h |
| 11 | Oracle Wallet + 表空間 `quote_data` | DBA | 未開始 | §7.4.4 |

---

## 12. 脫敏 Tier 閾值 Review 計畫

### 12.1 目標

§6.2 的閾值(金額、毛利率、數量、時間)是基於消費電子經驗值的**起手版**,必須由業務 + 財務 + 法務三方 review 定案,否則:
- 閾值太粗 → public KB 失去檢索區分度
- 閾值太細 → 反推具體金額可能性升高,機密漏風險
- 法務未簽字 → 出事沒人扛

### 12.2 Review 流程(目標 1 週內完成)

```
Day 0(發起日,2026-04-23)
  ├─ PM(Rich Lai)準備 review package:
  │    - spec §6.2 + 本章節 QA template
  │    - 附件 1:過去 12 個月報價金額分布直方圖(從 ERP 抓)
  │    - 附件 2:毛利率分布直方圖
  │    - 附件 3:3 個歷史案例的 before/after 脫敏樣本(匿名)
  │    - 附件 4:現行公司機密等級標準(若有)
  └─ 發出 email + 建立 Webex 群組

Day 1–2(先個別閱讀 + 填 QA template)
  業務主管:用業務角度評「tier 邊界是否貼實務」
  財務主管:評「金額 tier 是否會暴露毛利結構」
  法務:評「脫敏後是否還有個資/商業機密風險」

Day 3(收 feedback,整理爭議點)
  PM 整理 3 方 feedback,列出爭議項(預估 3–5 個)

Day 4(60-min review 會議)
  議程:
    - 15 min 爭議項逐一討論
    - 20 min 針對歷史案例走一遍脫敏結果
    - 15 min 決定最終 tier 表
    - 10 min 定 KPI 與 re-review 週期(建議 6 個月 1 次)

Day 5–7(定案 + 文件更新)
  PM 更新 spec v0.4 §6.2 為定案版
  各方簽字(email confirm + 歸檔)
  同步給 RD 作為 P1 migration 的 seed 資料
```

### 12.3 Review QA Template(發給三方填)

**A. 金額 tier(§6.2.1)**
- A1. 6 級分割是否足夠區分?(過粗/過細)
- A2. 邊界數字(50K/200K/1M/5M/20M)是否合理?
- A3. 是否需要加「Confidential」tier(超過 N USD 不入 public)?

**B. 毛利率 tier(§6.2.2)**
- B1. Loss-making 一律入 public KB 還是永不入?(business call)
- B2. 10%/18% 邊界貼實務嗎?
- B3. 是否要區分「報價毛利」vs「實際成交毛利」?(兩個欄位)

**C. 客戶代號(§6.2.3)**
- C1. Strategic 前 20 大用固定 A001–A020 是否可接受?(可被同業統計反推)
- C2. 一般客戶 hash 的 salt rotate 週期?(不 rotate 則可透過多次提交逆推)
- C3. 高敏客戶清單由誰決定 + 多久 review?

**D. 料號(§6.2.4)**
- D1. 客戶前綴替換詞庫由業務提供,頻率?
- D2. 是否保留料號長度特徵?(長度也能反推產品類型)

**E. 數量 tier(§6.2.5)**
- E1. 5 段劃分是否足夠?
- E2. 特殊規格料號是否需要額外打「NICHE」標記避免反推?

**F. 時間(§6.2.6)**
- F1. 到季(Q)是否夠?還是到半年?

**G. 法務專項**
- G1. 需符合哪些法規(PDPA / ISO 27001 / 客戶合約 NDA)?
- G2. 跨境傳輸(KB 存在 cross-site)是否有額外限制?
- G3. 結案後保留多久可永久刪除?(目前規劃 7 年 audit,KB 永久)

### 12.4 Review 會議需要的數據(PM 先準備)

| 編號 | 資料 | 來源 | 責任 |
|------|------|------|------|
| D1 | 過去 12 個月所有報價案金額分布(直方圖 + 百分位數) | ERP 報價歷史 | PM |
| D2 | 過去 12 個月毛利率分布 | ERP | PM |
| D3 | 過去 12 個月數量分布 | ERP | PM |
| D4 | 客戶集中度(前 20 大佔營收 %) | 業務 | 業務 |
| D5 | 3 件典型案例 before/after 脫敏樣本 | 手選 + 手動跑 Pipeline | PM |
| D6 | 產業比對:同業上市公司報價金額揭露粒度 | 公開資料(年報、法說) | PM |

### 12.5 定案後更新路徑

1. PM 更新 `docs/quote-system-spec.md` §6.2 為定案值
2. 建 `server/data/quoteSeedData.js` 作為 DB seed 來源(類似 `helpSeedData.js` 模式)
3. `server/services/quote/redactionTiers.js` import seed,提供 `bucketizeAmount()` / `bucketizeMarginRate()` 等 API
4. P1 migration 時 seed 寫入 DB 表(或 config 檔)

### 12.6 定期 re-review

- **每 6 個月**回看一次 tier 是否仍貼實務(匯率、通膨、市場變化)
- **觸發事件 re-review**:任何 KB 反推洩密事件、法規更新、客戶 NDA 換版

---

## 13. Pilot 客戶 / 料號規劃狀態

### 13.1 目前狀態

**🟡 尚未確定**(2026-04-23)— 架構尚在規劃階段,業務端尚未挑定 pilot 案。

### 13.2 建議 Pilot 選擇條件

選 Pilot 時建議符合 3/5 以上條件,才能有效驗證系統:

| # | 條件 | 理由 |
|---|------|------|
| 1 | 客戶非戰略客戶(非 A001 級) | 萬一流程卡住不影響重要案 |
| 2 | 料號為標準通用品(非客戶專用) | 測試不包含料號脫敏複雜案例 |
| 3 | 三地(CN/IN/VN)至少 2 地能打 | 驗證 FactoryCostCompare 節點 |
| 4 | BOM 深度 2–4 層 | 測 ERP Procedure 展開 + 新料詢價 |
| 5 | 金額落在 Tier-S 或 Tier-A | 不涉最敏感金額 |
| 6 | 近期有真實 RFQ(不是歷史重跑) | 測 24h SLA 真實壓力 |
| 7 | PM 是資深使用者 | 遇到 bug 能快速 debug feedback |

### 13.3 Pilot 驗收 KPI

- [ ] RFQ 收件到第一版報價草稿 ≤ 6h(系統輔助部分)
- [ ] 整個專案從建立到結案 ≤ 7 天
- [ ] 脫敏 Pipeline 無誤放金額(法務審核)
- [ ] 至少 3 個核心角色能正常作業(PM / 業務 / 工程)
- [ ] 成本核算誤差 ≤ 人工 ±5%(對比 PM 手工跑的版本)
- [ ] 至少 1 次 Delay 流程觸發(驗 `DelayReasonModal` + 群聊 enforce)
- [ ] 結案後 KB public 版 & internal 版能被正確檢索

### 13.4 Pilot 前置作業(待業務定出 pilot 後啟動)

1. 確認 pilot 客戶於 `quote_customer_aliases` 的 alias code
2. 確認 pilot BOM 在 ERP `erp_bom_explode` procedure 可正常查
3. 確認新成本詢價 API 已對該料號有資料
4. 指派 pilot PM + 業務 + 工程各 1 人
5. 預先跑一次 Cortex admin 授予必要 global role(director 指定該 PM 的主管)
6. 脫敏 tier §12 review 已定案(blocker — 否則結案 Pipeline 無法 seed)

### 13.5 非關鍵路徑:系統驗證 Pilot(可先做)

在業務 pilot 定案前,**可先用「假 pilot」驗證系統技術面**:
- PM 虛構一個已結案的歷史 RFQ 當輸入
- 跑完整 pipeline 但只在 staging 環境
- 目的:測 schema / ACL / 加密 / VPD / LLM 策略節點
- 不入 production KB

這讓架構驗證與業務 pilot 解耦,不卡住。

---

## 14. 戰情會議室 UX 設計(v0.3.5)

> 背景:24h SLA 壓力下,報價不是「任務列表慢慢跑」,是「多人協作 + 即時同步 + 快速決策」。傳統聊天室附屬 tab 太被動,本章重新設計為**戰情會議室式主介面**,訊息流嵌任務、決策、佐證、AI 建議。

### 14.1 三層任務結構

```
主任務(PM 建立,指派單一負責人)
  │
  ├─ 從 template 建立(見 §14.2)或空白
  │
  └─ 子任務(★ 負責人可改,PM 只是起手 template)
        │
        └─ 完成時填「完成說明」(必填文字)
           + 附件(optional,可上傳 / 也可只填文字說明)
```

**關鍵修訂**(v0.3.5,依業務 feedback):
- **子任務不是負責人從零展開**,而是 **PM 建主任務時先套 template(預先規劃的子任務組合),負責人接手後可增刪修**
- **完成時佐證是「文字 + 選附件」**,不強制檔案(因為有些工作只有 email 回覆、口頭確認)

### 14.2 子任務 Template 機制

PM 建主任務時,系統根據 `task_type` 建議 template:

| 主任務類型 | 預設子任務 template |
|------------|-------------------|
| `BOM_EXPAND`(BOM 展開) | ①標準件 BOM ② 新料件識別 ③ 替代料確認 |
| `SOURCING`(詢價) | ① 供應商 A 詢價 ② 供應商 B 詢價 ③ 交期確認 ④ MOQ 確認 |
| `COSTING_CN`(中國廠核算) | ① 料費小計 ② 工時估算 ③ 管銷套用 ④ 物流估算 |
| `COSTING_VN`(越南廠核算) | 同 CN 但工時基期不同 |
| `STRATEGY`(策略決策) | ① 廠區比較 ② 客戶歷史回顧 ③ 競品價位調查 ④ 策略建議 |
| `CUSTOM`(自訂) | 空白,從零建 |

**Schema 補充**:

```sql
CREATE TABLE quote_task_templates (
  id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_type         VARCHAR2(30) UNIQUE,      -- BOM_EXPAND|SOURCING|...
  display_name      VARCHAR2(100),
  subtasks_json     CLOB,                     -- [{title, default_hours, notes}, ...]
  estimated_hours   NUMBER,                   -- 主任務總工時估
  default_assignee_role VARCHAR2(30),         -- 建議指派:工程/採購/PM/財務
  is_active         NUMBER(1) DEFAULT 1,
  updated_by        NUMBER,
  updated_at        TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

**Template 維護**:
- 由 `quote.admin` 維護
- Phase 1 seed 6 個內建 template,可 admin 後續增改
- 每次專案結案後產一份使用統計 → 半年 review 是否調整

**完成子任務 API**:
```
PATCH /api/quote/tasks/:taskId
{
  "status": "DONE",
  "completion_note": "已取得 A 供應商回覆,交期 6 週,單價較上次高 5%",  // ★ 必填
  "attachments": ["file_id_123"]     // optional,0-N 個檔案
}

後端驗證:
  → status='DONE' 時 completion_note 必須非空(最少 10 字)
  → 無附件可通過,但 completion_note 必須有實質內容
  → 寫 quote_audit_log TASK_COMPLETED
  → 自動發綠色進度訊息到群聊(§14.4)
```

對應 schema 修改(§2.3 `quote_tasks` 新增欄位):

```sql
ALTER TABLE quote_tasks ADD (
  task_type         VARCHAR2(30),          -- 對應 template
  template_id       NUMBER,                -- 套用哪個 template
  completion_note   CLOB,                  -- ★ 完成說明(必填 if status=DONE)
  completion_at     TIMESTAMP,
  completed_by      NUMBER
);
```

### 14.3 戰情會議室版面(三欄設計)

專案詳情頁的 `#war-room` 是**預設 tab**,不是原本的 `#info`:

```
┌────────────────────────────────────────────────────────────────────┐
│ ← 返回 │ QT-2026-0143  [🔴 SLA 2h 14m]  [COSTING]  ⚡5 人線上  ⋮    │
├────────────────────────────────────────────────────────────────────┤
│ 📌 置頂(最多 3 則)                                                │
│  🔴 John 卡在等 A 供應商回覆詢價 [@採購 Tony 協助]        14:22    │
│  🟡 PM 決策:廠區優先越南(Yield 風險已評估)  13:50 [✓已讀 4/5]  │
│  🧾 客戶更新交期到 06-20(非 06-15)           10:03 [✓已讀 5/5]   │
├─────────────┬────────────────────────────┬──────────────────────┤
│ 左 30%      │ 中央 45%                   │ 右 25%                │
│ 任務樹       │ 訊息流(串接任務/決策/AI) │ 成員面板              │
│             │                            │                        │
│ ▼ 🟡 BOM    │ 🟢 Amy 完成「標準件 BOM」  │ 👤 Amy(業務)         │
│   ✓ 標準件  │   「附 email 截圖,新料    │    🟢 · 2 任務完成    │
│   ⏳ 新料詢 │    已識別 3 項」 📎×2 13:12│                        │
│     (John)│                            │ 👑 Rich(PM)           │
│   ⏳ 工時   │ 🔴 [BLOCKER] John 卡住     │    🟢 在線             │
│     (Mike)│   @Tony 協助  14:22        │                        │
│             │                            │ 🛠 John(工程)         │
│ ▼ 🟢 詢價   │ 💬 Tony:我走加急,今天    │    🟡 1 blocker        │
│   ✓ A報價   │   16:00 前給               │                        │
│   ✓ B報價   │                            │ 🛒 Tony(採購)         │
│   ✓ C報價   │ 🤖 [AI] 類似案 QT-2025-0087│    🟢 在線             │
│             │   也遇此供應商延遲,建議   │                        │
│ ▼ 🟡 成本   │   parallel 跑 B 廠         │ 💰 Mike(工程)         │
│   ⏳ CN廠   │ [查看歷史案例]             │    🟢 在線             │
│   ⏳ VN廠   │                            │                        │
│             │ 🟡 PM 決策:同意 parallel  │ ─────────────          │
│             │   Mike 接手 B 廠詢價       │ 今日進度              │
│             │   14:26  [✓已讀 5/5]       │ 完成:5 · 進行:4     │
│             │                            │ Delay:1 · Blocker:1  │
│             │ ⚡ 14:30 Mike 接受任務      │                        │
├─────────────┴────────────────────────────┴──────────────────────┤
│ [📝 我完成了] [⚠ 我被卡住] [@PM 求助] [📎 上傳] [🤖 問 AI]          │
└────────────────────────────────────────────────────────────────────┘
```

### 14.4 訊息色語言

| 類型 | 樣式 | 來源 | 資料結構 message_type |
|------|------|------|-----------------------|
| 💬 一般訊息 | 白底 | 使用者打字 | `TEXT` |
| 🟢 進度更新 | 綠邊 + ✓ + 附件 icon | 子任務完成自動發 | `PROGRESS` |
| 🔴 Blocker | 紅邊 + ⚠ + 求助對象 | 任務轉 DELAY 自動發 | `BLOCKER` |
| 🟡 決策 | 黃邊 + 👑 + **已讀回執** | PM/Sales 標「這是決策」 | `DECISION` |
| 🤖 AI 建議 | 藍邊 + Bot | @bot 或 AI 主動 | `AI_INSIGHT` |
| 🧾 系統事件 | 灰邊(小字) | 狀態變更 / 成員加入 | `SYSTEM` |
| ⚡ 低噪事件 | 極小字一行 | 上線下線 / 接受任務 | `LOW_NOISE` |

**Schema**(`ticket_messages` 擴充,room_type='quote_project' 時生效):

```sql
ALTER TABLE ticket_messages ADD (
  message_type      VARCHAR2(20) DEFAULT 'TEXT',
    -- TEXT|PROGRESS|BLOCKER|DECISION|AI_INSIGHT|SYSTEM|LOW_NOISE
  related_task_id   NUMBER,                   -- 關聯的主/子任務(progress/blocker)
  is_pinned         NUMBER(1) DEFAULT 0,
  pinned_by         NUMBER,
  pinned_at         TIMESTAMP,
  requires_read_receipt NUMBER(1) DEFAULT 0,  -- DECISION 自動 1
  metadata_json     CLOB                      -- AI prompt / 佐證連結 等
);

CREATE TABLE ticket_message_read_receipts (
  message_id        NUMBER NOT NULL,
  user_id           NUMBER NOT NULL,
  read_at           TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT pk_tmrr PRIMARY KEY (message_id, user_id)
);
```

### 14.5 Pin 機制

**規則**:
- 每個專案最多 Pin **3 則**(滿了要先 unpin 舊的)
- 可 Pin:DECISION / BLOCKER / 客戶重要異動
- **自動 Pin 觸發**:
  - SLA 剩 < 6h → 自動 pin 最新 DECISION
  - BLOCKER 超過 2h 未解 → 自動 pin
  - 客戶 RFQ 有異動 → 自動 pin
- 手動 pin:僅 Sales / PM 可操作
- unpin 同權限

### 14.6 已讀回執機制(DECISION 訊息專用)

```
PM 把訊息標為「決策」
  ↓
後端自動設 requires_read_receipt=1
  ↓
訊息顯示:[✓ 已讀 4/5]  hover 顯示誰未讀
  ↓
超 30 min 未讀的成員 → 自動 Webex push
  ↓
成員點訊息上的「✓ 我已確認」按鈕 → 寫 ticket_message_read_receipts
  ↓
全員確認 → 顯示綠勾 [✓✓ 全員已讀]
```

**API**:
```
POST /api/quote/messages/:id/ack
→ INSERT ticket_message_read_receipts (message_id, user_id, SYSTIMESTAMP)
→ 若全員已讀則發 SYSTEM 訊息「✓ 決策已全員確認」
```

### 14.7 快速行動按鈕(戰情室底部)

| 按鈕 | 行為 |
|------|------|
| 📝 我完成了 | 彈框選任務 → 填 completion_note(必填)→ 選附件(optional)→ 送出 → 自動發 PROGRESS 訊息 |
| ⚠ 我被卡住 | 彈框選任務 → 填 blocker reason(必填)→ @ 求助對象(必選)→ 送出 → 任務轉 DELAY + 自動 Pin 訊息 |
| @PM 求助 | 快捷 @ 該專案 PM + 計入「PM 關注事項」列表 |
| 📎 上傳 | 上傳任意檔案到當下訊息流,自動 OCR + DLP 偵測(§7.5) |
| 🤖 問 AI | 開 Bot 對話,帶入專案 context(客戶 / 料號 / 成本表 / 歷史案例) |

### 14.8 主管 / Director 戰情室行為

Director 進專案戰情室:
- ✅ 可看訊息流 / 任務樹 / 成員面板
- ✅ 可 ack DECISION(但不計入「全員」— 僅 sales/pm/member 算數)
- ❌ 不能發訊息(避免打擾正常討論)
- ❌ 不能 Pin / unpin
- 可用「看不見的瀏覽標記」:成員面板右側多一欄「👁 Director 今日瀏覽 2 次」讓團隊知道主管在關注

### 14.9 WebSocket 即時同步

事件類型(沿用 Cortex 既有 WebSocket 通道):

```
QUOTE_MESSAGE_NEW      { projectId, messageId, type, ... }
QUOTE_TASK_UPDATED     { projectId, taskId, oldStatus, newStatus }
QUOTE_MEMBER_ONLINE    { projectId, userId, status }
QUOTE_READ_RECEIPT     { projectId, messageId, userId, readAt }
QUOTE_PIN_CHANGED      { projectId, messageIds }
```

前端 listener 只訂閱當前打開的專案 room,切換專案自動 unsubscribe 舊的。

---

## 15. AI 分析架構與加密解耦(v0.3.5)

> 背景:金額欄位加密擋**人員 + DBA + Backup 外洩**,但**不擋 AI 伺服器端 Pipeline**(有合法 KMS 存取權)。本章定義三層 AI 架構 + Scrub 防 LLM log 洩露 + 即時儀表板實作。

### 15.1 核心觀念:加密 ≠ AI 分析障礙

```
路徑 A:一般使用者(受加密 + ACL 限制)
  User → API → ACL 檢查 → 依 can_view_price 回明文 or tier

路徑 B:AI Pipeline(系統身份,有 KMS access)
  Cron/Trigger → Analysis Service → KMS decrypt → Scrub → LLM → Unscrub
  → 結果依「查看此分析的使用者權限」再過濾顯示
```

AI Service 是**伺服器端程式**,有獨立 K8s ServiceAccount + 獨立 KMS key policy。加密的目的是擋**非授權讀取**,不是擋授權的 AI 計算。

### 15.2 三層 AI 架構

#### Layer 1 — 即時建議(給業務開案時)

```
輸入:新案的 { customer_id, part_number, factory_code, quantity }
  ↓
檢索:quote-cases-public(脫敏 KB,tier 粒度)
  ↓ 向量相似度 + tag 過濾
輸出:「類似案 3 個,過去均在 Tier-M 毛利、Tier-A 規模」
  ↓
目標回應時間:< 2 秒
安全性:LLM 完全接觸不到明文(KB 本身是脫敏的)
```

**實作**:沿用既有 KB 檢索機制(`retrieveKbChunks`),`scope='quote-cases-public'`。

#### Layer 2 — 精確分析(給 sales / pm / director)

```
輸入:特定 BU 或客戶的跨案分析需求
  ↓
資料源:quote-cases-internal(完整 KB)+ 原 DB
  ↓
Scrub(§15.3)→ LLM → Unscrub
  ↓
輸出:「該客戶歷史 8 案 × Type-C × 越南廠,平均毛利 14.2%,贏單率 62%」
  ↓
權限檢查:僅 quote.director / sales / pm / 該案 member
  ↓
目標回應時間:5-30 秒
```

**實作**:新 service `server/services/quote/deepAnalysisService.js`。

#### Layer 3 — 統計聚合(戰情儀表板)

```
Oracle 23 AI Incremental Materialized View(ON COMMIT refresh)
  ↓ 資料一寫入就自動更新聚合
WebSocket push 給前端儀表板
  ↓
使用者端立即看到數字變化(無需 F5)
  ↓
資料已聚合(histogram / count / avg),row-level 金額不暴露
```

**即時實作路徑**(v0.3.5 修訂,不走 4h refresh):

```sql
-- Incremental MV 範例:本週報價件數 + SLA 超期統計
CREATE MATERIALIZED VIEW mv_quote_dashboard_overview
  BUILD IMMEDIATE
  REFRESH FAST ON COMMIT                -- ★ 資料 commit 即 refresh
  ENABLE QUERY REWRITE
AS
SELECT
  business_unit_id,
  TRUNC(rfq_received_at, 'IW') AS iso_week,
  COUNT(*) AS total_count,
  SUM(CASE WHEN status LIKE 'CLOSED%' THEN 1 ELSE 0 END) AS closed_count,
  SUM(CASE WHEN sla_due_at < SYSTIMESTAMP AND status NOT LIKE 'CLOSED%'
           THEN 1 ELSE 0 END) AS overdue_count,
  SUM(CASE WHEN pending_reassign IS NOT NULL THEN 1 ELSE 0 END) AS pending_count
FROM quote_projects
GROUP BY business_unit_id, TRUNC(rfq_received_at, 'IW');

-- MV log(Incremental refresh 必要)
CREATE MATERIALIZED VIEW LOG ON quote_projects
  WITH ROWID, SEQUENCE, PRIMARY KEY
  (business_unit_id, rfq_received_at, status, sla_due_at, pending_reassign)
  INCLUDING NEW VALUES;
```

**前端即時同步**:

```
後端偵測 MV 更新(Oracle CDC 或 app-level trigger)
  ↓
推 WebSocket 事件:DASHBOARD_UPDATED { mv_name, affected_dims }
  ↓
前端 useQuoteDashboard() hook 收到 event → 重抓對應 API
  ↓
ECharts 平滑過渡到新數字(animation: 500ms)
```

**分層策略**(避免所有東西都走 MV):

| 指標類型 | 實作 | 延遲 |
|----------|------|------|
| 低基數狀態計數(active / delay / blocker 數)| 即時 SQL,走 index | < 100ms |
| SLA 倒數 | 前端 client-side 倒數(後端只給 `sla_due_at`)| 0ms |
| 週/月/季統計(histogram / 均值 / 贏單率)| Incremental MV | ON COMMIT(秒級) |
| 深度分析(同客戶歷史趨勢)| Layer 2 API(跑 SQL + LLM),cache 5 min | 5-30s |

### 15.3 Scrub → LLM → Unscrub 機制

**目的**:LLM 外部服務(Gemini / Azure)會 log prompt,即使承諾不訓練。Scrub 讓 LLM 永遠看不到真實金額 + 客戶名。

**流程**:

```
原始資料(Pipeline 解密後):
  {
    customer: "Apple",
    factory: "VN",
    unit_price: 2.143,
    margin: 0.166,
    notes: "客戶要求降價 3%,毛利從 16.6% 壓到 13.8%"
  }
        ↓ Scrub
  {
    customer: "[CUST_01]",
    factory: "VN",
    unit_price: "[PRICE_01]",
    margin: "[MARGIN_01]",
    notes: "客戶要求降價 [PCT_01]%,毛利從 [MARGIN_01] 壓到 [MARGIN_02]"
  }
  ※ scrub_map = { CUST_01: "Apple", PRICE_01: 2.143, MARGIN_01: "16.6%", ... }
        ↓ 送 LLM(Gemini Vertex)
  LLM 回應:"[CUST_01] 要求降價 [PCT_01]% 對越南廠毛利影響 = [MARGIN_02] - [MARGIN_01] = -2.8 pp。建議對策..."
        ↓ Unscrub(用 scrub_map 替回)
  "Apple 要求降價 3% 對越南廠毛利影響 = 13.8% - 16.6% = -2.8 pp。建議對策..."
        ↓ 依使用者權限過濾(§15.4)
  (若無 canViewPrice)→ 再替成 tier:
  "客戶 A001 要求降價 Tier-T 對越南廠毛利影響 = Tier-L → Tier-M(下降)。建議對策..."
```

**實作**(`server/services/quote/llmScrubber.js`):

```js
const PII_PATTERNS = [
  // 客戶名(從 quote_customer_aliases 動態載入真實名單)
  { type: 'CUST', pattern: /(?:customer|客戶)[::]?\s*([A-Za-z一-龥]+)/g },
  // 金額(USD / TWD / CNY 等)
  { type: 'PRICE', pattern: /\$?\s*[\d,]+\.?\d*\s*(?:USD|TWD|CNY|VND|INR)/gi },
  // 毛利率
  { type: 'MARGIN', pattern: /\d+(?:\.\d+)?%/g },
];

function scrub(text) {
  const map = {};
  let counter = { CUST: 0, PRICE: 0, MARGIN: 0, PCT: 0 };
  let scrubbed = text;

  for (const { type, pattern } of PII_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, (match) => {
      counter[type]++;
      const placeholder = `[${type}_${String(counter[type]).padStart(2, '0')}]`;
      map[placeholder] = match;
      return placeholder;
    });
  }

  return { scrubbed, map };
}

function unscrub(text, map) {
  let result = text;
  for (const [placeholder, original] of Object.entries(map)) {
    result = result.replaceAll(placeholder, original);
  }
  return result;
}

async function analyzeWithLLM(rawText, userCanViewPrice) {
  const { scrubbed, map } = scrub(rawText);
  const llmResponse = await geminiGenerate(scrubbed);     // ← LLM 只看到 placeholder
  const unscrubbed = unscrub(llmResponse, map);
  return userCanViewPrice ? unscrubbed : rebucketize(unscrubbed, map);
}
```

**防禦深度**:
- Scrub 前後都寫 `quote_audit_log event_type='AI_ANALYSIS'`,log 內容不含敏感值(只記 placeholder 和 token count)
- LLM API 呼叫獨立 service account + rate limit(正常量的 3×)
- Scrub function 有 unit test(新 PII 類型加 pattern 要過 regression test)

### 15.4 結果依權限過濾(Defense)

即使 Unscrub 回原值,展示給使用者前還要過權限:

```js
function filterByUserPermission(analysisResult, user, ctx) {
  if (ctx.canViewPrice) {
    return analysisResult;  // 業務/PM/director 看完整
  }
  // 無權限 → 把所有金額替回 tier
  return analysisResult
    .replace(/\$\s*[\d,]+\.?\d+/g, (match) => bucketizeAmount(parseFloat(match)))
    .replace(/\d+\.?\d*%/g, (match) => bucketizeMargin(parseFloat(match)));
}
```

### 15.5 KB 向量化的脫敏(避免向量 leak)

v0.3 已提過的雷,這裡補實作:

```
結案時 Pipeline(§6)Step 5 雙寫 KB:

  quote-cases-public:
    文字已脫敏 → embed 向量(tier 粒度)
    ※ 絕不 embed 具體金額字面

  quote-cases-internal:
    文字保留真實金額
    → **embed 前 額外 scrub 一次**,避免向量語意暗示
    → metadata 存真實值(retrieval 後顯示階段才 reveal)
```

**結論**:Internal KB 檢索回來的 chunk,文字是 tier 化的,但 metadata 有明文(受 ACL 保護)。LLM 做 re-rank / 摘要時看的是 tier 化版本。

### 15.6 AI service 安全加固

| 項目 | 配置 |
|------|------|
| K8s ServiceAccount | `quote-ai-analyzer`,只能 GET/DECRYPT,不能 ENCRYPT |
| KMS key policy | 限定 `alias/quote-*` 系列,且限定操作 decrypt |
| 一次 decrypt 量 | KMS 層限 N 筆/min(超量告警)|
| LLM 呼叫 rate limit | 正常業務量 3× 為 alert threshold |
| 稽核 | 每次 AI_ANALYSIS 留 log:user_id / prompt_hash / token_count(不留明文內容)|
| Prompt injection 防禦 | LLM 呼叫前掃黑名單(`ignore previous`, `system:` 等)|
| 輸出篩檢 | LLM 回應過 regex 反查是否不小心還原了 placeholder 外的敏感值 |

### 15.7 三層何時觸發

| 觸發點 | 使用層 | 延遲 |
|--------|--------|------|
| 業務建案 → 自動顯示「類似案 3 個」| Layer 1 | < 2s |
| 戰情室 #war-room tab 開啟 | Layer 3(儀表板)| < 100ms |
| 戰情室 WebSocket 事件推送 | Layer 3 更新 | 秒級 |
| PM 在戰情室點「🤖 問 AI」 | Layer 2 | 5-30s |
| Director 開跨 BU 分析儀表板 | Layer 3 + Layer 2 按需 | 即時 / 按需 |
| 結案 Pipeline 產摘要 | Layer 2(離線)| 30-120s |
| 每日/週/月統計自動 refresh | **不再是 cron,改 ON COMMIT** | 秒級 |

---

— 本文件結束 —
