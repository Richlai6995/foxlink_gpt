const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

let scheduledTask = null;

async function runBackup(db) {
  const pathRow = await db.prepare(`SELECT value FROM system_settings WHERE key = 'auto_backup_path'`).get();
  const backupDir = pathRow?.value?.trim();
  if (!backupDir) {
    console.warn('[Backup] No backup path configured, skipping.');
    return;
  }

  // Oracle DB 備份應由 Oracle RMAN / Data Pump 等機制處理
  // 此處匯出應用層資料（users, sessions, token_usage, audit_logs 等）為 JSON 備份
  const tables = ['users', 'chat_sessions', 'token_usage', 'audit_logs', 'sensitive_keywords', 'system_settings', 'llm_models'];
  const backup = {};
  for (const table of tables) {
    try {
      backup[table] = await db.prepare(`SELECT * FROM ${table}`).all();
    } catch (e) {
      backup[table] = [];
    }
  }

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  let filename = `foxlink_gpt_${dateStr}.json`;
  let destPath = path.join(backupDir, filename);
  let ver = 2;
  while (fs.existsSync(destPath)) {
    filename = `foxlink_gpt_${dateStr}_v${ver++}.json`;
    destPath = path.join(backupDir, filename);
  }
  fs.writeFileSync(destPath, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`[Backup] Done (Oracle app-data export): ${destPath}`);
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

  scheduledTask = cron.schedule(cronExpr, async () => {
    console.log(`[Backup] Scheduled run (${cronExpr})`);
    try {
      await runBackup(db);
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
