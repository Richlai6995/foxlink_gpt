/**
 * Migration 013i — 案級 SIMPLIFIED 成本 line 輸入表(WHOOP 穿戴)
 *
 * 對應 docs/cortex-s1-cost-engine-plan.md §6.5.2(WHOOP · whoop_golden.json)
 *
 * SIMPLIFIED_WEARABLE 的 subtotal = Σ(材料模組 + 製程元件 + yield loss)per-unit。
 * 這是 FULL_MVA 逐製程 cell 的 SIMPLIFIED 對應物:每 line 一個 per-unit 成本 + component 映射。
 * S1c 先以 golden E 欄值當 seed input 驗轉換(OH/SGA/Profit/Transport → TTL);
 * SMT 點數明細推導(category×PCS×算式→709.45→per-unit)屬 WHOOP 專屬 optional follow-on。
 *
 * 純加性新表 · gate 在 ENABLE_CORTEX_BOM(index.js 內)。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013i');

module.exports = async function migrate013i(db) {
  const createTable = async (name, ddl) => {
    try {
      const r = await db.prepare(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name = UPPER(?)`).get(name);
      if (r && Number(Object.values(r)[0]) > 0) return false;
      await db.prepare(ddl).run();
      log.log(`created table ${name}`);
      return true;
    } catch (e) { log.warn(`createTable ${name}:`, e.message); return false; }
  };
  const _idx = async (sql, name) => {
    try { await db.prepare(sql).run(); log.log(`index ${name}`); }
    catch (e) { if (!/already used|already exists|ORA-00955|ORA-01408/.test(e.message)) log.warn(`index ${name}:`, e.message); }
  };

  // bom_cs_case_simplified_line — SIMPLIFIED subtotal 的逐 line per-unit 成本
  //   line_group: MATERIAL(材料模組)| PROCESS(SMT/glue-ATE/FATP)| LOSS(yield loss)
  //   component_code 映射 bom_cs_component(MATERIAL/SMT_POINTS/PROC_MACRO/MAT_LOSS_RATE · run_cell 落庫用)
  //   in_subtotal=1 才計入 subtotal(保留彈性:未來可放不計入的參考 line)
  await createTable('BOM_CS_CASE_SIMPLIFIED_LINE', `
    CREATE TABLE bom_cs_case_simplified_line (
      case_factory_id   NUMBER NOT NULL,
      line_code         VARCHAR2(60) NOT NULL,
      component_code    VARCHAR2(40),
      line_group        VARCHAR2(20),
      cost_per_unit_usd NUMBER(15,6),
      in_subtotal       NUMBER(1) DEFAULT 1,
      sort_order        NUMBER,
      CONSTRAINT pk_cssimpl PRIMARY KEY (case_factory_id, line_code),
      CONSTRAINT fk_cssimpl_cf FOREIGN KEY (case_factory_id) REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE
    )`);
  await _idx(`CREATE INDEX idx_cssimpl_cf ON bom_cs_case_simplified_line(case_factory_id)`, 'idx_cssimpl_cf');

  log.log('migration 013i ✓');
};
