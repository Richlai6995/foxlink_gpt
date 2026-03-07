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

const SQL_TIMEOUT_SEC = parseInt(process.env.DASHBOARD_SQL_TIMEOUT_SEC || '30');
const MAX_ROWS        = parseInt(process.env.DASHBOARD_MAX_ROWS || '500');
const VECTOR_TOP_K    = parseInt(process.env.DASHBOARD_VECTOR_TOP_K || '10');

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
class ReadOnlyConnectionProxy {
  constructor(conn) { this._conn = conn; }

  async execute(sql, binds = [], opts = {}) {
    assertErpReadOnly(sql);
    return this._conn.execute(sql, binds, opts);
  }

  async close() { return this._conn.close(); }
}

// ── ReadOnlyPoolProxy：getConnection() 回傳 proxy 連線 ───────────────────────
class ReadOnlyPoolProxy {
  constructor(rawPool) { this._pool = rawPool; }
  async getConnection() {
    const conn = await this._pool.getConnection();
    return new ReadOnlyConnectionProxy(conn);
  }
}

// ─── ERP 連線（唯讀，透過 ReadOnlyPoolProxy 強制保護）───────────────────────
let _rawErpPool = null;
let _erpPoolProxy = null;

async function getErpPool() {
  if (_erpPoolProxy) return _erpPoolProxy;
  if (!process.env.ERP_DB_HOST) throw new Error('ERP_DB_HOST 未設定');
  _rawErpPool = await oracledb.createPool({
    user:          process.env.ERP_DB_USER,
    password:      process.env.ERP_DB_USER_PASSWORD,
    connectString: `${process.env.ERP_DB_HOST}:${process.env.ERP_DB_PORT}/${process.env.ERP_DB_SERVICE_NAME}`,
    poolMin: 1, poolMax: 5, poolIncrement: 1, poolTimeout: 60,
  });
  _erpPoolProxy = new ReadOnlyPoolProxy(_rawErpPool);
  console.log('[ERP] 唯讀連線池已建立（ReadOnlyPoolProxy）');
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
  try {
    await db.prepare(`DELETE FROM ai_query_cache WHERE design_id=? AND question_hash=?`)
      .run(designId, hash);
    await db.prepare(
      `INSERT INTO ai_query_cache (design_id, question_hash, generated_sql, result_json, row_count, expires_at)
       VALUES (?, ?, ?, ?, ?, SYSTIMESTAMP + INTERVAL '${ttlMinutes}' MINUTE)`
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

// ─── 向量搜尋（Oracle 23 AI）────────────────────────────────────────────────
async function vectorSearch(db, jobIds, queryEmbedding, topK = VECTOR_TOP_K) {
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

    const sql = `
      SELECT source_table, source_pk, field_name, field_value, metadata,
             VECTOR_DISTANCE(embedding, TO_VECTOR('${vecStr}'), COSINE) AS score
      FROM ai_vector_store
      WHERE etl_job_id IN (${inClause})
      ORDER BY score ASC
      FETCH FIRST :topK ROWS ONLY
    `;
    const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return (result.rows || []).map(r => ({
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

// ─── Prompt 組裝 ──────────────────────────────────────────────────────────────
async function buildPrompt(db, design, question, vectorResults) {
  // 取得 schema 定義
  const schemaIds = design.target_schema_ids ? JSON.parse(design.target_schema_ids) : [];
  let schemaContext = '';
  for (const sid of schemaIds) {
    const s = await db.prepare(`SELECT * FROM ai_schema_definitions WHERE id=?`).get(sid);
    if (!s) continue;
    const cols = await db.prepare(`SELECT * FROM ai_schema_columns WHERE schema_id=?`).all(sid);
    schemaContext += `\n## 資料表：${s.table_name}（${s.display_name || ''}）\n`;
    if (s.business_notes) schemaContext += `### 說明：\n${s.business_notes}\n`;
    if (s.join_hints) {
      const hints = typeof s.join_hints === 'string' ? JSON.parse(s.join_hints) : s.join_hints;
      schemaContext += `### JOIN 關係：\n${JSON.stringify(hints, null, 2)}\n`;
    }
    if (cols.length) {
      schemaContext += `### 欄位：\n`;
      for (const c of cols) {
        let line = `- ${c.column_name} (${c.data_type || '?'}): ${c.description || ''}`;
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
    }
  }

  // 向量搜尋相似案例
  let vectorContext = '';
  if (vectorResults && vectorResults.length > 0) {
    vectorContext = '\n## 語意相似案例（供參考）：\n';
    vectorResults.slice(0, 5).forEach((r, i) => {
      vectorContext += `${i + 1}. [${r.source_table}] ${r.field_name}: ${r.field_value}\n`;
      if (r.metadata) {
        try {
          const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
          vectorContext += `   附加資料: ${JSON.stringify(meta)}\n`;
        } catch {}
      }
    });
  }

  // Few-shot 範例
  let fewShotContext = '';
  const fewShots = design.few_shot_examples
    ? (typeof design.few_shot_examples === 'string'
       ? JSON.parse(design.few_shot_examples)
       : design.few_shot_examples)
    : [];
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
5. 欄位名稱用中文別名（AS）方便閱讀`;

  return `${systemPrompt}

${schemaContext}
${vectorContext}
${fewShotContext}
## 使用者問題：
${question}

請生成對應的 Oracle SQL SELECT 語句：`;
}

// ─── 主查詢 Pipeline ──────────────────────────────────────────────────────────
async function runDashboardQuery({ designId, question, userId, isDesigner, send }) {
  const db = require('../database-oracle').db;

  // 取得 design
  const design = await db.prepare(`SELECT * FROM ai_select_designs WHERE id=?`).get(designId);
  if (!design) throw new Error('查詢設計不存在');

  // 1. Cache 查詢
  const cached = await getCachedResult(db, designId, question);
  if (cached) {
    if (isDesigner) send('sql_preview', { sql: cached.sql, cached: true });
    send('result', { rows: cached.result, row_count: cached.row_count, chart_config: design.chart_config });
    return;
  }

  // 2. 向量語意搜尋
  let vectorResults = [];
  if (design.vector_search_enabled) {
    try {
      send('status', { message: '語意搜尋中...' });
      const dims = parseInt(process.env.DASHBOARD_EMBEDDING_DIMS || DEFAULT_DIMS);
      const queryVec = await getEmbedding(question, dims);
      // 取關聯的 ETL job IDs（此設計 target_schema_ids 相關的 job）
      const jobRows = await db.prepare(
        `SELECT id FROM ai_etl_jobs WHERE status='active'`
      ).all();
      const jobIds = jobRows.map(r => r.id);
      if (jobIds.length) {
        vectorResults = await vectorSearch(db, jobIds, queryVec);
      }
      if (isDesigner) send('vector_results', { results: vectorResults });
    } catch (e) {
      console.warn('[Dashboard] Vector search error:', e.message);
    }
  }

  // 3. 組裝 Prompt + 4. Gemini 生成 SQL
  send('status', { message: 'AI 生成 SQL 中...' });
  const prompt = await buildPrompt(db, design, question, vectorResults);
  const sqlModel = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL_PRO || 'gemini-3-pro-preview',
  });
  const genResult = await sqlModel.generateContent(prompt);
  let generatedSql = genResult.response.text().trim();

  // 清除可能的 markdown code block 包裹
  generatedSql = generatedSql.replace(/^```[\w]*\n?/i, '').replace(/\n?```$/i, '').trim();

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
  await setCachedResult(db, designId, question, safeSql, rows, design.cache_ttl_minutes || 30);

  const chartConfig = design.chart_config
    ? (typeof design.chart_config === 'string'
       ? JSON.parse(design.chart_config)
       : design.chart_config)
    : null;

  send('result', { rows, columns, row_count: rows.length, chart_config: chartConfig });
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

  let rowsFetched = 0, rowsVectorized = 0;
  const errors = [];

  try {
    // 取得 ERP 資料
    const erpPool = await getErpPool();
    const erpConn = await erpPool.getConnection();
    let sourceRows = [];
    try {
      const lastRun = job.last_run_at && job.is_incremental
        ? new Date(job.last_run_at)
        : new Date(0);

      // ETL source_sql 也過唯讀驗證（雖然 proxy 會再擋，提前報清楚錯誤）
      const sql = validateSql(job.source_sql);
      const result = await erpConn.execute(
        sql,
        job.is_incremental ? { last_run: lastRun } : {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows: 10000 }
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

    // 向量化欄位
    const vectorizeFields = job.vectorize_fields
      ? (typeof job.vectorize_fields === 'string' ? JSON.parse(job.vectorize_fields) : job.vectorize_fields)
      : [];
    const metadataFields = job.metadata_fields
      ? (typeof job.metadata_fields === 'string' ? JSON.parse(job.metadata_fields) : job.metadata_fields)
      : [];

    const embeddingDim = job.embedding_dimension || DEFAULT_DIMS;

    // 全量模式：先刪除舊資料
    if (!job.is_incremental) {
      await db.prepare(`DELETE FROM ai_vector_store WHERE etl_job_id=?`).run(jobId);
    }

    // 批次 embed + INSERT
    const pool = require('../database-oracle').getPool();
    for (const row of sourceRows) {
      for (const fieldName of vectorizeFields) {
        const fieldValue = row[fieldName.toLowerCase()];
        if (!fieldValue || typeof fieldValue !== 'string' || !fieldValue.trim()) continue;

        try {
          const embedding = await getEmbedding(fieldValue, embeddingDim);
          const metadata = {};
          for (const mf of metadataFields) {
            metadata[mf] = row[mf.toLowerCase()];
          }
          const sourcePk = JSON.stringify(
            Object.fromEntries(
              Object.entries(row).filter(([k]) => !vectorizeFields.map(f => f.toLowerCase()).includes(k))
                .slice(0, 3)
            )
          );

          const conn = await pool.getConnection();
          try {
            const vecStr = `[${embedding.join(',')}]`;
            await conn.execute(
              `INSERT INTO ai_vector_store
                 (etl_job_id, source_table, source_pk, field_name, field_value, metadata, embedding)
               VALUES (:jobId, :table, :pk, :field, :val, :meta, TO_VECTOR(:vec))`,
              {
                jobId,
                table: job.vector_table || 'AI_VECTOR_STORE',
                pk: sourcePk.slice(0, 500),
                field: fieldName.toUpperCase(),
                val: fieldValue,
                meta: JSON.stringify(metadata),
                vec: vecStr,
              },
              { autoCommit: true }
            );
            rowsVectorized++;
          } finally {
            await conn.close();
          }
        } catch (e) {
          errors.push(`${fieldName}@row: ${e.message}`);
        }
      }
    }

    // 更新 last_run_at
    await db.prepare(`UPDATE ai_etl_jobs SET last_run_at=SYSTIMESTAMP WHERE id=?`).run(jobId);

    // 更新 log
    await db.prepare(
      `UPDATE ai_etl_run_logs SET
         finished_at=SYSTIMESTAMP, rows_fetched=?, rows_vectorized=?,
         status=?, error_message=?
       WHERE id=?`
    ).run(
      rowsFetched, rowsVectorized,
      errors.length > 0 ? 'partial' : 'success',
      errors.length > 0 ? errors.slice(0, 10).join('\n') : null,
      logId
    );

    console.log(`[ETL] Job ${jobId} done: ${rowsFetched} fetched, ${rowsVectorized} vectorized`);
  } catch (e) {
    console.error(`[ETL] Job ${jobId} failed:`, e.message);
    await db.prepare(
      `UPDATE ai_etl_run_logs SET finished_at=SYSTIMESTAMP, status='failed', error_message=? WHERE id=?`
    ).run(e.message, logId);
    throw e;
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
  initEtlScheduler,
  scheduleEtlJob,
  getErpPool,       // 供 dashboard.js import-oracle 路由使用（同一保護層）
  assertErpReadOnly, // 供其他模組需要時直接呼叫
};
