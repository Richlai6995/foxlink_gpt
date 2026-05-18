/**
 * ChatTab — 戰情會議室「聊天」分頁
 *
 * 3 欄 layout:ChannelList | active channel(header + messages + input)| 簡易右欄 stub
 *
 * 對齊 Sprint 2 後端:
 *   - GET /projects/:id/channels/:cid/messages
 *   - POST /projects/:id/channels/:cid/messages
 *   - announcement channel 限 PM/admin 發
 *
 * Sprint D 補:右欄 ⭐ Status SUMMARY card(目前只顯示 channel info)
 */

import { useEffect, useState } from 'react'
import { Hash, Megaphone, Lock, Search, Settings, Users, Radio } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, type ProjectDetail, type Channel, type Participant } from '../api'
import ChannelList from './ChannelList'
import MessageList from './MessageList'
import MessageInput from './MessageInput'
import { usePlatform } from '../Shell/PlatformContext'
import { useProjectsPlatformSocket } from '../../../hooks/useProjectsPlatformSocket'

const CHANNEL_ICON: Record<string, any> = {
  announcement: Megaphone,
  general:      Hash,
  group:        Hash,
  topic:        Hash,
  dm:           Lock,
}

type Props = {
  project: ProjectDetail
}

export default function ChatTab({ project }: Props) {
  const { demoRole } = usePlatform()

  // 預設選 general,沒則第一個
  const defaultId =
    project.channels.find((c) => c.channel_type === 'general')?.id ??
    project.channels[0]?.id ?? null

  const [activeId, setActiveId] = useState<number | null>(defaultId)

  // 當 project.channels 重新載入時,確保 activeId 還有效
  useEffect(() => {
    if (activeId && !project.channels.find((c) => c.id === activeId)) {
      setActiveId(defaultId)
    }
  }, [project.channels, activeId, defaultId])

  // 渲染計數器:讓 MessageList 在 user 送訊息後立即 reload(透過 key 重置)
  const [reloadKey, setReloadKey] = useState(0)

  const active = project.channels.find((c) => c.id === activeId)
  const Icon = active ? (CHANNEL_ICON[active.channel_type] || Hash) : Hash

  // WebSocket — 別人發訊息時即時 reload
  const { lastEvent, connected } = useProjectsPlatformSocket({
    projectId: project.id,
    channelId: active?.id || null,
  })
  useEffect(() => {
    if (!lastEvent) return
    if (lastEvent.type === 'proj_new_message') {
      const evChannelId = lastEvent.data?.channel_id
      // 只 reload 當前 active channel(其他 channel 的訊息不打擾)
      if (evChannelId && evChannelId === active?.id) {
        setReloadKey((k) => k + 1)
      }
    }
  }, [lastEvent, active?.id])

  // announcement channel 預設只 PM/admin 能發
  // 前端粗判:demo role HOST 算 PM/admin、OBSERVER/CHAT_GUEST/OUTSIDER 不能發、其他人嘗試後端會擋
  const isReadonlyRole = demoRole === 'OBSERVER' || demoRole === 'OUTSIDER'
  const isAnnouncementRestricted = active?.channel_type === 'announcement' && demoRole !== 'HOST'

  return (
    <div className="grid grid-cols-[200px_1fr_280px] h-[560px] divide-x divide-cortex-line">
      {/* Left: channel list */}
      <ChannelList
        channels={project.channels}
        activeId={activeId}
        onSelect={(id) => setActiveId(id)}
        onNewConv={() => alert('「新對話」DM / 群組 — Sprint 後續')}
      />

      {/* Center: active channel */}
      <main className="flex flex-col min-w-0 bg-white">
        {!active ? (
          <div className="flex-1 flex items-center justify-center text-cortex-muted text-sm">
            請選擇一個頻道
          </div>
        ) : (
          <>
            {/* Channel header */}
            <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-cortex-line bg-white">
              <Icon size={14} className="text-cortex-muted" />
              <span className="font-bold text-cortex-ink text-[14px]">
                {active.channel_type === 'dm' ? active.name.replace(/^dm:/, '🔒 ') : `#${active.name}`}
              </span>
              <span className="text-[11px] text-cortex-muted">· {active.channel_type}</span>
              {active.topic_summary && (
                <span className="text-[11px] text-cortex-muted">— {active.topic_summary}</span>
              )}
              <span className="ml-auto text-[10px] text-cortex-muted inline-flex items-center gap-1">
                <Radio size={10} className={connected ? 'text-cortex-green' : 'text-cortex-muted'} />
                <span className={connected ? 'text-cortex-green font-semibold' : ''}>
                  {connected ? '即時' : '離線'}
                </span>
                <span className="mx-1">·</span>
                {project.members.length} 案件成員
              </span>
              <button className="w-7 h-7 rounded text-cortex-muted hover:bg-cortex-line-2 inline-flex items-center justify-center" title="搜尋(後續)">
                <Search size={12} />
              </button>
              <button className="w-7 h-7 rounded text-cortex-muted hover:bg-cortex-line-2 inline-flex items-center justify-center" title="設定(後續)">
                <Settings size={12} />
              </button>
            </div>

            {/* Announcement warning */}
            {active.channel_type === 'announcement' && (
              <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-[11px] text-amber-900">
                📢 <strong>announcement channel</strong> · 限業務(HOST)發,所有 member 必看 + 已讀回執
              </div>
            )}

            {/* Messages */}
            <MessageList
              key={`${active.id}-${reloadKey}`}
              projectId={project.id}
              channel={active}
            />

            {/* Input */}
            <MessageInput
              projectId={project.id}
              channel={active}
              onSent={() => setReloadKey((k) => k + 1)}
              disabled={isReadonlyRole || isAnnouncementRestricted}
              disabledReason={
                isReadonlyRole
                  ? `視角 ${demoRole}:聊天訊息僅供讀取`
                  : isAnnouncementRestricted
                  ? '此 channel 僅業務(HOST)可發,你可閱讀'
                  : undefined
              }
            />
          </>
        )}
      </main>

      {/* Right: Channel info + Members + Status SUMMARY + Stages */}
      <RightPanel project={project} activeChannel={active} />
    </div>
  )
}

function RightPanel({ project, activeChannel }: { project: ProjectDetail; activeChannel?: Channel }) {
  const { token } = useAuth() as any
  const [participants, setParticipants] = useState<Participant[]>([])
  const [partsLoading, setPartsLoading] = useState(false)

  // 載入 active channel 的 participants(切 channel 自動 reload)
  useEffect(() => {
    if (!activeChannel || !token) {
      setParticipants([])
      return
    }
    setPartsLoading(true)
    api.get<{ participants: Participant[] }>(token, `/projects/${project.id}/channels/${activeChannel.id}/participants`)
      .then((r) => setParticipants(r.participants || []))
      .catch(() => setParticipants([]))
      .finally(() => setPartsLoading(false))
  }, [activeChannel?.id, token, project.id])

  // 用 project.members map 補 role(participants 只給 channel role,project role 另外查)
  const memberRoleMap = new Map(project.members.map((m) => [m.user_id, { role: m.role, sub_role: m.sub_role }]))

  return (
    <aside className="bg-cortex-line-2/30 overflow-y-auto p-3 text-[12px] text-cortex-text">
      <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-2 px-1">
        頻道資訊
      </div>
      <div className="bg-white border border-cortex-line rounded-lg p-3 mb-3">
        <div className="text-[12px] font-semibold text-cortex-ink mb-1">
          {activeChannel ? `#${activeChannel.name}` : '—'}
        </div>
        <div className="text-[11px] text-cortex-muted">{activeChannel?.channel_type}</div>
        {activeChannel?.topic_summary && (
          <div className="text-[11px] text-cortex-text mt-1.5">{activeChannel.topic_summary}</div>
        )}
        <div className="text-[10px] text-cortex-muted mt-2">
          建於 {activeChannel ? new Date(activeChannel.created_at).toLocaleDateString('zh-TW') : '—'}
        </div>
      </div>

      {/* Channel members */}
      <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-2 px-1 flex items-center gap-1">
        <Users size={10} /> 頻道成員 <span className="text-cortex-ink">({participants.length})</span>
      </div>
      <div className="bg-white border border-cortex-line rounded-lg p-2 mb-3 max-h-[180px] overflow-y-auto">
        {partsLoading ? (
          <div className="text-[11px] text-cortex-muted italic p-1">載入中…</div>
        ) : participants.length === 0 ? (
          <div className="text-[11px] text-cortex-muted italic p-1">無參與者</div>
        ) : (
          <ul className="space-y-0.5">
            {participants.map((p) => {
              const pj = memberRoleMap.get(p.user_id)
              const displayName = p.name || p.username || `user#${p.user_id}`
              const username = p.username && p.name ? p.username : null
              const isOwner = p.role === 'owner'
              const isPm = pj?.role === 'PM' || pj?.role === 'pm'
              const isSales = pj?.role === 'SALES' || pj?.role === 'sales' || pj?.role === 'HOST'
              return (
                <li
                  key={p.user_id}
                  className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-cortex-line-2/50 text-[11px]"
                  title={`${displayName}${username ? ` (${username})` : ''} · channel role: ${p.role}${pj?.role ? ` · project role: ${pj.role}` : ''}`}
                >
                  {/* Avatar 圓圈 */}
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                    isOwner ? 'bg-cortex-amber-bg text-amber-800' :
                    isPm    ? 'bg-cortex-cyan-bg text-cortex-teal' :
                    isSales ? 'bg-cortex-green-bg text-cortex-green' :
                              'bg-cortex-line text-cortex-muted'
                  }`}>
                    {displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate flex-1 text-cortex-ink">{displayName}</span>
                  {isPm     && <span className="text-[8px] font-bold text-cortex-teal bg-cortex-cyan-bg px-1 rounded shrink-0">PM</span>}
                  {isSales  && !isPm && <span className="text-[8px] font-bold text-cortex-green bg-cortex-green-bg px-1 rounded shrink-0">業務</span>}
                  {pj?.sub_role && <span className="text-[8px] font-mono text-cortex-muted shrink-0">{pj.sub_role}</span>}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-2 px-1">
        ⭐ Status SUMMARY
      </div>
      <div className="bg-gradient-to-br from-cortex-navy to-cortex-teal text-white rounded-lg p-3 mb-3">
        <div className="text-[10px] font-bold text-cortex-cyan tracking-widest mb-1.5">
          AI #21 · 跨 channel 摘要
        </div>
        <div className="text-[11px] italic text-cortex-cyan-bg mb-2 leading-relaxed">
          Sprint D 上線 — 每天 09:00 自動 + Stage 切換時 + 手動 @bot summary
        </div>
        <div className="text-[10px] text-cortex-cyan-bg/70">
          三段式:進度 · 風險 · 待辦(24h)
        </div>
      </div>

      <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-2 px-1">
        Stages 進度
      </div>
      <div className="space-y-1">
        {project.stages.slice(0, 4).map((s) => (
          <div key={s.id} className="bg-white border border-cortex-line rounded p-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="font-mono text-cortex-ink font-semibold">#{s.stage_order} {s.stage_code}</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                s.status === 'ACTIVE' ? 'bg-cortex-cyan-bg text-cortex-teal' :
                s.status === 'DONE' ? 'bg-cortex-green-bg text-cortex-green' :
                s.status === 'READY_FOR_GATE' ? 'bg-cortex-amber-bg text-amber-700' :
                'bg-cortex-line-2 text-cortex-muted'
              }`}>
                {s.status}
              </span>
            </div>
          </div>
        ))}
        {project.stages.length > 4 && (
          <div className="text-[10px] text-cortex-muted text-center">+{project.stages.length - 4} more</div>
        )}
      </div>
    </aside>
  )
}
