# Cortex 通用專案管理平台 — 投影片文字稿(業務主管版 v2)

> 對應規格書:[projects-platform-spec.md](./projects-platform-spec.md) v0.4
> 日期:2026-05-01 更新(對齊 OIBG RFQ flow + 多 channel + RACI + Multi-PM + Stage Gate + Dependency)
> 用途:轉 Claude Web 進行 PPT 設計
> 聽眾:業務主管 / 事業處主管
>
> 投影片風格建議:深色系冷色調(navy + cyan),每張一個重點,大字 + 視覺化區塊。
> 業務語言為主,技術細節僅在必要時點到。

---

## 📑 術語對照表(會前發給每位參與者)

| 簡稱 | 白話解釋 |
|------|---------|
| Cortex | 公司內部已運行的 AI 智慧助理平台 |
| 專案類型 | 平台支援多種專案,如「業務報價」「IT 任務」「教育訓練」 |
| Channel | 對話頻道(類 Slack/Teams 概念) |
| 戰情會議室 | 報價案的即時協作畫面,含多 channel + 任務 + 成員 |
| Multi-PM | 多 PM 模型 — 一專案下 DPM/BPM/MPM/EPM 多種 PM |
| DPM/BPM/MPM/EPM | Design / Business / Manufacturing / NPI Engineering PM |
| RACI | Responsible(實作)/ Accountable(背鍋)矩陣 |
| Stage Gate | 階段確認制 — 任務完成後業務確認才進下一階段 |
| Dependency Deadline | 「QA response+1day」這種依賴 deadline |
| RFQ | 客戶詢價單 |
| BOM | 物料清單 |
| NRE | 一次性工程費(模具 / 認證 / 設備) |
| Cleansheet | 工廠成本明細表 |
| 機密欄位 | 想藏的資訊欄位(報價金額 / 毛利率) |
| Tier | 區間帶,如 Tier-A 代表 200K-1M USD |
| 顯示策略 | 沒授權時看到 Tier-A / A001 / 蘋果\*\*\*\* |
| 流程模板 | 預設一套 stage 清單給 PM 套用 |
| 知識庫 / KB | 結案案件存進去的儲存庫,未來新案可查 |
| 脫敏 | 把客戶名 / 金額換成代號 |
| AI 即時建議 | AI 立即給出歷史類似案例與建議 |
| Pin | 訊息置頂 |
| 已讀回執 | 強制成員確認看到關鍵決策 |
| Lifecycle | 專案生命週期(開案/進行/暫停/結案/重開) |

---

## Slide 1 — 封面

```
Cortex 通用專案管理平台

讓接單更快 · 知識會累積 · 主管看得見

對齊 OIBG RFQ Flow(2026-05-01)
```

**副標**:站在 Cortex 肩膀上,從業務報價開始,延伸到所有專案

**版本**:v0.4 規劃稿 · 2026-05-01 · 資訊部

---

## Slide 2 — 一頁看懂我們在做什麼

**一句話**:把「業務報價」「一般專案」「跨部門協作」全部搬到一個平台,各自保留專業特色,底層共用 Cortex 既有 AI 能力。

**三個關鍵字**:

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│             │   │             │   │             │
│   集中平台  │   │   AI 輔助   │   │  知識累積   │
│             │   │             │   │             │
│  資訊不散落 │   │ 秒查歷史案  │   │  結案進 KB  │
│   進度透明  │   │  廠區比較   │   │   全員學習  │
│             │   │             │   │             │
└─────────────┘   └─────────────┘   └─────────────┘
```

---

## Slide 3 — 業務團隊的 5 個痛點

```
⏱  24 小時要給客戶報價
    資訊散在 Email / Webex / Excel / 個人電腦

❓  過去報價案沒沉澱
    類似案子來了還是要重跑一次

❓  主管看不到整體進度
    哪個專案卡住、哪個快超期,要一個個問

❓  業務 / DPM / MPM / 工程 / 採購 跨部門協作
    一個案 15+ 種角色,訊息散落不同 channel

❓  RFQ Schedule 是 dependency-based
    「QA response+1day」「EE BOM+3days」
    Excel 排程算不準
```

**這個平台一次解決這 5 件事**

---

## Slide 4 — 平台核心概念

**一個平台,多種專案類型**

```
┌─────────────────────────────────────────────────┐
│        Cortex 通用專案管理平台                  │
│                                                 │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐          │
│  │ 業務 │ │ 一般 │ │  IT  │ │ 教育 │ ...      │
│  │ 報價 │ │ 專案 │ │ 任務 │ │ 訓練 │          │
│  └──────┘ └──────┘ └──────┘ └──────┘          │
│                                                 │
│  共用底層:成員 / 任務 / 群聊 / AI / KB / 戰情 │
└─────────────────────────────────────────────────┘
```

**業務的好處**:你不用學多套系統;主管可以一個入口看所有專案

**未來擴充**:IT 任務、教育訓練、跨部門協作 — 同樣介面,新功能不用重學

---

## Slide 5 — 業務報價的專屬武器(對齊 OIBG flow)

點開「業務報價」類別後,你會看到報價專屬功能:

| 功能 | 用途 |
|------|------|
| ⚡ **多 Channel 戰情會議室** | 7 個預設 channel,各 PM team 自己空間 + DM 私聊 |
| 👥 **Multi-PM 模型** | DPM / BPM / MPM / EPM 各帶 team,清楚分工 |
| 📋 **RACI 任務** | 每件事誰背鍋(A)+ 誰實作(R)清楚 |
| 🚦 **Stage Gate** | 任務完成 → 業務確認 → 進下一 stage |
| ⏱ **Dependency Deadline** | 「QA+1day」自動算,客戶晚回所有 deadline 自動推遲 |
| 📊 24h SLA 倒數 | 紅黃綠燈號,主管秒看進度 |
| 🏭 三地廠區比較 | 中國 / 印度 / 越南 自動跑成本對比 |
| 💰 Tier 顯示 | 沒授權看金額者看到 `Tier-A` |
| 🤖 AI 即時建議 | 秒查類似歷史案例 |
| 🔒 結案脫敏 | 機密版保留,脫敏版讓全公司學 |

**其他專案類型**(如一般專案 / IT 任務)沒這些武器,但有自己的特色功能

---

## Slide 6 — 戰情會議室:Slack/Teams 風格多 Channel ★

**24 小時 SLA 下,多人同時跑不同環節 — 用多 channel 分工不互相干擾**

QUOTE plugin 預設自動建 **7 個 channel**:

```
📢 #announcement   公告(限業務發,所有 member 必看 + 已讀回執)
💬 #general        一般討論(全員)
💬 #qa-customer    客戶 Q&A(BPM 主導,對應 stage 2-3)
💬 #engineering    EE/ME/RD 討論(DPM team)
💬 #sourcing       採購 / 供應商
💬 #factory        工廠(MPM team + EPM + 廠採購)
💬 #cost-review    BOM cost review + RFQ cost review
🔒 (DM by need)    1對1 私聊
```

**5 種訊息色語言**:🟢 進度 / 🔴 卡關 / 🟡 決策 / 🔵 AI 建議 / ⚪ 一般

**重要決策強制已讀回執** — 30 分鐘沒讀自動推 Webex

---

## Slide 7 — 戰情會議室 UX(Slack 風格三欄)

```
┌─────────────────────────────────────────────────────────────────┐
│ QT-2026-0143  /  Apple                  SLA 2h 14m   COSTING    │
├─────────────────┬──────────────────────────────┬────────────────┤
│ Channels        │  #engineering          5 在線│ 任務 + 成員   │
│                 ├──────────────────────────────┤                │
│ 📢 announcement │  John 卡住 @Tony 協助  14:22 │ 📊 BOM 展開   │
│    (3 未讀)     │                              │  ✓ 標準件     │
│ 💬 general      │  Tony: 走加急 16:00 前  14:24│  ⏳ 新料詢價   │
│ 💬 engineering  │                              │                │
│ 💬 sourcing     │  [AI] 類似案 QT-2025-0087    │ 👥 成員(分組)│
│ 💬 factory      │       建議 parallel B 廠     │ 業務組:        │
│ 💬 qa-customer  │                              │  Amy / Lisa(助)│
│ 💬 cost-review  │  PM: 同意 parallel  14:26    │ DPM Mike:      │
│                 │                              │  └ John (EE)   │
│ ── DM ──        │  ⚡ Mike 接受任務             │  └ Lin (ME)    │
│ 🔒 Amy ↔ John   │                              │ MPM Tony:      │
│ 🔒 Rich ↔ Tony  │                              │  └ Chen (SMT)  │
│ [+ 新對話]      │                              │ BPM Lisa-B     │
└─────────────────┴──────────────────────────────┴────────────────┘
```

**右欄成員依 PM Team 分組顯示**(各 PM 自然帶自己人)

---

## Slide 8 — 任務指派:RACI(對齊 OIBG flow)★

業務文件早就在用「Accountable to BPM, From NPI Responsible」這種寫法。系統把這個 RACI 矩陣搬進來:

```
A(Accountable)= 「向上負責的人」(背鍋)
R(Responsible)= 「實際做事的人」(實作)
```

範例(從 OIBG 文件抓):

| 項目 | A(背鍋) | R(實作) |
|---|---|---|
| BOM cost - EE | DPM | 台北採購 / 工廠採購 |
| BOM cost - PKG | MPM | 工廠採購 |
| Cleansheet | DPM | SMT team / NPI EPM |
| NRE - ME Tooling | DPM | 廠商 / 塑件 PM |
| Transportation - FG | MPM | (待定) |

→ 報價案 16+ 項 deliverable,每項都標 A + R

→ 任務超期時 escalation 自動加 A 進通知對象

---

## Slide 9 — Multi-PM 模型 + PM Team ★

**4 種 PM 並存,各帶自己 team**:

```
業務(主 + 助理)= HOST
   │ 結案 / 換主 PM / Stage Gate / 邀全員
   │
   ├─ DPM(Design,主 PM)── 邀 EE / ME / RD ── 自己 team
   ├─ MPM(Manufacturing)── 邀 SMT / EPM / 廠採購 ── 自己 team
   ├─ BPM(Business)──── 帶客戶窗口 / 助理 ── 自己 team
   └─ EPM(NPI Engineering)── 帶 NPI 工程細項

各 PM:
  ▸ 邀請限自己 team 成員
  ▸ 開自己的 group channel(對應 7 channels)
  ▸ 指派 task 給自己 team

業務:
  ▸ 全跨 team 邀請
  ▸ 結案 / 換 PM / 改機密欄位
  ▸ Stage Gate 確認
```

→ 業務不需 PM 代理,業務本身就有「主業務 + 助理」分工總有一人在線

---

## Slide 10 — Stage Gate(業務確認制)★

對應 OIBG flow:**stage 不是自動跳,要業務確認**

```
某 stage 內所有 task 完成
     ↓
系統自動 stage.status = READY_FOR_GATE
     ↓
announcement channel 推訊息「Stage X 全部完成,等業務確認」
戰情會議室 banner ⏳「等業務確認進入下一 stage」
     ↓
業務(或業務助理)點「進入下一 stage」
     ↓
stage.status = DONE + 下一 stage = ACTIVE
```

**為什麼這樣設計**:
- PM 對各自任務負責(任務完成 = PM 做完該做的)
- **整個 stage 由業務確定**(stage 6/7/8 都是業務 gate)
- 對應 RFQ flow 的「集合會議」概念 — 業務開會確認可以進下一步

---

## Slide 11 — Dependency-based Deadlines ★

**對齊 RFQ Schedule example**:

業務原 Excel:
```
Schedule update (DPM, QA response+1day)
RET Plan and Cost (RET, QA response+3days)
EE BOM cost (台北採購, EE BOM+3days)
Internal BOM review (DPM, EE BOM Cost+1day)
Cleansheet to VP (MPM, EE BOM Cost+1day)
Quotation to Sales (DPM, EE BOM Cost+2days)
```

→ Deadline 不是固定日期,是「**依賴關係 + N 天**」

### 平台支援

```
某 task:
   ▸ 依賴某個 task(例:QA response)
   ▸ 該 task 完成後 +N 天(例:+1 day)
   ▸ 系統自動算 deadline
```

**好處**:
- 客戶 QA 晚回 3 天 → 後續所有 deadline **自動推遲**
- 不需要 Excel 手動重排
- 主管儀表板自動更新燈號

---

## Slide 12 — 業務報價完整流程(對齊 OIBG)

```
1. Receive RFQ        業務 → DPM,sla 4h
   ↓
2. Q&A Collect        DPM + Team 收問題,sla 24h
   ↓
3. Q&A Feedback       BPM 對客戶,sla 8h
   ↓
4. BOM 提供           EE + ME 出 BOM,sla 24-72h
   ↓
5. ⚡ 並行(stage 內多 task 並行)
   ├─ MPM Collect:工廠成本 / Cleansheet
   └─ DPM Collect NRE:認證 / 測試 / RD 資源
   ↓
6. BOM Cost Review    DPM + BPM + RD + 採購 → 業務 Gate ✓
   ↓
7. RFQ Cost Review    True cost / Profit → 業務 Gate ✓
   ↓
8. Submit Final Quote BPM + Sales → 業務 Gate ✓ → 結案
            ↓
        AI 自動摘要 + 脫敏 → 入知識庫
```

---

## Slide 13 — 機密保護:細到欄位級

**問題**:不是所有專案都要保護成「報價等級」;同一專案內也不是所有欄位都機密

**解法**:你自己決定機密範圍

```
建立專案:

  ☑ 標記為機密專案
     ↓
     勾選哪些欄位機密:

     ☑ 報價金額
     ☑ 毛利率
     ☑ 成本明細
     ☐ 客戶名稱      ← 你決定要不要藏
     ☐ 數量
     ☐ 交期
```

**邀請成員時再個別授權**:John 能看「成本」但看不到「金額」 — 由你勾選

---

## Slide 14 — 同一專案,不同人看到的不一樣

| 對象 | 看到的內容 |
|------|------------|
| 業務 / 業務助理 / PM | `$ 2.143 / pcs,毛利 16.6%`(完整) |
| 高階主管 | 完整 |
| 有授權的成員 | 完整 |
| 沒授權的成員 | `Tier-A,毛利 Tier-M(中)` |
| 觀察者 | `Tier-A,毛利 Tier-M(中)` |
| 客戶名 同樣可選 | `蘋果` 或 `A001` |

**4 種顯示策略,系統自動套用**:

- TIER 分級(金額 / 毛利率)
- ALIAS 代號(客戶 / 廠商)
- MASK 打星(字串)
- RANGE 區間(數量)

---

## Slide 15 — 結案後自動沉澱(每一案都變資產)

```
專案結案
  ↓
系統自動做 5 件事:

  1. 抽取所有資料(跨 channel 的訊息 / 任務 / AI 建議 / 附件)
  2. AI 寫摘要(關鍵決策 / 卡關原因 / 解法 / 贏輸原因)
  3. 脫敏處理(客戶名 → A001 / 金額 → Tier-A)
  4. 存兩份到知識庫:
     ┌─ 完整版 → 你的事業處可查
     └─ 脫敏版 → 全公司可學
  5. 留稽核紀錄 7 年
```

**一年後業務新人接手時**:問「USB Type-C 給車用客戶過去報價策略?」
AI 秒答:「3 個類似案,其中 2 案 Win,平均毛利 Tier-M,廠區優先越南」

---

## Slide 16 — AI 即時輔助(三層架構)

```
Layer 1   即時建議            < 2 秒    所有使用者
─────────────────────────────────────────────────────
   AI 比對歷史脫敏案 → 秒回「類似 3 案」


Layer 2   精確分析             5-30 秒  業務 / PM / 主管
─────────────────────────────────────────────────────
   查客戶歷史贏單率 / 廠區比較 / 競品價位


Layer 3   統計儀表板            即時    主管 / Admin
─────────────────────────────────────────────────────
   SLA 燈號 / 贏單率 / Delay 熱點
```

**重點**:AI Bot 在每個 channel 都能 @,跨 channel RAG 召回(@bot 工程那邊昨天決定的廠區是?→ 自動撈 #engineering)

---

## Slide 17 — 主管視角(戰情儀表板)

**一頁看完所有 active 專案**:

```
┌──── SLA 燈號 ────┐  ┌──── KPI ──────┐  ┌── Delay 熱點 ──┐
│                  │  │               │  │                │
│  🔴 超期    2 件 │  │ 本週報價 12   │  │ 詢價階段 5 件  │
│  🟡 接近期限 5 件│  │ 贏單率  68%   │  │ 核算階段 3 件  │
│  🟢 正常    8 件 │  │ 平均回應 18h  │  │ 策略階段 2 件  │
│                  │  │               │  │                │
└──────────────────┘  └───────────────┘  └────────────────┘

┌─────────────── 成員負載 ───────────────┐
│                                         │
│  Amy  ████████░░  4 案 (1 超期)         │
│  Rich ██████░░░░  3 案                  │
│  John ██████████  5 案 (1 卡住)         │
│                                         │
└─────────────────────────────────────────┘
```

**主管不用問「現在情況怎樣」** — 一頁看完;點任一張卡 drill-down 到細節

---

## Slide 18 — 流程彈性(三層模板)

**問題**:不同業務、不同事業處的報價流程不一樣;寫死哪一套都不對

**解法**:三層模板,PM 自選

```
建立專案時 [流程模板 ▾]:

  ━━━ 我的個人模板 ━━━
  ⭐ 我的快速報價(預設)

  ━━━ 事業處模板 ━━━
  ⭐ BU1 標準報價流程(預設)

  ━━━ 公司預設 ━━━
  業務報價標準流程(對齊 OIBG 8 stages)
  IT 任務標準流程
  一般專案標準流程
```

**建立後 PM 還可以**:加 stage / 改名稱 / 改 SLA / 跳過某 stage

**沒一套適合自己?**一鍵複製成個人模板再改

---

## Slide 19 — 一個入口,不用學新工具

```
登入 Cortex
  ↓
Sidebar:

  💬 對話
  🛠 技能
  📚 知識庫
  📊 AI 戰情室
  🎓 教育訓練
  ❓ 問題反饋
  ─────────────
  📁 專案管理 ★ 新增
  ─────────────
  ...

點進去 → 直接看「跨專案儀表板」(燈號一目了然)
```

**業務體感**:跟用 Cortex 其他模組一樣,不用記新網址、不用第二次登入

**SSO 一次登入,通用全平台**

---

## Slide 20 — 對業務團隊的 6 個具體效益

```
1. 報價週期穩定 24h
   集中平台 + AI 即查歷史 + 自動核算 → 不再到處湊資料

2. 新人 ramp-up 縮短
   結案脫敏 KB 全公司可查 → 新人從歷史案學定價直覺

3. 主管即時掌握
   戰情儀表板 + RAG 燈號 → 主管不用一個個問

4. 廠區決策更快
   一鍵跑三地成本對比 + AI 建議 → 不再 Excel 手算

5. 跨組協作不打架
   多 channel 分流 → DPM / MPM / BPM 各自空間,公告統合

6. 知識不流失
   每案結案自動沉澱 → 業務調動 / 離職都有交接
```

---

## Slide 21 — 上線時程

```
Phase 1   ─────────  2-4 週     基本平台 + 業務報價最小版
                                 ▸ 多 channel 戰情會議室(含 DM)
                                 ▸ Multi-PM + RACI + Stage Gate
                                 ▸ Dependency Deadlines
                                 ▸ 機密欄位機制
                                 ▸ 基礎成本核算
                                 ▸ 跨專案儀表板

Phase 2   ─────────  4-8 週     協作 + 知識沉澱強化
                                 ▸ super_user / Bot 整合
                                 ▸ 結案脫敏 + KB 入庫
                                 ▸ 域內通訊(跨專案 channel)
                                 ▸ AI 戰情 embed
                                 ▸ AI 類似案推論

Phase 3   ─────────  8-12 週   進階分析
                                 ▸ What-if 模擬
                                 ▸ 贏單率預測 / AI 智慧定價
                                 ▸ 多級簽核 + reviewer
                                 ▸ ML 預測警示

Phase 4   ─────────  持續迭代  IT / 教育訓練 / 新類別
                                 ▸ 客戶報價系統 API 對接
```

**Pilot**:Phase 1 完成後選 1-2 個真實報價案陪跑驗證

---

## Slide 22 — 需要業務部配合

| 任務 | 時程 |
|------|------|
| 確認 Multi-PM 名單(DPM/BPM/MPM/EPM) | 1 週 |
| 確認 RACI 矩陣(16+ deliverable A/R 角色) | 1 週 |
| Review 業務報價標準流程模板(對齊 OIBG 8 stages) | 1 週 |
| 推薦 Pilot 候選報價案 | 2 週 |
| 提供前 20 大戰略客戶名單 | 2 週 |
| 提供「業務」「PM」「主管」初始授權名單 | 2 週 |
| 業務部認可戰情會議室文化(已讀回執 / Stage Gate) | 1 週 |

**會議結束帶回部門討論**:

- 「機密 vs 非機密」二分對業務實務直觀嗎?
- Multi-PM(DPM/BPM/MPM/EPM)分工是否符合實況?
- 哪位 PM 願意陪跑 Pilot?

---

## Slide 23 — 待業務主管確認的 6 件事

```
☐  決議 1
   業務報價會在 Phase 1 ship,後續加其他類別
   業務感受不變,只是底層共用 — OK?

☐  決議 2
   多 Channel 戰情會議室(類 Slack/Teams)
   解決訊息找不到 / 跨組干擾 — OK?

☐  決議 3
   Multi-PM(DPM/BPM/MPM/EPM)+ RACI 對齊 OIBG flow
   各 PM 帶自己 team — OK?

☐  決議 4
   Stage Gate(任務完成 → 業務確認)
   業務統合決策節點 — OK?

☐  決議 5
   結案後自動分兩份(完整版 / 脫敏版),自動入 KB
   脫敏不可逆 — OK?

☐  決議 6
   3 個月內 Phase 1 上線 + Pilot 驗證
   時程合理嗎?
```

**6 項確認後 → Phase 1 啟動**

---

## Slide 24 — 下一步

```
今天 ───── 得到決議
W1   ───── 收集 review 回饋,規格定案
W2   ───── Pilot 案 + 角色名單
W3   ───── Kickoff Phase 1 開發
W6   ───── Phase 1 內部測試
W7   ───── Pilot 上線驗證
W8   ───── 正式發布給業務
       ↓
Phase 2 戰情會議室強化 + KB pipeline + 域內通訊
Phase 3 進階分析(What-if / 贏單率預測)
```

---

## Slide 25 — Q & A

```
        Q & A

   謝謝!歡迎現場提問
   (下一頁有 8 個預期 Q&A)


資訊部聯絡人:[email 待填]
規格書:docs/projects-platform-spec.md
RFQ flow 解釋:docs/oibg-rfq-flow-explained.md
```

---

## Slide 26 — 預期常見問題(1/2)

**Q1 業務目前沒在用 Cortex,會很難學嗎?**
A 1 小時操作培訓 + 說明書,介面類似一般聊天軟體;業務只要記「Sidebar → 專案管理」一個入口。多 channel 模型對業務直覺(類 Webex 群組)。

**Q2 通用化會不會讓業務失去「報價系統」的特色?**
A 不會。業務看到的 sidebar 仍叫「業務報價」,點進去就是戰情會議室、廠區比較、24h SLA banner、Tier 顯示等專屬武器。底層共用是為了讓未來新功能更快。

**Q3 Multi-PM 對業務概念複雜嗎?**
A 對齊 OIBG flow 既有的 DPM/BPM/MPM/EPM 分工 — 業務本來就是這樣協作,只是沒有系統支援。系統做的是把這個邏輯固化,而不是新發明概念。

**Q4 Stage Gate 會不會卡流程?**
A 不會。業務 + 業務助理總有一人在線,手機 1 click 就 gate。緊急情況 admin 可協助。對應 RFQ flow 的「集合會議確認」這環節 — 本來就要做,只是現在有 UI。

---

## Slide 27 — 預期常見問題(2/2)

**Q5 Dependency Deadline 怎麼設?業務會嫌麻煩嗎?**
A 預設模板已經設好(對應 RFQ Schedule example);業務建專案直接用,只在客戶異動時自動重算。第一次設好後續自動 carry over 到新專案。

**Q6 機密欄位太多項要勾,業務會不會嫌麻煩?**
A 系統依「業務報價」類別預設一組(金額 / 毛利 / 成本明細已勾),建立專案時直接過,要改才動。多數案件預設值就夠用。

**Q7 24 小時 SLA 是組織挑戰,只有系統能解嗎?**
A 系統解一半:資訊集中、AI 秒查、進度透明、Stage Gate 即時、Dependency 自動推算。剩下一半是組織決策速度。但「資訊散落 → 整合」這塊系統能解 80%。

**Q8 結案脫敏後不可逆,萬一脫敏錯了怎麼辦?**
A 結案前 PM 預覽脫敏版,確認後才入庫;法務每月抽查;發現錯誤 → 重跑脫敏,舊版本標記過期 + 重新入庫。永遠不影響原機密版。

— 投影片結束 —
