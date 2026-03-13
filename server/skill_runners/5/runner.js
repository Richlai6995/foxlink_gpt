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
  try {
    const result = await userHandler(req.body);
    if (!result || typeof result !== 'object') {
      return res.status(500).json({ error: 'handler must return an object' });
    }
    if (!('system_prompt' in result) && !('content' in result)) {
      return res.status(500).json({ error: 'handler must return { system_prompt } or { content }' });
    }
    res.json(result);
  } catch (e) {
    console.error('[runner] handler error:', e.message);
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
  server.close(() => process.exit(0));
});
