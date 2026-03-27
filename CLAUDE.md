# CLAUDE.md
This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.


# 角色
你是一位資深的LLM GPT 對話設計系統設計師。請根據需求描述協助我設計一個適用於使用者對話的網頁, 名稱是「FOXLINK GPT」

## 參考這個專案的子目錄 “refrence_project” 的相關登入機制及畫面及所有程式, 但將網頁改為類似Google Gemini 樣式的LLM對答視窗,程式重點如下:
*** 保留使用者管理介面的 新增使用者頁簽 功能及邏輯,但是角色權限 僅保留一般使用者及 系統管理員, 所屬群組 (Group) 及 專案根目錄 (Project Root) 不需要
, 群組管理頁簽不需要, 系統設定頁簽 保留 資料庫維護功能及 郵件伺服器管理 功能 
*** 使用者登入啟用邏輯與舊專案相同
*** 使用ENV的GOOGLE API KEY:GEMINI_API_KEY
*** 預設使用GEMINI 3.0 PRO模型,並可以給使用者切換3.0 FLASH,類似本專案的AI分析功能切換模型
*** 可以上傳多個 文字檔,Excel,word,ppt ,pdf,圖片,聲音檔案(限制50M),但不允許輸入錄影檔案, 系統要有將聲音轉為文字能力,要有將輸出轉為其他各種輸出檔案的能力
*** 可以輸出 文字檔,Excel,word,ppt ,pdf及圖片
*** 回答mark down 必須格式化輸出
*** 可以複製問答內容
*** 單一session要有記憶功能
*** 所有對話要能存留歷史紀錄並可以讓使用者刪除
*** 建立sqlite db紀錄彙總整理每天一筆每個使用者問答不同llm model之進及出的token數量,包含使用者的工號及姓名,日期,llm model,進/出 token數量. 並可以於系統管理介面查詢
*** 要記錄使用者的對話紀錄以作為稽核使用,並可以建立敏感用語稽核系統,可以發生時紀錄並通知管理員. 並可以於系統管理介面查詢
*** 預設管理員帳密請參考ENV的 DEFAULT_ADMIN_ACCOUNT,可以管理及觀看後台的 必須參考 使用者設定 ,系統管理員 才有權限
*** 可以仿照Gemini自行加上應該有的功能並與我確認
## 網頁風格
  * 以藍色/灰色為基調,功能都用簡單的圖片icon表示功能選項,網頁風格以簡單/精簡為設計風格


## Reference Project Overview

**正崴雲端智慧發信系統 (Foxlink Cloud Smart Mailing System)** — An enterprise web app for file management, automated document generation, smart email sending, and AI assistance. The `refrence_project/` directory is the **reference implementation** to study and build upon.

## Commands

### Server (Node.js/Express)
```bash
cd refrence_project/server
npm start         # production
npm run dev       # development (node --watch)
```

### Client (React/Vite)
```bash
cd refrence_project/client
npm run dev       # dev server at localhost:5173 (proxies /api → localhost:3000)
npm run build     # tsc -b && vite build
npm run lint      # eslint
npm run preview   # preview production build
```

### Docker
```bash
docker-compose up -d --build   # build & start all services
```

## Architecture

### Monorepo Layout
```
refrence_project/
├── server/          # Node.js/Express backend
├── client/          # React/TypeScript/Vite frontend
├── docs/            # User & admin manuals
└── docker-compose.yml
```

### Backend (`server/`)

**Entry point**: `server.js` — loads DB, then dynamically requires all route modules after DB init. Services (scheduler, backup, mail cleanup) start after `app.listen()`.

**Database**: `database.js` wraps `sql.js` (pure-JS SQLite) with a custom `DatabaseWrapper`/`StatementWrapper` that mimics `better-sqlite3` API (`.prepare()`, `.run()`, `.get()`, `.all()`). Every write calls `saveDB()` which atomically writes to disk via temp-file rename. **Important**: Always call `.free()` implicitly through the wrappers; direct `sql.js` statements must be freed manually.

**Auth**: `routes/auth.js` uses UUID tokens stored in an **in-memory Map** (not JWT despite naming). Token passed as `Authorization: Bearer <uuid>`. Login flow: LDAP first (skip for `ADMIN`) → fallback to local DB. LDAP parses `displayName` as `"<employeeId> <name>"`. `verifyToken` middleware exported for use in other routes.

**Route modules** (all under `/api`):
- `/auth` — login/logout + `verifyToken` middleware
- `/users`, `/groups` — user & group CRUD
- `/projects`, `/folders`, `/files` — file management hierarchy
- `/ai` — Gemini chat with file context extraction
- `/admin` — system management, DB backup/restore
- `/templates`, `/mail`, `/docs` — document generation pipeline

**Key Services**:
- `services/gemini.js` — singleton `GeminiService`. Handles multi-modal context: images (inline base64), Office files (manual ZIP/XML extraction via JSZip), PDFs (pdf-parse). AI responses can embed special code blocks (`csv_to_xlsx:`, `html_to_docx:`, `text_to_pdf:`) that trigger server-side file generation.
- `services/scheduler.js` — singleton `Scheduler`. Loads `doc_schedules` on init, runs cron jobs via `node-cron`. Skips execution if target date folder doesn't exist on disk. Sends notification emails to project members when documents are incomplete.
- `services/docGenerator.js` — generates HTML/DOCX/PDF from templates with variable substitution.
- `services/mailService.js` — SMTP via nodemailer, logs all sends to `mail_logs` table, includes auto-cleanup scheduling.
- `services/backupService.js` — scheduled SQLite DB backup to configured path.
- `services/projectSyncService.js` — syncs project file listings (local FS scan, optional Google Drive).

**File Storage**: Local FS under `server/uploads/` (or `FILES_ROOT_DIR` env var in Docker). AI sessions saved as JSON per project: `uploads/project_<id>/_ai_sessions/<uuid>.json`.

**Schema migrations**: Done inline in `database.js:initSchema()` using `PRAGMA table_info` checks + `ALTER TABLE`. No migration framework.

### Frontend (`client/src/`)

**Router**: `App.tsx` — 3 routes: `/login`, `/admin` (admin only), `/workspace/projects`.

**Auth**: `context/AuthContext.tsx` stores JWT in `localStorage`. `api.ts` is an axios instance with base `/api` (proxied in dev) that auto-attaches token and redirects to `/login` on 401.

**Pages**:
- `Login.tsx` — credential form
- `AdminDashboard.tsx` — user/group/system management (wraps `SystemManagement.tsx`)
- `ProjectWorkspace.tsx` — main workspace: file browser + AI chat + template/schedule management

**Key Components**:
- `AIChat.tsx` — multi-turn chat with file attachment support; parses AI response for generated file download links
- `DocViewer.tsx` — inline HTML document viewer
- `TemplateManager.tsx` / `ScheduleManager.tsx` — template editor with variable syntax, cron schedule config
- `SimpleRichTextEditor.tsx` — contenteditable-based rich text for template content

**Types**: All shared types in `client/src/types.ts`. User roles: `'admin' | 'pm' | 'user'`.

## Environment Variables (`server/.env`)

| Key | Purpose |
|-----|---------|
| `PORT` | Server port (default 3000) |
| `JWT_SECRET` | Signing secret (currently unused — tokens are UUID in memory) |
| `GEMINI_API_KEY` | Required for AI features |
| `LDAP_URL`, `LDAP_BASE_DN`, `LDAP_MANAGER_DN`, `LDAP_MANAGER_PASSWORD` | AD integration (optional) |
| `SMTP_SERVER`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `FROM_ADDRESS` | Email sending |
| `DB_PATH` | SQLite file location (default `server/system.db`) |
| `FILES_ROOT_DIR` | File storage root (Docker: `/app/local_storage`) |

## Key Patterns

- **DB access in routes**: Always `const { db } = require('../database')` at the top of route files; the `db` object is populated after `init()` completes.
- **No JWT**: Despite the variable name `JWT_SECRET`, auth uses UUID tokens in a server-side in-memory Map. Sessions are lost on server restart.
- **sql.js quirk**: `db.prepare(sql).run(params)` frees the statement automatically via `StatementWrapper`. Directly using `dbInstance.prepare()` requires manual `.free()`.
- **Docker path remapping**: Scheduler remaps `project.local_path` (Windows dev path) to `FILES_ROOT_DIR`-relative path using regex matching on `file_management_container` or `files` path segments.
- **AI file generation**: Gemini responses with ` ```csv_to_xlsx:filename.xlsx ``` ` blocks are parsed by the `/api/ai` route to generate actual files server-side.

# 使用說明檔案: HelpPage.tsx
- 需要改變說明時編輯此檔案