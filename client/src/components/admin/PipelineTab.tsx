import { useState, useCallback } from 'react'
import {
  Plus, Trash2, ChevronDown, ChevronUp, GitBranch,
  Zap, Wrench, BookOpen, Bot, FileOutput, GitMerge, X,
  GripVertical, AlertCircle, CheckCircle2, LayoutTemplate,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import TemplatePickerPopover from '../templates/TemplatePickerPopover'
import type { DocTemplate } from '../../types'

// ─── Types ────────────────────────────────────────────────────────────────────
export interface PipelineNode {
  id: string
  type: 'skill' | 'mcp' | 'kb' | 'ai' | 'generate_file' | 'condition' | 'parallel'
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
  // label
  label?: string
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
}

// ─── Node type config ─────────────────────────────────────────────────────────
const NODE_TYPES = [
  { type: 'skill',         icon: Zap,        labelKey: 'scheduledTask.pipeline.nodeType.skill',          color: 'text-amber-500',  bg: 'bg-amber-50  border-amber-200' },
  { type: 'mcp',           icon: Wrench,      labelKey: 'scheduledTask.pipeline.nodeType.mcp',            color: 'text-purple-500', bg: 'bg-purple-50 border-purple-200' },
  { type: 'kb',            icon: BookOpen,    labelKey: 'scheduledTask.pipeline.nodeType.kb',             color: 'text-green-500',  bg: 'bg-green-50  border-green-200' },
  { type: 'ai',            icon: Bot,         labelKey: 'scheduledTask.pipeline.nodeType.ai',             color: 'text-blue-500',   bg: 'bg-blue-50   border-blue-200' },
  { type: 'generate_file', icon: FileOutput,  labelKey: 'scheduledTask.pipeline.nodeType.generate_file',  color: 'text-indigo-500', bg: 'bg-indigo-50 border-indigo-200' },
  { type: 'condition',     icon: GitBranch,   labelKey: 'scheduledTask.pipeline.nodeType.condition',      color: 'text-rose-500',   bg: 'bg-rose-50   border-rose-200' },
  { type: 'parallel',      icon: GitMerge,    labelKey: 'scheduledTask.pipeline.nodeType.parallel',       color: 'text-teal-500',   bg: 'bg-teal-50   border-teal-200' },
] as const

const FILE_TYPES = ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'mp3']
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
            <select className="input text-xs" value={node.output_file || 'pdf'} onChange={(e) => onChange({ output_file: e.target.value })}>
              {FILE_TYPES.map((ft) => <option key={ft} value={ft}>{ft.toUpperCase()}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="label text-xs">{t('scheduledTask.pipeline.generateFile.filename')}</label>
            <input className="input w-full text-xs" value={node.filename || ''} onChange={(e) => onChange({ filename: e.target.value })} placeholder={`report_{{date}}.${node.output_file || 'pdf'}`} />
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
  node, allNodes, catalog, mcpServers, onChange,
}: {
  node: PipelineNode
  allNodes: PipelineNode[]
  catalog: ToolCatalog
  mcpServers: McpServer[]
  onChange: (patch: Partial<PipelineNode>) => void
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
          <select className="input w-full text-xs" value={node.output_file || ''} onChange={(e) => onChange({ output_file: e.target.value || undefined })}>
            <option value="">{t('scheduledTask.pipeline.skill.passToNext')}</option>
            {FILE_TYPES.map((ft) => <option key={ft} value={ft}>{ft.toUpperCase()}</option>)}
          </select>
        </div>
        {node.output_file && (
          <div className="flex-1">
            <label className="label text-xs">{t('scheduledTask.pipeline.skill.filename')}</label>
            <input className="input w-full text-xs" value={node.filename || ''} onChange={(e) => onChange({ filename: e.target.value })} placeholder={`output_{{date}}.${node.output_file}`} />
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
          <select className="input w-full text-xs" value={node.output_file || ''} onChange={(e) => onChange({ output_file: e.target.value || undefined })}>
            <option value="">{t('scheduledTask.pipeline.skill.passToNext')}</option>
            {FILE_TYPES.map((ft) => <option key={ft} value={ft}>{ft.toUpperCase()}</option>)}
          </select>
        </div>
        {node.output_file && (
          <div className="flex-1">
            <label className="label text-xs">{t('scheduledTask.pipeline.skill.filename')}</label>
            <input className="input w-full text-xs" value={node.filename || ''} onChange={(e) => onChange({ filename: e.target.value })} placeholder={`output.${node.output_file}`} />
          </div>
        )}
      </div>
    </div>
  )

  if (node.type === 'generate_file') return (
    <GenerateFileForm node={node} otherIds={otherIds} onChange={onChange} />
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
  isFirst, isLast,
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
          />
        </div>
      )}
    </div>
  )
}

// ─── AddNodeMenu ──────────────────────────────────────────────────────────────
function AddNodeMenu({ onAdd }: { onAdd: (type: PipelineNode['type']) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
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
            {NODE_TYPES.map(({ type, icon: Icon, labelKey, color }) => (
              <button
                key={type}
                type="button"
                onClick={() => { onAdd(type as PipelineNode['type']); setOpen(false) }}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-slate-50 text-xs text-left transition"
              >
                <Icon size={13} className={color} />
                <span className="text-slate-700">{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── PipelineTab (main export) ────────────────────────────────────────────────
export default function PipelineTab({ nodes, onChange, catalog, mcpServers, taskName }: Props) {
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
    onChange([...nodes, { id: newId(), type, label: '' }])
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
