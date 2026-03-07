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
