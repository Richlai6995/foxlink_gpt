import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, RefreshCw, ArrowLeft, ScanLine, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../lib/api'
import { DocTemplate, TemplateSchema, TemplateVariable, DocxSettings } from '../types'
import TemplateCard from '../components/templates/TemplateCard'
import TemplateUploadWizard from '../components/templates/TemplateUploadWizard'
import VariableSchemaEditor from '../components/templates/VariableSchemaEditor'
import StyleEditorTab from '../components/templates/StyleEditorTab'
import PDFFieldEditor from '../components/templates/PDFFieldEditor'
import DocxPreviewTab from '../components/templates/DocxPreviewTab'
import XlsxListFormatTab from '../components/templates/XlsxListFormatTab'

type EditTab = 'basic' | 'variables' | 'style' | 'layout' | 'preview' | 'xlsxformat'

function OcrScanButton({ templateId, onComplete }: { templateId: string; onComplete: (vars: TemplateVariable[]) => void }) {
  const { t } = useTranslation()
  const [scanning, setScanning] = useState(false)
  const [err, setErr] = useState('')

  const run = async () => {
    setScanning(true)
    setErr('')
    try {
      const { data } = await api.post(`/doc-templates/${templateId}/ocr-scan`)
      onComplete(data.schema?.variables || [])
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error || (e as Error).message || t('tpl.ocrFailed'))
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-xs text-red-500">{err}</span>}
      <button
        onClick={run}
        disabled={scanning}
        title={t('tpl.ocrTitle')}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
      >
        {scanning ? <Loader2 size={12} className="animate-spin" /> : <ScanLine size={12} />}
        {scanning ? t('tpl.ocrScanning') : t('tpl.ocrRescan')}
      </button>
    </div>
  )
}

// Edit modal for updating name/description/tags/schema/style
function TemplateEditModal({ template, onClose, onSaved }: {
  template: DocTemplate
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<EditTab>('basic')
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description || '')
  const [isFixedFormat, setIsFixedFormat] = useState(!!template.is_fixed_format)
  const [tags, setTags] = useState<string[]>(() => { try { return JSON.parse(template.tags || '[]') } catch { return [] } })
  const [tagInput, setTagInput] = useState('')
  const [schema, setSchema] = useState<TemplateSchema>(() => { try { return JSON.parse(template.schema_json || '{}') } catch { return { variables: [] } } })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canEdit = template.access_level === 'owner' || template.access_level === 'edit'

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await api.put(`/doc-templates/${template.id}`, {
        name, description, tags, schema_json: schema, is_fixed_format: isFixedFormat,
      })
      onSaved()
      onClose()
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const addTag = () => {
    const v = tagInput.trim()
    if (v && !tags.includes(v)) setTags([...tags, v])
    setTagInput('')
  }

  const isPdf  = template.format === 'pdf' && template.strategy !== 'pdf_form'
  const isDocx = template.format === 'docx'
  const isXlsx = template.format === 'xlsx'

  const TABS: { key: EditTab; label: string }[] = ([
    { key: 'basic',       label: t('tpl.tabs.basic'),      show: true },
    { key: 'variables',   label: t('tpl.tabs.variables'),  show: true },
    { key: 'style',       label: t('tpl.tabs.style'),      show: true },
    { key: 'xlsxformat',  label: t('tpl.tabs.xlsxformat'), show: isXlsx },
    { key: 'layout',      label: t('tpl.tabs.layout'),     show: isPdf },
    { key: 'preview',     label: t('tpl.tabs.preview'),    show: isDocx },
  ] as { key: EditTab; label: string; show: boolean }[]).filter(t => t.show)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[calc(100vw-32px)] h-[calc(100vh-32px)] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-4">
            <span className="font-medium text-sm">{t('tpl.editTemplate')}</span>
            {/* Fixed format toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <button
                onClick={() => canEdit && setIsFixedFormat(!isFixedFormat)}
                className={`w-9 h-5 rounded-full transition relative ${isFixedFormat ? 'bg-blue-600' : 'bg-slate-300'} ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition ${isFixedFormat ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
              <span className={`text-xs ${isFixedFormat ? 'text-blue-600 font-medium' : 'text-slate-500'}`}>
                {t('tpl.fixedFormatMode')}
              </span>
            </label>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b px-5">
          {TABS.map(tb => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition ${tab === tb.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              {tb.label}
              {tb.key === 'style' && isFixedFormat && (
                <span className="ml-1 text-[10px] bg-blue-100 text-blue-600 px-1 rounded">{t('tpl.enabled')}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-5">
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-3">{error}</div>}

          {/* Basic tab */}
          {tab === 'basic' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-500 block mb-1">{t('tpl.basic.name')}</label>
                <input className="w-full border rounded px-3 py-2 text-sm" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">{t('tpl.basic.description')}</label>
                <textarea className="w-full border rounded px-3 py-2 text-sm" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">{t('tpl.basic.tags')}</label>
                <div className="flex flex-wrap gap-1 mb-1">
                  {tags.map(tg => (
                    <span key={tg} className="flex items-center gap-1 bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                      {tg}
                      <button onClick={() => setTags(tags.filter(x => x !== tg))}>✕</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input className="flex-1 border rounded px-2 py-1 text-xs" placeholder={t('tpl.basic.tagPlaceholder')} value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }} />
                  <button onClick={addTag} className="text-xs px-2 py-1 border rounded text-slate-600">{t('tpl.basic.addTag')}</button>
                </div>
              </div>
              {isFixedFormat && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-700">
                  <strong>{t('tpl.fixedFormatMode')}</strong>：{t('tpl.basic.fixedFormatHint')}
                </div>
              )}
              {isDocx && (
                <div className="border rounded-lg px-4 py-3 space-y-2">
                  <div className="text-xs font-medium text-slate-600">{t('tpl.basic.docxSettings')}</div>
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-slate-500 w-32">{t('tpl.basic.cellSpacing')}</label>
                    <input
                      type="number" min={0} max={20} step={1}
                      disabled={!canEdit}
                      className="w-20 border rounded px-2 py-1 text-xs disabled:opacity-50"
                      placeholder={t('tpl.basic.cellSpacingPlaceholder')}
                      value={(schema.docx_settings as DocxSettings | undefined)?.cellSpacingAfter ?? ''}
                      onChange={e => setSchema({
                        ...schema,
                        docx_settings: {
                          ...(schema.docx_settings || {}),
                          cellSpacingAfter: e.target.value ? parseFloat(e.target.value) : undefined,
                        },
                      })}
                    />
                    <span className="text-xs text-slate-400">{t('tpl.basic.cellSpacingHint')}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Variables tab */}
          {tab === 'variables' && (
            <VariableSchemaEditor
              variables={schema.variables || []}
              onChange={vars => setSchema({ ...schema, variables: vars })}
              readonly={!canEdit}
              format={template.format}
            />
          )}

          {/* Style tab */}
          {tab === 'style' && (
            <div>
              {!isFixedFormat && (
                <div className="mb-3 text-xs text-slate-500 bg-slate-50 border rounded p-3" dangerouslySetInnerHTML={{ __html: t('tpl.styleNote') }} />
              )}
              <StyleEditorTab
                variables={schema.variables || []}
                onChange={vars => setSchema({ ...schema, variables: vars })}
                readonly={!canEdit}
              />
            </div>
          )}

          {/* Layout tab — PDF only */}
          {tab === 'layout' && (
            <div>
              <div className="mb-2 flex items-start justify-between gap-3">
                <p className="text-xs text-slate-500" dangerouslySetInnerHTML={{ __html: t('tpl.layoutNote') }} />
                {canEdit && (
                  <OcrScanButton
                    templateId={template.id}
                    onComplete={vars => setSchema({ ...schema, variables: vars })}
                  />
                )}
              </div>
              <PDFFieldEditor
                templateId={template.id}
                variables={schema.variables || []}
                onChange={vars => setSchema({ ...schema, variables: vars })}
                readonly={!canEdit}
              />
            </div>
          )}

          {/* XLSX list format tab */}
          {tab === 'xlsxformat' && (
            <XlsxListFormatTab
              settings={schema.xlsx_settings || {}}
              onChange={s => setSchema({ ...schema, xlsx_settings: s })}
              readonly={!canEdit}
            />
          )}

          {/* DOCX preview tab */}
          {tab === 'preview' && (
            <DocxPreviewTab template={template} />
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">{t('tpl.cancel')}</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? t('tpl.saving') : t('tpl.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TemplatesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<DocTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [format, setFormat] = useState('')
  const [showWizard, setShowWizard] = useState(false)
  const [editTarget, setEditTarget] = useState<DocTemplate | null>(null)
  const [fetchError, setFetchError] = useState('')

  const FORMAT_OPTIONS = [
    { value: '', label: t('tpl.allFormats') },
    { value: 'docx', label: 'Word (DOCX)' },
    { value: 'xlsx', label: 'Excel (XLSX)' },
    { value: 'pptx', label: 'PowerPoint (PPTX)' },
    { value: 'pdf', label: 'PDF' },
  ]

  const doFetch = useCallback(async () => {
    setLoading(true)
    setFetchError('')
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (format) params.set('format', format)
      const { data } = await api.get(`/doc-templates?${params}`)
      setTemplates(data)
    } catch (e: any) {
      setFetchError(e.response?.data?.error || e.message || t('tpl.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [search, format, t])

  useEffect(() => { doFetch() }, [doFetch])

  const mine = templates.filter(t => t.access_level === 'owner')
  const sharedToMe = templates.filter(t => t.access_level === 'edit' || t.access_level === 'use')

  const Section = ({ title, items }: { title: string; items: DocTemplate[] }) => (
    items.length > 0 ? (
      <div className="mb-8">
        <h2 className="text-sm font-medium text-slate-700 mb-3">{title}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map(tp => (
            <TemplateCard key={tp.id} template={tp} onRefresh={doFetch} onEdit={setEditTarget} />
          ))}
        </div>
      </div>
    ) : null
  )

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
            title={t('tpl.back')}
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-semibold">{t('tpl.title')}</h1>
            <p className="text-xs text-slate-400 mt-0.5">{t('tpl.subtitle')}</p>
          </div>
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
        >
          <Plus size={15} /> {t('tpl.addTemplate')}
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            className="pl-9 pr-3 py-2 border rounded-lg text-sm w-60"
            placeholder={t('tpl.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="border rounded-lg px-3 py-2 text-sm"
          value={format}
          onChange={e => setFormat(e.target.value)}
        >
          {FORMAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button onClick={doFetch} className="p-2 border rounded-lg text-slate-500 hover:bg-slate-50">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Fetch error */}
      {fetchError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
          {t('tpl.loadError')}{fetchError}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="text-sm text-slate-400 text-center py-12">{t('tpl.loading')}</div>
      ) : fetchError ? null : templates.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">📄</div>
          <div className="text-sm">{t('tpl.empty')}</div>
        </div>
      ) : (
        <>
          <Section title={`📂 ${t('tpl.myTemplates')}`} items={mine} />
          <Section title={`🌐 ${t('tpl.sharedTemplates')}`} items={sharedToMe} />
        </>
      )}

      {/* Modals */}
      {showWizard && (
        <TemplateUploadWizard onCreated={() => { setShowWizard(false); doFetch() }} onClose={() => setShowWizard(false)} />
      )}
      {editTarget && (
        <TemplateEditModal template={editTarget} onClose={() => setEditTarget(null)} onSaved={doFetch} />
      )}
    </div>
  )
}
