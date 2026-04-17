'use strict';

/**
 * ERP Tool Schema Generator
 * - 從 metadata 自動產生 tool code(給 LLM 呼叫的識別字)
 * - 從 metadata 產生 Gemini Function Declaration (tool_schema)
 */

function sanitizeIdent(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * 自動產 tool code:erp_{pkg}_{name}[_ov{overload}]
 */
function generateCode({ packageName, objectName, overload }) {
  const parts = ['erp'];
  if (packageName) parts.push(sanitizeIdent(packageName));
  parts.push(sanitizeIdent(objectName));
  if (overload) parts.push('ov' + overload);
  return parts.filter(Boolean).join('_').slice(0, 120);
}

/**
 * Oracle type → JSON Schema type
 */
function oracleTypeToJsonSchemaType(dataType) {
  if (!dataType) return 'string';
  const t = dataType.toUpperCase();
  if (t === 'NUMBER' || t === 'INTEGER' || t === 'FLOAT' || t === 'PLS_INTEGER'
      || t === 'BINARY_FLOAT' || t === 'BINARY_DOUBLE') return 'number';
  return 'string';
}

/**
 * 產生 Gemini tool_schema(OpenAI compatible function declaration)
 * IN / IN OUT 參數才會放進 properties;OUT 只是回傳
 * @param {object} tool erp_tools 欄位集合(含 code, name, description, params_json 已 parse)
 * @returns {object}
 */
function generateToolSchema(tool) {
  const params = tool.params || [];
  const properties = {};
  const required = [];

  for (const p of params) {
    const io = (p.in_out || 'IN').toUpperCase();
    if (io === 'OUT') continue;
    const jsType = oracleTypeToJsonSchemaType(p.data_type);
    const descParts = [];
    if (p.ai_hint) descParts.push(p.ai_hint);
    else descParts.push(`${p.data_type}${p.data_length ? `(${p.data_length})` : ''}`);
    if (p.lov_config?.type === 'static' && Array.isArray(p.lov_config.items)) {
      descParts.push('合法值:' + p.lov_config.items.map(i => i.value).join(', '));
    }

    // 有預設值 → 告訴 LLM 不用問
    const cfg = p.default_config;
    const hasDefault = cfg && cfg.mode !== 'none';
    const hasInjectSource = p.inject_source || p.inject_value != null;
    if (hasDefault || hasInjectSource) {
      if (cfg?.mode === 'fixed') descParts.push(`預設值:${cfg.fixed_value}，使用者未提供時自動使用預設值`);
      else if (cfg?.mode === 'preset') descParts.push(`預設值:系統自動帶入(${cfg.preset})，使用者未提供時自動使用預設值`);
      else if (hasInjectSource) descParts.push('系統自動帶入，不需使用者提供');
    }

    properties[p.name] = {
      type: jsType,
      description: descParts.join('；'),
    };

    if (p.lov_config?.type === 'static') {
      properties[p.name].enum = p.lov_config.items.map(i => String(i.value));
    }

    // 有預設/inject 的參數不列為 required
    if (p.required && !hasDefault && !hasInjectSource) {
      required.push(p.name);
    }
  }

  const desc = [tool.description || tool.name];
  if (tool.access_mode === 'WRITE') {
    desc.push('⚠ 此操作會修改 ERP 資料,呼叫後需使用者確認才會實際執行');
  }

  return {
    name: tool.code,
    description: desc.join('\n').slice(0, 1024),
    parameters: {
      type: 'object',
      properties,
      required,
    },
  };
}

module.exports = {
  generateCode,
  generateToolSchema,
  sanitizeIdent,
};
