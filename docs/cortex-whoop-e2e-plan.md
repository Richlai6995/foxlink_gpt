# Cortex — WHOOP Gen4 端到端驗證 + v0.12 對標 計畫(SOT)

> **目標**:拿真實專案 `WHOOP_Gen4 MP quotation book_ for AI.xlsx` 從**開新專案**走完整報價流程
> (開案 → BOM → 採購詢價 → 成本試算 → 定版),驗證系統,並對標 `Cortex_互動Demo_v0.12.html`
> 逐步補完原先規劃的流程。
> **日期**:2026-07-17 規劃 · **狀態:2026-08-07 盤點 — W0~W4 全部完成,本計畫歸檔**
>
> **完成佐證**(2026-08-07 DB 實查):
> - **W0** Sample = `tmp/cortex-demo/whoop-bom-demo.xlsx`(292 列 · 8 板+5 包裝 · 4 筆留空給採購)+ `whoop-cost-model-SIMPLIFIED.xlsx`(VN · NRE 隨檔)
> - **W1** ① 多板 import:canonical v2 每分頁/半成品一 section(§3.1 已被 7423b12 canonical 匯入解決)② SIMPLIFIED 材料 line BOM rollup 動態:`bomCostEngine.computeSimplifiedMva` W1b(`ctx.bomMaterial` 非 null → 材料走 rollup,常數 MATERIAL line 跳過;PROCESS/LOSS 仍用 line)
> - **W3** 端到端案 `CORTEX-W3-WHOOP`(5 包裝 config 各自 run · 假價校準版)+ demo 匯入案 `Q-2026-1245`;範本 cf87 **TTL = 89.554 = golden 精確**
> - **W4+** gap 全清(P1 + Wizard 7→5 步改版)— 見 [cortex-roadmap.md](cortex-roadmap.md)
> - **未做 → 移 roadmap P3**:B-4 OH/SGA/Profit per-config 加權(SOT §1.2 Suit ×2.72/×2.04)→ 5 pack 變體 TTL golden(71/74.8/73.7/73.425/74.8)尚未逐 config 對驗,是 B-4 的驗收基準

---

## 0. ⚠️ 重要前提:單價保密 → 用模擬假單價

- **提供單位為保密,已把單價從 Excel 拿掉**:EE 板明細(Harvard Sensor / MainBoard、Bird MainBoard / NFC)有 `cost` 欄但**空**(板 total $0.000)、ME(STRAP / BATTERY_PACK)**無單價欄**;PKG(Retail / White Box)保留單價。
- 因此本計畫的 Sample 一律用**模擬的、有變化且合理的假單價**(非真實採購價)。
- **假價校準原則**:每個板/類別的 Σ(qty × 假單價)**校準到 Summary 板級總額**(如 Harvard Sensor 9.754、Harvard Main 19.82…),讓 rollup ≈ golden;同時**逐元件單價有合理變化**(電阻 $0.001~0.01、IC $0.5~3、連接器 $0.1~1…)。
- **目的**:驗**流程**(RD 無價匯入 → 採購補價 → rollup → 成本 → 定版),不是驗真實成本數字。真實成本另由業主提供時再替換。

---

## 1. WHOOP Excel 資料分析

`WHOOP_Gen4 MP quotation book_ for AI.xlsx` — **23 sheets** · 成本模型 = **SIMPLIFIED_WEARABLE**(已逆向,golden `TTL 89.554`)。

### 1.1 Sheet 分類

| 類 | sheets | 用途 |
|---|---|---|
| **BOM · EE 板** | Harvard Sensor (G / DVT E / DVT F)、Harvard MainBoard (F3)、Bird Main Board (J4 / EVT-DOE K)、Bird NFC | 各板料號/QTY/MFG/Designator/MOQ/LT(**單價空**)|
| **BOM · 組裝** | Harvard Assembly、Bird Assembly | 板組裝 BOM |
| **BOM · ME** | STRAP、BATTERY_PACK | 機構件(**無價欄**)|
| **BOM · PKG** | Retail、White Box+Black Box Suit、White Box Strap / Battery / Strap+Battery | 5 種 pack 變體(**有單價 + supplier**)|
| **製程 / MVA** | FATP、SMA+ BFT、SMT cost | UPH / DL / yield / SMT 報價(MVA 來源)|
| **彙總** | Summary | golden roll-up(見下)|
| 其他 | History(版本)、cosumable(耗材)、工作表2(空)|

### 1.2 Summary(golden 彙總)

Summary 每列 = 預先 rollup 的板級/製程成本;col 3 = Retail pack 單價,col 4-8 = 5 種 pack 變體用量/倍率。

| 段 | 項目(值 · Retail)| 來源 |
|---|---|---|
| **材料 line** | Harvard Sensor **9.754** / Harvard Main **19.82** / Bird Main **15.786** / Bird NFC **1.57** / Harvard Assy **7.84** / Bird Assy **5.06** / STRAP **8.273** / Battery Pack **1.624** / Consumable **1.14** / PKG(Retail **3**)| **detail BOM rollup** |
| **製程 line** | SMT **1.774** / Board glue+ATE **0.374** / FATP **1.603** / SMT yield loss **0.227** / FATP yield loss **3.114** | Cleansheet(FATP / SMT cost / SMA+BFT)|
| **subtotal** | **80.958** | Σ 材料 + 製程 |
| 加成 | Over-head **3.238**(4%)+ SG&A **2.429**(3%)+ Profit **2.429**(3%)+ Transportation **0.500** | % of subtotal |
| **TTL US$** | **89.554**(Retail)· 71 / 74.8 / 73.7 / 73.425 / 74.8(5 變體)| |
| BOM cost rate | 82% | |

> 對齊既有 `seedWhoopVn` 的 15 條 `bom_cs_case_simplified_line`(目前是常數 seed;W1 改成材料 line 由 BOM rollup 動態算)。

### 1.3 價格狀態(天然兩階段)

| BOM 類 | 有的欄 | 單價 |
|---|---|---|
| EE 板 | Item / Foxlink P/N / Whoop P/N / Description / QTY / Designator / MFG / MOQ / MPQ / L/T | **cost 欄空** → 採購填 |
| ME | No / Description / FLK PN / Q'ty / Material / Vender / MOQ / L/T | **無價欄** → 採購填 |
| PKG | Item / WPN / Item Number / Description / QTY / 品名 / cost $ / Ext.cost / supplier | **有價**(部分標「單價待廠商更新」)|

→ 這份「for AI」Excel **天然就是兩階段狀態**(RD 有結構、採購待填價),完美對應 B-5a/b 兩階段流程。

---

## 2. 角色拆分(RACI · 這個專案誰做什麼)

| 角色 | WHOOP 專案的工作 | 對應系統 |
|---|---|---|
| **業務 / PM** | 開案、客戶(WHOOP)、年量、報價交付 | 開案 + 客戶資料 section |
| **RD / 工程** | 匯入各板 BOM 結構(料號 / QTY / MFG / Designator)、變體(5 pack)、製程參數 | 📦 BOM 匯入(B-5a 無價)|
| **採購** | 對 EE / ME 無價元件逐料詢價填單價 / vendor、多家比價選定 | 📦 BOM 採購 enrich(B-5b · 已有)|
| **MPM / 成本** | Cleansheet MVA(SMT / FATP / yield)、成本試算 | 📊 成本核算(§9.3)|
| **DPM / 主管** | 定版核准(≠ 送審者)、機密揭露 | 定版 / 送審(SoD · 已有)|

---

## 3. 兩個關鍵架構改動(接 WHOOP 必須)

### 3.1 BOM 匯入支援「多板 / 多 section」
WHOOP 不是 EE/ME/PKG 三分頁,是**多片板各一 sheet**。import 要:每片板 = 一個 `bom_section`(module_code = 板名,module_category = EE/ME/PKG),category 下掛元件。現有 `importBomTemplate` 只吃固定 EE/ME/PKG 三分頁 → 要擴成「N 個 section,每 section 標 category」。

### 3.2 SIMPLIFIED 材料 line 從 BOM rollup 動態算(核心)
現況:`computeSimplifiedMva` 讀 `bom_cs_case_simplified_line`(常數 seed),BOM 沒接進來。
改法:
- **材料 line**(板 / ME / PKG / consumable)→ 由 **BOM import + 採購詢價 rollup** 動態產(每板/類別一條)。
- **製程 line**(SMT / FATP / yield)→ 仍由 case / Cleansheet 設定(`simplified_line` 標 `line_type='process'`)。
- subtotal = Σ(材料 rollup)+ Σ(製程 line)→ OH + SG&A + Profit + Transport。
→ 這樣**採購對元件詢價 → 板 rollup → 材料 line → Summary → 89.554**,兩階段才真的貫穿 SIMPLIFIED(目前只有 FULL_MVA 貫穿)。

---

## 4. vs `Cortex_互動Demo_v0.12.html` 差距

demo = 完整 RFQ 平台(開案 7 步 wizard → 8-stage RFQ + Stage Gate owner/SLA → BOM Collect → Cleansheet 9×9 → 採購詢價策略 → NRE → 多廠成本🔒 → 議價 → 報價 PDF → AI 比對上代)。

| v0.12 功能 | 我們現況 |
|---|---|
| 開案 7 步 wizard | ❌ 手動建案 |
| 8-stage RFQ + Stage Gate(owner / SLA)| ❌ |
| BOM Collect(匯入 / 鎖定 / propagate)| 🟡 有匯入,無鎖定 propagate |
| Cleansheet xlsx 拖拉匯入 9×9 | ❌ MVA 靠 seed / clone |
| 採購詢價策略(sourcing_strategy / KB 樣板)| 🟡 有手動 enrich |
| CMF / 變體配置 | 🟡 有 variant_key,無 UI |
| 多廠成本 🔒 遮罩 | 🟡 有多廠,無遮罩(= S2)|
| 議價 negotiation | ❌ |
| 報價 PDF 輸出 | ❌ |
| AI 比對上代 BOM | ❌ |
| NRE / 定版 / 送審(SoD)| ✅ 已有 |
| 多廠成本試算 / 材料 rollup / 兩階段價 | ✅ 已有 |

---

## 5. 執行計畫(分階段)

| 階段 | 內容 | 驗收 |
|---|---|---|
| **W0** 資料準備 | 從真 Excel 抽 WHOOP 多板 BOM 結構(無價)+ PKG(有價)+ 製程/Summary golden → 產出可匯入 Sample;**生成校準到板級的假單價**(§0)| Sample 檔可上傳 · 板 rollup ≈ Summary · golden 定 89.554 |
| **W1** 核心接通 | ① BOM import 多板/多 section ② SIMPLIFIED 材料 line 從 rollup 動態算(§3)| 兩階段貫穿 SIMPLIFIED · 對 golden 89.554 ε<0.5 |
| **W2** 角色化 + 開案 | 最小開案流程(建案 + 選 SIMPLIFIED 範本 + 自動建 case_factory)+ Form section 綁角色 | 業務可開案 → RD/採購/MPM/DPM 各自進 section |
| **W3** 跑 WHOOP 端到端 | 新專案 → RD 匯多板(無價)→ 採購填價 → 板 rollup → SIMPLIFIED 算 → NRE → 定版,對 golden 驗 | 端到端一遍過 · TTL ≈ 89.554 |
| **W4+** 補 v0.12 gap | Stage Gate 8 階段 + owner/SLA · Cleansheet xlsx 匯入 · 採購策略 · CMF 變體 · 機密遮罩(S2)· 議價 · 報價 PDF · AI 比對上代 | 逐項對 demo |

**建議先做 W0 + W1**(資料 + 核心接通)= 讓 WHOOP 真能跑兩階段 SIMPLIFIED 的地基;其餘是外層流程殼,可後補。

---

## 6. golden 目標值(驗收基準)

- **TTL US$ = 89.554**(Retail pack)· subtotal 80.958 · OH 3.238 / SG&A 2.429 / Profit 2.429 / Transport 0.5
- 材料板級:Harvard Sensor 9.754 / Harvard Main 19.82 / Bird Main 15.786 / NFC 1.57 / Harvard Assy 7.84 / Bird Assy 5.06 / STRAP 8.273 / Battery 1.624 / Consumable 1.14
- 製程:SMT 1.774 / Board glue+ATE 0.374 / FATP 1.603 / SMT yield 0.227 / FATP yield 3.114
- 5 pack 變體 TTL:71 / 74.8 / 73.7 / 73.425 / 74.8

---

## 附:檔案 / 對應

- 真 Excel:`docs/WHOOP_Gen4 MP quotation book_ for AI.xlsx`(23 sheets)
- demo 對標:`docs/Cortex_互動Demo_v0.12.html`(18921 行 · 完整 RFQ 流程)
- 既有 WHOOP fixture:`server/projects-platform/scripts/seed-cleansheet-fixtures.js` `seedWhoopVn`(專案 101 · SIMPLIFIED · 15 line 常數 → W1 改動態)
- 引擎:`bomCostEngine.js` `computeSimplifiedMva`(W1 接 BOM rollup)
- 既有 golden:`tmp/whoop_golden.json`
- 相關計畫:`docs/cortex-bom-import-plan.md`(BOM 匯入/兩階段/多廠/NRE/定版 已完成部分)
