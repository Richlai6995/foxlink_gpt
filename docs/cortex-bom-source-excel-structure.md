# Cortex BOM — 來源 Excel 架構解剖(SOT)

> **用途**:WHOOP / Rival3 兩份真實報價 Excel 的結構權威紀錄。**所有 BOM 相關規劃(變異維度、成本模型、匯入 profile、config 選擇、多廠對比)都以本文件為前提,不再重複解釋。**
>
> 來源檔(`docs/`,唯讀):
> - `WHOOP_Gen4 MP quotation book_ for AI.xlsx` — 穿戴裝置(SIMPLIFIED_WEARABLE)
> - `Rival 3 Gen2 uni bom_112624_v1_Internal_Troy_Amber rev2.xlsx` — 滑鼠(FULL_MVA)
>
> Golden:WHOOP TTL **89.5537** USD;Rival3 CN Total **Black 11.123 / White 11.338** USD。

---

## 0. 一句話總結

兩份 Excel 本質都是 **configurable BOM(150% 超級 BOM)**:核心料共用、變異料按維度分開;一張報價表 = 「結構 config(顏色 × 包裝)」 ×「加工廠別(CN/VN/TW)」的成本矩陣。這直接對應 Cortex 的 **super-BOM + 逐料 effectivity** 架構。

---

## 1. WHOOP_Gen4(SIMPLIFIED_WEARABLE)

### 1.1 分頁清單(依角色分組)

| 角色 | 分頁 |
|---|---|
| 成本主表 | **Summary**(← 唯一 oracle)、History |
| 製程/工時 | FATP、SMA+ BFT、SMT cost |
| **模組 BOM(板)** | Harvard Sensor (G/DVT)、Harvard MainBoard (F3)、Bird Main Board (J4/EVT)、Bird NFC、Harvard Assembly、Bird Assembly |
| **模組 BOM(件)** | STRAP、BATTERY_PACK |
| **包裝 BOM** | Retail、White Box+Black Box Suit、White Box Strap、White Box Battery Pack、White Box Strap+Battery Pack Box |
| 耗材 | cosumable |

### 1.2 成本模型(Summary 分頁 = configurable BOM 本體)

Summary 每列 = 一個成本元素,**欄 = 包裝方式**;材料/製程列的格值 = **用量倍率**(0/1 選料 · yield 差異如 0.05/1.7),加成列(OH/SGA/Profit)的格值 = **金額**(= 該欄 subtotal × 共用 %):

```
NO BOM        Category                cost      Retail  WhiteBoxSuit ...
1  EE         Harvard SensorBoard     9.754      —       —
2             Harvard Main Board      19.820
3             Bird Main Board         15.786
4             Bird NFC Flex            1.570
5             Harvard Assembly         7.840
6             Bird Assembly            5.060
7  ME         STRAP                    8.273      0       0     ← 該包裝不含 strap
8             Battery Pack             1.624      1       1
9  Consumable For SMT&ATE&FATP         1.140
10 Package    Retail                   3.000      1       —     ← 選 Retail 包裝
             White Box+Black Box Suit             —       1     ← 選 Suit 包裝
             White Box Strap / Battery / Strap+Battery …
11 Process    SMT                      1.773625
12             Board glue+ATE          0.373622
13             FATP                     1.603100
14             SMT Yield loss           0.226799
15             FATP Yield Loss(4%)      3.113774
   subtotal                           80.95792
16 加工加成    Over-head                3.238325   1       2.72  ← 金額!= 各欄 subtotal×4%(2026-08-10 更正:非乘數)
17             SG&A                     2.428744   1       2.04
18             Profit                   2.428744   1       2.04
19             Transportation           0.500000
   TTL US$                            89.553732   71      74.8
```

**要點**
- **材料 = Σ 模組(EE 板×6 + ME:STRAP/Battery + 耗材)+ Package + Process**。
- **5 種包裝方式**用乘數欄選料:`Retail / WhiteBox-Suit / WhiteBox-Strap / WhiteBox-Battery / WhiteBox-Strap+Battery`。STRAP/Battery 是否計入、選哪個 Package 列,由該欄 0/1 決定。
- **OH/SGA/Profit = 各 config 自己的 subtotal × 共用 %(4%/3%/3%)** — 2026-08-10 更正:Suit 欄 2.72/2.04 是金額(=68×4%/68×3%,公式 `=G23*K24`),**不是乘數**;成本隨 config 是因為 subtotal 隨 config(材料選料 + 製程線用量倍率),加成公式全 config 共用。真正 per-config 的結構 = 材料/製程「line × config 用量倍率」(row 14~22,例 Battery:Board glue+ATE=0 / SMT Yield=0.05 / FATP Yield=1.7)→ 系統實作 `bom_cs_case_line_config`(013z)。
- 加成基準:OH 4% / SGA 3% / Profit 3%(對 subtotal),Transport 固定 0.5。
- **顏色**:WHOOP 單色(無顏色維度)。

### 1.3 模組 → 半成品對應(匯入用)

`Harvard Sensor / Harvard MainBoard / Bird MainBoard / Bird NFC / Harvard Assembly / Bird Assembly`(全 EE 板)、`STRAP / Battery Pack`(ME 件)、`Retail…`(PKG)。板內料表 header:`Item No / Description / Foxlink P/N / Qty / Unit Price`。

---

## 2. Rival3 Gen2(FULL_MVA)

### 2.1 分頁清單(依角色分組)

| 角色 | 分頁 |
|---|---|
| 成本主表 | **Unit Cost**(← 成本矩陣)、Build Cost |
| **EE(共用)** | **EE bom 0227**(唯一一份) |
| **ME(分色)** | **ME bom 0618_Black / _White**、ME bom 0229_Black / _White(舊版)、ME BOM 0228_draft |
| **PKG(分版/區域/環保)** | PKG BOM 20241119-**TW** / 20241023_**Amber** / 20240731_**FSC&減塑** / 20240618_FSC減塑 / 20240308_FSC / 20240223 |
| NRE/其他 | NRE Summary、MTE NRE、RET(option1/2)、PKG RET、ORT、Dev+NPI Labor… |

### 2.2 模組即變異軸(鐵證)

- **EE = 一份共用**(`EE bom 0227`),但 Unit Cost 顯 `EE(Black) 6.017 ≠ EE(White) 6.089` → **有少數色相關 EE 料** → 必須**料層 effectivity**(半成品層擋不住)。
- **ME = 分色**(`_Black` / `_White` 兩分頁);ME 分頁本身還有 `Color` 欄。housing/plastic assy,ABS 材質。
- **PKG = 分版/區域/環保**(TW / Amber / FSC&減塑 …)。

### 2.3 成本矩陣(Unit Cost 分頁)

**欄 = 廠別 × 包裝選項**,列 = 逐模組相加後分色出總:

```
                    Made In China      Made In Vietnam   Made in Taiwan
                    Option A           Option B          Option C
EE (Black)          6.0174             6.2467            6.0174
EE (White)          6.0889             6.3209            6.0889
ME (Black)          1.6713             1.7350            1.6713
ME (White)          1.8152             1.8844            1.8152
Packaging           0.8281             0.9442            0.9442
─────
Black Material = EE(B)+ME(B)+PKG   8.5168  8.9258  8.6329
White Material = EE(W)+ME(W)+PKG   8.7322  9.1494  8.8483
MVA                                1.8558  1.4300  3.2070   ← 廠別不同
PRIME (Black) = Matl+MVA          10.3726 …
SG&A+Profit(固定)                  0.7500
Total (Black)                     11.1226 11.1058 12.5899
Total (White)                     11.3380 11.3294 12.7503
```

**要點**
- **料 = EE + ME + Packaging**(逐模組相加),**分色各出一條 Material / Total**。
- **MVA 隨廠別**(CN 1.856 / VN 1.430 / TW 3.207)→ 廠別 = 加工成本模型軸。
- 欄本身就是 **config(顏色隱含雙列)× 包裝(Option)× 廠別(Made In)** 的成本矩陣。
- 模組料表 header:EE=`Item/Qty/FLK P/N/Type/Description/Vendor/Part number`;ME=`Item/Component Type/System/Part Description/Foxlink P/N/Qty/Material/Color`;PKG=`No./Level/Foxlink P/N/Description/Unit Q'ty/Unit Price/Amount`。

---

## 3. 綜合模型 → Cortex 對應

### 3.1 三條正交軸

| 軸 | 內容 | 來源證據 | Cortex 落點 |
|---|---|---|---|
| **結構 config** | 顏色 × 包裝方式 | Rival3 Black/White + 6 PKG;WHOOP 5 包裝 | super-BOM + `bom_item_effectivity` |
| **加工廠別** | CN / VN / TW | Rival3 Made-In 欄;MVA 隨廠變 | `bom_cs_case_factory`(現有) |
| **數量情境** | 年需求/級距 | Quote Based Quantity | `qty_scenario`(現有) |

報價 = 三軸交叉:`config(顏色×包裝) × 廠別 × 數量` → 每格一個 total。

### 3.2 EE 共用 / ME・PKG 分開 = effectivity 自然結果

匯入時 profile 依**來源分頁**打 tag:

```
EE bom          → EE 半成品,料不 tag(共用,恆含,詢價一次)
ME bom_Black    → ME 半成品,全料 tag 顏色=Black
ME bom_White    → 全料 tag 顏色=White
PKG BOM_Retail  → PKG 半成品,全料 tag 包裝=Retail
（少數色相關 EE 料 → 個別補 tag 顏色）
```

`resolve(顏色=Black, 包裝=Retail)` = 共用EE ∪ ME-Black ∪ PKG-Retail → rollup byCategory(EE/ME/PKG)分模組呈現。**EE 段每 config 相同 = 共用驗證。**

### 3.3 成本模型差異

| | WHOOP | Rival3 |
|---|---|---|
| costing_model | SIMPLIFIED_WEARABLE | FULL_MVA |
| 材料 | Σ模組 + 耗材 + Package + Process | EE+ME+PKG |
| 加工 | OH4%+SGA3%+Profit3%+Transport(% 全 config 共用;subtotal 隨 config) | MVA(隨廠)+ SG&A&Profit 固定 |
| 顏色 | 無 | Black/White |
| 包裝 | 5 種 | 6 版(TW/Amber/FSC…) |

---

## 4. 規劃引用(planning implications)

1. **變異 = 料層 effectivity**(不是整份複製):EE 有色差 → 半成品層不夠,必料層。
2. **匯入 = 從模組分頁組 super-BOM**:profile 每分頁帶 `{module, effectivity:{dim:value}}`。
3. **成本呈現分模組**:沿用 rollup `byCategory`(EE/ME/PKG)。
4. **製程/loss line 可吃 config 用量倍率**(WHOOP row 14~22;Battery glue=0/yield 0.05/1.7)→ 013z `bom_cs_case_line_config` 已實作(2026-08-10);加成 % 全 config 共用不加權(2.72 是金額的誤讀已更正)。
5. **對比矩陣**:「多廠對比」要一般化成 **config × 廠別**(對齊 Rival3 Unit Cost 那張表)。
6. Golden 回歸基準:WHOOP 89.5537、Rival3 CN Black 11.123 / White 11.338。

> 相關實作文件:[cortex-bom-import-plan.md](cortex-bom-import-plan.md)(匯入/成本引擎)、[cortex-whoop-e2e-plan.md](cortex-whoop-e2e-plan.md)(端到端驗證)。變異架構(B super-BOM)實作進度見 import-plan 的 §B。
