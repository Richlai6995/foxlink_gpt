import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, Download, X } from 'lucide-react'

interface Props {
  type: 'pod' | 'container'
  target: string  // "ns/pod" or container ID
  onClose: () => void
}

export default function LogViewer({ type, target, onClose }: Props) {
  const [lines, setLines] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [tail, setTail] = useState(100)
  const [autoScroll, setAutoScroll] = useState(true)
  const [streaming, setStreaming] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  const token = localStorage.getItem('token')

  const startStream = useCallback(() => {
    if (esRef.current) esRef.current.close()

    const url = type === 'pod'
      ? `/api/monitor/logs/pod/${target}?tail=${tail}&token=${token}`
      : `/api/monitor/logs/container/${target}?tail=${tail}&token=${token}`

    const es = new EventSource(url)
    esRef.current = es
    setLines([])
    setStreaming(true)

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.done) {
          setStreaming(false)
          es.close()
          return
        }
        if (data.error) {
          setLines(prev => [...prev, `[ERROR] ${data.error}`])
          return
        }
        if (data.line) {
          setLines(prev => {
            const next = [...prev, data.line]
            return next.length > 5000 ? next.slice(-5000) : next
          })
        }
      } catch {}
    }

    es.onerror = () => {
      setLines(prev => [...prev, '--- Connection lost ---'])
      setStreaming(false)
      es.close()
    }
  }, [type, target, tail, token])

  useEffect(() => {
    startStream()
    return () => { esRef.current?.close() }
  }, [startStream])

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  const handleClose = () => {
    esRef.current?.close()
    onClose()
  }

  const downloadLog = () => {
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `log-${target.replace(/\//g, '-')}-${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const highlightLine = (line: string) => {
    if (/\bERROR\b|\bFATAL\b|\bPANIC\b/i.test(line)) return 'text-red-400'
    if (/\bWARN\b/i.test(line)) return 'text-yellow-400'
    if (/\bDEBUG\b/i.test(line)) return 'text-slate-500'
    return 'text-slate-300'
  }

  const filteredLines = search
    ? lines.filter(l => l.toLowerCase().includes(search.toLowerCase()))
    : lines

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6" onClick={handleClose}>
      <div className="bg-slate-900 rounded-xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700">
          <span className="text-sm font-medium text-white truncate flex-1">
            {type === 'pod' ? `Pod ${target}` : `Container ${target.slice(0, 12)}`}
          </span>
          {streaming && (
            <span className="flex items-center gap-1 text-[10px] text-green-400">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              LIVE
            </span>
          )}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜尋..."
                className="text-xs bg-slate-800 border border-slate-600 rounded pl-6 pr-2 py-1 w-36 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <select
              value={tail}
              onChange={e => setTail(Number(e.target.value))}
              className="text-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white"
            >
              <option value={50}>50 行</option>
              <option value={100}>100 行</option>
              <option value={500}>500 行</option>
              <option value={1000}>1000 行</option>
            </select>
            <button onClick={downloadLog} className="p-1 text-slate-400 hover:text-blue-400" title="下載 log">
              <Download size={14} />
            </button>
            <button onClick={handleClose} className="p-1 text-slate-400 hover:text-red-400" title="關閉">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Log content */}
        <div
          ref={containerRef}
          className="flex-1 font-mono text-xs p-3 overflow-auto min-h-0"
          onScroll={() => {
            if (!containerRef.current) return
            const { scrollTop, scrollHeight, clientHeight } = containerRef.current
            setAutoScroll(scrollHeight - scrollTop - clientHeight < 50)
          }}
        >
          {filteredLines.map((line, i) => {
            const isSearchMatch = search && line.toLowerCase().includes(search.toLowerCase())
            return (
              <div
                key={i}
                className={`whitespace-pre-wrap break-all leading-5 ${highlightLine(line)} ${isSearchMatch ? 'bg-yellow-900/30' : ''}`}
              >
                {line}
              </div>
            )
          })}
          {filteredLines.length === 0 && (
            <div className="text-slate-600 text-center py-8">
              {search ? 'No matching lines' : 'Waiting for log data...'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
