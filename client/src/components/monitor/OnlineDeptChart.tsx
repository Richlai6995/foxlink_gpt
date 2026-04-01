import { useState, useEffect, useMemo, useCallback } from 'react'
import { Building2, Download } from 'lucide-react'
import ReactECharts from 'echarts-for-react'
import api from '../../lib/api'

interface DeptSnapshot {
  snapshot_id: number | null
  collected_at: string
  profit_center: string
  profit_center_name: string
  org_section: string
  org_section_name: string
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

  const buildChartData = useCallback(() => {
    if (data.length === 0) return null

    const snapGroups: Record<string, { ts: number; values: Record<string, number> }> = {}
    for (const d of data) {
      const key = d.snapshot_id != null
        ? String(d.snapshot_id)
        : String(Math.floor(new Date(d.collected_at).getTime() / 60000))
      const ts = d.snapshot_id != null ? d.snapshot_id * 1000 : new Date(d.collected_at).getTime()
      const dimValue = dimension === 'profit_center'
        ? (d.profit_center_name || d.profit_center || 'Unknown')
        : dimension === 'org_section'
          ? (d.org_section_name ? `${d.org_section} ${d.org_section_name}` : d.org_section || 'Unknown')
          : (d[dimension] || 'Unknown')
      if (!snapGroups[key]) snapGroups[key] = { ts, values: {} }
      snapGroups[key].values[dimValue] = (snapGroups[key].values[dimValue] || 0) + d.user_count
    }

    const bucketLatest: Record<string, { ts: number; values: Record<string, number> }> = {}
    for (const { ts, values } of Object.values(snapGroups)) {
      const dt = new Date(ts)
      const bucket = `${dt.getMonth() + 1}/${dt.getDate()} ${dt.getHours().toString().padStart(2, '0')}:${(Math.floor(dt.getMinutes() / 5) * 5).toString().padStart(2, '0')}`
      if (!bucketLatest[bucket] || ts > bucketLatest[bucket].ts) {
        bucketLatest[bucket] = { ts, values }
      }
    }

    const times = Object.keys(bucketLatest).sort()
    const seriesMap: Record<string, Record<string, number>> = {}
    for (const [bucket, { values }] of Object.entries(bucketLatest)) {
      for (const [dimValue, count] of Object.entries(values)) {
        if (!seriesMap[dimValue]) seriesMap[dimValue] = {}
        seriesMap[dimValue][bucket] = count
      }
    }

    return { times, seriesMap, bucketLatest }
  }, [data, dimension])

  const chartOption = useMemo(() => {
    const built = buildChartData()
    if (!built) return null
    const { times, seriesMap } = built

    const series = Object.entries(seriesMap).map(([name, timeData]) => ({
      name,
      type: 'line' as const,
      smooth: true,
      data: times.map(t => timeData[t] || 0),
      emphasis: { focus: 'series' as const },
      label: { show: false },
      endLabel: { show: false },
    }))

    return {
      tooltip: {
        trigger: 'axis' as const,
        confine: true,
        extraCssText: 'max-height:320px;overflow-y:auto;',
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return ''
          const title = `<div style="font-weight:600;margin-bottom:4px">${params[0].axisValue}</div>`
          // 過濾掉 0 值，按人數降序
          const items = params
            .filter((p: any) => p.value > 0)
            .sort((a: any, b: any) => b.value - a.value)
          if (items.length === 0) return title + '<div style="color:#999">無上線人員</div>'
          // 雙欄排列
          const half = Math.ceil(items.length / 2)
          const left = items.slice(0, half)
          const right = items.slice(half)
          const renderItem = (p: any) =>
            `<div style="display:flex;align-items:center;gap:4px;white-space:nowrap">${p.marker}<span>${p.seriesName}</span><span style="font-weight:600;margin-left:auto;padding-left:8px">${p.value}</span></div>`
          let html = title + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">'
          for (let i = 0; i < half; i++) {
            html += renderItem(left[i])
            if (right[i]) html += renderItem(right[i])
            else html += '<div></div>'
          }
          html += '</div>'
          return html
        },
      },
      legend: {
        type: 'scroll' as const,
        orient: 'vertical' as const,
        right: 0,
        top: 10,
        bottom: 50,
        textStyle: { fontSize: 10 },
        itemWidth: 14,
        itemHeight: 10,
        itemGap: 6,
        pageIconSize: 12,
        pageTextStyle: { fontSize: 10 },
      },
      grid: { top: 10, right: 150, bottom: 50, left: 40 },
      xAxis: {
        type: 'category' as const,
        data: times,
        axisLabel: { fontSize: 9, rotate: 30 },
      },
      yAxis: { type: 'value' as const, minInterval: 1, axisLabel: { fontSize: 10 } },
      series,
    }
  }, [buildChartData])

  const exportCsv = useCallback(() => {
    const built = buildChartData()
    if (!built) return
    const { times, seriesMap } = built
    const dimNames = Object.keys(seriesMap).sort()
    const BOM = '\uFEFF'
    const headers = ['時間', ...dimNames]
    const rows = times.map(t => [t, ...dimNames.map(d => String(seriesMap[d]?.[t] ?? 0))])
    const csv = BOM + [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dept_online_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [buildChartData])

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
          <button
            onClick={exportCsv}
            className="p-1 text-slate-400 hover:text-blue-600 rounded"
            title="匯出 CSV"
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {loading && <div className="animate-pulse h-48 bg-slate-50 rounded" />}
      {!loading && chartOption && (
        <ReactECharts key={dimension} option={chartOption} style={{ height: 350 }} opts={{ renderer: 'svg' }} notMerge />
      )}
      {!loading && !chartOption && (
        <div className="text-xs text-slate-400 text-center py-8">尚無部門統計資料（資料每 5 分鐘收集一次）</div>
      )}
    </div>
  )
}
