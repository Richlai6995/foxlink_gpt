import { useEffect, useRef, useState, useMemo } from 'react'
import { renderAsync } from 'docx-preview'
import { Loader2, AlertCircle, Play, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { DocTemplate, TemplateVariable } from '../../types'
import LoopDataTable from './LoopDataTable'

interface Props {
  template: DocTemplate
}

export default function DocxPreviewTab({ template }: Props) {
  const { t } = useTranslation()
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

  useEffect(() => {
    setFetchUrl(`/api/doc-templates/${template.id}/download`)
  }, [template.id])

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
        setError(e.message || t('tpl.docxPreview.renderFailed'))
        setLoading(false)
      })

    return () => ctrl.abort()
  }, [fetchUrl, t])

  const generatePreview = async () => {
    setGenerating(true)
    setError('')
    try {
      const { data } = await api.post(`/doc-templates/${template.id}/generate`, { input_data: values })
      setFetchUrl(data.download_url)
      setMode('generated')
    } catch (e: unknown) {
      setError((e as { message?: string }).message || t('tpl.docxPreview.renderFailed'))
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
      <div className="w-60 flex-shrink-0 flex flex-col gap-3 overflow-auto">
        <div className="text-xs font-medium text-slate-600">{t('tpl.docxPreview.trialData')}</div>

        {formVars.length === 0 && (
          <div className="text-xs text-slate-400">{t('tpl.docxPreview.noVarsNeeded')}</div>
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
                <option value="">{t('tpl.docxPreview.selectPlaceholder')}</option>
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
            {generating ? t('tpl.docxPreview.generating') : t('tpl.docxPreview.generatePreview')}
          </button>
          {mode === 'generated' && (
            <button
              onClick={showTemplate}
              title={t('tpl.docxPreview.backToTemplate')}
              className="p-1.5 border rounded text-slate-500 hover:bg-slate-50"
            >
              <RefreshCw size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="flex items-center gap-2 mb-2 text-xs text-slate-400">
          {mode === 'template' ? t('tpl.docxPreview.templateView') : t('tpl.docxPreview.generatedView')}
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
