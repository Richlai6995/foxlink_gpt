import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, RefreshCw, ArrowLeft, ScanLine, Loader2 } from 'lucide-react'
import api from '../lib/api'
import { DocTemplate, TemplateSchema, TemplateVariable } from '../types'
import TemplateCard from '../components/templates/TemplateCard'
import TemplateUploadWizard from '../components/templates/TemplateUploadWizard'
import VariableSchemaEditor from '../components/templates/VariableSchemaEditor'
import StyleEditorTab from '../components/templates/StyleEditorTab'
import PDFFieldEditor from '../components/templates/PDFFieldEditor'

const FORMAT_OPTIONS = [
  { value: '', label: '所有格式' },
  { value: 'docx', label: 'Word (DOCX)' },
  { value: 'xlsx', label: 'Excel (XLSX)' },
  { value: 'pptx', label: 'PowerPoint (PPTX)' },
  { value: 'pdf', label: 'PDF' },
]

type EditTab = 'basic' | 'variables' | 'style' | 'layout'

function OcrScanButton({ templateId, onComplete }: { templateId: string; onComplete: (vars: TemplateVariable[]) => void }) {
  const [scanning, setScanning] = useState(false)
  const [err, setErr] = useState('')

  const run = async () => {
    setScanning(true)
    setErr('')
    try {
      const { data } = await api.post(`/doc-templates/${templateId}/ocr-scan`)
      onComplete(data.schema?.variables || [])
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error || (e as Error).message || 'OCR 失敗')
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
        title="使用 Gemini Vision 重新 OCR 掃描此 PDF，自動填入欄位座標"
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
      >
        {scanning ? <Loader2 size={12} className="animate-spin" /> : <ScanLine size={12} />}
        {scanning ? 'OCR 掃描中...' : 'OCR 重新掃描'}
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
    const t = tagInput.trim()
    if (t && !tags.includes(t)) setTags([...tags, t])
    setTagInput('')
  }

  const isPdf = template.format === 'pdf' && template.strategy !== 'pdf_form'

  const TABS: { key: EditTab; label: string; pdfOnly?: boolean }[] = [
    { key: 'basic',     label: '基本資訊' },
    { key: 'variables', label: '變數設定' },
    { key: 'style',     label: '樣式設定' },
    { key: 'layout',    label: '版面編輯器', pdfOnly: true },
  ].filter(t => !t.pdfOnly || isPdf)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[calc(100vw-32px)] h-[calc(100vh-32px)] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-4">
            <span className="font-medium text-sm">編輯範本</span>
            {/* Fixed format toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <button
                onClick={() => canEdit && setIsFixedFormat(!isFixedFormat)}
                className={`w-9 h-5 rounded-full transition relative ${isFixedFormat ? 'bg-blue-600' : 'bg-slate-300'} ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition ${isFixedFormat ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
              <span className={`text-xs ${isFixedFormat ? 'text-blue-600 font-medium' : 'text-slate-500'}`}>
                固定格式模式
              </span>
            </label>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b px-5">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition ${tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              {t.label}
              {t.key === 'style' && isFixedFormat && (
                <span className="ml-1 text-[10px] bg-blue-100 text-blue-600 px-1 rounded">啟用</span>
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
                <label className="text-xs text-slate-500 block mb-1">範本名稱</label>
                <input className="w-full border rounded px-3 py-2 text-sm" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">描述</label>
                <textarea className="w-full border rounded px-3 py-2 text-sm" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">標籤</label>
                <div className="flex flex-wrap gap-1 mb-1">
                  {tags.map(t => (
                    <span key={t} className="flex items-center gap-1 bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                      {t}
                      <button onClick={() => setTags(tags.filter(x => x !== t))}>✕</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input className="flex-1 border rounded px-2 py-1 text-xs" placeholder="輸入標籤後按 Enter" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }} />
                  <button onClick={addTag} className="text-xs px-2 py-1 border rounded text-slate-600">新增</button>
                </div>
              </div>
              {isFixedFormat && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-700">
                  <strong>固定格式模式已啟用</strong>：生成時每個儲存格將套用「樣式設定」頁籤中的字型/顏色/溢位設定。
                  DOCX 可另在各 loop 變數的 <code>docx_style.rowHeightPt</code> 設定固定列高。
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
            />
          )}

          {/* Style tab */}
          {tab === 'style' && (
            <div>
              {!isFixedFormat && (
                <div className="mb-3 text-xs text-slate-500 bg-slate-50 border rounded p-3">
                  樣式設定在「固定格式模式」關閉時不會套用。請先在標題列開啟固定格式模式。
                </div>
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
                <p className="text-xs text-slate-500">
                  在下方 PDF 預覽上，先選取右上方「選擇變數」下拉後拖拉畫框，即可定義該欄位的填寫位置。
                  已定位的欄位將在生成時以 <strong>疊加模式</strong> 寫入原始 PDF。
                </p>
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
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">取消</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? '儲存中...' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TemplatesPage() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<DocTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [format, setFormat] = useState('')
  const [showWizard, setShowWizard] = useState(false)
  const [editTarget, setEditTarget] = useState<DocTemplate | null>(null)
  const [fetchError, setFetchError] = useState('')

  const fetch = useCallback(async () => {
    setLoading(true)
    setFetchError('')
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (format) params.set('format', format)
      const { data } = await api.get(`/doc-templates?${params}`)
      setTemplates(data)
    } catch (e: any) {
      setFetchError(e.response?.data?.error || e.message || '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [search, format])

  useEffect(() => { fetch() }, [fetch])

  const mine = templates.filter(t => t.access_level === 'owner')
  const sharedToMe = templates.filter(t => t.access_level === 'edit' || t.access_level === 'use')

  const Section = ({ title, items }: { title: string; items: DocTemplate[] }) => (
    items.length > 0 ? (
      <div className="mb-8">
        <h2 className="text-sm font-medium text-slate-700 mb-3">{title}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map(t => (
            <TemplateCard key={t.id} template={t} onRefresh={fetch} onEdit={setEditTarget} />
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
            title="返回"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-semibold">文件範本庫</h1>
            <p className="text-xs text-slate-400 mt-0.5">上傳文件，由 AI 識別變數，可重複使用、分享給他人</p>
          </div>
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
        >
          <Plus size={15} /> 新增範本
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            className="pl-9 pr-3 py-2 border rounded-lg text-sm w-60"
            placeholder="搜尋範本名稱..."
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
        <button onClick={fetch} className="p-2 border rounded-lg text-slate-500 hover:bg-slate-50">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Fetch error */}
      {fetchError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
          載入錯誤：{fetchError}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="text-sm text-slate-400 text-center py-12">載入中...</div>
      ) : fetchError ? null : templates.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">📄</div>
          <div className="text-sm">尚無範本，點擊「新增範本」上傳第一份文件</div>
        </div>
      ) : (
        <>
          <Section title="📂 我的範本" items={mine} />
          <Section title="🌐 分享給我 / 公開範本" items={sharedToMe} />
        </>
      )}

      {/* Modals */}
      {showWizard && (
        <TemplateUploadWizard onCreated={() => { setShowWizard(false); fetch() }} onClose={() => setShowWizard(false)} />
      )}
      {editTarget && (
        <TemplateEditModal template={editTarget} onClose={() => setEditTarget(null)} onSaved={fetch} />
      )}
    </div>
  )
}
