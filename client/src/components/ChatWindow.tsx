import { useEffect, useRef } from 'react'
import { Copy, Check, RefreshCw, Download, Cpu, User, MessageSquarePlus } from 'lucide-react'
import { useState } from 'react'
import MarkdownRenderer from './MarkdownRenderer'
import ResearchProgressCard from './ResearchProgressCard'
import InlineChart from './chat/InlineChart'
import type { ChatMessage, GeneratedFile } from '../types'
import { useTranslation } from 'react-i18next'

interface Props {
  messages: ChatMessage[]
  streaming: boolean
  streamingContent: string
  streamingStatus?: string
  onCopy: (text: string) => void
  onRegenerate?: () => void
  onFeedback?: (messageContent: string) => void
}

function GeneratedFileLinks({ files }: { files: GeneratedFile[] }) {
  if (!files || files.length === 0) return null
  const imageFiles = files.filter((f) => f.type === 'image')
  const audioFiles = files.filter((f) => f.type === 'audio' || f.filename?.toLowerCase().endsWith('.mp3'))
  const otherFiles = files.filter((f) => f.type !== 'image' && f.type !== 'audio' && !f.filename?.toLowerCase().endsWith('.mp3'))
  return (
    <div className="mt-3 space-y-2">
      {imageFiles.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {imageFiles.map((f, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <img
                src={f.publicUrl}
                alt={f.filename}
                className="max-w-sm max-h-64 rounded-xl border border-slate-200 shadow-sm object-contain"
              />
              <a
                href={f.publicUrl}
                download={f.filename}
                className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-700 rounded-lg px-3 py-1.5 text-xs font-medium transition self-start"
              >
                <Download size={12} />
                {f.filename}
              </a>
            </div>
          ))}
        </div>
      )}
      {audioFiles.length > 0 && (
        <div className="flex flex-col gap-2">
          {audioFiles.map((f, i) => (
            <div key={i} className="flex flex-col gap-1">
              <audio controls src={f.publicUrl} className="w-full max-w-md rounded-lg" preload="metadata" />
              <a
                href={f.publicUrl}
                download={f.filename}
                className="inline-flex items-center gap-1.5 bg-sky-50 border border-sky-200 hover:bg-sky-100 text-sky-700 rounded-lg px-3 py-1.5 text-xs font-medium transition self-start"
              >
                <Download size={12} />
                {f.filename}
              </a>
            </div>
          ))}
        </div>
      )}
      {otherFiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {otherFiles.map((f, i) => (
            <a
              key={i}
              href={f.publicUrl}
              download={f.filename}
              className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-700 rounded-lg px-3 py-1.5 text-xs font-medium transition"
            >
              <Download size={12} />
              {f.filename}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function markdownToPlainText(md: string): string {
  return md
    .replace(/```[\w]*\n([\s\S]*?)```/g, '$1')   // fenced code blocks → content only
    .replace(/`([^`]+)`/g, '$1')                   // inline code
    .replace(/^#{1,6}\s+/gm, '')                   // headings
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')         // bold+italic
    .replace(/\*\*([^*]+)\*\*/g, '$1')             // bold
    .replace(/\*([^*\n]+)\*/g, '$1')               // italic
    .replace(/(?<!\w)__([^_]+)__(?!\w)/g, '$1')
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')      // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')       // links
    .replace(/^>\s+/gm, '')                         // blockquotes
    .replace(/^[-*+]\s+/gm, '• ')                  // unordered lists
    .replace(/^\d+\.\s+/gm, (m) => m)              // ordered lists (keep as-is)
    .replace(/^[-_*]{3,}$/gm, '')                  // hr
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function MessageBubble({
  msg,
  onCopy,
  onRegenerate,
  onFeedback,
  isLast,
}: {
  msg: ChatMessage
  onCopy: (text: string) => void
  onRegenerate?: () => void
  onFeedback?: (content: string) => void
  isLast?: boolean
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [hover, setHover] = useState(false)

  const handleCopy = () => {
    const text = msg.role === 'assistant' ? markdownToPlainText(msg.content ?? '') : (msg.content ?? '')
    onCopy(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (msg.role === 'user') {
    return (
      <div
        className="flex justify-end gap-3 group"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div className="flex flex-col items-end min-w-0 max-w-[75%] gap-1">
          {/* Files */}
          {msg.files && msg.files.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-end mb-1">
              {msg.files.map((f, i) => (
                <span
                  key={i}
                  className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full"
                >
                  📎 {f.name}
                </span>
              ))}
            </div>
          )}
          <div data-chat-bubble="user" className="bg-blue-600 text-white px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed whitespace-pre-wrap break-words min-w-0 w-full">
            {msg.content ?? ''}
          </div>
          {hover && (
            <button
              onClick={handleCopy}
              className="text-slate-400 hover:text-slate-600 transition text-xs flex items-center gap-1"
            >
              {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              {copied ? t('common.copied') : t('common.copy')}
            </button>
          )}
        </div>
        <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
          <User size={14} className="text-white" />
        </div>
      </div>
    )
  }

  // Assistant
  return (
    <div
      className="flex gap-3 group"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center flex-shrink-0 mt-1 shadow-sm">
        <Cpu size={14} className="text-white" />
      </div>
      <div className="flex-1 max-w-[85%]">
        <div data-chat-bubble="assistant" className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm overflow-hidden break-words">
          {(msg.content ?? '').startsWith('__RESEARCH_JOB__:')
            ? <ResearchProgressCard jobId={(msg.content ?? '').slice('__RESEARCH_JOB__:'.length)} />
            : <>
                <MarkdownRenderer content={msg.content ?? ''} />
                {msg.charts?.map((spec, i) => <InlineChart key={i} spec={spec} />)}
                <GeneratedFileLinks files={msg.generated_files || []} />
              </>
          }
        </div>
        {hover && (
          <div className="flex items-center gap-2 mt-1.5">
            <button
              onClick={handleCopy}
              className="text-slate-400 hover:text-slate-600 transition text-xs flex items-center gap-1"
            >
              {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              {copied ? t('common.copied') : t('common.copy')}
            </button>
            {isLast && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="text-slate-400 hover:text-slate-600 transition text-xs flex items-center gap-1"
              >
                <RefreshCw size={12} />
                {t('common.regenerate')}
              </button>
            )}
            {onFeedback && (
              <button
                onClick={() => onFeedback(typeof msg.content === 'string' ? msg.content : '')}
                className="text-slate-400 hover:text-rose-400 transition text-xs flex items-center gap-1"
              >
                <MessageSquarePlus size={12} />
                {t('feedback.title')}
              </button>
            )}
            {msg.input_tokens !== undefined && msg.output_tokens !== undefined && (
              <span className="text-slate-300 text-xs ml-auto">
                ↑{msg.input_tokens} ↓{msg.output_tokens} tokens
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StreamingBubble({ content, status }: { content: string; status?: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center flex-shrink-0 mt-1 shadow-sm">
        <Cpu size={14} className="text-white animate-pulse" />
      </div>
      <div className="flex-1 max-w-[85%]">
        <div data-chat-bubble="assistant" className="bg-white border border-blue-200 rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm overflow-hidden break-words">
          {content ? (
            <MarkdownRenderer content={content} />
          ) : (
            <div className="flex gap-1 items-center h-5">
              <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          )}
          {status && (
            <div className="mt-2 flex items-center gap-2 text-xs text-blue-500 border-t border-blue-100 pt-2">
              <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              {status}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ChatWindow({ messages, streaming, streamingContent, streamingStatus, onCopy, onRegenerate, onFeedback }: Props) {
  const { t } = useTranslation()
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastUserMsgRef = useRef<HTMLDivElement>(null)
  const prevMsgCountRef = useRef(0)

  // Only scroll when a NEW user message is added — scroll to show the question,
  // then stay still while the answer generates below (Gemini-style behaviour).
  useEffect(() => {
    const newCount = messages.length
    const prevCount = prevMsgCountRef.current
    prevMsgCountRef.current = newCount

    if (newCount > prevCount) {
      const lastMsg = messages[newCount - 1]
      if (lastMsg?.role === 'user') {
        // Scroll the user question into view; answer will appear below without forcing scroll
        requestAnimationFrame(() => {
          lastUserMsgRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      } else {
        // An assistant message was saved (streaming finished) — don't auto-scroll
      }
    }
  }, [messages])
  // Intentionally no effect on streamingContent — don't scroll while streaming

  if (messages.length === 0 && !streaming) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Cpu size={32} className="text-blue-600" />
          </div>
          <h2 className="text-xl font-semibold text-slate-700 mb-2">Cortex</h2>
          <p className="text-slate-400 text-sm">{t('chat.startPrompt')}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2 max-w-md">
            {[
              t('chat.suggestion1'),
              t('chat.suggestion2'),
              t('chat.suggestion3'),
              t('chat.suggestion4'),
            ].map((hint) => (
              <span
                key={hint}
                className="bg-white border border-slate-200 text-slate-500 text-xs px-3 py-1.5 rounded-full cursor-default"
              >
                {hint}
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user')

  return (
    <div data-region="chat" className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-slate-50 pl-4 pr-4 py-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {messages.map((msg, i) => (
          <div key={msg.id} ref={i === lastUserIdx ? lastUserMsgRef : undefined}>
            <MessageBubble
              msg={msg}
              onCopy={onCopy}
              onRegenerate={onRegenerate}
              onFeedback={msg.role === 'assistant' ? onFeedback : undefined}
              isLast={i === messages.length - 1 && msg.role === 'assistant'}
            />
          </div>
        ))}
        {streaming && <StreamingBubble content={streamingContent} status={streamingStatus} />}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
