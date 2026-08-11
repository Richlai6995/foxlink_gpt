/**
 * Migration 013ae — effectivity 支援一料多值(候選1 · 5 pack 結構需要)
 * 原 PK (bom_item_id, dimension_id) 限一料一維一值 = 「料專屬某值」(色差料/包裝料);
 * 但「STRAP 適用 4 種包裝(獨缺 WB-Batt)」需一料多 tag → PK 擴 (item, dimension, value)。
 * 搭配 bomVariantService.effectivityFilter 改 per-維度 ∃tag∈選中 語意(單值資料行為不變)。
 */
const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013ae');

module.exports = async function migrate013ae(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const colCount = Number(val(await one(
    `SELECT COUNT(*) AS C FROM user_cons_columns WHERE constraint_name = 'PK_BIE' AND table_name = 'BOM_ITEM_EFFECTIVITY'`,
  )));
  if (colCount === 2) {
    try {
      await db.prepare(`ALTER TABLE bom_item_effectivity DROP CONSTRAINT pk_bie`).run();
      await db.prepare(`ALTER TABLE bom_item_effectivity ADD CONSTRAINT pk_bie PRIMARY KEY (bom_item_id, dimension_id, value_id)`).run();
      log.log('pk_bie → (bom_item_id, dimension_id, value_id)(一料一維可多值)');
    } catch (e) { log.warn('alter pk_bie:', e.message); }
  }
  log.log('migration 013ae ✓');
};
