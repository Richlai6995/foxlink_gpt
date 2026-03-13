require('dotenv').config();
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'system.db');

let dbInstance = null;
let SQL = null;

function saveDB() {
  if (!dbInstance) return;
  try {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    const tempPath = DB_PATH + '.tmp';
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, DB_PATH);
  } catch (e) {
    console.error('Failed to save DB atomically:', e);
  }
}

class DatabaseWrapper {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    const stmt = this.db.prepare(sql);
    return new StatementWrapper(this.db, stmt);
  }

  exec(sql) {
    this.db.exec(sql);
    saveDB();
  }
}

class StatementWrapper {
  constructor(db, stmt) {
    this.db = db;
    this.stmt = stmt;
  }

  run(...params) {
    try {
      let bindParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      bindParams = bindParams.map((p) => (p === undefined ? null : p));
      this.stmt.run(bindParams);

      let lastId = 0;
      try {
        const res = this.db.exec('SELECT last_insert_rowid() as id');
        if (res[0] && res[0].values && res[0].values[0]) {
          lastId = res[0].values[0][0];
        }
      } catch (e) {
        console.warn('Failed to retrieve lastInsertRowid', e);
      }

      saveDB();
      const validChanges = this.db.getRowsModified();
      return { lastInsertRowid: lastId, changes: validChanges };
    } finally {
      this.stmt.free();
    }
  }

  get(...params) {
    const bindParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    this.stmt.bind(bindParams);
    let result = null;
    if (this.stmt.step()) {
      result = this.stmt.getAsObject();
    }
    this.stmt.free();
    return result;
  }

  all(...params) {
    const bindParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    this.stmt.bind(bindParams);
    const results = [];
    while (this.stmt.step()) {
      results.push(this.stmt.getAsObject());
    }
    this.stmt.free();
    return results;
  }
}

function initSchema(db) {
  // Users - only admin/user roles, no group_id/project_root
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'user',
    name TEXT,
    email TEXT,
    employee_id TEXT,
    status TEXT DEFAULT 'inactive',
    start_date TEXT,
    end_date TEXT
  )`);

  // Chat Sessions
  db.exec(`CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT DEFAULT '新對話',
    model TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Chat Messages
  db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT,
    files_json TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
  )`);

  // Token Usage (one row per user/date/model, upserted)
  db.exec(`CREATE TABLE IF NOT EXISTS token_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    UNIQUE(user_id, date, model)
  )`);

  // Audit Logs
  db.exec(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    session_id TEXT,
    content TEXT,
    has_sensitive INTEGER DEFAULT 0,
    sensitive_keywords TEXT,
    notified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Sensitive Keywords
  db.exec(`CREATE TABLE IF NOT EXISTS sensitive_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Token Prices (per model / date range, supports two-tier pricing)
  db.exec(`CREATE TABLE IF NOT EXISTS token_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model TEXT NOT NULL,
    price_input REAL NOT NULL DEFAULT 0,
    price_output REAL NOT NULL DEFAULT 0,
    tier_threshold INTEGER,
    price_input_tier2 REAL,
    price_output_tier2 REAL,
    currency TEXT NOT NULL DEFAULT 'USD',
    start_date TEXT NOT NULL,
    end_date TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Migration: add tier columns to existing token_prices table
  const tokenPriceCols = db.prepare('PRAGMA table_info(token_prices)').all().map((r) => r.name);
  if (!tokenPriceCols.includes('tier_threshold')) {
    db.exec('ALTER TABLE token_prices ADD COLUMN tier_threshold INTEGER');
    db.exec('ALTER TABLE token_prices ADD COLUMN price_input_tier2 REAL');
    db.exec('ALTER TABLE token_prices ADD COLUMN price_output_tier2 REAL');
  }
  if (!tokenPriceCols.includes('price_image_output')) {
    db.exec('ALTER TABLE token_prices ADD COLUMN price_image_output REAL');
  }

  // Migration: add image_count / cost / currency to token_usage
  const tokenUsageCols = db.prepare('PRAGMA table_info(token_usage)').all().map((r) => r.name);
  if (!tokenUsageCols.includes('image_count')) {
    db.exec('ALTER TABLE token_usage ADD COLUMN image_count INTEGER DEFAULT 0');
  }
  if (!tokenUsageCols.includes('cost')) {
    db.exec('ALTER TABLE token_usage ADD COLUMN cost REAL');
  }
  if (!tokenUsageCols.includes('currency')) {
    db.exec('ALTER TABLE token_usage ADD COLUMN currency TEXT');
  }

  // LLM Models (configurable AI model registry)
  db.exec(`CREATE TABLE IF NOT EXISTS llm_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    api_model TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    image_output INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Migration: add image_output to existing llm_models table
  const llmCols = db.prepare('PRAGMA table_info(llm_models)').all().map((r) => r.name);
  if (!llmCols.includes('image_output')) {
    db.exec('ALTER TABLE llm_models ADD COLUMN image_output INTEGER DEFAULT 0');
  }

  // Seed default LLM models from env
  const proExists = db.prepare("SELECT id FROM llm_models WHERE key='pro'").get();
  if (!proExists) {
    db.prepare(
      `INSERT INTO llm_models (key, name, api_model, description, is_active, sort_order) VALUES (?, ?, ?, ?, 1, 0)`
    ).run('pro', 'Gemini Pro', process.env.GEMINI_MODEL_PRO || 'gemini-3-pro-preview', '強大、深度分析');
  }
  const flashExists = db.prepare("SELECT id FROM llm_models WHERE key='flash'").get();
  if (!flashExists) {
    db.prepare(
      `INSERT INTO llm_models (key, name, api_model, description, is_active, sort_order) VALUES (?, ?, ?, ?, 1, 1)`
    ).run('flash', 'Gemini Flash', process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview', '快速、輕量回應');
  }

  // System Settings
  db.exec(`CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // Migration: upload permissions
  const userCols = db.prepare(`PRAGMA table_info(users)`).all().map(r => r.name);
  if (!userCols.includes('allow_text_upload')) {
    db.exec(`ALTER TABLE users ADD COLUMN allow_text_upload INTEGER DEFAULT 1`);
  }
  if (!userCols.includes('text_max_mb')) {
    db.exec(`ALTER TABLE users ADD COLUMN text_max_mb INTEGER DEFAULT 10`);
  }

  if (!userCols.includes('allow_audio_upload')) {
    db.exec(`ALTER TABLE users ADD COLUMN allow_audio_upload INTEGER DEFAULT 0`);
  }
  if (!userCols.includes('audio_max_mb')) {
    db.exec(`ALTER TABLE users ADD COLUMN audio_max_mb INTEGER DEFAULT 10`);
  }
  if (!userCols.includes('allow_image_upload')) {
    db.exec(`ALTER TABLE users ADD COLUMN allow_image_upload INTEGER DEFAULT 1`);
  }
  if (!userCols.includes('image_max_mb')) {
    db.exec(`ALTER TABLE users ADD COLUMN image_max_mb INTEGER DEFAULT 10`);
  }

  // Org cache (Oracle ERP employee org hierarchy, refreshed on demand or daily)
  db.exec(`CREATE TABLE IF NOT EXISTS org_cache (
    employee_no TEXT PRIMARY KEY,
    c_name TEXT,
    email TEXT,
    dept_code TEXT,
    dept_name TEXT,
    profit_center TEXT,
    profit_center_name TEXT,
    org_section TEXT,
    org_section_name TEXT,
    org_group_name TEXT,
    factory_code TEXT,
    end_date TEXT,
    cached_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Migration: add source to chat_sessions (manual | scheduled)
  const sessionCols = db.prepare('PRAGMA table_info(chat_sessions)').all().map((r) => r.name);
  if (!sessionCols.includes('source')) {
    db.exec(`ALTER TABLE chat_sessions ADD COLUMN source TEXT DEFAULT 'manual'`);
  }

  // Migration: allow_scheduled_tasks + creation_method on users
  const userCols2 = db.prepare('PRAGMA table_info(users)').all().map((r) => r.name);
  if (!userCols2.includes('allow_scheduled_tasks')) {
    db.exec(`ALTER TABLE users ADD COLUMN allow_scheduled_tasks INTEGER DEFAULT 0`);
  }
  if (!userCols2.includes('creation_method')) {
    db.exec(`ALTER TABLE users ADD COLUMN creation_method TEXT DEFAULT 'manual'`);
  }

  // Unique index on employee_id (skip NULLs so manual accounts without employee_id are OK)
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_id ON users (employee_id) WHERE employee_id IS NOT NULL`);
  } catch (e) {
    console.warn('[DB] Could not create unique index on employee_id:', e.message);
  }

  // Password Reset Tokens (for manual accounts)
  db.exec(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Scheduled Tasks
  db.exec(`CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    schedule_type TEXT NOT NULL DEFAULT 'daily',
    schedule_hour INTEGER NOT NULL DEFAULT 8,
    schedule_minute INTEGER NOT NULL DEFAULT 0,
    schedule_weekday INTEGER DEFAULT 1,
    schedule_monthday INTEGER DEFAULT 1,
    model TEXT NOT NULL DEFAULT 'pro',
    prompt TEXT NOT NULL,
    output_type TEXT NOT NULL DEFAULT 'text',
    file_type TEXT,
    filename_template TEXT,
    recipients_json TEXT DEFAULT '[]',
    email_subject TEXT,
    email_body TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    expire_at TEXT,
    max_runs INTEGER DEFAULT 0,
    run_count INTEGER DEFAULT 0,
    last_run_at TEXT,
    last_run_status TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Scheduled Task Runs (history)
  db.exec(`CREATE TABLE IF NOT EXISTS scheduled_task_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    run_at TEXT DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'ok',
    attempt INTEGER DEFAULT 1,
    session_id TEXT,
    response_preview TEXT,
    generated_files_json TEXT DEFAULT '[]',
    email_sent_to TEXT,
    error_msg TEXT,
    duration_ms INTEGER,
    FOREIGN KEY(task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
  )`);

  // MCP Servers
  db.exec(`CREATE TABLE IF NOT EXISTS mcp_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    api_key TEXT,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    tools_json TEXT,
    last_synced_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // MCP Call Logs
  db.exec(`CREATE TABLE IF NOT EXISTS mcp_call_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    session_id TEXT,
    user_id INTEGER,
    tool_name TEXT NOT NULL,
    arguments_json TEXT,
    response_preview TEXT,
    status TEXT DEFAULT 'ok',
    error_msg TEXT,
    duration_ms INTEGER,
    called_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
  )`);

  // DIFY Knowledge Bases
  db.exec(`CREATE TABLE IF NOT EXISTS dify_knowledge_bases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    api_server TEXT NOT NULL,
    api_key TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // DIFY Call Logs
  db.exec(`CREATE TABLE IF NOT EXISTS dify_call_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kb_id INTEGER NOT NULL,
    session_id TEXT,
    user_id INTEGER,
    query_preview TEXT,
    response_preview TEXT,
    status TEXT DEFAULT 'ok',
    error_msg TEXT,
    duration_ms INTEGER,
    called_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(kb_id) REFERENCES dify_knowledge_bases(id) ON DELETE CASCADE
  )`);

  // Roles (permission profiles for users)
  db.exec(`CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Role ↔ MCP Server mapping
  db.exec(`CREATE TABLE IF NOT EXISTS role_mcp_servers (
    role_id INTEGER NOT NULL,
    mcp_server_id INTEGER NOT NULL,
    PRIMARY KEY (role_id, mcp_server_id),
    FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY(mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
  )`);

  // Role ↔ DIFY Knowledge Base mapping
  db.exec(`CREATE TABLE IF NOT EXISTS role_dify_kbs (
    role_id INTEGER NOT NULL,
    dify_kb_id INTEGER NOT NULL,
    PRIMARY KEY (role_id, dify_kb_id),
    FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY(dify_kb_id) REFERENCES dify_knowledge_bases(id) ON DELETE CASCADE
  )`);

  // Migration: add role_id to users
  const userColsRole = db.prepare('PRAGMA table_info(users)').all().map((r) => r.name);
  if (!userColsRole.includes('role_id')) {
    db.exec(`ALTER TABLE users ADD COLUMN role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL`);
  }

  // Migration: budget limit overrides on users
  const userColsBudget = db.prepare('PRAGMA table_info(users)').all().map((r) => r.name);
  if (!userColsBudget.includes('budget_daily')) {
    db.exec(`ALTER TABLE users ADD COLUMN budget_daily REAL`);
    db.exec(`ALTER TABLE users ADD COLUMN budget_weekly REAL`);
    db.exec(`ALTER TABLE users ADD COLUMN budget_monthly REAL`);
  }

  // Migration: org fields on users (synced from Oracle ERP)
  const userColsOrg = db.prepare('PRAGMA table_info(users)').all().map((r) => r.name);
  if (!userColsOrg.includes('dept_code')) {
    db.exec(`ALTER TABLE users ADD COLUMN dept_code TEXT`);
    db.exec(`ALTER TABLE users ADD COLUMN dept_name TEXT`);
    db.exec(`ALTER TABLE users ADD COLUMN profit_center TEXT`);
    db.exec(`ALTER TABLE users ADD COLUMN profit_center_name TEXT`);
    db.exec(`ALTER TABLE users ADD COLUMN org_section TEXT`);
    db.exec(`ALTER TABLE users ADD COLUMN org_section_name TEXT`);
    db.exec(`ALTER TABLE users ADD COLUMN org_group_name TEXT`);
    db.exec(`ALTER TABLE users ADD COLUMN factory_code TEXT`);
    db.exec(`ALTER TABLE users ADD COLUMN org_end_date TEXT`);
    db.exec(`ALTER TABLE users ADD COLUMN org_synced_at TEXT`);
  }

  // Migration: budget limits on roles
  const rolesColsBudget = db.prepare('PRAGMA table_info(roles)').all().map((r) => r.name);
  if (!rolesColsBudget.includes('budget_daily')) {
    db.exec(`ALTER TABLE roles ADD COLUMN budget_daily REAL`);
    db.exec(`ALTER TABLE roles ADD COLUMN budget_weekly REAL`);
    db.exec(`ALTER TABLE roles ADD COLUMN budget_monthly REAL`);
  }

  // Share Snapshots
  db.exec(`CREATE TABLE IF NOT EXISTS share_snapshots (
    id TEXT PRIMARY KEY,
    created_by INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    title TEXT,
    model TEXT,
    messages_json TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Migration: upload & function permission defaults on roles
  const rolesColsPerms = db.prepare('PRAGMA table_info(roles)').all().map((r) => r.name);
  if (!rolesColsPerms.includes('allow_text_upload')) {
    db.exec(`ALTER TABLE roles ADD COLUMN allow_text_upload INTEGER DEFAULT 1`);
    db.exec(`ALTER TABLE roles ADD COLUMN text_max_mb INTEGER DEFAULT 10`);
    db.exec(`ALTER TABLE roles ADD COLUMN allow_audio_upload INTEGER DEFAULT 0`);
    db.exec(`ALTER TABLE roles ADD COLUMN audio_max_mb INTEGER DEFAULT 10`);
    db.exec(`ALTER TABLE roles ADD COLUMN allow_image_upload INTEGER DEFAULT 1`);
    db.exec(`ALTER TABLE roles ADD COLUMN image_max_mb INTEGER DEFAULT 10`);
    db.exec(`ALTER TABLE roles ADD COLUMN allow_scheduled_tasks INTEGER DEFAULT 0`);
  }

  // ── Skills System ───────────────────────────────────────────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS skills (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    description       TEXT,
    icon              TEXT DEFAULT '🤖',
    type              TEXT DEFAULT 'builtin',
    system_prompt     TEXT,
    endpoint_url      TEXT,
    endpoint_secret   TEXT,
    endpoint_mode     TEXT DEFAULT 'inject',
    model_key         TEXT,
    mcp_tool_mode     TEXT DEFAULT 'append',
    mcp_tool_ids      TEXT DEFAULT '[]',
    dify_kb_ids       TEXT DEFAULT '[]',
    tags              TEXT DEFAULT '[]',
    owner_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_public         INTEGER DEFAULT 0,
    is_admin_approved INTEGER DEFAULT 0,
    pending_approval  INTEGER DEFAULT 0,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS session_skills (
    session_id  TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
    skill_id    INTEGER REFERENCES skills(id) ON DELETE CASCADE,
    sort_order  INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, skill_id)
  )`);

  // Migration: allow_create_skill / allow_external_skill on roles
  const rolesColsSkill = db.prepare('PRAGMA table_info(roles)').all().map((r) => r.name);
  if (!rolesColsSkill.includes('allow_create_skill')) {
    db.exec(`ALTER TABLE roles ADD COLUMN allow_create_skill   INTEGER DEFAULT 0`);
    db.exec(`ALTER TABLE roles ADD COLUMN allow_external_skill INTEGER DEFAULT 0`);
  }
  if (!rolesColsSkill.includes('allow_code_skill')) {
    db.exec(`ALTER TABLE roles ADD COLUMN allow_code_skill INTEGER DEFAULT 0`);
  }

  // Migration: allow_create_skill / allow_external_skill on users (NULL = inherit from role)
  const userColsSkill = db.prepare('PRAGMA table_info(users)').all().map((r) => r.name);
  if (!userColsSkill.includes('allow_create_skill')) {
    db.exec(`ALTER TABLE users ADD COLUMN allow_create_skill   INTEGER`);
    db.exec(`ALTER TABLE users ADD COLUMN allow_external_skill INTEGER`);
  }
  if (!userColsSkill.includes('allow_code_skill')) {
    db.exec(`ALTER TABLE users ADD COLUMN allow_code_skill INTEGER`);
  }

  // Migration: code skill columns on skills table
  const skillCols = db.prepare('PRAGMA table_info(skills)').all().map((r) => r.name);
  if (!skillCols.includes('code_snippet')) {
    db.exec(`ALTER TABLE skills ADD COLUMN code_snippet TEXT`);
    db.exec(`ALTER TABLE skills ADD COLUMN code_packages TEXT DEFAULT '[]'`);
    db.exec(`ALTER TABLE skills ADD COLUMN code_status TEXT DEFAULT 'stopped'`);
    db.exec(`ALTER TABLE skills ADD COLUMN code_port INTEGER`);
    db.exec(`ALTER TABLE skills ADD COLUMN code_pid INTEGER`);
    db.exec(`ALTER TABLE skills ADD COLUMN code_error TEXT`);
  }

  // ── i18n: Factory ↔ Language mapping ────────────────────────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS factory_languages (
    factory_code  TEXT PRIMARY KEY,
    language_code TEXT NOT NULL DEFAULT 'zh-TW',
    updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // User language preference (stores Oracle user_id → language_code; avoids Oracle schema change)
  db.exec(`CREATE TABLE IF NOT EXISTS user_language_prefs (
    user_id       TEXT PRIMARY KEY,
    language_code TEXT NOT NULL DEFAULT 'zh-TW',
    updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Seed default admin
  const adminAccount = process.env.DEFAULT_ADMIN_ACCOUNT || 'admin';
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin@foxlink';
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(adminAccount);
  if (!existing) {
    db.prepare(
      `INSERT INTO users (username, password, role, name, status) VALUES (?, ?, 'admin', 'System Admin', 'active')`
    ).run(adminAccount, adminPassword);
    console.log(`[DB] Default admin '${adminAccount}' created.`);
  }
}

async function initializeDatabase() {
  if (dbInstance) return new DatabaseWrapper(dbInstance);

  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const filebuffer = fs.readFileSync(DB_PATH);
    dbInstance = new SQL.Database(filebuffer);
  } else {
    dbInstance = new SQL.Database();
    saveDB();
  }

  const wrapper = new DatabaseWrapper(dbInstance);
  initSchema(wrapper);
  return wrapper;
}

let globalDbWrapper = null;

const dbExports = {
  db: null,
  init: async () => {
    globalDbWrapper = await initializeDatabase();
    dbExports.db = globalDbWrapper;
    return globalDbWrapper;
  },
  reload: async () => {
    console.log('Reloading Database from disk...');
    if (fs.existsSync(DB_PATH)) {
      const filebuffer = fs.readFileSync(DB_PATH);
      if (dbInstance) dbInstance.close();
      dbInstance = new SQL.Database(filebuffer);
      globalDbWrapper = new DatabaseWrapper(dbInstance);
      dbExports.db = globalDbWrapper;
      initSchema(globalDbWrapper);
      console.log('Database reloaded successfully.');
      return true;
    }
    return false;
  },
  exportDb: () => {
    if (!dbInstance) return null;
    return Buffer.from(dbInstance.export());
  },
  DB_PATH,
};

module.exports = dbExports;
