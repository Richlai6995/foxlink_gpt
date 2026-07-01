#!/usr/bin/env node
/**
 * verify-bom-013d.js — 驗證 migration 013d(Factory Matrix + audit · S0-BOM 收尾)
 *                       並總結 BOM superset 46 表全到位
 *
 * 用法(server/ 目錄):node scripts/verify-bom-013d.js
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
  const tableExists = async (t) => (await cnt(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name = UPPER(?)`, t)) > 0;

  console.log('\n=== Migration 013d · Factory Matrix + audit 驗證 ===\n');
  const D = ['PROJECT_FACTORY_MATRIX', 'PFM_FACTORY', 'PFM_PKG_OPTION', 'PFM_CELL', 'BOM_AUDIT_LOG', 'BOM_SETTINGS_ADMIN_GRANT', 'BOM_CS_BASELINE_DIFF'];
  console.log('[1] 7 表存在');
  for (const t of D) console.log(`    ${mark(await tableExists(t))}  ${t}`);

  console.log('\n[2] pfm_cell UNIQUE(多維唯一終點)');
  const uq = await cnt(`SELECT COUNT(*) AS C FROM user_indexes WHERE index_name='UQ_PFMCELL'`);
  console.log(`    ${mark(uq > 0)}  uq_pfmcell`);

  // ── BOM superset 表總結(S1d 移除設備舊 4 表 → 42 · 另 013f 加 equip_area/facility 由 engine test 驗)──
  console.log('\n=== BOM superset 42 表總結(013a–d · 扣設備舊 4 表)===');
  const ALL = [
    'BOM_FACTORY','BOM_PROCESS_CATALOG','BOM_CS_COMPONENT','BOM_FACTORY_BASELINE',
    'BOM_FACTORY_IDL_ROLE','BOM_FACTORY_IDL_LINEDEP_WAGE',
    'BOM_FACTORY_CONSUMABLE','BOM_FACTORY_SMT_POINT_RULE','BOM_PROCESS_TEMPLATE','BOM_PROCESS_TEMPLATE_STEP',
    'BOM_CATEGORY_DICT','BOM_CATEGORY_MARKUP_DEFAULT',
    'BOM_INSTANCE','BOM_SECTION','BOM_CATEGORY','BOM_ITEM','BOM_AI_CACHE','BOM_ITEM_FLK','BOM_ITEM_MFG',
    'BOM_ITEM_PRICE_SNAPSHOT','BOM_ITEM_PRICE_TIER','BOM_ERP_ITEM_INDEX',
    'BOM_CS_CASE_FACTORY','BOM_CS_CASE_PROCESS','BOM_CS_CASE_IDL_ALLOC','BOM_CS_CASE_CONSUMABLE',
    'BOM_CS_CASE_QTY_SCENARIO','BOM_CS_CASE_PKG','BOM_CS_CASE_PKG_ITEM','BOM_CS_CASE_PKG_MODULE_INCLUDE',
    'BOM_CS_CASE_MACRO_PROCESS','BOM_CS_CASE_SMT_POINT','BOM_CS_RUN','BOM_CS_RUN_CELL','BOM_CS_RUN_RESULT',
    'PROJECT_FACTORY_MATRIX','PFM_FACTORY','PFM_PKG_OPTION','PFM_CELL','BOM_AUDIT_LOG','BOM_SETTINGS_ADMIN_GRANT','BOM_CS_BASELINE_DIFF',
    // ⚠️ S1d 移除:BOM_EQUIP_CATEGORY_CATALOG / BOM_FACTORY_DEP_YEARS / BOM_FACTORY_EQUIP_CATEGORY_PRICE / BOM_CS_CASE_EQUIP_CATEGORY(013h DROP)
  ];
  let present = 0;
  for (const t of ALL) if (await tableExists(t)) present++;
  const okAll = present === ALL.length;
  if (!okAll) pass = false;
  console.log(`    ${okAll ? '✓' : '✗'}  ${present}/${ALL.length} 表存在`);
  // RBAC 4 表(012)順帶確認
  let rbac = 0;
  for (const t of ['RBAC_FUNCTION','RBAC_ROLE_PERMISSION','RBAC_SOD_EXCLUSION','RBAC_GATE_CONFIG']) if (await tableExists(t)) rbac++;
  console.log(`    ${mark(rbac === 4)}  RBAC 地基 ${rbac}/4 表(012)`);

  console.log(`\n=== 結果:${pass ? '✅ 013d 通過 · S0 全數到位(RBAC 4 + BOM 46)' : '❌ 有缺項'} ===\n`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('verify-bom-013d ERROR:', e.message); process.exit(2); });
