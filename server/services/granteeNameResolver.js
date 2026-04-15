/**
 * Grantee Name Resolver
 *
 * GET share/access list API — 統一補所有 grantee_type 的 grantee_name 顯示字串。
 * 格式要求：
 *   user:           `工號 姓名`
 *   role:           `角色名稱`
 *   factory:        `代碼 名稱`  (zh-TW from ERP, en/vi from FACTORY_CODE_TRANSLATIONS)
 *   department:     `代碼 名稱`  (dept_code dept_name)
 *   dept (legacy):  同上
 *   cost_center:    `代碼 名稱`  (profit_center profit_center_name)
 *   profit_center (legacy): 同上
 *   division:       `代碼 名稱`  (org_section org_section_name)
 *   org_section (legacy):  同上
 *   org_group:      `名稱`        (無 code)
 *
 * 見 docs/factory-share-layer-plan.md §3.2
 */

const factoryCache = require('./factoryCache');

function _pick(row, lower, upper) {
  if (row == null) return undefined;
  if (lower in row) return row[lower];
  if (upper in row) return row[upper];
  return undefined;
}

function _setBothCases(row, lower, upper, value) {
  if (lower in row) row[lower] = value;
  if (upper in row) row[upper] = value;
  if (!(lower in row) && !(upper in row)) row[lower] = value;
}

/**
 * 對 share/access list 的每一行補 grantee_name（統一格式）
 * Mutates rows in place + returns rows.
 *
 * @param {Array<object>} rows - share rows
 * @param {string} lang - 'zh-TW' | 'en' | 'vi'
 * @param {object} db - DB handle
 */
async function resolveGranteeNamesInRows(rows, lang, db) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  // 分類收集 IDs 以便批次查詢
  const userIds = new Set();
  const roleIds = new Set();
  const deptCodes = new Set();
  const profitCenters = new Set();
  const orgSections = new Set();
  const factoryCodes = new Set();

  for (const r of rows) {
    const type = _pick(r, 'grantee_type', 'GRANTEE_TYPE');
    const id = _pick(r, 'grantee_id', 'GRANTEE_ID');
    if (!id) continue;
    switch (type) {
      case 'user': userIds.add(String(id)); break;
      case 'role': roleIds.add(String(id)); break;
      case 'factory': factoryCodes.add(id); break;
      case 'department':
      case 'dept':
        deptCodes.add(id); break;
      case 'cost_center':
      case 'profit_center':
        profitCenters.add(id); break;
      case 'division':
      case 'org_section':
        orgSections.add(id); break;
    }
  }

  // 批次查詢
  const [userMap, roleMap, deptMap, pcMap, osMap, factoryMap] = await Promise.all([
    _batchQueryUsers(db, [...userIds]),
    _batchQueryRoles(db, [...roleIds]),
    _batchQueryOrg(db, 'dept_code', 'dept_name', [...deptCodes]),
    _batchQueryOrg(db, 'profit_center', 'profit_center_name', [...profitCenters]),
    _batchQueryOrg(db, 'org_section', 'org_section_name', [...orgSections]),
    factoryCodes.size ? factoryCache.batchResolveFactoryNames([...factoryCodes], lang, db) : new Map(),
  ]);

  for (const r of rows) {
    const type = _pick(r, 'grantee_type', 'GRANTEE_TYPE');
    const id = _pick(r, 'grantee_id', 'GRANTEE_ID');
    if (!id) continue;

    let display = id;
    switch (type) {
      case 'user': {
        const u = userMap.get(String(id));
        if (u) {
          const emp = u.employee_id ? `${u.employee_id} ` : '';
          display = `${emp}${u.name || ''}`.trim() || id;
        }
        break;
      }
      case 'role': {
        const r2 = roleMap.get(String(id));
        if (r2?.name) display = r2.name;
        break;
      }
      case 'factory': {
        const name = factoryMap.get(id);
        display = (name && name !== id) ? `${id} ${name}` : id;
        break;
      }
      case 'department':
      case 'dept': {
        const name = deptMap.get(id);
        display = name ? `${id} ${name}` : id;
        break;
      }
      case 'cost_center':
      case 'profit_center': {
        const name = pcMap.get(id);
        display = name ? `${id} ${name}` : id;
        break;
      }
      case 'division':
      case 'org_section': {
        const name = osMap.get(id);
        display = name ? `${id} ${name}` : id;
        break;
      }
      case 'org_group':
        display = id; // id 本身就是 name
        break;
    }
    _setBothCases(r, 'grantee_name', 'GRANTEE_NAME', display);
  }
  return rows;
}

async function _batchQueryUsers(db, ids) {
  const map = new Map();
  const numeric = ids.map(i => Number(i)).filter(n => Number.isFinite(n));
  if (!numeric.length) return map;
  const placeholders = numeric.map(() => '?').join(',');
  try {
    const rows = await db.prepare(
      `SELECT id, employee_id, name FROM users WHERE id IN (${placeholders})`
    ).all(...numeric);
    for (const r of rows) map.set(String(r.id), r);
  } catch (e) {
    console.warn('[granteeNameResolver] user query failed:', e.message);
  }
  return map;
}

async function _batchQueryRoles(db, ids) {
  const map = new Map();
  const numeric = ids.map(i => Number(i)).filter(n => Number.isFinite(n));
  if (!numeric.length) return map;
  const placeholders = numeric.map(() => '?').join(',');
  try {
    const rows = await db.prepare(
      `SELECT id, name FROM roles WHERE id IN (${placeholders})`
    ).all(...numeric);
    for (const r of rows) map.set(String(r.id), r);
  } catch (e) {
    console.warn('[granteeNameResolver] role query failed:', e.message);
  }
  return map;
}

/**
 * 從 users 表取 distinct code → name，例如 dept_code → dept_name
 */
async function _batchQueryOrg(db, codeCol, nameCol, codes) {
  const map = new Map();
  if (!codes.length) return map;
  const placeholders = codes.map(() => '?').join(',');
  try {
    const rows = await db.prepare(
      `SELECT DISTINCT ${codeCol} AS code, ${nameCol} AS name
       FROM users WHERE ${codeCol} IN (${placeholders})`
    ).all(...codes);
    for (const r of rows) if (r.code) map.set(r.code, r.name);
  } catch (e) {
    console.warn(`[granteeNameResolver] org query (${codeCol}) failed:`, e.message);
  }
  return map;
}

/**
 * 單筆解析（for POST response / single-row queries）
 */
async function resolveGranteeName(granteeType, granteeId, lang, db) {
  if (!granteeId) return null;
  const tmp = [{ grantee_type: granteeType, grantee_id: granteeId }];
  await resolveGranteeNamesInRows(tmp, lang, db);
  return tmp[0].grantee_name;
}

function getLangFromReq(req) {
  return (req?.query?.lang || req?.headers?.['x-lang'] || 'zh-TW').toString();
}

module.exports = {
  resolveGranteeNamesInRows,
  resolveGranteeName,
  getLangFromReq,
};
