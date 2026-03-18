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

const CACHE_TTL_MS = 20 * 60 * 1000; // 20 分鐘

/** MultiOrg 相關的 value_type（與 ai_data_policy_rules.value_type 對應） */
const MULTIORG_VALUE_TYPES = new Set([
  'organization_id',
  'organization_code',
  'operating_unit',    // OU ID（OPERATING_UNIT 欄位）
  'set_of_books_id',
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
        { outFormat: 4 }  // oracledb.OUT_FORMAT_OBJECT = 4
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
        { outFormat: 4 }
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

  // 分類規則
  const gr = (type, inc) =>
    multiRules.filter(r => r.value_type === type && r.include_type === inc)
              .map(r => String(r.value_id || '').trim()).filter(Boolean);

  const sobInc = gr('set_of_books_id', 'include');
  const sobExc = gr('set_of_books_id', 'exclude');
  const ouInc  = gr('operating_unit',  'include');
  const ouExc  = gr('operating_unit',  'exclude');

  const orgCodeInc = multiRules.filter(r => r.value_type === 'organization_code' && r.include_type === 'include')
                                .map(r => (r.value_id || '').trim().toUpperCase()).filter(Boolean);
  const orgCodeExc = multiRules.filter(r => r.value_type === 'organization_code' && r.include_type === 'exclude')
                                .map(r => (r.value_id || '').trim().toUpperCase()).filter(Boolean);
  const orgIdInc   = gr('organization_id', 'include');
  const orgIdExc   = gr('organization_id', 'exclude');

  // 從全量 hierarchy 逐層縮減
  let rows = [...hierarchy];

  if (sobInc.length) rows = rows.filter(r => sobInc.includes(String(r.SET_OF_BOOKS_ID)));
  if (sobExc.length) rows = rows.filter(r => !sobExc.includes(String(r.SET_OF_BOOKS_ID)));
  if (ouInc.length)  rows = rows.filter(r => ouInc.includes(String(r.OPERATING_UNIT)));
  if (ouExc.length)  rows = rows.filter(r => !ouExc.includes(String(r.OPERATING_UNIT)));

  if (orgCodeInc.length) rows = rows.filter(r => orgCodeInc.includes((r.ORGANIZATION_CODE || '').toUpperCase()));
  if (orgCodeExc.length) rows = rows.filter(r => !orgCodeExc.includes((r.ORGANIZATION_CODE || '').toUpperCase()));
  if (orgIdInc.length)   rows = rows.filter(r => orgIdInc.includes(String(r.ORGANIZATION_ID)));
  if (orgIdExc.length)   rows = rows.filter(r => !orgIdExc.includes(String(r.ORGANIZATION_ID)));

  // 建立快速查找 Set
  const allowedOrgCodes = new Set(rows.map(r => (r.ORGANIZATION_CODE || '').toUpperCase()).filter(Boolean));
  const allowedOUIds    = new Set(rows.map(r => String(r.OPERATING_UNIT)).filter(Boolean));
  const allowedSOBIds   = new Set(rows.map(r => String(r.SET_OF_BOOKS_ID)).filter(Boolean));

  // 去重的 OU / SOB 明細
  const ouMap = new Map();
  const sobMap = new Map();
  for (const r of rows) {
    const ouKey = String(r.OPERATING_UNIT);
    if (!ouMap.has(ouKey)) ouMap.set(ouKey, { id: r.OPERATING_UNIT, name: r.OPERATING_UNIT_NAME });
    const sobKey = String(r.SET_OF_BOOKS_ID);
    if (!sobMap.has(sobKey)) sobMap.set(sobKey, { id: r.SET_OF_BOOKS_ID, name: r.SET_OF_BOOKS_NAME });
  }

  // 規則的來源層級（用於提示使用者以哪一層設定為基礎）
  const sourceLevels = [];
  if (sobInc.length || sobExc.length) sourceLevels.push('set_of_books_id');
  if (ouInc.length  || ouExc.length)  sourceLevels.push('operating_unit');
  if (orgCodeInc.length || orgCodeExc.length || orgIdInc.length || orgIdExc.length) sourceLevels.push('organization');

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
