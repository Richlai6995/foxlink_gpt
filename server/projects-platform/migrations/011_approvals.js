/**
 * Migration 011 — Sprint P · 多級簽核 + reviewer
 *
 * 對齊 roadmap Sprint P:
 *   - 高金額 / 跨 BU / 機密升級 需多人簽核
 *   - 跟 Stage Gate 整合(某 stage advance 前先過 approval)
 *
 * 三張表:
 *   - project_approval_chains    chain instance(per project)
 *   - project_approval_steps      multi-step approval sequence
 *   - project_approval_triggers   觸發規則(per type/scope/threshold)
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/011');

module.exports = async function migrate011(db) {
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
      log.warn(`createTable ${name}: ${e.message}`);
      return false;
    }
  };

  const _idx = async (sql, name) => {
    try {
      await db.prepare(sql).run();
      log.log(`created index ${name}`);
    } catch (e) {
      if (!/already used|already exists|ORA-00955|ORA-01408/.test(e.message)) {
        log.warn(`index ${name}: ${e.message}`);
      }
    }
  };

  // ==========================================================================
  // 1. project_approval_chains — chain instance per project
  // ==========================================================================
  await createTable('PROJECT_APPROVAL_CHAINS', `
    CREATE TABLE project_approval_chains (
      id                       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_id               NUMBER NOT NULL,
      chain_kind               VARCHAR2(40) NOT NULL,       -- 'stage_gate' | 'lifecycle_close' | 'confidential_upgrade' | 'high_amount'
      title                    VARCHAR2(300),
      reason                   VARCHAR2(1000),
      requested_by_user_id     NUMBER NOT NULL,
      target_stage_id          NUMBER,                       -- 若 chain_kind='stage_gate' 指 next stage
      target_payload_json      CLOB,                         -- 簽核完要 apply 的 patch(stage advance / lifecycle 等)
      status                   VARCHAR2(30) DEFAULT 'PENDING',  -- PENDING|APPROVED|REJECTED|CANCELLED|EXPIRED
      current_step_order       NUMBER DEFAULT 1,
      total_steps              NUMBER DEFAULT 1,
      expires_at               TIMESTAMP,
      completed_at             TIMESTAMP,
      completed_by_user_id     NUMBER,
      created_at               TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at               TIMESTAMP DEFAULT SYSTIMESTAMP
    )
  `);
  await _idx(`CREATE INDEX idx_pac_project ON project_approval_chains(project_id, status)`, 'idx_pac_project');
  await _idx(`CREATE INDEX idx_pac_status  ON project_approval_chains(status, created_at)`, 'idx_pac_status');

  // ==========================================================================
  // 2. project_approval_steps — 各 step 簽核紀錄
  // ==========================================================================
  await createTable('PROJECT_APPROVAL_STEPS', `
    CREATE TABLE project_approval_steps (
      id                       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      chain_id                 NUMBER NOT NULL,
      step_order               NUMBER NOT NULL,
      approver_user_id         NUMBER,                       -- 指定 user(NULL = 任意 role 可批)
      approver_role            VARCHAR2(80),                  -- role_code(如 'project.bu_director')
      step_kind                VARCHAR2(40) DEFAULT 'approve',  -- approve | review | notify
      decision                 VARCHAR2(20),                  -- approved | rejected | skipped
      decided_by_user_id       NUMBER,
      decided_at               TIMESTAMP,
      decision_comment         VARCHAR2(2000),
      created_at               TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT uq_pas UNIQUE (chain_id, step_order)
    )
  `);
  await _idx(`CREATE INDEX idx_pas_chain    ON project_approval_steps(chain_id, step_order)`, 'idx_pas_chain');
  await _idx(`CREATE INDEX idx_pas_pending  ON project_approval_steps(approver_user_id, decision)`, 'idx_pas_pending');
  await _idx(`CREATE INDEX idx_pas_role     ON project_approval_steps(approver_role, decision)`, 'idx_pas_role');

  // ==========================================================================
  // 3. project_approval_triggers — 觸發規則(admin 配)
  // ==========================================================================
  await createTable('PROJECT_APPROVAL_TRIGGERS', `
    CREATE TABLE project_approval_triggers (
      id                       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name                     VARCHAR2(200) NOT NULL,
      chain_kind               VARCHAR2(40) NOT NULL,
      condition_json           CLOB,                          -- e.g. { "min_amount_usd": 100000 } / { "is_confidential": 1 }
      approver_chain_json      CLOB,                          -- [{ "step_order": 1, "approver_role": "project.bu_director" }, ...]
      bu_scope                 VARCHAR2(40) DEFAULT 'GLOBAL', -- GLOBAL | BU
      bu_id                    NUMBER,
      is_active                NUMBER(1) DEFAULT 1,
      created_by_admin_user_id NUMBER,
      created_at               TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at               TIMESTAMP DEFAULT SYSTIMESTAMP
    )
  `);
  await _idx(`CREATE INDEX idx_pat_active ON project_approval_triggers(is_active, chain_kind)`, 'idx_pat_active');

  log.log('011_approvals migration ✓');
};
