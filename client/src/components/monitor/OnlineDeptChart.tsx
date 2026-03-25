import { useState, useEffect, useMemo } from 'react'
import { Building2 } from 'lucide-react'
import ReactECharts from 'echarts-for-react'
import api from '../../lib/api'

interface DeptSnapshot {
  collected_at: string
  profit_center: string
  org_section: string
  org_group_name: string
  dept_code: string
  user_count: number
}

type Dimension = 'profit_center' | 'org_section' | 'org_group_name'

export default function OnlineDeptChart() {
  const [data, setData] = useState<DeptSnapshot[]>([])
  const [hours, setHours] = useState(24)
  const [dimension, setDimension] = useState<Dimension>('profit_center')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get(`/monitor/online-dept/history?hours=${hours}`)
      .then(({ data }) => setData(data || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [hours])

  const chartOption = useMemo(() => {
    if (data.length === 0) return null

    // Group by time buckets (round to 5 min) and dimension value
    const timeSet = new Set<string>()
    const seriesMap: Record<string, Record<string, number>> = {}

    for (const d of data) {
      const t = new Date(d.collected_at)
      const timeKey = `${t.getMonth() + 1}/${t.getDate()} ${t.getHours().toString().padStart(2, '0')}:${(Math.floor(t.getMinutes() / 5) * 5).toString().padStart(2, '0')}`
      timeSet.add(timeKey)

      const dimValue = d[dimension] || 'Unknown'
      if (!seriesMap[dimValue]) seriesMap[dimValue] = {}
      seriesMap[dimValue][timeKey] = (seriesMap[dimValue][timeKey] || 0) + d.user_count
    }

    const times = Array.from(timeSet).sort()
    const series = Object.entries(seriesMap).map(([name, timeData]) => ({
      name,
      type: 'line' as const,
      smooth: true,
      data: times.map(t => timeData[t] || 0),
      emphasis: { focus: 'series' as const },
    }))

    return {
      tooltip: { trigger: 'axis' as const },
      legend: {
        type: 'scroll' as const,
        bottom: 0,
        textStyle: { fontSize: 10 },
      },
      grid: { top: 20, right: 20, bottom: 40, left: 40 },
      xAxis: {
        type: 'category' as const,
        data: times,
        axisLabel: { fontSize: 9, rotate: 30 },
      },
      yAxis: { type: 'value' as const, minInterval: 1, axisLabel: { fontSize: 10 } },
      series,
    }
  }, [data, dimension])

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Building2 size={14} className="text-blue-500" />
        <span className="text-sm font-medium text-slate-700">部門上線人數趨勢</span>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={dimension}
            onChange={e => setDimension(e.target.value as Dimension)}
            className="text-xs border rounded px-1.5 py-1"
          >
            <option value="profit_center">利潤中心</option>
            <option value="org_section">事業處</option>
            <option value="org_group_name">事業群</option>
          </select>
          <select
            value={hours}
            onChange={e => setHours(Number(e.target.value))}
            className="text-xs border rounded px-1.5 py-1"
          >
            <option value={6}>6 小時</option>
            <option value={12}>12 小時</option>
            <option value={24}>24 小時</option>
            <option value={72}>3 天</option>
            <option value={168}>7 天</option>
          </select>
        </div>
      </div>

      {loading && <div className="animate-pulse h-48 bg-slate-50 rounded" />}
      {!loading && chartOption && (
        <ReactECharts option={chartOption} style={{ height: 250 }} opts={{ renderer: 'svg' }} />
      )}
      {!loading && !chartOption && (
        <div className="text-xs text-slate-400 text-center py-8">尚無部門統計資料（資料每 5 分鐘收集一次）</div>
      )}
    </div>
  )
}
