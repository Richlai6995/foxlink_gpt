'use strict';

/**
 * ERP Tool Executor
 * 負責:
 *  - 權限與安全檢查(WRITE 確認流程)
 *  - 建立 bind 變數(IN / OUT / IN OUT / FUNCTION return)
 *  - 執行 PL/SQL 匿名區塊
 *  - 處理 OUT 結果(REF CURSOR / CLOB / scalar)
 *  - 截斷給 LLM、完整結果存 Redis
 *  - Audit log 一律寫
 *
 * 支援型別:VARCHAR2 / CHAR / NUMBER / DATE / TIMESTAMP / CLOB / SYS_REFCURSOR
 */

const crypto = require('crypto');
const erpDb = require('./erpDb');
const metaSvc = require('./erpToolMetadata');
const { resolveExtendedSystemParam } = require('./erpToolLovResolver');
const resultCache = require('./erpToolResultCache');
const rateLimit = require('./erpToolRateLimit');

// ── 型別轉換 ──────────────────────────────────────────────────────────────────
function coerceInput(raw, param) {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  const t = (param.data_type || '').toUpperCase();
  if (t === 'NUMBER' || t === 'INTEGER' || t === 'FLOAT' || t === 'PLS_INTEGER'
      || t === 'BINARY_FLOAT' || t === 'BINARY_DOUBLE') {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`參數 ${param.name} 應為數字,收到: ${raw}`);
    return n;
  }
  if (t === 'DATE' || t.startsWith('TIMESTAMP')) {
    if (raw instanceof Date) return raw;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new Error(`參數 ${param.name} 日期格式無效: ${raw}`);
    return d;
  }
  return String(raw);
}

function resolveParamInput(param, userInputs, userCtx) {
  if (param.inject_source) {
    return resolveExtendedSystemParam(param.inject_source, userCtx);
  }
  if (param.inject_value !== null && param.inject_value !== undefined) {
    return param.inject_value;
  }
  if (userInputs && Object.prototype.hasOwnProperty.call(userInputs, param.name)) {
    return userInputs[param.name];
  }
  // default_config 動態 preset 優先;否則 fallback 到舊 default_value
  const resolved = resolveDefaultConfig(param, userCtx);
  if (resolved !== null && resolved !== undefined) return resolved;
  if (param.default_value !== null && param.default_value !== undefined) {
    return param.default_value;
  }
  return null;
}

// ── 動態預設值解析 ─────────────────────────────────────────────────────────
function resolveDefaultConfig(param, userCtx) {
  const cfg = param.default_config;
  if (!cfg || cfg.mode === 'none') return null;
  if (cfg.mode === 'fixed') return cfg.fixed_value ?? null;
  if (cfg.mode === 'preset') return resolvePreset(cfg.preset, userCtx);
  return null;
}

function resolvePreset(preset, userCtx) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  switch (preset) {
    // 日期
    case 'today':            return dateStr(now);
    case 'yesterday': {
      const d = new Date(now); d.setDate(d.getDate() - 1); return dateStr(d);
    }
    case 'tomorrow': {
      const d = new Date(now); d.setDate(d.getDate() + 1); return dateStr(d);
    }
    case 'this_week_start': {
      const d = new Date(now); const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1); return dateStr(d);
    }
    case 'this_month_start': {
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    }
    case 'last_month_start': {
      const d = new Date(now); d.setMonth(d.getMonth() - 1);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
    }
    case 'this_year_start':  return `${now.getFullYear()}-01-01`;
    case 'last_year_start':  return `${now.getFullYear() - 1}-01-01`;
    // 時間
    case 'now':              return `${dateStr(now)} ${timeStr(now)}`;
    // 數字
    case 'current_year':     return now.getFullYear();
    case 'current_month':    return now.getMonth() + 1;
    case 'current_day':      return now.getDate();
    // 系統值
    case 'system_user_id':          return userCtx?.id ?? null;
    case 'system_user_employee_id': return userCtx?.employee_id ?? null;
    case 'system_user_name':        return userCtx?.name ?? null;
    case 'system_user_email':       return userCtx?.email ?? null;
    case 'system_user_dept':        return userCtx?.dept_code ?? null;
    case 'system_user_factory':     return userCtx?.factory_code ?? null;
    case 'system_user_profit_center': return userCtx?.profit_center ?? null;
    default: return null;
  }
}

// ── WRITE 型確認 token ────────────────────────────────────────────────────────
const pendingConfirmations = new Map(); // token → { toolId, inputs, userId, expiresAt }
const CONFIRM_TTL_MS = 5 * 60 * 1000;

function issueConfirmToken(toolId, inputs, userId) {
  const token = crypto.randomBytes(16).toString('hex');
  pendingConfirmations.set(token, {
    toolId, inputs, userId, expiresAt: Date.now() + CONFIRM_TTL_MS,
  });
  // 週期清理
  for (const [k, v] of pendingConfirmations.entries()) {
    if (v.expiresAt < Date.now()) pendingConfirmations.delete(k);
  }
  return token;
}

function consumeConfirmToken(token, toolId, userId) {
  const e = pendingConfirmations.get(token);
  if (!e) return null;
  if (e.toolId !== toolId || e.userId !== userId) return null;
  if (e.expiresAt < Date.now()) { pendingConfirmations.delete(token); return null; }
  pendingConfirmations.delete(token);
  return e;
}

// ── 載入 tool ─────────────────────────────────────────────────────────────────
async function loadTool(db, toolId) {
  const row = await db.prepare(`SELECT * FROM erp_tools WHERE id = ?`).get(toolId);
  if (!row) throw new Error(`ERP tool not found: ${toolId}`);
  const params = safeParseJson(row.params_json || row.PARAMS_JSON, []);
  const returns = safeParseJson(row.returns_json || row.RETURNS_JSON, null);
  return {
    id: row.id || row.ID,
    code: row.code || row.CODE,
    name: row.name || row.NAME,
    db_owner: row.db_owner || row.DB_OWNER,
    package_name: row.package_name || row.PACKAGE_NAME,
    object_name: row.object_name || row.OBJECT_NAME,
    overload: row.overload || row.OVERLOAD,
    routine_type: row.routine_type || row.ROUTINE_TYPE,
    access_mode: row.access_mode || row.ACCESS_MODE,
    allow_llm_auto: Number(row.allow_llm_auto ?? row.ALLOW_LLM_AUTO ?? 1),
    allow_manual: Number(row.allow_manual ?? row.ALLOW_MANUAL ?? 1),
    allow_inject: Number(row.allow_inject ?? row.ALLOW_INJECT ?? 0),
    requires_approval: Number(row.requires_approval ?? row.REQUIRES_APPROVAL ?? 0),
    max_rows_llm: Number(row.max_rows_llm ?? row.MAX_ROWS_LLM ?? 50),
    max_rows_ui: Number(row.max_rows_ui ?? row.MAX_ROWS_UI ?? 1000),
    timeout_sec: Number(row.timeout_sec ?? row.TIMEOUT_SEC ?? 30),
    enabled: Number(row.enabled ?? row.ENABLED ?? 1),
    rate_limit_per_user: row.rate_limit_per_user ?? row.RATE_LIMIT_PER_USER ?? null,
    rate_limit_global:   row.rate_limit_global   ?? row.RATE_LIMIT_GLOBAL   ?? null,
    rate_limit_window:   row.rate_limit_window   ?? row.RATE_LIMIT_WINDOW   ?? 'minute',
    allow_dry_run:       Number(row.allow_dry_run ?? row.ALLOW_DRY_RUN ?? 1),
    params,
    returns,
  };
}

function safeParseJson(s, fallback) {
  if (!s) return fallback;
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch (_) { return fallback; }
}

// ── 核心執行 ──────────────────────────────────────────────────────────────────
/**
 * @param {object} db
 * @param {number} toolId
 * @param {object} userInputs - { paramName: value, ... }
 * @param {object} userCtx
 * @param {object} options - { trigger_source, session_id, confirmation_token, mode = 'llm' | 'ui' }
 */
async function execute(db, toolId, userInputs, userCtx, options = {}) {
  if (!erpDb.isConfigured()) {
    throw new Error('ERP DB 未設定(缺 ERP_DB_HOST/USER/PASSWORD)');
  }

  const tool = await loadTool(db, toolId);
  if (!tool.enabled) throw new Error(`ERP tool "${tool.code}" 已停用`);

  const triggerSource = options.trigger_source || 'test';
  const sessionId = options.session_id || null;
  const dryRun = options.dry_run === true;

  // Rate limit(dry-run 也算,避免濫測)
  try {
    await rateLimit.enforce(tool, userCtx.id);
  } catch (e) {
    throw e;
  }

  // WRITE 型確認流程
  if (tool.access_mode === 'WRITE') {
    const autoBlocked = triggerSource === 'llm_tool_call' && !tool.allow_llm_auto;
    const needsConfirm = autoBlocked || tool.requires_approval;
    if (needsConfirm && !options.confirmation_token) {
      const token = issueConfirmToken(tool.id, userInputs, userCtx.id);
      return {
        requires_confirmation: true,
        confirmation_token: token,
        summary: `此操作會修改 ERP 資料 (${tool.code}),請使用者手動確認`,
        tool: { id: tool.id, code: tool.code, name: tool.name, access_mode: 'WRITE' },
      };
    }
    if (options.confirmation_token) {
      const consumed = consumeConfirmToken(options.confirmation_token, tool.id, userCtx.id);
      if (!consumed) throw new Error('確認 token 無效或已過期');
      userInputs = consumed.inputs;
    }
  }

  // 建立 bind
  const { sql, binds, outMeta } = buildPlSqlCall(tool, userInputs, userCtx);

  const oracledb = erpDb.getOracledb();
  const timeoutMs = (tool.timeout_sec || 30) * 1000;

  let conn;
  const startedAt = Date.now();
  let error = null;
  let auditResult = null;
  let fullResult = null;
  let rowsReturned = 0;

  try {
    conn = await erpDb.getConnection();
    if (typeof conn.callTimeout !== 'undefined') conn.callTimeout = timeoutMs;

    // Dry-run:SAVEPOINT + ROLLBACK 包起來(只對 WRITE 有意義)
    if (dryRun) {
      if (!tool.allow_dry_run) throw new Error('此工具未允許 dry-run');
      await conn.execute('SAVEPOINT sp_erp_dry_run');
    }

    const execResult = await conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      autoCommit: !dryRun && tool.access_mode === 'WRITE',
    });

    // 處理 OUT(rollback 前,cursor 還活著)
    const processed = await processOutBinds(execResult.outBinds, outMeta, tool, oracledb);
    fullResult = processed.full;
    auditResult = processed.truncated;
    rowsReturned = processed.rowsReturned;

    if (dryRun) {
      try { await conn.execute('ROLLBACK TO SAVEPOINT sp_erp_dry_run'); } catch (_) {}
      try { await conn.rollback(); } catch (_) {}
    }

  } catch (e) {
    error = {
      code: e.errorNum ? `ORA-${String(e.errorNum).padStart(5, '0')}` : 'ERR',
      message: String(e.message || e).slice(0, 2000),
    };
  } finally {
    if (conn) {
      try { await conn.close(); } catch (_) {}
    }
  }

  const durationMs = Date.now() - startedAt;

  // Audit log(含 error)
  let auditLogId = null;
  let cacheKey = null;
  try {
    if (fullResult) {
      // 先寫 audit 拿 id,再寫快取
    }
    const ins = await db.prepare(`
      INSERT INTO erp_tool_audit_log
        (tool_id, user_id, session_id, trigger_source, access_mode,
         input_json, output_sample, result_cache_key, duration_ms, rows_returned,
         error_code, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tool.id,
      userCtx.id || null,
      sessionId,
      triggerSource,
      tool.access_mode,
      truncateStr(JSON.stringify(userInputs || {}), 4000),
      auditResult ? truncateStr(JSON.stringify(auditResult), 4000) : null,
      null,
      durationMs,
      rowsReturned,
      error?.code || (dryRun ? 'DRY_RUN' : null),
      error?.message || (dryRun ? 'dry-run: 已 rollback,未實際套用' : null)
    );
    auditLogId = ins?.lastInsertRowid || ins?.lastID || null;

    if (fullResult && auditLogId) {
      cacheKey = await resultCache.saveResult(auditLogId, fullResult);
      if (cacheKey) {
        await db.prepare(`UPDATE erp_tool_audit_log SET result_cache_key = ? WHERE id = ?`)
          .run(cacheKey, auditLogId);
      }
    }
  } catch (e) {
    console.warn('[ErpExecutor] audit log failed:', e.message);
  }

  if (error) {
    const err = new Error(`[${error.code}] ${error.message}`);
    err.orig = error;
    err.durationMs = durationMs;
    err.auditLogId = auditLogId;
    throw err;
  }

  // LLM 截斷結果
  const llmResult = truncateForLlm(fullResult, tool.max_rows_llm);

  return {
    ok: true,
    dry_run: dryRun || undefined,
    duration_ms: durationMs,
    rows_returned: rowsReturned,
    result: llmResult,
    full_result: options.include_full ? fullResult : undefined,
    audit_log_id: auditLogId,
    cache_key: cacheKey,
  };
}

// ── 組 PL/SQL call ───────────────────────────────────────────────────────────
function buildPlSqlCall(tool, userInputs, userCtx) {
  const oracledb = erpDb.getOracledb();
  const binds = {};
  const outMeta = []; // [{ paramName, dataType }]

  const qualifiedParts = [tool.db_owner];
  if (tool.package_name) qualifiedParts.push(tool.package_name);
  qualifiedParts.push(tool.object_name);
  const qualified = qualifiedParts.join('.');

  const argFragments = [];
  for (const p of tool.params || []) {
    const io = (p.in_out || 'IN').toUpperCase();
    const bindName = sanitizeBindName(p.name);
    const bindType = metaSvc.mapOracleBindType(p.data_type, oracledb);

    if (io === 'IN') {
      const raw = resolveParamInput(p, userInputs, userCtx);
      if (p.required && (raw === null || raw === undefined || raw === '')) {
        throw new Error(`必填參數 ${p.name} 未提供`);
      }
      binds[bindName] = {
        dir: oracledb.BIND_IN,
        type: bindType,
        val: raw === null ? null : coerceInput(raw, p),
      };
    } else if (io === 'OUT') {
      binds[bindName] = {
        dir: oracledb.BIND_OUT,
        type: bindType,
      };
      if (bindType === oracledb.STRING) binds[bindName].maxSize = 32767;
      outMeta.push({ paramName: p.name, bindName, dataType: p.data_type });
    } else if (io === 'IN/OUT' || io === 'INOUT' || io === 'IN OUT') {
      const raw = resolveParamInput(p, userInputs, userCtx);
      binds[bindName] = {
        dir: oracledb.BIND_INOUT,
        type: bindType,
        val: raw === null ? null : coerceInput(raw, p),
      };
      if (bindType === oracledb.STRING) binds[bindName].maxSize = 32767;
      outMeta.push({ paramName: p.name, bindName, dataType: p.data_type });
    }

    argFragments.push(`${p.name} => :${bindName}`);
  }

  let sql;
  if (tool.routine_type === 'FUNCTION') {
    const retType = (tool.returns && tool.returns.data_type) || 'VARCHAR2';
    const retBind = metaSvc.mapOracleBindType(retType, oracledb);
    binds.ret_val = { dir: oracledb.BIND_OUT, type: retBind };
    if (retBind === oracledb.STRING) binds.ret_val.maxSize = 32767;
    outMeta.push({ paramName: 'ret_val', bindName: 'ret_val', dataType: retType, isReturn: true });
    sql = `BEGIN :ret_val := ${qualified}(${argFragments.join(', ')}); END;`;
  } else {
    sql = `BEGIN ${qualified}(${argFragments.join(', ')}); END;`;
  }

  return { sql, binds, outMeta };
}

function sanitizeBindName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 28) || 'b';
}

// ── 處理 OUT ─────────────────────────────────────────────────────────────────
async function processOutBinds(outBinds, outMeta, tool, oracledb) {
  if (!outBinds) return { full: { params: {} }, truncated: { params: {} }, rowsReturned: 0 };

  const fullOut = { params: {} };
  const truncOut = { params: {} };
  let rowsReturned = 0;

  for (const m of outMeta) {
    const raw = outBinds[m.bindName];
    if (m.isReturn) {
      const v = await readScalar(raw);
      fullOut.function_return = v;
      truncOut.function_return = v;
      continue;
    }
    const t = (m.dataType || '').toUpperCase();
    if (metaSvc.SUPPORTED_CURSOR_TYPES.has(t)) {
      const rows = await readCursor(raw, tool.max_rows_ui);
      rowsReturned = rows.length;
      fullOut.params[m.paramName] = {
        rows,
        total_fetched: rows.length,
        truncated_ui: rows.length >= tool.max_rows_ui,
      };
      truncOut.params[m.paramName] = {
        rows: rows.slice(0, tool.max_rows_llm),
        total_fetched: rows.length,
        truncated: rows.length > tool.max_rows_llm,
      };
    } else if (metaSvc.SUPPORTED_LOB_TYPES.has(t)) {
      const s = await readLob(raw);
      fullOut.params[m.paramName] = s;
      truncOut.params[m.paramName] = s && s.length > 2000
        ? s.slice(0, 2000) + '…[已截斷,完整見 cache_key]'
        : s;
    } else {
      const v = await readScalar(raw);
      fullOut.params[m.paramName] = v;
      truncOut.params[m.paramName] = v;
    }
  }

  return { full: fullOut, truncated: truncOut, rowsReturned };
}

async function readScalar(raw) {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw.toISOString();
  if (raw && typeof raw.getData === 'function') {
    // CLOB bind,少數情況
    try { return await raw.getData(); } catch (_) { return null; }
  }
  return raw;
}

async function readLob(lob) {
  if (!lob) return null;
  if (typeof lob === 'string') return lob;
  if (typeof lob.getData === 'function') {
    try { return await lob.getData(); } catch (_) { return null; }
  }
  return String(lob);
}

async function readCursor(cursor, maxRows) {
  if (!cursor) return [];
  try {
    const rows = await cursor.getRows(maxRows);
    return rows.map(row => normalizeRow(row));
  } finally {
    try { await cursor.close(); } catch (_) {}
  }
}

function normalizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (v && typeof v === 'object' && typeof v.getData === 'function') {
      // Lob 延遲讀取:簡化直接標記(細節可擴)
      out[k] = '[LOB]';
    } else out[k] = v;
  }
  return out;
}

// ── 截斷 ──────────────────────────────────────────────────────────────────────
function truncateForLlm(full, maxRowsLlm) {
  if (!full) return full;
  const out = { ...full };
  if (out.params) {
    const p = {};
    for (const [k, v] of Object.entries(out.params)) {
      if (v && Array.isArray(v.rows)) {
        p[k] = {
          rows: v.rows.slice(0, maxRowsLlm),
          total_fetched: v.total_fetched,
          truncated: v.total_fetched > maxRowsLlm,
          hint: v.total_fetched > maxRowsLlm
            ? `僅顯示前 ${maxRowsLlm} 列,共取得 ${v.total_fetched} 列,完整結果請向使用者索取 cache_key`
            : undefined,
        };
      } else if (typeof v === 'string' && v.length > 2000) {
        p[k] = v.slice(0, 2000) + '…[截斷]';
      } else {
        p[k] = v;
      }
    }
    out.params = p;
  }
  return out;
}

function truncateStr(s, n) {
  if (!s) return s;
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

module.exports = {
  execute,
  loadTool,
  issueConfirmToken,
  consumeConfirmToken,
  coerceInput,
};
