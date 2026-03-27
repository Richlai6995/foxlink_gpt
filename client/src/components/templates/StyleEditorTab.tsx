import { TemplateVariable, VariableStyleProps, TemplateOverflow } from '../../types'
import ColorPicker from './ColorPicker'

interface Props {
  variables: TemplateVariable[]
  onChange: (vars: TemplateVariable[]) => void
  readonly?: boolean
}

const OVERFLOW_OPTIONS: { value: TemplateOverflow; label: string }[] = [
  { value: 'wrap',      label: '折行（預設）' },
  { value: 'truncate',  label: '截斷 ...' },
  { value: 'shrink',    label: '縮小字型' },
  { value: 'summarize', label: 'AI 摘要' },
]

/** Flatten variables (loop children as sub-rows) for table display */
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

/** Get the effective style for display: override wins over detected */
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
  // If patch value is undefined/null/'', remove the key from override
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
  const rows = flattenVars(variables)

  const update = (path: number[], patch: Partial<VariableStyleProps>) => {
    onChange(updateAtPath(variables, path, v => patchOverride(v, patch)))
  }

  const resetOverride = (path: number[]) => {
    onChange(updateAtPath(variables, path, v => ({ ...v, style: { ...(v.style || {}), override: undefined } })))
  }

  if (rows.length === 0) {
    return <div className="text-xs text-slate-400 py-6 text-center">尚無變數</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b text-slate-500">
            <th className="text-left px-2 py-2 w-32">欄位</th>
            <th className="text-left px-2 py-2 w-24">字型大小 (pt)</th>
            <th className="text-center px-2 py-2 w-12">粗體</th>
            <th className="text-center px-2 py-2 w-12">斜體</th>
            <th className="text-left px-2 py-2 w-24">顏色</th>
            <th className="text-left px-2 py-2 w-32">溢位策略</th>
            <th className="text-left px-2 py-2 w-20">最大字數</th>
            <th className="text-left px-2 py-2 w-20">偵測來源</th>
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
                {/* Label */}
                <td className="px-2 py-1.5">
                  <span className={`font-mono ${isChild ? 'text-blue-600 pl-3' : 'text-slate-700'}`}>
                    {isChild ? '↳ ' : ''}{v.label || v.key}
                  </span>
                  <div className="text-slate-400 text-[10px]">{v.key}</div>
                </td>

                {/* Font size */}
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min={6} max={72} step={0.5}
                    disabled={readonly}
                    className="w-16 border rounded px-1.5 py-0.5 text-xs disabled:opacity-50"
                    placeholder={eff.fontSize ? String(eff.fontSize) : '—'}
                    value={v.style?.override?.fontSize ?? ''}
                    onChange={e => update(path, { fontSize: e.target.value ? parseFloat(e.target.value) : undefined })}
                  />
                </td>

                {/* Bold */}
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    disabled={readonly}
                    className="disabled:opacity-50"
                    checked={!!(v.style?.override?.bold ?? eff.bold)}
                    onChange={e => update(path, { bold: e.target.checked || undefined })}
                  />
                </td>

                {/* Italic */}
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    disabled={readonly}
                    className="disabled:opacity-50"
                    checked={!!(v.style?.override?.italic ?? eff.italic)}
                    onChange={e => update(path, { italic: e.target.checked || undefined })}
                  />
                </td>

                {/* Color */}
                <td className="px-2 py-1.5">
                  <ColorPicker
                    disabled={readonly}
                    value={v.style?.override?.color ?? eff.color ?? '#000000'}
                    onChange={hex => update(path, { color: hex })}
                  />
                </td>

                {/* Overflow */}
                <td className="px-2 py-1.5">
                  <select
                    disabled={readonly}
                    className="border rounded px-1.5 py-0.5 text-xs disabled:opacity-50"
                    value={v.style?.override?.overflow ?? eff.overflow ?? 'wrap'}
                    onChange={e => update(path, { overflow: e.target.value as TemplateOverflow })}
                  >
                    {OVERFLOW_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>

                {/* Max chars */}
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min={10} max={5000}
                    disabled={readonly}
                    className="w-16 border rounded px-1.5 py-0.5 text-xs disabled:opacity-50"
                    placeholder="—"
                    value={v.style?.override?.maxChars ?? ''}
                    onChange={e => update(path, { maxChars: e.target.value ? parseInt(e.target.value) : undefined })}
                  />
                </td>

                {/* Detected source badge */}
                <td className="px-2 py-1.5">
                  {hasDetected ? (
                    <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">已偵測</span>
                  ) : (
                    <span className="text-[10px] text-slate-300">—</span>
                  )}
                </td>

                {/* Reset button */}
                <td className="px-2 py-1.5">
                  {hasOverride && !readonly && (
                    <button
                      onClick={() => resetOverride(path)}
                      className="text-[10px] text-slate-400 hover:text-red-500"
                      title="重設為偵測值"
                    >
                      重設
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <p className="text-[10px] text-slate-400 mt-2 px-1">
        「已偵測」表示從原始範本自動讀取，欄位空白表示使用偵測值。手動設定後可點「重設」還原。非固定格式亦套用 Override 字型/顏色/粗體設定。
      </p>
    </div>
  )
}
