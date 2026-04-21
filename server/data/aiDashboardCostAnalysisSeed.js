/**
 * AI 戰情「費用分析」Seed
 *
 * 冪等地建立:
 *   - ai_db_sources:「FOXLINK GPT 本地 Oracle」來源(讀 SYSTEM_DB_* env)
 *   - ai_select_projects:「費用分析」
 *   - ai_select_topics  :「Token 費用統計」
 *   - ai_schema_definitions:「token_usage」「users」(兩張本地表)
 *   - ai_schema_columns:每張表的欄位 metadata(description / sample_values)
 *   - ai_select_designs:「各維度費用分析」(綁兩 schema,附 few-shot examples)
 *
 * 冪等規則:按 name/table_name 查,已存在就 skip(保留 user 手動編輯)。
 * 若要強制重 seed,需先從 DesignerPanel / DB 刪掉對應列。
 *
 * 注意:token_usage / users 是**本地 Oracle**,需獨立 DB source。
 * org_code_factory 是 ERP 表,跨庫 JOIN 複雜,暫不納入,factory 對照靠欄位 description 教 LLM。
 */

'use strict';

const { encryptPassword } = require('../utils/dbCrypto');

const LOCAL_DB_SOURCE_NAME = 'FOXLINK GPT 本地 Oracle';
const PROJECT_NAME         = '費用分析';
const TOPIC_NAME           = 'Token 費用統計';
const DESIGN_NAME          = '各維度費用分析';

async function ensureLocalDbSource(db) {
  const existing = await db.prepare(
    `SELECT id FROM ai_db_sources WHERE name=?`
  ).get(LOCAL_DB_SOURCE_NAME);
  if (existing?.id || existing?.ID) return existing.id || existing.ID;

  const host = process.env.SYSTEM_DB_HOST;
  const port = Number(process.env.SYSTEM_DB_PORT || 1521);
  const svc  = process.env.SYSTEM_DB_SERVICE_NAME;
  const user = process.env.SYSTEM_DB_USER;
  const pwd  = process.env.SYSTEM_DB_USER_PASSWORD;
  if (!host || !svc || !user || !pwd) {
    console.warn('[CostAnalysisSeed] SYSTEM_DB_* env 未完整,跳過本地 DB source 建立');
    return null;
  }

  await db.prepare(`
    INSERT INTO ai_db_sources
      (name, db_type, host, port, service_name, username, password_enc, is_default, is_active, pool_min, pool_max, pool_timeout)
    VALUES (?,?,?,?,?,?,?,0,1,1,5,60)
  `).run(LOCAL_DB_SOURCE_NAME, 'oracle', host, port, svc, user, encryptPassword(pwd));

  const row = await db.prepare(`SELECT id FROM ai_db_sources WHERE name=?`).get(LOCAL_DB_SOURCE_NAME);
  const id = row?.id || row?.ID;
  console.log(`[CostAnalysisSeed] 已建立本地 DB source id=${id}`);
  return id;
}

async function ensureProject(db, adminUserId) {
  const existing = await db.prepare(
    `SELECT id FROM ai_select_projects WHERE name=?`
  ).get(PROJECT_NAME);
  if (existing?.id || existing?.ID) return existing.id || existing.ID;

  await db.prepare(`
    INSERT INTO ai_select_projects (name, description, is_public, is_suspended, created_by)
    VALUES (?,?,0,0,?)
  `).run(
    PROJECT_NAME,
    '分析 FOXLINK GPT 各維度(利潤中心 / 事業處 / 事業群 / 廠區 / 月份 / 使用者 / 模型)Token 費用。預設僅 admin 可見,需透過 DesignerPanel 分享給其他角色。',
    adminUserId,
  );
  const row = await db.prepare(`SELECT id FROM ai_select_projects WHERE name=?`).get(PROJECT_NAME);
  const id = row?.id || row?.ID;
  console.log(`[CostAnalysisSeed] 已建立 Project id=${id}`);
  return id;
}

async function ensureTopic(db, projectId, adminUserId) {
  const existing = await db.prepare(
    `SELECT id FROM ai_select_topics WHERE name=? AND project_id=?`
  ).get(TOPIC_NAME, projectId);
  if (existing?.id || existing?.ID) return existing.id || existing.ID;

  await db.prepare(`
    INSERT INTO ai_select_topics (name, description, icon, sort_order, is_active, created_by, project_id)
    VALUES (?,?,?,0,1,?,?)
  `).run(
    TOPIC_NAME,
    '用自然語言查詢各部門 / 廠區 / 月份 / 模型的 AI Token 費用分布,對管理者提供費用成本可視化。',
    'dollar-sign',
    adminUserId,
    projectId,
  );
  const row = await db.prepare(`SELECT id FROM ai_select_topics WHERE name=? AND project_id=?`).get(TOPIC_NAME, projectId);
  const id = row?.id || row?.ID;
  console.log(`[CostAnalysisSeed] 已建立 Topic id=${id}`);
  return id;
}

// ── Schema 定義 ────────────────────────────────────────────────────────────

const TOKEN_USAGE_SCHEMA = {
  table_name:      'token_usage',
  alias:           'tu',
  display_name:    'Token 用量紀錄',
  display_name_en: 'Token Usage Records',
  display_name_vi: 'Bản ghi sử dụng Token',
  business_notes:
    '每筆代表一個使用者某一天某個模型的 Token 消耗統計 (daily aggregation)。' +
    'UNIQUE(user_id, usage_date, model) — 同人同日同模型只有一列。' +
    '費用 (cost) 單位是 USD(以 currency 欄位為準),已由 server 端根據模型定價計算。' +
    '若要分析費用,JOIN users(ON tu.user_id = users.id)以取得組織維度。',
  columns: [
    { column_name: 'id',            data_type: 'NUMBER',     description: '主鍵 ID' },
    { column_name: 'user_id',       data_type: 'NUMBER',     description: '使用者 ID,JOIN users.id',
      sample_values: '[1, 2, 3]' },
    { column_name: 'usage_date',    data_type: 'DATE',       description: '使用日期 (日粒度,不含時間)。用 TRUNC 或直接比較; WHERE usage_date BETWEEN TO_DATE(\'2026-03-01\',\'YYYY-MM-DD\') AND TO_DATE(\'2026-03-31\',\'YYYY-MM-DD\')',
      sample_values: '["2026-03-15", "2026-04-01"]' },
    { column_name: 'model',         data_type: 'VARCHAR2',   description: '模型名稱 (canonical key),如 gemini-3.1-pro-preview / gemini-3-flash-preview / gpt-5 / o3。',
      sample_values: '["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gpt-5", "o3"]' },
    { column_name: 'input_tokens',  data_type: 'NUMBER',     description: '輸入 token 數(prompt + 歷史對話 + KB chunks + cached tokens)' },
    { column_name: 'output_tokens', data_type: 'NUMBER',     description: '輸出 token 數(AI 回應)' },
    { column_name: 'cost',          data_type: 'NUMBER',     description: '該筆費用(currency 為單位,通常 USD)。已由 server 依模型定價即時計算。NULL 代表未計費(理論上不該發生)。',
      sample_values: '[0.0234, 1.5678, 0.0001]' },
    { column_name: 'currency',      data_type: 'VARCHAR2',   description: '幣別,預設 USD',
      value_mapping: '{"USD":"美元","TWD":"新台幣"}' },
  ],
};

const USERS_SCHEMA = {
  table_name:      'users',
  alias:           'u',
  display_name:    '使用者 (含組織資訊)',
  display_name_en: 'Users (with Organization Info)',
  display_name_vi: 'Người dùng (kèm tổ chức)',
  business_notes:
    'FOXLINK GPT 使用者主檔,包含 LDAP 同步過來的組織階層資訊(事業群→事業處→利潤中心→部門→廠區)。' +
    '已停用 / 離職用戶:status=\'disabled\' 或 org_end_date IS NOT NULL,做費用分析時請加條件排除。' +
    '常見 JOIN:token_usage tu JOIN users u ON tu.user_id = u.id。',
  columns: [
    { column_name: 'id',                  data_type: 'NUMBER',   description: '主鍵 ID,token_usage.user_id 對應' },
    { column_name: 'username',            data_type: 'VARCHAR2', description: '登入帳號(通常是工號或 ADMIN)' },
    { column_name: 'name',                data_type: 'VARCHAR2', description: '姓名(中文)' },
    { column_name: 'email',               data_type: 'VARCHAR2', description: 'Email' },
    { column_name: 'employee_id',         data_type: 'VARCHAR2', description: '工號' },
    { column_name: 'role',                data_type: 'VARCHAR2', description: '角色(admin / user),非 is_admin',
      value_mapping: '{"admin":"管理員","user":"一般使用者"}' },
    { column_name: 'status',              data_type: 'VARCHAR2', description: '帳號狀態,NULL 或 active 為正常,disabled 為停用。做活躍分析務必加 (status IS NULL OR status != \'disabled\')',
      sample_values: '[null, "active", "disabled"]' },
    { column_name: 'dept_code',           data_type: 'VARCHAR2', description: '部門代碼(如 IT01 / FA02)' },
    { column_name: 'dept_name',           data_type: 'VARCHAR2', description: '部門名稱(中文)' },
    { column_name: 'profit_center',       data_type: 'VARCHAR2', description: '利潤中心代碼(如 X4 / IZ / LI / PM / LW)。注意:可能為 NULL(admin 帳號 / 未同步 LDAP)。',
      sample_values: '["X4", "IZ", "LI", "PM", "LW", null]' },
    { column_name: 'profit_center_name',  data_type: 'VARCHAR2', description: '利潤中心名稱(如「資訊工程處」「消費性電子產品事業處」)' },
    { column_name: 'org_section',         data_type: 'VARCHAR2', description: '事業處代碼(如 U / W / AE)' },
    { column_name: 'org_section_name',    data_type: 'VARCHAR2', description: '事業處名稱(如「中央單位」「通訊系統-系統產品研發處」「消費性電子產品事業處」)' },
    { column_name: 'org_group_name',      data_type: 'VARCHAR2', description: '事業群名稱(最高組織層級,如「中央及貿易」「消費電子事業群」「光電事業群」)' },
    { column_name: 'factory_code',        data_type: 'VARCHAR2', description: '廠區代碼(如 HQ / FD / XZ)。NULL 代表未綁定廠區(「未歸屬」)。**要顯示中文/英文/越南文名稱,請 JOIN factory_code_lookup ON users.factory_code = factory_code_lookup.code**,取 name_zh / name_en / name_vi 欄位。代碼名稱的權威來源是 ERP KFF(FND_FLEX_VALUES_VL, FLEX_VALUE_SET_ID=1008041),已透過本地 factory_code_lookup 表同步。',
      sample_values: '["HQ", "FD", "FQ", "XZ", null]' },
    { column_name: 'org_end_date',        data_type: 'DATE',     description: '離職日期。NOT NULL 代表該員已離職,費用分析務必排除 (AND org_end_date IS NULL)。' },
    { column_name: 'org_synced_at',       data_type: 'TIMESTAMP', description: '組織資料最近同步時間' },
    { column_name: 'preferred_language',  data_type: 'VARCHAR2', description: '偏好語言(zh-TW / en / vi)' },
    { column_name: 'created_at',          data_type: 'TIMESTAMP', description: '建立時間' },
    { column_name: 'updated_at',          data_type: 'TIMESTAMP', description: '更新時間' },
  ],
};

const FACTORY_CODE_LOOKUP_SCHEMA = {
  table_name:      'factory_code_lookup',
  alias:           'fcl',
  display_name:    '廠區代碼對照表',
  display_name_en: 'Factory Code Lookup',
  display_name_vi: 'Bảng tra cứu mã nhà máy',
  business_notes:
    '廠區代碼 ↔ 中/英/越南文名稱的對照表。由 services/factoryCodeLookupSync.js 定期從 ERP KFF (FND_FLEX_VALUES_VL, FLEX_VALUE_SET_ID=1008041) 同步過來,' +
    '本地 Oracle 表,可以直接 JOIN。常用:`LEFT JOIN factory_code_lookup fcl ON users.factory_code = fcl.code`,' +
    '依使用者語言取 name_zh / name_en / name_vi。' +
    '若 ERP 新增廠區代碼,本地同步延遲最長 1 小時(factoryCache TTL);若使用者問到的代碼查不到中文名,可回代碼原樣。',
  columns: [
    { column_name: 'code',           data_type: 'VARCHAR2',  description: '廠區代碼(PK),例如 HQ、FD、FQ、XZ' },
    { column_name: 'name_zh',        data_type: 'NVARCHAR2', description: '中文名稱(ERP 原始),例如 總部、富東(深圳)、徐州。若 NULL 代表 ERP 未設定。' },
    { column_name: 'name_en',        data_type: 'NVARCHAR2', description: '英文名稱(本地 LLM 翻譯),可能為 NULL' },
    { column_name: 'name_vi',        data_type: 'NVARCHAR2', description: '越南文名稱(本地 LLM 翻譯),可能為 NULL' },
    { column_name: 'last_synced_at', data_type: 'TIMESTAMP', description: '最後同步時間' },
  ],
};

async function ensureSchema(db, schemaDef, sourceDbId, projectId, adminUserId) {
  const existing = await db.prepare(
    `SELECT id FROM ai_schema_definitions WHERE table_name=? AND source_db_id=?`
  ).get(schemaDef.table_name, sourceDbId);
  if (existing?.id || existing?.ID) {
    return existing.id || existing.ID;
  }

  await db.prepare(`
    INSERT INTO ai_schema_definitions
      (table_name, display_name, display_name_en, display_name_vi, alias,
       db_connection, source_db_id, source_type, business_notes,
       is_active, project_id, created_by)
    VALUES (?,?,?,?,?, 'system', ?, 'table', ?, 1, ?, ?)
  `).run(
    schemaDef.table_name,
    schemaDef.display_name,
    schemaDef.display_name_en,
    schemaDef.display_name_vi,
    schemaDef.alias,
    sourceDbId,
    schemaDef.business_notes,
    projectId,
    adminUserId,
  );

  const row = await db.prepare(
    `SELECT id FROM ai_schema_definitions WHERE table_name=? AND source_db_id=?`
  ).get(schemaDef.table_name, sourceDbId);
  const schemaId = row?.id || row?.ID;

  for (const col of schemaDef.columns) {
    await db.prepare(`
      INSERT INTO ai_schema_columns
        (schema_id, column_name, data_type, description, is_visible, is_vectorized, value_mapping, sample_values)
      VALUES (?, ?, ?, ?, 1, 0, ?, ?)
    `).run(
      schemaId,
      col.column_name,
      col.data_type || 'VARCHAR2',
      col.description || '',
      col.value_mapping || null,
      col.sample_values || null,
    );
  }
  console.log(`[CostAnalysisSeed] 已建立 Schema ${schemaDef.table_name} (id=${schemaId}, ${schemaDef.columns.length} 欄位)`);
  return schemaId;
}

// ── Few-shot examples ──────────────────────────────────────────────────────

function buildFewShotExamples() {
  return JSON.stringify([
    {
      q: '列出本月各利潤中心的總費用 (由高到低)',
      sql:
        "SELECT u.profit_center, u.profit_center_name, SUM(tu.cost) AS total_cost, COUNT(DISTINCT tu.user_id) AS user_count " +
        "FROM token_usage tu JOIN users u ON tu.user_id = u.id " +
        "WHERE tu.usage_date >= TRUNC(SYSDATE, 'MM') " +
        "  AND (u.status IS NULL OR u.status != 'disabled') AND u.org_end_date IS NULL " +
        "GROUP BY u.profit_center, u.profit_center_name " +
        "ORDER BY total_cost DESC",
    },
    {
      q: '上個月各廠區費用分布,含中文名稱與人均費用',
      sql:
        "SELECT u.factory_code, fcl.name_zh AS factory_name, " +
        "       SUM(tu.cost) AS total_cost, COUNT(DISTINCT tu.user_id) AS user_count, " +
        "       SUM(tu.cost) / NULLIF(COUNT(DISTINCT tu.user_id), 0) AS avg_cost_per_user " +
        "FROM token_usage tu JOIN users u ON tu.user_id = u.id " +
        "LEFT JOIN factory_code_lookup fcl ON u.factory_code = fcl.code " +
        "WHERE tu.usage_date >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -1) " +
        "  AND tu.usage_date <  TRUNC(SYSDATE, 'MM') " +
        "  AND (u.status IS NULL OR u.status != 'disabled') AND u.org_end_date IS NULL " +
        "GROUP BY u.factory_code, fcl.name_zh " +
        "ORDER BY total_cost DESC",
    },
    {
      q: '本月 Top 10 花費最多的使用者',
      sql:
        "SELECT u.employee_id, u.name, u.profit_center_name, u.dept_name, " +
        "       SUM(tu.cost) AS total_cost, SUM(tu.input_tokens + tu.output_tokens) AS total_tokens " +
        "FROM token_usage tu JOIN users u ON tu.user_id = u.id " +
        "WHERE tu.usage_date >= TRUNC(SYSDATE, 'MM') " +
        "GROUP BY u.employee_id, u.name, u.profit_center_name, u.dept_name " +
        "ORDER BY total_cost DESC " +
        "FETCH FIRST 10 ROWS ONLY",
    },
    {
      q: '過去 30 天按事業群分組的費用占比',
      sql:
        "SELECT u.org_group_name, SUM(tu.cost) AS total_cost, " +
        "       ROUND(100 * SUM(tu.cost) / SUM(SUM(tu.cost)) OVER (), 2) AS pct " +
        "FROM token_usage tu JOIN users u ON tu.user_id = u.id " +
        "WHERE tu.usage_date >= SYSDATE - 30 " +
        "  AND (u.status IS NULL OR u.status != 'disabled') AND u.org_end_date IS NULL " +
        "GROUP BY u.org_group_name " +
        "ORDER BY total_cost DESC",
    },
    {
      q: '這個月每個模型的使用量與費用',
      sql:
        "SELECT tu.model, SUM(tu.input_tokens) AS input_tokens, SUM(tu.output_tokens) AS output_tokens, " +
        "       SUM(tu.cost) AS total_cost, COUNT(DISTINCT tu.user_id) AS user_count " +
        "FROM token_usage tu " +
        "WHERE tu.usage_date >= TRUNC(SYSDATE, 'MM') " +
        "GROUP BY tu.model " +
        "ORDER BY total_cost DESC",
    },
    {
      q: '徐州廠區每個月的費用趨勢(近 6 個月)',
      sql:
        "SELECT TO_CHAR(tu.usage_date, 'YYYY-MM') AS month, SUM(tu.cost) AS total_cost, " +
        "       COUNT(DISTINCT tu.user_id) AS user_count " +
        "FROM token_usage tu JOIN users u ON tu.user_id = u.id " +
        "JOIN factory_code_lookup fcl ON u.factory_code = fcl.code " +
        "WHERE tu.usage_date >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -6) " +
        "  AND fcl.name_zh LIKE '%徐州%' " +
        "  AND (u.status IS NULL OR u.status != 'disabled') AND u.org_end_date IS NULL " +
        "GROUP BY TO_CHAR(tu.usage_date, 'YYYY-MM') " +
        "ORDER BY month",
    },
    {
      q: '列出所有廠區代碼與中文名稱',
      sql:
        "SELECT code, name_zh, name_en, name_vi " +
        "FROM factory_code_lookup " +
        "ORDER BY code",
    },
  ]);
}

function buildSystemPrompt() {
  return (
    '你是 FOXLINK GPT 費用分析 SQL 產生器。規則:\n' +
    '1. 只能產出 SELECT 查詢,禁止 INSERT/UPDATE/DELETE/DDL。\n' +
    '2. 預設排除已離職 / 已停用使用者:`(u.status IS NULL OR u.status != \'disabled\') AND u.org_end_date IS NULL`。使用者若明確要求「含離職」才可省略。\n' +
    '3. 費用分析務必 JOIN users 以取得組織維度,絕對不要查 users.password 欄位。\n' +
    '4. 日期處理用 Oracle 函式:TRUNC(SYSDATE,\'MM\') 取本月初、ADD_MONTHS / SYSDATE - N 取區間。\n' +
    '5. **廠區名稱**:users.factory_code 只有代碼,中文/英文/越南文名稱在 factory_code_lookup 表。要呈現廠區中文名,必用 `LEFT JOIN factory_code_lookup fcl ON u.factory_code = fcl.code`,並 SELECT fcl.name_zh(使用者語言若 en 取 name_en,vi 取 name_vi)。使用者用中文問「徐州廠」「上海廠」等,請用 `fcl.name_zh LIKE \'%徐州%\'` 方式反查 code,不要自己猜代碼。\n' +
    '6. 數值結果用 SUM / COUNT(DISTINCT user_id) 等聚合,cost 是 NUMBER(預存已計費,單位 USD)。\n' +
    '7. 回傳 SQL 前請加適當 ORDER BY,讓結果可閱讀。\n' +
    '8. 欄位命名:SELECT 出來的欄位盡量用有意義的 alias(例:total_cost / factory_name / user_count),避免讓前端只看到 f.name_zh 這類難解讀的欄位。\n'
  );
}

function buildChartConfig() {
  return JSON.stringify({
    default_chart: 'bar',
    supported: ['bar', 'pie', 'line', 'table'],
  });
}

async function ensureDesign(db, topicId, schemaIds, adminUserId) {
  const existing = await db.prepare(
    `SELECT id, target_schema_ids FROM ai_select_designs WHERE topic_id=? AND name=?`
  ).get(topicId, DESIGN_NAME);
  if (existing?.id || existing?.ID) {
    const designId = existing.id || existing.ID;
    // 增量補 schema:若 target_schema_ids 缺新 schema,合併後寫回(不動 examples/prompt,保留 user 手改)
    try {
      const raw = existing.target_schema_ids ?? existing.TARGET_SCHEMA_IDS;
      const rawStr = raw && typeof raw !== 'string' ? String(raw) : raw;
      const current = rawStr ? JSON.parse(rawStr) : [];
      const missing = schemaIds.filter(id => !current.includes(id));
      if (missing.length > 0) {
        const merged = [...current, ...missing];
        await db.prepare(
          `UPDATE ai_select_designs SET target_schema_ids=? WHERE id=?`
        ).run(JSON.stringify(merged), designId);
        console.log(`[CostAnalysisSeed] Design id=${designId} 補新 schemas: [${missing.join(', ')}]`);
      }
    } catch (e) {
      console.warn('[CostAnalysisSeed] 檢查 target_schema_ids 失敗:', e.message);
    }
    return designId;
  }

  await db.prepare(`
    INSERT INTO ai_select_designs
      (topic_id, name, description, target_schema_ids, vector_search_enabled,
       system_prompt, few_shot_examples, chart_config, cache_ttl_minutes,
       is_public, share_type, is_suspended, created_by)
    VALUES (?,?,?,?,0, ?, ?, ?, 15, 0, 'none', 0, ?)
  `).run(
    topicId,
    DESIGN_NAME,
    '用自然語言查詢 FOXLINK GPT Token 費用。支援維度:利潤中心 / 事業處 / 事業群 / 廠區 / 部門 / 使用者 / 模型 / 月份 / 日。',
    JSON.stringify(schemaIds),
    buildSystemPrompt(),
    buildFewShotExamples(),
    buildChartConfig(),
    adminUserId,
  );
  const row = await db.prepare(
    `SELECT id FROM ai_select_designs WHERE topic_id=? AND name=?`
  ).get(topicId, DESIGN_NAME);
  const id = row?.id || row?.ID;
  console.log(`[CostAnalysisSeed] 已建立 Design id=${id} (綁 schema: ${schemaIds.join(', ')})`);
  return id;
}

// ── 主入口 ──────────────────────────────────────────────────────────────────

async function runSeed(db) {
  try {
    const adminRow = await db.prepare(
      `SELECT id FROM users WHERE UPPER(username) = UPPER(?) AND role='admin'`
    ).get(process.env.DEFAULT_ADMIN_ACCOUNT || 'ADMIN');
    const adminUserId = adminRow?.id || adminRow?.ID || null;
    if (!adminUserId) {
      console.warn('[CostAnalysisSeed] 找不到 admin,跳過 seed');
      return;
    }

    const sourceDbId = await ensureLocalDbSource(db);
    if (!sourceDbId) return;

    const projectId = await ensureProject(db, adminUserId);
    const topicId   = await ensureTopic(db, projectId, adminUserId);

    const tokenUsageSchemaId    = await ensureSchema(db, TOKEN_USAGE_SCHEMA,         sourceDbId, projectId, adminUserId);
    const usersSchemaId         = await ensureSchema(db, USERS_SCHEMA,               sourceDbId, projectId, adminUserId);
    const factoryLookupSchemaId = await ensureSchema(db, FACTORY_CODE_LOOKUP_SCHEMA, sourceDbId, projectId, adminUserId);

    await ensureDesign(db, topicId, [tokenUsageSchemaId, usersSchemaId, factoryLookupSchemaId], adminUserId);
    console.log('[CostAnalysisSeed] 完成');
  } catch (e) {
    console.error('[CostAnalysisSeed] error:', e.message);
  }
}

module.exports = { runSeed };
