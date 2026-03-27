import { useState } from 'react'
import { X, Download, Loader2 } from 'lucide-react'
import api from '../../lib/api'
import { DocTemplate, TemplateVariable } from '../../types'

interface Props {
  template: DocTemplate
  onClose: () => void
}

function LoopField({ variable, value, onChange }: {
  variable: TemplateVariable
  value: Record<string, string>[]
  onChange: (rows: Record<string, string>[]) => void
}) {
  const addRow = () => onChange([...value, {}])
  const removeRow = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const setCell = (rowIdx: number, key: string, val: string) => {
    const next = [...value]
    next[rowIdx] = { ...next[rowIdx], [key]: val }
    onChange(next)
  }

  return (
    <div>
      <table className="w-full text-xs border-collapse mb-1">
        <thead>
          <tr className="bg-slate-100">
            {(variable.children || []).map(c => (
              <th key={c.key} className="border px-2 py-1 text-left font-medium">{c.label}</th>
            ))}
            <th className="border px-2 py-1 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {value.map((row, ri) => (
            <tr key={ri}>
              {(variable.children || []).map(c => (
                <td key={c.key} className="border px-1 py-0.5">
                  <input
                    className="w-full outline-none text-xs px-1"
                    type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                    value={row[c.key] || ''}
                    onChange={e => setCell(ri, c.key, e.target.value)}
                  />
                </td>
              ))}
              <td className="border px-1 py-0.5 text-center">
                <button onClick={() => removeRow(ri)} className="text-red-400 hover:text-red-600">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addRow} className="text-xs text-blue-500 hover:text-blue-700">+ 新增一行</button>
    </div>
  )
}

export default function TemplateGenerateModal({ template, onClose }: Props) {
  const schema = (() => {
    try { return JSON.parse(template.schema_json || '{}') } catch { return { variables: [] } }
  })()
  const variables: TemplateVariable[] = schema.variables || []

  // Pre-populate static/empty variables; only 'variable' mode vars are shown in form
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {}
    for (const v of variables) {
      if (v.content_mode === 'static') init[v.key] = v.default_value ?? ''
      else if (v.content_mode === 'empty') init[v.key] = ''
    }
    return init
  })
  const [generating, setGenerating] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState('')
  const [error, setError] = useState('')

  const setVal = (key: string, v: unknown) => setValues(prev => ({ ...prev, [key]: v }))

  const generate = async () => {
    setGenerating(true)
    setError('')
    setDownloadUrl('')
    try {
      const { data } = await api.post(`/doc-templates/${template.id}/generate`, {
        input_data: values,
      })
      setDownloadUrl(data.download_url)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[560px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <div className="font-medium text-sm">{template.name}</div>
            <div className="text-xs text-slate-400">填入變數後生成文件</div>
          </div>
          <button onClick={onClose}><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {variables.filter(v => (v.content_mode ?? 'variable') === 'variable').length === 0 && (
            <div className="text-sm text-slate-400 text-center py-4">此範本沒有需要填入的變數</div>
          )}
          {variables.filter(v => (v.content_mode ?? 'variable') === 'variable').map(v => (
            <div key={v.key}>
              <label className="text-xs text-slate-500 block mb-1">
                {v.label}
                {v.required && <span className="text-red-500 ml-0.5">*</span>}
                {v.description && <span className="text-slate-400 ml-1">· {v.description}</span>}
              </label>

              {v.type === 'loop' ? (
                <LoopField
                  variable={v}
                  value={(values[v.key] as Record<string, string>[]) || []}
                  onChange={rows => setVal(v.key, rows)}
                />
              ) : v.type === 'select' ? (
                <select
                  className="w-full border rounded px-3 py-1.5 text-sm"
                  value={(values[v.key] as string) || ''}
                  onChange={e => setVal(v.key, e.target.value)}
                >
                  <option value="">請選擇</option>
                  {(v.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  className="w-full border rounded px-3 py-1.5 text-sm"
                  type={v.type === 'number' ? 'number' : v.type === 'date' ? 'date' : 'text'}
                  placeholder={v.placeholder || v.default_value || ''}
                  value={(values[v.key] as string) || ''}
                  onChange={e => setVal(v.key, e.target.value)}
                />
              )}
            </div>
          ))}

          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}

          {downloadUrl && (
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded p-3">
              <div className="text-xs text-green-700 flex-1">文件生成成功！</div>
              <a
                href={downloadUrl}
                download
                className="flex items-center gap-1 text-xs bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700"
              >
                <Download size={13} /> 下載
              </a>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">關閉</button>
          <button
            onClick={generate}
            disabled={generating}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {generating && <Loader2 size={13} className="animate-spin" />}
            {generating ? '生成中...' : '生成文件'}
          </button>
        </div>
      </div>
    </div>
  )
}
