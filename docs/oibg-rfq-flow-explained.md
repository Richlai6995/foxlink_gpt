# OIBG 業務報價(RFQ)流程說明 — 給「不懂業務」的人看

> 對象:IT / 不熟業務流程的主管 / 規劃者
> 目的:讓不懂 RFQ 流程的人,看完就懂
> 來源:業務單位提供的 OIBG 報價 Flow + RFQ Flow PDF(2026-05-01)
>
> **設計風格**:深色 navy + cyan;每個專有名詞**都加白話解釋**;每張一個重點。
> 用來轉 Claude Web 做 PPT 設計。

---

## 📑 用語表(會前發給每位參與者)

> 這份非常重要。報價案的對話 70% 是縮寫,聽不懂縮寫等於聽不懂會議。

### 文件類
| 縮寫 | 全名 | 白話解釋 |
|---|---|---|
| **RFQ** | Request For Quotation | 客戶寄來的「請幫我們報價」詢價單 |
| **BOM** | Bill Of Materials | 物料清單 — 一個產品由哪些零件組成 |
| **EE BOM** | Electrical BOM | 電子料件清單(IC、電阻、電容) |
| **ME BOM** | Mechanical BOM | 機構料件清單(外殼、螺絲、塑件) |
| **PKG BOM** | Packaging BOM | 包裝材料清單(紙箱、泡棉) |
| **PRD** | Product Requirement Doc | 產品規格書(客戶需求 + 我方確認) |
| **WI** | Work Instruction | 作業指導書(工廠生產步驟) |
| **DVE** | Design Verification Eval | 設計驗證測試(早期 prototype 階段) |
| **Uni-BOM** | Unified BOM | 統一格式 BOM(報價會用統一表) |
| **Cleansheet** | — | 工廠成本明細表(料 + 工 + 管銷 + 物流) |

### 角色 / 部門類
| 縮寫 | 全名 | 白話解釋 |
|---|---|---|
| **DPM** | Design PM | 設計專案經理(主導技術評估,RD/EE/ME 整合) |
| **BPM** | Business PM | 業務專案經理(對客戶 / Q&A / 報價提交) |
| **MPM** | Manufacturing PM | 工廠專案經理(主導 cleansheet / NRE / PKG) |
| **EPM** | Engineering PM | NPI 工程 PM(新品導入工程細項) |
| **NPI** | New Product Introduction | 新產品導入(從研發到量產的過程) |
| **Sales** | — | 業務(直接面客戶) |
| **EE** | Electrical Engineer | 電子工程師 |
| **ME** | Mechanical Engineer | 機構工程師 |
| **RD** | Research & Development | 研發 |
| **PE** | Process Engineer | 製程工程師(工廠端) |
| **QA** | Quality Assurance | 品保 |
| **採購** | Purchasing | 兩種:**台北採購**(早期 RFQ/POC)/ **工廠採購**(EV~MP 量產) |
| **SMT** | Surface Mount Technology | 表面黏著(把 IC 焊到 PCB 上的工廠線) |
| **SMT team** | — | SMT 工廠團隊 |
| **RET** | Reliability Engineering Test | 可靠度測試(高溫高壓振動等驗證) |
| **塑件 PM** | — | 塑膠射出件 PM(管模具廠) |
| **VP** | Vice President | 副總(高階主管) |

### 成本 / 階段類
| 縮寫 | 全名 | 白話解釋 |
|---|---|---|
| **NRE** | Non-Recurring Engineering | **一次性工程費**(打模、開模、認證、測試夾治具)— 不會重複收的費用 |
| **NRE - SMT** | — | SMT 線設定 / 改線一次性費用 |
| **NRE - BB Assembling** | Bare Board Assembling | 裸板組裝一次性費用 |
| **NRE - MTE** | Mfg Test Equipment | 製造測試設備一次性投資費(含 Quality 驗證) |
| **NRE - ME Tooling** | — | 模具費(塑件 / 五金件的開模) |
| **Tooling cost** | — | 模具成本(開一付模具的 NT$) |
| **CMS cost** | Contract Mfg Service | 委外製造費(代工費用) |
| **True cost** | — | 真實總成本(料 + 工 + 費 + 攤提) |
| **FG** | Finished Goods | 成品(已包裝可出貨) |
| **POC** | Proof of Concept | 概念驗證(超前期,還沒立案) |
| **EV** | Engineering Verification | 工程驗證階段(產品成熟度的一個階段) |
| **MP** | Mass Production | 量產 |
| **Profit review** | — | 毛利檢視(這案能賺多少?) |
| **Suggested quote** | — | 建議報價(內部討論最終報多少給客戶) |

### 認證 / 測試類
| 縮寫 | 全名 | 白話解釋 |
|---|---|---|
| **EMI** | Electromagnetic Interference | 電磁干擾測試(各國法規) |
| **Safety** | — | 安全認證(UL / CE / TUV) |
| **WHQL** | Windows Hardware Quality Labs | 微軟硬體相容認證 |
| **USB IF** | USB Implementers Forum | USB 標準認證 |
| **Compatibility Test** | — | 相容性測試(跟主機板 / 作業系統的搭配) |
| **RoHS** | Restriction of Hazardous Substances | 歐盟有害物質限制(無鉛 / 無鎘) |
| **REACH** | Registration, Evaluation, Authorisation, Restriction of Chemicals | 歐盟化學品法規 |
| **CA65** | California Proposition 65 | 加州 65 號提案(化學標示) |
| **Royalty fee** | — | 權利金(用了某專利 / 技術要付的錢,例:USB-C 用了 Type-C 商標) |

### 細項 / 規格類
| 縮寫 | 全名 | 白話解釋 |
|---|---|---|
| **DIP** | Dual Inline Package | 雙列直插封裝(老式插孔型 IC,要特別標示) |
| **MLCC** | Multilayer Ceramic Capacitor | 多層陶瓷電容(被動元件) |
| **High-Q MLCC** | — | 高品質 MLCC(汽車級 / 工業級,單價較貴) |
| **Desc** | Description | 規格描述欄位 |
| **Schedule** | — | 時程表(這案各階段什麼時候完成) |

---

## Slide 1 — 封面

```
業務報價(RFQ)流程說明

— 給不熟業務的人看 —

來源:業務單位 OIBG Flow + RFQ Schedule
日期:2026-05-01
```

---

## Slide 2 — 一句話懂 RFQ

```
客戶寄來:「我想做一個 USB-C 充電線,規格如下,
            數量 10 萬條,你們報個價給我」

   ↓ 這份信就叫 RFQ(Request For Quotation)

我們要回答:「這條線一條多少錢」+「需要哪些一次性費用」
```

但「一條多少錢」不是業務隨便寫個數字 — 背後牽涉:
- 哪些料件(BOM)?
- 在哪個廠生產?
- 工廠線要做什麼準備(NRE)?
- 要過哪些認證?
- 要多久?
- 我們能賺多少(毛利)?

→ **報價需要全公司技術 + 工廠 + 採購 + 業務一起合作**,所以要有 PM 統籌。

---

## Slide 3 — 為什麼這流程很複雜?

一個 RFQ 涉及 **15+ 種角色**,協作軸線:

```
          客戶
            │ 寄 RFQ
            ▼
        Sales / BPM(對客戶)
            │ 派工
            ▼
    ┌───────┼───────┬─────────┐
    ▼       ▼       ▼         ▼
   DPM     MPM     EPM       採購
  (技術)  (工廠)   (NPI)    (買料)
    │       │       │         │
    │管 EE/ME│管 SMT │管 NPI    │
    │  /RD  │/採購  │工程       │
    └───────┴───────┴─────────┘
            │ 各自完成
            ▼
       BOM cost review(集合會議)
            ↓
       RFQ cost review(算毛利)
            ↓
       Submit Final Quote(BPM/Sales 發出)
```

---

## Slide 4 — 角色分組(1/3)業務側

### 客戶 → 業務 → BPM

| 角色 | 中文 | 白話職責 |
|---|---|---|
| **客戶** | — | 寄 RFQ 來,問價錢 |
| **Sales** | 業務 | 直接接客戶 Email / 電話的窗口 |
| **BPM** | Business PM | **業務側專案經理** — 對內分派工作,對客戶回 Q&A,最後送出報價 |

→ Sales 負責「對外」、BPM 負責「對內整合 + 對外回覆」

→ 兩者可能同一個人,也可能分開

---

## Slide 5 — 角色分組(2/3)PM 三劍客

把報價案的內部執行拆三組,每組一位 PM 帶頭:

| PM 角色 | 中文 | 主導範圍 |
|---|---|---|
| **DPM** | Design PM(設計 PM) | 技術部分:RD / EE / ME / 認證 / 測試 |
| **MPM** | Manufacturing PM(工廠 PM) | 工廠部分:cleansheet / SMT 線 / 包裝 / 成品物流 |
| **EPM** | NPI Engineering PM(新品導入工程 PM) | 細項工程:工廠端的 NRE 細項 / 測試夾治具 / 量測 |

**為什麼要分 3 個 PM?**

- 一個 PM 管不完(報價牽涉太多領域)
- 各 PM 各自有自己的專業 team(如 DPM 跟 EE/ME/RD 熟,MPM 跟 SMT 熟)
- **DPM 通常是主 PM**,BPM 對客戶,MPM 對工廠,EPM 細項

---

## Slide 6 — 角色分組(3/3)執行 team

各 PM 帶領的執行成員:

### DPM 帶的人(技術 team)

| 角色 | 做什麼 |
|---|---|
| EE | 電子工程師 — 出 EE BOM(電子料件清單) |
| ME | 機構工程師 — 出 ME BOM、WI、Tooling cost |
| RD | 研發 — 提供 PRD、Test cost |
| QA | 品保 — 提供認證 / 測試需求 |

### MPM 帶的人(工廠 team)

| 角色 | 做什麼 |
|---|---|
| 工廠 SMT team | 給 SMT NRE + 一條線多少錢 |
| 工廠 PE | 給製程工時、工序 |
| 工廠採購 | 給 EV~MP 量產採購價 |
| 廠商 / 塑件 PM | 給模具 / 塑件報價 |

### 業務側採購 team

| 角色 | 做什麼 |
|---|---|
| 台北採購 | RFQ 階段、新料詢價、Compromise 價格 |
| 工廠採購 | 量產階段(EV~MP) |

---

## Slide 7 — 文件類名詞解釋

```
RFQ(詢價單)
   ↓ 客戶提供
   
業務轉交給 → DPM
   ↓
DPM 收到後,要拿到這幾份:

   PRD(產品需求書)— 詳細規格在這
   ↓
   EE BOM ← EE 工程師畫
   ME BOM ← ME 工程師畫
   PKG BOM ← MPM 從工廠拿
   ↓
   合併成 Uni-BOM(統一格式 BOM)
   ↓
   WI(作業指導書)← ME 寫,工廠怎麼組裝
   ↓
   Cleansheet(成本明細表)← MPM 算的工廠成本
   ↓
   全部進報價單
```

→ 每個文件都要有人提交 + 有 deadline + 有 review

---

## Slide 8 — 成本類名詞解釋

報價案的「錢」分兩大類:

### 1. 重複費用(每條都收)

```
單條成本 = BOM cost + 工時 + 管銷 + 物流 + 利潤
           ↓
         (EE + ME + PKG)
         (SMT line × 工時)
         (廠區管銷率 %)
         (海運 / 空運)
```

### 2. 一次性費用 NRE(只收一次)

```
NRE - SMT       ← 設定 SMT 線、首批試產
NRE - BB Assembling  ← 裸板組裝設備調整
NRE - MTE       ← 製造測試設備(MTE)+ Quality 驗證
NRE - ME Tooling  ← 開模(塑件、五金)
EMI / Safety / WHQL / USB IF / Compat ← 認證費
RD Test cost    ← RD 測試實驗室費用
Royalty fee     ← 用了某專利的權利金
```

→ 報價單會把 NRE 跟單條成本分開列。

---

## Slide 9 — 認證 / 測試類名詞

每個產品要過哪些認證?牽涉成本與時間。

| 認證 | 用途 | 影響 |
|---|---|---|
| **EMI** | 電磁干擾測試 | 各國法規必過,測試費 + 時間 |
| **Safety** (UL / CE) | 安全認證 | 同上 |
| **WHQL** | 微軟相容 | 充電器類產品需要 |
| **USB IF** | USB 標準認證 | USB 介面產品需要 |
| **Compatibility Test** | 跟客戶其他產品相容 | 客戶要求 |
| **RoHS / REACH / CA65** | 環保 / 有害物質法規 | 賣歐美必過 |
| **Royalty fee** | 用了專利的權利金 | 例:USB-C 名稱 |

→ DPM 要從 RD / QA 收這些 cost,加進 NRE。

---

## Slide 10 — 8 階段流程總覽

```
Stage 1   📩 Receive RFQ                    DPM 接案
            ↓
Stage 2   ❓ Q&A Collect                    DPM + Team 收問題
            ↓
Stage 3   💬 Q&A Feedback                   BPM 回客戶
            ↓
Stage 4   📋 BOM 提供                       RD / DPM 給 EE+ME BOM
            ↓
Stage 5   ⚡ 並行 Collect ───┐
            ┌─ MPM:工廠成本 │
            └─ DPM:NRE     │
            ↓               ↓
Stage 6   💰 BOM Cost Review               DPM + BPM + RD + 採購
            ↓
Stage 7   📊 RFQ Cost Review               True cost / Profit / Suggested Quote
            ↓
Stage 8   📤 Submit Final Quote            BPM / Sales 發出
```

---

## Slide 11 — Stage 1-3 細節

### Stage 1:Receive RFQ
- 業務 / Sales 收到客戶 Email
- 轉給 DPM(指派一位主 PM)
- DPM 通知 RD / FD Team(內部廣播)

### Stage 2:Q&A Collect
- DPM + Team 一起讀 RFQ
- **規格不清楚的地方列成問題**(例:有害物質要求是 RoHS 還是 REACH?DIP 要不要特別標?MLCC 要不要 High-Q?)
- DPM 把問題彙整給 BPM

### Stage 3:Q&A Feedback
- BPM 把問題寄給客戶
- 客戶回答
- 答案再傳回 DPM(讓技術評估有依據)

→ 這 3 階段是「**搞清楚客戶到底要什麼**」

---

## Slide 12 — Stage 4-5 細節(關鍵並行階段)

### Stage 4:BOM 提供
- EE 出 EE BOM(每個電子料件含至少一家廠商型號)
- ME 出 ME BOM、WI、Tooling cost
- DPM 整合給 MPM

### Stage 5:**並行 Collect**(同時跑兩條線)

```
┌─ MPM Collect ────────────────────────────┐
│  PKG cost                                 │
│  ME cost / Tooling cost(對 PE)          │
│  SMT / Assembly cost                      │
│  Assembly & Test 設備 cost                │
│  測試夾治具 cost                          │
│  Manufacturing plan & tooling plan        │
│  FD resource(工廠資源)                  │
│  Cleansheet(工廠成本明細表)             │
└───────────────────────────────────────────┘

┌─ DPM Collect RD test cost + NRE ─────────┐
│  EE / ME BOM cost(從採購拿單價)         │
│  EMI / Safety 認證費                      │
│  WHQL / USB IF 認證費                     │
│  Compatibility Test 費                    │
│  RD Resource(研發投入)                  │
│  Schedule(時程表)                        │
│  Any other NRE                            │
└───────────────────────────────────────────┘
```

→ **平行跑可以省時間**;沒這個並行就得慢慢跑線性流程

---

## Slide 13 — Stage 6-7-8 細節(集合 + 結算)

### Stage 6:BOM Cost Review
- 集合會議:**DPM + BPM + RD + 採購**
- 看 EE cost / ME cost / Tooling cost
- 確認沒有漏項、價格合理

### Stage 7:RFQ Cost Review
- 集合會議:**DPM + BPM + RD**
- 看:
  - True cost(真實總成本)
  - CMS cost(代工費)
  - Suggested quote(內部建議報價多少)
  - Profit review(毛利檢視)

### Stage 8:Submit Final Quote
- BPM / Sales 把最終報價單發出去給客戶
- 留底存檔

→ 後 3 階段是「**確認算對了 + 發出去**」

---

## Slide 14 — RACI 矩陣是什麼?(Accountable + Responsible)

業務文件講「Accountable to BPM, From NPI team Responsible」這句話什麼意思?

```
Accountable(A)= 「誰要對這件事 向上負責」
Responsible(R)= 「誰實際做這件事」
```

→ 一件事一個 A(背鍋的人)+ 一個或多個 R(實作的人)

### 範例(從 OIBG 文件抓)

| 項目 | A(背鍋) | R(實作) |
|---|---|---|
| BOM cost - EE | DPM | 台北採購 / 工廠採購 |
| BOM cost - PKG | MPM | 工廠採購 |
| Cleansheet | DPM | SMT team / NPI EPM |
| NRE - ME Tooling | DPM | 廠商 / 塑件 PM / 工廠採購 |
| Transportation - FG(成品物流) | MPM | (待定) |

→ 報價案有 16 項以上 deliverable,每項都要釐清 A 跟 R

---

## Slide 15 — Schedule 範例怎麼解讀

OIBG 文件給的 Schedule example:

```
Q&A (team, 2/27)
EE BOM update (EE, 3/5)
ME BOM update (ME, 3/4)
WI update for Quotation (ME, 2/22)
ME BOM and Tooling cost (PE, 2/25)
Schedule update (DPM, QA response+1day)         ← 這裡!
RET Plan and Cost (RET, QA response+3days)      ← 這裡!
EE BOM cost (台北採購, EE BOM+3days)             ← 這裡!
Internal BOM review (DPM, EE BOM Cost+1day)
Cleansheet send to VP (MPM, EE BOM Cost+1day)
Quotation to Sales team (DPM, EE BOM Cost+2days)
```

### 「+Xday」是什麼?

```
QA response+1day = 客戶 QA 回完問題 那天 + 1 天
EE BOM+3days   = EE BOM 完成那天 + 3 天
EE BOM Cost+1day = EE BOM 採購價拿到那天 + 1 天
```

→ **deadline 不是固定日期**,是「**先決條件完成後 + N 天**」

→ 如果客戶 QA 晚回 3 天,所有 Schedule 自動跟著推遲

→ 這個叫 **Dependency-based Deadline**(依賴關係 deadline)

---

## Slide 16 — 並行 Collect 視覺化

把 stage 5 攤開看:

```
                      Stage 4 結束
                      EE+ME BOM 都齊全
                            │
                            ▼
              ┌─────────────┴─────────────┐
              │                           │
              ▼                           ▼
       MPM 線(工廠端)              DPM 線(研發端)
       ───────────                 ──────────
       PKG cost                    EE/ME BOM cost
       ME cost                     EMI/Safety 認證費
       SMT cost                    WHQL/USB IF
       Tooling cost                Compatibility Test
       測試設備                     RD Resource
       Cleansheet                  Schedule
              │                           │
              ▼                           ▼
       MPM 完成 ✓                  DPM 完成 ✓
              │                           │
              └─────────────┬─────────────┘
                            ▼
                    Stage 6 BOM Cost Review
```

→ 並行的好處:**MPM 跑 cleansheet 時 DPM 同時收 NRE,兩條線各跑各的**;不用一個等一個

---

## Slide 17 — 整理:為什麼這些對 IT 來說重要?

這些業務細節影響系統設計的 5 個地方:

| 業務概念 | 系統設計對應 |
|---|---|
| 4 種 PM(DPM/BPM/MPM/EPM) | Multi-PM 模型(`project_members.sub_role`) |
| 各 PM 帶自己 team | PM Team 自然涌現(`invited_by_pm_user_id`) |
| RACI(A + R 雙角色) | task / form field 加 `accountable_role` + `responsible_role` |
| Stage 5 並行 collect | Stage 內 task 並行(平台天生支援) |
| Dependency Deadline(QA+1day) | task 加 `depends_on_task_id` + `relative_deadline_days` |
| 業務統合確認 stage 結束 | Stage Gate(全 task 完成 → 業務點「進下一 stage」) |

→ 業務 RFQ 流程的細節,**完全反映在系統的資料結構與權限設計上**。

---

## Slide 18 — 系統如何幫業務流程

每個 stage 系統會幫:

| Stage | 業務做的 | 平台幫的 |
|---|---|---|
| 1. Receive RFQ | DPM 接案 | 自動建 7 channels + 啟動 SLA + 通知 PM |
| 2. Q&A Collect | DPM 收問題 | #qa-customer channel + AI 整理問題 |
| 3. Q&A Feedback | BPM 對客戶 | 訊息 Pin + 客戶反饋進新版 form |
| 4. BOM 提供 | EE/ME 出 BOM | Form 自動拆 task 給各角色 |
| 5. 並行 Collect | MPM + DPM 同時跑 | Stage 內並行 task + 各 PM team channel |
| 6. BOM Cost Review | 集合會議 | Stage Gate(任務全完成自動 ready) |
| 7. RFQ Cost Review | 算毛利 + 建議報價 | AI 拉歷史類似案毛利 + What-if 模擬 |
| 8. Submit Final Quote | BPM/Sales 發 | Excel 自動生成 + KB sediment |

---

## Slide 19 — 結語

```
一句話:

業務 RFQ 流程很複雜,牽涉 15+ 種角色 / 16+ 項 deliverable / 8 個 stage / 並行協作。

我們的系統做的是:

  把這個複雜流程變成「不會迷路的工具」 +
  「主管一眼看完進度的儀表板」 +
  「結案後永遠可查的知識庫」
```

→ 不是業務「另外要學的工具」,是「**讓業務更快搞定 RFQ 的助手**」

— 投影片結束 —
