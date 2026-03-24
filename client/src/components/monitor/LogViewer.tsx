import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, Download, Square } from 'lucide-react'

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

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.done) {
          setLines(prev => [...prev, `--- Process exited (code ${data.exitCode}) ---`])
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
            // Keep max 5000 lines
            return next.length > 5000 ? next.slice(-5000) : next
          })
        }
      } catch {}
    }

    es.onerror = () => {
      setLines(prev => [...prev, '--- Connection lost ---'])
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
    // Color-code log levels
    if (/\bERROR\b|\bFATAL\b|\bPANIC\b/i.test(line)) return 'text-red-500'
    if (/\bWARN\b/i.test(line)) return 'text-yellow-600'
    if (/\bDEBUG\b/i.test(line)) return 'text-slate-400'
    return 'text-slate-300'
  }

  const filteredLines = search
    ? lines.filter(l => l.toLowerCase().includes(search.toLowerCase()))
    : lines

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">
          Log: {type === 'pod' ? `Pod ${target}` : `Container ${target.slice(0, 12)}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜尋..."
              className="text-xs border rounded pl-6 pr-2 py-1 w-40"
            />
          </div>
          <select
            value={tail}
            onChange={e => setTail(Number(e.target.value))}
            className="text-xs border rounded px-2 py-1"
          >
            <option value={50}>50 行</option>
            <option value={100}>100 行</option>
            <option value={500}>500 行</option>
            <option value={1000}>1000 行</option>
          </select>
          <button onClick={downloadLog} className="p-1 text-slate-400 hover:text-blue-600" title="下載 log">
            <Download size={14} />
          </button>
          <button
            onClick={() => { esRef.current?.close(); onClose() }}
            className="p-1 text-slate-400 hover:text-red-600"
            title="停止 & 關閉"
          >
            <Square size={14} />
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="bg-slate-900 font-mono text-xs p-3 overflow-auto"
        style={{ height: 300 }}
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
  )
}
