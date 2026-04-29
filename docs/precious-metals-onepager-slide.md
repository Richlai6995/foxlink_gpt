# 貴重金屬價格情報平台 — 一頁重點

> 產出日期:2026-04-29
> 對應狀態:Phase 5 全部 ship + 4/29 重構(新聞 by-source 拆分 + 職責分工 + 資料保留)
>
> 本頁設計給高階 / 跨部門 5 分鐘 briefing 用 — 「**一頁看完平台做什麼、怎麼省事、現在能用什麼**」。
> 完整版見 [precious-metals-full-slides.md](./precious-metals-full-slides.md)。

---

## Slide ★ — 平台一頁 Summary

```
P R O C U R E M E N T   I N T E L L I G E N C E
─────────────────────────────────────────────

      貴重金屬價格情報平台

  讓採購從「事後查、手動整、被動等」 →
       「主動推、AI 整、即時答」
```

**範圍**:Au 黃金 · Ag 白銀 · Pt 鉑金 · Pd 鈀金 + 7 個關聯金屬(Cu/Al/Ni/Sn/Zn/Pb/Rh)
**寄生在 Cortex 上**(0 新系統 / 0 新帳號 / 0 學習成本)

---

### 🚀 平台幫採購做的 6 件事(全部 ship)

| # | 自動做的事 | 取代原本 | 採購省的時間 |
|---|----------|---------|-------------|
| 1 | **每日 18:00 自動寄日報**(新聞精選 5-10 篇 RAG + 報價 + 7 天預測 + 為什麼今日這樣動) | 手動開 LBMA + 台銀 + Bloomberg + Email 彙整 | 30 分 → **5 秒** |
| 2 | **採購一站式頁** `/pm/briefing` | 跨多個畫面找資料 | 5 個 Tab 一頁搞定 |
| 3 | **Webex DM 對 Bot 打中文/英文** 1 秒回 Adaptive Card(Snapshot/Forecast/What-if/Help) | 開瀏覽器查 | 出差路上手機就能查 |
| 4 | **AI 戰情 ~20 個 Design**(採購 / 主管 / 分析師三視角) | 手 Excel 整理 | 即時看 |
| 5 | **AI 預測校驗 + 自我改進**(每 24h 算 MAPE,每月 1 號 LLM 自動產 v2 prompt 進審核 queue,**人 approve 才套用**) | 「AI 永遠不知道準不準」 | 模型品質**可量化、可追溯** |
| 6 | **資料保留(retention)**(7 entity 各設天數,daily 凌晨 3:00 自動清) | DB 撐爆 / 索引拖慢 | 永遠不用 DBA 手動 truncate |

---

### 📊 採購一站式頁 `/pm/briefing` — 7 層結構

```
┌─ 1. 報價 banner(11 金屬 sticky)── 缺金屬警示 + stale 黃框
├─ 2. 宏觀 banner(DXY / VIX / 10Y / WTI)
├─ 3. 近期警示 banner(7 天未 ack 警示,可一鍵 ack)
├─ 4. 今日 AI 綜述(從日報撈,250 字摘要 + 看完整日報 + 👍 thumbs)
├─ 5. 排程資料健康度面板(silent failure 警示,有 alert 才展開)
├─ 6. 5 個 Tab:
│     ├─ 新聞列表(預設,含「看完整內容」modal:LLM 摘要 + KB 原文 1500-3000 字)
│     ├─ 歷史價格(line chart + AI 預測線 + 採購點 + 3 KPI cards + 完整資料表)
│     ├─ 週報 / 月報(markdown + docx 下載)
│     └─ Prompt 審核(LLM 提的 v2 prompt vs v1 行 diff,approve 才上線)
└─ 7. Top bar:[⚙ 我的偏好] [⬇ 匯出 CSV]
```

---

### 💎 4 個關鍵價值(對採購)

| 價值 | 落實方式 | 防止過去發生過的痛 |
|------|---------|-------------------|
| **預警** — 從事後變事前 | Webex DM 主動推 + AlertsBanner | 「金價大漲時採購事後才知道」 |
| **回應有底氣** — 不再靠經驗 | `/pm-deep` 5-Agent workflow 出含信心區間 + 歷史類比 + 採購建議的整合報告 | 「事業單位問下月走勢被質疑沒依據」 |
| **省工時** — 月報從 1-2 天歸零 | 排程自動產 docx + AI 寫「為什麼這個月買在這個價」 | 手 Excel 公式易錯 |
| **品質可量化** — 不只跑,還跑得好 | 每 24h MAPE 校驗 + 月度 self-improve loop + 健康度面板 | 「AI 永遠不知道準不準」 |

---

### 🛡️ 安全與治理(一句話講清楚)

- **資料分層**:公開報價(全員可看) vs 集團採購(`ReadOnlyPoolProxy` ERP 只 SELECT 不可能誤改)
- **權限**:走公司 AD;管特殊說明書 = 管 PM 平台訪問
- **AI 改 prompt**:LLM **永不直接改**,進 review queue 等採購員 approve
- **資料保留**:KB:PM-分析庫 + pm_price_history + pm_macro_history **永久保留**(後端 hardcoded 防護,誤填會被拒)
- **Token 成本可控**:per-task `daily_token_budget`,當天爆了自動 pause,隔日 00:00 解除

---

### ✅ 現在已可用的(2026-04-29 狀態)

```
✅ 9 個 [PM] user-facing 排程     ✅ 3 個 KB(原始/新聞/分析)+ retention
✅ ~20 個戰情 Design(3 視角)      ✅ /pm/briefing 7 層 + 5 Tab
✅ /pm-deep 5-Agent workflow       ✅ Webex DM NL 對話 + 4 種 Card + 訂閱推送
✅ Forecast MAPE 校驗 loop          ✅ 採購員 thumbs feedback + Prompt review
✅ ERP 真連線同步 framework         ✅ PM 平台健康 4 sub-tab
✅ Token 預算 per-task             ✅ Source 健康巡檢 6h
✅ KB 維護 soft-archive             ✅ 資料保留 7 entity 天數可調
```

**結論**:採購早晨打開 `/pm/briefing` **5 分鐘**搞定盯盤 + 看新聞 + 看 AI 重點;
出差用 Webex `top 5` / `Au 預測` 1 秒回 Card;月底寫報告 0 工時。
