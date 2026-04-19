# KB Retrieval 架構升級計畫 v2

> 狀態：**規劃階段（待 Phase 1 開工）**
> 建立日期：2026-04-19
> 上次更新：2026-04-19
> 負責人：rich_lai / Claude

---

## 1. 背景與目標

### 現況痛點

1. **Fulltext 用 `LIKE %query%`** — 寫死在 4 個檔（chat / knowledgeBase / externalKb / webex）
2. **Tokenize + hit_score 是 JS 端 hack** — length² / actual_max / stopword list 全寫死
3. **Hybrid score fusion 寫死**（0.4 vec + 0.6 ft + 0.1 boost）
4. **Oracle Text 索引 `kb_chunks_ftx` 存在但沒用到**（BASIC_LEXER 預設，中文不能 tokenize）
5. **Vector column 是 `VECTOR(*, FLOAT32)` wildcard** — 無法建 Oracle 23 AI 的 HNSW index
6. **Orphan chunks 累積** — kb_chunks 對 kb_documents 沒 FK，刪 doc 不會 cascade
7. **參數全寫死** — 無 admin UI 可調

### 升級目標

- ✅ 把 Oracle 23 AI 的 **vector + text hybrid search + SCORE** 用好用滿
- ✅ 統一 `services/kbRetrieval.js` 單一 service，消除 4 處 copy-paste
- ✅ 所有 tuning 參數走 config，**絕不寫死**
- ✅ Orphan chunks 自動處理（DB FK + 定時清理）
- ✅ Multi-vector per chunk（title + body）提升結構化文件精度
- ✅ Admin UI 可調整所有參數

### 非目標（不在這次範圍）

- ❌ Property Graph / Select AI（對 KB 檢索無直接關聯）
- ❌ DBMS_VECTOR_CHAIN（複雜度過高，延後）
- ❌ Binary quantization（儲存優化，未來再評估）

---

## 2. 確認的設計決策

| # | 項目 | 決定 |
|---|------|------|
| 1 | Lexer | **WORLD_LEXER**（中英混雜最佳） |
| 2 | 預設 fulltext query op | **ACCUM**（多詞累積相似度） |
| 3 | 預設 fuzzy | **OFF**（per-KB opt-in） |
| 4 | Vector weight 預設 | **0.4**（fulltext 0.6 + match boost 0.1） |
| 5 | retrieval_config 存哪 | **`knowledge_bases.retrieval_config CLOB`**（JSON） |
| 6 | 舊欄位（score_threshold 等） | **保留，向後相容**，retrieval_config 優先 |
| 7 | LIKE backend 留多久 | **永久當 fallback** |
| 8 | FK 加不上 partition 怎辦 | **改用 trigger** 保證 DB 層 cascade |
| 9 | Orphan cleanup 頻率 | **hourly cron** |
| 10 | 同義詞字典 | **Phase 3 一起做** |
| 11 | Vector index 方案 | **強制統一 768 + HNSW**（方案 B） |
| 12 | 非 768 KB 遷移 | **強制全遷 768**（現有資料少） |
| 13 | Multi-vector per chunk | **做**（Phase 3） |

---

## 3. 核心架構

### 3.1 新增檔案

```
server/
├── services/
│   ├── kbRetrieval.js            ← 統一 retrieval service（hybrid SQL / score fusion / rerank）
│   ├── kbMaintenance.js          ← orphan cleanup / dim migration / stats helper
│   ├── kbSynonyms.js             ← CTX_THES 同義詞字典管理（Phase 3）
│   └── kbChunkRouter.js          ← Multi-vector chunk 路由（Phase 3）
├── routes/
│   └── knowledgeBase.js          ← 加 admin endpoints
└── database-oracle.js            ← migration: FK / HNSW / CTX index rebuild

client/src/
├── components/admin/
│   └── KbRetrievalSettings.tsx   ← 系統級檢索設定 tab
└── pages/
    └── KnowledgeBaseDetailPage.tsx ← per-KB 進階檢索區塊 + debug 工具

docs/
└── kb-retrieval-architecture-v2.md  ← 此文件（計畫 → 之後更新為實作紀錄）
```

### 3.2 `kbRetrieval.js` 對外介面

```javascript
const { retrieveKbChunks } = require('../services/kbRetrieval');

const { results, stats } = await retrieveKbChunks(db, {
  kb,                 // DB row（含 retrieval_config）
  query,              // 使用者原始 query
  topK,               // 想要幾筆（可覆寫 kb.top_k_return）
  scoreThreshold,     // 覆寫（可選）
  sessionId,          // retrieval_tests 紀錄用
  userId,
  source,             // 'chat' | 'search' | 'webex' | 'external_api'
  debug,              // true → stats 回傳詳細資訊
});

// results: Array<{ id, content, parent_content, filename, score, match_type, rerank_score? }>
// stats: { backend, vec_fetched, ft_fetched, merged, after_rerank, final, elapsed_ms, tokens_extracted, synonyms_applied }
```

### 3.3 Single-SQL Hybrid Query（Oracle 23 AI 關鍵）

```sql
SELECT c.id, c.content, c.parent_content, d.filename,
       VECTOR_DISTANCE(c.embedding, :qvec, COSINE)         AS vec_dist,
       SCORE(1)                                            AS ft_score,
       (:ft_weight * NVL(SCORE(1), 0) / 100 +
        :vec_weight * (1 - VECTOR_DISTANCE(c.embedding, :qvec, COSINE))) AS hybrid_score
FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id
WHERE c.kb_id = :kb_id
  AND c.chunk_type != 'parent'
  AND (CONTAINS(c.content, :text_query, 1) > 0
       OR VECTOR_DISTANCE(c.embedding, :qvec, COSINE) < :vec_cutoff)
ORDER BY hybrid_score DESC
FETCH APPROX FIRST :top_k ROWS ONLY   -- 23 AI HNSW optimization
```

優點：
- Oracle 優化器同時用 HNSW + CTXSYS.CONTEXT 雙索引
- 一次 round-trip
- 權重參數綁定（config 驅動）
- 加 `FETCH APPROX FIRST` 讓 HNSW 走 ANN path

---

## 4. 實作 Phase

### Phase 1 — 抽 service + 修 orphan + config 化（1.5 天）

**目標**：無行為改變，只是重構 + 開 config 介面 + 修 orphan 根源。

- [ ] 建立 `services/kbRetrieval.js`，內含：
  - 現有 LIKE-based tokenize 邏輯（as `backend: "like"`）
  - config 讀取優先序：`kb.retrieval_config` > `system_settings.kb_retrieval_defaults` > hardcoded fallback
- [ ] Migration：
  - `ALTER TABLE knowledge_bases ADD retrieval_config CLOB`
  - 寫入 `system_settings.kb_retrieval_defaults` 初始值
  - **清空 orphan chunks**（前置步驟）
  - 加 FK `kb_chunks.doc_id → kb_documents.id ON DELETE CASCADE`
    - 如 partitioned LIST 不允許 → 改建 `TRIGGER trg_kb_documents_cascade AFTER DELETE ON kb_documents`
- [ ] 建立 `services/kbMaintenance.js`：
  - `cleanupOrphanChunks()` — 回傳清除筆數
  - `dimMigrationStats()` — 各 KB 目前維度分布
  - `rebuildVectorIndex()` — 用於 dim 統一後重建 HNSW
- [ ] 註冊 hourly cron（用現有 scheduled task 系統）：
  - 頻率從 `system_settings.kb_cleanup_cron` 讀（預設 `0 * * * *`）
  - log 每次清了幾筆 → `metrics` 或 log 檔
- [ ] 改 4 處 caller：`chat.js` / `knowledgeBase.js` / `externalKb.js` / `webex.js`
  - 全部呼叫 `retrieveKbChunks(db, opts)`
  - 統一 log 格式 `[KbRetrieval]` prefix
- [ ] 啟動時跑一次 orphan cleanup（除非 `KB_CLEANUP_ON_STARTUP=false`）

**上線準則**：所有現有搜尋功能行為一致，orphan 不再累積，dev 環境測過。

### Phase 2 — Oracle 23 AI Text + HNSW（2 天）

**目標**：導入 Oracle 23 AI 的 single-SQL hybrid + HNSW index + 全新 Oracle Text 索引。

- [ ] **統一維度到 768** migration：
  - 掃描 `knowledge_bases` 裡所有 `embedding_dims != 768` 的 KB
  - 若有資料：執行「dim 遷移」— 重新 embed 所有 chunks 為 768
  - 若無資料：直接 UPDATE `embedding_dims = 768`
  - `ALTER TABLE kb_chunks MODIFY embedding VECTOR(768, FLOAT32)`
- [ ] Rebuild Oracle Text index：
  ```sql
  EXEC CTX_DDL.CREATE_PREFERENCE('foxlink_world_lexer', 'WORLD_LEXER');
  DROP INDEX kb_chunks_ftx;
  CREATE INDEX kb_chunks_ftx ON kb_chunks(content)
    INDEXTYPE IS CTXSYS.CONTEXT
    PARAMETERS ('LEXER foxlink_world_lexer SYNC (ON COMMIT)')
    LOCAL;
  ```
- [ ] Build HNSW index：
  ```sql
  CREATE VECTOR INDEX kb_chunks_vidx ON kb_chunks(embedding)
    ORGANIZATION INMEMORY NEIGHBOR GRAPH
    DISTANCE COSINE
    WITH TARGET ACCURACY 95
    PARAMETERS (TYPE HNSW, NEIGHBORS 40, EFCONSTRUCTION 500);
  ```
- [ ] `kbRetrieval.js` 加 `backend: "oracle_text"`：
  - Single-SQL hybrid query
  - Query 轉換 → Oracle Text 語法（escape + ACCUM 包裝）
  - Support fuzzy opt-in（`?token`）
  - Support CTX_THES（`SYN(term, thesaurus_name)`）
  - Support NEAR proximity（`NEAR((token1, token2), N)`）
- [ ] System default 切成 `backend: "oracle_text"`
- [ ] Fallback 路徑：若 CONTAINS 失敗（e.g. index 未建），log 警告 + 自動用 LIKE

**上線準則**：搜尋精度 ≥ Phase 1 且 latency 下降。所有既有查詢照常工作。

### Phase 3 — Multi-vector + 同義詞 + Admin UI（2 天）

**目標**：提升精度（multi-vector）+ 使用者自助（admin UI）。

- [ ] Multi-vector per chunk：
  - schema: `kb_chunks` 加 `title_embedding VECTOR(768, FLOAT32)` 欄位（nullable）
  - Chunker 偵測 heading / 標題 structure → 抽取 title + body
  - Embed: 雙 embedding（title + body）
  - Search SQL:
    ```sql
    ORDER BY
      :title_weight * (1 - VECTOR_DISTANCE(c.title_embedding, :qvec, COSINE)) +
      :body_weight  * (1 - VECTOR_DISTANCE(c.embedding,       :qvec, COSINE)) +
      ...
    ```
  - 預設 `title_weight=0.3, body_weight=0.7`（可調）
  - 既有 KB 重建 embedding 時自動填 title_embedding（若能從 chunk content 抽出 heading）
- [ ] Synonym dictionary (CTX_THES)：
  - `services/kbSynonyms.js`: CRUD 同義詞（建立/讀取/刪除字典、加/刪 relation）
  - Per-KB 設定 `retrieval_config.synonym_thesaurus`
  - Admin UI tab「同義詞字典管理」
- [ ] Admin UI 增強：
  - **系統級 KB 檢索設定** tab（/admin 下）
    - backend radio, weights sliders, topK inputs, stopwords textarea
    - 「清 Orphan Chunks」按鈕 + 顯示上次清除時間 / 筆數
    - 「Rebuild Vector Index」按鈕（維護用）
  - **Per-KB 進階檢索設定** 摺疊區（KB 設定頁）
    - 覆寫 backend / weights / fuzzy / synonym_thesaurus
    - 所有欄位初始顯示「使用系統預設」
  - **KB 檢索調校** 獨立頁
    - 輸入 query + 選 KB → 並排顯示 vector / fulltext / hybrid / rerank 各階段 top 10
    - 顯示完整 stats（elapsed, tokens, synonym matches）
    - 存 test queries 方便之後 A/B 比較

**上線準則**：admin 可自調所有參數，multi-vector 對結構化文件精度提升可驗證。

### Phase 4 — 清理 + 文件 + 監控（1 天）

- [ ] 移除 4 個 caller 殘留的 inline retrieval code
- [ ] 移除 JS 端 tokenize / hit_score 的 hacky code（全進 service）
- [ ] 新增 metrics 紀錄：retrieval latency p50/p95、命中率、rerank usage rate
- [ ] Update `docs/kb-retrieval-architecture-v2.md` — 從「計畫」更新為「現況」，加實作細節
- [ ] 寫 migration runbook（給 K8S 部署用）

---

## 5. Config Schema

### 5.1 `knowledge_bases.retrieval_config` CLOB（JSON）

```json
{
  "backend":              "oracle_text",
  "use_hybrid_sql":       true,
  "vector_weight":        0.4,
  "fulltext_weight":      0.6,
  "match_boost":          0.1,
  "title_weight":         0.3,
  "body_weight":          0.7,
  "fulltext_query_op":    "accum",
  "fuzzy":                false,
  "synonym_thesaurus":    null,
  "use_proximity":        false,
  "proximity_distance":   10,
  "min_ft_score":         0.2,
  "vec_cutoff":           0.7,
  "token_stopwords":      null,
  "debug":                false
}
```

### 5.2 `system_settings.kb_retrieval_defaults`

同 schema，作為 fallback。初始值：

```json
{
  "backend":           "oracle_text",
  "use_hybrid_sql":    true,
  "vector_weight":     0.4,
  "fulltext_weight":   0.6,
  "match_boost":       0.1,
  "title_weight":      0.3,
  "body_weight":       0.7,
  "fulltext_query_op": "accum",
  "fuzzy":             false,
  "synonym_thesaurus": null,
  "use_proximity":     false,
  "proximity_distance": 10,
  "min_ft_score":      0.2,
  "vec_cutoff":        0.7,
  "token_stopwords":   ["分機","地址","電話","傳真","資料","哪些","每個","我要","你要","所有"],
  "debug":             false,
  "default_top_k_fetch":    20,
  "default_top_k_return":   5,
  "default_score_threshold": 0
}
```

### 5.3 Config resolution 優先序

```
kb.retrieval_config?.X
  > system_settings.kb_retrieval_defaults?.X
  > code-level fallback default
```

---

## 6. Migration 注意事項

### 6.1 風險對照表

| 步驟 | 風險 | 對策 |
|------|------|------|
| 清 orphan 後加 FK | ALTER TABLE 可能失敗（若 partition 限制） | 失敗就 fallback 改 trigger |
| 統一 768 需重新 embed 所有 KB | 大量 API 呼叫費用 / 時間 | **現在資料少** 成本低；若有多 KB 在 Vertex AI 配額內 ~10 分 |
| Rebuild Oracle Text index | 重建期間 fulltext 暫不可用 | backend 自動退回 LIKE；dev 先跑；K8S 夜間跑 |
| Build HNSW index | 需要 SGA 足夠記憶體（估 300MB per 100K chunks） | 檢查 K8S Pod memory limit；監控 SGA 使用率 |
| 23 AI single-SQL 查詢 plan | 優化器可能選錯 | 加 hint、跑 EXPLAIN PLAN 驗證 |
| FK + LIST PARTITION 不相容 | 部分 Oracle 版本限制 | 用 `AFTER DELETE` trigger 替代 |

### 6.2 Rollback 方案

| 階段 | Rollback 方式 |
|------|--------------|
| Phase 1 | `GEMINI_PROVIDER=studio` 切回舊 SDK；service 換回 inline code（保留 git tag 備用） |
| Phase 2 | `system_settings.kb_retrieval_defaults.backend = "like"` 立即生效，oracle_text 禁用 |
| HNSW 失敗 | DROP INDEX `kb_chunks_vidx`，service 自動退回暴力掃描 |
| FK 失敗 | DROP CONSTRAINT + DROP TRIGGER，僅保留 hourly cron 清 orphan |

### 6.3 K8S 部署步驟

1. dev 完整跑過 Phase N
2. `./deploy.sh` build image
3. Migration 自動跑（於 `runMigrations()` 時）
4. **如果 Phase 2**: 先停用 backend 切換（fulltext 仍走 LIKE），等 index 重建完成再切
5. 監控 pod log：`[KbRetrieval]` 事件
6. 有問題 env 改 `backend=like` 立即回退

---

## 7. 監控與可觀察性

### 7.1 必要 metrics（Prometheus / Grafana）

| Metric | 意義 | 警告閾值 |
|--------|------|---------|
| `kb_retrieval_latency_ms{backend,source}` p95 | 檢索延遲 | > 2000ms |
| `kb_retrieval_results_total{backend,source}` | 總檢索次數 | - |
| `kb_retrieval_zero_results_ratio` | 零結果率 | > 5% |
| `kb_retrieval_rerank_usage_ratio` | rerank 套用率 | - |
| `kb_orphan_cleaned_total` | 累計清除 orphan 數 | - |
| `kb_orphan_current` | 當前 orphan 數 | > 10000 |
| `kb_hnsw_index_size_mb` | HNSW 記憶體 | > 1GB |
| `gemini_embedding_errors_total{code}` | embedding 失敗 | 429 > 0 / min |

### 7.2 日誌格式

統一 prefix `[KbRetrieval]`：

```
[KbRetrieval] kb=xxx source=chat query="鍾漢成" backend=oracle_text
  tokens=[鍾漢成] vec_fetched=30 ft_score_max=95 merged=15 rerank=cohere
  final=5 elapsed=234ms
```

### 7.3 KB 檢索調校頁（admin）

讓管理員能不用看 log 就能：
- 看最近 N 次檢索的 stats
- 比對同 query 不同 config 的結果差異
- 匯出「金標資料」（已知正確答案的 query 集合），跑 regression test

---

## 8. 測試策略

### 8.1 Golden query set

建立 `tests/kb_retrieval_golden.json`：

```json
[
  {
    "kb_name": "正崴通訊錄",
    "query": "鍾漢成 分機?",
    "expected_chunk_ids_must_contain": ["<富東_chunk_id>", "<香港_chunk_id>"],
    "expected_min_score": 0.8,
    "notes": "鍾漢成 在富東 30131 + 香港 852-2628-1066"
  }
]
```

跑 script `node kb_test/regression.js` 比對實際結果。

### 8.2 Phase 結束前的驗收 checklist

每個 Phase 結束：
- [ ] 所有 golden queries pass
- [ ] 既有功能（chat / search / external api）無 regression
- [ ] p95 latency ≤ 之前的 1.2×（Phase 1）or 顯著下降（Phase 2+）
- [ ] Orphan 數 = 0
- [ ] Admin UI 功能全 work

---

## 9. 未來方向（本次不做，記錄備忘）

| 項目 | 何時考慮 | 預期收益 |
|------|---------|---------|
| Binary quantization | chunks > 1M 時 | 儲存省 32x |
| HyDE query transformation | 精度仍不足時 | +5-10% |
| Multi-query expansion | 同上 | +5-10% |
| Reciprocal Rank Fusion (RRF) | 取代 weighted sum | +2-5% 更穩健 |
| Query caching (Redis) | 重複 query 多時 | latency -80% for cached |
| Async rerank | rerank 成瓶頸時 | latency -30% |
| Custom rerank model | Cohere 不夠好時 | +5-10% |
| DBMS_VECTOR_CHAIN | DB 端 pipeline 時 | 資料不出 DB |
| Graph-augmented RAG | 大型企業知識圖時 | 關係推理 |

---

## 10. 決策紀錄（歷史追溯）

| 日期 | 決策 | 理由 |
|------|------|------|
| 2026-04-19 | 採 WORLD_LEXER + ACCUM + fuzzy OFF | 使用者中英混用，ACCUM 最自然，fuzzy 誤召率高 |
| 2026-04-19 | 強制統一 768 dim + HNSW | Oracle 23 AI vector index 要求 fixed dim；Matryoshka 讓 768 precision 損失 < 2%；HNSW 速度收益 50-100× |
| 2026-04-19 | retrieval_config 存 KB row JSON | 簡單、不用多表 |
| 2026-04-19 | 舊欄位保留向後相容 | 低成本 |
| 2026-04-19 | Orphan cleanup 三層保護（FK / code / cron） | DB 層保證 + code 冗餘 + cron 兜底 |
| 2026-04-19 | Multi-vector 納入 Phase 3 | +15-25% 結構化文件精度，一次到位 |

---

## 11. 參考資料

- Oracle 23 AI Vector Search Guide: https://docs.oracle.com/en/database/oracle/oracle-database/23/vecse/
- Oracle Text CONTAINS Reference: https://docs.oracle.com/en/database/oracle/oracle-database/23/ccref/
- HNSW paper: https://arxiv.org/abs/1603.09320
- Gemini embedding Matryoshka: https://ai.google.dev/gemini-api/docs/embeddings
- Cohere rerank API: https://docs.cohere.com/reference/rerank
- 本次前序問題診斷: [docs/kb-performance-analysis-2026-04-18.md](./kb-performance-analysis-2026-04-18.md)
