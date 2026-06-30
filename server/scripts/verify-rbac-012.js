#!/usr/bin/env node
/**
 * verify-rbac-012.js — 驗證 migration 012(三軸 RBAC 軸① 地基)是否落地
 *
 * 用法(在 server/ 目錄):node scripts/verify-rbac-012.js
 *
 * 檢查:4 RBAC 表 / user_role_definitions 3 新欄 / 11 cortex.* 業務 role
 * 直接查 Oracle,不靠 log。idempotent — 純讀。
 * 注:此 Oracle wrapper 回傳 key 大小寫不定 → 一律大小寫無關取值。
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { init } = require('../database-oracle');

// 大小寫無關取欄位
const pick = (row, name) => {
  if (!row) return undefined;
  const lc = name.toLowerCase();
  for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k];
  return undefined;
};
const firstVal = (row) => (row ? Object.values(row)[0] : undefined);

(async () => {
  await init();
  const db = require('../database-oracle').db;
  const get = (sql, ...a) => db.prepare(sql).get(...a);

  let pass = true;
  const mark = (ok) => { if (!ok) pass = false; return ok ? '✓' : '✗ 缺'; };

  console.log('\n=== Migration 012 · 三軸 RBAC 地基驗證 ===\n');

  console.log('[1] 4 RBAC 表');
  for (const t of ['RBAC_FUNCTION', 'RBAC_ROLE_PERMISSION', 'RBAC_SOD_EXCLUSION', 'RBAC_GATE_CONFIG']) {
    const r = await get(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name = UPPER(?)`, t);
    console.log(`    ${mark(Number(firstVal(r)) > 0)}  ${t}`);
  }

  console.log('\n[2] user_role_definitions 3 新欄(is_system 沿用為 seed,不加)');
  for (const c of ['IS_ACTIVE', 'COPIED_FROM', 'CREATED_BY']) {
    const r = await get(`SELECT COUNT(*) AS C FROM user_tab_columns WHERE table_name='USER_ROLE_DEFINITIONS' AND column_name = UPPER(?)`, c);
    console.log(`    ${mark(Number(firstVal(r)) > 0)}  user_role_definitions.${c}`);
  }

  console.log('\n[3] 11 個 cortex.* 業務 role(與既有 13 system role 共存)');
  const cnt = await get(`SELECT COUNT(*) AS C FROM user_role_definitions WHERE category='cortex'`);
  const n = Number(firstVal(cnt));
  const okCnt = n === 11;
  if (!okCnt) pass = false;
  console.log(`    ${okCnt ? '✓' : '✗'}  cortex role 數 = ${n}(期望 11)`);
  const rows = await db.prepare(
    `SELECT role_code, is_system, is_active FROM user_role_definitions WHERE category='cortex' ORDER BY role_code`,
  ).all().catch(() => []);
  rows.forEach((r) => console.log(`        - ${pick(r, 'role_code')}  (is_system=${pick(r, 'is_system')}, is_active=${pick(r, 'is_active')})`));

  console.log(`\n=== 結果:${pass ? '✅ 012 全數通過' : '❌ 有缺項(見上 ✗)'} ===\n`);
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error('verify-rbac-012 ERROR:', e.message);
  process.exit(2);
});
