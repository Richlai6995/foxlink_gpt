/**
 * TasksTab — 任務看板 Kanban + RACI + Dependency
 *
 * 對齊 PPT slide 12 + Demo 手冊 §6
 *
 * Kanban 5 欄(對齊 backend Task status):
 *   PENDING / IN_PROGRESS / BLOCKED / READY_FOR_REVIEW / DONE
 *   (CANCELLED 不顯示在 board,可在 filter 開)
 *
 * 卡片內容:
 *   - 標題
 *   - RACI:A 紅 pill(accountable_role) · R 藍 pill(primary_owner_user_id)
 *   - Dependency chip:⏰ depends_on_task_id+Nd → 解析顯示「QA+1d」風格
 *   - Computed due_at
 *
 * Sprint C 範圍:
 *   - 拉 GET /:id/tasks 列出
 *   - 點卡片開 detail modal(stub,只顯示 JSON)
 *   - 「+ 新任務」開 quick-create form(最小欄位)
 *   - drag-drop Sprint 後續
 */

import { useEffect, useMemo, useState } from 'react'
import { Plus, Clock, GitBranch, AlertTriangle, X, Loader2 } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, type Task, type TaskStatus, type ProjectDetail } from '../api'

const COLUMNS: { key: TaskStatus; label: string; bg: string; color: string }[] = [
  { key: 'PENDING',          label: '待處理',   bg: 'bg-cortex-line-2',         color: 'text-cortex-muted' },
  { key: 'IN_PROGRESS',      label: '進行中',   bg: 'bg-cortex-cyan-bg',        color: 'text-cortex-teal' },
  { key: 'BLOCKED',          label: '卡關',     bg: 'bg-cortex-red-bg',         color: 'text-cortex-red' },
  { key: 'READY_FOR_REVIEW', label: '待審',     bg: 'bg-cortex-amber-bg',       color: 'text-amber-700' },
  { key: 'DONE',             label: '完成',     bg: 'bg-cortex-green-bg',       color: 'text-cortex-green' },
]

type Props = { project: ProjectDetail }

export default function TasksTab({ project }: Props) {
  const { token } = useAuth() as any
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [openDetail, setOpenDetail] = useState<Task | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const reload = async () => {
    if (!token) return
    setLoading(true)
    try {
      const r = await api.get<{ tasks: Task[] }>(token, `/projects/${project.id}/tasks`)
      setTasks(r.tasks || [])
      setErr(null)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  const grouped = useMemo(() => {
    const g: Record<TaskStatus, Task[]> = {
      PENDING: [], IN_PROGRESS: [], BLOCKED: [], READY_FOR_REVIEW: [], DONE: [], CANCELLED: [],
    }
    tasks.forEach((t) => { (g[t.status] ?? g.PENDING).push(t) })
    return g
  }, [tasks])

  // taskId → task 對照表(算 dependency 顯示用)
  const taskMap = useMemo(() => {
    const m: Record<number, Task> = {}
    tasks.forEach((t) => { m[t.id] = t })
    return m
  }, [tasks])

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-cortex-ink">任務看板 ({tasks.length})</h3>
          <p className="text-[11px] text-cortex-muted mt-0.5">
            Kanban + RACI + Dependency-based deadline(對齊 OIBG Schedule)
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={reload}
            className="px-3 py-1.5 text-[12px] border border-cortex-line bg-white rounded hover:bg-cortex-bg transition"
          >
            {loading ? <Loader2 size={12} className="inline animate-spin" /> : '重新整理'}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cortex-cyan text-cortex-navy font-bold text-[12px] rounded hover:bg-[#04D9AC] transition"
          >
            <Plus size={12} strokeWidth={2.5} /> 新任務
          </button>
        </div>
      </div>

      {err && (
        <div className="p-3 mb-3 bg-cortex-red-bg border border-red-200 rounded text-red-700 text-sm">{err}</div>
      )}

      {tasks.length === 0 && !loading && (
        <div className="text-center py-12 text-cortex-muted bg-white border border-cortex-line rounded-lg">
          <p className="text-sm">尚無任務</p>
          <p className="text-xs mt-1">點「新任務」開始;Wizard 啟動專案時不會自動建 task(後續 sprint 接入 RACI 自動建)</p>
        </div>
      )}

      {/* Kanban grid */}
      <div className="grid grid-cols-5 gap-3 min-h-[420px]">
        {COLUMNS.map((col) => (
          <div key={col.key} className="bg-cortex-bg border border-cortex-line rounded-lg flex flex-col">
            <div className={`px-3 py-2 ${col.bg} border-b border-cortex-line rounded-t-lg flex items-center justify-between`}>
              <span className={`text-[11px] font-bold uppercase tracking-widest ${col.color}`}>
                {col.label}
              </span>
              <span className={`text-[10px] font-bold ${col.color}`}>
                {grouped[col.key].length}
              </span>
            </div>
            <div className="flex-1 p-2 space-y-1.5 overflow-y-auto max-h-[460px]">
              {grouped[col.key].map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  upstream={t.depends_on_task_id ? taskMap[t.depends_on_task_id] : undefined}
                  onClick={() => setOpenDetail(t)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {openDetail && <TaskDetailModal task={openDetail} onClose={() => setOpenDetail(null)} onChanged={reload} />}
      {showCreate && <QuickCreate projectId={project.id} stages={project.stages} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); reload() }} />}
    </div>
  )
}

// ─── Task card ────────────────────────────────────────────────────────
function TaskCard({ task: t, upstream, onClick }: { task: Task; upstream?: Task; onClick: () => void }) {
  const isOverdue = t.computed_due_at && new Date(t.computed_due_at) < new Date() && t.status !== 'DONE'
  const dependencyChip = upstream
    ? `⏰ ${upstream.title.slice(0, 12)}${upstream.title.length > 12 ? '…' : ''}+${t.relative_deadline_days}d`
    : t.computed_due_at
    ? `⏰ ${new Date(t.computed_due_at).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })}`
    : null

  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white border rounded p-2.5 hover:shadow-cortex-sm transition ${
        isOverdue ? 'border-cortex-red ring-1 ring-cortex-red/30' : 'border-cortex-line'
      }`}
    >
      <div className="text-[12px] font-semibold text-cortex-ink line-clamp-2 mb-1.5">
        {t.title}
      </div>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {t.accountable_role && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-red-100 text-red-700 rounded border border-red-200">
            A · {t.accountable_role}
          </span>
        )}
        {t.primary_owner_user_id && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded border border-blue-200">
            R · user#{t.primary_owner_user_id}
          </span>
        )}
        {Number(t.is_confidential) === 1 && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-cortex-amber-bg text-amber-800 rounded border border-amber-300">
            🔒
          </span>
        )}
      </div>
      {dependencyChip && (
        <div className={`text-[10px] inline-flex items-center gap-0.5 ${isOverdue ? 'text-cortex-red font-bold' : 'text-cortex-muted'}`}>
          <Clock size={9} /> {dependencyChip}
          {upstream && <GitBranch size={9} className="ml-0.5 opacity-60" />}
        </div>
      )}
      {t.progress_percent > 0 && (
        <div className="mt-1.5 h-1 bg-cortex-line-2 rounded-full overflow-hidden">
          <div className="h-full bg-cortex-cyan" style={{ width: `${t.progress_percent}%` }} />
        </div>
      )}
      {t.status === 'BLOCKED' && t.blocker_reason && (
        <div className="text-[10px] text-cortex-red mt-1 flex items-start gap-1">
          <AlertTriangle size={10} className="shrink-0 mt-px" />
          <span className="line-clamp-1">{t.blocker_reason}</span>
        </div>
      )}
    </button>
  )
}

// ─── Detail modal(簡單版,後續 sprint 補完整編輯)──────────────────
function TaskDetailModal({ task: t, onClose, onChanged }: { task: Task; onClose: () => void; onChanged: () => void }) {
  const { token } = useAuth() as any
  const [busy, setBusy] = useState(false)

  const changeStatus = async (status: TaskStatus) => {
    setBusy(true)
    try {
      await api.post(token, `/projects/${t.project_id}/tasks/${t.id}/status`, { status })
      onChanged()
      onClose()
    } catch (e: any) {
      alert('狀態變更失敗:' + e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-cortex-lg w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-cortex-line flex items-center justify-between bg-cortex-navy text-white">
          <span className="font-bold text-[14px]">任務細節</span>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3 text-[13px]">
          <div>
            <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-1">標題</div>
            <div className="text-cortex-ink font-semibold">{t.title}</div>
          </div>
          {t.description && (
            <div>
              <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-1">描述</div>
              <div className="text-cortex-text whitespace-pre-wrap">{t.description}</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <KV label="Status" value={t.status} />
            <KV label="進度" value={`${t.progress_percent}%`} />
            <KV label="A · Accountable" value={t.accountable_role || '—'} />
            <KV label="R · Responsible" value={t.primary_owner_user_id ? `user#${t.primary_owner_user_id}` : '—'} />
            <KV label="Stage" value={t.stage_id ? `#${t.stage_id}` : '—'} />
            <KV label="Due" value={t.computed_due_at ? new Date(t.computed_due_at).toLocaleDateString('zh-TW') : '—'} />
          </div>
          {t.depends_on_task_id && (
            <div className="bg-cortex-bg border border-cortex-line rounded p-2.5">
              <div className="text-[10px] font-bold text-cortex-muted mb-1">⏰ Dependency</div>
              <div className="text-cortex-text text-[12px]">
                依賴 task #{t.depends_on_task_id} 完成後 +{t.relative_deadline_days} 天
              </div>
            </div>
          )}

          {/* Status quick change */}
          <div>
            <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-1.5">變更狀態</div>
            <div className="flex flex-wrap gap-1.5">
              {COLUMNS.map((c) => (
                <button
                  key={c.key}
                  disabled={c.key === t.status || busy}
                  onClick={() => changeStatus(c.key)}
                  className={`text-[11px] px-2 py-1 rounded border transition ${
                    c.key === t.status
                      ? 'bg-cortex-navy text-white border-cortex-navy'
                      : 'bg-white border-cortex-line text-cortex-text hover:border-cortex-cyan'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-0.5">{label}</div>
      <div className="text-cortex-ink">{value}</div>
    </div>
  )
}

// ─── Quick create ─────────────────────────────────────────────────────
function QuickCreate({
  projectId, stages, onClose, onCreated,
}: {
  projectId: number
  stages: ProjectDetail['stages']
  onClose: () => void
  onCreated: () => void
}) {
  const { token } = useAuth() as any
  const [title, setTitle] = useState('')
  const [stageId, setStageId] = useState<string>('')
  const [accountableRole, setAccountableRole] = useState('DPM')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!title.trim()) return
    setBusy(true)
    setErr(null)
    try {
      await api.post(token, `/projects/${projectId}/tasks`, {
        title: title.trim(),
        stage_id: stageId ? Number(stageId) : null,
        accountable_role: accountableRole,
      })
      onCreated()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-cortex-lg w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-cortex-line flex items-center justify-between bg-cortex-navy text-white">
          <span className="font-bold text-[14px]">新任務</span>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3 text-[13px]">
          <label className="block">
            <span className="text-[11px] font-bold text-cortex-muted block mb-1">標題 *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例:EE BOM 結構分析"
              className="w-full px-3 py-1.5 border border-cortex-line rounded text-[13px] focus:outline-none focus:border-cortex-cyan"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-cortex-muted block mb-1">Stage(可空)</span>
            <select
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              className="w-full px-3 py-1.5 border border-cortex-line rounded text-[13px]"
            >
              <option value="">不指定</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>#{s.stage_order} {s.stage_code}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-cortex-muted block mb-1">A · Accountable role</span>
            <select
              value={accountableRole}
              onChange={(e) => setAccountableRole(e.target.value)}
              className="w-full px-3 py-1.5 border border-cortex-line rounded text-[13px]"
            >
              <option value="DPM">DPM</option>
              <option value="BPM">BPM</option>
              <option value="MPM">MPM</option>
              <option value="EPM">EPM</option>
              <option value="sales">Sales</option>
              <option value="engineering">Engineering</option>
            </select>
          </label>
          {err && <div className="text-[12px] text-cortex-red">{err}</div>}
        </div>
        <div className="px-5 py-3 border-t border-cortex-line flex justify-end gap-2 bg-cortex-bg">
          <button onClick={onClose} className="px-4 py-1.5 text-[13px] border border-cortex-line bg-white rounded">取消</button>
          <button
            onClick={submit}
            disabled={!title.trim() || busy}
            className="px-4 py-1.5 text-[13px] bg-cortex-cyan text-cortex-navy font-bold rounded disabled:opacity-50"
          >
            {busy ? '建立中…' : '建立'}
          </button>
        </div>
      </div>
    </div>
  )
}
