import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Copy, Check, ToggleLeft, ToggleRight, Key, RefreshCw } from 'lucide-react'
import api from '../../lib/api'

interface ApiKey {
  id: number
  name: string
  key_prefix: string
  description: string | null
  kb_ids: string | null
  is_active: number
  expires_at: string | null
  created_at: string
  last_used_at: string | null
  created_by_name: string | null
  created_by_username: string
}

interface Kb {
  id: number
  name: string
}

const BASE_URL = (import.meta as any).env?.VITE_API_URL || ''

export default function ApiKeysPanel() {
  const [keys,    setKeys]    = useState<ApiKey[]>([])
  const [kbs,     setKbs]     = useState<Kb[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [newKey,   setNewKey]   = useState<string | null>(null)  // shown once after creation
  const [copied,   setCopied]   = useState(false)

  const [form, setForm] = useState({
    name: '',
    description: '',
    kb_ids: [] as number[],
    expires_at: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [keysRes, kbsRes] = await Promise.all([
        api.get('/api-keys'),
        api.get('/kb'),
      ])
      setKeys(keysRes.data)
      setKbs(kbsRes.data?.kbs || kbsRes.data || [])
    } catch (e: any) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!form.name.trim()) return
    try {
      const payload: Record<string, any> = {
        name:        form.name.trim(),
        description: form.description.trim() || undefined,
        kb_ids:      form.kb_ids.length ? form.kb_ids : undefined,
        expires_at:  form.expires_at || undefined,
      }
      const res = await api.post('/api-keys', payload)
      setNewKey(res.data.key)
      setShowForm(false)
      setForm({ name: '', description: '', kb_ids: [], expires_at: '' })
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
    }
  }

  const toggleActive = async (k: ApiKey) => {
    try {
      await api.patch(`/api-keys/${k.id}`, { is_active: k.is_active ? 0 : 1 })
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('確定刪除此 API 金鑰？此操作無法復原。')) return
    try {
      await api.delete(`/api-keys/${id}`)
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || e.message)
    }
  }

  const copyKey = () => {
    if (!newKey) return
    navigator.clipboard.writeText(newKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const toggleKb = (id: number) => {
    setForm((f) => ({
      ...f,
      kb_ids: f.kb_ids.includes(id) ? f.kb_ids.filter((x) => x !== id) : [...f.kb_ids, id],
    }))
  }

  const externalBase = `${window.location.protocol}//${window.location.hostname}:${window.location.port.replace('5173', '3001') || '3001'}`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">外部 API 金鑰管理</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            API 端點：<code className="bg-slate-100 px-1 rounded">{externalBase}/api/v1</code>
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load()} className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => { setShowForm(true); setNewKey(null) }}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition"
          >
            <Plus size={15} /> 新增金鑰
          </button>
        </div>
      </div>

      {/* API Docs hint */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 space-y-1">
        <p className="font-semibold text-slate-700 mb-2">API 使用說明</p>
        <p>在 HTTP Header 加入：<code className="bg-white border border-slate-200 px-1 rounded">Authorization: Bearer {'<your-api-key>'}</code></p>
        <div className="mt-2 space-y-1">
          <p><span className="text-green-700 font-mono">GET</span>  <code>{externalBase}/api/v1/kb/list</code> — 列出可存取的知識庫</p>
          <p><span className="text-blue-700 font-mono">POST</span> <code>{externalBase}/api/v1/kb/search</code> — 搜尋知識庫 (body: {'{ kb_id, query, top_k }'})</p>
          <p><span className="text-blue-700 font-mono">POST</span> <code>{externalBase}/api/v1/kb/chat</code> — 知識庫問答 (body: {'{ kb_id, question, model }'})</p>
        </div>
      </div>

      {/* One-time key display */}
      {newKey && (
        <div className="bg-green-50 border border-green-300 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-green-800 flex items-center gap-1.5">
            <Key size={15} /> API 金鑰已建立（請立即複製，此後將無法再查看）
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-green-200 rounded-lg px-3 py-2 text-sm font-mono text-slate-800 break-all">
              {newKey}
            </code>
            <button
              onClick={copyKey}
              className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 transition"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? '已複製' : '複製'}
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="text-xs text-green-700 hover:underline">
            已複製，關閉提示
          </button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-slate-700 text-sm">新增 API 金鑰</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 md:col-span-1">
              <label className="text-xs text-slate-500 mb-1 block">名稱 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="例：外部系統 A"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="text-xs text-slate-500 mb-1 block">到期日（選填）</label>
              <input
                type="date"
                value={form.expires_at}
                onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500 mb-1 block">描述（選填）</label>
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="用途說明"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {kbs.length > 0 && (
            <div>
              <label className="text-xs text-slate-500 mb-2 block">
                可存取知識庫（不選 = 全部）
              </label>
              <div className="flex flex-wrap gap-2">
                {kbs.map((kb) => (
                  <label key={kb.id} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.kb_ids.includes(kb.id)}
                      onChange={() => toggleKb(kb.id)}
                      className="rounded border-slate-300"
                    />
                    <span className="text-sm text-slate-700">{kb.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={!form.name.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
            >
              建立金鑰
            </button>
          </div>
        </div>
      )}

      {/* Keys table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">名稱</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">前綴</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">知識庫</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">狀態</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">到期日</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">最後使用</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">建立者</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={8} className="text-center py-8 text-slate-400">載入中...</td></tr>
            )}
            {!loading && keys.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8 text-slate-400">尚無 API 金鑰</td></tr>
            )}
            {!loading && keys.map((k) => {
              let kbLabel = '（全部）'
              if (k.kb_ids) {
                try {
                  const ids: number[] = JSON.parse(k.kb_ids)
                  const names = ids.map((id) => kbs.find((kb) => kb.id === id)?.name || `#${id}`)
                  kbLabel = names.join(', ')
                } catch { /* ignore */ }
              }
              const isExpired = k.expires_at && new Date(k.expires_at) < new Date()
              return (
                <tr key={k.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{k.name}</p>
                    {k.description && <p className="text-xs text-slate-400 truncate max-w-40">{k.description}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs bg-slate-100 px-2 py-0.5 rounded font-mono">{k.key_prefix}...</code>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 max-w-32 truncate">{kbLabel}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(k)} className="flex items-center gap-1.5 text-xs transition">
                      {k.is_active && !isExpired
                        ? <><ToggleRight size={18} className="text-green-500" /><span className="text-green-600">啟用</span></>
                        : <><ToggleLeft  size={18} className="text-slate-400" /><span className="text-slate-400">{isExpired ? '已到期' : '停用'}</span></>
                      }
                    </button>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {k.expires_at ? k.expires_at.slice(0, 10) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {k.last_used_at ? k.last_used_at.slice(0, 16) : '從未使用'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {k.created_by_name || k.created_by_username}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(k.id)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
