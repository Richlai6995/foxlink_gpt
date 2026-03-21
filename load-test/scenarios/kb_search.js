'use strict';
/**
 * 場景：知識庫向量搜尋
 * 流程：POST /api/kb/:id/search（非 SSE，單次同步呼叫）
 *
 * 環境變數：
 *   BASE_URL    伺服器位址
 *   USERNAME    帳號
 *   PASSWORD    密碼
 *   VUS         並發數（預設 20）
 *   DURATION    持續時間（預設 60s）
 *   KB_ID       知識庫 ID（必填，整數）
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { login, BASE_URL, authHeaders } from './common.js';

const kbDuration  = new Trend('kb_search_duration_ms', true);
const kbSuccess   = new Rate('kb_search_success_rate');
const kbErrors    = new Counter('kb_search_errors');

export const options = {
  vus:      parseInt(__ENV.VUS      || '20'),
  duration: __ENV.DURATION          || '60s',
  thresholds: {
    kb_search_success_rate: ['rate>0.95'],
    kb_search_duration_ms:  ['p(95)<5000'],   // 向量搜尋應在 5 秒內
    http_req_failed:        ['rate<0.05'],
  },
};

const QUERIES = [
  '請問如何申請年假？',
  '系統連線失敗怎麼辦？',
  '出貨流程是什麼？',
  '如何查詢庫存狀態？',
  '報表匯出步驟說明',
  '新進員工教育訓練',
  '供應商評核標準',
  '品質管制流程',
];

export function setup() {
  return login(__ENV.USERNAME || 'ADMIN', __ENV.PASSWORD || '123456');
}

export default function (data) {
  const { token } = data;
  const kbId = __ENV.KB_ID || '1';
  const query = QUERIES[Math.floor(Math.random() * QUERIES.length)];

  group('kb search', () => {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/kb/${kbId}/search`,
      JSON.stringify({ query, top_k: 5, retrieval_mode: 'hybrid' }),
      { headers: authHeaders(token, { 'Content-Type': 'application/json' }) }
    );
    const dur = Date.now() - start;

    kbDuration.add(dur);
    kbSuccess.add(res.status === 200 ? 1 : 0);
    if (res.status !== 200) kbErrors.add(1);

    check(res, {
      'kb search 200':  (r) => r.status === 200,
      'has results':    (r) => {
        try { return JSON.parse(r.body).results !== undefined; } catch (_) { return false; }
      },
      'kb search < 5s': (r) => dur < 5000,
    });
  });

  sleep(0.5);
}
