'use strict';

/**
 * PM KB Maintenance Service — Phase 5 Track F-4
 *
 * 每週(7d cron)掃描 PM-新聞庫 chunks > 90 天 → soft archive(SET archived_at)
 * archived chunks 在 kbRetrieval.js 已被 WHERE archived_at IS NULL 過濾,
 * 不參與檢索,但保留可查(可從 admin /admin/pm-health 還原)。
 *
 * 安全機制:
 *   - 只動 KB code in SAFE_PM_KB_CODES(預設 'PM-新聞庫');其他 KB 不碰
 *   - dry_run 模式預設 true(只 log 不真改);環境變數 PM_KB_ARCHIVE_DRYRUN=false 才執行
 *
 * Trigger:
 *   - server.js startKbMaintenanceCron()
 *   - admin: POST /api/pm/admin/kb-maintenance/run-now(支援 dry_run param)
 */

const SAFE_PM_KB_CODES = ['PM-新聞庫'];
const ARCHIVE_AFTER_DAYS = 90;
const RUN_EVERY_HOURS = 7 * 24;
const FIRST_RUN_DELAY_MS = 10 * 60 * 1000;
const DEFAULT_DRY_RUN = process.env.PM_KB_ARCHIVE_DRYRUN !== 'false';

let _interval = null;
let _lastRun = null;

function startKbMaintenanceCron() {
  console.log(`[PmKbMaint] Starting cron — every ${RUN_EVERY_HOURS}h, dry_run default=${DEFAULT_DRY_RUN}`);
  setTimeout(() => runOnce({ dryRun: DEFAULT_DRY_RUN }).catch(e => console.error('[PmKbMaint] initial:', e.message)), FIRST_RUN_DELAY_MS);
  _interval = setInterval(
    () => runOnce({ dryRun: DEFAULT_DRY_RUN }).catch(e => console.error('[PmKbMaint] tick:', e.message)),
    RUN_EVERY_HOURS * 60 * 60 * 1000,
  );
}

function stopKbMaintenanceCron() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

async function runOnce({ dryRun = DEFAULT_DRY_RUN } = {}) {
  const db = require('../database-oracle').db;
  if (!db) return { ok: false };
  const startedAt = new Date();

  let totalArchived = 0;
  const perKb = [];

  for (const kbName of SAFE_PM_KB_CODES) {
    const kb = await db.prepare(`SELECT id, name FROM knowledge_bases WHERE name=?`).get(kbName);
    if (!kb) {
      console.log(`[PmKbMaint] KB "${kbName}" not found, skip`);
      continue;
    }

    // 找候選 chunks(透過 kb_documents.created_date 判斷,因 kb_chunks 沒 created_at)
    const candidates = await db.prepare(`
      SELECT c.id
      FROM kb_chunks c
      JOIN kb_documents d ON d.id = c.doc_id
      WHERE c.kb_id = ? AND c.archived_at IS NULL
        AND d.created_date < SYSDATE - ?
    `).all(kb.id, ARCHIVE_AFTER_DAYS);

    const ids = (candidates || []).map(r => r.id || r.ID);
    perKb.push({ kbName, kbId: kb.id, candidateCount: ids.length });

    if (!dryRun && ids.length > 0) {
      // 分批 update(避免單次 IN 太大)
      const BATCH = 500;
      for (let i = 0; i < ids.length; i += BATCH) {
        const slice = ids.slice(i, i + BATCH);
        const placeholders = slice.map(() => '?').join(',');
        try {
          await db.prepare(`
            UPDATE kb_chunks
            SET archived_at = SYSTIMESTAMP, archive_reason = 'pm_kb_maint_90d'
            WHERE id IN (${placeholders})
          `).run(...slice);
          totalArchived += slice.length;
        } catch (e) {
          console.error(`[PmKbMaint] archive batch failed:`, e.message);
        }
      }
    }
  }

  _lastRun = startedAt.toISOString();
  console.log(`[PmKbMaint] Done — dry_run=${dryRun}, totalArchived=${totalArchived}, perKb=${JSON.stringify(perKb)}`);
  return { ok: true, dryRun, totalArchived, perKb };
}

/**
 * Restore archived chunks(admin 救援用)
 */
async function restoreArchived({ kbId } = {}) {
  const db = require('../database-oracle').db;
  if (!db) return { ok: false };
  const r = await db.prepare(`
    UPDATE kb_chunks SET archived_at=NULL, archive_reason=NULL
    WHERE kb_id = ? AND archived_at IS NOT NULL
  `).run(kbId);
  return { ok: true, restored: r?.rowsAffected ?? r?.changes ?? 0 };
}

function getLastRunMeta() {
  return { lastRun: _lastRun, defaultDryRun: DEFAULT_DRY_RUN };
}

module.exports = {
  startKbMaintenanceCron,
  stopKbMaintenanceCron,
  runOnce,
  restoreArchived,
  getLastRunMeta,
};
