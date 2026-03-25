'use strict';

/**
 * DB Adapter 基底類別（抽象介面）
 * Phase 1: Oracle 實作 → oracleAdapter.js
 * Phase 2+: MySQL → mysqlAdapter.js, MSSQL → mssqlAdapter.js
 */
class BaseDbAdapter {
  /** @returns {'oracle'|'mysql'|'mssql'} */
  get dialect()         { throw new Error(`${this.constructor.name}: dialect not implemented`); }
  /** 預設連接埠 @returns {number} */
  get defaultPort()     { throw new Error(`${this.constructor.name}: defaultPort not implemented`); }
  /**
   * IN 子句最大元素數
   * Oracle: 999 (ORA-01795), MySQL: 10000 (建議), MSSQL: 2100 (參數上限)
   * @returns {number}
   */
  get maxInClauseSize() { throw new Error(`${this.constructor.name}: maxInClauseSize not implemented`); }

  /**
   * 建立 ReadOnly pool proxy
   * @param {Object} config — 來自 ai_db_sources
   * @returns {Promise<Object>} ReadOnly pool proxy
   */
  async createPool(config) { throw new Error(`${this.constructor.name}: createPool not implemented`); }

  /** 關閉 pool */
  async closePool(pool)   { throw new Error(`${this.constructor.name}: closePool not implemented`); }

  /**
   * 測試連線
   * @param {Object} config
   * @returns {Promise<{ok:boolean, message:string, latency_ms:number}>}
   */
  async ping(config)      { throw new Error(`${this.constructor.name}: ping not implemented`); }

  /** pool.getConnection() — 回傳 ReadOnly connection proxy */
  async getConnection(pool) { return pool.getConnection(); }

  /** 釋放連線 */
  async releaseConnection(conn) {
    try { await conn.close(); } catch (_) {}
  }

  /**
   * 執行 SQL（conn 已是 ReadOnly proxy，內部已驗證）
   * @param {Object} conn
   * @param {string} sql
   * @param {Array|Object} binds
   * @param {Object} opts — { maxRows, timeout }
   * @returns {Promise<{rows:Object[], columns:string[]}>}
   */
  async execute(conn, sql, binds, opts = {}) {
    throw new Error(`${this.constructor.name}: execute not implemented`);
  }

  /**
   * SQL 唯讀驗證（違規拋出 Error）
   * @param {string} sql
   */
  assertReadOnly(sql) { throw new Error(`${this.constructor.name}: assertReadOnly not implemented`); }

  /** Route 層快速驗證包裝 */
  validateSql(sql) {
    this.assertReadOnly(sql);
    return sql.trim();
  }

  /**
   * AI Prompt 方言規則注入
   * @returns {{expertTitle:string, rules:string[], forbidden:string[]}}
   */
  getDialectPrompt() { throw new Error(`${this.constructor.name}: getDialectPrompt not implemented`); }

  /**
   * 正規化查詢結果（欄位小寫、Date→ISO string）
   * @param {Object[]} rows
   * @returns {Object[]}
   */
  normalizeRows(rows) {
    return (rows || []).map(r =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k.toLowerCase(),
          v instanceof Date ? v.toISOString() : v,
        ])
      )
    );
  }

  /**
   * Bind variable 轉換（預設 Oracle :name 語法，不做轉換）
   * MySQL 實作：:name → ? (positional)
   * MSSQL 實作：:name → @name
   * @param {string} sql
   * @param {Object} namedBinds — { paramName: value }
   * @returns {{ sql:string, binds:Object|Array }}
   */
  normalizeBinds(sql, namedBinds) {
    return { sql, binds: namedBinds };
  }
}

module.exports = BaseDbAdapter;
