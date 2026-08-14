# BOM 資料收集模組架構報告

> **對象**:業務 / RD / 採購 / DPM / 財務(非技術)
> **版本**:Report v1.0 / 2026-06-01
> **基於 SD**:`docs/bom-collection-sd.md` v0.3 + `docs/factory-matrix-schema-sd.md` v0.1
> **目的**:把 BOM 模組要做什麼、為什麼這樣設計、各角色如何配合、預計交付時程,用業務語言講清楚,讓相關 stakeholder 在 kick-off 前對齊。

---

## 1. 我們在解決什麼問題

### 1.1 今天 RD / 採購 / 財務手上的痛

| 痛點 | 今天做法 | 問題 |
|---|---|---|
| **BOM 結構分散在 Excel** | 每個案各自一份,沒有 ERP 連動 | 同樣的子料,A 案叫「USB-C 連接器」B 案叫「USB Type-C male」,後續分析湊不起來 |
| **同件子料,不同案不同價** | 採購跟廠商喬完寫進 Excel | 沒有版本、沒有有效期、沒人知道這個價是「上個月詢的」還是「半年前的」 |
| **多 variant(黑/白)資料無處放** | 兩份 Excel 各跑一遍 | 共用零件改一次要改兩次,百分百漏改 |
| **多廠成本對照混亂** | 三廠 EPM 各自一個 Cleansheet Excel | 想看「同 PKG 在 CN/VN/TW 的價差」要手抄表格 |
| **NRE 11 項各案重做** | 每個業務每次都從零開 | 沒有「上次相同客戶 NRE 怎麼壓的」歷史對照 |
| **包裝 16 項詢價分散** | 工廠採購跟主案分離 | BPM 看主 BOM 報價,看不到包裝佔比 |
| **業務報價簽核時 BOM 可能已被悄悄改過** | 沒有 lock | DPM 簽完報價後,RD 還可以動,品質風險 |

### 1.2 我們要建的「BOM 收集模組」核心承諾

> **「一份結構化的、跟 ERP 對齊的、版本鎖定的、能跨案重用的 BOM」**

具體做四件事:

1. **層級化 BOM 結構**:子料不只是「一列文字」,有「料件群組 → 子料 → 製造商選項 → 報價快照」四層
2. **跟 ERP 連動**:每個子料盡量對到 ERP `mtl_system_items_b`(料號主檔)+ `mtl_mfg_part_numbers`(製造商料號)+ `po_lines_all`(歷史採購單價)
3. **AI 智能輔助**:RD 填一行「USB-C 連接器」,系統用向量搜尋 ERP 找出最相似的料號 / 上次採購廠商 / 上次成交價,RD 點「採用」就好
4. **鎖定後 propagate**:DPM 一鎖,自動把單價帶進三廠成本矩陣對應格,改動需重 review

---

## 2. 整體工作流(business view)

```
┌───────────────────────────────────────────────────────────────────┐
│  Stage 4  BOM 提供                                                │
│  ─────────────                                                    │
│  RD/EE/ME 在 BOM Form 建子料(EE 共用、ME 分 variant)             │
│      │                                                            │
│      ├─→ AI 自動搜 ERP 找最像的料號 + 上次採購廠商 + 歷史價       │
│      │                                                            │
│      └─→ RD 點「採用 ERP 料號」 / 「使用上次的價」                 │
│                                                                   │
├───────────────────────────────────────────────────────────────────┤
│  Stage 5  並行 Collect(關鍵中段)                                 │
│  ─────────────                                                    │
│  採購接手 → 對每個子料補:                                        │
│      ├─→ 製造商選項(可多家 mfg)                                 │
│      ├─→ 報價快照(廠商 + 單價 + 幣別 + 有效期 + RFQ 編號)        │
│      └─→ 採購策略(這次用哪一家)                                 │
│                                                                   │
│  同時 MPM 三廠 EPM 跑 Cleansheet:                                │
│      └─→ 每廠 × 每 PKG 選項 × 每 variant 一格 cost cell           │
│                                                                   │
├───────────────────────────────────────────────────────────────────┤
│  Stage 6  BOM Cost Review                                         │
│  ─────────────                                                    │
│  DPM 帶 BPM / RD / 採購 開審查會 → DPM 鎖 BOM                     │
│      │                                                            │
│      ├─→ 系統自動把採購選定價 propagate 到工廠矩陣對應格          │
│      ├─→ BOM 進唯讀(任何後續變更需走 ECN 流程)                   │
│      └─→ Stage 進 7 業務 gate                                     │
└───────────────────────────────────────────────────────────────────┘
```

**心智模型**:

- RD 出**結構**(這台機器需要哪些零件)
- 採購出**價**(這些零件向誰買、多少錢)
- MPM/EPM 出**製造端**(這個 BOM 在 CN/VN/TW 各廠組裝起來總共多少錢)
- DPM **鎖**(這版 BOM 是要拿去報價的)
- 業務拿鎖定版去**簽核**

---

## 3. 三個核心新概念

USER 在過程中會反覆碰到三個之前 Excel 時代沒有的概念,先講清楚。

### 3.1 概念一:Variant(同案多版本)

**舉例**:SteelSeries Rival 3+ 滑鼠 — Black 佔 80% / White 佔 20%

過去做法:開兩個專案 / 兩份 BOM Excel,維護一次改兩次。

新做法:**一個專案,一份 BOM 結構,標記哪些欄位「共用」、哪些「依 variant 不同」**。

| 欄位 | 共用 vs Per-Variant | 範例 |
|---|---|---|
| EE BOM(主板/電子料) | **共用** | Black/White 都用同一塊 PCB |
| ME BOM(機構件) | **Per-Variant** | Black 用啞光黑塑膠,White 用珍珠白塑膠 |
| Material Cost | **Per-Variant** | Black $4.32 / White $4.45 |
| 年量 | **Per-Variant** | Black 334K / White 84K |
| PKG | **共用** | 同一款 gift box,只是 logo 顏色貼紙不同 |

**約束**(spec §11.3.5):

- Phase 1 只支援**單軸**(只能有一個軸,如顏色 OR 容量,不能兩個交叉)
- 變體數 ≤ 5

### 3.2 概念二:Multi-Factory Cost Matrix(多廠成本矩陣)

**舉例**:同一個 BOM,要算「CN 廠 vs VN 廠 vs TW 廠」三套組裝成本。

過去做法:三廠 EPM 各自寫 Excel,合併靠手抄。

新做法:**一張矩陣表**,對齊客戶 RFQ_Cost.xlsx 版面 — 行=cost 項(MVA / PRIME-Black / PRIME-White / SG&A / TOTAL-Black / TOTAL-White),列=工廠(CN/VN/TW,Excel 中對應 Option A/B/C);**Packaging 是單一版本**(對應 §packaging 16 items),跨三廠共用,不再有 PKG-A/B/C 多版本。

```
                              │ Made In China │ Made In VN   │ Made In TW
  Retail Packaging            │ Option A      │ Option B     │ Option C
  (單一版本 16 items)         │               │              │
  ──────────────────────────┼───────────────┼──────────────┼─────────────
  MVA                         │  $1.8558      │  $1.430      │  $3.207
  PRIME COST (Matl+Labor) B   │  $10.373      │  $10.356     │  $11.840
  PRIME COST (Matl+Labor) W   │  $10.588      │  $10.579     │  $12.055
  SG&A + Profit               │  $0.7500      │  $0.750      │  $0.750
  ══════════════════════════╪═══════════════╪══════════════╪═════════════
  Total Cost (Ex-Factory) B   │  $11.123      │ $11.106 ⭐   │  $12.590
  Total Cost (Ex-Factory) W   │  $11.338      │ $11.329 ⭐   │  $12.750

  ⭐ = 該 variant 最便宜的工廠
```

**矩陣結構**:

| 維度 | 取值 |
|---|---|
| **工廠維度** | CN / VN / TW(3 個) |
| **Variant 維度** | Black / White(2 個,從 §variants 帶入) |
| **Packaging 維度** | ❌ 無(單一版本,跨三廠共用) |
| **Cell 數** | 3 廠 × 2 variants = **6 個 PRIME COST + 6 個 Total** |
| **每廠共用值** | MVA(1 個)+ SG&A(三廠統一)|

**為什麼 packaging 不是矩陣維度**:USER 2026-06-01 確認 — 包裝雖有 16 項(gift box / inner pad / pallet ...),但是**單一規範**跨三廠共用,不像零件那樣每廠有不同選擇。所以 packaging 在 §packaging 收一份就夠了,不需要在矩陣再展開。

**好處**:

- 同時看到所有 6 個 Total(Black/White × CN/VN/TW),不用切 tab 切來切去
- DPM 一眼看出「同 variant 三廠價差」、「同廠 Black vs White 價差」
- AI 直接掃整張矩陣,給「最便宜推薦」、「MVA 異常 flag」(TW MVA $3.21 比 CN/VN 高很多 → 為什麼?)
- BOM 鎖定後,料件價直接 propagate 到每廠 PRIME COST 的 Material 子項,EPM 不用重抄

### 3.3 概念三:MVA(Manufacturing Value Add)— ⏳ 設計待定

**MVA = 製造附加價值**:工廠把一堆料件組裝起來,自己賺的那塊(Labor + Overhead + Tooling 攤提 + 良率扣損 ...)。

**這部份目前架構待業務面決策(SD v0.3 §15)**,USER 需要拍板的 6 件事:

| # | 問題 | 為什麼要 USER 決定 |
|---|---|---|
| MVA-1 | MVA 數字哪裡來? | 每廠 EPM 手填 vs 公式算 vs 從 ERP standard cost 帶 |
| MVA-2 | MVA 拆幾項? | 只記 1 個總值 vs 拆 Labor/OH/Yield 3 項 vs 拆完整 11 項 |
| MVA-3 | MVA 要不要依 variant 不同? | Black 跟 White 共用 MVA vs 分開算 |
| MVA-4 | MVA 要不要依 PKG 不同? | PKG-A 跟 PKG-B 共用 MVA vs 分開算(包裝步驟工時不同) |
| MVA-5 | 客戶談 cost-down 時的版本鏈如何呈現? | v1 → v2 → v3 演變,要看得到歷史 |
| MVA-6 | 集團 rollup view? | 多案 MVA 平均、廠別 MVA 趨勢,要不要做 |

**這份報告不深入 MVA**,等 USER 拍板後再開工。SD 已預留三種規模(輕量 / 中量 / 完整)的選項。

---

## 4. 子料件如何跟 ERP 對齊(關鍵)

這是模組「智能」的核心。RD 不用記 ERP 料號,只要描述「我要用什麼零件」,系統幫忙找。

### 4.1 流程

```
RD 在 BOM 寫:「USB-C 連接器,公頭,Apple A 規範」
                    │
                    ▼
        AI 系統把這段文字轉成向量
                    │
                    ▼
        到 ERP item master 撈最相似的 top-10
                    │
                    ▼
  ┌──────────────────────────────────────────────────────┐
  │ 候選 1  CONN-USB-C-M-AA01  USB-C male 24P Apple v2  │
  │         上次採購 2026-03 / 立訊精密 / $0.62          │
  │         [採用此料號]  [採用此價]                     │
  ├──────────────────────────────────────────────────────┤
  │ 候選 2  CONN-USB-C-M-AA00  USB-C male 24P generic   │
  │         上次採購 2026-01 / 協承精密 / $0.55          │
  │         [採用此料號]  [採用此價]                     │
  └──────────────────────────────────────────────────────┘
                    │
                    ▼
        RD 點「採用」→ 自動帶 ERP 料號 / 規格 / 上次價
```

### 4.2 RD 的負擔大幅降低

| 操作 | 過去 | 新做法 |
|---|---|---|
| 找 ERP 料號 | RD 自己翻 ERP 查 | AI 自動建議 top-10 |
| 規格描述 | 手抄 | ERP 帶 |
| 上次採購廠商 | 問採購 | 系統帶上次採購單 |
| 上次成交價 | 問採購 | 系統帶,但要採購確認還有效 |
| 該不該詢新價 | 採購憑感覺 | 系統 flag「上次採購已 > 90 天,建議重詢」 |

### 4.3 為什麼採購不會被取代

AI 只負責**找候選 + 建議**,**最終哪一家、哪一個價,還是採購拍板**。理由:

- 價格有時效性(銅價、PD 漲跌)
- 廠商關係(這次給訂單下次才會配合)
- 量價策略(這案壓低換下案讓利)
- 風險評估(供應鏈中斷、戰爭、認證問題)

這些 AI 不會做。

---

## 5. 鎖定機制(DPM lock + propagate)

### 5.1 為什麼要 lock

報價簽核時必須有個「明確的版本」可指。否則:

- 業務簽完,RD 還能改 → 客戶收到的成本根據哪版?
- 採購又跑去喬一輪價 → 簽核時的價跟出貨時的價對不上
- 工廠 EPM 已經根據舊版算 Cleansheet → 鎖完之後算錯

### 5.2 Lock 之後系統做的事

1. **BOM 子料、單價、製造商選項全部唯讀**(只有 admin / DPM 能解鎖,且 audit log 記錄)
2. **採購選定價 propagate 到工廠矩陣**:
   - 每個 BOM 子料的「採購策略」(選定的 mfg + 價)
   - 自動寫入工廠矩陣每一個 cell 的 Material 欄位
   - 跨 variant、跨工廠、跨 PKG 全部一次帶完
3. **後續變更走 ECN**:正式 BOM 變更走工程變更通知流程(類似 ERP 的 ECO 概念)

### 5.3 解鎖規則

| 角色 | 解鎖權限 |
|---|---|
| RD / 採購 / EPM | ❌ |
| DPM | ✅(但須留註記原因) |
| Admin | ✅ |

解鎖會觸發告警 → 通知 BPM 跟業務(因為可能影響已簽報價)。

---

## 6. RACI(誰負責什麼)

> R = Responsible(主執行)、A = Accountable(最終負責)、C = Consulted(諮詢)、I = Informed(知會)

| 工作 | RD/EE/ME | 採購 | EPM | DPM | BPM | 業務 |
|---|---|---|---|---|---|---|
| 建 BOM 結構(子料、規格、用量) | **R** | C | I | A | I | I |
| ERP 料號對齊 | R | **R** | I | A | I | I |
| 詢價、製造商選項 | I | **R** | I | A | I | I |
| 採購策略(選哪家) | I | **R / A** | I | C | I | I |
| Cleansheet(三廠成本) | I | I | **R** | A | I | I |
| Variant 拆分(共用 vs per-variant) | **R**(ME) | C | I | A | I | I |
| 多廠矩陣 review | I | C | C | **R / A** | C | I |
| Lock BOM | I | C | C | **R / A** | C | I |
| BOM Cost Review 會議 | C | C | C | **R** | C | **A** |
| 解鎖授權 | I | I | I | **A** | I | I |
| 報價簽核(以 lock 版為基礎) | I | I | I | C | C | **R / A** |

---

## 7. 與既有系統整合點

### 7.1 跟 ERP 的關係

| ERP 表 / View | 用途 | 是否 write back |
|---|---|---|
| `mtl_system_items_b_kfv` | 料件主檔(子料對齊) | 讀 only |
| `mtl_mfg_part_numbers` | 製造商料號 | 讀 only |
| `mtl_manufacturers` | 製造商主檔 | 讀 only |
| `po_lines_all` / `po_headers_all` | 歷史採購單價 | 讀 only |
| `gl_daily_rates` | 匯率(透過 PO OU 反推 ledger) | 讀 only |
| `hr_organization_units` | OU → ledger 對應 | 讀 only |

**重要**:整個模組對 ERP **完全唯讀**,不會寫回去任何資料,不會影響 ERP 端流程。

### 7.2 跟 Cortex 既有資料政策的關係

Cortex 已有 4 層資料權限(個人 / 角色 / 組織 / ERP Multi-Org),BOM 模組**直接接用**,不另建:

- 機密案(`is_confidential`)→ BOM 子料價、廠商名只給專案 member 看
- 非機密案 → 角色 / 組織政策套用
- ERP 衍生資料(歷史採購價)→ Multi-Org scope filter(只能看自己有權限的 OU)

### 7.3 跟 AI 戰情室的關係

BOM 鎖定後,矩陣資料會自動進 AI 戰情:

- 多案 BOM cost 比較
- 同子料跨案價差分析
- 廠商議價 leverage 分析

---

## 8. 預計交付時程

> **前提**:MVA 6 件事 USER 拍板後開工

### 8.1 工時拆解

| Sprint | 工作 | 天 |
|---|---|---|
| **S1** | DB schema 建立(BOM 10 表 + Factory Matrix 4 表)+ migration | 1.0 |
| **S2** | ERP item 向量化 ETL pipeline + 7-day cache | 1.0 |
| **S3** | BOM Form UI(子料列表 + AI 建議 + 採購策略面板) | 1.5 |
| **S4** | Factory Matrix UI(矩陣表格 + cell drilldown) | 1.0 |
| **S5** | Lock + propagate 邏輯 + ECN 流程 | 0.5 |
| **S6** | 整合測試 + SteelSeries demo case 跑通 | 0.5 |
| | **總計** | **4.5 天** |

### 8.2 不在這次範圍內(明確排除)

- MVA 完整方案(等拍板,可能再 +2~3 天)
- BOM 跨案版本鏈視覺化(rollup view)
- ERP 反向 write back(改 ERP 料號 / 寫回採購單)
- 包裝 BOM 獨立 child project(現用 child-table 即可)

---

## 9. USER 需要拍板的事項(decision-needed)

按優先級:

### 9.1 P0 — kick-off 前必須拍板

| # | 議題 | 建議方向 | 影響 |
|---|---|---|---|
| 1 | **MVA-1**:MVA 數字來源 | 第一階段 EPM 手填(最快上線) | 影響開發複雜度 ±1 天 |
| 2 | **MVA-2**:MVA 拆幾項 | 第一階段拆 Labor / OH / Yield 3 項 | 影響 UI 欄位數 |
| 3 | **MVA-3**:Variant 維度 | 第一階段共用 MVA(同產線可共用) | 影響資料量 ×2 |
| 4 | **MVA-4**:PKG 維度 | 第一階段拆(PKG 工時確實差很多) | 影響資料量 ×3 |

### 9.2 P1 — 開發中可邊做邊定

| # | 議題 | 建議方向 |
|---|---|---|
| 5 | 子料對 ERP 失敗時的 fallback(無 ERP 料號的新料) | 允許「待建檔」狀態,DPM lock 不要求 100% 對齊 |
| 6 | 詢價歷史保留多久 | snapshot 永久保留,但 90 天後 UI 標示「舊價」 |
| 7 | 解鎖權限是否要再多一層(例如要 BU director 同意) | 暫定 DPM 即可,留 audit log |

### 9.3 P2 — 上線後迭代

- MVA-5 / MVA-6 版本鏈與 rollup view(P2 規劃)
- ERP write back(若 USER 想)
- BOM 跨案 reuse(同款子料在多案間 share)

---

## 10. 風險與緩解

| 風險 | 等級 | 緩解 |
|---|---|---|
| ERP item 描述品質參差,AI 比對精度低 | 中 | 第一階段允許手動 override,蒐集回饋微調 embedding model |
| 採購不熟新 UI,堅持用 Excel | 中 | 提供「Excel 匯入」按鈕(2026-Q3 加),不強推全面汰換 |
| 三廠 EPM 不及在 Stage 5 內填完矩陣 | 中 | SLA banner 提早警示,允許部分 cell 留 TBD 但 lock 時 flag |
| Lock 後 ECN 流程未上線,變更不知道怎麼走 | 高 | 第一版先提供「解鎖 + audit log」,ECN 流程下版本接 |
| MVA 拍板拖延 | 高 | 先按建議方向預設,USER 後續調整即可 |

---

## 11. 結論

這個模組要做的事,簡單講就是把今天散落在「N 份 Excel + 業務 / 採購 / RD 各自頭腦中的隱性知識」,變成**一份結構化、可查、可鎖、可重用的 BOM 資料**。

USER 端的負擔:

- **業務**:幾乎沒變(本來就在主案看報價)
- **DPM**:多了「鎖定」這個動作 + Review BOM Cost 會議
- **採購**:UI 改了,但邏輯類似(選製造商 + 寫價);多了 ERP 上次價可參考
- **RD**:UI 改了,有 AI 建議幫忙找 ERP 料號,負擔比 Excel 時代輕
- **EPM**:Cleansheet 從 Excel 變成矩陣 UI,Material 欄會自動帶,不用重抄

開發團隊需要 USER 端在 kick-off 前定 P0 那 4 件 MVA 議題,其他可以邊做邊談。

---

## Appendix A — 相關技術文件索引

- `docs/bom-collection-sd.md` v0.3 — 完整技術 SD(DB schema、API、UI 規格)
- `docs/factory-matrix-schema-sd.md` v0.1 — Multi-Factory Cost Matrix 深入技術細節
- `docs/projects-platform-spec.md` — 上游 Cortex 報價平台規格 v0.5(含 variant / NRE / PKG)
- `docs/Cortex_互動Demo_v0.5.html` — 互動 demo(目前 BOM section 為簡化版,需依此次討論升級,見 §12)

## Appendix B — 配合此架構,Cortex 互動 Demo 需要的修正

**目前 demo (v0.5) BOM section 為扁平結構**(單一 5 欄表格),與本架構落差較大。詳細修正建議見:[cortex-demo-bom-upgrade.md](cortex-demo-bom-upgrade.md)
