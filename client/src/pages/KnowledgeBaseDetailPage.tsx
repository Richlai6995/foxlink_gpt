import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import KbImage from '../components/KbImage'
import {
  ArrowLeft, Cpu, FileText, Settings, Share2, Search,
  Upload, Trash2, RefreshCw, CheckCircle, XCircle, Clock,
  AlertCircle, Globe, Lock, ChevronDown, ChevronUp, Plus, X,
  User, Building2, Layers, BookOpen, Save, Target, Image, History,
  Pencil, Check, Mail, ShieldAlert,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../lib/api'
import { fmtTW, fmtDateTW } from '../lib/fmtTW'
import { useAuth } from '../context/AuthContext'
import TranslationFields, { type TranslationData } from '../components/common/TranslationFields'
import UserPicker from '../components/common/UserPicker'
import ShareGranteePicker from '../components/common/ShareGranteePicker'
import type { GranteeSelection as GranteeSelectionType } from '../types'
import TagInput from '../components/common/TagInput'
import { buildKbAcceptAttr } from '../lib/uploadFileTypes'

const KB_ACCEPT_ATTR = buildKbAcceptAttr()

// ─── Types ────────────────────────────────────────────────────────────────────

interface KnowledgeBase {
  id: string; name: string; description: string | null
  embedding_model: string; embedding_dims: number
  chunk_strategy: string; chunk_config: Record<string, unknown>
  retrieval_mode: string; rerank_model: string | null
  top_k_fetch: number; top_k_return: number; score_threshold: number
  ocr_model: string | null
  parse_mode: string | null
  pdf_ocr_mode: string | null
  retrieval_config: string | null
  is_public: number; is_confidential?: number; extract_embedded_images?: number; public_status: string
  doc_count: number; chunk_count: number; total_size_bytes: number
  creator_id: number; creator_name: string; is_owner: boolean; can_edit: boolean
  can_view_content?: boolean
  created_at: string; updated_at: string
  tags?: string
}

interface KbDocument {
  id: string; filename: string; file_type: string; file_size: number
  word_count: number | null; chunk_count: number; status: string
  error_msg: string | null; created_at: string
  parse_mode?: string | null; pdf_ocr_mode?: string | null
}

interface KbChunk {
  id: string; position: number; chunk_type: string
  token_count: number; content_preview: string; parent_preview?: string
}

interface SearchResult {
  id: string; doc_id: string; filename: string; position: number
  chunk_type: string; content: string; parent_content?: string
  score: number; match_type: string
}

interface Grant {
  id: string; grantee_type: string; grantee_id: string
  granted_by_name: string; granted_at: string; permission: string
  grantee_name?: string
}

interface OrgOption { code?: string; name: string }

type TabKey = 'docs' | 'images' | 'settings' | 'share' | 'search' | 'history'

const TAB_KEYS: TabKey[] = ['docs', 'images', 'settings', 'share', 'search', 'history']

function DocIcon({ type }: { type: string }) {
  const t = (type || '').toLowerCase()
  if (t === 'pdf') return <FileText size={16} className="text-red-400 flex-shrink-0" />
  if (t === 'docx' || t === 'doc') return <FileText size={16} className="text-blue-400 flex-shrink-0" />
  if (t === 'pptx' || t === 'ppt') return <FileText size={16} className="text-orange-400 flex-shrink-0" />
  if (t === 'xlsx' || t === 'xls') return <FileText size={16} className="text-green-500 flex-shrink-0" />
  if (t === 'eml') return <Mail size={16} className="text-sky-500 flex-shrink-0" />
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(t)) return <Image size={16} className="text-purple-400 flex-shrink-0" />
  return <FileText size={16} className="text-slate-400 flex-shrink-0" />
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function KnowledgeBaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const { t } = useTranslation()

  const [kb, setKb] = useState<KnowledgeBase | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('docs')
  const [error, setError] = useState('')
  const [kbTrans, setKbTrans] = useState<TranslationData>({})
  const [savingTrans, setSavingTrans] = useState(false)
  const [transMsg, setTransMsg] = useState('')
  const [headerEditing, setHeaderEditing] = useState(false)
  const [headerName, setHeaderName] = useState('')
  const [headerDesc, setHeaderDesc] = useState('')
  const [headerSaving, setHeaderSaving] = useState(false)

  const loadKb = useCallback(async () => {
    try {
      const res = await api.get(`/kb/${id}`)
      setKb(res.data)
      setKbTrans({
        name_zh: (res.data as any).name_zh || null, name_en: (res.data as any).name_en || null, name_vi: (res.data as any).name_vi || null,
        desc_zh: (res.data as any).desc_zh || null, desc_en: (res.data as any).desc_en || null, desc_vi: (res.data as any).desc_vi || null,
      })
    } catch (e: any) {
      setError(e.response?.data?.error || t('kb.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadKb() }, [loadKb])

  const saveTranslation = async () => {
    if (!kb) return
    setSavingTrans(true)
    try {
      await api.put(`/kb/${kb.id}`, kbTrans)
      setTransMsg(t('kb.detail.savedOk'))
      setTimeout(() => setTransMsg(''), 2000)
    } catch (e: any) {
      setTransMsg(e.response?.data?.error || t('kb.detail.saveFailed'))
    } finally { setSavingTrans(false) }
  }

  const startHeaderEdit = () => {
    if (!kb) return
    setHeaderName(kb.name)
    setHeaderDesc(kb.description ?? '')
    setHeaderEditing(true)
  }

  const saveHeaderEdit = async () => {
    if (!kb) return
    setHeaderSaving(true)
    try {
      await api.put(`/kb/${kb.id}`, { name: headerName.trim() || kb.name, description: headerDesc.trim() || null })
      setHeaderEditing(false)
      loadKb()
    } catch { /* ignore */ }
    finally { setHeaderSaving(false) }
  }

  const tabLabel = (key: TabKey) => {
    switch (key) {
      case 'docs':     return t('kb.detail.tabDocs')
      case 'images':   return t('kb.detail.tabImages')
      case 'settings': return t('kb.detail.tabSettings')
      case 'share':    return t('kb.detail.tabShare')
      case 'search':   return t('kb.detail.tabSearch')
      case 'history':  return t('kb.detail.tabHistory')
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center text-slate-400">{t('kb.loading')}</div>
  )
  if (error || !kb) return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center">
      <div className="text-center">
        <AlertCircle size={32} className="mx-auto mb-3 text-red-400" />
        <p className="text-slate-600">{error || t('kb.detail.notFound')}</p>
        <button onClick={() => navigate('/kb')} className="mt-4 text-blue-600 text-sm hover:underline">{t('kb.detail.backToList')}</button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <Cpu size={14} className="text-white" />
          </div>
          <span className="font-bold">Cortex</span>
          <span className="text-slate-500 text-sm">/ {t('kb.detail.breadcrumbKb')} /</span>
          <span className="text-white text-sm">{kb.name}</span>
        </div>
        <button onClick={() => navigate('/kb')} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition">
          <ArrowLeft size={15} /> {t('kb.detail.back')}
        </button>
      </header>

      <div className="p-6 max-w-5xl mx-auto space-y-5">
        {/* KB Info card */}
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <BookOpen size={20} className="text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            {headerEditing ? (
              <div className="space-y-1.5">
                <input
                  value={headerName}
                  onChange={(e) => setHeaderName(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400"
                  maxLength={200}
                  autoFocus
                />
                <input
                  value={headerDesc}
                  onChange={(e) => setHeaderDesc(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1 text-xs text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder={t('kb.settings.descLabel')}
                  maxLength={500}
                />
                <div className="flex items-center gap-1.5">
                  <button onClick={saveHeaderEdit} disabled={headerSaving} className="flex items-center gap-1 px-2 py-0.5 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700 disabled:opacity-50">
                    <Check size={12} /> {t('kb.settings.saveBtn')}
                  </button>
                  <button onClick={() => setHeaderEditing(false)} className="px-2 py-0.5 text-xs text-slate-500 hover:text-slate-700">
                    {t('kb.detail.back')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 group">
                <div>
                  <div className="font-semibold text-slate-800">{kb.name}</div>
                  {kb.description && <div className="text-sm text-slate-500 truncate">{kb.description}</div>}
                </div>
                {(kb.can_edit || isAdmin) && (
                  <button onClick={startHeaderEdit} className="opacity-0 group-hover:opacity-100 transition p-1 rounded hover:bg-slate-100" title="編輯名稱/描述">
                    <Pencil size={13} className="text-slate-400" />
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="hidden md:flex items-center gap-4 text-xs text-slate-500">
            <span><span className="font-medium text-slate-700">{kb.doc_count}</span> {t('kb.detail.docCountLabel')}</span>
            <span><span className="font-medium text-slate-700">{kb.chunk_count}</span> {t('kb.detail.chunkCountLabel')}</span>
            <span><span className="font-medium text-slate-700">{formatBytes(kb.total_size_bytes)}</span></span>
            <span className="bg-slate-100 px-2 py-0.5 rounded-full">{kb.embedding_dims}d · {kb.chunk_strategy}</span>
            {kb.is_confidential === 1 ? (
              <span className="flex items-center gap-1 bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full"><ShieldAlert size={10} />{t('kb.statusConfidential')}</span>
            ) : kb.is_public === 1 || kb.public_status === 'public'
              ? <span className="flex items-center gap-1 bg-green-100 text-green-700 px-2 py-0.5 rounded-full"><Globe size={10} />{t('kb.statusPublic')}</span>
              : kb.public_status === 'pending'
              ? <span className="flex items-center gap-1 bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full"><Clock size={10} />{t('kb.statusPending')}</span>
              : <span className="flex items-center gap-1 bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full"><Lock size={10} />{t('kb.statusPrivate')}</span>
            }
          </div>
        </div>

        {/* Translation Card */}
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 space-y-3">
          <TranslationFields
            data={kbTrans}
            onChange={setKbTrans}
            translateUrl={(kb.can_edit || isAdmin) ? `/kb/${kb.id}/translate` : undefined}
            hasDescription
          />
          {(kb.can_edit || isAdmin) && (
            <div className="flex items-center gap-3">
              <button
                onClick={saveTranslation}
                disabled={savingTrans}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                <Save size={12} /> {savingTrans ? t('kb.detail.savingTranslation') : t('kb.detail.saveTranslation')}
              </button>
              {transMsg && <span className={`text-xs ${transMsg.toLowerCase().includes('fail') || transMsg.includes('失') ? 'text-red-500' : 'text-green-600'}`}>{transMsg}</span>}
            </div>
          )}
        </div>

        {/* 保密 KB 內容遮蔽(admin metadata-only) */}
        {kb.can_view_content === false ? (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-8 text-center space-y-3">
            <ShieldAlert size={48} className="mx-auto text-rose-500" />
            <h3 className="text-base font-semibold text-rose-800">{t('kb.confidential.adminMetadataOnlyTitle')}</h3>
            <p className="text-sm text-rose-700/80 max-w-md mx-auto">{t('kb.confidential.adminMetadataOnlyDesc')}</p>
            <div className="text-xs text-rose-700/70 pt-2 border-t border-rose-200 inline-block px-4">
              {t('kb.confidential.contactOwner', { owner: kb.creator_name })}
            </div>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex gap-1 border-b border-slate-200 bg-white rounded-t-xl px-4">
              {TAB_KEYS.map((key) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition -mb-px ${
                    tab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {key === 'docs'     && <FileText  size={14} className="inline mr-1.5" />}
                  {key === 'images'   && <Image     size={14} className="inline mr-1.5" />}
                  {key === 'settings' && <Settings  size={14} className="inline mr-1.5" />}
                  {key === 'share'    && <Share2    size={14} className="inline mr-1.5" />}
                  {key === 'search'   && <Search    size={14} className="inline mr-1.5" />}
                  {key === 'history'  && <History   size={14} className="inline mr-1.5" />}
                  {tabLabel(key)}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="bg-white border border-slate-200 rounded-xl -mt-4 rounded-t-none border-t-0">
              {tab === 'docs'     && <DocumentsTab kb={kb} onRefresh={loadKb} isOwner={kb.can_edit || isAdmin} />}
              {tab === 'images'   && <ImagesTab    kb={kb} isOwner={kb.can_edit || isAdmin} />}
              {tab === 'settings' && <SettingsTab  kb={kb} onSaved={loadKb} isOwner={kb.can_edit || isAdmin} />}
              {tab === 'share'    && <ShareTab     kb={kb} isOwner={kb.is_owner || isAdmin} />}
              {tab === 'search'   && <SearchTab    kb={kb} />}
              {tab === 'history'  && <QueryHistoryTab kbId={kb.id} />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Documents Tab ─────────────────────────────────────────────────────────────

function DocumentsTab({ kb, onRefresh, isOwner }: { kb: KnowledgeBase; onRefresh: () => void; isOwner: boolean }) {
  const { t } = useTranslation()
  const [docs, setDocs] = useState<KbDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadParseMode, setUploadParseMode] = useState<string>('') // '' = use KB default
  const [uploadPdfOcrMode, setUploadPdfOcrMode] = useState<string>('') // '' = use KB default
  const [uploadExtractImages, setUploadExtractImages] = useState<'' | 'true' | 'false'>('') // '' = use KB default
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [chunks, setChunks] = useState<KbChunk[]>([])
  const [chunksLoading, setChunksLoading] = useState(false)
  const [chunkPage, setChunkPage] = useState(1)
  const [chunkTotal, setChunkTotal] = useState(0)
  const [reparseId, setReparseId] = useState<string | null>(null) // doc being reparsed (popover open)
  const [reparseMode, setReparseMode] = useState<string>('')       // chosen pdf_ocr_mode for reparse
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadDocs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get(`/kb/${kb.id}/documents`)
      setDocs(res.data)
    } finally { setLoading(false) }
  }, [kb.id])

  useEffect(() => { loadDocs() }, [loadDocs])

  // Poll processing docs
  useEffect(() => {
    const processing = docs.some((d) => d.status === 'processing')
    if (!processing) return
    const timer = setTimeout(loadDocs, 3000)
    return () => clearTimeout(timer)
  }, [docs, loadDocs])

  const loadChunks = async (docId: string, page = 1) => {
    setChunksLoading(true)
    try {
      const res = await api.get(`/kb/${kb.id}/documents/${docId}/chunks?page=${page}&limit=20`)
      setChunks(res.data.chunks)
      setChunkTotal(res.data.total)
      setChunkPage(page)
    } finally { setChunksLoading(false) }
  }

  const toggleExpand = async (docId: string) => {
    if (expandedId === docId) { setExpandedId(null); return }
    setExpandedId(docId)
    await loadChunks(docId, 1)
  }

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    const fd = new FormData()
    Array.from(files).forEach((f) => fd.append('files', f))
    if (uploadParseMode) fd.append('parse_mode', uploadParseMode)
    if (uploadPdfOcrMode) fd.append('pdf_ocr_mode', uploadPdfOcrMode)
    if (uploadExtractImages) fd.append('extract_images', uploadExtractImages)
    try {
      await api.post(`/kb/${kb.id}/documents`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      await loadDocs()
      onRefresh()
    } catch (e: any) {
      alert(e.response?.data?.error || t('kb.docs.uploadFailed'))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (doc: KbDocument) => {
    if (!confirm(t('kb.docs.deleteConfirm', { name: doc.filename }))) return
    try {
      await api.delete(`/kb/${kb.id}/documents/${doc.id}`)
      setDocs((p) => p.filter((d) => d.id !== doc.id))
      if (expandedId === doc.id) setExpandedId(null)
      onRefresh()
    } catch (e: any) { alert(e.response?.data?.error || t('kb.docs.deleteFailed')) }
  }

  const openReparse = (doc: KbDocument) => {
    setReparseId(doc.id)
    setReparseMode(doc.pdf_ocr_mode || kb.pdf_ocr_mode || 'off')
  }

  const handleReparse = async (doc: KbDocument) => {
    try {
      await api.post(`/kb/${kb.id}/documents/${doc.id}/reparse`, { pdf_ocr_mode: reparseMode })
      setReparseId(null)
      await loadDocs()
    } catch (e: any) {
      alert(e.response?.data?.error || t('kb.docs.reparseFailed'))
    }
  }

  const statusIcon = (status: string) => {
    if (status === 'ready')      return <CheckCircle size={14} className="text-green-500" />
    if (status === 'error')      return <XCircle size={14} className="text-red-500" />
    return <RefreshCw size={14} className="text-blue-500 animate-spin" />
  }

  const parseModeLabel = kb.parse_mode === 'format_aware'
    ? t('kb.docs.parseModeFormatAware')
    : t('kb.docs.parseModeTextOnly')
  const pdfOcrModeKey = (kb.pdf_ocr_mode as 'off' | 'auto' | 'force') || 'off'
  const pdfOcrModeLabel = t(`kb.settings.pdfOcr.${pdfOcrModeKey}`)

  return (
    <div className="p-5 space-y-4">
      {isOwner && (
        <div className="space-y-2">
          {/* Per-upload parse mode override */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 whitespace-nowrap">{t('kb.docs.uploadParseLabel')}</span>
            <select
              value={uploadParseMode}
              onChange={(e) => setUploadParseMode(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">{t('kb.docs.uploadParseDefault', { mode: parseModeLabel })}</option>
              <option value="text_only">{t('kb.docs.parseModeTextOnly')}</option>
              <option value="format_aware">{t('kb.docs.parseModeFormatAware')}</option>
            </select>
            <span className="text-xs text-slate-500 whitespace-nowrap">{t('kb.docs.uploadPdfOcrLabel')}</span>
            <select
              value={uploadPdfOcrMode}
              onChange={(e) => setUploadPdfOcrMode(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">{t('kb.docs.uploadParseDefault', { mode: pdfOcrModeLabel })}</option>
              <option value="off">{t('kb.settings.pdfOcr.off')}</option>
              <option value="auto">{t('kb.settings.pdfOcr.auto')}</option>
              <option value="force">{t('kb.settings.pdfOcr.force')}</option>
            </select>
            <span className="text-xs text-slate-500 whitespace-nowrap">{t('kb.docs.uploadExtractImagesLabel')}</span>
            <select
              value={uploadExtractImages}
              onChange={(e) => setUploadExtractImages(e.target.value as '' | 'true' | 'false')}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">{t('kb.docs.uploadExtractImagesDefault')}</option>
              <option value="true">{t('kb.docs.uploadExtractImagesYes')}</option>
              <option value="false">{t('kb.docs.uploadExtractImagesNo')}</option>
            </select>
          </div>
          <div
            className="border-2 border-dashed border-slate-200 rounded-xl py-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleUpload(e.dataTransfer.files) }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={KB_ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
            <Upload size={24} className="mx-auto mb-2 text-slate-400" />
            <p className="text-sm text-slate-500">{t('kb.docs.dropZoneText')}</p>
            <p className="text-xs text-slate-400 mt-1">{t('kb.docs.dropZoneHint')}</p>
            {uploading && <p className="text-xs text-blue-500 mt-2 animate-pulse">{t('kb.docs.uploading')}</p>}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-slate-400 text-sm">{t('kb.docs.loading')}</div>
      ) : docs.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-sm">{t('kb.docs.empty')}</div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <div key={doc.id} className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <DocIcon type={doc.file_type} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800 text-sm truncate">{doc.filename}</div>
                  <div className="text-xs text-slate-400 flex items-center gap-2">
                    <span>{formatBytes(doc.file_size)}</span>
                    <span>{doc.chunk_count} {t('kb.docs.chunksSuffix')}</span>
                    <span>{fmtDateTW(doc.created_at)}</span>
                    {doc.status === 'error' && <span className="text-red-500">{doc.error_msg?.slice(0, 60)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {statusIcon(doc.status)}
                  {doc.status === 'ready' && (
                    <button
                      onClick={() => toggleExpand(doc.id)}
                      className="p-1 text-slate-400 hover:text-slate-600 transition"
                    >
                      {expandedId === doc.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  )}
                  {isOwner && doc.status !== 'processing' && (
                    <button
                      onClick={() => openReparse(doc)}
                      title={t('kb.docs.reparseBtn')}
                      className="p-1 text-slate-300 hover:text-blue-500 transition"
                    >
                      <RefreshCw size={13} />
                    </button>
                  )}
                  {isOwner && (
                    <button onClick={() => handleDelete(doc)} className="p-1 text-slate-300 hover:text-red-500 transition">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              {reparseId === doc.id && (
                <div className="border-t border-slate-100 bg-blue-50/40 px-4 py-3 space-y-2">
                  <div className="text-xs text-slate-600 font-medium">{t('kb.docs.reparseSelectMode')}</div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['off', 'auto', 'force'] as const).map((m) => (
                      <label
                        key={m}
                        className={`border rounded-lg p-2 cursor-pointer transition text-xs ${
                          reparseMode === m ? 'border-blue-500 bg-blue-100/60' : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          value={m}
                          checked={reparseMode === m}
                          onChange={() => setReparseMode(m)}
                        />
                        <div className="font-medium text-slate-700">{t(`kb.settings.pdfOcr.${m}`)}</div>
                        <div className="text-slate-400 mt-0.5 leading-snug">{t(`kb.settings.pdfOcr.${m}Desc`)}</div>
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 justify-end pt-1">
                    <button
                      onClick={() => setReparseId(null)}
                      className="text-xs px-3 py-1 text-slate-500 hover:text-slate-700"
                    >{t('common.cancel')}</button>
                    <button
                      onClick={() => handleReparse(doc)}
                      className="text-xs px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                    >{t('kb.docs.reparseConfirmBtn')}</button>
                  </div>
                </div>
              )}

              {expandedId === doc.id && (
                <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                  {chunksLoading ? (
                    <div className="text-xs text-slate-400 text-center py-4">{t('kb.docs.loadingChunks')}</div>
                  ) : chunks.length === 0 ? (
                    <div className="text-xs text-slate-400 text-center py-4">{t('kb.docs.noChunks')}</div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {chunks.map((c) => (
                          <div key={c.id} className="bg-white border border-slate-200 rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs text-slate-400">#{c.position + 1}</span>
                              {c.chunk_type !== 'regular' && (
                                <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full">{c.chunk_type}</span>
                              )}
                              <span className="text-xs text-slate-400 ml-auto">≈{c.token_count} tokens</span>
                            </div>
                            <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{c.content_preview}</p>
                            {c.parent_preview && (
                              <p className="text-xs text-slate-400 mt-1 border-t border-slate-100 pt-1">{t('kb.docs.parentChunkLabel')} {c.parent_preview}</p>
                            )}
                          </div>
                        ))}
                      </div>
                      {chunkTotal > 20 && (
                        <div className="flex items-center justify-center gap-2 mt-3">
                          <button
                            disabled={chunkPage <= 1}
                            onClick={() => loadChunks(doc.id, chunkPage - 1)}
                            className="px-3 py-1 text-xs border border-slate-300 rounded disabled:opacity-40 hover:bg-slate-100"
                          >{t('kb.docs.prevPage')}</button>
                          <span className="text-xs text-slate-400">{chunkPage} / {Math.ceil(chunkTotal / 20)}</span>
                          <button
                            disabled={chunkPage >= Math.ceil(chunkTotal / 20)}
                            onClick={() => loadChunks(doc.id, chunkPage + 1)}
                            className="px-3 py-1 text-xs border border-slate-300 rounded disabled:opacity-40 hover:bg-slate-100"
                          >{t('kb.docs.nextPage')}</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Settings Tab ──────────────────────────────────────────────────────────────

function SettingsTab({ kb, onSaved, isOwner }: { kb: KnowledgeBase; onSaved: () => void; isOwner: boolean }) {
  const { t } = useTranslation()
  const { isAdmin, user: authUser } = useAuth()
  const canEditTags = isOwner || isAdmin
  const isCreatorOwner = String(kb.creator_id) === String((authUser as any)?.id || '')
  const defaultCfg = {
    separator:        '\\n\\n',
    max_size:         1024,
    overlap:          50,
    remove_urls:      false,
    parent_separator: '\\n\\n',
    parent_max_size:  1024,
    child_separator:  '\\n',
    child_max_size:   512,
  }
  const merged = { ...defaultCfg, ...(kb.chunk_config as Record<string, unknown>) }

  const [kbName,     setKbName]     = useState(kb.name)
  const [kbDesc,     setKbDesc]     = useState(kb.description ?? '')
  const [confidential, setConfidential] = useState<boolean>(Number(kb.is_confidential) === 1)
  const [extractImages, setExtractImages] = useState<boolean>(Number(kb.extract_embedded_images) !== 0)
  const [strategy,   setStrategy]   = useState(kb.chunk_strategy)
  const [cfg,        setCfg]        = useState<Record<string, unknown>>(merged)
  const [retMode,    setRetMode]    = useState(kb.retrieval_mode)
  const [topKFetch,  setTopKFetch]  = useState(String(kb.top_k_fetch ?? 10))
  const [topKReturn, setTopKReturn] = useState(String(kb.top_k_return ?? 5))
  const [scoreThr,   setScoreThr]   = useState(String(kb.score_threshold ?? 0))
  const [ocrModel,      setOcrModel]      = useState(kb.ocr_model ?? '')
  const [parseMode,     setParseMode]     = useState(kb.parse_mode ?? 'text_only')
  const [pdfOcrMode,    setPdfOcrMode]    = useState<'off' | 'auto' | 'force'>(((kb.pdf_ocr_mode || 'off') as 'off' | 'auto' | 'force'))
  const [useRerank,     setUseRerank]     = useState(kb.rerank_model !== 'disabled')
  const [rerankModel,   setRerankModel]   = useState(kb.rerank_model === 'disabled' ? '' : (kb.rerank_model ?? ''))
  const [llmModels,     setLlmModels]     = useState<{ key: string; name: string; api_model: string; model_role: string | null }[]>([])
  const [thesauri,      setThesauri]      = useState<string[]>([])
  const [saving,        setSaving]        = useState(false)
  const [msg,           setMsg]           = useState('')
  const [kbTags,        setKbTags]        = useState<string[]>(() => { try { return JSON.parse(kb.tags || '[]') } catch { return [] } })

  // ── 進階檢索覆寫（retrieval_config）──────────────────────────────────────
  const parseRc = () => {
    try { return kb.retrieval_config ? JSON.parse(kb.retrieval_config) : null } catch { return null }
  }
  const initialRc = parseRc()
  const [rcEnabled, setRcEnabled] = useState(!!initialRc)
  const [rcShow,    setRcShow]    = useState(!!initialRc)
  const [rcBackend, setRcBackend] = useState<'like' | 'oracle_text' | ''>(initialRc?.backend ?? '')
  const [rcFusion,  setRcFusion]  = useState<'weighted' | 'rrf' | ''>(initialRc?.fusion_method ?? '')
  const [rcVecW,    setRcVecW]    = useState<string>(initialRc?.vector_weight   != null ? String(initialRc.vector_weight)   : '')
  const [rcFtW,     setRcFtW]     = useState<string>(initialRc?.fulltext_weight != null ? String(initialRc.fulltext_weight) : '')
  const [rcFuzzy,   setRcFuzzy]   = useState<boolean>(!!initialRc?.fuzzy)
  const [rcSyn,     setRcSyn]     = useState<string>(initialRc?.synonym_thesaurus ?? '')
  const [rcMinFt,   setRcMinFt]   = useState<string>(initialRc?.min_ft_score   != null ? String(initialRc.min_ft_score)   : '')
  const [rcVecCut,  setRcVecCut]  = useState<string>(initialRc?.vec_cutoff     != null ? String(initialRc.vec_cutoff)     : '')
  const [rcMv,      setRcMv]      = useState<boolean>(!!initialRc?.use_multi_vector)

  const buildRetrievalConfig = (): Record<string, unknown> | null => {
    if (!rcEnabled) return null
    const out: Record<string, unknown> = {}
    if (rcBackend)                                       out.backend           = rcBackend
    if (rcFusion)                                        out.fusion_method     = rcFusion
    if (rcVecW   !== '' && !Number.isNaN(+rcVecW))       out.vector_weight     = +rcVecW
    if (rcFtW    !== '' && !Number.isNaN(+rcFtW))        out.fulltext_weight   = +rcFtW
    if (rcMinFt  !== '' && !Number.isNaN(+rcMinFt))      out.min_ft_score      = +rcMinFt
    if (rcVecCut !== '' && !Number.isNaN(+rcVecCut))     out.vec_cutoff        = +rcVecCut
    if (rcFuzzy)                                         out.fuzzy             = true
    if (rcSyn.trim())                                    out.synonym_thesaurus = rcSyn.trim()
    if (rcMv)                                            out.use_multi_vector  = true
    return Object.keys(out).length > 0 ? out : null
  }

  useEffect(() => {
    api.get('/admin/llm-models').then((res) => {
      const all = (res.data as { key: string; name: string; api_model: string; image_output: number; is_active: number; model_role: string | null }[])
        .filter((m) => m.is_active)
      setLlmModels(all)
      const nonImage = all.filter((m) => !m.image_output)
      if (!ocrModel && nonImage.length > 0) {
        const flash = nonImage.find((m) => m.key.includes('flash') || m.name.toLowerCase().includes('flash'))
        setOcrModel(flash?.api_model ?? nonImage[0].api_model)
      }
    }).catch(() => {})
    api.get('/kb/thesauri-names').then((r) => setThesauri(r.data || [])).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rerankModels = llmModels.filter((m) => m.model_role === 'rerank')

  const setCfgField = (k: string, v: unknown) => setCfg((p) => ({ ...p, [k]: v }))

  const save = async () => {
    setSaving(true); setMsg('')
    const pdfOcrModeChanged = (kb.pdf_ocr_mode || 'off') !== pdfOcrMode
    const parseModeChanged = (kb.parse_mode || 'text_only') !== parseMode
    try {
      const payload: Record<string, unknown> = {
        name:             kbName.trim() || kb.name,
        description:      kbDesc.trim() || null,
        tags:             kbTags,
        chunk_strategy:   strategy,
        chunk_config:     cfg,
        retrieval_mode:   retMode,
        rerank_model:     useRerank ? (rerankModel || null) : 'disabled',
        top_k_fetch:      Number(topKFetch),
        top_k_return:     Number(topKReturn),
        score_threshold:  Number(scoreThr),
        ocr_model:        ocrModel || null,
        parse_mode:       parseMode || 'text_only',
        pdf_ocr_mode:     pdfOcrMode,
        retrieval_config: buildRetrievalConfig(),
      }
      // 保密狀態只有 owner 可切換
      if (isCreatorOwner) payload.is_confidential = confidential
      payload.extract_embedded_images = extractImages
      await api.put(`/kb/${kb.id}`, payload)
      setMsg(t('kb.settings.savedOk'))
      onSaved()
      setTimeout(() => setMsg(''), 2000)

      // If pdf_ocr_mode or parse_mode changed, offer batch reparse
      if ((pdfOcrModeChanged || parseModeChanged) && (kb.doc_count || 0) > 0) {
        if (confirm(t('kb.settings.reparseAllConfirm', { count: kb.doc_count }))) {
          try {
            const res = await api.post(`/kb/${kb.id}/reparse-all`, {
              pdf_ocr_mode: pdfOcrMode,
              parse_mode:   parseMode,
            })
            setMsg(t('kb.settings.reparseAllQueued', { count: res.data.queued }))
            setTimeout(() => setMsg(''), 4000)
          } catch (e: any) {
            setMsg(e.response?.data?.error || t('kb.settings.reparseAllFailed'))
          }
        }
      }
    } catch (e: any) {
      setMsg(e.response?.data?.error || t('kb.settings.saveFailed'))
    } finally { setSaving(false) }
  }

  return (
    <div className="p-5 space-y-6">
      {/* Name & Description */}
      {isOwner && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <BookOpen size={15} className="text-blue-500" /> {t('kb.settings.basicSection')}
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">{t('kb.settings.nameLabel')}</label>
              <input
                value={kbName}
                onChange={(e) => setKbName(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                maxLength={200}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">{t('kb.settings.descLabel')}</label>
              <textarea
                value={kbDesc}
                onChange={(e) => setKbDesc(e.target.value)}
                rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                maxLength={500}
              />
            </div>
          </div>
        </div>
      )}

      {/* 保密 KB toggle — 只有 owner 可改 */}
      {isCreatorOwner && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <ShieldAlert size={15} className="text-rose-500" /> {t('kb.settings.confidentialSection')}
          </h3>
          <label className={`flex items-start gap-2 p-3 border rounded-lg cursor-pointer transition ${confidential ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
            <input
              type="checkbox"
              checked={confidential}
              onChange={(e) => setConfidential(e.target.checked)}
              className="mt-0.5 accent-rose-600"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-700">{t('kb.createModal.confidentialLabel')}</div>
              <p className="text-xs text-slate-500 mt-0.5">{t('kb.createModal.confidentialDesc')}</p>
              {confidential && (kb.is_public === 1 || kb.public_status === 'pending') && (
                <p className="text-xs text-rose-600 mt-1">{t('kb.settings.confidentialWillResetPublic')}</p>
              )}
            </div>
          </label>
        </div>
      )}

      {/* 內嵌圖抽取(owner / editor 可改)*/}
      {isOwner && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Image size={15} className="text-blue-500" /> {t('kb.settings.extractImagesSection')}
          </h3>
          <label className={`flex items-start gap-2 p-3 border rounded-lg cursor-pointer transition ${extractImages ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
            <input
              type="checkbox"
              checked={extractImages}
              onChange={(e) => setExtractImages(e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-700">{t('kb.settings.extractImagesLabel')}</div>
              <p className="text-xs text-slate-500 mt-0.5">{t('kb.settings.extractImagesDesc')}</p>
            </div>
          </label>
        </div>
      )}

      {/* Tags — always visible so all users can see what labels the KB has */}
      <div>
        <label className="block text-xs text-slate-500 mb-1">標籤 (Tags)</label>
        <TagInput tags={kbTags} onChange={setKbTags} disabled={!canEditTags} placeholder="輸入標籤後按 Enter" />
        {!canEditTags && <p className="text-xs text-slate-400 mt-1">僅知識庫擁有者或系統管理員可修改標籤</p>}
      </div>

      {/* Chunk Strategy */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Layers size={15} className="text-blue-500" /> {t('kb.settings.chunkSection')}
        </h3>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[
            { val: 'regular',      label: t('kb.settings.strategyRegular'),      desc: t('kb.settings.strategyRegularDesc') },
            { val: 'parent_child', label: t('kb.settings.strategyParentChild'),  desc: t('kb.settings.strategyParentChildDesc') },
          ].map((opt) => (
            <label key={opt.val} className={`cursor-pointer border rounded-xl p-3 transition ${!isOwner ? 'opacity-60 cursor-not-allowed' : ''} ${strategy === opt.val ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
              <input type="radio" className="sr-only" value={opt.val} checked={strategy === opt.val} disabled={!isOwner} onChange={() => setStrategy(opt.val)} />
              <div className="text-sm font-medium text-slate-700 mb-0.5">{opt.label}</div>
              <div className="text-xs text-slate-400">{opt.desc}</div>
            </label>
          ))}
        </div>

        {strategy === 'regular' ? (
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.settings.separatorLabel')}</label>
                <input value={String(cfg.separator ?? '\\n\\n')} disabled={!isOwner}
                  onChange={(e) => setCfgField('separator', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm font-mono disabled:bg-slate-50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.settings.maxSizeLabel')}</label>
                <input type="number" value={Number(cfg.max_size ?? 1024)} disabled={!isOwner} min={100} max={4096}
                  onChange={(e) => setCfgField('max_size', Number(e.target.value))}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.settings.overlapLabel')}</label>
                <input type="number" value={Number(cfg.overlap ?? 50)} disabled={!isOwner} min={0} max={500}
                  onChange={(e) => setCfgField('overlap', Number(e.target.value))}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" disabled={!isOwner} checked={Boolean(cfg.remove_urls)} onChange={(e) => setCfgField('remove_urls', e.target.checked)} />
              {t('kb.settings.removeUrls')}
            </label>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl p-4 space-y-4">
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{t('kb.settings.parentChunkSection')}</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.settings.separatorLabel')}</label>
                  <input value={String(cfg.parent_separator ?? '\\n\\n')} disabled={!isOwner}
                    onChange={(e) => setCfgField('parent_separator', e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm font-mono disabled:bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.settings.maxSizeLabel')}</label>
                  <input type="number" value={Number(cfg.parent_max_size ?? 1024)} disabled={!isOwner} min={100} max={8192}
                    onChange={(e) => setCfgField('parent_max_size', Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50" />
                </div>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{t('kb.settings.childChunkSection')}</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.settings.separatorLabel')}</label>
                  <input value={String(cfg.child_separator ?? '\\n')} disabled={!isOwner}
                    onChange={(e) => setCfgField('child_separator', e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm font-mono disabled:bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.settings.maxSizeLabel')}</label>
                  <input type="number" value={Number(cfg.child_max_size ?? 512)} disabled={!isOwner} min={50} max={4096}
                    onChange={(e) => setCfgField('child_max_size', Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Retrieval Settings */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Search size={15} className="text-blue-500" /> {t('kb.settings.retrievalSection')}
        </h3>
        <div className="border border-slate-200 rounded-xl p-4 space-y-4">
          {/* Retrieval mode */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">{t('kb.settings.retrievalModeLabel')}</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { val: 'vector',   label: t('kb.settings.modeVector'),   desc: t('kb.settings.modeVectorDesc') },
                { val: 'fulltext', label: t('kb.settings.modeFulltext'), desc: t('kb.settings.modeFulltextDesc') },
                { val: 'hybrid',   label: t('kb.settings.modeHybrid'),   desc: t('kb.settings.modeHybridDesc') },
              ].map((opt) => (
                <label key={opt.val} className={`cursor-pointer border rounded-xl p-3 transition ${!isOwner ? 'opacity-60 cursor-not-allowed' : ''} ${retMode === opt.val ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <input type="radio" className="sr-only" value={opt.val} checked={retMode === opt.val} disabled={!isOwner} onChange={() => setRetMode(opt.val)} />
                  <div className="text-sm font-medium text-slate-700 mb-0.5">{opt.label}</div>
                  <div className="text-xs text-slate-400 leading-relaxed">{opt.desc}</div>
                </label>
              ))}
            </div>
          </div>

          {/* Rerank */}
          <div className="border border-slate-100 rounded-xl p-3 space-y-2.5 bg-slate-50">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-medium text-slate-700">{t('kb.settings.rerankTitle')}</span>
                {rerankModels.length === 0 && (
                  <span className="ml-2 text-xs text-amber-500">{t('kb.settings.rerankNoModel')}</span>
                )}
              </div>
              <label className={`flex items-center gap-2 ${!isOwner ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                <span className="text-xs text-slate-500">{useRerank ? t('kb.settings.rerankEnabled') : t('kb.settings.rerankDisabled')}</span>
                <div
                  onClick={() => isOwner && setUseRerank((p) => !p)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${useRerank ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${useRerank ? 'translate-x-4' : ''}`} />
                </div>
              </label>
            </div>
            {useRerank && (
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('kb.settings.rerankModelLabel')}</label>
                <select
                  value={rerankModel}
                  disabled={!isOwner}
                  onChange={(e) => setRerankModel(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50 bg-white"
                >
                  <option value="">{t('kb.settings.rerankModelAuto')}</option>
                  {rerankModels.map((m) => (
                    <option key={m.key} value={m.key}>{m.name} ({m.api_model})</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-400">{t('kb.settings.rerankAutoNote')}</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.settings.topKFetchLabel')}</label>
              <input type="number" value={topKFetch} disabled={!isOwner} min={1} max={100}
                onChange={(e) => setTopKFetch(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.settings.topKReturnLabel')}</label>
              <input type="number" value={topKReturn} disabled={!isOwner} min={1} max={50}
                onChange={(e) => setTopKReturn(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.settings.scoreThresholdLabel')}</label>
              <input type="number" value={scoreThr} disabled={!isOwner} min={0} max={1} step={0.05}
                onChange={(e) => setScoreThr(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50" />
            </div>
          </div>
          <p className="text-[11px] text-amber-600 mt-2 leading-relaxed">⚠️ {t('kb.settings.scoreThresholdHint')}</p>
        </div>
      </div>

      {/* 進階檢索設定（覆寫系統預設）*/}
      {isOwner && (
        <div>
          <button
            type="button"
            onClick={() => setRcShow((v) => !v)}
            className="w-full flex items-center justify-between text-sm font-semibold text-slate-700 mb-3 py-1"
          >
            <span className="flex items-center gap-2">
              <Target size={15} className="text-purple-500" />
              進階檢索設定（覆寫系統預設）
              {rcEnabled && <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">已啟用</span>}
            </span>
            {rcShow ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          {rcShow && (
            <div className="border border-slate-200 rounded-xl p-4 space-y-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={rcEnabled}
                  onChange={(e) => setRcEnabled(e.target.checked)}
                />
                啟用此 KB 的專屬檢索設定
                <span className="text-xs text-slate-400">未啟用則沿用系統預設</span>
              </label>

              {rcEnabled && (
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Backend</label>
                    <select
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
                      value={rcBackend}
                      onChange={(e) => setRcBackend(e.target.value as any)}
                    >
                      <option value="">— 跟隨系統預設 —</option>
                      <option value="like">LIKE</option>
                      <option value="oracle_text">Oracle Text</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Score Fusion</label>
                    <select
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
                      value={rcFusion}
                      onChange={(e) => setRcFusion(e.target.value as any)}
                    >
                      <option value="">— 跟隨系統預設 —</option>
                      <option value="weighted">Weighted</option>
                      <option value="rrf">RRF</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Vector 權重（0–1，留空 = 預設）</label>
                    <input
                      type="number" step="0.05" min="0" max="1"
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
                      value={rcVecW}
                      onChange={(e) => setRcVecW(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Fulltext 權重（0–1）</label>
                    <input
                      type="number" step="0.05" min="0" max="1"
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
                      value={rcFtW}
                      onChange={(e) => setRcFtW(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">最低 FT Score (0–1)</label>
                    <input
                      type="number" step="0.05" min="0" max="1"
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
                      value={rcMinFt}
                      onChange={(e) => setRcMinFt(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Vector Cutoff (0–1)</label>
                    <input
                      type="number" step="0.05" min="0" max="1"
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
                      value={rcVecCut}
                      onChange={(e) => setRcVecCut(e.target.value)}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={rcFuzzy} onChange={(e) => setRcFuzzy(e.target.checked)} />
                      啟用 Fuzzy 模糊匹配（僅 Oracle Text）
                    </label>
                  </div>
                  <div className="col-span-2">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={rcMv} onChange={(e) => setRcMv(e.target.checked)} />
                      啟用 Multi-vector（title + body 加權向量檢索）
                    </label>
                    <p className="text-xs text-slate-400 pl-6 mt-0.5">
                      啟用後新上傳 chunks 會自動 embed title 向量；既有 chunks 需按上方「補 title 向量」回填。
                    </p>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-slate-500 mb-1">同義詞字典名稱</label>
                    <select
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm"
                      value={rcSyn}
                      onChange={(e) => setRcSyn(e.target.value)}
                    >
                      <option value="">— 不使用 —</option>
                      {thesauri.map((n) => (<option key={n} value={n}>{n}</option>))}
                    </select>
                    <p className="text-xs text-slate-400 mt-0.5">
                      字典管理於 Admin → 「KB 同義詞字典」
                    </p>
                  </div>
                  <p className="col-span-2 text-xs text-slate-400">
                    空欄位會沿用系統預設。關掉上方開關可清除整個覆寫。
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* OCR Model + Parse Mode */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Cpu size={15} className="text-blue-500" /> {t('kb.settings.parseSection')}
        </h3>
        <div className="border border-slate-200 rounded-xl p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.settings.ocrModelLabel')}</label>
            <select
              value={ocrModel}
              disabled={!isOwner}
              onChange={(e) => setOcrModel(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50"
            >
              <option value="">{t('kb.settings.ocrModelDefault')}</option>
              {llmModels.map((m) => (
                <option key={m.key} value={m.api_model}>{m.name} ({m.api_model})</option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-400">{t('kb.settings.ocrModelNote')}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.settings.parseModeLabel')}</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { val: 'text_only',    label: t('kb.settings.parseModeTextOnly'),    desc: t('kb.settings.parseModeTextOnlyDesc') },
                { val: 'format_aware', label: t('kb.settings.parseModeFormatAware'), desc: t('kb.settings.parseModeFormatAwareDesc') },
              ].map((opt) => (
                <label key={opt.val} className={`cursor-pointer border rounded-lg p-2.5 transition ${!isOwner ? 'opacity-60 cursor-not-allowed' : ''} ${parseMode === opt.val ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <input type="radio" className="sr-only" value={opt.val} checked={parseMode === opt.val} disabled={!isOwner} onChange={() => setParseMode(opt.val)} />
                  <div className="text-xs font-medium text-slate-700">{opt.label}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{opt.desc}</div>
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">{t('kb.settings.parseModeNote')}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.settings.pdfOcrLabel')}</label>
            <div className="grid grid-cols-3 gap-2">
              {(['off', 'auto', 'force'] as const).map((val) => (
                <label
                  key={val}
                  className={`cursor-pointer border rounded-lg p-2.5 transition ${!isOwner ? 'opacity-60 cursor-not-allowed' : ''} ${pdfOcrMode === val ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    value={val}
                    checked={pdfOcrMode === val}
                    disabled={!isOwner}
                    onChange={() => setPdfOcrMode(val)}
                  />
                  <div className="text-xs font-medium text-slate-700">{t(`kb.settings.pdfOcr.${val}`)}</div>
                  <div className="text-xs text-slate-400 mt-0.5 leading-snug">{t(`kb.settings.pdfOcr.${val}Desc`)}</div>
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">{t('kb.settings.pdfOcrNote')}</p>
          </div>
        </div>
      </div>

      {isOwner && (
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
            <Save size={14} /> {saving ? t('kb.settings.saving') : t('kb.settings.saveBtn')}
          </button>
          <button
            onClick={async () => {
              if (!confirm(`確定要重新解析此 KB 所有 ${kb.doc_count} 個文件嗎？\n會重新 chunk + embedding（需要 API 費用 + 時間）。\n適用於：chunker 邏輯有更新、想套用最新切塊策略。`)) return
              setSaving(true); setMsg('')
              try {
                const res = await api.post(`/kb/${kb.id}/reparse-all`)
                setMsg(`已排入 ${res.data.queued} 個文件重新解析`)
                onSaved()
                setTimeout(() => setMsg(''), 4000)
              } catch (e: any) {
                setMsg(e.response?.data?.error || '重新解析失敗')
              } finally { setSaving(false) }
            }}
            disabled={saving || (kb.doc_count || 0) === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 transition disabled:opacity-50"
            title="重新 chunk + embedding 所有文件"
          >
            <RefreshCw size={14} /> 重新解析此 KB
          </button>
          <button
            onClick={async () => {
              if (!confirm(`為此 KB 所有無 title_embedding 的 chunks 補 title 向量？\n只 embed title（不重 body），費用低很多。\n前提：KB 已啟用 Multi-vector（進階檢索設定 → use_multi_vector）。`)) return
              setSaving(true); setMsg('')
              try {
                const res = await api.post(`/admin/kb/${kb.id}/backfill-title-embeddings`)
                setMsg(`已排入 ${res.data.queued} 個 chunks 背景補 title 向量`)
                setTimeout(() => setMsg(''), 4000)
              } catch (e: any) {
                setMsg(e.response?.data?.error || '補 title 向量失敗')
              } finally { setSaving(false) }
            }}
            disabled={saving || (kb.chunk_count || 0) === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
            title="只補 title_embedding，不動 body embedding"
          >
            <Target size={14} /> 補 title 向量
          </button>
          {msg && <span className={`text-sm ${msg.toLowerCase().includes('fail') || msg.includes('失') ? 'text-red-500' : 'text-green-600'}`}>{msg}</span>}
        </div>
      )}
    </div>
  )
}

// ─── Share Tab ─────────────────────────────────────────────────────────────────

// KB 後端用舊 grantee_type 名稱 (dept/profit_center/org_section)，共用元件用標準名稱，POST/顯示時做對應
// 見 docs/factory-share-layer-plan.md §3.2 「KB 歷史命名」
const KB_TYPE_TO_STANDARD: Record<string, string> = {
  dept:          'department',
  profit_center: 'cost_center',
  org_section:   'division',
}
const STANDARD_TO_KB_TYPE: Record<string, string> = {
  department:  'dept',
  cost_center: 'profit_center',
  division:    'org_section',
}

function ShareTab({ kb, isOwner }: { kb: KnowledgeBase; isOwner: boolean }) {
  const { t } = useTranslation()
  const [grants, setGrants]       = useState<Grant[]>([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<GranteeSelectionType | null>(null)
  const [permission,  setPermission]  = useState<'use' | 'edit'>('use')
  const [adding, setAdding]       = useState(false)
  const [msg, setMsg]             = useState('')
  const [requestingPublic, setRequestingPublic] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const grantsRes = await api.get(`/kb/${kb.id}/access`)
      setGrants(grantsRes.data)
    } finally { setLoading(false) }
  }, [kb.id])

  useEffect(() => { load() }, [load])

  const addGrant = async () => {
    if (!selected) { setMsg(t('kb.share.granteeRequired')); return }
    setAdding(true); setMsg('')
    try {
      // 標準 type → KB 舊型別
      const kbType = STANDARD_TO_KB_TYPE[selected.type] || selected.type
      await api.post(`/kb/${kb.id}/access`, {
        grantee_type: kbType,
        grantee_id: selected.id,
        permission,
      })
      setSelected(null)
      await load()
      setMsg(t('kb.share.addGrantOk'))
      setTimeout(() => setMsg(''), 2000)
    } catch (e: any) {
      setMsg(e.response?.data?.error || t('kb.share.addGrantFailed'))
    } finally { setAdding(false) }
  }

  const removeGrant = async (grantId: string) => {
    try {
      await api.delete(`/kb/${kb.id}/access/${grantId}`)
      setGrants((p) => p.filter((g) => g.id !== grantId))
    } catch (e: any) { alert(e.response?.data?.error || t('kb.share.removeGrantFailed')) }
  }

  const requestPublic = async () => {
    if (!confirm(t('kb.share.requestPublicConfirm'))) return
    setRequestingPublic(true)
    try {
      await api.post(`/kb/${kb.id}/request-public`)
      setMsg(t('kb.share.requestPublicSent'))
    } catch (e: any) {
      setMsg(e.response?.data?.error || t('kb.share.requestPublicFailed'))
    } finally { setRequestingPublic(false) }
  }

  const typeIcon = (type: string) => {
    if (type === 'user') return <User size={12} />
    return <Building2 size={12} />
  }

  const getLabel = (g: Grant) => {
    if (g.grantee_name) return g.grantee_name
    if (g.grantee_type === 'user') return t('kb.share.granteeUser', { id: g.grantee_id })
    if (g.grantee_type === 'role') return t('kb.share.granteeRole', { id: g.grantee_id })
    const standardType = KB_TYPE_TO_STANDARD[g.grantee_type] || g.grantee_type
    const typeLabel = t(`grantee.type.${standardType}`, { defaultValue: standardType })
    return `${typeLabel}: ${g.grantee_id}`
  }

  return (
    <div className="p-5 space-y-5">
      {/* Public request */}
      {isOwner && kb.public_status !== 'public' && (
        <div className="border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-slate-700">{t('kb.share.requestPublicTitle')}</div>
            <div className="text-xs text-slate-400 mt-0.5">
              {kb.public_status === 'pending' ? t('kb.share.requestPublicPending') : t('kb.share.requestPublicDesc')}
            </div>
          </div>
          {kb.public_status !== 'pending' && isOwner && (
            <button
              onClick={requestPublic}
              disabled={requestingPublic}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
            >
              <Globe size={13} /> {t('kb.share.requestPublicBtn')}
            </button>
          )}
        </div>
      )}

      {/* Add grant */}
      {isOwner && (
        <div className="border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="text-sm font-semibold text-slate-700">{t('kb.share.addGrantTitle')}</div>
          <ShareGranteePicker
            value={selected}
            onChange={setSelected}
            shareType={permission}
            onShareTypeChange={v => setPermission(v as 'use' | 'edit')}
            shareTypeOptions={[
              { value: 'use',  label: t('kb.share.permUse') },
              { value: 'edit', label: t('kb.share.permEdit') },
            ]}
            onAdd={addGrant}
            adding={adding}
            orgsUrl="/kb/orgs"
          />
          <p className="text-xs text-slate-400">{t('kb.share.permDesc')}</p>
          {msg && <span className={`text-sm ${msg.toLowerCase().includes('fail') || msg.includes('失') ? 'text-red-500' : 'text-green-600'}`}>{msg}</span>}
        </div>
      )}

      {/* Grant list */}
      {loading ? (
        <div className="text-center py-8 text-slate-400 text-sm">{t('kb.share.loading')}</div>
      ) : grants.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">{t('kb.share.noGrants')}</div>
      ) : (
        <div className="space-y-2">
          {grants.map((g) => (
            <div key={g.id} className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="text-slate-400">{typeIcon(g.grantee_type)}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-700">{getLabel(g)}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${g.permission === 'edit' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                    {g.permission === 'edit' ? t('kb.share.permEditBadge') : t('kb.share.permUseBadge')}
                  </span>
                </div>
                <div className="text-xs text-slate-400">{t('kb.share.grantedBy', { name: g.granted_by_name })} · {fmtDateTW(g.granted_at)}</div>
              </div>
              {isOwner && (
                <button onClick={() => removeGrant(g.id)} className="p-1 text-slate-300 hover:text-red-500 transition">
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Search Tab ────────────────────────────────────────────────────────────────

function SearchTab({ kb }: { kb: KnowledgeBase }) {
  const { t } = useTranslation()
  const [query, setQuery]       = useState('')
  const [mode,  setMode]        = useState(kb.retrieval_mode || 'hybrid')
  const [topK,  setTopK]        = useState(String(kb.top_k_return ?? 5))
  const [score, setScore]       = useState(String(kb.score_threshold ?? 0))
  const [results, setResults]   = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [elapsed, setElapsed]   = useState<number | null>(null)
  const [searched, setSearched] = useState(false)

  const search = async () => {
    if (!query.trim()) return
    setSearching(true); setSearched(true)
    try {
      const res = await api.post(`/kb/${kb.id}/search`, {
        query,
        retrieval_mode:   mode,
        top_k:            Number(topK),
        score_threshold:  Number(score),
      })
      setResults(res.data.results)
      setElapsed(res.data.elapsed_ms)
    } catch (e: any) {
      alert(e.response?.data?.error || t('kb.search.searchFailed'))
      setResults([])
    } finally { setSearching(false) }
  }

  const scoreColor = (s: number) => {
    if (s >= 0.8) return 'text-green-600 bg-green-50 border-green-200'
    if (s >= 0.5) return 'text-yellow-600 bg-yellow-50 border-yellow-200'
    return 'text-slate-500 bg-slate-50 border-slate-200'
  }

  return (
    <div className="p-5 flex gap-5">
      {/* Left: query + settings */}
      <div className="flex-1 space-y-4">
        <div>
          <div className="text-sm font-semibold text-slate-700 mb-1">{t('kb.search.title')}</div>
          <div className="text-xs text-slate-400 mb-3">{t('kb.search.subtitle')}</div>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, 200))}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); search() } }}
            rows={5}
            placeholder={t('kb.search.placeholder')}
            className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-slate-400">{t('kb.search.charCount', { count: query.length })}</span>
            <button
              onClick={search}
              disabled={searching || !query.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
            >
              <Target size={13} className={searching ? 'animate-spin' : ''} />
              {searching ? t('kb.search.searching') : t('kb.search.testBtn')}
            </button>
          </div>
        </div>

        {/* Settings */}
        <div className="border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('kb.search.settingsTitle')}</div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { val: 'vector',   label: t('kb.search.modeVector'),   icon: '⟐' },
              { val: 'fulltext', label: t('kb.search.modeFulltext'), icon: '≡' },
              { val: 'hybrid',   label: t('kb.search.modeHybrid'),   icon: '⊕' },
            ].map((opt) => (
              <label key={opt.val} className={`cursor-pointer border rounded-lg p-2 text-center transition ${mode === opt.val ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
                <input type="radio" className="sr-only" value={opt.val} checked={mode === opt.val} onChange={() => setMode(opt.val)} />
                <div className="text-base">{opt.icon}</div>
                <div className="text-xs font-medium text-slate-600">{opt.label}</div>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.search.topKLabel')}</label>
              <input type="number" value={topK} min={1} max={50} onChange={(e) => setTopK(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.search.scoreThresholdLabel')}</label>
              <input type="number" value={score} min={0} max={1} step={0.05} onChange={(e) => setScore(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" />
            </div>
          </div>
        </div>

        {searched && elapsed !== null && (
          <div className="text-xs text-slate-400 text-right">{t('kb.search.elapsed', { ms: elapsed, count: results.length })}</div>
        )}
      </div>

      {/* Right: results */}
      <div className="w-96 space-y-3 flex flex-col">
        <div className="text-sm font-semibold text-slate-700">
          {!searched ? t('kb.search.resultsPlaceholder') : results.length === 0 ? t('kb.search.noResults') : t('kb.search.resultsTitle', { count: results.length })}
        </div>
        {!searched ? (
          <div className="flex-1 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center text-slate-400 text-sm py-20">
            <div className="text-center">
              <Search size={28} className="mx-auto mb-2 opacity-30" />
              <p>{t('kb.search.resultsPlaceholderSub')}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2 overflow-y-auto max-h-[600px]">
            {results.map((r, i) => (
              <div key={r.id} className="border border-slate-200 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-slate-400">#{i + 1}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full border ${scoreColor(r.score)}`}>
                    {(r.score * 100).toFixed(1)}%
                  </span>
                  <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full">{r.match_type}</span>
                  <span className="text-xs text-slate-400 ml-auto truncate max-w-24">{r.filename}</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{r.content}</p>
                {r.parent_content && r.parent_content !== r.content && (
                  <details className="mt-2">
                    <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">{t('kb.search.parentChunkLabel')}</summary>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed whitespace-pre-wrap border-t border-slate-100 pt-1">
                      {r.parent_content}
                    </p>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Query History Tab ─────────────────────────────────────────────────────────

interface QueryLog {
  id: string
  query_text: string
  retrieval_mode: string
  top_k: number
  elapsed_ms: number
  source: string
  created_at: string
  user_name: string | null
}

function QueryHistoryTab({ kbId }: { kbId: string }) {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<QueryLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/kb/${kbId}/retrieval-tests`).then((res) => {
      setLogs(res.data)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [kbId])

  if (loading) return <div className="p-6 text-center text-slate-400 text-sm">{t('kb.history.loading')}</div>
  if (logs.length === 0) return (
    <div className="p-10 text-center text-slate-400">
      <History size={36} className="mx-auto mb-3 opacity-30" />
      <p className="text-sm">{t('kb.history.empty')}</p>
    </div>
  )

  const sourceLabel = (s: string) => s === 'chat' ? t('kb.history.sourceChat') : t('kb.history.sourceTest')
  const sourceColor = (s: string) => s === 'chat' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'

  return (
    <div className="p-4">
      <p className="text-xs text-slate-400 mb-3">{t('kb.history.hint')}</p>
      <div className="space-y-2">
        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-3 bg-slate-50 rounded-lg px-4 py-3 hover:bg-slate-100 transition">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-700 truncate">{log.query_text}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${sourceColor(log.source)}`}>
                  {sourceLabel(log.source)}
                </span>
                <span className="text-xs text-slate-400">{log.retrieval_mode || '-'}</span>
                <span className="text-xs text-slate-400">top_k={log.top_k}</span>
                {log.elapsed_ms && <span className="text-xs text-slate-400">{log.elapsed_ms}ms</span>}
                {log.user_name && <span className="text-xs text-slate-400">by {log.user_name}</span>}
              </div>
            </div>
            <span className="text-xs text-slate-400 whitespace-nowrap">{fmtTW(log.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Images Tab ─────────────────────────────────────────────────────────────
interface KbImageRow {
  id: string
  kb_id: string
  doc_id: string | null
  chunk_id: string | null
  source: string
  filename: string
  mime_type: string
  file_size: number
  caption: string | null
  caption_status: 'processing' | 'done' | 'failed' | null
  caption_error: string | null
  width: number | null
  height: number | null
  created_at: string
}

function ImagesTab({ kb, isOwner }: { kb: KnowledgeBase; isOwner: boolean }) {
  const { t } = useTranslation()
  const [images, setImages] = useState<KbImageRow[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCaption, setEditCaption] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const res = await api.get(`/kb/${kb.id}/images`)
      setImages(Array.isArray(res.data) ? res.data : [])
    } catch (e: any) {
      setError(e.response?.data?.error || 'Load failed')
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 有 processing 圖時自動 polling — 5 秒後 refresh 一次,看 caption 完成沒
  useEffect(() => {
    const hasProcessing = images.some((i) => i.caption_status === 'processing')
    if (!hasProcessing) return
    const timer = setTimeout(load, 5000)
    return () => clearTimeout(timer)
  }, [images]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true); setError('')
    try {
      const fd = new FormData()
      Array.from(files).forEach((f) => fd.append('files', f))
      await api.post(`/kb/${kb.id}/images`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setTimeout(load, 600)
    } catch (e: any) {
      setError(e.response?.data?.error || t('kb.images.uploadFailed'))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const saveCaption = async (id: string) => {
    try {
      await api.patch(`/kb/${kb.id}/images/${id}`, { caption: editCaption })
      setEditingId(null)
      load()
    } catch (e: any) {
      alert(e.response?.data?.error || t('kb.images.saveCaptionFailed'))
    }
  }

  const handleDelete = async (img: KbImageRow) => {
    if (!confirm(t('kb.images.deleteConfirm', { name: img.filename }))) return
    try {
      await api.delete(`/kb/${kb.id}/images/${img.id}`)
      setImages((prev) => prev.filter((i) => i.id !== img.id))
      setSelectedIds((prev) => { const s = new Set(prev); s.delete(img.id); return s })
    } catch (e: any) {
      alert(e.response?.data?.error || t('kb.images.deleteFailed'))
    }
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(t('kb.images.batchDeleteConfirm', { count: selectedIds.size }))) return
    try {
      const res = await api.post(`/kb/${kb.id}/images/batch-delete`, { ids: Array.from(selectedIds) })
      const deleted = res.data?.deleted || 0
      const failed = res.data?.failed || 0
      if (failed > 0) alert(t('kb.images.batchDeleteResult', { deleted, failed }))
      setSelectedIds(new Set())
      load()
    } catch (e: any) {
      alert(e.response?.data?.error || t('kb.images.deleteFailed'))
    }
  }

  const handleRetryCaption = async (img: KbImageRow) => {
    try {
      await api.post(`/kb/${kb.id}/images/${img.id}/retry-caption`)
      // 立即 reflect 為 processing
      setImages((prev) => prev.map((i) => i.id === img.id ? { ...i, caption_status: 'processing' as const, caption_error: null } : i))
      setTimeout(load, 1500)
    } catch (e: any) {
      alert(e.response?.data?.error || t('kb.images.retryFailed'))
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id); else s.add(id)
      return s
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === images.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(images.map((i) => i.id)))
  }

  const statusBadge = (img: KbImageRow) => {
    const s = img.caption_status || 'done'
    if (s === 'processing') {
      return <span className="bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded text-xs inline-flex items-center gap-0.5"><Clock size={9} className="animate-pulse" />{t('kb.images.statusProcessing')}</span>
    }
    if (s === 'failed') {
      return <span className="bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded text-xs" title={img.caption_error || ''}>{t('kb.images.statusFailed')}</span>
    }
    return null
  }

  return (
    <div className="p-5 space-y-4">
      {/* Upload zone */}
      {isOwner && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
            multiple
            onChange={(e) => handleUpload(e.target.files)}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-xl py-8 flex flex-col items-center justify-center gap-2 transition disabled:opacity-50"
          >
            <Upload size={24} className="text-slate-400" />
            <span className="text-sm text-slate-600">{uploading ? t('kb.images.uploading') : t('kb.images.uploadHint')}</span>
            <span className="text-xs text-slate-400">{t('kb.images.uploadFormatHint')}</span>
          </button>
        </div>
      )}

      {/* Batch operations toolbar */}
      {isOwner && images.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer text-slate-600">
            <input
              type="checkbox"
              checked={selectedIds.size > 0 && selectedIds.size === images.length}
              ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < images.length }}
              onChange={toggleSelectAll}
            />
            {selectedIds.size === 0
              ? t('kb.images.selectAll')
              : t('kb.images.selectedCount', { count: selectedIds.size })}
          </label>
          {selectedIds.size > 0 && (
            <button
              onClick={handleBatchDelete}
              className="ml-auto px-3 py-1 bg-rose-500 hover:bg-rose-600 text-white rounded flex items-center gap-1"
            >
              <Trash2 size={11} /> {t('kb.images.batchDelete', { count: selectedIds.size })}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 px-3 py-2 rounded-lg text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-slate-400 text-sm">{t('kb.loading')}</div>
      ) : images.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">{t('kb.images.empty')}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {images.map((img) => {
            const isSelected = selectedIds.has(img.id)
            return (
            <div
              key={img.id}
              className={`relative border rounded-lg overflow-hidden bg-white transition ${isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200'}`}
            >
              {isOwner && (
                <label className="absolute top-2 left-2 z-10 bg-white/90 rounded p-1 cursor-pointer shadow-sm">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(img.id)}
                    className="block"
                  />
                </label>
              )}
              <div className="absolute top-2 right-2 z-10 flex gap-1">
                {statusBadge(img)}
              </div>
              <div className="aspect-square bg-slate-50 flex items-center justify-center overflow-hidden">
                <KbImage imageId={img.id} alt={img.filename} className="w-full h-full object-cover" />
              </div>
              <div className="p-3 space-y-2">
                <div className="text-xs font-medium text-slate-700 truncate" title={img.filename}>{img.filename}</div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>{(img.file_size / 1024).toFixed(1)} KB</span>
                  {img.source === 'doc_embed' && <span className="bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">{t('kb.images.sourceDocEmbed')}</span>}
                </div>
                {editingId === img.id ? (
                  <div className="space-y-1.5">
                    <textarea
                      value={editCaption}
                      onChange={(e) => setEditCaption(e.target.value)}
                      rows={3}
                      className="w-full text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      placeholder={t('kb.images.captionPlaceholder')}
                    />
                    <div className="flex gap-1">
                      <button onClick={() => saveCaption(img.id)} className="flex-1 px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">{t('kb.settings.saveBtn')}</button>
                      <button onClick={() => setEditingId(null)} className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded">{t('kb.detail.back')}</button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 line-clamp-3 min-h-[3em]" title={img.caption || img.caption_error || ''}>
                    {img.caption_status === 'processing' && !img.caption ? (
                      <span className="italic text-yellow-600">{t('kb.images.statusProcessing')}...</span>
                    ) : img.caption_status === 'failed' ? (
                      <span className="italic text-rose-600">{img.caption_error || t('kb.images.captionFailedFallback')}</span>
                    ) : (
                      img.caption || <span className="italic text-slate-400">{t('kb.images.noCaption')}</span>
                    )}
                  </div>
                )}
                {isOwner && editingId !== img.id && (
                  <div className="flex items-center gap-1 pt-1 border-t border-slate-100">
                    {img.caption_status === 'failed' && img.source === 'manual' && (
                      <button
                        onClick={() => handleRetryCaption(img)}
                        className="text-xs px-2 py-1 text-yellow-600 hover:bg-yellow-50 rounded flex items-center gap-1"
                        title={t('kb.images.retryCaption')}
                      >
                        <RefreshCw size={11} />
                      </button>
                    )}
                    <button
                      onClick={() => { setEditingId(img.id); setEditCaption(img.caption || '') }}
                      className="flex-1 text-xs px-2 py-1 text-slate-600 hover:bg-slate-50 rounded flex items-center justify-center gap-1"
                    >
                      <Pencil size={11} /> {t('kb.images.editCaption')}
                    </button>
                    <button
                      onClick={() => handleDelete(img)}
                      className="text-xs px-2 py-1 text-rose-500 hover:bg-rose-50 rounded"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
              </div>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
