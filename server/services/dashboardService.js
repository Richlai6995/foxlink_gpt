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
const { upsertTokenUsage } = require('./tokenService');

// ─── 常數 ─────────────────────────────────────────────────────────────────────
// EMBEDDING_MODEL is resolved at runtime to support DB-configured defaults.
// Use getEmbeddingModel(db) instead of this constant where db is available.
const EMBEDDING_MODEL = process.env.DASHBOARD_EMBEDDING_MODEL
  || process.env.KB_EMBEDDING_MODEL
  || 'gemini-embedding-001';

async function getEmbeddingModel(db) {
  try {
    return await require('./llmDefaults').resolveDefaultModel(db, 'embedding');
  } catch { return EMBEDDING_MODEL; }
}

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

// ─── Multi-source pool map（Phase 1: Oracle，Phase 2+: MySQL/MSSQL）──────────
// Map<sourceId, { proxy, initPromise }>
const _poolMap = new Map();

/**
 * 依 ai_db_sources.id 取得對應的 ReadOnly pool proxy。
 * 若來源未設定（sourceId 為 null/undefined），回退到預設 ERP pool。
 */
async function getPoolBySourceId(sourceId, db) {
  if (!sourceId) return getErpPool();

  const id = Number(sourceId);
  const cached = _poolMap.get(id);
  if (cached?.proxy) return cached.proxy;

  if (!_poolMap.has(id)) _poolMap.set(id, { proxy: null, initPromise: null });
  const entry = _poolMap.get(id);

  if (!entry.initPromise) {
    entry.initPromise = (async () => {
      const src = await db.prepare(`SELECT * FROM ai_db_sources WHERE id=? AND is_active=1`).get(id);
      if (!src) throw new Error(`DB Source ${id} 不存在或已停用`);

      const dbType  = src.db_type  || src.DB_TYPE  || 'oracle';
      const { getAdapter } = require('./dbAdapters');
      const adapter = getAdapter(dbType);

      const { decryptPassword } = require('../utils/dbCrypto');
      const password = decryptPassword(src.password_enc || src.PASSWORD_ENC);

      const config = {
        host:          src.host         || src.HOST,
        port:     Number(src.port       || src.PORT       || (dbType === 'oracle' ? 1521 : dbType === 'mysql' ? 3306 : 1433)),
        service_name:  src.service_name || src.SERVICE_NAME,
        database_name: src.database_name || src.DATABASE_NAME,
        username:      src.username     || src.USERNAME,
        password,
        pool_min:  Number(src.pool_min  || src.POOL_MIN  || 1),
        pool_max:  Number(src.pool_max  || src.POOL_MAX  || 5),
        pool_timeout: Number(src.pool_timeout || src.POOL_TIMEOUT || 60),
      };

      entry.proxy = await adapter.createPool(config);
      console.log(`[DB Source] Pool ready: id=${id} name=${src.name || src.NAME} type=${dbType}`);
    })();
  }

  await entry.initPromise;
  return entry.proxy;
}

/**
 * 清除指定來源的 pool 快取（編輯或刪除來源後呼叫）
 */
function invalidatePoolCache(sourceId) {
  const id = Number(sourceId);
  const entry = _poolMap.get(id);
  if (entry?.proxy) {
    try { entry.proxy.close(); } catch (_) {}
  }
  _poolMap.delete(id);
  console.log(`[DB Source] Pool cache invalidated: id=${id}`);
}

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
        // 確保每個 ERP session NLS 一致
        sessionCallback: async (conn, _requestedTag, callbackFn) => {
          try {
            await conn.execute(`ALTER SESSION SET NLS_LANGUAGE='AMERICAN' NLS_TERRITORY='AMERICA'`);
          } catch (e) { /* ignore */ }
          callbackFn();
        },
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
async function getEmbedding(text, dims = DEFAULT_DIMS, modelOverride = null) {
  const model = genAI.getGenerativeModel({ model: modelOverride || EMBEDDING_MODEL });
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
async function getBatchEmbeddings(texts, dims = DEFAULT_DIMS, modelOverride = null) {
  const model = genAI.getGenerativeModel({ model: modelOverride || EMBEDDING_MODEL });
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

// ─── 向量查詢翻譯（中文→英文，依各 job 的 trigger_intent 做 context-aware 翻譯）──
// triggerIntent: ETL Job 的 trigger_intent 欄位，描述此向量庫存放的是什麼資料
async function translateQueryForEmbedding(question, triggerIntent) {
  if (!/[\u4e00-\u9fff]/.test(question)) return { query: question, inputTokens: 0, outputTokens: 0 };
  const flashModel = process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash';
  const context = triggerIntent
    ? `This vector store contains: ${triggerIntent}`
    : 'product/item description data';
  try {
    const model = genAI.getGenerativeModel({ model: flashModel });
    const result = await model.generateContent(
      `Extract semantic search keywords from the following query relevant to: ${context}\n` +
      `Return ONLY English keywords for semantic similarity search — no codes, dates, quantities, or field names.\n` +
      `Query: "${question}"\n` +
      `English keywords only:`
    );
    const translated = result.response.text().trim().replace(/^["']|["']$/g, '');
    const usage = result.response.usageMetadata || {};
    console.log(`[Dashboard] Embedding query translation: "${question}" → "${translated}"`);
    return {
      query: translated || question,
      inputTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0,
      model: flashModel,
    };
  } catch (e) {
    console.warn('[Dashboard] Query translation failed, using original:', e.message);
    return { query: question, inputTokens: 0, outputTokens: 0, model: flashModel };
  }
}

// ─── 批次判斷哪些 ETL Job 的向量搜尋應觸發（一次 Gemini 呼叫）──────────────────
// jobs: [{ id, name, triggerIntent }]
// 回傳應觸發的 job id Set
// 若某 job 沒有設定 triggerIntent → 預設觸發（向下相容）
async function checkVectorTriggers(question, jobs) {
  const withIntent = jobs.filter(j => j.triggerIntent);
  const alwaysRun  = jobs.filter(j => !j.triggerIntent).map(j => j.id);

  if (withIntent.length === 0) return new Set(alwaysRun);

  const flashModel = process.env.GEMINI_MODEL_FLASH || 'gemini-2.0-flash';
  try {
    const model = genAI.getGenerativeModel({ model: flashModel });
    const lines = withIntent.map((j, i) => `${i + 1}. [${j.name}]: ${j.triggerIntent}`).join('\n');
    const result = await model.generateContent(
      `Given this user query, determine which semantic vector searches are necessary.\n` +
      `Answer YES only if the query explicitly needs to look up data described by that store.\n` +
      `Answer NO if the query merely mentions a field name (e.g. "料號") without needing semantic description lookup.\n\n` +
      `Query: "${question}"\n\n` +
      `Vector stores:\n${lines}\n\n` +
      `Reply with one line per store, format: "1: YES" or "1: NO". Nothing else.`
    );
    const text = result.response.text().trim();
    const triggered = new Set(alwaysRun);
    for (const line of text.split('\n')) {
      const m = line.match(/^(\d+):\s*(YES|NO)/i);
      if (m && m[2].toUpperCase() === 'YES') {
        triggered.add(withIntent[parseInt(m[1]) - 1]?.id);
      }
    }
    console.log(`[Dashboard] Vector trigger check: "${text.replace(/\n/g, ' ')}" → triggered: [${[...triggered].join(',')}]`);
    return triggered;
  } catch (e) {
    console.warn('[Dashboard] Vector trigger check failed, running all:', e.message);
    return new Set(jobs.map(j => j.id));
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
async function buildPrompt(db, design, question, vectorResults, skipReason, lang) {
  // 取得 schema 定義
  const schemaIds = design.target_schema_ids ? JSON.parse(design.target_schema_ids) : [];
  // 僅 WHERE 表：不可出現在 FROM/JOIN，只能在 WHERE EXISTS 子查詢
  const whereOnlyIds = new Set(
    (design.schema_where_only_ids ? JSON.parse(design.schema_where_only_ids) : []).map(Number)
  );
  const schemaMap = {}; // id -> schema record with alias
  let schemaContext = '';

  for (const sid of schemaIds) {
    const s = await db.prepare(`SELECT * FROM ai_schema_definitions WHERE id=?`).get(sid);
    if (!s) continue;
    const cols = await db.prepare(`SELECT * FROM ai_schema_columns WHERE schema_id=?`).all(sid);
    const alias = s.alias || s.table_name.split('.').pop().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    schemaMap[sid] = { ...s, resolvedAlias: alias };

    const isWhereOnly = whereOnlyIds.has(Number(sid));
    schemaContext += `\n## 資料表：${s.table_name}（${s.display_name || ''}）別名：${alias}${isWhereOnly ? '【⚠️ 僅WHERE子查詢，禁止出現在FROM/JOIN】' : ''}\n`;
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
        if (whereOnlyIds.has(Number(j.right_schema_id))) continue; // 僅WHERE表跳過 JOIN
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
              if (c.op === 'NULL_EQ') return `DECODE(${c.left}, ${c.right}, 1, 0) = 1`;
              if (c.op === 'BETWEEN') return `${c.left} BETWEEN ${c.right} AND ${c.right2 || c.right}`;
              if (c.op === 'IN' || c.op === 'NOT IN') return `${c.left} ${c.op} (${c.right})`;
              return `${c.left} ${c.op || '='} ${c.right}`;
            }).join('\n  AND ')
          : '/* 請補充 JOIN 條件 */';

        fromClause += `${j.join_type || 'LEFT'} JOIN ${rightSource} ${rightSchema.resolvedAlias} ON ${onClause}\n`;
      }
    }
  }

  // 僅WHERE表的使用提示
  let whereOnlyHint = '';
  if (whereOnlyIds.size > 0) {
    const whereOnlySchemas = [];
    for (const sid of whereOnlyIds) {
      const s = schemaMap[sid];
      if (!s) continue;
      // 找出此表相關的 join 條件（用於 WHERE EXISTS ON 子句參考）
      const relatedJoins = [];
      for (const jid of joinIds) {
        const j = await db.prepare(`SELECT * FROM ai_schema_joins WHERE id=?`).get(jid);
        if (!j || Number(j.right_schema_id) !== Number(sid)) continue;
        let conditions = [];
        try { conditions = typeof j.conditions_json === 'string' ? JSON.parse(j.conditions_json) : (j.conditions_json || []); } catch (_) {}
        const onClause = conditions.length
          ? conditions.map(c => {
              if (['IS NULL', 'IS NOT NULL'].includes(c.op)) return `${c.left} ${c.op}`;
              return `${c.left} ${c.op || '='} ${c.right}`;
            }).join(' AND ')
          : '/* 請補充關聯條件 */';
        relatedJoins.push(`  -- 與 ${schemaMap[j.left_schema_id]?.resolvedAlias || '主表'} 的關聯條件: ${onClause}`);
      }
      whereOnlySchemas.push({ s, relatedJoins });
    }

    if (whereOnlySchemas.length > 0) {
      whereOnlyHint = `\n## ⚠️ 僅WHERE子查詢限制表（重要規則）\n`;
      whereOnlyHint += `以下資料表**絕對不可**出現在 FROM 或 JOIN 子句中（會造成資料列乘積爆炸）。\n`;
      whereOnlyHint += `- 若需要用來篩選資料（如資料政策），請使用 \`WHERE EXISTS (SELECT 1 FROM 表名 別名 WHERE 關聯條件 AND 篩選條件)\`\n`;
      whereOnlyHint += `- 若不需要篩選，則**完全省略**此表，不加任何 JOIN 或 EXISTS\n\n`;
      for (const { s, relatedJoins } of whereOnlySchemas) {
        whereOnlyHint += `### ${s.table_name}（別名：${s.resolvedAlias}）\n`;
        if (relatedJoins.length) {
          whereOnlyHint += `關聯條件參考（僅用於 EXISTS 內部）：\n\`\`\`sql\n${relatedJoins.join('\n')}\n\`\`\`\n`;
        }
        whereOnlyHint += `正確用法範例：\n\`\`\`sql\nAND EXISTS (SELECT 1 FROM ${s.table_name} ${s.resolvedAlias} WHERE <關聯條件> AND <篩選條件>)\n\`\`\`\n`;
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

  const l = (lang || '').toLowerCase();
  const aliasRule = l.startsWith('en')
    ? '5. Use English column aliases (AS) for readability — use the English descriptions from the schema if available'
    : l.startsWith('vi')
      ? '5. Dùng bí danh cột tiếng Việt (AS) cho dễ đọc — dùng mô tả tiếng Việt trong schema nếu có'
      : '5. 欄位名稱用中文別名（AS）方便閱讀 — 優先使用 schema 中的欄位中文說明';
  const designMaxRows = parseInt(design.max_rows || design.MAX_ROWS || 0) || 1000;
  const systemPrompt = design.system_prompt || `你是一個 Oracle ERP 資料庫查詢助手。
根據提供的資料表 schema 和使用者問題，生成正確的 Oracle SQL SELECT 語句。
規則：
1. 只能生成 SELECT 語句，不允許 INSERT/UPDATE/DELETE/DDL
2. 使用 Oracle SQL 語法（ROWNUM、FETCH FIRST 等）
3. 日期格式使用 TO_DATE / TO_CHAR
4. 回傳格式：只輸出 SQL，不加任何說明文字
${aliasRule}
6. 欄位引用須使用提供的資料表別名（alias.欄位名）
7. 若 Prompt 中有「語意搜尋結果」區塊，必須將其 IN 條件加入 WHERE 子句
8. 必須加上筆數限制：SELECT * FROM (...) WHERE ROWNUM <= ${designMaxRows}`;

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

  // 資料權限 WHERE 注入
  const { dataPermWhere } = design._dataPermissionWhere || {};
  const dataPermHint = dataPermWhere?.length
    ? `\n## 資料權限必須加入的 WHERE 條件（使用者資料範圍限制，每次都要包含）：\n\`\`\`sql\n${dataPermWhere.join('\n  AND ')}\n\`\`\`\n`
    : '';

  // 強制 alias 語言指令（附加在 prompt 末尾，覆蓋任何自訂 system_prompt 的 alias 規則）
  const aliasInstruction = l.startsWith('en')
    ? '\n[MANDATORY: Column aliases (AS) MUST be in English. Use the English description from the schema as the alias. Do NOT use Chinese aliases.]'
    : l.startsWith('vi')
      ? '\n[BẮTBUỘC: Bí danh cột (AS) phải bằng tiếng Việt. Sử dụng mô tả tiếng Việt từ schema làm bí danh. Không dùng bí danh tiếng Trung.]'
      : '';

  return `${systemPrompt}

${schemaContext}
${fromHint}
${whereOnlyHint}
${whereHint}
${dataPermHint}
${vectorContext}
${fewShotContext}
## 使用者問題：
${question}
${aliasInstruction}
請生成對應的 Oracle SQL SELECT 語句：`;
}

// ─── 主查詢 Pipeline ──────────────────────────────────────────────────────────
async function runDashboardQuery({ designId, question, userId, user, isDesigner, overrideSql, send, vectorTopK, vectorSimilarityThreshold, modelKey, effectivePolicy, lang }) {
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

  // 重新從 DB 取最新使用者資料（session 可能快取舊的組織欄位）
  const freshUser = await db.prepare(`SELECT * FROM users WHERE id=?`).get(userId);
  if (freshUser) user = { ...user, ...freshUser };

  // 取得 design
  const design = await db.prepare(`SELECT * FROM ai_select_designs WHERE id=?`).get(designId);
  if (!design) throw new Error('查詢設計不存在');
  const designMaxRows = parseInt(design.max_rows || design.MAX_ROWS || 1000);

  // 1.5 資料權限 WHERE 計算（注入到 prompt）
  if (effectivePolicy?.rules?.length > 0) {
    design._dataPermissionWhere = await buildDataPermWhere(db, design, user, effectivePolicy.rules);
  }

  // 1.6 Oracle MultiOrg 權限範圍通知 + 違規硬拒
  if (effectivePolicy?.rules?.length > 0) {
    const {
      MULTIORG_VALUE_TYPES, loadOrgHierarchy, loadAutoOrgIds, resolveUserScope,
      checkViolations, buildScopePayload,
    } = require('./multiOrgService');

    const hasMultiOrgRules = effectivePolicy.rules.some(r => MULTIORG_VALUE_TYPES.has(r.value_type));
    if (hasMultiOrgRules) {
      let hierarchy, scope;
      try {
        hierarchy = await loadOrgHierarchy(getErpPool);

        // 若有 auto_from_employee 規則，先從 FL_ORG_EMP_DEPT_MV 推導員工對應的 ORGANIZATION_IDs
        let autoOrgIds = new Set();
        const hasAutoRule = effectivePolicy.rules.some(r => r.value_type === 'auto_from_employee');
        if (hasAutoRule) {
          const { loadDeptHierarchy } = require('./orgHierarchyService');
          const deptHierarchy = await loadDeptHierarchy(getErpPool);
          autoOrgIds = loadAutoOrgIds(user, deptHierarchy);
          console.log(`[MultiOrg] auto_from_employee: derived ${autoOrgIds.size} ORGANIZATION_IDs`);
        }

        scope = resolveUserScope(effectivePolicy.rules, hierarchy, autoOrgIds);
      } catch (e) {
        // ERP DB 無法連線 → 無法驗證 → 阻擋查詢（方案 B）
        console.error('[MultiOrg] 無法載入 hierarchy，阻擋查詢:', e.message);
        send('error', {
          error: '⛔ 無法驗證資料權限（ERP 資料庫連線異常），請稍後再試。',
          multiorg_unavailable: true,
        });
        return;
      }

      // 每次都推送使用者的權限範圍（透明度）
      send('multiorg_scope', buildScopePayload(scope));

      // 員工組織資料未設定 → 拒絕查詢
      if (scope.denied) {
        send('error', { error: scope.deniedReason });
        return;
      }

      // ── 從 schema filter_key 找出此設計的 MultiOrg 過濾欄位，依層級注入 IN 條件 ──
      // 設計者在 ood schema 欄位標記：
      //   filter_source='organization_id' → INV/WIP/BOM → scope.orgDetails (org IDs)
      //   filter_source='operating_unit'  → AP/AR/PO/OM → scope.allowedOUIds
      //   filter_source='set_of_books_id' → GL           → scope.allowedSOBIds
      if (scope.hasRules && !scope.superUser) {
        const schemaIds = design.target_schema_ids ? JSON.parse(design.target_schema_ids) : [];
        // 取出所有 MultiOrg filter key 欄位（可能有多個，例如同時標 org + OU）
        const multiorgFilterKeys = [];
        for (const sid of schemaIds) {
          const cols = await db.prepare(
            `SELECT c.column_name, c.filter_source, sd.alias, sd.table_name
             FROM ai_schema_columns c
             JOIN ai_schema_definitions sd ON sd.id = c.schema_id
             WHERE c.schema_id=?
               AND c.is_filter_key=1
               AND c.filter_source IN ('organization_id','operating_unit','set_of_books_id')`
          ).all(sid);
          for (const col of cols) {
            const tblAlias = col.alias || col.table_name.split('.').pop().toLowerCase();
            multiorgFilterKeys.push({
              colRef: `${tblAlias}.${col.column_name}`,
              filterSource: col.filter_source,
            });
          }
        }

        if (multiorgFilterKeys.length === 0) {
          console.warn('[MultiOrg] 無 MultiOrg filter key 欄位設定，請在 ood schema 標記過濾欄位');
        }

        const existingWhere = design._dataPermissionWhere?.dataPermWhere || [];
        const newConditions = [];
        let hasAnyAccess = false;

        for (const fk of multiorgFilterKeys) {
          let allowedIds = [];
          if (fk.filterSource === 'organization_id') {
            allowedIds = (scope.orgDetails || []).map(o => o.id).filter(Boolean);
          } else if (fk.filterSource === 'operating_unit') {
            allowedIds = [...(scope.allowedOUIds || [])];
          } else if (fk.filterSource === 'set_of_books_id') {
            allowedIds = [...(scope.allowedSOBIds || [])];
          }

          if (allowedIds.length) {
            newConditions.push(`${fk.colRef} IN (${allowedIds.join(', ')})`);
            hasAnyAccess = true;
            console.log(`[MultiOrg] Injected WHERE: ${fk.colRef} IN (${allowedIds.length} items)`);
          } else {
            // 此層級無允許值 → 強制無結果（安全卡控）
            newConditions.push(`1=0 /* MultiOrg: no access at ${fk.filterSource} level */`);
            console.log(`[MultiOrg] No access at ${fk.filterSource} level → 1=0`);
          }
        }

        if (multiorgFilterKeys.length > 0) {
          design._dataPermissionWhere = {
            dataPermWhere: [...existingWhere, ...newConditions],
          };
          if (!hasAnyAccess) {
            send('error', {
              error: '⛔ 您目前的資料權限設定未涵蓋此查詢所需的組織/營運單位/帳套層級，無法執行查詢。\n請聯繫管理員確認資料權限設定。',
              multiorg_empty_scope: true,
            });
            return;
          }
        }
      }

      // 偵測 prompt 中超出範圍的 terms → 硬拒
      const violations = checkViolations(question, scope, hierarchy);
      if (violations.length > 0) {
        const allowedDesc = scope.orgDetails.length
          ? `您可查詢的組織：${scope.orgDetails.map(o => `${o.code}(${o.name})`).slice(0, 10).join('、')}` +
            (scope.orgDetails.length > 10 ? `⋯等 ${scope.orgDetails.length} 個` : '')
          : '（無可查詢組織）';
        send('error', {
          error: [
            '⛔ 資料權限不足，無法執行此查詢。',
            '',
            '問題中包含未授權的條件：',
            ...violations.map(v => `• ${v.term}${v.name ? `（${v.name}）` : ''} — ${v.reason}`),
            '',
            allowedDesc,
          ].join('\n'),
          multiorg_violations: violations,
        });
        return;
      }
    }
  }

  // 1.7 Layer 3 公司組織階層權限（FL_ORG_EMP_DEPT_MV）
  if (effectivePolicy?.rules?.length > 0) {
    const {
      ORG_HIERARCHY_VALUE_TYPES, loadDeptHierarchy,
      resolveUserDeptScope, buildOrgScopePayload,
    } = require('./orgHierarchyService');

    const hasOrgHierarchyRules = effectivePolicy.rules.some(r =>
      ORG_HIERARCHY_VALUE_TYPES.has(r.value_type || r.filter_source)
    );

    if (hasOrgHierarchyRules) {
      let deptHierarchy, deptScope;
      try {
        deptHierarchy = await loadDeptHierarchy(getErpPool);
        deptScope = resolveUserDeptScope(effectivePolicy.rules, user, deptHierarchy);
      } catch (e) {
        console.error('[OrgHierarchy] 無法載入 dept hierarchy，阻擋查詢:', e.message);
        send('error', {
          error: '⛔ 無法驗證組織資料權限（ERP 資料庫連線異常），請稍後再試。',
          org_hierarchy_unavailable: true,
        });
        return;
      }

      // 推送使用者的部門權限範圍
      send('org_scope', buildOrgScopePayload(deptScope));

      // 員工組織資料未設定 → 拒絕查詢
      if (deptScope.denied) {
        send('error', { error: deptScope.deniedReason });
        return;
      }

      // ── org_code 語意前置檢核 ─────────────────────────────────────────────
      // 當 schema 有 filter_source='org_code' 的 filter_key 欄位，
      // 且 allowedOrgCodes 已從組織階層展開（有限制），
      // 若問題中出現不在允許清單的 org_code（如 'Z4E'），直接拒絕。
      if (deptScope.hasRules && !deptScope.superUser && deptScope.allowedOrgCodes?.size > 0) {
        const schemaIds = design.target_schema_ids ? JSON.parse(design.target_schema_ids) : [];
        let hasOrgCodeFilterKey = false;
        for (const sid of schemaIds) {
          const col = await db.prepare(
            `SELECT 1 FROM ai_schema_columns
             WHERE schema_id=? AND filter_source='org_code' AND is_filter_key=1
             FETCH FIRST 1 ROWS ONLY`
          ).get(sid);
          if (col) { hasOrgCodeFilterKey = true; break; }
        }

        if (hasOrgCodeFilterKey) {
          // 從問題中萃取形如 org_code 的詞（2-4 字元，含大寫英數，有數字混合者優先）
          // 比純英文詞更像 org_code：至少含 1 個數字
          const IGNORE = new Set([
            'SELECT','FROM','WHERE','AND','OR','NOT','IN','IS','NULL','AS','BY',
            'ORDER','GROUP','HAVING','JOIN','ON','LEFT','RIGHT','INNER','OUTER',
            'WITH','CASE','WHEN','THEN','ELSE','END','LIKE','BETWEEN','EXISTS',
            'DISTINCT','INTO','TOP','SET','UPDATE','INSERT','DELETE',
            'SQL','ERP','ORG','BOM','MRP','PO','SO','WO','API','URL','UTC',
            'CODE','DATA','NAME','DATE','TYPE','LIST','INFO','MODE','ITEM',
          ]);
          const qUpper = question.toUpperCase();
          // org_code 格式：2-4 字元，必須含至少 1 個數字（Z4E, T1A, G08 等），避免 NAME/CODE 等純英字
          const detectedCodes = [...new Set(
            [...qUpper.matchAll(/\b[A-Z][A-Z0-9]{1,3}\b/g)].map(m => m[0])
          )].filter(c => !IGNORE.has(c) && /\d/.test(c));

          const forbiddenCodes = detectedCodes.filter(c => !deptScope.allowedOrgCodes.has(c));
          if (forbiddenCodes.length > 0) {
            const sample = [...deptScope.allowedOrgCodes].slice(0, 10).join('、');
            send('error', {
              error: [
                '⛔ 資料權限不足，無法執行此查詢。',
                '',
                `問題中包含未授權的組織代碼：${forbiddenCodes.join('、')}`,
                `您可查詢的組織代碼共 ${deptScope.allowedOrgCodes.size} 個，例如：${sample}${deptScope.allowedOrgCodes.size > 10 ? '⋯' : ''}`,
              ].join('\n'),
              org_code_violations: forbiddenCodes,
            });
            return;
          }
          console.log(`[OrgHierarchy] org_code semantic check: detected=${JSON.stringify(detectedCodes)}, all allowed`);
        }
      }

      // 注入 Layer 3 WHERE 條件
      // 優先順序：
      //   1. 找到 rule 所在層級的 filter_key 欄 → 直接 equality（最簡單，e.g. oed.ORG_GROUP_NAME='消費電子事業群'）
      //   2. 找到 filter_source='org_code' 的 filter_key → IN (allowedOrgCodes)
      //   3. 找到 filter_source='org_id' 的 filter_key → IN (allowedOrgIds)
      //   4. Fallback: filter_source='dept_code' → IN (allowedDeptCodes)，自動切成 <=999 的 OR 塊
      if (deptScope.hasRules && !deptScope.superUser && (deptScope.allowedOrgCodes.size > 0 || deptScope.allowedDeptCodes.size > 0)) {
        const schemaIds = design.target_schema_ids ? JSON.parse(design.target_schema_ids) : [];

        // 查 filter_key 輔助函式
        const findFilterKeyCol = async (filterSource) => {
          for (const sid of schemaIds) {
            const col = await db.prepare(
              `SELECT c.column_name, sd.alias, sd.table_name
               FROM ai_schema_columns c
               JOIN ai_schema_definitions sd ON sd.id = c.schema_id
               WHERE c.schema_id=? AND c.filter_source=? AND c.is_filter_key=1
               FETCH FIRST 1 ROWS ONLY`
            ).get(sid, filterSource);
            if (col) {
              const tblAlias = col.alias || col.table_name.split('.').pop().toLowerCase();
              return `${tblAlias}.${col.column_name}`;
            }
          }
          return null;
        };

        let whereClause = null;

        // 1. 最高層 include 規則的直接 equality（單一值，最乾淨）
        const highestLevel = deptScope.highestIncludeLevel;
        if (highestLevel && deptScope.userValues[highestLevel]) {
          const colRef = await findFilterKeyCol(highestLevel);
          if (colRef) {
            whereClause = `${colRef} = '${deptScope.userValues[highestLevel]}'`;
            console.log(`[OrgHierarchy] Injected WHERE (level equality): ${whereClause}`);
          }
        }

        // 2. org_code IN (list)
        if (!whereClause && deptScope.allowedOrgCodes.size > 0) {
          const colRef = await findFilterKeyCol('org_code');
          if (colRef) {
            const codes = [...deptScope.allowedOrgCodes];
            whereClause = buildInChunks(colRef, codes);
            console.log(`[OrgHierarchy] Injected WHERE (org_code): ${codes.length} org codes`);
          }
        }

        // 3. org_id IN (list)
        if (!whereClause && deptScope.allowedOrgIds.size > 0) {
          const colRef = await findFilterKeyCol('org_id');
          if (colRef) {
            const ids = [...deptScope.allowedOrgIds];
            whereClause = buildInChunks(colRef, ids, false);
            console.log(`[OrgHierarchy] Injected WHERE (org_id): ${ids.length} org ids`);
          }
        }

        // 4. Fallback: dept_code IN (chunks, 每塊 ≤999)
        if (!whereClause && deptScope.allowedDeptCodes.size > 0) {
          const colRef = (await findFilterKeyCol('dept_code')) || 'DEPT_CODE';
          const codes = [...deptScope.allowedDeptCodes];
          whereClause = buildInChunks(colRef, codes);
          console.log(`[OrgHierarchy] Injected WHERE (dept_code fallback): ${codes.length} dept codes`);
        }

        if (whereClause) {
          const existingWhere = design._dataPermissionWhere?.dataPermWhere || [];
          design._dataPermissionWhere = { dataPermWhere: [...existingWhere, whereClause] };
        }
      } else if (deptScope.hasRules && !deptScope.superUser) {
        send('error', {
          error: '⛔ 您目前的組織資料權限設定未涵蓋任何組織，無法執行查詢。\n請聯繫管理員確認使用者組織資料是否已從 ERP 同步。',
          org_hierarchy_empty_scope: true,
        });
        return;
      }
    }
  }

  // 2. 向量語意搜尋
  let vectorResults = [];
  if (design.vector_search_enabled) {
    try {
      send('status', { message: '語意搜尋中...' });
      const dims = parseInt(process.env.DASHBOARD_EMBEDDING_DIMS || DEFAULT_DIMS);

      // 從設計的 target_schemas 找出各 schema 綁定的 ETL Job（含 trigger_intent）
      const schemaIds = design.target_schema_ids ? JSON.parse(design.target_schema_ids) : [];
      const jobMeta = []; // [{ id, name, triggerIntent, alias }]
      design._jobAliasMap = {};
      for (const sid of schemaIds) {
        const s = await db.prepare(
          `SELECT sd.vector_etl_job_id, sd.alias, sd.table_name, ej.name AS job_name, ej.trigger_intent
           FROM ai_schema_definitions sd
           LEFT JOIN ai_etl_jobs ej ON ej.id = sd.vector_etl_job_id
           WHERE sd.id=?`
        ).get(sid);
        if (s?.vector_etl_job_id) {
          const alias = s.alias || s.table_name.split('.').pop().toLowerCase().replace(/[^a-z0-9_]/g, '_');
          design._jobAliasMap[s.vector_etl_job_id] = alias;
          jobMeta.push({ id: s.vector_etl_job_id, name: s.job_name, triggerIntent: s.trigger_intent, alias });
        }
      }

      // ── 觸發判斷：有 trigger_intent 的 job 須通過 AI 意圖比對才觸發 ──────────
      const { skip: skipVector, reason: skipReason } = await shouldSkipVector(db, design, question);
      if (skipVector) {
        console.log(`[Dashboard] Skip vector search: ${skipReason}`);
        design._skipReason = skipReason;
      }

      let activeJobIds = [];
      if (jobMeta.length && !skipVector) {
        const triggeredSet = await checkVectorTriggers(question, jobMeta);
        activeJobIds = jobMeta.filter(j => triggeredSet.has(j.id)).map(j => j.id);
      }

      if (activeJobIds.length) {
        // 翻譯時帶入第一個觸發 job 的 triggerIntent 作為語意 context
        const firstIntent = jobMeta.find(j => activeJobIds.includes(j.id))?.triggerIntent;
        const { query: embeddingQuery, inputTokens: tqIn, outputTokens: tqOut, model: tqModel }
          = await translateQueryForEmbedding(question, firstIntent);
        if ((tqIn || tqOut) && userId) {
          const tqDay = new Date().toISOString().split('T')[0];
          upsertTokenUsage(db, userId, tqDay, tqModel, tqIn, tqOut).catch(() => {});
        }
        const queryVec = await getEmbedding(embeddingQuery, dims);
        const topK = vectorTopK ?? design.vector_top_k ?? VECTOR_TOP_K;
        const threshold = vectorSimilarityThreshold ?? design.vector_similarity_threshold ?? null;
        vectorResults = await vectorSearch(db, activeJobIds, queryVec, topK, threshold);
      }

      send('vector_results', { results: vectorResults });
    } catch (e) {
      console.warn('[Dashboard] Vector search error:', e.message);
    }
  }

  let safeSql;
  let genResult = null;

  if (overrideSql) {
    // 直接使用指定 SQL，跳過 AI 生成
    send('status', { message: 'ERP 查詢中（已鎖定 SQL）...' });
    safeSql = validateSql(overrideSql.replace(/;+\s*$/, '').trim());
    send('sql_preview', { sql: safeSql, cached: false, skipped_ai: true });
  } else {
    // 3. 組裝 Prompt + 4. Gemini 生成 SQL
    send('status', { message: 'AI 生成 SQL 中...' });
    const prompt = await buildPrompt(db, design, question, vectorResults, design._skipReason, lang);
    const sqlModel = genAI.getGenerativeModel({ model: sqlApiModel });
    genResult = await sqlModel.generateContent(prompt);
    let generatedSql = genResult.response.text().trim();

    // 清除可能的 markdown code block 包裹（含多行 / 任意 fence 格式）
    generatedSql = generatedSql
      .replace(/^```[\w]*\r?\n?/im, '')
      .replace(/\r?\n?```\s*$/im, '')
      .trim()
      .replace(/;+\s*$/, '')
      .trim();

    // 5. SQL 安全審查
    safeSql = validateSql(generatedSql);
  }

  if (genResult) {
    const usage = genResult.response.usageMetadata;
    send('sql_preview', {
      sql: safeSql,
      cached: false,
      prompt_tokens: usage?.promptTokenCount,
      output_tokens: usage?.candidatesTokenCount,
    });
  }

  // 6. 執行查詢（依 schema 的 source_db_id 選擇對應 pool）
  if (!overrideSql) send('status', { message: 'DB 查詢中...' });

  // 解析 source_db_id：取 design 第一個 schema 的來源
  let sourceDbId = null;
  try {
    const schemaIds = design.target_schema_ids
      ? (typeof design.target_schema_ids === 'string' ? JSON.parse(design.target_schema_ids) : design.target_schema_ids)
      : [];
    if (schemaIds.length > 0) {
      const firstSchema = await db.prepare(`SELECT source_db_id FROM ai_schema_definitions WHERE id=?`).get(schemaIds[0]);
      sourceDbId = firstSchema?.source_db_id ?? firstSchema?.SOURCE_DB_ID ?? null;
    }
  } catch (_) {}

  const erpPool = await getPoolBySourceId(sourceDbId, db);
  const erpConn = await erpPool.getConnection();
  let rows = [];
  let columns = [];
  const startTime = Date.now();
  try {
    const result = await erpConn.execute(
      safeSql, [],
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        maxRows: designMaxRows || MAX_ROWS,
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
  send('query_meta', { duration_ms: durationMs, row_count: rows.length });

  // 7. 寫快取 + 推送結果
  const chartConfig = design.chart_config
    ? (typeof design.chart_config === 'string'
       ? JSON.parse(design.chart_config)
       : design.chart_config)
    : null;

  // 8. 從 schema 定義建立欄位標籤對照表（依語言選 description/desc_en/desc_vi）
  // 同時建立 中文description → 語言標籤 反向對應（應對 Gemini 生成中文 alias 的情況）
  const columnLabels = {};
  try {
    const schemaIds = design.target_schema_ids ? JSON.parse(design.target_schema_ids) : [];
    const descToLabel = {}; // 中文 description → 語言標籤（反向）
    const l = (lang || '').toLowerCase();
    for (const sid of schemaIds) {
      const cols = await db.prepare(`SELECT column_name, description, desc_en, desc_vi FROM ai_schema_columns WHERE schema_id=?`).all(sid);
      for (const col of cols) {
        let label = col.description;
        if (l.startsWith('en') && col.desc_en) label = col.desc_en;
        else if (l.startsWith('vi') && col.desc_vi) label = col.desc_vi;
        else if ((l.startsWith('zh') || !l) && col.description) label = col.description;
        if (label) columnLabels[col.column_name.toLowerCase()] = label;
        // 反向：中文說明 → 語言標籤（Gemini 生成的 SQL 可能用中文 alias）
        if (col.description && label && label !== col.description) {
          descToLabel[col.description] = label;
        }
      }
    }
    // 若查詢結果欄位名稱是中文 alias（不在 columnLabels 中），嘗試從反向表補齊
    for (const c of columns) {
      if (!columnLabels[c] && descToLabel[c]) {
        columnLabels[c] = descToLabel[c];
      }
    }
  } catch (e) { console.error('[columnLabels] ERROR:', e.message, e.stack); }

  send('result', { rows, columns, column_labels: columnLabels, row_count: rows.length, chart_config: chartConfig });

  // 9. Token 計費（SQL 生成 + embedding translation 用量）
  try {
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
  const resolvedEmbedModel = await getEmbeddingModel(db);

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
    // ── 1. 取得來源資料（依 source_db_id 選擇對應 pool）──────────────────────
    const etlSourceDbId = job.source_db_id ?? job.SOURCE_DB_ID ?? null;
    const erpPool = await getPoolBySourceId(etlSourceDbId, db);
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
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          maxRows: ETL_MAX_ROWS,
          // 強制 NCHAR/NVARCHAR2 欄位以 VARCHAR string 回傳，避免 thick mode 回 Buffer
          fetchTypeHandler: (d) =>
            (d.dbType === oracledb.DB_TYPE_NVARCHAR || d.dbType === oracledb.DB_TYPE_NCHAR)
              ? { type: oracledb.DB_TYPE_VARCHAR }
              : undefined,
        }
      );
      sourceRows = (result.rows || []).map(r =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [
            k.toLowerCase(),
            v instanceof Date ? v.toISOString()
              : Buffer.isBuffer(v) ? v.toString('utf8')  // 防禦性 Buffer → string
              : v,
          ])
        )
      );
      rowsFetched = sourceRows.length;
      // 診斷 log：印出第一筆資料確認中文是否在 JS 端已正常
      if (sourceRows.length > 0) {
        console.log('[ETL] sourceRows[0] sample:', JSON.stringify(sourceRows[0]).slice(0, 300));
      }
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
          const batchResult = await getBatchEmbeddings(batch.map(it => it.fieldValue), embeddingDim, resolvedEmbedModel);
          embeddings = batchResult.embeddings;
          totalEmbedTokens += batchResult.tokenCount;
        } catch (e) {
          // batch 失敗時逐筆 fallback
          console.warn(`[ETL] batch embed failed, falling back one-by-one: ${e.message}`);
          embeddings = [];
          for (const it of batch) {
            try {
              embeddings.push(await getEmbedding(it.fieldValue, embeddingDim, resolvedEmbedModel));
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

// ── 資料權限 WHERE 計算 ────────────────────────────────────────────────────────
/**
 * 依使用者有效政策規則 + schema 欄位 filter mapping，生成 SQL WHERE 條件
 * 正面表列：layer 有設定 include 才生成 IN 條件，include+exclude 混用時：
 *   include → 生成 col IN (allowed values)
 *   exclude → 生成 col NOT IN (forbidden values)
 * 若某層只有 exclude 沒有 include → 只加 NOT IN
 * 若某層只有 include → 只加 IN
 */
/**
 * 將 values 陣列切成 ≤999 塊，生成 Oracle IN 條件（避免 ORA-01795）
 * @param {string}  colRef   欄位引用，如 oed.ORG_CODE
 * @param {Array}   values   值陣列
 * @param {boolean} quoted   true=字串加引號（預設），false=數值不加
 */
function buildInChunks(colRef, values, quoted = true) {
  const CHUNK = 999;
  const chunks = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    const slice = values.slice(i, i + CHUNK);
    const inList = slice.map(v => quoted ? `'${v}'` : String(v)).join(',');
    chunks.push(`${colRef} IN (${inList})`);
  }
  return chunks.length === 1 ? chunks[0] : `(${chunks.join(' OR ')})`;
}

async function buildDataPermWhere(db, design, user, rules) {
  if (!rules?.length) return {};
  const schemaIds = design.target_schema_ids ? JSON.parse(design.target_schema_ids) : [];
  if (!schemaIds.length) return {};

  // 取出所有 filter key 欄位（含 schema alias 用於 column prefix）
  const filterCols = [];
  for (const sid of schemaIds) {
    const schemaDef = await db.prepare(
      `SELECT alias, table_name FROM ai_schema_definitions WHERE id=?`
    ).get(sid);
    const cols = await db.prepare(
      `SELECT column_name, filter_layer, filter_source FROM ai_schema_columns
       WHERE schema_id=? AND is_filter_key=1`
    ).all(sid);
    for (const col of cols) {
      const tblAlias = schemaDef?.alias || (schemaDef?.table_name || 't').split('.').pop().toLowerCase();
      filterCols.push({ ...col, tbl_alias: tblAlias });
    }
  }
  if (!filterCols.length) return {};

  // 取得使用者的組織資料（用於 layer 3 include 模式的自動值）
  const u = user || {};

  // Layer 3 對應：filter_source → user 的屬性
  const layer3UserMap = {
    dept_code: u.dept_code,
    profit_center: u.profit_center,
    org_section: u.org_section,
    org_group_name: u.org_group_name,
  };

  const whereParts = [];

  // 數字型 filter_source（不加引號）
  const NUMERIC_SOURCES = new Set([
    'organization_id', 'operating_unit', 'set_of_books_id', 'user_id', 'role_id'
  ]);

  function fmtVal(v, filterSource) {
    if (NUMERIC_SOURCES.has(filterSource) && /^\d+$/.test(String(v))) {
      return String(v); // number, no quotes
    }
    return `'${String(v).replace(/'/g, "''")}'`; // string, single-quoted
  }

  // MultiOrg (Layer 4) 和 OrgHierarchy (Layer 3) 都另外由各自的 service 處理，這裡跳過
  const { MULTIORG_VALUE_TYPES }       = require('./multiOrgService');
  const { ORG_HIERARCHY_VALUE_TYPES }  = require('./orgHierarchyService');

  // 依 filter_source 分組規則
  for (const fcol of filterCols) {
    const { column_name, filter_layer, filter_source, tbl_alias } = fcol;
    if (!filter_layer || !filter_source) continue;
    if (MULTIORG_VALUE_TYPES.has(filter_source))      continue; // Layer 4 MultiOrg → 由外部注入
    if (ORG_HIERARCHY_VALUE_TYPES.has(filter_source)) continue; // Layer 3 OrgHierarchy → 由外部注入
    const layerNum = filter_layer === 'layer3' ? 3 : filter_layer === 'layer4' ? 4 : null;
    if (!layerNum) continue;

    const layerRules = rules.filter(r => Number(r.layer) === layerNum && r.value_type === filter_source);
    if (!layerRules.length) continue;

    const includes = layerRules.filter(r => r.include_type === 'include').map(r => r.value_id).filter(Boolean);
    const excludes = layerRules.filter(r => r.include_type === 'exclude').map(r => r.value_id).filter(Boolean);
    const colRef = `${tbl_alias}.${column_name}`;

    if (includes.length) {
      const inList = includes.map(v => fmtVal(v, filter_source)).join(', ');
      whereParts.push(`${colRef} IN (${inList})`);
    }
    if (excludes.length) {
      const notInList = excludes.map(v => fmtVal(v, filter_source)).join(', ');
      whereParts.push(`${colRef} NOT IN (${notInList})`);
    }
  }

  return { dataPermWhere: whereParts };
}

// ─── Research Integration: Promise-based query (no SSE) ──────────────────────
/**
 * Execute a dashboard design query and return results as a Promise.
 * Used by researchService for AI 戰情 function calling.
 * Applies data policies identical to runDashboardQuery.
 * @returns {{ rows, columns, designName, sql }}
 */
async function queryDashboardDesignSync(db, userId, designId, question, modelKey = null) {
  const SYNC_MAX_ROWS = 100;

  // 1. Load design
  const design = await db.prepare(`SELECT * FROM ai_select_designs WHERE id=?`).get(designId);
  if (!design) throw new Error(`AI 戰情設計 ${designId} 不存在`);
  if (design.is_suspended == 1) throw new Error(`AI 戰情設計「${design.name}」已暫停使用`);

  // 2. Load fresh user
  const user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(userId);
  if (!user) throw new Error('使用者不存在');

  // 3. Effective policy (skip for admin)
  let effectivePolicy = null;
  if (user.role !== 'admin') {
    try {
      let _categoryId = null;
      if (design.topic_id) {
        const topic = await db.prepare(`SELECT policy_category_id FROM ai_select_topics WHERE id=?`).get(design.topic_id);
        _categoryId = topic?.policy_category_id || null;
      }
      const { getEffectivePolicies } = require('../routes/dataPermissions');
      const policies = await getEffectivePolicies(db, userId, _categoryId);
      if (policies.length > 0) effectivePolicy = { rules: policies.flatMap(p => p.rules) };
    } catch (_) {}
  }

  // 4. Data permission WHERE injection (same as runDashboardQuery)
  if (effectivePolicy?.rules?.length > 0) {
    design._dataPermissionWhere = await buildDataPermWhere(db, design, user, effectivePolicy.rules);
  }

  // 5. Resolve LLM model
  let sqlApiModel = process.env.GEMINI_MODEL_PRO || 'gemini-3-pro-preview';
  try {
    if (modelKey) {
      const mRow = await db.prepare(`SELECT api_model FROM llm_models WHERE key=? AND is_active=1`).get(modelKey);
      if (mRow?.api_model) sqlApiModel = mRow.api_model;
    } else {
      const mRow = await db.prepare(`SELECT api_model FROM llm_models WHERE is_active=1 ORDER BY sort_order ASC FETCH FIRST 1 ROWS ONLY`).get();
      if (mRow?.api_model) sqlApiModel = mRow.api_model;
    }
  } catch (_) {}

  // 6. Generate SQL via Gemini
  const prompt = await buildPrompt(db, design, question, [], null, 'zh-TW');
  const sqlModel = genAI.getGenerativeModel({ model: sqlApiModel });
  const genResult = await sqlModel.generateContent(prompt);
  let generatedSql = genResult.response.text().trim()
    .replace(/^```[\w]*\r?\n?/im, '')
    .replace(/\r?\n?```\s*$/im, '')
    .trim()
    .replace(/;+\s*$/, '')
    .trim();

  // 7. Validate SQL (read-only check)
  const safeSql = validateSql(generatedSql);

  // 8. Execute against ERP DB
  const erpPool = await getErpPool();
  const erpConn = await erpPool.getConnection();
  let rows = [], columns = [];
  try {
    const result = await erpConn.execute(safeSql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      maxRows: SYNC_MAX_ROWS,
      fetchArraySize: 50,
      queryTimeout: SQL_TIMEOUT_SEC,
    });
    rows = (result.rows || []).map(r =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v instanceof Date ? v.toISOString() : v]))
    );
    columns = (result.metaData || []).map(m => m.name.toLowerCase());
  } finally {
    await erpConn.close();
  }

  return { rows, columns, designName: design.name, sql: safeSql };
}

module.exports = {
  runDashboardQuery,
  queryDashboardDesignSync,
  runEtlJob,
  cancelEtlJob,
  initEtlScheduler,
  scheduleEtlJob,
  scheduleToCron,
  getErpPool,           // 供 dashboard.js import-oracle 路由使用（同一保護層）
  assertErpReadOnly,    // 供其他模組需要時直接呼叫
  getPoolBySourceId,    // 多來源 pool 取用
  invalidatePoolCache,  // 更新/刪除 db-source 時清快取
};
