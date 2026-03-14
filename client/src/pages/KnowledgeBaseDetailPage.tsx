import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Cpu, FileText, Settings, Share2, Search,
  Upload, Trash2, RefreshCw, CheckCircle, XCircle, Clock,
  AlertCircle, Globe, Lock, ChevronDown, ChevronUp, Plus, X,
  User, Building2, Layers, BookOpen, Save, Target, Image, History,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import TranslationFields, { type TranslationData } from '../components/common/TranslationFields'

// ─── Types ────────────────────────────────────────────────────────────────────

interface KnowledgeBase {
  id: string; name: string; description: string | null
  embedding_model: string; embedding_dims: number
  chunk_strategy: string; chunk_config: Record<string, unknown>
  retrieval_mode: string; rerank_model: string | null
  top_k_fetch: number; top_k_return: number; score_threshold: number
  ocr_model: string | null
  parse_mode: string | null
  is_public: number; public_status: string
  doc_count: number; chunk_count: number; total_size_bytes: number
  creator_id: number; creator_name: string; is_owner: boolean
  created_at: string; updated_at: string
}

interface KbDocument {
  id: string; filename: string; file_type: string; file_size: number
  word_count: number | null; chunk_count: number; status: string
  error_msg: string | null; created_at: string
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
}

interface OrgOption { code?: string; name: string }

type TabKey = 'docs' | 'settings' | 'share' | 'search' | 'history'

const TAB_KEYS: TabKey[] = ['docs', 'settings', 'share', 'search', 'history']

function DocIcon({ type }: { type: string }) {
  const t = (type || '').toLowerCase()
  if (t === 'pdf') return <FileText size={16} className="text-red-400 flex-shrink-0" />
  if (t === 'docx' || t === 'doc') return <FileText size={16} className="text-blue-400 flex-shrink-0" />
  if (t === 'pptx' || t === 'ppt') return <FileText size={16} className="text-orange-400 flex-shrink-0" />
  if (t === 'xlsx' || t === 'xls') return <FileText size={16} className="text-green-500 flex-shrink-0" />
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

  const tabLabel = (key: TabKey) => {
    switch (key) {
      case 'docs':     return t('kb.detail.tabDocs')
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
          <span className="font-bold">FOXLINK GPT</span>
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
            <div className="font-semibold text-slate-800">{kb.name}</div>
            {kb.description && <div className="text-sm text-slate-500 truncate">{kb.description}</div>}
          </div>
          <div className="hidden md:flex items-center gap-4 text-xs text-slate-500">
            <span><span className="font-medium text-slate-700">{kb.doc_count}</span> {t('kb.detail.docCountLabel')}</span>
            <span><span className="font-medium text-slate-700">{kb.chunk_count}</span> {t('kb.detail.chunkCountLabel')}</span>
            <span><span className="font-medium text-slate-700">{formatBytes(kb.total_size_bytes)}</span></span>
            <span className="bg-slate-100 px-2 py-0.5 rounded-full">{kb.embedding_dims}d · {kb.chunk_strategy}</span>
            {kb.is_public === 1 || kb.public_status === 'public'
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
            translateUrl={`/kb/${kb.id}/translate`}
            hasDescription
          />
          {(kb.is_owner || isAdmin) && (
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
          {tab === 'docs'     && <DocumentsTab kb={kb} onRefresh={loadKb} isOwner={kb.is_owner || isAdmin} />}
          {tab === 'settings' && <SettingsTab  kb={kb} onSaved={loadKb} isOwner={kb.is_owner || isAdmin} />}
          {tab === 'share'    && <ShareTab     kb={kb} isOwner={kb.is_owner || isAdmin} />}
          {tab === 'search'   && <SearchTab    kb={kb} />}
          {tab === 'history'  && <QueryHistoryTab kbId={kb.id} />}
        </div>
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
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [chunks, setChunks] = useState<KbChunk[]>([])
  const [chunksLoading, setChunksLoading] = useState(false)
  const [chunkPage, setChunkPage] = useState(1)
  const [chunkTotal, setChunkTotal] = useState(0)
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

  const statusIcon = (status: string) => {
    if (status === 'ready')      return <CheckCircle size={14} className="text-green-500" />
    if (status === 'error')      return <XCircle size={14} className="text-red-500" />
    return <RefreshCw size={14} className="text-blue-500 animate-spin" />
  }

  const parseModeLabel = kb.parse_mode === 'format_aware'
    ? t('kb.docs.parseModeFormatAware')
    : t('kb.docs.parseModeTextOnly')

  return (
    <div className="p-5 space-y-4">
      {isOwner && (
        <div className="space-y-2">
          {/* Per-upload parse mode override */}
          <div className="flex items-center gap-2">
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
              accept=".pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.csv,.jpg,.jpeg,.png,.gif,.webp,.bmp"
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
                    <span>{doc.created_at?.slice(0, 10)}</span>
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
                  {isOwner && (
                    <button onClick={() => handleDelete(doc)} className="p-1 text-slate-300 hover:text-red-500 transition">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

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

  const [strategy,   setStrategy]   = useState(kb.chunk_strategy)
  const [cfg,        setCfg]        = useState<Record<string, unknown>>(merged)
  const [retMode,    setRetMode]    = useState(kb.retrieval_mode)
  const [topKFetch,  setTopKFetch]  = useState(String(kb.top_k_fetch ?? 10))
  const [topKReturn, setTopKReturn] = useState(String(kb.top_k_return ?? 5))
  const [scoreThr,   setScoreThr]   = useState(String(kb.score_threshold ?? 0))
  const [ocrModel,      setOcrModel]      = useState(kb.ocr_model ?? '')
  const [parseMode,     setParseMode]     = useState(kb.parse_mode ?? 'text_only')
  const [useRerank,     setUseRerank]     = useState(kb.rerank_model !== 'disabled')
  const [rerankModel,   setRerankModel]   = useState(kb.rerank_model === 'disabled' ? '' : (kb.rerank_model ?? ''))
  const [llmModels,     setLlmModels]     = useState<{ key: string; name: string; api_model: string; model_role: string | null }[]>([])
  const [saving,        setSaving]        = useState(false)
  const [msg,           setMsg]           = useState('')

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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rerankModels = llmModels.filter((m) => m.model_role === 'rerank')

  const setCfgField = (k: string, v: unknown) => setCfg((p) => ({ ...p, [k]: v }))

  const save = async () => {
    setSaving(true); setMsg('')
    try {
      await api.put(`/kb/${kb.id}`, {
        chunk_strategy:   strategy,
        chunk_config:     cfg,
        retrieval_mode:   retMode,
        rerank_model:     useRerank ? (rerankModel || null) : 'disabled',
        top_k_fetch:      Number(topKFetch),
        top_k_return:     Number(topKReturn),
        score_threshold:  Number(scoreThr),
        ocr_model:        ocrModel || null,
        parse_mode:       parseMode || 'text_only',
      })
      setMsg(t('kb.settings.savedOk'))
      onSaved()
      setTimeout(() => setMsg(''), 2000)
    } catch (e: any) {
      setMsg(e.response?.data?.error || t('kb.settings.saveFailed'))
    } finally { setSaving(false) }
  }

  return (
    <div className="p-5 space-y-6">
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
        </div>
      </div>

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
        </div>
      </div>

      {isOwner && (
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
            <Save size={14} /> {saving ? t('kb.settings.saving') : t('kb.settings.saveBtn')}
          </button>
          {msg && <span className={`text-sm ${msg.toLowerCase().includes('fail') || msg.includes('失') ? 'text-red-500' : 'text-green-600'}`}>{msg}</span>}
        </div>
      )}
    </div>
  )
}

// ─── Share Tab ─────────────────────────────────────────────────────────────────

function ShareTab({ kb, isOwner }: { kb: KnowledgeBase; isOwner: boolean }) {
  const { t } = useTranslation()
  const [grants, setGrants]       = useState<Grant[]>([])
  const [loading, setLoading]     = useState(true)
  const [orgs, setOrgs]           = useState<{ depts: OrgOption[]; profit_centers: OrgOption[]; org_sections: OrgOption[]; org_groups: OrgOption[] }>({ depts: [], profit_centers: [], org_sections: [], org_groups: [] })
  const [granteeType, setGranteeType] = useState<string>('user')
  const [granteeId,   setGranteeId]   = useState<string>('')
  const [userSearch,  setUserSearch]  = useState<string>('')
  const [permission,  setPermission]  = useState<'use' | 'edit'>('use')
  const [userOptions, setUserOptions] = useState<{ id: number; name: string; username: string; employee_id: string }[]>([])
  const [adding, setAdding]       = useState(false)
  const [msg, setMsg]             = useState('')
  const [requestingPublic, setRequestingPublic] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [grantsRes, orgsRes] = await Promise.all([
        api.get(`/kb/${kb.id}/access`),
        api.get('/kb/orgs'),
      ])
      setGrants(grantsRes.data)
      setOrgs(orgsRes.data)
    } finally { setLoading(false) }
  }, [kb.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (granteeType !== 'user' || userSearch.length < 1) { setUserOptions([]); return }
    const timer = setTimeout(async () => {
      try {
        const res = await api.get(`/users?search=${encodeURIComponent(userSearch)}`)
        setUserOptions((res.data || []).slice(0, 10))
      } catch { setUserOptions([]) }
    }, 300)
    return () => clearTimeout(timer)
  }, [userSearch, granteeType])

  const addGrant = async () => {
    if (!granteeId) { setMsg(t('kb.share.granteeRequired')); return }
    setAdding(true); setMsg('')
    try {
      await api.post(`/kb/${kb.id}/access`, { grantee_type: granteeType, grantee_id: granteeId, permission })
      setGranteeId(''); setUserSearch('')
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

  const granteeTypeLabel: Record<string, string> = {
    user:          t('kb.share.granteeTypeUser'),
    role:          t('kb.share.granteeTypeRole'),
    dept:          t('kb.share.granteeTypeDept'),
    profit_center: t('kb.share.granteeTypeProfitCenter'),
    org_section:   t('kb.share.granteeTypeOrgSection'),
    org_group:     t('kb.share.granteeTypeOrgGroup'),
  }

  const typeIcon = (type: string) => {
    if (type === 'user') return <User size={12} />
    return <Building2 size={12} />
  }

  const getLabel = (g: Grant) => {
    if (g.grantee_type === 'user') return t('kb.share.granteeUser', { id: g.grantee_id })
    if (g.grantee_type === 'role') return t('kb.share.granteeRole', { id: g.grantee_id })
    return `${granteeTypeLabel[g.grantee_type] || g.grantee_type}: ${g.grantee_id}`
  }

  const getOrgOptions = (): { id: string; label: string }[] => {
    if (granteeType === 'dept') return orgs.depts.map((d) => ({ id: d.code || '', label: `${d.code} ${d.name}` }))
    if (granteeType === 'profit_center') return orgs.profit_centers.map((d) => ({ id: d.code || '', label: `${d.code} ${d.name}` }))
    if (granteeType === 'org_section') return orgs.org_sections.map((d) => ({ id: d.code || '', label: `${d.code} ${d.name}` }))
    if (granteeType === 'org_group') return orgs.org_groups.map((d) => ({ id: d.name || '', label: d.name }))
    return []
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
          <div className="flex gap-2 flex-wrap">
            <select value={granteeType} onChange={(e) => { setGranteeType(e.target.value); setGranteeId(''); setUserSearch('') }}
              className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {Object.entries(granteeTypeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>

            {granteeType === 'user' ? (
              <div className="relative flex-1 min-w-48">
                <input
                  value={userSearch}
                  onChange={(e) => { setUserSearch(e.target.value); setGranteeId('') }}
                  placeholder={t('kb.share.userSearchPlaceholder')}
                  className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {userOptions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 overflow-hidden">
                    {userOptions.map((u) => (
                      <button key={u.id} type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0"
                        onClick={() => { setGranteeId(String(u.id)); setUserSearch(`${u.name} (${u.username})`); setUserOptions([]) }}>
                        <span className="font-medium">{u.name}</span>
                        <span className="text-slate-400 ml-2">{u.username} · {u.employee_id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <select value={granteeId} onChange={(e) => setGranteeId(e.target.value)}
                className="flex-1 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">{t('kb.share.orgSelectPlaceholder')}</option>
                {getOrgOptions().map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            )}

            <select value={permission} onChange={(e) => setPermission(e.target.value as 'use' | 'edit')}
              className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="use">{t('kb.share.permUse')}</option>
              <option value="edit">{t('kb.share.permEdit')}</option>
            </select>

            <button onClick={addGrant} disabled={adding || !granteeId}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition">
              <Plus size={13} /> {t('kb.share.addBtn')}
            </button>
          </div>
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
                <div className="text-xs text-slate-400">{t('kb.share.grantedBy', { name: g.granted_by_name })} · {g.granted_at?.slice(0, 10)}</div>
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
            <span className="text-xs text-slate-400 whitespace-nowrap">{log.created_at}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
