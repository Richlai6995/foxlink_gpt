/**
 * Migration 013q — BOM 層級 v2(半成品料號 + FLK 候選描述 · R-1 · dark-launch)
 *
 * 對應 BOM 架構重新規劃(Oracle ERP BOM 形狀):
 *   bom_section = 半成品(加 part_number:報價階段可空,匯入自動暫編 SA-{MOD}-n)
 *   bom_item_flk = Item 下多顆候選 FLK 料(加 description:替代料描述各異,如 95.3Ω vs 91Ω)
 * (section,item_no) 唯一性 = 匯入 app-level 驗證(Oracle 跨表 unique 不可行,不加 trigger)。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013q');

module.exports = async function migrate013q(db) {
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const hasCol = async (t, c) => Number(val(await one(`SELECT COUNT(*) AS C FROM user_tab_columns WHERE table_name=:t AND column_name=:c`, t, c)));

  if (!(await hasCol('BOM_SECTION', 'PART_NUMBER'))) {
    try { await run(`ALTER TABLE bom_section ADD part_number VARCHAR2(120)`); log.log('added bom_section.part_number'); }
    catch (e) { log.warn('add part_number:', e.message); }
  }
  if (!(await hasCol('BOM_ITEM_FLK', 'DESCRIPTION'))) {
    try { await run(`ALTER TABLE bom_item_flk ADD description VARCHAR2(500)`); log.log('added bom_item_flk.description'); }
    catch (e) { log.warn('add flk description:', e.message); }
  }

  log.log('migration 013q ✓');
};
