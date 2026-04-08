# 回應速度優化設計文件

> Webex Bot + 網頁版 Chat 回應延遲優化

---

## 問題描述

Webex Bot 在 K8s 環境下回應過慢，簡單的「?」指令需 **~21 秒**才收到回覆。
網頁版 Chat 首 token 延遲也有優化空間。

---

## Phase 1：Webex Bot 回應優化（Polling → WebSocket）

### 1.1 現狀分析

目前採用 **Outbound Polling** 模式（`webexListener.js`），每 8 秒輪詢一次：

```
setInterval(8s) → GET /rooms (200間) → filter active → GET /messages (分頁) → handleWebexMessage
```

**「?」指令延遲分解（實測 ~21s）：**

| 階段 | 耗時 | 說明 |
|------|------|------|
| 等待 poll 週期 | 0~8s (avg 4s) | 訊息剛好錯過上一輪要等整輪 |
| Leader 搶鎖 | 0.5~1s | Redis lock |
| `GET /rooms` API | 1~3s | 拉 200 間房間列表 |
| `GET /messages` API | 1~2s | 逐房間分頁拉訊息 |
| 訊息 Redis lock | 0.2s | 去重 |
| DB 查 user + auth | 0.5~1s | Oracle 查詢 |
| `GET /people/me` | 1~2s | **每次都呼叫**，未 cache |
| `buildToolList` (4 SQL) | 1~3s | skills/KB/DIFY/MCP **sequential** |
| `sendMessage` API | 1~2s | 回傳 Webex |
| **合計** | **~5-21s** | 平均 ~13s |

### 1.2 改造方案：WebSocket 模式

Webex SDK 支援 **Mercury WebSocket**（outbound-only），Bot 主動連出去，Webex 透過同一條 websocket 推送事件。

**不需要公網 inbound**，完美適合 K8s 內網環境。

#### 架構變化

```
Before: setInterval(8s) → GET /rooms → GET /messages → handleWebexMessage
After:  websocket.on('messages:created') → handleWebexMessage
```

#### 延遲改善預估

| 階段 | Polling | WebSocket | 節省 |
|------|---------|-----------|------|
| 等待 poll 週期 | 0~8s | **0s** | -4s (avg) |
| Leader 搶鎖 | 0.5~1s | **0s** | -0.5s |
| `GET /rooms` | 1~3s | **0s** | -2s |
| `GET /messages` | 1~2s | **0s** | -1.5s |
| 其他（不變） | 4~8s | 4~8s | 0 |
| **合計** | ~13s | **~4-5s** | **-8~10s** |

#### K8s 多 Pod 處理

**限制**：一個 Bot Token 只能開一條 WebSocket 連線。

**方案**：沿用現有 Redis Leader Election 機制：
- 只有搶到 `webex:ws:leader` lock 的 Pod 啟動 WebSocket
- 其他 Pod idle，leader 掛了自動接手
- 訊息仍透過 Redis `webex:msg:{id}` lock 去重（防 websocket 重連期間重複）

#### 防火牆需求

只需 outbound 443 到以下域名：
```
*.wbx2.com
*.webex.com
*.ciscospark.com
```

#### Fallback 機制

保留 polling 作為降級方案：
- `WEBEX_MODE=websocket`（預設）→ WebSocket 模式
- `WEBEX_MODE=polling` → 舊的 polling 模式
- WebSocket 連線失敗超過 3 次 → 自動降級為 polling + 告警 log

### 1.3 buildToolList 並行化

**現狀**：4 個 SQL 查詢（skills → KB → DIFY → MCP）sequential 執行，耗時 1~3s。

**改造**：改為 `Promise.all` 並行查詢。

```javascript
// Before（sequential）
const skills = await db.prepare(...).all(...);
const kbs = await db.prepare(...).all(...);
const difyKbs = await db.prepare(...).all(...);
const mcpServers = await db.prepare(...).all(...);

// After（parallel）
const [skills, kbs, difyKbs, mcpServers] = await Promise.all([
  db.prepare(...).all(...).catch(() => []),
  db.prepare(...).all(...).catch(() => []),
  db.prepare(...).all(...).catch(() => []),
  db.prepare(...).all(...).catch(() => []),
]);
```

**預估節省**：1~2s（從 sequential 4x 變 parallel 1x）

### 1.4 botName Cache

**現狀**：`handleWebexMessage` 每次都呼叫 `GET /people/me` 取 bot displayName。

```javascript
// Before — 每次 1~2s 的 API call
let botName = 'FOXLINK GPT';
try {
  const meRes = await webex.client.get('/people/me');
  botName = meRes.data.displayName || botName;
} catch (_) {}
```

**改造**：在 `WebexService` 中 cache，只呼叫一次。

```javascript
// After — WebexService 中加 cache
async getBotDisplayName() {
  if (this._botDisplayName) return this._botDisplayName;
  try {
    const res = await this.client.get('/people/me');
    this._botDisplayName = res.data.displayName || 'FOXLINK GPT';
  } catch {
    this._botDisplayName = 'FOXLINK GPT';
  }
  return this._botDisplayName;
}
```

**預估節省**：1~2s（第一次後都是 0ms）

### 1.5 實作計畫

#### 需要修改的檔案

| 檔案 | 變更 |
|------|------|
| `server/services/webexListener.js` | 重寫：新增 WebSocket 模式 + 保留 polling fallback |
| `server/services/webexService.js` | 新增 `getBotDisplayName()` cache 方法 |
| `server/routes/webex.js` | `buildToolList` 並行化 + 用 cached botName |
| `server/.env` | 新增 `WEBEX_MODE=websocket` |
| `server/package.json` | 新增 `webex` npm 套件 |

#### 新增環境變數

| Key | 預設值 | 說明 |
|-----|--------|------|
| `WEBEX_MODE` | `websocket` | `websocket` 或 `polling` |
| `WEBEX_WS_RECONNECT_MAX` | `3` | WebSocket 重連失敗幾次後降級為 polling |

#### 不需要改動的部分

- `handleWebexMessage()` — 訊息處理核心邏輯完全不動
- `webex.js` 的 webhook endpoint — 保留作為備用
- Redis lock 機制 — 繼續使用
- 前端 — 無影響

### 1.6 Phase 1 預估成果

```
優化前：~21 秒（實測）
優化後：~4-5 秒（預估）

WebSocket 改造：-8~10s
buildToolList 並行化：-1~2s
botName cache：-1~2s
────────────────────
總節省：~10-14s（60~70%）
```

---

## Phase 2：網頁版 Chat 回應優化（後續）

### 2.1 現狀

網頁版走 `POST /api/chat/sessions/:id/messages` → SSE streaming。
無 polling 問題，但有以下瓶頸：

| 瓶頸 | 預估影響 | 說明 |
|------|---------|------|
| Gemini API 首 token 延遲 | 2~5s | LLM 推理時間，Pro 比 Flash 慢 |
| System prompt 組裝 | 1~3s | 載入 skills + KB + DIFY + MCP 工具定義 |
| KB 向量搜尋 | 0.5~2s | embedding + 相似度搜尋 |
| Oracle 連線池 cold start | 0~2s | poolMin=0 時要重建連線 |
| 附件處理 | 0~3s | 上傳 + 轉檔（有檔案時才觸發） |

### 2.2 計畫優化項目

| 優化 | 預估省時 | 難度 |
|------|---------|------|
| System prompt 組裝並行化（`Promise.all`） | 1~2s | 低 |
| Oracle `poolMin` 預熱（K8s 啟動時預建連線） | 0.5~1s | 低 |
| 工具定義短期快取（skills/MCP/DIFY 不需每次查 DB） | 0.5~1s | 中 |
| KB embedding 結果快取（相同問題短時間內不重算） | 0.5~1s | 中 |
| Gemini model 自動選擇（簡單問題用 Flash） | 1~3s | 已有，確認邏輯 |

### 2.3 Phase 2 預估成果

```
首 token 延遲改善：-2~4s
（具體數字待 Phase 1 完成後 profiling 確認）
```

---

## 風險與注意事項

1. **WebSocket 單連線限制**：一個 Bot Token 只能開一條 WebSocket，K8s 多 Pod 必須用 leader election
2. **防火牆**：K8s node 需能 outbound 連線到 `*.wbx2.com:443`
3. **`webex` npm 套件體積大**：~50MB+ node_modules，Docker image 會變大
4. **WebSocket 斷線**：SDK 內建 auto-reconnect，但需監控斷線頻率
5. **向下相容**：polling 模式完整保留，env 切換即可回退

---

## 時程

| Phase | 內容 | 預估 |
|-------|------|------|
| Phase 1 | Webex WebSocket + buildToolList 並行 + botName cache | 本次實作 |
| Phase 2 | 網頁版 system prompt 並行 + Oracle pool + 工具快取 | 下次實作 |
