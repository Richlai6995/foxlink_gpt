/**
 * Migration 013a — BOM superset · Layer 1/2 master(公司/廠級共用 · 不接 projects)
 *
 * 對應 docs/cortex-unified-architecture-sd.md + bom-collection-sd + cleansheet-mva-sd
 *        + workflow bom-superset-schema-reconcile(權威 DDL 收斂)
 *        + cortex-dev-rollout-plan.md S0-BOM
 *
 * 全加性新建 · 無 FK 指向 Cortex 主站表 · unified §3 統一參數直接併入欄位(不 ALTER)
 * 計算引擎(S1/S4)讀此層決定 costing_model / per-component mask / base_ref / 廠級 baseline。
 *
 * 13a 內容(15 表 + 集中 seed):
 *   master:bom_factory / bom_process_catalog / bom_cs_component / bom_equip_category_catalog
 *   廠級 baseline(SCD2):bom_factory_baseline + 子表 idl_role / idl_linedep_wage / dep_years
 *                       / equip_category_price / consumable / smt_point_rule
 *   模板:bom_process_template(+step) · 字典:bom_category_dict / bom_category_markup_default
 *   seed:CN/VN/TW 三廠 · 9 製程 · 20 component(含 model_applicability+fallback)· 3 模板 · 字典/markup
 *
 * 後續:013b(BOM 結構鏈 FK projects)· 013c(cleansheet 案級 FK case_factory)· 013d(factory_matrix+audit)
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013a');

module.exports = async function migrate013a(db) {
  // --- helpers(case-agnostic 存在檢查 · 重跑乾淨不噴 ORA-00955)---
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
  const seedOne = async (checkSql, checkArgs, insSql, insArgs, label) => {
    try {
      const ex = await db.prepare(checkSql).get(...checkArgs);
      if (ex) return false;
      await db.prepare(insSql).run(...insArgs);
      return true;
    } catch (e) { log.warn(`seed ${label}:`, e.message); return false; }
  };

  // ========================================================================
  // Layer 2 — 廠 master
  // ========================================================================
  await createTable('BOM_FACTORY', `
    CREATE TABLE bom_factory (
      factory_code      VARCHAR2(20) PRIMARY KEY,
      factory_name      VARCHAR2(120),
      country_iso       VARCHAR2(3),
      currency_default  VARCHAR2(8),
      erp_org_id        NUMBER,
      is_active         NUMBER(1) DEFAULT 1,
      created_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at        TIMESTAMP DEFAULT SYSTIMESTAMP
    )`);

  // ========================================================================
  // Layer 1 — 製程目錄
  // ========================================================================
  await createTable('BOM_PROCESS_CATALOG', `
    CREATE TABLE bom_process_catalog (
      process_code        VARCHAR2(40) PRIMARY KEY,
      category            VARCHAR2(30),
      display_name_zh_tw  VARCHAR2(120),
      display_name_en     VARCHAR2(120),
      sort_order          NUMBER DEFAULT 100,
      is_active           NUMBER(1) DEFAULT 1
    )`);

  // ========================================================================
  // Layer 4 — 20 component master(unified §3 mask 直接併入)
  // ========================================================================
  await createTable('BOM_CS_COMPONENT', `
    CREATE TABLE bom_cs_component (
      component_code      VARCHAR2(40) PRIMARY KEY,
      category            VARCHAR2(30),
      display_name_zh_tw  VARCHAR2(120),
      display_name_en     VARCHAR2(120),
      is_common_only      NUMBER(1) DEFAULT 0,
      model_applicability VARCHAR2(40),   -- FULL_MVA | SIMPLIFIED_WEARABLE | BOTH
      fallback_into_code  VARCHAR2(40),   -- disable 時併入哪個 component(NULL=純 disable)
      sort_order          NUMBER DEFAULT 100,
      is_active           NUMBER(1) DEFAULT 1
    )`);

  // ========================================================================
  // 設備類別 catalog(unified §8.2 #1 · 類別制取代個別機)
  // ========================================================================
  await createTable('BOM_EQUIP_CATEGORY_CATALOG', `
    CREATE TABLE bom_equip_category_catalog (
      category_code        VARCHAR2(40) PRIMARY KEY,
      name_zh_tw           VARCHAR2(120),
      name_en              VARCHAR2(120),
      equip_group          VARCHAR2(40),
      bg_code              VARCHAR2(40),
      rep_cost_usd         NUMBER(15,4),
      useful_life_yrs      NUMBER(4,1),
      mro_pct              NUMBER(6,4),
      wearable_only        NUMBER(1) DEFAULT 0,
      default_process_code VARCHAR2(40),
      is_active            NUMBER(1) DEFAULT 1,
      created_at           TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT fk_eqcat_proc FOREIGN KEY (default_process_code) REFERENCES bom_process_catalog(process_code)
    )`);
  await _idx(`CREATE INDEX idx_eqcat_bg ON bom_equip_category_catalog(bg_code, wearable_only)`, 'idx_eqcat_bg');

  // ========================================================================
  // Layer 2 — 廠級資產基線(SCD2)+ unified §3 參數化引擎核心
  // ========================================================================
  await createTable('BOM_FACTORY_BASELINE', `
    CREATE TABLE bom_factory_baseline (
      baseline_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      factory_code         VARCHAR2(20) NOT NULL,
      version_label        VARCHAR2(40),
      status               VARCHAR2(20) DEFAULT 'draft',   -- draft|active|superseded|retired
      effective_from       DATE,
      effective_to         DATE,
      bg_code              VARCHAR2(40),
      bu_code              VARCHAR2(40),
      dl_wage_per_hr_usd   NUMBER(12,6),
      floor_sqft_prod      NUMBER(15,4),
      floor_sqft_warehouse NUMBER(15,4),
      floor_sqft_boxbuild  NUMBER(15,4),
      loss_factor_pct      NUMBER(8,4),
      loss_factor_per_process CLOB,
      sga_pct              NUMBER(8,4),
      profit_pct           NUMBER(8,4),
      sga_base_ref         VARCHAR2(30),
      profit_base_ref      VARCHAR2(30),
      costing_model        VARCHAR2(30) DEFAULT 'FULL_MVA',
      oh_pct               NUMBER(6,4),
      outbound_transportation_per_unit_usd NUMBER(12,4),
      smt_point_unit_price NUMBER(12,4),
      smt_allowance_pct    NUMBER(6,4),
      smt_point_formula    CLOB,
      motherboard_cost_ref NUMBER(15,6),
      inbound_freight_annual NUMBER(18,4),
      vat_rate_pct         NUMBER(8,4),
      annual_demand_default NUMBER,
      raw_inputs_json      CLOB,
      imported_by          NUMBER,
      approved_by          NUMBER,
      created_at           TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at           TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT fk_fbl_factory FOREIGN KEY (factory_code) REFERENCES bom_factory(factory_code)
    )`);
  await _idx(`CREATE INDEX idx_fbl_factory_status ON bom_factory_baseline(factory_code, status)`, 'idx_fbl_factory_status');
  await _idx(`CREATE INDEX idx_fbl_bg ON bom_factory_baseline(bg_code, bu_code)`, 'idx_fbl_bg');

  // ---- baseline 子表(per baseline · CASCADE)----
  await createTable('BOM_FACTORY_IDL_ROLE', `
    CREATE TABLE bom_factory_idl_role (
      baseline_id        NUMBER NOT NULL,
      role_code          VARCHAR2(40) NOT NULL,
      category           VARCHAR2(30),
      annual_rate_usd    NUMBER(15,4),
      weekly_rate_usd    NUMBER(15,4),
      display_name_zh_tw VARCHAR2(120),
      CONSTRAINT pk_fidlrole PRIMARY KEY (baseline_id, role_code),
      CONSTRAINT fk_fidlrole_bl FOREIGN KEY (baseline_id) REFERENCES bom_factory_baseline(baseline_id) ON DELETE CASCADE
    )`);

  await createTable('BOM_FACTORY_IDL_LINEDEP_WAGE', `
    CREATE TABLE bom_factory_idl_linedep_wage (
      baseline_id     NUMBER NOT NULL,
      role_code       VARCHAR2(40) NOT NULL,
      weekly_wage_usd NUMBER(15,4),
      copied_from     VARCHAR2(80),
      created_by      NUMBER,
      CONSTRAINT pk_fidldep PRIMARY KEY (baseline_id, role_code),
      CONSTRAINT fk_fidldep_bl FOREIGN KEY (baseline_id) REFERENCES bom_factory_baseline(baseline_id) ON DELETE CASCADE
    )`);

  await createTable('BOM_FACTORY_DEP_YEARS', `
    CREATE TABLE bom_factory_dep_years (
      baseline_id NUMBER NOT NULL,
      category    VARCHAR2(40) NOT NULL,
      years       NUMBER(4,1),
      CONSTRAINT pk_fdepyr PRIMARY KEY (baseline_id, category),
      CONSTRAINT fk_fdepyr_bl FOREIGN KEY (baseline_id) REFERENCES bom_factory_baseline(baseline_id) ON DELETE CASCADE
    )`);

  await createTable('BOM_FACTORY_EQUIP_CATEGORY_PRICE', `
    CREATE TABLE bom_factory_equip_category_price (
      baseline_id          NUMBER NOT NULL,
      category_code        VARCHAR2(40) NOT NULL,
      factory_code         VARCHAR2(20),
      acquisition_cost_usd NUMBER(15,4),
      useful_life_yrs      NUMBER(4,1),
      mro_pct_override     NUMBER(6,4),
      CONSTRAINT pk_feqprice PRIMARY KEY (baseline_id, category_code),
      CONSTRAINT fk_feqprice_bl FOREIGN KEY (baseline_id) REFERENCES bom_factory_baseline(baseline_id) ON DELETE CASCADE,
      CONSTRAINT fk_feqprice_cat FOREIGN KEY (category_code) REFERENCES bom_equip_category_catalog(category_code)
    )`);

  await createTable('BOM_FACTORY_CONSUMABLE', `
    CREATE TABLE bom_factory_consumable (
      consumable_id         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      factory_code          VARCHAR2(20) NOT NULL,
      consumable_code       VARCHAR2(60),
      description           VARCHAR2(400),
      foxlink_part_no       VARCHAR2(80),
      unit_cost_usd         NUMBER(15,6),
      unit_of_measure       VARCHAR2(12),
      annual_usage_default  NUMBER(18,4),
      default_process_code  VARCHAR2(40),
      introduced_baseline_id NUMBER,
      retired_baseline_id   NUMBER,
      is_active             NUMBER(1) DEFAULT 1,
      CONSTRAINT fk_consum_factory FOREIGN KEY (factory_code) REFERENCES bom_factory(factory_code),
      CONSTRAINT fk_consum_proc FOREIGN KEY (default_process_code) REFERENCES bom_process_catalog(process_code)
    )`);
  await _idx(`CREATE INDEX idx_consum_factory ON bom_factory_consumable(factory_code, is_active)`, 'idx_consum_factory');

  await createTable('BOM_FACTORY_SMT_POINT_RULE', `
    CREATE TABLE bom_factory_smt_point_rule (
      baseline_id    NUMBER NOT NULL,
      category_code  VARCHAR2(20) NOT NULL,
      point_formula  VARCHAR2(80),
      unit_price_usd NUMBER(12,4),
      CONSTRAINT pk_fsmtrule PRIMARY KEY (baseline_id, category_code),
      CONSTRAINT fk_fsmtrule_bl FOREIGN KEY (baseline_id) REFERENCES bom_factory_baseline(baseline_id) ON DELETE CASCADE
    )`);

  // ========================================================================
  // Layer 1 — 產品類型模板(costing_model 預設綁此)
  // ========================================================================
  await createTable('BOM_PROCESS_TEMPLATE', `
    CREATE TABLE bom_process_template (
      template_id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      code                  VARCHAR2(40) UNIQUE NOT NULL,
      product_category      VARCHAR2(60),
      name_zh_tw            VARCHAR2(120),
      name_en               VARCHAR2(120),
      default_costing_model VARCHAR2(30) DEFAULT 'FULL_MVA',
      is_official           NUMBER(1) DEFAULT 1,
      created_by            NUMBER,
      created_at            TIMESTAMP DEFAULT SYSTIMESTAMP
    )`);

  await createTable('BOM_PROCESS_TEMPLATE_STEP', `
    CREATE TABLE bom_process_template_step (
      template_id  NUMBER NOT NULL,
      step_order   NUMBER NOT NULL,
      process_code VARCHAR2(40) NOT NULL,
      CONSTRAINT pk_tplstep PRIMARY KEY (template_id, step_order),
      CONSTRAINT fk_tplstep_tpl FOREIGN KEY (template_id) REFERENCES bom_process_template(template_id) ON DELETE CASCADE,
      CONSTRAINT fk_tplstep_proc FOREIGN KEY (process_code) REFERENCES bom_process_catalog(process_code)
    )`);

  // ========================================================================
  // 字典(bom-collection)
  // ========================================================================
  await createTable('BOM_CATEGORY_DICT', `
    CREATE TABLE bom_category_dict (
      id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name            VARCHAR2(80) UNIQUE NOT NULL,
      default_process VARCHAR2(20),
      display_order   NUMBER DEFAULT 100,
      is_active       NUMBER(1) DEFAULT 1
    )`);

  await createTable('BOM_CATEGORY_MARKUP_DEFAULT', `
    CREATE TABLE bom_category_markup_default (
      category_code      VARCHAR2(40) PRIMARY KEY,
      display_name_zh    VARCHAR2(120),
      default_markup_pct NUMBER(8,4),
      applies_from       DATE,
      applies_to         DATE
    )`);

  // ========================================================================
  // SEED(集中此檔 · idempotent)
  // ========================================================================
  await _seedMasters(db, seedOne);

  log.log('migration 013a ✓');
};

async function _seedMasters(db, seedOne) {
  // --- 3 廠(erp_org_id CN=83 / VN=2463 / TW=1101)---
  const FACTORIES = [
    ['CN', '正崴-中國廠', 'CHN', 'RMB', 83],
    ['VN', '正崴-越南廠', 'VNM', 'VND', 2463],
    ['TW', '正崴-台灣廠', 'TWN', 'TWD', 1101],
  ];
  for (const [code, name, iso, cur, org] of FACTORIES) {
    await seedOne(
      `SELECT factory_code FROM bom_factory WHERE factory_code = ?`, [code],
      `INSERT INTO bom_factory (factory_code, factory_name, country_iso, currency_default, erp_org_id) VALUES (?,?,?,?,?)`,
      [code, name, iso, cur, org], `factory ${code}`);
  }

  // --- 9 製程(cleansheet §A 結構;sort 對齊製程順序)---
  const PROCESSES = [
    ['SMT_MAIN',     'PCBA',      'SMT 主板貼裝', 'SMT Main', 10],
    ['WAVE_SOLDER',  'PCBA',      '波焊/DIP',     'Wave/DIP', 20],
    ['BB_ASSY',      'ASSEMBLY',  '板對板組裝',   'Board-to-Board Assy', 30],
    ['ROUTER_OFFLINE','ASSEMBLY', 'Router 分板',  'Router Offline', 40],
    ['FATP',         'ASSEMBLY',  '組裝/FATP',    'Final Assembly & Test', 50],
    ['FUNCTIONAL_TEST','TESTING', '功能測試',     'Functional Test', 60],
    ['PACKAGING',    'LOGISTICS', '包裝',         'Packaging', 70],
    ['IQC',          'QUALITY',   '進料檢驗',     'Incoming QC', 80],
    ['WAREHOUSE',    'LOGISTICS', '倉儲',         'Warehouse', 90],
  ];
  for (const [code, cat, zh, en, sort] of PROCESSES) {
    await seedOne(
      `SELECT process_code FROM bom_process_catalog WHERE process_code = ?`, [code],
      `INSERT INTO bom_process_catalog (process_code, category, display_name_zh_tw, display_name_en, sort_order) VALUES (?,?,?,?,?)`,
      [code, cat, zh, en, sort], `process ${code}`);
  }

  // --- 20 component(unified §3 mask · model_applicability + fallback_into)---
  const COMPONENTS = [
    ['MATERIAL',       'MATERIAL',  '物料成本',        'Material', 'BOTH', null, 10],
    ['PKG_COST',       'MATERIAL',  '包裝成本',        'Packaging', 'BOTH', null, 20],
    ['DL_CPU',         'LABOR',     '直接人工',        'Direct Labor', 'FULL_MVA', 'PROC_MACRO', 30],
    ['IDL_CPU',        'LABOR',     '間接人工',        'Indirect Labor', 'FULL_MVA', 'OVERHEAD_4PCT', 40],
    ['EQUIP_MRO',      'EQUIPMENT', '設備維護',        'Equip MRO', 'FULL_MVA', 'OVERHEAD_4PCT', 50],
    ['EQUIP_DEPR',     'EQUIPMENT', '設備折舊',        'Equip Depreciation', 'FULL_MVA', 'OVERHEAD_4PCT', 60],
    ['IND_MAT',        'MATERIAL',  '間接材料',        'Indirect Material', 'FULL_MVA', 'OVERHEAD_4PCT', 70],
    ['FACILITY',       'FACILITY',  '廠房設施',        'Facility', 'FULL_MVA', 'OVERHEAD_4PCT', 80],
    ['FREIGHT',        'OTHERS',    '運費(進)',       'Inbound Freight', 'FULL_MVA', null, 90],
    ['VAT',            'OTHERS',    '增值稅',          'VAT', 'FULL_MVA', null, 100],
    ['LOSS',           'OTHERS',    '耗損',            'Loss', 'FULL_MVA', null, 110],
    ['MVA_TOTAL',      'AGGREGATE', 'MVA 小計',        'MVA Total', 'FULL_MVA', null, 120],
    ['PROC_MACRO',     'LABOR',     '放大製程工時',    'Macro Process', 'SIMPLIFIED_WEARABLE', null, 130],
    ['SMT_POINTS',     'LABOR',     'SMT 點數計價',    'SMT Points', 'SIMPLIFIED_WEARABLE', null, 140],
    ['MAT_LOSS_RATE',  'MATERIAL',  '材料耗損率',      'Material Loss Rate', 'SIMPLIFIED_WEARABLE', null, 150],
    ['OVERHEAD_4PCT',  'AGGREGATE', '間接費 4%',       'Overhead 4%', 'SIMPLIFIED_WEARABLE', null, 160],
    ['TRANSPORTATION', 'OTHERS',    '運輸費',          'Transportation', 'SIMPLIFIED_WEARABLE', null, 170],
    ['SGA',            'AGGREGATE', 'SG&A',            'SG&A', 'BOTH', null, 180],
    ['PROFIT',         'AGGREGATE', '利潤',            'Profit', 'BOTH', null, 190],
    ['TOTAL_TC',       'AGGREGATE', '總成本/報價',     'Total Cost', 'BOTH', null, 200],
  ];
  const COMMON_ONLY = new Set(['FREIGHT', 'VAT', 'LOSS', 'TRANSPORTATION']);
  for (const [code, cat, zh, en, model, fb, sort] of COMPONENTS) {
    await seedOne(
      `SELECT component_code FROM bom_cs_component WHERE component_code = ?`, [code],
      `INSERT INTO bom_cs_component (component_code, category, display_name_zh_tw, display_name_en, is_common_only, model_applicability, fallback_into_code, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
      [code, cat, zh, en, COMMON_ONLY.has(code) ? 1 : 0, model, fb, sort], `component ${code}`);
  }

  // --- 3 模板 ---
  const TEMPLATES = [
    ['MOUSE_STD',    '滑鼠',   '滑鼠標準模板',   'Mouse Standard',    'FULL_MVA'],
    ['KEYBOARD_STD', '鍵盤',   '鍵盤標準模板',   'Keyboard Standard', 'FULL_MVA'],
    ['WEARABLE_STD', '穿戴',   '穿戴標準模板',   'Wearable Standard', 'SIMPLIFIED_WEARABLE'],
  ];
  for (const [code, pcat, zh, en, model] of TEMPLATES) {
    await seedOne(
      `SELECT template_id FROM bom_process_template WHERE code = ?`, [code],
      `INSERT INTO bom_process_template (code, product_category, name_zh_tw, name_en, default_costing_model) VALUES (?,?,?,?,?)`,
      [code, pcat, zh, en, model], `template ${code}`);
  }

  // --- BOM 零件類別字典 ---
  const CATS = [
    ['Capacitor', 'SMD', 10], ['Resistor', 'SMD', 20], ['IC Chip', 'SMD', 30],
    ['Connector', 'DIP', 40], ['PCB', 'ASSEMBLY', 50], ['Switch', 'DIP', 60],
    ['LED', 'SMD', 70], ['Cable', 'ASSEMBLY', 80],
  ];
  for (const [name, proc, ord] of CATS) {
    await seedOne(
      `SELECT id FROM bom_category_dict WHERE name = ?`, [name],
      `INSERT INTO bom_category_dict (name, default_process, display_order) VALUES (?,?,?)`,
      [name, proc, ord], `cat ${name}`);
  }

  // --- Category markup 預設 ---
  const MARKUPS = [
    ['IC', 'IC 晶片', 0.35], ['PCB', 'PCB 板', 0.30], ['PLASTIC', '塑膠件', 0.30],
    ['PKG_PAPER', '紙包裝', 0.50], ['METAL', '金屬件', 0.25], ['CONNECTOR', '連接器', 0.25],
  ];
  for (const [code, zh, pct] of MARKUPS) {
    await seedOne(
      `SELECT category_code FROM bom_category_markup_default WHERE category_code = ?`, [code],
      `INSERT INTO bom_category_markup_default (category_code, display_name_zh, default_markup_pct) VALUES (?,?,?)`,
      [code, zh, pct], `markup ${code}`);
  }

  log.log('013a seed ✓');
}
