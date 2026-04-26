/**
 * PmErpSyncPanel — Phase 5 Track A admin UI
 *
 * 列出所有 pm_erp_sync_job,可:
 *   - 新增 / 編輯(開 modal 含 SQL editor)
 *   - 啟停 is_active / 切換 is_dry_run
 *   - Preview(跑 SELECT 不寫)
 *   - Run-now(立即觸發,可 force_dry_run)
 *   - 看 logs
 *
 * 自動 seed 的範本(BOM / 採購歷史 / 在途庫存)預設 dry_run + inactive,
 * user 必須改 SQL 對應實際 EBS schema 後 preview → 確認 → 真執行 → 啟用。
 */
import { useEffect, useState } from 'react'
import {
  Database, Plus, Edit2, Trash2, Play, Pause, Eye, FileText, RefreshCw,
  Loader2, X, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import api from '../../lib/api'

interface Job {
  id: number
  name: string
  description: string | null
  source_db_id: number | null
  target_pm_table: string
  upsert_mode: string
  upsert_keys: string | null
  schedule_interval_minutes: number
  is_active: number
  is_dry_run: number
  last_status: string | null
  last_rows_synced: number | null
  last_error: string | null
  last_run_at: string | null
}

interface JobDetail extends Job {
  source_query: string
  bind_params_json: string
  mapping_json: string
}

export default function PmErpSyncPanel() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(false)
  const [editTarget, setEditTarget] = useState<JobDetail | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [logTarget, setLogTarget] = useState<Job | null>(null)
  const [previewTarget, setPreviewTarget] = useState<{ job: Job; data: any } | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const fetch = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/pm/admin/erp-sync/jobs')
      setJobs(data || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { fetch() }, [])

  const openEdit = async (id: number) => {
    const { data } = await api.get(`/pm/admin/erp-sync/jobs/${id}`)
    setEditTarget(data)
  }

  const toggleActive = async (j: Job) => {
    if (!j.is_active && j.is_dry_run) {
      if (!window.confirm('啟用前建議先把 is_dry_run 改為 0(否則 cron 跑也只會 log 樣本不真寫)。仍要啟用?')) return
    }
    await api.patch(`/pm/admin/erp-sync/jobs/${j.id}`, { is_active: j.is_active ? 0 : 1 })
    await fetch()
  }

  const toggleDryRun = async (j: Job) => {
    if (j.is_dry_run) {
      if (!window.confirm(`關閉 dry_run 後,job 真執行會寫入 ${j.target_pm_table} 表。確定?`)) return
    }
    await api.patch(`/pm/admin/erp-sync/jobs/${j.id}`, { is_dry_run: j.is_dry_run ? 0 : 1 })
    await fetch()
  }

  const runNow = async (j: Job, forceDryRun: boolean) => {
    setBusyId(j.id)
    try {
      const { data } = await api.post(`/pm/admin/erp-sync/jobs/${j.id}/run-now`, { force_dry_run: forceDryRun })
      alert(`執行完成 — fetched=${data.rowsFetched ?? data.rows_fetched ?? '?'}, synced=${data.rowsSynced ?? data.rows_synced ?? 0}, dryRun=${data.dryRun}`)
      await fetch()
    } catch (e: any) {
      alert(e?.response?.data?.error || String(e))
    } finally { setBusyId(null) }
  }

  const preview = async (j: Job) => {
    setBusyId(j.id)
    try {
      const { data } = await api.post(`/pm/admin/erp-sync/jobs/${j.id}/preview`, {})
      setPreviewTarget({ job: j, data })
    } catch (e: any) {
      alert(e?.response?.data?.error || String(e))
    } finally { setBusyId(null) }
  }

  const remove = async (j: Job) => {
    if (!window.confirm(`刪除 job「${j.name}」(其 logs 也會刪)?`)) return
    await api.delete(`/pm/admin/erp-sync/jobs/${j.id}`)
    await fetch()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Database className="text-indigo-500" size={20} />
            PM ERP 同步管理
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            DB-driven 通用同步框架 — 新加同步只改 config 不寫 code。
            預設 3 個範本(BOM / 採購歷史 / 在途庫存)需 user 改 SQL 後啟用。
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          <Plus size={14} /> 新增 job
        </button>
      </div>

      {loading ? <Loader text="載入中..." /> : (
        <div className="border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Target Table</th>
                <th className="px-3 py-2 text-center">頻率</th>
                <th className="px-3 py-2 text-center">狀態</th>
                <th className="px-3 py-2 text-center">最後執行</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-slate-400">無 jobs</td></tr>}
              {jobs.map(j => {
                const lastOk = j.last_status === 'success' || j.last_status === 'dry_run'
                return (
                  <tr key={j.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{j.name}</div>
                      {j.description && <div className="text-xs text-slate-400 truncate max-w-md">{j.description}</div>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{j.target_pm_table}</td>
                    <td className="px-3 py-2 text-center text-xs text-slate-500">每 {j.schedule_interval_minutes} 分</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => toggleActive(j)}
                        className={`px-1.5 py-0.5 rounded text-xs mr-1 ${j.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}
                        title="切換 is_active"
                      >{j.is_active ? '啟用' : '停用'}</button>
                      <button
                        onClick={() => toggleDryRun(j)}
                        className={`px-1.5 py-0.5 rounded text-xs ${j.is_dry_run ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}
                        title="切換 is_dry_run"
                      >{j.is_dry_run ? 'dry-run' : '真寫入'}</button>
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
                      {j.last_run_at ? (
                        <span className={lastOk ? 'text-slate-600' : 'text-red-600'}>
                          {lastOk ? <CheckCircle2 size={10} className="inline mr-1" /> : <AlertTriangle size={10} className="inline mr-1" />}
                          {j.last_run_at}
                          {j.last_status && <span className="ml-1 text-slate-400">({j.last_status} · {j.last_rows_synced ?? '?'} rows)</span>}
                        </span>
                      ) : (
                        <span className="text-slate-400">未執行</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => preview(j)} disabled={busyId === j.id} title="Preview SELECT" className="p-1 text-blue-600 hover:bg-blue-50 rounded">
                          {busyId === j.id ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                        </button>
                        <button onClick={() => runNow(j, false)} disabled={busyId === j.id} title="Run now" className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                          <Play size={12} />
                        </button>
                        <button onClick={() => setLogTarget(j)} title="看 logs" className="p-1 text-slate-500 hover:bg-slate-100 rounded">
                          <FileText size={12} />
                        </button>
                        <button onClick={() => openEdit(j.id)} title="編輯" className="p-1 text-slate-500 hover:bg-slate-100 rounded">
                          <Edit2 size={12} />
                        </button>
                        <button onClick={() => remove(j)} title="刪除" className="p-1 text-red-500 hover:bg-red-50 rounded">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {(editTarget || showCreate) && (
        <JobModal
          target={editTarget}
          onClose={() => { setEditTarget(null); setShowCreate(false) }}
          onSaved={() => { setEditTarget(null); setShowCreate(false); fetch() }}
        />
      )}

      {logTarget && <LogModal job={logTarget} onClose={() => setLogTarget(null)} />}

      {previewTarget && <PreviewModal info={previewTarget} onClose={() => setPreviewTarget(null)} />}
    </div>
  )
}

// ── Job edit / create modal ─────────────────────────────────────────────────
function JobModal({ target, onClose, onSaved }: { target: JobDetail | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!target
  const [form, setForm] = useState({
    name: target?.name || '',
    description: target?.description || '',
    target_pm_table: target?.target_pm_table || 'pm_',
    source_query: target?.source_query || 'SELECT * FROM ... WHERE ROWNUM <= 100',
    bind_params_json: target?.bind_params_json || '[]',
    mapping_json: target?.mapping_json || '{}',
    upsert_mode: target?.upsert_mode || 'upsert',
    upsert_keys: target?.upsert_keys || '',
    schedule_interval_minutes: target?.schedule_interval_minutes || 1440,
    source_db_id: target?.source_db_id || '',
  })
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      const body: any = { ...form, source_db_id: form.source_db_id ? Number(form.source_db_id) : null }
      if (isEdit) await api.patch(`/pm/admin/erp-sync/jobs/${target!.id}`, body)
      else        await api.post(`/pm/admin/erp-sync/jobs`, body)
      onSaved()
    } catch (e: any) {
      alert(e?.response?.data?.error || String(e))
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[860px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-medium">{isEdit ? '編輯 ERP Sync Job' : '新增 ERP Sync Job'}</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-3">
          <Field label="Name *">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                   className="w-full border rounded px-3 py-1.5 text-sm" />
          </Field>
          <Field label="說明">
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                      rows={2} className="w-full border rounded px-3 py-1.5 text-sm" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Target PM table * (pm_*)">
              <input value={form.target_pm_table} onChange={e => setForm({ ...form, target_pm_table: e.target.value })}
                     className="w-full border rounded px-3 py-1.5 text-sm font-mono" />
            </Field>
            <Field label="Source DB id (空 = ERP env)">
              <input value={form.source_db_id} onChange={e => setForm({ ...form, source_db_id: e.target.value })}
                     placeholder="ai_db_sources.id" className="w-full border rounded px-3 py-1.5 text-sm" />
            </Field>
          </div>
          <Field label="Source Query (SELECT only) *">
            <textarea value={form.source_query} onChange={e => setForm({ ...form, source_query: e.target.value })}
                      rows={10} className="w-full border rounded px-3 py-1.5 text-xs font-mono" />
          </Field>
          <Field label='Bind params JSON(["val1", 123, ...] 對應 SQL 內 ? 順序)'>
            <input value={form.bind_params_json} onChange={e => setForm({ ...form, bind_params_json: e.target.value })}
                   className="w-full border rounded px-3 py-1.5 text-xs font-mono" />
          </Field>
          <Field label="Mapping JSON(ERP 欄 → PM 欄)— 空 {} = 全欄 lowercase">
            <textarea value={form.mapping_json} onChange={e => setForm({ ...form, mapping_json: e.target.value })}
                      rows={4} className="w-full border rounded px-3 py-1.5 text-xs font-mono" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Upsert mode">
              <select value={form.upsert_mode} onChange={e => setForm({ ...form, upsert_mode: e.target.value })}
                      className="w-full border rounded px-3 py-1.5 text-sm">
                <option value="upsert">upsert</option>
                <option value="insert">insert</option>
                <option value="truncate_insert">truncate_insert</option>
              </select>
            </Field>
            <Field label="Upsert keys (csv)">
              <input value={form.upsert_keys} onChange={e => setForm({ ...form, upsert_keys: e.target.value })}
                     placeholder="metal_code,product_id" className="w-full border rounded px-3 py-1.5 text-sm" />
            </Field>
            <Field label="排程間隔 (分)">
              <input type="number" value={form.schedule_interval_minutes}
                     onChange={e => setForm({ ...form, schedule_interval_minutes: Number(e.target.value || 1440) })}
                     className="w-full border rounded px-3 py-1.5 text-sm" />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-600">取消</button>
          <button onClick={submit} disabled={saving}
                  className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded disabled:opacity-50">
            {saving ? '...' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function LogModal({ job, onClose }: { job: Job; onClose: () => void }) {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setLoading(true)
    api.get(`/pm/admin/erp-sync/jobs/${job.id}/logs`, { params: { limit: 30 } })
      .then(r => setLogs(r.data || []))
      .finally(() => setLoading(false))
  }, [job.id])
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[760px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-medium text-sm">執行紀錄 — {job.name}</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-2">
          {loading ? <Loader text="..." /> : logs.length === 0 ? (
            <div className="text-slate-400 text-center py-4">無記錄</div>
          ) : logs.map(l => (
            <div key={l.id} className="border rounded p-3 text-xs">
              <div className="flex gap-2 items-center mb-1">
                <span className="text-slate-500 font-mono">{l.started_at}</span>
                <span className={`px-1.5 py-0.5 rounded ${
                  l.status === 'success' ? 'bg-emerald-100 text-emerald-700' :
                  l.status === 'dry_run' ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>{l.status}</span>
                {l.duration_ms != null && <span className="text-slate-400">耗時 {(l.duration_ms / 1000).toFixed(1)}s</span>}
                <span className="ml-auto text-slate-500">fetched={l.rows_fetched} synced={l.rows_synced}</span>
              </div>
              {l.error_msg && <pre className="bg-red-50 p-2 rounded text-red-800 whitespace-pre-wrap font-mono text-[11px]">{l.error_msg}</pre>}
              {l.sample_row && <details className="mt-1"><summary className="cursor-pointer text-slate-500">sample row</summary><pre className="bg-slate-50 p-2 rounded font-mono text-[11px] whitespace-pre-wrap break-words">{l.sample_row}</pre></details>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PreviewModal({ info, onClose }: { info: { job: Job; data: any }; onClose: () => void }) {
  const { job, data } = info
  const rows = data.previewRows || []
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[760px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-medium text-sm">Preview — {job.name}</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-3">
          <p className="text-xs text-slate-600">
            ERP fetched <strong>{data.rowsFetched}</strong> rows · 顯示前 {rows.length} 筆 · 不會寫入 PM 表
          </p>
          {rows.length === 0 ? (
            <div className="text-slate-400 text-center py-4">SELECT 沒回 row(可能 WHERE 太嚴或表為空)</div>
          ) : (
            <div className="border rounded overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 sticky top-0">
                  <tr>
                    {Object.keys(rows[0]).map(k => <th key={k} className="px-2 py-1 text-left font-mono">{k}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r: any, i: number) => (
                    <tr key={i}>
                      {Object.values(r).map((v: any, j: number) => (
                        <td key={j} className="px-2 py-1 font-mono text-slate-700">{v == null ? <em className="text-slate-400">null</em> : String(v).slice(0, 80)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-slate-700 mb-1">{label}</div>
      {children}
    </label>
  )
}
function Loader({ text }: { text: string }) {
  return <div className="text-center py-6 text-slate-400 text-sm flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> {text}</div>
}
