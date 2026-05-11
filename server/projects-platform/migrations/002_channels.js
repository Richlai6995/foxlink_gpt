/**
 * Migration 002 — Channels schema
 *
 * 對應 spec §13.1(Multi-Channel 戰情會議室)+ §13.5(DM)
 *
 * 規則:
 *   ✅ 全新表用 project_* 前綴
 *   ✅ idempotent — 可重跑
 *   ✅ ticket_messages 的 channel-related columns 已在 001 ALTER
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/002');

module.exports = async function migrate002(db) {
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
  // project_channels — 戰情會議室頻道(對齊 spec §13.1.2)
  //
  // channel_type:
  //   announcement — 唯讀公告(只 PM/owner 能發 + AI Pin)
  //   general      — 預設討論
  //   group        — QUOTE plugin 預設 5 個 group(qa-customer / engineering / sourcing / factory / cost-review)
  //   topic        — 動態子議題(臨時拉的群)
  //   dm           — 1:1 私聊(2 人)
  // ==========================================================================
  await createTable('PROJECT_CHANNELS', `
    CREATE TABLE project_channels (
      id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_id        NUMBER NOT NULL,
      name              VARCHAR2(60) NOT NULL,
      channel_type      VARCHAR2(20) NOT NULL,
      is_default        NUMBER(1) DEFAULT 0,
      visibility        VARCHAR2(20) DEFAULT 'project',
      topic_summary     VARCHAR2(500),
      is_archived       NUMBER(1) DEFAULT 0,
      archived_at       TIMESTAMP,
      created_by        NUMBER NOT NULL,
      created_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT uq_channel_name UNIQUE (project_id, name)
    )
  `);
  await _idx(`CREATE INDEX idx_pc_project ON project_channels(project_id, is_archived)`, 'idx_pc_project');
  await _idx(`CREATE INDEX idx_pc_type ON project_channels(project_id, channel_type)`, 'idx_pc_type');

  // ==========================================================================
  // channel_participants — 頻道成員(對齊 spec §13.1.3)
  //
  // role:
  //   owner   — 頻道擁有者(可改設定 / 刪頻道)
  //   admin   — 可邀人 / 踢人
  //   member  — 一般成員
  //   guest   — chat_guest 模式(臨時拉進來,no expiry — 對齊 user 確認)
  // ==========================================================================
  await createTable('CHANNEL_PARTICIPANTS', `
    CREATE TABLE channel_participants (
      id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      channel_id        NUMBER NOT NULL,
      user_id           NUMBER NOT NULL,
      role              VARCHAR2(20) DEFAULT 'member',
      muted             NUMBER(1) DEFAULT 0,
      last_read_at      TIMESTAMP,
      joined_at         TIMESTAMP DEFAULT SYSTIMESTAMP,
      left_at           TIMESTAMP,
      CONSTRAINT uq_cp UNIQUE (channel_id, user_id)
    )
  `);
  await _idx(`CREATE INDEX idx_cp_user ON channel_participants(user_id, left_at)`, 'idx_cp_user');
  await _idx(`CREATE INDEX idx_cp_channel ON channel_participants(channel_id, left_at)`, 'idx_cp_channel');

  log.log('002_channels migration ✓');
};
