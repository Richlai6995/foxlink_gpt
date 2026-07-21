/**
 * Migration 013p — bom_cs_run 加 variant_value_ids(記此 run 算的是哪個 config · B-2 · dark-launch)
 *
 * super-BOM 下,同一廠別對不同 config(顏色/包裝)各算一筆 run。
 * variant_value_ids = sorted valueIds CSV(空=無 config)。
 * → 切產品配置能撈「該 (廠別, config) 的最近 run」→ 成本結果跟著跳。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013p');

module.exports = async function migrate013p(db) {
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const hasCol = async (t, c) => Number(val(await one(`SELECT COUNT(*) AS C FROM user_tab_columns WHERE table_name=:t AND column_name=:c`, t, c)));

  if (!(await hasCol('BOM_CS_RUN', 'VARIANT_VALUE_IDS'))) {
    try { await run(`ALTER TABLE bom_cs_run ADD variant_value_ids VARCHAR2(200)`); log.log('added bom_cs_run.variant_value_ids'); }
    catch (e) { log.warn('add variant_value_ids:', e.message); }
  }

  log.log('migration 013p ✓');
};
