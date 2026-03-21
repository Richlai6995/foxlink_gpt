'use strict';
/**
 * 場景：基本 LLM 對話
 * 流程：建立 session → 發送訊息（SSE）→ 清理
 *
 * 環境變數：
 *   BASE_URL     伺服器位址（預設 http://localhost:3001）
 *   USERNAME     測試帳號（需有對話權限）
 *   PASSWORD     密碼
 *   VUS          並發數（預設 10）
 *   DURATION     持續時間（預設 60s）
 *   SELF_KB_IDS  逗號分隔的 KB UUID（選填，帶入知識庫測試）
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { login, BASE_URL, createSession, deleteSession, ssePost } from './common.js';

// ── Metrics ──────────────────────────────────────────────────────────────────
const chatDuration  = new Trend('chat_duration_ms', true);
const chatSucceeded = new Rate('chat_success_rate');
const chatErrors    = new Counter('chat_errors');

// ── Options ───────────────────────────────────────────────────────────────────
export const options = {
  vus:      parseInt(__ENV.VUS      || '10'),
  duration: __ENV.DURATION          || '60s',
  thresholds: {
    chat_success_rate: ['rate>0.90'],           // 90%+ 成功
    chat_duration_ms:  ['p(95)<30000'],          // 95% 在 30 秒內回應（LLM 慢）
    http_req_failed:   ['rate<0.10'],
  },
};

// ── Setup：登入一次，token 傳給所有 VU ─────────────────────────────────────────
export function setup() {
  const username = __ENV.USERNAME || 'ADMIN';
  const password = __ENV.PASSWORD || '123456';
  return login(username, password);
}

// ── VU main loop ──────────────────────────────────────────────────────────────
export default function (data) {
  const { token } = data;
  const kbIds = __ENV.SELF_KB_IDS ? __ENV.SELF_KB_IDS.split(',').map(s => s.trim()).filter(Boolean) : [];

  let sessionId;
  group('chat flow', () => {
    // 1. 建立 session
    sessionId = createSession(token, 'flash');  // 壓測用 flash 比較快
    if (!sessionId) { chatErrors.add(1); return; }

    // 2. 發送訊息（SSE）
    const fields = {
      message: '請用一句話說明台灣的地理位置。',
      model: 'flash',
      ...(kbIds.length ? { self_kb_ids: JSON.stringify(kbIds) } : {}),
    };
    const result = ssePost(`${BASE_URL}/api/chat/sessions/${sessionId}/messages`, token, fields, 90);

    chatDuration.add(result.durationMs);
    chatSucceeded.add(result.ok && result.hasDone ? 1 : 0);
    if (!result.ok || !result.hasDone) chatErrors.add(1);

    check(result, {
      'chat SSE 200':   (r) => r.ok,
      'chat got done':  (r) => r.hasDone,
      'chat < 30s':     (r) => r.durationMs < 30000,
    });

    // 3. 清理 session
    deleteSession(token, sessionId);
  });

  sleep(1);
}

// ── Teardown（可選）────────────────────────────────────────────────────────────
export function teardown(data) {
  // token 已在 setup，teardown 不需額外清理
}
