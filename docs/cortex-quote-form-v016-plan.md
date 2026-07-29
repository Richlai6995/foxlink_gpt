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
| 0 | **基礎設施** | form 欄位 GET/PUT API(data_payload.form)+ 完成度計算 service + sidebar 完成度徽章 | ⬜ |
| 1 | 客戶資料 | 8 欄可編輯(客戶名稱/別名/統編/ERP 代號/PO 號/付款條件/收貨地址/採購窗口) | ⬜ |
| 2 | 🎬 操作流程 | 26 步 checklist(Stage 4–7)+ action 跳轉 + 自動完成判定 + **附圖上傳** | ⬜ |
| 3 | CMF 變體 | 變異值 share%/qty + 加權平均料成本(接現有變異軸) | ⬜ |
| 4 | BOM 結構(案級欄) | ECN 版本/BOM lock 狀態/客供料(有無+明細)/採購策略總覽視圖(樹已有) | ⬜ |
| 5 | 包裝 BOM | per-item true/quote/markup 視圖 + Pallet Compliance 欄(商包/工包=包裝變異值,已有) | ⬜ |
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
