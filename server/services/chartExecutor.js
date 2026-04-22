/**
 * chartExecutor — User Chart Phase 5:重跑 source tool 取資料
 *
 * 核心:Template Share — 分享的是設計(spec + tool ref + params),不是資料。
 * 被分享者打開圖時走這裡:
 *   1. 用「被分享者自己」的權限呼叫 source tool
 *   2. 算 schema hash 跟 chart 存的比,若漂移就 warn
 *   3. 套用 chart_spec 的 x_field / y_fields 把結果 map 成 InlineChartSpec.data
 *   4. 回傳 { spec, data, warnings, error }
 *
 * source_tool 格式:
 *   - 'erp:<tool_id>'         — 走 erpToolExecutor.execute
 *   - 'mcp:<server_id>:<orig_tool_name>' — 走 mcpClient.callTool
 *   - 'skill:<skill_id>'      — 走 skill endpoint(預留,Phase 5b)
 *   - null / 'chat_freeform'  — 不可執行(分享 UI 已擋,server 也防一手)
 *
 * source_params(CLOB):參數定義表 + user 填的值
 *   [{ key, label, type, options?, default?, value? }]
 *
 * source_prompt(CLOB):僅 mcp 路徑或 fallback 用,參數佔位 ${key}
 */

const crypto = require('crypto');

const SCHEMA_HASH_LEN = 16; // 取 hex 前 16 字夠唯一
const ROW_HARDMAX = 2000;
const ROW_SOFTCAP = 200;

/**
 * 從 rows 算 schema hash:rows[0] 的 sorted keys 串接 sha256。
 * 用來偵測 tool 結果欄位漂移(欄位被改名 / 被砍 / 加新欄位)。
 */
function computeSchemaHash(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const first = rows[0];
  if (!first || typeof first !== 'object') return null;
  const keys = Object.keys(first).sort().join('|');
  return crypto.createHash('sha256').update(keys).digest('hex').slice(0, SCHEMA_HASH_LEN);
}

/**
 * 線性 downsample(同 chartSpecParser),避免 client 渲染爆。
 */
function downsample(rows, target = ROW_SOFTCAP) {
  if (!Array.isArray(rows) || rows.length <= target) return rows;
  const out = [];
  const step = (rows.length - 1) / (target - 1);
  for (let i = 0; i < target; i++) out.push(rows[Math.round(i * step)]);
  return out;
}

/**
 * 從 source_params 抽出 { key: value } 給 tool 用。
 * userInputs 優先,沒填就用 param.default。
 */
function resolveParams(paramsTemplate, userInputs = {}) {
  if (!Array.isArray(paramsTemplate)) return {};
  const out = {};
  for (const p of paramsTemplate) {
    if (!p || !p.key) continue;
    if (userInputs[p.key] !== undefined && userInputs[p.key] !== '') {
      out[p.key] = userInputs[p.key];
    } else if (p.default !== undefined) {
      out[p.key] = p.default;
    }
  }
  return out;
}

/**
 * 解析 result 字串(tool 通常回 string)為 rows 陣列。
 * 支援多種常見 shape:
 *   - Array<object>                   → 直接用
 *   - { rows: [...] }                 → 取 rows
 *   - { result: [...] }               → 取 result
 *   - { data: [...] }                 → 取 data
 *   - { result: { rows: [...] } }     → ERP executor 包過
 */
function extractRows(toolResult) {
  // string → 先 parse(tool 多半回 JSON 字串)
  if (typeof toolResult === 'string') {
    try { return extractRows(JSON.parse(toolResult)); } catch (_) { return null; }
  }
  if (Array.isArray(toolResult)) return toolResult;
  if (!toolResult || typeof toolResult !== 'object') return null;
  if (Array.isArray(toolResult.rows)) return toolResult.rows;
  if (Array.isArray(toolResult.result)) return toolResult.result;
  if (Array.isArray(toolResult.data)) return toolResult.data;
  if (toolResult.result && Array.isArray(toolResult.result.rows)) return toolResult.result.rows;
  if (toolResult.result && Array.isArray(toolResult.result.data)) return toolResult.result.data;
  return null;
}

/**
 * 解 'erp:42' / 'mcp:5:get_x' / 'skill:7' → { kind, ...refs }
 */
function parseSourceTool(sourceTool) {
  if (!sourceTool || typeof sourceTool !== 'string') return null;
  const [kind, ...rest] = sourceTool.split(':');
  if (kind === 'erp' && rest.length >= 1) return { kind: 'erp', toolId: Number(rest[0]) };
  if (kind === 'mcp' && rest.length >= 2) return { kind: 'mcp', serverId: Number(rest[0]), toolName: rest.slice(1).join(':') };
  if (kind === 'skill' && rest.length >= 1) return { kind: 'skill', skillId: Number(rest[0]) };
  return null;
}

/**
 * 執行 source tool,以「user」的權限。
 * @param {object} db
 * @param {object} chart    — user_charts row
 * @param {object} userInputs   — 使用者填的 params
 * @param {object} user
 * @param {object} ctx          — { sessionId? }
 * @returns {Promise<{ rows, schemaHash, warnings, error }>}
 */
async function runSourceTool(db, chart, userInputs, user, ctx = {}) {
  const ref = parseSourceTool(chart.source_tool);
  if (!ref) {
    return { error: '此 chart 無可重執行的 tool 來源(可能是 freeform chart),無法重跑' };
  }

  let paramsTemplate = [];
  try {
    if (chart.source_params) paramsTemplate = JSON.parse(chart.source_params);
  } catch (_) {}

  const args = resolveParams(paramsTemplate, userInputs);
  const warnings = [];
  let toolResult;

  try {
    if (ref.kind === 'erp') {
      const erpExec = require('./erpToolExecutor');
      const out = await erpExec.execute(db, ref.toolId, args, user, {
        trigger_source: 'user_chart_render',
        session_id: ctx.sessionId || null,
      });
      if (out.requires_confirmation) {
        return { error: 'ERP 工具需 WRITE 確認,不適合用在圖表重跑' };
      }
      toolResult = out;
    } else if (ref.kind === 'mcp') {
      const mcpClient = require('./mcpClient');
      const server = await db.prepare(`SELECT * FROM mcp_servers WHERE id=?`).get(ref.serverId);
      if (!server) return { error: `MCP server ${ref.serverId} 不存在` };
      const mcpUserCtx = {
        id: user.id, email: user.email || '', name: user.name || '',
        employee_id: user.employee_id || '', dept_code: user.dept_code || '',
      };
      toolResult = await mcpClient.callTool(db, server, ctx.sessionId || null, user.id, ref.toolName, args, mcpUserCtx);
    } else if (ref.kind === 'skill') {
      // Skill 路徑:跟 chat.js 的 code skill 呼叫對齊 — POST endpoint_url,
      // Authorization: Bearer endpoint_secret,body 帶 params + user meta
      const skill = await db.prepare(
        `SELECT id, name, endpoint_url, endpoint_secret FROM skills WHERE id=?`
      ).get(ref.skillId);
      if (!skill) return { error: `Skill ${ref.skillId} 不存在` };
      if (!skill.endpoint_url) return { error: `Skill ${ref.skillId} 未設定 endpoint_url` };

      const resp = await fetch(skill.endpoint_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Source': 'foxlink-gpt',
          ...(skill.endpoint_secret ? { Authorization: `Bearer ${skill.endpoint_secret}` } : {}),
        },
        body: JSON.stringify({
          ...args,
          user_id: user.id,
          user_name: user.name || '',
          employee_id: user.employee_id || '',
          session_id: ctx.sessionId || null,
          source: 'user_chart_render',
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (!resp.ok) return { error: `Skill endpoint HTTP ${resp.status}` };
      try {
        toolResult = await resp.json();
      } catch (_) {
        toolResult = await resp.text(); // extractRows 能處理 string
      }
    }
  } catch (e) {
    // 包成可讀錯誤(權限不足、ERP 連線斷、MCP server down)
    return { error: `工具執行失敗: ${e.message}`, warnings };
  }

  const rows = extractRows(toolResult);
  if (!rows) {
    return { error: '工具回傳格式無法解析為 rows 陣列', warnings };
  }
  if (rows.length === 0) {
    return { rows: [], schemaHash: null, warnings: ['工具回傳 0 筆資料'] };
  }
  if (rows.length > ROW_HARDMAX) {
    return { error: `工具回傳 ${rows.length} 筆,超過硬上限 ${ROW_HARDMAX}`, warnings };
  }

  const newHash = computeSchemaHash(rows);
  if (chart.source_schema_hash && newHash && newHash !== chart.source_schema_hash) {
    warnings.push(`資料來源欄位已變更(原 ${chart.source_schema_hash} → 現 ${newHash}),圖表可能需要 owner 重新設計`);
  }

  return {
    rows: downsample(rows),
    schemaHash: newHash,
    warnings,
  };
}

module.exports = {
  runSourceTool,
  computeSchemaHash,
  parseSourceTool,
  extractRows,
  resolveParams,
};
