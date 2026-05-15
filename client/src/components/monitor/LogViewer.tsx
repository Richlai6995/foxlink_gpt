import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, Download, X, Calendar, History, Layers } from 'lucide-react'

interface Props {
  type: 'pod' | 'container'
  target: string  // "ns/pod" or container ID
  onClose: () => void
}

type SincePreset = '30m' | '1h' | '6h' | 'today' | 'yesterday' | 'custom'

function getSinceValue(preset: SincePreset, customDate?: string): string {
  if (preset === 'custom' && customDate) return customDate
  if (preset === 'today') {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }
  if (preset === 'yesterday') {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }
  return preset // "30m", "1h", "6h"
}

const PRESET_LABELS: Record<SincePreset, string> = {
  '30m': '最近 30 分鐘',
  '1h': '最近 1 小時',
  '6h': '最近 6 小時',
  'today': '今天',
  'yesterday': '昨天起',
  'custom': '自訂時間',
}

// 把 sincePreset/customDate 轉成 Grafana 時間範圍(from/to 字串)。
// Grafana 接受 ISO datetime(ms epoch 也可),或 relative 字串如 "now-1h"。
function getGrafanaRange(preset: SincePreset, customDate?: string): { from: string; to: string } {
  const now = 'now'
  if (preset === 'custom' && customDate) {
    return { from: new Date(customDate).getTime().toString(), to: now }
  }
  if (preset === 'today') {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    return { from: d.getTime().toString(), to: now }
  }
  if (preset === 'yesterday') {
    const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0)
    return { from: d.getTime().toString(), to: now }
  }
  // 30m / 1h / 6h → Grafana relative
  return { from: `now-${preset}`, to: now }
}

// pod 名稱 → deployment(app label)。
// K8s ReplicaSet pod 命名:<deployment>-<rs-hash 9~10 hex>-<random 5 alnum>
// e.g. "foxlink-gpt-6dc5f6c57b-4zbnl" → "foxlink-gpt"。沒命中(StatefulSet / static pod)就回 null,
// 由 caller 改用 pod 精確匹配,放棄跨重建追蹤。
function podNameToApp(podName: string): string | null {
  const m = podName.match(/^(.+)-[a-f0-9]{8,10}-[a-z0-9]{5}$/)
  return m ? m[1] : null
}

// Aggregate mode 下 server 把每行加 [pod-suffix] 前綴,這裡抽出來給 UI 著色
function parsePodPrefix(line: string): { podSuffix: string; rest: string } | null {
  const m = line.match(/^\[([a-z0-9?]+)\] (.*)$/)
  if (!m) return null
  return { podSuffix: m[1], rest: m[2] }
}

// pod-suffix → 固定顏色(hash → palette index)。同 pod 永遠同色,user 看慣不會跳。
const POD_COLORS = [
  'text-cyan-400', 'text-purple-400', 'text-pink-400', 'text-emerald-400',
  'text-yellow-400', 'text-orange-400', 'text-rose-400', 'text-indigo-400',
]
function podColor(suffix: string): string {
  let h = 0
  for (let i = 0; i < suffix.length; i++) h = (h * 31 + suffix.charCodeAt(i)) | 0
  return POD_COLORS[Math.abs(h) % POD_COLORS.length]
}

export default function LogViewer({ type, target, onClose }: Props) {
  const [lines, setLines] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [sincePreset, setSincePreset] = useState<SincePreset>('1h')
  const [customDate, setCustomDate] = useState('')
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [streaming, setStreaming] = useState(true)
  const [aggregateMode, setAggregateMode] = useState(false)
  const [jumpToIdx, setJumpToIdx] = useState<number | null>(null)
  const [flashIdx, setFlashIdx] = useState<number | null>(null)
  const [grafana, setGrafana] = useState<{ baseUrl: string; dataSource: string }>({ baseUrl: '', dataSource: 'Loki' })
  const [grafanaLoaded, setGrafanaLoaded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  const token = localStorage.getItem('token')

  useEffect(() => {
    fetch('/api/monitor/grafana-config', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setGrafana({ baseUrl: d.baseUrl || '', dataSource: d.dataSource || 'Loki' }))
      .catch(() => {})
      .finally(() => setGrafanaLoaded(true))
  }, [token])

  // 從 target 解析 ns/pod/app(只對 type='pod' 有意義)
  const [targetNs, targetPod] = type === 'pod' ? target.split('/') : ['', '']
  const targetApp = targetPod ? podNameToApp(targetPod) : null
  // 切換 aggregate mode 的入口只在「pod 名解得出 deployment」時出現(static pod / StatefulSet 不支援)
  const canAggregate = type === 'pod' && !!targetApp && !!grafana.baseUrl

  // 組 Grafana Explore deeplink:用 app label 跨 pod 重建查 Loki。
  // pod 目標 "ns/pod" → 解析出 ns + app(failback pod 精確)。container 目標不支援(沒 K8s label)。
  const grafanaUrl = (() => {
    if (!grafana.baseUrl || type !== 'pod') return ''
    const [ns, pod] = target.split('/')
    if (!ns || !pod) return ''
    const app = podNameToApp(pod)
    const expr = app
      ? `{namespace="${ns}",app="${app}"}`
      : `{namespace="${ns}",pod="${pod}"}`
    const range = getGrafanaRange(sincePreset, customDate)
    const left = {
      datasource: grafana.dataSource,
      queries: [{ refId: 'A', expr, datasource: { type: 'loki', uid: grafana.dataSource } }],
      range: { from: range.from, to: range.to },
    }
    const base = grafana.baseUrl.replace(/\/$/, '')
    return `${base}/explore?orgId=1&left=${encodeURIComponent(JSON.stringify(left))}`
  })()

  const startStream = useCallback(() => {
    if (esRef.current) esRef.current.close()

    const since = getSinceValue(sincePreset, customDate)
    const params = new URLSearchParams({ token: token || '', since })
    // Loki 模式優先(只對 pod 生效;container target 沒 K8s label 沒 Loki 入口)
    // 跨 pod 重建可看歷史,kubelet pod log 只剩活著的 pod 那段。
    // grafana.baseUrl 沒設(代表沒部 Loki)就退回 kubelet endpoint。
    // aggregate=true 走新 /loki/app endpoint,跨 deployment 多 pod 合併
    const useLoki = type === 'pod' && !!grafana.baseUrl
    const useAggregate = aggregateMode && canAggregate && targetApp
    const url = type === 'pod'
      ? (useAggregate
          ? `/api/monitor/logs/loki/app/${targetNs}/${targetApp}?${params}`
          : useLoki
            ? `/api/monitor/logs/loki/pod/${target}?${params}`
            : `/api/monitor/logs/pod/${target}?${params}`)
      : `/api/monitor/logs/container/${target}?${params}`

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
            return next.length > 50000 ? next.slice(-50000) : next
          })
        }
      } catch {}
    }

    es.onerror = () => {
      setLines(prev => [...prev, '--- Connection lost ---'])
      setStreaming(false)
      es.close()
    }
  }, [type, target, sincePreset, customDate, token, grafana.baseUrl, aggregateMode, canAggregate, targetApp, targetNs])

  useEffect(() => {
    if (!grafanaLoaded) return  // 等 grafana config 確認後再 stream,避免 kubelet→Loki 切換清空畫面
    startStream()
    return () => { esRef.current?.close() }
  }, [startStream, grafanaLoaded])

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  // 搜尋結果點擊 → 清除搜尋 → 跳到原始行
  useEffect(() => {
    if (jumpToIdx === null) return
    // 等 DOM 更新（search 清除後重新渲染全部行）
    requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector(`[data-idx="${jumpToIdx}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setFlashIdx(jumpToIdx)
        setTimeout(() => setFlashIdx(null), 1500)
      }
      setJumpToIdx(null)
      setAutoScroll(false)
    })
  }, [jumpToIdx, search])

  const handleSearchResultClick = (originalIdx: number) => {
    setSearch('')        // 清除搜尋，恢復全部行
    setJumpToIdx(originalIdx)
  }

  const handleClose = useCallback(() => {
    esRef.current?.close()
    onClose()
  }, [onClose])

  // Esc 鍵關閉
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose])

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

  // 格式化 K8s/Docker timestamp：將 ISO 前綴轉為可讀格式
  const formatLine = (line: string) => {
    // K8s timestamps: "2026-04-01T07:30:00.123456789Z [Gemini] ..."
    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?Z?\s(.*)/)
    if (tsMatch) {
      const ts = tsMatch[1].replace('T', ' ')
      const rest = tsMatch[3]
      return { ts, rest }
    }
    return { ts: '', rest: line }
  }

  // 搜尋時保留原始 index
  const searchResults = search
    ? lines.map((l, i) => ({ line: l, origIdx: i }))
        .filter(({ line }) => line.toLowerCase().includes(search.toLowerCase()))
    : null

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6">
      <div className="bg-slate-900 rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700 flex-wrap">
          <span className="text-sm font-medium text-white truncate">
            {type === 'pod'
              ? (aggregateMode && targetApp ? `合併: ${targetNs}/${targetApp}` : `Pod ${target}`)
              : `Container ${target.slice(0, 12)}`}
          </span>
          {streaming && (
            <span className="flex items-center gap-1 text-[10px] text-green-400">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              LIVE
            </span>
          )}
          <span className="text-[10px] text-slate-500">
            {searchResults
              ? `${searchResults.length.toLocaleString()} 筆符合 / ${lines.length.toLocaleString()} 行`
              : `${lines.length.toLocaleString()} 行`}
          </span>
          <div className="flex-1" />
          <div className="flex items-center gap-2 flex-wrap">
            {/* 時間範圍選擇 */}
            <div className="flex items-center gap-1">
              {(['30m', '1h', '6h', 'today'] as SincePreset[]).map(p => (
                <button
                  key={p}
                  onClick={() => { setSincePreset(p); setShowDatePicker(false) }}
                  className={`text-[11px] px-2 py-0.5 rounded ${
                    sincePreset === p && !showDatePicker
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
              <button
                onClick={() => setShowDatePicker(!showDatePicker)}
                className={`text-[11px] px-2 py-0.5 rounded flex items-center gap-1 ${
                  showDatePicker || sincePreset === 'custom'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
                title="自訂日期時間"
              >
                <Calendar size={11} />
                自訂
              </button>
            </div>
            {showDatePicker && (
              <input
                type="datetime-local"
                value={customDate ? customDate.slice(0, 16) : ''}
                onChange={e => {
                  if (e.target.value) {
                    setCustomDate(new Date(e.target.value).toISOString())
                    setSincePreset('custom')
                  }
                }}
                className="text-[11px] bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-white focus:outline-none focus:border-blue-500"
              />
            )}
            {/* 搜尋 */}
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜尋..."
                className="text-xs bg-slate-800 border border-slate-600 rounded pl-6 pr-2 py-1 w-36 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            {canAggregate && (
              <button
                onClick={() => setAggregateMode(m => !m)}
                className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded ${
                  aggregateMode
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
                title={`合併同 deployment(${targetApp})所有 pod 的 log,每行加 [pod-suffix] 標示。再按一次回單一 pod。`}
              >
                <Layers size={11} />
                {aggregateMode ? '單一 pod' : `合併 ${targetApp}`}
              </button>
            )}
            {grafanaUrl && (
              <a
                href={grafanaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-amber-600 text-white hover:bg-amber-500"
                title="跨 pod 重建的歷史 log(Grafana + Loki,保留 30 天)。kubelet 的 pod log 只剩活著的 pod 那段。"
              >
                <History size={11} />
                Loki 歷史
              </a>
            )}
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
          {searchResults ? (
            /* 搜尋模式：只顯示匹配行，可點擊跳到原始位置 */
            <>
              <div className="text-[10px] text-blue-400 mb-2 sticky top-0 bg-slate-900 py-1 z-10">
                點擊任一行可跳到完整 log 中的位置
              </div>
              {searchResults.map(({ line, origIdx }) => {
                const podInfo = aggregateMode ? parsePodPrefix(line) : null
                const baseLine = podInfo ? podInfo.rest : line
                const { ts, rest } = formatLine(baseLine)
                return (
                  <div
                    key={origIdx}
                    onClick={() => handleSearchResultClick(origIdx)}
                    className={`whitespace-pre-wrap break-all leading-5 cursor-pointer rounded px-1 -mx-1
                      hover:bg-blue-900/40 ${highlightLine(line)} bg-yellow-900/20`}
                  >
                    <span className="text-blue-400/60 mr-2 select-none text-[10px]">#{origIdx + 1}</span>
                    {podInfo && (
                      <span className={`font-bold mr-2 select-all ${podColor(podInfo.podSuffix)}`}>
                        [{podInfo.podSuffix}]
                      </span>
                    )}
                    {ts && <span className="text-slate-500 select-all mr-2">{ts}</span>}
                    {rest}
                  </div>
                )
              })}
              {searchResults.length === 0 && (
                <div className="text-slate-600 text-center py-8">無符合的行</div>
              )}
            </>
          ) : (
            /* 一般模式：顯示全部行 */
            <>
              {lines.map((line, i) => {
                const podInfo = aggregateMode ? parsePodPrefix(line) : null
                const baseLine = podInfo ? podInfo.rest : line
                const { ts, rest } = formatLine(baseLine)
                return (
                  <div
                    key={i}
                    data-idx={i}
                    className={`whitespace-pre-wrap break-all leading-5 ${highlightLine(line)} ${
                      flashIdx === i ? 'bg-blue-700/50 transition-colors duration-700' : ''
                    }`}
                  >
                    {podInfo && (
                      <span className={`font-bold mr-2 select-all ${podColor(podInfo.podSuffix)}`}>
                        [{podInfo.podSuffix}]
                      </span>
                    )}
                    {ts && <span className="text-slate-500 select-all mr-2">{ts}</span>}
                    {rest}
                  </div>
                )
              })}
              {lines.length === 0 && (
                <div className="text-slate-600 text-center py-8">等待 log 資料...</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
