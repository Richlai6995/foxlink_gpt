# 金屬情報精簡版(Metals Lite)實作規劃

> **目的**:在「貴金屬情報平台」(採購專用,既有 PmBriefingPage)旁,新增**面向一般 user** 的精簡版 `/metals`。
>
> **拆分原則**:採購完整版繼續長,精簡版獨立 codepath、獨立權限、共用資料層。
>
> **Author**:Claude(基於 2026-05-09/10 規劃討論)
> **狀態**:Phase 0–7 同期實作(2026-05-09 拍板,一晚衝完 P0-P7,單一巨型 commit)

---

## 1. 目標與邊界

### 1.1 為什麼新做精簡版而非擴 PmBriefingPage

| 議題 | PmBriefingPage(採購) | Metals Lite(一般 user) |
|---|---|---|
| 受眾 | 採購員 / 採購主管 | 全集團一般 user(事業單位、PM、行政) |
| 權限 | `help_books.code='precious-metals'` | `help_books.code='metals-public'`(新) |
| Tab | 新聞 / 歷史價格 / 週報 / 月報 / Prompt 審核 | 三欄 Bloomberg-mini layout(報價/走勢/AI/宏觀/新聞) |
| 報告來源 | LLM 草稿可見 | 只看採購 publish 後的版本 |
| 寫權限 | 釘新聞 / publish 報告 / 編輯 prompt | 只讀 + AI 提問 |
| 入口 | sidebar「貴金屬情報」 | sidebar「貴金屬情報」(同 entry,內部分流) |

兩邊共用:`pm_price_history` / `pm_macro_history` / `pm_news` / `pm_analysis_report` / `pm_user_preferences.focused_metals`。

### 1.2 對應外部規劃書情境

外部規劃書 §2.4 列了 4 個「採購視角」情境(每日盯盤 / 採購決策 / 重大事件 / 月度報告);**本案新增第 5 個情境**:

> **E. 一般 user 知情**:事業單位 / PM 想知道「銅最近怎樣」「金價要不要催採購」,過去要私訊採購員。Metals Lite 給他們一個自助查詢介面,**不打擾採購員**。

---

## 2. UI 規格

### 2.1 三欄 Bloomberg-mini layout(桌機 ≥1280px)

```
┌────────────────────────────────────────────────────────────────────────┐
│ Top bar:返回 | ⭐金屬情報 | 採購每日資料                                │
│              [我的偏好] [匯出 XLSX] [→精簡視角](採購可見) [→完整版]   │
├────────────┬──────────────────────────────────┬────────────────────────┤
│ 左欄 ~280  │ 中欄(走勢圖 ~640+)              │ 右欄 ~360              │
├────────────┼──────────────────────────────────┼────────────────────────┤
│ ▣ LME 報價 │ ▣ LME 走勢圖                     │ ▣ AI 分析              │
│   Cu 9450  │   [Cu] [Al] [Ni] [Zn] [Pb] [Sn] │   [輸入問題…………]      │
│   Al 2680  │   [近10年|1y|6m|3m|1m|自訂]     │   [送出]               │
│   Ni …     │   主圖:折線 + MA20/60/120/240   │                        │
│   Zn …     │   副圖:RSI / MACD(可開關)      │   ▣ 宏觀數據           │
│   Pb …     │                                  │   DXY 97.9 -0.25       │
│   Sn …     │ ▣ 貴金屬走勢圖                   │   EURUSD 1.195         │
│            │   [Au] [Ag] [Pt] [Pd] [Rh]      │   FED 3.75             │
│ ▣ 貴金屬   │   (同上控制)                    │   …                    │
│   Au 2350  │                                  │                        │
│   Ag 28.5  │                                  │   ▣ 新聞列表/週報/月報 │
│   Pt 1020  │                                  │   tab 切換             │
│   Pd 1497  │                                  │   今日 / 本週發布      │
│   Rh 9950  │                                  │                        │
└────────────┴──────────────────────────────────┴────────────────────────┘
```

### 2.2 左欄:雙 block 報價

每張卡片顯示:
- 金屬代碼 + 中文名
- 即時 USD 價格(若有 stale 顯示日期 badge)
- 日漲跌% / 週漲跌% / 月漲跌%(三行 mini)
- hover 顯示「資料來源 + as_of_date」
- click 卡片 → 中欄走勢圖切到該金屬

LME block 包:CU / AL / NI / ZN / PB / SN
貴金屬 block 包:AU / AG / PT / PD / RH

排序依 `pm_user_preferences.focused_metals`(若有偏好,只顯示偏好那幾個,沒勾的隱藏)。

### 2.3 中欄:兩個獨立走勢圖

每個 chart 控制列:
- **金屬選 chip**(LME 區只能選 LME / 貴金屬區只能選貴金屬)
- **時間區間**:近 10 年 / 1 年 / 6 月 / 3 月 / 1 月 / **自訂**(date range picker)
- **疊加比較**:可同 chart 多選 1-2 個金屬(同區內);**多金屬時自動 log scale**
- **指標 toggle**(預設全 off):MA20 / MA60 / MA120 / MA240 / EMA / RSI / MACD / BOLL
- **副圖**:RSI / MACD 各自獨立 grid,跟主圖 X 軸對齊

技術實作:
- `client/src/components/metals/MetalsChart.tsx` 統一 component,LME / 貴金屬各塞一份
- `client/src/lib/metalsIndicators.ts` 用 `technicalindicators` package(MIT, ~80KB tree-shake) 算 SMA/EMA/RSI/MACD/BOLL
- 既有 ECharts(`echarts-for-react`)直接畫 series,**不引第三圖表庫**

### 2.4 右欄:AI / 宏觀 / 新聞

**AI 分析**:
- 輸入框 + [送出] 按鈕
- streaming SSE 渲染
- session-only(F5/離頁清空,不寫 chat_messages)
- 限縮 system prompt:「你是金屬市場分析助理,只回答金屬報價/新聞/趨勢/宏觀。其他問題禮貌拒絕」
- 預塞 RAG context:當天 11 金屬 snapshot + 宏觀 + Top 10 新聞 → 直接灌 system prompt(資料量 < 4KB)
- ~~tool call~~(避 1-2 round 延遲)

**宏觀數據**:沿用 `/api/pm/briefing/macro` 邏輯(由 `/api/metals/macro` mirror 一份,權限不同)

**新聞列表 / 週報 / 月報**(tab 切換):
- 新聞:今日抓取(`scraped_at >= TRUNC(SYSDATE)`),點擊 `_blank` 開原始 url
- 週報 / 月報:`pm_analysis_report.is_published = 1` 最新一筆,顯示採購人員修改後的 final 版

---

## 3. 後端 API 設計

### 3.1 路由總表

新增 `server/routes/metals.js`,所有路徑 `/api/metals/*`,middleware `verifyToken + verifyMetalsAccess`:

| Method | Path | 說明 |
|---|---|---|
| GET | `/prices` | 11 金屬最新報價 + 日/週/月漲跌 |
| GET | `/prices/timeseries?metal=&days=` | 個別金屬 N 日收盤 |
| GET | `/macro` | 宏觀 8 項最新值 + 日變化 |
| GET | `/news?limit=20&today=1` | 今日新聞 / 點擊原文(_blank) |
| GET | `/reports?type=weekly\|monthly` | published=1 最新一筆 |
| POST | `/ai-analyze` | SSE streaming AI 問答(限縮 prompt + 預塞 RAG) |
| GET | `/export.xlsx?metals=` | XLSX 匯出 3 sheet |
| GET | `/preferences` | 共用 `pm_user_preferences` |
| PUT | `/preferences` | 共用 `pm_user_preferences` |

### 3.2 權限 middleware `verifyMetalsAccess`

```js
// 通過條件(任一即可):
//   1. user.role === 'admin'
//   2. 有 help_books.code='metals-public' 的 share
//   3. 有 help_books.code='precious-metals' 的 share(採購可看精簡版)
async function verifyMetalsAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No user' });
  if (req.user.role === 'admin') return next();

  const books = await db.prepare(`
    SELECT id, code, is_special, is_active FROM help_books
    WHERE code IN ('metals-public', 'precious-metals') AND is_active=1
  `).all();

  // 任一 book 通過 share 檢查就放行
  for (const book of books) {
    if (Number(book.is_special) === 0) return next();
    const tuples = userGranteeTuples(req.user);
    if (tuples.length === 0) continue;
    const orClauses = tuples.map(() => '(grantee_type = ? AND grantee_id = ?)').join(' OR ');
    const params = tuples.flatMap(([t, v]) => [t, v]);
    const row = await db.prepare(`
      SELECT 1 AS hit FROM help_book_shares
      WHERE book_id = ? AND (${orClauses}) FETCH FIRST 1 ROWS ONLY
    `).get(book.id, ...params);
    if (row) return next();
  }
  return res.status(403).json({ error: '需要金屬情報閱讀權限' });
}
```

### 3.3 `/prices` 加 week / month 漲跌

```sql
-- Phase 5 hotfix 13.3 雷:metal_code 統一 UPPER(),date 一律 TO_CHAR
SELECT
  UPPER(metal_code) AS metal_code, metal_name, price_usd, source,
  TO_CHAR(as_of_date, 'YYYY-MM-DD') AS as_of_date,
  day_change_pct,
  -- 週漲幅:相對 7 天前
  ROUND((price_usd - LAG(price_usd, 1) OVER (
    PARTITION BY UPPER(metal_code)
    ORDER BY as_of_date
    RANGE BETWEEN INTERVAL '7' DAY PRECEDING AND INTERVAL '7' DAY PRECEDING
  )) / NULLIF(LAG(price_usd, 1) OVER (...), 0) * 100, 2) AS week_change_pct,
  -- 月漲幅:相對 30 天前(同上)
FROM pm_price_history
WHERE …
```

實作上會用 self-JOIN 而非 RANGE LAG(Oracle 的 RANGE 對 DATE 比較囉嗦),但邏輯等價。

---

## 4. 採購端 PmBriefingPage 變更

### 4.1 週/月報編輯 + 發布 UI

`client/src/pages/PmBriefingPage.tsx` 的 ReportsTab(weekly/monthly)新增:
- **編輯按鈕**:點擊把 LLM 草稿 (`full_content`) 載入 textarea
- **儲存草稿**:寫 `edited_content`,`is_published=0`
- **發布**:寫 `edited_content` + `is_published=1` + `edited_by=user.id` + `published_at=SYSTIMESTAMP`
- **回滾**:把 `is_published` 改 0(下次發布前一般 user 看不到)

### 4.2 「精簡視角預覽」按鈕

Top bar 加按鈕 → `navigate('/metals')`,讓採購驗證一般 user 看到什麼。

### 4.3 schema migration

`server/database-oracle.js` `runMigrations()` 加:

```js
await addCol('PM_ANALYSIS_REPORT', 'IS_PUBLISHED', 'NUMBER(1) DEFAULT 0');
await addCol('PM_ANALYSIS_REPORT', 'EDITED_BY', 'NUMBER');
await addCol('PM_ANALYSIS_REPORT', 'EDITED_CONTENT', 'CLOB');
await addCol('PM_ANALYSIS_REPORT', 'PUBLISHED_AT', 'TIMESTAMP');
```

---

## 5. Schema 變更

### 5.1 `help_books` seed `metals-public`

```js
// 在 runMigrations() 既有 cortex book seed 後加:
const metalsLite = await db.prepare(
  `SELECT id FROM help_books WHERE code='metals-public'`
).get();
if (!metalsLite) {
  await db.prepare(`
    INSERT INTO help_books (code, name, description, icon, is_special, is_active, sort_order, last_modified)
    VALUES ('metals-public', '金屬情報(精簡版)', '面向一般 user 的金屬報價/新聞/AI 速查', 'gem', 1, 1, 50, ?)
  `).run(new Date().toISOString().slice(0, 10));
}
```

### 5.2 `pm_analysis_report` 加 4 欄

(見 §4.3)

### 5.3 Idempotent

兩個 migration 都用 `addCol`(內含 column existence check)+ INSERT 用 SELECT 先判斷,**重啟 server 不會報錯**。

---

## 6. 入口分流邏輯(Sidebar.tsx)

```ts
const [hasPmAccess, setHasPmAccess] = useState(false)        // 採購完整版
const [hasMetalsAccess, setHasMetalsAccess] = useState(false) // 一般精簡版

useEffect(() => {
  api.get('/help/books').then(r => {
    const codes = (r.data || []).map(b => b.code)
    setHasPmAccess(codes.includes('precious-metals'))
    setHasMetalsAccess(codes.includes('metals-public') || codes.includes('precious-metals'))
  })
}, [])

// sidebar 「貴金屬情報」按鈕 onClick:
const target = hasPmAccess ? '/pm/briefing' : '/metals'
navigate(target)

// sidebar 顯示條件:hasPmAccess || hasMetalsAccess
```

採購打開 sidebar entry → 進完整版,但完整版頂部有「→精簡視角」按鈕。一般 user 直接進精簡版。

---

## 7. Phase 拆分 + 工時

| Phase | 內容 | 工時 | 檔案 |
|---|---|---|---|
| **P0** | schema migration + help_book seed + verifyMetalsAccess middleware | 0.5d | database-oracle.js, routes/metals.js(skel) |
| **P1** | backend `/api/metals/*` 8 endpoints | 1.5d | routes/metals.js |
| **P2** | PmBriefingPage 編輯+發布 UI + 精簡預覽 link | 1.0d | PmBriefingPage.tsx |
| **P3** | MetalsPage 三欄 layout 骨架 | 1.5d | MetalsPage.tsx + components/metals/* |
| **P4** | 走勢圖 + indicators + 疊加比較 + 趨勢線 | 2.0d | MetalsChart.tsx + lib/metalsIndicators.ts |
| **P5** | AI 分析 streaming SSE + 預塞 RAG | 1.0d | metals.js `/ai-analyze` + UI |
| **P6** | XLSX 匯出(3 sheet) | 0.5d | metals.js `/export.xlsx` |
| **P7** | 偏好整合 + 入口分流 + i18n(zh/en/vi) | 1.0d | Sidebar.tsx + App.tsx + i18n locales |
| | **合計** | **9.0d** | |

---

## 8. 風險與緩解

| 風險 | 緩解 |
|---|---|
| `technicalindicators` 在 vite build 體積爆掉 | 只 import 用到的(`SMA`, `EMA`, `RSI`, `MACD`, `BollingerBands`),tree-shake 後 < 100KB |
| AI 分析被一般 user 拿來問 ERP / HR | 限縮 system prompt + log 所有 query 到 `pm_ai_query_log`(若需追蹤);未來必要時加 LLM 一階分類器 reject |
| 採購偏好 `focused_metals` 影響精簡版顯示金屬 | UI 標明「依我的偏好過濾,點偏好設定可改」;預設 `focused_metals=[]` 時顯示全部 |
| 多 user 同時編輯週/月報草稿 | 用 `edited_at` 樂觀鎖,衝突彈警告(Phase B 才需要)|
| 一般 user 看到尚未 publish 的報告 | `/api/metals/reports` SQL 強制 `WHERE is_published=1`,後端 filter 不靠前端 |

---

## 9. 命名 / 路徑慣例

- DB 既有 `pm_*` 表共用,**不新增 metals_* 表**(避免雙寫)
- backend route `/api/metals/*`(讀為主,只有 `/preferences PUT` 寫)
- frontend route `/metals`
- frontend component:`client/src/components/metals/*`
- i18n key:`metalsLite.*`(zh/en/vi 三檔同步加)

---

## 10. 待後續(明天 user 看完再決定)

- **手機版**:本案先桌機。沿 mobile-support-plan PR-2 思路,後續做 mobile fallback
- **AI 分析歷史保留**:目前 session-only,未來若採購想知道一般 user 都問什麼 → 開 `pm_ai_query_log` 表
- **採購端編輯 UI 加 diff 顯示** vs LLM 草稿:Phase 2 加值
- **Webex / email push 報告** 給一般 user:看一般 user 反饋再決定要不要做
