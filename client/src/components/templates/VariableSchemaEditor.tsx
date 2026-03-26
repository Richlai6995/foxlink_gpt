import { useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { TemplateVariable, TemplateVariableType } from '../../types'

interface Props {
  variables: TemplateVariable[]
  onChange: (vars: TemplateVariable[]) => void
  readonly?: boolean
}

const VAR_TYPES: { value: TemplateVariableType; label: string }[] = [
  { value: 'text',   label: '文字' },
  { value: 'number', label: '數字' },
  { value: 'date',   label: '日期' },
  { value: 'select', label: '選項' },
  { value: 'loop',   label: '循環（表格行）' },
]

function VarRow({
  v, index, onUpdate, onDelete, level = 0, readonly,
}: {
  v: TemplateVariable
  index: number
  onUpdate: (v: TemplateVariable) => void
  onDelete: () => void
  level?: number
  readonly?: boolean
}) {
  const [expanded, setExpanded] = useState(true)

  const upd = (patch: Partial<TemplateVariable>) => onUpdate({ ...v, ...patch })

  return (
    <div className={`border rounded mb-1 ${level > 0 ? 'ml-6 border-slate-200' : 'border-slate-300'}`}>
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-t">
        {v.type === 'loop' && (
          <button onClick={() => setExpanded(!expanded)} className="text-slate-400">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        {!readonly ? (
          <>
            <input
              className="text-xs border rounded px-1.5 py-1 w-36 font-mono"
              placeholder="variable_key"
              value={v.key}
              onChange={e => upd({ key: e.target.value.replace(/\s+/g, '_') })}
            />
            <input
              className="text-xs border rounded px-1.5 py-1 w-28"
              placeholder="顯示名稱"
              value={v.label}
              onChange={e => upd({ label: e.target.value })}
            />
            <select
              className="text-xs border rounded px-1.5 py-1"
              value={v.type}
              onChange={e => upd({ type: e.target.value as TemplateVariableType })}
            >
              {VAR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs text-slate-500">
              <input type="checkbox" checked={v.required} onChange={e => upd({ required: e.target.checked })} />
              必填
            </label>
            <input
              className="text-xs border rounded px-1.5 py-1 flex-1 min-w-0"
              placeholder="預設值"
              value={v.default_value || ''}
              onChange={e => upd({ default_value: e.target.value })}
            />
            <button onClick={onDelete} className="text-red-400 hover:text-red-600 ml-auto">
              <Trash2 size={13} />
            </button>
          </>
        ) : (
          <>
            <span className="text-xs font-mono text-blue-600 w-36">{`{{${v.key}}}`}</span>
            <span className="text-xs text-slate-700 w-28">{v.label}</span>
            <span className="text-xs text-slate-500">{VAR_TYPES.find(t => t.value === v.type)?.label}</span>
            {v.required && <span className="text-xs text-red-500">必填</span>}
          </>
        )}
      </div>

      {v.type === 'loop' && expanded && (
        <div className="p-2 bg-white">
          {(v.children || []).map((child, ci) => (
            <VarRow
              key={ci}
              v={child}
              index={ci}
              level={level + 1}
              readonly={readonly}
              onUpdate={updated => {
                const children = [...(v.children || [])]
                children[ci] = updated
                upd({ children })
              }}
              onDelete={() => {
                const children = (v.children || []).filter((_, i) => i !== ci)
                upd({ children })
              }}
            />
          ))}
          {!readonly && (
            <button
              onClick={() => upd({ children: [...(v.children || []), { key: `child_${Date.now()}`, label: '子欄位', type: 'text', required: false }] })}
              className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1 mt-1"
            >
              <Plus size={12} /> 新增子欄位
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function VariableSchemaEditor({ variables, onChange, readonly }: Props) {
  const addVar = () => onChange([
    ...variables,
    { key: `var_${Date.now()}`, label: '新變數', type: 'text', required: false },
  ])

  return (
    <div>
      {variables.map((v, i) => (
        <VarRow
          key={i}
          v={v}
          index={i}
          readonly={readonly}
          onUpdate={updated => {
            const next = [...variables]
            next[i] = updated
            onChange(next)
          }}
          onDelete={() => onChange(variables.filter((_, idx) => idx !== i))}
        />
      ))}
      {!readonly && (
        <button
          onClick={addVar}
          className="mt-2 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
        >
          <Plus size={13} /> 新增變數
        </button>
      )}
    </div>
  )
}
