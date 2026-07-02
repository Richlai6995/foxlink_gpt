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
const engine = require('../services/bomCostEngine');
const { seedRival3Cn } = require('./seed-cleansheet-fixtures');

const val = (row) => (row ? Object.values(row)[0] : undefined);
const XL = path.resolve(__dirname, '../../../docs/Rival 3 Gen2 uni bom_112624_v1_Internal_Troy_Amber rev2.xlsx');

(async () => {
  await init();
  const db = require('../../database-oracle').db;
  let pass = true;
  const mark = (ok) => { if (!ok) pass = false; return ok ? '✓' : '✗'; };

  console.log('\n=== B-1 · EE BOM 匯入 + material rollup ===\n');

  // 前置:Rival3 project(重用 cleansheet fixture 的 project + case_factory)
  const { projectId, caseFactoryId } = await seedRival3Cn(db);
  console.log(`[0] Rival3 project id=${projectId} · case_factory=${caseFactoryId} · Excel=${path.basename(XL)}`);

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

  // 4. B-2a · rollup 接引擎:computeCase 用 BOM material(取代 fixture motherboard 8.683)
  console.log(`\n[4] B-2a · rollup 接引擎(computeCase bomInstanceId → material_true = BOM rollup)`);
  const out = await engine.computeCase(db, { caseFactoryId, bomInstanceId: r2.bomInstanceId, persist: true, computedBy: 1 });
  const val2 = (row) => (row ? Object.values(row)[0] : undefined);
  const matTrue = Number(val2(await db.prepare(`SELECT material_true_usd FROM bom_cs_run_result WHERE run_id=?`).get(out.runId)));
  console.log(`    ${mark(Math.abs(matTrue - roll2.materialUsd) < 1e-4)}  run_result.material_true = ${matTrue.toFixed(6)}(= BOM rollup ${roll2.materialUsd.toFixed(6)})`);
  console.log(`    ${mark(Math.abs(out.costBreakdown.material - roll2.materialUsd) < 1e-4)}  costBreakdown.material 來自 BOM(非 fixture 8.683)`);
  console.log(`    · MVA=${out.costBreakdown.mva.toFixed(4)} · total(EE-only material)=${out.costBreakdown.total.toFixed(4)}`);
  console.log(`    ⚠ total 為 EE-only 材料(6.017)· 全材料見 [5]`);

  // 5. B-2b · 匯入 EE+ME+PKG 進同 instance → 全材料 rollup 對 Unit Cost Material Cost 8.517
  console.log(`\n[5] B-2b · EE+ME+PKG 全材料(對 Unit Cost Black Material 8.51683)`);
  const r5 = await importer.importBom(db, { filePath: XL, projectId, sheetKeys: ['EE', 'ME', 'PKG'] });
  console.log(`    sections: ${r5.sections.map((s) => `${s.category}:${s.itemCount}`).join(' · ')} · items=${r5.itemCount} mfg=${r5.mfgCount}`);
  const roll5 = await importer.rollupMaterial(db, r5.bomInstanceId);
  const bc = roll5.byCategory;
  const G = { EE: 6.017395, ME: 1.67134, PKG: 0.828095, MAT: 8.51683 };
  console.log(`    ${mark(Math.abs((bc.EE || 0) - G.EE) < 0.01)}  EE  = ${(bc.EE || 0).toFixed(6)}  golden ${G.EE}`);
  console.log(`    ${mark(Math.abs((bc.ME || 0) - G.ME) < 0.01)}  ME  = ${(bc.ME || 0).toFixed(6)}  golden ${G.ME}`);
  console.log(`    ${mark(Math.abs((bc.PKG || 0) - G.PKG) < 0.01)}  PKG = ${(bc.PKG || 0).toFixed(6)}  golden ${G.PKG}`);
  const matEps = Math.abs(roll5.materialUsd - G.MAT);
  console.log(`    ${mark(matEps < 0.01)}  全材料 = ${roll5.materialUsd.toFixed(6)}  golden 8.51683  Δ=${matEps.toFixed(6)}`);

  // 接引擎:material_true = 全材料 8.517
  const out5 = await engine.computeCase(db, { caseFactoryId, bomInstanceId: r5.bomInstanceId, persist: true, computedBy: 1 });
  const mat5 = Number(val2(await db.prepare(`SELECT material_true_usd FROM bom_cs_run_result WHERE run_id=?`).get(out5.runId)));
  console.log(`    ${mark(Math.abs(mat5 - roll5.materialUsd) < 1e-4)}  run_result.material_true = ${mat5.toFixed(6)}(= 全材料)`);
  console.log(`    · MVA=${out5.costBreakdown.mva.toFixed(4)}(≈Unit Cost MVA 1.8558)· total=${out5.costBreakdown.total.toFixed(4)}`);
  console.log(`    ⚠ 引擎 total ≠ Unit Cost 11.12:引擎 SG&A+Profit=(MVA+MB)×0.16 %-based,Unit Cost 用 flat 0.75 → 慣例分歧待拍板(見 doc)`);

  console.log(`\n=== 結果:${pass ? '✅ B-2b 通過(EE+ME+PKG 全材料 8.517 對 Unit Cost ε<0.01 + 接引擎)' : '❌ 有 FAIL(見上 ✗)'} ===\n`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('B-1 test ERROR:', e.message, e.stack); process.exit(2); });
