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

module.exports = { compareFactories };
