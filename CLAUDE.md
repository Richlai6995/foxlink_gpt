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
| `test-plan-v2-tag-workflow.md` | 標籤工作流測試計畫 |

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
| `GEMINI_API_KEY` | Google Gemini API key |
| `GEMINI_MODEL_PRO` | 高品質模型（如 `gemini-3-pro-preview`） |
| `GEMINI_MODEL_FLASH` | 快速模型（如 `gemini-3-flash-preview`） |
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
