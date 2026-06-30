#!/usr/bin/env node
/**
 * verify-bom-013b.js — 驗證 migration 013b(BOM superset Layer 3 結構鏈)
 *
 * 用法(server/ 目錄):node scripts/verify-bom-013b.js
 * 檢查:10 表存在 + price_tier 雙價 VIRTUAL 欄 + erp_index VECTOR 欄 + bom_instance→projects FK
 * 純讀 · idempotent。
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { init } = require('../database-oracle');
const firstVal = (row) => (row ? Object.values(row)[0] : undefined);

(async () => {
  await init();
  const db = require('../database-oracle').db;
  const cnt = async (sql, ...a) => Number(firstVal(await db.prepare(sql).get(...a)));

  let pass = true;
  const mark = (ok) => { if (!ok) pass = false; return ok ? '✓' : '✗'; };

  console.log('\n=== Migration 013b · BOM superset Layer 3 結構鏈 驗證 ===\n');

  const TABLES = [
    'BOM_INSTANCE', 'BOM_SECTION', 'BOM_CATEGORY', 'BOM_ITEM', 'BOM_AI_CACHE',
    'BOM_ITEM_FLK', 'BOM_ITEM_MFG', 'BOM_ITEM_PRICE_SNAPSHOT', 'BOM_ITEM_PRICE_TIER', 'BOM_ERP_ITEM_INDEX',
  ];
  console.log('[1] 10 表存在');
  for (const t of TABLES) {
    const c = await cnt(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name = UPPER(?)`, t);
    console.log(`    ${mark(c > 0)}  ${t}`);
  }

  console.log('\n[2] bom_item_price_tier 雙價 VIRTUAL 欄(true_cost_usd / markup_pct)');
  for (const c of ['TRUE_COST_USD', 'MARKUP_PCT']) {
    const v = await db.prepare(
      `SELECT virtual_column FROM user_tab_cols WHERE table_name='BOM_ITEM_PRICE_TIER' AND column_name = UPPER(?)`,
    ).get(c).catch(() => null);
    const isVirtual = v && String(firstVal(v)).toUpperCase() === 'YES';
    console.log(`    ${mark(!!isVirtual)}  ${c}  virtual=${v ? firstVal(v) : '無此欄'}`);
  }

  console.log('\n[3] bom_erp_item_index.embedding 型別(期望 VECTOR)');
  const dt = await db.prepare(
    `SELECT data_type FROM user_tab_columns WHERE table_name='BOM_ERP_ITEM_INDEX' AND column_name='EMBEDDING'`,
  ).get().catch(() => null);
  console.log(`    ${mark(dt && /VECTOR/i.test(String(firstVal(dt))))}  embedding data_type = ${dt ? firstVal(dt) : '無'}`);

  console.log('\n[4] bom_instance → projects(id) FK');
  const fk = await cnt(
    `SELECT COUNT(*) AS C FROM user_constraints WHERE table_name='BOM_INSTANCE' AND constraint_type='R' AND constraint_name='FK_BOMINST_PROJ'`,
  );
  console.log(`    ${mark(fk > 0)}  FK_BOMINST_PROJ 存在(case=project)`);

  console.log(`\n=== 結果:${pass ? '✅ 013b 全數通過' : '❌ 有缺項'} ===\n`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('verify-bom-013b ERROR:', e.message); process.exit(2); });
