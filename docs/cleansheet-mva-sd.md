# Cleansheet × MVA 計價模組 SD

> **版本**:v0.5 / 2026-06-18
> **狀態**:Solution Design · v0.5 完整對齊 Excel Cleansheet §A 55 行 + DL/IDL Line-Dep 修正 + BG/BU 隔離 + 設備類別 + 權限 grant
> **方案**:全結構化(取代 Excel · 重做計算引擎)
> **基於**:`Rival 3+ Wired Mouse Cleansheet_China-20241011-19S.xlsx`(CN baseline)+ `Rival 3 Gen2 uni bom_*.xlsx`(Unit Cost 雙價結構)
> **關聯**:[bom-collection-sd.md](bom-collection-sd.md) v0.4 · [factory-matrix-schema-sd.md](factory-matrix-schema-sd.md) · [bom-architecture-report.md](bom-architecture-report.md) · [Cortex_互動Demo_v0.12.html](Cortex_互動Demo_v0.12.html)

## Changelog

- **v0.5 (2026-06-18)** — Excel §A 55 行完整對齊 + DL/IDL Line-Dep 修正(認錯 v0.11 設計偏差):
  - ❌ **廢除 `bom_factory_dl_role`(v0.11 引入的 7 工種費率表)** — 偏離 Excel 真實結構
  - ✅ **回歸 DL 4 category 結構**(對齊 Cleansheet r28-31):DL / Debug DL / Functional DL / ⭐ **Warehouse DL**(補)
  - ✅ **保留廠級單一 DL wage**(`bom_factory_baseline.dl_wage_per_hr_usd` 既有)· 對 4 category 通用 · 對齊 Excel r54
  - 🆕 **新增 `bom_factory_idl_linedep_wage` 表**(對齊 Cleansheet r43-46):Line Leader $403 / Technician $436.80 / ⭐ **IQC $403**(補) / Supervisor $403
  - 🆕 **`bom_cs_case_process` 補 4 欄**:`warehouse_dl_per_shift` + `line_leader_per_day` + `technician_per_day` + `iqc_per_day`
  - 🆕 **`compute_dl_cost` 改 10 步驟**(Excel C28-C58 完整對齊):Step 6 Total DL/day 含 Warehouse · Step 9 IDL Line-Dep wage 從 schema 取(不再 hardcode `$280/$320/$460`)
  - Excel §A 覆蓋率從 v0.11 的 ~50% 提升到 **100%**(55 substantive rows × 9 製程 ≈ 500 cell)
- **v0.4 (2026-06-17)** — BG/BU 隔離 + 設備類別 + 設定 master UI + 權限 grant:
  - 🔒 **`bom_factory_baseline` 加 `bg_code` / `bu_code`** — 同廠不同 BG 各有 baseline · 子表透過 baseline_id 自動 BG 隔離
  - 🏭 **設備改類別**(廢 `bom_factory_equipment` × 個別機 → 新 `bom_equip_category_catalog` + `bom_factory_equip_category_price` + `bom_cs_case_equip_category`)· 26 類 × BG · admin 跨 BG copy
  - 🔐 **新增 `bom_settings_admin_grant`** — user × scope × bg/bu/factory × view/edit/approve · 對齊既有「資料權限管理」3 層架構
  - 設定 master UI 7 sub-tab:廠 baseline / 類別 catalog / 類別單價 / DL wage / IDL Line-Dep wage / IDL Centralized / 耗材 / 權限 grant
  - `projects` + `bom_cs_case_factory` 加 `bg_code` / `bu_code`(SteelSeries=OPTO · WHOOP=CONSUMER)

- **v0.3 (2026-06-06)** — 對齊 BOM SD v0.4 的 3 新需求:
  - 加 `bom_cs_case_pkg` / `bom_cs_case_qty_scenario` 子表(§5.4 / §5.5)
  - 拆 `bom_cs_run_cell` → `bom_cs_run_result` fact table(多維,§6.2)
  - 計算引擎要跑 N variant × N qty × N pkg 個 result(SteelSeries 案 = 24 結果列)
  - Propagate 改寫(§8 改成 fact table 寫入)
  - §12 權限加 `VIEW_TRUE_COST` layer
  - §14.2 加新 TBD #11(qty scenario 對 MVA 影響重算需求)
- **v0.2 (2026-06-02)** — USER 拍板:計算精度允許 ε < 0.01 / Equipment blank/spare 暫 skip / IDL multiplier 抄 Excel 初始 / Process Flow sheet 純文字註記 / cs_run 軟刪 archived。新增 Demo HTML 對齊章節。
- **v0.1 (2026-06-02)** — 初版 SD,14 表 schema,5 Layer 架構。

---

## §0 摘要

把 EPM 現用 Excel Cleansheet 全結構化進 DB,可以 propagate / 跨案分析 / 不依賴 EPM 個人檔案管理。**14 個表 × 5 個 Layer**。

```
Layer 1: 製程目錄 + 模板(公司級,跨案)
Layer 2: 廠級資產 baseline(per factory,SCD Type 2 月度更新)
Layer 3: 案級配置(案 × 廠 × variant)
Layer 4: 計算結果(snapshot)
Layer 5: Audit + Propagate
```

---

## §1 背景與痛點

### 1.1 EPM Excel 現況

- 每個案子,每個廠 EPM 各自寫一份 Cleansheet xlsx(本案有 China 版)
- 廠級資產(設備、耗材、wage)散落在 EPM 個人 Excel,沒有公司 master
- 月度 wage / 設備異動 → 各 EPM 手動同步(常常漏)
- 計算引擎是 1500 行 Excel 公式,EPM 走人 + 新 EPM 看不懂 = 重做
- 跨案比對(同款設備在不同案的 utilization)無法做

### 1.2 與 BOM 模組的分工

| 領域 | 由誰算 | 影響 variant | 影響 factory |
|---|---|---|---|
| **Material cost** | BOM 端(採購策略總覽) | ✅ Per variant(黑/白用料不同) | ❌ 跨廠共用採購策略 |
| **MVA(Transformation)** | Cleansheet 端 | ❌ Per factory(色款不分,Yield 統一) | ✅ Per factory |
| **SG&A + Profit** | Baseline | ❌ | ✅ Per factory(集團政策可統一)|
| **Total Cost = M + MVA + SGA** | 整合於 §factory_matrix UI | ✅ | ✅ |

**核心承諾**:這份 SD 只處理 **MVA + SGA + Profit**,Material 由既有 BOM SD 處理。BOM lock 後 Material 自動 propagate 進 Cleansheet 結果表計算 Total。

---

## §2 整體架構

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 1 · 製程目錄 + 模板(公司級)                          │
│                                                              │
│   bom_process_catalog         9 個製程(可擴)               │
│   bom_process_template        產品類型模板(MOUSE / KB ...)  │
│   bom_process_template_step                                  │
└──────────────────────────────────────────────────────────────┘
                            ↑ 開新案時挑模板
┌──────────────────────────────────────────────────────────────┐
│ Layer 2 · 廠級資產 Baseline(per factory, SCD Type 2)        │
│                                                              │
│   bom_factory                 廠 master(CN/VN/TW)           │
│   bom_factory_baseline        wage/loss/sga/profit per 月版本│
│   bom_factory_idl_role        17 種 IDL 角色 wage            │
│   bom_factory_dep_years       折舊年限 per 設備分類          │
│   bom_factory_equipment       廠內設備庫(跨案共用)         │
│   bom_factory_consumable      廠內耗材庫(跨案共用)         │
└──────────────────────────────────────────────────────────────┘
                            ↑ 案 snapshot 鎖此版本
┌──────────────────────────────────────────────────────────────┐
│ Layer 3 · 案級配置(案 × 廠 × variant)                       │
│                                                              │
│   bom_cs_case_factory         一案一廠一份                   │
│   bom_cs_case_process         案內製程清單(從模板帶或自訂) │
│   bom_cs_case_idl_alloc       案內 IDL × 製程 multiplier     │
│   bom_cs_case_equipment       案內設備配置(子集 of master)  │
│   bom_cs_case_consumable      案內耗材配置                   │
└──────────────────────────────────────────────────────────────┘
                            ↓ compute()
┌──────────────────────────────────────────────────────────────┐
│ Layer 4 · 計算結果 snapshot                                  │
│                                                              │
│   bom_cs_component            9 個 cost component master     │
│   bom_cs_run                  一次計算 snapshot(可多 run)   │
│   bom_cs_run_cell             Process × Component matrix     │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ Layer 5 · Audit / Propagate                                  │
│                                                              │
│   bom_cs_audit_log            7 種 event_type                │
│   bom_cs_baseline_diff        新舊 baseline 差異報告         │
└──────────────────────────────────────────────────────────────┘
```

---

## §3 製程目錄與模板(Layer 1)

### 3.1 設計原則

USER 確認:**製程清單不寫死**。各產品差異大(滑鼠 vs 鍵盤 vs Cable vs 連接器),需 per 專案可自訂。

兩層:
- **`bom_process_catalog`**:公司級「曾用過的所有製程」庫,enum 表,管理員維護
- **`bom_process_template`**:常見產品類型模板,EPM 開新案可一鍵帶入 + 案內修改

### 3.2 `bom_process_catalog` schema

```sql
CREATE TABLE bom_process_catalog (
  process_code        VARCHAR2(40) PRIMARY KEY,    -- e.g. 'SMT_MAIN', 'WAVE_SOLDER', 'BB_ASSY'
  display_name_zh_tw  VARCHAR2(100) NOT NULL,
  display_name_en     VARCHAR2(100) NOT NULL,
  display_name_vi     VARCHAR2(100),
  category            VARCHAR2(40) NOT NULL,       -- PCBA / ASSEMBLY / QUALITY / LOGISTICS / TESTING / CUSTOM
  description         CLOB,
  is_active           NUMBER(1) DEFAULT 1,
  display_order       NUMBER DEFAULT 0,
  created_by          NUMBER REFERENCES users(id),
  created_at          TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at          TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

**初始資料**(從 Cleansheet 提取):

| process_code | zh_TW | category |
|---|---|---|
| `SMT_MAIN` | SMT 主板 | PCBA |
| `WAVE_SOLDER` | 波焊 Wave Solder | PCBA |
| `ROUTER_OFFLINE` | 離線分板 Router | PCBA |
| `LASER_ETCH` | 雷射雕刻 | PCBA |
| `BB_ASSY` | 整機組裝 BB Assy | ASSEMBLY |
| `BB_TEST` | 整機測試 BB Testing | TESTING |
| `MAT_MGMT` | 物料管理 | LOGISTICS |
| `Q_SMT` | SMT 品保 | QUALITY |
| `Q_BB` | 整機品保 | QUALITY |
| `COMMON` | 跨製程共用 | CUSTOM |

### 3.3 `bom_process_template`

```sql
CREATE TABLE bom_process_template (
  template_id         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code                VARCHAR2(40) UNIQUE NOT NULL,   -- e.g. 'MOUSE_STD', 'KEYBOARD_STD'
  name_zh_tw          VARCHAR2(200),
  name_en             VARCHAR2(200),
  name_vi             VARCHAR2(200),
  product_category    VARCHAR2(40),                   -- MOUSE / KEYBOARD / HUB / CONNECTOR / CABLE / CUSTOM
  description         CLOB,
  is_official         NUMBER(1) DEFAULT 1,            -- 1=公司預設,0=用戶自訂
  created_by          NUMBER REFERENCES users(id),
  created_at          TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE TABLE bom_process_template_step (
  template_id         NUMBER REFERENCES bom_process_template(template_id) ON DELETE CASCADE,
  step_order          NUMBER NOT NULL,
  process_code        VARCHAR2(40) REFERENCES bom_process_catalog(process_code),
  is_optional         NUMBER(1) DEFAULT 0,
  PRIMARY KEY (template_id, step_order)
);
```

**預設 4-5 個模板**:

| code | name | steps |
|---|---|---|
| `MOUSE_STD` | 滑鼠標準製程(本案) | SMT_MAIN → WAVE_SOLDER → ROUTER_OFFLINE → LASER_ETCH → BB_ASSY → BB_TEST → MAT_MGMT → Q_SMT → Q_BB |
| `KEYBOARD_STD` | 鍵盤標準製程 | (待補)|
| `CONNECTOR_HV` | 高壓連接器 | (待補)|
| `CABLE_USB` | USB Cable | (待補)|
| `CUSTOM` | 空白 | 由 EPM 自由加 |

---

## §4 廠級資產 Baseline(Layer 2)

### 4.1 設計原則

USER 答覆:「保留多國家架構,目前只有 China」+「每月重 import 請詳細說明」。

採 **SCD Type 2(Slowly Changing Dimension)**:
- 每月新版本一列,舊版 `effective_to` 改成昨天
- 已 lock 案 snapshot 鎖住舊 baseline,不受影響
- Draft 案可選 reprice 用新 baseline

### 4.2 表結構

```sql
-- 廠基本資料(stable,極少改)
CREATE TABLE bom_factory (
  factory_code        VARCHAR2(10) PRIMARY KEY,        -- 'CN' / 'VN' / 'TW'
  full_name           VARCHAR2(100),                    -- 'Made In China · Foxlink Suzhou'
  country_iso         CHAR(2),                          -- 'CN' / 'VN' / 'TW'
  currency_default    VARCHAR2(3) DEFAULT 'USD',
  ledger_book_id      VARCHAR2(40),                     -- 對 ERP gl_daily_rates 反推
  is_active           NUMBER(1) DEFAULT 1,
  created_at          TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- Baseline 版本 (SCD Type 2)
CREATE TABLE bom_factory_baseline (
  baseline_id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  factory_code           VARCHAR2(10) REFERENCES bom_factory(factory_code),
  version_label          VARCHAR2(40),                  -- 'CN-2024Q4' / 'CN-2025Q1'
  effective_from         DATE NOT NULL,
  effective_to           DATE,                          -- NULL = 當前版本
  status                 VARCHAR2(20) DEFAULT 'draft',  -- draft / active / superseded / retired
  -- baseline core params (對應 SupplierBaseInput)
  dl_wage_per_hr_usd     NUMBER(10,4),                  -- 4.95
  floor_sqft_prod        NUMBER(10,4),                  -- 14.4276
  floor_sqft_warehouse   NUMBER(10,4),                  -- 9.0156
  floor_sqft_boxbuild    NUMBER(10,4),                  -- 11.088
  loss_factor_pct        NUMBER(10,6),                  -- 0.0008
  sga_pct                NUMBER(5,4),                   -- 0.02
  profit_pct             NUMBER(5,4),                   -- 0.14
  annual_demand_default  NUMBER,                        -- 418000
  vat_rate_pct           NUMBER(5,4),                   -- 0.17
  inbound_freight_annual NUMBER(15,2),                  -- 2500
  motherboard_cost_ref   NUMBER(10,4),                  -- 8.683(VAT 計算用,可從 BOM 帶)
  -- metadata
  source_xlsx_file       VARCHAR2(255),
  imported_at            TIMESTAMP,
  imported_by            NUMBER REFERENCES users(id),
  approved_at            TIMESTAMP,
  approved_by            NUMBER REFERENCES users(id),
  notes                  CLOB
);

CREATE INDEX bfb_factory_active_ix
  ON bom_factory_baseline (factory_code, status, effective_from);

-- 17 種 IDL 角色 wage (per baseline)
CREATE TABLE bom_factory_idl_role (
  baseline_id        NUMBER REFERENCES bom_factory_baseline(baseline_id) ON DELETE CASCADE,
  role_code          VARCHAR2(40),                      -- 'OPS_MGR', 'SECTION_MGR', 'ENGINEER', ...
  display_name_en    VARCHAR2(100),
  category           VARCHAR2(40),                      -- MFG_IDL / CENTRALIZED_SERVICE
  annual_rate_usd    NUMBER(15,2),
  weekly_rate_usd    NUMBER(15,2),                      -- annual / 50
  PRIMARY KEY (baseline_id, role_code)
);

-- 🆕 v0.5 · IDL Line-Dependent wage(對應 Cleansheet r43-46 · 取代 v0.11 hardcode + 補 IQC)
-- 4 個角色 weekly wage · per baseline · 跟 IDL Centralized 17 角色完全分開
CREATE TABLE bom_factory_idl_linedep_wage (
  baseline_id           NUMBER REFERENCES bom_factory_baseline(baseline_id) ON DELETE CASCADE,
  role_code             VARCHAR2(40),                   -- 'LINE_LEADER' / 'TECHNICIAN' / 'IQC' / 'SUPERVISOR'
  display_name_zh       VARCHAR2(100),
  display_name_en       VARCHAR2(100),
  weekly_wage_usd       NUMBER(10,4) NOT NULL,          -- $403 / $436.80 / $403 / $403
  copied_from           VARCHAR2(40),                   -- admin copy 來源 BG(e.g. 'OPTO')
  notes                 CLOB,
  created_by            NUMBER REFERENCES users(id),
  created_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_by            NUMBER REFERENCES users(id),
  updated_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
  PRIMARY KEY (baseline_id, role_code)
);
-- 4 個 default 角色(per baseline 一份):
--   LINE_LEADER  Line Leader 線長          $403.00 / wk
--   TECHNICIAN   Technician 技術員         $436.80 / wk
--   IQC          IQC 來料品保(v0.11 漏)  $403.00 / wk
--   SUPERVISOR   Supervisor 主任           $403.00 / wk

-- ❌ v0.5 廢除(v0.11 引入 · 偏離 Excel 真實結構):
-- DROP TABLE bom_factory_dl_role;
-- 廠級 DL wage 回歸 bom_factory_baseline.dl_wage_per_hr_usd 單一值
-- 對 4 個 DL category(DL / Debug DL / Functional DL / Warehouse DL)通用

-- 折舊年限 per 設備分類 (per baseline)
CREATE TABLE bom_factory_dep_years (
  baseline_id        NUMBER REFERENCES bom_factory_baseline(baseline_id) ON DELETE CASCADE,
  category           VARCHAR2(40),                      -- 'SMT' / 'SMT_TEST' / 'BB_ASSY' / 'BB_TEST' / 'IT' / ...
  years              NUMBER NOT NULL,
  PRIMARY KEY (baseline_id, category)
);
```

### 4.3 廠級設備庫(跨案共用)

設計**雙層**:廠級 master + 案級 binding。

**理由**:同款 DEK / FUJI NXT 設備跨多案共用,但每案占用 capacity 不同。Excel 把兩層糊一起,DB 要拆。

```sql
CREATE TABLE bom_factory_equipment (
  equipment_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  factory_code          VARCHAR2(10) REFERENCES bom_factory(factory_code),
  equipment_code        VARCHAR2(80),                  -- 廠內編號
  description           VARCHAR2(500),                 -- 'DEK', 'FUJI NXT M3S*6+M6S*1'
  manufacturer          VARCHAR2(100),
  model                 VARCHAR2(100),
  part_no               VARCHAR2(80),
  equipment_type        VARCHAR2(40),                  -- MRO / EQUIPMENT / FIXTURE / TOOLING / STENCIL / CARRIER
  custom_or_standard    VARCHAR2(20),                  -- CUSTOM / STANDARD
  default_process_code  VARCHAR2(40) REFERENCES bom_process_catalog(process_code),
  acquisition_cost_usd  NUMBER(15,2),
  salvage_value_usd     NUMBER(15,2) DEFAULT 0,
  default_useful_life_yrs NUMBER(5,2),
  is_active             NUMBER(1) DEFAULT 1,
  introduced_baseline_id NUMBER REFERENCES bom_factory_baseline(baseline_id),
  retired_baseline_id    NUMBER REFERENCES bom_factory_baseline(baseline_id),
  notes                 CLOB,
  created_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at            TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE INDEX bfe_factory_active_ix
  ON bom_factory_equipment (factory_code, is_active);

CREATE TABLE bom_factory_consumable (
  consumable_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  factory_code           VARCHAR2(10) REFERENCES bom_factory(factory_code),
  consumable_code        VARCHAR2(80),
  description            VARCHAR2(500),
  default_process_code   VARCHAR2(40) REFERENCES bom_process_catalog(process_code),
  unit_cost_usd          NUMBER(15,4),
  unit_of_measure        VARCHAR2(20),                  -- PCS / KG / M / ROLL / L
  annual_usage_default   NUMBER,                        -- 廠級每年消耗量(參考)
  is_active              NUMBER(1) DEFAULT 1,
  introduced_baseline_id NUMBER REFERENCES bom_factory_baseline(baseline_id),
  retired_baseline_id    NUMBER REFERENCES bom_factory_baseline(baseline_id),
  notes                  CLOB,
  created_at             TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at             TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

### 4.4 廠級資產月度更新流程(USER 要的詳細說明)

```
─────────────────────────────────────────────────────────
Month End → EPM 上傳新 Cleansheet xlsx
─────────────────────────────────────────────────────────

  ┌─ Step 1: Admin UI 「廠 baseline 更新」按鈕
  │  → 上傳新 xlsx (含 SupplierBaseInput / Equipment List / Consumables)
  │  → 後端 job: bom_cs_baseline_import.py
  │
  ├─ Step 2: 解析新 xlsx
  │  → 寫入 bom_factory_baseline (status='draft', effective_from=null)
  │  → 寫入 bom_factory_idl_role / bom_factory_dep_years (連 baseline_id)
  │  → 解析 Equipment List:
  │      • 用 (factory_code, equipment_code) 比對既有 bom_factory_equipment
  │      • 新增 → 標 ADDED
  │      • 已有但 acquisition_cost / useful_life 不同 → 標 CHANGED
  │      • 既有但新 xlsx 沒有 → 標 RETIRED(不真刪,標 retired_baseline_id)
  │  → 同樣處理 Consumables
  │  → 計算差異寫入 bom_cs_baseline_diff
  │
  ├─ Step 3: UI Preview Diff
  │  ┌────────────────────────────────────────────────────────┐
  │  │ CN Baseline 2024Q4 → 2025Q1 Diff Preview              │
  │  ├────────────────────────────────────────────────────────┤
  │  │ DL wage:        $4.95 → $5.20  ↑ +5.05%                │
  │  │ Sec Mgr:        $60320 → $63300  ↑ +4.94%              │
  │  │ Floor sqft:     $14.4276 → $14.85  ↑ +2.93%            │
  │  │ Loss factor:    0.08% → 0.07%  ↓                       │
  │  │                                                        │
  │  │ Equipment changes (3):                                 │
  │  │  + NEW: FUJI NXT M6S (Q-SMT, $850k)                    │
  │  │  ✎ CHANGED: DEK acq_cost $84k → $92k                   │
  │  │  - RETIRED: TR7500 AOI(汰換)                          │
  │  │                                                        │
  │  │ Consumables changes (1):                               │
  │  │  ✎ CHANGED: 锡膏 unit_cost $52→$58                     │
  │  │                                                        │
  │  │ Impact estimation:                                     │
  │  │  • 影響中的 draft 案: 3 個(QT-2026-0148, ...)         │
  │  │  • 已 lock 案: 12 個(不受影響)                       │
  │  │  • 預估 MVA per unit: $1.86 → $1.95(估算)            │
  │  └────────────────────────────────────────────────────────┘
  │  → EPM 可逐項勾選 approve / reject(沒勾的不套用)
  │
  ├─ Step 4: 確認套用
  │  → 舊 baseline.effective_to = today
  │  → 舊 baseline.status = 'superseded'
  │  → 新 baseline.effective_from = today + 1
  │  → 新 baseline.status = 'active'
  │  → 新 baseline.approved_by, approved_at 寫入
  │  → 寫 audit_log(event='BASELINE_UPDATED')
  │
  ├─ Step 5: Notify 影響到的案子
  │  → 找所有 bom_cs_case_factory WHERE status='draft' AND
  │    baseline_id IN (this factory's old baselines)
  │  → 發 user_notification(類別:bom_cs_baseline_updated)
  │  → UI 顯示「baseline 已更新,點此 reprice」chip
  │
  └─ Step 6: 各案 EPM 決定
     → Reprice with new baseline → 觸發 cs_run 重算
     → 或 keep with old baseline → 標記 baseline_locked_manually=1

─────────────────────────────────────────────────────────
已 lock 的案子:不動。Snapshot 已凍結。
若客戶議價需照新 baseline → admin 手動 unlock + reprice
─────────────────────────────────────────────────────────
```

---

## §5 案級配置(Layer 3)

### 5.1 表結構

```sql
-- 一案一廠一份(SteelSeries 案 × CN = 1 列,× VN = 1 列,× TW = 1 列)
CREATE TABLE bom_cs_case_factory (
  case_factory_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id              NUMBER REFERENCES projects(id) ON DELETE CASCADE,
  factory_code         VARCHAR2(10) REFERENCES bom_factory(factory_code),
  baseline_id          NUMBER REFERENCES bom_factory_baseline(baseline_id), -- snapshot
  variant_key          VARCHAR2(40),                 -- NULL = MVA 跨色共用(預設)· 預留色差欄位
  process_template_id  NUMBER REFERENCES bom_process_template(template_id),
  annual_demand        NUMBER,                        -- 此案年量(可 override factory default)
  -- status
  status               VARCHAR2(20) DEFAULT 'draft', -- draft / under_review / locked / superseded
  baseline_locked_manually NUMBER(1) DEFAULT 0,       -- 1 = 不跟著 factory baseline 升版
  locked_at            TIMESTAMP,
  locked_by            NUMBER REFERENCES users(id),
  -- metadata
  source_xlsx_file     VARCHAR2(255),                 -- import 來源(若有)
  imported_at          TIMESTAMP,
  imported_by          NUMBER REFERENCES users(id),
  created_at           TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at           TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT bom_cs_case_factory_uk UNIQUE (case_id, factory_code, variant_key)
);

-- 案內製程清單(從 template 帶入後可改)
-- 🆕 v0.5 · 完整對齊 Excel Cleansheet §A 55 行
CREATE TABLE bom_cs_case_process (
  case_factory_id          NUMBER REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE,
  process_code             VARCHAR2(40) REFERENCES bom_process_catalog(process_code),
  step_order               NUMBER NOT NULL,
  -- §A.1 Staffed Hours(r7-11)
  working_hours_per_day    NUMBER(5,2),                -- r8  · 23 (SMT 23h, BB Assy 20h)
  working_days_per_week    NUMBER(5,2),                -- r9  · 6.67 (SMT) / 6 (BB)
  shifts_per_day           NUMBER(2),                  -- r11 · 2 (SMT) / 1 (BB)
  -- §A.2 Throughput(r12-16)
  takt_seconds             NUMBER(10,4),               -- r13 · TAKT (sec)
  yield_pct                NUMBER(5,4),                -- r15 · 0.98
  efficiency_pct           NUMBER(5,4),                -- r16 · 0.95
  -- §A.4 Production Capacity(r22-26)
  lines_installed          NUMBER(3) DEFAULT 1,        -- r23
  debug_lines_installed    NUMBER(3) DEFAULT 0,        -- r26
  -- §A.5 Direct Labor Required · 4 個 DL category · 對齊 r28-31
  dl_per_shift             NUMBER(5,2),                -- r28 · DL per line per shift
  debug_dl_per_shift       NUMBER(5,2),                -- r29 · Debug DL
  functional_dl_per_shift  NUMBER(5,2),                -- r30 · Functional DL
  warehouse_dl_per_shift   NUMBER(5,2) DEFAULT 0,      -- r31 · ⭐ v0.5 補 Warehouse DL(Material Mgmt 用)
  -- §A.6 IDL Line-Independent · 對齊 r35-40(per shift 跟 per day 兩種獨立 count)
  line_leader_per_shift    NUMBER(5,2),                -- r35 · 0.5
  technician_per_shift     NUMBER(5,2),                -- r36 · 0.5
  line_leader_per_day      NUMBER(5,2) DEFAULT 0,      -- r37 · ⭐ v0.5 補(原來合在 per_shift)
  technician_per_day       NUMBER(5,2) DEFAULT 0,      -- r38 · ⭐ v0.5 補
  iqc_per_day              NUMBER(5,2) DEFAULT 0,      -- r39 · ⭐ v0.5 補 IQC 來料品保(v0.11 完全漏)
  supervisor_per_day       NUMBER(5,2),                -- r40 · 0.25
  -- §A.8 SEA(r47-49)
  sea_hours_per_day        NUMBER(5,2) DEFAULT 10,     -- r48
  sea_hours_per_week       NUMBER(5,2) DEFAULT 60,     -- r49
  -- TAKT 來源(若引用 Process Flow sheet)
  takt_source              VARCHAR2(80),               -- 'SMT Process Flow!I3' (debug 用)
  notes                    CLOB,
  PRIMARY KEY (case_factory_id, process_code)
);

-- 案內 IDL 角色 × 製程 multiplier matrix
-- 對應 Cleansheet rows 64-83 的 J64/L64/N64... 各製程的 multiplier
CREATE TABLE bom_cs_case_idl_alloc (
  case_factory_id      NUMBER REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE,
  process_code         VARCHAR2(40) REFERENCES bom_process_catalog(process_code),
  role_code            VARCHAR2(40),                  -- 對 bom_factory_idl_role.role_code
  multiplier           NUMBER(10,6),                  -- 例 0.08, 0.125, 0.005
  PRIMARY KEY (case_factory_id, process_code, role_code)
);

-- 案內設備配置(子集 of factory_equipment)
CREATE TABLE bom_cs_case_equipment (
  case_factory_id           NUMBER REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE,
  equipment_id              NUMBER REFERENCES bom_factory_equipment(equipment_id),
  process_code              VARCHAR2(40) REFERENCES bom_process_catalog(process_code), -- 可改 factory default
  line_qty                  NUMBER(5),                 -- I col
  qty_per_line              NUMBER(5),                 -- J col (e.g. 752 個 ESD Tray)
  useful_life_override_yrs  NUMBER(5,2),               -- 可 override factory_equipment.default
  acquisition_cost_override_usd NUMBER(15,2),          -- 可 override(汰換、討論價)
  notes                     CLOB,
  PRIMARY KEY (case_factory_id, equipment_id)
);

-- 案內耗材配置
CREATE TABLE bom_cs_case_consumable (
  case_factory_id         NUMBER REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE,
  consumable_id           NUMBER REFERENCES bom_factory_consumable(consumable_id),
  process_code            VARCHAR2(40) REFERENCES bom_process_catalog(process_code),
  annual_usage_qty        NUMBER(15,4),
  unit_cost_override_usd  NUMBER(15,4),
  notes                   CLOB,
  PRIMARY KEY (case_factory_id, consumable_id)
);
```

### 5.2 案級 vs 廠級 — 何時 override

| 情境 | 動廠級 master | 動案級 binding |
|---|---|---|
| 廠新增 / 汰換設備 | ✅ (next baseline 月更) | ❌ |
| Wage 漲價 | ✅ (next baseline) | ❌ |
| 此案佔 DEK 50% capacity(別案 50%) | ❌ | ✅ `line_qty=0.5` |
| 此案 SMT 製程把 DEK 改用更新版 | ❌ | ✅ `acquisition_cost_override` |
| 此案 BB Test 設備提早攤提(新案壓力) | ❌ | ✅ `useful_life_override_yrs` |
| 此案某設備從 SMT 製程歸到 BB Test | ❌ | ✅ `process_code` 改 |

### 5.3 USER 問:Equipment / Consumables 詳細做法

#### 情境 A:第一次 import CN xlsx(初始化廠 master)

```python
def import_first_baseline(factory_code, xlsx_path):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)

    # 1. SupplierBaseInput → bom_factory_baseline 新列(status='draft')
    baseline_id = insert_baseline(factory_code, wb['SupplierBaseInput'])
    insert_idl_roles(baseline_id, wb['SupplierBaseInput'])
    insert_dep_years(baseline_id, wb['SupplierBaseInput'])

    # 2. Equipment List → 拆兩部分
    for row in wb['Equipment List'].iter_rows(min_row=3, values_only=True):
        bucket, type_name, custom_std, desc, manuf, model, pn, useful_life, \
        line_qty, qty_per_line, *_, equip_cost, *_ = row

        if not equip_cost:
            continue

        # 寫廠 master(若不存在)
        equipment_id = upsert_factory_equipment(
            factory_code, code=normalize_code(desc),
            description=desc, manufacturer=manuf, model=model,
            equipment_type=type_name, custom_or_standard=custom_std,
            default_process_code=bucket_to_process(bucket),
            acquisition_cost_usd=equip_cost,
            default_useful_life_yrs=useful_life,
            introduced_baseline_id=baseline_id
        )

        # 寫案 binding(本案占用配置)
        # 暫存於 stage 表,等 user 開新案時帶入
        stage_case_equipment.append({
            'equipment_id': equipment_id,
            'process_code': bucket_to_process(bucket),
            'line_qty': line_qty,
            'qty_per_line': qty_per_line,
        })

    # 3. Consumables → 同樣 pattern
```

#### 情境 B:第二份 xlsx(同廠新 baseline 或新案)

```
Use case 1: 同廠 baseline 月更
  → 解析新 xlsx → 對比舊 factory_equipment / factory_consumable
  → 走 §4.4 流程(diff preview / approve / SCD step)

Use case 2: 同廠新案(SteelSeries vs Razer)
  → factory master 不動
  → 開新 bom_cs_case_factory + bom_cs_case_process + bom_cs_case_equipment
  → 若新案有「廠內沒有的設備」→ EPM 須先去 factory master 加,再 case bind

Use case 3: 新廠首次 import (e.g. VN 進來)
  → 重跑情境 A 流程
  → VN 廠的 factory_equipment 跟 CN 完全獨立(設備不共用)
```

#### 情境 C:案中發現要改 binding(line qty / qty per line)

```
EPM 在 §Cleansheet UI 直接編 bom_cs_case_equipment.line_qty
→ trigger recompute(若案非 locked)
→ 新 cs_run snapshot
```

### 5.4 案級 Qty Scenarios(v0.3 新增 · 對應 bom-collection-sd §18)

每案可配 N 個 qty scenario(SteelSeries 案 = 2 個:Low 100K / High 418K)。每個 scenario 觸發獨立 cs_run cell 計算(因 lines / weekly_output 變動)。

```sql
CREATE TABLE bom_cs_case_qty_scenario (
  scenario_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_factory_id  NUMBER REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE,
  scenario_code    VARCHAR2(40) NOT NULL,            -- 'LOW' / 'HIGH' / 'CUSTOM_US'
  scenario_label_zh VARCHAR2(100),                   -- '低批量' / '高批量' / '北美專屬'
  scenario_label_en VARCHAR2(100),
  target_qty       NUMBER NOT NULL,                  -- 100000 / 418000
  region_applies   VARCHAR2(200),                    -- 'US' / 'Global' / 'EU,APAC'
  is_baseline      NUMBER(1) DEFAULT 0,              -- 1 = 主視角(預設展示的那個)
  notes            CLOB,
  created_at       TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT bcqs_uk UNIQUE (case_factory_id, scenario_code)
);
```

**影響**:每 case_factory 至少要有 1 個 scenario(`'BASELINE'`)。多 scenario 時計算引擎要跑 N 次 → cs_run_cell 用 `qty_scenario_code` 區分;cs_run_result 也用此維度展開。

### 5.5 案級 PKG Versions(v0.3 新增 · 對應 bom-collection-sd §17)

每案可配 N 個 PKG 版本(SteelSeries 案 = 2 個:商包 / 工包)。每版本有獨立 items list 跟 roll-up cost。

```sql
CREATE TABLE bom_cs_case_pkg (
  pkg_id               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_factory_id      NUMBER REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE,
  pkg_code             VARCHAR2(40) NOT NULL,        -- 'RETAIL' / 'BULK' / 'CUSTOM_AAPL'
  pkg_label_zh        VARCHAR2(100),                 -- '商包' / '工包'
  pkg_label_en        VARCHAR2(100),
  effective_at        DATE,
  source_xlsx_sheet   VARCHAR2(200),                 -- 'PKG BOM 20241023_Amber'
  items_count         NUMBER,                        -- 16 (商包) / 3 (工包)
  -- Roll-up
  total_cost_true_usd  NUMBER(15,6),
  total_cost_quote_usd NUMBER(15,6),
  markup_pct_avg       NUMBER(8,4),
  -- 主視角
  is_primary           NUMBER(1) DEFAULT 0,
  -- 適用情境
  channel_applies_json CLOB,                          -- ['retail','online'] / ['spare_parts','b2b']
  notes                CLOB,
  created_at           TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT bccp_uk UNIQUE (case_factory_id, pkg_code)
);

-- PKG 內子料(對應 bom-collection-sd §17.2 結構)
CREATE TABLE bom_cs_case_pkg_item (
  pkg_item_id         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pkg_id              NUMBER REFERENCES bom_cs_case_pkg(pkg_id) ON DELETE CASCADE,
  item_seq            NUMBER,
  item_name           VARCHAR2(200),
  spec                CLOB,
  qty_per_unit        NUMBER,
  unit_of_measure     VARCHAR2(20),
  vendor_id           NUMBER,
  -- 雙價
  source_currency     VARCHAR2(3),
  true_cost_source    NUMBER(15,6),
  fx_rate             NUMBER(15,6),
  true_cost_usd       NUMBER(15,6),
  quote_price_usd     NUMBER(15,6),
  markup_pct          NUMBER(8,4),
  -- 其他
  lead_time_days      NUMBER,
  remark              VARCHAR2(500),
  is_sustainable      NUMBER(1) DEFAULT 0
);
```

### 5.6 維度組合範例

SteelSeries 案 × CN factory:
- 2 qty scenarios(`LOW=100K`, `HIGH=418K`)
- 2 pkg versions(`RETAIL=商包`, `BULK=工包`)
- 2 variants(`black`, `white`)
- → 8 個維度組合 × 3 廠 = **24 個 `bom_cs_run_result` 列**

---

## §6 計算結果(Layer 4)

### 6.1 9 個 Cost Component master

```sql
CREATE TABLE bom_cs_component (
  component_code      VARCHAR2(40) PRIMARY KEY,
  display_name_zh_tw  VARCHAR2(100),
  display_name_en     VARCHAR2(100),
  category            VARCHAR2(40),               -- LABOR / EQUIPMENT / FACILITY / OTHERS
  is_common_only      NUMBER(1) DEFAULT 0,         -- 1 = 只走 Common 欄(Freight/VAT/Loss)
  display_order       NUMBER,
  is_active           NUMBER(1) DEFAULT 1
);
```

**初始資料**:

| code | en | category | common_only |
|---|---|---|---|
| `DL_CPU` | Direct Labor (CPU) | LABOR | 0 |
| `IDL_CPU` | Indirect Labor (CPU) | LABOR | 0 |
| `EQUIP_MRO` | Equipment MRO | EQUIPMENT | 0 |
| `EQUIP_DEPR` | Equipment Depreciation | EQUIPMENT | 0 |
| `IND_MAT` | Indirect Materials (Consumables) | EQUIPMENT | 0 |
| `FACILITY` | Facility & Utility | FACILITY | 0 |
| `FREIGHT` | Inbound Freight | OTHERS | 1 |
| `VAT` | VAT | OTHERS | 1 |
| `LOSS` | Loss Factor | OTHERS | 1 |

(加總 = MVA)

### 6.2 計算 snapshot(v0.3 拆 header + result fact)

> **v0.3 改動**:原 `bom_cs_run` + `bom_cs_run_cell` (Process × Component matrix)+ 散在 run 上的 `bom_material_*` 欄位 → 拆成 **3 表**(run header + process cell + result fact),用 BOM 的 `qty_scenario / pkg_code / variant_key` 維度展開 N 列 result。

```sql
-- (1) Run header — 一次 compute 的 metadata · 一案一廠多 scenario 共享同 run
CREATE TABLE bom_cs_run (
  run_id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_factory_id         NUMBER REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE,
  run_label               VARCHAR2(80),                  -- 'v1' / '客戶議價 #3'
  status                  VARCHAR2(20) DEFAULT 'computing', -- computing / ready / archived / failed
  compute_engine          VARCHAR2(20) DEFAULT 'db_v1',
  computed_at             TIMESTAMP,
  computed_by             NUMBER REFERENCES users(id),
  -- Run-level MVA(可能跟 qty scenario 相關 · 若 lines 變 → 拆多列在 cell 表)
  motherboard_cost_usd    NUMBER(15,6),                  -- from BOM main board
  -- error / warnings
  errors_json             CLOB,
  warnings_json           CLOB,
  raw_inputs_json         CLOB,                          -- 整份 input snapshot 備查
  created_at              TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- (2) Process × Component matrix — 對應 Excel Price Summary 還原
-- 多 qty scenario 時拆多份 cell 結果(因 lines 變導致每 process cost 變)
CREATE TABLE bom_cs_run_cell (
  run_id                  NUMBER REFERENCES bom_cs_run(run_id) ON DELETE CASCADE,
  qty_scenario_code       VARCHAR2(40) DEFAULT 'BASELINE',  -- v0.3 新增 · 對應 §5.5
  process_code            VARCHAR2(40),                  -- 'SMT_MAIN' / 'COMMON' / ...
  component_code          VARCHAR2(40) REFERENCES bom_cs_component(component_code),
  cost_per_unit_usd       NUMBER(15,6),
  -- Debug info
  formula_text            VARCHAR2(500),                 -- 例 '=(C56+C55)/C24'
  source_cell_ref         VARCHAR2(80),                  -- 例 'Cleansheet!C58'
  intermediate_json       CLOB,
  PRIMARY KEY (run_id, qty_scenario_code, process_code, component_code)
);

CREATE INDEX bcrc_run_proc_ix ON bom_cs_run_cell (run_id, qty_scenario_code, process_code);

-- (3) Run result fact — v0.3 新增 · 多維結果 fact table
-- 對應 bom-collection-sd §19.2.3
CREATE TABLE bom_cs_run_result (
  result_id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id               NUMBER REFERENCES bom_cs_run(run_id) ON DELETE CASCADE,
  -- 維度(來自 bom_cs_case_qty_scenario / bom_cs_case_pkg / project.variants)
  factory_code         VARCHAR2(10),
  variant_key          VARCHAR2(40),
  qty_scenario_code    VARCHAR2(40),
  pkg_code             VARCHAR2(40),
  -- True 側
  material_true_usd    NUMBER(15,6),                  -- 從 BOM 採購策略 SUMPRODUCT(true_cost)
  pkg_true_usd         NUMBER(15,6),                  -- 從 bom_cs_case_pkg.total_cost_true_usd
  mva_usd              NUMBER(15,6),                  -- 從 bom_cs_run_cell sum (該 qty_scenario)
  sga_usd              NUMBER(15,6),                  -- 0.02 × motherboard
  profit_amount_usd    NUMBER(15,6),                  -- 0.14 × (mva + motherboard)
  total_true_usd       NUMBER(15,6) GENERATED ALWAYS AS (
    material_true_usd + pkg_true_usd + mva_usd + sga_usd + profit_amount_usd
  ) VIRTUAL,
  -- Quote 側
  material_quote_usd   NUMBER(15,6),                  -- 從 BOM 採購策略 SUMPRODUCT(quote_price)
  pkg_quote_usd        NUMBER(15,6),
  total_quote_usd      NUMBER(15,6) GENERATED ALWAYS AS (
    material_quote_usd + pkg_quote_usd + mva_usd + sga_usd + profit_amount_usd
  ) VIRTUAL,
  -- Margin(自動)
  margin_amount_usd    NUMBER(15,6) GENERATED ALWAYS AS (total_quote_usd - total_true_usd) VIRTUAL,
  material_margin_pct  NUMBER(8,4) GENERATED ALWAYS AS (
    (total_quote_usd - material_true_usd - pkg_true_usd) / NULLIF(total_quote_usd, 0)
  ) VIRTUAL,
  gross_margin_pct     NUMBER(8,4) GENERATED ALWAYS AS (
    (total_quote_usd - total_true_usd) / NULLIF(total_quote_usd, 0)
  ) VIRTUAL,
  computed_at          TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT bcrr_uk UNIQUE (run_id, factory_code, variant_key, qty_scenario_code, pkg_code)
);

-- 各維度 pivot 用
CREATE INDEX bcrr_run_ix ON bom_cs_run_result (run_id);
CREATE INDEX bcrr_pivot_ix ON bom_cs_run_result (run_id, factory_code, variant_key, qty_scenario_code, pkg_code);
```

**範例**:SteelSeries 案一次 compute → 3 factories × 2 variants × 2 qty_scenarios × 2 pkg_versions = **24 列 `bom_cs_run_result`**。

每 result 列含 4 個 total(True / Quote · per variant)+ margin 自動算 → 直接 SQL pivot 出客戶要的視角。

---

## §7 計算引擎(Compute Service)

### 7.1 對應 Excel 五區公式

| Excel 區 | DB 計算 service | Output |
|---|---|---|
| **A. DL Cost** | `compute_dl_cost(case_factory_id, process_code)` | `cs_run_cell` row (component=DL_CPU)|
| **B. IDL Cost** | `compute_idl_cost(case_factory_id, process_code)` | `cs_run_cell` row (component=IDL_CPU)|
| **C. Equipment & Facilities** | `compute_equipment_cost(...)` + `compute_facility_cost(...)` | 4 rows (EQUIP_MRO, EQUIP_DEPR, IND_MAT, FACILITY) |
| **D. Others** | `compute_others_cost(...)` (Freight + VAT + Loss) | 3 rows (Common 欄,FREIGHT/VAT/LOSS)|
| **E. Total** | `compute_mva_total(...)` + `compute_total_tc(...)` | `cs_run.mva_total`, `cs_run.total_tc` |

### 7.2 關鍵公式對應(以 DL Cost 為例)

```python
def compute_dl_cost(case_factory, process):
    """
    對應 Excel Cleansheet!C58 公式:
      DL_Cost_per_unit = (DL_Cost_per_week + IDL_Line_Dep_Cost_per_week) / Weekly_Output
    """
    bp = case_factory.baseline  # bom_factory_baseline
    p = process                  # bom_cs_case_process

    # Step 1: UPH (Cleansheet!C14)
    uph = 3600 / p.takt_seconds * p.yield_pct * p.efficiency_pct

    # Step 2: Max Output per week per line (Cleansheet!C21)
    working_hours_per_week = p.working_hours_per_day * p.working_days_per_week
    max_output_per_line = working_hours_per_week * uph

    # Step 3: Lines installed (Cleansheet!C23)
    avg_weekly_demand = case_factory.annual_demand / 50
    max_demand_per_week = avg_weekly_demand * 1.2
    lines = math.ceil(max_demand_per_week / max_output_per_line)

    # Step 4: Weekly output (Cleansheet!C24)
    weekly_output = max_output_per_line * lines

    # Step 5: Total DL per day (Cleansheet!C33)
    total_dl_per_day = (
        (p.dl_per_shift * lines * p.shifts_per_day) +
        (p.debug_dl_per_shift * p.debug_lines_installed * p.shifts_per_day) +
        (p.functional_dl_per_shift * p.shifts_per_day)
    )

    # Step 6: Multipliers (Cleansheet!C50, C51)
    multiplier_1 = ((p.working_hours_per_day / 2) * 6) / p.sea_hours_per_week
    multiplier_2 = (p.sea_hours_per_day * p.working_days_per_week) / p.sea_hours_per_week

    # Step 7: DL Cost per week (Cleansheet!C56)
    dl_cost_per_week = (
        bp.dl_wage_per_hr_usd * p.sea_hours_per_week
        * total_dl_per_day * multiplier_2 * multiplier_1
    )

    # Step 8: IDL Line-dependent (Cleansheet!C55)
    idl_line_dep_cost = (
        (p.line_leader_per_shift * weekly_line_leader_rate)
        + (p.technician_per_shift * weekly_technician_rate)
        + (p.supervisor_per_day * weekly_supervisor_rate)
    ) * multiplier_2

    # Step 9: DL Cost per unit (Cleansheet!C58)
    dl_cost_per_unit = (dl_cost_per_week + idl_line_dep_cost) / weekly_output

    return {
        'cost_per_unit': dl_cost_per_unit,
        'formula_text': '(DL_cost_per_week + IDL_line_dep) / weekly_output',
        'source_cell_ref': f'Cleansheet!{col_letter(process_idx)}58',
        'intermediate': {
            'uph': uph,
            'max_output_per_line': max_output_per_line,
            'lines': lines,
            'weekly_output': weekly_output,
            'total_dl_per_day': total_dl_per_day,
            'dl_cost_per_week': dl_cost_per_week,
            'idl_line_dep_cost': idl_line_dep_cost,
        }
    }
```

(其餘 component 公式類似,完整對應表附 §App-A)

### 7.3 計算 trigger

| Trigger | 動作 |
|---|---|
| EPM 編輯 case_process / case_equipment / case_consumable | 標 case_factory.dirty=1 |
| EPM 按「Compute」按鈕 | 跑 compute() → 新 cs_run snapshot |
| Baseline 更新 → EPM 按「Reprice」 | 同上,但用新 baseline |
| BOM lock | 觸發 propagate(下節 §8)|

---

## §8 BOM Lock Propagate 整合(v0.3 改寫:多維 fact table 寫入)

### 8.1 觸發流程

```
BOM lock 觸發(case_id, locked_at):
  ↓
  FOR each bom_cs_case_factory WHERE case_id = X AND status != 'locked':
    1. 列出此 case_factory 的所有維度組合:
       - variants[]:                 從 project.variants (e.g. ['black','white'])
       - qty_scenarios[]:            從 bom_cs_case_qty_scenario (e.g. ['LOW','HIGH'])
       - pkg_versions[]:             從 bom_cs_case_pkg (e.g. ['RETAIL','BULK'])
       → 維度數 = 2 × 2 × 2 = 8 個組合 / factory
       → 3 factories 共 24 個 result 列

    2. FOR each (variant, qty_scenario, pkg_version) 組合:
       a. compute_material_per_variant(case_id, factory_code, variant, qty_scenario):
          - SELECT 採購策略 from bom_item + bom_item_mfg(selected) + price_snapshot(chosen)
          - FOR each item:
              * 找對應 tier:bom_item_price_tier WHERE qty_min ≤ qty_scenario.target_qty ≤ qty_max
              * 取 true_cost_usd + quote_price_usd
              * 按 variant scope 累加(shared 都算 / per_variant 各算各的)
          - 結果:material_true_usd · material_quote_usd
       b. compute_pkg_cost(case_factory_id, pkg_version):
          - SUM(bom_cs_case_pkg_item WHERE pkg_id = pkg_version):
              * pkg_true_usd · pkg_quote_usd
       c. 取對應 qty_scenario 的 MVA(從 bom_cs_run_cell 加總 · 該 qty_scenario 的 component cells)
          - mva_usd (per unit, this qty scenario)
       d. 計算 SG&A + Profit
          - sga_usd = motherboard × 0.02
          - profit_amount_usd = (mva + motherboard) × 0.14
       e. UPSERT bom_cs_run_result (run_id, factory, variant, qty_scenario, pkg) VALUES (...)
          - True / Quote / Margin 都寫(margin 欄是 GENERATED · 自動算)

    3. 寫 audit_log (event='BOM_PROPAGATE', payload={factories,variants,qty,pkg, total_rows: 24})
    4. notify EPM (user_notification · 列出影響的 24 個 result)
```

### 8.2 BOM Unlock 時

```
取消 propagate:
  -- 軟刪除:把這次 propagate 寫入的 result rows 設為 archived
  UPDATE bom_cs_run_result SET status = 'archived'
  WHERE run_id IN (SELECT run_id FROM bom_cs_run
                   WHERE case_factory_id IN (SELECT case_factory_id FROM bom_cs_case_factory WHERE case_id = X))
    AND computed_at > propagate_time;

  -- 或:刪掉 propagate 寫入欄位,保留 result row 但欄位變 NULL
  UPDATE bom_cs_run_result SET
    material_true_usd = NULL, material_quote_usd = NULL,
    pkg_true_usd = NULL, pkg_quote_usd = NULL
  WHERE ...
  -- 注意:total / margin 是 GENERATED VIRTUAL · 自動會變 NULL
```

### 8.3 整合畫面(v0.3:多維 pivot)

`§factory_matrix` UI 改成 pivot:

```sql
-- 用戶選 qty='HIGH' pkg='RETAIL' · 看 3 廠 Black/White 報價
SELECT
  factory_code,
  MAX(CASE WHEN variant_key='black' THEN total_quote_usd END) AS quote_black,
  MAX(CASE WHEN variant_key='white' THEN total_quote_usd END) AS quote_white,
  MAX(CASE WHEN variant_key='black' THEN gross_margin_pct END) AS margin_black,
  MAX(CASE WHEN variant_key='white' THEN gross_margin_pct END) AS margin_white
FROM bom_cs_run_result
WHERE run_id = ? AND qty_scenario_code = 'HIGH' AND pkg_code = 'RETAIL'
GROUP BY factory_code;
```

切到別的 scenario / pkg → UI re-fetch 該 pivot view → 矩陣全 refresh。

---

## §9 API Endpoints

| Method | Path | 用途 |
|---|---|---|
| `GET` | `/api/cs/processes` | 列製程目錄 |
| `POST` | `/api/cs/processes` | (admin) 新增製程 |
| `GET` | `/api/cs/templates` | 列模板 |
| `POST` | `/api/cs/templates` | 新增模板 |
| `GET` | `/api/cs/factories` | 列廠 |
| `GET` | `/api/cs/factories/:code/baselines` | 列廠 baseline 歷史 |
| `GET` | `/api/cs/factories/:code/baselines/active` | 當前 active baseline |
| `POST` | `/api/cs/baselines/import` | 上傳 xlsx,進 diff preview |
| `GET` | `/api/cs/baselines/:id/diff` | 取 diff 報告 |
| `POST` | `/api/cs/baselines/:id/approve` | 套用新 baseline |
| `GET` | `/api/cs/factories/:code/equipment` | 廠設備庫 |
| `GET` | `/api/cs/factories/:code/consumables` | 廠耗材庫 |
| `GET` | `/api/cs/cases/:id/factories` | 此案的廠 cleansheet 列表 |
| `POST` | `/api/cs/cases/:id/factories` | 新增 case_factory |
| `GET` | `/api/cs/case-factories/:id` | 取案級配置 |
| `PUT` | `/api/cs/case-factories/:id/process/:code` | 編輯案級製程 |
| `POST` | `/api/cs/case-factories/:id/equipment` | 加案級設備 binding |
| `POST` | `/api/cs/case-factories/:id/compute` | 觸發計算 → 新 cs_run |
| `GET` | `/api/cs/case-factories/:id/runs` | 列 cs_run 歷史 |
| `GET` | `/api/cs/runs/:id` | 取 cs_run 完整明細 + cells |
| `POST` | `/api/cs/case-factories/:id/lock` | DPM lock cleansheet |
| `POST` | `/api/cs/cases/:id/propagate-from-bom` | (internal) BOM lock 觸發 |

---

## §10 UI 設計

### 10.1 廠 baseline 管理(Admin 介面)

```
┌─ Admin → Factory Baselines ─────────────────────────┐
│                                                      │
│ Factory: [CN ▼]                                      │
│                                                      │
│ ┌─ Baseline History ─────────────────────────────┐  │
│ │ ACTIVE  CN-2025Q1  effective 2025-01-01~       │  │
│ │         DL $5.20/hr · SGA 2% · Profit 14%      │  │
│ │         17 IDL roles · 58 Equipment · 17 Cons. │  │
│ │         [Details] [Export] [Roll back]         │  │
│ │ ─────────────────────────────────────────────  │  │
│ │ super.  CN-2024Q4  2024-10-01 ~ 2024-12-31     │  │
│ │ super.  CN-2024Q3  2024-07-01 ~ 2024-09-30     │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ [+ Upload New Baseline xlsx]                        │
└──────────────────────────────────────────────────────┘
```

### 10.2 案 × 廠 Cleansheet 編輯

```
┌─ Case QT-2026-0148 · CN factory ────────────────────┐
│                                                     │
│ Baseline: CN-2025Q1 (1 個新版可用 → [Reprice])      │
│ Template: MOUSE_STD  Annual Demand: 418,000         │
│                                                     │
│ ┌── Processes (9) ────────────────────────────────┐ │
│ │ 1. SMT_MAIN   takt=8.64s   Y=98%   DL=10/shift │ │
│ │    → MVA = $0.704 / unit  [edit]                │ │
│ │ 2. WAVE_SOLDER takt=12s   ...                   │ │
│ │ ...                                             │ │
│ │ [+ Add Process]                                 │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ┌── Equipment (32) ───────────────────────────────┐ │
│ │ DEK · SMT · line=1 qty/line=1 · life=6yr        │ │
│ │ FUJI NXT M3S*6+M6S*1 · SMT · 1×1 · 6yr          │ │
│ │ ...                                             │ │
│ │ [+ Add from factory master]                     │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ┌── Compute Result(cs_run v3 · 2026-06-01)──────┐ │
│ │   MVA Total:       $1.852 / unit                │ │
│ │   SGA + Profit:    $1.686 / unit                │ │
│ │   TC:              $3.538 / unit                │ │
│ │                                                 │ │
│ │   [View Matrix(9×9)]  [Compute]  [🔒 Lock]    │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 10.3 結果 matrix(對應 Price Summary)

呈現方式同既有 `factory_matrix` excel-style,但拉到 9 製程 × 9 component:

```
                SMT  Wave Solder  ...  BB Assy  ...
DL              0.148  0.349       ...  0.362    ...
IDL             0.044  0           ...  0.028    ...
Equip MRO       0.005  0           ...  0.005    ...
Equip Depr      0.136  0           ...  0.005    ...
Indirect Mat    0.363  0           ...  0.008    ...
Facility        0.008  0           ...  0.027    ...
Freight         (Common only) 0.006
VAT             (Common only) 0.000004
Loss            (Common only) 0.007
──────────────────────────────────────────────────
MVA             0.704  0.349       ...  0.436    ... → Total MVA $1.852
SGA + Profit    (整廠 $1.686)
──────────────────────────────────────────────────
TC                                                     → $3.538
```

---

## §11 多語言

依 CLAUDE.md 規範:

- 製程目錄、模板名、IDL 角色名、cost component 名 → 三語言欄位
- API 接 `?lang=` 參數
- i18n key:`cs.process.SMT_MAIN.name`, `cs.template.MOUSE_STD.name`, ...

---

## §12 權限(v0.3 新增 VIEW_TRUE_COST layer)

### 12.1 角色矩陣

| 角色 | 廠 baseline | 製程目錄/模板 | 案 cleansheet | View True Cost |
|---|---|---|---|---|
| admin | CRUD | CRUD | CRUD | ✅ |
| epm(廠 EPM) | CR upload · approve own factory | R only | CRUD (own factory cases) | ✅(自家廠 cost)|
| dpm | R | R | R · 可 lock | ✅ |
| bpm / 業務(資深) | R | R | R | ✅(僅自己案)|
| 業務助理 | R | R | R(quote only) | ❌ |
| finance(CFO 級) | R | R | R | ✅ |
| 採購主管 | R | R | R | ✅ |
| 一般採購 / member | R(non-confidential only) | R | R(quote only) | ❌ |

### 12.2 機密欄位 4 級

```
🔒🔒 Critical(超越 true cost · 揭露 markup 商業邏輯)
   - bom_item_price_tier.markup_pct
   - bom_cs_run_result.gross_margin_pct
   - bom_cs_run_result.material_margin_pct

🔒 High(內部成本 · 看到了會洩漏議價底線)
   - bom_item_price_tier.true_cost_source / true_cost_usd
   - bom_cs_run_result.material_true_usd / pkg_true_usd / total_true_usd
   - bom_cs_run_result.mva_usd
   - bom_factory_baseline.dl_wage_per_hr_usd
   - bom_factory_equipment.acquisition_cost_usd
   - bom_factory_idl_role.annual_rate_usd

🟡 Medium(成本結構但不致命)
   - bom_item_price_tier.fx_rate(露 supplier 國家)
   - bom_cs_run_result.sga_usd
   - 廠 SG&A %

🟢 Low(quote 端 · 對客戶可揭露)
   - bom_item_price_tier.quote_price_usd
   - bom_cs_run_result.material_quote_usd / pkg_quote_usd / total_quote_usd
   - bom_cs_run_result.profit_amount_usd(quote 後計算的)
```

### 12.3 與既有 4 層資料政策關係

新增獨立「**True Cost 揭露權限**」layer,跟既有 `ai_data_policies` L1-L4 互補,不取代:

```sql
INSERT INTO ai_data_policy_rules (policy_id, layer, capability_code, applies_to)
VALUES (?, 'COST_LAYER', 'VIEW_TRUE_COST', 'role:finance,role:procurement_director,role:dpm');
```

UI 沒有 `VIEW_TRUE_COST` 的人,所有 🔒 / 🔒🔒 欄位顯示為 `▒▒▒▒`。

詳細權限對應見 [bom-collection-sd.md §20](bom-collection-sd.md#20-true-cost-權限擴充v04-新增)。

---

## §13 開發 Phase

### Phase 1(2 sprint · 8 天):基礎 + import

- [ ] 14 表 schema + migration
- [ ] 製程目錄初始化(9 個 + MOUSE_STD 模板)
- [ ] xlsx import script(baseline + Equipment + Consumables 全解析)
- [ ] CN baseline 首次 import 驗證(算出 MVA 與 Excel 差距 < 0.01)
- [ ] Admin UI(baseline 列表 + diff preview)

### Phase 2(2 sprint · 8 天):計算引擎

- [ ] 9 個 component 公式 service(對應 Excel A/B/C/D/E 五區)
- [ ] cs_run snapshot + cell matrix
- [ ] Compute trigger + dirty flag
- [ ] 與 Excel 算值 cross-check(自動 regression test)

### Phase 3(1 sprint · 4 天):案級 UI

- [ ] §case_factory 列表 + 編輯
- [ ] 製程清單編輯(從 template 帶 / 自訂)
- [ ] 設備 binding 編輯
- [ ] cs_run history + matrix viewer
- [ ] Lock / Unlock 流程

### Phase 4(1 sprint · 4 天):整合 + propagate

- [ ] BOM lock → 自動 propagate material → cs_run
- [ ] BOM unlock → rollback
- [ ] `factory_matrix` UI 改抓 cs_run 而非寫死 STEELSERIES_FM
- [ ] User notification(baseline 更新提示)
- [ ] Audit log

### Phase 5(0.5 sprint):VN / TW 廠擴充

- [ ] VN 廠 baseline xlsx import(等 EPM 提供)
- [ ] TW 廠 baseline xlsx import
- [ ] 跨廠 MVA 對比 UI

### Phase 6(可選):跨案分析

- [ ] 同款設備 utilization 跨案查詢
- [ ] MVA 趨勢圖(per factory · per quarter)
- [ ] Anomaly detection(此案 MVA vs 同類產品 historical 偏離度)

**總計**:6.5 sprint ≈ 26 天 (~5-6 週,1 人)

---

## §14 TBD 議題

### 14.1 ✅ 已拍板(2026-06-02)

| # | 議題 | 決策 |
|---|---|---|
| 1 | 計算引擎精度 | **✅ 允許 ε < 0.01**(浮點與 ROUND 差);> 0.01 算錯必須查清。實作時加 regression test:每次 compute 跟 Excel 原值比,> 0.01 自動 fail |
| 2 | Equipment「Bucket」blank / Spare 怎處理 | **✅ 初期 skip 不 import**;import script 遇到 `bucket IN ('(blank)', 'Spare', NULL)` 直接跳過,寫 warning log。等遇到實案需要再開規格 |
| 3 | IDL multiplier 初始化 | **✅ 首次 import 抄 Excel J64/L64/N64...** 等對應 cell。爾後 EPM 在 §case UI 編輯 `bom_cs_case_idl_alloc.multiplier`,不再回 Excel |
| 4 | Process Flow sheet 是否結構化 | **✅ Phase 1 不結構化**。當 `bom_cs_case_process.takt_source` 文字註記用(例:`'SMT Process Flow!I3'`)。若 EPM 真要改 takt,直接編 `takt_seconds` 欄位,不回去動 Process Flow sheet |
| 5 | Reprice 後是否保留舊 cs_run | **✅ 是,軟刪除**。新 compute → 新 run · 舊 run 標 `status='archived'`。UI 預設只列 ready run,「show archived」toggle 可展開歷史 |

### 14.2 ⏳ 仍 TBD(等 USER 後續確認)

| # | 議題 | 我的建議 | 影響面 |
|---|---|---|---|
| 6 | 「Consigned material」(客供料)走哪? | BOM 端已處理(price=0)· Cleansheet 不另外開欄 | 小 · 可開工後再定 |
| 7 | EE BOM 共用、ME BOM per variant → MVA 仍跨色共用嗎? | 是。MVA 看製程不看料,色差不影響 | 小 · 已預留 `variant_key` NULL |
| 8 | VN 廠 / TW 廠 baseline 何時拿得到? | 等 USER 提供;Phase 5 開工前要有 | 中 · Phase 1-4 不影響 |
| 9 | 匯率處理(各廠不同幣別)? | 走 ERP `gl_daily_rates` + PO OU 反推 ledger(對齊 BOM SD §1.3) | 中 · Phase 4 propagate 時用到 |
| 10 | 計算結果機密欄位的權限隔離 | 走 Cortex 既有 4 層 `ai_data_policies` + 新 `VIEW_TRUE_COST` layer(§12) | **✅ v0.3 已定**(USER 2026-06-06 拍板) |
| **11** | **Qty scenario 對 MVA 計算影響**(v0.3 新增) | 每 qty scenario 跑獨立 cs_run_cell 計算 · 共用 cs_run header · cs_run_cell PK 加 `qty_scenario_code` | 中 · Phase 2 計算引擎要 loop scenarios |
| **12** | **同 mfg 跨 tier 應該寫一個 snapshot 多 tier,還是多 snapshot 各 1 tier?**(v0.3 新增) | 建議 1 snapshot N tier(同 RFQ 內談的,共享 valid_until)· 跨 RFQ 才開新 snapshot | 小 · 不阻塞 |
| **13** | **多 PKG 版本 lock 順序**(v0.3 新增) | DPM 可選「lock 全部 PKG」或「只 lock primary」· 預設全 lock | 小 · UI 細節 |

剩餘 TBD 不阻塞 Phase 1-2 開工。Phase 3-4 前須拍板 #9 / #11 / #13。

---

## Appendix A — Excel 公式對應對照表(摘錄)

| Excel 位置 | 公式 | DB service |
|---|---|---|
| `Cleansheet!C14` | `=3600/C13*C15*C16` | `compute_uph(case_factory, process)` |
| `Cleansheet!C21` | `=C10*C14` | `compute_max_output_per_line(...)` |
| `Cleansheet!C23` | `=ROUNDUP(C20/C21, 0)` | `compute_lines_installed(...)` |
| `Cleansheet!C58` | `=(C56+C55)/C24` | `compute_dl_cost(...)` |
| `Cleansheet!H90` | `=SUM('Equipment List'!P3:P7)*(C20/C24)` | `compute_equipment_mro(...)` |
| `Cleansheet!H91` | `=SUM('Equipment List'!P8:P34)*(C20/C24)` | `compute_equipment_depr(...)` |
| `Cleansheet!J100` | `=(I100*$C$100/$C$18)*I97*(C20/C24)` | `compute_facility_cost(...)` |
| `Cleansheet!J107` | `=C107/I107` | `compute_inbound_freight(...)` |
| `Cleansheet!J110` | `=I110*C110` | `compute_loss_factor(...)` |
| `Cleansheet!J114` | `=C114*I114/C18` | `compute_vat(...)` |
| `Cleansheet!C118` | `=J112+J109+X103+X94+X83+Y70+L58` | `compute_mva_total(...)` |
| `Cleansheet!J121` | `=I121*(C121+C120)` | `compute_sga_profit(...)` |
| `Cleansheet!C125` | `=J120+C118+J121` | `compute_total_tc(...)` |

(完整對照表 100+ 條,實作 Phase 2 時逐項對齊)

---

## Appendix B — 解析 xlsx 範例輸出

(從本次 dump 的 `Rival 3+ Wired Mouse Cleansheet_China-20241011-19S.xlsx` 預期 import 結果)

```sql
-- SupplierBaseInput → bom_factory_baseline
INSERT INTO bom_factory_baseline (
  factory_code, version_label, effective_from, status,
  dl_wage_per_hr_usd, floor_sqft_prod, loss_factor_pct, sga_pct, profit_pct,
  annual_demand_default, vat_rate_pct, inbound_freight_annual, motherboard_cost_ref
) VALUES (
  'CN', 'CN-2024Q4', DATE '2024-10-11', 'draft',
  4.95, 14.4276, 0.0008, 0.02, 0.14,
  418000, 0.17, 2500, 8.683
);

-- bom_factory_idl_role (17 列)
INSERT ... 'OPS_MGR', 60320, 1206.4 ...
INSERT ... 'SECTION_MGR', 60320, 1206.4 ...
INSERT ... 'ENGINEER', 24440, 488.8 ...
...

-- bom_factory_equipment (58 列 from Equipment List)
INSERT ... 'DEK', SMT, 84000, 6 yrs ...
INSERT ... 'FUJI NXT M3S*6+M6S*1', SMT, 1013384, 6 yrs ...
INSERT ... 'SPI TRI-7007', SMT, 68852, 6 yrs ...
...

-- bom_cs_case_factory (新案 SteelSeries Rival 3+ × CN)
INSERT ... case_id=148, factory='CN', baseline_id=<above>,
            annual_demand=418000, status='draft' ...

-- bom_cs_case_process (9 製程)
INSERT ... 'SMT_MAIN', takt=8.64, yield=0.98, eff=0.95,
            working_hr=23, working_day=6.67, shifts=2, dl=10, lines=1 ...
INSERT ... 'WAVE_SOLDER', takt=12, ... ...
...

-- bom_cs_case_equipment (32 from Equipment List, line_qty/qty_per_line 帶入)
INSERT ... equipment_id=<DEK>, process='SMT_MAIN', line_qty=1, qty_per_line=1 ...
INSERT ... equipment_id=<NXT>, process='SMT_MAIN', line_qty=1, qty_per_line=1 ...
...

-- (執行 compute service)

-- bom_cs_run snapshot
INSERT ... case_factory=1, status='ready',
            mva_total_usd=1.852, sga_amount=0.176, profit_amount=1.509,
            total_tc=3.538, motherboard_cost=8.683 ...

-- bom_cs_run_cell (9 製程 × 9 component = ~50 列因部分 cell 為 0/Common only)
INSERT ... process='SMT_MAIN', component='DL_CPU', cost=0.148 ...
INSERT ... process='SMT_MAIN', component='EQUIP_DEPR', cost=0.136 ...
...
INSERT ... process='COMMON', component='FREIGHT', cost=0.006 ...
INSERT ... process='COMMON', component='LOSS', cost=0.007 ...
```

---

完。等 USER review §14 TBD 後拍板開工。
