/**
 * Migration 013z — B-4' 製程線 per-config 用量倍率(bom_cs_case_line_config)
 * WHOOP 真表結構(row 14~22):每個包裝 config 對各成本線有 用量/倍率 欄 —
 * 例 Battery Pack:Board glue+ATE=0(不做)、SMT Yield=0.05、FATP Yield=1.7。
 * subtotal = Σ(line 金額 × 該 config 倍率)→ OH/SGA/Profit = subtotal × %(自動 per-config)。
 * 預設無列 = ×1;有 BOM 時 MATERIAL line 由 rollup 取代,倍率自然只作用 PROCESS/LOSS。
 */
const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013z');

module.exports = async function migrate013z(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const has = Number(val(await one(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name = 'BOM_CS_CASE_LINE_CONFIG'`)));
  if (!has) {
    try {
      await db.prepare(`
        CREATE TABLE bom_cs_case_line_config (
          line_config_id  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          case_factory_id NUMBER NOT NULL,
          line_code       VARCHAR2(60) NOT NULL,
          component_code  VARCHAR2(60) NOT NULL,
          value_id        NUMBER NOT NULL,
          multiplier      NUMBER(10,4) DEFAULT 1,
          created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
          updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
          CONSTRAINT uq_clc UNIQUE (case_factory_id, line_code, component_code, value_id),
          CONSTRAINT fk_clc_cf FOREIGN KEY (case_factory_id) REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE,
          CONSTRAINT fk_clc_val FOREIGN KEY (value_id) REFERENCES bom_variant_value(id) ON DELETE CASCADE
        )`).run();
      log.log('created bom_cs_case_line_config');
    } catch (e) { log.warn('create bom_cs_case_line_config:', e.message); }
  }
  log.log('migration 013z ✓');
};
