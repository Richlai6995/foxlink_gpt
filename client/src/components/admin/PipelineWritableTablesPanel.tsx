import { useState, useEffect, useCallback } from 'react'
import { Database, Plus, Trash2, RefreshCw, Power, PowerOff, Shield, ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'

interface WritableTable {
  id: number
  table_name: string
  display_name?: string
  description?: string
  allowed_operations: string
  max_rows_per_run: number
  is_active: number
  approved_by?: number
  approved_at?: string
  last_refreshed_at?: string
  notes?: string
}

interface ColumnMeta {
  name: string
  type: string
  nullable: boolean
  length?: number
  precision?: number
  scale?: number
}

interface Detail extends WritableTable {
  column_metadata: ColumnMeta[]
}

const OPS = ['insert', 'upsert', 'replace_by_date', 'append'] as const

export default function PipelineWritableTablesPanel() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<WritableTable[]>([])
  const [availableTables, setAvailableTables] = useState<string[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [detailCache, setDetailCache] = useState<Record<number, Detail>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({
    table_name: '', display_name: '', description: '',
    allowed_operations: 'insert,upsert',
    max_rows_per_run: 10000,
    notes: '',
    register_to_ai_dashboard: true,    // 預設勾,核准同時自動註冊到 AI 戰情
  })
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchRows = useCallback(async () => {
    try {
      const r = await api.get('/pipeline-writable-tables')
      setRows(r.data || [])
    } catch (e: any) { setErr(e?.response?.data?.error || e.message) }
  }, [])

  const fetchAvailable = useCallback(async () => {
    try {
      const r = await api.get('/pipeline-writable-tables/available-tables')
      setAvailableTables(r.data || [])
    } catch (_) {}
  }, [])

  useEffect(() => { fetchRows(); fetchAvailable() }, [fetchRows, fetchAvailable])

  const toggleExpand = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (!detailCache[id]) {
      try {
        const r = await api.get(`/pipeline-writable-tables/${id}`)
        setDetailCache(c => ({ ...c, [id]: r.data }))
      } catch (_) {}
    }
  }

  const handleAdd = async () => {
    setErr(null)
    if (!addForm.table_name) { setErr(t('admin.pipelineWhitelist.pickTableRequired')); return }
    setLoading(true)
    try {
      await api.post('/pipeline-writable-tables', addForm)
      setShowAdd(false)
      setAddForm({ table_name: '', display_name: '', description: '', allowed_operations: 'insert,upsert', max_rows_per_run: 10000, notes: '', register_to_ai_dashboard: true })
      await Promise.all([fetchRows(), fetchAvailable()])
    } catch (e: any) {
      setErr(e?.response?.data?.error || e.message)
    } finally { setLoading(false) }
  }

  const handleToggleActive = async (r: WritableTable) => {
    try {
      await api.put(`/pipeline-writable-tables/${r.id}`, { is_active: r.is_active ? 0 : 1 })
      await fetchRows()
    } catch (e: any) { setErr(e?.response?.data?.error || e.message) }
  }

  const handleRefreshCols = async (r: WritableTable) => {
    try {
      await api.post(`/pipeline-writable-tables/${r.id}/refresh-columns`)
      setDetailCache(c => { const x = { ...c }; delete x[r.id]; return x })
      if (expandedId === r.id) toggleExpand(r.id) // reload
      await fetchRows()
    } catch (e: any) { setErr(e?.response?.data?.error || e.message) }
  }

  const handleDelete = async (r: WritableTable) => {
    if (!confirm(t('admin.pipelineWhitelist.confirmDelete', { name: r.table_name }))) return
    try {
      await api.delete(`/pipeline-writable-tables/${r.id}`)
      await Promise.all([fetchRows(), fetchAvailable()])
    } catch (e: any) { setErr(e?.response?.data?.error || e.message) }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Database size={18} className="text-slate-600" />
            {t('admin.pipelineWhitelist.title')}
          </h2>
          <p className="text-sm text-slate-500 mt-1 flex items-start gap-1.5">
            <Shield size={13} className="text-amber-500 mt-0.5 shrink-0" />
            {t('admin.pipelineWhitelist.subtitle')}
          </p>
        </div>
        <button
          className="btn-primary flex items-center gap-1.5"
          onClick={() => setShowAdd(s => !s)}
        >
          <Plus size={14} /> {t('admin.pipelineWhitelist.approveNew')}
        </button>
      </div>

      {err && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded px-3 py-2">
          {err}
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="label text-xs">{t('admin.pipelineWhitelist.pickTable')}</label>
              <select
                className="input w-full text-sm"
                value={addForm.table_name}
                onChange={e => setAddForm(f => ({ ...f, table_name: e.target.value, display_name: f.display_name || e.target.value }))}
              >
                <option value="">{t('admin.pipelineWhitelist.pickTablePlaceholder')}</option>
                {availableTables.map(tb => <option key={tb} value={tb}>{tb}</option>)}
              </select>
              <p className="text-[10px] text-slate-400 mt-1">
                {t('admin.pipelineWhitelist.blacklistNote')}
              </p>
            </div>
            <div className="flex-1">
              <label className="label text-xs">{t('admin.pipelineWhitelist.displayName')}</label>
              <input className="input w-full text-sm" value={addForm.display_name}
                onChange={e => setAddForm(f => ({ ...f, display_name: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label text-xs">{t('admin.pipelineWhitelist.description')}</label>
            <textarea className="input w-full text-sm h-16" value={addForm.description}
              onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
              placeholder={t('admin.pipelineWhitelist.descriptionPlaceholder')} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="label text-xs">{t('admin.pipelineWhitelist.allowedOps')}</label>
              <div className="flex gap-2 flex-wrap p-2 bg-slate-50 border border-slate-200 rounded">
                {OPS.map(op => {
                  const checked = addForm.allowed_operations.split(',').includes(op)
                  return (
                    <label key={op} className="flex items-center gap-1 text-xs cursor-pointer">
                      <input type="checkbox" checked={checked}
                        onChange={() => {
                          const arr = addForm.allowed_operations.split(',').filter(Boolean)
                          const next = checked ? arr.filter(o => o !== op) : [...arr, op]
                          setAddForm(f => ({ ...f, allowed_operations: next.join(',') }))
                        }} />
                      {op}
                    </label>
                  )
                })}
              </div>
            </div>
            <div>
              <label className="label text-xs">{t('admin.pipelineWhitelist.maxRows')}</label>
              <input type="number" className="input w-28 text-sm" value={addForm.max_rows_per_run}
                onChange={e => setAddForm(f => ({ ...f, max_rows_per_run: Number(e.target.value) || 10000 }))} />
            </div>
          </div>
          <div>
            <label className="label text-xs">{t('admin.pipelineWhitelist.notes')}</label>
            <input className="input w-full text-sm" value={addForm.notes}
              onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={addForm.register_to_ai_dashboard}
                onChange={e => setAddForm(f => ({ ...f, register_to_ai_dashboard: e.target.checked }))}
                className="w-4 h-4 accent-blue-600"
              />
              <span>{t('admin.pipelineWhitelist.registerAiDashboard')}</span>
            </label>
            <p className="text-[10px] text-slate-400 mt-1 ml-6">{t('admin.pipelineWhitelist.registerAiDashboardHint')}</p>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setShowAdd(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn-primary" onClick={handleAdd} disabled={loading}>
              {loading ? t('admin.pipelineWhitelist.approving') : t('admin.pipelineWhitelist.approve')}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8">{t('admin.pipelineWhitelist.empty')}</p>
        )}
        {rows.map(r => (
          <div key={r.id} className={`border rounded-lg ${r.is_active ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-200 opacity-70'}`}>
            <div className="flex items-center gap-2 px-4 py-3">
              <Database size={16} className="text-slate-500" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{r.display_name || r.table_name}</span>
                  <code className="text-xs text-slate-500 bg-slate-100 px-1.5 rounded">{r.table_name}</code>
                  {!r.is_active && <span className="text-xs px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">{t('admin.pipelineWhitelist.inactive')}</span>}
                </div>
                {r.description && <p className="text-xs text-slate-500 truncate">{r.description}</p>}
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {t('admin.pipelineWhitelist.opsLabel')}: {r.allowed_operations} · {t('admin.pipelineWhitelist.maxRowsLabel')}: {r.max_rows_per_run}
                  {r.last_refreshed_at && ` · refreshed ${r.last_refreshed_at}`}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button className="p-1.5 text-slate-400 hover:text-slate-700" onClick={() => handleRefreshCols(r)} title={t('admin.pipelineWhitelist.refreshCols')}>
                  <RefreshCw size={14} />
                </button>
                <button className="p-1.5 text-slate-400 hover:text-slate-700" onClick={() => handleToggleActive(r)} title={r.is_active ? t('admin.pipelineWhitelist.disable') : t('admin.pipelineWhitelist.enable')}>
                  {r.is_active ? <Power size={14} className="text-green-500" /> : <PowerOff size={14} />}
                </button>
                <button className="p-1.5 text-slate-400 hover:text-rose-600" onClick={() => handleDelete(r)} title={t('common.delete')}>
                  <Trash2 size={14} />
                </button>
                <button className="p-1.5 text-slate-400 hover:text-slate-700" onClick={() => toggleExpand(r.id)}>
                  {expandedId === r.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
            </div>
            {expandedId === r.id && (
              <div className="px-4 pb-3 border-t border-slate-100 pt-3">
                <h4 className="text-xs font-semibold text-slate-600 mb-2">
                  {t('admin.pipelineWhitelist.columns')} ({detailCache[r.id]?.column_metadata.length || 0})
                </h4>
                <div className="bg-slate-50 border border-slate-200 rounded p-2 max-h-60 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="text-left pb-1">{t('admin.pipelineWhitelist.colName')}</th>
                        <th className="text-left pb-1">{t('admin.pipelineWhitelist.colType')}</th>
                        <th className="text-center pb-1">{t('admin.pipelineWhitelist.colNullable')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detailCache[r.id]?.column_metadata || []).map(c => (
                        <tr key={c.name} className="border-t border-slate-200">
                          <td className="py-1 font-mono">{c.name}</td>
                          <td className="py-1 text-slate-500">{c.type}</td>
                          <td className="py-1 text-center text-slate-500">{c.nullable ? '✓' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
