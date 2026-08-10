/**
 * Migration 013aa — SIMPLIFIED loss 線 % 化(calc_mode / yield_pct / yield_basis_json)
 * WHOOP 真表公式(user 提供):SMT Yield loss = I6(Bird Main)×0.5%、
 * FATP Yield Loss = SUM(勾選欄位)×5% — yield loss = 勾選成本線集合 × %。
 * 勾選集合每專案不同 → 可勾選不寫死;per-config 差異由 line×config 倍率(013z)自動處理。
 * calc_mode:AMOUNT(預設 · 直接填金額)| YIELD_PCT(= Σ(勾選線生效額)× yield_pct)。
 * yield_basis_json:JSON array of line_code / BOM 虛擬項(BOM_MATERIAL_ALL/EE/ME/PKG)。
 */
const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013aa');

module.exports = async function migrate013aa(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const val = (r) => (r ? Object.values(r)[0] : undefined);
  const hasCol = async (col) => Number(val(await one(
    `SELECT COUNT(*) AS C FROM user_tab_columns WHERE table_name = 'BOM_CS_CASE_SIMPLIFIED_LINE' AND column_name = ?`, col,
  )));
  const addCol = async (ddl, name) => {
    try { await db.prepare(ddl).run(); log.log(`added ${name}`); }
    catch (e) { log.warn(`add ${name}:`, e.message); }
  };
  if (!(await hasCol('CALC_MODE'))) await addCol(`ALTER TABLE bom_cs_case_simplified_line ADD calc_mode VARCHAR2(20) DEFAULT 'AMOUNT'`, 'calc_mode');
  if (!(await hasCol('YIELD_PCT'))) await addCol(`ALTER TABLE bom_cs_case_simplified_line ADD yield_pct NUMBER(10,6)`, 'yield_pct');
  if (!(await hasCol('YIELD_BASIS_JSON'))) await addCol(`ALTER TABLE bom_cs_case_simplified_line ADD yield_basis_json CLOB`, 'yield_basis_json');
  log.log('migration 013aa ✓');
};
