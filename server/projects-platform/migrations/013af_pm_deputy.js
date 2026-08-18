/**
 * Migration 013af — PM 代理人(project_members.is_pm_deputy)
 * PM 可指定某成員為代理人,代其執行 PM 工作(Stage Gate 推進、成員管理)。
 * is_pm_deputy=1 的成員在 ACL / stagesService 視同具 PM 權限(專案級,非取代主 PM)。
 */
const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013af');

module.exports = async function migrate013af(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const has = Number(val(await one(
    `SELECT COUNT(*) AS C FROM user_tab_columns WHERE table_name = 'PROJECT_MEMBERS' AND column_name = 'IS_PM_DEPUTY'`,
  )));
  if (!has) {
    try { await db.prepare(`ALTER TABLE project_members ADD is_pm_deputy NUMBER(1) DEFAULT 0`).run(); log.log('added project_members.is_pm_deputy'); }
    catch (e) { log.warn('add is_pm_deputy:', e.message); }
  }
  log.log('migration 013af ✓');
};
