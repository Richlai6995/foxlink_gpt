# 貴重金屬價格情報平台 — 完整投影片文字稿(Phase 5 全 ship 版)

> 產出日期:2026-04-29
> 對應狀態:Phase 5 + 4/29 重構(by-source 新聞拆分 + 職責分工 + retention)
> 聽眾:採購部、IT、跨部門主管
> 風格:每張頁面留白,大字重點;細節放「附註」區供會後查閱
>
> 對應使用者手冊:`server/data/pmHelpSeedData.js` (book code = `precious-metals`)
> 對應內部規劃:[precious-metals-plan.md](./precious-metals-plan.md)
>
> 取代舊投影片:採購部 Briefing 2026-04-24 版(原 14 頁,當時平台尚未 ship)
> 一頁 summary 版見:[precious-metals-onepager-slide.md](./precious-metals-onepager-slide.md)

---

## 📑 術語對照(放會議桌面)

| 詞 | 白話解釋 |
|----|---------|
| Cortex | 公司內部 AI 助理平台(原 FOXLINK GPT) |
| KB | Knowledge Base 知識庫 |
| RAG | Retrieval-Augmented Generation,讓 AI 寫東西前先查資料 |
| MAPE | Mean Absolute Percentage Error,預測誤差率(越低越準) |
| LLM | Large Language Model,大型語言模型(Gemini Pro / Flash) |
| Adaptive Card | Webex / Teams 用的互動式訊息卡(可點按鈕) |
| ACK | Acknowledge,確認收到(警示已處理) |
| ERP | 企業資源規劃,管 BOM / 採購 / 庫存 |
| `ReadOnlyPoolProxy` | 唯讀資料庫連線池,只能 SELECT 不可能誤改 ERP |
| LBMA | London Bullion Market Association,倫敦黃金市場協會 |
| WPIC | World Platinum Investment Council,鉑金投資委員會 |
| JM | Johnson Matthey,PGM(鉑族金屬)權威機構 |
| RSS | 結構化新聞訂閱格式(每篇文章獨立 entry) |
| dedupe | 去重 |
| dry_run | 預演不寫入,只算「會做什麼」 |
| sparkline | 用 Unicode `▁▂▃▄▅▆▇█` 在純文字裡畫迷你折線圖 |

---

## Slide 1 — 封面

```
P R O C U R E M E N T   I N T E L L I G E N C E

  貴重金屬價格情報平台
  讓採購從「被動查價」到「主動預警」

  Phase 5 全部 ship · 4/29 重構完成
  資訊部 · 2026-04-29

  Au 黃金 · Ag 白銀 · Pt 鉑金 · Pd 鈀金
       + 7 個關聯金屬(Cu/Al/Ni/Sn/Zn/Pb/Rh)
```

**副標**:寄生在 Cortex 上,0 新系統 / 0 新帳號 / 採購不用學新東西
**核心賣點**:從「事後查、手動整、被動等」 → 「主動推、AI 整、即時答」

---

## Slide 2 — 為什麼要做這個

### 真實事件(已發生)

> 「前陣子金價大漲,採購成本跟著大增。事業單位回頭問:**為什麼沒提前預警?下個月還會漲嗎?**」
> 採購手上只有昨天查到的 LBMA 報價和一疊 Email,**很難給出有依據的回答**。

### 系統性的三個問題

| 問題 | 講白話 |
|------|--------|
| **被動性** | 事件發生後才知道,反應延遲數小時至數天 |
| **手工彙整** | 大量時間花在「資料搬運」而非「決策分析」 |
| **預測無佐證** | 對事業單位的預測全憑經驗,無數據、無信心區間、無歷史類比可引用 |

### 平台的解法 — 一句話

> **把「採購靠 Excel + 經驗 + 銀行口頭」的流程,換成「Cortex 自動跑 + AI 寫好 + Webex 推給你」。**

---

## Slide 3 — 平台一頁全貌

### 寄生在 Cortex 上的 10 大組件(Phase 1-4 六個 + Phase 5 四個)

```
[1] 9 個 [PM] 排程任務        [6] Webex Bot 推送 + 完整對話(Phase 5 C)
[2] 3 個知識庫(原始/新聞/分析) [7] Forecast 校驗 + Self-Improve(Phase 5 B)
[3] AI 戰情(3 視角 ~20 Design) [8] 健康監控 + Token 預算(Phase 5 F)
[4] Multi-Agent Workflow         [9] ERP 真連線同步 framework(Phase 5 A)
[5] 文件模板(日/週/月報 docx)  [10] 資料保留 retention(2026-04-29)
```

### 與一般 Cortex 對話的差別

| 一般 Cortex 用法 | 貴金屬平台用法 |
|-----------------|---------------|
| 使用者主動問 → AI 即時回 → 看完就走 | 系統**主動**抓資料 → 排程**主動**寫分析 → 推到信箱 / Webex / 戰情 → 採購只需「審閱 + 決策」 |
| 「今天台積電股價多少」 | 每天 18:00 自動產「金屬市場日報.docx」附在信箱裡 |

> **這是個「會自己工作的智慧採購助理」,不是「等你問才動的 ChatGPT」。**

---

## Slide 4 ★ — 採購 6 大情境:現在 vs 平台

| 情境 | 現在怎麼做 | 痛點 | 平台怎麼做 | 所需時間 |
|------|-----------|------|----------|---------|
| **早上看盤** | 開 LBMA → 台銀 → Bloomberg → Excel 彙整 → 貼 Webex | 30 分鐘易漏 | 開 `/pm/briefing`,11 金屬報價 + 缺金屬警示 + AI 綜述 + 5 Tab 一畫面 | **5 秒** |
| **事業單位問下月走勢** | 憑經驗 + 銀行口頭 + 上週新聞 | 沒依據被質疑 | `/pm-deep [問題]` 跑 5-Agent workflow,出含預測區間 + 信心度 + 歷史類比的整合報告 | **30-60 秒** |
| **金價大漲/大跌** | 銀行打電話通知才知道 | 錯過反應時機 | Webex DM Bot 1 秒回 Adaptive Card + AlertsBanner + email | **事前** |
| **寫月度採購分析** | 手工 Excel 彙整 1-2 天 | 公式易錯 | 月報排程自動產 docx + AI 寫「為什麼這個月買在這個價」 | **0 工時** |
| **重大新聞研判** | Email 堆積、靠主管轉發 | 漏看消化慢 | 5 個 by-source 新聞 task 每日抓 30+ 篇,日報 RAG 5-10 篇精選,情緒色標 | **自動** |
| **採購決策** | 憑感覺 / 銀行建議 / 主管口頭 | 依據薄弱 | `/pm-deep` + 戰情分位數 + 歷史類似情境 + AI 預測信心區間 | **即時** |

---

## Slide 5 — 採購一站式頁 `/pm/briefing`(主入口)

> sidebar 左側點「貴金屬情報」即可進入。**權限走 `precious-metals` 特殊說明書分享**:admin 加你進名單 = 自動開 PM Bot + 戰情 + KB 三件套。

### 7 層結構(2026-04-29 起)

```
┌─ 1. 報價 banner(11 金屬 sticky)
│     └─ 缺金屬警示橘條:「2026-04-29 報價不完整 — 今日只抓到 X/11」
│     └─ 個別金屬 stale 黃框 + MM-DD 日期標(LLM 抓不到 → 回退最近一筆)
│
├─ 2. 宏觀指標 banner(2026-04-29 加)
│     └─ DXY / VIX / 10Y / WTI 單行展示
│
├─ 3. 近期警示 banner(2026-04-29 加)
│     └─ 7 天未 ack 警示卡 + 一鍵 ack
│     └─ 全部 ack 收成 ✅ 一行,沒警示時不佔位
│
├─ 4. 今日 AI 綜述
│     └─ 從日報撈 250 字摘要 + [看完整日報] + 👍 thumbs feedback
│     └─ fallback 文字動態抓「實際排程時間」(不再寫死 18:00)
│
├─ 5. 排程資料健康度面板
│     └─ 一頁看完所有 [PM] 排程跑況
│     └─ 偵測「跑成功但 0 inserted」silent failure → 警示條
│     └─ LLM 出 schema 沒的欄位被 silent drop → 顯示 ⚠ 提示
│     └─ 預設摺疊只一行,有 alert 才展開
│
├─ 6. 5 個 Tab(內容區)
│     ├─ 📰 新聞列表(預設)— 篩選器 + 卡片 + 雙日期 + 情緒色標
│     │     └─ [看完整內容] modal:並排 LLM 繁中摘要 + KB 原文 1500-3000 字
│     ├─ 📊 歷史價格 — 完整資料表(20 欄) + line chart 疊預測線 + 3 KPI 卡片
│     │     └─ Y 軸自動切 log(>3 條線時),CSV 匯出 client-side
│     ├─ 📅 週報 / 📈 月報 — markdown 渲染 + docx 下載 + 歷史 dropdown
│     └─ ✏️ Prompt 審核(整合進來,sidebar 不再多入口)
│
└─ 7. Top bar:[⚙ 我的偏好] [⬇ 匯出 CSV]
       └─ 偏好寫 DB(pm_user_preferences),跨裝置同步
```

---

## Slide 6 — 9 個 [PM] 排程任務(2026-04-29 重構後)

### ① 新聞抓取(by-source 5 個 task,B+E 策略)

| Task | 排程 | 資料源 | 抓取量 | 備註 |
|------|------|-------|-------|------|
| `[PM] 新聞 Mining.com` | 每日 09:00 | Mining.com /feed/ RSS | 15-20 | **主源**(36+ items) |
| `[PM] 新聞 Nikkei` | 每日 09:30 | 日經中文 大宗商品 | 5-10 | 政經視角 |
| `[PM] 新聞 SMM` | 每日 10:00 | 上海有色網 | 5-10 | 中國市場視角 |
| `[PM] 新聞 MoneyDJ` | 每日 10:30 | MoneyDJ 商品原物料 | 5-10 | 台灣財經 |
| `[PM] 新聞 PGM評論` | **週一 + 週三 09:30** | WPIC + matthey | 1-5 | **60 天 cutoff** |

### ② 報價 + 宏觀

| Task | 排程 | 抓什麼 |
|------|------|-------|
| `[PM] 全網金屬資料收集`(master) | 每日 06:00,Pro | **純抓 11 金屬報價**,寫 `pm_price_history` + `_kb_doc` 報價快照(2026-04-29 砍掉新聞段) |
| `[PM] 總體經濟指標日抓` | 每日 08:30,Flash | DXY / VIX / 10Y / WTI / 黃金 ETF 持倉 → `pm_macro_history` |

### ③ 報告生成

| Task | 排程 | 產出 |
|------|------|------|
| `[PM] 每日金屬日報` | **每日 18:00**,Pro(2026-04-29 統一收口) | 從 PM-新聞庫 RAG 5-10 篇精選 + 報價 + 宏觀 → 寫日報 + forecast_history + docx + **唯一發 email 的 task** |
| `[PM] 金屬市場週報` | 每週一 08:30,Pro | 過去 7 天 RAG → 週報 + docx |
| `[PM] 金屬市場月報` | 每月 1 號 08:30,Pro | 過去一個月 → 月報 + 為什麼這個月買在這個價 + docx |

> 📌 **跨 task dedupe** — 新增 `{{news_seen:source:days:limit}}` placeholder,LLM 抓之前先比對已抓 url 主動跳過,不只靠 url_hash 後端 dedupe。

---

## Slide 7 — 系統內部 Cron(Phase 5,無 UI 開關)

| Cron | 頻率 | 做什麼 |
|------|------|-------|
| `pmForecastAccuracyService` | 每 24h | 比 7 天前 forecast vs 今日實際 → 寫 MAPE / in_band |
| `pmPromptSelfImproveService` | 每月 1 號 | 撈 30 天最差 + thumbs-down → LLM 產 v2 prompt → review queue |
| `pmSourceHealthService` | 每 6h | 18 sources HEAD/GET 巡檢,連 3 失敗 → email admin |
| `pmTokenBudgetService` | 每 1h | token_usage by owner 平攤給當日 [PM] 任務 |
| `pmKbMaintenanceService` | 每 7d | 掃 PM-新聞庫 > 90d chunks → soft archive |
| `pmWebexPushService` | 每 1 分鐘 | 比 schedule_hhmm 推送訂閱 Snapshot Card |
| `pmErpSyncService` | 每 5 分鐘 | 找到期 active jobs 跑(BOM / 採購 / 在途) |
| **`pmRetentionCleanup`(2026-04-29 加)** | **每日 03:00(可調)** | 7 entity 過期清理(`pm_news` / KB / forecast / alert) |

> **特性**:全部 idempotent,server 重啟不會重複執行。`schedule_hhmm` 在 UI 改 → server 立即 reload cron(不用重啟)。

---

## Slide 8 — AI 戰情 3 視角 ~20 Design

### 🛒 採購視角(每日盯盤主戰場)

- 11 金屬今日報價 / 4 大貴金屬 30 天趨勢 / 基本金屬 30 天趨勢
- 未來 7 天預測走廊(mean + 80% 信心區間)
- 過去 24h 新聞情緒分布
- 7 日宏觀指標趨勢
- **當前在庫 + 在途 vs 7 日預測缺口**(Phase 5 A)

### 👔 主管視角(月度檢視)

- 11 金屬月變化 KPI / 最新報告摘要 / 30 天警示記錄
- 模型預測 vs 實際
- **各金屬 30 天 MAPE 排行**(Phase 5 B)
- **近 12 月各金屬月度採購量趨勢**(Phase 5 A)
- **採購均單價 vs 市場價**(採購擇時是否打中低點)
- **本月安全庫存達成率**

### 🔬 分析師視角(IT / 平台維運觀察)

- 同金屬多源價差(台銀 vs LBMA vs Metals-API)
- 估算誤差追蹤
- 預測 MAPE 滾動 60 天 / 預測 vs 實際 w/ in_band

---

## Slide 9 — 對話 Agent + Deep Workflow

### 一般對話(Cortex chat,RAG 自動)

> 「現在金價多少?與上週同期比?」 — 1 秒回
> 「未來 7 天黃金預測區間?」 — 直接讀 forecast_history
> 「上週月報講了什麼?」 — RAG PM-分析庫
> 「本月鈀金為什麼大跌?」 — RAG PM-新聞庫 + 分析

### 深度分析:`/pm-deep [問題]`

```
   start ─┬─→ news_agent  ──┐
          ├─→ macro_agent ──┼─→ risk_agent ─→ synthesizer ─→ output
          └─→ tech_agent  ──┘
```

| Agent | 角色 | 模型 |
|-------|------|------|
| news_agent | 24-48h 新聞 + 情緒判斷 + 影響時間框架 | Flash 並行 |
| macro_agent | 解讀 DXY/VIX/10Y 對標的影響 | Flash 並行 |
| tech_agent | 技術面分析(MA / RSI / 支撐壓力) | Flash 並行 |
| risk_agent | 收三方結果 → 風險矩陣 | Flash |
| synthesizer | 寫整合分析報告(可直接附簽核) | **Pro** |

> 30-60 秒跑完 → 截圖 / 匯出 PDF 附簽核單,**主管秒簽**。
> 完全 LLM-based,無 Python ML 依賴(預測精度目標 MAPE < 3%,採購決策級非投資級)。

---

## Slide 10 — Webex Bot 完整對話(Phase 5 C)

> 不想開瀏覽器、出差路上、會議空檔 — 直接在 Webex DM 對 PM Bot 打中文/英文,**1 秒回 Adaptive Card**(short-circuit 不打 LLM,**零 token 成本**)。

### 4 種 Card + 訂閱

| 打什麼 | 回什麼 |
|-------|-------|
| `top 5` / `快照` / `今日金價` | **Snapshot Card** — Top 5 metals 報價 + 漲跌% + Forecast 按鈕 |
| `Au` / `銅` / `Cu` / `金` | **Latest 報價 Card** — 11 金屬代碼別名,中/英/縮寫都認 |
| `銅 預測` / `Cu forecast` / `Au 7 day` | **Forecast Card** — 7 天預測 + 信心區間 + Unicode sparkline ▁▂▃▄▅▆▇█ + What-if 按鈕 |
| `銅 +10%` / `what if Cu -5%` | **What-if Card** — 當前 vs 模擬價 + JOIN pm_bom_metal 算 cost impact |
| `/pm help` | **Help Card** |

### 訂閱每日 Snapshot 推送

> 進 web `/pm/review` 右上「Webex 訂閱」按鈕 → modal 設 `kind=daily_snapshot` + `schedule_hhmm`(如 `09:00`)。
> 每分鐘 cron 比時間推 4 大貴金屬 + 4 基本金屬 Snapshot Card。
> `last_sent_date` 防一日多發,server 重啟 idempotent。

> **PM intent 沒中(99% 一般對話)→ fall through 到既有 LLM 流程,有 RAG 也有對話歷史**。所有 PM intent short-circuit 也會寫 `chat_messages` → web chat session 看得到完整 Webex 對話歷史,不分裂兩處。

---

## Slide 11 — Forecast 校驗 + Self-Improve Loop(Phase 5 B)

### 問題 — 沒有的話

> LLM 預測沒人知道準不準,信任會崩;沒回饋機制 prompt 永遠不會改進。

### 解法 — 三層閉環

```
[每 24h]   pmForecastAccuracyService
           比 7 天前 forecast vs 今日實際
           → 寫 pm_forecast_accuracy(abs_error / pct_error / in_band)
           → 連 3 天 |pct_err| > 30% → pm_alert_history(rule_code='pm_mape_streak')

[每 user]  PmFeedbackThumbs(報告 / forecast 頁通用 component)
           thumbs up/down + comment
           UNIQUE per user × target,可重投覆蓋

[每月 1]   pmPromptSelfImproveService
           撈 30 天最差 + thumbs-down → 餵 Pro 產 v2 prompt
           → pm_prompt_review_queue(7 天 dedup)

[人類]     /pm/briefing → Prompt 審核 tab
           side-by-side 行 diff(v1 vs v2)+ LLM 寫的 rationale + eval summary
           ⚠️ approve 才會 UPDATE skills.system_prompt(LLM 永不直接改)
```

### 看哪

- 主管視角戰情:**各金屬 30 天 MAPE 排行**
- 分析師視角戰情:**預測 MAPE 滾動 60 天** + **預測 vs 實際 w/ in_band**

### MAPE 目標

> < 3% 採購決策級(本平台目標)
> > 5% 警覺
> > 10% 連續多日 → 找 IT 調 prompt 或考慮換模型

---

## Slide 12 — 資料保留設定(2026-04-29 加)

> 為避免 `pm_news` / KB chunks 無限累積撐爆 Oracle / 拖慢檢索,**每個資料 entity 各自設天數**;留空 = 永久。

### 預設天數

| Entity | 預設 | 為什麼 |
|--------|------|-------|
| `pm_news` + KB:PM-新聞庫 | 180 | 同步清避免 SUMMARY 點開找不到 KB 全文 |
| KB:PM-原始資料庫 | 14 | 報價快照只看「最近怎麼動」 |
| KB:PM-分析庫 + `pm_analysis_report` | **永久** | LLM 報告是趨勢分析的歷史軌跡 |
| `pm_price_history` | **永久** | 戰情 line chart 的根基 |
| `pm_macro_history` | **永久** | 宏觀對金屬影響需長期觀察 |
| `forecast_history` | 90 | MAPE 校驗最多看 30-60 天 |
| `pm_alert_history` | 180 | 半年警示記錄,事後追溯 |

### UI / 排程

- AdminDashboard → 系統管理 → PM 平台設定 → **資料保留設定** section
- 每個 entity 一行:總筆 / 最舊日期 / dry-run 會清幾筆 / 保留天數 input
- 「立即執行清理」按鈕(confirm 後實際 DELETE,顯示 result summary)
- daily 凌晨 03:00 預設跑 — 「啟用 / 時 / 分」可調,套用後 server **立即 reload cron**(不重啟)
- KB 連動清:`kb_chunks + kb_documents + 重算 knowledge_bases stats`(不會孤兒)

> ⚠️ **後端硬防護**:即使誤填「`pm_price_history` 7 天」也會被拒(在 `RETENTION_PROTECTED` 集合)。要砍 → 走 DBA 手動 truncate。

---

## Slide 13 — PM 平台健康監控(Phase 5 F,4 sub-tab)

> AdminDashboard → 系統管理 → **PM 平台健康** tab。

| Sub-tab | 看什麼 | 怎麼動作 |
|---------|-------|---------|
| **F1 Tasks** | per-task 7/14/30 天 success / avg duration / 總 tokens / 成本 | 點「N 失敗」展開最近 20 次 error_msg + response_preview;**行內編輯 `daily_token_budget`** 即時生效 |
| **F2 Token 預算** | per-task daily budget vs 當日已用 / 是否 paused | 手動 Clear pause;隔日 00:00 自動解除 |
| **F3 Source 監控** | 18 個 PM 來源連通狀態(每 6h 巡檢) | 立即檢查;連 3 失敗自動 disable + email admin(24h cooldown) |
| **F4 KB 維護** | PM-新聞庫 chunks,> 90d 候選 archive | dry-run / 真執行 / restore 三按鈕 |
| **F5 Cost** | per-task 月度 token 成本 + per-day × per-model | 標註「估算」(以 owner_user_id 平攤) |

### 預算估算參考

> Pro 一次完整月報約 **80k-150k tokens**;Flash 一次新聞抓取約 **20k-40k tokens**。
> 日報 budget 建議 `300000`,週報 `500000`,月報 `1000000`。

---

## Slide 14 — ERP 真連線同步(Phase 5 A)

> 解決 Phase 1-4「BOM / 採購歷史靠手動 CSV」採購不會買單的問題。
> **通用 framework**:`source_query` SQL → `mapping_json` → `upsert_mode` → 寫 `pm_*` 表。

### 3 個 auto-seed 範本(全 `is_active=0` + `is_dry_run=1`,升級不會誤撈)

| Job | 預設頻率 | 寫到 | 取代什麼 |
|-----|---------|------|---------|
| `[PM-ERP] BOM 金屬含量同步` | 每日 | `pm_bom_metal` | 手動 CSV |
| `[PM-ERP] 採購單歷史 12 月` | 每日 | `pm_purchase_history` | 純新增 → LLM「採購節奏 vs 市場價」 |
| `[PM-ERP] 在途 + 安全庫存` | 每 6h | `pm_inventory` | 純新增 → 戰情「在庫 vs 7 日預測缺口」 |

### 安全機制(三層)

1. `target_pm_table` 強制 `pm_*` 開頭(防誤刪 ERP)
2. ERP pool 走 `ReadOnlyPoolProxy`(只能 SELECT,不可能誤改)
3. `MAX_ROWS_PER_JOB=100k` 上限

### 操作步驟(admin)

```
1. AdminDashboard → 「PM ERP 同步」tab
2. 編輯範本 job → 改 source_query SQL(EBS schema 為範本,各廠 customization 必改)
3. 按「Preview」跑 SELECT 不寫,看前 10 row
4. 對齊 mapping_json(ERP 大寫 → PM 小寫)
5. 切 is_dry_run=0 + is_active=1 → 每 5 分鐘 tick 自動跑
6. 「Logs」看最近 30 次執行 status / rows / duration / error / sample_row
```

---

## Slide 15 — 採購典型每日流程(建議節奏)

| 時間 | 動作 | 用什麼 |
|------|------|-------|
| **08:50 通勤抵達** | Webex 已收到「貴金屬今日 snapshot」Card,手機滑一眼有沒有大事 | Webex Bot 訂閱 |
| **09:00 開電腦** | 進 `/pm/briefing` — 報價 banner 一眼掃關注金屬 | 採購一站式頁 |
| **09:00-10:30** | 5 個 by-source 新聞 task 陸續跑完,新聞 tab 已有當日內容 | 排程自動 |
| **下午** | 事業單位問「下週銅?」→ Cortex chat 用 `/pm-deep 銅`;或進戰情看走勢 / 預測 | Multi-Agent Workflow |
| **18:00 之後** | 頂部「今日 AI 綜述」自動更新,點 [看完整日報] 看 LLM 對「為什麼今日這樣動」的解讀 | 日報 task |
| **隨時** | 下決策前對 forecast 按 thumbs;事業單位回覆問題附 `/pm-deep` 截圖 | Feedback / Workflow |
| **週一** | 進 `/pm/briefing` 第二 tab「週報」看上週總結 + 下週展望 | 週報 task |
| **月初** | 看「月報」+ 轉寄事業單位(從報告 tab 下載 docx) | 月報 task |
| **月中**(若有 pending) | Prompt 審核 tab 紅色 badge → 點進去 approve / reject LLM 想改的 prompt | Self-Improve loop |

> 🎯 **目標體驗**:採購早晨進這個頁面 **5 分鐘**搞定盯盤 + 新聞 + AI 重點 → 取代舊流程 30 分鐘。

---

## Slide 16 — 為什麼在 Cortex 上做(不另建系統)

| 比較 | 另建新系統 | 在 Cortex 上擴充 ✓ |
|------|-----------|-------------------|
| 採購學習成本 | 新網址 / 新帳號 / 新介面 | 跟現用 AI 對話同一地方 |
| 上線時間 | 6 個月+ | **10 週**(已 ship) |
| 手機 / 出差 | 要另裝 App | Webex 直接收 |
| 與其他 AI 整合 | 孤島 | 採購 / 研發 / 法務 AI 同一入口 |
| 權限 / 稽核 | 重建一套 | 公司 AD 現有權限延伸 |
| 維運成本 | 獨立 K8s / DB / CI | 用 Cortex 既有基礎,**3 年 TCO 省 70%+** |

### 關鍵技術選擇

> **不引入 Python**:外部規劃書原建議用 Darts/PyTorch,但本平台選純 LLM(Gemini Pro)當預測 baseline + tfjs-node LSTM 備援。
> 避免「為了 ML 引入 Python = 新 Dockerfile + 新 K8s manifest + 新 CI/CD 分支」。
> 若財務避險硬要求 MAPE < 1.5%,Phase 3+ 才評估 Python MCP Server(獨立部署,主應用零改動)。

---

## Slide 17 — 資料安全與治理

### Q1:集團採購均價是機密,會不會被別人看到?

> 兩層分離 — 公開資料(市場金價,全員可看) vs **集團採購資料**(走 ERP 權限,僅採購可看)。

### Q2:事業單位會不會知道「我這次買貴了」?

> 採購對外給的報表是月度彙總,不是每筆採購單。單筆交易仍走 ERP 既有簽核。

### Q3:供應商會不會透過系統知道我們的價格底線?

> 系統不對外開放,僅集團內部使用。所有帳號走公司 AD,外部無法登入。

### Q4:AI 會偷改 prompt 影響輸出嗎?

> **AI 永不直接改** — `pmPromptSelfImproveService` 只能進 `pm_prompt_review_queue`,**人類 approve 才會 UPDATE `skills.system_prompt`**。所有改動有 audit log。

### Q5:採購歷史會被丟進 AI 訓練嗎?

> 不會。模型是既有授權模型(Gemini)。採購資料僅用於「查詢當下參考」,不訓練、不出公司網域。

### 額外保障

- 所有查詢有稽核日誌,異常行為(深夜大量下載)自動告警
- ERP 連線走 `ReadOnlyPoolProxy`,**只能 SELECT 不可能誤改**
- Token 成本 per-task `daily_token_budget`,當天爆了自動 pause(隔日解除)

---

## Slide 18 — 預期 FAQ(預先準備答案)

| Q | A |
|---|---|
| **AI 預測會取代採購員的判斷嗎?** | 不會。AI 提供數據、分析、建議;決策還是採購員 + 主管。每份預測附信心區間 + 歷史 MAPE。 |
| **AI 預測錯了、買錯,誰負責?** | 採購仍走既有簽核;預期誤差 MAPE 目標 < 3%,**非投資級**(投資級需 < 1.5%,本平台不做)。免責文字法務已備案。 |
| **出差 / 在外面也能用嗎?** | 可以。Webex Bot 手機就能問 `top 5` / `Au 預測` / `銅 +10%`。 |
| **系統報價跟我查的網站不一樣怎麼辦?** | 整合 LBMA / 台銀 / Westmetall / JM RSS 多來源,**差異 > 0.5% 自動告警**(分析師視角戰情看)。發現異常請回報。 |
| **如果系統掛了,採購怎麼辦?** | 系統是輔助工具,不是流程卡關點。故障時可回手動查網站。目標可用率 > 99%。 |
| **集團採購歷史會被 AI 訓練嗎?** | 不會(見 Slide 17)。 |
| **跟 ERP 採購模組什麼關係?** | Phase 1 單向讀取(走 ReadOnlyPoolProxy)。Phase 2 建 PR/PO 時可選擇附加 AI 市場分析快照。**不修改 ERP 任何資料**。 |
| **預測準不準怎麼知道?** | 進主管視角「各金屬 30 天 MAPE 排行」/ 分析師視角「滾動 60 天」+「預測 vs 實際 w/ in_band」(80% 信心區間命中率)。 |
| **要新增第 12 個金屬(例鋰、稀土)?** | 找 IT 評估資料源 → 改排程 prompt 加金屬代碼 → 同步加戰情 Design。**勿自行改排程 prompt**。 |
| **要新增第 6 個新聞源?** | 複製 `buildNewsXxxTask` 範本 + 共用 pipeline + 註冊進 `BY_SOURCE_NEWS_TASKS`。**不要塞回 master scrape**(那是純報價)。 |

---

## Slide 19 — 現在已可用的(2026-04-29 狀態 checklist)

```
✅ 9 個 [PM] user-facing 排程
   ├─ 5 個 by-source 新聞 task(B+E 策略)
   ├─ master scrape 純報價 + 宏觀
   └─ 日 / 週 / 月報

✅ 3 個 KB(PM-原始 / PM-新聞 / PM-分析)
   └─ 全部接 retention(180/14/永久)

✅ AI 戰情 ~20 個 Design(採購 / 主管 / 分析師三視角)

✅ /pm/briefing 7 層 + 5 Tab
   └─ 含「看完整內容」modal、缺金屬警示、stale 黃框

✅ /pm-deep 5-Agent workflow

✅ Webex DM NL 對話 + 4 種 Adaptive Card + 每日訂閱推送

✅ Forecast MAPE 校驗 loop + 採購員 thumbs feedback
   └─ 每月 LLM 自動產 v2 prompt 進審核 queue,人類 approve 才上線

✅ ERP 真連線同步 framework + 3 範本 job(BOM / 採購 / 在途)

✅ PM 平台健康監控 4 sub-tab(Tasks / Token / Source / KB / Cost)

✅ 資料保留 7 entity 各自設天數 + 排程時間可調

✅ Token 預算 per-task,爆了自動 pause / 隔日解除
```

---

## Slide 20 — 結語

```
採購不再是「事件發生後才知道」
而是「事件發生前就收到提醒」

從「事後查、手動整、被動等」
   →
「主動推、AI 整、即時答」

────────────────────────────

集團電鍍四金屬月度成本可被預警
日報 / 週報 / 月報自動產出 0 工時
出差用手機 Webex 1 秒問到答案
所有預測有信心區間 + MAPE 校驗 + 人為審核
ERP 真連線、不修改任何 ERP 資料

謝謝
歡迎現場提問
```

**貴重金屬價格情報平台 · 資訊部 · 2026-04-29**

---

> ## 附註 — 對應投影片的程式碼 / 文件位置
>
> | 投影片 | 對應檔案 |
> |-------|---------|
> | Slide 5(briefing 7 層) | [client/src/pages/PmBriefingPage.tsx](../client/src/pages/PmBriefingPage.tsx) |
> | Slide 6(9 排程) | [server/services/pmScheduledTaskSeed.js](../server/services/pmScheduledTaskSeed.js) |
> | Slide 7(內部 cron) | [server/server.js](../server/server.js) 啟動 wire |
> | Slide 9(/pm-deep) | [server/services/pmWorkflowSeed.js](../server/services/pmWorkflowSeed.js) |
> | Slide 10(Webex Bot) | [server/services/webexPmHandler.js](../server/services/webexPmHandler.js) + [webexPmCards.js](../server/services/webexPmCards.js) + [pmWebexPushService.js](../server/services/pmWebexPushService.js) |
> | Slide 11(Forecast 校驗) | [server/services/pmForecastAccuracyService.js](../server/services/pmForecastAccuracyService.js) + [pmPromptSelfImproveService.js](../server/services/pmPromptSelfImproveService.js) |
> | Slide 12(資料保留) | [server/services/pmRetentionCleanup.js](../server/services/pmRetentionCleanup.js) + `client/src/components/admin/PmSettingsPanel.tsx` |
> | Slide 13(健康監控) | [server/services/pmSourceHealthService.js](../server/services/pmSourceHealthService.js) + [pmTokenBudgetService.js](../server/services/pmTokenBudgetService.js) + [pmKbMaintenanceService.js](../server/services/pmKbMaintenanceService.js) |
> | Slide 14(ERP 同步) | [server/services/pmErpSyncService.js](../server/services/pmErpSyncService.js) + [pmErpSyncSeed.js](../server/services/pmErpSyncSeed.js) |
