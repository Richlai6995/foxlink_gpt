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
  // LIMIT ?  →  FETCH FIRST ? ROWS ONLY (bind param)
  sql = sql.replace(/\bLIMIT\s+\?/gi, 'FETCH FIRST ? ROWS ONLY');
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
          // ORA-22848: cannot use CLOB type with RETURNING clause; run plain
          if (retErr.errorNum !== 904 && retErr.errorNum !== 22848) normaliseError(retErr);
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
    poolAlias:     'system_db',   // 明確命名，避免與 ERP pool alias 衝突
    user:          process.env.SYSTEM_DB_USER,
    password:      process.env.SYSTEM_DB_USER_PASSWORD,
    connectString,
    poolMin:          5,
    poolMax:          25,
    poolIncrement:    5,
    poolTimeout:      60,
    poolPingInterval: 60,
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
  // Drop kb_chunks_vidx: global vector index can't handle mixed embedding dimensions (768 vs 3072).
  // KB searches use VECTOR_DISTANCE() with partition pruning (kb_id filter), so brute-force is fine.
  try {
    const conn2 = await pool.getConnection();
    try {
      await conn2.execute(`DROP INDEX kb_chunks_vidx`, [], { autoCommit: true });
      console.log('[Migration] Dropped kb_chunks_vidx (mixed-dimension KBs require brute-force scan)');
    } catch (e) {
      if (!e.message.includes('ORA-01418')) // ORA-01418 = index does not exist, ignore
        console.warn('[Migration] kb_chunks_vidx drop:', e.message);
    } finally {
      await conn2.close();
    }
  } catch (e) {
    console.warn('[Migration] kb_chunks_vidx drop pool error:', e.message);
  }

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

  // ── Chat session multilingual titles ───────────────────────────────────────
  await addCol('CHAT_SESSIONS', 'TITLE_ZH', 'VARCHAR2(200)');
  await addCol('CHAT_SESSIONS', 'TITLE_EN', 'VARCHAR2(200)');
  await addCol('CHAT_SESSIONS', 'TITLE_VI', 'VARCHAR2(200)');

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
  // OCI provider + model role
  await addCol('LLM_MODELS', 'MODEL_ROLE',        "VARCHAR2(20) DEFAULT 'chat'");
  await addCol('LLM_MODELS', 'EXTRA_CONFIG_ENC',  'CLOB');

  // AI Schema Source 擴充欄位
  await addCol('AI_SCHEMA_DEFINITIONS', 'ALIAS',            "VARCHAR2(50)");
  await addCol('AI_SCHEMA_DEFINITIONS', 'SOURCE_TYPE',      "VARCHAR2(20) DEFAULT 'table'");
  await addCol('AI_SCHEMA_DEFINITIONS', 'SOURCE_SQL',       'CLOB');
  await addCol('AI_SCHEMA_DEFINITIONS', 'BASE_CONDITIONS',  'CLOB');  // JSON [{col,op,val}]
  await addCol('AI_SCHEMA_DEFINITIONS', 'VECTOR_ETL_JOB_ID', 'NUMBER');
  // 多語系顯示名稱
  await addCol('AI_SCHEMA_DEFINITIONS', 'DISPLAY_NAME_EN', 'VARCHAR2(200)');
  await addCol('AI_SCHEMA_DEFINITIONS', 'DISPLAY_NAME_VI', 'VARCHAR2(200)');
  // Schema 欄位可見性（0=隱藏，不出現在 field picker）
  await addCol('AI_SCHEMA_COLUMNS', 'IS_VISIBLE', 'NUMBER(1) DEFAULT 1');

  // AI Select Design 加入 join 選擇
  await addCol('AI_SELECT_DESIGNS', 'TARGET_JOIN_IDS', 'CLOB');
  // WHERE-only schema IDs（這些 schema 只用於 WHERE 篩選，不出現在 field 選擇器）
  await addCol('AI_SELECT_DESIGNS', 'SCHEMA_WHERE_ONLY_IDS', 'CLOB');

  // ── AI ETL Jobs 擴充 ────────────────────────────────────────────────────────
  await addCol('AI_ETL_JOBS', 'JOB_TYPE',       "VARCHAR2(20) DEFAULT 'vector'");
  await addCol('AI_ETL_JOBS', 'TARGET_TABLE',    'VARCHAR2(200)');
  await addCol('AI_ETL_JOBS', 'TARGET_MODE',     "VARCHAR2(20) DEFAULT 'truncate_insert'");
  await addCol('AI_ETL_JOBS', 'UPSERT_KEY',      'VARCHAR2(500)');
  await addCol('AI_ETL_JOBS', 'DELETE_SQL',      'CLOB');
  await addCol('AI_ETL_JOBS', 'SCHEDULE_TYPE',   "VARCHAR2(20) DEFAULT 'cron'");
  await addCol('AI_ETL_JOBS', 'SCHEDULE_CONFIG', 'CLOB');
  await addCol('AI_ETL_RUN_LOGS', 'ROWS_INSERTED', 'NUMBER DEFAULT 0');
  await addCol('AI_ETL_RUN_LOGS', 'ROWS_UPDATED',  'NUMBER DEFAULT 0');

  // MCP Server response mode (inject = feed tool result to LLM, answer = return raw result directly)
  await addCol('MCP_SERVERS', 'RESPONSE_MODE', "VARCHAR2(10) DEFAULT 'inject'");

  // AI Report Dashboard auto-refresh interval (minutes, null = manual)
  await addCol('AI_REPORT_DASHBOARDS', 'AUTO_REFRESH_INTERVAL', 'NUMBER DEFAULT NULL');
  await addCol('AI_REPORT_DASHBOARDS', 'NAME_EN', 'VARCHAR2(200)');
  await addCol('AI_REPORT_DASHBOARDS', 'NAME_VI', 'VARCHAR2(200)');
  await addCol('AI_REPORT_DASHBOARDS', 'DESCRIPTION_EN', 'VARCHAR2(2000)');
  await addCol('AI_REPORT_DASHBOARDS', 'DESCRIPTION_VI', 'VARCHAR2(2000)');
  await addCol('AI_REPORT_DASHBOARDS', 'CATEGORY_EN', 'VARCHAR2(200)');
  await addCol('AI_REPORT_DASHBOARDS', 'CATEGORY_VI', 'VARCHAR2(200)');
  await addCol('AI_REPORT_DASHBOARDS', 'BG_COLOR', 'VARCHAR2(20)');
  await addCol('AI_REPORT_DASHBOARDS', 'BG_IMAGE_URL', 'VARCHAR2(500)');
  await addCol('AI_REPORT_DASHBOARDS', 'BG_OPACITY', 'NUMBER(4,2) DEFAULT 1');
  await addCol('AI_REPORT_DASHBOARDS', 'GLOBAL_FILTERS_SCHEMA', 'CLOB');
  await addCol('AI_REPORT_DASHBOARDS', 'BOOKMARKS', 'CLOB');
  await addCol('AI_REPORT_DASHBOARDS', 'TOOLBAR_BG_COLOR', 'VARCHAR2(20)');
  await addCol('AI_REPORT_DASHBOARDS', 'TOOLBAR_TEXT_COLOR', 'VARCHAR2(20)');
  await addCol('AI_REPORT_DASHBOARDS', 'LOGO_URL',    'VARCHAR2(500)');
  await addCol('AI_REPORT_DASHBOARDS', 'LOGO_HEIGHT', 'NUMBER DEFAULT 28');

  // AI Saved Queries multilingual names
  await addCol('AI_SAVED_QUERIES', 'NAME_EN', 'VARCHAR2(400)');
  await addCol('AI_SAVED_QUERIES', 'NAME_VI', 'VARCHAR2(400)');

  // ── token_usage model normalization (one-time data fix) ────────────────────
  // Merge rows stored with raw API model IDs (e.g. 'gemini-3-pro-preview') or
  // display names (e.g. 'Gemini 3 Pro') into the canonical llm_models.key.
  try {
    const badRows = await db.prepare(
      `SELECT tu.id, tu.user_id, tu.usage_date, tu.model,
              tu.input_tokens, tu.output_tokens, tu.image_count, tu.cost, tu.currency,
              lm.key AS canonical_key
       FROM token_usage tu
       JOIN llm_models lm ON (LOWER(lm.api_model)=LOWER(tu.model) OR LOWER(lm.name)=LOWER(tu.model))
       WHERE tu.model <> lm.key AND lm.is_active=1`
    ).all();
    for (const row of badRows) {
      // Try to merge into existing canonical row
      const D = `TO_DATE(?, 'YYYY-MM-DD')`;
      const dateStr = typeof row.usage_date === 'string'
        ? row.usage_date.slice(0, 10)
        : new Date(row.usage_date).toISOString().slice(0, 10);
      const canonical = await db.prepare(
        `SELECT id FROM token_usage WHERE user_id=? AND usage_date=${D} AND model=?`
      ).get(row.user_id, dateStr, row.canonical_key);
      if (canonical) {
        await db.prepare(
          `UPDATE token_usage SET
             input_tokens=input_tokens+?, output_tokens=output_tokens+?,
             image_count=COALESCE(image_count,0)+?,
             cost=CASE WHEN ? IS NOT NULL THEN COALESCE(cost,0)+? ELSE cost END
           WHERE id=?`
        ).run(row.input_tokens || 0, row.output_tokens || 0, row.image_count || 0,
              row.cost, row.cost, canonical.id);
      } else {
        // Rename the row to use canonical key
        await db.prepare('UPDATE token_usage SET model=? WHERE id=?').run(row.canonical_key, row.id);
        continue;
      }
      // Delete the now-merged bad row
      await db.prepare('DELETE FROM token_usage WHERE id=?').run(row.id);
    }
    if (badRows.length > 0)
      console.log(`[Migration] token_usage: normalized ${badRows.length} rows to canonical model keys`);
  } catch (e) {
    console.warn('[Migration] token_usage normalization skipped:', e.message);
  }

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

  const safeAddColumn = async (table, column, type) => {
    try {
      await db.prepare(`ALTER TABLE ${table} ADD (${column} ${type})`).run();
      console.log(`[Migration] Added column ${table}.${column}`);
    } catch (e) {
      if (!e.message?.includes('ORA-01430')) { // column already exists
        console.warn(`[Migration] safeAddColumn ${table}.${column}: ${e.message}`);
      }
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

  // ── Research KB binding ───────────────────────────────────────────────────
  await addCol('RESEARCH_JOBS', 'KB_CONFIG_JSON',      'CLOB');
  // ── Research file attachments + streaming section results ────────────────
  await addCol('RESEARCH_JOBS', 'GLOBAL_FILES_JSON',   'CLOB');  // [{name,path,mime_type}]
  await addCol('RESEARCH_JOBS', 'SECTIONS_JSON',       'CLOB');  // [{sq_id,question,answer,done}] streaming
  await addCol('RESEARCH_JOBS', 'REF_JOB_IDS_JSON',   'CLOB');  // [jobId, ...] previous research refs
  await addCol('RESEARCH_JOBS', 'MODEL_KEY',           'VARCHAR2(100)'); // llm_models.key to use

  // ── Research Templates ────────────────────────────────────────────────────
  await createTable('RESEARCH_TEMPLATES', `CREATE TABLE research_templates (
    id               VARCHAR2(36)  DEFAULT SYS_GUID() PRIMARY KEY,
    user_id          NUMBER        NOT NULL,
    title            VARCHAR2(500) NOT NULL,
    question         CLOB,
    plan_json        CLOB,
    kb_config_json   CLOB,
    global_files_json CLOB,
    output_formats   VARCHAR2(200) DEFAULT 'docx',
    model_key        VARCHAR2(100),
    created_at       TIMESTAMP     DEFAULT SYSTIMESTAMP,
    updated_at       TIMESTAMP     DEFAULT SYSTIMESTAMP
  )`);

  // ── AI 戰情 ─────────────────────────────────────────────────────────────────
  await addCol('USERS', 'CAN_DESIGN_AI_SELECT', 'NUMBER(1)');
  await addCol('USERS', 'CAN_USE_AI_DASHBOARD',  'NUMBER(1)');

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

  await createTable('AI_SCHEMA_JOINS', `CREATE TABLE ai_schema_joins (
    id               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name             VARCHAR2(100) NOT NULL,
    left_schema_id   NUMBER REFERENCES ai_schema_definitions(id) ON DELETE CASCADE,
    right_schema_id  NUMBER REFERENCES ai_schema_definitions(id) ON DELETE CASCADE,
    join_type        VARCHAR2(10) DEFAULT 'LEFT',
    conditions_json  CLOB,
    created_by       NUMBER,
    created_at       TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await createTable('AI_DASHBOARD_SHARES', `CREATE TABLE ai_dashboard_shares (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    design_id    NUMBER NOT NULL REFERENCES ai_select_designs(id) ON DELETE CASCADE,
    share_type   VARCHAR2(20) DEFAULT 'use',
    grantee_type VARCHAR2(20) NOT NULL,
    grantee_id   VARCHAR2(100) NOT NULL,
    granted_by   NUMBER,
    created_at   TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── AI Dashboard sharing & suspend ────────────────────────────────────────
  await addCol('AI_SELECT_DESIGNS', 'SHARE_TYPE',        "VARCHAR2(20) DEFAULT 'none'");
  await addCol('AI_SELECT_DESIGNS', 'IS_SUSPENDED',       'NUMBER(1) DEFAULT 0');
  await addCol('AI_SELECT_TOPICS',  'IS_SUSPENDED',  'NUMBER(1) DEFAULT 0');
  await addCol('AI_SELECT_TOPICS',  'ICON_URL',      'VARCHAR2(500)');

  // ── Role permissions for AI dashboard ─────────────────────────────────────
  await addCol('ROLES', 'CAN_DESIGN_AI_SELECT', 'NUMBER(1) DEFAULT 0');
  await addCol('ROLES', 'CAN_USE_AI_DASHBOARD',  'NUMBER(1) DEFAULT 0');

  // ── Project layer ─────────────────────────────────────────────────────────
  await createTable('AI_SELECT_PROJECTS', `CREATE TABLE ai_select_projects (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         VARCHAR2(100) NOT NULL,
    description  CLOB,
    is_public    NUMBER(1) DEFAULT 0,
    is_suspended NUMBER(1) DEFAULT 0,
    created_by   NUMBER,
    created_at   TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await addCol('AI_SELECT_TOPICS',      'PROJECT_ID', 'NUMBER');
  await addCol('AI_SCHEMA_DEFINITIONS', 'PROJECT_ID', 'NUMBER');
  await addCol('AI_SCHEMA_DEFINITIONS', 'ALIAS',      'VARCHAR2(100)');
  await addCol('AI_SCHEMA_DEFINITIONS', 'SOURCE_TYPE','VARCHAR2(20)');
  await addCol('AI_SCHEMA_DEFINITIONS', 'SOURCE_SQL', 'CLOB');
  await addCol('AI_SCHEMA_DEFINITIONS', 'BASE_CONDITIONS', 'CLOB');
  await addCol('AI_SCHEMA_DEFINITIONS', 'VECTOR_ETL_JOB_ID', 'NUMBER');
  await addCol('AI_SELECT_DESIGNS',     'TARGET_JOIN_IDS', 'CLOB');
  await addCol('AI_ETL_JOBS',           'PROJECT_ID', 'NUMBER');
  await addCol('AI_ETL_JOBS',           'JOB_TYPE',   "VARCHAR2(20) DEFAULT 'vector'");
  await addCol('AI_ETL_JOBS',           'TARGET_TABLE','VARCHAR2(100)');
  await addCol('AI_ETL_JOBS',           'TARGET_MODE', "VARCHAR2(20) DEFAULT 'truncate_insert'");
  await addCol('AI_ETL_JOBS',           'UPSERT_KEY',  'VARCHAR2(100)');
  await addCol('AI_ETL_JOBS',           'DELETE_SQL',  'CLOB');
  await addCol('AI_ETL_JOBS',           'SCHEDULE_TYPE', 'VARCHAR2(20)');
  await addCol('AI_ETL_JOBS',           'SCHEDULE_CONFIG', 'CLOB');
  await addCol('AI_ETL_JOBS',           'RUN_COUNT',     'NUMBER DEFAULT 0');
  await addCol('AI_ETL_JOBS',           'TRIGGER_INTENT','VARCHAR2(1000)'); // 觸發意圖描述
  await addCol('AI_ETL_RUN_LOGS',       'ROWS_INSERTED','NUMBER DEFAULT 0');
  await addCol('AI_ETL_RUN_LOGS',       'ROWS_UPDATED', 'NUMBER DEFAULT 0');
  await addCol('AI_ETL_RUN_LOGS',       'STATUS_MESSAGE', 'VARCHAR2(200)');
  await addCol('AI_ETL_RUN_LOGS',       'ROWS_DELETED', 'NUMBER DEFAULT 0');
  await addCol('AI_SCHEMA_JOINS',       'PROJECT_ID',  'NUMBER');

  await createTable('AI_PROJECT_SHARES', `CREATE TABLE ai_project_shares (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id   NUMBER NOT NULL,
    share_type   VARCHAR2(20) DEFAULT 'use',
    grantee_type VARCHAR2(20) NOT NULL,
    grantee_id   VARCHAR2(100) NOT NULL,
    granted_by   NUMBER,
    created_at   TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // AI 戰情查詢歷史
  await createTable('AI_DASHBOARD_HISTORY', `CREATE TABLE ai_dashboard_history (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       NUMBER NOT NULL,
    design_id     NUMBER,
    design_name   VARCHAR2(200),
    topic_name    VARCHAR2(200),
    question      CLOB,
    generated_sql CLOB,
    row_count     NUMBER DEFAULT 0,
    created_at    TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // 向量搜尋參數（設計層級預設值）
  await addCol('AI_SELECT_DESIGNS', 'VECTOR_TOP_K', 'NUMBER DEFAULT 10');
  await addCol('AI_SELECT_DESIGNS', 'VECTOR_SIMILARITY_THRESHOLD', "VARCHAR2(10) DEFAULT '0.50'");
  // 欄位有明確值時跳過向量搜尋的欄位清單（JSON array of column names）
  await addCol('AI_SELECT_DESIGNS', 'VECTOR_SKIP_FIELDS', 'CLOB');

  // Schema 欄位：計算欄位（虛擬欄位）
  await addCol('AI_SCHEMA_COLUMNS', 'IS_VIRTUAL',  'NUMBER(1) DEFAULT 0');
  await addCol('AI_SCHEMA_COLUMNS', 'EXPRESSION',  'CLOB');

  // 公開專案需管理員核准
  await addCol('AI_SELECT_PROJECTS', 'PUBLIC_APPROVED', 'NUMBER(1) DEFAULT 0');
  await addCol('AI_SELECT_PROJECTS', 'PUBLIC_APPROVED_BY', 'NUMBER');
  await addCol('AI_SELECT_PROJECTS', 'PUBLIC_APPROVED_AT', 'TIMESTAMP');

  // ── 資料權限管理 ─────────────────────────────────────────────────────────────
  // 政策主表
  await createTable('AI_DATA_POLICIES', `CREATE TABLE ai_data_policies (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         VARCHAR2(100) NOT NULL,
    description  CLOB,
    created_by   NUMBER,
    created_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at   TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // 政策規則明細（多條，每條 include/exclude 一個值）
  await createTable('AI_DATA_POLICY_RULES', `CREATE TABLE ai_data_policy_rules (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    policy_id    NUMBER NOT NULL REFERENCES ai_data_policies(id) ON DELETE CASCADE,
    layer        NUMBER(1) NOT NULL,
    include_type VARCHAR2(10) DEFAULT 'include',
    value_type   VARCHAR2(50) NOT NULL,
    value_id     VARCHAR2(200),
    value_name   VARCHAR2(200),
    sort_order   NUMBER DEFAULT 0,
    created_at   TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // 政策指派（role 或 user）
  await createTable('AI_POLICY_ASSIGNMENTS', `CREATE TABLE ai_policy_assignments (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    policy_id    NUMBER REFERENCES ai_data_policies(id) ON DELETE SET NULL,
    grantee_type VARCHAR2(10) NOT NULL,
    grantee_id   NUMBER NOT NULL,
    override_role NUMBER(1) DEFAULT 1,
    created_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT ai_policy_assignments_uq UNIQUE (grantee_type, grantee_id)
  )`);

  // Schema 欄位過濾對應欄位
  await addCol('AI_SCHEMA_COLUMNS', 'IS_FILTER_KEY',  'NUMBER(1) DEFAULT 0');
  await addCol('AI_SCHEMA_COLUMNS', 'FILTER_LAYER',   'VARCHAR2(30)');
  await addCol('AI_SCHEMA_COLUMNS', 'FILTER_SOURCE',  'VARCHAR2(50)');

  // ── i18n: 多語言支援 ──────────────────────────────────────────────────────────
  await addCol('USERS', 'PREFERRED_LANGUAGE', "VARCHAR2(10)");
  await createTable('FACTORY_LANGUAGES', `CREATE TABLE factory_languages (
    factory_code   VARCHAR2(20)  PRIMARY KEY,
    language_code  VARCHAR2(10)  NOT NULL,
    updated_at     TIMESTAMP     DEFAULT SYSTIMESTAMP
  )`);

  // ── Skills 表欄位補齊（防止 create-schema.sql 版本落差）──────────────────────
  await addCol('SKILLS', 'TAGS',          "CLOB DEFAULT '[]'");
  await addCol('SKILLS', 'CODE_SNIPPET',  'CLOB');
  await addCol('SKILLS', 'CODE_PACKAGES', "CLOB DEFAULT '[]'");
  await addCol('SKILLS', 'CODE_STATUS',   "VARCHAR2(20) DEFAULT 'stopped'");
  await addCol('SKILLS', 'CODE_PORT',     'NUMBER');
  await addCol('SKILLS', 'CODE_PID',      'NUMBER');
  await addCol('SKILLS', 'CODE_ERROR',    'CLOB');

  // ── Skill access sharing table ───────────────────────────────────────────────
  await createTable('SKILL_ACCESS', `CREATE TABLE skill_access (
    id           VARCHAR2(36) PRIMARY KEY,
    skill_id     NUMBER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    grantee_type VARCHAR2(20) NOT NULL,
    grantee_id   VARCHAR2(100) NOT NULL,
    granted_by   NUMBER REFERENCES users(id),
    granted_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT skill_access_uq UNIQUE (skill_id, grantee_type, grantee_id)
  )`);

  // ── Scheduled Task Runs (execution history) ─────────────────────────────────
  await createTable('SCHEDULED_TASK_RUNS', `CREATE TABLE scheduled_task_runs (
    id                   NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    task_id              NUMBER NOT NULL,
    run_at               TIMESTAMP DEFAULT SYSTIMESTAMP,
    status               VARCHAR2(20) DEFAULT 'ok',
    attempt              NUMBER DEFAULT 1,
    session_id           VARCHAR2(36),
    response_preview     CLOB,
    generated_files_json CLOB DEFAULT '[]',
    email_sent_to        VARCHAR2(500),
    error_msg            VARCHAR2(2000),
    duration_ms          NUMBER,
    tools_used_json      CLOB,
    pipeline_log_json    CLOB
  )`);

  // ── Scheduled Tasks 工具引用支援 ─────────────────────────────────────────────
  await addCol('SCHEDULED_TASKS',     'TOOLS_CONFIG_JSON', "CLOB DEFAULT '[]'");
  await addCol('SCHEDULED_TASK_RUNS', 'TOOLS_USED_JSON',   'CLOB');

  // ── Scheduled Tasks Pipeline 支援 ───────────────────────────────────────────
  await addCol('SCHEDULED_TASKS',     'PIPELINE_JSON',        'CLOB');
  await addCol('SCHEDULED_TASK_RUNS', 'PIPELINE_LOG_JSON',    'CLOB');

  // ── Scheduled Tasks 文件範本輸出支援 ─────────────────────────────────────────
  await addCol('SCHEDULED_TASKS',     'OUTPUT_TEMPLATE_ID',   'VARCHAR2(64)');

  // ── Skill Call Logs ──────────────────────────────────────────────────────────
  await createTable('SKILL_CALL_LOGS', `CREATE TABLE skill_call_logs (
    id               NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    skill_id         NUMBER NOT NULL,
    user_id          NUMBER,
    session_id       VARCHAR2(36),
    query_preview    VARCHAR2(1000),
    response_preview VARCHAR2(1000),
    status           VARCHAR2(20) DEFAULT 'ok',
    error_msg        VARCHAR2(500),
    duration_ms      NUMBER,
    called_at        TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── DIFY Call Logs (ensure exists in Oracle) ─────────────────────────────────
  await createTable('DIFY_CALL_LOGS', `CREATE TABLE dify_call_logs (
    id               NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    kb_id            NUMBER NOT NULL,
    session_id       VARCHAR2(36),
    user_id          NUMBER,
    query_preview    VARCHAR2(500),
    response_preview CLOB,
    status           VARCHAR2(20) DEFAULT 'ok',
    error_msg        VARCHAR2(500),
    duration_ms      NUMBER,
    called_at        TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── KB Retrieval Tests: add source column ─────────────────────────────────────
  await addCol('KB_RETRIEVAL_TESTS', 'SOURCE', "VARCHAR2(20) DEFAULT 'test'");

  // ── Multilingual name / description columns ───────────────────────────────────
  // Skills
  await addCol('SKILLS', 'NAME_ZH',  'VARCHAR2(400)');
  await addCol('SKILLS', 'NAME_EN',  'VARCHAR2(400)');
  await addCol('SKILLS', 'NAME_VI',  'VARCHAR2(400)');
  await addCol('SKILLS', 'DESC_ZH',  'CLOB');
  await addCol('SKILLS', 'DESC_EN',  'CLOB');
  await addCol('SKILLS', 'DESC_VI',  'CLOB');
  // DIFY Knowledge Bases
  await addCol('DIFY_KNOWLEDGE_BASES', 'NAME_ZH',  'VARCHAR2(400)');
  await addCol('DIFY_KNOWLEDGE_BASES', 'NAME_EN',  'VARCHAR2(400)');
  await addCol('DIFY_KNOWLEDGE_BASES', 'NAME_VI',  'VARCHAR2(400)');
  await addCol('DIFY_KNOWLEDGE_BASES', 'DESC_ZH',  'CLOB');
  await addCol('DIFY_KNOWLEDGE_BASES', 'DESC_EN',  'CLOB');
  await addCol('DIFY_KNOWLEDGE_BASES', 'DESC_VI',  'CLOB');
  // Self-built Knowledge Bases
  await addCol('KNOWLEDGE_BASES', 'NAME_ZH',  'VARCHAR2(400)');
  await addCol('KNOWLEDGE_BASES', 'NAME_EN',  'VARCHAR2(400)');
  await addCol('KNOWLEDGE_BASES', 'NAME_VI',  'VARCHAR2(400)');
  await addCol('KNOWLEDGE_BASES', 'DESC_ZH',  'CLOB');
  await addCol('KNOWLEDGE_BASES', 'DESC_EN',  'CLOB');
  await addCol('KNOWLEDGE_BASES', 'DESC_VI',  'CLOB');
  // MCP Servers
  await addCol('MCP_SERVERS', 'NAME_ZH',  'VARCHAR2(400)');
  await addCol('MCP_SERVERS', 'NAME_EN',  'VARCHAR2(400)');
  await addCol('MCP_SERVERS', 'NAME_VI',  'VARCHAR2(400)');
  await addCol('MCP_SERVERS', 'DESC_ZH',  'CLOB');
  await addCol('MCP_SERVERS', 'DESC_EN',  'CLOB');
  await addCol('MCP_SERVERS', 'DESC_VI',  'CLOB');
  // AI Dashboard Designs (AI戰情)
  await addCol('AI_SELECT_DESIGNS', 'NAME_ZH',  'VARCHAR2(400)');
  await addCol('AI_SELECT_DESIGNS', 'NAME_EN',  'VARCHAR2(400)');
  await addCol('AI_SELECT_DESIGNS', 'NAME_VI',  'VARCHAR2(400)');
  await addCol('AI_SELECT_DESIGNS', 'DESC_ZH',  'VARCHAR2(1000)');
  await addCol('AI_SELECT_DESIGNS', 'DESC_EN',  'VARCHAR2(1000)');
  await addCol('AI_SELECT_DESIGNS', 'DESC_VI',  'VARCHAR2(1000)');
  await addCol('AI_SELECT_DESIGNS', 'MAX_ROWS',  'NUMBER DEFAULT 1000');
  // AI Select Topics (AI戰情 主題)
  await addCol('AI_SELECT_TOPICS', 'NAME_ZH',  'VARCHAR2(400)');
  await addCol('AI_SELECT_TOPICS', 'NAME_EN',  'VARCHAR2(400)');
  await addCol('AI_SELECT_TOPICS', 'NAME_VI',  'VARCHAR2(400)');
  await addCol('AI_SELECT_TOPICS', 'DESC_ZH',  'VARCHAR2(1000)');
  await addCol('AI_SELECT_TOPICS', 'DESC_EN',  'VARCHAR2(1000)');
  await addCol('AI_SELECT_TOPICS', 'DESC_VI',  'VARCHAR2(1000)');
  // Schema Columns (AI戰情 欄位說明)
  await addCol('AI_SCHEMA_COLUMNS', 'DESC_EN',  'VARCHAR2(1000)');
  await addCol('AI_SCHEMA_COLUMNS', 'DESC_VI',  'VARCHAR2(1000)');

  // ── AI 命名查詢（儲存查詢 / 報表 Template）─────────────────────────────────
  await createTable('AI_SAVED_QUERIES', `CREATE TABLE ai_saved_queries (
    id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id           NUMBER NOT NULL,
    name              VARCHAR2(200) NOT NULL,
    description       CLOB,
    category          VARCHAR2(100),
    design_id         NUMBER REFERENCES ai_select_designs(id) ON DELETE SET NULL,
    question          CLOB,
    pinned_sql        CLOB,
    chart_config      CLOB,
    parameters_schema CLOB,
    auto_run          NUMBER(1) DEFAULT 0,
    sort_order        NUMBER DEFAULT 0,
    is_active         NUMBER(1) DEFAULT 1,
    created_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
    last_run_at       TIMESTAMP
  )`);

  await createTable('AI_SAVED_QUERY_SHARES', `CREATE TABLE ai_saved_query_shares (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    query_id     NUMBER NOT NULL REFERENCES ai_saved_queries(id) ON DELETE CASCADE,
    share_type   VARCHAR2(20) DEFAULT 'use',
    grantee_type VARCHAR2(20) NOT NULL,
    grantee_id   VARCHAR2(100) NOT NULL,
    granted_by   NUMBER,
    created_at   TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── AI 儀表板（多查詢組合 Dashboard Board）─────────────────────────────────
  await createTable('AI_REPORT_DASHBOARDS', `CREATE TABLE ai_report_dashboards (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       NUMBER NOT NULL,
    name          VARCHAR2(200) NOT NULL,
    description   CLOB,
    category      VARCHAR2(100),
    layout_config CLOB,
    sort_order    NUMBER DEFAULT 0,
    is_active     NUMBER(1) DEFAULT 1,
    created_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at    TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await createTable('AI_REPORT_DASHBOARD_SHARES', `CREATE TABLE ai_report_dashboard_shares (
    id             NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dashboard_id   NUMBER NOT NULL REFERENCES ai_report_dashboards(id) ON DELETE CASCADE,
    share_type     VARCHAR2(20) DEFAULT 'use',
    grantee_type   VARCHAR2(20) NOT NULL,
    grantee_id     VARCHAR2(100) NOT NULL,
    granted_by     NUMBER,
    created_at     TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── Org Sync Change Logs ─────────────────────────────────────────────────────
  await createTable('ORG_SYNC_CHANGE_LOGS', `CREATE TABLE org_sync_change_logs (
    id               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id      VARCHAR2(50),
    user_name        VARCHAR2(200),
    sync_trigger     VARCHAR2(20) DEFAULT 'scheduled',
    changed_fields   CLOB,
    is_departure     NUMBER(1) DEFAULT 0,
    notified_admin   NUMBER(1) DEFAULT 0,
    error_msg        VARCHAR2(2000),
    synced_at        TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── 政策類別 (Policy Categories) ────────────────────────────────────────────
  await createTable('AI_POLICY_CATEGORIES', `CREATE TABLE ai_policy_categories (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR2(100) NOT NULL,
    description VARCHAR2(500),
    created_at  TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // 政策 ↔ 類別 N:M
  await createTable('AI_POLICY_CATEGORY_MAP', `CREATE TABLE ai_policy_category_map (
    policy_id   NUMBER NOT NULL REFERENCES ai_data_policies(id) ON DELETE CASCADE,
    category_id NUMBER NOT NULL REFERENCES ai_policy_categories(id) ON DELETE CASCADE,
    CONSTRAINT ai_policy_cat_map_pk PRIMARY KEY (policy_id, category_id)
  )`);

  // 角色 ↔ 政策 N:M（取代 ai_policy_assignments grantee_type='role' 單筆限制）
  await createTable('AI_ROLE_POLICIES', `CREATE TABLE ai_role_policies (
    role_id    NUMBER NOT NULL,
    policy_id  NUMBER NOT NULL REFERENCES ai_data_policies(id) ON DELETE CASCADE,
    priority   NUMBER DEFAULT 10,
    CONSTRAINT ai_role_policies_pk PRIMARY KEY (role_id, policy_id)
  )`);

  // 使用者 ↔ 政策 N:M（取代 ai_policy_assignments grantee_type='user' 單筆限制）
  await createTable('AI_USER_POLICIES', `CREATE TABLE ai_user_policies (
    user_id    NUMBER NOT NULL,
    policy_id  NUMBER NOT NULL REFERENCES ai_data_policies(id) ON DELETE CASCADE,
    priority   NUMBER DEFAULT 10,
    CONSTRAINT ai_user_policies_pk PRIMARY KEY (user_id, policy_id)
  )`);

  // 政策優先順序欄位（顯示用 / 未來 conflict resolution 用）
  await addCol('AI_DATA_POLICIES', 'PRIORITY', 'NUMBER DEFAULT 10');

  // 主題加政策類別欄位
  await addCol('AI_SELECT_TOPICS', 'POLICY_CATEGORY_ID', 'NUMBER');

  // ── MCP multi-transport support ─────────────────────────────────────────────
  await addCol('MCP_SERVERS', 'TRANSPORT_TYPE', "VARCHAR2(20) DEFAULT 'http-post'");
  await addCol('MCP_SERVERS', 'COMMAND',        'VARCHAR2(2000)');
  await addCol('MCP_SERVERS', 'ARGS_JSON',      'VARCHAR2(4000)');
  await addCol('MCP_SERVERS', 'ENV_JSON',        'CLOB');

  // ── MCP / DIFY access share_type 補欄（舊表可能缺欄）────────────────────────
  await addCol('MCP_ACCESS',  'SHARE_TYPE', "VARCHAR2(20) DEFAULT 'use'");
  await addCol('DIFY_ACCESS', 'SHARE_TYPE', "VARCHAR2(20) DEFAULT 'use'");

  // ── chat_sessions 工具選擇記錄欄位 ──────────────────────────────────────────
  await addCol('CHAT_SESSIONS', 'TOOLS_CONTEXT_JSON', 'CLOB');

  // ── AI 戰情欄位舊版 bug 修正：null 被存成 0，僅執行一次 ──────────────────────
  try {
    const migDone = await db.prepare(
      `SELECT value FROM system_settings WHERE key='migration_ai_dashboard_null_v1'`
    ).get();
    if (!migDone) {
      await db.prepare(`UPDATE users SET can_design_ai_select=NULL WHERE can_design_ai_select=0`).run();
      await db.prepare(`UPDATE users SET can_use_ai_dashboard=NULL  WHERE can_use_ai_dashboard=0`).run();
      await db.prepare(
        `MERGE INTO system_settings USING dual ON (key='migration_ai_dashboard_null_v1')
         WHEN NOT MATCHED THEN INSERT (key,value) VALUES ('migration_ai_dashboard_null_v1','1')`
      ).run();
    }
  } catch (e2) { console.warn('[migration] ai_dashboard_null_v1 skipped:', e2.message); }

  // ── MCP / DIFY 公開申請欄位 ───────────────────────────────────────────────
  await addCol('MCP_SERVERS',          'IS_PUBLIC',       'NUMBER(1) DEFAULT 0');
  await addCol('MCP_SERVERS',          'PUBLIC_APPROVED', 'NUMBER(1) DEFAULT 0');
  await addCol('DIFY_KNOWLEDGE_BASES', 'IS_PUBLIC',       'NUMBER(1) DEFAULT 0');
  await addCol('DIFY_KNOWLEDGE_BASES', 'PUBLIC_APPROVED', 'NUMBER(1) DEFAULT 0');

  // ── MCP / DIFY 共享存取表（取代 role_mcp_servers / role_dify_kbs）────────────
  await createTable('MCP_ACCESS', `CREATE TABLE mcp_access (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mcp_server_id NUMBER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    grantee_type  VARCHAR2(20) NOT NULL,
    grantee_id    VARCHAR2(100) NOT NULL,
    share_type    VARCHAR2(20) DEFAULT 'use',
    granted_by    NUMBER REFERENCES users(id),
    granted_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT mcp_access_uq UNIQUE (mcp_server_id, grantee_type, grantee_id)
  )`);

  await createTable('DIFY_ACCESS', `CREATE TABLE dify_access (
    id         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dify_kb_id NUMBER NOT NULL REFERENCES dify_knowledge_bases(id) ON DELETE CASCADE,
    grantee_type VARCHAR2(20) NOT NULL,
    grantee_id   VARCHAR2(100) NOT NULL,
    share_type   VARCHAR2(20) DEFAULT 'use',
    granted_by   NUMBER REFERENCES users(id),
    granted_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT dify_access_uq UNIQUE (dify_kb_id, grantee_type, grantee_id)
  )`);

  // ── 角色預設組織綁定（新使用者自動角色判斷）──────────────────────────────────
  await createTable('ROLE_ORG_BINDINGS', `CREATE TABLE role_org_bindings (
    id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_id   NUMBER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    org_type  VARCHAR2(20) NOT NULL,
    org_code  VARCHAR2(100) NOT NULL,
    org_name  VARCHAR2(500),
    CONSTRAINT role_org_bindings_uq UNIQUE (org_type, org_code)
  )`);

  // ── 系統監控表 (K8s / Docker / Host) ──────────────────────────────────────────

  // 節點指標歷史（每 5 分鐘一筆）
  await createTable('NODE_METRICS', `CREATE TABLE node_metrics (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    node_name     VARCHAR2(100) NOT NULL,
    role          VARCHAR2(20),
    status        VARCHAR2(20),
    cpu_alloc     VARCHAR2(20),
    cpu_req       VARCHAR2(20),
    cpu_req_pct   NUMBER(5,2),
    mem_alloc     VARCHAR2(20),
    mem_req       VARCHAR2(20),
    mem_req_pct   NUMBER(5,2),
    pod_count     NUMBER,
    collected_at  TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // 主機系統指標（每 5 分鐘一筆，讀 /proc）
  await createTable('HOST_METRICS', `CREATE TABLE host_metrics (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    load_1m       NUMBER(6,2),
    load_5m       NUMBER(6,2),
    load_15m      NUMBER(6,2),
    mem_total_mb  NUMBER,
    mem_used_mb   NUMBER,
    mem_cached_mb NUMBER,
    swap_used_mb  NUMBER,
    net_rx_mb     NUMBER(10,2),
    net_tx_mb     NUMBER(10,2),
    disk_read_mb  NUMBER(10,2),
    disk_write_mb NUMBER(10,2),
    uptime_sec    NUMBER,
    collected_at  TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // 磁碟使用歷史（每小時一筆）
  await createTable('DISK_METRICS', `CREATE TABLE disk_metrics (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mount         VARCHAR2(200),
    device        VARCHAR2(200),
    total_gb      NUMBER(10,2),
    used_gb       NUMBER(10,2),
    use_pct       NUMBER(5,2),
    inode_pct     NUMBER(5,2),
    is_mounted    NUMBER(1) DEFAULT 1,
    collected_at  TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // 線上人數快照（每 5 分鐘一筆）
  await createTable('ONLINE_USER_SNAPSHOTS', `CREATE TABLE online_user_snapshots (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    online_count  NUMBER,
    user_ids      VARCHAR2(2000),
    collected_at  TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // 線上人數部門統計快照
  await createTable('ONLINE_DEPT_SNAPSHOTS', `CREATE TABLE online_dept_snapshots (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    snapshot_id     NUMBER,
    collected_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
    profit_center   VARCHAR2(100),
    org_section     VARCHAR2(100),
    org_group_name  VARCHAR2(100),
    dept_code       VARCHAR2(100),
    user_count      NUMBER DEFAULT 0
  )`);
  await safeAddColumn('ONLINE_DEPT_SNAPSHOTS', 'SNAPSHOT_ID', 'NUMBER');
  await safeAddColumn('ONLINE_DEPT_SNAPSHOTS', 'PROFIT_CENTER_NAME', 'VARCHAR2(200)');
  await safeAddColumn('ONLINE_DEPT_SNAPSHOTS', 'ORG_SECTION_NAME', 'VARCHAR2(200)');

  // 確保 ONLINE_DEPT_SNAPSHOTS 有唯一約束（multi-pod 去重）
  try {
    const constraintExists = await db.prepare(
      `SELECT COUNT(*) AS CNT FROM user_constraints
       WHERE constraint_name='UQ_DEPT_SNAP_KEY' AND table_name='ONLINE_DEPT_SNAPSHOTS'`
    ).get();
    if (Number(constraintExists?.CNT ?? 0) === 0) {
      // 先刪除重複列（保留最小 id 的那筆）
      await db.prepare(`
        DELETE FROM online_dept_snapshots
        WHERE id NOT IN (
          SELECT MIN(id) FROM online_dept_snapshots
          GROUP BY snapshot_id, NVL(profit_center,'~'), NVL(org_section,'~'),
                   NVL(org_group_name,'~'), NVL(dept_code,'~')
        ) AND snapshot_id IS NOT NULL
      `).run();
      await db.prepare(`
        ALTER TABLE online_dept_snapshots
        ADD CONSTRAINT uq_dept_snap_key
        UNIQUE (snapshot_id, profit_center, org_section, org_group_name, dept_code)
      `).run();
      console.log('[Migration] online_dept_snapshots: UNIQUE constraint added');
    }
  } catch (e) {
    console.warn('[Migration] online_dept_snapshots unique constraint:', e.message);
  }

  // Service 健康檢查設定
  await createTable('HEALTH_CHECKS', `CREATE TABLE health_checks (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            VARCHAR2(100) NOT NULL,
    url             VARCHAR2(500) NOT NULL,
    method          VARCHAR2(10) DEFAULT 'GET',
    expected_status NUMBER DEFAULT 200,
    timeout_ms      NUMBER DEFAULT 5000,
    enabled         NUMBER(1) DEFAULT 1,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // Service 健康檢查結果（每 1 分鐘一筆）
  await createTable('HEALTH_CHECK_RESULTS', `CREATE TABLE health_check_results (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    check_id      NUMBER NOT NULL,
    status_code   NUMBER,
    response_ms   NUMBER,
    is_up         NUMBER(1),
    error_msg     VARCHAR2(500),
    checked_at    TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // 異常通知記錄
  await createTable('MONITOR_ALERTS', `CREATE TABLE monitor_alerts (
    id               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    alert_type       VARCHAR2(50),
    severity         VARCHAR2(20),
    resource_name    VARCHAR2(200),
    message          CLOB,
    notified_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    resolved_at      TIMESTAMP,
    last_known_value VARCHAR2(100),
    snoozed_until    TIMESTAMP
  )`);
  // Migration: add columns if table already exists
  await safeAddColumn('MONITOR_ALERTS', 'LAST_KNOWN_VALUE', 'VARCHAR2(100)');
  await safeAddColumn('MONITOR_ALERTS', 'SNOOZED_UNTIL', 'TIMESTAMP');

  // Deploy 歷史紀錄
  await createTable('DEPLOY_HISTORY', `CREATE TABLE deploy_history (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    triggered_by  NUMBER,
    git_before    VARCHAR2(40),
    git_after     VARCHAR2(40),
    exit_code     NUMBER,
    log_text      CLOB,
    deployed_at   TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── TAG 欄位 (MCP / DIFY KB / 自建 KB) ──────────────────────────────────────
  await safeAddColumn('MCP_SERVERS',           'TAGS', "CLOB DEFAULT '[]'");
  await safeAddColumn('DIFY_KNOWLEDGE_BASES',  'TAGS', "CLOB DEFAULT '[]'");
  await safeAddColumn('KNOWLEDGE_BASES',       'TAGS', "CLOB DEFAULT '[]'");

  // ── Skills 擴充欄位 ──────────────────────────────────────────────────────────
  // KB 綁定
  await safeAddColumn('SKILLS', 'SELF_KB_IDS',   "CLOB DEFAULT '[]'");
  await safeAddColumn('SKILLS', 'KB_MODE',       "VARCHAR2(20) DEFAULT 'append'");
  // Code skill → Gemini function declaration
  await safeAddColumn('SKILLS', 'TOOL_SCHEMA',   'CLOB');
  // Output Schema
  await safeAddColumn('SKILLS', 'OUTPUT_SCHEMA',  'CLOB');
  // Rate Limiting
  await safeAddColumn('SKILLS', 'RATE_LIMIT_PER_USER', 'NUMBER');
  await safeAddColumn('SKILLS', 'RATE_LIMIT_GLOBAL',   'NUMBER');
  await safeAddColumn('SKILLS', 'RATE_LIMIT_WINDOW',   "VARCHAR2(10) DEFAULT 'hour'");
  // 版本控制
  await safeAddColumn('SKILLS', 'PROMPT_VERSION',    'NUMBER DEFAULT 1');
  await safeAddColumn('SKILLS', 'PUBLISHED_PROMPT',  'CLOB');
  await safeAddColumn('SKILLS', 'DRAFT_PROMPT',      'CLOB');
  // Workflow JSON (for type='workflow')
  await safeAddColumn('SKILLS', 'WORKFLOW_JSON',        'CLOB');
  // 文件範本輸出（skill 使用範本產出檔案）
  await safeAddColumn('SKILLS', 'OUTPUT_TEMPLATE_ID',   'VARCHAR2(64)');

  // session_skills 變數
  await safeAddColumn('SESSION_SKILLS', 'VARIABLES_JSON', "CLOB DEFAULT '{}'");

  // ── Skill Prompt 版本歷史表 ─────────────────────────────────────────────────
  await createTable('SKILL_PROMPT_VERSIONS', `CREATE TABLE skill_prompt_versions (
    id            NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    skill_id      NUMBER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    version       NUMBER NOT NULL,
    system_prompt CLOB,
    workflow_json CLOB,
    changed_by    NUMBER REFERENCES users(id),
    change_note   VARCHAR2(500),
    created_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT skill_ver_uq UNIQUE (skill_id, version)
  )`);

  // ── Skill Workflow 表 ───────────────────────────────────────────────────────
  await createTable('SKILL_WORKFLOWS', `CREATE TABLE skill_workflows (
    id              VARCHAR2(36) PRIMARY KEY,
    skill_id        NUMBER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    version         NUMBER DEFAULT 1,
    nodes_json      CLOB NOT NULL,
    edges_json      CLOB NOT NULL,
    variables_json  CLOB DEFAULT '{}',
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── Vector table partitioning ───────────────────────────────────────────────
  await migrateAiVectorStoreToPartitioned();
  await migrateKbChunksToPartitioned();

  // ── Multi DB Sources（Phase 1: Oracle / Phase 2+: MySQL, MSSQL）────────────
  await createTable('AI_DB_SOURCES', `CREATE TABLE ai_db_sources (
    id             NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    name           VARCHAR2(100)  NOT NULL,
    db_type        VARCHAR2(20)   DEFAULT 'oracle',
    host           VARCHAR2(200),
    port           NUMBER,
    service_name   VARCHAR2(100),
    database_name  VARCHAR2(100),
    schema_name    VARCHAR2(100),
    username       VARCHAR2(100),
    password_enc   CLOB,
    is_default     NUMBER(1)      DEFAULT 0,
    is_active      NUMBER(1)      DEFAULT 1,
    pool_min       NUMBER         DEFAULT 1,
    pool_max       NUMBER         DEFAULT 5,
    pool_timeout   NUMBER         DEFAULT 60,
    ssl_enabled    NUMBER(1)      DEFAULT 0,
    ssl_ca_cert    CLOB,
    last_ping_at   TIMESTAMP,
    last_ping_ok   NUMBER(1),
    created_at     TIMESTAMP      DEFAULT SYSTIMESTAMP,
    updated_at     TIMESTAMP      DEFAULT SYSTIMESTAMP
  )`);

  // 自動插入預設 ERP 來源（從 env 讀取，僅在表格為空時插入）
  await migrateDefaultDbSource();

  // ai_schema_definitions: 新增 source_db_id（Phase 1 migration）
  await safeAddColumn('AI_SCHEMA_DEFINITIONS', 'SOURCE_DB_ID', 'NUMBER');
  // 將舊的 db_connection='erp' 對應到 is_default=1 的來源
  try {
    await db.prepare(`
      UPDATE ai_schema_definitions SET source_db_id = (
        SELECT id FROM ai_db_sources WHERE is_default=1 AND ROWNUM=1
      )
      WHERE source_db_id IS NULL AND (db_connection='erp' OR db_connection IS NULL)
    `).run();
  } catch (e) {
    console.warn('[Migration] source_db_id backfill:', e.message);
  }

  // ai_etl_jobs: 新增 source_db_id
  await safeAddColumn('AI_ETL_JOBS', 'SOURCE_DB_ID', 'NUMBER');
  try {
    await db.prepare(`
      UPDATE ai_etl_jobs SET source_db_id = (
        SELECT id FROM ai_db_sources WHERE is_default=1 AND ROWNUM=1
      )
      WHERE source_db_id IS NULL
    `).run();
  } catch (e) {
    console.warn('[Migration] etl source_db_id backfill:', e.message);
  }

  // quota_exceed_action: roles/users 額度超過時的行為 (block|warn)
  await safeAddColumn('ROLES', 'QUOTA_EXCEED_ACTION', "VARCHAR2(10) DEFAULT 'block'");
  await safeAddColumn('USERS', 'QUOTA_EXCEED_ACTION', 'VARCHAR2(10)');

  // ── 文件範本系統 ────────────────────────────────────────────────────────────
  await safeAddColumn('DOC_TEMPLATES', 'IS_FIXED_FORMAT', 'NUMBER(1) DEFAULT 0');

  await createTable('DOC_TEMPLATES', `CREATE TABLE doc_templates (
    id             VARCHAR2(36)  PRIMARY KEY,
    creator_id     NUMBER        NOT NULL REFERENCES users(id),
    name           VARCHAR2(200) NOT NULL,
    description    CLOB,
    format         VARCHAR2(20)  NOT NULL,
    strategy       VARCHAR2(20)  DEFAULT 'native',
    template_file  VARCHAR2(500),
    original_file  VARCHAR2(500),
    schema_json    CLOB,
    preview_url    VARCHAR2(500),
    is_public      NUMBER(1)     DEFAULT 0,
    is_fixed_format NUMBER(1)    DEFAULT 0,
    tags           CLOB,
    use_count      NUMBER        DEFAULT 0,
    forked_from    VARCHAR2(36)  REFERENCES doc_templates(id) ON DELETE SET NULL,
    created_at     TIMESTAMP     DEFAULT SYSTIMESTAMP,
    updated_at     TIMESTAMP     DEFAULT SYSTIMESTAMP
  )`);

  await createTable('DOC_TEMPLATE_SHARES', `CREATE TABLE doc_template_shares (
    id             NUMBER        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    template_id    VARCHAR2(36)  NOT NULL REFERENCES doc_templates(id) ON DELETE CASCADE,
    share_type     VARCHAR2(20)  DEFAULT 'use',
    grantee_type   VARCHAR2(20)  NOT NULL,
    grantee_id     VARCHAR2(100) NOT NULL,
    granted_by     NUMBER        REFERENCES users(id),
    created_at     TIMESTAMP     DEFAULT SYSTIMESTAMP,
    CONSTRAINT uq_doc_tpl_share UNIQUE (template_id, grantee_type, grantee_id)
  )`);

  await createTable('DOC_TEMPLATE_OUTPUTS', `CREATE TABLE doc_template_outputs (
    id             VARCHAR2(36)  PRIMARY KEY,
    template_id    VARCHAR2(36)  NOT NULL REFERENCES doc_templates(id),
    user_id        NUMBER        NOT NULL REFERENCES users(id),
    input_data     CLOB,
    output_file    VARCHAR2(500),
    output_format  VARCHAR2(20),
    created_at     TIMESTAMP     DEFAULT SYSTIMESTAMP
  )`);

  // ── 補算 token_usage.cost=NULL 的歷史資料（非同步，不阻塞啟動）────────────
  try {
    const { recalcNullCosts } = require('./services/tokenService');
    recalcNullCosts(db, 365).catch(e => console.warn('[Migration] recalcNullCosts:', e.message));
  } catch (_) {}

  // ── Webex Bot 支援欄位 ────────────────────────────────────────────────────
  await safeAddColumn('CHAT_SESSIONS', 'WEBEX_ROOM_ID', 'VARCHAR2(200)');
  await safeAddColumn('CHAT_SESSIONS', 'SOURCE', "VARCHAR2(30)");
  // webex_bot_enabled: 0=停用, 1=啟用 (DEFAULT 1 = 預設全體可用)
  await safeAddColumn('USERS', 'WEBEX_BOT_ENABLED', 'NUMBER(1) DEFAULT 1');

  // ── Webex Bot 稽核欄位 ───────────────────────────────────────────────────
  // audit_logs.source: 區分 'web' / 'webex'
  await safeAddColumn('AUDIT_LOGS', 'SOURCE', "VARCHAR2(20)");

  // webex_auth_logs: 記錄每次 email 認證結果，供管理員確認對應正確性
  await createTable('WEBEX_AUTH_LOGS', `CREATE TABLE webex_auth_logs (
    id           NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    raw_email    VARCHAR2(200),
    norm_email   VARCHAR2(200),
    user_id      NUMBER,
    user_name    VARCHAR2(200),
    username     VARCHAR2(200),
    status       VARCHAR2(30),
    room_type    VARCHAR2(20),
    room_id      VARCHAR2(200),
    msg_text     VARCHAR2(200),
    created_at   TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);
}

// ─── Default DB Source migration ───────────────────────────────────────────────

async function migrateDefaultDbSource() {
  try {
    const existing = await db.prepare(`SELECT COUNT(*) AS CNT FROM ai_db_sources`).get();
    if (Number(existing?.CNT ?? existing?.cnt ?? 0) > 0) return; // 已有資料，跳過

    const host    = process.env.ERP_DB_HOST;
    const port    = process.env.ERP_DB_PORT    || 1521;
    const svc     = process.env.ERP_DB_SERVICE_NAME;
    const user    = process.env.ERP_DB_USER;
    const pwd     = process.env.ERP_DB_USER_PASSWORD;

    if (!host || !svc || !user || !pwd) {
      console.warn('[Migration] ERP env 未完整設定，跳過自動建立預設 DB 來源');
      return;
    }

    const { encryptPassword } = require('./utils/dbCrypto');
    const passwordEnc = encryptPassword(pwd);

    await db.prepare(`
      INSERT INTO ai_db_sources
        (name, db_type, host, port, service_name, username, password_enc, is_default, is_active)
      VALUES (?,?,?,?,?,?,?,1,1)
    `).run('ERP Oracle（預設）', 'oracle', host, Number(port), svc, user, passwordEnc);

    console.log(`[Migration] 預設 DB 來源已建立: ${user}@${host}:${port}/${svc}`);
  } catch (e) {
    console.warn('[Migration] migrateDefaultDbSource error:', e.message);
  }
}

// ─── Partition migration helpers ───────────────────────────────────────────────

/** 遷移 AI_VECTOR_STORE 為 LIST PARTITION by etl_job_id（idempotent） */
async function migrateAiVectorStoreToPartitioned() {
  console.log('[Migration] Checking AI_VECTOR_STORE partition status...');
  if (!pool) { console.warn('[Migration] pool not ready, skip AI_VECTOR_STORE partition'); return; }
  let conn;
  try {
    conn = await pool.getConnection();
    const r = await conn.execute(
      `SELECT COUNT(*) AS CNT FROM user_part_tables WHERE UPPER(table_name)='AI_VECTOR_STORE'`,
      [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (Number(r.rows[0].CNT) > 0) {
      console.log('[Migration] AI_VECTOR_STORE already partitioned ✓');
      return;
    }

    console.log('[Migration] AI_VECTOR_STORE → LIST PARTITION by etl_job_id...');
    const jobRows = await conn.execute(
      `SELECT DISTINCT etl_job_id FROM ai_vector_store WHERE etl_job_id IS NOT NULL ORDER BY etl_job_id`,
      [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const jobIds = (jobRows.rows || []).map(r2 => r2.ETL_JOB_ID);
    console.log(`[Migration] AI_VECTOR_STORE: found ${jobIds.length} existing job IDs`);

    await conn.execute(`DROP INDEX ai_vector_store_vidx`, [], { autoCommit: true }).catch(() => {});
    await conn.execute(`ALTER TABLE ai_vector_store RENAME TO ai_vector_store_old`, [], { autoCommit: true });

    const partDefs = jobIds.map(id => `PARTITION P_JOB_${id} VALUES (${id})`);
    partDefs.push('PARTITION P_DEFAULT VALUES (DEFAULT)');
    await conn.execute(`
      CREATE TABLE ai_vector_store (
        id           NUMBER GENERATED ALWAYS AS IDENTITY,
        etl_job_id   NUMBER REFERENCES ai_etl_jobs(id) ON DELETE CASCADE,
        source_table VARCHAR2(100),
        source_pk    VARCHAR2(500),
        field_name   VARCHAR2(100),
        field_value  CLOB,
        metadata     CLOB,
        embedding    VECTOR(*, FLOAT32),
        created_at   TIMESTAMP DEFAULT SYSTIMESTAMP
      ) PARTITION BY LIST (etl_job_id) (${partDefs.join(', ')})
    `, [], { autoCommit: true });

    const ins = await conn.execute(`
      INSERT INTO ai_vector_store
        (etl_job_id, source_table, source_pk, field_name, field_value, metadata, embedding, created_at)
      SELECT etl_job_id, source_table, source_pk, field_name, field_value, metadata, embedding, created_at
      FROM ai_vector_store_old
    `, [], { autoCommit: true });
    console.log(`[Migration] AI_VECTOR_STORE: copied ${ins.rowsAffected} rows`);

    await conn.execute(`DROP TABLE ai_vector_store_old PURGE`, [], { autoCommit: true });
    await conn.execute(`
      CREATE VECTOR INDEX ai_vector_store_vidx ON ai_vector_store(embedding)
      ORGANIZATION NEIGHBOR PARTITIONS WITH DISTANCE COSINE WITH TARGET ACCURACY 90
    `, [], { autoCommit: true }).catch(e => console.warn('[Migration] ai_vector_store_vidx rebuild:', e.message));

    console.log(`[Migration] AI_VECTOR_STORE partitioned ✓ (${jobIds.length} job partitions + DEFAULT)`);
  } catch (e) {
    console.error('[Migration] migrateAiVectorStoreToPartitioned ERROR:', e.message);
    if (conn) await conn.execute(`ALTER TABLE ai_vector_store_old RENAME TO ai_vector_store`, [], { autoCommit: true }).catch(() => {});
  } finally {
    if (conn) await conn.close();
  }
}

/** 遷移 KB_CHUNKS 為 LIST PARTITION by kb_id（idempotent） */
async function migrateKbChunksToPartitioned() {
  console.log('[Migration] Checking KB_CHUNKS partition status...');
  if (!pool) { console.warn('[Migration] pool not ready, skip KB_CHUNKS partition'); return; }
  let conn;
  try {
    conn = await pool.getConnection();
    const r = await conn.execute(
      `SELECT COUNT(*) AS CNT FROM user_part_tables WHERE UPPER(table_name)='KB_CHUNKS'`,
      [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (Number(r.rows[0].CNT) > 0) {
      console.log('[Migration] KB_CHUNKS already partitioned ✓');
      return;
    }

    console.log('[Migration] KB_CHUNKS → LIST PARTITION by kb_id...');
    const kbRows = await conn.execute(
      `SELECT DISTINCT kb_id FROM kb_chunks WHERE kb_id IS NOT NULL`,
      [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const kbIds = (kbRows.rows || []).map(r2 => r2.KB_ID);
    console.log(`[Migration] KB_CHUNKS: found ${kbIds.length} existing kb IDs`);

    await conn.execute(`DROP INDEX kb_chunks_vidx`, [], { autoCommit: true }).catch(() => {});
    await conn.execute(`DROP INDEX kb_chunks_ftx`,  [], { autoCommit: true }).catch(() => {});
    await conn.execute(`ALTER TABLE kb_chunks RENAME TO kb_chunks_old`, [], { autoCommit: true });

    const partDefs = kbIds.map(id => `PARTITION ${_kbPartName(id)} VALUES ('${id.replace(/'/g, "''")}')`);
    partDefs.push('PARTITION P_DEFAULT VALUES (DEFAULT)');
    await conn.execute(`
      CREATE TABLE kb_chunks (
        id             VARCHAR2(36) NOT NULL,
        doc_id         VARCHAR2(36) NOT NULL,
        kb_id          VARCHAR2(36) NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        parent_id      VARCHAR2(36),
        chunk_type     VARCHAR2(10) DEFAULT 'regular',
        content        CLOB NOT NULL,
        parent_content CLOB,
        position       NUMBER NOT NULL,
        token_count    NUMBER,
        embedding      VECTOR(*, FLOAT32),
        created_at     TIMESTAMP DEFAULT SYSTIMESTAMP,
        CONSTRAINT kb_chunks_pk PRIMARY KEY (id, kb_id)
      ) PARTITION BY LIST (kb_id) (${partDefs.join(', ')})
    `, [], { autoCommit: true });

    const ins = await conn.execute(`
      INSERT INTO kb_chunks
        (id, doc_id, kb_id, parent_id, chunk_type, content, parent_content, position, token_count, embedding, created_at)
      SELECT id, doc_id, kb_id, parent_id, chunk_type, content, parent_content, position, token_count, embedding, created_at
      FROM kb_chunks_old
    `, [], { autoCommit: true });
    console.log(`[Migration] KB_CHUNKS: copied ${ins.rowsAffected} rows`);

    await conn.execute(`DROP TABLE kb_chunks_old PURGE`, [], { autoCommit: true });
    await conn.execute(`
      CREATE VECTOR INDEX kb_chunks_vidx ON kb_chunks(embedding)
      ORGANIZATION NEIGHBOR PARTITIONS WITH DISTANCE COSINE WITH TARGET ACCURACY 90
    `, [], { autoCommit: true }).catch(e => console.warn('[Migration] kb_chunks_vidx rebuild:', e.message));
    await conn.execute(`
      CREATE INDEX kb_chunks_ftx ON kb_chunks(content)
      INDEXTYPE IS CTXSYS.CONTEXT PARAMETERS ('sync (on commit)') LOCAL
    `, [], { autoCommit: true }).catch(e => console.warn('[Migration] kb_chunks_ftx rebuild:', e.message));

    console.log(`[Migration] KB_CHUNKS partitioned ✓ (${kbIds.length} kb partitions + DEFAULT)`);
  } catch (e) {
    console.error('[Migration] migrateKbChunksToPartitioned ERROR:', e.message);
    if (conn) await conn.execute(`ALTER TABLE kb_chunks_old RENAME TO kb_chunks`, [], { autoCommit: true }).catch(() => {});
  } finally {
    if (conn) await conn.close();
  }
}

// ─── Partition management (ETL & KB) ──────────────────────────────────────────

function _kbPartName(kbId) {
  return 'P_KB_' + kbId.replace(/-/g, '').toUpperCase();
}

async function _partitionExists(conn, tableName, partName) {
  const r = await conn.execute(
    `SELECT COUNT(*) AS CNT FROM user_tab_partitions WHERE UPPER(table_name)=:1 AND UPPER(partition_name)=:2`,
    [tableName.toUpperCase(), partName.toUpperCase()],
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  return Number(r.rows[0].CNT) > 0;
}

async function _isPartitioned(conn, tableName) {
  const r = await conn.execute(
    `SELECT COUNT(*) AS CNT FROM user_part_tables WHERE UPPER(table_name)=:1`,
    [tableName.toUpperCase()], { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  return Number(r.rows[0].CNT) > 0;
}

/** ETL Job 新增後呼叫 — 為該 job 加 AI_VECTOR_STORE partition */
async function addVectorStorePartition(jobId) {
  if (!pool) return;
  const conn = await pool.getConnection();
  try {
    if (!await _isPartitioned(conn, 'AI_VECTOR_STORE')) return;
    const pName = `P_JOB_${jobId}`;
    if (await _partitionExists(conn, 'AI_VECTOR_STORE', pName)) return;
    await conn.execute(`ALTER TABLE ai_vector_store ADD PARTITION ${pName} VALUES (${jobId})`, [], { autoCommit: true });
    console.log(`[Partition] AI_VECTOR_STORE +${pName}`);
  } catch (e) {
    console.warn(`[Partition] addVectorStorePartition(${jobId}):`, e.message);
  } finally {
    await conn.close();
  }
}

/** ETL Job 刪除前呼叫 — 先 DROP PARTITION（比 cascade delete 快） */
async function dropVectorStorePartition(jobId) {
  if (!pool) return;
  const conn = await pool.getConnection();
  try {
    if (!await _isPartitioned(conn, 'AI_VECTOR_STORE')) return;
    const pName = `P_JOB_${jobId}`;
    if (!await _partitionExists(conn, 'AI_VECTOR_STORE', pName)) return;
    await conn.execute(`ALTER TABLE ai_vector_store DROP PARTITION ${pName}`, [], { autoCommit: true });
    console.log(`[Partition] AI_VECTOR_STORE -${pName}`);
  } catch (e) {
    console.warn(`[Partition] dropVectorStorePartition(${jobId}):`, e.message);
  } finally {
    await conn.close();
  }
}

/** KB 新增後呼叫 — 為該 kb 加 KB_CHUNKS partition */
async function addKbChunksPartition(kbId) {
  if (!pool) return;
  const conn = await pool.getConnection();
  try {
    if (!await _isPartitioned(conn, 'KB_CHUNKS')) return;
    const pName = _kbPartName(kbId);
    if (await _partitionExists(conn, 'KB_CHUNKS', pName)) return;
    await conn.execute(
      `ALTER TABLE kb_chunks ADD PARTITION ${pName} VALUES ('${kbId.replace(/'/g, "''")}')`,
      [], { autoCommit: true }
    );
    console.log(`[Partition] KB_CHUNKS +${pName}`);
  } catch (e) {
    console.warn(`[Partition] addKbChunksPartition(${kbId}):`, e.message);
  } finally {
    await conn.close();
  }
}

/** KB 刪除前呼叫 — 先 DROP PARTITION */
async function dropKbChunksPartition(kbId) {
  if (!pool) return;
  const conn = await pool.getConnection();
  try {
    if (!await _isPartitioned(conn, 'KB_CHUNKS')) return;
    const pName = _kbPartName(kbId);
    if (!await _partitionExists(conn, 'KB_CHUNKS', pName)) return;
    await conn.execute(`ALTER TABLE kb_chunks DROP PARTITION ${pName}`, [], { autoCommit: true });
    console.log(`[Partition] KB_CHUNKS -${pName}`);
  } catch (e) {
    console.warn(`[Partition] dropKbChunksPartition(${kbId}):`, e.message);
  } finally {
    await conn.close();
  }
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
  addVectorStorePartition,
  dropVectorStorePartition,
  addKbChunksPartition,
  dropKbChunksPartition,
};

module.exports = oracleDbExports;
