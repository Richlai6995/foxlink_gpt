'use strict';

/**
 * ERP Tool Metadata Service
 * 從 Oracle ALL_ARGUMENTS 擷取 FUNCTION / PROCEDURE 定義
 */

const crypto = require('crypto');
const erpDb = require('./erpDb');

const SUPPORTED_SCALAR_TYPES = new Set([
  'VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR',
  'NUMBER', 'INTEGER', 'FLOAT', 'BINARY_FLOAT', 'BINARY_DOUBLE', 'PLS_INTEGER',
  'DATE', 'TIMESTAMP',
]);
const SUPPORTED_LOB_TYPES = new Set(['CLOB', 'NCLOB']);
const SUPPORTED_CURSOR_TYPES = new Set(['REF CURSOR', 'REF_CURSOR']);

function isSupportedType(dataType) {
  if (!dataType) return false;
  const t = dataType.toUpperCase();
  if (t.startsWith('TIMESTAMP')) return true;
  return SUPPORTED_SCALAR_TYPES.has(t) || SUPPORTED_LOB_TYPES.has(t) || SUPPORTED_CURSOR_TYPES.has(t);
}

function getAllowedSchemas() {
  const raw = process.env.ERP_ALLOWED_SCHEMAS;
  if (!raw) return null;
  return raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
}

function isSchemaAllowed(owner) {
  const allowed = getAllowedSchemas();
  if (!allowed || allowed.length === 0) return true;       // 未設定 = 放行全部
  if (allowed.includes('*')) return true;                  // 明確 * = 放行全部
  return allowed.includes(String(owner).toUpperCase());
}

/**
 * 抓取 owner.package.name 的所有 overload 的 metadata
 * @returns { overloads: [{ overload, routine_type, args: [...], return_arg }] }
 */
async function inspectRoutine({ owner, packageName, objectName }) {
  if (!owner || !objectName) throw new Error('owner 與 objectName 為必填');
  if (!isSchemaAllowed(owner)) {
    throw new Error(`Owner "${owner}" 不在白名單(ERP_ALLOWED_SCHEMAS)`);
  }

  const binds = {
    owner: String(owner).toUpperCase(),
    name: String(objectName).toUpperCase(),
    pkg: packageName ? String(packageName).toUpperCase() : null,
  };

  const sql = `
    SELECT owner, package_name, object_name, subprogram_id, overload,
           argument_name, position, sequence, data_level,
           data_type, pls_type, in_out, data_length, data_precision, data_scale,
           type_owner, type_name, type_subname, defaulted
    FROM   ALL_ARGUMENTS
    WHERE  UPPER(owner)        = :owner
      AND  UPPER(object_name)  = :name
      AND  ( (:pkg IS NULL AND package_name IS NULL)
             OR UPPER(package_name) = :pkg )
    ORDER BY subprogram_id NULLS FIRST, sequence
  `;

  const result = await erpDb.execute(sql, binds);
  if (!result || !result.rows || result.rows.length === 0) {
    throw new Error(`找不到 ${owner}.${packageName ? packageName + '.' : ''}${objectName}`);
  }

  const rowsByOverload = new Map();
  for (const r of result.rows) {
    const key = r.OVERLOAD || r.overload || '_single_';
    if (!rowsByOverload.has(key)) rowsByOverload.set(key, []);
    rowsByOverload.get(key).push(normalizeRow(r));
  }

  const overloads = [];
  for (const [overloadKey, rows] of rowsByOverload.entries()) {
    const args = [];
    let returnArg = null;
    let hasUnsupported = false;
    const unsupportedList = [];

    for (const r of rows) {
      if (r.dataLevel > 0) {
        hasUnsupported = true;
        unsupportedList.push(`${r.argumentName || '(nested)'}: 複合型別(data_level=${r.dataLevel})`);
        continue;
      }
      if (r.position === 0 && !r.argumentName) {
        returnArg = r;
        if (!isSupportedType(r.dataType)) {
          hasUnsupported = true;
          unsupportedList.push(`return: ${r.dataType}`);
        }
        continue;
      }
      if (!isSupportedType(r.dataType)) {
        hasUnsupported = true;
        unsupportedList.push(`${r.argumentName}: ${r.dataType}`);
      }
      args.push(r);
    }

    const routineType = returnArg ? 'FUNCTION' : 'PROCEDURE';

    overloads.push({
      overload: overloadKey === '_single_' ? null : overloadKey,
      routine_type: routineType,
      args,
      return_arg: returnArg,
      has_unsupported: hasUnsupported,
      unsupported_list: unsupportedList,
    });
  }

  return {
    owner: String(owner).toUpperCase(),
    package_name: packageName ? String(packageName).toUpperCase() : null,
    object_name: String(objectName).toUpperCase(),
    overloads,
  };
}

function normalizeRow(r) {
  return {
    argumentName: r.ARGUMENT_NAME || r.argument_name || null,
    position: Number(r.POSITION ?? r.position ?? 0),
    sequence: Number(r.SEQUENCE ?? r.sequence ?? 0),
    dataLevel: Number(r.DATA_LEVEL ?? r.data_level ?? 0),
    dataType: r.DATA_TYPE || r.data_type || null,
    plsType: r.PLS_TYPE || r.pls_type || null,
    inOut: r.IN_OUT || r.in_out || 'IN',
    dataLength: r.DATA_LENGTH ?? r.data_length ?? null,
    dataPrecision: r.DATA_PRECISION ?? r.data_precision ?? null,
    dataScale: r.DATA_SCALE ?? r.data_scale ?? null,
    typeOwner: r.TYPE_OWNER || r.type_owner || null,
    typeName: r.TYPE_NAME || r.type_name || null,
    typeSubname: r.TYPE_SUBNAME || r.type_subname || null,
    defaulted: r.DEFAULTED || r.defaulted || 'N',
  };
}

/**
 * 將一個 overload 轉成 params_json / returns_json 初始結構
 */
function overloadToParams(overload) {
  const params = overload.args.map(a => ({
    name: a.argumentName,
    position: a.position,
    in_out: a.inOut,
    data_type: a.dataType,
    pls_type: a.plsType,
    data_length: a.dataLength,
    data_precision: a.dataPrecision,
    data_scale: a.dataScale,
    required: a.defaulted !== 'Y',
    ai_hint: '',
    default_value: null,
    lov_config: null,
    inject_value: null,
    inject_source: null,
  }));

  const returns = overload.return_arg ? {
    data_type: overload.return_arg.dataType,
    pls_type: overload.return_arg.plsType,
    data_length: overload.return_arg.dataLength,
    data_precision: overload.return_arg.dataPrecision,
    data_scale: overload.return_arg.dataScale,
  } : null;

  return { params, returns };
}

function computeMetadataHash(overload) {
  const canonical = JSON.stringify({
    routine_type: overload.routine_type,
    overload: overload.overload,
    args: overload.args.map(a => ({
      name: a.argumentName, pos: a.position, io: a.inOut,
      type: a.dataType, len: a.dataLength, prec: a.dataPrecision, scale: a.dataScale,
    })),
    ret: overload.return_arg ? {
      type: overload.return_arg.dataType,
      len: overload.return_arg.dataLength,
    } : null,
  });
  return crypto.createHash('sha1').update(canonical).digest('hex');
}

function mapOracleBindType(dataType, oracledb) {
  if (!dataType) return oracledb.STRING;
  const t = dataType.toUpperCase();
  if (SUPPORTED_CURSOR_TYPES.has(t)) return oracledb.CURSOR;
  if (SUPPORTED_LOB_TYPES.has(t)) return oracledb.CLOB;
  if (t === 'NUMBER' || t === 'INTEGER' || t === 'FLOAT' || t === 'BINARY_FLOAT' || t === 'BINARY_DOUBLE' || t === 'PLS_INTEGER') return oracledb.NUMBER;
  if (t === 'DATE' || t.startsWith('TIMESTAMP')) return oracledb.DATE;
  return oracledb.STRING;
}

module.exports = {
  inspectRoutine,
  overloadToParams,
  computeMetadataHash,
  mapOracleBindType,
  isSchemaAllowed,
  isSupportedType,
  SUPPORTED_CURSOR_TYPES,
  SUPPORTED_LOB_TYPES,
};
