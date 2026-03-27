import { useEffect, useRef, useState, useMemo } from 'react'
import { renderAsync } from 'docx-preview'
import { Loader2, AlertCircle, Play, RefreshCw } from 'lucide-react'
import api from '../../lib/api'
import { DocTemplate, TemplateVariable } from '../../types'
import LoopDataTable from './LoopDataTable'

interface Props {
  template: DocTemplate
}

export default function DocxPreviewTab({ template }: Props) {
  const schema = useMemo(() => {
    try { return JSON.parse(template.schema_json || '{}') } catch { return { variables: [] } }
  }, [template.schema_json])
  const variables: TemplateVariable[] = schema.variables || []

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {}
    for (const v of variables) {
      if (v.content_mode === 'static') init[v.key] = v.default_value ?? ''
      else if (v.content_mode === 'empty') init[v.key] = ''
    }
    return init
  })

  const [mode, setMode] = useState<'template' | 'generated'>('template')
  const [generating, setGenerating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fetchUrl, setFetchUrl] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const setVal = (key: string, v: unknown) => setValues(prev => ({ ...prev, [key]: v }))

  // Initial load: show blank template
  useEffect(() => {
    setFetchUrl(`/api/doc-templates/${template.id}/download`)
  }, [template.id])

  // Render docx whenever fetchUrl changes
  useEffect(() => {
    if (!fetchUrl || !containerRef.current) return
    const ctrl = new AbortController()
    setLoading(true)
    setError('')

    const token = localStorage.getItem('token')
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`

    fetch(fetchUrl, { headers, signal: ctrl.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then(buf => {
        if (!containerRef.current) return
        containerRef.current.innerHTML = ''
        return renderAsync(buf, containerRef.current, undefined, {
          className: 'docx-preview',
          inWrapper: true,
          ignoreWidth: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          useBase64URL: true,
        })
      })
      .then(() => setLoading(false))
      .catch(e => {
        if (e.name === 'AbortError') return
        setError(e.message || '渲染失敗')
        setLoading(false)
      })

    return () => ctrl.abort()
  }, [fetchUrl])

  const generatePreview = async () => {
    setGenerating(true)
    setError('')
    try {
      const { data } = await api.post(`/doc-templates/${template.id}/generate`, { input_data: values })
      setFetchUrl(data.download_url)
      setMode('generated')
    } catch (e: unknown) {
      setError((e as { message?: string }).message || '生成失敗')
    } finally {
      setGenerating(false)
    }
  }

  const showTemplate = () => {
    setMode('template')
    setFetchUrl(`/api/doc-templates/${template.id}/download`)
  }

  const formVars = variables.filter(v => (v.content_mode ?? 'variable') === 'variable')

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* Left: form panel */}
      <div className="w-60 flex-shrink-0 flex flex-col gap-3 overflow-auto">
        <div className="text-xs font-medium text-slate-600">試填資料</div>

        {formVars.length === 0 && (
          <div className="text-xs text-slate-400">無需填入的變數</div>
        )}

        {formVars.map(v => (
          <div key={v.key}>
            <label className="text-xs text-slate-500 block mb-0.5">
              {v.label || v.key}
              {v.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            {v.type === 'loop' ? (
              <LoopDataTable
                variable={v}
                value={(values[v.key] as Record<string, string>[]) || []}
                onChange={rows => setVal(v.key, rows)}
              />
            ) : v.type === 'select' ? (
              <select
                className="w-full border rounded px-2 py-1 text-xs"
                value={(values[v.key] as string) || ''}
                onChange={e => setVal(v.key, e.target.value)}
              >
                <option value="">請選擇</option>
                {(v.options || []).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                className="w-full border rounded px-2 py-1 text-xs"
                type={v.type === 'number' ? 'number' : v.type === 'date' ? 'date' : 'text'}
                placeholder={v.placeholder || v.default_value || ''}
                value={(values[v.key] as string) || ''}
                onChange={e => setVal(v.key, e.target.value)}
              />
            )}
          </div>
        ))}

        <div className="flex gap-2 pt-2 border-t sticky bottom-0 bg-white">
          <button
            onClick={generatePreview}
            disabled={generating}
            className="flex items-center gap-1.5 flex-1 justify-center text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {generating ? '生成中...' : '生成預覽'}
          </button>
          {mode === 'generated' && (
            <button
              onClick={showTemplate}
              title="回到原始範本"
              className="p-1.5 border rounded text-slate-500 hover:bg-slate-50"
            >
              <RefreshCw size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Right: docx preview */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="flex items-center gap-2 mb-2 text-xs text-slate-400">
          {mode === 'template' ? '📄 原始範本（含佔位符）' : '✅ 試填結果預覽'}
          {loading && <Loader2 size={12} className="animate-spin" />}
        </div>

        {error && (
          <div className="flex items-center gap-1.5 text-xs text-red-500 bg-red-50 border border-red-200 rounded p-2 mb-2">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <div
          ref={containerRef}
          className="flex-1 overflow-auto border rounded min-h-0"
        />
      </div>
    </div>
  )
}
