/**
 * MetalsAiPanel — 右側滑出 drawer:AI 分析(streaming SSE,session-only)
 * 限縮在金屬報價/新聞/趨勢/宏觀,後端強制 system prompt + 預塞 RAG。
 *
 * 改成 drawer 是為了騰出右欄空間給新聞顯示(2026-05-10 user 反饋)
 */
import { Sparkles, Send, RefreshCw, Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import api from '../../lib/api'

interface QA {
  question: string
  answer: string
  done: boolean
  error?: string
  model?: string
}

interface LlmModelOption {
  key: string
  name: string
  api_model: string
  description?: string
  provider_type?: string
}

const STORAGE_TOKEN_KEY = 'token'

interface Props {
  isOpen: boolean
  onClose: () => void
}

// 從 model 清單挑「預設選誰」— 優先 Pro,排除 image/embed/rerank/tts/stt
function pickDefaultModelKey(models: LlmModelOption[]): string {
  if (!models || models.length === 0) return 'pro'
  const isExcluded = (s: string) => /image|embed|rerank|tts|stt/i.test(s)
  const pros = models.filter(m => /pro/i.test(m.key + ' ' + m.name) && !isExcluded(m.key + ' ' + m.name))
  if (pros.length > 0) return pros[0].key
  const firstChat = models.find(m => !isExcluded(m.key + ' ' + m.name))
  return firstChat?.key || models[0].key
}

export default function MetalsAiPanel({ isOpen, onClose }: Props) {
  const [input, setInput] = useState('')
  const [qa, setQa] = useState<QA[]>([])
  const [streaming, setStreaming] = useState(false)
  const [models, setModels] = useState<LlmModelOption[]>([])
  const [modelKey, setModelKey] = useState<string>(() => localStorage.getItem('metals_ai_model') || '')
  useEffect(() => { if (modelKey) localStorage.setItem('metals_ai_model', modelKey) }, [modelKey])

  useEffect(() => {
    api.get('/chat/models').then(r => {
      const list = Array.isArray(r.data) ? r.data : []
      const chatOnly = list.filter((m: LlmModelOption) => !/image|embed|rerank|tts|stt/i.test((m.key || '') + ' ' + (m.name || '')))
      setModels(chatOnly)
      if (!modelKey || !chatOnly.find((m: LlmModelOption) => m.key === modelKey)) {
        setModelKey(pickDefaultModelKey(chatOnly))
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedModel = useMemo(() => models.find(m => m.key === modelKey), [models, modelKey])
  const abortRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  // 開啟時 focus 輸入框
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100)
    } else {
      // 關閉時中止 streaming
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
    }
  }, [isOpen])

  // 自動捲到底
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
    }
  }, [qa])

  // ESC 關閉
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const ask = async () => {
    const q = input.trim()
    if (!q || streaming) return
    setInput('')
    const idx = qa.length
    setQa(prev => [...prev, { question: q, answer: '', done: false }])
    setStreaming(true)
    abortRef.current = new AbortController()
    try {
      const token = localStorage.getItem(STORAGE_TOKEN_KEY) || ''
      const resp = await fetch('/api/metals/ai-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ question: q, model: modelKey }),
        signal: abortRef.current.signal,
      })
      if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => '')
        throw new Error(`${resp.status} ${text || resp.statusText}`)
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let sep = buffer.indexOf('\n\n')
        while (sep !== -1) {
          const block = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          let event = 'message'
          let data = ''
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7).trim()
            else if (line.startsWith('data: ')) data += (data ? '\n' : '') + line.slice(6)
          }
          if (data) {
            try {
              const payload = JSON.parse(data)
              if (event === 'chunk' && payload.text) {
                setQa(prev => {
                  const next = [...prev]
                  next[idx] = { ...next[idx], answer: (next[idx].answer || '') + payload.text }
                  return next
                })
              } else if (event === 'done') {
                setQa(prev => {
                  const next = [...prev]
                  next[idx] = { ...next[idx], done: true, model: payload.model }
                  return next
                })
              } else if (event === 'error') {
                setQa(prev => {
                  const next = [...prev]
                  next[idx] = { ...next[idx], error: payload.error || '錯誤', done: true }
                  return next
                })
              }
            } catch (_) { /* 忽略 */ }
          }
          sep = buffer.indexOf('\n\n')
        }
      }
      setQa(prev => {
        const next = [...prev]
        if (next[idx] && !next[idx].done) next[idx] = { ...next[idx], done: true }
        return next
      })
    } catch (e: any) {
      if (e?.name === 'AbortError') return  // 中止不報錯
      setQa(prev => {
        const next = [...prev]
        if (next[idx]) next[idx] = { ...next[idx], error: e?.message || String(e), done: true }
        return next
      })
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const clear = () => setQa([])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      ask()
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 bottom-0 w-[420px] max-w-[90vw] bg-white shadow-2xl z-50 flex flex-col border-l border-amber-200"
        style={{ animation: 'slideInRight 200ms ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-gradient-to-r from-amber-50 to-yellow-50 flex-shrink-0">
          <Sparkles size={16} className="text-amber-600" />
          <h3 className="text-sm font-bold text-slate-800">AI 分析</h3>
          <span className="text-[10px] text-slate-500">問金屬/新聞/趨勢/宏觀</span>
          <div className="ml-auto flex items-center gap-1">
            {/* 模型選擇 — 從 LLM 模型設定撈 chat 角色的全部模型 */}
            <select
              value={modelKey}
              onChange={e => setModelKey(e.target.value)}
              disabled={streaming || models.length === 0}
              className="text-[10px] border rounded px-1.5 py-1 bg-white text-slate-700 max-w-[160px] disabled:opacity-40"
              title={selectedModel?.description || selectedModel?.api_model || '選擇 LLM 模型'}
            >
              {models.length === 0 && <option value="">載入中…</option>}
              {models.map(m => (
                <option key={m.key} value={m.key}>{m.name}</option>
              ))}
            </select>
            {qa.length > 0 && (
              <button
                onClick={clear}
                className="text-[10px] text-slate-500 hover:text-slate-800 flex items-center gap-1 px-2 py-1 rounded hover:bg-white/60"
              >
                <RefreshCw size={10} /> 清除
              </button>
            )}
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-800 p-1 rounded hover:bg-white/60"
              title="關閉(Esc)"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* QA 對話流 */}
        <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {qa.length === 0 && (
            <div className="text-center text-slate-400 text-xs py-8 leading-relaxed">
              <Sparkles size={20} className="text-amber-300 mx-auto mb-2" />
              開始問問題吧 — 已預載今日報價、宏觀與最新新聞作為上下文。
              <br />
              <span className="text-[10px]">例:銅最近怎麼了?金價還會漲嗎?</span>
            </div>
          )}
          {qa.map((item, i) => (
            <div key={i} className="space-y-1.5">
              <div className="text-[11px] font-medium text-slate-500">Q:</div>
              <div className="text-sm text-slate-700 px-2 py-1.5 bg-slate-50 rounded border-l-2 border-slate-300 whitespace-pre-wrap">
                {item.question}
              </div>
              <div className="text-[11px] font-medium text-amber-700 flex items-center gap-1">
                <Sparkles size={10} /> A:
              </div>
              <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                {item.answer || (item.done ? '(無回應)' : '')}
                {!item.done && <span className="inline-block w-1 h-3 bg-amber-500 animate-pulse ml-1" />}
                {item.error && <span className="text-red-600 mt-1 block">⚠ {item.error}</span>}
              </div>
              {item.done && item.model && (
                <div className="text-[9px] text-slate-400 font-mono mt-0.5">— {item.model}</div>
              )}
            </div>
          ))}
        </div>

        {/* 輸入框 */}
        <div className="border-t p-3 flex-shrink-0 bg-slate-50">
          <div className="border rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-amber-300">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              rows={3}
              placeholder="例:銅最近怎麼了?金價會繼續漲嗎?(Ctrl+Enter 送出)"
              className="w-full px-2 py-1.5 text-sm focus:outline-none resize-none"
              disabled={streaming}
            />
            <div className="flex items-center gap-2 px-2 py-1 bg-slate-50 border-t">
              <span className="text-[10px] text-slate-400">不寫入對話歷史 / 關閉清空</span>
              <button
                onClick={ask}
                disabled={!input.trim() || streaming}
                className="ml-auto flex items-center gap-1 px-3 py-1 text-xs rounded bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
              >
                {streaming ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                {streaming ? '思考中…' : '送出'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  )
}
