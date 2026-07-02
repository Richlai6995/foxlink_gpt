#!/usr/bin/env node
/**
 * test-bom-template.js — 標準範本 產生 + 匯入 round-trip
 * 用法(server/):node projects-platform/scripts/test-bom-template.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const path = require('path');
const os = require('os');
const fs = require('fs');
const XLSX = require('xlsx');
const { init } = require('../../database-oracle');
const tpl = require('../services/bomTemplateService');
const importer = require('../services/bomImportService');
const { seedRival3Cn } = require('./seed-cleansheet-fixtures');

const val = (r) => (r ? Object.values(r)[0] : undefined);

(async () => {
  await init();
  const db = require('../../database-oracle').db;
  let pass = true;
  const mark = (ok) => { if (!ok) pass = false; return ok ? '✓' : '✗'; };
  console.log('\n=== B-3.5 · BOM 標準範本 產生 + 匯入 ===\n');

  // 1. 產生範本 buffer + 檢查分頁/標題
  const buf = tpl.buildTemplateBuffer();
  const wbT = XLSX.read(buf, { type: 'buffer' });
  console.log('[1] 範本產生');
  console.log(`    ${mark(buf.length > 0)}  buffer bytes = ${buf.length}`);
  console.log(`    ${mark(['說明', 'EE', 'ME', 'PKG'].every((s) => wbT.SheetNames.includes(s)))}  分頁 = ${wbT.SheetNames.join(',')}`);
  const eeHdr = XLSX.utils.sheet_to_json(wbT.Sheets.EE, { header: 1 })[0];
  console.log(`    ${mark(eeHdr.includes('Qty') && eeHdr.includes('Unit Price (USD)'))}  EE 標題含 Qty/Unit Price`);

  // 2. 造一份「填好的」範本(已知 qty×price)→ 寫 temp → 匯入
  const H = tpl.HEADERS;
  const mk = (rows) => XLSX.utils.aoa_to_sheet([H, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, mk([
    ['Capacitor', 1, 'C-SMD 10uF', 'FLK-C1', 3, 0.01125, 'Semco', 'CL10A', ''],   // 0.03375
    ['IC', 2, 'MCU', 'FLK-IC1', 1, 0.726, 'PIXART', 'PAW', ''],                    // 0.726
  ]), 'EE');
  XLSX.utils.book_append_sheet(wb, mk([
    ['Plastic', 'P1', 'HOUSING', 'FLK-P1', 1, 0.3675, '', '', ''],                 // 0.3675
  ]), 'ME');
  XLSX.utils.book_append_sheet(wb, mk([
    ['Box', 1, 'Retail Box', 'FLK-B1', 1, 0.3033, '', '', ''],                     // 0.3033
  ]), 'PKG');
  const tmpFile = path.join(os.tmpdir(), `bom_tpl_test_${Date.now()}.xlsx`);
  XLSX.writeFile(wb, tmpFile);

  const { projectId } = await seedRival3Cn(db);
  const r = await importer.importBomTemplate(db, { filePath: tmpFile, projectId, versionNo: 2 });  // v2 避免撞 B-1/B-2 的 v1
  try { fs.unlinkSync(tmpFile); } catch (_) {}
  console.log(`\n[2] importBomTemplate(填好範本)`);
  console.log(`    ${mark(r.itemCount === 4)}  item = ${r.itemCount}(期望 4)`);
  console.log(`    ${mark(r.sections.length === 3)}  sections = ${r.sections.map((s) => `${s.category}:${s.itemCount}`).join(' ')}`);

  // 3. rollup 對已知值(EE 0.75975 + ME 0.3675 + PKG 0.3033 = 1.43055)
  const roll = await importer.rollupMaterial(db, r.bomInstanceId);
  const G = { EE: 0.75975, ME: 0.3675, PKG: 0.3033, MAT: 1.43055 };
  const bc = roll.byCategory;
  console.log(`\n[3] rollup`);
  console.log(`    ${mark(Math.abs((bc.EE || 0) - G.EE) < 1e-4)}  EE=${(bc.EE || 0).toFixed(5)}(期望 ${G.EE})`);
  console.log(`    ${mark(Math.abs((bc.ME || 0) - G.ME) < 1e-4)}  ME=${(bc.ME || 0).toFixed(5)}(期望 ${G.ME})`);
  console.log(`    ${mark(Math.abs((bc.PKG || 0) - G.PKG) < 1e-4)}  PKG=${(bc.PKG || 0).toFixed(5)}(期望 ${G.PKG})`);
  console.log(`    ${mark(Math.abs(roll.materialUsd - G.MAT) < 1e-4)}  全材料=${roll.materialUsd.toFixed(5)}(期望 ${G.MAT})`);

  // 4. 冪等(同 project v2 再匯一次 → instance 只 1)
  const r2 = await importer.importBomTemplate(db, { filePath: (() => { const f = path.join(os.tmpdir(), `bom_tpl_test2_${Date.now()}.xlsx`); XLSX.writeFile(wb, f); return f; })(), projectId, versionNo: 2 });
  const nInst = Number(val(await db.prepare(`SELECT COUNT(*) AS C FROM bom_instance WHERE project_id=? AND version_no=2`).get(projectId)));
  console.log(`\n[4] 冪等`);
  console.log(`    ${mark(r2.itemCount === 4 && nInst === 1)}  再匯 item=${r2.itemCount} · v2 instance 數=${nInst}(期望 4 / 1)`);

  console.log(`\n=== 結果:${pass ? '✅ B-3.5 通過(範本產生 + 標準格式匯入 + rollup + 冪等)' : '❌ 有 FAIL'} ===\n`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('B-3.5 test ERROR:', e.message, e.stack); process.exit(2); });
