# Cortex 成本模型通用匯入 — 規劃(C 系列)

> 狀態:**已拍板待實作**(2026-07-23)。BOM 架構(R/B 系列)完成後開工。
> 前提文件:[cortex-bom-source-excel-structure.md](cortex-bom-source-excel-structure.md)(SOT)、[cortex-bom-import-plan.md](cortex-bom-import-plan.md)。

## 1. 問題

成本模型(case_factory / baseline:廠別+製程+設備+人力+廠房參數)目前只能從 **fixture 假專案(CORTEX-FIX-\*)clone** —— demo 機制冒充範本庫,無正式維護管道。BOM 已有統一格式匯入,成本資料也要同等機制。

## 2. 資料本質:兩層

| 層 | 內容 | 表 | 誰維護 | 頻率 |
|---|---|---|---|---|
| **廠別標準(廠級)** | baseline(DL 時薪/OH%/SGA%/Profit%)· IDL 角色薪資 · SMT 點數費率 · 耗材價目 | `bom_factory_baseline` · `bom_factory_idl_role` · `bom_factory_idl_linedep_wage` · `bom_factory_smt_point_rule` · `bom_factory_consumable` | EPM/成本中心 | 低(季/年) |
| **案級調整** | 製程(UPH/TAKT/yield/線人力)· 設備/廠房分攤 · SIMPLIFIED line · 數量情境 | `bom_cs_case_process` · `bom_cs_case_idl_alloc` · `bom_cs_case_equip_area` · `bom_cs_case_facility` · `bom_cs_case_consumable` · `bom_cs_case_simplified_line` · `bom_cs_case_smt_point` · `bom_cs_case_macro_process` · `bom_cs_case_qty_scenario` | 專案 EPM | 每案 |

## 3. 統一格式:成本模型 Excel(單一 workbook 多分頁)【拍板 2】

固定分頁名 + header-based(同 BOM canonical 精神);缺頁/缺欄 → 硬擋列缺項。

```
[Baseline]       廠別 | costing_model | DL薪資(見§5口徑) | OH% | SGA% | Profit% | Transport | 週工作天 | 日工時
[Process]        製程碼 | 名稱 | UPH | TAKT | Yield | DL人數 | 週產出            (FULL 必要)
[IDL]            角色 | 薪資(口徑同§5) | 分攤方式
[Equipment]      設備 | 單價 | 年限 | 稼動率                                     (FULL 必要)
[Facility]       廠房項 | 分攤                                                  (FULL 必要)
[Consumable]     耗材 | 單價
[SimplifiedLine] line_code | 群組(MATERIAL|PROCESS|LOSS) | cost_per_unit_usd    (SIMPLIFIED 必要)
[QtyScenario]    情境 | 年量
```

- `costing_model` 決定必要分頁:**SIMPLIFIED = Baseline + SimplifiedLine + QtyScenario**;FULL 全套
- 提供「下載成本模型範本」(含說明頁);**匯出現有模型 = 同格式**(round-trip:下載→改→匯回)

## 4. 匯入去向(兩用)

- **(a) 建/更新「廠別範本」**(範本庫 → 專案開案 clone)← 主線
- **(b) 直接匯進某專案 case_factory**(特殊案整套 override)

**範本庫載體【拍板 1 = (i)】**:建**系統保留「範本專案」**(不出現在一般專案列表;case_factory 掛此專案 = 範本)。現有 fixture(CORTEX-FIX-\*)轉入/正名,provision templates 列表改讀範本專案。

## 5. 數字口徑【拍板 4 + 薪資修訂】

- **% 欄用整數**:`4` = 4%(匯入驗證範圍,如 OH% 0–50)
- **薪資 = 月薪 → 時薪/日薪換算**(CN/VN 實務都是月薪再轉):
  - 格式收:`月薪(當地幣)` + `匯率` + `週工作天` + `日工時`(Baseline 提供廠別預設,IDL 列可覆寫)
  - 也可直接填 `時薪(USD)`(有值優先,略過換算)
  - 匯入服務換算到引擎原生單位:`時薪 USD = 月薪/匯率 ÷ (月工作天×日工時)`;引擎的週薪欄(`weekly_wage_usd`)= 時薪 × 日工時 × 週工作天
  - 範本說明頁寫死公式;**引擎不改**(仍吃 `dl_wage_per_hr_usd` / `weekly_wage_usd`),換算在匯入層

## 6. UI 動線

- 專案內「尚未設定成本模型」區:現有「選範本建立」+ 新增「**上傳成本模型 Excel**」
- 新頁「**廠別成本範本庫**」(admin/EPM):列表(CN/VN/TW × FULL/SIMPLIFIED)· 下載空白範本 · 上傳建立/更新 · 檢視參數 · 匯出

## 7. 切片【拍板 3:C-1 先】

| 片 | 內容 |
|---|---|
| **C-1** | 格式定義 + 下載範本 + `importCostModel`(直匯專案 b 路徑)+ 匯出 round-trip |
| **C-2** | 範本庫轉正式(範本專案 + fixture 除名)+ 匯入到範本庫(a 路徑) |
| **C-3** | 版本化(生效日/歷史)+ 權限(EPM 角色)|

## 8. 依賴/順序

BOM 架構(R 系列 + B-3d 多廠矩陣)完成後開工。屆時多廠矩陣的「國別軸」直接吃範本庫的廠別模型。
