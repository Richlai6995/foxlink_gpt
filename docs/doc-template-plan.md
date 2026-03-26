# 文件範本功能 — 技術規劃書

> **版本**: v1.1
> **日期**: 2026-03-26
> **狀態**: 規劃中（未實作）

---

## 1. 功能概述

使用者上傳 Word/Excel/PDF 文件，由 AI 辨識可替換欄位（變數），存為可重複使用的範本。
範本可在可視化介面調整變數設定，分享給其他人，並由使用者填入資料後自動生成文件。

### 核心流程

```
上傳文件 → AI 辨識變數 → 使用者確認/調整 → 儲存範本
                                                ↓
                            其他人引用範本 → 填入變數值 → 自動生成文件
```

---

## 2. 架構策略

### 2.1 主力路線：原生範本引擎（A 路線）

**適用格式**: DOCX、XLSX、PDF（表單型）

**核心原理**: 上傳的文件**本身就是範本**，AI 協助識別可替換欄位，將其轉為 `{{placeholder}}` 語法存回原檔。生成時用範本引擎做變數替換，格式 100% 保留。

```
上傳 DOCX
  → mammoth 擷取純文字
  → LLM 分析「哪些內容是變數」
  → 回傳 variable schema JSON
  → 使用者在 UI 確認/調整變數
  → Server 用 JSZip 打開原始 DOCX，將對應文字替換為 {{placeholder}}
  → 存為範本檔（原始 DOCX + variable schema JSON）

生成時：
  → docxtemplater 載入範本 DOCX
  → 注入使用者資料
  → 輸出新 DOCX
```

### 2.2 各格式引擎對照

| 格式 | 擷取工具 | 範本引擎 | 生成保真度 | Phase |
|------|----------|----------|-----------|-------|
| DOCX | mammoth | **docxtemplater** + pizzip | 100%（原檔格式完整保留） | Phase 1 |
| XLSX | exceljs (read) | **exceljs** (write) | 100%（儲存格/公式/樣式保留） | Phase 1 |
| PDF（有表單） | pdf-lib (AcroForm detect) | **pdf-lib** (fill fields) | 100%（僅填充表單欄位） | Phase 1 |
| PDF（無表單） | pdf-parse → 文字 | **pdfkit** 重建 | ~60%（格式近似，無法完美還原） | Phase 2 |
| PPTX | jszip + XML parse | **pptxgenjs** 重建 | ~70%（版面近似） | Phase 2 |

### 2.3 PDF 特殊處理說明

PDF 本質是排版完成的輸出格式，存在以下限制：

| 困難點 | 說明 |
|--------|------|
| 文字非連續 | 每個字是獨立的 (x,y) 座標字形，需重組 |
| 無結構資訊 | 表格是線條拼出的，不是 `<table>` |
| 替換會破版 | 新文字長度不同會溢出/重疊，PDF 不會 reflow |
| 字型嵌入 | 原 PDF 子集字型可能缺少替換後的新字 glyph |

**策略**:
- Phase 1：僅支援 **fillable PDF**（AcroForm），`pdf-lib` 偵測表單欄位 → 直接映射為變數 → 填值生成
- Phase 2：無表單 PDF 走 AI 擷取結構 → PDFKit 重建（需提示使用者「格式為近似」）

---

## 3. 實作分階段

### Phase 1（核心功能）

| 項目 | 內容 |
|------|------|
| DB schema | `doc_templates`, `doc_template_shares`, `doc_template_outputs` |
| API routes | `/api/doc-templates` CRUD + upload + generate |
| DOCX 範本 | docxtemplater 原生替換 |
| XLSX 範本 | ExcelJS 儲存格替換 |
| PDF 表單 | pdf-lib AcroForm 填充 |
| 前端 | 上傳精靈 + 變數 schema 編輯器 + 範本庫 + 生成 Modal |
| 分享機制 | 公開/指定使用者/指定角色 |

### Phase 2（擴展）

| 項目 | 內容 |
|------|------|
| PPTX 範本 | PptxGenJS 重建（格式近似） |
| PDF AI 重建 | PDFKit 生成（格式近似，標示提示） |
| WYSIWYG 編輯器 | 視覺化範本結構編輯（如有需求） |
| 版本控制 | 範本版本歷史 + diff |
| 批次生成 | 上傳 CSV/Excel 資料，一次生成多份文件 |

---

## 4. DB Schema

```sql
-- ======================================================
-- 文件範本
-- ======================================================
CREATE TABLE doc_templates (
  id             VARCHAR2(36) PRIMARY KEY,
  creator_id     NUMBER NOT NULL REFERENCES users(id),
  name           VARCHAR2(200) NOT NULL,
  description    CLOB,
  format         VARCHAR2(20) NOT NULL,          -- docx / xlsx / pdf
  strategy       VARCHAR2(20) DEFAULT 'native',  -- native / pdf_form / ai_schema
  template_file  VARCHAR2(500),                  -- 範本檔路徑 (uploads/templates/xxx.docx)
  original_file  VARCHAR2(500),                  -- 原始上傳檔路徑（保留原檔供對照）
  schema_json    CLOB,                           -- variable schema JSON (見 4.1)
  preview_url    VARCHAR2(500),                  -- 預覽縮圖路徑
  is_public      NUMBER(1) DEFAULT 0,
  tags           CLOB,                           -- JSON array, e.g. ["HR","月報"]
  use_count      NUMBER DEFAULT 0,
  forked_from    VARCHAR2(36) REFERENCES doc_templates(id) ON DELETE SET NULL,  -- 複製來源
  created_at     TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at     TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- ======================================================
-- 範本分享（與現有 ai_dashboard_shares 等一致的 grantee 模型）
-- ======================================================
CREATE TABLE doc_template_shares (
  id             NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id    VARCHAR2(36) NOT NULL REFERENCES doc_templates(id) ON DELETE CASCADE,
  share_type     VARCHAR2(20) DEFAULT 'use',       -- 'use' | 'edit'
  grantee_type   VARCHAR2(20) NOT NULL,            -- 'user'|'role'|'department'|'cost_center'|'division'|'org_group'
  grantee_id     VARCHAR2(100) NOT NULL,           -- 被分享者 ID
  granted_by     NUMBER REFERENCES users(id),      -- 分享者
  created_at     TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT uq_doc_tpl_share UNIQUE (template_id, grantee_type, grantee_id)  -- upsert 用
);

-- ======================================================
-- 生成紀錄
-- ======================================================
CREATE TABLE doc_template_outputs (
  id             VARCHAR2(36) PRIMARY KEY,
  template_id    VARCHAR2(36) NOT NULL REFERENCES doc_templates(id),
  user_id        NUMBER NOT NULL REFERENCES users(id),
  input_data     CLOB,                                   -- 使用者填入的變數值 JSON
  output_file    VARCHAR2(500),                           -- 生成的檔案路徑
  output_format  VARCHAR2(20),                            -- 輸出格式 (可與範本不同)
  created_at     TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE INDEX idx_doc_tpl_creator ON doc_templates(creator_id);
CREATE INDEX idx_doc_tpl_shares_tpl ON doc_template_shares(template_id);
CREATE INDEX idx_doc_tpl_shares_grantee ON doc_template_shares(grantee_type, grantee_id);
CREATE INDEX idx_doc_tpl_outputs_tpl ON doc_template_outputs(template_id);
CREATE INDEX idx_doc_tpl_outputs_user ON doc_template_outputs(user_id);
CREATE INDEX idx_doc_tpl_forked ON doc_templates(forked_from);
```

### 4.1 Variable Schema JSON 結構

```jsonc
{
  "variables": [
    {
      "key": "company_name",        // 唯一識別碼，用於 {{company_name}}
      "label": "公司名稱",           // 顯示名稱
      "type": "text",               // text / number / date / select / loop
      "required": true,
      "default_value": "",
      "placeholder": "例：正崴精密工業",
      "description": "合約甲方公司全名",
      "options": null,              // type=select 時的選項 ["選項A","選項B"]
      "validation": null            // 可選的正規表示式驗證
    },
    {
      "key": "contract_date",
      "label": "合約日期",
      "type": "date",
      "required": true,
      "default_value": "",
      "placeholder": "",
      "description": "",
      "options": null,
      "validation": null
    },
    {
      "key": "items",
      "label": "品項列表",
      "type": "loop",               // 重複區塊（表格行）
      "required": false,
      "default_value": "",
      "placeholder": "",
      "description": "合約品項明細表",
      "options": null,
      "validation": null,
      "children": [                 // loop 的子欄位
        { "key": "item_name", "label": "品名", "type": "text" },
        { "key": "quantity",  "label": "數量", "type": "number" },
        { "key": "unit_price","label": "單價", "type": "number" }
      ]
    }
  ],
  "metadata": {
    "extracted_by": "gemini-2.5-flash",  // 擷取用的 AI 模型
    "extracted_at": "2026-03-26T10:00:00Z",
    "confidence": 0.85,                  // AI 信心度
    "source_text_preview": "..."         // 原文前 500 字（供對照）
  }
}
```

---

## 5. API 設計

### 5.1 範本管理 (`/api/doc-templates`)

| Method | Path | 說明 |
|--------|------|------|
| GET    | `/`                    | 列表（我的 + 公開 + 分享給我的），支援 ?search=&format=&tags= |
| POST   | `/upload`              | 上傳文件 → AI 分析變數 → 回傳 schema（不存檔） |
| POST   | `/`                    | 確認建立範本（帶 schema_json） |
| GET    | `/:id`                 | 取得範本詳情 |
| PUT    | `/:id`                 | 更新範本（名稱、描述、schema、tags） |
| DELETE | `/:id`                 | 刪除範本（僅 creator 或 admin） |
| POST   | `/:id/generate`        | 填入變數值 → 生成文件 → 回傳下載路徑（需 use 權限） |
| GET    | `/:id/outputs`         | 該範本的生成紀錄 |
| GET    | `/:id/preview`         | 範本預覽（首頁縮圖或 HTML 預覽） |
| GET    | `/:id/download`        | 下載範本原始檔（需 use 權限） |
| GET    | `/:id/download?type=template` | 下載含 placeholder 的範本檔（需 edit 權限） |
| POST   | `/:id/fork`            | 複製範本為自己的副本（需 use 權限） |

### 5.2 分享 (`/api/doc-templates/:id/shares`)

與現有 `ai_dashboard_shares` 一致的 grantee 模型，支援 upsert。

| Method | Path | 說明 |
|--------|------|------|
| GET    | `/`        | 列出分享對象（含 grantee_name 解析） |
| POST   | `/`        | 新增/更新分享（upsert：同一 grantee 更新 share_type） |
| DELETE | `/:shareId`| 取消分享 |

**Request body (POST)**:
```json
{
  "share_type": "use",           // "use" | "edit"
  "grantee_type": "user",       // "user"|"role"|"department"|"cost_center"|"division"|"org_group"
  "grantee_id": "42"            // user_id / role_id / dept_code 等
}
```

### 5.3 上傳分析流程（POST `/upload`）

```
Request:  multipart/form-data { file }
Response: SSE stream
  → event: status    data: { step: "parsing", message: "擷取文件內容..." }
  → event: status    data: { step: "analyzing", message: "AI 分析變數中..." }
  → event: result    data: {
      original_text: "...",     // 擷取的純文字
      schema: { variables: [...], metadata: {...} },
      preview_html: "...",      // 預覽 HTML（標記出變數位置）
      temp_file: "xxx.docx"    // 暫存檔 ID（確認後用於建立範本）
    }
  → event: done
```

---

## 6. 前端元件規劃

### 6.1 頁面路由

```
/templates                          → TemplatesPage（範本管理主頁）
/templates/:id                      → TemplateDetailPage（範本詳情 + 生成）
```

### 6.2 元件結構

```
pages/
├── TemplatesPage.tsx               -- 範本庫主頁
│
components/templates/
├── TemplateGallery.tsx             -- 範本卡片列表（搜尋/篩選/排序）
├── TemplateCard.tsx                -- 單一範本卡片（預覽圖 + 名稱 + 格式 icon + 使用次數）
├── TemplateUploadWizard.tsx        -- 上傳精靈（3 步驟）
│   ├── Step1Upload.tsx             -- 選擇/拖放檔案
│   ├── Step2Review.tsx             -- AI 分析結果 + 預覽（高亮變數位置）
│   └── Step3Confirm.tsx            -- 命名、描述、tags、公開設定
├── VariableSchemaEditor.tsx        -- 變數 schema 表格編輯器
│   ├── 變數列表（拖拉排序）
│   ├── 各變數：key / label / type / required / default / options
│   └── loop 型變數的 children 子編輯
├── TemplateGenerateModal.tsx       -- 生成文件 Modal
│   ├── 動態表單（根據 schema 生成對應輸入欄位）
│   ├── loop 區塊可動態新增/刪除行
│   └── 生成 → 下載
├── TemplateShareModal.tsx          -- 分享設定 Modal
│   ├── 公開切換
│   ├── 搜尋使用者 / 選擇角色
│   └── 權限設定（使用 / 編輯）
└── TemplateOutputHistory.tsx       -- 生成紀錄列表
```

### 6.3 上傳精靈 UX Flow

```
┌─── Step 1: 上傳 ────────────────────────┐
│                                          │
│   ┌──────────────────────────┐           │
│   │     拖放檔案至此區域       │           │
│   │   支援 DOCX / XLSX / PDF │           │
│   └──────────────────────────┘           │
│   [選擇檔案]                              │
│                                          │
│                            [下一步 →]     │
└──────────────────────────────────────────┘

┌─── Step 2: AI 分析結果 ─────────────────┐
│                                          │
│  左側：原文預覽（高亮標記變數位置）         │
│  右側：變數 Schema 編輯器                 │
│                                          │
│  ┌──────────┬──────────────────────────┐ │
│  │ 原文預覽  │  變數列表                 │ │
│  │          │  ☑ company_name  文字     │ │
│  │ ████ 公司 │  ☑ contract_date 日期    │ │
│  │ 簽訂合約  │  ☑ items        循環     │ │
│  │ 日期 ████ │    ├ item_name  文字     │ │
│  │          │    ├ quantity   數字     │ │
│  │          │    └ unit_price 數字     │ │
│  │          │  [+ 新增變數]             │ │
│  └──────────┴──────────────────────────┘ │
│                                          │
│                   [← 上一步] [下一步 →]    │
└──────────────────────────────────────────┘

┌─── Step 3: 儲存設定 ────────────────────┐
│                                          │
│  範本名稱：[合約範本 - 標準版          ]   │
│  描述：    [標準採購合約，含品項明細表  ]   │
│  標籤：    [採購] [合約] [+]              │
│  公開：    [○ 僅自己] [● 公開]            │
│                                          │
│                   [← 上一步] [建立範本]    │
└──────────────────────────────────────────┘
```

---

## 7. 使用者引用範本 — 三入口設計

範本的使用入口分為三層，覆蓋不同使用場景：

```
1. 聊天 AI 對話     → 「幫我用 XX 範本產...」 — 最自然，power user 愛用
2. 頂端工具列 📄    → 瀏覽/挑選範本 → 填值   — 不記得範本名稱時
3. 側邊欄 /templates → 上傳/編輯/分享/管理    — 範本管理者用
```

### 7.1 入口一：聊天 AI 對話（TAG 路由整合）

新增 TAG `[DOC_TEMPLATE]`，與現有的 `[TOOL_CALL]`、`[KB_SEARCH]` 同層級。
AI 偵測到使用者意圖涉及範本時，自動查詢匹配的範本 → 從對話擷取變數值 → 生成文件。

**Flow**:

```
聊天訊息 → TAG 路由判斷
  → [DOC_TEMPLATE] → 搜尋範本庫（名稱/描述/tags 模糊匹配）
                    → 若找到 1 個：AI 從對話內容擷取變數值 → 生成文件
                    → 若找到多個：列出選項讓使用者選擇
                    → 若找不到：提示使用者沒有匹配的範本
```

**聊天內互動範例**:

```
┌─ 聊天視窗 ──────────────────────────────────────────┐
│                                                      │
│  用戶: 產一份出貨單                                    │
│                                                      │
│  AI:   我找到 2 個相關範本：                            │
│        ┌──────────────────────────────────┐           │
│        │ 1. 📄 標準出貨單 (by 王小明)       │           │
│        │ 2. 📄 國際出貨單-含海關 (by 李大華) │           │
│        │                                  │           │
│        │ [使用範本 1] [使用範本 2]           │           │
│        └──────────────────────────────────┘           │
│                                                      │
│  用戶: [點了範本1]                                     │
│                                                      │
│  AI:   請提供以下資訊（或直接用文字描述）：               │
│        ┌──────────────────────────────────┐           │
│        │ 客戶名稱：[               ]       │           │
│        │ 出貨日期：[2026-03-26     ]       │           │
│        │ 品項：    [+ 新增一行]             │           │
│        │          品名    數量   單價       │           │
│        │          [    ] [    ] [    ]     │           │
│        │                                  │           │
│        │ [生成文件]                         │           │
│        └──────────────────────────────────┘           │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**或者使用者直接在對話中提供所有資訊**:

```
┌─ 聊天視窗 ──────────────────────────────────────────┐
│                                                      │
│  用戶: 幫我用「採購合約範本」產一份合約，               │
│        甲方正崴精密，品項是 USB-C 線材                  │
│        1000 條單價 15 元                               │
│                                                      │
│  AI:   好的，我用「採購合約範本」為你生成：              │
│        ┌──────────────────────────────────┐           │
│        │ 📄 採購合約_正崴精密.docx          │           │
│        │ 甲方：正崴精密                     │           │
│        │ 品項：USB-C 線材 x1000 @15        │           │
│        │ [下載] [預覽] [重新填值]            │           │
│        └──────────────────────────────────┘           │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Server 端處理（chat.js 整合）**:

```js
// TAG 路由新增判斷
if (tag === 'DOC_TEMPLATE') {
  // 1. 搜尋匹配範本
  const templates = await searchTemplates(db, userId, query);

  if (templates.length === 0) {
    // 回覆「找不到範本」
  } else if (templates.length === 1) {
    // AI 從對話擷取變數值
    const variables = await extractVariablesFromChat(chatHistory, templates[0].schema_json);
    // 生成文件
    const outputPath = await generateDocument(templates[0], variables);
    // SSE 回傳 generated_files event
  } else {
    // 回傳範本列表讓使用者選擇（嵌入 UI 按鈕）
  }
}
```

### 7.2 入口二：頂端工具列（快速範本選擇器）

在聊天輸入框上方的工具列新增 📄 icon（與上傳、技能、KB 同列）。

**Flow**:

```
點 📄 icon
  → 彈出 Popover（範本選擇器）
    ┌────────────────────────────────┐
    │ 🔍 搜尋範本...                  │
    │                                │
    │ 最近使用                        │
    │ ┌────────┐ ┌────────┐          │
    │ │📄出貨單 │ │📊月報表 │          │
    │ │ 3次使用 │ │ 7次使用 │          │
    │ └────────┘ └────────┘          │
    │                                │
    │ 我的範本                        │
    │ ├ 📄 採購合約範本                │
    │ ├ 📊 庫存盤點表                 │
    │                                │
    │ 公開範本                        │
    │ ├ 📄 請假單 (by HR)             │
    │ ├ 📄 會議記錄 (by 管理部)        │
    │                                │
    │ [管理範本 →]                     │
    └────────────────────────────────┘
  → 選定範本
  → 輸入框上方出現範本卡（類似選技能後的樣式）
    ┌──────────────────────────────────────┐
    │ 📄 使用範本：採購合約範本  [✕ 取消]    │
    └──────────────────────────────────────┘
    [輸入框：描述你要填入的內容，或直接送出讓我引導你填寫...]
  → 送出後 AI 引導填值或從描述自動擷取 → 生成文件
```

**前端元件**:

```
components/templates/
├── TemplatePickerPopover.tsx      -- 工具列彈出的範本選擇器
│   ├── 搜尋框
│   ├── 最近使用（按 use_count 排序）
│   ├── 我的範本 / 公開範本 / 分享給我的
│   └── [管理範本 →] 連結到 /templates
└── TemplateAttachBadge.tsx        -- 選定後出現在輸入框上方的標記
```

**與聊天整合方式**:

選定範本後，前端在送出訊息時附帶 `template_id`，Server 端收到後：
1. 載入範本的 `schema_json`
2. 將 schema 注入 AI system prompt（告知 AI 需要擷取哪些變數）
3. AI 從使用者訊息擷取變數值，缺少的變數則追問
4. 變數齊全後自動呼叫 `generateDocument()`
5. 透過 SSE `generated_files` event 回傳

```js
// POST /api/chat/sessions/:id/messages
// body: { content: "...", template_id: "xxx" }  ← 新增欄位
```

### 7.3 入口三：側邊欄管理頁面（/templates）

完整的範本管理介面（即 §6 描述的 TemplatesPage），功能包含：

- 上傳新範本（上傳精靈 3 步驟）
- 瀏覽/搜尋/篩選範本庫
- 編輯範本設定與變數 schema
- 分享管理
- 生成紀錄查看
- 直接在管理頁面填值生成（不經過聊天）

側邊欄導航新增入口：

```
┌──────────────┐
│ 💬 聊天       │
│ 📋 排程任務   │
│ 🛠 技能市集   │
│ 📚 知識庫     │
│ 📄 文件範本   │  ← 新增
│ 📊 AI 戰情   │
│ ❓ 使用說明   │
└──────────────┘
```

### 7.4 三入口資料流整合圖

```
                    ┌──────────────────┐
                    │   doc_templates  │ (DB)
                    │   + schema_json  │
                    └───────┬──────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
     ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
     │  聊天 TAG    │ │ 工具列 Pick │ │ /templates  │
     │[DOC_TEMPLATE]│ │  Popover   │ │  管理頁面    │
     └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
            │               │               │
            │    template_id│               │
            ▼               ▼               │
     ┌──────────────────────────┐           │
     │     chat.js 訊息處理      │           │
     │  AI 擷取變數 → 生成文件   │           │
     └────────────┬─────────────┘           │
                  │                         │
                  ▼                         ▼
     ┌──────────────────────────────────────────┐
     │      docTemplateService.js               │
     │  generateDocument(template, variables)    │
     │  → docxtemplater / exceljs / pdf-lib     │
     └──────────────────┬───────────────────────┘
                        │
                        ▼
              ┌───────────────────┐
              │ doc_template_outputs │ (DB 紀錄)
              │ + 生成的檔案         │
              └───────────────────┘
```

---

## 8. Server 端關鍵服務

### 8.1 模組結構

```
server/
├── routes/
│   └── docTemplates.js             -- API 路由
├── services/
│   ├── docTemplateService.js       -- 核心業務邏輯
│   │   ├── analyzeDocument()       -- 呼叫 AI 分析變數
│   │   ├── createTemplate()        -- 建立範本（含 JSZip 替換 placeholder）
│   │   ├── generateDocument()      -- 從範本生成文件
│   │   └── detectPdfForm()         -- PDF 表單欄位偵測
│   └── (既有)
│       ├── fileGenerator.js        -- 已有的文件生成（可複用 Worker Thread 架構）
│       └── gemini.js               -- AI 服務（複用既有 LLM 呼叫）
└── uploads/
    └── templates/                  -- 範本檔案儲存目錄
        ├── {template_id}.docx      -- 含 {{placeholder}} 的範本檔
        ├── {template_id}_orig.docx -- 原始上傳檔
        └── {template_id}_preview.png -- 預覽縮圖
```

### 8.2 DOCX 變數替換流程（核心邏輯）

```js
// 建立範本時：將原文中的變數文字替換為 {{placeholder}}
async function injectPlaceholders(docxBuffer, variables) {
  const zip = new JSZip();
  await zip.loadAsync(docxBuffer);

  // word/document.xml 是主要內容
  let xml = await zip.file('word/document.xml').async('string');

  for (const v of variables) {
    // 處理 OOXML run-splitting:
    // "公司名稱" 可能被拆成 <w:r><w:t>公司</w:t></w:r><w:r><w:t>名稱</w:t></w:r>
    // 需要合併相鄰 run 再替換
    xml = mergeAndReplace(xml, v.original_text, `{{${v.key}}}`);
  }

  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// 生成文件時：docxtemplater 處理
async function generateFromDocx(templateBuffer, data) {
  const PizZip = require('pizzip');
  const Docxtemplater = require('docxtemplater');

  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,  // 支援 loop
    linebreaks: true,
  });

  doc.render(data);  // { company_name: "正崴", items: [{...}] }
  return doc.getZip().generate({ type: 'nodebuffer' });
}
```

### 8.3 AI 變數分析 Prompt 設計

```
你是一個文件範本分析器。以下是一份文件的內容：

---
{document_text}
---

請分析這份文件，找出所有「每次使用時可能需要更改的欄位」（變數），例如：
- 人名、公司名、日期、地址、金額
- 表格中重複的行（產品清單、品項明細等）
- 合約編號、文件編號等

請以 JSON 格式回傳：
{
  "variables": [
    {
      "key": "variable_name",       // 英文 snake_case
      "label": "顯示名稱",          // 中文
      "type": "text|number|date|select|loop",
      "required": true/false,
      "original_text": "原文中的對應文字",  // 用於定位替換位置
      "description": "說明",
      "children": []               // type=loop 時的子欄位
    }
  ],
  "confidence": 0.85,
  "notes": "分析備註"
}

規則：
1. key 必須是唯一的英文 snake_case
2. original_text 必須是文件中確實存在的完整文字
3. 重複結構（如表格行）用 type=loop，子欄位放 children
4. 固定不變的文字不要標為變數
```

---

## 9. OOXML Run-Splitting 處理策略

DOCX 最棘手的問題：Word 會將連續文字拆成多個 `<w:r>` run（因為拼字檢查、格式變化等）。

```xml
<!-- "合約編號" 可能被存成 -->
<w:r><w:rPr>...</w:rPr><w:t>合約</w:t></w:r>
<w:r><w:rPr>...</w:rPr><w:t>編號</w:t></w:r>
```

**處理方式**:

```
1. 解析 XML，找到所有 <w:p>（段落）
2. 對每個段落，合併所有 <w:r><w:t> 的文字為完整字串
3. 搜尋 original_text 在合併字串中的位置
4. 計算該位置橫跨哪些 run
5. 合併那些 run 為一個 run（保留第一個 run 的格式 <w:rPr>）
6. 將合併後的 run 的 <w:t> 替換為 {{placeholder}}
```

**已知限制**:
- 跨段落的變數無法自動處理（需人工在 Step 2 調整）
- 表格 cell 內的格式可能影響 run 邊界
- docxtemplater 本身也有 run-merge 機制，可與其配合

---

## 10. 套件需求

### 需新安裝

| 套件 | 用途 | 大小 |
|------|------|------|
| `docxtemplater` | DOCX 範本變數替換引擎 | ~200KB |
| `pizzip` | docxtemplater 的 ZIP 依賴 | ~80KB |
| `pdf-lib` | PDF 表單欄位偵測與填充 | ~1.2MB |

### 已安裝可直接用

| 套件 | 用途 |
|------|------|
| `mammoth` | DOCX → 純文字/HTML 擷取 |
| `jszip` | DOCX/PPTX ZIP 結構操作 |
| `exceljs` | XLSX 讀寫 |
| `pdfkit` | PDF 生成（Phase 2） |
| `pptxgenjs` | PPTX 生成（Phase 2） |
| `docx` | DOCX 從零生成（Phase 2 備用） |

---

## 11. 前端路由與導航

```tsx
// App.tsx 新增路由
<Route path="/templates" element={<ProtectedRoute><TemplatesPage /></ProtectedRoute>} />
<Route path="/templates/:id" element={<ProtectedRoute><TemplateDetailPage /></ProtectedRoute>} />
```

側邊欄新增入口 icon（FileTemplate / LayoutTemplate from lucide-react）。

---

## 12. 分享與複製機制

### 12.1 分享模型（與現有系統一致）

採用與 `ai_dashboard_shares`、`ai_saved_query_shares` 完全一致的 grantee 模型：

| 欄位 | 說明 |
|------|------|
| `share_type` | `use`（使用：可瀏覽、生成文件、fork 副本）/ `edit`（編輯：可修改範本設定與變數 schema） |
| `grantee_type` | `user` / `role` / `department` / `cost_center` / `division` / `org_group` |
| `grantee_id` | 對應的 ID（user_id / role_id / 部門代碼 / 利潤中心 / 事業處 / 事業群） |

**Upsert 邏輯**: 同一 `(template_id, grantee_type, grantee_id)` 組合重複分享時，更新 `share_type`，不產生重複紀錄（透過 UNIQUE constraint）。

### 12.2 權限層級與操作對照

| 操作 | creator/admin | share_type=edit | share_type=use | 無權限 |
|------|:---:|:---:|:---:|:---:|
| 瀏覽範本詳情 | ✅ | ✅ | ✅ | ❌ |
| 下載範本原始檔 | ✅ | ✅ | ✅ | ❌ |
| 下載含 placeholder 範本檔 | ✅ | ✅ | ❌ | ❌ |
| 使用範本生成文件 | ✅ | ✅ | ✅ | ❌ |
| 複製(fork)為自己的副本 | ✅ | ✅ | ✅ | ❌ |
| 修改名稱/描述/tags | ✅ | ✅ | ❌ | ❌ |
| 修改變數 schema | ✅ | ✅ | ❌ | ❌ |
| 管理分享設定 | ✅ | ❌ | ❌ | ❌ |
| 刪除範本 | ✅ | ❌ | ❌ | ❌ |
| 設定公開 (is_public) | ✅ (creator/admin) | ❌ | ❌ | ❌ |

**公開範本** (`is_public=1`): 所有登入使用者自動擁有 `use` 等級權限（可瀏覽、生成、fork）。
**公開不需 admin 審核**，creator 自行決定是否公開，但公開前需確認 alert（見 §12.7）。

### 12.3 存取權限檢查邏輯

```js
/**
 * 檢查使用者對範本的存取權限
 * @returns 'owner' | 'edit' | 'use' | null
 */
async function checkTemplateAccess(db, templateId, user) {
  // 1. admin 全權
  if (user.role === 'admin') return 'owner';

  const tpl = await db.prepare('SELECT creator_id, is_public FROM doc_templates WHERE id=?').get(templateId);
  if (!tpl) return null;

  // 2. creator 全權
  if (tpl.creator_id === user.id) return 'owner';

  // 3. 查詢分享表（匹配 user/role/department/cost_center/division/org_group）
  const shares = await db.prepare(`
    SELECT share_type FROM doc_template_shares
    WHERE template_id = ? AND (
      (grantee_type='user'        AND grantee_id=?) OR
      (grantee_type='role'        AND grantee_id=?) OR
      (grantee_type='department'  AND grantee_id=?) OR
      (grantee_type='cost_center' AND grantee_id=?) OR
      (grantee_type='division'    AND grantee_id=?) OR
      (grantee_type='org_group'   AND grantee_id=?)
    )
  `).all(
    templateId,
    String(user.id),
    user.role_id || '',
    user.department || '',
    user.profit_center || '',
    user.org_section || '',
    user.org_group || ''
  );

  // 取最高權限（edit > use）
  if (shares.some(s => s.share_type === 'edit')) return 'edit';
  if (shares.some(s => s.share_type === 'use'))  return 'use';

  // 4. 公開範本 = use
  if (tpl.is_public === 1) return 'use';

  return null;
}
```

### 12.4 複製(Fork)範本

使用者可將別人分享/公開的範本複製為自己的獨立副本，之後可自由修改。

**觸發條件**: 擁有 `use` 以上權限即可 fork。

**Fork 流程**:

```
POST /api/doc-templates/:id/fork
  → 檢查 use 權限
  → 複製 doc_templates row（新 id, creator_id = 當前使用者）
  → 複製範本檔案（template_file → uploads/templates/{new_id}.docx）
  → 複製原始檔案（original_file → uploads/templates/{new_id}_orig.docx）
  → 設定 forked_from = 原範本 id
  → 不複製分享設定（fork 出來的是私有的）
  → 回傳新範本
```

**Server 端 pseudo code**:

```js
router.post('/:id/fork', verifyToken, async (req, res) => {
  const access = await checkTemplateAccess(db, req.params.id, req.user);
  if (!access) return res.status(403).json({ error: '無權限' });

  const original = await db.prepare('SELECT * FROM doc_templates WHERE id=?').get(req.params.id);
  const newId = uuid();

  // 複製檔案
  const newTemplateFile = `templates/${newId}.${original.format}`;
  const newOriginalFile = `templates/${newId}_orig.${original.format}`;
  await fs.copyFile(path.join(UPLOAD_DIR, original.template_file), path.join(UPLOAD_DIR, newTemplateFile));
  await fs.copyFile(path.join(UPLOAD_DIR, original.original_file), path.join(UPLOAD_DIR, newOriginalFile));

  // 建立新範本
  await db.prepare(`
    INSERT INTO doc_templates
      (id, creator_id, name, description, format, strategy,
       template_file, original_file, schema_json, tags, forked_from)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newId, req.user.id,
    `${original.name}（副本）`,
    original.description,
    original.format, original.strategy,
    newTemplateFile, newOriginalFile,
    original.schema_json, original.tags,
    original.id   // forked_from
  );

  // 更新原範本 use_count（fork 也算一次使用）
  await db.prepare('UPDATE doc_templates SET use_count = use_count + 1 WHERE id=?').run(original.id);

  res.json(await db.prepare('SELECT * FROM doc_templates WHERE id=?').get(newId));
});
```

### 12.5 前端分享 UI

複用現有的 `ShareModal` 元件模式（與 AI 戰情的分享 Modal 一致）：

```
┌─ 範本分享設定 ────────────────────────────────┐
│                                                │
│  分享對象                                       │
│  ┌────────────────────────────────────────────┐│
│  │ 類型 ▼     │ 搜尋對象...              │ 權限 ▼ ││
│  │ [使用者  ] │ [王小明 (A1234)       ]  │ [使用] ││
│  │            │                         │        ││
│  │                              [+ 新增分享]    ││
│  └────────────────────────────────────────────┘│
│                                                │
│  目前分享                                       │
│  ┌────────────────────────────────────────────┐│
│  │ 👤 王小明 (A1234)     使用  [✕]             ││
│  │ 👥 角色：品管部        編輯  [✕]             ││
│  │ 🏢 部門：IT-001       使用  [✕]             ││
│  └────────────────────────────────────────────┘│
│                                                │
│  ☐ 公開範本（所有使用者可瀏覽、使用、複製）       │
│                                                │
│                              [關閉]             │
└────────────────────────────────────────────────┘
```

**Grantee type 選項與 icon**:

| grantee_type | 顯示名稱 | icon | 說明 |
|-------------|---------|------|------|
| user | 使用者 | 👤 | 指定個人 |
| role | 角色 | 👥 | 系統角色（roles 表） |
| department | 部門 | 🏢 | 部門代碼 |
| cost_center | 利潤中心 | 💰 | 利潤中心代碼 |
| division | 事業處 | 🏭 | 事業處代碼 |
| org_group | 事業群 | 🌐 | 事業群名稱 |

### 12.6 範本庫列表顯示

```
┌─ 文件範本庫 ──────────────────────────────────────┐
│ [🔍 搜尋...] [格式 ▼] [標籤 ▼] [排序 ▼]           │
│                                                    │
│ 📂 我的範本                                         │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│ │📄 採購合約 │ │📊 月報表  │ │📄 出貨單  │             │
│ │ 自己建立   │ │ 自己建立  │ │ fork自HR │             │
│ │ 用了 12 次 │ │ 用了 5 次 │ │ 用了 3 次│             │
│ │[生成][編輯]│ │[生成][編輯]│ │[生成][編輯]│            │
│ │[分享][刪除]│ │[分享][刪除]│ │[分享][刪除]│            │
│ └──────────┘ └──────────┘ └──────────┘             │
│                                                    │
│ 🌐 分享給我的                                       │
│ ┌──────────┐ ┌──────────┐                          │
│ │📄 請假單   │ │📄 會議記錄 │                          │
│ │ by HR     │ │ by 管理部 │                          │
│ │ 權限:使用  │ │ 權限:編輯  │                          │
│ │[生成][複製]│ │[生成][編輯]│                          │
│ └──────────┘ │ [複製]    │                          │
│              └──────────┘                          │
│                                                    │
│ 📢 公開範本                                         │
│ ┌──────────┐ ┌──────────┐                          │
│ │📄 標準報價 │ │📄 驗收單  │                          │
│ │ by 業務部 │ │ by 品管   │                          │
│ │[生成][複製]│ │[生成][複製]│                          │
│ └──────────┘ └──────────┘                          │
└────────────────────────────────────────────────────┘
```

**卡片按鈕邏輯**:

| 權限 | 生成 | 下載 | 編輯 | 分享 | 公開 | 複製(fork) | 刪除 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| owner | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| edit | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| use | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |

### 12.7 公開範本機制

**規則**: Creator 可自行公開/取消公開範本，**不需 admin 審核**。但公開前必須跳出 confirm alert，避免誤操作。

**前端 UX**:

```
用戶點擊「公開」toggle 或勾選「公開範本」
  ↓
┌─ 確認公開 ─────────────────────────────────────┐
│                                                 │
│  ⚠️ 確定要公開此範本嗎？                          │
│                                                 │
│  公開後，所有使用者都可以：                        │
│  • 瀏覽此範本的內容與變數設定                      │
│  • 使用此範本生成文件                             │
│  • 複製此範本為自己的副本                          │
│                                                 │
│  範本名稱：採購合約範本                            │
│  變數數量：5 個                                   │
│                                                 │
│               [取消]  [確認公開]                   │
└─────────────────────────────────────────────────┘
```

取消公開時同樣跳 confirm：

```
┌─ 確認取消公開 ──────────────────────────────────┐
│                                                 │
│  ⚠️ 確定要取消公開此範本嗎？                       │
│                                                 │
│  取消後，僅有被分享的使用者可以繼續使用。            │
│  已 fork 的副本不受影響。                          │
│                                                 │
│               [返回]  [確認取消公開]               │
└─────────────────────────────────────────────────┘
```

**前端實作（TemplateCard 內）**:

```tsx
const togglePublic = async () => {
  const isPublic = template.is_public === 1;
  const confirmed = window.confirm(
    isPublic
      ? '確定要取消公開此範本嗎？\n\n取消後，僅有被分享的使用者可以繼續使用。\n已 fork 的副本不受影響。'
      : '確定要公開此範本嗎？\n\n公開後，所有使用者都可以：\n• 瀏覽此範本的內容與變數設定\n• 使用此範本生成文件\n• 複製此範本為自己的副本'
  );
  if (!confirmed) return;

  await api.put(`/doc-templates/${template.id}`, {
    is_public: isPublic ? 0 : 1
  });
  // refresh
};
```

**API 端權限檢查**:

```js
// PUT /api/doc-templates/:id
// 只有 creator 或 admin 可切換 is_public
if (body.is_public !== undefined) {
  const access = await checkTemplateAccess(db, id, req.user);
  if (access !== 'owner') {
    return res.status(403).json({ error: '僅範本建立者可設定公開' });
  }
}
```

**分享 Modal 整合**: 在分享 Modal 底部的公開 checkbox 也套用同樣的 confirm 機制：

```
☐ 公開範本（所有使用者可瀏覽、使用、複製）
    ↑ 勾選時跳 confirm alert
```

---

## 13. 安全與權限

| 規則 | 說明 |
|------|------|
| 範本歸屬 | 只有 creator 或 admin 可刪除範本、管理分享設定 |
| 分享權限 | `use`：瀏覽、生成、fork；`edit`：加上修改範本設定與變數 schema |
| 複製權限 | 擁有 `use` 以上權限即可 fork，fork 後為獨立副本不受原範本影響 |
| 存取檢查 | 每次 API 呼叫檢查 `checkTemplateAccess()`，匹配 6 種 grantee_type |
| 公開範本 | creator 自行公開，不需 admin 審核，公開/取消公開前跳 confirm alert |
| 檔案大小 | 上傳限制 50MB（與現有一致） |
| 格式白名單 | 僅接受 `.docx`, `.xlsx`, `.pdf`（Phase 1） |
| 生成紀錄 | 所有生成操作記錄到 `doc_template_outputs`，供稽核 |
| 敏感內容 | 生成時的 input_data 經過既有敏感用語檢查 |

---

## 14. 與現有系統的整合點

| 整合 | 方式 |
|------|------|
| 使用者認證 | 複用 `verifyToken` middleware |
| AI 呼叫 | 複用 `gemini.js` 的 LLM 服務（變數分析用 Flash 模型，快且便宜） |
| 檔案儲存 | 存放於 `UPLOAD_DIR/templates/`，與既有 uploads 共用路徑 |
| 文件生成 | 可複用 `fileGenerator.js` 的 Worker Thread 架構 |
| 分享機制 | 複用 `ai_dashboard_shares` 相同的 grantee 模型 + 前端 `ShareModal` 元件 |
| Token 計量 | AI 分析時的 token 計入 `token_usage` |
| 稽核 | 生成操作記入 `audit_logs` |

---

## 15. 效能考量

| 項目 | 策略 |
|------|------|
| 大檔案上傳 | multer stream + 暫存目錄，分析完成前不寫入永久路徑 |
| AI 分析耗時 | SSE 串流回報進度（parsing → analyzing → done） |
| 範本生成 | Worker Thread 隔離（複用 fileGenerator 架構），避免阻塞主執行緒 |
| 預覽圖 | 非同步生成，不阻塞範本建立流程 |
| 範本列表查詢 | 加 index，支援分頁 + 篩選 |

---

## 16. 未來擴展方向（不在本次範圍）

- **批次生成**: 上傳 CSV/Excel 資料檔，一次生成多份文件（例：100 份個人化合約）
- **範本版本控制**: 修改歷史、版本 diff、回滾
- **WYSIWYG 編輯器**: 在瀏覽器中視覺化編輯範本（需 OOXML renderer，成本很高）
- **範本市集**: 公開範本庫、評分、分類瀏覽
- **AI 自動填值**: 結合聊天對話，AI 自動從對話上下文擷取變數值
- **審批流程**: 生成的文件需要主管審核後才能下載
