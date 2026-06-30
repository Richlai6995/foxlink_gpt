#!/usr/bin/env node
/**
 * verify-bom-013c.js — 驗證 migration 013c(BOM superset 案級 cleansheet 計算鏈)
 *
 * 用法(server/ 目錄):node scripts/verify-bom-013c.js
 * 檢查:14 表存在 + case_factory→projects FK + run_result 4 個 VIRTUAL 欄
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

  console.log('\n=== Migration 013c · BOM superset 案級 cleansheet 計算鏈 驗證 ===\n');

  const TABLES = [
    'BOM_CS_CASE_FACTORY', 'BOM_CS_CASE_PROCESS', 'BOM_CS_CASE_IDL_ALLOC', 'BOM_CS_CASE_EQUIP_CATEGORY',
    'BOM_CS_CASE_CONSUMABLE', 'BOM_CS_CASE_QTY_SCENARIO', 'BOM_CS_CASE_PKG', 'BOM_CS_CASE_PKG_ITEM',
    'BOM_CS_CASE_PKG_MODULE_INCLUDE', 'BOM_CS_CASE_MACRO_PROCESS', 'BOM_CS_CASE_SMT_POINT',
    'BOM_CS_RUN', 'BOM_CS_RUN_CELL', 'BOM_CS_RUN_RESULT',
  ];
  console.log('[1] 14 表存在');
  for (const t of TABLES) {
    const c = await cnt(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name = UPPER(?)`, t);
    console.log(`    ${mark(c > 0)}  ${t}`);
  }

  console.log('\n[2] bom_cs_case_factory → projects(id) FK(BOM 接 projects 核心)');
  const fk = await cnt(`SELECT COUNT(*) AS C FROM user_constraints WHERE table_name='BOM_CS_CASE_FACTORY' AND constraint_type='R' AND constraint_name='FK_CSF_CASE'`);
  console.log(`    ${mark(fk > 0)}  FK_CSF_CASE 存在`);

  console.log('\n[3] bom_cs_run_result 4 個 VIRTUAL 欄(total_true/total_quote/margin_amount/gross_margin_pct)');
  for (const c of ['TOTAL_TRUE_USD', 'TOTAL_QUOTE_USD', 'MARGIN_AMOUNT_USD', 'GROSS_MARGIN_PCT']) {
    const v = await db.prepare(`SELECT virtual_column FROM user_tab_cols WHERE table_name='BOM_CS_RUN_RESULT' AND column_name = UPPER(?)`).get(c).catch(() => null);
    const isVirtual = v && String(firstVal(v)).toUpperCase() === 'YES';
    console.log(`    ${mark(!!isVirtual)}  ${c}  virtual=${v ? firstVal(v) : '無此欄'}`);
  }

  console.log('\n[4] bom_cs_case_pkg_item 雙價 VIRTUAL(true_cost_usd/markup_pct)');
  for (const c of ['TRUE_COST_USD', 'MARKUP_PCT']) {
    const v = await db.prepare(`SELECT virtual_column FROM user_tab_cols WHERE table_name='BOM_CS_CASE_PKG_ITEM' AND column_name = UPPER(?)`).get(c).catch(() => null);
    const isVirtual = v && String(firstVal(v)).toUpperCase() === 'YES';
    console.log(`    ${mark(!!isVirtual)}  ${c}  virtual=${v ? firstVal(v) : '無此欄'}`);
  }

  console.log(`\n=== 結果:${pass ? '✅ 013c 全數通過' : '❌ 有缺項'} ===\n`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('verify-bom-013c ERROR:', e.message); process.exit(2); });
