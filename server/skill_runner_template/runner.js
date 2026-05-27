'use strict';
const express = require('express');
const path = require('path');

const PORT = parseInt(process.env.SKILL_PORT, 10);
const SKILL_ID = process.env.SKILL_ID;

if (!PORT || !SKILL_ID) {
  console.error('[runner] Missing SKILL_PORT or SKILL_ID env');
  process.exit(1);
}

let userHandler;
try {
  userHandler = require('./user_code');
} catch (e) {
  console.error('[runner] Failed to load user_code.js:', e.message);
  process.send?.({ error: `Failed to load user_code: ${e.message}` });
  process.exit(1);
}

const app = express();

// 追蹤 in-flight requests 數(必須在 routes 之前掛,確保 health/POST 都會經過)
let inflight = 0;
app.use((req, res, next) => {
  inflight++;
  const dec = () => { inflight = Math.max(0, inflight - 1); };
  res.on('finish', dec);
  res.on('close',  dec);
  next();
});

app.use(express.json({ limit: '2mb' }));

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, skill_id: SKILL_ID, port: PORT, inflight }));

app.post('/', async (req, res) => {
  const reqId = Date.now().toString(36);
  const preview = (req.body.user_message || req.body.content || req.body.text || '').slice(0, 80);
  console.log(`[runner:${SKILL_ID}] POST #${reqId} from=${req.ip} msg="${preview}"`);
  const t0 = Date.now();
  try {
    const result = await userHandler(req.body);
    if (!result || typeof result !== 'object') {
      console.error(`[runner:${SKILL_ID}] #${reqId} handler must return an object`);
      return res.status(500).json({ error: 'handler must return an object' });
    }
    if (!('system_prompt' in result) && !('content' in result)) {
      console.error(`[runner:${SKILL_ID}] #${reqId} handler must return { system_prompt } or { content }`);
      return res.status(500).json({ error: 'handler must return { system_prompt } or { content }' });
    }
    console.log(`[runner:${SKILL_ID}] #${reqId} OK ${Date.now() - t0}ms keys=${Object.keys(result).join(',')}`);
    res.json(result);
  } catch (e) {
    console.error(`[runner:${SKILL_ID}] #${reqId} handler error ${Date.now() - t0}ms:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

process.on('uncaughtException', (e) => {
  console.error('[runner] uncaughtException:', e.message);
  process.send?.({ error: e.message });
});

process.on('unhandledRejection', (reason) => {
  console.error('[runner] unhandledRejection:', reason);
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[runner] skill ${SKILL_ID} listening on port ${PORT}`);
  process.send?.({ ready: true, port: PORT });
});

// SIGTERM grace:30s 內等 in-flight handler 結束。
// 之前是 500ms 強制退出 → in-flight Excel query 直接斷,前端拿到 connection drop。
// K8s deployment.yaml 已配 terminationGracePeriodSeconds: 60 + preStop sleep 15,
// 給 LB drain 15s + 本 grace 30s + buffer 15s 合計 60s 內所有 skill 子程序能乾淨退場。
const SIGTERM_GRACE_MS = 30_000;
process.on('SIGTERM', () => {
  console.log(`[runner] SKILL ${SKILL_ID} SIGTERM received, inflight=${inflight}, draining for ${SIGTERM_GRACE_MS}ms`);
  server.close(() => {
    console.log(`[runner] SKILL ${SKILL_ID} server closed, exit 0`);
    process.exit(0);
  });
  // 每秒檢查 inflight,空了就立刻退(不必等 server.close 自然結束)
  const tick = setInterval(() => {
    if (inflight <= 0) {
      clearInterval(tick);
      if (server.closeAllConnections) server.closeAllConnections();
      process.exit(0);
    }
  }, 1000);
  // 兜底:30s 強制退出(避免 hung handler 卡死)
  setTimeout(() => {
    console.warn(`[runner] SKILL ${SKILL_ID} grace timeout, inflight=${inflight}, forcing exit`);
    if (server.closeAllConnections) server.closeAllConnections();
    process.exit(0);
  }, SIGTERM_GRACE_MS).unref();
});
