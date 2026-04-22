/**
 * System Sync Scheduler
 *
 * 統一管理 server-level sync service 的 cron 排程(目前 2 個:factory_code_lookup / indirect_emp_by_pc_factory)。
 * 設定存於 system_settings 表 (key: `sync_<name>_<field>`),由 admin 在 ETL 排程 UI 維護。
 *
 * 支援頻率:
 *   - daily  : 每天 HH:00 跑
 *   - weekly : 每週指定 weekday HH:00 跑(weekday: 0=Sun, 1=Mon, ..., 6=Sat)
 *   - monthly: 每月指定 day_of_month HH:00 跑(day_of_month: 1~28,避開月底邊界)
 *
 * 預設值:disabled(user 沒設前不跑 cron,只有 server.js 啟動 setTimeout 5s 跑一次)
 */

'use strict';

const cron = require('node-cron');

// 對應 sync name → runner getter
const SYNC_RUNNERS = {
  factory_code_lookup: () => require('./factoryCodeLookupSync').syncFactoryCodeLookup,
  indirect_emp_by_pc_factory: () => require('./indirectEmpSync').syncIndirectEmpByPcFactory,
};

const tasks = new Map(); // syncName → ScheduledTask

function buildCronExpr({ type, hour, weekday, day_of_month }) {
  const h = Math.max(0, Math.min(23, parseInt(hour ?? 2)));
  if (type === 'weekly') {
    const w = Math.max(0, Math.min(6, parseInt(weekday ?? 1)));
    return `0 ${h} * * ${w}`;
  }
  if (type === 'monthly') {
    const d = Math.max(1, Math.min(28, parseInt(day_of_month ?? 1)));
    return `0 ${h} ${d} * *`;
  }
  return `0 ${h} * * *`; // daily
}

/** 啟動 / 重啟單一 sync 的 cron(若 enabled=false 則只清掉舊 task) */
function startOne(db, syncName, settings) {
  const existing = tasks.get(syncName);
  if (existing) { existing.stop(); tasks.delete(syncName); }

  if (!settings || !settings.enabled) {
    console.log(`[SystemSyncScheduler] ${syncName}: disabled`);
    return null;
  }
  const runnerGetter = SYNC_RUNNERS[syncName];
  if (!runnerGetter) {
    console.warn(`[SystemSyncScheduler] ${syncName}: unknown sync, skip`);
    return null;
  }

  const expr = buildCronExpr(settings);
  const task = cron.schedule(expr, async () => {
    console.log(`[SystemSyncScheduler] ${syncName}: run (${expr})`);
    try {
      const runner = runnerGetter();
      await runner(db);
    } catch (e) {
      console.error(`[SystemSyncScheduler] ${syncName} error:`, e.message);
    }
  });
  tasks.set(syncName, task);
  console.log(`[SystemSyncScheduler] ${syncName}: scheduled (${expr})`);
  return expr;
}

/** server 啟動時呼叫:讀全部設定並註冊 cron */
async function loadAndStart(db) {
  for (const name of Object.keys(SYNC_RUNNERS)) {
    try {
      const settings = await loadSettings(db, name);
      startOne(db, name, settings);
    } catch (e) {
      console.warn(`[SystemSyncScheduler] ${name} init error:`, e.message);
    }
  }
}

async function loadSettings(db, name) {
  const prefix = `sync_${name}_`;
  const rows = await db.prepare(
    `SELECT key, value FROM system_settings WHERE key LIKE ?`
  ).all(prefix + '%');
  const m = {};
  for (const r of rows) {
    const k = (r.key || r.KEY || '').replace(prefix, '');
    m[k] = r.value || r.VALUE || '';
  }
  return {
    enabled:      m.enabled === '1',
    type:         m.type || 'daily',
    hour:         parseInt(m.hour ?? '2'),
    weekday:      parseInt(m.weekday ?? '1'),
    day_of_month: parseInt(m.day_of_month ?? '1'),
  };
}

async function saveSettings(db, name, settings) {
  if (!SYNC_RUNNERS[name]) throw new Error(`Unknown sync: ${name}`);
  const fields = {
    enabled:      settings.enabled ? '1' : '0',
    type:         String(settings.type || 'daily'),
    hour:         String(parseInt(settings.hour ?? 2)),
    weekday:      String(parseInt(settings.weekday ?? 1)),
    day_of_month: String(parseInt(settings.day_of_month ?? 1)),
  };
  for (const [field, val] of Object.entries(fields)) {
    const key = `sync_${name}_${field}`;
    const existing = await db.prepare(`SELECT key FROM system_settings WHERE key=?`).get(key);
    if (existing) {
      await db.prepare(`UPDATE system_settings SET value=? WHERE key=?`).run(val, key);
    } else {
      await db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?)`).run(key, val);
    }
  }
}

/** 取得目前該 sync 的 cron expression(僅 active 時有值);用於 UI 顯示「下次預定」相關資訊 */
function getActiveCron(name) {
  const t = tasks.get(name);
  return t ? buildCronExpr({ type: 'unknown' }) : null; // 已 stop 的 task 沒 expr,純粹存在性
}

module.exports = {
  loadAndStart,
  loadSettings,
  saveSettings,
  startOne,
  buildCronExpr,
  getActiveCron,
  SYNC_NAMES: Object.keys(SYNC_RUNNERS),
};
