/**
 * Migration 006 — project_messages + read receipts
 *
 * 對應 spec §13.1.1(Multi-Channel)+ §13.4(訊息色語言)+ §13.5(DM)
 *
 * 設計決定(2026-05-11 修正):
 *   原設計「reuse ticket_messages」誤判 — Cortex 實際表叫 feedback_messages 且 schema 不適合。
 *   改為新建 project_messages 表,真正符合解耦規則 1(不動 Cortex 既有 schema)。
 *
 * message_type(色語言):
 *   NORMAL       — 一般討論(白)
 *   PROGRESS     — 進度回報(藍)
 *   BLOCKER      — 卡關(紅,自動同步 announcement)
 *   DECISION     — 決議(綠,自動同步 announcement)
 *   AI_INSIGHT   — AI 主動洞察(紫,自動 sync announcement)
 *   SYSTEM       — 系統訊息(灰,如「stage 切換」「member joined」)
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/006');

module.exports = async function migrate006(db) {
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
  // project_messages — 戰情會議室訊息(取代原 ticket_messages 設計)
  // ==========================================================================
  await createTable('PROJECT_MESSAGES', `
    CREATE TABLE project_messages (
      id                       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      channel_id               NUMBER NOT NULL,
      project_id               NUMBER NOT NULL,
      user_id                  NUMBER NOT NULL,
      content                  CLOB,
      message_type             VARCHAR2(20) DEFAULT 'NORMAL',

      -- 回覆 thread
      reply_to_message_id      NUMBER,

      -- Pin
      is_pinned                NUMBER(1) DEFAULT 0,
      pinned_by                NUMBER,
      pinned_at                TIMESTAMP,
      pin_note                 VARCHAR2(500),

      -- 已讀回執旗標(部分訊息要求所有 participant 都看過 — e.g. announcement)
      requires_read_receipt    NUMBER(1) DEFAULT 0,

      -- 公告同步(BLOCKER/DECISION/AI_INSIGHT 自動 sync 進 announcement channel)
      synced_to_announcement   NUMBER(1) DEFAULT 0,
      announcement_msg_id      NUMBER,

      -- 刪除(soft + emergency purge)
      deleted_at               TIMESTAMP,
      deleted_by               NUMBER,
      deletion_mode            VARCHAR2(20),
      deletion_reason          VARCHAR2(500),

      -- 附件
      attachment_ids           CLOB,

      -- 完整性 / 編輯
      content_hash             VARCHAR2(64),
      edited_at                TIMESTAMP,
      edit_count               NUMBER DEFAULT 0,

      created_at               TIMESTAMP DEFAULT SYSTIMESTAMP
    )
  `);
  await _idx(`CREATE INDEX idx_pmsg_channel ON project_messages(channel_id, created_at)`, 'idx_pmsg_channel');
  await _idx(`CREATE INDEX idx_pmsg_project ON project_messages(project_id, created_at)`, 'idx_pmsg_project');
  await _idx(`CREATE INDEX idx_pmsg_user ON project_messages(user_id, created_at)`, 'idx_pmsg_user');
  await _idx(`CREATE INDEX idx_pmsg_pinned ON project_messages(channel_id, is_pinned)`, 'idx_pmsg_pinned');
  await _idx(`CREATE INDEX idx_pmsg_type ON project_messages(project_id, message_type)`, 'idx_pmsg_type');

  // ==========================================================================
  // project_message_read_receipts — 細粒度已讀回執(per-message)
  //
  // 跟 channel_participants.last_read_at 的差別:
  //   - last_read_at:粗粒度,適合算 unread count
  //   - read_receipts:細粒度,適合「這則 announcement 誰看過」
  //
  // 只在 requires_read_receipt=1 的訊息才寫,避免 1:N 寫爆。
  // ==========================================================================
  await createTable('PROJECT_MESSAGE_READ_RECEIPTS', `
    CREATE TABLE project_message_read_receipts (
      id             NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      message_id     NUMBER NOT NULL,
      user_id        NUMBER NOT NULL,
      read_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT uq_pmrr UNIQUE (message_id, user_id)
    )
  `);
  await _idx(`CREATE INDEX idx_pmrr_msg ON project_message_read_receipts(message_id)`, 'idx_pmrr_msg');
  await _idx(`CREATE INDEX idx_pmrr_user ON project_message_read_receipts(user_id)`, 'idx_pmrr_user');

  log.log('006_messages migration ✓');
};
