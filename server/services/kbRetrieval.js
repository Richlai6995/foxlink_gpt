'use strict';
/**
 * 統一 KB 檢索 service（v2 Phase 1）
 *
 * 對外：retrieveKbChunks(db, opts) → { results, stats }
 *
 * 職責：
 *   1. 讀 config（kb.retrieval_config > system_settings.kb_retrieval_defaults > hardcoded）
 *   2. Vector search + Fulltext search（依 backend 決定）
 *   3. Score fusion（weighted / rrf）
 *   4. Rerank（若 kb.rerank_model 設定且有 creds）
 *   5. Filter threshold + topK + log kb_retrieval_tests
 *
 * Phase 1: backend = 'like'（保留現有 tokenized-LIKE 邏輯）
 * Phase 2: 加 backend = 'oracle_text'（CONTAINS + SCORE + HNSW）
 * Phase 3: 加 multi-vector + synonym
 */

const { embedText, toVectorStr } = require('./kbEmbedding');

// ─── Title extraction（Multi-vector Phase 3c）─────────────────────────────────
/**
 * 從 chunk content 抽出 title（heading）。
 * 命中一種就回傳 { title }，不然回 null（該 chunk 不建 title_embedding）。
 * 範例命中：
 *   - `[工作表: 香港]\n...`           → title = `[工作表: 香港]`
 *   - `# 章節標題\n...`                → title = `章節標題`
 *   - `【Gemini Pro】...`              → title = `【Gemini Pro】`
 *   - 前 80 字內的單行短句              → title = 該行
 */
function extractTitle(content) {
  if (!content) return null;
  const firstLine = String(content).split('\n')[0].trim();
  if (!firstLine) return null;
  // [工作表: XXX]
  if (/^\[工作表:\s*[^\]]+\]$/.test(firstLine)) return firstLine;
  // Markdown heading
  const mdMatch = firstLine.match(/^#{1,6}\s+(.+)$/);
  if (mdMatch) return mdMatch[1].trim();
  // 【標題】
  if (/^【[^】]{1,60}】/.test(firstLine)) return firstLine;
  // 短單行（可能是 heading） — 至少有第二行（避免把單行 chunk 整個當 title）
  const idxNl = content.indexOf('\n');
  if (idxNl > 0 && firstLine.length <= 80) return firstLine;
  return null;
}


// ─── Hardcoded fallback defaults（最後一道防線）─────────────────────────────────
const HARDCODED_DEFAULTS = {
  backend:             'like',
  use_hybrid_sql:      false,
  vector_weight:       0.4,
  fulltext_weight:     0.6,
  match_boost:         0.1,
  title_weight:        0.3,
  body_weight:         0.7,
  fulltext_query_op:   'accum',
  fuzzy:               false,
  synonym_thesaurus:   null,
  use_proximity:       false,
  proximity_distance:  10,
  // 以下兩者於 _vectorSearch / _fulltextSearch* 以 app-level 預篩(fusion 前),
  // 由各 KB 可透過 retrieval_config 覆寫。Phase 1-3c 架構原本就預留,但實作未 wire up。
  min_ft_score:        0.1,   // fulltext:ratio vs top hit(0.1 = 至少是當下最高分的 10%)
  vec_cutoff:          0.5,   // vector:cosine similarity 下限(0-1,0=不濾)
  fusion_method:       'weighted', // weighted | rrf
  rrf_k:               60,
  token_stopwords:     ['分機','地址','電話','傳真','資料','哪些','每個','我要','你要','所有','幫我','請問','告訴','是否','可以','什麼','怎麼'],
  default_top_k_fetch: 20,
  default_top_k_return: 5,
  default_score_threshold: 0,
  debug:               false,
  use_multi_vector:    false,  // Phase 3c: 啟用 title_embedding 加權
};

// system_settings.kb_retrieval_defaults 快取（避免每次 retrieval 都讀 DB）
let _systemDefaultsCache = null;
let _systemDefaultsCacheAt = 0;
const SYSTEM_CACHE_TTL_MS = 60 * 1000; // 1 min

async function _getSystemDefaults(db) {
  const now = Date.now();
  if (_systemDefaultsCache && (now - _systemDefaultsCacheAt) < SYSTEM_CACHE_TTL_MS) {
    return _systemDefaultsCache;
  }
  try {
    const row = await db.prepare(
      `SELECT value FROM system_settings WHERE key='kb_retrieval_defaults'`
    ).get();
    const parsed = row?.value ? JSON.parse(row.value) : {};
    _systemDefaultsCache = parsed;
    _systemDefaultsCacheAt = now;
    return parsed;
  } catch (e) {
    console.warn('[KbRetrieval] load system defaults failed:', e.message);
    return {};
  }
}

function invalidateSystemDefaultsCache() {
  _systemDefaultsCache = null;
  _systemDefaultsCacheAt = 0;
}

async function resolveConfig(db, kb) {
  const sysDefaults = await _getSystemDefaults(db);
  let kbConfig = {};
  if (kb?.retrieval_config) {
    try {
      kbConfig = typeof kb.retrieval_config === 'string'
        ? JSON.parse(kb.retrieval_config)
        : kb.retrieval_config;
    } catch (e) {
      console.warn('[KbRetrieval] invalid kb.retrieval_config for kb', kb?.id, ':', e.message);
    }
  }
  return { ...HARDCODED_DEFAULTS, ...sysDefaults, ...kbConfig };
}

// ─── Token 萃取（LIKE backend 用）─────────────────────────────────────────────

function extractTokens(query, stopwords) {
  const cjk3 = query.match(/[\u4e00-\u9fa5]{3,6}/g) || [];
  const cjk2 = query.match(/[\u4e00-\u9fa5]{2}/g) || [];
  const latin = query.match(/[A-Za-z0-9][A-Za-z0-9_.-]+/g) || [];
  let tokens = [...cjk3, ...latin];
  if (tokens.filter((t) => /[\u4e00-\u9fa5]/.test(t)).length === 0) {
    // 沒 3+ 字 CJK token → fallback 2 字
    tokens = [...cjk2, ...latin];
  }
  const stopSet = new Set((stopwords || []).map((s) => s.trim()).filter(Boolean));
  tokens = tokens.filter((t) => t.length >= 2 && !stopSet.has(t));
  if (tokens.length === 0 && query.trim()) tokens.push(query.trim());
  return tokens.slice(0, 8);
}

// ─── Backend: LIKE（Phase 1 主力）──────────────────────────────────────────────

/**
 * @returns {Promise<{ rows: Array, preFilter: number, postFilter: number, cutoff: number }>}
 */
async function _vectorSearch(db, kb, query, fetchK, cfg) {
  const qEmb = await embedText(query, { dims: kb.embedding_dims || 768 });
  const qVecStr = toVectorStr(qEmb);
  // cosine similarity 預篩閾值(0-1);0 或未設 = 不濾
  const vecCutoff = Number(cfg.vec_cutoff) || 0;

  const applyCutoff = (mapped) => {
    const preFilter = mapped.length;
    const filtered = vecCutoff > 0 ? mapped.filter((r) => r.score >= vecCutoff) : mapped;
    return { rows: filtered, preFilter, postFilter: filtered.length, cutoff: vecCutoff };
  };

  // Multi-vector: 若 KB 啟用且 chunks 有 title_embedding,走加權 title+body 公式
  if (cfg.use_multi_vector) {
    const tW = Number(cfg.title_weight) || 0.3;
    const bW = Number(cfg.body_weight)  || 0.7;
    const rows = await db.prepare(`
      SELECT c.id, c.doc_id, c.chunk_type, c.position, c.content, c.parent_content,
             d.filename,
             (CASE WHEN c.title_embedding IS NULL
               THEN VECTOR_DISTANCE(c.embedding, TO_VECTOR(?), COSINE)
               ELSE ? * VECTOR_DISTANCE(c.title_embedding, TO_VECTOR(?), COSINE)
                  + ? * VECTOR_DISTANCE(c.embedding,       TO_VECTOR(?), COSINE)
             END) AS vector_score
      FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id
      WHERE c.kb_id=? AND c.chunk_type != 'parent' AND c.archived_at IS NULL
      ORDER BY vector_score ASC
      FETCH FIRST ? ROWS ONLY
    `).all(qVecStr, tW, qVecStr, bW, qVecStr, kb.id, fetchK);
    return applyCutoff(rows.map((r) => ({
      ...r,
      score:       1 - (r.vector_score || 0),
      match_type:  'vector-mv',
    })));
  }

  const rows = await db.prepare(`
    SELECT c.id, c.doc_id, c.chunk_type, c.position, c.content, c.parent_content,
           d.filename,
           VECTOR_DISTANCE(c.embedding, TO_VECTOR(?), COSINE) AS vector_score
    FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id
    WHERE c.kb_id=? AND c.chunk_type != 'parent' AND c.archived_at IS NULL
    ORDER BY vector_score ASC
    FETCH FIRST ? ROWS ONLY
  `).all(qVecStr, kb.id, fetchK);
  return applyCutoff(rows.map((r) => ({
    ...r,
    score:       1 - (r.vector_score || 0),
    match_type:  'vector',
  })));
}

// ─── Backend: Oracle Text CONTAINS + SCORE (Phase 2 主力) ─────────────────────

/**
 * Convert tokens → Oracle Text query string.
 * e.g. tokens=[鍾漢成, 分機] op=accum → "{鍾漢成} ACCUM {分機}"
 * Fuzzy 前綴 `?` 可選；synonym 以 SYN(term, thesaurus) 包裝。
 */
function _buildOracleTextQuery(tokens, cfg) {
  const op = (cfg.fulltext_query_op || 'accum').toUpperCase();
  const validOp = ['ACCUM', 'AND', 'OR'].includes(op) ? op : 'ACCUM';
  const parts = tokens.map((t) => {
    const safe = String(t).replace(/[{}]/g, '');
    let tok = `{${safe}}`;
    if (cfg.fuzzy) tok = `?${tok}`;
    return tok;
  });
  if (cfg.use_proximity && parts.length >= 2) {
    const dist = Number(cfg.proximity_distance) || 10;
    const bare = tokens.map((t) => String(t).replace(/[{}]/g, ''));
    return `NEAR((${bare.slice(0, 2).join(', ')}), ${dist})`;
  }
  return parts.join(` ${validOp} `);
}

async function _fulltextSearchOracleText(db, kb, query, topK, cfg) {
  // 先 phrase-level 同義詞展開（支援多字 phrase 如 "Carson Chung"），再 tokenize
  let effectiveQuery = query;
  let synonymsApplied = [];
  if (cfg.synonym_thesaurus) {
    try {
      const { expandQuery } = require('./kbSynonyms');
      const { expanded, added } = await expandQuery(db, cfg.synonym_thesaurus, query);
      effectiveQuery = expanded;
      synonymsApplied = added;
    } catch (e) {
      console.warn('[kbRetrieval] synonym expand failed:', e.message);
    }
  }

  const tokens = extractTokens(effectiveQuery, cfg.token_stopwords);
  if (tokens.length === 0) return { rows: [], tokens: [], synonymsApplied, effectiveQuery };

  const ctxQuery = _buildOracleTextQuery(tokens, cfg);
  try {
    const rows = await db.prepare(`
      SELECT c.id, c.doc_id, c.chunk_type, c.position, c.content, c.parent_content,
             d.filename,
             SCORE(1) AS ft_raw_score
      FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id
      WHERE c.kb_id=? AND c.chunk_type != 'parent' AND c.archived_at IS NULL
        AND CONTAINS(c.content, ?, 1) > 0
      ORDER BY SCORE(1) DESC
      FETCH FIRST ? ROWS ONLY
    `).all(kb.id, ctxQuery, topK * 2);
    // SCORE() 範圍 0-100;hit_score 傳原始值給 fusion,同時套 min_ft_score 相對預篩
    const allMapped = rows.map((r) => ({ ...r, hit_score: Number(r.FT_RAW_SCORE || r.ft_raw_score || 0) }));
    const minRatio = Number(cfg.min_ft_score) || 0;
    const maxRaw = Math.max(1, ...allMapped.map((r) => r.hit_score));
    const filtered = minRatio > 0
      ? allMapped.filter((r) => (r.hit_score / maxRaw) >= minRatio)
      : allMapped;
    return {
      rows: filtered,
      tokens, ctxQuery, synonymsApplied, effectiveQuery,
      preFilter: allMapped.length,
      postFilter: filtered.length,
      minRatio,
    };
  } catch (e) {
    // ORA-20000 (index not built), ORA-29800, ORA-29902 等 Oracle Text 錯誤 → 透傳給上層
    throw new Error(`oracle_text search failed: ${e.message}`);
  }
}

async function _fulltextSearchLike(db, kb, query, topK, cfg) {
  const tokens = extractTokens(query, cfg.token_stopwords);
  if (tokens.length === 0) return { rows: [], tokens: [] };

  const caseExprs = tokens.map((t) => {
    const w = Math.max(1, t.length * t.length);
    return `CASE WHEN UPPER(c.content) LIKE UPPER(?) THEN ${w} ELSE 0 END`;
  });
  const hitScoreExpr = caseExprs.join(' + ');
  const likeClauses = tokens.map(() => 'UPPER(c.content) LIKE UPPER(?)').join(' OR ');
  const likeParams = tokens.map((t) => `%${t.replace(/[%_]/g, '\\$&')}%`);
  const rows = await db.prepare(`
    SELECT c.id, c.doc_id, c.chunk_type, c.position, c.content, c.parent_content,
           d.filename,
           ${hitScoreExpr} AS hit_score
    FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id
    WHERE c.kb_id=? AND c.chunk_type != 'parent' AND c.archived_at IS NULL AND (${likeClauses})
    ORDER BY hit_score DESC
    FETCH FIRST ? ROWS ONLY
  `).all(...likeParams, kb.id, ...likeParams, topK * 2);
  // min_ft_score 相對預篩:過濾掉「遠低於 top hit」的 chunk(與 oracle_text 同語意)
  const mapped = rows.map((r) => ({ ...r, hit_score: Number(r.HIT_SCORE || r.hit_score || 0) }));
  const minRatio = Number(cfg.min_ft_score) || 0;
  const maxRaw = Math.max(1, ...mapped.map((r) => r.hit_score));
  const filtered = minRatio > 0
    ? mapped.filter((r) => (r.hit_score / maxRaw) >= minRatio)
    : mapped;
  return {
    rows: filtered, tokens,
    preFilter: mapped.length,
    postFilter: filtered.length,
    minRatio,
  };
}

// ─── Score fusion ─────────────────────────────────────────────────────────────

function _fuseWeighted(vectorRows, ftRows, cfg) {
  const results = [...vectorRows];
  const actualMaxHit = Math.max(1, ...ftRows.map((r) => Number(r.hit_score || r.HIT_SCORE || 0)));
  const ftScore = (r) => 0.5 + 0.5 * ((Number(r.hit_score || r.HIT_SCORE || 0)) / actualMaxHit);

  const vecIds = new Set(results.map((r) => r.id));
  for (const r of ftRows) {
    const fts = ftScore(r);
    if (vecIds.has(r.id)) {
      const ex = results.find((x) => x.id === r.id);
      if (ex) {
        ex.score = cfg.vector_weight * ex.score + cfg.fulltext_weight * fts + cfg.match_boost;
        ex.match_type = 'hybrid';
      }
    } else {
      results.push({ ...r, score: fts, match_type: 'fulltext' });
    }
  }
  return results;
}

function _fuseRRF(vectorRows, ftRows, cfg) {
  // Reciprocal Rank Fusion: rrf_score = sum_i(1 / (k + rank_i))
  const k = Number(cfg.rrf_k || 60);
  const score = new Map(); // id → rrf_score
  const row   = new Map();

  vectorRows.forEach((r, i) => {
    const s = 1 / (k + i + 1);
    score.set(r.id, (score.get(r.id) || 0) + s);
    row.set(r.id, { ...r, match_type: 'vector' });
  });
  ftRows.forEach((r, i) => {
    const s = 1 / (k + i + 1);
    const prev = score.get(r.id);
    score.set(r.id, (prev || 0) + s);
    if (prev !== undefined) {
      const existing = row.get(r.id);
      if (existing) existing.match_type = 'hybrid';
    } else {
      row.set(r.id, { ...r, match_type: 'fulltext' });
    }
  });

  const results = [];
  for (const [id, s] of score.entries()) {
    results.push({ ...row.get(id), score: s });
  }
  return results;
}

// ─── Rerank ───────────────────────────────────────────────────────────────────

async function _rerank(db, kb, query, results, topK, debug) {
  try {
    const rerankKey = kb.rerank_model;
    if (rerankKey === 'disabled') return { results, rerankApplied: false, reason: 'disabled' };
    const rerankRow = rerankKey
      ? await db.prepare(`SELECT api_model, extra_config_enc FROM llm_models WHERE key=? AND model_role='rerank' AND is_active=1`).get(rerankKey)
      : await db.prepare(`SELECT api_model, extra_config_enc FROM llm_models WHERE model_role='rerank' AND is_active=1 AND ROWNUM=1`).get();
    if (!rerankRow?.extra_config_enc || results.length <= 1) return { results, rerankApplied: false };

    const { decryptKey } = require('./llmKeyService');
    const creds = JSON.parse(decryptKey(rerankRow.extra_config_enc));
    const { rerankOci } = require('./ociAi');
    const fetchForRerank = results.slice(0, Math.min(results.length, topK * 3));
    const docs = fetchForRerank.map((r) => r.content || '');
    const resp = await rerankOci(creds, rerankRow.api_model, query, docs, fetchForRerank.length);
    const ranked = resp?.results || resp?.rankings || [];
    if (ranked.length === 0) return { results, rerankApplied: false };

    const reranked = ranked.map((item) => {
      const idx = item.index ?? item.resultIndex ?? 0;
      const orig = fetchForRerank[idx];
      return { ...orig, rerank_score: item.relevanceScore ?? item.score ?? 0 };
    }).sort((a, b) => b.rerank_score - a.rerank_score);

    return { results: reranked, rerankApplied: true, model: rerankRow.api_model };
  } catch (e) {
    if (debug) console.warn('[KbRetrieval] Rerank error:', e.message);
    return { results, rerankApplied: false, error: e.message };
  }
}

// ─── Retrieval 主函式 ─────────────────────────────────────────────────────────

/**
 * @param {object} db   Oracle DB wrapper (same as rest of app)
 * @param {object} opts
 * @param {object} opts.kb             kb row
 * @param {string} opts.query          user query
 * @param {number} [opts.topK]         override topK
 * @param {number} [opts.scoreThreshold]
 * @param {string} [opts.userId]       for retrieval_tests log
 * @param {string} [opts.sessionId]    for retrieval_tests log
 * @param {string} [opts.source='api'] 'chat' | 'search' | 'webex' | 'external_api'
 * @param {boolean}[opts.debug]        force debug stats regardless of kb config
 * @returns {{results: Array, stats: Object, rerankApplied: boolean}}
 */
async function retrieveKbChunks(db, opts = {}) {
  const t0 = Date.now();
  const { kb, query, source = 'api', userId, sessionId } = opts;
  if (!kb || !query?.trim()) {
    return { results: [], stats: { error: 'missing kb or query', elapsed_ms: 0 }, rerankApplied: false };
  }

  const cfg    = await resolveConfig(db, kb);
  const debug  = opts.debug === true || cfg.debug === true;
  const mode   = kb.retrieval_mode || 'hybrid';
  const topK   = Math.min(Number(opts.topK || kb.top_k_return) || cfg.default_top_k_return || 5, 20);
  const fetchK = Math.min(topK * 3, Number(cfg.default_top_k_fetch) || 20);
  const thresh = (opts.scoreThreshold != null ? Number(opts.scoreThreshold)
                  : Number(kb.score_threshold)) || cfg.default_score_threshold || 0;

  let vectorRows = [];
  let ftRows = [];
  let tokens = [];
  // 預篩統計 — 給 admin 調校介面(每階段「撈幾筆 / 過幾筆 / cutoff」)
  let vecFilterStats = { preFilter: 0, postFilter: 0, cutoff: 0 };
  let ftFilterStats  = { preFilter: 0, postFilter: 0, minRatio: 0 };

  if (mode === 'vector' || mode === 'hybrid') {
    try {
      const vr = await _vectorSearch(db, kb, query, fetchK, cfg);
      vectorRows = vr.rows;
      vecFilterStats = { preFilter: vr.preFilter, postFilter: vr.postFilter, cutoff: vr.cutoff };
    }
    catch (e) {
      console.error('[KbRetrieval] vector search error:', e.message);
    }
  }

  let backendUsed = cfg.backend || 'like';
  let ctxQueryUsed = null;
  let synonymsAppliedUsed = [];
  let effectiveQueryUsed = query;
  if (mode === 'fulltext' || mode === 'hybrid') {
    if (cfg.backend === 'oracle_text') {
      try {
        const ft = await _fulltextSearchOracleText(db, kb, query, topK, cfg);
        ftRows = ft.rows;
        tokens = ft.tokens;
        ctxQueryUsed = ft.ctxQuery;
        synonymsAppliedUsed = ft.synonymsApplied || [];
        effectiveQueryUsed = ft.effectiveQuery || query;
        ftFilterStats = { preFilter: ft.preFilter, postFilter: ft.postFilter, minRatio: ft.minRatio };
      } catch (e) {
        console.warn('[KbRetrieval] oracle_text failed, fallback to LIKE:', e.message);
        backendUsed = 'like (fallback)';
        const ft = await _fulltextSearchLike(db, kb, query, topK, cfg);
        ftRows = ft.rows;
        tokens = ft.tokens;
        ftFilterStats = { preFilter: ft.preFilter, postFilter: ft.postFilter, minRatio: ft.minRatio };
      }
    } else {
      const ft = await _fulltextSearchLike(db, kb, query, topK, cfg);
      ftRows = ft.rows;
      tokens = ft.tokens;
      ftFilterStats = { preFilter: ft.preFilter, postFilter: ft.postFilter, minRatio: ft.minRatio };
    }
  }

  let fused;
  if (mode === 'vector') fused = vectorRows;
  else if (mode === 'fulltext') {
    const actualMaxHit = Math.max(1, ...ftRows.map((r) => Number(r.hit_score || r.HIT_SCORE || 0)));
    fused = ftRows.map((r) => ({ ...r, score: 0.5 + 0.5 * ((Number(r.hit_score || r.HIT_SCORE || 0)) / actualMaxHit), match_type: 'fulltext' }));
  } else {
    // hybrid
    fused = cfg.fusion_method === 'rrf'
      ? _fuseRRF(vectorRows, ftRows, cfg)
      : _fuseWeighted(vectorRows, ftRows, cfg);
  }

  let filtered = fused
    .filter((r) => r.score >= thresh)
    .sort((a, b) => b.score - a.score);

  const rerank = await _rerank(db, kb, query, filtered, topK, debug);
  let results = rerank.results.slice(0, topK);

  // Log to kb_retrieval_tests（best-effort）
  try {
    const uuid = require('crypto').randomUUID();
    await db.prepare(`
      INSERT INTO kb_retrieval_tests (id, kb_id, user_id, query_text, retrieval_mode, top_k, elapsed_ms, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuid, kb.id, userId || null, (query || '').slice(0, 500), mode, topK, Date.now() - t0, source);
  } catch (_) {}

  const stats = {
    backend:         backendUsed,
    mode,
    tokens_extracted: tokens,
    ctx_query:       ctxQueryUsed,
    synonym_thesaurus: cfg.synonym_thesaurus || null,
    synonyms_applied: synonymsAppliedUsed,
    effective_query: effectiveQueryUsed,
    fusion_method:   cfg.fusion_method,
    vec_fetched:     vectorRows.length,
    ft_fetched:      ftRows.length,
    vec_filter:      vecFilterStats,  // { preFilter, postFilter, cutoff }
    ft_filter:       ftFilterStats,   // { preFilter, postFilter, minRatio }
    fused:           fused.length,
    after_threshold: filtered.length,
    rerank_applied:  rerank.rerankApplied,
    rerank_model:    rerank.model,
    final:           results.length,
    elapsed_ms:      Date.now() - t0,
  };

  if (debug) {
    const slim = (r) => ({
      id: r.id, filename: r.filename, score: r.score, match_type: r.match_type,
      content: (r.content || '').slice(0, 400),
    });
    stats.stages = {
      vector:   vectorRows.slice(0, 20).map(slim),
      fulltext: ftRows.slice(0, 20).map(slim),
      fused:    fused.slice(0, 20).map(slim),
      rerank:   rerank.results.slice(0, 20).map((r) => ({ ...slim(r), rerank_score: r.rerank_score })),
    };
    stats.resolved_config = cfg;
  }

  return { results, stats, rerankApplied: rerank.rerankApplied };
}

module.exports = {
  retrieveKbChunks,
  resolveConfig,
  extractTokens,
  extractTitle,
  invalidateSystemDefaultsCache,
  HARDCODED_DEFAULTS,
};
