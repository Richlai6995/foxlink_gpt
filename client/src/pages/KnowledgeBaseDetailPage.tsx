import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Cpu, FileText, Settings, Share2, Search,
  Upload, Trash2, RefreshCw, CheckCircle, XCircle, Clock,
  AlertCircle, Globe, Lock, ChevronDown, ChevronUp, Plus, X,
  User, Building2, Layers, BookOpen, Save, Target, Image,
} from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'

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

const TABS = ['文件', '分塊與檢索設定', '共享設定', '召回測試'] as const
type TabName = typeof TABS[number]

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

  const [kb, setKb] = useState<KnowledgeBase | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabName>('文件')
  const [error, setError] = useState('')

  const loadKb = useCallback(async () => {
    try {
      const res = await api.get(`/kb/${id}`)
      setKb(res.data)
    } catch (e: any) {
      setError(e.response?.data?.error || '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadKb() }, [loadKb])

  if (loading) return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center text-slate-400">載入中...</div>
  )
  if (error || !kb) return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center">
      <div className="text-center">
        <AlertCircle size={32} className="mx-auto mb-3 text-red-400" />
        <p className="text-slate-600">{error || '知識庫不存在'}</p>
        <button onClick={() => navigate('/kb')} className="mt-4 text-blue-600 text-sm hover:underline">返回列表</button>
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
          <span className="text-slate-500 text-sm">/ 知識庫 /</span>
          <span className="text-white text-sm">{kb.name}</span>
        </div>
        <button onClick={() => navigate('/kb')} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition">
          <ArrowLeft size={15} /> 返回
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
            <span><span className="font-medium text-slate-700">{kb.doc_count}</span> 文件</span>
            <span><span className="font-medium text-slate-700">{kb.chunk_count}</span> 分塊</span>
            <span><span className="font-medium text-slate-700">{formatBytes(kb.total_size_bytes)}</span></span>
            <span className="bg-slate-100 px-2 py-0.5 rounded-full">{kb.embedding_dims}d · {kb.chunk_strategy}</span>
            {kb.is_public === 1 || kb.public_status === 'public'
              ? <span className="flex items-center gap-1 bg-green-100 text-green-700 px-2 py-0.5 rounded-full"><Globe size={10} />公開</span>
              : kb.public_status === 'pending'
              ? <span className="flex items-center gap-1 bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full"><Clock size={10} />審核中</span>
              : <span className="flex items-center gap-1 bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full"><Lock size={10} />私有</span>
            }
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200 bg-white rounded-t-xl px-4">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition -mb-px ${
                tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === '文件' && <FileText size={14} className="inline mr-1.5" />}
              {t === '分塊與檢索設定' && <Settings size={14} className="inline mr-1.5" />}
              {t === '共享設定' && <Share2 size={14} className="inline mr-1.5" />}
              {t === '召回測試' && <Search size={14} className="inline mr-1.5" />}
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="bg-white border border-slate-200 rounded-xl -mt-4 rounded-t-none border-t-0">
          {tab === '文件' && <DocumentsTab kb={kb} onRefresh={loadKb} isOwner={kb.is_owner || isAdmin} />}
          {tab === '分塊與檢索設定' && <SettingsTab kb={kb} onSaved={loadKb} isOwner={kb.is_owner || isAdmin} />}
          {tab === '共享設定' && <ShareTab kb={kb} isOwner={kb.is_owner || isAdmin} />}
          {tab === '召回測試' && <SearchTab kb={kb} />}
        </div>
      </div>
    </div>
  )
}

// ─── Documents Tab ─────────────────────────────────────────────────────────────

function DocumentsTab({ kb, onRefresh, isOwner }: { kb: KnowledgeBase; onRefresh: () => void; isOwner: boolean }) {
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
    const t = setTimeout(loadDocs, 3000)
    return () => clearTimeout(t)
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
      alert(e.response?.data?.error || '上傳失敗')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (doc: KbDocument) => {
    if (!confirm(`確定刪除文件「${doc.filename}」及其所有分塊？`)) return
    try {
      await api.delete(`/kb/${kb.id}/documents/${doc.id}`)
      setDocs((p) => p.filter((d) => d.id !== doc.id))
      if (expandedId === doc.id) setExpandedId(null)
      onRefresh()
    } catch (e: any) { alert(e.response?.data?.error || '刪除失敗') }
  }

  const statusIcon = (status: string) => {
    if (status === 'ready')      return <CheckCircle size={14} className="text-green-500" />
    if (status === 'error')      return <XCircle size={14} className="text-red-500" />
    return <RefreshCw size={14} className="text-blue-500 animate-spin" />
  }

  return (
    <div className="p-5 space-y-4">
      {isOwner && (
        <div className="space-y-2">
          {/* Per-upload parse mode override */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 whitespace-nowrap">本次上傳格式解析：</span>
            <select
              value={uploadParseMode}
              onChange={(e) => setUploadParseMode(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">依知識庫預設（{kb.parse_mode === 'format_aware' ? '格式感知' : '純文字'}）</option>
              <option value="text_only">純文字</option>
              <option value="format_aware">格式感知</option>
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
            <p className="text-sm text-slate-500">拖曳或點擊上傳文件</p>
            <p className="text-xs text-slate-400 mt-1">支援 PDF · DOCX · PPTX · XLSX · TXT · CSV · JPG · PNG · GIF · WEBP（最大 200 MB）</p>
            {uploading && <p className="text-xs text-blue-500 mt-2 animate-pulse">上傳中...</p>}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-slate-400 text-sm">載入中...</div>
      ) : docs.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-sm">尚無文件</div>
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
                    <span>{doc.chunk_count} 分塊</span>
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
                    <div className="text-xs text-slate-400 text-center py-4">載入分塊中...</div>
                  ) : chunks.length === 0 ? (
                    <div className="text-xs text-slate-400 text-center py-4">無分塊資料</div>
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
                              <p className="text-xs text-slate-400 mt-1 border-t border-slate-100 pt-1">父段落: {c.parent_preview}</p>
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
                          >上頁</button>
                          <span className="text-xs text-slate-400">{chunkPage} / {Math.ceil(chunkTotal / 20)}</span>
                          <button
                            disabled={chunkPage >= Math.ceil(chunkTotal / 20)}
                            onClick={() => loadChunks(doc.id, chunkPage + 1)}
                            className="px-3 py-1 text-xs border border-slate-300 rounded disabled:opacity-40 hover:bg-slate-100"
                          >下頁</button>
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
  const [ocrModel,   setOcrModel]   = useState(kb.ocr_model ?? '')
  const [parseMode,  setParseMode]  = useState(kb.parse_mode ?? 'text_only')
  const [llmModels,  setLlmModels]  = useState<{ key: string; name: string; api_model: string }[]>([])
  const [saving,     setSaving]     = useState(false)
  const [msg,        setMsg]        = useState('')

  useEffect(() => {
    api.get('/admin/llm-models').then((res) => {
      const nonImage = (res.data as { key: string; name: string; api_model: string; image_output: number; is_active: number }[])
        .filter((m) => !m.image_output && m.is_active)
      setLlmModels(nonImage)
      // Set default to flash model if not already set
      if (!ocrModel && nonImage.length > 0) {
        const flash = nonImage.find((m) => m.key.includes('flash') || m.name.toLowerCase().includes('flash'))
        setOcrModel(flash?.api_model ?? nonImage[0].api_model)
      }
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setCfgField = (k: string, v: unknown) => setCfg((p) => ({ ...p, [k]: v }))

  const save = async () => {
    setSaving(true); setMsg('')
    try {
      await api.put(`/kb/${kb.id}`, {
        chunk_strategy:   strategy,
        chunk_config:     cfg,
        retrieval_mode:   retMode,
        top_k_fetch:      Number(topKFetch),
        top_k_return:     Number(topKReturn),
        score_threshold:  Number(scoreThr),
        ocr_model:        ocrModel || null,
        parse_mode:       parseMode || 'text_only',
      })
      setMsg('設定已儲存')
      onSaved()
      setTimeout(() => setMsg(''), 2000)
    } catch (e: any) {
      setMsg(e.response?.data?.error || '儲存失敗')
    } finally { setSaving(false) }
  }

  return (
    <div className="p-5 space-y-6">
      {/* Chunk Strategy */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Layers size={15} className="text-blue-500" /> 分段設定
        </h3>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[
            { val: 'regular',      label: '常規',  desc: '高級文本分塊模式，檢索和摘要的規則是相同的' },
            { val: 'parent_child', label: '父子',  desc: '使用 parent-child 模式，child-chunk 用於檢索，parent-chunk 提供完整上下文' },
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
                <label className="block text-xs font-medium text-slate-600 mb-1">分段識別符號</label>
                <input value={String(cfg.separator ?? '\\n\\n')} disabled={!isOwner}
                  onChange={(e) => setCfgField('separator', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm font-mono disabled:bg-slate-50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">分段最大長度（chars）</label>
                <input type="number" value={Number(cfg.max_size ?? 1024)} disabled={!isOwner} min={100} max={4096}
                  onChange={(e) => setCfgField('max_size', Number(e.target.value))}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">分段重疊長度（chars）</label>
                <input type="number" value={Number(cfg.overlap ?? 50)} disabled={!isOwner} min={0} max={500}
                  onChange={(e) => setCfgField('overlap', Number(e.target.value))}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" disabled={!isOwner} checked={Boolean(cfg.remove_urls)} onChange={(e) => setCfgField('remove_urls', e.target.checked)} />
              刪除所有 URL 和電子郵件地址
            </label>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl p-4 space-y-4">
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">父段落（背景）</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">分段識別符號</label>
                  <input value={String(cfg.parent_separator ?? '\\n\\n')} disabled={!isOwner}
                    onChange={(e) => setCfgField('parent_separator', e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm font-mono disabled:bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">分段最大長度（chars）</label>
                  <input type="number" value={Number(cfg.parent_max_size ?? 1024)} disabled={!isOwner} min={100} max={8192}
                    onChange={(e) => setCfgField('parent_max_size', Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50" />
                </div>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">用於檢索的 Child-chunk</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">分段識別符號</label>
                  <input value={String(cfg.child_separator ?? '\\n')} disabled={!isOwner}
                    onChange={(e) => setCfgField('child_separator', e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm font-mono disabled:bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">分段最大長度（chars）</label>
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
          <Search size={15} className="text-blue-500" /> 檢索設定
        </h3>
        <div className="border border-slate-200 rounded-xl p-4 space-y-4">
          {/* Retrieval mode */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">檢索方式</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { val: 'vector',   label: '向量檢索',   desc: '透過生成嵌入並與其向量表示最相似的文字分段' },
                { val: 'fulltext', label: '全文檢索',   desc: '索引文件中的所有詞語，從而允許使用者查詢任意詞語' },
                { val: 'hybrid',   label: '混合檢索',   desc: '同時執行全文檢索和向量檢索，並應用重排序步驟' },
              ].map((opt) => (
                <label key={opt.val} className={`cursor-pointer border rounded-xl p-3 transition ${!isOwner ? 'opacity-60 cursor-not-allowed' : ''} ${retMode === opt.val ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <input type="radio" className="sr-only" value={opt.val} checked={retMode === opt.val} disabled={!isOwner} onChange={() => setRetMode(opt.val)} />
                  <div className="text-sm font-medium text-slate-700 mb-0.5">{opt.label}</div>
                  <div className="text-xs text-slate-400 leading-relaxed">{opt.desc}</div>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">初始擷取 Top K</label>
              <input type="number" value={topKFetch} disabled={!isOwner} min={1} max={100}
                onChange={(e) => setTopKFetch(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">最終返回 Top K</label>
              <input type="number" value={topKReturn} disabled={!isOwner} min={1} max={50}
                onChange={(e) => setTopKReturn(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Score 閾值（0–1）</label>
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
          <Cpu size={15} className="text-blue-500" /> 解析設定
        </h3>
        <div className="border border-slate-200 rounded-xl p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">圖片/PDF OCR 模型</label>
            <select
              value={ocrModel}
              disabled={!isOwner}
              onChange={(e) => setOcrModel(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-50"
            >
              <option value="">使用系統預設</option>
              {llmModels.map((m) => (
                <option key={m.key} value={m.api_model}>{m.name} ({m.api_model})</option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-400">用於 PDF 全文理解及 Word/Excel/PPT 內嵌圖片 OCR 的 Gemini 模型。</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">格式解析模式（預設）</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { val: 'text_only',    label: '純文字',   desc: '只提取文字內容，忽略顏色/格式' },
                { val: 'format_aware', label: '格式感知', desc: '標注顏色語義（異常/注意/待確認/正常/資訊）' },
              ].map((opt) => (
                <label key={opt.val} className={`cursor-pointer border rounded-lg p-2.5 transition ${!isOwner ? 'opacity-60 cursor-not-allowed' : ''} ${parseMode === opt.val ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <input type="radio" className="sr-only" value={opt.val} checked={parseMode === opt.val} disabled={!isOwner} onChange={() => setParseMode(opt.val)} />
                  <div className="text-xs font-medium text-slate-700">{opt.label}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{opt.desc}</div>
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">適用 PDF · DOCX · XLSX。PPTX 與圖片固定為純文字模式。上傳時可個別覆蓋此設定。</p>
          </div>
        </div>
      </div>

      {isOwner && (
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
            <Save size={14} /> {saving ? '儲存中...' : '儲存設定'}
          </button>
          {msg && <span className={`text-sm ${msg.includes('失敗') ? 'text-red-500' : 'text-green-600'}`}>{msg}</span>}
        </div>
      )}
    </div>
  )
}

// ─── Share Tab ─────────────────────────────────────────────────────────────────

function ShareTab({ kb, isOwner }: { kb: KnowledgeBase; isOwner: boolean }) {
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
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/users?search=${encodeURIComponent(userSearch)}`)
        setUserOptions((res.data || []).slice(0, 10))
      } catch { setUserOptions([]) }
    }, 300)
    return () => clearTimeout(t)
  }, [userSearch, granteeType])

  const addGrant = async () => {
    if (!granteeId) { setMsg('請選擇共享對象'); return }
    setAdding(true); setMsg('')
    try {
      await api.post(`/kb/${kb.id}/access`, { grantee_type: granteeType, grantee_id: granteeId, permission })
      setGranteeId(''); setUserSearch('')
      await load()
      setMsg('已新增共享')
      setTimeout(() => setMsg(''), 2000)
    } catch (e: any) {
      setMsg(e.response?.data?.error || '新增失敗')
    } finally { setAdding(false) }
  }

  const removeGrant = async (grantId: string) => {
    try {
      await api.delete(`/kb/${kb.id}/access/${grantId}`)
      setGrants((p) => p.filter((g) => g.id !== grantId))
    } catch (e: any) { alert(e.response?.data?.error || '移除失敗') }
  }

  const requestPublic = async () => {
    if (!confirm('確定申請將此知識庫公開？申請後需等待管理員審核。')) return
    setRequestingPublic(true)
    try {
      await api.post(`/kb/${kb.id}/request-public`)
      setMsg('公開申請已送出')
    } catch (e: any) {
      setMsg(e.response?.data?.error || '申請失敗')
    } finally { setRequestingPublic(false) }
  }

  const granteeTypeLabel: Record<string, string> = {
    user: '使用者', role: '角色', dept: '部門', profit_center: '利潤中心', org_section: '事業處', org_group: '事業群',
  }
  const typeIcon = (type: string) => {
    if (type === 'user') return <User size={12} />
    return <Building2 size={12} />
  }

  const getLabel = (g: Grant) => {
    if (g.grantee_type === 'user') return `使用者 #${g.grantee_id}`
    if (g.grantee_type === 'role') return `角色 #${g.grantee_id}`
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
            <div className="text-sm font-medium text-slate-700">申請公開知識庫</div>
            <div className="text-xs text-slate-400 mt-0.5">
              {kb.public_status === 'pending' ? '申請已送出，等待管理員審核' : '公開後所有使用者皆可搜尋此知識庫的內容'}
            </div>
          </div>
          {kb.public_status !== 'pending' && isOwner && (
            <button
              onClick={requestPublic}
              disabled={requestingPublic}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
            >
              <Globe size={13} /> 申請公開
            </button>
          )}
        </div>
      )}

      {/* Add grant */}
      {isOwner && (
        <div className="border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="text-sm font-semibold text-slate-700">新增共享對象</div>
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
                  placeholder="搜尋使用者姓名 / 帳號 / 工號"
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
                <option value="">請選擇...</option>
                {getOrgOptions().map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            )}

            <select value={permission} onChange={(e) => setPermission(e.target.value as 'use' | 'edit')}
              className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="use">使用權限</option>
              <option value="edit">編輯權限</option>
            </select>

            <button onClick={addGrant} disabled={adding || !granteeId}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition">
              <Plus size={13} /> 新增
            </button>
          </div>
          <p className="text-xs text-slate-400">
            <strong>使用權限</strong>：可在對話中呼叫此知識庫，但不顯示於知識庫市集。
            <strong>編輯權限</strong>：顯示於知識庫市集，可查看並編輯文件。
          </p>
          {msg && <span className={`text-sm ${msg.includes('失敗') ? 'text-red-500' : 'text-green-600'}`}>{msg}</span>}
        </div>
      )}

      {/* Grant list */}
      {loading ? (
        <div className="text-center py-8 text-slate-400 text-sm">載入中...</div>
      ) : grants.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">尚無共享設定</div>
      ) : (
        <div className="space-y-2">
          {grants.map((g) => (
            <div key={g.id} className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="text-slate-400">{typeIcon(g.grantee_type)}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-700">{getLabel(g)}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${g.permission === 'edit' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                    {g.permission === 'edit' ? '編輯' : '使用'}
                  </span>
                </div>
                <div className="text-xs text-slate-400">由 {g.granted_by_name} 授權 · {g.granted_at?.slice(0, 10)}</div>
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
      alert(e.response?.data?.error || '搜尋失敗')
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
          <div className="text-sm font-semibold text-slate-700 mb-1">檢索測試</div>
          <div className="text-xs text-slate-400 mb-3">基於給定的查詢文字測試知識庫的檢索效果</div>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, 200))}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); search() } }}
            rows={5}
            placeholder="請輸入文字，建議使用簡短的陳述句。"
            className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-slate-400">{query.length} / 200</span>
            <button
              onClick={search}
              disabled={searching || !query.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
            >
              <Target size={13} className={searching ? 'animate-spin' : ''} />
              {searching ? '搜尋中...' : '測試'}
            </button>
          </div>
        </div>

        {/* Settings */}
        <div className="border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">檢索設定</div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { val: 'vector',   label: '向量檢索',   icon: '⟐' },
              { val: 'fulltext', label: '全文檢索',   icon: '≡' },
              { val: 'hybrid',   label: '混合檢索',   icon: '⊕' },
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
              <label className="block text-xs font-medium text-slate-600 mb-1">Top K</label>
              <input type="number" value={topK} min={1} max={50} onChange={(e) => setTopK(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Score 閾值</label>
              <input type="number" value={score} min={0} max={1} step={0.05} onChange={(e) => setScore(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" />
            </div>
          </div>
        </div>

        {/* Records placeholder */}
        {searched && elapsed !== null && (
          <div className="text-xs text-slate-400 text-right">耗時 {elapsed} ms · 找到 {results.length} 筆</div>
        )}
      </div>

      {/* Right: results */}
      <div className="w-96 space-y-3 flex flex-col">
        <div className="text-sm font-semibold text-slate-700">
          {!searched ? '搜尋結果將在這裡展示' : results.length === 0 ? '未找到相關分塊' : `搜尋結果 (${results.length} 筆)`}
        </div>
        {!searched ? (
          <div className="flex-1 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center text-slate-400 text-sm py-20">
            <div className="text-center">
              <Search size={28} className="mx-auto mb-2 opacity-30" />
              <p>搜尋測試結果展示在這裡</p>
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
                    <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">查看父段落</summary>
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
