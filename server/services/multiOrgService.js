/**
 * Oracle MultiOrg 權限解析服務
 *
 * 層級結構（高 → 低）:
 *   Set of Books (SOB) → Operating Units (OU) → Organizations (Org)
 *
 * 資料來源：FL_ORG_ORGANIZATION_DEFINITIONS_MV（fallback: ORG_ORGANIZATION_DEFINITIONS + JOINs）
 * 快取：20 分鐘 memory cache（MV 資料不常變）
 *
 * 匯出:
 *   MULTIORG_VALUE_TYPES  — 屬於 MultiOrg 範疇的 value_type 集合
 *   loadOrgHierarchy      — 載入並快取 hierarchy rows
 *   resolveUserScope      — 根據 rules 展開使用者有效範圍
 *   checkViolations       — 偵測 prompt 中超出範圍的 terms
 *   invalidateCache       — 強制清除快取（管理員手動重整用）
 */

const oracledb = require('oracledb');
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 分鐘

/** MultiOrg 相關的 value_type（與 ai_data_policy_rules.value_type 對應） */
const MULTIORG_VALUE_TYPES = new Set([
  'organization_id',
  'organization_code',
  'operating_unit',      // OU ID（OPERATING_UNIT 欄位）
  'operating_unit_name', // OU 名稱（OPERATING_UNIT_NAME 欄位）
  'set_of_books_id',
  'set_of_books_name',   // SOB 名稱（SET_OF_BOOKS_NAME 欄位）
]);

// ── 快取 ──────────────────────────────────────────────────────────────────────
let _cache = null;
let _cacheTime = 0;

function invalidateCache() {
  _cache = null;
  _cacheTime = 0;
}

// ── 載入 Hierarchy（快取 20 min）─────────────────────────────────────────────
/**
 * @param {Function} getErpPool  dashboardService.getErpPool()
 * @returns {Promise<object[]>}  每列: { ORGANIZATION_ID, ORGANIZATION_CODE, ORGANIZATION_NAME,
 *                                       OPERATING_UNIT, OPERATING_UNIT_NAME,
 *                                       SET_OF_BOOKS_ID, SET_OF_BOOKS_NAME }
 */
async function loadOrgHierarchy(getErpPool) {
  const now = Date.now();
  if (_cache && (now - _cacheTime) < CACHE_TTL_MS) return _cache;

  const pool = await getErpPool();
  const conn = await pool.getConnection();
  let rows = [];
  try {
    // 優先用 custom MV（已做好 JOIN，效能較佳）
    try {
      const result = await conn.execute(
        `SELECT ORGANIZATION_ID,
                ORGANIZATION_CODE,
                ORGANIZATION_NAME,
                OPERATING_UNIT,
                OPERATING_UNIT_NAME,
                SET_OF_BOOKS_ID,
                SET_OF_BOOKS_NAME
         FROM FL_ORG_ORGANIZATION_DEFINITIONS_MV
         WHERE DISABLE_DATE IS NULL OR DISABLE_DATE > SYSDATE
         ORDER BY ORGANIZATION_NAME`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      rows = result?.rows || [];
    } catch (_mvErr) {
      // Fallback：標準 Oracle EBS table + JOINs
      console.warn('[MultiOrg] FL_ORG_ORGANIZATION_DEFINITIONS_MV 不可用，改用標準 query');
      const result = await conn.execute(
        `SELECT A.ORGANIZATION_ID,
                A.ORGANIZATION_CODE,
                A.ORGANIZATION_NAME,
                A.OPERATING_UNIT,
                HOU.NAME   AS OPERATING_UNIT_NAME,
                A.SET_OF_BOOKS_ID,
                GSB.NAME   AS SET_OF_BOOKS_NAME
         FROM   ORG_ORGANIZATION_DEFINITIONS A
         JOIN   HR_OPERATING_UNITS  HOU ON A.OPERATING_UNIT   = HOU.ORGANIZATION_ID
         JOIN   GL_SETS_OF_BOOKS    GSB ON A.SET_OF_BOOKS_ID  = GSB.SET_OF_BOOKS_ID
         WHERE  (A.DISABLE_DATE IS NULL OR A.DISABLE_DATE > SYSDATE)
         ORDER BY A.ORGANIZATION_NAME`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      rows = result?.rows || [];
    }
  } finally {
    await conn.close().catch(() => {});
  }

  _cache = rows;
  _cacheTime = now;
  return rows;
}

// ── 解析使用者有效 MultiOrg 範圍 ─────────────────────────────────────────────
/**
 * 依規則過濾 hierarchy，回傳使用者能看到的 Orgs / OUs / SOBs。
 *
 * 過濾邏輯（由上而下，每層 intersection）：
 *   1. SOB include/exclude
 *   2. OU  include/exclude
 *   3. Org include/exclude（code 或 id）
 *
 * @param {object[]} rules     ai_data_policy_rules（已過濾為 MultiOrg 相關）
 * @param {object[]} hierarchy loadOrgHierarchy() 的結果
 */
function resolveUserScope(rules, hierarchy) {
  const multiRules = rules.filter(r => MULTIORG_VALUE_TYPES.has(r.value_type));
  if (!multiRules.length) return { hasRules: false };

  const includeRules = multiRules.filter(r => r.include_type === 'include');
  const excludeRules = multiRules.filter(r => r.include_type === 'exclude');

  // 規則層級：SOB=3, OU=2, Org=1（只能往下展，不往上推論）
  function getRuleLevel(valueType) {
    if (valueType === 'set_of_books_id' || valueType === 'set_of_books_name') return 3;
    if (valueType === 'operating_unit'  || valueType === 'operating_unit_name') return 2;
    return 1; // organization_id, organization_code
  }

  function rowMatchesRule(row, rule) {
    const val = String(rule.value_id || '').trim();
    if (!val) return false;
    switch (rule.value_type) {
      case 'set_of_books_id':     return String(row.SET_OF_BOOKS_ID) === val;
      case 'set_of_books_name':   return (row.SET_OF_BOOKS_NAME || '').toLowerCase() === val.toLowerCase();
      case 'operating_unit':      return String(row.OPERATING_UNIT) === val;
      case 'operating_unit_name': return (row.OPERATING_UNIT_NAME || '').toLowerCase() === val.toLowerCase();
      case 'organization_id':     return String(row.ORGANIZATION_ID) === val;
      case 'organization_code':   return (row.ORGANIZATION_CODE || '').toUpperCase() === val.toUpperCase();
      default: return false;
    }
  }

  // ── Include：多條規則取聯集，同時記錄每個 row 最高被哪個層級的規則授權 ──────
  // rowGrantLevel: row → maxLevel（3=SOB, 2=OU, 1=Org）
  // 授權層級決定往下展示到哪：SOB→顯示SOB+OU+Org；OU→顯示OU+Org；Org→只顯示Org
  const rowGrantLevel = new Map();

  if (includeRules.length === 0) {
    // 只有 exclude 規則 → 全量授權（視同 SOB 層）
    for (const row of hierarchy) rowGrantLevel.set(row, 3);
  } else {
    for (const rule of includeRules) {
      const level = getRuleLevel(rule.value_type);
      for (const row of hierarchy) {
        if (rowMatchesRule(row, rule)) {
          const prev = rowGrantLevel.get(row) || 0;
          if (level > prev) rowGrantLevel.set(row, level);
        }
      }
    }
  }

  // ── Exclude：命中任一即移除（AND）──────────────────────────────────────────
  let rows = [...rowGrantLevel.keys()];
  for (const rule of excludeRules) {
    rows = rows.filter(row => !rowMatchesRule(row, rule));
  }

  console.log('[MultiOrg] resolveUserScope:', {
    includeRules: includeRules.map(r => `${r.value_type}=${r.value_id}`),
    excludeRules: excludeRules.map(r => `${r.value_type}=${r.value_id}`),
    hierarchyCount: hierarchy.length,
    resultCount: rows.length,
  });

  // ── 依授權層級決定顯示哪幾層（只往下，不往上）──────────────────────────────
  // grantLevel=3(SOB) → 顯示 SOB + OU + Org
  // grantLevel=2(OU)  → 顯示 OU + Org
  // grantLevel=1(Org) → 只顯示 Org
  const allowedOrgCodes = new Set();
  const allowedOUIds    = new Set();
  const allowedSOBIds   = new Set();
  const ouMap  = new Map();
  const sobMap = new Map();

  for (const row of rows) {
    const level = rowGrantLevel.get(row) || 1;

    // Org（全部顯示）
    if (row.ORGANIZATION_CODE) allowedOrgCodes.add(row.ORGANIZATION_CODE.toUpperCase());

    // OU（OU 層或以上才顯示）
    if (level >= 2) {
      const ouKey = String(row.OPERATING_UNIT);
      allowedOUIds.add(ouKey);
      if (!ouMap.has(ouKey)) ouMap.set(ouKey, { id: row.OPERATING_UNIT, name: row.OPERATING_UNIT_NAME });
    }

    // SOB（SOB 層才顯示）
    if (level >= 3) {
      const sobKey = String(row.SET_OF_BOOKS_ID);
      allowedSOBIds.add(sobKey);
      if (!sobMap.has(sobKey)) sobMap.set(sobKey, { id: row.SET_OF_BOOKS_ID, name: row.SET_OF_BOOKS_NAME });
    }
  }

  // 規則涵蓋的最高層級（用於 checkViolations）
  const maxGrantLevel = rows.length
    ? Math.max(...rows.map(r => rowGrantLevel.get(r) || 1))
    : 1;
  const sourceLevels = [];
  if (maxGrantLevel >= 3) sourceLevels.push('set_of_books_id');
  if (maxGrantLevel >= 2) sourceLevels.push('operating_unit');
  sourceLevels.push('organization');

  return {
    hasRules: true,
    sourceLevels,
    allowedOrgCodes,
    allowedOUIds,
    allowedSOBIds,
    // 前端 / SSE 事件用明細（可序列化）
    orgDetails: rows.map(r => ({
      id:       r.ORGANIZATION_ID,
      code:     r.ORGANIZATION_CODE,
      name:     r.ORGANIZATION_NAME,
      ou_id:    r.OPERATING_UNIT,
      ou_name:  r.OPERATING_UNIT_NAME,
      sob_id:   r.SET_OF_BOOKS_ID,
      sob_name: r.SET_OF_BOOKS_NAME,
    })),
    ouDetails:  [...ouMap.values()],
    sobDetails: [...sobMap.values()],
  };
}

// ── 比對 prompt 中超出範圍的 MultiOrg 關鍵詞 ─────────────────────────────────
/**
 * 偵測 question 中出現、但超出使用者 scope 的 org code / OU name / SOB name。
 *
 * @param {string}   question
 * @param {object}   scope    resolveUserScope() 回傳值
 * @param {object[]} hierarchy
 * @returns {{ level: string, term: string, name?: string, reason: string }[]}
 */
function checkViolations(question, scope, hierarchy) {
  if (!scope.hasRules) return [];

  const violations = [];
  const qUp  = question.toUpperCase();
  const qLow = question.toLowerCase();

  // 輔助：使用詞邊界比對（避免 "M1" 誤中 "M10"）
  function termInText(term, text) {
    // 前後必須是非字母數字字元（或字串邊界）
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![A-Z0-9])${esc}(?![A-Z0-9])`, 'i').test(text);
  }

  // 1. Org codes（全部已知 code，逐一比對）
  const allOrgCodes = [...new Set(hierarchy.map(r => r.ORGANIZATION_CODE).filter(Boolean))];
  for (const code of allOrgCodes) {
    if (!termInText(code, qUp)) continue;
    if (!scope.allowedOrgCodes.has(code.toUpperCase())) {
      const info = hierarchy.find(r => r.ORGANIZATION_CODE === code);
      violations.push({
        level:  'org',
        term:   code,
        name:   info?.ORGANIZATION_NAME,
        reason: '不在您的資料權限範圍內',
      });
    }
  }

  // 2. OU names（僅在規則含 OU 或 SOB 層時才檢查）
  if (scope.sourceLevels.some(l => l === 'set_of_books_id' || l === 'operating_unit')) {
    const allOUNames = [...new Set(hierarchy.map(r => r.OPERATING_UNIT_NAME).filter(Boolean))];
    for (const ouName of allOUNames) {
      if (!qLow.includes(ouName.toLowerCase())) continue;
      const info = hierarchy.find(r => r.OPERATING_UNIT_NAME === ouName);
      if (info && !scope.allowedOUIds.has(String(info.OPERATING_UNIT))) {
        violations.push({
          level:  'ou',
          term:   ouName,
          reason: '不在您的 Operating Unit 權限範圍內',
        });
      }
    }
  }

  // 3. SOB names（僅在規則含 SOB 層時才檢查）
  if (scope.sourceLevels.includes('set_of_books_id')) {
    const allSOBNames = [...new Set(hierarchy.map(r => r.SET_OF_BOOKS_NAME).filter(Boolean))];
    for (const sobName of allSOBNames) {
      if (!qLow.includes(sobName.toLowerCase())) continue;
      const info = hierarchy.find(r => r.SET_OF_BOOKS_NAME === sobName);
      if (info && !scope.allowedSOBIds.has(String(info.SET_OF_BOOKS_ID))) {
        violations.push({
          level:  'sob',
          term:   sobName,
          reason: '不在您的帳套（Set of Books）權限範圍內',
        });
      }
    }
  }

  return violations;
}

// ── 格式化 multiorg_scope SSE payload ────────────────────────────────────────
function buildScopePayload(scope) {
  if (!scope.hasRules) return { has_restrictions: false };
  return {
    has_restrictions: true,
    source_levels:    scope.sourceLevels,
    org_count:        scope.orgDetails.length,
    sob_details:      scope.sobDetails,
    ou_details:       scope.ouDetails,
    org_details:      scope.orgDetails,
  };
}

module.exports = {
  MULTIORG_VALUE_TYPES,
  loadOrgHierarchy,
  resolveUserScope,
  checkViolations,
  buildScopePayload,
  invalidateCache,
};
