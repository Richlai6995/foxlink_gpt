/**
 * Feedback Conversation Archive
 *
 * 工單結案/重開時寫入完整原始快照（append-only）
 * - 不做脫敏、不進 vector KB
 * - admin only 介面讀取
 */

'use strict';

const feedbackService = require('./feedbackService');

const TRIGGERS = ['resolved', 'reopened', 'closed', 'manual', 'migration'];

async function writeSnapshot(db, ticketId, trigger, triggeredBy) {
  if (!TRIGGERS.includes(trigger)) {
    throw new Error(`invalid snapshot_trigger: ${trigger}`);
  }
  const ticket = await feedbackService.getTicketById(db, ticketId);
  if (!ticket) throw new Error(`ticket ${ticketId} not found`);

  // internal notes 也要存（archive 是完整原始）
  const [messages, attachments] = await Promise.all([
    feedbackService.listMessages(db, ticketId, true),
    feedbackService.listAttachments(db, ticketId),
  ]);

  const messagesJson = JSON.stringify(messages);
  const attachmentsJson = JSON.stringify(attachments);
  const ticketSnapshot = JSON.stringify(ticket);

  const result = await db.prepare(`
    INSERT INTO feedback_conversation_archive
      (ticket_id, ticket_no, snapshot_trigger, triggered_by,
       messages_json, attachments_json, ticket_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    ticketId,
    ticket.ticket_no,
    trigger,
    triggeredBy || null,
    messagesJson,
    attachmentsJson,
    ticketSnapshot,
  );

  return { id: result.lastInsertRowid, ticket_no: ticket.ticket_no };
}

async function listSnapshots(db, ticketId) {
  return db.prepare(`
    SELECT a.id, a.ticket_id, a.ticket_no, a.snapshot_at, a.snapshot_trigger,
           a.triggered_by, u.name AS triggered_by_name, u.username AS triggered_by_username
    FROM feedback_conversation_archive a
    LEFT JOIN users u ON u.id = a.triggered_by
    WHERE a.ticket_id = ?
    ORDER BY a.snapshot_at DESC, a.id DESC
  `).all(ticketId);
}

async function getSnapshot(db, snapshotId) {
  return db.prepare(`
    SELECT a.*, u.name AS triggered_by_name, u.username AS triggered_by_username
    FROM feedback_conversation_archive a
    LEFT JOIN users u ON u.id = a.triggered_by
    WHERE a.id = ?
  `).get(snapshotId);
}

module.exports = {
  writeSnapshot,
  listSnapshots,
  getSnapshot,
  TRIGGERS,
};
