# 報價 Form 完整度強化 — v0.16 對齊計畫(SOT)

> 2026-07-29 拍板。參照 [Cortex_互動Demo_v0.16.html](Cortex_互動Demo_v0.16.html)(SteelSeries Rival 3+ ELM5 Gen2 範例),把 demo 的 14 段報價 form 整合進平台。**執行順序照原設計 section 順序**。進度回寫本檔。

## 拍板決議(2026-07-29)

| # | 決議 |
|---|---|
| D1 | 實作順序 = **v0.16 原設計 section 順序**(非三波重排) |
| D2 | 案級表單欄位存 `projects.data_payload.form.{section}.{field}`(免 migration;機密靠 S2/角色遮罩) |
| D3 | 完成度**真計算**混合制:欄位型段=必填欄有值 n/m;資料型段=資料條件規則(per section 寫死)。demo 的 n/m 是寫死假數,不照抄 |
| D4 | 操作流程 checklist 完成判定**自動為主**(從 DB 資料判),無資料可判的步驟才手動勾 |
| D5 | 流程步驟**要可附圖**(demo 沒有圖;需 image slot:上傳+圖說+排序) |
| D6 | 詢價彙總(整機 5 廠商報價)**先不做** |
| — | 多廠矩陣/Cleansheet 檢視/MVA 操作流程/Margin Analysis 為重點,必實作 |

## 執行順序與狀態

| # | Section(v0.16) | 內容 | 狀態 |
|---|---|---|---|
| 0 | **基礎設施** | form 欄位 GET/PUT API(data_payload.form)+ 完成度計算 service + sidebar 完成度徽章 | ✅ 0cafca5 |
| 1 | 客戶資料 | 8 欄可編輯(客戶名稱/別名/統編/ERP 代號/PO 號/付款條件/收貨地址/採購窗口) | ✅ 0cafca5 |
| 2 | 🎬 操作流程 | 26 步 checklist(Stage 4–7)+ action 跳轉 + 自動完成判定 + **附圖上傳** | ✅ cc8bf4e |
| 3 | CMF 變體 | 變異值 share%/qty + 加權平均料成本(接現有變異軸) | ✅ d4973f7 |
| 4 | BOM 結構(案級欄) | ECN 版本/BOM lock 狀態/客供料(有無+明細)/採購策略總覽視圖(樹已有) | ✅ 55e0023 |
| 5 | 包裝 BOM | per-item true/quote/markup 視圖 + Pallet Compliance 欄(商包/工包=包裝變異值,已有) | ✅ |
| 6 | ~~詢價彙總~~ | 不做(D6) | ✂️ |
| 7 | NRE 成本 | Original vs Negotiated 雙欄 + 議價削減 %(接議價紀錄語意) | ⬜ |
| 8 | 多廠矩陣 v0.7 | **qty scenario 軸**(cell key 擴充)+ cell 分解列(MVA/材料/SGA/Total/Margin)+ toggle(qty/pkg/true/margin) | ⬜ |
| 9 | Cleansheet 檢視 | 9 cost component × 9 process 矩陣 + baseline bar + KPI 卡 + step trace(資料全有,純檢視 UI) | ⬜ |
| 10 | MVA 操作流程 | Phase A–G(素材/步驟/兩案差異/DB 表)教學段 + PPTX 手冊連結 | ⬜ |
| 11 | Margin Analysis | 24-cell margin heatmap + Top Markup Items per PKG + VIEW_TRUE_COST 閘 | ⬜ |
| 12 | 成本核算(補) | 建議售價/毛利率/年營收摘要卡(其餘已有:定版/議價/AI 比對) | ⬜ |
| 13 | 議價策略 | 10 欄(底線毛利率/輪次(自動)/競品價/議價空間/過往折讓/筆記/贏單機率/最低可接受價/量價條件/特殊條件)+ AI 輔助填 | ⬜ |
| 14 | ~~法務 review~~ | 不做(舊 RFQ 流程) | ✂️ |

## 技術設計備忘

### 欄位儲存(D2)
```
projects.data_payload.form = {
  customer:  { cust_name, cust_alias, tax_id, cust_code_erp, po_number, payment_terms, ship_address, contact_name },
  bom_meta:  { ecn_version, has_consign, consign_list },   // lock 狀態由 quote version 推導
  strategy:  { min_margin, compete_price, cust_room, past_discount, strategy_note, win_prob, fallback, qty_discount, special_terms },  // round_no 自動
  cost_meta: { sale_price_draft },
  pkg_meta:  { pallet_compliance: ['EPAL','GMA','PLYWOOD'] },
}
```
- API:`GET /projects/bom/form?projectId=` 回 form + 完成度;`PUT /projects/bom/form/:section` patch(掛 bom router 吃 S2 wrapper;策略/成本段非全視角遮值)
- 完成度 service:`bomFormCompletionService.js` — SECTION_DEFS:欄位型(required key 清單)/ 資料型(async 條件函式)

### 資料型段完成度規則(D3)
- BOM 結構:有 instance +、items>0 +、pending=0 +、案級必填欄
- NRE:有 items +、config 已設 +、negotiated 欄
- 多廠矩陣:cells 滿格 = done;部分 = warn
- Cleansheet:各廠有 active baseline
- 成本核算:有 run/官方版/…
- 操作流程:26 步完成數(自動判定)

### 操作流程 checklist(D4/D5)
- 步驟定義:server 常數(Stage 4–7 × 26 步,對齊 v0.16 15139–15271)+ 每步 `auto(db, projectId)` 判定函式或 `manual`
- 手動勾/附圖存 `data_payload.form.workflow = { done:{'4.1':ts}, images:{'4.1':[{url,caption}]} }`
- 附圖:沿用 UPLOAD_ROOT/projects/bom/{userId} multer;縮圖顯示在步驟卡
- action 按鈕:跳現有 UI 區塊(BomSection/明細/矩陣/成本核算)

### 多廠矩陣 qty 軸(#8)
- run cache key 現為 (case_factory_id, variant_value_ids);**擴 qty_scenario_code 進 key** → 013u migration(bom_cs_run 加欄?已有 qty_scenario 概念 — computeCase 有 qtyScenarioCode 參數,確認 run 表有沒有存)→ matrix cells key = cf|sig|qty
- cell 分解列從 run_result 既有欄(mva/sga/profit/material)取,S2 遮罩自動

### v0.16 demo 已知造假(落地要修正)
- sidebar n/m 全寫死(workflow 26 步 vs 寫 14/22;NRE 12 列 vs 11)→ 我們真算
- 客戶資料 sample 是舊 Apple 資料 → 不照抄 sample,只抄欄位
- 版本徽章(v0.5/v0.7)是 demo 裝飾 → 不做

---

# 附錄:v0.16 原設計解剖(SOT · 2026-07-29 完整分析)

> 來源:`Cortex_互動Demo_v0.16.html`(950KB)。**後續 #3~#13 實作以此為準,不必重讀 HTML**。行號 = v0.16 檔內位置。

## A. 架構前提:demo 內有兩套不一致的資料

| | 位置 | 用途 |
|---|---|---|
| (A) `schemas.QUOTE.sections` | 行 10144–10301 | 表單模板治理 metadata(id/label/type/required/conf/ai/linked/hint),8 段,無 sample |
| (B) `renderFormTab(p)` | 行 13180–13312 | 實際互動表單,14 段,sample hardcode 在 template string |

以 (B) 為主。**demo 的 filled/total 全是寫死假數**(workflow 實 26 步寫 14/22、NRE 實 12 列寫 11)→ 平台改真計算(D3)。版本徽章(v0.5/v0.7…)是裝飾,不做。

## B. 14 段清單(showcase_advanced = SteelSeries Rival 3+ ELM5 Gen2)

| # | id | name | demo n/m | conf | render 行號 | 平台對應 |
|---|---|---|---|---|---|---|
| 1 | customer | 客戶資料 | 8/8 | | 13358 | ✅ #1(8 欄) |
| 2 | workflow_checklist | 🎬 操作流程 | 14/22(實 26 步) | | 15132(stages 15139–15271) | ✅ #2(26 步平台化) |
| 3 | variants | CMF 變體 | 6/6 | | 14342(資料 7699) | #3 |
| 4 | bom | BOM 結構 | 14/16 | | 13429(樹 8682) | #4(樹已有,補案級欄) |
| 5 | packaging | 包裝 BOM | 14/16 | | 14438(資料 8868) | #5 |
| 6 | inquiry | 詢價彙總 | 6/8 | | 13819 | ✂️ 不做(D6) |
| 7 | nre | NRE 成本 | 7/11(實 12 列) | 🔒 | 14608(items 14611) | #7 |
| 8 | factory_matrix | 多廠矩陣 | 24/24 | 🔒 | 14718(FM_FULL 8902) | #8 |
| 9 | cleansheet | Cleansheet (MVA) | 81/81 | 🔒 | 15732(資料 9018+9089–9530) | #9 |
| 10 | mva_workflow | 🛠️ MVA 操作流程 | 33/33 | 🔒 | 17220(MVA_PHASES 16984) | #10 |
| 11 | margin_analysis | Margin Analysis | 24/24 | 🔒🔒 | 17434 | #11 |
| 12 | cost | 成本核算 | 6/10 | 🔒 | 14015 | #12(已大半,補卡) |
| 13 | strategy | 議價策略 | 2/10 | 🔒 | 14214 | #13 |
| 14 | legal | 法務 review | 0/8 | | 14292 | ✂️ 不做 |

## C. 各段欄位/資料形狀(實作規格)

### C1. 客戶資料(✅ 已做)
8 欄:cust_name(客戶名稱)/cust_alias(別名 A001)/tax_id(統編)/cust_code_erp(ERP 主檔代號 · linked)/po_number(PO 號)/payment_terms(付款條件 select)/ship_address(收貨地址 textarea)/contact_name(採購窗口)。

### C2. 操作流程(✅ 已做 · 平台化 26 步)
demo shape:`stages[]`(Stage 4–7)`step={id,name,desc,status,who,at,action:{kind:'jump'|'modal'|'inline'}}`。
**demo 無任何圖片**(上傳 modal 是假拖放區)→ 平台加 `form.workflow.images[stepId]=[{url,caption,at}]`(D5)。
平台 26 步定義在 [bomWorkflowChecklistService.js](../server/projects-platform/services/bomWorkflowChecklistService.js)(auto 判定 ctx:instance/sections/dims/effectivity/cf/baseline/chosen/pending/nre/nreNeg/pkgItems/qtyScen/runs/matrixFull/submitted/approved/rounds)。

### C3. CMF 變體(#3)
demo:`p.variants=[{key,label,share,qty,material_cost}]` — Black(share 0.80 · qty 334,400 · mat $8.52)/White(0.20 · 83,600 · $8.73);加權平均料成本 = Σ(mat×qty)/Σqty。
平台落法:share/qty 存 `form.variant.shares[valueId]={share,qty}`(顏色維度值);材料成本從該 config rollup 動態取;加權卡顯示。完成度規則已寫(bomFormService variant 段)。

### C4. BOM 結構(#4)
案級欄(demo schema 10169–10185):`bom_part_no`(主料號)/`ecn_version`/`bom_lock_state`(computed:DRAFT/LOCKED ← 平台=有 SUBMITTED/APPROVED 版即 LOCKED)/`has_consign`(有無客供料 select)/`consign_list`(cond required)/`qty_per_unit`/`total_qty`(computed)/`bom_files`。
→ 平台補:ecn_version/has_consign/consign_list 存 `form.bom_meta`;lock 狀態由 quote version 推導顯示;「採購策略總覽」= 每料 chosen vendor+price 一覽表(items API 已有資料,加視圖)。
demo 5 層樹(section→category→item→mfg→snapshot)平台已超越(FLK 層 + effectivity)。

### C5. 包裝 BOM(#5)
demo:`STEELSERIES_PKG_VERSIONS`=[{code:'RETAIL'|'BULK', label_zh(商包/工包), items_count, total_true, total_quote, markup_avg, is_primary, channels[], items:[{no,name,spec,qty,true_cost,quote_price,vendor,lt,note}]}]。RETAIL true $0.706/quote $0.828/markup 17.3%;BULK $0.182/$0.275/51%。案級欄 `Pallet Compliance`(EU EPAL/US GMA/APAC Plywood 多選)。
→ 平台:商包/工包=包裝變異值(已有);per-item true/quote/markup 視圖從 PKG 模組料 tier(true_cost_usd/markup_pct/applied)取;pallet_compliance 存 `form.pkg_meta`(完成度已接)。

### C7. NRE(#7)
demo 雙欄 Original vs Negotiated,12 列(Build 13,600/13,600 · EMC Debug 3,750 · Travel 6,000→0 · Dev+NPI 93,299→10,000 · Reliability 9,159→1,500 · RET 2,223→500 · ORT 7,530→361 · Fixtures 80,185→5,000 · Tooling 3,000…);總 $218,911→$37,876(↓82.7%)。
→ 平台:`bom_nre_item` 加 `unit_price_negotiated` 欄(013u migration);UI 雙欄+削減%;compute/quote 用 negotiated(有值)否則 original;checklist 5.8 自動判定已預留。

### C8. 多廠矩陣(#8)
demo 24 cells = 3 廠 × 2 variant × **2 qty(LOW/HIGH)** × 2 pkg;`cell={factory,variant,qty,pkg,material_true,material_quote,pkg_true,pkg_quote,mva,sga,profit}`;衍生 `fmCell()`:total/margin。Toggle bar:Qty/PKG/Show True/Show Margin(後兩僅 host)。Excel 樣式分解列:MVA/Material(Quote)/Material(True)/SG&A+Profit/Total(Quote)/Total(True)/Gross Margin。
→ 平台:矩陣加 **qty scenario 軸**(run cache key 擴 qty_scenario_code;bom_cs_run 需存 scenario)+ cell 展開分解列(run_result 既有欄)+ toggle(true/margin 靠 S2 角色);MVA CN 1.8558/VN 1.4300/TW 3.2070 是 demo 對照值。

### C9. Cleansheet 檢視(#9)
demo:廠 tabs(CN/VN/TW)→ Baseline bar{version, effective_from, dl_wage_hr $4.95, sga_pct, profit_pct, epm, source_xlsx} → Qty scenario 選擇 → KPI 卡(MVA Total/SGA+Profit/SMT MVA/Assy MVA)→ **9 cost component × 9 process 矩陣**:
- components(LABOR/EQUIPMENT/FACILITY/OTHERS):DL_CPU, IDL_CPU, EQUIP_MRO, EQUIP_DEPR, IND_MAT, FACILITY, FREIGHT*, VAT*, LOSS*(*=common only)
- processes(SMT/ASSY/COMMON):SMT_MAIN, WAVE_SOLDER, ROUTER_OFFLINE, LASER_ETCH, BB_ASSY, BB_TEST, MAT_MGMT, Q_SMT, Q_BB
- Step trace(逐步展開計算)· Roll-up:MVA→SG&A(sga_pct×motherboard)→Profit(profit_pct×(MVA+motherboard))→TC/unit
→ 平台:資料全在(baseline/case_process/IDL/equipment/facility/consumable + engine)→ 純檢視 UI;engine 有無 per-process×component 分解輸出要查(bomCostEngine run cells?bom_cs_run 有 cells 表),沒有就 engine 補分解 dump。

### C10. MVA 操作流程(#10)
demo:`MVA_PHASES` 7 phase(A 公司/廠級一次性建置 · B 月度 Baseline 維護 · C 新案開立 · D 案級配置 · E Compute · F BOM Lock Propagate · G 報價+Margin)。`phase={code,title,timing,main_owner,summary,prereq[{kind:doc|data|policy|config|permission,name,detail}],steps[{num,name,who,sys,detail,mins}],delta_steelseries,delta_whoop,schemas[]}`。33=prereq 總數(A6+B3+C5+D6+E4+F5+G4);步驟 52。每 phase 4 panel:素材/步驟/兩案差異/影響 DB 表。有 PPTX 手冊下載。
→ 平台:靜態教學段(內容平台化改寫:我們的 檔案匯入/範本庫/開案/配置/compute/定版/報價 流程)+ 手冊連結。

### C11. Margin Analysis(#11)
demo:讀 FM_FULL 24 cells;KPI(Max/Min/Avg margin% + Avg $)+ **margin heatmap**(4 scenario(qty×pkg)× 6 cell(廠×variant),margin_pct 上色)+ **Top Markup Items per PKG**(top5);公式 `margin_pct=((mat_quote+pkg_quote)−(mat_true+pkg_true))/total_quote`。權限:VIEW_TRUE_COST。
→ 平台:讀矩陣 run cache(#8 擴 qty 後同 key 空間);Top Markup 從 items tier markup 排序;整段 S2 gate(非全視角整段鎖)。

### C12. 成本核算(#12)
demo 摘要:6-cell heatmap(3 廠×2 variant total)+ 材料(加權)/MVA per 廠/SGA+Profit + 推薦組合/建議售價(草)/毛利率/年營收。平台已有多廠彙總+定版+議價+AI 比對 → 補:建議售價草(form.cost_meta.sale_price_draft)+ 年營收卡(×年量)。

### C13. 議價策略(#13)
10 欄:min_margin(底線毛利率 ✓req)/round_no(computed=議價輪次,平台已自動)/compete_price(競品價 ✓req)/cust_room(議價空間 textarea·ai)/past_discount(過往折讓 ai)/strategy_note(筆記 ai)/win_prob(贏單機率 select)/fallback(最低可接受價)/qty_discount(量價條件)/special_terms(特殊條件)。demo 有「AI Bot 填空」showcase。
→ 平台:欄位存 form.strategy(✅ 完成度已接);UI 編輯卡 + AI 輔助填(吃專案脈絡:議價紀錄/成本/AI 比對 → Pro 建議草稿);S2:非全視角遮+403(✅ server 已擋)。

## D. 跨段連動(demo 公式 · 平台對應)

- 共用 toggle `v07State{qty,pkg,show_true_cost,show_margin}` ← packaging/matrix/cleansheet/margin 四段共用 → 平台:#8 做 toggle state(component 內或 context)
- Cleansheet → cost/matrix/margin:MVA per 廠(CN 1.8558/VN 1.4300/TW 3.2070)→ 平台 engine 已天然串
- BOM lock → propagate 24 cells → 平台 = 定版 + 矩陣快取
- SG&A = sga_pct × motherboard;Profit = profit_pct × (MVA+motherboard);TC = Material+MVA+SGA+Profit → 平台 engine 等價(SIMPLIFIED/FULL 各異)
- NRE 攤提 = totalNeg/qty(demo 不進 unit cost 僅附註;平台 AMORTIZED 有進 → 保持平台行為)
