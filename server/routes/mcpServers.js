'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');
const mcpClient = require('../services/mcpClient');
const { translateFields } = require('../services/translationService');

router.use(verifyToken);

function getDb() { return require('../database-oracle').db; }

function requireAdmin(req, res) {
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: '僅管理員可操作 MCP 伺服器設定' });
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

// GET /api/mcp-servers
router.get('/', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const servers = await db.prepare(`SELECT * FROM mcp_servers ORDER BY created_at DESC`).all();
    res.json(servers);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/mcp-servers
router.post('/', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const { name, url, api_key, description, is_active, response_mode,
            transport_type, command, args_json, env_json,
            name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi } = req.body;
    const tt = transport_type || 'http-post';
    if (!name) return res.status(400).json({ error: '名稱為必填' });
    if (tt !== 'stdio' && !url) return res.status(400).json({ error: 'URL 為必填（非 stdio 模式）' });
    if (tt === 'stdio' && !command) return res.status(400).json({ error: 'stdio 模式需填寫指令' });

    const result = await db.prepare(
      `INSERT INTO mcp_servers (name, url, api_key, description, is_active, response_mode, transport_type, command, args_json, env_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(name, url || null, api_key || null, description || null, is_active !== false ? 1 : 0, response_mode || 'inject',
          tt, command || null, args_json || null, env_json || null);

    const newId = result.lastInsertRowid;
    const trans = (name_zh !== undefined)
      ? { name_zh: name_zh || null, name_en: name_en || null, name_vi: name_vi || null, desc_zh: desc_zh || null, desc_en: desc_en || null, desc_vi: desc_vi || null }
      : await translateFields({ name, description }).catch(() => ({ name_zh: null, name_en: null, name_vi: null, desc_zh: null, desc_en: null, desc_vi: null }));
    if (trans.name_zh !== undefined) {
      await db.prepare(`UPDATE mcp_servers SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
        .run(trans.name_zh, trans.name_en, trans.name_vi, trans.desc_zh, trans.desc_en, trans.desc_vi, newId);
    }
    const server = await db.prepare(`SELECT * FROM mcp_servers WHERE id=?`).get(newId);
    res.json(server);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/mcp-servers/:id
router.put('/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const server = await db.prepare(`SELECT * FROM mcp_servers WHERE id=?`).get(req.params.id);
    if (!server) return res.status(404).json({ error: '找不到 MCP 伺服器' });

    const { name, url, api_key, description, is_active, response_mode,
            transport_type, command, args_json, env_json,
            name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi } = req.body;
    const finalName = name ?? server.name;
    const finalDesc = description !== undefined ? (description || null) : server.description;
    const finalTt = transport_type !== undefined ? (transport_type || 'http-post') : (server.transport_type || 'http-post');
    await db.prepare(
      `UPDATE mcp_servers SET name=?, url=?, api_key=?, description=?, is_active=?, response_mode=?, transport_type=?, command=?, args_json=?, env_json=?, updated_at=SYSTIMESTAMP WHERE id=?`
    ).run(
      finalName,
      url !== undefined ? (url || null) : server.url,
      api_key !== undefined ? (api_key || null) : server.api_key,
      finalDesc,
      is_active !== undefined ? (is_active ? 1 : 0) : server.is_active,
      response_mode !== undefined ? (response_mode || 'inject') : (server.response_mode || 'inject'),
      finalTt,
      command !== undefined ? (command || null) : server.command,
      args_json !== undefined ? (args_json || null) : server.args_json,
      env_json !== undefined ? (env_json || null) : server.env_json,
      req.params.id,
    );

    if (name_zh !== undefined) {
      await db.prepare(`UPDATE mcp_servers SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
        .run(name_zh || null, name_en || null, name_vi || null, desc_zh || null, desc_en || null, desc_vi || null, req.params.id);
    } else {
      const nameChanged = name !== undefined && name !== server.name;
      const descChanged = description !== undefined && description !== server.description;
      if (nameChanged || descChanged) {
        const trans = await translateFields({
          name: nameChanged ? finalName : null,
          description: descChanged ? finalDesc : null,
        }).catch(() => ({}));
        const setClauses = []; const params = [];
        if (nameChanged && trans.name_zh !== undefined) { setClauses.push('name_zh=?,name_en=?,name_vi=?'); params.push(trans.name_zh, trans.name_en, trans.name_vi); }
        if (descChanged && trans.desc_zh !== undefined) { setClauses.push('desc_zh=?,desc_en=?,desc_vi=?'); params.push(trans.desc_zh, trans.desc_en, trans.desc_vi); }
        if (setClauses.length) await db.prepare(`UPDATE mcp_servers SET ${setClauses.join(',')} WHERE id=?`).run(...params, req.params.id);
      }
    }

    res.json(await db.prepare(`SELECT * FROM mcp_servers WHERE id=?`).get(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/mcp-servers/:id
router.delete('/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const server = await db.prepare(`SELECT * FROM mcp_servers WHERE id=?`).get(req.params.id);
    if (!server) return res.status(404).json({ error: '找不到 MCP 伺服器' });
    await db.prepare(`DELETE FROM mcp_servers WHERE id=?`).run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/mcp-servers/:id/toggle
router.post('/:id/toggle', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const server = await db.prepare(`SELECT * FROM mcp_servers WHERE id=?`).get(req.params.id);
    if (!server) return res.status(404).json({ error: '找不到 MCP 伺服器' });

    const newActive = server.is_active ? 0 : 1;
    await db.prepare(`UPDATE mcp_servers SET is_active=?, updated_at=SYSTIMESTAMP WHERE id=?`)
      .run(newActive, req.params.id);

    res.json({ is_active: newActive });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/mcp-servers/:id/sync  — refresh tool list from MCP server
router.post('/:id/sync', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const server = await db.prepare(`SELECT * FROM mcp_servers WHERE id=?`).get(req.params.id);
    if (!server) return res.status(404).json({ error: '找不到 MCP 伺服器' });

    const tools = await mcpClient.listTools(db, server);
    res.json({ tool_count: tools.length, tools });
  } catch (e) {
    res.status(500).json({ error: `同步失敗：${e.message}` });
  }
});

// GET /api/mcp-servers/:id/logs
router.get('/:id/logs', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const server = await db.prepare(`SELECT id FROM mcp_servers WHERE id=?`).get(req.params.id);
    if (!server) return res.status(404).json({ error: '找不到 MCP 伺服器' });

    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    const logs = await db.prepare(
      `SELECT l.*, u.name as user_name FROM mcp_call_logs l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE l.server_id=? ORDER BY l.called_at DESC LIMIT ?`
    ).all(req.params.id, limit);
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mcp-servers/my  — 依 mcp_access 回傳當前使用者可用的 MCP
router.get('/my', async (req, res) => {
  const db = getDb();
  try {
    if (req.user.role === 'admin') {
      const servers = await db.prepare(
        `SELECT id, name, description, is_active FROM mcp_servers WHERE is_active=1 ORDER BY created_at DESC`
      ).all();
      return res.json(servers);
    }
    const u = await db.prepare(
      `SELECT role_id, dept_code, profit_center, org_section, org_group_name FROM users WHERE id=?`
    ).get(req.user.id);
    if (!u) return res.json([]);
    const accessibleIds = await db.prepare(
      `SELECT DISTINCT a.mcp_server_id
       FROM mcp_access a
       JOIN mcp_servers m ON m.id = a.mcp_server_id
       WHERE m.is_active=1 AND (
         (a.grantee_type='user'        AND a.grantee_id=?)
         OR (a.grantee_type='role'        AND a.grantee_id=? AND ? IS NOT NULL)
         OR (a.grantee_type='department'  AND a.grantee_id=? AND ? IS NOT NULL)
         OR (a.grantee_type='cost_center' AND a.grantee_id=? AND ? IS NOT NULL)
         OR (a.grantee_type='division'    AND a.grantee_id=? AND ? IS NOT NULL)
         OR (a.grantee_type='org_group'   AND a.grantee_id=? AND ? IS NOT NULL)
       )`
    ).all(
      String(req.user.id),
      u.role_id != null ? String(u.role_id) : null, u.role_id,
      u.dept_code, u.dept_code,
      u.profit_center, u.profit_center,
      u.org_section, u.org_section,
      u.org_group_name, u.org_group_name
    );
    if (!accessibleIds.length) return res.json([]);
    const ids = accessibleIds.map(r => r.mcp_server_id);
    const placeholders = ids.map(() => '?').join(',');
    const servers = await db.prepare(
      `SELECT id, name, DBMS_LOB.SUBSTR(description, 2000, 1) AS description, is_active
       FROM mcp_servers WHERE id IN (${placeholders}) AND is_active=1 ORDER BY id DESC`
    ).all(...ids);
    res.json(servers);
  } catch (e) {
    console.error('[MCP/my ERROR]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mcp-servers/:id/access  — 列出共享清單（admin only）
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
       FROM mcp_access a LEFT JOIN users u ON u.id = a.granted_by
       WHERE a.mcp_server_id=? ORDER BY a.granted_at DESC`
    ).all(req.params.id);
    res.json(grants);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/mcp-servers/:id/access  — 新增共享，回傳完整清單
router.post('/:id/access', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const { grantee_type, grantee_id, share_type = 'use' } = req.body;
    const validTypes = ['user', 'role', 'department', 'cost_center', 'division', 'org_group'];
    if (!validTypes.includes(grantee_type) || !grantee_id) {
      return res.status(400).json({ error: '請選擇有效的共享對象' });
    }
    // upsert: 若已存在則更新 share_type
    const existing = await db.prepare(
      `SELECT id FROM mcp_access WHERE mcp_server_id=? AND grantee_type=? AND grantee_id=?`
    ).get(req.params.id, grantee_type, String(grantee_id));
    if (existing) {
      await db.prepare(`UPDATE mcp_access SET share_type=? WHERE id=?`).run(share_type, existing.id);
    } else {
      await db.prepare(
        `INSERT INTO mcp_access (mcp_server_id, grantee_type, grantee_id, share_type, granted_by) VALUES (?,?,?,?,?)`
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
       FROM mcp_access a LEFT JOIN users u ON u.id = a.granted_by
       WHERE a.mcp_server_id=? ORDER BY a.granted_at DESC`
    ).all(req.params.id);
    res.json(grants);
  } catch (e) {
    console.error('[MCP access POST error]', e.message, e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/mcp-servers/:id/access/:grantId
router.delete('/:id/access/:grantId', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    await db.prepare(`DELETE FROM mcp_access WHERE id=? AND mcp_server_id=?`).run(req.params.grantId, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mcp-servers/active-servers  — sidebar display (name + description only)
router.get('/active-servers', async (req, res) => {
  const db = getDb();
  try {
    const servers = await db.prepare(
      `SELECT name, description FROM mcp_servers WHERE is_active=1 ORDER BY created_at DESC`
    ).all();
    res.json(servers);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mcp-servers/active-tools  — used by chat route
router.get('/active-tools', async (req, res) => {
  const db = getDb();
  try {
    const { functionDeclarations, serverMap } = mcpClient.getActiveToolDeclarations(db);
    res.json({ count: functionDeclarations.length, tools: functionDeclarations.map(t => ({ name: t.name, description: t.description })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/mcp-servers/:id/translate — 重新翻譯
router.post('/:id/translate', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  try {
    const server = await db.prepare(`SELECT * FROM mcp_servers WHERE id=?`).get(req.params.id);
    if (!server) return res.status(404).json({ error: '找不到 MCP 伺服器' });
    const trans = await translateFields({ name: server.name, description: server.description });
    await db.prepare(`UPDATE mcp_servers SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
      .run(trans.name_zh, trans.name_en, trans.name_vi, trans.desc_zh, trans.desc_en, trans.desc_vi, req.params.id);
    res.json(trans);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
