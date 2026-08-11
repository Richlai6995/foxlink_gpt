/**
 * Migration 013ad — per-廠別/區域 料價(SOT §2.3:EE to/out of China 的泛化)
 * 廠區彈性(CN/VN/TW + 規劃中 US/IN):料價掛「價格區域」,廠別映射區域。
 * - bom_item_price_region:vendor 報價(snapshot)× region → 覆寫價;無列 = fallback 主價(現行為)
 * - bom_factory.price_region:廠 → 區映射;NULL = factory_code 自身(每廠自成一區);
 *   同價廠可指同區(如 TW 用 to-China 價 → price_region='CN')
 */
const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013ad');

module.exports = async function migrate013ad(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const hasCol = Number(val(await one(
    `SELECT COUNT(*) AS C FROM user_tab_columns WHERE table_name = 'BOM_FACTORY' AND column_name = 'PRICE_REGION'`,
  )));
  if (!hasCol) {
    try { await db.prepare(`ALTER TABLE bom_factory ADD price_region VARCHAR2(20)`).run(); log.log('added bom_factory.price_region'); }
    catch (e) { log.warn('add price_region:', e.message); }
  }
  const hasTable = Number(val(await one(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name = 'BOM_ITEM_PRICE_REGION'`)));
  if (!hasTable) {
    try {
      await db.prepare(`
        CREATE TABLE bom_item_price_region (
          region_price_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          snapshot_id     NUMBER NOT NULL,
          region_code     VARCHAR2(20) NOT NULL,
          unit_price_usd  NUMBER(15,6),
          true_cost_usd   NUMBER(15,6),
          created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
          updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
          CONSTRAINT uq_ipr UNIQUE (snapshot_id, region_code),
          CONSTRAINT fk_ipr_snap FOREIGN KEY (snapshot_id) REFERENCES bom_item_price_snapshot(id) ON DELETE CASCADE
        )`).run();
      log.log('created bom_item_price_region');
    } catch (e) { log.warn('create bom_item_price_region:', e.message); }
  }
  log.log('migration 013ad ✓');
};
