/**
 * Migration 013v — run 記 qty scenario(v0.16 #8 · 矩陣 qty 軸)
 * bom_cs_run 加 qty_scenario_code(NULL=BASE);run cache key 擴為 (cf, variant sig, qty)。
 * 既有 run 全是 BASE 算的 → NULL 語意=BASE,向下相容。
 */
const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013v');

module.exports = async function migrate013v(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const ex = Number(val(await one(
    `SELECT COUNT(*) AS C FROM user_tab_cols WHERE table_name='BOM_CS_RUN' AND column_name='QTY_SCENARIO_CODE'`,
  )));
  if (!ex) {
    try {
      await db.prepare(`ALTER TABLE bom_cs_run ADD (qty_scenario_code VARCHAR2(40))`).run();
      log.log('added bom_cs_run.qty_scenario_code');
    } catch (e) { log.warn('add qty_scenario_code:', e.message); }
  }
  log.log('migration 013v ✓');
};
