/**
 * ProjectsList — 「我的專案」頁
 *
 * 對應 HTML demo .view-projects + .proj-grid
 *
 * Sprint A:
 *   - page-head:標題 + 「匯入 ERP」+ 「新增專案」(Wizard 在 Sprint B 上)
 *   - filter-row:搜尋 + lifecycle chips
 *   - 卡片 grid(2-3 欄 responsive)
 *
 * Backend 已 ready:GET /projects → projects[]
 * 缺的欄位(progress / ai_summary / customer / members)Sprint C-F 補
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Download, Search, Lock } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, type Project, type ProjectType, type StatusSummary } from '../api'
import { useCrumbs, usePlatform } from '../Shell/PlatformContext'
import ProjectCard from './ProjectCard'
import WizardModal from '../Wizard/WizardModal'

type Filter = 'all' | 'active' | 'paused' | 'closed' | 'confidential'

const FILTER_CHIPS: { key: Filter; label: string; icon?: React.ReactNode }[] = [
  { key: 'all',          label: '全部' },
  { key: 'active',       label: '進行中' },
  { key: 'paused',       label: '暫停' },
  { key: 'closed',       label: '已結案' },
  { key: 'confidential', label: '機密案', icon: <Lock size={11} /> },
]

export default function ProjectsList() {
  useCrumbs([{ label: '我的專案' }])
  const { token } = useAuth() as any
  const { demoRole } = usePlatform()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [_types, setTypes] = useState<ProjectType[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [summaries, setSummaries] = useState<Record<number, StatusSummary>>({})

  const reload = async () => {
    if (!token) return
    setLoading(true)
    setErr(null)
    try {
      const r = await api.get<{ projects: Project[] }>(token, '/projects?limit=200')
      setProjects(r.projects || [])
      // 並行批次拉 status summary(列表行下用 — ⭐ Status SUMMARY 三處之二)
      const ids = (r.projects || []).map((p) => p.id)
      if (ids.length > 0) {
        api.post<{ summaries: StatusSummary[] }>(token, '/dashboard/summary/batch', { project_ids: ids })
          .then((d) => {
            const map: Record<number, StatusSummary> = {}
            ;(d.summaries || []).forEach((s) => { map[s.project_id] = s })
            setSummaries(map)
          })
          .catch(() => {})
      }
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return
    api.get<{ types: ProjectType[] }>(token, '/projects/types').then((d) => setTypes(d.types || [])).catch(() => {})
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, demoRole])  // demoRole 變 → reload(機密 mask 重新拉)

  const filtered = useMemo(() => {
    let xs = projects
    if (filter === 'active')       xs = xs.filter((p) => p.lifecycle_status === 'ACTIVE')
    else if (filter === 'paused')  xs = xs.filter((p) => p.lifecycle_status === 'PAUSED')
    else if (filter === 'closed')  xs = xs.filter((p) => p.lifecycle_status === 'CLOSED')
    else if (filter === 'confidential') xs = xs.filter((p: any) => p.is_confidential)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      xs = xs.filter((p) =>
        p.project_code.toLowerCase().includes(q) ||
        (p.data_payload?.title || '').toLowerCase().includes(q) ||
        p.type_code.toLowerCase().includes(q),
      )
    }
    return xs
  }, [projects, filter, search])

  return (
    <div>
      {/* Page head */}
      <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-cortex-ink tracking-tight flex items-center gap-3 m-0">
            我的專案
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cortex-cyan-bg text-cortex-teal border border-cortex-cyan/30">
              {filtered.length} 個
            </span>
          </h1>
          <div className="text-[13px] text-cortex-muted mt-1">
            已參與或負責的專案 · 點任一張卡片進入戰情會議室
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => alert('「匯入 / 從 ERP 拉」尚未實作 — Sprint E 開')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[13px] font-semibold border border-cortex-line bg-white text-cortex-text hover:bg-cortex-bg hover:border-slate-300 transition"
          >
            <Download size={14} /> 匯入 / 從 ERP 拉
          </button>
          <button
            onClick={() => setShowWizard(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[13px] font-bold bg-cortex-cyan text-cortex-navy hover:bg-[#04D9AC] hover:shadow-[0_2px_6px_rgba(2,195,154,0.30)] transition"
          >
            <Plus size={14} strokeWidth={2.5} /> 新增專案
          </button>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <div className="relative flex-1 max-w-[360px] min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cortex-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋 ID / 客戶 / 料號 / 負責人..."
            className="w-full h-9 pl-9 pr-3 border border-cortex-line rounded-md text-[13px] bg-white text-cortex-ink focus:outline-none focus:border-cortex-cyan focus:ring-[3px] focus:ring-cortex-cyan/15 transition"
          />
        </div>
        {FILTER_CHIPS.map((c) => {
          const on = filter === c.key
          return (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold border transition ${
                on
                  ? 'bg-cortex-navy text-white border-cortex-navy shadow-cortex-sm'
                  : 'bg-white border-cortex-line text-cortex-text hover:border-slate-300 hover:bg-cortex-bg'
              }`}
            >
              {c.icon}
              {c.label}
            </button>
          )
        })}
      </div>

      {/* Errors / loading */}
      {err && (
        <div className="p-3 mb-4 bg-cortex-red-bg border border-red-200 rounded text-red-700 text-sm">
          無法載入專案:{err}
        </div>
      )}

      {/* Wizard modal */}
      <WizardModal open={showWizard} onClose={() => { setShowWizard(false); reload() }} />

      {/* Grid */}
      {filtered.length === 0 && !loading ? (
        <div className="text-center py-16 text-cortex-muted bg-white rounded-lg border border-cortex-line">
          <p className="text-base">尚無專案符合條件</p>
          <p className="text-sm mt-2">點右上「新增專案」開始(Wizard 在 Sprint B 上線)</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={mockEnrichProject(p, summaries[p.id])}
              onClick={() => navigate(`/projects-platform/projects/${p.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Mock 補滿 demo 欄位 + 接 status summary(Sprint D)─────────────
function mockEnrichProject(p: Project, summary?: StatusSummary): any {
  return {
    ...p,
    customer: (p.data_payload as any)?.customer || (p as any).bu_id ? `BU#${(p as any).bu_id}` : '—',
    amount_display: (p.data_payload as any)?.amount_display || '',
    due: p.sla_due_at ? new Date(p.sla_due_at).toLocaleDateString('zh-TW') : '',
    // 用 status summary 的 stage progress(若有);否則 fallback
    progress: summary?.stage_progress_percent ?? Math.min(100, Math.max(0, (p as any).priority_score ? Number((p as any).priority_score) * 10 : 0)),
    priority: (p as any).priority_score ?? (p.importance === 'HIGH' ? 8 : p.importance === 'LOW' ? 3 : 5),
    sla: p.lifecycle_status === 'ACTIVE' ? 'green' : p.lifecycle_status === 'PAUSED' ? 'amber' : 'red',
    pause_reason: (p as any).pause_reason,
    note: (p as any).reopen_reason ? `重啟原因:${(p as any).reopen_reason}` : null,
    // ⭐ AI Status SUMMARY one-liner 顯示在列表行下(三處之二)
    ai_summary: summary?.one_liner || null,
    members: [{ initial: '我' }],
    confidential: !!(p as any).is_confidential,
  }
}
