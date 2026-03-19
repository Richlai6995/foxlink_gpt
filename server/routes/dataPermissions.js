/**
 * 資料權限管理 Routes — /api/data-permissions
 * 僅管理員可存取
 */
const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('./auth');

router.use(verifyToken);
router.use(verifyAdmin);

// ── LOV: 組織資料（FL_ORG_EMP_DEPT_MV，fallback 到 users 表）────────────────
router.get('/lov/org', async (req, res) => {
  const { isConfigured, execute } = require('../services/erpDb');
  // 嘗試從 ERP 取完整 MV 資料
  if (isConfigured()) {
    try {
      const result = await execute(
        `SELECT DISTINCT
           DEPT_CODE, DEPT_DESC,
           PROFIT_CENTER, PROFIT_CENTER_NAME,
           ORG_SECTION, ORG_SECTION_NAME,
           ORG_GROUP_NAME,
           ORG_CODE, ORG_ID
         FROM FL_ORG_EMP_DEPT_MV
         WHERE DEPT_CODE IS NOT NULL
         ORDER BY ORG_GROUP_NAME, ORG_SECTION_NAME, PROFIT_CENTER_NAME, DEPT_DESC`
      );
      if (result?.rows?.length) return res.json(result.rows);
    } catch (e) {
      console.warn('[data-permissions] ERP org LOV error, fallback to users table:', e.message);
    }
  }
  // Fallback：從 users 表抓已同步的組織資料
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(
      `SELECT DISTINCT
         dept_code AS DEPT_CODE, dept_name AS DEPT_DESC,
         profit_center AS PROFIT_CENTER, profit_center_name AS PROFIT_CENTER_NAME,
         org_section AS ORG_SECTION, org_section_name AS ORG_SECTION_NAME,
         org_group_name AS ORG_GROUP_NAME
       FROM users
       WHERE dept_code IS NOT NULL
       ORDER BY org_group_name, org_section_name, profit_center_name, dept_name`
    ).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── LOV: Oracle ERP Multi-Org ─────────────────────────────────────────────────
router.get('/lov/erp-org', async (req, res) => {
  const { isConfigured, execute } = require('../services/erpDb');
  if (!isConfigured()) return res.json([]);
  try {
    const result = await execute(
      `SELECT
         A.ORGANIZATION_ID,
         A.ORGANIZATION_CODE,
         A.ORGANIZATION_NAME,
         A.OPERATING_UNIT,
         HOU.NAME AS OPERATING_UNIT_NAME,
         A.SET_OF_BOOKS_ID,
         GSB.NAME AS SET_OF_BOOKS_NAME,
         GSB.CURRENCY_CODE
       FROM ORG_ORGANIZATION_DEFINITIONS A
       JOIN HR_OPERATING_UNITS HOU ON A.OPERATING_UNIT = HOU.ORGANIZATION_ID
       JOIN GL_SETS_OF_BOOKS GSB ON A.SET_OF_BOOKS_ID = GSB.SET_OF_BOOKS_ID
       WHERE A.DISABLE_DATE IS NULL
       ORDER BY A.ORGANIZATION_NAME`
    );
    res.json(result?.rows || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── LOV: 使用者列表（Layer 1）────────────────────────────────────────────────
router.get('/lov/users', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const users = await db.prepare(
      `SELECT id, username, name, employee_id, dept_name FROM users WHERE status='active' ORDER BY name ASC`
    ).all();
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── LOV: 角色列表（Layer 2）──────────────────────────────────────────────────
router.get('/lov/roles', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const roles = await db.prepare(`SELECT id, name, description FROM roles ORDER BY name ASC`).all();
    res.json(roles);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 政策 CRUD ─────────────────────────────────────────────────────────────────
// GET /api/data-permissions/policies
router.get('/policies', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const policies = await db.prepare(
      `SELECT p.*, u.name AS creator_name
       FROM ai_data_policies p
       LEFT JOIN users u ON u.id = p.created_by
       ORDER BY p.id ASC`
    ).all();
    for (const p of policies) {
      p.rules = await db.prepare(
        `SELECT * FROM ai_data_policy_rules WHERE policy_id=? ORDER BY layer ASC, sort_order ASC, id ASC`
      ).all(p.id);
    }
    res.json(policies);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/data-permissions/policies
router.post('/policies', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { name, description, rules = [] } = req.body;
    if (!name) return res.status(400).json({ error: 'name 為必填' });
    const r = await db.prepare(
      `INSERT INTO ai_data_policies (name, description, created_by) VALUES (?,?,?)`
    ).run(name, description || null, req.user.id);
    const policyId = r.lastInsertRowid;
    await _saveRules(db, policyId, rules);
    res.json({ id: policyId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/data-permissions/policies/:id
router.put('/policies/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { name, description, rules = [] } = req.body;
    await db.prepare(
      `UPDATE ai_data_policies SET name=?, description=?, updated_at=SYSTIMESTAMP WHERE id=?`
    ).run(name, description || null, req.params.id);
    await _saveRules(db, req.params.id, rules);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/data-permissions/policies/:id
router.delete('/policies/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(`DELETE FROM ai_data_policies WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function _saveRules(db, policyId, rules) {
  await db.prepare(`DELETE FROM ai_data_policy_rules WHERE policy_id=?`).run(policyId);
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    await db.prepare(
      `INSERT INTO ai_data_policy_rules (policy_id, layer, include_type, value_type, value_id, value_name, sort_order)
       VALUES (?,?,?,?,?,?,?)`
    ).run(policyId, r.layer, r.include_type || 'include', r.value_type, r.value_id || null, r.value_name || null, i);
  }
}

// ── 指派：角色 ────────────────────────────────────────────────────────────────
// PUT /api/data-permissions/assignments/role/:roleId
router.put('/assignments/role/:roleId', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { policy_id } = req.body; // null = 移除
    await _upsertAssignment(db, 'role', req.params.roleId, policy_id, 1);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/data-permissions/assignments/user/:userId
router.put('/assignments/user/:userId', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { policy_id } = req.body;
    await _upsertAssignment(db, 'user', req.params.userId, policy_id, 1); // override always 1
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/data-permissions/assignments — 全部指派
router.get('/assignments', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(
      `SELECT a.*, p.name AS policy_name
       FROM ai_policy_assignments a
       LEFT JOIN ai_data_policies p ON p.id=a.policy_id
       ORDER BY a.grantee_type ASC, a.grantee_id ASC`
    ).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function _upsertAssignment(db, granteeType, granteeId, policyId, overrideRole) {
  const existing = await db.prepare(
    `SELECT id FROM ai_policy_assignments WHERE grantee_type=? AND grantee_id=?`
  ).get(granteeType, String(granteeId));
  if (policyId == null) {
    if (existing) {
      await db.prepare(`DELETE FROM ai_policy_assignments WHERE id=?`).run(existing.id);
    }
  } else if (existing) {
    await db.prepare(
      `UPDATE ai_policy_assignments SET policy_id=?, override_role=? WHERE id=?`
    ).run(policyId, overrideRole ? 1 : 0, existing.id);
  } else {
    await db.prepare(
      `INSERT INTO ai_policy_assignments (policy_id, grantee_type, grantee_id, override_role) VALUES (?,?,?,?)`
    ).run(policyId, granteeType, String(granteeId), overrideRole ? 1 : 0);
  }
}

// ── 有效政策（給定使用者）────────────────────────────────────────────────────
// GET /api/data-permissions/effective/:userId
router.get('/effective/:userId', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const policy = await getEffectivePolicy(db, req.params.userId);
    res.json(policy || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * 計算使用者有效政策：
 * 1. 使用者有個人指派政策 → 用使用者的
 * 2. 沒有個人政策 → 用角色的
 * 3. 都沒有 → null（不過濾）
 */
async function getEffectivePolicy(db, userId) {
  const user = await db.prepare(
    `SELECT id, role_id FROM users WHERE id=?`
  ).get(userId);
  if (!user) return null;

  const userAssign = await db.prepare(
    `SELECT policy_id FROM ai_policy_assignments WHERE grantee_type='user' AND grantee_id=?`
  ).get(String(userId));

  let policyId = userAssign?.policy_id ?? null;

  // 沒有個人政策 → 看角色
  if (!policyId && user.role_id) {
    const roleAssign = await db.prepare(
      `SELECT policy_id FROM ai_policy_assignments WHERE grantee_type='role' AND grantee_id=?`
    ).get(String(user.role_id));
    policyId = roleAssign?.policy_id ?? null;
  }

  if (!policyId) return null;

  const rules = await db.prepare(
    `SELECT * FROM ai_data_policy_rules WHERE policy_id=? ORDER BY layer, sort_order, id`
  ).all(policyId);

  return { rules };
}

module.exports = router;
module.exports.getEffectivePolicy = getEffectivePolicy;
