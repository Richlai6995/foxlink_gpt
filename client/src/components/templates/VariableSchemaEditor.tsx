import { useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { TemplateVariable, TemplateVariableType, TemplateContentMode, TemplateLoopMode } from '../../types'

interface Props {
  variables: TemplateVariable[]
  onChange: (vars: TemplateVariable[]) => void
  readonly?: boolean
  format?: string
}

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
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)

  const VAR_TYPES: { value: TemplateVariableType; label: string }[] = [
    { value: 'text',   label: t('tpl.vars.text') },
    { value: 'number', label: t('tpl.vars.number') },
    { value: 'date',   label: t('tpl.vars.date') },
    { value: 'select', label: t('tpl.vars.select') },
    { value: 'loop',   label: t('tpl.vars.loop') },
  ]

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
              placeholder={t('tpl.vars.displayName')}
              value={v.label}
              onChange={e => upd({ label: e.target.value })}
            />
            <select
              className="text-xs border rounded px-1.5 py-1"
              value={v.type}
              onChange={e => upd({ type: e.target.value as TemplateVariableType })}
            >
              {VAR_TYPES.map(vt => <option key={vt.value} value={vt.value}>{vt.label}</option>)}
            </select>
            {v.type === 'loop' && (
              <select
                className="text-xs border rounded px-1.5 py-1 bg-blue-50"
                title={t('tpl.vars.loopModeTitle')}
                value={v.loop_mode ?? 'table_rows'}
                onChange={e => upd({ loop_mode: e.target.value as TemplateLoopMode })}
              >
                <option value="table_rows">{t('tpl.vars.tableRows')}</option>
                <option value="text_list">{t('tpl.vars.textList')}</option>
              </select>
            )}
            <label className="flex items-center gap-1 text-xs text-slate-500">
              <input type="checkbox" checked={v.required} onChange={e => upd({ required: e.target.checked })} />
              {t('tpl.vars.required')}
            </label>
            {v.type !== 'loop' && (
              <div className="flex rounded border text-xs overflow-hidden" title={t('tpl.vars.contentMode')}>
                {(['variable', 'static', 'empty'] as TemplateContentMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => upd({ content_mode: m })}
                    title={{ variable: t('tpl.vars.modeVariable'), static: t('tpl.vars.modeStatic'), empty: t('tpl.vars.modeEmpty') }[m]}
                    className={`px-1.5 py-0.5 transition ${(v.content_mode ?? 'variable') === m ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-100'}`}
                  >
                    {m === 'variable' ? 'V' : m === 'static' ? 'T' : '∅'}
                  </button>
                ))}
              </div>
            )}
            {v.type !== 'loop' && (v.content_mode ?? 'variable') === 'variable' && (
              <button
                onClick={() => upd({ allow_ai_rewrite: !v.allow_ai_rewrite })}
                title={v.allow_ai_rewrite ? t('tpl.vars.aiRewriteOn') : t('tpl.vars.aiRewriteOff')}
                className={`px-1.5 py-0.5 text-xs border rounded transition shrink-0 ${v.allow_ai_rewrite ? 'bg-orange-500 text-white border-orange-500' : 'bg-slate-100 text-slate-500 border-slate-300'}`}
              >
                {t('tpl.vars.aiRewrite')}
              </button>
            )}
            {v.content_mode !== 'empty' && (
              <input
                className="text-xs border rounded px-1.5 py-1 flex-1 min-w-0"
                placeholder={v.content_mode === 'static' ? t('tpl.vars.staticPlaceholder') : t('tpl.vars.defaultPlaceholder')}
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
            <span className="text-xs text-slate-500">{VAR_TYPES.find(vt => vt.value === v.type)?.label}</span>
            {v.required && <span className="text-xs text-red-500">{t('tpl.vars.required')}</span>}
            {v.content_mode === 'static' && <span className="text-xs bg-amber-100 text-amber-700 px-1 rounded">{t('tpl.vars.staticBadge')}</span>}
            {v.content_mode === 'empty' && <span className="text-xs bg-slate-100 text-slate-500 px-1 rounded">{t('tpl.vars.emptyBadge')}</span>}
            {v.allow_ai_rewrite && <span className="text-xs bg-orange-100 text-orange-600 px-1 rounded">{t('tpl.vars.aiRewrite')}</span>}
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
              onClick={() => upd({ children: [...(v.children || []), { key: `child_${Date.now()}`, label: t('tpl.vars.subField'), type: 'text', required: false }] })}
              className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1 mt-1"
            >
              <Plus size={12} /> {t('tpl.vars.addSubField')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function VariableSchemaEditor({ variables, onChange, readonly, format }: Props) {
  const { t } = useTranslation()

  const addVar = () => onChange([
    ...variables,
    { key: `var_${Date.now()}`, label: t('tpl.vars.newVariable'), type: 'text', required: false },
  ])

  return (
    <div>
      {format === 'docx' && (
        <div className="mb-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-800 space-y-1.5">
          <div className="font-medium">{t('tpl.vars.docxSyntaxTitle')}</div>
          <div>{t('tpl.vars.docxSyntaxDesc')}</div>
          <div className="font-mono bg-white border border-blue-100 rounded px-3 py-2 space-y-1 text-[11px]">
            {variables.filter(v => v.type !== 'loop').map(v => (
              <div key={v.key}><span className="text-blue-600">{`{${v.key}}`}</span> <span className="text-slate-400">← {v.label}</span></div>
            ))}
            {variables.filter(v => v.type === 'loop').map(v => (
              <div key={v.key}>
                <div><span className="text-green-600">{`{#${v.key}}`}</span> <span className="text-slate-400">← {v.label} {t('tpl.vars.loopStart')}</span></div>
                {(v.children || []).map(c => (
                  <div key={c.key} className="pl-3"><span className="text-blue-600">{`{${c.key}}`}</span> <span className="text-slate-400">← {c.label}</span></div>
                ))}
                <div><span className="text-green-600">{`{/${v.key}}`}</span> <span className="text-slate-400">← {t('tpl.vars.loopEnd')}</span></div>
              </div>
            ))}
          </div>
          <div className="text-slate-500">{t('tpl.vars.docxTableLoopHint')}</div>
        </div>
      )}
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
          <Plus size={13} /> {t('tpl.vars.addVariable')}
        </button>
      )}
    </div>
  )
}
