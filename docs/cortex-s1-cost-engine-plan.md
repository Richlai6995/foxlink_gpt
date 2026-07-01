# Cortex S1 — 單一計算引擎 實作計畫(SOT)

> 版本:v1.0 / 2026-06-30 · 狀態:規劃收斂(workflow `cortex-s1-plan-spec`)· 待 user 拍板入口後開工
> 前置:S0 完成(50 表 · commit `4b5a5f7` · dark gated `ENABLE_CORTEX_BOM`)
> 關聯:[cortex-dev-rollout-plan.md](cortex-dev-rollout-plan.md) S1 · [cortex-unified-architecture-sd.md](cortex-unified-architecture-sd.md)(引擎/mask)
> 核心:**移植 demo v0.16 已驗證 ε<0.01 的 csCompute* 邏輯到 server、改讀 S0 正規化表**(非從零推公式)

---

## §1 引擎合約

`bomCostEngine.computeCase(db, { caseFactoryId, qtyScenarioCode?, motherboardCostUsd?, persist=true, actorUserId? })`
→ `{ runId?, costBreakdown, cells[], results[] }`

**INPUT(只讀 S0 表)**:`bom_cs_case_factory`(costing_model 分流主鍵)· `bom_factory_baseline`(全參數化核心:dl_wage / sga_base_ref / profit_base_ref / oh_pct / loss_factor_per_process / smt_allowance_pct / vat_rate_pct …)· `bom_cs_component`(model_applicability + fallback_into = component plan **唯一真相,不在程式硬列**)· FULL 額外讀 case_process/idl_role/idl_alloc/equip_category/equip_category_price/consumable/idl_linedep_wage · SIMPLIFIED 額外讀 smt_point/smt_point_rule/macro_process · material/pkg 從 BOM propagate(S1 先參數帶入)

**OUTPUT**:`costBreakdown` 物件 + 寫 `bom_cs_run`(header)→ `bom_cs_run_cell`(每 qty×process×component · intermediate_json 存對帳)→ `bom_cs_run_result`(fact · total/margin VIRTUAL 自動算)

**單一 path 分流(不 `if(model)` 散落)**:`buildComponentPlan(costing_model)` = `SELECT component_code, fallback_into_code FROM bom_cs_component WHERE model_applicability IN ('BOTH', :model)`。每 component_code → 一個 pure function(`computeXxx(inputs)→per-unit usd`),engine 只遍歷 plan 呼叫。**唯三 model 差異全參數化讀 baseline**:sga_base_ref / profit_base_ref / 是否含 OVERHEAD_4PCT+TRANSPORTATION(由 mask 自然決定)。
**鐵則**:DL wage 讀 `baseline.dl_wage_per_hr_usd`、IDL 讀 `bom_factory_idl_linedep_wage`,**絕不硬編**(對齊 MEMORY no-hardcoded-LOV)。

---

## §2 切片 S1a–d(建議序:S1a → S1b → S1d-Rival3 → S1c → S1d-WHOOP)

| 切片 | 交付 | 移植/新建 | 測 |
|---|---|---|---|
| **S1a** | `bomCostEngine.js` 骨架:`computeCase` 入口 + `buildComponentPlan` + `loadCaseInputs`(一次撈齊)· 9 compute_* stub 回 0 | 新檔 | 離線:FULL 回 12 component / SIMPLIFIED 回 8+5 fallback;表讀通 |
| **S1b** | FULL_MVA 6 函數移植(demo v0.16 行 9324-9629 csCompute*)· hardcode 常數**全換讀 S0 表** | 移植已驗證碼 | S1d Rival3 對帳 ε<0.01 |
| **S1c** | SIMPLIFIED 5 component(SMT 點數 `safeEvalFormula` / macro DL / 分製程耗損 / OH 4% 吸收 disabled / transport)+ `persistRun`(三表+audit) | 新寫(spec 公式) | WHOOP SMT 709.45 + 層級係數 |
| **S1d** | 離線 regression harness(Rival3+WHOOP ε<0.01)+ `seed-cleansheet-fixtures.js` + `bomToCleansheetAdapter.js`(掛 routes/ai.js 前置,cleansheet 內部零改) | 新檔 × 3 + ai.js ~10 行 | `node test-bom-cost-engine.js` 全綠 |

**新檔**:`services/bomCostEngine.js` · `services/bomToCleansheetAdapter.js` · `scripts/seed-cleansheet-fixtures.js` · `scripts/test-bom-cost-engine.js`。**碰既有**:`routes/ai.js`(adapter 前置 ~10 行,body 帶 case_factory_id 才轉,沿用舊 factories array 不變)。

---

## §3 open #1 解法(quote margin 公式)

**建議:維持現行 013c VIRTUAL(quote 側 mva/sga/profit 沿用 true 側、margin 只算 material+pkg),但先用 Rival3 Excel ε<0.01 實證確認才定案。**

數學理由:Cleansheet §F 的 SGA=motherboard×sga_pct、Profit=(MVA+mb)×profit_pct 是「成本+加成」,quote 與 true 在 MVA/SGA/Profit 是同係數同數;true vs quote 的賺頭只在 **material/pkg 雙價**(`bom_cs_case_pkg_item` VIRTUAL)。所以 margin =(material_quote+pkg_quote)-(material_true+pkg_true)與 Excel 毛利定義一致。

**退路(若 Excel 驗不過 · 便宜無遷移)**:013c `ADD COLUMN mva_quote_usd/sga_quote_usd/profit_quote_usd`(NULLABLE)+ 改 total_quote VIRTUAL 為 `material_quote+pkg_quote+NVL(mva_quote,mva)+…`(向下相容)+ margin 改全口徑。純 ADD + 改 VIRTUAL 表達式,既有列零遷移。

→ **S1d 第一次 Rival3 對帳時順帶確認;過了就不 ALTER。**

---

## §4 QA(兩支離線 regression · CI gate · ε<0.01)

- **Rival3(FULL_MVA · golden 信心高)**:golden 來自 `seed-demo-data.js` Q-2026-DEMO-009-SS 的 `factory_matrix.cells`(black/white × CN/VN/TW × pkg 的 total_cost_exfactory,如 CN-A=11.12 · mva{CN:1.86,VN:1.43,TW:3.00} · sga_profit:0.75 · suggested:11.87)+ demo csComputeTotalSteps 逐 step(motherboard=8.683)
- **WHOOP(SIMPLIFIED · golden 信心低)**:demo `WHOOP_SMT_COST`(675.7 points → +5% allowance = 709.45)+ 層級係數(OH 4%/SGA 3%/Profit 3%/Transport $0.50)
- harness:`computeCase(persist=false)` → 逐 (factory,variant,pkg,component) assert |computed−golden|<0.01 → 輸出對帳表,任一 FAIL exit 1 + 平衡檢查(VIRTUAL total == 明細加總)

---

## §5 form_template(薄層 · S1 只對齊 3 section · 其餘後續 form-engine slice)

form_template = **UI metadata + 欄位→S0 表寫入映射,不含公式**;引擎只讀 S0 表 → 兩者透過 S0 表**解耦**。
- 填在 `plugins/quote/index.js` 的空 form_template:`{sections:[{id,name,enabled_when,badge}], fields:[{field_key,label_i18n,data_type,section_id,is_confidential_default,s0_table_column,enabled_when,...}]}`
- **S1 範圍**:只把 `process_mva` / `cost_structure` / `cost_matrix` 三個與引擎直接相關的 section + `s0_table_column` 對齊(讓 fixture 表驅動、result 回顯)。其餘 11 section 放骨架+enabled_when,完整 field registry 屬後續 form-engine slice,**不阻塞引擎**。
- 機密:沿用 quote plugin `confidential_field_defaults:[amount,margin,cost_breakdown]`。

---

## §6 風險(7 · 已附緩解)

1. **WHOOP/SIMPLIFIED 非 demo 已驗證 live compute**(demo WHOOP 是靜態表)→ S1c 信心低於 Rival3;先驗 SMT/allowance/層級結構,full per-unit 對帳待真 quotation book,標 TODO
2. **aiCleansheetService 維度**(期待 pcb/smt/assembly vs run_result 是 material/pkg/mva)→ adapter 輸出五欄制 {material,pkg,mva,sga,total}(_computeComparisons generic 不炸);LLM prompt 寫死製程語意,改 key 後文案可能不貼 → 接點不動 prompt,要對齊再開小 slice
3. **demo 魔術常數**(sqft_alloc/VAT factor 18/loss/freight/motherboard 8.683)→ 全換讀 baseline 欄;sqft_alloc 暫 const+TODO(不影響 ε)
4. **VIRTUAL 改動影響 pfm_cell propagate**(若 open#1 走獨立)→ ADD COLUMN + NVL fallback,既有讀者零影響;propagate 讀明細不讀 VIRTUAL margin
5. **material/pkg BOM propagate 邊界未定**→ S1 用參數 `motherboardCostUsd` 帶入,engine 留 propagate hook,BOM 串接屬後續
6. **ENABLE_CORTEX_BOM flag**:harness 啟動先 assert `bom_cs_run_result` 存在,缺則明確報「需 flag + migrate」
7. **safeEvalFormula RCE**:SMT point_formula 是 DB 算式字串 → **自寫白名單 token parser(只允許 數字 +-*/() 與 pcs),禁 eval**

---

## §6.5 ⚠️ 真 Excel 公式(oracle · 2026-07-01 從 `Rival 3+ ...Cleansheet.xlsx` 抽)

**重大更正**:S1b 移植的 demo csCompute* 是**簡化/有 bug 版**,與真 Excel 公式不符(demo cn_matrix 才是忠實抄 Excel)。真公式(golden 見 `tmp/rival3_golden.json`):

- **MVA SUM(r118)= 1.8522** = `DL(L58) + IDL製造(Y70) + IDL集中(X83) + 設備(X94) + 廠房(X103) + 運費(J109) + 損耗(J112)`。**無 VAT**;IndMat 併在設備 X94。
- **DL 逐製程(r58)= (r56 DL成本/wk + r55 IDL-linedep/wk) / weekly_output(r24)**,且 **r55/r56 公式分兩組**:
  - **SMT 組**(SMT/WAVE/ROUTER/LASER):`r56=wage×SEA_wk×TotalDL/day×mult2×mult1`;`r55=(LLday×LLwage+Techday×Techwage+IQCday×IQCwage)×mult2`(無 Sup)
  - **BB 組**(BB_ASSY/BB_TEST/MAT_MGMT/Q_SMT/Q_BB):`r56=wage×mult2×TotalDL/day×SEA_wk`(**無 mult1**);`r55=(LLday×LLwage+Techday×Techwage+IQCday×IQCwage+Supday×Supwage)`(**含 Sup、無 mult2**)
  - → 需 **process_group 欄**(SMT/BB)· S0 `bom_process_catalog` 要加
- **IDL 集中(r74)= rate×multiplier/annual_demand**,加總 r74:82;製造 IDL(r64-68)另加總 r70
- **Facility(r100)= sqft×$/sqft/annual_demand × mult × (demand/weekly_output)**
- **VAT(r114)= mb×rate/annual_demand ≈ 0 · 不進 MVA**;**LOSS/FREIGHT** 引擎已對
- **SGA+Profit(r121)= (MVA+MB)×(sga_pct+profit_pct)** → SGA base 也是 **mva_plus_mb**(引擎現用 motherboard 錯)

**demo 繼承的 bug**(要在重寫時修):IDL-linedep double-count(shift+day 相加)· VAT /18 + 誤進 MVA · SGA base 錯 · DL 未分組 · Facility 少 mult/demand-ratio。

**修正後 S1b′**:引擎 FULL_MVA compute **照真 Excel 公式重寫**(process-group-aware)· 加 `bom_process_catalog.process_group`(013e ✓)· 灌 Excel 真 fixture → 對 golden 逐製程 DL + MVA SUM ε<0.01。

### §6.5.1 完整真公式(2026-07-01 逐格抽 · 引擎 v2 依此)

共用中間量(每製程):`UPH=3600/takt×yield×eff` · `weekly_output(C24)=UPH×working_hr_wk×lines` · `max_wk_demand(C20)=annual_demand/50×1.2` · **`util=C20/C24`**(稼動率)· `annual_demand=418000`。

- **DL(r58)= (r56 + r55)/C24**,分組:
  - SMT 組:`r56=wage×SEA_wk×TotalDL_day×mult2×mult1` · `r55=(LLday×LLwage+Techday×Techwage+IQCday×IQCwage)×mult2`
  - BB 組:`r56=wage×mult2×TotalDL_day×SEA_wk`(無 mult1)· `r55=LLday×LLwage+Techday×Techwage+IQCday×IQCwage+Supday×Supwage`(含 Sup 無 mult2)
  - `mult1=(wh/2×6)/SEA_wk` · `mult2=(SEA_day×days)/SEA_wk` · `TotalDL_day=(dl+debug+funct+warehouse)×shifts×lines`
- **IDL(r70+r83)= Σ role `rate×multiplier/annual_demand`**;製造 IDL(4 role:Op/Section/Eng/Lead · wage 60320/60320/24440/31200)每 area 各 mult;集中 IDL(9 role · 皆 20150)只分攤 SMT + MatMgmt 兩欄。area→代表製程:SMT area→SMT_MAIN、其餘塌到對應製程。
- **設備(r94)= MRO+Depr+IndMat**〔**2026-07-01 逆向更正 · demo 的 category-price+mro_pct 模型是錯的**〕:設備 = Equipment List 每台 `ext_cost/useful_life`,**MRO 只是 bucket 標籤**(短壽命設備行,算法同 Depr,**無 mro_pct**)。`MRO/Depr per_unit = Σ(ext/life)/annual_demand × util-if-flagged` · `IndMat=Σ(consumable annual)/annual_demand`(**無 util**)。
  - **util(C20/C24)選擇性套**:SMT area 套(共用產線按稼動分攤)、BB/Q area **不套**(專線全額)→ 存 `apply_util` flag,不寫死。廠房 util 更不一致(SMT+BB Assy 套、MatMgmt/Q-BB 不套)。
  - schema:013f `bom_cs_case_equip_area`(process/bucket/annual_cost/apply_util)+ `bom_cs_case_facility`(process/sqft/apply_util)。**舊 equip_category/equip_category_price/dep_years/equip_category_catalog 4 表作廢 → 013h DROP**。
- **廠房(r103)= (sqft×$/sqft/annual_demand)×util-if-flagged**(sqft:SMT 1458 / BB Assy 1650 / MatMgmt 110 / Q-BB 88 · $/sqft=14.4276)
- **Others(Common · 一次)**:`Freight=freight_annual(2500)/annual_demand` · `Loss=mb×loss_pct(0.0008)` · `VAT=mb×vat_rate/annual_demand ≈0`(**不進 MVA**)
- **MVA SUM= Σ製程(DL+IDL+設備+廠房)+ Freight + Loss**(無 VAT)= 1.852174
- **SGA/Profit 怪癖**:真 Excel `Profit 行 J121=(MVA+MB)×(profit%+sga%)=×0.16=1.685628`,**SGA 行(J120)空**。引擎拆成 `sga=(MVA+MB)×0.02 + profit=(MVA+MB)×0.14`,**相加=×0.16,total 一致**(MB+MVA+加成=12.2208)。兩 base_ref 皆 `mva_plus_mb`。

### §6.5.3 兩個致命 bug + 產能覆寫(2026-07-01 · S1d 修正,非公式錯而是輸入/schema)

1. **TECH 週薪**:真 Excel r44 `TECHNICIAN=436.8`(LL/IQC/SUP=403)。沒 seed `bom_factory_idl_linedep_wage` → `computeDl.wageOf` fallback 403 → 8 製程 DL 系統性偏低(合計 ~0.008,剛好破 total ε)。fixture 補 seed 4 role 週薪。
2. **Q_SMT / Q_BB weekly_output**:真 Excel `J24='=I24'`、`K24='=J24'` — 品檢/支援製程**承所在產線速率**(Q_SMT takt 8.64 自身 r21=46550,但受 BB 線 gating → 21168)。加 `bom_cs_case_process.weekly_output_override`(013g),`procDerive` 有值就用。fixture 設 Q_SMT=21168。

**驗證結果**(seed + test 在 server/ 目錄 · `ENABLE_CORTEX_BOM=true`):DL 9/9 Δ=0.00000 · MVA_SUM Δ=0.000669 · total Δ=0.000776,全 ε<0.01。殘留 ~0.0006 來自 `days_per_week=6.67`(真值 6.66996)使 SMT weekly_output 微差,可忽略。golden:`tmp/rival3_golden.json` + `tmp/mva_cells_dump.txt`。

### §6.5.2 SIMPLIFIED(WHOOP · whoop_golden.json)
`subtotal=Σ(材料模組+Consumable+Package+SMT+glue/ATE+FATP+SMT_yield_loss+FATP_yield_loss)` → `OH=sub×4%` · `SGA=sub×3%` · `Profit=sub×3%` · `+Transport 0.5` = TTL。SMT 點數:category×PCS×point_formula(算式字串)×unit_price +5% allowance。base_ref 全 = subtotal。

## §7 進度

| 切片 | 狀態 |
|---|---|
| S1a engine 骨架 | ✅ 已寫 + 語法過 — bomCostEngine.js + seed-cleansheet-fixtures.js(Rival3-CN)+ test |
| S1b FULL_MVA 移植 | ✅ 已寫 · 但 demo 移植版有 bug,已於 S1d 照真 Excel 重寫取代 |
| **S1d-Rival3 FULL_MVA 驗證** | ✅ **2026-07-01 全綠** — DL 9/9 Δ=0 · MVA_SUM 1.8522 / total 12.2208 ε<0.001。013e process_group + 013f equip_area/facility + 013g weekly_output_override + idl_linedep/TECH 修正。設備舊 4 表 013h DROP 中 |
| **S1c SIMPLIFIED + persist** | ✅ **2026-07-01 全綠** — computeSimplifiedMva(WHOOP TTL 89.5537 ε<0.01 · 013i simplified_line)+ persistRun(run/run_cell/run_result/audit · run_cell 按 process×component 聚合 · 冪等 archive · total_true VIRTUAL)。**兩 model 皆落庫**(FULL 57 cell / SIMPLIFIED 7 cell) |
| form_template 3 section | ⬜(隨 S2) |
| **S1 收工** | ✅ 單一引擎兩路徑對真 Excel ε<0.01 + 首次落庫 + 冪等。下一步 S2 權限三軸 / route 接線 / BOM 材料 propagate |
