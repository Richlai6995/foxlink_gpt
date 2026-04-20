'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');
const { translateFields } = require('../services/translationService');
const { testConnector, parseJson } = require('../services/apiConnectorService');
const { resolveGranteeNamesInRows, getLangFromReq } = require('../services/granteeNameResolver');

router.use(verifyToken);

function getDb() { return require('../database-oracle').db; }

function requireAdmin(req, res) {
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: '僅管理員可操作 API 連接器設定' });
    return false;
  }
  return true;
}

function twNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
}
function twTimestamp(d = twNow()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ── API 連接器新增欄位清單 ──
const CONNECTOR_FIELDS = [
  'connector_type', 'http_method', 'content_type',
  'auth_type', 'auth_header_name', 'auth_query_param_name', 'auth_config',
  'request_headers', 'request_body_template', 'input_params',
  'response_type', 'response_extract', 'response_template', 'empty_message', 'error_mapping',
  'email_domain_fallback',
];

function maskApiKey(kb) {
  return {
    ...kb,
    api_key_masked: kb.api_key ? '***' + kb.api_key.slice(-8) : '',
  };
}

// GET /api/dify-kb  — list all (admin only)
router.get('/', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const kbs = await db.prepare(`SELECT * FROM dify_knowledge_bases ORDER BY sort_order ASC, created_at DESC`).all();
    res.json(kbs.map(maskApiKey));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/dify-kb/active  — used by chat route (no admin check, only token required)
router.get('/active', async (req, res) => {
  const db = getDb();
  try {
    const kbs = await db.prepare(
      `SELECT id, name, api_server, api_key, description, tags,
              connector_type, http_method, content_type,
              auth_type, auth_header_name, auth_query_param_name, auth_config,
              request_headers, request_body_template, input_params,
              response_type, response_extract, response_template, empty_message, error_mapping
       FROM dify_knowledge_bases WHERE is_active=1 ORDER BY sort_order ASC`
    ).all();
    res.json(kbs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/dify-kb/my  — 依 dify_access 回傳當前使用者可用的 API 連接器（含公開已核准）
router.get('/my', async (req, res) => {
  const db = getDb();
  try {
    const selectCols = `id, name, DBMS_LOB.SUBSTR(description, 2000, 1) AS description,
            api_server, api_key, is_public, public_approved,
            name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi, tags,
            connector_type, input_params`;

    // Admin 可見所有 active KB（方便 debug）
    if (req.user.role === 'admin') {
      const allKbs = await db.prepare(
        `SELECT ${selectCols}, 0 AS is_readonly
         FROM dify_knowledge_bases WHERE is_active=1 ORDER BY sort_order ASC`
      ).all();
      return res.json(allKbs);
    }

    // 公開且已核准的項目（所有使用者可見）
    const publicKbs = await db.prepare(
      `SELECT ${selectCols}, 1 AS is_readonly
       FROM dify_knowledge_bases WHERE is_active=1 AND is_public=1 AND public_approved=1
       ORDER BY sort_order ASC`
    ).all();
    const publicIdSet = new Set(publicKbs.map(k => k.id));

    const u = await db.prepare(
      `SELECT role_id, dept_code, profit_center, org_section, org_group_name, factory_code FROM users WHERE id=?`
    ).get(req.user.id);
    if (!u) return res.json(publicKbs);

    const accessibleIds = await db.prepare(
      `SELECT DISTINCT a.dify_kb_id
       FROM dify_access a
       JOIN dify_knowledge_bases d ON d.id = a.dify_kb_id
       WHERE d.is_active=1 AND (
         (a.grantee_type='user'        AND a.grantee_id=?)
         OR (a.grantee_type='role'        AND a.grantee_id=? AND ? IS NOT NULL)
         OR (a.grantee_type='department'  AND a.grantee_id=? AND ? IS NOT NULL)
         OR (a.grantee_type='cost_center' AND a.grantee_id=? AND ? IS NOT NULL)
         OR (a.grantee_type='division'    AND a.grantee_id=? AND ? IS NOT NULL)
         OR (a.grantee_type='factory'     AND a.grantee_id=? AND ? IS NOT NULL)
         OR (a.grantee_type='org_group'   AND a.grantee_id=? AND ? IS NOT NULL)
       )`
    ).all(
      String(req.user.id),
      u.role_id != null ? String(u.role_id) : null, u.role_id,
      u.dept_code, u.dept_code,
      u.profit_center, u.profit_center,
      u.org_section, u.org_section,
      u.factory_code, u.factory_code,
      u.org_group_name, u.org_group_name
    );
    const privateIds = accessibleIds.map(r => r.dify_kb_id).filter(id => !publicIdSet.has(id));
    let privateKbs = [];
    if (privateIds.length) {
      const placeholders = privateIds.map(() => '?').join(',');
      privateKbs = await db.prepare(
        `SELECT ${selectCols}, 0 AS is_readonly
         FROM dify_knowledge_bases
         WHERE id IN (${placeholders}) AND is_active=1
         ORDER BY sort_order ASC`
      ).all(...privateIds);
    }
    res.json([...publicKbs, ...privateKbs]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/dify-kb/unauthorized  — admin only: 列出 admin 尚無權限的 active 項目（供測試模式）
router.get('/unauthorized', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const all = await db.prepare(
      `SELECT id, name, DBMS_LOB.SUBSTR(description, 2000, 1) AS description,
              name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi, tags, connector_type
       FROM dify_knowledge_bases WHERE is_active=1 ORDER BY sort_order ASC`
    ).all();

    const publicIds = await db.prepare(
      `SELECT id FROM dify_knowledge_bases WHERE is_active=1 AND is_public=1 AND public_approved=1`
    ).all();
    const authorizedSet = new Set(publicIds.map(r => r.id));

    const u = await db.prepare(
      `SELECT role_id, dept_code, profit_center, org_section, org_group_name, factory_code FROM users WHERE id=?`
    ).get(req.user.id);
    if (u) {
      const granted = await db.prepare(
        `SELECT DISTINCT a.dify_kb_id FROM dify_access a
         JOIN dify_knowledge_bases d ON d.id = a.dify_kb_id
         WHERE d.is_active=1 AND (
           (a.grantee_type='user'        AND a.grantee_id=?)
           OR (a.grantee_type='role'        AND a.grantee_id=? AND ? IS NOT NULL)
           OR (a.grantee_type='department'  AND a.grantee_id=? AND ? IS NOT NULL)
           OR (a.grantee_type='cost_center' AND a.grantee_id=? AND ? IS NOT NULL)
           OR (a.grantee_type='division'    AND a.grantee_id=? AND ? IS NOT NULL)
           OR (a.grantee_type='factory'     AND a.grantee_id=? AND ? IS NOT NULL)
           OR (a.grantee_type='org_group'   AND a.grantee_id=? AND ? IS NOT NULL)
         )`
      ).all(
        String(req.user.id),
        u.role_id != null ? String(u.role_id) : null, u.role_id,
        u.dept_code, u.dept_code,
        u.profit_center, u.profit_center,
        u.org_section, u.org_section,
        u.factory_code, u.factory_code,
        u.org_group_name, u.org_group_name
      );
      granted.forEach(r => authorizedSet.add(r.dify_kb_id));
    }
    res.json(all.filter(k => !authorizedSet.has(k.id)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/dify-kb/:id/access  — 列出共享清單（admin only）
router.get('/:id/access', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const grants = await db.prepare(
      `SELECT a.*,
        CASE WHEN a.grantee_type='user'        THEN (SELECT name FROM users WHERE id=TO_NUMBER(a.grantee_id))
             WHEN a.grantee_type='role'        THEN (SELECT name FROM roles WHERE id=TO_NUMBER(a.grantee_id))
             WHEN a.grantee_type='department'  THEN (SELECT MAX(dept_name) FROM users WHERE dept_code=a.grantee_id)
             WHEN a.grantee_type='cost_center' THEN (SELECT MAX(profit_center_name) FROM users WHERE profit_center=a.grantee_id)
             WHEN a.grantee_type='division'    THEN (SELECT MAX(org_section_name) FROM users WHERE org_section=a.grantee_id)
             ELSE a.grantee_id END AS grantee_name,
        u.name AS granted_by_name
       FROM dify_access a LEFT JOIN users u ON u.id = a.granted_by
       WHERE a.dify_kb_id=? ORDER BY a.granted_at DESC`
    ).all(req.params.id);
    await resolveGranteeNamesInRows(grants, getLangFromReq(req), db);
    res.json(grants);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dify-kb/:id/access  — 新增共享，回傳完整清單
router.post('/:id/access', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const { grantee_type, grantee_id, share_type = 'use' } = req.body;
    const validTypes = ['user', 'role', 'factory', 'department', 'cost_center', 'division', 'org_group'];
    if (!validTypes.includes(grantee_type) || !grantee_id) {
      return res.status(400).json({ error: '請選擇有效的共享對象' });
    }
    const existing = await db.prepare(
      `SELECT id FROM dify_access WHERE dify_kb_id=? AND grantee_type=? AND grantee_id=?`
    ).get(req.params.id, grantee_type, String(grantee_id));
    if (existing) {
      await db.prepare(`UPDATE dify_access SET share_type=? WHERE id=?`).run(share_type, existing.id);
    } else {
      await db.prepare(
        `INSERT INTO dify_access (dify_kb_id, grantee_type, grantee_id, share_type, granted_by) VALUES (?,?,?,?,?)`
      ).run(req.params.id, grantee_type, String(grantee_id), share_type, req.user.id);
    }
    const grants = await db.prepare(
      `SELECT a.*,
        CASE WHEN a.grantee_type='user'        THEN (SELECT name FROM users WHERE id=TO_NUMBER(a.grantee_id))
             WHEN a.grantee_type='role'        THEN (SELECT name FROM roles WHERE id=TO_NUMBER(a.grantee_id))
             WHEN a.grantee_type='department'  THEN (SELECT MAX(dept_name) FROM users WHERE dept_code=a.grantee_id)
             WHEN a.grantee_type='cost_center' THEN (SELECT MAX(profit_center_name) FROM users WHERE profit_center=a.grantee_id)
             WHEN a.grantee_type='division'    THEN (SELECT MAX(org_section_name) FROM users WHERE org_section=a.grantee_id)
             ELSE a.grantee_id END AS grantee_name,
        u.name AS granted_by_name
       FROM dify_access a LEFT JOIN users u ON u.id = a.granted_by
       WHERE a.dify_kb_id=? ORDER BY a.granted_at DESC`
    ).all(req.params.id);
    await resolveGranteeNamesInRows(grants, getLangFromReq(req), db);
    res.json(grants);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/dify-kb/:id/access/:grantId
router.delete('/:id/access/:grantId', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    await db.prepare(`DELETE FROM dify_access WHERE id=? AND dify_kb_id=?`).run(req.params.grantId, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dify-kb
router.post('/', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const { name, api_server, api_key, description, is_active, sort_order,
            name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi, tags,
            // 新欄位
            connector_type, http_method, content_type,
            auth_type, auth_header_name, auth_query_param_name, auth_config,
            request_headers, request_body_template, input_params,
            response_type, response_extract, response_template, empty_message, error_mapping,
            email_domain_fallback,
    } = req.body;

    const connType = connector_type || 'dify';
    // DIFY 必填 api_server + api_key; REST API api_key 可選（auth_type=none 時）
    if (!name || !api_server) {
      return res.status(400).json({ error: '名稱和 API URL 為必填' });
    }
    if (connType === 'dify' && !api_key) {
      return res.status(400).json({ error: 'DIFY 類型必須提供 API Key' });
    }

    const tagsStr = JSON.stringify(tags || []);
    const result = await db.prepare(
      `INSERT INTO dify_knowledge_bases (
        name, api_server, api_key, description, is_active, sort_order, tags,
        connector_type, http_method, content_type,
        auth_type, auth_header_name, auth_query_param_name, auth_config,
        request_headers, request_body_template, input_params,
        response_type, response_extract, response_template, empty_message, error_mapping,
        email_domain_fallback
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      name,
      api_server.replace(/\/$/, ''),
      api_key || null,
      description || null,
      is_active !== false ? 1 : 0,
      sort_order || 0,
      tagsStr,
      connType,
      http_method || 'POST',
      content_type || 'application/json',
      auth_type || (connType === 'dify' ? 'bearer' : 'none'),
      auth_header_name || null,
      auth_query_param_name || null,
      typeof auth_config === 'object' ? JSON.stringify(auth_config) : (auth_config || null),
      typeof request_headers === 'object' ? JSON.stringify(request_headers) : (request_headers || null),
      typeof request_body_template === 'object' ? JSON.stringify(request_body_template) : (request_body_template || null),
      typeof input_params === 'object' ? JSON.stringify(input_params) : (input_params || null),
      response_type || (connType === 'dify' ? 'json' : 'text'),
      response_extract || null,
      response_template || null,
      empty_message || null,
      typeof error_mapping === 'object' ? JSON.stringify(error_mapping) : (error_mapping || null),
      email_domain_fallback ? 1 : 0,
    );

    const newId = result.lastInsertRowid;
    const trans = (name_zh !== undefined)
      ? { name_zh: name_zh || null, name_en: name_en || null, name_vi: name_vi || null, desc_zh: desc_zh || null, desc_en: desc_en || null, desc_vi: desc_vi || null }
      : await translateFields({ name, description }).catch(() => ({ name_zh: null, name_en: null, name_vi: null, desc_zh: null, desc_en: null, desc_vi: null }));
    if (trans.name_zh !== undefined) {
      await db.prepare(`UPDATE dify_knowledge_bases SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
        .run(trans.name_zh, trans.name_en, trans.name_vi, trans.desc_zh, trans.desc_en, trans.desc_vi, newId);
    }
    const kb = await db.prepare(`SELECT * FROM dify_knowledge_bases WHERE id=?`).get(newId);
    res.json(maskApiKey(kb));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/dify-kb/:id
router.put('/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const kb = await db.prepare(`SELECT * FROM dify_knowledge_bases WHERE id=?`).get(req.params.id);
    if (!kb) return res.status(404).json({ error: '找不到 API 連接器設定' });

    const { name, api_server, api_key, description, is_active, sort_order,
            name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi, is_public, tags,
            // 新欄位
            connector_type, http_method, content_type,
            auth_type, auth_header_name, auth_query_param_name, auth_config,
            request_headers, request_body_template, input_params,
            response_type, response_extract, response_template, empty_message, error_mapping,
            email_domain_fallback,
    } = req.body;

    const finalName = name ?? kb.name;
    const finalDesc = description !== undefined ? (description || null) : kb.description;
    const newIsPublic = is_public !== undefined ? (is_public ? 1 : 0) : (kb.is_public || 0);
    const newPublicApproved = newIsPublic ? (kb.public_approved || 0) : 0;
    const tagsStr = tags !== undefined ? JSON.stringify(tags || []) : kb.tags;

    // 動態建構 SET clauses
    const sets = [];
    const params = [];
    const addSet = (col, val) => { sets.push(`${col}=?`); params.push(val); };

    addSet('name', finalName);
    addSet('api_server', api_server ? api_server.replace(/\/$/, '') : kb.api_server);
    addSet('api_key', api_key || kb.api_key);
    addSet('description', finalDesc);
    addSet('is_active', is_active !== undefined ? (is_active ? 1 : 0) : kb.is_active);
    addSet('sort_order', sort_order !== undefined ? sort_order : kb.sort_order);
    addSet('is_public', newIsPublic);
    addSet('public_approved', newPublicApproved);
    addSet('tags', tagsStr);

    // API 連接器新欄位
    if (connector_type !== undefined) addSet('connector_type', connector_type);
    if (http_method !== undefined) addSet('http_method', http_method);
    if (content_type !== undefined) addSet('content_type', content_type);
    if (auth_type !== undefined) addSet('auth_type', auth_type);
    if (auth_header_name !== undefined) addSet('auth_header_name', auth_header_name || null);
    if (auth_query_param_name !== undefined) addSet('auth_query_param_name', auth_query_param_name || null);
    if (auth_config !== undefined) addSet('auth_config', typeof auth_config === 'object' ? JSON.stringify(auth_config) : (auth_config || null));
    if (request_headers !== undefined) addSet('request_headers', typeof request_headers === 'object' ? JSON.stringify(request_headers) : (request_headers || null));
    if (request_body_template !== undefined) addSet('request_body_template', typeof request_body_template === 'object' ? JSON.stringify(request_body_template) : (request_body_template || null));
    if (input_params !== undefined) addSet('input_params', typeof input_params === 'object' ? JSON.stringify(input_params) : (input_params || null));
    if (response_type !== undefined) addSet('response_type', response_type);
    if (response_extract !== undefined) addSet('response_extract', response_extract || null);
    if (response_template !== undefined) addSet('response_template', response_template || null);
    if (empty_message !== undefined) addSet('empty_message', empty_message || null);
    if (error_mapping !== undefined) addSet('error_mapping', typeof error_mapping === 'object' ? JSON.stringify(error_mapping) : (error_mapping || null));
    if (email_domain_fallback !== undefined) addSet('email_domain_fallback', email_domain_fallback ? 1 : 0);

    sets.push('updated_at=SYSTIMESTAMP');
    params.push(req.params.id);

    await db.prepare(`UPDATE dify_knowledge_bases SET ${sets.join(', ')} WHERE id=?`).run(...params);

    if (name_zh !== undefined) {
      await db.prepare(`UPDATE dify_knowledge_bases SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
        .run(name_zh || null, name_en || null, name_vi || null, desc_zh || null, desc_en || null, desc_vi || null, req.params.id);
    } else {
      const nameChanged = name !== undefined && name !== kb.name;
      const descChanged = description !== undefined && description !== kb.description;
      if (nameChanged || descChanged) {
        const trans = await translateFields({
          name: nameChanged ? finalName : null,
          description: descChanged ? finalDesc : null,
        }).catch(() => ({}));
        const setClauses = [];
        const tParams = [];
        if (nameChanged && trans.name_zh !== undefined) { setClauses.push('name_zh=?,name_en=?,name_vi=?'); tParams.push(trans.name_zh, trans.name_en, trans.name_vi); }
        if (descChanged && trans.desc_zh !== undefined) { setClauses.push('desc_zh=?,desc_en=?,desc_vi=?'); tParams.push(trans.desc_zh, trans.desc_en, trans.desc_vi); }
        if (setClauses.length) await db.prepare(`UPDATE dify_knowledge_bases SET ${setClauses.join(',')} WHERE id=?`).run(...tParams, req.params.id);
      }
    }

    const updated = await db.prepare(`SELECT * FROM dify_knowledge_bases WHERE id=?`).get(req.params.id);
    res.json(maskApiKey(updated));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/dify-kb/:id
router.delete('/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const kb = await db.prepare(`SELECT id FROM dify_knowledge_bases WHERE id=?`).get(req.params.id);
    if (!kb) return res.status(404).json({ error: '找不到 API 連接器設定' });
    await db.prepare(`DELETE FROM dify_knowledge_bases WHERE id=?`).run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dify-kb/:id/approve  — 核准/取消核准公開（toggle）
router.post('/:id/approve', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const kb = await db.prepare(`SELECT id, is_public, public_approved FROM dify_knowledge_bases WHERE id=?`).get(req.params.id);
    if (!kb) return res.status(404).json({ error: '找不到 API 連接器設定' });
    if (!kb.is_public) return res.status(400).json({ error: '此連接器未申請公開' });
    const newApproved = kb.public_approved ? 0 : 1;
    await db.prepare(`UPDATE dify_knowledge_bases SET public_approved=?, updated_at=SYSTIMESTAMP WHERE id=?`).run(newApproved, req.params.id);
    res.json({ public_approved: newApproved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dify-kb/:id/toggle
router.post('/:id/toggle', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const kb = await db.prepare(`SELECT * FROM dify_knowledge_bases WHERE id=?`).get(req.params.id);
    if (!kb) return res.status(404).json({ error: '找不到 API 連接器設定' });
    const newActive = kb.is_active ? 0 : 1;
    await db.prepare(`UPDATE dify_knowledge_bases SET is_active=?, updated_at=SYSTIMESTAMP WHERE id=?`)
      .run(newActive, req.params.id);
    res.json({ is_active: newActive });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/dify-kb/:id/test  — 測試 API 連接器（支援 DIFY + REST API）
router.post('/:id/test', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const kb = await db.prepare(`SELECT * FROM dify_knowledge_bases WHERE id=?`).get(req.params.id);
    if (!kb) return res.status(404).json({ error: '找不到 API 連接器設定' });

    // 取得使用者資訊作為 system_* 參數的來源
    const user = await db.prepare(`SELECT id, email, name, employee_id, dept_code FROM users WHERE id=?`).get(req.user.id);
    const userCtx = user || { id: req.user.id, email: '', name: '', employee_id: '', dept_code: '' };

    // req.body.test_params 是管理員手動填入的 user_input 參數值
    const testParams = req.body.test_params || {};
    if (req.body.query) testParams.query = req.body.query;

    const result = await testConnector(kb, testParams, userCtx);
    if (result.success) {
      res.json(result);
    } else {
      res.status(502).json({ error: result.error, duration_ms: result.duration_ms });
    }
  } catch (e) {
    res.status(500).json({ error: `連線失敗：${e.message}` });
  }
});

// POST /api/dify-kb/:id/translate — 重新翻譯
router.post('/:id/translate', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const kb = await db.prepare(`SELECT * FROM dify_knowledge_bases WHERE id=?`).get(req.params.id);
    if (!kb) return res.status(404).json({ error: '找不到 API 連接器設定' });
    const trans = await translateFields({ name: kb.name, description: kb.description });
    await db.prepare(`UPDATE dify_knowledge_bases SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
      .run(trans.name_zh, trans.name_en, trans.name_vi, trans.desc_zh, trans.desc_en, trans.desc_vi, req.params.id);
    res.json(trans);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/dify-kb/:id/logs
router.get('/:id/logs', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const kb = await db.prepare(`SELECT id FROM dify_knowledge_bases WHERE id=?`).get(req.params.id);
    if (!kb) return res.status(404).json({ error: '找不到 API 連接器設定' });

    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    const logs = await db.prepare(
      `SELECT l.*, u.name as user_name FROM dify_call_logs l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE l.kb_id=? ORDER BY l.called_at DESC FETCH FIRST ? ROWS ONLY`
    ).all(req.params.id, limit);
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
