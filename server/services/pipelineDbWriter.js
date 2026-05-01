'use strict';

/**
 * Pipeline DB Writer
 *
 * 被 pipelineRunner.js 的 `db_write` 節點呼叫,負責:
 *   1. 安全檢查(role / 白名單 / 黑名單 / operation)
 *   2. 從上游 JSON 解析 rows(支援 fenced code block、頂層物件、陣列)
 *   3. 套 column mapping + transform + required 驗證
 *   4. 自動附加 meta columns(meta_run_id / meta_pipeline / creation_date / last_updated_date)
 *      若 table schema 沒這欄,軟降級跳過
 *   5. 依 operation 組 INSERT / MERGE / DELETE+INSERT / append SQL
 *   6. 單筆容錯(on_row_error='skip' / 'stop')
 *   7. Dry-run 預覽
 *
 * 共用介面:
 *   executeDbWrite(db, nodeConfig, sourceText, context) → { inserted, updated, skipped, errors, dryRun? }
 */

const {
  FORBIDDEN_TABLES, OPERATIONS, TRANSFORMS,
  isValidIdentifier, isForbidden,
} = require('../config/pipelineSecurity');

// ── URL sanity check ────────────────────────────────────────────────────────
// 給 `cfg.url_check_columns: ['url']` 用。LLM 在 list 頁讀完後常憑記憶 / 想像生 URL
// (實測 MoneyDJ GUID 含非 hex 字元如 `8h16`,SMM news ID 長度不對),這個函式做
// 純格式檢查擋幻覺,**不發 HTTP**(K8s pod 對外網路有限制 + 太慢)。
//
// 檢查層次:
//   1. 通用:URL.parse 合法 + host 非空 + path 非根("/")— 擋「拿首頁當 article」
//   2. host-specific 已知 source 加嚴:
//      - moneydj.com newsviewer.aspx?a=<GUID> → GUID 必須是合法 hex(8-4-4-4-12)
//      - news.smm.cn /news/<id> → id 必須純數字(實測 ID 7-10 位)
//      其他 host 過 (1) 即可
function isValidArticleUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return { ok: false, reason: 'empty' };
  let u;
  try { u = new URL(rawUrl); } catch (_) { return { ok: false, reason: 'parse' }; }
  if (!u.hostname) return { ok: false, reason: 'no-host' };
  if (!u.pathname || u.pathname === '/' || u.pathname === '') {
    return { ok: false, reason: 'is-homepage' };
  }
  const host = u.hostname.toLowerCase();
  // MoneyDJ GUID hex check
  if (host.endsWith('moneydj.com') && /newsviewer\.aspx/i.test(u.pathname)) {
    const a = u.searchParams.get('a');
    if (!a) return { ok: false, reason: 'moneydj-no-guid' };
    // 標準 GUID:8-4-4-4-12 hex
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a)) {
      return { ok: false, reason: `moneydj-bad-guid:${a}` };
    }
  }
  // SMM news ID digit check
  if (host.endsWith('smm.cn') && /^\/news\//i.test(u.pathname)) {
    const m = u.pathname.match(/^\/news\/([^/?#]+)/i);
    if (!m) return { ok: false, reason: 'smm-no-id' };
    if (!/^\d{6,12}$/.test(m[1])) return { ok: false, reason: `smm-bad-id:${m[1]}` };
  }
  return { ok: true };
}

// ── JSON 解析 ────────────────────────────────────────────────────────────────
// 上游節點/AI 輸出可能含:
//   - ```json [...] ``` fenced block
//   - ```save_to_db:xxx [...] ``` legacy directive
//   - 純 JSON 字串
//   - markdown 包一堆文字 + JSON 陣列在中間
function extractJsonRows(text) {
  if (text == null) return null;
  if (typeof text !== 'string') {
    if (Array.isArray(text)) return text;
    if (typeof text === 'object') return [text];
    return null;
  }

  // 1. 直接 parse(純 JSON 情境)
  try {
    const direct = JSON.parse(text);
    if (Array.isArray(direct)) return direct;
    if (direct && typeof direct === 'object') return [direct];
  } catch (_) {}

  // 2. ```json ... ``` fenced block
  const fencedJson = text.match(/```(?:json|save_to_db(?::\w+)?)\s*\n([\s\S]*?)```/i);
  if (fencedJson) {
    try {
      const parsed = JSON.parse(fencedJson[1].trim());
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (_) {}
  }

  // 3. 任一 ``` ... ``` 中含陣列 / 物件 literal
  const anyFence = [...text.matchAll(/```[a-zA-Z_\-:]*\s*\n([\s\S]*?)```/g)];
  for (const f of anyFence) {
    const body = f[1].trim();
    if (!body) continue;
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') return [parsed];
    } catch (_) {}
  }

  // 4. 大括號抽取:找 `[...]` 或 `{...}` 貪婪匹配
  //    適用 LLM 把 JSON 放在 markdown 段落但沒包 code fence 的情況
  const arrMatch = text.match(/(\[[\s\S]*\])/);
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[1]);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }
  const objMatch = text.match(/(\{[\s\S]*\})/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[1]);
      if (parsed && typeof parsed === 'object') return [parsed];
    } catch (_) {}
  }

  return null;
}

// ── JSONPath 極簡版 ──────────────────────────────────────────────────────────
// 只支援 `$.a.b.c`、`$.a.b[0].c`、`$[*].x`(wildcard 只展開到 row 層就夠了)
// 複雜語法(filter / recursive)不支援,Pipeline 場景不需要。
function getByJsonPath(obj, path) {
  if (!path) return obj;
  let p = path.trim();
  if (p.startsWith('$')) p = p.slice(1);
  if (p.startsWith('.')) p = p.slice(1);
  if (!p) return obj;

  // 把 [0] / [*] 改寫成 .0 / .* 以便 split
  p = p.replace(/\[(\d+|\*)\]/g, '.$1');
  const parts = p.split('.').filter(Boolean);

  let cur = obj;
  for (const part of parts) {
    if (cur == null) return null;
    if (part === '*') {
      if (!Array.isArray(cur)) return null;
      // 不建議在 row-level transform 用 wildcard;預期呼叫端自己展開
      return cur;
    }
    cur = cur[part];
  }
  return cur;
}

// ── Mapping + transform ───────────────────────────────────────────────────────
function applyTransform(value, transformName) {
  if (!transformName) return value;
  const fn = TRANSFORMS[transformName];
  if (!fn) throw new Error(`不支援的 transform: ${transformName}`);
  return fn(value);
}

function mapRow(rawRow, columnMapping) {
  const out = {};
  const errors = [];
  for (const m of columnMapping || []) {
    if (!isValidIdentifier(m.column)) {
      errors.push(`欄位名非法: ${m.column}`);
      continue;
    }
    let v = getByJsonPath(rawRow, m.jsonpath);
    try { v = applyTransform(v, m.transform); }
    catch (e) { errors.push(`${m.column}: ${e.message}`); continue; }

    if ((v == null || v === '') && m.default != null && m.default !== '') {
      v = m.default;
    }
    if ((v == null || v === '') && m.required) {
      errors.push(`必填欄位 ${m.column} 為空`);
      continue;
    }
    out[m.column.toLowerCase()] = v;
  }
  return { row: out, errors };
}

// ── Column metadata 查詢 ──────────────────────────────────────────────────────
// 回傳 Map<lowercase_column_name, { type, nullable }>
// 先吃白名單表的 cached column_metadata,再 fallback 查 ALL_TAB_COLUMNS。
async function loadColumnMeta(db, tableName, cachedJson) {
  const map = new Map();

  if (cachedJson) {
    try {
      const arr = JSON.parse(cachedJson);
      for (const c of arr || []) {
        map.set(String(c.name || '').toLowerCase(), c);
      }
      if (map.size > 0) return map;
    } catch (_) {}
  }

  const rows = await db.prepare(
    `SELECT column_name, data_type, nullable
     FROM user_tab_columns WHERE UPPER(table_name)=UPPER(?)`
  ).all(tableName);
  for (const r of rows || []) {
    const name = (r.column_name || r.COLUMN_NAME || '').toLowerCase();
    const type = r.data_type || r.DATA_TYPE;
    const nullable = (r.nullable || r.NULLABLE) === 'Y';
    if (name) map.set(name, { name, type, nullable });
  }
  return map;
}

// ── Meta columns 自動附加 ─────────────────────────────────────────────────────
// 若 table 有這些欄位就寫,沒有就 skip(軟降級)
const META_COLS = ['meta_run_id', 'meta_pipeline', 'creation_date', 'last_updated_date'];

function attachMeta(row, colMeta, meta, isInsert) {
  const out = { ...row };
  // meta_run_id (NUMBER) — 用 runStartMs 當代理 id,唯一 + 可對 scheduled_task_runs.run_at 近似 join
  if (colMeta.has('meta_run_id') && meta.runId != null) out.meta_run_id = meta.runId;
  // meta_pipeline (VARCHAR) — task_name + node_id
  if (colMeta.has('meta_pipeline') && meta.pipeline) out.meta_pipeline = String(meta.pipeline).slice(0, 200);
  // creation_date 只在 INSERT 時填,UPDATE 不動(保留原始創建時間)
  if (isInsert && colMeta.has('creation_date')) out.creation_date = '__SYSTIMESTAMP__';
  // last_updated_date 每次都更新
  if (colMeta.has('last_updated_date')) out.last_updated_date = '__SYSTIMESTAMP__';
  return out;
}

// ── SQL builder ──────────────────────────────────────────────────────────────
// 把 row object 組成 (columns list, placeholder list, bind values)
// __SYSTIMESTAMP__ 特殊值 → SQL 端用 SYSTIMESTAMP,不進 bind
// DATE transform 後的 YYYY-MM-DD 字串 → TO_DATE(?, 'YYYY-MM-DD')
function buildInsertParts(row, colMeta) {
  const cols = [];
  const placeholders = [];
  const binds = [];
  for (const [col, val] of Object.entries(row)) {
    if (val === '__SYSTIMESTAMP__') {
      cols.push(col);
      placeholders.push('SYSTIMESTAMP');
      continue;
    }
    const meta = colMeta.get(col);
    const isDateCol      = meta && /^DATE$/i.test(meta.type || '');
    const isTimestampCol = meta && /^TIMESTAMP/i.test(meta.type || '');
    cols.push(col);

    // 對 DATE / TIMESTAMP 欄位的字串值,用 explicit TO_DATE / TO_TIMESTAMP,
    // 不要靠 Oracle NLS_DATE_FORMAT 隱式轉(prod 可能設成 DD-MON-RR,
    // 'YYYY-MM-DD' / ISO 8601 都會 ORA-01843 invalid month)
    if ((isDateCol || isTimestampCol) && typeof val === 'string' && val.trim()) {
      const s = val.trim();
      // ISO 8601:2026-04-28T00:00:00Z 或 2026-04-28T00:00:00.000+0800
      const tsM = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
      // 純日期:2026-04-28 或 2026/04/28
      const dM = s.replace(/\//g, '-').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (tsM) {
        const norm = `${tsM[1]}-${tsM[2].padStart(2,'0')}-${tsM[3].padStart(2,'0')} ${tsM[4].padStart(2,'0')}:${tsM[5].padStart(2,'0')}:${(tsM[6]||'0').padStart(2,'0')}`;
        placeholders.push(`TO_TIMESTAMP(?, 'YYYY-MM-DD HH24:MI:SS')`);
        binds.push(norm);
        continue;
      }
      if (dM) {
        const norm = `${dM[1]}-${dM[2].padStart(2,'0')}-${dM[3].padStart(2,'0')}`;
        placeholders.push(`TO_DATE(?, 'YYYY-MM-DD')`);
        binds.push(norm);
        continue;
      }
      // 字串但非 ISO/YYYY-MM-DD 格式 → 讓 Oracle 自己試,失敗會給 row error
      placeholders.push('?');
      binds.push(val);
      continue;
    }
    placeholders.push('?');
    binds.push(val);
  }
  return { cols, placeholders, binds };
}

// ── 單筆 INSERT ───────────────────────────────────────────────────────────────
async function execInsert(db, tableName, row, colMeta) {
  const { cols, placeholders, binds } = buildInsertParts(row, colMeta);
  if (!cols.length) throw new Error('無可寫入欄位');
  const sql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
  await db.prepare(sql).run(...binds);
  return 'inserted';
}

// ── 預先檢查 key 是否存在(用於區分 UPSERT 是 inserted 還是 updated)─────────
// Oracle MERGE 沒有 OUTPUT/RETURNING 區分動作,只能 SELECT 預判
async function keyExists(db, tableName, row, keyColumns, colMeta) {
  const keys = keyColumns.map(k => k.toLowerCase());
  const wherePieces = [];
  const binds = [];
  for (const k of keys) {
    const meta = colMeta.get(k);
    const isDateCol      = meta && /^DATE$/i.test(meta.type || '');
    const isTimestampCol = meta && /^TIMESTAMP/i.test(meta.type || '');
    const val = row[k];
    if (val == null) return false; // null key 不存在
    if ((isDateCol || isTimestampCol) && typeof val === 'string') {
      const s = val.trim();
      const tsM = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
      const dM = s.replace(/\//g, '-').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (tsM) {
        const norm = `${tsM[1]}-${tsM[2].padStart(2,'0')}-${tsM[3].padStart(2,'0')} ${tsM[4].padStart(2,'0')}:${tsM[5].padStart(2,'0')}:${(tsM[6]||'0').padStart(2,'0')}`;
        wherePieces.push(`${k} = TO_TIMESTAMP(?, 'YYYY-MM-DD HH24:MI:SS')`);
        binds.push(norm);
        continue;
      }
      if (dM) {
        const norm = `${dM[1]}-${dM[2].padStart(2,'0')}-${dM[3].padStart(2,'0')}`;
        wherePieces.push(`${k} = TO_DATE(?, 'YYYY-MM-DD')`);
        binds.push(norm);
        continue;
      }
    }
    wherePieces.push(`${k} = ?`);
    binds.push(val);
  }
  const sql = `SELECT 1 AS exists_flag FROM ${tableName} WHERE ${wherePieces.join(' AND ')} FETCH FIRST 1 ROWS ONLY`;
  try {
    const r = await db.prepare(sql).get(...binds);
    return !!r;
  } catch (_) { return false; }
}

// ── 單筆 MERGE(UPSERT)─────────────────────────────────────────────────────
// Oracle MERGE INTO target USING (SELECT ? AS col... FROM dual) s ON (t.k=s.k)
async function execUpsert(db, tableName, row, keyColumns, colMeta) {
  const keys = (keyColumns || []).map(k => k.toLowerCase());
  if (!keys.length) throw new Error('UPSERT 必須指定 key_columns');
  for (const k of keys) {
    if (!isValidIdentifier(k)) throw new Error(`非法 key column: ${k}`);
    if (!(k in row)) throw new Error(`UPSERT row 缺少 key column 值: ${k}`);
  }

  // 先用 SELECT 判斷 row 是否已存在(MERGE 後就無法區分了)
  const existedBefore = await keyExists(db, tableName, row, keys, colMeta);

  const { cols, placeholders, binds } = buildInsertParts(row, colMeta);
  // USING source — 用 dual 拼出虛擬 row
  const selectExprs = cols.map((c, i) => `${placeholders[i]} AS ${c}`);
  // ON clause — 只用 keys
  const onParts = keys.map(k => `t.${k} = s.${k}`);
  // UPDATE SET — 非 key + 非 creation_date(創建時間保留)
  const updateCols = cols.filter(c => !keys.includes(c) && c !== 'creation_date');
  if (!updateCols.length) {
    // 全欄位都是 key,沒東西可 update,退化成純 INSERT(配合 ignore dup)
    try { return await execInsert(db, tableName, row, colMeta); }
    catch (e) {
      if (/ORA-00001/.test(e.message)) return 'skipped'; // unique 衝突,視為無更新
      throw e;
    }
  }
  const updateSet = updateCols.map(c => `t.${c} = s.${c}`).join(', ');
  const insertCols = cols.join(', ');
  const insertVals = cols.map(c => `s.${c}`).join(', ');

  const sql = `MERGE INTO ${tableName} t
USING (SELECT ${selectExprs.join(', ')} FROM dual) s
ON (${onParts.join(' AND ')})
WHEN MATCHED THEN UPDATE SET ${updateSet}
WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})`;
  const r = await db.prepare(sql).run(...binds);
  if (r?.changes === 0) return 'skipped';
  // 依先前 SELECT 結果區分 inserted vs updated
  return existedBefore ? 'updated' : 'inserted';
}

// ── 單批 DELETE + INSERT(replace_by_date)────────────────────────────────
// 用於「同日重跑整批覆蓋」場景。傳入整批 rows。
async function execReplaceByDate(db, tableName, rows, dateColumn, colMeta) {
  if (!dateColumn || !isValidIdentifier(dateColumn)) throw new Error('replace_by_date 必須指定合法 date_column');
  const dc = dateColumn.toLowerCase();
  if (!colMeta.has(dc)) throw new Error(`date_column ${dc} 不存在於 table`);

  const dates = new Set();
  for (const r of rows) {
    if (r[dc] != null) dates.add(r[dc]);
  }
  if (!dates.size) throw new Error('replace_by_date 的 rows 無任何 date_column 值');

  const meta = colMeta.get(dc);
  const isDateType = /^DATE$/i.test(meta?.type || '');

  const summary = { inserted: 0, updated: 0, skipped: 0 };
  for (const d of dates) {
    if (isDateType && typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      await db.prepare(`DELETE FROM ${tableName} WHERE ${dc} = TO_DATE(?, 'YYYY-MM-DD')`).run(d);
    } else {
      await db.prepare(`DELETE FROM ${tableName} WHERE ${dc} = ?`).run(d);
    }
  }
  for (const r of rows) {
    await execInsert(db, tableName, r, colMeta);
    summary.inserted++;
  }
  return summary;
}

// ── 單筆 Append ───────────────────────────────────────────────────────────────
async function execAppend(db, tableName, row, colMeta) {
  await execInsert(db, tableName, row, colMeta);
  return 'inserted';
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
/**
 * @param {object} db
 * @param {object} nodeConfig  PipelineNode (type='db_write')
 * @param {string} sourceText  上游節點 / AI 輸出文字
 * @param {object} context     { user, userId, runId, taskName, nodeId, dryRun }
 * @returns {Promise<{ inserted, updated, skipped, errors, dryRun? }>}
 */
async function executeDbWrite(db, nodeConfig, sourceText, context = {}) {
  const cfg = nodeConfig || {};
  const tableName = String(cfg.table || '').toLowerCase().trim();
  const operation = String(cfg.operation || 'upsert').toLowerCase().trim();
  const keyColumns = Array.isArray(cfg.key_columns) ? cfg.key_columns : [];
  const dateColumn = cfg.date_column || null;
  const columnMapping = Array.isArray(cfg.column_mapping) ? cfg.column_mapping : [];
  const onRowError = cfg.on_row_error === 'stop' ? 'stop' : 'skip';
  const dryRun = !!context.dryRun || !!cfg.dry_run;

  // ─── 1. 安全檢查 ───────────────────────────────────────────────────────────
  const user = context.user || {};
  const isAdmin = user.role === 'admin';
  const isPipelineAdmin = user.is_pipeline_admin === 1 || user.is_pipeline_admin === true;
  if (!isAdmin && !isPipelineAdmin) {
    throw new Error('需要管理員或 pipeline_admin 權限');
  }

  if (!isValidIdentifier(tableName)) throw new Error(`非法 table 名稱: ${tableName}`);
  if (isForbidden(tableName)) throw new Error(`禁止寫入系統核心表: ${tableName}`);

  if (!OPERATIONS.includes(operation)) throw new Error(`不支援的 operation: ${operation}`);

  const wl = await db.prepare(
    `SELECT * FROM pipeline_writable_tables WHERE LOWER(table_name) = LOWER(?)`
  ).get(tableName);
  if (!wl) throw new Error(`table ${tableName} 未在 pipeline_writable_tables 白名單`);
  if ((wl.is_active ?? wl.IS_ACTIVE) !== 1) throw new Error(`table ${tableName} 白名單已停用`);

  const allowedOps = String(wl.allowed_operations || wl.ALLOWED_OPERATIONS || 'insert,upsert').split(',').map(s => s.trim().toLowerCase());
  if (!allowedOps.includes(operation)) throw new Error(`${tableName} 不允許 operation=${operation},允許:${allowedOps.join(',')}`);

  const maxRows = Number(cfg.max_rows || wl.max_rows_per_run || wl.MAX_ROWS_PER_RUN || 10000);

  // column mapping 欄位名全部 sanitize
  for (const m of columnMapping) {
    if (!isValidIdentifier(m.column)) throw new Error(`非法 column: ${m.column}`);
  }
  if (operation === 'upsert') {
    for (const k of keyColumns) if (!isValidIdentifier(k)) throw new Error(`非法 key_column: ${k}`);
  }

  // ─── 2. 解析 rows ──────────────────────────────────────────────────────────
  let rawRows = extractJsonRows(sourceText);
  if (!rawRows || !Array.isArray(rawRows)) {
    throw new Error('找不到可解析的 JSON 陣列 — 請確認上游節點輸出含 JSON(陣列或物件)');
  }

  // ─── 2.5 array_path:從 root JSON drill 到子陣列當 rows ─────────────────────
  // 用途:LLM 輸出 {report:{...}, forecasts:[...]},想 db_write forecasts 時
  //       設 array_path: '$.forecasts'(或 'forecasts')。預設 = 不 drill。
  const arrayPath = String(cfg.array_path || '').trim();
  if (arrayPath) {
    // extractJsonRows 把單 object 包成 [obj] — drill 前先解 root
    const root = (rawRows.length === 1 && rawRows[0] && typeof rawRows[0] === 'object' && !Array.isArray(rawRows[0]))
      ? rawRows[0]
      : rawRows;
    const drilled = getByJsonPath(root, arrayPath);
    if (drilled == null) {
      // array_path_optional=true 時找不到 → 視為 0 row,不擋 pipeline
      // (用於漸進式升級:LLM 還沒被 prompt 改造,新節點先 silent skip)
      if (cfg.array_path_optional) {
        return { inserted: 0, updated: 0, skipped: 0, errors: [], dryRun, preview: [] };
      }
      throw new Error(`array_path "${arrayPath}" 在上游 JSON 找不到對應值`);
    }
    if (!Array.isArray(drilled)) {
      throw new Error(`array_path "${arrayPath}" 的值不是陣列(實際: ${typeof drilled})`);
    }
    rawRows = drilled;
  }

  if (rawRows.length > maxRows) {
    throw new Error(`row 數 ${rawRows.length} 超過上限 ${maxRows}`);
  }
  if (!rawRows.length) {
    return { inserted: 0, updated: 0, skipped: 0, errors: [], dryRun, preview: [] };
  }

  // ─── 3. 載 table column metadata ──────────────────────────────────────────
  const colMeta = await loadColumnMeta(db, tableName, wl.column_metadata || wl.COLUMN_METADATA);
  if (!colMeta.size) throw new Error(`無法取得 ${tableName} 欄位資訊`);

  // ─── 4. Mapping + meta 附加 + 驗證 ─────────────────────────────────────────
  const meta = {
    runId: context.runId || null,
    pipeline: `${context.taskName || ''}${context.nodeId ? '::' + context.nodeId : ''}`.slice(0, 200) || null,
  };

  // 對 row 序列化成 800 字以內字串(超過 truncate),用於 errors 內附帶 LLM
  // 原始輸入。在 K8s log + admin run history 都看得到「LLM 給了什麼壞資料」。
  const previewRow = (rawRow) => {
    try {
      const s = JSON.stringify(rawRow);
      return s.length > 800 ? s.slice(0, 800) + '…' : s;
    } catch { return String(rawRow).slice(0, 800); }
  };

  const mappedRows = [];
  const errors = [];
  const droppedColsCount = new Map(); // colName → drop 次數,給 admin 看 schema 跟 prompt drift
  const urlCheckCols = Array.isArray(cfg.url_check_columns)
    ? cfg.url_check_columns.filter((c) => isValidIdentifier(c))
    : [];
  let urlCheckFailedCount = 0; // grafana / log 看「LLM 編了多少幻覺 URL」
  for (let i = 0; i < rawRows.length; i++) {
    const { row, errors: rowErrs } = mapRow(rawRows[i], columnMapping);
    if (rowErrs.length) {
      errors.push({ row_index: i, errors: rowErrs, row_payload: previewRow(rawRows[i]) });
      if (onRowError === 'stop') {
        throw new Error(`row #${i} 映射失敗: ${rowErrs.join('; ')}`);
      }
      continue;
    }
    // ── URL sanity check ────────────────────────────────────────────────────
    // url_check_columns 設定的欄位逐個格式驗證,失敗 = LLM 編 URL 幻覺,直接 skip
    if (urlCheckCols.length) {
      const urlErrs = [];
      for (const col of urlCheckCols) {
        if (row[col] == null || row[col] === '') continue;
        const r = isValidArticleUrl(String(row[col]));
        if (!r.ok) urlErrs.push(`${col}=${String(row[col]).slice(0, 120)} (${r.reason})`);
      }
      if (urlErrs.length) {
        urlCheckFailedCount++;
        errors.push({
          row_index: i,
          errors: ['url_check_failed: ' + urlErrs.join('; ')],
          row_payload: previewRow(rawRows[i]),
        });
        if (onRowError === 'stop') {
          throw new Error(`row #${i} URL 驗證失敗: ${urlErrs.join('; ')}`);
        }
        continue;
      }
    }
    // 對 LLM 多輸出的未知欄位,silent drop。LLM 多寫無害是常態(prompt 教或它自由發揮),
    // 不該整 row fail。Drop 列表收集起來放 db_write_summary.dropped_cols,
    // 讓 admin 看到 schema 跟 prompt/mapping drift。
    for (const c of Object.keys(row)) {
      if (!colMeta.has(c)) {
        droppedColsCount.set(c, (droppedColsCount.get(c) || 0) + 1);
        delete row[c];
      }
    }
    const isInsert = operation !== 'upsert'; // upsert 時 MERGE 自己判斷;其他一律算 insert
    const withMeta = attachMeta(row, colMeta, meta, isInsert);
    // 把原始 LLM row 貼上,後面 execInsert/execUpsert 失敗時把 payload 帶進 errors
    Object.defineProperty(withMeta, '__rawRow', { value: rawRows[i], enumerable: false });
    mappedRows.push(withMeta);
  }

  // ─── 5. Dry-run 預覽 ──────────────────────────────────────────────────────
  if (dryRun) {
    return {
      inserted: 0, updated: 0, skipped: 0,
      dryRun: true,
      preview: mappedRows.slice(0, 5),
      summary: {
        table: tableName,
        operation,
        total_rows: mappedRows.length,
        errors: errors.slice(0, 10),
        note: operation === 'upsert'
          ? `將以 ${keyColumns.join(',')} 為 key 執行 MERGE`
          : operation === 'replace_by_date'
            ? `將依 ${dateColumn} 先 DELETE 再 INSERT`
            : '將 INSERT 全部 rows',
      },
    };
  }

  // ─── 6. 實際寫入 ──────────────────────────────────────────────────────────
  const dropped_cols = droppedColsCount.size > 0
    ? Object.fromEntries(droppedColsCount)
    : null;
  if (dropped_cols) {
    console.warn(`[Pipeline db_write] dropped unknown columns from ${rawRows.length} rows:`, JSON.stringify(dropped_cols), '(LLM 出了 schema 沒有的欄位 — 可能 prompt/mapping drift,row 仍寫入)');
  }
  // inserted_preview:LLM 原始 row 前 5 筆,給 admin RunDetailModal 看「LLM 實際塞了什麼」
  // 用 rawRows(LLM 原始)而非 mappedRows(已 mapping 後 col→val),因為原始更接近 user 的肉眼判讀
  // 每筆 truncate 1500 字,避免 pipeline_log_json 爆大
  const inserted_preview = rawRows.slice(0, 5).map((r, i) => {
    let s; try { s = JSON.stringify(r); } catch { s = String(r); }
    return { row_index: i, payload: s.length > 1500 ? s.slice(0, 1500) + '…' : s };
  });
  // total_rows_in_input:LLM 解析出的 raw row 總數(在 array_path drill 後)
  // 配合 inserted/updated/skipped 可看出「LLM 給幾筆 → 實際落地幾筆」差距,
  // 例如 LLM 只給 3 筆 vs prompt 要求 12-25 筆 = 偷懶;或 10 筆 → 0 inserted = key 全 dup
  const result = {
    total_rows_in_input: rawRows.length,
    inserted: 0, updated: 0, skipped: 0,
    errors, dropped_cols, inserted_preview,
    // 給 admin 在 RunDetailModal 看「LLM 編了幾條假 URL」— 0 = 健康,>0 = 該檢查 prompt
    ...(urlCheckCols.length ? { url_check_failed_count: urlCheckFailedCount } : {}),
  };
  if (urlCheckFailedCount > 0) {
    console.warn(`[Pipeline db_write] ${urlCheckFailedCount}/${rawRows.length} rows 因 URL 驗證失敗被丟掉(LLM 幻覺 URL,table=${tableName})`);
  }

  try {
    if (operation === 'replace_by_date') {
      const summary = await execReplaceByDate(db, tableName, mappedRows, dateColumn, colMeta);
      result.inserted += summary.inserted;
      result.updated  += summary.updated;
      result.skipped  += summary.skipped;
    } else {
      for (let i = 0; i < mappedRows.length; i++) {
        const row = mappedRows[i];
        try {
          let action;
          if (operation === 'upsert') action = await execUpsert(db, tableName, row, keyColumns, colMeta);
          else if (operation === 'insert') {
            try { action = await execInsert(db, tableName, row, colMeta); }
            catch (e) {
              if (/ORA-00001/.test(e.message)) { result.skipped++; continue; }
              throw e;
            }
          } else if (operation === 'append') action = await execAppend(db, tableName, row, colMeta);
          else throw new Error(`未實作 operation: ${operation}`);

          if (action === 'inserted')      result.inserted++;
          else if (action === 'updated')  result.updated++;
          else                            result.skipped++;
        } catch (e) {
          result.errors.push({
            row_index: i,
            errors: [e.message],
            row_payload: previewRow(row.__rawRow ?? row),
          });
          if (onRowError === 'stop') throw e;
        }
      }
    }
  } catch (e) {
    // 最外層失敗 — 把已累積的 result 一併拋回,讓 pipeline log 看得到
    e._partialResult = result;
    throw e;
  }

  return result;
}

module.exports = {
  executeDbWrite,
  extractJsonRows,   // 導出供 dry-run API 用
  loadColumnMeta,    // 導出供 admin UI 欄位下拉用
  getByJsonPath,     // 導出讓 kb_write 也能用同套 array_path 解析
};
