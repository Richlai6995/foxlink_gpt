/**
 * Migration 013s — 範本版本化(C-3 · dark-launch)
 * case_factory 加 is_active(1=現行/0=停用保留)+ effective_from。
 * 同 label 再存 → 舊版自動停用(留歷史可查),新版入庫 = 「更新同組合=新版+舊版保留」拍板。
 */
const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013s');

module.exports = async function migrate013s(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const hasCol = async (c) => Number(val(await one(`SELECT COUNT(*) AS C FROM user_tab_columns WHERE table_name='BOM_CS_CASE_FACTORY' AND column_name=?`, c)));

  if (!(await hasCol('IS_ACTIVE'))) {
    try { await db.prepare(`ALTER TABLE bom_cs_case_factory ADD is_active NUMBER(1) DEFAULT 1`).run(); log.log('added is_active'); }
    catch (e) { log.warn('add is_active:', e.message); }
  }
  if (!(await hasCol('EFFECTIVE_FROM'))) {
    try { await db.prepare(`ALTER TABLE bom_cs_case_factory ADD effective_from TIMESTAMP`).run(); log.log('added effective_from'); }
    catch (e) { log.warn('add effective_from:', e.message); }
  }
  log.log('migration 013s ✓');
};
