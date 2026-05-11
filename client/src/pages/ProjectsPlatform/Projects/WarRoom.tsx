/**
 * WarRoom — 單一 channel 的訊息流 + 發訊息
 *
 * Sprint 2 demo 範圍:
 *   - 列訊息(分頁,新到舊倒序顯示成正向)
 *   - 顯示訊息色語言(NORMAL/PROGRESS/BLOCKER/DECISION/AI_INSIGHT/SYSTEM)
 *   - Pin 標記、自動同步到 announcement 的提示
 *   - 發訊息(可選 message_type)
 *   - Pin / Unpin / 刪除(只給 author / PM / admin,後端會擋,前端按了被擋就 toast)
 *   - 簡易 polling 每 5 秒刷新
 *   - announcement channel:一般人看到 input 區會顯示「只 PM/admin 可發」
 */

import { useEffect, useRef, useState } from 'react'
import { Pin, Trash2, Send, RefreshCw, Megaphone, Lock, Sparkles } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, Channel, Message, MessageType } from '../api'

const MSG_STYLE: Record<MessageType, { dot: string; bg: string; label: string; emoji?: string }> = {
  NORMAL:     { dot: 'bg-slate-500',  bg: 'bg-slate-800/40',     label: '一般' },
  PROGRESS:   { dot: 'bg-blue-500',   bg: 'bg-blue-900/20',      label: '進度', emoji: '📊' },
  BLOCKER:    { dot: 'bg-red-500',    bg: 'bg-red-900/30',       label: '卡關', emoji: '🚨' },
  DECISION:   { dot: 'bg-green-500',bg: 'bg-green-900/25',   label: '決議', emoji: '✅' },
  AI_INSIGHT: { dot: 'bg-purple-500', bg: 'bg-purple-900/25',    label: 'AI',   emoji: '🤖' },
  SYSTEM:     { dot: 'bg-slate-600',  bg: 'bg-slate-900/60',     label: '系統', emoji: '⚙' },
}

type Props = {
  projectId: number
  channel: Channel
  projectAcl: { is_pm: boolean }
  onChange?: () => void
}

export default function WarRoom({ projectId, channel }: Props) {
  const { token, user } = useAuth() as any
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [msgType, setMsgType] = useState<MessageType>('NORMAL')
  const [posting, setPosting] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const reload = async () => {
    if (!token || !channel?.id) return
    setLoading(true)
    try {
      const r = await api.get<{ messages: Message[] }>(token, `/projects/${projectId}/channels/${channel.id}/messages?limit=200`)
      // backend 回 DESC,前端要正向 chronological
      setMessages((r.messages || []).slice().reverse())
      setErr(null)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  // load + polling 5s
  useEffect(() => {
    reload()
    const id = setInterval(reload, 5000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, token])

  // 訊息進來 → scroll 到底
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages.length])

  const post = async () => {
    if (!input.trim()) return
    setPosting(true)
    try {
      await api.post(token, `/projects/${projectId}/channels/${channel.id}/messages`, {
        content: input.trim(),
        message_type: msgType,
      })
      setInput('')
      setMsgType('NORMAL')
      reload()
    } catch (e: any) {
      alert('發送失敗:' + e.message)
    } finally {
      setPosting(false)
    }
  }

  const togglePin = async (m: Message) => {
    try {
      if (m.is_pinned) {
        await api.post(token, `/messages/${m.id}/unpin`)
      } else {
        const note = prompt('Pin 備註(可空):') || ''
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

  const isAnnouncement = channel.channel_type === 'announcement'
  const channelIcon = isAnnouncement ? Megaphone : channel.channel_type === 'dm' ? Lock : null

  return (
    <div className="flex flex-col h-full">
      {/* Channel header */}
      <div className="px-4 py-2.5 border-b border-slate-700 bg-slate-900/40 flex items-center gap-2">
        {channelIcon && <span className="text-slate-400">{(() => {
          const Icon = channelIcon
          return <Icon size={14} />
        })()}</span>}
        <span className="font-semibold text-slate-100">#{channel.name}</span>
        <span className="text-xs text-slate-500">{channel.channel_type}</span>
        {channel.topic_summary && (
          <span className="text-xs text-slate-400 ml-2">— {channel.topic_summary}</span>
        )}
        <button
          onClick={reload}
          className="ml-auto text-slate-400 hover:text-slate-200"
          title="重新整理"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Pinned banner */}
      {messages.filter((m) => m.is_pinned).length > 0 && (
        <div className="px-4 py-2 bg-amber-950/30 border-b border-amber-900/50 text-xs text-amber-200 flex items-center gap-2">
          <Pin size={12} />
          <span>📌 {messages.filter((m) => m.is_pinned).length} 則 pinned —</span>
          <span className="truncate text-amber-300">
            {messages.filter((m) => m.is_pinned)[0]?.content.slice(0, 80)}...
          </span>
        </div>
      )}

      {err && (
        <div className="px-4 py-2 bg-red-900/20 border-b border-red-800 text-red-300 text-xs">
          {err}
        </div>
      )}

      {/* Message list */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && !loading && (
          <div className="text-center text-slate-500 text-sm pt-12">
            還沒有訊息 — 開始討論吧
          </div>
        )}

        {messages.map((m) => {
          const style = MSG_STYLE[m.message_type] || MSG_STYLE.NORMAL
          const isMine = Number(m.user_id) === Number(user?.id)
          return (
            <div
              key={m.id}
              className={`group flex gap-2 p-2 rounded ${style.bg} ${m.is_pinned ? 'ring-1 ring-amber-700/50' : ''}`}
            >
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${style.dot}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="text-slate-300">user#{m.user_id}{isMine && '（我）'}</span>
                  <span>·</span>
                  <span>{new Date(m.created_at).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  {m.message_type !== 'NORMAL' && (
                    <span className="px-1.5 py-0.5 bg-slate-800 rounded text-[10px]">
                      {style.emoji} {style.label}
                    </span>
                  )}
                  {m.is_pinned ? <Pin size={11} className="text-amber-400" /> : null}
                  {m.synced_to_announcement ? (
                    <span className="text-[10px] text-sky-400 inline-flex items-center gap-0.5">
                      <Sparkles size={10} /> 同步公告
                    </span>
                  ) : null}
                </div>
                <div className="text-sm text-slate-100 whitespace-pre-wrap break-words mt-0.5">
                  {m.content}
                </div>
                {m.pin_note && (
                  <div className="text-xs text-amber-300 mt-0.5">📌 {m.pin_note}</div>
                )}
              </div>

              <div className="opacity-0 group-hover:opacity-100 transition flex flex-col gap-1">
                <button
                  onClick={() => togglePin(m)}
                  className={`p-1 rounded hover:bg-slate-700 ${m.is_pinned ? 'text-amber-400' : 'text-slate-500'}`}
                  title={m.is_pinned ? 'Unpin' : 'Pin'}
                >
                  <Pin size={12} />
                </button>
                <button
                  onClick={() => deleteMsg(m)}
                  className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-red-400"
                  title="刪除"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Input */}
      <div className="border-t border-slate-700 p-3 bg-slate-900/40">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-slate-400">類型:</span>
          {(['NORMAL', 'PROGRESS', 'BLOCKER', 'DECISION', 'AI_INSIGHT'] as MessageType[]).map((t) => {
            const s = MSG_STYLE[t]
            return (
              <button
                key={t}
                onClick={() => setMsgType(t)}
                className={`text-xs px-2 py-0.5 rounded border transition ${
                  msgType === t
                    ? `${s.bg} border-slate-500 text-slate-100`
                    : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500'
                }`}
              >
                {s.emoji ? `${s.emoji} ` : ''}{s.label}
              </button>
            )
          })}
          {(['BLOCKER', 'DECISION', 'AI_INSIGHT'] as MessageType[]).includes(msgType) && (
            <span className="ml-auto text-[11px] text-sky-400">
              <Sparkles size={11} className="inline" /> 自動同步到 #announcement
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                post()
              }
            }}
            placeholder={isAnnouncement ? '⚠ announcement 只 PM/admin 可發,被擋會 toast' : '輸入訊息(Cmd/Ctrl+Enter 送出)'}
            rows={2}
            className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-slate-100 resize-none focus:outline-none focus:border-sky-600"
          />
          <button
            onClick={post}
            disabled={!input.trim() || posting}
            className="px-3 py-2 bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white rounded text-sm transition inline-flex items-center gap-1"
          >
            <Send size={14} />
            {posting ? '送出中…' : '送出'}
          </button>
        </div>
      </div>
    </div>
  )
}
