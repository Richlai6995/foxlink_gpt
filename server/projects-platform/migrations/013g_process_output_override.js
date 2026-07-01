/**
 * Migration 013g — bom_cs_case_process 加 weekly_output_override
 *
 * 對應 docs/cortex-s1-cost-engine-plan.md §6.5.4(真 Rival3 Cleansheet r24 逆向)
 *
 * 為何需要:真 Excel r24(Weekly output based on installed lines)對「品檢/支援製程」不用自己 takt 產能,
 *   而是**參照所在產線的速率**:
 *     J24(Quality-SMT) = '=I24'(承 Material Mgmt 的 21168)
 *     K24(Quality-BB)  = '=J24'
 *   Quality-SMT takt 8.64(自身 r21=46550)但實際受 BB 線 gating → 有效產能 21168。
 *   → 引擎 procDerive 預設用 max_output×lines,遇此類製程須讓「案級資料」覆寫 weekly_output。
 *
 * 加性 ALTER(idempotent)· gate 在 ENABLE_CORTEX_BOM(index.js 內)。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013g');

module.exports = async function migrate013g(db) {
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);

  try {
    const c = await get(`SELECT COUNT(*) AS C FROM user_tab_columns WHERE table_name='BOM_CS_CASE_PROCESS' AND column_name='WEEKLY_OUTPUT_OVERRIDE'`);
    if (!Number(val(c))) {
      await run(`ALTER TABLE bom_cs_case_process ADD (weekly_output_override NUMBER(18,4))`);
      log.log('added bom_cs_case_process.weekly_output_override');
    }
  } catch (e) { log.warn('addColumn weekly_output_override:', e.message); }

  log.log('migration 013g ✓');
};
