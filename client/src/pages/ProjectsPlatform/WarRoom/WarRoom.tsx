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
import { ArrowLeft, MessageSquare, Kanban, FileText, Users, Lock, type LucideIcon } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, type ProjectDetail } from '../api'
import { useCrumbs, usePlatform } from '../Shell/PlatformContext'
import { LIFECYCLE_COLORS, TOKENS } from '../tokens'
import StageRibbon from './StageRibbon'
import ChatTab from './ChatTab'
import TasksTab from './TasksTab'
import MembersTab from './MembersTab'
import WarRoomHeaderActions from './WarRoomHeaderActions'

type Tab = 'chat' | 'tasks' | 'form' | 'members'

const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
  { key: 'chat',    label: '聊天',     icon: MessageSquare },
  { key: 'tasks',   label: '任務看板', icon: Kanban },
  { key: 'form',    label: '報價 Form', icon: FileText },
  { key: 'members', label: '成員',     icon: Users },
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
      </div>
    </div>
  )
}

// ─── Form stub(Sprint E 接 qp_form_*)──────────────────────────────
function FormStub({ project }: { project: ProjectDetail }) {
  return (
    <div className="p-6">
      <div className="text-center text-cortex-muted py-12">
        <FileText size={28} className="mx-auto opacity-30 mb-3" />
        <p className="text-sm">報價 Form — 版本鏈 + 機密欄位 — Sprint E</p>
        <p className="text-xs mt-2 text-cortex-muted/70">
          需要 qp_form_templates / qp_form_instances schema(migration 007-010)
        </p>
        <p className="text-xs mt-1 text-cortex-muted/70">project: {project.project_code}</p>
      </div>
    </div>
  )
}

