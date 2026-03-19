/**
 * 公司組織階層權限解析服務（Layer 3）
 *
 * 層級結構（高 → 低）:
 *   事業群 (ORG_GROUP_NAME) → 事業處 (ORG_SECTION) → 利潤中心 (PROFIT_CENTER) → 部門 (DEPT_CODE)
 *
 * 資料來源：FL_ORG_EMP_DEPT_MV
 * 快取：20 分鐘 memory cache
 *
 * 值的來源：永遠取自登入使用者的 profile 欄位，不使用 rule 的 value_id
 *
 * 匯出:
 *   ORG_HIERARCHY_VALUE_TYPES  — 屬於此服務範疇的 filter_source 集合
 *   loadDeptHierarchy          — 載入並快取 hierarchy rows
 *   resolveUserDeptScope       — 根據 rules + user profile 展開允許的 dept_code 清單
 *   buildOrgScopePayload       — 格式化 SSE payload
 *   invalidateCache            — 強制清除快取
 */

const oracledb = require('oracledb');
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 分鐘

/** Layer 3 公司組織相關的 filter_source（與 ai_schema_columns.filter_source 對應） */
const ORG_HIERARCHY_VALUE_TYPES = new Set([
  'org_group_name',
  'org_section',
  'profit_center',
  'dept_code',
  'org_code',   // FL_ORG_EMP_DEPT_MV.ORG_CODE — 展開後的組織代碼清單
  'org_id',     // FL_ORG_EMP_DEPT_MV.ORG_ID
]);

// 各 filter_source 的層級數值（用於控制顯示哪幾層）
const ORG_GRANT_LEVEL = {
  org_group_name: 4,  // 事業群（最高）
  org_section:    3,  // 事業處
  profit_center:  2,  // 利潤中心
  dept_code:      1,  // 部門（最低）
};

// ── 快取 ────────────────────────────────────────────────────────────────────
let _cache    = null;
let _cacheTime = 0;

function invalidateCache() {
  _cache    = null;
  _cacheTime = 0;
}

// ── 載入 Hierarchy（快取 20 min）────────────────────────────────────────────
/**
 * @param {Function} getErpPool  dashboardService.getErpPool()
 * @returns {Promise<object[]>}  每列: {
 *   DEPT_CODE, DEPT_NAME,
 *   PROFIT_CENTER, PROFIT_CENTER_NAME,
 *   ORG_SECTION, ORG_SECTION_NAME,
 *   ORG_GROUP_NAME
 * }
 */
async function loadDeptHierarchy(getErpPool) {
  const now = Date.now();
  if (_cache && (now - _cacheTime) < CACHE_TTL_MS) return _cache;

  const pool = await getErpPool();
  const conn = await pool.getConnection();
  let rows = [];
  try {
    const result = await conn.execute(
      `SELECT DEPT_CODE,
              DEPT_DESC,
              PROFIT_CENTER,
              PROFIT_CENTER_NAME,
              ORG_SECTION,
              ORG_SECTION_NAME,
              ORG_GROUP_NAME,
              ORG_ID,
              ORG_CODE
       FROM APPS.FL_ORG_EMP_DEPT_MV
       ORDER BY ORG_GROUP_NAME, ORG_SECTION, PROFIT_CENTER, DEPT_CODE`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    rows = result?.rows || [];
  } finally {
    await conn.close().catch(() => {});
  }

  _cache    = rows;
  _cacheTime = now;
  console.log(`[OrgHierarchy] Loaded ${rows.length} dept rows, cached 20 min`);
  return rows;
}

// ── 解析使用者有效部門範圍 ────────────────────────────────────────────────────
/**
 * 依規則 + 使用者 profile 展開允許的部門清單。
 * 規則的 value_id 忽略不用，永遠取自 user 的對應欄位。
 *
 * @param {object[]} rules     ai_data_policy_rules（已過濾為 Layer 3 org 相關）
 * @param {object}   user      使用者物件（需有 dept_code, profit_center, org_section, org_group_name）
 * @param {object[]} hierarchy loadDeptHierarchy() 的結果
 */
function resolveUserDeptScope(rules, user, hierarchy) {
  const orgRules = rules.filter(r => ORG_HIERARCHY_VALUE_TYPES.has(r.value_type || r.filter_source));
  if (!orgRules.length) return { hasRules: false };

  // 使用者 profile 欄位對應
  const userValues = {
    org_group_name: (user.org_group_name || '').trim(),
    org_section:    (user.org_section    || '').trim(),
    profit_center:  (user.profit_center  || '').trim(),
    dept_code:      (user.dept_code      || '').trim(),
  };

  // 若上層欄位為空，從 hierarchy 根據已知的下層值往上推導（補齊缺失的父層值）
  const refRow = hierarchy.find(r =>
    (userValues.dept_code     && (r.DEPT_CODE      || '').trim() === userValues.dept_code) ||
    (userValues.profit_center && (r.PROFIT_CENTER  || '').trim() === userValues.profit_center) ||
    (userValues.org_section   && (r.ORG_SECTION    || '').trim() === userValues.org_section)
  );
  if (refRow) {
    if (!userValues.org_group_name) userValues.org_group_name = (refRow.ORG_GROUP_NAME || '').trim();
    if (!userValues.org_section)    userValues.org_section    = (refRow.ORG_SECTION    || '').trim();
    if (!userValues.profit_center)  userValues.profit_center  = (refRow.PROFIT_CENTER  || '').trim();
  }

  // 比對函式：row 是否符合此 filter_source + 使用者欄位值
  function rowMatchesUserRule(row, filterSource) {
    const userVal = userValues[filterSource];
    if (!userVal) return false; // 使用者此欄位無值 → 無法匹配
    switch (filterSource) {
      case 'org_group_name': return (row.ORG_GROUP_NAME || '') === userVal;
      case 'org_section':    return (row.ORG_SECTION    || '') === userVal;
      case 'profit_center':  return (row.PROFIT_CENTER  || '') === userVal;
      case 'dept_code':      return (row.DEPT_CODE      || '') === userVal;
      default: return false;
    }
  }

  const includeRules = orgRules.filter(r => r.include_type === 'include');
  const excludeRules = orgRules.filter(r => r.include_type === 'exclude');

  // ── Include：每條規則展開後取聯集，記錄各 row 的最高授權層級 ────────────
  const rowGrantLevel = new Map(); // row → maxGrantLevel

  /**
   * org_code / org_id 是「衍生型」filter_source：
   *   它本身不是比對條件，而是「展開後收集 ORG_CODE/ORG_ID」的標記。
   *   展開方式：以使用者最高可用的層級（事業群→事業處→利潤中心→部門）為準，
   *   找到對應的 hierarchy rows，再從中收集 ORG_CODE / ORG_ID。
   */
  function expandRowsByUserNaturalScope() {
    const naturalScope = userValues.org_group_name ? 'org_group_name'
      : userValues.org_section   ? 'org_section'
      : userValues.profit_center ? 'profit_center'
      : userValues.dept_code     ? 'dept_code'
      : null;
    if (!naturalScope) return;
    const level = ORG_GRANT_LEVEL[naturalScope] || 1;
    for (const row of hierarchy) {
      if (rowMatchesUserRule(row, naturalScope)) {
        const prev = rowGrantLevel.get(row) || 0;
        if (level > prev) rowGrantLevel.set(row, level);
      }
    }
  }

  if (includeRules.length === 0) {
    // 只有 exclude 規則 → 從全量開始（視為最高層授權）
    for (const row of hierarchy) rowGrantLevel.set(row, 4);
  } else {
    for (const rule of includeRules) {
      const filterSource = rule.value_type || rule.filter_source;

      // org_code / org_id：衍生型，改用使用者自然層級展開
      if (filterSource === 'org_code' || filterSource === 'org_id') {
        expandRowsByUserNaturalScope();
        continue;
      }

      const level = ORG_GRANT_LEVEL[filterSource] || 1;
      for (const row of hierarchy) {
        if (rowMatchesUserRule(row, filterSource)) {
          const prev = rowGrantLevel.get(row) || 0;
          if (level > prev) rowGrantLevel.set(row, level);
        }
      }
    }
  }

  // ── Exclude：命中任一即移除（AND）──────────────────────────────────────
  let rows = [...rowGrantLevel.keys()];
  for (const rule of excludeRules) {
    const filterSource = rule.value_type || rule.filter_source;
    rows = rows.filter(row => !rowMatchesUserRule(row, filterSource));
  }

  console.log('[OrgHierarchy] resolveUserDeptScope:', {
    includeRules: includeRules.map(r => r.value_type || r.filter_source),
    excludeRules: excludeRules.map(r => r.value_type || r.filter_source),
    userValues,
    hierarchyCount: hierarchy.length,
    resultCount: rows.length,
  });

  // ── 依授權層級決定顯示哪幾層（只往下，不往上推論）──────────────────────
  const allowedDeptCodes = new Set();
  const allowedOrgCodes  = new Set();
  const allowedOrgIds    = new Set();
  const profitCenterMap  = new Map();
  const orgSectionMap    = new Map();
  const orgGroupSet      = new Set();
  const orgCodeMap       = new Map(); // org_code → { org_code, org_id }

  for (const row of rows) {
    const level = rowGrantLevel.get(row) || 1;

    // 部門（全部顯示）
    if (row.DEPT_CODE) allowedDeptCodes.add(row.DEPT_CODE);

    // 組織代碼/ID（全部收集，來自 ORG_ID/ORG_CODE 欄位）
    if (row.ORG_CODE) {
      allowedOrgCodes.add(row.ORG_CODE);
      if (!orgCodeMap.has(row.ORG_CODE)) {
        orgCodeMap.set(row.ORG_CODE, { org_code: row.ORG_CODE, org_id: row.ORG_ID || null });
      }
    }
    if (row.ORG_ID) allowedOrgIds.add(String(row.ORG_ID));

    // 利潤中心（level >= 2 才顯示）
    if (level >= 2 && row.PROFIT_CENTER) {
      const key = row.PROFIT_CENTER;
      if (!profitCenterMap.has(key)) {
        profitCenterMap.set(key, { code: row.PROFIT_CENTER, name: row.PROFIT_CENTER_NAME });
      }
    }

    // 事業處（level >= 3 才顯示）
    if (level >= 3 && row.ORG_SECTION) {
      const key = row.ORG_SECTION;
      if (!orgSectionMap.has(key)) {
        orgSectionMap.set(key, { code: row.ORG_SECTION, name: row.ORG_SECTION_NAME });
      }
    }

    // 事業群（level >= 4 才顯示）
    if (level >= 4 && row.ORG_GROUP_NAME) {
      orgGroupSet.add(row.ORG_GROUP_NAME);
    }
  }

  // 來源層級（用於 SSE 顯示說明）
  const maxGrantLevel = rows.length ? Math.max(...rows.map(r => rowGrantLevel.get(r) || 1)) : 1;
  const sourceLevels  = [];
  if (maxGrantLevel >= 4) sourceLevels.push('org_group');
  if (maxGrantLevel >= 3) sourceLevels.push('org_section');
  if (maxGrantLevel >= 2) sourceLevels.push('profit_center');
  sourceLevels.push('dept_code');

  // 最高層 include 規則的層級（用於 WHERE 注入）
  const highestIncludeLevel = includeRules.length
    ? includeRules.reduce((best, r) => {
        const fs = r.value_type || r.filter_source;
        return (ORG_GRANT_LEVEL[fs] || 0) > (ORG_GRANT_LEVEL[best] || 0) ? fs : best;
      }, '')
    : '';

  return {
    hasRules:           true,
    sourceLevels,
    userValues,            // 使用者各層欄位值（補齊後），供 WHERE 注入使用
    highestIncludeLevel,   // 最高層 include 規則的 filter_source
    allowedDeptCodes,
    allowedOrgCodes,
    allowedOrgIds,
    deptDetails: rows.map(r => ({
      dept_code:            r.DEPT_CODE,
      dept_name:            r.DEPT_DESC,
      profit_center:        r.PROFIT_CENTER,
      profit_center_name:   r.PROFIT_CENTER_NAME,
      org_section:          r.ORG_SECTION,
      org_section_name:     r.ORG_SECTION_NAME,
      org_group_name:       r.ORG_GROUP_NAME,
    })),
    orgCodeDetails:      [...orgCodeMap.values()],
    profitCenterDetails: [...profitCenterMap.values()],
    orgSectionDetails:   [...orgSectionMap.values()],
    orgGroupDetails:     [...orgGroupSet].map(n => ({ name: n })),
  };
}

// ── 格式化 org_scope SSE payload ─────────────────────────────────────────────
function buildOrgScopePayload(scope) {
  if (!scope.hasRules) return { has_restrictions: false };
  return {
    has_restrictions:       true,
    source_levels:          scope.sourceLevels,
    dept_count:             scope.deptDetails.length,
    org_code_count:         scope.allowedOrgCodes?.size ?? 0,
    org_code_details:       scope.orgCodeDetails || [],
    dept_details:           scope.deptDetails,
    profit_center_details:  scope.profitCenterDetails,
    org_section_details:    scope.orgSectionDetails,
    org_group_details:      scope.orgGroupDetails,
  };
}

module.exports = {
  ORG_HIERARCHY_VALUE_TYPES,
  loadDeptHierarchy,
  resolveUserDeptScope,
  buildOrgScopePayload,
  invalidateCache,
};
