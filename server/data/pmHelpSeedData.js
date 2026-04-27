/**
 * 貴金屬分析平台 — Help 說明書 seed (zh-TW source of truth)
 *
 * 對應外部規劃書:《貴重金屬價格趨勢與預測平台 v2.0(Cortex 整合版)》2026-04
 * 對應內部規劃:[docs/precious-metals-plan.md](../../docs/precious-metals-plan.md)
 *
 * Book code: 'precious-metals' (is_special=1)
 * Section ID 命名:pm-* 前綴
 * Block types: para, tip, note, table, steps, code, list, subsection, card_grid, comparison
 */

const bookCode = 'precious-metals';
const bookName = '貴金屬分析平台 使用說明書';
const bookDescription = '正崴貴重金屬(Au/Ag/Pt/Pd)情報平台 — 採購視角操作手冊與設計理念';
const bookIcon = 'gem';
const bookIsSpecial = 1;
const bookSortOrder = 10;
const bookLastModified = '2026-04-26';
// 2026-04-26 Phase 5 ship:更新 pm-architecture / pm-data-flow / pm-scheduled-tasks /
// pm-dashboards / pm-ai-agent / pm-limits-faq 六個 sections
const phase5LastModified = '2026-04-26';

const sections = [
  // ── 1. 平台簡介與設計理念 ──────────────────────────────────────────────────
  {
    id: 'pm-intro',
    sort_order: 10,
    icon: 'Sparkles',
    icon_color: 'text-amber-500',
    last_modified: '2026-04-27',  // bump:加 note 指向新「採購每日工作中心」章節
    title: '平台簡介與設計理念',
    sidebar_label: '平台簡介',
    blocks: [
      {
        type: 'para',
        text: '**貴金屬分析平台**是寄生在 Cortex 上的一組「排程 + 知識庫 + AI 戰情 + Workflow + 文件模板」,專為集團採購部解決**金價波動下的決策延遲**而設計。'
      },
      {
        type: 'subsection',
        title: '為什麼需要這個平台',
        blocks: [
          {
            type: 'para',
            text: '集團電鍍製程大量使用四種貴金屬(金 / 銀 / 鉑 / 鈀)作為鍍層原料。前陣子金價大漲、採購成本跟著大增,事業單位回頭問:「為什麼沒提前預警?下個月還會漲嗎?」採購手上只有昨天查到的 LBMA 報價和一疊 Email,**很難給出有依據的回答**。'
          },
          {
            type: 'card_grid',
            cols: 3,
            items: [
              { emoji: '⏱️', title: '被動性', desc: '事件發生後才知道,反應延遲數小時至數天' },
              { emoji: '📋', title: '手工彙整', desc: '大量時間花在「資料搬運」而非「決策分析」' },
              { emoji: '🔮', title: '預測無佐證', desc: '對事業單位的預測全憑經驗,無數據、無信心區間、無歷史類比' },
            ]
          },
        ]
      },
      {
        type: 'subsection',
        title: '平台三大設計主張',
        blocks: [
          {
            type: 'comparison',
            items: [
              {
                title: '不重建,只擴充',
                desc: '所有能力都直接用 Cortex 既有平台:排程、KB、戰情、Workflow、文件模板',
                example: '不另建獨立系統 → 維運成本最低'
              },
              {
                title: '平台原生優於客製',
                desc: '能用 prompt + 排程解決的,不寫客製程式碼;能用 Workflow DAG 拼裝的,不寫 Python',
                example: '95% 功能零新代碼'
              },
              {
                title: '使用者在熟悉介面中受益',
                desc: '採購員不用學新系統 — 在 Cortex 對話、看戰情、收 Webex 推送即可',
                example: 'Onboarding 時間 < 1 小時'
              },
            ]
          },
        ]
      },
      {
        type: 'subsection',
        title: '範圍 — 四金屬全上',
        blocks: [
          {
            type: 'table',
            headers: ['金屬', '主要用途', '採購特性'],
            rows: [
              ['金 (Au)',  '連接器端子電鍍(接觸穩定)',           '量大、價格最敏感'],
              ['銀 (Ag)',  '導電件電鍍',                         '量大、波動較大'],
              ['鉑 (Pt)',  '特殊鍍層、催化應用',                 '量較小、單價高'],
              ['鈀 (Pd)',  '取代金電鍍的降本方案',               '量中、供給易受汽車業衝擊'],
            ]
          },
          {
            type: 'note',
            text: '系統同步收集 11 個關聯金屬(含基本金屬 Cu/Al/Ni/Zn 等),戰情室「主管視角」可看全貌,但採購決策聚焦 4 大貴金屬。'
          }
        ]
      },
      {
        type: 'subsection',
        title: '解決的四個情境',
        blocks: [
          {
            type: 'card_grid',
            cols: 2,
            items: [
              { emoji: '📊', title: 'A. 每日盯盤', desc: '開 Cortex 採購 Dashboard,四金屬即時價 + 預測 + 新聞摘要一畫面 — **10 秒取代 30 分鐘**' },
              { emoji: '✍️', title: 'B. 採購決策簽核', desc: '對話問 AI「現在金價在近 30 天分位數?預測區間?」→ 截圖附簽核單,主管秒簽' },
              { emoji: '🚨', title: 'C. 重大事件應對', desc: 'Webex Bot 主動推送,含「對集團採購成本推估影響」,出差也能收到' },
              { emoji: '📑', title: 'D. 月度報告', desc: '排程自動產 PDF,含 AI 撰寫的「為什麼這個月買在這個價」解釋' },
            ]
          },
        ]
      },
      {
        type: 'tip',
        text: '⭐ **關鍵價值不在省時間,而在預警**:金價大漲時若系統提前 24 小時預警 + 建議暫緩採購,光一次事件的節省可能就覆蓋一整年的維運成本。'
      },
      {
        type: 'note',
        text: '👉 **採購每日打開的主入口** = sidebar 左側「**貴金屬情報**」(`/pm/briefing`)。詳細操作見下一章「採購每日工作中心」。'
      },
    ]
  },

  // ── 1.5. 採購每日工作中心(Phase 5 後新增的主頁)──────────────────────────
  {
    id: 'pm-briefing-page',
    sort_order: 15,
    icon: 'LayoutDashboard',
    icon_color: 'text-blue-500',
    last_modified: '2026-04-27',
    title: '採購每日工作中心(/pm/briefing)',
    sidebar_label: '每日工作中心',
    blocks: [
      {
        type: 'para',
        text: '**`/pm/briefing` 是採購員每天打開的主入口**,把「報價 → AI 重點 → 新聞 → 報告 → Prompt 審核」整合在一頁,不用跨多個畫面。Sidebar 左側點「貴金屬情報」即可進入。'
      },
      {
        type: 'tip',
        text: '👨‍💼 **權限**:跟 PM Review 共用同一套(復用「特殊說明書」分享)。admin 在「特殊說明書管理」加你進貴金屬書名單,自動就能進這個頁面 + 用 Webex PM Bot + 看 KB(若 KB 也分享給你)。'
      },

      {
        type: 'subsection',
        title: '頁面結構(由上到下 4 層)',
        blocks: [
          {
            type: 'card_grid',
            cols: 2,
            items: [
              { emoji: '🏷️', title: '1. 報價 banner(置頂常駐)', desc: '依「我的偏好」顯示關注金屬,**捲動仍可見**;[展開全部] 看 11 金屬完整清單' },
              { emoji: '⭐', title: '2. 今日 AI 綜述', desc: '從每日 09:30 排程產生的日報撈,前 250 字摘要 + [看完整日報] 展開全文 + 👍 thumbs feedback' },
              { emoji: '📑', title: '3. 4 個 Tab(內容區)', desc: '[新聞列表(預設)] [週報] [月報] [Prompt 審核] — Prompt 審核從原獨立頁整合進來,sidebar 不再多入口' },
              { emoji: '⚙️', title: '4. Top bar 操作', desc: '右上有 [⚙ 我的偏好] 設關注金屬 / 是否預設只看 24h、[⬇ 匯出 CSV] 下載 30 天價格' },
            ]
          },
        ]
      },

      {
        type: 'subsection',
        title: '4 個 Tab 詳述',
        blocks: [
          {
            type: 'subsection',
            title: '📰 新聞列表(預設打開的 tab)',
            blocks: [
              {
                type: 'para',
                text: '左側篩選器 + 右側卡片列表;每張卡片顯示「情緒色標 + 金屬 tag + 標題 + 摘要 + 來源 + 發布日期 + 釘選按鈕 + thumbs」。點標題開原文。'
              },
              {
                type: 'table',
                headers: ['篩選器', '說明'],
                rows: [
                  ['📅 日期範圍',           '快捷:[今日][24h][7d][30d];也可手動輸入 from/to'],
                  ['🪙 金屬(多選)',       '11 金屬 checkbox;預設套用「我的偏好」關注金屬'],
                  ['🌐 來源網站(多選)',    '從 pm_news 表動態抓 distinct source(Kitco/Mining/TE...)'],
                  ['😀 情緒',              '正面 / 中性 / 負面(對標的價格的影響)'],
                  ['🔍 關鍵字',            '全文搜尋(title + summary,LIKE 模糊比對)'],
                  ['⭐ 只看釘選',           '只顯示我釘選過的新聞(個人收藏)'],
                ]
              },
              {
                type: 'note',
                text: '篩選條件會**自動記住**(localStorage),下次打開預設套用上次的設定。換裝置會重來(per-user DB sync 留 v2)。'
              },
            ]
          },
          {
            type: 'subsection',
            title: '📊 週報 / 📈 月報',
            blocks: [
              {
                type: 'para',
                text: 'AI 自動生成的週度 / 月度市場分析。完整 markdown 渲染 + docx 下載。可從 dropdown 選歷史(週報展示 8 週、月報展示 12 月),整段內容 in-place 切換。'
              },
            ]
          },
          {
            type: 'subsection',
            title: '✏️ Prompt 審核',
            blocks: [
              {
                type: 'para',
                text: '原 `/pm/review` 整合進這個 tab。Tab 標題顯示 pending count badge(例「Prompt 審核 (3)」),sidebar 入口同樣顯示 badge。'
              },
              {
                type: 'note',
                text: '`/pm/review` URL 仍保留(舊 deep link / Webex Bot 通知連結不爆)。'
              },
            ]
          },
        ]
      },

      {
        type: 'subsection',
        title: '釘選功能(個人收藏)',
        blocks: [
          {
            type: 'para',
            text: '看到重要新聞 → 點卡片左上角 [📌] 釘選。釘選後:'
          },
          {
            type: 'list',
            items: [
              '寫進 DB(`pm_news_pins`),**跨裝置同步**(換手機 / 在家筆電 都看得到)',
              '篩選器 [⭐ 只看釘選] toggle 一鍵看自己收藏列表',
              '不設上限,個人 list 自己管',
              'v1 不附「為什麼釘」筆記欄位(避免複雜)',
            ]
          },
        ]
      },

      {
        type: 'subsection',
        title: '匯出功能',
        blocks: [
          {
            type: 'comparison',
            items: [
              {
                title: '📰 新聞 PDF',
                desc: '套用「當前篩選條件」匯出 — 例如先 filter「銅 + 過去 7 天 + 負面情緒」→ 點 [⬇ 匯出 PDF] 下載該批新聞',
                example: '上限 500 筆;超過會擋並提示縮小範圍。NotoSansTC 中文字型,情緒色標,含原文連結'
              },
              {
                title: '💰 價格 CSV',
                desc: 'Top bar 右上 [⬇ 匯出 CSV] 直接下載「關注金屬 30 天」價格',
                example: 'UTF-8 BOM(Excel 開不亂碼)。欄位含 as_of_date / metal / source / price_usd / day_change_pct'
              },
            ]
          },
        ]
      },

      {
        type: 'subsection',
        title: '我的偏好(右上 [⚙ 我的偏好])',
        blocks: [
          {
            type: 'para',
            text: 'V1 只兩個設定(其他靠 sticky filter 自動記憶):'
          },
          {
            type: 'list',
            items: [
              '🪙 **關注金屬**:勾選你常看的金屬(留空 = 全部都關注)。設後報價 banner + 新聞列表預設只顯示這些金屬。可隨時 [展開全部] 暫解',
              '📅 **預設只看過去 24h**:打開新聞 tab 時自動套用 24h 過濾。早晨工作節奏 friendly',
            ]
          },
          {
            type: 'note',
            text: '寫進 DB(`pm_user_preferences`),跨裝置同步。'
          },
        ]
      },

      {
        type: 'subsection',
        title: '採購典型每日流程(建議節奏)',
        blocks: [
          {
            type: 'steps',
            items: [
              { title: '08:50 通勤抵達公司', desc: 'Webex 已收到「貴金屬今日 snapshot」Card(若有訂閱),手機滑一眼有沒有大事' },
              { title: '09:00 打開電腦進 /pm/briefing', desc: '頂部報價 banner 一眼掃過自己關注金屬;若昨日報告還未滾掉先看「今日 AI 綜述」' },
              { title: '09:30 之後 daily report 生成', desc: '頂部「今日 AI 綜述」自動更新,點 [看完整日報] 看 LLM 對「為什麼今日這樣動」的解讀' },
              { title: '看新聞 tab', desc: '預設 24h + 關注金屬已自動 filter;掃 sentiment 紅色卡片優先看;有重要的 [📌] 釘選' },
              { title: '事業單位來問「下週銅?」', desc: '對話走 Cortex chat 用 `/pm-deep 銅` workflow;或進戰情看走勢 / 預測' },
              { title: '週一', desc: '進 /pm/briefing 第二 tab「週報」看上週總結 + 下週展望' },
              { title: '月初', desc: '看「月報」+ 轉寄事業單位(從報告 tab 下載 docx)' },
              { title: '月中(若有 pending)', desc: 'Prompt 審核 tab 有紅色 badge → 點進去看 LLM 想改的 prompt,approve / reject' },
            ]
          },
        ]
      },

      {
        type: 'tip',
        text: '🎯 **目標體驗**:採購早晨**進這個頁面 5 分鐘**搞定盯盤 + 看新聞 + 看 AI 重點 → 取代舊流程「開 LBMA 網頁 → 開台銀網頁 → 開 Bloomberg → 開 Email 看通知 → Excel 彙整」(原 30 分鐘)。'
      },
    ]
  },

  // ── 2. 系統邏輯與架構 ──────────────────────────────────────────────────────
  {
    id: 'pm-architecture',
    sort_order: 20,
    icon: 'Network',
    icon_color: 'text-blue-500',
    last_modified: phase5LastModified,
    title: '系統邏輯與架構',
    sidebar_label: '系統架構',
    blocks: [
      {
        type: 'para',
        text: '平台由 **10 大組件**(Phase 1-4 六個 + Phase 5 新加四個)組成,**全部跑在 Cortex 既有基礎設施上**,無新 runtime、無新 Pod。'
      },
      {
        type: 'subsection',
        title: '整體資料流',
        blocks: [
          {
            type: 'code',
            text: `   外部資料源                 Cortex 排程               知識庫(KB)               視覺化 / 對話
┌──────────────┐         ┌─────────────┐         ┌─────────────┐         ┌──────────────┐
│ 台銀 / LBMA  │ ──────→ │ [PM] 全網    │ ──────→ │ PM-原始資料庫│ ──┐     │ AI 戰情:     │
│ Metals-API   │         │ 金屬資料收集│         └─────────────┘   │     │  • 採購視角  │
│ FRED 宏觀    │         └─────────────┘                            │     │  • 主管視角  │
│ 全網新聞     │                                                    ├───→ │  • 分析師視角│
└──────────────┘         ┌─────────────┐         ┌─────────────┐   │     └──────────────┘
                          │ [PM] 每日金屬│ ──────→ │ PM-新聞庫   │ ──┘
                          │ 新聞抓取    │         └─────────────┘
                          └─────────────┘                                  ┌──────────────┐
                                                                            │ Chat Agent   │
                          ┌─────────────┐         ┌─────────────┐         │ + /pm-deep   │
                          │ [PM] 日/週/ │ ──────→ │ PM-分析庫   │ ──────→ │  Workflow    │
                          │ 月報生成     │         │  (報告 + 解│         └──────────────┘
                          └─────────────┘         │   讀)      │
                                                   └─────────────┘                  │
                                                                                    ▼
                                                                            ┌──────────────┐
                                                                            │ 文件模板     │
                                                                            │ → docx/pdf   │
                                                                            └──────────────┘`
          },
        ]
      },
      {
        type: 'subsection',
        title: '10 大組件(Phase 1-4 六個 + Phase 5 加四個)',
        blocks: [
          {
            type: 'card_grid',
            cols: 2,
            items: [
              { emoji: '⏰', title: '1. 排程任務(6 個)', desc: '每日抓資料 + 日/週/月報生成,全部標 [PM] 前綴' },
              { emoji: '📚', title: '2. 知識庫(3 個 KB)', desc: 'PM-原始資料庫 / PM-新聞庫 / PM-分析庫 — 分流原始 / 新聞 / 已分析' },
              { emoji: '📊', title: '3. AI 戰情(3 個 Topic)', desc: '採購視角 / 主管視角 / 分析師視角,Phase 5 後共 ~20 個 Design' },
              { emoji: '🤖', title: '4. Multi-Agent Workflow', desc: 'pm_deep_analysis_workflow:News + Macro + Tech → Risk → Synthesizer' },
              { emoji: '📄', title: '5. 文件模板', desc: '日報 / 週報 / 月報 docx,排程觸發後自動填入分析結果' },
              { emoji: '🔔', title: '6. Webex Bot 推送', desc: '警示 ACK Card + Phase 5 加完整 NL 對話 + 訂閱推送' },
              { emoji: '🎯', title: '7. Forecast 校驗 loop(Phase 5 B)', desc: '每 24h 算 MAPE → MAPE 排行 / 滾動戰情 + 採購員 thumbs feedback;每月 1 號 LLM 自動產 v2 prompt 進採購員 review queue,**人類 approve 才套用**' },
              { emoji: '💬', title: '8. Webex 完整對話(Phase 5 C)', desc: 'NL intent 偵測 11 金屬代碼 + 4 種 Adaptive Card(Snapshot / Forecast w/ sparkline / What-if / Help)+ 每分鐘訂閱推送' },
              { emoji: '🩺', title: '9. 健康監控 + Token 預算(Phase 5 F)', desc: 'PM 平台健康 tab 4 sub-tab:per-task success / daily_token_budget 自動 pause / 18 sources 6h 巡檢 / KB soft-archive / cost 平攤' },
              { emoji: '🔌', title: '10. ERP 真連線同步(Phase 5 A)', desc: '通用 framework:source_query + mapping_json + upsert_mode → 寫 pm_* 表;3 範本 job(BOM / 採購歷史 / 在途庫存)dry_run 預設' },
            ]
          },
        ]
      },
      {
        type: 'subsection',
        title: '與一般 Cortex 使用者的差別',
        blocks: [
          {
            type: 'comparison',
            items: [
              {
                title: '一般 Cortex 用法',
                desc: '使用者主動發問 → AI 即時回答 → 看完就走',
                example: '「今天台積電股價多少?」→ 即時回答',
                borderColor: 'border-slate-300'
              },
              {
                title: '貴金屬平台用法',
                desc: '系統**主動**抓資料 → 排程**主動**寫分析報告 → 推送到採購信箱 / Webex / 戰情 → 採購員只需「審閱 + 決策」',
                example: '每天 09:30 自動產生「金屬市場日報.docx」→ 你打開即可看到當日全分析',
                borderColor: 'border-amber-400'
              },
            ]
          },
          {
            type: 'tip',
            text: '簡單講:**這是個「會自己工作的智慧採購助理」**,不是「等你問才動的 ChatGPT」。'
          },
        ]
      },
      {
        type: 'subsection',
        title: '技術選擇 — 為什麼不引入 Python ML 服務',
        blocks: [
          {
            type: 'para',
            text: '外部規劃書原本建議用 Python (Darts/PyTorch) 做時序預測,但本平台選擇:'
          },
          {
            type: 'list',
            items: [
              '**Phase 0 PoC**:純 LLM (Gemini 3 Pro) baseline 預測 — 量 MAPE',
              '**Phase 1 MVP**:tfjs-node LSTM(Code Skill 內跑,無新 runtime)— 若 LLM MAPE 不夠用',
              '**Phase 3+**:若財務避險硬要求 MAPE < 1.5%,才評估 Python MCP Server',
            ]
          },
          {
            type: 'note',
            text: '此設計避免「為了 ML 模組引入 Python = 新 Dockerfile + 新 K8s manifest + 新 CI/CD 分支」。短期內 LLM baseline + LSTM 已足夠採購決策(目標 MAPE < 3%,非投資級)。'
          },
        ]
      },
    ]
  },

  // ── 3. 使用者角色與決策鏈 ──────────────────────────────────────────────────
  {
    id: 'pm-roles',
    sort_order: 30,
    icon: 'Users',
    icon_color: 'text-emerald-500',
    last_modified: bookLastModified,
    title: '使用者角色與決策鏈',
    sidebar_label: '角色與決策鏈',
    blocks: [
      {
        type: 'para',
        text: '本平台的使用者分三層,**不是把所有人當「同質採購人員」對待**,而是針對工作場景設計不同進入點。'
      },
      {
        type: 'table',
        headers: ['角色', '現況工作', '本平台為其提供', '主要用什麼'],
        rows: [
          [
            '**採購員**',
            '盯盤、詢價、下採購單、向事業單位回覆趨勢問題',
            'Dashboard、對話查詢、Webex 推送、決策分析截圖',
            'AI 戰情「採購視角」+ Chat Agent + Webex 推送'
          ],
          [
            '**採購主管**',
            '簽核採購單、月報審核、向高層交代成本異常',
            '月報自動化、成本異常告警、全採購部 Dashboard',
            'AI 戰情「主管視角」+ 月報 docx + 警示通道'
          ],
          [
            '**事業單位**(內部客戶)',
            '向採購要求物料成本預估',
            '採購轉寄的月報 / 特定事件影響評估',
            '主要透過採購中介,不直接登入'
          ],
        ]
      },
      {
        type: 'subsection',
        title: '決策鏈(實際 vs 規劃書原假設)',
        blocks: [
          {
            type: 'comparison',
            items: [
              {
                title: '實際決策鏈(已採訪採購部)',
                desc: '採購員自行判斷 → 主管簽核',
                example: '不拉財務 / 投資委員會,流程單純',
                borderColor: 'border-emerald-400'
              },
              {
                title: '規劃書原假設(已修正)',
                desc: '採購 + 財務 + 投資 + 管理層 四視角全開',
                example: '財務避險未被採購主動提出 → 移到 Phase 3 視需求',
                borderColor: 'border-slate-300'
              },
            ]
          },
        ]
      },
      {
        type: 'subsection',
        title: '為什麼財務 / 投資視角不在 MVP',
        blocks: [
          {
            type: 'list',
            items: [
              '採購部 2026-04-24 訪談,財務參與**未被主動提及**',
              'Foxlink 採購不涉金融投資 → 「投資 / 資產配置」視角本專案不做',
              '**Phase 3** 視需求評估財務避險 Dashboard,目前不投人力',
            ]
          },
        ]
      },
    ]
  },

  // ── 4. 資料流與每日週期 ────────────────────────────────────────────────────
  {
    id: 'pm-data-flow',
    sort_order: 40,
    icon: 'Workflow',
    icon_color: 'text-cyan-500',
    last_modified: phase5LastModified,
    title: '資料流與每日週期',
    sidebar_label: '資料流與週期',
    blocks: [
      {
        type: 'para',
        text: '系統每天的「自動工作節奏」如下,採購員打開電腦時,**所有當日素材已備齊**。'
      },
      {
        type: 'table',
        headers: ['時間', '系統動作', '產出位置', '使用者該做什麼'],
        rows: [
          ['08:00', '`[PM] 每日金屬新聞抓取` 跑',                      'PM-新聞庫',                        '不用做 — 等日報'],
          ['08:30', '`[PM] 總體經濟指標日抓` 跑',                      '宏觀指標表',                       '不用做'],
          ['09:00', '`[PM] 全網金屬資料收集` 跑(Pro 模型,深度收集)', 'PM-原始資料庫',                    '不用做'],
          ['09:30', '`[PM] 每日金屬日報` 跑(用前 3 步資料)',         'PM-分析庫 + Email + docx 下載',    '**收信看日報**(5 分鐘)'],
          ['每週一 09:30', '`[PM] 金屬市場週報` 跑',                  'PM-分析庫 + Email + docx',         '主管收信審閱'],
          ['每月 1 號 09:30', '`[PM] 金屬市場月報` 跑',               'PM-分析庫 + Email + docx',         '主管轉寄事業單位'],
          ['全天', '對話 Agent / 戰情室 隨時可問',                    '即時回應',                         '隨需查詢'],
          ['事件觸發', 'Webex Bot 主動推送(如金價大跳)',            'Webex 群組 / 個人',                '收到 → 開戰情看細節'],
          ['每分鐘(Phase 5 C)', '`pmWebexPushService` 比 schedule_hhmm', 'Webex DM(訂閱者)',           '訂閱用戶當天指定時間收 Snapshot Card'],
          ['每 5 分鐘(Phase 5 A)', '`pmErpSyncService` 找到期 active jobs 跑', 'pm_bom_metal / pm_purchase_history / pm_inventory', '不用做(admin 設好就好)'],
          ['每 1 小時(Phase 5 F5)', 'token_usage 平攤給 [PM] task', 'pm_task_token_usage',         '不用做(admin 看 PM 平台健康)'],
          ['每 6 小時(Phase 5 F3)', '18 sources HEAD/GET 巡檢', 'pm_source_health',                  '不用做(連 3 失敗 admin 收 email)'],
          ['每 24 小時(Phase 5 B1)', '`pmForecastAccuracyService` 比 7 天前 forecast vs 實際', 'pm_forecast_accuracy + 戰情 MAPE 圖', '採購員開戰情看 MAPE 排行'],
          ['每 7 天(Phase 5 F4)', '`pmKbMaintenanceService` 掃 PM-新聞庫 > 90d chunks', 'kb_chunks.archived_at(soft archive)',  '不用做(預設 dry_run)'],
          ['每月 1 號(Phase 5 B4)', '`pmPromptSelfImproveService` 跑 LLM meta-job', 'pm_prompt_review_queue',   '採購員開 `/pm/review` 審 v2 prompt'],
        ]
      },
      {
        type: 'tip',
        text: '所有排程都會把「結果文字」寫進對應 KB,所以**事後對話時 AI 可以引用歷史報告** — 例如問「上週說的供給緊張現在怎麼樣了?」AI 會自己去 PM-分析庫翻。'
      },
      {
        type: 'subsection',
        title: '排程失敗會怎樣',
        blocks: [
          {
            type: 'steps',
            items: [
              { title: '排程失敗 → Cortex 後台「排程任務」頁顯示紅色狀態',  desc: '可看 logs 找原因' },
              { title: 'Email 通知排程設定的 admin / 採購窗口',             desc: '設定見「排程任務 → 編輯 → 郵件通知」' },
              { title: 'Prompt 內若加 `__PARSE_FAIL__` 字串 → 視為解析失敗', desc: '台銀網站改版時保護機制' },
              { title: '失敗的當天 KB 不寫入',                              desc: '隔天該排程仍會跑,不會因一天失敗而停' },
            ]
          },
        ]
      },
    ]
  },

  // ── 5. 6 個排程任務說明 ───────────────────────────────────────────────────
  {
    id: 'pm-scheduled-tasks',
    sort_order: 50,
    icon: 'CalendarClock',
    icon_color: 'text-violet-500',
    last_modified: phase5LastModified,
    title: '6 個排程任務說明',
    sidebar_label: '排程任務',
    blocks: [
      {
        type: 'para',
        text: '所有排程在 Cortex 後台「**排程任務**」頁,名稱以 `[PM]` 開頭。**不要任意刪除或停用** — 互相有依賴關係。'
      },
      {
        type: 'note',
        text: '🔧 **修改 prompt 的安全做法**:每個排程的 AI Prompt 可以微調(例如改新聞關鍵字、增減金屬種類),但 **「Pipeline 步驟」 / 「工具引用」 / 「輸出檔名」不要動**,動了會破壞下游 KB 寫入。'
      },

      {
        type: 'subsection',
        title: '① [PM] 每日金屬新聞抓取',
        blocks: [
          {
            type: 'table',
            headers: ['屬性', '值'],
            rows: [
              ['排程',     '每日 08:00'],
              ['模型',     'Flash(快、便宜)'],
              ['做什麼',   '抓全網過去 24h 與 4 大貴金屬 + 11 關聯金屬有關的新聞,LLM 摘要 + 情緒分析'],
              ['寫入',     'PM-新聞庫(每筆:標題 / 來源 / 摘要 / 情緒 -1~+1 / 影響時間框架)'],
              ['下游',     '日報 / Workflow news_agent 都會 RAG 查詢這個 KB'],
            ]
          },
        ]
      },

      {
        type: 'subsection',
        title: '② [PM] 總體經濟指標日抓',
        blocks: [
          {
            type: 'table',
            headers: ['屬性', '值'],
            rows: [
              ['排程',     '每日 08:30'],
              ['模型',     'Flash'],
              ['做什麼',   '抓 DXY(美元指數)/ VIX / 10Y 美債殖利率 / WTI 原油 / 黃金 ETF 持倉量'],
              ['寫入',     '宏觀指標表(供戰情室「7 日宏觀指標趨勢」Design 用)'],
              ['下游',     'Workflow macro_agent 解讀「美元升值 = 金跌」這類關聯'],
            ]
          },
        ]
      },

      {
        type: 'subsection',
        title: '③ [PM] 全網金屬資料收集',
        blocks: [
          {
            type: 'table',
            headers: ['屬性', '值'],
            rows: [
              ['排程',     '每日 09:00'],
              ['模型',     '**Pro**(深度收集,需綜合判斷)'],
              ['做什麼',   '從台銀 / LBMA / Metals-API / Bloomberg(若有授權)抓四大貴金屬 + 11 關聯金屬即時報價,**多源比對 + 差異告警**'],
              ['寫入',     'PM-原始資料庫(每筆:metal / source / fixing_time / price_usd)'],
              ['下游',     '所有戰情 Design 的價格類圖表都讀這個 KB'],
            ]
          },
          {
            type: 'tip',
            text: '為什麼用 Pro 而不是 Flash:**多源差異告警需要綜合判斷**(例如「台銀比 LBMA 高 0.5% 是正常匯差還是異常」),Flash 容易誤報。'
          },
        ]
      },

      {
        type: 'subsection',
        title: '④ [PM] 每日金屬日報',
        blocks: [
          {
            type: 'table',
            headers: ['屬性', '值'],
            rows: [
              ['排程',     '每日 09:30(在前 3 個排程後)'],
              ['模型',     'Pro(寫報告,需要細緻語言)'],
              ['做什麼',   '讀 PM-原始資料庫 + PM-新聞庫 + 宏觀,LLM 寫一份完整日報(含「為什麼今日金價這樣動」)'],
              ['輸出',     '①寫進 PM-分析庫 ②生成 `金屬市場日報_{{date}}.docx` ③Email 給採購群組'],
              ['模板',     '見「文件模板」章節 → 日報模板'],
            ]
          },
        ]
      },

      {
        type: 'subsection',
        title: '⑤ [PM] 金屬市場週報',
        blocks: [
          {
            type: 'table',
            headers: ['屬性', '值'],
            rows: [
              ['排程',     '每週一 09:30'],
              ['模型',     'Pro'],
              ['做什麼',   '讀過去 7 天 PM-分析庫 + 全網最新趨勢,寫週度總結 + 下週展望 + 採購建議'],
              ['輸出',     '`金屬市場週報_{{date}}.docx` + Email 採購主管'],
            ]
          },
        ]
      },

      {
        type: 'subsection',
        title: '⑥ [PM] 金屬市場月報',
        blocks: [
          {
            type: 'table',
            headers: ['屬性', '值'],
            rows: [
              ['排程',     '每月 1 號 09:30'],
              ['模型',     'Pro'],
              ['做什麼',   '讀過去一個月所有資料,寫月度均價 / 高低點 / 採購時點對比 / 為什麼這個月買在這個價的解釋'],
              ['輸出',     '`金屬市場月報_{{date}}.docx` + Email 採購主管(主管可轉寄事業單位)'],
            ]
          },
        ]
      },

      {
        type: 'subsection',
        title: '常見排程設定要怎麼改',
        blocks: [
          {
            type: 'steps',
            items: [
              { title: '進 Cortex 後台 → 排程任務 → 找 `[PM] *`',                desc: '所有 PM 任務都集中在這' },
              { title: '點「編輯」開啟設定 Modal',                              desc: '看到「基本設定 / 排程 / AI 設定 / 工具引用 / Pipeline / 郵件通知」六個 tab' },
              { title: '改「模型」'                                              ,desc: 'Pro / Flash 可換,但**不要選 Image / Vision 模型** — 文字任務跑會炸' },
              { title: '改「Prompt」'                                            ,desc: '可微調語氣 / 加金屬關鍵字。`{{date}}` `{{weekday}}` 這類變數**不要刪**' },
              { title: '改「排程時間」'                                          ,desc: '注意上下游依賴,例如日報必須在前 3 個之後跑' },
              { title: '改「郵件通知」收件人'                                     ,desc: '採購窗口輪替時必改' },
            ]
          },
          {
            type: 'note',
            text: '🔒 **管理員專屬**:模型、Pipeline、工具引用 三項建議只給 IT/平台 admin 改,採購單位只改 Prompt 內容、收件人、排程時間。'
          },
        ]
      },

      {
        type: 'subsection',
        title: 'PM 平台模型設定(全域)',
        blocks: [
          {
            type: 'para',
            text: '所有 [PM] 任務的「Pro / Flash 該對應到哪個 LLM」由 admin 在「**系統管理 → PM 平台設定**」統一設,改完按儲存會自動套到所有 [PM] 任務(已被使用者個別覆寫的不會被覆蓋)。'
          },
          {
            type: 'tip',
            text: '例如想全平台從 `gemini-3-pro-preview` 換成 `gemini-3.1-pro-preview`,在這裡改一次就好,不用六個排程逐個改。'
          },
        ]
      },

      {
        type: 'subsection',
        title: 'Phase 5:每日預測校驗(系統 cron,非 user 配置)',
        blocks: [
          {
            type: 'para',
            text: '除了上面 6 個 user-facing 排程,Phase 5 起後台多了一組**內部 cron**(無法在「排程任務」頁編輯,在 server 啟動時 wire),負責 PM 平台運維 + 品質追蹤:'
          },
          {
            type: 'table',
            headers: ['cron', '頻率', '做什麼', '看哪'],
            rows: [
              ['`pmForecastAccuracyService`', '每 24h',  '比 7 天前 forecast vs 今日實際,寫 MAPE / in_band',          '戰情「各金屬 30 天 MAPE 排行」/「滾動 60 天」'],
              ['`pmPromptSelfImproveService`', '每月 1 號', '撈 30 天最差 + thumbs-down 案例餵 Pro,產 v2 prompt',       '採購員 `/pm/review` 審 → approve 才套用'],
              ['`pmSourceHealthService`',     '每 6h',   '18 個全網 source HEAD/GET 巡檢,連 3 失敗 → email admin',   'admin「PM 平台健康 → Sources」tab'],
              ['`pmTokenBudgetService`',      '每 1h',   'token_usage by owner_user_id 平攤給該 owner 當日 [PM] 任務', 'admin「PM 平台健康 → Cost」tab'],
              ['`pmKbMaintenanceService`',    '每 7d',   '掃 PM-新聞庫 > 90d chunks → soft archive(預設 dry_run)',    'admin「PM 平台健康 → KB 維護」tab'],
              ['`pmWebexPushService`',        '每 1 分鐘', '比 schedule_hhmm 推送訂閱 Snapshot Card',                  'user 在 `/pm/review` 右上角設訂閱'],
              ['`pmErpSyncService`',          '每 5 分鐘', '找到期 active jobs 跑(下節說明)',                       'admin「PM ERP 同步」tab'],
            ]
          },
          {
            type: 'note',
            text: '🔧 這些 cron **無 UI 開關**(在 [server.js](../../server/server.js) 啟動 wire);若要暫停只能 admin 改程式碼或環境變數(如 `PM_KB_ARCHIVE_DRYRUN=false`)。'
          },
        ]
      },

      {
        type: 'subsection',
        title: 'PM ERP 同步 jobs(Phase 5 A,admin 操作)',
        blocks: [
          {
            type: 'para',
            text: 'Phase 5 加入**通用 ERP 同步 framework**,把 ERP 真實 BOM / 採購歷史 / 在途庫存自動拉到 PM 本地表(取代手動 CSV)。**全部 auto-seed 為 `is_active=0` + `is_dry_run=1`**,升級不會誤連 ERP 撈大量資料,需 admin 手動啟用。'
          },
          {
            type: 'steps',
            items: [
              { title: '進 AdminDashboard → 「PM ERP 同步」tab',                desc: '看到 3 個 auto-seed 範本 job + 可新增' },
              { title: '點任一 job「編輯」',                                       desc: '檢視 source_query SQL(EBS 範本)+ mapping_json + upsert_mode + interval' },
              { title: '改 SQL(EBS customization 一定要改)',                  desc: '範本只是常見 EBS schema,實際 table 名 / 欄位需 ERP DBA 確認' },
              { title: '按「Preview」跑 SELECT 不寫',                            desc: '看前 10 row + 欄位名,對齊 mapping_json(ERP 大寫 → PM 小寫)' },
              { title: '切 `is_dry_run=0` + `is_active=1`',                      desc: '正式啟用;每 5 分鐘 tick 自動跑' },
              { title: '看「Logs」tab',                                           desc: '最近 30 次執行 status / rows / duration / error / sample_row' },
            ]
          },
          {
            type: 'table',
            headers: ['範本 job', '預設頻率', '寫到', '取代什麼'],
            rows: [
              ['`[PM-ERP] BOM 金屬含量同步`',     '每日',   '`pm_bom_metal`',         '採購單位手動上傳 CSV(Phase 1-4 做法)'],
              ['`[PM-ERP] 採購單歷史 12 月`',     '每日',   '`pm_purchase_history`',  '無 — 純新增,給 LLM「採購節奏 vs 市場價」上下文'],
              ['`[PM-ERP] 在途 + 安全庫存`',      '每 6h',  '`pm_inventory`',         '無 — 純新增,戰情「在庫 vs 7 日預測缺口」用'],
            ]
          },
          {
            type: 'note',
            text: '🔒 **安全機制**:`target_pm_table` 強制 `pm_*` 開頭(防誤刪 ERP 資料);ERP 連線走 `ReadOnlyPoolProxy`(只能 SELECT 不可能誤改);單次最多 100k rows 防爆。'
          },
        ]
      },
    ]
  },

  // ── 6. 知識庫 ────────────────────────────────────────────────────────────
  {
    id: 'pm-knowledge-bases',
    sort_order: 60,
    icon: 'Library',
    icon_color: 'text-rose-500',
    last_modified: bookLastModified,
    title: '三個知識庫的用途',
    sidebar_label: '知識庫(KB)',
    blocks: [
      {
        type: 'para',
        text: '本平台用 **3 個獨立 KB**,職責分流。對話 Agent 會自動依問題挑對應 KB(也可手動指定)。'
      },
      {
        type: 'card_grid',
        cols: 3,
        items: [
          {
            emoji: '📰',
            title: 'PM-新聞庫',
            desc: '**全網新聞 + 摘要 + 情緒分數**。問「最近有什麼影響金價的新聞」→ 查這個。每日 08:00 由排程 ① 自動更新。'
          },
          {
            emoji: '📦',
            title: 'PM-原始資料庫',
            desc: '**多源報價 + 宏觀指標**。問「昨天 LBMA 金價是多少」→ 查這個。每日 09:00 由排程 ③ 自動更新。'
          },
          {
            emoji: '📈',
            title: 'PM-分析庫',
            desc: '**已生成的日 / 週 / 月報**。問「上週說的供給緊張現在怎麼樣了」→ 查這個。排程 ④⑤⑥ 寫入。'
          },
        ]
      },
      {
        type: 'subsection',
        title: '為什麼分三個 KB 而不是一個',
        blocks: [
          {
            type: 'list',
            items: [
              '**召回精度**:檢索「金價多少」時,不該被新聞 / 報告污染',
              '**分權管理**:未來「分析庫」可能要對外部單位有條件分享,新聞庫公開無妨',
              '**寫入頻率不同**:原始資料 / 新聞每天寫;分析庫每天寫一次大文件 → 索引策略差異',
            ]
          },
        ]
      },
      {
        type: 'subsection',
        title: '在對話中引用 KB',
        blocks: [
          {
            type: 'steps',
            items: [
              { title: '進 Cortex 對話頁',                                    desc: '/' },
              { title: '右側「知識庫」面板勾選 PM-* 任一或全部',              desc: '可同時勾多個' },
              { title: '提問',                                                desc: 'AI 會自動 RAG 檢索並引用' },
              { title: '看 AI 回應的「來源」標註',                            desc: '可點開看原始 chunk' },
            ]
          },
          {
            type: 'tip',
            text: '若不確定該選哪個 KB,直接全選 — Cortex 的混合檢索會自己排序最相關的。'
          },
        ]
      },
    ]
  },

  // ── 7. AI 戰情(三視角)──────────────────────────────────────────────────
  {
    id: 'pm-dashboards',
    sort_order: 70,
    icon: 'BarChart3',
    icon_color: 'text-indigo-500',
    last_modified: phase5LastModified,
    title: 'AI 戰情(3 視角 Topic)',
    sidebar_label: 'AI 戰情視角',
    blocks: [
      {
        type: 'para',
        text: '進 Cortex 「**AI 戰情**」頁 → 找 PM-* Topic,共三個視角分別對應採購員 / 主管 / 分析師日常。'
      },

      {
        type: 'subsection',
        title: '🛒 採購視角(每日盯盤主戰場)',
        blocks: [
          {
            type: 'table',
            headers: ['Design', '看什麼', '資料來源'],
            rows: [
              ['11 金屬今日報價',         '今天所有金屬即時價 + 漲跌幅',           'PM-原始資料庫'],
              ['近 30 天 銅鋁鎳鋅 趨勢',  '基本金屬走勢',                          'PM-原始資料庫'],
              ['近 30 天 金銀鉑鈀 趨勢',  '4 大貴金屬走勢',                       'PM-原始資料庫'],
              ['未來 7 天預測走廊',       'mean + 80% 信心區間',                   'PM_FORECAST 表'],
              ['過去 24h 新聞情緒分布',   '哪些金屬被熱議 + 平均情緒',            'PM-新聞庫'],
              ['7 日宏觀指標趨勢',         'DXY / VIX / 10Y / WTI',                '宏觀指標表'],
              ['**當前在庫+在途 vs 7 日預測缺口**(Phase 5 A)', '哪些金屬要急著補貨', 'pm_inventory + forecast_history'],
            ]
          },
          {
            type: 'tip',
            text: '採購員每天打開這個 Topic 看 5 分鐘,等同舊流程 30 分鐘人工盯盤。'
          },
        ]
      },

      {
        type: 'subsection',
        title: '👔 主管視角(月度檢視)',
        blocks: [
          {
            type: 'table',
            headers: ['Design', '看什麼', '資料來源'],
            rows: [
              ['11 金屬月變化 KPI',       '本月 vs 上月變化 %,異常變化高亮',     'PM-原始資料庫'],
              ['最新報告摘要',             '最近一份月報 / 週報精要',              'PM-分析庫'],
              ['近 30 天警示記錄',         '系統觸發的所有警示時間軸',             '警示歷史表'],
              ['模型預測 vs 實際',         '預測 mean vs 實際成交價對比',          'PM_FORECAST + 實際'],
              ['**各金屬 30 天 MAPE 排行**(Phase 5 B)', '哪個金屬 LLM 預測最準/最不準', 'pm_forecast_accuracy'],
              ['**近 12 月各金屬月度採購量趨勢**(Phase 5 A)', '集團 monthly metal usage', 'pm_purchase_history'],
              ['**採購均單價 vs 市場價**(Phase 5 A)', '採購擇時是否打中低點', 'pm_purchase_history JOIN pm_price_history'],
              ['**本月安全庫存達成率**(Phase 5 A)', 'NVL(onhand) / safety_stock', 'pm_inventory'],
            ]
          },
        ]
      },

      {
        type: 'subsection',
        title: '🔬 分析師視角(深度挖掘)',
        blocks: [
          {
            type: 'table',
            headers: ['Design', '看什麼', '資料來源'],
            rows: [
              ['同金屬多源價差',           '台銀 vs LBMA vs Metals-API 差異',       'PM-原始資料庫'],
              ['估算誤差追蹤',             '預測值偏離實際的趨勢',                 'PM_FORECAST + 實際'],
              ['**預測 MAPE 滾動 60 天**(Phase 5 B)', '模型品質是否退化',         'pm_forecast_accuracy'],
              ['**預測 vs 實際(個別金屬)**(Phase 5 B)', 'line w/ in_band 帶 80% 區間命中標記', 'pm_forecast_accuracy'],
            ]
          },
          {
            type: 'note',
            text: '分析師視角主要給 IT / 平台維運觀察「模型品質」是否退化。一般採購不需常看。'
          },
        ]
      },

      {
        type: 'subsection',
        title: '在戰情室自定義新圖表',
        blocks: [
          {
            type: 'steps',
            items: [
              { title: '進 PM-* Topic',                                  desc: '選對應視角' },
              { title: '右上「新增 Design」',                             desc: '進設計編輯器' },
              { title: '寫 NL 問題,例:「過去 90 天黃金月均價 by month」', desc: 'Cortex 自動 NL→SQL' },
              { title: '選圖表類型(line / bar / heatmap)',              desc: '可預覽再儲存' },
              { title: '釘進 Topic',                                      desc: '其他人也看得到' },
            ]
          },
        ]
      },
    ]
  },

  // ── 8. AI Agent 與 pm_deep workflow ───────────────────────────────────────
  {
    id: 'pm-ai-agent',
    sort_order: 80,
    icon: 'Bot',
    icon_color: 'text-orange-500',
    last_modified: phase5LastModified,
    title: 'AI 對話 Agent 與深度分析',
    sidebar_label: 'AI 對話 / pm_deep',
    blocks: [
      {
        type: 'para',
        text: '日常隨需查詢直接走 Cortex 對話。**重要決策前**用 `/pm-deep` 觸發 5-Agent 深度分析 workflow。'
      },

      {
        type: 'subsection',
        title: '一般對話 — 適合的問題',
        blocks: [
          {
            type: 'list',
            items: [
              '「現在金價多少?與上週同期比?」 — 1 秒回',
              '「未來 7 天黃金預測區間?」 — 直接讀 PM_FORECAST',
              '「上週月報講了什麼?」 — RAG PM-分析庫',
              '「本月鈀金為什麼大跌?」 — RAG PM-新聞庫 + 分析',
            ]
          },
          {
            type: 'tip',
            text: '記得在右側面板**勾選 PM-* KB**,不然 AI 看不到你的專屬資料。'
          },
        ]
      },

      {
        type: 'subsection',
        title: '深度分析 — `/pm-deep` Workflow',
        blocks: [
          {
            type: 'para',
            text: '需要寫採購建議 / 簽核附件 / 對事業單位說明 時,啟動 **`pm_deep_analysis_workflow`** — 它會跑 5 個 Agent 並行 / 串接,產出整合分析。'
          },
          {
            type: 'code',
            text: `   start ─┬─→ news_agent ──┐
          ├─→ macro_agent ─┼─→ risk_agent ─→ synthesizer ─→ output
          └─→ tech_agent ──┘`
          },
          {
            type: 'table',
            headers: ['Agent', '角色', '模型'],
            rows: [
              ['news_agent',     '撈 24-48h 新聞 + 情緒判斷 + 影響時間框架',  'Flash(平行)'],
              ['macro_agent',    '解讀 DXY/VIX/10Y 對標的的影響',             'Flash(平行)'],
              ['tech_agent',     '技術面分析(MA / RSI / 支撐壓力)',         'Flash(平行)'],
              ['risk_agent',     '收三個 agent 結果 → 風險矩陣',              'Flash'],
              ['synthesizer',    '寫整合分析報告(可直接附簽核)',            '**Pro**(品質要求高)'],
            ]
          },
          {
            type: 'subsection',
            title: '怎麼觸發',
            blocks: [
              {
                type: 'steps',
                items: [
                  { title: '在對話框輸入 `/pm-deep [標的或問題]`',  desc: '例:`/pm-deep 黃金 是否該本月加碼採購`' },
                  { title: '系統跑 5-agent(約 30-60 秒)',         desc: '右側顯示各 agent 即時進度' },
                  { title: '最終 synthesizer 輸出整合報告',         desc: '含結論 + 信心度 + 建議行動' },
                  { title: '可截圖 / 匯出 PDF 附簽核單',            desc: '主管秒簽' },
                ]
              },
            ]
          },
          {
            type: 'note',
            text: '**完全 LLM-based,無 Python ML 依賴**。預測精度 < tfjs-node LSTM,但「綜合解讀」品質遠高於單一模型。'
          },
        ]
      },

      {
        type: 'subsection',
        title: 'Pro vs Flash 怎麼選',
        blocks: [
          {
            type: 'comparison',
            items: [
              {
                title: 'Pro',
                desc: '要寫報告 / 解釋 / 推理綜合判斷時用',
                example: '「分析下週金價走勢並給採購建議」',
                borderColor: 'border-amber-400'
              },
              {
                title: 'Flash',
                desc: '查單點數據 / 簡單問答時用,快 5 倍便宜 10 倍',
                example: '「現在金價多少」「LBMA 收盤價」',
                borderColor: 'border-blue-300'
              },
            ]
          },
          {
            type: 'tip',
            text: '不確定時:左下角「reasoning effort」選 medium,系統會自動判斷該給多深的 thinking budget。'
          },
        ]
      },

      {
        type: 'subsection',
        title: 'Webex Bot 直接對話(Phase 5 C)',
        blocks: [
          {
            type: 'para',
            text: '不想開瀏覽器、出差路上、會議空檔 — 直接在 **Webex DM** 對 PM Bot 打中文/英文,**1 秒回 Adaptive Card**(short-circuit 不打 LLM,**零 token 成本**)。'
          },
          {
            type: 'table',
            headers: ['打什麼', '回什麼', '備註'],
            rows: [
              ['`top 5` / `快照` / `今日金價`',         'Snapshot Card:Top 5 metals 報價 + 漲跌% + Forecast 按鈕',       '採購最常打,5 秒掌握全貌'],
              ['`Au` / `銅` / `Cu` / `金`',            'Latest 報價 Card',                                              '11 金屬代碼別名,中/英/縮寫都認'],
              ['`銅 預測` / `Cu forecast` / `Au 7 day`', 'Forecast Card:7-day forecast + 信心區間 + Unicode sparkline ▁▂▃▄▅▆▇█ + What-if 按鈕', 'sparkline 用 monospace,不需 server 渲染'],
              ['`銅 +10%` / `what if Cu -5%` / `銀 漲 10%`', 'What-if Card:當前 vs 模擬價 + JOIN pm_bom_metal 算 cost impact', 'BOM 為空回「需 BOM 才能算」'],
              ['`/pm help`',                            'Help Card:列所有可用指令',                                       '忘記指令時打'],
            ]
          },
          {
            type: 'tip',
            text: 'Adaptive Card 上的「Forecast」/「What-if」按鈕也是 short-circuit,**直接觸發下一張 Card 不用打字**。'
          },
          {
            type: 'subsection',
            title: '訂閱每日 Snapshot 推送',
            blocks: [
              {
                type: 'steps',
                items: [
                  { title: '進 web `/pm/review` 頁',                              desc: '需有 `precious-metals` 特殊說明書權限' },
                  { title: '右上角「Webex 訂閱」按鈕 → 開 modal',               desc: '設 `kind=daily_snapshot` + `schedule_hhmm`(如 `09:00`)' },
                  { title: '儲存後,每分鐘 cron 比 schedule_hhmm 自動推',       desc: 'last_sent_date 防一日多發,server 重啟 idempotent' },
                  { title: '需先跟 PM Bot 對過話',                                desc: '系統自動找該 user 的 DM roomId(從 webex_sessions);沒對過話 → skip' },
                ]
              },
              {
                type: 'note',
                text: '訂閱表 UNIQUE (user_id, kind),重複 POST 視為更新。停止訂閱:同 modal 按 DELETE。'
              },
            ]
          },
          {
            type: 'subsection',
            title: 'PM intent 沒中怎麼辦',
            blocks: [
              {
                type: 'para',
                text: 'NL intent 偵測沒中(99% 一般對話 / 開放問題)→ **fall through 到既有 LLM 流程**,行為跟 Phase 4 一模一樣,有 RAG 也有對話歷史。**所有 PM intent short-circuit 也會寫 `chat_messages`** → web chat session 看得到完整 Webex 對話歷史。'
              },
            ]
          },
        ]
      },
    ]
  },

  // ── 9. 文件模板 ──────────────────────────────────────────────────────────
  {
    id: 'pm-doc-templates',
    sort_order: 90,
    icon: 'FileText',
    icon_color: 'text-teal-500',
    last_modified: bookLastModified,
    title: '文件模板(日 / 週 / 月報)',
    sidebar_label: '文件模板',
    blocks: [
      {
        type: 'para',
        text: '排程跑完會自動生成 docx,**不需手動下載**(Email 會帶連結)。模板由 admin 維護,可改格式 / Logo / 公司抬頭。'
      },
      {
        type: 'table',
        headers: ['模板', '觸發', '檔名格式', '誰收件'],
        rows: [
          ['日報',  '排程 ④ 每日 09:30',     '`金屬市場日報_2026-04-26.docx`',  '採購群組'],
          ['週報',  '排程 ⑤ 每週一 09:30',   '`金屬市場週報_2026-04-26.docx`',  '採購主管'],
          ['月報',  '排程 ⑥ 每月 1 號 09:30', '`金屬市場月報_2026-04-26.docx`',  '採購主管(轉事業單位)'],
        ]
      },
      {
        type: 'subsection',
        title: '改模板格式',
        blocks: [
          {
            type: 'steps',
            items: [
              { title: 'Cortex 後台 → 文件模板',                                desc: '找 PM-日報 / PM-週報 / PM-月報' },
              { title: '下載既有模板 .docx → 用 Word 改格式',                  desc: '改字型 / Logo / 章節順序' },
              { title: '保留 `{{變數}}` 標記不要動',                            desc: '例 `{{date}}` `{{summary}}` `{{forecast}}`' },
              { title: '上傳新模板 → 下次排程自動用新版',                      desc: '無需改排程設定' },
            ]
          },
          {
            type: 'note',
            text: '若要新增變數,需同時改模板 + 改排程的 Pipeline 「填模板」節點 input 欄位 — 找 IT/admin 處理。'
          },
        ]
      },
    ]
  },

  // ── 10. 限制、免責、FAQ ──────────────────────────────────────────────────
  {
    id: 'pm-limits-faq',
    sort_order: 100,
    icon: 'AlertCircle',
    icon_color: 'text-red-500',
    last_modified: phase5LastModified,
    title: '限制、免責與 FAQ',
    sidebar_label: '限制 / 免責 / FAQ',
    blocks: [
      {
        type: 'subsection',
        title: '⚠️ 重要免責',
        blocks: [
          {
            type: 'note',
            text: '本平台所有預測 / 分析 / 採購建議**僅供決策參考**,不構成投資建議或交易保證。實際採購仍須採購員 + 主管專業判斷,並對結果負責。'
          },
          {
            type: 'list',
            items: [
              '預測 MAPE 目標 < 3%(採購決策級),**非投資級**(投資級需 < 1.5%,本平台不做)',
              '黑天鵝事件(戰爭 / 疫情 / 政策突變)時模型一律失準,以人為判斷為準',
              '台銀 / LBMA 等資料源若中斷或改版,**短期可能無資料** — 系統會在戰情顯示「資料延遲」標記',
              'AI 撰寫的「為什麼今日金價這樣動」屬事後解讀,非因果證明',
            ]
          },
        ]
      },

      {
        type: 'subsection',
        title: '已知限制',
        blocks: [
          {
            type: 'table',
            headers: ['項目', '限制', '計畫處理'],
            rows: [
              ['預測時間範圍',     '未來 7 天內預測較準,> 14 天精度大幅下降',          'Phase 3 引入 Python MCP 時改善'],
              ['新聞情緒分數',     'LLM 判斷有主觀性,同一新聞不同模型分數差 0.2 內',  '可接受 — 趨勢用,非絕對'],
              ['Webex 推送',       '目前僅推送高優先警示(L3+),L1/L2 收 Email',      'Phase 3 開放細粒度設定'],
              ['BOM 成本傳導',     '無法自動算「金價漲 1% → 連接器成本變多少」',       'Phase 3 待製造部提供 BOM 含金量資料'],
              ['What-if 模擬',     '不能跑「假設金價跌 5% 模擬」',                     'Phase 3 視需求'],
            ]
          },
        ]
      },

      {
        type: 'subsection',
        title: '常見問題 FAQ',
        blocks: [
          {
            type: 'subsection',
            title: 'Q1: 為什麼今天日報沒收到?',
            blocks: [
              {
                type: 'list',
                items: [
                  '檢查 Cortex 後台「排程任務」→ 找 `[PM] 每日金屬日報` → 看狀態',
                  '若紅色失敗 → 看「執行記錄」找錯誤(通常是台銀網站改版或 Metals-API 額度用完)',
                  '若綠色成功但你沒收到 → 檢查 Email 設定的「收件人」是否含你',
                  '緊急時可手動「立即執行」一次',
                ]
              },
            ]
          },

          {
            type: 'subsection',
            title: 'Q2: 預測值看起來很怪,可信嗎?',
            blocks: [
              {
                type: 'list',
                items: [
                  '看戰情「未來 7 天預測走廊」的**信心區間**(80% 區間越窄越可信)',
                  '對照「模型預測 vs 實際」Design 看歷史準度',
                  '若對該日預測有疑問,**用 `/pm-deep` 跑深度分析比對**',
                  '黑天鵝事件期間(如重大地緣政治)模型必失準,以新聞 + 經驗判斷',
                ]
              },
            ]
          },

          {
            type: 'subsection',
            title: 'Q3: 我想加新的金屬(例如鋰、稀土)',
            blocks: [
              {
                type: 'list',
                items: [
                  '聯絡 IT/admin → 評估資料源可得性(LBMA 沒鋰價,要找專門源)',
                  'IT 確認後改 ① / ③ 排程的 Prompt 加金屬代碼',
                  '同步加進戰情圖表(自定義 Design)',
                  '**勿自行改排程 prompt** — 容易破壞下游 KB 寫入',
                ]
              },
            ]
          },

          {
            type: 'subsection',
            title: 'Q4: 我能讓事業單位也登入看戰情嗎?',
            blocks: [
              {
                type: 'list',
                items: [
                  '本平台分享範圍由 admin 在「**特殊說明書管理**」/「**戰情 Topic 分享**」設定',
                  '預設**只限採購部**,事業單位需 admin 個別授權',
                  '推薦做法:採購主管轉寄月報 docx 給事業單位(已有 AI 寫好的解釋),不直接給戰情權限',
                ]
              },
            ]
          },

          {
            type: 'subsection',
            title: 'Q5: 排程跑很久或卡住怎麼辦?',
            blocks: [
              {
                type: 'list',
                items: [
                  '`[PM] 全網金屬資料收集` 用 Pro 模型 + 多源,正常需 2-5 分鐘,不算卡',
                  '> 10 分鐘未完成 → 後台「立即取消」+ 看 logs',
                  '常見原因:LLM API 限流(切 Flash 試)/ 外部資料源 timeout',
                ]
              },
            ]
          },

          {
            type: 'subsection',
            title: 'Q6: 預測準不準怎麼知道?(Phase 5 B)',
            blocks: [
              {
                type: 'list',
                items: [
                  '進 AI 戰情「**主管視角**」→「**各金屬 30 天 MAPE 排行**」Design 一眼看哪個金屬模型準',
                  '進「**分析師視角**」→「**預測 MAPE 滾動 60 天**」看模型品質是否退化',
                  '看「**預測 vs 實際(個別金屬)**」line w/ in_band — 80% 信心區間命中率(灰色 band 包住實際線就算命中)',
                  '對某次預測有意見 → 在報告 / forecast viewer 按 **thumbs up/down + comment**,系統會把 thumbs-down 收進每月 self-improve 案例池',
                  '某金屬連 3 天 |MAPE| > 30% → 系統自動發 alert(`pm_mape_streak`)+ 進 `/pm/review` queue 等採購員審 v2 prompt',
                ]
              },
              {
                type: 'tip',
                text: '**MAPE 目標 < 3%**(採購決策級);> 5% 就要警覺,> 10% 連續多日要找 IT 調 prompt 或考慮換模型。'
              },
            ]
          },

          {
            type: 'subsection',
            title: 'Q7: 如何設定每日 token 預算上限避免失控?(Phase 5 F2)',
            blocks: [
              {
                type: 'list',
                items: [
                  '進 AdminDashboard →「**PM 平台健康**」tab →「**Tasks**」sub-tab',
                  '找對應 [PM] 任務 → 「**daily_token_budget**」欄位**行內編輯**(填 token 數,如 `200000`)',
                  '排程下次跑前會 check;當天用量 > budget → 自動 `token_budget_paused_at = now`,當天跳過',
                  '隔日 00:00 自動解除(不用人工 reset);觸發瞬間 email admin(ADMIN_NOTIFY_EMAIL)',
                  '想立刻解除 → 同 tab 按「Clear pause」按鈕',
                ]
              },
              {
                type: 'note',
                text: '🔢 **預算估算**:Pro 模型一次完整月報約 80k-150k tokens;Flash 一次新聞抓取約 20k-40k tokens。日報 budget 建議 `300000`,週報 `500000`,月報 `1000000`。'
              },
            ]
          },

          {
            type: 'subsection',
            title: 'Q8: ERP 真採購歷史怎麼接?(Phase 5 A)',
            blocks: [
              {
                type: 'list',
                items: [
                  '進 AdminDashboard →「**PM ERP 同步**」tab',
                  '找 auto-seed 範本「`[PM-ERP] 採購單歷史 12 月`」→ 編輯',
                  'EBS 標準範本 SQL(`PO_LINES_ALL JOIN PO_HEADERS_ALL`)**幾乎一定要改** — 各廠 customization 不同',
                  '改完 SQL → 按「**Preview**」跑 SELECT 不寫,看前 10 row 確認欄位對',
                  '對齊 `mapping_json`(ERP 大寫欄位 → PM 小寫欄位),沒 mapping 的欄位用全欄 lowercase',
                  '切 `is_dry_run=0` + `is_active=1` → 每 5 分鐘 tick 自動跑',
                  '看「Logs」看執行記錄;戰情「採購均單價 vs 市場價」會即時用新資料',
                ]
              },
              {
                type: 'note',
                text: '🔒 ERP 連線走 `ReadOnlyPoolProxy`,**只能 SELECT 不可能誤改 ERP 資料**;target table 強制 `pm_*` 開頭防誤刪。'
              },
            ]
          },

          {
            type: 'subsection',
            title: 'Q9: Webex 訂閱每日 Snapshot 怎麼設?(Phase 5 C)',
            blocks: [
              {
                type: 'list',
                items: [
                  '**先決條件**:你有 `precious-metals` 特殊說明書讀取權限(admin 在「特殊說明書管理」設)',
                  '**先決條件**:你已經跟 PM Bot 對過至少一次話(系統才有你的 DM roomId)',
                  '進 web `/pm/review` 頁(sidebar「PM 審核」入口) → 右上角「**Webex 訂閱**」按鈕',
                  '開 modal → 設 `kind=daily_snapshot` + `schedule_hhmm`(格式 `HH:MM`,如 `09:00`)→ 儲存',
                  '每分鐘 cron 比 schedule_hhmm,到時間自動 DM 推 Snapshot Card(4 大貴金屬 + 4 基本金屬)',
                  '想停止 → 同 modal 按 DELETE',
                ]
              },
              {
                type: 'tip',
                text: '訂閱表 UNIQUE per (user_id, kind),重複 POST 視為更新時間。`last_sent_date` 防一日多發,server 重啟 idempotent 不會重複推。'
              },
            ]
          },
        ]
      },

      {
        type: 'tip',
        text: '📞 **找誰幫忙**:Prompt / 排程內容問題 → 找平台 admin。資料源 / 新增金屬 / 模型選擇 → 找 IT。採購流程整合 / 模板格式 → 找採購主管。'
      },
    ]
  },
];

module.exports = {
  bookCode,
  bookName,
  bookDescription,
  bookIcon,
  bookIsSpecial,
  bookSortOrder,
  bookLastModified,
  sections,
};
