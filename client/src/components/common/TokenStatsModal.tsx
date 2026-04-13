import { useState, useEffect, useMemo } from 'react'
import { X, TrendingUp } from 'lucide-react'
import ReactECharts from 'echarts-for-react'
import api from '../../lib/api'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()
  const [rows, setRows] = useState<Row[]>([])
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'chart' | 'detail'>('chart')

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
        formatter: (params: { seriesName: string; value: number; marker: string }[]) => {
          return params.map(p => `${p.marker} ${p.seriesName}: <b>$${p.value.toFixed(4)}</b>`).join('<br/>')
        },
      },
      legend: { type: 'plain' as const, bottom: 0, textStyle: { fontSize: 11 }, width: '90%', left: 'center' },
      grid: { top: 20, right: 20, bottom: 70, left: 60 },
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
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-blue-500" />
            <span className="font-semibold text-slate-700">{t('tokenStats.title')}</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={e => setDays(Number(e.target.value))}
              className="text-xs border rounded px-2 py-1"
            >
              <option value={7}>{t('tokenStats.days', { n: 7 })}</option>
              <option value={14}>{t('tokenStats.days', { n: 14 })}</option>
              <option value={30}>{t('tokenStats.days', { n: 30 })}</option>
              <option value={60}>{t('tokenStats.days', { n: 60 })}</option>
              <option value={90}>{t('tokenStats.days', { n: 90 })}</option>
            </select>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Summary stats + Tabs */}
        <div className="flex items-center justify-between px-5 py-2.5 bg-slate-50 border-b shrink-0">
          <div className="flex gap-5 text-sm">
            <div>
              <span className="text-slate-500 text-xs">{t('tokenStats.totalCost')}</span>
              <div className="font-bold text-blue-600">${totalCost.toFixed(4)} USD</div>
            </div>
            <div>
              <span className="text-slate-500 text-xs">{t('tokenStats.totalTokens')}</span>
              <div className="font-bold text-slate-700">{totalTokens.toLocaleString()}</div>
            </div>
            <div>
              <span className="text-slate-500 text-xs">{t('tokenStats.modelCount')}</span>
              <div className="font-bold text-slate-700">
                {new Set(rows.map(r => r.model_name || r.model)).size}
              </div>
            </div>
          </div>
          <div className="flex gap-1 bg-slate-200/70 rounded-lg p-0.5">
            <button
              onClick={() => setTab('chart')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${tab === 'chart' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {t('tokenStats.tabChart')}
            </button>
            <button
              onClick={() => setTab('detail')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${tab === 'detail' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {t('tokenStats.tabDetail')}
            </button>
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-auto">
          {tab === 'chart' ? (
            <div className="p-5">
              {loading ? (
                <div className="animate-pulse h-72 bg-slate-100 rounded" />
              ) : rows.length === 0 ? (
                <div className="text-center text-slate-400 py-20 text-sm">{t('tokenStats.noData')}</div>
              ) : (
                <ReactECharts option={chartOption} style={{ height: 350 }} opts={{ renderer: 'svg' }} />
              )}
            </div>
          ) : (
            <div>
              {loading ? (
                <div className="animate-pulse h-40 m-5 bg-slate-100 rounded" />
              ) : rows.length === 0 ? (
                <div className="text-center text-slate-400 py-20 text-sm">{t('tokenStats.noData')}</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-slate-500">{t('tokenStats.date')}</th>
                      <th className="text-left px-4 py-2.5 text-slate-500">{t('tokenStats.model')}</th>
                      <th className="text-right px-4 py-2.5 text-slate-500">{t('tokenStats.inputTokens')}</th>
                      <th className="text-right px-4 py-2.5 text-slate-500">{t('tokenStats.outputTokens')}</th>
                      <th className="text-right px-4 py-2.5 text-slate-500">{t('tokenStats.cost')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...rows].sort((a, b) => b.usage_date.localeCompare(a.usage_date)).map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-600">{r.usage_date}</td>
                        <td className="px-4 py-2">
                          <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px]">
                            {r.model_name || r.model}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right text-slate-600">{r.input_tokens.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{r.output_tokens.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right font-mono text-green-700">
                          {r.cost > 0 ? `$${r.cost.toFixed(4)}` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
