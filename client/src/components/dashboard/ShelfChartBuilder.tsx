/**
 * ShelfChartBuilder — Tableau 風格拖拉式圖表建構器（多圖表 tab）
 * 使用 HTML5 原生 drag & drop，無額外依賴
 */
import { useState, useMemo, useRef } from 'react'
import type { AiChartConfig, AiChartDef, ChartColorPalette, OverlayLine, YAxisDef } from '../../types'
import AiChart from './AiChart'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { X, GripVertical, BarChart2, LineChart, PieChart, ScatterChart, Radar, Gauge } from 'lucide-react'
import ColorPickerInput from '../common/ColorPickerInput'

type AggFn = 'SUM' | 'COUNT' | 'AVG' | 'MAX' | 'MIN' | 'COUNT_DISTINCT'
type FieldType = 'dimension' | 'measure'
type ShelfKey = 'x_field' | 'series_field' | 'stack_field'

const DEFAULT_COLORS = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#f0d062',
]

interface ShelfState {
  id: string
  title: string
  title_en: string
  title_vi: string
  x_field?: string
  y_axes: YAxisDef[]
  series_field?: string
  stack_field?: string
  chartType: AiChartDef['type']
  limit: number
  horizontal: boolean
  smooth: boolean
  area: boolean
  gradient: boolean
  shadow: boolean
  primary_color: string   // 單色自訂，空字串 = 跟色系走
  donut: boolean
  show_label: boolean
  show_legend: boolean
  color_palette?: ChartColorPalette
  series_palette: string[]          // B：順序色票（multi-series 用）
  series_colors: Record<string, string>  // C：值→顏色精確對應
  overlay_lines: OverlayLine[]
  // 排序 + 篩選
  sort_by: 'none' | 'x' | 'y'
  sort_order: 'asc' | 'desc'
  min_value: number | ''
  // 軸標題
  x_axis_name: string
  y_axis_name: string
  // 文字/軸線樣式
  chart_bg_color: string
  axis_label_color: string
  axis_label_size: number | ''
  axis_label_bold: boolean
  axis_line_color: string
  data_label_color: string
  data_label_size: number | ''
  data_label_bold: boolean
  legend_color: string
  legend_size: number | ''
  legend_bold: boolean
  legend_left: string
  legend_top: string
  legend_orient: 'horizontal' | 'vertical'
  title_color: string
  title_size: number | ''
  title_bold: boolean
  title_left: string
  title_top: string
  grid_line_color: string
}

interface Props {
  rows: Record<string, unknown>[]
  columns: string[]
  columnLabels?: Record<string, string>
  initialConfig?: AiChartConfig | null
  loadedSqName?: string | null   // 目前載入的命名查詢名稱（有值 = 更新模式）
  onSave: (config: AiChartConfig) => void
  onSaveAs: (config: AiChartConfig) => void  // 另存為新查詢
  onClose: () => void
}

const CHART_TYPES: { type: AiChartDef['type']; icon: React.ReactNode; label: string }[] = [
  { type: 'bar',     icon: <BarChart2 size={14} />,    label: '長條' },
  { type: 'line',    icon: <LineChart size={14} />,    label: '折線' },
  { type: 'pie',     icon: <PieChart size={14} />,     label: '圓餅' },
  { type: 'scatter', icon: <ScatterChart size={14} />, label: '散佈' },
  { type: 'radar',   icon: <Radar size={14} />,        label: '雷達' },
  { type: 'gauge',   icon: <Gauge size={14} />,        label: '儀錶' },
]

const AGG_FNS: AggFn[] = ['SUM', 'COUNT', 'AVG', 'MAX', 'MIN', 'COUNT_DISTINCT']

const PALETTE_OPTIONS: { key: ChartColorPalette; colors: string[] }[] = [
  { key: 'blue',   colors: ['#118DFF', '#0093D5', '#12239E'] },
  { key: 'green',  colors: ['#009E49', '#00B294', '#10893E'] },
  { key: 'orange', colors: ['#E66C37', '#D9B300', '#F5B300'] },
  { key: 'purple', colors: ['#744EC2', '#6B007B', '#8764B8'] },
  { key: 'teal',   colors: ['#0099BC', '#038387', '#00B4D8'] },
]

function classifyField(col: string, rows: Record<string, unknown>[]): FieldType {
  const samples = rows.slice(0, 30).map(r =>
    r[col] ?? r[col.toLowerCase()] ?? r[col.toUpperCase()]
  ).filter(v => v !== null && v !== undefined)
  if (!samples.length) return 'dimension'
  const numCount = samples.filter(v => v !== '' && !isNaN(Number(v))).length
  return numCount >= samples.length * 0.7 ? 'measure' : 'dimension'
}

function colLabel(col: string, labels?: Record<string, string>) {
  return labels?.[col.toLowerCase()] || col
}

function defToShelf(def: AiChartDef, columns: string[], rows: Record<string, unknown>[]): ShelfState {
  void rows
  return {
    id: crypto.randomUUID(),
    title: def.title || '',
    title_en: def.title_en || '',
    title_vi: def.title_vi || '',
    x_field: def.x_field || columns[0],
    y_axes: (() => {
      if (def.y_axes?.length) return def.y_axes
      if (def.y_field) return [{ field: def.y_field, agg: (def.agg_fn as AggFn) || 'SUM', chart_type: 'bar' as const }]
      return []
    })(),
    series_field: def.series_field,
    stack_field: def.stack_field,
    chartType: def.type || 'bar',
    limit: def.limit || 20,
    horizontal: !!def.horizontal,
    smooth: def.smooth !== false,
    area: !!def.area,
    gradient: !!def.gradient,
    shadow: !!def.shadow,
    primary_color: (!def.series_field && !def.stack_field) ? (def.colors?.[0] || '') : '',
    donut: !!def.donut,
    show_label: def.show_label !== false,
    show_legend: def.show_legend !== false,
    color_palette: def.color_palette,
    series_palette: (def.series_field || def.stack_field) ? (def.colors || []) : [],
    series_colors: (() => {
      const sc = def.series_colors
      if (!sc) return {}
      if (typeof sc === 'string') { try { return JSON.parse(sc) } catch { return {} } }
      return sc as Record<string, string>
    })(),
    overlay_lines: def.overlay_lines || [],
    sort_by: def.sort_by || 'none',
    sort_order: def.sort_order || 'desc',
    min_value: def.min_value ?? '',
    x_axis_name: def.x_axis_name || '',
    y_axis_name: def.y_axis_name || '',
    chart_bg_color: def.chart_bg_color || '',
    axis_label_color: def.axis_label_color || '',
    axis_label_size: def.axis_label_size ?? '',
    axis_label_bold: def.axis_label_bold ?? false,
    axis_line_color: def.axis_line_color || '',
    data_label_color: def.data_label_color || '',
    data_label_size: def.data_label_size ?? '',
    data_label_bold: def.data_label_bold ?? false,
    legend_color: def.legend_color || '',
    legend_size: def.legend_size ?? '',
    legend_bold: def.legend_bold ?? false,
    legend_left: def.legend_left || 'center',
    legend_top: def.legend_top || '',
    legend_orient: def.legend_orient || 'horizontal',
    title_color: def.title_color || '',
    title_size: def.title_size ?? '',
    title_bold: def.title_bold ?? false,
    title_left: def.title_left || 'auto',
    title_top: def.title_top || '',
    grid_line_color: def.grid_line_color || '',
  }
}

function newBlankShelf(columns: string[], rows: Record<string, unknown>[]): ShelfState {
  const types = Object.fromEntries(columns.map(c => [c, classifyField(c, rows)]))
  const dims     = columns.filter(c => types[c] === 'dimension')
  const measures = columns.filter(c => types[c] === 'measure')
  return {
    id: crypto.randomUUID(),
    title: '', title_en: '', title_vi: '',
    x_field: dims[0] || columns[0],
    y_axes: (measures[0] || columns[1]) ? [{ field: measures[0] || columns[1], agg: 'SUM' as AggFn, chart_type: 'bar' as const }] : [],
    chartType: 'bar',
    limit: 20,
    horizontal: false,
    smooth: true,
    area: false,
    gradient: false,
    shadow: false,
    primary_color: '',
    donut: false,
    show_label: true,
    show_legend: true,
    series_palette: [],
    series_colors: {},
    overlay_lines: [],
    sort_by: 'none',
    sort_order: 'desc',
    min_value: '',
    x_axis_name: '',
    y_axis_name: '',
    chart_bg_color: '',
    axis_label_color: '',
    axis_label_size: '',
    axis_label_bold: false,
    axis_line_color: '',
    data_label_color: '',
    data_label_size: '',
    data_label_bold: false,
    legend_color: '',
    legend_size: '',
    legend_bold: false,
    legend_left: 'center',
    legend_top: '',
    legend_orient: 'horizontal',
    title_color: '',
    title_size: '',
    title_bold: false,
    title_left: 'auto',
    title_top: '',
    grid_line_color: '',
  }
}

function initShelves(columns: string[], rows: Record<string, unknown>[], initialConfig?: AiChartConfig | null): ShelfState[] {
  if (initialConfig?.charts?.length) {
    return initialConfig.charts.map(def => defToShelf(def, columns, rows))
  }
  return [newBlankShelf(columns, rows)]
}

// ── Draggable field chip ───────────────────────────────────────────────────────
function FieldChip({ col, label, type, onDragStart }: {
  col: string; label: string; type: FieldType
  onDragStart: (col: string) => void
}) {
  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.setData('field', col); onDragStart(col) }}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs cursor-grab select-none
        ${type === 'measure'
          ? 'bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100'
          : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'}`}
      title={col}
    >
      <GripVertical size={10} className="text-gray-400 flex-shrink-0" />
      <span className="truncate max-w-[120px]">{label}</span>
      <span className="text-[9px] text-gray-400 flex-shrink-0">{type === 'measure' ? '#' : 'Aa'}</span>
    </div>
  )
}

// ── Shelf slot (drop target) ───────────────────────────────────────────────────
function ShelfSlot({ label, fieldKey, value, agg, fieldType, columnLabels, onDrop, onRemove, onAggChange, disabled }: {
  label: string; fieldKey: ShelfKey; value?: string; agg?: AggFn; fieldType?: FieldType
  columnLabels?: Record<string, string>
  onDrop: (key: ShelfKey, field: string) => void
  onRemove: (key: ShelfKey) => void
  onAggChange?: (agg: AggFn) => void
  disabled?: boolean
}) {
  const [over, setOver] = useState(false)
  return (
    <div className={`flex items-start gap-2 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <span className="text-[10px] text-gray-400 w-14 flex-shrink-0 mt-1.5 text-right">{label}</span>
      <div
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.getData('field'); if (f) onDrop(fieldKey, f) }}
        className={`flex-1 min-h-[30px] rounded border border-dashed flex flex-wrap gap-1 p-1 transition-colors
          ${over ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
      >
        {value ? (
          <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs
            ${fieldType === 'measure' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
            <span className="font-medium">{colLabel(value, columnLabels)}</span>
            {false && onAggChange && (
              <select
                value={agg || 'SUM'}
                onChange={e => onAggChange!(e.target.value as AggFn)}
                onClick={e => e.stopPropagation()}
                className="text-[10px] bg-transparent border-0 outline-none cursor-pointer text-orange-700 ml-0.5"
              >
                {AGG_FNS.map(fn => <option key={fn} value={fn}>{fn}</option>)}
              </select>
            )}
            <button onClick={() => onRemove(fieldKey)} className="text-gray-400 hover:text-red-400 ml-0.5">
              <X size={9} />
            </button>
          </div>
        ) : (
          <span className="text-[10px] text-gray-300 self-center px-1">拖曳欄位至此</span>
        )}
      </div>
    </div>
  )
}

// ── Multi-measure Y 軸 slot (drag & drop multiple measures) ───────────────────
function MultiMeasureSlot({ y_axes, columnLabels, fieldTypes, onDrop, onUpdate, onRemove }: {
  y_axes: YAxisDef[]
  columnLabels?: Record<string, string>
  fieldTypes: Record<string, FieldType>
  onDrop: (field: string) => void
  onUpdate: (idx: number, patch: Partial<YAxisDef>) => void
  onRemove: (idx: number) => void
}) {
  void fieldTypes
  const [over, setOver] = useState(false)
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] text-gray-400 w-14 flex-shrink-0 mt-1.5 text-right">Y 軸</span>
      <div className="flex-1 space-y-1">
        <div
          onDragOver={e => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.getData('field'); if (f) onDrop(f) }}
          className={`min-h-[30px] rounded border border-dashed p-1 transition-colors
            ${over ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
        >
          {y_axes.length === 0 ? (
            <span className="text-[10px] text-gray-300 px-1 leading-7">拖曳指標至此（可多個）</span>
          ) : (
            <div className="space-y-0.5">
              {y_axes.map((ax, idx) => {
                const autoColor = DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
                const c = ax.color || autoColor
                return (
                  <div key={idx} className="flex items-center gap-1 bg-orange-50 rounded px-1.5 py-0.5 border border-orange-100">
                    {/* 顏色 */}
                    <input type="color" value={c}
                      onChange={e => onUpdate(idx, { color: e.target.value })}
                      className="w-5 h-5 rounded border-0 cursor-pointer p-0 flex-shrink-0"
                      title="系列顏色" />
                    {/* 欄位名稱 + 別名輸入 */}
                    <span className="text-[10px] text-orange-500 truncate flex-shrink-0 max-w-[60px]" title={ax.field}>
                      {colLabel(ax.field, columnLabels)}
                    </span>
                    <input
                      type="text"
                      value={ax.label || ''}
                      onChange={e => onUpdate(idx, { label: e.target.value || undefined })}
                      placeholder="別名"
                      className="text-[10px] bg-white border border-orange-200 rounded px-1 py-0 text-orange-800 outline-none w-16 flex-shrink-0"
                      title="圖表顯示名稱（別名）"
                    />
                    {/* Agg */}
                    <select value={ax.agg}
                      onChange={e => onUpdate(idx, { agg: e.target.value as AggFn })}
                      onClick={e => e.stopPropagation()}
                      className="text-[10px] bg-white border border-orange-200 rounded px-0.5 py-0 text-orange-700 outline-none cursor-pointer flex-shrink-0">
                      {AGG_FNS.map(fn => <option key={fn} value={fn}>{fn}</option>)}
                    </select>
                    {/* 柱/折 切換 */}
                    <button
                      onClick={() => onUpdate(idx, { chart_type: ax.chart_type === 'line' ? 'bar' : 'line' })}
                      className={`text-[10px] px-1.5 py-px rounded flex-shrink-0 border font-medium
                        ${ax.chart_type === 'line'
                          ? 'bg-purple-100 text-purple-700 border-purple-200'
                          : 'bg-blue-100 text-blue-700 border-blue-200'}`}
                      title="切換長條/折線">
                      {ax.chart_type === 'line' ? '折' : '柱'}
                    </button>
                    {/* 堆疊 */}
                    <button
                      onClick={() => onUpdate(idx, { stack: !ax.stack })}
                      className={`text-[10px] px-1.5 py-px rounded flex-shrink-0 border font-medium
                        ${ax.stack
                          ? 'bg-green-100 text-green-700 border-green-200'
                          : 'bg-gray-50 text-gray-400 border-gray-200'}`}
                      title="堆疊此 series">
                      疊
                    </button>
                    {/* 右軸 */}
                    <button
                      onClick={() => onUpdate(idx, { use_right_axis: !ax.use_right_axis })}
                      className={`text-[10px] px-1.5 py-px rounded flex-shrink-0 border font-medium
                        ${ax.use_right_axis
                          ? 'bg-teal-100 text-teal-700 border-teal-200'
                          : 'bg-gray-50 text-gray-400 border-gray-200'}`}
                      title="使用右 Y 軸">
                      右
                    </button>
                    {/* 移除 */}
                    <button onClick={() => onRemove(idx)} className="text-gray-400 hover:text-red-400 flex-shrink-0 ml-0.5">
                      <X size={9} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {y_axes.length > 1 && (
          <p className="text-[9px] text-gray-400">
            共 {y_axes.length} 個指標 · 多指標模式下分組/堆疊欄位無效
          </p>
        )}
        {y_axes.length === 1 && (
          <p className="text-[9px] text-gray-300">再拖曳更多指標可切換至多指標模式</p>
        )}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function ShelfChartBuilder({ rows, columns, columnLabels, initialConfig, loadedSqName, onSave, onSaveAs, onClose }: Props) {
  const { t } = useTranslation()
  const [shelves, setShelves] = useState<ShelfState[]>(() => initShelves(columns, rows, initialConfig))
  const [activeIdx, setActiveIdx] = useState(0)
  const [translating, setTranslating] = useState(false)
  const [draggingField, setDraggingField] = useState<string | null>(null)
  const [panelWidth, setPanelWidth] = useState(320)
  const resizingRef = useRef(false)

  function onPanelResizeStart(e: React.MouseEvent) {
    e.preventDefault()
    resizingRef.current = true
    const startX = e.clientX
    const startW = panelWidth
    function onMove(e2: MouseEvent) {
      if (!resizingRef.current) return
      setPanelWidth(Math.max(240, Math.min(700, startW + e2.clientX - startX)))
    }
    function onUp() {
      resizingRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const fieldTypes = useMemo(
    () => Object.fromEntries(columns.map(c => [c, classifyField(c, rows)])),
    [columns, rows]
  )
  const dimensions = columns.filter(c => fieldTypes[c] === 'dimension')
  const measures   = columns.filter(c => fieldTypes[c] === 'measure')

  const active = shelves[activeIdx] ?? shelves[0]

  function updateActive(patch: Partial<ShelfState>) {
    setShelves(prev => prev.map((s, i) => i === activeIdx ? { ...s, ...patch } : s))
  }

  function addTab() {
    const next = [...shelves, newBlankShelf(columns, rows)]
    setShelves(next)
    setActiveIdx(next.length - 1)
  }

  function removeTab(idx: number) {
    if (shelves.length === 1) return   // keep at least one
    const next = shelves.filter((_, i) => i !== idx)
    setShelves(next)
    setActiveIdx(Math.min(activeIdx, next.length - 1))
  }

  function handleDrop(key: ShelfKey, field: string) {
    setDraggingField(null)
    updateActive({ [key]: field })
  }

  function handleRemove(key: ShelfKey) {
    updateActive({ [key]: undefined })
  }

  function handleDropYAxis(field: string) {
    setDraggingField(null)
    if (active.y_axes.some(ax => ax.field === field)) return  // no duplicate
    updateActive({ y_axes: [...active.y_axes, { field, agg: 'SUM', chart_type: 'bar' }] })
  }

  function handleRemoveYAxis(idx: number) {
    updateActive({ y_axes: active.y_axes.filter((_, i) => i !== idx) })
  }

  function handleUpdateYAxis(idx: number, patch: Partial<YAxisDef>) {
    updateActive({ y_axes: active.y_axes.map((ax, i) => i === idx ? { ...ax, ...patch } : ax) })
  }

  const chartDef = useMemo((): AiChartDef => ({
    type: active.chartType,
    title: active.title || undefined,
    title_en: active.title_en || undefined,
    title_vi: active.title_vi || undefined,
    x_field: active.x_field,
    y_axes: active.y_axes.length > 0 ? active.y_axes : undefined,
    y_field: active.y_axes[0]?.field,
    label_field: active.x_field,
    value_field: active.y_axes[0]?.field,
    series_field: active.y_axes.length <= 1 ? active.series_field : undefined,
    stack_field: active.y_axes.length <= 1 ? active.stack_field : undefined,
    agg_fn: active.y_axes[0]?.agg || 'SUM',
    limit: active.limit,
    horizontal: active.horizontal,
    smooth: active.smooth,
    area: active.area,
    gradient: active.gradient,
    shadow: active.shadow,
    colors: (active.y_axes.length <= 1 && (active.series_field || active.stack_field))
      ? (active.series_palette.length ? active.series_palette : undefined)
      : (active.y_axes.length <= 1 && active.primary_color ? [active.primary_color] : undefined),
    series_colors: Object.keys(active.series_colors).length ? active.series_colors : undefined,
    donut: active.donut,
    show_label: active.show_label,
    show_legend: active.show_legend,
    color_palette: active.color_palette,
    overlay_lines: active.overlay_lines.length ? active.overlay_lines : undefined,
    sort_by: active.sort_by !== 'none' ? active.sort_by : undefined,
    sort_order: active.sort_by !== 'none' ? active.sort_order : undefined,
    min_value: active.min_value !== '' ? Number(active.min_value) : undefined,
    x_axis_name: active.x_axis_name || undefined,
    y_axis_name: active.y_axis_name || undefined,
    chart_bg_color: active.chart_bg_color || undefined,
    axis_label_color: active.axis_label_color || undefined,
    axis_label_size: active.axis_label_size !== '' ? Number(active.axis_label_size) : undefined,
    axis_label_bold: active.axis_label_bold || undefined,
    axis_line_color: active.axis_line_color || undefined,
    data_label_color: active.data_label_color || undefined,
    data_label_size: active.data_label_size !== '' ? Number(active.data_label_size) : undefined,
    data_label_bold: active.data_label_bold || undefined,
    legend_color: active.legend_color || undefined,
    legend_size: active.legend_size !== '' ? Number(active.legend_size) : undefined,
    legend_bold: active.legend_bold || undefined,
    legend_left: active.legend_left || undefined,
    legend_top: active.legend_top || undefined,
    legend_orient: active.legend_orient || undefined,
    title_color: active.title_color || undefined,
    title_size: active.title_size !== '' ? Number(active.title_size) : undefined,
    title_bold: active.title_bold || undefined,
    title_left: active.title_left || undefined,
    title_top: active.title_top || undefined,
    grid_line_color: active.grid_line_color || undefined,
  }), [active])

  async function translateTitle() {
    if (!active.title) return
    setTranslating(true)
    try {
      const r = await api.post('/dashboard/translate-text', { text: active.title })
      updateActive({ title_en: r.data.en || '', title_vi: r.data.vi || '' })
    } catch (e) { console.error(e) }
    finally { setTranslating(false) }
  }

  function buildConfig(): AiChartConfig {
    const charts: AiChartDef[] = shelves.map(s => ({
      type: s.chartType,
      title: s.title || undefined,
      title_en: s.title_en || undefined,
      title_vi: s.title_vi || undefined,
      x_field: s.x_field,
      y_axes: s.y_axes.length > 0 ? s.y_axes : undefined,
      y_field: s.y_axes[0]?.field,
      label_field: s.x_field,
      value_field: s.y_axes[0]?.field,
      series_field: s.y_axes.length <= 1 ? s.series_field : undefined,
      stack_field: s.y_axes.length <= 1 ? s.stack_field : undefined,
      agg_fn: s.y_axes[0]?.agg || 'SUM',
      limit: s.limit,
      horizontal: s.horizontal,
      smooth: s.smooth,
      area: s.area,
      gradient: s.gradient || undefined,
      shadow: s.shadow || undefined,
      colors: (s.y_axes.length <= 1 && (s.series_field || s.stack_field))
        ? (s.series_palette.length ? s.series_palette : undefined)
        : (s.y_axes.length <= 1 && s.primary_color ? [s.primary_color] : undefined),
      series_colors: Object.keys(s.series_colors).length ? s.series_colors : undefined,
      donut: s.donut,
      show_label: s.show_label,
      show_legend: s.show_legend,
      color_palette: s.color_palette,
      overlay_lines: s.overlay_lines.length ? s.overlay_lines : undefined,
      sort_by: s.sort_by !== 'none' ? s.sort_by : undefined,
      sort_order: s.sort_by !== 'none' ? s.sort_order : undefined,
      min_value: s.min_value !== '' ? Number(s.min_value) : undefined,
      x_axis_name: s.x_axis_name || undefined,
      y_axis_name: s.y_axis_name || undefined,
      chart_bg_color: s.chart_bg_color || undefined,
      axis_label_color: s.axis_label_color || undefined,
      axis_label_size: s.axis_label_size !== '' ? Number(s.axis_label_size) : undefined,
      axis_label_bold: s.axis_label_bold || undefined,
      axis_line_color: s.axis_line_color || undefined,
      data_label_color: s.data_label_color || undefined,
      data_label_size: s.data_label_size !== '' ? Number(s.data_label_size) : undefined,
      data_label_bold: s.data_label_bold || undefined,
      legend_color: s.legend_color || undefined,
      legend_size: s.legend_size !== '' ? Number(s.legend_size) : undefined,
      legend_bold: s.legend_bold || undefined,
      legend_left: s.legend_left || undefined,
      legend_top: s.legend_top || undefined,
      legend_orient: s.legend_orient || undefined,
      title_color: s.title_color || undefined,
      title_size: s.title_size !== '' ? Number(s.title_size) : undefined,
      title_bold: s.title_bold || undefined,
      title_left: s.title_left || undefined,
      title_top: s.title_top || undefined,
      grid_line_color: s.grid_line_color || undefined,
    }))
    return {
      default_chart: charts[0]?.type || 'bar',
      allow_table: true,
      allow_export: true,
      available_columns: columns.map(c => ({ key: c, label: colLabel(c, columnLabels) })),
      charts,
    }
  }

  function handleSave() {
    onSave(buildConfig())
    onClose()
  }

  function handleSaveAs() {
    onSaveAs(buildConfig())
    onClose()
  }

  const canPreview = !!(active?.x_field && active?.y_axes.length > 0)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-50" style={{ fontFamily: 'inherit' }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
          <span className="font-semibold text-sm text-gray-800">Tableau 模式</span>
          {loadedSqName ? (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="text-gray-400">正在更新：</span>
              <span className="font-medium text-blue-700 max-w-[200px] truncate" title={loadedSqName}>
                {loadedSqName}
              </span>
            </span>
          ) : (
            <span className="text-xs text-amber-500">未連結查詢 — 儲存後需手動 💾 存檔</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 另存為新查詢（次要按鈕，永遠顯示） */}
          <button
            onClick={handleSaveAs}
            disabled={!canPreview}
            className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            另存為新查詢
          </button>
          {/* 主要儲存按鈕 */}
          <button
            onClick={handleSave}
            disabled={!canPreview}
            className={`px-4 py-1.5 text-white text-xs rounded-lg disabled:opacity-40
              ${loadedSqName
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-gray-400 hover:bg-gray-500'}`}
            title={loadedSqName ? `更新「${loadedSqName}」的圖表設定` : '套用至目前畫面（不存入資料庫）'}
          >
            {loadedSqName ? `更新查詢 (${shelves.length} 張圖)` : `套用 (${shelves.length} 張圖)`}
          </button>
        </div>
      </div>

      {/* ── Chart Tabs ── */}
      <div className="flex items-center gap-0.5 px-4 py-1.5 bg-white border-b border-gray-100 flex-shrink-0 overflow-x-auto">
        {shelves.map((s, i) => (
          <div key={s.id} className="flex items-center flex-shrink-0">
            <button
              onClick={() => setActiveIdx(i)}
              className={`px-3 py-1 text-xs rounded-t transition-colors
                ${activeIdx === i
                  ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-300 border-b-white -mb-px z-10'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
            >
              {s.title || `圖表 ${i + 1}`}
            </button>
            {shelves.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); removeTab(i) }}
                className="ml-0.5 text-gray-300 hover:text-red-400 flex-shrink-0"
                title="移除此圖表"
              >
                <X size={10} />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={addTab}
          className="ml-2 px-2 py-1 text-xs text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded flex-shrink-0"
          title="新增圖表"
        >
          ＋ 新增
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: Field List ── */}
        <div className="w-52 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 overflow-y-auto">
          <div className="px-3 py-2 border-b border-gray-100">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">欄位</span>
          </div>
          {dimensions.length > 0 && (
            <div className="px-3 py-2">
              <p className="text-[9px] font-semibold text-blue-500 uppercase mb-1.5">📐 維度</p>
              <div className="space-y-1">
                {dimensions.map(col => (
                  <FieldChip key={col} col={col} label={colLabel(col, columnLabels)}
                    type="dimension" onDragStart={setDraggingField} />
                ))}
              </div>
            </div>
          )}
          {measures.length > 0 && (
            <div className="px-3 py-2">
              <p className="text-[9px] font-semibold text-orange-500 uppercase mb-1.5">📊 指標</p>
              <div className="space-y-1">
                {measures.map(col => (
                  <FieldChip key={col} col={col} label={colLabel(col, columnLabels)}
                    type="measure" onDragStart={setDraggingField} />
                ))}
              </div>
            </div>
          )}
          <div className="px-3 py-2 mt-auto border-t border-gray-100">
            <p className="text-[9px] text-gray-400 leading-relaxed">
              分類依資料樣本自動推斷<br />
              <span className="text-blue-400">藍 Aa</span> = 維度 &nbsp;
              <span className="text-orange-400"># 橘</span> = 指標
            </p>
          </div>
        </div>

        {/* ── Center: Shelves + Options (resizable) ── */}
        <div className="bg-white border-r border-gray-200 flex flex-col flex-shrink-0 overflow-y-auto relative"
          style={{ width: panelWidth }}>
          {/* Resize handle */}
          <div
            onMouseDown={onPanelResizeStart}
            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-blue-300 transition-colors"
            style={{ background: resizingRef.current ? '#93c5fd' : 'transparent' }}
            title="拖曳調整寬度"
          />

          {/* Chart type selector */}
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-[10px] text-gray-400 mb-2">圖表類型</p>
            <div className="flex flex-wrap gap-1">
              {CHART_TYPES.map(ct => (
                <button key={ct.type} onClick={() => updateActive({ chartType: ct.type })}
                  className={`flex items-center gap-1 px-2 py-1 rounded border text-xs transition-colors
                    ${active.chartType === ct.type
                      ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
                >
                  {ct.icon} {ct.label}
                </button>
              ))}
            </div>
          </div>

          {/* Shelves */}
          <div className="px-4 py-3 space-y-2 border-b border-gray-100">
            <p className="text-[10px] text-gray-400 mb-1">Shelf</p>
            <ShelfSlot label="X 軸" fieldKey="x_field" value={active.x_field}
              fieldType={active.x_field ? fieldTypes[active.x_field] : undefined}
              columnLabels={columnLabels} onDrop={handleDrop} onRemove={handleRemove} />
            <MultiMeasureSlot
              y_axes={active.y_axes}
              columnLabels={columnLabels}
              fieldTypes={fieldTypes}
              onDrop={handleDropYAxis}
              onUpdate={handleUpdateYAxis}
              onRemove={handleRemoveYAxis}
            />
            {(active.chartType === 'bar' || active.chartType === 'line') && (<>
              <ShelfSlot label="分組" fieldKey="series_field" value={active.series_field}
                fieldType={active.series_field ? fieldTypes[active.series_field] : undefined}
                columnLabels={columnLabels} onDrop={handleDrop} onRemove={handleRemove}
                disabled={active.y_axes.length > 1} />
              <ShelfSlot label="堆疊" fieldKey="stack_field" value={active.stack_field}
                fieldType={active.stack_field ? fieldTypes[active.stack_field] : undefined}
                columnLabels={columnLabels} onDrop={handleDrop} onRemove={handleRemove}
                disabled={active.y_axes.length > 1} />
            </>)}
          </div>

          {/* 圖表標題 */}
          <div className="px-4 py-3 border-b border-gray-100 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-gray-400">圖表標題</p>
              <button onClick={translateTitle} disabled={translating || !active.title}
                className="text-[10px] px-1.5 py-0.5 rounded border border-blue-200 text-blue-500 hover:bg-blue-50 disabled:opacity-40">
                {translating ? '...' : '↻ 翻譯'}
              </button>
            </div>
            <input type="text" value={active.title} onChange={e => updateActive({ title: e.target.value })}
              placeholder="(選填)"
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400" />
            <div className="grid grid-cols-2 gap-1">
              <input type="text" value={active.title_en} onChange={e => updateActive({ title_en: e.target.value })}
                placeholder="Title (EN)"
                className="border border-gray-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-400" />
              <input type="text" value={active.title_vi} onChange={e => updateActive({ title_vi: e.target.value })}
                placeholder="Tiêu đề (VI)"
                className="border border-gray-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-400" />
            </div>
          </div>

          {/* 顯示選項 */}
          <div className="px-4 py-3 border-b border-gray-100 space-y-1.5">
            <p className="text-[10px] text-gray-400 mb-1">顯示選項</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {active.chartType === 'bar' && (
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={active.horizontal} onChange={e => updateActive({ horizontal: e.target.checked })} />橫向
                </label>
              )}
              {active.chartType === 'line' && (<>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={active.smooth} onChange={e => updateActive({ smooth: e.target.checked })} />平滑
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={active.area} onChange={e => updateActive({ area: e.target.checked })} />面積
                </label>
              </>)}
              {(active.chartType === 'bar' || active.chartType === 'line') && (<>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={active.gradient} onChange={e => updateActive({ gradient: e.target.checked })} />漸層
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={active.shadow} onChange={e => updateActive({ shadow: e.target.checked })} />陰影
                </label>
              </>)}
              {active.chartType === 'pie' && (
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={active.donut} onChange={e => updateActive({ donut: e.target.checked })} />環形
                </label>
              )}
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={active.show_label} onChange={e => updateActive({ show_label: e.target.checked })} />數值標籤
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={active.show_legend} onChange={e => updateActive({ show_legend: e.target.checked })} />圖例
              </label>
            </div>

            {/* 自訂主色（僅單指標時顯示） */}
            {active.y_axes.length <= 1 && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-gray-500 flex-shrink-0">主色</span>
                <input
                  type="color"
                  value={active.primary_color || '#118DFF'}
                  onChange={e => updateActive({ primary_color: e.target.value, color_palette: undefined })}
                  className="w-8 h-6 rounded border border-gray-200 cursor-pointer p-0"
                  title="自訂主色（會覆蓋色系設定）"
                />
                {active.primary_color && (
                  <button
                    onClick={() => updateActive({ primary_color: '' })}
                    className="text-[10px] text-gray-400 hover:text-red-500"
                    title="還原預設色"
                  >✕ 還原</button>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-gray-500">前 N 筆</span>
              <input type="number" min={1} max={500} value={active.limit}
                onChange={e => updateActive({ limit: parseInt(e.target.value) || 20 })}
                className="w-20 border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-blue-400" />
            </div>

            {/* 排序設定 */}
            {active.chartType !== 'pie' && active.chartType !== 'gauge' && active.chartType !== 'radar' && (
              <div className="grid grid-cols-2 gap-1.5 mt-1">
                <div>
                  <label className="text-[10px] text-gray-400 block mb-0.5">排序依據</label>
                  <select value={active.sort_by} onChange={e => updateActive({ sort_by: e.target.value as ShelfState['sort_by'] })}
                    className="w-full border border-gray-200 rounded px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:border-blue-400">
                    <option value="none">不排序</option>
                    <option value="x">X 軸值</option>
                    <option value="y">Y 軸值</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 block mb-0.5">排序方向</label>
                  <select value={active.sort_order} onChange={e => updateActive({ sort_order: e.target.value as ShelfState['sort_order'] })}
                    disabled={active.sort_by === 'none'}
                    className="w-full border border-gray-200 rounded px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:border-blue-400 disabled:opacity-40">
                    <option value="asc">升冪 (A→Z / 小→大)</option>
                    <option value="desc">降冪 (Z→A / 大→小)</option>
                  </select>
                </div>
              </div>
            )}

            {/* 數值門檻 */}
            <div className="mt-1">
              <label className="text-[10px] text-gray-400 block mb-0.5">僅顯示數值 &gt;（設 0 排除零值）</label>
              <input type="number" min={0} value={active.min_value ?? ''} placeholder="不限制"
                onChange={e => updateActive({ min_value: e.target.value === '' ? '' : Number(e.target.value) })}
                className="w-full border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-blue-400" />
            </div>

            {/* 軸標題 */}
            <div className="grid grid-cols-2 gap-1.5 mt-1">
              <div>
                <label className="text-[10px] text-gray-400 block mb-0.5">X 軸標題</label>
                <input type="text" value={active.x_axis_name} placeholder="(選填)"
                  onChange={e => updateActive({ x_axis_name: e.target.value })}
                  className="w-full border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 block mb-0.5">Y 軸標題</label>
                <input type="text" value={active.y_axis_name} placeholder="(選填)"
                  onChange={e => updateActive({ y_axis_name: e.target.value })}
                  className="w-full border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400" />
              </div>
            </div>
          </div>

          {/* ── Series 顏色設定（分群/堆疊模式，單指標時才顯示） ─────────── */}
          {active.y_axes.length <= 1 && (active.series_field || active.stack_field) && (
            <div className="px-4 py-3 border-b border-gray-100 space-y-3">
              {/* B：順序色票 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] text-gray-400 font-medium">Series 顏色順序</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateActive({ series_palette: [...active.series_palette, '#5470c6'] })}
                      className="text-[10px] text-blue-500 hover:text-blue-700">+ 新增</button>
                    {active.series_palette.length > 0 && (
                      <button onClick={() => updateActive({ series_palette: [] })}
                        className="text-[10px] text-gray-400 hover:text-gray-600">重置預設</button>
                    )}
                  </div>
                </div>
                {active.series_palette.length === 0 && (
                  <p className="text-[10px] text-gray-300 italic">使用預設高對比色票（藍/綠/黃/紅...）</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {active.series_palette.map((c, i) => (
                    <div key={i} className="flex items-center gap-1 bg-gray-50 rounded px-1.5 py-1 border border-gray-200">
                      <span className="text-[10px] text-gray-400 w-4 text-center">{i + 1}</span>
                      <ColorPickerInput value={c}
                        onChange={v => updateActive({ series_palette: active.series_palette.map((x, j) => j === i ? v : x) })} />
                      <button onClick={() => updateActive({ series_palette: active.series_palette.filter((_, j) => j !== i) })}
                        className="text-gray-300 hover:text-red-400 text-[10px]">✕</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* C：值→顏色精確對應（從 rows 取得實際 series 值） */}
              {(() => {
                const sf = active.series_field || active.stack_field
                if (!sf) return null
                const vals = Array.from(new Set(rows.map(r => String(r[sf] ?? r[sf.toLowerCase()] ?? r[sf.toUpperCase()] ?? '')).filter(Boolean)))
                if (!vals.length) return null
                return (
                  <div>
                    <p className="text-[10px] text-gray-400 font-medium mb-1.5">值對應顏色（精確）</p>
                    <div className="space-y-1">
                      {vals.map(v => (
                        <div key={v} className="flex items-center gap-2">
                          <ColorPickerInput
                            value={active.series_colors[v] || '#cccccc'}
                            onChange={v2 => updateActive({ series_colors: { ...active.series_colors, [v]: v2 } })} />
                          <span className="text-[11px] text-gray-600 truncate flex-1">{v}</span>
                          {active.series_colors[v] && (
                            <button onClick={() => {
                              const next = { ...active.series_colors }
                              delete next[v]
                              updateActive({ series_colors: next })
                            }} className="text-gray-300 hover:text-red-400 text-[10px] flex-shrink-0">✕</button>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-300 mt-1">未設定的值 fallback 至順序色票</p>
                  </div>
                )
              })()}
            </div>
          )}

          {/* 疊加折線 (Option C) — bar 有 series_field 或 stack_field 才顯示 */}
          {active.chartType === 'bar' && active.y_axes.length <= 1 && (active.series_field || active.stack_field) && (
            <div className="px-4 py-3 border-b border-gray-100 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-gray-400">疊加折線</p>
                <button
                  onClick={() => updateActive({ overlay_lines: [...active.overlay_lines, { field: measures[0] || columns[0] || '', agg: 'SUM' }] })}
                  className="text-[10px] text-blue-500 hover:text-blue-700"
                >+ 新增</button>
              </div>
              {active.overlay_lines.map((ol, idx) => (
                <div key={idx} className="border border-gray-200 rounded p-2 bg-gray-50 space-y-1.5">
                  <div className="flex items-center gap-1">
                    <select value={ol.field}
                      onChange={e => updateActive({ overlay_lines: active.overlay_lines.map((o, i) => i === idx ? { ...o, field: e.target.value } : o) })}
                      className="flex-1 border border-gray-200 rounded px-1 py-0.5 text-[11px] focus:outline-none focus:border-blue-400 bg-white">
                      {columns.map(c => <option key={c} value={c}>{colLabel(c, columnLabels)}</option>)}
                    </select>
                    <select value={ol.agg}
                      onChange={e => updateActive({ overlay_lines: active.overlay_lines.map((o, i) => i === idx ? { ...o, agg: e.target.value as OverlayLine['agg'] } : o) })}
                      className="w-16 border border-gray-200 rounded px-1 py-0.5 text-[11px] focus:outline-none focus:border-blue-400 bg-white">
                      {['SUM','COUNT','AVG','MAX','MIN','COUNT_DISTINCT'].map(fn => <option key={fn} value={fn}>{fn}</option>)}
                    </select>
                    <ColorPickerInput value={ol.color || '#E66C37'}
                      onChange={v => updateActive({ overlay_lines: active.overlay_lines.map((o, i) => i === idx ? { ...o, color: v } : o) })} />
                    <button onClick={() => updateActive({ overlay_lines: active.overlay_lines.filter((_, i) => i !== idx) })}
                      className="text-gray-300 hover:text-red-500 text-xs ml-auto">✕</button>
                  </div>
                  <div className="flex items-center gap-1">
                    <input type="text" placeholder="名稱" value={ol.label || ''}
                      onChange={e => updateActive({ overlay_lines: active.overlay_lines.map((o, i) => i === idx ? { ...o, label: e.target.value || undefined } : o) })}
                      className="flex-1 border border-gray-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-400" />
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {[
                      { key: 'smooth',         label: '平滑' },
                      { key: 'dashed',         label: '虛線' },
                      { key: 'use_right_axis', label: '右軸' },
                    ].map(opt => (
                      <label key={opt.key} className="flex items-center gap-1 text-[11px] text-gray-600 cursor-pointer">
                        <input type="checkbox" checked={!!(ol as any)[opt.key]}
                          onChange={e => updateActive({ overlay_lines: active.overlay_lines.map((o, i) => i === idx ? { ...o, [opt.key]: e.target.checked } : o) })} />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              {active.overlay_lines.length === 0 && (
                <p className="text-[10px] text-gray-300 text-center py-1">在分組直條上疊加全域折線</p>
              )}
            </div>
          )}

          {/* 顏色主題 */}
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-[10px] text-gray-400 mb-1.5">色系</p>
            <div className="flex gap-1.5 flex-wrap">
              {PALETTE_OPTIONS.map(p => (
                <button key={p.key}
                  onClick={() => updateActive({ color_palette: active.color_palette === p.key ? undefined : p.key })}
                  className={`flex gap-0.5 p-0.5 rounded border transition-colors
                    ${active.color_palette === p.key ? 'border-blue-500 ring-1 ring-blue-300' : 'border-gray-200 hover:border-gray-300'}`}
                  title={p.key}
                >
                  {p.colors.map((c, i) => <span key={i} className="w-4 h-4 rounded-sm block" style={{ background: c }} />)}
                </button>
              ))}
            </div>
          </div>

          {/* ── 文字 / 軸線樣式 ─────────────────────────────────────────────── */}
          <div className="px-4 py-3 space-y-2">
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">文字 &amp; 軸線樣式</p>

            {/* 圖表底色 */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-16 flex-shrink-0">圖表底色</span>
              <ColorPickerInput value={active.chart_bg_color || '#ffffff'}
                onChange={v => updateActive({ chart_bg_color: v })} />
              {active.chart_bg_color && (
                <button onClick={() => updateActive({ chart_bg_color: '' })}
                  className="text-[10px] text-gray-300 hover:text-red-400">重設</button>
              )}
            </div>

            {/* 軸刻度 */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-16 flex-shrink-0">軸刻度</span>
              <ColorPickerInput value={active.axis_label_color || '#6b7280'}
                onChange={v => updateActive({ axis_label_color: v })} />
              <input type="number" min={8} max={24} value={active.axis_label_size}
                onChange={e => updateActive({ axis_label_size: e.target.value === '' ? '' : Number(e.target.value) })}
                className="w-12 border border-gray-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-400"
                placeholder="11px" />
              <button onClick={() => updateActive({ axis_label_bold: !active.axis_label_bold })}
                title="粗體"
                className={`text-[11px] px-1.5 py-0.5 rounded border font-bold ${active.axis_label_bold ? 'bg-blue-100 border-blue-400 text-blue-700' : 'border-gray-200 text-gray-400 hover:border-gray-400'}`}>B</button>
              {(active.axis_label_color || active.axis_label_size !== '' || active.axis_label_bold) && (
                <button onClick={() => updateActive({ axis_label_color: '', axis_label_size: '', axis_label_bold: false })}
                  className="text-[10px] text-gray-300 hover:text-red-400">重設</button>
              )}
            </div>

            {/* 軸線 */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-16 flex-shrink-0">軸線</span>
              <ColorPickerInput value={active.axis_line_color || '#e5e7eb'}
                onChange={v => updateActive({ axis_line_color: v })} />
              {active.axis_line_color && (
                <button onClick={() => updateActive({ axis_line_color: '' })}
                  className="text-[10px] text-gray-300 hover:text-red-400">重設</button>
              )}
            </div>

            {/* 格線 */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-16 flex-shrink-0">格線</span>
              <ColorPickerInput value={active.grid_line_color || '#f3f4f6'}
                onChange={v => updateActive({ grid_line_color: v })} />
              {active.grid_line_color && (
                <button onClick={() => updateActive({ grid_line_color: '' })}
                  className="text-[10px] text-gray-300 hover:text-red-400">重設</button>
              )}
            </div>

            {/* 資料標籤 */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-16 flex-shrink-0">資料標籤</span>
              <ColorPickerInput value={active.data_label_color || '#6b7280'}
                onChange={v => updateActive({ data_label_color: v })} />
              <input type="number" min={8} max={24} value={active.data_label_size}
                onChange={e => updateActive({ data_label_size: e.target.value === '' ? '' : Number(e.target.value) })}
                className="w-12 border border-gray-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-400"
                placeholder="11px" />
              <button onClick={() => updateActive({ data_label_bold: !active.data_label_bold })}
                title="粗體"
                className={`text-[11px] px-1.5 py-0.5 rounded border font-bold ${active.data_label_bold ? 'bg-blue-100 border-blue-400 text-blue-700' : 'border-gray-200 text-gray-400 hover:border-gray-400'}`}>B</button>
              {(active.data_label_color || active.data_label_size !== '' || active.data_label_bold) && (
                <button onClick={() => updateActive({ data_label_color: '', data_label_size: '', data_label_bold: false })}
                  className="text-[10px] text-gray-300 hover:text-red-400">重設</button>
              )}
            </div>

            {/* 圖例 */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-16 flex-shrink-0">圖例</span>
              <ColorPickerInput value={active.legend_color || '#6b7280'}
                onChange={v => updateActive({ legend_color: v })} />
              <input type="number" min={8} max={24} value={active.legend_size}
                onChange={e => updateActive({ legend_size: e.target.value === '' ? '' : Number(e.target.value) })}
                className="w-12 border border-gray-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-400"
                placeholder="12px" />
              <button onClick={() => updateActive({ legend_bold: !active.legend_bold })}
                title="粗體"
                className={`text-[11px] px-1.5 py-0.5 rounded border font-bold ${active.legend_bold ? 'bg-blue-100 border-blue-400 text-blue-700' : 'border-gray-200 text-gray-400 hover:border-gray-400'}`}>B</button>
            </div>
            {/* 圖例位置 */}
            <div className="flex items-center gap-2 pl-[72px]">
              <select value={active.legend_left} onChange={e => updateActive({ legend_left: e.target.value })}
                className="border border-gray-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-400">
                <option value="left">靠左</option>
                <option value="center">置中</option>
                <option value="right">靠右</option>
              </select>
              <select value={active.legend_top} onChange={e => updateActive({ legend_top: e.target.value })}
                className="border border-gray-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-400">
                <option value="">頂端（預設）</option>
                <option value="bottom">底部</option>
                <option value="middle">中間</option>
              </select>
              <select value={active.legend_orient} onChange={e => updateActive({ legend_orient: e.target.value as 'horizontal' | 'vertical' })}
                className="border border-gray-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-400">
                <option value="horizontal">橫排</option>
                <option value="vertical">直排</option>
              </select>
            </div>

            {/* 標題 */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-16 flex-shrink-0">標題</span>
              <ColorPickerInput value={active.title_color || '#374151'}
                onChange={v => updateActive({ title_color: v })} />
              <input type="number" min={8} max={32} value={active.title_size}
                onChange={e => updateActive({ title_size: e.target.value === '' ? '' : Number(e.target.value) })}
                className="w-12 border border-gray-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-400"
                placeholder="13px" />
              <button onClick={() => updateActive({ title_bold: !active.title_bold })}
                title="粗體"
                className={`text-[11px] px-1.5 py-0.5 rounded border font-bold ${active.title_bold ? 'bg-blue-100 border-blue-400 text-blue-700' : 'border-gray-200 text-gray-400 hover:border-gray-400'}`}>B</button>
            </div>
            {/* 標題位置 */}
            <div className="flex items-center gap-2 pl-[72px]">
              <select value={active.title_left} onChange={e => updateActive({ title_left: e.target.value })}
                className="border border-gray-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-400">
                <option value="auto">自動</option>
                <option value="left">靠左</option>
                <option value="center">置中</option>
                <option value="right">靠右</option>
              </select>
              <select value={active.title_top} onChange={e => updateActive({ title_top: e.target.value })}
                className="border border-gray-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-400">
                <option value="">頂端（預設）</option>
                <option value="middle">中間</option>
                <option value="bottom">底部</option>
              </select>
            </div>
          </div>
        </div>

        {/* ── Right: Live Preview ── */}
        <div className="flex-1 flex flex-col overflow-hidden p-6">
          {canPreview ? (
            <>
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <span className="text-xs text-gray-500">X：</span>
                <span className="text-xs font-medium text-blue-700">{colLabel(active.x_field!, columnLabels)}</span>
                <span className="text-xs text-gray-300">|</span>
                <span className="text-xs text-gray-500">Y：</span>
                <span className="text-xs font-medium text-orange-700">
                  {active.y_axes.length > 1
                    ? `${active.y_axes.length} 個指標`
                    : active.y_axes[0] ? `${colLabel(active.y_axes[0].field, columnLabels)} (${active.y_axes[0].agg})` : '—'}
                </span>
                {active.series_field && (<>
                  <span className="text-xs text-gray-300">|</span>
                  <span className="text-xs text-gray-500">分組：</span>
                  <span className="text-xs font-medium text-purple-700">{colLabel(active.series_field, columnLabels)}</span>
                </>)}
                {active.stack_field && (<>
                  <span className="text-xs text-gray-300">|</span>
                  <span className="text-xs text-gray-500">堆疊：</span>
                  <span className="text-xs font-medium text-teal-700">{colLabel(active.stack_field, columnLabels)}</span>
                </>)}
                <span className="ml-auto text-[10px] text-gray-400">{rows.length} 列</span>
              </div>
              <div className="flex-1 bg-white rounded-xl border border-gray-200 p-4 overflow-hidden">
                <AiChart chartDef={chartDef} rows={rows} columnLabels={columnLabels} height={undefined} />
              </div>
              {(active.series_field || active.stack_field) && (
                <div className="mt-3 text-[10px] text-gray-400 text-center">
                  {active.series_field && active.stack_field
                    ? `分組「${colLabel(active.series_field, columnLabels)}」並排，堆疊「${colLabel(active.stack_field, columnLabels)}」疊色`
                    : active.series_field
                      ? `依「${colLabel(active.series_field, columnLabels)}」分組並排`
                      : `依「${colLabel(active.stack_field!, columnLabels)}」堆疊`}
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-4">
              <div className="text-5xl">📊</div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-gray-500">從左側拖曳欄位開始</p>
                <p className="text-xs text-gray-400">先把維度拖到 X 軸，指標拖到 Y 軸</p>
              </div>
              <div className="flex items-center gap-6 text-xs text-gray-400 mt-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-blue-200 inline-block" />藍色 = 維度（文字/日期）
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-orange-200 inline-block" />橘色 = 指標（數值）
                </div>
              </div>
            </div>
          )}
        </div>

      </div>

      {draggingField && (
        <div className="fixed bottom-4 right-4 px-3 py-1.5 bg-gray-800 text-white text-xs rounded-lg shadow-lg pointer-events-none z-50">
          拖曳中：{colLabel(draggingField, columnLabels)}
        </div>
      )}
    </div>
  )
}
