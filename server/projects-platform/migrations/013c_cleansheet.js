/**
 * Migration 013c — BOM superset · 案級 cleansheet 計算鏈(FK case_factory_id)
 *
 * 對應 cleansheet-mva-sd + cortex-unified-architecture-sd §3/§4/§5
 *        + workflow bom-superset-schema-reconcile · rollout §3.6
 *
 * 14 表(建表序 = FK 依賴):
 *   bom_cs_case_factory(case_id→projects(id) 一案 N 廠根 · snapshot 鎖 baseline_id)
 *   → case_process(DL 4 cat + IDL 人力 + takt/yield)/ case_idl_alloc / case_equip_category
 *     / case_consumable / case_qty_scenario / case_pkg → case_pkg_item(雙價 VIRTUAL)
 *     / case_pkg_module_include / case_macro_process(WHOOP)/ case_smt_point(WHOOP)
 *   → bom_cs_run → bom_cs_run_cell / bom_cs_run_result(對外 fact · 雙價 + margin VIRTUAL)
 *
 * ⚠️ open #1:bom_cs_run_result 的 total_quote / margin VIRTUAL 採「quote 側 mva/sga/profit
 *    沿用 true 側 · margin 只在 material+pkg」(workflow 收斂預設)。S1 計算引擎須對
 *    Rival3 / WHOOP 兩支 Excel ε<0.01 驗;若需 quote 側獨立拆分 → ALTER 該 VIRTUAL 欄(便宜·無資料遷移)。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013c');

module.exports = async function migrate013c(db) {
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
  // bom_cs_case_factory — 案級廠配置(BOM/cleansheet 接 projects 的核心:case_id→projects)
  // ========================================================================
  await createTable('BOM_CS_CASE_FACTORY', `
    CREATE TABLE bom_cs_case_factory (
      case_factory_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      case_id                  NUMBER NOT NULL,
      factory_code             VARCHAR2(20) NOT NULL,
      baseline_id              NUMBER NOT NULL,
      variant_key              VARCHAR2(40),
      bg_code                  VARCHAR2(40),
      bu_code                  VARCHAR2(40),
      costing_model            VARCHAR2(30),
      status                   VARCHAR2(20) DEFAULT 'draft',   -- draft|under_review|locked|superseded
      baseline_locked_manually NUMBER(1) DEFAULT 0,
      locked_by                NUMBER,
      locked_at                TIMESTAMP,
      created_at               TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at               TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT fk_csf_case FOREIGN KEY (case_id) REFERENCES projects(id) ON DELETE CASCADE,
      CONSTRAINT fk_csf_factory FOREIGN KEY (factory_code) REFERENCES bom_factory(factory_code),
      CONSTRAINT fk_csf_baseline FOREIGN KEY (baseline_id) REFERENCES bom_factory_baseline(baseline_id)
    )`);
  await _idx(`CREATE UNIQUE INDEX uq_csf ON bom_cs_case_factory(case_id, factory_code, variant_key)`, 'uq_csf');
  await _idx(`CREATE INDEX idx_csf_case ON bom_cs_case_factory(case_id, status)`, 'idx_csf_case');

  // ========================================================================
  // bom_cs_case_process — 案級製程清單(DL 4 category + IDL 人力 · 對齊 Excel §A)
  // ========================================================================
  await createTable('BOM_CS_CASE_PROCESS', `
    CREATE TABLE bom_cs_case_process (
      case_factory_id         NUMBER NOT NULL,
      process_code            VARCHAR2(40) NOT NULL,
      step_order              NUMBER,
      working_hours_per_day   NUMBER(8,4),
      days_per_week           NUMBER(4,1),
      shifts_per_day          NUMBER(4,1),
      takt_seconds            NUMBER(12,4),
      takt_source             VARCHAR2(40),
      yield_pct               NUMBER(8,4),
      efficiency_pct          NUMBER(8,4),
      lines_installed         NUMBER(8,2),
      debug_lines_installed   NUMBER(8,2),
      dl_per_shift            NUMBER(8,2),          -- DL cat1
      debug_dl_per_shift      NUMBER(8,2),          -- DL cat2
      functional_dl_per_shift NUMBER(8,2),          -- DL cat3
      warehouse_dl_per_shift  NUMBER(8,2),          -- DL cat4
      line_leader_per_shift   NUMBER(8,2),
      line_leader_per_day     NUMBER(8,2),
      technician_per_shift    NUMBER(8,2),
      technician_per_day      NUMBER(8,2),
      iqc_per_day             NUMBER(8,2),
      supervisor_per_day      NUMBER(8,2),
      sea_hours_per_day       NUMBER(8,4),
      sea_hours_per_week      NUMBER(8,4),
      CONSTRAINT pk_csproc PRIMARY KEY (case_factory_id, process_code),
      CONSTRAINT fk_csproc_cf FOREIGN KEY (case_factory_id) REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE,
      CONSTRAINT fk_csproc_proc FOREIGN KEY (process_code) REFERENCES bom_process_catalog(process_code)
    )`);

  // ========================================================================
  // bom_cs_case_idl_alloc — IDL×製程 multiplier(role_code 不建 FK · app 驗證)
  // ========================================================================
  await createTable('BOM_CS_CASE_IDL_ALLOC', `
    CREATE TABLE bom_cs_case_idl_alloc (
      case_factory_id NUMBER NOT NULL,
      process_code    VARCHAR2(40) NOT NULL,
      role_code       VARCHAR2(40) NOT NULL,
      multiplier      NUMBER(10,4),
      CONSTRAINT pk_csidl PRIMARY KEY (case_factory_id, process_code, role_code),
      CONSTRAINT fk_csidl_cf FOREIGN KEY (case_factory_id) REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE,
      CONSTRAINT fk_csidl_proc FOREIGN KEY (process_code) REFERENCES bom_process_catalog(process_code)
    )`);

  // ⚠️ bom_cs_case_equip_category(舊 category-price+mroPct 模型)已於 S1d 作廢 → 013h DROP。
  //    設備成本改讀 bom_cs_case_equip_area(013f · Equipment List 真模型)。

  // ========================================================================
  // bom_cs_case_consumable — 案級耗材配置
  // ========================================================================
  await createTable('BOM_CS_CASE_CONSUMABLE', `
    CREATE TABLE bom_cs_case_consumable (
      case_factory_id        NUMBER NOT NULL,
      consumable_id          NUMBER NOT NULL,
      process_code           VARCHAR2(40),
      annual_usage_qty       NUMBER(18,4),
      unit_cost_override_usd NUMBER(15,6),
      foxlink_part_no        VARCHAR2(80),
      CONSTRAINT pk_csconsum PRIMARY KEY (case_factory_id, consumable_id),
      CONSTRAINT fk_csconsum_cf FOREIGN KEY (case_factory_id) REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE,
      CONSTRAINT fk_csconsum_c FOREIGN KEY (consumable_id) REFERENCES bom_factory_consumable(consumable_id)
    )`);

  // ========================================================================
  // bom_cs_case_qty_scenario — 案級數量情境(LOW/HIGH)
  // ========================================================================
  await createTable('BOM_CS_CASE_QTY_SCENARIO', `
    CREATE TABLE bom_cs_case_qty_scenario (
      scenario_id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      case_factory_id    NUMBER NOT NULL,
      scenario_code      VARCHAR2(40) NOT NULL,
      scenario_label_zh  VARCHAR2(120),
      scenario_label_en  VARCHAR2(120),
      target_qty         NUMBER,
      region_applies     VARCHAR2(60),
      is_baseline        NUMBER(1) DEFAULT 0,
      notes              CLOB,
      CONSTRAINT fk_qtyscen_cf FOREIGN KEY (case_factory_id) REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE
    )`);
  await _idx(`CREATE UNIQUE INDEX uq_qtyscen ON bom_cs_case_qty_scenario(case_factory_id, scenario_code)`, 'uq_qtyscen');

  // ========================================================================
  // bom_cs_case_pkg — 案級 PKG 版本(商包/工包 · 雙價 roll-up app 算)
  // ========================================================================
  await createTable('BOM_CS_CASE_PKG', `
    CREATE TABLE bom_cs_case_pkg (
      pkg_id               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      case_factory_id      NUMBER NOT NULL,
      pkg_code             VARCHAR2(40) NOT NULL,
      pkg_label_zh_tw      VARCHAR2(120),
      pkg_label_en         VARCHAR2(120),
      effective_at         DATE,
      source_xlsx_sheet    VARCHAR2(200),
      items_count          NUMBER,
      total_cost_true_usd  NUMBER(15,6),
      total_cost_quote_usd NUMBER(15,6),
      markup_pct_avg       NUMBER(8,4),
      channel_applies_json CLOB,
      is_primary           NUMBER(1) DEFAULT 0,
      CONSTRAINT fk_cspkg_cf FOREIGN KEY (case_factory_id) REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE
    )`);
  await _idx(`CREATE UNIQUE INDEX uq_cspkg ON bom_cs_case_pkg(case_factory_id, pkg_code)`, 'uq_cspkg');

  // ========================================================================
  // bom_cs_case_pkg_item — PKG 子料(雙價 VIRTUAL · vendor_id 存值不建 FK)
  // ========================================================================
  await createTable('BOM_CS_CASE_PKG_ITEM', `
    CREATE TABLE bom_cs_case_pkg_item (
      pkg_item_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      pkg_id           NUMBER NOT NULL,
      item_seq         NUMBER,
      item_name        VARCHAR2(200),
      spec             CLOB,
      qty_per_unit     NUMBER(12,4),
      unit_of_measure  VARCHAR2(12),
      vendor_id        NUMBER,
      vendor_name      VARCHAR2(200),
      source_currency  VARCHAR2(8),
      true_cost_source NUMBER(15,6),
      fx_rate          NUMBER(15,6),
      true_cost_usd    NUMBER(15,6) GENERATED ALWAYS AS (true_cost_source / NULLIF(fx_rate,0)) VIRTUAL,
      quote_price_usd  NUMBER(15,6),
      markup_pct       NUMBER(8,4) GENERATED ALWAYS AS ((quote_price_usd - (true_cost_source / NULLIF(fx_rate,0))) / NULLIF(quote_price_usd,0)) VIRTUAL,
      lead_time_days   NUMBER,
      is_sustainable   NUMBER(1) DEFAULT 0,
      CONSTRAINT fk_cspkgitem_pkg FOREIGN KEY (pkg_id) REFERENCES bom_cs_case_pkg(pkg_id) ON DELETE CASCADE
    )`);
  await _idx(`CREATE INDEX idx_cspkgitem ON bom_cs_case_pkg_item(pkg_id, item_seq)`, 'idx_cspkgitem');

  // ========================================================================
  // bom_cs_case_pkg_module_include — PKG×module 矩陣(自然鍵 · 不建跨表 FK)
  // ========================================================================
  await createTable('BOM_CS_CASE_PKG_MODULE_INCLUDE', `
    CREATE TABLE bom_cs_case_pkg_module_include (
      case_factory_id NUMBER NOT NULL,
      pkg_code        VARCHAR2(40) NOT NULL,
      module_code     VARCHAR2(40) NOT NULL,
      is_included     NUMBER(1) DEFAULT 1,
      CONSTRAINT pk_cspkgmod PRIMARY KEY (case_factory_id, pkg_code, module_code),
      CONSTRAINT fk_cspkgmod_cf FOREIGN KEY (case_factory_id) REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE
    )`);

  // ========================================================================
  // bom_cs_case_macro_process — WHOOP 放大製程(macro header · 細站暫不建)
  // ========================================================================
  await createTable('BOM_CS_CASE_MACRO_PROCESS', `
    CREATE TABLE bom_cs_case_macro_process (
      macro_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      case_factory_id   NUMBER NOT NULL,
      macro_code        VARCHAR2(40) NOT NULL,
      name              VARCHAR2(120),
      num_stations      NUMBER,
      work_time_sec     NUMBER(12,4),
      dl_headcount      NUMBER(8,2),
      uph               NUMBER(12,4),
      process_yield_pct NUMBER(8,4),
      CONSTRAINT fk_csmacro_cf FOREIGN KEY (case_factory_id) REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE
    )`);
  await _idx(`CREATE UNIQUE INDEX uq_macro ON bom_cs_case_macro_process(case_factory_id, macro_code)`, 'uq_macro');

  // ========================================================================
  // bom_cs_case_smt_point — WHOOP SMT 點數(surrogate PK + UNIQUE)
  // ========================================================================
  await createTable('BOM_CS_CASE_SMT_POINT', `
    CREATE TABLE bom_cs_case_smt_point (
      smt_point_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      case_factory_id       NUMBER NOT NULL,
      board_code            VARCHAR2(80) NOT NULL,
      category_code         VARCHAR2(20) NOT NULL,
      pcs                   NUMBER(8),
      transfer_point        NUMBER(12,4),
      point_formula_override VARCHAR2(80),
      sub_total_usd         NUMBER(12,4),
      CONSTRAINT fk_cssmt_cf FOREIGN KEY (case_factory_id) REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE
    )`);
  await _idx(`CREATE UNIQUE INDEX uq_cssmt ON bom_cs_case_smt_point(case_factory_id, board_code, category_code)`, 'uq_cssmt');

  // ========================================================================
  // bom_cs_run — 計算 snapshot header
  // ========================================================================
  await createTable('BOM_CS_RUN', `
    CREATE TABLE bom_cs_run (
      run_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      case_factory_id NUMBER NOT NULL,
      status          VARCHAR2(20) DEFAULT 'computing',   -- computing|ready|archived|failed
      compute_engine  VARCHAR2(40),
      raw_inputs_json CLOB,
      computed_by     NUMBER,
      computed_at     TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT fk_csrun_cf FOREIGN KEY (case_factory_id) REFERENCES bom_cs_case_factory(case_factory_id) ON DELETE CASCADE
    )`);
  await _idx(`CREATE INDEX idx_csrun_cf ON bom_cs_run(case_factory_id, status)`, 'idx_csrun_cf');

  // ========================================================================
  // bom_cs_run_cell — 製程×Component 矩陣(run 內部公式還原 detail)
  // ========================================================================
  await createTable('BOM_CS_RUN_CELL', `
    CREATE TABLE bom_cs_run_cell (
      run_id            NUMBER NOT NULL,
      qty_scenario_code VARCHAR2(40) NOT NULL,
      process_code      VARCHAR2(40) NOT NULL,
      component_code    VARCHAR2(40) NOT NULL,
      cost_per_unit_usd NUMBER(18,8),
      formula_text      CLOB,
      source_cell_ref   VARCHAR2(40),
      intermediate_json CLOB,
      CONSTRAINT pk_csruncell PRIMARY KEY (run_id, qty_scenario_code, process_code, component_code),
      CONSTRAINT fk_csruncell_run FOREIGN KEY (run_id) REFERENCES bom_cs_run(run_id) ON DELETE CASCADE,
      CONSTRAINT fk_csruncell_comp FOREIGN KEY (component_code) REFERENCES bom_cs_component(component_code)
    )`);

  // ========================================================================
  // bom_cs_run_result — 計算結果 fact(對外唯一 · 雙價 + margin VIRTUAL)
  // ⚠️ open #1:quote 側 mva/sga/profit 沿用 true 側 · S1 須對 Excel ε<0.01 驗
  // ========================================================================
  await createTable('BOM_CS_RUN_RESULT', `
    CREATE TABLE bom_cs_run_result (
      result_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      run_id             NUMBER NOT NULL,
      factory_code       VARCHAR2(20),
      variant_key        VARCHAR2(40),
      qty_scenario_code  VARCHAR2(40),
      pkg_code           VARCHAR2(40),
      material_true_usd  NUMBER(15,6),
      pkg_true_usd       NUMBER(15,6),
      mva_usd            NUMBER(15,6),
      sga_usd            NUMBER(15,6),
      profit_amount_usd  NUMBER(15,6),
      total_true_usd     NUMBER(15,6) GENERATED ALWAYS AS (NVL(material_true_usd,0)+NVL(pkg_true_usd,0)+NVL(mva_usd,0)+NVL(sga_usd,0)+NVL(profit_amount_usd,0)) VIRTUAL,
      material_quote_usd NUMBER(15,6),
      pkg_quote_usd      NUMBER(15,6),
      total_quote_usd    NUMBER(15,6) GENERATED ALWAYS AS (NVL(material_quote_usd,0)+NVL(pkg_quote_usd,0)+NVL(mva_usd,0)+NVL(sga_usd,0)+NVL(profit_amount_usd,0)) VIRTUAL,
      margin_amount_usd  NUMBER(15,6) GENERATED ALWAYS AS ((NVL(material_quote_usd,0)+NVL(pkg_quote_usd,0)) - (NVL(material_true_usd,0)+NVL(pkg_true_usd,0))) VIRTUAL,
      gross_margin_pct   NUMBER(8,4) GENERATED ALWAYS AS (((NVL(material_quote_usd,0)+NVL(pkg_quote_usd,0)) - (NVL(material_true_usd,0)+NVL(pkg_true_usd,0))) / NULLIF(NVL(material_quote_usd,0)+NVL(pkg_quote_usd,0),0)) VIRTUAL,
      CONSTRAINT fk_csresult_run FOREIGN KEY (run_id) REFERENCES bom_cs_run(run_id) ON DELETE CASCADE
    )`);
  await _idx(`CREATE UNIQUE INDEX uq_csresult ON bom_cs_run_result(run_id, factory_code, variant_key, qty_scenario_code, pkg_code)`, 'uq_csresult');

  log.log('migration 013c ✓');
};
