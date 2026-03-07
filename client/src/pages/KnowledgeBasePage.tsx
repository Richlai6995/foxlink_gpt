import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, BookOpen, Cpu, Trash2, Search, FileText,
  Lock, Globe, Clock, ChevronRight, AlertCircle, Layers,
} from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'

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
  const canCreate = isAdmin || (user as any)?.effective_can_create_kb === true

  const [kbs, setKbs] = useState<KnowledgeBase[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateForm>(emptyForm())
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [llmModels, setLlmModels] = useState<{ key: string; name: string; api_model: string }[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/kb')
      setKbs(Array.isArray(res.data) ? res.data : [])
    } catch (e: any) {
      setError(e.response?.data?.error || '載入失敗')
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
    if (!form.name.trim()) { setError('請輸入知識庫名稱'); return }
    setCreating(true); setError('')
    try {
      const res = await api.post('/kb', form)
      setShowCreate(false)
      setForm(emptyForm())
      navigate(`/kb/${res.data.id}`)
    } catch (e: any) {
      setError(e.response?.data?.error || '建立失敗')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (kb: KnowledgeBase, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`確定刪除知識庫「${kb.name}」？所有文件與向量資料將一併刪除。`)) return
    try {
      await api.delete(`/kb/${kb.id}`)
      setKbs((prev) => prev.filter((k) => k.id !== kb.id))
    } catch (e: any) {
      alert(e.response?.data?.error || '刪除失敗')
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
      return <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full"><Globe size={10} />公開</span>
    if (kb.public_status === 'pending')
      return <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded-full"><Clock size={10} />審核中</span>
    return <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full"><Lock size={10} />私有</span>
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
          <span className="text-slate-500 text-sm">/ 知識庫</span>
        </div>
        <button onClick={() => navigate('/chat')} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition">
          <ArrowLeft size={15} /> 返回聊天
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
              placeholder="搜尋知識庫..."
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {canCreate && (
            <button
              onClick={() => { setShowCreate(true); setError(''); setForm(emptyForm()) }}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition whitespace-nowrap"
            >
              <Plus size={14} /> 建立知識庫
            </button>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
            <AlertCircle size={15} /> {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-slate-400 text-sm">載入中...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-slate-200 rounded-xl">
            <BookOpen size={36} className="mx-auto mb-3 text-slate-300" />
            <p className="text-slate-400 text-sm">
              {search ? '找不到符合的知識庫' : canCreate ? '尚無知識庫，點擊「建立知識庫」開始' : '目前沒有可存取的知識庫'}
            </p>
          </div>
        ) : (
          <>
            {myKbs.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">我的知識庫</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {myKbs.map((kb) => <KbCard key={kb.id} kb={kb} onDelete={handleDelete} statusBadge={statusBadge(kb)} onClick={() => navigate(`/kb/${kb.id}`)} />)}
                </div>
              </section>
            )}
            {sharedKbs.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">共享給我</h2>
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
            <h2 className="text-base font-semibold text-slate-800">建立知識庫</h2>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">名稱 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例：產品技術手冊"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">描述（選填）</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                placeholder="說明此知識庫的用途與內容範疇"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Embedding 維度</label>
                <select
                  value={form.embedding_dims}
                  onChange={(e) => setForm({ ...form, embedding_dims: Number(e.target.value) })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={768}>768（標準）</option>
                  <option value={1536}>1536（高精度）</option>
                  <option value={3072}>3072（最高精度）</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">分塊策略</label>
                <select
                  value={form.chunk_strategy}
                  onChange={(e) => setForm({ ...form, chunk_strategy: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="regular">常規分段</option>
                  <option value="parent_child">父子分塊</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">檢索模式</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { val: 'vector',   label: '向量檢索',   desc: '語意相似度' },
                  { val: 'fulltext', label: '全文檢索',   desc: '關鍵字比對' },
                  { val: 'hybrid',   label: '混合檢索',   desc: '兩者結合' },
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
                <label className="block text-xs font-medium text-slate-600 mb-1">圖片/PDF OCR 模型</label>
                <select
                  value={form.ocr_model}
                  onChange={(e) => setForm({ ...form, ocr_model: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">使用系統預設</option>
                  {llmModels.map((m) => (
                    <option key={m.key} value={m.api_model}>{m.name} ({m.api_model})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">格式解析模式</label>
                <select
                  value={form.parse_mode}
                  onChange={(e) => setForm({ ...form, parse_mode: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="text_only">純文字</option>
                  <option value="format_aware">格式感知</option>
                </select>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-600">
              💡 維度設定建立後無法更改。768 維適合大多數情況；若需更高語意精確度請選 1536 或 3072（需模型支援）。
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {creating ? '建立中...' : '建立'}
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
        <span className="flex items-center gap-1"><FileText size={11} />{kb.doc_count} 文件</span>
        <span className="flex items-center gap-1"><Layers size={11} />{kb.chunk_count} 分塊</span>
        <span>{formatBytes(kb.total_size_bytes)}</span>
        <span className="ml-auto bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{kb.embedding_dims}d</span>
      </div>
    </div>
  )
}
