'use strict';
/**
 * AI 戰情自動註冊
 *
 * 當 admin 在「Pipeline 可寫表」核准新表 + 勾選「同步註冊」,
 * 自動建立:
 *   - ai_db_sources(沿用既有「FOXLINK GPT 本地 Oracle」)
 *   - ai_select_projects「Pipeline 自動落地」(若不存在則建)
 *   - ai_select_topics「使用者自訂表」
 *   - ai_schema_definitions(target table)
 *   - ai_schema_columns(從 column_metadata 帶)
 *   - 1-2 個預設 Design(若 table 有 *_date / as_of_date 等欄位則建)
 */

const { encryptPassword } = require('../utils/dbCrypto');

const LOCAL_DB_SOURCE_NAME = 'FOXLINK GPT 本地 Oracle';
const DEFAULT_PROJECT_NAME = 'Pipeline 自動落地';
const DEFAULT_TOPIC_NAME   = '使用者自訂表';

async function ensureLocalDbSource(db) {
  const existing = await db.prepare(`SELECT id FROM ai_db_sources WHERE name=?`).get(LOCAL_DB_SOURCE_NAME);
  if (existing) return existing.id || existing.ID;

  const host = process.env.SYSTEM_DB_HOST;
  const port = Number(process.env.SYSTEM_DB_PORT || 1521);
  const svc  = process.env.SYSTEM_DB_SERVICE_NAME;
  const user = process.env.SYSTEM_DB_USER;
  const pwd  = process.env.SYSTEM_DB_USER_PASSWORD;
  if (!host || !svc || !user || !pwd) {
    console.warn('[AiSchemaAutoRegister] SYSTEM_DB_* env 未完整,跳過');
    return null;
  }
  await db.prepare(`
    INSERT INTO ai_db_sources
      (name, db_type, host, port, service_name, username, password_enc, is_default, is_active, pool_min, pool_max, pool_timeout)
    VALUES (?,?,?,?,?,?,?,0,1,1,5,60)
  `).run(LOCAL_DB_SOURCE_NAME, 'oracle', host, port, svc, user, encryptPassword(pwd));
  const row = await db.prepare(`SELECT id FROM ai_db_sources WHERE name=?`).get(LOCAL_DB_SOURCE_NAME);
  return row?.id || row?.ID;
}

async function ensureProject(db, adminUserId) {
  const existing = await db.prepare(
    `SELECT id FROM ai_select_projects WHERE name=? ORDER BY id ASC FETCH FIRST 1 ROWS ONLY`
  ).get(DEFAULT_PROJECT_NAME);
  if (existing) return existing.id || existing.ID;

  await db.prepare(`
    INSERT INTO ai_select_projects (name, description, is_public, is_suspended, created_by)
    VALUES (?,?,0,0,?)
  `).run(
    DEFAULT_PROJECT_NAME,
    'Pipeline 自動落地的資料表。每核准一張新表勾選「同步註冊」就會出現在這裡。預設僅 admin 可見,需透過 DesignerPanel 分享。',
    adminUserId,
  );
  const row = await db.prepare(`SELECT id FROM ai_select_projects WHERE name=? ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`).get(DEFAULT_PROJECT_NAME);
  return row?.id || row?.ID;
}

async function ensureTopic(db, projectId, adminUserId) {
  const existing = await db.prepare(
    `SELECT id FROM ai_select_topics WHERE name=? AND project_id=? ORDER BY id ASC FETCH FIRST 1 ROWS ONLY`
  ).get(DEFAULT_TOPIC_NAME, projectId);
  if (existing) return existing.id || existing.ID;

  await db.prepare(`
    INSERT INTO ai_select_topics (name, description, icon, sort_order, is_active, created_by, project_id)
    VALUES (?,?,?,0,1,?,?)
  `).run(
    DEFAULT_TOPIC_NAME,
    'Admin 透過 Pipeline 可寫表自動註冊的 schema',
    'database',
    adminUserId,
    projectId,
  );
  const row = await db.prepare(`SELECT id FROM ai_select_topics WHERE name=? AND project_id=? ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`).get(DEFAULT_TOPIC_NAME, projectId);
  return row?.id || row?.ID;
}

async function syncSchemaColumns(db, schemaId, columnMetadata) {
  const existing = await db.prepare(
    `SELECT id, column_name FROM ai_schema_columns WHERE schema_id=?`
  ).all(schemaId);
  const existingMap = new Map(
    (existing || []).map(c => [String(c.column_name || c.COLUMN_NAME).toLowerCase(), c.id || c.ID])
  );

  let inserted = 0, updated = 0;
  for (const col of columnMetadata) {
    const colKey = col.name.toLowerCase();
    const dataType = col.type || 'VARCHAR2';
    const description = col.description || autoDescribe(col.name);
    if (existingMap.has(colKey)) {
      await db.prepare(
        `UPDATE ai_schema_columns SET data_type=?, description=? WHERE id=?`
      ).run(dataType, description, existingMap.get(colKey));
      updated++;
    } else {
      await db.prepare(
        `INSERT INTO ai_schema_columns
          (schema_id, column_name, data_type, description, is_visible, is_vectorized)
         VALUES (?, ?, ?, ?, 1, 0)`
      ).run(schemaId, col.name, dataType, description);
      inserted++;
    }
  }
  return { inserted, updated };
}

// 從欄位名生通用描述(中文 hints)
function autoDescribe(name) {
  const n = name.toLowerCase();
  if (n === 'id') return '主鍵 ID';
  if (n.endsWith('_date') || n.endsWith('_at') || n === 'creation_date') return '日期/時間欄位';
  if (n.includes('price') || n.includes('amount') || n.includes('cost')) return '金額/數值';
  if (n.includes('count') || n.includes('quantity')) return '數量';
  if (n.includes('rate') || n.includes('pct') || n.endsWith('_ratio')) return '比率/百分比';
  if (n.includes('email')) return 'Email';
  if (n.includes('url')) return 'URL 連結';
  if (n.includes('name')) return '名稱';
  if (n.includes('code')) return '代碼';
  if (n.includes('description') || n.includes('summary') || n.includes('content') || n === 'note') return '描述/說明';
  if (n.startsWith('meta_')) return 'Pipeline 血緣 metadata';
  if (n.includes('user_id')) return '使用者 ID';
  return name;
}

async function ensureSchema(db, tableName, displayName, description, columnMetadata, sourceDbId, projectId, adminUserId) {
  const existing = await db.prepare(
    `SELECT id FROM ai_schema_definitions WHERE table_name=? AND source_db_id=?`
  ).get(tableName, sourceDbId);
  let schemaId;
  if (existing) {
    schemaId = existing.id || existing.ID;
    await db.prepare(
      `UPDATE ai_schema_definitions SET display_name=?, business_notes=? WHERE id=?`
    ).run(displayName, description, schemaId);
  } else {
    await db.prepare(`
      INSERT INTO ai_schema_definitions
        (table_name, display_name, alias, db_connection, source_db_id, source_type, business_notes,
         is_active, project_id, created_by)
      VALUES (?,?,?, 'system', ?, 'table', ?, 1, ?, ?)
    `).run(tableName, displayName, tableName, sourceDbId, description, projectId, adminUserId);
    const row = await db.prepare(
      `SELECT id FROM ai_schema_definitions WHERE table_name=? AND source_db_id=?`
    ).get(tableName, sourceDbId);
    schemaId = row?.id || row?.ID;
  }
  await syncSchemaColumns(db, schemaId, columnMetadata);
  return schemaId;
}

async function ensureDefaultDesigns(db, topicId, schemaId, tableName, columnMetadata, adminUserId) {
  // 偵測是否有時間欄位 → 決定要不要建「30 天趨勢」design
  const dateCol = columnMetadata.find(c =>
    /(^|_)(date|at|day)$/i.test(c.name) || c.name === 'as_of_date' || c.name === 'creation_date'
  );

  // Design 1: Today snapshot(若有時間欄)/ All rows(若沒)
  const designTodayName = dateCol ? `${tableName} — 最新一筆` : `${tableName} — 全表瀏覽`;
  const designTodaySql = dateCol
    ? `SELECT * FROM ${tableName} WHERE ${dateCol.name} = (SELECT MAX(${dateCol.name}) FROM ${tableName}) FETCH FIRST 100 ROWS ONLY`
    : `SELECT * FROM ${tableName} ORDER BY id DESC FETCH FIRST 100 ROWS ONLY`;
  await upsertDesign(db, topicId, [schemaId], {
    name: designTodayName,
    description: `自動產生的 ${tableName} 預設 Design`,
    chart_config: { default_chart: 'table', allow_table: true, allow_export: true, charts: [] },
    few_shot_examples: [{
      q_zh: dateCol ? '看最新資料' : '全部資料',
      sql: designTodaySql,
    }],
  }, adminUserId);

  // Design 2: 30 天趨勢(只有 date col 才建)
  if (dateCol) {
    // 找第一個 NUMBER 欄位當 Y 軸
    const valueCol = columnMetadata.find(c =>
      /^(NUMBER|FLOAT|INTEGER)/i.test(c.type || '') &&
      !['id', dateCol.name, 'meta_run_id'].includes(c.name) &&
      !c.name.startsWith('meta_')
    );
    if (valueCol) {
      await upsertDesign(db, topicId, [schemaId], {
        name: `${tableName} — 近 30 天趨勢`,
        description: `自動產生的 ${tableName} 30 天趨勢圖`,
        chart_config: {
          default_chart: 'line',
          allow_table: true, allow_export: true,
          charts: [{ type: 'line', title: '近 30 天趨勢', x_field: dateCol.name, y_field: valueCol.name }],
        },
        few_shot_examples: [{
          q_zh: '近 30 天的趨勢',
          sql: `SELECT ${dateCol.name}, ${valueCol.name} FROM ${tableName} WHERE ${dateCol.name} >= SYSDATE - 30 ORDER BY ${dateCol.name}`,
        }],
      }, adminUserId);
    }
  }
}

async function upsertDesign(db, topicId, schemaIds, spec, adminUserId) {
  const existing = await db.prepare(
    `SELECT id FROM ai_select_designs WHERE topic_id=? AND name=? ORDER BY id ASC FETCH FIRST 1 ROWS ONLY`
  ).get(topicId, spec.name);
  if (existing) return existing.id || existing.ID;

  await db.prepare(`
    INSERT INTO ai_select_designs
      (topic_id, name, description, target_schema_ids, vector_search_enabled,
       system_prompt, few_shot_examples, chart_config, cache_ttl_minutes,
       is_public, share_type, is_suspended, created_by)
    VALUES (?,?,?,?,0, ?, ?, ?, 15, 0, 'none', 0, ?)
  `).run(
    topicId, spec.name, spec.description, JSON.stringify(schemaIds),
    '你是一個 SQL 產生器,只能產 SELECT,不能 INSERT/UPDATE/DELETE/DDL。回傳前加適當 ORDER BY 與 FETCH FIRST。',
    JSON.stringify(spec.few_shot_examples),
    JSON.stringify(spec.chart_config),
    adminUserId,
  );
  const row = await db.prepare(`SELECT id FROM ai_select_designs WHERE topic_id=? AND name=? ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`).get(topicId, spec.name);
  return row?.id || row?.ID;
}

/**
 * 主入口:接受白名單 entry 的資訊 → 自動建 schema + designs
 */
async function autoRegisterTable(db, opts) {
  const { tableName, displayName, description, columnMetadata, adminUserId } = opts;
  if (!tableName || !columnMetadata || !columnMetadata.length) {
    console.warn('[AiSchemaAutoRegister] missing tableName/columnMetadata');
    return null;
  }

  try {
    const sourceDbId = await ensureLocalDbSource(db);
    if (!sourceDbId) return null;

    const projectId = await ensureProject(db, adminUserId);
    const topicId   = await ensureTopic(db, projectId, adminUserId);
    const schemaId  = await ensureSchema(db, tableName, displayName, description, columnMetadata, sourceDbId, projectId, adminUserId);
    await ensureDefaultDesigns(db, topicId, schemaId, tableName, columnMetadata, adminUserId);
    console.log(`[AiSchemaAutoRegister] ${tableName} → schemaId=${schemaId} (project=${projectId}, topic=${topicId})`);
    return { schemaId, projectId, topicId };
  } catch (e) {
    console.error('[AiSchemaAutoRegister] error:', e.message);
    return null;
  }
}

module.exports = { autoRegisterTable };
