/**
 * Feedback KB Sync — 工單結案後自動 embedding 到 KB
 *
 * 單一 KB：feedback-public
 * - 脫敏後對話逐則 + 附件 caption 作為 child chunks（細粒度召回）
 * - 每個 child 的 parent_content 放完整工單摘要（召回時自動帶回）
 * - 完整未脫敏原始 → feedback_conversation_archive（admin 專屬）
 */

'use strict';

const { v4: uuid } = require('uuid');
const { embedText, embedBatch, toVectorStr } = require('./kbEmbedding');
const { processAttachments } = require('./feedbackAttachmentProcessor');
const { redactSafe, fallbackRegexRedact } = require('./feedbackRedactor');

const PUBLIC_KB_NAME = 'Cortex 問題工單知識庫';
const ERP_KB_NAME = 'ERP 問題工單知識庫';

// 舊名稱（migration rename 用）
const _OLD_NAMES = ['feedback-public', 'feedback-erp'];

function _kbNameForTicket(ticket) {
  return (ticket?.category_is_erp === 1 || ticket?.category_is_erp === '1') ? ERP_KB_NAME : PUBLIC_KB_NAME;
}
const MAX_CHUNK_CHARS = 4000;   // 單 chunk embed 上限（含脫敏後）
const EMBED_DELAY_MS = 150;
const REDACT_DELAY_MS = 200;

// ─── 組裝文本 ───────────────────────────────────────────────────────────────

function _buildSummary(ticket, messages, attResults) {
  const adminReplies = messages
    .filter(m => m.sender_role === 'admin' && !m.is_internal && !m.is_system)
    .map(m => m.content)
    .join('\n')
    .slice(0, 1500);

  const attachLine = attResults.length > 0
    ? `附件: ${attResults.length} 個（${attResults.map(a => a.attachment.file_name).slice(0, 5).join(', ')}${attResults.length > 5 ? ' 等' : ''}）`
    : '附件: (無)';

  return [
    `【工單】${ticket.ticket_no}`,
    `分類: ${ticket.category_name || '-'}`,
    `主旨: ${ticket.subject}`,
    `申請者: ${ticket.applicant_name || '-'} / 工號 ${ticket.applicant_employee_id || '-'} / 部門 ${ticket.applicant_dept || '-'}`,
    `問題描述:\n${(ticket.description || '').slice(0, 1500) || '(無)'}`,
    `解決方案:\n${ticket.resolution_note || adminReplies || '(無記錄)'}`,
    attachLine,
  ].join('\n');
}

function _buildChunks(ticket, messages, attResults) {
  const chunks = [];

  // 0. 問題描述
  const headerContent = [
    `【工單 ${ticket.ticket_no}】分類: ${ticket.category_name || '-'}`,
    `主旨: ${ticket.subject}`,
    `問題描述: ${ticket.description || '(無)'}`,
  ].join('\n');
  chunks.push({
    content: headerContent.slice(0, MAX_CHUNK_CHARS),
    position_type: 'header',
    meta: {},
  });

  // 1..N. 對話（含 internal notes — admin 解題紀錄也進 KB）
  for (const m of messages) {
    if (m.is_system) continue;
    const content = m.content?.trim();
    if (!content) continue;
    const roleLabel = m.sender_role === 'admin' ? '客服' : '申請者';
    const tag = m.is_internal ? '【內部解題紀錄】' : `【${roleLabel}】`;
    const body = `${tag}${m.is_internal ? '' : (m.sender_name || '')}\n${content}`;
    chunks.push({
      content: body.slice(0, MAX_CHUNK_CHARS),
      position_type: m.is_internal ? 'admin_note' : 'message',
      meta: { message_id: m.id, sender_role: m.sender_role },
    });
  }

  // N+1..M. 附件 caption
  for (const r of attResults) {
    if (!r.caption?.trim()) continue;
    const body = `【附件: ${r.attachment.file_name}】\n${r.caption}`;
    chunks.push({
      content: body.slice(0, MAX_CHUNK_CHARS),
      position_type: 'attachment',
      meta: {
        attachment_id: r.attachment.id,
        attachment_url: `/uploads/${r.attachment.file_path}`,
        mime_type: r.attachment.mime_type,
      },
    });
  }

  // 解決方案單獨一 chunk（召回時權重高）
  const adminReplies = messages
    .filter(m => m.sender_role === 'admin' && !m.is_internal && !m.is_system)
    .map(m => m.content?.trim())
    .filter(Boolean)
    .join('\n');
  const resolution = ticket.resolution_note?.trim() || adminReplies;
  if (resolution) {
    chunks.push({
      content: `【解決方案】${resolution}`.slice(0, MAX_CHUNK_CHARS),
      position_type: 'resolution',
      meta: {},
    });
  }

  return chunks;
}

// ─── 脫敏 ─────────────────────────────────────────────────────────────────────

async function _redactAll(texts, ticket) {
  const out = [];
  for (const text of texts) {
    const r = await redactSafe(text, ticket, { timeoutMs: 45000 });
    out.push(r.text);
    if (REDACT_DELAY_MS > 0) await new Promise(res => setTimeout(res, REDACT_DELAY_MS));
  }
  return out;
}

// sanitizeContent 保留給舊 caller（已無使用處，僅相容，規範脫敏走 redactor）
function sanitizeContent(ticket, messages) {
  const summary = _buildSummary(ticket, messages, []);
  return fallbackRegexRedact(summary, ticket);
}

// ─── KB 管理 ───────────────────────────────────────────────────────────────────

async function ensureFeedbackKB(db, name = PUBLIC_KB_NAME) {
  const existing = await db.prepare('SELECT id, embedding_dims FROM knowledge_bases WHERE name = ?').get(name);
  if (existing) return existing;

  const admin = await db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC FETCH FIRST 1 ROWS ONLY").get();
  const creatorId = admin?.id ?? 1;

  const id = uuid();
  const dims = 768;
  const isErp = name === ERP_KB_NAME;
  const desc = isErp ? 'ERP 問題工單知識庫（脫敏）' : 'Cortex 問題工單知識庫（脫敏）';
  // retrieval_mode / top_k_return / score_threshold 不寫死 —
  // 讓 DB column default + admin「KB 檢索設定」系統預設接手。
  // 保留 chunk_strategy='parent_child'（工單結構需要 parent-child chunking）。
  await db.prepare(`
    INSERT INTO knowledge_bases
      (id, creator_id, name, description, embedding_dims, chunk_strategy, is_public,
       name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi)
    VALUES (?, ?, ?, ?, ?, 'parent_child', ?,
            ?, ?, ?, ?, ?, ?)
  `).run(id, creatorId, name, desc, dims, 1,
    name,
    isErp ? 'ERP Ticket Knowledge Base' : 'Cortex Ticket Knowledge Base',
    isErp ? 'Cơ sở tri thức phiếu ERP' : 'Cơ sở tri thức phiếu Cortex',
    desc,
    isErp ? 'ERP feedback ticket KB (redacted)' : 'Cortex feedback ticket KB (redacted)',
    isErp ? 'Cơ sở tri thức phiếu phản hồi ERP (đã ẩn danh)' : 'Cơ sở tri thức phiếu phản hồi Cortex (đã ẩn danh)',
  );

  console.log(`[FeedbackKB] Created KB: ${name} (id=${id})`);
  return { id, embedding_dims: dims };
}

// ─── 同步單張工單 ─────────────────────────────────────────────────────────────

async function syncTicketToKB(db, ticketId) {
  const feedbackService = require('./feedbackService');
  const ticket = await feedbackService.getTicketById(db, ticketId);
  if (!ticket) return { skipped: 'not-found' };
  if (!['resolved', 'closed'].includes(ticket.status)) return { skipped: 'not-resolved' };

  const [messages, attachments] = await Promise.all([
    feedbackService.listMessages(db, ticketId, true),
    feedbackService.listAttachments(db, ticketId),
  ]);

  // 1. 處理附件 → captions（循序跑）
  const attResults = await processAttachments(attachments);

  // 2. 組原始 parent summary + child chunks
  const rawSummary = _buildSummary(ticket, messages, attResults);
  const rawChunks = _buildChunks(ticket, messages, attResults);
  if (rawChunks.length === 0) return { skipped: 'empty' };

  // 3. 脫敏（parent + chunks 合併成一個 array 減少 LLM calls）
  const allTexts = [rawSummary, ...rawChunks.map(c => c.content)];
  const redacted = await _redactAll(allTexts, ticket);
  const redactedSummary = redacted[0];
  const redactedChunkTexts = redacted.slice(1);

  // 4. 覆蓋舊資料（依 ticket.category_is_erp 選 KB）
  const kbName = _kbNameForTicket(ticket);
  const kb = await ensureFeedbackKB(db, kbName);
  const docMarker = `feedback:${ticket.ticket_no}`;
  // 舊資料：同名 doc 可能在另一個 KB（例如分類改過），兩邊都清
  try {
    const oldDocs = await db.prepare('SELECT id FROM kb_documents WHERE filename = ? AND file_type = ?').all(docMarker, 'feedback');
    for (const od of oldDocs) {
      const oldDocId = od.id ?? od.ID;
      if (oldDocId) {
        await db.prepare('DELETE FROM kb_chunks WHERE doc_id = ?').run(oldDocId);
        await db.prepare('DELETE FROM kb_documents WHERE id = ?').run(oldDocId);
      }
    }
  } catch (e) {
    console.warn(`[FeedbackKB] delete old doc ${docMarker}:`, e.message);
  }

  // 5. 建新 doc
  const docId = uuid();
  const summaryBytes = Buffer.byteLength(redactedSummary, 'utf8');
  await db.prepare(`
    INSERT INTO kb_documents (id, kb_id, filename, file_type, file_size, status, parse_mode, content)
    VALUES (?, ?, ?, 'feedback', ?, 'ready', 'text_only', ?)
  `).run(docId, kb.id, docMarker, summaryBytes, redactedSummary);

  // 6. 批次 embed
  const dims = kb.embedding_dims || 768;
  let embeddings;
  try {
    embeddings = await embedBatch(redactedChunkTexts, { dims, delayMs: EMBED_DELAY_MS });
  } catch (e) {
    console.warn(`[FeedbackKB] batch embed failed for ${ticket.ticket_no}:`, e.message);
    // 刪掉剛建的 doc 避免懸掛
    await db.prepare('DELETE FROM kb_documents WHERE id = ?').run(docId).catch(() => {});
    return { error: 'embed-failed' };
  }

  // 7. INSERT chunks
  let inserted = 0;
  for (let i = 0; i < rawChunks.length; i++) {
    const raw = rawChunks[i];
    const chunkContent = redactedChunkTexts[i];
    const emb = embeddings[i];
    if (!emb) continue;
    const chunkId = uuid();
    const metadata = JSON.stringify({
      ticket_no: ticket.ticket_no,
      category: ticket.category_name,
      priority: ticket.priority,
      resolved_at: ticket.resolved_at,
      position_type: raw.position_type,
      ...raw.meta,
    });
    try {
      await db.prepare(`
        INSERT INTO kb_chunks
          (id, doc_id, kb_id, parent_id, chunk_type, content, parent_content, position, token_count, embedding, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TO_VECTOR(?), ?)
      `).run(
        chunkId, docId, kb.id, null,
        'child',
        chunkContent,
        redactedSummary,
        i,
        Math.ceil(chunkContent.length / 4),
        toVectorStr(emb),
        metadata,
      );
      inserted++;
    } catch (e) {
      console.warn(`[FeedbackKB] chunk ${i} insert failed:`, e.message);
    }
  }

  // 8. Update KB stats + doc chunk_count
  await db.prepare('UPDATE kb_documents SET chunk_count = ? WHERE id = ?').run(inserted, docId);
  await db.prepare(`
    UPDATE knowledge_bases
    SET chunk_count = (SELECT COUNT(*) FROM kb_chunks WHERE kb_id = ?),
        doc_count = (SELECT COUNT(*) FROM kb_documents WHERE kb_id = ?)
    WHERE id = ?
  `).run(kb.id, kb.id, kb.id);

  console.log(`[FeedbackKB] Synced ${ticket.ticket_no} → ${kbName}: ${inserted} chunks (${attResults.length} attachments)`);
  return { ok: true, kb: kbName, chunks: inserted, attachments: attResults.length };
}

// ─── Vector 搜尋 ──────────────────────────────────────────────────────────────

async function searchFeedbackKB(db, query, limit = 5, options = {}) {
  const kbName = options.kbName || PUBLIC_KB_NAME;
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
    SELECT c.content, c.parent_content, c.metadata,
           VECTOR_DISTANCE(c.embedding, TO_VECTOR(?), COSINE) AS vector_score
    FROM kb_chunks c
    WHERE c.kb_id = ? AND c.chunk_type != 'parent'
    ORDER BY vector_score ASC
    FETCH FIRST ? ROWS ONLY
  `).all(qVecStr, kb.id, limit);

  return rows.map(r => {
    let meta = {};
    try { meta = JSON.parse(r.metadata || '{}'); } catch {}
    // 從 parent_content 擷取顯示用摘要
    const parentSummary = r.parent_content || '';
    const subjectMatch = parentSummary.match(/主旨:\s*(.+)/);
    const resolutionMatch = parentSummary.match(/解決方案:\s*([\s\S]*?)(?:\n附件:|$)/);
    return {
      ticket_no: meta.ticket_no || '-',
      subject: subjectMatch?.[1]?.trim() || '-',
      resolution: resolutionMatch?.[1]?.trim() || null,
      chunk_content: r.content,       // 召回的細粒度片段
      parent_content: parentSummary,  // 完整工單摘要（給 LLM 上下文）
      score: Math.round((1 - (r.vector_score || 0)) * 100) / 100,
      category: meta.category,
      position_type: meta.position_type,
      attachment_url: meta.attachment_url,
    };
  });
}

module.exports = {
  syncTicketToKB,
  searchFeedbackKB,
  sanitizeContent,
  ensureFeedbackKB,
  PUBLIC_KB_NAME,
  ERP_KB_NAME,
};
