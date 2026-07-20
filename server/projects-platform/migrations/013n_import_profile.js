/**
 * Migration 013n — BOM 匯入設定檔(bom_import_profile · 統一格式 · dark-launch)
 *
 * 對應 docs/cortex-bom-import-plan.md(統一 canonical 格式 + mapping profile 設定)。
 * 廢掉 per-專案 format enum(template/rival3/multiboard)→ 系統只認 canonical,
 * 各專案 raw Excel 用 profile 的 mapping 設定轉成 canonical 再匯入。
 *
 * source_kind:
 *   CANONICAL — 檔案已是 canonical 格式(半成品/模組欄 · header-based,config 可空)
 *   MAPPED    — raw 專案 Excel,config_json 定義各 sheet → canonical 的欄位對映
 *
 * config_json(MAPPED):{ sheets:[{ match, subAssembly, module, startRow, cols:{itemNo,fpn,desc,qty,unitPrice,vendor,mfgPn,remark} }] }
 * gate 在 ENABLE_CORTEX_BOM。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013n');

module.exports = async function migrate013n(db) {
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);

  const ex = await one(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name='BOM_IMPORT_PROFILE'`);
  if (!Number(val(ex))) {
    try {
      await run(`
        CREATE TABLE bom_import_profile (
          id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          profile_code  VARCHAR2(60) NOT NULL UNIQUE,   -- 'CANONICAL' | 'WHOOP-GEN4' | 'RIVAL3-GEN2' | ...
          name          VARCHAR2(120),
          description    VARCHAR2(500),
          source_kind   VARCHAR2(20) DEFAULT 'MAPPED',  -- CANONICAL | MAPPED
          config_json   CLOB,                            -- MAPPED 的 sheet→canonical 欄位對映
          is_active     NUMBER(1) DEFAULT 1,
          is_builtin    NUMBER(1) DEFAULT 0,             -- 內建(seed)· 不給刪
          created_by    NUMBER,
          created_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
          updated_at    TIMESTAMP DEFAULT SYSTIMESTAMP
        )`);
      log.log('created bom_import_profile');
    } catch (e) { log.warn('create bom_import_profile:', e.message); }
  }

  try { await require('../services/bomImportProfileService').seedBuiltin(db); log.log('seeded builtin profiles (CANONICAL/WHOOP-GEN4/RIVAL3-GEN2)'); }
  catch (e) { log.warn('seedBuiltin:', e.message); }

  log.log('migration 013n ✓');
};
