'use strict';
/* KB upload timing test — login, create KB, upload files, poll until ready */
const fs = require('fs');
const path = require('path');
const http = require('http');

const SERVER = 'http://localhost:3007';
const USERNAME = 'ADMIN';
const PASSWORD = 'Foxlink123';

const TEST_DIR = __dirname;
const ALL_FILES = [
  { name: 'Foxlink AI Application Blueprint (1).pdf', label: 'Small-1MB' },
  { name: 'Oracle 10g 2Day Training.pdf',             label: 'Medium-2MB' },
  { name: 'Oracle Performance Tuning & Optimization.pdf', label: 'Large-28MB' },
];
// argv[2] = 'small' | 'medium' | 'large' | 'all' | 'small,medium' etc
const sel = (process.argv[2] || 'small').toLowerCase();
const FILES = sel === 'all'
  ? ALL_FILES
  : ALL_FILES.filter(f => sel.split(',').some(s => f.label.toLowerCase().startsWith(s)));
if (FILES.length === 0) {
  console.error(`No files matched: ${sel}. Use: small | medium | large | all`);
  process.exit(1);
}

function req(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method, hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: headers || {},
    };
    const r = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

// Simple multipart/form-data encoder
function buildMultipart(filePath, filename) {
  const boundary = '----FoxlinkBoundary' + Date.now();
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="files"; filename="${filename}"\r\n` +
    `Content-Type: application/pdf\r\n\r\n`
  );
  const fileBuf = fs.readFileSync(filePath);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, fileBuf, tail]);
  return {
    boundary,
    body,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
  };
}

async function uploadMultipart(url, token, filePath, filename) {
  const m = buildMultipart(filePath, filename);
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method: 'POST', hostname: u.hostname, port: u.port, path: u.pathname,
      headers: { ...m.headers, Authorization: `Bearer ${token}` },
    };
    const r = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed; try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    r.write(m.body);
    r.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function pollDoc(token, kbId, docId, timeoutMs = 30 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await req('GET', `${SERVER}/api/kb/${kbId}/documents`, {
      Authorization: `Bearer ${token}`,
    });
    const doc = (r.body || []).find(d => d.id === docId);
    if (doc) {
      if (doc.status === 'ready') return { doc, wallMs: Date.now() - start };
      if (doc.status === 'error') throw new Error(`Doc failed: ${doc.error_msg || 'unknown'}`);
    }
    await sleep(2000);
  }
  throw new Error('Timeout waiting for doc ready');
}

async function createKb(token, name, dims = 768, pdfOcrMode = 'off') {
  const r = await req('POST', `${SERVER}/api/kb`,
    { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    JSON.stringify({
      name,
      description: 'perf test',
      embedding_dims: dims,
      chunk_strategy: 'regular',
      parse_mode: 'text_only',
      pdf_ocr_mode: pdfOcrMode,
    })
  );
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`createKb failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return r.body;
}

async function main() {
  console.log('=== KB Upload Performance Test ===\n');
  // 1. login
  const loginR = await req('POST', `${SERVER}/api/auth/login`,
    { 'Content-Type': 'application/json' },
    JSON.stringify({ username: USERNAME, password: PASSWORD })
  );
  if (loginR.status !== 200) throw new Error(`login failed: ${JSON.stringify(loginR.body)}`);
  const token = loginR.body.token;
  console.log(`[login] token=${token.slice(0, 8)}...`);

  const results = [];

  // argv[3] = pdf_ocr_mode
  const pdfOcrMode = (process.argv[3] || 'off').toLowerCase();
  if (!['off', 'auto', 'force'].includes(pdfOcrMode)) {
    console.error(`Invalid pdf_ocr_mode: ${pdfOcrMode}. Use: off | auto | force`);
    process.exit(1);
  }
  console.log(`\n--- KB-A (new, dims=768, pdf_ocr_mode=${pdfOcrMode}) ---`);
  const kbA = await createKb(token, `PerfTest-A-${Date.now()}`, 768, pdfOcrMode);
  console.log(`[kb] created id=${kbA.id}`);

  for (const f of FILES) {
    const filePath = path.join(TEST_DIR, f.name);
    const size = fs.statSync(filePath).size;
    console.log(`\n[upload] ${f.label} (${(size / 1024 / 1024).toFixed(2)} MB): ${f.name}`);
    const t0 = Date.now();
    const up = await uploadMultipart(`${SERVER}/api/kb/${kbA.id}/documents`, token, filePath, f.name);
    const uploadMs = Date.now() - t0;
    if (up.status >= 300) {
      console.error(`[upload] FAILED: ${up.status} ${JSON.stringify(up.body)}`);
      continue;
    }
    const docId = up.body[0].id;
    console.log(`[upload] docId=${docId}, uploadReqMs=${uploadMs}ms, polling...`);

    try {
      const { doc, wallMs } = await pollDoc(token, kbA.id, docId);
      console.log(`[done] ${f.label}: wall=${wallMs}ms chunks=${doc.chunk_count} words=${doc.word_count}`);
      results.push({ kb: 'A', label: f.label, sizeMB: (size / 1024 / 1024).toFixed(2), wallMs, chunks: doc.chunk_count, words: doc.word_count });
    } catch (e) {
      console.error(`[done] ${f.label} ERROR:`, e.message);
    }
  }

  console.log('\n=== Summary ===');
  console.table(results);
  console.log('\n※ 詳細分解 (parse/embed/insert/throttle) 請看 server log：');
  console.log('   grep KB-PERF d:/vibe_coding/foxlink_gpt/server/logs/server-2026-04-18.log');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
