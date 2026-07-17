/**
 * Migration 013l — bom_cs_run_result 加 nre_per_unit_quote/true(AMORTIZED 折進 unit total · Track N)
 *
 * 對應 docs/cortex-bom-import-plan.md §8.3。AMORTIZED 模式:computeCase 把 Σ NRE / 分攤基數
 * 每台攤提折進 total,並持久化到 run_result,讓 /summary /compare 讀到的 total 一致含 NRE。
 * VIRTUAL total_quote/true 維持「產品成本」(不含 NRE);NRE 攤提另存兩欄,app 層加總 = 含 NRE 報價。
 *
 * 加性 ALTER(idempotent)· gate 在 ENABLE_CORTEX_BOM。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013l');

module.exports = async function migrate013l(db) {
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const hasCol = async (col) =>
    Number(val(await get(`SELECT COUNT(*) AS C FROM user_tab_columns WHERE table_name='BOM_CS_RUN_RESULT' AND column_name=?`, col)));

  try {
    const missing = [];
    if (!(await hasCol('NRE_PER_UNIT_QUOTE_USD'))) missing.push('nre_per_unit_quote_usd NUMBER(15,6)');
    if (!(await hasCol('NRE_PER_UNIT_TRUE_USD'))) missing.push('nre_per_unit_true_usd NUMBER(15,6)');
    if (missing.length) {
      await run(`ALTER TABLE bom_cs_run_result ADD (${missing.join(', ')})`);
      log.log(`added bom_cs_run_result: ${missing.join(', ')}`);
    }
  } catch (e) { log.warn('addColumn nre_per_unit:', e.message); }

  log.log('migration 013l ✓');
};
