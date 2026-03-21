'use strict';
/**
 * 場景：AI 戰情查詢（SSE）
 * 流程：POST /api/dashboard/query → 等 SSE 完成
 *
 * 環境變數：
 *   BASE_URL      伺服器位址
 *   USERNAME      帳號（需有 can_use_ai_dashboard 權限）
 *   PASSWORD      密碼
 *   VUS           並發數（預設 5，AI 戰情會打 LLM + ERP，壓力大）
 *   DURATION      持續時間（預設 60s）
 *   DESIGN_ID     戰情設計 ID（必填，整數）
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { login, BASE_URL, authHeaders } from './common.js';

const dashDuration = new Trend('dashboard_duration_ms', true);
const dashSuccess  = new Rate('dashboard_success_rate');
const dashErrors   = new Counter('dashboard_errors');
const sqlGenTime   = new Trend('dashboard_sql_gen_ms', true);

export const options = {
  vus:      parseInt(__ENV.VUS      || '5'),
  duration: __ENV.DURATION          || '60s',
  thresholds: {
    dashboard_success_rate: ['rate>0.85'],
    dashboard_duration_ms:  ['p(95)<60000'],   // LLM + ERP 最慢，給 60 秒
    http_req_failed:        ['rate<0.15'],
  },
};

const QUESTIONS = [
  '今天的出貨數量是多少？',
  '本月各產品線的庫存狀況',
  '最近 7 天的訂單量趨勢',
  '目前待確認的採購單有哪些？',
  '本季產品不良率統計',
];

export function setup() {
  return login(__ENV.USERNAME || 'ADMIN', __ENV.PASSWORD || '123456');
}

export default function (data) {
  const { token } = data;
  const designId = parseInt(__ENV.DESIGN_ID || '1');
  const question = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];

  group('dashboard query', () => {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/dashboard/query`,
      JSON.stringify({ design_id: designId, question, lang: 'zh-TW' }),
      {
        headers: authHeaders(token, { 'Content-Type': 'application/json' }),
        timeout: '120s',
      }
    );
    const dur = Date.now() - start;

    const ok = res.status === 200;
    const body = res.body || '';
    const hasResult = body.includes('"result"') || body.includes('"row_count"');
    const hasError  = body.includes('"error"');

    // 嘗試解析 sql_preview 的時間點
    const sqlMatch = body.match(/"sql":"[^"]{5,}/);
    if (sqlMatch) sqlGenTime.add(dur);   // 粗估：有 SQL 就算 SQL gen 完成

    dashDuration.add(dur);
    dashSuccess.add(ok && hasResult && !hasError ? 1 : 0);
    if (!ok || hasError) dashErrors.add(1);

    check(res, {
      'dashboard 200':      (r) => r.status === 200,
      'has result data':    (r) => body.includes('"result"') || body.includes('"row_count"'),
      'no error event':     (r) => !body.includes('"error"'),
      'dashboard < 60s':    (r) => dur < 60000,
    });
  });

  sleep(2);  // AI 戰情 VU 間隔大一點，避免 ERP 連線池耗盡
}
