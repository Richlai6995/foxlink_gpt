export type UserRole = 'admin' | 'user'
export type UserStatus = 'active' | 'inactive'
export type MessageRole = 'user' | 'assistant'
export type ModelType = string

export interface User {
  id: number
  username: string
  name: string
  employee_id?: string
  email?: string
  role: UserRole
  status: UserStatus
  start_date?: string
  end_date?: string
}

export interface AuthState {
  token: string | null
  user: User | null
}

export interface ChatSession {
  id: string
  title: string
  model: ModelType
  created_at: string
  updated_at: string
}

export interface FileMeta {
  name: string
  type: 'image' | 'audio' | 'document' | 'unknown'
  url?: string
  transcription?: string
}

export interface GeneratedFile {
  type: string
  filename: string
  publicUrl: string
}

export interface ChatMessage {
  id: number
  session_id: string
  role: MessageRole
  content: string
  files?: FileMeta[]
  generated_files?: GeneratedFile[]
  input_tokens?: number
  output_tokens?: number
  created_at: string
}

export interface TokenUsage {
  id: number
  usage_date: string
  model: string
  input_tokens: number
  output_tokens: number
  image_count?: number
  username: string
  name: string
  employee_id?: string
  cost?: number | null
  currency?: string | null
}

export interface TokenPrice {
  id: number
  model: string
  price_input: number
  price_output: number
  tier_threshold?: number | null
  price_input_tier2?: number | null
  price_output_tier2?: number | null
  price_image_output?: number | null
  currency: string
  start_date: string
  end_date?: string | null
  created_at: string
}

export interface AuditLog {
  id: number
  session_id: string
  content: string
  has_sensitive: number
  sensitive_keywords?: string
  notified: number
  created_at: string
  username: string
  name: string
  employee_id?: string
}

export interface SensitiveKeyword {
  id: number
  keyword: string
  created_at: string
}

export type LlmProviderType = 'gemini' | 'azure_openai'

export interface LlmModel {
  id?: number
  key: string
  name: string
  api_model: string
  description?: string
  is_active?: number
  sort_order?: number
  image_output?: number
  created_at?: string
  // Multi-provider fields
  provider_type?: LlmProviderType
  has_api_key?: number       // 1 = encrypted key exists in DB
  endpoint_url?: string
  api_version?: string
  deployment_name?: string
  base_model?: string
}

export interface MailSettings {
  server?: string
  port?: string
  username?: string
  password?: string
  from?: string
}

export interface ScheduledTask {
  id: number
  user_id: number
  name: string
  schedule_type: 'daily' | 'weekly' | 'monthly'
  schedule_hour: number
  schedule_minute: number
  schedule_weekday: number
  schedule_monthday: number
  model: string
  prompt: string
  output_type: 'text' | 'file'
  file_type?: string
  filename_template?: string
  recipients_json: string
  email_subject?: string
  email_body?: string
  status: 'active' | 'paused' | 'draft'
  expire_at?: string
  max_runs: number
  run_count: number
  last_run_at?: string
  last_run_status?: string
  created_at: string
  updated_at: string
  user_name?: string
  username?: string
}

export interface ResearchJob {
  id: string
  title: string
  question?: string
  plan_json?: string
  status: 'pending' | 'running' | 'done' | 'failed'
  progress_step: number
  progress_total: number
  progress_label: string | null
  use_web_search: number
  output_formats: string
  result_summary: string | null
  result_files_json: string | null
  error_msg: string | null
  is_notified: number
  created_at: string
  completed_at: string | null
}

// ── AI 戰情 ──────────────────────────────────────────────────────────────────
export interface AiSchemaDef {
  id: number
  table_name: string
  display_name?: string
  db_connection: string
  business_notes?: string
  join_hints?: string
  is_active: number
  columns?: AiSchemaColumn[]
}

export interface AiSchemaColumn {
  id?: number
  schema_id?: number
  column_name: string
  data_type?: string
  description?: string
  is_vectorized: number
  value_mapping?: string
  sample_values?: string
}

export interface AiSelectTopic {
  id: number
  name: string
  description?: string
  icon?: string
  sort_order: number
  is_active: number
  designs?: AiSelectDesign[]
}

export interface AiSelectDesign {
  id: number
  topic_id: number
  name: string
  description?: string
  target_schema_ids?: string
  vector_search_enabled: number
  system_prompt?: string
  few_shot_examples?: string
  chart_config?: string
  cache_ttl_minutes: number
  is_public: number
}

export interface AiEtlJob {
  id: number
  name: string
  source_sql: string
  source_connection: string
  vectorize_fields?: string
  metadata_fields?: string
  embedding_dimension: number
  cron_expression?: string
  is_incremental: number
  last_run_at?: string
  status: string
  run_count?: number
}

export interface AiEtlRunLog {
  id: number
  job_id: number
  started_at?: string
  finished_at?: string
  rows_fetched: number
  rows_vectorized: number
  error_message?: string
  status: string
}

export interface AiQueryResult {
  rows: Record<string, unknown>[]
  columns: string[]
  row_count: number
  chart_config?: AiChartConfig | null
  cached?: boolean
}

export interface AiChartConfig {
  default_chart: string
  allow_table?: boolean
  allow_export?: boolean
  charts: AiChartDef[]
}

export interface AiChartDef {
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'radar' | 'gauge'
  title?: string
  x_field?: string
  y_field?: string
  label_field?: string
  value_field?: string
  horizontal?: boolean
  smooth?: boolean
  area?: boolean
  gradient?: boolean
  donut?: boolean
  show_label?: boolean
}

export interface TaskRun {
  id: number
  task_id: number
  run_at: string
  status: 'ok' | 'fail'
  attempt: number
  session_id?: string
  response_preview?: string
  generated_files_json: string
  email_sent_to?: string
  error_msg?: string
  duration_ms?: number
}
