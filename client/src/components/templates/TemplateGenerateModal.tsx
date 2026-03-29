import { useState } from 'react'
import { X, Download, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { DocTemplate, TemplateVariable } from '../../types'
import LoopDataTable from './LoopDataTable'

interface Props {
  template: DocTemplate
  onClose: () => void
}

export default function TemplateGenerateModal({ template, onClose }: Props) {
  const { t } = useTranslation()
  const schema = (() => {
    try { return JSON.parse(template.schema_json || '{}') } catch { return { variables: [] } }
  })()
  const variables: TemplateVariable[] = schema.variables || []

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
  const [outputFormat, setOutputFormat] = useState<string>(template.format)

  const setVal = (key: string, v: unknown) => setValues(prev => ({ ...prev, [key]: v }))

  const generate = async () => {
    setGenerating(true)
    setError('')
    setDownloadUrl('')
    try {
      const { data } = await api.post(`/doc-templates/${template.id}/generate`, {
        input_data: values,
        output_format: outputFormat !== template.format ? outputFormat : undefined,
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
            <div className="text-xs text-slate-400">{t('tpl.generate.subtitle')}</div>
          </div>
          <button onClick={onClose}><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {variables.filter(v => (v.content_mode ?? 'variable') === 'variable').length === 0 && (
            <div className="text-sm text-slate-400 text-center py-4">{t('tpl.generate.noVariables')}</div>
          )}
          {variables.filter(v => (v.content_mode ?? 'variable') === 'variable').map(v => (
            <div key={v.key}>
              <label className="text-xs text-slate-500 block mb-1">
                {v.label}
                {v.required && <span className="text-red-500 ml-0.5">*</span>}
                {v.description && <span className="text-slate-400 ml-1">· {v.description}</span>}
              </label>

              {v.type === 'loop' ? (
                <LoopDataTable
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
                  <option value="">{t('tpl.generate.selectPlaceholder')}</option>
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
              <div className="text-xs text-green-700 flex-1">{t('tpl.generate.success')}</div>
              <a
                href={downloadUrl}
                download
                className="flex items-center gap-1 text-xs bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700"
              >
                <Download size={13} /> {t('tpl.generate.download')}
              </a>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t">
          <div className="flex items-center gap-2">
            {template.format === 'pdf' && (
              <>
                <span className="text-xs text-slate-500">{t('tpl.generate.outputFormat')}</span>
                <div className="flex rounded border text-xs overflow-hidden">
                  {[{ v: 'pdf', label: 'PDF' }, { v: 'docx', label: 'Word' }].map(o => (
                    <button
                      key={o.v}
                      onClick={() => setOutputFormat(o.v)}
                      className={`px-3 py-1 transition ${outputFormat === o.v ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">{t('tpl.generate.close')}</button>
            <button
              onClick={generate}
              disabled={generating}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {generating && <Loader2 size={13} className="animate-spin" />}
              {generating ? t('tpl.generate.generating') : t('tpl.generate.generateDoc')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
