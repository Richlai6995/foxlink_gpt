'use strict';

/**
 * API Connector Service
 * 通用 REST API / DIFY 連接器執行引擎
 * - 支援 DIFY Chat Flow + 通用 REST API
 * - 認證: none / bearer / api_key_header / api_key_query / basic / oauth2_client / custom
 * - 輸入參數: 系統值自動注入 + AI 提取 + 固定值
 * - 回應處理: JSON 提取 / Text / XML / 格式化模板
 */

// ── OAuth2 Token Cache ──────────────────────────────────────────────────────
const oauth2Cache = new Map(); // key: connector_id → { token, expiresAt }

/**
 * 取得 OAuth2 access token (Client Credentials Grant)
 * @param {number} connectorId
 * @param {object} authConfig  { token_url, client_id, client_secret, scope, token_cache_seconds }
 * @returns {Promise<string>} access_token
 */
async function getOAuth2Token(connectorId, authConfig) {
  const cached = oauth2Cache.get(connectorId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const { token_url, client_id, client_secret, scope, token_cache_seconds = 3600 } = authConfig;
  const params = new URLSearchParams({ grant_type: 'client_credentials' });
  if (scope) params.set('scope', scope);

  const res = await fetch(token_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${client_id}:${client_secret}`).toString('base64'),
    },
    body: params.toString(),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OAuth2 token 取得失敗 (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const token = data.access_token;
  const expiresIn = data.expires_in || token_cache_seconds;
  // 提前 60 秒過期避免 race
  oauth2Cache.set(connectorId, { token, expiresAt: Date.now() + (expiresIn - 60) * 1000 });
  return token;
}

// ── System Parameter Resolver ───────────────────────────────────────────────
/**
 * 解析系統參數值
 * @param {string} source - 參數來源類型
 * @param {object} userCtx - { email, name, employee_id, dept_code, title, id }
 * @returns {string|null}
 */
function resolveSystemParam(source, userCtx) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  switch (source) {
    case 'system_user_email':       return userCtx.email || '';
    case 'system_user_name':        return userCtx.name || '';
    case 'system_user_employee_id': return userCtx.employee_id || '';
    case 'system_user_dept':        return userCtx.dept_code || '';
    case 'system_user_title':       return userCtx.title || '';
    case 'system_user_id':          return String(userCtx.id || '');
    case 'system_date':             return dateStr;
    case 'system_datetime':         return `${dateStr} ${timeStr}`;
    case 'system_timestamp':        return String(Math.floor(Date.now() / 1000));
    case 'system_year':             return String(now.getFullYear());
    case 'system_month':            return pad(now.getMonth() + 1);
    default:                        return null;
  }
}

// ── Input Parameters Resolution ─────────────────────────────────────────────
/**
 * 解析所有輸入參數
 * @param {Array} inputParams - InputParam[] 定義
 * @param {object} aiArgs - AI function calling 回傳的參數 { days: "3", keyword: "..." }
 * @param {object} userCtx - 使用者資訊
 * @returns {{ resolved: Record<string, string>, missing: string[] }}
 */
function resolveInputParams(inputParams, aiArgs = {}, userCtx = {}) {
  if (!inputParams || !Array.isArray(inputParams)) return { resolved: {}, missing: [] };

  const resolved = {};
  const missing = [];

  for (const param of inputParams) {
    let value = null;

    switch (param.source) {
      case 'fixed':
        value = param.fixed_value ?? '';
        break;

      case 'user_input': {
        // 優先用 AI 回傳的值
        value = aiArgs[param.name] ?? null;

        // 如果 AI 沒給值但有 extract_pattern，嘗試從 query 提取
        if (!value && param.extract_pattern && aiArgs.query) {
          try {
            const match = new RegExp(param.extract_pattern).exec(aiArgs.query);
            if (match) value = match[1] || match[0];
          } catch (_) { /* ignore bad regex */ }
        }

        // 還是沒有就用 default_value
        if (!value && param.default_value !== undefined && param.default_value !== null) {
          value = param.default_value;
        }
        break;
      }

      default:
        // system_* 類型
        value = resolveSystemParam(param.source, userCtx);
        break;
    }

    // 驗證
    if (param.required && (value === null || value === undefined || value === '')) {
      missing.push(param.label || param.name);
    }

    if (value !== null && value !== undefined && param.validation) {
      const v = param.validation;
      const s = String(value);
      if (v.min_length && s.length < v.min_length) missing.push(`${param.label || param.name} 長度不足`);
      if (v.max_length && s.length > v.max_length) value = s.slice(0, v.max_length);
      if (v.pattern) {
        try {
          if (!new RegExp(v.pattern).test(s)) missing.push(`${param.label || param.name} 格式不符`);
        } catch (_) { /* ignore */ }
      }
    }

    resolved[param.name] = value !== null && value !== undefined ? String(value) : '';
  }

  return { resolved, missing };
}

// ── Build HTTP Request ──────────────────────────────────────────────────────
/**
 * 建構 REST API 請求
 * @param {object} connector - DB row (dify_knowledge_bases + 新欄位)
 * @param {Record<string, string>} params - 已解析的參數值
 * @param {Array} [inputParamDefs] - 已解析的參數定義（避免重複解析 CLOB）
 * @returns {{ url: string, method: string, headers: Record<string,string>, body: string|null }}
 */
async function buildRequest(connector, params, inputParamDefs) {
  // 使用傳入的定義，或解析一次
  const paramDefs = inputParamDefs || parseJson(connector.input_params) || [];

  let url = connector.api_server || '';
  const method = (connector.http_method || 'POST').toUpperCase();
  const headers = {};
  let body = null;

  // ── 替換 path 參數 ──
  for (const p of paramDefs.filter(p => p.param_location === 'path')) {
    url = url.replace(`{{${p.name}}}`, encodeURIComponent(params[p.name] || ''));
  }

  // ── Query 參數 ──
  const queryParams = paramDefs.filter(p => p.param_location === 'query');
  if (queryParams.length) {
    const u = new URL(url);
    for (const p of queryParams) {
      if (params[p.name] !== undefined && params[p.name] !== '') {
        u.searchParams.set(p.name, params[p.name]);
      }
    }
    url = u.toString();
  }

  // ── Header 參數 ──
  for (const p of paramDefs.filter(p => p.param_location === 'header')) {
    if (params[p.name]) headers[p.name] = params[p.name];
  }

  // ── 認證 headers ──
  const authType = connector.auth_type || 'bearer';
  switch (authType) {
    case 'bearer':
      if (connector.api_key) headers['Authorization'] = `Bearer ${connector.api_key}`;
      break;
    case 'api_key_header':
      if (connector.auth_header_name && connector.api_key) {
        headers[connector.auth_header_name] = connector.api_key;
      }
      break;
    case 'api_key_query': {
      const u = new URL(url);
      if (connector.auth_query_param_name && connector.api_key) {
        u.searchParams.set(connector.auth_query_param_name, connector.api_key);
      }
      url = u.toString();
      break;
    }
    case 'basic':
      if (connector.api_key) {
        // api_key 存 "username:password"
        headers['Authorization'] = 'Basic ' + Buffer.from(connector.api_key).toString('base64');
      }
      break;
    case 'oauth2_client': {
      const authConfig = parseJson(connector.auth_config) || {};
      const token = await getOAuth2Token(connector.id, authConfig);
      headers['Authorization'] = `Bearer ${token}`;
      break;
    }
    case 'custom':
      // 所有認證資訊已在 request_headers 中
      break;
    case 'none':
    default:
      break;
  }

  // ── 自定義 headers ──
  const customHeaders = parseJson(connector.request_headers);
  if (customHeaders && typeof customHeaders === 'object') {
    for (const [k, v] of Object.entries(customHeaders)) {
      headers[k] = replaceTemplate(String(v), params);
    }
  }

  // ── Content-Type ──
  const contentType = connector.content_type || 'application/json';
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = contentType;
  }

  // ── Body ──
  if (method !== 'GET' && method !== 'HEAD') {
    const rawTpl = connector.request_body_template;
    // 防禦: Oracle 可能存 "null" 字串，trim 後若為空或 "null" 視為無 template
    const bodyTemplateTrimmed = (rawTpl && String(rawTpl).trim() !== 'null') ? String(rawTpl).trim() : null;
    if (bodyTemplateTrimmed) {
      body = replaceTemplate(bodyTemplate, params);
    } else {
      // 無 template 時，把所有 body 參數組成 JSON
      const bodyParams = paramDefs.filter(p => !p.param_location || p.param_location === 'body');
      console.log(`[API:buildRequest] bodyParams=${bodyParams.length} names=${bodyParams.map(p=>p.name)}`);
      if (bodyParams.length) {
        const obj = {};
        for (const p of bodyParams) obj[p.name] = params[p.name] || '';
        body = JSON.stringify(obj);
      } else if (Object.keys(params).length) {
        // fallback: 沒有明確 param_location 定義時，直接用所有 resolved params
        body = JSON.stringify(params);
      }
    }
  }

  return { url, method, headers, body };
}

// ── Execute REST API ────────────────────────────────────────────────────────
/**
 * 執行通用 REST API 呼叫
 * @param {object} connector - DB row
 * @param {Record<string, string>} resolvedParams - 已解析的參數
 * @param {object} options - { timeout, sessionId, userId, db }
 * @returns {Promise<{ answer: string, raw: any, duration: number, status: string }>}
 */
async function executeRestApi(connector, resolvedParams, options = {}) {
  const { timeout = 120000, sessionId, userId, db } = options;
  const t0 = Date.now();

  // 預先解析一次參數定義，避免 buildRequest 裡重複解析 CLOB
  console.log(`[API:DEBUG] input_params raw type=${typeof connector.input_params} val=${JSON.stringify(connector.input_params)?.slice(0, 300)}`);
  const inputParamDefs = parseJson(connector.input_params) || [];

  try {
    const { url, method, headers, body } = await buildRequest(connector, resolvedParams, inputParamDefs);

    console.log(`[API] Calling "${connector.name}" (id=${connector.id}) ${method} ${url} user=${userId} body=${body}`);

    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeout),
    });

    const duration = Date.now() - t0;
    const responseType = connector.response_type || 'json';

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const errorMapping = parseJson(connector.error_mapping) || {};
      const friendlyMsg = errorMapping[String(res.status)] || `API 回應錯誤 ${res.status}: ${errText.slice(0, 200)}`;

      logApiCall(db, connector.id, sessionId, userId, JSON.stringify(resolvedParams).slice(0, 200), 'error', `HTTP ${res.status}: ${errText.slice(0, 150)}`, duration);

      return { answer: `[${connector.name}: ${friendlyMsg}]`, raw: null, duration, status: 'error' };
    }

    let raw;
    let answer;

    if (responseType === 'text') {
      raw = await res.text();
      answer = raw.trim();
    } else if (responseType === 'xml') {
      raw = await res.text();
      answer = raw.trim();
    } else {
      // json or auto
      const text = await res.text();
      try {
        raw = JSON.parse(text);
      } catch {
        raw = text;
      }
      // 提取 JSON path
      if (raw && typeof raw === 'object' && connector.response_extract) {
        answer = extractJsonPath(raw, connector.response_extract);
        if (answer === undefined || answer === null) answer = JSON.stringify(raw, null, 2);
        else if (typeof answer === 'object') answer = JSON.stringify(answer, null, 2);
        else answer = String(answer);
      } else if (typeof raw === 'string') {
        answer = raw.trim();
      } else {
        answer = JSON.stringify(raw, null, 2);
      }
    }

    // 空回應處理
    if (!answer || answer.trim() === '' || answer === '[]' || answer === '{}') {
      answer = connector.empty_message || `[${connector.name}: 查無資料]`;
    }

    // 套用回應格式模板
    if (connector.response_template && answer) {
      answer = replaceTemplate(connector.response_template, {
        ...resolvedParams,
        response: answer,
        system_datetime: resolveSystemParam('system_datetime', {}),
        system_date: resolveSystemParam('system_date', {}),
      });
    }

    logApiCall(db, connector.id, sessionId, userId, JSON.stringify(resolvedParams).slice(0, 200), 'ok', null, duration, answer.slice(0, 300));

    console.log(`[API] "${connector.name}" ok in ${duration}ms answer="${(answer || '').slice(0, 100)}"`);
    return { answer, raw, duration, status: 'ok' };
  } catch (e) {
    const duration = Date.now() - t0;
    logApiCall(db, connector.id, sessionId, userId, JSON.stringify(resolvedParams).slice(0, 200), 'error', e.message.slice(0, 200), duration);
    console.error(`[API] "${connector.name}" failed user=${userId}:`, e.message);
    return { answer: `[${connector.name}: 連線失敗 - ${e.message}]`, raw: null, duration, status: 'error' };
  }
}

// ── Execute DIFY (enhanced with input_params) ───────────────────────────────
/**
 * 執行 DIFY 查詢（增強版：支援 input_params 注入到 inputs）
 * @param {object} connector - DB row
 * @param {string} query - 使用者查詢
 * @param {Record<string, string>} resolvedParams - 已解析的 input_params
 * @param {object} options - { sessionId, userId, db, getDifyConvId, setDifyConvId }
 * @returns {Promise<{ answer: string, duration: number, status: string }>}
 */
async function executeDifyWithParams(connector, query, resolvedParams, options = {}) {
  const { sessionId, userId, db, getDifyConvId, setDifyConvId } = options;
  const t0 = Date.now();
  const conversationId = getDifyConvId ? getDifyConvId(sessionId, connector.id) : '';

  console.log(`[DIFY] Calling "${connector.name}" (id=${connector.id}) user=${userId} query="${query.slice(0, 80)}" inputs=${JSON.stringify(resolvedParams)}`);

  try {
    const body = {
      inputs: resolvedParams || {},
      query,
      response_mode: 'blocking',
      user: `foxlink-user-${userId}`,
    };
    if (conversationId) body.conversation_id = conversationId;

    const difyRes = await fetch(`${connector.api_server}/chat-messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connector.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    const duration = Date.now() - t0;

    if (difyRes.ok) {
      const data = await difyRes.json();
      if (data.conversation_id && setDifyConvId) setDifyConvId(sessionId, connector.id, data.conversation_id);
      const answer = (data.answer || '').trim();
      logApiCall(db, connector.id, sessionId, userId, query.slice(0, 200), 'ok', null, duration, answer.slice(0, 300));
      console.log(`[DIFY] "${connector.name}" ok in ${duration}ms answer="${answer.slice(0, 100)}"`);
      return { answer: answer || `[${connector.name}: 無相關回應]`, duration, status: 'ok' };
    } else {
      const errText = await difyRes.text().catch(() => '');
      const msg = `HTTP ${difyRes.status}`;
      logApiCall(db, connector.id, sessionId, userId, query.slice(0, 200), 'error', `${msg}: ${errText.slice(0, 150)}`, duration);
      console.warn(`[DIFY] "${connector.name}" ${msg} user=${userId}: ${errText.slice(0, 200)}`);

      // 檢查 error_mapping
      const errorMapping = parseJson(connector.error_mapping) || {};
      const friendlyMsg = errorMapping[String(difyRes.status)] || `${msg}`;
      return { answer: `[${connector.name}: 查詢失敗 ${friendlyMsg}]`, duration, status: 'error' };
    }
  } catch (e) {
    const duration = Date.now() - t0;
    logApiCall(db, connector.id, sessionId, userId, query.slice(0, 200), 'error', e.message.slice(0, 200), duration);
    console.error(`[DIFY] "${connector.name}" failed user=${userId}:`, e.message);
    return { answer: `[${connector.name}: 查詢失敗 ${e.message}]`, duration, status: 'error' };
  }
}

// ── Unified Execute (routes any connector type) ─────────────────────────────
/**
 * 統一執行入口：根據 connector_type 分派
 * @param {object} connector - DB row
 * @param {object} aiArgs - AI function calling 回傳的參數
 * @param {object} userCtx - 使用者上下文 { id, email, name, employee_id, dept_code, title }
 * @param {object} options - { sessionId, db, getDifyConvId, setDifyConvId }
 * @returns {Promise<string>} answer text
 */
async function executeConnector(connector, aiArgs = {}, userCtx = {}, options = {}) {
  const inputParams = parseJson(connector.input_params) || [];
  const { resolved, missing } = resolveInputParams(inputParams, aiArgs, userCtx);

  if (missing.length) {
    return `[${connector.name}: 缺少必要參數: ${missing.join(', ')}]`;
  }

  const connType = connector.connector_type || 'dify';

  // ── 執行一次 ──
  const execOnce = async (params) => {
    if (connType === 'dify') {
      const query = aiArgs.query || '';
      return executeDifyWithParams(connector, query, params, { ...options, userId: userCtx.id });
    } else {
      return executeRestApi(connector, params, { ...options, userId: userCtx.id, timeout: 120000 });
    }
  };

  const result = await execOnce(resolved);

  // ── Email domain fallback retry ──
  // 若啟用且結果為空，嘗試切換 foxlink.com ↔ foxlink.com.tw 重試一次
  if (connector.email_domain_fallback && isEmptyResult(result.answer, connector)) {
    const emailKey = findEmailParamKey(inputParams);
    if (emailKey && resolved[emailKey]) {
      const altEmail = toggleFoxlinkDomain(resolved[emailKey]);
      if (altEmail) {
        console.log(`[API] "${connector.name}" empty result, retrying with alt email: ${resolved[emailKey]} → ${altEmail}`);
        const retryParams = { ...resolved, [emailKey]: altEmail };
        const retryResult = await execOnce(retryParams);
        if (!isEmptyResult(retryResult.answer, connector)) {
          return retryResult.answer;
        }
      }
    }
  }

  return result.answer;
}

// ── Build Gemini Function Declaration ───────────────────────────────────────
/**
 * 根據 connector 設定建構 Gemini function declaration
 * @param {object} connector - DB row
 * @returns {object} Gemini function declaration
 */
function buildFunctionDeclaration(connector) {
  const connType = connector.connector_type || 'dify';
  const inputParams = parseJson(connector.input_params) || [];

  // 只有 user_input 的參數需要 AI 提供
  const aiParams = inputParams.filter(p => p.source === 'user_input');

  const properties = {};
  const required = [];

  // DIFY 類型一定有 query
  if (connType === 'dify') {
    properties.query = {
      type: 'string',
      description: '使用者的查詢內容',
    };
    required.push('query');
  }

  // 加入需要 AI 提取的參數
  for (const p of aiParams) {
    const desc = [];
    if (p.description) desc.push(p.description);
    if (p.default_value !== undefined && p.default_value !== null && p.default_value !== '') {
      desc.push(`預設值: ${p.default_value}`);
    }
    if (p.enum_options && p.enum_options.length) {
      desc.push(`可選值: ${p.enum_options.map(o => o.label || o.value).join('、')}`);
    }

    properties[p.name] = {
      type: p.type === 'number' ? 'number' : 'string',
      description: desc.join('。') || p.label || p.name,
    };

    if (p.enum_options && p.enum_options.length) {
      properties[p.name].enum = p.enum_options.map(o => o.value);
    }

    // 有 default_value 的不算 required（AI 可以不提供）
    if (p.required && !p.default_value) {
      required.push(p.name);
    }
  }

  const safeName = `api_${connector.id}`;
  const scopeText = connector.description
    ? `此工具的適用範疇：${connector.description}`
    : `API 工具「${connector.name}」`;
  const typeLabel = connType === 'dify' ? '知識庫查詢' : 'API 查詢';
  const desc = `${typeLabel}工具「${connector.name}」。${scopeText}。` +
    `呼叫規則：(1) 使用者問題的核心意圖屬於上述範疇時就應呼叫，不要自行猜測答案；` +
    `(2) 同一輪回覆中此工具只呼叫一次，但不同輪次可以再次呼叫。`;

  return {
    name: safeName,
    description: desc,
    parameters: {
      type: 'object',
      properties,
      required,
    },
  };
}

// ── Test Connector (for admin panel) ────────────────────────────────────────
/**
 * 測試 API 連接器
 * @param {object} connector - DB row
 * @param {object} testParams - 管理員手動填入的測試參數值
 * @param {object} userCtx - 測試用的使用者上下文
 * @returns {Promise<{ success: boolean, answer?: string, duration_ms: number, error?: string }>}
 */
async function testConnector(connector, testParams = {}, userCtx = {}) {
  const connType = connector.connector_type || 'dify';
  const t0 = Date.now();

  try {
    if (connType === 'dify') {
      // DIFY 測試
      const inputParams = parseJson(connector.input_params) || [];
      const { resolved } = resolveInputParams(inputParams, testParams, userCtx);

      // 測試模式：允許 admin 手動覆蓋任何已解析的參數（包含 system 參數）
      for (const p of inputParams) {
        if (testParams[p.name] !== undefined && testParams[p.name] !== '') {
          resolved[p.name] = String(testParams[p.name]);
        }
      }

      const query = testParams.query || '你好，請說明你能回答哪些問題？';
      const body = {
        inputs: resolved,
        query,
        response_mode: 'blocking',
        conversation_id: '',
        user: `foxlink-test-${userCtx.id || 0}`,
      };

      const difyRes = await fetch(`${connector.api_server}/chat-messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${connector.api_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });

      const duration = Date.now() - t0;
      if (!difyRes.ok) {
        const errText = await difyRes.text();
        return { success: false, duration_ms: duration, error: `DIFY 回應錯誤 ${difyRes.status}: ${errText.slice(0, 200)}` };
      }
      const data = await difyRes.json();
      return { success: true, answer: data.answer || '(無回應)', duration_ms: duration, conversation_id: data.conversation_id };
    } else {
      // REST API 測試
      const inputParams = parseJson(connector.input_params) || [];
      const { resolved, missing } = resolveInputParams(inputParams, testParams, userCtx);

      // 測試模式：允許 admin 手動覆蓋任何已解析的參數（包含 system 參數）
      for (const p of inputParams) {
        if (testParams[p.name] !== undefined && testParams[p.name] !== '') {
          resolved[p.name] = String(testParams[p.name]);
        }
      }

      if (missing.length) {
        return { success: false, duration_ms: Date.now() - t0, error: `缺少必要參數: ${missing.join(', ')}` };
      }

      const result = await executeRestApi(connector, resolved, { timeout: 30000 });
      // Email domain fallback retry for test
      if (connector.email_domain_fallback && result.status === 'ok' && isEmptyResult(result.answer, connector)) {
        const emailKey = findEmailParamKey(inputParams);
        if (emailKey && resolved[emailKey]) {
          const altEmail = toggleFoxlinkDomain(resolved[emailKey]);
          if (altEmail) {
            console.log(`[API:test] "${connector.name}" empty result, retrying with alt email: ${resolved[emailKey]} → ${altEmail}`);
            const retryParams = { ...resolved, [emailKey]: altEmail };
            const retryResult = await executeRestApi(connector, retryParams, { timeout: 30000 });
            if (!isEmptyResult(retryResult.answer, connector)) {
              return { success: true, answer: `[自動重試 ${altEmail}]\n${retryResult.answer}`, duration_ms: Date.now() - t0 };
            }
          }
        }
      }
      return { success: result.status === 'ok', answer: result.answer, duration_ms: result.duration, error: result.status === 'error' ? result.answer : undefined };
    }
  } catch (e) {
    return { success: false, duration_ms: Date.now() - t0, error: `連線失敗：${e.message}` };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseJson(val) {
  if (!val) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

/**
 * 切換 foxlink email 域名: @foxlink.com ↔ @foxlink.com.tw
 * @param {string} email
 * @returns {string|null} 切換後的 email，若不符合 foxlink 格式則回傳 null
 */
function toggleFoxlinkDomain(email) {
  if (!email) return null;
  if (email.endsWith('@foxlink.com.tw')) return email.replace('@foxlink.com.tw', '@foxlink.com');
  if (email.endsWith('@foxlink.com'))    return email + '.tw';
  return null;
}

/**
 * 找出 resolvedParams 中 email 參數的 key（來源為 system_user_email）
 * @param {Array} paramDefs - input_params 定義
 * @returns {string|null} email 參數的 name
 */
function findEmailParamKey(paramDefs) {
  if (!paramDefs) return null;
  const p = paramDefs.find(p => p.source === 'system_user_email');
  return p ? p.name : null;
}

/**
 * 判斷回應是否為「查無資料」（空結果）
 * 檢查: 空值、自訂空訊息、常見「查無」關鍵字
 */
function isEmptyResult(answer, connector) {
  if (!answer) return true;
  const s = answer.trim();
  if (!s || s === '[]' || s === '{}') return true;
  // 比對 connector 自訂的 empty_message
  const empty = connector.empty_message || `[${connector.name}: 查無資料]`;
  if (s === empty) return true;
  // 常見的「查無」回應模式
  if (/查無|找不到|no\s*data|not\s*found|no\s*record/i.test(s) && s.length < 50) return true;
  return false;
}

/**
 * 替換模板中的 {{param}} 佔位符
 */
function replaceTemplate(template, params) {
  if (!template) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return params[key] !== undefined ? params[key] : '';
  });
}

/**
 * 簡易 JSON path 提取: "data.answer", "data[0].name", "items"
 */
function extractJsonPath(obj, path) {
  if (!path) return obj;
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function logApiCall(db, kbId, sessionId, userId, queryPreview, status, errorMsg, durationMs, responsePreview) {
  if (!db) return;
  try {
    db.prepare(
      `INSERT INTO dify_call_logs (kb_id, session_id, user_id, query_preview, response_preview, status, error_msg, duration_ms) VALUES (?,?,?,?,?,?,?,?)`
    ).run(kbId, sessionId || null, userId || null, queryPreview || null, responsePreview || null, status, errorMsg || null, durationMs);
  } catch (_) { /* silent */ }
}

module.exports = {
  resolveInputParams,
  resolveSystemParam,
  executeRestApi,
  executeDifyWithParams,
  executeConnector,
  buildFunctionDeclaration,
  testConnector,
  parseJson,
  replaceTemplate,
  getOAuth2Token,
};
