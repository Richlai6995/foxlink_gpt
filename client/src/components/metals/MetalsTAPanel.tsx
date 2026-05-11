/**
 * MetalsTAPanel — 技術分析(TA)解讀 drawer
 *
 * 跟 MetalsAiPanel 差別:
 * - 不是泛用問答,而是吃 chart 當前 context(metal/days/indicators)直接給 TA 解讀
 * - 開啟即自動呼叫 /api/metals/ai-ta-analyze
 * - SSE streaming 顯示 LLM 回應
 * - chart 設定變(換金屬/換區間/勾指標)→ 點重新分析按鈕重打
 */
import { Sparkles, RefreshCw, Loader2, X, AlertCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const STORAGE_TOKEN_KEY = 'token'

interface Props {
  isOpen: boolean
  onClose: () => void
  metal: string                // 'CU' / 'AU' / ...
  days: number                 // 30 / 90 / 180 / 365 / 3650
  viewDate?: string            // 'YYYY-MM-DD',結束日
  indicators: string[]         // ['MA20','MA60','RSI14'...]
}

export default function MetalsTAPanel({ isOpen, onClose, metal, days, viewDate, indicators }: Props) {
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [meta, setMeta] = useState<{ bars?: number; input_tokens?: number; output_tokens?: number } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const run = async () => {
    if (streaming) return
    setAnswer(''); setError(''); setMeta(null)
    setStreaming(true)
    abortRef.current = new AbortController()
    try {
      const token = localStorage.getItem(STORAGE_TOKEN_KEY) || ''
      const resp = await fetch('/api/metals/ai-ta-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ metal, days, end_date: viewDate || undefined, indicators }),
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
                setAnswer(prev => prev + payload.text)
              } else if (event === 'done') {
                setMeta({
                  bars: payload.bars_analyzed,
                  input_tokens: payload.input_tokens,
                  output_tokens: payload.output_tokens,
                })
              } else if (event === 'error') {
                setError(payload.error || '未知錯誤')
              }
            } catch (_) { /* skip */ }
          }
          sep = buffer.indexOf('\n\n')
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setError(e?.message || String(e))
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  // 開啟時自動 run 一次
  useEffect(() => {
    if (isOpen) {
      run()
    } else {
      if (abortRef.current) { abortRef.current.abort(); abortRef.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // 自動捲到底
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
    }
  }, [answer])

  // ESC 關閉
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div
        className="fixed right-0 top-0 bottom-0 w-[480px] max-w-[95vw] bg-white shadow-2xl z-50 flex flex-col border-l border-violet-200"
        style={{ animation: 'slideInRight 200ms ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-gradient-to-r from-violet-50 to-purple-50 flex-shrink-0">
          <Sparkles size={16} className="text-violet-600" />
          <h3 className="text-sm font-bold text-slate-800">AI 技術分析(TA)</h3>
          <span className="text-[10px] text-slate-500 ml-1">{metal} · {days}天 · {indicators.length || 0} 指標</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={run}
              disabled={streaming}
              className="text-[10px] text-slate-600 hover:text-slate-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-white/60 disabled:opacity-40"
              title="用當前 chart 配置重新分析"
            >
              {streaming ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
              {streaming ? '分析中' : '重新分析'}
            </button>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-800 p-1 rounded hover:bg-white/60" title="關閉(Esc)">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Context summary */}
        <div className="px-4 py-2 border-b bg-slate-50 text-[10px] text-slate-500 flex-shrink-0 flex flex-wrap gap-x-3 gap-y-0.5">
          <span>金屬 <b className="font-mono text-slate-700">{metal}</b></span>
          <span>區間 <b className="text-slate-700">{days} 天</b></span>
          <span>結束日 <b className="font-mono text-slate-700">{viewDate || '今日'}</b></span>
          <span>指標 <b className="text-slate-700">{indicators.length ? indicators.join(', ') : '(無)'}</b></span>
          {meta?.bars != null && <span>分析 <b className="text-slate-700">{meta.bars}</b> 筆</span>}
        </div>

        {/* Body */}
        <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}
          {!error && !answer && streaming && (
            <div className="text-center text-slate-400 text-xs py-8 flex flex-col items-center gap-2">
              <Loader2 size={18} className="animate-spin text-violet-400" />
              <span>分析中,大概 5-10 秒…</span>
            </div>
          )}
          {!error && answer && (
            <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
              {answer}
              {streaming && <span className="inline-block w-1 h-3 bg-violet-500 animate-pulse ml-1" />}
            </div>
          )}
        </div>

        {/* Footer disclaimer */}
        <div className="px-4 py-2 border-t bg-amber-50 text-[10px] text-amber-800 leading-relaxed flex-shrink-0">
          ⚠ TA 解讀僅供參考,非投資建議。實際採購決策請以採購主管 / 銀行專員建議為準。
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
