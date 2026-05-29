# BOM 資料收集模組 · 細部規格設計書(SD)

> **狀態**:**v0.2 修訂稿**(對齊 spec v0.5 §11 Form 引擎 · v0.1 → v0.2 補 11 點)
> **日期**:2026-05-27
> **適用**:Cortex 通用專案管理平台 · QUOTE plugin · BOM 收集子模組
> **下游**:Claude Code 實作

---

## v0.1 → v0.2 改動摘要

| # | 章節 | 改動 |
|---|---|---|
| 1 | §0.1 / §11 / §12 | 新增 **Variant Dimension 整合**(對齊 v0.5 §11.3.5 · SteelSeries 案 EE 共用 / ME 分版)|
| 2 | §0.2 / §2.0 | **資料型別改 Oracle 23 AI**(NUMBER / CLOB / VARCHAR2 / TIMESTAMP / VECTOR · 不用 PostgreSQL JSONB/BIGINT)|
| 3 | §3.0 / §3.1 | **資料政策第 4 層已確認 Cortex 既有**:`ai_data_policies` + `ai_data_policy_rules(layer=4)` + `ai_policy_assignments` + `multiOrgService.resolveUserScope` |
| 4 | §3.2.4 | **gl_daily_rates ledger 反推**:從 `po_headers_all.org_id` → `hr_organization_units.set_of_books_id` 反推 ledger |
| 5 | §3.5 | **新增 ETL embedding pipeline** `bom_erp_item_index`(Oracle VECTOR 768)nightly job + 增量 refresh |
| 6 | §4.5 | **新增 AI cache 表** `bom_ai_cache`(by description hash + org_ids 哈希 + period_months)避免重複 LLM call |
| 7 | §5.4 | **補 5 個 endpoint**:list-suggestions / price-snapshots / preview-strategy / keepalive / version-diff stub |
| 8 | §7.3 | **Excel qty 解析強化**:支援 `4K` / `4,000` / `4K pcs` / `4 KPC` / `4K-Reel` 等變體 + fallback 塞 remark |
| 9 | §8.4 | **Heartbeat 機制**:client 每 5min `POST /keepalive` + server lazy idle check |
| 10 | §9.5 | **新增 audit log 表** `bom_audit_log`(policy 變更 / lock 操作 / refresh / strategy switch)|
| 11 | §10 | **整合進 FormPanel**(新 `BOMSection.tsx` · propagate `bom_total / unit` → `factory_matrix.cells[*].material_cost`)|
| - | §15 | 工時 6-8w → **10-12w**(實際估算) |

---

## 0. TL;DR

本模組支援 RD 與採購協作完成 EE BOM(及未來 ME BOM)表的資料填寫與價格匯總,並可選 variant-aware(對齊 v0.5 §11.3.5 黑/白共用 / 分版場景)。流程:

1. RD 從 Excel 帶入或在系統內填 Description / Qty
2. 系統(AI + ERP 反查)補上 FLK 料號 / 製造商料號 / MOQ / L/T / 採購價
3. 採購選定 default 價格策略(MIN / AVG / MAX,期間預設 12 月可調)
4. RD/採購 confirm,DPM 鎖 final 版本進到後續報價流程
5. BOM total cost 自動 propagate 進 v0.5 `factory_matrix.cells[*].material_cost`

### 0.1 關鍵設計決策(v0.1 + v0.2 對齊業主)

- **資料模型**:三層階層(sub_assembly → category → item)+ item 1:N alt_mfg + **item.variant_key 對齊 v0.5 §11.3.5**
- **FLK ↔ Mfg 多對多**:來自 ERP `mtl_mfg_part_numbers` cross-ref 表
- **ERP 權限**:**走 Cortex 既有 `ai_data_policies` 4 層過濾**(L1 user / L2 role / L3 org / **L4 ERP Multi-Org**),透過 `multiOrgService.resolveUserScope()` 解析
- **價格聚合**:FLK 料號級(不細分 mfg),理由詳見 §6.3
- **幣別**:統一 USD,透過指定 `rate_type` + `gl_daily_rates`,**ledger 從 OU 反推**
- **AI 補料**:Description 為主要 anchor,逐筆按鈕 + 批次一鍵 · **走 ETL embedding 而非 runtime 全表掃**
- **Lock**:single-edit 同編 lock(client heartbeat + server idle check)+ DPM final lock
- **Audit**:`bom_audit_log` 追蹤所有關鍵變更
- **整合**:落 `WarRoom/Form/BOMSection.tsx` · 第 8 個 Form section · BOM total 自動 propagate 進 factory_matrix

### 0.2 Schema 約定

| 維度 | 規格 |
|---|---|
| 資料庫 | **Oracle 23 AI**(對齊 Cortex 既有 `database-oracle.js`)|
| ID 欄位 | `id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| 字串短 | `VARCHAR2(N)` |
| 字串長 / JSON | `CLOB`(裝 JSON 字串 · 不用 `JSONB`) |
| 時間 | `TIMESTAMP DEFAULT SYSTIMESTAMP` |
| 數字 | `NUMBER(precision, scale)` |
| 向量 | `VECTOR(768, FLOAT32)`(對齊 Cortex 既有 `kb_chunks.embedding` + `project_kb_chunks.embedding` 用法) |
| 布林 | `NUMBER(1) DEFAULT 0`(0/1) |

---

## 1. 業務流程概覽

### 1.1 6 個關鍵階段

```
[1] RD 起單                  [2] Excel 帶入 / 手填        [3] ERP 反查
    │                            │                            │
    建專案 → 啟用 BOM section    匯入 Excel 或 row-by-row    Description → FLK 料號
    指定 ORG 預設值              (Description 為必填)         + Mfg / Mfg P/N
    指定資料政策                  (variant 案要選變體)         + MOQ + L/T
    (走既有 ai_data_policies)                                  + 採購價(轉 USD)
    │                            │                            │
    ▼                            ▼                            ▼
[4] AI 推薦不確定項           [5] 採購選價格策略           [6] DPM Lock Final
    │                            │                            │
    走 ETL embedding 候選         MIN / AVG / MAX            鎖版,進到報價 form
    使用者勾選 final 1 筆        期間 N 月可調              cost section 的 EE BOM
    (找不到就空白,RD 手動)     ORG 範圍 = L4 過濾結果        及 factory_matrix.material_cost
                                                              自動 propagate
```

### 1.2 角色與權限(對齊 spec §18.1.5 RACI)

| 角色 | 動作 | 權限 |
|---|---|---|
| **RD** | 填 Description / Qty / Reference / 製造商料號(若有)· 觸發 AI 推薦 / ERP 反查 · 確認 FLK 料號 | R(Responsible) |
| **採購** | 觸發 AI 推薦 / ERP 反查 · **價格策略設定(專屬)** · 確認 MOQ / LT 採用 | R + A(Accountable for price) |
| **DPM** | Review 後 lock final · 通過後此 BOM 進到 cost section / factory_matrix | A(Accountable for full BOM) |
| **MPM** | 唯讀,看 BOM 結果做 cleansheet 計算 | Reader |
| **BPM** | 唯讀 + 機密策略下的 RANGE/TIER display | Reader (masked) |

---

## 2. 資料模型(Schema)

### 2.1 階層總覽

```
bom_instance        ← 一個 BOM 表(對應一個專案的一個版本 · 可 variant-aware)
  │
  ├─ bom_section    ← 子總成(Main Board / Switch Board / LED Board)
  │    │
  │    └─ bom_category  ← 零件類別(Capacitor / Resistor / IC Chip ...)
  │           │
  │           └─ bom_item    ← 一筆料件(item_sequence + qty + description + variant_key)
  │                  │
  │                  ├─ bom_item_mfg    ← 替代製造商(1..N,Excel 中的 alt mfg rows)
  │                  ├─ bom_item_flk    ← FLK 料號候選(1..N,選一筆當 final)
  │                  └─ bom_item_price_snapshot  ← 價格 snapshot(每次 ERP 拉的結果)
```

伴隨的 cross-cutting 表(Phase 1 末上):
- `bom_erp_item_index`(ETL embedding,對應 ERP `mtl_system_items_b` 取 description vector)
- `bom_ai_cache`(AI 推薦結果 cache)
- `bom_audit_log`(關鍵變更 audit)

### 2.2 表結構(Oracle 23 AI 語法)

#### 2.2.1 `bom_instance`(版本級主表)

```sql
CREATE TABLE bom_instance (
  id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id          NUMBER NOT NULL,
  version_no          NUMBER NOT NULL,                  -- v1, v2 ...
  version_label       VARCHAR2(120),                     -- "初版" / "客戶議價 #1"
  state               VARCHAR2(20) NOT NULL,             -- DRAFT / LOCKED / SUPERSEDED

  -- ⭐ v0.5 §11.3.5 對齊:variant scope
  variant_scope       VARCHAR2(20) DEFAULT 'shared',     -- 'shared' = 全 variants 共用本 BOM
                                                         -- 'per_variant' = 本 BOM 只對應一個 variant
  variant_key         VARCHAR2(64),                       -- 若 per_variant:'black' / 'white'

  -- 專案級設定(走資料政策 snapshot)
  default_org_id      NUMBER NOT NULL,                    -- 從 L4 過濾結果選一個當 default
  default_ledger_id   NUMBER NOT NULL,                    -- 從 OU 反推 default ledger(§3.2.4)
  allowed_org_ids     CLOB NOT NULL,                      -- L4 過濾結果(JSON array)snapshot
  policy_resolved_at  TIMESTAMP NOT NULL,                 -- L4 解析時間(可重 resolve)

  -- 價格聚合設定(採購可改)
  price_period_months NUMBER NOT NULL DEFAULT 12,        -- N=12 月可調(1-36)
  price_strategy      VARCHAR2(10) NOT NULL DEFAULT 'AVG', -- MIN / AVG / MAX

  -- 匯率設定(專案級)
  rate_type           VARCHAR2(30) NOT NULL,              -- 'Corporate' / 'Spot' / 'User'
  rate_date_mode      VARCHAR2(20) NOT NULL DEFAULT 'PO_DATE',
                                                          -- PO_DATE / QUOTE_DATE / FIXED
  rate_date_fixed     DATE,                                -- if FIXED
  quote_start_date    DATE,                                -- 對 QUOTE_DATE mode · §13 定義
  target_currency     VARCHAR2(3) NOT NULL DEFAULT 'USD',

  -- Lock 機制(spec §11.3.3 single-edit lock)
  editing_user_id     NUMBER,                              -- 目前 single-edit 鎖
  editing_locked_at   TIMESTAMP,
  editing_heartbeat_at TIMESTAMP,                          -- §8.4 client heartbeat

  -- Final lock (DPM only)
  final_locked_by     NUMBER,
  final_locked_at     TIMESTAMP,

  created_at          TIMESTAMP NOT NULL DEFAULT SYSTIMESTAMP,
  created_by          NUMBER NOT NULL,
  updated_at          TIMESTAMP NOT NULL DEFAULT SYSTIMESTAMP,

  CONSTRAINT uq_bom_instance UNIQUE (project_id, version_no, variant_key),
  CONSTRAINT chk_price_period CHECK (price_period_months BETWEEN 1 AND 36),
  CONSTRAINT chk_price_strategy CHECK (price_strategy IN ('MIN', 'AVG', 'MAX')),
  CONSTRAINT chk_state CHECK (state IN ('DRAFT', 'LOCKED', 'SUPERSEDED')),
  CONSTRAINT chk_variant_scope CHECK (variant_scope IN ('shared', 'per_variant'))
);
```

#### 2.2.2 `bom_section`(子總成)

```sql
CREATE TABLE bom_section (
  id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bom_instance_id     NUMBER NOT NULL REFERENCES bom_instance(id),
  display_order       NUMBER NOT NULL,
  name                VARCHAR2(120) NOT NULL,             -- 'Main Board' / 'Switch Board' / 'LED Board'
  description         CLOB,
  CONSTRAINT uq_bom_section UNIQUE (bom_instance_id, display_order)
);
```

#### 2.2.3 `bom_category` + 字典

```sql
CREATE TABLE bom_category (
  id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bom_section_id      NUMBER NOT NULL REFERENCES bom_section(id),
  display_order       NUMBER NOT NULL,
  name                VARCHAR2(60) NOT NULL,              -- 'Capacitor' / 'Resistor' / 'IC Chip'
  process_type        VARCHAR2(20),                       -- SMD / DIP / ASSEMBLY (Excel col 6)
  CONSTRAINT uq_bom_category UNIQUE (bom_section_id, display_order)
);

-- 預設 category 字典(系統級)
CREATE TABLE bom_category_dict (
  id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                VARCHAR2(60) NOT NULL UNIQUE,
  default_process     VARCHAR2(20),
  display_order       NUMBER,
  is_active           NUMBER(1) DEFAULT 1
);
-- Seed:Capacitor / Resistor / RGB LEDs / Diode / Transistor / Ferrite, Inductor /
--      IC Chip / Connector / Other / Cable / PCB / Switch / LED
```

#### 2.2.4 `bom_item`(料件主行,⭐ 加 variant_key)

```sql
CREATE TABLE bom_item (
  id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bom_category_id     NUMBER NOT NULL REFERENCES bom_category(id),

  item_sequence       NUMBER NOT NULL,                    -- Excel col 1
  qty                 NUMBER(12,4) NOT NULL,              -- Excel col 2

  -- 核心欄位(RD 必填)
  description         CLOB NOT NULL,                      -- Excel col 7 — anchor 欄位
  reference           CLOB,                                -- Excel col 8 — 板上位置代號

  -- 客戶欄位
  customer_item       VARCHAR2(80),                       -- Excel col 4

  -- ⭐ v0.5 §11.3.5 variant_key(NULL = shared item / 'black' = per-variant)
  -- 規則:此 row 的 variant_scope 由 bom_instance.variant_scope 控制
  --   若 instance.variant_scope='shared',item.variant_key 必須 NULL
  --   若 instance.variant_scope='per_variant',item.variant_key 必須 = instance.variant_key
  -- 混合情境 (EE BOM 共用 / ME BOM 分版):用兩個 instance(共用 EE shared + 各 variant 一個 ME)
  variant_key         VARCHAR2(64),

  -- 最終 FLK 選擇(選 1 筆候選為 final,可 NULL)
  final_flk_id        NUMBER REFERENCES bom_item_flk(id),

  -- 採購來源 ORG
  source_org_id       NUMBER,                             -- 在 bom_instance.allowed_org_ids 內

  -- 衍生值(snapshot)
  derived_moq         NUMBER,
  derived_spq         NUMBER,
  derived_lead_time_w NUMBER,

  -- 採購備註優先 mfg(Phase 2,先預留欄位)
  preferred_mfg_id    NUMBER,

  remark              CLOB,                               -- Excel col 15

  -- Audit
  created_at          TIMESTAMP NOT NULL DEFAULT SYSTIMESTAMP,
  created_by          NUMBER NOT NULL,
  updated_at          TIMESTAMP NOT NULL DEFAULT SYSTIMESTAMP,
  updated_by          NUMBER,

  CONSTRAINT uq_bom_item UNIQUE (bom_category_id, item_sequence)
);
```

#### 2.2.5 `bom_item_flk`(FLK 料號候選 — 1..N)

```sql
CREATE TABLE bom_item_flk (
  id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bom_item_id         NUMBER NOT NULL REFERENCES bom_item(id) ON DELETE CASCADE,
  display_order       NUMBER NOT NULL,

  flk_part_number     VARCHAR2(80) NOT NULL,              -- mtl_system_items_b.concatenated_segments
  inventory_item_id   NUMBER NOT NULL,                     -- ERP item_id (用來 join)
  org_id              NUMBER NOT NULL,                     -- 找到時的 ORG

  source              VARCHAR2(20) NOT NULL,               -- 'RD_MANUAL' / 'AI_RECOMMEND' / 'ERP_LOOKUP'
  ai_confidence       NUMBER(5,4),                         -- 0~1
  ai_cache_id         NUMBER REFERENCES bom_ai_cache(id),  -- §4.5 對應 cache record(可追溯)
  matched_at          TIMESTAMP NOT NULL DEFAULT SYSTIMESTAMP,
  matched_by          NUMBER NOT NULL,

  CONSTRAINT uq_bom_item_flk UNIQUE (bom_item_id, flk_part_number, org_id)
);
```

#### 2.2.6 `bom_item_mfg`(替代製造商)

```sql
CREATE TABLE bom_item_mfg (
  id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bom_item_id         NUMBER NOT NULL REFERENCES bom_item(id) ON DELETE CASCADE,
  bom_item_flk_id     NUMBER REFERENCES bom_item_flk(id),   -- 該 mfg 對應哪個 FLK 候選
  display_order       NUMBER NOT NULL,

  manufacturer_id     NUMBER,                              -- ERP mtl_manufacturers.manufacturer_id
  manufacturer_name   VARCHAR2(120) NOT NULL,              -- snapshot
  mfg_part_number     VARCHAR2(120),                       -- mtl_mfg_part_numbers.mfg_part_num

  source              VARCHAR2(20) NOT NULL,               -- 'RD_MANUAL' / 'ERP_CROSSREF' / 'AI'
  is_preferred        NUMBER(1) DEFAULT 0,                 -- 採購主推 (Phase 2)

  notes               CLOB,
  created_at          TIMESTAMP NOT NULL DEFAULT SYSTIMESTAMP,

  CONSTRAINT uq_bom_item_mfg UNIQUE (bom_item_id, manufacturer_id, mfg_part_number)
);
```

#### 2.2.7 `bom_item_price_snapshot`

```sql
CREATE TABLE bom_item_price_snapshot (
  id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bom_item_id         NUMBER NOT NULL REFERENCES bom_item(id) ON DELETE CASCADE,
  bom_item_flk_id     NUMBER NOT NULL REFERENCES bom_item_flk(id),

  -- 聚合參數(snapshot 時的值,確保可重現)
  period_months       NUMBER NOT NULL,
  strategy_used       VARCHAR2(10) NOT NULL,               -- MIN / AVG / MAX
  org_ids_queried     CLOB NOT NULL,                       -- JSON array

  -- 聚合結果(已轉 USD)
  price_min_usd       NUMBER(18,6),
  price_avg_usd       NUMBER(18,6),
  price_max_usd       NUMBER(18,6),
  po_line_count       NUMBER NOT NULL,
  vendor_count        NUMBER NOT NULL,
  earliest_po_date    DATE,
  latest_po_date      DATE,

  -- 匯率設定 snapshot
  rate_type           VARCHAR2(30) NOT NULL,
  rate_date_mode      VARCHAR2(20) NOT NULL,

  -- 預設套用價
  applied_price_usd   NUMBER(18,6),                        -- = price_min/avg/max_usd 之一

  refreshed_at        TIMESTAMP NOT NULL DEFAULT SYSTIMESTAMP,
  refreshed_by        NUMBER NOT NULL,

  CONSTRAINT chk_po_line_count CHECK (po_line_count >= 0)
);

CREATE INDEX idx_bom_item_price_latest
  ON bom_item_price_snapshot (bom_item_id, refreshed_at DESC);
```

#### 2.2.8 ⭐ `bom_erp_item_index`(ETL embedding · v0.2 新增)

對齊 §3.5。把 ERP `mtl_system_items_b` 全 item description 做 embedding,nightly + 增量 refresh。

```sql
CREATE TABLE bom_erp_item_index (
  id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inventory_item_id   NUMBER NOT NULL,
  org_id              NUMBER NOT NULL,
  flk_part_number     VARCHAR2(80) NOT NULL,
  description         CLOB,
  description_hash    VARCHAR2(64),                        -- SHA256 · 增量 refresh 判斷
  embedding           VECTOR(768, FLOAT32),                -- 對齊 Cortex 既有 kb_chunks 規格
  embedding_model     VARCHAR2(80),                        -- 'gemini-embedding-001' (default)
  enabled_flag        VARCHAR2(1),                         -- snapshot from msi.enabled_flag
  item_status         VARCHAR2(20),                        -- snapshot from msi
  indexed_at          TIMESTAMP NOT NULL DEFAULT SYSTIMESTAMP,
  last_seen_at        TIMESTAMP NOT NULL,                  -- ERP 此 record 上次出現的時間
                                                           -- 若 ERP 刪除,nightly job 把 enabled_flag→N

  CONSTRAINT uq_bom_erp_item_index UNIQUE (inventory_item_id, org_id)
);

CREATE VECTOR INDEX bom_erp_item_vidx ON bom_erp_item_index(embedding)
  ORGANIZATION NEIGHBOR PARTITIONS
  WITH DISTANCE COSINE WITH TARGET ACCURACY 90;

CREATE INDEX idx_bom_erp_item_org ON bom_erp_item_index(org_id, enabled_flag);
CREATE INDEX idx_bom_erp_item_flk ON bom_erp_item_index(flk_part_number);
```

#### 2.2.9 ⭐ `bom_ai_cache`(AI 推薦 cache · v0.2 新增)

對齊 §4.5。同 description + 同 user 允許 ORG 集合 + 同 period 時,重複查詢不再 LLM call。

```sql
CREATE TABLE bom_ai_cache (
  id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  description_hash    VARCHAR2(64) NOT NULL,               -- SHA256(normalized description)
  allowed_orgs_hash   VARCHAR2(64) NOT NULL,               -- SHA256(sorted org_ids)
  period_months       NUMBER NOT NULL,                     -- 影響 confidence (歷史 PO 樣本)

  -- 推薦結果(JSON array · 每 element = { inventory_item_id, flk_pn, org_id, confidence, score_source })
  recommendations     CLOB NOT NULL,
  recommendation_count NUMBER NOT NULL,

  -- LLM 用量
  llm_tokens_input    NUMBER,
  llm_tokens_output   NUMBER,
  llm_cost_usd        NUMBER(10,6),

  -- TTL · 預設 7 天後 invalidate(可調)
  created_at          TIMESTAMP NOT NULL DEFAULT SYSTIMESTAMP,
  expires_at          TIMESTAMP NOT NULL,                  -- = created_at + 7 days
  hit_count           NUMBER DEFAULT 0,                    -- 觀察用 · 高命中 → 可加長 TTL
  created_by          NUMBER NOT NULL,

  CONSTRAINT uq_bom_ai_cache UNIQUE (description_hash, allowed_orgs_hash, period_months)
);

CREATE INDEX idx_bom_ai_cache_expires ON bom_ai_cache(expires_at);
```

#### 2.2.10 ⭐ `bom_audit_log`(變更追蹤 · v0.2 新增)

對齊 §9.5。重要操作必留 audit trail。

```sql
CREATE TABLE bom_audit_log (
  id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bom_instance_id     NUMBER NOT NULL REFERENCES bom_instance(id),
  bom_item_id         NUMBER REFERENCES bom_item(id),       -- item-level event 才填

  event_type          VARCHAR2(40) NOT NULL,                -- 見下表 enum
  event_payload       CLOB,                                  -- JSON · 各 event 的細節
  actor_user_id       NUMBER NOT NULL,
  actor_ip            VARCHAR2(50),
  occurred_at         TIMESTAMP NOT NULL DEFAULT SYSTIMESTAMP
);

CREATE INDEX idx_bom_audit_instance ON bom_audit_log(bom_instance_id, occurred_at DESC);
CREATE INDEX idx_bom_audit_item ON bom_audit_log(bom_item_id, occurred_at DESC);
```

**event_type enum**:
| event_type | when |
|---|---|
| `instance_created` | 建 BOM 表 |
| `policy_resolved` | resolve L4 ORG 過濾(snapshot 時)|
| `settings_changed` | 改 period / strategy / rate_type(payload 含 from / to)|
| `excel_imported` | Excel 匯入(payload: file_name / rows_parsed / errors)|
| `item_created` | 新增 item |
| `item_updated` | item 改 description / qty / final_flk_id |
| `item_deleted` | 刪 item |
| `ai_suggest_called` | 觸發 AI 推薦(payload: scope=single/batch · cache_hit)|
| `final_flk_chosen` | 採購 / RD 確認 final_flk_id |
| `price_refreshed` | 重新跑價格聚合(payload: snapshot_id) |
| `strategy_switched` | MIN/AVG/MAX 切換(payload: delta_total_cost) |
| `lock_acquired` | single-edit lock 取得 |
| `lock_released` | 釋放 |
| `lock_forced_release` | DPM 強制踢出 / idle timeout |
| `final_locked` | DPM lock final |
| `final_unlocked` | admin 解鎖 |
| `version_created` | 自動建 v(N+1) |

---

## 3. ERP 查詢層

### 3.0 ⭐ 資料政策第 4 層整合(v0.2 釐清)

**已確認 Cortex 既有架構**(server/database-oracle.js + server/services/multiOrgService.js + server/routes/dataPermissions.js):

| Cortex 既有表 / service | 用途 |
|---|---|
| `ai_data_policies` | 政策主表 · 對應 UI「光電經管 資料權限」 |
| `ai_data_policy_rules` | 規則明細 · 每 row 一條 rule · `layer=1/2/3/4` 對應 4 層 |
| `ai_policy_assignments` | 指派 · grantee_type='role' 或 'user' |
| `multiOrgService.resolveUserScope()` | 入口 · 給 user_id + project context → 回 allowed orgs |
| `routes/dataPermissions.js` | admin 維護 UI · `/api/data-permissions/*` |

**BOM 模組調用方式**:

```javascript
// pseudo-code · bom service 內
const { resolveUserScope } = require('../services/multiOrgService');
const { loadOrgHierarchy } = require('../services/multiOrgService');

async function resolveAllowedOrgsForBom(user, project) {
  // 1. 抓 user 的政策(走 ai_policy_assignments + ai_role_policies)
  const rules = await loadUserPolicyRules(user.id);

  // 2. 跑 multiOrgService(它會合併 L1/L2/L3/L4)
  const hierarchy = await loadOrgHierarchy(getErpPool);
  const autoOrgIds = loadAutoOrgIds(user, hierarchy);
  const scope = resolveUserScope(rules, hierarchy, autoOrgIds);

  // 3. 取 L4 ERP Multi-Org 結果
  const allowedErpOrgIds = scope.erpMultiOrg.allowedOrgIds;  // [83, 2463, ...]

  // 4. 寫進 bom_instance.allowed_org_ids snapshot
  return allowedErpOrgIds;
}
```

> **注**:`multiOrgService.resolveUserScope` 已涵蓋 hierarchy + rule 合併邏輯。BOM 模組**不要重複實作**,直接消費結果。

### 3.1 為何要 snapshot 不直接 runtime 取

- 確保「採購 A 建的 BOM,後來 A 離職權限變了,BOM 結果不會偷偷變」
- 對齊 spec §11.3.3 全版本保留原則
- 想用新 ORG → 自動建 v(N+1) 重新查
- 重 resolve 政策時觸發 `bom_audit_log` event `policy_resolved`

### 3.2 核心 SQL 設計(Oracle EBS 語法)

#### 3.2.1 從 Description → FLK 料號(完全相符 · L4 過濾後)

```sql
SELECT msi.concatenated_segments      AS flk_pn,
       msi.inventory_item_id,
       msi.organization_id,
       msi.description,
       msi.primary_uom_code,
       msi.full_lead_time             AS lead_time_days,
       msi.minimum_order_quantity     AS moq,
       msi.fixed_lot_multiplier       AS spq
FROM   apps.mtl_system_items_b_kfv msi
WHERE  UPPER(REGEXP_REPLACE(msi.description, '[[:space:]]+', ' '))
       = UPPER(REGEXP_REPLACE(:desc_input, '[[:space:]]+', ' '))
  AND  msi.organization_id IN (:allowed_org_ids)
  AND  msi.enabled_flag = 'Y'
  AND  NVL(msi.inventory_item_status_code, ' ') NOT IN ('Inactive', 'Obsolete')
ORDER BY
  CASE WHEN msi.organization_id = :default_org_id THEN 0 ELSE 1 END,
  msi.creation_date DESC
FETCH FIRST 50 ROWS ONLY;
```

#### 3.2.2 從 FLK 料號 → 所有 cross-ref 製造商

```sql
SELECT msi.concatenated_segments  AS flk_pn,
       msi.description,
       mfg.manufacturer_id,
       mfg.manufacturer_name,
       mmpn.mfg_part_num,
       msi.minimum_order_quantity AS moq,
       msi.full_lead_time         AS lead_time_days,
       msi.organization_id
FROM   apps.mtl_system_items_b_kfv  msi
JOIN   apps.mtl_mfg_part_numbers    mmpn ON mmpn.inventory_item_id = msi.inventory_item_id
JOIN   apps.mtl_manufacturers       mfg  ON mfg.manufacturer_id    = mmpn.manufacturer_id
WHERE  msi.concatenated_segments = :flk_pn
  AND  msi.organization_id IN (:allowed_org_ids);
```

#### 3.2.3 從 製造商料號 → FLK 料號(反查)

```sql
SELECT DISTINCT
       msi.concatenated_segments AS flk_pn,
       msi.inventory_item_id,
       msi.description,
       msi.organization_id,
       mfg.manufacturer_name,
       mmpn.mfg_part_num
FROM   apps.mtl_mfg_part_numbers    mmpn
JOIN   apps.mtl_manufacturers       mfg  ON mfg.manufacturer_id    = mmpn.manufacturer_id
JOIN   apps.mtl_system_items_b_kfv  msi  ON msi.inventory_item_id  = mmpn.inventory_item_id
WHERE  UPPER(mmpn.mfg_part_num) = UPPER(:mfg_pn)
  AND  msi.organization_id IN (:allowed_org_ids)
  AND  msi.enabled_flag = 'Y'
ORDER BY msi.organization_id;
```

#### 3.2.4 ⭐ 核心:價格聚合 SQL(轉 USD · ledger 從 OU 反推)

**v0.2 改動**:`gl_daily_rates` 必須走 ledger,從 OU `hr_organization_units.set_of_books_id` 反推。

```sql
WITH
-- 1. 找 N 個月內該 inventory_item_id 的所有 PO line + 對應 ledger
po_universe AS (
  SELECT pol.po_line_id,
         pol.unit_price            AS unit_price_orig,
         poh.currency_code         AS orig_currency,
         poh.creation_date         AS po_date,
         poh.org_id,                                            -- OU
         hou.set_of_books_id       AS ledger_id,                -- ⭐ 從 OU 反推 ledger
         poh.vendor_id,
         pv.vendor_name
  FROM   apps.po_lines_all       pol
  JOIN   apps.po_headers_all     poh ON poh.po_header_id = pol.po_header_id
  JOIN   apps.hr_organization_units hou ON hou.organization_id = poh.org_id
  LEFT JOIN apps.po_vendors      pv  ON pv.vendor_id    = poh.vendor_id
  WHERE  pol.item_id = :inventory_item_id
    AND  poh.org_id IN (:allowed_org_ids)
    AND  poh.authorization_status = 'APPROVED'
    AND  poh.closed_code IN ('OPEN', 'CLOSED', 'FINALLY CLOSED')
    AND  poh.cancel_flag IS NULL
    AND  poh.creation_date >= ADD_MONTHS(SYSDATE, -:period_months)
),
-- 2. 算每筆 PO 的 USD 換算單價(用該 PO 對應 ledger 的匯率)
po_usd AS (
  SELECT pu.*,
         CASE
           WHEN pu.orig_currency = :target_currency THEN pu.unit_price_orig
           ELSE pu.unit_price_orig * rate.conversion_rate
         END AS unit_price_usd
  FROM   po_universe pu
  LEFT JOIN apps.gl_daily_rates rate
         ON  rate.from_currency    = pu.orig_currency
         AND rate.to_currency      = :target_currency          -- 'USD'
         AND rate.conversion_type  = :rate_type                -- 'Corporate' / 'Spot' / 'User'
         AND rate.conversion_date  = CASE :rate_date_mode
                                       WHEN 'PO_DATE'    THEN TRUNC(pu.po_date)
                                       WHEN 'QUOTE_DATE' THEN :quote_start_date
                                       WHEN 'FIXED'      THEN :rate_date_fixed
                                     END
         -- ⭐ ledger filter:每 ledger 各自有匯率設定
         -- AND rate.set_of_books_id = pu.ledger_id            -- 部分 EBS 版本 gl_daily_rates 無 ledger_id 欄
                                                              -- 若有則加;若無則去除此行(11i 預設無)
)
-- 3. 聚合
SELECT MIN(unit_price_usd)            AS price_min_usd,
       AVG(unit_price_usd)            AS price_avg_usd,
       MAX(unit_price_usd)            AS price_max_usd,
       COUNT(*)                       AS po_line_count,
       COUNT(DISTINCT vendor_id)      AS vendor_count,
       MIN(po_date)                   AS earliest_po_date,
       MAX(po_date)                   AS latest_po_date,
       -- v0.2 額外回傳:依 ledger 拆統計(讓 UI 警示跨 ledger 偏誤)
       LISTAGG(DISTINCT ledger_id, ',') WITHIN GROUP (ORDER BY ledger_id) AS distinct_ledgers
FROM   po_usd
WHERE  unit_price_usd IS NOT NULL;
```

**EBS 版本相容備註**:
- EBS R12 起 `gl_daily_rates` 可選擇加 `set_of_books_id` 過濾(較精確,跨多 ledger 才需要)
- 11i 預設 `gl_daily_rates` 沒 `set_of_books_id` 欄,只依 `(from_ccy, to_ccy, type, date)` 唯一
- **本系統先用「不加 ledger filter」版本**(對齊 11i),R12+ 升級後可加

### 3.3 SQL 邊界處理

| 情境 | 處理 |
|---|---|
| `gl_daily_rates` 那天沒匯率 | 往前找最近 7 天的匯率(rolling fallback)· 仍找不到則該 row drop · UI 警示「N 筆 PO 因匯率缺漏被排除」 |
| `po_universe` 結果 0 筆 | UI 顯示「近 N 月此料號無 PO 紀錄,請手動輸入價格或延長期間」 |
| `po_universe` 結果 < 3 筆 | UI 警示「樣本數過少 (n=2),價格參考性低」 |
| FLK 料號在不同 ORG 有不同 `inventory_item_id` | 每個 ORG 分別聚合後再聯集(罕見) |
| AVG 被極端值拉偏 | Phase 2 加 trimmed mean(去頭尾 10%);Phase 1 簡單 AVG |
| 跨 ledger 聚合(不同 ledger 用不同匯率)| Phase 1 統一一個 rate · UI 警示「跨 N 個 ledger,可能匯率失真」(`distinct_ledgers` 回傳)|

### 3.4 ERP 查詢快取策略

| 查詢類型 | 快取 | 失效時機 |
|---|---|---|
| Description → FLK candidates | 不快取(直接走 §3.2.1 一次性 SQL) | — |
| FLK → mfg cross-ref | 快取 24h(in-memory or Redis) | ERP 端 trigger or 手動 refresh |
| MOQ / LT(`mtl_system_items_b`) | 快取 24h | 同上 |
| Price aggregation | **不快取**,但寫入 `bom_item_price_snapshot` 留歷史 | 採購改 N / strategy / ORG 就重算 |
| **AI 推薦結果**(§4.5) | **7 天 TTL · `bom_ai_cache`** | hash 不同就重算(description / orgs / period) |

### 3.5 ⭐ ETL embedding pipeline(v0.2 新增 · 取代 v0.1 runtime embedding)

#### 3.5.1 為何要 ETL

- ERP `mtl_system_items_b` 可能上百萬筆 item · runtime 全表 cosine 不可行
- Cortex 既有 KB pipeline 已用 Oracle 23 AI `VECTOR(768, FLOAT32)`(`kb_chunks.embedding`)· **直接複用模式**
- Item Master 是唯一來源(業主確認),不存在跨多 ITEM_MASTER 整合問題

#### 3.5.2 ETL 任務設計

**初次全量(One-time)**:
- 從 ERP `mtl_system_items_b_kfv` 撈 `description IS NOT NULL AND enabled_flag = 'Y'` 的全部 row
- 對每筆 description 跑 Gemini embedding-001(768 維)
- 寫進 `bom_erp_item_index`
- 預估筆數:50 萬-100 萬 item × 30 ORG · 走批次每批 100 筆 · 預估 8-16 小時 + USD $200-400 一次性成本

**增量 refresh(Nightly cron · 每日 03:00)**:
- 撈 ERP `mtl_system_items_b_kfv` WHERE `last_update_date >= SYSDATE - 1`
- 計算 `SHA256(normalized description)` → 跟 `bom_erp_item_index.description_hash` 比對
- 不同才重新 embed
- 增量平均每天 < 5000 筆 · 約 USD $1-3/天

**Soft delete(同 nightly job)**:
- `last_seen_at` 超過 7 天的 row → 標記 `enabled_flag='N'`(不真刪,留 audit)

#### 3.5.3 Cron 整合

對齊 Cortex 既有 cron 模式(同 `kbMaintenanceService` / `dailyReportService.startCron`):

```javascript
// bomErpEmbeddingService.js
function startCron() {
  if (process.env.BOM_ERP_INDEX_ENABLED !== 'true') return;
  const cron = require('node-cron');
  const expr = process.env.BOM_ERP_INDEX_CRON || '0 3 * * *'; // 每日 03:00
  cron.schedule(expr, async () => {
    await runIncrementalRefresh();
  });
}
```

由 `projects-platform.startWorkers()` 自動呼叫,受 `RUN_SCHEDULERS=false` gate(只 scheduler pod 跑)。

#### 3.5.4 AI 推薦走 ETL index 的 SQL

```sql
-- runtime: 給 user 上傳的 description 即時算 embedding,再對 ETL index 跑 cosine
SELECT bei.inventory_item_id,
       bei.org_id,
       bei.flk_part_number,
       bei.description,
       VECTOR_DISTANCE(bei.embedding, TO_VECTOR(:q_vec), COSINE) AS dist
FROM   bom_erp_item_index bei
WHERE  bei.org_id IN (:allowed_org_ids)
  AND  bei.enabled_flag = 'Y'
ORDER BY dist ASC
FETCH FIRST 50 ROWS ONLY;
```

---

## 4. AI 補料層

### 4.1 兩種觸發模式

#### 4.1.1 逐筆按鈕觸發(`POST /api/bom/item/{id}/ai-suggest`)

- RD/採購填完 description 後,row 右側出現「🤖 AI 推薦」按鈕
- 點擊 → 跑 AI(含 cache check · §4.5)→ 列前 N 個候選 → 使用者勾選一筆

#### 4.1.2 批次一鍵觸發(`POST /api/bom/instance/{id}/ai-suggest-batch`)

- BOM 表頂部「✨ AI 補齊空白項」
- 後端遍歷所有 `final_flk_id IS NULL` 的 item
- 對每筆 description 跑 AI(走 cache · 命中不計費)
- 結果寫入 `bom_item_flk`(`source = 'AI_RECOMMEND'`),**不自動設 final**

### 4.2 AI 推薦邏輯(v0.2 修訂 · 走 ETL index)

```
Input:  description (RD 填的零件描述)
        bom_instance.allowed_org_ids
        bom_instance.price_period_months
        (optional) bom_item.bom_category_id 縮限類別

Step 0: ⭐ Check bom_ai_cache(description_hash + allowed_orgs_hash + period_months)
        命中 → 直接回 recommendations(hit_count++)
        未命中 → 進 Step 1

Step 1: ERP 完全相符查詢(SQL §3.2.1)
        若 >=1 筆 → confidence = 1.0 直接列出

Step 2: 若 Step 1 = 0 筆,跑 ⭐ Vector cosine(SQL §3.5.4)
        - 對 description 即時算 embedding(Gemini embedding-001)
        - 對 bom_erp_item_index 跑 cosine search
        - 取 top 50 dist < 0.3 的候選(confidence = 1 - dist)

Step 3: 若 Step 2 < 3 筆,加 LLM Q&A 補強
        - 用 LLM 從 description 抽 token(零件類型 / 規格 / 封裝 / 容差)
        - 對 Step 2 的候選用 LLM 評分相似度(0-1)
        - filter confidence > 0.75

Step 4: ⭐ 寫進 bom_ai_cache · TTL 7 天

Step 5: 全部 0 候選 → 回傳空陣列,UI 顯示「無 AI 候選,請手動輸入」
```

### 4.3 LLM Description token 抽取(輔助 Step 3)

Prompt:

```
Description: "C-SMD,CERAMIC,16V,10uF,±10%,0603,X5R,RoHS"

請抽出以下 token 用於相似度評分,**只回 JSON**:
{
  "component_type": "Capacitor",
  "spec_main": "10uF",
  "spec_secondary": ["16V", "±10%", "0603", "X5R"],
  "package": "0603",
  "tolerance": "±10%",
  "dielectric": "X5R",
  "compliance": ["RoHS"]
}

規則:
- 單位嚴格:uF 不等於 nF,V 不等於 mV
- 0603 / 0805 / 1206 為標準封裝代碼
- 不確定的欄位設 null
```

### 4.4 AI 模型與成本

| 用途 | 模型 | 預估成本 |
|---|---|---|
| Description embedding(runtime) | Gemini embedding-001 (768 dim) | $0.00003 / call |
| ETL embedding(nightly 增量)| 同上 | < $3 / 天 |
| Token 抽取(LLM Q&A) | Gemini Flash | $0.0002 / call |
| 候選相似度評分 | Gemini Flash | $0.0005 / call |
| 批次補齊 100 item | 同上(80% cache hit 後)| 約 $0.05 / 一次批次 |

對齊 spec §3 整體 LLM 預算 $150-250/月,本子模組預估佔 < $20/月(含 ETL 增量 + 日常 query)。

### 4.5 ⭐ AI cache 設計(v0.2 新增)

#### 4.5.1 Cache key

```javascript
const descNorm = description.trim().replace(/\s+/g, ' ').toUpperCase();
const descHash = crypto.createHash('sha256').update(descNorm).digest('hex').slice(0, 64);

const sortedOrgs = [...allowedOrgIds].sort((a, b) => a - b);
const orgsHash = crypto.createHash('sha256').update(JSON.stringify(sortedOrgs)).digest('hex').slice(0, 64);

const cacheKey = { descHash, orgsHash, periodMonths };
```

#### 4.5.2 Cache 命中規則

- 同 description(忽略大小寫 + whitespace)
- 同 user 允許 ORG 集合(排序後 hash)
- 同 period(不同 period 樣本數不同 → 不可共享)
- 未過 TTL(7 天)

#### 4.5.3 Cache invalidation

- TTL 自然到期(nightly cleanup job)
- ETL embedding job 更新 `bom_erp_item_index` 後,**該 description hash 範圍的 cache 強制 invalidate**(否則 cache 內 score 變舊)
- 採購改 strategy 不影響 cache(strategy 不在 key 內)

#### 4.5.4 Cache 觀察指標

- `hit_count` 累積值高的 description → 可加長 TTL
- 一個月若 hit_count = 0 → 無人複用,自然 expire

---

## 5. API Endpoints 設計

### 5.1 BOM Instance 級

| Method | Endpoint | 說明 |
|---|---|---|
| POST | `/api/bom/instance` | 建一張新 BOM(自動 resolve L4 ORG + ledger snapshot) |
| GET | `/api/bom/instance/{id}` | 取整張 BOM(含所有 section/category/item) |
| PATCH | `/api/bom/instance/{id}/settings` | 改 N 月、改 strategy、改 ORG、改 rate_type · 自動寫 audit |
| POST | `/api/bom/instance/{id}/import-excel` | 上傳 Excel,系統解析填入 |
| POST | `/api/bom/instance/{id}/export-excel` | 匯出當前狀態為 Excel(對齊原格式) |
| POST | `/api/bom/instance/{id}/lock` | DPM 鎖 final · 自動 propagate 到 factory_matrix |
| POST | `/api/bom/instance/{id}/unlock` | admin 解鎖(§8 解鎖規則) |
| POST | `/api/bom/instance/{id}/new-version` | 鎖後改 → 自動建 v(N+1) |
| POST | `/api/bom/instance/{id}/refresh-all-prices` | 重新跑所有 item 的價格聚合 |
| POST | `/api/bom/instance/{id}/ai-suggest-batch` | 批次補空白項(走 cache) |
| POST | `/api/bom/instance/{id}/acquire-edit-lock` | single-edit lock(spec §11.3.3) |
| POST | `/api/bom/instance/{id}/release-edit-lock` | 釋放 |

### 5.2 Item 級

| Method | Endpoint | 說明 |
|---|---|---|
| POST | `/api/bom/item` | 新增一筆 item |
| PATCH | `/api/bom/item/{id}` | 改 description / qty / final_flk_id / source_org_id |
| DELETE | `/api/bom/item/{id}` | 刪 item(cascade flk / mfg / snapshot) |
| POST | `/api/bom/item/{id}/ai-suggest` | 對單一 item 跑 AI 推薦(走 cache) |
| POST | `/api/bom/item/{id}/erp-lookup-by-desc` | 從 description ERP 反查(SQL §3.2.1) |
| POST | `/api/bom/item/{id}/erp-lookup-by-mfg-pn` | 從製造商料號反查(SQL §3.2.3) |
| POST | `/api/bom/item/{id}/erp-lookup-by-flk` | 從 FLK 料號反查所有 mfg(SQL §3.2.2) |
| POST | `/api/bom/item/{id}/refresh-price` | 重新跑單筆價格聚合(SQL §3.2.4) |
| PUT | `/api/bom/item/{id}/final-flk` | 設定 final_flk_id |

### 5.3 Reference / Master Data

| Method | Endpoint | 說明 |
|---|---|---|
| GET | `/api/bom/categories/dict` | 取 `bom_category_dict` 字典 |
| GET | `/api/bom/data-policy/orgs/{project_id}` | 取該 user 在此專案可用的 ORG 清單(走 multiOrgService) |
| GET | `/api/bom/data-policy/rate-types` | 取 `gl_daily_conversion_types` |
| GET | `/api/bom/data-policy/ledgers/{org_id}` | 反推 ORG 對應 ledger |

### 5.4 ⭐ 補充 endpoint(v0.2 新增)

| Method | Endpoint | 說明 |
|---|---|---|
| GET | `/api/bom/item/{id}/ai-suggestions` | 列既有候選(`bom_item_flk` rows)不重跑 AI |
| GET | `/api/bom/item/{id}/price-snapshots` | 列價格 snapshot 歷史(全 strategy / 全 period 都看)|
| POST | `/api/bom/instance/{id}/preview-strategy` | body: `{ strategy: 'MIN' }` → 不寫入 · 回傳「若改用 MIN 對總 BOM cost 影響預估」 |
| POST | `/api/bom/instance/{id}/keepalive` | §8.4 heartbeat · 滾動更新 `editing_heartbeat_at` |
| GET | `/api/bom/instance/{id}/diff?vs=v1` | (Phase 2 端點 · Phase 1 先回 501 stub) |
| GET | `/api/bom/audit/instance/{id}` | 列 audit log(支持 event_type filter) |

### 5.5 ETL 管理 endpoint

| Method | Endpoint | 說明 |
|---|---|---|
| POST | `/api/bom/erp-index/refresh` | 手動觸發 ETL 增量 refresh(admin only) |
| GET | `/api/bom/erp-index/stats` | 看 index 表筆數 / 上次 refresh 時間 / cache hit rate |

---

## 6. UI / UX 設計

(維持 v0.1 §6 三欄式 wireframe · 額外補:**底部加 cost propagate 預覽條**)

### 6.4 ⭐ BOM total cost propagate 預覽條(v0.2 新增)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ BOM Total Cost (Phase 1 計算 SUM(qty × applied_price_usd))               │
│   Black variant: $8.518 / unit   →  寫進 factory_matrix.black['CN-A']    │
│   White variant: $8.726 / unit   →  寫進 factory_matrix.white['CN-A']    │
│   [🔄 重新計算]  [✅ Propagate 寫進 cost section]                          │
└──────────────────────────────────────────────────────────────────────────┘
```

DPM lock final 時自動 propagate · 也可手動觸發(寫進 `project.data_payload.factory_matrix.cells[*].material_cost`)。

---

## 7. Excel 匯入解析規則

(維持 v0.1 §7.1 / §7.2 結構,§7.3 強化)

### 7.3 ⭐ Qty / MOQ / LT 解析強化(v0.2 修訂)

| 樣例 | 解析結果 |
|---|---|
| `"4K"` | `qty = 4000` |
| `"4,000"` | `qty = 4000` |
| `"4K pcs"` | `qty = 4000` |
| `"4 K"` | `qty = 4000` |
| `"4K-Reel"` | `qty = 4000` · `remark += "Reel"` |
| `"4.5K"` | `qty = 4500` |
| `"4M"` | `qty = 4000000` |
| `"32WK"` / `"32W"` / `"32 weeks"` | `lead_time_w = 32` |
| `"6-8WK"` | `lead_time_w = 8`(取上限) · `remark += "min 6w"` |
| 解析失敗 | 原字串塞 `bom_item.remark` + UI flag「解析失敗,請手動修」 |

```javascript
function parseQty(s) {
  if (!s) return null;
  const norm = String(s).trim().toUpperCase().replace(/[,\s]/g, '');
  const m = norm.match(/^(\d+(?:\.\d+)?)\s*([KMB])?/);
  if (!m) return null;
  const base = parseFloat(m[1]);
  const mult = { K: 1000, M: 1000000, B: 1000000000 }[m[2]] || 1;
  return Math.round(base * mult);
}
```

---

## 8. State Machine · Lock 與版本

(維持 v0.1 §8.1 / §8.2 / §8.3,§8.4 為新增)

### 8.4 ⭐ Single-Edit Lock Heartbeat 機制(v0.2 新增)

#### Client 端

- 進入 BOM 編輯頁面 → 自動 `POST /acquire-edit-lock` 取鎖
- 取鎖成功 → 啟動 `setInterval(() => POST /keepalive, 5 * 60 * 1000)` 每 5 分鐘
- 收到 200 OK → 繼續編輯
- 收到 409(別人搶走鎖)→ 提示用戶 / 切唯讀
- 頁面 unmount → `POST /release-edit-lock`

#### Server 端

- `POST /keepalive` 更新 `bom_instance.editing_heartbeat_at = SYSTIMESTAMP`
- 每個請求進來都跑 lazy check:
  - 若 `editing_user_id IS NOT NULL` AND `editing_heartbeat_at < SYSTIMESTAMP - INTERVAL '30' MINUTE`
    → 自動釋放(`editing_user_id = NULL` · 寫 audit `lock_released` with `payload.reason='idle_timeout'`)
- DPM 強制踢出 → `editing_user_id = NULL` · 寫 audit `lock_forced_release`

---

## 9. Phase 規劃(v0.2 工時更新)

### Phase 1(本 SD 範圍 · **10-12 週**實作 · v0.1 6-8w 過於樂觀)

| Phase | 週 | 內容 |
|---|---|---|
| **P0** | 1-3 | Schema 10 張表 + 資料政策 §3.0 整合(包 multiOrgService 包裝層) + ERP 3 個 SQL 反查 + 基本 CRUD API |
| **P1** | 4-6 | 價格聚合 SQL §3.2.4 + ledger OU 反推 + snapshot 寫入 + Excel import/export 強化 §7.3 |
| **P2** | 7-9 | AI 推薦 §4(逐筆 + 批次 · 走 cache · ETL index `bom_erp_item_index` 上線) + UI 三欄式 §6 + Lock + Heartbeat |
| **P3** | 10-12 | 機密策略 §6.2.4 + Audit log + Cost propagate § 6.4 + 整合測試 + UAT pilot + factory_matrix propagate |

### Phase 2(後續加值)

- 採購主推 mfg 維護(`bom_item.preferred_mfg_id` + `bom_item_mfg.is_preferred`)
- AI 從 Description 自動分類 category
- AVG 加 trimmed mean
- 跨 BOM 版本 diff view(version-diff endpoint 真實作)
- 多 ORG 並列價格對比
- BOM 學習庫:結案 BOM 進 KB

### Phase 3+

- AI 解讀「為何漲價」(對齊 spec §11.3.8 AI 解讀 Phase 2+)
- PO Vendor → Mfg 推測對照表
- ERP 加 mfg flexfield(跨部門 IT case)

### 9.5 ⭐ Audit Log 完整覆蓋(v0.2 新增)

所有 §2.2.10 event_type 在對應 service function 內寫一筆 audit。**Phase 1 從 P3 補完整覆蓋,P0-P2 至少寫 instance_created / settings_changed / lock_* 等關鍵事件**。

---

## 10. 風險與緩解(v0.2 補)

(維持 v0.1 §10 風險表,額外補:)

| 風險 | 影響 | 緩解 |
|---|---|---|
| ETL embedding 初次跑 8-16h 撞 Cortex token 配額 | 影響其他 LLM 服務 | 走 `llmQueue` rate limiter(對齊 projects-platform 既有設計)+ 分批 + 晚間跑 |
| `bom_ai_cache` 持續長大 | DB 增長 | nightly cleanup job 刪 `expires_at < SYSDATE` 的 row |
| EBS 11i vs R12 `gl_daily_rates` schema 差異 | 跨 ledger 匯率精確度 | §3.2.4 提供兩版本 SQL + env flag 切換 |
| `multiOrgService.resolveUserScope` 結果跟 BOM 需求對不上 | L4 過濾錯,allowed_orgs 空 | BOM service 包裝層做 sanity check + 若 0 ORG 直接顯示「請聯絡 admin 設定資料政策」|
| DPM lock 後 propagate 失敗(network / DB error)| factory_matrix 帶舊資料 | propagate 失敗時 lock 不生效(transaction rollback) · audit `final_locked_failed` |

---

## 11. ⭐ 與現有 FormPanel 整合(v0.2 新增)

### 11.1 Section 位置

對齊 `client/src/pages/ProjectsPlatform/WarRoom/Form/FormPanel.tsx`,**新增第 8 個 section**:

```typescript
const SECTIONS: SectionDef[] = [
  { id: 'customer',   label: '客戶資料', ... },
  { id: 'variant',    label: 'CMF 變體', ... },          // v0.5 §11.3.5
  { id: 'bom',        label: 'EE BOM',  icon: '📋', isNew: true,    // ⭐ 本 SD 新增
    visible: (p) => !!(p as any).bom_instance_id,
    badge: (p) => `${itemsDone(p)}/${itemsTotal(p)} item` },
  { id: 'packaging',  label: 'Packaging', ... },         // v0.5 §11.3.7
  { id: 'nre',        label: 'NRE 成本', ... },           // v0.5 §11.3.6
  { id: 'cost',       label: '成本核算', ... },           // 含 v0.5 §11.3.8 factory_matrix
  { id: 'ai',         label: 'AI 工具',  ... },
];
```

新增 `client/src/pages/ProjectsPlatform/WarRoom/Form/BOMSection.tsx`:
- 內含本 SD §6 三欄 wireframe
- 從 `/api/bom/instance/{id}` 拉資料

### 11.2 Cost propagate 規則

DPM lock final 後:

```
bom_instance.state = LOCKED
   ↓ trigger
SUM(bom_item.qty × bom_item_price_snapshot.applied_price_usd)
   per variant_key
   ↓
寫進 project.data_payload.factory_matrix.cells[variant_key]['CN-A'].material_cost
   (CN-A 用 default_org_id 對應廠 · 其他 cell 走原 v0.5 設定)
   ↓
寫 audit_log: factory_matrix_propagated · payload = { from / to / delta }
```

### 11.3 與 v0.5 §11.3.7 Packaging 的關係

Packaging section 內的 `pkg_total_per_unit`(現在是 hardcode 在 `data_payload.packaging.total_per_unit`)未來可整合進本 BOM 系統(packaging items 變成 `bom_section.name='Packaging'`),但 **Phase 1 不做整合**,保留 packaging 獨立 child-table。

---

## 12. ⭐ Variant Dimension 整合策略(v0.2 釐清 · 對齊 v0.5 §11.3.5)

### 12.1 三種使用情境

| 情境 | 範例 | 解法 |
|---|---|---|
| **(a) 全 shared** | Apple 案 · 只有一個 SKU | `variant_scope='shared'` · 1 個 bom_instance · 所有 item.variant_key = NULL |
| **(b) 全 per_variant** | 純染色雙色,EE/ME 都分版(罕見) | 每 variant 一個 instance · `variant_scope='per_variant'` · `variant_key='black'` / `'white'` |
| **(c) 混合**(常見)| SteelSeries · EE BOM 共用 / ME BOM 分版 | 多個 instance:1 個 EE(shared)+ N 個 ME(per_variant) · 各自獨立 version 鏈 |

### 12.2 SteelSeries 案實際操作

依 v0.5 demo SteelSeries 案,實際建 3 張 BOM:
- `bom_instance #1`: `variant_scope='shared'`,內含 EE BOM Main Board(Sensor / MCU / Memory / Connector / Switch)
- `bom_instance #2`: `variant_scope='per_variant'`,`variant_key='black'`,內含 ME BOM Black(18 項:P1-P10 + R1-R3 + O1-O5 · PTFE Feet 雙色款 etc.)
- `bom_instance #3`: `variant_scope='per_variant'`,`variant_key='white'`,內含 ME BOM White(18 項 · PTFE Feet White · Bottom Cover translucent)

### 12.3 UI 顯示

BOMSection 頂部加 dropdown:
```
[EE BOM (shared) ▾]
  ├ EE BOM (shared) — Mike Chen / 5/15 v3
  ├ ME BOM (Black) — Alvin / 5/20 v2
  └ ME BOM (White) — Alvin / 5/20 v2
```

選哪張就顯該 instance 內容。

### 12.4 Cost propagate(對齊 §11.2)

- EE BOM cost(shared) → 寫進兩個 variant 的 `material_cost`(同值)
- ME BOM Black cost → 只寫 `factory_matrix.black['CN-A'].material_cost`
- 總 `material_cost` = EE shared + ME(該 variant)

---

## 13. ⭐ `quote_start_date` 定義(v0.2 釐清)

| `rate_date_mode` | `gl_daily_rates.conversion_date` 取值 |
|---|---|
| `PO_DATE` | 該 PO 的 `creation_date`(預設) |
| `QUOTE_DATE` | **`bom_instance.quote_start_date`(必填)** · UI 預設帶 `project.created_at`(或專案有自訂報價起算日就用該值) |
| `FIXED` | `bom_instance.rate_date_fixed`(必填) |

UI 在 BOM 設定面板顯示「報價匯率基準日」欄位,預設為專案開單日,業務 / DPM 可改。

---

## 14. 與 spec v0.5 主規格的對應

| 本 SD 概念 | 對應 spec | 說明 |
|---|---|---|
| `bom_instance.allowed_org_ids` snapshot | §11.3.3 全版本保留 | 改 ORG 觸發新版本 |
| `bom_instance.price_period_months` 可調 | §11.2 Form Template 自訂欄位 | 採購可改 |
| `bom_instance.variant_scope / variant_key` | §11.3.5 Variant Dimension | EE 共用 / ME 分版直接對應 |
| `bom_item_mfg.is_preferred` (Phase 2) | §11.3.5 Variant Dimension 精神延伸 | 同 FLK 多 mfg 屬 variant 概念 |
| AI 推薦逐筆 + 批次 | spec §AI 加速 #29 任務自動拆解 | 兩種模式並存 |
| Single-edit lock + Heartbeat | §11.3.3 lock | client 5 分 heartbeat · server 30 分 idle 強制釋放 |
| DPM final lock | §16.3 Stage Gate 業務確認制延伸 | DPM 為 BOM section 的 accountable |
| 機密 RANGE / TIER 顯示 | §17 confidentialityMiddleware | 價格欄走機密策略 |
| 資料政策第 4 層整合 | spec 未顯式涵蓋,**本 SD §3.0 補(已對齊 Cortex 既有 ai_data_polic*)** | 第一個明確消費資料政策的模組 |
| BOM cost propagate factory_matrix | §11.3.8 Multi-Factory Cost Matrix | DPM lock 後自動寫 `material_cost` |

---

## 15. 待主管 / 採購確認事項(SD v0.2 簽核前)

1. **採購主檔的 ORG 預設值**:第一個 pilot 專案的 default ORG 用哪個?(83? 2463?)
2. **匯率類別預設值**:Cortex 預設用 'Corporate' / 'Spot' / 'User'?
3. **AVG 計算的 outlier 處理**:Phase 1 用簡單 AVG 還是直接走 trimmed?(本 SD 寫 Phase 1 = 簡單 AVG)
4. **AI 推薦的 confidence threshold**:預設 ≥ 0.75 才秀候選,確認?
5. **BOM 草稿時的 single-edit lock idle timeout**:預設 30 分,確認?
6. **DPM 之外誰能 lock final?**:目前限定 DPM,業務或 BPM 不行,確認?
7. **匯入 Excel 後 FLK 已填的 row 要不要重跑 AI**:預設不重跑,確認?
8. **ETL 初次全量跑時機**:選某週末凌晨還是分批跑 · 預估 8-16h
9. **AI cache TTL**:預設 7 天,確認?(高命中 description 是否要加長?)
10. **EBS 版本**:R12+ 還是 11i?(影響 §3.2.4 gl_daily_rates ledger filter 是否啟用)
11. **Variant case 預設**:Phase 1 上線時是否啟用 §12 變體支援,還是先只支援 (a) 全 shared 案?

---

## 附錄 A · 給 Claude Code 的實作優先順序(v0.2)

```
P0 (週 1-3):
  - Schema 建表(本 SD §2 全 10 張)
  - 資料政策 §3.0 包裝層(multiOrgServiceAdapter)
  - ERP SQL §3.2.1 / §3.2.2 / §3.2.3
  - 基本 CRUD API §5.1 / §5.2

P1 (週 4-6):
  - 價格聚合 SQL §3.2.4(含 ledger OU 反推)+ 匯率處理 §3.3
  - bom_item_price_snapshot 寫入
  - Excel import / export §7(含 §7.3 強化解析)
  - 5.4 補充 endpoint(preview-strategy / keepalive / price-snapshots)

P2 (週 7-9):
  - ETL embedding pipeline §3.5(初次全量 + nightly 增量)
  - bom_erp_item_index + bom_ai_cache 表
  - AI 推薦 §4(逐筆 + 批次 + cache)
  - UI 三欄式 §6 + Cost propagate 預覽條 §6.4
  - Single-edit lock + Heartbeat §8.4

P3 (週 10-12):
  - 機密策略 §6.2.4
  - Audit log §9.5 完整覆蓋
  - BOMSection.tsx 整合進 FormPanel §11
  - Variant case 整合 §12(SteelSeries 案 EE 共用 / ME 分版實測)
  - factory_matrix propagate
  - 整合測試 + UAT pilot
```

---

## 附錄 B · v0.1 → v0.2 對應對照(給 reviewer 用)

| v0.1 章節 | v0.2 變更 |
|---|---|
| §0 TL;DR | 加 v0.5 variant 整合 + ETL embedding + audit |
| §2 Schema | 全改 Oracle 23 AI 語法 + 加 variant_key + 加 3 張新表 |
| §3.1 資料政策 | 改成「對接 Cortex 既有 ai_data_polic* + multiOrgService」|
| §3.2.4 價格聚合 | 加 ledger 從 OU 反推 + EBS 11i/R12 版本相容 |
| §3.5(新) | ETL embedding pipeline 完整設計 |
| §4 AI 補料 | Step 0 加 cache · Step 2 改走 vector cosine on ETL index |
| §4.5(新) | bom_ai_cache 設計 |
| §5.4(新) | 6 個補充 endpoint |
| §7.3 | Qty 解析強化 + regex 表 + fallback |
| §8.4(新) | Heartbeat 機制 |
| §9 Phase | 6-8w → 10-12w + audit log 規劃 |
| §10 風險 | 加 4 條 v0.2 補風險 |
| §11(新) | 與 FormPanel 整合 + cost propagate |
| §12(新) | Variant Dimension 整合 3 種情境 |
| §13(新) | quote_start_date 定義 |
| §15 TBD | 7 → 11 項待確認 |

---

— End of SD v0.2 —

Cortex 規劃小組 · 2026-05-27 · 對齊 spec v0.5 · 整合 Cortex 既有 `ai_data_polic*` / `multiOrgService` / `database-oracle.js` Oracle 23 AI schema
