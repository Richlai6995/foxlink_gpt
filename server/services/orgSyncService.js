/**
 * Org Sync Service
 * - syncOrgToUsers: sync Oracle ERP org data into users table
 * - startScheduler / stopScheduler: daily cron to keep org_end_date fresh
 */

const cron = require('node-cron');

let scheduledTask = null;

/**
 * Sync org data from Oracle into users.org_* columns.
 * @param {object} db
 * @param {string[]|null} employeeNos  null = all active users with employee_id
 */
async function syncOrgToUsers(db, employeeNos = null) {
  const { isConfigured, getEmployeeOrgData } = require('./erpDb');
  if (!isConfigured()) {
    console.log('[OrgSync] ERP DB not configured, skipping.');
    return { synced: 0, skipped: true };
  }

  let empNos = employeeNos;
  if (!empNos) {
    const users = await db
      .prepare(`SELECT employee_id FROM users WHERE employee_id IS NOT NULL AND employee_id != '' AND status = 'active'`)
      .all();
    empNos = [...new Set(users.map((u) => String(u.employee_id)).filter(Boolean))];
  }

  if (!empNos.length) {
    console.log('[OrgSync] No employees to sync.');
    return { synced: 0 };
  }

  const rows = await getEmployeeOrgData(empNos);
  let synced = 0;

  for (const r of rows) {
    const now = new Date().toISOString();
    await db.prepare(`
      UPDATE users SET
        dept_code=?, dept_name=?,
        profit_center=?, profit_center_name=?,
        org_section=?, org_section_name=?,
        org_group_name=?, factory_code=?,
        org_end_date=?, org_synced_at=?
      WHERE employee_id=?
    `).run(
      r.DEPT_CODE || null,
      r.DEPT_NAME || null,
      r.PROFIT_CENTER || null,
      r.PROFIT_CENTER_NAME || null,
      r.ORG_SECTION || null,
      r.ORG_SECTION_NAME || null,
      r.ORG_GROUP_NAME || null,
      r.FACTORY_CODE || null,
      r.END_DATE ? String(r.END_DATE) : null,
      now,
      r.EMPLOYEE_NO,
    );
    synced++;
  }

  console.log(`[OrgSync] syncOrgToUsers done: ${synced} records updated.`);
  return { synced };
}

/**
 * Legacy: run full org sync (still updates org_cache too)
 * Kept for backward compat with existing cron usage.
 */
async function runOrgSync(db) {
  const { isConfigured, getEmployeeOrgData } = require('./erpDb');
  if (!isConfigured()) {
    console.log('[OrgSync] ERP DB not configured, skipping.');
    return { synced: 0, skipped: true };
  }

  const users = await db
    .prepare(`SELECT employee_id FROM users WHERE employee_id IS NOT NULL AND employee_id != '' AND status = 'active'`)
    .all();

  const empNos = [...new Set(users.map((u) => String(u.employee_id)).filter(Boolean))];
  if (!empNos.length) {
    console.log('[OrgSync] No employees to sync.');
    return { synced: 0 };
  }

  const rows = await getEmployeeOrgData(empNos);
  let updated = 0;

  for (const r of rows) {
    const existing = await db.prepare('SELECT employee_no FROM org_cache WHERE employee_no=?').get(r.EMPLOYEE_NO);
    const vals = [
      r.C_NAME || null, r.EMAIL || null, r.DEPT_CODE || null, r.DEPT_NAME || null,
      r.PROFIT_CENTER || null, r.PROFIT_CENTER_NAME || null,
      r.ORG_SECTION || null, r.ORG_SECTION_NAME || null, r.ORG_GROUP_NAME || null,
      r.FACTORY_CODE || null, r.END_DATE ? String(r.END_DATE) : null,
      new Date().toISOString(), r.EMPLOYEE_NO,
    ];
    if (existing) {
      await db.prepare(`UPDATE org_cache SET c_name=?,email=?,dept_code=?,dept_name=?,
        profit_center=?,profit_center_name=?,org_section=?,org_section_name=?,
        org_group_name=?,factory_code=?,end_date=?,cached_at=? WHERE employee_no=?`).run(...vals);
    } else {
      await db.prepare(`INSERT INTO org_cache (c_name,email,dept_code,dept_name,profit_center,
        profit_center_name,org_section,org_section_name,org_group_name,factory_code,
        end_date,cached_at,employee_no) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...vals);
    }
    updated++;
  }

  // Also sync to users table
  await syncOrgToUsers(db, empNos);

  // Persist last run time
  const now = new Date().toISOString();
  const existsSetting = await db.prepare(`SELECT key FROM system_settings WHERE key='org_sync_last_run'`).get();
  if (existsSetting) {
    await db.prepare(`UPDATE system_settings SET value=? WHERE key='org_sync_last_run'`).run(now);
  } else {
    await db.prepare(`INSERT INTO system_settings (key, value) VALUES ('org_sync_last_run', ?)`).run(now);
  }

  console.log(`[OrgSync] Done: ${updated} records updated.`);
  return { synced: updated };
}

function startScheduler(db, hour) {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }

  const h = parseInt(hour);
  if (isNaN(h) || h < 0 || h > 23) return;

  const cronExpr = `0 ${h} * * *`;
  scheduledTask = cron.schedule(cronExpr, async () => {
    console.log(`[OrgSync] Scheduled run at hour ${h}...`);
    try {
      await runOrgSync(db);
    } catch (e) {
      console.error('[OrgSync] Scheduled run error:', e.message);
    }
  });

  console.log(`[OrgSync] Scheduler active: ${cronExpr}`);
}

function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  console.log('[OrgSync] Scheduler stopped.');
}

module.exports = { runOrgSync, syncOrgToUsers, startScheduler, stopScheduler };
