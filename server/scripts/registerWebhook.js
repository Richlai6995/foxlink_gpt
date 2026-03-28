#!/usr/bin/env node
'use strict';

/**
 * 一次性執行：向 Webex 登記 webhook
 *
 * 用法：
 *   node server/scripts/registerWebhook.js
 *
 * 需要 .env 設定：
 *   WEBEX_BOT_TOKEN=...
 *   WEBEX_WEBHOOK_SECRET=...
 *   WEBEX_PUBLIC_URL=https://your-domain.com
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { WebexService } = require('../services/webexService');

const WEBHOOK_NAME = 'FOXLINK GPT Webhook';

async function main() {
  const token = process.env.WEBEX_BOT_TOKEN;
  const secret = process.env.WEBEX_WEBHOOK_SECRET;
  const publicUrl = (process.env.WEBEX_PUBLIC_URL || '').replace(/\/$/, '');

  if (!token) { console.error('❌ WEBEX_BOT_TOKEN 未設定'); process.exit(1); }
  if (!publicUrl) { console.error('❌ WEBEX_PUBLIC_URL 未設定'); process.exit(1); }

  const targetUrl = `${publicUrl}/api/webex/webhook`;
  const webex = new WebexService(token);

  console.log('🔍 查詢現有 webhooks...');
  const existing = await webex.listWebhooks();
  console.log(`   找到 ${existing.length} 個 webhook`);

  // 刪除同名舊 webhook
  for (const wh of existing) {
    if (wh.name === WEBHOOK_NAME) {
      console.log(`🗑️  刪除舊 webhook: ${wh.id}`);
      await webex.deleteWebhook(wh.id);
    }
  }

  // 建立新 webhook
  console.log(`➕ 建立 webhook → ${targetUrl}`);
  const created = await webex.createWebhook({
    name: WEBHOOK_NAME,
    targetUrl,
    resource: 'messages',
    event: 'created',
    secret: secret || undefined,
  });

  console.log('\n✅ Webhook 建立成功！');
  console.log(`   ID:         ${created.id}`);
  console.log(`   Name:       ${created.name}`);
  console.log(`   Target URL: ${created.targetUrl}`);
  console.log(`   Status:     ${created.status}`);
  if (!secret) console.warn('\n⚠️  WEBEX_WEBHOOK_SECRET 未設定，建議設定以啟用簽名驗證');

  // 印出 Bot 資訊
  const me = await webex.client.get('/people/me');
  console.log(`\n🤖 Bot 資訊：`);
  console.log(`   名稱: ${me.data.displayName}`);
  console.log(`   Email: ${me.data.emails?.[0]}`);
  console.log(`\n💡 在 Webex 中搜尋 Bot Email 即可開始對話。`);
}

main().catch(e => {
  console.error('❌ 發生錯誤:', e.message);
  if (e.response?.data) console.error('   API 回應:', JSON.stringify(e.response.data));
  process.exit(1);
});
