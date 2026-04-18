'use strict';
/**
 * 一次修正兩個 KB 的搜尋精度問題：
 * 1. 正崴通訊錄 — 殘留巨型 chunks (269M chars，舊 phantom-range bug 產物)
 * 2. 正崴通訊錄無格式感知 — score_threshold=0.7 過嚴，把正確結果過濾掉
 *
 * 做法
 *   A. PUT /api/kb/:id 改 score_threshold=0
 *   B. POST /api/kb/admin/health/reparse-oversized 重跑所有巨型 chunks 的 docs
 *
 * 使用方式（要求 server 已啟動 + Oracle 連得上）
 *   node kb_test/fix-kb-precision.js
 *
 * Env（跟 reparse-oversized.js 共用）
 *   SERVER=http://localhost:3007 (預設)
 *   ADMIN_USER=ADMIN
 *   ADMIN_PASSWORD=<讀 .env>
 *   TOKEN=<可直接提供，跳過 login>
 */

const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');

const SERVER = process.env.SERVER || 'http://localhost:3007';
const ADMIN_USER = process.env.ADMIN_USER || 'ADMIN';
function readEnvDefault(key) {
  try {
    const txt = fs.readFileSync(path.join(__dirname, '../server/.env'), 'utf8');
    const m = txt.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm'));
    return m ? m[1].replace(/^["']|["']$/g, '') : '';
  } catch { return ''; }
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || readEnvDefault('DEFAULT_ADMIN_PASSWORD');

async function req(method, url, headers = {}, body = null) {
  const u = new URL(url);
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const r = mod.request({
      method, hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'fix-kb-precision', ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed; try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function login() {
  if (process.env.TOKEN) return process.env.TOKEN;
  if (!ADMIN_PASSWORD) throw new Error('TOKEN 或 ADMIN_PASSWORD 必須提供');
  const r = await req('POST', `${SERVER}/api/auth/login`,
    { 'Content-Type': 'application/json' },
    JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD })
  );
  if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}

(async () => {
  console.log(`[fix-kb-precision] server=${SERVER}`);
  const token = await login();
  const auth = { Authorization: `Bearer ${token}` };

  // 找出有巨型 chunks (>5000) 的文件，看哪幾個屬於 通訊錄 系列
  console.log('\n1) 掃描有巨型 chunks 的文件（threshold=5000）');
  const over = await req('GET', `${SERVER}/api/kb/admin/health/oversized-docs?threshold=5000`, auth);
  if (over.status !== 200) { console.error('掃描失敗', over.body); process.exit(1); }
  const docs = over.body.docs || [];
  console.log(`   掃描結果: ${docs.length} 份文件有巨型 chunks`);

  const targetKbIds = new Set();
  docs.forEach(d => {
    const name = d.KB_NAME || d.kb_name || '';
    const file = d.FILENAME || d.filename || '';
    const big  = d.MAX_CHUNK_LEN || d.max_chunk_len || 0;
    console.log(`   - [${name}] ${file} (max ${(big/1024).toFixed(0)}KB)`);
    if (/通訊錄|分機/.test(name)) targetKbIds.add(d.KB_ID || d.kb_id);
  });

  // 先降門檻 score_threshold=0（對所有 通訊錄 KB 做，包括沒巨 chunks 的）
  console.log('\n2) 把 通訊錄 系列 KB 的 score_threshold 設為 0');
  // 為了完整，也抓 search KB 過的 — 從 admin 可見的就改
  for (const id of targetKbIds) {
    const r = await req('PUT', `${SERVER}/api/kb/${id}`,
      { ...auth, 'Content-Type': 'application/json' },
      JSON.stringify({ score_threshold: 0 }),
    );
    console.log(`   PUT ${id.slice(0,8)} score_threshold=0 → ${r.status}`);
  }

  // 觸發 reparse-oversized（自動重跑所有巨型 chunks 的文件）
  console.log('\n3) 觸發 reparse（threshold=5000，所有巨型 chunks 的文件會重做）');
  const rep = await req('POST', `${SERVER}/api/kb/admin/health/reparse-oversized`,
    { ...auth, 'Content-Type': 'application/json' },
    JSON.stringify({ threshold: 5000 }),
  );
  if (rep.status >= 300) { console.error('reparse 失敗', rep.body); process.exit(1); }
  console.log(`   queued=${rep.body.queued}, failed=${rep.body.failed}`);
  (rep.body.queued_docs || []).forEach(d => console.log(`   ✓ ${d.filename}`));
  (rep.body.failed_docs || []).forEach(d => console.log(`   ✗ ${d.filename}: ${d.reason}`));

  console.log('\n完成。後台會跑 reparse，幾分鐘後可以在 KB 文件列表看狀態變 ready。');
  console.log('之後再查 鍾漢成 應該就會同時回富東 + 香港等所有 sheet。');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
