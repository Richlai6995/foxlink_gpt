/**
 * Oracle ERP Database Service
 * Connects to EBS Oracle DB (optional — gracefully degrades if not configured)
 */

// Lazy-load oracledb to avoid crashing if the native module isn't available
let _oracledb = null;
function getOracledb() {
  if (_oracledb) return _oracledb;
  try {
    _oracledb = require('oracledb');
    return _oracledb;
  } catch (e) {
    throw new Error(`oracledb module failed to load: ${e.message}`);
  }
}

let clientInitialized = false;

function initClient() {
  if (clientInitialized) return;
  clientInitialized = true;
  const oracledb = getOracledb();
  try {
    if (process.env.ORACLE_HOME) {
      oracledb.initOracleClient({ libDir: process.env.ORACLE_HOME });
      console.log('[ERP] Oracle Thick client initialized from ORACLE_HOME');
    } else {
      console.log('[ERP] Oracle Thin mode (no ORACLE_HOME set)');
    }
  } catch (e) {
    console.warn('[ERP] Oracle client init warning:', e.message);
  }
}

function isConfigured() {
  return !!(process.env.ERP_DB_HOST && process.env.ERP_DB_USER && process.env.ERP_DB_USER_PASSWORD);
}

function getConfig() {
  return {
    user: process.env.ERP_DB_USER,
    password: process.env.ERP_DB_USER_PASSWORD,
    connectString: `${process.env.ERP_DB_HOST}:${process.env.ERP_DB_PORT || 1521}/${process.env.ERP_DB_SERVICE_NAME}`,
  };
}

async function execute(sql, binds = {}) {
  if (!isConfigured()) return null;
  initClient();
  const oracledb = getOracledb();
  let conn;
  try {
    conn = await oracledb.getConnection(getConfig());
    const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return result;
  } finally {
    if (conn) await conn.close();
  }
}

/**
 * Fetch employee org data from Oracle for a list of employee numbers.
 * Returns array of rows with org hierarchy info.
 */
async function getEmployeeOrgData(employeeNos) {
  if (!employeeNos || employeeNos.length === 0) return [];
  if (!isConfigured()) return [];

  initClient();

  // Build bind variables for IN clause
  const binds = {};
  const inList = employeeNos.map((no, i) => {
    const key = `p${i}`;
    binds[key] = String(no);
    return `:${key}`;
  }).join(',');

  const sql = `
    SELECT
      EE.C_NAME,
      EE.EMPLOYEE_NO,
      EE.EMAIL,
      EE.DEPT_CODE,
      EE.DEPT_NAME,
      EE.PROFIT_CENTER,
      OCF.PROFIT_CENTER_NAME,
      OCF.ORG_SECTION,
      OCF.ORG_SECTION_NAME,
      OCF.ORG_GROUP_NAME,
      ED.FACTORY_CODE,
      EE.END_DATE
    FROM FL_EMP_EXP_ALL EE,
         FL_EMP_DEPT ED,
         (
           SELECT CF.ORG_GROUP_NAME,
                  CF.ORG_SECTION,
                  CF.ORG_SECTION_NAME,
                  CF.PROFIT_CENTER,
                  CF.PROFIT_CENTER_NAME
           FROM org_code_factory CF
           WHERE CF.DATE_TO IS NULL
           GROUP BY CF.ORG_GROUP_NAME, CF.ORG_SECTION, CF.ORG_SECTION_NAME,
                    CF.PROFIT_CENTER, CF.PROFIT_CENTER_NAME
         ) OCF
    WHERE ED.STOP_DATE IS NULL
      AND EE.CURRENT_FLAG = 'Y'
      AND EE.DEPT_CODE = ED.DEPT_CODE
      AND EE.PROFIT_CENTER = OCF.PROFIT_CENTER(+)
      AND EE.EMPLOYEE_NO IN (${inList})
  `;

  try {
    const result = await execute(sql, binds);
    return result ? result.rows : [];
  } catch (e) {
    console.error('[ERP] getEmployeeOrgData error:', e.message);
    return [];
  }
}

module.exports = { isConfigured, execute, getEmployeeOrgData };
