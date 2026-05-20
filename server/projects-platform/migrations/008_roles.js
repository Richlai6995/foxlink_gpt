/**
 * Migration 008 — 13 角色身份體系 + 組織單位 + super_user 主動加入 + admin testing mode
 *
 * 對應 spec §17(角色身份體系)
 *
 * 5 張表:
 *   - user_role_definitions          13 預定義 role(seed)
 *   - user_role_grants               user × role × scope 授予
 *   - organization_units             BG/BU/SUB_BU/DEPT 樹
 *   - user_organization_memberships  user × org 多對多隸屬
 *   - project_super_users            §13.3 bu_super / hq_super 主動加入專案
 *   - admin_testing_sessions         §17.4 testing mode toggle audit
 *
 * 13 role seed:
 *   project.sales / project.pm / project.bu_director / project.top_director
 *   project.bu_super / project.hq_super
 *   workflow.admin / workflow.bu_editor
 *   data.connection_manager / notification.editor / confidential.policy_editor
 *   admin / admin.testing
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/008');

module.exports = async function migrate008(db) {
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
  // 1. user_role_definitions — 預定義 role(seed,system 維護)
  // ==========================================================================
  await createTable('USER_ROLE_DEFINITIONS', `
    CREATE TABLE user_role_definitions (
      id                       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      role_code                VARCHAR2(80)  NOT NULL UNIQUE,
      name_i18n                CLOB,
      description_i18n         CLOB,
      category                 VARCHAR2(40)  NOT NULL,  -- project|workflow|data|notification|confidential|admin
      is_system                NUMBER(1) DEFAULT 1,     -- system 預設不可刪
      permissions_json         CLOB,
      default_expires_days     NUMBER,
      requires_dual_sign       NUMBER(1) DEFAULT 0,
      created_at               TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at               TIMESTAMP DEFAULT SYSTIMESTAMP
    )
  `);

  // ==========================================================================
  // 2. organization_units — BG/BU/SUB_BU/DEPT 樹
  // ==========================================================================
  await createTable('ORGANIZATION_UNITS', `
    CREATE TABLE organization_units (
      id                       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      parent_id                NUMBER,
      org_level                VARCHAR2(20) NOT NULL,  -- BG|BU|SUB_BU|DEPT(LEVEL 是 Oracle 保留字 → 改 org_level)
      code                     VARCHAR2(50) UNIQUE,
      name_i18n                CLOB,
      is_active                NUMBER(1) DEFAULT 1,
      managed_by_admin_user_id NUMBER,
      sort_order               NUMBER DEFAULT 0,
      created_at               TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at               TIMESTAMP DEFAULT SYSTIMESTAMP
    )
  `);

  await _idx(`CREATE INDEX idx_org_parent ON organization_units(parent_id, is_active)`, 'idx_org_parent');
  await _idx(`CREATE INDEX idx_org_level  ON organization_units(org_level, is_active)`,  'idx_org_level');

  // ==========================================================================
  // 3. user_organization_memberships — user × org 多對多
  // ==========================================================================
  await createTable('USER_ORGANIZATION_MEMBERSHIPS', `
    CREATE TABLE user_organization_memberships (
      id                       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id                  NUMBER NOT NULL,
      org_unit_id              NUMBER NOT NULL,
      is_primary               NUMBER(1) DEFAULT 0,
      joined_at                TIMESTAMP DEFAULT SYSTIMESTAMP,
      left_at                  TIMESTAMP,
      managed_by_admin_user_id NUMBER,
      CONSTRAINT uq_uom UNIQUE (user_id, org_unit_id)
    )
  `);

  await _idx(`CREATE INDEX idx_uom_user ON user_organization_memberships(user_id, left_at)`, 'idx_uom_user');
  await _idx(`CREATE INDEX idx_uom_org  ON user_organization_memberships(org_unit_id, left_at)`,  'idx_uom_org');

  // ==========================================================================
  // 4. user_role_grants — user × role × scope
  // ==========================================================================
  await createTable('USER_ROLE_GRANTS', `
    CREATE TABLE user_role_grants (
      id                       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id                  NUMBER NOT NULL,
      role_id                  NUMBER NOT NULL,
      scope_type               VARCHAR2(20) DEFAULT 'GLOBAL',  -- GLOBAL|BU
      scope_values             CLOB,                            -- JSON array (e.g. [1,2,3] when scope_type=BU)
      granted_by_admin_user_id NUMBER,
      granted_at               TIMESTAMP DEFAULT SYSTIMESTAMP,
      expires_at               TIMESTAMP,
      is_active                NUMBER(1) DEFAULT 1,
      revoked_at               TIMESTAMP,
      revoked_by_admin_user_id NUMBER,
      revoke_reason            VARCHAR2(500),
      audit_metadata_clob      CLOB,
      created_at               TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at               TIMESTAMP DEFAULT SYSTIMESTAMP
    )
  `);

  await _idx(`CREATE INDEX idx_urg_user_active   ON user_role_grants(user_id, is_active)`,        'idx_urg_user_active');
  await _idx(`CREATE INDEX idx_urg_role_active   ON user_role_grants(role_id, is_active)`,        'idx_urg_role_active');
  await _idx(`CREATE INDEX idx_urg_expires       ON user_role_grants(expires_at, is_active)`,     'idx_urg_expires');

  // ==========================================================================
  // 5. project_super_users — §13.3 bu_super / hq_super 主動加入
  // ==========================================================================
  await createTable('PROJECT_SUPER_USERS', `
    CREATE TABLE project_super_users (
      id                       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_id               NUMBER NOT NULL,
      user_id                  NUMBER NOT NULL,
      via_role_code            VARCHAR2(80),                   -- 'project.bu_super' | 'project.hq_super'
      reason                   VARCHAR2(500),
      joined_at                TIMESTAMP DEFAULT SYSTIMESTAMP,
      left_at                  TIMESTAMP,
      CONSTRAINT uq_psu UNIQUE (project_id, user_id)
    )
  `);

  await _idx(`CREATE INDEX idx_psu_project ON project_super_users(project_id, left_at)`, 'idx_psu_project');
  await _idx(`CREATE INDEX idx_psu_user    ON project_super_users(user_id, left_at)`,    'idx_psu_user');

  // ==========================================================================
  // 6. admin_testing_sessions — §17.4 admin testing mode toggle
  // ==========================================================================
  await createTable('ADMIN_TESTING_SESSIONS', `
    CREATE TABLE admin_testing_sessions (
      id                              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id                         NUMBER NOT NULL,
      reason                          VARCHAR2(500),
      expected_duration_minutes       NUMBER DEFAULT 60,
      started_at                      TIMESTAMP DEFAULT SYSTIMESTAMP,
      ended_at                        TIMESTAMP,
      ended_reason                    VARCHAR2(40),    -- manual_exit | timeout | session_expired
      notified_bu_director_user_ids   CLOB             -- JSON array
    )
  `);

  await _idx(`CREATE INDEX idx_ats_user_active ON admin_testing_sessions(user_id, ended_at)`, 'idx_ats_user_active');

  // ==========================================================================
  // 7. Seed 13 role definitions(idempotent — 已存在跳過)
  // ==========================================================================
  await _seedRoles(db);

  log.log('migration 008 ✓');
};

async function _seedRoles(db) {
  const ROLES = [
    // project.*(6)
    { code: 'project.sales',           cat: 'project',       zh: '業務',             en: 'Sales',                desc_zh: '開案、指派 PM',                       desc_en: 'Initiate projects, assign PM' },
    { code: 'project.pm',              cat: 'project',       zh: 'PM',               en: 'Project Manager',      desc_zh: '接案執行;sub_role 區分 DPM/BPM/MPM/EPM', desc_en: 'Project execution; sub_role splits DPM/BPM/MPM/EPM' },
    { code: 'project.bu_director',     cat: 'project',       zh: 'BU 主管',          en: 'BU Director',          desc_zh: '處級主管,管 BU 內專案(支援 multi-BU)',  desc_en: 'Manages all projects in assigned BU(s)' },
    { code: 'project.top_director',    cat: 'project',       zh: '最高層主管',        en: 'Top Director',         desc_zh: '全公司專案視野',                       desc_en: 'Global visibility' },
    { code: 'project.bu_super',        cat: 'project',       zh: 'BU 經管',          en: 'BU Super User',        desc_zh: 'BU 經營管理(財控/HR/Audit),主動 self-join', desc_en: 'BU mgmt/finance/audit, self-join' },
    { code: 'project.hq_super',        cat: 'project',       zh: 'HQ 經管',          en: 'HQ Super User',        desc_zh: '集團經管,主動 self-join',              desc_en: 'HQ mgmt, self-join' },

    // workflow.*(2)
    { code: 'workflow.admin',          cat: 'workflow',      zh: '流程模板管理',      en: 'Workflow Admin',       desc_zh: '編 SYSTEM workflow template',           desc_en: 'Manage SYSTEM workflow template' },
    { code: 'workflow.bu_editor',      cat: 'workflow',      zh: 'BU 流程編輯',      en: 'BU Workflow Editor',   desc_zh: '編 BU workflow template',               desc_en: 'Manage BU workflow template' },

    // data / notification / confidential(3)
    { code: 'data.connection_manager', cat: 'data',          zh: '連線管理員',        en: 'Connection Manager',   desc_zh: '管 ERP / SFC / API 連線',               desc_en: 'Manage ERP/SFC/API connections' },
    { code: 'notification.editor',    cat: 'notification',  zh: '通知編寫者',        en: 'Notification Editor',  desc_zh: '編 SYSTEM / BU notification rules',     desc_en: 'Manage notification rules' },
    { code: 'confidential.policy_editor', cat: 'confidential', zh: '機密策略編寫者', en: 'Confidential Policy Editor', desc_zh: '編欄位顯示策略',                  desc_en: 'Manage confidential display strategies' },

    // admin(2)
    { code: 'admin',                   cat: 'admin',         zh: '系統管理員',        en: 'System Admin',         desc_zh: '權限全開,測試業務功能走 testing mode',    desc_en: 'Full permissions; biz testing via toggle' },
    { code: 'admin.testing',           cat: 'admin',         zh: '管理員測試模式',    en: 'Admin Testing Mode',   desc_zh: '進入後業務操作 audit 加 [ADMIN_TEST]',     desc_en: 'Audit prefix [ADMIN_TEST]' },
  ];

  for (const r of ROLES) {
    try {
      // 已存在跳過
      const exists = await db.prepare(
        `SELECT id FROM user_role_definitions WHERE role_code = ?`,
      ).get(r.code);
      if (exists) continue;

      await db.prepare(`
        INSERT INTO user_role_definitions
          (role_code, name_i18n, description_i18n, category, is_system, permissions_json)
        VALUES (?, ?, ?, ?, 1, ?)
      `).run(
        r.code,
        JSON.stringify({ 'zh-TW': r.zh, en: r.en, vi: r.zh }),
        JSON.stringify({ 'zh-TW': r.desc_zh, en: r.desc_en, vi: r.desc_zh }),
        r.cat,
        JSON.stringify({}),  // permissions Phase 1 留空,Phase 2 細化
      );
      log.log(`seeded role: ${r.code}`);
    } catch (e) {
      log.warn(`seed role ${r.code} failed: ${e.message}`);
    }
  }
}
