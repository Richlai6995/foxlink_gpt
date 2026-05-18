/**
 * KB Pipeline — Live KB chunk 寫入 + 結案 fork → 沉澱 + hybrid search
 *
 * 對應 spec §7 / §8
 *
 * Sprint J 後升級到 production:
 *   - forkToSediment 嚴格 audit trail(project_kb_sediment_audit)
 *   - 不可逆(預設一次性)+ admin override(force=true 重 fork)
 *   - scrub_map_json 記下「Apple→A001 / Tier-A→[PRICE_01]」對應(spec 要求)
 *   - 自動 kick off embedding pipeline(背景非同步,不擋 fork)
 *   - hybrid search:vector cosine + Oracle Text + LIKE fallback
 */

const { makeLogger } = require('./logger');
const log = makeLogger('kbPipeline');

const DEFAULT_TOP_K = 20;

/** 寫一個 Live KB chunk */
async function writeLiveChunk(db, {
  projectId, kind, sourceId, content, title, tags, isConfidential,
}) {
  if (!projectId || !kind || !content) return null;
  try {
    const r = await db.prepare(
      `INSERT INTO project_kb_chunks
         (project_id, kind, source_id, content, title, tags, is_confidential, is_sediment)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      projectId,
      kind,
      sourceId || null,
      String(content).slice(0, 8000),
      title ? String(title).slice(0, 500) : null,
      tags ? JSON.stringify(tags) : null,
      isConfidential ? 1 : 0,
    );
    const id = Number(r.lastInsertRowid);

    // 背景算 embedding(不擋 caller)
    if (process.env.PROJECTS_KB_AUTO_EMBED !== 'false') {
      setImmediate(() => {
        const kbEmbed = require('./kbEmbeddingService');
        const llmQueue = require('./llmQueue');
        llmQueue.withLLM(
          () => kbEmbed.embedChunk(db, { chunkId: id }),
          { label: 'auto_embed_live', timeoutMs: 30_000 },
        ).catch((e) => log.warn(`auto embed live chunk ${id} failed: ${e.message}`));
      });
    }
    return id;
  } catch (e) {
    log.warn(`writeLiveChunk failed: ${e.message}`);
    return null;
  }
}

/**
 * Scrub 機密欄位(規則式 + plugin scrub_rules)
 * 進 sediment KB 前必走
 *
 * 回傳:
 *   - content:scrub 後文字
 *   - scrub_map:{ 'Apple': 'A001', '$3000': 'Tier-?', ... }
 *   - scrubbed:bool
 */
function scrubContent(content, { customerAliases = [], pluginRules = null } = {}) {
  if (!content) return { content, scrub_map: {}, scrubbed: false };
  let s = String(content);
  const map = {};

  // Plugin 提供的 scrub_rules 優先(高精準)
  if (pluginRules && typeof pluginRules === 'object') {
    for (const [k, transform] of Object.entries(pluginRules)) {
      if (typeof transform === 'function') {
        const result = transform(s);
        if (result && typeof result === 'object' && result.replaced) {
          s = result.text;
          Object.assign(map, result.scrub_map || {});
        }
      }
    }
  }

  // 客戶名 alias(預設常見 + customerAliases override)
  const customerNames = ['Apple', 'Sony', 'Samsung', 'Tesla', 'BYD', 'Garmin', '蘋果', '索尼', '三星'].concat(customerAliases || []);
  for (const n of customerNames) {
    if (!n) continue;
    if (s.includes(n)) {
      s = s.split(n).join('A001');
      map[n] = 'A001';
    }
  }
  // 金額 → Tier(粗略 regex)
  s = s.replace(/\$[\d,]+/g, (m) => { map[m] = 'Tier-?'; return 'Tier-?'; });
  s = s.replace(/[\d,]+(?:\.\d+)?\s*(?:USD|TWD|元)/g, (m) => { map[m] = 'Tier-?'; return 'Tier-?'; });
  // 毛利 % → MASKED
  s = s.replace(/(\d+(?:\.\d+)?)%/g, (m) => {
    const n = parseFloat(m);
    if (n >= 5 && n <= 50) { map[m] = 'MASKED%'; return 'MASKED%'; }
    return m;
  });

  return { content: s, scrub_map: map, scrubbed: Object.keys(map).length > 0 };
}

/**
 * 結案 fork(production)— 把 project 所有 Live chunk + 整體 metadata fork 進沉澱 KB
 *
 * @param {object} opts
 * @param {boolean} [opts.force]    — true 才允許 re-fork(預設 false,已 fork 過跳過)
 * @param {number} [opts.actorUserId] — audit 記錄是誰 fork
 * @param {string} [opts.notes]
 */
async function forkToSediment(db, projectId, opts = {}) {
  const startMs = Date.now();
  log.log(`fork to sediment: project ${projectId} force=${!!opts.force}`);

  // 檢查是否已 fork
  const existing = await db.prepare(
    `SELECT COUNT(*) AS C FROM project_kb_chunks WHERE project_id = ? AND is_sediment = 1`,
  ).get(projectId);
  const existingCount = Number(existing?.c ?? existing?.C ?? 0);

  if (existingCount > 0 && !opts.force) {
    log.warn(`project ${projectId} already forked to sediment (${existingCount} chunks), skip`);
    await _audit(db, projectId, 'skip', opts.actorUserId, {
      notes: `already forked (${existingCount} chunks); pass {force:true} to re-fork`,
    });
    return { skipped: true, existing_count: existingCount };
  }

  // Force re-fork:先清掉舊沉澱(audit 留下 action='re_fork')
  if (opts.force && existingCount > 0) {
    await db.prepare(`DELETE FROM project_kb_chunks WHERE project_id = ? AND is_sediment = 1`).run(projectId);
    log.log(`re-fork: deleted ${existingCount} previous sediment chunks`);
  }

  // 拿 project 整體
  const project = await db.prepare(
    `SELECT id, project_code, data_payload, is_confidential, project_type_id
       FROM projects WHERE id = ?`,
  ).get(projectId);
  if (!project) {
    await _audit(db, projectId, 'error', opts.actorUserId, {
      error_log: 'project not found',
    });
    return { error: 'project not found' };
  }

  // 取 plugin scrub_rules(若 plugin 有定義)
  let pluginRules = null;
  let pluginCode  = null;
  try {
    const registry = require('../plugins/registry');
    const typeRow = await db.prepare(
      `SELECT type_code FROM project_types WHERE id = ?`,
    ).get(project.project_type_id).catch(() => null);
    if (typeRow?.type_code) {
      pluginCode = typeRow.type_code;
      const plugin = registry.get(pluginCode);
      pluginRules = plugin?.scrub_rules || null;
    }
  } catch (e) {
    log.warn(`load plugin scrub_rules failed: ${e.message}`);
  }

  // 1. 整體 case chunk
  const payload = (() => { try { return JSON.parse(project.data_payload || '{}'); } catch { return {}; } })();
  const summary = `Project ${project.project_code} · ${payload.title || ''} · 客戶:${payload.customer || ''} · 料號:${payload.partNo || ''} · 數量:${payload.quantity || ''} · 交期:${payload.dueDate || ''}`;
  const sumRes = scrubContent(summary, { pluginRules });

  const accumulatedMap = { ...sumRes.scrub_map };

  await db.prepare(`
    INSERT INTO project_kb_chunks
      (project_id, kind, content, title, is_sediment, scrubbed, scrub_note, scrub_map_json)
    VALUES (?, 'case', ?, ?, 1, ?, ?, ?)
  `).run(
    projectId,
    sumRes.content,
    `Project ${project.project_code} 案例摘要`,
    sumRes.scrubbed ? 1 : 0,
    sumRes.scrubbed ? `客戶 → A001 · 金額 → Tier-?` : '',
    JSON.stringify(sumRes.scrub_map),
  );

  // 2. 把 Live chat / form / task / attach chunk 各取最近 N 個進沉澱(scrub 後)
  const liveChunks = await db.prepare(`
    SELECT id, kind, content, title, source_id FROM project_kb_chunks
     WHERE project_id = ? AND is_sediment = 0
     ORDER BY id DESC FETCH FIRST 500 ROWS ONLY
  `).all(projectId);

  let copied = 0;
  let scrubbed_count = 0;
  const errors = [];

  for (const c of liveChunks) {
    const r = scrubContent(c.content, { pluginRules });
    if (r.scrubbed) {
      scrubbed_count++;
      Object.assign(accumulatedMap, r.scrub_map);
    }
    try {
      await db.prepare(`
        INSERT INTO project_kb_chunks
          (project_id, kind, content, title, is_sediment, scrubbed, sediment_from_chunk_id, scrub_note, scrub_map_json, source_id)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
      `).run(
        projectId, c.kind, r.content, c.title, r.scrubbed ? 1 : 0, Number(c.id),
        r.scrubbed ? '已 scrub 機密欄位' : '', JSON.stringify(r.scrub_map),
        c.source_id || null,
      );
      copied++;
    } catch (e) {
      log.warn(`copy chunk ${c.id}: ${e.message}`);
      errors.push({ chunk_id: c.id, error: e.message });
    }
  }

  const duration = Date.now() - startMs;
  log.log(`sediment fork done: project ${projectId} · ${copied} chunks copied · ${scrubbed_count} scrubbed · ${duration}ms`);

  // 3. Audit
  await _audit(db, projectId, opts.force && existingCount > 0 ? 're_fork' : 'fork', opts.actorUserId, {
    chunks_total:   liveChunks.length,
    chunks_copied:  copied,
    chunks_scrubbed: scrubbed_count,
    scrub_map_json: JSON.stringify(accumulatedMap),
    duration_ms:    duration,
    notes:          `plugin=${pluginCode || 'none'} · errors=${errors.length}`,
    error_log:      errors.length ? JSON.stringify(errors.slice(0, 20)) : null,
  });

  // 4. 背景 kick off embedding(只算沉澱 chunk)
  if (process.env.PROJECTS_KB_AUTO_EMBED !== 'false') {
    setImmediate(async () => {
      try {
        const kbEmbed = require('./kbEmbeddingService');
        const r = await kbEmbed.embedProjectChunks(db, { projectId, sedimentOnly: true });
        log.log(`sediment auto-embed: project=${projectId} embedded=${r.embedded}/${r.total}`);
        await _audit(db, projectId, 'embed', opts.actorUserId, {
          embed_model: r.model,
          embed_count: r.embedded,
          chunks_total: r.total,
          notes: `auto after fork`,
        });
      } catch (e) {
        log.warn(`auto-embed after fork failed: ${e.message}`);
      }
    });
  }

  return {
    copied,
    scrubbed: scrubbed_count,
    errors: errors.slice(0, 20),
    re_fork: !!(opts.force && existingCount > 0),
    duration_ms: duration,
    accumulated_scrub_map: accumulatedMap,
  };
}

async function _audit(db, projectId, action, actorUserId, extra = {}) {
  try {
    await db.prepare(`
      INSERT INTO project_kb_sediment_audit
        (project_id, action, actor_user_id, chunks_total, chunks_copied,
         chunks_scrubbed, scrub_map_json, embed_model, embed_count,
         duration_ms, notes, error_log)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectId,
      action,
      actorUserId || null,
      extra.chunks_total   || 0,
      extra.chunks_copied  || 0,
      extra.chunks_scrubbed || 0,
      extra.scrub_map_json || null,
      extra.embed_model || null,
      extra.embed_count || 0,
      extra.duration_ms || null,
      extra.notes || null,
      extra.error_log || null,
    );
  } catch (e) {
    log.warn(`audit insert failed: ${e.message}`);
  }
}

/** 列 audit log(admin 用 / KB 頁顯示)*/
async function listAuditForProject(db, projectId, { limit = 20 } = {}) {
  return db.prepare(`
    SELECT a.id, a.project_id, a.action, a.actor_user_id, a.chunks_total, a.chunks_copied,
           a.chunks_scrubbed, a.embed_model, a.embed_count, a.duration_ms, a.notes,
           a.created_at, u.username, u.name AS actor_name
      FROM project_kb_sediment_audit a
      LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.project_id = ?
     ORDER BY a.created_at DESC
     FETCH FIRST ${Math.min(limit, 100)} ROWS ONLY
  `).all(projectId).catch(() => []);
}

/**
 * Hybrid search:vector cosine + Oracle Text BM25 + LIKE fallback
 *
 * @param {object} opts
 * @param {boolean} [opts.isSediment]
 * @param {number} [opts.projectId]
 * @param {number} [opts.topK]      — 預設 20
 * @param {string} [opts.mode]      — 'auto' | 'vector' | 'fulltext' | 'like'
 */
async function search(db, query, opts = {}) {
  const { isSediment, projectId, topK = DEFAULT_TOP_K, mode = 'auto' } = opts;

  if (!query || !String(query).trim()) return [];

  // mode='auto':先 hybrid,vector 失敗(無 embedding 或 dim mismatch)→ Oracle Text fallback,還失敗 → LIKE
  if (mode === 'auto' || mode === 'vector') {
    try {
      const vecResults = await _vectorSearch(db, query, { isSediment, projectId, topK });
      if (vecResults.length > 0) {
        // 補 full-text 拉一些 keyword-hit chunk,再 fuse score
        const ftResults = await _fullTextSearch(db, query, { isSediment, projectId, topK }).catch(() => []);
        return _fuseHybrid(vecResults, ftResults, topK);
      }
    } catch (e) {
      log.warn(`vector search fallback: ${e.message}`);
      if (mode === 'vector') throw e;
    }
  }

  if (mode === 'auto' || mode === 'fulltext') {
    try {
      const ftResults = await _fullTextSearch(db, query, { isSediment, projectId, topK });
      if (ftResults.length > 0) return ftResults;
    } catch (e) {
      log.warn(`full-text search fallback: ${e.message}`);
      if (mode === 'fulltext') throw e;
    }
  }

  // LIKE final fallback
  return _likeSearch(db, query, { isSediment, projectId, topK });
}

async function _vectorSearch(db, query, { isSediment, projectId, topK }) {
  const { embedContent } = require('../../services/geminiClient');
  const llmQueue = require('./llmQueue');

  const qVec = await llmQueue.withLLM(
    () => embedContent(query, {
      model: process.env.PROJECTS_KB_EMBED_MODEL || 'gemini-embedding-001',
      dims: 768,
    }),
    { label: 'kb_search_embed', timeoutMs: 20_000 },
  );

  const params = [JSON.stringify(qVec), JSON.stringify(qVec)];
  const wh = ['embedding IS NOT NULL'];
  if (isSediment !== undefined) { wh.push('is_sediment = ?'); params.push(isSediment ? 1 : 0); }
  if (projectId)                 { wh.push('project_id = ?');   params.push(projectId); }

  const rows = await db.prepare(`
    SELECT id, project_id, kind, content, title, is_sediment, scrubbed, scrub_note,
           created_at,
           VECTOR_DISTANCE(embedding, TO_VECTOR(?), COSINE) AS dist,
           CASE WHEN title_embedding IS NOT NULL
                THEN VECTOR_DISTANCE(title_embedding, TO_VECTOR(?), COSINE)
                ELSE NULL END AS title_dist
      FROM project_kb_chunks
     WHERE ${wh.join(' AND ')}
     ORDER BY dist ASC
     FETCH FIRST ${Math.min(topK * 2, 200)} ROWS ONLY
  `).all(...params);

  // Score = 1 - cosine_distance(0~1)+ title boost if matches
  return rows.map((r) => {
    const baseSim = 1 - Number(r.dist || 0);
    const titleSim = r.title_dist != null ? (1 - Number(r.title_dist)) : 0;
    const fusedScore = baseSim * 0.7 + titleSim * 0.3;
    return {
      ...r,
      _score: fusedScore,
      _signal: 'vector',
    };
  }).slice(0, topK);
}

async function _fullTextSearch(db, query, { isSediment, projectId, topK }) {
  // Oracle Text CONTAINS
  const wh = ['CONTAINS(content, ?) > 0'];
  const params = [_buildOracleTextQuery(query)];
  if (isSediment !== undefined) { wh.push('is_sediment = ?'); params.push(isSediment ? 1 : 0); }
  if (projectId)                 { wh.push('project_id = ?');   params.push(projectId); }

  const rows = await db.prepare(`
    SELECT id, project_id, kind, content, title, is_sediment, scrubbed, scrub_note, created_at,
           SCORE(1) AS ft_score
      FROM project_kb_chunks
     WHERE ${wh.join(' AND ')}
     ORDER BY ft_score DESC, created_at DESC
     FETCH FIRST ${Math.min(topK, 100)} ROWS ONLY
  `).all(...params);

  return rows.map((r) => ({
    ...r,
    _score: Math.min(1, Number(r.ft_score || 0) / 100),
    _signal: 'fulltext',
  }));
}

async function _likeSearch(db, query, { isSediment, projectId, topK }) {
  const params = [`%${query}%`];
  const wh = ['UPPER(content) LIKE UPPER(?)'];
  if (isSediment !== undefined) { wh.push('is_sediment = ?'); params.push(isSediment ? 1 : 0); }
  if (projectId)                 { wh.push('project_id = ?');   params.push(projectId); }

  const rows = await db.prepare(`
    SELECT id, project_id, kind, content, title, is_sediment, scrubbed, scrub_note, created_at
      FROM project_kb_chunks
     WHERE ${wh.join(' AND ')}
     ORDER BY created_at DESC
     FETCH FIRST ${Math.min(topK, 100)} ROWS ONLY
  `).all(...params);

  return rows.map((r) => ({ ...r, _score: 0.5, _signal: 'like' }));
}

function _buildOracleTextQuery(q) {
  // 把 user query 拆成 keyword,Oracle Text ABOUT() 對中英都還可以
  // 簡單版:用 AND fuzzy(可調)
  const tokens = String(q).split(/[\s,。?!,?]+/).filter((s) => s && s.length >= 2);
  if (tokens.length === 0) return String(q);
  // ABOUT 對短查詢適合
  return `ABOUT(${tokens.join(' ')})`;
}

function _fuseHybrid(vecResults, ftResults, topK) {
  // 簡易 reciprocal rank fusion
  const merged = new Map();
  vecResults.forEach((r, i) => {
    merged.set(r.id, { ...r, _vec_rank: i + 1, _ft_rank: null });
  });
  ftResults.forEach((r, i) => {
    if (merged.has(r.id)) {
      const ex = merged.get(r.id);
      ex._ft_rank = i + 1;
      ex._signal = 'hybrid';
    } else {
      merged.set(r.id, { ...r, _vec_rank: null, _ft_rank: i + 1, _signal: 'fulltext' });
    }
  });

  const K = 60;
  const fused = [...merged.values()].map((r) => {
    let rrf = 0;
    if (r._vec_rank) rrf += 1 / (K + r._vec_rank);
    if (r._ft_rank)  rrf += 1 / (K + r._ft_rank);
    return { ...r, _rrf: rrf };
  });
  fused.sort((a, b) => b._rrf - a._rrf);
  return fused.slice(0, topK);
}

module.exports = {
  writeLiveChunk,
  scrubContent,
  forkToSediment,
  search,
  listAuditForProject,
};
