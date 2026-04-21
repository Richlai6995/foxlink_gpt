# Gemini SDK 遷移計畫 — `@google-cloud/vertexai` → `@google/genai`

> **目標:** 真正跑到 Gemini 3.x preview(`gemini-3.1-pro-preview` 等),擺脫目前透過 alias map 降級到 `gemini-2.5-pro` 的權宜做法。
>
> **建立日期:** 2026-04-20
> **狀態:** 計畫階段,尚未開始。建議獨立 session 處理,不要在 mixed-topic session 裡啟動。

---

## 1. 背景

### 1.1 目前為什麼不是真 3.x?

- `@google-cloud/vertexai 1.12`(專案現用的 Vertex SDK)**不支援 Vertex global endpoint**
- Gemini 3.x preview 系列(`gemini-3-pro-preview`、`gemini-3.1-pro-preview` 等)**只在 global endpoint 上線**
- regional endpoint(us-central1 等)只到 stable 2.5 系列

### 1.2 目前怎麼「假裝能跑 3.x」?

`server/services/geminiClient.js` 的 `VERTEX_MODEL_DEFAULTS` alias map:

```js
'gemini-3.1-pro-preview':   'gemini-2.5-pro',
'gemini-3.1-flash-preview': 'gemini-2.5-flash',
```

LLM 管理介面填 `gemini-3.1-pro-preview` → 實際上 Vertex 跑 `gemini-2.5-pro`。

### 1.3 這個權宜帶來什麼問題?

| 問題 | 影響 |
|------|------|
| **Billing / Token 對帳錯亂** | Token usage 紀錄寫「gemini-3.1-pro-preview」,Google 端帳單寫「gemini-2.5-pro」,對不起來 |
| **維護者誤導** | code / admin UI / log 都顯示 3.1,但實際是 2.5,除錯時容易走錯方向 |
| **model 能力上限凍結** | 無法享受 3.x 系列新功能(thinking mode、agent mode、Nano Banana 改版等) |
| **SDK 已 deprecated** | 每次 call 噴 warning,`@google-cloud/vertexai` 2026/6/24 下線,屆時強制遷移 |

### 1.4 為什麼現在不做?

- **影響範圍大**:21 個 file 觸碰 Gemini SDK
- **API 不完全相容**:`getGenerativeModel` / `generateContent` / `embedContent` 在新 SDK 的 signature 都不同
- **測試覆蓋低**:chat / KB embedding / training / research / feedback redactor / help translator / dashboard 全都要 regression 測

建議獨立 session 處理,有完整時間 + 專注測試。

---

## 2. 現況快照(這個 session 的成果)

2026-04-20 session 已做完的事,下一個 session 可以直接站在這個基礎上:

### 2.1 Provider 拆分架構([geminiClient.js](server/services/geminiClient.js))

```
GEMINI_GENERATE_PROVIDER=vertex   # 生成 default(速度快)
GEMINI_EMBED_PROVIDER=vertex      # KB embedding(避 Studio 配額)
GEMINI_PROVIDER=...               # legacy 單一開關,上面兩個未設時 fallback
```

- `getGenerativeModel({ ..., provider: 'studio' })` 可 per-call 強制 override
- `embedContent(text, { provider: 'studio' })` 同理

### 2.2 streamChat 動態降級([gemini.js](server/services/gemini.js))

```js
// 純文字走 Vertex(快);帶 inlineData 自動降級 Studio 避 Vertex gRPC 4MB 上限
provider: hasInlineData ? 'studio' : undefined
```

### 2.3 明確硬標 Studio 的 handler(防呆,不依賴動態降級)

| 位置 | 為什麼 |
|------|--------|
| [gemini.js:180 transcribeAudio](server/services/gemini.js#L180) | wav 檔動輒 40MB+,base64 後超 Vertex gRPC 4MB |
| [training.js:4452](server/routes/training.js#L4452) `/ai/analyze-screenshot` | screenshot base64 常超 4MB |
| [training.js:4668](server/routes/training.js#L4668) outline-from-screenshots | 同上 |
| [training.js:4846](server/routes/training.js#L4846) `/ai/batch-analyze` | 多張 screenshot 並送 |
| [training.js:5161](server/routes/training.js#L5161) `/recording/:sid/analyze-step/:stid` | AI 錄製逐步分析 |
| [training.js:5252](server/routes/training.js#L5252) step 批次分析 | 同上 |
| [training.js:6510](server/routes/training.js#L6510) slide AI 分析 | Hotspot block |

### 2.4 Alias map(現用)

```js
'gemini-3-flash-preview':       'gemini-2.5-flash',
'gemini-3-pro-preview':         'gemini-2.5-pro',
'gemini-3.1-pro-preview':       'gemini-2.5-pro',     // ← 要砍的目標
'gemini-3.1-flash-preview':     'gemini-2.5-flash',   // ← 要砍的目標
'gemini-2.0-flash':             'gemini-2.5-flash',
// image generation (Nano Banana) — 可能會保留
'gemini-3-pro-image-preview':   'gemini-2.5-flash-image-preview',
'gemini-3.1-pro-image-preview': 'gemini-2.5-flash-image-preview',
```

### 2.5 SDK 升級已做

- `@google/generative-ai` 0.21 → **0.24.1**(Studio 端)
- `@google-cloud/vertexai 1.12`(Vertex 端,**這個要遷走**)

---

## 3. 目標

1. 把 Vertex 呼叫改走新 SDK `@google/genai`(Google 官方唯一未來 SDK)
2. `GCP_LOCATION=global` 正常運作
3. LLM 管理介面填 `gemini-3.1-pro-preview` 時,實際上在 Vertex global 真的跑 3.1
4. 砍掉 alias map 裡的 3.x 條目(image gen 那幾條看新 SDK 命名決定是否保留)
5. 修掉 `googleSearch` tool key 只在舊 Vertex SDK 可用的窘境(新 SDK 應該兩 provider 都支援)
6. Rollback plan 完整,萬一新 SDK 壞能快速切回

---

## 4. Scope — 影響檔案清單

### 4.1 核心 wrapper(必改)

| 檔案 | 內容 |
|------|------|
| [server/services/geminiClient.js](server/services/geminiClient.js) | **整個重寫**,新 SDK 初始化、`getGenerativeModel` / `embedContent` / `extractText` / `extractUsage` 全部對應新 API |
| [server/package.json](server/package.json) | `@google-cloud/vertexai` 移除、加 `@google/genai` |

### 4.2 直接 import 兩個舊 SDK 的(要刪除 import)

只有 [geminiClient.js](server/services/geminiClient.js) 應該 import SDK。其他若有直接 `require('@google-cloud/vertexai')` 或 `require('@google/generative-ai')` 都要改走 wrapper。grep 時順便驗證。

### 4.3 透過 wrapper 使用的(21 files — 理論上 API 不變就不用改)

```
server/services/
├── gemini.js                    — streamChat / generateWithTools / generateWithImage / transcribeAudio
├── dashboardService.js          — embedContent + getGenerativeModel
├── docTemplateService.js
├── researchService.js           — deep research function calling
├── llmService.js
├── feedbackRedactor.js
├── feedbackAIService.js
├── helpTranslator.js            — help 系統翻譯
├── kbDocParser.js               — KB 文件 OCR
└── kbEmbedding.js               — KB 向量化
server/routes/
├── training.js                  — 7 處 vision handler + audio transcribe
├── chat.js                      — chat 主流程
├── admin.js                     — LLM 測試連線
├── dashboard.js                 — 戰情儀表板
├── externalKb.js                — 外部 KB
├── factoryTranslations.js
├── monitor.js
└── (webex.js)                   — Webex bot
server/database-oracle.js        — 初始化 KB embedding?
server/server.js                 — 啟動時 logStartupInfo
```

### 4.4 環境變數

| Key | 調整 |
|-----|------|
| `GCP_LOCATION` | `us-central1` → **`global`** |
| `GEMINI_GENERATE_PROVIDER` | 不變(`vertex`) |
| `GEMINI_EMBED_PROVIDER` | 不變(`vertex`) |
| 新 SDK 可能需要其他 env? | 遷移時確認 |

---

## 5. `@google/genai` API 差異速查(預估,需驗證)

| 項目 | 舊 `@google-cloud/vertexai` | 新 `@google/genai` |
|------|---|---|
| **SDK 初始化** | `new VertexAI({ project, location })` | `new GoogleGenAI({ vertexai: true, project, location })` |
| **取 model** | `vertex.getGenerativeModel({ model, ... })` | `genai.getGenerativeModel({ model, ... })` *(大概相同)* |
| **generateContent** | 回 `{ response: { candidates, usageMetadata } }` | 可能改成扁平 `{ candidates, usageMetadata }`,需驗 |
| **sendMessageStream** | `result.stream` async iterator | 類似,chunk 結構可能改 |
| **embedContent** | 舊 Vertex SDK 沒有,走 REST | 新 SDK 有 `genai.embedContent(text, { model, outputDimensionality })` |
| **googleSearch tool** | `[{ googleSearch: {} }]` | 新 SDK 可能統一成 `[{ googleSearch: {} }]`,兩 provider 都支援 |
| **Studio 用同 SDK?** | 否(Studio 走 `@google/generative-ai`) | **是** — 一個 SDK 吃兩 provider |

→ 遷完可以砍掉 `@google/generative-ai`,也能砍掉 geminiClient.js 的 provider 分支邏輯

---

## 6. 建議分階段做法

### Phase 0 — 新 session 啟動前準備

- [ ] 讀完這份 doc
- [ ] 讀 [CLAUDE.md 第 11 條](CLAUDE.md)(Gemini Provider 拆分)
- [ ] 讀 `memory/feedback_gemini_provider_split.md`
- [ ] 確認 dev 機可連 Vertex(`./certs/vertex-ai-sa.json` 存在、SA 有 `Vertex AI User` role)
- [ ] 確認 GCP project 有 Gemini 3.x preview allowlist(`Vertex AI Model Garden` → `gemini-3` → `Request access` 按鈕已通過)

### Phase 1 — 新 SDK 安裝 + geminiClient.js 重寫

- [ ] `cd server && npm install @google/genai@latest`
- [ ] 建一個分支 `feat/gemini-sdk-migration`
- [ ] `geminiClient.js` 加 feature flag env `GEMINI_SDK=new|old` — 預設 `old`,可切 `new`
- [ ] 用新 SDK 實作 `getGenerativeModel` / `embedContent` / `extractText` / `extractUsage`
- [ ] **最小可用驗證**:寫一個 `scripts/test-new-sdk.js`,跑純文字 chat + embedContent + streaming + googleSearch + inlineData 五個 case

### Phase 2 — gemini.js 適配

- [ ] `streamChat` / `generateWithTools` / `generateWithImage` / `transcribeAudio` / `generateTitle` 都過一遍
- [ ] 驗證 extractText / extractUsage 對新 SDK 的回應結構正確
- [ ] 單元測試(若無,寫幾個 quick smoke test)

### Phase 3 — routes / services 回歸測試

- [ ] chat(純文字、帶圖、帶 PDF、帶 wav)
- [ ] KB 上傳一份大文件驗證 embedding + OCR
- [ ] 教育訓練 AI 錄製 + screenshot 分析
- [ ] 深度研究
- [ ] feedback AI 分類
- [ ] dashboard 向量檢索
- [ ] help 多語言翻譯

### Phase 4 — 清理

- [ ] 砍 alias map 裡的 `gemini-3.x` 條目(image gen 看新 SDK 命名決定)
- [ ] 砍 `@google-cloud/vertexai` dependency
- [ ] 評估是否可砍 `@google/generative-ai`(若新 SDK 完全涵蓋)
- [ ] `.env` 加 `GCP_LOCATION=global` 註解變通用
- [ ] 刪 feature flag `GEMINI_SDK`
- [ ] 更新 [CLAUDE.md 第 11 條](CLAUDE.md)
- [ ] 更新 [memory/feedback_gemini_provider_split.md](../memory/feedback_gemini_provider_split.md)

### Phase 5 — 部署

- [ ] Dev 跑一週無事件
- [ ] `./deploy.sh` 推 K8s
- [ ] 確認 K8s 也跟進

---

## 7. Rollback Plan

### 觸發條件
- 任何一個 Phase 3 的 regression 測試失敗無法當場修
- 新 SDK 發現不相容問題需 Google 修

### 快速 rollback
1. `git revert` 該分支
2. `server/.env` 回 `GCP_LOCATION=us-central1`
3. `npm install @google-cloud/vertexai@1.12.0`(若已移除)
4. 重啟

因為 Phase 1 有 feature flag `GEMINI_SDK=new|old`,只要新 SDK 的 commit 還在,切環境變數就能切回舊實作 — 不用 revert code。

---

## 8. Open Questions(下一個 session 要確認)

**更新 2026-04-20 後半段 session**:以下 REST API 實測在 [server/certs/vertex-ai-sa.json](server/certs/vertex-ai-sa.json) SA 下進行,project=`gen-lang-client-0778788825`:

```
✅ global      + gemini-3.1-pro-preview → 正常回應
❌ global      + gemini-3-pro-preview   → 404(Google 已下架 3.0)
❌ us-central1 + gemini-3.1-pro-preview → 404(regional 沒有 3.x)
```

Vertex AI Studio 頁面也成功試出 thinking mode(「思考了 26 秒」)+ 真 2026/2 新資料。結論:**project 已自動有 Gemini 3.1 access,不用申請**。

---

1. **Billing 確認**:現在 token usage 紀錄寫「gemini-3.1-pro-preview」但 Google 帳單寫「gemini-2.5-pro」(alias 降級的結果),要不要先 query Oracle `token_usage` 看現況,並決定遷完後要不要 migrate 歷史紀錄?
2. ~~**K8s allowlist**~~ — **已確認有 access**,REST 直接打能通,不用申請
3. **SDK 版本釘死策略**:新 SDK 還在快速 iterate,建議 `~x.y.z` 釘 patch 版避免 minor 意外 break
4. **Studio 還要留嗎?**:新 `@google/genai` 一個 SDK 吃兩 provider,現在架構還有 `forceProvider: 'studio'` 的 logic。遷完是否 Studio 就不需要獨立走?(但 inlineData > 4MB 的雷還在,動態降級邏輯仍須保留 — 只是不需要切 SDK,切 `vertexai: false` 即可)
5. **google_search vs googleSearch**:新 SDK 的 tool key 對兩 provider 是否統一?若是,[gemini.js:258](server/services/gemini.js#L258) 的 `{ googleSearch: {} }` 應直接可用 — 實測時驗證
6. **`gemini-3-pro-preview` 處理**:Google 已下架,alias map 要砍這筆還是保留(讓人填的話 fallback 到 3.1)?建議**砍**,填到不存在的就該報錯而不是悄悄換
7. **規劃後的 model 字串**:LLM 管理介面目前填 `gemini-3.1-pro-preview`,遷完後:
   - Gemini Pro → `gemini-3.1-pro-preview`(保持)
   - Gemini Flash → 目前填什麼?選 `gemini-3.1-flash-preview` 還是 `gemini-3-flash-preview`?Model Garden 顯示兩個都在,要實測哪個通

---

## 9. 延伸閱讀

- [Google 官方遷移指南](https://cloud.google.com/vertex-ai/generative-ai/docs/deprecations/genai-vertexai-sdk)
- [`@google/genai` npm](https://www.npmjs.com/package/@google/genai)
- 本專案相關 commits:
  - `62be89a` — 遷到 Vertex(kb embedding 撞 100 RPM)
  - `756648f` — 補 gemini-3.1-pro/flash-preview alias
  - `b240f79` — 圖片生成強制走 AI Studio
  - (本 session, 2026-04-20) — Provider 拆分 + 動態降級 + global 踩雷退回 us-central1

---

## 10. 下一個 session 的啟動提示

```
讀 docs/gemini-sdk-migration-plan.md。我們要把 @google-cloud/vertexai 遷到
@google/genai,目標是本機+K8s 都能真正跑 Gemini 3.1 Pro Preview
(不再透過 alias 降級到 2.5,因為 2.5 效果不夠好)。

Project 已確認有 Gemini 3.1 access,只需 SDK 支援 global endpoint。
從 Phase 1 開始,先在 feature flag 背後實作新 SDK,不動 old code path,
驗證完再切換。
```

### 快速 context check(下個 session 先跑)

```bash
cd server && node -e "
require('dotenv').config();
(async () => {
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const url = 'https://aiplatform.googleapis.com/v1/projects/' +
    process.env.GCP_PROJECT_ID +
    '/locations/global/publishers/google/models/gemini-3.1-pro-preview:generateContent';
  const res = await client.request({ url, method: 'POST',
    data: { contents: [{ role: 'user', parts: [{ text: 'ping' }] }] } });
  console.log(res.data.candidates?.[0]?.content?.parts?.[0]?.text);
})();
"
```

回傳正常文字 → 環境還 OK,可開工;404 / auth 錯 → 先檢查 SA 權限 / env。
