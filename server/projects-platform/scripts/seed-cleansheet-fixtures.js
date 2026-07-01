#!/usr/bin/env node
/**
 * seed-cleansheet-fixtures.js — Cleansheet 計算引擎 regression fixture seeder
 *
 * S1a:最小 Rival3-CN(FULL_MVA)= project + baseline + case_factory + 2 process。
 *      (完整 9 process / 三廠 / WHOOP 由 S1b/S1d 補)
 * 全 idempotent(unique key 檢查)· 需 ENABLE_CORTEX_BOM=true 且 013a-d 已 migrate。
 *
 * 用法:node server/projects-platform/scripts/seed-cleansheet-fixtures.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { init } = require('../../database-oracle');

const FIX = { projectCode: 'CORTEX-FIX-RIVAL3-CN', factory: 'CN', versionLabel: 'CN-2024Q4-S1D', costingModel: 'FULL_MVA' };
const val = (row) => (row ? Object.values(row)[0] : undefined);

// 真 Cleansheet 9 製程(r8-r54 逐欄 · DL detail 進 split 欄)· 對齊 rival3_golden.json
// 欄:wh/days/shifts/takt/yield/eff/lines · DL: dl/debug/funct/warehouse(per shift)· IDL-linedep: LL/Tech(shift+day)/IQC/Sup(day)· SEA day/wk
const R3_PROCS = [
  // code            ord wh   days  sh takt   y     e     ln dl   dbg  fun  wh0 lls  lld  ts   td  iqc sup  sead seaw
  ['SMT_MAIN',        1, 23, 6.67, 2, 8.64, 0.98, 0.95, 1, 10,  0.5, 0.5, 0,  0.5, 0.5, 0.5, 0.5, 0, 0.25, 10, 60],
  ['WAVE_SOLDER',     2, 20, 6.67, 2, 12,   0.98, 0.95, 1, 18,  0.5, 0.5, 0,  0.5, 0.5, 0.5, 0.5, 0, 0.25, 10, 60],
  ['ROUTER_OFFLINE',  3, 20, 6.67, 2, 24,   0.98, 0.95, 1, 2,   0.5, 0.5, 0,  0.5, 0.5, 0.5, 0.5, 0, 0.25, 10, 60],
  ['LASER_ETCH',      4, 20, 6.67, 2, 4,    0.98, 0.95, 1, 1,   0.5, 0.5, 0,  0.5, 0.5, 0.5, 0.5, 0, 0.25, 10, 60],
  ['BB_ASSY',         5, 20, 6,    1, 19,   0.98, 0.95, 1, 22.5,0,   0.5, 0,  1,   1,   1,   1,   0, 0,    10, 60],
  ['BB_TEST',         6, 20, 6,    1, 19,   0.98, 0.95, 1, 6,   0.5, 0,   0,  0,   0,   0,   0,   0, 0,    10, 60],
  ['MAT_MGMT',        7, 20, 6,    1, 19,   0.98, 0.95, 1, 0,   0,   0,   0.5,0,   0,   0,   0,   0, 0,    10, 60],
  ['Q_SMT',           8, 20, 6,    1, 8.64, 0.98, 0.95, 1, 0.5, 0,   0,   0,  0,   0,   0,   0,   0, 0,    10, 60],
  ['Q_BB',            9, 20, 6,    1, 19,   0.98, 0.95, 1, 0.5, 0,   0,   0,  0,   0,   0,   0.5, 0, 0,    10, 60],
];

async function seedRival3Cn(db) {
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);

  // 1. project(case=project · NOT NULL: project_code/project_type_id/pm_user_id/bu_id/created_by_user_id · 無 FK → user/bu 用 placeholder 1)
  let p = await get(`SELECT id FROM projects WHERE project_code = ?`, FIX.projectCode);
  if (!p) {
    const qt = await get(`SELECT id FROM project_types WHERE type_code = 'QUOTE'`);
    const typeId = qt ? Number(val(qt)) : 1;
    await run(
      `INSERT INTO projects (project_code, project_type_id, pm_user_id, bu_id, created_by_user_id, lifecycle_status, status)
       VALUES (?, ?, 1, 1, 1, 'DRAFT', 'DRAFT')`,
      FIX.projectCode, typeId,
    );
    p = await get(`SELECT id FROM projects WHERE project_code = ?`, FIX.projectCode);
  }
  const projectId = Number(val(p));

  // 2. baseline(CN FULL_MVA · 參數抄 demo CLEANSHEET_DEMO · 真值 S1b 校)
  let b = await get(`SELECT baseline_id FROM bom_factory_baseline WHERE factory_code=? AND version_label=?`, FIX.factory, FIX.versionLabel);
  if (!b) {
    await run(
      `INSERT INTO bom_factory_baseline
        (factory_code, version_label, status, costing_model, dl_wage_per_hr_usd,
         sga_pct, profit_pct, sga_base_ref, profit_base_ref, oh_pct,
         vat_rate_pct, loss_factor_pct, floor_sqft_prod, motherboard_cost_ref, annual_demand_default)
       VALUES (?, ?, 'active', 'FULL_MVA', 4.95,
         0.02, 0.14, 'mva_plus_mb', 'mva_plus_mb', 0,
         0.13, 0.0008, 50000, 8.683, 418000)`,
      FIX.factory, FIX.versionLabel,
    );
    b = await get(`SELECT baseline_id FROM bom_factory_baseline WHERE factory_code=? AND version_label=?`, FIX.factory, FIX.versionLabel);
  }
  const baselineId = Number(val(b));

  // 3. case_factory(case_id→projects · uq: case_id+factory_code+variant_key)
  let cf = await get(
    `SELECT case_factory_id FROM bom_cs_case_factory WHERE case_id=? AND factory_code=? AND variant_key IS NULL`,
    projectId, FIX.factory,
  );
  if (!cf) {
    await run(
      `INSERT INTO bom_cs_case_factory (case_id, factory_code, baseline_id, costing_model, status)
       VALUES (?, ?, ?, 'FULL_MVA', 'draft')`,
      projectId, FIX.factory, baselineId,
    );
    cf = await get(
      `SELECT case_factory_id FROM bom_cs_case_factory WHERE case_id=? AND factory_code=? AND variant_key IS NULL`,
      projectId, FIX.factory,
    );
  }
  const caseFactoryId = Number(val(cf));
  // 確保 case_factory 指向本 fixture 的最新 baseline(舊 run 可能指舊 baseline)
  await run(`UPDATE bom_cs_case_factory SET baseline_id=?, costing_model='FULL_MVA' WHERE case_factory_id=?`, baselineId, caseFactoryId);

  // 4. 完整 9 製程(真 Cleansheet 值 · DL detail 進 split 欄)· 先清乾淨再 insert(避免舊 run 殘留)
  //    weekly_output_override:品檢/支援製程承所在產線速率(真 Excel J24='=I24' · Q_SMT takt 快但受 BB 線 gating → 21168)
  const WK_OVERRIDE = { Q_SMT: 21168 };
  await run(`DELETE FROM bom_cs_case_process WHERE case_factory_id=?`, caseFactoryId);
  for (const p of R3_PROCS) {
    const [code, ord, wh, dpw, spd, takt, yld, eff, ln, dl, dbg, fun, wh0, lls, lld, ts, td, iqc, sup, sead, seaw] = p;
    await run(
      `INSERT INTO bom_cs_case_process
        (case_factory_id, process_code, step_order, working_hours_per_day, days_per_week, shifts_per_day,
         takt_seconds, yield_pct, efficiency_pct, lines_installed,
         dl_per_shift, debug_dl_per_shift, functional_dl_per_shift, warehouse_dl_per_shift,
         line_leader_per_shift, line_leader_per_day, technician_per_shift, technician_per_day,
         iqc_per_day, supervisor_per_day, sea_hours_per_day, sea_hours_per_week, weekly_output_override)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      caseFactoryId, code, ord, wh, dpw, spd, takt, yld, eff, ln, dl, dbg, fun, wh0, lls, lld, ts, td, iqc, sup, sead, seaw,
      WK_OVERRIDE[code] || null,
    );
  }

  // 5. qty scenario(baseline · 418000)
  const scEx = await get(`SELECT scenario_id FROM bom_cs_case_qty_scenario WHERE case_factory_id=? AND scenario_code='BASE'`, caseFactoryId);
  if (!scEx) {
    await run(`INSERT INTO bom_cs_case_qty_scenario (case_factory_id, scenario_code, scenario_label_zh, target_qty, is_baseline) VALUES (?, 'BASE', '基準', 418000, 1)`, caseFactoryId);
  }

  // 6. IDL role(baseline 子表)· 4 製造 role(r64-67)+ 9 集中 role(r74-82 · 皆 20150)
  const IDL_ROLES = [
    ['OP_MGR', 'MFG', 60320, '生產經理'], ['SECTION_MGR', 'MFG', 60320, '課級主管'],
    ['ENGINEER', 'MFG', 24440, '工程師'], ['LEAD_ENG', 'MFG', 31200, '資深工程師'],
    ['IT_STAFF', 'CENTRAL', 20150, 'IT'], ['ADMIN_STAFF', 'CENTRAL', 20150, '行政'],
    ['CUSTOMS_STAFF', 'CENTRAL', 20150, '關務'], ['SECURITY_STAFF', 'CENTRAL', 20150, '保全'],
    ['HR_STAFF', 'CENTRAL', 20150, '人資'], ['FREIGHT_STAFF', 'CENTRAL', 20150, '貨運'],
    ['FACILITIES_STAFF', 'CENTRAL', 20150, '廠務'], ['PLANNING_STAFF', 'CENTRAL', 20150, '計畫'],
    ['PURCHASING_STAFF', 'CENTRAL', 20150, '採購'],
  ];
  for (const [rc, cat, rate, zh] of IDL_ROLES) {
    const ex = await get(`SELECT 1 AS x FROM bom_factory_idl_role WHERE baseline_id=? AND role_code=?`, baselineId, rc);
    if (ex) await run(`UPDATE bom_factory_idl_role SET category=?, annual_rate_usd=?, display_name_zh_tw=? WHERE baseline_id=? AND role_code=?`, cat, rate, zh, baselineId, rc);
    else await run(`INSERT INTO bom_factory_idl_role (baseline_id, role_code, category, annual_rate_usd, display_name_zh_tw) VALUES (?,?,?,?,?)`, baselineId, rc, cat, rate, zh);
  }

  // 6.5 IDL line-dependent 週薪(baseline 子表)· 真 Excel r43-46(TECH 436.8 · 其餘 403)
  //     computeDl.wageOf 用 role_code:LINE_LEADER/TECHNICIAN/IQC/SUPERVISOR;缺此表會 fallback 403(TECH 少算)
  const LINEDEP_WAGE = [['LINE_LEADER', 403], ['TECHNICIAN', 436.8], ['IQC', 403], ['SUPERVISOR', 403]];
  for (const [rc, w] of LINEDEP_WAGE) {
    const ex = await get(`SELECT 1 AS x FROM bom_factory_idl_linedep_wage WHERE baseline_id=? AND role_code=?`, baselineId, rc);
    if (ex) await run(`UPDATE bom_factory_idl_linedep_wage SET weekly_wage_usd=? WHERE baseline_id=? AND role_code=?`, w, baselineId, rc);
    else await run(`INSERT INTO bom_factory_idl_linedep_wage (baseline_id, role_code, weekly_wage_usd) VALUES (?,?,?)`, baselineId, rc, w);
  }

  // 7. IDL alloc(案級 × 製程 multiplier · area→代表製程)· 製造(Y70)+ 集中(X83 · SMT側→SMT_MAIN/MatMgmt側→MAT_MGMT)
  const IDL_ALLOC = [
    // 製造 role
    ['SMT_MAIN', 'OP_MGR', 0.08], ['SMT_MAIN', 'SECTION_MGR', 0.08], ['SMT_MAIN', 'ENGINEER', 0.25], ['SMT_MAIN', 'LEAD_ENG', 0.08],
    ['BB_ASSY', 'OP_MGR', 0.005], ['BB_ASSY', 'SECTION_MGR', 0.125], ['BB_ASSY', 'ENGINEER', 0.1], ['BB_ASSY', 'LEAD_ENG', 0.05],
    ['Q_SMT', 'OP_MGR', 0.01],
    // 集中 role — SMT 側(→SMT_MAIN)
    ['SMT_MAIN', 'IT_STAFF', 0.04], ['SMT_MAIN', 'ADMIN_STAFF', 0.08], ['SMT_MAIN', 'SECURITY_STAFF', 0.24],
    ['SMT_MAIN', 'HR_STAFF', 0.048], ['SMT_MAIN', 'FACILITIES_STAFF', 0.15], ['SMT_MAIN', 'PURCHASING_STAFF', 0.08],
    // 集中 role — Material Management 側(→MAT_MGMT)
    ['MAT_MGMT', 'ADMIN_STAFF', 0.05], ['MAT_MGMT', 'HR_STAFF', 0.2], ['MAT_MGMT', 'FACILITIES_STAFF', 0.12],
  ];
  await run(`DELETE FROM bom_cs_case_idl_alloc WHERE case_factory_id=?`, caseFactoryId);
  for (const [pc, rc, m] of IDL_ALLOC) {
    await run(`INSERT INTO bom_cs_case_idl_alloc (case_factory_id, process_code, role_code, multiplier) VALUES (?,?,?,?)`, caseFactoryId, pc, rc, m);
  }

  // 8. 設備 area/bucket(annual_cost = Σ(ext/life)· 由 Equipment List 逆算)· util 只套 SMT area
  const EQUIP_AREA = [
    ['SMT_MAIN', 'MRO', 11316.6667, 1], ['SMT_MAIN', 'EQUIP', 337855.5765, 1],
    ['BB_TEST', 'MRO', 1444.9333, 0], ['BB_TEST', 'EQUIP', 6915.0, 0],
    ['BB_ASSY', 'MRO', 2242.6667, 0], ['BB_ASSY', 'EQUIP', 1956.6667, 0],
    ['Q_BB', 'MRO', 1273.6667, 0],
  ];
  await run(`DELETE FROM bom_cs_case_equip_area WHERE case_factory_id=?`, caseFactoryId);
  for (const [pc, bk, ac, au] of EQUIP_AREA) {
    await run(`INSERT INTO bom_cs_case_equip_area (case_factory_id, process_code, bucket, annual_cost_usd, apply_util) VALUES (?,?,?,?,?)`, caseFactoryId, pc, bk, ac, au);
  }

  // 9. 耗材(IndMat · 無 util)· 年花直接入 annual_usage × unit=1 → per_unit = 年花/年量
  const CONSUM = [
    ['SMT_INDMAT', 'SMT 間接耗材', 'SMT_MAIN', 151859.4],
    ['BBASSY_INDMAT', 'BB Assy 間接耗材', 'BB_ASSY', 3293.5474],
  ];
  await run(`DELETE FROM bom_cs_case_consumable WHERE case_factory_id=?`, caseFactoryId);
  for (const [code, desc, pc, spend] of CONSUM) {
    let cm = await get(`SELECT consumable_id FROM bom_factory_consumable WHERE factory_code=? AND consumable_code=?`, FIX.factory, code);
    if (!cm) {
      await run(`INSERT INTO bom_factory_consumable (factory_code, consumable_code, description, unit_cost_usd, default_process_code, is_active) VALUES (?,?,?,1,?,1)`, FIX.factory, code, desc, pc);
      cm = await get(`SELECT consumable_id FROM bom_factory_consumable WHERE factory_code=? AND consumable_code=?`, FIX.factory, code);
    }
    const cid = Number(val(cm));
    await run(`INSERT INTO bom_cs_case_consumable (case_factory_id, consumable_id, process_code, annual_usage_qty, unit_cost_override_usd) VALUES (?,?,?,?,1)`, caseFactoryId, cid, pc, spend);
  }

  // 10. 廠房 sqft(r100 · util 套 SMT/BB Assy · MatMgmt/Q-BB 不套)
  const FACILITY = [
    ['SMT_MAIN', 1458, 1], ['BB_ASSY', 1650, 1], ['MAT_MGMT', 110, 0], ['Q_BB', 88, 0],
  ];
  await run(`DELETE FROM bom_cs_case_facility WHERE case_factory_id=?`, caseFactoryId);
  for (const [pc, sqft, au] of FACILITY) {
    await run(`INSERT INTO bom_cs_case_facility (case_factory_id, process_code, sqft, apply_util) VALUES (?,?,?,?)`, caseFactoryId, pc, sqft, au);
  }

  return { projectId, baselineId, caseFactoryId };
}

// ── WHOOP(SIMPLIFIED_WEARABLE)fixture · 對齊 tmp/whoop_golden.json ──────────
const WFIX = { projectCode: 'CORTEX-FIX-WHOOP', factory: 'VN', versionLabel: 'VN-WHOOP-2025-S1C', costingModel: 'SIMPLIFIED_WEARABLE' };

// 15 line:材料模組 10(E欄)+ 製程元件 5 · Σ in_subtotal = 80.9579
// [line_code, component_code, line_group, cost_per_unit_usd]
const WHOOP_LINES = [
  ['HARVARD_SENSOR_G',        'MATERIAL',      'MATERIAL', 9.754,  10],
  ['HARVARD_MAIN_F3',         'MATERIAL',      'MATERIAL', 19.82,  20],
  ['BIRD_MAIN_J4',            'MATERIAL',      'MATERIAL', 15.786, 30],
  ['BIRD_NFC',                'MATERIAL',      'MATERIAL', 1.57,   40],
  ['HARVARD_ASSY',            'MATERIAL',      'MATERIAL', 7.84,   50],
  ['BIRD_ASSY',               'MATERIAL',      'MATERIAL', 5.06,   60],
  ['STRAP',                   'MATERIAL',      'MATERIAL', 8.273,  70],
  ['BATTERY_PACK',            'MATERIAL',      'MATERIAL', 1.624,  80],
  ['CONSUMABLE_SMT_ATE_FATP', 'MATERIAL',      'MATERIAL', 1.14,   90],
  ['PACKAGE_RETAIL',          'PKG_COST',      'MATERIAL', 3,      100],
  ['SMT',                     'SMT_POINTS',    'PROCESS',  1.7736, 110],
  ['BOARD_GLUE_ATE',          'PROC_MACRO',    'PROCESS',  0.3736, 120],
  ['FATP',                    'PROC_MACRO',    'PROCESS',  1.6031, 130],
  ['SMT_YIELD_LOSS',          'MAT_LOSS_RATE', 'LOSS',     0.2268, 140],
  ['FATP_YIELD_LOSS',         'MAT_LOSS_RATE', 'LOSS',     3.1138, 150],
];

async function seedWhoopVn(db) {
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);

  // 1. project
  let p = await get(`SELECT id FROM projects WHERE project_code = ?`, WFIX.projectCode);
  if (!p) {
    const qt = await get(`SELECT id FROM project_types WHERE type_code = 'QUOTE'`);
    const typeId = qt ? Number(val(qt)) : 1;
    await run(
      `INSERT INTO projects (project_code, project_type_id, pm_user_id, bu_id, created_by_user_id, lifecycle_status, status)
       VALUES (?, ?, 1, 1, 1, 'DRAFT', 'DRAFT')`,
      WFIX.projectCode, typeId,
    );
    p = await get(`SELECT id FROM projects WHERE project_code = ?`, WFIX.projectCode);
  }
  const projectId = Number(val(p));

  // 2. baseline(SIMPLIFIED · oh 4% / sga 3% / profit 3% / transport 0.5 / base_ref=bom_subtotal)
  let b = await get(`SELECT baseline_id FROM bom_factory_baseline WHERE factory_code=? AND version_label=?`, WFIX.factory, WFIX.versionLabel);
  if (!b) {
    await run(
      `INSERT INTO bom_factory_baseline
        (factory_code, version_label, status, costing_model,
         sga_pct, profit_pct, sga_base_ref, profit_base_ref, oh_pct,
         outbound_transportation_per_unit_usd, annual_demand_default)
       VALUES (?, ?, 'active', 'SIMPLIFIED_WEARABLE',
         0.03, 0.03, 'bom_subtotal', 'bom_subtotal', 0.04,
         0.5, 100000)`,
      WFIX.factory, WFIX.versionLabel,
    );
    b = await get(`SELECT baseline_id FROM bom_factory_baseline WHERE factory_code=? AND version_label=?`, WFIX.factory, WFIX.versionLabel);
  }
  const baselineId = Number(val(b));

  // 3. case_factory
  let cf = await get(`SELECT case_factory_id FROM bom_cs_case_factory WHERE case_id=? AND factory_code=? AND variant_key IS NULL`, projectId, WFIX.factory);
  if (!cf) {
    await run(`INSERT INTO bom_cs_case_factory (case_id, factory_code, baseline_id, costing_model, status) VALUES (?, ?, ?, 'SIMPLIFIED_WEARABLE', 'draft')`, projectId, WFIX.factory, baselineId);
    cf = await get(`SELECT case_factory_id FROM bom_cs_case_factory WHERE case_id=? AND factory_code=? AND variant_key IS NULL`, projectId, WFIX.factory);
  }
  const caseFactoryId = Number(val(cf));
  await run(`UPDATE bom_cs_case_factory SET baseline_id=?, costing_model='SIMPLIFIED_WEARABLE' WHERE case_factory_id=?`, baselineId, caseFactoryId);

  // 4. qty scenario
  const scEx = await get(`SELECT scenario_id FROM bom_cs_case_qty_scenario WHERE case_factory_id=? AND scenario_code='BASE'`, caseFactoryId);
  if (!scEx) await run(`INSERT INTO bom_cs_case_qty_scenario (case_factory_id, scenario_code, scenario_label_zh, target_qty, is_baseline) VALUES (?, 'BASE', '基準', 100000, 1)`, caseFactoryId);

  // 5. simplified line(先清再插)
  await run(`DELETE FROM bom_cs_case_simplified_line WHERE case_factory_id=?`, caseFactoryId);
  for (const [code, comp, grp, cost, ord] of WHOOP_LINES) {
    await run(`INSERT INTO bom_cs_case_simplified_line (case_factory_id, line_code, component_code, line_group, cost_per_unit_usd, in_subtotal, sort_order) VALUES (?,?,?,?,?,1,?)`,
      caseFactoryId, code, comp, grp, cost, ord);
  }

  return { projectId, baselineId, caseFactoryId };
}

if (require.main === module) {
  (async () => {
    await init();
    const db = require('../../database-oracle').db;
    const r = await seedRival3Cn(db);
    console.log('[fixture] Rival3-CN seeded:', r);
    const w = await seedWhoopVn(db);
    console.log('[fixture] WHOOP-VN seeded:', w);
    process.exit(0);
  })().catch((e) => { console.error('seed-cleansheet-fixtures ERROR:', e.message); process.exit(1); });
}

module.exports = { seedRival3Cn, seedWhoopVn, FIX, WFIX };
