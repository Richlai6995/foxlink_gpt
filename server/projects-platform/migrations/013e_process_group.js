/**
 * Migration 013e — bom_process_catalog 加 process_group + 對齊真 Cleansheet 製程
 *
 * 對應 docs/cortex-s1-cost-engine-plan.md §6.5(真 Excel 公式:DL 分 SMT/BB 兩組)
 *
 * 真 Excel(Rival3 Cleansheet)DL 公式分兩組:
 *   - SMT 組(SMT_MAIN/WAVE_SOLDER/ROUTER_OFFLINE/LASER_ETCH):r56 含 mult1、r55 IDL 不含 Sup
 *   - BB 組(BB_ASSY/BB_TEST/MAT_MGMT/Q_SMT/Q_BB):r56 無 mult1、r55 IDL 含 Sup
 *   - FATP(WHOOP SIMPLIFIED 放大製程)另分組
 * → 引擎 computeFullMva 依 process_group 分流公式,故 catalog 必須帶此欄。
 *
 * 加性:ALTER bom_process_catalog ADD process_group(idempotent)+ upsert 真製程分組。
 * gate 在 ENABLE_CORTEX_BOM(隨 013a-d)。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013e');

module.exports = async function migrate013e(db) {
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);

  // ALTER ADD process_group(idempotent)
  try {
    const c = await get(`SELECT COUNT(*) AS C FROM user_tab_columns WHERE table_name='BOM_PROCESS_CATALOG' AND column_name='PROCESS_GROUP'`);
    if (!Number(val(c))) {
      await run(`ALTER TABLE bom_process_catalog ADD (process_group VARCHAR2(20))`);
      log.log('added bom_process_catalog.process_group');
    }
  } catch (e) { log.warn('addColumn process_group:', e.message); }

  // 真 Cleansheet(Rival3)9 製程 + WHOOP FATP · process_group:SMT | BB | FATP
  const PROCS = [
    ['SMT_MAIN',       'SMT',  'PCBA',      'SMT 主板貼裝', 'SMT', 10],
    ['WAVE_SOLDER',    'SMT',  'PCBA',      '波焊/DIP',     'Wave Solder', 20],
    ['ROUTER_OFFLINE', 'SMT',  'PCBA',      'Router 分板',  'Router (offline)', 30],
    ['LASER_ETCH',     'SMT',  'PCBA',      '雷射雕刻',     'Laser Etching', 40],
    ['BB_ASSY',        'BB',   'ASSEMBLY',  '板對板組裝',   'BB Assy', 50],
    ['BB_TEST',        'BB',   'TESTING',   '板對板測試',   'BB Testing', 60],
    ['MAT_MGMT',       'BB',   'LOGISTICS', '物料管理',     'Material Management', 70],
    ['Q_SMT',          'BB',   'QUALITY',   '品保(SMT)',    'Quality (SMT)', 80],
    ['Q_BB',           'BB',   'QUALITY',   '品保(BB)',     'Quality (BB)', 90],
    ['FATP',           'FATP', 'ASSEMBLY',  'FATP 總組',    'Final Assembly & Test', 100], // WHOOP SIMPLIFIED
  ];
  for (const [code, group, cat, zh, en, sort] of PROCS) {
    try {
      const ex = await get(`SELECT process_code FROM bom_process_catalog WHERE process_code = ?`, code);
      if (ex) {
        await run(`UPDATE bom_process_catalog SET process_group = ?, category = ?, display_name_zh_tw = ?, display_name_en = ?, sort_order = ? WHERE process_code = ?`,
          group, cat, zh, en, sort, code);
      } else {
        await run(`INSERT INTO bom_process_catalog (process_code, category, display_name_zh_tw, display_name_en, sort_order, process_group) VALUES (?,?,?,?,?,?)`,
          code, cat, zh, en, sort, group);
      }
    } catch (e) { log.warn(`upsert process ${code}:`, e.message); }
  }

  log.log('migration 013e ✓');
};
