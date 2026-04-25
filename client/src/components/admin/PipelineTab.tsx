import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Plus, Trash2, ChevronDown, ChevronUp, GitBranch,
  Zap, Wrench, BookOpen, Bot, FileOutput, GitMerge, X,
  GripVertical, AlertCircle, CheckCircle2, LayoutTemplate,
  Database, Shield, PlayCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import TemplatePickerPopover from '../templates/TemplatePickerPopover'
import type { DocTemplate } from '../../types'
import api from '../../lib/api'
import { useAuth } from '../../context/AuthContext'

// ─── Types ────────────────────────────────────────────────────────────────────
export type DbWriteOperation = 'insert' | 'upsert' | 'replace_by_date' | 'append'
export interface DbWriteColumnMap {
  jsonpath: string
  column: string
  transform?: string
  required?: boolean
  default?: string
}

export interface PipelineNode {
  id: string
  type: 'skill' | 'mcp' | 'kb' | 'ai' | 'generate_file' | 'condition' | 'parallel' | 'db_write' | 'kb_write' | 'alert'
  // skill
  name?: string
  input?: string
  output_file?: string
  filename?: string
  on_fail?: 'continue' | 'stop' | 'goto'
  on_fail_goto?: string
  // mcp
  server?: string
  tool?: string
  args?: Record<string, string>
  // kb
  query?: string
  // ai
  prompt?: string
  model?: string
  // generate_file template
  template_id?: string
  template_name?: string
  // condition
  judge?: 'ai' | 'text'
  value?: string
  operator?: string
  then_id?: string
  else_id?: string
  // parallel
  steps?: string[]
  // db_write
  table?: string
  operation?: DbWriteOperation
  key_columns?: string[]
  date_column?: string
  column_mapping?: DbWriteColumnMap[]
  on_row_error?: 'skip' | 'stop'
  max_rows?: number
  // kb_write
  kb_id?: string
  kb_name?: string
  title_field?: string
  url_field?: string
  summary_field?: string
  content_field?: string
  source_field?: string
  published_at_field?: string
  chunk_strategy?: 'mixed' | 'body_only' | 'whole'
  dedupe_mode?: 'url' | 'title' | 'url_or_title' | 'none'
  max_chunks_per_run?: number
  // alert
  rule_name?: string
  entity_type?: string
  entity_code?: string
  data_source?: 'upstream_json' | 'sql_query' | 'literal'
  data_config?: Record<string, any>
  comparison?: 'threshold' | 'historical_avg' | 'rate_change' | 'zscore'
  comparison_config?: Record<string, any>
  severity?: 'info' | 'warning' | 'critical'
  actions?: Array<{ type: string; [k: string]: any }>
  message_template?: string
  use_llm_analysis?: boolean | number
  cooldown_minutes?: number
  dedup_key?: string
  // label
  label?: string
}

// Whitelist entry returned by /api/pipeline-writable-tables
interface WritableTable {
  id: number
  table_name: string
  display_name?: string
  description?: string
  allowed_operations: string
  max_rows_per_run?: number
  is_active: number
}
interface WritableTableDetail extends WritableTable {
  column_metadata: Array<{ name: string; type: string; nullable: boolean }>
}

interface ToolCatalog {
  skills: { id: number; name: string; icon: string; type: string }[]
  kbs: { id: number; name: string }[]
}

interface McpServer {
  id: number
  name: string
  tools_json?: string
}

interface Props {
  nodes: PipelineNode[]
  onChange: (nodes: PipelineNode[]) => void
  catalog: ToolCatalog
  mcpServers: McpServer[]
  taskName?: string
  taskId?: number   // 用於 db_write/kb_write 節點 dry-run 時載入最近一次 ai_output
}

// ─── Node type config ─────────────────────────────────────────────────────────
// adminOnly: true → 只有 role='admin' 或 is_pipeline_admin=1 的 user 才看得到
const NODE_TYPES = [
  { type: 'skill',         icon: Zap,        labelKey: 'scheduledTask.pipeline.nodeType.skill',          color: 'text-amber-500',  bg: 'bg-amber-50  border-amber-200', adminOnly: false },
  { type: 'mcp',           icon: Wrench,      labelKey: 'scheduledTask.pipeline.nodeType.mcp',            color: 'text-purple-500', bg: 'bg-purple-50 border-purple-200', adminOnly: false },
  { type: 'kb',            icon: BookOpen,    labelKey: 'scheduledTask.pipeline.nodeType.kb',             color: 'text-green-500',  bg: 'bg-green-50  border-green-200',  adminOnly: false },
  { type: 'ai',            icon: Bot,         labelKey: 'scheduledTask.pipeline.nodeType.ai',             color: 'text-blue-500',   bg: 'bg-blue-50   border-blue-200',   adminOnly: false },
  { type: 'generate_file', icon: FileOutput,  labelKey: 'scheduledTask.pipeline.nodeType.generate_file',  color: 'text-indigo-500', bg: 'bg-indigo-50 border-indigo-200', adminOnly: false },
  { type: 'condition',     icon: GitBranch,   labelKey: 'scheduledTask.pipeline.nodeType.condition',      color: 'text-rose-500',   bg: 'bg-rose-50   border-rose-200',   adminOnly: false },
  { type: 'parallel',      icon: GitMerge,    labelKey: 'scheduledTask.pipeline.nodeType.parallel',       color: 'text-teal-500',   bg: 'bg-teal-50   border-teal-200',   adminOnly: false },
  { type: 'db_write',      icon: Database,    labelKey: 'scheduledTask.pipeline.nodeType.db_write',       color: 'text-slate-600',  bg: 'bg-slate-50  border-slate-300',  adminOnly: true  },
  { type: 'kb_write',      icon: BookOpen,    labelKey: 'scheduledTask.pipeline.nodeType.kb_write',       color: 'text-emerald-600',bg: 'bg-emerald-50 border-emerald-200', adminOnly: false },
  { type: 'alert',         icon: AlertCircle, labelKey: 'scheduledTask.pipeline.nodeType.alert',          color: 'text-rose-600',   bg: 'bg-rose-50   border-rose-300',     adminOnly: false },
] as const

const FILE_TYPES = ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'mp3']
const FILE_TYPE_EXT: Record<string, string> = {
  pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', pptx: 'pptx', txt: 'txt', mp3: 'mp3',
}
// 切 output_file 時把 filename 的副檔名同步更新，避免 UI 選 DOCX 但檔名留 .pdf 的不一致
function patchOutputFile(newType: string | undefined, currentName: string | undefined): { output_file: string | undefined; filename?: string } {
  const base: { output_file: string | undefined; filename?: string } = { output_file: newType || undefined }
  if (newType && currentName) {
    const ext = FILE_TYPE_EXT[newType] || newType
    base.filename = currentName.replace(/\.[a-zA-Z0-9]{2,5}$/, '') + '.' + ext
  }
  return base
}
const TEXT_OPS = [
  'contains', 'not_contains', 'equals', 'starts_with', 'ends_with',
  'regex', 'empty', 'length_gt', 'length_lt', 'number_gt', 'number_lt',
] as const

let _uid = 1
function newId() { return `node_${Date.now()}_${_uid++}` }

// ─── VariablePicker ───────────────────────────────────────────────────────────
function VarBtn({ onInsert }: { onInsert: (v: string) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const vars = [
    { label: t('scheduledTask.pipeline.vars.aiOutput'), value: '{{ai_output}}' },
    { label: t('scheduledTask.pipeline.vars.date'), value: '{{date}}' },
    { label: t('scheduledTask.pipeline.vars.taskName'), value: '{{task_name}}' },
  ]
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs px-2 py-0.5 rounded border border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600 transition"
      >
        {t('scheduledTask.pipeline.insertVar')}
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg min-w-[160px]">
          {vars.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => { onInsert(v.value); setOpen(false) }}
              className="block w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 text-slate-700"
            >
              {v.label}
              <span className="ml-1 text-slate-400 font-mono text-[10px]">{v.value}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function VarInput({
  value, onChange, placeholder, multiline, allNodeIds,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  multiline?: boolean
  allNodeIds?: string[]
}) {
  const { t } = useTranslation()
  const insert = useCallback((v: string) => onChange((value || '') + v), [value, onChange])
  const nodeVars = (allNodeIds || []).map((id) => ({
    label: t('scheduledTask.pipeline.vars.nodeOutput', { id }),
    value: `{{node_${id}_output}}`,
  }))

  return (
    <div className="space-y-1">
      {multiline ? (
        <textarea
          className="input w-full h-20 text-xs font-mono resize-none"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          className="input w-full text-xs font-mono"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
      <div className="flex gap-1 flex-wrap">
        <VarBtn onInsert={insert} />
        {nodeVars.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => insert(v.value)}
            className="text-xs px-2 py-0.5 rounded border border-slate-200 text-slate-400 hover:border-indigo-300 hover:text-indigo-600 transition"
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── DbWriteForm — admin-only: 寫入白名單 table ────────────────────────────
const DB_OPERATIONS: { value: DbWriteOperation; labelKey: string }[] = [
  { value: 'upsert',           labelKey: 'scheduledTask.pipeline.dbWrite.opUpsert' },
  { value: 'insert',           labelKey: 'scheduledTask.pipeline.dbWrite.opInsert' },
  { value: 'replace_by_date',  labelKey: 'scheduledTask.pipeline.dbWrite.opReplaceByDate' },
  { value: 'append',           labelKey: 'scheduledTask.pipeline.dbWrite.opAppend' },
]

const TRANSFORMS = ['', 'upper', 'lower', 'trim', 'number', 'date', 'strip_comma', 'null_if_dash', 'sha256', 'json_stringify', 'array_join_comma']

function DbWriteForm({
  node, otherIds, onChange, taskId,
}: {
  node: PipelineNode
  otherIds: string[]
  onChange: (patch: Partial<PipelineNode>) => void
  taskId?: number
}) {
  const { t } = useTranslation()
  const [tables, setTables]   = useState<WritableTable[]>([])
  const [detail, setDetail]   = useState<WritableTableDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [dryRunResult, setDryRunResult] = useState<any>(null)
  const [dryRunning, setDryRunning] = useState(false)
  const [loadingSample, setLoadingSample] = useState(false)

  // Load whitelist tables
  useEffect(() => {
    api.get('/pipeline-writable-tables')
      .then(r => setTables((r.data || []).filter((x: WritableTable) => x.is_active === 1)))
      .catch(() => setTables([]))
  }, [])

  // Load detail (columns) when table changes
  useEffect(() => {
    if (!node.table) { setDetail(null); return }
    setLoading(true)
    // Find id by table_name
    const entry = tables.find(t => t.table_name === node.table)
    if (!entry) { setLoading(false); return }
    api.get(`/pipeline-writable-tables/${entry.id}`)
      .then(r => setDetail(r.data))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false))
  }, [node.table, tables])

  const allowedOps = useMemo(() => {
    const entry = tables.find(t => t.table_name === node.table)
    if (!entry) return DB_OPERATIONS.map(o => o.value)
    return entry.allowed_operations.split(',').map(s => s.trim()) as DbWriteOperation[]
  }, [node.table, tables])

  // 過濾掉 meta 欄位(自動附加,不需要 admin mapping)
  const META_COLS = new Set(['meta_run_id', 'meta_pipeline', 'creation_date', 'last_updated_date', 'id'])
  const userColumns = useMemo(
    () => (detail?.column_metadata || []).filter(c => !META_COLS.has(c.name)),
    [detail],
  )

  const updateMapping = (i: number, patch: Partial<DbWriteColumnMap>) => {
    const arr = [...(node.column_mapping || [])]
    arr[i] = { ...arr[i], ...patch }
    onChange({ column_mapping: arr })
  }
  const addMapping = () => onChange({ column_mapping: [...(node.column_mapping || []), { jsonpath: '$.', column: '', transform: '' }] })
  const removeMapping = (i: number) => {
    const arr = [...(node.column_mapping || [])]
    arr.splice(i, 1)
    onChange({ column_mapping: arr })
  }

  const autoMapAllColumns = () => {
    // Convenience: 對每個 user column 產生一組 `$.{col}` → {col} 映射
    const mapping: DbWriteColumnMap[] = userColumns.map(c => ({
      jsonpath: `$.${c.name}`,
      column: c.name,
      transform: '',
      required: !c.nullable,
    }))
    onChange({ column_mapping: mapping })
  }

  const runDryRun = async () => {
    setDryRunning(true)
    setDryRunResult(null)
    try {
      // 用 ai_output 當預覽來源?使用者還沒跑過 LLM,只能給個空字串,讓他手動貼入
      // 這裡 fallback: 用 node.input 的字面(可能含 {{ai_output}} 未 interpolate)
      const sourceText = (node as any)._dry_run_sample || ''
      const r = await api.post('/pipeline-writable-tables/dry-run', {
        node_config: {
          table: node.table,
          operation: node.operation,
          key_columns: node.key_columns,
          date_column: node.date_column,
          column_mapping: node.column_mapping,
          on_row_error: node.on_row_error,
          max_rows: node.max_rows,
        },
        source_text: sourceText,
      })
      setDryRunResult(r.data)
    } catch (e: any) {
      setDryRunResult({ error: e?.response?.data?.error || e.message })
    } finally {
      setDryRunning(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Admin-only 警告 */}
      <div className="flex items-start gap-1.5 text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1.5 text-amber-700">
        <Shield size={12} className="shrink-0 mt-0.5" />
        <span>{t('scheduledTask.pipeline.dbWrite.adminOnlyHint')}</span>
      </div>

      {/* Table 選擇 */}
      <div>
        <label className="label text-xs">{t('scheduledTask.pipeline.dbWrite.targetTable')}</label>
        <select
          className="input w-full text-xs"
          value={node.table || ''}
          onChange={(e) => onChange({ table: e.target.value, operation: undefined, key_columns: [], column_mapping: [] })}
        >
          <option value="">{t('scheduledTask.pipeline.dbWrite.selectTable')}</option>
          {tables.map(tb => (
            <option key={tb.id} value={tb.table_name}>
              {tb.display_name || tb.table_name} ({tb.table_name})
            </option>
          ))}
        </select>
        {tables.length === 0 && (
          <p className="text-[10px] text-slate-400 mt-1">{t('scheduledTask.pipeline.dbWrite.noTablesHint')}</p>
        )}
      </div>

      {node.table && (
        <>
          {/* Operation */}
          <div>
            <label className="label text-xs">{t('scheduledTask.pipeline.dbWrite.operation')}</label>
            <select
              className="input w-full text-xs"
              value={node.operation || ''}
              onChange={(e) => onChange({ operation: e.target.value as DbWriteOperation })}
            >
              <option value="">{t('scheduledTask.pipeline.dbWrite.selectOp')}</option>
              {DB_OPERATIONS.filter(o => allowedOps.includes(o.value)).map(o => (
                <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
              ))}
            </select>
          </div>

          {/* UPSERT 的 key_columns */}
          {node.operation === 'upsert' && detail && (
            <div>
              <label className="label text-xs">{t('scheduledTask.pipeline.dbWrite.keyColumns')}</label>
              <div className="flex flex-wrap gap-1.5 bg-slate-50 border border-slate-200 rounded p-2">
                {userColumns.map(c => {
                  const checked = (node.key_columns || []).includes(c.name)
                  return (
                    <label key={c.name} className="flex items-center gap-1 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const arr = checked
                            ? (node.key_columns || []).filter(k => k !== c.name)
                            : [...(node.key_columns || []), c.name]
                          onChange({ key_columns: arr })
                        }}
                      />
                      <span>{c.name}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {/* REPLACE_BY_DATE 的 date_column */}
          {node.operation === 'replace_by_date' && detail && (
            <div>
              <label className="label text-xs">{t('scheduledTask.pipeline.dbWrite.dateColumn')}</label>
              <select
                className="input w-full text-xs"
                value={node.date_column || ''}
                onChange={(e) => onChange({ date_column: e.target.value })}
              >
                <option value="">{t('scheduledTask.pipeline.dbWrite.selectDateColumn')}</option>
                {userColumns.filter(c => /^(DATE|TIMESTAMP)/i.test(c.type)).map(c => (
                  <option key={c.name} value={c.name}>{c.name} ({c.type})</option>
                ))}
              </select>
            </div>
          )}

          {/* Column mapping */}
          {detail && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label text-xs m-0">{t('scheduledTask.pipeline.dbWrite.columnMapping')}</label>
                <div className="flex gap-1">
                  <button type="button" onClick={autoMapAllColumns}
                    className="text-xs px-2 py-0.5 rounded border border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600">
                    {t('scheduledTask.pipeline.dbWrite.autoMap')}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {(node.column_mapping || []).map((m, i) => (
                  <div key={i} className="grid grid-cols-[2fr_2fr_1.2fr_auto_auto] gap-1 items-center">
                    <input
                      className="input text-xs font-mono"
                      value={m.jsonpath}
                      onChange={(e) => updateMapping(i, { jsonpath: e.target.value })}
                      placeholder="$.price_usd"
                    />
                    <select
                      className="input text-xs"
                      value={m.column}
                      onChange={(e) => updateMapping(i, { column: e.target.value })}
                    >
                      <option value="">{t('scheduledTask.pipeline.dbWrite.pickCol')}</option>
                      {userColumns.map(c => (
                        <option key={c.name} value={c.name}>{c.name} {c.nullable ? '' : '*'}</option>
                      ))}
                    </select>
                    <select
                      className="input text-xs"
                      value={m.transform || ''}
                      onChange={(e) => updateMapping(i, { transform: e.target.value })}
                    >
                      {TRANSFORMS.map(tr => <option key={tr} value={tr}>{tr || t('scheduledTask.pipeline.dbWrite.noTransform')}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-[10px]" title={t('scheduledTask.pipeline.dbWrite.required')}>
                      <input type="checkbox" checked={!!m.required} onChange={(e) => updateMapping(i, { required: e.target.checked })} />
                      *
                    </label>
                    <button type="button" onClick={() => removeMapping(i)} className="p-0.5 text-slate-300 hover:text-rose-500">
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addMapping}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600">
                  <Plus size={11} /> {t('scheduledTask.pipeline.dbWrite.addMapping')}
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">{t('scheduledTask.pipeline.dbWrite.mappingHint')}</p>
            </div>
          )}

          {/* 上游 input */}
          <div>
            <label className="label text-xs">{t('scheduledTask.pipeline.dbWrite.inputSource')}</label>
            <VarInput
              value={node.input || '{{ai_output}}'}
              onChange={(v) => onChange({ input: v })}
              placeholder="{{ai_output}}"
              allNodeIds={otherIds}
            />
          </div>

          {/* Error handling */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs">{t('scheduledTask.pipeline.dbWrite.onRowError')}</label>
              <select
                className="input w-full text-xs"
                value={node.on_row_error || 'skip'}
                onChange={(e) => onChange({ on_row_error: e.target.value as 'skip' | 'stop' })}
              >
                <option value="skip">{t('scheduledTask.pipeline.dbWrite.skipBadRow')}</option>
                <option value="stop">{t('scheduledTask.pipeline.dbWrite.stopOnError')}</option>
              </select>
            </div>
            <div>
              <label className="label text-xs">{t('scheduledTask.pipeline.dbWrite.maxRows')}</label>
              <input
                type="number"
                className="input w-full text-xs"
                value={node.max_rows ?? ''}
                onChange={(e) => onChange({ max_rows: e.target.value ? Number(e.target.value) : undefined })}
                placeholder={String(detail?.max_rows_per_run || 10000)}
              />
            </div>
          </div>

          {/* Dry-run */}
          <div className="pt-2 border-t border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <label className="label text-xs m-0">{t('scheduledTask.pipeline.dbWrite.dryRunSample')}</label>
              {taskId && (
                <button type="button" disabled={loadingSample}
                  onClick={async () => {
                    setLoadingSample(true)
                    try {
                      const r = await api.get(`/scheduled-tasks/${taskId}/last-output`)
                      const text = r.data?.response_preview || ''
                      if (!text) {
                        alert(t('scheduledTask.pipeline.dbWrite.noLastOutput'))
                      } else {
                        onChange({ _dry_run_sample: text } as any)
                      }
                    } catch (e: any) {
                      alert(e?.response?.data?.error || e.message)
                    } finally { setLoadingSample(false) }
                  }}
                  className="text-xs px-2 py-0.5 rounded border border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40">
                  {loadingSample ? t('common.loading') : t('scheduledTask.pipeline.dbWrite.loadLastOutput')}
                </button>
              )}
            </div>
            <textarea
              className="input w-full h-16 text-xs font-mono resize-none"
              value={(node as any)._dry_run_sample || ''}
              onChange={(e) => onChange({ _dry_run_sample: e.target.value } as any)}
              placeholder='[{"metal_code":"CU","price_usd":13190,...}]'
            />
            <button type="button" onClick={runDryRun} disabled={dryRunning || !node.column_mapping?.length}
              className="mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40">
              <PlayCircle size={12} /> {dryRunning ? t('scheduledTask.pipeline.dbWrite.dryRunning') : t('scheduledTask.pipeline.dbWrite.runDryRun')}
            </button>
            {dryRunResult && (
              <pre className="mt-2 text-[10px] font-mono bg-slate-50 border border-slate-200 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap">
                {JSON.stringify(dryRunResult, null, 2)}
              </pre>
            )}
          </div>
        </>
      )}
      {loading && <p className="text-xs text-slate-400">{t('scheduledTask.pipeline.dbWrite.loading')}</p>}
    </div>
  )
}

// ─── KbWriteForm — write JSON items into a KB (chunk + embed + dedupe) ────
interface AccessibleKb {
  id: string
  name: string
  description?: string
  doc_count?: number
  chunk_count?: number
}

const KB_CHUNK_STRATEGIES = [
  { value: 'mixed',     labelKey: 'scheduledTask.pipeline.kbWrite.cs.mixed' },
  { value: 'body_only', labelKey: 'scheduledTask.pipeline.kbWrite.cs.bodyOnly' },
  { value: 'whole',     labelKey: 'scheduledTask.pipeline.kbWrite.cs.whole' },
] as const

const KB_DEDUPE_MODES = [
  { value: 'url',          labelKey: 'scheduledTask.pipeline.kbWrite.dm.url' },
  { value: 'title',        labelKey: 'scheduledTask.pipeline.kbWrite.dm.title' },
  { value: 'url_or_title', labelKey: 'scheduledTask.pipeline.kbWrite.dm.urlOrTitle' },
  { value: 'none',         labelKey: 'scheduledTask.pipeline.kbWrite.dm.none' },
] as const

function KbWriteForm({
  node, otherIds, onChange, taskId,
}: {
  node: PipelineNode
  otherIds: string[]
  onChange: (patch: Partial<PipelineNode>) => void
  taskId?: number
}) {
  const { t } = useTranslation()
  const [kbs, setKbs] = useState<AccessibleKb[]>([])
  const [loading, setLoading] = useState(false)
  const [dryRunResult, setDryRunResult] = useState<any>(null)
  const [dryRunning, setDryRunning] = useState(false)
  const [loadingSample, setLoadingSample] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get('/pipeline-kb-write/accessible-kbs')
      .then(r => setKbs(r.data || []))
      .catch(() => setKbs([]))
      .finally(() => setLoading(false))
  }, [])

  const runDryRun = async () => {
    setDryRunning(true)
    setDryRunResult(null)
    try {
      const sourceText = (node as any)._dry_run_sample || ''
      const r = await api.post('/pipeline-kb-write/dry-run', {
        node_config: {
          kb_id: node.kb_id,
          kb_name: node.kb_name,
          title_field: node.title_field,
          url_field: node.url_field,
          summary_field: node.summary_field,
          content_field: node.content_field,
          source_field: node.source_field,
          published_at_field: node.published_at_field,
          chunk_strategy: node.chunk_strategy,
          dedupe_mode: node.dedupe_mode,
          max_chunks_per_run: node.max_chunks_per_run,
          on_row_error: node.on_row_error,
        },
        source_text: sourceText,
      })
      setDryRunResult(r.data)
    } catch (e: any) {
      setDryRunResult({ error: e?.response?.data?.error || e.message })
    } finally {
      setDryRunning(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-1.5 text-xs bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5 text-emerald-700">
        <BookOpen size={12} className="shrink-0 mt-0.5" />
        <span>{t('scheduledTask.pipeline.kbWrite.hint')}</span>
      </div>

      {/* KB 選擇 */}
      <div>
        <label className="label text-xs">{t('scheduledTask.pipeline.kbWrite.targetKb')}</label>
        <select
          className="input w-full text-xs"
          value={node.kb_id || ''}
          onChange={(e) => {
            const kb = kbs.find(k => k.id === e.target.value)
            onChange({ kb_id: e.target.value, kb_name: kb?.name || '' })
          }}
        >
          <option value="">{t('scheduledTask.pipeline.kbWrite.selectKb')}</option>
          {kbs.map(k => (
            <option key={k.id} value={k.id}>
              {k.name} {k.doc_count != null ? `(${k.doc_count} docs)` : ''}
            </option>
          ))}
        </select>
        {kbs.length === 0 && !loading && (
          <p className="text-[10px] text-slate-400 mt-1">{t('scheduledTask.pipeline.kbWrite.noKbsHint')}</p>
        )}
      </div>

      {node.kb_id && (
        <>
          {/* 欄位映射 */}
          <div className="space-y-1.5">
            <label className="label text-xs">{t('scheduledTask.pipeline.kbWrite.fieldMapping')}</label>
            <div className="grid grid-cols-2 gap-1.5">
              <FieldRow label="title*"        value={node.title_field        || '$.title'}        onChange={(v) => onChange({ title_field: v })} />
              <FieldRow label="url"           value={node.url_field          || '$.url'}          onChange={(v) => onChange({ url_field: v })} />
              <FieldRow label="summary"       value={node.summary_field      || '$.summary'}      onChange={(v) => onChange({ summary_field: v })} />
              <FieldRow label="content"       value={node.content_field      || '$.content'}      onChange={(v) => onChange({ content_field: v })} />
              <FieldRow label="source"        value={node.source_field       || '$.source'}       onChange={(v) => onChange({ source_field: v })} />
              <FieldRow label="published_at"  value={node.published_at_field || '$.published_at'} onChange={(v) => onChange({ published_at_field: v })} />
            </div>
            <p className="text-[10px] text-slate-400">{t('scheduledTask.pipeline.kbWrite.fieldHint')}</p>
          </div>

          {/* Chunk strategy */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs">{t('scheduledTask.pipeline.kbWrite.chunkStrategy')}</label>
              <select
                className="input w-full text-xs"
                value={node.chunk_strategy || 'mixed'}
                onChange={(e) => onChange({ chunk_strategy: e.target.value as PipelineNode['chunk_strategy'] })}
              >
                {KB_CHUNK_STRATEGIES.map(s => (
                  <option key={s.value} value={s.value}>{t(s.labelKey)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label text-xs">{t('scheduledTask.pipeline.kbWrite.dedupeMode')}</label>
              <select
                className="input w-full text-xs"
                value={node.dedupe_mode || 'url'}
                onChange={(e) => onChange({ dedupe_mode: e.target.value as PipelineNode['dedupe_mode'] })}
              >
                {KB_DEDUPE_MODES.map(d => (
                  <option key={d.value} value={d.value}>{t(d.labelKey)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 上限 + error mode */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs">{t('scheduledTask.pipeline.kbWrite.maxChunksPerRun')}</label>
              <input
                type="number"
                className="input w-full text-xs"
                value={node.max_chunks_per_run ?? ''}
                onChange={(e) => onChange({ max_chunks_per_run: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="100"
              />
            </div>
            <div>
              <label className="label text-xs">{t('scheduledTask.pipeline.dbWrite.onRowError')}</label>
              <select
                className="input w-full text-xs"
                value={node.on_row_error || 'skip'}
                onChange={(e) => onChange({ on_row_error: e.target.value as 'skip' | 'stop' })}
              >
                <option value="skip">{t('scheduledTask.pipeline.dbWrite.skipBadRow')}</option>
                <option value="stop">{t('scheduledTask.pipeline.dbWrite.stopOnError')}</option>
              </select>
            </div>
          </div>

          {/* 上游 input */}
          <div>
            <label className="label text-xs">{t('scheduledTask.pipeline.dbWrite.inputSource')}</label>
            <VarInput
              value={node.input || '{{ai_output}}'}
              onChange={(v) => onChange({ input: v })}
              placeholder="{{ai_output}}"
              allNodeIds={otherIds}
            />
          </div>

          {/* Dry-run */}
          <div className="pt-2 border-t border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <label className="label text-xs m-0">{t('scheduledTask.pipeline.dbWrite.dryRunSample')}</label>
              {taskId && (
                <button type="button" disabled={loadingSample}
                  onClick={async () => {
                    setLoadingSample(true)
                    try {
                      const r = await api.get(`/scheduled-tasks/${taskId}/last-output`)
                      const text = r.data?.response_preview || ''
                      if (!text) {
                        alert(t('scheduledTask.pipeline.dbWrite.noLastOutput'))
                      } else {
                        onChange({ _dry_run_sample: text } as any)
                      }
                    } catch (e: any) {
                      alert(e?.response?.data?.error || e.message)
                    } finally { setLoadingSample(false) }
                  }}
                  className="text-xs px-2 py-0.5 rounded border border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40">
                  {loadingSample ? t('common.loading') : t('scheduledTask.pipeline.dbWrite.loadLastOutput')}
                </button>
              )}
            </div>
            <textarea
              className="input w-full h-16 text-xs font-mono resize-none"
              value={(node as any)._dry_run_sample || ''}
              onChange={(e) => onChange({ _dry_run_sample: e.target.value } as any)}
              placeholder='[{"title":"...","url":"https://...","summary":"...","content":"..."}]'
            />
            <button type="button" onClick={runDryRun} disabled={dryRunning}
              className="mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:border-emerald-400 hover:text-emerald-600 disabled:opacity-40">
              <PlayCircle size={12} /> {dryRunning ? t('scheduledTask.pipeline.dbWrite.dryRunning') : t('scheduledTask.pipeline.dbWrite.runDryRun')}
            </button>
            {dryRunResult && (
              <pre className="mt-2 text-[10px] font-mono bg-slate-50 border border-slate-200 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap">
                {JSON.stringify(dryRunResult, null, 2)}
              </pre>
            )}
          </div>
        </>
      )}
      {loading && <p className="text-xs text-slate-400">{t('scheduledTask.pipeline.dbWrite.loading')}</p>}
    </div>
  )
}

function FieldRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-slate-500 w-24 shrink-0">{label}</span>
      <input
        className="input flex-1 text-xs font-mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="$.field"
      />
    </div>
  )
}

// ─── AlertForm — Phase 3 警示節點 ─────────────────────────────────────────
const ALERT_COMPARISONS = [
  { value: 'threshold',      labelKey: 'scheduledTask.pipeline.alert.cmp.threshold' },
  { value: 'historical_avg', labelKey: 'scheduledTask.pipeline.alert.cmp.historicalAvg' },
  { value: 'rate_change',    labelKey: 'scheduledTask.pipeline.alert.cmp.rateChange' },
  { value: 'zscore',         labelKey: 'scheduledTask.pipeline.alert.cmp.zscore' },
] as const

const ALERT_DATA_SOURCES = [
  { value: 'upstream_json', labelKey: 'scheduledTask.pipeline.alert.ds.upstream' },
  { value: 'sql_query',     labelKey: 'scheduledTask.pipeline.alert.ds.sql' },
  { value: 'literal',       labelKey: 'scheduledTask.pipeline.alert.ds.literal' },
] as const

const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const

function AlertForm({
  node, otherIds, onChange, taskId,
}: {
  node: PipelineNode
  otherIds: string[]
  onChange: (patch: Partial<PipelineNode>) => void
  taskId?: number
}) {
  const { t } = useTranslation()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)
  const [loadingSample, setLoadingSample] = useState(false)

  const cmpCfg = (node.comparison_config || {}) as any
  const dataCfg = (node.data_config || {}) as any
  const actions = node.actions || []

  const updateCmpCfg = (patch: Record<string, any>) => onChange({ comparison_config: { ...cmpCfg, ...patch } })
  const updateDataCfg = (patch: Record<string, any>) => onChange({ data_config: { ...dataCfg, ...patch } })

  const setAction = (i: number, patch: Record<string, any>) => {
    const arr = [...actions]
    arr[i] = { ...arr[i], ...patch }
    onChange({ actions: arr })
  }
  const addAction = (type: string) => onChange({ actions: [...actions, { type }] })
  const removeAction = (i: number) => onChange({ actions: actions.filter((_, idx) => idx !== i) })

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const sourceText = (node as any)._dry_run_sample || ''
      const r = await api.post('/alert-rules/0/test', { source_text: sourceText }).catch(async () => {
        // 規則還沒儲存到 DB,改用 inline 模擬
        const { executeAlert } = { executeAlert: null } as any
        // fallback:呼 backend 用 inline rule 直接跑
        return await api.post('/alert-rules', {
          rule_name: node.rule_name || node.label || 'TEST_INLINE',
          comparison: node.comparison || 'threshold',
          comparison_config: cmpCfg,
          data_source: node.data_source || 'upstream_json',
          data_config: dataCfg,
          severity: node.severity || 'warning',
          actions: actions,
          message_template: node.message_template,
          cooldown_minutes: 0,
          is_active: 1,
        }).then(async (res: any) => {
          const ruleId = res.data.id
          const tr = await api.post(`/alert-rules/${ruleId}/test`, { source_text: sourceText })
          // 清掉測試 rule
          await api.delete(`/alert-rules/${ruleId}`).catch(() => {})
          return tr
        })
      })
      setTestResult(r.data)
    } catch (e: any) {
      setTestResult({ error: e?.response?.data?.error || e.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-1.5 text-xs bg-rose-50 border border-rose-200 rounded px-2 py-1.5 text-rose-700">
        <AlertCircle size={12} className="shrink-0 mt-0.5" />
        <span>{t('scheduledTask.pipeline.alert.hint')}</span>
      </div>

      {/* 規則名稱 + 嚴重等級 */}
      <div className="grid grid-cols-[2fr_1fr] gap-2">
        <div>
          <label className="label text-xs">{t('scheduledTask.pipeline.alert.ruleName')}</label>
          <input
            className="input w-full text-xs"
            value={node.rule_name || ''}
            onChange={(e) => onChange({ rule_name: e.target.value })}
            placeholder={t('scheduledTask.pipeline.alert.ruleNamePh')}
          />
        </div>
        <div>
          <label className="label text-xs">{t('scheduledTask.pipeline.alert.severity')}</label>
          <select
            className="input w-full text-xs"
            value={node.severity || 'warning'}
            onChange={(e) => onChange({ severity: e.target.value as any })}
          >
            {ALERT_SEVERITIES.map(s => (
              <option key={s} value={s}>{s.toUpperCase()}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Entity */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label text-xs">{t('scheduledTask.pipeline.alert.entityType')}</label>
          <input className="input w-full text-xs" value={node.entity_type || ''} onChange={(e) => onChange({ entity_type: e.target.value })} placeholder="metal / fx / stock" />
        </div>
        <div>
          <label className="label text-xs">{t('scheduledTask.pipeline.alert.entityCode')}</label>
          <input className="input w-full text-xs" value={node.entity_code || ''} onChange={(e) => onChange({ entity_code: e.target.value })} placeholder="CU / EURUSD / AAPL" />
        </div>
      </div>

      {/* Data source */}
      <div>
        <label className="label text-xs">{t('scheduledTask.pipeline.alert.dataSource')}</label>
        <select
          className="input w-full text-xs"
          value={node.data_source || 'upstream_json'}
          onChange={(e) => onChange({ data_source: e.target.value as any, data_config: {} })}
        >
          {ALERT_DATA_SOURCES.map(d => (
            <option key={d.value} value={d.value}>{t(d.labelKey)}</option>
          ))}
        </select>
        {(node.data_source || 'upstream_json') === 'upstream_json' && (
          <input
            className="input w-full text-xs mt-1 font-mono"
            value={dataCfg.jsonpath || '$.value'}
            onChange={(e) => updateDataCfg({ jsonpath: e.target.value })}
            placeholder="$.price_usd"
          />
        )}
        {(node.data_source) === 'sql_query' && (
          <textarea
            className="input w-full text-xs mt-1 font-mono h-16 resize-none"
            value={dataCfg.sql || ''}
            onChange={(e) => updateDataCfg({ sql: e.target.value })}
            placeholder="SELECT price_usd FROM pm_price_history WHERE metal_code='CU' ORDER BY as_of_date DESC FETCH FIRST 8 ROWS ONLY"
          />
        )}
        {(node.data_source) === 'literal' && (
          <input
            type="number"
            step="any"
            className="input w-full text-xs mt-1"
            value={dataCfg.value ?? ''}
            onChange={(e) => updateDataCfg({ value: e.target.value })}
            placeholder="13190"
          />
        )}
      </div>

      {/* Comparison */}
      <div>
        <label className="label text-xs">{t('scheduledTask.pipeline.alert.comparison')}</label>
        <select
          className="input w-full text-xs"
          value={node.comparison || 'threshold'}
          onChange={(e) => onChange({ comparison: e.target.value as any, comparison_config: {} })}
        >
          {ALERT_COMPARISONS.map(c => (
            <option key={c.value} value={c.value}>{t(c.labelKey)}</option>
          ))}
        </select>
        {/* threshold */}
        {(node.comparison || 'threshold') === 'threshold' && (
          <div className="grid grid-cols-[1fr_2fr] gap-2 mt-1">
            <select className="input text-xs" value={cmpCfg.operator || 'gt'} onChange={(e) => updateCmpCfg({ operator: e.target.value })}>
              <option value="gt">{'>'}</option>
              <option value="lt">{'<'}</option>
              <option value="gte">{'≥'}</option>
              <option value="lte">{'≤'}</option>
              <option value="eq">{'='}</option>
              <option value="ne">{'≠'}</option>
            </select>
            <input type="number" step="any" className="input text-xs" value={cmpCfg.value ?? ''} onChange={(e) => updateCmpCfg({ value: e.target.value })} placeholder={t('scheduledTask.pipeline.alert.thresholdPh')} />
          </div>
        )}
        {node.comparison === 'historical_avg' && (
          <div className="grid grid-cols-2 gap-2 mt-1">
            <input type="number" className="input text-xs" value={cmpCfg.period_days ?? 7} onChange={(e) => updateCmpCfg({ period_days: Number(e.target.value) })} placeholder="period_days=7" />
            <input type="number" step="any" className="input text-xs" value={cmpCfg.deviation_pct ?? 20} onChange={(e) => updateCmpCfg({ deviation_pct: Number(e.target.value) })} placeholder="deviation_pct=20" />
          </div>
        )}
        {node.comparison === 'rate_change' && (
          <div className="grid grid-cols-3 gap-2 mt-1">
            <select className="input text-xs" value={cmpCfg.operator || 'abs'} onChange={(e) => updateCmpCfg({ operator: e.target.value })}>
              <option value="abs">|△|</option>
              <option value="up">↑</option>
              <option value="down">↓</option>
            </select>
            <input type="number" className="input text-xs" value={cmpCfg.period_days ?? 1} onChange={(e) => updateCmpCfg({ period_days: Number(e.target.value) })} placeholder="period_days=1" />
            <input type="number" step="any" className="input text-xs" value={cmpCfg.threshold_pct ?? 5} onChange={(e) => updateCmpCfg({ threshold_pct: Number(e.target.value) })} placeholder="threshold_pct=5" />
          </div>
        )}
        {node.comparison === 'zscore' && (
          <div className="grid grid-cols-2 gap-2 mt-1">
            <input type="number" className="input text-xs" value={cmpCfg.period_days ?? 30} onChange={(e) => updateCmpCfg({ period_days: Number(e.target.value) })} placeholder="period_days=30" />
            <input type="number" step="any" className="input text-xs" value={cmpCfg.sigma ?? 2} onChange={(e) => updateCmpCfg({ sigma: Number(e.target.value) })} placeholder="sigma=2" />
          </div>
        )}
      </div>

      {/* Message template + LLM */}
      <div>
        <label className="label text-xs">{t('scheduledTask.pipeline.alert.messageTemplate')}</label>
        <textarea
          className="input w-full text-xs h-14 resize-none"
          value={node.message_template || ''}
          onChange={(e) => onChange({ message_template: e.target.value })}
          placeholder="{{rule_name}} 觸發:{{entity_code}} 當前 {{trigger_value}},基準 {{threshold_value}}({{reason}})"
        />
        <label className="flex items-center gap-1.5 text-xs mt-1 cursor-pointer">
          <input type="checkbox" checked={!!node.use_llm_analysis} onChange={(e) => onChange({ use_llm_analysis: e.target.checked })} />
          {t('scheduledTask.pipeline.alert.useLlmAnalysis')}
        </label>
      </div>

      {/* Actions */}
      <div>
        <label className="label text-xs">{t('scheduledTask.pipeline.alert.actions')}</label>
        <p className="text-[10px] text-slate-400 mb-1">{t('scheduledTask.pipeline.alert.actionsHint')}</p>
        <div className="space-y-1.5">
          {actions.map((a, i) => (
            <div key={i} className="grid grid-cols-[80px_1fr_auto] gap-1.5 items-center">
              <span className="text-xs px-2 py-1 bg-rose-100 text-rose-700 rounded">{a.type}</span>
              {a.type === 'email' && (
                <input className="input text-xs" value={Array.isArray(a.to) ? a.to.join(',') : (a.to || '')} onChange={(e) => setAction(i, { to: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="user1@x.com,user2@y.com" />
              )}
              {a.type === 'webex' && (
                <input className="input text-xs" value={a.room_id || ''} onChange={(e) => setAction(i, { room_id: e.target.value })} placeholder="Webex room ID" />
              )}
              {a.type === 'webhook' && (
                <input className="input text-xs" value={a.url || ''} onChange={(e) => setAction(i, { url: e.target.value })} placeholder="https://hooks.example.com/..." />
              )}
              {a.type === 'alert_history' && (
                <span className="text-[10px] text-slate-400">{t('scheduledTask.pipeline.alert.alwaysOn')}</span>
              )}
              <button type="button" onClick={() => removeAction(i)} className="p-0.5 text-slate-300 hover:text-rose-500"><X size={12} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-1.5 mt-1.5">
          {['email', 'webex', 'webhook'].map(t => (
            <button key={t} type="button" onClick={() => addAction(t)} className="text-[10px] px-2 py-0.5 rounded border border-slate-300 text-slate-500 hover:border-rose-400 hover:text-rose-600">+ {t}</button>
          ))}
        </div>
      </div>

      {/* Cooldown */}
      <div>
        <label className="label text-xs">{t('scheduledTask.pipeline.alert.cooldownMin')}</label>
        <input type="number" className="input w-full text-xs" value={node.cooldown_minutes ?? 60} onChange={(e) => onChange({ cooldown_minutes: Number(e.target.value) })} placeholder="60" />
      </div>

      {/* 上游 input + 試跑 */}
      <div>
        <label className="label text-xs">{t('scheduledTask.pipeline.dbWrite.inputSource')}</label>
        <VarInput value={node.input || '{{ai_output}}'} onChange={(v) => onChange({ input: v })} placeholder="{{ai_output}}" allNodeIds={otherIds} />
      </div>

      <div className="pt-2 border-t border-slate-200">
        <div className="flex items-center justify-between mb-1">
          <label className="label text-xs m-0">{t('scheduledTask.pipeline.dbWrite.dryRunSample')}</label>
          {taskId && (
            <button type="button" disabled={loadingSample}
              onClick={async () => {
                setLoadingSample(true)
                try {
                  const r = await api.get(`/scheduled-tasks/${taskId}/last-output`)
                  const text = r.data?.response_preview || ''
                  if (!text) alert(t('scheduledTask.pipeline.dbWrite.noLastOutput'))
                  else onChange({ _dry_run_sample: text } as any)
                } catch (e: any) { alert(e?.response?.data?.error || e.message) }
                finally { setLoadingSample(false) }
              }}
              className="text-xs px-2 py-0.5 rounded border border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40">
              {loadingSample ? t('common.loading') : t('scheduledTask.pipeline.dbWrite.loadLastOutput')}
            </button>
          )}
        </div>
        <textarea
          className="input w-full h-14 text-xs font-mono resize-none"
          value={(node as any)._dry_run_sample || ''}
          onChange={(e) => onChange({ _dry_run_sample: e.target.value } as any)}
          placeholder='{"price_usd": 13500}'
        />
        <button type="button" onClick={runTest} disabled={testing || !node.comparison}
          className="mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:border-rose-400 hover:text-rose-600 disabled:opacity-40">
          <PlayCircle size={12} /> {testing ? t('scheduledTask.pipeline.dbWrite.dryRunning') : t('scheduledTask.pipeline.alert.testTrigger')}
        </button>
        {testResult && (
          <pre className="mt-2 text-[10px] font-mono bg-slate-50 border border-slate-200 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap">
            {JSON.stringify(testResult, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}

// ─── GenerateFileForm (with template picker) ───────────────────────────────────
function GenerateFileForm({
  node, otherIds, onChange,
}: {
  node: PipelineNode
  otherIds: string[]
  onChange: (patch: Partial<PipelineNode>) => void
}) {
  const { t } = useTranslation()
  const [showPicker, setShowPicker] = useState(false)
  const hasTemplate = !!node.template_id

  return (
    <div className="space-y-3">
      {/* Template mode toggle */}
      <div>
        <label className="label text-xs flex items-center gap-1.5">
          <LayoutTemplate size={12} className="text-indigo-500" /> {t('scheduledTask.pipeline.generateFile.templateMode')}
        </label>
        {hasTemplate ? (
          <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5 text-xs text-indigo-700">
            <LayoutTemplate size={12} />
            <span className="flex-1 font-medium">{node.template_name || node.template_id}</span>
            <button onClick={() => onChange({ template_id: undefined, template_name: undefined })}
              className="text-indigo-400 hover:text-red-500"><X size={11} /></button>
          </div>
        ) : (
          <div className="relative inline-block">
            <button type="button" onClick={() => setShowPicker(v => !v)}
              className="flex items-center gap-1.5 text-xs border border-dashed border-slate-300 rounded-lg px-3 py-1.5 text-slate-500 hover:border-indigo-400 hover:text-indigo-600 transition">
              <LayoutTemplate size={12} /> {t('scheduledTask.pipeline.generateFile.selectTemplate')}
            </button>
            {showPicker && (
              <TemplatePickerPopover
                onSelect={(tpl: DocTemplate) => {
                  onChange({ template_id: tpl.id, template_name: tpl.name, output_file: tpl.format })
                  setShowPicker(false)
                }}
                onClose={() => setShowPicker(false)}
              />
            )}
          </div>
        )}
      </div>

      {/* Format + filename (hidden in template mode since format is locked) */}
      {!hasTemplate && (
        <div className="flex gap-2">
          <div>
            <label className="label text-xs">{t('scheduledTask.pipeline.generateFile.fileFormat')}</label>
            <select className="input text-xs" value={node.output_file || 'pdf'} onChange={(e) => onChange(patchOutputFile(e.target.value, node.filename))}>
              {FILE_TYPES.map((ft) => <option key={ft} value={ft}>{ft.toUpperCase()}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="label text-xs">{t('scheduledTask.pipeline.generateFile.filename')}</label>
            <input className="input w-full text-xs" value={node.filename || ''} onChange={(e) => onChange({ filename: e.target.value })} placeholder={`report_{{date}}.${FILE_TYPE_EXT[node.output_file || 'pdf'] || 'pdf'}`} />
          </div>
        </div>
      )}
      {hasTemplate && (
        <div className="flex-1">
          <label className="label text-xs">{t('scheduledTask.pipeline.generateFile.filenameOptional')}</label>
          <input className="input w-full text-xs" value={node.filename || ''} onChange={(e) => onChange({ filename: e.target.value })} placeholder={`report_{{date}}.${node.output_file || 'xlsx'}`} />
        </div>
      )}

      {/* Data source */}
      <div>
        <label className="label text-xs">{hasTemplate ? t('scheduledTask.pipeline.generateFile.dataSourceJson') : t('scheduledTask.pipeline.generateFile.dataSourceText')}</label>
        <VarInput value={node.input || '{{ai_output}}'} onChange={(v) => onChange({ input: v })} placeholder="{{ai_output}}" allNodeIds={otherIds} />
        {hasTemplate && (
          <p className="text-[10px] text-slate-400 mt-1">{t('scheduledTask.pipeline.generateFile.jsonHint')}</p>
        )}
      </div>
    </div>
  )
}

// ─── NodeForm ─────────────────────────────────────────────────────────────────
function NodeForm({
  node, allNodes, catalog, mcpServers, onChange, taskId,
}: {
  node: PipelineNode
  allNodes: PipelineNode[]
  catalog: ToolCatalog
  mcpServers: McpServer[]
  onChange: (patch: Partial<PipelineNode>) => void
  taskId?: number
}) {
  const { t } = useTranslation()
  const otherIds = allNodes.filter((n) => n.id !== node.id).map((n) => n.id)
  const mcpTools = (() => {
    const srv = mcpServers.find((s) => s.name === node.server)
    if (!srv?.tools_json) return []
    try { return JSON.parse(srv.tools_json) as { name: string; description?: string }[] } catch { return [] }
  })()

  const sel = (k: keyof PipelineNode, opts: { value: string; label: string }[], label: string, placeholder = '') => (
    <div>
      <label className="label text-xs">{label}</label>
      <select className="input w-full text-xs" value={(node[k] as string) || ''} onChange={(e) => onChange({ [k]: e.target.value })}>
        {placeholder && <option value="">{placeholder}</option>}
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )

  if (node.type === 'skill') return (
    <div className="space-y-3">
      {sel('name', catalog.skills.map((s) => ({ value: s.name, label: `${s.icon || '⚡'} ${s.name}` })), t('scheduledTask.pipeline.nodeType.skill'), t('scheduledTask.pipeline.skill.selectPlaceholder'))}
      <div>
        <label className="label text-xs">{t('scheduledTask.pipeline.skill.inputSource')}</label>
        <VarInput value={node.input || '{{ai_output}}'} onChange={(v) => onChange({ input: v })} placeholder="{{ai_output}}" allNodeIds={otherIds} />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="label text-xs">{t('scheduledTask.pipeline.skill.outputAsFile')}</label>
          <select className="input w-full text-xs" value={node.output_file || ''} onChange={(e) => onChange(patchOutputFile(e.target.value, node.filename))}>
            <option value="">{t('scheduledTask.pipeline.skill.passToNext')}</option>
            {FILE_TYPES.map((ft) => <option key={ft} value={ft}>{ft.toUpperCase()}</option>)}
          </select>
        </div>
        {node.output_file && (
          <div className="flex-1">
            <label className="label text-xs">{t('scheduledTask.pipeline.skill.filename')}</label>
            <input className="input w-full text-xs" value={node.filename || ''} onChange={(e) => onChange({ filename: e.target.value })} placeholder={`output_{{date}}.${FILE_TYPE_EXT[node.output_file] || node.output_file}`} />
          </div>
        )}
      </div>
      {sel('on_fail', [
        { value: 'continue', label: t('scheduledTask.pipeline.skill.onFailContinue') },
        { value: 'stop', label: t('scheduledTask.pipeline.skill.onFailStop') },
      ], t('scheduledTask.pipeline.skill.onFailLabel'))}
    </div>
  )

  if (node.type === 'mcp') return (
    <div className="space-y-3">
      {sel('server', mcpServers.map((s) => ({ value: s.name, label: s.name })), t('scheduledTask.pipeline.mcpNode.server'), t('scheduledTask.pipeline.mcpNode.selectServer'))}
      {node.server && sel('tool', mcpTools.map((tool) => ({ value: tool.name, label: tool.name + (tool.description ? ` — ${tool.description.slice(0, 40)}` : '') })), t('scheduledTask.pipeline.mcpNode.tool'), t('scheduledTask.pipeline.mcpNode.selectTool'))}
      <div>
        <label className="label text-xs">{t('scheduledTask.pipeline.mcpNode.args')}</label>
        <VarInput
          value={Object.entries(node.args || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
          onChange={(raw) => {
            const args: Record<string, string> = {}
            raw.split('\n').forEach((line) => {
              const eq = line.indexOf('=')
              if (eq > 0) args[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
            })
            onChange({ args })
          }}
          placeholder={'keyword={{ai_output}}\nlimit=10'}
          multiline
          allNodeIds={otherIds}
        />
      </div>
    </div>
  )

  if (node.type === 'kb') return (
    <div className="space-y-3">
      {sel('name', catalog.kbs.map((k) => ({ value: k.name, label: k.name })), t('scheduledTask.pipeline.kbNode.label'), t('scheduledTask.pipeline.kbNode.selectKb'))}
      <div>
        <label className="label text-xs">{t('scheduledTask.pipeline.kbNode.query')}</label>
        <VarInput value={node.query || '{{ai_output}}'} onChange={(v) => onChange({ query: v })} placeholder="{{ai_output}}" allNodeIds={otherIds} />
      </div>
    </div>
  )

  if (node.type === 'ai') return (
    <div className="space-y-3">
      <div>
        <label className="label text-xs">{t('scheduledTask.pipeline.aiNode.prompt')}</label>
        <VarInput value={node.prompt || ''} onChange={(v) => onChange({ prompt: v })} placeholder={t('scheduledTask.pipeline.aiNode.promptPlaceholder', { ao: '{{ai_output}}' })} multiline allNodeIds={otherIds} />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="label text-xs">{t('scheduledTask.pipeline.skill.outputAsFile')}</label>
          <select className="input w-full text-xs" value={node.output_file || ''} onChange={(e) => onChange(patchOutputFile(e.target.value, node.filename))}>
            <option value="">{t('scheduledTask.pipeline.skill.passToNext')}</option>
            {FILE_TYPES.map((ft) => <option key={ft} value={ft}>{ft.toUpperCase()}</option>)}
          </select>
        </div>
        {node.output_file && (
          <div className="flex-1">
            <label className="label text-xs">{t('scheduledTask.pipeline.skill.filename')}</label>
            <input className="input w-full text-xs" value={node.filename || ''} onChange={(e) => onChange({ filename: e.target.value })} placeholder={`output.${FILE_TYPE_EXT[node.output_file] || node.output_file}`} />
          </div>
        )}
      </div>
    </div>
  )

  if (node.type === 'generate_file') return (
    <GenerateFileForm node={node} otherIds={otherIds} onChange={onChange} />
  )

  if (node.type === 'db_write') return (
    <DbWriteForm node={node} otherIds={otherIds} onChange={onChange} taskId={taskId} />
  )

  if (node.type === 'kb_write') return (
    <KbWriteForm node={node} otherIds={otherIds} onChange={onChange} taskId={taskId} />
  )

  if (node.type === 'alert') return (
    <AlertForm node={node} otherIds={otherIds} onChange={onChange} taskId={taskId} />
  )

  if (node.type === 'condition') return (
    <div className="space-y-3">
      <div>
        <label className="label text-xs">{t('scheduledTask.pipeline.conditionNode.method')}</label>
        <div className="flex gap-3">
          {(['ai', 'text'] as const).map((j) => (
            <label key={j} className="flex items-center gap-1.5 cursor-pointer text-xs">
              <input type="radio" checked={(node.judge || 'ai') === j} onChange={() => onChange({ judge: j })} />
              {j === 'ai' ? t('scheduledTask.pipeline.conditionNode.aiOption') : t('scheduledTask.pipeline.conditionNode.textOption')}
            </label>
          ))}
        </div>
      </div>
      {(node.judge || 'ai') === 'ai' ? (
        <div>
          <label className="label text-xs">{t('scheduledTask.pipeline.conditionNode.aiPrompt')}</label>
          <VarInput value={node.prompt || ''} onChange={(v) => onChange({ prompt: v })} placeholder={t('scheduledTask.pipeline.conditionNode.aiPromptPlaceholder')} multiline allNodeIds={otherIds} />
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <label className="label text-xs">{t('scheduledTask.pipeline.conditionNode.source')}</label>
            <VarInput value={node.input || '{{ai_output}}'} onChange={(v) => onChange({ input: v })} placeholder="{{ai_output}}" allNodeIds={otherIds} />
          </div>
          <div className="flex gap-2">
            <div>
              <label className="label text-xs">{t('scheduledTask.pipeline.conditionNode.op')}</label>
              <select className="input text-xs" value={node.operator || 'contains'} onChange={(e) => onChange({ operator: e.target.value })}>
                {TEXT_OPS.map((op) => <option key={op} value={op}>{t(`scheduledTask.pipeline.ops.${op}`)}</option>)}
              </select>
            </div>
            {node.operator !== 'empty' && (
              <div className="flex-1">
                <label className="label text-xs">{t('scheduledTask.pipeline.conditionNode.value')}</label>
                <input className="input w-full text-xs" value={node.value || ''} onChange={(e) => onChange({ value: e.target.value })} placeholder={t('scheduledTask.pipeline.conditionNode.valuePlaceholder')} />
              </div>
            )}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label text-xs flex items-center gap-1"><CheckCircle2 size={10} className="text-green-500" /> {t('scheduledTask.pipeline.conditionNode.then')}</label>
          <select className="input w-full text-xs" value={node.then_id || ''} onChange={(e) => onChange({ then_id: e.target.value || undefined })}>
            <option value="">{t('scheduledTask.pipeline.conditionNode.continueNext')}</option>
            {otherIds.map((id) => <option key={id} value={id}>{allNodes.find((n) => n.id === id)?.label || id}</option>)}
          </select>
        </div>
        <div>
          <label className="label text-xs flex items-center gap-1"><X size={10} className="text-rose-500" /> {t('scheduledTask.pipeline.conditionNode.else')}</label>
          <select className="input w-full text-xs" value={node.else_id || ''} onChange={(e) => onChange({ else_id: e.target.value || undefined })}>
            <option value="">{t('scheduledTask.pipeline.conditionNode.continueNext')}</option>
            {otherIds.map((id) => <option key={id} value={id}>{allNodes.find((n) => n.id === id)?.label || id}</option>)}
          </select>
        </div>
      </div>
    </div>
  )

  if (node.type === 'parallel') return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">{t('scheduledTask.pipeline.parallelNode.hint')}</p>
      {otherIds.length === 0 ? (
        <p className="text-xs text-slate-400">{t('scheduledTask.pipeline.parallelNode.addFirst')}</p>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {otherIds.map((id) => {
            const n = allNodes.find((x) => x.id === id)!
            const checked = (node.steps || []).includes(id)
            return (
              <label key={id} className="flex items-center gap-2 px-2 py-1.5 rounded border border-slate-200 cursor-pointer hover:border-teal-300 text-xs">
                <input type="checkbox" checked={checked} onChange={() => {
                  const steps = checked
                    ? (node.steps || []).filter((s) => s !== id)
                    : [...(node.steps || []), id]
                  onChange({ steps })
                }} />
                <span>{n?.label || id}</span>
                <span className="text-slate-400 ml-auto">{n?.type}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )

  return null
}

// ─── NodeCard ─────────────────────────────────────────────────────────────────
function NodeCard({
  node, allNodes, catalog, mcpServers, onUpdate, onDelete, onMove,
  isFirst, isLast, taskId,
}: {
  node: PipelineNode
  allNodes: PipelineNode[]
  catalog: ToolCatalog
  mcpServers: McpServer[]
  onUpdate: (id: string, patch: Partial<PipelineNode>) => void
  onDelete: (id: string) => void
  onMove: (id: string, dir: -1 | 1) => void
  isFirst: boolean
  isLast: boolean
  taskId?: number
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)
  const cfg = NODE_TYPES.find((nt) => nt.type === node.type)!
  const Icon = cfg.icon

  const summary = (() => {
    if (node.type === 'skill') return node.name || t('scheduledTask.pipeline.summary.noSkill')
    if (node.type === 'mcp') return node.server ? `${node.server} → ${node.tool || '?'}` : t('scheduledTask.pipeline.summary.notSet')
    if (node.type === 'kb') return node.name || t('scheduledTask.pipeline.summary.noKb')
    if (node.type === 'ai') return node.prompt ? node.prompt.slice(0, 40) + '…' : t('scheduledTask.pipeline.summary.noPrompt')
    if (node.type === 'generate_file') return node.template_id
      ? t('scheduledTask.pipeline.summary.template', { name: node.template_name || node.template_id })
      : t('scheduledTask.pipeline.summary.output', { format: (node.output_file || 'pdf').toUpperCase() })
    if (node.type === 'condition') return (node.judge || 'ai') === 'ai'
      ? t('scheduledTask.pipeline.summary.aiJudge')
      : `${t(`scheduledTask.pipeline.ops.${node.operator || 'contains'}`)} "${node.value || ''}"`
    if (node.type === 'parallel') return t('scheduledTask.pipeline.summary.parallelCount', { count: (node.steps || []).length })
    if (node.type === 'db_write') return node.table
      ? `${node.table} (${node.operation || '—'}, ${(node.column_mapping || []).length} cols)`
      : t('scheduledTask.pipeline.summary.notSet')
    if (node.type === 'kb_write') return node.kb_id
      ? `${node.kb_name || node.kb_id} (${node.chunk_strategy || 'mixed'}, ≤${node.max_chunks_per_run || 100})`
      : t('scheduledTask.pipeline.summary.notSet')
    if (node.type === 'alert') return node.rule_name
      ? `${node.rule_name} [${(node.severity || 'warning').toUpperCase()}] ${node.comparison || '?'}`
      : t('scheduledTask.pipeline.summary.notSet')
    return ''
  })()

  return (
    <div className={`border rounded-xl ${cfg.bg} transition-all`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <GripVertical size={13} className="text-slate-300 shrink-0" />
        <Icon size={14} className={`shrink-0 ${cfg.color}`} />
        <input
          className="flex-1 bg-transparent text-xs font-medium text-slate-700 outline-none placeholder:text-slate-400 min-w-0"
          value={node.label || ''}
          onChange={(e) => onUpdate(node.id, { label: e.target.value })}
          placeholder={t(cfg.labelKey)}
        />
        <span className="text-[10px] text-slate-400 shrink-0 hidden sm:block">{summary}</span>
        <div className="flex items-center gap-0.5 shrink-0">
          <button type="button" onClick={() => onMove(node.id, -1)} disabled={isFirst} className="p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-20">
            <ChevronUp size={13} />
          </button>
          <button type="button" onClick={() => onMove(node.id, 1)} disabled={isLast} className="p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-20">
            <ChevronDown size={13} />
          </button>
          <button type="button" onClick={() => setExpanded((e) => !e)} className="p-0.5 text-slate-400 hover:text-slate-700">
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button type="button" onClick={() => onDelete(node.id)} className="p-0.5 text-slate-300 hover:text-rose-500">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Form */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-white/60 pt-2">
          <NodeForm
            node={node}
            allNodes={allNodes}
            catalog={catalog}
            mcpServers={mcpServers}
            onChange={(patch) => onUpdate(node.id, patch)}
            taskId={taskId}
          />
        </div>
      )}
    </div>
  )
}

// ─── AddNodeMenu ──────────────────────────────────────────────────────────────
function AddNodeMenu({ onAdd }: { onAdd: (type: PipelineNode['type']) => void }) {
  const { t } = useTranslation()
  const { user, isAdmin } = useAuth()
  const [open, setOpen] = useState(false)
  const isPipelineAdmin = isAdmin || (user as any)?.is_pipeline_admin === 1
  const visibleTypes = NODE_TYPES.filter(nt => !nt.adminOnly || isPipelineAdmin)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition w-full justify-center"
      >
        <Plus size={13} /> {t('scheduledTask.pipeline.addNode')}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 bottom-full mb-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg p-2 grid grid-cols-2 gap-1">
            {visibleTypes.map(({ type, icon: Icon, labelKey, color, adminOnly }) => (
              <button
                key={type}
                type="button"
                onClick={() => { onAdd(type as PipelineNode['type']); setOpen(false) }}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-slate-50 text-xs text-left transition"
              >
                <Icon size={13} className={color} />
                <span className="text-slate-700">{t(labelKey)}</span>
                {adminOnly && <Shield size={10} className="text-amber-500 ml-auto" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── PipelineTab (main export) ────────────────────────────────────────────────
export default function PipelineTab({ nodes, onChange, catalog, mcpServers, taskName, taskId }: Props) {
  const { t } = useTranslation()

  const update = (id: string, patch: Partial<PipelineNode>) =>
    onChange(nodes.map((n) => n.id === id ? { ...n, ...patch } : n))

  const remove = (id: string) => onChange(nodes.filter((n) => n.id !== id))

  const move = (id: string, dir: -1 | 1) => {
    const idx = nodes.findIndex((n) => n.id === id)
    if (idx + dir < 0 || idx + dir >= nodes.length) return
    const arr = [...nodes]
    ;[arr[idx], arr[idx + dir]] = [arr[idx + dir], arr[idx]]
    onChange(arr)
  }

  const add = (type: PipelineNode['type']) => {
    const base: PipelineNode = { id: newId(), type, label: '' }
    if (type === 'db_write') {
      base.operation = 'upsert'
      base.on_row_error = 'skip'
      base.column_mapping = []
      base.input = '{{ai_output}}'
    }
    if (type === 'kb_write') {
      base.chunk_strategy = 'mixed'
      base.dedupe_mode = 'url'
      base.max_chunks_per_run = 100
      base.on_row_error = 'skip'
      base.title_field = '$.title'
      base.url_field = '$.url'
      base.summary_field = '$.summary'
      base.content_field = '$.content'
      base.source_field = '$.source'
      base.published_at_field = '$.published_at'
      base.input = '{{ai_output}}'
    }
    if (type === 'alert') {
      base.rule_name = ''
      base.severity = 'warning'
      base.data_source = 'upstream_json'
      base.data_config = { jsonpath: '$.value' }
      base.comparison = 'threshold'
      base.comparison_config = { operator: 'gt', value: 0 }
      base.actions = [{ type: 'alert_history' }]
      base.message_template = '{{rule_name}} 觸發:{{entity_code}} 當前值 {{trigger_value}}({{reason}})'
      base.use_llm_analysis = false
      base.cooldown_minutes = 60
      base.input = '{{ai_output}}'
    }
    onChange([...nodes, base])
  }

  return (
    <div className="space-y-3">
      {/* Description */}
      <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-3 py-2">
        {t('scheduledTask.pipeline.description')}
      </p>

      {/* Start node (fixed) */}
      <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl">
        <Bot size={14} className="text-blue-500 shrink-0" />
        <span className="text-xs font-medium text-blue-700">{t('scheduledTask.pipeline.startLabel')}</span>
        <span className="text-[10px] text-blue-400 ml-auto">{t('scheduledTask.pipeline.startPoint')}{'{{ai_output}}'}</span>
      </div>

      {nodes.length > 0 && (
        <div className="flex justify-center">
          <div className="w-0.5 h-3 bg-slate-300" />
        </div>
      )}

      {/* Node list */}
      <div className="space-y-2">
        {nodes.map((node, i) => (
          <div key={node.id}>
            <NodeCard
              node={node}
              allNodes={nodes}
              catalog={catalog}
              mcpServers={mcpServers}
              onUpdate={update}
              onDelete={remove}
              onMove={move}
              isFirst={i === 0}
              isLast={i === nodes.length - 1}
              taskId={taskId}
            />
            {i < nodes.length - 1 && (
              <div className="flex justify-center mt-2">
                <div className="w-0.5 h-3 bg-slate-300" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add button */}
      {nodes.length > 0 && (
        <div className="flex justify-center">
          <div className="w-0.5 h-3 bg-slate-300" />
        </div>
      )}
      <AddNodeMenu onAdd={add} />

      {nodes.length === 0 && (
        <p className="text-center text-xs text-slate-400 py-4">
          {t('scheduledTask.pipeline.emptyHint')}
        </p>
      )}
    </div>
  )
}
