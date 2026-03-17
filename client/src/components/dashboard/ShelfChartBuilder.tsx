/**
 * ShelfChartBuilder — Tableau 風格拖拉式圖表建構器
 * 使用 HTML5 原生 drag & drop，無額外依賴
 */
import { useState, useMemo, useRef } from 'react'
import type { AiChartConfig, AiChartDef, ChartColorPalette } from '../../types'
import AiChart from './AiChart'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { X, GripVertical, BarChart2, LineChart, PieChart, ScatterChart, Radar, Gauge } from 'lucide-react'

type AggFn = 'SUM' | 'COUNT' | 'AVG' | 'MAX' | 'MIN' | 'COUNT_DISTINCT'
type FieldType = 'dimension' | 'measure'
type ShelfKey = 'x_field' | 'y_field' | 'series_field' | 'stack_field'

interface ShelfState {
  x_field?: string
  y_field?: string
  y_agg: AggFn
  series_field?: string
  stack_field?: string
  chartType: AiChartDef['type']
  limit: number
  horizontal: boolean
  smooth: boolean
  area: boolean
  donut: boolean
  show_label: boolean
  show_legend: boolean
  color_palette?: ChartColorPalette
}

interface Props {
  rows: Record<string, unknown>[]
  columns: string[]
  columnLabels?: Record<string, string>
  initialConfig?: AiChartConfig | null
  onSave: (config: AiChartConfig) => void
  onClose: () => void
}

const CHART_TYPES: { type: AiChartDef['type']; icon: React.ReactNode; label: string }[] = [
  { type: 'bar',     icon: <BarChart2 size={14} />,  label: '長條' },
  { type: 'line',    icon: <LineChart size={14} />,  label: '折線' },
  { type: 'pie',     icon: <PieChart size={14} />,   label: '圓餅' },
  { type: 'scatter', icon: <ScatterChart size={14} />, label: '散佈' },
  { type: 'radar',   icon: <Radar size={14} />,      label: '雷達' },
  { type: 'gauge',   icon: <Gauge size={14} />,      label: '儀錶' },
]

const AGG_FNS: AggFn[] = ['SUM', 'COUNT', 'AVG', 'MAX', 'MIN', 'COUNT_DISTINCT']

const PALETTE_OPTIONS: { key: ChartColorPalette; colors: string[] }[] = [
  { key: 'blue',   colors: ['#118DFF', '#0093D5', '#12239E'] },
  { key: 'green',  colors: ['#009E49', '#00B294', '#10893E'] },
  { key: 'orange', colors: ['#E66C37', '#D9B300', '#F5B300'] },
  { key: 'purple', colors: ['#744EC2', '#6B007B', '#8764B8'] },
  { key: 'teal',   colors: ['#0099BC', '#038387', '#00B4D8'] },
]

/** 依資料推斷欄位類型：連續數值 → measure，否則 → dimension */
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

function initShelf(columns: string[], rows: Record<string, unknown>[], initialConfig?: AiChartConfig | null): ShelfState {
  const def = initialConfig?.charts?.[0]
  if (def) {
    return {
      x_field: def.x_field || columns[0],
      y_field: def.y_field || columns[1] || columns[0],
      y_agg: (def.agg_fn as AggFn) || 'SUM',
      series_field: def.series_field,
      stack_field: def.stack_field,
      chartType: def.type || 'bar',
      limit: def.limit || 20,
      horizontal: !!def.horizontal,
      smooth: def.smooth !== false,
      area: !!def.area,
      donut: !!def.donut,
      show_label: def.show_label !== false,
      show_legend: def.show_legend !== false,
      color_palette: def.color_palette,
    }
  }
  // 自動推斷初始欄位
  const types = Object.fromEntries(columns.map(c => [c, classifyField(c, rows)]))
  const dims = columns.filter(c => types[c] === 'dimension')
  const measures = columns.filter(c => types[c] === 'measure')
  return {
    x_field: dims[0] || columns[0],
    y_field: measures[0] || columns[1] || columns[0],
    y_agg: 'SUM',
    chartType: 'bar',
    limit: 20,
    horizontal: false,
    smooth: true,
    area: false,
    donut: false,
    show_label: true,
    show_legend: true,
  }
}

// ── Draggable field chip ───────────────────────────────────────────────────────
function FieldChip({
  col, label, type, onDragStart,
}: {
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
function ShelfSlot({
  label, fieldKey, value, agg, fieldType, rows, columns, columnLabels,
  onDrop, onRemove, onAggChange, acceptTypes = ['dimension', 'measure'],
}: {
  label: string
  fieldKey: ShelfKey
  value?: string
  agg?: AggFn
  fieldType?: FieldType
  rows: Record<string, unknown>[]
  columns: string[]
  columnLabels?: Record<string, string>
  onDrop: (key: ShelfKey, field: string) => void
  onRemove: (key: ShelfKey) => void
  onAggChange?: (agg: AggFn) => void
  acceptTypes?: FieldType[]
}) {
  const [over, setOver] = useState(false)

  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] text-gray-400 w-14 flex-shrink-0 mt-1.5 text-right">{label}</span>
      <div
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => {
          e.preventDefault()
          setOver(false)
          const field = e.dataTransfer.getData('field')
          if (field) onDrop(fieldKey, field)
        }}
        className={`flex-1 min-h-[30px] rounded border border-dashed flex flex-wrap gap-1 p-1 transition-colors
          ${over ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}
      >
        {value ? (
          <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs
            ${fieldType === 'measure' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
            <span className="font-medium">{colLabel(value, columnLabels)}</span>
            {fieldKey === 'y_field' && onAggChange && (
              <select
                value={agg || 'SUM'}
                onChange={e => onAggChange(e.target.value as AggFn)}
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

// ── Main Component ─────────────────────────────────────────────────────────────
export default function ShelfChartBuilder({ rows, columns, columnLabels, initialConfig, onSave, onClose }: Props) {
  const { t } = useTranslation()
  const [shelf, setShelf] = useState<ShelfState>(() => initShelf(columns, rows, initialConfig))
  const [translating, setTranslating] = useState(false)
  const [chartTitle, setChartTitle] = useState(initialConfig?.charts?.[0]?.title || '')
  const [titleEn, setTitleEn] = useState(initialConfig?.charts?.[0]?.title_en || '')
  const [titleVi, setTitleVi] = useState(initialConfig?.charts?.[0]?.title_vi || '')
  const [draggingField, setDraggingField] = useState<string | null>(null)

  // 欄位類型分類（memo，避免重複計算）
  const fieldTypes = useMemo(() =>
    Object.fromEntries(columns.map(c => [c, classifyField(c, rows)])),
    [columns, rows]
  )

  const dimensions = columns.filter(c => fieldTypes[c] === 'dimension')
  const measures   = columns.filter(c => fieldTypes[c] === 'measure')

  function updateShelf(patch: Partial<ShelfState>) {
    setShelf(prev => ({ ...prev, ...patch }))
  }

  function handleDrop(key: ShelfKey, field: string) {
    setDraggingField(null)
    // x_field / series / stack → 接受任何類型
    // y_field → 偏好 measure，但允許任何
    updateShelf({ [key]: field })
  }

  function handleRemove(key: ShelfKey) {
    updateShelf({ [key]: undefined })
  }

  // 建立 chartDef 給 AiChart preview
  const chartDef = useMemo((): AiChartDef => ({
    type: shelf.chartType,
    title: chartTitle || undefined,
    title_en: titleEn || undefined,
    title_vi: titleVi || undefined,
    x_field: shelf.x_field,
    y_field: shelf.y_field,
    label_field: shelf.x_field,
    value_field: shelf.y_field,
    series_field: shelf.series_field,
    stack_field: shelf.stack_field,
    agg_fn: shelf.y_agg,
    limit: shelf.limit,
    horizontal: shelf.horizontal,
    smooth: shelf.smooth,
    area: shelf.area,
    donut: shelf.donut,
    show_label: shelf.show_label,
    show_legend: shelf.show_legend,
    color_palette: shelf.color_palette,
  }), [shelf, chartTitle, titleEn, titleVi])

  async function translateTitle() {
    if (!chartTitle) return
    setTranslating(true)
    try {
      const r = await api.post('/dashboard/translate-text', { text: chartTitle })
      setTitleEn(r.data.en || '')
      setTitleVi(r.data.vi || '')
    } catch (e) { console.error(e) }
    finally { setTranslating(false) }
  }

  function handleSave() {
    const cfg: AiChartConfig = {
      default_chart: shelf.chartType,
      allow_table: true,
      allow_export: true,
      available_columns: columns.map(c => ({ key: c, label: colLabel(c, columnLabels) })),
      charts: [{ ...chartDef, agg_fn: shelf.y_agg }],
    }
    onSave(cfg)
    onClose()
  }

  const canPreview = !!(shelf.x_field && shelf.y_field)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-50" style={{ fontFamily: 'inherit' }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={16} />
          </button>
          <span className="font-semibold text-sm text-gray-800">Tableau 模式</span>
          <span className="text-xs text-gray-400">拖曳左側欄位到 Shelf 即時預覽</span>
        </div>
        <button
          onClick={handleSave}
          disabled={!canPreview}
          className="px-4 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-40"
        >
          {t('common.save')}
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: Field List ── */}
        <div className="w-52 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 overflow-y-auto">
          <div className="px-3 py-2 border-b border-gray-100">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">欄位</span>
          </div>

          {/* Dimensions */}
          {dimensions.length > 0 && (
            <div className="px-3 py-2">
              <p className="text-[9px] font-semibold text-blue-500 uppercase mb-1.5">📐 維度</p>
              <div className="space-y-1">
                {dimensions.map(col => (
                  <FieldChip
                    key={col}
                    col={col}
                    label={colLabel(col, columnLabels)}
                    type="dimension"
                    onDragStart={setDraggingField}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Measures */}
          {measures.length > 0 && (
            <div className="px-3 py-2">
              <p className="text-[9px] font-semibold text-orange-500 uppercase mb-1.5">📊 指標</p>
              <div className="space-y-1">
                {measures.map(col => (
                  <FieldChip
                    key={col}
                    col={col}
                    label={colLabel(col, columnLabels)}
                    type="measure"
                    onDragStart={setDraggingField}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 如果自動分類不準，可手動切換 */}
          <div className="px-3 py-2 mt-auto border-t border-gray-100">
            <p className="text-[9px] text-gray-400 leading-relaxed">
              分類依資料樣本自動推斷<br />
              <span className="text-blue-400">藍 Aa</span> = 維度 &nbsp;
              <span className="text-orange-400"># 橘</span> = 指標
            </p>
          </div>
        </div>

        {/* ── Center: Shelves + Options ── */}
        <div className="w-80 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 overflow-y-auto">

          {/* Chart type selector */}
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-[10px] text-gray-400 mb-2">圖表類型</p>
            <div className="flex flex-wrap gap-1">
              {CHART_TYPES.map(ct => (
                <button
                  key={ct.type}
                  onClick={() => updateShelf({ chartType: ct.type })}
                  className={`flex items-center gap-1 px-2 py-1 rounded border text-xs transition-colors
                    ${shelf.chartType === ct.type
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

            <ShelfSlot
              label="X 軸"
              fieldKey="x_field"
              value={shelf.x_field}
              fieldType={shelf.x_field ? fieldTypes[shelf.x_field] : undefined}
              rows={rows} columns={columns} columnLabels={columnLabels}
              onDrop={handleDrop} onRemove={handleRemove}
            />
            <ShelfSlot
              label="Y 軸"
              fieldKey="y_field"
              value={shelf.y_field}
              agg={shelf.y_agg}
              fieldType={shelf.y_field ? fieldTypes[shelf.y_field] : undefined}
              rows={rows} columns={columns} columnLabels={columnLabels}
              onDrop={handleDrop} onRemove={handleRemove}
              onAggChange={agg => updateShelf({ y_agg: agg })}
            />

            {(shelf.chartType === 'bar' || shelf.chartType === 'line') && (
              <>
                <ShelfSlot
                  label="分組"
                  fieldKey="series_field"
                  value={shelf.series_field}
                  fieldType={shelf.series_field ? fieldTypes[shelf.series_field] : undefined}
                  rows={rows} columns={columns} columnLabels={columnLabels}
                  onDrop={handleDrop} onRemove={handleRemove}
                />
                <ShelfSlot
                  label="堆疊"
                  fieldKey="stack_field"
                  value={shelf.stack_field}
                  fieldType={shelf.stack_field ? fieldTypes[shelf.stack_field] : undefined}
                  rows={rows} columns={columns} columnLabels={columnLabels}
                  onDrop={handleDrop} onRemove={handleRemove}
                />
              </>
            )}
          </div>

          {/* 圖表標題 */}
          <div className="px-4 py-3 border-b border-gray-100 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-gray-400">圖表標題</p>
              <button
                onClick={translateTitle}
                disabled={translating || !chartTitle}
                className="text-[10px] px-1.5 py-0.5 rounded border border-blue-200 text-blue-500 hover:bg-blue-50 disabled:opacity-40"
              >
                {translating ? '...' : '↻ 翻譯'}
              </button>
            </div>
            <input
              type="text" value={chartTitle} onChange={e => setChartTitle(e.target.value)}
              placeholder="(選填)"
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
            />
            <div className="grid grid-cols-2 gap-1">
              <input type="text" value={titleEn} onChange={e => setTitleEn(e.target.value)}
                placeholder="Title (EN)"
                className="border border-gray-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-400"
              />
              <input type="text" value={titleVi} onChange={e => setTitleVi(e.target.value)}
                placeholder="Tiêu đề (VI)"
                className="border border-gray-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>

          {/* 顯示選項 */}
          <div className="px-4 py-3 border-b border-gray-100 space-y-1.5">
            <p className="text-[10px] text-gray-400 mb-1">顯示選項</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {shelf.chartType === 'bar' && (
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={shelf.horizontal} onChange={e => updateShelf({ horizontal: e.target.checked })} />
                  橫向
                </label>
              )}
              {shelf.chartType === 'line' && (
                <>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={shelf.smooth} onChange={e => updateShelf({ smooth: e.target.checked })} />
                    平滑
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={shelf.area} onChange={e => updateShelf({ area: e.target.checked })} />
                    面積
                  </label>
                </>
              )}
              {shelf.chartType === 'pie' && (
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={shelf.donut} onChange={e => updateShelf({ donut: e.target.checked })} />
                  環形
                </label>
              )}
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={shelf.show_label} onChange={e => updateShelf({ show_label: e.target.checked })} />
                數值標籤
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={shelf.show_legend} onChange={e => updateShelf({ show_legend: e.target.checked })} />
                圖例
              </label>
            </div>

            {/* 前 N 筆 */}
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-gray-500">前 N 筆</span>
              <input
                type="number" min={1} max={500} value={shelf.limit}
                onChange={e => updateShelf({ limit: parseInt(e.target.value) || 20 })}
                className="w-20 border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>

          {/* 顏色主題 */}
          <div className="px-4 py-3">
            <p className="text-[10px] text-gray-400 mb-1.5">色系</p>
            <div className="flex gap-1.5 flex-wrap">
              {PALETTE_OPTIONS.map(p => (
                <button
                  key={p.key}
                  onClick={() => updateShelf({ color_palette: shelf.color_palette === p.key ? undefined : p.key })}
                  className={`flex gap-0.5 p-0.5 rounded border transition-colors
                    ${shelf.color_palette === p.key ? 'border-blue-500 ring-1 ring-blue-300' : 'border-gray-200 hover:border-gray-300'}`}
                  title={p.key}
                >
                  {p.colors.map((c, i) => (
                    <span key={i} className="w-4 h-4 rounded-sm block" style={{ background: c }} />
                  ))}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Live Preview ── */}
        <div className="flex-1 flex flex-col overflow-hidden p-6">
          {canPreview ? (
            <>
              {/* 當前設定摘要 */}
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <span className="text-xs text-gray-500">X：</span>
                <span className="text-xs font-medium text-blue-700">{colLabel(shelf.x_field!, columnLabels)}</span>
                <span className="text-xs text-gray-300">|</span>
                <span className="text-xs text-gray-500">Y：</span>
                <span className="text-xs font-medium text-orange-700">{colLabel(shelf.y_field!, columnLabels)} ({shelf.y_agg})</span>
                {shelf.series_field && (
                  <>
                    <span className="text-xs text-gray-300">|</span>
                    <span className="text-xs text-gray-500">分組：</span>
                    <span className="text-xs font-medium text-purple-700">{colLabel(shelf.series_field, columnLabels)}</span>
                  </>
                )}
                {shelf.stack_field && (
                  <>
                    <span className="text-xs text-gray-300">|</span>
                    <span className="text-xs text-gray-500">堆疊：</span>
                    <span className="text-xs font-medium text-teal-700">{colLabel(shelf.stack_field, columnLabels)}</span>
                  </>
                )}
                <span className="ml-auto text-[10px] text-gray-400">{rows.length} 列</span>
              </div>

              {/* Chart */}
              <div className="flex-1 bg-white rounded-xl border border-gray-200 p-4 overflow-hidden">
                <AiChart
                  chartDef={chartDef}
                  rows={rows}
                  columnLabels={columnLabels}
                  height={undefined}
                />
              </div>

              {/* 多維度說明 */}
              {(shelf.series_field || shelf.stack_field) && (
                <div className="mt-3 text-[10px] text-gray-400 text-center">
                  {shelf.series_field && shelf.stack_field
                    ? `分組「${colLabel(shelf.series_field, columnLabels)}」並排，堆疊「${colLabel(shelf.stack_field, columnLabels)}」疊色`
                    : shelf.series_field
                      ? `依「${colLabel(shelf.series_field, columnLabels)}」分組並排`
                      : `依「${colLabel(shelf.stack_field!, columnLabels)}」堆疊`}
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
                  <span className="w-3 h-3 rounded-sm bg-blue-200 inline-block" />
                  藍色 = 維度（文字/日期）
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-orange-200 inline-block" />
                  橘色 = 指標（數值）
                </div>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* ── Drag ghost indicator ── */}
      {draggingField && (
        <div className="fixed bottom-4 right-4 px-3 py-1.5 bg-gray-800 text-white text-xs rounded-lg shadow-lg pointer-events-none z-50">
          拖曳中：{colLabel(draggingField, columnLabels)}
        </div>
      )}
    </div>
  )
}
