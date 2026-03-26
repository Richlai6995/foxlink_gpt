import { useState, useEffect, useMemo } from 'react'
import { X, TrendingUp } from 'lucide-react'
import ReactECharts from 'echarts-for-react'
import api from '../../lib/api'

interface Row {
  usage_date: string
  model: string
  model_name: string
  input_tokens: number
  output_tokens: number
  cost: number
  currency: string
}

interface Props {
  onClose: () => void
}

export default function TokenStatsModal({ onClose }: Props) {
  const [rows, setRows] = useState<Row[]>([])
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get(`/auth/token-stats?days=${days}`)
      .then(({ data }) => setRows(data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [days])

  const { chartOption, totalCost, totalTokens } = useMemo(() => {
    // Collect all unique dates and model names
    const dateSet = new Set<string>()
    const modelSet = new Set<string>()
    for (const r of rows) {
      dateSet.add(r.usage_date)
      modelSet.add(r.model_name || r.model)
    }
    const dates = Array.from(dateSet).sort()
    const models = Array.from(modelSet)

    // Build cost map: model → date → cost
    const costMap: Record<string, Record<string, number>> = {}
    for (const r of rows) {
      const m = r.model_name || r.model
      if (!costMap[m]) costMap[m] = {}
      costMap[m][r.usage_date] = (costMap[m][r.usage_date] || 0) + r.cost
    }

    const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316']
    const series = models.map((m, i) => ({
      name: m,
      type: 'line' as const,
      smooth: true,
      data: dates.map(d => Number((costMap[m]?.[d] || 0).toFixed(6))),
      itemStyle: { color: COLORS[i % COLORS.length] },
      lineStyle: { width: 2 },
      symbol: 'circle',
      symbolSize: 5,
    }))

    const totalCost = rows.reduce((s, r) => s + r.cost, 0)
    const totalTokens = rows.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0)

    const chartOption = {
      tooltip: {
        trigger: 'axis' as const,
        formatter: (params: { seriesName: string; value: number }[]) => {
          const lines = params.map(p => `${p.seriesName}: $${p.value.toFixed(4)}`)
          return lines.join('<br/>')
        },
      },
      legend: { type: 'scroll' as const, bottom: 0, textStyle: { fontSize: 11 } },
      grid: { top: 20, right: 20, bottom: 50, left: 60 },
      xAxis: {
        type: 'category' as const,
        data: dates.map(d => d.slice(5)), // show MM-DD
        axisLabel: { fontSize: 10, rotate: dates.length > 15 ? 30 : 0 },
      },
      yAxis: {
        type: 'value' as const,
        axisLabel: { fontSize: 10, formatter: (v: number) => `$${v.toFixed(3)}` },
      },
      series,
    }

    return { chartOption, totalCost, totalTokens }
  }, [rows])

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-blue-500" />
            <span className="font-semibold text-slate-700">我的 Token 消耗趨勢</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={e => setDays(Number(e.target.value))}
              className="text-xs border rounded px-2 py-1"
            >
              <option value={7}>7 天</option>
              <option value={14}>14 天</option>
              <option value={30}>30 天</option>
              <option value={60}>60 天</option>
              <option value={90}>90 天</option>
            </select>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Summary stats */}
        <div className="flex gap-6 px-5 py-3 bg-slate-50 border-b text-sm">
          <div>
            <span className="text-slate-500 text-xs">累計費用</span>
            <div className="font-bold text-blue-600">${totalCost.toFixed(4)} USD</div>
          </div>
          <div>
            <span className="text-slate-500 text-xs">累計 Tokens</span>
            <div className="font-bold text-slate-700">{totalTokens.toLocaleString()}</div>
          </div>
          <div>
            <span className="text-slate-500 text-xs">使用模型數</span>
            <div className="font-bold text-slate-700">
              {new Set(rows.map(r => r.model_name || r.model)).size}
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="p-5">
          {loading ? (
            <div className="animate-pulse h-60 bg-slate-100 rounded" />
          ) : rows.length === 0 ? (
            <div className="text-center text-slate-400 py-16 text-sm">此期間無 Token 使用記錄</div>
          ) : (
            <ReactECharts option={chartOption} style={{ height: 280 }} opts={{ renderer: 'svg' }} />
          )}
        </div>

        {/* Detail table */}
        {!loading && rows.length > 0 && (
          <div className="border-t max-h-48 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-slate-500">日期</th>
                  <th className="text-left px-3 py-2 text-slate-500">模型</th>
                  <th className="text-right px-3 py-2 text-slate-500">輸入 Tokens</th>
                  <th className="text-right px-3 py-2 text-slate-500">輸出 Tokens</th>
                  <th className="text-right px-3 py-2 text-slate-500">費用 (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5 text-slate-600">{r.usage_date}</td>
                    <td className="px-3 py-1.5">
                      <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px]">
                        {r.model_name || r.model}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-600">{r.input_tokens.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right text-slate-600">{r.output_tokens.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-green-700">
                      {r.cost > 0 ? `$${r.cost.toFixed(4)}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
