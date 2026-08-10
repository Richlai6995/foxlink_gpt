/**
 * Migration 013y — 【已收回】B-4 config 加成加權(bom_cs_case_config_weight)
 * 2026-08-10 更正:原「Suit OH×2.72」是誤讀 — 真 Excel 的 2.72 是金額(subtotal $68 × 4%),
 * 不是乘數;OH/SGA/Profit 本來就 = 各 config 自己的 subtotal × 共用 %,不需要加權機制。
 * 真需求改為 013z 製程線 per-config 用量倍率(bom_cs_case_line_config)。
 * 本 migration 現在只負責把曾建出的表 DROP(fresh install 無表 = no-op)。
 */
const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013y');

module.exports = async function migrate013y(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const has = Number(val(await one(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name = 'BOM_CS_CASE_CONFIG_WEIGHT'`)));
  if (has) {
    try {
      await db.prepare(`DROP TABLE bom_cs_case_config_weight CASCADE CONSTRAINTS`).run();
      log.log('dropped bom_cs_case_config_weight(B-4 乘數誤讀收回)');
    } catch (e) { log.warn('drop bom_cs_case_config_weight:', e.message); }
  }
  log.log('migration 013y ✓(retracted)');
};
