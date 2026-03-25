-- =============================================================================
-- FOXLINK GPT — Oracle 23 AI Schema
-- Run with SQL*Plus / SQLcl as FLGPT user
-- Each CREATE statement wrapped in BEGIN/EXCEPTION to be idempotent
-- =============================================================================

-- ─── ROLES ────────────────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE roles (
  id                    NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  name                  VARCHAR2(100) NOT NULL,
  description           VARCHAR2(500),
  is_default            NUMBER(1) DEFAULT 0,
  -- Upload permissions
  allow_text_upload     NUMBER(1) DEFAULT 1,
  text_max_mb           NUMBER DEFAULT 10,
  allow_audio_upload    NUMBER(1) DEFAULT 0,
  audio_max_mb          NUMBER DEFAULT 10,
  allow_image_upload    NUMBER(1) DEFAULT 1,
  image_max_mb          NUMBER DEFAULT 10,
  -- Function permissions
  allow_scheduled_tasks NUMBER(1) DEFAULT 0,
  allow_create_skill    NUMBER(1) DEFAULT 0,
  allow_external_skill  NUMBER(1) DEFAULT 0,
  allow_code_skill      NUMBER(1) DEFAULT 0,
  -- Knowledge base permissions
  can_create_kb         NUMBER(1) DEFAULT 0,
  kb_max_size_mb        NUMBER DEFAULT 100,
  kb_max_count          NUMBER DEFAULT 5,
  -- Budget limits (USD per period, NULL = unlimited)
  budget_daily          NUMBER,
  budget_weekly         NUMBER,
  budget_monthly        NUMBER,
  created_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT roles_name_uk UNIQUE (name)
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── USERS ────────────────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE users (
  id                    NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  username              VARCHAR2(100) NOT NULL,
  password              VARCHAR2(200),
  role                  VARCHAR2(20) DEFAULT ''user'',
  role_id               NUMBER REFERENCES roles(id) ON DELETE SET NULL,
  name                  VARCHAR2(200),
  email                 VARCHAR2(200),
  employee_id           VARCHAR2(50),
  status                VARCHAR2(20) DEFAULT ''inactive'',
  start_date            DATE,
  end_date              DATE,
  creation_method       VARCHAR2(20) DEFAULT ''manual'',
  -- Upload permission overrides (NULL = inherit from role)
  allow_text_upload     NUMBER(1),
  text_max_mb           NUMBER,
  allow_audio_upload    NUMBER(1),
  audio_max_mb          NUMBER,
  allow_image_upload    NUMBER(1),
  image_max_mb          NUMBER,
  -- Function permission overrides
  allow_scheduled_tasks NUMBER(1),
  allow_create_skill    NUMBER(1),
  allow_external_skill  NUMBER(1),
  allow_code_skill      NUMBER(1),
  -- KB permission overrides
  can_create_kb         NUMBER(1),
  kb_max_size_mb        NUMBER,
  kb_max_count          NUMBER,
  -- Budget limit overrides
  budget_daily          NUMBER,
  budget_weekly         NUMBER,
  budget_monthly        NUMBER,
  -- Org fields (synced from Oracle ERP via employee_id)
  dept_code             VARCHAR2(50),
  dept_name             VARCHAR2(200),
  profit_center         VARCHAR2(50),
  profit_center_name    VARCHAR2(200),
  org_section           VARCHAR2(50),
  org_section_name      VARCHAR2(200),
  org_group_name        VARCHAR2(200),
  factory_code          VARCHAR2(20),
  org_end_date          DATE,
  org_synced_at         TIMESTAMP,
  created_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at            TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT users_username_uk UNIQUE (username)
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

BEGIN EXECUTE IMMEDIATE '
  CREATE UNIQUE INDEX idx_users_employee_id ON users (employee_id)
'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 OR SQLCODE = -1408 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── LLM MODELS ───────────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE llm_models (
  id            NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  key           VARCHAR2(50) NOT NULL,
  name          VARCHAR2(100) NOT NULL,
  api_model     VARCHAR2(200) NOT NULL,
  description   VARCHAR2(500),
  is_active     NUMBER(1) DEFAULT 1,
  sort_order    NUMBER DEFAULT 0,
  image_output  NUMBER(1) DEFAULT 0,
  created_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT llm_models_key_uk UNIQUE (key)
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── CHAT SESSIONS ────────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE chat_sessions (
  id          VARCHAR2(36) PRIMARY KEY,
  user_id     NUMBER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR2(500) DEFAULT ''新對話'',
  model       VARCHAR2(100),
  source      VARCHAR2(20) DEFAULT ''manual'',
  created_at  TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at  TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── CHAT MESSAGES ────────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE chat_messages (
  id            NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  session_id    VARCHAR2(36) NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role          VARCHAR2(10) NOT NULL,
  content       CLOB,
  files_json    CLOB,
  input_tokens  NUMBER DEFAULT 0,
  output_tokens NUMBER DEFAULT 0,
  created_at    TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── TOKEN USAGE ──────────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE token_usage (
  id            NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  user_id       NUMBER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date    DATE NOT NULL,
  model         VARCHAR2(100) NOT NULL,
  input_tokens  NUMBER DEFAULT 0,
  output_tokens NUMBER DEFAULT 0,
  image_count   NUMBER DEFAULT 0,
  cost          NUMBER,
  currency      VARCHAR2(10),
  CONSTRAINT token_usage_uk UNIQUE (user_id, usage_date, model)
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── TOKEN PRICES ─────────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE token_prices (
  id                  NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  model               VARCHAR2(100) NOT NULL,
  price_input         NUMBER DEFAULT 0 NOT NULL,
  price_output        NUMBER DEFAULT 0 NOT NULL,
  tier_threshold      NUMBER,
  price_input_tier2   NUMBER,
  price_output_tier2  NUMBER,
  price_image_output  NUMBER,
  currency            VARCHAR2(10) DEFAULT ''USD'' NOT NULL,
  start_date          DATE NOT NULL,
  end_date            DATE,
  created_at          TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── AUDIT LOGS ───────────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE audit_logs (
  id                NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  user_id           NUMBER REFERENCES users(id) ON DELETE SET NULL,
  session_id        VARCHAR2(36),
  content           CLOB,
  has_sensitive     NUMBER(1) DEFAULT 0,
  sensitive_keywords VARCHAR2(1000),
  notified          NUMBER(1) DEFAULT 0,
  created_at        TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── SENSITIVE KEYWORDS ───────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE sensitive_keywords (
  id         NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  keyword    VARCHAR2(200) NOT NULL,
  created_at TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT sensitive_kw_uk UNIQUE (keyword)
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── SYSTEM SETTINGS ──────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE system_settings (
  key   VARCHAR2(200) PRIMARY KEY,
  value CLOB
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── ORG CACHE ────────────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE org_cache (
  employee_no        VARCHAR2(20) PRIMARY KEY,
  c_name             VARCHAR2(200),
  email              VARCHAR2(200),
  dept_code          VARCHAR2(50),
  dept_name          VARCHAR2(200),
  profit_center      VARCHAR2(50),
  profit_center_name VARCHAR2(200),
  org_section        VARCHAR2(50),
  org_section_name   VARCHAR2(200),
  org_group_name     VARCHAR2(200),
  factory_code       VARCHAR2(20),
  end_date           DATE,
  cached_at          TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── PASSWORD RESET TOKENS ────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE password_reset_tokens (
  id         NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  user_id    NUMBER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR2(200) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used       NUMBER(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT pwd_reset_token_uk UNIQUE (token)
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── SCHEDULED TASKS ──────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE scheduled_tasks (
  id                NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  user_id           NUMBER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              VARCHAR2(200) NOT NULL,
  schedule_type     VARCHAR2(20) DEFAULT ''daily'' NOT NULL,
  schedule_hour     NUMBER DEFAULT 8 NOT NULL,
  schedule_minute   NUMBER DEFAULT 0 NOT NULL,
  schedule_weekday  NUMBER DEFAULT 1,
  schedule_monthday NUMBER DEFAULT 1,
  model             VARCHAR2(100) DEFAULT ''pro'' NOT NULL,
  prompt            CLOB NOT NULL,
  output_type       VARCHAR2(20) DEFAULT ''text'' NOT NULL,
  file_type         VARCHAR2(20),
  filename_template VARCHAR2(500),
  recipients_json   CLOB DEFAULT ''[]'',
  email_subject     VARCHAR2(500),
  email_body        CLOB,
  status            VARCHAR2(20) DEFAULT ''active'' NOT NULL,
  expire_at         TIMESTAMP,
  max_runs          NUMBER DEFAULT 0,
  run_count         NUMBER DEFAULT 0,
  last_run_at       TIMESTAMP,
  last_run_status   VARCHAR2(20),
  created_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at        TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── SCHEDULED TASK RUNS ──────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE scheduled_task_runs (
  id                    NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  task_id               NUMBER NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  run_at                TIMESTAMP DEFAULT SYSTIMESTAMP,
  status                VARCHAR2(20) DEFAULT ''ok'' NOT NULL,
  attempt               NUMBER DEFAULT 1,
  session_id            VARCHAR2(36),
  response_preview      VARCHAR2(2000),
  generated_files_json  CLOB DEFAULT ''[]'',
  email_sent_to         VARCHAR2(500),
  error_msg             CLOB,
  duration_ms           NUMBER
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── MCP SERVERS ──────────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE mcp_servers (
  id            NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  name          VARCHAR2(200) NOT NULL,
  url           VARCHAR2(1000) NOT NULL,
  api_key       VARCHAR2(500),
  description   CLOB,
  is_active     NUMBER(1) DEFAULT 1,
  tools_json    CLOB,
  tags          CLOB DEFAULT ''[]'',
  last_synced_at TIMESTAMP,
  created_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at    TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── MCP CALL LOGS ────────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE mcp_call_logs (
  id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  server_id       NUMBER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  session_id      VARCHAR2(36),
  user_id         NUMBER REFERENCES users(id) ON DELETE SET NULL,
  tool_name       VARCHAR2(200) NOT NULL,
  arguments_json  CLOB,
  response_preview VARCHAR2(2000),
  status          VARCHAR2(20) DEFAULT ''ok'',
  error_msg       CLOB,
  duration_ms     NUMBER,
  called_at       TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── DIFY KNOWLEDGE BASES ─────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE dify_knowledge_bases (
  id          NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  name        VARCHAR2(200) NOT NULL,
  api_server  VARCHAR2(1000) NOT NULL,
  api_key     VARCHAR2(500) NOT NULL,
  description CLOB,
  is_active   NUMBER(1) DEFAULT 1,
  sort_order  NUMBER DEFAULT 0,
  tags        CLOB DEFAULT ''[]'',
  created_at  TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at  TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── DIFY CALL LOGS ───────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE dify_call_logs (
  id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  kb_id           NUMBER NOT NULL REFERENCES dify_knowledge_bases(id) ON DELETE CASCADE,
  session_id      VARCHAR2(36),
  user_id         NUMBER REFERENCES users(id) ON DELETE SET NULL,
  query_preview   VARCHAR2(2000),
  response_preview VARCHAR2(2000),
  status          VARCHAR2(20) DEFAULT ''ok'',
  error_msg       CLOB,
  duration_ms     NUMBER,
  called_at       TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── ROLE ↔ MCP SERVER ────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE role_mcp_servers (
  role_id       NUMBER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  mcp_server_id NUMBER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, mcp_server_id)
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── ROLE ↔ DIFY KB ───────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE role_dify_kbs (
  role_id    NUMBER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  dify_kb_id NUMBER NOT NULL REFERENCES dify_knowledge_bases(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, dify_kb_id)
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── SHARE SNAPSHOTS ──────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE share_snapshots (
  id            VARCHAR2(36) PRIMARY KEY,
  created_by    NUMBER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id    VARCHAR2(36) NOT NULL,
  title         VARCHAR2(500),
  model         VARCHAR2(100),
  messages_json CLOB NOT NULL,
  -- Approval workflow (same as KB public request)
  public_status VARCHAR2(20) DEFAULT ''private'',
  reviewed_by   NUMBER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMP,
  reject_reason VARCHAR2(500),
  created_at    TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── SKILLS ───────────────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE skills (
  id                NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  name              VARCHAR2(200) NOT NULL,
  description       CLOB,
  icon              VARCHAR2(20) DEFAULT ''🤖'',
  type              VARCHAR2(20) DEFAULT ''builtin'',
  system_prompt     CLOB,
  endpoint_url      VARCHAR2(1000),
  endpoint_secret   VARCHAR2(500),
  endpoint_mode     VARCHAR2(20) DEFAULT ''inject'',
  model_key         VARCHAR2(50),
  mcp_tool_mode     VARCHAR2(20) DEFAULT ''append'',
  mcp_tool_ids      CLOB DEFAULT ''[]'',
  dify_kb_ids       CLOB DEFAULT ''[]'',
  self_kb_ids       CLOB DEFAULT ''[]'',
  kb_mode           VARCHAR2(20) DEFAULT ''append'',
  tags              CLOB DEFAULT ''[]'',
  tool_schema       CLOB,
  output_schema     CLOB,
  rate_limit_per_user NUMBER,
  rate_limit_global   NUMBER,
  rate_limit_window   VARCHAR2(10) DEFAULT ''hour'',
  prompt_version    NUMBER DEFAULT 1,
  published_prompt  CLOB,
  draft_prompt      CLOB,
  workflow_json     CLOB,
  code_snippet      CLOB,
  code_packages     CLOB DEFAULT ''[]'',
  code_status       VARCHAR2(20) DEFAULT ''stopped'',
  code_port         NUMBER,
  code_pid          NUMBER,
  code_error        CLOB,
  owner_user_id     NUMBER REFERENCES users(id) ON DELETE SET NULL,
  is_public         NUMBER(1) DEFAULT 0,
  is_admin_approved NUMBER(1) DEFAULT 0,
  pending_approval  NUMBER(1) DEFAULT 0,
  created_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at        TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── SESSION SKILLS ───────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE session_skills (
  session_id     VARCHAR2(36) NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  skill_id       NUMBER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  sort_order     NUMBER DEFAULT 0,
  variables_json CLOB DEFAULT ''{}'',
  PRIMARY KEY (session_id, skill_id)
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── SKILL PROMPT VERSIONS ──────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE skill_prompt_versions (
  id            NUMBER GENERATED AS IDENTITY PRIMARY KEY,
  skill_id      NUMBER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version       NUMBER NOT NULL,
  system_prompt CLOB,
  workflow_json CLOB,
  changed_by    NUMBER REFERENCES users(id),
  change_note   VARCHAR2(500),
  created_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT skill_ver_uq UNIQUE (skill_id, version)
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── SKILL WORKFLOWS ────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE skill_workflows (
  id              VARCHAR2(36) PRIMARY KEY,
  skill_id        NUMBER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version         NUMBER DEFAULT 1,
  nodes_json      CLOB NOT NULL,
  edges_json      CLOB NOT NULL,
  variables_json  CLOB DEFAULT ''{}'',
  created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- =============================================================================
-- ── KNOWLEDGE BASE (新功能) ───────────────────────────────────────────────────
-- =============================================================================

-- ─── KNOWLEDGE BASES ──────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE knowledge_bases (
  id               VARCHAR2(36) PRIMARY KEY,
  creator_id       NUMBER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             VARCHAR2(200) NOT NULL,
  description      CLOB,
  -- Embedding settings
  embedding_model  VARCHAR2(100) DEFAULT ''gemini-embedding-001'',
  embedding_dims   NUMBER DEFAULT 768,
  -- Chunking strategy
  chunk_strategy   VARCHAR2(20) DEFAULT ''regular'',
  chunk_config     CLOB,   -- JSON: {separator, max_size, overlap, child_separator, child_max_size}
  -- Retrieval settings (NULL = inherit from ENV defaults)
  retrieval_mode   VARCHAR2(20),   -- vector | fulltext | hybrid
  rerank_model     VARCHAR2(100),
  top_k_fetch      NUMBER,
  top_k_return     NUMBER,
  score_threshold  NUMBER,
  -- Sharing / visibility
  is_public        NUMBER(1) DEFAULT 0,
  public_status    VARCHAR2(20) DEFAULT ''private'',
  public_request_at  TIMESTAMP,
  public_reviewed_by NUMBER REFERENCES users(id) ON DELETE SET NULL,
  public_reviewed_at TIMESTAMP,
  public_reject_reason VARCHAR2(500),
  -- Tags
  tags             CLOB DEFAULT ''[]'',
  -- Stats
  doc_count        NUMBER DEFAULT 0,
  chunk_count      NUMBER DEFAULT 0,
  total_size_bytes NUMBER DEFAULT 0,
  created_at       TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at       TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── KB ACCESS CONTROL ────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE kb_access (
  id              VARCHAR2(36) PRIMARY KEY,
  kb_id           VARCHAR2(36) NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  grantee_type    VARCHAR2(20) NOT NULL,
  -- user / role / dept / profit_center / org_section / org_group
  grantee_id      VARCHAR2(200) NOT NULL,
  granted_by_type VARCHAR2(10) NOT NULL,   -- creator | admin
  granted_by_uid  NUMBER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission      VARCHAR2(10) DEFAULT 'use' NOT NULL,  -- use | edit
  granted_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT kb_access_uk UNIQUE (kb_id, grantee_type, grantee_id)
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── KB DOCUMENTS ─────────────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE kb_documents (
  id           VARCHAR2(36) PRIMARY KEY,
  kb_id        VARCHAR2(36) NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  filename     VARCHAR2(500) NOT NULL,
  file_type    VARCHAR2(20),
  file_size    NUMBER,
  content      CLOB,
  word_count   NUMBER,
  chunk_count  NUMBER DEFAULT 0,
  status       VARCHAR2(20) DEFAULT ''processing'',
  error_msg    CLOB,
  created_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at   TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── KB CHUNKS (with VECTOR for semantic search) ──────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE kb_chunks (
  id             VARCHAR2(36) PRIMARY KEY,
  doc_id         VARCHAR2(36) NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  kb_id          VARCHAR2(36) NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  parent_id      VARCHAR2(36),   -- NULL = self is parent (regular / parent-chunk)
  chunk_type     VARCHAR2(10) DEFAULT ''regular'',  -- regular | parent | child
  content        CLOB NOT NULL,
  parent_content CLOB,
  position       NUMBER NOT NULL,
  token_count    NUMBER,
  embedding      VECTOR(*, FLOAT32),     -- wildcard dims: supports 768 / 1536 / 3072
  created_at     TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- Vector index for semantic search
BEGIN EXECUTE IMMEDIATE '
  CREATE VECTOR INDEX kb_chunks_vidx ON kb_chunks(embedding)
  ORGANIZATION NEIGHBOR PARTITIONS
  WITH DISTANCE COSINE
  WITH TARGET ACCURACY 90
'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 OR SQLCODE = -1408 THEN NULL; ELSE RAISE; END IF; END;
/

-- Oracle Text index for full-text search
BEGIN EXECUTE IMMEDIATE '
  CREATE INDEX kb_chunks_ftx ON kb_chunks(content)
  INDEXTYPE IS CTXSYS.CONTEXT
  PARAMETERS (''sync (on commit)'')
'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 OR SQLCODE = -1408 THEN NULL; ELSE RAISE; END IF; END;
/

-- ─── KB RETRIEVAL TESTS ───────────────────────────────────────────────────────
BEGIN EXECUTE IMMEDIATE '
CREATE TABLE kb_retrieval_tests (
  id              VARCHAR2(36) PRIMARY KEY,
  kb_id           VARCHAR2(36) NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  user_id         NUMBER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query_text      VARCHAR2(500) NOT NULL,
  retrieval_mode  VARCHAR2(20),
  top_k           NUMBER,
  score_threshold NUMBER,
  use_rerank      NUMBER(1),
  results_json    CLOB,
  elapsed_ms      NUMBER,
  created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

BEGIN EXECUTE IMMEDIATE '
  CREATE INDEX kb_ret_tests_kb_idx ON kb_retrieval_tests(kb_id, created_at)
'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 OR SQLCODE = -1408 THEN NULL; ELSE RAISE; END IF; END;
/

-- =============================================================================
-- ── API KEYS & EXTERNAL ACCESS ───────────────────────────────────────────────
-- =============================================================================

BEGIN EXECUTE IMMEDIATE '
CREATE TABLE api_keys (
  id                VARCHAR2(36) PRIMARY KEY,
  name              VARCHAR2(200) NOT NULL,
  key_hash          VARCHAR2(64) NOT NULL,
  key_prefix        VARCHAR2(20),
  description       CLOB,
  scopes            VARCHAR2(200),
  -- accessible_kbs: JSON ["kb_id1","kb_id2"] or ["*"] for all accessible public KBs
  accessible_kbs    CLOB DEFAULT ''["*"]'',
  allowed_models    VARCHAR2(100) DEFAULT ''flash'',
  rate_limit_per_min NUMBER DEFAULT 60,
  expires_at        TIMESTAMP,
  is_active         NUMBER(1) DEFAULT 1,
  total_calls       NUMBER DEFAULT 0,
  last_used_at      TIMESTAMP,
  created_by        NUMBER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
  updated_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT api_keys_hash_uk UNIQUE (key_hash)
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

BEGIN EXECUTE IMMEDIATE '
CREATE TABLE api_access_logs (
  id                VARCHAR2(36) PRIMARY KEY,
  api_key_id        VARCHAR2(36) NOT NULL,
  api_key_name      VARCHAR2(200),
  endpoint          VARCHAR2(500),
  method            VARCHAR2(10),
  request_ip        VARCHAR2(50),
  request_body      CLOB,
  kb_ids_accessed   CLOB,
  response_code     NUMBER,
  response_tokens   NUMBER,
  elapsed_ms        NUMBER,
  has_error         NUMBER(1) DEFAULT 0,
  error_message     VARCHAR2(500),
  created_at        TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

BEGIN EXECUTE IMMEDIATE '
  CREATE INDEX api_logs_key_idx ON api_access_logs(api_key_id, created_at)
'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 OR SQLCODE = -1408 THEN NULL; ELSE RAISE; END IF; END;
/

BEGIN EXECUTE IMMEDIATE '
CREATE TABLE api_chat_sessions (
  id           VARCHAR2(36) PRIMARY KEY,
  api_key_id   VARCHAR2(36) NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  kb_ids       CLOB DEFAULT ''[]'',
  model        VARCHAR2(100),
  created_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
  last_used_at TIMESTAMP,
  expires_at   TIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

BEGIN EXECUTE IMMEDIATE '
CREATE TABLE api_chat_messages (
  id              VARCHAR2(36) PRIMARY KEY,
  session_id      VARCHAR2(36) NOT NULL REFERENCES api_chat_sessions(id) ON DELETE CASCADE,
  role            VARCHAR2(10) NOT NULL,
  content         CLOB,
  kb_chunks_used  CLOB,
  input_tokens    NUMBER,
  output_tokens   NUMBER,
  created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;
/

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
