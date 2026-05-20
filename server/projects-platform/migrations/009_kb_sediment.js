/**
 * Migration 009 — KB Sediment production schema
 *
 * 對應 spec §7-8 + Sprint J(Phase 2)
 *
 * 新增:
 *   - project_kb_chunks.embedding         VECTOR(768, FLOAT32)
 *   - project_kb_chunks.title             VARCHAR2(500)        — chunk 簡易標題,給 multi-vector / 顯示用
 *   - project_kb_chunks.title_embedding   VECTOR(768, FLOAT32) — Title boost(spec §7.9.3)
 *   - project_kb_chunks.embedding_model   VARCHAR2(100)        — 標記哪個 model 算的
 *   - project_kb_chunks.embedded_at       TIMESTAMP            — 算 embedding 時間
 *   - project_kb_chunks.scrub_map_json    CLOB                 — 沉澱時記下 scrub 對應(audit)
 *
 * 新表:
 *   - project_kb_sediment_audit — 嚴格 audit trail(誰 fork、何時、scrub 哪幾欄、admin override)
 *
 * 索引:
 *   - VECTOR INDEX(IVF / HNSW)— content embedding
 *   - VECTOR INDEX — title_embedding
 *   - Oracle Text INDEX on content
 *
 * 注意:Oracle 23 AI 才支援 VECTOR — 失敗時 graceful skip。
 */

const { makeLogger } = require('../services/logger');
const log = makeLogger('migrations/009');

module.exports = async function migrate009(db) {
  const addCol = async (tableName, colName, ddl) => {
    try {
      const r = await db.prepare(
        `SELECT column_name FROM user_tab_columns
          WHERE table_name = UPPER(?) AND column_name = UPPER(?)`,
      ).get(tableName, colName);
      if (r) return false;
      await db.prepare(`ALTER TABLE ${tableName} ADD ${colName} ${ddl}`).run();
      log.log(`added column ${tableName}.${colName}`);
      return true;
    } catch (e) {
      if (/already exists|ORA-01430|ORA-02260/.test(e.message)) return false;
      log.warn(`addCol ${tableName}.${colName}: ${e.message}`);
      return false;
    }
  };

  const _idx = async (sql, name) => {
    try {
      await db.prepare(sql).run();
      log.log(`created index ${name}`);
    } catch (e) {
      if (!/already used|already exists|ORA-00955|ORA-01408|ORA-29879/.test(e.message)) {
        log.warn(`index ${name}: ${e.message}`);
      }
    }
  };

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

  // ==========================================================================
  // 1. project_kb_chunks 擴欄
  // ==========================================================================
  await addCol('PROJECT_KB_CHUNKS', 'TITLE',           'VARCHAR2(500)');
  await addCol('PROJECT_KB_CHUNKS', 'EMBEDDING',       'VECTOR(768, FLOAT32)');
  await addCol('PROJECT_KB_CHUNKS', 'TITLE_EMBEDDING', 'VECTOR(768, FLOAT32)');
  await addCol('PROJECT_KB_CHUNKS', 'EMBEDDING_MODEL', 'VARCHAR2(100)');
  await addCol('PROJECT_KB_CHUNKS', 'EMBEDDED_AT',     'TIMESTAMP');
  await addCol('PROJECT_KB_CHUNKS', 'SCRUB_MAP_JSON',  'CLOB');

  // ==========================================================================
  // 2. project_kb_sediment_audit — 嚴格 audit trail
  // ==========================================================================
  await createTable('PROJECT_KB_SEDIMENT_AUDIT', `
    CREATE TABLE project_kb_sediment_audit (
      id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_id        NUMBER NOT NULL,
      action            VARCHAR2(40) NOT NULL,       -- fork | re_fork | embed | scrub_override
      actor_user_id     NUMBER,
      chunks_total      NUMBER DEFAULT 0,
      chunks_copied     NUMBER DEFAULT 0,
      chunks_scrubbed   NUMBER DEFAULT 0,
      scrub_map_json    CLOB,
      embed_model       VARCHAR2(100),
      embed_count       NUMBER DEFAULT 0,
      duration_ms       NUMBER,
      notes             CLOB,
      error_log         CLOB,
      created_at        TIMESTAMP DEFAULT SYSTIMESTAMP
    )
  `);
  await _idx(`CREATE INDEX idx_kbsa_project ON project_kb_sediment_audit(project_id, action, created_at)`, 'idx_kbsa_project');

  // ==========================================================================
  // 3. Vector index(Oracle 23 AI)— graceful skip if unsupported
  // ==========================================================================
  await _idx(
    `CREATE VECTOR INDEX pkb_chunks_vidx ON project_kb_chunks(embedding)
       ORGANIZATION NEIGHBOR PARTITIONS
       WITH DISTANCE COSINE WITH TARGET ACCURACY 90`,
    'pkb_chunks_vidx',
  );
  await _idx(
    `CREATE VECTOR INDEX pkb_chunks_titlevidx ON project_kb_chunks(title_embedding)
       ORGANIZATION NEIGHBOR PARTITIONS
       WITH DISTANCE COSINE WITH TARGET ACCURACY 90`,
    'pkb_chunks_titlevidx',
  );

  // ==========================================================================
  // 4. Oracle Text index on content(BM25 / full-text)
  //    SYNC ON COMMIT — 同步寫入時 sync(避免 SYNC EVERY 在某些 Oracle 版本標 FAILED)
  //    若仍掛掉:落 LIKE fallback,不影響 vector search
  // ==========================================================================
  await _idx(
    `CREATE INDEX pkb_chunks_ftx ON project_kb_chunks(content)
       INDEXTYPE IS CTXSYS.CONTEXT
       PARAMETERS ('SYNC (ON COMMIT)')`,
    'pkb_chunks_ftx',
  );

  log.log('009_kb_sediment migration ✓');
};
