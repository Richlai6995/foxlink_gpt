/**
 * ChartBuilder — 即時圖表建構器（client-side 聚合）
 * 讓使用者選欄位、聚合方式、圖表類型，即時預覽並儲存
 */
import { useState, useMemo } from 'react'
import type { AiChartConfig, AiChartDef, ChartColorPalette } from '../../types'
import AiChart from './AiChart'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'

type AggFn = 'SUM' | 'COUNT' | 'AVG' | 'MAX' | 'MIN' | 'COUNT_DISTINCT'

interface Props {
  rows: Record<string, unknown>[]
  columns: string[]
  columnLabels?: Record<string, string>
  initialConfig?: AiChartConfig | null
  onSave: (config: AiChartConfig) => void
  onClose: () => void
}

const CHART_TYPES: { type: AiChartDef['type']; label: string; icon: string }[] = [
  { type: 'bar',     label: '長條圖', icon: '📊' },
  { type: 'line',    label: '折線圖', icon: '📈' },
  { type: 'pie',     label: '圓餅圖', icon: '🍕' },
  { type: 'scatter', label: '散佈圖', icon: '⚫' },
  { type: 'radar',   label: '雷達圖', icon: '🕸' },
]

const AGG_FUNCTIONS: AggFn[] = ['SUM', 'COUNT', 'AVG', 'MAX', 'MIN', 'COUNT_DISTINCT']

const PALETTE_OPTIONS: { key: ChartColorPalette; label: string; colors: string[] }[] = [
  { key: 'blue',   label: '藍',   colors: ['#118DFF', '#0093D5', '#12239E'] },
  { key: 'green',  label: '綠',   colors: ['#009E49', '#00B294', '#10893E'] },
  { key: 'orange', label: '橘',   colors: ['#E66C37', '#D9B300', '#F5B300'] },
  { key: 'purple', label: '紫',   colors: ['#744EC2', '#6B007B', '#8764B8'] },
  { key: 'teal',   label: '青',   colors: ['#0099BC', '#038387', '#00B4D8'] },
]

function colLabel(col: string, columnLabels?: Record<string, string>): string {
  return columnLabels?.[col.toLowerCase()] || col
}

/** Client-side 聚合 */
function aggregateRows(
  rows: Record<string, unknown>[],
  xField: string,
  yField: string,
  aggFn: AggFn,
  topN: number
): { x: unknown; y: number }[] {
  const groups = new Map<string, { x: unknown; vals: number[]; count: number }>()
  for (const row of rows) {
    const xVal = row[xField] ?? row[xField.toLowerCase()] ?? row[xField.toUpperCase()]
    const yRaw = row[yField] ?? row[yField.toLowerCase()] ?? row[yField.toUpperCase()]
    const yVal = typeof yRaw === 'number' ? yRaw : parseFloat(String(yRaw) || '0') || 0
    const key = String(xVal ?? '(空)')
    if (!groups.has(key)) groups.set(key, { x: xVal, vals: [], count: 0 })
    const g = groups.get(key)!
    g.vals.push(yVal)
    g.count++
  }

  const result: { x: unknown; y: number }[] = []
  for (const [, g] of groups) {
    let y: number
    switch (aggFn) {
      case 'SUM':           y = g.vals.reduce((a, b) => a + b, 0); break
      case 'COUNT':         y = g.count; break
      case 'AVG':           y = g.vals.length ? g.vals.reduce((a, b) => a + b, 0) / g.vals.length : 0; break
      case 'MAX':           y = Math.max(...g.vals); break
      case 'MIN':           y = Math.min(...g.vals); break
      case 'COUNT_DISTINCT': y = new Set(g.vals).size; break
      default:              y = 0
    }
    result.push({ x: g.x, y })
  }

  result.sort((a, b) => b.y - a.y)
  return topN > 0 ? result.slice(0, topN) : result
}

interface ChartDraft {
  id: string
  def: AiChartDef & { _agg: AggFn }
}

function newDraft(columns: string[]): ChartDraft {
  return {
    id: crypto.randomUUID(),
    def: {
      type: 'bar',
      title: '',
      x_field: columns[0] || '',
      y_field: columns[1] || columns[0] || '',
      show_label: true,
      agg_fn: 'SUM',
      limit: 20,
      _agg: 'SUM',
    },
  }
}

export default function ChartBuilder({ rows, columns, columnLabels, initialConfig, onSave, onClose }: Props) {
  const { t } = useTranslation()
  const [translating, setTranslating] = useState(false)
  const [charts, setCharts] = useState<ChartDraft[]>(() => {
    if (initialConfig?.charts?.length) {
      return initialConfig.charts.map(def => ({
        id: crypto.randomUUID(),
        def: { ...def, _agg: (def.agg_fn as AggFn) || 'SUM' },
      }))
    }
    return [newDraft(columns)]
  })
  const [activeIdx, setActiveIdx] = useState(0)
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)

  const active = charts[activeIdx]

  function updateActive(patch: Partial<ChartDraft['def']>) {
    setCharts(prev => prev.map((c, i) => i === activeIdx ? { ...c, def: { ...c.def, ...patch } } : c))
  }

  const previewChartRows = useMemo(() => {
    if (previewIdx === null) return []
    const c = charts[previewIdx]
    if (!c?.def.x_field || !c.def.y_field) return []
    // 多維度：直接傳 raw rows，AiChart 內部 pivot
    if (c.def.series_field || c.def.stack_field) return rows
    // 單一 series：先 client-side 聚合
    const agg = aggregateRows(rows, c.def.x_field, c.def.y_field, c.def._agg || 'SUM', c.def.limit || 20)
    return agg.map(r => ({ [c.def.x_field!]: r.x, [c.def.y_field!]: r.y }))
  }, [previewIdx, charts, rows])

  async function translateChartFields() {
    if (!active) return
    const titleZh = active.def.title
    if (!titleZh) return
    setTranslating(true)
    try {
      const r = await api.post('/dashboard/translate-text', { text: titleZh })
      updateActive({ title_en: r.data.en, title_vi: r.data.vi })
      // also translate x/y axis names if present
      if (active.def.x_axis_name) {
        const rx = await api.post('/dashboard/translate-text', { text: active.def.x_axis_name })
        updateActive({ x_axis_name_en: rx.data.en, x_axis_name_vi: rx.data.vi })
      }
      if (active.def.y_axis_name) {
        const ry = await api.post('/dashboard/translate-text', { text: active.def.y_axis_name })
        updateActive({ y_axis_name_en: ry.data.en, y_axis_name_vi: ry.data.vi })
      }
    } catch (e) {
      console.error(e)
    } finally {
      setTranslating(false)
    }
  }

  function handleSave() {
    const config: AiChartConfig = {
      default_chart: charts[0]?.def.type || 'bar',
      allow_table: true,
      allow_export: true,
      available_columns: columns.map(c => ({ key: c, label: colLabel(c, columnLabels) })),
      charts: charts.map(c => {
        const { _agg, ...def } = c.def
        return { ...def, agg_fn: _agg }  // 持久化 agg_fn
      }),
    }
    onSave(config)
    onClose()
  }

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200" style={{ minWidth: 340 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50">
        <span className="font-semibold text-sm text-gray-700">📐 {t('aiDash.cb.title')}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
          >
            {t('aiDash.cb.saveChart')}
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* 圖表 tabs */}
      <div className="flex items-center gap-1 px-3 pt-2 border-b border-gray-100 overflow-x-auto">
        {charts.map((c, i) => (
          <button
            key={c.id}
            onClick={() => setActiveIdx(i)}
            className={`flex-shrink-0 px-3 py-1 text-xs rounded-t border transition-colors
              ${activeIdx === i
                ? 'border-blue-400 border-b-white bg-white text-blue-600 font-medium -mb-px z-10'
                : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {c.def.title || `${t('aiDash.cb.chartN')} ${i + 1}`}
          </button>
        ))}
        <button
          onClick={() => {
            setCharts(prev => [...prev, newDraft(columns)])
            setActiveIdx(charts.length)
          }}
          className="flex-shrink-0 px-2 py-1 text-xs text-gray-400 hover:text-blue-600"
          title={t('aiDash.cb.addChart')}
        >+ {t('aiDash.cb.add')}</button>
        {charts.length > 1 && (
          <button
            onClick={() => {
              setCharts(prev => prev.filter((_, i) => i !== activeIdx))
              setActiveIdx(Math.max(0, activeIdx - 1))
            }}
            className="flex-shrink-0 px-2 py-1 text-xs text-red-400 hover:text-red-600 ml-auto"
            title={t('aiDash.cb.removeChart')}
          >✕</button>
        )}
      </div>

      {/* 設定區 */}
      {active && (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
          {/* 標題 + 多語言 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500">{t('aiDash.cb.chartTitle')}</label>
              <button
                type="button"
                onClick={translateChartFields}
                disabled={translating || !active.def.title}
                className="px-2 py-0.5 text-xs bg-gray-100 hover:bg-blue-50 text-gray-500 hover:text-blue-600 rounded border border-gray-200 disabled:opacity-40"
              >
                {translating ? '...' : t('aiDash.cb.translate')}
              </button>
            </div>
            <input
              type="text"
              value={active.def.title || ''}
              onChange={e => updateActive({ title: e.target.value })}
              placeholder={`(${t('common.optional')})`}
              className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400 mb-1"
            />
            <div className="grid grid-cols-2 gap-1">
              <input type="text" value={active.def.title_en || ''} placeholder="Title (EN)"
                onChange={e => updateActive({ title_en: e.target.value })}
                className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
              />
              <input type="text" value={active.def.title_vi || ''} placeholder="Tiêu đề (VI)"
                onChange={e => updateActive({ title_vi: e.target.value })}
                className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>

          {/* 圖表類型 */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t('aiDash.cb.chartType')}</label>
            <div className="flex gap-1 flex-wrap">
              {CHART_TYPES.map(ct => (
                <button
                  key={ct.type}
                  onClick={() => updateActive({ type: ct.type })}
                  className={`px-2 py-1 rounded border text-xs transition-colors
                    ${active.def.type === ct.type
                      ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                >
                  {ct.icon} {t(`aiDash.cb.chartTypeLabel_${ct.type}`, ct.label)}
                </button>
              ))}
            </div>
          </div>

          {/* X 軸欄位 */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">
              {active.def.type === 'pie' ? t('aiDash.cb.labelField') : t('aiDash.cb.xField')}
            </label>
            <select
              value={active.def.x_field || ''}
              onChange={e => updateActive({ x_field: e.target.value, label_field: e.target.value })}
              className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
            >
              <option value="">-- {t('aiDash.cb.selectField')} --</option>
              {columns.map(c => (
                <option key={c} value={c}>{colLabel(c, columnLabels)} ({c})</option>
              ))}
            </select>
          </div>

          {/* Y 軸欄位 + 聚合 */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">
              {active.def.type === 'pie' ? t('aiDash.cb.valueField') : t('aiDash.cb.yField')}
            </label>
            <div className="flex gap-2">
              <select
                value={active.def.y_field || ''}
                onChange={e => updateActive({ y_field: e.target.value, value_field: e.target.value })}
                className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
              >
                <option value="">-- {t('aiDash.cb.selectField')} --</option>
                {columns.map(c => (
                  <option key={c} value={c}>{colLabel(c, columnLabels)} ({c})</option>
                ))}
              </select>
              <select
                value={active.def._agg || 'SUM'}
                onChange={e => updateActive({ _agg: e.target.value as AggFn, agg_fn: e.target.value as AggFn })}
                className="w-32 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
              >
                {AGG_FUNCTIONS.map(fn => <option key={fn} value={fn}>{fn}</option>)}
              </select>
            </div>
          </div>

          {/* 分組 / 堆疊維度（bar / line only）*/}
          {(active.def.type === 'bar' || active.def.type === 'line') && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">{t('aiDash.cb.seriesField')}</label>
                <select
                  value={active.def.series_field || ''}
                  onChange={e => updateActive({ series_field: e.target.value || undefined })}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                >
                  <option value="">— {t('aiDash.cb.noDimension')} —</option>
                  {columns.map(c => (
                    <option key={c} value={c}>{colLabel(c, columnLabels)} ({c})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">{t('aiDash.cb.stackField')}</label>
                <select
                  value={active.def.stack_field || ''}
                  onChange={e => updateActive({ stack_field: e.target.value || undefined })}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                >
                  <option value="">— {t('aiDash.cb.noDimension')} —</option>
                  {columns.map(c => (
                    <option key={c} value={c}>{colLabel(c, columnLabels)} ({c})</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* X / Y 軸標題 + 多語言 */}
          {active.def.type !== 'pie' && active.def.type !== 'gauge' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">{t('aiDash.cb.xAxisName')}</label>
                <input
                  type="text"
                  value={active.def.x_axis_name || ''}
                  onChange={e => updateActive({ x_axis_name: e.target.value })}
                  placeholder={`(${t('common.optional')})`}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400 mb-0.5"
                />
                <div className="grid grid-cols-2 gap-1">
                  <input type="text" value={active.def.x_axis_name_en || ''} placeholder="EN"
                    onChange={e => updateActive({ x_axis_name_en: e.target.value })}
                    className="border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400"
                  />
                  <input type="text" value={active.def.x_axis_name_vi || ''} placeholder="VI"
                    onChange={e => updateActive({ x_axis_name_vi: e.target.value })}
                    className="border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">{t('aiDash.cb.yAxisName')}</label>
                <input
                  type="text"
                  value={active.def.y_axis_name || ''}
                  onChange={e => updateActive({ y_axis_name: e.target.value })}
                  placeholder={`(${t('common.optional')})`}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400 mb-0.5"
                />
                <div className="grid grid-cols-2 gap-1">
                  <input type="text" value={active.def.y_axis_name_en || ''} placeholder="EN"
                    onChange={e => updateActive({ y_axis_name_en: e.target.value })}
                    className="border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400"
                  />
                  <input type="text" value={active.def.y_axis_name_vi || ''} placeholder="VI"
                    onChange={e => updateActive({ y_axis_name_vi: e.target.value })}
                    className="border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 顯示前 N 筆 */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t('aiDash.cb.topN')}</label>
            <input
              type="number"
              min={1}
              max={500}
              value={active.def.limit || 20}
              onChange={e => updateActive({ limit: parseInt(e.target.value) || 20 })}
              className="w-24 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
            />
          </div>

          {/* 排序設定 */}
          {active.def.type !== 'pie' && active.def.type !== 'gauge' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">{t('aiDash.cb.sortBy')}</label>
                <select
                  value={active.def.sort_by || 'none'}
                  onChange={e => updateActive({ sort_by: e.target.value as AiChartDef['sort_by'] })}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                >
                  <option value="none">{t('aiDash.cb.sortNone')}</option>
                  <option value="x">{t('aiDash.cb.sortX')}</option>
                  <option value="y">{t('aiDash.cb.sortY')}</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">{t('aiDash.cb.sortOrder')}</label>
                <select
                  value={active.def.sort_order || 'asc'}
                  onChange={e => updateActive({ sort_order: e.target.value as AiChartDef['sort_order'] })}
                  disabled={!active.def.sort_by || active.def.sort_by === 'none'}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400 disabled:opacity-40"
                >
                  <option value="asc">{t('aiDash.cb.sortAsc')}</option>
                  <option value="desc">{t('aiDash.cb.sortDesc')}</option>
                </select>
              </div>
            </div>
          )}

          {/* 數值門檻 (min_value) + Pie top-N */}
          {(active.def.type === 'bar' || active.def.type === 'line' || active.def.type === 'scatter' || active.def.type === 'pie') && (
            <div className={`grid gap-2 ${active.def.type === 'pie' ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <div>
                <label className="text-xs text-gray-500 block mb-1">{t('aiDash.cb.minValueFilter')}</label>
                <input
                  type="number"
                  min={0}
                  value={active.def.min_value ?? ''}
                  onChange={e => updateActive({ min_value: e.target.value === '' ? undefined : Number(e.target.value) })}
                  placeholder={t('aiDash.cb.noLimit')}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                />
              </div>
              {active.def.type === 'pie' && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">{t('aiDash.cb.pieTopN')}</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={active.def.limit ?? ''}
                    onChange={e => updateActive({ limit: e.target.value === '' ? undefined : parseInt(e.target.value) })}
                    placeholder={t('aiDash.cb.allSlices')}
                    className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
              )}
            </div>
          )}

          {/* 顏色主題 */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t('aiDash.cb.colorTheme')}</label>
            <div className="flex gap-1.5 flex-wrap">
              {PALETTE_OPTIONS.map(p => (
                <button
                  key={p.key}
                  onClick={() => updateActive({ color_palette: p.key })}
                  title={p.label}
                  className={`flex items-center gap-1 px-2 py-1 rounded border text-xs transition-colors
                    ${active.def.color_palette === p.key
                      ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                >
                  <span className="flex gap-0.5">
                    {p.colors.map((c, i) => (
                      <span key={i} className="w-3 h-3 rounded-sm inline-block" style={{ background: c }} />
                    ))}
                  </span>
                  {p.label}
                </button>
              ))}
              {active.def.color_palette && (
                <button
                  onClick={() => updateActive({ color_palette: undefined })}
                  className="px-2 py-1 rounded border border-gray-200 text-xs text-gray-400 hover:text-red-500"
                >{t('aiDash.cb.resetPalette')}</button>
              )}
            </div>
          </div>

          {/* 額外選項 */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-500 block mb-1">{t('aiDash.cb.styleOptions')}</label>
            {(active.def.type === 'bar') && (
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={!!active.def.horizontal}
                  onChange={e => updateActive({ horizontal: e.target.checked })} />
                {t('aiDash.cb.horizontal')}
              </label>
            )}
            {(active.def.type === 'line') && (<>
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={!!active.def.smooth}
                  onChange={e => updateActive({ smooth: e.target.checked })} />
                {t('aiDash.cb.smooth')}
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={!!active.def.area}
                  onChange={e => updateActive({ area: e.target.checked })} />
                {t('aiDash.cb.area')}
              </label>
            </>)}
            {(active.def.type === 'pie') && (
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={!!active.def.donut}
                  onChange={e => updateActive({ donut: e.target.checked })} />
                {t('aiDash.cb.donut')}
              </label>
            )}
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={!!active.def.show_label}
                onChange={e => updateActive({ show_label: e.target.checked })} />
              {t('aiDash.cb.showLabel')}
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={active.def.show_legend !== false}
                onChange={e => updateActive({ show_legend: e.target.checked })} />
              {t('aiDash.cb.showLegend')}
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={active.def.show_grid !== false}
                onChange={e => updateActive({ show_grid: e.target.checked })} />
              {t('aiDash.cb.showGrid')}
            </label>
          </div>

          {/* 預覽按鈕 */}
          <button
            onClick={() => setPreviewIdx(previewIdx === activeIdx ? null : activeIdx)}
            disabled={!active.def.x_field || !active.def.y_field}
            className="w-full py-1.5 border border-blue-300 text-blue-600 text-xs rounded hover:bg-blue-50 disabled:opacity-40"
          >
            {previewIdx === activeIdx ? `▲ ${t('aiDash.cb.collapsePreview')}` : `▼ ${t('aiDash.cb.preview')}`}
          </button>
        </div>
      )}

      {/* Preview area */}
      {previewIdx !== null && previewChartRows.length > 0 && (
        <div className="border-t border-gray-100 p-3">
          <AiChart
            chartDef={charts[previewIdx].def}
            rows={previewChartRows}
            columnLabels={columnLabels}
          />
        </div>
      )}
    </div>
  )
}
