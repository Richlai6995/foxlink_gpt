/**
 * Factory Code Cache
 *
 * factory_code / factory_name (zh-TW) 來源：EBS FND_FLEX_VALUES_VL (flex value set 1008041)
 * en / vi 翻譯來源：本地表 FACTORY_CODE_TRANSLATIONS
 *
 * Strategy: in-memory cache with 1h TTL，啟動時 warm-up，admin 可手動 invalidate。
 * 見 docs/factory-share-layer-plan.md §2
 */

const erpDb = require('./erpDb');

const TTL_MS = 60 * 60 * 1000; // 1h

let _map = null;         // Map<factory_code, zh-TW factory_name>
let _sortedCodes = null; // string[] — ERP 原順序
let _loadedAt = 0;
let _loading = null;     // Promise — 避免並發時重複打 ERP

async function _loadFromErp() {
  if (!erpDb.isConfigured()) {
    _map = new Map();
    _sortedCodes = [];
    _loadedAt = Date.now();
    return;
  }
  const rs = await erpDb.execute(`
    SELECT FLEX_VALUE AS code, DESCRIPTION AS name
    FROM FND_FLEX_VALUES_VL
    WHERE FLEX_VALUE_SET_ID = 1008041
      AND END_DATE_ACTIVE IS NULL
    ORDER BY FLEX_VALUE
  `);
  const rows = rs?.rows || [];
  _map = new Map(rows.map(r => [r.CODE, r.NAME || r.CODE]));
  _sortedCodes = rows.map(r => r.CODE);
  _loadedAt = Date.now();
  console.log(`[FactoryCache] Loaded ${_map.size} factories from ERP`);
}

async function _ensureLoaded() {
  if (_map && Date.now() - _loadedAt < TTL_MS) return;
  if (_loading) return _loading;
  _loading = _loadFromErp().catch(e => {
    console.error('[FactoryCache] Load failed:', e.message);
    if (!_map) { _map = new Map(); _sortedCodes = []; }
  }).finally(() => { _loading = null; });
  return _loading;
}

async function getFactoryMap() {
  await _ensureLoaded();
  return _map;
}

async function getSortedCodes() {
  await _ensureLoaded();
  return _sortedCodes || [];
}

/**
 * 拉出當前 lang 所有廠區（給 LOV API 用）
 * @param {string} lang - 'zh-TW' | 'en' | 'vi'
 * @param {object} db - DB handle (for translations table)
 * @returns {Array<{code, name}>}
 */
async function listFactories(lang, db) {
  await _ensureLoaded();
  const codes = _sortedCodes || [];
  if (!codes.length) return [];

  if (lang === 'zh-TW' || !lang) {
    return codes.map(c => ({ code: c, name: _map.get(c) || c }));
  }

  // en / vi — 查 translations 表，fallback zh-TW
  let trans = new Map();
  try {
    const rows = await db.prepare(
      `SELECT factory_code, factory_name FROM factory_code_translations WHERE lang = ?`
    ).all(lang);
    trans = new Map((rows || []).map(r => [r.FACTORY_CODE || r.factory_code, r.FACTORY_NAME || r.factory_name]));
  } catch (e) {
    console.warn('[FactoryCache] translations query failed:', e.message);
  }

  return codes.map(c => ({
    code: c,
    name: trans.get(c) || _map.get(c) || c,
  }));
}

/**
 * 單筆解析廠區名稱（依 lang）
 */
async function resolveFactoryName(code, lang, db) {
  if (!code) return null;
  await _ensureLoaded();
  if (lang === 'zh-TW' || !lang) {
    return _map.get(code) || code;
  }
  try {
    const row = await db.prepare(
      `SELECT factory_name FROM factory_code_translations WHERE factory_code = ? AND lang = ?`
    ).get(code, lang);
    const name = row?.FACTORY_NAME || row?.factory_name;
    if (name) return name;
  } catch (_) {}
  return _map.get(code) || code;
}

/**
 * 批次解析（給 GET share list 用，避免 N+1）
 * @returns {Map<code, name>}
 */
async function batchResolveFactoryNames(codes, lang, db) {
  await _ensureLoaded();
  const unique = [...new Set((codes || []).filter(Boolean))];
  const result = new Map();
  if (!unique.length) return result;

  if (lang === 'zh-TW' || !lang) {
    for (const c of unique) result.set(c, _map.get(c) || c);
    return result;
  }

  // Load translations in one query
  let trans = new Map();
  try {
    const rows = await db.prepare(
      `SELECT factory_code, factory_name FROM factory_code_translations WHERE lang = ?`
    ).all(lang);
    trans = new Map((rows || []).map(r => [r.FACTORY_CODE || r.factory_code, r.FACTORY_NAME || r.factory_name]));
  } catch (e) {
    console.warn('[FactoryCache] batch translations query failed:', e.message);
  }

  for (const c of unique) {
    result.set(c, trans.get(c) || _map.get(c) || c);
  }
  return result;
}

function invalidateCache() {
  _map = null;
  _sortedCodes = null;
  _loadedAt = 0;
  console.log('[FactoryCache] Cache invalidated');
}

/**
 * 強制立即重載（admin 重刷按鈕用）
 */
async function forceReload() {
  invalidateCache();
  await _ensureLoaded();
  return { size: _map?.size || 0, loadedAt: _loadedAt };
}

function getCacheStatus() {
  return {
    loaded: !!_map,
    size: _map?.size || 0,
    loadedAt: _loadedAt,
    ageMs: _loadedAt ? Date.now() - _loadedAt : null,
    ttlMs: TTL_MS,
  };
}

module.exports = {
  getFactoryMap,
  getSortedCodes,
  listFactories,
  resolveFactoryName,
  batchResolveFactoryNames,
  invalidateCache,
  forceReload,
  getCacheStatus,
};
