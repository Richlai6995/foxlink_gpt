const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('./auth');

router.use(verifyToken);
router.use(verifyAdmin);

const ORG_COLS = `u.dept_code, u.dept_name, u.profit_center, u.profit_center_name,
                  u.org_section, u.org_section_name, u.org_group_name, u.factory_code,
                  TO_CHAR(u.org_end_date, 'YYYY-MM-DD') AS org_end_date,
                  u.org_synced_at`;

// GET /api/users
router.get('/', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { search } = req.query;
    let sql = `SELECT u.id, u.username, u.name, u.employee_id, u.email, u.role,
                TO_CHAR(u.start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(u.end_date, 'YYYY-MM-DD') AS end_date,
                u.status,
                u.allow_text_upload, u.text_max_mb, u.allow_audio_upload, u.audio_max_mb,
                u.allow_image_upload, u.image_max_mb, u.allow_scheduled_tasks,
                u.allow_create_skill, u.allow_external_skill, u.allow_code_skill,
                u.can_create_kb, u.kb_max_size_mb, u.kb_max_count, u.can_deep_research,
                u.can_design_ai_select, u.can_use_ai_dashboard,
                u.role_id, r.name AS role_name, u.creation_method,
                u.budget_daily, u.budget_weekly, u.budget_monthly,
                ${ORG_COLS}
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id`;
    const params = [];
    if (search) {
      const like = `%${search}%`;
      sql += ` WHERE (UPPER(u.name) LIKE UPPER(?) OR UPPER(u.username) LIKE UPPER(?) OR u.employee_id LIKE ?)`;
      params.push(like, like, like);
    }
    sql += ` ORDER BY u.id ASC`;
    const users = await db.prepare(sql).all(...params);
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/users
router.post('/', async (req, res) => {
  const { username, password, name, employee_id, email, role, start_date, end_date, status,
    allow_text_upload, text_max_mb, allow_audio_upload, audio_max_mb,
    allow_image_upload, image_max_mb, allow_scheduled_tasks, role_id,
    budget_daily, budget_weekly, budget_monthly } = req.body;
  if (!username || !password || !name) {
    return res.status(400).json({ error: '帳號、密碼、姓名為必填' });
  }
  try {
    const db = require('../database-oracle').db;

    // Resolve role_id: explicit value > default role
    let resolvedRoleId = role_id || null;
    if (!resolvedRoleId) {
      const defaultRole = await db.prepare(`SELECT id FROM roles WHERE is_default=1 FETCH FIRST 1 ROWS ONLY`).get();
      if (defaultRole) resolvedRoleId = defaultRole.id;
    }

    // Inherit permissions from role when admin hasn't explicitly set them
    const rolePerms = resolvedRoleId
      ? await db.prepare(`SELECT * FROM roles WHERE id=?`).get(resolvedRoleId)
      : null;
    const resolveP = (explicit, roleVal, def) =>
      explicit !== undefined ? (explicit ? 1 : 0) : (roleVal ?? def);

    const parseBudget = (v) => (v != null && v !== '') ? Number(v) : null;
    const DI = `TO_DATE(?, 'YYYY-MM-DD')`;
    const result = await db
      .prepare(
        `INSERT INTO users (username, password, name, employee_id, email, role, start_date, end_date, status,
                            allow_text_upload, text_max_mb, allow_audio_upload, audio_max_mb,
                            allow_image_upload, image_max_mb, allow_scheduled_tasks, role_id, creation_method,
                            budget_daily, budget_weekly, budget_monthly,
                            can_design_ai_select, can_use_ai_dashboard)
         VALUES (?, ?, ?, ?, ?, ?, ${DI}, ${DI}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(
        username, password, name,
        employee_id || null, email || null,
        role || 'user',
        start_date || null, end_date || null,
        status || 'inactive',
        resolveP(allow_text_upload, rolePerms?.allow_text_upload, 1),
        text_max_mb || rolePerms?.text_max_mb || 10,
        resolveP(allow_audio_upload, rolePerms?.allow_audio_upload, 0),
        audio_max_mb || rolePerms?.audio_max_mb || 10,
        resolveP(allow_image_upload, rolePerms?.allow_image_upload, 1),
        image_max_mb || rolePerms?.image_max_mb || 10,
        allow_scheduled_tasks !== undefined ? (allow_scheduled_tasks ? 1 : 0) : (rolePerms?.allow_scheduled_tasks ?? 0),
        resolvedRoleId,
        'manual',
        parseBudget(budget_daily), parseBudget(budget_weekly), parseBudget(budget_monthly)
      );

    // If employee_id provided, auto-sync org
    if (employee_id) {
      try {
        const { syncOrgToUsers } = require('../services/orgSyncService');
        syncOrgToUsers(db, [String(employee_id)]).catch(() => { });
      } catch (e) { /* ERP not configured, skip */ }
    }

    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      if (err.message.includes('employee_id')) {
        return res.status(400).json({ error: '員工編號已被其他帳號使用' });
      }
      return res.status(400).json({ error: '帳號已存在' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { password, name, employee_id, email, role, start_date, end_date, status,
    allow_text_upload, text_max_mb, allow_audio_upload, audio_max_mb,
    allow_image_upload, image_max_mb, allow_scheduled_tasks, role_id,
    budget_daily, budget_weekly, budget_monthly,
    allow_create_skill, allow_external_skill, allow_code_skill,
    can_create_kb, kb_max_size_mb, kb_max_count,
    can_deep_research,
    can_design_ai_select, can_use_ai_dashboard,
    // allow manual override of org fields from UI
    dept_code, dept_name, profit_center, profit_center_name,
    org_section, org_section_name, org_group_name, factory_code, org_end_date,
  } = req.body;
  try {
    const db = require('../database-oracle').db;
    const specificUser = await db.prepare('SELECT username, employee_id FROM users WHERE id = ?').get(id);
    const adminAccount = (process.env.DEFAULT_ADMIN_ACCOUNT || 'admin').toUpperCase();
    if (specificUser?.username?.toUpperCase() === adminAccount && role !== 'admin') {
      return res.status(400).json({ error: '不能移除預設管理員的管理員角色' });
    }

    const parseBudget = (v) => (v != null && v !== '') ? Number(v) : null;
    const resolveSkillPerm = (v) => v === null ? null : (v ? 1 : 0);
    const permParams = [
      allow_text_upload !== undefined ? (allow_text_upload ? 1 : 0) : 1,
      text_max_mb || 10,
      allow_audio_upload !== undefined ? (allow_audio_upload ? 1 : 0) : 0,
      audio_max_mb || 10,
      allow_image_upload !== undefined ? (allow_image_upload ? 1 : 0) : 1,
      image_max_mb || 10,
      allow_scheduled_tasks ? 1 : 0,
      role_id || null,
      parseBudget(budget_daily), parseBudget(budget_weekly), parseBudget(budget_monthly),
      resolveSkillPerm(allow_create_skill !== undefined ? allow_create_skill : null),
      resolveSkillPerm(allow_external_skill !== undefined ? allow_external_skill : null),
      resolveSkillPerm(allow_code_skill !== undefined ? allow_code_skill : null),
      resolveSkillPerm(can_create_kb !== undefined ? can_create_kb : null),
      kb_max_size_mb != null ? Number(kb_max_size_mb) : null,
      kb_max_count   != null ? Number(kb_max_count)   : null,
      can_deep_research !== undefined ? resolveSkillPerm(can_deep_research) : null,
      resolveSkillPerm(can_design_ai_select !== undefined ? can_design_ai_select : null),
      resolveSkillPerm(can_use_ai_dashboard  !== undefined ? can_use_ai_dashboard  : null),
    ];

    const orgParams = [
      dept_code !== undefined ? (dept_code || null) : undefined,
      dept_name !== undefined ? (dept_name || null) : undefined,
      profit_center !== undefined ? (profit_center || null) : undefined,
      profit_center_name !== undefined ? (profit_center_name || null) : undefined,
      org_section !== undefined ? (org_section || null) : undefined,
      org_section_name !== undefined ? (org_section_name || null) : undefined,
      org_group_name !== undefined ? (org_group_name || null) : undefined,
      factory_code !== undefined ? (factory_code || null) : undefined,
      org_end_date !== undefined ? (org_end_date || null) : undefined,
    ];
    const hasOrgOverride = orgParams.some(v => v !== undefined);

    let sql, params;
    const D = `TO_DATE(?, 'YYYY-MM-DD')`;
    const baseSet = `name=?, employee_id=?, email=?, role=?, start_date=${D}, end_date=${D}, status=?,
             allow_text_upload=?, text_max_mb=?, allow_audio_upload=?, audio_max_mb=?,
             allow_image_upload=?, image_max_mb=?, allow_scheduled_tasks=?, role_id=?,
             budget_daily=?, budget_weekly=?, budget_monthly=?,
             allow_create_skill=?, allow_external_skill=?, allow_code_skill=?,
             can_create_kb=?, kb_max_size_mb=?, kb_max_count=?, can_deep_research=?,
             can_design_ai_select=?, can_use_ai_dashboard=?`;
    const orgSet = hasOrgOverride
      ? `, dept_code=?, dept_name=?, profit_center=?, profit_center_name=?,
           org_section=?, org_section_name=?, org_group_name=?, factory_code=?, org_end_date=${D}`
      : '';
    const orgVals = hasOrgOverride ? orgParams.map(v => v === undefined ? null : v) : [];

    if (password) {
      sql = `UPDATE users SET password=?, ${baseSet}${orgSet} WHERE id=?`;
      params = [password, name, employee_id || null, email || null, role, start_date || null, end_date || null, status,
        ...permParams, ...orgVals, id];
    } else {
      sql = `UPDATE users SET ${baseSet}${orgSet} WHERE id=?`;
      params = [name, employee_id || null, email || null, role, start_date || null, end_date || null, status,
        ...permParams, ...orgVals, id];
    }
    const result = await db.prepare(sql).run(...params);

    // If employee_id changed (or newly set), auto-sync org from ERP
    const prevEmpId = specificUser?.employee_id;
    const newEmpId = employee_id || null;
    if (newEmpId && newEmpId !== prevEmpId) {
      try {
        const { syncOrgToUsers } = require('../services/orgSyncService');
        syncOrgToUsers(db, [String(newEmpId)]).catch(() => { });
      } catch (e) { /* ERP not configured, skip */ }
    }

    res.json({ changes: result.changes, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = require('../database-oracle').db;
    const user = await db.prepare('SELECT username FROM users WHERE id = ?').get(id);
    const adminAccount = (process.env.DEFAULT_ADMIN_ACCOUNT || 'admin').toUpperCase();
    if (user?.username?.toUpperCase() === adminAccount) {
      return res.status(403).json({ error: '不能刪除預設管理員' });
    }
    const result = await db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ changes: result.changes, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
