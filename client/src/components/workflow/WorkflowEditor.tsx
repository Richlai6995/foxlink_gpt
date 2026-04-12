import { useCallback, useState, useRef, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type OnConnect,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Play, Brain, BookOpen, Database, Wrench, Zap,
  Code2, Globe, GitBranch, FileText, Flag, Trash2, X,
  type LucideIcon,
} from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LovItem { id: string | number; name: string; name_zh?: string; name_en?: string; name_vi?: string }

interface WorkflowEditorProps {
  value: string
  onChange: (json: string) => void
  availableKbs?: LovItem[]
  availableDifyKbs?: LovItem[]
  availableMcpServers?: LovItem[]
  availableSkills?: LovItem[]
  availableModels?: { key: string; name: string }[]
}

interface NodeDef {
  type: string
  labelKey: string
  icon: LucideIcon
  color: string
  borderColor: string
}

/* ------------------------------------------------------------------ */
/*  Node type catalogue                                                */
/* ------------------------------------------------------------------ */

const NODE_DEFS: NodeDef[] = [
  { type: 'start', labelKey: 'workflow.nodeStart', icon: Play, color: 'bg-green-100 text-green-700', borderColor: 'border-green-400' },
  { type: 'llm', labelKey: 'workflow.nodeLlm', icon: Brain, color: 'bg-blue-100 text-blue-700', borderColor: 'border-blue-400' },
  { type: 'knowledge_base', labelKey: 'workflow.nodeKnowledgeBase', icon: BookOpen, color: 'bg-purple-100 text-purple-700', borderColor: 'border-purple-400' },
  { type: 'dify', labelKey: 'workflow.nodeApi', icon: Database, color: 'bg-orange-100 text-orange-700', borderColor: 'border-orange-400' },
  { type: 'mcp_tool', labelKey: 'workflow.nodeMcpTool', icon: Wrench, color: 'bg-slate-100 text-slate-700', borderColor: 'border-slate-400' },
  { type: 'skill', labelKey: 'workflow.nodeSkill', icon: Zap, color: 'bg-yellow-100 text-yellow-700', borderColor: 'border-yellow-400' },
  { type: 'code', labelKey: 'workflow.nodeCode', icon: Code2, color: 'bg-gray-100 text-gray-700', borderColor: 'border-gray-400' },
  { type: 'http_request', labelKey: 'workflow.nodeHttp', icon: Globe, color: 'bg-cyan-100 text-cyan-700', borderColor: 'border-cyan-400' },
  { type: 'condition', labelKey: 'workflow.nodeCondition', icon: GitBranch, color: 'bg-red-100 text-red-700', borderColor: 'border-red-400' },
  { type: 'template', labelKey: 'workflow.nodeTemplate', icon: FileText, color: 'bg-indigo-100 text-indigo-700', borderColor: 'border-indigo-400' },
  { type: 'output', labelKey: 'workflow.nodeOutput', icon: Flag, color: 'bg-emerald-100 text-emerald-700', borderColor: 'border-emerald-400' },
]

const getNodeDef = (nodeType: string) => NODE_DEFS.find(n => n.type === nodeType) || NODE_DEFS[0]

/* ------------------------------------------------------------------ */
/*  Custom Node Component                                              */
/* ------------------------------------------------------------------ */

function WorkflowNode({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
  const { t } = useTranslation()
  const def = getNodeDef(data.nodeType as string)
  const Icon = def.icon
  const defLabel = t(def.labelKey)
  return (
    <div
      className={`px-3 py-2 rounded-lg border-2 shadow-sm min-w-[140px] bg-white transition-colors ${
        selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-slate-400 !border-2 !border-white" />
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded ${def.color}`}>
          <Icon size={14} />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium truncate max-w-[120px]">
            {(data.label as string) || defLabel}
          </span>
          <span className="text-[10px] text-slate-400">{defLabel}</span>
        </div>
      </div>
      {(data.nodeType as string) === 'condition' ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="default"
            className="!w-3 !h-3 !bg-green-500 !border-2 !border-white"
            style={{ left: '30%' }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="else"
            className="!w-3 !h-3 !bg-red-500 !border-2 !border-white"
            style={{ left: '70%' }}
          />
          <div className="flex justify-between mt-1 px-2 text-[9px] text-slate-400">
            <span>{t('workflow.condYes')}</span>
            <span>{t('workflow.condNo')}</span>
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-slate-400 !border-2 !border-white" />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Config Panel Helpers                                               */
/* ------------------------------------------------------------------ */

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-slate-600 mb-1 mt-3 first:mt-0">{children}</label>
}

function TextInput({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
    />
  )
}

function TextArea({
  value, onChange, placeholder, rows = 3, mono = false,
}: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean }) {
  return (
    <textarea
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={`w-full px-2 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 resize-y ${
        mono ? 'font-mono text-xs' : ''
      }`}
    />
  )
}

function SelectInput({
  value, onChange, options, placeholder,
}: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 bg-white"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function SliderInput({
  value, onChange, min = 0, max = 2, step = 0.1,
}: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value ?? 0.7}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />
      <span className="text-xs text-slate-500 w-8 text-right">{(value ?? 0.7).toFixed(1)}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Condition Rule Editor                                              */
/* ------------------------------------------------------------------ */

interface ConditionRule {
  field: string
  op: string
  value: string
  target: string
}

function ConditionRulesEditor({
  rules, onChange, allNodes,
}: { rules: ConditionRule[]; onChange: (r: ConditionRule[]) => void; allNodes: Node[] }) {
  const { t } = useTranslation()
  const safeRules = Array.isArray(rules) && rules.length > 0 ? rules : [{ field: '', op: '==', value: '', target: '' }]

  const updateRule = (idx: number, patch: Partial<ConditionRule>) => {
    const next = safeRules.map((r, i) => i === idx ? { ...r, ...patch } : r)
    onChange(next)
  }

  const addRule = () => onChange([...safeRules, { field: '', op: '==', value: '', target: '' }])

  const removeRule = (idx: number) => {
    if (safeRules.length <= 1) return
    onChange(safeRules.filter((_, i) => i !== idx))
  }

  const opOptions = [
    { value: '==', label: t('workflow.opEquals') },
    { value: '!=', label: t('workflow.opNotEquals') },
    { value: '>', label: t('workflow.opGt') },
    { value: '<', label: t('workflow.opLt') },
    { value: '>=', label: t('workflow.opGte') },
    { value: '<=', label: t('workflow.opLte') },
    { value: 'contains', label: t('workflow.opContains') },
    { value: 'not_contains', label: t('workflow.opNotContains') },
    { value: 'starts_with', label: t('workflow.opStartsWith') },
    { value: 'ends_with', label: t('workflow.opEndsWith') },
    { value: 'is_empty', label: t('workflow.opIsEmpty') },
    { value: 'is_not_empty', label: t('workflow.opIsNotEmpty') },
  ]

  const nodeOptions = allNodes.map(n => ({
    value: n.id,
    label: `${(n.data?.label as string) || n.id}`,
  }))

  return (
    <div className="space-y-2">
      {safeRules.map((rule, idx) => (
        <div key={idx} className="p-2 bg-slate-50 rounded border border-slate-100 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-medium">{t('workflow.ruleLabel', { n: idx + 1 })}</span>
            {safeRules.length > 1 && (
              <button onClick={() => removeRule(idx)} className="text-red-400 hover:text-red-600">
                <X size={12} />
              </button>
            )}
          </div>
          <input
            type="text"
            value={rule.field || ''}
            onChange={e => updateRule(idx, { field: e.target.value })}
            placeholder={t('workflow.fieldName')}
            className="w-full px-2 py-1 text-xs border border-slate-200 rounded"
          />
          <div className="flex gap-1">
            <select
              value={rule.op || '=='}
              onChange={e => updateRule(idx, { op: e.target.value })}
              className="flex-1 px-1 py-1 text-xs border border-slate-200 rounded bg-white"
            >
              {opOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
              type="text"
              value={rule.value || ''}
              onChange={e => updateRule(idx, { value: e.target.value })}
              placeholder={t('workflow.value')}
              className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded"
            />
          </div>
          <select
            value={rule.target || ''}
            onChange={e => updateRule(idx, { target: e.target.value })}
            className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-white"
          >
            <option value="">{t('workflow.targetNode')}</option>
            {nodeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      ))}
      <button
        onClick={addRule}
        className="w-full px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded border border-dashed border-blue-300"
      >
        {t('workflow.addRule')}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Node Config Panel                                                  */
/* ------------------------------------------------------------------ */

interface NodeConfigPanelProps {
  node: Node
  onChange: (data: Record<string, unknown>) => void
  onDelete: () => void
  availableKbs: LovItem[]
  availableDifyKbs: LovItem[]
  availableMcpServers: LovItem[]
  availableSkills: LovItem[]
  availableModels: { key: string; name: string }[]
  allNodes: Node[]
}

function NodeConfigPanel({
  node, onChange, availableKbs, availableDifyKbs,
  availableMcpServers, availableSkills, availableModels, allNodes,
}: NodeConfigPanelProps) {
  const { t, i18n } = useTranslation()
  const ln = (item: LovItem) => {
    if (i18n.language === 'en') return item.name_en || item.name
    if (i18n.language === 'vi') return item.name_vi || item.name
    return item.name_zh || item.name
  }
  const d = node.data as Record<string, unknown>
  const nodeType = d.nodeType as string
  const set = (field: string, value: unknown) => onChange({ [field]: value })

  return (
    <div className="space-y-0.5">
      {/* Label — always shown */}
      <FieldLabel>{t('workflow.labelNodeName')}</FieldLabel>
      <TextInput value={d.label as string} onChange={v => set('label', v)} placeholder={t('workflow.labelNodeName')} />

      {/* start */}
      {nodeType === 'start' && (
        <>
          <FieldLabel>{t('workflow.labelVariables')}</FieldLabel>
          <TextArea
            value={d.variables as string || '[]'}
            onChange={v => set('variables', v)}
            placeholder='[{"name":"input","type":"string"}]'
            mono
            rows={4}
          />
        </>
      )}

      {/* llm */}
      {nodeType === 'llm' && (
        <>
          <FieldLabel>{t('workflow.labelModel')}</FieldLabel>
          <SelectInput
            value={d.model_key as string}
            onChange={v => set('model_key', v)}
            options={availableModels.map(m => ({ value: m.key, label: m.name }))}
            placeholder={t('workflow.selectModel')}
          />
          <FieldLabel>{t('workflow.labelSystemPrompt')}</FieldLabel>
          <TextArea value={d.system_prompt as string} onChange={v => set('system_prompt', v)} placeholder="You are..." rows={4} />
          <FieldLabel>{t('workflow.labelUserPrompt')}</FieldLabel>
          <TextArea value={d.user_prompt as string} onChange={v => set('user_prompt', v)} placeholder="{{input}}" rows={3} />
          <FieldLabel>{t('workflow.labelTemperature')}</FieldLabel>
          <SliderInput value={d.temperature as number ?? 0.7} onChange={v => set('temperature', v)} />
        </>
      )}

      {/* knowledge_base */}
      {nodeType === 'knowledge_base' && (
        <>
          <FieldLabel>{t('workflow.labelKnowledgeBase')}</FieldLabel>
          <SelectInput
            value={d.kb_id as string}
            onChange={v => set('kb_id', v)}
            options={availableKbs.map(k => ({ value: k.id as string, label: ln(k) }))}
            placeholder={t('workflow.selectKb')}
          />
          <FieldLabel>{t('workflow.labelQuery')}</FieldLabel>
          <TextArea value={d.query as string} onChange={v => set('query', v)} placeholder="{{input}}" rows={2} />
        </>
      )}

      {/* dify */}
      {nodeType === 'dify' && (
        <>
          <FieldLabel>{t('workflow.labelApiConnector')}</FieldLabel>
          <SelectInput
            value={String(d.dify_kb_id ?? '')}
            onChange={v => set('dify_kb_id', v ? parseInt(v) : null)}
            options={availableDifyKbs.map(k => ({ value: String(k.id), label: ln(k) }))}
            placeholder={t('workflow.selectApiConnector')}
          />
          <FieldLabel>{t('workflow.labelQuery')}</FieldLabel>
          <TextArea value={d.query as string} onChange={v => set('query', v)} placeholder="{{input}}" rows={2} />
        </>
      )}

      {/* mcp_tool */}
      {nodeType === 'mcp_tool' && (
        <>
          <FieldLabel>{t('workflow.labelMcpServer')}</FieldLabel>
          <SelectInput
            value={String(d.server_id ?? '')}
            onChange={v => set('server_id', v ? parseInt(v) : null)}
            options={availableMcpServers.map(s => ({ value: String(s.id), label: ln(s) }))}
            placeholder={t('workflow.selectMcpServer')}
          />
          <FieldLabel>{t('workflow.labelToolName')}</FieldLabel>
          <TextInput value={d.tool_name as string} onChange={v => set('tool_name', v)} placeholder="tool_name" />
          <FieldLabel>{t('workflow.labelArgs')}</FieldLabel>
          <TextArea value={d.args as string || '{}'} onChange={v => set('args', v)} placeholder='{"key":"value"}' mono rows={4} />
        </>
      )}

      {/* skill */}
      {nodeType === 'skill' && (
        <>
          <FieldLabel>{t('workflow.labelSkill')}</FieldLabel>
          <SelectInput
            value={String(d.skill_id ?? '')}
            onChange={v => set('skill_id', v ? parseInt(v) : null)}
            options={availableSkills.map(s => ({ value: String(s.id), label: ln(s) }))}
            placeholder={t('workflow.selectSkill')}
          />
          <FieldLabel>{t('workflow.labelInput')}</FieldLabel>
          <TextArea value={d.input as string} onChange={v => set('input', v)} placeholder="{{input}}" rows={3} />
        </>
      )}

      {/* code */}
      {nodeType === 'code' && (
        <>
          <FieldLabel>{t('workflow.labelCode')}</FieldLabel>
          <TextArea
            value={d.code as string}
            onChange={v => set('code', v)}
            placeholder="// JavaScript code here&#10;return { result: input }"
            mono
            rows={10}
          />
        </>
      )}

      {/* http_request */}
      {nodeType === 'http_request' && (
        <>
          <FieldLabel>URL</FieldLabel>
          <TextInput value={d.url as string} onChange={v => set('url', v)} placeholder="https://api.example.com/..." />
          <FieldLabel>{t('workflow.labelMethod')}</FieldLabel>
          <SelectInput
            value={d.method as string || 'GET'}
            onChange={v => set('method', v)}
            options={[
              { value: 'GET', label: 'GET' },
              { value: 'POST', label: 'POST' },
              { value: 'PUT', label: 'PUT' },
              { value: 'DELETE', label: 'DELETE' },
              { value: 'PATCH', label: 'PATCH' },
            ]}
          />
          <FieldLabel>Headers (JSON)</FieldLabel>
          <TextArea value={d.headers as string || '{}'} onChange={v => set('headers', v)} placeholder='{"Authorization":"Bearer ..."}' mono rows={3} />
          <FieldLabel>Body</FieldLabel>
          <TextArea value={d.body as string} onChange={v => set('body', v)} placeholder='{"key":"value"}' mono rows={4} />
        </>
      )}

      {/* condition */}
      {nodeType === 'condition' && (
        <>
          <FieldLabel>{t('workflow.labelConditionRules')}</FieldLabel>
          <ConditionRulesEditor
            rules={d.rules as ConditionRule[] || []}
            onChange={v => set('rules', v)}
            allNodes={allNodes}
          />
        </>
      )}

      {/* template */}
      {nodeType === 'template' && (
        <>
          <FieldLabel>{t('workflow.labelTemplateContent')}</FieldLabel>
          <TextArea
            value={d.template as string}
            onChange={v => set('template', v)}
            placeholder={t('workflow.templatePlaceholder')}
            rows={8}
          />
        </>
      )}

      {/* output */}
      {nodeType === 'output' && (
        <>
          <FieldLabel>{t('workflow.labelOutputFormat')}</FieldLabel>
          <TextArea
            value={d.format as string}
            onChange={v => set('format', v)}
            placeholder="{{result}}"
            rows={6}
          />
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Node Palette (left sidebar)                                        */
/* ------------------------------------------------------------------ */

function NodePalette() {
  const { t } = useTranslation()
  const onDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData('application/workflow-node-type', type)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className="w-40 bg-white border-r border-slate-200 p-2 overflow-y-auto flex-shrink-0">
      <div className="text-xs font-semibold text-slate-500 mb-2 px-1 uppercase tracking-wide">{t('workflow.nodeTypes')}</div>
      {NODE_DEFS.map(nt => {
        const Icon = nt.icon
        return (
          <div
            key={nt.type}
            draggable
            onDragStart={e => onDragStart(e, nt.type)}
            className="flex items-center gap-2 px-2 py-1.5 rounded cursor-grab hover:bg-slate-50 active:cursor-grabbing mb-0.5 text-sm select-none transition-colors"
          >
            <div className={`p-1 rounded ${nt.color}`}><Icon size={12} /></div>
            <span className="text-slate-700">{t(nt.labelKey)}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Inner Editor (needs ReactFlowProvider as ancestor)                 */
/* ------------------------------------------------------------------ */

function WorkflowEditorInner({
  value, onChange, availableKbs = [], availableDifyKbs = [],
  availableMcpServers = [], availableSkills = [], availableModels = [],
}: WorkflowEditorProps) {
  const { t } = useTranslation()
  const reactFlowInstance = useReactFlow()
  const reactFlowWrapper = useRef<HTMLDivElement>(null)

  /* ---- Parse initial value ---- */
  const initial = useMemo(() => {
    try {
      const parsed = JSON.parse(value || '{}')
      return {
        nodes: (parsed.nodes || []).map((n: any) => ({
          id: n.id,
          type: 'workflowNode',
          position: n.position || { x: 250, y: 100 },
          data: {
            ...n.data,
            nodeType: n.type || n.data?.nodeType,
            label: n.data?.label || t(getNodeDef(n.type || n.data?.nodeType || 'start').labelKey),
          },
        })),
        edges: (parsed.edges || []).map((e: any, i: number) => ({
          id: e.id || `e-${i}`,
          source: e.from || e.source,
          target: e.to || e.target,
          sourceHandle: e.sourceHandle,
          label: e.label,
          animated: true,
          style: { stroke: '#94a3b8', strokeWidth: 2 },
        })),
      }
    } catch {
      return { nodes: [], edges: [] }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const selectedNode = useMemo(
    () => nodes.find(n => n.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
  )

  /* ---- Sync to parent ---- */
  const syncToParent = useCallback(() => {
    const wf = {
      nodes: nodes.map(n => {
        const { nodeType, label, ...rest } = n.data as Record<string, unknown>
        return {
          id: n.id,
          type: nodeType,
          position: n.position,
          data: { label, ...rest },
        }
      }),
      edges: edges.map(e => ({
        id: e.id,
        from: e.source,
        to: e.target,
        sourceHandle: e.sourceHandle,
        label: e.label,
      })),
    }
    onChange(JSON.stringify(wf, null, 2))
  }, [nodes, edges, onChange])

  /* ---- Connect ---- */
  const onConnect: OnConnect = useCallback(
    (params: Connection) =>
      setEdges(eds =>
        addEdge({ ...params, animated: true, style: { stroke: '#94a3b8', strokeWidth: 2 } }, eds),
      ),
    [setEdges],
  )

  /* ---- Drop from palette ---- */
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData('application/workflow-node-type')
      if (!type) return

      const bounds = reactFlowWrapper.current?.getBoundingClientRect()
      if (!bounds) return

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const id = `${type}_${Date.now()}`
      const def = getNodeDef(type)
      const newNode: Node = {
        id,
        type: 'workflowNode',
        position,
        data: { nodeType: type, label: t(def.labelKey) },
      }
      setNodes(nds => [...nds, newNode])
    },
    [reactFlowInstance, setNodes],
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  /* ---- Selection ---- */
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id)
  }, [])

  const onPaneClick = useCallback(() => setSelectedNodeId(null), [])

  /* ---- Update / Delete node ---- */
  const updateNodeData = useCallback((nodeId: string, newData: Record<string, unknown>) => {
    setNodes(nds => nds.map(n =>
      n.id === nodeId ? { ...n, data: { ...n.data, ...newData } } : n,
    ))
  }, [setNodes])

  const deleteNode = useCallback((nodeId: string) => {
    setNodes(nds => nds.filter(n => n.id !== nodeId))
    setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId))
    setSelectedNodeId(null)
  }, [setNodes, setEdges])

  /* ---- Custom node types registry ---- */
  const customNodeTypes: NodeTypes = useMemo(() => ({ workflowNode: WorkflowNode }), [])

  /* ---- Keyboard shortcuts ---- */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedNodeId) {
        // Don't delete if user is typing in an input
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        deleteNode(selectedNodeId)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedNodeId, deleteNode])

  return (
    <div className="flex h-[600px] border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
      {/* Left: Node Palette */}
      <NodePalette />

      {/* Center: Flow Canvas */}
      <div className="flex-1 relative" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={customNodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          defaultEdgeOptions={{ animated: true, style: { stroke: '#94a3b8', strokeWidth: 2 } }}
          proOptions={{ hideAttribution: true }}
          className="bg-slate-50"
        >
          <Background color="#cbd5e1" gap={16} size={1} />
          <Controls
            className="!bg-white !border-slate-200 !shadow-sm"
            showInteractive={false}
          />
          <MiniMap
            nodeColor={n => {
              const nt = (n.data?.nodeType as string) || 'start'
              const colorMap: Record<string, string> = {
                start: '#22c55e', llm: '#3b82f6', knowledge_base: '#a855f7',
                dify: '#f97316', mcp_tool: '#64748b', skill: '#eab308',
                code: '#6b7280', http_request: '#06b6d4', condition: '#ef4444',
                template: '#6366f1', output: '#10b981',
              }
              return colorMap[nt] || '#94a3b8'
            }}
            className="!bg-white !border-slate-200"
            maskColor="rgba(241, 245, 249, 0.7)"
          />
        </ReactFlow>

        {/* Save button (floating) */}
        <button
          onClick={syncToParent}
          className="absolute top-3 right-3 z-10 px-3 py-1.5 bg-blue-500 text-white text-xs font-medium rounded-md shadow hover:bg-blue-600 transition-colors flex items-center gap-1"
        >
          {t('workflow.saveWorkflow')}
        </button>
      </div>

      {/* Right: Config Panel */}
      {selectedNode && (
        <div className="w-72 bg-white border-l border-slate-200 flex flex-col flex-shrink-0">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-100">
            <div className="flex items-center gap-2">
              {(() => {
                const def = getNodeDef(selectedNode.data.nodeType as string)
                const Icon = def.icon
                return (
                  <div className={`p-1 rounded ${def.color}`}><Icon size={12} /></div>
                )
              })()}
              <span className="text-sm font-semibold text-slate-700">{t('workflow.nodeConfig')}</span>
            </div>
            <div className="flex gap-0.5">
              <button
                onClick={() => deleteNode(selectedNode.id)}
                className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                title={t('workflow.deleteNode')}
              >
                <Trash2 size={14} />
              </button>
              <button
                onClick={() => setSelectedNodeId(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded transition-colors"
                title={t('workflow.close')}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-3 py-2">
            <NodeConfigPanel
              node={selectedNode}
              onChange={data => updateNodeData(selectedNode.id, data)}
              onDelete={() => deleteNode(selectedNode.id)}
              availableKbs={availableKbs}
              availableDifyKbs={availableDifyKbs}
              availableMcpServers={availableMcpServers}
              availableSkills={availableSkills}
              availableModels={availableModels}
              allNodes={nodes}
            />
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-slate-100">
            <div className="text-[10px] text-slate-400">
              ID: <span className="font-mono">{selectedNode.id}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Exported component (wraps with ReactFlowProvider)                  */
/* ------------------------------------------------------------------ */

export default function WorkflowEditor(props: WorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  )
}
