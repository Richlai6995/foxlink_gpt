const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth');

router.use(verifyToken);

// ── Helper: resolve effective skill permission for user ──────────────────────
function hasSkillPerm(db, userId, field) {
    const row = db.prepare(
        `SELECT u.${field} AS u_perm, r.${field} AS r_perm
     FROM users u LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = ?`
    ).get(userId);
    if (!row) return false;
    const val = row.u_perm ?? row.r_perm ?? 0;
    return val === 1;
}

function parseJsonField(val, fallback = []) {
    try { return JSON.parse(val) || fallback; } catch { return fallback; }
}

function serializeSkill(s, maskSecret = true) {
    return {
        ...s,
        mcp_tool_ids: parseJsonField(s.mcp_tool_ids),
        dify_kb_ids: parseJsonField(s.dify_kb_ids),
        tags: parseJsonField(s.tags),
        endpoint_secret: maskSecret ? (s.endpoint_secret ? '****' : '') : s.endpoint_secret,
    };
}

// ── GET /api/skills — 我的 + public approved ─────────────────────────────────
router.get('/', (req, res) => {
    try {
        const db = require('../database').db;
        const { tag, type, q } = req.query;
        let sql = `
      SELECT s.*, u.name AS owner_name
      FROM skills s LEFT JOIN users u ON u.id = s.owner_user_id
      WHERE (s.owner_user_id = ? OR (s.is_public = 1 AND s.is_admin_approved = 1))
    `;
        const params = [req.user.id];
        if (type) { sql += ` AND s.type = ?`; params.push(type); }
        sql += ` ORDER BY s.is_admin_approved DESC, s.created_at DESC`;
        let rows = db.prepare(sql).all(...params);
        if (tag) rows = rows.filter(s => parseJsonField(s.tags).includes(tag));
        if (q) rows = rows.filter(s => s.name.includes(q) || (s.description || '').includes(q));
        res.json(rows.map(s => serializeSkill(s)));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/skills — 建立 ───────────────────────────────────────────────────
router.post('/', (req, res) => {
    try {
        const db = require('../database').db;
        if (!hasSkillPerm(db, req.user.id, 'allow_create_skill') && req.user.role !== 'admin') {
            return res.status(403).json({ error: '無建立 Skill 的權限，請聯絡管理員' });
        }
        const { name, description, icon, type, system_prompt, endpoint_url, endpoint_secret,
            endpoint_mode, model_key, mcp_tool_mode, mcp_tool_ids, dify_kb_ids, tags } = req.body;
        if (!name) return res.status(400).json({ error: 'name 必填' });
        if (type === 'external' && !hasSkillPerm(db, req.user.id, 'allow_external_skill') && req.user.role !== 'admin') {
            return res.status(403).json({ error: '無建立外部 Skill 的權限' });
        }
        const result = db.prepare(`
      INSERT INTO skills (name, description, icon, type, system_prompt, endpoint_url, endpoint_secret,
        endpoint_mode, model_key, mcp_tool_mode, mcp_tool_ids, dify_kb_ids, tags, owner_user_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
            name, description || null, icon || '🤖',
            type || 'builtin', system_prompt || null,
            endpoint_url || null, endpoint_secret || null,
            endpoint_mode || 'inject', model_key || null,
            mcp_tool_mode || 'append',
            JSON.stringify(mcp_tool_ids || []),
            JSON.stringify(dify_kb_ids || []),
            JSON.stringify(tags || []),
            req.user.id
        );
        const skill = db.prepare('SELECT * FROM skills WHERE id=?').get(result.lastInsertRowid);
        res.json(serializeSkill(skill, false));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── GET /api/skills/:id ───────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
    try {
        const db = require('../database').db;
        const s = db.prepare('SELECT s.*, u.name AS owner_name FROM skills s LEFT JOIN users u ON u.id=s.owner_user_id WHERE s.id=?').get(req.params.id);
        if (!s) return res.status(404).json({ error: '找不到 skill' });
        const isOwner = s.owner_user_id === req.user.id;
        const isAdmin = req.user.role === 'admin';
        if (!isOwner && !isAdmin && !(s.is_public && s.is_admin_approved)) {
            return res.status(403).json({ error: '無存取權限' });
        }
        res.json(serializeSkill(s, !isOwner && !isAdmin));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── PUT /api/skills/:id — 編輯 ────────────────────────────────────────────────
router.put('/:id', (req, res) => {
    try {
        const db = require('../database').db;
        const s = db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
        if (!s) return res.status(404).json({ error: '找不到 skill' });
        if (s.owner_user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '只有建立者或管理員可以編輯' });
        }
        const { name, description, icon, type, system_prompt, endpoint_url, endpoint_secret,
            endpoint_mode, model_key, mcp_tool_mode, mcp_tool_ids, dify_kb_ids, tags } = req.body;
        if (type === 'external' && !hasSkillPerm(db, req.user.id, 'allow_external_skill') && req.user.role !== 'admin') {
            return res.status(403).json({ error: '無建立外部 Skill 的權限' });
        }
        // Keep old secret if masked value passed
        const newSecret = (endpoint_secret && endpoint_secret !== '****') ? endpoint_secret : s.endpoint_secret;
        db.prepare(`
      UPDATE skills SET name=?, description=?, icon=?, type=?, system_prompt=?,
        endpoint_url=?, endpoint_secret=?, endpoint_mode=?, model_key=?,
        mcp_tool_mode=?, mcp_tool_ids=?, dify_kb_ids=?, tags=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
            name ?? s.name, description ?? s.description, icon ?? s.icon,
            type ?? s.type, system_prompt ?? s.system_prompt,
            endpoint_url ?? s.endpoint_url, newSecret,
            endpoint_mode ?? s.endpoint_mode, model_key ?? s.model_key,
            mcp_tool_mode ?? s.mcp_tool_mode,
            JSON.stringify(mcp_tool_ids ?? parseJsonField(s.mcp_tool_ids)),
            JSON.stringify(dify_kb_ids ?? parseJsonField(s.dify_kb_ids)),
            JSON.stringify(tags ?? parseJsonField(s.tags)),
            req.params.id
        );
        const updated = db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
        res.json(serializeSkill(updated, req.user.role !== 'admin' && updated.owner_user_id !== req.user.id));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── DELETE /api/skills/:id ────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
    try {
        const db = require('../database').db;
        const s = db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
        if (!s) return res.status(404).json({ error: '找不到 skill' });
        if (s.owner_user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '只有建立者或管理員可以刪除' });
        }
        db.prepare('DELETE FROM skills WHERE id=?').run(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/skills/:id/fork ─────────────────────────────────────────────────
router.post('/:id/fork', (req, res) => {
    try {
        const db = require('../database').db;
        if (!hasSkillPerm(db, req.user.id, 'allow_create_skill') && req.user.role !== 'admin') {
            return res.status(403).json({ error: '無建立 Skill 的權限' });
        }
        const s = db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
        if (!s) return res.status(404).json({ error: '找不到 skill' });
        if (!s.is_public && s.owner_user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '無法 fork 此 skill' });
        }
        const result = db.prepare(`
      INSERT INTO skills (name, description, icon, type, system_prompt, endpoint_url, endpoint_secret,
        endpoint_mode, model_key, mcp_tool_mode, mcp_tool_ids, dify_kb_ids, tags, owner_user_id,
        is_public, is_admin_approved, pending_approval)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0)
    `).run(
            `${s.name} (複本)`, s.description, s.icon, s.type, s.system_prompt,
            s.endpoint_url, s.endpoint_secret, s.endpoint_mode, s.model_key,
            s.mcp_tool_mode, s.mcp_tool_ids, s.dify_kb_ids, s.tags, req.user.id
        );
        const forked = db.prepare('SELECT * FROM skills WHERE id=?').get(result.lastInsertRowid);
        res.json(serializeSkill(forked, false));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/skills/:id/request-public ──────────────────────────────────────
router.post('/:id/request-public', (req, res) => {
    try {
        const db = require('../database').db;
        const s = db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
        if (!s) return res.status(404).json({ error: '找不到 skill' });
        if (s.owner_user_id !== req.user.id) return res.status(403).json({ error: '只有建立者可申請公開' });
        db.prepare('UPDATE skills SET pending_approval=1, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.params.id);
        res.json({ success: true, message: '已送出公開申請，等待管理員審核' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
