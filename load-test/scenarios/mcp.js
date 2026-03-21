'use strict';
/**
 * 場景：MCP Tool Call（透過 chat + mcp_server_ids）
 * 流程：建立 session → 發送含 MCP 的訊息（SSE）→ 清理
 *
 * 環境變數：
 *   BASE_URL       伺服器位址
 *   USERNAME       帳號
 *   PASSWORD       密碼
 *   VUS            並發數（預設 5）
 *   DURATION       持續時間（預設 60s）
 *   MCP_SERVER_IDS 逗號分隔的 MCP server ID（整數，必填）
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { login, BASE_URL, createSession, deleteSession, ssePost } from './common.js';

const mcpDuration = new Trend('mcp_duration_ms', true);
const mcpSuccess  = new Rate('mcp_success_rate');
const mcpErrors   = new Counter('mcp_errors');

export const options = {
  vus:      parseInt(__ENV.VUS      || '5'),
  duration: __ENV.DURATION          || '60s',
  thresholds: {
    mcp_success_rate: ['rate>0.85'],
    mcp_duration_ms:  ['p(95)<45000'],
    http_req_failed:  ['rate<0.15'],
  },
};

const QUESTIONS = [
  '請查詢目前 CTB 系統的未結工單',
  '列出 ERP 中本月的採購訂單',
  '查詢近期的庫存異動記錄',
];

export function setup() {
  return login(__ENV.USERNAME || 'ADMIN', __ENV.PASSWORD || '123456');
}

export default function (data) {
  const { token } = data;
  const mcpIds = (__ENV.MCP_SERVER_IDS || '1').split(',').map((s) => parseInt(s.trim())).filter(Boolean);
  const question = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];

  let sessionId;
  group('mcp chat', () => {
    sessionId = createSession(token, 'pro');
    if (!sessionId) { mcpErrors.add(1); return; }

    const fields = {
      message: question,
      model: 'pro',
      mcp_server_ids: JSON.stringify(mcpIds),
    };
    const result = ssePost(`${BASE_URL}/api/chat/sessions/${sessionId}/messages`, token, fields, 90);

    mcpDuration.add(result.durationMs);
    mcpSuccess.add(result.ok && result.hasDone ? 1 : 0);
    if (!result.ok || !result.hasDone) mcpErrors.add(1);

    check(result, {
      'mcp chat 200':  (r) => r.ok,
      'mcp got done':  (r) => r.hasDone,
      'mcp < 45s':     (r) => r.durationMs < 45000,
    });

    deleteSession(token, sessionId);
  });

  sleep(2);
}
