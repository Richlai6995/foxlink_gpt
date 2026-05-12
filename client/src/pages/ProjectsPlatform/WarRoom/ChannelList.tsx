/**
 * ChannelList — 戰情會議室左欄 channel 列表
 *
 * 對齊 HTML demo .conv-list / .ch-row / .ch-section-label
 *
 * 分組:
 *   公告(announcement,圖示 📢)
 *   頻道(general + group)
 *   私訊(dm,顯示對方名字而非 dm:lo+hi)
 *
 * 互動:
 *   - 點 channel → 切換 active
 *   - 「+ 新對話」開新群組 modal(Sprint 後續)
 */

import { Megaphone, Hash, Users as UsersIcon, Lock, Plus } from 'lucide-react'
import type { Channel } from '../api'

type Props = {
  channels: Channel[]
  activeId: number | null
  onSelect: (id: number) => void
  onNewConv?: () => void
}

const CHANNEL_ICON: Record<string, any> = {
  announcement: Megaphone,
  general:      Hash,
  group:        UsersIcon,
  topic:        UsersIcon,
  dm:           Lock,
}

export default function ChannelList({ channels, activeId, onSelect, onNewConv }: Props) {
  const announcements = channels.filter((c) => c.channel_type === 'announcement' && !c.is_archived)
  const generals      = channels.filter((c) => c.channel_type === 'general' && !c.is_archived)
  const groups        = channels.filter((c) => (c.channel_type === 'group' || c.channel_type === 'topic') && !c.is_archived)
  const dms           = channels.filter((c) => c.channel_type === 'dm' && !c.is_archived)

  return (
    <aside className="bg-cortex-line-2/30 border-r border-cortex-line overflow-y-auto py-3 px-2 text-[13px]">
      {announcements.length > 0 && (
        <>
          <SectionLabel>公告</SectionLabel>
          {announcements.map((c) => (
            <ChannelRow key={c.id} channel={c} active={c.id === activeId} onClick={() => onSelect(c.id)} />
          ))}
        </>
      )}

      {(generals.length + groups.length) > 0 && (
        <>
          <SectionLabel>頻道 · {generals.length + groups.length}</SectionLabel>
          {[...generals, ...groups].map((c) => (
            <ChannelRow key={c.id} channel={c} active={c.id === activeId} onClick={() => onSelect(c.id)} />
          ))}
        </>
      )}

      {dms.length > 0 && (
        <>
          <SectionLabel>私訊 · DM</SectionLabel>
          {dms.map((c) => (
            <ChannelRow key={c.id} channel={c} active={c.id === activeId} onClick={() => onSelect(c.id)} />
          ))}
        </>
      )}

      <button
        onClick={onNewConv}
        className="w-full mt-2 px-3 py-1.5 text-[12px] text-cortex-muted hover:text-cortex-teal hover:bg-white rounded inline-flex items-center gap-1.5 transition"
      >
        <Plus size={13} /> 新對話
      </button>
    </aside>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest px-3 pt-2 pb-1 mt-1">
      {children}
    </div>
  )
}

function ChannelRow({ channel: c, active, onClick }: { channel: Channel; active: boolean; onClick: () => void }) {
  const Icon = CHANNEL_ICON[c.channel_type] || Hash
  const displayName = c.channel_type === 'dm' ? c.name.replace(/^dm:/, '🔒 ') : `#${c.name}`
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[13px] transition ${
        active
          ? 'bg-white text-cortex-teal font-semibold shadow-cortex-sm'
          : 'text-cortex-text hover:bg-white/70'
      }`}
      title={c.topic_summary || displayName}
    >
      <Icon size={13} className={active ? 'text-cortex-cyan' : 'text-cortex-muted'} />
      <span className="truncate flex-1 text-left">{displayName}</span>
      {c.is_default ? null : (
        <span className="text-[9px] text-cortex-muted opacity-60">·</span>
      )}
    </button>
  )
}
