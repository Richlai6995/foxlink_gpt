/**
 * AI 戰情「費用分析」Seed
 *
 * 冪等建立:
 *   - ai_db_sources: FOXLINK GPT 本地 Oracle 來源(讀 SYSTEM_DB_* env)
 *   - ai_select_projects / topics: 「費用分析」→ 「Token 費用統計」
 *   - ai_schema_definitions: 4 張 schema(token_usage / users / factory_code_lookup / indirect_emp_by_pc_factory)
 *   - ai_select_designs: 5 張報表對應 5 個 designs,每個綁固定 chart_config
 *       A. 利潤中心費用總表 (pie + bar)
 *       B. 利潤中心 × 廠區 明細表 (table)
 *       C. 月份費用分析表 (line)
 *       D. 利潤中心 × 月份 × 廠區 明細表 (table)
 *       E. Token 使用清單 (table)
 *
 * 維護策略:
 *   - DB source / Project / Topic / Schema:冪等 skip(不覆蓋 user 手改)
 *   - **5 個 Design 強制 force-update**(每次 server 啟動 seed 會重設 design metadata)
 *     要自訂請在 DesignerPanel「另存新 design」,不要直接改 seed 的 5 個
 *   - 舊 design「各維度費用分析」自動 rename 成 A(一次性 migration)
 *
 * 已修 bug:
 *   - few_shot_examples 的 key 用 q_zh(既有用 q 前端 UI chip 顯示不出來)
 *   - chart_config shape 改成 {default_chart, allow_table, allow_export, charts:[...]}
 */

'use strict';

const { encryptPassword } = require('../utils/dbCrypto');

const LOCAL_DB_SOURCE_NAME = 'FOXLINK GPT 本地 Oracle';
const PROJECT_NAME         = '費用分析';
const TOPIC_NAME           = 'Token 費用統計';
const OLD_DESIGN_NAME      = '各維度費用分析';   // 舊 single design,rename 成 A
const DESIGN_A_NAME        = 'A. 利潤中心費用總表';
const DESIGN_B_NAME        = 'B. 利潤中心 × 廠區 明細表';
const DESIGN_C_NAME        = 'C. 月份費用分析表';
const DESIGN_D_NAME        = 'D. 利潤中心 × 月份 × 廠區 明細表';
const DESIGN_E_NAME        = 'E. Token 使用清單';

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
    { column_name: 'id',            data_type: 'NUMBER',   description: '主鍵 ID' },
    { column_name: 'user_id',       data_type: 'NUMBER',   description: '使用者 ID' },
    { column_name: 'usage_date',    data_type: 'DATE',     description: '使用日期' },
    { column_name: 'model',         data_type: 'VARCHAR2', description: '模型名稱',
      sample_values: '["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gpt-5", "o3"]' },
    { column_name: 'input_tokens',  data_type: 'NUMBER',   description: '輸入 token 數' },
    { column_name: 'output_tokens', data_type: 'NUMBER',   description: '輸出 token 數' },
    { column_name: 'cost',          data_type: 'NUMBER',   description: '費用金額' },
    { column_name: 'currency',      data_type: 'VARCHAR2', description: '幣別',
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
    { column_name: 'id',                  data_type: 'NUMBER',    description: '主鍵 ID' },
    { column_name: 'username',            data_type: 'VARCHAR2',  description: '登入帳號' },
    { column_name: 'name',                data_type: 'VARCHAR2',  description: '姓名' },
    { column_name: 'email',               data_type: 'VARCHAR2',  description: 'Email' },
    { column_name: 'employee_id',         data_type: 'VARCHAR2',  description: '工號' },
    { column_name: 'role',                data_type: 'VARCHAR2',  description: '角色',
      value_mapping: '{"admin":"管理員","user":"一般使用者"}' },
    { column_name: 'status',              data_type: 'VARCHAR2',  description: '帳號狀態',
      sample_values: '[null, "active", "disabled"]' },
    { column_name: 'dept_code',           data_type: 'VARCHAR2',  description: '部門代碼' },
    { column_name: 'dept_name',           data_type: 'VARCHAR2',  description: '部門名稱' },
    { column_name: 'profit_center',       data_type: 'VARCHAR2',  description: '利潤中心代碼',
      sample_values: '["X4", "IZ", "LI", "PM", "LW"]' },
    { column_name: 'profit_center_name',  data_type: 'VARCHAR2',  description: '利潤中心名稱' },
    { column_name: 'org_section',         data_type: 'VARCHAR2',  description: '事業處代碼' },
    { column_name: 'org_section_name',    data_type: 'VARCHAR2',  description: '事業處名稱' },
    { column_name: 'org_group_name',      data_type: 'VARCHAR2',  description: '事業群名稱' },
    { column_name: 'factory_code',        data_type: 'VARCHAR2',  description: '廠區代碼',
      sample_values: '["HQ", "FD", "FQ", "XZ"]' },
    { column_name: 'org_end_date',        data_type: 'DATE',      description: '離職日期' },
    { column_name: 'org_synced_at',       data_type: 'TIMESTAMP', description: '組織資料同步時間' },
    { column_name: 'preferred_language',  data_type: 'VARCHAR2',  description: '偏好語言' },
    { column_name: 'created_at',          data_type: 'TIMESTAMP', description: '建立時間' },
    { column_name: 'updated_at',          data_type: 'TIMESTAMP', description: '更新時間' },
  ],
};

const INDIRECT_EMP_BY_PC_FACTORY_SCHEMA = {
  table_name:      'indirect_emp_by_pc_factory',
  alias:           'ie',
  display_name:    '間接員工計數 (by 利潤中心 × 廠區)',
  display_name_en: 'Indirect Employee Count (by Profit Center × Factory)',
  display_name_vi: 'Số lượng nhân viên gián tiếp (theo PC × Nhà máy)',
  business_notes:
    '間接員工 (DIT_CODE=I) 靜態人頭快照,由 services/indirectEmpSync.js 從 ERP foxfl.fl_emp_exp_all 同步過來。' +
    '**代表「組織應有多少人」,跟 token_usage 無關**,不反映誰有用 AI — 要看實際使用,用 COUNT(DISTINCT tu.user_id)。' +
    '常見用法:分析某利潤中心 × 廠區的 AI「滲透率 / 覆蓋率」— 即「使用人數 / 間接員工數」。' +
    'JOIN 條件:`u.profit_center = ie.profit_center AND NVL(u.factory_code, \'__NONE__\') = ie.factory_code`。' +
    'factory_code=\'__NONE__\' 代表 ERP 裡這個間接員工的 DEPT_CODE 沒對應到 FL_ORG_EMP_DEPT_MV 的 factory(「未歸屬」)。',
  columns: [
    { column_name: 'profit_center',  data_type: 'VARCHAR2',  description: '利潤中心代碼' },
    { column_name: 'factory_code',   data_type: 'VARCHAR2',  description: '廠區代碼' },
    { column_name: 'emp_count',      data_type: 'NUMBER',    description: '間接員工人數' },
    { column_name: 'last_synced_at', data_type: 'TIMESTAMP', description: '最後同步時間' },
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
    { column_name: 'code',           data_type: 'VARCHAR2',  description: '廠區代碼' },
    { column_name: 'name_zh',        data_type: 'NVARCHAR2', description: '中文名稱' },
    { column_name: 'name_en',        data_type: 'NVARCHAR2', description: '英文名稱' },
    { column_name: 'name_vi',        data_type: 'NVARCHAR2', description: '越南文名稱' },
    { column_name: 'last_synced_at', data_type: 'TIMESTAMP', description: '最後同步時間' },
  ],
};

/**
 * 同步 schema 的 columns metadata(description / sample_values / value_mapping / data_type)。
 * 既有欄位:UPDATE(force);新欄位:INSERT。
 * 不會 DELETE 既有但 spec 沒列的欄位(避免抹掉 user 在 DesignerPanel 手加的)。
 */
async function syncSchemaColumns(db, schemaId, schemaDef) {
  const existing = await db.prepare(
    `SELECT id, column_name FROM ai_schema_columns WHERE schema_id=?`
  ).all(schemaId);
  const existingMap = new Map(
    (existing || []).map(c => [String(c.column_name || c.COLUMN_NAME).toLowerCase(), c.id || c.ID])
  );

  let updated = 0;
  let inserted = 0;
  for (const col of schemaDef.columns) {
    const colKey = col.column_name.toLowerCase();
    if (existingMap.has(colKey)) {
      await db.prepare(
        `UPDATE ai_schema_columns
           SET data_type=?, description=?, value_mapping=?, sample_values=?
         WHERE id=?`
      ).run(
        col.data_type || 'VARCHAR2',
        col.description || '',
        col.value_mapping || null,
        col.sample_values || null,
        existingMap.get(colKey),
      );
      updated++;
    } else {
      await db.prepare(
        `INSERT INTO ai_schema_columns
          (schema_id, column_name, data_type, description, is_visible, is_vectorized, value_mapping, sample_values)
         VALUES (?, ?, ?, ?, 1, 0, ?, ?)`
      ).run(
        schemaId,
        col.column_name,
        col.data_type || 'VARCHAR2',
        col.description || '',
        col.value_mapping || null,
        col.sample_values || null,
      );
      inserted++;
    }
  }
  return { inserted, updated };
}

async function ensureSchema(db, schemaDef, sourceDbId, projectId, adminUserId) {
  const existing = await db.prepare(
    `SELECT id FROM ai_schema_definitions WHERE table_name=? AND source_db_id=?`
  ).get(schemaDef.table_name, sourceDbId);

  let schemaId;
  if (existing?.id || existing?.ID) {
    schemaId = existing.id || existing.ID;
    // force-update schema metadata(display name / business_notes / alias)
    await db.prepare(
      `UPDATE ai_schema_definitions
         SET display_name=?, display_name_en=?, display_name_vi=?, alias=?, business_notes=?
       WHERE id=?`
    ).run(
      schemaDef.display_name,
      schemaDef.display_name_en,
      schemaDef.display_name_vi,
      schemaDef.alias,
      schemaDef.business_notes,
      schemaId,
    );
  } else {
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
    schemaId = row?.id || row?.ID;
  }

  const { inserted, updated } = await syncSchemaColumns(db, schemaId, schemaDef);
  if (inserted > 0 || updated > 0) {
    const verb = existing?.id || existing?.ID ? '更新' : '建立';
    console.log(`[CostAnalysisSeed] Schema ${verb} id=${schemaId} (${schemaDef.table_name}, columns: +${inserted}/~${updated})`);
  }
  return schemaId;
}

// ── 共用 System Prompt ─────────────────────────────────────────────────────

function buildSystemPrompt() {
  return (
    '你是 FOXLINK GPT 費用分析 SQL 產生器。規則:\n' +
    '1. 只能產出 SELECT 查詢,禁止 INSERT/UPDATE/DELETE/DDL。\n' +
    '2. 預設排除已離職 / 已停用使用者:`(u.status IS NULL OR u.status != \'disabled\') AND u.org_end_date IS NULL`。使用者若明確要求「含離職」才可省略。\n' +
    '3. 費用分析務必 JOIN users 以取得組織維度,絕對不要查 users.password 欄位。\n' +
    '4. 日期處理用 Oracle 函式:TRUNC(SYSDATE,\'MM\') 取本月初、ADD_MONTHS / SYSDATE - N 取區間。\n' +
    '5. **廠區名稱**:users.factory_code 只有代碼,中文/英文/越南文名稱在 factory_code_lookup 表。要呈現廠區中文名,必用 `LEFT JOIN factory_code_lookup fcl ON u.factory_code = fcl.code`,並 SELECT fcl.name_zh。使用者用中文問「徐州廠」「上海廠」等,請用 `fcl.name_zh LIKE \'%徐州%\'` 方式反查 code,不要自己猜代碼。\n' +
    '6. 數值結果用 SUM / COUNT(DISTINCT user_id) 等聚合,cost 是 NUMBER(預存已計費,單位 USD)。\n' +
    '7. 回傳 SQL 前請加適當 ORDER BY,讓結果可閱讀。\n' +
    '8. 欄位命名:SELECT 出來的欄位盡量用有意義的 alias(例:total_cost / factory_name / user_count)。\n' +
    '9. **間接員工數**在 indirect_emp_by_pc_factory。JOIN:`LEFT JOIN indirect_emp_by_pc_factory ie ON ie.profit_center = u.profit_center AND ie.factory_code = NVL(u.factory_code, \'__NONE__\')`。請用 NVL(..., \'__NONE__\') 處理未歸屬。\n' +
    '10. **帳號人數 vs 使用人數**:帳號人數是「登記在該 pc×factory 的 users 總數」跟時間無關(FROM users GROUP BY);使用人數是「該時段實際用過 AI」(COUNT DISTINCT tu.user_id)。需同時呈現時用 CTE 分別算再 OUTER JOIN。\n'
  );
}

// ── 5 張報表對應的 Design 定義 ──────────────────────────────────────────────

// Design A: 利潤中心費用總表
const DESIGN_A = {
  name: DESIGN_A_NAME,
  description: '本期各利潤中心總費用(對應 admin「利潤中心費用總表」),顯示 pie 占比 + 長條圖',
  few_shot_examples: [
    {
      q_zh: '本月各利潤中心總費用(由高到低,含人均費用)',
      q_en: 'Total cost by profit center this month (desc, with avg per user)',
      q_vi: 'Tổng chi phí theo trung tâm lợi nhuận tháng này (kèm bình quân/người)',
      sql:
        "SELECT u.profit_center, u.profit_center_name, u.org_section, u.org_section_name, u.org_group_name, " +
        "       SUM(tu.cost) AS total_cost, COUNT(DISTINCT tu.user_id) AS user_count, " +
        "       SUM(tu.cost) / NULLIF(COUNT(DISTINCT tu.user_id), 0) AS avg_cost " +
        "FROM token_usage tu JOIN users u ON tu.user_id = u.id " +
        "WHERE tu.usage_date >= TRUNC(SYSDATE, 'MM') " +
        "  AND (u.status IS NULL OR u.status != 'disabled') AND u.org_end_date IS NULL " +
        "GROUP BY u.profit_center, u.profit_center_name, u.org_section, u.org_section_name, u.org_group_name " +
        "ORDER BY total_cost DESC",
    },
  ],
  chart_config: {
    default_chart: 'pie',
    allow_table: true,
    allow_export: true,
    charts: [
      { type: 'pie', title: '費用占比 (利潤中心)', label_field: 'profit_center_name', value_field: 'total_cost', donut: true, show_label: true },
      { type: 'bar', title: '各利潤中心費用',       x_field: 'profit_center_name',     y_field: 'total_cost',      show_label: false },
    ],
  },
};

// Design B: 利潤中心 × 廠區 明細表 (table + bar by factory)
const DESIGN_B = {
  name: DESIGN_B_NAME,
  description: '本期利潤中心 × 廠區的費用、間接員工、帳號、使用人數完整明細(對應 admin「利潤中心 × 廠區明細表」)',
  few_shot_examples: [
    {
      q_zh: '本月各利潤中心 × 廠區完整費用明細(含廠區中文名 / 間接員工數 / 帳號人數 / 使用人數 / 人均費用)',
      q_en: 'Full cost breakdown by profit_center × factory this month',
      q_vi: 'Chi phí chi tiết theo PC × nhà máy tháng này',
      sql:
        "WITH use_agg AS ( " +
        "  SELECT u.profit_center, u.factory_code, " +
        "         COUNT(DISTINCT tu.user_id) AS user_count, SUM(tu.cost) AS total_cost " +
        "  FROM token_usage tu JOIN users u ON tu.user_id = u.id " +
        "  WHERE tu.usage_date >= TRUNC(SYSDATE, 'MM') " +
        "    AND (u.status IS NULL OR u.status != 'disabled') AND u.org_end_date IS NULL " +
        "  GROUP BY u.profit_center, u.factory_code " +
        "), acc_agg AS ( " +
        "  SELECT profit_center, factory_code, COUNT(*) AS account_count " +
        "  FROM users " +
        "  WHERE (status IS NULL OR status != 'disabled') AND org_end_date IS NULL " +
        "  GROUP BY profit_center, factory_code " +
        ") " +
        "SELECT a.profit_center, " +
        "       (SELECT MAX(profit_center_name) FROM users WHERE profit_center=a.profit_center) AS profit_center_name, " +
        "       (SELECT MAX(org_section)      FROM users WHERE profit_center=a.profit_center) AS org_section, " +
        "       (SELECT MAX(org_section_name) FROM users WHERE profit_center=a.profit_center) AS org_section_name, " +
        "       (SELECT MAX(org_group_name)   FROM users WHERE profit_center=a.profit_center) AS org_group_name, " +
        "       a.factory_code, fcl.name_zh AS factory_name, " +
        "       NVL(ie.emp_count, 0) AS indirect_emp_count, " +
        "       a.account_count, " +
        "       NVL(us.user_count, 0) AS user_count, " +
        "       NVL(us.total_cost, 0) AS total_cost, " +
        "       NVL(us.total_cost, 0) / NULLIF(us.user_count, 0) AS avg_cost " +
        "FROM acc_agg a " +
        "LEFT JOIN use_agg us ON us.profit_center=a.profit_center AND NVL(us.factory_code,'__NONE__')=NVL(a.factory_code,'__NONE__') " +
        "LEFT JOIN factory_code_lookup fcl ON fcl.code = a.factory_code " +
        "LEFT JOIN indirect_emp_by_pc_factory ie ON ie.profit_center = a.profit_center AND ie.factory_code = NVL(a.factory_code,'__NONE__') " +
        "WHERE NVL(ie.emp_count,0) + a.account_count + NVL(us.user_count,0) > 0 " +
        "ORDER BY total_cost DESC",
    },
  ],
  chart_config: {
    default_chart: 'bar',
    allow_table: true,
    allow_export: true,
    charts: [
      { type: 'bar', title: '各廠區費用', x_field: 'factory_name', y_field: 'total_cost', show_label: false },
    ],
  },
};

// Design C: 月份費用分析表
const DESIGN_C = {
  name: DESIGN_C_NAME,
  description: '近 6 個月各月費用趨勢(對應 admin「月份費用分析表」),line chart 顯示月度費用變化',
  few_shot_examples: [
    {
      q_zh: '近 6 個月各利潤中心每月費用(line 顯示趨勢)',
      q_en: 'Monthly cost trend by profit center for the last 6 months',
      q_vi: 'Xu hướng chi phí theo PC trong 6 tháng gần đây',
      sql:
        "SELECT TO_CHAR(tu.usage_date, 'YYYY-MM') AS month, " +
        "       u.profit_center_name, " +
        "       SUM(tu.cost) AS total_cost, COUNT(DISTINCT tu.user_id) AS user_count " +
        "FROM token_usage tu JOIN users u ON tu.user_id = u.id " +
        "WHERE tu.usage_date >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -6) " +
        "  AND (u.status IS NULL OR u.status != 'disabled') AND u.org_end_date IS NULL " +
        "GROUP BY TO_CHAR(tu.usage_date, 'YYYY-MM'), u.profit_center_name " +
        "ORDER BY month, total_cost DESC",
    },
  ],
  chart_config: {
    default_chart: 'line',
    allow_table: true,
    allow_export: true,
    charts: [
      { type: 'line', title: '月份費用趨勢', x_field: 'month', y_field: 'total_cost', smooth: true, area: true },
    ],
  },
};

// Design D: 利潤中心 × 月份 × 廠區 明細表 (table + bar by month + bar by factory)
const DESIGN_D = {
  name: DESIGN_D_NAME,
  description: '按利潤中心 × 月份 × 廠區的完整費用明細(對應 admin「利潤中心 × 月份 × 廠區明細表」),純表格',
  few_shot_examples: [
    {
      q_zh: '本月利潤中心 × 月份 × 廠區完整費用明細(含廠區中文名 / 間接員工數 / 帳號人數 / 使用人數 / 人均費用)',
      q_en: 'Full cost breakdown by PC × month × factory',
      q_vi: 'Chi phí chi tiết theo PC × tháng × nhà máy',
      sql:
        "WITH use_agg AS ( " +
        "  SELECT u.profit_center, TO_CHAR(tu.usage_date,'YYYY-MM') AS month, u.factory_code, " +
        "         COUNT(DISTINCT tu.user_id) AS user_count, SUM(tu.cost) AS total_cost " +
        "  FROM token_usage tu JOIN users u ON tu.user_id = u.id " +
        "  WHERE tu.usage_date >= TRUNC(SYSDATE, 'MM') " +
        "    AND (u.status IS NULL OR u.status != 'disabled') AND u.org_end_date IS NULL " +
        "  GROUP BY u.profit_center, TO_CHAR(tu.usage_date,'YYYY-MM'), u.factory_code " +
        "), acc_agg AS ( " +
        "  SELECT profit_center, factory_code, COUNT(*) AS account_count " +
        "  FROM users " +
        "  WHERE (status IS NULL OR status != 'disabled') AND org_end_date IS NULL " +
        "  GROUP BY profit_center, factory_code " +
        ") " +
        "SELECT us.profit_center, " +
        "       (SELECT MAX(profit_center_name) FROM users WHERE profit_center=us.profit_center) AS profit_center_name, " +
        "       (SELECT MAX(org_section)      FROM users WHERE profit_center=us.profit_center) AS org_section, " +
        "       (SELECT MAX(org_section_name) FROM users WHERE profit_center=us.profit_center) AS org_section_name, " +
        "       (SELECT MAX(org_group_name)   FROM users WHERE profit_center=us.profit_center) AS org_group_name, " +
        "       us.month, us.factory_code, fcl.name_zh AS factory_name, " +
        "       NVL(ie.emp_count, 0) AS indirect_emp_count, " +
        "       NVL(a.account_count, 0) AS account_count, " +
        "       us.user_count, us.total_cost, " +
        "       us.total_cost / NULLIF(us.user_count, 0) AS avg_cost " +
        "FROM use_agg us " +
        "LEFT JOIN acc_agg a ON a.profit_center=us.profit_center AND NVL(a.factory_code,'__NONE__')=NVL(us.factory_code,'__NONE__') " +
        "LEFT JOIN factory_code_lookup fcl ON fcl.code = us.factory_code " +
        "LEFT JOIN indirect_emp_by_pc_factory ie ON ie.profit_center = us.profit_center AND ie.factory_code = NVL(us.factory_code,'__NONE__') " +
        "ORDER BY us.month, us.total_cost DESC",
    },
  ],
  chart_config: {
    default_chart: 'bar',
    allow_table: true,
    allow_export: true,
    charts: [
      { type: 'bar', title: '月份費用趨勢',  x_field: 'month',        y_field: 'total_cost', show_label: false },
      { type: 'bar', title: '各廠區費用',    x_field: 'factory_name', y_field: 'total_cost', show_label: false },
    ],
  },
};

// Design E: Token 使用清單
const DESIGN_E = {
  name: DESIGN_E_NAME,
  description: 'Top N 使用者 Token 費用清單(對應 admin「Token 使用清單」),純表格',
  few_shot_examples: [
    {
      q_zh: '本月 Top 50 使用者費用清單(工號、姓名、部門、利潤中心、事業處、事業群、廠區、輸入/輸出 tokens、費用)',
      q_en: 'Top 50 users by cost this month',
      q_vi: 'Top 50 người dùng theo chi phí tháng này',
      sql:
        "SELECT u.employee_id, u.name, u.email, " +
        "       u.dept_code, u.dept_name, u.profit_center, u.profit_center_name, " +
        "       u.org_section, u.org_section_name, u.org_group_name, " +
        "       u.factory_code, fcl.name_zh AS factory_name, " +
        "       SUM(tu.input_tokens)  AS input_tokens, " +
        "       SUM(tu.output_tokens) AS output_tokens, " +
        "       SUM(tu.cost) AS total_cost " +
        "FROM token_usage tu JOIN users u ON tu.user_id = u.id " +
        "LEFT JOIN factory_code_lookup fcl ON u.factory_code = fcl.code " +
        "WHERE tu.usage_date >= TRUNC(SYSDATE, 'MM') " +
        "  AND (u.status IS NULL OR u.status != 'disabled') AND u.org_end_date IS NULL " +
        "GROUP BY u.employee_id, u.name, u.email, u.dept_code, u.dept_name, u.profit_center, u.profit_center_name, " +
        "         u.org_section, u.org_section_name, u.org_group_name, u.factory_code, fcl.name_zh " +
        "ORDER BY total_cost DESC " +
        "FETCH FIRST 50 ROWS ONLY",
    },
  ],
  chart_config: { default_chart: 'table', allow_table: true, allow_export: true, charts: [] },
};

const ALL_DESIGNS = [DESIGN_A, DESIGN_B, DESIGN_C, DESIGN_D, DESIGN_E];

// ── upsertDesign: 強制 force-update metadata(每次 seed 重設 5 designs) ──
async function upsertDesign(db, topicId, schemaIds, spec, adminUserId) {
  const existing = await db.prepare(
    `SELECT id FROM ai_select_designs WHERE topic_id=? AND name=?`
  ).get(topicId, spec.name);

  if (existing?.id || existing?.ID) {
    const id = existing.id || existing.ID;
    await db.prepare(
      `UPDATE ai_select_designs
         SET description=?, target_schema_ids=?, system_prompt=?,
             few_shot_examples=?, chart_config=?, share_type='none', is_suspended=0
       WHERE id=?`
    ).run(
      spec.description,
      JSON.stringify(schemaIds),
      buildSystemPrompt(),
      JSON.stringify(spec.few_shot_examples),
      JSON.stringify(spec.chart_config),
      id,
    );
    console.log(`[CostAnalysisSeed] Design 更新 id=${id} (${spec.name})`);
    return id;
  }

  await db.prepare(`
    INSERT INTO ai_select_designs
      (topic_id, name, description, target_schema_ids, vector_search_enabled,
       system_prompt, few_shot_examples, chart_config, cache_ttl_minutes,
       is_public, share_type, is_suspended, created_by)
    VALUES (?,?,?,?,0, ?, ?, ?, 15, 0, 'none', 0, ?)
  `).run(
    topicId, spec.name, spec.description, JSON.stringify(schemaIds),
    buildSystemPrompt(),
    JSON.stringify(spec.few_shot_examples),
    JSON.stringify(spec.chart_config),
    adminUserId,
  );
  const row = await db.prepare(`SELECT id FROM ai_select_designs WHERE topic_id=? AND name=?`).get(topicId, spec.name);
  const id = row?.id || row?.ID;
  console.log(`[CostAnalysisSeed] Design 建立 id=${id} (${spec.name})`);
  return id;
}

// One-time migration: 舊「各維度費用分析」rename 成 A
async function migrateOldSingleDesign(db, topicId) {
  try {
    const res = await db.prepare(
      `UPDATE ai_select_designs SET name=? WHERE topic_id=? AND name=?`
    ).run(DESIGN_A_NAME, topicId, OLD_DESIGN_NAME);
    if (res?.changes || res?.ROWSAFFECTED) {
      console.log(`[CostAnalysisSeed] 舊 design「${OLD_DESIGN_NAME}」已 rename 為「${DESIGN_A_NAME}」`);
    }
  } catch (e) {
    console.warn('[CostAnalysisSeed] rename 舊 design 失敗:', e.message);
  }
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

    const tokenUsageSchemaId    = await ensureSchema(db, TOKEN_USAGE_SCHEMA,                sourceDbId, projectId, adminUserId);
    const usersSchemaId         = await ensureSchema(db, USERS_SCHEMA,                      sourceDbId, projectId, adminUserId);
    const factoryLookupSchemaId = await ensureSchema(db, FACTORY_CODE_LOOKUP_SCHEMA,        sourceDbId, projectId, adminUserId);
    const indirectEmpSchemaId   = await ensureSchema(db, INDIRECT_EMP_BY_PC_FACTORY_SCHEMA, sourceDbId, projectId, adminUserId);

    const schemaIds = [tokenUsageSchemaId, usersSchemaId, factoryLookupSchemaId, indirectEmpSchemaId];

    // One-time migration: 舊「各維度費用分析」rename 成 A(若還沒被 rename)
    await migrateOldSingleDesign(db, topicId);

    // 強制 force-update 5 個 designs(A-E)
    for (const spec of ALL_DESIGNS) {
      await upsertDesign(db, topicId, schemaIds, spec, adminUserId);
    }
    console.log('[CostAnalysisSeed] 完成');
  } catch (e) {
    console.error('[CostAnalysisSeed] error:', e.message);
  }
}

module.exports = { runSeed };
