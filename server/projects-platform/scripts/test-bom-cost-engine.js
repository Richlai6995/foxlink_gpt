#!/usr/bin/env node
/**
 * test-bom-cost-engine.js — 計算引擎離線 regression(S1a:分流 + 表讀通)
 *
 * S1a 範圍:驗 buildComponentPlan 分流(FULL 15 / SIMPLIFIED 10)+ computeCase(stub)跑通 + loadCaseInputs 讀表。
 * S1b/c/d 會擴成 Rival3 / WHOOP 逐 component ε<0.01 對帳。
 *
 * 用法(server/ 目錄):node projects-platform/scripts/test-bom-cost-engine.js
 * 需 ENABLE_CORTEX_BOM=true 且 013a-d 已 migrate。
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { init } = require('../../database-oracle');
const engine = require('../services/bomCostEngine');
const { seedRival3Cn, seedWhoopVn } = require('./seed-cleansheet-fixtures');

const val = (row) => (row ? Object.values(row)[0] : undefined);

(async () => {
  await init();
  const db = require('../../database-oracle').db;

  let pass = true;
  const mark = (ok) => { if (!ok) pass = false; return ok ? '✓' : '✗'; };

  console.log('\n=== S1a · bomCostEngine 分流 + 表讀通 ===\n');

  // 0. flag/migration 前置
  const has = await db.prepare(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name='BOM_CS_CASE_FACTORY'`).get();
  if (!Number(val(has))) {
    console.error('✗ BOM 表不存在 → 需 ENABLE_CORTEX_BOM=true 並跑 migration(013a-d)');
    process.exit(2);
  }

  // 1. buildComponentPlan 分流(mask 真相)
  const full = await engine.buildComponentPlan(db, 'FULL_MVA');
  const simp = await engine.buildComponentPlan(db, 'SIMPLIFIED_WEARABLE');
  const fc = full.map((c) => c.code);
  const sc = simp.map((c) => c.code);
  console.log('[1] component plan 分流(讀 bom_cs_component mask)');
  console.log(`    ${mark(full.length === 15)}  FULL_MVA = ${full.length}(期望 15 = BOTH 5 + FULL 10)`);
  console.log(`    ${mark(simp.length === 10)}  SIMPLIFIED = ${simp.length}(期望 10 = BOTH 5 + SIMP 5)`);
  console.log(`    ${mark(fc.includes('DL_CPU') && !sc.includes('DL_CPU'))}  DL_CPU 只在 FULL`);
  console.log(`    ${mark(sc.includes('SMT_POINTS') && !fc.includes('SMT_POINTS'))}  SMT_POINTS 只在 SIMPLIFIED`);
  console.log(`    ${mark(fc.includes('MATERIAL') && sc.includes('MATERIAL'))}  MATERIAL(BOTH)兩 model 都在`);
  const dlcpu = full.find((c) => c.code === 'DL_CPU');
  console.log(`    ${mark(dlcpu && dlcpu.fallbackInto === 'PROC_MACRO')}  DL_CPU.fallbackInto=${dlcpu && dlcpu.fallbackInto}(期望 PROC_MACRO)`);

  // 2. fixture + loadCaseInputs + computeCase(stub)
  const { caseFactoryId } = await seedRival3Cn(db);
  console.log(`\n[2] computeCase(Rival3-CN fixture · persist=false · stub)`);
  const inputs = await engine.loadCaseInputs(db, caseFactoryId);
  console.log(`    ${mark(!!inputs.baseline)}  loadCaseInputs 撈到 baseline`);
  console.log(`    ${mark(inputs.processes.length === 9)}  case_process 讀到 ${inputs.processes.length} 行(期望 9)`);
  const out = await engine.computeCase(db, { caseFactoryId, persist: false });
  console.log(`    ${mark(out.costingModel === 'FULL_MVA')}  costing_model = ${out.costingModel}`);
  console.log(`    ${mark(out.plan.length === 15)}  plan = ${out.plan.length}`);
  console.log(`    ${mark(out.cells.length === 57)}  cells = ${out.cells.length}(期望 9 process × 6 + 3 common = 57)`);

  // S1d · DL_CPU 逐製程 ε<0.01 對真 Cleansheet golden(rival3_golden.json · 驗重寫修好 double-count)
  console.log(`\n[3] S1d · DL_CPU 逐製程對 golden ε<0.01`);
  const GOLDEN_DL = {
    SMT_MAIN: 0.148209, WAVE_SOLDER: 0.349263, ROUTER_OFFLINE: 0.131394, LASER_ETCH: 0.015991,
    BB_ASSY: 0.362377, BB_TEST: 0.091199, MAT_MGMT: 0.007015, Q_SMT: 0.007015, Q_BB: 0.017333,
  };
  const dlCells = {};
  out.cells.filter((c) => c.component_code === 'DL_CPU').forEach((c) => { dlCells[c.process_code] = c.cost_per_unit_usd; });
  let dlPass = 0;
  for (const [proc, g] of Object.entries(GOLDEN_DL)) {
    const got = dlCells[proc];
    const eps = got == null ? 999 : Math.abs(got - g);
    const ok = eps < 0.01; if (ok) dlPass++; else pass = false;
    console.log(`    ${ok ? '✓' : '✗'}  ${proc.padEnd(15)} 引擎=${got == null ? 'N/A' : got.toFixed(4)} golden=${g.toFixed(4)} Δ=${eps.toFixed(5)}`);
  }
  console.log(`    → DL ${dlPass}/9 過`);

  // [5] 分段對帳(對真 Cleansheet MVA_SUM 七項)· ε<0.01
  console.log(`\n[5] S1d · MVA 分段對帳(對真 Cleansheet section totals)ε<0.01`);
  const sumCells = (codes) => out.cells.filter((c) => codes.includes(c.component_code)).reduce((s, c) => s + c.cost_per_unit_usd, 0);
  const cellOf = (code) => { const c = out.cells.find((x) => x.component_code === code); return c ? c.cost_per_unit_usd : null; };
  const SECTIONS = [
    ['DL (L58)',        sumCells(['DL_CPU']),                          1.129797],
    ['IDL (Y70+X83)',   sumCells(['IDL_CPU']),                         0.122050],
    ['設備 (X94)',      sumCells(['EQUIP_MRO', 'EQUIP_DEPR', 'IND_MAT']), 0.545091],
    ['廠房 (X103)',     sumCells(['FACILITY']),                        0.042308],
    ['Freight (J109)',  cellOf('FREIGHT'),                             0.005981],
    ['Loss (J112)',     cellOf('LOSS'),                                0.006946],
  ];
  for (const [label, got, g] of SECTIONS) {
    const eps = got == null ? 999 : Math.abs(got - g);
    const ok = eps < 0.01; if (!ok) pass = false;
    console.log(`    ${ok ? '✓' : '✗'}  ${label.padEnd(18)} 引擎=${got == null ? 'N/A' : got.toFixed(6)} golden=${g.toFixed(6)} Δ=${eps.toFixed(6)}`);
  }

  // [6] MVA_SUM + 轉換加成 + total 對帳
  console.log(`\n[6] S1d · MVA_SUM / 轉換加成 / total 對帳 ε<0.01`);
  const bd = out.costBreakdown;
  const GOLD = { mva: 1.852174, addon: 1.685628, total: 12.220802 };  // addon=(MVA+MB)×0.16(Excel profit 行 · SGA 併入)· total=MB+MVA+addon
  const addon = bd.sga + bd.profit;
  const rows6 = [
    ['MVA_SUM (C118)', bd.mva, GOLD.mva],
    ['SGA+Profit 加成', addon, GOLD.addon],
    ['Total 報價',      bd.total, GOLD.total],
  ];
  for (const [label, got, g] of rows6) {
    const eps = Math.abs(got - g);
    const ok = eps < 0.01; if (!ok) pass = false;
    console.log(`    ${ok ? '✓' : '✗'}  ${label.padEnd(16)} 引擎=${got.toFixed(6)} golden=${g.toFixed(6)} Δ=${eps.toFixed(6)}`);
  }
  console.log(`    (拆帳:sga=${bd.sga.toFixed(6)} profit=${bd.profit.toFixed(6)} · Excel 併成單一 profit 行 1.685628,total 一致)`);

  // ── S1c-1 · SIMPLIFIED_WEARABLE(WHOOP)對 whoop_golden.json ε<0.01 ──────────
  console.log(`\n[7] S1c-1 · SIMPLIFIED(WHOOP)對 golden ε<0.01`);
  const { caseFactoryId: whoopCf } = await seedWhoopVn(db);
  const wOut = await engine.computeCase(db, { caseFactoryId: whoopCf, persist: false });
  const wbd = wOut.costBreakdown;
  const wCell = (code) => { const c = wOut.cells.find((x) => x.component_code === code); return c ? c.cost_per_unit_usd : null; };
  const oh = wCell('OVERHEAD_4PCT'), transport = wCell('TRANSPORTATION');
  console.log(`    ${mark(wOut.costingModel === 'SIMPLIFIED_WEARABLE')}  costing_model = ${wOut.costingModel}`);
  console.log(`    ${mark(wOut.plan.length === 10)}  plan = ${wOut.plan.length}(期望 10)`);
  const WGOLD = [
    ['subtotal (r23)',  wbd.subtotal, 80.9579],
    ['OH 4% (r24)',     oh,           3.2383],
    ['SGA 3% (r25)',    wbd.sga,      2.4287],
    ['Profit 3% (r26)', wbd.profit,   2.4287],
    ['Transport (r27)', transport,    0.5],
    ['TTL (r28)',       wbd.total,    89.5537],
  ];
  for (const [label, got, g] of WGOLD) {
    const eps = got == null ? 999 : Math.abs(got - g);
    const ok = eps < 0.01; if (!ok) pass = false;
    console.log(`    ${ok ? '✓' : '✗'}  ${label.padEnd(16)} 引擎=${got == null ? 'N/A' : got.toFixed(4)} golden=${g.toFixed(4)} Δ=${eps.toFixed(5)}`);
  }
  console.log(`    (mva=OH+Transport=${wbd.mva.toFixed(4)} · material_true=subtotal=${(wbd.material||0).toFixed(4)})`);

  // ── S1c-2 · persistRun 落庫(FULL + SIMPLIFIED · 冪等)──────────────────────
  console.log(`\n[8] S1c-2 · persistRun 落庫 + 冪等`);
  const cnt = async (sql, ...a) => Number(val(await db.prepare(sql).get(...a)));
  // FULL:persist 兩次驗冪等(舊 ready → archived,只留 1 ready)
  const fRun1 = await engine.computeCase(db, { caseFactoryId, persist: true, computedBy: 1 });
  const fRun2 = await engine.computeCase(db, { caseFactoryId, persist: true, computedBy: 1 });
  console.log(`    ${mark(fRun2.runId != null && fRun2.runId !== fRun1.runId)}  FULL runId 遞增(run1=${fRun1.runId} run2=${fRun2.runId})`);
  const fReady = await cnt(`SELECT COUNT(*) AS C FROM bom_cs_run WHERE case_factory_id=? AND status='ready'`, caseFactoryId);
  console.log(`    ${mark(fReady === 1)}  冪等:ready run 只剩 1(實=${fReady})`);
  const fCells = await cnt(`SELECT COUNT(*) AS C FROM bom_cs_run_cell WHERE run_id=?`, fRun2.runId);
  console.log(`    ${mark(fCells === 57)}  FULL run_cell = ${fCells}(期望 57)`);
  const fTot = Number(val(await db.prepare(`SELECT total_true_usd FROM bom_cs_run_result WHERE run_id=?`).get(fRun2.runId)));
  console.log(`    ${mark(Math.abs(fTot - 12.2208) < 0.01)}  FULL run_result.total_true=${fTot.toFixed(4)}(golden 12.2208 Δ=${Math.abs(fTot - 12.2208).toFixed(5)})`);
  // SIMPLIFIED:persist 一次
  const wRun = await engine.computeCase(db, { caseFactoryId: whoopCf, persist: true, computedBy: 1 });
  const wCells = await cnt(`SELECT COUNT(*) AS C FROM bom_cs_run_cell WHERE run_id=?`, wRun.runId);
  console.log(`    ${mark(wCells === 7)}  SIMPLIFIED run_cell = ${wCells}(期望 7 · 15 line 聚合)`);
  const wTot = Number(val(await db.prepare(`SELECT total_true_usd FROM bom_cs_run_result WHERE run_id=?`).get(wRun.runId)));
  console.log(`    ${mark(Math.abs(wTot - 89.5537) < 0.01)}  SIMPLIFIED run_result.total_true=${wTot.toFixed(4)}(golden 89.5537 Δ=${Math.abs(wTot - 89.5537).toFixed(5)})`);
  const audit = await cnt(`SELECT COUNT(*) AS C FROM bom_audit_log WHERE case_factory_id IN (?,?) AND event_type='CS_COMPUTED'`, caseFactoryId, whoopCf);
  console.log(`    ${mark(audit >= 3)}  audit CS_COMPUTED 筆數=${audit}(期望 ≥3)`);

  console.log(`\n=== 結果:${pass ? '✅ S1c 全通過(FULL 1.8522 + SIMPLIFIED 89.5537 對帳 + 落庫 run/cell/result/audit + 冪等)' : '❌ 有 FAIL(見上 ✗)'} ===\n`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('S1a test ERROR:', e.message, e.stack); process.exit(2); });
