# 系統改名規劃 — Foxlink GPT → Cortex

> 建立日期：2026-04-10
> 範圍：**僅修改使用者可見的名稱**，內部程式名稱、檔案路徑、K8s 資源、文檔等保持不變。

---

## 決策摘要

| 項目 | 決策 |
|------|------|
| **新系統名稱** | `Cortex`（不加 AI、不加正崴、不加 Platform） |
| **Email subject 標記** | `[Cortex]`（半形方括號，統一格式） |
| **Help 種子資料** | **本期不改**（避免觸發全量重新翻譯） |
| **Webex Bot displayName** | 只改程式 fallback，Webex Developer Portal 不動 |
| **內部程式/檔案/路徑** | 全部不動（package.json、Docker、K8s、deploy.sh、目錄名、API headers、log、註解、文檔等） |

---

## 修改清單

### 1. 前端 UI（瀏覽器標題、頁面文字）

| 檔案 | 行號 | 原始 | 新值 |
|------|------|------|------|
| [client/index.html](../client/index.html) | 10 | `<title>Foxlink GPT to Cortex</title>` | `<title>Cortex</title>` |
| [client/src/pages/Login.tsx](../client/src/pages/Login.tsx) | 121 | `alt="Foxlink GPT to Cortex"` | `alt="Cortex"` |
| [client/src/pages/Login.tsx](../client/src/pages/Login.tsx) | 123 | `<h1>Foxlink GPT to Cortex</h1>` | `<h1>Cortex</h1>` |
| [client/src/components/Sidebar.tsx](../client/src/components/Sidebar.tsx) | 179 | `alt="Foxlink GPT to Cortex"` | `alt="Cortex"` |
| [client/src/components/Sidebar.tsx](../client/src/components/Sidebar.tsx) | 180 | `<span>Foxlink GPT to Cortex</span>` | `<span>Cortex</span>` |
| [client/src/components/ChatWindow.tsx](../client/src/components/ChatWindow.tsx) | 287 | `<h2>Foxlink GPT to Cortex</h2>` | `<h2>Cortex</h2>` |
| [client/src/pages/ChatPage.tsx](../client/src/pages/ChatPage.tsx) | 868 | `'Foxlink GPT to Cortex'` | `'Cortex'` |
| [client/src/pages/AdminDashboard.tsx](../client/src/pages/AdminDashboard.tsx) | 88 | `<span className="font-bold">Foxlink GPT to Cortex</span>` | `<span className="font-bold">Cortex</span>` |
| [client/src/pages/HelpPage.tsx](../client/src/pages/HelpPage.tsx) | 167, 201, 207, 215 | `Foxlink GPT to Cortex` | `Cortex` |

### 2. i18n 三語言檔（line 747）

| 檔案 | 原始 | 新值 |
|------|------|------|
| [client/src/i18n/locales/zh-TW.json](../client/src/i18n/locales/zh-TW.json) | `"Foxlink GPT to Cortex 使用說明書"` | `"Cortex 使用說明書"` |
| [client/src/i18n/locales/en.json](../client/src/i18n/locales/en.json) | `"Foxlink GPT to Cortex User Guide"` | `"Cortex User Guide"` |
| [client/src/i18n/locales/vi.json](../client/src/i18n/locales/vi.json) | `"Hướng dẫn sử dụng Foxlink GPT to Cortex"` | `"Hướng dẫn sử dụng Cortex"` |

> 注意：locale 檔現在 value 是 `Foxlink GPT to Cortex`（半成品），這次一次改乾淨。

### 3. Email Subject + Body（使用者收信看到）

| 檔案 | 行號 | 原始 | 新值 |
|------|------|------|------|
| [server/routes/auth.js](../server/routes/auth.js) | 613 | `'【FOXLINK GPT】密碼重置請求'` | `'[Cortex] 密碼重置請求'` |
| [server/routes/auth.js](../server/routes/auth.js) | 616 | `<h2>FOXLINK GPT 密碼重置</h2>` | `<h2>Cortex 密碼重置</h2>` |
| [server/routes/admin.js](../server/routes/admin.js) | 736 | `'[FOXLINK GPT] 郵件測試'` | `'[Cortex] 郵件測試'` |
| [server/routes/admin.js](../server/routes/admin.js) | 737 | `'這是 FOXLINK GPT 的郵件設定測試信件。'` | `'這是 Cortex 的郵件設定測試信件。'` |
| [server/services/mailService.js](../server/services/mailService.js) | 61 | `` `[FOXLINK GPT] 敏感詞彙警示 - ...` `` | `` `[Cortex] 敏感詞彙警示 - ...` `` |
| [server/routes/feedback.js](../server/routes/feedback.js) | 336 | `` `[FOXLINK GPT] 工單回覆 ...` `` | `` `[Cortex] 工單回覆 ...` `` |
| [server/services/feedbackNotificationService.js](../server/services/feedbackNotificationService.js) | 22 | `` `[FOXLINK GPT] 新問題反饋...` `` | `` `[Cortex] 新問題反饋...` `` |
| [server/services/feedbackNotificationService.js](../server/services/feedbackNotificationService.js) | 37 | `` `[FOXLINK GPT] 工單已解決...` `` | `` `[Cortex] 工單已解決...` `` |
| [server/services/feedbackNotificationService.js](../server/services/feedbackNotificationService.js) | 47 | `` `[FOXLINK GPT] 工單重開...` `` | `` `[Cortex] 工單重開...` `` |

> 統一改為半形 `[Cortex]`，原本 auth.js 用全形 `【】` 也順便統一。

### 4. Webex Bot（使用者在 Webex 看到的訊息）

| 檔案 | 行號 | 原始 | 新值 |
|------|------|------|------|
| [server/routes/webex.js](../server/routes/webex.js) | 47 | `⚠️ 無法串連 Foxlink GPT to Cortex 帳號...` | `⚠️ 無法串連 Cortex 帳號...` |
| [server/routes/webex.js](../server/routes/webex.js) | 53 | `Unable to link Foxlink GPT to Cortex account...` | `Unable to link Cortex account...` |
| [server/routes/webex.js](../server/routes/webex.js) | 59 | `Không thể liên kết tài khoản Foxlink GPT to Cortex...` | `Không thể liên kết tài khoản Cortex...` |
| [server/services/webexService.js](../server/services/webexService.js) | 39 | `\|\| 'FOXLINK GPT'` | `\|\| 'Cortex'` |
| [server/services/webexService.js](../server/services/webexService.js) | 41 | `this._botDisplayName = 'FOXLINK GPT'` | `this._botDisplayName = 'Cortex'` |

> Webex Developer Portal 上的 Bot 帳號 displayName **不在此次範圍**，使用者另外去改。

### 5. AI 自我介紹 system prompt（AI 回覆會說出來）

| 檔案 | 行號 | 原始 | 新值 |
|------|------|------|------|
| [server/routes/training.js](../server/routes/training.js) | 2130 | `` `你是 FOXLINK GPT 教育訓練平台的 AI 助教。...` `` | `` `你是 Cortex 教育訓練平台的 AI 助教。...` `` |
| [server/services/helpTranslator.js](../server/services/helpTranslator.js) | 18-20 | `// - Product names: Foxlink GPT, Cortex, ...` | `// - Product names: Cortex, ...`（移除 Foxlink GPT，保留 Cortex） |

> `helpTranslator.js` 雖然是註解但會被組進 LLM prompt，影響翻譯時是否保留原文。

---

## 不改清單（內部、看不到）

以下確認**本次不動**：

- `package.json`（client / server / chrome-extension）的 `name` 欄位
- `docker-compose.yml` container_name
- `Dockerfile`
- `k8s/*.yaml`（namespace、Deployment、Service、Ingress host、labels、image registry path）
- `deploy.sh`
- `server/server.js` startup console.log
- API response header `X-Source: foxlink-gpt`
- 所有 `.js` / `.ts` 檔案的程式碼註解
- `CLAUDE.md`、`README.md`、`docs/*.md`
- **Chrome Extension 全部不動**（`manifest.json`、`popup.html`、`background.js`、`content.js`、`README.md`）— 內部工具不在此次範圍
- 本地目錄路徑 `d:\vibe_coding\foxlink_gpt`
- NFS path `/volume1/foxlink-gpt`
- Image registry `10.8.93.11:5000/foxlink-gpt`
- **Help 種子資料**（`server/data/helpSeedData.js`、`_helpSeed_part1.js`、`_helpSeed_part2.js`、`server/services/helpContent.js`）— 改了會觸發 `last_modified` bump → 全量翻譯失效需重跑 LLM 翻譯，本期不做
- **Webex Developer Portal 上的 Bot 帳號 displayName**

---

## 修改順序

1. **前端 UI**（7 個檔案，9 處）— 風險最低
2. **i18n locale**（3 個檔案，line 747）
3. **Email**（5 個檔案，9 處）
4. **Webex Bot**（2 個檔案，5 處）
5. **AI system prompt**（2 個檔案，2 處）

**總計：19 個檔案，~30 處修改**

---

## 驗證步驟

完成後驗證：

1. `cd client && npm run build` — 確認沒有編譯錯誤
2. `cd server && npm run dev` — 啟動 server，看 console 沒 error
3. 開 `http://localhost:5173` — 檢查瀏覽器標籤頁、Login、Sidebar、ChatWindow、AdminDashboard、HelpPage 都顯示 `Cortex`
4. 切換 i18n 語言 zh-TW / en / vi，確認 Help 頁面標題正確
5. 觸發一封測試信（admin 面板），確認 subject 是 `[Cortex] 郵件測試`

---

## 待確認 / 風險

- **Help 種子資料未改** → Help 頁面內文（不是標題）仍會顯示 `Foxlink GPT to Cortex`，這是本次刻意保留的範圍。下期再處理時要安排 LLM 翻譯時間
- **Webex Bot displayName Portal 端未改** → 程式 fallback 是 `Cortex`，但實際 displayName 仍以 Webex Portal 設定為主
- **API X-Source header 未改** → 不影響使用者，但如果未來有外部監控/分析腳本依賴這個值要注意
