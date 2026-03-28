# 文件範本功能規格書

**版本**：v2.1
**更新日期**：2026-03-29
**負責模組**：`server/services/docTemplateService.js`、`server/services/pipelineAgents.js`、`server/routes/docTemplates.js`、`client/src/components/templates/`

---

## 1. 功能概述

文件範本庫允許使用者上傳已設計好的 Word/Excel/PowerPoint/PDF 文件，系統自動識別文件中的變數欄位（佔位文字），建立可重複使用的「範本」。之後每次產生文件只需填入變數值，系統自動輸出格式完整的正式文件。

### 1.1 核心價值
- **重複使用**：一份範本可無限次生成不同內容的文件
- **格式保留**：DOCX/XLSX/PPTX 保留完整字型、色彩、表格框線；PDF 以疊加模式保留 Logo、印章
- **固定格式模式**：精確控制每格的字型大小、顏色、溢位策略，適合制式表單
- **內容模式**：每個欄位可設為「使用者填入」、「固定文字」或「清空保留格式」
- **OCR 支援**：掃描版圖片型 PDF 可用 Gemini Vision 自動識別欄位位置
- **Chat 整合**：對話中選擇範本，AI 自動填入值並生成文件（`[使用範本:UUID:名稱:格式]`）

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
  "extracted_at": "2026-03-28T00:00:00.000Z",
  "is_ocr": true,

  "pptx_settings": {
    "slide_config": [
      { "index": 0, "type": "cover" },
      { "index": 1, "type": "layout_template", "layout": "bullets" },
      { "index": 2, "type": "layout_template", "layout": "3col" },
      { "index": 3, "type": "closing" }
    ],
    "content_array_var": "slides",
    "layout_field": "type"
  }
}
```

> `pptx_settings` 僅 PPTX 範本且使用多版型系統時存在（見 §5.3）。

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
  bgColor?: string        // hex e.g. '#FFFF00' (cell background)
  overflow?: 'wrap' | 'truncate' | 'shrink' | 'summarize'
  maxChars?: number
  lineSpacing?: number    // 行距倍率：1.0, 1.15, 1.5, 2.0, 2.5, 3.0
  bullet?: string         // 列標符號：'•', '✓', '■', '○', '▸', '–', '★', '➤' 或 'none'
}
```

### 2.4 PPTX 多版型 loop 變數範例

PPTX 多版型範本的 `variables` 結構固定如下：

```json
[
  { "key": "cover_title",     "type": "text", "label": "標題" },
  { "key": "cover_presenter", "type": "text", "label": "報告人" },
  { "key": "cover_date",      "type": "date", "label": "日期" },
  {
    "key": "slides",
    "type": "loop",
    "label": "投影片內容",
    "children": [
      { "key": "type",          "type": "select", "options": ["bullets","3col"], "required": true },
      { "key": "slide_title",   "type": "text",   "required": true },
      { "key": "slide_content", "type": "text",   "description": "子彈重點，\\n 分隔" },
      { "key": "col1_title",    "type": "text" },
      { "key": "col1_content",  "type": "text" },
      { "key": "col2_title",    "type": "text" },
      { "key": "col2_content",  "type": "text" },
      { "key": "col3_title",    "type": "text" },
      { "key": "col3_content",  "type": "text" }
    ]
  }
]
```

### 2.5 `doc_template_shares` 資料表

| 欄位 | 說明 |
|------|------|
| `template_id` | 外鍵 → doc_templates.id |
| `share_type` | `use`（使用）或 `edit`（編輯） |
| `grantee_type` | `user` \| `role` \| `department` \| `cost_center` \| `division` \| `org_group` |
| `grantee_id` | 對應 grantee_type 的 ID 字串 |

UNIQUE 約束：`(template_id, grantee_type, grantee_id)`

### 2.6 `doc_template_outputs` 資料表

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

上傳 DOCX/XLSX?
  └─ extractText() → analyzeVariables(text) → strategy='native'

上傳 PPTX?  ← 2026-03-28 更新：使用智慧多版型分析，非通用 AI 分析
  └─ _analyzePptxDocument() →
       _getPptxSlideInfos()       讀取每張投影片結構（佔位符類型、形狀位置）
       _classifyPptxSlides()      自動分類：cover / bullets / 3col / closing
       analyzeVariables(coverSlide.text)  僅分析封面變數
       → 回傳 schema + pptx_settings.slide_config
       → strategy='native'
```

### 3.3 PPTX 投影片自動分類規則

| 位置 | 欄數偵測 | 分類結果 |
|------|----------|----------|
| 第 1 張 | 任意 | `cover` |
| 最後 1 張（共 3 張以上） | 任意 | `closing` |
| 中間任意 | ≥ 3 欄（`_detectColumnCount` 非 title 形狀） | `3col` |
| 中間任意 | < 3 欄 | `bullets` |

欄數偵測方法：以 Y-band（高度 25%）分組所有非 aux、非 title 形狀，找出同一 Y-band 內最多形狀數。

### 3.4 AI 變數識別 Prompt 重點（DOCX/XLSX/PDF）

使用 Gemini Flash，要求回傳 JSON（不包 markdown fence）：
- `key`：英文 snake_case 唯一識別碼
- `original_text`：文件中確實存在的對應文字
- `type`：`text | number | date | select | loop`
- `loop` 類型的子欄位放 `children[]`

---

## 4. 建立範本（`createTemplate`）

### 4.1 DOCX / XLSX

1. 複製暫存檔為 `original_file`
2. 注入佔位符：
   - DOCX：run-merge 演算法，`original_text → {{key}}`，重建為單一 run
   - XLSX：ExcelJS 逐格替換
3. 自動偵測樣式（Style Detection）
4. 存入 DB

### 4.2 PPTX（2026-03-28 更新）

兩路徑依 `pptx_settings.slide_config` 是否含 `layout_template` 決定：

**路徑 A：多版型模式（有 `layout_template`）**

```
injectPptxPlaceholders(origBuf, coverVars)
  └─ 僅替換封面/簡單變數的 original_text → {{cover_key}}

_getPptxSlideInfos(workBuf) → _classifyPptxSlides()
  └─ 取得每張投影片的分類和 XML

_injectLayoutPlaceholders(workBuf, classifiedSlides)
  └─ bullets slides → _injectBulletsLayoutPlaceholders()
  │     title shape  → {{slide_title}}
  │     body shape   → {{slide_content}}
  └─ 3col slides → _inject3ColLayoutPlaceholders()
        title       → {{slide_title}}
        col1 header → {{col1_title}}, col1 body → {{col1_content}}
        col2/col3 同上
```

形狀偵測策略：
- Title：優先找 `<p:ph type="title"/>` 或 `<p:ph type="ctrTitle"/>`，fallback 最頂端形狀
- Body：優先找 `<p:ph type="body"/>`，fallback 最大面積非 title 形狀
- 3col 欄位：以 X 位置三等分（SLIDE_W = 9,144,000 EMU），同欄取最頂/最大形狀

**路徑 B：簡單模式（無 `layout_template`，向下兼容）**

```
injectPptxPlaceholders(origBuf, variables)
  └─ 對所有 slide 做 run-merge 替換 original_text → {{key}}
```

### 4.3 PDF

- `pdf_form`：template_file = original_file（pdf-lib 直接填 AcroForm）
- `ai_schema`：template_file = original_file（生成時覆蓋疊加）

### 4.4 樣式自動偵測

1. 存入 template 後，對 DOCX/XLSX/PPTX 執行 Style Detection
2. 結果寫入 `variable.style.detected`
3. 失敗為 non-fatal（warn log，不中斷）

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

### 5.3 PPTX（JSZip + DrawingML XML）— 2026-03-28 全面更新

#### 生成路徑選擇

```
schema.pptx_settings?.slide_config 含 layout_template?
  ├─ 是 → _generateLayoutPptx()   多版型展開路徑（新）
  └─ 否 →
       含 content_repeat?
         ├─ 是 → content_repeat 展開路徑（舊，向下兼容）
         └─ 否 → 簡單替換路徑（舊，向下兼容）
```

#### 多版型展開路徑（`_generateLayoutPptx`）

```
1. 過濾 Google Search grounding 參考文獻 slides
   （slide_title 含「參考來源/文獻/References」且 content 含 URL）
2. 解析 slide_content 變數的 style.override → contentStyleOpts
3. 預載入所有 layout_template slides 的 XML（依 layout 名稱 key）
4. 逐張處理模板投影片：
   - cover / closing / 無 cfg → _replacePptxPlaceholders(xml, varMap) 簡單替換
   - layout_template（第一次遇到）→ 展開 slides[] 陣列：
       foreach item in slidesData:
         layout = item.type (bullets|3col)
         template = layoutTemplates[layout] || fallback
         xml = _fillLayoutSlide(template.xml, item, layout, contentStyleOpts)
         xml = _replacePptxPlaceholders(xml, varMap)  // 套用封面變數
   - layout_template（後續重複） → 跳過（已預載為 template）
5. _rebuildPptxSlides(zip, outputSlides) 重建 presentation.xml + rels
```

#### `_fillLayoutSlide` 填充規則

接收 `contentStyleOpts = { fontSizeOverride, lineSpacing, bullet }` 參數，從 `slide_content` 變數的 `style.override` 解析。

| 版型 | 欄位處理 |
|------|---------|
| `bullets` | `slide_title` → 簡單替換；`slide_content` → `_expandPptxBullets(bulletStyle)` 展開 |
| `3col` | `slide_title`、`col*_title` → 簡單替換；`col*_content` → `_expandPptxBullets(bulletStyle)` 展開 |

填充後呼叫 `_repositionContentShape(xml, fontSizeOverride)`：
- `fontSizeOverride` 為 `undefined` 時不修改字型（保留範本原始大小）
- 有值時覆寫所有 `<a:rPr>` 的 `sz` 屬性（pt × 100 = OOXML hundredths）

#### `_expandPptxBullets` 子彈展開演算法

```
1. 找到 txBody 中含 {{placeholderKey}} 的 <a:p>（模板段落）
2. 提取模板段落的 <a:pPr>（段落格式，含子彈符號）和 <a:rPr>（字型）
3. 套用 bulletStyle 覆寫（若有 override）：
   - lineSpacing → 注入 <a:lnSpc><a:spcPct val="150000"/></a:lnSpc> 到 <a:pPr>
   - bullet → 移除既有 buChar/buNone/buAutoNum，注入 <a:buFont>+<a:buChar char="✓"/>
     或 <a:buNone/>（bullet='none' 時）
4. 將 content 以 \n 分割為 lines[]
5. 每 line 去除前置符號（•·✓■○▸–★➤-*），克隆模板段落結構，填入文字
6. 以展開的 <a:p>[] 取代原始單一段落
7. 保留模板段落前後的其他 <a:p>（beforeParas, afterParas）
```

#### 舊版 `content_repeat` 路徑（向下兼容）

依 `slide_config[].type === 'content_repeat'` 標記的 slide，對 `inputData[loop_var][]` 逐項複製，每份替換子欄位 `{{child.key}}`。

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

### 6.3 PPTX 行距與列標設定

`StyleEditorTab` 為 `slide_content` 等變數提供行距和列標控制，儲存於 `style.override`：

| 設定 | 欄位 | OOXML 對應 | 說明 |
|------|------|-----------|------|
| 行距 | `lineSpacing` | `<a:lnSpc><a:spcPct val="150000"/></a:lnSpc>` | 1.0=單行，1.5=1.5倍，2.0=雙行 |
| 列標 | `bullet` | `<a:buFont>+<a:buChar char="✓"/>` | 可選：• ✓ ■ ○ ▸ – ★ ➤ 或 none（無符號） |

- 僅 `style.override` 有值時套用，`undefined` = 保留範本原始設定
- 字型大小同理：`fontSizeOverride` 有值時覆寫 `<a:rPr sz>`，否則保留範本

### 6.4 Style Detection 對應表

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
    ├── StyleEditorTab.tsx                # 樣式設定（字型/顏色/溢位/行距/列標）
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
| 注入佔位符版 | `templates/<id>.<ext>` | DOCX/XLSX/PPTX：已注入 `{{key}}`；PDF = 同原始檔 |
| 生成輸出 | `generated/<uuid>.<ext>` | 每次 generate 的輸出，不自動清除 |

---

## 15. Chat 模式整合

### 15.1 範本啟動語法

使用者在對話框選擇範本後，前端自動在訊息前加上標籤：

```
[使用範本:UUID:範本名稱:outputFormat] 使用者訊息內容
```

`chat.js` 解析標籤，載入 `schema_json`，觸發範本模式。

### 15.2 AI 輸出格式要求

Chat 模式下 AI 必須在回覆結尾輸出：

````
```template_values
{ "key1": "value1", "_ai_filename": "報告主題名稱", "slides": [...] }
```
````

**`_ai_filename`（必填）**：AI 依報告內容產生的簡短中文檔名（5-15 字），不含日期和副檔名。系統自動：
1. 以 `_ai_filename` 作為**封面主標題**（覆寫 `cover_*` 中字型最大的變數）
2. 以 `_ai_filename + _YYYYMMDD.ext` 作為**下載檔名**

PPTX 多版型範本的 `template_values` 範例：

```json
{
  "_ai_filename": "2026Q1業績分析報告",
  "cover_title": "2026Q1業績分析報告",
  "cover_date": "2026-03-31",
  "cover_presenter": "業務部",
  "slides": [
    {
      "type": "bullets",
      "slide_title": "本季亮點",
      "slide_content": "營收成長 15%\n新客戶 23 家\n滿意度評分 4.8"
    },
    {
      "type": "3col",
      "slide_title": "三大策略比較",
      "col1_title": "品質",   "col1_content": "ISO 認證\n零缺陷目標",
      "col2_title": "效率",   "col2_content": "流程精簡\n自動化導入",
      "col3_title": "創新",   "col3_content": "研發投入\n新品開發"
    }
  ]
}
```

### 15.3 強制指令注入

當 `docTemplateId` 存在時，`chat.js` 在 `userParts` 中注入強制覆蓋指令：
- 禁止輸出任何 `generate_xxx` 代碼塊
- 要求輸出 `template_values` 代碼塊（含 `_ai_filename`）
- PPTX 版型注入多版型格式規則（slides 陣列、`\n` 分隔子彈點、最多 6 條）

### 15.4 AI 檔名與封面標題自動處理（`chat.js`）

```
解析 template_values 後：
1. 提取 _ai_filename，去除可能的副檔名（.pptx 等）
2. 找封面主標題變數：cover_* 開頭、style.detected.fontSize 最大者
3. 覆寫封面變數值 = _ai_filename
4. 組合下載檔名 = _ai_filename + "_YYYYMMDD" + ".ext"
5. 刪除 _ai_filename（不傳入文件生成，避免多餘欄位）
```

---

## 16. AI Pipeline Agents（`server/services/pipelineAgents.js`）

文件生成流程採用多層獨立 Flash LLM Agent 架構，每個 Agent 單一職責，失敗均為 non-fatal（靜默 fallback）。

### 16.1 架構概覽

```
Pro LLM 輸出
    │
    ├─[P2] Schema Extractor (Flash)
    │      template_values block 缺失/JSON 解析失敗時啟動
    │      從 Pro 全文提取符合 schema 的 JSON
    │
    ├─[P1] Schema Validator + AutoFix
    │      rule-based 校驗（無 AI call）
    │      有錯 → Flash 自動修正 JSON
    │
    ├─[P0] PPTX Layout Engine (Flash)
    │      僅 isPptxLayout && slides[] 非空時啟動
    │      overflow 拆分（> 6 條→新投影片）
    │      長句壓縮（> 30 字）
    │      3 個平行項目自動改 3col 版型
    │
    └─ generateDocument() 機械式生成
```

### 16.2 P0：PPTX Layout Engine

**觸發條件**：`pptx_settings.slide_config` 含 `layout_template` 且 `inputData.slides` 非空

**Flash Prompt 規則**：
- bullets 每張 ≤ 6 條，超出拆為續頁（標題加「（續）」）
- 每條重點 ≤ 30 中文字，過長壓縮核心意思
- 3col 每欄 ≤ 4 條
- 3 個平行並列項目的 bullets 投影片自動升級為 3col
- slide_title 不可帶序號（如「1. 」），有則移除
- 「參考來源」「參考文獻」等僅含 URL 的投影片直接刪除
- slide_content 必須完整保留原始資訊，不可刪除內容
- 輸出純 JSON 陣列

**後處理**：硬過濾 Google Search grounding reference slides（title 含「參考來源」且 content 含 URL）

**失敗行為**：回傳非陣列或空陣列 → warn log，使用原始 slides。

### 16.3 P1：Schema Validator + AutoFix

**觸發條件**：每次 template 生成前均執行

**rule-based 校驗項目**：
- required 欄位不得為 null/undefined/""
- loop 欄位必須是非空陣列（若 required=true）
- loop 子項目必須是物件
- required 子欄位不得缺失

**Flash 修正**：發現錯誤時，將 errors 清單 + schema 定義 + 原始 JSON 傳給 Flash 要求修正。

**失敗行為**：Flash 修正也失敗 → 使用原始 inputData，不中斷。

### 16.4 P2：Template Values Extractor

**觸發條件**：`template_values` block 缺失，或 `JSON.parse` 拋出例外

**機制**：將 Pro 完整回覆文字（截至 7000 字）+ schema 欄位描述交給 Flash，要求提取 JSON。

**失敗行為**：Flash 回傳非物件 → throw Error（視為生成失敗）。

### 16.5 P3：Task Planner

**觸發條件**：`_isLikelyMultiStep()` 正則快篩通過（含「然後...寄」「先...再」「生成...並發給」等模式）且非 template 模式（template 模式有自己的 pipeline）

**機制**：
1. 快篩通過 → 呼叫 Flash `planDynamicTask()`
2. Flash 判斷是否真正多步驟，產生 `pipelineRunner` 相容的 `nodes[]`
3. 若 `nodes.length >= 2` → 呼叫 `executeDynamicPlan()` 接 `pipelineRunner.runPipeline()`
4. 早期 return，跳過後續 Pro LLM call

**失敗行為**：Flash 失敗或 `nodes` 不足 2 個 → `return null` → 繼續正常流程。

**可用節點類型**：`skill`、`kb`、`mcp`、`ai`、`generate_file`、`condition`（繼承自 pipelineRunner）

### 16.6 Pipeline 執行位置（`chat.js` 整合點）

| Agent | 插入位置 | 說明 |
|-------|---------|------|
| P3 | tool loading 完成後、Pro LLM call 前 | 多步驟則 early return |
| P2 | `template_values` 解析後、P1 之前 | JSON 解析失敗時 fallback |
| P1 | P2 之後、P0 之前 | 每次均執行 |
| P0 | P1 之後、generateDocument 前 | 僅 PPTX layout_template |

---

## 17. 已知限制與規劃

| 項目 | 現狀 | 備註 |
|------|------|------|
| PDF AcroForm 加密 | pdf-lib 可讀取大多數加密（ignoreEncryption=true） | 強加密須先解鎖 |
| PDF regen 字型 | 需 `server/fonts/NotoSansTC-Regular.ttf` | 未部署此字型中文顯示為亂碼 |
| OCR 座標精度 | 估算值，需人工微調約 5-15 pt | 複雜版面誤差更大 |
| PPTX 封面變數注入 | 依賴 AI 分析 `original_text`；fallback 預設變數無 original_text 時封面維持靜態 | 可在版面編輯器手動指定 |
| PPTX 3col 欄位偵測 | 依 X 位置三等分；不規則欄間距可能分類錯誤 | 建議上傳前檢視分析結果 |
| DOCX 跨格合併儲存格 | 可能影響 label-based 偵測 | 建議範本避免使用跨格 |
| PDF 彩色背景 empty 模式 | 白色矩形覆蓋可能露白邊 | 非白底文件需注意 |
| P3 多步驟執行 UI 反饋 | 目前僅 status event，無步驟進度 bar | 規劃前端進度顯示 |
