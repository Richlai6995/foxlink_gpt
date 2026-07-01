#!/usr/bin/env node
/**
 * test-bom-import.js — B-1 離線 regression:EE BOM 匯入正規化 + material rollup 對 golden
 *
 * 用法(server/ 目錄):node projects-platform/scripts/test-bom-import.js
 * 需 ENABLE_CORTEX_BOM=true + 013a-i migrate + Rival3 Gen2 BOM Excel 在 docs/。
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const path = require('path');
const { init } = require('../../database-oracle');
const importer = require('../services/bomImportService');
const { seedRival3Cn } = require('./seed-cleansheet-fixtures');

const val = (row) => (row ? Object.values(row)[0] : undefined);
const XL = path.resolve(__dirname, '../../../docs/Rival 3 Gen2 uni bom_112624_v1_Internal_Troy_Amber rev2.xlsx');

(async () => {
  await init();
  const db = require('../../database-oracle').db;
  let pass = true;
  const mark = (ok) => { if (!ok) pass = false; return ok ? '✓' : '✗'; };

  console.log('\n=== B-1 · EE BOM 匯入 + material rollup ===\n');

  // 前置:Rival3 project(重用 cleansheet fixture 的 project)
  const { projectId } = await seedRival3Cn(db);
  console.log(`[0] Rival3 project id=${projectId} · Excel=${path.basename(XL)}`);

  // 1. 匯入 EE BOM(CN · shared)
  const r1 = await importer.importEeBom(db, { filePath: XL, projectId, factoryCode: 'CN' });
  console.log(`\n[1] importEeBom`);
  console.log(`    ${mark(r1.itemCount >= 60 && r1.itemCount <= 75)}  item 數 = ${r1.itemCount}(期望 ~67)`);
  console.log(`    ${mark(r1.mfgCount > r1.itemCount)}  mfg 數 = ${r1.mfgCount}(含替代供應商 · 應 > item)`);
  console.log(`    ${mark(r1.categoryCount >= 5)}  category 數 = ${r1.categoryCount}(Capacitor/Resistor/IC/LED/PCB…)`);

  // 2. material rollup 對 golden(Unit Cost EE_black 6.017395)
  const roll = await importer.rollupMaterial(db, r1.bomInstanceId);
  const G_EE_BLACK = 6.017395;
  const eps = Math.abs(roll.materialUsd - G_EE_BLACK);
  console.log(`\n[2] material rollup(Σ qty × applied_price)`);
  console.log(`    ${mark(eps < 0.01)}  rollup = ${roll.materialUsd.toFixed(6)}  golden EE_black=${G_EE_BLACK}  Δ=${eps.toFixed(6)}`);
  console.log(`    (rollup item 數=${roll.itemCount})`);

  // 3. 冪等:再匯入一次 → item 數不變(不重複)
  const r2 = await importer.importEeBom(db, { filePath: XL, projectId, factoryCode: 'CN' });
  const roll2 = await importer.rollupMaterial(db, r2.bomInstanceId);
  console.log(`\n[3] 冪等(再匯入一次)`);
  console.log(`    ${mark(r2.itemCount === r1.itemCount)}  item 數穩定 = ${r2.itemCount}(= 第一次 ${r1.itemCount})`);
  const nInst = Number(val(await db.prepare(`SELECT COUNT(*) AS C FROM bom_instance WHERE project_id=?`).get(projectId)));
  console.log(`    ${mark(nInst === 1)}  bom_instance 只剩 1(舊的被刪 · 實=${nInst})`);
  console.log(`    ${mark(Math.abs(roll2.materialUsd - roll.materialUsd) < 1e-6)}  rollup 一致 = ${roll2.materialUsd.toFixed(6)}`);

  console.log(`\n=== 結果:${pass ? '✅ B-1 通過(EE BOM 匯入正規化 + rollup 6.017 ε<0.01 + 冪等)' : '❌ 有 FAIL(見上 ✗)'} ===\n`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('B-1 test ERROR:', e.message, e.stack); process.exit(2); });
