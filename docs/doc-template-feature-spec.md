# 文件範本功能規格書

**版本**：v1.2
**更新日期**：2026-03-27
**負責模組**：`server/services/docTemplateService.js`、`server/routes/docTemplates.js`、`client/src/components/templates/`

---

## 1. 功能概述

文件範本庫允許使用者上傳已設計好的 Word/Excel/PowerPoint/PDF 文件，系統自動識別文件中的變數欄位（佔位文字），建立可重複使用的「範本」。之後每次產生文件只需填入變數值，系統自動輸出格式完整的正式文件。

### 1.1 核心價值
- **重複使用**：一份範本可無限次生成不同內容的文件
- **格式保留**：DOCX/XLSX/PPTX 保留完整字型、色彩、表格框線；PDF 以疊加模式保留 Logo、印章
- **固定格式模式**：精確控制每格的字型大小、顏色、溢位策略，適合制式表單
- **內容模式**：每個欄位可設為「使用者填入」、「固定文字」或「清空保留格式」
- **OCR 支援**：掃描版圖片型 PDF 可用 Gemini Vision 自動識別欄位位置

---

## 2. 資料模型

### 2.1 `doc_templates` 資料表

| 欄位 | 型態 | 說明 |
|------|------|------|
| `id` | VARCHAR2(36) | UUID 主鍵 |
| `creator_id` | NUMBER | 建立者 user_id |
| `name` | VARCHAR2(255) | 範本名稱 |
| `description` | VARCHAR2(1000) | 描述 |
| `format` | VARCHAR2(10) | `docx` \| `xlsx` \| `pdf` \| `pptx` |
| `strategy` | VARCHAR2(20) | `native` \| `pdf_form` \| `ai_schema` |
| `template_file` | VARCHAR2(500) | 注入佔位符後的範本檔路徑（相對 UPLOAD_DIR） |
| `original_file` | VARCHAR2(500) | 使用者上傳的原始檔路徑 |
| `schema_json` | CLOB | 變數 Schema（JSON，見 §2.2） |
| `tags` | VARCHAR2(500) | JSON 字串陣列 |
| `is_public` | NUMBER(1) | 0=私有, 1=全員公開 |
| `is_fixed_format` | NUMBER(1) | 0=標準, 1=固定格式模式 |
| `use_count` | NUMBER | 生成次數計數 |
| `forked_from` | VARCHAR2(36) | 若為複製，指向來源範本 id |
| `created_at` | TIMESTAMP | 建立時間 |
| `updated_at` | TIMESTAMP | 最後更新時間 |

### 2.2 `schema_json` 結構

```json
{
  "variables": [TemplateVariable],
  "confidence": 0.92,
  "notes": "AI 備註",
  "strategy": "native|pdf_form|ai_schema",
  "extracted_at": "2026-03-27T00:00:00.000Z",
  "is_ocr": true
}
```

### 2.3 `TemplateVariable` 型別

```typescript
interface TemplateVariable {
  // 基本欄位
  key: string                    // snake_case 唯一識別碼
  label: string                  // 中文顯示名稱
  type: 'text' | 'number' | 'date' | 'select' | 'loop'
  required: boolean
  content_mode?: 'variable' | 'static' | 'empty'  // 預設 'variable'

  // 輔助資訊
  original_text?: string         // 文件中的原始佔位文字
  description?: string
  default_value?: string         // 預設值；static 模式時即固定文字
  placeholder?: string
  options?: string[] | null      // select 類型的選項清單
  children?: TemplateVariable[]  // loop 類型的子欄位

  // 固定格式模式
  style?: {
    detected?: VariableStyleProps   // 從原始範本自動偵測
    override?: VariableStyleProps   // 使用者手動覆寫
  }
  docx_style?: {
    rowHeightPt?: number            // loop 列高（pt），僅 DOCX
    noWrap?: boolean
  }
  pdf_cell?: {                      // PDF 版面編輯器座標（頂左原點，pt）
    page: number                    // 0-based 頁碼
    x: number
    y: number
    width: number
    height: number
  }
}

interface VariableStyleProps {
  fontSize?: number       // pt
  bold?: boolean
  italic?: boolean
  color?: string          // hex e.g. '#CC0000'
  overflow?: 'wrap' | 'truncate' | 'shrink' | 'summarize'
  maxChars?: number
}
```

### 2.4 `doc_template_shares` 資料表

| 欄位 | 說明 |
|------|------|
| `template_id` | 外鍵 → doc_templates.id |
| `share_type` | `use`（使用）或 `edit`（編輯） |
| `grantee_type` | `user` \| `role` \| `department` \| `cost_center` \| `division` \| `org_group` |
| `grantee_id` | 對應 grantee_type 的 ID 字串 |

UNIQUE 約束：`(template_id, grantee_type, grantee_id)`

### 2.5 `doc_template_outputs` 資料表

每次生成文件的記錄，包含 `template_id`、`user_id`、`input_data`（JSON）、`output_file`（下載路徑）、`created_at`。

---

## 3. 上傳與分析流程

### 3.1 上傳 SSE 串流（`POST /api/doc-templates/upload`）

```
Client ──[multipart/form-data file]──▶ Server
Server ──[SSE]──▶ Client

事件順序：
  event: status  { step: 'parsing',  message: '擷取文件內容中...' }
  event: status  { step: 'ocr',      message: '偵測到掃描式 PDF，使用 Gemini Vision OCR...' }  ← 僅掃描 PDF
  event: status  { step: 'analyzing', message: 'AI 分析變數中...' }
  event: result  { schema, temp_file, format, original_name }
  event: done    {}
  --- OR ---
  event: error   { message: '...' }
```

### 3.2 分析策略判斷

```
上傳 PDF?
  ├─ 有 AcroForm 欄位?  →  strategy='pdf_form'，直接列出欄位名稱
  ├─ pdf-parse 文字 < 50 非空白字元?  →  「掃描 PDF」→ ocrPdfFields() → strategy='ai_schema', is_ocr=true
  └─ 有文字 → analyzeVariables(text) → strategy='ai_schema'

上傳 DOCX/XLSX/PPTX?
  └─ extractText() → analyzeVariables(text) → strategy='native'
```

### 3.3 AI 變數識別 Prompt 重點

使用 Gemini Flash，要求回傳 JSON（不包 markdown fence）：
- `key`：英文 snake_case 唯一識別碼
- `original_text`：文件中確實存在的對應文字
- `type`：`text | number | date | select | loop`
- `loop` 類型的子欄位放 `children[]`

---

## 4. 建立範本（`createTemplate`）

1. 複製上傳的暫存檔為 `original_file`
2. 根據格式注入佔位符：
   - DOCX：run-merge 演算法，`original_text → {{key}}`，重建為單一 run
   - XLSX：ExcelJS 逐格替換
   - PDF/PPTX：不注入，template_file = original_file
3. 自動偵測樣式（Style Detection）：
   - DOCX：找 label-value 對應表格列，讀取 value cell 的 `<w:rPr>`
   - XLSX：找 label 旁的 value cell，讀取 ExcelJS `cell.font`
   - PPTX：找含 `original_text` 的 `<a:p>`，讀取 `<a:rPr>` 屬性
4. 將偵測到的樣式寫入 `variable.style.detected`
5. 存入 `doc_templates` 資料表

---

## 5. 格式支援細節

### 5.1 DOCX（docx + Word XML）

- 生成使用原始檔（`original_file`），非注入佔位符的 template_file，避免 docxtemplater 的 split-run 問題
- 替換優先順序：
  1. **Label-based**（主策略）：找 `<w:tr>` 第一格符合 `v.label`，替換第二格
  2. **Content-based**（次策略）：找含 `original_text` 的 `<w:tc>` 直接替換
  3. **Paragraph-level**（最後手段）：在 `<w:p>` 層級做 run-merge 替換
- Loop 類型：找含所有 children.original_text 的 `<w:tr>` 作為模板列，複製 N 次
- 固定格式模式：
  - 每格替換時套用 `buildStyledRPr()` 合併 fontSize/bold/italic/color
  - Loop 列高：在 `<w:trPr>` 注入 `<w:trHeight w:val="${twips}" w:hRule="exact"/>`
- 移除 `<w:tblHeader/>` 防止表頭在每頁重複

### 5.2 XLSX（ExcelJS）

- 逐格比對 `original_text`，保留 ExcelJS `cell.style`
- Loop：找 header row（含 children.label），從 header 下一行逐行寫入 item 值
- 固定格式模式：套用 fontSize/bold/italic/color 至 ExcelJS `cell.font`

### 5.3 PPTX（JSZip + DrawingML XML）

- 逐 slide XML 做 run-merge 替換（`<a:r>` 內的 `<a:t>`）
- 保留第一個 run 的 `<a:rPr>` 格式

### 5.4 PDF — AcroForm 表單（`strategy='pdf_form'`）

- pdf-lib 直接讀取 `AcroForm` 欄位
- 生成時用 pdf-lib `form.getTextField(key).setText(value)`

### 5.5 PDF — 固定格式疊加（`pdf_overlay`）

觸發條件：`is_fixed_format=1` 且至少一個 variable 有 `pdf_cell`

1. pdf-lib 載入原始 PDF（保留 Logo/框線/印章）
2. fontkit 注入 CJK 字型（`server/fonts/NotoSansTC-Regular.ttf`）
3. 對每個有 `pdf_cell` 的變數：
   - 座標轉換：`cellBottom = pageH − cell.y − cell.height`（頂左→底左）
   - **empty 模式**：`page.drawRectangle({ color: rgb(1,1,1) })` 白色覆蓋
   - **其他模式**：`pushGraphicsState → clip → drawText → popGraphicsState`
   - shrink 策略：縮減 fontSize 直到文字寬度 ≤ cell.width
4. 未定位欄位：`console.warn` 跳過，不中斷生成

### 5.6 PDF — 非固定格式重建（`pdf_regen`，pdfkit）

觸發條件：PDF 非 AcroForm 且 is_fixed_format=0 或無 pdf_cell

- 從原始 PDF 萃取第一張 JPEG 圖片作為 Logo
- pdfkit 重建 A4 文件：Logo → 逐行 label:value 表格（動態列高）
- 每列高度由 `doc.heightOfString()` 動態計算，支援長文自動換行

---

## 6. 固定格式模式（Fixed Format Mode）

### 6.1 啟用方式
- 上傳精靈 Step 3：開啟「固定格式模式」開關
- 範本編輯視窗標題列：切換開關
- OCR 掃描式 PDF 上傳時：**自動啟用**

### 6.2 樣式優先順序

```
override（使用者設定）> detected（自動偵測）> 系統預設值
```

`getEffectiveStyle(variable)` 函式：
```javascript
const merged = { overflow: 'wrap', ...detected, ...override }
```

### 6.3 Style Detection 對應表

| 格式 | 偵測來源 | 對應欄位 |
|------|----------|----------|
| DOCX | value cell `<w:rPr>` | `w:sz`÷2=pt, `w:b`, `w:i`, `w:color` |
| XLSX | ExcelJS `cell.font` | `size`, `bold`, `italic`, `color.argb`（去 alpha） |
| PPTX | `<a:rPr>` 屬性 | `sz`÷100=pt, `b`, `i`, `<a:solidFill>` hex |

---

## 7. 內容模式（Content Mode）

每個變數的 `content_mode` 欄位控制生成時如何取值：

| 模式 | 值 | 行為 | 使用場景 |
|------|----|------|----------|
| **變數**（預設） | `variable` | 從使用者填入的 `inputData[key]` 取值 | 所有需要使用者填寫的欄位 |
| **靜態** | `static` | 始終使用 `default_value`，不詢問使用者 | 固定的範本標題、公司名稱 |
| **清空** | `empty` | 始終為空字串；PDF overlay 畫白色矩形覆蓋原文 | 清除原始 PDF 的填寫範例文字 |

### 7.1 前端行為
- **VariableSchemaEditor**：每個非 loop 變數顯示 V / T / ∅ 三按鈕切換
  - static 模式：`default_value` 欄位 placeholder 改為「固定文字內容」
  - empty 模式：隱藏 `default_value` 輸入欄
- **TemplateGenerateModal**：只顯示 `variable` 模式的欄位；static/empty 在 submit 前自動預填

### 7.2 後端 `resolveValue(variable, inputData)`

```javascript
function resolveValue(v, inputData) {
  const mode = v.content_mode || 'variable';
  if (mode === 'static') return String(v.default_value ?? '');
  if (mode === 'empty')  return '';
  const raw = inputData[v.key];
  return raw !== undefined ? String(raw) : String(v.default_value ?? '');
}
```

呼叫位置：DOCX / XLSX / PPTX / PDF 各格式的 variable 值解析。

---

## 8. PDF 版面編輯器（Visual Editor）

### 8.1 前端元件：`PDFFieldEditor.tsx`

**技術棧**：pdfjs-dist v5（動態 import）+ HTML5 Canvas + SVG overlay

**座標系統**：
- 儲存：頂左原點（`pdf_cell.y` 從頁面頂部往下量）
- 顯示：canvas 座標（像素）
- pdf-lib 生成時轉換：`pdfY_bottom_left = pageH − cell.y − cell.height`

**操作流程**：
1. 從 `GET /api/doc-templates/:id/preview-file` 取得原始 PDF
2. pdfjs-dist 渲染到 `<canvas>`
3. SVG overlay 顯示已定位欄位（藍色半透明矩形）
4. 選取「選擇變數」下拉後在 canvas 上拖拉畫框 → 計算座標 → 更新 `v.pdf_cell`
5. 點選矩形選取 → 右側面板顯示詳細資訊 + 樣式設定
6. Delete 鍵或刪除按鈕清除定位

**canvasToPdf 轉換**：
```typescript
const scaleX = pdfPage.width  / canvas.width   // canvas px → PDF pt
const scaleY = pdfPage.height / canvas.height
pdf_cell = {
  page: currentPage,
  x: Math.round(rect.x * scaleX),
  y: Math.round(rect.y * scaleY),
  width:  Math.round(rect.width  * scaleX),
  height: Math.round(rect.height * scaleY),
}
```

### 8.2 OCR 重新掃描

版面編輯器頁籤右上角「OCR 重新掃描」紫色按鈕：
- 呼叫 `POST /api/doc-templates/:id/ocr-scan`
- 回傳帶 `pdf_cell` 的新 schema → 合併更新現有 variables 的座標
- 新偵測到但不在現有 schema 的欄位自動追加

---

## 9. OCR 掃描式 PDF（`ocrPdfFields`）

### 9.1 觸發時機

| 場景 | 觸發條件 |
|------|----------|
| 上傳時自動觸發 | PDF 且 pdf-parse 萃取的非空白字元 < 50 |
| 手動觸發 | 版面編輯器「OCR 重新掃描」→ `POST /:id/ocr-scan` |

### 9.2 實作流程（`ocrPdfFields(pdfBuf, model?)`）

1. 使用 pdf-lib 讀取實際頁面尺寸（fallback A4：595×842 pt）
2. 將 PDF buffer 轉 base64
3. 呼叫 Gemini Pro Vision，以 `inlineData`（`application/pdf`）傳送 PDF
4. Prompt 要求回傳帶 `pdf_cell`（pt 座標，頂左原點）的 JSON schema
5. 解析回應，fallback 空 schema（不中斷流程）

### 9.3 使用模型

- 預設：`MODEL_PRO`（Gemini 3 Pro Preview）
- 可透過 `system_settings.template_analysis_model='pro'` 控制
- Flash 模型準確度較低，不建議用於 OCR

### 9.4 座標品質

- Gemini 回傳的座標為估算值，誤差約 5-15 pt
- 建議上傳後在版面編輯器人工微調
- 多欄位 PDF 表單準確度較高（~85%）；複雜版面（圖文混排）準確度較低（~60%）

---

## 10. 溢位策略（Overflow）

| 策略 | 觸發條件 | 行為 | 適用格式 |
|------|----------|------|----------|
| `wrap`（預設） | 永遠 | 內容換行，格高隨內容增長 | DOCX/XLSX/PDF regen |
| `truncate` | `value.length > maxChars` | 截斷 + `…` | 全格式 |
| `shrink` | PDF overlay，文字超寬 | 縮小 fontSize 直到 width 符合 | PDF overlay |
| `summarize` | `value.length > maxChars` | 呼叫 Gemini Flash 壓縮 → fallback truncate | 全格式 |

### 10.1 AI 摘要（`summarizeText`）

- 語言自動偵測：CJK 字元比例 > 30% → 繁體中文，否則 English
- Prompt：`請用{lang}將以下文字壓縮至{maxChars}字以內`
- 失敗時 fallback truncate，不中斷生成

---

## 11. 存取控制

### 11.1 Access Level

| 等級 | 誰 | 可做 |
|------|----|------|
| `owner` | 建立者 / admin | 全部操作（含刪除、分享） |
| `edit` | 被分享且 share_type='edit' | 修改 schema、名稱、描述、標籤 |
| `use` | 被分享 use / 公開 / admin | 生成文件、下載原始檔、Fork |
| `null` | 其他 | 無法存取（403） |

---

## 12. API 端點一覽

| 方法 | 路徑 | 說明 | 最低權限 |
|------|------|------|----------|
| GET | `/api/doc-templates` | 列出（支援 search/format/tag） | 登入 |
| POST | `/api/doc-templates/upload` | SSE 串流分析上傳檔案 | 登入 |
| POST | `/api/doc-templates` | 建立範本 | 登入 |
| GET | `/api/doc-templates/:id` | 取得範本詳情 | use+ |
| GET | `/api/doc-templates/:id/preview-file` | 取得原始檔（PDF 版面編輯器用） | use+ |
| PUT | `/api/doc-templates/:id` | 更新名稱/描述/schema/is_fixed_format/is_public | edit+ |
| DELETE | `/api/doc-templates/:id` | 刪除範本及所有檔案 | owner |
| GET | `/api/doc-templates/:id/download` | 下載原始或佔位符版本（`?type=template`） | use+ |
| POST | `/api/doc-templates/:id/generate` | 生成文件 | use+ |
| GET | `/api/doc-templates/:id/outputs` | 查詢生成歷史 | use+ |
| POST | `/api/doc-templates/:id/fork` | 複製給當前使用者 | use+ |
| POST | `/api/doc-templates/:id/ocr-scan` | 重新 OCR 掃描 PDF，更新 pdf_cell 座標 | edit+ |
| GET | `/api/doc-templates/:id/shares` | 列出分享設定 | owner |
| POST | `/api/doc-templates/:id/shares` | 新增分享 | owner |
| DELETE | `/api/doc-templates/:id/shares/:shareId` | 移除分享 | owner |

---

## 13. 前端元件架構

```
client/src/
├── types.ts                              # TemplateVariable, DocTemplate, content_mode
├── pages/
│   └── TemplatesPage.tsx                 # 範本清單頁 + TemplateEditModal
│       ├── TemplateEditModal             # 編輯視窗：basic/variables/style/layout 頁籤
│       └── OcrScanButton                 # OCR 重新掃描按鈕
└── components/templates/
    ├── TemplateCard.tsx                  # 範本卡片（生成/下載/編輯/分享/複製/刪除）
    ├── TemplateUploadWizard.tsx          # 三步驟上傳精靈（上傳→確認變數→儲存設定）
    ├── TemplateGenerateModal.tsx         # 填入變數生成文件
    ├── VariableSchemaEditor.tsx          # 變數 Schema 編輯（含 content_mode V/T/∅）
    ├── StyleEditorTab.tsx                # 樣式設定（字型/顏色/溢位）
    ├── PDFFieldEditor.tsx                # PDF 版面編輯器（pdfjs-dist + SVG overlay）
    ├── TemplateShareModal.tsx            # 分享設定
    └── TemplatePickerPopover.tsx         # 對話框選擇範本按鈕
```

---

## 14. 檔案儲存路徑

| 類型 | 路徑（相對 UPLOAD_DIR） | 說明 |
|------|------------------------|------|
| 上傳暫存 | `tmp/<uuid>_<timestamp>` | 上傳後 30 分鐘自動清除 |
| 原始檔 | `templates/<id>_orig.<ext>` | 使用者上傳的原始文件 |
| 注入佔位符版 | `templates/<id>.<ext>` | DOCX/XLSX：已注入 `{{key}}`；PDF/PPTX = 同原始檔 |
| 生成輸出 | `generated/<uuid>.<ext>` | 每次 generate 的輸出，不自動清除 |

---

## 15. 已知限制與未來規劃

| 項目 | 現狀 | 備註 |
|------|------|------|
| PDF AcroForm 加密 | pdf-lib 可讀取大多數加密（ignoreEncryption=true） | 強加密須先解鎖 |
| PDF regen 字型 | 需 `server/fonts/NotoSansTC-Regular.ttf` | 未部署此字型中文顯示為亂碼 |
| OCR 座標精度 | 估算值，需人工微調約 5-15 pt | 複雜版面誤差更大 |
| PPTX loop | 尚未支援 | 暫時以靜態替換處理 |
| DOCX 跨格合併儲存格 | 可能影響 label-based 偵測 | 建議範本避免使用跨格 |
| PDF 彩色背景 empty 模式 | 白色矩形覆蓋可能露白邊 | 非白底文件需注意 |
