import { useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { TemplateVariable, TemplateVariableType, TemplateContentMode } from '../../types'

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
            {/* Content mode toggle — only for non-loop vars */}
            {v.type !== 'loop' && (
              <div className="flex rounded border text-xs overflow-hidden" title="內容模式">
                {(['variable', 'static', 'empty'] as TemplateContentMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => upd({ content_mode: m })}
                    title={{ variable: '變數：使用者填入', static: '靜態：固定文字', empty: '清空：保留框格' }[m]}
                    className={`px-1.5 py-0.5 transition ${(v.content_mode ?? 'variable') === m ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-100'}`}
                  >
                    {m === 'variable' ? 'V' : m === 'static' ? 'T' : '∅'}
                  </button>
                ))}
              </div>
            )}
            {/* AI rewrite toggle — only for variable mode */}
            {v.type !== 'loop' && (v.content_mode ?? 'variable') === 'variable' && (
              <button
                onClick={() => upd({ allow_ai_rewrite: !v.allow_ai_rewrite })}
                title={v.allow_ai_rewrite ? '目前：允許AI修改此欄位內容 (點擊關閉)' : '目前：保留原文，AI不可改寫 (點擊開啟AI改寫)'}
                className={`px-1.5 py-0.5 text-xs border rounded transition shrink-0 ${v.allow_ai_rewrite ? 'bg-orange-500 text-white border-orange-500' : 'bg-slate-100 text-slate-500 border-slate-300'}`}
              >
                AI改
              </button>
            )}
            {v.content_mode !== 'empty' && (
              <input
                className="text-xs border rounded px-1.5 py-1 flex-1 min-w-0"
                placeholder={v.content_mode === 'static' ? '固定文字內容' : '預設值'}
                value={v.default_value || ''}
                onChange={e => upd({ default_value: e.target.value })}
              />
            )}
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
            {v.content_mode === 'static' && <span className="text-xs bg-amber-100 text-amber-700 px-1 rounded">固定</span>}
            {v.content_mode === 'empty' && <span className="text-xs bg-slate-100 text-slate-500 px-1 rounded">清空</span>}
            {v.allow_ai_rewrite && <span className="text-xs bg-orange-100 text-orange-600 px-1 rounded">AI改</span>}
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
