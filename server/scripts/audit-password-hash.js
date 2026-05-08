'use strict';

/**
 * Audit users.password 欄位的 hash 化進度。
 *
 * 用途:
 *   - PR-1 上線後驗證 lazy migration 流程
 *   - PR-3 收尾(觀察期結束)時找出仍未登入過的明文 user 處理
 *
 * 不會印 hash / 明文內容,只回統計與身分(供 admin 寄 reset 信)。
 *
 * 跑法:
 *   cd server && node scripts/audit-password-hash.js
 */

require('dotenv').config();
process.env.NLS_LANG = 'AMERICAN_AMERICA.AL32UTF8';

const { init } = require('../database-oracle');

(async () => {
  const db = await init();

  // 1) 確認欄位存在
  const colExists = await db.columnExists('USERS', 'PASSWORD_HASHED');
  console.log(`USERS.PASSWORD_HASHED column exists: ${colExists ? '✅' : '❌'}`);
  if (!colExists) {
    console.error('Migration 未跑成功,先重啟 server 確認 [Migration] log');
    process.exit(2);
  }

  // 2) 整體分布
  const stats = await db.prepare(
    `SELECT password_hashed AS state, COUNT(*) AS n
       FROM users GROUP BY password_hashed ORDER BY password_hashed NULLS LAST`
  ).all();
  console.log('\n=== 整體分布 ===');
  for (const r of stats) {
    const label = r.state === 'Y' ? 'hashed (✅ 安全)'
                : r.state === 'N' ? 'plaintext (⚠️ 待登入後 lazy migrate)'
                : `unknown (${r.state})`;
    console.log(`  ${r.state}: ${r.n} ${label}`);
  }

  // 3) 仍 plaintext 的 user 詳情(供寄 reset 信)
  const plain = await db.prepare(
    `SELECT id, username, role, creation_method, status,
            TO_CHAR(start_date,'YYYY-MM-DD') AS start_date,
            TO_CHAR(end_date,'YYYY-MM-DD') AS end_date
       FROM users WHERE password_hashed = 'N' OR password_hashed IS NULL
       ORDER BY id`
  ).all();
  console.log(`\n=== 仍 plaintext (n=${plain.length}) ===`);
  for (const u of plain.slice(0, 50)) {
    console.log(`  [${u.id}] ${u.username} role=${u.role} method=${u.creation_method || '-'} status=${u.status}`);
  }
  if (plain.length > 50) console.log(`  ... 還有 ${plain.length - 50} 筆`);

  // 4) 防呆:hash 化但 password 看起來不像 bcrypt 的(不該發生)
  const suspect = await db.prepare(
    `SELECT id, username FROM users
      WHERE password_hashed = 'Y'
        AND (LENGTH(password) <> 60 OR SUBSTR(password,1,4) NOT IN ('$2a$','$2b$','$2x$','$2y$'))`
  ).all();
  if (suspect.length) {
    console.log(`\n⚠️ 異常:password_hashed='Y' 但格式不符 bcrypt (n=${suspect.length})`);
    for (const u of suspect.slice(0, 20)) {
      console.log(`  [${u.id}] ${u.username}`);
    }
  } else {
    console.log('\n✅ 所有 password_hashed=Y 的 row 格式皆為合法 bcrypt');
  }

  process.exit(0);
})().catch(e => {
  console.error('audit failed:', e.message);
  process.exit(1);
});
