import { useState, useEffect } from 'react'
import { Activity, Plus, Pencil, Trash2, CheckCircle, XCircle } from 'lucide-react'
import api from '../../lib/api'

interface HealthCheck {
  id: number
  name: string
  url: string
  method: string
  expected_status: number
  timeout_ms: number
  enabled: number
  latestResult: { status_code: number; response_ms: number; is_up: number } | null
  uptime30d: number | null
}

interface Props {
  onRefresh: () => void
}

export default function HealthChecksPanel({ onRefresh }: Props) {
  const [checks, setChecks] = useState<HealthCheck[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<HealthCheck | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', url: '', method: 'GET', expected_status: 200, timeout_ms: 5000 })

  const load = async () => {
    try {
      const { data } = await api.get('/monitor/health-checks')
      setChecks(data)
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleSave = async () => {
    try {
      if (editing) {
        await api.put(`/monitor/health-checks/${editing.id}`, { ...form, enabled: editing.enabled })
      } else {
        await api.post('/monitor/health-checks', form)
      }
      setEditing(null)
      setAdding(false)
      load()
      onRefresh()
    } catch (e: unknown) {
      alert((e as Error).message)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('確定刪除?')) return
    try {
      await api.delete(`/monitor/health-checks/${id}`)
      load()
      onRefresh()
    } catch {}
  }

  const toggleEnabled = async (check: HealthCheck) => {
    try {
      await api.put(`/monitor/health-checks/${check.id}`, {
        name: check.name, url: check.url, method: check.method,
        expected_status: check.expected_status, timeout_ms: check.timeout_ms,
        enabled: !check.enabled,
      })
      load()
    } catch {}
  }

  if (loading) return <div className="animate-pulse h-32 bg-white border rounded-lg" />

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Activity size={14} className="text-blue-500" />
        <span className="text-sm font-medium text-slate-700">Service 健康檢查</span>
        <button
          onClick={() => {
            setForm({ name: '', url: '', method: 'GET', expected_status: 200, timeout_ms: 5000 })
            setAdding(true)
            setEditing(null)
          }}
          className="ml-auto flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
        >
          <Plus size={12} /> 新增
        </button>
      </div>

      {(adding || editing) && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Name"
              className="text-xs border rounded px-2 py-1"
            />
            <input
              value={form.url}
              onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
              placeholder="URL"
              className="text-xs border rounded px-2 py-1 col-span-2"
            />
            <select
              value={form.method}
              onChange={e => setForm(f => ({ ...f, method: e.target.value }))}
              className="text-xs border rounded px-2 py-1"
            >
              <option>GET</option>
              <option>HEAD</option>
              <option>POST</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
              儲存
            </button>
            <button onClick={() => { setAdding(false); setEditing(null) }} className="text-xs text-slate-500 px-3 py-1">
              取消
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {checks.map(c => (
          <div key={c.id} className="flex items-center gap-2 text-xs p-2 rounded hover:bg-slate-50">
            {c.latestResult
              ? c.latestResult.is_up
                ? <CheckCircle size={14} className="text-green-500 shrink-0" />
                : <XCircle size={14} className="text-red-500 shrink-0" />
              : <Activity size={14} className="text-slate-300 shrink-0" />}
            <span className={`font-medium ${!c.enabled ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
              {c.name}
            </span>
            {c.latestResult && (
              <span className="text-slate-400 font-mono">{c.latestResult.response_ms}ms</span>
            )}
            {c.uptime30d != null && (
              <span className={`font-mono ${c.uptime30d >= 99.9 ? 'text-green-600' : c.uptime30d >= 99 ? 'text-orange-500' : 'text-red-600'}`}>
                {c.uptime30d}%
              </span>
            )}
            <span className="text-slate-400 ml-auto text-[10px] truncate max-w-[150px]" title={c.url}>{c.url}</span>
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => toggleEnabled(c)}
                className={`text-[10px] px-1.5 py-0.5 rounded ${c.enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}
              >
                {c.enabled ? 'ON' : 'OFF'}
              </button>
              <button
                onClick={() => {
                  setForm({ name: c.name, url: c.url, method: c.method, expected_status: c.expected_status, timeout_ms: c.timeout_ms })
                  setEditing(c)
                  setAdding(false)
                }}
                className="p-0.5 text-slate-400 hover:text-blue-600"
              >
                <Pencil size={11} />
              </button>
              <button onClick={() => handleDelete(c.id)} className="p-0.5 text-slate-400 hover:text-red-600">
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        ))}
        {checks.length === 0 && !adding && (
          <div className="text-xs text-slate-400 text-center py-4">尚無健康檢查項目</div>
        )}
      </div>
    </div>
  )
}
