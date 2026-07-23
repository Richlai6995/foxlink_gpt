/**
 * bomFactoryCompareService.js — 多廠成本對比(factory_matrix MVP · 獨立 service)
 *
 * 對應 docs/cortex-bom-import-plan.md §16(Multi-Factory Cost Matrix)MVP。
 * 核心賣點:同一份 BOM 在專案的多個 case_factory(CN/VN/TW…)各算一次 → 比報價/真實/margin → 標最便宜。
 * 不建 §16 4 表 schema;直接 on-demand compute 每廠 + 從 costBreakdown 組對比(run 各自落庫)。
 *
 * 註:只有「同 costing_model」的廠可直接比 total(FULL 12 vs SIMPLIFIED 89 無意義)· UI 提示。
 */

const engine = require('./bomCostEngine');
const num = (v) => (typeof v === 'number' ? v : (v == null || v === '' ? 0 : Number(v) || 0));
const pick = (row, name) => { if (!row) return undefined; const lc = name.toLowerCase(); for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k]; return undefined; };

/**
 * 對比專案的所有 case_factory(各算同一 BOM)。
 * @returns { projectId, bomInstanceId, factories:[{caseFactoryId, factoryCode, costingModel, runId, material, materialTrue, mva, sga, profit, total, totalTrue, marginUsd, marginPct, isCheapest, error?}] }
 */
async function compareFactories(db, { projectId, bomInstanceId = null, qtyScenarioCode = null, allowPending = false, computedBy = null }) {
  if (!projectId) throw new Error('projectId required');
  const cases = await db.prepare(
    `SELECT case_factory_id, factory_code, costing_model FROM bom_cs_case_factory WHERE case_id = ? ORDER BY case_factory_id`,
  ).all(projectId).catch(() => []);

  const factories = [];
  for (const cf of cases) {
    const cfid = num(pick(cf, 'case_factory_id'));
    const factoryCode = pick(cf, 'factory_code');
    try {
      const out = await engine.computeCase(db, {
        caseFactoryId: cfid,
        bomInstanceId: bomInstanceId || undefined,
        qtyScenarioCode: qtyScenarioCode || undefined,
        allowPending, persist: true, computedBy,
      });
      const b = out.costBreakdown || {};
      factories.push({
        caseFactoryId: cfid, factoryCode, costingModel: out.costingModel, runId: out.runId,
        material: b.material, materialTrue: b.materialTrue, mva: b.mva, sga: b.sga, profit: b.profit,
        total: b.total, totalTrue: b.totalTrue, marginUsd: b.marginUsd, marginPct: b.marginPct,
      });
    } catch (e) {
      factories.push({ caseFactoryId: cfid, factoryCode, error: e.code || e.message });
    }
  }

  // 標最便宜(依對客報價 total · 只比有算出來的)
  const valid = factories.filter((f) => typeof f.total === 'number');
  const minTotal = valid.length ? Math.min(...valid.map((f) => f.total)) : null;
  for (const f of factories) f.isCheapest = (typeof f.total === 'number' && f.total === minTotal);

  return { projectId, bomInstanceId: bomInstanceId || null, factoryCount: factories.length, factories };
}

/**
 * getMatrix — 多廠矩陣(B-3d):列 = 產品配置組合(顏色×包裝 cartesian),欄 = 廠別。
 * cell 讀快取:bom_cs_run 以 (case_factory, variant_value_ids sig) 各留一筆 ready run(B-2 既有)。
 * 缺格 → 前端 on-demand 打 POST /compute(帶 valueIds)→ 落庫即成快取;本函數只讀不算。
 * @returns { factories, dimensions, combos:[{sig, valueIds, labels}], cells:{ "cfId|sig": {...} } }
 */
async function getMatrix(db, { projectId }) {
  if (!projectId) throw new Error('projectId required');
  const variantSvc = require('./bomVariantService');
  const cases = await db.prepare(
    `SELECT case_factory_id, factory_code, costing_model FROM bom_cs_case_factory WHERE case_id = ? ORDER BY case_factory_id`,
  ).all(projectId).catch(() => []);
  const factories = cases.map((c) => ({ caseFactoryId: num(pick(c, 'case_factory_id')), factoryCode: pick(c, 'factory_code'), costingModel: pick(c, 'costing_model') }));

  // 配置組合 = 各維度值的 cartesian(無維度 → 單一「無配置」組合)· 上限防呆 60
  const dims = await variantSvc.listDimensions(db, projectId);
  let combos = [{ sig: '', valueIds: [], labels: [] }];
  for (const d of dims) {
    if (!d.values.length) continue;
    const next = [];
    for (const c of combos) for (const v of d.values) next.push({ valueIds: [...c.valueIds, v.id], labels: [...c.labels, { dim: d.dimCode, value: v.valueCode }] });
    combos = next;
    if (combos.length > 60) { combos = combos.slice(0, 60); break; }
  }
  combos = combos.map((c) => ({ ...c, sig: [...c.valueIds].sort((a, b) => a - b).join(',') }));

  // 快取:各 (cf, sig) 的 ready run + result(persistRun archive 保證每組合最多一筆 ready)
  const cells = {};
  if (factories.length) {
    const ph = factories.map(() => '?').join(',');
    const rows = await db.prepare(
      `SELECT run.case_factory_id, NVL(run.variant_value_ids,'') AS sig, run.run_id, run.computed_at,
              rr.material_quote_usd, rr.material_true_usd, rr.mva_usd, rr.sga_usd, rr.profit_amount_usd,
              rr.nre_per_unit_quote_usd, rr.nre_per_unit_true_usd
         FROM bom_cs_run run JOIN bom_cs_run_result rr ON rr.run_id = run.run_id
        WHERE run.case_factory_id IN (${ph}) AND run.status = 'ready'`,
    ).all(...factories.map((f) => f.caseFactoryId)).catch(() => []);
    for (const r of rows) {
      const mat = num(pick(r, 'material_quote_usd')), matT = num(pick(r, 'material_true_usd'));
      const mva = num(pick(r, 'mva_usd')), sga = num(pick(r, 'sga_usd')), profit = num(pick(r, 'profit_amount_usd'));
      const nreQ = num(pick(r, 'nre_per_unit_quote_usd')), nreT = num(pick(r, 'nre_per_unit_true_usd'));
      const total = mat + mva + sga + profit + nreQ;
      const totalTrue = matT + mva + sga + profit + nreT;
      cells[`${num(pick(r, 'case_factory_id'))}|${pick(r, 'sig') || ''}`] = {
        runId: num(pick(r, 'run_id')), total, totalTrue,
        marginUsd: total - totalTrue, marginPct: total > 0 ? (total - totalTrue) / total : 0,
        computedAt: pick(r, 'computed_at'),
      };
    }
  }
  return { projectId, factories, dimensions: dims.map((d) => ({ dimCode: d.dimCode, values: d.values.map((v) => v.valueCode) })), combos, cells };
}

module.exports = { compareFactories, getMatrix };
