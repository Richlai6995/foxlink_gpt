/**
 * Migration 010 — Sprint K · 域內通訊(跨專案 channel)
 *
 * 對齊 spec §10.4 + §13.5
 *
 * 三張新表:
 *   - communication_rooms          跨專案 / 跨組織 room(group / dm)
 *   - comm_room_participants       room 成員(誰可看 + last_read)
 *   - comm_room_messages           訊息流(獨立 schema,鏡像 project_messages)
 *
 * Phase 2 規模:
 *   - Phase 2A:org_group / org_dm 兩種 room_type
 *   - Phase 2B 補:archive room / pin / read receipt
 *   - Phase 2C 補:訊息 KB 寫入(group 可選 · DM 永不寫,spec §10.4.4)
 *
 * 不動 project_messages — 兩個 message 系統獨立(共用 socket.io 推 + UI component)
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/010');

module.exports = async function migrate010(db) {
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
  // 1. communication_rooms — 跨專案 / 跨組織 room
  // ==========================================================================
  await createTable('COMMUNICATION_ROOMS', `
    CREATE TABLE communication_rooms (
      id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      room_type             VARCHAR2(20) NOT NULL,        -- 'org_group' | 'org_dm'
      name                  VARCHAR2(200),                 -- DM 自動命名 'dm:u1:u2'
      description           VARCHAR2(500),
      topic_summary         VARCHAR2(500),
      scope                 VARCHAR2(20) DEFAULT 'cross_org',  -- 'cross_org' | 'cross_project' | 'global'
      scope_owner_id        NUMBER,                        -- BU id 或 NULL(全公司)
      bu_id                 NUMBER,                        -- 主要 BU(group 預設用)
      is_confidential       NUMBER(1) DEFAULT 0,
      is_archived           NUMBER(1) DEFAULT 0,
      archived_at           TIMESTAMP,
      archived_by_user_id   NUMBER,
      created_by_user_id    NUMBER NOT NULL,
      -- DM 用(sorted ascending UNIQUE 避重複建)
      dm_user_a_id          NUMBER,
      dm_user_b_id          NUMBER,
      created_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT uq_comm_dm UNIQUE (dm_user_a_id, dm_user_b_id)
    )
  `);
  await _idx(`CREATE INDEX idx_comm_room_type    ON communication_rooms(room_type, is_archived)`, 'idx_comm_room_type');
  await _idx(`CREATE INDEX idx_comm_room_bu      ON communication_rooms(bu_id, is_archived)`,     'idx_comm_room_bu');
  await _idx(`CREATE INDEX idx_comm_room_creator ON communication_rooms(created_by_user_id)`,     'idx_comm_room_creator');

  // ==========================================================================
  // 2. comm_room_participants — room 成員 + last_read
  // ==========================================================================
  await createTable('COMM_ROOM_PARTICIPANTS', `
    CREATE TABLE comm_room_participants (
      id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      room_id             NUMBER NOT NULL,
      user_id             NUMBER NOT NULL,
      role                VARCHAR2(20) DEFAULT 'member',   -- owner | admin | member | guest
      muted               NUMBER(1) DEFAULT 0,
      last_read_at        TIMESTAMP,
      joined_at           TIMESTAMP DEFAULT SYSTIMESTAMP,
      left_at             TIMESTAMP,
      CONSTRAINT uq_crp UNIQUE (room_id, user_id)
    )
  `);
  await _idx(`CREATE INDEX idx_crp_user    ON comm_room_participants(user_id, left_at)`, 'idx_crp_user');
  await _idx(`CREATE INDEX idx_crp_room    ON comm_room_participants(room_id, left_at)`, 'idx_crp_room');

  // ==========================================================================
  // 3. comm_room_messages — 訊息流(獨立 schema)
  // ==========================================================================
  await createTable('COMM_ROOM_MESSAGES', `
    CREATE TABLE comm_room_messages (
      id                       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      room_id                  NUMBER NOT NULL,
      user_id                  NUMBER NOT NULL,
      content                  CLOB,
      message_type             VARCHAR2(20) DEFAULT 'NORMAL',
      reply_to_message_id      NUMBER,
      is_pinned                NUMBER(1) DEFAULT 0,
      pinned_by                NUMBER,
      pinned_at                TIMESTAMP,
      pin_note                 VARCHAR2(500),
      deleted_at               TIMESTAMP,
      deleted_by               NUMBER,
      deletion_reason          VARCHAR2(500),
      attachment_ids           CLOB,
      content_hash             VARCHAR2(64),
      edited_at                TIMESTAMP,
      edit_count               NUMBER DEFAULT 0,
      created_at               TIMESTAMP DEFAULT SYSTIMESTAMP
    )
  `);
  await _idx(`CREATE INDEX idx_crm_room    ON comm_room_messages(room_id, created_at)`, 'idx_crm_room');
  await _idx(`CREATE INDEX idx_crm_user    ON comm_room_messages(user_id, created_at)`, 'idx_crm_user');
  await _idx(`CREATE INDEX idx_crm_pinned  ON comm_room_messages(room_id, is_pinned)`,  'idx_crm_pinned');

  log.log('010_comm_rooms migration ✓');
};
