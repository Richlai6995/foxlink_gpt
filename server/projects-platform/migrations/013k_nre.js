/**
 * Migration 013k — NRE 一次性工程費(Track N · dark-launch)
 *
 * 對應 docs/cortex-bom-import-plan.md §8。NRE 正交於材料鏈,可「單獨報」(SEPARATE)或
 * 「由產品單價分攤」(AMORTIZED)。掛 project 層(一產品一組 · item.factory_code 選填)。
 *
 * - bom_nre_item:逐項 · 雙價 true/quote(同 bom_item_price_tier VIRTUAL pattern)+ detail_json 下鑽
 * - bom_nre_config:project 級模式(SEPARATE|AMORTIZED)+ 分攤基數/側
 *
 * gate 在 ENABLE_CORTEX_BOM(index.js 內)。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013k');

module.exports = async function migrate013k(db) {
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const createTable = async (name, ddl) => {
    const ex = await one(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name=?`, name);
    if (Number(val(ex))) return;
    try { await run(ddl); log.log(`created ${name}`); } catch (e) { log.warn(`createTable ${name}:`, e.message); }
  };
  const idx = async (ddl, name) => { try { await run(ddl); } catch (e) { if (!/ORA-00955|already/i.test(e.message)) log.warn(`idx ${name}:`, e.message); } };

  await createTable('BOM_NRE_ITEM', `
    CREATE TABLE bom_nre_item (
      id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_id        NUMBER NOT NULL,
      category          VARCHAR2(30),          -- BUILD|EMC|DEV_LABOR|RELIABILITY|MTE_FIXTURE|TOOLING|TRAVEL|DVE|OTHER
      item_no           VARCHAR2(40),
      description       VARCHAR2(300),
      qty               NUMBER(15,4) DEFAULT 1,
      unit_price_true   NUMBER(15,6),
      unit_price_quote  NUMBER(15,6),
      sub_total_true    NUMBER(15,6) GENERATED ALWAYS AS (NVL(qty,0) * NVL(unit_price_true,0)) VIRTUAL,
      sub_total_quote   NUMBER(15,6) GENERATED ALWAYS AS (NVL(qty,0) * NVL(unit_price_quote,0)) VIRTUAL,
      factory_code      VARCHAR2(20),
      detail_json       CLOB,
      remark            VARCHAR2(500),
      sort_order        NUMBER DEFAULT 100,
      created_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT fk_nre_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )`);
  await idx(`CREATE INDEX idx_nre_project ON bom_nre_item(project_id, sort_order)`, 'idx_nre_project');

  await createTable('BOM_NRE_CONFIG', `
    CREATE TABLE bom_nre_config (
      project_id        NUMBER PRIMARY KEY,
      nre_mode          VARCHAR2(12) DEFAULT 'SEPARATE',   -- SEPARATE | AMORTIZED
      nre_amortize_qty  NUMBER,                            -- 分攤基數(program 總量)
      amortize_side     VARCHAR2(10) DEFAULT 'quote',      -- quote | true
      updated_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT fk_nrecfg_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )`);

  log.log('migration 013k ✓');
};
