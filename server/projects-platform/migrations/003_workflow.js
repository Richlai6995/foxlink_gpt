/**
 * Migration 003 — Workflow & Stage schema
 *
 * 對應 spec §13.6 / §13.7(Stage Gate + Workflow Templates)
 *
 * 規則:
 *   ✅ workflow_templates 有 scope=SYSTEM/PROJECT
 *   ✅ project_stages 每個 project 有一份(從 template clone 出來)
 *   ✅ idempotent
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/003');

module.exports = async function migrate003(db) {
  const createTable = async (name, ddl) => {
    try {
      const r = await db.prepare(
        `SELECT COUNT(*) AS C FROM user_tables WHERE table_name = UPPER(?)`,
      ).get(name);
      if (r && Number(r.C) > 0) return false;
      await db.prepare(ddl).run();
      log.log(`created table ${name}`);
      return true;
    } catch (e) {
      log.warn(`createTable ${name}:`, e.message);
      return false;
    }
  };

  const _idx = async (sql, name) => {
    try {
      await db.prepare(sql).run();
      log.log(`created index ${name}`);
    } catch (e) {
      if (!/already used|already exists|ORA-00955|ORA-01408/.test(e.message)) {
        log.warn(`index ${name}:`, e.message);
      }
    }
  };

  // ==========================================================================
  // workflow_templates — 工作流範本(SYSTEM scope only in Phase 1)
  //
  // scope:
  //   SYSTEM  — admin 維護的全域範本(對應 plugin default_workflow_stages)
  //   PROJECT — Phase 2 才開放(per-project 客製)
  // ==========================================================================
  await createTable('WORKFLOW_TEMPLATES', `
    CREATE TABLE workflow_templates (
      id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      code              VARCHAR2(60) UNIQUE NOT NULL,
      name_i18n         CLOB,
      description_i18n  CLOB,
      project_type_id   NUMBER,
      scope             VARCHAR2(20) DEFAULT 'SYSTEM',
      version           NUMBER DEFAULT 1,
      is_default        NUMBER(1) DEFAULT 0,
      is_enabled        NUMBER(1) DEFAULT 1,
      created_by_user_id NUMBER,
      created_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at        TIMESTAMP DEFAULT SYSTIMESTAMP
    )
  `);
  await _idx(
    `CREATE INDEX idx_wt_type ON workflow_templates(project_type_id, scope, is_enabled)`,
    'idx_wt_type',
  );

  // ==========================================================================
  // workflow_template_stages — 範本的 stage 清單
  // ==========================================================================
  await createTable('WORKFLOW_TEMPLATE_STAGES', `
    CREATE TABLE workflow_template_stages (
      id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      template_id       NUMBER NOT NULL,
      stage_code        VARCHAR2(40) NOT NULL,
      stage_name_i18n   CLOB,
      stage_order       NUMBER NOT NULL,
      sla_hours         NUMBER,
      required_role     VARCHAR2(30),
      gate_required     NUMBER(1) DEFAULT 0,
      created_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT uq_wts_order UNIQUE (template_id, stage_order),
      CONSTRAINT uq_wts_code  UNIQUE (template_id, stage_code)
    )
  `);
  await _idx(
    `CREATE INDEX idx_wts_template ON workflow_template_stages(template_id, stage_order)`,
    'idx_wts_template',
  );

  // ==========================================================================
  // project_stages — 每個 project 的 stage 實例(從 template clone)
  //
  // status:
  //   PENDING          — 還沒到
  //   ACTIVE           — 當前 stage
  //   READY_FOR_GATE   — 已完成、等待 business 確認(Stage Gate)
  //   DONE             — 已關
  //   SKIPPED          — 跳過(plugin / Wizard 決定)
  // ==========================================================================
  await createTable('PROJECT_STAGES', `
    CREATE TABLE project_stages (
      id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_id        NUMBER NOT NULL,
      stage_code        VARCHAR2(40) NOT NULL,
      stage_name_i18n   CLOB,
      stage_order       NUMBER NOT NULL,
      status            VARCHAR2(20) DEFAULT 'PENDING',
      sla_hours         NUMBER,
      required_role     VARCHAR2(30),
      gate_required     NUMBER(1) DEFAULT 0,
      gate_confirmed_by NUMBER,
      gate_confirmed_at TIMESTAMP,
      gate_notes        VARCHAR2(1000),
      sla_due_at        TIMESTAMP,
      entered_at        TIMESTAMP,
      completed_at      TIMESTAMP,
      created_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT uq_ps_order UNIQUE (project_id, stage_order),
      CONSTRAINT uq_ps_code  UNIQUE (project_id, stage_code)
    )
  `);
  await _idx(
    `CREATE INDEX idx_ps_project_status ON project_stages(project_id, status, stage_order)`,
    'idx_ps_project_status',
  );

  log.log('003_workflow migration ✓');
};
