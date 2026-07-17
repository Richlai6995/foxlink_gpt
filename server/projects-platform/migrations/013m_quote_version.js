/**
 * Migration 013m — 報價定版/送審(bom_quote_version · dark-launch)
 *
 * 對應 docs/cortex-bom-import-plan.md(定版/送審 · 流程終點)。
 * 把某廠某 run 的成本「定版」成官方報價版本:送審(SUBMITTED)→ 核准(APPROVED = 官方 · 鎖 case_factory)。
 * 快照當下數字(之後 run 改也不變),一專案同時只有一個 APPROVED,新核准 supersede 舊的。
 *
 * gate 在 ENABLE_CORTEX_BOM。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013m');

module.exports = async function migrate013m(db) {
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);

  const ex = await one(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name='BOM_QUOTE_VERSION'`);
  if (!Number(val(ex))) {
    try {
      await run(`
        CREATE TABLE bom_quote_version (
          id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          project_id          NUMBER NOT NULL,
          version_no          NUMBER NOT NULL,
          case_factory_id     NUMBER,
          factory_code        VARCHAR2(20),
          run_id              NUMBER,
          status              VARCHAR2(20) DEFAULT 'SUBMITTED',   -- SUBMITTED | APPROVED | SUPERSEDED
          -- 快照(定版當下 · 之後改 run 不變)
          unit_quote_usd      NUMBER(15,6),      -- 單台對客(含 NRE 攤提 if AMORTIZED)
          unit_true_usd       NUMBER(15,6),      -- 單台內部真實
          nre_total_quote_usd NUMBER(15,6),      -- SEPARATE 模式的 NRE 單獨報總額(AMORTIZED → 0)
          nre_mode            VARCHAR2(12),
          costing_model       VARCHAR2(30),
          note                VARCHAR2(500),
          submitted_by        NUMBER,
          submitted_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
          approved_by         NUMBER,
          approved_at         TIMESTAMP,
          CONSTRAINT fk_qv_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )`);
      log.log('created bom_quote_version');
    } catch (e) { log.warn('create bom_quote_version:', e.message); }
  }
  try { await run(`CREATE INDEX idx_qv_project ON bom_quote_version(project_id, version_no DESC)`); }
  catch (e) { if (!/ORA-00955|already/i.test(e.message)) log.warn('idx_qv_project:', e.message); }

  log.log('migration 013m ✓');
};
