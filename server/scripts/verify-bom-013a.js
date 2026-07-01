#!/usr/bin/env node
/**
 * verify-bom-013a.js — 驗證 migration 013a(BOM superset Layer 1/2 master)
 *
 * 用法(server/ 目錄):node scripts/verify-bom-013a.js
 * 檢查:15 表存在 + 關鍵 seed 數(廠 3 / 製程 9 / component 20 / 模板 3 / markup 6)
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

  console.log('\n=== Migration 013a · BOM superset Layer 1/2 master 驗證 ===\n');

  const TABLES = [
    'BOM_FACTORY', 'BOM_PROCESS_CATALOG', 'BOM_CS_COMPONENT',
    'BOM_FACTORY_BASELINE', 'BOM_FACTORY_IDL_ROLE', 'BOM_FACTORY_IDL_LINEDEP_WAGE',
    'BOM_FACTORY_CONSUMABLE',
    'BOM_FACTORY_SMT_POINT_RULE', 'BOM_PROCESS_TEMPLATE', 'BOM_PROCESS_TEMPLATE_STEP',
    'BOM_CATEGORY_DICT', 'BOM_CATEGORY_MARKUP_DEFAULT',
    // ⚠️ S1d 移除:BOM_EQUIP_CATEGORY_CATALOG / BOM_FACTORY_DEP_YEARS / BOM_FACTORY_EQUIP_CATEGORY_PRICE(013h DROP)
  ];
  console.log(`[1] 12 表存在`);
  for (const t of TABLES) {
    const c = await cnt(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name = UPPER(?)`, t);
    console.log(`    ${mark(c > 0)}  ${t}`);
  }

  console.log('\n[2] 關鍵 seed 數');
  const checks = [
    ['bom_factory', `SELECT COUNT(*) AS C FROM bom_factory`, 3],
    ['bom_process_catalog', `SELECT COUNT(*) AS C FROM bom_process_catalog`, 9],
    ['bom_cs_component', `SELECT COUNT(*) AS C FROM bom_cs_component`, 20],
    ['bom_process_template', `SELECT COUNT(*) AS C FROM bom_process_template`, 3],
    ['bom_category_markup_default', `SELECT COUNT(*) AS C FROM bom_category_markup_default`, 6],
  ];
  for (const [name, sql, expect] of checks) {
    const c = await cnt(sql).catch(() => -1);
    console.log(`    ${mark(c >= expect)}  ${name} = ${c}(期望 ≥ ${expect})`);
  }

  console.log('\n[3] 20 component mask 抽驗(unified §3)');
  const mvaTotal = await db.prepare(`SELECT model_applicability, fallback_into_code FROM bom_cs_component WHERE component_code='IDL_CPU'`).get().catch(() => null);
  const okMask = mvaTotal && /FULL_MVA/i.test(String(firstVal(mvaTotal)));
  console.log(`    ${mark(!!okMask)}  IDL_CPU model=${mvaTotal && Object.values(mvaTotal)[0]} fallback=${mvaTotal && Object.values(mvaTotal)[1]}(期望 FULL_MVA → OVERHEAD_4PCT)`);

  console.log(`\n=== 結果:${pass ? '✅ 013a 全數通過' : '❌ 有缺項'} ===\n`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('verify-bom-013a ERROR:', e.message); process.exit(2); });
