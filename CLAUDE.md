# CLAUDE.md — FOXLINK GPT

> 正崴 AI 整合平台 — LLM 對話 + 教育訓練 + AI 工具集

---

## 目錄結構

```
foxlink_gpt/
├── server/              # Node.js/Express backend (port 3007)
├── client/              # React/TypeScript/Vite frontend (port 5173)
├── chrome-extension/    # Chrome Extension（操作錄製 → AI 生成教材）
├── docs/                # 所有設計文件 + 實作報告
├── k8s/                 # Kubernetes 部署 manifests
├── refrence_project/    # 參考專案（唯讀，勿修改）
├── docker-compose.yml   # Docker 部署
├── Dockerfile           # 多階段 Docker build
└── deploy.sh            # K8s 部署腳本（build → push → apply）
```

## 啟動方式

```bash
cd server && npm run dev    # backend → localhost:3007
cd client && npm run dev    # frontend → localhost:5173 (proxy → 3007)
```

**預設管理員**：帳號 `ADMIN`，密碼見 `server/.env` 的 `DEFAULT_ADMIN_PASSWORD`

## 技術棧

| 層 | 技術 |
|----|------|
| DB | **Oracle 23 AI**（`database-oracle.js`）— SQLite (`database.js`) 已廢棄 |
| Backend | Express + multer + SSE streaming |
| Frontend | React 18 + Vite + TailwindCSS + lucide-react |
| AI | `@google/generative-ai` (Gemini Pro/Flash) |
| Auth | UUID token in-memory Map（非 JWT）— K8s 需 Redis |
| i18n | i18next（zh-TW / en / vi 三語言） |
| File Gen | pptxgenjs, docx, pdfkit, xlsx |

---

## 文件索引（docs/）

| 文件 | 內容 |
|------|------|
| `training-platform-design.md` | 教育訓練平台設計文件（完整規格） |
| `training-platform-implementation.md` | 教育訓練平台實作報告（Phase 1–3C） |
| `hotspot-region-management.md` | Hotspot 區域管理系統設計 |
| `ai-dashboard-design.md` | AI 戰情室儀表板設計 |
| `tool-architecture.md` | MCP / DIFY / 技能工具架構 |
| `deployment-plan.md` | K8s 部署計畫（含 P0 checklist） |
| `k8s-installation-guide.md` | K8s 安裝步驟 |
| `k8s-monitor-plan.md` | Loki + Uptime Kuma 監控 |
| `multiple_db_plan.md` | 多資料庫架構規劃 |
| `doc-template-plan.md` | 文件模板功能規劃 |
| `doc-template-feature-spec.md` | 文件模板功能規格 |
| `share-permission-category-design.md` | 共享權限分類設計 |
| `data-policy-category-binding-design.md` | 資料政策分類綁定 |
| `gmail-api-integration-design.md` | Gmail API 整合 |
| `webex-bot-spec.md` | Webex Bot 規格 |
| `feedback-platform-design.md` | 問題反饋平台設計文件 |
| `feedback-platform-implementation.md` | 問題反饋平台實施報告（Phase 1–5） |
| `test-plan-v2-tag-workflow.md` | 標籤工作流測試計畫 |
| `llm-performance-optimization.md` | LLM 效能優化（streaming、genConfig、AOAI 相容性） |
| `response-optimization.md` | 回應速度優化（Webex webhook/websocket + 網頁版 Phase 2） |
| `webex-webhook-firewall-setup.md` | Webex Webhook 防火牆與 Nginx 設定（網管操作文件） |
| `erp-tools-design.md` | ERP FUNCTION/PROCEDURE 工具化設計（LLM tool-calling + 手動 + Inject） |
| `kb-retrieval-architecture-v2.md` | **KB 檢索 v2 架構實作紀錄**（Phase 1/2/3a/3b/3c + 踩坑 + config 索引） |
| `gemini-sdk-migration-plan.md` | **Gemini SDK 遷移計畫**：`@google-cloud/vertexai` → `@google/genai`（獨立 session 處理） |
| `chat-inline-chart-plan.md` | **Chat Inline Chart 規劃書**：MCP / LLM 輸出自動畫 ECharts（與戰情室解耦） |
| `precious-metals-plan.md` | **貴金屬情報平台 — 內部實作規劃**：業務脈絡 / Phase 0-3 規劃 / **Phase 5 實施成果**(Track A/B/C/F 全 ship) |
| `phase5-plan.md` | **Phase 5 規劃書**：6 候選 track(A/B/C/D/E/F);最終 ship A+B+C+F,D/E 暫緩 |
| `phase6-plan.md` | **Phase 6 規劃書**：9 候選 track(G 體檢 / H token / I prompt edit / J card / K ERP schema 助手 / L retry / M i18n / N mobile / O 對話視圖),待拍板 |
| `audio-stt-pipeline-plan.md` | **長音檔轉逐字稿 Pipeline 規劃**：Google STT v2(diarization)+ Gemini 校正,>100MB 走新 pipeline、< 100MB 沿用 transcribeAudio。Q1-Q5 已拍板,P0-P5 切分,待開工 |

---

## 多語言規則（重要！）

**所有使用者可見的文字都必須支援 zh-TW / en / vi 三個語言。**

### 前端靜態文字
- 使用 `t('key')` — i18n key
- 三個 locale 檔都要同步新增：
  - `client/src/i18n/locales/zh-TW.json`
  - `client/src/i18n/locales/en.json`
  - `client/src/i18n/locales/vi.json`

### DB 動態內容（教育訓練）
- 課程：`course_translations`（title, description）
- 章節：`lesson_translations`（title）
- 投影片：`slide_translations`（content_json, notes, audio_url）
- 題目：`quiz_translations`
- 分類：`category_translations`（name）
- **讀取 API 必須接受 `?lang=` 參數，並 LEFT JOIN 翻譯表 merge 回去**
- 翻譯流程：CourseEditor 的 Translate tab → `POST /courses/:id/translate` (SSE)

### DB 動態內容（其他功能）
- 技能/DIFY/KB/MCP/AI戰情 → 各自有 `*_translations` 表
- Help 系統 → `help_sections` + `help_translations`

---

## Help 系統

使用者說明頁面採 DB 驅動的多語言架構。

- **種子資料**：`server/data/helpSeedData.js`（zh-TW 原始內容 = source of truth）
- **自動同步**：`server/services/helpAutoSeed.js` — server 啟動時比對 `last_modified`，自動匯入
- **翻譯**：Admin 介面 `HelpTranslationPanel` 可 LLM 批次翻譯
- **渲染**：`client/src/components/HelpBlockRenderer.tsx`

### 修改說明內容時的規則

1. 編輯 `server/data/helpSeedData.js` 對應 section
2. **必須 bump `last_modified`** 為當天日期（`YYYY-MM-DD`）
3. 這會觸發 server 啟動時自動同步 + Admin 翻譯面板顯示「過期」
4. 若檔案太大，可編輯 `_helpSeed_part1.js` / `_helpSeed_part2.js` 再跑 `node server/data/mergeSeeds.js`

---

## DB 慣例

- **Oracle + `database-oracle.js`** — `createTable()` 自動 check-if-exists
- PK: `NUMBER GENERATED ALWAYS AS IDENTITY`
- JSON 用 `CLOB`
- 時間戳: `TIMESTAMP DEFAULT SYSTIMESTAMP`
- Migration: 在 `runMigrations()` 裡用 `ALTER TABLE` + column existence check
- **不要用 SQLite 的 `database.js`** — 已廢棄

## API 慣例

- 所有路由 `/api/*`
- Auth: `verifyToken` middleware → `req.user`
- 錯誤: `catch(e) { res.status(500).json({ error: e.message }) }`
- SSE: `res.setHeader('Content-Type', 'text/event-stream')` → `res.write('data: ...\n\n')`
- File upload: multer → `UPLOAD_ROOT/` 或 `course_{id}/`

---

## 部署

### Docker（單機）

```bash
docker-compose up -d --build
```

- **Services**: Node.js app (port 3007) + Redis 7-alpine
- **Volumes**: uploads, logs, backups, fonts, skill_runners, Oracle Instant Client
- **Health check**: `GET /api/health` every 30s

### Kubernetes（正式環境）

```bash
./deploy.sh [tag]
```

1. Build image → push 到 `10.8.93.11:5000/foxlink-gpt:[tag]`
2. Sync `.env` → K8s secrets
3. Apply manifests: RBAC, Deployment (3 replicas), Service, Ingress, NFS PVC
4. Rolling restart + status watch

**K8s manifests**（`k8s/` 目錄）：
- `deployment.yaml` — 主 app（512Mi–2Gi RAM, 500m–2000m CPU）
- `redis.yaml` — Redis Pod + Service（token store）
- `nfs-pvc.yaml` — Synology NFS 500Gi（uploads 持久化）
- `ingress.yaml` — nginx-ingress（SSE timeout 3600s）
- `loki-stack.yaml` — Grafana + Loki + Fluent Bit（集中式 log）
- `uptime-kuma.yaml` — 健康監控

**K8s 部署關鍵注意事項**：
- Token store 必須用 Redis（多 Pod 共享 session）
- nginx-ingress 需設 `proxy-read-timeout: 3600s`（長 SSE）
- Uploads 必須用 NFS PVC，不可用 container local
- Oracle connection pool: `poolMax ≥ 25`（3 pods × 25）
- SIGTERM graceful shutdown 60s（保護 SSE 連線）

---

## Chrome Extension（操作錄製工具）

**位置**：`chrome-extension/`

**功能**：在目標系統上錄製操作步驟 → 自動截圖上傳到 FOXLINK GPT server → AI 辨識生成互動教材。

**使用流程**：
1. `chrome://extensions` → 載入解壓縮（或打包 .crx 發佈）
2. Popup 輸入 server URL + 登入帳密
3. 在教育訓練平台點「AI 錄製」→ 取得 Session ID
4. Extension popup 貼上 Session ID → 開始錄製
5. 操作目標系統 → 每次 UI 互動自動截圖
6. 支援手動截圖、矩形裁切、標註模式
7. 停止錄製 → server 端 AI 處理步驟 → 生成教材

**檔案**：
- `manifest.json` — Manifest v3, 全域權限
- `popup.html/popup.js` — 登入 + 錄製控制 UI
- `content.js` — 頁面注入，截圖 + 標註
- `background.js` — Service worker

---

## 環境變數（server/.env）

| Key | 用途 |
|-----|------|
| `PORT` | Server port（預設 3007） |
| `GEMINI_API_KEY` | Google Gemini API key（AI Studio） |
| `GEMINI_MODEL_PRO` | 高品質模型（如 `gemini-3-pro-preview`） |
| `GEMINI_MODEL_FLASH` | 快速模型（如 `gemini-3-flash-preview`） |
| `GEMINI_GENERATE_PROVIDER` | `studio`（預設、chat/vision/audio）或 `vertex` |
| `GEMINI_EMBED_PROVIDER` | `vertex`（預設、KB 向量化）或 `studio` |
| `GEMINI_PROVIDER` | legacy 單一開關，兩個細項 env 未設時沿用 |
| `GCP_PROJECT_ID` / `GCP_LOCATION` / `GOOGLE_APPLICATION_CREDENTIALS` | Vertex AI 必要 |
| `DEFAULT_ADMIN_ACCOUNT` | 預設管理員帳號 |
| `DEFAULT_ADMIN_PASSWORD` | 預設管理員密碼 |
| `JWT_SECRET` | Token 簽名（名稱歷史遺留，實際是 UUID map） |
| `ADMIN_NOTIFY_EMAIL` | 管理員通知信箱 |
| `SMTP_SERVER/PORT/USERNAME/PASSWORD` | SMTP 發信 |
| `FROM_ADDRESS` | 寄件者信箱 |
| `LDAP_URL/BASE_DN/MANAGER_DN/MANAGER_PASSWORD` | AD 整合（選配） |
| `DB_PATH` | SQLite 路徑（已廢棄） |
| `UPLOAD_DIR` | 上傳檔案根目錄 |
| `REDIS_URL` | Redis 連線（K8s 必須） |
| `MCP_JWT_PRIVATE_KEY_PATH` | MCP User Identity JWT 私鑰 PEM 路徑（簽發 X-User-Token） |
| `MCP_JWT_PUBLIC_KEY_PATH` | MCP User Identity JWT 公鑰 PEM 路徑（驗證 / 下載給 MCP 團隊） |

---

## 關鍵注意事項

1. **`refrence_project/` 是唯讀的**，不要修改
2. **Auth 是 in-memory UUID Map**，server 重啟會清掉所有 session。K8s 部署需改用 Redis
3. **sql.js / database.js 已完全廢棄**，只使用 `database-oracle.js`
4. **AI 檔案生成**：Gemini 回應中的 ` ```generate_xlsx:filename``` ` 代碼塊由 `server/services/fileGenerator.js` 解析並生成檔案
5. **SSE Streaming**：chat 和翻譯功能使用 SSE，前端需處理 `text/event-stream`
6. **CJK PDF**：需要 `server/fonts/NotoSansTC-Regular.ttf`
7. **音訊轉錄**：使用 Gemini Flash（比 Pro 快）
8. **LDAP displayName 格式**：`"工號 姓名"`（如 `"12345 王小明"`）
9. **MCP User Identity（RS256 JWT）**：per-server `mcp_servers.send_user_token=1` 才會簽發 `X-User-Token` header。私鑰僅 FOXLINK GPT 持有（`server/certs/mcp-jwt-private.pem`），公鑰給 MCP 團隊驗簽。詳見 [docs/mcp-user-identity-auth.md](docs/mcp-user-identity-auth.md)。
    - 簽發邏輯：`signUserToken` 在 [server/services/mcpClient.js](server/services/mcpClient.js)
    - email 缺失 → throw `MCP_JWT_EMAIL_REQUIRED`（不 fallback）
    - stdio 必須 per-call spawn（token 在 env，5min 後過期）
    - CLI 驗證：`node server/scripts/verify-mcp-token.js <token>`
    - Admin UI 提供公鑰下載 + 測試 token 產生（MCP 伺服器編輯 Modal 內）
10. **KB 檢索 v2 架構（Phase 1-3c）**：核心在 [server/services/kbRetrieval.js](server/services/kbRetrieval.js) 單一入口 `retrieveKbChunks(db, opts)`。
    - **SELECT 必須含 `retrieval_config`** — chat/webex/research/外部 caller 載 KB 時務必帶這個 CLOB 欄位；少撈會讓所有 per-KB 檢索覆寫 noop（同義詞、multi-vector、權重等）
    - Config 優先序：`kb.retrieval_config > system_settings.kb_retrieval_defaults > HARDCODED_DEFAULTS`
    - Schema 補充：`kb_chunks.title_embedding VECTOR(768, FLOAT32)`（multi-vector）、`kb_thesauri` / `kb_thesaurus_synonyms`（同義詞追蹤表）
    - Oracle Text 索引 `kb_chunks_ftx` 用 `SYNC (EVERY "SYSDATE+1/1440")`，查詢最多 1 分鐘 lag，**解決 bulk insert 慢問題**
    - 同義詞改用 app-level query-time OR 展開（`kbSynonyms.expandQuery`），不走 CTX_THES（權限缺）
    - chat 把同義詞 hint 塞進 LLM context：「X=Y 同一實體，請統合對應 chunks」
11. **Gemini Provider 拆分 + SDK 選擇**：實作於 [server/services/geminiClient.js](server/services/geminiClient.js)。
    - **預設值（生產）**：`GEMINI_GENERATE_PROVIDER=vertex` + `GEMINI_EMBED_PROVIDER=vertex` + `GCP_LOCATION=global` + `GEMINI_SDK=new`
    - **`GEMINI_SDK=new|old` feature flag（遷移用）**:
      - `new` = `@google/genai`(統一 SDK,支援 Vertex global endpoint,**可跑真 Gemini 3.1 Pro Preview**,預設)
      - `old` = `@google-cloud/vertexai + @google/generative-ai`(legacy 保留,作 rollback)
      - 2026-04-21 起 new 為預設。Phase 4 驗證穩定後將砍 old 分支 + `@google-cloud/vertexai` dependency
    - **Vertex global 可跑 Gemini 3.x**(2026-04-21 實測):`gemini-3.1-pro-preview` 在 `GCP_LOCATION=global` + new SDK 下直接通。舊 SDK 打 global 會回 HTML(`Unexpected token '<'`),所以切 new SDK 必須配 global
    - **Alias 拆兩張表**(`VERTEX_MODEL_DEFAULTS_OLD_SDK` / `VERTEX_MODEL_DEFAULTS_NEW_SDK`):
      - old SDK:`gemini-3.x → 2.5` 降級(regional 限制)
      - new SDK:**只保留** `gemini-3-pro-preview → gemini-3.1-pro-preview`(Google 下架 3.0 的 replacement alias)+ image gen 命名轉換
      - 長期建議 DB / env 直接填 `gemini-3.1-pro-preview`,alias 只是安全網
    - **Gemini 3 thinking mode leak 修正**(2026-04-21):
      - 3.x 系列預設 `includeThoughts=false` → SDK 把 thought 段合併進 final text 回,streamChat 會在中文回答前 leak 英文 planning。wrapper 對 `gemini-3*` 自動設 `includeThoughts=true`,`extractText` 一律 filter `!p.thought`
      - 3.x Flash 預設 dynamic thinkingBudget 會把 simple chat 拖到 ttft 166s;chat 路徑對 Flash 自動 default budget=512(在 [gemini.js `_resolveThinkingBudget`](server/services/gemini.js),只對 streamChat / generateWithToolsStream 生效,batch service 的 Flash 保留 dynamic)
      - 修 gemini.js 長期 typo `thinkBudget` → `thinkingBudget`(SDK 不認舊名,DB 設的 thinking_budget 從未生效過)
      - 容錯 Gemini 3 新 finishReason `UNEXPECTED_TOOL_CALL`,不炸整個 request
    - **reasoning_effort UI**(Sidebar + chat.js):Azure GPT-5 原有的 low/medium/high selector 擴到 Gemini 3.x(排除 image model);per-message 傳 `reasoning_effort` → [`_resolveThinkingBudget`](server/services/gemini.js) 對應 Flash(512/2048/8192) / Pro(2048/8192/24576)。深度研究另有獨立設定(見 [server/services/researchService.js](server/services/researchService.js) + admin 介面)
    - **動態降級 Studio**:[streamChat](server/services/gemini.js) 偵測到 `hasInlineData=true` 自動 override `provider: 'studio'`,避 Vertex gRPC 4MB inline 上限;新增 vision / audio / 大檔 handler 仍明確加 `provider: 'studio'` 當防呆(見 training.js 7 處、transcribeAudio)
    - **LLM 管理介面新增 Gemini model**:`api_model` 填 **Vertex global 認得的名字**(如 `gemini-3.1-pro-preview`、`gemini-2.5-flash`)
    - **Legacy 相容**:`GEMINI_PROVIDER` 仍可作 fallback(兩個細項 env 未設時沿用);`GEMINI_SDK` 未設 = old(向下相容)
