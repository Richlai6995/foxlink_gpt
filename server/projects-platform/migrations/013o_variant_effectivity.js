/**
 * Migration 013o — BOM 變異維度 + 逐料 effectivity(super-BOM / configurable BOM · dark-launch)
 *
 * 對應 docs/cortex-bom-source-excel-structure.md §3(顏色/包裝維度 · EE 共用 / ME・PKG 分開)。
 * 一份 super-BOM 含所有料;每料可帶 0..N 個 (維度, 值) tag。
 *   - 無 tag = 共用(恆含,如 EE 核心)
 *   - tag 顏色=Black = 只有 config 選 Black 時才含(ME 分色)
 *   - 複合 = 多列不同 dimension(Black + 包裝US),全命中才含
 * resolve(config) = 共用料 ∪ (所有 tag 都被 config 選中的料)。
 *
 * 向下相容:既有 BOM 無 effectivity 列 → 任何 config 都含全料 → 行為不變。
 * gate 在 ENABLE_CORTEX_BOM。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013o');

module.exports = async function migrate013o(db) {
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const exists = async (t) => Number(val(await one(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name=:t`, t)));

  if (!(await exists('BOM_VARIANT_DIMENSION'))) {
    try {
      await run(`
        CREATE TABLE bom_variant_dimension (
          id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          project_id  NUMBER NOT NULL,
          dim_code    VARCHAR2(40) NOT NULL,          -- '顏色' | '包裝' (per-project 定義)
          dim_name    VARCHAR2(120),
          sort_order  NUMBER DEFAULT 10,
          created_at  TIMESTAMP DEFAULT SYSTIMESTAMP,
          CONSTRAINT uq_bvd UNIQUE (project_id, dim_code)
        )`);
      log.log('created bom_variant_dimension');
    } catch (e) { log.warn('create bom_variant_dimension:', e.message); }
  }

  if (!(await exists('BOM_VARIANT_VALUE'))) {
    try {
      await run(`
        CREATE TABLE bom_variant_value (
          id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          dimension_id  NUMBER NOT NULL,
          value_code    VARCHAR2(60) NOT NULL,        -- 'Black' | 'White' | 'Retail' | ...
          value_name    VARCHAR2(120),
          sort_order    NUMBER DEFAULT 10,
          created_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
          CONSTRAINT uq_bvv UNIQUE (dimension_id, value_code),
          CONSTRAINT fk_bvv_dim FOREIGN KEY (dimension_id) REFERENCES bom_variant_dimension(id) ON DELETE CASCADE
        )`);
      log.log('created bom_variant_value');
    } catch (e) { log.warn('create bom_variant_value:', e.message); }
  }

  if (!(await exists('BOM_ITEM_EFFECTIVITY'))) {
    try {
      await run(`
        CREATE TABLE bom_item_effectivity (
          bom_item_id   NUMBER NOT NULL,
          dimension_id  NUMBER NOT NULL,
          value_id      NUMBER NOT NULL,
          created_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
          CONSTRAINT pk_bie PRIMARY KEY (bom_item_id, dimension_id),   -- 一料一維度最多一值
          CONSTRAINT fk_bie_item FOREIGN KEY (bom_item_id) REFERENCES bom_item(id) ON DELETE CASCADE,
          CONSTRAINT fk_bie_val  FOREIGN KEY (value_id)    REFERENCES bom_variant_value(id) ON DELETE CASCADE
        )`);
      log.log('created bom_item_effectivity');
    } catch (e) { log.warn('create bom_item_effectivity:', e.message); }
  }

  log.log('migration 013o ✓');
};
