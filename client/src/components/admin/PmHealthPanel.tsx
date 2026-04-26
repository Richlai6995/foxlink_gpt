/**
 * PmHealthPanel — Phase 5 Track F admin UI
 *
 * 4 個 sub-tab:
 *   - tasks:F1 健康儀表板(排程 success/fail/duration/token + budget 設定)
 *   - sources:F3 18 source 健康狀態 + 手動 check
 *   - cost:F5 per-task / per-day token + cost
 *   - kb-maint:F4 KB archive 觸發 + restore
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity, Globe, DollarSign, Database, RefreshCw, AlertTriangle, CheckCircle2, Loader2,
  Pause, Play, Edit2, Trash2,
} from 'lucide-react'
import api from '../../lib/api'

type Tab = 'tasks' | 'sources' | 'cost' | 'kb-maint'

export default function PmHealthPanel() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('tasks')

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">
          {t('pmHealth.title', 'PM 平台健康')}
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          {t('pmHealth.desc', '排程跑得怎樣 / 18 sources 連通 / token 成本 / KB 維護')}
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {([
          { id: 'tasks',     label: '排程健康',   icon: <Activity size={14} /> },
          { id: 'sources',   label: 'Source 監控', icon: <Globe size={14} /> },
          { id: 'cost',      label: 'Token 成本', icon: <DollarSign size={14} /> },
          { id: 'kb-maint',  label: 'KB 維護',    icon: <Database size={14} /> },
        ] as { id: Tab; label: string; icon: React.ReactNode }[]).map(s => (
          <button
            key={s.id}
            onClick={() => setTab(s.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm transition border-b-2 ${
              tab === s.id ? 'text-blue-600 border-blue-600 font-medium' : 'text-slate-500 border-transparent hover:text-slate-800'
            }`}
          >{s.icon}{s.label}</button>
        ))}
      </div>

      {tab === 'tasks'    && <TasksHealth />}
      {tab === 'sources'  && <SourcesHealth />}
      {tab === 'cost'     && <CostDashboard />}
      {tab === 'kb-maint' && <KbMaintenance />}
    </div>
  )
}

// ── Tab 1: Tasks Health ────────────────────────────────────────────────────

interface TaskHealth {
  id: number
  name: string
  status: string
  daily_token_budget: number | null
  token_budget_paused_at: string | null
  run_count: number
  success_count: number
  fail_count: number
  avg_duration_ms: number | null
  last_run_at: string | null
  last_status: string | null
  total_tokens: number | null
  total_cost: number | null
}

function TasksHealth() {
  const [days, setDays] = useState(7)
  const [rows, setRows] = useState<TaskHealth[]>([])
  const [loading, setLoading] = useState(false)
  const [editingBudget, setEditingBudget] = useState<number | null>(null)
  const [budgetValue, setBudgetValue] = useState<string>('')
  const [errorTask, setErrorTask] = useState<TaskHealth | null>(null)

  const fetch = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/pm/admin/health/tasks', { params: { days } })
      setRows(Array.isArray(data) ? data : [])
    } finally { setLoading(false) }
  }
  useEffect(() => { fetch() }, [days])

  const saveBudget = async (taskId: number) => {
    try {
      await api.patch(`/pm/admin/tasks/${taskId}/budget`, {
        daily_token_budget: budgetValue.trim() === '' ? null : Number(budgetValue),
      })
      setEditingBudget(null)
      await fetch()
    } catch (e: any) { alert(e?.response?.data?.error || String(e)) }
  }

  const clearPause = async (taskId: number) => {
    if (!window.confirm('解除預算暫停?(該 task 立刻可再跑)')) return
    await api.post(`/pm/admin/tasks/${taskId}/clear-budget-pause`, {})
    await fetch()
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-slate-500">統計區間:</span>
        <select value={days} onChange={e => setDays(Number(e.target.value))} className="border rounded px-2 py-1 text-sm">
          <option value={1}>1 天</option>
          <option value={3}>3 天</option>
          <option value={7}>7 天</option>
          <option value={14}>14 天</option>
          <option value={30}>30 天</option>
        </select>
        <button onClick={fetch} className="ml-auto p-1.5 text-slate-500 hover:bg-slate-100 rounded"><RefreshCw size={14} /></button>
      </div>

      {loading ? <Loader text="載入中..." /> : (
        <div className="border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">名稱</th>
                <th className="px-3 py-2 text-center">狀態</th>
                <th className="px-3 py-2 text-right">執行次數</th>
                <th className="px-3 py-2 text-right">成功率</th>
                <th className="px-3 py-2 text-right">平均耗時</th>
                <th className="px-3 py-2 text-right">總 tokens</th>
                <th className="px-3 py-2 text-right">日預算</th>
                <th className="px-3 py-2 text-center">最後跑</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && <tr><td colSpan={8} className="text-center py-6 text-slate-400">無 PM 排程</td></tr>}
              {rows.map(t => {
                const total = Number(t.run_count || 0)
                const success = Number(t.success_count || 0)
                const successRate = total > 0 ? (success / total * 100).toFixed(1) + '%' : '—'
                const isPaused = !!t.token_budget_paused_at
                return (
                  <tr key={t.id}>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {t.name}
                      {isPaused && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                          <Pause size={10} /> 預算暫停
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        t.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                      }`}>{t.status}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="text-slate-700">{total}</span>
                      {Number(t.fail_count || 0) > 0 && (
                        <button
                          onClick={() => setErrorTask(t)}
                          className="ml-2 text-[11px] text-red-600 hover:underline"
                          title="看失敗詳情"
                        >({t.fail_count} 失敗)</button>
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right ${total > 0 && success / total < 0.8 ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
                      {successRate}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600 font-mono">
                      {t.avg_duration_ms ? `${(Number(t.avg_duration_ms) / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600 font-mono">
                      {t.total_tokens ? Number(t.total_tokens).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {editingBudget === t.id ? (
                        <span className="inline-flex items-center gap-1">
                          <input
                            value={budgetValue}
                            onChange={e => setBudgetValue(e.target.value)}
                            placeholder="無上限"
                            className="w-24 border rounded px-1 py-0.5 text-xs text-right"
                            autoFocus
                          />
                          <button onClick={() => saveBudget(t.id)} className="text-blue-600 text-xs px-1">✓</button>
                          <button onClick={() => setEditingBudget(null)} className="text-slate-400 text-xs px-1">×</button>
                        </span>
                      ) : (
                        <button
                          onClick={() => { setEditingBudget(t.id); setBudgetValue(t.daily_token_budget != null ? String(t.daily_token_budget) : '') }}
                          className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-blue-600"
                        >
                          {t.daily_token_budget != null ? Number(t.daily_token_budget).toLocaleString() : '—'}
                          <Edit2 size={10} />
                        </button>
                      )}
                      {isPaused && (
                        <button onClick={() => clearPause(t.id)} title="解除暫停" className="ml-1 text-emerald-600 hover:text-emerald-800">
                          <Play size={12} />
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-slate-500">
                      {t.last_run_at ? new Date(t.last_run_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {errorTask && <ErrorDetailsModal task={errorTask} onClose={() => setErrorTask(null)} />}
    </div>
  )
}

function ErrorDetailsModal({ task, onClose }: { task: TaskHealth; onClose: () => void }) {
  const [errors, setErrors] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setLoading(true)
    api.get('/pm/admin/health/run-errors', { params: { task_id: task.id, limit: 20 } })
      .then(r => setErrors(r.data || []))
      .finally(() => setLoading(false))
  }, [task.id])
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[720px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-medium text-sm">最近失敗 — {task.name}</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-800">✕</button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-2">
          {loading ? <Loader text="..." /> : errors.length === 0 ? (
            <div className="text-slate-400 text-sm text-center py-4">無失敗記錄</div>
          ) : errors.map(e => (
            <div key={e.id} className="border rounded p-3 text-xs">
              <div className="flex gap-2 items-center mb-1">
                <span className="text-slate-500">{new Date(e.run_at).toLocaleString()}</span>
                <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700">{e.status}</span>
                {e.duration_ms && <span className="text-slate-400">耗時 {(e.duration_ms / 1000).toFixed(1)}s</span>}
              </div>
              {e.error_msg && <pre className="bg-red-50 p-2 rounded text-red-800 whitespace-pre-wrap break-words font-mono text-[11px]">{e.error_msg}</pre>}
              {e.response_preview && <pre className="bg-slate-50 p-2 rounded text-slate-700 whitespace-pre-wrap break-words font-mono text-[11px] mt-1">{e.response_preview.slice(0, 600)}</pre>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Tab 2: Sources Health ──────────────────────────────────────────────────

interface SourceHealth {
  id: number
  source_url: string
  source_label: string
  last_check_at: string | null
  last_status: string | null
  last_http_status: number | null
  last_error: string | null
  last_response_ms: number | null
  consecutive_failures: number
  is_disabled: number
}

function SourcesHealth() {
  const [rows, setRows] = useState<SourceHealth[]>([])
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)

  const fetch = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/pm/admin/sources')
      setRows(data || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { fetch() }, [])

  const checkNow = async () => {
    setChecking(true)
    try {
      const { data } = await api.post('/pm/admin/sources/check-now', {})
      alert(`檢查完成 — ok=${data.okCount} fail=${data.failCount} alerted=${data.alertedCount}`)
      await fetch()
    } catch (e: any) { alert(e?.response?.data?.error || String(e)) } finally { setChecking(false) }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-slate-500">{rows.length} sources · 每 6 小時自動檢查 · 連 3 次失敗自動 alert</span>
        <button
          onClick={checkNow} disabled={checking}
          className="ml-auto flex items-center gap-1 px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {checking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          立即檢查
        </button>
      </div>
      {loading ? <Loader text="載入中..." /> : (
        <div className="border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">名稱</th>
                <th className="px-3 py-2 text-left">URL</th>
                <th className="px-3 py-2 text-center">狀態</th>
                <th className="px-3 py-2 text-right">HTTP</th>
                <th className="px-3 py-2 text-right">回應 ms</th>
                <th className="px-3 py-2 text-right">連續失敗</th>
                <th className="px-3 py-2 text-center">最後檢查</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.id} className={r.is_disabled ? 'bg-red-50' : ''}>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {r.source_label}
                    {r.is_disabled === 1 && <AlertTriangle size={12} className="inline ml-1 text-red-500" />}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500 truncate max-w-xs">
                    <a href={r.source_url} target="_blank" rel="noreferrer" className="hover:underline">{r.source_url}</a>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.last_status === 'ok' ? (
                      <span className="text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 size={12} /> ok</span>
                    ) : (
                      <span className="text-red-600 text-xs">{r.last_status || '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-mono text-slate-600">{r.last_http_status || '—'}</td>
                  <td className="px-3 py-2 text-right text-xs font-mono text-slate-600">{r.last_response_ms || '—'}</td>
                  <td className={`px-3 py-2 text-right ${r.consecutive_failures > 0 ? 'text-red-600 font-medium' : 'text-slate-400'}`}>
                    {r.consecutive_failures}
                  </td>
                  <td className="px-3 py-2 text-center text-xs text-slate-500">{r.last_check_at || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Tab 3: Cost dashboard ──────────────────────────────────────────────────

interface CostRow {
  task_id: number
  task_name: string
  usage_date: string
  model: string
  input_tokens: number
  output_tokens: number
  cost: number
  run_count: number
}

function CostDashboard() {
  const [days, setDays] = useState(30)
  const [rows, setRows] = useState<CostRow[]>([])
  const [loading, setLoading] = useState(false)
  const [aggregating, setAggregating] = useState(false)

  const fetch = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/pm/admin/cost', { params: { days } })
      setRows(data || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { fetch() }, [days])

  const aggregateNow = async () => {
    setAggregating(true)
    try {
      await api.post('/pm/admin/token/aggregate-now', {})
      await fetch()
    } finally { setAggregating(false) }
  }

  // 加總 by task
  const byTask: Record<string, { tokens: number; cost: number; runs: number }> = {}
  for (const r of rows) {
    if (!byTask[r.task_name]) byTask[r.task_name] = { tokens: 0, cost: 0, runs: 0 }
    byTask[r.task_name].tokens += Number(r.input_tokens || 0) + Number(r.output_tokens || 0)
    byTask[r.task_name].cost   += Number(r.cost || 0)
    byTask[r.task_name].runs   += Number(r.run_count || 0)
  }
  const sortedTasks = Object.entries(byTask).sort((a, b) => b[1].cost - a[1].cost)

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <select value={days} onChange={e => setDays(Number(e.target.value))} className="border rounded px-2 py-1 text-sm">
          <option value={7}>7 天</option>
          <option value={14}>14 天</option>
          <option value={30}>30 天</option>
          <option value={60}>60 天</option>
          <option value={90}>90 天</option>
        </select>
        <span className="text-xs text-slate-400">⚠️ token 估算(token_usage 沒 task_id,以 owner 比例平攤)</span>
        <button onClick={aggregateNow} disabled={aggregating} className="ml-auto px-3 py-1 text-sm rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-50">
          {aggregating ? '...' : '立即重算'}
        </button>
        <button onClick={fetch} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded"><RefreshCw size={14} /></button>
      </div>

      {loading ? <Loader text="載入中..." /> : (
        <>
          <div className="border rounded mb-4">
            <div className="px-3 py-2 bg-slate-50 text-xs font-semibold text-slate-700 border-b">Per-Task 統計({days} 天)</div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Task</th>
                  <th className="px-3 py-2 text-right">總 tokens</th>
                  <th className="px-3 py-2 text-right">cost (USD est.)</th>
                  <th className="px-3 py-2 text-right">執行次數</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedTasks.length === 0 && <tr><td colSpan={4} className="text-center py-4 text-slate-400">無資料</td></tr>}
                {sortedTasks.map(([name, v]) => (
                  <tr key={name}>
                    <td className="px-3 py-2 font-medium text-slate-800">{name}</td>
                    <td className="px-3 py-2 text-right font-mono">{v.tokens.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono">${v.cost.toFixed(4)}</td>
                    <td className="px-3 py-2 text-right">{v.runs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-800 mb-2">Per-Day × Per-Model 明細({rows.length} rows)</summary>
            <div className="border rounded overflow-auto max-h-80">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left">Date</th>
                    <th className="px-2 py-1 text-left">Task</th>
                    <th className="px-2 py-1 text-left">Model</th>
                    <th className="px-2 py-1 text-right">in</th>
                    <th className="px-2 py-1 text-right">out</th>
                    <th className="px-2 py-1 text-right">cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1 font-mono">{r.usage_date}</td>
                      <td className="px-2 py-1">{r.task_name}</td>
                      <td className="px-2 py-1 font-mono text-slate-500">{r.model}</td>
                      <td className="px-2 py-1 text-right font-mono">{Number(r.input_tokens || 0).toLocaleString()}</td>
                      <td className="px-2 py-1 text-right font-mono">{Number(r.output_tokens || 0).toLocaleString()}</td>
                      <td className="px-2 py-1 text-right font-mono">${Number(r.cost || 0).toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  )
}

// ── Tab 4: KB Maintenance ──────────────────────────────────────────────────

function KbMaintenance() {
  const [running, setRunning] = useState(false)
  const [lastResult, setLastResult] = useState<any>(null)

  const run = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm('確定執行真實 archive?(>90 天 PM-新聞庫 chunks 將被軟封存,不參與 RAG 檢索;可從本介面 restore)')) return
    setRunning(true)
    try {
      const { data } = await api.post('/pm/admin/kb-maintenance/run-now', { dry_run: dryRun })
      setLastResult(data)
    } catch (e: any) {
      alert(e?.response?.data?.error || String(e))
    } finally { setRunning(false) }
  }

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-slate-700">
        <p className="font-medium mb-1">⚠️ Soft-archive 機制</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>每週 cron 自動跑(預設 dry_run,只 log 不真改)— 環境變數 <code>PM_KB_ARCHIVE_DRYRUN=false</code> 才真執行</li>
          <li>對象:PM-新聞庫,文件 created_date 超過 90 天的 chunks → SET archived_at</li>
          <li>archived chunks <strong>不從 DB 刪</strong>,只標欄位 → kbRetrieval 跳過 → vector index 仍含但不影響檢索</li>
          <li>誤封可隨時 restore(下方按鈕)</li>
        </ul>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => run(true)} disabled={running}
          className="px-4 py-2 text-sm rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
        >
          Dry-run(只看會 archive 多少)
        </button>
        <button
          onClick={() => run(false)} disabled={running}
          className="px-4 py-2 text-sm rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {running ? '執行中...' : '真實執行 archive'}
        </button>
      </div>

      {lastResult && (
        <div className="border rounded p-3 text-sm bg-slate-50">
          <div className="text-xs font-semibold text-slate-700 mb-2">執行結果</div>
          <pre className="text-xs font-mono whitespace-pre-wrap">{JSON.stringify(lastResult, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

function Loader({ text }: { text: string }) {
  return <div className="text-center py-6 text-slate-400 text-sm flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> {text}</div>
}
