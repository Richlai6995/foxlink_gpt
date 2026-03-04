const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

let scheduledTask = null;

function runBackup(db) {
  const pathRow = db.prepare(`SELECT value FROM system_settings WHERE key = 'auto_backup_path'`).get();
  const backupDir = pathRow?.value?.trim();
  if (!backupDir) {
    console.warn('[Backup] No backup path configured, skipping.');
    return;
  }

  const { exportDb } = require('../database');
  const buffer = exportDb();
  if (!buffer) {
    console.error('[Backup] DB not initialized, cannot backup.');
    return;
  }

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  let filename = `foxlink_gpt_${dateStr}.db`;
  let destPath = path.join(backupDir, filename);
  let ver = 2;
  while (fs.existsSync(destPath)) {
    filename = `foxlink_gpt_${dateStr}_v${ver++}.db`;
    destPath = path.join(backupDir, filename);
  }
  fs.writeFileSync(destPath, buffer);
  console.log(`[Backup] Done: ${destPath}`);
}

/**
 * @param {object} db
 * @param {'daily'|'weekly'} type
 * @param {number} hour  0-23
 * @param {number} weekday  0=Sun, 1=Mon ... 6=Sat (only for weekly)
 */
function startBackupScheduler(db, type, hour, weekday) {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }

  const h = parseInt(hour);
  if (isNaN(h) || h < 0 || h > 23) return;

  let cronExpr;
  if (type === 'weekly') {
    const w = parseInt(weekday ?? 1);
    cronExpr = `0 ${h} * * ${w}`;
  } else {
    cronExpr = `0 ${h} * * *`;
  }

  scheduledTask = cron.schedule(cronExpr, () => {
    console.log(`[Backup] Scheduled run (${cronExpr})`);
    try {
      runBackup(db);
    } catch (e) {
      console.error('[Backup] Error:', e.message);
    }
  });

  console.log(`[Backup] Scheduler active: ${cronExpr}`);
}

function stopBackupScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  console.log('[Backup] Scheduler stopped.');
}

module.exports = { runBackup, startBackupScheduler, stopBackupScheduler };
