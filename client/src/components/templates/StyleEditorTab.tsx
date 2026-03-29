import { useTranslation } from 'react-i18next'
import { TemplateVariable, VariableStyleProps, TemplateOverflow } from '../../types'
import ColorPicker from './ColorPicker'

interface Props {
  variables: TemplateVariable[]
  onChange: (vars: TemplateVariable[]) => void
  readonly?: boolean
}

const LINE_SPACING_OPTIONS = [1.0, 1.15, 1.5, 2.0, 2.5, 3.0]

function flattenVars(vars: TemplateVariable[]): { v: TemplateVariable; path: number[]; isChild: boolean }[] {
  const rows: { v: TemplateVariable; path: number[]; isChild: boolean }[] = []
  vars.forEach((v, i) => {
    rows.push({ v, path: [i], isChild: false })
    if (v.type === 'loop') {
      (v.children || []).forEach((c, j) => {
        rows.push({ v: c, path: [i, j], isChild: true })
      })
    }
  })
  return rows
}

function effectiveStyle(v: TemplateVariable): VariableStyleProps {
  return { ...v.style?.detected, ...v.style?.override }
}

function updateAtPath(vars: TemplateVariable[], path: number[], updater: (v: TemplateVariable) => TemplateVariable): TemplateVariable[] {
  const [i, j] = path
  if (j === undefined) {
    return vars.map((v, idx) => idx === i ? updater(v) : v)
  }
  return vars.map((v, idx) => {
    if (idx !== i) return v
    return { ...v, children: (v.children || []).map((c, ci) => ci === j ? updater(c) : c) }
  })
}

function patchOverride(v: TemplateVariable, patch: Partial<VariableStyleProps>): TemplateVariable {
  const existing = v.style?.override || {}
  const next = { ...existing }
  for (const [k, val] of Object.entries(patch)) {
    if (val === '' || val === undefined || val === null) {
      delete next[k as keyof VariableStyleProps]
    } else {
      (next as Record<string, unknown>)[k] = val
    }
  }
  return { ...v, style: { ...(v.style || {}), override: Object.keys(next).length ? next : undefined } }
}

export default function StyleEditorTab({ variables, onChange, readonly }: Props) {
  const { t } = useTranslation()
  const rows = flattenVars(variables)

  const OVERFLOW_OPTIONS: { value: TemplateOverflow; label: string }[] = [
    { value: 'wrap',      label: t('tpl.style.overflowWrap') },
    { value: 'truncate',  label: t('tpl.style.overflowTruncate') },
    { value: 'shrink',    label: t('tpl.style.overflowShrink') },
    { value: 'summarize', label: t('tpl.style.overflowSummarize') },
  ]

  const BULLET_OPTIONS: { value: string; label: string }[] = [
    { value: '',    label: t('tpl.style.inherit') },
    { value: 'none', label: t('tpl.style.none') },
    { value: '•',   label: t('tpl.style.bulletDot') },
    { value: '✓',   label: t('tpl.style.bulletCheck') },
    { value: '■',   label: t('tpl.style.bulletSquare') },
    { value: '○',   label: t('tpl.style.bulletCircle') },
    { value: '▸',   label: t('tpl.style.bulletTriangle') },
    { value: '–',   label: t('tpl.style.bulletDash') },
    { value: '★',   label: t('tpl.style.bulletStar') },
    { value: '➤',   label: t('tpl.style.bulletArrow') },
  ]

  const update = (path: number[], patch: Partial<VariableStyleProps>) => {
    onChange(updateAtPath(variables, path, v => patchOverride(v, patch)))
  }

  const resetOverride = (path: number[]) => {
    onChange(updateAtPath(variables, path, v => ({ ...v, style: { ...(v.style || {}), override: undefined } })))
  }

  if (rows.length === 0) {
    return <div className="text-xs text-slate-400 py-6 text-center">{t('tpl.style.noVars')}</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b text-slate-500">
            <th className="text-left px-2 py-2 w-32">{t('tpl.style.field')}</th>
            <th className="text-left px-2 py-2 w-24">{t('tpl.style.fontSize')}</th>
            <th className="text-center px-2 py-2 w-12">{t('tpl.style.bold')}</th>
            <th className="text-center px-2 py-2 w-12">{t('tpl.style.italic')}</th>
            <th className="text-left px-2 py-2 w-20">{t('tpl.style.lineSpacing')}</th>
            <th className="text-left px-2 py-2 w-24">{t('tpl.style.bullet')}</th>
            <th className="text-left px-2 py-2 w-24">{t('tpl.style.fontColor')}</th>
            <th className="text-left px-2 py-2 w-24">{t('tpl.style.bgColor')}</th>
            <th className="text-left px-2 py-2 w-32">{t('tpl.style.overflow')}</th>
            <th className="text-left px-2 py-2 w-20">{t('tpl.style.maxChars')}</th>
            <th className="text-left px-2 py-2 w-20">{t('tpl.style.detectedSource')}</th>
            <th className="px-2 py-2 w-12"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ v, path, isChild }) => {
            const eff = effectiveStyle(v)
            const hasOverride = !!(v.style?.override && Object.keys(v.style.override).length)
            const hasDetected = !!(v.style?.detected && Object.keys(v.style.detected).length)

            return (
              <tr key={path.join('-')} className={`border-b hover:bg-slate-50 ${isChild ? 'bg-blue-50/30' : ''}`}>
                <td className="px-2 py-1.5">
                  <span className={`font-mono ${isChild ? 'text-blue-600 pl-3' : 'text-slate-700'}`}>
                    {isChild ? '↳ ' : ''}{v.label || v.key}
                  </span>
                  <div className="text-slate-400 text-[10px]">{v.key}</div>
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" min={6} max={72} step={0.5} disabled={readonly}
                    className="w-16 border rounded px-1.5 py-0.5 text-xs disabled:opacity-50"
                    placeholder={eff.fontSize ? String(eff.fontSize) : '—'}
                    value={v.style?.override?.fontSize ?? ''}
                    onChange={e => update(path, { fontSize: e.target.value ? parseFloat(e.target.value) : undefined })}
                  />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <input type="checkbox" disabled={readonly} className="disabled:opacity-50"
                    checked={!!(v.style?.override?.bold ?? eff.bold)}
                    onChange={e => update(path, { bold: e.target.checked || undefined })}
                  />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <input type="checkbox" disabled={readonly} className="disabled:opacity-50"
                    checked={!!(v.style?.override?.italic ?? eff.italic)}
                    onChange={e => update(path, { italic: e.target.checked || undefined })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select disabled={readonly} className="border rounded px-1.5 py-0.5 text-xs disabled:opacity-50 w-16"
                    value={v.style?.override?.lineSpacing ?? ''}
                    onChange={e => update(path, { lineSpacing: e.target.value ? parseFloat(e.target.value) : undefined })}
                  >
                    <option value="">{t('tpl.style.inherit')}</option>
                    {LINE_SPACING_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <select disabled={readonly} className="border rounded px-1.5 py-0.5 text-xs disabled:opacity-50 w-20"
                    value={v.style?.override?.bullet ?? ''}
                    onChange={e => update(path, { bullet: e.target.value || undefined })}
                  >
                    {BULLET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  {v.style?.override?.color ? (
                    <div className="flex items-center gap-1">
                      <ColorPicker disabled={readonly} value={v.style.override.color} onChange={hex => update(path, { color: hex })} />
                      {!readonly && (
                        <button onClick={() => update(path, { color: '' })} className="text-[10px] text-slate-400 hover:text-red-500" title={t('tpl.style.clearColorTitle')}>✕</button>
                      )}
                    </div>
                  ) : (
                    <button disabled={readonly} onClick={() => update(path, { color: '#000000' })}
                      className="text-[10px] text-slate-400 border border-dashed border-slate-300 rounded px-1.5 py-0.5 hover:bg-slate-50 disabled:opacity-40"
                      title={t('tpl.style.setFontColorTitle')}
                    >{t('tpl.style.inherit')}</button>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {v.style?.override?.bgColor ? (
                    <div className="flex items-center gap-1">
                      <ColorPicker disabled={readonly} value={v.style.override.bgColor} onChange={hex => update(path, { bgColor: hex })} />
                      {!readonly && (
                        <button onClick={() => update(path, { bgColor: '' })} className="text-[10px] text-slate-400 hover:text-red-500" title={t('tpl.style.clearColorTitle')}>✕</button>
                      )}
                    </div>
                  ) : (
                    <button disabled={readonly} onClick={() => update(path, { bgColor: '#ffffff' })}
                      className="text-[10px] text-slate-400 border border-dashed border-slate-300 rounded px-1.5 py-0.5 hover:bg-slate-50 disabled:opacity-40"
                      title={t('tpl.style.setBgColorTitle')}
                    >{t('tpl.style.inherit')}</button>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <select disabled={readonly} className="border rounded px-1.5 py-0.5 text-xs disabled:opacity-50"
                    value={v.style?.override?.overflow ?? eff.overflow ?? 'wrap'}
                    onChange={e => update(path, { overflow: e.target.value as TemplateOverflow })}
                  >
                    {OVERFLOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" min={10} max={5000} disabled={readonly}
                    className="w-16 border rounded px-1.5 py-0.5 text-xs disabled:opacity-50"
                    placeholder="—" value={v.style?.override?.maxChars ?? ''}
                    onChange={e => update(path, { maxChars: e.target.value ? parseInt(e.target.value) : undefined })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  {hasDetected ? (
                    <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{t('tpl.style.detected')}</span>
                  ) : (
                    <span className="text-[10px] text-slate-300">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {hasOverride && !readonly && (
                    <button onClick={() => resetOverride(path)} className="text-[10px] text-slate-400 hover:text-red-500" title={t('tpl.style.resetTitle')}>
                      {t('tpl.style.reset')}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <p className="text-[10px] text-slate-400 mt-2 px-1">
        {t('tpl.style.footerHint')}
      </p>
    </div>
  )
}
