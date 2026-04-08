/**
 * Feedback KB Sync — 工單結案後自動 embedding 到 KB
 *
 * 雙 KB 架構:
 *   feedback-public  — 脫敏內容（所有使用者可搜）
 *   feedback-admin   — 完整內容（僅管理員可搜）
 */

'use strict';

const { v4: uuid } = require('uuid');
const { embedText, toVectorStr } = require('./kbEmbedding');

const PUBLIC_KB_NAME = 'feedback-public';
const ADMIN_KB_NAME = 'feedback-admin';

// ─── 脫敏 ─────────────────────────────────────────────────────────────────────

function sanitizeContent(ticket, messages) {
  let content = [ticket.subject, ticket.description || ''].join('\n');

  // 移除已知個人資訊
  const replacements = [
    [ticket.applicant_name, '[使用者]'],
    [ticket.applicant_employee_id, '[工號]'],
    [ticket.applicant_email, '[email]'],
    [ticket.applicant_dept, '[部門]'],
  ];
  for (const [from, to] of replacements) {
    if (from) content = content.split(from).join(to);
  }

  // 移除 email pattern
  content = content.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]');

  // 提取解決方案
  const resolution = ticket.resolution_note || '';
  const adminMessages = messages
    .filter(m => m.sender_role === 'admin' && !m.is_internal && !m.is_system)
    .map(m => m.content)
    .join('\n');

  return {
    public: `分類: ${ticket.category_name || '-'}\n問題: ${content}\n解決方案: ${resolution || adminMessages.slice(0, 1000) || '(無記錄)'}`,
    admin: `分類: ${ticket.category_name || '-'}\n申請者: ${ticket.applicant_name} (${ticket.applicant_dept || '-'}) 工號:${ticket.applicant_employee_id || '-'}\n問題: ${ticket.subject}\n${ticket.description || ''}\n解決方案: ${resolution || adminMessages || '(無記錄)'}`,
  };
}

// ─── KB 管理 ───────────────────────────────────────────────────────────────────

async function ensureFeedbackKB(db, name, isPublic) {
  const existing = await db.prepare('SELECT id, embedding_dims FROM knowledge_bases WHERE name = ?').get(name);
  if (existing) return existing;

  // 取第一個 admin 的 id 當 creator
  const admin = await db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC FETCH FIRST 1 ROWS ONLY").get();
  const creatorId = admin?.id ?? 1;

  const id = uuid();
  const dims = 768;
  await db.prepare(`
    INSERT INTO knowledge_bases
      (id, creator_id, name, description, embedding_dims, chunk_strategy, retrieval_mode, top_k_return, score_threshold, is_public)
    VALUES (?, ?, ?, ?, ?, 'regular', 'vector', 5, 0.3, ?)
  `).run(id, creatorId, name, name === PUBLIC_KB_NAME ? '問題反饋公開知識庫（脫敏）' : '問題反饋管理員知識庫（完整）', dims, isPublic ? 1 : 0);

  console.log(`[FeedbackKB] Created KB: ${name} (id=${id})`);
  return { id, embedding_dims: dims };
}

// ─── 同步單張工單 ─────────────────────────────────────────────────────────────

async function syncTicketToKB(db, ticketId) {
  const feedbackService = require('./feedbackService');
  const ticket = await feedbackService.getTicketById(db, ticketId);
  if (!ticket) return;
  if (!['resolved', 'closed'].includes(ticket.status)) return;

  const messages = await feedbackService.listMessages(db, ticketId, true);
  const { public: publicContent, admin: adminContent } = sanitizeContent(ticket, messages);

  // Ensure KBs exist
  const [publicKB, adminKB] = await Promise.all([
    ensureFeedbackKB(db, PUBLIC_KB_NAME, true),
    ensureFeedbackKB(db, ADMIN_KB_NAME, false),
  ]);

  // Sync both
  await Promise.all([
    _upsertTicketChunk(db, publicKB, ticket, publicContent),
    _upsertTicketChunk(db, adminKB, ticket, adminContent),
  ]);

  console.log(`[FeedbackKB] Synced ticket ${ticket.ticket_no} to both KBs`);
}

async function _upsertTicketChunk(db, kb, ticket, content) {
  const dims = kb.embedding_dims || 768;
  const docMarker = `feedback:${ticket.ticket_no}`;

  // Delete old chunks for this ticket
  try {
    const oldDoc = await db.prepare('SELECT id FROM kb_documents WHERE kb_id = ? AND filename = ?').get(kb.id, docMarker);
    if (oldDoc) {
      await db.prepare('DELETE FROM kb_chunks WHERE doc_id = ?').run(oldDoc.id);
      await db.prepare('DELETE FROM kb_documents WHERE id = ?').run(oldDoc.id);
    }
  } catch {}

  // Create doc
  const docId = uuid();
  const contentBytes = Buffer.byteLength(content, 'utf8');
  await db.prepare(`
    INSERT INTO kb_documents (id, kb_id, filename, file_type, file_size, status, parse_mode, content)
    VALUES (?, ?, ?, 'feedback', ?, 'ready', 'text_only', ?)
  `).run(docId, kb.id, docMarker, contentBytes, content);

  // Embed + insert chunk
  let embedding = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const emb = await embedText(content.slice(0, 10000), { dims });
      embedding = toVectorStr(emb);
      break;
    } catch (e) {
      if (attempt === 2) {
        console.warn(`[FeedbackKB] Embedding failed for ${ticket.ticket_no}:`, e.message);
        return;
      }
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }

  const chunkId = uuid();
  const metadata = JSON.stringify({
    ticket_no: ticket.ticket_no,
    category: ticket.category_name,
    priority: ticket.priority,
    resolved_at: ticket.resolved_at,
  });

  await db.prepare(`
    INSERT INTO kb_chunks (id, doc_id, kb_id, chunk_type, content, position, token_count, embedding, metadata)
    VALUES (?, ?, ?, 'regular', ?, 0, ?, TO_VECTOR(?), ?)
  `).run(chunkId, docId, kb.id, content, Math.ceil(content.length / 4), embedding, metadata);

  // Update KB stats
  await db.prepare(`
    UPDATE knowledge_bases
    SET chunk_count = (SELECT COUNT(*) FROM kb_chunks WHERE kb_id = ?),
        doc_count = (SELECT COUNT(*) FROM kb_documents WHERE kb_id = ?)
    WHERE id = ?
  `).run(kb.id, kb.id, kb.id);
}

// ─── Vector 搜尋 ──────────────────────────────────────────────────────────────

async function searchFeedbackKB(db, query, isAdmin, limit = 5) {
  const kbName = isAdmin ? ADMIN_KB_NAME : PUBLIC_KB_NAME;
  const kb = await db.prepare('SELECT id, embedding_dims FROM knowledge_bases WHERE name = ?').get(kbName);
  if (!kb) return [];

  const dims = kb.embedding_dims || 768;
  let qVecStr;
  try {
    const emb = await embedText(query, { dims });
    qVecStr = toVectorStr(emb);
  } catch (e) {
    console.warn('[FeedbackKB] search embedding error:', e.message);
    return [];
  }

  const rows = await db.prepare(`
    SELECT c.content, c.metadata,
           VECTOR_DISTANCE(c.embedding, TO_VECTOR(?), COSINE) AS vector_score
    FROM kb_chunks c
    WHERE c.kb_id = ? AND c.chunk_type != 'parent'
    ORDER BY vector_score ASC
    FETCH FIRST ? ROWS ONLY
  `).all(qVecStr, kb.id, limit);

  return rows.map(r => {
    let meta = {};
    try { meta = JSON.parse(r.metadata || '{}'); } catch {}
    return {
      ticket_no: meta.ticket_no || '-',
      subject: r.content?.split('\n')[1]?.replace(/^問題:\s*/, '') || '-',
      resolution: r.content?.match(/解決方案:\s*([\s\S]*)/)?.[1]?.trim() || null,
      score: Math.round((1 - (r.vector_score || 0)) * 100) / 100,
      category: meta.category,
    };
  });
}

module.exports = {
  syncTicketToKB,
  searchFeedbackKB,
  sanitizeContent,
  PUBLIC_KB_NAME,
  ADMIN_KB_NAME,
};
