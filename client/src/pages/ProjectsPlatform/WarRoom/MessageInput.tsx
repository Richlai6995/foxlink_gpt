/**
 * MessageInput — 訊息輸入框
 *
 * 對齊 HTML demo .chat-input + Sprint 2 後端
 *
 * - 訊息類型 selector(NORMAL/PROGRESS/BLOCKER/DECISION/AI_INSIGHT)
 * - 選 BLOCKER/DECISION/AI_INSIGHT 時提示「✨ 自動同步公告」
 * - announcement channel:預設只 PM/admin 能發,被擋會 toast(後端擋)
 * - Cmd/Ctrl+Enter 送出
 */

import { useState } from 'react'
import { Send, Sparkles, Paperclip } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, type Channel, type MessageType } from '../api'
import { MESSAGE_STYLE } from '../tokens'

type Props = {
  projectId: number
  channel: Channel
  onSent?: () => void
  /** announcement channel 給非 PM/admin 顯示提示(後端會擋,前端 UX 提示)*/
  disabled?: boolean
  disabledReason?: string
}

const TYPES: MessageType[] = ['NORMAL', 'PROGRESS', 'BLOCKER', 'DECISION', 'AI_INSIGHT']
const ANNOUNCEMENT_SYNC: MessageType[] = ['BLOCKER', 'DECISION', 'AI_INSIGHT']

export default function MessageInput({ projectId, channel, onSent, disabled, disabledReason }: Props) {
  const { token } = useAuth() as any
  const [input, setInput] = useState('')
  const [type, setType] = useState<MessageType>('NORMAL')
  const [posting, setPosting] = useState(false)

  if (disabled) {
    return (
      <div className="border-t border-cortex-line px-4 py-3.5 bg-cortex-bg text-center text-[12px] text-cortex-muted italic">
        🔒 {disabledReason || '無權限發訊息'}
      </div>
    )
  }

  const post = async () => {
    if (!input.trim()) return
    setPosting(true)
    try {
      await api.post(token, `/projects/${projectId}/channels/${channel.id}/messages`, {
        content: input.trim(),
        message_type: type,
      })
      setInput('')
      setType('NORMAL')
      onSent?.()
    } catch (e: any) {
      alert('發送失敗:' + e.message)
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="border-t border-cortex-line p-3 bg-white">
      {/* Type selector */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-[11px] text-cortex-muted">類型:</span>
        {TYPES.map((t) => {
          const s = MESSAGE_STYLE[t]
          const on = type === t
          return (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
                on
                  ? 'bg-cortex-navy text-white border-cortex-navy shadow-cortex-sm'
                  : 'bg-white border-cortex-line text-cortex-text hover:border-cortex-cyan'
              }`}
            >
              {s.emoji ? `${s.emoji} ` : ''}{s.label}
            </button>
          )
        })}
        {ANNOUNCEMENT_SYNC.includes(type) && (
          <span className="ml-auto text-[10px] text-cortex-teal inline-flex items-center gap-0.5">
            <Sparkles size={10} /> 自動同步 #announcement
          </span>
        )}
      </div>

      {/* Input row */}
      <div className="flex gap-2 items-end">
        <button className="w-8 h-8 rounded text-cortex-muted hover:bg-cortex-line-2 inline-flex items-center justify-center" title="附件(後續)">
          <Paperclip size={14} />
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              post()
            }
          }}
          placeholder={`在 #${channel.name} 發訊息(可 @AI Bot · Cmd/Ctrl+Enter 送出)`}
          rows={2}
          className="flex-1 px-3 py-2 bg-white border border-cortex-line rounded text-[13px] text-cortex-ink resize-none focus:outline-none focus:border-cortex-cyan focus:ring-2 focus:ring-cortex-cyan/15"
        />
        <button
          onClick={post}
          disabled={!input.trim() || posting}
          className="px-3 py-2 bg-cortex-cyan text-cortex-navy hover:bg-[#04D9AC] disabled:opacity-50 rounded text-[13px] font-bold transition inline-flex items-center gap-1"
        >
          <Send size={14} />
          {posting ? '送出中…' : '送出'}
        </button>
      </div>
    </div>
  )
}
