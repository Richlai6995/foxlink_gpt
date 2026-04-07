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
  title_zh?: string
  title_en?: string
  title_vi?: string
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
  source?: string | null
}

export interface SensitiveKeyword {
  id: number
  keyword: string
  created_at: string
}

export type LlmProviderType = 'gemini' | 'azure_openai' | 'oci' | 'cohere'
export type LlmModelRole = 'chat' | 'embedding' | 'rerank' | 'tts' | 'stt'

export interface LlmGenerationConfig {
  temperature?: number
  max_output_tokens?: number
  top_p?: number
  reasoning_effort?: 'low' | 'medium' | 'high'
  thinking_budget?: number
  enable_search?: boolean
  enable_streaming?: boolean
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
  // Multi-provider fields
  provider_type?: LlmProviderType
  model_role?: LlmModelRole
  has_api_key?: number       // 1 = encrypted key exists in DB
  has_extra_config?: number  // 1 = OCI extra config exists
  endpoint_url?: string
  api_version?: string
  deployment_name?: string
  base_model?: string
  generation_config?: LlmGenerationConfig | string
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
  output_template_id?: string
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
  tools_config_json?: string
  pipeline_json?: string
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
  display_name_en?: string
  display_name_vi?: string
  alias?: string
  source_type?: 'table' | 'view' | 'sql'
  source_sql?: string
  db_connection: string
  source_db_id?: number
  business_notes?: string
  join_hints?: string
  base_conditions?: string
  vector_etl_job_id?: number
  is_active: number
  project_id?: number
  columns?: AiSchemaColumn[]
  where_only?: boolean   // 由 API 計算後注入，本身不存在 DB
}

export interface DbSource {
  id: number
  name: string
  db_type: 'oracle' | 'mysql' | 'mssql'
  host: string
  port: number
  service_name?: string
  database_name?: string
  schema_name?: string
  username: string
  is_active: number
  is_default: number
  last_ping_ok?: number
  last_ping_at?: string
}

export interface AiSchemaJoin {
  id: number
  name: string
  left_schema_id: number
  right_schema_id: number
  join_type: 'LEFT' | 'RIGHT' | 'INNER' | 'FULL'
  conditions_json: string   // JSON: [{left,op,right}]
  created_at?: string
}

export interface AiSchemaColumn {
  id?: number
  schema_id?: number
  column_name: string
  data_type?: string
  description?: string
  name_zh?: string
  name_en?: string
  name_vi?: string
  desc_en?: string
  desc_vi?: string
  is_vectorized: number
  value_mapping?: string
  sample_values?: string
  is_filter_key?: number
  is_virtual?: number
}

export interface AiSelectProject {
  id: number
  name: string
  description?: string
  is_public?: number
  public_approved?: number
  is_suspended?: number
  created_by?: number
  creator_name?: string
  topic_count?: number
  created_at?: string
}

export interface AiProjectShare {
  id: number
  project_id: number
  share_type: 'use' | 'develop'
  grantee_type: string
  grantee_id: string
  granted_by?: number
  created_at?: string
}

export interface AiSelectTopic {
  id: number
  name: string
  description?: string
  icon?: string
  icon_url?: string
  sort_order: number
  is_active: number
  is_suspended?: number
  project_id?: number
  policy_category_id?: number
  designs?: AiSelectDesign[]
}

export interface AiSelectDesign {
  id: number
  topic_id: number
  name: string
  description?: string
  target_schema_ids?: string | number[]
  target_join_ids?: string | number[]
  schema_where_only_ids?: string | number[]
  vector_search_enabled: number
  vector_top_k?: number
  vector_similarity_threshold?: string
  system_prompt?: string
  few_shot_examples?: string
  chart_config?: string
  cache_ttl_minutes: number
  is_public: number
  is_suspended?: number
  created_by?: number
}

export interface AiDashboardHistory {
  id: number
  design_id?: number
  design_name?: string
  topic_name?: string
  question: string
  generated_sql?: string
  row_count?: number
  created_at: string
}

export interface AiDashboardShare {
  id: number
  design_id: number
  share_type: 'use' | 'develop'
  grantee_type: string
  grantee_id: string
  created_at?: string
}

export interface AiEtlJob {
  id: number
  name: string
  source_sql: string
  source_connection: string
  vectorize_fields?: string | string[]
  metadata_fields?: string | string[]
  embedding_dimension: number
  trigger_intent?: string
  cron_expression?: string
  is_incremental: number
  last_run_at?: string
  status: string
  run_count?: number
  job_type?: 'vector' | 'table_copy'
  target_table?: string
  target_mode?: string
  upsert_key?: string
  delete_sql?: string
  schedule_type?: string
  schedule_config?: string | Record<string, any>
  project_id?: number
}

export interface AiEtlRunLog {
  id: number
  job_id: number
  started_at?: string
  finished_at?: string
  rows_fetched: number
  rows_vectorized: number
  rows_inserted?: number
  rows_updated?: number
  rows_deleted?: number
  status_message?: string
  error_message?: string
  status: string
}

export interface AiQueryResult {
  rows: Record<string, unknown>[]
  columns: string[]
  column_labels?: Record<string, string>   // col_lower → 中文說明
  row_count: number
  chart_config?: AiChartConfig | null
  cached?: boolean
}

export interface AiChartConfig {
  default_chart: string
  allow_table?: boolean
  allow_export?: boolean
  charts: AiChartDef[]
  available_columns?: { key: string; label: string }[]  // 儲存時記錄欄位清單，供無 live data 時編輯
}

export type ChartColorPalette = 'blue' | 'green' | 'orange' | 'purple' | 'teal'

/** 疊加折線定義 (Option C) — 在分組/堆疊 bar 上疊加全域折線 */
export interface OverlayLine {
  field: string
  agg: 'SUM' | 'COUNT' | 'AVG' | 'MAX' | 'MIN' | 'COUNT_DISTINCT'
  label?: string
  color?: string
  smooth?: boolean
  dashed?: boolean
  use_right_axis?: boolean
}

/** 複數 Y 軸定義（Method B），每條 series 獨立設定 */
export interface YAxisDef {
  field: string
  agg: 'SUM' | 'COUNT' | 'AVG' | 'MAX' | 'MIN' | 'COUNT_DISTINCT'
  chart_type: 'bar' | 'line'
  label?: string          // series 名稱（legend）
  color?: string          // 指定顏色 hex
  gradient?: boolean      // 漸層填充
  shadow?: boolean        // 陰影效果
  bar_width?: string      // 例如 '30%'
  overlap?: boolean       // barGap: '-100%' — 套疊在前一條上
  stack?: boolean         // 與其他 stack:true 的 series 堆疊
  smooth?: boolean        // line only
  area?: boolean          // line only
  use_right_axis?: boolean // 使用右 Y 軸
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
  // 新增顯示設定
  show_legend?: boolean
  show_grid?: boolean
  y_axis_name?: string
  x_axis_name?: string
  // 新增聚合設定（儲存至 chart_config，不再只是 ChartBuilder 本地狀態）
  agg_fn?: 'SUM' | 'COUNT' | 'AVG' | 'MAX' | 'MIN' | 'COUNT_DISTINCT'
  limit?: number
  // 顏色設定
  color_palette?: ChartColorPalette
  colors?: string[]   // 自訂色票陣列（按 series 出現順序循環）
  series_colors?: Record<string, string>  // 值→顏色精確對應（優先於 colors[]）
  // 多維度設定
  series_field?: string   // 分組維度 → 並排 (grouped)
  stack_field?: string    // 堆疊維度 → 疊色 (stacked within series)
  // 複數 Y 軸（Method B）— 當有此陣列時，y_field/agg_fn/series_field/stack_field 模式全部略過
  y_axes?: YAxisDef[]
  shadow?: boolean  // 全域陰影（單 series bar/line）
  // 疊加折線（Option C）— 在 series_field/stack_field 分組 bar 上疊加全域折線
  overlay_lines?: OverlayLine[]
  // 排序設定
  sort_by?: 'none' | 'x' | 'y'
  sort_order?: 'asc' | 'desc'
  // 顯示篩選（client-side，apply 在 chart render 時）
  min_value?: number   // 排除 y/value < 此值的資料列（BAR/LINE/PIE/SCATTER 皆支援）
  // 多語言標題 / 軸名
  title_en?: string
  title_vi?: string
  x_axis_name_en?: string
  x_axis_name_vi?: string
  y_axis_name_en?: string
  y_axis_name_vi?: string
  // ── 文字 / 顏色樣式設定 ─────────────────────────────────────────────────────
  chart_bg_color?: string      // 圖表 tile 底色
  axis_label_color?: string    // x/y 軸刻度文字色
  axis_label_size?: number     // x/y 軸刻度文字大小 (px)
  axis_label_bold?: boolean    // x/y 軸刻度粗體
  axis_line_color?: string     // 軸線 + axisTick 顏色
  data_label_color?: string    // series 標籤文字色（bar/line 頂端數字）
  data_label_size?: number     // series 標籤文字大小
  data_label_bold?: boolean    // series 標籤粗體
  legend_color?: string        // 圖例文字色
  legend_size?: number         // 圖例文字大小
  legend_bold?: boolean        // 圖例粗體
  title_color?: string         // 標題文字色
  title_size?: number          // 標題文字大小
  title_bold?: boolean         // 標題粗體
  title_left?: string          // 標題水平位置: 'left'|'center'|'right' 或 '10px'
  title_top?: string           // 標題垂直位置: 'top'|'middle'|'bottom' 或 '10px'
  legend_left?: string         // 圖例水平位置: 'left'|'center'|'right' 或 '10px'
  legend_top?: string          // 圖例垂直位置: 'top'|'middle'|'bottom' 或 '10px'
  legend_orient?: 'horizontal' | 'vertical'  // 圖例排列方向
  grid_line_color?: string     // 格線顏色
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

// ── AI 命名查詢（Saved Queries / Report Templates）────────────────────────────

export type QueryParamInputType = 'select' | 'multiselect' | 'date_range' | 'number_range' | 'text' | 'dynamic_date'
export type QueryParamInjectAs = 'where_in' | 'where_between' | 'where_like' | 'replace_text'

export interface AiQueryParameter {
  id: string                   // 唯一識別（uuid 或自訂）
  label_zh: string
  label_en?: string
  label_vi?: string
  schema_id?: number           // 從哪個 schema 拉資料
  column_name?: string         // 對應的欄位名稱（自動 DISTINCT 查詢）
  input_type: QueryParamInputType
  required?: boolean
  default_value?: string | null
  fetch_values_sql?: string    // 自訂 DISTINCT 查詢 SQL（優先於自動生成）
  inject_as?: QueryParamInjectAs
  sql_placeholder?: string     // SQL 中對應的 placeholder（e.g. ":FACTORY_CODE"）
  depends_on?: string          // 上層參數 id，本參數選項受其值過濾
  depends_column?: string      // source schema 中用來 filter 的欄位（對應 depends_on 的值）
}

export interface AiSavedQuery {
  id: number
  user_id: number
  name: string
  name_en?: string | null
  name_vi?: string | null
  description?: string
  category?: string
  design_id?: number
  question?: string
  pinned_sql?: string
  chart_config?: AiChartConfig | null
  parameters_schema?: AiQueryParameter[] | null
  auto_run?: number
  sort_order?: number
  is_active?: number
  created_at?: string
  updated_at?: string
  last_run_at?: string
  // joined fields
  creator_name?: string
  creator_emp_id?: string
  design_name?: string
  design_name_en?: string | null
  design_name_vi?: string | null
  topic_name?: string
  topic_name_en?: string | null
  topic_name_vi?: string | null
  can_manage?: number
}

export interface AiSavedQueryShare {
  id: number
  query_id: number
  share_type: 'use' | 'manage'
  grantee_type: 'user' | 'role' | 'department' | 'cost_center' | 'division' | 'org_group'
  grantee_id: string
  granted_by?: number
  created_at?: string
  // UI-only display fields
  grantee_name?: string
}

// ── AI 儀表板（Report Dashboards）────────────────────────────────────────────

export interface KpiAlertRule {
  operator: '>' | '<' | '>=' | '<='
  value: number
  color: string      // text/border color e.g. '#ef4444'
  bg_color?: string  // background highlight
}

export interface AiDashboardItem {
  tile_type?: 'chart' | 'kpi' | 'text'   // default 'chart'
  query_id?: number   // required for chart/kpi, omitted for text
  chart_index: number
  title_override?: string
  param_values?: Record<string, string | string[]>
  // react-grid-layout layout item
  i: string
  x: number
  y: number
  w: number
  h: number
  // KPI card specific
  kpi_column?: string
  kpi_agg?: 'first' | 'sum' | 'avg' | 'count'
  kpi_format?: 'number' | 'currency' | 'percent'
  kpi_decimals?: number
  kpi_comparison_column?: string   // second col for trend arrow
  kpi_alert_rules?: KpiAlertRule[]
  // Text widget specific
  text_content?: string
}

export interface AiDashboardGlobalFilter {
  id: string
  label_zh: string
  label_en?: string
  input_type: 'text' | 'date' | 'date_range' | 'select' | 'dynamic_date'
  param_name: string
  default_value?: string
  options?: string[]   // for select type
}

export interface AiDashboardBookmark {
  id: string
  name: string
  global_values: Record<string, string>
  created_at: string
}

// ── Oracle MultiOrg 資料權限範圍 ─────────────────────────────────────────────
export interface MultiOrgOrgDetail {
  id: number
  code: string
  name: string
  ou_id: number
  ou_name: string
  sob_id: number
  sob_name: string
}
export interface MultiOrgScope {
  has_restrictions: boolean
  is_admin?: boolean
  unavailable?: boolean
  denied?: boolean
  denied_reason?: string
  source_levels?: string[]
  org_count?: number
  sob_details?: { id: number; name: string }[]
  ou_details?: { id: number; name: string }[]
  org_details?: MultiOrgOrgDetail[]
}

export interface OrgScope {
  has_restrictions: boolean
  source_levels?: string[]
  dept_count?: number
  dept_details?: { dept_code: string; dept_name?: string; profit_center?: string; profit_center_name?: string; org_section?: string; org_section_name?: string; org_group_name?: string }[]
  profit_center_details?: { code: string; name?: string }[]
  org_section_details?: { code: string; name?: string }[]
  org_group_details?: { name: string }[]
  org_code_count?: number
  org_code_details?: { org_code: string; org_id?: number | null }[]
}

export interface AiReportDashboard {
  id: number
  user_id: number
  name: string
  name_en?: string
  name_vi?: string
  description?: string
  description_en?: string
  description_vi?: string
  category?: string
  category_en?: string
  category_vi?: string
  layout_config?: AiDashboardItem[] | null
  sort_order?: number
  auto_refresh_interval?: number | null
  bg_color?: string
  bg_image_url?: string
  bg_opacity?: number
  toolbar_bg_color?: string
  toolbar_text_color?: string
  logo_url?: string
  logo_height?: number
  global_filters_schema?: AiDashboardGlobalFilter[] | string | null
  bookmarks?: AiDashboardBookmark[] | string | null
  is_active?: number
  created_at?: string
  updated_at?: string
  // joined
  creator_name?: string
  can_manage?: number
}

export interface AiReportDashboardShare {
  id: number
  dashboard_id: number
  share_type: 'use' | 'manage'
  grantee_type: 'user' | 'role' | 'department' | 'cost_center' | 'division' | 'org_group'
  grantee_id: string
  granted_by?: number
  created_at?: string
  grantee_name?: string
}

// ── 通用分享 Modal 的 grantee 搜尋結果 ────────────────────────────────────────

export interface ShareGrantee {
  type: 'user' | 'role' | 'department' | 'cost_center' | 'division' | 'org_group'
  id: string
  name: string
  sub?: string    // 副標題（e.g. 工號、部門代碼）
}

// ── Document Templates ────────────────────────────────────────────────────────

export type TemplateVariableType = 'text' | 'number' | 'date' | 'select' | 'loop'
export type TemplateFormat = 'docx' | 'xlsx' | 'pdf' | 'pptx'
export type TemplateStrategy = 'native' | 'pdf_form' | 'ai_schema'
export type TemplateAccessLevel = 'owner' | 'edit' | 'use'
export type TemplateShareType = 'use' | 'edit'
export type TemplateOverflow = 'wrap' | 'truncate' | 'shrink' | 'summarize'

export interface VariableStyleProps {
  fontSize?: number       // pt
  bold?: boolean
  italic?: boolean
  color?: string          // hex e.g. "#CC0000" (font color)
  bgColor?: string        // hex e.g. "#FFFF00" (cell background color)
  overflow?: TemplateOverflow
  maxChars?: number
  lineSpacing?: number    // line height multiplier: 1.0, 1.15, 1.5, 2.0, 2.5, 3.0
  bullet?: string         // bullet character: '•', '✓', '■', '○', '▸', '–', '★' or 'none'
}

export interface VariableStyle {
  detected?: VariableStyleProps   // auto-detected from original template file
  override?: VariableStyleProps   // user-configured override
}

export type TemplateContentMode = 'variable' | 'static' | 'empty'
export type TemplateLoopMode = 'table_rows' | 'text_list'

export interface TemplateVariable {
  key: string
  label: string
  type: TemplateVariableType
  required: boolean
  content_mode?: TemplateContentMode   // 'variable'(default) | 'static'(fixed) | 'empty'(clear)
  loop_mode?: TemplateLoopMode         // 'table_rows'(default) | 'text_list' (format as numbered text)
  original_text?: string
  description?: string
  default_value?: string
  placeholder?: string
  options?: string[] | null
  children?: TemplateVariable[]
  style?: VariableStyle
  docx_style?: {
    rowHeightPt?: number    // fixed row height (twips/20); option C: override template's own height
    noWrap?: boolean
  }
  allow_ai_rewrite?: boolean  // default false — AI must preserve exact content when false
  pdf_anchor?: boolean        // default true: stay at defined page, overflow→template copy; false: float after preceding overflow
  pdf_cell?: {              // phase 2: visual editor coordinates
    page: number
    x: number
    y: number
    width: number
    height: number
  }
}

export interface XlsxListSettings {
  headerRowNum?: number   // 1-based; auto-detect if omitted
  oddRowColor?: string    // hex e.g. "#FFFFFF"
  evenRowColor?: string   // hex e.g. "#EEF2FF"
}

export interface DocxSettings {
  cellSpacingAfter?: number  // pt, default 0 (tight); increase for more space between loop items
}

export type PptxSlideType = 'cover' | 'content_single' | 'content_repeat' | 'back' | 'layout_template' | 'closing'

export interface PptxSlideConfig {
  index: number            // 0-based slide index
  type: PptxSlideType
  layout?: string          // 'bullets' | '3col' — for layout_template type
  loop_var?: string        // key of loop-type variable (only for content_repeat)
  thumbnail_url?: string   // /uploads/templates/thumbnails/xxx.png
}

export interface PptxSettings {
  slide_config: PptxSlideConfig[]
  content_array_var?: string  // 'slides' — key of the slides loop variable
  layout_field?: string       // 'type' — field name inside each slide item
}

export interface TemplateSchema {
  variables: TemplateVariable[]
  confidence?: number
  notes?: string
  strategy?: TemplateStrategy
  extracted_at?: string
  xlsx_settings?: XlsxListSettings
  docx_settings?: DocxSettings
  pptx_settings?: PptxSettings
}

export interface DocTemplate {
  id: string
  creator_id: number
  creator_name?: string
  name: string
  description?: string
  format: TemplateFormat
  strategy: TemplateStrategy
  template_file?: string
  original_file?: string
  schema_json?: string
  preview_url?: string
  is_public: number
  is_fixed_format: number
  tags?: string
  use_count: number
  forked_from?: string
  created_at: string
  updated_at: string
  access_level?: TemplateAccessLevel
}

export interface DocTemplateShare {
  id: number
  template_id: string
  share_type: TemplateShareType
  grantee_type: ShareGrantee['type']
  grantee_id: string
  grantee_name?: string
  granted_by?: number
  created_at: string
}

export interface DocTemplateOutput {
  id: string
  template_id: string
  user_id: number
  user_name?: string
  input_data?: string
  output_file?: string
  output_format?: string
  created_at: string
}
