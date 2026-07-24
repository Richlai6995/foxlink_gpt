/**
 * Migration 013r — case_factory 加 template_label(範本命名 · C-2.5 · dark-launch)
 * 範本庫內同 (廠別×模型) 可多套,靠 label 區分(「CN 穿戴標準 2026Q3」);一般專案 cf 此欄 NULL。
 */
const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013r');

module.exports = async function migrate013r(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const has = Number(val(await one(`SELECT COUNT(*) AS C FROM user_tab_columns WHERE table_name='BOM_CS_CASE_FACTORY' AND column_name='TEMPLATE_LABEL'`)));
  if (!has) {
    try { await db.prepare(`ALTER TABLE bom_cs_case_factory ADD template_label VARCHAR2(120)`).run(); log.log('added template_label'); }
    catch (e) { log.warn('add template_label:', e.message); }
  }
  log.log('migration 013r ✓');
};
