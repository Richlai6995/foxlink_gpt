# 貴重金屬價格情報平台 — 內部實作規劃

> 對應外部規劃書:《貴重金屬價格趨勢與預測平台 v2.0（Cortex 整合版）》2026-04
>
> 本文是 **Cortex(本 foxlink_gpt 專案) 側的工程實作規劃**,不是外部規劃書的重寫版;
> 只記錄「在現有程式基礎上,接下來怎麼做」與「需要老闆/PM 拍板的決議事項」。

---

## 1. 規劃目標與邊界

外部規劃書把貴金屬情報平台定位為「寄生在 Cortex 上的一組 Skills + 排程 + AI 戰情 Project + KB + 文件模板」,不另建獨立系統。v2.0 三大主張:

1. 不重建,只擴充
2. 平台原生優於客製
3. 使用者在熟悉介面中受益

外部規劃書推估:MVP 6 週、Production 10 週、三年 TCO 約 324 萬 NTD(相比獨立建置的 1,136 萬)。

外部規劃書的業務論述偏「一般金融/投資情報平台」,**本文 §2 補上 foxlink 集團的實際業務脈絡**(電鍍製程原料採購),讓後續所有技術決策都對齊真實採購現況,而不是抽象需求。§3 以後才是工程實作決策。

---

## 2. 業務脈絡與採購現況痛點

本章基於 2026-04-24 與採購部訪談結果整理,是後續所有設計決策的基礎。

### 2.1 集團業務脈絡

Foxlink 集團業務涵蓋連接器、FPC、MHA(Metal Housing Assembly)、金屬件等,**電鍍製程會大量使用貴重金屬作為鍍層原料**:

| 金屬 | 主要用途 | 採購特性 |
|------|---------|---------|
| 金 (Au) | 連接器端子電鍍(接觸穩定) | 量大、價格最敏感 |
| 銀 (Ag) | 導電件電鍍 | 量大、波動較大 |
| 鉑 (Pt) | 特殊鍍層、催化應用 | 量較小、單價高 |
| 鈀 (Pd) | 取代金電鍍的降本方案 | 量中、供給易受汽車業衝擊 |

**四種金屬全部都是集團採購範圍**,不是單一金屬專案。

### 2.2 採購現況作業流程(As-Is)

| 步驟 | 目前怎麼做 | 耗時 / 痛點 |
|------|-----------|------------|
| 每日盯盤 | 手動開 LBMA 網頁 + 台銀網頁 + Bloomberg(若有) → Excel 彙整 → Webex 通知事業單位 | 每天約 30 分鐘,容易漏,格式不統一 |
| 回覆事業單位預測 | 憑經驗 + 銀行口頭意見 + 上週新聞 | 沒數據依據、**回應慢、被事業單位質疑預測不準** |
| 重大事件應對 | 銀行打電話通知,才開始查 | 已經錯過反應時機 |
| 採購決策 | 採購員憑感覺/銀行建議 → 主管簽核 | 依據薄弱,簽核時無量化數據支撐 |
| 月度報告 | 手工 Excel 整理過去一個月報價、均價、採購時點 | 1-2 天工時,公式易錯 |

### 2.3 核心痛點(Why Now)

**真實事件**:**前陣子金價大漲,採購成本跟著大增**。事業單位回頭問:「為什麼沒提前預警?下個月還會漲嗎?」採購手上只有昨天查到的 LBMA 報價和一疊 Email 通知,很難給出有依據的回答。

這暴露出三個系統性問題:

1. **被動性** — 事件發生後才知道,反應延遲數小時至數天
2. **手工彙整** — 大量時間花在「資料搬運」而非「決策分析」
3. **預測無佐證** — 對事業單位的預測全憑經驗,無數據 + 無信心區間 + 無歷史類比可引用

### 2.4 未來狀態(To-Be)四情境

對應外部規劃書 §6.2 情境,**實測後聚焦「採購視角」**(而非原規劃的採購/財務/投資/管理層四視角全開):

| 情境 | 使用者 | 解決的痛點 |
|------|-------|----------|
| A. 每日盯盤 | 採購員 | 開 Cortex 採購 Dashboard,四金屬即時價 + 預測 + 新聞摘要一畫面,**10 秒取代 30 分鐘** |
| B. 採購決策簽核 | 採購員 → 主管 | 對話問 AI「現在金價在近 30 天分位數?預測區間?」→ 截圖附簽核單,主管秒簽 |
| C. 重大事件應對 | 採購員(行動) | Webex Bot 主動推送,含「對集團採購成本推估影響」,出差也能收到 |
| D. 月度報告 | 採購主管 → 事業單位 | 排程自動產 PDF,含 AI 撰寫的「為什麼這個月買在這個價」解釋 |

### 2.5 主要使用者與決策鏈

採購部訪談確認的實際決策鏈,與外部規劃書原假設有差異:

| 角色 | 現況工作 | 本系統為其提供 |
|------|---------|--------------|
| **採購員** | 盯盤、詢價、下採購單、向事業單位回覆趨勢問題 | Dashboard、對話查詢、Webex 推送、決策分析截圖 |
| **採購主管** | 簽核採購單、月報審核、向高層交代成本異常 | 月報自動化、成本異常告警、全採購部 Dashboard |
| **事業單位**(內部客戶) | 向採購要求物料成本預估 | 採購轉寄的月報 / 特定事件影響評估 |

**與外部規劃書差異**:
- 外部規劃書假設財務部會深度參與(做避險),**實際訪談未被提及** → 財務 Dashboard 移至 Phase 3 視需求評估
- 外部規劃書假設「投資/資產配置」視角,**foxlink 採購不涉金融投資** → 該視角本專案不做
- 決策鏈較單純:**採購員自行判斷 → 主管簽核**,不拉財務 / 投資委員會

### 2.6 量化價值推估(推測,待 Phase 0 Demo 後調整)

以下數字為概估,需與採購主管對齊實際採購量後填入:

| 項目 | 推估年度影響 |
|------|------------|
| 採購員每日盯盤時間節省 30 分鐘 × N 位 × 220 工作日 | 年省 XX 人小時 |
| 月報從 1-2 天降至 1 小時 | 年省 20-40 人日 |
| 採購成本優化(依外部規劃書 0.3-0.8% 推估) | 視集團年度貴金屬採購總額,單月成本差可達 XX 萬 USD |

**關鍵是第 3 項**:金價大漲時如果系統提前 24 小時預警 + 建議暫緩採購,光一次事件的節省可能就覆蓋專案開發成本。

---

## 3. Cortex 現有能力盤點(2026-04-23 實測)

對照外部規劃書 §3 的假設清單,在本 codebase 驗證結果如下:

| 能力 | 外部規劃書假設 | 實測狀態 | 主要檔案 |
|------|--------------|---------|---------|
| 排程 cron + Prompt 變數 | ✅ 具備 | **完整** | [scheduledTaskService.js](../server/services/scheduledTaskService.js) L161-201 |
| Pipeline DAG(7 類節點) | ✅ 具備 | **完整** | [pipelineRunner.js](../server/services/pipelineRunner.js) |
| Skills 4 類型(Builtin/External/Code/Workflow) | ✅ 具備 | **完整** | [skillRunner.js](../server/services/skillRunner.js) — Code Skill 是真 Node.js subprocess,port 40100-40999,動態 npm install |
| MCP 4 傳輸 + RS256 JWT 身份轉發 | ✅ 具備 | **完整** | [mcpClient.js](../server/services/mcpClient.js);[mcp-user-identity-auth.md](mcp-user-identity-auth.md) |
| KB 向量+全文+混合檢索(+同義詞+multi-vector) | ✅ 具備 | **完整** | [kbRetrieval.js](../server/services/kbRetrieval.js);[kb-retrieval-architecture-v2.md](kb-retrieval-architecture-v2.md) |
| AI 戰情 NL→SQL + Design + Dashboard + 4 層 Data Policy | ✅ 具備 | **完整** | [dashboard.js](../server/routes/dashboard.js);[ai-dashboard-design.md](ai-dashboard-design.md) |
| 對話圖表(ECharts + 釘選圖庫 + 分享) | ✅ 具備 | **完整** | [chartSpecParser.js](../server/services/chartSpecParser.js);[chat-inline-chart-plan.md](chat-inline-chart-plan.md) Phase 1-5 全完成 |
| 文件模板(DOCX/XLSX/PPTX/PDF + JSON 填入) | ✅ 具備 | **完整** | [docTemplateService.js](../server/services/docTemplateService.js) |
| Webex Bot(outbound polling + Redis 鎖) | ✅ 具備 | **完整** | [webexListener.js](../server/services/webexListener.js) |
| Deep Research(多子問題) | ✅ 具備 | **完整** | [researchService.js](../server/services/researchService.js) |
| Token 計費 per profit_center | ✅ 具備 | **完整** | [tokenService.js](../server/services/tokenService.js) |
| 多模型路由(Gemini/AOAI/OCI) + reasoning_effort | ✅ 具備 | **完整** | [geminiClient.js](../server/services/geminiClient.js) |
| AD/SSO | ✅ 具備 | **部分** | LDAP env 已配置,auth 層仍為 in-memory UUID map,K8s 已用 Redis session |
| Data Policy Category 綁定 | ✅ 具備 | **待驗證** | schema 已建,查詢鏈路需實測 |
| **Forecast 校驗 loop**(Phase 5 B) | — | **完整** | [pmForecastAccuracyService.js](../server/services/pmForecastAccuracyService.js)、[pmPromptSelfImproveService.js](../server/services/pmPromptSelfImproveService.js) — 每 24h 算 MAPE、月初自動產 v2 prompt 進採購員 review queue |
| **ERP 真連線同步框架**(Phase 5 A) | — | **完整(範本 dry_run inactive)** | [pmErpSyncService.js](../server/services/pmErpSyncService.js)、[pmErpSyncSeed.js](../server/services/pmErpSyncSeed.js) — 通用 source_query → mapping → upsert,3 個 EBS 範本(BOM / 採購歷史 / 在途庫存) |
| **PM 健康監控 + Token 預算 + Cost**(Phase 5 F) | — | **完整** | [pmSourceHealthService.js](../server/services/pmSourceHealthService.js)、[pmTokenBudgetService.js](../server/services/pmTokenBudgetService.js)、[pmKbMaintenanceService.js](../server/services/pmKbMaintenanceService.js) — 18 sources 6h 巡檢、per-task daily budget、token cost 平攤、KB soft-archive |
| **Webex Bot 完整對話**(Phase 5 C) | — | **完整** | [webexPmHandler.js](../server/services/webexPmHandler.js)、[webexPmCards.js](../server/services/webexPmCards.js)、[pmWebexPushService.js](../server/services/pmWebexPushService.js) — NL intent + Adaptive Card + 每分鐘訂閱推送 |

**結論**:外部規劃書關於 Cortex 平台能力的假設 **95% 成立**,僅 2 項邊界需實測。**規劃書 §15「新增開發清單 81 人日」的估算在本 codebase 上大致可信**,除了 Python 預測服務那 28 人日需要重新評估(見 §4)。

---

## 4. 核心決議:ML 模組要不要用 Python

外部規劃書 §11.2 預設走 **Python FastAPI 子服務**(Darts/PyTorch/Prophet),理由是 Code Skill 只能跑 Node.js。但本 codebase 的 Code Skill 是 **真 subprocess + 動態 npm install**,所以這個預設不一定成立。

### 4.1 四條路的比較

| 方案 | 技術棧 | 預估 MAPE(推測) | 新增程式工時 | 部署複雜度 | 可解釋性 |
|------|--------|--------------|------------|-----------|---------|
| **A. Python FastAPI 子服務** | Darts + PyTorch Forecasting + TFT/N-BEATS | 1.0–1.5% | 28 人日 | 新增 K8s Pod、Dockerfile、CI 分支 | SHAP 完整 |
| **B. Node.js 原生時序** | `@tensorflow/tfjs-node` + `arima` + 簡單 ensemble | 2.0–3.0% | 12 人日 | 0(Code Skill 內跑) | 中等(特徵重要性) |
| **C. 純 LLM 預測** | Gemini 3 Pro / GPT-5 + 結構化 JSON prompt | 2.5–4.5% | 3 人日 | 0 | LLM 自解釋 |
| **D. 外部 MCP Server(Python)** | Python MCP + stdio 或 http-sse | 1.0–1.5% | 25 人日 | 獨立容器,與主應用解耦 | SHAP 完整 |

MAPE 數字為基於貴金屬日線波動率的概估,**實際需 Phase 0 PoC 量測**。

### 4.2 方案優劣分析

**方案 A(規劃書原案)**

- ✅ 模型生態最成熟(Darts 一套涵蓋 20+ 模型)
- ❌ 本 codebase 目前零 Python runtime,引入 Python = 新 Dockerfile + 新 K8s manifest + 新 CI/CD 分支 + 新除錯路徑 + 新依賴管理週期,長期維運負擔
- ❌ 規劃書 §15.1 自己寫 "MVP 可在 6 週內達成",但 28 人日 Python 服務(含訓練管線 MLOps)在 MVP 期間做完風險高

**方案 B(Node.js 時序)**

- ✅ 完全融入現有 Code Skill 機制,無新 runtime
- ✅ 12 人日可交付,與規劃書 §15.1 的 81 人日預算相容
- ⚠️ tfjs-node LSTM 對黃金日線預估 MAPE 2–2.5%(推測);Transformer/TFT/N-BEATS 幾乎沒有好的 JS port,若 KPI 硬要求 MAPE < 1.5% 可能不夠
- ⚠️ tfjs-node 原生模組對 Windows 建置環境有時麻煩,但生產走 K8s Linux 沒問題

**方案 C(純 LLM)**

- ✅ 3 人日即可 PoC
- ✅ 零新代碼、零新依賴
- ❌ 每次預測都付 LLM Token,長期成本 > 自建模型
- ❌ MAPE 不穩定,同一 prompt 不同時間可能得出不同結果(temperature/模型更新)
- ✅ 但作為 **baseline** 極有價值 — 如果 LLM 就能打到 3% 以下,後面大部分模型工作可以延後

**方案 D(Python MCP Server)**

- ✅ 解耦最乾淨:Cortex 主程式零改動,Python 模型獨立部署
- ✅ 透過 MCP stdio/http-sse 呼叫,本 codebase 已有成熟支援
- ❌ 仍需 Python 人力維護,長期負擔同 A
- ✅ 比 A 好在「退役/換模型」時不影響主應用部署

### 4.3 推薦路徑:B + C 組合,必要時升 D

**Phase 0(PoC)**:方案 C(純 LLM)— 量 MAPE baseline
**Phase 1(MVP)**:方案 B(tfjs-node LSTM)— 若 C 的 MAPE 不夠用
**Phase 3+(若需要)**:方案 D(Python MCP)— 只在財務避險硬要求 < 1.5% 且有預算時才做

**反對引入 Python 的理由**:
1. 專案 CLAUDE.md 沒任何 Python 依賴,引入等於新增技術棧維運成本
2. 規劃書自己的時程壓力與 Python 服務開發矛盾
3. LLM baseline 沒做,就直接跳 Python 是倒著做

**支持 Python 的反向論點**(公平呈現):
- 若專案 KPI 硬寫 MAPE ≤ 1.5%,方案 B 的頂點可能不夠
- 若未來要做 TFT/N-BEATS 這類 SOTA 時序模型,Python 是唯一路
- 公司若已有 Python ML 團隊,邊際成本較低

**決策需要 PM/Sponsor 回答的問題**見 §7 待決議事項。

---

## 5. 分階段計畫(對照現有程式)

### Phase 0 — PoC(2 週,2-3 人日實作)

目標:**用現有 Cortex 能力零新代碼跑通第一條流,量 LLM baseline MAPE**。

| # | 任務 | 做法 | 用到的現有程式 |
|---|------|------|--------------|
| 1 | 建 `PM_PRICE_DAILY` 表 | DBA 在 Oracle 建 schema(見 §6 DDL) | Oracle 連線既有 |
| 2 | 抓台銀金價寫入 DB | Cortex 後台建排程,Prompt 寫 `{{scrape:https://rate.bot.com.tw/gold}}` + LLM 解析 JSON + 呼叫 DB insert | [scheduledTaskService.js](../server/services/scheduledTaskService.js) |
| 3 | 建 AI 戰情室 Topic + 1 個 Design | 後台 UI 拖拉,零代碼 | [dashboard.js](../server/routes/dashboard.js) |
| 4 | 對話「金價走勢」自動畫圖 | 驗證 inline chart | [chartSpecParser.js](../server/services/chartSpecParser.js) 已就位 |
| 5 | LLM baseline 預測 | 對話貼 60 天歷史資料,要求「回傳 JSON 含 forecast/lower/upper」,對話直接畫圖 | 現有 chat + Gemini 3 Pro |
| 6 | 記錄 10 次預測 → 一週後比對實際值 | 算 MAPE,寫入 PM_FORECAST | 手動或簡單 Skill |

**Decision Gate 0**:Step 5 的 MAPE 值 → 決定後續走方案 B 還是 A/D。

### Phase 1 — MVP(4 週)

核心新增程式只有三塊:

#### (a) Code Skill `pm_fetch_market_data`

```
server/skill_runners/pm_fetch_market_data/
  ├── index.js       # 多源 fallback:Metals-API / LBMA / 台銀
  ├── package.json   # axios 依賴(skillRunner 動態 install)
```

**為什麼要 Code Skill 而不是排程 Prompt `{{fetch}}`**:需要 API Key(env)+ 多源驗證 + 差異告警,純 fetch 不夠。

#### (b) Code Skill `pm_forecast`(假設走方案 B)

```
server/skill_runners/pm_forecast/
  ├── index.js           # 入口:查 PM_PRICE_DAILY、訓練/推論、寫 PM_FORECAST
  ├── models/
  │   ├── arima.js       # baseline,simple-statistics
  │   ├── lstm_tfjs.js   # 主力,tfjs-node
  │   └── ensemble.js    # 加權平均
  └── package.json
```

**tfjs-node 評估**(黃金日線 5 年 ~1250 筆、5 個特徵、2 層 LSTM):
- 訓練時間 ~30 秒(CPU)— 足以放排程每日重訓
- 記憶體 ~200MB — Code Skill subprocess 無壓力
- Linux 生產環境 native build OK

#### (c) Workflow Skill `pm_multi_agent_synth`

外部規劃書附錄 A.3 的 YAML DAG,**直接在 Cortex 後台視覺化編排,零代碼**。

### Phase 2 — Production(4 週)

全部後台操作,**無新代碼**:
- **採購視角 Dashboard**(主戰場,對照 §2.4 四情境)
- 5 種文件模板(日報/週報/月報/採購決策/董事會)
- 警示 Pipeline(L1-L4 共 4 條)
- PM-Agent 系統提示 + Skill 掛載

唯一例外:**警示去重 Code Skill**(~100 行),查 Redis 30 分鐘 TTL。

**採購部參與時點**(對照 [precious-metals-purchasing-brief.md](precious-metals-purchasing-brief.md)):
- **W3-W4**:訪談採購員 1-2 位,蒐集 2-3 個真實採購案例 + 月報格式需求
- **W6**:採購部派 2-3 位種子使用者試用 1 週,每日 15 分鐘反饋
- **W9-W10**:正式發布 + 1 小時教育訓練

### Phase 3 — Enhancement(視需要)

- 模型 A/B 測試
- 若 Phase 1 MAPE 不達標 → 評估是否上方案 D(Python MCP)
- **財務避險 Dashboard**(僅在採購以外有需求方時做,訪談當下未被提出)
- **What-if 模擬 + BOM 成本傳導**(需製造部提供 BOM 金屬含量)
- 多語、行動端進階

---

## 6. 資料層設計(與外部規劃書 §10 對齊)

本節僅列核心表,外部規劃書 §10 有完整版。

### 6.1 必備新表

- **PM_PRICE_DAILY** — 每日收盤(PK: metal + trade_date + source + fixing_time)
- **PM_PRICE_INTRADAY** — 分時(依效能需求,建議先不做)
- **PM_MACRO** — DXY/VIX/10Y/WTI 等宏觀
- **PM_NEWS** — 新聞原文摘要 + entities + topics
- **PM_SENTIMENT** — 情緒分數(FinBERT 或 LLM)
- **PM_FORECAST** — 預測結果含 mean/lower/upper + model_version + features_snapshot + SHAP
- **PM_ALERT** — 警示歷史
- **PM_ALERT_RULE**(規劃書未列但必要)— 使用者警示規則

### 6.2 命名規範

- 表:`PM_*` 前綴
- Skill:`pm_*` snake_case
- 排程:`[PM] *` 前綴
- 知識庫:`PM-*` 中文友善命名
- AI 戰情 Design:`PM-D01`、`PM-D02` 編號制

---

## 7. 待決議事項(需要 PM/Sponsor 拍板)

以下每一項都會影響後續實作方向。**部分題目已於採購部 Briefing([purchasing-brief](precious-metals-purchasing-brief.md))徵詢初步建議**,標註於「目前傾向」欄,但仍需正式拍板。

### 7.1 技術方向

| # | 議題 | 選項 | 目前傾向 | 影響 |
|---|------|------|---------|------|
| Q1 | ML 模組技術棧 | A. Python 子服務 / B. Node.js(tfjs) / C. 純 LLM / D. Python MCP | ✅ **C(純 LLM)拍板**(Phase 4 確認 forecast_timeseries_llm 已上線,Phase 5 B 加 MAPE 校驗 loop 持續驗證) | 開發工時差 3-25 人日,長期維運成本差異大 |
| Q2 | 預測 MAPE KPI | 硬目標(< 1.5%)/ 軟目標(< 3%)/ 無 | ✅ **軟目標 < 3%**(採購決策級非投資級;Phase 5 B5 連 3 天 MAPE > 30% 自動 alert 採用此基準) | Q1 的決定取決於此 |
| Q3 | 是否做 Python MLOps 管線 | 是 / 否 / Phase 3 再評估 | **Phase 3 再評估**(Phase 5 已用純 LLM 驗證 6 個月,目前無切換 Python 動力) | 是否引入新技術棧 |
| Q4 | 時序特徵範圍 | 僅價格 / 價格+宏觀 / 價格+宏觀+新聞情緒 | ✅ **價格+宏觀+新聞情緒**(Phase 2-4 三類資料源排程都已上線:`[PM]` 全網收集 / 宏觀 / 新聞抓取) | 資料源授權談判範圍 |

### 7.2 資料源 / 授權

| # | 議題 | 待確認 | 目前傾向 |
|---|------|--------|---------|
| Q5 | LBMA 授權 | ICE Benchmark 年費誰出?法務/採購流程多久? | Phase 1 才簽,MVP 先用公開 scrape |
| Q6 | Bloomberg / Reuters | 是否已有 Terminal 授權?若無是否採購? | 沿用現有授權(若無則不採購) |
| Q7 | Metals-API 商業方案 | USD 150/月 誰簽?是否走公司採購? | 立即試用 14 天,Phase 1 前簽約 |
| Q8 | FRED API | 免費但有使用條款,法務是否已審? | 法務備案即可 |
| Q9 | 台銀 scrape | 自動抓公開網頁是否合規?是否需書面確認? | 可行,公開資訊 |

### 7.3 業務範圍

| # | 議題 | 選項 | 目前傾向 |
|---|------|------|---------|
| Q10 | 第一版金屬 | 只做 Au / Au+Ag / 4 大金屬(Au/Ag/Pt/Pd)全上 | ✅ **4 大全上 + 11 關聯金屬**(Phase 2 已 ship,主管視角戰情看全貌) |
| Q11 | What-if 模擬優先級 | MVP 就做 / Phase 2 做 / Phase 3 做 | ✅ **Phase 4 已 ship**(`pm_what_if_cost_impact` skill + Webex C 加 Adaptive Card 觸發) |
| Q12 | BOM 成本傳導功能 | 需求方是製造部?能否提供 BOM 金屬含量資料? | ✅ **Phase 4 + Phase 5 A1 已通**:What-if 已可吃 `pm_bom_metal`;Phase 5 A1 加 ERP 自動同步範本(取代手動 CSV) |
| Q13 | 警示通道 | Email+Webex MVP 夠用?Teams/Line/SMS 要不要做? | ✅ **Email + Webex 拍板**(Phase 5 C 完整對話 + 訂閱推送);Teams/Line/SMS **不做** |
| Q14 | 使用者分群 | 採購/財務/主管各 Dashboard 是否都要?還是先聚焦一個 | ✅ **採購 + 主管 + 分析師三視角**(Phase 5 戰情共 ~20 個 Design;財務視角不做) |

### 7.4 組織 / 治理

| # | 議題 | 待確認 | 目前傾向 |
|---|------|--------|---------|
| Q15 | 專案 Sponsor | 誰?CFO、採購長、CIO?影響警示優先級設計 | **採購長**(§2.5 主要受益者) |
| Q16 | AI 治理委員會 | 模型卡、可解釋性審查標準誰訂? | W4 前定,參考公司既有 AI 政策 |
| Q17 | 免責聲明文字 | 法務是否已擬?(規劃書 §18.2 所需) | 法務 W2 前擬好 |
| Q18 | 種子使用者 | Phase 1 W6 需要 N 位,誰負責招募? | **採購主管指派 2-3 位**(採購部人數較少,不用 10 位) |

---

## 8. Phase 0 具體行動清單

假設 Q1-Q3 選擇「先試 C 再視情況走 B」(最保守推薦):

### W1(第 1 週)

- [ ] **D1** Kick-off 會議,確認 §7 待決議事項
- [ ] **D2** 申請 Metals-API 試用帳號(14 天免費)
- [ ] **D3** DBA 建 `PM_PRICE_DAILY` / `PM_MACRO` 兩張表
- [ ] **D4** 手動匯入台銀 + LBMA 黃金近 1 年日線(回填測試資料)
- [ ] **D5** Cortex 後台建排程:每日 09:30 `{{scrape:rate.bot.com.tw/gold}}` + LLM 解析 + DB insert

### W2(第 2 週)

- [ ] **D6** AI 戰情建 `貴金屬 PoC` Topic + 2 個 Design(金價走勢、四金屬對比)
- [ ] **D7** 對話測試「過去 30 天金價走勢」→ 驗證 inline chart 自動畫
- [ ] **D8** LLM baseline 預測測試:貼歷史資料 + 結構化 prompt,連續測 10 天
- [ ] **D9** 記錄 LLM 預測 vs 實際,算 MAPE
- [ ] **D10** **Demo 給採購部主管 + 2 位採購員**(用真實台銀金價 + 真實 AI 預測)→ 作為採購 Briefing 會議素材
- [ ] **D11** Decision Gate 0:決定 Phase 1 ML 方案(B 或 A/D)+ 採購部拍板 §7 待決議事項

### 成功標準(DG-0 must pass)

1. 對話「黃金多少錢」3 秒內回覆正確數值
2. 10 天 LLM 預測 MAPE 有實測數字(不論好壞,有就算過)
3. 採購部主管看過 Demo,明確表示繼續

---

## 9. 風險與緩解

本節僅列 Cortex 整合特有的風險,外部規劃書 §21 有完整版。

| 風險 | 緩解 |
|------|------|
| tfjs-node 在 Windows 開發機建置失敗 | 走 WSL2 或純 K8s 部署;建置失敗非阻塞問題(只影響本機除錯) |
| Cortex 版本升級破壞 Skill 契約 | Skill 定義(JSON + 程式碼)納入 Git;每週自動備份 Cortex export |
| 排程 `{{scrape}}` 遇台銀改版 | 設計 Prompt 時要求「若解析失敗回傳 `__PARSE_FAIL__`」,排程檢測此字串觸發告警 |
| LLM baseline 偏差過大 | Phase 0 本來就是為驗證這點,沒打到就升 B 方案,沒浪費 |
| Python 方案 D 晚期引入時 Cortex 整合困難 | 走 MCP 協議接入,主應用零改動,是 Python 方案中風險最低的 |
| 採購部期望與系統能力落差 | Phase 0 Demo 後立即辦採購 Briefing,以真實畫面對齊預期 |
| 事業單位批評「AI 預測仍不準」 | 在 S6/S8 情境中強制呈現信心區間 + 免責聲明,預測是輔助不是保證 |

---

## 10. 相關文件

本專案共三份核心文件,用途各異:

| 文件 | 對象 | 用途 | 誰該讀 |
|------|------|------|-------|
| [precious-metals-plan.md](precious-metals-plan.md)(本文) | 工程+PM | 完整工程實作規劃、待決議事項、風險 | 資訊部、PM、CIO |
| [precious-metals-sponsor-brief.md](precious-metals-sponsor-brief.md) | CIO / 高階 Sponsor | 技術方案拍板(ML 選型、MAPE、資料源授權)| IT Sponsor |
| [precious-metals-purchasing-brief.md](precious-metals-purchasing-brief.md) | 採購部 | 業務視角簡報(4 情境 + 3 題拍板)| 採購長、採購主管 |

外部參考:
- 《貴重金屬價格趨勢與預測平台 v2.0 Cortex 整合版》— 87 頁完整規劃書,市場/投資/管理層等廣義視角
- [ai-dashboard-design.md](ai-dashboard-design.md) — AI 戰情室設計規格
- [chat-inline-chart-plan.md](chat-inline-chart-plan.md) — 對話圖表實作進度

**閱讀順序建議**:
- 工程同仁:本文 §3 → §4 → §5 → §8
- 採購部:只需讀 purchasing-brief,本文對他們過於技術
- CIO:sponsor-brief 為主,本文 §1 / §2 / §4 / §7 為輔

---

## 11. 下一步

等 §7 待決議事項有回覆後,立即執行:

1. 若 Q1 = C 或 B:按 §8 行動清單執行
2. 若 Q1 = A:重新評估時程(規劃書 28 人日的 Python 開發需確認人力來源)
3. 若 Q1 = D:Phase 0 仍照 C 走,Phase 2 後半段再評估引入 Python MCP Server

採購 Briefing 辦理時點:**建議排在 Phase 0 D10 完成後**(約第 2 週末),使用真實台銀金價 + 真實 AI 預測當 live demo,比抽象簡報說服力高數倍。

---

**本文作者**:Claude(基於 2026-04-23 codebase 盤點 + 2026-04-24 採購部業務脈絡)
**最後更新**:2026-04-26(加入 §12 Phase 5 實施成果)
**對應外部規劃書版本**:v2.0 Cortex 整合版 / v2.0-deepresearch

---

## 12. Phase 5 實施成果(2026-04-26 全部 ship)

Phase 5 把 PM 平台從「**功能完整**」推到「**業務真敢用**」— 補資料源、補品質追蹤、補互動深度、補運維可觀測性。完整規劃見 [phase5-plan.md](phase5-plan.md);本節用「**使用者怎麼用**」視角總結最終形態。下一步規劃見 [phase6-plan.md](phase6-plan.md)。

### 12.1 Track A — ERP 真連線同步框架

**解決什麼**:Phase 1-4 BOM / 採購歷史靠手動 CSV / 假資料,真上線採購不會買單。

**使用者怎麼用**:
- **admin** 在 AdminDashboard 開「**PM ERP 同步**」tab → 看到 3 個 auto-seed 範本 job(全部 `is_active=0` + `is_dry_run=1`,**升級不會誤撈 ERP 大量資料**):
  1. `[PM-ERP] BOM 金屬含量同步` → `pm_bom_metal`(取代手動 CSV)
  2. `[PM-ERP] 採購單歷史 12 月` → `pm_purchase_history`(by metal × month × factory)
  3. `[PM-ERP] 在途 + 安全庫存` → `pm_inventory`(by metal × factory,每 6h 更新)
- 編輯 job → 改 `source_query` SQL(EBS schema 為範本,實際 customization 一定要改) → 按 **Preview** 跑 SELECT 看前 10 row + 欄位名 → 對齊 `mapping_json` → 切 `is_active=1` → 排程每 5 分鐘 tick 自動跑
- **Logs** 看最近 30 次執行(rows / duration / error / sample_row)
- **AI 戰情新 4 個 Design**(主管 / 採購視角各兩個):月度採購量趨勢、採購均單價 vs 市場價、在庫+在途 vs 7 日預測缺口、本月安全庫存達成率

**安全機制**:`target_pm_table` 強制 `pm_*` 開頭 + ERP pool 走 `ReadOnlyPoolProxy`(只能 SELECT 不可能改 ERP)+ `MAX_ROWS_PER_JOB=100k` 上限。

### 12.2 Track B — Forecast 校驗 + Self-Improving Loop

**解決什麼**:LLM 預測沒人知道準不準,信任會崩;沒回饋機制 prompt 永遠不會改進。

**使用者(採購員)怎麼用**:
- **Sidebar** 開「**PM 審核**」(只有授權看 `precious-metals` 特殊說明書的 user 才看得到入口,顯示 pending 數 badge)
- `/pm/review` 頁:
  - 看 **AI 自動產的 v2 prompt review queue**(每月 1 號跑 LLM meta-job 產;7 天 dedup)
  - side-by-side / 行 diff 對照 v1 vs v2 + LLM 寫的 rationale + eval summary → **approve 才會 UPDATE skills.system_prompt**(LLM 永不直接改 prompt)
  - reject 給 reason
- **報告 / forecast 頁**有 `PmFeedbackThumbs` 通用 component(thumbs up/down + comment,UNIQUE per user × target,可重投覆蓋)
- **AI 戰情新 3 個 Design**(主管 / 分析師視角):各金屬 30 天 MAPE 排行、預測 MAPE 滾動 60 天、預測 vs 實際 w/ in_band

**系統內部 cron**:
- 每 24h `pmForecastAccuracyService` 自動校驗 → 寫 `pm_forecast_accuracy`(abs_error / pct_error / in_band)
- per-metal 連 3 天 `|pct_err| > 30%` → 寫 `pm_alert_history`(rule_code='pm_mape_streak',24h dedup)
- 每月 1 號 `pmPromptSelfImproveService` 跑(撈最差 + thumbs-down 案例餵 Pro → 進 review queue)

**權限 gate**:復用 `help_book_shares` for code='precious-metals' — admin 在「特殊說明書管理」設誰能讀,自動就是誰能審 review queue。

### 12.3 Track C — Webex Bot 完整對話 + 訂閱推送

**解決什麼**:Phase 4 Webex 只能收警示 ACK,user 想直接在 DM 問「銅最近怎樣」「銅 +10% 算成本」。

**使用者怎麼用**:
- **在 Webex DM 對 PM Bot 直接打**(NL intent 偵測 + 11 金屬代碼別名,中/英/縮寫都認):
  - `top 5` / `快照` / `今日金價` → **Snapshot Card**(Top 5 metals 報價 + 漲跌% + Forecast 按鈕)
  - `銅` / `Cu` / `Au` → **Latest 報價 Card**
  - `銅 預測` / `Cu forecast` / `Au 7 day` → **Forecast Card**(7-day forecast + 信心區間 + Unicode sparkline ▁▂▃▄▅▆▇█ + What-if 按鈕)
  - `銅 +10%` / `what if Cu -5%` / `銀 漲 10%` → **What-if Card**(當前 vs 模擬價 + JOIN `pm_bom_metal` 算 cost impact)
  - `/pm help` → **Help Card**
- intent 沒中(99% 一般對話)→ fall through 到既有 LLM 流程,**零行為改變**
- **每分鐘 cron 比 schedule_hhmm 主動推送訂閱**(`pm_webex_subscription` 表):
  - user 在 `/pm/review` 頁右上角開「**Webex 訂閱**」modal → 設 `kind=daily_snapshot` + `schedule_hhmm`(如 `09:00`)
  - 每天指定時間自動 DM 推 4 大貴金屬 + 4 基本金屬 snapshot Card
- **PM intent short-circuit 也寫 `chat_messages`** → web chat session 看得到完整歷史,不分裂兩處

**設計重點**:PM intent 不打 LLM → **1 秒回應 + 零 token 成本**;權限 gate 同 B(復用 help_book_shares)。

### 12.4 Track F — 可觀測性 + 自動運維

**解決什麼**:6 個排程 + 18 個 source + 多模型 token 跑下去,出錯 / 配額爆 / source 掛掉 admin 不會立刻知道。

**使用者(admin)怎麼用**:AdminDashboard 開「**PM 平台健康**」tab(4 sub-tab):

| Sub-tab | 看什麼 | 怎麼動作 |
|---------|-------|---------|
| **F1 Tasks** | per-task 7/14/30 天 success / avg duration / 總 tokens / 成本 | 點「N 失敗」展開最近 20 次 error_msg + response_preview;**行內編輯 `daily_token_budget`** 即時生效 |
| **F2 Token 預算** | per-task daily budget 與當日已用 / 是否被 paused | 手動 clear pause;隔日 00:00 自動解除 |
| **F3 Source 監控** | 18 個 PM 全網收集 source 連通狀態(每 6h HEAD/GET cron) | 立即檢查按鈕;連 3 失敗 → `is_disabled=1` + email admin(24h cooldown) |
| **F4 KB 維護** | PM-新聞庫 chunks,文件 created_date > 90d 候選 archive | dry-run / 真執行 / restore 三按鈕(`PM_KB_ARCHIVE_DRYRUN=false` 才真執行) |
| **F5 Cost** | per-task 月度 token 成本 + per-day × per-model 明細 | 標註「估算」(token_usage 沒 task_id,以 owner_user_id 平攤) |

**系統內部變化**:
- `scheduledTaskService.runTask` 開頭檢查 token budget paused → 當天 skip
- `kbRetrieval.js` 4 處 query 加 `archived_at IS NULL` filter(soft archive,不影響檢索效能)
- email alert 都有 24h cooldown,不會 spam 運維信箱

### 12.5 Phase 5 後的平台形態

```
[資料源]
  ├─ 全網 18 sources(Phase 2)— Phase 5 F3 加 6h 巡檢 + 自動 disable
  ├─ ERP 真連線同步(Phase 5 A)— BOM / 採購歷史 / 在途庫存,通用 framework
  └─ 既有手動 CSV(可選降級)

[LLM 處理層]
  ├─ forecast_timeseries_llm + pm_deep_analysis_workflow + pm_what_if_cost_impact
  └─ Phase 5 B 加每 24h MAPE 校驗 + 月初 self-improve prompt 進採購員 review queue

[互動介面]
  ├─ Web Chat / Dashboard(Phase 1-3)
  ├─ Webex 警示 ACK Card(Phase 4)
  └─ Phase 5 C: Webex DM NL 對話 + 4 種 Adaptive Card + 每日 snapshot 訂閱

[運維 — Phase 5 F]
  ├─ PM 平台健康 tab(4 sub-tab)
  ├─ per-task daily_token_budget 自動 pause
  ├─ source 健康監控 + 自動 disable
  ├─ KB soft-archive(90d)
  └─ Cost dashboard(per-task 平攤估算)
```

採購員早上開 Webex DM 打 `top 5` → 看 Top 5 金屬 snapshot → 點 Forecast 按鈕看 7 日預測 + sparkline → 點 What-if 按 `銅 +10%` 直接知對採購成本影響 → 進 web `/pm/review` 對 forecast 按 thumbs;主管打開 web 看戰情新 MAPE 排行 + 採購量 vs 市場價 + 安全庫存達成率;admin 進「PM 平台健康」確認 6 排程都綠 + token 沒爆 + 18 source 都通。**這就是 Phase 5 後的日常流。**
