/**
 * Migration 013j — bom_item_price_snapshot 加 bom_item_mfg_id + is_chosen(B-5b per-vendor 報價)
 *
 * 對應 docs/cortex-bom-import-plan.md §10(B-5b 採購手動 enrich · per-vendor 各自報價)。
 *
 * per-vendor 模型:一個料件可有多筆 snapshot(每 vendor 一筆),採購比價選一筆 chosen。
 *   - bom_item_mfg_id:此 snapshot 屬哪個 vendor(bom_item_mfg.id · app 層維護不建硬 FK)
 *   - is_chosen:此料件選定的 vendor snapshot(rollup 只取 is_chosen=1 的 applied_price)
 *   不變式:每 item 恰一筆 is_chosen=1(pending 時 = placeholder snapshot,applied=NULL)
 *
 * 一次性 backfill:B-5a 現況每 item 恰 1 snapshot → 全設 is_chosen=1(維持 rollup 相容)。
 * 只在欄位「首次新增」時 backfill,避免每次重啟覆寫採購的選擇。
 *
 * 加性 ALTER(idempotent)· gate 在 ENABLE_CORTEX_BOM(index.js 內)。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013j');

module.exports = async function migrate013j(db) {
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const hasCol = async (col) =>
    Number(val(await get(`SELECT COUNT(*) AS C FROM user_tab_columns WHERE table_name='BOM_ITEM_PRICE_SNAPSHOT' AND column_name=?`, col)));

  // 1. bom_item_mfg_id — snapshot 掛哪個 vendor
  try {
    if (!(await hasCol('BOM_ITEM_MFG_ID'))) {
      await run(`ALTER TABLE bom_item_price_snapshot ADD (bom_item_mfg_id NUMBER)`);
      log.log('added bom_item_price_snapshot.bom_item_mfg_id');
    }
  } catch (e) { log.warn('addColumn bom_item_mfg_id:', e.message); }

  // 2. is_chosen — 此料件選定的 vendor snapshot(rollup 讀這個)+ 一次性 backfill
  try {
    if (!(await hasCol('IS_CHOSEN'))) {
      await run(`ALTER TABLE bom_item_price_snapshot ADD (is_chosen NUMBER(1) DEFAULT 0)`);
      // B-5a 現況每 item 1 snapshot → 全設 chosen(含 PENDING placeholder · applied 仍 NULL = 待詢價)
      await run(`UPDATE bom_item_price_snapshot SET is_chosen=1 WHERE is_chosen=0 OR is_chosen IS NULL`);
      log.log('added bom_item_price_snapshot.is_chosen + backfilled existing → chosen=1');
    }
  } catch (e) { log.warn('addColumn is_chosen:', e.message); }

  // 3. index — 取 chosen 用
  try { await run(`CREATE INDEX idx_psnap_chosen ON bom_item_price_snapshot(bom_item_id, is_chosen)`); }
  catch (e) { if (!/ORA-00955|already/i.test(e.message)) log.warn('idx_psnap_chosen:', e.message); }

  log.log('migration 013j ✓');
};
