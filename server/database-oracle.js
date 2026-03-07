/**
 * Oracle 23 AI Database Layer
 * Async API mirror of database.js (sql.js wrapper)
 *
 * Compatibility shims built in:
 *   - LIMIT n        → FETCH FIRST n ROWS ONLY
 *   - LIMIT n OFFSET m → OFFSET m ROWS FETCH NEXT n ROWS ONLY
 *   - INSERT auto-RETURNING id → result.lastInsertRowid
 *   - ORA-00001 (unique violation) → re-thrown as 'UNIQUE constraint failed'
 */
require('dotenv').config();
const oracledb = require('oracledb');

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];

let pool = null;

// ─── SQL Normalization ────────────────────────────────────────────────────────

function normalizeSql(sql) {
  // LIMIT n OFFSET m  →  OFFSET m ROWS FETCH NEXT n ROWS ONLY
  sql = sql.replace(/\bLIMIT\s+(\d+)\s+OFFSET\s+(\d+)/gi,
    'OFFSET $2 ROWS FETCH NEXT $1 ROWS ONLY');
  // LIMIT n  →  FETCH FIRST n ROWS ONLY
  sql = sql.replace(/\bLIMIT\s+(\d+)/gi,
    'FETCH FIRST $1 ROWS ONLY');
  // CURRENT_TIMESTAMP is valid in Oracle too — no change needed
  return sql;
}

// Convert SQLite-style ? placeholders → Oracle :1 :2 ...
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `:${++i}`);
}

// Oracle returns column names UPPERCASE — normalise to lowercase
// Also convert Date objects to ISO strings to avoid JSON serialization surprises
function lowercaseKeys(obj) {
  if (!obj) return obj;
  if (Array.isArray(obj)) return obj.map(lowercaseKeys);
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v instanceof Date ? v.toISOString() : v])
  );
}

function normaliseParams(params) {
  const bp = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return bp.map((p) => (p === undefined ? null : p));
}

// Wrap Oracle errors so upstream code keeps working unchanged
function normaliseError(e) {
  if (e.errorNum === 1) {
    // ORA-00001: unique constraint violated
    const err = new Error('UNIQUE constraint failed: ' + (e.message || ''));
    err.originalError = e;
    throw err;
  }
  throw e;
}

// ─── Statement Wrapper ────────────────────────────────────────────────────────
class OracleStatementWrapper {
  constructor(pool, rawSql) {
    this.pool = pool;
    this.rawSql = rawSql;
    // Apply normalization and placeholder conversion once
    this.sql = convertPlaceholders(normalizeSql(rawSql));
  }

  _bindParams(params) {
    const bp = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    return bp.map((p) => {
      if (p === undefined) return null;
      // Strings > 32000 bytes must be bound as CLOB; otherwise Oracle raises ORA-01461.
      // This applies to content / parent_content / any large text column.
      if (typeof p === 'string' && Buffer.byteLength(p, 'utf8') > 32000) {
        return { val: p, type: oracledb.DB_TYPE_CLOB };
      }
      return p;
    });
  }

  /**
   * Execute INSERT / UPDATE / DELETE.
   * For INSERT into tables with GENERATED AS IDENTITY 'id' column,
   * automatically appends RETURNING id INTO :__ret to get lastInsertRowid.
   */
  async run(...params) {
    const bindParams = this._bindParams(params);
    const isInsert = /^\s*INSERT\s+/i.test(this.sql);

    const conn = await this.pool.getConnection();
    try {
      let result;
      if (isInsert) {
        // Try RETURNING id — STRING bind works for both NUMBER and VARCHAR2 PKs
        try {
          const retIdx = bindParams.length + 1;
          const sqlWithRet = `${this.sql} RETURNING id INTO :${retIdx}`;
          const bpWithRet  = [...bindParams, { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 100 }];
          result = await conn.execute(sqlWithRet, bpWithRet, { autoCommit: true });
          const retVal = result.outBinds?.[result.outBinds.length - 1];
          const raw = Array.isArray(retVal) ? retVal[0] : retVal;
          // Coerce to Number for auto-increment tables, keep as-is for UUID tables
          const numeric = raw != null && raw !== '' && !isNaN(Number(raw)) ? Number(raw) : null;
          return {
            lastInsertRowid: numeric ?? raw,
            changes: result.rowsAffected || 0,
          };
        } catch (retErr) {
          // ORA-00904: invalid identifier → table has no 'id' column; run plain
          if (retErr.errorNum !== 904) normaliseError(retErr);
          result = await conn.execute(this.sql, bindParams, { autoCommit: true });
        }
      } else {
        result = await conn.execute(this.sql, bindParams, { autoCommit: true });
      }
      return { lastInsertRowid: null, changes: result.rowsAffected || 0 };
    } catch (e) {
      normaliseError(e);
    } finally {
      await conn.close();
    }
  }

  /** SELECT first row or null */
  async get(...params) {
    const bindParams = this._bindParams(params);
    const conn = await this.pool.getConnection();
    try {
      const result = await conn.execute(this.sql, bindParams,
        { maxRows: 1, outFormat: oracledb.OUT_FORMAT_OBJECT });
      return lowercaseKeys(result.rows?.[0] ?? null);
    } catch (e) {
      normaliseError(e);
    } finally {
      await conn.close();
    }
  }

  /** SELECT all rows */
  async all(...params) {
    const bindParams = this._bindParams(params);
    const conn = await this.pool.getConnection();
    try {
      const result = await conn.execute(this.sql, bindParams,
        { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return lowercaseKeys(result.rows ?? []);
    } catch (e) {
      normaliseError(e);
    } finally {
      await conn.close();
    }
  }
}

// ─── Database Wrapper ─────────────────────────────────────────────────────────
class OracleDatabaseWrapper {
  constructor(pool) {
    this.pool = pool;
  }

  prepare(sql) {
    return new OracleStatementWrapper(this.pool, sql);
  }

  /** Execute raw SQL block(s), split by semicolons */
  async exec(sql) {
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
    const conn = await this.pool.getConnection();
    try {
      for (const stmt of statements) {
        await conn.execute(normalizeSql(stmt), [], { autoCommit: true });
      }
    } finally {
      await conn.close();
    }
  }

  /** DDL exec — silently ignore ORA-00955/1408 (already exists) */
  async execDDL(sql) {
    const conn = await this.pool.getConnection();
    try {
      await conn.execute(sql, [], { autoCommit: true });
    } catch (e) {
      if (e.errorNum === 955 || e.errorNum === 1408 || e.errorNum === 1430) return;
      throw e;
    } finally {
      await conn.close();
    }
  }

  async query(sql, params = [])    { return this.prepare(sql).all(...params); }
  async queryOne(sql, params = []) { return this.prepare(sql).get(...params); }

  async columnExists(table, column) {
    const row = await this.queryOne(
      `SELECT COUNT(*) AS cnt FROM user_tab_columns
       WHERE UPPER(table_name)=UPPER(?) AND UPPER(column_name)=UPPER(?)`,
      [table, column]
    );
    return (row?.cnt ?? 0) > 0;
  }

  async tableExists(table) {
    const row = await this.queryOne(
      `SELECT COUNT(*) AS cnt FROM user_tables WHERE UPPER(table_name)=UPPER(?)`,
      [table]
    );
    return (row?.cnt ?? 0) > 0;
  }
}

// ─── Pool Init ────────────────────────────────────────────────────────────────
async function initializeOracleDB() {
  if (pool) return new OracleDatabaseWrapper(pool);

  const oracleHome = process.env.ORACLE_HOME;
  if (oracleHome) {
    try {
      oracledb.initOracleClient({ libDir: oracleHome });
      console.log('[Oracle] Thick mode, libDir:', oracleHome);
    } catch (e) {
      if (!e.message?.includes('already been called'))
        console.warn('[Oracle] initOracleClient:', e.message);
    }
  }

  const connectString =
    process.env.SYSTEM_DB_CONNECT_STRING ||
    `${process.env.SYSTEM_DB_HOST}:${process.env.SYSTEM_DB_PORT}/${process.env.SYSTEM_DB_SERVICE_NAME}`;

  pool = await oracledb.createPool({
    user:          process.env.SYSTEM_DB_USER,
    password:      process.env.SYSTEM_DB_USER_PASSWORD,
    connectString,
    poolMin:       2,
    poolMax:       10,
    poolIncrement: 2,
    poolTimeout:   60,
  });

  console.log('[Oracle] Pool created →', connectString);
  return new OracleDatabaseWrapper(pool);
}

// ─── Ensure default admin user exists ────────────────────────────────────────
async function ensureDefaultAdmin(db) {
  const account  = (process.env.DEFAULT_ADMIN_ACCOUNT  || 'admin').toUpperCase();
  const password = process.env.DEFAULT_ADMIN_PASSWORD  || '123456';
  try {
    const existing = await db.prepare('SELECT id FROM users WHERE UPPER(username)=?').get(account);
    if (!existing) {
      await db.prepare(
        `INSERT INTO users (username, password, name, role, status, creation_method)
         VALUES (?,?,?,'admin','active','manual')`
      ).run(account, password, account);
      console.log(`[Oracle] Default admin '${account}' created`);
    } else {
      // Reset password to env value on every startup so it's always recoverable
      await db.prepare(`UPDATE users SET password=?, role='admin', status='active' WHERE UPPER(username)=?`)
        .run(password, account);
    }
  } catch (e) {
    console.error('[Oracle] ensureDefaultAdmin error:', e.message);
  }
}

// ─── Runtime Schema Migrations ────────────────────────────────────────────────
async function runMigrations(db) {
  const addCol = async (table, column, definition) => {
    try {
      const exists = await db.columnExists(table, column);
      if (!exists) {
        await db.prepare(`ALTER TABLE ${table} ADD ${column} ${definition}`).run();
        console.log(`[Migration] Added ${table}.${column}`);
      }
    } catch (e) {
      console.warn(`[Migration] ${table}.${column}: ${e.message}`);
    }
  };

  // kb_documents missing chunk_count
  await addCol('KB_DOCUMENTS', 'CHUNK_COUNT', 'NUMBER DEFAULT 0');
  // kb_chunks missing parent_content
  await addCol('KB_CHUNKS', 'PARENT_CONTENT', 'CLOB');
  // kb_chunks.embedding: Oracle 23ai does not support MODIFY on VECTOR columns.
  // Detect if embedding is still fixed-dim (VECTOR(768,*)) by checking vector_precision in data dict.
  // If so: drop and re-add as VECTOR(*, FLOAT32) (safe only when table is empty).
  try {
    const conn = await pool.getConnection();
    try {
      // Check if embedding column has a fixed dimension (indicated by data_length != 0 or check user_tab_cols)
      const dimRow = await conn.execute(
        `SELECT vector_dimensions FROM user_tab_columns WHERE table_name='KB_CHUNKS' AND column_name='EMBEDDING'`,
        [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const dim = dimRow.rows?.[0]?.VECTOR_DIMENSIONS;
      // null or 0 means wildcard; non-null fixed dim means we need to migrate
      if (dim != null && dim !== 0) {
        // Only safe to drop+add when table is empty
        const cntRow = await conn.execute(`SELECT COUNT(*) AS CNT FROM KB_CHUNKS`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const cnt = cntRow.rows?.[0]?.CNT ?? 1;
        if (cnt === 0) {
          await conn.execute(`DROP INDEX kb_chunks_vidx`, [], { autoCommit: true }).catch(() => {});
          await conn.execute(`ALTER TABLE KB_CHUNKS DROP COLUMN EMBEDDING`, [], { autoCommit: true });
          await conn.execute(`ALTER TABLE KB_CHUNKS ADD EMBEDDING VECTOR(*, FLOAT32)`, [], { autoCommit: true });
          await conn.execute(
            `CREATE VECTOR INDEX kb_chunks_vidx ON kb_chunks(embedding) ORGANIZATION NEIGHBOR PARTITIONS WITH DISTANCE COSINE WITH TARGET ACCURACY 90`,
            [], { autoCommit: true }
          ).catch(() => {});
          console.log('[Migration] Rebuilt KB_CHUNKS.EMBEDDING as VECTOR(*, FLOAT32)');
        } else {
          console.warn('[Migration] KB_CHUNKS.EMBEDDING is fixed-dim but table has data — manual migration needed');
        }
      }
    } catch (e) {
      console.warn('[Migration] KB_CHUNKS.EMBEDDING check:', e.message);
    } finally {
      await conn.close();
    }
  } catch (e) {
    console.warn('[Migration] KB_CHUNKS.EMBEDDING pool error:', e.message);
  }
  // llm_models image_output flag (for gemini-*-image-preview models)
  await addCol('LLM_MODELS', 'IMAGE_OUTPUT', 'NUMBER(1) DEFAULT 0');
  // kb_access permission level (use = chat-only, edit = can edit + visible in marketplace)
  await addCol('KB_ACCESS', 'PERMISSION', "VARCHAR2(10) DEFAULT 'use'");

  // knowledge_bases stats columns (in case old deployment missing them)
  await addCol('KNOWLEDGE_BASES', 'DOC_COUNT',        'NUMBER DEFAULT 0');
  await addCol('KNOWLEDGE_BASES', 'CHUNK_COUNT',       'NUMBER DEFAULT 0');
  await addCol('KNOWLEDGE_BASES', 'TOTAL_SIZE_BYTES',  'NUMBER DEFAULT 0');
  await addCol('KNOWLEDGE_BASES', 'TOP_K_FETCH',       'NUMBER DEFAULT 20');
  await addCol('KNOWLEDGE_BASES', 'TOP_K_RETURN',      'NUMBER DEFAULT 5');
  await addCol('KNOWLEDGE_BASES', 'SCORE_THRESHOLD',   'NUMBER DEFAULT 0');
  await addCol('KNOWLEDGE_BASES', 'OCR_MODEL',          "VARCHAR2(100)");
  await addCol('KNOWLEDGE_BASES', 'PARSE_MODE',         "VARCHAR2(20) DEFAULT 'text_only'");
  await addCol('KB_DOCUMENTS',    'PARSE_MODE',         "VARCHAR2(20)");

  // ── Deep Research ──────────────────────────────────────────────────────────
  await addCol('USERS',  'CAN_DEEP_RESEARCH', 'NUMBER(1)');
  await addCol('ROLES',  'CAN_DEEP_RESEARCH', 'NUMBER(1) DEFAULT 1');

  // ── LLM Models — multi-provider (Gemini + Azure OpenAI) ────────────────────
  await addCol('LLM_MODELS', 'PROVIDER_TYPE',    "VARCHAR2(20) DEFAULT 'gemini'");
  await addCol('LLM_MODELS', 'API_KEY_ENC',       'VARCHAR2(600)');
  await addCol('LLM_MODELS', 'ENDPOINT_URL',      'VARCHAR2(1000)');
  await addCol('LLM_MODELS', 'API_VERSION',       'VARCHAR2(50)');
  await addCol('LLM_MODELS', 'DEPLOYMENT_NAME',   'VARCHAR2(200)');
  await addCol('LLM_MODELS', 'BASE_MODEL',        'VARCHAR2(100)');

  const createTable = async (name, ddl) => {
    try {
      const exists = await db.tableExists(name);
      if (!exists) {
        await db.prepare(ddl).run();
        console.log(`[Migration] Created table ${name}`);
      }
    } catch (e) {
      console.warn(`[Migration] createTable ${name}: ${e.message}`);
    }
  };

  // ── External API Keys ──────────────────────────────────────────────────────
  await createTable('API_KEYS', `CREATE TABLE api_keys (
    id              VARCHAR2(36)  PRIMARY KEY,
    name            VARCHAR2(200) NOT NULL,
    key_hash        VARCHAR2(64)  NOT NULL,
    key_prefix      VARCHAR2(20),
    description     CLOB,
    accessible_kbs  CLOB DEFAULT '["*"]',
    is_active       NUMBER(1)     DEFAULT 1,
    last_used_at    TIMESTAMP,
    expires_at      TIMESTAMP,
    created_by      NUMBER        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMP     DEFAULT SYSTIMESTAMP,
    CONSTRAINT api_keys_hash_uk UNIQUE (key_hash)
  )`);
  // Ensure columns exist for tables created by older schema versions
  await addCol('API_KEYS', 'KEY_PREFIX',    'VARCHAR2(20)');
  await addCol('API_KEYS', 'ACCESSIBLE_KBS','CLOB DEFAULT \'["*"]\'');
  await addCol('API_KEYS', 'DESCRIPTION',   'CLOB');
  await addCol('API_KEYS', 'IS_ACTIVE',     'NUMBER(1) DEFAULT 1');
  await addCol('API_KEYS', 'LAST_USED_AT',  'TIMESTAMP');
  await addCol('API_KEYS', 'EXPIRES_AT',    'TIMESTAMP');

  await createTable('RESEARCH_JOBS', `CREATE TABLE research_jobs (
    id             VARCHAR2(36)  PRIMARY KEY,
    user_id        NUMBER        NOT NULL,
    session_id     VARCHAR2(36),
    title          VARCHAR2(500),
    question       CLOB,
    plan_json      CLOB,
    status         VARCHAR2(20)  DEFAULT 'pending',
    progress_step  NUMBER        DEFAULT 0,
    progress_total NUMBER        DEFAULT 0,
    progress_label VARCHAR2(300),
    use_web_search NUMBER(1)     DEFAULT 0,
    output_formats VARCHAR2(200) DEFAULT 'docx',
    result_summary CLOB,
    result_files_json CLOB,
    error_msg      VARCHAR2(1000),
    is_notified    NUMBER(1)     DEFAULT 0,
    created_at     TIMESTAMP     DEFAULT SYSTIMESTAMP,
    updated_at     TIMESTAMP     DEFAULT SYSTIMESTAMP,
    completed_at   TIMESTAMP
  )`);

  // ── AI 戰情 ─────────────────────────────────────────────────────────────────
  await addCol('USERS', 'CAN_DESIGN_AI_SELECT', 'NUMBER(1) DEFAULT 0');
  await addCol('USERS', 'CAN_USE_AI_DASHBOARD',  'NUMBER(1) DEFAULT 0');

  await createTable('AI_SCHEMA_DEFINITIONS', `CREATE TABLE ai_schema_definitions (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name    VARCHAR2(200) NOT NULL,
    display_name  VARCHAR2(200),
    db_connection VARCHAR2(20) DEFAULT 'erp',
    business_notes CLOB,
    join_hints     CLOB,
    is_active      NUMBER(1) DEFAULT 1,
    created_by     NUMBER,
    updated_at     TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await createTable('AI_SCHEMA_COLUMNS', `CREATE TABLE ai_schema_columns (
    id               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    schema_id        NUMBER REFERENCES ai_schema_definitions(id) ON DELETE CASCADE,
    column_name      VARCHAR2(100) NOT NULL,
    data_type        VARCHAR2(50),
    description      VARCHAR2(500),
    is_vectorized    NUMBER(1) DEFAULT 0,
    value_mapping    CLOB,
    sample_values    CLOB,
    vector_table_ref VARCHAR2(100)
  )`);

  await createTable('AI_SELECT_TOPICS', `CREATE TABLE ai_select_topics (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR2(100) NOT NULL,
    description VARCHAR2(500),
    icon        VARCHAR2(50),
    sort_order  NUMBER DEFAULT 0,
    is_active   NUMBER(1) DEFAULT 1,
    created_by  NUMBER,
    created_at  TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await createTable('AI_SELECT_DESIGNS', `CREATE TABLE ai_select_designs (
    id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    topic_id              NUMBER REFERENCES ai_select_topics(id) ON DELETE CASCADE,
    name                  VARCHAR2(100) NOT NULL,
    description           VARCHAR2(500),
    target_schema_ids     CLOB,
    vector_search_enabled NUMBER(1) DEFAULT 0,
    system_prompt         CLOB,
    few_shot_examples     CLOB,
    chart_config          CLOB,
    cache_ttl_minutes     NUMBER DEFAULT 30,
    is_public             NUMBER(1) DEFAULT 0,
    created_by            NUMBER,
    updated_at            TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await createTable('AI_ETL_JOBS', `CREATE TABLE ai_etl_jobs (
    id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                VARCHAR2(100) NOT NULL,
    source_sql          CLOB NOT NULL,
    source_connection   VARCHAR2(20) DEFAULT 'erp',
    vectorize_fields    CLOB,
    metadata_fields     CLOB,
    embedding_dimension NUMBER DEFAULT 768,
    vector_table        VARCHAR2(100) DEFAULT 'AI_VECTOR_STORE',
    cron_expression     VARCHAR2(50),
    is_incremental      NUMBER(1) DEFAULT 1,
    last_run_at         TIMESTAMP,
    status              VARCHAR2(20) DEFAULT 'active',
    created_by          NUMBER,
    created_at          TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await createTable('AI_ETL_RUN_LOGS', `CREATE TABLE ai_etl_run_logs (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id          NUMBER REFERENCES ai_etl_jobs(id) ON DELETE CASCADE,
    started_at      TIMESTAMP,
    finished_at     TIMESTAMP,
    rows_fetched    NUMBER DEFAULT 0,
    rows_vectorized NUMBER DEFAULT 0,
    error_message   CLOB,
    status          VARCHAR2(20)
  )`);

  await createTable('AI_VECTOR_STORE', `CREATE TABLE ai_vector_store (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    etl_job_id   NUMBER REFERENCES ai_etl_jobs(id) ON DELETE CASCADE,
    source_table VARCHAR2(100),
    source_pk    VARCHAR2(500),
    field_name   VARCHAR2(100),
    field_value  CLOB,
    metadata     CLOB,
    embedding    VECTOR(*, FLOAT32),
    created_at   TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // Vector index for AI_VECTOR_STORE (Oracle 23 AI)
  try {
    const idxRow = await db.queryOne(
      `SELECT COUNT(*) AS cnt FROM user_indexes WHERE UPPER(index_name)='AI_VECTOR_STORE_VIDX'`
    );
    if (!idxRow?.cnt || Number(idxRow.cnt) === 0) {
      await db.execDDL(
        `CREATE VECTOR INDEX ai_vector_store_vidx ON ai_vector_store(embedding)
         ORGANIZATION NEIGHBOR PARTITIONS WITH DISTANCE COSINE WITH TARGET ACCURACY 90`
      );
      console.log('[Migration] Created ai_vector_store vector index');
    }
  } catch (e) {
    console.warn('[Migration] ai_vector_store vector index:', e.message);
  }

  await createTable('AI_QUERY_CACHE', `CREATE TABLE ai_query_cache (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    design_id     NUMBER REFERENCES ai_select_designs(id) ON DELETE CASCADE,
    question_hash VARCHAR2(64) NOT NULL,
    generated_sql CLOB,
    result_json   CLOB,
    row_count     NUMBER,
    created_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
    expires_at    TIMESTAMP,
    CONSTRAINT ai_query_cache_uq UNIQUE (design_id, question_hash)
  )`);
}

// ─── Exports (same shape as database.js) ─────────────────────────────────────
const oracleDbExports = {
  db: null,
  init: async () => {
    const wrapper = await initializeOracleDB();
    oracleDbExports.db = wrapper;
    await ensureDefaultAdmin(wrapper);
    await runMigrations(wrapper);
    return wrapper;
  },
  close: async () => {
    if (pool) { await pool.close(10); pool = null; oracleDbExports.db = null; }
  },
  getPool: () => pool,
};

module.exports = oracleDbExports;
