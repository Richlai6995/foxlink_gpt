/**
 * Migration 013u — NRE 議價欄(v0.16 #7 · Original vs Negotiated)
 * bom_nre_item 加 unit_price_negotiated(quote 側議價後價;NULL=未議 → 沿用 unit_price_quote)。
 * rollup effective = NVL(negotiated, quote) → 定版/攤提自動吃議價後;fixture 無議價 → golden 不變。
 */
const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013u');

module.exports = async function migrate013u(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const ex = Number(val(await one(
    `SELECT COUNT(*) AS C FROM user_tab_cols WHERE table_name='BOM_NRE_ITEM' AND column_name='UNIT_PRICE_NEGOTIATED'`,
  )));
  if (!ex) {
    try {
      await db.prepare(`ALTER TABLE bom_nre_item ADD (unit_price_negotiated NUMBER(15,6))`).run();
      log.log('added bom_nre_item.unit_price_negotiated');
    } catch (e) { log.warn('add unit_price_negotiated:', e.message); }
  }
  log.log('migration 013u ✓');
};
