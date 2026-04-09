import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { Bot, ThumbsUp, ThumbsDown, Loader2, Maximize2, X } from 'lucide-react'
import MarkdownRenderer from '../MarkdownRenderer'

interface Props {
  ticketId: number
  ticketStatus: string
}

interface RagSource {
  ticket_no: string
  subject: string
  score: number
}

export default function FeedbackAIAnalysis({ ticketId, ticketStatus }: Props) {
  const { t, i18n } = useTranslation()
  const [analyzing, setAnalyzing] = useState(false)
  const [suggestion, setSuggestion] = useState('')
  const [ragSources, setRagSources] = useState<RagSource[]>([])
  const [model, setModel] = useState('')
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)

  const canAnalyze = !['closed'].includes(ticketStatus)

  const startAnalysis = async () => {
    setAnalyzing(true)
    setSuggestion('')
    setRagSources([])
    setError('')

    try {
      const response = await fetch(`/api/feedback/tickets/${ticketId}/ai-analyze?lang=${i18n.language}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'AI 分析失敗' }))
        throw new Error(err.error)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No stream')
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        const lines = text.split('\n').filter(l => l.startsWith('data: '))
        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'chunk') {
              setSuggestion(prev => prev + data.text)
            } else if (data.type === 'done') {
              setRagSources(data.ragSources || [])
              setModel(data.model || '')
            } else if (data.type === 'error') {
              setError(data.error)
            }
          } catch {}
        }
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Bot size={12} /> {t('feedback.aiAnalysis')}
      </h3>

      {!suggestion && !analyzing && canAnalyze && (
        <button
          onClick={startAnalysis}
          className="w-full py-2 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 transition"
        >
          {t('feedback.aiAnalysis')}
        </button>
      )}

      {analyzing && (
        <div className="flex items-center gap-2 text-xs text-blue-400 mb-2">
          <Loader2 size={12} className="animate-spin" /> {t('feedback.aiAnalyzing', 'AI 分析中...')}
        </div>
      )}

      {suggestion && (
        <div className="relative">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-60 overflow-y-auto prose prose-sm prose-gray max-w-none">
            <MarkdownRenderer content={suggestion} className="text-sm" />
          </div>
          <button onClick={() => setExpanded(true)}
            className="absolute top-2 right-2 p-1 rounded bg-white/80 hover:bg-white border border-gray-200 text-gray-500 hover:text-gray-900">
            <Maximize2 size={12} />
          </button>
        </div>
      )}

      {/* 全螢幕 AI 分析 */}
      {expanded && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6" onClick={() => setExpanded(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Bot size={16} /> {t('feedback.aiAnalysis')}</h3>
              <button onClick={() => setExpanded(false)} className="text-gray-400 hover:text-gray-900"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 prose prose-gray max-w-none">
              <MarkdownRenderer content={suggestion} />
            </div>
            {ragSources.length > 0 && (
              <div className="px-6 py-3 border-t border-gray-100 text-xs text-gray-500">
                {t('feedback.refTickets', '參考工單')}：{ragSources.map((s, i) => <span key={i} className="text-blue-600 ml-1">{s.ticket_no}</span>)}
              </div>
            )}
          </div>
        </div>
      )}

      {ragSources.length > 0 && (
        <div className="mt-2 text-xs text-gray-500">
          <span className="font-medium">參考工單：</span>
          {ragSources.map((s, i) => (
            <span key={i} className="text-blue-400 ml-1">{s.ticket_no}</span>
          ))}
        </div>
      )}

      {model && <div className="mt-1 text-[10px] text-gray-400">Model: {model}</div>}

      {error && (
        <div className="mt-2 text-xs text-red-400">{error}</div>
      )}

      {suggestion && !analyzing && (
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => api.put(`/feedback/ai-analyses/0/helpful`, { is_helpful: true }).catch(() => {})}
            className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300"
          >
            <ThumbsUp size={12} />
          </button>
          <button
            onClick={() => api.put(`/feedback/ai-analyses/0/helpful`, { is_helpful: false }).catch(() => {})}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
          >
            <ThumbsDown size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
