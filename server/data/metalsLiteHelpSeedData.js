/**
 * 金屬情報(精簡版)— Help 說明書 seed (zh-TW source of truth)
 *
 * 對應頁面:/metals(client/src/pages/MetalsPage.tsx)
 * 設計規劃:docs/metals-lite-plan.md
 *
 * Book code: 'metals-public' (is_special=1)
 * Section ID 命名:pml-* 前綴(precious metals lite)
 *
 * 目標讀者:事業單位 / PM / 行政,**非採購**;
 *           採購請看「貴金屬分析平台」完整版說明書。
 */

const bookCode = 'metals-public';
const bookName = '金屬情報(精簡版)使用說明書';
const bookDescription = '一般 user 的金屬報價 / 走勢 / 新聞 / AI 速查入口 — /metals 頁操作手冊';
const bookIcon = 'gem';
const bookIsSpecial = 1;
const bookSortOrder = 50;
const bookLastModified = '2026-05-20';  // 新聞放大 + 天數 selector + 日期切換 + 附件下載

const sections = [
  // ── 1. 平台簡介 ────────────────────────────────────────────────────────────
  {
    id: 'pml-intro',
    sort_order: 10,
    icon: 'Sparkles',
    icon_color: 'text-amber-500',
    last_modified: '2026-05-11',
    title: '平台簡介',
    sidebar_label: '平台簡介',
    blocks: [
      {
        type: 'para',
        text: '**金屬情報精簡版**是 Foxlink 集團採購部開放給**一般 user**(事業單位 / PM / 行政)的金屬市場資訊速查介面。所有資料來自採購部既有的「貴金屬分析平台」,精簡版只把跟一般 user 有關的部分撈出來,加上 AI 問答助理,讓非採購背景的同仁也能快速掌握金價動態。'
      },
      {
        type: 'card_grid',
        cols: 3,
        items: [
          { emoji: '💲', title: '當日報價', desc: '11 種金屬美元等價價格 + 日/週/月漲跌' },
          { emoji: '📈', title: '歷史走勢', desc: '10 年內任意區間 + 8 種股市風技術指標' },
          { emoji: '🤖', title: 'AI 問答', desc: '直接問「銅最近怎麼了」,AI 帶資料回答' },
        ]
      },
      {
        type: 'subsection',
        title: '跟採購完整版的差別',
        blocks: [
          {
            type: 'comparison',
            items: [
              {
                title: '採購完整版 (/pm/briefing)',
                desc: '採購人員每日工作中心 — 編輯週月報、Prompt 審核、警示 ACK、預測校驗、ERP 同步管理',
                example: '需要 precious-metals 權限'
              },
              {
                title: '精簡版 (/metals)(你在這)',
                desc: '一般 user 速查 — 只看「採購已發布的版本」、AI 問答(限縮金屬範圍)、不能修改任何資料',
                example: '需要 metals-public 權限'
              },
            ]
          },
          {
            type: 'tip',
            text: '若你**同時擁有兩個權限**(採購人員可同時看),sidebar「貴金屬情報」點下去預設進完整版,完整版 top bar 有「**精簡視角預覽**」按鈕可切到 /metals,看一般 user 看到什麼。'
          },
        ]
      },
      {
        type: 'note',
        text: '🔍 **資料來源**:11 種金屬報價由採購部排程每天 06:00 從 LME / 台銀 / Westmetall / Johnson Matthey / TradingEconomics 等公開源抓取,**非投資建議**,僅供集團內部採購情報參考。'
      },
    ]
  },

  // ── 2. 取得閱讀權限 ───────────────────────────────────────────────────────
  {
    id: 'pml-access',
    sort_order: 20,
    icon: 'KeyRound',
    icon_color: 'text-emerald-500',
    last_modified: '2026-05-11',
    title: '取得閱讀權限',
    sidebar_label: '權限',
    blocks: [
      {
        type: 'para',
        text: '看到本說明書代表你已經有閱讀權限,不用再申請。若同事看不到 sidebar 的「貴金屬情報」入口,**請他洽採購窗口或 admin** 加入分享名單。'
      },
      {
        type: 'subsection',
        title: '誰能管理閱讀名單',
        blocks: [
          {
            type: 'list',
            items: [
              '**Admin**:從「特殊說明書管理」加入 / 移除',
              '**採購人員**(完整版權限者):從 `/pm/briefing` top bar 「📌 精簡版分享」按鈕管理',
              '兩邊改的是同一份名單,即時同步。',
            ]
          },
          {
            type: 'tip',
            text: '💡 **建議用部門 / 角色整批授權**,而非單一 user — 人事異動會自動跟。例:把整個「X4 資訊工程處」加進來,新進員工自動有權限,離職自動失效。'
          },
        ]
      },
    ]
  },

  // ── 3. 介面概覽 ────────────────────────────────────────────────────────────
  {
    id: 'pml-layout',
    sort_order: 30,
    icon: 'LayoutGrid',
    icon_color: 'text-blue-500',
    last_modified: '2026-05-11',
    title: '介面概覽 — 三欄 layout',
    sidebar_label: '介面概覽',
    blocks: [
      {
        type: 'para',
        text: '/metals 採用 **Bloomberg Terminal 風格三欄 layout**,桌機 ≥ 1280px 解析度下最舒適。本平台暫未支援手機,行動端會引導你回主對話。'
      },
      {
        type: 'card_grid',
        cols: 3,
        items: [
          { emoji: '🪙', title: '左欄 — 報價', desc: '基本金屬(LME 6 種)+ 貴金屬(5 種)雙 block,一行一金屬' },
          { emoji: '📊', title: '中欄 — 走勢圖', desc: '兩個獨立 chart(LME / 貴金屬),時間區間 + 技術指標' },
          { emoji: '📰', title: '右欄 — 宏觀/新聞', desc: '宏觀指標單欄 + 今日新聞 / 週報 / 月報 tab' },
        ]
      },
      {
        type: 'subsection',
        title: 'Top bar 工具列',
        blocks: [
          {
            type: 'table',
            headers: ['按鈕', '用途'],
            rows: [
              ['← 返回', '回到上一頁(從 sidebar 進來則回對話)'],
              ['📅 日期切換', '預設「DB 最新有資料日」;‹ › 步進前後一天;直接點 input 改任意日;「最新」按鈕跳回最新日'],
              ['💬 AI 分析', '開啟右側 AI 問答 drawer(Esc 關閉)'],
              ['⚙ 我的偏好', '勾選你關注的金屬,影響報價/走勢圖顯示範圍'],
              ['⬇ 匯出 XLSX', '匯出當日金屬報價 + 宏觀數據 + 說明(3 sheet)'],
              ['→ 採購完整版', '**僅採購人員可見** — 切到 /pm/briefing 完整版'],
            ]
          },
        ]
      },
    ]
  },

  // ── 4. 左欄 — 金屬報價 ───────────────────────────────────────────────────
  {
    id: 'pml-prices',
    sort_order: 40,
    icon: 'Coins',
    icon_color: 'text-amber-600',
    last_modified: '2026-05-11',
    title: '左欄:金屬報價',
    sidebar_label: '報價',
    blocks: [
      {
        type: 'para',
        text: '左欄分**基本金屬(LME)黃色** 與 **貴金屬綠色** 兩 block,每 block 內每種金屬佔一橫排,從左到右依序顯示:'
      },
      {
        type: 'table',
        headers: ['欄位', '說明'],
        rows: [
          ['代碼', '金屬國際代碼(AU 金 / AG 銀 / CU 銅 …)'],
          ['中文名', '對應中文'],
          ['USD', '當日美元等價價格(自動換算)'],
          ['D %', '相對前一日的漲跌 %(綠升 / 紅降)'],
          ['W %', '相對 7 天前的漲跌 %'],
          ['M %', '相對 30 天前的漲跌 %'],
        ]
      },
      {
        type: 'subsection',
        title: '操作',
        blocks: [
          {
            type: 'list',
            items: [
              '**點任一卡片** → 中欄走勢圖切到該金屬',
              'D / W / M 顯示 「—」 表示該區間沒對應日期的資料(常見於 DB 還沒累積夠長)',
              '整列灰底淡化 = 該金屬今天沒抓到資料(scraper 失敗或非交易日)',
              '若你在「我的偏好」勾選了金屬子集,只會顯示勾的那幾個(順序不變)',
            ]
          },
          {
            type: 'tip',
            text: '💡 **基本金屬(LME)**:銅 / 鋁 / 鎳 / 鋅 / 鉛 / 錫 — 來自倫敦金屬交易所(LME)正式 settlement,由德國 Westmetall 公開轉貼。'
          },
          {
            type: 'tip',
            text: '💡 **貴金屬**:金 / 銀 / 鉑 / 鈀 / 銠 — 金從台灣銀行黃金存摺、銀從 Westmetall LBMA Fixing、Pt/Pd/Rh 從 Johnson Matthey Base Price RSS。'
          },
        ]
      },
    ]
  },

  // ── 5. 中欄 — 走勢圖 ─────────────────────────────────────────────────────
  {
    id: 'pml-chart',
    sort_order: 50,
    icon: 'TrendingUp',
    icon_color: 'text-violet-500',
    last_modified: '2026-05-11',
    title: '中欄:走勢圖',
    sidebar_label: '走勢圖',
    blocks: [
      {
        type: 'para',
        text: '兩個 chart 對應左欄兩 block(基本金屬黃帶 / 貴金屬綠帶)。每個 chart 含「主圖 — 價格折線」+ 「副圖 — RSI / MACD(可選)」。'
      },
      {
        type: 'subsection',
        title: '時間區間切換',
        blocks: [
          {
            type: 'list',
            items: [
              '**chip 預設值**:近 10 年 / 近 1 年 / 近 6 月 / 近 3 月 / 近 1 月',
              '**自訂**:點「自訂」後出現 from/to date picker',
              '區間終點固定為 top bar 設的 viewDate(預設 DB 最新有資料日)',
              '**X 軸 scale 永遠反映選的區間**,即使該區間 DB 資料不足也會撐開,讓視覺直覺',
              '**標題旁的「N 筆 / D 天」徽章**告訴你 DB 該金屬此區間有多少筆資料(N 越大越值得分析)',
            ]
          },
        ]
      },
      {
        type: 'subsection',
        title: '技術指標(預設全 off,勾起來才畫)',
        blocks: [
          {
            type: 'table',
            headers: ['指標', '說明', '需要至少筆數'],
            rows: [
              ['MA20', '20 日簡單移動平均(短期趨勢)', '20'],
              ['MA60(季)', '60 日均線(季線,中期趨勢)', '60'],
              ['MA120(半年)', '120 日均線(中長期)', '120'],
              ['MA240(年)', '240 日均線(年線,長期趨勢)', '240'],
              ['EMA20', '20 日指數移動平均(對近期反應更快)', '20'],
              ['BOLL 布林', '20 日均線 ± 2 標準差通道(波動率帶)', '20'],
              ['RSI(副圖)', '相對強弱指數(>70 超買、<30 超賣)', '15'],
              ['MACD(副圖)', '快慢 EMA 差 + 訊號線(動量轉折)', '35'],
            ]
          },
          {
            type: 'note',
            text: '**資料不足時 toggle 會灰掉**,hover 顯示「需要至少 N 筆資料(目前 X 筆)」。這是因為移動平均需要累積足夠歷史才能算出第一個值。DB 累積資料越久,長 period 指標(MA240 年線)就自然解鎖。'
          },
        ]
      },
      {
        type: 'subsection',
        title: '疊加比較(多金屬同 chart)',
        blocks: [
          {
            type: 'list',
            items: [
              '**右鍵點金屬代碼** → 加入疊加比較(最多 2 條)',
              '**再右鍵一次** → 取消疊加',
              '**只能跨同 block 比較**(基本金屬 chart 內只能跟基本金屬比、貴金屬只能跟貴金屬比)— 避免單位 / 數量級差太大擠壓視覺',
              '疊加 ≥ 3 條時 Y 軸自動切 log scale(避 PB ~$2k 跟 SN ~$50k 量級差 25 倍)',
            ]
          },
        ]
      },
      {
        type: 'tip',
        text: '🖱️ **chart 操作**:滾輪 = 縮放 / 拖曳 = 平移 / 底下 slider 也可拖曳調整顯示範圍。Tooltip 跟著滑鼠顯示具體日期與價格。'
      },
    ]
  },

  // ── 6. 右欄 — 宏觀 / 新聞 / 週月報 ───────────────────────────────────────
  {
    id: 'pml-right-column',
    sort_order: 60,
    icon: 'Newspaper',
    icon_color: 'text-rose-500',
    last_modified: '2026-05-20',
    title: '右欄:宏觀數據 / 新聞 / 週月報',
    sidebar_label: '宏觀 / 新聞',
    blocks: [
      {
        type: 'subsection',
        title: '📈 宏觀數據(上半)',
        blocks: [
          {
            type: 'para',
            text: '影響金屬價格的 7 個總體指標,每行顯示「代碼 / 中文名 / 數值 / 當日漲跌 %」,右側 ❓ icon 點開可看名詞解釋。'
          },
          {
            type: 'table',
            headers: ['代碼', '說明 + 對金屬影響'],
            rows: [
              ['DXY', '**美元指數** — 衡量美元相對 6 種主要貨幣強弱。DXY 漲 → 美元走強 → 通常壓抑黃金 / 銅等以美元計價的大宗商品'],
              ['EURUSD', '**歐元兌美元** — 全球流動性最大的外匯對。歐元升 = 美元弱 = 大宗商品有支撐'],
              ['TWDUSD', '**美元兌台幣** — 影響台廠進口貴金屬的台幣成本。匯率漲 → 進口成本變高'],
              ['FED_FUNDS', '**聯邦基金利率** — Fed 訂的銀行間隔夜拆借利率。利率高 → 持有黃金的機會成本高 → 壓抑黃金'],
              ['UST10Y', '**美 10 年期公債殖利率** — 全球避險資金成本指標。殖利率漲 → 持有不生息資產(黃金)成本高 → 黃金易跌'],
              ['VIX', '**恐慌指數** — 標普 500 隱含波動率,> 30 代表市場恐慌 → 黃金避險買盤湧入'],
              ['WTI', '**西德州原油** — 反映全球工業需求景氣。WTI 強 → 經濟熱 → 工業金屬(銅/鎳/鋁)有支撐'],
            ]
          },
        ]
      },
      {
        type: 'subsection',
        title: '📰 新聞 / 週報 / 月報(下半 tab)',
        blocks: [
          {
            type: 'list',
            items: [
              '**新聞**:採購排程抓回來的金屬相關報導(MoneyDJ / Mining.com / SMM / 日經中文 等),每則一行(標題 + 來源 + 相關金屬 + 情緒標籤 + 時間)— 點擊**新分頁開原網頁**',
              '**週報** / **月報**:**只顯示採購人員已發布的版本**;若週/月報空白,代表採購本週 / 本月還沒 publish,可以等等再看',
              '週 / 月報內容由採購人員撰寫(可以參考 AI 自動草稿後修改、或完全自己寫),所以更貼近實際採購視角',
            ]
          },
          {
            type: 'tip',
            text: '💡 新聞的**情緒標籤**(positive / negative / neutral)由 AI 自動歸類,僅供快速 scan,不保證 100% 準確。要看分析請看週月報。'
          },
        ]
      },
      {
        type: 'subsection',
        title: '🔍 新聞天數 selector(2026-05-19 加)',
        blocks: [
          {
            type: 'para',
            text: '「新聞」tab 上方有「近 1 日 / 3 天 / 7 天 / 14 天 / 30 天」5 個按鈕,點任一個 → 新聞區重 fetch 對應範圍。預設 **7 天**,localStorage 記憶,下次進來自動套用上次選擇。',
          },
          {
            type: 'tip',
            text: '不只「今天」可看,要回顧近兩週需動向選「14 天」就行,不用等採購週報。'
          },
        ]
      },
      {
        type: 'subsection',
        title: '⛶ 新聞放大瀏覽(2026-05-19 加)',
        blocks: [
          {
            type: 'para',
            text: '新聞 tab 右上「⛶ 放大」按鈕打開 modal,**全螢幕呈現 + 完整篩選器**(等同採購完整版「新聞列表」tab)。',
          },
          {
            type: 'list',
            items: [
              '左欄篩選器:📅 發布日 vs 抓取日 toggle、日期範圍 picker(快捷:今日 / 24h / 7d / 30d)、金屬多選、來源多選(by 網站 domain)、情緒下拉、全文關鍵字搜尋、只看我釘選的',
              '右欄新聞 card:title + summary(LLM 摘要)+ 發布時間 + 抓取時間 + 來源 + 情緒 badge + 相關金屬 tag + 釘選按鈕',
              '頂部:分頁(50 筆/頁)、匯出 PDF',
              '點 card → 開「完整內容」modal 看 LLM 繁中摘要 + KB 原文並排',
            ]
          },
          {
            type: 'tip',
            text: '放大 modal 開啟時,**金屬篩選自動帶入「我的偏好」focused metals**,日期範圍自動帶外面 selector 的天數(例:外面選 7 天 → modal 自動 from=今天-6 to=今天)。快捷按鈕(今日/24h/7d/30d/清除)點選後變藍底白字,可看出當前選哪個。',
          },
        ]
      },
      {
        type: 'subsection',
        title: '📅 日期切換 — 報表跟著切(2026-05-19 加)',
        blocks: [
          {
            type: 'para',
            text: '頂部 header 的「資料日期」picker 切換時,**整個頁面所有資料區跟著切換**:左欄報價、中欄走勢圖、新聞、週/月報 全部對齊該日期重 fetch。',
          },
          {
            type: 'table',
            headers: ['資料區', '切日期後行為'],
            rows: [
              ['報價 (左欄)', '顯示該日的金屬報價 + D% / W% / M%'],
              ['走勢圖 (中欄)', '圖表 X 軸對齊該日'],
              ['新聞 tab', '抓「該日往前 N 天」的新聞(N 依天數 selector)'],
              ['週報 tab', '**找該日所在週(週一~週日)那份週一發布的週報**;5/19(週二)看 → 顯示 5/18(週一)那份'],
              ['月報 tab', '**找該月份 1 號那份月報**;5/19 看 → 顯示 5/1 那份'],
            ]
          },
          {
            type: 'note',
            text: '如果該週/月還沒發布報告 → 顯示「採購尚未發布」。要看舊報告就把日期 picker 往前調。'
          },
        ]
      },
      {
        type: 'subsection',
        title: '📎 週/月報附件(2026-05-20 加)',
        blocks: [
          {
            type: 'para',
            text: '採購發布週/月報時若有上傳附件,精簡版這邊會在報告內容下方列出附件清單,**點檔名直接下載**(filename + 檔案大小自動換算 B/KB/MB)。',
          },
          {
            type: 'note',
            text: '只有「已發布」報告的附件可下載(走後端 `is_published=1` 守護),採購草稿附件不會洩漏。'
          },
        ]
      },
    ]
  },

  // ── 7. AI 分析助理 ─────────────────────────────────────────────────────
  {
    id: 'pml-ai',
    sort_order: 70,
    icon: 'MessageSquare',
    icon_color: 'text-amber-500',
    last_modified: '2026-05-11',
    title: 'AI 分析助理',
    sidebar_label: 'AI 助理',
    blocks: [
      {
        type: 'para',
        text: '頂部黃色「💬 AI 分析」按鈕開啟右側抽屜,讓你**用自然語言問金屬相關問題**。AI 已預載當日資料(11 金屬報價 + 7 個宏觀指標 + 近 2 日 Top 10 新聞),可直接引用,不用上下文。'
      },
      {
        type: 'subsection',
        title: '能問什麼',
        blocks: [
          {
            type: 'card_grid',
            cols: 2,
            items: [
              { emoji: '✅', title: '可以', desc: '銅最近怎麼了?金價會繼續漲嗎?今日哪個金屬漲最多?VIX 飆是什麼意思?' },
              { emoji: '❌', title: '不可以', desc: '查 ERP / HR / 公司內部資料、給投資建議、問跟金屬無關的事 — AI 會禮貌拒絕並引導你去主對話介面' },
            ]
          },
        ]
      },
      {
        type: 'subsection',
        title: '操作 + 行為',
        blocks: [
          {
            type: 'list',
            items: [
              '**輸入問題** → **Ctrl+Enter** 送出(或點「送出」按鈕)',
              '**streaming 即時回應**,看著文字一個一個跑出來',
              '**Esc 或 X** 關閉 drawer — 對話**全部清空**(F5 也清)',
              '對話**不會寫進主 chat 歷史**,也不會被採購端的 review queue 看到,你可以放心問',
              '**清除**:右上「🔄 清除」 — 開新一輪對話',
            ]
          },
          {
            type: 'tip',
            text: '💡 因為 AI 已預載完整當日 snapshot,**回答秒回不到 5 秒**,比一般 chat 快很多(那邊還要走 tool calling 撈資料)。'
          },
        ]
      },
      {
        type: 'note',
        text: '⚠️ AI 提供的是「資料解讀」非「投資建議」。重大採購決策請以採購主管 / 銀行專員建議為準。'
      },
    ]
  },

  // ── 8. 偏好設定 + XLSX 匯出 ─────────────────────────────────────────────
  {
    id: 'pml-prefs-export',
    sort_order: 80,
    icon: 'Settings',
    icon_color: 'text-slate-500',
    last_modified: '2026-05-11',
    title: '我的偏好 + XLSX 匯出',
    sidebar_label: '偏好 / 匯出',
    blocks: [
      {
        type: 'subsection',
        title: '⚙ 我的偏好',
        blocks: [
          {
            type: 'para',
            text: '點 top bar「⚙ 我的偏好」開設定 modal,勾你關注的金屬。**勾了之後**:'
          },
          {
            type: 'list',
            items: [
              '左欄報價只顯示這幾個(其他隱藏)',
              '中欄走勢圖的金屬 chip 也只列這幾個',
              '**留空 = 顯示全部 11 種**(預設)',
              'XLSX 匯出也只匯這幾個(若有勾)',
            ]
          },
          {
            type: 'tip',
            text: '🔗 **跟採購完整版共用同一份偏好**:你在精簡版改了關注金屬,進完整版的「我的偏好」也會看到同樣勾選,反之亦然。'
          },
        ]
      },
      {
        type: 'subsection',
        title: '⬇ 匯出 XLSX',
        blocks: [
          {
            type: 'para',
            text: '點 top bar「⬇ 匯出 XLSX」下載當日 snapshot。Excel 開檔是 3 個 sheet:'
          },
          {
            type: 'table',
            headers: ['Sheet', '欄位'],
            rows: [
              ['1 金屬報價', 'metal_code / metal_name / group / price_usd / as_of_date / day_change_pct / week_change_pct / month_change_pct / source'],
              ['2 宏觀數據', 'indicator_code / indicator_name / value / unit / as_of_date / day_change_pct'],
              ['3 說明', '匯出時間、匯出人、基準日期、涵蓋金屬、資料來源、免責聲明、資料口徑'],
            ]
          },
          {
            type: 'list',
            items: [
              '檔名格式 `metals_snapshot_YYYY-MM-DD_HHmm.xlsx`(日期 = 當下 viewDate,HHmm = 匯出時刻)',
              '**Sheet 3 用於法務 / 稽核留證**:寫清楚資料口徑跟免責聲明',
              '若你有設「我的偏好」金屬子集,只匯那些;否則 11 種全匯',
            ]
          },
        ]
      },
    ]
  },

  // ── 9. 常見問題 FAQ ───────────────────────────────────────────────────
  {
    id: 'pml-faq',
    sort_order: 90,
    icon: 'HelpCircle',
    icon_color: 'text-blue-500',
    last_modified: '2026-05-11',
    title: '常見問題 FAQ',
    sidebar_label: 'FAQ',
    blocks: [
      {
        type: 'subsection',
        title: 'Q1. 為什麼某些金屬的 D / W / M 顯示「—」?',
        blocks: [
          {
            type: 'para',
            text: '表示 DB 沒有對應日期的歷史資料來算漲跌。常見原因:平台剛上線歷史短、該金屬抓取失敗、非交易日(週末 / 假日)。等排程累積資料後會自動補上。'
          },
        ]
      },
      {
        type: 'subsection',
        title: 'Q2. 走勢圖一片空白「無 XX 資料」',
        blocks: [
          {
            type: 'list',
            items: [
              '**檢查 top bar 日期** — 是不是切到很舊的日期,DB 沒當時資料?點「最新」按鈕跳到 DB 最新日',
              '**檢查時間區間** — 切「近 10 年」但 DB 只有 N 天,X 軸會撐很開但線縮成一點,試試切「近 1 月」',
              '**該金屬整個沒抓** — 排程偶爾解析失敗,問採購窗口確認',
            ]
          },
        ]
      },
      {
        type: 'subsection',
        title: 'Q3. MA60(季線)勾不起來,顯示「資料不足」',
        blocks: [
          {
            type: 'para',
            text: 'MA60 需要至少 60 筆資料才能算出第一個值,DB 該金屬目前少於 60 筆。等排程繼續累積或切短一點的 MA(MA20 / EMA20 只需 20 筆)。chart 標題旁「N 筆 / D 天」徽章可直接看數量。'
          },
        ]
      },
      {
        type: 'subsection',
        title: 'Q4. 週報 / 月報 tab 點開沒內容',
        blocks: [
          {
            type: 'para',
            text: '一般 user 只看「採購人員已發布」的版本。本週 / 本月若採購還沒寫好 publish,這裡就空著。一般 1-2 個工作日內會發。**精簡版無法寫週月報**,要寫請申請採購權限走完整版。'
          },
        ]
      },
      {
        type: 'subsection',
        title: 'Q5. AI 不回答我的問題,叫我去主對話',
        blocks: [
          {
            type: 'para',
            text: 'AI 助理被刻意限縮在「金屬報價 / 新聞 / 趨勢 / 宏觀」範圍。問非金屬問題(ERP / HR / 私事)會被禮貌拒絕。**真的需要其他答案請去主對話介面**(/chat),那邊是通用 AI。'
          },
        ]
      },
      {
        type: 'subsection',
        title: 'Q6. 看到很多金屬代碼擠在一起讀不懂',
        blocks: [
          {
            type: 'table',
            headers: ['代碼', '英文', '中文'],
            rows: [
              ['AU', 'Gold', '金'],
              ['AG', 'Silver', '銀'],
              ['PT', 'Platinum', '鉑'],
              ['PD', 'Palladium', '鈀'],
              ['RH', 'Rhodium', '銠'],
              ['CU', 'Copper', '銅'],
              ['AL', 'Aluminum', '鋁'],
              ['NI', 'Nickel', '鎳'],
              ['ZN', 'Zinc', '鋅'],
              ['PB', 'Lead', '鉛'],
              ['SN', 'Tin', '錫'],
            ]
          },
        ]
      },
      {
        type: 'subsection',
        title: 'Q7. 我想要每天自動收到金屬報告',
        blocks: [
          {
            type: 'para',
            text: '本精簡版目前只能主動進來看。若需**自動推送**(Webex / Email)請聯絡採購窗口 — 採購完整版有訂閱機制,可由採購代為設定。'
          },
        ]
      },
      {
        type: 'tip',
        text: '📞 **問不到答案 → 找採購窗口**;**頁面 bug / 顯示異常 → 找 IT 平台 admin**。'
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
