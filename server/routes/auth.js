const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

/**
 * Detect preferred language from browser Accept-Language header.
 * Maps to supported codes: 'zh-TW' | 'en' | 'vi'
 */
function detectLangFromHeader(acceptLanguage) {
  if (!acceptLanguage) return null;
  const langs = acceptLanguage.split(',').map((part) => {
    const [code, q] = part.trim().split(';q=');
    return { code: code.trim().toLowerCase(), q: q ? parseFloat(q) : 1.0 };
  }).sort((a, b) => b.q - a.q);
  for (const { code } of langs) {
    if (code.startsWith('zh')) return 'zh-TW';
    if (code.startsWith('vi')) return 'vi';
    if (code.startsWith('en')) return 'en';
  }
  return null;
}

const redis = require('../services/redisClient');

// LDAP Config
let ldap = null;
const LDAP_ENABLED = !!(process.env.LDAP_URL && process.env.LDAP_BASE_DN);

if (LDAP_ENABLED) {
  try {
    ldap = require('ldapjs');
  } catch (e) {
    console.warn('[Auth] ldapjs not available');
  }
}

const LDAP_CONFIG = {
  url: process.env.LDAP_URL,
  baseDN: process.env.LDAP_BASE_DN,
  managerDN: process.env.LDAP_MANAGER_DN,
  managerPass: process.env.LDAP_MANAGER_PASSWORD,
  reconnect: false,
  strictDN: false,
  tlsOptions: { rejectUnauthorized: false },
};

const authenticateLDAP = (account, password) => {
  return new Promise((resolve, reject) => {
    if (!ldap || !LDAP_ENABLED) return resolve(null);
    try {
      const client = ldap.createClient(LDAP_CONFIG);
      client.on('error', (err) => console.error('[LDAP] Client Error:', err.message));

      client.bind(LDAP_CONFIG.managerDN, LDAP_CONFIG.managerPass, (err) => {
        if (err) {
          client.unbind();
          return reject({ type: 'sys', error: err });
        }

        const opts = {
          filter: `(sAMAccountName=${account})`,
          scope: 'sub',
          attributes: ['dn', 'sAMAccountName', 'displayName', 'mail'],
        };

        client.search(LDAP_CONFIG.baseDN, opts, (err, res) => {
          if (err) {
            client.unbind();
            return reject({ type: 'sys', error: err });
          }

          let userEntry = null;
          res.on('searchEntry', (entry) => {
            let attributes = {};
            if (entry.attributes && Array.isArray(entry.attributes)) {
              entry.attributes.forEach((a) => {
                attributes[a.type] = a.vals || a.values;
              });
            } else if (entry.object) {
              attributes = entry.object;
            }
            userEntry = { dn: entry.objectName || entry.dn, ...attributes };
          });

          res.on('end', () => {
            if (!userEntry) {
              client.unbind();
              return resolve(null);
            }

            const userClient = ldap.createClient(LDAP_CONFIG);
            const userDn = userEntry.dn.toString();
            userClient.bind(userDn, password, (err) => {
              userClient.unbind();
              client.unbind();
              if (err) return reject({ type: 'auth', error: 'Invalid Credentials' });

              const rawDisplayName = userEntry.displayName;
              const displayName = Array.isArray(rawDisplayName)
                ? rawDisplayName[0]
                : rawDisplayName || '';
              let employeeId = '';
              let name = '';
              if (displayName) {
                const parts = displayName.trim().split(' ');
                if (parts.length > 0 && /^\d+$/.test(parts[0])) {
                  employeeId = parts[0];
                  name = parts.slice(1).join(' ');
                } else {
                  name = displayName;
                }
              }
              if (!name) name = account;

              const rawMail = userEntry.mail;
              const email = Array.isArray(rawMail) ? rawMail[0] : rawMail || null;

              resolve({ account: account.toUpperCase(), name, employeeId, email });
            });
          });

          res.on('error', (err) => {
            client.unbind();
            reject({ type: 'sys', error: err });
          });
        });
      });
    } catch (e) {
      reject({ type: 'sys', error: e });
    }
  });
};

// POST /api/auth/login
router.post('/login', async (req, res) => {
  let { username, password } = req.body;
  username = username ? username.trim() : '';
  if (!username || !password) {
    return res.status(400).json({ error: '請輸入帳號與密碼' });
  }

  try {
    const db = require('../database-oracle').db;
    const isAdmin = username.toUpperCase() === (process.env.DEFAULT_ADMIN_ACCOUNT || 'admin').toUpperCase();
    console.log(`[Auth] Login attempt: ${username}, isAdmin=${isAdmin}, LDAP_ENABLED=${LDAP_ENABLED}`);

    // Try LDAP for non-admin
    if (!isAdmin && LDAP_ENABLED) {
      try {
        const ldapUser = await authenticateLDAP(username, password);
        if (ldapUser) {
          let dbUser = await db.prepare('SELECT * FROM users WHERE UPPER(username) = UPPER(?)').get(ldapUser.account);
          if (dbUser) {
            // Existing user (may have been manually created) — sync AD info and mark as LDAP managed
            await db.prepare(
              'UPDATE users SET name=?, email=?, employee_id=?, password=?, creation_method=? WHERE id=?'
            ).run(ldapUser.name, ldapUser.email, ldapUser.employeeId, password, 'ldap', dbUser.id);

            if (dbUser.status !== 'active') {
              return res.status(403).json({ error: '帳號已停用，請聯絡系統管理員' });
            }
            dbUser = await db.prepare('SELECT * FROM users WHERE id=?').get(dbUser.id);
            // Auto-sync org if employee_id available
            if (ldapUser.employeeId) {
              try {
                const { syncOrgToUsers } = require('../services/orgSyncService');
                syncOrgToUsers(db, [String(ldapUser.employeeId)], 'login').catch(() => { });
              } catch (e) { /* ERP not configured */ }
            }
            return await createSession(res, dbUser);
          } else {
            // First LDAP login — auto-activate with default role permissions
            const defaultRole = await db.prepare(`SELECT * FROM roles WHERE is_default=1 FETCH FIRST 1 ROWS ONLY`).get();
            const result = await db.prepare(
              `INSERT INTO users (username, name, email, role, status, password, employee_id, creation_method,
                role_id, allow_text_upload, text_max_mb, allow_audio_upload, audio_max_mb,
                allow_image_upload, image_max_mb, allow_scheduled_tasks)
               VALUES (?,?,?,'user','active',?,?,?, ?,?,?,?,?,?,?,?)`
            ).run(
              ldapUser.account, ldapUser.name, ldapUser.email, password, ldapUser.employeeId, 'ldap',
              defaultRole?.id ?? null,
              defaultRole?.allow_text_upload ?? 1,
              defaultRole?.text_max_mb ?? 10,
              defaultRole?.allow_audio_upload ?? 0,
              defaultRole?.audio_max_mb ?? 10,
              defaultRole?.allow_image_upload ?? 1,
              defaultRole?.image_max_mb ?? 10,
              defaultRole?.allow_scheduled_tasks ?? 0
            );
            const newUser = await db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
            // Auto-sync org after first LDAP login
            if (ldapUser.employeeId) {
              try {
                const { syncOrgToUsers } = require('../services/orgSyncService');
                syncOrgToUsers(db, [String(ldapUser.employeeId)], 'login').catch(() => { });
              } catch (e) { /* ERP not configured */ }
            }
            return await createSession(res, newUser);
          }
        }
      } catch (ldapErr) {
        console.log('[Auth] LDAP failed, fallback to local DB:', ldapErr.type || ldapErr.message);
      }
    }

    // Local DB fallback (case-insensitive username)
    const user = await db.prepare('SELECT * FROM users WHERE UPPER(username) = UPPER(?) AND password = ?').get(username, password);
    if (!user) {
      return res.status(401).json({ error: '帳號或密碼錯誤' });
    }
    if (user.role !== 'admin' && user.status !== 'active') {
      return res.status(403).json({ error: '帳號失效，請聯絡系統管理員' });
    }
    const now = new Date();
    if (user.start_date && new Date(user.start_date) > now) {
      return res.status(403).json({ error: '帳號尚未生效' });
    }
    if (user.end_date && new Date(user.end_date) < now) {
      return res.status(403).json({ error: '帳號已過期' });
    }
    return await createSession(res, user);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const createSession = async (res, user) => {
  const db = require('../database-oracle').db;
  const token = uuidv4();
  await redis.setSession(token, {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    employee_id: user.employee_id,
    email: user.email,
    can_design_ai_select: user.can_design_ai_select,
    can_use_ai_dashboard:  user.can_use_ai_dashboard,
    role_id:       user.role_id,
    dept_code:     user.dept_code,
    profit_center: user.profit_center,
    org_section:   user.org_section,
  });
  const { password: _, ...userWithoutPassword } = user;
  // Resolve effective skill permissions (user setting overrides role default)
  let rolePerms = null;
  if (user.role_id) {
    rolePerms = await db.prepare(
      'SELECT allow_create_skill, allow_external_skill, allow_code_skill, can_create_kb, kb_max_size_mb, kb_max_count, can_deep_research FROM roles WHERE id=?'
    ).get(user.role_id);
  }
  const resolveEffective = (userVal, roleVal) => {
    if (userVal !== null && userVal !== undefined) return userVal === 1;
    if (roleVal !== null && roleVal !== undefined) return roleVal === 1;
    return false;
  };
  const resolveNum = (uv, rv, def) => {
    if (uv !== null && uv !== undefined) return Number(uv);
    if (rv !== null && rv !== undefined) return Number(rv);
    return def;
  };
  userWithoutPassword.effective_allow_create_skill   = user.role === 'admin' || resolveEffective(user.allow_create_skill,   rolePerms?.allow_create_skill);
  userWithoutPassword.effective_allow_external_skill = user.role === 'admin' || resolveEffective(user.allow_external_skill, rolePerms?.allow_external_skill);
  userWithoutPassword.effective_allow_code_skill     = user.role === 'admin' || resolveEffective(user.allow_code_skill,     rolePerms?.allow_code_skill);
  userWithoutPassword.effective_can_create_kb        = user.role === 'admin' || resolveEffective(user.can_create_kb,        rolePerms?.can_create_kb);
  userWithoutPassword.effective_kb_max_size_mb       = user.role === 'admin' ? 99999 : resolveNum(user.kb_max_size_mb, rolePerms?.kb_max_size_mb, 500);
  userWithoutPassword.effective_kb_max_count         = user.role === 'admin' ? 99999 : resolveNum(user.kb_max_count,   rolePerms?.kb_max_count,   5);
  userWithoutPassword.effective_can_deep_research      = user.role === 'admin' || resolveEffective(user.can_deep_research, rolePerms?.can_deep_research ?? 1);
  userWithoutPassword.effective_can_design_ai_select   = user.role === 'admin' || resolveEffective(user.can_design_ai_select,  rolePerms?.can_design_ai_select);
  userWithoutPassword.effective_can_use_ai_dashboard   = user.role === 'admin' || resolveEffective(user.can_use_ai_dashboard,  rolePerms?.can_use_ai_dashboard);
  res.json({ token, user: userWithoutPassword });
};

// POST /api/auth/forgot-password  (manual accounts only)
router.post('/forgot-password', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: '請輸入帳號' });
  try {
    const db = require('../database-oracle').db;
    const user = await db.prepare(
      `SELECT * FROM users WHERE UPPER(username)=UPPER(?) AND (creation_method IS NULL OR creation_method='manual')`
    ).get(username);

    // Always return success to prevent username enumeration
    if (!user || !user.email) {
      return res.json({ message: '若帳號存在且已設定 Email，重置連結已寄出' });
    }

    // Invalidate old tokens for this user
    await db.prepare(`DELETE FROM password_reset_tokens WHERE user_id=?`).run(user.id);

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1hr
    await db.prepare(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?,?,?)`
    ).run(user.id, token, expiresAt);

    const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3007}`;
    const resetLink = `${baseUrl}/reset-password?token=${token}`;

    const { sendMail } = require('../services/mailService');
    await sendMail({
      to: user.email,
      subject: '【FOXLINK GPT】密碼重置請求',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#1e40af">FOXLINK GPT 密碼重置</h2>
          <p>您好 <strong>${user.name || user.username}</strong>，</p>
          <p>我們收到您的密碼重置請求，請點擊下方連結設定新密碼（有效期限 1 小時）：</p>
          <p style="margin:24px 0">
            <a href="${resetLink}" style="background:#2563eb;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
              重置密碼
            </a>
          </p>
          <p style="color:#64748b;font-size:13px">若連結無法點擊，請複製以下網址到瀏覽器：<br>${resetLink}</p>
          <p style="color:#94a3b8;font-size:12px">如果您未曾提出此請求，請忽略此郵件。</p>
        </div>
      `,
    });

    res.json({ message: '若帳號存在且已設定 Email，重置連結已寄出' });
  } catch (e) {
    console.error('[Auth] forgot-password error:', e.message);
    res.status(500).json({ error: '伺服器錯誤，請稍後再試' });
  }
});

// POST /api/auth/reset-password  (token from email)
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: '參數不完整' });
  if (password.length < 6) return res.status(400).json({ error: '密碼至少 6 個字元' });
  try {
    const db = require('../database-oracle').db;
    const record = await db.prepare(
      `SELECT * FROM password_reset_tokens WHERE token=? AND used=0`
    ).get(token);

    if (!record) return res.status(400).json({ error: '重置連結無效或已使用' });
    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ error: '重置連結已過期，請重新申請' });
    }

    await db.prepare(`UPDATE users SET password=? WHERE id=?`).run(password, record.user_id);
    await db.prepare(`UPDATE password_reset_tokens SET used=1 WHERE id=?`).run(record.id);

    res.json({ message: '密碼已成功重置，請重新登入' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/change-password  (authenticated, manual accounts only)
router.post('/change-password', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const session = token ? await redis.getSession(token) : null;
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) return res.status(400).json({ error: '請填寫舊密碼與新密碼' });
  if (new_password.length < 6) return res.status(400).json({ error: '新密碼至少 6 個字元' });

  try {
    const db = require('../database-oracle').db;
    const user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(session.id);
    if (!user) return res.status(404).json({ error: '使用者不存在' });
    if (user.creation_method === 'ldap') {
      return res.status(403).json({ error: '本系統無法進行AD密碼變更，請由AD管理介面進行密碼變更' });
    }
    if (user.password !== old_password) {
      return res.status(400).json({ error: '舊密碼錯誤' });
    }
    await db.prepare(`UPDATE users SET password=? WHERE id=?`).run(new_password, user.id);
    res.json({ message: '密碼已成功更新' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) await redis.delSession(token);
  res.json({ success: true });
});

// GET /api/auth/me  — refresh current user profile
router.get('/me', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const session = token ? await redis.getSession(token) : null;
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const db = require('../database-oracle').db;
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(session.id);
    if (!user) return res.status(404).json({ error: '使用者不存在' });
    const { password: _, ...userWithoutPassword } = user;
    let rolePerms = null;
    if (user.role_id) {
      rolePerms = await db.prepare(
        'SELECT allow_create_skill, allow_external_skill, allow_code_skill, can_create_kb, kb_max_size_mb, kb_max_count, can_deep_research FROM roles WHERE id=?'
      ).get(user.role_id);
    }
    const resolveEff = (uv, rv) => {
      if (uv !== null && uv !== undefined) return uv === 1;
      if (rv !== null && rv !== undefined) return rv === 1;
      return false;
    };
    const resolveNum = (uv, rv, def) => {
      if (uv !== null && uv !== undefined) return Number(uv);
      if (rv !== null && rv !== undefined) return Number(rv);
      return def;
    };
    userWithoutPassword.effective_allow_create_skill    = user.role === 'admin' || resolveEff(user.allow_create_skill,    rolePerms?.allow_create_skill);
    userWithoutPassword.effective_allow_external_skill  = user.role === 'admin' || resolveEff(user.allow_external_skill,  rolePerms?.allow_external_skill);
    userWithoutPassword.effective_allow_code_skill      = user.role === 'admin' || resolveEff(user.allow_code_skill,      rolePerms?.allow_code_skill);
    userWithoutPassword.effective_can_create_kb         = user.role === 'admin' || resolveEff(user.can_create_kb,         rolePerms?.can_create_kb);
    userWithoutPassword.effective_kb_max_size_mb        = user.role === 'admin' ? 99999 : resolveNum(user.kb_max_size_mb,  rolePerms?.kb_max_size_mb, 500);
    userWithoutPassword.effective_kb_max_count          = user.role === 'admin' ? 99999 : resolveNum(user.kb_max_count,    rolePerms?.kb_max_count,   5);
    userWithoutPassword.effective_can_deep_research      = user.role === 'admin' || resolveEff(user.can_deep_research, rolePerms?.can_deep_research ?? 1);
    userWithoutPassword.effective_can_design_ai_select   = user.role === 'admin' || resolveEff(user.can_design_ai_select,  rolePerms?.can_design_ai_select);
    userWithoutPassword.effective_can_use_ai_dashboard   = user.role === 'admin' || resolveEff(user.can_use_ai_dashboard,  rolePerms?.can_use_ai_dashboard);
    // Resolve display language: USERS.preferred_language > browser Accept-Language > 'zh-TW'
    let resolvedLanguage = user.preferred_language || null;
    let is_first_lang_detect = false;
    if (!resolvedLanguage) {
      resolvedLanguage = detectLangFromHeader(req.headers['accept-language']) || 'zh-TW';
      is_first_lang_detect = true;
      // Auto-save detected language so subsequent requests (chat system prompt, etc.) can use it directly
      try {
        await db.prepare('UPDATE users SET preferred_language=? WHERE id=?').run(resolvedLanguage, user.id);
      } catch (_) {}
    }
    userWithoutPassword.resolved_language = resolvedLanguage;
    userWithoutPassword.is_first_lang_detect = is_first_lang_detect;
    res.json(userWithoutPassword);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/auth/language — self-service preferred_language update
router.put('/language', async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  const session = token ? await redis.getSession(token) : null;
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  req.user = session;
  next();
}, async (req, res) => {
  const { language_code } = req.body;
  if (!['zh-TW', 'en', 'vi'].includes(language_code)) return res.status(400).json({ error: '不支援的語言碼' });
  try {
    const db = require('../database-oracle').db;
    await db.prepare('UPDATE users SET preferred_language=? WHERE id=?').run(language_code, req.user.id);
    res.json({ ok: true, language_code });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Middleware
const verifyToken = async (req, res, next) => {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token) {
    token = req.query.token;
  }
  if (!token) return res.status(401).json({ error: 'No token provided' });
  const session = await redis.getSession(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = session;
  next();
};

const verifyAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理員權限' });
  }
  next();
};

module.exports = { router, verifyToken, verifyAdmin };
