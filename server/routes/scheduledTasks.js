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

// ── 分享權限 helper ──────────────────────────────────────────────────────────
// 給定 task + req.user 算出 effective 權限:
//   { role: 'admin'|'owner'|'develop'|'use'|null }
//   admin → 全部能做(含 delete + 改 shares)
//   owner → task.user_id 是自己,等同 admin 對此任務(含 delete + 改 shares)
//   develop → 改設定 / 立刻執行 / toggle / 改收件人,但不能 delete / 改 shares
//   use → 只能看(列表 / 歷史 / 下載產出)
//   null → 無權限
// 從 scheduled_task_shares 撈,跟 ai_dashboard_shares 的 7 種 grantee_type 對齊
async function resolveTaskRole(db, task, user) {
  if (user.role === 'admin') return 'admin';
  if (task.user_id === user.id) return 'owner';
  const u = await db.prepare(
    `SELECT role_id, dept_code, profit_center, org_section, factory_code, org_group_name FROM users WHERE id=?`
  ).get(user.id) || {};
  const rows = await db.prepare(
    `SELECT share_type FROM scheduled_task_shares WHERE task_id=? AND (
       (grantee_type='user'        AND grantee_id=?) OR
       (grantee_type='role'        AND grantee_id=?) OR
       (grantee_type='department'  AND grantee_id=? AND ? IS NOT NULL) OR
       (grantee_type='cost_center' AND grantee_id=? AND ? IS NOT NULL) OR
       (grantee_type='division'    AND grantee_id=? AND ? IS NOT NULL) OR
       (grantee_type='factory'     AND grantee_id=? AND ? IS NOT NULL) OR
       (grantee_type='org_group'   AND grantee_id=? AND ? IS NOT NULL)
     )`
  ).all(
    task.id,
    String(user.id), String(u.role_id || ''),
    u.dept_code || null, u.dept_code || null,
    u.profit_center || null, u.profit_center || null,
    u.org_section || null, u.org_section || null,
    u.factory_code || null, u.factory_code || null,
    u.org_group_name || null, u.org_group_name || null,
  );
  if (rows.some(r => r.share_type === 'develop')) return 'develop';
  if (rows.length > 0) return 'use';
  return null;
}

// 危險節點偵測 — db_write / kb_write / alert 任一存在 → 禁 develop 分享
function hasDangerousNodes(pipelineJsonStr) {
  if (!pipelineJsonStr) return false;
  try {
    const arr = typeof pipelineJsonStr === 'string' ? JSON.parse(pipelineJsonStr) : pipelineJsonStr;
    if (!Array.isArray(arr)) return false;
    return arr.some(n => n && (n.type === 'db_write' || n.type === 'kb_write' || n.type === 'alert'));
  } catch { return false; }
}

// ── GET /api/scheduled-tasks ──────────────────────────────────────────────────
router.get('/', async (req, res) => {
  if (!await checkPermission(req, res)) return;
  const db = getDb();
  try {
    const isAdmin = req.user.role === 'admin';
    if (isAdmin) {
      const tasks = await db.prepare(`
        SELECT t.*, u.name as user_name, u.username,
               'admin' AS share_role
        FROM scheduled_tasks t LEFT JOIN users u ON u.id=t.user_id
        ORDER BY t.updated_at DESC`).all();
      return res.json(tasks);
    }
    // 非 admin:自己擁有的 + 被分享給自己的(7 種 grantee_type)
    const u = await db.prepare(
      `SELECT role_id, dept_code, profit_center, org_section, factory_code, org_group_name FROM users WHERE id=?`
    ).get(req.user.id) || {};
    const tasks = await db.prepare(`
      SELECT t.*, ow.name AS user_name, ow.username,
             CASE WHEN t.user_id = ? THEN 'owner'
                  WHEN EXISTS (SELECT 1 FROM scheduled_task_shares s WHERE s.task_id=t.id AND s.share_type='develop' AND (
                    (s.grantee_type='user'        AND s.grantee_id=?) OR
                    (s.grantee_type='role'        AND s.grantee_id=?) OR
                    (s.grantee_type='department'  AND s.grantee_id=? AND ? IS NOT NULL) OR
                    (s.grantee_type='cost_center' AND s.grantee_id=? AND ? IS NOT NULL) OR
                    (s.grantee_type='division'    AND s.grantee_id=? AND ? IS NOT NULL) OR
                    (s.grantee_type='factory'     AND s.grantee_id=? AND ? IS NOT NULL) OR
                    (s.grantee_type='org_group'   AND s.grantee_id=? AND ? IS NOT NULL)
                  )) THEN 'develop'
                  ELSE 'use'
             END AS share_role
      FROM scheduled_tasks t
      LEFT JOIN users ow ON ow.id = t.user_id
      WHERE t.user_id = ?
         OR EXISTS (
           SELECT 1 FROM scheduled_task_shares s WHERE s.task_id=t.id AND (
             (s.grantee_type='user'        AND s.grantee_id=?) OR
             (s.grantee_type='role'        AND s.grantee_id=?) OR
             (s.grantee_type='department'  AND s.grantee_id=? AND ? IS NOT NULL) OR
             (s.grantee_type='cost_center' AND s.grantee_id=? AND ? IS NOT NULL) OR
             (s.grantee_type='division'    AND s.grantee_id=? AND ? IS NOT NULL) OR
             (s.grantee_type='factory'     AND s.grantee_id=? AND ? IS NOT NULL) OR
             (s.grantee_type='org_group'   AND s.grantee_id=? AND ? IS NOT NULL)
           )
         )
      ORDER BY t.updated_at DESC
    `).all(
      // share_role CASE 內的 binds(develop 判定):14 個
      req.user.id,
      String(req.user.id), String(u.role_id || ''),
      u.dept_code || null, u.dept_code || null,
      u.profit_center || null, u.profit_center || null,
      u.org_section || null, u.org_section || null,
      u.factory_code || null, u.factory_code || null,
      u.org_group_name || null, u.org_group_name || null,
      // 主 WHERE 的 binds:1 (user_id) + 13 (EXISTS)
      req.user.id,
      String(req.user.id), String(u.role_id || ''),
      u.dept_code || null, u.dept_code || null,
      u.profit_center || null, u.profit_center || null,
      u.org_section || null, u.org_section || null,
      u.factory_code || null, u.factory_code || null,
      u.org_group_name || null, u.org_group_name || null,
    );
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
    // 上限檢查 — admin 完全 bypass;一般 user 走 per-user override > 全域 setting > 預設 10
    if (req.user.role !== 'admin') {
      const userRow = await db.prepare(
        `SELECT scheduled_tasks_limit FROM users WHERE id=?`
      ).get(req.user.id);
      let limit;
      if (userRow?.scheduled_tasks_limit != null) {
        limit = parseInt(userRow.scheduled_tasks_limit);
      } else {
        const limitRow = await db.prepare(
          `SELECT value FROM system_settings WHERE key='scheduled_tasks_max_per_user'`
        ).get();
        limit = parseInt(limitRow?.value || '10');
      }
      const countRow = await db.prepare('SELECT COUNT(*) as n FROM scheduled_tasks WHERE user_id=?').get(req.user.id);
      if (countRow.n >= limit) return res.status(400).json({ error: `每人最多 ${limit} 個排程任務` });
    }

    const {
      name, schedule_type, schedule_hour, schedule_minute,
      schedule_weekday, schedule_monthday,
      schedule_interval_hours, schedule_times_json, schedule_cron_expr,
      model, prompt, output_type, file_type, filename_template,
      recipients_json, email_subject, email_body,
      status, expire_at, max_runs, tools_config_json, pipeline_json,
      output_template_id,
    } = req.body;

    if (!name || !prompt) return res.status(400).json({ error: '名稱和 Prompt 為必填' });

    const result = await db.prepare(
      `INSERT INTO scheduled_tasks
        (user_id, name, schedule_type, schedule_hour, schedule_minute, schedule_weekday, schedule_monthday,
         schedule_interval_hours, schedule_times_json, schedule_cron_expr,
         model, prompt, output_type, file_type, filename_template,
         recipients_json, email_subject, email_body, status, expire_at, max_runs, tools_config_json, pipeline_json,
         output_template_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      req.user.id, name,
      schedule_type || 'daily',
      schedule_hour ?? 8, schedule_minute ?? 0,
      schedule_weekday ?? 1, schedule_monthday ?? 1,
      schedule_interval_hours ?? null,
      schedule_times_json ? (typeof schedule_times_json === 'string' ? schedule_times_json : JSON.stringify(schedule_times_json)) : null,
      schedule_cron_expr || null,
      model || 'pro', prompt,
      output_type || 'text', file_type || null, filename_template || null,
      JSON.stringify(recipients_json || []),
      email_subject || null, email_body || null,
      status || 'active',
      expire_at || null,
      max_runs ?? 0,
      JSON.stringify(tools_config_json || []),
      pipeline_json ? JSON.stringify(pipeline_json) : null,
      output_template_id || null,
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
    const role = await resolveTaskRole(db, task, req.user);
    if (!role || (role !== 'admin' && role !== 'owner' && role !== 'develop'))
      return res.status(403).json({ error: '無權限修改此任務' });

    const {
      name, schedule_type, schedule_hour, schedule_minute,
      schedule_weekday, schedule_monthday,
      schedule_interval_hours, schedule_times_json, schedule_cron_expr,
      model, prompt, output_type, file_type, filename_template,
      recipients_json, email_subject, email_body,
      status, expire_at, max_runs, tools_config_json, pipeline_json,
      output_template_id,
    } = req.body;

    // develop 受贈者:若 task 已含危險節點,只能保留(不能新增 / 移除),不過此檢查由 hasDangerousNodes
    // 在 share 建立時擋(整段禁 develop 分享給 task 有危險節點者)。這裡若 develop 改了 pipeline 加入
    // 新的危險節點,需要再擋一次:
    if (role === 'develop' && pipeline_json !== undefined) {
      const newPipelineStr = pipeline_json ? (typeof pipeline_json === 'string' ? pipeline_json : JSON.stringify(pipeline_json)) : null;
      if (hasDangerousNodes(newPipelineStr)) {
        return res.status(403).json({ error: 'develop 權限不可新增 db_write / kb_write / alert 節點' });
      }
    }

    await db.prepare(
      `UPDATE scheduled_tasks SET
        name=?, schedule_type=?, schedule_hour=?, schedule_minute=?,
        schedule_weekday=?, schedule_monthday=?,
        schedule_interval_hours=?, schedule_times_json=?, schedule_cron_expr=?,
        model=?, prompt=?, output_type=?, file_type=?, filename_template=?,
        recipients_json=?, email_subject=?, email_body=?,
        status=?, expire_at=?, max_runs=?, tools_config_json=?, pipeline_json=?,
        output_template_id=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`
    ).run(
      name ?? task.name,
      schedule_type ?? task.schedule_type,
      schedule_hour ?? task.schedule_hour, schedule_minute ?? task.schedule_minute,
      schedule_weekday ?? task.schedule_weekday, schedule_monthday ?? task.schedule_monthday,
      schedule_interval_hours !== undefined ? (schedule_interval_hours || null) : task.schedule_interval_hours,
      schedule_times_json !== undefined
        ? (schedule_times_json ? (typeof schedule_times_json === 'string' ? schedule_times_json : JSON.stringify(schedule_times_json)) : null)
        : task.schedule_times_json,
      schedule_cron_expr !== undefined ? (schedule_cron_expr || null) : task.schedule_cron_expr,
      model ?? task.model, prompt ?? task.prompt,
      output_type ?? task.output_type, file_type ?? task.file_type,
      filename_template ?? task.filename_template,
      recipients_json ? JSON.stringify(recipients_json) : task.recipients_json,
      email_subject ?? task.email_subject, email_body ?? task.email_body,
      status ?? task.status, expire_at ?? task.expire_at,
      max_runs ?? task.max_runs,
      tools_config_json ? JSON.stringify(tools_config_json) : (task.tools_config_json || '[]'),
      pipeline_json !== undefined ? (pipeline_json ? JSON.stringify(pipeline_json) : null) : task.pipeline_json,
      output_template_id !== undefined ? (output_template_id || null) : task.output_template_id,
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
    // 刪除:只能 owner / admin(develop 不可刪)
    const role = await resolveTaskRole(db, task, req.user);
    if (role !== 'admin' && role !== 'owner')
      return res.status(403).json({ error: '只有任務擁有者或管理員可以刪除' });

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
    // toggle:admin / owner / develop
    const role = await resolveTaskRole(db, task, req.user);
    if (role !== 'admin' && role !== 'owner' && role !== 'develop')
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
    // run-now:admin / owner / develop(避免 view-only 受贈者狂跑燒 token)
    const role = await resolveTaskRole(db, task, req.user);
    if (role !== 'admin' && role !== 'owner' && role !== 'develop')
      return res.status(403).json({ error: '無權限執行此任務' });

    // 註:run-now 不擋 status=paused,讓 admin 暫停 cron 後仍能手動測試一次。
    //     真正的自動排程被 runTask() 開頭的 status 防線擋掉,cron 觸發路徑不會繞過。
    // Pre-check: max_runs
    if (task.max_runs > 0 && task.run_count >= task.max_runs)
      return res.status(400).json({ error: `已達最大執行次數（${task.max_runs} 次）。請編輯任務將上限調高或設為 0 不限次數。` });
    // Pre-check: expire_at
    if (task.expire_at && new Date(task.expire_at) < new Date())
      return res.status(400).json({ error: '任務已到期，請編輯到期日後再執行。' });

    enqueue(() => runTask(db, parseInt(req.params.id), {
      force: true,
      callerHint: `run-now:user=${req.user?.id || '?'}:host=${process.env.HOSTNAME || '?'}`,
    }));
    res.json({ message: '任務已加入執行佇列' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/scheduled-tasks/tools-catalog — 可用工具清單 ─────────────────────
// NOTE: must be defined BEFORE /:id/history to avoid route shadowing
router.get('/tools-catalog', async (req, res) => {
  if (!await checkPermission(req, res)) return;
  const db = getDb();
  // Map UI lang code to DB column suffix (DB wrapper lowercases all keys)
  const lang = String(req.query.lang || 'zh-TW').toLowerCase();
  const suffix = lang.startsWith('en') ? 'en' : lang.startsWith('vi') ? 'vi' : 'zh';
  // Localize a row: prefer name_{suffix} / desc_{suffix}, fallback to name / description
  const localize = (row) => ({
    ...row,
    name: row[`name_${suffix}`] || row.name,
    description: row[`desc_${suffix}`] || row.description,
  });
  try {
    // Skills: try full query with skill_access; fallback to simple query if table missing
    let skills;
    try {
      const userProfile = await db.prepare(
        'SELECT role, dept_code, profit_center, org_section, org_group_name, factory_code FROM users WHERE id=?'
      ).get(req.user.id);
      const u = userProfile || {};
      skills = await db.prepare(
        `SELECT id, name, icon, type, description, name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi FROM skills
         WHERE owner_user_id=?
            OR is_public=1
            OR EXISTS (
              SELECT 1 FROM skill_access sa WHERE sa.skill_id=skills.id AND (
                (sa.grantee_type='user' AND sa.grantee_id=TO_CHAR(?))
                OR (sa.grantee_type='role' AND sa.grantee_id=?)
                OR (sa.grantee_type='dept' AND sa.grantee_id=? AND ? IS NOT NULL)
                OR (sa.grantee_type='profit_center' AND sa.grantee_id=? AND ? IS NOT NULL)
                OR (sa.grantee_type='org_section' AND sa.grantee_id=? AND ? IS NOT NULL)
                OR (sa.grantee_type='factory' AND sa.grantee_id=? AND ? IS NOT NULL)
                OR (sa.grantee_type='org_group' AND sa.grantee_id=? AND ? IS NOT NULL)
              )
            )
         ORDER BY name ASC`
      ).all(
        req.user.id,
        req.user.id, u.role,
        u.dept_code, u.dept_code,
        u.profit_center, u.profit_center,
        u.org_section, u.org_section,
        u.factory_code, u.factory_code,
        u.org_group_name, u.org_group_name,
      );
    } catch (_) {
      // Fallback: skill_access table may not exist yet (pending migration restart)
      console.warn('[tools-catalog] skill_access fallback:', _.message);
      skills = await db.prepare(
        `SELECT id, name, icon, type, description, name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi FROM skills
         WHERE owner_user_id=? OR is_public=1
         ORDER BY name ASC`
      ).all(req.user.id);
    }

    // KBs — knowledge_bases has no is_active; use creator/public/kb_access filter
    const kbUser = await db.prepare(
      'SELECT role, role_id, dept_code, profit_center, org_section, org_group_name, factory_code FROM users WHERE id=?'
    ).get(req.user.id) || {};
    const kbs = await db.prepare(
      `SELECT kb.id, kb.name, kb.description, kb.name_zh, kb.name_en, kb.name_vi, kb.desc_zh, kb.desc_en, kb.desc_vi FROM knowledge_bases kb
       WHERE kb.creator_id=?
          OR kb.is_public=1
          OR ? IN (SELECT id FROM users WHERE role='admin')
          OR EXISTS (
            SELECT 1 FROM kb_access ka WHERE ka.kb_id=kb.id AND (
              (ka.grantee_type='user' AND ka.grantee_id=TO_CHAR(?))
              OR (ka.grantee_type='role' AND ka.grantee_id=TO_CHAR(?))
              OR (ka.grantee_type='dept'          AND ka.grantee_id=? AND ? IS NOT NULL)
              OR (ka.grantee_type='profit_center' AND ka.grantee_id=? AND ? IS NOT NULL)
              OR (ka.grantee_type='org_section'   AND ka.grantee_id=? AND ? IS NOT NULL)
              OR (ka.grantee_type='factory'       AND ka.grantee_id=? AND ? IS NOT NULL)
              OR (ka.grantee_type='org_group'     AND ka.grantee_id=? AND ? IS NOT NULL)
            )
          )
       ORDER BY kb.name ASC`
    ).all(
      req.user.id, req.user.id, req.user.id, kbUser.role_id || 0,
      kbUser.dept_code || null, kbUser.dept_code || null,
      kbUser.profit_center || null, kbUser.profit_center || null,
      kbUser.org_section || null, kbUser.org_section || null,
      kbUser.factory_code || null, kbUser.factory_code || null,
      kbUser.org_group_name || null, kbUser.org_group_name || null,
    );

    // ── Dashboards (AI 戰情) ────────────────────────────────────────────────
    // 列出該 user 可用的 design,作為 pipeline 內 dashboard node 的下拉清單。
    // 權限對齊 canAccessDesign:owner / is_public / ai_dashboard_shares(含組織層 7 種)
    const dashUser = await db.prepare(
      'SELECT role, role_id, dept_code, profit_center, org_section, org_group_name, factory_code FROM users WHERE id=?'
    ).get(req.user.id) || {};
    let dashboards = [];
    try {
      const isAdmin = dashUser.role === 'admin';
      const baseSql = `
        SELECT d.id, d.name, d.description, d.few_shot_examples, d.topic_id,
               d.name_zh, d.name_en, d.name_vi, d.desc_zh, d.desc_en, d.desc_vi,
               t.name AS topic_name, t.policy_category_id,
               t.name_zh AS topic_name_zh, t.name_en AS topic_name_en, t.name_vi AS topic_name_vi
        FROM ai_select_designs d
        LEFT JOIN ai_select_topics t ON t.id = d.topic_id
        WHERE d.is_suspended = 0
      `;
      if (isAdmin) {
        dashboards = await db.prepare(baseSql + ` ORDER BY d.id ASC`).all();
      } else {
        dashboards = await db.prepare(baseSql + `
          AND (
            d.created_by = ?
            OR d.is_public = 1
            OR EXISTS (
              SELECT 1 FROM ai_dashboard_shares s WHERE s.design_id = d.id AND (
                (s.grantee_type='user'        AND s.grantee_id=?) OR
                (s.grantee_type='role'        AND s.grantee_id=?) OR
                (s.grantee_type='department'  AND s.grantee_id=? AND ? IS NOT NULL) OR
                (s.grantee_type='cost_center' AND s.grantee_id=? AND ? IS NOT NULL) OR
                (s.grantee_type='division'    AND s.grantee_id=? AND ? IS NOT NULL) OR
                (s.grantee_type='factory'     AND s.grantee_id=? AND ? IS NOT NULL) OR
                (s.grantee_type='org_group'   AND s.grantee_id=? AND ? IS NOT NULL)
              )
            )
          )
          ORDER BY d.id ASC
        `).all(
          req.user.id,
          String(req.user.id), String(dashUser.role_id || ''),
          dashUser.dept_code || null,    dashUser.dept_code || null,
          dashUser.profit_center || null, dashUser.profit_center || null,
          dashUser.org_section || null,   dashUser.org_section || null,
          dashUser.factory_code || null,  dashUser.factory_code || null,
          dashUser.org_group_name || null, dashUser.org_group_name || null,
        );
      }
    } catch (e) {
      console.warn('[tools-catalog] dashboards query failed:', e.message);
      dashboards = [];
    }

    // 解析 few_shot_examples → sample_questions[lang],對齊 AiDashboardPage.tsx parseFew 邏輯
    const parseSamples = (raw) => {
      if (!raw) return [];
      let arr;
      try {
        arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (typeof arr === 'string') arr = JSON.parse(arr);
      } catch (_) { return []; }
      if (!Array.isArray(arr)) return [];
      return arr.map((x) => {
        if (!x) return null;
        const q = x[`q_${suffix}`] || x.q_zh || x.q || x.q_en || x.q_vi;
        return (typeof q === 'string' && q.trim()) ? q.trim() : null;
      }).filter(Boolean);
    };

    res.json({
      skills: skills.map(localize),
      kbs: kbs.map(localize),
      dashboards: dashboards.map(d => ({
        design_id: d.id,
        name: d[`name_${suffix}`] || d.name,
        description: d[`desc_${suffix}`] || d.description || '',
        topic_name: d[`topic_name_${suffix}`] || d.topic_name || '',
        topic_id: d.topic_id,
        sample_questions: parseSamples(d.few_shot_examples),
        // 提示:該 topic 有綁政策類別 → 排程執行時會跑 full_block + 關鍵字檢查
        policy_warning: d.policy_category_id
          ? `此 design 綁定政策類別 #${d.policy_category_id},排程執行時會以 task.user 身份做政策檢查`
          : null,
      })),
    });
  } catch (e) {
    console.error('[tools-catalog] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/scheduled-tasks/dashboards/:design_id/preview ──────────────────
// Try it:讓 user 在排程設計界面試跑一次 dashboard,即時看 SQL + rows 預覽。
// 走 buffered wrapper(非 SSE),回 JSON。權限完全等同最終排程執行(req.user.id = task.user_id)。
// Body: { question, model_key?, lang? }
// Limit:rows 截前 100 筆給前端表格,完整 row_count 用 buf.rowCount。
router.post('/dashboards/:design_id/preview', async (req, res) => {
  if (!await checkPermission(req, res)) return;
  const db = getDb();
  try {
    const { question, model_key, lang, restrict_multi_org } = req.body || {};
    if (!question || !String(question).trim()) {
      return res.status(400).json({ error: 'question 為必填' });
    }
    const designId = Number(req.params.design_id);
    if (!designId) return res.status(400).json({ error: 'design_id 無效' });

    const { runDashboardQueryBuffered } = require('../services/dashboardService');
    const t0 = Date.now();
    const buf = await runDashboardQueryBuffered({
      designId,
      question: String(question).trim(),
      userId: req.user.id,
      user: req.user,
      modelKey: model_key || null,
      lang: lang || 'zh-TW',
      isDesigner: false,
      forceFresh: true,
      restrictMultiOrg: restrict_multi_org || null,
    });
    res.json({
      sql: buf.sql,
      design_name: buf.designName,
      topic_name: buf.topicName,
      policy_category_id: buf.policyCategoryId,
      multiorg_scope: buf.multiorgScope,
      org_scope: buf.orgScope,
      row_count: buf.rowCount,
      columns: buf.columns,
      column_labels: buf.columnLabels,
      rows: buf.rows.slice(0, 100),       // 預覽截前 100,實際排程跑全量
      truncated: buf.rows.length > 100,
      duration_ms: Date.now() - t0,
    });
  } catch (e) {
    console.error('[dashboard preview] error:', e.message);
    // 把 ⛔ 開頭的政策錯誤回 403,其餘 500(讓前端能分辨)
    const code = /^⛔/.test(e.message) ? 403 : 500;
    res.status(code).json({ error: e.message });
  }
});

// ── GET /api/scheduled-tasks/:id/last-output ─────────────────────────────────
// 取最近一次成功 run 的 response_preview(供 db_write/kb_write 節點 dry-run 用)
router.get('/:id/last-output', async (req, res) => {
  if (!await checkPermission(req, res)) return;
  const db = getDb();
  try {
    const task = await db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: '找不到任務' });
    // 查 last output:有任何 share role 都能看(use 也算讀取)
    const role = await resolveTaskRole(db, task, req.user);
    if (!role) return res.status(403).json({ error: '無權限' });

    const row = await db.prepare(
      `SELECT TO_CHAR(run_at,'YYYY-MM-DD"T"HH24:MI:SS') AS run_at,
              status, response_preview
       FROM scheduled_task_runs
       WHERE task_id=? AND status='ok'
       ORDER BY run_at DESC FETCH FIRST 1 ROWS ONLY`
    ).get(req.params.id);
    if (!row) return res.json({ run_at: null, response_preview: '', message: '尚無成功執行紀錄' });
    res.json({ run_at: row.run_at, response_preview: row.response_preview || '' });
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
    // 查歷史:有任何 share role 都能看(use 也算讀取)
    const role = await resolveTaskRole(db, task, req.user);
    if (!role) return res.status(403).json({ error: '無權限' });

    const limit = parseInt(req.query.limit || '30');
    const runs = await db.prepare(
      `SELECT id, task_id, TO_CHAR(run_at,'YYYY-MM-DD"T"HH24:MI:SS') AS run_at,
              status, attempt, session_id, response_preview,
              generated_files_json, email_sent_to, error_msg, duration_ms,
              tools_used_json, pipeline_log_json
       FROM scheduled_task_runs WHERE task_id=? ORDER BY run_at DESC FETCH FIRST ? ROWS ONLY`
    ).all(req.params.id, limit);
    res.json(runs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Shares CRUD ─────────────────────────────────────────────────────────────
// 對齊 ai_dashboard_shares 的 endpoint 模式:GET / POST(upsert)/ DELETE
// 權限:只有 admin / owner 能管 shares

// GET /api/scheduled-tasks/:id/shares
router.get('/:id/shares', async (req, res) => {
  if (!await checkPermission(req, res)) return;
  const db = getDb();
  try {
    const task = await db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: '找不到任務' });
    const role = await resolveTaskRole(db, task, req.user);
    if (!role) return res.status(403).json({ error: '無權限' });
    const rows = await db.prepare(
      `SELECT id, task_id, grantee_type, grantee_id, share_type,
              TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at, granted_by
       FROM scheduled_task_shares WHERE task_id=? ORDER BY created_at DESC`
    ).all(req.params.id);
    // 補 grantee_name
    try {
      const { resolveGranteeNamesInRows, getLangFromReq } = require('../services/granteeNameResolver');
      await resolveGranteeNamesInRows(rows, getLangFromReq(req), db);
    } catch (_) { /* fallback to raw rows */ }
    res.json(rows);
  } catch (e) {
    console.error('[scheduledTasks GET /:id/shares] error:', e.message, e.stack);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/scheduled-tasks/:id/shares  (upsert)
//   body: { grantee_type, grantee_id, share_type }
//   權限:admin / owner
//   限制:含 db_write/kb_write/alert 節點的 task 禁 share_type='develop'(整段封禁)
router.post('/:id/shares', async (req, res) => {
  if (!await checkPermission(req, res)) return;
  const db = getDb();
  try {
    const task = await db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: '找不到任務' });
    const role = await resolveTaskRole(db, task, req.user);
    if (role !== 'admin' && role !== 'owner')
      return res.status(403).json({ error: '只有任務擁有者或管理員可以管理分享' });

    const { grantee_type, grantee_id, share_type = 'use' } = req.body || {};
    if (!grantee_type || !grantee_id) {
      return res.status(400).json({ error: 'grantee_type 與 grantee_id 為必填' });
    }
    const validTypes = ['user', 'role', 'department', 'cost_center', 'division', 'factory', 'org_group'];
    if (!validTypes.includes(grantee_type)) {
      return res.status(400).json({ error: `grantee_type 必須是 ${validTypes.join(' / ')}` });
    }
    if (!['use', 'develop'].includes(share_type)) {
      return res.status(400).json({ error: `share_type 必須是 use 或 develop` });
    }

    // 危險節點 + develop = 拒絕(整段封禁,保護 admin pipeline 不被改成繞權限工具)
    if (share_type === 'develop' && hasDangerousNodes(task.pipeline_json)) {
      return res.status(403).json({
        error: '此任務的 Pipeline 含有 db_write / kb_write / alert 節點,不允許分享 develop 權限(避免繞過 owner 權限寫入敏感資料)。請改用 view 權限分享。',
      });
    }

    // Upsert:同 (task_id, grantee_type, grantee_id) 已存在就更新 share_type
    const existing = await db.prepare(
      `SELECT id FROM scheduled_task_shares WHERE task_id=? AND grantee_type=? AND grantee_id=?`
    ).get(req.params.id, grantee_type, String(grantee_id));
    if (existing) {
      await db.prepare(
        `UPDATE scheduled_task_shares SET share_type=? WHERE id=?`
      ).run(share_type, existing.id);
    } else {
      await db.prepare(
        `INSERT INTO scheduled_task_shares (task_id, grantee_type, grantee_id, share_type, granted_by)
         VALUES (?, ?, ?, ?, ?)`
      ).run(req.params.id, grantee_type, String(grantee_id), share_type, req.user.id);
    }

    // 回傳完整列表(對齊 dashboard ShareModal 期待的格式)
    const rows = await db.prepare(
      `SELECT id, task_id, grantee_type, grantee_id, share_type,
              TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at, granted_by
       FROM scheduled_task_shares WHERE task_id=? ORDER BY created_at DESC`
    ).all(req.params.id);
    try {
      const { resolveGranteeNamesInRows, getLangFromReq } = require('../services/granteeNameResolver');
      await resolveGranteeNamesInRows(rows, getLangFromReq(req), db);
    } catch (_) {}
    res.json(rows);
  } catch (e) {
    console.error('[scheduledTasks POST /:id/shares] error:', e.message, e.stack);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/scheduled-tasks/:id/shares/:shareId
router.delete('/:id/shares/:shareId', async (req, res) => {
  if (!await checkPermission(req, res)) return;
  const db = getDb();
  try {
    const task = await db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: '找不到任務' });
    const role = await resolveTaskRole(db, task, req.user);
    if (role !== 'admin' && role !== 'owner')
      return res.status(403).json({ error: '只有任務擁有者或管理員可以管理分享' });
    await db.prepare(`DELETE FROM scheduled_task_shares WHERE id=? AND task_id=?`)
      .run(req.params.shareId, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[scheduledTasks DELETE /:id/shares/:shareId] error:', e.message, e.stack);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
