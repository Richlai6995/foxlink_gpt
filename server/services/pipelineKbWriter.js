'use strict';

/**
 * Pipeline KB Writer
 *
 * 被 pipelineRunner.js 的 `kb_write` 節點呼叫:把上游 LLM/技能輸出的 JSON
 * (新聞、報告、知識條目)寫入指定 KB,自動 chunk + embed + dedupe。
 *
 * 與 db_write 的差異:
 *   - 權限走「KB 既有共享機制」(getAccessibleKb,owner / share / public),不需要 admin。
 *   - 寫入單位是 kb_documents + kb_chunks,不是任意 table。
 *   - 不需要 column_mapping,改用 fixed schema:title / url / summary / content / source / published_at。
 *   - dedupe 使用 source_url SHA-256 → kb_documents.source_hash UNIQUE (kb_id, source_hash)。
 *
 * Chunking 策略 (mixed,預設):
 *   1. 第 0 chunk = title + summary(快速命中,適合 metadata-style 查詢)
 *   2. 後續 chunks = content 用 KB 預設 chunkDocument 切(細節 RAG)
 *   - 若 summary 為空,只切 content。
 *   - 若 content 短於 600 字符,只放第 0 chunk,跳過 body 切割。
 *
 * 共用介面:
 *   executeKbWrite(db, nodeConfig, sourceText, context)
 *     → { documents_created, chunks_created, skipped_duplicates, errors, dryRun? }
 */

const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const { embedText, toVectorStr } = require('./kbEmbedding');
const { chunkDocument } = require('./kbDocParser');
const { extractJsonRows } = require('./pipelineDbWriter');
// getByJsonPath 在本檔案下方有自己的版本,不 import 避免 redeclare

// ── JSONPath 極簡版(同 pipelineDbWriter)──────────────────────────────────
function getByJsonPath(obj, path) {
  if (!path) return obj;
  let p = path.trim();
  if (p.startsWith('$')) p = p.slice(1);
  if (p.startsWith('.')) p = p.slice(1);
  if (!p) return obj;
  p = p.replace(/\[(\d+|\*)\]/g, '.$1');
  const parts = p.split('.').filter(Boolean);
  let cur = obj;
  for (const part of parts) {
    if (cur == null) return null;
    if (part === '*') return Array.isArray(cur) ? cur : null;
    cur = cur[part];
  }
  return cur;
}

// ── URL 正規化(避免 utm / fragment / trailing slash 漏判同一篇)──────────
function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const u = new URL(rawUrl.trim());
    // 砍 utm_*、fbclid、gclid 等追蹤參數
    const drop = [];
    for (const k of u.searchParams.keys()) {
      if (/^(utm_|fbclid|gclid|mc_|ref_|spm)/i.test(k)) drop.push(k);
    }
    drop.forEach(k => u.searchParams.delete(k));
    u.hash = '';
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    // 不是合法 URL → 直接 lowercase + trim 拿來 hash
    return rawUrl.trim().toLowerCase();
  }
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

// ── KB 權限檢查(與 routes/knowledgeBase.js getAccessibleKb 邏輯對齊)──────
async function getAccessibleKbForWrite(db, kbId, userId, userRole) {
  if (!kbId) return null;
  // admin 直接放行
  if (userRole === 'admin') {
    return await db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(kbId);
  }
  const user = await db.prepare(
    `SELECT role, dept_code, profit_center, org_section, org_group_name, role_id, factory_code
     FROM users WHERE id=?`
  ).get(userId);
  if (!user) return null;

  // owner 或 has kb_access(use 或 edit 都可寫入,語義上是「我有這個 KB 的存取權」)
  const kb = await db.prepare(`
    SELECT kb.* FROM knowledge_bases kb
    WHERE kb.id=?
      AND (
        kb.creator_id=?
        OR kb.is_public=1
        OR EXISTS (
          SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb.id AND (
            (ka.grantee_type='user'             AND ka.grantee_id=TO_CHAR(?))
            OR (ka.grantee_type='role'          AND ka.grantee_id=TO_CHAR(?))
            OR (ka.grantee_type='dept'          AND ka.grantee_id=? AND ? IS NOT NULL)
            OR (ka.grantee_type='profit_center' AND ka.grantee_id=? AND ? IS NOT NULL)
            OR (ka.grantee_type='org_section'   AND ka.grantee_id=? AND ? IS NOT NULL)
            OR (ka.grantee_type='factory'       AND ka.grantee_id=? AND ? IS NOT NULL)
            OR (ka.grantee_type='org_group'     AND ka.grantee_id=? AND ? IS NOT NULL)
          )
        )
      )
  `).get(
    kbId,
    userId,
    userId, user.role_id,
    user.dept_code, user.dept_code,
    user.profit_center, user.profit_center,
    user.org_section, user.org_section,
    user.factory_code, user.factory_code,
    user.org_group_name, user.org_group_name,
  );
  return kb || null;
}

// ── Item 萃取 + 必填驗證 ─────────────────────────────────────────────────────
function extractItem(rawRow, mapping) {
  const m = mapping || {};
  const get = (path) => path ? getByJsonPath(rawRow, path) : null;

  const title    = String(get(m.title_field    || '$.title')    || '').trim();
  const url      = String(get(m.url_field      || '$.url')      || '').trim() || null;
  const summary  = String(get(m.summary_field  || '$.summary')  || '').trim() || null;
  const content  = String(get(m.content_field  || '$.content')  || '').trim() || null;
  const source   = String(get(m.source_field   || '$.source')   || '').trim() || null;
  const publishedAtRaw = get(m.published_at_field || '$.published_at');

  let publishedAt = null;
  if (publishedAtRaw) {
    const s = String(publishedAtRaw).trim();
    // 接受 ISO / YYYY-MM-DD / YYYY/MM/DD,正規化成 'YYYY-MM-DD HH24:MI:SS' 給 TO_TIMESTAMP
    const d = new Date(s.replace(/\//g, '-'));
    if (!isNaN(d.getTime())) {
      const pad = n => String(n).padStart(2, '0');
      publishedAt = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    }
  }

  return { title, url, summary, content, source, publishedAt };
}

// ── 已存在 hash 預先撈一次(per-run 一次 query,避免 N+1)─────────────────
async function loadExistingHashes(db, kbId, hashList) {
  if (!hashList.length) return new Set();
  // Oracle bind var 上限 1000,分批
  const out = new Set();
  for (let i = 0; i < hashList.length; i += 800) {
    const batch = hashList.slice(i, i + 800);
    const placeholders = batch.map(() => '?').join(',');
    const rows = await db.prepare(
      `SELECT source_hash FROM kb_documents WHERE kb_id=? AND source_hash IN (${placeholders})`
    ).all(kbId, ...batch);
    for (const r of rows || []) {
      const h = r.source_hash || r.SOURCE_HASH;
      if (h) out.add(h);
    }
  }
  return out;
}

// ── 同 KB 標題 soft match(完全相同 title 視為 dup,免再切 chunk)──────────
async function loadExistingTitles(db, kbId) {
  const rows = await db.prepare(
    `SELECT LOWER(filename) AS t FROM kb_documents WHERE kb_id=?`
  ).all(kbId);
  const set = new Set();
  for (const r of rows || []) {
    const t = (r.t || r.T || '').trim();
    if (t) set.add(t);
  }
  return set;
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
/**
 * @param {object} db
 * @param {object} nodeConfig  PipelineNode (type='kb_write')
 *   {
 *     kb_id, kb_name,
 *     title_field, url_field, summary_field, content_field, source_field, published_at_field,
 *     chunk_strategy:   'mixed' | 'body_only' | 'whole'   // default 'mixed'
 *     dedupe_mode:      'url' | 'title' | 'url_or_title' | 'none'  // default 'url'
 *     max_chunks_per_run: number  // default 100
 *     on_row_error:     'skip' | 'stop'  // default 'skip'
 *   }
 * @param {string} sourceText  上游節點輸出文字
 * @param {object} context     { user, userId, runId, taskName, nodeId, dryRun }
 * @returns {Promise<{ documents_created, chunks_created, skipped_duplicates, errors, dryRun? }>}
 */
async function executeKbWrite(db, nodeConfig, sourceText, context = {}) {
  const cfg = nodeConfig || {};
  let kbId          = String(cfg.kb_id || '').trim();
  const kbNameHint  = String(cfg.kb_name || '').trim();
  const chunkMode   = ['mixed', 'body_only', 'whole'].includes(cfg.chunk_strategy) ? cfg.chunk_strategy : 'mixed';
  const dedupeMode  = ['url', 'title', 'url_or_title', 'none'].includes(cfg.dedupe_mode) ? cfg.dedupe_mode : 'url';
  const maxChunksPerRun = Math.max(1, Math.min(1000, Number(cfg.max_chunks_per_run) || 100));
  const onRowError  = cfg.on_row_error === 'stop' ? 'stop' : 'skip';
  const dryRun      = !!context.dryRun || !!cfg.dry_run;

  // kb_id 空但 kb_name 有值 → 用 name 自動 lookup(容錯既有 task pipeline_json 在 KB 還沒建好時 seed,
  // 之後 patch 沒跑到 / KB 重建 id 變了的場景。比強制 patch logic 更可靠)
  if (!kbId && kbNameHint) {
    try {
      const r = await db.prepare(
        `SELECT id FROM knowledge_bases WHERE UPPER(name)=UPPER(?) FETCH FIRST 1 ROWS ONLY`
      ).get(kbNameHint);
      const found = r?.id || r?.ID;
      if (found) {
        kbId = String(found).trim();
        console.log(`[Pipeline kb_write] kb_id 空 → 以 kb_name="${kbNameHint}" lookup 補回 → ${kbId}`);
      }
    } catch (e) {
      console.warn(`[Pipeline kb_write] kb_name lookup 失敗 (${kbNameHint}):`, e.message);
    }
  }

  if (!kbId) {
    throw new Error(
      `kb_write: kb_id 必填${kbNameHint ? ` (kb_name="${kbNameHint}" 也找不到對應 KB → 該 KB 是否已建立?)` : ''}`
    );
  }

  // ─── 1. 權限檢查 ─────────────────────────────────────────────────────────
  const user = context.user || {};
  const kb = await getAccessibleKbForWrite(db, kbId, user.id || context.userId, user.role);
  if (!kb) throw new Error(`無寫入此知識庫的權限或知識庫不存在(kb_id=${kbId})`);

  // ─── 2. 解析 rows ────────────────────────────────────────────────────────
  let rawRows = extractJsonRows(sourceText);
  if (!rawRows || !Array.isArray(rawRows)) {
    throw new Error('找不到可解析的 JSON — 請確認上游節點輸出含 JSON(陣列或物件)');
  }

  // 2.5 array_path:從 root JSON drill 到子陣列(同 db_write 機制)
  // 用途:LLM 輸出 { news: [...], prices: [...] },kb_write 設 array_path: '$.news'
  const arrayPath = String(cfg.array_path || '').trim();
  if (arrayPath) {
    const root = (rawRows.length === 1 && rawRows[0] && typeof rawRows[0] === 'object' && !Array.isArray(rawRows[0]))
      ? rawRows[0]
      : rawRows;
    const drilled = getByJsonPath(root, arrayPath);
    if (drilled == null) {
      if (cfg.array_path_optional) {
        return { documents_created: 0, chunks_created: 0, skipped_duplicates: 0, errors: [], dryRun };
      }
      throw new Error(`array_path "${arrayPath}" 在上游 JSON 找不到對應值`);
    }
    if (!Array.isArray(drilled)) {
      throw new Error(`array_path "${arrayPath}" 的值不是陣列(實際: ${typeof drilled})`);
    }
    rawRows = drilled;
  }

  if (!rawRows.length) {
    return { documents_created: 0, chunks_created: 0, skipped_duplicates: 0, errors: [], dryRun };
  }

  // 同 db_writer:errors 帶 row_payload(LLM 原始 row,truncate 800 字)
  const previewRow = (rawRow) => {
    try {
      const s = JSON.stringify(rawRow);
      return s.length > 800 ? s.slice(0, 800) + '…' : s;
    } catch { return String(rawRow).slice(0, 800); }
  };

  // ─── 3. 萃取 + 預先 dedupe ───────────────────────────────────────────────
  const items = [];
  const errors = [];
  const hashList = [];
  for (let i = 0; i < rawRows.length; i++) {
    try {
      const it = extractItem(rawRows[i], cfg);
      if (!it.title && !it.summary && !it.content) {
        errors.push({ row_index: i, errors: ['title / summary / content 全空,無法寫入'], row_payload: previewRow(rawRows[i]) });
        if (onRowError === 'stop') throw new Error(`row #${i}: 內容全空`);
        continue;
      }
      // 至少要有 url 或 title 之一可拿來做 hash key
      const dupKeyRaw = it.url || it.title;
      if (!dupKeyRaw) {
        errors.push({ row_index: i, errors: ['缺 url 與 title,無法去重'], row_payload: previewRow(rawRows[i]) });
        if (onRowError === 'stop') throw new Error(`row #${i}: 缺 url/title`);
        continue;
      }
      const normUrl  = it.url ? normalizeUrl(it.url) : null;
      const sourceHash = sha256Hex(normUrl || it.title.toLowerCase());
      it.normUrl = normUrl;
      it.sourceHash = sourceHash;
      it._rawRow = rawRows[i];  // 後面 chunk / embed 失敗時 payload 帶得回
      hashList.push(sourceHash);
      items.push({ index: i, ...it });
    } catch (e) {
      errors.push({ row_index: i, errors: [e.message], row_payload: previewRow(rawRows[i]) });
      if (onRowError === 'stop') throw e;
    }
  }

  // ─── 4. DB 端先撈已存在 hash / titles ────────────────────────────────────
  let existingHashes = new Set();
  let existingTitles = new Set();
  if (dedupeMode === 'url' || dedupeMode === 'url_or_title') {
    existingHashes = await loadExistingHashes(db, kbId, hashList);
  }
  if (dedupeMode === 'title' || dedupeMode === 'url_or_title') {
    existingTitles = await loadExistingTitles(db, kbId);
  }

  // ─── 5. Dry-run 預覽 ─────────────────────────────────────────────────────
  if (dryRun) {
    const preview = items.slice(0, 5).map(it => {
      const isDupUrl  = (dedupeMode === 'url' || dedupeMode === 'url_or_title') && existingHashes.has(it.sourceHash);
      const isDupTtl  = (dedupeMode === 'title' || dedupeMode === 'url_or_title') && existingTitles.has(it.title.toLowerCase());
      return {
        title: it.title.slice(0, 80),
        url: it.normUrl,
        will: (isDupUrl || isDupTtl) ? 'skip(duplicate)' : 'insert',
        chunks_estimate: estimateChunks(it, chunkMode, kb),
      };
    });
    return {
      documents_created: 0,
      chunks_created: 0,
      skipped_duplicates: items.filter(it => existingHashes.has(it.sourceHash) || existingTitles.has(it.title.toLowerCase())).length,
      errors: errors.slice(0, 10),
      dryRun: true,
      preview,
      summary: {
        kb_id: kbId,
        kb_name: kb.name,
        chunk_strategy: chunkMode,
        dedupe_mode: dedupeMode,
        items_in: items.length,
        will_insert: items.filter(it => !existingHashes.has(it.sourceHash) && !existingTitles.has(it.title.toLowerCase())).length,
      },
    };
  }

  // ─── 6. 實際寫入 ─────────────────────────────────────────────────────────
  // inserted_preview:給 admin Modal 看 KB 實際塞了什麼(content 截 800 字 + summary 全文)
  // 在迴圈裡逐筆 push,只放 documents_created 真的成功的(不含 dup / chunk fail)
  const insertedPreview = [];
  // total_rows_in_input = LLM 解析出的 raw row 總數(在 array_path drill 後),
  // 配合 documents_created / skipped_duplicates 看「LLM 給幾筆 → KB 真的收幾篇」
  const result = {
    total_rows_in_input: rawRows.length,
    documents_created: 0, chunks_created: 0, skipped_duplicates: 0,
    errors, inserted_preview: insertedPreview,
  };
  const dims = kb.embedding_dims || 768;
  const chunkCfg = (() => { try { return JSON.parse(kb.chunk_config || '{}'); } catch { return {}; } })();
  const kbChunkStrategy = kb.chunk_strategy || 'regular';

  const meta = {
    runId: context.runId || null,
    pipeline: `${context.taskName || ''}${context.nodeId ? '::' + context.nodeId : ''}`.slice(0, 200) || null,
  };

  const insertedDocIds = [];
  let totalEmbedTokens = 0;
  for (const it of items) {
    if (result.chunks_created >= maxChunksPerRun) {
      result.errors.push({ row_index: it.index, errors: [`已達 max_chunks_per_run=${maxChunksPerRun},剩餘 ${items.length - items.indexOf(it)} 筆未寫入`], row_payload: previewRow(it._rawRow) });
      break;
    }
    const titleLc = it.title.toLowerCase();
    const dupByUrl   = (dedupeMode === 'url'   || dedupeMode === 'url_or_title') && existingHashes.has(it.sourceHash);
    const dupByTitle = (dedupeMode === 'title' || dedupeMode === 'url_or_title') && existingTitles.has(titleLc);
    if (dupByUrl || dupByTitle) {
      result.skipped_duplicates++;
      continue;
    }

    try {
      // 6a. 組 chunks
      const chunks = buildChunks(it, chunkMode, kbChunkStrategy, chunkCfg);
      if (!chunks.length) {
        result.errors.push({ row_index: it.index, errors: ['切完無 chunk(內容過短)'], row_payload: previewRow(it._rawRow) });
        continue;
      }

      // chunk 上限 enforcement(避免單篇超大文章吃光配額)
      const allowedThisDoc = Math.max(1, maxChunksPerRun - result.chunks_created);
      const chunksToWrite = chunks.slice(0, allowedThisDoc);

      // 6b. embed(平行,2 並發避 429)
      const { default: pLimit } = await import('p-limit');
      const limit = pLimit(2);
      const embedded = await Promise.all(chunksToWrite.map((chunk, ci) => limit(async () => {
        let emb = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          try { emb = await embedText(chunk.content, { dims }); break; }
          catch (e) {
            if (attempt === 3) throw e;
            await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
          }
        }
        return { index: ci, chunk, embedding: toVectorStr(emb) };
      })));

      // 6c. INSERT kb_documents
      const docId = uuid();
      const filename = it.title || (it.url ? it.url.slice(-100) : `pipeline_${it.sourceHash.slice(0, 12)}`);
      const fullText = [it.title, it.summary, it.content].filter(Boolean).join('\n\n');
      // word_count 改用「去空白後總字數」— 對中文有意義(原本 split(/\s+/) 把整段中文當 1 word,
      // 中文新聞 200 字實際 word_count 算出來只剩 < 20,看起來像「LLM 偷懶」其實是算法問題)
      const wordCount = fullText.replace(/\s+/g, '').length;

      try {
        await db.prepare(`
          INSERT INTO kb_documents
            (id, kb_id, filename, file_type, file_size, content, word_count, chunk_count, status,
             source_url, source_hash, meta_run_id, meta_pipeline, published_at)
          VALUES
            (?, ?, ?, 'pipeline', ?, ?, ?, ?, 'ready',
             ?, ?, ?, ?, ${it.publishedAt ? "TO_TIMESTAMP(?, 'YYYY-MM-DD HH24:MI:SS')" : 'NULL'})
        `).run(
          docId, kbId, filename.slice(0, 500),
          Buffer.byteLength(fullText, 'utf8'),
          fullText, wordCount, chunksToWrite.length,
          (it.normUrl || '').slice(0, 2000) || null,
          it.sourceHash,
          meta.runId, meta.pipeline,
          ...(it.publishedAt ? [it.publishedAt] : []),
        );
      } catch (e) {
        if (/ORA-00001/.test(e.message)) {
          // race condition:剛好被同時 insert,當作 duplicate 處理
          result.skipped_duplicates++;
          existingHashes.add(it.sourceHash);
          continue;
        }
        throw e;
      }

      // 6d. INSERT kb_chunks
      for (const { index: ci, chunk, embedding } of embedded) {
        const chunkId = uuid();
        const tokenCount = Math.ceil(chunk.content.length / 4);
        await db.prepare(`
          INSERT INTO kb_chunks (id, doc_id, kb_id, parent_id, chunk_type, content, parent_content, position, token_count, embedding)
          VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, TO_VECTOR(?))
        `).run(
          chunkId, docId, kbId,
          chunk.chunk_type || 'regular',
          chunk.content,
          chunk.parent_content || null,
          ci,
          tokenCount,
          embedding,
        );
        totalEmbedTokens += tokenCount;
      }

      insertedDocIds.push(docId);
      existingHashes.add(it.sourceHash);
      existingTitles.add(titleLc);
      result.documents_created++;
      result.chunks_created += chunksToWrite.length;
      // 記前 5 筆 admin 預覽用 — title + url + summary 全文 + content 前 800 字
      if (insertedPreview.length < 5) {
        insertedPreview.push({
          row_index: it.index,
          title: it.title,
          url: it.normUrl,
          source: it.source,
          published_at: it.publishedAt,
          summary: it.summary,
          content_excerpt: it.content ? it.content.slice(0, 800) + (it.content.length > 800 ? '…' : '') : null,
          content_length: it.content ? it.content.length : 0,
          chunks_written: chunksToWrite.length,
        });
      }
    } catch (e) {
      result.errors.push({ row_index: it.index, errors: [e.message], row_payload: previewRow(it._rawRow) });
      if (onRowError === 'stop') {
        e._partialResult = result;
        throw e;
      }
    }
  }

  // ─── 7. 更新 KB stats + token usage ──────────────────────────────────────
  try {
    const s = await db.prepare(`
      SELECT COUNT(*) AS doc_count,
             COALESCE(SUM(file_size),0) AS total_bytes,
             COALESCE(SUM(chunk_count),0) AS chunk_count
      FROM kb_documents WHERE kb_id=?
    `).get(kbId);
    await db.prepare(`
      UPDATE knowledge_bases SET doc_count=?, chunk_count=?, total_size_bytes=?, updated_at=SYSTIMESTAMP WHERE id=?
    `).run(s?.doc_count || 0, s?.chunk_count || 0, s?.total_bytes || 0, kbId);
  } catch (_) {}

  // embedding token usage:不在這裡記。pipeline 排程的 LLM token 已在 scheduledTaskService
  // 統一記錄(model_used + input/output_tokens),這裡的 embed token 屬於 KB 維護成本,
  // 暫不重複記。若日後要做精細計費,再加 token_usage upsert。
  if (totalEmbedTokens > 0) {
    console.log(`[Pipeline kb_write] embedded ${totalEmbedTokens} tokens (not billed to user)`);
  }

  return result;
}

// ── 輔助:估算 chunks 數(dry-run 用)─────────────────────────────────────
function estimateChunks(item, mode, kb) {
  const cfg = (() => { try { return JSON.parse(kb.chunk_config || '{}'); } catch { return {}; } })();
  const tgt = Number(cfg.chunk_size) || 600;
  let est = 0;
  if (mode === 'mixed') {
    if (item.title || item.summary) est += 1;
    if (item.content && item.content.length > tgt) est += Math.ceil(item.content.length / tgt);
    else if (item.content) est += 1;
  } else if (mode === 'body_only') {
    const text = item.content || item.summary || item.title;
    est += Math.max(1, Math.ceil((text || '').length / tgt));
  } else { // whole
    est = 1;
  }
  return est;
}

// ── 輔助:組 chunks ──────────────────────────────────────────────────────
function buildChunks(item, mode, kbStrategy, kbCfg) {
  const out = [];

  if (mode === 'whole') {
    const full = [item.title, item.summary, item.content].filter(Boolean).join('\n\n');
    if (full.trim()) out.push({ content: full, chunk_type: 'regular' });
    return out;
  }

  if (mode === 'mixed') {
    // chunk #0: title + summary(metadata-style)
    const head = [item.title, item.summary].filter(Boolean).join('\n');
    if (head.trim()) out.push({ content: head, chunk_type: 'regular' });
    // chunks #1+: content 用 KB 預設策略切
    if (item.content && item.content.trim()) {
      // 短內容直接整段
      if (item.content.length < 600) {
        out.push({ content: item.content, chunk_type: 'regular' });
      } else {
        const bodyChunks = chunkDocument(item.content, kbStrategy, kbCfg);
        out.push(...bodyChunks);
      }
    }
    return out;
  }

  // body_only
  const text = item.content || item.summary || item.title || '';
  if (!text.trim()) return out;
  if (text.length < 600) {
    out.push({ content: text, chunk_type: 'regular' });
  } else {
    out.push(...chunkDocument(text, kbStrategy, kbCfg));
  }
  return out;
}

module.exports = {
  executeKbWrite,
  normalizeUrl,
  sha256Hex,
  // 給 admin UI / API 用
  getAccessibleKbForWrite,
};
