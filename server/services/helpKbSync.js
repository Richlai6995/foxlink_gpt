'use strict';
/**
 * Help KB Auto-Sync
 * 啟動時自動將 data/helpContent.js 的使用者說明書向量化，
 * 存入一個系統公開的知識庫「FOXLINK GPT 使用說明書」。
 * 採 MD5 hash 機制，內容不變時跳過，避免重複 embedding。
 */

const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const { embedText, toVectorStr, DEFAULT_MODEL: DEFAULT_EMBED_MODEL } = require('./kbEmbedding');
const { chunkDocument } = require('./kbDocParser');
const { sections } = require('./helpContent');

const KB_NAME = 'FOXLINK GPT 使用說明書';
const KB_TAGS = JSON.stringify(['使用說明', '操作手冊', '功能教學', '如何使用', 'FOXLINK GPT']);

/** 取得 admin user id（用於系統 KB 的 creator_id） */
async function getAdminUserId(db) {
  const adminAccount = process.env.DEFAULT_ADMIN_ACCOUNT || 'ADMIN';
  const row = await db.prepare(`SELECT id FROM users WHERE username=? AND role='admin' AND ROWNUM=1`).get(adminAccount);
  if (row) return row.id;
  // fallback: any admin
  const any = await db.prepare(`SELECT id FROM users WHERE role='admin' AND ROWNUM=1`).get();
  return any?.id || 1;
}

function computeHash(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

/** 取得或建立系統 KB */
async function getOrCreateKb(db) {
  let kb = await db.prepare(`SELECT * FROM knowledge_bases WHERE name=?`).get(KB_NAME);
  if (kb) return kb;

  const id = uuid();
  const creatorId = await getAdminUserId(db);
  await db.prepare(`
    INSERT INTO knowledge_bases
      (id, creator_id, name, description,
       embedding_model, embedding_dims,
       chunk_strategy, chunk_config,
       retrieval_mode, rerank_model,
       top_k_fetch, top_k_return, score_threshold,
       ocr_model, parse_mode, tags, is_public)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, creatorId, KB_NAME,
    '系統自動生成的使用說明向量庫，供 AI 回答「如何使用 FOXLINK GPT」的問題。',
    DEFAULT_EMBED_MODEL, 768,
    'regular', JSON.stringify({ max_size: 1024, overlap: 50 }),
    'hybrid', null,
    15, 5, 0.3,
    null, 'text_only',
    KB_TAGS, 1,
  );

  // 嘗試建 partition（Oracle 23 AI 分區；不支援時忽略）
  try {
    const { addKbChunksPartition } = require('../database-oracle');
    await addKbChunksPartition(id);
  } catch (_) {}

  kb = await db.prepare(`SELECT * FROM knowledge_bases WHERE id=?`).get(id);
  console.log(`[HelpKB] 知識庫建立完成: ${id}`);
  return kb;
}

/** 取得某 section 在 kb_documents 中的 hash marker doc */
async function getHashDoc(db, kbId, sectionId) {
  return db.prepare(
    `SELECT id, filename FROM kb_documents WHERE kb_id=? AND file_type='__helphash__' AND filename LIKE ?`
  ).get(kbId, `${sectionId}::%`);
}

/** 刪除 section 的所有 chunks 及 doc */
async function deleteSection(db, kbId, sectionId) {
  const docs = await db.prepare(
    `SELECT id FROM kb_documents WHERE kb_id=? AND filename LIKE ?`
  ).all(kbId, `${sectionId}::%`);
  for (const doc of docs) {
    await db.prepare(`DELETE FROM kb_chunks WHERE doc_id=?`).run(doc.id);
    await db.prepare(`DELETE FROM kb_documents WHERE id=?`).run(doc.id);
  }
}

/** Upsert 一個 section */
async function syncSection(db, kb, section) {
  const hash = computeHash(section.content);
  const hashMarker = `${section.id}::${hash}`;

  // Check if already up-to-date
  const existing = await getHashDoc(db, kb.id, section.id);
  if (existing && existing.filename === hashMarker) {
    return false; // unchanged
  }

  // Delete old chunks / docs for this section
  await deleteSection(db, kb.id, section.id);

  // Create hash marker doc
  const docId = uuid();
  const contentBytes = Buffer.byteLength(section.content, 'utf8');
  await db.prepare(`
    INSERT INTO kb_documents
      (id, kb_id, filename, file_type, file_size, status, parse_mode, content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(docId, kb.id, hashMarker, '__helphash__', contentBytes, 'ready', 'text_only', section.content);

  // Chunk
  const cfg = JSON.parse(kb.chunk_config || '{}');
  const rawChunks = chunkDocument(section.content, kb.chunk_strategy || 'regular', cfg);

  const dims = kb.embedding_dims || 768;
  let chunkCount = 0;

  for (let i = 0; i < rawChunks.length; i++) {
    const chunk = rawChunks[i];
    const chunkId = uuid();

    let embedding = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const emb = await embedText(chunk.content, { dims });
        embedding = toVectorStr(emb);
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }

    await db.prepare(`
      INSERT INTO kb_chunks
        (id, doc_id, kb_id, parent_id, chunk_type, content, parent_content, position, token_count, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TO_VECTOR(?))
    `).run(
      chunkId, docId, kb.id, null,
      chunk.chunk_type || 'regular',
      chunk.content,
      chunk.parent_content || null,
      i,
      Math.ceil(chunk.content.length / 4),
      embedding,
    );

    chunkCount++;
    // Throttle to stay under embedding rate limit
    if (i < rawChunks.length - 1) await new Promise((r) => setTimeout(r, 120));
  }

  await db.prepare(`UPDATE kb_documents SET chunk_count=? WHERE id=?`).run(chunkCount, docId);
  return true; // updated
}

/** Update knowledge_bases stats */
async function updateKbStats(db, kbId) {
  try {
    const s = await db.prepare(`
      SELECT COUNT(*) AS doc_count,
             COALESCE(SUM(file_size),0) AS total_bytes,
             COALESCE(SUM(chunk_count),0) AS chunk_count
      FROM kb_documents WHERE kb_id=?
    `).get(kbId);
    await db.prepare(`
      UPDATE knowledge_bases
      SET doc_count=?, chunk_count=?, total_size_bytes=?, updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(s?.doc_count || 0, s?.chunk_count || 0, s?.total_bytes || 0, kbId);
  } catch (_) {}
}

/**
 * Entry point — call this non-blocking after server startup.
 * @param {object} db
 */
async function syncHelpKb(db) {
  try {
    console.log('[HelpKB] 開始同步說明書知識庫...');
    const kb = await getOrCreateKb(db);

    let updatedCount = 0;
    for (const section of sections) {
      try {
        const updated = await syncSection(db, kb, section);
        if (updated) {
          updatedCount++;
          console.log(`[HelpKB] ✓ 更新章節: ${section.title}`);
        }
      } catch (e) {
        console.error(`[HelpKB] 章節 ${section.id} 同步失敗:`, e.message);
      }
    }

    if (updatedCount > 0) {
      await updateKbStats(db, kb.id);
      console.log(`[HelpKB] 同步完成，共更新 ${updatedCount} 個章節。`);
    } else {
      console.log('[HelpKB] 說明書知識庫已是最新，略過。');
    }
  } catch (e) {
    console.error('[HelpKB] syncHelpKb 失敗:', e.message);
  }
}

module.exports = { syncHelpKb };
