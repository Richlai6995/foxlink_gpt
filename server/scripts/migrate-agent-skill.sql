-- ============================================================================
-- Skill Agent (type='agent') — Phase 1 S1 migration
-- docs/skill-agent-plan.md §2.1
--
-- 全 additive、idempotent(欄位已存在 → ORA-01430,忽略)。
-- 注意:server 啟動時 database-oracle.js 的 safeAddColumn 會「自動」套用同樣的欄位;
--       此檔供 DBA 預先 review / 手動先行執行(例如想在部署前先驗證 schema)。
-- 不破壞既有行為:新權限預設關、type='agent' 在 dispatch 分支(S4)前不會被執行。
-- 在 SQL*Plus / SQLcl 執行:  @migrate-agent-skill.sql
-- ============================================================================

-- ── skills:type='agent' 專屬欄位 ──────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE 'ALTER TABLE skills ADD (skill_package_path VARCHAR2(1000))';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'ALTER TABLE skills ADD (env_requirements CLOB DEFAULT ''[]'')';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'ALTER TABLE skills ADD (brain_provider VARCHAR2(50))';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'ALTER TABLE skills ADD (agent_config CLOB)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;
/

-- ── 權限 allow_agent_skill(roles 預設 0、users 可繼承=NULL)──────────────
BEGIN EXECUTE IMMEDIATE 'ALTER TABLE roles ADD (allow_agent_skill NUMBER(1) DEFAULT 0)';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;
/
BEGIN EXECUTE IMMEDIATE 'ALTER TABLE users ADD (allow_agent_skill NUMBER(1))';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1430 THEN RAISE; END IF; END;
/

COMMIT;
-- 驗證:
-- SELECT column_name FROM user_tab_columns WHERE table_name='SKILLS' AND column_name IN ('SKILL_PACKAGE_PATH','ENV_REQUIREMENTS','BRAIN_PROVIDER','AGENT_CONFIG');
-- SELECT column_name FROM user_tab_columns WHERE column_name='ALLOW_AGENT_SKILL';
