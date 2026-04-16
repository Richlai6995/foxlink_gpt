/**
 * Feedback Redaction Demo
 *
 * 跑最近 N 張 resolved 工單，產生脫敏 before/after 對照給 user review
 *
 * Usage:
 *   node server/scripts/feedbackRedactionDemo.js              # 預設 10 張
 *   node server/scripts/feedbackRedactionDemo.js --count=20
 *   node server/scripts/feedbackRedactionDemo.js --ticket-id=123
 *
 * 輸出: server/tmp/feedback-redact-demo-<timestamp>.md
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { init, db: _db } = require('../database-oracle');
const feedbackService = require('../services/feedbackService');
const redactor = require('../services/feedbackRedactor');

function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
    else if (a.startsWith('--')) args[a.slice(2)] = true;
  }
  return args;
}

function sep(title) {
  return `\n---\n\n## ${title}\n\n`;
}

async function main() {
  const args = parseArgs();
  const count = Number(args.count) || 10;
  const ticketId = args['ticket-id'] ? Number(args['ticket-id']) : null;

  console.log('[Demo] Initializing DB...');
  await init();
  const db = require('../database-oracle').db;

  let tickets;
  if (ticketId) {
    const one = await feedbackService.getTicketById(db, ticketId);
    tickets = one ? [one] : [];
  } else {
    tickets = await db.prepare(`
      SELECT t.*, c.name AS category_name
      FROM feedback_tickets t
      LEFT JOIN feedback_categories c ON c.id = t.category_id
      WHERE t.status IN ('resolved', 'closed')
      ORDER BY t.resolved_at DESC NULLS LAST, t.updated_at DESC
      FETCH FIRST ? ROWS ONLY
    `).all(count);
  }

  if (tickets.length === 0) {
    console.log('[Demo] No resolved tickets found.');
    process.exit(0);
  }
  console.log(`[Demo] Processing ${tickets.length} tickets...`);

  const tmpDir = path.join(__dirname, '../tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const outFile = path.join(tmpDir, `feedback-redact-demo-${Date.now()}.md`);

  const out = [];
  out.push('# Feedback 脫敏 Demo');
  out.push(`生成時間: ${new Date().toISOString()}`);
  out.push(`模型: ${redactor.MODEL_FLASH}`);
  out.push(`樣本: ${tickets.length} 張工單\n`);
  out.push('> 規則: 替換人名/工號/email → placeholder，其餘（部門、機台 SN、錯誤訊息、技術內容）原樣保留\n');

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const messages = await feedbackService.listMessages(db, ticket.id, true);

    // 組成「完整工單對話文本」— 模擬真正要進 KB 的內容
    const parts = [
      `【工單】${ticket.ticket_no}  分類: ${ticket.category_name || '-'}`,
      `【申請者】${ticket.applicant_name || '-'}  工號: ${ticket.applicant_employee_id || '-'}  Email: ${ticket.applicant_email || '-'}  部門: ${ticket.applicant_dept || '-'}`,
      `【主旨】${ticket.subject}`,
      `【描述】\n${ticket.description || '(無)'}`,
    ];
    for (const m of messages) {
      if (m.is_system) continue; // 系統訊息略過
      const tag = m.is_internal ? '[內部備註]' : '';
      parts.push(`\n【${m.sender_role === 'admin' ? '客服' : '申請者'}】${m.sender_name || ''} ${tag}\n${m.content}`);
    }
    if (ticket.resolution_note) {
      parts.push(`\n【解決說明】\n${ticket.resolution_note}`);
    }
    const original = parts.join('\n');

    const t0 = Date.now();
    let redacted = '';
    let source = '';
    let error = '';
    try {
      const result = await redactor.redactSafe(original, ticket, { timeoutMs: 45000 });
      redacted = result.text;
      source = result.source;
    } catch (e) {
      error = e.message;
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`  [${i + 1}/${tickets.length}] ${ticket.ticket_no} — ${source || 'ERROR'} (${elapsed}s)`);

    out.push(sep(`${i + 1}. ${ticket.ticket_no} — ${ticket.subject}`));
    out.push(`- **脫敏來源**: \`${source || 'error'}\` ｜ **耗時**: ${elapsed}s`);
    if (error) out.push(`- **錯誤**: ${error}`);
    out.push('\n### 原始\n');
    out.push('```');
    out.push(original);
    out.push('```');
    out.push('\n### 脫敏後\n');
    out.push('```');
    out.push(redacted || '(空)');
    out.push('```');

    // rate limit 保護
    await new Promise(r => setTimeout(r, 500));
  }

  fs.writeFileSync(outFile, out.join('\n'), 'utf8');
  console.log(`\n[Demo] Done. Output: ${outFile}`);
  process.exit(0);
}

main().catch(e => {
  console.error('[Demo] FATAL:', e);
  process.exit(1);
});
