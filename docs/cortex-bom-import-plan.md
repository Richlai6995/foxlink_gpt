# Cortex BOM 匯入 → 接引擎 全鏈 實作計畫(SOT)

> 下一刀:把 BOM 建檔/匯入功能層做出來,material rollup 接進 S1 計算引擎,對真 Excel 端到端驗。
> 決策(2026-07-01,user 拍板):**BOM 匯入 → 接引擎全鏈**(不是只做匯入、也不是先做操作 UI)。
> 原則 2「先從 BOM 建立開始,一步一步完整所有程式」的正式起手。

---

## 0. 現況快照(接手前先讀)

- **S1 計算引擎已完成 + commit master**(`b51cf3e`,接在 S0 `4b5a5f7` 後,**未 push**):
  - `bomCostEngine.computeCase` 兩路徑對真 Excel ε<0.01(FULL Rival3 1.8522 / SIMPLIFIED WHOOP 89.5537)
  - 落庫 run/run_cell/run_result/audit + 冪等
  - 全 dark-launch:gate 在 `ENABLE_CORTEX_BOM`,flag off = 現有使用者零影響
- **BOM 結構鏈(013b `bom_instance/section/item/item_flk/item_mfg/item_price_*`)= 純 schema,零功能層**(無 parse/create/view)
- **material 目前哪來的**:FULL 靠 `computeCase({motherboardCostUsd})` 參數或 `baseline.motherboard_cost_ref`(fixture 灌 8.683);SIMPLIFIED 靠 `bom_cs_case_simplified_line`(fixture 灌材料 line)。**BOM→成本接線尚未做**——這份計畫就是做這個。
- **v1 `aiCleansheetService`(/api/projects/ai/cleansheet-analyze)= LLM 分析式舊路,沒接正規化表也沒接新引擎**。本計畫不動它;日後 S2/整合再 reconcile(當 adapter 或廢棄)。

---

## 1. 目標(端到端可驗)

```
Rival3 Gen2 BOM Excel  →  parse  →  bom_instance + bom_item(正規化 · 三廠/選項)
                                        │
                                        ├─ material rollup(Σ item extended cost / 每廠)
                                        │
                                        └─→ 餵 computeCase 的 material_true(取代 fixture motherboard 8.683)
                                                    │
                                                    └─→ 對 Build Cost sheet 廠別總價 ε<0.01
```

**驗收**:匯入 Rival3 Gen2 BOM → 選 CN 廠 → material rollup 值對得上 Excel「Unit Cost / Build Cost」sheet 的材料小計;再跑 computeCase → 完整報價對 Build Cost 總價 ε<0.01。

---

## 2. Rival3 Gen2 BOM Excel 結構(`docs/Rival 3 Gen2 uni bom_112624_v1_Internal_Troy_Amber rev2.xlsx`)

**23 個 sheet · 多料別(EE/ME/PKG)× 三廠(China/Vietnam/Taiwan)× Option A/B/C** —— 比 Cleansheet 複雜得多。關鍵 sheet:

| # | sheet | 用途 |
|---|---|---|
| 0 | `Unit Cost` (30×45) | 三廠 × Option A/B/C 單位成本彙總(A1 Project=ELM5 · Retail Packaging 分廠分 Option)|
| 5 | `EE bom 0227` (184×45) | **電子料主 BOM**(184 列,主料源,第一刀就抽這張)|
| 3/4/10/11 | `ME bom ..._Black/_White` | 機構料(黑白配色件)|
| 1/2/8/9/12/13 | `PKG BOM ...`(多版本) | 包裝料(多日期版本,要挑對版)|
| 7 | `Build Cost` (37×238) | **成本彙總(驗收 golden 來源)**|
| 6/15/... | NRE / MTE / Dev Labor | 一次性費用(**本刀先不碰**)|

**⚠️ 複雜度雷**:同料別多版本(PKG BOM 有 7 版)、黑白兩色 ME、Option A/B/C、三廠幣別。第一刀**只抽 EE BOM 主料 + 單一廠(CN)+ 單一 Option**,ME/PKG/多廠/多 Option 後續切片。

---

## 2.5 B-0 探勘結果(2026-07-01 已完成)

**golden 源 = `Unit Cost` sheet(不是 Build Cost!)** — Build Cost 是 EV/DV/PV/MP 開發/樣品費(200 台 line charge + NRE),非 per-unit 產品成本。Unit Cost 把全鏈串起(col D=China):

| Unit Cost 列 | 值(China) | 關係 |
|---|---|---|
| EE (Black) / (White) | **6.017395** / 6.088895 | EE 材料(rollup 目標)|
| ME (Black) / (White) | 1.67134 / 1.815194 | 機構材料 |
| Packaging | 0.828095 | 包裝 |
| **Black Material Cost** | **8.51683** | = EE+ME+PKG |
| MVA | **1.8558** | **= Cleansheet 的 MVA(≈1.8522)** |
| PRIME COST (Black) | 10.37263 | = Material + MVA |
| SG&A+Profit | 0.75 | |
| Total Cost Ex-Factory (Black) | 11.12263 | = PRIME + SG&A+Profit |

**✅ 解掉待確認 #3**:Cleansheet motherboard 8.683 ≈ BOM **Material Cost = EE+ME+PKG**(Black 8.517 / White 8.732,8.683 在中間)。**不是只有 EE**。→ material rollup 目標 = EE+ME+PKG 三料別加總;MVA 由 Cleansheet 引擎(S1)算,兩表在 Unit Cost 交會。

**EE BOM 佈局(`EE bom 0227` · 184 列)**:
- header 在 **r3**:`B=Item# · C/D/E=Qt'y(三版) · F=FLK P/N · G=Type · H=SMD/DIP/ASSEMBLY · I=Description · J=Reference · K=Vendor · L=Part number · M=MOQ/SPQ · N/O=L/T · P=U/P(USD) · Q/R=Sub-Total · S=U/P(USD)2 · T=Sub-Total2 · U=Remark`
- **料件列**:B 有 item#、P/S 有單價;下方**多列只有 K(vendor)+L(part#)= 替代供應商**(→ `bom_item_mfg`)
- 分類列:B 欄放類別名(如 "Capacitor" / "Main Board")無 item# → `bom_section`/`bom_category`
- **欄位映射(對帳實證)**:`Σ(S × E) = 6.016795 ≈ EE_black 6.017395`(Δ0.0006)。**用「有價格的 item 列」的 U/P(S 欄)× qty(E 欄)**;**Excel 自帶 Q/R/T sub-total 不可用**(11.35/11.54/19.80,把 alt-vendor/雙情境重複算)。Δ0.0006 待 B-1 釐清(可能 scrap% 或某列手值)。
- golden 檔:`tmp/rival3_gen2_bom_golden.json`

## 3. 目標 schema(013b · 已確認)

**成本不在 bom_item**(它只有 qty/desc/part#),走價格鏈:
- `bom_instance`(project_id→projects · version_no · variant_key black/white · price_strategy MIN|AVG|MAX)
- → `bom_section`(module_category EE|ME · name)→ `bom_category`(process_type SMD|DIP|ASSEMBLY)→ `bom_item`(qty · description · customer_item · fpn/wpn · item_sequence)
- → `bom_item_price_snapshot`(applied_price_usd · price_min/avg/max · strategy_used)→ `bom_item_price_tier`(true_cost_source/fx_rate→true_cost_usd VIRTUAL · quote_price_usd · markup VIRTUAL)
- `bom_item_flk`(FLK 料號候選)· `bom_item_mfg`(替代供應商 ← EE BOM 的 alt-vendor 列)

**B-1 匯入映射**:EE BOM 每「有價 item 列」→ `bom_item`(qty=E 欄 · description=I · customer_item=F FLK P/N)+ `bom_item_price_snapshot`(applied_price=S 欄 · strategy='EXCEL')+ 單一 `bom_item_price_tier`(true_cost_source=S · fx_rate=1 · quote=S)。alt-vendor 列 → `bom_item_mfg`(manufacturer_name=K · mfg_part_number=L)。section=EE,category 依 G/H(Capacitor/SMD…)。

### (原 §3 schema 清單保留於下,已併入上方)

- `bom_instance` — 一份 BOM 的 header(接 projects?case?待確認 FK)
- `bom_section` — BOM 分區(EE/ME/PKG?)
- `bom_item` — 逐料件(part_no / desc / qty / unit_cost / extended_cost / 廠別?)
- `bom_item_flk` / `bom_item_mfg` — 正崴料號 / 廠商料號對應
- `bom_item_price_snapshot` / `bom_item_price_tier` — 價格快照 / 級距
- `bom_erp_item_index` — 接 ERP 料號索引

**接手第一步**:`sed -n '/CREATE TABLE bom_instance/,/)`)/p' server/projects-platform/migrations/013b_bom_collection.js`(+ bom_section/bom_item)拿到真欄位,再定 parse→insert 映射。

---

## 4. 引擎接線點(已備好的 hook)

`bomCostEngine.computeCase(db, opts)`:
- **FULL**:`materialUsd = motherboardCostUsd 參數 ?? baseline.motherboard_cost_ref`。→ **改成:先算 BOM material rollup,當 `motherboardCostUsd` 傳入**(或新增 `materialSource:'bom'` 讓 engine 自己撈 rollup)。
- **SIMPLIFIED**:`materialUsd = Σ simplified_line`。→ WHOOP 的材料 line 未來也可由 BOM rollup 產,但**本刀先做 FULL(Rival3)**。
- run_result 已有 `material_true_usd` 欄,rollup 值落這。

**建議**:新增 service `bomMaterialRollup.js`(讀 bom_item → 依廠/Option 加總 extended cost → 回 material_true),`computeCase` 在 FULL 路徑優先用 rollup(有 BOM 時)否則 fallback 參數/baseline。保持引擎解耦:rollup 是獨立 service,computeCase 只收一個數。

---

## 5. 切片(慢慢推進 · 每刀對 Excel 驗)

| 切片 | 內容 | 驗收 |
|---|---|---|
| ~~**B-0 探勘**~~ ✅ 2026-07-01 | 013b schema 確認 + EE BOM 佈局(header r3 · S×E 映射)+ golden 源=Unit Cost(非 Build Cost)+ 解掉 #3(material=EE+ME+PKG)| golden `tmp/rival3_gen2_bom_golden.json` ✓ · 見 §2.5 |
| ~~**B-1 parse+normalize**~~ ✅ 2026-07-01 | `bomImportService.importEeBom`(Node 直讀 xlsx)抽 EE BOM → bom_instance/section/category/item + price_snapshot/tier + mfg(類別取 G 欄 · 有價列=item · 無價 K/L=替代供應商)| **通過**:item 70 · mfg 137 · cat 10 · rollup 6.0168 對 EE_black 6.0174 Δ0.0006<0.01 · 冪等 ✓ · test-bom-import.js |
| **B-2 rollup 接引擎** | `bomMaterialRollup` service → material_true → `computeCase` FULL 路徑用它 | rollup 值 = Excel 材料小計;computeCase total 對 Build Cost ε<0.01 |
| **B-3 檢視入口** | 極簡 read route/CLI:列 bom_instance / bom_item / 觸發算 / 看 run_result | 能點/查看到匯入的 BOM + 算出的報價 |
| **B-4 擴充** | ME/PKG 料別、三廠、Option A/B/C、多版本挑選 | 各廠/Option 對 Unit Cost sheet |

**MVP 線**:B-0 → B-1 → B-2(打通 BOM→成本端到端),B-3/B-4 後續。

---

## 6. 待確認 / 決策(接手時拍板)

1. **`bom_instance` 掛哪**:接 `projects(id)`?還是 `bom_cs_case_factory`?(cleansheet 是 case_id→projects;BOM 應該也掛 case/project)→ 看 013b FK。
2. **廠別/Option 在 item 層還是 instance 層**:Unit Cost sheet 是「三廠×3 Option」矩陣。item 的 unit_cost 是否 per 廠?→ 決定 schema 用法(可能一個 bom_instance 對一廠一 Option,或 item 帶廠別欄)。
3. **BOM material 與 Cleansheet motherboard 的關係**:Cleansheet 的 motherboard=8.683 是 PCBA 成本;Gen2 BOM 的 EE rollup 是否 = 這個 8.683,還是更大範圍(含 ME/PKG)?→ B-0 對帳時釐清(可能 EE rollup→motherboard,ME/PKG 另外進 material 或 pkg_true)。
4. **parse 方式**:沿用 tmp/ python(openpyxl 先驗 golden)+ Node service(正式匯入)雙軌?還是直接 Node xlsx?→ 建議同 Cleansheet:python 抽 golden 對帳、Node 正式匯入。
5. **Excel 版本雜訊**:PKG BOM 7 版、ME 黑白、Option A/B/C —— B-1 先鎖 EE + CN + 單 Option,其餘明確標「後續」。

---

## 7. 接手第一步(resume 時直接做)

```bash
# 1. 確認 013b 目標 schema 欄位
sed -n '/CREATE TABLE bom_instance/,/)`)/p;/CREATE TABLE bom_section/,/)`)/p;/CREATE TABLE bom_item /,/)`)/p' \
  server/projects-platform/migrations/013b_bom_collection.js

# 2. 抽 EE BOM sheet 欄位佈局 + Build Cost golden(寫 tmp/dump_gen2_bom.py,UTF-8 避 cp950)
#    看 EE bom 0227 的 header 列(part_no/desc/qty/unit_cost/extended 在哪欄)
#    看 Build Cost / Unit Cost sheet 的廠別材料小計 + 總價 → tmp/rival3_gen2_bom_golden.json

# 3. 依 golden 定 parse→bom_item 映射,寫 B-1 匯入 service + 驗證 script
```

**驗證節奏**:同 S1 —— 每刀寫 offline regression(對 golden ε<0.01),user 跑 test 貼結果,綠了再下一刀。全程 gate 在 `ENABLE_CORTEX_BOM`。

---

## 8. Track N — NRE 一次性工程費(2026-07-01 補規劃 · 原漏)

**缺口**:S1 引擎 + B-track 材料鏈都只做 per-unit 產品成本,**NRE 完全沒規劃**。NRE 可「單獨報」或「由產品單價分攤」,平台兩種都要吃。Track N 正交於材料鏈(B-1/B-2),兩者在最終報價匯總。

### 8.1 NRE 結構(`NRE Summary` sheet · 11 項 · 雙價 quote/true)

| # | 項目 | quote(charged) | true(cost) | 明細 sheet |
|---|---|---|---|---|
| 1 | Build Cost | 13600 | 33900 | `Build Cost` |
| 3 | EMC Debugging | 3750 | 3750 | |
| 6 | DVE Chromebook | 165 | 165 | |
| 7 | Travel Expense | 0(waived)| 0 | `Travel Expense` |
| 8 | Dev + NPI Labor | 10000 | 0 | `Dev+NPI Labor`(逐工種 61916)|
| 9 | Reliability(RET/ORT/PkgRET)| 1500+500+361 | ... | `RET(option1/2)` `ORT` `PKG RET` |
| 10 | Unique Fixtures(MTE)| 5000 | 80184 | `MTE NRE`(逐治具 EV/DV 19700 + PV/MP 56524 = 76224)|
| 11 | Tooling | 3000 | 2401 | |
| | **Total** | **37876** | **123566** | |

- **雙價 = 跟 `bom_item_price_tier`(true_cost/quote)同 pattern**,沿用 VIRTUAL 欄。
- 此 Excel 是**單獨報**(Unit Cost 的 per-unit 11.12 **不含** NRE)。
- 有下鑽層:MTE 治具逐項、Dev Labor 逐工種、RET 測項。

### 8.2 Data model(全新 · gated · dark-launch)

```
bom_nre_item(case_factory_id 或 project · 逐項)
  category         VARCHAR2(30)   -- BUILD|EMC|DEV_LABOR|RELIABILITY|MTE_FIXTURE|TOOLING|TRAVEL|DVE
  item_no, description
  qty              NUMBER
  unit_price_true  NUMBER(15,6)   -- true 成本側
  unit_price_quote NUMBER(15,6)   -- quote 收費側
  sub_total_true   VIRTUAL = qty × unit_price_true
  sub_total_quote  VIRTUAL = qty × unit_price_quote
  factory_code     VARCHAR2(20)   -- 選填(MTE 治具廠別相關)
  detail_json      CLOB           -- 下鑽(治具/工種明細)
  remark, sort_order
```
模式開關(掛 `bom_cs_case_factory` 或 quote header,ALTER 加欄):
- `nre_mode        VARCHAR2(12) DEFAULT 'SEPARATE'`  -- SEPARATE | AMORTIZED
- `nre_amortize_qty NUMBER`                          -- 分攤基數(program 總量)

### 8.3 引擎接法

- **SEPARATE**(預設):NRE **不進** computeCase,獨立回 NRE 彙總(quote 37876 / true 123566),當單獨報價交付。
- **AMORTIZED**:`nre_per_unit = Σ NRE(quote) / nre_amortize_qty` → 新增成本 component **`NRE_AMORT`** 進 total。
  - `bom_cs_component` 需加 `NRE_AMORT`(BOTH · seed);`bom_cs_run_result` **加 `nre_per_unit_usd` 欄**(便宜加性 ALTER · gated),total_true/quote VIRTUAL 公式納入。
- computeCase 讀 nre_mode:SEPARATE → NRE 走旁路 service(`bomNreRollup`)只回總表;AMORTIZED → 併入 per-unit。

### 8.4 切片(Track N · 排在 B-2 之後)

| 切片 | 內容 | 驗收 |
|---|---|---|
| **N-0** | 抽 NRE Summary + 明細 sheet golden(quote/true 逐項)→ `tmp/rival3_nre_golden.json` | 對 Total 37876/123566 |
| **N-1** | migration `bom_nre_item` + mode 欄;匯入 NRE Summary 11 項(+ 明細 JSON)| 逐項 + Total ε<0.01 |
| **N-2** | `bomNreRollup` service + computeCase 接 nre_mode;SEPARATE 回總表 / AMORTIZED 加 NRE_AMORT | 兩模式各驗;AMORTIZED 對「per-unit + NRE/qty」|

**不影響現況**:run_result 加 nre 欄是加性 ALTER(gated),現在不加、之後 N-2 再加也不破壞 B-1/B-2。

### 8.5 待拍板(N 開工時)

1. **NRE 掛層級**:project(一產品一組 NRE)還是 case_factory(廠別)?MTE 治具是廠別相關 → 傾向 **project 掛主表 + item.factory_code 選填**。
2. **分攤用 quote 還是 true**:AMORTIZED 通常攤 quote 側(客戶透過量攤付)。預設 quote,可設定。
3. **明細層深度**:MTE/Dev Labor/RET 明細先塞 `detail_json`,還是各自建子表?MVP 先 JSON,之後有 UI 編輯需求再正規化。

## 附:相關檔案索引

- 引擎:`server/projects-platform/services/bomCostEngine.js`(computeCase / persistRun)
- S1 計畫 + 驗證:`docs/cortex-s1-cost-engine-plan.md`、`server/projects-platform/scripts/test-bom-cost-engine.js`
- BOM schema:`server/projects-platform/migrations/013b_bom_collection.js`
- 待抽 Excel:`docs/Rival 3 Gen2 uni bom_112624_v1_Internal_Troy_Amber rev2.xlsx`
- golden(S1):`tmp/rival3_golden.json`、`tmp/whoop_golden.json`、`tmp/mva_cells_dump.txt`
- 記憶:`project_cortex_cost_engine_s1d.md`(S1 全紀錄 + 兩 bug + 設備真模型)
