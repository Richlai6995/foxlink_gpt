'use strict';
/**
 * KB Retrieval 回歸測試 — 跑 golden-queries.json 裡的 query，檢查 top-K 結果
 * 有沒有包含 expected 的關鍵字。
 *
 * **直接呼叫 services/kbRetrieval.js**（不走 HTTP），這樣：
 *   - 不需 auth
 *   - 測的是 service 本體（最少 moving parts）
 *   - 可在 CI 跑（只要 Oracle 連得上 + GEMINI 設好）
 *
 * 使用方式：
 *   node kb_test/regression.js [--kb <name>] [--query <text>]
 */

const fs = require('fs');
const path = require('path');

// 載入 .env
const envContent = fs.readFileSync(path.join(__dirname, '../server/.env'), 'utf8');
envContent.split(/\r?\n/).forEach((line) => {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
});

// Change cwd to server/ 讓 relative paths (./certs/vertex-ai-sa.json 等) work
process.chdir(path.resolve(__dirname, '../server'));

function checkExpectation(results, spec) {
  const hits = results.filter((r) => {
    const content = r.content || '';
    return spec.expected_chunk_keywords_any.some((kw) => content.includes(kw));
  });
  const passed = hits.length >= (spec.expected_min_hits || 1);
  return { passed, hit_count: hits.length, needed: spec.expected_min_hits || 1 };
}

async function main() {
  const args = process.argv.slice(2);
  const filterKb    = (args.indexOf('--kb')    >= 0) ? args[args.indexOf('--kb')+1]    : null;
  const filterQuery = (args.indexOf('--query') >= 0) ? args[args.indexOf('--query')+1] : null;

  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-queries.json'), 'utf8'));
  const queries = golden.queries
    .filter((q) => !filterKb || q.kb_name === filterKb)
    .filter((q) => !filterQuery || q.query === filterQuery);

  console.log(`[regression] queries=${queries.length}`);

  const o = require(path.resolve(__dirname, '../server/database-oracle'));
  await o.init();
  const kbRows = await o.db.prepare('SELECT * FROM knowledge_bases').all();
  const kbByName = new Map();
  for (const r of kbRows) kbByName.set(r.NAME || r.name, r);
  console.log(`[regression] 載入 ${kbByName.size} 個 KB`);

  const { retrieveKbChunks } = require(path.resolve(__dirname, '../server/services/kbRetrieval'));

  const results = [];
  for (const q of queries) {
    const kb = kbByName.get(q.kb_name);
    if (!kb) {
      console.log(`  SKIP [${q.kb_name}] "${q.query}" — KB 不存在`);
      results.push({ kb: q.kb_name, query: q.query, status: 'skipped-no-kb' });
      continue;
    }
    try {
      const { results: chunks, stats } = await retrieveKbChunks(o.db, {
        kb, query: q.query, topK: 10, source: 'regression',
      });
      const check = checkExpectation(chunks, q);
      const mark = check.passed ? '✓ PASS' : '✗ FAIL';
      const tokenList = (stats.tokens_extracted || []).join(',');
      console.log(`  ${mark} [${q.kb_name}] "${q.query}" — hits ${check.hit_count}/${check.needed}  (${stats.elapsed_ms}ms, tokens=[${tokenList}])`);
      results.push({
        kb: q.kb_name, query: q.query,
        status: check.passed ? 'pass' : 'fail',
        hits: check.hit_count,
        needed: check.needed,
        elapsed_ms: stats.elapsed_ms,
        stats,
      });
    } catch (e) {
      console.log(`  ERROR [${q.kb_name}] "${q.query}": ${e.message}`);
      results.push({ kb: q.kb_name, query: q.query, status: 'error', detail: e.message });
    }
  }

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const other  = results.length - passed - failed;
  console.log(`\n[regression] 結果: ${passed}/${results.length} PASS, ${failed} FAIL, ${other} SKIP/ERROR`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
