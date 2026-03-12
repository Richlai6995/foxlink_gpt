const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();
const { verifyToken } = require('./auth');

// ── Service key middleware（供外部 skill handler 呼叫，不走 user token）──────
function verifyServiceKey(req, res, next) {
  const serviceKey = process.env.SKILL_SERVICE_KEY;
  const provided   = req.headers['x-service-key'] || req.query.service_key;
  if (serviceKey && provided === serviceKey) return next();
  verifyToken(req, res, next);
}

// TTS endpoint 用 service key 或 user token 皆可
router.post('/tts/synthesize', verifyServiceKey, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { decryptKey } = require('../services/llmKeyService');
    const { text, voice_name, speaking_rate = 1.0, pitch = 0.0, user_id } = req.body;

    if (!text?.trim()) return res.status(400).json({ error: '請提供 text' });

    const model = await db.prepare(
      `SELECT api_model, api_key_enc FROM llm_models WHERE model_role='tts' AND is_active=1 ORDER BY sort_order LIMIT 1`
    ).get();
    if (!model) return res.status(404).json({ error: '尚未設定 TTS 模型，請至管理後台新增 model_role=tts 的模型' });

    const apiKey = model.api_key_enc ? decryptKey(model.api_key_enc) : null;
    if (!apiKey) return res.status(500).json({ error: 'TTS API Key 未設定' });

    const selectedVoice = voice_name?.trim() || model.api_model || 'cmn-TW-Wavenet-A';
    const langCode = selectedVoice.split('-').slice(0, 2).join('-');

    const ttsRes = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: text.trim() },
          voice: { languageCode: langCode, name: selectedVoice },
          audioConfig: { audioEncoding: 'MP3', speakingRate: speaking_rate, pitch },
        }),
      }
    );
    if (!ttsRes.ok) {
      const err = await ttsRes.json();
      return res.status(ttsRes.status).json({ error: err.error?.message || `TTS API 錯誤 ${ttsRes.status}` });
    }

    const { audioContent } = await ttsRes.json();

    // 存成實體 MP3，回傳 URL（避免 base64 過長造成前端渲染問題）
    const UPLOAD_DIR = process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(__dirname, '../uploads');
    const genDir = path.join(UPLOAD_DIR, 'generated');
    if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
    const fname = `tts_${Date.now()}.mp3`;
    fs.writeFileSync(path.join(genDir, fname), Buffer.from(audioContent, 'base64'));

    // 記錄用量：Google TTS 按字元計費，input_tokens = 字元數
    const charCount = text.trim().length;
    const effectiveUserId = user_id || req.user?.id;
    if (effectiveUserId && charCount > 0) {
      const { upsertTokenUsage } = require('../services/tokenService');
      const today      = new Date().toISOString().slice(0, 10);
      const ttsModel   = await db.prepare(
        `SELECT key FROM llm_models WHERE model_role='tts' AND is_active=1 ORDER BY sort_order LIMIT 1`
      ).get();
      const modelKey = ttsModel?.key || 'google-tts';
      await upsertTokenUsage(db, effectiveUserId, today, modelKey, charCount, 0, 0);
    }

    res.json({
      audio_url:  `/uploads/generated/${fname}`,
      voice_used: selectedVoice,
      language:   langCode,
      char_count: charCount,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.use(verifyToken);

// ── Helper: resolve effective skill permission for user ──────────────────────
async function hasSkillPerm(db, userId, field) {
    const row = await db.prepare(
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
        code_packages: parseJsonField(s.code_packages),
        endpoint_secret: maskSecret ? (s.endpoint_secret ? '****' : '') : s.endpoint_secret,
    };
}

// ── GET /api/skills — 我的 + public approved ─────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        const { tag, type, q } = req.query;
        let sql = `
      SELECT s.*, u.name AS owner_name
      FROM skills s LEFT JOIN users u ON u.id = s.owner_user_id
      WHERE (s.owner_user_id = ? OR (s.is_public = 1 AND s.is_admin_approved = 1))
    `;
        const params = [req.user.id];
        if (type) { sql += ` AND s.type = ?`; params.push(type); }
        sql += ` ORDER BY s.is_admin_approved DESC, s.created_at DESC`;
        let rows = await db.prepare(sql).all(...params);
        if (tag) rows = rows.filter(s => parseJsonField(s.tags).includes(tag));
        if (q) rows = rows.filter(s => s.name.includes(q) || (s.description || '').includes(q));
        res.json(rows.map(s => serializeSkill(s)));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/skills — 建立 ───────────────────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        if (!await hasSkillPerm(db, req.user.id, 'allow_create_skill') && req.user.role !== 'admin') {
            return res.status(403).json({ error: '無建立 Skill 的權限，請聯絡管理員' });
        }
        const { name, description, icon, type, system_prompt, endpoint_url, endpoint_secret,
            endpoint_mode, model_key, mcp_tool_mode, mcp_tool_ids, dify_kb_ids, tags,
            code_snippet, code_packages } = req.body;
        if (!name) return res.status(400).json({ error: 'name 必填' });
        if (type === 'external' && !await hasSkillPerm(db, req.user.id, 'allow_external_skill') && req.user.role !== 'admin') {
            return res.status(403).json({ error: '無建立外部 Skill 的權限' });
        }
        if (type === 'code' && !await hasSkillPerm(db, req.user.id, 'allow_code_skill') && req.user.role !== 'admin') {
            return res.status(403).json({ error: '無建立內部程式 Skill 的權限' });
        }
        const result = await db.prepare(`
      INSERT INTO skills (name, description, icon, type, system_prompt, endpoint_url, endpoint_secret,
        endpoint_mode, model_key, mcp_tool_mode, mcp_tool_ids, dify_kb_ids, tags, owner_user_id,
        code_snippet, code_packages)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
            name, description || null, icon || '🤖',
            type || 'builtin', system_prompt || null,
            endpoint_url || null, endpoint_secret || null,
            endpoint_mode || 'inject', model_key || null,
            mcp_tool_mode || 'append',
            JSON.stringify(mcp_tool_ids || []),
            JSON.stringify(dify_kb_ids || []),
            JSON.stringify(tags || []),
            req.user.id,
            code_snippet || null,
            JSON.stringify(code_packages || [])
        );
        const skill = await db.prepare('SELECT * FROM skills WHERE id=?').get(result.lastInsertRowid);
        res.json(serializeSkill(skill, false));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── GET /api/skills/:id ───────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        const s = await db.prepare('SELECT s.*, u.name AS owner_name FROM skills s LEFT JOIN users u ON u.id=s.owner_user_id WHERE s.id=?').get(req.params.id);
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
router.put('/:id', async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        const s = await db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
        if (!s) return res.status(404).json({ error: '找不到 skill' });
        if (s.owner_user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '只有建立者或管理員可以編輯' });
        }
        const { name, description, icon, type, system_prompt, endpoint_url, endpoint_secret,
            endpoint_mode, model_key, mcp_tool_mode, mcp_tool_ids, dify_kb_ids, tags,
            code_snippet, code_packages } = req.body;
        if (type === 'external' && !await hasSkillPerm(db, req.user.id, 'allow_external_skill') && req.user.role !== 'admin') {
            return res.status(403).json({ error: '無建立外部 Skill 的權限' });
        }
        if (type === 'code' && !await hasSkillPerm(db, req.user.id, 'allow_code_skill') && req.user.role !== 'admin') {
            return res.status(403).json({ error: '無建立內部程式 Skill 的權限' });
        }
        // Keep old secret if masked value passed
        const newSecret = (endpoint_secret && endpoint_secret !== '****') ? endpoint_secret : s.endpoint_secret;
        const tagsJson = JSON.stringify(tags ?? parseJsonField(s.tags));
        console.log(`[Skill PUT] id=${req.params.id} tags_received=${JSON.stringify(tags)} tags_json=${tagsJson}`);
        const updateResult = await db.prepare(`
      UPDATE skills SET name=?, description=?, icon=?, type=?, system_prompt=?,
        endpoint_url=?, endpoint_secret=?, endpoint_mode=?, model_key=?,
        mcp_tool_mode=?, mcp_tool_ids=?, dify_kb_ids=?, tags=?,
        code_snippet=?, code_packages=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
            name ?? s.name, description ?? s.description, icon ?? s.icon,
            type ?? s.type, system_prompt ?? s.system_prompt,
            endpoint_url ?? s.endpoint_url, newSecret,
            endpoint_mode ?? s.endpoint_mode, model_key ?? s.model_key,
            mcp_tool_mode ?? s.mcp_tool_mode,
            JSON.stringify(mcp_tool_ids ?? parseJsonField(s.mcp_tool_ids)),
            JSON.stringify(dify_kb_ids ?? parseJsonField(s.dify_kb_ids)),
            tagsJson,
            code_snippet !== undefined ? (code_snippet || null) : s.code_snippet,
            JSON.stringify(code_packages ?? parseJsonField(s.code_packages)),
            req.params.id
        );
        console.log(`[Skill PUT] UPDATE rowsAffected=${updateResult?.changes}`);
        const updated = await db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
        console.log(`[Skill PUT] SELECT after update: tags=${updated?.tags}`);
        res.json(serializeSkill(updated, req.user.role !== 'admin' && updated.owner_user_id !== req.user.id));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── DELETE /api/skills/:id ────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        const s = await db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
        if (!s) return res.status(404).json({ error: '找不到 skill' });
        if (s.owner_user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '只有建立者或管理員可以刪除' });
        }
        await db.prepare('DELETE FROM skills WHERE id=?').run(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/skills/:id/fork ─────────────────────────────────────────────────
router.post('/:id/fork', async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        if (!await hasSkillPerm(db, req.user.id, 'allow_create_skill') && req.user.role !== 'admin') {
            return res.status(403).json({ error: '無建立 Skill 的權限' });
        }
        const s = await db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
        if (!s) return res.status(404).json({ error: '找不到 skill' });
        if (!s.is_public && s.owner_user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '無法 fork 此 skill' });
        }
        const result = await db.prepare(`
      INSERT INTO skills (name, description, icon, type, system_prompt, endpoint_url, endpoint_secret,
        endpoint_mode, model_key, mcp_tool_mode, mcp_tool_ids, dify_kb_ids, tags, owner_user_id,
        is_public, is_admin_approved, pending_approval)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0)
    `).run(
            `${s.name} (複本)`, s.description, s.icon, s.type, s.system_prompt,
            s.endpoint_url, s.endpoint_secret, s.endpoint_mode, s.model_key,
            s.mcp_tool_mode, s.mcp_tool_ids, s.dify_kb_ids, s.tags, req.user.id
        );
        const forked = await db.prepare('SELECT * FROM skills WHERE id=?').get(result.lastInsertRowid);
        res.json(serializeSkill(forked, false));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/skills/:id/request-public ──────────────────────────────────────
router.post('/:id/request-public', async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        const s = await db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
        if (!s) return res.status(404).json({ error: '找不到 skill' });
        if (s.owner_user_id !== req.user.id) return res.status(403).json({ error: '只有建立者可申請公開' });
        await db.prepare('UPDATE skills SET pending_approval=1, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.params.id);
        res.json({ success: true, message: '已送出公開申請，等待管理員審核' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
