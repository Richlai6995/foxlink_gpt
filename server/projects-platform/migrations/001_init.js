/**
 * Migration 001 — Initial schema for projects-platform
 *
 * 對應 spec §3 / §13 / §14 / §17 等 Schema 草案。
 * Idempotent — 用 createTable / addCol helper(check-if-exists)。
 *
 * Phase 1 scaffold:目前只建「核心 4 張表」+ ALTER ticket_messages
 * 其餘表(channel / form / task / dashboard 等)在後續 migration 加入。
 *
 * 解耦規則對應:
 *   ✅ 規則 1:不直接 ALTER Cortex 既有 schema — 除 ticket_messages 已規劃
 *   ✅ 全新表用 project_* / qp_* 前綴
 *   ✅ idempotent — 可重跑
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/001');

module.exports = async function migrate001(db) {
  // db 是 database-oracle.js 的 wrapper,有 prepare / columnExists / 等方法

  // ==========================================================================
  // Helper(沿用 database-oracle.js 同樣 pattern)
  // ==========================================================================
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

  const addCol = async (table, column, definition) => {
    try {
      const exists = await db.columnExists(table, column);
      if (!exists) {
        await db.prepare(`ALTER TABLE ${table} ADD ${column} ${definition}`).run();
        log.log(`added ${table}.${column}`);
      }
    } catch (e) {
      log.warn(`addCol ${table}.${column}:`, e.message);
    }
  };

  // ==========================================================================
  // 1. project_types — admin 維護的 type metadata(plugin code 是 source of truth)
  // ==========================================================================
  await createTable('PROJECT_TYPES', `
    CREATE TABLE project_types (
      id                            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      type_code                     VARCHAR2(30) UNIQUE NOT NULL,
      name_i18n                     CLOB,
      description_i18n              CLOB,
      icon                          VARCHAR2(100),
      is_enabled                    NUMBER(1) DEFAULT 1,
      default_workflow_template_id  NUMBER,
      default_classification_label  VARCHAR2(20),
      default_is_confidential       NUMBER(1) DEFAULT 0,
      sort_order                    NUMBER DEFAULT 100,
      created_at                    TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at                    TIMESTAMP DEFAULT SYSTIMESTAMP
    )
  `);

  // ==========================================================================
  // 2. projects — 核心物件(通用)
  // ==========================================================================
  await createTable('PROJECTS', `
    CREATE TABLE projects (
      id                            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_code                  VARCHAR2(40) UNIQUE NOT NULL,
      project_type_id               NUMBER NOT NULL,
      workflow_template_id          NUMBER,

      -- 機密
      is_confidential               NUMBER(1) DEFAULT 0,
      confidential_fields           CLOB,
      classification_label          VARCHAR2(20),

      -- payload
      data_payload                  CLOB,
      encrypted_payload             BLOB,
      encryption_key_id             VARCHAR2(100),

      -- 人員
      sales_user_id                 NUMBER,
      pm_user_id                    NUMBER NOT NULL,
      bu_id                         NUMBER NOT NULL,

      -- 狀態 / SLA
      lifecycle_status              VARCHAR2(20) DEFAULT 'DRAFT',
      status                        VARCHAR2(20) DEFAULT 'DRAFT',
      current_stage_id              NUMBER,
      importance                    VARCHAR2(10) DEFAULT 'NORMAL',
      urgency                       VARCHAR2(10) DEFAULT 'NORMAL',
      priority_score                NUMBER,
      rfq_received_at               TIMESTAMP DEFAULT SYSTIMESTAMP,
      sla_due_at                    TIMESTAMP,
      closed_at                     TIMESTAMP,
      pause_reason                  VARCHAR2(50),
      pause_until                   TIMESTAMP,
      reopen_reason                 VARCHAR2(500),

      -- 結案 fork
      declassified_from_project_id  NUMBER,
      is_declassified               NUMBER(1) DEFAULT 0,

      created_by_user_id            NUMBER NOT NULL,
      created_at                    TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at                    TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT chk_no_uplevel CHECK (is_declassified = 0 OR is_confidential = 0)
    )
  `);

  // Indexes(check-if-exists by trying)
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
  await _idx(`CREATE INDEX idx_p_pm ON projects(pm_user_id, status)`, 'idx_p_pm');
  await _idx(`CREATE INDEX idx_p_sales ON projects(sales_user_id, status)`, 'idx_p_sales');
  await _idx(`CREATE INDEX idx_p_bu_type ON projects(bu_id, project_type_id, status)`, 'idx_p_bu_type');

  // ==========================================================================
  // 3. project_members — 成員 + sub_role(multi-PM)+ field_grants(機密)
  // ==========================================================================
  await createTable('PROJECT_MEMBERS', `
    CREATE TABLE project_members (
      id                       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_id               NUMBER NOT NULL,
      user_id                  NUMBER NOT NULL,
      role                     VARCHAR2(20) NOT NULL,
      sub_role                 VARCHAR2(20),
      field_grants             CLOB,
      invited_by               NUMBER NOT NULL,
      invited_by_pm_user_id    NUMBER,
      invited_at               TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT uq_pm UNIQUE (project_id, user_id)
    )
  `);
  await _idx(
    `CREATE INDEX idx_pm_team ON project_members(project_id, invited_by_pm_user_id)`,
    'idx_pm_team',
  );

  // ==========================================================================
  // 4. 訊息表決策(2026-05-11 Sprint 2 修正)
  //
  // 設計文件原寫「reuse ticket_messages」,但 Cortex 實際表叫 feedback_messages,
  // 而且 schema 不適合(ticket_id NOT NULL FK)。Sprint 2 改為新建 project_messages
  // 表(migration 006)— 真正符合解耦規則 1「不動既有 Cortex schema」。
  //
  // 此處留註不執行任何 ALTER,避免 ORA-00942 噪音。
  // ==========================================================================

  log.log('001_init migration ✓');

  // 後續 migrations:002_channels / 003_workflow / 004_tasks / 005_seed / 006_messages
};
