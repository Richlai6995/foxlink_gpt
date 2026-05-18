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
import { Send, Sparkles, Paperclip, Bot } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, type Channel, type MessageType } from '../api'
import { MESSAGE_STYLE } from '../tokens'

/** 偵測 user 是否要 @bot — 接受 @bot / @ai / @AI / @Bot 開頭 */
const BOT_MENTION_RE = /^@(bot|ai)\b\s*/i

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
  const [botThinking, setBotThinking] = useState(false)

  if (disabled) {
    return (
      <div className="border-t border-cortex-line px-4 py-3.5 bg-cortex-bg text-center text-[12px] text-cortex-muted italic">
        🔒 {disabledReason || '無權限發訊息'}
      </div>
    )
  }

  // 偵測是否為 @bot 提問
  const trimmed = input.trim()
  const botMatch = trimmed.match(BOT_MENTION_RE)
  const isBotQuery = !!botMatch
  const botQuestion = isBotQuery ? trimmed.replace(BOT_MENTION_RE, '').trim() : ''

  const post = async () => {
    if (!trimmed) return

    // Sprint I @bot — 走 bot 端點(strip 掉 @bot/@ai prefix 後送問題)
    if (isBotQuery) {
      if (!botQuestion) {
        alert('@bot 之後請輸入問題,e.g. "@bot 這個料號去年給其他客戶報過嗎?"')
        return
      }
      // 1) 先把 user 的 @bot 訊息發到 channel(讓對話有紀錄)
      setPosting(true)
      try {
        await api.post(token, `/projects/${projectId}/channels/${channel.id}/messages`, {
          content: trimmed,
          message_type: 'NORMAL',
        })
        // 立即清訊框 + 變 bot thinking 狀態
        setInput('')
        setType('NORMAL')
        onSent?.()
      } catch (e: any) {
        alert('發送失敗:' + e.message)
        setPosting(false)
        return
      }
      setPosting(false)

      // 2) 呼 bot 端點(背景跑 LLM)
      setBotThinking(true)
      try {
        await api.post(token, `/projects/${projectId}/channels/${channel.id}/bot`, {
          question: botQuestion,
        })
        onSent?.()  // 觸發 reload 拉到 AI_INSIGHT
      } catch (e: any) {
        alert('Bot 回覆失敗:' + e.message)
      } finally {
        setBotThinking(false)
      }
      return
    }

    setPosting(true)
    try {
      await api.post(token, `/projects/${projectId}/channels/${channel.id}/messages`, {
        content: trimmed,
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
      {/* Bot thinking indicator(@bot 模式跑 LLM 中)*/}
      {botThinking && (
        <div className="mb-2 p-2 rounded bg-gradient-to-r from-cortex-cyan-bg to-purple-50 border border-cortex-cyan/40 text-[11px] text-cortex-teal inline-flex items-center gap-1.5">
          <Bot size={12} className="animate-pulse" />
          <span className="font-semibold">AI Bot 思考中…</span>
          <span className="text-cortex-muted">機密欄位已 scrub · Gemini Flash 處理中</span>
        </div>
      )}

      {/* Type selector(@bot 模式不需選類型,bot 回 AI_INSIGHT)*/}
      {!isBotQuery && (
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
      )}

      {/* Bot mode banner */}
      {isBotQuery && (
        <div className="mb-2 p-1.5 px-2 rounded bg-purple-50 border border-purple-200 text-[11px] text-purple-700 inline-flex items-center gap-1.5">
          <Bot size={12} />
          <span className="font-semibold">@bot 模式</span>
          <span className="text-purple-600/70">回覆型態:AI_INSIGHT · 走兩段 scrub</span>
        </div>
      )}

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
          placeholder={`在 #${channel.name} 發訊息 · 開頭打 @bot 或 @ai 問 AI(Cmd/Ctrl+Enter 送出)`}
          rows={2}
          className={`flex-1 px-3 py-2 bg-white border rounded text-[13px] text-cortex-ink resize-none focus:outline-none focus:ring-2 ${
            isBotQuery
              ? 'border-purple-300 focus:border-purple-400 focus:ring-purple-200'
              : 'border-cortex-line focus:border-cortex-cyan focus:ring-cortex-cyan/15'
          }`}
        />
        <button
          onClick={post}
          disabled={!input.trim() || posting || botThinking}
          className={`px-3 py-2 disabled:opacity-50 rounded text-[13px] font-bold transition inline-flex items-center gap-1 ${
            isBotQuery
              ? 'bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white'
              : 'bg-cortex-cyan text-cortex-navy hover:bg-[#04D9AC]'
          }`}
        >
          {isBotQuery ? <Bot size={14} /> : <Send size={14} />}
          {posting ? '送出中…' : botThinking ? 'Bot 跑中…' : isBotQuery ? '問 Bot' : '送出'}
        </button>
      </div>
    </div>
  )
}
