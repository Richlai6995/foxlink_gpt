#!/usr/bin/env node
/**
 * mock-mcp-server.js — 本地假 MCP server,用來驗證 FOXLINK GPT 簽發的 X-User-Token
 *
 * 用法:
 *   node server/scripts/mock-mcp-server.js [port]
 *
 * 然後在 FOXLINK GPT Admin UI 新增 MCP server:
 *   URL        : http://localhost:9999
 *   Transport  : http-post
 *   API Key    : (選填,隨便填一串看列印)
 *   送出使用者身份: 勾起來
 *
 * 點「同步工具」→ 應該看到 tools/list 請求,X-User-Token 應為 (none)(因為 sync 是 service-level)
 * 在對話裡觸發這支工具 → 應該看到 tools/call 請求,X-User-Token 會是 JWT
 *
 * ⚠️ 僅本機測試用,不做任何驗簽(只印 header 出來)。真實 MCP 需用公鑰驗。
 */

'use strict';

const http = require('http');
const path = require('path');
const fs   = require('fs');

// 嘗試載入公鑰,若有就順便做 RS256 驗簽(模擬真實 MCP 端)
let verifier = null;
(function tryLoadVerifier() {
  const candidates = [
    process.env.MCP_JWT_PUBLIC_KEY_PATH,
    path.resolve(__dirname, '../certs/foxlink-gpt-public.pem'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const pem = fs.readFileSync(p, 'utf8');
      const jwt = require('jsonwebtoken');
      verifier = (token) => jwt.verify(token, pem, {
        algorithms: ['RS256'],
        issuer: 'foxlink-gpt',
        clockTolerance: 30,
      });
      console.log(`[mock] Loaded public key from ${p} — will verify X-User-Token`);
      return;
    } catch (_) {}
  }
  console.log('[mock] No public key loaded — will print X-User-Token but NOT verify');
})();

const PORT = Number(process.argv[2] || 9999);
const SERVER_NAME = 'mock-mcp';

// 假工具清單
const TOOLS = [
  {
    name: 'echo',
    description: 'Echo back the input text',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'text to echo' } },
      required: ['text'],
    },
  },
  {
    name: 'whoami',
    description: 'Return who the caller is (based on X-User-Token)',
    inputSchema: { type: 'object', properties: {} },
  },
];

function hr(label) {
  console.log('\n' + '═'.repeat(72));
  console.log('  ' + label);
  console.log('═'.repeat(72));
}

function shortToken(t) {
  if (!t) return '(none)';
  if (t.length < 60) return t;
  return t.slice(0, 40) + '…' + t.slice(-10);
}

http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;

  hr(`${req.method} ${req.url}`);
  console.log('Authorization :', req.headers['authorization'] || '(none)');
  console.log('X-User-Token  :', shortToken(req.headers['x-user-token']));

  // 如果有 X-User-Token,嘗試驗簽並印 claims
  const userToken = req.headers['x-user-token'];
  if (userToken) {
    if (verifier) {
      try {
        const claims = verifier(userToken);
        console.log('→ Verified claims:');
        console.log('    jti   =', claims.jti);
        console.log('    sub   =', claims.sub);
        console.log('    email =', claims.email);
        console.log('    name  =', claims.name);
        console.log('    dept  =', claims.dept);
        console.log('    iss   =', claims.iss);
        const now = Math.floor(Date.now() / 1000);
        console.log('    exp   =', new Date(claims.exp * 1000).toISOString(), `(${claims.exp - now}s remaining)`);
      } catch (e) {
        console.log('→ ⚠️ Verify FAILED:', e.name, '-', e.message);
      }
    } else {
      console.log('→ (not verified — no public key loaded)');
    }
  }

  let msg;
  try { msg = JSON.parse(body || '{}'); }
  catch { msg = {}; }

  console.log('Method        :', msg.method || '(?)');
  if (msg.params) console.log('Params        :', JSON.stringify(msg.params).slice(0, 200));

  // JSON-RPC 回應
  let result = {};
  if (msg.method === 'initialize') {
    result = {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: '0.1.0' },
    };
  } else if (msg.method === 'tools/list') {
    result = { tools: TOOLS };
  } else if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params || {};
    if (name === 'echo') {
      result = { content: [{ type: 'text', text: `echo: ${args?.text || ''}` }] };
    } else if (name === 'whoami') {
      let who = 'unknown (no X-User-Token)';
      if (userToken && verifier) {
        try {
          const c = verifier(userToken);
          who = `${c.name || ''} <${c.email}> (sub=${c.sub}, dept=${c.dept})`;
        } catch (e) {
          who = `invalid token: ${e.message}`;
        }
      } else if (userToken) {
        who = 'token present but no verifier — start with MCP_JWT_PUBLIC_KEY_PATH';
      }
      result = { content: [{ type: 'text', text: `You are: ${who}` }] };
    } else {
      result = { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
    }
  } else {
    result = { ok: true, echo: msg.method };
  }

  const response = { jsonrpc: '2.0', id: msg.id ?? null, result };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}).listen(PORT, () => {
  console.log(`\n[mock] Mock MCP server listening on http://localhost:${PORT}`);
  console.log('[mock] Tools exposed:', TOOLS.map(t => t.name).join(', '));
  console.log('[mock] Ready — send requests from FOXLINK GPT and watch headers below.\n');
});
