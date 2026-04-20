const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();
const { verifyToken } = require('./auth');
const { translateFields } = require('../services/translationService');
const { resolveGranteeNamesInRows, getLangFromReq } = require('../services/granteeNameResolver');

// ── Service key middleware（供外部 skill handler 呼叫，不走 user token）──────
function verifyServiceKey(req, res, next) {
  const serviceKey = process.env.SKILL_SERVICE_KEY;
  const provided   = req.headers['x-service-key'] || req.query.service_key;
  if (serviceKey && provided === serviceKey) return next();
  verifyToken(req, res, next);
}

// ── Helper: split text at sentence/clause boundaries for Google TTS (max 5000 bytes per call) ──
function splitTextForTTS(text, maxBytes = 4800) {
  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (Buffer.byteLength(remaining, 'utf8') <= maxBytes) {
      chunks.push(remaining);
      break;
    }
    // Conservative estimate: assume 3 bytes/char, then refine
    let end = Math.min(remaining.length, Math.floor(maxBytes / 3));
    while (end > 100 && Buffer.byteLength(remaining.slice(0, end), 'utf8') > maxBytes) {
      end -= 50;
    }
    // Split at sentence boundary (。！？；\n) first
    let splitAt = -1;
    for (let i = end; i > end * 0.4; i--) {
      if (/[。！？；\n]/.test(remaining[i])) { splitAt = i + 1; break; }
    }
    // Fallback: split at comma/clause boundary
    if (splitAt === -1) {
      for (let i = end; i > end * 0.4; i--) {
        if (/[，、,：]/.test(remaining[i])) { splitAt = i + 1; break; }
      }
    }
    if (splitAt === -1) splitAt = end; // hard split
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  return chunks.filter(c => c.length > 0);
}

// TTS endpoint 用 service key 或 user token 皆可
// 支援長文本自動分段呼叫 Google TTS 再合併 MP3
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

    const inputText = text.trim();
    const inputBytes = Buffer.byteLength(inputText, 'utf8');

    // Split into chunks if text exceeds safe limit (Google TTS max = 5000 bytes)
    const chunks = inputBytes <= 4800 ? [inputText] : splitTextForTTS(inputText);
    console.log(`[TTS/synthesize] voice=${selectedVoice} lang=${langCode} totalBytes=${inputBytes} chunks=${chunks.length}`);

    const ttsUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
    const voiceCfg = { languageCode: langCode, name: selectedVoice };
    const audioCfg = { audioEncoding: 'MP3', speakingRate: Number(speaking_rate), pitch: Number(pitch) };
    const mp3Buffers = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkBytes = Buffer.byteLength(chunk, 'utf8');
      console.log(`[TTS/synthesize] chunk ${i + 1}/${chunks.length}: ${chunk.length} chars, ${chunkBytes} bytes`);

      const ttsRes = await fetch(ttsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { text: chunk }, voice: voiceCfg, audioConfig: audioCfg }),
        signal: AbortSignal.timeout(60000),
      });

      if (!ttsRes.ok) {
        const err = await ttsRes.json().catch(() => ({}));
        const errMsg = err?.error?.message || err?.error?.status || `TTS API 錯誤 ${ttsRes.status}`;
        console.error(`[TTS/synthesize] chunk ${i + 1} HTTP ${ttsRes.status}: ${errMsg}`);
        return res.status(ttsRes.status).json({ error: `chunk ${i + 1}/${chunks.length}: ${errMsg}` });
      }

      const ttsBody = await ttsRes.json();
      const { audioContent } = ttsBody;
      if (!audioContent) {
        const bodyKeys = Object.keys(ttsBody).join(',');
        console.error(`[TTS/synthesize] chunk ${i + 1} returned empty audioContent. bodyKeys=${bodyKeys} bodySnap=${JSON.stringify(ttsBody).slice(0, 300)}`);
        continue; // skip empty chunk, try remaining
      }
      // Diagnostic: log base64 length and first 20 chars
      console.log(`[TTS/synthesize] chunk ${i + 1} audioContent: base64.length=${audioContent.length} first20="${audioContent.slice(0, 20)}"`);
      const buf = Buffer.from(audioContent, 'base64');
      // Verify MP3 magic bytes (ID3 tag or MPEG sync word 0xFF)
      const magic = buf.length >= 3 ? `0x${buf[0].toString(16)} 0x${buf[1].toString(16)} 0x${buf[2].toString(16)}` : 'too-short';
      console.log(`[TTS/synthesize] chunk ${i + 1} decoded: ${buf.length} bytes, magic=${magic}`);
      mp3Buffers.push(buf);
    }

    if (mp3Buffers.length === 0) {
      console.error(`[TTS/synthesize] all chunks returned empty audioContent, voice=${selectedVoice}`);
      return res.status(502).json({ error: `Google TTS 回傳空音訊 voice=${selectedVoice}，請確認語音名稱是否有效或 API Key 是否有 Cloud TTS 權限` });
    }

    // Concatenate MP3 buffers (MP3 is frame-based, simple concat is valid)
    const mp3Buf = Buffer.concat(mp3Buffers);

    // 存成實體 MP3
    const UPLOAD_DIR = process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(__dirname, '../uploads');
    const genDir = path.join(UPLOAD_DIR, 'generated');
    if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
    const fname = `tts_${Date.now()}.mp3`;
    const fullPath = path.join(genDir, fname);
    fs.writeFileSync(fullPath, mp3Buf);

    // ── Diagnostic: verify file was written correctly ──
    const fileStat = fs.statSync(fullPath);
    const readBack = fs.readFileSync(fullPath);
    const readMagic = readBack.length >= 3 ? `0x${readBack[0].toString(16)} 0x${readBack[1].toString(16)} 0x${readBack[2].toString(16)}` : 'too-short';
    console.log(`[TTS/synthesize] saved ${fname} | bufSize=${mp3Buf.length} | diskSize=${fileStat.size} | diskMagic=${readMagic} | path=${fullPath} | UPLOAD_DIR=${UPLOAD_DIR}`);

    // 記錄用量：Google TTS 按字元計費，input_tokens = 字元數
    const charCount = inputText.length;
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
      audio_url:  `/api/skills/tts/audio/${fname}`,
      voice_used: selectedVoice,
      language:   langCode,
      char_count: charCount,
    });
  } catch (e) {
    console.error(`[TTS/synthesize] error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// ── TTS audio streaming endpoint ─────────────────────────────────────────────
// 不走 express.static，明確設定 Content-Type / Content-Length / Range
// 解決 K8s nginx ingress proxy-buffering:off 導致 <audio> 無法播放的問題
router.get('/tts/audio/:filename', (req, res) => {
  const UPLOAD_DIR = process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(__dirname, '../uploads');
  const safeName = path.basename(req.params.filename); // prevent traversal
  const filePath = path.join(UPLOAD_DIR, 'generated', safeName);

  if (!fs.existsSync(filePath)) {
    console.error(`[TTS/audio] 404 ${safeName} path=${filePath}`);
    return res.status(404).json({ error: 'File not found' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    // Range request (seeking / metadata preload)
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    console.log(`[TTS/audio] 206 ${safeName} range=${start}-${end}/${fileSize}`);
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'audio/mpeg',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    // Full file
    console.log(`[TTS/audio] 200 ${safeName} size=${fileSize}`);
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// ── TTS diagnostic endpoint: GET /api/skills/tts/diag/:filename ──────────────
// 用法: curl http://host/api/skills/tts/diag/tts_1774315482672.mp3
router.get('/tts/diag/:filename', verifyServiceKey, (req, res) => {
  const UPLOAD_DIR = process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(__dirname, '../uploads');
  const genDir = path.join(UPLOAD_DIR, 'generated');
  const fullPath = path.join(genDir, req.params.filename);

  const result = {
    UPLOAD_DIR,
    genDir,
    fullPath,
    genDirExists: fs.existsSync(genDir),
    fileExists: fs.existsSync(fullPath),
  };

  if (result.fileExists) {
    const stat = fs.statSync(fullPath);
    const buf = fs.readFileSync(fullPath);
    result.fileSize = stat.size;
    result.fileMtime = stat.mtime.toISOString();
    result.magic = buf.length >= 4
      ? `${buf[0].toString(16).padStart(2,'0')} ${buf[1].toString(16).padStart(2,'0')} ${buf[2].toString(16).padStart(2,'0')} ${buf[3].toString(16).padStart(2,'0')}`
      : 'too-short';
    result.isValidMp3 = (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) || (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33); // 0xFF 0xFB... or ID3
    // List other tts files for reference
    try {
      const files = fs.readdirSync(genDir).filter(f => f.startsWith('tts_')).slice(-5);
      result.recentTtsFiles = files.map(f => {
        const s = fs.statSync(path.join(genDir, f));
        return { name: f, size: s.size, mtime: s.mtime.toISOString() };
      });
    } catch (_) {}
  }

  // Also check static mount
  result.staticUploadUrl = `/uploads/generated/${req.params.filename}`;
  result.hint = result.fileExists && result.fileSize > 0 && result.isValidMp3
    ? 'File exists and looks like valid MP3. Issue might be static file serving (nginx/express.static path mismatch).'
    : result.fileExists && result.fileSize === 0
    ? 'File exists but is EMPTY (0 bytes). Google TTS returned empty audioContent.'
    : result.fileExists && !result.isValidMp3
    ? 'File exists but does NOT have MP3 magic bytes. Content might be corrupted or not MP3.'
    : 'File does NOT exist on disk. Check UPLOAD_DIR and genDir paths.';

  console.log(`[TTS/diag] ${req.params.filename}:`, JSON.stringify(result, null, 2));
  res.json(result);
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
        self_kb_ids: parseJsonField(s.self_kb_ids),
        tags: parseJsonField(s.tags),
        code_packages: parseJsonField(s.code_packages),
        tool_schema: parseJsonField(s.tool_schema, null),
        output_schema: parseJsonField(s.output_schema, null),
        workflow_json: parseJsonField(s.workflow_json, null),
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
            OR (sa.grantee_type='factory' AND sa.grantee_id=? AND ? IS NOT NULL)
            OR (sa.grantee_type='org_group' AND sa.grantee_id=? AND ? IS NOT NULL)
        )
    `).get(
        skillId,
        user.id, user.role,
        user.dept_code, user.dept_code,
        user.profit_center, user.profit_center,
        user.org_section, user.org_section,
        user.factory_code, user.factory_code,
        user.org_group_name, user.org_group_name
    );
    return !!access;
}

async function hasDevAccess(db, skillId, user) {
    const access = await db.prepare(`
        SELECT 1 FROM skill_access sa WHERE sa.skill_id=? AND sa.share_type='develop' AND (
            (sa.grantee_type='user' AND sa.grantee_id=TO_CHAR(?))
            OR (sa.grantee_type='role' AND sa.grantee_id=?)
            OR (sa.grantee_type='dept' AND sa.grantee_id=? AND ? IS NOT NULL)
            OR (sa.grantee_type='profit_center' AND sa.grantee_id=? AND ? IS NOT NULL)
            OR (sa.grantee_type='org_section' AND sa.grantee_id=? AND ? IS NOT NULL)
            OR (sa.grantee_type='factory' AND sa.grantee_id=? AND ? IS NOT NULL)
            OR (sa.grantee_type='org_group' AND sa.grantee_id=? AND ? IS NOT NULL)
        )
    `).get(
        skillId,
        user.id, user.role,
        user.dept_code, user.dept_code,
        user.profit_center, user.profit_center,
        user.org_section, user.org_section,
        user.factory_code, user.factory_code,
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
            'SELECT id, role, dept_code, profit_center, org_section, org_group_name, factory_code FROM users WHERE id=?'
        ).get(req.user.id);
        if (!userProfile) return res.status(403).json({ error: '使用者不存在' });

        const isAdminUser = userProfile.role === 'admin';
        // Admin 可見所有技能（方便 debug）
        let sql, params;
        if (isAdminUser) {
            sql = `
      SELECT s.*, u.name AS owner_name
      FROM skills s LEFT JOIN users u ON u.id = s.owner_user_id
      WHERE 1=1
    `;
            params = [];
        } else {
            sql = `
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
            OR (sa.grantee_type='factory' AND sa.grantee_id=? AND ? IS NOT NULL)
            OR (sa.grantee_type='org_group' AND sa.grantee_id=? AND ? IS NOT NULL)
          )
        )
      )
    `;
            params = [
                req.user.id,
                req.user.id, userProfile.role,
                userProfile.dept_code, userProfile.dept_code,
                userProfile.profit_center, userProfile.profit_center,
                userProfile.org_section, userProfile.org_section,
                userProfile.factory_code, userProfile.factory_code,
                userProfile.org_group_name, userProfile.org_group_name,
            ];
        }
        if (type) { sql += ` AND s.type = ?`; params.push(type); }
        sql += ` ORDER BY s.is_admin_approved DESC, s.created_at DESC`;
        let rows = await db.prepare(sql).all(...params);
        if (tag) rows = rows.filter(s => parseJsonField(s.tags).includes(tag));
        if (q) rows = rows.filter(s => s.name.includes(q) || (s.description || '').includes(q));

        // Compute my_share_type per skill
        const isAdmin = isAdminUser;
        const sharedIds = rows.filter(s => s.owner_user_id !== req.user.id && !s.is_public).map(s => s.id);
        const developSet = new Set();
        if (sharedIds.length > 0) {
            const placeholders = sharedIds.map(() => '?').join(',');
            const devRows = await db.prepare(`
                SELECT DISTINCT sa.skill_id FROM skill_access sa
                WHERE sa.share_type='develop' AND sa.skill_id IN (${placeholders}) AND (
                    (sa.grantee_type='user' AND sa.grantee_id=TO_CHAR(?))
                    OR (sa.grantee_type='role' AND sa.grantee_id=?)
                    OR (sa.grantee_type='dept' AND sa.grantee_id=? AND ? IS NOT NULL)
                    OR (sa.grantee_type='profit_center' AND sa.grantee_id=? AND ? IS NOT NULL)
                    OR (sa.grantee_type='org_section' AND sa.grantee_id=? AND ? IS NOT NULL)
                    OR (sa.grantee_type='factory' AND sa.grantee_id=? AND ? IS NOT NULL)
                    OR (sa.grantee_type='org_group' AND sa.grantee_id=? AND ? IS NOT NULL)
                )
            `).all(
                ...sharedIds,
                req.user.id, userProfile.role,
                userProfile.dept_code, userProfile.dept_code,
                userProfile.profit_center, userProfile.profit_center,
                userProfile.org_section, userProfile.org_section,
                userProfile.factory_code, userProfile.factory_code,
                userProfile.org_group_name, userProfile.org_group_name
            );
            for (const r of devRows) developSet.add(r.skill_id);
        }

        res.json(rows.map(s => {
            const isDev = s.owner_user_id === req.user.id || isAdmin || developSet.has(s.id);
            return { ...serializeSkill(s, !isDev), my_share_type: isDev ? 'develop' : 'use' };
        }));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── GET /api/skills/unauthorized  — admin only: 列出 admin 尚無權限的 skill ──────
router.get('/unauthorized', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '僅管理員可存取' });
    try {
        const db = require('../database-oracle').db;
        const userProfile = await db.prepare(
            'SELECT id, role, dept_code, profit_center, org_section, org_group_name, factory_code FROM users WHERE id=?'
        ).get(req.user.id);
        if (!userProfile) return res.json([]);

        // Get authorized skill IDs using the same filter as GET /
        const authRows = await db.prepare(`
          SELECT s.id FROM skills s
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
                OR (sa.grantee_type='factory' AND sa.grantee_id=? AND ? IS NOT NULL)
                OR (sa.grantee_type='org_group' AND sa.grantee_id=? AND ? IS NOT NULL)
              )
            )
          )
        `).all(
            req.user.id,
            req.user.id, userProfile.role,
            userProfile.dept_code, userProfile.dept_code,
            userProfile.profit_center, userProfile.profit_center,
            userProfile.org_section, userProfile.org_section,
            userProfile.factory_code, userProfile.factory_code,
            userProfile.org_group_name, userProfile.org_group_name,
        );
        const authorizedSet = new Set(authRows.map(r => r.id));

        const all = await db.prepare(
            `SELECT s.id, s.name, s.icon, s.description, s.type, s.name_zh, s.name_en, s.name_vi, s.desc_zh, s.desc_en, s.desc_vi
             FROM skills s ORDER BY s.created_at DESC`
        ).all();
        res.json(all.filter(s => !authorizedSet.has(s.id)).map(s => serializeSkill(s)));
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
            code_snippet, code_packages,
            self_kb_ids, kb_mode, tool_schema, output_schema, output_template_id,
            rate_limit_per_user, rate_limit_global, rate_limit_window,
            prompt_version, published_prompt, draft_prompt, workflow_json } = req.body;
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
        code_snippet, code_packages,
        self_kb_ids, kb_mode, tool_schema, output_schema, output_template_id,
        rate_limit_per_user, rate_limit_global, rate_limit_window,
        prompt_version, published_prompt, draft_prompt, workflow_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
            JSON.stringify(code_packages || []),
            JSON.stringify(self_kb_ids || []),
            kb_mode || 'append',
            tool_schema ? JSON.stringify(tool_schema) : null,
            output_schema ? JSON.stringify(output_schema) : null,
            output_template_id || null,
            rate_limit_per_user != null ? Number(rate_limit_per_user) : null,
            rate_limit_global != null ? Number(rate_limit_global) : null,
            rate_limit_window || 'hour',
            prompt_version != null ? Number(prompt_version) : 1,
            published_prompt || null,
            draft_prompt || null,
            workflow_json ? JSON.stringify(workflow_json) : null
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
        let isDevelop = isOwner || isAdmin;
        if (!isOwner && !isAdmin) {
            const userProfile = await db.prepare(
                'SELECT id, role, dept_code, profit_center, org_section, org_group_name, factory_code FROM users WHERE id=?'
            ).get(req.user.id);
            if (!s.is_public) {
                const hasAccess = userProfile && await canUserAccessSkill(db, req.params.id, userProfile);
                if (!hasAccess) return res.status(403).json({ error: '無存取權限' });
            }
            // Check if user has develop permission (even for public skills)
            isDevelop = userProfile ? await hasDevAccess(db, req.params.id, userProfile) : false;
        }
        res.json({ ...serializeSkill(s, !isDevelop), my_share_type: isDevelop ? 'develop' : 'use' });
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
        const isOwner = s.owner_user_id === req.user.id;
        const isAdmin = req.user.role === 'admin';
        if (!isOwner && !isAdmin) {
            const userProfile = await db.prepare(
                'SELECT id, role, dept_code, profit_center, org_section, org_group_name, factory_code FROM users WHERE id=?'
            ).get(req.user.id);
            const isDev = userProfile && await hasDevAccess(db, req.params.id, userProfile);
            if (!isDev) return res.status(403).json({ error: '需要「開發」權限才能編輯' });
        }
        const { name, description, icon, type, system_prompt, endpoint_url, endpoint_secret,
            endpoint_mode, model_key, mcp_tool_mode, mcp_tool_ids, dify_kb_ids, tags,
            code_snippet, code_packages,
            self_kb_ids, kb_mode, tool_schema, output_schema, output_template_id,
            rate_limit_per_user, rate_limit_global, rate_limit_window,
            prompt_version, published_prompt, draft_prompt, workflow_json,
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
        code_snippet=?, code_packages=?,
        self_kb_ids=?, kb_mode=?, tool_schema=?, output_schema=?, output_template_id=?,
        rate_limit_per_user=?, rate_limit_global=?, rate_limit_window=?,
        prompt_version=?, published_prompt=?, draft_prompt=?, workflow_json=?,
        updated_at=CURRENT_TIMESTAMP
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
            JSON.stringify(self_kb_ids ?? parseJsonField(s.self_kb_ids)),
            kb_mode ?? s.kb_mode ?? 'append',
            tool_schema !== undefined ? (tool_schema ? JSON.stringify(tool_schema) : null) : s.tool_schema,
            output_schema !== undefined ? (output_schema ? JSON.stringify(output_schema) : null) : s.output_schema,
            output_template_id !== undefined ? (output_template_id || null) : s.output_template_id,
            rate_limit_per_user !== undefined ? (rate_limit_per_user != null ? Number(rate_limit_per_user) : null) : s.rate_limit_per_user,
            rate_limit_global !== undefined ? (rate_limit_global != null ? Number(rate_limit_global) : null) : s.rate_limit_global,
            rate_limit_window ?? s.rate_limit_window ?? 'hour',
            prompt_version !== undefined ? (prompt_version != null ? Number(prompt_version) : s.prompt_version) : s.prompt_version,
            published_prompt !== undefined ? (published_prompt || null) : s.published_prompt,
            draft_prompt !== undefined ? (draft_prompt || null) : s.draft_prompt,
            workflow_json !== undefined ? (workflow_json ? JSON.stringify(workflow_json) : null) : s.workflow_json,
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
        const isOwner = s.owner_user_id === req.user.id;
        const isAdmin = req.user.role === 'admin';
        if (!isOwner && !isAdmin) {
            // Public skills without develop access → cannot fork
            const userProfile = await db.prepare(
                'SELECT id, role, dept_code, profit_center, org_section, org_group_name, factory_code FROM users WHERE id=?'
            ).get(req.user.id);
            const isDev = userProfile && await hasDevAccess(db, req.params.id, userProfile);
            if (!isDev) return res.status(403).json({ error: '需要「開發」權限才能 Fork 此技能' });
        }
        const result = await db.prepare(`
      INSERT INTO skills (name, description, icon, type, system_prompt, endpoint_url, endpoint_secret,
        endpoint_mode, model_key, mcp_tool_mode, mcp_tool_ids, dify_kb_ids, tags, owner_user_id,
        is_public, is_admin_approved, pending_approval,
        self_kb_ids, kb_mode, tool_schema, output_schema,
        rate_limit_per_user, rate_limit_global, rate_limit_window,
        prompt_version, published_prompt, draft_prompt, workflow_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
            `${s.name} (複本)`, s.description, s.icon, s.type, s.system_prompt,
            s.endpoint_url, s.endpoint_secret, s.endpoint_mode, s.model_key,
            s.mcp_tool_mode, s.mcp_tool_ids, s.dify_kb_ids, s.tags, req.user.id,
            s.self_kb_ids, s.kb_mode || 'append',
            s.tool_schema, s.output_schema,
            s.rate_limit_per_user, s.rate_limit_global, s.rate_limit_window || 'hour',
            1, s.published_prompt, s.draft_prompt, s.workflow_json
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
            SELECT sa.*, u.name AS granted_by_name,
              CASE
                WHEN sa.grantee_type='user' THEN (SELECT u2.name FROM users u2 WHERE TO_CHAR(u2.id)=sa.grantee_id)
                WHEN sa.grantee_type='role' THEN (SELECT r.name FROM roles r WHERE TO_CHAR(r.id)=sa.grantee_id)
                ELSE sa.grantee_id
              END AS grantee_name
            FROM skill_access sa
            LEFT JOIN users u ON u.id = sa.granted_by
            WHERE sa.skill_id = ?
            ORDER BY sa.granted_at DESC
        `).all(req.params.id);
        await resolveGranteeNamesInRows(grants, getLangFromReq(req), db);
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
        const { grantee_type, grantee_id, share_type = 'use' } = req.body;
        if (!grantee_type || !grantee_id) return res.status(400).json({ error: 'grantee_type 和 grantee_id 必填' });
        const validTypes = ['use', 'develop'];
        const finalShareType = validTypes.includes(share_type) ? share_type : 'use';

        // Upsert: if exists, update share_type
        const existing = await db.prepare(
            'SELECT id FROM skill_access WHERE skill_id=? AND grantee_type=? AND grantee_id=?'
        ).get(req.params.id, grantee_type, String(grantee_id));

        let grantId;
        if (existing) {
            await db.prepare('UPDATE skill_access SET share_type=? WHERE id=?').run(finalShareType, existing.id);
            grantId = existing.id;
        } else {
            grantId = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : require('crypto').randomUUID();
            await db.prepare(`
                INSERT INTO skill_access (id, skill_id, grantee_type, grantee_id, share_type, granted_by)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(grantId, req.params.id, grantee_type, String(grantee_id), finalShareType, req.user.id);
        }
        // Return updated list
        const grants = await db.prepare(`
            SELECT sa.*, u.name AS granted_by_name,
              CASE
                WHEN sa.grantee_type='user' THEN (SELECT u2.name FROM users u2 WHERE TO_CHAR(u2.id)=sa.grantee_id)
                WHEN sa.grantee_type='role' THEN (SELECT r.name FROM roles r WHERE TO_CHAR(r.id)=sa.grantee_id)
                ELSE sa.grantee_id
              END AS grantee_name
            FROM skill_access sa LEFT JOIN users u ON u.id = sa.granted_by
            WHERE sa.skill_id = ?
            ORDER BY sa.granted_at DESC
        `).all(req.params.id);
        await resolveGranteeNamesInRows(grants, getLangFromReq(req), db);
        res.json(grants);
    } catch (e) {
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

// ── POST /api/skills/:id/publish — 發佈當前 prompt 為新版本 ────────────────────
router.post('/:id/publish', verifyToken, async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        const { change_note } = req.body;
        const skill = await db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
        if (!skill) return res.status(404).json({ error: '技能不存在' });
        if (skill.owner_user_id !== req.user.id && req.user.role !== 'admin')
            return res.status(403).json({ error: '無權限' });

        const newVersion = (skill.prompt_version || 0) + 1;

        // Insert version record
        await db.prepare(`
            INSERT INTO skill_prompt_versions (skill_id, version, system_prompt, workflow_json, changed_by, change_note)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(req.params.id, newVersion, skill.system_prompt, skill.workflow_json, req.user.id, change_note || null);

        // Update skill
        await db.prepare(`
            UPDATE skills SET prompt_version=?, published_prompt=?, draft_prompt=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?
        `).run(newVersion, skill.system_prompt, req.params.id);

        res.json({ ok: true, version: newVersion });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── GET /api/skills/:id/versions — 取得版本歷史 ──────────────────────────────────
router.get('/:id/versions', verifyToken, async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        const versions = await db.prepare(`
            SELECT v.*, u.name as changed_by_name
            FROM skill_prompt_versions v
            LEFT JOIN users u ON u.id = v.changed_by
            WHERE v.skill_id = ?
            ORDER BY v.version DESC
        `).all(req.params.id);
        res.json(versions);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── GET /api/skills/:id/versions/:version — 取得特定版本 ─────────────────────────
router.get('/:id/versions/:version', verifyToken, async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        const version = await db.prepare(`
            SELECT v.*, u.name as changed_by_name
            FROM skill_prompt_versions v
            LEFT JOIN users u ON u.id = v.changed_by
            WHERE v.skill_id = ? AND v.version = ?
        `).get(req.params.id, req.params.version);
        if (!version) return res.status(404).json({ error: '版本不存在' });
        res.json(version);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/skills/:id/rollback/:version — 回滾到指定版本 ──────────────────────
router.post('/:id/rollback/:version', verifyToken, async (req, res) => {
    try {
        const db = require('../database-oracle').db;
        const skill = await db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
        if (!skill) return res.status(404).json({ error: '技能不存在' });
        if (skill.owner_user_id !== req.user.id && req.user.role !== 'admin')
            return res.status(403).json({ error: '無權限' });

        const version = await db.prepare('SELECT * FROM skill_prompt_versions WHERE skill_id=? AND version=?')
            .get(req.params.id, req.params.version);
        if (!version) return res.status(404).json({ error: '版本不存在' });

        // Restore prompt and workflow
        await db.prepare(`
            UPDATE skills SET system_prompt=?, workflow_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
        `).run(version.system_prompt, version.workflow_json, req.params.id);

        res.json({ ok: true, restored_version: Number(req.params.version) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
