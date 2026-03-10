/**
 * AI 戰情服務 — 核心查詢 Pipeline + ETL 排程
 *
 * 查詢流程：
 *   1. Cache 查詢
 *   2. 向量語意搜尋（Oracle 23 AI VECTOR_DISTANCE）
 *   3. 組裝 Prompt（schema + business_notes + 向量結果 + few-shot）
 *   4. Gemini 生成 SQL
 *   5. SQL 安全審查
 *   6. 執行 Oracle ERP 查詢
 *   7. 結果寫入 Cache + SSE 推送
 *
 * ETL 流程：
 *   cron 觸發 → Oracle ERP → Gemini embedding → INSERT Oracle 23 AI VECTOR
 */
require('dotenv').config();
const crypto = require('crypto');
const cron = require('node-cron');
const oracledb = require('oracledb');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ─── 常數 ─────────────────────────────────────────────────────────────────────
const EMBEDDING_MODEL = process.env.DASHBOARD_EMBEDDING_MODEL
  || process.env.KB_EMBEDDING_MODEL
  || 'gemini-embedding-001';

const DEFAULT_DIMS = parseInt(process.env.DASHBOARD_EMBEDDING_DIMS
  || process.env.KB_EMBEDDING_DIMS
  || '768');

const SQL_TIMEOUT_SEC  = parseInt(process.env.DASHBOARD_SQL_TIMEOUT_SEC || '30');
const MAX_ROWS         = parseInt(process.env.DASHBOARD_MAX_ROWS || '500');
const VECTOR_TOP_K     = parseInt(process.env.DASHBOARD_VECTOR_TOP_K || '10');
const ETL_MAX_ROWS     = parseInt(process.env.DASHBOARD_ETL_MAX_ROWS || '1000000');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── ERP SQL 唯讀保護 ─────────────────────────────────────────────────────────
// 在連線層攔截，所有對 ERP 的 execute() 皆經過此驗證（防禦縱深）
const ERP_FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|MERGE|UPSERT|GRANT|REVOKE|EXECUTE|DBMS_\w+|UTL_\w+)\b/i;
// FOR UPDATE 鎖定行為雖非資料修改，但在 ERP 環境下會造成表鎖，一律禁止
const ERP_FORBIDDEN_FOR_UPDATE = /\bFOR\s+UPDATE\b/i;

function assertErpReadOnly(sql) {
  // 移除行注解與區塊注解後再檢查，防止注入繞過
  const stripped = sql
    .replace(/--[^\r\n]*/g, ' ')        // 處理 CR+LF 換行
    .replace(/\/\*[\s\S]*?\*\//g, ' ')  // 移除區塊注解
    .trim();

  if (!/^\s*SELECT\b/i.test(stripped)) {
    const preview = stripped.substring(0, 80).replace(/\s+/g, ' ');
    throw new Error(`[ERP 唯讀保護] 僅允許 SELECT，已拒絕: ${preview}`);
  }
  if (ERP_FORBIDDEN.test(stripped)) {
    throw new Error('[ERP 唯讀保護] SQL 含有禁止關鍵字（DML/DDL/系統 Package），已拒絕執行');
  }
  if (ERP_FORBIDDEN_FOR_UPDATE.test(stripped)) {
    throw new Error('[ERP 唯讀保護] 禁止 FOR UPDATE（會鎖定 ERP 資料列），已拒絕執行');
  }
  // 禁止多語句（分號後接非空內容）
  if (/;\s*\S/.test(stripped)) {
    throw new Error('[ERP 唯讀保護] 禁止多語句，已拒絕執行');
  }
}

// ── ReadOnlyConnectionProxy：包裝 Oracle 連線，execute 前強制驗證 ────────────
// 使用 JS 私有欄位（#）確保 raw conn 無法從外部存取，防止 proxy._conn 繞過攻擊
// 白名單策略：只暴露 execute（驗證後）、queryStream（驗證後）、close
class ReadOnlyConnectionProxy {
  #conn  // 私有欄位，外部無法存取

  constructor(conn) { this.#conn = conn; }

  // ✅ 允許：驗證後 SELECT 才過
  async execute(sql, binds = [], opts = {}) {
    assertErpReadOnly(sql);
    return this.#conn.execute(sql, binds, opts);
  }

  // ✅ 允許：串流 SELECT，同樣驗證
  queryStream(sql, binds = [], opts = {}) {
    assertErpReadOnly(sql);
    return this.#conn.queryStream(sql, binds, opts);
  }

  // ✅ 允許：關閉連線
  async close() { return this.#conn.close(); }

  // ❌ 以下全部封鎖 ─────────────────────────────────────────────────────────
  async executeMany()    { throw new Error('[ERP 唯讀保護] 禁止 executeMany'); }
  async commit()         { throw new Error('[ERP 唯讀保護] 禁止 commit'); }
  async rollback()       { throw new Error('[ERP 唯讀保護] 禁止 rollback'); }
  async changePassword() { throw new Error('[ERP 唯讀保護] 禁止 changePassword'); }
  async shutdown()       { throw new Error('[ERP 唯讀保護] 禁止 shutdown'); }
  async startup()        { throw new Error('[ERP 唯讀保護] 禁止 startup'); }
  getSodaDatabase()      { throw new Error('[ERP 唯讀保護] 禁止 getSodaDatabase'); }
  async getQueue()       { throw new Error('[ERP 唯讀保護] 禁止 getQueue'); }
  async subscribe()      { throw new Error('[ERP 唯讀保護] 禁止 subscribe'); }
  async createLob()      { throw new Error('[ERP 唯讀保護] 禁止 createLob'); }
  async beginSessionlessTransaction()   { throw new Error('[ERP 唯讀保護] 禁止 transaction 操作'); }
  async resumeSessionlessTransaction()  { throw new Error('[ERP 唯讀保護] 禁止 transaction 操作'); }
  async suspendSessionlessTransaction() { throw new Error('[ERP 唯讀保護] 禁止 transaction 操作'); }
  async tpcBegin()    { throw new Error('[ERP 唯讀保護] 禁止 TPC 操作'); }
  async tpcCommit()   { throw new Error('[ERP 唯讀保護] 禁止 TPC 操作'); }
  async tpcRollback() { throw new Error('[ERP 唯讀保護] 禁止 TPC 操作'); }
}

// ── ReadOnlyPoolProxy：getConnection() 回傳 proxy 連線 ───────────────────────
// 使用 JS 私有欄位（#）確保 raw pool 無法從外部存取
class ReadOnlyPoolProxy {
  #pool  // 私有欄位，防止 proxy._pool 直接存取 raw pool

  constructor(rawPool) { this.#pool = rawPool; }
  async getConnection() {
    const conn = await this.#pool.getConnection();
    return new ReadOnlyConnectionProxy(conn);
  }
}

// ─── ERP 連線（唯讀，透過 ReadOnlyPoolProxy 強制保護）───────────────────────
// poolAlias 使用隨機 token，防止外部透過 oracledb.getPool('erp_db') 取得 raw pool
const ERP_POOL_ALIAS = `erp_${crypto.randomBytes(8).toString('hex')}`;
let _erpPoolProxy = null;
let _erpPoolInitPromise = null;  // 防止並發初始化競爭條件

async function getErpPool() {
  if (_erpPoolProxy) return _erpPoolProxy;
  // 單例 Promise：多個並發請求只建立一次 pool
  if (!_erpPoolInitPromise) {
    _erpPoolInitPromise = (async () => {
      if (!process.env.ERP_DB_HOST) throw new Error('ERP_DB_HOST 未設定');
      const rawPool = await oracledb.createPool({
        poolAlias:     ERP_POOL_ALIAS,  // 隨機 alias，無法透過 oracledb.getPool() 猜到
        user:          process.env.ERP_DB_USER,
        password:      process.env.ERP_DB_USER_PASSWORD,
        connectString: `${process.env.ERP_DB_HOST}:${process.env.ERP_DB_PORT}/${process.env.ERP_DB_SERVICE_NAME}`,
        poolMin: 1, poolMax: 5, poolIncrement: 1, poolTimeout: 60,
      });
      _erpPoolProxy = new ReadOnlyPoolProxy(rawPool);
      console.log('[ERP] 唯讀連線池已建立（ReadOnlyPoolProxy, alias 隱藏）');
    })();
  }
  await _erpPoolInitPromise;
  return _erpPoolProxy;
}

// ─── SQL 安全審查（AI 生成 SQL 的 route-level 驗證）──────────────────────────
// 與 assertErpReadOnly 相輔相成：此為 route 層快速檢查，proxy 為最後防線
function validateSql(sql) {
  assertErpReadOnly(sql);   // 共用同一套規則，確保一致
  return sql.trim();
}

// ─── Cache ────────────────────────────────────────────────────────────────────
function hashQuestion(designId, question) {
  return crypto.createHash('sha256').update(`${designId}::${question}`).digest('hex');
}

async function getCachedResult(db, designId, question) {
  const hash = hashQuestion(designId, question);
  const row = await db.prepare(
    `SELECT result_json, generated_sql, row_count FROM ai_query_cache
     WHERE design_id=? AND question_hash=? AND expires_at > SYSTIMESTAMP`
  ).get(designId, hash);
  if (!row) return null;
  return {
    cached: true,
    result: JSON.parse(row.result_json),
    sql: row.generated_sql,
    row_count: row.row_count,
  };
}

async function setCachedResult(db, designId, question, sql, result, ttlMinutes) {
  const hash = hashQuestion(designId, question);
  // parseInt 確保 ttlMinutes 是整數，防止字串插值時 SQL 注入；clamp 到合理範圍
  const safeTtl = Math.max(1, Math.min(1440, parseInt(ttlMinutes, 10) || 30));
  try {
    await db.prepare(`DELETE FROM ai_query_cache WHERE design_id=? AND question_hash=?`)
      .run(designId, hash);
    await db.prepare(
      `INSERT INTO ai_query_cache (design_id, question_hash, generated_sql, result_json, row_count, expires_at)
       VALUES (?, ?, ?, ?, ?, SYSTIMESTAMP + INTERVAL '${safeTtl}' MINUTE)`
    ).run(designId, hash, sql, JSON.stringify(result), result.length);
  } catch (e) {
    console.warn('[Dashboard] Cache write error:', e.message);
  }
}

// ─── Embedding ────────────────────────────────────────────────────────────────
async function getEmbedding(text, dims = DEFAULT_DIMS) {
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent({
    content: { parts: [{ text }], role: 'user' },
    taskType: 'RETRIEVAL_QUERY',
    outputDimensionality: dims,
  });
  return result.embedding.values;
}

// 批次 embedding — 一次最多 100 筆（Gemini API 限制）
// 回傳 { embeddings: number[][], tokenCount: number }
const EMBED_BATCH_SIZE = 100;
async function getBatchEmbeddings(texts, dims = DEFAULT_DIMS) {
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.batchEmbedContents({
    requests: texts.map(text => ({
      content: { parts: [{ text }], role: 'user' },
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: dims,
    })),
  });
  const tokenCount = result.usageMetadata?.promptTokenCount
    || result.usageMetadata?.totalTokenCount
    || 0;
  return {
    embeddings: (result.embeddings || []).map(e => e.values),
    tokenCount,
  };
}

// ─── 向量搜尋（Oracle 23 AI）────────────────────────────────────────────────
async function vectorSearch(db, jobIds, queryEmbedding, topK = VECTOR_TOP_K, similarityThreshold = null) {
  if (!jobIds || jobIds.length === 0) return [];
  const pool = require('../database-oracle').getPool();
  const conn = await pool.getConnection();
  try {
    // 嚴格驗證每個 embedding 元素為有限數值，防止 Gemini API 回傳異常值時 SQL 注入系統 DB
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0)
      throw new Error('queryEmbedding 必須是非空陣列');
    const safeFloats = queryEmbedding.map(v => {
      const n = Number(v);
      if (!isFinite(n)) throw new Error(`embedding 含非數值元素: ${v}`);
      return n;
    });
    const vecStr = `[${safeFloats.join(',')}]`;
    const inClause = jobIds.map((_, i) => `:j${i}`).join(',');
    const binds = {};
    jobIds.forEach((id, i) => { binds[`j${i}`] = id; });
    binds.topK = topK;
    // 用 bind variable 傳向量字串，避免 ORA-01704（字串字面量 >4000 字元限制）
    binds.qvec = { val: vecStr, type: oracledb.STRING };

    const sql = `
      SELECT etl_job_id, source_table, source_pk, field_name, field_value, metadata,
             VECTOR_DISTANCE(embedding, TO_VECTOR(:qvec), COSINE) AS score
      FROM ai_vector_store
      WHERE etl_job_id IN (${inClause})
      ORDER BY score ASC
      FETCH FIRST :topK ROWS ONLY
    `;
    const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    let rows = result.rows || [];
    // 相似度門檻過濾（COSINE distance: 越小越相似，通常 0~1）
    if (similarityThreshold !== null && similarityThreshold !== undefined) {
      const threshold = parseFloat(similarityThreshold);
      if (!isNaN(threshold)) rows = rows.filter(r => r.SCORE <= threshold);
    }
    return rows.map(r => ({
      etl_job_id:   r.ETL_JOB_ID,
      source_table: r.SOURCE_TABLE,
      source_pk:    r.SOURCE_PK,
      field_name:   r.FIELD_NAME,
      field_value:  r.FIELD_VALUE,
      metadata:     r.METADATA,
      score:        r.SCORE,
    }));
  } finally {
    await conn.close();
  }
}

// ─── 向量查詢翻譯（中文→英文，提升跨語言 embedding 對齊）──────────────────────
// 若問句含有中文，先用 Gemini Flash 萃取語意關鍵字並翻成英文，再做 embedding
// SQL 生成仍使用原始問句，僅 embedding 用翻譯版本
async function translateQueryForEmbedding(question) {
  // 沒有中文字元就不翻
  if (!/[\u4e00-\u9fff]/.test(question)) return question;
  try {
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash',
    });
    const result = await model.generateContent(
      `Extract the key product/item description keywords from the following query and translate them to English.\n` +
      `Return ONLY the English keywords suitable for semantic search against an English product description database.\n` +
      `Do NOT include company codes, date ranges, quantity fields, or SQL terms — only the product/item description terms.\n` +
      `Query: "${question}"\n` +
      `English keywords only:`
    );
    const translated = result.response.text().trim().replace(/^["']|["']$/g, '');
    console.log(`[Dashboard] Embedding query translation: "${question}" → "${translated}"`);
    return translated || question;
  } catch (e) {
    console.warn('[Dashboard] Query translation failed, using original:', e.message);
    return question;
  }
}

// ─── 向量跳過判斷 ─────────────────────────────────────────────────────────────
// 回傳 { skip: boolean, reason: 'explicit_value' | null }
// reason='explicit_value' → 問題含有明確的欄位值（料號/計畫號等），向量結果不可靠
async function shouldSkipVector(db, design, question) {
  if (!design.vector_skip_fields) return { skip: false, reason: null };
  let skipFields;
  try {
    skipFields = typeof design.vector_skip_fields === 'string'
      ? JSON.parse(design.vector_skip_fields) : design.vector_skip_fields;
  } catch { return { skip: false, reason: null }; }
  if (!Array.isArray(skipFields) || skipFields.length === 0) return { skip: false, reason: null };

  // 取得這些欄位的 sample_values 與 data_type
  const schemaIds = design.target_schema_ids ? JSON.parse(design.target_schema_ids) : [];
  for (const colName of skipFields) {
    const col = await db.prepare(
      `SELECT c.data_type, c.sample_values
       FROM ai_schema_columns c
       JOIN ai_schema_definitions s ON s.id = c.schema_id
       WHERE c.column_name = ? AND s.id IN (${schemaIds.map(() => '?').join(',') || '0'})`
    ).get(colName, ...schemaIds);

    // 根據 sample_values 建立 pattern；若無 sample 則用通用英數碼 pattern
    let pattern;
    if (col?.sample_values) {
      const samples = col.sample_values.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      const hasAlphaNum = samples.some(s => /^[A-Z0-9\-_]{3,}$/i.test(s));
      if (hasAlphaNum) {
        pattern = /(?<![一-龥])[A-Z0-9]{2,}[A-Z0-9\-_]*[A-Z0-9]{2,}(?![一-龥])/i;
      }
    }
    if (!pattern) {
      pattern = /[A-Z0-9]{3,}[\-_][A-Z0-9\-_]{2,}/i;
    }
    if (pattern.test(question)) return { skip: true, reason: 'explicit_value' };
  }
  return { skip: false, reason: null };
}

// ─── Prompt 組裝 ──────────────────────────────────────────────────────────────
async function buildPrompt(db, design, question, vectorResults, skipReason) {
  // 取得 schema 定義
  const schemaIds = design.target_schema_ids ? JSON.parse(design.target_schema_ids) : [];
  const schemaMap = {}; // id -> schema record with alias
  let schemaContext = '';

  for (const sid of schemaIds) {
    const s = await db.prepare(`SELECT * FROM ai_schema_definitions WHERE id=?`).get(sid);
    if (!s) continue;
    const cols = await db.prepare(`SELECT * FROM ai_schema_columns WHERE schema_id=?`).all(sid);
    const alias = s.alias || s.table_name.split('.').pop().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    schemaMap[sid] = { ...s, resolvedAlias: alias };

    schemaContext += `\n## 資料表：${s.table_name}（${s.display_name || ''}）別名：${alias}\n`;
    if (s.source_type === 'sql' && s.source_sql) {
      schemaContext += `### 來源 SQL（使用此作為子查詢）：\n\`\`\`sql\n${s.source_sql}\n\`\`\`\n`;
    }
    if (s.business_notes) schemaContext += `### 說明：\n${s.business_notes}\n`;
    if (s.base_conditions) {
      try {
        const bc = typeof s.base_conditions === 'string' ? JSON.parse(s.base_conditions) : s.base_conditions;
        if (Array.isArray(bc) && bc.length) {
          schemaContext += `### 固定篩選條件（必須包含在 WHERE）：\n`;
          for (const c of bc) {
            const noRight = ['IS NULL', 'IS NOT NULL'].includes(c.op);
            schemaContext += `- ${c.col} ${c.op}${noRight ? '' : ' ' + c.val}\n`;
          }
        }
      } catch (_) {}
    }

    if (cols.length) {
      const realCols = cols.filter(c => !c.is_virtual);
      const virtualCols = cols.filter(c => c.is_virtual);
      schemaContext += `### 欄位（使用別名 ${alias}.欄位名 引用）：\n`;
      for (const c of realCols) {
        let line = `- ${alias}.${c.column_name} (${c.data_type || '?'}): ${c.description || ''}`;
        if (c.value_mapping) {
          const vm = typeof c.value_mapping === 'string' ? JSON.parse(c.value_mapping) : c.value_mapping;
          line += ` | 代碼對應: ${JSON.stringify(vm)}`;
        }
        if (c.sample_values) {
          const sv = typeof c.sample_values === 'string' ? JSON.parse(c.sample_values) : c.sample_values;
          line += ` | 範例值: ${JSON.stringify(sv)}`;
        }
        schemaContext += line + '\n';
      }
      if (virtualCols.length) {
        schemaContext += `### 計算欄位（可直接在 SELECT 中使用以下表達式）：\n`;
        for (const c of virtualCols) {
          schemaContext += `- ${c.column_name} AS ${c.column_name}: ${c.expression} — ${c.description || ''}\n`;
        }
      }
    }
  }

  // 建構 FROM clause 提示（若有選取 Join）
  const joinIds = design.target_join_ids ? JSON.parse(design.target_join_ids) : [];
  let fromClause = '';
  if (Object.keys(schemaMap).length > 0) {
    // 找出主表（第一個 schema 或未被 join 右側引用的 schema）
    const rightSchemaIds = new Set();
    const selectedJoins = [];
    for (const jid of joinIds) {
      const j = await db.prepare(`SELECT * FROM ai_schema_joins WHERE id=?`).get(jid);
      if (j) { selectedJoins.push(j); rightSchemaIds.add(j.right_schema_id); }
    }

    // 主表 = 第一個 schema（或第一個不在右側的）
    const mainSchemaId = schemaIds.find(id => !rightSchemaIds.has(id)) || schemaIds[0];
    const mainSchema = schemaMap[mainSchemaId];
    if (mainSchema) {
      const mainSource = mainSchema.source_type === 'sql'
        ? `(${mainSchema.source_sql})`
        : mainSchema.table_name;
      fromClause = `FROM ${mainSource} ${mainSchema.resolvedAlias}\n`;

      for (const j of selectedJoins) {
        const rightSchema = schemaMap[j.right_schema_id];
        if (!rightSchema) continue;
        const rightSource = rightSchema.source_type === 'sql'
          ? `(${rightSchema.source_sql})`
          : rightSchema.table_name;

        let conditions = [];
        try {
          conditions = typeof j.conditions_json === 'string'
            ? JSON.parse(j.conditions_json) : (j.conditions_json || []);
        } catch (_) {}

        const onClause = conditions.length
          ? conditions.map(c => {
              if (['IS NULL', 'IS NOT NULL'].includes(c.op)) return `${c.left} ${c.op}`;
              if (c.op === 'BETWEEN') return `${c.left} BETWEEN ${c.right} AND ${c.right2 || c.right}`;
              if (c.op === 'IN' || c.op === 'NOT IN') return `${c.left} ${c.op} (${c.right})`;
              return `${c.left} ${c.op || '='} ${c.right}`;
            }).join('\n  AND ')
          : '/* 請補充 JOIN 條件 */';

        fromClause += `${j.join_type || 'LEFT'} JOIN ${rightSource} ${rightSchema.resolvedAlias} ON ${onClause}\n`;
      }
    }
  }

  // 向量搜尋相似案例 → 解析 source_pk 組成 IN-clause 供 AI 直接使用
  let vectorContext = '';
  if (vectorResults && vectorResults.length > 0) {
    // 解析 source_pk："key1=val1|key2=val2" → { key1: val1, key2: val2 }
    const parsePk = (pkStr) => {
      if (!pkStr) return {};
      // 新格式 "inventory_item_id=12345|org_id=99"
      if (pkStr.includes('=')) {
        return Object.fromEntries(
          pkStr.split('|').map(seg => {
            const eq = seg.indexOf('=');
            return [seg.slice(0, eq).trim(), seg.slice(eq + 1).trim()];
          })
        );
      }
      // 舊格式 JSON
      try { return JSON.parse(pkStr); } catch { return {}; }
    };

    // jobId → schema alias 對應表（由 runDashboardQuery 掛在 design._jobAliasMap）
    const jobAliasMap = design._jobAliasMap || {};

    // 收集每個 PK 欄位的所有值，key = "alias.COL" 或 "COL"
    const pkGroups = {}; // { 'ps.INVENTORY_ITEM_ID': Set(['12345']), ... }
    vectorResults.forEach(r => {
      const pkObj = parsePk(r.source_pk);
      const alias = r.etl_job_id ? jobAliasMap[r.etl_job_id] : null;
      for (const [k, v] of Object.entries(pkObj)) {
        const colUpper = k.toUpperCase();
        // 有 alias 就加前綴，確保多表 JOIN 時不模糊
        const key = alias ? `${alias}.${colUpper}` : colUpper;
        if (!pkGroups[key]) pkGroups[key] = new Set();
        if (v !== null && v !== undefined && v !== '') pkGroups[key].add(String(v));
      }
    });

    vectorContext = '\n## 語意搜尋結果（請用以下條件過濾主表，不要自己猜測 WHERE 條件）：\n';

    // 輸出 IN 條件（帶 alias 前綴）
    for (const [col, vals] of Object.entries(pkGroups)) {
      const valList = [...vals].slice(0, 200); // 最多 200 個 PK
      const isNum = valList.every(v => /^-?\d+(\.\d+)?$/.test(v));
      const inVals = isNum ? valList.join(', ') : valList.map(v => `'${v}'`).join(', ');
      vectorContext += `**${col} IN (${inVals})**\n`;
    }

    vectorContext += '\n相似資料明細：\n';
    vectorResults.slice(0, 10).forEach((r, i) => {
      vectorContext += `${i + 1}. ${r.field_value}`;
      if (r.metadata) {
        try {
          const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
          const metaStr = Object.entries(meta).map(([k,v]) => `${k}=${v}`).join(', ');
          if (metaStr) vectorContext += ` (${metaStr})`;
        } catch {}
      }
      vectorContext += ` [相似度 ${(1 - r.score).toFixed(3)}]\n`;
    });

    vectorContext += '\n**重要：SQL 的 WHERE 子句必須包含上方的 IN 條件作為主表過濾依據。**\n';
  }

  // Few-shot 範例
  let fewShotContext = '';
  let fewShots = [];
  try {
    if (design.few_shot_examples) {
      let parsed = typeof design.few_shot_examples === 'string'
        ? JSON.parse(design.few_shot_examples) : design.few_shot_examples;
      // 防止 double-encode（parsed 仍是字串）
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      if (Array.isArray(parsed)) fewShots = parsed;
    }
  } catch (_) { /* 格式錯誤就略過 */ }
  if (fewShots.length) {
    fewShotContext = '\n## 範例問答：\n';
    fewShots.forEach(ex => {
      fewShotContext += `問：${ex.q}\nSQL：${ex.sql}\n\n`;
    });
  }

  const systemPrompt = design.system_prompt || `你是一個 Oracle ERP 資料庫查詢助手。
根據提供的資料表 schema 和使用者問題，生成正確的 Oracle SQL SELECT 語句。
規則：
1. 只能生成 SELECT 語句，不允許 INSERT/UPDATE/DELETE/DDL
2. 使用 Oracle SQL 語法（ROWNUM、FETCH FIRST 等）
3. 日期格式使用 TO_DATE / TO_CHAR
4. 回傳格式：只輸出 SQL，不加任何說明文字
5. 欄位名稱用中文別名（AS）方便閱讀
6. 欄位引用須使用提供的資料表別名（alias.欄位名）
7. 若 Prompt 中有「語意搜尋結果」區塊，必須將其 IN 條件加入 WHERE 子句`;

  const fromHint = fromClause
    ? `\n## 建議使用的 FROM 子句（請直接使用，勿更改別名）：\n\`\`\`sql\n${fromClause}\`\`\`\n`
    : '';

  // 收集所有 schema 的固定 WHERE 條件
  const allBaseWhere = [];
  for (const sid of schemaIds) {
    const s = schemaMap[sid];
    if (!s || !s.base_conditions) continue;
    try {
      const bc = typeof s.base_conditions === 'string' ? JSON.parse(s.base_conditions) : s.base_conditions;
      if (Array.isArray(bc)) {
        for (const c of bc) {
          const noRight = ['IS NULL', 'IS NOT NULL'].includes(c.op);
          allBaseWhere.push(`${c.col} ${c.op}${noRight ? '' : ' ' + c.val}`);
        }
      }
    } catch (_) {}
  }
  const whereHint = allBaseWhere.length
    ? `\n## 必須加入的 WHERE 條件（每次都要包含）：\n\`\`\`sql\nWHERE ${allBaseWhere.join('\n  AND ')}\n\`\`\`\n`
    : '';

  return `${systemPrompt}

${schemaContext}
${fromHint}
${whereHint}
${vectorContext}
${fewShotContext}
## 使用者問題：
${question}

請生成對應的 Oracle SQL SELECT 語句：`;
}

// ─── 主查詢 Pipeline ──────────────────────────────────────────────────────────
async function runDashboardQuery({ designId, question, userId, isDesigner, send, vectorTopK, vectorSimilarityThreshold, modelKey }) {
  const db = require('../database-oracle').db;

  // 解析 LLM model（從 llm_models 表查，fallback 到 env）
  let sqlApiModel = process.env.GEMINI_MODEL_PRO || 'gemini-3-pro-preview';
  let sqlModelKey = 'pro';
  try {
    if (modelKey) {
      const mRow = await db.prepare(`SELECT api_model FROM llm_models WHERE key=? AND is_active=1`).get(modelKey);
      if (mRow?.api_model) { sqlApiModel = mRow.api_model; sqlModelKey = modelKey; }
    } else {
      const mRow = await db.prepare(`SELECT key, api_model FROM llm_models WHERE is_active=1 ORDER BY sort_order ASC FETCH FIRST 1 ROWS ONLY`).get();
      if (mRow) { sqlApiModel = mRow.api_model; sqlModelKey = mRow.key; }
    }
  } catch (_) {}

  // 取得 design
  const design = await db.prepare(`SELECT * FROM ai_select_designs WHERE id=?`).get(designId);
  if (!design) throw new Error('查詢設計不存在');

  // 2. 向量語意搜尋
  let vectorResults = [];
  if (design.vector_search_enabled) {
    try {
      send('status', { message: '語意搜尋中...' });
      const dims = parseInt(process.env.DASHBOARD_EMBEDDING_DIMS || DEFAULT_DIMS);
      // 若問句含中文，先翻成英文再 embed（提升跨語言對齊品質）
      const embeddingQuery = await translateQueryForEmbedding(question);
      const queryVec = await getEmbedding(embeddingQuery, dims);
      // 從設計的 target_schemas 找出各 schema 綁定的 ETL Job
      // 同時建立 jobId → schemaAlias 對應表，供 buildPrompt 加 alias 前綴
      const schemaIds = design.target_schema_ids ? JSON.parse(design.target_schema_ids) : [];
      const jobIds = [];
      design._jobAliasMap = {}; // { jobId: 'ps' }
      for (const sid of schemaIds) {
        const s = await db.prepare(
          `SELECT vector_etl_job_id, alias, table_name FROM ai_schema_definitions WHERE id=?`
        ).get(sid);
        if (s?.vector_etl_job_id) {
          jobIds.push(s.vector_etl_job_id);
          const alias = s.alias || s.table_name.split('.').pop().toLowerCase().replace(/[^a-z0-9_]/g, '_');
          design._jobAliasMap[s.vector_etl_job_id] = alias;
        }
      }
      // 依設計配置的 vector_skip_fields 判斷是否跳過向量搜尋
      const { skip: skipVector, reason: skipReason } = await shouldSkipVector(db, design, question);
      if (skipVector) console.log(`[Dashboard] Skip vector search: ${skipReason}`);

      if (jobIds.length && !skipVector) {
        const topK = vectorTopK ?? design.vector_top_k ?? VECTOR_TOP_K;
        const threshold = vectorSimilarityThreshold ?? design.vector_similarity_threshold ?? null;
        vectorResults = await vectorSearch(db, jobIds, queryVec, topK, threshold);
      }
      if (skipVector) design._skipReason = skipReason;  // 傳給 buildPrompt
      if (isDesigner) send('vector_results', { results: vectorResults });
    } catch (e) {
      console.warn('[Dashboard] Vector search error:', e.message);
    }
  }

  // 3. 組裝 Prompt + 4. Gemini 生成 SQL
  send('status', { message: 'AI 生成 SQL 中...' });
  const prompt = await buildPrompt(db, design, question, vectorResults, design._skipReason);
  const sqlModel = genAI.getGenerativeModel({ model: sqlApiModel });
  const genResult = await sqlModel.generateContent(prompt);
  let generatedSql = genResult.response.text().trim();

  // 清除可能的 markdown code block 包裹（含多行 / 任意 fence 格式）
  generatedSql = generatedSql
    .replace(/^```[\w]*\r?\n?/im, '')   // 開頭 ```sql 或 ```
    .replace(/\r?\n?```\s*$/im, '')     // 結尾 ```
    .trim()
    .replace(/;+\s*$/, '')             // Oracle OCI 不接受結尾分號
    .trim();

  // 5. SQL 安全審查
  const safeSql = validateSql(generatedSql);

  if (isDesigner) {
    const usage = genResult.response.usageMetadata;
    send('sql_preview', {
      sql: safeSql,
      cached: false,
      prompt_tokens: usage?.promptTokenCount,
      output_tokens: usage?.candidatesTokenCount,
    });
  }

  // 6. 執行 Oracle ERP 查詢
  send('status', { message: 'ERP 查詢中...' });
  const erpPool = await getErpPool();
  const erpConn = await erpPool.getConnection();
  let rows = [];
  let columns = [];
  const startTime = Date.now();
  try {
    const result = await erpConn.execute(
      safeSql, [],
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        maxRows: MAX_ROWS,
        fetchArraySize: 100,
        queryTimeout: SQL_TIMEOUT_SEC,
      }
    );
    rows = (result.rows || []).map(r =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k.toLowerCase(),
          v instanceof Date ? v.toISOString() : v,
        ])
      )
    );
    columns = (result.metaData || []).map(m => m.name.toLowerCase());
  } finally {
    await erpConn.close();
  }
  const durationMs = Date.now() - startTime;
  if (isDesigner) send('query_meta', { duration_ms: durationMs, row_count: rows.length });

  // 7. 寫快取 + 推送結果
  const chartConfig = design.chart_config
    ? (typeof design.chart_config === 'string'
       ? JSON.parse(design.chart_config)
       : design.chart_config)
    : null;

  // 8. 從 schema 定義建立欄位中文標籤對照表 { col_lower: description }
  const columnLabels = {};
  try {
    const schemaIds = design.target_schema_ids ? JSON.parse(design.target_schema_ids) : [];
    for (const sid of schemaIds) {
      const cols = await db.prepare(`SELECT column_name, description FROM ai_schema_columns WHERE schema_id=?`).all(sid);
      for (const col of cols) {
        if (col.description) columnLabels[col.column_name.toLowerCase()] = col.description;
      }
    }
  } catch (_) {}

  send('result', { rows, columns, column_labels: columnLabels, row_count: rows.length, chart_config: chartConfig });

  // 9. Token 計費（SQL 生成 + embedding translation 用量）
  try {
    const { upsertTokenUsage } = require('./tokenService');
    const today = new Date().toISOString().slice(0, 10);
    const sqlUsage = genResult.response.usageMetadata;
    const sqlIn  = sqlUsage?.promptTokenCount     || 0;
    const sqlOut = sqlUsage?.candidatesTokenCount || 0;
    if (sqlIn || sqlOut) {
      await upsertTokenUsage(db, userId, today, sqlModelKey, sqlIn, sqlOut, 0);
    }
  } catch (e) {
    console.warn('[Dashboard] token usage upsert error:', e.message);
  }
}

// ─── ETL Job 取消集合 ──────────────────────────────────────────────────────────
const cancelledJobs = new Set();

function cancelEtlJob(jobId) {
  cancelledJobs.add(Number(jobId));
}

// ─── ETL Job 執行 ─────────────────────────────────────────────────────────────
async function runEtlJob(jobId) {
  const db = require('../database-oracle').db;
  const job = await db.prepare(`SELECT * FROM ai_etl_jobs WHERE id=?`).get(jobId);
  if (!job) throw new Error(`ETL Job ${jobId} 不存在`);

  const logResult = await db.prepare(
    `INSERT INTO ai_etl_run_logs (job_id, started_at, status) VALUES (?, SYSTIMESTAMP, 'running')`
  ).run(jobId);
  const logId = logResult.lastInsertRowid;

  let rowsFetched = 0, rowsVectorized = 0, rowsInserted = 0, rowsUpdated = 0, deletedCount = 0;
  let totalEmbedTokens = 0;
  const errors = [];
  const jobType = job.job_type || 'vector';

  // 便利函數：更新階段狀態文字
  const setStatus = (msg) => db.prepare(
    `UPDATE ai_etl_run_logs SET status_message=? WHERE id=?`
  ).run(msg, logId).catch(() => {});

  try {
    // ── 1. 取得 ERP 來源資料 ───────────────────────────────────────────────────
    const erpPool = await getErpPool();
    const erpConn = await erpPool.getConnection();
    let sourceRows = [];
    try {
      const sql = validateSql(job.source_sql);
      // 只在 SQL 中確實有 :last_run 參數時才傳入（避免 ORA-01036）
      const hasLastRun = /:last_run\b/i.test(sql);
      const lastRun = hasLastRun
        ? (job.last_run_at ? new Date(job.last_run_at) : new Date(0))
        : undefined;
      const result = await erpConn.execute(
        sql,
        hasLastRun ? { last_run: lastRun } : {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows: ETL_MAX_ROWS }
      );
      sourceRows = (result.rows || []).map(r =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [k.toLowerCase(), v instanceof Date ? v.toISOString() : v])
        )
      );
      rowsFetched = sourceRows.length;
    } finally {
      await erpConn.close();
    }

    // 撈取完成後立即更新 rows_fetched，讓前端進度條知道總數
    await db.prepare(
      `UPDATE ai_etl_run_logs SET rows_fetched=? WHERE id=?`
    ).run(rowsFetched, logId);

    // ── 2a. 向量化 ETL（批次模式）────────────────────────────────────────────────
    if (jobType === 'vector') {
      const vectorizeFields = job.vectorize_fields
        ? (typeof job.vectorize_fields === 'string' ? JSON.parse(job.vectorize_fields) : job.vectorize_fields)
        : [];
      const metadataFields = job.metadata_fields
        ? (typeof job.metadata_fields === 'string' ? JSON.parse(job.metadata_fields) : job.metadata_fields)
        : [];
      const embeddingDim = job.embedding_dimension || DEFAULT_DIMS;
      const vfLower = vectorizeFields.map(f => f.toLowerCase());

      if (!job.is_incremental) {
        await setStatus('清除舊向量資料中...');
        const delResult = await db.prepare(`DELETE FROM ai_vector_store WHERE etl_job_id=?`).run(jobId);
        deletedCount += delResult.changes || 0;
        await db.prepare(`UPDATE ai_etl_run_logs SET rows_deleted=? WHERE id=?`).run(deletedCount, logId).catch(() => {});
        await setStatus(`已清除 ${deletedCount} 筆舊資料，開始重新向量化...`);
      }

      // PK 欄位：用 upsert_key 指定（逗號分隔），沒設就取前 3 個非向量欄位
      const pkFields = job.upsert_key
        ? job.upsert_key.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        : [];

      const buildSourcePk = (row) => {
        if (pkFields.length > 0) {
          return pkFields.map(k => `${k}=${row[k] ?? ''}`).join('|');
        }
        // fallback：前 3 個非向量欄位
        return JSON.stringify(
          Object.fromEntries(
            Object.entries(row).filter(([k]) => !vfLower.includes(k)).slice(0, 3)
          )
        );
      };

      // ── 刪除機制：執行 delete_sql，將符合條件的 PK 從向量庫刪除 ──────────────
      // 非增量模式已做 bulk DELETE，不需再跑 delete_sql（避免重複且緩慢的逐筆刪除）
      if (job.delete_sql && job.delete_sql.trim() && job.is_incremental) {
        const erpPool = await getErpPool();
        const delConn = await erpPool.getConnection();
        try {
          const delSql = validateSql(job.delete_sql);
          const delHasLastRun = /:last_run\b/i.test(delSql);
          const delLastRun = delHasLastRun
            ? (job.last_run_at ? new Date(job.last_run_at) : new Date(0))
            : undefined;
          const delResult = await delConn.execute(
            delSql,
            delHasLastRun ? { last_run: delLastRun } : {},
            { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows: ETL_MAX_ROWS }
          );
          const delRows = (delResult.rows || []).map(r =>
            Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v]))
          );
          // 用相同的 buildSourcePk 計算要刪的 PK（注意：此時 buildSourcePk 尚未宣告，先整理在後面）
          const deletePks = delRows.map(r => buildSourcePk(r));
          await setStatus(`delete_sql 刪除 ${deletePks.length} 筆向量中...`);
          // 批次刪除（每批 200 筆用 IN 子句，避免逐筆太慢）
          const DEL_BATCH = 200;
          for (let di = 0; di < deletePks.length; di += DEL_BATCH) {
            const batchPks = deletePks.slice(di, di + DEL_BATCH);
            const placeholders = batchPks.map(() => '?').join(',');
            const delR = await db.prepare(
              `DELETE FROM ai_vector_store WHERE etl_job_id=? AND source_pk IN (${placeholders})`
            ).run(jobId, ...batchPks);
            deletedCount += delR.changes || batchPks.length;
          }
          await db.prepare(`UPDATE ai_etl_run_logs SET rows_deleted=? WHERE id=?`).run(deletedCount, logId).catch(() => {});
          console.log(`[ETL] Job ${jobId} delete_sql: removed ${deletedCount} vectors`);
        } catch (e) {
          console.warn(`[ETL] Job ${jobId} delete_sql error:`, e.message);
          errors.push(`delete_sql: ${e.message}`);
        } finally {
          await delConn.close();
        }
      }

      // 增量模式：先撈已存在的 source_pk，跳過已處理的 row
      let existingPks = new Set();
      if (job.is_incremental) {
        const pool = require('../database-oracle').getPool();
        const conn = await pool.getConnection();
        try {
          const existing = await conn.execute(
            `SELECT source_pk FROM ai_vector_store WHERE etl_job_id = :b_job_id`,
            { b_job_id: jobId },
            { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows: ETL_MAX_ROWS }
          );
          existingPks = new Set((existing.rows || []).map(r => r.SOURCE_PK || r.source_pk));
        } finally {
          await conn.close();
        }
        console.log(`[ETL] Job ${jobId} incremental: ${existingPks.size} existing PKs loaded`);
      }

      // 先整理要 embed 的所有項目（跳過已存在的 PK）
      await setStatus('整理待向量化清單...');
      const embedItems = [];
      let skippedCount = 0;
      for (const row of sourceRows) {
        const sourcePk = buildSourcePk(row);
        if (job.is_incremental && existingPks.has(sourcePk)) {
          skippedCount++;
          continue;
        }
        for (const fieldName of vectorizeFields) {
          const fieldValue = row[fieldName.toLowerCase()];
          if (!fieldValue || typeof fieldValue !== 'string' || !fieldValue.trim()) continue;
          const metadata = {};
          for (const mf of metadataFields) metadata[mf] = row[mf.toLowerCase()];
          embedItems.push({ fieldName, fieldValue, metadata, sourcePk });
        }
      }
      if (skippedCount > 0) {
        console.log(`[ETL] Job ${jobId} skipped ${skippedCount} already-vectorized rows`);
      }

      const pool = require('../database-oracle').getPool();
      // 批次處理：每次 EMBED_BATCH_SIZE 筆送一次 Gemini API
      cancelledJobs.delete(Number(jobId)); // 清除舊的取消旗標
      for (let i = 0; i < embedItems.length; i += EMBED_BATCH_SIZE) {
        // 取消檢查
        if (cancelledJobs.has(Number(jobId))) {
          cancelledJobs.delete(Number(jobId));
          console.log(`[ETL] Job ${jobId} 被使用者取消，已停止於第 ${i} 筆`);
          await db.prepare(
            `UPDATE ai_etl_run_logs SET finished_at=SYSTIMESTAMP, status='cancelled',
             rows_fetched=?, rows_vectorized=?, error_message='使用者手動停止' WHERE id=?`
          ).run(rowsFetched, rowsVectorized, logId).catch(() => {});
          return;
        }
        const batch = embedItems.slice(i, i + EMBED_BATCH_SIZE);
        let embeddings;
        try {
          const batchResult = await getBatchEmbeddings(batch.map(it => it.fieldValue), embeddingDim);
          embeddings = batchResult.embeddings;
          totalEmbedTokens += batchResult.tokenCount;
        } catch (e) {
          // batch 失敗時逐筆 fallback
          console.warn(`[ETL] batch embed failed, falling back one-by-one: ${e.message}`);
          embeddings = [];
          for (const it of batch) {
            try {
              embeddings.push(await getEmbedding(it.fieldValue, embeddingDim));
              // fallback 估算：每筆約 text.length / 4 tokens
              totalEmbedTokens += Math.ceil(it.fieldValue.length / 4);
            }
            catch (e2) { embeddings.push(null); errors.push(`${it.fieldName}@embed: ${e2.message}`); }
          }
        }

        // 批次 INSERT
        for (let j = 0; j < batch.length; j++) {
          const emb = embeddings[j];
          if (!emb) continue;
          const it = batch[j];
          try {
            const safeEmbed = emb.map(v => {
              const n = Number(v);
              if (!isFinite(n)) throw new Error(`embedding 含非數值元素: ${v}`);
              return n;
            });
            const vecStr = `[${safeEmbed.join(',')}]`;
            const conn = await pool.getConnection();
            try {
              await conn.execute(
                `INSERT INTO ai_vector_store
                   (etl_job_id, source_table, source_pk, field_name, field_value, metadata, embedding)
                 VALUES (:b_job_id, :b_src_table, :b_pk, :b_field_name, :b_field_val, :b_metadata, TO_VECTOR(:b_embedding))`,
                {
                  b_job_id:     jobId,
                  b_src_table:  job.vector_table || 'AI_VECTOR_STORE',
                  b_pk:         it.sourcePk.slice(0, 500),
                  b_field_name: it.fieldName.toUpperCase(),
                  b_field_val:  it.fieldValue,
                  b_metadata:   JSON.stringify(it.metadata),
                  b_embedding:  vecStr,
                },
                { autoCommit: true }
              );
              rowsVectorized++;
            } finally {
              await conn.close();
            }
          } catch (e) {
            errors.push(`${it.fieldName}@insert: ${e.message}`);
          }
        }

        // 每批次更新一次進度
        await db.prepare(
          `UPDATE ai_etl_run_logs SET rows_vectorized=? WHERE id=?`
        ).run(rowsVectorized, logId).catch(() => {});
        console.log(`[ETL] Job ${jobId} batch ${Math.floor(i/EMBED_BATCH_SIZE)+1}: vectorized ${rowsVectorized}/${embedItems.length}`);
      }
    }

    // ── 2b. 資料搬運 ETL (table_copy) ─────────────────────────────────────────
    if (jobType === 'table_copy') {
      const targetTable = job.target_table;
      if (!targetTable) throw new Error('table_copy 模式需設定 target_table');
      const targetMode = job.target_mode || 'truncate_insert';
      const upsertKeys = job.upsert_key
        ? job.upsert_key.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        : [];

      const pool = require('../database-oracle').getPool();
      const conn = await pool.getConnection();
      try {
        if (targetMode === 'truncate_insert') {
          await conn.execute(`TRUNCATE TABLE ${targetTable}`, [], { autoCommit: true });
        }

        for (const row of sourceRows) {
          const cols = Object.keys(row);
          if (cols.length === 0) continue;
          try {
            if (targetMode === 'upsert' && upsertKeys.length > 0) {
              // MERGE INTO target USING DUAL ON (key conditions)
              const keyCond = upsertKeys.map(k => `t.${k.toUpperCase()} = :${k}`).join(' AND ');
              const updateCols = cols.filter(c => !upsertKeys.includes(c));
              const updateClause = updateCols.map(c => `t.${c.toUpperCase()} = :${c}`).join(', ');
              const insertCols = cols.map(c => c.toUpperCase()).join(', ');
              const insertVals = cols.map(c => `:${c}`).join(', ');
              const mergeSql = `MERGE INTO ${targetTable} t USING DUAL ON (${keyCond})
                WHEN MATCHED THEN UPDATE SET ${updateClause || '1=1'}
                WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})`;
              const bindObj = Object.fromEntries(cols.map(c => [c, row[c]]));
              const result = await conn.execute(mergeSql, bindObj, { autoCommit: true });
              // rowsAffected is for both insert+update in MERGE; approximate
              if ((result.rowsAffected || 0) > 0) rowsInserted++;
            } else {
              const colNames = cols.map(c => c.toUpperCase()).join(', ');
              const colBinds = cols.map(c => `:${c}`).join(', ');
              const bindObj = Object.fromEntries(cols.map(c => [c, row[c]]));
              await conn.execute(
                `INSERT INTO ${targetTable} (${colNames}) VALUES (${colBinds})`,
                bindObj,
                { autoCommit: true }
              );
              rowsInserted++;
            }
          } catch (e) {
            errors.push(`row insert error: ${e.message}`);
          }
        }
      } finally {
        await conn.close();
      }
    }

    // ── 3. 更新 job + log ──────────────────────────────────────────────────────
    await db.prepare(`UPDATE ai_etl_jobs SET last_run_at=SYSTIMESTAMP WHERE id=?`).run(jobId);
    await db.prepare(
      `UPDATE ai_etl_run_logs SET
         finished_at=SYSTIMESTAMP, rows_fetched=?, rows_vectorized=?,
         rows_inserted=?, rows_updated=?,
         status=?, error_message=?
       WHERE id=?`
    ).run(
      rowsFetched, rowsVectorized, rowsInserted, rowsUpdated,
      errors.length > 0 ? 'partial' : 'success',
      errors.length > 0 ? errors.slice(0, 10).join('\n') : (deletedCount > 0 ? `已刪除 ${deletedCount} 筆舊向量` : null),
      logId
    );

    // ── 4. Token 計費（向量化才有 embedding token）──────────────────────────────
    if (totalEmbedTokens > 0 && job.created_by) {
      const { upsertTokenUsage } = require('./tokenService');
      const today = new Date().toISOString().slice(0, 10);
      await upsertTokenUsage(db, job.created_by, today, EMBEDDING_MODEL, totalEmbedTokens, 0).catch(e2 =>
        console.warn('[ETL] token usage upsert error:', e2.message)
      );
      console.log(`[ETL] Job ${jobId} embed tokens=${totalEmbedTokens}, charged to user ${job.created_by}`);
    }

    console.log(`[ETL] Job ${jobId} (${jobType}) done: fetched=${rowsFetched} vectorized=${rowsVectorized} inserted=${rowsInserted}`);
  } catch (e) {
    console.error(`[ETL] Job ${jobId} failed:`, e.message);
    await db.prepare(
      `UPDATE ai_etl_run_logs SET finished_at=SYSTIMESTAMP, status='failed', error_message=? WHERE id=?`
    ).run(e.message, logId);
    throw e;
  }
}

// ─── Schedule helper: schedule_type + schedule_config → cron expression ───────
function scheduleToCron(scheduleType, scheduleConfig) {
  const cfg = (typeof scheduleConfig === 'string' ? JSON.parse(scheduleConfig || '{}') : scheduleConfig) || {};
  const h = cfg.hour ?? 2;
  const m = cfg.minute ?? 0;
  switch (scheduleType) {
    case 'hourly':  return `${m} */${Math.max(1, cfg.interval_hours || 1)} * * *`;
    case 'daily':   return `${m} ${h} * * *`;
    case 'weekly':  return `${m} ${h} * * ${(cfg.weekdays && cfg.weekdays.length ? cfg.weekdays : [1]).join(',')}`;
    case 'monthly': return `${m} ${h} ${cfg.monthday || 1} * *`;
    default:        return cfg.cron_expression || null;
  }
}
// ─── ETL Cron 排程 ───────────────────────────────────────────────────────────
const etlCronJobs = new Map(); // jobId → cron task

async function initEtlScheduler(db) {
  try {
    const jobs = await db.prepare(
      `SELECT id, cron_expression FROM ai_etl_jobs WHERE status='active' AND cron_expression IS NOT NULL`
    ).all();

    for (const job of jobs) {
      scheduleEtlJob(job.id, job.cron_expression);
    }
    console.log(`[ETL Scheduler] ${jobs.length} job(s) scheduled`);
  } catch (e) {
    console.warn('[ETL Scheduler] init error:', e.message);
  }
}

function scheduleEtlJob(jobId, cronExpr) {
  if (etlCronJobs.has(jobId)) {
    etlCronJobs.get(jobId).stop();
  }
  if (!cronExpr || !cron.validate(cronExpr)) {
    console.warn(`[ETL] Invalid cron for job ${jobId}: ${cronExpr}`);
    return;
  }
  const task = cron.schedule(cronExpr, () => {
    runEtlJob(jobId).catch(e => console.error(`[ETL] Scheduled job ${jobId} error:`, e.message));
  });
  etlCronJobs.set(jobId, task);
  console.log(`[ETL] Job ${jobId} scheduled: ${cronExpr}`);
}

module.exports = {
  runDashboardQuery,
  runEtlJob,
  cancelEtlJob,
  initEtlScheduler,
  scheduleEtlJob,
  scheduleToCron,
  getErpPool,       // 供 dashboard.js import-oracle 路由使用（同一保護層）
  assertErpReadOnly, // 供其他模組需要時直接呼叫
};
