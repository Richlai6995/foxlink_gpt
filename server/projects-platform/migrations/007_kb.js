/**
 * Migration 007 — KB(Live + 沉澱)雙層 minimal schema
 *
 * 對應 spec §7 / §8
 *
 * Phase 1 minimal:只做 chunk 表 + source_type discriminator
 * Phase 2 補 embedding column(VECTOR 768)+ thesaurus + Title embedding
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/007');

module.exports = async function migrate007(db) {
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
  // project_kb_chunks — Live KB(進行中)+ 沉澱 KB(結案後 fork)共用
  //
  // kind:
  //   chat   — message content
  //   form   — form field value
  //   task   — task title / description
  //   attach — file metadata(content 留空)
  //   case   — 結案後 project 整體快照
  //
  // is_sediment:
  //   0 — Live KB(ACL 跟原 project)
  //   1 — 沉澱 KB(scrub 過 · 跨專案 RAG 召回)
  //
  // Phase 2 加 embedding VECTOR(768) + Oracle Text 索引
  // ==========================================================================
  await createTable('PROJECT_KB_CHUNKS', `
    CREATE TABLE project_kb_chunks (
      id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_id      NUMBER NOT NULL,
      kind            VARCHAR2(20) NOT NULL,
      source_id       NUMBER,
      content         CLOB,
      tags            CLOB,
      is_sediment     NUMBER(1) DEFAULT 0,
      is_confidential NUMBER(1) DEFAULT 0,
      scrubbed        NUMBER(1) DEFAULT 0,
      scrub_note      VARCHAR2(500),
      sediment_from_chunk_id NUMBER,
      created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
      updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP
    )
  `);
  await _idx(`CREATE INDEX idx_kb_chunks_p ON project_kb_chunks(project_id, kind, is_sediment)`, 'idx_kb_chunks_p');
  await _idx(`CREATE INDEX idx_kb_chunks_sed ON project_kb_chunks(is_sediment, created_at)`, 'idx_kb_chunks_sed');

  log.log('007_kb migration ✓');
};
