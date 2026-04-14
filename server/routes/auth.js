const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

/**
 * 根據新使用者組織資料查詢 role_org_bindings，依部門→利潤中心→事業處→事業群→預設角色的優先序決定角色。
 */
async function resolveRoleByOrg(db, deptCode, profitCenter, orgSection, orgGroupName) {
  const checks = [
    ['department',  deptCode],
    ['cost_center', profitCenter],
    ['division',    orgSection],
    ['org_group',   orgGroupName],
  ];
  for (const [type, code] of checks) {
    if (!code) continue;
    const row = await db.prepare(
      `SELECT role_id FROM role_org_bindings WHERE org_type=? AND org_code=? FETCH FIRST 1 ROWS ONLY`
    ).get(type, String(code).trim());
    if (row) return row.role_id;
  }
  const def = await db.prepare(`SELECT id FROM roles WHERE is_default=1 FETCH FIRST 1 ROWS ONLY`).get();
  return def?.id || null;
}

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
const { buildSessionPayload } = require('../services/sessionBuilder');

// ── SSO / OIDC Config ──────────────────────────────────────────────
// Runtime check (not cached at module load) so env changes take effect after restart
function isSsoEnabled() {
  return !!(process.env.SSO_ISSUER && process.env.SSO_CLIENT_ID && process.env.SSO_CLIENT_SECRET);
}
let _ssoConfig = null; // cached OIDC discovery

async function getSsoConfig() {
  if (_ssoConfig) return _ssoConfig;
  const discoveryUrl = `${process.env.SSO_ISSUER}/.well-known/openid-configuration`;
  const resp = await fetch(discoveryUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`SSO discovery failed: ${resp.status}`);
  _ssoConfig = await resp.json();
  console.log('[SSO] OIDC discovery loaded:', _ssoConfig.issuer);
  return _ssoConfig;
}

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

function tryParseError(text) {
  try { const j = JSON.parse(text); return j.error_description || j.error || null; } catch { return null; }
}

// Log SSO config status at startup
console.log(`[SSO] Enabled: ${isSsoEnabled()}, Issuer: ${process.env.SSO_ISSUER || '(not set)'}, ClientID: ${process.env.SSO_CLIENT_ID ? '(set)' : '(not set)'}`);

// ── SSO Routes ─────────────────────────────────────────────────────

// GET /api/auth/sso/login — redirect to SSO authorization page
router.get('/sso/login', async (_req, res) => {
  if (!isSsoEnabled()) {
    console.warn('[SSO] Not configured. SSO_ISSUER:', process.env.SSO_ISSUER || '(empty)', 'SSO_CLIENT_ID:', process.env.SSO_CLIENT_ID ? '(set)' : '(empty)', 'SSO_CLIENT_SECRET:', process.env.SSO_CLIENT_SECRET ? '(set)' : '(empty)');
    return res.status(501).json({ error: 'SSO not configured — 請確認 .env 中 SSO_ISSUER, SSO_CLIENT_ID, SSO_CLIENT_SECRET 皆已設定' });
  }
  try {
    const cfg = await getSsoConfig();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.SSO_CLIENT_ID,
      redirect_uri: `${process.env.APP_BASE_URL}/api/auth/sso/callback`,
      scope: process.env.SSO_SCOPE || 'openid profile email',
    });
    res.redirect(`${cfg.authorization_endpoint}?${params}`);
  } catch (e) {
    console.error('[SSO] login redirect error:', e.message);
    res.redirect(`${process.env.APP_BASE_URL}/login?sso_error=${encodeURIComponent('SSO 服務暫時無法連線')}`);
  }
});

// GET /api/auth/sso/callback — exchange code for token, get userinfo, create session
router.get('/sso/callback', async (req, res) => {
  const { code, error: ssoError } = req.query;
  const baseUrl = process.env.APP_BASE_URL || '';

  if (!isSsoEnabled()) {
    return res.redirect(`${baseUrl}/login?sso_error=${encodeURIComponent('SSO 未設定')}`);
  }

  if (ssoError || !code) {
    return res.redirect(`${baseUrl}/login?sso_error=${encodeURIComponent(ssoError || 'SSO 登入失敗')}`);
  }

  try {
    const cfg = await getSsoConfig();

    // 1. Exchange authorization code for tokens
    const redirectUri = `${process.env.APP_BASE_URL}/api/auth/sso/callback`;
    const basicAuth = Buffer.from(`${process.env.SSO_CLIENT_ID}:${process.env.SSO_CLIENT_SECRET}`).toString('base64');
    console.log('[SSO] Token exchange → endpoint:', cfg.token_endpoint, 'redirect_uri:', redirectUri);

    const tokenResp = await fetch(cfg.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenResp.ok) {
      const text = await tokenResp.text();
      console.error('[SSO] token exchange failed:', tokenResp.status, text);
      return res.redirect(`${baseUrl}/login?sso_error=${encodeURIComponent('SSO Token 交換失敗: ' + (tryParseError(text) || tokenResp.status))}`);
    }
    const tokenData = await tokenResp.json();

    // 2. Get userinfo
    const userInfoResp = await fetch(cfg.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!userInfoResp.ok) {
      console.error('[SSO] userinfo failed:', userInfoResp.status);
      return res.redirect(`${baseUrl}/login?sso_error=${encodeURIComponent('SSO 無法取得使用者資訊')}`);
    }
    const ssoUser = await userInfoResp.json();
    // ssoUser: { sub, account, emp_cd, name, email, department, title }
    console.log('[SSO] userinfo:', { account: ssoUser.account, emp_cd: ssoUser.emp_cd, name: ssoUser.name });

    const db = require('../database-oracle').db;
    const username = (ssoUser.account || ssoUser.sub).toUpperCase();
    let dbUser = await db.prepare('SELECT * FROM users WHERE UPPER(username) = UPPER(?)').get(username);

    if (dbUser) {
      // Existing user — sync SSO info
      // name_manually_set=1 表示管理員已手動鎖定姓名，不讓 SSO 覆蓋
      await db.prepare(
        'UPDATE users SET name=CASE WHEN name_manually_set=1 THEN name ELSE ? END, email=?, employee_id=CASE WHEN name_manually_set=1 THEN employee_id ELSE ? END, creation_method=COALESCE(NULLIF(creation_method,\'manual\'),?) WHERE id=?'
      ).run(ssoUser.name, ssoUser.email, ssoUser.emp_cd || dbUser.employee_id, 'sso', dbUser.id);

      if (dbUser.status !== 'active') {
        return res.redirect(`${baseUrl}/login?sso_error=${encodeURIComponent('帳號已停用，請聯絡系統管理員')}`);
      }
      dbUser = await db.prepare('SELECT * FROM users WHERE id=?').get(dbUser.id);

      // Auto-sync org from ERP
      if (ssoUser.emp_cd) {
        try {
          const { syncOrgToUsers } = require('../services/orgSyncService');
          syncOrgToUsers(db, [String(ssoUser.emp_cd)], 'sso-login').catch(() => {});
        } catch (_) {}
      }
    } else {
      // First SSO login — auto-create user (same pattern as LDAP first login)
      let resolvedRoleId = null;
      if (ssoUser.emp_cd) {
        try {
          const { isConfigured, getEmployeeOrgData } = require('../services/erpDb');
          if (isConfigured()) {
            const erpRows = await getEmployeeOrgData([String(ssoUser.emp_cd)]);
            if (erpRows.length) {
              const r = erpRows[0];
              resolvedRoleId = await resolveRoleByOrg(db,
                r.DEPT_CODE?.trim(), r.PROFIT_CENTER?.trim(),
                r.ORG_SECTION?.trim(), r.ORG_GROUP_NAME?.trim()
              );
              console.log(`[SSO] Org-based role resolved: ${resolvedRoleId} for emp ${ssoUser.emp_cd}`);
            }
          }
        } catch (e) {
          console.warn('[SSO] org-based role resolution failed:', e.message);
        }
      }
      // Fallback: try resolveRoleByOrg with SSO department, then default role
      if (!resolvedRoleId && ssoUser.department) {
        resolvedRoleId = await resolveRoleByOrg(db, ssoUser.department, null, null, null);
      }
      if (!resolvedRoleId) {
        resolvedRoleId = (await db.prepare('SELECT id FROM roles WHERE is_default=1 FETCH FIRST 1 ROWS ONLY').get())?.id ?? null;
      }

      const rolePerms = resolvedRoleId
        ? await db.prepare('SELECT * FROM roles WHERE id=?').get(resolvedRoleId)
        : null;

      const result = await db.prepare(
        `INSERT INTO users (username, name, email, role, status, password, employee_id, creation_method,
          role_id, allow_text_upload, text_max_mb, allow_audio_upload, audio_max_mb,
          allow_image_upload, image_max_mb, allow_scheduled_tasks)
         VALUES (?,?,?,'user','active',?,?,?, ?,?,?,?,?,?,?,?)`
      ).run(
        username, ssoUser.name, ssoUser.email, '', ssoUser.emp_cd || '', 'sso',
        resolvedRoleId ?? null,
        rolePerms?.allow_text_upload ?? 1,
        rolePerms?.text_max_mb ?? 10,
        rolePerms?.allow_audio_upload ?? 0,
        rolePerms?.audio_max_mb ?? 10,
        rolePerms?.allow_image_upload ?? 1,
        rolePerms?.image_max_mb ?? 10,
        rolePerms?.allow_scheduled_tasks ?? 0
      );
      dbUser = await db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);

      // Auto-sync org after first SSO login
      if (ssoUser.emp_cd) {
        try {
          const { syncOrgToUsers } = require('../services/orgSyncService');
          syncOrgToUsers(db, [String(ssoUser.emp_cd)], 'sso-login').catch(() => {});
        } catch (_) {}
      }
    }

    // 3. Create session (same as local/LDAP login)
    const sessionToken = uuidv4();
    const ssoSessionPayload = await buildSessionPayload(db, dbUser.id);
    await redis.setSession(sessionToken, ssoSessionPayload, dbUser.role === 'admin');

    // Redirect to frontend with token
    res.redirect(`${baseUrl}/login?sso_token=${sessionToken}`);
  } catch (e) {
    console.error('[SSO] callback error:', e);
    res.redirect(`${baseUrl}/login?sso_error=${encodeURIComponent('SSO 登入處理失敗: ' + e.message)}`);
  }
});

// GET /api/auth/sso/user — frontend calls this after receiving sso_token to get user profile
router.get('/sso/user', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'Missing token' });
  const session = await redis.getSession(token);
  if (!session) return res.status(401).json({ error: 'Invalid token' });
  try {
    const db = require('../database-oracle').db;
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(session.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password: _, ...u } = user;
    // Resolve effective permissions (same as createSession)
    let rolePerms = null;
    if (user.role_id) {
      rolePerms = await db.prepare(
        'SELECT allow_create_skill, allow_external_skill, allow_code_skill, can_create_kb, kb_max_size_mb, kb_max_count, can_deep_research, can_design_ai_select, can_use_ai_dashboard, training_permission FROM roles WHERE id=?'
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
    u.effective_allow_create_skill   = user.role === 'admin' || resolveEff(user.allow_create_skill,   rolePerms?.allow_create_skill);
    u.effective_allow_external_skill = user.role === 'admin' || resolveEff(user.allow_external_skill, rolePerms?.allow_external_skill);
    u.effective_allow_code_skill     = user.role === 'admin' || resolveEff(user.allow_code_skill,     rolePerms?.allow_code_skill);
    u.effective_can_create_kb        = user.role === 'admin' || resolveEff(user.can_create_kb,        rolePerms?.can_create_kb);
    u.effective_kb_max_size_mb       = user.role === 'admin' ? 99999 : resolveNum(user.kb_max_size_mb, rolePerms?.kb_max_size_mb, 500);
    u.effective_kb_max_count         = user.role === 'admin' ? 99999 : resolveNum(user.kb_max_count,   rolePerms?.kb_max_count,   5);
    u.effective_can_deep_research      = user.role === 'admin' || resolveEff(user.can_deep_research, rolePerms?.can_deep_research ?? 1);
    u.effective_can_design_ai_select   = user.role === 'admin' || resolveEff(user.can_design_ai_select,  rolePerms?.can_design_ai_select);
    u.effective_can_use_ai_dashboard   = user.role === 'admin' || resolveEff(user.can_use_ai_dashboard,  rolePerms?.can_use_ai_dashboard);
    u.effective_training_permission     = user.role === 'admin' ? 'publish_edit'
      : (user.training_permission || rolePerms?.training_permission || 'none');
    res.json({ token, user: u });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
            // name_manually_set=1 表示管理員已手動鎖定姓名，不讓 LDAP 覆蓋
            await db.prepare(
              'UPDATE users SET name=CASE WHEN name_manually_set=1 THEN name ELSE ? END, email=?, employee_id=CASE WHEN name_manually_set=1 THEN employee_id ELSE ? END, password=?, creation_method=? WHERE id=?'
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
            // First LDAP login — resolve role from org bindings, fallback to default role
            let resolvedRoleId = null;
            if (ldapUser.employeeId) {
              try {
                const { isConfigured, getEmployeeOrgData } = require('../services/erpDb');
                if (isConfigured()) {
                  const erpRows = await getEmployeeOrgData([String(ldapUser.employeeId)]);
                  if (erpRows.length) {
                    const r = erpRows[0];
                    resolvedRoleId = await resolveRoleByOrg(db,
                      r.DEPT_CODE?.trim(), r.PROFIT_CENTER?.trim(),
                      r.ORG_SECTION?.trim(), r.ORG_GROUP_NAME?.trim()
                    );
                    console.log(`[Auth] Org-based role resolved: ${resolvedRoleId} for emp ${ldapUser.employeeId}`);
                  }
                }
              } catch (e) {
                console.warn('[Auth] org-based role resolution failed:', e.message);
              }
            }
            if (!resolvedRoleId) {
              resolvedRoleId = (await db.prepare(`SELECT id FROM roles WHERE is_default=1 FETCH FIRST 1 ROWS ONLY`).get())?.id ?? null;
            }
            const rolePerms = resolvedRoleId
              ? await db.prepare(`SELECT * FROM roles WHERE id=?`).get(resolvedRoleId)
              : null;
            const result = await db.prepare(
              `INSERT INTO users (username, name, email, role, status, password, employee_id, creation_method,
                role_id, allow_text_upload, text_max_mb, allow_audio_upload, audio_max_mb,
                allow_image_upload, image_max_mb, allow_scheduled_tasks)
               VALUES (?,?,?,'user','active',?,?,?, ?,?,?,?,?,?,?,?)`
            ).run(
              ldapUser.account, ldapUser.name, ldapUser.email, password, ldapUser.employeeId, 'ldap',
              resolvedRoleId ?? null,
              rolePerms?.allow_text_upload ?? 1,
              rolePerms?.text_max_mb ?? 10,
              rolePerms?.allow_audio_upload ?? 0,
              rolePerms?.audio_max_mb ?? 10,
              rolePerms?.allow_image_upload ?? 1,
              rolePerms?.image_max_mb ?? 10,
              rolePerms?.allow_scheduled_tasks ?? 0
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
  const sessionPayload = await buildSessionPayload(db, user.id);
  await redis.setSession(token, sessionPayload, user.role === 'admin');
  const { password: _, ...userWithoutPassword } = user;
  // Resolve effective skill permissions (user setting overrides role default)
  let rolePerms = null;
  if (user.role_id) {
    rolePerms = await db.prepare(
      'SELECT allow_create_skill, allow_external_skill, allow_code_skill, can_create_kb, kb_max_size_mb, kb_max_count, can_deep_research, can_design_ai_select, can_use_ai_dashboard, training_permission FROM roles WHERE id=?'
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
  userWithoutPassword.effective_training_permission     = user.role === 'admin' ? 'publish_edit'
    : (user.training_permission || rolePerms?.training_permission || 'none');
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
      subject: '[Cortex] 密碼重置請求',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#1e40af">Cortex 密碼重置</h2>
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
  if (session._impersonation) return res.status(403).json({ error: '模擬登入中不可變更密碼，請先退出模擬' });

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
        'SELECT allow_create_skill, allow_external_skill, allow_code_skill, can_create_kb, kb_max_size_mb, kb_max_count, can_deep_research, can_design_ai_select, can_use_ai_dashboard, training_permission FROM roles WHERE id=?'
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
    userWithoutPassword.effective_training_permission     = user.role === 'admin' ? 'publish_edit'
      : (user.training_permission || rolePerms?.training_permission || 'none');
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

// POST /api/auth/activity — 前端定期上報目前所在頁面，存入 session
router.post('/activity', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.json({ ok: false });
  const session = await redis.getSession(token);
  if (!session) return res.json({ ok: false });
  const { page, page_title } = req.body;
  session.current_page       = page       || null;
  session.current_page_title = page_title || null;
  session.current_page_at    = new Date().toISOString();
  await redis.setSession(token, session, session.role === 'admin');
  res.json({ ok: true });
});

// GET /api/auth/token-stats — 使用者查看自己近 30 天各模型費用（無需 admin）
router.get('/token-stats', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const session = token ? await redis.getSession(token) : null;
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const db = require('../database-oracle').db;
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const rows = await db.prepare(`
      SELECT TO_CHAR(usage_date,'YYYY-MM-DD') AS usage_date,
             tu.model,
             COALESCE(lm.name, tu.model) AS model_name,
             COALESCE(tu.input_tokens,0)  AS input_tokens,
             COALESCE(tu.output_tokens,0) AS output_tokens,
             COALESCE(tu.cost,0)          AS cost,
             COALESCE(tu.currency,'USD')  AS currency
      FROM token_usage tu
      LEFT JOIN llm_models lm ON LOWER(lm.key)=LOWER(tu.model) AND lm.is_active=1
      WHERE tu.user_id = ?
        AND tu.usage_date >= SYSDATE - ?
      ORDER BY tu.usage_date ASC, tu.model ASC
    `).all(session.id, days);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
  // Sliding expiration：管理員使用超長 TTL，一般使用者使用 SESSION_TTL。
  redis.touchSession(token, session.role === 'admin').catch(() => {});

  // 從 X-Current-Page header 更新 session 的 current_page（每次 API 請求自動帶入）
  const xPage = req.headers['x-current-page'];
  if (xPage && xPage !== session.current_page) {
    const PAGE_TITLES = {
      '/': '對話', '/chat': '對話', '/skills': '技能市場',
      '/knowledge': '知識庫', '/dify': 'API 連接器', '/mcp': 'MCP',
      '/research': '深度研究', '/monitor': 'AI 戰情',
      '/dashboard': 'AI 戰情', '/admin': '系統管理', '/help': '說明',
    };
    const title = Object.entries(PAGE_TITLES).find(([k]) => k !== '/' && xPage.startsWith(k))?.[1]
      ?? PAGE_TITLES[xPage] ?? xPage;
    session.current_page       = xPage;
    session.current_page_title = title;
    session.current_page_at    = new Date().toISOString();
    redis.setSession(token, session, session.role === 'admin').catch(() => {});
  }

  next();
};

const verifyAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理員權限' });
  }
  next();
};

// ─── Impersonation (admin-only) ──────────────────────────────────────
// POST /api/auth/impersonate — admin 切換身分到目標 user，建立新 token
router.post('/impersonate', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { target_user_id } = req.body || {};
    if (!target_user_id) return res.status(400).json({ error: 'target_user_id required' });
    if (Number(target_user_id) === Number(req.user.id)) return res.status(400).json({ error: '不能模擬自己' });
    if (req.user._impersonation) return res.status(400).json({ error: '已在模擬中，請先退出' });

    const db = require('../database-oracle').db;
    const target = await buildSessionPayload(db, target_user_id);
    if (!target) return res.status(404).json({ error: '使用者不存在' });

    const adminToken = req.headers.authorization.split(' ')[1];
    const newToken = uuidv4();
    await redis.setSession(newToken, {
      ...target,
      _impersonation: {
        original_user_id: req.user.id,
        original_username: req.user.username,
        original_token: adminToken,
        started_at: new Date().toISOString(),
      },
    }, false);

    await db.prepare(
      `INSERT INTO audit_logs (user_id, session_id, content, has_sensitive) VALUES (?, NULL, ?, 0)`
    ).run(
      target.id,
      JSON.stringify({
        action: 'impersonate_start',
        impersonated_by: req.user.id,
        impersonated_by_username: req.user.username,
      })
    );

    res.json({ token: newToken });
  } catch (e) {
    console.error('[impersonate] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/impersonate/exit — 退出模擬，切回原管理員 token
router.post('/impersonate/exit', verifyToken, async (req, res) => {
  try {
    const imp = req.user._impersonation;
    if (!imp) return res.status(400).json({ error: '不在模擬中' });

    const db = require('../database-oracle').db;
    await db.prepare(
      `INSERT INTO audit_logs (user_id, session_id, content, has_sensitive) VALUES (?, NULL, ?, 0)`
    ).run(
      req.user.id,
      JSON.stringify({ action: 'impersonate_end', impersonated_by: imp.original_user_id })
    );

    const currentToken = req.headers.authorization.split(' ')[1];
    await redis.delSession(currentToken);

    const originalSession = await redis.getSession(imp.original_token);
    if (!originalSession) return res.status(401).json({ error: '原管理員 session 已過期，請重新登入' });
    res.json({ token: imp.original_token });
  } catch (e) {
    console.error('[impersonate/exit] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/auth/impersonate/status — 前端查詢是否在模擬中
router.get('/impersonate/status', verifyToken, (req, res) => {
  const imp = req.user._impersonation;
  if (!imp) return res.json({ impersonating: false });
  res.json({
    impersonating: true,
    original_username: imp.original_username,
    target_username:   req.user.username,
    target_name:       req.user.name,
    started_at:        imp.started_at,
  });
});

module.exports = { router, verifyToken, verifyAdmin };
