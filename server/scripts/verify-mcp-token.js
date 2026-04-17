#!/usr/bin/env node
/**
 * verify-mcp-token.js — FOXLINK GPT → MCP User Identity JWT 驗證工具
 *
 * 用法:
 *   # 從 arg 吃 token
 *   node server/scripts/verify-mcp-token.js eyJhbGciOiJSUzI1NiJ9...
 *
 *   # 從 stdin 吃 token
 *   echo "eyJ..." | node server/scripts/verify-mcp-token.js
 *
 *   # 指定公鑰路徑
 *   MCP_JWT_PUBLIC_KEY_PATH=./certs/foxlink-gpt-public.pem node server/scripts/verify-mcp-token.js <token>
 *
 * 詳細說明:docs/mcp-user-identity-auth.md §3.4
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const jwt  = require('jsonwebtoken');

// 找公鑰:優先 env,再試 server/certs/
function resolvePublicKeyPath() {
  if (process.env.MCP_JWT_PUBLIC_KEY_PATH) return process.env.MCP_JWT_PUBLIC_KEY_PATH;
  const candidates = [
    path.resolve(__dirname, '../certs/foxlink-gpt-public.pem'),
    path.resolve(process.cwd(), 'server/certs/foxlink-gpt-public.pem'),
    path.resolve(process.cwd(), 'certs/foxlink-gpt-public.pem'),
    path.resolve(process.cwd(), 'foxlink-gpt-public.pem'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readTokenFromArg() {
  const tokenArg = process.argv[2];
  if (tokenArg && !tokenArg.startsWith('-')) return tokenArg.trim();
  return null;
}

function readTokenFromStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve(null);
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim() || null));
  });
}

function fmt(claim) {
  return JSON.stringify(claim, null, 2);
}

function decodeHeader(token) {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('Malformed JWT: expected header.payload.signature');
  return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
}

(async () => {
  const token = readTokenFromArg() || await readTokenFromStdin();

  if (!token) {
    console.error('Usage: node verify-mcp-token.js <token>');
    console.error('   or: echo "<token>" | node verify-mcp-token.js');
    process.exit(2);
  }

  const keyPath = resolvePublicKeyPath();
  if (!keyPath) {
    console.error('[FAIL] Public key not found.');
    console.error('Set MCP_JWT_PUBLIC_KEY_PATH, or put foxlink-gpt-public.pem at server/certs/');
    process.exit(1);
  }

  let pub;
  try {
    pub = fs.readFileSync(keyPath, 'utf8');
  } catch (e) {
    console.error(`[FAIL] Cannot read public key at ${keyPath}: ${e.message}`);
    process.exit(1);
  }

  console.log(`# Verifying with public key: ${keyPath}`);
  console.log();

  // Header preview
  let header;
  try {
    header = decodeHeader(token);
    console.log('## Header');
    console.log(fmt(header));
    console.log();
  } catch (e) {
    console.error(`[FAIL] ${e.message}`);
    process.exit(1);
  }

  // Verify
  try {
    const claims = jwt.verify(token, pub, {
      algorithms: ['RS256'],
      issuer: 'foxlink-gpt',
      clockTolerance: 30,
    });
    console.log('## Claims (verified)');
    console.log(fmt(claims));
    console.log();

    // Time context
    if (claims.iat) {
      const iat = new Date(claims.iat * 1000);
      console.log(`  iat: ${iat.toISOString()}  (${iat.toLocaleString()})`);
    }
    if (claims.exp) {
      const exp = new Date(claims.exp * 1000);
      const remaining = claims.exp - Math.floor(Date.now() / 1000);
      const state = remaining > 0 ? `valid for ${remaining}s more` : `expired ${-remaining}s ago`;
      console.log(`  exp: ${exp.toISOString()}  (${exp.toLocaleString()})  → ${state}`);
    }
    console.log();
    console.log('[OK] Token verified successfully.');
    process.exit(0);
  } catch (e) {
    console.error('[FAIL] Token verification failed');
    console.error(`  Reason: ${e.name}: ${e.message}`);
    if (e.name === 'TokenExpiredError') {
      console.error('  → token exp < now (consider clock skew; leeway is 30s)');
    } else if (e.name === 'JsonWebTokenError' && e.message.includes('algorithm')) {
      console.error('  → alg mismatch — only RS256 accepted (防 CVE-2016-5431)');
    } else if (e.message.includes('issuer')) {
      console.error('  → iss must be "foxlink-gpt"');
    }
    process.exit(1);
  }
})();
