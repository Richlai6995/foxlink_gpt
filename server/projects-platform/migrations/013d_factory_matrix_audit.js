/**
 * Migration 013d — BOM superset · Factory Matrix + 統一 audit + 資源權限 + baseline diff
 *                   (S0-BOM 收尾 · 7 表)
 *
 * 對應 bom-collection-sd §16 + cortex-unified-architecture-sd §5/§8.2 + workflow 收斂 · rollout §3.6
 *
 * 7 表:
 *   project_factory_matrix(FK projects · pfm_cell 4 表 root · 取代 data_payload.factory_matrix JSON)
 *   → pfm_factory(廠軸 · mva cache)/ pfm_pkg_option(包裝軸)/ pfm_cell(唯一寫入終點 · 多維雙價)
 *   bom_audit_log(統一審計 · 併 bom_cs_audit_log/pfm_cell_audit · FK 故意不強約束 · 跨多 parent)
 *   bom_settings_admin_grant(資源級細權 · 與 008 user_role_grants 並存)
 *   bom_cs_baseline_diff(reprice impact 逐欄明細 · header 走 audit)
 *
 * 注:pfm_cell prime/total/is_min 為「實欄 propagate 寫」(非 VIRTUAL · 跨表加總)。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/013d');

module.exports = async function migrate013d(db) {
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
  // project_factory_matrix — Multi-Factory Cost Matrix 主表(取代 data_payload JSON)
  // ========================================================================
  await createTable('PROJECT_FACTORY_MATRIX', `
    CREATE TABLE project_factory_matrix (
      id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_id      NUMBER NOT NULL,
      version_no      NUMBER NOT NULL,
      bom_instance_id NUMBER,
      variant_key     VARCHAR2(40),
      sga_profit      NUMBER(12,6),
      suggested       NUMBER(15,6),
      annual_qty      NUMBER,
      annual_rev      NUMBER(18,6),
      recommended     VARCHAR2(40),
      state           VARCHAR2(20) DEFAULT 'DRAFT',   -- DRAFT|LOCKED
      created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT fk_pfm_proj FOREIGN KEY (project_id) REFERENCES projects(id),
      CONSTRAINT fk_pfm_inst FOREIGN KEY (bom_instance_id) REFERENCES bom_instance(id)
    )`);
  await _idx(`CREATE UNIQUE INDEX uq_pfm ON project_factory_matrix(project_id, version_no)`, 'uq_pfm');

  // ========================================================================
  // pfm_factory — 廠別軸(mva cache from cs_run)
  // ========================================================================
  await createTable('PFM_FACTORY', `
    CREATE TABLE pfm_factory (
      id                       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_factory_matrix_id NUMBER NOT NULL,
      factory_code             VARCHAR2(20),
      factory_name             VARCHAR2(120),
      mva_usd                  NUMBER(15,6),
      mva_labor_usd            NUMBER(15,6),
      mva_equipment_usd        NUMBER(15,6),
      mva_overhead_usd         NUMBER(15,6),
      mva_source               VARCHAR2(40),
      erp_org_id               NUMBER,
      CONSTRAINT fk_pfmf_matrix FOREIGN KEY (project_factory_matrix_id) REFERENCES project_factory_matrix(id) ON DELETE CASCADE
    )`);

  // ========================================================================
  // pfm_pkg_option — 包裝軸
  // ========================================================================
  await createTable('PFM_PKG_OPTION', `
    CREATE TABLE pfm_pkg_option (
      id                       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_factory_matrix_id NUMBER NOT NULL,
      pkg_option_code          VARCHAR2(20),
      pkg_label                VARCHAR2(120),
      pkg_cost_usd             NUMBER(15,6),
      CONSTRAINT fk_pfmp_matrix FOREIGN KEY (project_factory_matrix_id) REFERENCES project_factory_matrix(id) ON DELETE CASCADE
    )`);

  // ========================================================================
  // pfm_cell — Factory Matrix Cell(唯一寫入終點 · factory×pkg×variant×qty 多維雙價)
  // ========================================================================
  await createTable('PFM_CELL', `
    CREATE TABLE pfm_cell (
      id                       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_factory_matrix_id NUMBER NOT NULL,
      pfm_factory_id           NUMBER,
      pfm_pkg_option_id        NUMBER,
      variant_key              VARCHAR2(40),
      qty_scenario_code        VARCHAR2(40),
      pkg_code                 VARCHAR2(40),
      material_cost            NUMBER(15,6),         -- BOM lock propagate (true)
      material_quote_usd       NUMBER(15,6),
      pkg_cost                 NUMBER(15,6),
      pkg_quote_usd            NUMBER(15,6),
      mva_usd                  NUMBER(15,6),
      sga_usd                  NUMBER(15,6),
      profit_usd               NUMBER(15,6),
      material_cost_updated_at TIMESTAMP,
      prime_cost               NUMBER(15,6),         -- = material + factory.mva(propagate 寫實欄)
      total_cost_exfactory     NUMBER(15,6),         -- = prime + sga_profit + pkg
      is_min_in_variant        NUMBER(1) DEFAULT 0,
      is_confidential_cell     NUMBER(1) DEFAULT 0,
      mva_source               VARCHAR2(40),
      erp_org_id               NUMBER,
      state                    VARCHAR2(20) DEFAULT 'DRAFT',   -- DRAFT|LOCKED
      CONSTRAINT fk_pfmc_matrix FOREIGN KEY (project_factory_matrix_id) REFERENCES project_factory_matrix(id) ON DELETE CASCADE,
      CONSTRAINT fk_pfmc_factory FOREIGN KEY (pfm_factory_id) REFERENCES pfm_factory(id),
      CONSTRAINT fk_pfmc_pkg FOREIGN KEY (pfm_pkg_option_id) REFERENCES pfm_pkg_option(id)
    )`);
  await _idx(`CREATE INDEX idx_pfmcell_matrix ON pfm_cell(project_factory_matrix_id, variant_key)`, 'idx_pfmcell_matrix');
  await _idx(`CREATE UNIQUE INDEX uq_pfmcell ON pfm_cell(project_factory_matrix_id, pfm_factory_id, pfm_pkg_option_id, variant_key, qty_scenario_code)`, 'uq_pfmcell');

  // ========================================================================
  // bom_audit_log — 統一審計(FK 故意不強約束 · 跨多 parent · app 層保一致)
  // ========================================================================
  await createTable('BOM_AUDIT_LOG', `
    CREATE TABLE bom_audit_log (
      audit_id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entity_type     VARCHAR2(40),    -- BOM_INSTANCE|BOM_ITEM|CASE_FACTORY|PFM_CELL|BASELINE|RUN
      bom_instance_id NUMBER,
      bom_item_id     NUMBER,
      case_factory_id NUMBER,
      pfm_cell_id     NUMBER,
      baseline_id     NUMBER,
      event_type      VARCHAR2(50),    -- instance_created|excel_imported|lock_*|final_locked|BASELINE_UPDATED|BOM_PROPAGATE|CS_COMPUTED|baseline_diff|factory_matrix_lock|...
      event_payload   CLOB,
      schema_before   CLOB,
      schema_after    CLOB,
      actor_user_id   NUMBER,
      actor_ip        VARCHAR2(60),
      occurred_at     TIMESTAMP DEFAULT SYSTIMESTAMP
    )`);
  await _idx(`CREATE INDEX idx_audit_inst ON bom_audit_log(bom_instance_id, occurred_at)`, 'idx_audit_inst');
  await _idx(`CREATE INDEX idx_audit_cf ON bom_audit_log(case_factory_id, occurred_at)`, 'idx_audit_cf');
  await _idx(`CREATE INDEX idx_audit_evt ON bom_audit_log(event_type, occurred_at)`, 'idx_audit_evt');

  // ========================================================================
  // bom_settings_admin_grant — BOM/cost 資源級細權(與 008 user_role_grants 並存)
  // ========================================================================
  await createTable('BOM_SETTINGS_ADMIN_GRANT', `
    CREATE TABLE bom_settings_admin_grant (
      grant_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id       NUMBER NOT NULL,
      resource_type VARCHAR2(40),    -- baseline|factory_matrix|cost_structure
      scope         VARCHAR2(20),    -- BG|BU|PROJECT|FACTORY
      bg_code       VARCHAR2(40),
      bu_code       VARCHAR2(40),
      factory_code  VARCHAR2(20),
      role          VARCHAR2(20),    -- ADMIN|EDITOR|VIEWER
      granted_by    NUMBER,
      granted_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
      expires_at    TIMESTAMP,
      is_active     NUMBER(1) DEFAULT 1,
      CONSTRAINT fk_bsag_factory FOREIGN KEY (factory_code) REFERENCES bom_factory(factory_code)
    )`);
  await _idx(`CREATE INDEX idx_bsag_user ON bom_settings_admin_grant(user_id, is_active)`, 'idx_bsag_user');

  // ========================================================================
  // bom_cs_baseline_diff — Baseline 差異明細(header 走 audit · 此表逐欄)
  // ========================================================================
  await createTable('BOM_CS_BASELINE_DIFF', `
    CREATE TABLE bom_cs_baseline_diff (
      diff_id             NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      old_baseline_id     NUMBER NOT NULL,
      new_baseline_id     NUMBER NOT NULL,
      change_type         VARCHAR2(40),    -- DL_WAGE|IDL|EQUIPMENT|CONSUMABLE
      field_path          VARCHAR2(200),
      old_value           VARCHAR2(400),
      new_value           VARCHAR2(400),
      impact_estimate_usd NUMBER(15,6),
      audit_id            NUMBER,          -- 回指 bom_audit_log.audit_id(event=baseline_diff)
      created_at          TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT fk_bldiff_old FOREIGN KEY (old_baseline_id) REFERENCES bom_factory_baseline(baseline_id),
      CONSTRAINT fk_bldiff_new FOREIGN KEY (new_baseline_id) REFERENCES bom_factory_baseline(baseline_id)
    )`);
  await _idx(`CREATE INDEX idx_bldiff ON bom_cs_baseline_diff(new_baseline_id)`, 'idx_bldiff');

  log.log('migration 013d ✓');
};
