/**
 * Migration 013t — 議價紀錄(P1 · bom_negotiation_round · dark-launch)
 * 定版(官方報價)後的客戶議價輪次:目標價 vs 我方回應 vs 底線(true · S2 遮罩)。
 * 讓價成立 → 走既有流程改價重算 + 送審新版本;ACCEPTED 輪 = 成交價。
 */
const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013t');

module.exports = async function migrate013t(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const ex = Number(val(await one(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name='BOM_NEGOTIATION_ROUND'`)));
  if (!ex) {
    try {
      await db.prepare(`
        CREATE TABLE bom_negotiation_round (
          id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          project_id          NUMBER NOT NULL,
          quote_version_id    NUMBER,                          -- 針對哪個報價版本(通常當時 official)
          round_no            NUMBER NOT NULL,
          customer_target_usd NUMBER(15,6),                    -- 客戶目標價 / 台
          our_offer_usd       NUMBER(15,6),                    -- 我方本輪回應價 / 台
          outcome             VARCHAR2(20) DEFAULT 'OPEN',     -- OPEN | COUNTER | ACCEPTED | REJECTED
          note                VARCHAR2(1000),                  -- 條件備註(量增/付款/NRE 分期…)
          created_by          NUMBER,
          created_at          TIMESTAMP DEFAULT SYSTIMESTAMP,
          CONSTRAINT fk_negot_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )`).run();
      log.log('created bom_negotiation_round');
    } catch (e) { log.warn('create bom_negotiation_round:', e.message); }
  }
  log.log('migration 013t ✓');
};
