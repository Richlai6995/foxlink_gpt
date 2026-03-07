'use strict';
/**
 * API Key Management  /api/api-keys
 * Admin-only CRUD for external KB API keys
 *
 * DB schema uses: id VARCHAR2(36) PK (UUID), accessible_kbs CLOB
 */
const express    = require('express');
const router     = express.Router();
const crypto     = require('crypto');
const { randomUUID } = crypto;
const { verifyToken, verifyAdmin } = require('./auth');

router.use(verifyToken);
router.use(verifyAdmin);

function getDb() {
  return require('../database-oracle').db;
}

function hashKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateKey() {
  return (process.env.API_KEY_PREFIX || 'fxlk_') + crypto.randomBytes(24).toString('hex');
}

// GET /api/api-keys
router.get('/', async (req, res) => {
  const db = getDb();
  try {
    const keys = await db.prepare(`
      SELECT k.id, k.name, k.key_prefix, k.description,
             k.accessible_kbs AS kb_ids,
             k.is_active, k.expires_at,
             TO_CHAR(k.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,
             TO_CHAR(k.last_used_at,'YYYY-MM-DD HH24:MI:SS') AS last_used_at,
             u.name AS created_by_name, u.username AS created_by_username
      FROM api_keys k
      LEFT JOIN users u ON u.id = k.created_by
      ORDER BY k.created_at DESC
    `).all();
    res.json(keys);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/api-keys  — create
router.post('/', async (req, res) => {
  const db = getDb();
  const { name, description = '', kb_ids = null, expires_at = null } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name 為必填' });
  try {
    const id     = randomUUID();
    const raw    = generateKey();
    const hash   = hashKey(raw);
    const prefix = raw.slice(0, 12);
    // null → ["*"] (all KBs); specific ids → JSON array
    const kbJson = kb_ids?.length ? JSON.stringify(kb_ids) : '["*"]';
    await db.prepare(`
      INSERT INTO api_keys (id, name, key_hash, key_prefix, created_by, accessible_kbs, description, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ${expires_at ? "TO_TIMESTAMP(?,'YYYY-MM-DD')" : 'NULL'})
    `).run(
      id, name.trim(), hash, prefix, req.user.id,
      kbJson, description || null,
      ...(expires_at ? [expires_at] : [])
    );
    res.status(201).json({ id, key: raw, prefix });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/api-keys/:id  — toggle active / update name/desc/kbs/expires
router.patch('/:id', async (req, res) => {
  const db = getDb();
  const { name, description, is_active, kb_ids, expires_at } = req.body;
  try {
    const sets   = [];
    const params = [];
    if (name        !== undefined) { sets.push('name=?');           params.push(name); }
    if (description !== undefined) { sets.push('description=?');    params.push(description || null); }
    if (is_active   !== undefined) { sets.push('is_active=?');      params.push(is_active ? 1 : 0); }
    if (kb_ids      !== undefined) { sets.push('accessible_kbs=?'); params.push(kb_ids?.length ? JSON.stringify(kb_ids) : '["*"]'); }
    if (expires_at  !== undefined) { sets.push('expires_at=?');     params.push(expires_at || null); }
    if (!sets.length) return res.status(400).json({ error: '無可更新欄位' });
    params.push(req.params.id);
    await db.prepare(`UPDATE api_keys SET ${sets.join(', ')} WHERE id=?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/api-keys/:id
router.delete('/:id', async (req, res) => {
  const db = getDb();
  try {
    await db.prepare('DELETE FROM api_keys WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
