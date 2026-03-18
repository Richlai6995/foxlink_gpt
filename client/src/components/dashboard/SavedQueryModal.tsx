/**
 * SavedQueryModal — 儲存/編輯命名查詢
 * 包含：基本資訊 / 查詢參數 / 圖表設定
 */
import { useState, useEffect, useMemo } from 'react'
import api from '../../lib/api'
import type {
  AiSavedQuery, AiQueryParameter, AiSchemaDef, AiSchemaColumn,
  AiChartConfig, AiChartDef, ChartColorPalette, YAxisDef, OverlayLine,
} from '../../types'
import { useTranslation } from 'react-i18next'
import TranslationFields from '../common/TranslationFields'
import type { TranslationData } from '../common/TranslationFields'
import ColorPickerInput from '../common/ColorPickerInput'

interface Props {
  initial?: Partial<AiSavedQuery>
  designId?: number
  question?: string
  pinnedSql?: string
  detectedSql?: string
  chartConfig?: string | null   // JSON string — 新增時帶入
  onSave: (saved: AiSavedQuery) => void
  onClose: () => void
}

type TabKey = 'basic' | 'params' | 'chart'
type AggFn = 'SUM' | 'COUNT' | 'AVG' | 'MAX' | 'MIN' | 'COUNT_DISTINCT'

function genParamId() { return `p_${Date.now().toString(36)}` }

function extractWhereColumns(sql: string): string[] {
  if (!sql) return []
  const cleaned = sql.replace(/'[^']*'/g, "''").replace(/--[^\n]*/g, '')
  const whereMatch = cleaned.match(/\bWHERE\b([\s\S]+?)(?:\bORDER\s+BY\b|\bGROUP\s+BY\b|\bHAVING\b|\bFETCH\s+FIRST\b|$)/i)
  if (!whereMatch) return []
  const clause = whereMatch[1]
  const cols = new Set<string>()
  const pattern = /\b([A-Z][A-Z0-9_]{2,})\s*(?:=|!=|<>|>=|<=|>|<|\bIN\b|\bLIKE\b|\bBETWEEN\b|\bIS\s)/gi
  const reserved = new Set(['AND','NOT','NULL','BETWEEN','EXISTS','CASE','WHEN','THEN','ELSE','END','TRUE','FALSE','UPPER','LOWER','TRIM','NVL','DECODE','ROWNUM'])
  let m
  while ((m = pattern.exec(clause)) !== null) {
    const col = m[1].toUpperCase()
    if (!reserved.has(col)) cols.add(col)
  }
  return [...cols]
}

// ── 圖表設定內嵌元件 ──────────────────────────────────────────────────────────

const CHART_TYPES: { type: AiChartDef['type']; label: string; icon: string }[] = [
  { type: 'bar',     label: '長條圖', icon: '📊' },
  { type: 'line',    label: '折線圖', icon: '📈' },
  { type: 'pie',     label: '圓餅圖', icon: '🍕' },
  { type: 'scatter', label: '散佈圖', icon: '⚫' },
  { type: 'radar',   label: '雷達圖', icon: '🕸' },
]
const AGG_FNS: AggFn[] = ['SUM', 'COUNT', 'AVG', 'MAX', 'MIN', 'COUNT_DISTINCT']
const PALETTE_OPTIONS: { key: ChartColorPalette; label: string; colors: string[] }[] = [
  { key: 'blue',   label: '藍', colors: ['#118DFF','#0093D5','#12239E'] },
  { key: 'green',  label: '綠', colors: ['#009E49','#00B294','#10893E'] },
  { key: 'orange', label: '橘', colors: ['#E66C37','#D9B300','#F5B300'] },
  { key: 'purple', label: '紫', colors: ['#744EC2','#6B007B','#8764B8'] },
  { key: 'teal',   label: '青', colors: ['#0099BC','#038387','#00B4D8'] },
]

function newYAxisDef(cols: { key: string }[]): YAxisDef {
  return { field: cols[0]?.key || '', agg: 'SUM', chart_type: 'bar' }
}

interface YAxesPanelSQProps {
  y_axes: YAxisDef[]
  cols: { key: string; label: string }[]
  onChange: (y_axes: YAxisDef[]) => void
}

function YAxesPanelSQ({ y_axes, cols, onChange }: YAxesPanelSQProps) {
  function update(idx: number, patch: Partial<YAxisDef>) {
    onChange(y_axes.map((ax, i) => i === idx ? { ...ax, ...patch } : ax))
  }
  return (
    <div className="space-y-2">
      {y_axes.map((ax, idx) => (
        <div key={idx} className="border border-gray-200 rounded p-2 space-y-1.5 bg-gray-50">
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400 w-4">{idx + 1}</span>
            <select value={ax.field} onChange={e => update(idx, { field: e.target.value })}
              className="flex-1 border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400">
              {cols.map(c => <option key={c.key} value={c.key}>{c.label} ({c.key})</option>)}
            </select>
            <select value={ax.agg} onChange={e => update(idx, { agg: e.target.value as YAxisDef['agg'] })}
              className="w-20 border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400">
              {AGG_FNS.map(fn => <option key={fn} value={fn}>{fn}</option>)}
            </select>
            <select value={ax.chart_type} onChange={e => update(idx, { chart_type: e.target.value as 'bar' | 'line' })}
              className="w-14 border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400">
              <option value="bar">Bar</option>
              <option value="line">Line</option>
            </select>
            <ColorPickerInput value={ax.color || '#118DFF'} onChange={v => update(idx, { color: v })} title="顏色" />
            <button onClick={() => onChange(y_axes.filter((_, i) => i !== idx))}
              className="text-gray-300 hover:text-red-500 text-xs ml-auto">✕</button>
          </div>
          <div className="flex gap-1">
            <input type="text" placeholder="名稱 (label)" value={ax.label || ''}
              onChange={e => update(idx, { label: e.target.value || undefined })}
              className="flex-1 border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400" />
            {ax.chart_type === 'bar' && (
              <input type="text" placeholder="寬度 e.g. 40%" value={ax.bar_width || ''}
                onChange={e => update(idx, { bar_width: e.target.value || undefined })}
                className="w-24 border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400" />
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={!!ax.gradient} onChange={e => update(idx, { gradient: e.target.checked })} />漸層
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={!!ax.shadow} onChange={e => update(idx, { shadow: e.target.checked })} />陰影
            </label>
            {ax.chart_type === 'bar' && (
              <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={!!ax.overlap} onChange={e => update(idx, { overlap: e.target.checked })} />套疊
              </label>
            )}
            {ax.chart_type === 'line' && (<>
              <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={!!ax.smooth} onChange={e => update(idx, { smooth: e.target.checked })} />平滑
              </label>
              <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={!!ax.area} onChange={e => update(idx, { area: e.target.checked })} />面積
              </label>
            </>)}
            <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={!!ax.use_right_axis} onChange={e => update(idx, { use_right_axis: e.target.checked })} />右軸
            </label>
          </div>
        </div>
      ))}
      <button onClick={() => onChange([...y_axes, newYAxisDef(cols)])}
        className="w-full py-1 border border-dashed border-blue-300 text-blue-500 text-xs rounded hover:bg-blue-50">
        + 新增 Y 軸 series
      </button>
    </div>
  )
}

type ChartDraft = AiChartDef & { _id: string; _agg: AggFn }

function newChartDraft(cols: { key: string; label: string }[]): ChartDraft {
  return {
    _id: crypto.randomUUID(),
    _agg: 'SUM',
    type: 'bar',
    title: '',
    x_field: cols[0]?.key || '',
    y_field: cols[1]?.key || cols[0]?.key || '',
    label_field: cols[0]?.key || '',
    value_field: cols[1]?.key || cols[0]?.key || '',
    show_label: true,
    agg_fn: 'SUM',
    limit: 20,
  }
}

function draftFromDef(def: AiChartDef): ChartDraft {
  return { ...def, _id: crypto.randomUUID(), _agg: (def.agg_fn as AggFn) || 'SUM' }
}

interface ChartEditorProps {
  initialConfig: AiChartConfig | null
  onChange: (cfg: AiChartConfig) => void
}

function ChartEditor({ initialConfig, onChange }: ChartEditorProps) {
  const { t } = useTranslation()
  const availCols = initialConfig?.available_columns || []
  const [charts, setCharts] = useState<ChartDraft[]>(() =>
    initialConfig?.charts?.length
      ? initialConfig.charts.map(draftFromDef)
      : [newChartDraft(availCols)]
  )
  const [activeIdx, setActiveIdx] = useState(0)
  const [colInput, setColInput] = useState('')  // 手動新增欄位
  const [translating, setTranslating] = useState(false)

  const active = charts[activeIdx]
  const [cols, setCols] = useState<{ key: string; label: string }[]>(availCols)

  function updateActive(patch: Partial<ChartDraft>) {
    setCharts(prev => {
      const next = prev.map((c, i) => i === activeIdx ? { ...c, ...patch } : c)
      notifyChange(next, cols)
      return next
    })
  }

  function notifyChange(drafts: ChartDraft[], columns: { key: string; label: string }[]) {
    const cfg: AiChartConfig = {
      default_chart: drafts[0]?.type || 'bar',
      allow_table: true,
      allow_export: true,
      available_columns: columns,
      charts: drafts.map(({ _id, _agg, ...def }) => ({ ...def, agg_fn: _agg })),
    }
    onChange(cfg)
  }

  function addChart() {
    const draft = newChartDraft(cols)
    setCharts(prev => {
      const next = [...prev, draft]
      notifyChange(next, cols)
      return next
    })
    setActiveIdx(charts.length)
  }

  function removeChart() {
    setCharts(prev => {
      const next = prev.filter((_, i) => i !== activeIdx)
      notifyChange(next, cols)
      return next
    })
    setActiveIdx(Math.max(0, activeIdx - 1))
  }

  function addCol() {
    const key = colInput.trim().toLowerCase()
    if (!key || cols.find(c => c.key === key)) return
    const next = [...cols, { key, label: key }]
    setCols(next)
    setColInput('')
    notifyChange(charts, next)
  }

  async function translateChartFields() {
    if (!active || !active.title) return
    setTranslating(true)
    try {
      const r = await api.post('/dashboard/translate-text', { text: active.title })
      const patch: Partial<ChartDraft> = { title_en: r.data.en, title_vi: r.data.vi }
      if (active.x_axis_name) {
        const rx = await api.post('/dashboard/translate-text', { text: active.x_axis_name })
        patch.x_axis_name_en = rx.data.en
        patch.x_axis_name_vi = rx.data.vi
      }
      if (active.y_axis_name) {
        const ry = await api.post('/dashboard/translate-text', { text: active.y_axis_name })
        patch.y_axis_name_en = ry.data.en
        patch.y_axis_name_vi = ry.data.vi
      }
      updateActive(patch)
    } finally {
      setTranslating(false)
    }
  }

  if (!active) return (
    <div className="text-center py-8 text-sm text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
      {t('aiDash.sqModal.noChartConfig')}
      <button onClick={addChart} className="block mx-auto mt-2 px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">
        {t('aiDash.sqModal.addNewChart')}
      </button>
    </div>
  )

  const FieldSelect = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      {cols.length > 0 ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-400"
        >
          <option value="">-- {t('aiDash.sqModal.selectField')} --</option>
          {cols.map(c => <option key={c.key} value={c.key}>{c.label} ({c.key})</option>)}
        </select>
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={t('aiDash.sqModal.colNamePh')}
          className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
        />
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      {/* 圖表 tabs 列 */}
      <div className="flex items-center gap-1 border-b border-gray-100 pb-1 overflow-x-auto">
        {charts.map((c, i) => (
          <button key={c._id} onClick={() => setActiveIdx(i)}
            className={`flex-shrink-0 px-3 py-1 text-xs rounded-t border transition-colors
              ${activeIdx === i ? 'border-blue-400 bg-blue-50 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >{c.title || `${t('aiDash.sqModal.chartTabN')} ${i + 1}`}</button>
        ))}
        <button onClick={addChart} className="flex-shrink-0 px-2 py-1 text-xs text-gray-400 hover:text-blue-600">+ {t('aiDash.sqModal.chartAdd')}</button>
        {charts.length > 1 && (
          <button onClick={removeChart} className="flex-shrink-0 ml-auto px-2 py-1 text-xs text-red-400 hover:text-red-600">✕ {t('aiDash.sqModal.chartRemove')}</button>
        )}
      </div>

      {/* 圖表標題 (多語言) */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-gray-500">{t('aiDash.sqModal.chartTitleLabel')}</label>
          <button
            type="button"
            onClick={translateChartFields}
            disabled={translating || !active.title}
            className="text-xs px-2 py-0.5 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {translating ? '...' : `↻ ${t('aiDash.cb.translate')}`}
          </button>
        </div>
        <input type="text" value={active.title || ''} placeholder={`(${t('common.optional')})`}
          onChange={e => updateActive({ title: e.target.value })}
          className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400 mb-1"
        />
        <div className="grid grid-cols-2 gap-1">
          <input type="text" value={active.title_en || ''} placeholder="Title (EN)"
            onChange={e => updateActive({ title_en: e.target.value })}
            className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
          />
          <input type="text" value={active.title_vi || ''} placeholder="Tiêu đề (VI)"
            onChange={e => updateActive({ title_vi: e.target.value })}
            className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
          />
        </div>
      </div>

      {/* 圖表類型 */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">{t('aiDash.sqModal.chartType')}</label>
        <div className="flex gap-1 flex-wrap">
          {CHART_TYPES.map(ct => (
            <button key={ct.type} onClick={() => updateActive({ type: ct.type })}
              className={`px-2 py-1 rounded border text-xs transition-colors
                ${active.type === ct.type ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
            >{ct.icon} {t(`aiDash.sqModal.chartTypeLabel_${ct.type}`, ct.label)}</button>
          ))}
        </div>
      </div>

      {/* X / Y 欄位 */}
      <div className="grid grid-cols-2 gap-3">
        <FieldSelect
          label={active.type === 'pie' ? t('aiDash.sqModal.labelField') : t('aiDash.sqModal.xField')}
          value={active.x_field || ''}
          onChange={v => updateActive({ x_field: v, label_field: v })}
        />
        <div>
          <label className="text-xs text-gray-500 block mb-1">
            {active.type === 'pie' ? t('aiDash.sqModal.valueField') : t('aiDash.sqModal.yField')}
          </label>
          <div className="flex gap-1">
            {cols.length > 0 ? (
              <select value={active.y_field || ''} onChange={e => updateActive({ y_field: e.target.value, value_field: e.target.value })}
                className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-400">
                <option value="">-- {t('aiDash.sqModal.selectField')} --</option>
                {cols.map(c => <option key={c.key} value={c.key}>{c.label} ({c.key})</option>)}
              </select>
            ) : (
              <input type="text" value={active.y_field || ''} placeholder={t('aiDash.sqModal.colNamePh')}
                onChange={e => updateActive({ y_field: e.target.value, value_field: e.target.value })}
                className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
              />
            )}
            <select value={active._agg || 'SUM'}
              onChange={e => updateActive({ _agg: e.target.value as AggFn, agg_fn: e.target.value as AggFn })}
              className="w-20 border border-gray-200 rounded px-1 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-400">
              {AGG_FNS.map(fn => <option key={fn} value={fn}>{fn}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* 分組 / 堆疊維度（bar / line only，y_axes 啟用時隱藏）*/}
      {(active.type === 'bar' || active.type === 'line') && !(active.y_axes?.length) && (
        <div className="grid grid-cols-2 gap-3">
          <FieldSelect
            label={t('aiDash.sqModal.seriesField')}
            value={active.series_field || ''}
            onChange={v => updateActive({ series_field: v || undefined })}
          />
          <FieldSelect
            label={t('aiDash.sqModal.stackField')}
            value={active.stack_field || ''}
            onChange={v => updateActive({ stack_field: v || undefined })}
          />
        </div>
      )}

      {/* 複數 Y 軸 (Method B) */}
      {(active.type === 'bar' || active.type === 'line') && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-500">複數 Y 軸 (進階)</label>
            {(active.y_axes?.length ?? 0) > 0 && (
              <button onClick={() => updateActive({ y_axes: undefined, series_field: undefined, stack_field: undefined })}
                className="text-xs text-gray-400 hover:text-red-500">清除全部</button>
            )}
          </div>
          <YAxesPanelSQ
            y_axes={active.y_axes || []}
            cols={cols}
            onChange={y_axes => updateActive({ y_axes: y_axes.length ? y_axes : undefined })}
          />
        </div>
      )}

      {/* 疊加折線 (Option C) — bar 有 series_field 或 stack_field 且無 y_axes 時顯示 */}
      {active.type === 'bar' && (active.series_field || active.stack_field) && !active.y_axes?.length && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-500">疊加折線</label>
            <button
              onClick={() => updateActive({ overlay_lines: [...(active.overlay_lines || []), { field: cols[0]?.key || '', agg: 'SUM' }] })}
              className="text-xs text-blue-500 hover:text-blue-700"
            >+ 新增</button>
          </div>
          {(active.overlay_lines || []).map((ol, idx) => (
            <div key={idx} className="border border-gray-200 rounded p-2 mb-1.5 bg-gray-50 space-y-1.5">
              <div className="flex items-center gap-1">
                <select value={ol.field}
                  onChange={e => updateActive({ overlay_lines: (active.overlay_lines || []).map((o, i) => i === idx ? { ...o, field: e.target.value } : o) })}
                  className="flex-1 border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400 bg-white">
                  {cols.map(c => <option key={c.key} value={c.key}>{c.label} ({c.key})</option>)}
                </select>
                <select value={ol.agg}
                  onChange={e => updateActive({ overlay_lines: (active.overlay_lines || []).map((o, i) => i === idx ? { ...o, agg: e.target.value as OverlayLine['agg'] } : o) })}
                  className="w-20 border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400 bg-white">
                  {AGG_FNS.map(fn => <option key={fn} value={fn}>{fn}</option>)}
                </select>
                <ColorPickerInput value={ol.color || '#E66C37'}
                  onChange={v => updateActive({ overlay_lines: (active.overlay_lines || []).map((o, i) => i === idx ? { ...o, color: v } : o) })}
                  title="顏色" />
                <button onClick={() => updateActive({ overlay_lines: (active.overlay_lines || []).filter((_, i) => i !== idx) })}
                  className="text-gray-300 hover:text-red-500 text-xs ml-auto">✕</button>
              </div>
              <input type="text" placeholder="名稱 (label)" value={ol.label || ''}
                onChange={e => updateActive({ overlay_lines: (active.overlay_lines || []).map((o, i) => i === idx ? { ...o, label: e.target.value || undefined } : o) })}
                className="w-full border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400" />
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {([['smooth', '平滑'], ['dashed', '虛線'], ['use_right_axis', '右軸']] as [keyof OverlayLine, string][]).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={!!(ol as any)[key]}
                      onChange={e => updateActive({ overlay_lines: (active.overlay_lines || []).map((o, i) => i === idx ? { ...o, [key]: e.target.checked } : o) })} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {!(active.overlay_lines?.length) && (
            <p className="text-xs text-gray-300 text-center py-1">在分組直條上疊加全域折線（先設定分組/堆疊欄位）</p>
          )}
        </div>
      )}

      {/* X/Y 軸標題 (多語言) + 顯示前 N 筆 */}
      {active.type !== 'pie' && active.type !== 'gauge' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">{t('aiDash.sqModal.xAxisName')}</label>
              <input type="text" value={active.x_axis_name || ''} placeholder={`(${t('common.optional')})`}
                onChange={e => updateActive({ x_axis_name: e.target.value })}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400 mb-0.5"
              />
              <div className="grid grid-cols-2 gap-1">
                <input type="text" value={active.x_axis_name_en || ''} placeholder="X Axis (EN)"
                  onChange={e => updateActive({ x_axis_name_en: e.target.value })}
                  className="border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-blue-400"
                />
                <input type="text" value={active.x_axis_name_vi || ''} placeholder="Trục X (VI)"
                  onChange={e => updateActive({ x_axis_name_vi: e.target.value })}
                  className="border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">{t('aiDash.sqModal.yAxisName')}</label>
              <input type="text" value={active.y_axis_name || ''} placeholder={`(${t('common.optional')})`}
                onChange={e => updateActive({ y_axis_name: e.target.value })}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400 mb-0.5"
              />
              <div className="grid grid-cols-2 gap-1">
                <input type="text" value={active.y_axis_name_en || ''} placeholder="Y Axis (EN)"
                  onChange={e => updateActive({ y_axis_name_en: e.target.value })}
                  className="border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-blue-400"
                />
                <input type="text" value={active.y_axis_name_vi || ''} placeholder="Trục Y (VI)"
                  onChange={e => updateActive({ y_axis_name_vi: e.target.value })}
                  className="border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t('aiDash.sqModal.topN')}</label>
            <input type="number" min={1} max={500} value={active.limit || 20}
              onChange={e => updateActive({ limit: parseInt(e.target.value) || 20 })}
              className="w-24 border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400"
            />
          </div>
        </div>
      )}

      {/* 排序設定 */}
      {active.type !== 'pie' && active.type !== 'gauge' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t('aiDash.sqModal.sortBy')}</label>
            <select
              value={active.sort_by || 'none'}
              onChange={e => updateActive({ sort_by: e.target.value as AiChartDef['sort_by'] })}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-400"
            >
              <option value="none">{t('aiDash.sqModal.sortNone')}</option>
              <option value="x">{t('aiDash.sqModal.sortX')}</option>
              <option value="y">{t('aiDash.sqModal.sortY')}</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t('aiDash.sqModal.sortOrder')}</label>
            <select
              value={active.sort_order || 'asc'}
              onChange={e => updateActive({ sort_order: e.target.value as AiChartDef['sort_order'] })}
              disabled={!active.sort_by || active.sort_by === 'none'}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-400 disabled:opacity-40"
            >
              <option value="asc">{t('aiDash.sqModal.sortAsc')}</option>
              <option value="desc">{t('aiDash.sqModal.sortDesc')}</option>
            </select>
          </div>
        </div>
      )}

      {/* 數值門檻 (min_value) + Pie top-N */}
      {(active.type === 'bar' || active.type === 'line' || active.type === 'scatter' || active.type === 'pie') && (
        <div className={`grid gap-2 ${active.type === 'pie' ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t('aiDash.sqModal.minValueFilter')}</label>
            <input
              type="number"
              min={0}
              value={active.min_value ?? ''}
              onChange={e => updateActive({ min_value: e.target.value === '' ? undefined : Number(e.target.value) })}
              placeholder={t('aiDash.sqModal.noLimit')}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
          {active.type === 'pie' && (
            <div>
              <label className="text-xs text-gray-500 block mb-1">{t('aiDash.sqModal.pieTopN')}</label>
              <input
                type="number"
                min={1}
                max={50}
                value={active.limit ?? ''}
                onChange={e => updateActive({ limit: e.target.value === '' ? undefined : parseInt(e.target.value) })}
                placeholder={t('aiDash.sqModal.allSlices')}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
              />
            </div>
          )}
        </div>
      )}

      {/* 顏色主題 */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">{t('aiDash.sqModal.colorTheme')}</label>
        <div className="flex gap-1.5 flex-wrap">
          {PALETTE_OPTIONS.map(p => (
            <button key={p.key} onClick={() => updateActive({ color_palette: p.key })} title={p.label}
              className={`flex items-center gap-1 px-2 py-1 rounded border text-xs transition-colors
                ${active.color_palette === p.key ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
            >
              <span className="flex gap-0.5">
                {p.colors.map((c, i) => <span key={i} className="w-3 h-3 rounded-sm inline-block" style={{ background: c }} />)}
              </span>
              {p.label}
            </button>
          ))}
          {active.color_palette && (
            <button onClick={() => updateActive({ color_palette: undefined })}
              className="px-2 py-1 rounded border border-gray-200 text-xs text-gray-400 hover:text-red-500">{t('aiDash.sqModal.resetPalette')}</button>
          )}
        </div>
      </div>

      {/* ── 自訂順序色票（B 模式，multi-series 用）────────────────────────── */}
      {(active.type === 'bar' || active.type === 'line') && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-500">自訂系列色票順序（B 模式）</label>
            <button
              onClick={() => updateActive({ colors: [...(active.colors || ['#118DFF', '#E66C37', '#009E49', '#744EC2', '#0099BC']), '#888888'] })}
              className="text-xs text-blue-500 hover:text-blue-700"
            >+ 新增色票</button>
          </div>
          {(active.colors || []).length > 0 ? (
            <div className="flex flex-wrap gap-1.5 items-center">
              {(active.colors || []).map((c, i) => (
                <div key={i} className="flex items-center gap-0.5">
                  <ColorPickerInput
                    value={c}
                    onChange={v => updateActive({ colors: (active.colors || []).map((x, j) => j === i ? v : x) })}
                    title={`Series ${i + 1}`}
                    size="md"
                  />
                  <button
                    onClick={() => updateActive({ colors: (active.colors || []).filter((_, j) => j !== i) })}
                    className="text-gray-300 hover:text-red-400 text-[10px] leading-none"
                  >✕</button>
                </div>
              ))}
              <button onClick={() => updateActive({ colors: undefined })}
                className="text-[10px] text-gray-300 hover:text-red-400 ml-1">全部清除</button>
            </div>
          ) : (
            <p className="text-[10px] text-gray-300">未設定，使用上方顏色主題</p>
          )}
        </div>
      )}

      {/* ── 精確配色（C 模式，值→顏色映射）────────────────────────────────── */}
      {(active.type === 'bar' || active.type === 'line' || active.type === 'pie') && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-500">精確配色（C 模式，值→顏色）</label>
            <button
              onClick={() => updateActive({ series_colors: { ...active.series_colors, '': '#118DFF' } })}
              className="text-xs text-blue-500 hover:text-blue-700"
            >+ 新增</button>
          </div>
          {Object.keys(active.series_colors || {}).length > 0 ? (
            <div className="space-y-1">
              {Object.entries(active.series_colors || {}).map(([k, v]) => (
                <div key={k} className="flex items-center gap-1">
                  <input
                    type="text"
                    value={k}
                    onChange={e => {
                      const next = { ...(active.series_colors || {}) }
                      delete next[k]
                      if (e.target.value) next[e.target.value] = v
                      updateActive({ series_colors: next })
                    }}
                    placeholder="值（如 CATO V7）"
                    className="flex-1 border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400"
                  />
                  <ColorPickerInput
                    value={v}
                    onChange={c => updateActive({ series_colors: { ...(active.series_colors || {}), [k]: c } })}
                    size="md"
                  />
                  <button
                    onClick={() => { const next = { ...(active.series_colors || {}) }; delete next[k]; updateActive({ series_colors: next }) }}
                    className="text-gray-300 hover:text-red-400 text-xs"
                  >✕</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-gray-300">未設定，顏色依序套用</p>
          )}
        </div>
      )}

      {/* ── 文字 & 軸線樣式 ────────────────────────────────────────────────── */}
      <div className="border border-gray-100 rounded-lg p-3 space-y-2">
        <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">文字 &amp; 軸線樣式</p>
        {([
          ['chart_bg_color',     '圖表底色',   false, '#ffffff'],
          ['axis_label_color',   '軸刻度',     true,  '#6b7280'],
          ['axis_line_color',    '軸線',       false, '#e5e7eb'],
          ['grid_line_color',    '格線',       false, '#f3f4f6'],
          ['data_label_color',   '資料標籤',   true,  '#6b7280'],
          ['legend_color',       '圖例',       true,  '#6b7280'],
          ['title_color',        '標題',       true,  '#374151'],
        ] as [keyof ChartDraft, string, boolean, string][]).map(([field, label, hasSize, def]) => {
          const sizeField = (field.replace('_color', '_size') as keyof ChartDraft)
          const colorVal = (active[field] as string) || ''
          const sizeVal = (active[sizeField] as number | '' | undefined) ?? ''
          return (
            <div key={field} className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-16 flex-shrink-0">{label}</span>
              <ColorPickerInput
                value={colorVal || def}
                onChange={v => updateActive({ [field]: v })}
                title={label}
              />
              {hasSize && (
                <input
                  type="number" min={8} max={32} value={sizeVal}
                  onChange={e => updateActive({ [sizeField]: e.target.value === '' ? undefined : Number(e.target.value) })}
                  className="w-14 border border-gray-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-400"
                  placeholder="px"
                />
              )}
              {(colorVal || sizeVal !== '') && (
                <button
                  onClick={() => updateActive({ [field]: undefined, ...(hasSize ? { [sizeField]: undefined } : {}) })}
                  className="text-[10px] text-gray-300 hover:text-red-400"
                >重設</button>
              )}
            </div>
          )
        })}
      </div>

      {/* 樣式選項 */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        <label className="text-xs text-gray-500 mr-2 self-center">{t('aiDash.sqModal.styleLabel')}</label>
        {active.type === 'bar' && (
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={!!active.horizontal} onChange={e => updateActive({ horizontal: e.target.checked })} />{t('aiDash.sqModal.horizontal')}
          </label>
        )}
        {active.type === 'line' && (<>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={!!active.smooth} onChange={e => updateActive({ smooth: e.target.checked })} />{t('aiDash.sqModal.smooth')}
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={!!active.area} onChange={e => updateActive({ area: e.target.checked })} />{t('aiDash.sqModal.area')}
          </label>
        </>)}
        {active.type === 'pie' && (
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={!!active.donut} onChange={e => updateActive({ donut: e.target.checked })} />{t('aiDash.sqModal.donut')}
          </label>
        )}
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={!!active.show_label} onChange={e => updateActive({ show_label: e.target.checked })} />{t('aiDash.sqModal.showLabel')}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={active.show_legend !== false} onChange={e => updateActive({ show_legend: e.target.checked })} />{t('aiDash.sqModal.showLegend')}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={active.show_grid !== false} onChange={e => updateActive({ show_grid: e.target.checked })} />{t('aiDash.sqModal.showGrid')}
        </label>
      </div>

      {/* 手動新增欄位（無 available_columns 時才顯示） */}
      {cols.length === 0 && (
        <div className="border border-dashed border-gray-200 rounded-lg p-3 space-y-2">
          <p className="text-xs text-gray-400">{t('aiDash.sqModal.noColsHint')}</p>
          <div className="flex gap-2">
            <input type="text" value={colInput} onChange={e => setColInput(e.target.value)}
              placeholder={t('aiDash.sqModal.colNamePh')}
              onKeyDown={e => e.key === 'Enter' && addCol()}
              className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
            />
            <button onClick={addCol} className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">{t('common.add')}</button>
          </div>
          {cols.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {cols.map(c => (
                <span key={c.key} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded flex items-center gap-1">
                  {c.key}
                  <button onClick={() => setCols(prev => { const next = prev.filter(x => x.key !== c.key); notifyChange(charts, next); return next })} className="text-gray-400 hover:text-red-400">×</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 主 Modal ──────────────────────────────────────────────────────────────────

export default function SavedQueryModal({ initial, designId, question, pinnedSql, detectedSql, chartConfig, onSave, onClose }: Props) {
  const { t, i18n } = useTranslation()
  const isEdit = !!initial?.id

  // 解析初始 chart config（優先 prop，其次 initial.chart_config）
  const initChartCfg = useMemo((): AiChartConfig | null => {
    try {
      if (chartConfig) return typeof chartConfig === 'string' ? JSON.parse(chartConfig) : chartConfig
      const raw = initial?.chart_config
      if (!raw) return null
      return typeof raw === 'string' ? JSON.parse(raw) : raw as AiChartConfig
    } catch { return null }
  }, [])

  const [tab, setTab] = useState<TabKey>('basic')
  const [name, setName] = useState(initial?.name || '')
  const [translationData, setTranslationData] = useState<TranslationData>({
    name_zh: initial?.name || null,
    name_en: initial?.name_en || null,
    name_vi: initial?.name_vi || null,
  })
  const [description, setDescription] = useState(initial?.description || '')
  const [category, setCategory] = useState(initial?.category || '')
  const [autoRun, setAutoRun] = useState(initial?.auto_run === 1)
  const [params, setParams] = useState<AiQueryParameter[]>(() => {
    try {
      const raw = initial?.parameters_schema
      if (!raw) return []
      return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)) || []
    } catch { return [] }
  })
  const [editQuestion, setEditQuestion] = useState(initial?.question || question || '')
  const [localChartCfg, setLocalChartCfg] = useState<AiChartConfig | null>(initChartCfg)
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState<string[]>([])
  const [schemas, setSchemas] = useState<AiSchemaDef[]>([])
  const [translatingParamIdx, setTranslatingParamIdx] = useState<number | null>(null)

  useEffect(() => {
    api.get('/dashboard/saved-queries').then((r: { data: AiSavedQuery[] }) => {
      const cats = [...new Set(r.data.map(q => q.category).filter((c): c is string => !!c))]
      setCategories(cats)
    }).catch(() => {})

    const did = designId || initial?.design_id
    if (did) {
      api.get(`/dashboard/schemas-for-design/${did}`)
        .then((r: { data: AiSchemaDef[] }) => setSchemas(r.data || []))
        .catch(() => {})
    }
  }, [])

  function colLabel(col: { column_name: string; description?: string; desc_en?: string; desc_vi?: string }) {
    const lang = i18n.language
    if (lang === 'en') return col.desc_en || col.description || col.column_name
    if (lang === 'vi') return col.desc_vi || col.description || col.column_name
    return col.description || col.column_name
  }

  const relevantSchemas = schemas

  const autoDetectedCols = useMemo(() => {
    if (!detectedSql || isEdit) return []
    const colNames = extractWhereColumns(detectedSql)
    const result: (AiSchemaColumn & { schema_id: number; schema_name: string })[] = []
    for (const schema of relevantSchemas) {
      for (const col of schema.columns || []) {
        if (colNames.includes(col.column_name.toUpperCase())) {
          result.push({ ...col, schema_id: schema.id!, schema_name: schema.display_name || schema.table_name })
        }
      }
    }
    return result
  }, [detectedSql, relevantSchemas, isEdit])

  function isParamChecked(col: AiSchemaColumn) {
    return params.some(p => p.column_name === col.column_name)
  }

  function toggleAutoParam(col: AiSchemaColumn & { schema_id: number }) {
    if (isParamChecked(col)) {
      setParams(prev => prev.filter(p => p.column_name !== col.column_name))
    } else {
      setParams(prev => [...prev, {
        id: genParamId(), label_zh: colLabel(col), input_type: 'select',
        schema_id: col.schema_id, column_name: col.column_name, required: false, inject_as: 'where_in',
      }])
    }
  }

  async function translateParam(idx: number) {
    const p = params[idx]
    if (!p.label_zh) return
    setTranslatingParamIdx(idx)
    try {
      const r = await api.post('/dashboard/translate-text', { text: p.label_zh })
      updateParam(idx, { label_en: r.data.en, label_vi: r.data.vi })
    } catch (e) {
      console.error(e)
    } finally {
      setTranslatingParamIdx(null)
    }
  }

  function addParam() {
    setParams(prev => [...prev, { id: genParamId(), label_zh: '', input_type: 'select', required: false, inject_as: 'where_in' }])
  }
  function updateParam(idx: number, patch: Partial<AiQueryParameter>) {
    setParams(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p))
  }
  function removeParam(idx: number) {
    setParams(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    if (!name.trim()) { alert(t('aiDash.sqModal.nameRequired')); return }
    setSaving(true)
    try {
      const payload: Partial<AiSavedQuery> = {
        name: name.trim(),
        name_en: translationData.name_en || undefined,
        name_vi: translationData.name_vi || undefined,
        description: description || undefined,
        category: category || undefined,
        design_id: designId || initial?.design_id,
        question: editQuestion || undefined,
        pinned_sql: pinnedSql ?? initial?.pinned_sql,
        chart_config: localChartCfg ?? undefined,
        parameters_schema: params.length ? params : undefined,
        auto_run: autoRun ? 1 : 0,
      }
      let r: AiSavedQuery
      if (isEdit && initial?.id) {
        r = (await api.put(`/dashboard/saved-queries/${initial.id}`, payload)).data
      } else {
        r = (await api.post('/dashboard/saved-queries', payload)).data
      }
      onSave(r)
      onClose()
    } catch (e) {
      console.error(e)
      alert(t('aiDash.sqModal.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const tabLabels: Record<TabKey, string> = {
    basic: t('aiDash.sqModal.tabBasic'),
    params: `${t('aiDash.sqModal.tabParams')}${params.length ? ` (${params.length})` : ''}`,
    chart: `${t('aiDash.sqModal.tabChart')}${localChartCfg?.charts?.length ? ` (${localChartCfg.charts.length})` : ''}`,
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">{isEdit ? t('aiDash.sqModal.titleEdit') : t('aiDash.sqModal.titleSave')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-5">
          {(['basic', 'params', 'chart'] as TabKey[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors
                ${tab === t ? 'border-blue-500 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >{tabLabels[t]}</button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── 基本資訊 ── */}
          {tab === 'basic' && (
            <>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">{t('aiDash.sqModal.nameLabel')}</label>
                <input autoFocus type="text" value={name}
                  onChange={e => { setName(e.target.value); setTranslationData(p => ({ ...p, name_zh: e.target.value })) }}
                  placeholder={t('aiDash.sqModal.namePlaceholder')}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                />
              </div>
              <TranslationFields
                data={translationData}
                onChange={setTranslationData}
                hasDescription={false}
                translateUrl={isEdit && initial?.id ? `/dashboard/saved-queries/${initial.id}/translate` : undefined}
              />
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">{t('aiDash.sqModal.descLabel')}</label>
                <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)}
                  placeholder={t('aiDash.sqModal.descPlaceholder')}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">{t('aiDash.sqModal.categoryLabel')}</label>
                <input type="text" value={category} onChange={e => setCategory(e.target.value)}
                  placeholder={t('aiDash.sqModal.categoryPlaceholder')} list="category-list"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                />
                <datalist id="category-list">
                  {categories.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">{t('aiDash.sqModal.questionLabel')}</label>
                <textarea rows={3} value={editQuestion} onChange={e => setEditQuestion(e.target.value)}
                  placeholder={t('aiDash.sqModal.questionPlaceholder')}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-y"
                />
                <p className="text-xs text-gray-400 mt-0.5">{t('aiDash.sqModal.questionHint')}</p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={autoRun} onChange={e => setAutoRun(e.target.checked)} />
                  {t('aiDash.sqModal.autoRun')}
                </label>
              </div>
              {!isEdit && autoDetectedCols.length > 0 && (
                <div className="border border-blue-100 rounded-lg p-4 bg-blue-50 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-blue-700">{t('aiDash.sqModal.detectedTitle')}</span>
                    <span className="text-xs text-blue-500">{t('aiDash.sqModal.detectedHint')}</span>
                  </div>
                  <div className="space-y-1.5">
                    {autoDetectedCols.map(col => (
                      <label key={col.column_name} className="flex items-center gap-2.5 text-sm cursor-pointer">
                        <input type="checkbox" checked={isParamChecked(col)} onChange={() => toggleAutoParam(col)} className="rounded" />
                        <span className="text-gray-800 font-medium">{colLabel(col)}</span>
                        <span className="text-xs text-gray-400 font-mono">{col.column_name}</span>
                        <span className="text-xs text-gray-300">· {col.schema_name}</span>
                      </label>
                    ))}
                  </div>
                  {params.length > 0 && (
                    <p className="text-xs text-blue-600 mt-1">{t('aiDash.sqModal.detectedSelected', { count: params.length })}</p>
                  )}
                </div>
              )}
              {!isEdit && autoDetectedCols.length === 0 && detectedSql && (
                <p className="text-xs text-gray-400">{t('aiDash.sqModal.noDetected')}</p>
              )}
            </>
          )}

          {/* ── 查詢參數 ── */}
          {tab === 'params' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">{t('aiDash.sqModal.paramHint')}</p>
                <button onClick={addParam}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 whitespace-nowrap">
                  {t('aiDash.sqModal.addParam')}
                </button>
              </div>
              {params.length === 0 && (
                <div className="text-center py-6 text-sm text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                  {t('aiDash.sqModal.noParams')}<br />
                  <span className="text-xs">{t('aiDash.sqModal.noParamsHint')}</span>
                </div>
              )}
              {params.map((p, idx) => (
                <div key={p.id} className="border border-gray-200 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500">{t('aiDash.sqModal.paramN', { n: idx + 1 })}</span>
                    <button onClick={() => removeParam(idx)} className="text-gray-400 hover:text-red-500 text-xs">{t('aiDash.sqModal.paramRemove')}</button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-gray-500">{t('aiDash.sqModal.paramLabelZh')}</label>
                        <button
                          type="button"
                          onClick={() => translateParam(idx)}
                          disabled={translatingParamIdx === idx || !p.label_zh}
                          className="text-xs px-1.5 py-0.5 rounded border border-blue-200 text-blue-500 hover:bg-blue-50 disabled:opacity-40"
                        >
                          {translatingParamIdx === idx ? '...' : `↻ ${t('aiDash.cb.translate')}`}
                        </button>
                      </div>
                      <input type="text" value={p.label_zh} onChange={e => updateParam(idx, { label_zh: e.target.value })}
                        placeholder={t('aiDash.sqModal.paramLabelZhPh')}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">{t('aiDash.sqModal.paramType')}</label>
                      <select value={p.input_type} onChange={e => updateParam(idx, { input_type: e.target.value as AiQueryParameter['input_type'] })}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white">
                        <option value="select">{t('aiDash.sqModal.typeSelect')}</option>
                        <option value="multiselect">{t('aiDash.sqModal.typeMultiselect')}</option>
                        <option value="date_range">{t('aiDash.sqModal.typeDateRange')}</option>
                        <option value="dynamic_date">{t('aiDash.sqModal.typeDynamicDate')}</option>
                        <option value="number_range">{t('aiDash.sqModal.typeNumberRange')}</option>
                        <option value="text">{t('aiDash.sqModal.typeText')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">{t('aiDash.sqModal.paramLabelEn')}</label>
                      <input type="text" value={p.label_en || ''} onChange={e => updateParam(idx, { label_en: e.target.value })}
                        placeholder="English label"
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">{t('aiDash.sqModal.paramLabelVi')}</label>
                      <input type="text" value={p.label_vi || ''} onChange={e => updateParam(idx, { label_vi: e.target.value })}
                        placeholder="Nhãn tiếng Việt"
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    {(p.input_type === 'select' || p.input_type === 'multiselect') && (<>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">{t('aiDash.sqModal.paramSourceSchema')}</label>
                        <select value={p.schema_id || ''} onChange={e => updateParam(idx, { schema_id: parseInt(e.target.value) || undefined, column_name: '' })}
                          className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white">
                          <option value="">-- {t('aiDash.sqModal.selectField')} --</option>
                          {relevantSchemas.map(s => <option key={s.id} value={s.id}>{s.display_name || s.table_name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">{t('aiDash.sqModal.paramSourceCol')}</label>
                        <select value={p.column_name || ''} onChange={e => updateParam(idx, { column_name: e.target.value })}
                          className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white"
                          disabled={!p.schema_id}>
                          <option value="">-- {t('aiDash.sqModal.selectField')} --</option>
                          {(relevantSchemas.find(s => s.id === p.schema_id)?.columns || []).map(c => (
                            <option key={c.column_name} value={c.column_name}>{colLabel(c)} ({c.column_name})</option>
                          ))}
                        </select>
                      </div>
                    </>)}
                    <div className="col-span-2 flex items-center gap-4">
                      <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                        <input type="checkbox" checked={!!p.required} onChange={e => updateParam(idx, { required: e.target.checked })} />{t('aiDash.sqModal.paramRequired')}
                      </label>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── 圖表設定 ── */}
          {tab === 'chart' && (
            <ChartEditor
              initialConfig={localChartCfg}
              onChange={setLocalChartCfg}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t('common.cancel')}</button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >{saving ? t('common.saving') : isEdit ? t('common.save') : t('common.save')}</button>
        </div>
      </div>
    </div>
  )
}
