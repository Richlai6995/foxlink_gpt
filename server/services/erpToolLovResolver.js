'use strict';

/**
 * ERP Tool LOV Resolver
 * 支援三種來源:
 *   - static: 靜態清單
 *   - sql:    ERP DB SELECT(禁 DML,自動 ROWNUM limit)
 *   - system: 系統值(當前使用者 context)
 */

const erpDb = require('./erpDb');
const { resolveSystemParam } = require('./apiConnectorService');

const MAX_ROWS = parseInt(process.env.ERP_TOOL_LOV_MAX_ROWS || '500', 10);
const FORBIDDEN_KW = /\b(UPDATE|DELETE|INSERT|DROP|TRUNCATE|ALTER|GRANT|REVOKE|EXEC|EXECUTE|BEGIN|CALL|MERGE)\b/i;

function validateLovSql(sql) {
  if (!sql || typeof sql !== 'string') throw new Error('LOV SQL 為空');
  const trimmed = sql.trim();
  if (!/^SELECT\s/i.test(trimmed)) throw new Error('LOV SQL 必須以 SELECT 開頭');
  if (FORBIDDEN_KW.test(trimmed)) throw new Error('LOV SQL 不可包含寫入操作關鍵字');
  const semi = (trimmed.match(/;/g) || []).length;
  if (semi > 1 || (semi === 1 && !trimmed.trimEnd().endsWith(';'))) {
    throw new Error('LOV SQL 只能單一查詢');
  }
}

/**
 * 擴充 system 參數(apiConnectorService 未支援者)
 */
function resolveExtendedSystemParam(source, userCtx) {
  const base = resolveSystemParam(source, userCtx || {});
  if (base !== null && base !== undefined && base !== '') return base;
  switch (source) {
    case 'system_user_factory':        return userCtx?.factory_code || userCtx?.FACTORY_CODE || '';
    case 'system_user_profit_center':  return userCtx?.profit_center || userCtx?.PROFIT_CENTER || '';
    default: return base ?? null;
  }
}

/**
 * 解析 LOV 取得選項
 * @param {object} lovConfig - { type, items?, sql?, binds?, value_col?, label_col?, source? }
 * @param {object} userCtx
 * @param {object} options - { search?: string, limit?: number }
 * @returns {Promise<{ items: [{value,label}], type, system_value? }>}
 */
async function resolveLov(lovConfig, userCtx, options = {}) {
  if (!lovConfig || !lovConfig.type) return { items: [], type: 'none' };

  if (lovConfig.type === 'static') {
    const items = Array.isArray(lovConfig.items) ? lovConfig.items : [];
    const q = (options.search || '').trim().toLowerCase();
    const filtered = q
      ? items.filter(i =>
          String(i.label || '').toLowerCase().includes(q) ||
          String(i.value || '').toLowerCase().includes(q))
      : items;
    return { items: filtered.slice(0, options.limit || 500), type: 'static' };
  }

  if (lovConfig.type === 'system') {
    const v = resolveExtendedSystemParam(lovConfig.source, userCtx);
    return {
      items: v !== null && v !== undefined && v !== ''
        ? [{ value: String(v), label: String(v) }]
        : [],
      type: 'system',
      system_value: v,
    };
  }

  if (lovConfig.type === 'sql') {
    validateLovSql(lovConfig.sql);
    let sql = lovConfig.sql.trim().replace(/;\s*$/, '');
    const binds = {};
    for (const b of (lovConfig.binds || [])) {
      binds[b.name] = resolveExtendedSystemParam(b.source, userCtx) ?? null;
    }
    const limit = Math.min(options.limit || MAX_ROWS, MAX_ROWS);
    const wrapped = `SELECT * FROM (${sql}) LOV_SUB WHERE ROWNUM <= ${limit}`;
    const result = await erpDb.execute(wrapped, binds);
    const rows = result?.rows || [];
    const vCol = (lovConfig.value_col || 'V').toUpperCase();
    const lCol = (lovConfig.label_col || 'L').toUpperCase();
    const items = rows.map(r => ({
      value: r[vCol] ?? r[vCol.toLowerCase()] ?? '',
      label: r[lCol] ?? r[lCol.toLowerCase()] ?? '',
    })).filter(i => i.value !== '' && i.value !== null);

    const q = (options.search || '').trim().toLowerCase();
    const filtered = q
      ? items.filter(i =>
          String(i.label).toLowerCase().includes(q) ||
          String(i.value).toLowerCase().includes(q))
      : items;
    return { items: filtered, type: 'sql' };
  }

  if (lovConfig.type === 'erp_tool') {
    return await resolveChainedLov(lovConfig, userCtx, options);
  }

  return { items: [], type: lovConfig.type };
}

/**
 * 鏈式 LOV:呼叫另一個 erp_tool 取結果
 * lov_config = {
 *   type: 'erp_tool',
 *   tool_id: 42,
 *   param_map: {  // 輸入參數對照
 *     P_DEPT: { source: 'system_user_dept' },  // 系統值
 *     P_FLAG: 'A',                              // 固定值
 *   },
 *   cursor_param?: 'P_CURSOR',                 // 要讀哪個 OUT cursor(預設第一個)
 *   value_col: 'EMP_NO',
 *   label_col: 'EMP_NAME',
 * }
 */
async function resolveChainedLov(lovConfig, userCtx, options = {}) {
  const { tool_id, param_map, cursor_param, value_col, label_col } = lovConfig;
  if (!tool_id) throw new Error('鏈式 LOV 缺 tool_id');

  // 防遞迴
  const seen = new Set(options._seen || []);
  if (seen.has(tool_id)) throw new Error(`鏈式 LOV 遞迴偵測:tool_id=${tool_id}`);
  seen.add(tool_id);

  // lazy require 避免 circular
  const executor = require('./erpToolExecutor');
  const db = require('../database-oracle').db;

  // 組 inputs
  const inputs = {};
  for (const [k, v] of Object.entries(param_map || {})) {
    if (v && typeof v === 'object' && v.source) {
      inputs[k] = resolveExtendedSystemParam(v.source, userCtx);
    } else if (v && typeof v === 'object' && 'value' in v) {
      inputs[k] = v.value;
    } else {
      inputs[k] = v;
    }
  }

  const execOut = await executor.execute(db, tool_id, inputs, userCtx, {
    trigger_source: 'lov_chain',
    include_full: true,
    _seen: seen,
  });

  // 抽 rows:找 params 裡第一個 rows 陣列(或指定 cursor_param)
  const full = execOut.full_result || execOut.result || {};
  const params = full.params || {};
  let rows = [];
  if (cursor_param && params[cursor_param]?.rows) {
    rows = params[cursor_param].rows;
  } else {
    for (const v of Object.values(params)) {
      if (v && Array.isArray(v.rows)) { rows = v.rows; break; }
    }
  }

  const vCol = (value_col || 'V').toUpperCase();
  const lCol = (label_col || 'L').toUpperCase();
  const items = rows.map(r => ({
    value: r[vCol] ?? r[vCol.toLowerCase()] ?? Object.values(r)[0],
    label: r[lCol] ?? r[lCol.toLowerCase()] ?? r[vCol] ?? r[vCol.toLowerCase()] ?? '',
  })).filter(i => i.value !== undefined && i.value !== null && i.value !== '');

  const q = (options.search || '').trim().toLowerCase();
  const filtered = q
    ? items.filter(i =>
        String(i.label).toLowerCase().includes(q) ||
        String(i.value).toLowerCase().includes(q))
    : items;

  return { items: filtered, type: 'erp_tool', source_tool_id: tool_id };
}

module.exports = {
  resolveLov,
  resolveExtendedSystemParam,
  validateLovSql,
};
