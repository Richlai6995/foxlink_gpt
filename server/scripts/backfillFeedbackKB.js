/**
 * Feedback KB 歷史回填
 *
 * 掃所有 resolved/closed 工單：
 *   1. 寫 feedback_conversation_archive snapshot (trigger='migration')，skip 若已存在
 *   2. syncTicketToKB → feedback-public（脫敏 + parent/child chunks + 附件 caption）
 *
 * Idempotent：
 *   - archive snapshot 依 (ticket_id, trigger='migration') 判斷存在，存在則跳過寫
 *   - KB sync 本身 DELETE + INSERT，可重複跑
 *
 * Usage:
 *   node server/scripts/backfillFeedbackKB.js --dry-run
 *   node server/scripts/backfillFeedbackKB.js
 *   node server/scripts/backfillFeedbackKB.js --from-ticket-id=123
 *   node server/scripts/backfillFeedbackKB.js --limit=10
 *   node server/scripts/backfillFeedbackKB.js --resume
 *   node server/scripts/backfillFeedbackKB.js --force    # 強制重寫 archive 和 KB
 *
 * 進度檔：server/tmp/backfill-progress.json
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { init } = require('../database-oracle');
const feedbackArchive = require('../services/feedbackArchive');
const { syncTicketToKB } = require('../services/feedbackKBSync');

const TMP_DIR = path.join(__dirname, '../tmp');
const PROGRESS_FILE = path.join(TMP_DIR, 'backfill-progress.json');
const DELAY_BETWEEN_TICKETS_MS = 1500;

function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
    else if (a.startsWith('--')) args[a.slice(2)] = true;
  }
  return args;
}

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return { processed_ids: [], failed: [], started_at: null };
  }
}

function saveProgress(p) {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2), 'utf8');
}

async function main() {
  const args = parseArgs();
  const dryRun = !!args['dry-run'];
  const resume = !!args['resume'];
  const force = !!args['force'];
  const fromTicketId = args['from-ticket-id'] ? Number(args['from-ticket-id']) : null;
  const limit = args['limit'] ? Number(args['limit']) : null;

  console.log(`[Backfill] mode: ${dryRun ? 'DRY-RUN' : 'REAL'} | resume: ${resume} | force: ${force}`);

  await init();
  const db = require('../database-oracle').db;

  // 撈目標工單
  const conditions = ["t.status IN ('resolved', 'closed')"];
  const binds = [];
  if (fromTicketId) {
    conditions.push('t.id >= ?');
    binds.push(fromTicketId);
  }
  const sql = `
    SELECT t.id, t.ticket_no, t.status, t.resolved_at
    FROM feedback_tickets t
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.id ASC
    ${limit ? 'FETCH FIRST ? ROWS ONLY' : ''}
  `;
  if (limit) binds.push(limit);
  const tickets = await db.prepare(sql).all(...binds);

  console.log(`[Backfill] Found ${tickets.length} resolved/closed ticket(s)`);
  if (tickets.length === 0) { process.exit(0); }

  // 已處理清單（resume 模式用）
  const progress = resume ? loadProgress() : { processed_ids: [], failed: [], started_at: new Date().toISOString() };
  const processedSet = new Set(progress.processed_ids);

  if (dryRun) {
    console.log('\n[Backfill] DRY-RUN preview:');
    for (const t of tickets.slice(0, 20)) {
      const marker = processedSet.has(t.id) ? '[SKIP resumed]' : '[PROCESS]';
      console.log(`  ${marker} id=${t.id} ${t.ticket_no} status=${t.status}`);
    }
    if (tickets.length > 20) console.log(`  ... +${tickets.length - 20} more`);
    console.log(`\n預估時間: ~${Math.ceil(tickets.length * 80 / 60)} 分鐘（假設每張 80 秒）`);
    process.exit(0);
  }

  console.log(`\n[Backfill] Starting real run. Progress → ${PROGRESS_FILE}`);
  console.log(`[Backfill] Press Ctrl+C to interrupt; resume with --resume\n`);

  let syncedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const t0 = Date.now();

  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    const prefix = `[${i + 1}/${tickets.length}] ${t.ticket_no}`;

    if (!force && processedSet.has(t.id)) {
      console.log(`${prefix} SKIP (resumed)`);
      skippedCount++;
      continue;
    }

    const tt0 = Date.now();
    try {
      // 1. Archive snapshot（若未存在則寫；force 模式一律寫）
      let wroteArchive = false;
      if (!force) {
        const existing = await db.prepare(`
          SELECT id FROM feedback_conversation_archive
          WHERE ticket_id = ? AND snapshot_trigger = 'migration'
          FETCH FIRST 1 ROWS ONLY
        `).get(t.id);
        if (!existing) {
          await feedbackArchive.writeSnapshot(db, t.id, 'migration', null);
          wroteArchive = true;
        }
      } else {
        await feedbackArchive.writeSnapshot(db, t.id, 'migration', null);
        wroteArchive = true;
      }

      // 2. KB sync
      const result = await syncTicketToKB(db, t.id);
      const elapsed = ((Date.now() - tt0) / 1000).toFixed(1);

      if (result?.ok) {
        console.log(`${prefix} OK (archive=${wroteArchive ? 'new' : 'skip'} / chunks=${result.chunks} / att=${result.attachments} / ${elapsed}s)`);
        syncedCount++;
      } else {
        console.log(`${prefix} SKIP (${result?.skipped || result?.error || 'unknown'})`);
        skippedCount++;
      }

      progress.processed_ids.push(t.id);
    } catch (e) {
      const elapsed = ((Date.now() - tt0) / 1000).toFixed(1);
      console.error(`${prefix} FAIL (${elapsed}s): ${e.message}`);
      progress.failed.push({ id: t.id, ticket_no: t.ticket_no, error: e.message, at: new Date().toISOString() });
      failedCount++;
    }

    // 每張存一次進度，支援中斷續跑
    saveProgress(progress);

    if (i < tickets.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_TICKETS_MS));
    }
  }

  const totalMin = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n[Backfill] Done in ${totalMin} min`);
  console.log(`  synced:  ${syncedCount}`);
  console.log(`  skipped: ${skippedCount}`);
  console.log(`  failed:  ${failedCount}`);
  if (failedCount > 0) {
    console.log(`\n失敗清單在 ${PROGRESS_FILE}`);
  }
  process.exit(0);
}

main().catch(e => {
  console.error('[Backfill] FATAL:', e);
  process.exit(1);
});
