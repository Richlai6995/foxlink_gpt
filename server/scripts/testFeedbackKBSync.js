/**
 * 實測: 對最近 1 張 resolved 工單跑 syncTicketToKB
 * 並 dump 出 chunks / metadata 供 review
 *
 * Usage:
 *   node server/scripts/testFeedbackKBSync.js           # 最近 1 張
 *   node server/scripts/testFeedbackKBSync.js <ticket_id>
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { init } = require('../database-oracle');
const { syncTicketToKB, searchFeedbackKB, PUBLIC_KB_NAME } = require('../services/feedbackKBSync');

async function main() {
  await init();
  const db = require('../database-oracle').db;

  const argTicketId = process.argv[2] ? Number(process.argv[2]) : null;
  let ticketId;
  if (argTicketId) {
    ticketId = argTicketId;
  } else {
    const row = await db.prepare(`
      SELECT id FROM feedback_tickets
      WHERE status IN ('resolved', 'closed')
      ORDER BY resolved_at DESC NULLS LAST, updated_at DESC
      FETCH FIRST 1 ROWS ONLY
    `).get();
    ticketId = row?.id ?? row?.ID;
  }
  if (!ticketId) { console.log('No ticket to sync'); process.exit(0); }

  console.log(`\n=== Syncing ticket_id=${ticketId} ===\n`);
  const t0 = Date.now();
  const r = await syncTicketToKB(db, ticketId);
  console.log(`\n=== Result (${((Date.now() - t0)/1000).toFixed(1)}s) ===`, r);

  // Dump chunks
  const kb = await db.prepare('SELECT id FROM knowledge_bases WHERE name=?').get(PUBLIC_KB_NAME);
  const kbId = kb?.id ?? kb?.ID;
  const ticket = await db.prepare('SELECT ticket_no FROM feedback_tickets WHERE id=?').get(ticketId);
  const ticketNo = ticket?.ticket_no ?? ticket?.TICKET_NO;
  const docMarker = `feedback:${ticketNo}`;

  const doc = await db.prepare('SELECT id, file_size, chunk_count, content FROM kb_documents WHERE kb_id=? AND filename=?').get(kbId, docMarker);
  console.log('\n--- Document ---');
  console.log('  id:', doc?.id ?? doc?.ID);
  console.log('  chunk_count:', doc?.chunk_count ?? doc?.CHUNK_COUNT);
  console.log('  file_size:', doc?.file_size ?? doc?.FILE_SIZE);
  console.log('  content (parent summary):');
  console.log('    ' + (doc?.content ?? doc?.CONTENT ?? '').split('\n').join('\n    '));

  const chunks = await db.prepare(`
    SELECT position, chunk_type, content, parent_content, metadata
    FROM kb_chunks
    WHERE doc_id = ?
    ORDER BY position ASC
  `).all(doc?.id ?? doc?.ID);

  console.log(`\n--- Chunks (${chunks.length}) ---`);
  for (const c of chunks) {
    let meta = {};
    try { meta = JSON.parse(c.metadata ?? c.METADATA ?? '{}'); } catch {}
    const content = c.content ?? c.CONTENT ?? '';
    console.log(`\n  [pos=${c.position ?? c.POSITION}] type=${meta.position_type || '-'}`);
    console.log(`    content: ${content.slice(0, 300).replace(/\n/g, '\n             ')}${content.length > 300 ? '...' : ''}`);
    if (meta.attachment_url) console.log(`    attachment_url: ${meta.attachment_url}`);
  }

  // Search smoke test
  console.log('\n--- Search test (query = "問題處理進度") ---');
  const hits = await searchFeedbackKB(db, '問題處理進度', 3);
  for (const h of hits) {
    console.log(`  score=${h.score}  ticket_no=${h.ticket_no}  pos=${h.position_type}  subject="${h.subject}"`);
    console.log(`    chunk: ${(h.chunk_content || '').slice(0, 120).replace(/\n/g, ' / ')}`);
  }

  process.exit(0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
