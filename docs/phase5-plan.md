# Phase 5 規劃書 — PM 平台從「可用」走到「實戰」

> **規劃日期**:2026-04-25
> **基礎**:Phase 1-4 全部完成,平台已能跑日報 / 週報 / 月報 / 全網收集 / 警示 / What-if 模擬。
> **狀態**:待 user 拍板選 track 後實作

---

## 0. 為什麼還要 Phase 5?

Phase 1-4 把 PM 平台的「**功能完整性**」做完了 — 各種排程 / KB / Skill / 警示 / Dashboard 都有了。但實際丟給採購單位後,會遇到 4 個問題:

1. **資料源問題**:`bom_data` 還是 admin 手動上傳 CSV、`pm_price_history` 靠單一公開網站抓、ERP 真採購歷史 / 庫存 / 在途完全沒接
2. **品質追蹤問題**:LLM 預測準不準?分析報告對不對?採購是否真的拿來決策?完全沒有 feedback loop
3. **互動深度問題**:Webex 只能收警示 ACK,不能對話「銅最近怎樣?」「我下個月該下單嗎?」
4. **可信度問題**:LLM 出錯 / 過時 / 幻覺時,沒人知道。需要校驗機制

Phase 5 主軸:**把 PoC 級的 PM 平台升級成業務真敢用的工具**。

---

## 1. 6 個候選 Track(獨立可選,可組合)

每個 track 都是 1-2 週工作量,寫成可單獨執行的單位。

### Track A:ERP 真連線整合(最高 ROI、最長工時)
**為什麼做**:目前 BOM / 採購歷史都是手動 / 假資料,真上線採購不會買單。

**範圍**:
- A1. BOM 從 ERP 自動同步:既有 `getErpPool` 已存在 → 寫一個排程定期 SELECT 產品 BOM 表 → upsert 到 `pm_bom_metal`(取代手動 CSV)
- A2. 採購歷史落地:從 ERP 撈過去 12 個月採購單 → 統計各金屬月用量、平均單價 → 寫到新表 `pm_purchase_history`
- A3. 採購單 hook:採購系統下單前(若可整合)呼叫 forecast skill,給「現在下單 vs 等 7 天 vs 等 30 天」預期成本差
- A4. 在途庫存讀取:撈 ERP 在途 / 安全庫存 → AI 戰情新 Design「庫存 vs 7 日預測」缺口提醒

**估工**:8-10 天(取決於 ERP schema 複雜度)
**阻塞**:需 ERP DBA 給 SELECT 權限 / table 對照、需採購單位提供「採購單觸發點」需求
**效益**:🟢🟢🟢 高 — 真正可動採購決策的數字

---

### Track B:Forecast 校驗 + Self-Improving Loop
**為什麼做**:現在 LLM forecast 跑了沒人看準不準,就算錯了也沒回饋。長期信任會崩。

**範圍**:
- B1. **準確率追蹤**:每天比對 `forecast_history` 7 天前的預測 vs 今天實際 `pm_price_history`,算 MAPE / RMSE → 寫到新表 `pm_forecast_accuracy`
- B2. **AI 戰情 Design**:模型預測 vs 實際 + MAPE 滾動圖、各金屬準確率排行
- B3. **Thumbs-up/down**:報告 / 警示頁加「這個分析有用嗎?」按鈕,寫 `pm_feedback_signal` 表
- B4. **Prompt self-improve**:每月跑一個 meta-排程,把過去 30 天「準確率低 + 評為無用」的案例餵給 LLM,讓 LLM 改進 system_prompt(產出 v2 prompt 進 admin review queue,不直接套用)
- B5. **校驗警示**:某金屬 7 日 MAPE > 30% 連續 3 次 → 自動發 alert 通知 admin「該調 prompt」

**估工**:5-7 天
**阻塞**:無(只用既有 LLM + DB)
**效益**:🟢🟢🟢 高 — 防 LLM 信任崩盤的關鍵防線

---

### Track C:Webex Bot 完整對話介面
**為什麼做**:Phase 4 只做警示 ACK Card,user 真的想「在 Webex 直接問銅最近怎樣」。

**範圍**:
- C1. PM context-aware Bot:Webex DM Bot,輸入「銅」/「金價」/「七天預測」 自動 route 到對應 skill
- C2. **多場景 Adaptive Card**:
  - Top 5 metals snapshot card(每天 8:00 主動推給訂閱 user)
  - 7 day forecast card(含 sparkline mini-chart 圖片)
  - Quick what-if card(按「銅+10%」「金-5%」直接觸發 What-if skill)
- C3. **Push 訂閱**:user 可在 Cortex web 訂閱「每天 09:00 推 PM 日報摘要 to Webex」,bot 自動發
- C4. **Bot 對話歷史進 Cortex chat**:Webex DM 對話自動同步到 Cortex chat session,user 可隨時切回 web 介面繼續

**估工**:7-9 天(Adaptive Card 設計細節耗時)
**阻塞**:Webex Bot 需先確認 token + webhook 都正常通(Phase 4 已建好 callback infra)
**效益**:🟢🟢 中高 — 行動端體驗完整,但需 user 真的常用 Webex

---

### Track D:多租戶 / 產品線分群權限
**為什麼做**:大廠多事業部 / 多產品線,不同單位看不同金屬 / KB / 報告。現在所有 PM-* 都是 is_public=1 全公司都看。

**範圍**:
- D1. PM tasks / KBs 接上既有 share permission framework(`kb_access` / `share_type` / `grantee_type`)
- D2. 各產品線可以自建專屬 KB(銅產品線只看銅相關新聞 RAG)
- D3. 採購主管看全廠;工廠主管只看自己廠用到的金屬 → AI 戰情 Designs filter by user.factory_code
- D4. Per-product-line 自動排程模板:選擇「Connector 產品線」→ 自動 seed 一套對應的 BOM-driven 排程

**估工**:4-6 天(既有 share framework 已成熟,主要是 PM 各表掛上)
**阻塞**:需 user 確認組織分群方式
**效益**:🟢🟢 中 — 大組織必要,小組織不需要

---

### Track E:跨資產關聯 + 進階分析
**為什麼做**:目前每金屬獨立分析,但實際採購決策需要看「銅 vs 中國 PMI vs LME 庫存」三角關係。

**範圍**:
- E1. **新 builtin skill `pm_correlation_analysis`**:輸入 metal_code + lookback_days,LLM 自動撈 pm_price_history × pm_macro_history × pm_news 算相關性 + 寫敘事分析
- E2. **供應鏈中斷 What-if**:擴充 14.1 BOM skill,加「假設 X 國銅供應中斷 30 天」場景,LLM 推理可能影響 + 替代來源
- E3. **競品成本估算 skill**:輸入競品名 + 產品類型,LLM 從公開財報 / 行業資料估算競品的金屬成本結構
- E4. **跨金屬套利機會**:每週掃 `pm_price_history` 找金/銀比、銅/鋁比歷史異常,自動標 alert

**估工**:5-7 天(主要是 prompt engineering + RAG context build)
**阻塞**:無
**效益**:🟢🟢 中 — 高階分析師才會用,但用了會說「這就是我要的」

---

### Track F:可觀測性 + 自動運維
**為什麼做**:每天 6 個排程跑,出錯 / 配額爆 / 防火牆掛掉,admin 不會立刻知道。

**範圍**:
- F1. **PM 平台健康儀表板**(獨立 admin 頁):各排程最近 N 次 success rate、avg duration、token 消耗、error breakdown
- F2. **Token 預算**:per-排程設「每日 token 上限」,超過自動 pause + email admin
- F3. **Source 可達性監控**:全網收集排程的 18 個 source 每天驗一次連通,失效標 disabled 不再嘗試 + email admin
- F4. **定期 KB 維護**:每週掃過期 chunks(例 PM-新聞庫超過 90 天)→ 自動 archive 到冷儲存(降 vector index 大小、提升檢索速度)
- F5. **Cost dashboard**:per-task / per-skill 月度 token 消耗趨勢,給 IT/finance 部門透明帳

**估工**:4-6 天
**阻塞**:無
**效益**:🟢🟢 中 — 上線後一定踩到的痛點,先做省事

---

## 2. 兩種推薦組合

### 🎯 「最小可動」組合(2-3 週)— 想趕快讓採購用上的選擇
- **Track A**(ERP 真連線)1 週精簡版(只做 A1 BOM 同步 + A2 採購歷史)
- **Track B**(校驗 loop)完整 1 週 — **必做**,信任問題不解決上線就完蛋
- **Track F**(可觀測性)精簡 0.5 週(只做 F1 健康儀表板 + F3 source 監控)

**總計**:~13 個工作天
**結果**:採購可以拿真 BOM 跑 What-if、看得到 LLM 預測準不準、admin 知道哪個排程掛了

---

### 🚀 「全套上線」組合(4-5 週)— 要完整 production 體驗
- Track A 完整 2 週(含 A3 採購單 hook + A4 在途庫存)
- Track B 完整 1 週
- Track C 精簡 1 週(只做 C1 + C2,不做 push 訂閱 / chat sync)
- Track D 精簡 0.5 週(只做 D1 + D3,不做自動模板)
- Track F 完整 1 週

**Track E** 留 Phase 6(高階分析,先確認 base case 跑得好再做)

**總計**:~25 工作天
**結果**:多事業部都可用、Webex 完整體驗、有完整品質監控、ERP 真資料

---

## 3. 推薦走「最小可動」組合

理由:
1. **Phase 1-4 已 ship 太多功能,user 還沒實際用過** — 先驗證有沒有 bug、UI 流不流暢、LLM 回答夠不夠好,再加新東西
2. **ERP 整合的 A1 + A2 是 unblock 一切的關鍵** — 沒真資料,所有 What-if 都是空談
3. **校驗 loop(B)是技術債** — 不做的話,user 用 1-2 週發現「LLM 預測不准」就會永遠不信任
4. **F 是運維必需** — 上線後第一天就需要,但工時短

Track C / D / E 都建議**等 user 實際用了 1 個月之後**,根據真實 feedback 決定要不要做、做哪個。

---

## 4. 拍板問題

請你選一個:

**A.「最小可動」3 週路線**:Track A(精簡)+ B(完整)+ F(精簡)— 我建議走這條
**B.「全套上線」5 週路線**:A 完整 + B + C + D + F
**C. 自選組合**:你勾選想做哪幾個 track,我重新排
**D. 先別做,我想先實際用 Phase 1-4 一輪再決定**

如果選 C,可以告訴我:
- ERP 那邊我能拿到什麼權限 / 資料?(影響 Track A 範圍)
- 採購單位多 / 工廠多嗎?(影響 Track D 必要性)
- 你的人有在 Webex 重度使用嗎?(影響 Track C 投資)
- 之前 Phase 1-4 有踩到什麼痛點?(可能 reorder 優先順序)

---

## 5. 不做的事(本 Phase 5 確定不做)

| 不做 | 原因 |
|------|------|
| Python ML / 真機器學習模型 | Phase 4 已決定走 LLM solution,需求未變不重啟 |
| Multi-Agent 加更多 agent(>5) | 5-agent 已夠用,加更多是 over-engineering |
| 自建 LLM(fine-tune Gemini)| Vertex 不開放、自託管模型成本太高 |
| 報價系統整合 | 那是獨立 track(quote-system-spec.md v0.3.5 在進行中)|
| Mobile App(原生 iOS/Android)| Webex Bot + 手機瀏覽器 PWA 已涵蓋,投產比不划算 |

---

## 6. Phase 5 完成後的形態

如果走「最小可動」路線,Phase 5 結束後 PM 平台的形態:

```
[排程資料來源]
  ├─ 全網 18 sources(現有,Phase 2)
  ├─ ERP BOM 自動同步(NEW Phase 5 A1)        ← 取代手動 CSV
  └─ ERP 12 個月採購歷史(NEW Phase 5 A2)     ← 給 LLM 上下文用

[LLM 處理層]
  ├─ forecast_timeseries_llm(Phase 2)
  ├─ pm_deep_analysis_workflow(Phase 4 14.2)
  └─ pm_what_if_cost_impact(Phase 4 14.1)+ 真 BOM(NEW)

[品質校驗層 — NEW Phase 5 B]
  ├─ pm_forecast_accuracy 表(7 天前預測 vs 實際)
  ├─ MAPE 滾動 Design + per-metal 準確率排行
  ├─ Thumbs-up/down feedback signal
  └─ Self-improving prompt review queue

[輸出 + 通知]
  ├─ DOCX / PPTX 報表(Phase 2-3)
  ├─ Email + Webex Card 警示(Phase 3-4)
  └─ AI 戰情 Dashboard(Phase 3 + Phase 5 加準確率)

[運維 — NEW Phase 5 F]
  ├─ PM 平台健康儀表板
  └─ 18 sources 連通監控 + 失效自動 disable
```

採購主管早上 09:00 打開 → 看到日報 + 預測 + 準確率(知道該不該信)→ 用 What-if 試「銅漲 10%」算成本 → 拿真 BOM 出來不是模擬數字 → 出報告給老闆。

---

> **下一步**:你回覆挑哪條路線(A/B/C/D)後,我會把對應 Track 拆成 D1-DN 工作日 plan,跟 Phase 2-4 一樣 commit-by-commit 逐步 ship。
