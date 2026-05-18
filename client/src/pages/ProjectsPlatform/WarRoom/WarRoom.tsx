/**
 * WarRoom — 戰情會議室主頁
 *
 * 對應 HTML demo 戰情會議室 4 分頁:
 *   - 聊天(Sprint C 填肉)— 7 channel + DM + 訊息色語言 + AI Bot
 *   - 任務看板(Sprint C)— Kanban + RACI + Dependency Gantt
 *   - 報價 Form(Sprint C)— 版本鏈 + 機密欄位
 *   - 成員(Sprint C)— Multi-PM Team 分組
 *
 * Sprint A 範圍:
 *   - 頂部 8-stage ribbon
 *   - 4 tab 切換(各先 stub 顯示 placeholder)
 *   - 連 backend GET /projects/:id 拿基本 stage + channels + members
 */

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, MessageSquare, Kanban, FileText, Users, Lock, BarChart3, type LucideIcon } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, type ProjectDetail } from '../api'
import { useCrumbs, usePlatform } from '../Shell/PlatformContext'
import { LIFECYCLE_COLORS, TOKENS } from '../tokens'
import StageRibbon from './StageRibbon'
import ChatTab from './ChatTab'
import TasksTab from './TasksTab'
import MembersTab from './MembersTab'
import BiTab from './BiTab'
import WarRoomHeaderActions from './WarRoomHeaderActions'
import { useProjectsPlatformSocket } from '../../../hooks/useProjectsPlatformSocket'

type Tab = 'chat' | 'tasks' | 'form' | 'members' | 'bi'

const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
  { key: 'chat',    label: '聊天',     icon: MessageSquare },
  { key: 'tasks',   label: '任務看板', icon: Kanban },
  { key: 'form',    label: '報價 Form', icon: FileText },
  { key: 'members', label: '成員',     icon: Users },
  { key: 'bi',      label: 'BI 戰情',  icon: BarChart3 },
]

export default function WarRoom() {
  const { id } = useParams<{ id: string }>()
  const { token } = useAuth() as any
  const { demoRole } = usePlatform()
  const navigate = useNavigate()
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('chat')

  useCrumbs(
    project
      ? [
          { label: '我的專案', to: '/projects-platform' },
          { label: project.project_code },
        ]
      : [{ label: '我的專案', to: '/projects-platform' }, { label: 'Loading…' }],
  )

  const reload = () => {
    if (!id || !token) return
    setErr(null)
    api.get<{ project: ProjectDetail }>(token, `/projects/${id}`)
      .then((r) => setProject(r.project))
      .catch((e) => setErr(e.message))
  }

  useEffect(() => {
    if (!id || !token) return
    setErr(null)
    setProject(null)
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token, demoRole])  // demoRole 變 → 重拉(機密案 OUTSIDER 看 403)

  // WebSocket — stage 推進 / lifecycle 變動時自動 reload(別人推 stage 後本機也跟上)
  const { lastEvent } = useProjectsPlatformSocket({
    projectId: project?.id || null,
  })
  useEffect(() => {
    if (!lastEvent) return
    if (lastEvent.type === 'proj_stage_advanced' || lastEvent.type === 'proj_lifecycle_changed') {
      // 自己推的也會收到(server 沒 filter),但 reload 是 idempotent,沒問題
      reload()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent])

  if (err) {
    return (
      <div className="bg-white rounded-lg border border-cortex-line p-6">
        <button onClick={() => navigate('/projects-platform')} className="text-sm text-cortex-ocean hover:underline mb-3 inline-flex items-center gap-1">
          <ArrowLeft size={14} /> 回專案列表
        </button>
        <div className="p-4 bg-cortex-red-bg border border-red-200 rounded text-red-700 text-sm">{err}</div>
      </div>
    )
  }

  if (!project) {
    return <div className="text-cortex-muted text-sm p-4">Loading…</div>
  }

  const lc = LIFECYCLE_COLORS[project.lifecycle_status] || LIFECYCLE_COLORS.DRAFT
  const isConf = !!(project as any).is_confidential

  return (
    <div className="bg-white rounded-lg border border-cortex-line shadow-cortex-sm overflow-hidden">
      {/* Project header */}
      <div className="px-5 py-4 border-b border-cortex-line">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => navigate('/projects-platform')}
            className="text-cortex-muted hover:text-cortex-ink text-sm inline-flex items-center gap-1"
          >
            <ArrowLeft size={14} /> 列表
          </button>
          <div className="h-4 w-px bg-cortex-line" />
          <span className="font-mono text-sm text-cortex-ocean font-bold">{project.project_code}</span>
          <span className="text-cortex-muted">·</span>
          <span className="text-base text-cortex-ink font-semibold">{project.data_payload?.title || '—'}</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-cortex-cyan-bg text-cortex-teal border border-cortex-cyan/30">
            {project.type_code}
          </span>
          {isConf && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
              <Lock size={9} /> 機密
            </span>
          )}
          <span className={`ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full border ${lc.pill}`}>
            {lc.label}
          </span>
          <WarRoomHeaderActions project={project} onChanged={reload} />
        </div>
      </div>

      {/* 8-Stage Ribbon */}
      <StageRibbon stages={project.stages} />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-cortex-line bg-cortex-bg px-2">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-[13px] font-semibold transition inline-flex items-center gap-1.5 border-b-2 ${
                active
                  ? 'text-cortex-teal border-cortex-cyan bg-white'
                  : 'text-cortex-muted border-transparent hover:text-cortex-ink hover:border-cortex-line'
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="min-h-[480px]">
        {tab === 'chat'    && <ChatTab    project={project} />}
        {tab === 'tasks'   && <TasksTab   project={project} />}
        {tab === 'form'    && <FormStub   project={project} />}
        {tab === 'members' && <MembersTab project={project} />}
        {tab === 'bi'      && <BiTab      project={project} />}
      </div>
    </div>
  )
}

// ─── Form minimal(顯 Wizard 填的值 + 版本鏈 placeholder)─────────────
function FormStub({ project }: { project: ProjectDetail }) {
  const dp = (project.data_payload as any) || {}
  const isConf = !!(project as any).is_confidential
  const sections: { label: string; fields: { key: string; label: string; confidential?: boolean }[] }[] = [
    {
      label: '客戶資料',
      fields: [
        { key: 'customer', label: '客戶名稱', confidential: true },
        { key: 'partNo', label: '料號' },
      ],
    },
    {
      label: '規格 / 數量',
      fields: [
        { key: 'quantity', label: '數量', confidential: true },
        { key: 'dueDate', label: '交期' },
      ],
    },
    {
      label: '價格 / 成本(機密)',
      fields: [
        { key: 'amount', label: '報價金額', confidential: true },
        { key: 'margin', label: '毛利率', confidential: true },
        { key: 'cost_breakdown', label: '成本明細', confidential: true },
      ],
    },
    {
      label: '其他',
      fields: [
        { key: 'estimatedCycleDays', label: '預估週期(天)' },
        { key: 'priorityScore', label: 'priority_score' },
      ],
    },
  ]
  const versions = ['v1', 'v2', 'v3 ★', 'v4 draft']

  return (
    <div className="p-5 max-w-[920px] mx-auto">
      <div className="flex items-end justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-bold text-cortex-ink">
            報價 Form
            <span className="ml-2 text-[11px] font-normal text-cortex-muted">spec §11 · Wizard 填的值 + 版本鏈</span>
          </h3>
          <p className="text-[12px] text-cortex-muted mt-0.5">
            完整 GUI Form Builder + qp_form_* CRUD 留 Phase 2;Phase 1 demo 顯示 Wizard 收的值 + 版本軌跡
          </p>
        </div>
      </div>

      {/* 版本鏈 */}
      <div className="bg-cortex-line-2/60 border border-cortex-line rounded p-3 mb-3 flex items-center gap-2 flex-wrap text-[12px]">
        <span className="text-cortex-muted text-[10px] font-bold">版本鏈:</span>
        {versions.map((v, i) => {
          const isCurrent = v.includes('★')
          const isDraft = v.includes('draft')
          return (
            <span
              key={v}
              className={`px-2 py-0.5 rounded font-mono font-bold ${
                isCurrent ? 'bg-cortex-cyan text-cortex-navy' :
                isDraft   ? 'bg-cortex-amber-bg text-amber-800 border border-amber-300' :
                            'bg-white border border-cortex-line text-cortex-muted'
              }`}
            >
              {v}
            </span>
          )
        })}
        <span className="text-cortex-muted text-[10px]">→</span>
        <span className="px-2 py-0.5 rounded font-mono font-bold bg-cortex-line text-cortex-muted">FINAL(待結案)</span>
      </div>

      {/* Sections + fields */}
      <div className="space-y-3">
        {sections.map((sec) => (
          <div key={sec.label} className="bg-white border border-cortex-line rounded-lg p-4">
            <div className="text-[12px] font-bold text-cortex-teal mb-2">{sec.label}</div>
            <div className="grid grid-cols-2 gap-3">
              {sec.fields.map((f) => {
                const v = dp[f.key]
                const display = v === undefined || v === '' || v === null ? '—' : String(v)
                return (
                  <div key={f.key} className="flex items-start gap-2 text-[12px] border-b border-cortex-line/50 pb-1.5 last:border-b-0">
                    <div className="w-24 text-cortex-muted shrink-0 flex items-center gap-1">
                      {f.confidential && <span title="機密欄位">🔒</span>}
                      <span>{f.label}</span>
                    </div>
                    <div className="flex-1 font-mono text-cortex-ink">
                      {f.confidential && isConf && display !== '—' ? (
                        <span className="text-amber-700 bg-cortex-amber-bg/50 px-1.5 rounded">{display}</span>
                      ) : display}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 bg-cortex-cyan-bg/40 border-l-2 border-cortex-cyan rounded-r p-3 text-[11px] text-cortex-teal">
        💡 機密欄位 displayStrategy 已在 admin/機密策略頁套用 — 切右上「視角」dropdown 看不同角色畫面
      </div>
    </div>
  )
}

