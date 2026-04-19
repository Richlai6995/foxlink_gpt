# KB Retrieval 架構升級計畫 v2

> 狀態：**已實作完成（Phase 1 / 2 / 3a / 3b / 3c 上線）**
> 建立日期：2026-04-19
> 最後更新：2026-04-19
> 負責：rich_lai / Claude

---

## 1. 背景與目標

### 現況痛點（已全部處理）

1. ~~Fulltext 用 `LIKE %query%` 寫死在 4 個檔~~ ✅ 統一到 `services/kbRetrieval.js`
2. ~~Tokenize + hit_score 是 JS 端 hack~~ ✅ 全 config 驅動，CJK ≥3 字優先 + actual_max 正規化
3. ~~Hybrid score fusion 寫死~~ ✅ 支援 Weighted + RRF 兩種 fusion，可調權重
4. ~~Oracle Text 索引 `kb_chunks_ftx` 存在但沒用到~~ ✅ WORLD_LEXER + SYNC EVERY 1min
5. ~~Vector column 是 `VECTOR(*, FLOAT32)` wildcard~~ ✅ 強制統一 768 dim + IVF vector index
6. ~~Orphan chunks 累積~~ ✅ FK + trigger + hourly cron 三層防護
7. ~~參數全寫死~~ ✅ 三層 admin UI（系統級 / per-KB 覆寫 / 調校 debug 頁）

### 新增亮點

- ✅ **同義詞字典**（繞過 CTX_THES 權限問題，改 query-time 展開）
- ✅ **Multi-vector per chunk**（title + body 加權向量檢索）
- ✅ **Chunker 工作表邊界硬分段**（小 sheet 不被併到大 chunk 被稀釋）

---

## 2. 實際實作（對照原規劃決策）

| # | 項目 | 規劃 | 實際 |
|---|------|------|------|
| 1 | Lexer | WORLD_LEXER | ✅ 如規劃（CTXSYS.WORLD_LEXER 直接用） |
| 2 | 預設 fulltext query op | ACCUM | ✅ 如規劃 |
| 3 | 預設 fuzzy | OFF | ✅ 如規劃 |
| 4 | Vector weight 預設 | 0.4 | ✅ 如規劃 |
| 5 | retrieval_config 存哪 | KB row CLOB | ✅ 如規劃 |
| 6 | 舊欄位（score_threshold 等） | 保留 | ✅ 如規劃，並加 system-seeded KB 重設為 NULL migration |
| 7 | LIKE backend 留多久 | 永久 fallback | ✅ oracle_text 失敗自動退 LIKE |
| 8 | FK 加不上 partition | 改 trigger | ✅ FK 直接加上，無需 trigger |
| 9 | Orphan cleanup 頻率 | hourly cron | ✅ + admin UI 提供 7 種預設 + 自訂 cron |
| 10 | 同義詞字典 | Phase 3 一起做 | ✅ **改手動追蹤表 + query-time OR 展開**（CTX_THES 權限缺失） |
| 11 | Vector index 方案 | 統一 768 + HNSW | ⚠️ **改為 IVF (ORGANIZATION NEIGHBOR PARTITIONS)**（LIST partition 不支援 HNSW LOCAL） |
| 12 | 非 768 KB 遷移 | 強制全遷 768 | ✅ migration 直接 re-embed |
| 13 | Multi-vector per chunk | 做（Phase 3） | ✅ 完成，含 backfill endpoint |

---

## 3. 實際架構

### 3.1 檔案清單

```
server/
├── services/
│   ├── kbRetrieval.js            ✅ 統一 retrieval service（oracle_text + LIKE 雙 backend）
│   ├── kbMaintenance.js          ✅ orphan cleanup + dim stats + hourly cron
│   └── kbSynonyms.js             ✅ 追蹤表 CRUD + query-time 展開（不走 CTX_THES）
├── routes/
│   ├── knowledgeBase.js          ✅ PUT /kb/:id 接 retrieval_config、reparse-all、thesauri-names
│   └── admin.js                  ✅ /admin/settings/kb-retrieval、/admin/kb/{maintenance,debug-search,chunk-grep,thesauri,backfill-title}
└── database-oracle.js            ✅ 完整 migration: 欄位 / FK / WORLD_LEXER / IVF / system defaults / 追蹤表

client/src/
├── components/admin/
│   ├── KbRetrievalSettings.tsx   ✅ 系統級設定 panel + cron 下拉 + 維護操作
│   ├── KbRetrievalDebug.tsx      ✅ 4 階段並排 + Grep 工具 + 同義詞 trace
│   └── KbSynonyms.tsx            ✅ 字典 CRUD + 同義詞 term ↔ related 編輯
└── pages/
    └── KnowledgeBaseDetailPage.tsx ✅ per-KB 進階檢索摺疊區 + 重解析 + 補 title 向量按鈕
```

### 3.2 兩個 backend（oracle_text 為主，LIKE 為 fallback）

**oracle_text：**
```sql
SELECT c.id, c.content, d.filename, SCORE(1) AS ft_raw_score
FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id
WHERE c.kb_id=? AND c.chunk_type != 'parent'
  AND CONTAINS(c.content, ?, 1) > 0
ORDER BY SCORE(1) DESC
FETCH FIRST ? ROWS ONLY
```
CONTAINS query 由 `_buildOracleTextQuery(tokens, cfg)` 組成，支援 ACCUM / AND / OR、fuzzy 前綴、NEAR proximity。

**LIKE fallback：** 維持原 tokenize + length² 加權 CASE WHEN 邏輯，提供極端環境（Oracle Text 壞）時保底。

### 3.3 Multi-vector 搜尋 SQL

```sql
SELECT c.id, ..., 
  (CASE WHEN c.title_embedding IS NULL
    THEN VECTOR_DISTANCE(c.embedding, TO_VECTOR(?), COSINE)
    ELSE :title_weight * VECTOR_DISTANCE(c.title_embedding, TO_VECTOR(?), COSINE)
       + :body_weight  * VECTOR_DISTANCE(c.embedding,       TO_VECTOR(?), COSINE)
  END) AS vector_score
FROM kb_chunks c ...
ORDER BY vector_score ASC
FETCH FIRST ? ROWS ONLY
```
title_embedding IS NULL → 自動退回單向量（不強制所有 chunks 都有 title）。

### 3.4 同義詞展開（query-time）

實作在 `kbSynonyms.expandQuery(db, thesaurus, query)`：
1. 掃字典所有 `term / related` 對
2. 若 query 子字串（case-insensitive）命中 term → 加 related；反向亦同
3. 回傳 `{ expanded, added[] }`

展開後的 query 走一般 `extractTokens` + `_buildOracleTextQuery`，所以同義詞會自然出現在 CONTAINS 的 ACCUM 表達式中。

搭配：chat 端 `executeSelfKbSearch` 會把「這些詞是同一實體」當 hint 塞進給 LLM 的 context，避免 LLM 只看其中一種寫法的 chunk 就下結論。

---

## 4. Commits 對照表

| Phase | Commit | 內容 |
|---|---|---|
| Phase 1 | `a7c4a1e` | 抽 `services/kbRetrieval` + orphan FK + golden queries |
| Phase 2 | `bfe7457` | WORLD_LEXER + IVF vector index + oracle_text backend |
| Phase 3a | `c2459d3` | Admin UI 三件套（系統 / per-KB / debug） |
| 3a+ | `d3d26a6` | System KB 吃預設 + cron 下拉 |
| 3a+ | `3288f91` | ftx SYNC EVERY 1min（解決上傳變慢） |
| 3a+ | `8e2e6c6` | Grep 診斷工具 |
| 3a+ | `e45c648` | Excel 工作表邊界硬分段 |
| 3a+ | `66ecf75` | 「重新解析此 KB」按鈕 |
| 3a+ | `805d5f0` | Debug 頁加 KB 名稱標注 |
| Phase 3b | `dbf8dce` | 同義詞字典管理（CTX_THES） |
| 3b+ | `0b534ce` | 改用追蹤表取代 CTX view 查詢 |
| 3b+ | `1062b6c` | 改 query-time OR 展開（繞 CTX_THES 權限） |
| 3b+ | `0e6a993` | 修 `??` / `\|\|` 混用括號 |
| 3b+ | `5f17cf1` | Phrase-level 展開（支援 "Carson Chung" 多字） |
| 3b+ | `5c6f90f` | Debug stats 顯示同義詞展開結果 |
| 3b+ | `8bf1dea` | 同義詞字典欄位改 LOV 下拉 |
| 3b+ | `2bdebdb` | `/thesauri-names` 路由順序修正 |
| 3b+ | `7f77530` | 同義詞 hint 塞進 LLM context |
| 3b+ | `248a7ef` | Debug log 確認 hint 是否觸發 |
| 3b+ | `8083648` | **chat/webex/research SELECT 補 retrieval_config**（per-KB 覆寫從未生效的根因） |
| Phase 3c | `6ed259f` | Multi-vector per chunk（title + body 加權檢索） |

---

## 5. Config Schema（實際）

### 5.1 `knowledge_bases.retrieval_config` CLOB (JSON)

```json
{
  "backend":              "oracle_text",
  "fusion_method":        "rrf",
  "vector_weight":        0.4,
  "fulltext_weight":      0.6,
  "title_weight":         0.3,
  "body_weight":          0.7,
  "fulltext_query_op":    "accum",
  "fuzzy":                false,
  "synonym_thesaurus":    "foxlink_syn",
  "use_proximity":        false,
  "proximity_distance":   10,
  "min_ft_score":         0.2,
  "vec_cutoff":           0.7,
  "rrf_k":                60,
  "use_multi_vector":     true,
  "token_stopwords":      ["..."],
  "debug":                false
}
```

### 5.2 Config resolution 優先序

```
kb.retrieval_config.X  > system_settings.kb_retrieval_defaults.X  > HARDCODED_DEFAULTS.X
```

`HARDCODED_DEFAULTS` 定義在 [server/services/kbRetrieval.js](../server/services/kbRetrieval.js)。

---

## 6. 踩坑紀錄 / Lessons Learned

### 6.1 chat 的 SELECT 漏欄位（Phase 3 最大教訓）

在 Phase 3a–3b 搞了一圈「為什麼 per-KB 同義詞沒生效」，最後發現 `chat.js` / `webex.js` / `researchService.js` 的 `SELECT FROM knowledge_bases` 沒有把 `retrieval_config` 欄位撈出來。

→ `retrieveKbChunks` 收到的 `kb.retrieval_config = undefined`
→ `resolveConfig` 退回純系統預設
→ **所有 per-KB 覆寫完全沒作用**（同義詞、multi-vector、fuzzy、權重全部 noop）

fix：`8083648` 在所有 caller SELECT 補上 retrieval_config。

**防範**：未來新增 retrieval_config 用到的參數，務必 grep 所有 `SELECT ... FROM knowledge_bases` 加上該欄位；或重構為固定 `SELECT *`（有 CLOB 成本需評估）。

### 6.2 CTX_THES 權限缺失

原規劃直接用 Oracle Text 的 `CTX_THES.CREATE_THESAURUS + SYN()`，FOXLINK 帳號缺 `EXECUTE ON CTXSYS.CTX_THES`（`PLS-00201`）→ 改為自建追蹤表 + query-time 手動 OR 展開。意外的好處：雙向、支援多字 phrase、debug 可看 SQL。

### 6.3 chunker 小 sheet 被稀釋

`chunkRegular` 原本只按 `\n\n` 合併；Excel 的小 sheet（如香港只有 5 人）被塞到前一個 sheet 的 chunk 尾端，整個 chunk 語意訊號被大 sheet 的資料淹沒，vector 分數查不到。

fix：遇到 `[工作表: XXX]` paragraph 強制 flush 開新 chunk。每個 sheet 至少一個獨立 chunk。

### 6.4 ftx SYNC (ON COMMIT) 導致上傳變慢

`node-oracledb autoCommit: true` 搭 `SYNC (ON COMMIT)`，每插一筆 chunk 觸發一次 ftx reindex。50 chunks 檔案 = 50 次 sync。

fix：改 `SYNC (EVERY "SYSDATE+1/1440")` 每 1 分鐘背景 sync，insert 恢復正常，查詢最多 1 分鐘 lag。失敗 fallback ON COMMIT。

### 6.5 `??` 混用 `||` 必須加括號

Node 嚴格模式 `SyntaxError: Unexpected token '||'`。寫成 `(a ?? b) || c`。

### 6.6 Express `/thesauri-names` 路由順序

Express 按註冊順序 match，`/:id` 會先吃掉 `/thesauri-names`。要放 `/:id` 之前。

---

## 7. Config UI 路徑快速索引

| 功能 | 位置 |
|------|------|
| 系統級檢索預設 | Admin → **KB 檢索設定** |
| Per-KB 覆寫 | KB 設定頁 → **進階檢索設定（覆寫系統預設）** 摺疊區 |
| 檢索調校 debug 頁 | Admin → **KB 檢索調校** |
| 子字串 Grep 診斷 | Admin → KB 檢索調校 → 黃色 Grep 區塊 |
| 同義詞字典管理 | Admin → **KB 同義詞字典** |
| Orphan cleanup 設定 | Admin → KB 檢索設定 → 維護操作區塊 |
| Rebuild vector index | Admin → KB 檢索設定 → Rebuild kb_chunks_vidx 按鈕 |
| 重新解析此 KB | KB 設定頁底部 橘色按鈕 |
| 補 title 向量 | KB 設定頁底部 紫色按鈕 |

---

## 8. 未來方向（尚未做，但已評估）

| 項目 | 何時考慮 | 預期收益 |
|------|---------|---------|
| HyDE query transformation | 精度仍不足時 | +5-10% |
| Multi-query expansion | 同上 | +5-10% |
| Binary quantization | chunks > 1M 時 | 儲存省 32x |
| Query caching (Redis) | 重複 query 多時 | latency -80% for cached |
| HNSW index (vs IVF) | 如未來升 Oracle 支援 HNSW + LIST partition | +10-30% recall |
| Custom rerank model | Cohere 不夠好時 | +5-10% |

---

## 9. 監控指標建議（尚未埋點）

以下需在 Prometheus / Grafana 補：

- `kb_retrieval_latency_ms{backend,source}` p50/p95 (> 2000ms 警報)
- `kb_retrieval_zero_results_ratio` (> 5% 警報)
- `kb_orphan_current` (> 10000 警報)
- `kb_retrieval_rerank_usage_ratio` 統計
- `kb_synonym_expanded_ratio` 有開字典的 query 有多少比例真的展開了

---

## 10. 參考資料

- Oracle 23 AI Vector Search Guide: https://docs.oracle.com/en/database/oracle/oracle-database/23/vecse/
- Oracle Text CONTAINS Reference: https://docs.oracle.com/en/database/oracle/oracle-database/23/ccref/
- HNSW paper: https://arxiv.org/abs/1603.09320
- Gemini embedding Matryoshka: https://ai.google.dev/gemini-api/docs/embeddings
- Cohere rerank API: https://docs.cohere.com/reference/rerank
- 效能診斷報告: [docs/kb-performance-analysis-2026-04-18.md](./kb-performance-analysis-2026-04-18.md)
