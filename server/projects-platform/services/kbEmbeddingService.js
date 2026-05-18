/**
 * KB Embedding Service — Phase 2 Sprint J
 *
 * 對應 spec §7.9.3(multi-vector / title boost)
 *
 * 三層 embedding(spec §7.9.3):
 *   1. content embedding(主要召回信號)
 *   2. title embedding(短語精準召回)
 *   3. (P3 可加 question-rewrite embedding 提升 reformulation)
 *
 * 失敗 graceful:
 *   - 缺 LLM env → skip,標 embedding_model='SKIPPED'
 *   - 個別 chunk fail → log warn,繼續下一個(不擋整批)
 *
 * 限速:
 *   - 走 projects-platform 自己的 llmQueue token bucket
 */

const { makeLogger } = require('./logger');
const log = makeLogger('kbEmbeddingService');

const EMBED_MODEL  = process.env.PROJECTS_KB_EMBED_MODEL  || process.env.KB_EMBEDDING_MODEL || 'gemini-embedding-001';
const EMBED_DIMS   = Number(process.env.PROJECTS_KB_EMBED_DIMS) || 768;
const TITLE_MAX    = 120;     // chunk title 最長字數
const BATCH_SIZE   = 8;       // 一次處理幾個 chunk(p-limit 並行)

/**
 * 算 embedding 並寫進 project_kb_chunks
 *
 * @param {object} db
 * @param {object} input
 * @param {number} input.chunkId       — 必填 / 若給 chunk row 直接用 row 模式
 * @param {object} [input.chunk]       — row(可 inline)
 * @param {string} [input.content]
 * @param {string} [input.title]
 * @returns {Promise<{ ok: boolean, dims?: number, model?: string, error?: string }>}
 */
async function embedChunk(db, { chunkId, chunk, content, title }) {
  let row = chunk;
  if (!row && chunkId) {
    row = await db.prepare(
      `SELECT id, content, title, kind FROM project_kb_chunks WHERE id = ?`,
    ).get(chunkId).catch(() => null);
  }
  if (!row) return { ok: false, error: 'chunk not found' };

  const text  = String(content || row.content || '').slice(0, 24_000);
  const ttl   = String(title   || row.title   || _deriveTitle(text, row.kind)).slice(0, TITLE_MAX);
  if (!text.trim()) return { ok: false, error: 'empty content' };

  let contentVec, titleVec;
  try {
    const { embedContent } = require('../../services/geminiClient');
    contentVec = await embedContent(text, { model: EMBED_MODEL, dims: EMBED_DIMS });
  } catch (e) {
    log.warn(`embed content chunk=${row.id} failed: ${e.message}`);
    return { ok: false, error: `embed_content: ${e.message}` };
  }
  try {
    if (ttl.trim()) {
      const { embedContent } = require('../../services/geminiClient');
      titleVec = await embedContent(ttl, { model: EMBED_MODEL, dims: EMBED_DIMS });
    }
  } catch (e) {
    log.warn(`embed title chunk=${row.id} failed: ${e.message}`);
    // title 失敗只 log,不阻擋 content 寫入
  }

  try {
    if (titleVec) {
      await db.prepare(`
        UPDATE project_kb_chunks
           SET embedding       = TO_VECTOR(?),
               title_embedding = TO_VECTOR(?),
               title           = ?,
               embedding_model = ?,
               embedded_at     = SYSTIMESTAMP,
               updated_at      = SYSTIMESTAMP
         WHERE id = ?
      `).run(JSON.stringify(contentVec), JSON.stringify(titleVec), ttl, EMBED_MODEL, row.id);
    } else {
      await db.prepare(`
        UPDATE project_kb_chunks
           SET embedding       = TO_VECTOR(?),
               title           = ?,
               embedding_model = ?,
               embedded_at     = SYSTIMESTAMP,
               updated_at      = SYSTIMESTAMP
         WHERE id = ?
      `).run(JSON.stringify(contentVec), ttl, EMBED_MODEL, row.id);
    }
  } catch (e) {
    log.warn(`save embedding chunk=${row.id} failed: ${e.message}`);
    return { ok: false, error: `save: ${e.message}` };
  }

  return { ok: true, dims: contentVec.length, model: EMBED_MODEL, has_title: !!titleVec };
}

/**
 * 批次 embed 一個 project 的所有未 embed chunks
 *
 * @param {object} opts
 * @param {number} opts.projectId
 * @param {boolean} [opts.sedimentOnly]  — true:只算 is_sediment=1
 * @param {boolean} [opts.force]          — true:重新算已 embed 的
 * @param {number} [opts.limit]           — 一次最多算幾個(預設 200)
 */
async function embedProjectChunks(db, { projectId, sedimentOnly = false, force = false, limit = 200 } = {}) {
  if (!projectId) throw new Error('projectId required');

  const wh = ['project_id = ?'];
  const params = [projectId];
  if (sedimentOnly) {
    wh.push('is_sediment = 1');
  }
  if (!force) {
    wh.push('embedded_at IS NULL');
  }
  const rows = await db.prepare(`
    SELECT id, content, title, kind FROM project_kb_chunks
     WHERE ${wh.join(' AND ')}
     ORDER BY is_sediment ASC, id DESC
     FETCH FIRST ${Math.min(limit, 500)} ROWS ONLY
  `).all(...params).catch(() => []);

  if (rows.length === 0) {
    return { embedded: 0, skipped: 0, errors: [], total: 0 };
  }

  let embedded = 0;
  let skipped = 0;
  const errors = [];
  const llmQueue = require('./llmQueue');

  // p-limit 並行(8 個一波)
  const { default: pLimit } = await import('p-limit');
  const limiter = pLimit(BATCH_SIZE);

  await Promise.all(rows.map((row) => limiter(async () => {
    try {
      const r = await llmQueue.withLLM(
        () => embedChunk(db, { chunk: row }),
        { label: 'kb_embed_chunk', timeoutMs: 30_000 },
      );
      if (r.ok) embedded++;
      else { skipped++; errors.push({ id: row.id, error: r.error }); }
    } catch (e) {
      skipped++;
      errors.push({ id: row.id, error: e.message });
    }
  })));

  log.log(`embedded project=${projectId} sediment=${sedimentOnly} embedded=${embedded} skipped=${skipped} errors=${errors.length}`);
  return { embedded, skipped, errors: errors.slice(0, 20), total: rows.length, model: EMBED_MODEL };
}

/**
 * 從 content 推 chunk title(找第一行 / 截首句)
 */
function _deriveTitle(content, kind) {
  if (!content) return '';
  const s = String(content).replace(/\r\n/g, '\n').trim();
  // 第一行(若 ≤ TITLE_MAX 直接用)
  const firstLine = s.split('\n')[0].trim();
  if (firstLine && firstLine.length <= TITLE_MAX) return firstLine;
  // 否則用首 80 字 + 加前綴
  const prefix = kind ? `[${kind}] ` : '';
  return prefix + s.slice(0, TITLE_MAX - prefix.length);
}

module.exports = {
  embedChunk,
  embedProjectChunks,
  EMBED_MODEL,
  EMBED_DIMS,
};
