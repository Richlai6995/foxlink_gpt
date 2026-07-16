#!/usr/bin/env node
/**
 * test-factory-compare.js — FM 多廠對比 regression + demo 資料 seed
 *
 * 驗:VN FULL baseline(CN 參數 · 工資 ×0.53 差異化)→ provision CN+VN 兩廠到 demo 專案 →
 *     compareFactories 各算 → VN total < CN(工資低)→ 標最便宜。
 * 副作用(刻意保留):建 CORTEX-FIX-MULTI demo 專案(CN+VN 兩廠)供瀏覽器實測 compare。
 * idempotent(可重跑)。用法(server/):node projects-platform/scripts/test-factory-compare.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { init } = require('../../database-oracle');
const provision = require('../services/bomCaseProvisionService');
const compare = require('../services/bomFactoryCompareService');

const val = (r) => (r ? Object.values(r)[0] : undefined);
const pick = (row, name) => { if (!row) return undefined; const lc = name.toLowerCase(); for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k]; };

(async () => {
  await init();
  const db = require('../../database-oracle').db;
  const get = (s, ...a) => db.prepare(s).get(...a);
  const run = (s, ...a) => db.prepare(s).run(...a);
  let pass = true; const mark = (ok) => { if (!ok) pass = false; return ok ? '✓' : '✗'; };
  console.log('\n=== FM 多廠對比(CN vs VN 差異化)===\n');

  const cn = await get(`SELECT cf.case_factory_id, cf.baseline_id FROM bom_cs_case_factory cf JOIN projects p ON p.id=cf.case_id WHERE p.project_code='CORTEX-FIX-RIVAL3-CN' AND cf.factory_code='CN' AND cf.variant_key IS NULL`);
  const cnCf = Number(pick(cn, 'case_factory_id')); const cnBaseline = Number(pick(cn, 'baseline_id'));
  console.log(`${mark(!!cnCf)} CN 範本 cf#${cnCf} baseline#${cnBaseline}`);

  // VN FULL baseline(copy CN 欄位 · 只降 dl_wage · idempotent)
  const WAGE_F = 0.53, IDL_F = 0.55;
  let vb = await get(`SELECT baseline_id FROM bom_factory_baseline WHERE factory_code='VN' AND version_label='VN-FULL-DEMO'`);
  if (!vb) {
    await run(`INSERT INTO bom_factory_baseline (factory_code, version_label, status, costing_model, dl_wage_per_hr_usd, sga_pct, profit_pct, sga_base_ref, profit_base_ref, oh_pct, vat_rate_pct, loss_factor_pct, floor_sqft_prod, motherboard_cost_ref, annual_demand_default)
      SELECT 'VN','VN-FULL-DEMO','active','FULL_MVA', dl_wage_per_hr_usd*${WAGE_F}, sga_pct, profit_pct, sga_base_ref, profit_base_ref, oh_pct, vat_rate_pct, loss_factor_pct, floor_sqft_prod, motherboard_cost_ref, annual_demand_default
        FROM bom_factory_baseline WHERE baseline_id=?`, cnBaseline);
    vb = await get(`SELECT baseline_id FROM bom_factory_baseline WHERE factory_code='VN' AND version_label='VN-FULL-DEMO'`);
  }
  const vnBaseline = Number(pick(vb, 'baseline_id'));
  console.log(`${mark(!!vnBaseline)} VN baseline#${vnBaseline}(工資 ×${WAGE_F})`);

  // clone CN baseline 的 IDL roles + linedep → VN baseline(×IDL_F)
  await run(`DELETE FROM bom_factory_idl_role WHERE baseline_id=?`, vnBaseline);
  await run(`INSERT INTO bom_factory_idl_role (baseline_id, role_code, category, annual_rate_usd, display_name_zh_tw)
    SELECT ?, role_code, category, annual_rate_usd*${IDL_F}, display_name_zh_tw FROM bom_factory_idl_role WHERE baseline_id=?`, vnBaseline, cnBaseline);
  await run(`DELETE FROM bom_factory_idl_linedep_wage WHERE baseline_id=?`, vnBaseline);
  await run(`INSERT INTO bom_factory_idl_linedep_wage (baseline_id, role_code, weekly_wage_usd)
    SELECT ?, role_code, weekly_wage_usd*${IDL_F} FROM bom_factory_idl_linedep_wage WHERE baseline_id=?`, vnBaseline, cnBaseline);
  const roleN = Number(val(await get(`SELECT COUNT(*) AS c FROM bom_factory_idl_role WHERE baseline_id=?`, vnBaseline)));
  console.log(`${mark(roleN > 0)} VN IDL roles ${roleN} + linedep 複製`);

  // demo 專案 CORTEX-FIX-MULTI
  let mp = await get(`SELECT id FROM projects WHERE project_code='CORTEX-FIX-MULTI'`);
  if (!mp) {
    const qt = await get(`SELECT id FROM project_types WHERE type_code='QUOTE'`);
    await run(`INSERT INTO projects (project_code, project_type_id, pm_user_id, bu_id, created_by_user_id, lifecycle_status, status) VALUES ('CORTEX-FIX-MULTI', ?, 1, 1, 1, 'DRAFT', 'DRAFT')`, qt ? Number(val(qt)) : 1);
    mp = await get(`SELECT id FROM projects WHERE project_code='CORTEX-FIX-MULTI'`);
  }
  const multiId = Number(val(mp));
  console.log(`${mark(!!multiId)} demo 專案 CORTEX-FIX-MULTI #${multiId}`);

  // provision CN + VN 到 multi(都 clone CN#1 結構;CN 綁 CN baseline、VN 綁 VN baseline)
  const provCn = await provision.provisionCase(db, { projectId: multiId, sourceCaseFactoryId: cnCf });
  const provVn = await provision.provisionCase(db, { projectId: multiId, sourceCaseFactoryId: cnCf, factoryCode: 'VN', baselineId: vnBaseline });
  console.log(`  CN cf#${provCn.caseFactoryId}(reused=${provCn.reused}) · VN cf#${provVn.caseFactoryId}(reused=${provVn.reused})`);

  // compare(無 BOM · 用 baseline motherboard 8.683)
  const cmp = await compare.compareFactories(db, { projectId: multiId });
  console.log(`\ncompare (${cmp.factoryCount} 廠):`);
  for (const f of cmp.factories) console.log(`  ${f.factoryCode} ${f.costingModel} total=${typeof f.total === 'number' ? f.total.toFixed(4) : f.error} (MVA ${typeof f.mva === 'number' ? f.mva.toFixed(4) : '-'}) ${f.isCheapest ? '★最便宜' : ''}`);
  const cnR = cmp.factories.find((f) => f.factoryCode === 'CN'); const vnR = cmp.factories.find((f) => f.factoryCode === 'VN');
  console.log(`\n${mark(cmp.factoryCount >= 2)} ≥2 廠`);
  console.log(`${mark(vnR && cnR && vnR.total < cnR.total)} VN total < CN total(工資低 → 便宜)`);
  console.log(`${mark(vnR && vnR.isCheapest)} VN 標記最便宜`);

  console.log(`\n=== ${pass ? 'ALL PASS ✓' : 'SOME FAIL ✗'} ===\n`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
