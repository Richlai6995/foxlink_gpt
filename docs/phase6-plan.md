# Phase 6 規劃書 — PM 平台從「業務敢用」走到「業務愛用 + 治理穩」

> **規劃日期**:2026-04-26(Phase 5 全部 ship 當天起草)
> **基礎**:Phase 5 完成 ERP 真連線 / Forecast 校驗 / Webex 完整對話 / 健康監控四大 Track。平台已可信、可觀測、可互動。
> **狀態**:待 user 拍板 + 至少 30 天實際使用體驗反饋後才動

---

## 0. 為什麼還需要 Phase 6?

Phase 5 把「**業務真敢用**」做完了 — 採購員看 MAPE 知道準不準、admin 看健康知道哪炸了、Webex 能直接問、ERP 真資料能同步。但 ship 當下就看到四類遺留 / 浮現的需求:

1. **Phase 5 規劃留下沒做的兩個 Track**:**D 多租戶權限分群** / **E 跨資產關聯分析** — Phase 5 推薦走「最小可動」沒選它們,但需求並未消失
2. **Phase 5 ship 過程暴露的設計妥協**:F2 token 預算用 owner 平攤(沒真 task_id)、B4 review queue 只能 approve/reject(不能 inline 改 prompt)、C2 sparkline 用 Unicode(夠用但不夠美)、A 三個 EBS 範本 SQL 全是猜的(實際 customization 一定要改 → user 痛點)
3. **Phase 5 沒做但生產上很可能踩**:報告產生失敗無 retry、PM 平台多語言(VN 廠採購)、採購員 mobile UI 沒測、PM 對話歷史在 chat 介面沒專屬視圖
4. **Phase 5 上線後該做的體檢**:30 天後該自動跑一次 metrics 報告(排程 success / 訂閱數 / pending review / source 失效 / ERP sync 啟用情況)

Phase 6 主軸:**把 Phase 5 留下的設計妥協 + 觀測到的 1 個月實戰痛點 收掉,讓 PM 平台從「業務敢用」走到「業務愛用 + 治理可審計」**。

---

## 1. 9 個候選 Track(獨立可選,可組合)

### Track G:30 天上線體檢(最先做、最便宜)
**為什麼做**:Phase 5 ship 多東西,不知道實際使用情況(訂閱有人用?ERP sync 有人啟用?MAPE 真的低嗎?)。沒體檢就規劃 Phase 6 是憑想像。

**範圍**:
- G1. 寫一次性「Phase 5 上線體檢」script,輸出 Markdown 報告(可重複執行)
  - 6 排程過去 30 天 success rate / avg duration / token 消耗
  - Webex 訂閱數 + 推送成功率 + 哪些 user 最常用
  - `pm_prompt_review_queue` 待審 + 已 approve / reject 數
  - `pm_source_health` 失效 source 統計 + 自動 disable 次數
  - `pm_erp_sync_job` 啟用 / dry_run / 平均同步 row 數
  - `pm_feedback_signal` thumbs up vs down 比例(信任指標)
- G2. 排 background agent **30 天後跑一次**(2026-05-26),把報告 email admin + 寫進 admin 通知中心

**估工**:1-2 天
**阻塞**:無(用既有 DB query)
**效益**:🟢🟢🟢 高 — 沒這個體檢,後續 Track 全是憑感覺

---

### Track H:Token 預算精準化 — `task_id` 直連
**為什麼做**:Phase 5 F2/F5 用 `owner_user_id` 平攤是妥協(token_usage 沒 task_id)。如果一個 owner 同時跑 PM 任務 + 一般 chat,平攤後成本估算誤差大。F2 預算 trigger 也不準。

**範圍**:
- H1. `token_usage` 加 `task_id NUMBER` nullable(migration 用 ALTER + check column existence)
- H2. `scheduledTaskService.runTask` 把當前 task_id 傳到 token recording 鏈路(`tokenService.recordUsage` 接 optional task_id)
- H3. 一般 chat 路徑保持 NULL(向下相容)
- H4. F5 cost dashboard 改用真 task_id 直接 SUM,**移除「估算」字樣**
- H5. F2 token budget check 用真 task_id 而非 owner 平攤

**估工**:3-4 天
**阻塞**:需驗證 token_usage 有沒有索引在 user_id+date+model 上加 task_id 不會破壞 ON CONFLICT 邏輯
**效益**:🟢🟢 中 — 治理品質升級,但 PoC 階段「估算」也夠用

---

### Track I:Prompt review queue inline edit + diff 工具升級(Phase 5 B 第二版)
**為什麼做**:Phase 5 B4 採購員 approve LLM 產的 v2 prompt 只能整段接受 / 拒絕,不能「我喜歡 80% 但這句話想改」。實際採購員 review 時必然有微調需求。

**範圍**:
- I1. `/pm/review` 頁 v2 prompt 加 inline edit(monaco editor 已在專案內)
- I2. **自動跑 LLM「diff explain」**:採購員改完 → 點「解釋差異」按鈕,LLM 產 diff 摘要(改了什麼、可能影響)
- I3. approve 路徑加新欄位 `pm_prompt_review_queue.user_edited_prompt`,UPDATE skills.system_prompt 用 user_edited_prompt 而非 original v2
- I4. **新增「測試這版 prompt」按鈕**:用該 prompt + 過去 7 天最差 forecast 案例 dry-run,看新預測的 MAPE 估算

**估工**:4-5 天
**阻塞**:無
**效益**:🟢🟢 中 — 第一版上線後採購員必然反映,做了採購員會更願意 approve

---

### Track J:Adaptive Card sparkline → server-side PNG(Phase 5 C 第二版)
**為什麼做**:Phase 5 C2 sparkline 用 Unicode `▁▂▃▄▅▆▇█` 簡單但醜,行動裝置字寬不一致顯示更糟。採購反饋「圖太小看不出趨勢」。

**範圍**:
- J1. server-side 生成 sparkline PNG(用既有 ECharts SSR 或 Canvas)→ 上傳到 uploads/pm-cards/ → Card 帶圖片 URL
- J2. 完整 7-day forecast 改用 Adaptive Card `Image` element(192×64 px sparkline)
- J3. Snapshot Card 的 Top 5 metals 也加 mini trend(7 天迷你線)
- J4. 公開 endpoint `/api/pm/cards/sparkline.png?metal=Au&days=7`(快取 1 小時)

**估工**:3-4 天
**阻塞**:確認 ECharts SSR 在 K8s 容器裡跑 OK(已有 chartSpecParser.js 應該已驗證)
**效益**:🟢 中低 — 美觀升級,功能性其實 Unicode 已涵蓋

---

### Track K:ERP schema 探索助手(Phase 5 A 第二版,**最高 ROI** of Phase 5 妥協修正)
**為什麼做**:Phase 5 A 三個 EBS 範本 SQL **完全是猜的**,實際 customization 不同 → admin 設 ERP sync job 需要手寫 SQL 找對欄位,**等於沒解決真痛點**。需要 LLM 助手幫忙掃 ERP schema。

**範圍**:
- K1. `/admin/pm-erp-sync` 加「**Schema 探索**」按鈕 → 開新 modal
- K2. user 輸入「我要找採購單表」/「BOM 元件含量在哪」自然語言問題
- K3. 後端用 `getErpPool` 查 `ALL_TABLES WHERE owner='APPS' AND table_name LIKE '%PO%'` 等 metadata → 餵 LLM(Pro)→ LLM 推薦 candidate tables + sample columns
- K4. user 點「sample 5 row」→ 後端真跑 SELECT 看資料形狀
- K5. user 確認 → 一鍵把 SQL 填入新增 ERP sync job 的 source_query 欄位
- K6. **沿用 ReadOnlyPoolProxy**,純 SELECT 安全

**估工**:5-6 天(含 prompt engineering for ERP schema awareness)
**阻塞**:需 ERP DBA 確認 APPS schema 的 ALL_TABLES / ALL_TAB_COLUMNS query 權限 OK(SELECT_CATALOG_ROLE)
**效益**:🟢🟢🟢 高 — Phase 5 A 真實可用度的瓶頸,做了 admin 1 天就能設好,沒做要工程師寫一週

---

### Track L:報告 retry + 失敗自癒
**為什麼做**:Phase 5 後排程失敗就過(只記 log + email),沒重試。日報失敗 = 採購員當天沒得看;月報失敗 = 主管要等下月。

**範圍**:
- L1. `scheduled_tasks` 加 `retry_policy_json`(max_attempts / backoff_seconds / retry_on_errors[])
- L2. `scheduledTaskService.runTask` 失敗時若符合 retry_policy → push 到 `task_retry_queue` 表,延遲 N 秒後 re-run
- L3. 預設 policy:max=2、backoff=600s、retry_on=['LLM_TIMEOUT','RATE_LIMIT','NETWORK']
- L4. F1 健康儀表板加「Retry 標記」欄位 + 重試歷史
- L5. 連 N 次都 fail → 仍 email + alert(避免無限重試)

**估工**:3-4 天
**阻塞**:無
**效益**:🟢🟢 中 — 救業務體驗,但只有偶發 transient 失敗才有用(設定錯誤 retry 也沒用)

---

### Track M:PM 平台多語言(VN/EN)
**為什麼做**:目前 [PM] 排程 prompt / Adaptive Card / 報告 docx **全是中文**。VN 廠採購若要用 → 看不懂 prompt 寫的「請分析金價」、Card 寫的「未來 7 天預測」。

**範圍**:
- M1. `[PM]` 系列排程 prompt 改成「依 `{{user_locale}}` 變數產出對應語言」
- M2. Adaptive Card title / button label 從硬編改 i18n key,推送時用該訂閱者的 user.locale
- M3. 文件模板 `pm-日報` / `pm-週報` / `pm-月報` 多語言版本(複製三套 docx,template_translations 接)
- M4. AdminDashboard PM tabs 既有 i18n 補完(部分 panel 之前漏)
- M5. helpSeedData 已有翻譯 → admin 觸發 LLM 補 EN/VN 翻譯(現有 HelpTranslationPanel)

**估工**:5-7 天
**阻塞**:需 user 確認 VN 廠採購是否真的要用 → 沒人用做了浪費
**效益**:🟢 中 — 戰略價值高(集團國際化),但短期 ROI 看 VN 廠是否真接入

---

### Track N:採購員 mobile / PWA 優化
**為什麼做**:採購員 30% 時間在外面(廠商開會、出差)。目前 `/pm/review` + 戰情用 desktop layout,mobile 開起來不能用。

**範圍**:
- N1. `/pm/review` page responsive(side-by-side diff 改 vertical stack on < 768px)
- N2. AI 戰情 PM Topic 加 mobile-friendly preset(改 grid → 單欄堆疊)
- N3. 加 PWA manifest + service worker(離線可看最近一次 snapshot)
- N4. 主螢幕 add to home,自定 icon(`gem` 圖)
- N5. 推送通知用 Web Push API(已訂 Webex 的也可選 web push)

**估工**:5-6 天
**阻塞**:採購員實際 mobile 使用率(Phase 5 沒收集 → Track G 體檢應補)
**效益**:🟢🟢 中(若 mobile 使用率 > 30%)/ 🟢 低(< 10%)

---

### Track O:PM 對話歷史專屬視圖
**為什麼做**:Phase 5 C4 把 Webex PM intent 對話也寫進 `chat_messages`,但 chat 主介面沒「PM 對話」filter,user 找不到歷史 Webex 對話。

**範圍**:
- O1. chat 主介面加 filter:「全部 / PM 平台 / 一般」三類
- O2. PM 對話 session 自動掛 `tag='pm'`(寫入時依 source = 'webex_pm_intent')
- O3. PM session list 顯示「Webex」icon + 對應金屬代碼
- O4. PM session 內顯示 Adaptive Card 簡化文字版(因 web 不能直接 render Adaptive Card,降級成 markdown)

**估工**:3-4 天
**阻塞**:無
**效益**:🟢 中低 — 解決小痛點,但不影響核心流程

---

## 2. 兩種推薦組合

### 「治理收尾」組合(2-3 週)— 把 Phase 5 妥協收乾淨
- **Track G**(30 天體檢)1-2 天 — **必做,先有資料才做後續**
- **Track K**(ERP schema 探索)5-6 天 — 解 Phase 5 A 真痛點
- **Track I**(Prompt review inline edit)4-5 天 — 採購員 1 個月後必反饋

**總計**:~13 工作天
**結果**:Phase 5 留下的兩個最痛妥協收掉、admin 不用工程師也能設 ERP sync、採購員能微調 v2 prompt

---

### 「全套升級」組合(5-6 週)— 國際化 + 治理 + UX 全上
- Track G(體檢)2 天
- Track K(ERP schema)5 天
- Track I(prompt edit)4 天
- Track H(token task_id)3 天
- Track L(retry)3 天
- Track M(多語言)6 天
- Track N(mobile)5 天

**Track J / O** 留 Phase 7(美化 / 小修,優先級低)
**Track D**(Phase 5 沒做的多租戶)→ 觀察 Phase 5 是否真有多事業部用,沒就不做
**Track E**(Phase 5 沒做的跨資產分析)→ 觀察分析師是否真要用,可能做成獨立 Skill 而非 Track

**總計**:~28 工作天
**結果**:VN 廠也能用、採購 mobile 體驗順、token 治理精準、retry 自癒

---

## 3. 推薦走「治理收尾」組合 + 視體檢結果決定

### 為什麼

1. **Phase 5 才剛 ship,user 還沒實際用過 30 天** — 直接做 Track M / N(多語言 / mobile)是憑想像,等 Track G 體檢結果出來再說
2. **Track K 是 Phase 5 A 真實可用度的瓶頸** — 不做,ERP sync framework 等於只給工程師用,採購 admin 仍需找 IT 寫 SQL
3. **Track I 是 Phase 5 B 採購員體驗的關鍵升級** — 第一版上線後 80% 機率會收到「我能改一下嗎」反饋
4. **Track G 給 30 天後一份客觀數據** → 用真實使用數據決定 Phase 6 後半段該做哪些 Track,而不是憑想像

### Phase 5 規劃書留下的兩個 Track 重新評估

**Track D(多租戶 / 產品線分群)— 暫不做**
- Phase 5 ship 後採購單位都用同一份 KB / 戰情,**沒人主動要分群**
- 待 30 天體檢看是否有「不同事業部 PM」訴求出現再啟動

**Track E(跨資產關聯分析)— 改成獨立 Skill 而非 Track**
- E1 跨資產相關性 / E4 套利機會 → 採購員主流程沒在用,**可能是分析師 nice-to-have**
- 建議:Phase 6 先不做 Track E,但保留把 E1 寫成獨立 builtin skill `pm_correlation_analysis` 給 `/pm-deep` workflow 選用的可能性(< 1 天工)

---

## 4. 拍板問題

請你選一個:

**A. 「治理收尾」3 週路線**:Track G + K + I — 我建議這條
**B. 「全套升級」6 週路線**:G + K + I + H + L + M + N(留 J + O 給 Phase 7)
**C. 自選組合**:你勾選想做哪幾個 Track,我重排
**D. 先別做,實際用 Phase 5 一個月再決定** — Track G 仍可單獨先做(2 天工就能拿到數據)

**如果選 C 請告訴我:**
- VN 廠採購會接入嗎?(影響 M 必要性)
- 採購員 mobile 使用率你估多少?(影響 N 必要性)
- ERP DBA 是否願意給 ALL_TABLES SELECT 權限?(影響 K 可行性)
- 過去 1-4 週採購員實際 review 過幾次 v2 prompt?(影響 I 優先級)
- 30 天後是否要先看體檢結果再決定?(影響整體 timing)

---

## 5. 不做的事(Phase 6 確定不做)

| 不做 | 原因 |
|------|------|
| Python ML 真機器學習模型 | Phase 1-5 確定純 LLM 路線可行(MAPE 校驗 loop 持續驗證);需求未變不重啟 |
| Track D 多租戶 / 產品線分群 | Phase 5 ship 後**沒人主動要分群**,等 30 天體檢有訊號再評估 |
| 自建 / fine-tune LLM | Vertex 不開放、自託管成本太高,維持原 Phase 5 結論 |
| 報價系統整合 | 獨立 track(quote-system-spec.md 在進行中) |
| 原生 iOS / Android App | Track N PWA 已涵蓋 80%,投產比不划算 |
| 跨資產分析 Track E 整套上 | 改用「需要時才寫獨立 Skill」策略,不投 Track 級工時 |
| Webex Bot 加 Group Chat 支援 | Phase 5 C 已做 DM,group 加完權限管理複雜度高,先觀察 DM 使用率 |

---

## 6. Phase 6 完成後的形態

如果走「治理收尾」路線,Phase 6 結束後 PM 平台:

```
[Phase 5 既有 10 大組件] + 三個關鍵升級

[Track G 體檢機制 — NEW]
  └─ 一次性 script + 排程 30 天後自動跑 + Email admin

[Track K ERP schema 探索助手 — NEW]
  └─ admin 自然語言問「我要 BOM 表」
     → LLM 推薦 candidate tables
     → sample row preview
     → 一鍵填入 sync job SQL
     → 不用工程師也能設 ERP sync

[Track I Prompt review 升級 — NEW]
  ├─ inline edit v2 prompt(monaco)
  ├─ LLM 自動寫 diff 解釋
  ├─ 用 user_edited_prompt 而非原 v2 套用
  └─ dry-run 測試 + MAPE 估算
```

採購 admin 早上設新 ERP sync(15 分鐘搞定,不用工程師);採購員 review v2 prompt 看不順眼直接微調保留 80% 加自己 20%;30 天後 admin 自動收體檢 email 知道 Phase 5 哪些功能被真的用、哪些躺著生灰。**用真實數據驅動 Phase 7 決策,不再憑想像。**

---

> **下一步**:你回覆挑哪條路線(A/B/C/D),我會把對應 Track 拆成 D1-DN 工作日 plan,跟 Phase 2-5 一樣 commit-by-commit 逐步 ship。

---

**本文作者**:Claude(基於 Phase 5 4 個 commits ship 後的觀察 + Phase 5 規劃書留下的 D/E 重評估)
**最後更新**:2026-04-26
**對應 Phase 5 規劃**:[phase5-plan.md](phase5-plan.md)
**對應主規劃**:[precious-metals-plan.md](precious-metals-plan.md) §12 Phase 5 實施成果
