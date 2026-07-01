/**
 * Migration 013h — DROP 設備舊模型 4 表(S1d 作廢)
 *
 * 對應 docs/cortex-s1-cost-engine-plan.md §6.5.1(設備模型逆向更正)
 *
 * S1d 把設備成本從 DEMO 的「類別定價 + mroPct + 類別折舊年限」模型,
 * 重寫成「Equipment List 每台 ext_cost/useful_life × 選擇性稼動率」模型(013f 新表)。
 * 舊 4 表全 codebase 無 live read(對抗式稽核 + grep 雙重確認 2026-07-01),安全 DROP:
 *   - bom_cs_case_equip_category  (案級 · 被 bom_cs_case_equip_area 取代)
 *   - bom_factory_equip_category_price (baseline 子 · mroPct 定價)
 *   - bom_factory_dep_years       (baseline 子 · 類別折舊年限)
 *   - bom_equip_category_catalog  (master · 上兩者 FK 標的)
 *
 * CREATE 已從 013a/013c 移除;本檔清既有 DB 殘留。CASCADE CONSTRAINTS 拆 FK · drop-if-exists 冪等。
 * gate 在 ENABLE_CORTEX_BOM(index.js 內 · 排最後)。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013h');

module.exports = async function migrate013h(db) {
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);

  // FK 安全序:先 drop 指向 catalog 的子表,再 catalog;dep_years 獨立。CASCADE CONSTRAINTS 雙保險。
  const TABLES = [
    'bom_cs_case_equip_category',
    'bom_factory_equip_category_price',
    'bom_factory_dep_years',
    'bom_equip_category_catalog',
  ];
  for (const t of TABLES) {
    try {
      const ex = await get(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name = UPPER(?)`, t);
      if (Number(val(ex)) > 0) {
        await run(`DROP TABLE ${t} CASCADE CONSTRAINTS PURGE`);
        log.log(`dropped ${t}`);
      }
    } catch (e) { log.warn(`drop ${t}:`, e.message); }
  }

  log.log('migration 013h ✓');
};
