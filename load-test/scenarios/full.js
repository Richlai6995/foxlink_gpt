'use strict';
/**
 * 場景：混合壓測（模擬真實使用比例）
 * 依比例隨機分配 VU 到各功能
 *   40% chat
 *   30% kb_search
 *   20% dashboard
 *   10% mcp
 *
 * 環境變數：同各場景，全部合併
 *   BASE_URL, USERNAME, PASSWORD, VUS, DURATION
 *   KB_ID, DESIGN_ID, MCP_SERVER_IDS, SELF_KB_IDS
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { login, BASE_URL, authHeaders, createSession, deleteSession, ssePost, ssePostJson } from './common.js';

const totalSuccess = new Rate('overall_success_rate');
const totalDur     = new Trend('overall_duration_ms', true);

export const options = {
  scenarios: {
    chat: {
      executor: 'constant-vus',
      vus: Math.max(1, Math.floor(parseInt(__ENV.VUS || '20') * 0.4)),
      duration: __ENV.DURATION || '120s',
      exec: 'chatScenario',
    },
    kb: {
      executor: 'constant-vus',
      vus: Math.max(1, Math.floor(parseInt(__ENV.VUS || '20') * 0.3)),
      duration: __ENV.DURATION || '120s',
      exec: 'kbScenario',
    },
    dashboard: {
      executor: 'constant-vus',
      vus: Math.max(1, Math.floor(parseInt(__ENV.VUS || '20') * 0.2)),
      duration: __ENV.DURATION || '120s',
      exec: 'dashboardScenario',
    },
    mcp: {
      executor: 'constant-vus',
      vus: Math.max(1, Math.floor(parseInt(__ENV.VUS || '20') * 0.1)),
      duration: __ENV.DURATION || '120s',
      exec: 'mcpScenario',
    },
  },
  thresholds: {
    overall_success_rate: ['rate>0.85'],
    overall_duration_ms:  ['p(90)<30000'],
    http_req_failed:      ['rate<0.15'],
  },
};

export function setup() {
  return login(__ENV.USERNAME || 'ADMIN', __ENV.PASSWORD || '123456');
}

// ── Chat ─────────────────────────────────────────────────────────────────────
export function chatScenario(data) {
  const { token } = data;
  const sessionId = createSession(token, 'flash');
  if (!sessionId) { totalSuccess.add(0); return; }
  const r = ssePost(`${BASE_URL}/api/chat/sessions/${sessionId}/messages`, token, {
    message: '用一句話介紹台灣。', model: 'flash',
  }, 60);
  totalDur.add(r.durationMs);
  totalSuccess.add(r.ok && r.hasDone ? 1 : 0);
  check(r, { 'chat ok': (x) => x.ok && x.hasDone });
  deleteSession(token, sessionId);
  sleep(1);
}

// ── KB Search ─────────────────────────────────────────────────────────────────
const KB_QUERIES = ['出貨流程', '庫存查詢', '年假申請', '供應商管理', '品質管制'];
export function kbScenario(data) {
  const { token } = data;
  const kbId = __ENV.KB_ID || '1';
  const q = KB_QUERIES[Math.floor(Math.random() * KB_QUERIES.length)];
  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/kb/${kbId}/search`,
    JSON.stringify({ query: q, top_k: 5 }),
    { headers: authHeaders(token, { 'Content-Type': 'application/json' }) }
  );
  const dur = Date.now() - start;
  totalDur.add(dur);
  totalSuccess.add(res.status === 200 ? 1 : 0);
  check(res, { 'kb ok': (r) => r.status === 200 });
  sleep(0.5);
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
const DASH_Q = ['本月出貨量', '庫存狀況', '訂單趨勢', '採購訂單', '不良率'];
export function dashboardScenario(data) {
  const { token } = data;
  const designId = parseInt(__ENV.DESIGN_ID || '1');
  const q = DASH_Q[Math.floor(Math.random() * DASH_Q.length)];
  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/dashboard/query`,
    JSON.stringify({ design_id: designId, question: q, lang: 'zh-TW' }),
    { headers: authHeaders(token, { 'Content-Type': 'application/json' }), timeout: '120s' }
  );
  const dur = Date.now() - start;
  totalDur.add(dur);
  const ok = res.status === 200 && (res.body || '').includes('"result"');
  totalSuccess.add(ok ? 1 : 0);
  check(res, { 'dashboard ok': (r) => r.status === 200 });
  sleep(2);
}

// ── MCP ───────────────────────────────────────────────────────────────────────
export function mcpScenario(data) {
  const { token } = data;
  const mcpIds = (__ENV.MCP_SERVER_IDS || '1').split(',').map((s) => parseInt(s.trim())).filter(Boolean);
  const sessionId = createSession(token, 'pro');
  if (!sessionId) { totalSuccess.add(0); return; }
  const r = ssePost(`${BASE_URL}/api/chat/sessions/${sessionId}/messages`, token, {
    message: '查詢近期未結訂單', model: 'pro',
    mcp_server_ids: JSON.stringify(mcpIds),
  }, 90);
  totalDur.add(r.durationMs);
  totalSuccess.add(r.ok && r.hasDone ? 1 : 0);
  check(r, { 'mcp ok': (x) => x.ok && x.hasDone });
  deleteSession(token, sessionId);
  sleep(2);
}
