/**
 * Migration 013ab — 製程 MVA 段→站彈性化(M1)
 * 對齊 WHOOP 真表:FATP/SMA+BFT sheet = 段(Battery assy/Bird ATE…)→ 站(站數/UPH/Yield/工時/DL)。
 * - bom_cs_case_macro_station:站級表(段 bom_cs_case_macro_process 既有);段數/站數全自由 = 不同製程專案彈性
 * - simplified_line.macro_code:PROCESS line 綁段(calc_mode='MACRO' 時成本 = Σ 站 DL×wage/UPH)
 * - SMT 點數制(calc_mode='SMT_POINTS')用既有 bom_cs_case_smt_point + baseline.smt_point_unit_price
 */
const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013ab');

module.exports = async function migrate013ab(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const hasTable = Number(val(await one(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name = 'BOM_CS_CASE_MACRO_STATION'`)));
  if (!hasTable) {
    try {
      await db.prepare(`
        CREATE TABLE bom_cs_case_macro_station (
          station_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          case_factory_id NUMBER NOT NULL,
          macro_id        NUMBER NOT NULL,
          station_code    VARCHAR2(40) NOT NULL,
          name            VARCHAR2(200),
          sfc             VARCHAR2(10),
          num_stations    NUMBER(8,2) DEFAULT 1,
          uph             NUMBER(12,4),
          yield_pct       NUMBER(8,4),
          work_time_sec   NUMBER(12,4),
          dl_headcount    NUMBER(8,2) DEFAULT 1,
          sort_order      NUMBER DEFAULT 999,
          created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
          CONSTRAINT uq_cms UNIQUE (macro_id, station_code),
          CONSTRAINT fk_cms_macro FOREIGN KEY (macro_id) REFERENCES bom_cs_case_macro_process(macro_id) ON DELETE CASCADE,
          CONSTRAINT fk_cms_cf FOREIGN KEY (case_factory_id) REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE
        )`).run();
      log.log('created bom_cs_case_macro_station');
    } catch (e) { log.warn('create bom_cs_case_macro_station:', e.message); }
  }
  const hasCol = Number(val(await one(
    `SELECT COUNT(*) AS C FROM user_tab_columns WHERE table_name = 'BOM_CS_CASE_SIMPLIFIED_LINE' AND column_name = 'MACRO_CODE'`,
  )));
  if (!hasCol) {
    try { await db.prepare(`ALTER TABLE bom_cs_case_simplified_line ADD macro_code VARCHAR2(40)`).run(); log.log('added simplified_line.macro_code'); }
    catch (e) { log.warn('add macro_code:', e.message); }
  }
  log.log('migration 013ab ✓');
};
