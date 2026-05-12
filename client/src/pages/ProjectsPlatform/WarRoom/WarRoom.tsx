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
import { useCrumbs } from '../Shell/PlatformContext'
import { LIFECYCLE_COLORS } from '../tokens'
import StageRibbon from './StageRibbon'

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

  useEffect(() => {
    if (!id || !token) return
    let cancelled = false
    api.get<{ project: ProjectDetail }>(token, `/projects/${id}`)
      .then((r) => { if (!cancelled) setProject(r.project) })
      .catch((e) => { if (!cancelled) setErr(e.message) })
    return () => { cancelled = true }
  }, [id, token])

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

      {/* Tab content — Sprint A stub */}
      <div className="min-h-[480px]">
        {tab === 'chat'    && <ChatStub project={project} />}
        {tab === 'tasks'   && <TasksStub project={project} />}
        {tab === 'form'    && <FormStub project={project} />}
        {tab === 'members' && <MembersStub project={project} />}
      </div>
    </div>
  )
}

// ─── Stubs ─────────────────────────────────────────────────────────
function ChatStub({ project }: { project: ProjectDetail }) {
  return (
    <div className="grid grid-cols-[200px_1fr] divide-x divide-cortex-line h-[480px]">
      <aside className="p-3 overflow-y-auto bg-cortex-line-2/30">
        <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-2">
          頻道 ({project.channels.length})
        </div>
        {project.channels.map((c) => (
          <div
            key={c.id}
            className="px-2 py-1.5 text-[13px] text-cortex-text rounded hover:bg-white cursor-pointer flex items-center gap-1.5"
          >
            <span className="text-cortex-muted">#</span>
            <span className="truncate">{c.name}</span>
          </div>
        ))}
      </aside>
      <div className="p-6 text-center text-cortex-muted">
        <MessageSquare size={28} className="mx-auto opacity-30 mb-3" />
        <p className="text-sm">聊天 / 訊息流 — Sprint C 填肉</p>
        <p className="text-xs mt-2 text-cortex-muted/70">
          後端 API 已 ready(Sprint 2):POST /projects/:id/channels/:cid/messages
        </p>
      </div>
    </div>
  )
}

function TasksStub({ project }: { project: ProjectDetail }) {
  return (
    <div className="p-6">
      <div className="text-center text-cortex-muted py-12">
        <Kanban size={28} className="mx-auto opacity-30 mb-3" />
        <p className="text-sm">任務看板 — Kanban + RACI + Dependency Gantt — Sprint C</p>
        <p className="text-xs mt-2 text-cortex-muted/70">
          DB schema 已 ready:project_tasks(含 accountable_role / primary_owner_user_id / depends_on_task_id / relative_deadline_days)
        </p>
        <p className="text-xs mt-1 text-cortex-muted/70">Stages: {project.stages.length} · Channels: {project.channels.length}</p>
      </div>
    </div>
  )
}

function FormStub({ project }: { project: ProjectDetail }) {
  return (
    <div className="p-6">
      <div className="text-center text-cortex-muted py-12">
        <FileText size={28} className="mx-auto opacity-30 mb-3" />
        <p className="text-sm">報價 Form — 版本鏈 + 機密欄位 — Sprint C</p>
        <p className="text-xs mt-2 text-cortex-muted/70">
          需要 qp_form_templates / qp_form_instances schema(後續 migration 007-010)
        </p>
        <p className="text-xs mt-1 text-cortex-muted/70">project: {project.project_code}</p>
      </div>
    </div>
  )
}

function MembersStub({ project }: { project: ProjectDetail }) {
  return (
    <div className="p-6">
      <h3 className="text-base font-bold text-cortex-ink mb-3">成員 ({project.members.length})</h3>
      <div className="grid grid-cols-2 gap-2">
        {project.members.map((m) => (
          <div key={m.id} className="bg-white border border-cortex-line rounded p-3 text-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="text-cortex-ink font-semibold">user#{m.user_id}</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 bg-cortex-cyan-bg text-cortex-teal rounded">
                {m.role}
              </span>
            </div>
            {m.sub_role && <div className="text-xs text-cortex-muted">sub_role: {m.sub_role}</div>}
            <div className="text-[10px] text-cortex-muted mt-1">{new Date(m.invited_at).toLocaleString('zh-TW')}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-cortex-muted/70 mt-4">
        Multi-PM Team 分組視覺化 + RACI 矩陣 — Sprint C
      </p>
    </div>
  )
}
