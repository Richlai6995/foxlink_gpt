'use strict';

/**
 * MCP (Model Context Protocol) Client
 * Supports multiple transport types:
 *   - http-post        : Simple JSON-RPC POST (original)
 *   - http-sse         : GET /sse for SSE stream, POST /message for requests
 *   - streamable-http  : Single endpoint, response may be JSON or SSE stream (MCP 2025 spec)
 *   - stdio            : Spawn subprocess, communicate via stdin/stdout JSON-RPC
 *   - auto             : Try transports in order until one works
 *
 * User Identity (RS256 JWT in X-User-Token header)
 *   See docs/mcp-user-identity-auth.md
 *   per-server 開關: mcp_servers.send_user_token = 1
 */

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const fs  = require('fs');
const jwt = require('jsonwebtoken');
const axios = require('axios');

let _reqId = 1;

const INIT_PARAMS = {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'FOXLINK-GPT', version: '1.0' },
};

// ── JWT private key: lazy-load once, warn (not crash) if missing ─────────────

let _privateKey = null;
let _privateKeyLoaded = false;
function getPrivateKey() {
  if (_privateKeyLoaded) return _privateKey;
  _privateKeyLoaded = true;

  const keyPath = process.env.MCP_JWT_PRIVATE_KEY_PATH;
  if (!keyPath) {
    console.warn('[mcp-jwt] MCP_JWT_PRIVATE_KEY_PATH not set — X-User-Token disabled (send_user_token=1 servers will throw at runtime)');
    return null;
  }
  try {
    _privateKey = fs.readFileSync(keyPath, 'utf8');
    console.error('[mcp-jwt] private key loaded from', keyPath);
  } catch (e) {
    console.warn(`[mcp-jwt] failed to load private key from ${keyPath}: ${e.message} — X-User-Token disabled`);
  }
  return _privateKey;
}

/** Sign an RS256 JWT for the given user ctx. Throws on missing email / private key. */
function signUserToken(userCtx) {
  if (!userCtx?.email) {
    const err = new Error('MCP_JWT_EMAIL_REQUIRED: user has no email but MCP requires X-User-Token');
    err.code = 'MCP_JWT_EMAIL_REQUIRED';
    throw err;
  }
  const privateKey = getPrivateKey();
  if (!privateKey) {
    const err = new Error('MCP_JWT_PRIVATE_KEY_NOT_CONFIGURED: send_user_token=1 but private key not loaded — set MCP_JWT_PRIVATE_KEY_PATH');
    err.code = 'MCP_JWT_PRIVATE_KEY_NOT_CONFIGURED';
    throw err;
  }
  const jti = randomUUID();
  const token = jwt.sign(
    {
      jti,
      sub:   String(userCtx.employee_id || userCtx.id),
      email: userCtx.email,
      name:  userCtx.name || null,
      dept:  userCtx.dept_code || null,
    },
    privateKey,
    { algorithm: 'RS256', expiresIn: '5m', issuer: 'foxlink-gpt' }
  );
  return { token, jti };
}

/**
 * Prepare auth context for a single MCP session.
 * - api_key → Layer 1 (service identity)
 * - server.send_user_token=1 AND userCtx given → Layer 2 (sign RS256 JWT)
 * - send_user_token=1 but no userCtx → do NOT sign (e.g. tools/list is service-level)
 */
function prepareAuthCtx(server, userCtx) {
  const ctx = { apiKey: server.api_key || null, userToken: null, jti: null };
  const wantsUserToken = server.send_user_token === 1 || server.send_user_token === true;
  if (wantsUserToken && userCtx) {
    const signed = signUserToken(userCtx);
    ctx.userToken = signed.token;
    ctx.jti = signed.jti;
  }
  return ctx;
}

function makeAuthHeaders(authCtx) {
  const h = {};
  if (authCtx?.apiKey)    h['Authorization']   = `Bearer ${authCtx.apiKey}`;
  if (authCtx?.userToken) h['X-User-Token']    = authCtx.userToken;
  return h;
}

// Eager-load on module init so startup logs surface immediately
getPrivateKey();

function makeRpcBody(method, params) {
  return JSON.stringify({ jsonrpc: '2.0', id: _reqId++, method, params });
}

/** Parse SSE text stream → yield { event, data } objects */
async function* parseSseStream(reader) {
  const decoder = new TextDecoder();
  let buf = '';
  let eventType = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        yield { event: eventType || 'message', data: line.slice(5).trim() };
        eventType = '';
      } else if (line === '') {
        eventType = '';
      }
    }
  }
}

// ── Transport: http-post ──────────────────────────────────────────────────────

async function httpPostRpc(url, authCtx, method, params = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...makeAuthHeaders(authCtx) },
    body: makeRpcBody(method, params),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (data.error) throw new Error(`MCP error [${data.error.code}]: ${data.error.message}`);
  return data.result;
}

async function withHttpPost(url, authCtx, fn) {
  // initialize is optional — ignore errors. 保留 result.instructions(MCP ServerInstructions)
  let initResult = null;
  try { initResult = await httpPostRpc(url, authCtx, 'initialize', INIT_PARAMS); } catch (_) {}
  return fn((method, params) => httpPostRpc(url, authCtx, method, params), initResult);
}

// ── Transport: streamable-http ────────────────────────────────────────────────
// MCP 2025 規範支援 Mcp-Session-Id:server 在 initialize 回應 header 夾帶 session id,
// 後續所有 RPC 必須在 request header 帶上同一個 id,否則被判為未初始化連線。
// 部分 MCP server(如 HRToolsMCP)會嚴格強制;寬鬆的 server 會忽略缺失 session。

/** Parse SSE stream from a Node.js Readable (axios responseType: 'stream') */
async function* parseSseFromNodeStream(stream) {
  const decoder = new TextDecoder();
  let buf = '';
  let eventType = '';
  for await (const chunk of stream) {
    buf += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      else if (line.startsWith('data:')) { yield { event: eventType || 'message', data: line.slice(5).trim() }; eventType = ''; }
      else if (line === '') eventType = '';
    }
  }
}

// Note: 這裡用 axios 而非 fetch — Node fetch (undici) 依 WHATWG spec 封鎖 port
// 5060/5061/6000 等「bad ports」,而有些企業 MCP server 會用這些 port。axios 不受限。
async function streamableHttpRpc(url, authCtx, method, params = {}, sessionRef = null) {
  const body = makeRpcBody(method, params);
  const reqId = JSON.parse(body).id;

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    ...makeAuthHeaders(authCtx),
  };
  if (sessionRef?.id) headers['Mcp-Session-Id'] = sessionRef.id;

  const res = await axios.post(url, body, {
    headers,
    timeout: 60000,
    responseType: 'stream',
    validateStatus: () => true,  // 自己處理非 2xx
  });
  if (res.status < 200 || res.status >= 300) {
    // 為了印出錯誤訊息,從 stream 讀完 body
    let errBody = '';
    for await (const c of res.data) errBody += c.toString();
    throw new Error(`MCP HTTP ${res.status}: ${errBody || res.statusText}`);
  }

  // 抓 server 回傳的 session id(通常只有 initialize 回應會帶)
  if (sessionRef) {
    const sid = res.headers['mcp-session-id'];
    if (sid && !sessionRef.id) sessionRef.id = sid;
  }

  const ct = res.headers['content-type'] || '';
  if (ct.includes('text/event-stream')) {
    for await (const { data } of parseSseFromNodeStream(res.data)) {
      try {
        const msg = JSON.parse(data);
        if (msg.id === reqId) {
          if (msg.error) throw new Error(`MCP error [${msg.error.code}]: ${msg.error.message}`);
          return msg.result;
        }
      } catch (_) {}
    }
    throw new Error('Streamable HTTP: no matching response in SSE stream');
  } else {
    // 非 SSE,一次把 body 讀完再 parse
    let buf = '';
    for await (const c of res.data) buf += c.toString();
    const data = JSON.parse(buf);
    if (data.error) throw new Error(`MCP error [${data.error.code}]: ${data.error.message}`);
    return data.result;
  }
}

async function withStreamableHttp(url, authCtx, fn) {
  // sessionRef 是可變容器:initialize 會寫入 id,後續 RPC 讀它帶進 header
  const sessionRef = { id: null };
  let initResult = null;
  try { initResult = await streamableHttpRpc(url, authCtx, 'initialize', INIT_PARAMS, sessionRef); } catch (_) {}
  return fn((method, params) => streamableHttpRpc(url, authCtx, method, params, sessionRef), initResult);
}

// ── Transport: http-sse ───────────────────────────────────────────────────────
// 1. GET sseUrl → SSE stream, server sends `endpoint` event with POST URL
// 2. POST requests to that endpoint URL
// 3. Responses arrive via SSE stream matched by request id

async function withHttpSse(sseUrl, authCtx, fn) {
  const controller = new AbortController();

  const sseRes = await fetch(sseUrl, {
    headers: { Accept: 'text/event-stream', ...makeAuthHeaders(authCtx) },
    signal: controller.signal,
  });
  if (!sseRes.ok) throw new Error(`MCP SSE ${sseRes.status}: ${sseRes.statusText}`);

  const pending = new Map(); // reqId → { resolve, reject }
  let postUrl = null;
  let postUrlResolve;
  const postUrlReady = new Promise(r => { postUrlResolve = r; });

  // Background SSE reader
  (async () => {
    try {
      for await (const { event, data } of parseSseStream(sseRes.body.getReader())) {
        if (event === 'endpoint') {
          let ep = data;
          if (ep.startsWith('/')) {
            const base = new URL(sseUrl);
            ep = `${base.protocol}//${base.host}${ep}`;
          }
          postUrl = ep;
          postUrlResolve(ep);
        } else {
          try {
            const msg = JSON.parse(data);
            if (msg.id !== undefined && pending.has(msg.id)) {
              const { resolve, reject } = pending.get(msg.id);
              pending.delete(msg.id);
              if (msg.error) reject(new Error(`MCP error [${msg.error.code}]: ${msg.error.message}`));
              else resolve(msg.result);
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
    for (const { reject } of pending.values()) reject(new Error('SSE stream closed'));
  })();

  // Wait for endpoint (max 10s)
  await Promise.race([
    postUrlReady,
    new Promise((_, rej) => setTimeout(() => rej(new Error('SSE: no endpoint event within 10s')), 10000)),
  ]);

  async function sseRpc(method, params = {}) {
    const body = makeRpcBody(method, params);
    const reqId = JSON.parse(body).id;

    const responsePromise = new Promise((resolve, reject) => {
      pending.set(reqId, { resolve, reject });
      setTimeout(() => {
        if (pending.has(reqId)) { pending.delete(reqId); reject(new Error('MCP SSE request timeout')); }
      }, 60000);
    });

    const postRes = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...makeAuthHeaders(authCtx) },
      body,
    });
    if (!postRes.ok) throw new Error(`MCP POST ${postRes.status}: ${postRes.statusText}`);

    return responsePromise;
  }

  try {
    let initResult = null;
    try { initResult = await sseRpc('initialize', INIT_PARAMS); } catch (_) {}
    return await fn(sseRpc, initResult);
  } finally {
    controller.abort();
  }
}

// ── Transport: stdio ──────────────────────────────────────────────────────────

function parseCommand(commandStr) {
  // Simple shell-like split: respect quoted strings
  const parts = [];
  let current = '';
  let inQuote = null;
  for (const ch of commandStr) {
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ' ') {
      if (current) { parts.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

async function withStdio(command, argsExtra = [], envExtra = {}, authCtx, fn) {
  const parts  = parseCommand(command);
  const cmd    = parts[0];
  const args   = [...parts.slice(1), ...argsExtra];
  // stdio MCP has no HTTP headers — inject auth via env vars instead.
  // Token is signed ONCE per spawn; stdio process must be short-lived (per-call)
  // because env vars are immutable after spawn and JWT exp = 5min. See §3.3.
  const extraEnv = {};
  if (authCtx?.apiKey)    extraEnv.MCP_API_KEY    = authCtx.apiKey;
  if (authCtx?.userToken) extraEnv.MCP_USER_TOKEN = authCtx.userToken;
  const env = { ...process.env, ...envExtra, ...extraEnv };

  let proc;
  try {
    proc = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`MCP spawn failed: ${e.message} (cmd=${cmd})`);
  }

  const pending = new Map();
  let spawnErr = null;
  let stderrBuf = '';
  let buf = '';

  const failAllPending = (err) => {
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  };

  proc.on('error', (e) => {
    spawnErr = new Error(`MCP spawn error: ${e.code || ''} ${e.message} (cmd=${cmd})`);
    console.error('[MCP stdio spawn]', spawnErr.message);
    failAllPending(spawnErr);
  });

  proc.on('exit', (code, sig) => {
    if (code !== 0 || sig) {
      const tail = stderrBuf.trim().slice(-500);
      const err = new Error(`MCP process exited code=${code} sig=${sig}${tail ? `; stderr: ${tail}` : ''}`);
      if (!spawnErr) spawnErr = err;
      failAllPending(err);
    }
  });

  proc.stdout.on('data', chunk => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) reject(new Error(`MCP error [${msg.error.code}]: ${msg.error.message}`));
          else resolve(msg.result);
        }
      } catch (_) {}
    }
  });

  proc.stderr.on('data', d => {
    const s = d.toString();
    stderrBuf += s;
    if (stderrBuf.length > 4000) stderrBuf = stderrBuf.slice(-4000);
    console.error('[MCP stdio stderr]', s.trim());
  });

  async function stdioRpc(method, params = {}) {
    if (spawnErr) throw spawnErr;
    const body = makeRpcBody(method, params);
    const reqId = JSON.parse(body).id;
    const responsePromise = new Promise((resolve, reject) => {
      pending.set(reqId, { resolve, reject });
      setTimeout(() => {
        if (pending.has(reqId)) { pending.delete(reqId); reject(new Error('MCP stdio timeout')); }
      }, 60000);
    });
    try {
      proc.stdin.write(body + '\n');
    } catch (e) {
      pending.delete(reqId);
      throw new Error(`MCP stdin write failed: ${e.message}`);
    }
    return responsePromise;
  }

  try {
    let initResult = null;
    try { initResult = await stdioRpc('initialize', INIT_PARAMS); } catch (_) {}
    return await fn(stdioRpc, initResult);
  } finally {
    try { proc.kill(); } catch (_) {}
  }
}

// ── Auto-detect ───────────────────────────────────────────────────────────────
// Tries transports in order and updates server.transport_type in DB on success

async function withAutoDetect(db, server, authCtx, fn) {
  const url    = server.url;
  const isSSEUrl = /\/sse\b/.test(url);

  const attempts = isSSEUrl
    ? ['http-sse', 'streamable-http', 'http-post']
    : ['streamable-http', 'http-post', 'http-sse'];

  let lastErr;
  for (const transport of attempts) {
    try {
      let result;
      if (transport === 'http-post') {
        result = await withHttpPost(url, authCtx, fn);
      } else if (transport === 'streamable-http') {
        result = await withStreamableHttp(url, authCtx, fn);
      } else {
        result = await withHttpSse(url, authCtx, fn);
      }
      // Success — persist detected transport
      if (db && server.id) {
        try {
          await db.prepare(
            `UPDATE mcp_servers SET transport_type=?, updated_at=SYSTIMESTAMP WHERE id=?`
          ).run(transport, server.id);
        } catch (_) {}
      }
      console.log(`[MCP auto] ${server.name}: detected transport=${transport}`);
      return result;
    } catch (e) {
      console.warn(`[MCP auto] ${server.name}: ${transport} failed — ${e.message}`);
      lastErr = e;
    }
  }
  throw lastErr || new Error('All MCP transport attempts failed');
}

// ── Session dispatcher ────────────────────────────────────────────────────────

function getTransport(server) {
  return (server.transport_type || 'http-post').toLowerCase();
}

/**
 * @param {object}      db        Oracle wrapper
 * @param {object}      server    mcp_servers row
 * @param {function}    fn        async (rpc) => result
 * @param {object|null} authCtx   from prepareAuthCtx(server, userCtx); null = service-level (no user token)
 */
async function withSession(db, server, fn, authCtx = null) {
  // Fallback: if caller didn't prepare authCtx (e.g. listTools sync path), build service-level one
  const ctx = authCtx || prepareAuthCtx(server, null);
  const t = getTransport(server);
  const url = server.url;

  if (t === 'auto')            return withAutoDetect(db, server, ctx, fn);
  if (t === 'http-sse')        return withHttpSse(url, ctx, fn);
  if (t === 'streamable-http') return withStreamableHttp(url, ctx, fn);
  if (t === 'stdio') {
    const args = server.args_json ? JSON.parse(server.args_json) : [];
    const env  = server.env_json  ? JSON.parse(server.env_json)  : {};
    return withStdio(server.command || url, args, env, ctx, fn);
  }
  // default: http-post
  return withHttpPost(url, ctx, fn);
}

// ── Public API ────────────────────────────────────────────────────────────────

async function listTools(db, server) {
  // 同時抓 tools/list 與 initialize 回傳的 ServerInstructions(放在第 2 個 arg)
  const { tools, instructions } = await withSession(db, server, async (rpc, initResult) => {
    const result = await rpc('tools/list', {});
    const instr = (initResult && typeof initResult.instructions === 'string')
      ? initResult.instructions.trim()
      : '';
    return { tools: result.tools || [], instructions: instr };
  });

  await db.prepare(
    `UPDATE mcp_servers
       SET tools_json=?, server_instructions=?, last_synced_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
     WHERE id=?`
  ).run(JSON.stringify(tools), instructions || null, server.id);

  return tools;
}

/**
 * @param {object|null} userCtx { id, email, name, employee_id, dept_code }
 *   Required when server.send_user_token=1. Pass null only for service-level calls.
 */
async function callTool(db, server, sessionId, userId, toolName, args, userCtx = null) {
  const startMs = Date.now();
  let status = 'ok';
  let errorMsg = null;
  let responsePreview = null;
  let resultContent = null;
  let authCtx = null;

  try {
    // Sign up-front so we have jti for logging even if the RPC fails
    authCtx = prepareAuthCtx(server, userCtx);

    const result = await withSession(db, server, (rpc) =>
      rpc('tools/call', { name: toolName, arguments: args })
    , authCtx);

    const content = result.content || [];
    const textParts = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    resultContent = textParts || JSON.stringify(result);
    responsePreview = resultContent.slice(0, 500);
    if (result.isError) { status = 'error'; errorMsg = responsePreview; }
  } catch (e) {
    status = 'error';
    errorMsg = e.message;
    resultContent = `[MCP tool error: ${e.message}]`;
  }

  const durationMs = Date.now() - startMs;

  try {
    await db.prepare(
      `INSERT INTO mcp_call_logs
        (server_id, session_id, user_id, user_email, jti, tool_name, arguments_json, response_preview, status, error_msg, duration_ms, called_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, SYSTIMESTAMP)`
    ).run(
      server.id, sessionId || null, userId || null,
      userCtx?.email || null, authCtx?.jti || null,
      toolName,
      JSON.stringify(args), responsePreview, status, errorMsg, durationMs,
    );
  } catch (logErr) {
    console.error('[MCP] callTool log error:', logErr.message);
  }

  return resultContent;
}

// ── Short-term cache for tool declarations (30s TTL) ────────────────────────
const _mcpDeclCache = new Map();
const _MCP_CACHE_TTL = 30_000;
function _mcpCacheKey(ctx) {
  if (!ctx) return 'null';
  return `${ctx.userId || ''}:${ctx.roleId || ''}:${ctx.deptCode || ''}`;
}

/**
 * @param {object|null} userCtx  null = all servers；否則傳 { userId, roleId, deptCode, profitCenter, orgSection, orgGroupName }
 */
async function getActiveToolDeclarations(db, userCtx = null) {
  const ck = _mcpCacheKey(userCtx);
  const cached = _mcpDeclCache.get(ck);
  if (cached && Date.now() - cached.ts < _MCP_CACHE_TTL) return cached.data;

  let servers;
  try {
    if (!userCtx) {
      servers = await db.prepare(`SELECT * FROM mcp_servers WHERE is_active=1`).all();
    } else {
      const { userId, roleId, deptCode, profitCenter, orgSection, orgGroupName, factoryCode } = userCtx;
      servers = await db.prepare(
        `SELECT DISTINCT m.* FROM mcp_servers m
         WHERE m.is_active=1 AND (
           (m.is_public=1 AND m.public_approved=1)
           OR EXISTS (
             SELECT 1 FROM mcp_access a WHERE a.mcp_server_id = m.id AND (
               (a.grantee_type='user'        AND a.grantee_id=TO_CHAR(?))
               OR (a.grantee_type='role'     AND a.grantee_id=TO_CHAR(?) AND ? IS NOT NULL)
               OR (a.grantee_type='department'  AND a.grantee_id=? AND ? IS NOT NULL)
               OR (a.grantee_type='cost_center' AND a.grantee_id=? AND ? IS NOT NULL)
               OR (a.grantee_type='division'    AND a.grantee_id=? AND ? IS NOT NULL)
               OR (a.grantee_type='factory'     AND a.grantee_id=? AND ? IS NOT NULL)
               OR (a.grantee_type='org_group'   AND a.grantee_id=? AND ? IS NOT NULL)
             )
           )
         )`
      ).all(
        userId,
        roleId, roleId,
        deptCode, deptCode,
        profitCenter, profitCenter,
        orgSection, orgSection,
        factoryCode, factoryCode,
        orgGroupName, orgGroupName
      );
    }
  } catch (e) {
    console.error('[MCP] getActiveToolDeclarations error:', e.message);
    return { functionDeclarations: [], serverMap: {} };
  }

  const functionDeclarations = [];
  const serverMap = {};
  // serverId → { name, instructions } — 只收錄真的有 instructions 的 server,
  // 呼叫端在 chat 組 systemInstruction 時會依哪些 tool 被納入 allDeclarations 篩選
  const serverInstructionsMap = {};

  for (const server of servers) {
    if (!server.tools_json) continue;
    let tools;
    try { tools = JSON.parse(server.tools_json); } catch (_) { continue; }

    for (const tool of tools) {
      if (!tool.name) continue;
      const safeName = tool.name.replace(/[^a-zA-Z0-9_]/g, '_');
      functionDeclarations.push({
        name: safeName,
        description: tool.description || tool.name,
        parameters: tool.inputSchema || { type: 'object', properties: {} },
      });
      serverMap[safeName] = { server, originalName: tool.name };
    }

    const instr = (server.server_instructions || '').toString().trim();
    if (instr) {
      serverInstructionsMap[server.id] = {
        name: server.name_zh || server.name || `MCP#${server.id}`,
        instructions: instr,
      };
    }
  }

  const result = { functionDeclarations, serverMap, serverInstructionsMap };
  _mcpDeclCache.set(ck, { data: result, ts: Date.now() });
  return result;
}

// ── Public-key helpers (for admin endpoints in routes/mcpServers.js) ─────────

function getPublicKey() {
  const keyPath = process.env.MCP_JWT_PUBLIC_KEY_PATH;
  if (!keyPath) return null;
  try { return fs.readFileSync(keyPath, 'utf8'); }
  catch (e) {
    console.warn(`[mcp-jwt] failed to read public key from ${keyPath}: ${e.message}`);
    return null;
  }
}

/** Verify a token with the public key. Returns decoded claims or throws. */
function verifyUserToken(token) {
  const pub = getPublicKey();
  if (!pub) {
    const err = new Error('MCP_JWT_PUBLIC_KEY_NOT_CONFIGURED: set MCP_JWT_PUBLIC_KEY_PATH');
    err.code = 'MCP_JWT_PUBLIC_KEY_NOT_CONFIGURED';
    throw err;
  }
  return jwt.verify(token, pub, {
    algorithms: ['RS256'],
    issuer: 'foxlink-gpt',
    clockTolerance: 30,
  });
}

/**
 * 依據實際被納入 LLM 的 tool,挑出對應 MCP server 的 instructions 段落拼成 systemInstruction。
 * serverMap: { safeToolName → { server, originalName } } — 來自 getActiveToolDeclarations
 * usedToolNames: Iterable<string> — 被加到 allDeclarations 的 safeToolName(chat.js 端的 final list)
 * serverInstructionsMap: { serverId → { name, instructions } }
 * @returns {string} 可能為空字串
 */
function buildMcpSystemInstructions(serverMap, usedToolNames, serverInstructionsMap) {
  if (!serverInstructionsMap || Object.keys(serverInstructionsMap).length === 0) return '';
  const usedServerIds = new Set();
  for (const tn of usedToolNames) {
    const entry = serverMap?.[tn];
    if (entry?.server?.id != null) usedServerIds.add(entry.server.id);
  }
  if (usedServerIds.size === 0) return '';

  const blocks = [];
  for (const sid of usedServerIds) {
    const entry = serverInstructionsMap[sid];
    if (!entry) continue;
    // 截長保護:單一 server 指示 > 4000 字顯然是配錯,截到 4000
    const body = entry.instructions.length > 4000
      ? entry.instructions.slice(0, 4000) + '…(truncated)'
      : entry.instructions;
    blocks.push(`【${entry.name} 使用規則】\n${body}`);
  }
  return blocks.join('\n\n---\n\n');
}

module.exports = {
  listTools,
  callTool,
  getActiveToolDeclarations,
  buildMcpSystemInstructions,
  // exposed for Admin API (Phase 2) and CLI script (Phase 4):
  signUserToken,
  verifyUserToken,
  getPublicKey,
};
