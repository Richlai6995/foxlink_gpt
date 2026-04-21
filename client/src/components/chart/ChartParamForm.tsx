/**
 * ChartParamForm — Phase 5:打開 user chart 時的參數填寫表單
 *
 * 支援 5 種 type:text / number / date / select / boolean
 * onSubmit 帶回 { key: value } map,父層送去 /api/user-charts/:id/execute
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UserChartParam } from '../../types'

interface Props {
  params: UserChartParam[]
  initial?: Record<string, unknown>
  busy?: boolean
  onSubmit: (values: Record<string, unknown>) => void
}

export default function ChartParamForm({ params, initial, busy, onSubmit }: Props) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = { ...(initial || {}) }
    for (const p of params) {
      if (init[p.key] === undefined && p.default !== undefined) init[p.key] = p.default
    }
    return init
  })

  const handleChange = (k: string, v: unknown) => setValues(prev => ({ ...prev, [k]: v }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // 簡單必填檢查
    for (const p of params) {
      if (p.required && (values[p.key] === undefined || values[p.key] === '')) {
        alert(t('chart.param.required', '請填寫:') + p.label)
        return
      }
    }
    onSubmit(values)
  }

  if (!params || params.length === 0) {
    return (
      <button
        onClick={() => onSubmit({})}
        disabled={busy}
        className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
      >
        {busy ? t('chart.param.running', '執行中...') : t('chart.param.run', '執行')}
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-3 bg-slate-50 border border-slate-200 rounded">
      {params.map(p => (
        <div key={p.key} className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-700">
            {p.label}
            {p.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          {p.type === 'text' && (
            <input
              type="text"
              value={String(values[p.key] ?? '')}
              onChange={e => handleChange(p.key, e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded text-sm"
            />
          )}
          {p.type === 'number' && (
            <input
              type="number"
              value={String(values[p.key] ?? '')}
              onChange={e => handleChange(p.key, e.target.value === '' ? '' : Number(e.target.value))}
              className="px-2 py-1 border border-slate-300 rounded text-sm"
            />
          )}
          {p.type === 'date' && (
            <input
              type="date"
              value={String(values[p.key] ?? '')}
              onChange={e => handleChange(p.key, e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded text-sm"
            />
          )}
          {p.type === 'select' && (
            <select
              value={String(values[p.key] ?? '')}
              onChange={e => handleChange(p.key, e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded text-sm bg-white"
            >
              <option value="">--</option>
              {(p.options || []).map(o => (
                <option key={o.value} value={o.value}>{o.label || o.value}</option>
              ))}
            </select>
          )}
          {p.type === 'boolean' && (
            <input
              type="checkbox"
              checked={!!values[p.key]}
              onChange={e => handleChange(p.key, e.target.checked)}
              className="self-start"
            />
          )}
        </div>
      ))}
      <button
        type="submit"
        disabled={busy}
        className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
      >
        {busy ? t('chart.param.running', '執行中...') : t('chart.param.run', '執行')}
      </button>
    </form>
  )
}
