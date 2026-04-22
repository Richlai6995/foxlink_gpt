'use strict';

const crypto   = require('crypto');
const oracledb = require('oracledb');
const BaseDbAdapter = require('./base');

// ── Oracle SQL 唯讀驗證 ───────────────────────────────────────────────────────
const ORACLE_FORBIDDEN    = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|MERGE|UPSERT|GRANT|REVOKE|EXECUTE|DBMS_\w+|UTL_\w+)\b/i;
const ORACLE_FOR_UPDATE   = /\bFOR\s+UPDATE\b/i;

function assertOracleReadOnly(sql) {
  const stripped = sql
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();
  // 允許 SELECT 或 WITH (CTE) 開頭;CTE body 若含 DML 仍會被 ORACLE_FORBIDDEN 擋下
  if (!/^\s*(SELECT|WITH)\b/i.test(stripped)) {
    throw new Error(`[Oracle 唯讀保護] 僅允許 SELECT / WITH (CTE)，已拒絕: ${stripped.substring(0, 80).replace(/\s+/g, ' ')}`);
  }
  if (ORACLE_FORBIDDEN.test(stripped)) {
    throw new Error('[Oracle 唯讀保護] SQL 含有禁止關鍵字（DML/DDL/系統 Package），已拒絕執行');
  }
  if (ORACLE_FOR_UPDATE.test(stripped)) {
    throw new Error('[Oracle 唯讀保護] 禁止 FOR UPDATE（會鎖定資料列），已拒絕執行');
  }
  if (/;\s*\S/.test(stripped)) {
    throw new Error('[Oracle 唯讀保護] 禁止多語句，已拒絕執行');
  }
}

// ── ReadOnly Proxy（Oracle 連線） ─────────────────────────────────────────────
class ReadOnlyConnectionProxy {
  #conn
  constructor(conn) { this.#conn = conn; }

  async execute(sql, binds = [], opts = {}) {
    assertOracleReadOnly(sql);
    return this.#conn.execute(sql, binds, opts);
  }
  queryStream(sql, binds = [], opts = {}) {
    assertOracleReadOnly(sql);
    return this.#conn.queryStream(sql, binds, opts);
  }
  async close() { return this.#conn.close(); }

  // ❌ 封鎖所有寫入操作
  async executeMany()    { throw new Error('[Oracle 唯讀保護] 禁止 executeMany'); }
  async commit()         { throw new Error('[Oracle 唯讀保護] 禁止 commit'); }
  async rollback()       { throw new Error('[Oracle 唯讀保護] 禁止 rollback'); }
  async changePassword() { throw new Error('[Oracle 唯讀保護] 禁止 changePassword'); }
  async shutdown()       { throw new Error('[Oracle 唯讀保護] 禁止 shutdown'); }
  async startup()        { throw new Error('[Oracle 唯讀保護] 禁止 startup'); }
  getSodaDatabase()      { throw new Error('[Oracle 唯讀保護] 禁止 getSodaDatabase'); }
  async getQueue()       { throw new Error('[Oracle 唯讀保護] 禁止 getQueue'); }
  async subscribe()      { throw new Error('[Oracle 唯讀保護] 禁止 subscribe'); }
  async createLob()      { throw new Error('[Oracle 唯讀保護] 禁止 createLob'); }
  async beginSessionlessTransaction()   { throw new Error('[Oracle 唯讀保護] 禁止 transaction'); }
  async resumeSessionlessTransaction()  { throw new Error('[Oracle 唯讀保護] 禁止 transaction'); }
  async suspendSessionlessTransaction() { throw new Error('[Oracle 唯讀保護] 禁止 transaction'); }
  async tpcBegin()    { throw new Error('[Oracle 唯讀保護] 禁止 TPC'); }
  async tpcCommit()   { throw new Error('[Oracle 唯讀保護] 禁止 TPC'); }
  async tpcRollback() { throw new Error('[Oracle 唯讀保護] 禁止 TPC'); }
}

// ── ReadOnly Pool Proxy ───────────────────────────────────────────────────────
class ReadOnlyPoolProxy {
  #pool
  constructor(rawPool) { this.#pool = rawPool; }
  async getConnection() {
    return new ReadOnlyConnectionProxy(await this.#pool.getConnection());
  }
  async close() {
    try { await this.#pool.close(0); } catch (_) {}
  }
}

// ── OracleAdapter ─────────────────────────────────────────────────────────────
class OracleAdapter extends BaseDbAdapter {
  get dialect()         { return 'oracle'; }
  get defaultPort()     { return 1521; }
  get maxInClauseSize() { return 999; }   // ORA-01795

  assertReadOnly(sql) { assertOracleReadOnly(sql); }

  /**
   * 建立唯讀 Oracle 連線池
   * config: { host, port, service_name, username, password, pool_min, pool_max, pool_timeout }
   */
  async createPool(config) {
    const {
      host, port = 1521, service_name, username, password,
      pool_min = 1, pool_max = 5, pool_timeout = 60,
    } = config;
    if (!host || !service_name || !username || !password) {
      throw new Error('Oracle 連線設定不完整（需要 host, service_name, username, password）');
    }
    const alias = `src_${crypto.randomBytes(6).toString('hex')}`;
    const rawPool = await oracledb.createPool({
      poolAlias:     alias,
      user:          username,
      password:      password,
      connectString: `${host}:${port}/${service_name}`,
      poolMin: pool_min, poolMax: pool_max, poolIncrement: 1, poolTimeout: pool_timeout,
      sessionCallback: async (conn, _tag, cb) => {
        try { await conn.execute(`ALTER SESSION SET NLS_LANGUAGE='AMERICAN' NLS_TERRITORY='AMERICA'`); } catch (_) {}
        cb();
      },
    });
    console.log(`[OracleAdapter] Pool created: ${username}@${host}:${port}/${service_name} (alias=${alias})`);
    return new ReadOnlyPoolProxy(rawPool);
  }

  async closePool(pool) {
    try { await pool.close(); } catch (_) {}
  }

  /** 測試連線（不建 pool，直接單連線） */
  async ping(config) {
    const { host, port = 1521, service_name, username, password } = config;
    const start = Date.now();
    let conn;
    try {
      conn = await oracledb.getConnection({
        user:          username,
        password:      password,
        connectString: `${host}:${port}/${service_name}`,
      });
      await conn.execute('SELECT 1 FROM DUAL');
      return { ok: true, message: 'OK', latency_ms: Date.now() - start };
    } catch (e) {
      return { ok: false, message: e.message, latency_ms: Date.now() - start };
    } finally {
      try { if (conn) await conn.close(); } catch (_) {}
    }
  }

  /**
   * 執行 SQL — conn 是 ReadOnlyConnectionProxy，內部已驗證
   * @returns {{rows:Object[], columns:string[]}}
   */
  async execute(conn, sql, binds = [], opts = {}) {
    const result = await conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      ...opts,
    });
    return {
      rows:    this.normalizeRows(result.rows || []),
      columns: (result.metaData || []).map(m => m.name.toLowerCase()),
    };
  }

  getDialectPrompt() {
    return {
      expertTitle: 'Oracle SQL 專家',
      rules: [
        '用 NVL() 或 COALESCE() 處理 NULL',
        '用 FETCH FIRST N ROWS ONLY 限制筆數（禁止 LIMIT）',
        '日期函數用 TO_DATE() / TO_CHAR()',
        '字串串接用 ||',
        '條件表達式用 CASE WHEN 或 DECODE()',
        '目前時間用 SYSDATE 或 SYSTIMESTAMP',
        '資料列編號用 ROWNUM 或 ROW_NUMBER() OVER(...)',
      ],
      forbidden: [
        'LIMIT（MySQL/PostgreSQL 語法）',
        'TOP（MSSQL 語法）',
        'IFNULL（MySQL 語法，請用 NVL 或 COALESCE）',
        'ISNULL（MSSQL 語法，請用 NVL 或 COALESCE）',
        'NOW()（MySQL 語法，請用 SYSDATE）',
        'GETDATE()（MSSQL 語法，請用 SYSDATE）',
        '||（不可用於 MySQL — 在 MySQL 中為 OR 運算子）',
      ],
    };
  }
}

const oracleAdapter = new OracleAdapter();

module.exports = { OracleAdapter, oracleAdapter, assertOracleReadOnly, ReadOnlyConnectionProxy, ReadOnlyPoolProxy };
