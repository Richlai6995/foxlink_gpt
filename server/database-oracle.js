/**
 * Oracle 23 AI Database Layer
 * Async API mirror of database.js (sql.js wrapper)
 * All prepare().run/get/all() return Promises
 */
require('dotenv').config();
const oracledb = require('oracledb');

// Return rows as plain objects; fetch CLOB/NCLOB as string
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];

let pool = null;

// Convert SQLite-style ? placeholders → Oracle :1 :2 ...
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `:${++i}`);
}

// Oracle returns column names in UPPERCASE — normalise to lowercase
function lowercaseKeys(obj) {
  if (!obj) return obj;
  if (Array.isArray(obj)) return obj.map(lowercaseKeys);
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v])
  );
}

// Normalise bind params array
function normaliseParams(params) {
  const bp = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return bp.map((p) => (p === undefined ? null : p));
}

// ─── Statement Wrapper ────────────────────────────────────────────────────────
class OracleStatementWrapper {
  constructor(pool, sql) {
    this.pool = pool;
    this.sql = convertPlaceholders(sql);
  }

  /**
   * Execute INSERT / UPDATE / DELETE
   * For INSERT with GENERATED AS IDENTITY, pass returningCol to get the new ID.
   * e.g. stmt.run([val1, val2], 'id')
   */
  async run(...params) {
    // Allow: run(p1, p2, ...) or run([p1, p2])
    // Also allow: run([p1, p2], 'returningCol') — last string arg = returning col
    let returningCol = null;
    let rawParams = params;
    if (params.length >= 1 && typeof params[params.length - 1] === 'string' &&
        !this.sql.trim().toUpperCase().startsWith('SELECT')) {
      // only treat last string as returning col if it looks like a column name (no spaces)
      const last = params[params.length - 1];
      if (/^\w+$/.test(last)) {
        returningCol = last;
        rawParams = params.slice(0, -1);
      }
    }
    const bindParams = normaliseParams(rawParams);

    const conn = await this.pool.getConnection();
    try {
      let sqlToRun = this.sql;
      let options = { autoCommit: true };

      if (returningCol) {
        sqlToRun = `${this.sql} RETURNING ${returningCol} INTO :__ret_id`;
        bindParams.push({ dir: oracledb.BIND_OUT, type: oracledb.NUMBER });
      }

      const result = await conn.execute(sqlToRun, bindParams, options);
      const lastInsertRowid = returningCol
        ? result.outBinds?.[result.outBinds.length - 1]?.[0] ?? null
        : null;

      return {
        lastInsertRowid,
        changes: result.rowsAffected || 0,
      };
    } finally {
      await conn.close();
    }
  }

  /** Execute SELECT, return first row or null */
  async get(...params) {
    const bindParams = normaliseParams(params);
    const conn = await this.pool.getConnection();
    try {
      const result = await conn.execute(this.sql, bindParams, { maxRows: 1 });
      return lowercaseKeys(result.rows?.[0] ?? null);
    } finally {
      await conn.close();
    }
  }

  /** Execute SELECT, return all rows */
  async all(...params) {
    const bindParams = normaliseParams(params);
    const conn = await this.pool.getConnection();
    try {
      const result = await conn.execute(this.sql, bindParams);
      return lowercaseKeys(result.rows ?? []);
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

  /**
   * Execute raw SQL (DDL or multi-statement).
   * Statements separated by ; are run individually.
   */
  async exec(sql) {
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);

    const conn = await this.pool.getConnection();
    try {
      for (const stmt of statements) {
        await conn.execute(stmt, [], { autoCommit: true });
      }
    } finally {
      await conn.close();
    }
  }

  /**
   * Execute DDL and silently ignore ORA-00955 (table/index already exists).
   * Useful for idempotent schema init.
   */
  async execDDL(sql) {
    const conn = await this.pool.getConnection();
    try {
      await conn.execute(sql, [], { autoCommit: true });
    } catch (e) {
      // ORA-00955: name is already used  |  ORA-01408: index already indexed col
      if (e.errorNum === 955 || e.errorNum === 1408 || e.errorNum === 1430) return;
      throw e;
    } finally {
      await conn.close();
    }
  }

  /** Convenience: execute single SELECT and return all rows */
  async query(sql, params = []) {
    return this.prepare(sql).all(...params);
  }

  /** Convenience: execute single SELECT and return first row */
  async queryOne(sql, params = []) {
    return this.prepare(sql).get(...params);
  }

  /** Check whether a column exists in a table (Oracle data dictionary) */
  async columnExists(table, column) {
    const row = await this.queryOne(
      `SELECT COUNT(*) AS cnt FROM user_tab_columns
       WHERE UPPER(table_name)=UPPER(?) AND UPPER(column_name)=UPPER(?)`,
      [table, column]
    );
    return (row?.cnt ?? 0) > 0;
  }

  /** Check whether a table exists */
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
      if (!e.message?.includes('already been called')) {
        console.warn('[Oracle] initOracleClient:', e.message);
      }
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

  console.log('[Oracle] Connection pool created →', connectString);
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
    if (pool) {
      await pool.close(10);
      pool = null;
      oracleDbExports.db = null;
    }
  },

  getPool: () => pool,
};

module.exports = oracleDbExports;
