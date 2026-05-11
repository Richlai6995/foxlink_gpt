/**
 * Migration 004 — Project tasks(RACI + Dependency + Multi-PM)
 *
 * 對應 spec §14(大項/小項 + RACI + Dependency Deadlines)
 *
 * 設計重點:
 *   - parent_task_id:大項 (NULL) / 小項 (有值,1 層深)
 *   - accountable_role:RACI 的 A(誰要負起最終責任 — DPM / BPM / engineering / sourcing / factory…)
 *   - primary_owner_user_id:RACI 的 R(實際執行人)
 *   - collaborator_user_ids:JSON array(額外協辦人)
 *   - depends_on_task_id + relative_deadline_days:依賴式交期(e.g. "QA回覆+1day")
 *   - sub_role 走 project_members.sub_role 不在 task 表
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/004');

module.exports = async function migrate004(db) {
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
  // project_tasks — 任務(EPIC + SUBTASK 1 層深)
  //
  // status:
  //   PENDING          — 還沒開始
  //   IN_PROGRESS      — 進行中
  //   BLOCKED          — 被擋(有 blocker)
  //   READY_FOR_REVIEW — 完成待審
  //   DONE             — 已完成
  //   CANCELLED        — 取消
  // ==========================================================================
  await createTable('PROJECT_TASKS', `
    CREATE TABLE project_tasks (
      id                       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_id               NUMBER NOT NULL,
      parent_task_id           NUMBER,
      stage_id                 NUMBER,

      title                    VARCHAR2(300) NOT NULL,
      description              CLOB,
      task_type                VARCHAR2(20) DEFAULT 'TASK',

      -- RACI
      accountable_role         VARCHAR2(30),
      primary_owner_user_id    NUMBER,
      collaborator_user_ids    CLOB,

      -- 狀態
      status                   VARCHAR2(20) DEFAULT 'PENDING',
      progress_percent         NUMBER DEFAULT 0,

      -- Dependency-based deadline
      depends_on_task_id       NUMBER,
      relative_deadline_days   NUMBER,
      absolute_due_at          TIMESTAMP,
      computed_due_at          TIMESTAMP,

      -- 時間戳
      started_at               TIMESTAMP,
      completed_at             TIMESTAMP,
      cancelled_at             TIMESTAMP,
      blocker_reason           VARCHAR2(500),

      -- 機密旗標(task-level 簡單版,Phase 3 加細欄)
      is_confidential          NUMBER(1) DEFAULT 0,

      -- 文件附件
      attachment_ids           CLOB,

      created_by_user_id       NUMBER NOT NULL,
      created_at               TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at               TIMESTAMP DEFAULT SYSTIMESTAMP,

      CONSTRAINT chk_task_progress CHECK (progress_percent BETWEEN 0 AND 100)
    )
  `);

  await _idx(
    `CREATE INDEX idx_pt_project ON project_tasks(project_id, status)`,
    'idx_pt_project',
  );
  await _idx(
    `CREATE INDEX idx_pt_owner ON project_tasks(primary_owner_user_id, status)`,
    'idx_pt_owner',
  );
  await _idx(
    `CREATE INDEX idx_pt_parent ON project_tasks(parent_task_id)`,
    'idx_pt_parent',
  );
  await _idx(
    `CREATE INDEX idx_pt_dep ON project_tasks(depends_on_task_id)`,
    'idx_pt_dep',
  );
  await _idx(
    `CREATE INDEX idx_pt_due ON project_tasks(computed_due_at, status)`,
    'idx_pt_due',
  );

  log.log('004_tasks migration ✓');
};
