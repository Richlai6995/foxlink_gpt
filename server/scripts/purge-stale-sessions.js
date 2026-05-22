'use strict';

/**
 * purge-stale-sessions.js — 掃 Redis 上所有 `sess:*` session,清掉缺工號的殘留 payload。
 *
 * 背景:
 *   2026-05-22 Joan_Lu (id=999, employee_id=9759) 撞到 MCP X-User-Token 帶 EmpCd=999 bug
 *   — session 是在 LDAP 還沒同步 employee_id 時建立的,後來 DB 補了 9759,但 session payload
 *   還凍在當初的空值狀態。verifyToken 只 touchSession 延 TTL 不重 build,所以一直錯下去。
 *
 *   mcpClient.js 已修(2026-05-22)— 缺工號改 throw,但**舊 session 殘留**還在,需要這個
 *   script 掃一次 + 砍掉,讓受影響 user 重登一次重建 session。
 *
 * 跑法:
 *   cd server && node scripts/purge-stale-sessions.js           # dry-run(預設)
 *   cd server && node scripts/purge-stale-sessions.js --apply   # 真的砍
 *
 * 環境:
 *   需 REDIS_URL 指到正式 Redis(否則跑去 in-memory,根本沒 session)
 */

require('dotenv').config();

const redis = require('../services/redisClient');

const DRY_RUN = !process.argv.includes('--apply');

function isStale(session) {
  if (!session || typeof session !== 'object') return true;
  // employee_id 缺 / 空字串 / null / 'null' / 'undefined' 都算殘留
  const empId = session.employee_id;
  if (empId === null || empId === undefined) return true;
  const s = String(empId).trim();
  if (s === '' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return true;
  return false;
}

(async () => {
  console.log(`[purge-stale-sessions] mode = ${DRY_RUN ? 'DRY-RUN (no delete)' : 'APPLY (will DELETE)'}`);
  console.log(`[purge-stale-sessions] REDIS_URL = ${process.env.REDIS_URL || '(unset — falling back to in-memory)'}\n`);

  const store = redis.getStore();
  // 直接拿到底層 client(MemoryStore 或 ioredis)
  const isMemory = !store.client;
  let keys = [];

  if (isMemory) {
    // MemoryStore — 直接拿 store.store Map
    for (const k of store.store.keys()) {
      if (k.startsWith('sess:')) keys.push(k);
    }
  } else {
    // ioredis — SCAN 掃 sess:*
    await new Promise((resolve, reject) => {
      const stream = store.client.scanStream({ match: 'sess:*', count: 100 });
      stream.on('data', batch => keys.push(...batch));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
  }

  console.log(`Found ${keys.length} session key(s) in Redis.\n`);

  const stale = [];
  const ok    = [];

  for (const key of keys) {
    let raw;
    if (isMemory) {
      const entry = store.store.get(key);
      if (!entry) continue;
      if (entry.exp && Date.now() > entry.exp) continue;
      raw = entry.val;
    } else {
      raw = await store.client.get(key);
    }
    if (!raw) continue;
    let s;
    try { s = JSON.parse(raw); } catch { continue; }

    if (isStale(s)) {
      stale.push({ key, id: s.id, username: s.username, email: s.email, name: s.name, employee_id: s.employee_id });
    } else {
      ok.push({ id: s.id, username: s.username, employee_id: s.employee_id });
    }
  }

  console.log(`=== Stale (no employee_id) ${stale.length} ===`);
  for (const r of stale) {
    console.log(`  id=${r.id}  user=${r.username}  emp_id=${JSON.stringify(r.employee_id)}  email=${r.email}  name=${r.name}`);
  }
  console.log(`\n=== Healthy ${ok.length} ===  (not listed)`);

  if (stale.length === 0) {
    console.log('\nNothing to purge. 👍');
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log(`\n[DRY-RUN] 沒有實際刪除。確認名單後加 --apply 再跑一次。`);
    process.exit(0);
  }

  // APPLY — 真的砍
  let deleted = 0;
  for (const r of stale) {
    try {
      if (isMemory) {
        store.store.delete(r.key);
      } else {
        await store.client.del(r.key);
      }
      console.log(`  DEL ${r.key} (user=${r.username})`);
      deleted++;
    } catch (e) {
      console.error(`  FAIL ${r.key}: ${e.message}`);
    }
  }
  console.log(`\nDone. Purged ${deleted}/${stale.length} stale session(s).`);
  console.log(`受影響 user 下次 API 呼叫會收到 401,登入後會建立新 session,payload 帶完整 employee_id。`);
  process.exit(0);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
