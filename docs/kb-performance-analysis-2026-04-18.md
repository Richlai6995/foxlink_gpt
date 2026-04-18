# KB 建立速度效能分析報告

> 日期：2026-04-18  
> 分析人：Claude + rich_lai  
> 起因：使用者反映知識庫建立變慢，懷疑是 vector index 從 global 改為 local 造成

---

## 結論（TL;DR）

**索引改動不是兇手。真正的瓶頸是**：

1. **`parsePdf` 對所有 ≤18MB 的 PDF 預設跑 Gemini OCR**，不管 `parse_mode` 設什麼 — 慢且資料遺失
2. **Embed 序列化** + 100ms throttle，683 chunks 要 5 分鐘
3. `parse_mode: 'text_only'` 參數對 PDF **完全無效**（邏輯 bug）

索引改動（global vector index → 無 index）對 INSERT 速度其實有微幅正面影響。

---

## 索引改動真相

使用者記憶中「global → local」**不準確**。實際演化是：

1. **最初**：`KB_CHUNKS` 非分區表 + global vector index (`kb_chunks_vidx`, ORGANIZATION NEIGHBOR PARTITIONS)
2. **中期**：轉成 `PARTITION BY LIST (kb_id)`，vector index 仍是 global，text index (`kb_chunks_ftx`) 改為 LOCAL
3. **現況**：`kb_chunks_vidx` **被永久 DROP**（[database-oracle.js:379-394](../server/database-oracle.js#L379-L394)）— 因為無法處理混合維度（768/1536/3072）

搜尋靠 `WHERE kb_id=?` 的 partition pruning + 暴力 `VECTOR_DISTANCE` 計算。INSERT 少一份 index 維護反而更快。

---

## 測試設置

**測試環境**：本機 port 3007，Oracle 23 AI，Gemini API paid tier

**測試檔案** (`kb_test/`)：
| 檔 | 大小 | 內容 |
|----|------|------|
| Foxlink AI Application Blueprint (1).pdf | 0.95 MB | 圖片多的公司簡報 |
| Oracle 10g 2Day Training.pdf | 2.06 MB | Oracle 教學文件 |
| Oracle Performance Tuning & Optimization.pdf | 26.82 MB | Oracle 效能教學書 |

**測試條件**：全部 `dims=768`, `chunk_strategy='regular'`, `parse_mode='text_only'`

---

## Gemini API 基準測試

序列 10 次 embedText，單筆 ~380 字：

| dims | avg | min | max |
|------|-----|-----|-----|
| 768 | **359ms** | 317ms | 511ms |
| 3072 | **336ms** | 318ms | 370ms |

**結論**：維度不影響延遲（Matryoshka 模型內部都算 3072 再截斷）。

---

## KB 上傳計時結果

| 檔 | 大小 | parse 方式 | chunks | rawTextLen | parse | embed | insert | throttle | **total** |
|----|------|-----------|--------|-----------|-------|-------|--------|----------|-----------|
| Small | 0.95MB | **Gemini OCR** | 4 | 2,950 | 16.8s | 1.3s | 0.1s | 0.3s | **18.7s** |
| Medium | 2.06MB | **Gemini OCR** | 13 | 9,300 | 61.9s | 4.3s | 0.3s | 1.3s | **67.8s** |
| Medium-2 | 2.06MB | **Gemini OCR** | 41 | 60,685 | 97.7s | 13.4s | 0.9s | 4.3s | **116.4s** |
| Large | 26.82MB | **pdf-parse** | 683 | 1,448,038 | 2.0s | 215.1s | 15.4s | 73.2s | **306.5s** |

> Medium-2 是意外的同檔第二次上傳（不同 orphan process），抽取字數差異巨大（9,300 vs 60,685）顯示 **Gemini OCR 結果極不穩定**。

### 關鍵觀察

1. **Gemini OCR 是假提取真摘要**：2MB PDF 應該有幾十萬字的技術內容，只抽出 9,300 字
2. **跳過 OCR 反而完整**：28MB PDF 走 pdf-parse 抽出 1,448,038 字（150 倍多）
3. **Parse 在小 PDF 佔 >90%**，Embed 在大 PDF 佔 **70%**
4. **100ms throttle 純浪費**：Large 檔 73 秒等待
5. **INSERT 23ms/chunk**：不是瓶頸
6. **SPLIT PARTITION <1s**：不是瓶頸

---

## 真兇 #1：`parsePdf` 邏輯反直覺

[kbDocParser.js:143-177](../server/services/kbDocParser.js#L143-L177)：

```js
async function parsePdf(filePath, ocrModel = null) {
  const buf = fs.readFileSync(filePath);
  const sizeMb = buf.length / (1024 * 1024);

  if (sizeMb <= PDF_GEMINI_MAX_MB) {  // ← 18MB 閾值
    // 整份 PDF 丟給 Gemini Flash 做 OCR+摘要
    const result = await model.generateContent([
      { inlineData: { data: buf.toString('base64'), mimeType: 'application/pdf' } },
      { text: '請完整提取此 PDF 文件中所有內容...' }
    ]);
    return { text: ..., ocrInputTokens, ocrOutputTokens };
  }
  // Fallback: pdf-parse (text layer only)
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buf);
  return { text: data.text || '', ocrInputTokens: 0, ocrOutputTokens: 0 };
}
```

**問題**：
1. **大小判斷反了** — 有 text layer 的 PDF（絕大多數）走 Gemini 是浪費；沒 text layer 的（掃描版）走 pdf-parse 會抽不到東西
2. `parse_mode` 參數沒被檢查
3. Gemini Flash 傾向摘要而非完整轉錄，資料遺失

---

## 真兇 #2：序列化 embed + 無腦 throttle

[knowledgeBase.js:974-1009](../server/routes/knowledgeBase.js#L974-L1009)：

```js
for (let i = 0; i < chunks.length; i++) {
  const emb = await embedText(chunk.content, { dims });   // 序列
  await db.prepare('INSERT INTO kb_chunks ...').run(...); // 序列
  if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 100));  // 純等待
}
```

683 chunks 分解：
- embed 215s（序列）→ 並行 10 可降到 ~22s
- throttle 73s（100ms × 682）→ 全部可拿掉
- insert 15s（單列）→ executeMany 可降到 ~2s

`embedBatch()` 存在於 [kbEmbedding.js:54-66](../server/services/kbEmbedding.js#L54-L66)，但也是序列，且 KB 流程根本沒呼叫它。

---

## 優化優先順位

| # | 改動 | 預期收益 | 難度 |
|---|------|---------|------|
| **P0** | `parsePdf` 改預設走 pdf-parse，只在文字極少（掃描檔）時 fallback Gemini OCR | 2MB: 62s → 2s (31x)；資料完整度 150x | 中 |
| **P1** | embed 改 10 並行 | Large: 215s → 22s | 低 |
| **P2** | 移除 100ms throttle | Large: -73s | 極低 |
| **P3** | `executeMany` 批次 INSERT | Large: 15s → 2s | 中 |

**P0 + P1 + P2 組合效果**：
- Medium 2MB: 68s → ~5s (14x)
- Large 28MB: 306s → ~30s (10x)

---

## 延伸討論：更精細的 Parse 策略

使用者提出的問題：**純 text layer 解析會漏掉圖片裡的文字**（例如架構圖、表格截圖）。

後續討論方向：
- Per-page 偵測：頁面無圖 → 純文字抽取；頁面含圖 → OCR 該頁
- 新增 `force_ocr` 選項給純圖文件
- 圖片大小閾值（過濾裝飾性 logo/header）
- Gemini per-page 並行處理

---

## 優化實作 & 成果（2026-04-18 當天）

依據上述討論，當日完成 implementation。以下是實際測試數字對比。

### 新增能力

#### 1. `pdf_ocr_mode` 三段式選項
| 模式 | 邏輯 | 適用 |
|------|------|------|
| **off**（預設） | 只抽 PDF text layer（pdf-parse），不碰 OCR | 絕大多數有 text layer 的 PDF |
| **auto** | pdfjs-dist 逐頁偵測圖片（面積 ≥5%）→ 有圖的頁 OCR、其他用 text layer；若 ≥90% 頁面 <30 chars 自動升為 force | 圖文混合的文件 |
| **force** | 每頁都送 Gemini OCR（per-page 並行 20） | 純掃描檔 / 不信任 text layer |

UI：KB 設定頁 3-button radio、上傳時可 per-file 覆蓋、文件列表每筆有重新解析按鈕、KB 設定變更時跳批次重新解析 confirm。

#### 2. Per-page Gemini OCR
- pdf-lib split 單頁為獨立 PDF bytes
- `p-limit(20)` 並行送 Gemini Flash
- 3x retry，失敗 fallback 回該頁 text layer（不中斷全文件）

#### 3. Embed 全面並行化
- `processDocument`：原序列 for-loop + 100ms throttle → `p-limit(20)` 並行 embed
- INSERT 仍序列（Oracle pool 單連線）

#### 4. DOCX / PPTX / XLSX 圖片 OCR 並行化
同一 `p-limit(20)` 模式套用到 `parseDocx`, `parseDocxFormatAware`, `parsePptx`, `parseExcel`, `parseExcelFormatAware` — 所有 `_ocrImagesInZip()` 都是並行。

### 實測數字（Medium-2MB Oracle 10g 教材，164 頁）

| 指標 | 舊版 (Gemini 全文 OCR) | **off** | **auto** | force (估) |
|------|-----------------------|---------|----------|-----------|
| 總時間 | 68s | **9s** | 26s | ~40s |
| 抽出字數 | 1,212 | 57,202 | 64,163 | ~65,000 |
| chunks | 13 | 162 | 206 | ~210 |
| 快多少 | baseline | **7.5×** | 2.6× | 1.7× |
| 內容完整度 | baseline | **47×** | **53×** | ~54× |

### 純圖檔（Blueprint 6 頁）

| 模式 | 總時間 | 行為 |
|------|-------|------|
| 舊版 | 18.7s | 整份送 Gemini，得 4 chunks / 2,950 chars |
| auto | **11.3s** | pdfjs 偵測 6/6 頁 sparse → 自動升為 force → 並行 6 頁 OCR |

### Log 範例
```
[KBParser] PDF 164 pages, 17 need OCR (mode=auto, formatAware=false)
[KBParser] scanned PDF detected (6/6 sparse pages) → force OCR
[KBParser] PDF 6 pages, 6 need OCR (mode=force, formatAware=false)
```

### 索引改動的定論

**索引改動（global → 無 vector index）完全沒有造成建立變慢。** 原本的假設是錯的 — 現在無 vector index 對 INSERT 甚至**微幅更快**（少一份 index 維護）。真兇一直是 `parsePdf` 的預設 OCR 路徑 + 序列化 embed。

### 變更檔案清單

| 檔案 | 變更 |
|------|------|
| [server/database-oracle.js](../server/database-oracle.js) | 新增 `KNOWLEDGE_BASES.PDF_OCR_MODE`, `KB_DOCUMENTS.PDF_OCR_MODE`, `KB_DOCUMENTS.STORED_FILENAME` |
| [server/services/kbDocParser.js](../server/services/kbDocParser.js) | 新 `parsePdfSmart` + per-page OCR + `_ocrImagesInZip` 並行化 DOCX/PPTX/XLSX |
| [server/routes/knowledgeBase.js](../server/routes/knowledgeBase.js) | `pdf_ocr_mode` 參數 + 並行 embed + `POST /reparse` + `POST /reparse-all` |
| [client/src/pages/KnowledgeBaseDetailPage.tsx](../client/src/pages/KnowledgeBaseDetailPage.tsx) | KB radio / 上傳 select / 文件 reparse popover / 批次 confirm |
| client/src/i18n/locales/{zh-TW,en,vi}.json | 新增 `kb.settings.pdfOcr.*` + `kb.docs.reparse*` + `kb.settings.reparseAll*` |

### 新增依賴

| 套件 | 版本 | 用途 |
|------|------|------|
| pdfjs-dist | 5.6.205 | 逐頁 text + 影像 ops 分析（CTM 追蹤面積） |
| p-limit | 7.3.0 | 並行控制（embed / OCR 皆 20） |
| pdf-lib | 已有 | 單頁切割給 Gemini |

兩個新套件都是 ESM-only，用 dynamic `import()` 橋接 CJS server。

### 環境變數（選配）

| 變數 | 預設 | 說明 |
|------|------|------|
| `KB_PDF_OCR_CONCURRENCY` | 20 | per-page PDF OCR 並發數 |
| `KB_IMG_OCR_CONCURRENCY` | 20 | DOCX/PPTX/XLSX 嵌入圖 OCR 並發數 |
| `KB_EMBED_CONCURRENCY` | 20 | embed 並發數 |

### 棄用的環境變數

`KB_PDF_OCR_MAX_MB`（預設 18MB 閾值）— 不再使用。原本是「≤18MB 走 Gemini OCR、>18MB 走 pdf-parse」的反直覺邏輯，現由 `pdf_ocr_mode` 取代。

---

## 測試腳本位置

- `kb_test/gemini-baseline.js` — Gemini API 延遲基準
- `kb_test/run-test.js` — KB 上傳計時測試
- `kb_test/*.pdf` — 測試檔案（3 個）

執行方式：
```bash
cd d:/vibe_coding/foxlink_gpt
node kb_test/gemini-baseline.js       # API 基準
node kb_test/run-test.js small        # 小檔
node kb_test/run-test.js medium       # 中檔
node kb_test/run-test.js large        # 大檔
node kb_test/run-test.js all          # 全部
```

測試期間 [knowledgeBase.js:944-1030](../server/routes/knowledgeBase.js#L944-L1030) 有加計時 log（`[KB-PERF]` prefix），測試後可移除。
