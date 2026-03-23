const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();
const { verifyToken } = require('./auth');
const { translateFields } = require('../services/translationService');

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

    console.log(`[TTS/synthesize] from=${req.ip} user_id=${user_id || req.user?.id} chars=${text?.length ?? 0} voice=${voice_name || '(default)'} speed=${speaking_rate} preview="${(text || '').slice(0, 50)}"`);

    if (!text?.trim()) return res.status(400).json({ error: '請提供 text' });

    const model = await db.prepare(
      `SELECT api_model, api_key_enc FROM llm_models WHERE model_role='tts' AND is_active=1 ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
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

    const ttsBody = await ttsRes.json();
    const { audioContent } = ttsBody;

    if (!audioContent) {
      console.error(`[TTS/synthesize] Google TTS returned ok but audioContent is empty. body keys=${Object.keys(ttsBody).join(',')}`);
      return res.status(502).json({ error: `Google TTS 回傳空音訊（audioContent 為空），請確認 API Key 配額或語音名稱是否正確` });
    }

    // 存成實體 MP3，回傳 URL（避免 base64 過長造成前端渲染問題）
    const UPLOAD_DIR = process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(__dirname, '../uploads');
    const genDir = path.join(UPLOAD_DIR, 'generated');
    if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
    const fname = `tts_${Date.now()}.mp3`;
    const mp3Buf = Buffer.from(audioContent, 'base64');
    fs.writeFileSync(path.join(genDir, fname), mp3Buf);
    console.log(`[TTS/synthesize] saved ${fname} size=${mp3Buf.length}bytes`);

    // 記錄用量：Google TTS 按字元計費，input_tokens = 字元數
    const charCount = text.trim().length;
    const effectiveUserId = user_id || req.user?.id;
    if (effectiveUserId && charCount > 0) {
      const { upsertTokenUsage } = require('../services/tokenService');
      const today      = new Date().toISOString().slice(0, 10);
      const ttsModel   = await db.prepare(
        `SELECT key FROM llm_models WHERE model_role='tts' AND is_active=1 ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
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

// ── Helper: check if user can access skill (owner / admin / public / shared) ──
async function canUserAccessSkill(db, skillId, user) {
    const skill = await db.prepare('SELECT owner_user_id, is_public, is_admin_approved FROM skills WHERE id=?').get(skillId);
    if (!skill) return false;
    if (skill.owner_user_id === user.id) return true;
    if (user.role === 'admin') return true;
    if (skill.is_public === 1) return true;  // public = accessible to all
    const access = await db.prepare(`
        SELECT 1 FROM skill_access sa WHERE sa.skill_id=? AND (
            (sa.grantee_type='user' AND sa.grantee_id=TO_CHAR(?))
            OR (sa.grantee_type='role' AND sa.grantee_id=?)
            OR (sa.grantee_type='dept' AND sa.grantee_id=? AND ? IS NOT NULL)
            OR (sa.grantee_type='profit_center' AND sa.grantee_id=? AND ? IS NOT NULL)
            OR (sa.grantee_type='org_section' AND sa.grantee_id=? AND ? IS NOT NULL)
            OR (sa.grantee_type='org_group' AND sa.grantee_id=? AND ? IS NOT NULL)
        )
    `).get(
        skillId,
        user.id, user.role,
        user.dept_code, user.dept_code,
        user.profit_center, user.profit_center,
        user.org_section, user.org_section,
        user.org_group_name, user.org_group_name
    );
    return !!access;
}

// ── GET /api/skills — 我的 + public approved + shared ────────────────────────
router.get('/', async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        const { tag, type, q } = req.query;
        const userProfile = await db.prepare(
            'SELECT id, role, dept_code, profit_center, org_section, org_group_name FROM users WHERE id=?'
        ).get(req.user.id);
        if (!userProfile) return res.status(403).json({ error: '使用者不存在' });

        let sql = `
      SELECT s.*, u.name AS owner_name
      FROM skills s LEFT JOIN users u ON u.id = s.owner_user_id
      WHERE (
        s.owner_user_id = ?
        OR s.is_public = 1
        OR EXISTS (
          SELECT 1 FROM skill_access sa WHERE sa.skill_id=s.id AND (
            (sa.grantee_type='user' AND sa.grantee_id=TO_CHAR(?))
            OR (sa.grantee_type='role' AND sa.grantee_id=?)
            OR (sa.grantee_type='dept' AND sa.grantee_id=? AND ? IS NOT NULL)
            OR (sa.grantee_type='profit_center' AND sa.grantee_id=? AND ? IS NOT NULL)
            OR (sa.grantee_type='org_section' AND sa.grantee_id=? AND ? IS NOT NULL)
            OR (sa.grantee_type='org_group' AND sa.grantee_id=? AND ? IS NOT NULL)
          )
        )
      )
    `;
        const params = [
            req.user.id,
            req.user.id, userProfile.role,
            userProfile.dept_code, userProfile.dept_code,
            userProfile.profit_center, userProfile.profit_center,
            userProfile.org_section, userProfile.org_section,
            userProfile.org_group_name, userProfile.org_group_name,
        ];
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
        const { name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi } = req.body;
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
        const newId = result.lastInsertRowid;
        // Auto-translate (or use manually provided translations)
        const trans = (name_zh !== undefined)
          ? { name_zh: name_zh || null, name_en: name_en || null, name_vi: name_vi || null, desc_zh: desc_zh || null, desc_en: desc_en || null, desc_vi: desc_vi || null }
          : await translateFields({ name, description }).catch(() => ({ name_zh: null, name_en: null, name_vi: null, desc_zh: null, desc_en: null, desc_vi: null }));
        if (trans.name_zh !== undefined) {
          await db.prepare(`UPDATE skills SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
            .run(trans.name_zh, trans.name_en, trans.name_vi, trans.desc_zh, trans.desc_en, trans.desc_vi, newId);
        }
        const skill = await db.prepare('SELECT * FROM skills WHERE id=?').get(newId);
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
        if (!isOwner && !isAdmin && !s.is_public) {
            const userProfile = await db.prepare(
                'SELECT id, role, dept_code, profit_center, org_section, org_group_name FROM users WHERE id=?'
            ).get(req.user.id);
            const hasAccess = userProfile && await canUserAccessSkill(db, req.params.id, userProfile);
            if (!hasAccess) return res.status(403).json({ error: '無存取權限' });
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
            code_snippet, code_packages,
            name_zh, name_en, name_vi, desc_zh, desc_en, desc_vi } = req.body;
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
        // Determine final name/desc for translation reference
        const finalName = name ?? s.name;
        const finalDesc = description ?? s.description;
        const updateResult = await db.prepare(`
      UPDATE skills SET name=?, description=?, icon=?, type=?, system_prompt=?,
        endpoint_url=?, endpoint_secret=?, endpoint_mode=?, model_key=?,
        mcp_tool_mode=?, mcp_tool_ids=?, dify_kb_ids=?, tags=?,
        code_snippet=?, code_packages=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
            finalName, finalDesc, icon ?? s.icon,
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
        // Update translations (use provided values or auto-translate if name/desc changed)
        const nameChanged = name !== undefined && name !== s.name;
        const descChanged = description !== undefined && description !== s.description;
        if (name_zh !== undefined) {
          // Manual translation values provided
          await db.prepare(`UPDATE skills SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
            .run(name_zh || null, name_en || null, name_vi || null, desc_zh || null, desc_en || null, desc_vi || null, req.params.id);
        } else if (nameChanged || descChanged) {
          // Auto-translate changed fields
          const trans = await translateFields({
            name: nameChanged ? finalName : null,
            description: descChanged ? finalDesc : null,
          }).catch(() => ({}));
          const setClauses = [];
          const params = [];
          if (nameChanged && trans.name_zh !== undefined) {
            setClauses.push('name_zh=?,name_en=?,name_vi=?');
            params.push(trans.name_zh, trans.name_en, trans.name_vi);
          }
          if (descChanged && trans.desc_zh !== undefined) {
            setClauses.push('desc_zh=?,desc_en=?,desc_vi=?');
            params.push(trans.desc_zh, trans.desc_en, trans.desc_vi);
          }
          if (setClauses.length) {
            await db.prepare(`UPDATE skills SET ${setClauses.join(',')} WHERE id=?`)
              .run(...params, req.params.id);
          }
        }
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

// ── GET /api/skills/:id/access ────────────────────────────────────────────────
router.get('/:id/access', async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        const s = await db.prepare('SELECT owner_user_id FROM skills WHERE id=?').get(req.params.id);
        if (!s) return res.status(404).json({ error: '找不到 skill' });
        if (s.owner_user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '只有建立者或管理員可查看共享設定' });
        }
        const grants = await db.prepare(`
            SELECT sa.*, u.name AS granted_by_name
            FROM skill_access sa
            LEFT JOIN users u ON u.id = sa.granted_by
            WHERE sa.skill_id = ?
            ORDER BY sa.granted_at DESC
        `).all(req.params.id);
        res.json(grants);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/skills/:id/access ───────────────────────────────────────────────
router.post('/:id/access', async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        const s = await db.prepare('SELECT owner_user_id FROM skills WHERE id=?').get(req.params.id);
        if (!s) return res.status(404).json({ error: '找不到 skill' });
        if (s.owner_user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '只有建立者或管理員可設定共享' });
        }
        const { grantee_type, grantee_id } = req.body;
        if (!grantee_type || !grantee_id) return res.status(400).json({ error: 'grantee_type 和 grantee_id 必填' });
        const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : require('crypto').randomUUID();
        await db.prepare(`
            INSERT INTO skill_access (id, skill_id, grantee_type, grantee_id, granted_by)
            VALUES (?, ?, ?, ?, ?)
        `).run(id, req.params.id, grantee_type, String(grantee_id), req.user.id);
        const grant = await db.prepare(`
            SELECT sa.*, u.name AS granted_by_name
            FROM skill_access sa LEFT JOIN users u ON u.id = sa.granted_by
            WHERE sa.id = ?
        `).get(id);
        res.json(grant);
    } catch (e) {
        if (e.message?.includes('UNIQUE') || e.message?.includes('unique') || e.errorNum === 1) {
            return res.status(409).json({ error: '此對象已有共享設定' });
        }
        res.status(500).json({ error: e.message });
    }
});

// ── DELETE /api/skills/:id/access/:grantId ────────────────────────────────────
router.delete('/:id/access/:grantId', async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        const s = await db.prepare('SELECT owner_user_id FROM skills WHERE id=?').get(req.params.id);
        if (!s) return res.status(404).json({ error: '找不到 skill' });
        if (s.owner_user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '只有建立者或管理員可移除共享' });
        }
        await db.prepare('DELETE FROM skill_access WHERE id=? AND skill_id=?').run(req.params.grantId, req.params.id);
        res.json({ success: true });
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

// GET /api/skills/:id/call-logs — 技能呼叫歷史紀錄
router.get('/:id/call-logs', async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        const sk = await db.prepare('SELECT id, owner_user_id FROM skills WHERE id=?').get(req.params.id);
        if (!sk) return res.status(404).json({ error: '找不到技能' });
        // Only owner or admin can view
        if (req.user.role !== 'admin' && sk.owner_user_id !== req.user.id) {
            return res.status(403).json({ error: '無存取權限' });
        }
        const logs = await db.prepare(`
            SELECT l.id, l.user_id, l.session_id, l.query_preview, l.response_preview,
                   l.status, l.error_msg, l.duration_ms,
                   TO_CHAR(l.called_at, 'YYYY-MM-DD HH24:MI:SS') AS called_at,
                   u.name AS user_name
            FROM skill_call_logs l
            LEFT JOIN users u ON u.id = l.user_id
            WHERE l.skill_id = ?
            ORDER BY l.called_at DESC
            FETCH FIRST 100 ROWS ONLY
        `).all(req.params.id);
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/skills/:id/translate — 重新翻譯 ─────────────────────────────────
router.post('/:id/translate', async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        const s = await db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
        if (!s) return res.status(404).json({ error: '找不到 skill' });
        if (s.owner_user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '無操作權限' });
        }
        const trans = await translateFields({ name: s.name, description: s.description });
        await db.prepare(`UPDATE skills SET name_zh=?,name_en=?,name_vi=?,desc_zh=?,desc_en=?,desc_vi=? WHERE id=?`)
            .run(trans.name_zh, trans.name_en, trans.name_vi, trans.desc_zh, trans.desc_en, trans.desc_vi, req.params.id);
        res.json(trans);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
