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
function lowercaseKeys(obj) {
  if (!obj) return obj;
  if (Array.isArray(obj)) return obj.map(lowercaseKeys);
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v])
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
    return bp.map((p) => (p === undefined ? null : p));
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
        // Try RETURNING id first; if column 'id' doesn't exist, fallback to plain insert
        try {
          const sqlWithRet = `${this.sql} RETURNING id INTO :__ret_id`;
          const bpWithRet  = [...bindParams, { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }];
          result = await conn.execute(sqlWithRet, bpWithRet, { autoCommit: true });
          const retVal = result.outBinds?.[result.outBinds.length - 1];
          return {
            lastInsertRowid: Array.isArray(retVal) ? retVal[0] : retVal,
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
      const result = await conn.execute(this.sql, bindParams, { maxRows: 1 });
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
      const result = await conn.execute(this.sql, bindParams);
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

// ─── Exports (same shape as database.js) ─────────────────────────────────────
const oracleDbExports = {
  db: null,
  init: async () => {
    const wrapper = await initializeOracleDB();
    oracleDbExports.db = wrapper;
    return wrapper;
  },
  close: async () => {
    if (pool) { await pool.close(10); pool = null; oracleDbExports.db = null; }
  },
  getPool: () => pool,
};

module.exports = oracleDbExports;
