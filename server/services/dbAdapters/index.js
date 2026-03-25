'use strict';

const { oracleAdapter } = require('./oracleAdapter');

/**
 * DB Adapter factory
 * Phase 1: Oracle only
 * Phase 2+: 加 mysql, mssql case
 */
function getAdapter(dbType) {
  switch ((dbType || 'oracle').toLowerCase()) {
    case 'oracle':
      return oracleAdapter;
    // Phase 2: case 'mysql': return require('./mysqlAdapter').mysqlAdapter;
    // Phase 3: case 'mssql': return require('./mssqlAdapter').mssqlAdapter;
    default:
      throw new Error(`不支援的資料庫類型: ${dbType}（目前僅支援 oracle）`);
  }
}

module.exports = { getAdapter };
