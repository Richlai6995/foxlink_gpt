'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');
const { scheduleTask, unscheduleTask, runTask, enqueue } = require('../services/scheduledTaskService');

router.use(verifyToken);

function getDb() { return require('../database-oracle').db; }

// Guard: check user permission (or admin)
async function checkPermission(req, res) {
  const db = getDb();
  const user = await db.prepare('SELECT role, allow_scheduled_tasks FROM users WHERE id=?').get(req.user.id);
  if (!user) { res.status(403).json({ error: '使用者不存在' }); return false; }
  if (user.role === 'admin') return true;

  // Global feature toggle (null/missing = default enabled)
  const globalEnabled = await db.prepare(`SELECT value FROM system_settings WHERE key='scheduled_tasks_enabled'`).get();
  if (globalEnabled && globalEnabled.value === '0') { res.status(403).json({ error: '排程功能未開放' }); return false; }
  // Per-user toggle
  if (!user.allow_scheduled_tasks) { res.status(403).json({ error: '您的帳號未開放排程功能，請聯絡管理員' }); return false; }
  return true;
}

// ── GET /api/scheduled-tasks ──────────────────────────────────────────────────
router.get('/', async (req, res) => {
  if (!await checkPermission(req, res)) return;
  const db = getDb();
  try {
    const isAdmin = req.user.role === 'admin';
    const tasks = isAdmin
      ? await db.prepare(`SELECT t.*, u.name as user_name, u.username FROM scheduled_tasks t
                    LEFT JOIN users u ON u.id=t.user_id ORDER BY t.updated_at DESC`).all()
      : await db.prepare(`SELECT * FROM scheduled_tasks WHERE user_id=? ORDER BY updated_at DESC`).all(req.user.id);
    res.json(tasks);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/scheduled-tasks ─────────────────────────────────────────────────
router.post('/', async (req, res) => {
  if (!await checkPermission(req, res)) return;
  const db = getDb();
  try {
    // Per-user limit check
    const limitRow = await db.prepare(`SELECT value FROM system_settings WHERE key='scheduled_tasks_max_per_user'`).get();
    const limit = parseInt(limitRow?.value || '10');
    const countRow = await db.prepare('SELECT COUNT(*) as n FROM scheduled_tasks WHERE user_id=?').get(req.user.id);
    if (countRow.n >= limit) return res.status(400).json({ error: `每人最多 ${limit} 個排程任務` });

    const {
      name, schedule_type, schedule_hour, schedule_minute,
      schedule_weekday, schedule_monthday,
      model, prompt, output_type, file_type, filename_template,
      recipients_json, email_subject, email_body,
      status, expire_at, max_runs,
    } = req.body;

    if (!name || !prompt) return res.status(400).json({ error: '名稱和 Prompt 為必填' });

    const result = await db.prepare(
      `INSERT INTO scheduled_tasks
        (user_id, name, schedule_type, schedule_hour, schedule_minute, schedule_weekday, schedule_monthday,
         model, prompt, output_type, file_type, filename_template,
         recipients_json, email_subject, email_body, status, expire_at, max_runs)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      req.user.id, name,
      schedule_type || 'daily',
      schedule_hour ?? 8, schedule_minute ?? 0,
      schedule_weekday ?? 1, schedule_monthday ?? 1,
      model || 'pro', prompt,
      output_type || 'text', file_type || null, filename_template || null,
      JSON.stringify(recipients_json || []),
      email_subject || null, email_body || null,
      status || 'active',
      expire_at || null,
      max_runs ?? 0,
    );

    const task = await db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(result.lastInsertRowid);
    if (task.status === 'active') scheduleTask(db, task);
    res.json(task);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/scheduled-tasks/:id ──────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  if (!await checkPermission(req, res)) return;
  const db = getDb();
  try {
    const task = await db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: '找不到任務' });
    if (task.user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: '無權限' });

    const {
      name, schedule_type, schedule_hour, schedule_minute,
      schedule_weekday, schedule_monthday,
      model, prompt, output_type, file_type, filename_template,
      recipients_json, email_subject, email_body,
      status, expire_at, max_runs,
    } = req.body;

    await db.prepare(
      `UPDATE scheduled_tasks SET
        name=?, schedule_type=?, schedule_hour=?, schedule_minute=?,
        schedule_weekday=?, schedule_monthday=?,
        model=?, prompt=?, output_type=?, file_type=?, filename_template=?,
        recipients_json=?, email_subject=?, email_body=?,
        status=?, expire_at=?, max_runs=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`
    ).run(
      name ?? task.name,
      schedule_type ?? task.schedule_type,
      schedule_hour ?? task.schedule_hour, schedule_minute ?? task.schedule_minute,
      schedule_weekday ?? task.schedule_weekday, schedule_monthday ?? task.schedule_monthday,
      model ?? task.model, prompt ?? task.prompt,
      output_type ?? task.output_type, file_type ?? task.file_type,
      filename_template ?? task.filename_template,
      recipients_json ? JSON.stringify(recipients_json) : task.recipients_json,
      email_subject ?? task.email_subject, email_body ?? task.email_body,
      status ?? task.status, expire_at ?? task.expire_at,
      max_runs ?? task.max_runs,
      req.params.id,
    );

    const updated = await db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(req.params.id);
    // Re-schedule
    unscheduleTask(parseInt(req.params.id));
    if (updated.status === 'active') scheduleTask(db, updated);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/scheduled-tasks/:id ──────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  if (!await checkPermission(req, res)) return;
  const db = getDb();
  try {
    const task = await db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: '找不到任務' });
    if (task.user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: '無權限' });

    unscheduleTask(parseInt(req.params.id));
    await db.prepare('DELETE FROM scheduled_tasks WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/scheduled-tasks/:id/toggle ─────────────────────────────────────
router.post('/:id/toggle', async (req, res) => {
  if (!await checkPermission(req, res)) return;
  const db = getDb();
  try {
    const task = await db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: '找不到任務' });
    if (task.user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: '無權限' });

    const newStatus = task.status === 'active' ? 'paused' : 'active';
    await db.prepare(`UPDATE scheduled_tasks SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(newStatus, req.params.id);

    const updated = await db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(req.params.id);
    unscheduleTask(parseInt(req.params.id));
    if (newStatus === 'active') scheduleTask(db, updated);
    res.json({ status: newStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/scheduled-tasks/:id/run-now ────────────────────────────────────
router.post('/:id/run-now', async (req, res) => {
  if (!await checkPermission(req, res)) return;
  const db = getDb();
  try {
    const task = await db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: '找不到任務' });
    if (task.user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: '無權限' });

    // Pre-check: max_runs
    if (task.max_runs > 0 && task.run_count >= task.max_runs)
      return res.status(400).json({ error: `已達最大執行次數（${task.max_runs} 次）。請編輯任務將上限調高或設為 0 不限次數。` });
    // Pre-check: expire_at
    if (task.expire_at && new Date(task.expire_at) < new Date())
      return res.status(400).json({ error: '任務已到期，請編輯到期日後再執行。' });

    enqueue(() => runTask(db, parseInt(req.params.id)));
    res.json({ message: '任務已加入執行佇列' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/scheduled-tasks/:id/history ─────────────────────────────────────
router.get('/:id/history', async (req, res) => {
  if (!await checkPermission(req, res)) return;
  const db = getDb();
  try {
    const task = await db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: '找不到任務' });
    if (task.user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: '無權限' });

    const limit = parseInt(req.query.limit || '30');
    const runs = await db.prepare(
      `SELECT * FROM scheduled_task_runs WHERE task_id=? ORDER BY run_at DESC LIMIT ?`
    ).all(req.params.id, limit);
    res.json(runs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
