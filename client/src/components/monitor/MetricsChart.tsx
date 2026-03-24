import { useState, useMemo, useEffect } from 'react'
import ReactECharts from 'echarts-for-react'
import api from '../../lib/api'

type MetricType = 'node' | 'host' | 'disk'
type TimeRange = '24h' | '7d' | '30d'

interface Props {
  type?: MetricType
}

export default function MetricsChart({ type: initialType }: Props) {
  const [type, setType] = useState<MetricType>(initialType || 'host')
  const [range, setRange] = useState<TimeRange>('24h')
  const [data, setData] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(false)

  const hours = range === '24h' ? 24 : range === '7d' ? 168 : 720

  useEffect(() => {
    setLoading(true)
    const url = type === 'node' ? `/monitor/nodes/history?hours=${hours}`
      : type === 'host' ? `/monitor/host/history?hours=${hours}`
      : `/monitor/disk/history?days=${range === '24h' ? 1 : range === '7d' ? 7 : 30}`

    api.get(url).then(({ data: d }) => setData(d || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [type, range, hours])

  const chartOption = useMemo(() => {
    if (data.length === 0) return null

    const formatTime = (ts: string) => {
      const d = new Date(ts)
      return range === '24h'
        ? `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
        : `${(d.getMonth() + 1)}/${d.getDate()} ${d.getHours()}:00`
    }

    if (type === 'host') {
      const times = data.map((d: Record<string, unknown>) => formatTime(d.collected_at as string))
      return {
        tooltip: { trigger: 'axis' },
        legend: { data: ['Load 1m', 'Mem Used (GB)', 'Net RX (MB)', 'Net TX (MB)'], bottom: 0, textStyle: { fontSize: 10 } },
        grid: { top: 20, right: 20, bottom: 50, left: 50 },
        xAxis: { type: 'category', data: times, axisLabel: { fontSize: 9, rotate: 30 } },
        yAxis: { type: 'value', axisLabel: { fontSize: 9 } },
        series: [
          { name: 'Load 1m', type: 'line', data: data.map((d: Record<string, unknown>) => d.load_1m), smooth: true, lineStyle: { width: 1.5 } },
          { name: 'Mem Used (GB)', type: 'line', data: data.map((d: Record<string, unknown>) => ((d.mem_used_mb as number || 0) / 1024).toFixed(1)), smooth: true, lineStyle: { width: 1.5 } },
          { name: 'Net RX (MB)', type: 'line', data: data.map((d: Record<string, unknown>) => d.net_rx_mb), smooth: true, lineStyle: { width: 1 } },
          { name: 'Net TX (MB)', type: 'line', data: data.map((d: Record<string, unknown>) => d.net_tx_mb), smooth: true, lineStyle: { width: 1 } },
        ],
      }
    }

    if (type === 'node') {
      // Group by node_name
      const nodes = [...new Set(data.map((d: Record<string, unknown>) => d.node_name as string))]
      const times = [...new Set(data.map((d: Record<string, unknown>) => formatTime(d.collected_at as string)))]
      return {
        tooltip: { trigger: 'axis' },
        legend: { data: nodes.map(n => `${n} CPU%`), bottom: 0, textStyle: { fontSize: 10 } },
        grid: { top: 20, right: 20, bottom: 50, left: 50 },
        xAxis: { type: 'category', data: times, axisLabel: { fontSize: 9, rotate: 30 } },
        yAxis: { type: 'value', max: 100, axisLabel: { fontSize: 9 } },
        series: nodes.map(node => ({
          name: `${node} CPU%`,
          type: 'line',
          data: times.map(t => {
            const row = data.find((d: Record<string, unknown>) =>
              d.node_name === node && formatTime(d.collected_at as string) === t
            )
            return row ? (row as Record<string, unknown>).cpu_req_pct : null
          }),
          smooth: true,
          lineStyle: { width: 1.5 },
        })),
      }
    }

    // disk
    const mounts = [...new Set(data.map((d: Record<string, unknown>) => d.mount as string))]
    const times = [...new Set(data.map((d: Record<string, unknown>) => formatTime(d.collected_at as string)))]
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: mounts, bottom: 0, textStyle: { fontSize: 10 } },
      grid: { top: 20, right: 20, bottom: 50, left: 50 },
      xAxis: { type: 'category', data: times, axisLabel: { fontSize: 9, rotate: 30 } },
      yAxis: { type: 'value', max: 100, axisLabel: { fontSize: 9 } },
      series: mounts.map(m => ({
        name: m,
        type: 'line',
        data: times.map(t => {
          const row = data.find((d: Record<string, unknown>) =>
            d.mount === m && formatTime(d.collected_at as string) === t
          )
          return row ? (row as Record<string, unknown>).use_pct : null
        }),
        smooth: true,
        lineStyle: { width: 1.5 },
      })),
    }
  }, [data, type, range])

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-medium text-slate-700">趨勢圖</span>
        <div className="ml-auto flex gap-1">
          {(['host', 'node', 'disk'] as MetricType[]).map(t => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`text-xs px-2 py-1 rounded ${type === t ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {t === 'host' ? '主機負載' : t === 'node' ? '節點' : '磁碟'}
            </button>
          ))}
          <span className="w-px bg-slate-200 mx-1" />
          {(['24h', '7d', '30d'] as TimeRange[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`text-xs px-2 py-1 rounded ${range === r ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {loading && <div className="h-48 animate-pulse bg-slate-50 rounded" />}
      {!loading && chartOption && (
        <ReactECharts option={chartOption} style={{ height: 220 }} opts={{ renderer: 'svg' }} />
      )}
      {!loading && !chartOption && (
        <div className="text-xs text-slate-400 text-center py-12">尚無歷史資料</div>
      )}
    </div>
  )
}
