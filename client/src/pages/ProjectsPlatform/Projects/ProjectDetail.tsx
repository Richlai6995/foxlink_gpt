/**
 * ProjectDetail — 專案詳細頁
 *
 * Layout(桌機):左側 channel sidebar + 右側 war room
 *               上方:專案 header + lifecycle 控制
 *
 * Sprint 1+2 demo 覆蓋:
 *   - 列 channels(7 個 QUOTE 預設)
 *   - 選 channel 進 WarRoom
 *   - Lifecycle 5-state 控制(DRAFT→ACTIVE→PAUSED→CLOSED→REOPENED)
 *   - Stage 進度 overview(右側折疊面板)
 *   - Members 清單
 */

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, Megaphone, Hash, MessageSquare, Lock, Users, ListChecks } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, ProjectDetail as ProjectDetailType, Channel } from '../api'
import WarRoom from './WarRoom'

const LIFECYCLE_NEXT: Record<string, string[]> = {
  DRAFT:    ['ACTIVE'],
  ACTIVE:   ['PAUSED', 'CLOSED'],
  PAUSED:   ['ACTIVE', 'CLOSED'],
  CLOSED:   ['REOPENED'],
  REOPENED: ['ACTIVE'],
}

const LIFECYCLE_LABEL: Record<string, string> = {
  ACTIVE:   '啟用 → ACTIVE',
  PAUSED:   '暫停 → PAUSED',
  CLOSED:   '結案 → CLOSED',
  REOPENED: '重啟 → REOPENED',
}

const CHANNEL_ICON: Record<string, any> = {
  announcement: Megaphone,
  general:      Hash,
  group:        MessageSquare,
  topic:        MessageSquare,
  dm:           Lock,
}

const STAGE_STATUS_COLOR: Record<string, string> = {
  PENDING:        'text-slate-500 bg-slate-800/60',
  ACTIVE:         'text-cyan-300 bg-cyan-900/30',
  READY_FOR_GATE: 'text-amber-300 bg-amber-900/30',
  DONE:           'text-emerald-300 bg-emerald-900/30',
  SKIPPED:        'text-slate-600 bg-slate-800/40',
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const { token } = useAuth() as any
  const navigate = useNavigate()
  const [project, setProject] = useState<ProjectDetailType | null>(null)
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showRightPane, setShowRightPane] = useState<'stages' | 'members' | null>('stages')

  const reload = async () => {
    if (!id || !token) return
    setLoading(true)
    setErr(null)
    try {
      const r = await api.get<{ project: ProjectDetailType }>(token, `/projects/${id}`)
      setProject(r.project)
      // 預設選 general(若沒有則第一個)
      if (!activeChannelId && r.project.channels?.length) {
        const general = r.project.channels.find((c) => c.name === 'general' || c.channel_type === 'general')
        setActiveChannelId(general ? general.id : r.project.channels[0].id)
      }
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token])

  const changeLifecycle = async (toStatus: string) => {
    if (!project) return
    let reason: string | undefined
    if (toStatus === 'PAUSED' || toStatus === 'CLOSED' || toStatus === 'REOPENED') {
      const r = prompt(`請輸入 ${toStatus} 原因(可空白):`)
      if (r === null) return
      reason = r
    }
    try {
      await api.post(token, `/projects/${project.id}/lifecycle`, { to_status: toStatus, reason })
      reload()
    } catch (e: any) {
      alert('狀態變更失敗:' + e.message)
    }
  }

  if (err) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <button onClick={() => navigate('/projects-platform')} className="text-sm text-cyan-400 hover:underline mb-3">
          ← 回專案列表
        </button>
        <div className="p-4 bg-red-900/20 border border-red-800 rounded text-red-300 text-sm">{err}</div>
      </div>
    )
  }

  if (!project) {
    return <div className="p-6 text-slate-500 text-sm">Loading...</div>
  }

  const activeChannel = project.channels.find((c) => c.id === activeChannelId)
  const allowedTransitions = LIFECYCLE_NEXT[project.lifecycle_status] || []

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200">
      {/* Header */}
      <div className="border-b border-slate-700 px-6 py-3 bg-slate-900/80 sticky top-0 z-10">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => navigate('/projects-platform')}
            className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
          >
            <ArrowLeft size={14} /> 列表
          </button>
          <div className="h-4 w-px bg-slate-700" />
          <span className="font-mono text-sm text-cyan-300">{project.project_code}</span>
          <span className="text-sm text-slate-500">·</span>
          <span className="text-sm text-slate-200">{project.data_payload?.title || '—'}</span>
          <span className="text-xs px-2 py-0.5 bg-slate-700 rounded text-slate-300">{project.type_code}</span>

          <div className="ml-auto flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded border ${
              project.lifecycle_status === 'ACTIVE'
                ? 'bg-emerald-700/30 text-emerald-300 border-emerald-700/50'
                : project.lifecycle_status === 'PAUSED'
                ? 'bg-amber-700/30 text-amber-300 border-amber-700/50'
                : project.lifecycle_status === 'CLOSED'
                ? 'bg-slate-800 text-slate-400 border-slate-700'
                : 'bg-slate-700/40 text-slate-300 border-slate-600/50'
            }`}>
              {project.lifecycle_status}
            </span>

            {allowedTransitions.map((to) => (
              <button
                key={to}
                onClick={() => changeLifecycle(to)}
                className="text-xs px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition"
              >
                {LIFECYCLE_LABEL[to] || to}
              </button>
            ))}

            <button
              onClick={reload}
              className="text-slate-400 hover:text-slate-200"
              title="重新整理"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* 3-column layout: channels | war room | right panel */}
      <div className="flex h-[calc(100vh-58px)]">
        {/* Channels sidebar */}
        <aside className="w-60 border-r border-slate-700 bg-slate-900/60 overflow-y-auto shrink-0">
          <div className="px-3 py-2 text-xs uppercase text-slate-500 sticky top-0 bg-slate-900/80">
            頻道 ({project.channels.length})
          </div>
          {project.channels.map((c) => {
            const Icon = CHANNEL_ICON[c.channel_type] || Hash
            const isActive = c.id === activeChannelId
            return (
              <button
                key={c.id}
                onClick={() => setActiveChannelId(c.id)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition ${
                  isActive ? 'bg-cyan-900/40 text-cyan-200' : 'text-slate-300 hover:bg-slate-800/60'
                }`}
              >
                <Icon size={14} className="shrink-0 opacity-70" />
                <span className="truncate">{c.name}</span>
                {c.is_default ? null : <span className="ml-auto text-xs text-slate-500">·</span>}
              </button>
            )
          })}
        </aside>

        {/* War room */}
        <main className="flex-1 min-w-0 flex flex-col">
          {activeChannel ? (
            <WarRoom
              key={activeChannel.id}
              projectId={project.id}
              channel={activeChannel}
              projectAcl={{
                is_pm: false, // 由後端判斷,前端不知道 — UI 仍嘗試操作,被擋會 toast
              }}
              onChange={() => {
                // post / pin / delete 後不需要 reload project(只重整 message list)
              }}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              請選擇一個頻道
            </div>
          )}
        </main>

        {/* Right pane (collapsible) */}
        <aside className="w-72 border-l border-slate-700 bg-slate-900/60 shrink-0 flex flex-col">
          <div className="flex border-b border-slate-700">
            <button
              onClick={() => setShowRightPane(showRightPane === 'stages' ? null : 'stages')}
              className={`flex-1 px-3 py-2 text-xs flex items-center justify-center gap-1.5 transition ${
                showRightPane === 'stages' ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:bg-slate-800/60'
              }`}
            >
              <ListChecks size={13} /> Stages ({project.stages.length})
            </button>
            <button
              onClick={() => setShowRightPane(showRightPane === 'members' ? null : 'members')}
              className={`flex-1 px-3 py-2 text-xs flex items-center justify-center gap-1.5 transition ${
                showRightPane === 'members' ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:bg-slate-800/60'
              }`}
            >
              <Users size={13} /> Members ({project.members.length})
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {showRightPane === 'stages' && project.stages.map((s) => (
              <div
                key={s.id}
                className="p-2 rounded border border-slate-700 bg-slate-900/50"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-mono text-slate-200">{s.stage_code}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${STAGE_STATUS_COLOR[s.status] || 'text-slate-500'}`}>
                    {s.status}
                  </span>
                </div>
                <div className="text-xs text-slate-500 flex justify-between">
                  <span>Order #{s.stage_order}</span>
                  {s.sla_hours && <span>SLA {s.sla_hours}h</span>}
                </div>
                {s.gate_required ? (
                  <div className="mt-1 text-xs text-amber-400">⚠ 需要 Stage Gate 確認</div>
                ) : null}
              </div>
            ))}

            {showRightPane === 'members' && project.members.map((m) => (
              <div key={m.id} className="p-2 rounded border border-slate-700 bg-slate-900/50 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-200">user_id: {m.user_id}</span>
                  <span className="text-xs px-1.5 py-0.5 bg-slate-700 rounded text-slate-300">{m.role}</span>
                </div>
                {m.sub_role && (
                  <div className="text-xs text-slate-500 mt-0.5">sub_role: {m.sub_role}</div>
                )}
                <div className="text-xs text-slate-600 mt-0.5">
                  {new Date(m.invited_at).toLocaleString('zh-TW')}
                </div>
              </div>
            ))}

            {showRightPane === null && (
              <div className="text-xs text-slate-500 italic">點上方 tab 開啟側欄</div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
