/**
 * bomCostEngine.js — Cortex 單一計算引擎(S1)
 *
 * 對應 docs/cortex-s1-cost-engine-plan.md + cortex-unified-architecture-sd.md(§3 mask / 參數化 base_ref)
 *
 * 核心原則:
 *   - 一條 path 兩 model:靠 buildComponentPlan(costing_model) 讀 bom_cs_component mask 分流,
 *     不在程式散落 if(model)。每 component_code → 一個 pure compute 函數,engine 只遍歷 plan 呼叫。
 *   - 全參數化讀 bom_factory_baseline(dl_wage / sga_base_ref / profit_base_ref / oh_pct …),
 *     **絕不硬編 wage / LOV**(對齊 MEMORY no-hardcoded-LOV)。
 *   - 引擎只讀 S0 正規化表(INPUT),寫 bom_cs_run / run_cell / run_result(OUTPUT);與 form_template 透過 S0 表解耦。
 *
 * 進度:
 *   S1a(本檔)= 骨架:computeCase 入口 + buildComponentPlan + loadCaseInputs + 9 compute_* stub(回 0)。
 *   S1b = 填 FULL_MVA 6 函數(移植 demo v0.16 已驗證 ε<0.01 邏輯 · 換讀 S0 表)。
 *   S1c = 填 SIMPLIFIED 5 函數 + persistRun(寫三表 + audit)。
 */

const { makeLogger } = require('./logger');
const log = makeLogger('bomCostEngine');

// ── helpers ───────────────────────────────────────────────────────────────
const num = (v) => (v == null || v === '' ? 0 : Number(v));
// Oracle wrapper 回傳 key 大小寫不定 → 大小寫無關取欄
function pick(row, name) {
  if (!row) return undefined;
  const lc = name.toLowerCase();
  for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k];
  return undefined;
}

// ── component plan(mask 分流的唯一真相 · 不在程式硬列）─────────────────────
/**
 * 依 costing_model 從 bom_cs_component 撈啟用的 component list。
 * FULL_MVA → model_applicability IN ('BOTH','FULL_MVA');SIMPLIFIED 同理。
 * fallbackInto:該 component 被 disable 時金額併入哪個 component(SIMPLIFIED OH 4% 吸收用)。
 */
async function buildComponentPlan(db, costingModel) {
  const rows = await db.prepare(
    `SELECT component_code, category, fallback_into_code, sort_order
       FROM bom_cs_component
      WHERE is_active = 1 AND model_applicability IN ('BOTH', ?)
      ORDER BY sort_order`,
  ).all(costingModel).catch((e) => { log.warn('buildComponentPlan:', e.message); return []; });
  return rows.map((r) => ({
    code: pick(r, 'component_code'),
    category: pick(r, 'category'),
    fallbackInto: pick(r, 'fallback_into_code') || null,
    sortOrder: num(pick(r, 'sort_order')),
  }));
}

// ── 一次撈齊案級輸入 ───────────────────────────────────────────────────────
async function loadCaseInputs(db, caseFactoryId) {
  const all = (sql, ...a) => db.prepare(sql).all(...a).catch(() => []);
  const one = (sql, ...a) => db.prepare(sql).get(...a).catch(() => null);

  const caseFactory = await one(`SELECT * FROM bom_cs_case_factory WHERE case_factory_id = ?`, caseFactoryId);
  if (!caseFactory) throw new Error(`bomCostEngine: case_factory ${caseFactoryId} not found`);
  const baselineId = pick(caseFactory, 'baseline_id');
  const baseline = await one(`SELECT * FROM bom_factory_baseline WHERE baseline_id = ?`, baselineId);
  if (!baseline) throw new Error(`bomCostEngine: baseline ${baselineId} not found`);

  return {
    caseFactory,
    baseline,
    // FULL_MVA 用
    processes:    await all(`SELECT * FROM bom_cs_case_process WHERE case_factory_id = ? ORDER BY step_order`, caseFactoryId),
    idlAlloc:     await all(`SELECT * FROM bom_cs_case_idl_alloc WHERE case_factory_id = ?`, caseFactoryId),
    idlRoles:     await all(`SELECT * FROM bom_factory_idl_role WHERE baseline_id = ?`, baselineId),
    idlLinedep:   await all(`SELECT * FROM bom_factory_idl_linedep_wage WHERE baseline_id = ?`, baselineId),
    equipArea:    await all(`SELECT * FROM bom_cs_case_equip_area WHERE case_factory_id = ?`, caseFactoryId),   // 設備 area/bucket(真 Excel 模型 · S1d)
    facility:     await all(`SELECT * FROM bom_cs_case_facility WHERE case_factory_id = ?`, caseFactoryId),     // 廠房 sqft/util(真 Excel 模型 · S1d)
    caseConsum:   await all(`SELECT * FROM bom_cs_case_consumable WHERE case_factory_id = ?`, caseFactoryId),
    consumMaster: await all(`SELECT * FROM bom_factory_consumable WHERE factory_code = ?`, pick(caseFactory, 'factory_code')),
    // SIMPLIFIED 用
    simplifiedLines: await all(`SELECT * FROM bom_cs_case_simplified_line WHERE case_factory_id = ? ORDER BY sort_order`, caseFactoryId), // 材料/製程 per-unit line(S1c)
    smtPoint:     await all(`SELECT * FROM bom_cs_case_smt_point WHERE case_factory_id = ?`, caseFactoryId),
    smtRule:      await all(`SELECT * FROM bom_factory_smt_point_rule WHERE baseline_id = ?`, baselineId),
    macroProcess: await all(`SELECT * FROM bom_cs_case_macro_process WHERE case_factory_id = ?`, caseFactoryId),
    // 共用
    qtyScenarios: await all(`SELECT * FROM bom_cs_case_qty_scenario WHERE case_factory_id = ?`, caseFactoryId),
    procCatalog:  await all(`SELECT process_code, process_group FROM bom_process_catalog`),
  };
}

// ── base_ref 選擇器(兩 model 共用的關鍵參數化點)──────────────────────────
function resolveBaseRef(baseline, kind, ctx) {
  // kind: 'sga' | 'profit' · ctx: { motherboard, mva, bomSubtotal }
  const ref = pick(baseline, kind === 'sga' ? 'sga_base_ref' : 'profit_base_ref');
  switch (ref) {
    case 'motherboard':  return num(ctx.motherboard);
    case 'mva_plus_mb':  return num(ctx.mva) + num(ctx.motherboard);
    case 'bom_subtotal': return num(ctx.bomSubtotal);
    default:             return num(ctx.bomSubtotal); // 安全預設
  }
}

// ── 魔術常數(demo 未表化 · TODO 移 baseline 欄/case_process)────────────────
const SQFT_UNIT_COST_DEFAULT = 14.4276;  // CN $/sqft(Cleansheet C100)· TODO baseline.floor_cost_per_sqft
const SQFT_ALLOC = {                      // 製程佔地(sqft)· TODO bom_cs_case_process.sqft_alloc
  SMT_MAIN: 1458, WAVE_SOLDER: 400, ROUTER_OFFLINE: 200, LASER_ETCH: 150,
  BB_ASSY: 1650, BB_TEST: 600, MAT_MGMT: 110, Q_SMT: 300, Q_BB: 88, FATP: 1500,
};

// ── 製程級共用中間量 — 對齊真 Cleansheet(UPH C14 / weekly_output C24 / util=C20/C24)──
function procDerive(proc, annualDemand) {
  const takt = num(proc.takt_seconds) || 1;
  const uph = (3600 / takt) * num(proc.yield_pct) * num(proc.efficiency_pct);        // C14
  const whr_wk = num(proc.working_hours_per_day) * num(proc.days_per_week);          // C10
  const max_output_per_line = whr_wk * uph;                                          // C21
  const max_wk_demand = (num(annualDemand) / 50) * 1.2;                              // C20
  const lines = num(proc.lines_installed) || (max_output_per_line ? Math.ceil(max_wk_demand / max_output_per_line) : 1);
  // C24:預設 max_output×lines;品檢/支援製程承所在產線速率 → 案級 weekly_output_override 覆寫(真 Excel J24='=I24')
  const weekly_output = num(proc.weekly_output_override) || (max_output_per_line * lines);
  const util = weekly_output ? max_wk_demand / weekly_output : 0;                    // C20/C24 稼動率
  return { uph, whr_wk, max_output_per_line, lines, max_wk_demand, weekly_output, util };
}

// ── FULL_MVA compute(照真 Rival3 Cleansheet 公式 v2 · 見 S1 doc §6.5.1)──────
// A. DL(r58 = (DL成本/wk r56 + IDL-linedep/wk r55) / weekly_output)· 分 SMT/BB 兩組
function computeDl(proc, ctx) {
  const d = procDerive(proc, ctx.annualDemand);
  const group = ctx.procGroup[pick(proc, 'process_code')] || 'BB';
  const dlWage = num(ctx.dlWage);
  const seaWk = num(proc.sea_hours_per_week) || 1;
  const total_dl_day = (num(proc.dl_per_shift) + num(proc.debug_dl_per_shift)
    + num(proc.functional_dl_per_shift) + num(proc.warehouse_dl_per_shift)) * num(proc.shifts_per_day) * d.lines; // r33
  const mult1 = ((num(proc.working_hours_per_day) / 2) * 6) / seaWk;                 // r50
  const mult2 = (num(proc.sea_hours_per_day) * num(proc.days_per_week)) / seaWk;     // r51
  // r56 DL 成本/wk:SMT 組含 mult1;BB 組無 mult1
  const dl_cost_wk = group === 'SMT'
    ? dlWage * seaWk * total_dl_day * mult2 * mult1
    : dlWage * mult2 * total_dl_day * seaWk;
  const wageOf = (code) => { const w = ctx.idlLinedep.find((x) => pick(x, 'role_code') === code); return w ? num(pick(w, 'weekly_wage_usd')) : 403; };
  // r55 IDL line-dep/wk:用「per day」count · SMT 組(無 Sup · ×mult2);BB 組(含 Sup · 無 mult2)
  const llday = num(proc.line_leader_per_day), techday = num(proc.technician_per_day);
  const iqcday = num(proc.iqc_per_day), supday = num(proc.supervisor_per_day);
  const base = llday * wageOf('LINE_LEADER') + techday * wageOf('TECHNICIAN') + iqcday * wageOf('IQC');
  const idl_line_dep = group === 'SMT' ? base * mult2 : base + supday * wageOf('SUPERVISOR');
  const perUnit = d.weekly_output ? (dl_cost_wk + idl_line_dep) / d.weekly_output : 0;
  return { perUnit, _trace: { group, uph: d.uph, weekly_output: d.weekly_output, total_dl_day, dl_cost_wk, idl_line_dep } };
}

// B. IDL(製造 r64-70 + 集中 r74-83)· 每 role `rate×multiplier/annual_demand`— 除數是 annual_demand 非 capacity
function computeIdl(proc, ctx) {
  const procCode = pick(proc, 'process_code');
  const ad = num(ctx.annualDemand) || 1;
  const annualByRole = {};
  ctx.idlRoles.forEach((r) => { annualByRole[pick(r, 'role_code')] = num(pick(r, 'annual_rate_usd')); });
  let perUnit = 0;
  ctx.idlAlloc.filter((a) => pick(a, 'process_code') === procCode).forEach((a) => {
    perUnit += (annualByRole[pick(a, 'role_code')] || 0) * num(pick(a, 'multiplier')) / ad;  // rate×mult/annual_demand
  });
  return { perUnit };
}

// C. 設備 MRO+Depr(r90/r91 = Σ(ext/life)/年量 × util-if-flagged)+ IndMat(r92 = 耗材年花/年量 · 無 util)
//    真 Excel 模型:設備是一組行(每行 ext_cost/useful_life),MRO/EQUIP 只是 bucket 標籤,無 mroPct。
//    util(C20/C24)選擇性套(apply_util flag):SMT area 套、BB/Q area 不套。讀 bom_cs_case_equip_area。
function computeEquipment(proc, ctx) {
  const procCode = pick(proc, 'process_code');
  const ad = num(ctx.annualDemand) || 1;
  const d = procDerive(proc, ctx.annualDemand);
  let mro_per_unit = 0, depr_per_unit = 0;
  (ctx.equipArea || []).filter((e) => pick(e, 'process_code') === procCode).forEach((e) => {
    const utilFactor = num(pick(e, 'apply_util')) ? d.util : 1;
    const perUnit = (num(pick(e, 'annual_cost_usd')) / ad) * utilFactor;
    if (String(pick(e, 'bucket')).toUpperCase() === 'MRO') mro_per_unit += perUnit;
    else depr_per_unit += perUnit;
  });
  // IndMat(間接耗材)· 無 util · 年花/年量
  const consumUnit = {};
  ctx.consumMaster.forEach((c) => { consumUnit[pick(c, 'consumable_id')] = num(pick(c, 'unit_cost_usd')); });
  let annual_ind_mat = 0;
  ctx.caseConsum.filter((c) => pick(c, 'process_code') === procCode).forEach((c) => {
    const unit = num(pick(c, 'unit_cost_override_usd')) || consumUnit[pick(c, 'consumable_id')] || 0;
    annual_ind_mat += num(pick(c, 'annual_usage_qty')) * unit;
  });
  return {
    mro_per_unit, depr_per_unit,
    ind_mat_per_unit: annual_ind_mat / ad,
    _trace: { mro_per_unit, depr_per_unit, annual_ind_mat, util: d.util },
  };
}

// D. 廠房(r100 = sqft×$/sqft/annual_demand × util-if-flagged)· 讀 bom_cs_case_facility
function computeFacility(proc, ctx) {
  const procCode = pick(proc, 'process_code');
  const ad = num(ctx.annualDemand) || 1;
  const d = procDerive(proc, ctx.annualDemand);
  const row = (ctx.facility || []).find((f) => pick(f, 'process_code') === procCode);
  if (!row) return { facility_per_unit: 0, _trace: { sqft: 0 } };
  const sqft = num(pick(row, 'sqft'));
  const rate = num(pick(row, 'sqft_unit_cost_usd')) || ctx.sqftUnitCost || SQFT_UNIT_COST_DEFAULT;
  const utilFactor = num(pick(row, 'apply_util')) ? d.util : 1;
  const facility_per_unit = (sqft * rate / ad) * utilFactor;
  return { facility_per_unit, _trace: { sqft, rate, util: d.util, utilFactor } };
}

// E. Common(一次)· Freight/Loss 進 MVA;VAT ≈0 且**不進 MVA**(真 Excel r118 未含 VAT)
function computeOthers(ctx) {
  const mb = num(ctx.motherboard);
  const ad = num(ctx.annualDemand) || 1;
  const freight_per_unit = (num(ctx.baselineInboundFreight) || 2500) / ad;   // r107
  const loss_per_unit = mb * (num(ctx.baselineLoss) || 0.0008);              // r110
  const vat_per_unit = mb * (num(ctx.baselineVat) || 0.17) / ad;            // r114 ≈0(不進 MVA)
  return { freight_per_unit, loss_per_unit, vat_per_unit };
}

// ── FULL_MVA 聚合 — MVA = Σ製程(DL+IDL+MRO+DEPR+INDMAT+FACILITY) + Freight + Loss(無 VAT)──
function computeFullMva(inputs, ctx) {
  const cells = [];
  const add = (process_code, component_code, v, inMva, trace) =>
    cells.push({ qty_scenario_code: ctx.qtyScenarioCode || null, process_code, component_code,
      cost_per_unit_usd: num(v), in_mva: inMva !== false, intermediate: trace || null });
  for (const proc of inputs.processes) {
    const pc = pick(proc, 'process_code');
    const dl = computeDl(proc, ctx);        add(pc, 'DL_CPU', dl.perUnit, true, dl._trace);
    const idl = computeIdl(proc, ctx);      add(pc, 'IDL_CPU', idl.perUnit, true);
    const eq = computeEquipment(proc, ctx); add(pc, 'EQUIP_MRO', eq.mro_per_unit, true); add(pc, 'EQUIP_DEPR', eq.depr_per_unit, true); add(pc, 'IND_MAT', eq.ind_mat_per_unit, true, eq._trace);
    const fa = computeFacility(proc, ctx);  add(pc, 'FACILITY', fa.facility_per_unit, true, fa._trace);
  }
  const oth = computeOthers(ctx);
  add('COMMON', 'FREIGHT', oth.freight_per_unit, true);
  add('COMMON', 'LOSS', oth.loss_per_unit, true);
  add('COMMON', 'VAT', oth.vat_per_unit, false);   // 顯示但不進 MVA
  const mvaTotal = cells.filter((c) => c.in_mva).reduce((s, c) => s + c.cost_per_unit_usd, 0);
  return { cells, mvaTotal };
}

// ── SIMPLIFIED_WEARABLE(WHOOP · whoop_golden.json · S1c)─────────────────────
// subtotal = Σ(材料模組 + 製程元件 + yield loss)per-unit → OH=sub×oh_pct · Transport(定值)
//   material/process line 進 cells(in_mva=false · 明細)· OH+Transport 進 cells(in_mva=true → mvaTotal)
//   SGA/Profit 在 computeCase 用 base_ref=bom_subtotal 算(非 mva)。回 subtotal 供 material_true / base。
function computeSimplifiedMva(inputs, ctx) {
  const cells = [];
  const add = (process_code, component_code, v, inMva, trace) =>
    cells.push({ qty_scenario_code: ctx.qtyScenarioCode || null, process_code, component_code,
      cost_per_unit_usd: num(v), in_mva: inMva === true, intermediate: trace || null });

  // W1b:有 BOM(ctx.bomMaterial 非 null)→ 材料 line 改用 BOM rollup,跳過常數 MATERIAL line;PROCESS/LOSS 仍用 line
  const bomMat = ctx.bomMaterial;
  let subtotal = 0;
  for (const ln of (inputs.simplifiedLines || [])) {
    const v = num(pick(ln, 'cost_per_unit_usd'));
    const grp = pick(ln, 'line_group') || 'MATERIAL';
    if (bomMat != null && grp === 'MATERIAL') continue;   // 有 BOM → 材料改 rollup,不用常數材料 line
    if (num(pick(ln, 'in_subtotal'))) subtotal += v;
    // 明細 cell(不進 mva · 屬 material_true 的組成)
    add(grp, pick(ln, 'component_code') || 'MATERIAL', v, false, { line_code: pick(ln, 'line_code') });
  }
  if (bomMat != null) { subtotal += num(bomMat); add('MATERIAL', 'MATERIAL', num(bomMat), false, { source: 'bom_rollup' }); }

  const oh = subtotal * num(ctx.ohPct);
  const transport = num(ctx.transportPerUnit);
  add('COMMON', 'OVERHEAD_4PCT', oh, true, { base: subtotal, pct: ctx.ohPct });
  add('COMMON', 'TRANSPORTATION', transport, true);

  // SIMPLIFIED 的 mva 語意 = OH + Transport(見 S1 plan 決策 A · run_result.mva 落此)
  const mvaTotal = oh + transport;
  return { cells, mvaTotal, subtotal };
}

// ── persist(寫 bom_cs_run / run_cell / run_result + audit · 兩 model 共用)────
/**
 * persistRun — 把計算結果落庫(S1c-2)
 *   冪等:先把舊 status='ready' run archive,再插新 run(留歷史,不刪)。
 *   run_cell:cells 按 (scenario, process, component) 聚合(SIMPLIFIED 多 line 映同 component → 免撞 PK)。
 *   run_result:1 fact 列(quote 側 = true 側 · open #1 預設)。VIRTUAL total/margin 不塞。
 * @returns runId
 */
async function persistRun(db, { caseFactoryId, factoryCode, costingModel, cells, costBreakdown, qtyScenarioCode, computedBy, rawInputs }) {
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const scenario = qtyScenarioCode || 'BASE';

  // 1. 冪等:archive 舊 ready run
  await run(`UPDATE bom_cs_run SET status='archived' WHERE case_factory_id=? AND status='ready'`, caseFactoryId);

  // 2. run header(wrapper RETURNING 只認 'id' 欄 → run_id 拿不到 → MAX 回讀 · compute 非高並發)
  await run(
    `INSERT INTO bom_cs_run (case_factory_id, status, compute_engine, raw_inputs_json, computed_by) VALUES (?, 'ready', ?, ?, ?)`,
    caseFactoryId, 'bomCostEngine@S1', rawInputs ? JSON.stringify(rawInputs) : null, computedBy || null,
  );
  const runId = Number(val(await get(`SELECT MAX(run_id) AS id FROM bom_cs_run WHERE case_factory_id=?`, caseFactoryId)));

  // 3. run_cell:先按 (scenario, process, component) 聚合(SIMPLIFIED 多 line → 同 component 免撞 PK)
  const agg = new Map();
  for (const c of (cells || [])) {
    const sc = c.qty_scenario_code || scenario;
    const pc = c.process_code || 'COMMON';
    const key = `${sc}||${pc}||${c.component_code}`;
    const prev = agg.get(key);
    if (prev) { prev.cost += num(c.cost_per_unit_usd); if (c.intermediate) prev.lines.push(c.intermediate); }
    else agg.set(key, { sc, pc, comp: c.component_code, cost: num(c.cost_per_unit_usd), lines: c.intermediate ? [c.intermediate] : [] });
  }
  for (const cell of agg.values()) {
    await run(
      `INSERT INTO bom_cs_run_cell (run_id, qty_scenario_code, process_code, component_code, cost_per_unit_usd, intermediate_json) VALUES (?,?,?,?,?,?)`,
      runId, cell.sc, cell.pc, cell.comp, cell.cost, cell.lines.length ? JSON.stringify(cell.lines) : null,
    );
  }

  // 4. run_result(1 fact · true/quote 雙軌 + NRE 攤提)· VIRTUAL total 為產品成本,NRE 攤提另存兩欄
  const mat = num(costBreakdown.material), pkg = num(costBreakdown.pkg);
  const matTrue = costBreakdown.materialTrue != null ? num(costBreakdown.materialTrue) : mat;
  const nreQ = num(costBreakdown.nreAmort), nreT = num(costBreakdown.nreAmortTrue);
  await run(
    `INSERT INTO bom_cs_run_result
      (run_id, factory_code, qty_scenario_code, material_true_usd, pkg_true_usd, mva_usd, sga_usd, profit_amount_usd, material_quote_usd, pkg_quote_usd, nre_per_unit_quote_usd, nre_per_unit_true_usd)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    runId, factoryCode || null, scenario, matTrue, pkg, num(costBreakdown.mva), num(costBreakdown.sga), num(costBreakdown.profit), mat, pkg, nreQ, nreT,
  );

  // 5. audit(不擋主流程)
  try {
    await run(
      `INSERT INTO bom_audit_log (entity_type, case_factory_id, event_type, event_payload, actor_user_id) VALUES ('RUN', ?, 'CS_COMPUTED', ?, ?)`,
      caseFactoryId, JSON.stringify({ runId, costingModel, total: num(costBreakdown.total) }), computedBy || null,
    );
  } catch (e) { log.warn('persistRun audit:', e.message); }

  return runId;
}

// ── 主入口 ─────────────────────────────────────────────────────────────────
/**
 * computeCase — 單一計算入口
 * @returns { runId, costingModel, plan, costBreakdown, cells, results }
 * S1b:FULL_MVA 全鏈(移植 demo)· SIMPLIFIED 仍 stub(S1c)· persist 留 S1c。
 */
async function computeCase(db, opts = {}) {
  const { caseFactoryId, qtyScenarioCode, motherboardCostUsd, bomInstanceId, persist = true } = opts;
  if (!caseFactoryId) throw new Error('bomCostEngine.computeCase: caseFactoryId required');

  const inputs = await loadCaseInputs(db, caseFactoryId);
  const { baseline } = inputs;
  const costingModel = pick(inputs.caseFactory, 'costing_model')
    || pick(baseline, 'costing_model') || 'FULL_MVA';
  const plan = await buildComponentPlan(db, costingModel);

  // material(FULL 的 motherboard)優先序:BOM rollup(bomInstanceId · B-2)> 參數 > baseline.motherboard_cost_ref
  //   rollup 是獨立 service(解耦)· 現 EE、匯入 ME/PKG 後自動含全材料(對 Unit Cost Material Cost)
  let materialFromBom = null, materialTrueFromBom = null;
  if (bomInstanceId) {
    const roll = await require('./bomMaterialRollup').rollupMaterial(db, bomInstanceId);
    // B-5a 兩階段:有未詢價(PENDING)料件 → 材料不完整,擋算成本;帶 opts.allowPending 才放行
    if (num(roll.pendingCount) > 0 && !opts.allowPending) {
      const e = new Error(`BOM_HAS_PENDING_PRICES: ${roll.pendingCount} 筆料件尚未詢價(材料不完整)`);
      e.code = 'BOM_HAS_PENDING_PRICES';
      e.pendingCount = num(roll.pendingCount);
      throw e;
    }
    materialFromBom = num(roll.materialUsd);
    materialTrueFromBom = roll.materialTrueUsd != null ? num(roll.materialTrueUsd) : null;  // true/quote 雙軌
  }
  const motherboard = materialFromBom != null ? materialFromBom
    : (motherboardCostUsd != null ? num(motherboardCostUsd) : num(pick(baseline, 'motherboard_cost_ref')));
  const annualDemand = (() => {
    if (qtyScenarioCode) {
      const sc = inputs.qtyScenarios.find((s) => pick(s, 'scenario_code') === qtyScenarioCode);
      if (sc) return num(pick(sc, 'target_qty'));
    }
    const baseSc = inputs.qtyScenarios.find((s) => num(pick(s, 'is_baseline')) === 1);
    return baseSc ? num(pick(baseSc, 'target_qty')) : num(pick(baseline, 'annual_demand_default'));
  })();

  // process_code → process_group(SMT/BB/FATP · DL 分組公式用)
  const procGroup = {};
  (inputs.procCatalog || []).forEach((p) => { procGroup[pick(p, 'process_code')] = pick(p, 'process_group'); });

  const ctx = {
    qtyScenarioCode, motherboard, annualDemand, procGroup,
    bomMaterial: materialFromBom,   // W1b:SIMPLIFIED 有 BOM 時材料改用 rollup(null=無 BOM 用常數 line)
    dlWage: num(pick(baseline, 'dl_wage_per_hr_usd')),
    baselineVat: num(pick(baseline, 'vat_rate_pct')),
    baselineLoss: num(pick(baseline, 'loss_factor_pct')),
    baselineInboundFreight: num(pick(baseline, 'inbound_freight_annual')),
    sqftUnitCost: SQFT_UNIT_COST_DEFAULT, // TODO baseline.floor_cost_per_sqft
    ohPct: num(pick(baseline, 'oh_pct')),                                  // SIMPLIFIED OH%
    transportPerUnit: num(pick(baseline, 'outbound_transportation_per_unit_usd')), // SIMPLIFIED 運輸/unit
    idlRoles: inputs.idlRoles, idlAlloc: inputs.idlAlloc, idlLinedep: inputs.idlLinedep,
    equipArea: inputs.equipArea, facility: inputs.facility,
    caseConsum: inputs.caseConsum, consumMaster: inputs.consumMaster,
  };

  // 單一 top-level 分流(非散落 if · 各 model 呼叫共用 helper)
  const isSimplified = costingModel === 'SIMPLIFIED_WEARABLE';
  const mva = isSimplified ? computeSimplifiedMva(inputs, ctx) : computeFullMva(inputs, ctx);

  // material_true / base:FULL=motherboard · SIMPLIFIED=subtotal(材料+製程 line 總和)
  const materialUsd = isSimplified ? num(mva.subtotal) : motherboard;   // quote 側(對客報價材料)
  const bomSubtotal = isSimplified ? num(mva.subtotal) : motherboard;
  // true 側(內部真實成本材料):FULL 用 BOM chosen tier true_cost(無 BOM → = quote);SIMPLIFIED 無料件層 markup → = quote
  const materialTrue = isSimplified ? materialUsd : (materialTrueFromBom != null ? materialTrueFromBom : materialUsd);

  // SGA / Profit / TC(兩 model 共用 · base_ref 參數化)
  const mvaTotal = mva.mvaTotal;
  const sgaBase = resolveBaseRef(baseline, 'sga', { motherboard, mva: mvaTotal, bomSubtotal });
  const profitBase = resolveBaseRef(baseline, 'profit', { motherboard, mva: mvaTotal, bomSubtotal });
  const sga = sgaBase * num(pick(baseline, 'sga_pct'));
  const profit = profitBase * num(pick(baseline, 'profit_pct'));
  const productTotal = materialUsd + mvaTotal + sga + profit;        // 產品 unit cost(不含 NRE)
  const productTotalTrue = materialTrue + mvaTotal + sga + profit;

  // Track N:AMORTIZED → NRE 每台攤提折進 total(SEPARATE / 無 NRE → 0 · 不影響)
  const caseId = num(pick(inputs.caseFactory, 'case_id'));
  const nre = caseId ? await require('./bomNreService').amortizedPerUnit(db, caseId) : { nrePerUnitQuote: 0, nrePerUnitTrue: 0, mode: 'SEPARATE' };
  const nreQuote = num(nre.nrePerUnitQuote), nreTrue = num(nre.nrePerUnitTrue);

  const total = productTotal + nreQuote;                             // 對客報價 total(含 NRE 攤提)
  const totalTrue = productTotalTrue + nreTrue;                      // 內部真實成本 total(含 NRE)
  const marginUsd = total - totalTrue;
  const marginPct = total > 0 ? marginUsd / total : 0;

  const costBreakdown = { material: materialUsd, materialTrue, pkg: 0, mva: mvaTotal, sga, profit,
    nreAmort: nreQuote, nreAmortTrue: nreTrue, nreMode: nre.mode, productTotal, productTotalTrue,
    total, totalTrue, marginUsd, marginPct, subtotal: isSimplified ? num(mva.subtotal) : null };

  let runId = null;
  if (persist) {
    runId = await persistRun(db, {
      caseFactoryId, factoryCode: pick(inputs.caseFactory, 'factory_code'), costingModel,
      cells: mva.cells, costBreakdown, qtyScenarioCode: ctx.qtyScenarioCode,
      computedBy: opts.computedBy || null,
      rawInputs: { costingModel, motherboard, annualDemand, cellCount: mva.cells.length },
    });
  }

  return { runId, costingModel, plan, costBreakdown, cells: mva.cells, results: [] };
}

/**
 * loadPersistedRun — 從已落庫的 run_result 反推 costBreakdown(還原 ⑤ 成本結果 · 重整不消失)
 * 回傳 shape 對齊 computeCase:{ runId, costingModel, costBreakdown }。total 由組件重算(VIRTUAL 不落庫)。
 */
async function loadPersistedRun(db, runId) {
  const r = await db.prepare(
    `SELECT rr.run_id, rr.material_quote_usd, rr.material_true_usd, rr.pkg_quote_usd,
            rr.mva_usd, rr.sga_usd, rr.profit_amount_usd, rr.nre_per_unit_quote_usd, rr.nre_per_unit_true_usd,
            cf.costing_model
       FROM bom_cs_run_result rr
       JOIN bom_cs_run run ON run.run_id = rr.run_id
       JOIN bom_cs_case_factory cf ON cf.case_factory_id = run.case_factory_id
      WHERE rr.run_id = ?`,
  ).get(runId).catch(() => null);
  if (!r) return null;
  const material = num(pick(r, 'material_quote_usd')), materialTrue = num(pick(r, 'material_true_usd'));
  const pkg = num(pick(r, 'pkg_quote_usd'));
  const mva = num(pick(r, 'mva_usd')), sga = num(pick(r, 'sga_usd')), profit = num(pick(r, 'profit_amount_usd'));
  const nreAmort = num(pick(r, 'nre_per_unit_quote_usd')), nreAmortTrue = num(pick(r, 'nre_per_unit_true_usd'));
  const total = material + mva + sga + profit + nreAmort;                  // pkg 恆入 material rollup(=0)
  const totalTrue = materialTrue + mva + sga + profit + nreAmortTrue;
  const marginUsd = total - totalTrue, marginPct = total > 0 ? marginUsd / total : 0;
  return {
    runId: num(pick(r, 'run_id')), costingModel: pick(r, 'costing_model'),
    costBreakdown: { material, materialTrue, pkg, mva, sga, profit, nreAmort, nreAmortTrue, total, totalTrue, marginUsd, marginPct },
  };
}

module.exports = {
  computeCase,
  loadPersistedRun,
  buildComponentPlan,
  loadCaseInputs,
  resolveBaseRef,
  persistRun,
  // 匯出供測試/後續 slice
  _internal: { pick, num },
};
