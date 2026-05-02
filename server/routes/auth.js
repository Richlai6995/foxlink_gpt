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
const mfa = require('../services/webexMfaService');
const { logAuthEventAsync } = require('../services/authAuditLog');
const throttle = require('../services/authThrottle');
const { isRequestInternal, getClientIp } = require('../middleware/accessControl');

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

    // 3. MFA gate(內網直接 redirect token,外網走 OTP DM 流程)
    return await proceedOrChallenge({ req, res, user: dbUser, source: 'sso', mode: 'redirect' });
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
            return await proceedOrChallenge({ req, res, user: dbUser, source: 'ldap', mode: 'json' });
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
            return await proceedOrChallenge({ req, res, user: newUser, source: 'ldap-firstlogin', mode: 'json' });
          }
        }
      } catch (ldapErr) {
        console.log('[Auth] LDAP failed, fallback to local DB:', ldapErr.type || ldapErr.message);
      }
    }

    // Local DB fallback (case-insensitive username)
    const user = await db.prepare('SELECT * FROM users WHERE UPPER(username) = UPPER(?) AND password = ?').get(username, password);
    const auditCtx = { ip: getClientIp(req), user_agent: (req.headers['user-agent'] || '').slice(0, 512) };
    if (!user) {
      logAuthEventAsync(db, {
        username, event_type: 'login_failed_credentials',
        ...auditCtx, success: 0, error_msg: 'invalid credentials',
      });
      throttle.countAuthFailureAsync({
        username, ip: auditCtx.ip, ua: auditCtx.user_agent,
        eventType: 'login_failed_credentials',
      });
      return res.status(401).json({ error: '帳號或密碼錯誤' });
    }
    if (user.role !== 'admin' && user.status !== 'active') {
      logAuthEventAsync(db, {
        user_id: user.id, username: user.username,
        event_type: 'login_failed_account_disabled',
        ...auditCtx, success: 0, error_msg: 'status != active',
      });
      return res.status(403).json({ error: '帳號失效，請聯絡系統管理員' });
    }
    const now = new Date();
    if (user.start_date && new Date(user.start_date) > now) {
      logAuthEventAsync(db, {
        user_id: user.id, username: user.username,
        event_type: 'login_failed_account_disabled',
        ...auditCtx, success: 0, error_msg: 'start_date in future',
      });
      return res.status(403).json({ error: '帳號尚未生效' });
    }
    if (user.end_date && new Date(user.end_date) < now) {
      logAuthEventAsync(db, {
        user_id: user.id, username: user.username,
        event_type: 'login_failed_account_disabled',
        ...auditCtx, success: 0, error_msg: 'end_date passed',
      });
      return res.status(403).json({ error: '帳號已過期' });
    }
    return await proceedOrChallenge({ req, res, user, source: 'local', mode: 'json' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ── MFA gate ──────────────────────────────────────────────────────────
// 三條 login path(LDAP / SSO / local)都先呼這個,內網 / trusted IP / 關閉 MFA
// 直接通過,否則建 challenge → 回前端 OTP 輸入畫面
const proceedOrChallenge = async ({ req, res, user, source, mode }) => {
  const ip = getClientIp(req);
  const ua = (req.headers['user-agent'] || '').slice(0, 512);
  const internal = isRequestInternal(req);
  const baseUrl = process.env.APP_BASE_URL || '';
  const db = require('../database-oracle').db;
  const c = mfa.cfg();

  const redirectError = (msg) =>
    res.redirect(`${baseUrl}/login?sso_error=${encodeURIComponent(msg)}`);

  // 1. 內網 / MFA 全域關閉 → 直接登入
  if (internal || !c.enabled) {
    logAuthEventAsync(db, {
      user_id: user.id, username: user.username,
      event_type: internal ? 'login_success_internal' : 'login_success_external_mfa_disabled',
      ip, user_agent: ua, success: 1, metadata: { source },
    });
    return mode === 'redirect'
      ? createSessionAndRedirect(res, user)
      : createSession(res, user);
  }

  // 2. 外網 — admin role 一律拒絕(政策:admin 只能從內網,降低帳號被釣後的影響面)
  if (user.role === 'admin') {
    logAuthEventAsync(db, {
      user_id: user.id, username: user.username,
      event_type: 'login_failed_admin_external',
      ip, user_agent: ua, success: 0, error_msg: 'admin role rejected on external network',
      metadata: { source },
    });
    // admin 帳號被嘗試外網登入 = 高度可疑,計入 alert(已用真 user_id,優先觸發告警)
    throttle.countAuthFailureAsync({
      userId: user.id, username: user.username, ip, ua,
      eventType: 'login_failed_admin_external',
    });
    const msg = '管理員帳號不允許從外網登入,請使用公司內網或 VPN';
    return mode === 'redirect' ? redirectError(msg) : res.status(403).json({ error: msg });
  }

  // 3. 外網 — 沒 email 拒絕(政策:外網必須有 email 走 Webex MFA)
  if (!user.email) {
    logAuthEventAsync(db, {
      user_id: user.id, username: user.username,
      event_type: 'login_failed_no_email',
      ip, user_agent: ua, success: 0, error_msg: 'no email for external login',
      metadata: { source },
    });
    const msg = '此帳號未設定 Email,請從公司內網登入或聯絡管理員';
    return mode === 'redirect' ? redirectError(msg) : res.status(403).json({ error: msg });
  }

  // 3. 外網 — admin 對該 user 關了 MFA(逃生門,正常情況不會走到)
  if (user.webex_mfa_enabled === 0) {
    logAuthEventAsync(db, {
      user_id: user.id, username: user.username,
      event_type: 'login_success_external_mfa_disabled',
      ip, user_agent: ua, success: 1, metadata: { source, reason: 'user_mfa_disabled' },
    });
    return mode === 'redirect'
      ? createSessionAndRedirect(res, user)
      : createSession(res, user);
  }

  // 4. 外網 — IP 已通過 MFA 信任(/32 嚴格)→ 跳過 MFA
  if (await mfa.isTrustedIp(db, user.id, ip)) {
    await mfa.touchTrustedIp(db, user.id, ip);
    logAuthEventAsync(db, {
      user_id: user.id, username: user.username,
      event_type: 'login_success_external_skip_mfa',
      ip, user_agent: ua, success: 1, metadata: { source },
    });
    return mode === 'redirect'
      ? createSessionAndRedirect(res, user)
      : createSession(res, user);
  }

  // 5. 確認 Webex 有此 email 對應 person(LDAP/SSO email ≠ Webex email 時擋下,不發 DM)
  const personId = await mfa.ensureWebexPerson(db, user);
  if (!personId) {
    logAuthEventAsync(db, {
      user_id: user.id, username: user.username,
      event_type: 'mfa_webex_person_not_found',
      ip, user_agent: ua, success: 0, error_msg: 'webex person lookup failed',
      metadata: { source, email: user.email },
    });
    const msg = '無法在 Webex 找到此 Email 對應帳號,請聯絡資訊部檢查';
    return mode === 'redirect' ? redirectError(msg) : res.status(403).json({ error: msg });
  }

  // 6. 建 challenge
  const challenge = await mfa.createChallenge({
    userId: user.id, email: user.email, ip, userAgent: ua,
  });
  if (challenge.rateLimited) {
    logAuthEventAsync(db, {
      user_id: user.id, username: user.username,
      event_type: 'mfa_rate_limited',
      ip, user_agent: ua, success: 0, error_msg: 'rate limit exceeded',
      metadata: { source },
    });
    const msg = '驗證碼發送過於頻繁,請稍後再試';
    return mode === 'redirect' ? redirectError(msg) : res.status(429).json({ error: msg });
  }

  // 7. 發 DM(失敗 hard error,不放行)
  try {
    const lang = user.preferred_language || 'zh-TW';
    await mfa.sendOtpDM({ email: user.email, otp: challenge.otp, ip, lang });
    logAuthEventAsync(db, {
      user_id: user.id, username: user.username,
      event_type: 'mfa_challenge_created',
      ip, user_agent: ua, challenge_id: challenge.challengeId, success: 1,
      metadata: { source },
    });
  } catch (e) {
    logAuthEventAsync(db, {
      user_id: user.id, username: user.username,
      event_type: 'mfa_dm_failed',
      ip, user_agent: ua, challenge_id: challenge.challengeId, success: 0,
      error_msg: e.message, metadata: { source },
    });
    console.error(`[MFA] DM failed user=${user.id} email=${user.email}: ${e.message}`);
    const msg = `驗證碼發送失敗,請聯絡管理員(代碼:${challenge.incidentId})`;
    return mode === 'redirect' ? redirectError(msg) : res.status(500).json({
      error: msg, incident_id: challenge.incidentId,
    });
  }

  // 8. DM 成功 → 通知前端進 OTP 輸入步驟
  if (mode === 'redirect') {
    const params = new URLSearchParams({
      mfa_challenge: challenge.challengeId,
      masked_email: challenge.masked,
    });
    return res.redirect(`${baseUrl}/login?${params}`);
  }
  return res.json({
    require_2fa: true,
    challenge_id: challenge.challengeId,
    masked_email: challenge.masked,
  });
};

const createSessionAndRedirect = async (res, user) => {
  const db = require('../database-oracle').db;
  const sessionToken = uuidv4();
  const payload = await buildSessionPayload(db, user.id);
  await redis.setSession(sessionToken, payload, user.role === 'admin');
  const baseUrl = process.env.APP_BASE_URL || '';
  res.redirect(`${baseUrl}/login?sso_token=${sessionToken}`);
};

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

// POST /api/auth/2fa/verify — 拿 challenge_id + 6 位 OTP 換 session token
router.post('/2fa/verify', async (req, res) => {
  const { challenge_id, code } = req.body || {};
  const ip = getClientIp(req);
  const ua = (req.headers['user-agent'] || '').slice(0, 512);
  const db = require('../database-oracle').db;

  if (!mfa.isValidChallengeId(challenge_id) || !mfa.isValidOtpFormat(code)) {
    return res.status(400).json({ error: '參數格式錯誤' });
  }

  const result = await mfa.verifyChallenge(challenge_id, code);
  if (!result.ok) {
    if (result.reason === 'too_many') {
      logAuthEventAsync(db, {
        event_type: 'mfa_verify_too_many',
        ip, user_agent: ua, challenge_id, success: 0,
        error_msg: 'max attempts reached',
      });
      throttle.countAuthFailureAsync({ ip, ua, eventType: 'mfa_verify_too_many' });
      return res.status(429).json({ error: '錯誤次數過多,請重新登入', expired: true });
    }
    if (result.reason === 'not_found') {
      return res.status(400).json({ error: '驗證碼已過期,請重新登入', expired: true });
    }
    if (result.reason === 'invalid_format') {
      return res.status(400).json({ error: '驗證碼格式錯誤' });
    }
    // wrong_code
    logAuthEventAsync(db, {
      event_type: 'mfa_verify_failed',
      ip, user_agent: ua, challenge_id, success: 0,
      error_msg: 'wrong code',
      metadata: { attempts_left: result.attemptsLeft },
    });
    throttle.countAuthFailureAsync({ ip, ua, eventType: 'mfa_verify_failed' });
    return res.status(401).json({
      error: '驗證碼錯誤',
      attempts_left: result.attemptsLeft,
    });
  }

  // 通過 — 取最新 user 資料,寫 trusted IP,createSession
  try {
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(result.userId);
    if (!user) {
      return res.status(404).json({ error: '使用者不存在' });
    }
    if (user.role !== 'admin' && user.status !== 'active') {
      return res.status(403).json({ error: '帳號失效' });
    }
    // 新 IP 判斷必須在寫 trusted_ips 之前(寫了之後 audit log 會看到自己 → 永遠 false)
    const isNewIp = await throttle.isNewLoginIp(db, user.id, ip);
    await mfa.addTrustedIp(db, user.id, ip, ua);
    logAuthEventAsync(db, {
      user_id: user.id, username: user.username,
      event_type: 'mfa_trusted_ip_added',
      ip, user_agent: ua, challenge_id, success: 1,
    });
    logAuthEventAsync(db, {
      user_id: user.id, username: user.username,
      event_type: 'login_success_external_mfa',
      ip, user_agent: ua, challenge_id, success: 1,
      metadata: { new_ip: isNewIp },
    });
    // 新 IP DM 通知使用者(non-blocking)
    if (isNewIp && user.email) {
      const lang = user.preferred_language || 'zh-TW';
      mfa.sendNewLoginAlertDM({ email: user.email, ip, ua, lang }).catch(() => {});
    }
    return await createSession(res, user);
  } catch (e) {
    console.error('[MFA] verify createSession error:', e);
    return res.status(500).json({ error: '登入處理失敗' });
  }
});

// POST /api/auth/2fa/resend — 60s cooldown 內重發,**重產 OTP 覆蓋舊碼**
router.post('/2fa/resend', async (req, res) => {
  const { challenge_id } = req.body || {};
  const ip = getClientIp(req);
  const ua = (req.headers['user-agent'] || '').slice(0, 512);
  const db = require('../database-oracle').db;

  if (!mfa.isValidChallengeId(challenge_id)) {
    return res.status(400).json({ error: '參數格式錯誤' });
  }

  const r = await mfa.regenerateChallengeOtp(challenge_id);
  if (!r.ok) {
    if (r.reason === 'cooldown') {
      return res.status(429).json({ error: '請稍候再試', retry_in_sec: r.retryInSec });
    }
    if (r.reason === 'rate_limited') {
      return res.status(429).json({ error: '驗證碼發送過於頻繁,請稍後再試' });
    }
    if (r.reason === 'not_found') {
      return res.status(400).json({ error: '驗證碼已過期,請重新登入', expired: true });
    }
    return res.status(400).json({ error: '參數錯誤' });
  }

  // 撈 user 拿 email + lang,送 DM
  try {
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(r.userId);
    if (!user || !user.email) {
      return res.status(400).json({ error: '使用者狀態異常,請重新登入', expired: true });
    }
    const lang = user.preferred_language || 'zh-TW';
    await mfa.sendOtpDM({ email: user.email, otp: r.otp, ip: r.ip, lang });
    logAuthEventAsync(db, {
      user_id: user.id, username: user.username,
      event_type: 'mfa_resend',
      ip, user_agent: ua, challenge_id, success: 1,
    });
    return res.json({ ok: true });
  } catch (e) {
    logAuthEventAsync(db, {
      user_id: r.userId,
      event_type: 'mfa_dm_failed',
      ip, user_agent: ua, challenge_id, success: 0,
      error_msg: e.message, metadata: { phase: 'resend' },
    });
    console.error(`[MFA] resend DM failed challenge=${challenge_id}: ${e.message}`);
    const incident = mfa.shortIncidentId(challenge_id);
    return res.status(500).json({
      error: `驗證碼發送失敗,請聯絡管理員(代碼:${incident})`,
      incident_id: incident,
    });
  }
});

// POST /api/auth/forgot-password  (manual accounts only)
router.post('/forgot-password', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: '請輸入帳號' });
  // Rate limit 同 IP / 同 username 1 小時最多 N 次,防 SMTP 濫用 + 信箱垃圾
  const ip = getClientIp(req);
  const rate = await throttle.checkForgotPasswordRate(ip, username);
  if (!rate.allowed) {
    // 不洩漏細節,一律回標準訊息(同 user enumeration 防護),但 log 給 admin 看
    const db = require('../database-oracle').db;
    logAuthEventAsync(db, {
      username, event_type: 'forgot_password_rate_limited',
      ip, user_agent: (req.headers['user-agent'] || '').slice(0, 512),
      success: 0, error_msg: rate.reason,
    });
    return res.json({ message: '若帳號存在且已設定 Email，重置連結已寄出' });
  }
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

    // 密碼變更必清 trusted IPs(防舊密碼洩漏 + IP 已被信任的情況)
    const revokedIps = await mfa.revokeAllTrustedIps(db, record.user_id);
    // 並把所有現有 session 踢掉(reset 走的人沒有當前 session,全踢)
    const revokedSess = await redis.revokeAllUserSessions(record.user_id);
    if (revokedIps > 0 || revokedSess > 0) {
      logAuthEventAsync(db, {
        user_id: record.user_id,
        event_type: 'trusted_ip_revoked_password_change',
        ip: getClientIp(req), user_agent: (req.headers['user-agent'] || '').slice(0, 512),
        success: 1, metadata: { phase: 'reset', revoked_ips: revokedIps, revoked_sessions: revokedSess },
      });
    }

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
    // 密碼變更必清 trusted IPs(同 reset-password)
    const revokedIps = await mfa.revokeAllTrustedIps(db, user.id);
    // 踢掉所有現有 session,但保留當前 session(讓使用者改完密碼後不用重登)
    const revokedSess = await redis.revokeAllUserSessions(user.id, token);
    if (revokedIps > 0 || revokedSess > 0) {
      logAuthEventAsync(db, {
        user_id: user.id, username: user.username,
        event_type: 'trusted_ip_revoked_password_change',
        ip: getClientIp(req), user_agent: (req.headers['user-agent'] || '').slice(0, 512),
        success: 1, metadata: { phase: 'change', revoked_ips: revokedIps, revoked_sessions: revokedSess },
      });
    }
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

// PUT /api/auth/theme — self-service UI theme update
const VALID_THEMES = ['dark', 'dark-dimmed', 'light-blue', 'light-green', 'light-yellow'];
router.put('/theme', async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  const session = token ? await redis.getSession(token) : null;
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  req.user = session;
  next();
}, async (req, res) => {
  const { theme } = req.body;
  if (!VALID_THEMES.includes(theme)) {
    return res.status(400).json({ error: `不支援的主題，可用: ${VALID_THEMES.join(', ')}` });
  }
  try {
    const db = require('../database-oracle').db;
    await db.prepare('UPDATE users SET theme=? WHERE id=?').run(theme, req.user.id);
    res.json({ ok: true, theme });
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
    if (!imp) {
      const tk = (req.headers.authorization || '').split(' ')[1] || '';
      console.warn('[impersonate/exit] 拒絕:session 沒有 _impersonation。token=' + tk.slice(0, 8) + '..., user_id=' + req.user.id + ', username=' + req.user.username + ', role=' + req.user.role + '。可能成因:多分頁登入覆寫 token。');
      return res.status(400).json({ error: '不在模擬中' });
    }

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
