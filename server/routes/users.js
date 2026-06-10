const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('./auth');
const passwordService = require('../services/passwordService');

router.use(verifyToken);

// GET /api/users/lov — 任何登入者可用的最小欄位 LOV(供 UserPicker、分享對象選擇器、PM 郵件清單收件人挑選)
// 2026-06-03:加 email 給 PM 郵件清單 RecipientsManager 拿(從 user 主檔挑後自動帶 email)
router.get('/lov', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(
      `SELECT id, username, name, employee_id, email
         FROM users
        WHERE status='active'
        ORDER BY name`
    ).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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
    let sql = `SELECT u.id, u.username, u.name, u.employee_id, u.employee_id_source, u.email, u.role,
                TO_CHAR(u.start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(u.end_date, 'YYYY-MM-DD') AS end_date,
                u.status,
                u.allow_text_upload, u.text_max_mb, u.allow_audio_upload, u.audio_max_mb,
                u.allow_image_upload, u.image_max_mb, u.allow_scheduled_tasks, u.scheduled_tasks_limit,
                u.allow_create_skill, u.allow_external_skill, u.allow_code_skill,
                u.can_create_kb, u.kb_max_size_mb, u.kb_max_count, u.can_deep_research,
                u.can_design_ai_select, u.can_use_ai_dashboard, u.training_permission,
                u.role_id, r.name AS role_name, u.creation_method,
                u.budget_daily, u.budget_weekly, u.budget_monthly, u.quota_exceed_action,
                u.webex_bot_enabled, u.name_manually_set, u.is_erp_admin,
                u.is_pipeline_admin,
                u.emp_match_exempt, u.emp_match_exempt_reason,
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
    allow_image_upload, image_max_mb, allow_scheduled_tasks, scheduled_tasks_limit, role_id,
    budget_daily, budget_weekly, budget_monthly, quota_exceed_action,
    webex_bot_enabled } = req.body;
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
    const hashedPw = await passwordService.hash(password);
    const result = await db
      .prepare(
        `INSERT INTO users (username, password, password_hashed, name, employee_id, email, role, start_date, end_date, status,
                            allow_text_upload, text_max_mb, allow_audio_upload, audio_max_mb,
                            allow_image_upload, image_max_mb, allow_scheduled_tasks, scheduled_tasks_limit, role_id, creation_method,
                            budget_daily, budget_weekly, budget_monthly, quota_exceed_action,
                            can_design_ai_select, can_use_ai_dashboard, webex_bot_enabled)
         VALUES (?, ?, 'Y', ?, ?, ?, ?, ${DI}, ${DI}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`
      )
      .run(
        username, hashedPw, name,
        employee_id || null, (email ? String(email).replace(/[​-‍﻿]/g, '').trim() : null) || null,
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
        scheduled_tasks_limit != null && scheduled_tasks_limit !== '' ? Number(scheduled_tasks_limit) : null,
        resolvedRoleId,
        'manual',
        parseBudget(budget_daily), parseBudget(budget_weekly), parseBudget(budget_monthly),
        quota_exceed_action || null,
        webex_bot_enabled !== undefined ? (webex_bot_enabled ? 1 : 0) : 1
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
    allow_image_upload, image_max_mb, allow_scheduled_tasks, scheduled_tasks_limit, role_id,
    budget_daily, budget_weekly, budget_monthly, quota_exceed_action,
    allow_create_skill, allow_external_skill, allow_code_skill,
    can_create_kb, kb_max_size_mb, kb_max_count,
    can_deep_research,
    can_design_ai_select, can_use_ai_dashboard,
    training_permission,
    webex_bot_enabled,
    name_manually_set,
    is_erp_admin,
    is_pipeline_admin,
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
      scheduled_tasks_limit != null && scheduled_tasks_limit !== '' ? Number(scheduled_tasks_limit) : null,
      role_id || null,
      parseBudget(budget_daily), parseBudget(budget_weekly), parseBudget(budget_monthly),
      quota_exceed_action || null,
      resolveSkillPerm(allow_create_skill !== undefined ? allow_create_skill : null),
      resolveSkillPerm(allow_external_skill !== undefined ? allow_external_skill : null),
      resolveSkillPerm(allow_code_skill !== undefined ? allow_code_skill : null),
      resolveSkillPerm(can_create_kb !== undefined ? can_create_kb : null),
      kb_max_size_mb != null ? Number(kb_max_size_mb) : null,
      kb_max_count   != null ? Number(kb_max_count)   : null,
      can_deep_research !== undefined ? resolveSkillPerm(can_deep_research) : null,
      resolveSkillPerm(can_design_ai_select !== undefined ? can_design_ai_select : null),
      resolveSkillPerm(can_use_ai_dashboard  !== undefined ? can_use_ai_dashboard  : null),
      training_permission !== undefined ? (training_permission || null) : null,
      webex_bot_enabled !== undefined ? (webex_bot_enabled ? 1 : 0) : 1,
      name_manually_set !== undefined ? (name_manually_set ? 1 : 0) : 0,
      is_erp_admin !== undefined ? (is_erp_admin ? 1 : 0) : 0,
      is_pipeline_admin !== undefined ? (is_pipeline_admin ? 1 : 0) : 0,
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

    // 偵測 admin 是否改了 employee_id — 改了就標 source='manual',沒改就保留原 source
    // (COALESCE(?, employee_id_source): null bind = 不動)
    const prevEmpIdForSrc = specificUser?.employee_id || null;
    const newEmpIdForSrc  = employee_id || null;
    const empIdSourceParam = (newEmpIdForSrc !== prevEmpIdForSrc) ? 'manual' : null;

    let sql, params;
    const D = `TO_DATE(?, 'YYYY-MM-DD')`;
    const baseSet = `name=?, employee_id=?, email=?, role=?, start_date=${D}, end_date=${D}, status=?,
             allow_text_upload=?, text_max_mb=?, allow_audio_upload=?, audio_max_mb=?,
             allow_image_upload=?, image_max_mb=?, allow_scheduled_tasks=?, scheduled_tasks_limit=?, role_id=?,
             budget_daily=?, budget_weekly=?, budget_monthly=?, quota_exceed_action=?,
             allow_create_skill=?, allow_external_skill=?, allow_code_skill=?,
             can_create_kb=?, kb_max_size_mb=?, kb_max_count=?, can_deep_research=?,
             can_design_ai_select=?, can_use_ai_dashboard=?, training_permission=?,
             webex_bot_enabled=?, name_manually_set=?, is_erp_admin=?, is_pipeline_admin=?,
             employee_id_source=COALESCE(?, employee_id_source)`;
    const orgSet = hasOrgOverride
      ? `, dept_code=?, dept_name=?, profit_center=?, profit_center_name=?,
           org_section=?, org_section_name=?, org_group_name=?, factory_code=?, org_end_date=${D}`
      : '';
    const orgVals = hasOrgOverride ? orgParams.map(v => v === undefined ? null : v) : [];

    const cleanedEmail = (email ? String(email).replace(/[​-‍﻿]/g, '').trim() : null) || null;
    if (password) {
      const hashedPw = await passwordService.hash(password);
      sql = `UPDATE users SET password=?, password_hashed='Y', ${baseSet}${orgSet} WHERE id=?`;
      params = [hashedPw, name, employee_id || null, cleanedEmail, role, start_date || null, end_date || null, status,
        ...permParams, empIdSourceParam, ...orgVals, id];
    } else {
      sql = `UPDATE users SET ${baseSet}${orgSet} WHERE id=?`;
      params = [name, employee_id || null, cleanedEmail, role, start_date || null, end_date || null, status,
        ...permParams, empIdSourceParam, ...orgVals, id];
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

// ─────────────────────────────────────────────────────────────────────────────
// ERP 補資料(emp-match):姓名反查 ERP → 權威工號/Email,人工審核
// 設計詳見 docs/emp-data-fill-design.md
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/users/emp-match/scan — 掃描缺工號/Email 的帳號,產生建議
router.post('/emp-match/scan', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const empMatch = require('../services/empMatchService');
    const { userIds, useLLM } = req.body || {};
    const result = await empMatch.scanUsers(db, {
      userIds: Array.isArray(userIds) && userIds.length ? userIds.map(Number) : null,
      useLLM: useLLM !== false,
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/users/emp-match/suggestions?status=pending — 審核清單
router.get('/emp-match/suggestions', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { status } = req.query;
    let sql = `
      SELECT s.id, s.user_id, s.status, s.tier, s.suggested_emp_no, s.suggested_email,
             s.suggested_name, s.suggested_dept, s.confidence, s.reason, s.candidates_json,
             s.conflict_user_id, s.reviewed_by,
             TO_CHAR(s.reviewed_at,'YYYY-MM-DD HH24:MI') AS reviewed_at,
             TO_CHAR(s.created_at,'YYYY-MM-DD HH24:MI')  AS created_at,
             u.username, u.name AS current_name, u.employee_id AS current_emp_id,
             u.employee_id_source AS current_emp_source, u.email AS current_email,
             u.dept_name, u.profit_center_name, u.factory_code,
             cu.username AS conflict_username, cu.name AS conflict_name, cu.employee_id AS conflict_emp_id
      FROM emp_match_suggestions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN users cu ON cu.id = s.conflict_user_id`;
    const params = [];
    if (status) { sql += ` WHERE s.status = ?`; params.push(status); }
    sql += ` ORDER BY CASE s.status WHEN 'conflict' THEN 0 WHEN 'pending' THEN 1 WHEN 'no_match' THEN 2 ELSE 3 END,
                       s.tier, s.confidence DESC NULLS LAST, s.id`;
    const rows = await db.prepare(sql).all(...params);
    for (const r of rows) {
      try { r.candidates = r.candidates_json ? JSON.parse(r.candidates_json) : []; } catch { r.candidates = []; }
      delete r.candidates_json;
    }
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/users/emp-match/suggestions/:id/accept — 接受(可帶 emp_no 人工改選候選)
router.post('/emp-match/suggestions/:id/accept', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const empMatch = require('../services/empMatchService');
    const { emp_no } = req.body || {};
    const result = await empMatch.acceptSuggestion(db, Number(req.params.id), req.user.username, emp_no || null);
    if (result.conflict) return res.status(409).json(result); // 衝突 → 擋下人工處理
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/users/emp-match/suggestions/:id/reject — 拒絕(這筆建議錯,人還在)
router.post('/emp-match/suggestions/:id/reject', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const empMatch = require('../services/empMatchService');
    res.json(await empMatch.rejectSuggestion(db, Number(req.params.id), req.user.username));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/users/emp-match/users/:id/exempt — 標記共用/管理帳號,永久跳過比對
router.post('/emp-match/users/:id/exempt', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const empMatch = require('../services/empMatchService');
    res.json(await empMatch.exemptUser(db, Number(req.params.id), req.body?.reason, req.user.username));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/users/emp-match/users/:id/exempt — 取消豁免
router.delete('/emp-match/users/:id/exempt', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const empMatch = require('../services/empMatchService');
    res.json(await empMatch.unexemptUser(db, Number(req.params.id)));
  } catch (e) { res.status(500).json({ error: e.message }); }
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
