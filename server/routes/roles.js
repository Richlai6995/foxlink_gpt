const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('./auth');
const db = require('../database-oracle').db;

router.use(verifyToken);

// GET /api/roles  — list roles (id + name only for non-admin; full detail for admin)
router.get('/', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      // ShareModal 用：只回 id + name
      const roles = await db.prepare(`SELECT id, name FROM roles ORDER BY id ASC`).all();
      return res.json(roles);
    }
    const roles = await db.prepare(`SELECT * FROM roles ORDER BY id ASC`).all();
    for (const role of roles) {
      role.mcp_server_ids = (await db
        .prepare(`SELECT mcp_server_id FROM role_mcp_servers WHERE role_id=?`)
        .all(role.id))
        .map((r) => r.mcp_server_id);
      role.dify_kb_ids = (await db
        .prepare(`SELECT dify_kb_id FROM role_dify_kbs WHERE role_id=?`)
        .all(role.id))
        .map((r) => r.dify_kb_id);
    }
    res.json(roles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.use(verifyAdmin);

// GET /api/roles/org-lov  — LOV from ERP FL_ORG_EMP_DEPT_MV (admin only)
router.get('/org-lov', async (req, res) => {
  try {
    const { isConfigured, execute } = require('../services/erpDb');
    if (!isConfigured()) return res.json({ department: [], cost_center: [], division: [], org_group: [] });

    const toList = (rows, codeCol, nameCol) =>
      (rows || []).map(r => ({ code: r[codeCol] || r[codeCol.toLowerCase()] || '', name: r[nameCol] || r[nameCol.toLowerCase()] || '' }));

    const [d, pc, os, og] = await Promise.all([
      execute(`SELECT DISTINCT DEPT_CODE, DEPT_DESC FROM FL_ORG_EMP_DEPT_MV ORDER BY DEPT_CODE`),
      execute(`SELECT DISTINCT PROFIT_CENTER, PROFIT_CENTER_NAME FROM FL_ORG_EMP_DEPT_MV ORDER BY PROFIT_CENTER`),
      execute(`SELECT DISTINCT ORG_SECTION, ORG_SECTION_NAME FROM FL_ORG_EMP_DEPT_MV ORDER BY ORG_SECTION`),
      execute(`SELECT DISTINCT ORG_GROUP_NAME FROM FL_ORG_EMP_DEPT_MV ORDER BY ORG_GROUP_NAME`),
    ]);

    res.json({
      department:  toList(d?.rows,  'DEPT_CODE',       'DEPT_DESC'),
      cost_center: toList(pc?.rows, 'PROFIT_CENTER',   'PROFIT_CENTER_NAME'),
      division:    toList(os?.rows, 'ORG_SECTION',     'ORG_SECTION_NAME'),
      org_group:   toList(og?.rows, 'ORG_GROUP_NAME',  'ORG_GROUP_NAME'),
    });
  } catch (e) {
    console.error('[roles/org-lov]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/roles/:id/org-bindings
router.get('/:id/org-bindings', async (req, res) => {
  try {
    const bindings = await db.prepare(
      `SELECT b.*, r.name AS role_name FROM role_org_bindings b
       JOIN roles r ON r.id = b.role_id
       WHERE b.role_id=? ORDER BY b.org_type, b.org_code`
    ).all(req.params.id);
    res.json(bindings);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/roles/:id/org-bindings
router.post('/:id/org-bindings', async (req, res) => {
  const { org_type, org_code, org_name } = req.body;
  const validTypes = ['department', 'cost_center', 'division', 'org_group'];
  if (!validTypes.includes(org_type) || !org_code) {
    return res.status(400).json({ error: '無效的 org_type 或 org_code' });
  }
  try {
    // 全域唯一：檢查是否被其他角色使用
    const conflict = await db.prepare(
      `SELECT b.role_id, r.name AS role_name FROM role_org_bindings b
       JOIN roles r ON r.id = b.role_id
       WHERE b.org_type=? AND b.org_code=? AND b.role_id != ?`
    ).get(org_type, String(org_code), req.params.id);
    if (conflict) {
      return res.status(409).json({ error: `「${org_code}」已被角色「${conflict.role_name}」綁定` });
    }
    await db.prepare(
      `INSERT INTO role_org_bindings (role_id, org_type, org_code, org_name) VALUES (?,?,?,?)`
    ).run(req.params.id, org_type, String(org_code), org_name || null);
    const bindings = await db.prepare(
      `SELECT * FROM role_org_bindings WHERE role_id=? ORDER BY org_type, org_code`
    ).all(req.params.id);
    res.json(bindings);
  } catch (e) {
    if (e.message?.includes('ORA-00001')) {
      return res.status(409).json({ error: `「${org_code}」已被其他角色綁定` });
    }
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/roles/:id/org-bindings/:bindingId
router.delete('/:id/org-bindings/:bindingId', async (req, res) => {
  try {
    await db.prepare(`DELETE FROM role_org_bindings WHERE id=? AND role_id=?`).run(req.params.bindingId, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/roles  — create role
router.post('/', async (req, res) => {
  const { name, description, is_default, mcp_server_ids = [], dify_kb_ids = [],
    budget_daily, budget_weekly, budget_monthly, quota_exceed_action,
    allow_text_upload, text_max_mb, allow_audio_upload, audio_max_mb,
    allow_image_upload, image_max_mb, allow_scheduled_tasks,
    allow_create_skill, allow_external_skill, allow_code_skill,
    can_create_kb, kb_max_size_mb, kb_max_count, can_deep_research,
    can_design_ai_select, can_use_ai_dashboard } = req.body;
  if (!name) return res.status(400).json({ error: 'name 為必填' });
  try {
    if (is_default) {
      await db.prepare(`UPDATE roles SET is_default=0`).run();
    }
    const parseBudget = (v) => (v != null && v !== '') ? Number(v) : null;
    const result = await db
      .prepare(`INSERT INTO roles (name, description, is_default,
                  budget_daily, budget_weekly, budget_monthly, quota_exceed_action,
                  allow_text_upload, text_max_mb, allow_audio_upload, audio_max_mb,
                  allow_image_upload, image_max_mb, allow_scheduled_tasks,
                  allow_create_skill, allow_external_skill, allow_code_skill,
                  can_create_kb, kb_max_size_mb, kb_max_count, can_deep_research,
                  can_design_ai_select, can_use_ai_dashboard)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(name, description || null, is_default ? 1 : 0,
        parseBudget(budget_daily), parseBudget(budget_weekly), parseBudget(budget_monthly),
        quota_exceed_action === 'warn' ? 'warn' : 'block',
        allow_text_upload !== undefined ? (allow_text_upload ? 1 : 0) : 1,
        text_max_mb || 10,
        allow_audio_upload !== undefined ? (allow_audio_upload ? 1 : 0) : 0,
        audio_max_mb || 10,
        allow_image_upload !== undefined ? (allow_image_upload ? 1 : 0) : 1,
        image_max_mb || 10,
        allow_scheduled_tasks ? 1 : 0,
        allow_create_skill ? 1 : 0,
        allow_external_skill ? 1 : 0,
        allow_code_skill ? 1 : 0,
        can_create_kb ? 1 : 0,
        kb_max_size_mb != null ? Number(kb_max_size_mb) : 500,
        kb_max_count   != null ? Number(kb_max_count)   : 5,
        can_deep_research !== undefined ? (can_deep_research ? 1 : 0) : 1,
        can_design_ai_select ? 1 : 0,
        can_use_ai_dashboard ? 1 : 0);
    const roleId = result.lastInsertRowid;
    await _syncAssignments(db, roleId, mcp_server_ids, dify_kb_ids);
    res.json({ id: roleId, success: true });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: '角色名稱已存在' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/roles/:id  — update role
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, is_default, mcp_server_ids = [], dify_kb_ids = [],
    budget_daily, budget_weekly, budget_monthly, quota_exceed_action,
    allow_text_upload, text_max_mb, allow_audio_upload, audio_max_mb,
    allow_image_upload, image_max_mb, allow_scheduled_tasks,
    allow_create_skill, allow_external_skill, allow_code_skill,
    can_create_kb, kb_max_size_mb, kb_max_count, can_deep_research,
    can_design_ai_select, can_use_ai_dashboard } = req.body;
  if (!name) return res.status(400).json({ error: 'name 為必填' });
  try {
    if (is_default) {
      await db.prepare(`UPDATE roles SET is_default=0 WHERE id != ?`).run(id);
    }
    const parseBudget = (v) => (v != null && v !== '') ? Number(v) : null;
    await db.prepare(
      `UPDATE roles SET name=?, description=?, is_default=?,
         budget_daily=?, budget_weekly=?, budget_monthly=?, quota_exceed_action=?,
         allow_text_upload=?, text_max_mb=?, allow_audio_upload=?, audio_max_mb=?,
         allow_image_upload=?, image_max_mb=?, allow_scheduled_tasks=?,
         allow_create_skill=?, allow_external_skill=?, allow_code_skill=?,
         can_create_kb=?, kb_max_size_mb=?, kb_max_count=?, can_deep_research=?,
         can_design_ai_select=?, can_use_ai_dashboard=?,
         updated_at=CURRENT_TIMESTAMP
       WHERE id=?`
    ).run(name, description || null, is_default ? 1 : 0,
      parseBudget(budget_daily), parseBudget(budget_weekly), parseBudget(budget_monthly),
      quota_exceed_action === 'warn' ? 'warn' : 'block',
      allow_text_upload !== undefined ? (allow_text_upload ? 1 : 0) : 1,
      text_max_mb || 10,
      allow_audio_upload !== undefined ? (allow_audio_upload ? 1 : 0) : 0,
      audio_max_mb || 10,
      allow_image_upload !== undefined ? (allow_image_upload ? 1 : 0) : 1,
      image_max_mb || 10,
      allow_scheduled_tasks ? 1 : 0,
      allow_create_skill ? 1 : 0,
      allow_external_skill ? 1 : 0,
      allow_code_skill ? 1 : 0,
      can_create_kb ? 1 : 0,
      kb_max_size_mb != null ? Number(kb_max_size_mb) : 500,
      kb_max_count   != null ? Number(kb_max_count)   : 5,
      can_deep_research !== undefined ? (can_deep_research ? 1 : 0) : 1,
      can_design_ai_select ? 1 : 0,
      can_use_ai_dashboard ? 1 : 0,
      id);
    await _syncAssignments(db, id, mcp_server_ids, dify_kb_ids);
    res.json({ success: true });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: '角色名稱已存在' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/roles/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.prepare(`UPDATE users SET role_id=NULL WHERE role_id=?`).run(id);
    await db.prepare(`DELETE FROM roles WHERE id=?`).run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── helper ──────────────────────────────────────────────────────────────────
async function _syncAssignments(db, roleId, mcpIds, difyIds) {
  await db.prepare(`DELETE FROM role_mcp_servers WHERE role_id=?`).run(roleId);
  for (const mid of mcpIds) {
    try { await db.prepare(`INSERT INTO role_mcp_servers (role_id, mcp_server_id) VALUES (?, ?)`).run(roleId, mid); } catch (_) { }
  }
  await db.prepare(`DELETE FROM role_dify_kbs WHERE role_id=?`).run(roleId);
  for (const did of difyIds) {
    try { await db.prepare(`INSERT INTO role_dify_kbs (role_id, dify_kb_id) VALUES (?, ?)`).run(roleId, did); } catch (_) { }
  }
}

module.exports = router;
