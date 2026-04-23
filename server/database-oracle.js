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
    // INSERT-SELECT (INSERT INTO ... SELECT) cannot use RETURNING clause
    const isInsertSelect = isInsert && /\bSELECT\b/i.test(this.sql);

    const conn = await this.pool.getConnection();
    try {
      let result;
      if (isInsert && !isInsertSelect) {
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
          // ORA-03049: RETURNING not valid with INSERT-SELECT; run plain
          if (retErr.errorNum !== 904 && retErr.errorNum !== 22848 && retErr.errorNum !== 3049) normaliseError(retErr);
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
    poolAlias:     'system_db',
    user:          process.env.SYSTEM_DB_USER,
    password:      process.env.SYSTEM_DB_USER_PASSWORD,
    connectString,
    poolMin:          parseInt(process.env.ORACLE_POOL_MIN) || 5,   // pre-warm connections to avoid cold start
    poolMax:          parseInt(process.env.ORACLE_POOL_MAX) || 30,
    poolIncrement:    3,
    poolTimeout:      120,
    poolPingInterval: 60,
    queueTimeout:     30000,    // 30s wait before failing (was default 60s)
    expireTime:       300,      // terminate idle connections after 5 min
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
  await addCol('KB_CHUNKS', 'METADATA', 'CLOB');
  // Feedback Webex B 方案：DM thread parent message id
  await addCol('FEEDBACK_TICKETS', 'WEBEX_PARENT_MESSAGE_ID', 'VARCHAR2(200)');
  // 欄位可能已存在但長度不夠（100→200），嘗試擴大
  try { await db.prepare('ALTER TABLE feedback_tickets MODIFY webex_parent_message_id VARCHAR2(200)').run(); } catch {}
  // ERP 分流：分類 flag + 使用者 ERP 管理員 flag
  await addCol('FEEDBACK_CATEGORIES', 'IS_ERP', 'NUMBER(1) DEFAULT 0');
  await addCol('USERS', 'IS_ERP_ADMIN', 'NUMBER(1) DEFAULT 0');
  // 資訊內部紀錄：admin 用工單紀錄電話/系統外 Q&A,不發通知、不進統計
  await addCol('FEEDBACK_TICKETS', 'IS_INTERNAL_LOG', 'NUMBER(1) DEFAULT 0');

  // 重命名 feedback KB
  try {
    const renameMap = [
      ['feedback-public', 'Cortex 問題工單知識庫', 'Cortex 問題工單知識庫（脫敏）',
       'Cortex Ticket Knowledge Base', 'Cơ sở tri thức phiếu Cortex',
       'Cortex feedback ticket KB (redacted)', 'Cơ sở tri thức phiếu phản hồi Cortex (đã ẩn danh)'],
      ['feedback-erp', 'ERP 問題工單知識庫', 'ERP 問題工單知識庫（脫敏）',
       'ERP Ticket Knowledge Base', 'Cơ sở tri thức phiếu ERP',
       'ERP feedback ticket KB (redacted)', 'Cơ sở tri thức phiếu phản hồi ERP (đã ẩn danh)'],
    ];
    for (const [oldName, newName, desc, nameEn, nameVi, descEn, descVi] of renameMap) {
      const r = await db.prepare('SELECT id FROM knowledge_bases WHERE name = ?').get(oldName);
      if (r) {
        await db.prepare('UPDATE knowledge_bases SET name=?, description=?, name_zh=?, name_en=?, name_vi=?, desc_zh=?, desc_en=?, desc_vi=? WHERE id=?')
          .run(newName, desc, newName, nameEn, nameVi, desc, descEn, descVi, r.id);
        console.log(`[Migration] KB renamed: ${oldName} → ${newName}`);
      }
    }
  } catch (e) {
    console.warn('[Migration] KB rename:', e.message);
  }

  // kb_chunks.embedding: Oracle 23ai does not support MODIFY on VECTOR columns.
  // Detect if embedding is still fixed-dim (VECTOR(768,*)) by checking vector_precision in data dict.
  // If so: drop and re-add as VECTOR(*, FLOAT32) (safe only when table is empty).
  try {
    const conn = await pool.getConnection();
    try {
      // Check if embedding column has a fixed dimension
      // Try Oracle 23ai vector_dimensions first, fallback to data_length for older versions
      let dim = null;
      try {
        const dimRow = await conn.execute(
          `SELECT vector_dimensions FROM user_tab_columns WHERE table_name='KB_CHUNKS' AND column_name='EMBEDDING'`,
          [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        dim = dimRow.rows?.[0]?.VECTOR_DIMENSIONS;
      } catch {
        // ORA-00904: vector_dimensions doesn't exist on this Oracle version — skip migration
      }
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
  // 2026-04-19 修正：v1 這邊會無條件 drop kb_chunks_vidx（因為當時混合維度無法建 index）。
  // v2 Phase 2 已經在下方重建正確的 768-dim IVF index，這裡改成「只在真的有非 768 維度資料」時才 drop。
  try {
    const mixed = await db.prepare(`
      SELECT MIN(VECTOR_DIMENSION_COUNT(embedding)) AS min_d,
             MAX(VECTOR_DIMENSION_COUNT(embedding)) AS max_d
      FROM kb_chunks WHERE embedding IS NOT NULL
    `).get().catch(() => null);
    const minD = Number(mixed?.MIN_D ?? mixed?.min_d ?? 768);
    const maxD = Number(mixed?.MAX_D ?? mixed?.max_d ?? 768);
    if (minD !== maxD || minD !== 768) {
      // 真的有混合維度 → drop（v2 Phase 2 接下來會 re-embed + 重建）
      const conn2 = await pool.getConnection();
      try {
        await conn2.execute(`DROP INDEX kb_chunks_vidx`, [], { autoCommit: true });
        console.log('[Migration] Dropped kb_chunks_vidx (mixed-dimension detected, v2 Phase 2 will rebuild)');
      } catch (e) {
        if (!e.message.includes('ORA-01418')) console.warn('[Migration] kb_chunks_vidx drop:', e.message);
      } finally {
        await conn2.close();
      }
    }
  } catch (e) {
    console.warn('[Migration] kb_chunks_vidx conditional drop:', e.message);
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

  // PDF OCR mode — off (text-layer only) | auto (per-page image detection) | force (every page OCR)
  await addCol('KNOWLEDGE_BASES', 'PDF_OCR_MODE', "VARCHAR2(10) DEFAULT 'auto'");
  await addCol('KB_DOCUMENTS',    'PDF_OCR_MODE', "VARCHAR2(10)");

  // KB_DOCUMENTS stored file path (for re-parse) — relative to UPLOAD_BASE/kb/<kb_id>/
  await addCol('KB_DOCUMENTS', 'STORED_FILENAME', 'VARCHAR2(500)');

  // ── v2 檢索架構：retrieval_config CLOB + system defaults + orphan FK/trigger ────
  // 1) 每 KB 可覆寫檢索參數（backend / weights / fuzzy / synonym 等），JSON 存 CLOB
  await addCol('KNOWLEDGE_BASES', 'RETRIEVAL_CONFIG', 'CLOB');

  // 2) 系統級 KB 檢索預設值（JSON in value column）
  try {
    const existing = await db.prepare(
      `SELECT value FROM system_settings WHERE key='kb_retrieval_defaults'`
    ).get();
    if (!existing) {
      const defaults = {
        backend:             'like',              // Phase 1: 仍用 LIKE；Phase 2 改 oracle_text
        use_hybrid_sql:      false,
        vector_weight:       0.4,
        fulltext_weight:     0.6,
        match_boost:         0.1,
        title_weight:        0.3,
        body_weight:         0.7,
        fulltext_query_op:   'accum',
        fuzzy:               false,
        synonym_thesaurus:   null,
        use_proximity:       false,
        proximity_distance:  10,
        min_ft_score:        0.2,
        vec_cutoff:          0.7,
        fusion_method:       'weighted',          // weighted | rrf
        rrf_k:               60,
        token_stopwords:     ['分機','地址','電話','傳真','資料','哪些','每個','我要','你要','所有','幫我','請問','告訴','是否','可以','什麼','怎麼'],
        default_top_k_fetch: 20,
        default_top_k_return:5,
        default_score_threshold: 0,
        debug:               false,
      };
      await db.prepare(
        `INSERT INTO system_settings (key, value) VALUES ('kb_retrieval_defaults', ?)`
      ).run(JSON.stringify(defaults));
      console.log('[Migration] Inserted system_settings.kb_retrieval_defaults');
    }
  } catch (e) { console.warn('[Migration] kb_retrieval_defaults seed:', e.message); }

  // 3) Orphan cleanup cron 預設（hourly）
  try {
    const existing = await db.prepare(
      `SELECT value FROM system_settings WHERE key='kb_cleanup_cron'`
    ).get();
    if (!existing) {
      await db.prepare(
        `INSERT INTO system_settings (key, value) VALUES ('kb_cleanup_cron', '0 * * * *')`
      ).run();
    }
    const enabled = await db.prepare(
      `SELECT value FROM system_settings WHERE key='kb_cleanup_enabled'`
    ).get();
    if (!enabled) {
      await db.prepare(
        `INSERT INTO system_settings (key, value) VALUES ('kb_cleanup_enabled', '1')`
      ).run();
    }
  } catch (e) { console.warn('[Migration] kb_cleanup_cron seed:', e.message); }

  // 4) 清光既有 orphan chunks（FK 要加前必做）
  try {
    const cnt = await db.prepare(
      `SELECT COUNT(*) AS C FROM kb_chunks c WHERE NOT EXISTS
       (SELECT 1 FROM kb_documents d WHERE d.id = c.doc_id)`
    ).get();
    const orphans = Number(cnt?.C ?? cnt?.c ?? 0);
    if (orphans > 0) {
      console.log(`[Migration] 發現 ${orphans} 個 orphan kb_chunks，清除中...`);
      await db.prepare(
        `DELETE FROM kb_chunks WHERE NOT EXISTS
         (SELECT 1 FROM kb_documents WHERE id = kb_chunks.doc_id)`
      ).run();
      console.log(`[Migration] Orphan chunks 已清除: ${orphans} 筆`);
    }
  } catch (e) { console.warn('[Migration] orphan cleanup pre-FK:', e.message); }

  // 5) 加 FK：kb_chunks.doc_id → kb_documents.id ON DELETE CASCADE
  //    若 LIST partition 不允許，改用 trigger
  try {
    const fkExists = await db.prepare(
      `SELECT COUNT(*) AS C FROM user_constraints
       WHERE table_name='KB_CHUNKS' AND constraint_type='R'
         AND constraint_name = 'FK_KB_CHUNKS_DOC'`
    ).get();
    if (Number(fkExists?.C ?? fkExists?.c ?? 0) === 0) {
      try {
        await db.prepare(
          `ALTER TABLE kb_chunks ADD CONSTRAINT fk_kb_chunks_doc
           FOREIGN KEY (doc_id) REFERENCES kb_documents(id) ON DELETE CASCADE`
        ).run();
        console.log('[Migration] 加 FK kb_chunks.doc_id → kb_documents.id ON DELETE CASCADE ✓');
      } catch (fkErr) {
        console.warn('[Migration] FK 加失敗，改用 trigger:', fkErr.message);
        // Fallback: trigger
        await db.prepare(`
          CREATE OR REPLACE TRIGGER trg_kb_docs_cascade_chunks
          AFTER DELETE ON kb_documents
          FOR EACH ROW
          BEGIN
            DELETE FROM kb_chunks WHERE doc_id = :OLD.id;
          END;
        `).run();
        console.log('[Migration] Trigger trg_kb_docs_cascade_chunks 建立 ✓');
      }
    }
  } catch (e) { console.warn('[Migration] FK/trigger setup:', e.message); }

  // ── v2 Phase 2: re-embed 非 768 dim chunks 到 768（HNSW/IVF 要求 fixed dim）──
  try {
    const non768 = await db.prepare(`
      SELECT c.id, c.content, c.kb_id
      FROM kb_chunks c
      WHERE VECTOR_DIMENSION_COUNT(c.embedding) != 768
        AND c.content IS NOT NULL
      FETCH FIRST 500 ROWS ONLY
    `).all().catch(() => []);
    if (non768.length > 0) {
      console.log(`[Migration] 發現 ${non768.length} 個非 768 dim chunks，re-embed 中...`);
      let done = 0;
      let lastErr = null;
      try {
        const { embedContent } = require('./services/geminiClient');
        for (const row of non768) {
          try {
            const content = row.CONTENT || row.content;
            const vec = await embedContent(content, { dims: 768 });
            await db.prepare('UPDATE kb_chunks SET embedding = TO_VECTOR(?) WHERE id = ?')
              .run(JSON.stringify(vec), row.ID || row.id);
            done++;
          } catch (e) {
            lastErr = e;
          }
        }
        // 對應的 KB 也改 dims
        await db.prepare(`UPDATE knowledge_bases SET embedding_dims = 768 WHERE embedding_dims != 768`).run();
        console.log(`[Migration] Re-embed 完成: ${done}/${non768.length}` + (lastErr ? ` (last error: ${lastErr.message})` : ''));
      } catch (e) {
        console.warn('[Migration] re-embed pipeline 失敗:', e.message);
      }
    }
  } catch (e) { console.warn('[Migration] non-768 check:', e.message); }

  // ── v2 Phase 2: Oracle Text WORLD_LEXER + 重建 kb_chunks_ftx ───────────────
  // 直接用內建 CTXSYS.WORLD_LEXER（不用 CTX_DDL.CREATE_PREFERENCE，省 CTXAPP role）
  // SYNC 策略：Phase 3a 改為 EVERY 每 1 分鐘背景 sync（原 ON COMMIT 在 bulk insert 時
  //   每筆 chunk 都 reindex，上傳大檔嚴重變慢）。查詢最多 1 分鐘 lag。
  const FTX_SYNC_FLAG = 'kb_ftx_sync_mode_v2';
  try {
    const paramRow = await db.prepare(`
      SELECT CASE WHEN count(*) > 0 THEN 'EXISTS' ELSE 'MISSING' END AS st
      FROM user_indexes WHERE index_name='KB_CHUNKS_FTX'
    `).get();
    const indexState = paramRow?.ST || paramRow?.st || 'MISSING';

    // 檢查 index 是否用 WORLD_LEXER（需要 CTXSYS 權限才能查 ctx_user_index_values，
    // 所以 fallback：只要有 index 就再重建一次確保是 WORLD_LEXER — idempotent safe）
    let usesWorldLexer = false;
    try {
      const lexerRow = await db.prepare(`
        SELECT ixv_value FROM ctx_user_index_values
        WHERE ixv_index='KB_CHUNKS_FTX' AND ixv_class='LEXER' AND ROWNUM=1
      `).get();
      const lexerName = (lexerRow?.IXV_VALUE || lexerRow?.ixv_value || '').toLowerCase();
      usesWorldLexer = lexerName.includes('world');
    } catch (_) {}

    // 讀取過往 SYNC mode（避免重複 drop/recreate）
    const syncFlagRow = await db.prepare(
      `SELECT value FROM system_settings WHERE key=?`
    ).get(FTX_SYNC_FLAG).catch(() => null);
    const syncMode = syncFlagRow?.VALUE || syncFlagRow?.value || null; // 'every' 表示已切換

    // 要重建的情境：index 不存在、非 WORLD_LEXER、或還沒切 async sync
    const needRebuild = (indexState === 'MISSING') || !usesWorldLexer || syncMode !== 'every';

    if (needRebuild) {
      if (indexState === 'EXISTS') {
        console.log('[Migration] Rebuild kb_chunks_ftx (WORLD_LEXER + SYNC EVERY)...');
        await db.prepare('DROP INDEX kb_chunks_ftx').run().catch((e) => {
          if (!/ORA-01418/.test(e.message)) console.warn('[Migration] drop old ftx:', e.message);
        });
      } else {
        console.log('[Migration] Create kb_chunks_ftx (WORLD_LEXER + SYNC EVERY)...');
      }

      // 嘗試 SYNC EVERY（每 1 分鐘背景 sync；需 CREATE JOB 權限）→ 失敗 fallback ON COMMIT
      let syncMethod = 'EVERY "SYSDATE+1/1440"';
      let succeeded = false;
      try {
        await db.prepare(`
          CREATE INDEX kb_chunks_ftx ON kb_chunks(content)
          INDEXTYPE IS CTXSYS.CONTEXT
          PARAMETERS ('LEXER CTXSYS.WORLD_LEXER SYNC (${syncMethod})')
        `).run();
        succeeded = true;
        // 標記切換完成
        const ex = await db.prepare(`SELECT key FROM system_settings WHERE key=?`).get(FTX_SYNC_FLAG);
        if (ex) await db.prepare(`UPDATE system_settings SET value='every' WHERE key=?`).run(FTX_SYNC_FLAG);
        else    await db.prepare(`INSERT INTO system_settings (key,value) VALUES (?, 'every')`).run(FTX_SYNC_FLAG);
        console.log('[Migration] kb_chunks_ftx ✓ (WORLD_LEXER, SYNC EVERY 1 min)');
      } catch (e) {
        console.warn('[Migration] SYNC EVERY 失敗（可能無 CREATE JOB 權限），fallback ON COMMIT:', e.message);
        syncMethod = 'ON COMMIT';
        await db.prepare(`
          CREATE INDEX kb_chunks_ftx ON kb_chunks(content)
          INDEXTYPE IS CTXSYS.CONTEXT
          PARAMETERS ('LEXER CTXSYS.WORLD_LEXER SYNC (ON COMMIT)')
        `).run();
        succeeded = true;
        console.log('[Migration] kb_chunks_ftx ✓ (WORLD_LEXER, SYNC ON COMMIT — 慢，但可用)');
      }
      if (!succeeded) throw new Error('ftx 建立失敗');
    }
  } catch (e) {
    console.warn('[Migration] WORLD_LEXER / kb_chunks_ftx:', e.message);
  }

  // ── v2 Phase 2: Rebuild vector index (IVF) 若全 chunks 皆 768 ──────────────
  try {
    const dimCheck = await db.prepare(`
      SELECT MIN(VECTOR_DIMENSION_COUNT(embedding)) AS min_d,
             MAX(VECTOR_DIMENSION_COUNT(embedding)) AS max_d,
             COUNT(*) AS total
      FROM kb_chunks WHERE embedding IS NOT NULL
    `).get().catch(() => null);
    const minD = Number(dimCheck?.MIN_D ?? dimCheck?.min_d ?? 0);
    const maxD = Number(dimCheck?.MAX_D ?? dimCheck?.max_d ?? 0);
    const total = Number(dimCheck?.TOTAL ?? dimCheck?.total ?? 0);

    const vIdxExists = await db.prepare(`
      SELECT COUNT(*) AS C FROM user_indexes WHERE index_name='KB_CHUNKS_VIDX'
    `).get().catch(() => ({ C: 0 }));
    const hasVIdx = Number(vIdxExists?.C || vIdxExists?.c || 0) > 0;

    if (total > 0 && minD === 768 && maxD === 768 && !hasVIdx) {
      console.log('[Migration] Creating vector index kb_chunks_vidx (IVF, 768 dim, COSINE)...');
      await db.prepare(`
        CREATE VECTOR INDEX kb_chunks_vidx ON kb_chunks(embedding)
        ORGANIZATION NEIGHBOR PARTITIONS
        DISTANCE COSINE
        WITH TARGET ACCURACY 90
      `).run();
      console.log('[Migration] kb_chunks_vidx ✓ (IVF NEIGHBOR PARTITIONS)');
    } else if (total > 0 && (minD !== 768 || maxD !== 768)) {
      console.warn(`[Migration] ⚠️  chunks dims 不一致 (min=${minD} max=${maxD})，跳過 vector index；需手動 re-embed`);
    }
  } catch (e) {
    console.warn('[Migration] vector index:', e.message);
  }

  // ── v2 Phase 2: 切 system default backend 到 oracle_text + RRF ──────────────
  try {
    const row = await db.prepare(
      `SELECT value FROM system_settings WHERE key='kb_retrieval_defaults'`
    ).get();
    if (row?.value) {
      const cur = JSON.parse(row.value);
      let changed = false;
      if (cur.backend === 'like') { cur.backend = 'oracle_text'; changed = true; }
      if (cur.fusion_method !== 'rrf') { cur.fusion_method = 'rrf'; changed = true; }
      if (changed) {
        await db.prepare(`UPDATE system_settings SET value=? WHERE key='kb_retrieval_defaults'`)
          .run(JSON.stringify(cur));
        console.log('[Migration] system_settings.kb_retrieval_defaults → backend=oracle_text, fusion=rrf');
      }
    }
  } catch (e) { console.warn('[Migration] switch defaults to oracle_text:', e.message); }

  // ── v2 Phase 3c: Multi-vector per chunk — title_embedding 欄位 ─────────────
  await addCol('KB_CHUNKS', 'TITLE_EMBEDDING', 'VECTOR(768, FLOAT32)');


  // ── v2 Phase 3a: 清掉 system-seeded KB 的 hardcoded retrieval 設定 ──────────
  //    讓 admin「KB 檢索設定」系統預設能對它們生效。
  //    只改仍為原始 seed 值的欄位，避免覆蓋管理員已調整的內容。
  try {
    const SYS_KB_NAMES = ['Cortex 使用說明書', 'Cortex 問題工單知識庫', 'ERP 問題工單知識庫'];
    for (const nm of SYS_KB_NAMES) {
      // Help KB seed 原本為 retrieval_mode='hybrid', top_k_fetch=15, top_k_return=5, score_threshold=0.3
      // Feedback KB seed 原本為 retrieval_mode='vector', top_k_return=5, score_threshold=0.3
      const r = await db.prepare(`
        UPDATE knowledge_bases
        SET retrieval_mode = NULL,
            top_k_fetch     = NULL,
            top_k_return    = NULL,
            score_threshold = NULL
        WHERE name = ?
          AND retrieval_config IS NULL
          AND (
            (retrieval_mode = 'hybrid' AND top_k_fetch = 15 AND top_k_return = 5 AND score_threshold = 0.3)
            OR
            (retrieval_mode = 'vector' AND top_k_return = 5 AND score_threshold = 0.3)
          )
      `).run(nm);
      if (r?.changes) console.log(`[Migration] 系統 KB "${nm}" retrieval 參數重設為預設`);
    }
  } catch (e) { console.warn('[Migration] reset system KB retrieval:', e.message); }

  // ── Chat session multilingual titles ───────────────────────────────────────
  await addCol('CHAT_SESSIONS', 'TITLE_ZH', 'VARCHAR2(200)');
  await addCol('CHAT_SESSIONS', 'TITLE_EN', 'VARCHAR2(200)');
  await addCol('CHAT_SESSIONS', 'TITLE_VI', 'VARCHAR2(200)');

  // ── Chat Inline Chart (Phase 1) ─────────────────────────────────────────
  // InlineChartSpec[] JSON;Phase 2 由 chartSpecParser 寫入、GET messages 讀回。
  // 詳見 docs/chat-inline-chart-plan.md
  await addCol('CHAT_MESSAGES', 'CHARTS_JSON', 'CLOB');

  // ── User Charts (Phase 5) 的 createTable 調用在 runMigrations 後段,
  //   createTable 宣告在下方才 lexical 可用;此處只保留 addCol(addCol 在檔首已宣告)
  await addCol('AI_SELECT_DESIGNS', 'ADOPTED_FROM_USER_CHART_ID', 'NUMBER');

  // ── Deep Research ──────────────────────────────────────────────────────────
  await addCol('USERS',  'CAN_DEEP_RESEARCH', 'NUMBER(1)');
  await addCol('ROLES',  'CAN_DEEP_RESEARCH', 'NUMBER(1) DEFAULT 1');

  // ── UI Theme preference (dark | light-blue | light-green | light-yellow) ──
  await addCol('USERS',  'THEME', "VARCHAR2(20) DEFAULT 'dark'");

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
  await addCol('LLM_MODELS', 'GENERATION_CONFIG', 'CLOB'); // JSON: {temperature, max_output_tokens, top_p, reasoning_effort, thinking_budget, enable_search, enable_streaming}

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

  // ── Voice input STT model — 獨立追蹤 STT 用量，方便後台統計 ─────────────────
  // key=gemini-flash-stt 與一般 Flash 共用 api_model 但獨立記帳
  // model_role='stt' 避免出現在 chat / OCR / 翻譯 等選擇器（避免污染）
  // 語音計費跟一般 chat token 不同，必須獨立一列才能單獨設定單價
  try {
    const sttRow = await db.prepare(
      `SELECT id, model_role FROM llm_models WHERE LOWER(key)='gemini-flash-stt'`
    ).get();
    const flashApi = process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview';
    if (!sttRow) {
      await db.prepare(
        `INSERT INTO llm_models (key, name, api_model, description, is_active, sort_order, provider_type, model_role)
         VALUES ('gemini-flash-stt', 'Gemini Flash (語音轉文字)', ?, '麥克風語音輸入專用，獨立記帳，計費方式與一般 chat token 不同。', 1, 99, 'gemini', 'stt')`
      ).run(flashApi);
      console.log('[Migration] Seeded llm_models row: gemini-flash-stt (role=stt)');
    } else if (sttRow.model_role !== 'stt') {
      // 把舊的 'chat' role 升級成 'stt'，避免出現在 chat / 翻譯 / OCR 選擇器
      await db.prepare(
        `UPDATE llm_models SET model_role='stt' WHERE id=?`
      ).run(sttRow.id);
      console.log('[Migration] Updated gemini-flash-stt model_role: chat → stt');
    }
    // 同步建立 token_prices 條目（沿用 Flash 的當前單價作為基準，admin 之後可調整）
    const sttPriceExists = await db.prepare(
      `SELECT id FROM token_prices WHERE LOWER(model)='gemini flash (語音轉文字)' AND end_date IS NULL`
    ).get();
    if (!sttPriceExists) {
      const flashPrice = await db.prepare(
        `SELECT price_input, price_output, currency FROM token_prices tp
         JOIN llm_models lm ON LOWER(lm.name)=LOWER(tp.model)
         WHERE LOWER(lm.key)='flash' AND tp.end_date IS NULL
         ORDER BY tp.start_date DESC FETCH FIRST 1 ROWS ONLY`
      ).get();
      if (flashPrice) {
        await db.prepare(
          `INSERT INTO token_prices (model, price_input, price_output, currency, start_date)
           VALUES ('Gemini Flash (語音轉文字)', ?, ?, ?, TRUNC(SYSDATE))`
        ).run(flashPrice.price_input, flashPrice.price_output, flashPrice.currency || 'USD');
        console.log('[Migration] Seeded token_prices row for STT (cloned Flash price)');
      }
    }
  } catch (e) {
    console.warn('[Migration] STT model seed skipped:', e.message);
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

  // ── User Charts (Phase 5):使用者自建圖庫 + 分享 ──────────────────────────
  // Template Share 模型:分享 design + tool ref + params,絕不分享資料
  // 被分享者用自己權限重跑 tool。詳見 docs/chat-inline-chart-plan.md §5
  // 放這裡是因為 createTable 在上面幾行才宣告,搬來下方集中 createTable 區避 TDZ
  await createTable('USER_CHARTS', `CREATE TABLE user_charts (
    id                   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id             NUMBER NOT NULL,
    title                VARCHAR2(255) NOT NULL,
    description          CLOB,
    chart_spec           CLOB NOT NULL,
    source_type          VARCHAR2(32),
    source_tool          VARCHAR2(255),
    source_tool_version  VARCHAR2(64),
    source_schema_hash   VARCHAR2(64),
    source_prompt        CLOB,
    source_params        CLOB,
    source_session_id    VARCHAR2(64),
    source_message_id    NUMBER,
    is_public            NUMBER(1) DEFAULT 0,
    public_approved      NUMBER(1) DEFAULT 0,
    use_count            NUMBER DEFAULT 0,
    created_at           TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at           TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // user_chart_shares:欄位簽名完全對齊 ai_dashboard_shares
  await createTable('USER_CHART_SHARES', `CREATE TABLE user_chart_shares (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chart_id     NUMBER NOT NULL REFERENCES user_charts(id) ON DELETE CASCADE,
    share_type   VARCHAR2(20) DEFAULT 'use',
    grantee_type VARCHAR2(20) NOT NULL,
    grantee_id   VARCHAR2(100) NOT NULL,
    granted_by   NUMBER,
    created_at   TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── User Charts 使用率拆分(規劃書 §6):use_count 原本混著記
  //    now 改成三個獨立計數:開啟 / 執行成功 / 執行失敗
  //    use_count 保留意義為「執行次數總計」向下相容;新增兩個細項欄位
  await addCol('USER_CHARTS', 'OPEN_COUNT', 'NUMBER DEFAULT 0');
  await addCol('USER_CHARTS', 'FAIL_COUNT', 'NUMBER DEFAULT 0');

  // ── Chart Parser / Executor 錯誤遙測(規劃書 §7.2 #3)
  //    LLM 吐錯 JSON、schema drift、工具執行失敗 都記這裡,供 admin 回看調 prompt
  await createTable('CHART_PARSE_ERRORS', `CREATE TABLE chart_parse_errors (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      NUMBER,
    session_id   VARCHAR2(64),
    chart_id     NUMBER,              -- 若執行既有 user_chart 失敗可 FK;parse 錯時為 NULL
    source       VARCHAR2(32),        -- 'chat' | 'answer' | 'erp_tab' | 'execute' | 'schema_drift'
    reason       VARCHAR2(500),
    body_preview CLOB,                -- 原始 body(含錯誤的 spec JSON / 或 error stack)
    created_at   TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── Chart Style Templates(Phase 4c):使用者命名樣式 + 系統預設
  //    套用優先序:spec.style > user default template > system default > hardcoded
  //    owner_id=NULL + is_system=1 代表全站共用;一使用者至多一筆 is_default=1
  await createTable('CHART_STYLE_TEMPLATES', `CREATE TABLE chart_style_templates (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id     NUMBER,              -- NULL = system-wide
    name         VARCHAR2(100) NOT NULL,
    description  CLOB,
    is_system    NUMBER(1) DEFAULT 0, -- admin 維護的公司 branding
    is_default   NUMBER(1) DEFAULT 0, -- 該 owner 的 active default(搭配 default_for_type)
    style_json   CLOB NOT NULL,       -- ChartStyle JSON
    created_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at   TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // Phase 4c follow-up:per-type default — 一人最多 8 筆 is_default=1,用 default_for_type 區分
  //   'all' = 全圖型 fallback;'bar'/'line'/'area'/'pie'/'scatter'/'heatmap'/'radar' = 指定型
  await addCol('CHART_STYLE_TEMPLATES', 'DEFAULT_FOR_TYPE', "VARCHAR2(16) DEFAULT NULL");
  // 一次性 migration:既有 is_default=1 且 default_for_type=NULL 的視為 'all'
  try {
    await db.prepare(
      `UPDATE chart_style_templates SET default_for_type='all'
       WHERE is_default=1 AND (default_for_type IS NULL OR default_for_type='')`
    ).run();
  } catch (e) {
    console.warn('[Migration] chart_style_templates backfill default_for_type:', e.message);
  }

  // 種一筆「FOXLINK 預設」系統模板(is_system=1, owner_id=NULL);
  //   已存在就跳過,避免每次啟動覆蓋 admin 修改
  try {
    const exists = await db.prepare(
      `SELECT id FROM chart_style_templates WHERE is_system=1 AND name='FOXLINK 預設'`
    ).get();
    if (!exists) {
      const defaultStyle = JSON.stringify({
        version: 1,
        common: {
          palette: 'blue',
          title_size: 14,
          axis_label_size: 12,
          legend_position: 'top',
          legend_size: 11,
          show_grid: true,
          number_format: 'thousand',
          decimal_places: 0,
          background: 'light',
        },
        perType: {
          bar: { border_radius: 4 },
          line: { smooth: true, line_width: 2 },
          area: { opacity: 0.25, smooth: true },
          pie: { doughnut: true, radius_inner: 40, radius_outer: 68 },
          scatter: { symbol_size: 10 },
        },
      });
      await db.prepare(
        `INSERT INTO chart_style_templates
           (owner_id, name, description, is_system, is_default, style_json)
         VALUES (NULL, 'FOXLINK 預設', '系統預設樣式(藍色 palette + 千分位 + FOXLINK 企業風格)', 1, 0, ?)`
      ).run(defaultStyle);
      console.log('[Migration] Seeded FOXLINK 預設 chart style template');
    }
  } catch (e) {
    console.warn('[Migration] seed FOXLINK chart style:', e.message);
  }

  // ── v2 Phase 3b: 同義詞字典追蹤表（繞過 CTX view 版本相容問題）─────────────
  await createTable('kb_thesauri', `
    CREATE TABLE kb_thesauri (
      name        VARCHAR2(30) PRIMARY KEY,
      created_at  TIMESTAMP DEFAULT SYSTIMESTAMP
    )
  `);
  await createTable('kb_thesaurus_synonyms', `
    CREATE TABLE kb_thesaurus_synonyms (
      id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      thesaurus   VARCHAR2(30) NOT NULL,
      term        VARCHAR2(200) NOT NULL,
      related     VARCHAR2(200) NOT NULL,
      created_at  TIMESTAMP DEFAULT SYSTIMESTAMP,
      CONSTRAINT uq_kb_thes_syn UNIQUE (thesaurus, term, related)
    )
  `);

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

  await addCol('SKILL_ACCESS', 'SHARE_TYPE', "VARCHAR2(20) DEFAULT 'use'");

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

  // ── API 連接器擴展欄位（DIFY → 通用 API Connector）──────────────────────────
  await addCol('DIFY_KNOWLEDGE_BASES', 'CONNECTOR_TYPE',        "VARCHAR2(20) DEFAULT 'dify'");
  await addCol('DIFY_KNOWLEDGE_BASES', 'HTTP_METHOD',            "VARCHAR2(10) DEFAULT 'POST'");
  await addCol('DIFY_KNOWLEDGE_BASES', 'CONTENT_TYPE',           "VARCHAR2(100) DEFAULT 'application/json'");
  // 認證
  await addCol('DIFY_KNOWLEDGE_BASES', 'AUTH_TYPE',              "VARCHAR2(30) DEFAULT 'bearer'");
  await addCol('DIFY_KNOWLEDGE_BASES', 'AUTH_HEADER_NAME',       'VARCHAR2(100)');
  await addCol('DIFY_KNOWLEDGE_BASES', 'AUTH_QUERY_PARAM_NAME',  'VARCHAR2(100)');
  await addCol('DIFY_KNOWLEDGE_BASES', 'AUTH_CONFIG',            'CLOB');
  // 請求
  await addCol('DIFY_KNOWLEDGE_BASES', 'REQUEST_HEADERS',        'CLOB');
  await addCol('DIFY_KNOWLEDGE_BASES', 'REQUEST_BODY_TEMPLATE',  'CLOB');
  await addCol('DIFY_KNOWLEDGE_BASES', 'INPUT_PARAMS',           'CLOB');
  // 回應
  await addCol('DIFY_KNOWLEDGE_BASES', 'RESPONSE_TYPE',          "VARCHAR2(20) DEFAULT 'json'");
  await addCol('DIFY_KNOWLEDGE_BASES', 'RESPONSE_EXTRACT',       'VARCHAR2(500)');
  await addCol('DIFY_KNOWLEDGE_BASES', 'RESPONSE_TEMPLATE',      'CLOB');
  await addCol('DIFY_KNOWLEDGE_BASES', 'EMPTY_MESSAGE',          'VARCHAR2(500)');
  await addCol('DIFY_KNOWLEDGE_BASES', 'ERROR_MAPPING',          'CLOB');
  // Email 域名自動重試 (foxlink.com ↔ foxlink.com.tw)
  await addCol('DIFY_KNOWLEDGE_BASES', 'EMAIL_DOMAIN_FALLBACK',  'NUMBER(1) DEFAULT 0');
  // 回應模式：inject=結果餵回 LLM 整理 / answer=直接回答使用者 (與 mcp_servers.response_mode 對齊)
  await addCol('DIFY_KNOWLEDGE_BASES', 'RESPONSE_MODE',          "VARCHAR2(16) DEFAULT 'inject'");

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

  // 確保 ONLINE_DEPT_SNAPSHOTS 有唯一索引（multi-pod 去重）
  // 使用 function-based unique index + NVL 讓 NULL 也參與去重
  try {
    const idxExists = await db.prepare(
      `SELECT COUNT(*) AS CNT FROM user_indexes
       WHERE index_name='UQ_DEPT_SNAP_KEY' AND table_name='ONLINE_DEPT_SNAPSHOTS'`
    ).get();
    if (Number(idxExists?.CNT ?? 0) === 0) {
      // 也檢查是否曾以 constraint 形式存在
      const conExists = await db.prepare(
        `SELECT COUNT(*) AS CNT FROM user_constraints
         WHERE constraint_name='UQ_DEPT_SNAP_KEY' AND table_name='ONLINE_DEPT_SNAPSHOTS'`
      ).get();
      if (Number(conExists?.CNT ?? 0) > 0) {
        // 舊版 constraint 存在 → 先移除
        await db.prepare(`ALTER TABLE online_dept_snapshots DROP CONSTRAINT uq_dept_snap_key`).run();
      }
      // 用 ROWID 去重（比 NOT IN 更可靠）
      await db.prepare(`
        DELETE FROM online_dept_snapshots a
        WHERE a.ROWID > (
          SELECT MIN(b.ROWID) FROM online_dept_snapshots b
          WHERE NVL(a.snapshot_id, -1) = NVL(b.snapshot_id, -1)
            AND NVL(a.profit_center, '~') = NVL(b.profit_center, '~')
            AND NVL(a.org_section, '~') = NVL(b.org_section, '~')
            AND NVL(a.org_group_name, '~') = NVL(b.org_group_name, '~')
            AND NVL(a.dept_code, '~') = NVL(b.dept_code, '~')
        )
      `).run();
      await db.prepare(`
        CREATE UNIQUE INDEX uq_dept_snap_key ON online_dept_snapshots (
          NVL(snapshot_id, -1), NVL(profit_center, '~'), NVL(org_section, '~'),
          NVL(org_group_name, '~'), NVL(dept_code, '~')
        )
      `).run();
      console.log('[Migration] online_dept_snapshots: function-based UNIQUE index added');
    }
  } catch (e) {
    // ORA-00955: index already created by another pod (race condition) — safe to ignore
    if (!e.message?.includes('ORA-00955')) {
      console.warn('[Migration] online_dept_snapshots unique index:', e.message);
    }
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
  await migrateDefaultDbSource(db);

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

  // webex_allowed_domains: email domain 白名單（空=全拒，防私人 Webex 冒用）
  try {
    const existing = await db.prepare(
      `SELECT value FROM system_settings WHERE key='webex_allowed_domains'`
    ).get();
    if (!existing) {
      const defaults = JSON.stringify(['foxlink.com', 'foxlink.com.tw']);
      await db.prepare(
        `INSERT INTO system_settings (key, value) VALUES ('webex_allowed_domains', ?)`
      ).run(defaults);
      console.log('[Migration] Seeded system_settings.webex_allowed_domains with foxlink.com, foxlink.com.tw');
    }
  } catch (e) { console.warn('[Migration] webex_allowed_domains seed:', e.message); }

  // One-shot email 清理：TRIM + 移除零寬字元（只跑一次，用 system_settings key 記錄）
  try {
    const done = await db.prepare(
      `SELECT value FROM system_settings WHERE key='users_email_cleanup_v1'`
    ).get();
    if (!done) {
      // 用 CHR 組零寬字元，避免 source code 混入不可見字元
      // U+200B ZWSP(8203), U+200C ZWNJ(8204), U+200D ZWJ(8205), U+FEFF BOM(65279)
      const r = await db.prepare(
        `UPDATE users
         SET email = TRIM(REPLACE(REPLACE(REPLACE(REPLACE(email,
                     CHR(8203), ''), CHR(8204), ''), CHR(8205), ''), CHR(65279), ''))
         WHERE email IS NOT NULL
           AND email != TRIM(REPLACE(REPLACE(REPLACE(REPLACE(email,
                     CHR(8203), ''), CHR(8204), ''), CHR(8205), ''), CHR(65279), ''))`
      ).run();
      await db.prepare(
        `INSERT INTO system_settings (key, value) VALUES ('users_email_cleanup_v1', ?)`
      ).run(new Date().toISOString());
      console.log(`[Migration] users.email cleanup (trim + zero-width) done, affected=${r.changes ?? 'n/a'}`);
    }
  } catch (e) { console.warn('[Migration] users_email_cleanup_v1:', e.message); }

  // ── 資料政策 × 類別綁定（使用者/角色對特定類別指定政策）────────────────────
  await createTable('AI_USER_CAT_POLICIES', `CREATE TABLE ai_user_cat_policies (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     NUMBER        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id NUMBER        NOT NULL REFERENCES ai_policy_categories(id) ON DELETE CASCADE,
    policy_id   NUMBER        NOT NULL REFERENCES ai_data_policies(id) ON DELETE CASCADE,
    created_at  TIMESTAMP     DEFAULT SYSTIMESTAMP,
    CONSTRAINT uq_user_cat_pol UNIQUE (user_id, category_id, policy_id)
  )`);

  await createTable('AI_ROLE_CAT_POLICIES', `CREATE TABLE ai_role_cat_policies (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_id     NUMBER        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    category_id NUMBER        NOT NULL REFERENCES ai_policy_categories(id) ON DELETE CASCADE,
    policy_id   NUMBER        NOT NULL REFERENCES ai_data_policies(id) ON DELETE CASCADE,
    created_at  TIMESTAMP     DEFAULT SYSTIMESTAMP,
    CONSTRAINT uq_role_cat_pol UNIQUE (role_id, category_id, policy_id)
  )`);

  // ── 姓名鎖定欄位（防止 LDAP/ERP 自動覆蓋手動修改的姓名）────────────────────
  await safeAddColumn('USERS', 'NAME_MANUALLY_SET', 'NUMBER(1) DEFAULT 0');

  // ── 說明文件多語翻譯 ─────────────────────────────────────────────────────────
  await createTable('HELP_SECTIONS', `CREATE TABLE help_sections (
    id             VARCHAR2(60)  PRIMARY KEY,
    section_type   VARCHAR2(10)  DEFAULT 'user',
    sort_order     NUMBER        DEFAULT 0,
    icon           VARCHAR2(60),
    icon_color     VARCHAR2(60),
    last_modified  VARCHAR2(20)  NOT NULL,
    created_at     TIMESTAMP     DEFAULT SYSTIMESTAMP
  )`);

  await createTable('HELP_TRANSLATIONS', `CREATE TABLE help_translations (
    id             NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    section_id     VARCHAR2(60)  NOT NULL REFERENCES help_sections(id) ON DELETE CASCADE,
    lang           VARCHAR2(10)  NOT NULL,
    title          VARCHAR2(200) NOT NULL,
    sidebar_label  VARCHAR2(200) NOT NULL,
    blocks_json    CLOB          NOT NULL,
    translated_at  VARCHAR2(20),
    updated_at     TIMESTAMP     DEFAULT SYSTIMESTAMP,
    CONSTRAINT help_trans_uq UNIQUE (section_id, lang)
  )`);

  // ── Factory Code Translations (en / vi only — zh-TW 來自 ERP FND_FLEX_VALUES_VL) ──
  // 見 docs/factory-share-layer-plan.md §2.1
  await createTable('FACTORY_CODE_TRANSLATIONS', `CREATE TABLE factory_code_translations (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    factory_code  VARCHAR2(30)  NOT NULL,
    lang          VARCHAR2(10)  NOT NULL,
    factory_name  NVARCHAR2(200) NOT NULL,
    updated_at    TIMESTAMP     DEFAULT SYSTIMESTAMP,
    CONSTRAINT factory_trans_uq UNIQUE (factory_code, lang)
  )`);

  // factory_code_lookup: 本地平展表,給 AI 戰情 JOIN 用(zh 名稱來自 ERP KFF 1008041,en/vi 來自 factory_code_translations)
  // 內容由 services/factoryCodeLookupSync.js 定期同步
  await createTable('FACTORY_CODE_LOOKUP', `CREATE TABLE factory_code_lookup (
    code            VARCHAR2(30)   PRIMARY KEY,
    name_zh         NVARCHAR2(200),
    name_en         NVARCHAR2(200),
    name_vi         NVARCHAR2(200),
    last_synced_at  TIMESTAMP      DEFAULT SYSTIMESTAMP
  )`);

  // indirect_emp_by_pc_factory: 間接員工計數 by 利潤中心 × 廠區
  // 來源 ERP foxfl.fl_emp_exp_all,條件 CURRENT_FLAG='Y' AND DIT_CODE='I' AND END_DATE IS NULL
  // factory_code 透過 DEPT_CODE JOIN APPS.FL_ORG_EMP_DEPT_MV 取得;JOIN 不到則填 '__NONE__' 當「未歸屬」佔位符
  // (Oracle 的 '' = NULL 導致 PK 欄位無法用空字串,用固定字串取代)
  // 跨庫 JOIN 不可行,由 services/indirectEmpSync.js 定期同步到本地供 AI 戰情 JOIN
  await createTable('INDIRECT_EMP_BY_PC_FACTORY', `CREATE TABLE indirect_emp_by_pc_factory (
    profit_center   VARCHAR2(30)   NOT NULL,
    factory_code    VARCHAR2(30)   NOT NULL,
    emp_count       NUMBER         NOT NULL,
    last_synced_at  TIMESTAMP      DEFAULT SYSTIMESTAMP,
    CONSTRAINT indirect_emp_pcfc_pk PRIMARY KEY (profit_center, factory_code)
  )`);

  // ── Training Platform: 權限欄位 ──────────────────────────────────────────────
  // training_permission: 'none' | 'publish' | 'publish_edit'  (NULL on users = inherit from role)
  await addCol('ROLES', 'TRAINING_PERMISSION', "VARCHAR2(20) DEFAULT 'none'");
  await addCol('USERS', 'TRAINING_PERMISSION', 'VARCHAR2(20)');  // NULL = follow role

  // Phase 4A: 遷移舊權限值 edit→publish_edit, use→none
  try {
    await db.run("UPDATE users SET training_permission = 'publish_edit' WHERE training_permission = 'edit'");
    await db.run("UPDATE users SET training_permission = 'none' WHERE training_permission = 'use'");
    await db.run("UPDATE roles SET training_permission = 'publish_edit' WHERE training_permission = 'edit'");
    await db.run("UPDATE roles SET training_permission = 'none' WHERE training_permission = 'use'");
  } catch (e) { /* migration already applied or column type mismatch — safe to ignore */ }

  // Phase 4A: 擴充欄位長度 → VARCHAR2(20)
  for (const tbl of ['USERS', 'ROLES']) {
    try {
      await db.execDDL(`ALTER TABLE ${tbl} MODIFY TRAINING_PERMISSION VARCHAR2(20)`);
      console.log(`[Migration] ${tbl}.TRAINING_PERMISSION → VARCHAR2(20) OK`);
    } catch(e) { console.warn(`[Migration] ${tbl}.TRAINING_PERMISSION resize:`, e.message); }
  }

  // Phase 4A: training_programs 新增 paused_at / completed_at
  await addCol('TRAINING_PROGRAMS', 'PAUSED_AT', 'TIMESTAMP');
  await addCol('TRAINING_PROGRAMS', 'COMPLETED_AT', 'TIMESTAMP');

  // Phase 4: program_courses 新增 lesson_ids（JSON array，null = 全部章節）
  await addCol('PROGRAM_COURSES', 'LESSON_IDS', 'CLOB');

  // Phase 5: program_courses 新增 exam_config（JSON，覆蓋課程測驗設定）
  await addCol('PROGRAM_COURSES', 'EXAM_CONFIG', 'CLOB');

  // Phase 5: training_programs 新增專案及格分數 + 章節鎖定
  await addCol('TRAINING_PROGRAMS', 'PROGRAM_PASS_SCORE', "NUMBER DEFAULT 60");
  await addCol('TRAINING_PROGRAMS', 'SEQUENTIAL_LESSONS', "NUMBER(1) DEFAULT 0");

  // Phase 6: course_lessons 新增必修標記 + 章節配分權重（Program 可於 exam_config 覆蓋）
  await addCol('COURSE_LESSONS', 'IS_MANDATORY', 'NUMBER(1) DEFAULT 1');
  await addCol('COURSE_LESSONS', 'SCORE_WEIGHT', 'NUMBER DEFAULT 10');

  // Phase 5: 投影片瀏覽追蹤
  await createTable('USER_SLIDE_VIEWS', `CREATE TABLE user_slide_views (
    id               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id          NUMBER NOT NULL,
    slide_id         NUMBER NOT NULL,
    course_id        NUMBER NOT NULL,
    lesson_id        NUMBER NOT NULL,
    program_id       NUMBER,
    duration_seconds NUMBER DEFAULT 0,
    interaction_done NUMBER(1) DEFAULT 0,
    viewed_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT UQ_SLIDE_VIEW UNIQUE (user_id, slide_id, program_id)
  )`);

  // ── Phase 3D-Help: session_id + Help 綁定教材 ────────────────────────────────
  await addCol('INTERACTION_RESULTS', 'SESSION_ID', 'VARCHAR2(36)');
  await addCol('HELP_SECTIONS', 'LINKED_COURSE_ID', 'NUMBER');
  await addCol('HELP_SECTIONS', 'LINKED_LESSON_ID', 'NUMBER');

  await addCol('INTERACTION_RESULTS', 'EXAM_TOPIC_ID', 'NUMBER');
  await addCol('INTERACTION_RESULTS', 'WEIGHTED_SCORE', 'NUMBER');
  await addCol('INTERACTION_RESULTS', 'WEIGHTED_MAX', 'NUMBER');

  // ── Training Platform: 課程分類（樹狀，最多 3 層）─────────────────────────────
  await createTable('COURSE_CATEGORIES', `CREATE TABLE course_categories (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    parent_id   NUMBER,
    name        VARCHAR2(200) NOT NULL,
    sort_order  NUMBER DEFAULT 0,
    created_by  NUMBER,
    created_at  TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── Training Platform: 課程主檔 ─────────────────────────────────────────────
  await createTable('COURSES', `CREATE TABLE courses (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title           VARCHAR2(500) NOT NULL,
    description     CLOB,
    cover_image     VARCHAR2(500),
    category_id     NUMBER,
    created_by      NUMBER NOT NULL,
    status          VARCHAR2(20) DEFAULT 'draft',
    is_public       NUMBER(1) DEFAULT 0,
    pass_score      NUMBER DEFAULT 60,
    max_attempts    NUMBER,
    time_limit_minutes NUMBER,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── Training Platform: 章節 ─────────────────────────────────────────────────
  await createTable('COURSE_LESSONS', `CREATE TABLE course_lessons (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id   NUMBER NOT NULL,
    title       VARCHAR2(500) NOT NULL,
    sort_order  NUMBER DEFAULT 0,
    lesson_type VARCHAR2(20) DEFAULT 'slides',
    created_at  TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at  TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── Training Platform: 投影片 ───────────────────────────────────────────────
  await createTable('COURSE_SLIDES', `CREATE TABLE course_slides (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lesson_id       NUMBER NOT NULL,
    sort_order      NUMBER DEFAULT 0,
    slide_type      VARCHAR2(30) DEFAULT 'content',
    content_json    CLOB,
    audio_url       VARCHAR2(500),
    notes           CLOB,
    duration_seconds NUMBER,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── Training Platform: 影片互動節點 ─────────────────────────────────────────
  await createTable('VIDEO_INTERACTIONS', `CREATE TABLE video_interactions (
    id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lesson_id           NUMBER NOT NULL,
    timestamp_seconds   NUMBER NOT NULL,
    interaction_type    VARCHAR2(20) NOT NULL,
    content_json        CLOB NOT NULL,
    must_answer         NUMBER(1) DEFAULT 1,
    pause_video         NUMBER(1) DEFAULT 1,
    sort_order          NUMBER DEFAULT 0,
    created_at          TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── Training Platform: 分支節點 ─────────────────────────────────────────────
  await createTable('SLIDE_BRANCHES', `CREATE TABLE slide_branches (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slide_id        NUMBER NOT NULL,
    option_text     VARCHAR2(500) NOT NULL,
    option_index    NUMBER DEFAULT 0,
    target_slide_id NUMBER,
    target_lesson_id NUMBER,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── Training Platform: 題庫（含評分規則）─────────────────────────────────────
  await createTable('QUIZ_QUESTIONS', `CREATE TABLE quiz_questions (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id       NUMBER NOT NULL,
    question_type   VARCHAR2(30) NOT NULL,
    question_json   CLOB NOT NULL,
    answer_json     CLOB NOT NULL,
    scoring_json    CLOB,
    points          NUMBER DEFAULT 10,
    explanation     CLOB,
    sort_order      NUMBER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── Training Platform: 測驗結果 ─────────────────────────────────────────────
  await createTable('QUIZ_ATTEMPTS', `CREATE TABLE quiz_attempts (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id       NUMBER NOT NULL,
    user_id         NUMBER NOT NULL,
    score           NUMBER,
    total_points    NUMBER,
    passed          NUMBER(1) DEFAULT 0,
    answers_json    CLOB,
    attempt_number  NUMBER DEFAULT 1,
    started_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    completed_at    TIMESTAMP,
    review_status   VARCHAR2(20) DEFAULT 'auto',
    reviewed_by     NUMBER,
    reviewed_at     TIMESTAMP
  )`);

  // ── Training Platform: 測驗主題 ─────────────────────────────────────────────
  await createTable('EXAM_TOPICS', `CREATE TABLE exam_topics (
    id                 NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id          NUMBER NOT NULL,
    title              VARCHAR2(500) NOT NULL,
    description        CLOB,
    total_score        NUMBER DEFAULT 100,
    pass_score         NUMBER DEFAULT 60,
    time_limit_minutes NUMBER DEFAULT 10,
    time_limit_enabled NUMBER(1) DEFAULT 1,
    overtime_action    VARCHAR2(20) DEFAULT 'auto_submit',
    scoring_mode       VARCHAR2(10) DEFAULT 'even',
    custom_weights     CLOB,
    sort_order         NUMBER DEFAULT 0,
    created_by         NUMBER,
    created_at         TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await createTable('EXAM_TOPIC_LESSONS', `CREATE TABLE exam_topic_lessons (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    exam_topic_id   NUMBER NOT NULL,
    lesson_id       NUMBER NOT NULL,
    sort_order      NUMBER DEFAULT 0,
    CONSTRAINT uq_etl UNIQUE (exam_topic_id, lesson_id)
  )`);

  // ── Training Platform: 學習進度 ─────────────────────────────────────────────
  await createTable('USER_COURSE_PROGRESS', `CREATE TABLE user_course_progress (
    id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id             NUMBER NOT NULL,
    course_id           NUMBER NOT NULL,
    lesson_id           NUMBER,
    current_slide_index NUMBER DEFAULT 0,
    status              VARCHAR2(20) DEFAULT 'not_started',
    time_spent_seconds  NUMBER DEFAULT 0,
    started_at          TIMESTAMP,
    completed_at        TIMESTAMP,
    CONSTRAINT uq_user_course_lesson UNIQUE (user_id, course_id, lesson_id)
  )`);

  // ── Training Platform: 課程分享權限 ─────────────────────────────────────────
  await createTable('COURSE_ACCESS', `CREATE TABLE course_access (
    id              VARCHAR2(36) DEFAULT SYS_GUID() PRIMARY KEY,
    course_id       NUMBER NOT NULL,
    grantee_type    VARCHAR2(20) NOT NULL,
    grantee_id      VARCHAR2(100) NOT NULL,
    permission      VARCHAR2(20) DEFAULT 'view',
    granted_by      NUMBER,
    granted_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT uq_course_access UNIQUE (course_id, grantee_type, grantee_id)
  )`);

  // ── Training Platform: 學習路徑 ─────────────────────────────────────────────
  await createTable('LEARNING_PATHS', `CREATE TABLE learning_paths (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title       VARCHAR2(500) NOT NULL,
    description CLOB,
    created_by  NUMBER,
    is_public   NUMBER(1) DEFAULT 0,
    status      VARCHAR2(20) DEFAULT 'draft',
    created_at  TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at  TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await createTable('LEARNING_PATH_COURSES', `CREATE TABLE learning_path_courses (
    id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    path_id                 NUMBER NOT NULL,
    course_id               NUMBER NOT NULL,
    sort_order              NUMBER DEFAULT 0,
    is_required             NUMBER(1) DEFAULT 1,
    prerequisite_course_id  NUMBER,
    CONSTRAINT uq_path_course UNIQUE (path_id, course_id)
  )`);

  // ── Training Platform: 培訓專案 ─────────────────────────────────────────────
  await createTable('TRAINING_PROGRAMS', `CREATE TABLE training_programs (
    id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title               VARCHAR2(500) NOT NULL,
    description         CLOB,
    purpose             CLOB,
    created_by          NUMBER,
    status              VARCHAR2(20) DEFAULT 'draft',
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    learning_path_id    NUMBER,
    remind_before_days  NUMBER DEFAULT 3,
    notify_overdue      NUMBER(1) DEFAULT 1,
    email_enabled       NUMBER(1) DEFAULT 1,
    recurrence_type     VARCHAR2(20),
    recurrence_months   NUMBER,
    auto_reassign       NUMBER(1) DEFAULT 0,
    reset_mode          VARCHAR2(20) DEFAULT 'full',
    is_template         NUMBER(1) DEFAULT 0,
    template_source_id  NUMBER,
    created_at          TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at          TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await createTable('PROGRAM_COURSES', `CREATE TABLE program_courses (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    program_id  NUMBER NOT NULL,
    course_id   NUMBER NOT NULL,
    sort_order  NUMBER DEFAULT 0,
    is_required NUMBER(1) DEFAULT 1,
    CONSTRAINT uq_program_course UNIQUE (program_id, course_id)
  )`);

  await createTable('PROGRAM_TARGETS', `CREATE TABLE program_targets (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    program_id  NUMBER NOT NULL,
    target_type VARCHAR2(20) NOT NULL,
    target_id   VARCHAR2(100) NOT NULL,
    CONSTRAINT uq_program_target UNIQUE (program_id, target_type, target_id)
  )`);

  await createTable('PROGRAM_ASSIGNMENTS', `CREATE TABLE program_assignments (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    program_id      NUMBER NOT NULL,
    course_id       NUMBER NOT NULL,
    user_id         NUMBER NOT NULL,
    status          VARCHAR2(20) DEFAULT 'pending',
    due_date        DATE,
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP,
    score           NUMBER,
    passed          NUMBER(1),
    exempted_by     NUMBER,
    exempted_reason VARCHAR2(500),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT uq_prog_assign UNIQUE (program_id, course_id, user_id)
  )`);

  // ── Training Platform: 通知 ─────────────────────────────────────────────────
  await createTable('TRAINING_NOTIFICATIONS', `CREATE TABLE training_notifications (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     NUMBER NOT NULL,
    type        VARCHAR2(30) NOT NULL,
    title       VARCHAR2(500) NOT NULL,
    message     CLOB,
    course_id   NUMBER,
    link_url    VARCHAR2(500),
    is_read     NUMBER(1) DEFAULT 0,
    created_at  TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── Training Platform: 互動評分紀錄 ──────────────────────────────────────────
  await createTable('INTERACTION_RESULTS', `CREATE TABLE interaction_results (
    id                 NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id            NUMBER NOT NULL,
    slide_id           NUMBER NOT NULL,
    course_id          NUMBER NOT NULL,
    block_index        NUMBER DEFAULT 0,
    block_type         VARCHAR2(30),
    player_mode        VARCHAR2(10),
    action_log         CLOB,
    total_time_seconds NUMBER,
    steps_completed    NUMBER,
    total_steps        NUMBER,
    wrong_clicks       NUMBER,
    score              NUMBER,
    max_score          NUMBER,
    score_breakdown    CLOB,
    created_at         TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await createTable('COURSE_NOTIFICATION_SETTINGS', `CREATE TABLE course_notification_settings (
    id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id           NUMBER NOT NULL,
    remind_before_days  NUMBER DEFAULT 3,
    remind_overdue      NUMBER(1) DEFAULT 1,
    notify_on_complete  NUMBER(1) DEFAULT 1,
    notify_on_fail      NUMBER(1) DEFAULT 1,
    email_enabled       NUMBER(1) DEFAULT 1,
    CONSTRAINT uq_course_notif UNIQUE (course_id)
  )`);

  // ── Training Platform: 章節測驗成績 ─────────────────────────────────────────
  await createTable('LESSON_QUIZ_RESULTS', `CREATE TABLE lesson_quiz_results (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         NUMBER NOT NULL,
    course_id       NUMBER NOT NULL,
    lesson_id       NUMBER NOT NULL,
    source          VARCHAR2(20) DEFAULT 'classroom',
    session_id      VARCHAR2(36),
    score           NUMBER,
    max_score       NUMBER,
    passed          NUMBER(1) DEFAULT 0,
    completed_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT uq_lqr UNIQUE (user_id, course_id, lesson_id, session_id)
  )`);

  // Backfill LESSON_QUIZ_RESULTS from INTERACTION_RESULTS (one-time, only if table is empty)
  try {
    const count = await db.prepare('SELECT COUNT(*) AS cnt FROM lesson_quiz_results').get();
    if (count?.cnt === 0) {
      const irExists = await db.tableExists('INTERACTION_RESULTS');
      if (irExists) {
        const inserted = await db.prepare(`
          INSERT INTO lesson_quiz_results (user_id, course_id, lesson_id, source, session_id, score, max_score, passed, completed_at)
          SELECT ir.user_id, ir.course_id, cs.lesson_id,
                 'classroom', ir.session_id,
                 SUM(COALESCE(ir.weighted_score, ir.score)),
                 SUM(COALESCE(ir.weighted_max, ir.max_score)),
                 CASE WHEN SUM(COALESCE(ir.weighted_max, ir.max_score)) > 0
                   AND (SUM(COALESCE(ir.weighted_score, ir.score)) / SUM(COALESCE(ir.weighted_max, ir.max_score))) * 100
                       >= COALESCE(c.pass_score, 60)
                 THEN 1 ELSE 0 END,
                 MAX(ir.created_at)
          FROM interaction_results ir
          JOIN course_slides cs ON cs.id = ir.slide_id
          JOIN courses c ON c.id = ir.course_id
          WHERE ir.player_mode = 'test' AND ir.session_id IS NOT NULL
          GROUP BY ir.user_id, ir.course_id, cs.lesson_id, ir.session_id, c.pass_score
        `).run();
        console.log(`[Migration] Backfilled lesson_quiz_results from interaction_results`);
      }
    }
  } catch (e) {
    console.warn(`[Migration] lesson_quiz_results backfill: ${e.message}`);
  }

  // ── Training Platform: 翻譯表 ───────────────────────────────────────────────
  await createTable('COURSE_TRANSLATIONS', `CREATE TABLE course_translations (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id   NUMBER NOT NULL,
    lang        VARCHAR2(10) NOT NULL,
    title       VARCHAR2(500),
    description CLOB,
    translated_at TIMESTAMP DEFAULT SYSTIMESTAMP,
    is_auto     NUMBER(1) DEFAULT 1,
    CONSTRAINT uq_course_trans UNIQUE (course_id, lang)
  )`);

  await createTable('LESSON_TRANSLATIONS', `CREATE TABLE lesson_translations (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lesson_id   NUMBER NOT NULL,
    lang        VARCHAR2(10) NOT NULL,
    title       VARCHAR2(500),
    translated_at TIMESTAMP DEFAULT SYSTIMESTAMP,
    is_auto     NUMBER(1) DEFAULT 1,
    CONSTRAINT uq_lesson_trans UNIQUE (lesson_id, lang)
  )`);

  await createTable('SLIDE_TRANSLATIONS', `CREATE TABLE slide_translations (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slide_id      NUMBER NOT NULL,
    lang          VARCHAR2(10) NOT NULL,
    content_json  CLOB,
    notes         CLOB,
    audio_url     VARCHAR2(500),
    translated_at TIMESTAMP DEFAULT SYSTIMESTAMP,
    is_auto       NUMBER(1) DEFAULT 1,
    CONSTRAINT uq_slide_trans UNIQUE (slide_id, lang)
  )`);

  await createTable('QUIZ_TRANSLATIONS', `CREATE TABLE quiz_translations (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    question_id   NUMBER NOT NULL,
    lang          VARCHAR2(10) NOT NULL,
    question_json CLOB,
    explanation   CLOB,
    translated_at TIMESTAMP DEFAULT SYSTIMESTAMP,
    is_auto       NUMBER(1) DEFAULT 1,
    CONSTRAINT uq_quiz_trans UNIQUE (question_id, lang)
  )`);

  await createTable('CATEGORY_TRANSLATIONS', `CREATE TABLE category_translations (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id   NUMBER NOT NULL,
    lang          VARCHAR2(10) NOT NULL,
    name          VARCHAR2(200),
    translated_at TIMESTAMP DEFAULT SYSTIMESTAMP,
    is_auto       NUMBER(1) DEFAULT 1,
    CONSTRAINT uq_category_trans UNIQUE (category_id, lang)
  )`);

  // ── Training Platform: AI 助教對話紀錄 ──────────────────────────────────────
  await createTable('TUTOR_CONVERSATIONS', `CREATE TABLE tutor_conversations (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id       NUMBER NOT NULL,
    lesson_id       NUMBER,
    slide_id        NUMBER,
    user_id         NUMBER NOT NULL,
    question        CLOB NOT NULL,
    answer          CLOB,
    model_key       VARCHAR2(50),
    input_tokens    NUMBER DEFAULT 0,
    output_tokens   NUMBER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── Training Platform: 學習筆記 + 書籤 ─────────────────────────────────────
  await createTable('USER_COURSE_NOTES', `CREATE TABLE user_course_notes (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     NUMBER NOT NULL,
    course_id   NUMBER NOT NULL,
    slide_id    NUMBER,
    content     CLOB,
    bookmarked  NUMBER(1) DEFAULT 0,
    created_at  TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at  TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT uq_user_slide_note UNIQUE (user_id, slide_id)
  )`);

  // ── Training Platform: iframe 導引步驟（Phase 2 預留）──────────────────────
  await createTable('IFRAME_GUIDE_STEPS', `CREATE TABLE iframe_guide_steps (
    id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lesson_id         NUMBER NOT NULL,
    sort_order        NUMBER DEFAULT 0,
    target_url        VARCHAR2(1000) NOT NULL,
    instruction_text  CLOB,
    target_selector   VARCHAR2(500),
    expected_action   VARCHAR2(20),
    expected_value    VARCHAR2(500),
    audio_url         VARCHAR2(500),
    hint_text         CLOB,
    created_at        TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── Phase 2: 跨系統管理 ─────────────────────────────────────────────────────
  await createTable('TRAINING_SYSTEMS', `CREATE TABLE training_systems (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            VARCHAR2(200) NOT NULL,
    url             VARCHAR2(1000),
    description     CLOB,
    icon            VARCHAR2(50),
    login_url       VARCHAR2(1000),
    login_config    CLOB,
    help_source     VARCHAR2(20) DEFAULT 'manual',
    created_by      NUMBER,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await createTable('TEACHING_SCRIPTS', `CREATE TABLE teaching_scripts (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    system_id       NUMBER NOT NULL,
    module          VARCHAR2(200),
    title           VARCHAR2(500) NOT NULL,
    steps_json      CLOB,
    prerequisites   CLOB,
    estimated_time  NUMBER,
    sort_order      NUMBER DEFAULT 0,
    created_by      NUMBER,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── Phase 2: 錄製工作階段 ───────────────────────────────────────────────────
  await createTable('RECORDING_SESSIONS', `CREATE TABLE recording_sessions (
    id              VARCHAR2(36) PRIMARY KEY,
    course_id       NUMBER,
    lesson_id       NUMBER,
    system_id       NUMBER,
    script_id       NUMBER,
    status          VARCHAR2(20) DEFAULT 'recording',
    config_json     CLOB,
    steps_count     NUMBER DEFAULT 0,
    created_by      NUMBER NOT NULL,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    completed_at    TIMESTAMP
  )`);

  await createTable('RECORDING_STEPS', `CREATE TABLE recording_steps (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id      VARCHAR2(36) NOT NULL,
    step_number     NUMBER NOT NULL,
    action_type     VARCHAR2(20),
    screenshot_url  VARCHAR2(500),
    element_json    CLOB,
    viewport_json   VARCHAR2(200),
    page_url        VARCHAR2(1000),
    page_title      VARCHAR2(500),
    ai_regions_json CLOB,
    ai_instruction  CLOB,
    ai_narration    CLOB,
    final_regions_json CLOB,
    final_instruction  CLOB,
    is_sensitive    NUMBER(1) DEFAULT 0,
    mask_regions_json CLOB,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // ── Phase 2E: 截圖標註系統 ─────────────────────────────────────────────────
  await safeAddColumn('RECORDING_STEPS', 'ANNOTATIONS_JSON', 'CLOB');
  await safeAddColumn('RECORDING_STEPS', 'SCREENSHOT_RAW_URL', 'VARCHAR2(500)');

  // ── Phase 3A-2: 多語底圖 ──────────────────────────────────────────────────
  await safeAddColumn('RECORDING_STEPS', 'LANG', "VARCHAR2(10) DEFAULT 'zh-TW'");
  await safeAddColumn('SLIDE_TRANSLATIONS', 'IMAGE_OVERRIDES', 'CLOB');

  // ── Phase 3B: 多語獨立 Region ───────────────────────────────────────────────
  await safeAddColumn('SLIDE_TRANSLATIONS', 'REGIONS_JSON', 'CLOB');

  // ── Phase 3B-3: 課程 TTS 語音設定 ──────────────────────────────────────────
  await safeAddColumn('COURSES', 'SETTINGS_JSON', 'CLOB');

  // ── 問題反饋平台 ───────────────────────────────────────────────────────────

  await createTable('FEEDBACK_CATEGORIES', `CREATE TABLE feedback_categories (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR2(100) NOT NULL,
    description VARCHAR2(500),
    icon        VARCHAR2(50),
    sort_order  NUMBER DEFAULT 0,
    is_active   NUMBER(1) DEFAULT 1,
    created_at  TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at  TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await createTable('FEEDBACK_CATEGORY_TRANSLATIONS', `CREATE TABLE feedback_category_translations (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id NUMBER NOT NULL REFERENCES feedback_categories(id) ON DELETE CASCADE,
    lang        VARCHAR2(10) NOT NULL,
    name        VARCHAR2(100) NOT NULL,
    description VARCHAR2(500),
    CONSTRAINT uq_fb_cat_trans UNIQUE (category_id, lang)
  )`);

  await createTable('FEEDBACK_SLA_CONFIGS', `CREATE TABLE feedback_sla_configs (
    id                    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    priority              VARCHAR2(20) NOT NULL UNIQUE,
    first_response_hours  NUMBER NOT NULL,
    resolution_hours      NUMBER NOT NULL,
    escalation_enabled    NUMBER(1) DEFAULT 0,
    escalation_to         NUMBER REFERENCES users(id),
    created_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at            TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await createTable('FEEDBACK_TICKETS', `CREATE TABLE feedback_tickets (
    id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_no               VARCHAR2(30) NOT NULL UNIQUE,
    user_id                 NUMBER NOT NULL REFERENCES users(id),
    applicant_name          VARCHAR2(200),
    applicant_dept          VARCHAR2(200),
    applicant_employee_id   VARCHAR2(50),
    applicant_email         VARCHAR2(200),
    subject                 VARCHAR2(500) NOT NULL,
    description             CLOB,
    share_link              VARCHAR2(1000),
    category_id             NUMBER REFERENCES feedback_categories(id) ON DELETE SET NULL,
    priority                VARCHAR2(20) DEFAULT 'medium',
    tags                    CLOB,
    status                  VARCHAR2(20) DEFAULT 'open',
    assigned_to             NUMBER REFERENCES users(id),
    resolved_by             NUMBER REFERENCES users(id),
    resolution_note         CLOB,
    ai_assisted             NUMBER(1) DEFAULT 0,
    ai_resolved             NUMBER(1) DEFAULT 0,
    ai_model                VARCHAR2(100),
    satisfaction_rating     NUMBER(1),
    satisfaction_comment    VARCHAR2(1000),
    sla_due_first_response  TIMESTAMP,
    sla_due_resolution      TIMESTAMP,
    first_response_at       TIMESTAMP,
    sla_breached            NUMBER(1) DEFAULT 0,
    is_internal_log         NUMBER(1) DEFAULT 0,
    source                  VARCHAR2(50) DEFAULT 'web',
    source_session_id       VARCHAR2(100),
    created_at              TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at              TIMESTAMP DEFAULT SYSTIMESTAMP,
    resolved_at             TIMESTAMP,
    closed_at               TIMESTAMP,
    reopened_at             TIMESTAMP
  )`);

  await createTable('FEEDBACK_ATTACHMENTS', `CREATE TABLE feedback_attachments (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id   NUMBER NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
    message_id  NUMBER,
    file_name   VARCHAR2(500) NOT NULL,
    file_path   VARCHAR2(1000) NOT NULL,
    file_size   NUMBER,
    mime_type   VARCHAR2(100),
    uploaded_by NUMBER NOT NULL REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await createTable('FEEDBACK_MESSAGES', `CREATE TABLE feedback_messages (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id   NUMBER NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
    sender_id   NUMBER NOT NULL REFERENCES users(id),
    sender_role VARCHAR2(20) NOT NULL,
    content     CLOB NOT NULL,
    is_internal NUMBER(1) DEFAULT 0,
    is_email_sent NUMBER(1) DEFAULT 0,
    is_system   NUMBER(1) DEFAULT 0,
    created_at  TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await createTable('FEEDBACK_AI_ANALYSES', `CREATE TABLE feedback_ai_analyses (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id     NUMBER NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
    triggered_by  NUMBER NOT NULL REFERENCES users(id),
    input_summary CLOB,
    suggestion    CLOB,
    rag_sources   CLOB,
    model         VARCHAR2(100),
    input_tokens  NUMBER DEFAULT 0,
    output_tokens NUMBER DEFAULT 0,
    is_helpful    NUMBER(1),
    created_at    TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await createTable('FEEDBACK_NOTIFICATIONS', `CREATE TABLE feedback_notifications (
    id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     NUMBER NOT NULL REFERENCES users(id),
    ticket_id   NUMBER NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
    type        VARCHAR2(50) NOT NULL,
    title       VARCHAR2(500),
    message     CLOB,
    is_read     NUMBER(1) DEFAULT 0,
    created_at  TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  // feedback_conversation_archive: 工單結案/重開的完整原始快照（append-only, 永久保留）
  await createTable('FEEDBACK_CONVERSATION_ARCHIVE', `CREATE TABLE feedback_conversation_archive (
    id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id         NUMBER NOT NULL,
    ticket_no         VARCHAR2(30) NOT NULL,
    snapshot_at       TIMESTAMP DEFAULT SYSTIMESTAMP,
    snapshot_trigger  VARCHAR2(30),
    triggered_by      NUMBER,
    messages_json     CLOB,
    attachments_json  CLOB,
    ticket_snapshot   CLOB
  )`);

  // ── Feedback: 索引 ────────────────────────────────────────────────────────
  const safeCreateIndex = async (name, ddl) => {
    try { await db.prepare(ddl).run(); } catch (e) {
      if (!e.message?.includes('ORA-00955')) console.warn(`[Migration] index ${name}: ${e.message}`);
    }
  };
  await safeCreateIndex('IDX_FB_TICKETS_USER', 'CREATE INDEX idx_fb_tickets_user ON feedback_tickets(user_id)');
  await safeCreateIndex('IDX_FB_TICKETS_STATUS', 'CREATE INDEX idx_fb_tickets_status ON feedback_tickets(status)');
  await safeCreateIndex('IDX_FB_TICKETS_CATEGORY', 'CREATE INDEX idx_fb_tickets_category ON feedback_tickets(category_id)');
  await safeCreateIndex('IDX_FB_TICKETS_CREATED', 'CREATE INDEX idx_fb_tickets_created ON feedback_tickets(created_at)');
  await safeCreateIndex('IDX_FB_MSG_TICKET', 'CREATE INDEX idx_fb_msg_ticket ON feedback_messages(ticket_id)');
  await safeCreateIndex('IDX_FB_MSG_CREATED', 'CREATE INDEX idx_fb_msg_created ON feedback_messages(ticket_id, created_at)');
  await safeCreateIndex('IDX_FB_ATTACH_TICKET', 'CREATE INDEX idx_fb_attach_ticket ON feedback_attachments(ticket_id)');
  await safeCreateIndex('IDX_FB_NOTIF_USER', 'CREATE INDEX idx_fb_notif_user ON feedback_notifications(user_id, is_read)');
  await safeCreateIndex('IDX_FB_NOTIF_TICKET', 'CREATE INDEX idx_fb_notif_ticket ON feedback_notifications(ticket_id)');
  await safeCreateIndex('IDX_FCA_TICKET', 'CREATE INDEX idx_fca_ticket ON feedback_conversation_archive(ticket_id)');
  await safeCreateIndex('IDX_FCA_NO', 'CREATE INDEX idx_fca_no ON feedback_conversation_archive(ticket_no)');
  await safeCreateIndex('IDX_FCA_SNAPSHOT_AT', 'CREATE INDEX idx_fca_snapshot_at ON feedback_conversation_archive(snapshot_at)');

  // One-time cleanup: drop feedback-admin KB (被公開單一 KB 架構取代)
  try {
    const adminKb = await db.prepare("SELECT id FROM knowledge_bases WHERE name='feedback-admin'").get();
    const adminKbId = adminKb?.id ?? adminKb?.ID;
    if (adminKbId) {
      await db.prepare('DELETE FROM kb_chunks WHERE kb_id=?').run(adminKbId);
      await db.prepare('DELETE FROM kb_documents WHERE kb_id=?').run(adminKbId);
      await db.prepare('DELETE FROM knowledge_bases WHERE id=?').run(adminKbId);
      console.log('[Migration] Dropped legacy feedback-admin KB');
    }
  } catch (e) {
    console.warn('[Migration] drop feedback-admin KB:', e.message);
  }

  // ── Feedback: 預設分類種子資料 ────────────────────────────────────────────
  try {
    const catCount = await db.prepare('SELECT COUNT(*) AS cnt FROM feedback_categories').get();
    if (Number(catCount?.cnt ?? catCount?.CNT ?? 0) === 0) {
      const defaultCats = [
        { name: '系統操作問題', icon: 'monitor', sort: 1 },
        { name: 'AI 回答品質',  icon: 'bot',     sort: 2 },
        { name: '教育訓練',     icon: 'book-open', sort: 3 },
        { name: '帳號權限',     icon: 'key',     sort: 4 },
        { name: '功能建議',     icon: 'lightbulb', sort: 5 },
        { name: '其他',         icon: 'help-circle', sort: 6 },
      ];
      for (const c of defaultCats) {
        await db.prepare(
          'INSERT INTO feedback_categories (name, icon, sort_order) VALUES (?, ?, ?)'
        ).run(c.name, c.icon, c.sort);
      }
      console.log('[Migration] Seeded 6 default feedback categories');
    }
  } catch (e) {
    console.warn('[Migration] feedback categories seed:', e.message);
  }

  // ── Feedback: 預設 SLA 種子資料 ──────────────────────────────────────────
  try {
    const slaCount = await db.prepare('SELECT COUNT(*) AS cnt FROM feedback_sla_configs').get();
    if (Number(slaCount?.cnt ?? slaCount?.CNT ?? 0) === 0) {
      const defaultSla = [
        { priority: 'urgent', first: 1,  resolve: 4 },
        { priority: 'high',   first: 4,  resolve: 8 },
        { priority: 'medium', first: 8,  resolve: 24 },
        { priority: 'low',    first: 24, resolve: 72 },
      ];
      for (const s of defaultSla) {
        await db.prepare(
          'INSERT INTO feedback_sla_configs (priority, first_response_hours, resolution_hours) VALUES (?, ?, ?)'
        ).run(s.priority, s.first, s.resolve);
      }
      console.log('[Migration] Seeded 4 default SLA configs');
    }
  } catch (e) {
    console.warn('[Migration] feedback SLA seed:', e.message);
  }

  // ── ERP Tools: PL/SQL FUNCTION/PROCEDURE 工具化 ─────────────────────────────
  await createTable('ERP_TOOLS', `CREATE TABLE erp_tools (
    id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code                VARCHAR2(120) UNIQUE NOT NULL,
    name                VARCHAR2(200) NOT NULL,
    description         CLOB,
    tags                CLOB,
    db_owner            VARCHAR2(30)  NOT NULL,
    package_name        VARCHAR2(128),
    object_name         VARCHAR2(128) NOT NULL,
    overload            VARCHAR2(10),
    routine_type        VARCHAR2(20)  NOT NULL,
    metadata_json       CLOB,
    metadata_hash       VARCHAR2(64),
    metadata_checked_at TIMESTAMP,
    metadata_drifted    NUMBER(1) DEFAULT 0,
    access_mode         VARCHAR2(20) DEFAULT 'READ_ONLY',
    requires_approval   NUMBER(1) DEFAULT 0,
    allow_llm_auto      NUMBER(1) DEFAULT 1,
    allow_inject        NUMBER(1) DEFAULT 0,
    allow_manual        NUMBER(1) DEFAULT 1,
    params_json         CLOB,
    returns_json        CLOB,
    tool_schema_json    CLOB,
    inject_config_json  CLOB,
    max_rows_llm        NUMBER DEFAULT 50,
    max_rows_ui         NUMBER DEFAULT 1000,
    timeout_sec         NUMBER DEFAULT 30,
    proxy_skill_id      NUMBER,
    enabled             NUMBER(1) DEFAULT 1,
    created_by          NUMBER,
    created_at          TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at          TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);
  try { await db.prepare(`CREATE INDEX idx_erp_tools_code ON erp_tools(code)`).run(); } catch (_) {}
  try { await db.prepare(`CREATE INDEX idx_erp_tools_object ON erp_tools(db_owner, package_name, object_name)`).run(); } catch (_) {}

  await createTable('ERP_TOOL_TRANSLATIONS', `CREATE TABLE erp_tool_translations (
    id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tool_id             NUMBER NOT NULL REFERENCES erp_tools(id) ON DELETE CASCADE,
    lang                VARCHAR2(10) NOT NULL,
    name                VARCHAR2(200),
    description         CLOB,
    params_labels_json  CLOB,
    updated_at          TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT uq_erp_tool_lang UNIQUE (tool_id, lang)
  )`);

  // ERP 結果翻譯用專有名詞對照(給 Gemini Flash 當 glossary,降低亂翻機率)
  await createTable('ERP_TRANSLATION_GLOSSARY', `CREATE TABLE erp_translation_glossary (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_text  VARCHAR2(200) NOT NULL,
    en_text      VARCHAR2(300),
    vi_text      VARCHAR2(300),
    notes        VARCHAR2(500),
    scope        VARCHAR2(30) DEFAULT 'global',
    created_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT uq_erp_gloss_src UNIQUE (source_text)
  )`);

  await createTable('ERP_TOOL_AUDIT_LOG', `CREATE TABLE erp_tool_audit_log (
    id                NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tool_id           NUMBER NOT NULL REFERENCES erp_tools(id) ON DELETE CASCADE,
    user_id           NUMBER,
    session_id        VARCHAR2(36),
    trigger_source    VARCHAR2(30),
    access_mode       VARCHAR2(20),
    input_json        CLOB,
    output_sample     CLOB,
    result_cache_key  VARCHAR2(100),
    duration_ms       NUMBER,
    rows_returned     NUMBER,
    error_code        VARCHAR2(20),
    error_message     VARCHAR2(2000),
    created_at        TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);
  try { await db.prepare(`CREATE INDEX idx_erp_audit_tool_time ON erp_tool_audit_log(tool_id, created_at DESC)`).run(); } catch (_) {}
  try { await db.prepare(`CREATE INDEX idx_erp_audit_user_time ON erp_tool_audit_log(user_id, created_at DESC)`).run(); } catch (_) {}

  await createTable('ERP_TOOL_PENDING_APPROVAL', `CREATE TABLE erp_tool_pending_approval (
    id                   VARCHAR2(36) PRIMARY KEY,
    tool_id              NUMBER NOT NULL REFERENCES erp_tools(id) ON DELETE CASCADE,
    user_id              NUMBER,
    session_id           VARCHAR2(36),
    input_json           CLOB,
    reason               VARCHAR2(500),
    status               VARCHAR2(20) DEFAULT 'pending',
    approved_by          NUMBER,
    approved_at          TIMESTAMP,
    execution_result_id  NUMBER,
    expires_at           TIMESTAMP,
    created_at           TIMESTAMP DEFAULT SYSTIMESTAMP
  )`);

  await safeAddColumn('skills', 'erp_tool_id', 'NUMBER');

  // ERP Tool v2 欄位
  await safeAddColumn('erp_tools', 'rate_limit_per_user', 'NUMBER');
  await safeAddColumn('erp_tools', 'rate_limit_global',   'NUMBER');
  await safeAddColumn('erp_tools', 'rate_limit_window',   "VARCHAR2(20) DEFAULT 'minute'");
  await safeAddColumn('erp_tools', 'allow_dry_run',       'NUMBER(1) DEFAULT 1');
  await safeAddColumn('erp_tools', 'endpoint_mode',       "VARCHAR2(20) DEFAULT 'tool'");
  // Answer 模式輸出解析設定(分隔符、欄位名、圖表規格),全後端解析免 LLM
  await safeAddColumn('erp_tools', 'answer_output_format_json', 'CLOB');

  // Backfill:為舊 ERP tool 補建代理 skill row
  try {
    const proxySvc = require('./services/erpToolProxySkill');
    await proxySvc.backfillAll(db);
  } catch (e) {
    console.warn('[Migration] erp proxy skill backfill skipped:', e.message);
  }

  // 修正:ERP proxy skill 預設改非公開(需透過分享或手動公開)
  try {
    await db.prepare(`UPDATE skills SET is_public = 0 WHERE type = 'erp_proc' AND is_public = 1`).run();
  } catch (e) {
    console.warn('[Migration] erp proxy skill is_public fix:', e.message);
  }

  // 重新生成所有 ERP tool 的 tool_schema_json（讓 default_config 生效）
  // + Migration:把有動態 LOV 但沒設 llm_resolve_mode 的參數補上 'auto'
  try {
    const schemaGen = require('./services/erpToolSchemaGen');
    const allTools = await db.prepare(`SELECT id, code, name, description, access_mode, params_json, endpoint_mode, proxy_skill_id FROM erp_tools`).all();
    let paramsMigrated = 0;
    for (const row of (allTools || [])) {
      try {
        const id = row.id || row.ID;
        const params = JSON.parse(row.params_json || row.PARAMS_JSON || '[]');
        // Migration:補 llm_resolve_mode
        let changed = false;
        for (const p of params) {
          if (p.lov_config && p.lov_config.type && p.lov_config.type !== 'static') {
            if (!p.llm_resolve_mode) {
              p.llm_resolve_mode = 'auto';
              changed = true;
              paramsMigrated++;
            }
          }
        }
        const schema = schemaGen.generateToolSchema({
          code: row.code || row.CODE,
          name: row.name || row.NAME,
          description: row.description || row.DESCRIPTION,
          access_mode: row.access_mode || row.ACCESS_MODE,
          params,
        });
        const schemaStr = JSON.stringify(schema);
        if (changed) {
          await db.prepare(`UPDATE erp_tools SET params_json = ?, tool_schema_json = ? WHERE id = ?`)
            .run(JSON.stringify(params), schemaStr, id);
        } else {
          await db.prepare(`UPDATE erp_tools SET tool_schema_json = ? WHERE id = ?`).run(schemaStr, id);
        }
        const pid = row.proxy_skill_id || row.PROXY_SKILL_ID;
        if (pid) {
          await db.prepare(`UPDATE skills SET tool_schema = ? WHERE id = ?`).run(schemaStr, pid);
        }
      } catch (_) {}
    }
    if (allTools?.length) console.log(`[Migration] Regenerated tool_schema for ${allTools.length} ERP tools (auto-set llm_resolve_mode=auto for ${paramsMigrated} params)`);
  } catch (e) {
    console.warn('[Migration] erp tool_schema regen:', e.message);
  }

  // ── MCP User Identity (RS256 JWT) ──────────────────────────────────────────
  // per-server 開關:admin 明確勾選才發 X-User-Token,預設 0 保守(舊 MCP 不會壞)
  await safeAddColumn('MCP_SERVERS',   'SEND_USER_TOKEN', 'NUMBER(1) DEFAULT 0');
  // mcp_call_logs 追加欄位:事後審計用,可與 MCP 端 log 對齊單次呼叫
  await safeAddColumn('MCP_CALL_LOGS', 'USER_EMAIL',      'VARCHAR2(200)');
  await safeAddColumn('MCP_CALL_LOGS', 'JTI',             'VARCHAR2(64)');

  // ── MCP ServerInstructions(initialize.result.instructions)────────────────
  // 從 MCP server 的 initialize 回應保存下來,chat 組 systemInstruction 時注入
  await safeAddColumn('MCP_SERVERS', 'SERVER_INSTRUCTIONS', 'CLOB');
}

// ─── Default DB Source migration ───────────────────────────────────────────────

async function migrateDefaultDbSource(db) {
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
    await conn.execute(`ALTER TABLE ai_vector_store DROP PARTITION ${pName} UPDATE GLOBAL INDEXES`, [], { autoCommit: true });
    console.log(`[Partition] AI_VECTOR_STORE -${pName}`);
  } catch (e) {
    console.warn(`[Partition] dropVectorStorePartition(${jobId}):`, e.message);
  } finally {
    await conn.close();
  }
}

/**
 * 偵測 LIST-partitioned 表是否有 DEFAULT partition,有的話回傳其名字。
 * 因為 user_tab_partitions.high_value 是 LONG type,SQL 層不能 LIKE,
 * 改用 PL/SQL cursor loop 內 assign 給 LONG 變數再 SUBSTR 比對。
 */
async function _findDefaultPartition(conn, tableName) {
  try {
    const result = await conn.execute(
      `DECLARE
         v_name VARCHAR2(128) := NULL;
         v_hv   LONG;
       BEGIN
         FOR r IN (SELECT partition_name, high_value
                   FROM user_tab_partitions
                   WHERE table_name = :t) LOOP
           v_hv := r.high_value;
           IF UPPER(SUBSTR(v_hv, 1, 7)) = 'DEFAULT' THEN
             v_name := r.partition_name;
             EXIT;
           END IF;
         END LOOP;
         :pname := v_name;
       END;`,
      {
        t: tableName.toUpperCase(),
        pname: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 128 },
      }
    );
    return result.outBinds?.pname || null;
  } catch (e) {
    console.warn(`[Partition] _findDefaultPartition(${tableName}):`, e.message);
    return null;
  }
}

/**
 * 掃描 table 上所有 UNUSABLE 的 index / index partition,REBUILD 修復。
 * SPLIT/DROP PARTITION 沒帶 UPDATE GLOBAL INDEXES 時 global index 會壞掉,
 * 之後任何 INSERT 都會 ORA-01502。這個 helper 負責收尾。
 */
async function _rebuildUnusableIndexes(conn, tableName) {
  try {
    // 全域 outFormat 是 OBJECT(line 14),所以用欄位名取值,不能用 row[0]
    const idx = await conn.execute(
      `SELECT index_name FROM user_indexes WHERE table_name = :t AND status = 'UNUSABLE'`,
      { t: tableName.toUpperCase() }
    );
    for (const row of (idx.rows || [])) {
      const name = row.INDEX_NAME;
      if (!name) continue;
      try {
        await conn.execute(`ALTER INDEX ${name} REBUILD`, [], { autoCommit: true });
        console.log(`[Partition] REBUILD index ${name}`);
      } catch (e) {
        console.warn(`[Partition] REBUILD ${name} failed:`, e.message);
      }
    }
    const parts = await conn.execute(
      `SELECT index_name, partition_name FROM user_ind_partitions
        WHERE index_name IN (SELECT index_name FROM user_indexes WHERE table_name = :t)
          AND status = 'UNUSABLE'`,
      { t: tableName.toUpperCase() }
    );
    for (const row of (parts.rows || [])) {
      const iname = row.INDEX_NAME;
      const pname = row.PARTITION_NAME;
      if (!iname || !pname) continue;
      try {
        await conn.execute(`ALTER INDEX ${iname} REBUILD PARTITION ${pname}`, [], { autoCommit: true });
        console.log(`[Partition] REBUILD ${iname}.${pname}`);
      } catch (e) {
        console.warn(`[Partition] REBUILD ${iname}.${pname} failed:`, e.message);
      }
    }
  } catch (e) {
    console.warn(`[Partition] _rebuildUnusableIndexes(${tableName}):`, e.message);
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
    const escaped = kbId.replace(/'/g, "''");

    // 若表有 DEFAULT partition,必須用 SPLIT(ADD 會 ORA-14323)。
    // DBA 有可能在後期手動加 DEFAULT partition,所以這裡每次都偵測一次。
    const defPart = await _findDefaultPartition(conn, 'KB_CHUNKS');
    if (defPart) {
      // UPDATE GLOBAL INDEXES 必加,否則 SPLIT 後 PK / 其他 global index 會變 UNUSABLE,
      // 接著任何 INSERT 都會 ORA-01502。DBA 加 DEFAULT partition 後第一次 SPLIT 就遇到。
      await conn.execute(
        `ALTER TABLE kb_chunks SPLIT PARTITION ${defPart} VALUES ('${escaped}') INTO (PARTITION ${pName}, PARTITION ${defPart}) UPDATE GLOBAL INDEXES`,
        [], { autoCommit: true }
      );
      console.log(`[Partition] KB_CHUNKS SPLIT ${defPart} → +${pName}`);
      await _rebuildUnusableIndexes(conn, 'KB_CHUNKS');
    } else {
      await conn.execute(
        `ALTER TABLE kb_chunks ADD PARTITION ${pName} VALUES ('${escaped}')`,
        [], { autoCommit: true }
      );
      console.log(`[Partition] KB_CHUNKS +${pName}`);
    }
  } catch (e) {
    // ORA-14323 已不應該再發生(會走 SPLIT 分支),其他 error 印出觀察
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
    await conn.execute(`ALTER TABLE kb_chunks DROP PARTITION ${pName} UPDATE GLOBAL INDEXES`, [], { autoCommit: true });
    console.log(`[Partition] KB_CHUNKS -${pName}`);
    await _rebuildUnusableIndexes(conn, 'KB_CHUNKS');
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
