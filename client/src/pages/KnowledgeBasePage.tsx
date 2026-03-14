import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, BookOpen, Cpu, Trash2, Search, FileText,
  Lock, Globe, Clock, ChevronRight, AlertCircle, Layers,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import TranslationFields, { type TranslationData } from '../components/common/TranslationFields'

interface KnowledgeBase {
  id: string
  name: string
  description: string | null
  embedding_dims: number
  chunk_strategy: string
  retrieval_mode: string
  is_public: number
  public_status: string
  doc_count: number
  chunk_count: number
  total_size_bytes: number
  creator_name: string
  creator_emp: string | null
  is_owner: boolean
  created_at: string
  updated_at: string
}

interface CreateForm {
  name: string
  description: string
  embedding_dims: number
  chunk_strategy: string
  retrieval_mode: string
  ocr_model: string
  parse_mode: string
}

const emptyForm = (): CreateForm => ({
  name: '',
  description: '',
  embedding_dims: 768,
  chunk_strategy: 'regular',
  retrieval_mode: 'hybrid',
  ocr_model: '',
  parse_mode: 'text_only',
})

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function KnowledgeBasePage() {
  const { user, isAdmin } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const canCreate = isAdmin || (user as any)?.effective_can_create_kb === true

  const [kbs, setKbs] = useState<KnowledgeBase[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateForm>(emptyForm())
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [trans, setTrans] = useState<TranslationData>({})
  const [translating, setTranslating] = useState(false)
  const [llmModels, setLlmModels] = useState<{ key: string; name: string; api_model: string }[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/kb')
      setKbs(Array.isArray(res.data) ? res.data : [])
    } catch (e: any) {
      setError(e.response?.data?.error || t('kb.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    api.get('/admin/llm-models').then((res) => {
      const nonImage = (res.data as { key: string; name: string; api_model: string; image_output: number; is_active: number }[])
        .filter((m) => !m.image_output && m.is_active)
      setLlmModels(nonImage)
      const flash = nonImage.find((m) => m.key.includes('flash') || m.name.toLowerCase().includes('flash'))
      if (flash) setForm((f) => ({ ...f, ocr_model: flash.api_model }))
    }).catch(() => {})
  }, [])

  const handleCreate = async () => {
    if (!form.name.trim()) { setError(t('kb.createModal.nameRequired')); return }
    setCreating(true); setTranslating(true); setError('')
    try {
      const res = await api.post('/kb', { ...form, ...trans })
      setShowCreate(false)
      setForm(emptyForm())
      setTrans({})
      navigate(`/kb/${res.data.id}`)
    } catch (e: any) {
      setError(e.response?.data?.error || t('kb.createFailed'))
    } finally {
      setCreating(false)
      setTranslating(false)
    }
  }

  const handleDelete = async (kb: KnowledgeBase, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(t('kb.deleteConfirm', { name: kb.name }))) return
    try {
      await api.delete(`/kb/${kb.id}`)
      setKbs((prev) => prev.filter((k) => k.id !== kb.id))
    } catch (e: any) {
      alert(e.response?.data?.error || t('kb.deleteFailed'))
    }
  }

  const filtered = kbs.filter((kb) =>
    kb.name.toLowerCase().includes(search.toLowerCase()) ||
    (kb.description || '').toLowerCase().includes(search.toLowerCase())
  )

  const myKbs     = filtered.filter((kb) => kb.is_owner)
  const sharedKbs = filtered.filter((kb) => !kb.is_owner)

  const statusBadge = (kb: KnowledgeBase) => {
    if (kb.is_public === 1 || kb.public_status === 'public')
      return <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full"><Globe size={10} />{t('kb.statusPublic')}</span>
    if (kb.public_status === 'pending')
      return <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded-full"><Clock size={10} />{t('kb.statusPending')}</span>
    return <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full"><Lock size={10} />{t('kb.statusPrivate')}</span>
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <Cpu size={14} className="text-white" />
          </div>
          <span className="font-bold">FOXLINK GPT</span>
          <span className="text-slate-500 text-sm">/ {t('kb.pageTitle')}</span>
        </div>
        <button onClick={() => navigate('/chat')} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition">
          <ArrowLeft size={15} /> {t('kb.backToChat')}
        </button>
      </header>

      <div className="p-6 max-w-5xl mx-auto space-y-5">
        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('kb.searchPlaceholder')}
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {canCreate && (
            <button
              onClick={() => { setShowCreate(true); setError(''); setForm(emptyForm()) }}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition whitespace-nowrap"
            >
              <Plus size={14} /> {t('kb.createKb')}
            </button>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
            <AlertCircle size={15} /> {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-slate-400 text-sm">{t('kb.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-slate-200 rounded-xl">
            <BookOpen size={36} className="mx-auto mb-3 text-slate-300" />
            <p className="text-slate-400 text-sm">
              {search ? t('kb.noKbMatch') : canCreate ? t('kb.noKbCanCreate') : t('kb.noKbNoAccess')}
            </p>
          </div>
        ) : (
          <>
            {myKbs.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{t('kb.myKbs')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {myKbs.map((kb) => <KbCard key={kb.id} kb={kb} onDelete={handleDelete} statusBadge={statusBadge(kb)} onClick={() => navigate(`/kb/${kb.id}`)} />)}
                </div>
              </section>
            )}
            {sharedKbs.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{t('kb.sharedKbs')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {sharedKbs.map((kb) => <KbCard key={kb.id} kb={kb} onDelete={handleDelete} statusBadge={statusBadge(kb)} onClick={() => navigate(`/kb/${kb.id}`)} />)}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-800">{t('kb.createModal.title')}</h2>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.createModal.nameLabel')}</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t('kb.createModal.namePlaceholder')}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.createModal.descLabel')}</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                placeholder={t('kb.createModal.descPlaceholder')}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            <TranslationFields
              data={trans}
              onChange={setTrans}
              hasDescription
              translating={translating}
            />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.createModal.embeddingDims')}</label>
                <select
                  value={form.embedding_dims}
                  onChange={(e) => setForm({ ...form, embedding_dims: Number(e.target.value) })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={768}>{t('kb.createModal.dims768')}</option>
                  <option value={1536}>{t('kb.createModal.dims1536')}</option>
                  <option value={3072}>{t('kb.createModal.dims3072')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.createModal.chunkStrategy')}</label>
                <select
                  value={form.chunk_strategy}
                  onChange={(e) => setForm({ ...form, chunk_strategy: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="regular">{t('kb.createModal.strategyRegular')}</option>
                  <option value="parent_child">{t('kb.createModal.strategyParentChild')}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.createModal.retrievalMode')}</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { val: 'vector',   label: t('kb.createModal.modeVector'),   desc: t('kb.createModal.modeVectorDesc') },
                  { val: 'fulltext', label: t('kb.createModal.modeFulltext'), desc: t('kb.createModal.modeFulltextDesc') },
                  { val: 'hybrid',   label: t('kb.createModal.modeHybrid'),   desc: t('kb.createModal.modeHybridDesc') },
                ].map((opt) => (
                  <label key={opt.val} className={`cursor-pointer border rounded-lg p-2 text-center transition ${form.retrieval_mode === opt.val ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
                    <input type="radio" className="sr-only" value={opt.val} checked={form.retrieval_mode === opt.val} onChange={() => setForm({ ...form, retrieval_mode: opt.val })} />
                    <div className="text-xs font-medium text-slate-700">{opt.label}</div>
                    <div className="text-xs text-slate-400">{opt.desc}</div>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.createModal.ocrModel')}</label>
                <select
                  value={form.ocr_model}
                  onChange={(e) => setForm({ ...form, ocr_model: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">{t('kb.createModal.ocrModelDefault')}</option>
                  {llmModels.map((m) => (
                    <option key={m.key} value={m.api_model}>{m.name} ({m.api_model})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('kb.createModal.parseMode')}</label>
                <select
                  value={form.parse_mode}
                  onChange={(e) => setForm({ ...form, parse_mode: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="text_only">{t('kb.createModal.parseModeTextOnly')}</option>
                  <option value="format_aware">{t('kb.createModal.parseModeFormatAware')}</option>
                </select>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-600">
              {t('kb.createModal.dimHint')}
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">
                {t('kb.createModal.cancel')}
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {creating ? t('kb.createModal.creating') : t('kb.createModal.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KbCard({
  kb, onDelete, statusBadge, onClick,
}: {
  kb: KnowledgeBase
  onDelete: (kb: KnowledgeBase, e: React.MouseEvent) => void
  statusBadge: React.ReactNode
  onClick: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      onClick={onClick}
      className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md hover:border-blue-300 transition cursor-pointer group"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <BookOpen size={16} className="text-blue-600" />
          </div>
          <div className="min-w-0">
            <div className="font-medium text-slate-800 text-sm truncate">{kb.name}</div>
            <div className="text-xs text-slate-400">{kb.creator_name}{kb.creator_emp ? ` · ${kb.creator_emp}` : ''}</div>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {statusBadge}
          {kb.is_owner && (
            <button
              onClick={(e) => onDelete(kb, e)}
              className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition opacity-0 group-hover:opacity-100"
            >
              <Trash2 size={13} />
            </button>
          )}
          <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition" />
        </div>
      </div>

      {kb.description && (
        <p className="text-xs text-slate-500 mb-2 line-clamp-2">{kb.description}</p>
      )}

      <div className="flex items-center gap-3 text-xs text-slate-400 mt-2">
        <span className="flex items-center gap-1"><FileText size={11} />{t('kb.docCount', { count: kb.doc_count })}</span>
        <span className="flex items-center gap-1"><Layers size={11} />{t('kb.chunkCount', { count: kb.chunk_count })}</span>
        <span>{formatBytes(kb.total_size_bytes)}</span>
        <span className="ml-auto bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{kb.embedding_dims}d</span>
      </div>
    </div>
  )
}
