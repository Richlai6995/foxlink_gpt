/**
 * FOXLINK GPT — SQLite → Oracle 23 AI Migration Script
 *
 * Usage:
 *   cd server
 *   node scripts/migrate-sqlite-to-oracle.js
 *
 * Steps:
 *   1. Read all data from SQLite (system.db)
 *   2. Create Oracle tables (idempotent, skips existing)
 *   3. Insert all rows preserving original IDs (OVERRIDING SYSTEM VALUE)
 *   4. Print row-count comparison for verification
 *
 * Safe to re-run — existing Oracle rows are skipped (INSERT via MERGE).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');

// ─── Load SQLite ──────────────────────────────────────────────────────────────
async function loadSqlite() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, '../system.db');

  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite DB not found: ${dbPath}`);
  }
  const buf = fs.readFileSync(dbPath);
  const db  = new SQL.Database(buf);
  console.log(`[SQLite] Loaded: ${dbPath}`);
  return db;
}

// ─── SQLite helpers ───────────────────────────────────────────────────────────
function sqliteAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function tableExists(db, name) {
  const res = sqliteAll(db, `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]);
  return res.length > 0;
}

// ─── Oracle helpers ───────────────────────────────────────────────────────────
const oracledb = require('oracledb');
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];

async function createOraclePool() {
  if (process.env.ORACLE_HOME) {
    try {
      oracledb.initOracleClient({ libDir: process.env.ORACLE_HOME });
    } catch (e) {
      if (!e.message?.includes('already been called')) console.warn('[Oracle]', e.message);
    }
  }
  return oracledb.createPool({
    user:          process.env.SYSTEM_DB_USER,
    password:      process.env.SYSTEM_DB_USER_PASSWORD,
    connectString: `${process.env.SYSTEM_DB_HOST}:${process.env.SYSTEM_DB_PORT}/${process.env.SYSTEM_DB_SERVICE_NAME}`,
    poolMin: 1, poolMax: 5, poolIncrement: 1,
  });
}

async function oracleExec(pool, sql, params = []) {
  const conn = await pool.getConnection();
  try {
    return await conn.execute(sql, params, { autoCommit: true });
  } finally {
    await conn.close();
  }
}

async function oracleExecDDL(pool, sql) {
  try {
    await oracleExec(pool, sql);
  } catch (e) {
    if (e.errorNum === 955 || e.errorNum === 1408) return; // already exists
    throw e;
  }
}

async function oracleCount(pool, table) {
  const conn = await pool.getConnection();
  try {
    const r = await conn.execute(`SELECT COUNT(*) AS cnt FROM ${table}`, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    return r.rows?.[0]?.CNT ?? 0;
  } finally {
    await conn.close();
  }
}

// Convert SQLite TEXT date → JS Date (Oracle accepts Date objects)
function toDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Schema init from SQL file ────────────────────────────────────────────────
async function initSchema(pool) {
  console.log('\n[Schema] Creating Oracle tables (idempotent)...');
  const sqlFile = path.join(__dirname, 'create-schema.sql');
  const raw = fs.readFileSync(sqlFile, 'utf8');

  // Split on PL/SQL block boundaries (END;\n/)
  const blocks = raw
    .split(/(?<=END;\s*\n\s*)\/\s*\n?/)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const block of blocks) {
    if (!block || block.startsWith('--')) continue;
    try {
      await oracleExec(pool, block);
    } catch (e) {
      if (e.errorNum === 955 || e.errorNum === 1408 || e.errorNum === 1430) continue;
      console.error('[Schema] Error in block:\n', block.slice(0, 120));
      console.error('[Schema]', e.message);
    }
  }
  console.log('[Schema] Done.');
}

// ─── Migration helpers ────────────────────────────────────────────────────────

/**
 * MERGE-based upsert: insert only if PK not exists.
 * keyCol = primary key column name in Oracle.
 */
async function mergeInsert(pool, table, cols, rows, keyCol = 'id') {
  if (!rows.length) return 0;
  let inserted = 0;
  const conn = await pool.getConnection();
  try {
    for (const row of rows) {
      const vals = cols.map((c) => row[c] ?? null);
      const bindNames = cols.map((_, i) => `:${i + 1}`);
      const setClauses = cols.filter((c) => c !== keyCol).map((c, i) => {
        const bindIdx = cols.indexOf(c) + 1;
        return `t.${c} = s.${c}`;
      });
      // Simple INSERT ... WHERE NOT EXISTS approach
      const placeholders = cols.map((_, i) => `:${i + 1}`).join(', ');
      const sql = `
        INSERT INTO ${table} (${cols.join(', ')})
        OVERRIDING SYSTEM VALUE
        SELECT ${bindNames.join(', ')} FROM DUAL
        WHERE NOT EXISTS (
          SELECT 1 FROM ${table} WHERE ${keyCol} = :${cols.indexOf(keyCol) + 1}
        )`;
      const result = await conn.execute(sql, vals, { autoCommit: true });
      inserted += result.rowsAffected || 0;
    }
  } finally {
    await conn.close();
  }
  return inserted;
}

// ─── Table migration definitions ──────────────────────────────────────────────
async function migrateTable(pool, sqliteDb, config) {
  const { table, oracleTable, cols, transform } = config;
  const oraTable = oracleTable || table.toUpperCase();

  if (!tableExists(sqliteDb, table)) {
    console.log(`  [skip] ${table} — not in SQLite`);
    return;
  }

  const rows = sqliteAll(sqliteDb, `SELECT * FROM ${table}`);
  if (!rows.length) {
    console.log(`  [skip] ${table} — 0 rows`);
    return;
  }

  const transformed = rows.map((r) => (transform ? transform(r) : r));
  const inserted = await mergeInsert(pool, oraTable, cols, transformed);
  const oraCount = await oracleCount(pool, oraTable);
  console.log(`  ${table.padEnd(28)} SQLite: ${rows.length.toString().padStart(6)}  Oracle: ${oraCount.toString().padStart(6)}  Inserted: ${inserted}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== FOXLINK GPT: SQLite → Oracle Migration ===\n');

  const sqliteDb = await loadSqlite();
  const pool     = await createOraclePool();
  console.log('[Oracle] Pool ready');

  await initSchema(pool);

  console.log('\n[Migration] Migrating tables...');

  // Order matters: parent tables before child tables

  // roles
  await migrateTable(pool, sqliteDb, {
    table: 'roles',
    cols: ['id','name','description','is_default',
           'allow_text_upload','text_max_mb','allow_audio_upload','audio_max_mb',
           'allow_image_upload','image_max_mb','allow_scheduled_tasks',
           'allow_create_skill','allow_external_skill','allow_code_skill',
           'budget_daily','budget_weekly','budget_monthly','created_at','updated_at'],
    transform: (r) => ({ ...r,
      created_at: toDate(r.created_at),
      updated_at: toDate(r.updated_at),
    }),
  });

  // users
  await migrateTable(pool, sqliteDb, {
    table: 'users',
    cols: ['id','username','password','role','role_id','name','email','employee_id',
           'status','start_date','end_date','creation_method',
           'allow_text_upload','text_max_mb','allow_audio_upload','audio_max_mb',
           'allow_image_upload','image_max_mb','allow_scheduled_tasks',
           'allow_create_skill','allow_external_skill','allow_code_skill',
           'budget_daily','budget_weekly','budget_monthly',
           'dept_code','dept_name','profit_center','profit_center_name',
           'org_section','org_section_name','org_group_name','factory_code',
           'org_end_date','org_synced_at','created_at','updated_at'],
    transform: (r) => ({ ...r,
      start_date:   toDate(r.start_date),
      end_date:     toDate(r.end_date),
      org_end_date: toDate(r.org_end_date),
      org_synced_at: toDate(r.org_synced_at),
      created_at:   toDate(r.created_at),
      updated_at:   toDate(r.updated_at),
    }),
  });

  // llm_models
  await migrateTable(pool, sqliteDb, {
    table: 'llm_models',
    cols: ['id','key','name','api_model','description','is_active','sort_order','image_output','created_at'],
    transform: (r) => ({ ...r, created_at: toDate(r.created_at) }),
  });

  // system_settings
  await migrateTable(pool, sqliteDb, {
    table: 'system_settings',
    cols: ['key','value'],
    transform: (r) => r,
  });

  // sensitive_keywords
  await migrateTable(pool, sqliteDb, {
    table: 'sensitive_keywords',
    cols: ['id','keyword','created_at'],
    transform: (r) => ({ ...r, created_at: toDate(r.created_at) }),
  });

  // token_prices
  await migrateTable(pool, sqliteDb, {
    table: 'token_prices',
    cols: ['id','model','price_input','price_output','tier_threshold',
           'price_input_tier2','price_output_tier2','price_image_output',
           'currency','start_date','end_date','created_at'],
    transform: (r) => ({ ...r,
      start_date: toDate(r.start_date),
      end_date:   toDate(r.end_date),
      created_at: toDate(r.created_at),
    }),
  });

  // org_cache
  await migrateTable(pool, sqliteDb, {
    table: 'org_cache',
    cols: ['employee_no','c_name','email','dept_code','dept_name','profit_center',
           'profit_center_name','org_section','org_section_name','org_group_name',
           'factory_code','end_date','cached_at'],
    transform: (r) => ({ ...r,
      end_date:  toDate(r.end_date),
      cached_at: toDate(r.cached_at),
    }),
  });

  // mcp_servers
  await migrateTable(pool, sqliteDb, {
    table: 'mcp_servers',
    cols: ['id','name','url','api_key','description','is_active','tools_json',
           'last_synced_at','created_at','updated_at'],
    transform: (r) => ({ ...r,
      last_synced_at: toDate(r.last_synced_at),
      created_at: toDate(r.created_at),
      updated_at: toDate(r.updated_at),
    }),
  });

  // dify_knowledge_bases
  await migrateTable(pool, sqliteDb, {
    table: 'dify_knowledge_bases',
    cols: ['id','name','api_server','api_key','description','is_active','sort_order','created_at','updated_at'],
    transform: (r) => ({ ...r,
      created_at: toDate(r.created_at),
      updated_at: toDate(r.updated_at),
    }),
  });

  // role_mcp_servers
  await migrateTable(pool, sqliteDb, {
    table: 'role_mcp_servers',
    cols: ['role_id','mcp_server_id'],
  });

  // role_dify_kbs
  await migrateTable(pool, sqliteDb, {
    table: 'role_dify_kbs',
    cols: ['role_id','dify_kb_id'],
  });

  // chat_sessions
  await migrateTable(pool, sqliteDb, {
    table: 'chat_sessions',
    cols: ['id','user_id','title','model','source','created_at','updated_at'],
    transform: (r) => ({ ...r,
      created_at: toDate(r.created_at),
      updated_at: toDate(r.updated_at),
    }),
  });

  // chat_messages
  await migrateTable(pool, sqliteDb, {
    table: 'chat_messages',
    cols: ['id','session_id','role','content','files_json',
           'input_tokens','output_tokens','created_at'],
    transform: (r) => ({ ...r, created_at: toDate(r.created_at) }),
  });

  // token_usage (Oracle uses usage_date instead of date — reserved word)
  await migrateTable(pool, sqliteDb, {
    table: 'token_usage',
    cols: ['id','user_id','usage_date','model','input_tokens','output_tokens',
           'image_count','cost','currency'],
    transform: (r) => ({ ...r, usage_date: toDate(r.date) }),
  });

  // audit_logs
  await migrateTable(pool, sqliteDb, {
    table: 'audit_logs',
    cols: ['id','user_id','session_id','content','has_sensitive',
           'sensitive_keywords','notified','created_at'],
    transform: (r) => ({ ...r, created_at: toDate(r.created_at) }),
  });

  // password_reset_tokens
  await migrateTable(pool, sqliteDb, {
    table: 'password_reset_tokens',
    cols: ['id','user_id','token','expires_at','used','created_at'],
    transform: (r) => ({ ...r,
      expires_at: toDate(r.expires_at),
      created_at: toDate(r.created_at),
    }),
  });

  // scheduled_tasks
  await migrateTable(pool, sqliteDb, {
    table: 'scheduled_tasks',
    cols: ['id','user_id','name','schedule_type','schedule_hour','schedule_minute',
           'schedule_weekday','schedule_monthday','model','prompt','output_type',
           'file_type','filename_template','recipients_json','email_subject','email_body',
           'status','expire_at','max_runs','run_count','last_run_at','last_run_status',
           'created_at','updated_at'],
    transform: (r) => ({ ...r,
      expire_at:   toDate(r.expire_at),
      last_run_at: toDate(r.last_run_at),
      created_at:  toDate(r.created_at),
      updated_at:  toDate(r.updated_at),
    }),
  });

  // scheduled_task_runs
  await migrateTable(pool, sqliteDb, {
    table: 'scheduled_task_runs',
    cols: ['id','task_id','run_at','status','attempt','session_id',
           'response_preview','generated_files_json','email_sent_to',
           'error_msg','duration_ms'],
    transform: (r) => ({ ...r, run_at: toDate(r.run_at) }),
  });

  // share_snapshots
  await migrateTable(pool, sqliteDb, {
    table: 'share_snapshots',
    cols: ['id','created_by','session_id','title','model','messages_json','created_at'],
    transform: (r) => ({ ...r, created_at: toDate(r.created_at) }),
  });

  // skills
  await migrateTable(pool, sqliteDb, {
    table: 'skills',
    cols: ['id','name','description','icon','type','system_prompt',
           'endpoint_url','endpoint_secret','endpoint_mode','model_key',
           'mcp_tool_mode','mcp_tool_ids','dify_kb_ids','tags',
           'code_snippet','code_packages','code_status','code_port','code_pid','code_error',
           'owner_user_id','is_public','is_admin_approved','pending_approval',
           'created_at','updated_at'],
    transform: (r) => ({ ...r,
      created_at: toDate(r.created_at),
      updated_at: toDate(r.updated_at),
    }),
  });

  // session_skills
  await migrateTable(pool, sqliteDb, {
    table: 'session_skills',
    cols: ['session_id','skill_id','sort_order'],
  });

  // mcp_call_logs
  await migrateTable(pool, sqliteDb, {
    table: 'mcp_call_logs',
    cols: ['id','server_id','session_id','user_id','tool_name','arguments_json',
           'response_preview','status','error_msg','duration_ms','called_at'],
    transform: (r) => ({ ...r, called_at: toDate(r.called_at) }),
  });

  // dify_call_logs
  await migrateTable(pool, sqliteDb, {
    table: 'dify_call_logs',
    cols: ['id','kb_id','session_id','user_id','query_preview','response_preview',
           'status','error_msg','duration_ms','called_at'],
    transform: (r) => ({ ...r, called_at: toDate(r.called_at) }),
  });

  console.log('\n=== Migration Complete ===');
  await pool.close();
  sqliteDb.close();
}

main().catch((e) => {
  console.error('\n[FATAL]', e);
  process.exit(1);
});
