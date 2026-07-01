/**
 * Migration 013f — 案級設備(area/bucket)+ 廠房(sqft/util)兩張新表
 *
 * 對應 docs/cortex-s1-cost-engine-plan.md §6.5.3(真 Rival3 Cleansheet 逆向:設備/廠房)
 *
 * 為何加新表而非 ALTER S0 的 equip_category:
 *   S0 的 bom_cs_case_equip_category 是照 DEMO「category-price + mroPct」模型建的,
 *   但真 Excel(Equipment List sheet)其實是:
 *     - 設備 = 一組設備行,每行 (extended_cost, useful_life),per_unit = Σ(ext/life/年量)
 *     - MRO 只是「另一組短壽命設備行」(bucket 標籤),算法與 Depr 完全相同,無 mroPct
 *     - 稼動率 util(C20/C24)**選擇性套用**:SMT area 套、BB/Q area 不套(手工表商業規則:
 *       SMT 共用產線按稼動分攤 / BB 專線全額)→ 必須當「資料 flag」存,不能寫死程式
 *   廠房則 S0 根本沒 case 表(引擎用寫死的 SQFT_ALLOC const)。
 *   → 純加性新表最低風險(不動已 ship 的 gated 表)。舊 equip_category/price/dep_years 休眠,日後細項模型再用。
 *
 * gate 在 ENABLE_CORTEX_BOM(隨 013a-e,index.js 內)。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013f');

module.exports = async function migrate013f(db) {
  const createTable = async (name, ddl) => {
    try {
      const r = await db.prepare(`SELECT COUNT(*) AS C FROM user_tables WHERE table_name = UPPER(?)`).get(name);
      if (r && Number(Object.values(r)[0]) > 0) return false;
      await db.prepare(ddl).run();
      log.log(`created table ${name}`);
      return true;
    } catch (e) { log.warn(`createTable ${name}:`, e.message); return false; }
  };
  const _idx = async (sql, name) => {
    try { await db.prepare(sql).run(); log.log(`index ${name}`); }
    catch (e) { if (!/already used|already exists|ORA-00955|ORA-01408/.test(e.message)) log.warn(`index ${name}:`, e.message); }
  };

  // ========================================================================
  // bom_cs_case_equip_area — 案級設備(依 area/bucket 彙總 · 對齊 Excel r90/r91)
  //   per_unit = (annual_cost_usd / annual_demand) × (apply_util ? util(C20/C24) : 1)
  //   bucket: 'MRO'(Equipment Maint Spares)| 'EQUIP'(Depreciation)
  //   annual_cost_usd = Σ(該 area+bucket 設備行 extended_cost / useful_life)(年化重置成本)
  //   process_code = 該 area 的代表製程(SMT area→SMT_MAIN · 其餘製程掛 0)
  // ========================================================================
  await createTable('BOM_CS_CASE_EQUIP_AREA', `
    CREATE TABLE bom_cs_case_equip_area (
      case_factory_id  NUMBER NOT NULL,
      process_code     VARCHAR2(40) NOT NULL,
      bucket           VARCHAR2(10) NOT NULL,          -- MRO | EQUIP
      annual_cost_usd  NUMBER(18,4),                   -- Σ(ext_cost/useful_life) 年化
      apply_util       NUMBER(1) DEFAULT 1,            -- 1=套 C20/C24 稼動率(SMT area) 0=全額(BB/Q area)
      note             VARCHAR2(200),
      CONSTRAINT pk_cseqarea PRIMARY KEY (case_factory_id, process_code, bucket),
      CONSTRAINT fk_cseqarea_cf FOREIGN KEY (case_factory_id) REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE,
      CONSTRAINT fk_cseqarea_proc FOREIGN KEY (process_code) REFERENCES bom_process_catalog(process_code)
    )`);
  await _idx(`CREATE INDEX idx_cseqarea_cf ON bom_cs_case_equip_area(case_factory_id)`, 'idx_cseqarea_cf');

  // ========================================================================
  // bom_cs_case_facility — 案級廠房佔地(對齊 Excel r100)
  //   per_unit = (sqft × sqft_unit_cost / annual_demand) × (apply_util ? util : 1)
  //   sqft_unit_cost 缺省時引擎用 baseline / const(14.4276);此表可 per-案 override
  // ========================================================================
  await createTable('BOM_CS_CASE_FACILITY', `
    CREATE TABLE bom_cs_case_facility (
      case_factory_id      NUMBER NOT NULL,
      process_code         VARCHAR2(40) NOT NULL,
      sqft                 NUMBER(15,4),
      sqft_unit_cost_usd   NUMBER(12,4),               -- NULL → 引擎 fallback baseline/const
      apply_util           NUMBER(1) DEFAULT 1,        -- 1=套稼動率(SMT/BB Assy) 0=全額
      note                 VARCHAR2(200),
      CONSTRAINT pk_csfac PRIMARY KEY (case_factory_id, process_code),
      CONSTRAINT fk_csfac_cf FOREIGN KEY (case_factory_id) REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE,
      CONSTRAINT fk_csfac_proc FOREIGN KEY (process_code) REFERENCES bom_process_catalog(process_code)
    )`);
  await _idx(`CREATE INDEX idx_csfac_cf ON bom_cs_case_facility(case_factory_id)`, 'idx_csfac_cf');

  log.log('migration 013f ✓');
};
