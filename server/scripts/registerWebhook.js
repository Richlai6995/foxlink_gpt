#!/usr/bin/env node
'use strict';

/**
 * 向 Webex 登記 / 更新 webhook
 *
 * 用法：
 *   node server/scripts/registerWebhook.js           # 登記 webhook
 *   node server/scripts/registerWebhook.js --list     # 列出所有 webhook
 *   node server/scripts/registerWebhook.js --delete   # 刪除所有同名 webhook
 *   node server/scripts/registerWebhook.js --test     # 測試 webhook 連通
 *
 * .env 設定：
 *   WEBEX_BOT_TOKEN=...
 *   WEBEX_WEBHOOK_SECRET=...（建議設定，啟用 HMAC 驗簽）
 *   WEBEX_PUBLIC_URL=https://fl-lite-em.foxlink.com.tw:8443
 *   WEBEX_WEBHOOK_PATH=/api/webex/webhook-gpt       （選填，預設 /api/webex/webhook）
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { WebexService } = require('../services/webexService');

const WEBHOOK_NAME = 'FOXLINK GPT Webhook';

async function main() {
  const token = process.env.WEBEX_BOT_TOKEN;
  const secret = process.env.WEBEX_WEBHOOK_SECRET;
  const publicUrl = (process.env.WEBEX_PUBLIC_URL || '').replace(/\/$/, '');
  const webhookPath = process.env.WEBEX_WEBHOOK_PATH || '/api/webex/webhook';
  const arg = process.argv[2];

  if (!token) { console.error('WEBEX_BOT_TOKEN not set'); process.exit(1); }

  const webex = new WebexService(token);

  // --list：列出所有 webhook
  if (arg === '--list') {
    const webhooks = await webex.listWebhooks();
    if (webhooks.length === 0) {
      console.log('No webhooks registered.');
    } else {
      webhooks.forEach(wh => {
        console.log(`  [${wh.status}] ${wh.name}`);
        console.log(`    ID:     ${wh.id}`);
        console.log(`    URL:    ${wh.targetUrl}`);
        console.log(`    Event:  ${wh.resource}:${wh.event}`);
        console.log(`    Secret: ${wh.secret ? 'yes' : 'no'}`);
        console.log('');
      });
    }
    return;
  }

  // --delete：刪除所有同名 webhook
  if (arg === '--delete') {
    const webhooks = await webex.listWebhooks();
    let deleted = 0;
    for (const wh of webhooks) {
      if (wh.name === WEBHOOK_NAME || wh.name === WEBHOOK_NAME + ' (Card Actions)') {
        await webex.deleteWebhook(wh.id);
        console.log(`  Deleted: ${wh.id} → ${wh.targetUrl}`);
        deleted++;
      }
    }
    console.log(deleted ? `\nDeleted ${deleted} webhook(s).` : 'No matching webhooks found.');
    return;
  }

  // --test：測試 webhook 連通
  if (arg === '--test') {
    if (!publicUrl) { console.error('WEBEX_PUBLIC_URL not set'); process.exit(1); }
    const targetUrl = `${publicUrl}${webhookPath}`;
    console.log(`Testing connectivity to: ${targetUrl}`);
    try {
      const https = require('https');
      const http = require('http');
      const { URL } = require('url');
      const url = new URL(targetUrl);
      const client = url.protocol === 'https:' ? https : http;
      await new Promise((resolve, reject) => {
        const req = client.request(url, { method: 'POST', timeout: 10000, rejectUnauthorized: false, headers: { 'Content-Type': 'application/json' } }, (res) => {
          console.log(`  HTTP ${res.statusCode} ${res.statusMessage}`);
          if (res.statusCode >= 200 && res.statusCode < 500) {
            console.log('  Connectivity OK (endpoint reachable)');
          }
          resolve();
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Connection timeout (10s)')); });
        req.write(JSON.stringify({ resource: 'messages', event: 'test', data: {} }));
        req.end();
      });
    } catch (e) {
      console.error(`  FAILED: ${e.message}`);
      console.error('  Check: firewall rules, Nginx config, DNS resolution');
      process.exit(1);
    }
    return;
  }

  // 預設：登記 webhook
  if (!publicUrl) { console.error('WEBEX_PUBLIC_URL not set'); process.exit(1); }

  const targetUrl = `${publicUrl}${webhookPath}`;

  // 查詢並刪除同名舊 webhook(含 Card Actions 變體)
  console.log('Checking existing webhooks...');
  const existing = await webex.listWebhooks();
  for (const wh of existing) {
    if (wh.name === WEBHOOK_NAME || wh.name === WEBHOOK_NAME + ' (Card Actions)') {
      console.log(`  Removing old webhook: ${wh.id} → ${wh.targetUrl}`);
      await webex.deleteWebhook(wh.id);
    }
  }

  // 建立新 webhook(messages + attachmentActions 兩個 — Phase 4 14.4 加 attachmentActions
  // 給 Adaptive Card 按鈕 callback 用)
  console.log(`\nRegistering webhooks:`);
  console.log(`  Name:   ${WEBHOOK_NAME}`);
  console.log(`  URL:    ${targetUrl}`);
  console.log(`  Events: messages:created + attachmentActions:created`);
  console.log(`  Secret: ${secret ? 'yes' : 'no'}`);

  const created = await webex.createWebhook({
    name: WEBHOOK_NAME,
    targetUrl,
    resource: 'messages',
    event: 'created',
    secret: secret || undefined,
  });
  console.log(`  ✓ messages:created  → ${created.id}`);

  const cardWh = await webex.createWebhook({
    name: WEBHOOK_NAME + ' (Card Actions)',
    targetUrl,
    resource: 'attachmentActions',
    event: 'created',
    secret: secret || undefined,
  }).catch(e => {
    // 不要 silent skip — 之前 swallow 過 error,K8s 部署完一切看似正常,
    // 但所有 Adaptive Card 按鈕(Forecast / What-if / 警示 ACK)全失效,user 看不到 log 也找不到原因。
    console.error(`  ✗ attachmentActions:created 註冊失敗: ${e.response?.data?.message || e.message}`);
    console.error(`     Bot Token 必須是 Bot 類型且有 spark:webhooks_write scope。`);
    console.error(`     缺這條 webhook → Adaptive Card 所有按鈕全部失效。`);
    throw e;
  });
  console.log(`  ✓ attachmentActions:created → ${cardWh.id}`);
  console.log(`     用於 Adaptive Card 按鈕 callback(警示 ACK 等)`);

  if (!secret) {
    console.warn('\n  WARNING: WEBEX_WEBHOOK_SECRET not set. HMAC signature verification disabled.');
    console.warn('  Set WEBEX_WEBHOOK_SECRET in .env for production use.');
  }

  // Bot 資訊
  try {
    const me = await webex.client.get('/people/me');
    console.log(`\nBot info:`);
    console.log(`  Name:  ${me.data.displayName}`);
    console.log(`  Email: ${me.data.emails?.[0]}`);
  } catch {}

  console.log(`\n--- Verification ---`);
  console.log(`1. Send a message to the Bot in Webex`);
  console.log(`2. Check server logs for: [Webex] Webhook received`);
  console.log(`3. If no logs, run: node server/scripts/registerWebhook.js --test`);
}

main().catch(e => {
  console.error('Error:', e.message);
  if (e.response?.data) console.error('  API response:', JSON.stringify(e.response.data));
  process.exit(1);
});
