/**
 * WebAuthn / Passkey 路由(Face ID / Touch ID / 指紋登入)
 *
 * Flow A — 註冊(已登入):
 *   POST /webauthn/register/options   → 回 challenge
 *   POST /webauthn/register/verify    → 存 credential 到 user_credentials
 *
 * Flow B — 認證(登入頁,可能未登入):
 *   POST /webauthn/auth/options       → 回 challenge(usernameless,user 不用先打帳號)
 *   POST /webauthn/auth/verify        → 驗證,簽 session token
 *
 * Flow C — 管理:
 *   GET    /webauthn/credentials                — 列出自己綁的裝置
 *   DELETE /webauthn/credentials/:id            — 移除自己的某裝置
 *   GET    /webauthn/admin/credentials/:userId  — admin 看某 user 的綁定
 *   DELETE /webauthn/admin/credentials/:id      — admin 強制移除某 credential(換手機)
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { verifyToken, verifyAdmin } = require('./auth');
const redis = require('../services/redisClient');

// ── RP(Relying Party)config ────────────────────────────────────────────────
// rpID 必須是 effective domain(沒有 port、沒有 protocol);origin 完整含 https://
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Cortex';
function getRpId(req) {
  // 優先 env 設定;否則從 Host header 推
  if (process.env.WEBAUTHN_RP_ID) return process.env.WEBAUTHN_RP_ID;
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
  return host || 'localhost';
}
function getOrigin(req) {
  if (process.env.WEBAUTHN_ORIGIN) return process.env.WEBAUTHN_ORIGIN;
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  return `${proto}://${host}`;
}

// ── Challenge 短期儲存(5min)── 用 Redis sharedValue
const CHALLENGE_TTL_SEC = 5 * 60;
async function saveChallenge(key, challenge) {
  await redis.setSharedValue(`webauthn:chal:${key}`, challenge, CHALLENGE_TTL_SEC);
}
async function popChallenge(key) {
  const k = `webauthn:chal:${key}`;
  const v = await redis.getSharedValue(k);
  if (v) await redis.getStore().del(k);
  return v;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function deriveDeviceLabel(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  if (/iphone/.test(ua)) return 'iPhone';
  if (/ipad/.test(ua)) return 'iPad';
  if (/android/.test(ua)) return 'Android';
  if (/mac/.test(ua)) return 'Mac';
  if (/windows/.test(ua)) return 'Windows';
  return 'Device';
}

async function loadUserCredentials(db, userId) {
  return await db.prepare(
    `SELECT id, credential_id, public_key, sign_count, transports
     FROM user_credentials WHERE user_id = ?`
  ).all(userId);
}

// WebAuthn spec 定義的合法 transport(其他值會讓 Android 14+ Credential Manager
// 嚴格驗證失敗,回 "unknown error occurred while talking to the credential manager")
const VALID_TRANSPORTS = new Set(['usb', 'nfc', 'ble', 'hybrid', 'internal', 'cable', 'smart-card']);
function sanitizeTransports(raw) {
  return (raw || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => VALID_TRANSPORTS.has(s));
}

// 把 base64url string 轉 Uint8Array(@simplewebauthn 13.x 用 isoUint8Array)
function b64uToBytes(s) {
  if (!s) return new Uint8Array(0);
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - s.length % 4) % 4), '=');
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

// ════════════════════════════════════════════════════════════════════════════
// REGISTER FLOW(已登入,綁定當前裝置)
// ════════════════════════════════════════════════════════════════════════════

router.post('/register/options', verifyToken, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const userId = req.user.id;
    const username = req.user.username || `user-${userId}`;
    const displayName = req.user.name || username;

    const existing = await loadUserCredentials(db, userId);
    const rpID = getRpId(req);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName: username,
      userDisplayName: displayName,
      // userID 用 user_id 字串(不重要,但要穩定),@simplewebauthn 13 期望 Uint8Array
      userID: new TextEncoder().encode(`u:${userId}`),
      attestationType: 'none', // 我們不需要 attestation,降低隱私顧慮
      excludeCredentials: existing.map((c) => ({
        id: c.credential_id, // base64url string
        // 嚴格 filter — Android 14+ Credential Manager 對非 spec transport 直接 throw
        transports: sanitizeTransports(c.transports),
      })),
      authenticatorSelection: {
        // platform = 強制本機 platform authenticator(Face ID / Touch ID / 指紋 / Windows Hello)
        // 不設此值 Android 14+ 會試圖叫使用者選跨裝置,造成「talking to credential manager」錯誤
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',  // discoverable credential — 支援 usernameless 登入
        userVerification: 'required', // 強制要 Face ID / 指紋
      },
      timeout: 60000,
    });

    // 用 user_id 當 challenge key(每 user 一次只有一個註冊 challenge 進行中)
    await saveChallenge(`reg:${userId}`, options.challenge);
    res.json(options);
  } catch (e) {
    console.error('[webauthn] register options error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/register/verify', verifyToken, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const userId = req.user.id;
    const expectedChallenge = await popChallenge(`reg:${userId}`);
    if (!expectedChallenge) return res.status(400).json({ error: 'Challenge expired,請重新嘗試' });

    const { response, deviceLabel } = req.body || {};
    if (!response) return res.status(400).json({ error: 'missing response' });

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: getRpId(req),
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'verification failed' });
    }

    const info = verification.registrationInfo;
    const cred = info.credential;
    const credentialID = cred.id; // base64url string in v13
    const publicKey = Buffer.from(cred.publicKey).toString('base64'); // store as base64
    const counter = cred.counter || 0;
    const aaguid = info.aaguid || null;
    const backupEligible = info.credentialBackedUp ? 1 : 0;
    const backupState = info.credentialBackedUp ? 1 : 0;
    const transports = (response?.response?.transports || []).join(',') || null;

    await db.prepare(
      `INSERT INTO user_credentials
        (user_id, credential_id, public_key, sign_count, device_label, transports, aaguid, backup_eligible, backup_state, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, SYSTIMESTAMP)`
    ).run(
      userId,
      credentialID,
      publicKey,
      counter,
      (deviceLabel || deriveDeviceLabel(req)).slice(0, 120),
      transports,
      aaguid,
      backupEligible,
      backupState
    );

    res.json({ ok: true, credentialId: credentialID });
  } catch (e) {
    console.error('[webauthn] register verify error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// AUTHENTICATE FLOW(登入頁,可能未登入)
// ════════════════════════════════════════════════════════════════════════════

router.post('/auth/options', async (req, res) => {
  try {
    const rpID = getRpId(req);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      // usernameless:不限定 allowCredentials,讓裝置自己挑
      allowCredentials: [],
      timeout: 60000,
    });
    // challenge key 用 random uuid(client 拿回後存 cookie / state)
    const challengeKey = uuidv4();
    await saveChallenge(`auth:${challengeKey}`, options.challenge);
    res.json({ options, challengeKey });
  } catch (e) {
    console.error('[webauthn] auth options error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/auth/verify', async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const { response, challengeKey } = req.body || {};
    if (!response || !challengeKey) return res.status(400).json({ error: 'missing params' });

    const expectedChallenge = await popChallenge(`auth:${challengeKey}`);
    if (!expectedChallenge) return res.status(400).json({ error: 'Challenge expired,請重新嘗試' });

    const credentialID = response.id; // base64url
    if (!credentialID) return res.status(400).json({ error: 'missing credential id' });

    // 找 credential
    // ⚠️ Oracle reserved keywords / pseudocolumn 雷區:
    //   - u.role       → role 是 unreserved keyword,某些 driver 炸 ORA-00923
    //   - u.id AS uid  → UID 是 Oracle pseudocolumn(SELECT UID FROM dual 內建)
    //                    用作 alias parser 直接炸 ORA-00923
    // 全部 alias 用安全名字避坑(跟 MODE / role 同類教訓)
    const credRow = await db.prepare(
      `SELECT c.id AS cred_pk, c.user_id AS owner_id, c.credential_id, c.public_key, c.sign_count, c.transports,
              u.username, u.role AS user_role, u.status AS user_status
       FROM user_credentials c
       JOIN users u ON u.id = c.user_id
       WHERE c.credential_id = ?`
    ).get(credentialID);
    if (!credRow) return res.status(400).json({ error: '此裝置未綁定任何帳號' });
    if (credRow.user_status === 'inactive') return res.status(403).json({ error: '帳號已停用' });

    const publicKey = Uint8Array.from(Buffer.from(credRow.public_key, 'base64'));
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: getRpId(req),
      credential: {
        id: credRow.credential_id,
        publicKey,
        counter: credRow.sign_count || 0,
        transports: sanitizeTransports(credRow.transports),
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      return res.status(400).json({ error: 'verification failed' });
    }

    // 更新 sign_count + last_used
    const newCounter = verification.authenticationInfo?.newCounter ?? credRow.sign_count;
    await db.prepare(
      `UPDATE user_credentials SET sign_count = ?, last_used_at = SYSTIMESTAMP WHERE id = ?`
    ).run(newCounter, credRow.cred_pk);

    // 簽 session token — 跟密碼登入相同流程
    const userRow = await db.prepare(`SELECT * FROM users WHERE id = ?`).get(credRow.owner_id);
    if (!userRow) return res.status(400).json({ error: 'user not found' });

    const { buildSessionPayload } = require('../services/sessionBuilder');
    const token = uuidv4();
    const payload = await buildSessionPayload(db, userRow.id);
    await redis.setSession(token, payload, userRow.role === 'admin');

    // 解析 effective_* 權限(對齊密碼登入回的 user 物件)
    let rolePerms = null;
    if (userRow.role_id) {
      rolePerms = await db.prepare(
        'SELECT allow_create_skill, allow_external_skill, allow_code_skill, can_create_kb, kb_max_size_mb, kb_max_count, can_deep_research, can_design_ai_select, can_use_ai_dashboard, training_permission FROM roles WHERE id=?'
      ).get(userRow.role_id);
    }
    const re = (uv, rv) => uv != null ? uv === 1 : rv != null ? rv === 1 : false;
    const rn = (uv, rv, def) => uv != null ? Number(uv) : rv != null ? Number(rv) : def;
    const isAdmin = userRow.role === 'admin';
    const { password: _p, ...userResp } = userRow;
    userResp.effective_allow_create_skill   = isAdmin || re(userRow.allow_create_skill,   rolePerms?.allow_create_skill);
    userResp.effective_allow_external_skill = isAdmin || re(userRow.allow_external_skill, rolePerms?.allow_external_skill);
    userResp.effective_allow_code_skill     = isAdmin || re(userRow.allow_code_skill,     rolePerms?.allow_code_skill);
    userResp.effective_can_create_kb        = isAdmin || re(userRow.can_create_kb,        rolePerms?.can_create_kb);
    userResp.effective_kb_max_size_mb       = isAdmin ? 99999 : rn(userRow.kb_max_size_mb, rolePerms?.kb_max_size_mb, 500);
    userResp.effective_kb_max_count         = isAdmin ? 99999 : rn(userRow.kb_max_count,   rolePerms?.kb_max_count,   5);
    userResp.effective_can_deep_research    = isAdmin || re(userRow.can_deep_research,    rolePerms?.can_deep_research ?? 1);
    userResp.effective_can_design_ai_select = isAdmin || re(userRow.can_design_ai_select, rolePerms?.can_design_ai_select);
    userResp.effective_can_use_ai_dashboard = isAdmin || re(userRow.can_use_ai_dashboard, rolePerms?.can_use_ai_dashboard);
    userResp.effective_training_permission  = isAdmin ? 'publish_edit'
      : (userRow.training_permission || rolePerms?.training_permission || 'none');

    res.json({ token, user: userResp, via: 'webauthn' });
  } catch (e) {
    console.error('[webauthn] auth verify error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// CREDENTIAL MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════

router.get('/credentials', verifyToken, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const rows = await db.prepare(
      `SELECT id, device_label, transports,
              TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
              TO_CHAR(last_used_at, 'YYYY-MM-DD HH24:MI') AS last_used_at
       FROM user_credentials
       WHERE user_id = ?
       ORDER BY last_used_at DESC NULLS LAST, created_at DESC`
    ).all(req.user.id);
    res.json(rows);
  } catch (e) {
    console.error('[webauthn] list credentials error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/credentials/:id', verifyToken, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const row = await db.prepare(`SELECT id, user_id FROM user_credentials WHERE id = ?`).get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    if (row.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }
    await db.prepare(`DELETE FROM user_credentials WHERE id = ?`).run(id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[webauthn] delete credential error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Admin:看某 user 的所有 credentials(用於協助處理裝置遺失)
router.get('/admin/credentials/:userId', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'bad userId' });
    const rows = await db.prepare(
      `SELECT id, device_label, transports,
              TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
              TO_CHAR(last_used_at, 'YYYY-MM-DD HH24:MI') AS last_used_at
       FROM user_credentials WHERE user_id = ?
       ORDER BY created_at DESC`
    ).all(userId);
    res.json(rows);
  } catch (e) {
    console.error('[webauthn] admin list error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Admin:reset 某 user 全部 credentials(換手機 / 遺失時重置)
router.post('/admin/credentials/reset/:userId', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { db } = require('../database-oracle');
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'bad userId' });
    await db.prepare(`DELETE FROM user_credentials WHERE user_id = ?`).run(userId);
    res.json({ ok: true });
  } catch (e) {
    console.error('[webauthn] admin reset error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
