#!/usr/bin/env node
/**
 * test-case-provision.js — §9.4 開案自動建 case_factory(從範本 clone)離線 regression
 *
 * 驗:listTemplates → provisionCase(clone 9 張 case 表)→ compute 新 cf(MVA>0 證 clone 生效)→ 冪等。
 * 自清:刪除測試用 K94TEST case + 先前殘留空 case。
 *
 * 用法(server/ 目錄):node projects-platform/scripts/test-case-provision.js
 * 需 ENABLE_CORTEX_BOM=true + fixtures(82/101)已 seed。
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { init } = require('../../database-oracle');
const provision = require('../services/bomCaseProvisionService');
const engine = require('../services/bomCostEngine');

(async () => {
  await init();
  const db = require('../../database-oracle').db;
  let pass = true; const mark = (ok) => { if (!ok) pass = false; return ok ? '✓' : '✗'; };
  console.log('\n=== §9.4 case provision(clone 範本)===\n');

  // 清先前殘留:空 CN case on 101(bind bug 那次)+ 任何 K94TEST
  await db.prepare(`DELETE FROM bom_cs_case_factory WHERE case_id=101 AND factory_code='CN' AND variant_key IS NULL`).run().catch(() => {});
  await db.prepare(`DELETE FROM bom_cs_case_factory WHERE variant_key='K94TEST'`).run().catch(() => {});

  // 1. templates
  const tpls = await provision.listTemplates(db);
  console.log(`templates: ${tpls.map((t) => `#${t.caseFactoryId}/${t.factoryCode}/${t.costingModel}`).join(', ')}`);
  const cn = tpls.find((t) => t.costingModel === 'FULL_MVA');
  console.log(`${mark(!!cn)} 有 CN FULL_MVA 範本`);

  // 2. provision CN → 專案 82, variant K94TEST(fresh · 不動既有 82+CN+NULL)
  const prov = await provision.provisionCase(db, { projectId: 82, sourceCaseFactoryId: cn.caseFactoryId, variantKey: 'K94TEST' });
  const total = Object.values(prov.cloned).reduce((a, b) => a + b, 0);
  console.log(`provisioned cf#${prov.caseFactoryId} reused=${prov.reused} cloned=${JSON.stringify(prov.cloned)} (Σ ${total})`);
  console.log(`${mark(!prov.reused)} 新建(非 reused)`);
  console.log(`${mark(total > 0)} clone 有複製 rows(Σ ${total})`);
  console.log(`${mark(prov.cloned.process > 0)} case_process cloned(${prov.cloned.process})`);
  console.log(`${mark(prov.cloned.equip_area > 0)} case_equip_area cloned(${prov.cloned.equip_area})`);

  // 3. compute 新 cf(無 BOM · 用 baseline motherboard)→ MVA>0 證 clone 的製程/設備生效
  const c = await engine.computeCase(db, { caseFactoryId: prov.caseFactoryId, persist: false });
  console.log(`compute: model=${c.costingModel} material=${c.costBreakdown.material} MVA=${c.costBreakdown.mva} total=${c.costBreakdown.total}`);
  console.log(`${mark(c.costingModel === 'FULL_MVA')} costing_model=FULL_MVA`);
  console.log(`${mark(c.costBreakdown.mva > 0)} MVA > 0(clone 生效)`);

  // 4. 冪等
  const prov2 = await provision.provisionCase(db, { projectId: 82, sourceCaseFactoryId: cn.caseFactoryId, variantKey: 'K94TEST' });
  console.log(`${mark(prov2.reused && prov2.caseFactoryId === prov.caseFactoryId)} 冪等:再 provision → reused 同 cf#${prov2.caseFactoryId}`);

  // 自清
  await db.prepare(`DELETE FROM bom_cs_case_factory WHERE variant_key='K94TEST'`).run().catch(() => {});
  console.log('cleanup: 刪 K94TEST 測試 case ✓');

  console.log(`\n=== ${pass ? 'ALL PASS ✓' : 'SOME FAIL ✗'} ===\n`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
