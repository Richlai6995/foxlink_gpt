/**
 * Migration 013y — B-4 config 加成加權(bom_cs_case_config_weight)
 * WHOOP SOT §1.2:OH/SGA/Profit 可 per-包裝 config 乘數(Suit 欄 OH×2.72 / SGA×2.04 / Profit×2.04)。
 * 每列 = (案級廠 × 變異值)三乘數;compute 時 config valueIds 命中的列連乘;無列 = ×1。
 */
const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013y');

module.exports = async function migrate013y(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const has = Number(val(await one(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name = 'BOM_CS_CASE_CONFIG_WEIGHT'`)));
  if (!has) {
    try {
      await db.prepare(`
        CREATE TABLE bom_cs_case_config_weight (
          weight_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          case_factory_id NUMBER NOT NULL,
          value_id        NUMBER NOT NULL,
          oh_mult         NUMBER(10,4) DEFAULT 1,
          sga_mult        NUMBER(10,4) DEFAULT 1,
          profit_mult     NUMBER(10,4) DEFAULT 1,
          created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
          updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
          CONSTRAINT uq_ccw UNIQUE (case_factory_id, value_id),
          CONSTRAINT fk_ccw_cf FOREIGN KEY (case_factory_id) REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE,
          CONSTRAINT fk_ccw_val FOREIGN KEY (value_id) REFERENCES bom_variant_value(id) ON DELETE CASCADE
        )`).run();
      log.log('created bom_cs_case_config_weight');
    } catch (e) { log.warn('create bom_cs_case_config_weight:', e.message); }
  }
  log.log('migration 013y ✓');
};
