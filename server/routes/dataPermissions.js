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

// ── Simple Assignments（role/user → single policy）────────────────────────────
// GET /api/data-permissions/assignments — 回傳全部 grantee_type/grantee_id/policy_id
router.get('/assignments', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(
      `SELECT grantee_type, grantee_id, policy_id FROM ai_policy_assignments ORDER BY grantee_type, grantee_id`
    ).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/data-permissions/assignments/role/:roleId
router.put('/assignments/role/:roleId', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { roleId } = req.params;
    const { policy_id } = req.body;
    await db.prepare(`DELETE FROM ai_policy_assignments WHERE grantee_type='role' AND grantee_id=?`).run(roleId);
    if (policy_id) {
      await db.prepare(`INSERT INTO ai_policy_assignments (grantee_type, grantee_id, policy_id) VALUES ('role', ?, ?)`).run(roleId, policy_id);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/data-permissions/assignments/user/:userId
router.put('/assignments/user/:userId', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { userId } = req.params;
    const { policy_id } = req.body;
    await db.prepare(`DELETE FROM ai_policy_assignments WHERE grantee_type='user' AND grantee_id=?`).run(userId);
    if (policy_id) {
      await db.prepare(`INSERT INTO ai_policy_assignments (grantee_type, grantee_id, policy_id) VALUES ('user', ?, ?)`).run(userId, policy_id);
    }
    res.json({ ok: true });
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

// ── 政策類別 CRUD ─────────────────────────────────────────────────────────────
// GET /api/data-permissions/categories
router.get('/categories', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const cats = await db.prepare(`SELECT * FROM ai_policy_categories ORDER BY id ASC`).all();
    // 每個類別附帶對應的 policy_ids
    for (const c of cats) {
      const maps = await db.prepare(
        `SELECT policy_id FROM ai_policy_category_map WHERE category_id=?`
      ).all(c.id);
      c.policy_ids = maps.map(m => m.policy_id);
    }
    res.json(cats);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/data-permissions/categories
router.post('/categories', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: '名稱為必填' });
    await db.prepare(
      `INSERT INTO ai_policy_categories (name, description) VALUES (?,?)`
    ).run(name, description || null);
    const id = (await db.prepare(`SELECT MAX(id) AS id FROM ai_policy_categories`).get())?.id;
    res.json({ id, name, description });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/data-permissions/categories/:id
router.put('/categories/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { name, description } = req.body;
    await db.prepare(`UPDATE ai_policy_categories SET name=?, description=? WHERE id=?`)
      .run(name, description || null, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/data-permissions/categories/:id
router.delete('/categories/:id', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(`DELETE FROM ai_policy_categories WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/data-permissions/categories/:id/policies — 設定此類別對應哪些政策
router.put('/categories/:id/policies', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { policy_ids } = req.body; // array of policy_id
    await db.prepare(`DELETE FROM ai_policy_category_map WHERE category_id=?`).run(req.params.id);
    for (const pid of (policy_ids || [])) {
      const exists = await db.prepare(
        `SELECT 1 FROM ai_policy_category_map WHERE policy_id=? AND category_id=?`
      ).get(pid, req.params.id);
      if (!exists) {
        await db.prepare(`INSERT INTO ai_policy_category_map (policy_id, category_id) VALUES (?,?)`).run(pid, req.params.id);
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 角色政策多選指派 ─────────────────────────────────────────────────────────
// GET /api/data-permissions/role-policies/:roleId
router.get('/role-policies/:roleId', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(
      `SELECT rp.policy_id, rp.priority, p.name
       FROM ai_role_policies rp JOIN ai_data_policies p ON p.id=rp.policy_id
       WHERE rp.role_id=? ORDER BY rp.priority ASC`
    ).all(req.params.roleId);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/data-permissions/role-policies/:roleId — 整批覆寫
router.put('/role-policies/:roleId', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { policies } = req.body; // [{policy_id, priority}]
    await db.prepare(`DELETE FROM ai_role_policies WHERE role_id=?`).run(req.params.roleId);
    for (const p of (policies || [])) {
      await db.prepare(`INSERT INTO ai_role_policies (role_id, policy_id, priority) VALUES (?,?,?)`)
        .run(req.params.roleId, p.policy_id, p.priority ?? 10);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 使用者政策多選指派 ───────────────────────────────────────────────────────
// GET /api/data-permissions/user-policies/:userId
router.get('/user-policies/:userId', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(
      `SELECT up.policy_id, up.priority, p.name
       FROM ai_user_policies up JOIN ai_data_policies p ON p.id=up.policy_id
       WHERE up.user_id=? ORDER BY up.priority ASC`
    ).all(req.params.userId);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/data-permissions/user-policies/:userId — 整批覆寫
router.put('/user-policies/:userId', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { policies } = req.body; // [{policy_id, priority}] 或 []
    await db.prepare(`DELETE FROM ai_user_policies WHERE user_id=?`).run(req.params.userId);
    for (const p of (policies || [])) {
      await db.prepare(`INSERT INTO ai_user_policies (user_id, policy_id, priority) VALUES (?,?,?)`)
        .run(req.params.userId, p.policy_id, p.priority ?? 10);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 有效政策（給定使用者 + 類別）────────────────────────────────────────────
// GET /api/data-permissions/effective/:userId?category_id=X
router.get('/effective/:userId', async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const categoryId = req.query.category_id ? Number(req.query.category_id) : null;
    const policies = await getEffectivePolicies(db, req.params.userId, categoryId);
    res.json(policies);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * 計算使用者有效政策陣列（依類別過濾）：
 * 1. 使用者有個人指派政策 → 用使用者的（過濾符合 categoryId 的）
 * 2. 無個人政策 → 用角色的
 * 3. 都沒有 → []（無權限，如果 categoryId 存在）
 *
 * @param {object} db
 * @param {number|string} userId
 * @param {number|null} categoryId  null = 不過濾類別（backward compat）
 * @returns {Promise<{rules: object[]}[]>}
 */
async function getEffectivePolicies(db, userId, categoryId = null) {
  const user = await db.prepare(`SELECT id, role_id FROM users WHERE id=?`).get(userId);
  if (!user) return [];

  // ── 使用者直接指派的政策 ──
  let userPolicies = [];
  if (categoryId) {
    userPolicies = await db.prepare(
      `SELECT p.id, p.name, p.priority, up.priority AS assign_priority
       FROM ai_user_policies up
       JOIN ai_data_policies p ON p.id = up.policy_id
       JOIN ai_policy_category_map pcm ON pcm.policy_id = p.id
       WHERE up.user_id = ? AND pcm.category_id = ?
       ORDER BY up.priority ASC, p.priority ASC`
    ).all(userId, categoryId);
  } else {
    // Backward compat: 無類別 → 取所有使用者政策
    userPolicies = await db.prepare(
      `SELECT p.id, p.name, p.priority, up.priority AS assign_priority
       FROM ai_user_policies up
       JOIN ai_data_policies p ON p.id = up.policy_id
       WHERE up.user_id = ?
       ORDER BY up.priority ASC`
    ).all(userId);
  }

  // 使用者有直接設定 → 用使用者的（覆蓋角色）
  if (userPolicies.length > 0) {
    return await _loadPoliciesWithRules(db, userPolicies.map(p => p.id));
  }

  // ── 角色的政策 ──
  if (!user.role_id) return [];

  let rolePolicies = [];
  if (categoryId) {
    rolePolicies = await db.prepare(
      `SELECT p.id, p.name, p.priority, rp.priority AS assign_priority
       FROM ai_role_policies rp
       JOIN ai_data_policies p ON p.id = rp.policy_id
       JOIN ai_policy_category_map pcm ON pcm.policy_id = p.id
       WHERE rp.role_id = ? AND pcm.category_id = ?
       ORDER BY rp.priority ASC, p.priority ASC`
    ).all(user.role_id, categoryId);
  } else {
    rolePolicies = await db.prepare(
      `SELECT p.id, p.name, p.priority, rp.priority AS assign_priority
       FROM ai_role_policies rp
       JOIN ai_data_policies p ON p.id = rp.policy_id
       WHERE rp.role_id = ?
       ORDER BY rp.priority ASC`
    ).all(user.role_id);
  }

  if (rolePolicies.length > 0) {
    return await _loadPoliciesWithRules(db, rolePolicies.map(p => p.id));
  }

  // ── Backward compat: 舊 ai_policy_assignments ──（categoryId 為 null 時才 fallback）
  if (!categoryId) {
    const oldAssign = await db.prepare(
      `SELECT policy_id FROM ai_policy_assignments WHERE grantee_type='user' AND grantee_id=?`
    ).get(String(userId));
    let policyId = oldAssign?.policy_id ?? null;
    if (!policyId && user.role_id) {
      const roleAssign = await db.prepare(
        `SELECT policy_id FROM ai_policy_assignments WHERE grantee_type='role' AND grantee_id=?`
      ).get(String(user.role_id));
      policyId = roleAssign?.policy_id ?? null;
    }
    if (policyId) return await _loadPoliciesWithRules(db, [policyId]);
  }

  return [];
}

async function _loadPoliciesWithRules(db, policyIds) {
  const result = [];
  for (const id of policyIds) {
    const rules = await db.prepare(
      `SELECT * FROM ai_data_policy_rules WHERE policy_id=? ORDER BY layer, sort_order, id`
    ).all(id);
    result.push({ id, rules });
  }
  return result;
}

/** Backward compat 單一政策包裝（供舊呼叫點用） */
async function getEffectivePolicy(db, userId) {
  const policies = await getEffectivePolicies(db, userId, null);
  if (!policies.length) return null;
  // 合併所有政策的 rules
  return { rules: policies.flatMap(p => p.rules) };
}

module.exports = router;
module.exports.getEffectivePolicy  = getEffectivePolicy;
module.exports.getEffectivePolicies = getEffectivePolicies;
