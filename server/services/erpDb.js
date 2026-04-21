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
      ED.DEPT_DESC AS DEPT_NAME,
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

/**
 * 間接員工人數 by 利潤中心
 * 條件: CURRENT_FLAG='Y', DIT_CODE='I', END_DATE IS NULL
 * 回傳 Map<profit_center, count>
 */
async function getIndirectEmpCountByPC() {
  if (!isConfigured()) return new Map();
  initClient();
  const sql = `
    SELECT PROFIT_CENTER, COUNT(1) AS CNT
    FROM foxfl.fl_emp_exp_all
    WHERE CURRENT_FLAG = 'Y'
      AND DIT_CODE = 'I'
      AND END_DATE IS NULL
    GROUP BY PROFIT_CENTER
  `;
  try {
    const result = await execute(sql);
    const map = new Map();
    for (const r of (result?.rows || [])) {
      map.set(r.PROFIT_CENTER || '', r.CNT || 0);
    }
    return map;
  } catch (e) {
    console.error('[ERP] getIndirectEmpCountByPC error:', e.message);
    return new Map();
  }
}

/**
 * 所有利潤中心清單 (去重)
 * 來源: APPS.FL_ORG_EMP_DEPT_MV
 * @param {boolean} onlyFoxlinkGroup - true 則限 CO_GROUP='正崴集團'
 */
async function getAllProfitCenters(onlyFoxlinkGroup = false) {
  if (!isConfigured()) return [];
  initClient();
  const sql = `
    SELECT DISTINCT PROFIT_CENTER, PROFIT_CENTER_NAME,
           ORG_SECTION, ORG_SECTION_NAME, ORG_GROUP_NAME
    FROM APPS.FL_ORG_EMP_DEPT_MV
    WHERE PROFIT_CENTER IS NOT NULL
      ${onlyFoxlinkGroup ? `AND CO_GROUP = '正崴集團'` : ''}
  `;
  try {
    const result = await execute(sql);
    return (result?.rows || []).map((r) => ({
      profit_center: r.PROFIT_CENTER || '',
      profit_center_name: r.PROFIT_CENTER_NAME || '',
      org_section: r.ORG_SECTION || '',
      org_section_name: r.ORG_SECTION_NAME || '',
      org_group_name: r.ORG_GROUP_NAME || '',
    }));
  } catch (e) {
    console.error('[ERP] getAllProfitCenters error:', e.message);
    return [];
  }
}

/**
 * 間接員工人數 by 利潤中心 × 廠區
 * FOXFL.FL_EMP_EXP_ALL 沒有 FACTORY_CODE,需透過 DEPT_CODE JOIN APPS.FL_ORG_EMP_DEPT_MV 取得。
 * 同 DEPT_CODE 在 MV 裡可能因 ORG_ID / ORG_CODE 展開成多列,先用 MAX(FACTORY_CODE) GROUP BY DEPT_CODE 去重,避免計數放大。
 * 回傳 Map<`${pc}|${factory}`, count>;factory 可能為空字串(DEPT_CODE 在 MV 裡 FACTORY_CODE 為 null 或 JOIN 不到)
 */
async function getIndirectEmpCountByPCFactory() {
  if (!isConfigured()) return new Map();
  initClient();
  const sql = `
    SELECT EE.PROFIT_CENTER, DMAP.FACTORY_CODE, COUNT(1) AS CNT
    FROM foxfl.fl_emp_exp_all EE
    LEFT JOIN (
      SELECT DEPT_CODE, MAX(FACTORY_CODE) AS FACTORY_CODE
      FROM APPS.FL_ORG_EMP_DEPT_MV
      WHERE DEPT_CODE IS NOT NULL AND FACTORY_CODE IS NOT NULL
      GROUP BY DEPT_CODE
    ) DMAP ON EE.DEPT_CODE = DMAP.DEPT_CODE
    WHERE EE.CURRENT_FLAG = 'Y'
      AND EE.DIT_CODE = 'I'
      AND EE.END_DATE IS NULL
    GROUP BY EE.PROFIT_CENTER, DMAP.FACTORY_CODE
  `;
  try {
    const result = await execute(sql);
    const map = new Map();
    for (const r of (result?.rows || [])) {
      const key = `${r.PROFIT_CENTER || ''}|${r.FACTORY_CODE || ''}`;
      map.set(key, r.CNT || 0);
    }
    return map;
  } catch (e) {
    console.error('[ERP] getIndirectEmpCountByPCFactory error:', e.message);
    return new Map();
  }
}

/**
 * 所有在職「間接員工」清單（CURRENT_FLAG='Y', DIT_CODE='I', END_DATE IS NULL）
 * 用於「顯示所有員工」分析：找出未建立帳號 / 未使用系統的人
 * 不限正崴集團（依需求）
 */
async function getAllIndirectEmployees() {
  if (!isConfigured()) return [];
  initClient();

  const sql = `
    SELECT
      EE.C_NAME,
      EE.EMPLOYEE_NO,
      EE.EMAIL,
      EE.DEPT_CODE,
      ED.DEPT_DESC AS DEPT_NAME,
      EE.PROFIT_CENTER,
      OCF.PROFIT_CENTER_NAME,
      OCF.ORG_SECTION,
      OCF.ORG_SECTION_NAME,
      OCF.ORG_GROUP_NAME,
      ED.FACTORY_CODE
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
      AND EE.END_DATE IS NULL
      AND EE.DIT_CODE = 'I'
      AND EE.DEPT_CODE = ED.DEPT_CODE
      AND EE.PROFIT_CENTER = OCF.PROFIT_CENTER(+)
  `;

  try {
    const result = await execute(sql);
    return result ? result.rows : [];
  } catch (e) {
    console.error('[ERP] getAllIndirectEmployees error:', e.message);
    return [];
  }
}

async function getConnection() {
  if (!isConfigured()) throw new Error('ERP DB not configured');
  initClient();
  const oracledb = getOracledb();
  return await oracledb.getConnection(getConfig());
}

module.exports = { isConfigured, execute, getConnection, getOracledb, getEmployeeOrgData, getIndirectEmpCountByPC, getIndirectEmpCountByPCFactory, getAllProfitCenters, getAllIndirectEmployees };
