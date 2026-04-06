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

  console.log('[TrainingCron] Daily jobs completed');
}

module.exports = { initTrainingCron };
