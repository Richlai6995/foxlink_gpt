import { useEffect, useState } from 'react'
import {
  Plus, Trash2, Edit2, ChevronDown, ChevronRight,
  ToggleLeft, ToggleRight, AlertCircle, CheckCircle, Zap, Clock
} from 'lucide-react'
import api from '../../lib/api'

interface DifyKb {
  id: number
  name: string
  api_server: string
  api_key: string
  api_key_masked: string
  description: string | null
  is_active: number
  sort_order: number
  created_at: string
  updated_at: string
}

interface DifyCallLog {
  id: number
  query_preview: string | null
  response_preview: string | null
  status: string
  error_msg: string | null
  duration_ms: number | null
  called_at: string
  user_name: string | null
}

const emptyForm = {
  name: '',
  api_server: 'https://fldify-api.foxlink.com.tw/v1',
  api_key: '',
  description: '',
  is_active: true,
  sort_order: 0,
}

export default function DifyKnowledgeBasesPanel() {
  const [kbs, setKbs] = useState<DifyKb[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<DifyKb | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testMsg, setTestMsg] = useState<Record<number, { ok: boolean; text: string }>>({})
  const [selectedLogKb, setSelectedLogKb] = useState<DifyKb | null>(null)
  const [logs, setLogs] = useState<DifyCallLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [testQuery, setTestQuery] = useState('')

  const load = async () => {
    try {
      setLoading(true)
      const res = await api.get('/dify-kb')
      setKbs(res.data)
    } catch (e: any) {
      setError(e.response?.data?.error || '載入失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm)
    setError('')
    setShowModal(true)
  }

  const openEdit = (kb: DifyKb) => {
    setEditing(kb)
    setForm({
      name: kb.name,
      api_server: kb.api_server,
      api_key: '',  // blank = keep existing
      description: kb.description || '',
      is_active: !!kb.is_active,
      sort_order: kb.sort_order,
    })
    setError('')
    setShowModal(true)
  }

  const save = async () => {
    if (!form.name.trim() || !form.api_server.trim()) {
      setError('名稱和 API Server 為必填')
      return
    }
    if (!editing && !form.api_key.trim()) {
      setError('新增時 API Key 為必填')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload: any = {
        name: form.name,
        api_server: form.api_server,
        description: form.description || null,
        is_active: form.is_active,
        sort_order: form.sort_order,
      }
      if (form.api_key.trim()) payload.api_key = form.api_key.trim()
      if (editing) {
        await api.put(`/dify-kb/${editing.id}`, payload)
      } else {
        await api.post('/dify-kb', payload)
      }
      setShowModal(false)
      await load()
    } catch (e: any) {
      setError(e.response?.data?.error || '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (kb: DifyKb) => {
    if (!confirm(`確定刪除「${kb.name}」？相關呼叫記錄也會一併刪除。`)) return
    try {
      await api.delete(`/dify-kb/${kb.id}`)
      await load()
      if (selectedLogKb?.id === kb.id) setSelectedLogKb(null)
    } catch (e: any) {
      alert(e.response?.data?.error || '刪除失敗')
    }
  }

  const toggle = async (kb: DifyKb) => {
    try {
      await api.post(`/dify-kb/${kb.id}/toggle`)
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || '操作失敗')
    }
  }

  const test = async (kb: DifyKb) => {
    setTestingId(kb.id)
    setTestMsg(prev => ({ ...prev, [kb.id]: { ok: false, text: '' } }))
    try {
      const res = await api.post(`/dify-kb/${kb.id}/test`, {
        query: testQuery.trim() || undefined,
      })
      setTestMsg(prev => ({
        ...prev,
        [kb.id]: { ok: true, text: `✓ 連線成功 (${res.data.duration_ms}ms)\n${res.data.answer?.slice(0, 150) || ''}` }
      }))
    } catch (e: any) {
      setTestMsg(prev => ({
        ...prev,
        [kb.id]: { ok: false, text: `✗ ${e.response?.data?.error || '連線失敗'}` }
      }))
    } finally {
      setTestingId(null)
    }
  }

  const loadLogs = async (kb: DifyKb) => {
    setSelectedLogKb(kb)
    setLogsLoading(true)
    try {
      const res = await api.get(`/dify-kb/${kb.id}/logs?limit=50`)
      setLogs(res.data)
    } catch {
      setLogs([])
    } finally {
      setLogsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">DIFY 知識庫整合</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            設定多個 DIFY 知識庫，AI 對話時自動查詢並注入相關知識作為回答參考
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition"
        >
          <Plus size={15} /> 新增知識庫
        </button>
      </div>

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
        <strong>運作方式：</strong>每次使用者發送訊息時，系統會自動查詢所有已啟用的 DIFY 知識庫，並將查詢結果作為背景知識注入給 AI，讓 AI 能夠參考企業內部知識庫來回答問題。
      </div>

      {/* Test query input */}
      <div className="flex gap-2 items-center">
        <input
          value={testQuery}
          onChange={e => setTestQuery(e.target.value)}
          placeholder="測試查詢語句（留空使用預設）"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-xs text-slate-400">↑ 測試時使用此查詢</span>
      </div>

      {/* KB List */}
      {loading ? (
        <div className="text-slate-400 text-sm py-8 text-center">載入中...</div>
      ) : kbs.length === 0 ? (
        <div className="text-slate-400 text-sm py-12 text-center border-2 border-dashed border-slate-200 rounded-xl">
          <Zap size={32} className="mx-auto mb-3 text-slate-300" />
          尚未設定任何 DIFY 知識庫
        </div>
      ) : (
        <div className="space-y-3">
          {kbs.map(kb => {
            const expanded = expandedId === kb.id
            const msg = testMsg[kb.id]
            return (
              <div key={kb.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Card Header */}
                <div className="px-4 py-3 flex items-center gap-3">
                  <button onClick={() => setExpandedId(expanded ? null : kb.id)} className="text-slate-400 hover:text-slate-600">
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${kb.is_active ? 'bg-green-500' : 'bg-slate-300'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-800 text-sm">{kb.name}</div>
                    <div className="text-xs text-slate-400 truncate">{kb.api_server}</div>
                  </div>
                  <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full font-medium">
                    #{kb.sort_order} 順序
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => test(kb)}
                      disabled={testingId === kb.id}
                      title="測試連線"
                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition disabled:opacity-50 flex items-center gap-1 text-xs"
                    >
                      <Zap size={13} className={testingId === kb.id ? 'animate-pulse' : ''} />
                      {testingId === kb.id ? '測試中' : '測試'}
                    </button>
                    <button onClick={() => openEdit(kb)} title="編輯" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => toggle(kb)} title={kb.is_active ? '停用' : '啟用'} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition">
                      {kb.is_active ? <ToggleRight size={16} className="text-green-500" /> : <ToggleLeft size={16} />}
                    </button>
                    <button onClick={() => remove(kb)} title="刪除" className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
                      <Trash2 size={14} />
                    </button>
                    <button
                      onClick={() => loadLogs(kb)}
                      className="px-2 py-1 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                    >
                      呼叫記錄
                    </button>
                  </div>
                </div>

                {/* Test result */}
                {msg && msg.text && (
                  <div className={`px-4 pb-2 text-xs whitespace-pre-wrap ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>
                    {msg.text}
                  </div>
                )}

                {/* Expanded detail */}
                {expanded && (
                  <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 space-y-2">
                    <div className="flex gap-2 text-xs">
                      <span className="font-medium text-slate-500 w-20">API Server</span>
                      <span className="font-mono text-slate-700">{kb.api_server}</span>
                    </div>
                    <div className="flex gap-2 text-xs">
                      <span className="font-medium text-slate-500 w-20">API Key</span>
                      <span className="font-mono text-slate-400">{kb.api_key_masked}</span>
                    </div>
                    {kb.description && (
                      <div className="flex gap-2 text-xs">
                        <span className="font-medium text-slate-500 w-20">描述</span>
                        <span className="text-slate-600">{kb.description}</span>
                      </div>
                    )}
                    <div className="flex gap-2 text-xs">
                      <span className="font-medium text-slate-500 w-20">狀態</span>
                      <span className={kb.is_active ? 'text-green-600' : 'text-slate-400'}>
                        {kb.is_active ? '✓ 啟用中（查詢時自動引用）' : '已停用'}
                      </span>
                    </div>
                    <div className="flex gap-2 text-xs text-slate-400">
                      <Clock size={11} className="mt-0.5" />
                      更新時間：{kb.updated_at}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Call Logs Section */}
      {selectedLogKb && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="font-medium text-slate-700 text-sm">「{selectedLogKb.name}」呼叫記錄（最近 50 筆）</div>
            <button onClick={() => setSelectedLogKb(null)} className="text-xs text-slate-400 hover:text-slate-600">關閉</button>
          </div>
          {logsLoading ? (
            <div className="text-slate-400 text-sm py-6 text-center">載入中...</div>
          ) : logs.length === 0 ? (
            <div className="text-slate-400 text-sm py-8 text-center">尚無呼叫記錄</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500">
                    <th className="px-3 py-2 text-left font-medium">時間</th>
                    <th className="px-3 py-2 text-left font-medium">使用者</th>
                    <th className="px-3 py-2 text-left font-medium">狀態</th>
                    <th className="px-3 py-2 text-left font-medium">耗時</th>
                    <th className="px-3 py-2 text-left font-medium">查詢</th>
                    <th className="px-3 py-2 text-left font-medium">回應預覽</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{log.called_at}</td>
                      <td className="px-3 py-2 text-slate-500">{log.user_name || '—'}</td>
                      <td className="px-3 py-2">
                        {log.status === 'ok'
                          ? <span className="flex items-center gap-1 text-green-600"><CheckCircle size={11} /> ok</span>
                          : <span className="flex items-center gap-1 text-red-500"><AlertCircle size={11} /> error</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{log.duration_ms != null ? `${log.duration_ms}ms` : '—'}</td>
                      <td className="px-3 py-2 text-slate-500 max-w-[160px] truncate">{log.query_preview || '—'}</td>
                      <td className="px-3 py-2 text-slate-500 max-w-xs truncate">
                        {log.status === 'error' ? log.error_msg : (log.response_preview || '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <h3 className="text-base font-semibold text-slate-800 mb-4">
              {editing ? '編輯 DIFY 知識庫' : '新增 DIFY 知識庫'}
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">名稱 *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="例：產品規格知識庫"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">API Server *</label>
                <input
                  value={form.api_server}
                  onChange={e => setForm(p => ({ ...p, api_server: e.target.value }))}
                  placeholder="https://fldify-api.foxlink.com.tw/v1"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  API Key {editing ? '（留空保持不變）' : '*'}
                </label>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={e => setForm(p => ({ ...p, api_key: e.target.value }))}
                  placeholder={editing ? '留空表示不修改' : 'app-xxxxxxxxxxxxxxxx'}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  描述（告訴 AI 這個知識庫的用途，方便 AI 判斷引用時機）
                </label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={3}
                  placeholder="例：包含產品規格、零件型號、技術參數等資訊，當使用者詢問產品規格時優先引用"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">排序順序（數字越小越優先）</label>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={e => setForm(p => ({ ...p, sort_order: parseInt(e.target.value) || 0 }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-sm text-slate-700">啟用（對話時自動查詢此知識庫）</span>
              </label>
            </div>

            {error && <p className="text-red-500 text-sm mt-3">{error}</p>}

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">
                取消
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {saving ? '儲存中...' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
