/**
 * Migration 013ac — SMT 點數單價精度 4 位 → 6 位
 * 真值級單價(1.7736/675.67 點 ≈ 0.002625/點)在 NUMBER(12,4) 被截成 0.0026 → 每 unit 差 1%。
 * Oracle MODIFY 擴精度安全(縮不行);baseline 預設價 + per-category rule 一起擴。
 */
const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013ac');

module.exports = async function migrate013ac(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const scaleOf = async (table, col) => val(await one(
    `SELECT data_scale FROM user_tab_columns WHERE table_name = ? AND column_name = ?`, table, col,
  ));
  if (Number(await scaleOf('BOM_FACTORY_BASELINE', 'SMT_POINT_UNIT_PRICE')) < 6) {
    try { await db.prepare(`ALTER TABLE bom_factory_baseline MODIFY smt_point_unit_price NUMBER(14,6)`).run(); log.log('baseline.smt_point_unit_price → NUMBER(14,6)'); }
    catch (e) { log.warn('modify baseline smt price:', e.message); }
  }
  if (Number(await scaleOf('BOM_FACTORY_SMT_POINT_RULE', 'UNIT_PRICE_USD')) < 6) {
    try { await db.prepare(`ALTER TABLE bom_factory_smt_point_rule MODIFY unit_price_usd NUMBER(14,6)`).run(); log.log('smt_point_rule.unit_price_usd → NUMBER(14,6)'); }
    catch (e) { log.warn('modify rule price:', e.message); }
  }
  log.log('migration 013ac ✓');
};
