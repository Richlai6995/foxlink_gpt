import { useState, useEffect, useMemo } from 'react'
import { Building2 } from 'lucide-react'
import ReactECharts from 'echarts-for-react'
import api from '../../lib/api'

interface DeptSnapshot {
  snapshot_id: number | null
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

    // Step 1: group by snapshot_id (same batch = exact same snapshot_id).
    // Fallback: 舊資料無 snapshot_id 時用 1-minute window 作為 key。
    const snapGroups: Record<string, { ts: number; values: Record<string, number> }> = {}
    for (const d of data) {
      const key = d.snapshot_id != null
        ? String(d.snapshot_id)
        : String(Math.floor(new Date(d.collected_at).getTime() / 60000))
      const ts = d.snapshot_id != null ? d.snapshot_id * 1000 : new Date(d.collected_at).getTime()
      const dimValue = d[dimension] || 'Unknown'
      if (!snapGroups[key]) snapGroups[key] = { ts, values: {} }
      // 同 snapshot 同 dimValue 直接取（不 SUM — 每個 key 對應唯一 count）
      snapGroups[key].values[dimValue] = (snapGroups[key].values[dimValue] || 0) + d.user_count
    }

    // Step 2: 每 5 分鐘顯示一個 bucket，取最新的 snapshot。
    const bucketLatest: Record<string, { ts: number; values: Record<string, number> }> = {}
    for (const { ts, values } of Object.values(snapGroups)) {
      const dt = new Date(ts)
      const bucket = `${dt.getMonth() + 1}/${dt.getDate()} ${dt.getHours().toString().padStart(2, '0')}:${(Math.floor(dt.getMinutes() / 5) * 5).toString().padStart(2, '0')}`
      if (!bucketLatest[bucket] || ts > bucketLatest[bucket].ts) {
        bucketLatest[bucket] = { ts, values }
      }
    }

    const seriesMap: Record<string, Record<string, number>> = {}
    for (const [bucket, { values }] of Object.entries(bucketLatest)) {
      for (const [dimValue, count] of Object.entries(values)) {
        if (!seriesMap[dimValue]) seriesMap[dimValue] = {}
        seriesMap[dimValue][bucket] = count
      }
    }

    const times = Object.keys(bucketLatest).sort()
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
            <option value={6}>6h</option>
            <option value={12}>12h</option>
            <option value={24}>24h</option>
            <option value={72}>3d</option>
            <option value={168}>7d</option>
            <option value={336}>14d</option>
            <option value={720}>30d</option>
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
