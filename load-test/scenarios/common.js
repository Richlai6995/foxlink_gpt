'use strict';
/**
 * 共用函數：登入、建立 Session、組 multipart body、SSE drain
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

// ── Login ────────────────────────────────────────────────────────────────────

/**
 * 登入並回傳 { token, user }。在 setup() 裡呼叫。
 */
export function login(username, password) {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ username, password }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(res, { 'login 200': (r) => r.status === 200 });
  const body = JSON.parse(res.body);
  if (!body.token) throw new Error(`Login failed: ${res.body}`);
  return { token: body.token, user: body.user };
}

// ── Auth headers ─────────────────────────────────────────────────────────────

export function authHeaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

// ── Multipart builder (for chat SSE endpoint) ────────────────────────────────

/**
 * 手動組 multipart/form-data（k6 的 object body 只送 form-urlencoded，multer 需要 multipart）
 * fields: { key: value } — 只支援 string 欄位
 */
export function buildMultipart(fields) {
  const boundary = '----k6Boundary' + Math.random().toString(36).slice(2);
  let body = '';
  for (const [k, v] of Object.entries(fields)) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  }
  body += `--${boundary}--\r\n`;
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

// ── Chat session ─────────────────────────────────────────────────────────────

export function createSession(token, model = 'pro') {
  const res = http.post(
    `${BASE_URL}/api/chat/sessions`,
    JSON.stringify({ model, title: 'k6 load test' }),
    { headers: authHeaders(token, { 'Content-Type': 'application/json' }) }
  );
  check(res, { 'create session 200': (r) => r.status === 200 });
  return JSON.parse(res.body).id;
}

export function deleteSession(token, sessionId) {
  http.del(`${BASE_URL}/api/chat/sessions/${sessionId}`, null, {
    headers: authHeaders(token),
  });
}

// ── SSE drain ────────────────────────────────────────────────────────────────

/**
 * 呼叫 SSE 端點（k6 會等 connection close）。
 * 回傳 { ok, status, durationMs, bodySize }
 */
export function ssePost(url, token, fields, timeoutSec = 120) {
  const { body, contentType } = buildMultipart(fields);
  const start = Date.now();
  const res = http.post(url, body, {
    headers: authHeaders(token, { 'Content-Type': contentType }),
    timeout: `${timeoutSec}s`,
  });
  const durationMs = Date.now() - start;
  const ok = res.status === 200;
  // 簡單確認 SSE 結束：body 包含 "done"
  const hasDone = res.body && (res.body.includes('"done":true') || res.body.includes('"done": true'));
  return { ok, status: res.status, durationMs, bodySize: res.body ? res.body.length : 0, hasDone };
}

// ── SSE GET (for dashboard) ───────────────────────────────────────────────────

export function ssePostJson(url, token, payload, timeoutSec = 120) {
  const start = Date.now();
  const res = http.post(url, JSON.stringify(payload), {
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    timeout: `${timeoutSec}s`,
  });
  const durationMs = Date.now() - start;
  return {
    ok: res.status === 200,
    status: res.status,
    durationMs,
    bodySize: res.body ? res.body.length : 0,
    body: res.body || '',
  };
}
