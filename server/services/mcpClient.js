'use strict';

/**
 * MCP (Model Context Protocol) Client
 * Supports multiple transport types:
 *   - http-post        : Simple JSON-RPC POST (original)
 *   - http-sse         : GET /sse for SSE stream, POST /message for requests
 *   - streamable-http  : Single endpoint, response may be JSON or SSE stream (MCP 2025 spec)
 *   - stdio            : Spawn subprocess, communicate via stdin/stdout JSON-RPC
 *   - auto             : Try transports in order until one works
 */

const { spawn } = require('child_process');

let _reqId = 1;

const INIT_PARAMS = {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'FOXLINK-GPT', version: '1.0' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAuthHeaders(apiKey) {
  const h = {};
  if (apiKey) h['Authorization'] = `Bearer ${apiKey}`;
  return h;
}

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

async function httpPostRpc(url, apiKey, method, params = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...makeAuthHeaders(apiKey) },
    body: makeRpcBody(method, params),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (data.error) throw new Error(`MCP error [${data.error.code}]: ${data.error.message}`);
  return data.result;
}

async function withHttpPost(url, apiKey, fn) {
  // initialize is optional — ignore errors
  try { await httpPostRpc(url, apiKey, 'initialize', INIT_PARAMS); } catch (_) {}
  return fn((method, params) => httpPostRpc(url, apiKey, method, params));
}

// ── Transport: streamable-http ────────────────────────────────────────────────

async function streamableHttpRpc(url, apiKey, method, params = {}) {
  const body = makeRpcBody(method, params);
  const reqId = JSON.parse(body).id;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...makeAuthHeaders(apiKey),
    },
    body,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${res.statusText}`);

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    for await (const { data } of parseSseStream(res.body.getReader())) {
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
    const data = await res.json();
    if (data.error) throw new Error(`MCP error [${data.error.code}]: ${data.error.message}`);
    return data.result;
  }
}

async function withStreamableHttp(url, apiKey, fn) {
  try { await streamableHttpRpc(url, apiKey, 'initialize', INIT_PARAMS); } catch (_) {}
  return fn((method, params) => streamableHttpRpc(url, apiKey, method, params));
}

// ── Transport: http-sse ───────────────────────────────────────────────────────
// 1. GET sseUrl → SSE stream, server sends `endpoint` event with POST URL
// 2. POST requests to that endpoint URL
// 3. Responses arrive via SSE stream matched by request id

async function withHttpSse(sseUrl, apiKey, fn) {
  const controller = new AbortController();

  const sseRes = await fetch(sseUrl, {
    headers: { Accept: 'text/event-stream', ...makeAuthHeaders(apiKey) },
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
      headers: { 'Content-Type': 'application/json', ...makeAuthHeaders(apiKey) },
      body,
    });
    if (!postRes.ok) throw new Error(`MCP POST ${postRes.status}: ${postRes.statusText}`);

    return responsePromise;
  }

  try {
    try { await sseRpc('initialize', INIT_PARAMS); } catch (_) {}
    return await fn(sseRpc);
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

async function withStdio(command, argsExtra = [], envExtra = {}, fn) {
  const parts  = parseCommand(command);
  const cmd    = parts[0];
  const args   = [...parts.slice(1), ...argsExtra];
  const env    = { ...process.env, ...envExtra };

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
    try { await stdioRpc('initialize', INIT_PARAMS); } catch (_) {}
    return await fn(stdioRpc);
  } finally {
    try { proc.kill(); } catch (_) {}
  }
}

// ── Auto-detect ───────────────────────────────────────────────────────────────
// Tries transports in order and updates server.transport_type in DB on success

async function withAutoDetect(db, server, fn) {
  const url    = server.url;
  const apiKey = server.api_key;
  const isSSEUrl = /\/sse\b/.test(url);

  const attempts = isSSEUrl
    ? ['http-sse', 'streamable-http', 'http-post']
    : ['streamable-http', 'http-post', 'http-sse'];

  let lastErr;
  for (const transport of attempts) {
    try {
      let result;
      if (transport === 'http-post') {
        result = await withHttpPost(url, apiKey, fn);
      } else if (transport === 'streamable-http') {
        result = await withStreamableHttp(url, apiKey, fn);
      } else {
        result = await withHttpSse(url, apiKey, fn);
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

async function withSession(db, server, fn) {
  const t = getTransport(server);
  const url    = server.url;
  const apiKey = server.api_key;

  if (t === 'auto')             return withAutoDetect(db, server, fn);
  if (t === 'http-sse')         return withHttpSse(url, apiKey, fn);
  if (t === 'streamable-http')  return withStreamableHttp(url, apiKey, fn);
  if (t === 'stdio') {
    const args = server.args_json ? JSON.parse(server.args_json) : [];
    const env  = server.env_json  ? JSON.parse(server.env_json)  : {};
    return withStdio(server.command || url, args, env, fn);
  }
  // default: http-post
  return withHttpPost(url, apiKey, fn);
}

// ── Public API ────────────────────────────────────────────────────────────────

async function listTools(db, server) {
  const tools = await withSession(db, server, async (rpc) => {
    const result = await rpc('tools/list', {});
    return result.tools || [];
  });

  await db.prepare(
    `UPDATE mcp_servers SET tools_json=?, last_synced_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP WHERE id=?`
  ).run(JSON.stringify(tools), server.id);

  return tools;
}

async function callTool(db, server, sessionId, userId, toolName, args) {
  const startMs = Date.now();
  let status = 'ok';
  let errorMsg = null;
  let responsePreview = null;
  let resultContent = null;

  try {
    const result = await withSession(db, server, (rpc) =>
      rpc('tools/call', { name: toolName, arguments: args })
    );

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
        (server_id, session_id, user_id, tool_name, arguments_json, response_preview, status, error_msg, duration_ms, called_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, SYSTIMESTAMP)`
    ).run(
      server.id, sessionId || null, userId || null, toolName,
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
  }

  const result = { functionDeclarations, serverMap };
  _mcpDeclCache.set(ck, { data: result, ts: Date.now() });
  return result;
}

module.exports = { listTools, callTool, getActiveToolDeclarations };
