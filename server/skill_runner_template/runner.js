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
app.use(express.json({ limit: '2mb' }));

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, skill_id: SKILL_ID, port: PORT }));

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

process.on('SIGTERM', () => {
  if (server.closeAllConnections) server.closeAllConnections(); // Node 18.2+ closes keep-alive connections
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref(); // Force exit after 500ms
});
