'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');
const mcpClient = require('../services/mcpClient');

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
    const { name, url, api_key, description, is_active, response_mode } = req.body;
    if (!name || !url) return res.status(400).json({ error: '名稱和 URL 為必填' });

    const result = await db.prepare(
      `INSERT INTO mcp_servers (name, url, api_key, description, is_active, response_mode) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(name, url, api_key || null, description || null, is_active !== false ? 1 : 0, response_mode || 'inject');

    const server = await db.prepare(`SELECT * FROM mcp_servers WHERE id=?`).get(result.lastInsertRowid);
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

    const { name, url, api_key, description, is_active, response_mode } = req.body;
    await db.prepare(
      `UPDATE mcp_servers SET name=?, url=?, api_key=?, description=?, is_active=?, response_mode=?, updated_at=SYSTIMESTAMP WHERE id=?`
    ).run(
      name ?? server.name,
      url ?? server.url,
      api_key !== undefined ? (api_key || null) : server.api_key,
      description !== undefined ? (description || null) : server.description,
      is_active !== undefined ? (is_active ? 1 : 0) : server.is_active,
      response_mode !== undefined ? (response_mode || 'inject') : (server.response_mode || 'inject'),
      req.params.id,
    );

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

module.exports = router;
