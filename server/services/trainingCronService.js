/**
 * trainingCronService — 訓練平台自動化任務
 * 1. 自動完成過期專案 (end_date < today)
 * 2. 到期前提醒 (remind_before_days)
 * 3. 逾期通知 (notify_overdue)
 *
 * 每日 01:30 AM (Asia/Taipei) 執行
 */

const cron = require('node-cron');

let _db = null;

function initTrainingCron(db) {
  _db = db;

  // Run daily at 01:30 AM (Asia/Taipei)
  cron.schedule('30 1 * * *', () => {
    runTrainingJobs().catch(e => console.error('[TrainingCron] Error:', e.message));
  }, { timezone: 'Asia/Taipei' });

  console.log('[TrainingCron] Scheduled daily at 01:30 AM Asia/Taipei');
}

async function runTrainingJobs() {
  if (!_db) return;
  const db = _db;
  console.log('[TrainingCron] Running daily training jobs...');

  // ── 1. Auto-complete expired programs ────────────────────────
  try {
    const expired = await db.prepare(`
      SELECT id, title FROM training_programs
      WHERE status = 'active' AND end_date < TRUNC(SYSDATE)
    `).all();

    for (const prog of expired) {
      await db.prepare(`
        UPDATE training_programs SET status='completed', completed_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP WHERE id=?
      `).run(prog.id);
      console.log(`[TrainingCron] Auto-completed program ${prog.id}: ${prog.title}`);
    }
  } catch (e) {
    console.error('[TrainingCron] Auto-complete error:', e.message);
  }

  // ── 2. 到期前提醒 ───────────────────────────────────────────
  try {
    const remindPrograms = await db.prepare(`
      SELECT id, title, end_date, remind_before_days, email_enabled
      FROM training_programs
      WHERE status = 'active'
        AND remind_before_days > 0
        AND TRUNC(end_date) - TRUNC(SYSDATE) <= remind_before_days
        AND TRUNC(end_date) >= TRUNC(SYSDATE)
    `).all();

    for (const prog of remindPrograms) {
      // Find users with incomplete assignments
      const users = await db.prepare(`
        SELECT DISTINCT pa.user_id, u.name, u.email
        FROM program_assignments pa
        JOIN users u ON u.id = pa.user_id
        WHERE pa.program_id = ? AND pa.status IN ('pending', 'in_progress')
      `).all(prog.id);

      const daysLeft = Math.ceil((new Date(prog.end_date).getTime() - Date.now()) / 86400000);

      for (const u of users) {
        // Check if we already sent a reminder today
        const existing = await db.prepare(`
          SELECT id FROM training_notifications
          WHERE user_id=? AND type='remind_before_due'
            AND TRUNC(created_at) = TRUNC(SYSDATE)
            AND message LIKE ?
        `).get(u.user_id, `%${prog.title}%`);
        if (existing) continue;

        // In-app notification
        await db.prepare(`
          INSERT INTO training_notifications (user_id, type, title, message, link_url)
          VALUES (?, 'remind_before_due', ?, ?, '/training/classroom')
        `).run(u.user_id, `${prog.title} 即將到期`,
          `訓練專案「${prog.title}」將在 ${daysLeft} 天後到期，請儘快完成學習。`);

        // Email
        if (prog.email_enabled && u.email) {
          try {
            const mailService = require('./mailService');
            mailService.sendMail({
              to: u.email,
              subject: `[訓練提醒] ${prog.title} 即將到期`,
              html: `<p>${u.name} 您好，</p>
                <p>訓練專案「<b>${prog.title}</b>」將在 <b>${daysLeft}</b> 天後到期。</p>
                <p>請儘快完成學習。</p>`
            }).catch(() => {});
          } catch (e) { /* mail service not available */ }
        }
      }

      if (users.length > 0) {
        console.log(`[TrainingCron] Sent remind for program ${prog.id} to ${users.length} users`);
      }
    }
  } catch (e) {
    console.error('[TrainingCron] Remind error:', e.message);
  }

  // ── 3. 逾期通知 ────────────────────────────────────────────
  try {
    const overduePrograms = await db.prepare(`
      SELECT id, title, end_date, email_enabled
      FROM training_programs
      WHERE status = 'completed'
        AND notify_overdue = 1
        AND TRUNC(end_date) < TRUNC(SYSDATE)
    `).all();

    for (const prog of overduePrograms) {
      const users = await db.prepare(`
        SELECT DISTINCT pa.user_id, u.name, u.email
        FROM program_assignments pa
        JOIN users u ON u.id = pa.user_id
        WHERE pa.program_id = ? AND pa.status IN ('pending', 'in_progress')
      `).all(prog.id);

      for (const u of users) {
        // Skip if already notified for overdue
        const existing = await db.prepare(`
          SELECT id FROM training_notifications
          WHERE user_id=? AND type='overdue' AND message LIKE ?
        `).get(u.user_id, `%${prog.title}%`);
        if (existing) continue;

        await db.prepare(`
          INSERT INTO training_notifications (user_id, type, title, message, link_url)
          VALUES (?, 'overdue', ?, ?, '/training/classroom')
        `).run(u.user_id, `${prog.title} 已逾期`,
          `訓練專案「${prog.title}」已於 ${new Date(prog.end_date).toLocaleDateString()} 到期，但您尚有未完成的課程。`);

        if (prog.email_enabled && u.email) {
          try {
            const mailService = require('./mailService');
            mailService.sendMail({
              to: u.email,
              subject: `[訓練逾期] ${prog.title}`,
              html: `<p>${u.name} 您好，</p>
                <p>訓練專案「<b>${prog.title}</b>」已逾期，您仍有未完成的課程。</p>`
            }).catch(() => {});
          } catch (e) { /* mail service not available */ }
        }
      }

      if (users.length > 0) {
        console.log(`[TrainingCron] Sent overdue notice for program ${prog.id} to ${users.length} users`);
      }
    }
  } catch (e) {
    console.error('[TrainingCron] Overdue error:', e.message);
  }

  // ── 4. Auto-sync new active users to existing active programs ─
  // 補:平台後續新進的 user(例如 LDAP/SSO 自動建檔)不會自動加入既有 active programs。
  // 每天掃一次,把 program_targets 重新展開後,把缺少的 (user_id × course_id) 補進 program_assignments。
  try {
    const activePrograms = await db.prepare(`
      SELECT id, title, learning_path_id, end_date
      FROM training_programs WHERE status='active'
    `).all();

    for (const prog of activePrograms) {
      // Resolve courses (mirrors activate endpoint)
      let courseIds = [];
      if (prog.learning_path_id) {
        const pc = await db.prepare(
          'SELECT course_id FROM learning_path_courses WHERE path_id=? ORDER BY sort_order'
        ).all(prog.learning_path_id);
        courseIds = pc.map(c => c.course_id);
      } else {
        const pc = await db.prepare(
          'SELECT course_id FROM program_courses WHERE program_id=? ORDER BY sort_order'
        ).all(prog.id);
        courseIds = pc.map(c => c.course_id);
      }
      if (courseIds.length === 0) continue;

      // Resolve target users (must mirror activate's target_type handling)
      const targets = await db.prepare('SELECT * FROM program_targets WHERE program_id=?').all(prog.id);
      const userIdSet = new Set();
      for (const t of targets) {
        let users = [];
        if (t.target_type === 'public') {
          users = await db.prepare("SELECT id FROM users WHERE status='active'").all();
        } else if (t.target_type === 'user') {
          users = [{ id: Number(t.target_id) }];
        } else if (t.target_type === 'dept' || t.target_type === 'department') {
          users = await db.prepare("SELECT id FROM users WHERE dept_code=? AND status='active'").all(t.target_id);
        } else if (t.target_type === 'role') {
          users = await db.prepare("SELECT id FROM users WHERE role_id=? AND status='active'").all(Number(t.target_id));
        } else if (t.target_type === 'cost_center' || t.target_type === 'profit_center') {
          users = await db.prepare("SELECT id FROM users WHERE profit_center=? AND status='active'").all(t.target_id);
        } else if (t.target_type === 'division' || t.target_type === 'org_section') {
          users = await db.prepare("SELECT id FROM users WHERE org_section=? AND status='active'").all(t.target_id);
        } else if (t.target_type === 'factory') {
          users = await db.prepare("SELECT id FROM users WHERE factory_code=? AND status='active'").all(t.target_id);
        } else if (t.target_type === 'org_group') {
          users = await db.prepare("SELECT id FROM users WHERE org_group_name=? AND status='active'").all(t.target_id);
        }
        for (const u of users) userIdSet.add(u.id);
      }
      if (userIdSet.size === 0) continue;

      // Diff against existing assignments (user_id × course_id)
      const existing = await db.prepare(
        'SELECT user_id, course_id FROM program_assignments WHERE program_id=?'
      ).all(prog.id);
      const existingPair = new Set(existing.map(e => `${e.user_id}|${e.course_id}`));

      // database-oracle.js lowercaseKeys 把 Oracle DATE → ISO 字串(line 46),
      // 直接 bind 回 DATE 欄位會被 NLS_DATE_FORMAT 當 literal 解 → ORA-01861。
      // 統一轉回 Date 物件,讓 oracledb 走 DATE typing path。
      const dueDate = prog.end_date ? new Date(prog.end_date) : null;
      let added = 0;
      for (const uid of userIdSet) {
        for (const cid of courseIds) {
          if (existingPair.has(`${uid}|${cid}`)) continue;
          try {
            await db.prepare(`
              INSERT INTO program_assignments (program_id, course_id, user_id, due_date, status)
              VALUES (?, ?, ?, ?, 'pending')
            `).run(prog.id, cid, uid, dueDate);
            added++;
          } catch (e) {
            if (!e.message?.includes('UQ_PROG_ASSIGN')) throw e;
          }
        }
      }
      if (added > 0) {
        console.log(`[TrainingCron] Auto-synced ${added} new assignments for program ${prog.id}: ${prog.title}`);
      }
    }
  } catch (e) {
    console.error('[TrainingCron] Auto-sync targets error:', e.message);
  }

  console.log('[TrainingCron] Daily jobs completed');
}

/**
 * 新進 user(SSO/LDAP 首次登入)即時掛入符合的 active programs。
 * 不等到隔天 01:30 cron。fire-and-forget,失敗 log 但不擋登入。
 * 注意:dept/role/factory 之類 target 需要 org 欄位已寫入。
 *   呼叫端通常先 await syncOrgToUsers 再 call 本函式。
 */
async function assignNewUserToActivePrograms(db, userId) {
  if (!db || !userId) return;
  try {
    const u = await db.prepare(`
      SELECT id, status, dept_code, role_id, profit_center, org_section, factory_code, org_group_name
      FROM users WHERE id=?
    `).get(userId);
    if (!u || u.status !== 'active') return;

    const activePrograms = await db.prepare(`
      SELECT id, title, learning_path_id, end_date FROM training_programs WHERE status='active'
    `).all();

    for (const prog of activePrograms) {
      const targets = await db.prepare(
        'SELECT target_type, target_id FROM program_targets WHERE program_id=?'
      ).all(prog.id);

      const matched = targets.some(t => {
        if (t.target_type === 'public') return true;
        if (t.target_type === 'user') return Number(t.target_id) === u.id;
        if (t.target_type === 'dept' || t.target_type === 'department') return t.target_id === u.dept_code;
        if (t.target_type === 'role') return Number(t.target_id) === u.role_id;
        if (t.target_type === 'cost_center' || t.target_type === 'profit_center') return t.target_id === u.profit_center;
        if (t.target_type === 'division' || t.target_type === 'org_section') return t.target_id === u.org_section;
        if (t.target_type === 'factory') return t.target_id === u.factory_code;
        if (t.target_type === 'org_group') return t.target_id === u.org_group_name;
        return false;
      });
      if (!matched) continue;

      let courseIds = [];
      if (prog.learning_path_id) {
        const pc = await db.prepare(
          'SELECT course_id FROM learning_path_courses WHERE path_id=? ORDER BY sort_order'
        ).all(prog.learning_path_id);
        courseIds = pc.map(c => c.course_id);
      } else {
        const pc = await db.prepare(
          'SELECT course_id FROM program_courses WHERE program_id=? ORDER BY sort_order'
        ).all(prog.id);
        courseIds = pc.map(c => c.course_id);
      }
      if (courseIds.length === 0) continue;

      // 同 cron 段:lowercaseKeys 已把 end_date 轉成 ISO 字串,bind 回 DATE 會 ORA-01861。
      const dueDate = prog.end_date ? new Date(prog.end_date) : null;
      let added = 0;
      for (const cid of courseIds) {
        try {
          await db.prepare(`
            INSERT INTO program_assignments (program_id, course_id, user_id, due_date, status)
            VALUES (?, ?, ?, ?, 'pending')
          `).run(prog.id, cid, u.id, dueDate);
          added++;
        } catch (e) {
          if (!e.message?.includes('UQ_PROG_ASSIGN')) throw e;
        }
      }
      if (added > 0) {
        console.log(`[TrainingAutoAssign] user=${u.id} → program=${prog.id} (${prog.title}): +${added} assignment(s)`);
      }
    }
  } catch (e) {
    console.warn('[TrainingAutoAssign] error:', e.message);
  }
}

module.exports = { initTrainingCron, assignNewUserToActivePrograms };
