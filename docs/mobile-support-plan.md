# Mobile Support 規劃書 — 從 Chat 主畫面開始,桌機 0 影響

> **規劃日期**:2026-05-05
> **狀態**:Spec 已對齊,待開工(PR-1 Phase 0 + 桌機重構)
> **核心訴求**:支援手機螢幕,自動識別裝置,**桌機使用者 100% 不受影響**

---

## 0. 為什麼做這件事

平台目前只在桌機 ≥768px 設計過,手機開啟會:
- Sidebar 永遠 fixed 占 288px → 主內容區只剩約 100px,完全不可用
- Topbar 8 顆工具按鈕擠到溢出 / 換行
- MessageInput 工具列 (template/research/erp/mic/paperclip) 重疊
- Modal `max-w-md` 在窄螢幕邊緣切掉
- 拖拉上傳 / drag 排序在 touch 完全無作用

直接 RWD 改 Tailwind `md:` prefix 風險高,改一行就可能影響桌機 user。要徹底隔離,**邏輯共用 + layout 分流**是最穩的路。

---

## 1. 核心架構決策

### 1.1 方案選擇 — Layout 分流(方案 C)

| 方案 | 結論 |
|------|------|
| A. 純 RWD(Tailwind breakpoint) | ❌ 風險波及桌機,複雜元件硬塞會醜 |
| B. 手機獨立路由 `/m/chat` | ❌ 兩套 business logic 維護地獄 |
| **C. Layout 分流 + 共用 hook** | ✅ 採用 — 桌機路徑 0 改動,手機獨立 UX |

**做法**:
1. `ChatPage.tsx` 拆出 `useChatPageState()` hook(所有 state + handler)
2. `<DesktopChatLayout>` = 現有 JSX 整段搬,**0 行為差異**
3. `<MobileChatLayout>` 新檔,lazy 載入
4. `ChatPage.tsx` 變薄殼,只負責挑 layout

### 1.2 裝置識別 — UA 主判,viewport 不參與

```ts
// client/src/hooks/useDeviceProfile.ts
function detectMobile(): boolean {
  const ua = navigator.userAgent
  const uaPhone  = /Mobi|Android(?!.*Tablet)|iPhone|iPod/i.test(ua)
  const uaTablet = /iPad|Tablet/i.test(ua)

  if (uaPhone)  return true   // 真手機 → mobile
  if (uaTablet) return false  // iPad / Android Tablet → 桌機(螢幕夠大)
  return false                // 桌機 UA → 永遠桌機,不管視窗多小
}
```

**保證**:
- ✅ 1024×768 / 1366×768 桌機全螢幕 → 桌機
- ✅ 桌機 user 半屏 / 縮窗到 400px → **還是桌機**(只是 UI 略擠)
- ✅ iPhone / Android Phone → mobile
- ✅ iPad / Surface → 桌機(這些設備跑桌機 UI 體驗反而好)

**Debug**:`?mobile=1` query 強制(桌機開發者可預覽)
**灰度**:`localStorage.mobile_v1='1'` 才啟用,內測完再預設打開

### 1.3 既有殘留處理

`ChatPage.tsx` line 84/103 已寫的 `isMobile = window.innerWidth < 768` 邏輯 → **砍掉**,合進新 hook。

---

## 2. Mobile UI 設計

### 2.1 整體 Layout

```
┌─────────────────────────┐
│ ☰  標題         🔔 ⋯  │ ← topbar 48px(safe-area-top)
├─────────────────────────┤
│                         │
│   AI 訊息(width 100%)│
│   ────────────────      │
│              user 訊息  │ ← max 85%,靠右
│                         │
├─────────────────────────┤
│ + [輸入框........] ➤   │ ← input ~56px + safe-area-bottom
└─────────────────────────┘
```

### 2.2 元件對照表

| 元件 | 桌機 | 手機 |
|------|------|------|
| Sidebar(對話列表) | fixed left, 永遠在 | **vaul Drawer**,左滑 + edge swipe + 點 backdrop 關 |
| Topbar 工具按鈕(MCP/KB/Skill/Connectors/Dashboard/PureMode) | 8 顆 inline | **「⋯」按鈕 → bottom sheet**,badge 顯示已選工具總數 |
| MessageInput 工具列 | inline(template/research/erp/mic/paperclip) | 「+」按鈕 → action sheet 展開 |
| 訊息泡泡 | max-w 限制 | user 靠右 max 85%、AI 靠左 100% |
| Modal | 居中 max-w-md | `inset-0` 全螢幕 + safe-area |
| 拖拉上傳檔案 | drag overlay | **砍掉**(touch 無 drag) |
| 工具卡片 drag 排序 | 有 | 砍掉 |
| Drop overlay JSX | 顯示 | 條件 render 跳過 |
| 訊息操作(複製/重發/分支) | hover 出 | tap 訊息 → 露 action bar |
| 桌機右鍵選單 | 有 | long-press 取代 |
| Mic 錄音 | click toggle | **同桌機 click toggle**(不按住,看不到輸入) |
| Tap target | 14px icon + 小 padding | **≥ 44×44px**(只手機那份) |

### 2.3 全域漂浮元件

| 元件 | 手機處理 |
|------|---------|
| `<GlobalVoiceInput>` | `if (isMobile) return null`(走鍵盤熱鍵,手機沒鍵盤) |
| `<VoiceHotkeyHint>` | `if (isMobile) return null` |
| `<FeedbackFAB>` | **收進 ⋯ menu**,不再浮動,避免擠 MessageInput |
| `<FeedbackToast>` | 維持,但 z-index 確保在 drawer 之上 |
| `<ResearchProgressCard>` | 維持(本來就在訊息流內) |
| `<AnnouncementBanner>` | 顯示 + 提供關閉按鈕(高度 40px) |
| `<AnnouncementBell>` | 維持,放 topbar 右側 |

### 2.4 Bottom Sheet / Drawer Lib

採用 [vaul](https://vaul.emilkowal.ski/)(Vercel 出,~1.5KB):
- 原生 swipe-to-dismiss + edge swipe
- snap point 開箱即用
- 跟 Tailwind 配得好
- Sidebar drawer 用它,Topbar 工具收納也用它

自刻部分:極簡 modal `inset-0` 直接 Tailwind 即可,不用 lib。

---

## 3. PWA(加到主畫面)

### 3.1 Manifest

```json
{
  "name": "Cortex",
  "short_name": "Cortex",
  "theme_color": "#1e3a8a",
  "background_color": "#0f172a",
  "display": "standalone",
  "start_url": "/chat",
  "icons": [...]
}
```

### 3.2 Icon

**現況**:[client/public/favicon.png](client/public/favicon.png) 是 492×263 的「FL GPT」logo,長方形,解析度不足以拉到 512。

**做法(臨時)**:用 sharp + canvas 自動生 Cortex 文字 icon
- 192×192 / 512×512 / maskable 512×512(20% safe-zone padding)
- 藍底 `#2563eb` + 白字「Cortex」
- **統一 1 張**(不做 dark/light 兩版)
- apple-touch-icon 用 192 那張

之後想換正式設計師 icon 隨時換,不卡開工。

### 3.3 Service Worker

採用 [Workbox](https://developer.chrome.com/docs/workbox)(~7KB,Vite 有 plugin):
- ✅ Cache:JS / CSS / 字型 / icon(app shell)
- ❌ NetworkOnly:`/api/*`、SSE、上傳(對話需即時連網)
- 離線 fallback:`/offline.html` 簡易頁面
- 註冊路徑:`/sw.js`,scope 全站

### 3.4 Install Prompt

- 手機 Login 頁、第一次進 chat 時偵測 `beforeinstallprompt`
- 顯示「加到主畫面」chip,user 同意才呼叫 `prompt()`
- localStorage 記「已提示過」,不重複煩

### 3.5 iOS PWA 限制(已知,不需動工)

- ❌ 不支援 Web Push
- ❌ 不支援 Background Sync
- ⚠️ Service Worker storage 7 天沒用會清(user 開 PWA 即重新 cache)

---

## 4. SSE 既存問題 — Cheap Fix(順便修)

**背景**:現有 SSE 是 multipart POST + XHR。手機切 tab、鎖屏會被瀏覽器 throttle / 殺連線,XHR 不會自動重連,訊息永遠 hang。桌機切 tab 久了也有同樣 bug。

### 4.1 範圍(Cheap fix,~0.5 天)

- `visibilitychange` 監聽:tab 切回前景且 stream 中斷 → 顯示紅色 banner「連線中斷,點此重新發送」
- `online/offline` event:斷網時 abort xhr,顯示「網路中斷」狀態
- xhr `onerror` / 長時間無 chunk(>30s)→ 視為斷線
- **不做 server-side resume**(那是另一張 ticket)

### 4.2 不在這次範圍

- Server 端 Redis SSE chunk buffer
- Client 改 native `EventSource`(分流文字 vs 多檔上傳)
- 完整斷線重連 + last_event_id 續傳

→ 開另一張 ticket `sse-resume-plan.md`,跟手機支援解耦。

---

## 5. Telemetry — 觀察 mobile 比例

### 5.1 新增

```sql
CREATE TABLE device_telemetry (
  id NUMBER GENERATED ALWAYS AS IDENTITY,
  user_id NUMBER NOT NULL,
  profile VARCHAR2(20),         -- 'mobile' | 'desktop'
  ua VARCHAR2(500),
  viewport VARCHAR2(20),        -- e.g. '375x812'
  created_at TIMESTAMP DEFAULT SYSTIMESTAMP,
  PRIMARY KEY (id)
)
```

### 5.2 Endpoint

```
POST /api/telemetry/device
body: { profile, ua, viewport }
→ INSERT(user_id 從 token 取)
```

### 5.3 Client

登入成功後 ping 一次,失敗 silent。
**不做 admin 後台 dashboard**(以後想看從 SQL 撈即可)。

---

## 6. Phase 4 不支援頁

擋下列路由,顯示「請使用桌機開啟」+ logout 按鈕(其餘頁面先用 RWD 自然撐):

- `/admin/*`
- `/training/*`
- `/dashboard`, `/dashboard/boards`
- `/scheduled-tasks`
- `/kb`, `/kb/:id`
- `/pm/*`

不擋:`/feedback*`、`/templates`、`/my-charts`、`/skills`、`/help`、`/login`、`/reset-password`、`/chat`(這些走 mobile layout 或 RWD)。

---

## 7. 已知雷區

| # | 雷 | 處理 |
|---|-----|------|
| 1 | iOS Safari `100vh` 會被 URL bar 吃 | 用 `100dvh` / `100svh`,舊版 fallback `--vh` JS hack |
| 2 | iOS 鍵盤遮蔽輸入框 | `viewport-fit=cover` + `interactive-widget=resizes-content` + `visualViewport` API |
| 3 | iOS input < 16px 自動 zoom | 所有 input/textarea ≥ 16px |
| 4 | SSE 在手機背景斷線 | Cheap fix(§4) |
| 5 | iOS Safari pull-to-refresh 誤觸 | `overscroll-behavior: contain` |
| 6 | clipboard 在 iOS 需 user gesture | 已用 fallback(`copyText` lib),實機驗 |
| 7 | Android Chrome dynamic toolbar 高度抖 | `dvh` 處理 |
| 8 | Drawer 開時 z-index 衝突 | vaul 內建處理,但要驗 toast / banner |

---

## 8. PR 切分

### PR-1:基礎 + 桌機重構(~1.5 天)— **最先 ship**
- `useDeviceProfile` hook
- 抽 `useChatPageState` hook
- `<DesktopChatLayout>` = 現有 JSX 搬入(0 行為差異)
- PWA shell:manifest + icon 生成 + Workbox SW
- Telemetry 表 + endpoint + client ping
- SSE cheap fix(visibilitychange / online-offline)
- 全域 CSS:`100dvh`、`overflow-x:hidden`、input 16px、safe-area
- `index.html` viewport meta 升級
- 灰度旗標 `mobile_v1` infra

**Review 重點**:桌機完全無感,git diff 桌機 JSX 應該只有 import path 改變。

**上 prod 觀察 1–2 天再 ship PR-2**。

### PR-2:Mobile Chat 主菜(~2.5 天)
- `<MobileChatLayout>` 新檔,vaul Drawer + bottom sheet
- Sidebar drawer + edge swipe
- Topbar ⋯ menu(MCP/KB/Skill/Dashboard/PureMode 全收進來)
- 訊息泡泡手機調整(85%/100%)
- MessageInput 手機版(+ action sheet)
- ChatWindow 訊息操作 tap action bar
- 重 modal lazy 化:ResearchModal、ERP modals、SkillVarModal
- Mobile layout 本身 lazy
- FeedbackFAB 收進 ⋯ menu(手機 only)
- 全域漂浮元件手機條件 render

### PR-3:收尾(~1 天)
- Login / Reset Password / Help 手機 RWD
- Phase 4 不支援頁的「請用桌機」攔截 component
- Install prompt 提示
- i18n 三語(zh-TW / en / vi)新增 mobile-only key
- 實機回歸測試 checklist

---

## 9. 工作量

| Phase | 天數 |
|-------|------|
| PR-1 基礎 + 桌機重構 | 1.5 |
| PR-2 Mobile chat 主菜 | 2.5 |
| PR-3 收尾 | 1 |
| **小計** | **~5 天** |

---

## 10. 不做(明確排除)

- ❌ Admin / Training / Dashboard 手機版 — 顯示「請用桌機」
- ❌ SSE server-side resume(另開 ticket)
- ❌ Web Push 通知(iOS 不支援,先不做)
- ❌ Offline 對話(只 cache app shell,API 不 cache)
- ❌ Server-side UA 分流路由(純前端判,維運簡單)
- ❌ Mobile 專屬 token / session(同帳號桌機/手機共用)
- ❌ 桌機 layout 任何視覺改動

---

## 11. 後續 Phase(這次不做,記下)

- **Phase 2(Login/Help 之後)**:Feedback / Templates / KB List(已 RWD,觀察 user 反饋再優化)
- **Admin Mobile 版**:目前不規劃,如有需要另開
- **SSE 完整 resume**:`sse-resume-plan.md` 另開
- **Web Push 通知**(Android only,iOS 等他們支援)
- **正式設計師 Cortex logo**:換掉臨時生成的文字 icon

---

## 拍板紀錄(對話對齊結果)

| # | 項目 | 決議 |
|---|------|------|
| 1 | 整體方案 | C(layout 分流 + 共用 hook) |
| 2 | 裝置識別 | UA 主判(桌機 user 100% 不影響) |
| 3 | Phase 4 不支援頁 | admin/training/dashboard/scheduled-tasks/kb/pm 擋 |
| 4 | PWA | 做(name: Cortex / 深色 / 文字 icon) |
| 5 | Mic 錄音 | 同桌機 click toggle(不按住) |
| 6 | 灰度旗標 | localStorage(`mobile_v1`) |
| 7 | Drawer lib | vaul |
| 8 | Bottom sheet 形態(Topbar) | bottom sheet,badge 顯示工具總數 |
| 9 | 訊息泡泡寬度 | user 85% 靠右 / AI 100% 靠左 |
| 10 | Tap target | 44px 只手機那份 |
| 11 | Drag&drop / drag 排序 | 手機砍掉 |
| 12 | Hover action / 右鍵 | 改 tap action bar / long-press |
| 13 | 全域浮動 voice hint | 手機 hide |
| 14 | FeedbackFAB | 手機收進 ⋯ menu |
| 15 | Code split | Mobile/Desktop layout + 重 modal lazy |
| 16 | 平板 | iPad / Tablet 走桌機 |
| 17 | 橫向手機 | 仍走 mobile |
| 18 | PWA icon 來源 | 自動生成 Cortex 文字 icon(藍底白字),統一 1 張 |
| 19 | SSE | cheap fix(visibilitychange + 重發 banner)進 PR-1 |
| 20 | Workbox | 採用 |
| 21 | Telemetry | 新表 + 1 endpoint,後台不做 |
| 22 | PR 切分 | PR-1 基礎 / PR-2 主菜 / PR-3 收尾 |
| 23 | 桌機 layout 改動 | **0 改動**(JSX 搬位置但不修內容) |

---

**下一步**:開工 PR-1。
