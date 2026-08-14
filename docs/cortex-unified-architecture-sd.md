# Cortex 統一架構 SD — 單一 Superset · 一套規則適用所有專案

> **版本**:v1.0 / 2026-06-24
> **狀態**:Solution Design · 架構收斂主規格(authoritative)
> **原則拍板**:2026-06-24 user 定案 — 整個 Cortex 報價/成本只存在**一張 superset form-schema**(section + field registry,全欄位全 section 都在)與**一條 superset 計算引擎**,專案差異一律由 `costing_model` + per-component mask + per-field `enabled_when` flag 控制「啟用 / 標本案不適用」。**絕不為 WHOOP / SteelSeries / basic 各開一套 section、render 函數、data const 或計算 path。**
> **盤點來源**:`unify-cortex-arch` workflow(7 agents · 153 items · 37 forks · 2026-06-24)
> **關聯**:[cleansheet-mva-sd.md](cleansheet-mva-sd.md) v0.5 · [bom-collection-sd.md](bom-collection-sd.md) v0.4 · [factory-matrix-schema-sd.md](factory-matrix-schema-sd.md) · [projects-platform-spec.md](projects-platform-spec.md) · [quote-system-spec.md](quote-system-spec.md) · [Cortex_互動Demo_v0.12.html](Cortex_互動Demo_v0.12.html)

---

## §0 為什麼要這份文件

到 v0.12 為止,Cortex demo + SD 累積了 **3 路 section 分岔 + 18 處設計分岔**:

- demo `sections` 三元分岔(`showcase_whoop ? [10] : showcase_advanced ? [14] : [7]`)
- WHOOP 6 個專屬 section(`whoop_*`)vs SteelSeries 6 個專屬 section + 5 個平行 `renderFormWhoop*` 函數
- BG 分流硬編 4 處、`title.includes('SteelSeries')` 易碎判型 7 處
- SD 層:設備個別機 vs 類別制兩套、MVA 雙權威源、audit 表前綴分岔、form 引擎 `qp_form_*` vs `data_payload` 雙機制

每加一種新專案類型(滑鼠 / 穿戴 / 連接器 / 線材 / Cable…)就要再分岔一次 → 不可維護。

**本文件定義收斂後的單一架構**,作為後續所有 demo / SD / 實作的權威依據。新增專案類型 = 加一筆 `costing_model` + component mask 列,**不改 section list、不改 render、不加 const**。

---

## §1 核心原則(三條鐵律)

1. **單一 superset section list** — 所有案共用同一套 section(13 個)。每個 section 自帶 `enabled_when`,不適用時 UI 標「本案不適用(成本併入 X)」,**不抽掉 section、不換 render 函數**。
2. **單一 superset 欄位全集** — 所有欄位都在 DB,所有案都讀同一張 schema。專案用不到的欄位空著 + UI 隱藏,**不為某案開平行表**。
3. **單一 superset 計算引擎** — 一條計算 path 讀 `costing_model` + component mask + 參數化 `base_ref` 跑所有 model。新增 model = 加 mask 列,**不加計算分支**。

> 反例(禁止):`if (showcase_whoop) { renderWhoopX() } else { renderX() }`、`bg==='CONSUMER' ? CONSUMER_CONST : OPTO_CONST`、`title.includes('SteelSeries')`。

---

## §2 統一 Section List(13 個 · 取代 3 路分岔)

| # | section id | 名稱 | enabled_when | 收斂掉(replaces) |
|---|---|---|---|---|
| 1 | `customer` | 客戶資料 | always | customer(三路共用,不變) |
| 2 | `workflow_checklist` | 操作流程 Checklist | always | workflow_checklist(共用) |
| 3 | `variants` | CMF / 變體 | `has_variants`(variants.length>1) | variants · 單色案標不適用 |
| 4 | `bom` | BOM 結構(N module × section × category × item × mfg × snapshot) | always | **bom + whoop_modules** → 統一(SteelSeries=1 隱性 module · WHOOP=8 顯式 module) |
| 5 | `packaging` | PKG 版本 × 內容矩陣 | always | **packaging + whoop_sku** → 統一(SteelSeries=2 版商包/工包 · WHOOP=5 SKU × 8 module ✓/—) |
| 6 | `inquiry` | 詢價彙總 | `costing_model='FULL_MVA'` | inquiry · WHOOP 標不適用(走 contract price) |
| 7 | `nre` | NRE 成本 | `has_nre`(nre_summary 存在) | nre · render 內嵌陣列提升 data 層 |
| 8 | `cost_matrix` | 成本矩陣(廠×variant×qty×pkg 多維 + Summary + Margin) | always | **whoop_summary + factory_matrix + margin_analysis + cost** → 統一 |
| 9 | `process_mva` | 製程 / MVA 計算 | always(顆粒度 by costing_model) | **cleansheet + whoop_process** → 統一(FULL 細製程 / SIMPLIFIED 放大 macro) |
| 10 | `cost_structure` | Cost 結構拆解(層級匯總) | always | **whoop_cost** → 統一(FULL 4 層 / SIMPLIFIED 5 層) |
| 11 | `mva_workflow` | MVA 操作流程 | `costing_model in (FULL_MVA, SIMPLIFIED_WEARABLE)` | mva_workflow · 視角改讀 costing_model 不用 title |
| 12 | `strategy` | 議價策略 | `costing_model='FULL_MVA'` | strategy · WHOOP 標不適用 |
| 13 | `gap` | Gap Analysis | `has_gap`(通用化) | whoop_gap → 通用「本案 vs schema 能力缺口」 |
| 14 | `legal` | 法務 review | always | legal(共用) |

> 註:section 從原本 20 個(含 6 whoop_* + DEFAULT 平行)收斂到 14 個 single-superset。WHOOP 8 子組件不是新 section,是 `bom` section 的 8-module 模式;WHOOP Summary 不是新表,是 `cost_matrix` 的 SKU-pivot 視圖。

### 2.1 section meta data-driven(砍徽章硬編)

`isNew` badge 顏色 / version 字串從 `section.id` 巢狀三元 inline 硬編(v0.12:12893)→ 改 section meta 帶 `{badge_version, badge_color}`。新增 section 不再改 className 三元。

---

## §3 Costing Model · Component Mask(計算引擎核心)

### 3.1 設計:component 全集 + per-component mask + baseline 參數化

```sql
-- bom_cs_component(superset 全集 · 20+ component 都登錄)新增 2 欄:
ALTER TABLE bom_cs_component
  ADD model_applicability VARCHAR2(40),   -- 'FULL_MVA' | 'SIMPLIFIED_WEARABLE' | 'BOTH'
  ADD fallback_into_code  VARCHAR2(40);   -- disable 時併入哪個 component(NULL=純 disable 不併)

-- bom_factory_baseline 新增(取代 if/else 分岔 · 全參數化):
ALTER TABLE bom_factory_baseline
  ADD costing_model        VARCHAR2(30),   -- 'FULL_MVA' | 'SIMPLIFIED_WEARABLE'
  ADD sga_base_ref         VARCHAR2(30),   -- 'motherboard' | 'bom_subtotal'
  ADD profit_base_ref      VARCHAR2(30),   -- 'mva_plus_mb' | 'bom_subtotal'
  ADD oh_pct               NUMBER(5,4),    -- FULL 預設 0 · SIMPLIFIED 0.04
  ADD outbound_transportation_per_unit_usd NUMBER(10,4),
  ADD loss_factor_per_process CLOB,        -- SIMPLIFIED per-process JSON(FULL 用既有 loss_factor_pct 廠級單值)
  ADD smt_point_unit_price NUMBER(10,4),
  ADD smt_allowance_pct    NUMBER(5,4),
  ADD smt_point_formula    CLOB;           -- 算式字串 user 可微調(見 §4)
-- 既有沿用:sga_pct, profit_pct, loss_factor_pct, vat_rate_pct, inbound_freight_annual, motherboard_cost_ref
```

`costing_model` 預設綁 `bom_process_template`(case `bom_cs_case_factory` 可 override)。

### 3.2 衍生 effective mask(計算引擎讀)

```
component 對 case 生效 =
  (component.model_applicability IN ('BOTH', baseline.costing_model))
  AND (case 未個別 disable)

若 component disable 且 fallback_into_code 非 NULL
  → 該 component 金額累加進目標 component(避免漏算又不重複算)
```

### 3.3 20 Component × 兩 Model 對照表

| component_code | FULL_MVA | SIMPLIFIED_WEARABLE | fallback_into | 備註 |
|---|---|---|---|---|
| `MATERIAL` | ✓ | ✓ | — | 含廠內料號 |
| `PKG_COST` | ✓ | ✓ | — | |
| `DL_CPU` | ✓ | ✗ | `PROC_MACRO` | WHOOP 用放大製程取代細 DL |
| `IDL_CPU` | ✓ | ✗ | `OVERHEAD_4PCT` | WHOOP IDL 併 OH |
| `EQUIP_MRO` | ✓ | ✗ | `OVERHEAD_4PCT` | WHOOP 設備併 OH |
| `EQUIP_DEPR` | ✓ | ✗ | `OVERHEAD_4PCT` | |
| `IND_MAT` | ✓ | ✗ | `OVERHEAD_4PCT` | |
| `FACILITY` | ✓ | ✗ | `OVERHEAD_4PCT` | |
| `FREIGHT` | ✓ | ✗ | —(改 TRANSPORTATION) | WHOOP 無 inbound |
| `VAT` | ✓ | ✗ | —(純 disable) | WHOOP 計價無 VAT 行 |
| `LOSS` | ✓ | ✗ | —(改 MAT_LOSS_RATE) | WHOOP 分製程不可併 |
| `MVA_TOTAL` | ✓ | ✗ | —(聚合行) | WHOOP 以 BOM subtotal 為基底 |
| `PROC_MACRO` | ✗ | ✓ | — | 放大製程(FATP) |
| `SMT_POINTS` | ✗ | ✓ | — | SMT 點數計價 |
| `MAT_LOSS_RATE` | ✗ | ✓ | — | 材料耗損率(SMT 0.5%/0.2% + FATP 4%) |
| `OVERHEAD_4PCT` | ✗ | ✓ | —(吸收 5 明細的 fallback 終點) | 小計 × 4% |
| `TRANSPORTATION` | ✗ | ✓ | —(outbound 固定/unit) | $0.50 固定 |
| `SGA` | ✓ | ✓ | —(參數化) | FULL=mb×2% · SIMPLIFIED=subtotal×3% |
| `PROFIT` | ✓ | ✓ | —(參數化) | FULL=(MVA+mb)×14% · SIMPLIFIED=subtotal×3% |
| `TOTAL_TC` | ✓ | ✓ | —(VIRTUAL 匯總) | 組成項依 mask 不同 |

**關鍵保證**:SIMPLIFIED 下 `IDL_CPU / EQUIP_MRO / EQUIP_DEPR / IND_MAT / FACILITY` 五項 disable 但 `fallback_into=OVERHEAD_4PCT`,由 OH 4% **一筆吸收**(避免漏算又不重複算);FULL 下 `OVERHEAD_4PCT` disable。單一引擎讀 mask + base_ref 跑兩 model,QA 對 `Rival 3+ Cleansheet` 與 `WHOOP quotation book` 各 **ε<0.01**。

### 3.4 兩 Model 計算 path(同一引擎 · 不同 mask)

```
FULL_MVA (SteelSeries / OPTO):
  MATERIAL + PKG_COST
  + MVA_TOTAL( DL_CPU + IDL_CPU + EQUIP_MRO + EQUIP_DEPR + IND_MAT + FACILITY + FREIGHT + VAT + LOSS )
  + SGA( motherboard × sga_pct )
  + PROFIT( (MVA+motherboard) × profit_pct )
  = TOTAL_TC

SIMPLIFIED_WEARABLE (WHOOP / CONSUMER):
  MATERIAL(含料號) + PKG_COST
  + SMT_POINTS( Σ board transfer_point × unit_price + allowance% )
  + PROC_MACRO( Σ macro DL × wage × work_time )
  + MAT_LOSS_RATE( SMT_boards×0.5%/0.2% + 全材料×4% )
  ─ 小計 ─
  + OVERHEAD_4PCT( 小計 × 4% · 吸收 IDL/設備/facility )
  + SGA( 小計 × 3% )
  + PROFIT( 小計 × 3% )
  + TRANSPORTATION( $0.50 )
  = TOTAL_TC
```

---

## §4 SMT 點數計價(SIMPLIFIED · 算式字串)

對應 WHOOP `SMT cost` sheet · `Transfer Point` 模型。**點權重存算式字串**(user 拍板:可微調)。

```sql
CREATE TABLE bom_factory_smt_point_rule (
  baseline_id    NUMBER REFERENCES bom_factory_baseline(baseline_id) ON DELETE CASCADE,
  category_code  VARCHAR2(20),     -- 'C/P' / 'R' / 'M' / 'D' / 'L' / 'J' / 'U' / 'Q' / 'Y' / 'X'
  point_formula  VARCHAR2(80),     -- ⭐ 算式字串 '×1' / '×2' / '24/2' / '103/3'(user 可微調)
  unit_price_usd NUMBER(10,4),     -- USD / point
  PRIMARY KEY (baseline_id, category_code)
);

CREATE TABLE bom_cs_case_smt_point (
  case_factory_id NUMBER REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE,
  board_code      VARCHAR2(80),    -- 'Harvard Sensor' / 'Bird Main' / 'Harvard Main'
  category_code   VARCHAR2(20),
  pcs             NUMBER(6),
  transfer_point  NUMBER(10,4),    -- = eval(pcs 套 point_formula)· 系統算 + 存原算式
  point_formula_override VARCHAR2(80),  -- 案級可覆寫廠規則(如 '=337/3+140/4')
  sub_total_usd   NUMBER(12,4),
  PRIMARY KEY (case_factory_id, board_code, category_code)
);
-- SMT BOM total = Σ board sub_total · + SMT Allowance O/H = total × smt_allowance_pct(5%)
```

點權重範例(WHOOP 實值):`C/P=×1 · R=×1 · M=×2 · D=×2 · L=×2 · J=24/2 · U=103/3 · Q=×2 · Y=×2 · X=×2`。前端需小算式 eval(`pcs × weight` 或直接 eval 字串)。

---

## §5 統一 Superset 欄位全集(按 section)

> 全欄位都在 DB · `used_by_models` 標哪些 model 用 · 不用的隱藏不刪。

### customer
`id, type, title, customer, customer_alias, amount, qty, bg_code, bg_name, bu_code, bu_name, currentStage, confidential` — both

### variants(`has_variants`)
`variant_key(black/white), label, share, qty, material_cost(per variant)` — FULL;SIMPLIFIED 單色標不適用

### bom(統一 6 層:module → section → category → item → flk → mfg/snapshot)
- **BOM 階層 + module 層**:`module(code, cat EE/ME, rev, cost, items_count, vendor_consigned, note), section(name, scope shared/per_variant, link_to_section), category(name, process_type), item(desc, qty, unit, reference, customer_item, variant_scope, variant_key)` — both(SteelSeries=1 module · WHOOP=8 module)
- **料號 + 製造商 + 價格**:`final_flk_id, flk_part_number, inventory_item_id, source_org_id, erp_match{id,score,source}, mfgs[]{name, mfg_part_number, selected, is_preferred}, snapshots[]{rfq, price, currency, valid_until, is_chosen, lead_time}, price_tier{qty_min/max, true_cost_usd, quote_price_usd, markup_pct}` — both
- **WHOOP 專屬料號/指定旗標**:`fpn(Foxlink P/N), wpn(Whoop P/N), customer_pn, consigned_pn, des(Designator), consign(Y/N), is_customer_specified, lt` — SIMPLIFIED;FULL 隱藏
  - ⚠️ **耗材料號兩案都補**(user 拍板):`bom_factory_consumable` / `bom_cs_case_consumable` 加 `foxlink_part_no`

### packaging(統一 PKG 版本/SKU × module 矩陣)
- **PKG 版本/SKU**:`pkg_code(RETAIL/BULK/WB_*), pkg_label_zh/en, items_count, total_true, total_quote, markup_pct_avg, is_primary, channel_applies_json, source_xlsx` — both(SteelSeries=2 版 · WHOOP=5 SKU)
- **PKG item + pkg×module 矩陣**:`pkg_item{no, name, spec, qty, uom, source_currency, source_amount, fx_rate, true_cost_usd, quote_price_usd, markup_pct, vendor, is_sustainable}, pkg_module_include{pkg_code × module_code = 0/1}` — both(矩陣主要 WHOOP · 新表 `bom_cs_case_pkg_module_include`)

### inquiry(`costing_model='FULL_MVA'`)
`inquiry 6/8 欄` — FULL;WHOOP 標不適用

### nre(`has_nre`)
`key, label, unit, original, updated(negotiated), remark, status, sla, total_original, total_negotiated` — FULL(SteelSeries 11 項 · render 內嵌提升 data 層)

### cost_matrix(統一多維 fact + Summary pivot + Margin)
- **矩陣維度 + 雙價 cell**:`factory_code(CN/VN/TW), variant_key, qty_scenario(LOW/HIGH), pkg_code; material_true, material_quote, pkg_true, pkg_quote, mva, sga, profit; total_true_usd(V), total_quote_usd(V), margin_amount(V), material_margin_pct(V), gross_margin_pct(V), is_min_in_variant, is_confidential_cell` — both
- **廠別 MVA + ERP org**:`pfm_factory{mva_per_unit, mva_labor/equipment/overhead(opt), mva_source(cleansheet_CN/manual/erp_rollup), erp_org_id(CN=83/VN=2463/TW=1101)}` — both(FULL 走 cs_run 重算 · SIMPLIFIED 走單值/macro)
- **WHOOP Summary pivot**:`summary_row{no, name, cost, cells[5 SKU], note, isCat, subtotal, total, rate}, sku{code, name, tag, incCount, ttl_usd}` — SIMPLIFIED(是此矩陣的 SKU-pivot 視圖 · 非另一張表)
- **Margin 分析**:`max/min/avg_margin KPI, top_markup_items(markup_pct 排序), heatmap cells, VIEW_TRUE_COST 權限門` — FULL

### process_mva(統一 · 顆粒度 by costing_model)
- **FULL 細製程輸入(per process × ~20 欄)**:`process_code, step_order, working_hours_per_day/days_per_week/shifts_per_day, takt_seconds, yield_pct, efficiency_pct, lines_installed, debug_lines_installed, dl_per_shift, debug_dl_per_shift, functional_dl_per_shift, warehouse_dl_per_shift, line_leader/technician_per_shift, line_leader/technician/iqc_per_day, supervisor_per_day, sea_hours_per_day/week, takt_source` — FULL
- **FULL IDL allocation matrix**:`idl_role(code, name, cat CENTRAL/MFG_IDL, annual_rate, weekly_rate), idl_alloc{role_code × process_code = multiplier}, idl_linedep_wage{LINE_LEADER/TECHNICIAN/IQC/SUPERVISOR weekly_wage}` — FULL
- **FULL 設備/耗材**:`equip_category{code, name, group, process, rep_cost, life, mro_pct, wearable_only}, case_equip{proc, cat, qty}, dep_years{category, years}, consumable{desc, uom, proc, annual_qty, unit_cost, foxlink_part_no}` — FULL(設備 both 但細算 only FULL)
- **SIMPLIFIED macro 製程 + SMT**:`fatp_station{code, name, uph, dl, sfc}, macro_process{code, name, num_stations, work_time_sec, dl_headcount, uph, process_yield_pct}, smt_cost{board, points, cost, allowance, total}, smt_point_formula(算式字串), smt_point_unit_price, smt_allowance_pct, mat_loss_rate_per_process(JSON)` — SIMPLIFIED
  - macro 留細站表(`bom_cs_case_macro_station`)· demo 只做 macro header(user 拍板)

### cost_structure(層級匯總 + baseline 參數)
- **層級匯總 + baseline 參數**:`costing_model, dl_wage_per_hr_usd, sga_pct, profit_pct, sga_base_ref, profit_base_ref, oh_pct, outbound_transportation_per_unit_usd, loss_factor_pct, loss_factor_per_process(JSON), vat_rate_pct, inbound_freight_annual, motherboard_cost_ref, annual_demand_default` — both(欄全在 · 值/啟用 by costing_model)
- **baseline SCD + BG 隔離**:`baseline_id, version_label, effective_from/to, status, bg_code, bu_code, floor_sqft_prod/warehouse/boxbuild` — both

### gap / mva_workflow / strategy / legal
`gaps{supported/partial/missing}, phase1_tasks, suggested_schema[]` · `mva_workflow steps(視角 by costing_model)` · `strategy 議價欄` · `legal review 欄` — 各自 enabled_when

---

## §6 要砍的 18 個分岔點(forks_to_remove)

### Demo(`Cortex_互動Demo_v0.12.html`)

| # | 位置 | 分岔 | 收斂成 |
|---|---|---|---|
| F1 | :12828-12832 | 三路 `sections` 三元(whoop?[10]:advanced?[14]:[7]) | 單一 superset section list(14)· 每 section 帶 `enabled_when` |
| F2 | :12921-12944 | renderFormSection 20 分支(含 6 whoop_* + bom/cost/inquiry 平行套) | whoop_modules→bom · whoop_sku→packaging · whoop_summary→cost_matrix(SKU pivot)· whoop_cost→cost_structure · whoop_process→process_mva(macro)· **砍 5 個 renderFormWhoop*** |
| F3 | :9496-9503 | mvaCaseBg 三 fallback | 單一 `project.bg_code` 權威源 · helper 只 lookup 不推斷 |
| F4 | :13040,14045,14323,14737,15346,16820,17033 | **7 處 `title.includes('SteelSeries')`** 易碎判型 | 全改讀 `project.costing_model` / `has_*` flag · STEELSERIES_* vs DEFAULT_* 二選一一併收斂 |
| F5 | :13626 | renderFormCost 內 `if(showcase_advanced)` 3廠×2variant 分岔 | 移到 cost_matrix 單一多維 render(維度退化由資料控制) |
| F6 | :11963-11971 | renderChannelMessages `showcase_advanced && conversations[]` vs hardcoded AirPods | 統一從 `project.conversations` 取 · WHOOP/basic 不退化死路 |
| F7 | :9370/9394/9426/9472 | mvaGet* 四 helper `bg==='CONSUMER'?_CONSUMER:_OPTO` + slice copy 補丁 | 單一 catalog + `bg`/`wearable_only` 過濾欄 · mvaGetCaseDlDetail 假分流一併處理 |
| F8 | :9669 | WHOOP_SKU_MODULE_MATRIX vs SUMMARY_ROWS.cells 兩份手維護 | 單一 `bom_cs_case_pkg_module_include` · Summary cells 衍生 |
| F9 | :8517 vs 8594 | STEELSERIES_FM_FULL(24cell 3維)vs 舊 STEELSERIES_FM(2維)雙寫 MVA | 砍舊 2 維 · 只留多維 fact |
| F10 | :12893 | isNew badge 顏色/version 用 section.id 巢狀三元硬編 | section meta 帶 `{badge_version, badge_color}` |

### SD 文件層

| # | 位置 | 分岔 | 收斂成 |
|---|---|---|---|
| F11 | cleansheet-mva-sd:21 vs §4.3 | 設備個別機 vs 類別制兩套互斥 | 類別制(補齊 `bom_equip_category_catalog/_factory_equip_category_price/_cs_case_equip_category` DDL)· 個別機表保留 optional override |
| F12 | cleansheet-mva-sd:12-18 vs L379 / bom-collection §2.2.10 | audit 表前綴分岔(`bom_cs_audit_log` vs `bom_audit_log`)+ `bom_cs_baseline_diff` 無 DDL | 單一 `bom_audit_log`(event_type enum 擴 baseline_diff/factory_matrix_*) |
| F13 | factory-matrix-sd §2.3 vs cleansheet-mva-sd §6.2 | MVA 雙權威源(pfm_factory.mva_per_unit 單值/JSON vs cs_run 計算) | cs_run 為唯一計算權威 · pfm_factory.mva 為 cache/snapshot |
| F14 | cleansheet-mva-sd §6.2 | bom_cs_run_cell(matrix)vs bom_cs_run_result(fact)並存 | result 為對外唯一 fact · cell 降為 run 內部公式還原 detail |
| F15 | bom-collection §11.2/§6.4 vs factory-matrix §3 / bom-sd §16.4 | cost propagate 雙終點(data_payload JSON vs MERGE pfm_cell) | pfm_cell 4 表為唯一寫入終點 · JSON 路線退役(兼容期 read) |
| F16 | projects-platform §3.1 vs §11.2.1 | 動態欄位雙機制(`projects.data_payload` CLOB+ajv vs `qp_form_template_*`) | `qp_form_*` 去 plugin 前綴 → 通用 `project_form_*` · data_payload 僅存非結構化補充 |
| F17 | projects-platform §3.4 vs §11.2.1 vs projects.confidential_fields | field metadata 三處(confidential 策略) | `project_form_fields` 單一定義源 |
| F18 | quote-system-spec §2.4-2.5 | `*_cost_enc` 硬編成本 column | 全砍 · 走 `form_field_values` + cost component(v0.3.5 未上 prod 不遷移) |

---

## §7 重構分期(6 階段 · 每期獨立交付)

| Phase | 範圍 | 交付 |
|---|---|---|
| **Phase 0** | **DDL 收斂與補齊** | 補 9 個定義缺口表(equip 類別三表 / audit 併 bom_audit_log / baseline_diff / admin_grant / pfm_cell_audit / mva_variant / mva_pkg — **先拍板複用 vs 新建**,見 §8);`bom_cs_component` 加 `model_applicability + fallback_into_code` 登錄全 20 component;`bom_factory_baseline` 加 `costing_model + sga/profit base_ref + oh_pct + outbound_transportation + loss_factor_per_process + smt_*`。**不動 render** |
| **Phase 1** | **計算引擎統一** | 單一 superset 計算 path 讀 mask + 參數;SGA/Profit/LOSS/FREIGHT 抽 `{base_ref,pct}/{scope,granularity}/{direction,method}`。QA regression 對兩支 Excel 各 ε<0.01。砍 cs_run_cell vs result 並存、MVA 雙權威源 |
| **Phase 2** | **section/render 去分岔** | F1 三元 → 單一 section list + enabled_when;F4 7 處 title.includes 全改 flag;F3 mvaCaseBg 收斂;F7 mvaGet* 四 helper 收斂;F10 badge data-driven |
| **Phase 3** | **render 函數合併** | whoop_modules→bom · whoop_sku→packaging · whoop_summary+factory_matrix+margin→cost_matrix · whoop_process→process_mva(macro)· whoop_cost→cost_structure。**砍 5 個 renderFormWhoop*** + STEELSERIES_* vs DEFAULT_* 雙 const |
| **Phase 4** | **form 引擎去 plugin 化** | `qp_form_*` → 通用 `project_form_*`;F17 機密 metadata 三處收斂單一定義源;data_payload 退非結構化;F18 `*_cost_enc` 硬編砍 |
| **Phase 5** | **propagate 終點收斂 + 清理** | data_payload.factory_matrix JSON 退役 · pfm_cell 4 表唯一終點;移除舊 STEELSERIES_FM 2維/DEFAULT_FM/bom_factory_dl_role 死表;Gap section 通用化 |

> demo 落地順序建議:Phase 2 → Phase 3(視覺驗證 single-superset)· SD/schema 為 Phase 0/1/4/5。

---

## §8 風險 + Phase 0 待拍板

### 8.1 風險(8 項)

1. **SGA/Profit base_ref 參數化**若沒對齊 Excel 基底(FULL=mb×2% vs SIMPLIFIED=subtotal×3%),數字錯而 UI 看不出 → 必須兩支 Excel ε<0.01 regression 守住 + base_ref/pct 顯在 cost_structure 供稽核。
2. **fallback_into=OVERHEAD_4PCT 吸收邏輯**雙重風險:漏算(disable 細項但 OH 沒吸到)或重複算 → 引擎在 mask 解析層保證「disable 細項時金額恰好且僅一次累加進 OH」+ 逐 component 對帳。
3. **`title.includes('SteelSeries')` 散 7 處**(不只盤點列的)→ Phase 2 全域 grep 掃淨 + lint 禁止再用 title 判型。
4. **WHOOP SIMPLIFIED 5 component + pkg_module_include + per-process loss JSON + contract price 目前 DB 全未落地**(C1-C6 缺口)→ Phase 0 DDL 量被低估,排期含這批新建。
5. **cost_matrix 三 section 合一**:WHOOP=SKU pivot · SteelSeries=多維,維度退化邏輯沒抽乾淨會變成新 `if(isWhoop)` 分岔 → 合併目標是**資料控制維度**,不是函數內再 branch。
6. **9 個定義缺口表未拍板就實作會各自長 schema** → Phase 0 先確認複用 vs 新建,否則 superset 又裂。
7. **設備個別機 → 類別制收斂**:既有 SteelSeries 28 實體設備需遷移成類別配置,遷移期 `mva_source` 對帳易飄(cleansheet→factory_matrix VN≈1.43/TW≈3.207 ε<0.01 不可破)。
8. **form 引擎去 plugin 化**觸及既有 QUOTE 案 instance/version 鏈 + Excel binding → 需兼容期雙讀;「form 太彈性 → 跨 BU 統計難」風險統一後放大,核心欄(amount/margin/customer)強制必填約束要先立。

### 8.2 Phase 0 待拍板:9 個缺口表「複用 vs 新建」

| # | 表 | 我建議 |
|---|---|---|
| 1 | `bom_equip_category_catalog` | 新建(類別制核心) |
| 2 | `bom_factory_equip_category_price` | 新建 |
| 3 | `bom_cs_case_equip_category` | 新建 |
| 4 | audit(`bom_cs_audit_log` / `pfm_cell_audit`) | **併入單一 `bom_audit_log`**(event_type enum 擴) |
| 5 | `bom_cs_baseline_diff` | 當 `bom_audit_log` 的 event 或獨立表 — **待拍** |
| 6 | `bom_settings_admin_grant` | 沿用 v0.4 已設計(權限 grant) |
| 7 | `pfm_factory_mva_variant` / `_mva_pkg` | 當 `pfm_cell` 維度展開 vs 獨立 — **待拍** |
| 8 | `bom_cs_case_macro_process` / `_macro_station` | 新建(WHOOP 放大製程) |
| 9 | `bom_factory_smt_point_rule` / `bom_cs_case_smt_point` | 新建(SMT 點數) |

---

## §9 對外文件對應

| 文件 | 角色 | 統一後狀態 |
|---|---|---|
| 本文件 | 統一架構主規格 | authoritative |
| cleansheet-mva-sd v0.5→v0.6 | MVA 計算細節 | 併入 component mask · FULL_MVA 部分 |
| bom-collection-sd v0.4 | BOM 結構 | module 層為 superset 第 1 層 |
| factory-matrix-schema-sd | 多廠矩陣 | cost_matrix 維度模型 · cs_run 唯一權威 |
| projects-platform-spec | 專案平台 + form 引擎 | `project_form_*` 統一定義源 |
| quote-system-spec | 報價 | `*_cost_enc` 砍 · 走 form_field_values |

---

**完。** 本文件為 Cortex 全系統收斂主規格。後續任何 demo / SD / 實作以此為準;新增專案類型 = 加 `costing_model` + component mask 列,不分岔。
