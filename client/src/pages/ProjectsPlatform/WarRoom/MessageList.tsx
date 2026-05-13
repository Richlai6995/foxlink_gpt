/**
 * MessageList — 訊息流(對齊 docs Sprint 2 後端 + HTML demo .chat-msgs)
 *
 * Features:
 *   - 5 色語言 dot + 標籤(NORMAL/PROGRESS/BLOCKER/DECISION/AI_INSIGHT/SYSTEM)
 *   - Pin / Unpin / Delete hover icons(權限後端擋,前端 toast)
 *   - 自動同步 announcement 標記
 *   - Pinned banner 在頂部
 *   - 5 秒 polling
 *   - announcement channel:訊息渲染 SUMMARY 卡(若有 SYSTEM type)
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Pin, Trash2, RefreshCw, Sparkles, ListChecks, Clock } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, type Message, type Channel } from '../api'
import { MESSAGE_STYLE } from '../tokens'

type Props = {
  projectId: number
  channel: Channel
  /** parent 傳的 polling 鎖,切換 channel 時觸發 reload */
  onError?: (msg: string) => void
}

type SortMode = 'time' | 'smart'

/** AI #24 訊息智慧排序權重(@me / DECISION / BLOCKER / AI_INSIGHT 優先,Pin 最高)*/
function smartScore(m: Message, userId: number | undefined): number {
  let score = 0
  if (m.is_pinned) score += 1000
  if (m.message_type === 'BLOCKER')    score += 100
  if (m.message_type === 'DECISION')   score += 90
  if (m.message_type === 'AI_INSIGHT') score += 80
  if (Number(m.user_id) === Number(userId)) score += 50
  if (m.message_type === 'PROGRESS')   score += 20
  if (m.content && m.content.includes('@')) score += 30
  // 越新的越前(時間 tiebreaker)
  score += Number(new Date(m.created_at).getTime()) / 1e12
  return score
}

export default function MessageList({ projectId, channel, onError }: Props) {
  const { token, user } = useAuth() as any
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('time')
  const listRef = useRef<HTMLDivElement>(null)

  // AI #24 排序
  const displayMessages = useMemo(() => {
    if (sortMode === 'time') return messages
    const arr = [...messages]
    arr.sort((a, b) => smartScore(b, user?.id) - smartScore(a, user?.id))
    return arr
  }, [messages, sortMode, user?.id])

  const reload = async () => {
    if (!token || !channel?.id) return
    setLoading(true)
    try {
      const r = await api.get<{ messages: Message[] }>(
        token, `/projects/${projectId}/channels/${channel.id}/messages?limit=200`,
      )
      // backend DESC → 正向 chronological
      setMessages((r.messages || []).slice().reverse())
      setErr(null)
    } catch (e: any) {
      setErr(e.message)
      onError?.(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Initial load + polling
  useEffect(() => {
    reload()
    const id = setInterval(reload, 5000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, token])

  // Scroll to bottom on message count change
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages.length])

  const togglePin = async (m: Message) => {
    try {
      if (m.is_pinned) {
        await api.post(token, `/messages/${m.id}/unpin`)
      } else {
        const note = prompt('Pin 備註(可空):') ?? ''
        await api.post(token, `/messages/${m.id}/pin`, { note })
      }
      reload()
    } catch (e: any) {
      alert('操作失敗:' + e.message)
    }
  }

  const deleteMsg = async (m: Message) => {
    const reason = prompt('刪除原因(可空):')
    if (reason === null) return
    try {
      await api.delete(token, `/messages/${m.id}`, { reason })
      reload()
    } catch (e: any) {
      alert('刪除失敗:' + e.message)
    }
  }

  const pinnedMsgs = messages.filter((m) => m.is_pinned)

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Sort toggle(AI #24)*/}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-cortex-line bg-cortex-bg/50 text-[10px]">
        <span className="text-cortex-muted">排序:</span>
        <button
          onClick={() => setSortMode('time')}
          className={`px-2 py-0.5 rounded transition inline-flex items-center gap-1 ${
            sortMode === 'time' ? 'bg-cortex-navy text-white' : 'text-cortex-text hover:bg-white'
          }`}
        >
          <Clock size={9} /> 時間
        </button>
        <button
          onClick={() => setSortMode('smart')}
          className={`px-2 py-0.5 rounded transition inline-flex items-center gap-1 ${
            sortMode === 'smart' ? 'bg-cortex-navy text-white' : 'text-cortex-text hover:bg-white'
          }`}
          title="AI #24:@me / DECISION / BLOCKER / AI_INSIGHT / 我發的 排前"
        >
          <ListChecks size={9} /> ✨ 智慧
        </button>
        {sortMode === 'smart' && (
          <span className="text-[9px] text-cortex-muted italic ml-1">
            Pin → BLOCKER → DECISION → AI → 我發的 → PROGRESS · 時間 tiebreaker
          </span>
        )}
      </div>

      {/* Pinned banner */}
      {pinnedMsgs.length > 0 && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 flex items-center gap-2 flex-shrink-0">
          <Pin size={11} className="text-amber-600" />
          <span className="font-semibold">📌 {pinnedMsgs.length} 則 pinned —</span>
          <span className="truncate text-amber-800">{pinnedMsgs[0]?.content.slice(0, 80)}...</span>
        </div>
      )}

      {err && (
        <div className="px-4 py-2 bg-cortex-red-bg border-b border-red-200 text-red-700 text-xs flex items-center gap-2 flex-shrink-0">
          <span>⚠ {err}</span>
          <button onClick={reload} className="ml-auto text-red-700 hover:underline inline-flex items-center gap-1">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 重試
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-3.5 space-y-2 bg-white">
        {messages.length === 0 && !loading && (
          <div className="text-center text-cortex-muted text-sm pt-12">
            還沒有訊息 — 在下方輸入框開始討論
          </div>
        )}

        {displayMessages.map((m) => {
          const style = MESSAGE_STYLE[m.message_type] || MESSAGE_STYLE.NORMAL
          const isMine = Number(m.user_id) === Number(user?.id)
          const isSystem = m.message_type === 'SYSTEM'

          return (
            <div
              key={m.id}
              className={`group flex gap-2.5 p-2.5 rounded-lg ${style.bg} ${m.is_pinned ? 'ring-2 ring-amber-300' : ''} ${isSystem ? 'border border-cortex-line' : ''}`}
            >
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${style.dot}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-[11px] text-cortex-muted flex-wrap">
                  <span className="text-cortex-text font-semibold">
                    {m.user_name || m.user_username || `user#${m.user_id}`}
                    {isMine && ' · 我'}
                  </span>
                  <span>·</span>
                  <span>
                    {new Date(m.created_at).toLocaleString('zh-TW', {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                  {m.message_type !== 'NORMAL' && (
                    <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded bg-white border border-current ${style.dot.replace('bg-', 'border-')}`}>
                      {style.emoji} {style.label}
                    </span>
                  )}
                  {m.is_pinned ? <Pin size={11} className="text-amber-600" /> : null}
                  {m.synced_to_announcement ? (
                    <span className="text-[10px] text-cortex-teal inline-flex items-center gap-0.5">
                      <Sparkles size={10} /> 同步公告
                    </span>
                  ) : null}
                </div>
                <div className={`text-[13px] whitespace-pre-wrap break-words mt-0.5 ${isSystem ? 'text-cortex-text italic' : 'text-cortex-ink'}`}>
                  {m.content}
                </div>
                {m.pin_note && (
                  <div className="text-[11px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded mt-1 inline-block">
                    📌 {m.pin_note}
                  </div>
                )}
              </div>

              {/* Hover actions(SYSTEM 不能 pin/del)*/}
              {!isSystem && (
                <div className="opacity-0 group-hover:opacity-100 transition flex flex-col gap-1">
                  <button
                    onClick={() => togglePin(m)}
                    className={`p-1 rounded hover:bg-white ${m.is_pinned ? 'text-amber-600' : 'text-cortex-muted hover:text-amber-600'}`}
                    title={m.is_pinned ? 'Unpin' : 'Pin'}
                  >
                    <Pin size={12} />
                  </button>
                  <button
                    onClick={() => deleteMsg(m)}
                    className="p-1 rounded hover:bg-white text-cortex-muted hover:text-cortex-red"
                    title="刪除"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
