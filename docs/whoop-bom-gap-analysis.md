# WHOOP Gen4 BOM 結構分析 + Cortex v0.7 支援度評估

> **日期**:2026-06-11
> **來源檔案**:`docs/WHOOP_Gen4 MP quotation book_ for AI.xlsx`(23 sheets · 2.2MB)
> **對齊**:`Cortex_互動Demo_v0.7.html` + `bom-collection-sd v0.4` + `cleansheet-mva-sd v0.3`

## 一、WHOOP 結構摘要

跟 SteelSeries Rival 3+ 比,WHOOP 是**完全不同等級**的複雜度:

| 維度 | SteelSeries Rival 3+ (滑鼠) | WHOOP Gen4 (穿戴手環) |
|---|---|---|
| 產品類型 | Single Unit | **多子組件穿戴設備** |
| BOM 數 | 1 份 BOM 階層樹 | **8 個 Sub-BOM** 各自獨立 |
| Variant | 2 (Black/White) | 0 (單 SKU 顏色) |
| PKG 版本 | 2 (商包/工包) | **5 個 Channel SKU** 配不同子組件 |
| 製程 | 9 個 (MOUSE_STD) | **30+ FATP stations** + SMT cost 分 PCBA |
| Yield loss | 廠級 1 個 (0.08%) | **分製程**(SMT 0.2~0.5% / FATP 5~7%) |
| 客供料 | 局部(Apple 磁鐵) | **大規模**(EE / cable / metal 全客供) |
| 雙價 | True + Quote | **跨案合約價**(Whoop contract price)|
| BOM 版本歷史 | v1, v2, v3 議價輪 | **60+ Rev 變更**(從 v1.0 → v2.25) |

## 二、WHOOP Summary 主表結構

Excel `Summary` sheet 是核心,5 個 PKG SKU 當欄,子組件當列:

```
                           │ Retail │ White+ │ White  │ White  │ White        │
                           │ pack   │ Black  │ Strap  │ Battery│ Strap+       │
                           │        │ Suit   │        │ Pack   │ Battery Box  │
─────────────────────────────────────────────────────────────────────────────
[EE 子組件]
1. Harvard Sensor Board (G)│  9.754 │  10    │  10    │  10    │  10          │
2. Harvard Main Board (F3) │ 19.82  │  10    │  10    │  10    │  10          │
3. Bird Main Board (J4)    │ 15.786 │  10    │  10    │  10    │  10          │
4. Bird NFC Flex           │  1.57  │  10    │  10    │  10    │  10          │
5. Harvard Assembly        │  7.84  │  10    │  10    │  10    │  10          │
6. Bird Assembly           │  5.06  │  10    │  10    │  10    │  10          │
[ME 子組件]
7. STRAP                   │  8.273 │      0 │      0 │      0 │            0 │  ← 來自 STRAP!K1
8. Battery Pack            │  1.624 │      1 │      0 │      1 │            1 │
[Consumable]
9. For SMT&ATE&FATP        │  1.14  │      1 │      1 │      1 │            1 │
[Package SKU]
10. Retail                 │  3     │      1 │        │        │              │
11. White Box+Black Box    │        │        │      1 │        │              │
12. White Box Strap        │        │        │        │        │              │
13. White Box Battery Pack │        │        │        │      1 │              │
14. White Box Strap+Battery│        │        │        │        │            1 │
[Process Cost]
15. SMT                    │  1.774 │      1 │      1 │      1 │            1 │
16. Board glue+ATE         │  0.374 │      1 │      1 │      0 │            1 │  ← 動態公式
17. FATP                   │  1.603 │      1 │      1 │      1 │            1 │
[Yield Loss]
18. SMT Yield loss         │  0.227 │      1 │      1 │  0.05  │            1 │
19. FATP Yield Loss        │  3.114 │      1 │      1 │  1.7   │            1 │
═════════════════════════════════════════════════════════════════════════════
20. BOM cost subtotal      │ 80.96  │  68    │  67    │ 66.75  │  68          │
21. Over-head (4%)         │  3.24  │  2.72  │  2.68  │  2.67  │  2.72        │
22. SG&A (3%)              │  2.43  │  2.04  │  2.01  │  2.00  │  2.04        │
23. Profit (3%)            │  2.43  │  2.04  │  2.01  │  2.00  │  2.04        │
24. Transportation         │  0.5   │        │        │        │              │
═════════════════════════════════════════════════════════════════════════════
TTL US$                    │ 89.55  │ 71     │ 74.8   │ 73.43  │ 74.8         │
BOM cost rate %            │ 82.5%  │ 88.7%  │ 84.2%  │ 85.8%  │ 84.2%        │
```

注意:**每個 PKG SKU 包含不同的子組件**(不像 SteelSeries 全部都用同款 BOM,只是 PKG 不同)。

- **Retail pack**:全部 9 個子組件都有(整盒完整裝置)
- **White Box Strap**:只裝 STRAP + PKG(替換零件)
- **White Box Battery Pack**:只裝 Battery Pack + PKG(替換電池)
- **White Box Strap+Battery Box**:STRAP + Battery Pack 套裝
- **White Box+Black Box Suit**:替換套裝(含 strap + battery + cable × 2)

---

## 三、Cortex v0.7 支援度評估 · 19 欄位/結構對比

### A. ✅ 完全支援(11 項)

| # | WHOOP 結構 | Cortex v0.7 對應 |
|---|---|---|
| A1 | 子料階層 (item → mfg → snapshot) | `bom_item` / `bom_item_mfg` / `bom_item_price_snapshot` |
| A2 | Foxlink P/N | `bom_item.erp_item_id` |
| A3 | Vendor / Supplier | `bom_item_mfg.vendor_name` |
| A4 | MOQ | `bom_item_price_tier.moq` |
| A5 | LT (lead_time_weeks) | `bom_item_price_tier.lead_time_days` |
| A6 | Description | `bom_item.description` |
| A7 | QTY (per unit usage) | `bom_item.qty_per_unit` |
| A8 | Designator (R1, R2 ...) | `bom_item.placement_designator` |
| A9 | Material (PC+PBT 等) | `bom_item.material_spec` |
| A10 | BOM 版本歷史 | `bom_cs_run.status='archived'` 軟刪 |
| A11 | Variant scope | shared (WHOOP 用不到) |

### B. ⚠️ 部分支援(需擴充 5 項)

| # | WHOOP 結構 | Cortex v0.7 現況 | 缺口 |
|---|---|---|---|
| B1 | **三套料號**(Foxlink P/N + Whoop P/N + 客供 FLK P/N) | 只有 ERP item_id 1 個 | 加 `customer_pn` `consigned_pn` 兩欄 |
| B2 | **多製程**(FATP 30+ stations) | bom_process_template 支援 N 製程 | 需新建 `WEARABLE_STD` template (30+ 製程) |
| B3 | **客戶指定 vendor** (Whoop consign vendor=Y/N) | 有 `is_consigned`(料件級)但無 vendor 級 | 加 `bom_item_mfg.is_customer_specified` |
| B4 | **多 PKG 版本** (5 個 Channel SKU) | 現支援 N 個 PKG (商包/工包) | 已支援,但要擴成 5 SKU + 配置子組件 |
| B5 | **Material spec** (規格欄位) | `bom_item.description` 半 cover | 加 `material_grade` / `tolerance` 細欄 |

### C. ❌ 完全不支援(需新開發 6 項)

| # | WHOOP 結構 | 為什麼缺 | 建議 schema |
|---|---|---|---|
| **C1** | **Multi-Sub-BOM 結構**(8 個子組件各有獨立 BOM)| 現在是「一案一份 BOM 階層樹」,缺最高層子組件分群 | 新增 `bom_module` 層:`bom_module → bom_section → bom_category → bom_item` |
| **C2** | **PKG SKU × 子組件 包含矩陣** | PKG 跟子組件是分開定義的,沒有「哪 SKU 包含哪些子組件」mapping | `bom_cs_case_pkg_module_include` 表(SKU × Module 多對多)|
| **C3** | **Per-process Yield Loss** | 現在廠 baseline 一個 loss_factor | 改成 JSON `loss_factor_per_process` {SMT:0.005, FATP:0.05, ...} |
| **C4** | **Over-head 獨立成本欄** | 現在只有 SG&A + Profit | baseline 加 `oh_pct` 欄(預設 0)|
| **C5** | **Transportation 獨立成本欄** | 現在 Inbound Freight 在 Cleansheet Common | 加 `outbound_transportation_per_unit_usd` 欄 |
| **C6** | **客戶合約價 / 客供料大規模**(Whoop contract price) | 現在 BOM 假設 Foxlink 採購端決定價格 | 加 `bom_item.pricing_mode = ('foxlink_negotiated','customer_contract','consigned_free')` |

### D. 🟢 完全不需要(SteelSeries 有但 WHOOP 沒有 2 項)

| # | SteelSeries 有 | WHOOP 沒有 |
|---|---|---|
| D1 | Variant(Black/White)| 單色 SKU |
| D2 | Multi-Factory Matrix(3 廠對比)| 只 1 廠(FQ 富強)|

---

## 四、缺口優先級

### 🔴 必補(沒辦法做 WHOOP)

1. **C1 Multi-Sub-BOM 結構** — 不開新層級,WHOOP 案根本進不來
2. **C2 PKG SKU × 子組件 包含矩陣** — Summary 表算不出來
3. **C6 客戶合約價 / 客供料 mode** — 80% WHOOP 料是這狀態

### 🟡 建議補(體驗會掉很多)

4. **B1 三套料號** — Whoop P/N 找不到對應就無法跟客戶對帳
5. **C3 Per-process Yield Loss** — Yield 差會直接撞 cost,單一 loss_factor 偏差大
6. **B3 客戶指定 vendor flag** — Whoop 70% vendor 是指定的

### 🟢 可延後

7. **C4 Over-head 欄**(可暫從 SG&A 算)
8. **C5 Transportation 欄**(可暫加進 cost section)
9. **B2 多製程模板**(WEARABLE_STD 新模板,可開工時做)
10. **B5 Material spec 細欄**

---

## 五、Demo HTML 建議範圍

跟 v0.7 SteelSeries 一樣完整 demo 是不切實際的(WHOOP 22 個操作流程也不一樣 + 多子組件等)。建議做**簡化版 demo**:

| Demo HTML(`Cortex_互動Demo_WHOOP_v1.html`) |
|---|
| 1. **Summary 主表**(對齊 Excel Summary sheet · 互動切 PKG SKU) |
| 2. **Sub-BOM Module Browser**(8 個子組件 tab) |
| 3. **PKG SKU 配置矩陣**(5 SKU × 9 module 包含矩陣)|
| 4. **Cost Summary**(over-head / SG&A / profit / transport 拆解)|
| 5. **Gap Analysis 標記** — 每 section 標 ✅ / ⚠️ / ❌ |

**不做**:
- 操作流程清單(WHOOP 流程跟 SteelSeries 不同,要另設計)
- Cleansheet MVA(30+ 製程結構需新 template,Phase 2)
- Margin Analysis(WHOOP 是 contract price 模型,要另議)
- 三廠矩陣(WHOOP 只 1 廠)

---

## 六、結論

### 直接回答 USER 問題

**Q1:目前所有欄位都可以支援嗎?**

**A**:**11/19 完全支援(58%)**;5 項要小擴充;6 項要新開發。

| 等級 | 數量 | 範圍 |
|---|---|---|
| ✅ 直接支援 | 11 | 子料層、料號、vendor、MOQ、LT、QTY 等基礎結構 |
| ⚠️ 需擴充 | 5 | 多套料號、客戶指定 vendor、material spec、PKG SKU 擴充等 |
| ❌ 需新開發 | 6 | **Multi-Sub-BOM 層、PKG×Module 矩陣、Per-process yield、Over-head 欄、Transportation 欄、客戶合約價 mode** |

**Q2:HTML Demo?**

**A**:見 [`Cortex_互動Demo_WHOOP_v1.html`](Cortex_互動Demo_WHOOP_v1.html)(同步交付),focus 在 WHOOP 特有的 multi-module + 5 SKU 配置 + summary 主表,並在每 section 標支援度。

### 給 USER 的建議

1. **Phase 1 開工前**先補 ❌ 6 項缺口(否則 WHOOP 案進不來)
2. ⚠️ 5 項可放 Phase 2(初期 workaround OK)
3. **完整 demo 跟 v0.7 同等級需另做 v0.8**(WHOOP 操作流程跟 SteelSeries 差異大,要另設計 step list)
4. **建議找 WHOOP 案的 RD / 採購 / EPM 各 1 人面談**,確認真實流程(這 xlsx 只看到結果,看不到中間操作)
