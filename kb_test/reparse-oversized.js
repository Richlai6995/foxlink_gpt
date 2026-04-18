'use strict';
/**
 * Admin maintenance script — 找出所有 chunks 超過 max_size 的文件，並觸發重新解析。
 *
 * 原因：2026-04-18 之前 chunkRegular 有 bug（超過 max_size 的 paragraph 不切），
 *       導致部分文件 chunks 過大 → embedding 失真 → 檢索不到內容。
 *       修正後的 chunker 需要重跑一次 parse 才會生效，所以要 reparse 既有文件。
 *
 * 使用方式
 *   1) 先確認 server 已 deploy 修正後的 code（dev: nodemon 自動；K8S: ./deploy.sh）
 *   2) 設定 SERVER + TOKEN env（也可用 ADMIN_USER / ADMIN_PASSWORD login）
 *   3) 執行：
 *      node kb_test/reparse-oversized.js            # dry run：只列出不執行
 *      node kb_test/reparse-oversized.js --execute  # 真的觸發重新解析
 *
 * Env 變數
 *   SERVER           server URL（預設 http://localhost:3007）
 *   TOKEN            admin bearer token（若無則用 ADMIN_USER/PASSWORD 登入）
 *   ADMIN_USER       預設 ADMIN
 *   ADMIN_PASSWORD   預設讀取 server/.env 的 DEFAULT_ADMIN_PASSWORD
 *   THRESHOLD        chunk 大小門檻（預設 1100）
 */

const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');

// 解析參數
const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const THRESHOLD = Number(process.env.THRESHOLD || 1100);
const SERVER = process.env.SERVER || 'http://localhost:3007';
const ADMIN_USER = process.env.ADMIN_USER || 'ADMIN';

// 若沒 TOKEN，從 server/.env 讀 DEFAULT_ADMIN_PASSWORD
function readEnvDefault(key) {
  try {
    const txt = fs.readFileSync(path.join(__dirname, '../server/.env'), 'utf8');
    const m = txt.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm'));
    return m ? m[1].replace(/^["']|["']$/g, '') : '';
  } catch { return ''; }
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || readEnvDefault('DEFAULT_ADMIN_PASSWORD');

async function request(method, url, headers = {}, body = null) {
  const u = new URL(url);
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'reparse-oversized', ...headers },
    };
    const req = mod.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function login() {
  if (process.env.TOKEN) return process.env.TOKEN;
  if (!ADMIN_PASSWORD) throw new Error('TOKEN 或 ADMIN_PASSWORD 其中之一必須提供');
  const r = await request('POST', `${SERVER}/api/auth/login`,
    { 'Content-Type': 'application/json' },
    JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
  );
  if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

async function main() {
  console.log(`[reparse-oversized] server=${SERVER}, threshold=${THRESHOLD}, execute=${EXECUTE}`);

  const token = await login();
  const auth = { Authorization: `Bearer ${token}` };

  // 1) 先列出所有受影響的文件
  const listRes = await request('GET', `${SERVER}/api/kb/admin/health/oversized-docs?threshold=${THRESHOLD}`, auth);
  if (listRes.status !== 200) {
    console.error(`list failed: ${listRes.status}`, listRes.body);
    process.exit(1);
  }
  const { count, docs } = listRes.body;
  console.log(`\n受影響文件：${count} 份\n`);

  if (count === 0) {
    console.log('✓ 沒有 chunk 超過門檻，所有文件都是新 chunker 產生的，不需重跑。');
    return;
  }

  // 表格輸出
  const header = ['KB', '擁有者', '檔名', '類型', '大小', 'chunks', '最大 chunk', '超標數'];
  const rows = docs.map((d) => [
    String(d.KB_NAME || d.kb_name || '').slice(0, 25),
    String(d.CREATOR_NAME || d.creator_name || '').slice(0, 15),
    String(d.FILENAME || d.filename || '').slice(0, 40),
    String(d.FILE_TYPE || d.file_type || ''),
    fmtBytes(Number(d.FILE_SIZE || d.file_size || 0)),
    String(d.CHUNK_COUNT || d.chunk_count || 0),
    fmtBytes(Number(d.MAX_CHUNK_LEN || d.max_chunk_len || 0)),
    String(d.OVERSIZED_COUNT || d.oversized_count || 0),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cols) => cols.map((c, i) => c.padEnd(widths[i])).join(' | ');
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('-+-'));
  for (const r of rows) console.log(line(r));

  const totalChunks = docs.reduce((s, d) => s + Number(d.CHUNK_COUNT || d.chunk_count || 0), 0);
  console.log(`\n合計 ${count} 份文件，${totalChunks} 個 chunks 會被刪除並重新向量化。`);

  if (!EXECUTE) {
    console.log('\n這是 dry-run 模式。要實際執行請加 --execute flag：');
    console.log(`  node kb_test/reparse-oversized.js --execute`);
    return;
  }

  // 2) 執行 reparse
  console.log('\n[reparse-oversized] 開始觸發重新解析...');
  const execRes = await request('POST', `${SERVER}/api/kb/admin/health/reparse-oversized`,
    { ...auth, 'Content-Type': 'application/json' },
    JSON.stringify({ threshold: THRESHOLD }),
  );
  if (execRes.status >= 300) {
    console.error(`reparse failed: ${execRes.status}`, execRes.body);
    process.exit(1);
  }
  const { queued, failed, failed_docs } = execRes.body;
  console.log(`\n✓ 已排入 ${queued} 份文件重新解析（背景處理）`);
  if (failed > 0) {
    console.log(`✗ ${failed} 份失敗：`);
    for (const f of failed_docs) console.log(`  - ${f.filename || f.doc_id}: ${f.reason}`);
  }
  console.log('\n背景處理中，進度可在 KB 文件列表觀察（status: processing → ready）。');
  console.log('Server log 會顯示 [KB] Processing / [KB] Doc ... done.');
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
