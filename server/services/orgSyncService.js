/**
 * Org Sync Service
 * - syncOrgToUsers: sync Oracle ERP org data into users table (with diff + change log)
 * - runOrgSync: full sync all active users
 * - startScheduler / stopScheduler: daily cron
 */

const cron = require('node-cron');

let scheduledTask = null;

// 比對欄位（trim 後比較）
const ORG_FIELDS = [
  'dept_code', 'dept_name', 'profit_center', 'profit_center_name',
  'org_section', 'org_section_name', 'org_group_name', 'factory_code',
];

function trim(v) { return (v || '').toString().trim(); }

function diffOrgFields(current, incoming) {
  const changed = {};
  for (const f of ORG_FIELDS) {
    const oldVal = trim(current[f]);
    const newVal = trim(incoming[f]);
    if (oldVal !== newVal) {
      changed[f] = { old: oldVal || null, new: newVal || null };
    }
  }
  return changed;
}

/**
 * 寫入 org_sync_change_logs
 */
async function writeChangeLog(db, { employeeId, userName, trigger, changedFields, isDeparture, errorMsg }) {
  try {
    await db.prepare(`
      INSERT INTO org_sync_change_logs
        (employee_id, user_name, sync_trigger, changed_fields, is_departure, error_msg)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      employeeId || null,
      userName || null,
      trigger || 'scheduled',
      changedFields ? JSON.stringify(changedFields) : null,
      isDeparture ? 1 : 0,
      errorMsg || null,
    );
  } catch (e) {
    console.warn('[OrgSync] writeChangeLog error:', e.message);
  }
}

/**
 * 發 email 通知管理員有離職/換部門人員
 */
async function notifyDeparture(user, changedFields) {
  try {
    const { sendMail } = require('./mailService');
    const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || process.env.FROM_ADDRESS;
    if (!adminEmail) return;

    const fieldRows = Object.entries(changedFields || {}).map(([f, { old: o, new: n }]) =>
      `<tr><td style="padding:4px 8px;border:1px solid #ddd">${f}</td><td style="padding:4px 8px;border:1px solid #ddd">${o ?? ''}</td><td style="padding:4px 8px;border:1px solid #ddd">${n ?? ''}</td></tr>`
    ).join('');

    await sendMail({
      to: adminEmail,
      subject: `[FOXLINK GPT] 使用者組織異動通知 — ${user.employee_id} ${user.name || ''}`,
      html: `
        <h3>⚠️ 使用者組織資料異動（可能含離職/調職）</h3>
        <p>工號：<b>${user.employee_id}</b>　姓名：<b>${user.name || ''}</b>　帳號：<b>${user.username || ''}</b></p>
        <p>離職日期（org_end_date）出現或異動，請確認使用者狀態。</p>
        <table style="border-collapse:collapse;font-size:13px">
          <thead><tr>
            <th style="padding:4px 8px;border:1px solid #ddd;background:#f5f5f5">欄位</th>
            <th style="padding:4px 8px;border:1px solid #ddd;background:#f5f5f5">舊值</th>
            <th style="padding:4px 8px;border:1px solid #ddd;background:#f5f5f5">新值</th>
          </tr></thead>
          <tbody>${fieldRows}</tbody>
        </table>
        <p style="color:#888;font-size:12px">同步時間：${new Date().toLocaleString('zh-TW')}</p>
      `,
    });
  } catch (e) {
    console.warn('[OrgSync] notifyDeparture email error:', e.message);
  }
}

/**
 * Sync org data from Oracle into users.org_* columns.
 * @param {object} db
 * @param {string[]|null} employeeNos  null = all active users with employee_id
 * @param {string} trigger  'scheduled' | 'manual' | 'login'
 */
async function syncOrgToUsers(db, employeeNos = null, trigger = 'manual') {
  const { isConfigured, getEmployeeOrgData } = require('./erpDb');
  if (!isConfigured()) {
    console.log('[OrgSync] ERP DB not configured, skipping.');
    return { synced: 0, skipped: true };
  }

  let users;
  if (!employeeNos) {
    users = await db.prepare(
      `SELECT id, employee_id, name, email, username, dept_code, dept_name, profit_center, profit_center_name,
              org_section, org_section_name, org_group_name, factory_code, org_end_date
       FROM users WHERE employee_id IS NOT NULL AND employee_id != '' AND status = 'active'`
    ).all();
  } else {
    const placeholders = employeeNos.map(() => '?').join(',');
    users = await db.prepare(
      `SELECT id, employee_id, name, email, username, dept_code, dept_name, profit_center, profit_center_name,
              org_section, org_section_name, org_group_name, factory_code, org_end_date
       FROM users WHERE employee_id IN (${placeholders})`
    ).all(...employeeNos);
  }

  const empNos = [...new Set(users.map(u => String(u.employee_id)).filter(Boolean))];
  if (!empNos.length) {
    console.log('[OrgSync] No employees to sync.');
    return { synced: 0 };
  }

  // 查 ERP
  let rows;
  try {
    rows = await getEmployeeOrgData(empNos);
  } catch (e) {
    // ERP 連線失敗 — 記錄 log
    console.error('[OrgSync] ERP connection failed:', e.message);
    await writeChangeLog(db, {
      employeeId: null, userName: null,
      trigger, changedFields: null,
      errorMsg: `ERP 連線失敗：${e.message}`,
    });
    return { synced: 0, error: e.message };
  }

  // 建立 ERP 資料 map
  const erpMap = {};
  for (const r of rows) {
    erpMap[String(r.EMPLOYEE_NO)] = r;
  }

  let synced = 0, unchanged = 0;

  for (const user of users) {
    const empId = String(user.employee_id);
    const r = erpMap[empId];
    if (!r) continue;

    const incoming = {
      dept_code:            trim(r.DEPT_CODE),
      dept_name:            trim(r.DEPT_NAME),
      profit_center:        trim(r.PROFIT_CENTER),
      profit_center_name:   trim(r.PROFIT_CENTER_NAME),
      org_section:          trim(r.ORG_SECTION),
      org_section_name:     trim(r.ORG_SECTION_NAME),
      org_group_name:       trim(r.ORG_GROUP_NAME),
      factory_code:         trim(r.FACTORY_CODE),
    };

    const changed = diffOrgFields(user, incoming);
    const endDate = r.END_DATE
      ? (r.END_DATE instanceof Date ? r.END_DATE : new Date(r.END_DATE))
      : null;
    const oldEndDate = user.org_end_date;

    // 判斷是否離職/調職（org_end_date 首次出現或改變）
    const isDeparture = endDate && !oldEndDate;
    if (isDeparture) {
      changed['org_end_date'] = { old: oldEndDate || null, new: endDate.toISOString().slice(0, 10) };
    }

    // 補填空白的 email 和 name（從 ERP 拉回來）
    const erpEmail = trim(r.EMAIL);
    const erpName  = trim(r.C_NAME);
    const needFillEmail = erpEmail && (!user.email || user.email === '-' || user.email.trim() === '');
    const needFillName  = erpName  && (!user.name  || user.name.trim() === '');
    if (needFillEmail) {
      changed['email'] = { old: user.email || null, new: erpEmail };
    }
    if (needFillName) {
      changed['name'] = { old: user.name || null, new: erpName };
    }

    const hasChange = Object.keys(changed).length > 0;

    // 永遠更新 org_synced_at；有變動才寫其他欄位
    if (hasChange) {
      await db.prepare(`
        UPDATE users SET
          dept_code=?, dept_name=?,
          profit_center=?, profit_center_name=?,
          org_section=?, org_section_name=?,
          org_group_name=?, factory_code=?,
          org_end_date=?, org_synced_at=?,
          email=COALESCE(NULLIF(NULLIF(email,'-'),''), ?),
          name=COALESCE(NULLIF(name,''), ?)
        WHERE employee_id=?
      `).run(
        incoming.dept_code || null, incoming.dept_name || null,
        incoming.profit_center || null, incoming.profit_center_name || null,
        incoming.org_section || null, incoming.org_section_name || null,
        incoming.org_group_name || null, incoming.factory_code || null,
        endDate, new Date(),
        erpEmail || null,
        erpName || null,
        empId,
      );

      await writeChangeLog(db, {
        employeeId: empId,
        userName: user.name || user.username,
        trigger,
        changedFields: changed,
        isDeparture,
      });

      if (isDeparture) {
        await notifyDeparture(user, changed);
        // 標記 notified_admin
        await db.prepare(
          `UPDATE org_sync_change_logs SET notified_admin=1
           WHERE employee_id=? AND is_departure=1 AND notified_admin=0
           AND ROWNUM=1`
        ).run(empId);
      }

      synced++;
    } else {
      await db.prepare(`UPDATE users SET org_synced_at=? WHERE employee_id=?`).run(new Date(), empId);
      unchanged++;
    }
  }

  console.log(`[OrgSync] syncOrgToUsers done (trigger=${trigger}): changed=${synced}, unchanged=${unchanged}`);
  return { synced, unchanged };
}

/**
 * Full org sync: all active users + update org_sync_last_run
 */
async function runOrgSync(db, trigger = 'scheduled') {
  const result = await syncOrgToUsers(db, null, trigger);

  // Persist last run time
  const now = new Date().toISOString();
  const existsSetting = await db.prepare(`SELECT key FROM system_settings WHERE key='org_sync_last_run'`).get();
  if (existsSetting) {
    await db.prepare(`UPDATE system_settings SET value=? WHERE key='org_sync_last_run'`).run(now);
  } else {
    await db.prepare(`INSERT INTO system_settings (key, value) VALUES ('org_sync_last_run', ?)`).run(now);
  }

  console.log(`[OrgSync] runOrgSync done:`, result);
  return result;
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
      await runOrgSync(db, 'scheduled');
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
