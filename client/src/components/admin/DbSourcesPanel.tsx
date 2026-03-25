'use client'
import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit3, Wifi, WifiOff, CheckCircle, XCircle, RefreshCw } from 'lucide-react'
import api from '../../lib/api'
import type { DbSource } from '../../types'

interface FormState {
  name: string
  db_type: 'oracle' | 'mysql' | 'mssql'
  host: string
  port: string
  service_name: string
  database_name: string
  username: string
  password: string
  is_active: boolean
  pool_min: string
  pool_max: string
}

const empty: FormState = {
  name: '', db_type: 'oracle', host: '', port: '', service_name: '', database_name: '',
  username: '', password: '', is_active: true, pool_min: '1', pool_max: '5',
}

export default function DbSourcesPanel() {
  const [sources, setSources] = useState<DbSource[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(empty)
  const [saving, setSaving] = useState(false)
  const [pinging, setPinging] = useState<number | null>(null)
  const [pingResults, setPingResults] = useState<Record<number, { ok: boolean; message: string; latency_ms: number }>>({})

  const load = () => api.get('/db-sources').then(r => setSources(r.data)).catch(() => {})
  useEffect(() => { load() }, [])

  const defaultPort = (t: string) => t === 'oracle' ? '1521' : t === 'mysql' ? '3306' : '1433'

  const openNew = () => {
    setEditId(null)
    setForm(empty)
    setShowForm(true)
  }

  const openEdit = (s: DbSource) => {
    setEditId(s.id)
    setForm({
      name: s.name, db_type: s.db_type, host: s.host, port: String(s.port),
      service_name: s.service_name || '', database_name: s.database_name || '',
      username: s.username, password: '****', is_active: !!s.is_active,
      pool_min: '1', pool_max: '5',
    })
    setShowForm(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        ...form,
        port: Number(form.port) || Number(defaultPort(form.db_type)),
        pool_min: Number(form.pool_min),
        pool_max: Number(form.pool_max),
        is_active: form.is_active ? 1 : 0,
      }
      if (editId) {
        await api.put(`/db-sources/${editId}`, payload)
      } else {
        await api.post('/db-sources', payload)
      }
      setShowForm(false)
      load()
    } catch (e: any) {
      alert(e?.response?.data?.error || '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  const del = async (s: DbSource) => {
    if (!confirm(`確定刪除「${s.name}」？`)) return
    try {
      await api.delete(`/db-sources/${s.id}`)
      load()
    } catch (e: any) {
      alert(e?.response?.data?.error || '刪除失敗')
    }
  }

  const ping = async (s: DbSource) => {
    setPinging(s.id)
    try {
      const r = await api.post(`/db-sources/${s.id}/ping`)
      setPingResults(p => ({ ...p, [s.id]: r.data }))
      load()
    } catch (e: any) {
      setPingResults(p => ({ ...p, [s.id]: { ok: false, message: e?.response?.data?.error || '連線失敗', latency_ms: 0 } }))
    } finally {
      setPinging(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">AI 戰情 — 外部資料來源</h2>
          <p className="text-xs text-gray-400 mt-0.5">管理 AI 查詢可使用的 Oracle / MySQL / MSSQL 連線</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          <Plus size={14} /> 新增來源
        </button>
      </div>

      <div className="space-y-2">
        {sources.map(s => {
          const pr = pingResults[s.id]
          return (
            <div key={s.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800 text-sm">{s.name}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 uppercase">{s.db_type}</span>
                  {s.is_default ? <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-600">預設</span> : null}
                  {!s.is_active ? <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">停用</span> : null}
                </div>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">
                  {s.username}@{s.host}:{s.port}{s.service_name ? '/' + s.service_name : ''}{s.database_name ? '/' + s.database_name : ''}
                </p>
                {pr && (
                  <p className={`text-xs mt-1 ${pr.ok ? 'text-green-600' : 'text-red-500'}`}>
                    {pr.ok ? `✓ 連線成功 (${pr.latency_ms}ms)` : `✗ ${pr.message}`}
                  </p>
                )}
                {s.last_ping_at && !pr && (
                  <p className={`text-xs mt-0.5 ${s.last_ping_ok ? 'text-green-500' : 'text-red-400'}`}>
                    上次 Ping: {s.last_ping_ok ? '成功' : '失敗'} · {new Date(s.last_ping_at).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => ping(s)} disabled={pinging === s.id}
                  title="測試連線"
                  className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">
                  {pinging === s.id
                    ? <RefreshCw size={14} className="animate-spin" />
                    : s.last_ping_ok === 1 ? <Wifi size={14} className="text-green-500" />
                    : s.last_ping_ok === 0 ? <WifiOff size={14} className="text-red-400" />
                    : <Wifi size={14} />}
                </button>
                <button onClick={() => openEdit(s)}
                  className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">
                  <Edit3 size={14} />
                </button>
                {!s.is_default && (
                  <button onClick={() => del(s)}
                    className="p-1.5 rounded-lg border border-red-100 hover:bg-red-50 text-red-400">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {sources.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">尚無 DB 來源</p>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-[520px] space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">{editId ? '編輯' : '新增'} DB 來源</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">名稱 *</label>
                <input className="input py-1.5 text-sm w-full" value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="ERP Oracle 主機" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">資料庫類型 *</label>
                <select className="input py-1.5 text-sm w-full" value={form.db_type}
                  onChange={e => setForm(p => ({ ...p, db_type: e.target.value as any, port: defaultPort(e.target.value) }))}>
                  <option value="oracle">Oracle</option>
                  <option value="mysql">MySQL</option>
                  <option value="mssql">MSSQL</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">狀態</label>
                <select className="input py-1.5 text-sm w-full" value={form.is_active ? '1' : '0'}
                  onChange={e => setForm(p => ({ ...p, is_active: e.target.value === '1' }))}>
                  <option value="1">啟用</option>
                  <option value="0">停用</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Host *</label>
                <input className="input py-1.5 text-sm w-full" value={form.host}
                  onChange={e => setForm(p => ({ ...p, host: e.target.value }))} placeholder="192.168.1.100" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Port</label>
                <input className="input py-1.5 text-sm w-full" value={form.port}
                  onChange={e => setForm(p => ({ ...p, port: e.target.value }))}
                  placeholder={defaultPort(form.db_type)} />
              </div>
              {form.db_type === 'oracle' ? (
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-1 block">Service Name (Oracle)</label>
                  <input className="input py-1.5 text-sm w-full" value={form.service_name}
                    onChange={e => setForm(p => ({ ...p, service_name: e.target.value }))} placeholder="ORCL" />
                </div>
              ) : (
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-1 block">Database Name</label>
                  <input className="input py-1.5 text-sm w-full" value={form.database_name}
                    onChange={e => setForm(p => ({ ...p, database_name: e.target.value }))} placeholder="mydb" />
                </div>
              )}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">帳號 *</label>
                <input className="input py-1.5 text-sm w-full" value={form.username}
                  onChange={e => setForm(p => ({ ...p, username: e.target.value }))} placeholder="apps" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">密碼 {editId ? '(留 **** 不變)' : '*'}</label>
                <input className="input py-1.5 text-sm w-full" type="password" value={form.password}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="••••••••" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Pool Min</label>
                <input className="input py-1.5 text-sm w-full" type="number" min={0} value={form.pool_min}
                  onChange={e => setForm(p => ({ ...p, pool_min: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Pool Max</label>
                <input className="input py-1.5 text-sm w-full" type="number" min={1} value={form.pool_max}
                  onChange={e => setForm(p => ({ ...p, pool_max: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowForm(false)}
                className="px-4 py-1.5 rounded-lg text-sm text-gray-600 border border-gray-200 hover:bg-gray-50">
                取消
              </button>
              <button onClick={save} disabled={saving}
                className="px-4 py-1.5 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? '儲存中...' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
