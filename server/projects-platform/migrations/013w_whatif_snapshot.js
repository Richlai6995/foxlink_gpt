/**
 * Migration 013w — What-if 試算沙盒快照(R2)
 * 進沙盒時 dump 全參數(5 case 表 + qty + baseline + idl_role)→ 放棄一鍵還原;套用=刪快照。
 * 每 cf 最多一份 active 快照(PK = case_factory_id)。
 */
const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013w');

module.exports = async function migrate013w(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const ex = Number(val(await one(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name='BOM_CS_WHATIF_SNAPSHOT'`)));
  if (!ex) {
    try {
      await db.prepare(`
        CREATE TABLE bom_cs_whatif_snapshot (
          case_factory_id     NUMBER PRIMARY KEY,
          snapshot_json       CLOB,
          base_breakdown_json CLOB,
          created_by          NUMBER,
          created_at          TIMESTAMP DEFAULT SYSTIMESTAMP,
          CONSTRAINT fk_whatif_cf FOREIGN KEY (case_factory_id) REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE
        )`).run();
      log.log('created bom_cs_whatif_snapshot');
    } catch (e) { log.warn('create whatif_snapshot:', e.message); }
  }
  log.log('migration 013w ✓');
};
