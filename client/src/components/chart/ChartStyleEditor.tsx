/**
 * ChartStyleEditor — 可重用的樣式編輯表單(controlled)
 *
 * 用在:
 *   1. InlineChart 右側彈出 panel(inline tweak)
 *   2. MyChartsPage 的「樣式模板」tab 編輯 modal
 */
import { useTranslation } from 'react-i18next'
import type { ChartStyle, ChartPaletteName, LegendPosition, NumberFormat } from '../../types'
import { PALETTES } from '../../lib/chartStyle'

interface Props {
  value: ChartStyle
  onChange: (next: ChartStyle) => void
  /** 顯示哪些 perType 區塊;若為空則全顯 */
  showPerTypes?: Array<'bar' | 'line' | 'area' | 'pie'>
  compact?: boolean
}

function patchCommon(v: ChartStyle, patch: Partial<NonNullable<ChartStyle['common']>>): ChartStyle {
  return { ...v, common: { ...v.common, ...patch } }
}
function patchPerType<K extends 'bar' | 'line' | 'area' | 'pie'>(
  v: ChartStyle, key: K, patch: Record<string, unknown>
): ChartStyle {
  return {
    ...v,
    perType: {
      ...(v.perType || {}),
      [key]: { ...((v.perType as any)?.[key] || {}), ...patch },
    },
  }
}

const PALETTE_OPTIONS: ChartPaletteName[] = ['blue', 'green', 'warm', 'purple', 'teal', 'custom']

export default function ChartStyleEditor({ value, onChange, showPerTypes, compact }: Props) {
  const { t } = useTranslation()
  const c = value.common || {}
  const showAll = !showPerTypes || showPerTypes.length === 0
  const has = (k: 'bar' | 'line' | 'area' | 'pie') => showAll || showPerTypes!.includes(k)

  const customColors = c.custom_colors || []
  const setCustomColor = (idx: number, color: string) => {
    const next = [...customColors]
    while (next.length <= idx) next.push('#5470c6')
    next[idx] = color
    onChange(patchCommon(value, { custom_colors: next, palette: 'custom' }))
  }

  const fieldGap = compact ? 'gap-1.5' : 'gap-2'
  const sectionTitle = `text-[10px] font-semibold text-slate-500 uppercase tracking-wide`
  const labelClass = 'text-[10px] text-slate-500'
  const inputClass = 'w-full border border-slate-300 rounded px-1.5 py-1 text-xs bg-white'

  return (
    <div className={`space-y-3 ${compact ? 'text-xs' : 'text-sm'}`}>
      {/* ── 配色 ───────────────────────────────── */}
      <div className={fieldGap}>
        <div className={sectionTitle}>{t('chart.style.palette', '配色')}</div>
        <div className="grid grid-cols-3 gap-1 mt-1">
          {PALETTE_OPTIONS.map(name => {
            const active = c.palette === name
            const preview = name === 'custom'
              ? (customColors.slice(0, 3).length > 0 ? customColors.slice(0, 3) : ['#94a3b8'])
              : PALETTES[name].slice(0, 3)
            return (
              <button
                key={name}
                onClick={() => onChange(patchCommon(value, { palette: name }))}
                className={`px-1.5 py-1 rounded border text-[10px] flex items-center gap-1 transition ${
                  active ? 'bg-sky-50 border-sky-300 text-sky-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex gap-0.5">
                  {preview.map((col, i) => (
                    <div key={i} className="w-2 h-2 rounded-sm" style={{ backgroundColor: col }} />
                  ))}
                </div>
                <span className="capitalize">{name}</span>
              </button>
            )
          })}
        </div>
        {c.palette === 'custom' && (
          <div className="mt-2 flex gap-1 flex-wrap">
            {[0, 1, 2, 3, 4].map(i => (
              <input
                key={i}
                type="color"
                value={customColors[i] || '#5470c6'}
                onChange={e => setCustomColor(i, e.target.value)}
                className="w-7 h-7 rounded cursor-pointer border border-slate-300"
                title={`Color ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── 文字 ───────────────────────────────── */}
      <div className={fieldGap}>
        <div className={sectionTitle}>{t('chart.style.text', '文字')}</div>
        <div className="grid grid-cols-3 gap-1.5 mt-1">
          <div>
            <div className={labelClass}>{t('chart.style.titleSize', '標題')}</div>
            <select
              value={c.title_size ?? 13}
              onChange={e => onChange(patchCommon(value, { title_size: Number(e.target.value) }))}
              className={inputClass}
            >
              {[12, 13, 14, 16, 18, 20].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <div className={labelClass}>{t('chart.style.axisSize', '軸')}</div>
            <select
              value={c.axis_label_size ?? 11}
              onChange={e => onChange(patchCommon(value, { axis_label_size: Number(e.target.value) }))}
              className={inputClass}
            >
              {[9, 10, 11, 12, 14].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <div className={labelClass}>{t('chart.style.legendSize', '圖例')}</div>
            <select
              value={c.legend_size ?? 11}
              onChange={e => onChange(patchCommon(value, { legend_size: Number(e.target.value) }))}
              className={inputClass}
            >
              {[9, 10, 11, 12, 13].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ── 圖例 / 格線 / 背景 ───────────────────── */}
      <div className={fieldGap}>
        <div className={sectionTitle}>{t('chart.style.layout', '排版')}</div>
        <div className="grid grid-cols-2 gap-1.5 mt-1">
          <div>
            <div className={labelClass}>{t('chart.style.legendPos', '圖例位置')}</div>
            <select
              value={c.legend_position ?? 'top'}
              onChange={e => onChange(patchCommon(value, { legend_position: e.target.value as LegendPosition }))}
              className={inputClass}
            >
              <option value="top">{t('chart.style.pos.top', '上')}</option>
              <option value="bottom">{t('chart.style.pos.bottom', '下')}</option>
              <option value="left">{t('chart.style.pos.left', '左')}</option>
              <option value="right">{t('chart.style.pos.right', '右')}</option>
              <option value="none">{t('chart.style.pos.none', '隱藏')}</option>
            </select>
          </div>
          <div>
            <div className={labelClass}>{t('chart.style.background', '背景')}</div>
            <select
              value={c.background ?? 'light'}
              onChange={e => onChange(patchCommon(value, { background: e.target.value as 'light' | 'dark' }))}
              className={inputClass}
            >
              <option value="light">{t('chart.style.bgLight', '淺色')}</option>
              <option value="dark">{t('chart.style.bgDark', '深色')}</option>
            </select>
          </div>
        </div>
        <label className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={c.show_grid ?? true}
            onChange={e => onChange(patchCommon(value, { show_grid: e.target.checked }))}
          />
          {t('chart.style.showGrid', '顯示 Y 軸格線')}
        </label>
      </div>

      {/* ── 數字格式 ───────────────────────────── */}
      <div className={fieldGap}>
        <div className={sectionTitle}>{t('chart.style.numberFormat', '數字格式')}</div>
        <div className="grid grid-cols-2 gap-1.5 mt-1">
          <select
            value={c.number_format ?? 'plain'}
            onChange={e => onChange(patchCommon(value, { number_format: e.target.value as NumberFormat }))}
            className={inputClass}
          >
            <option value="plain">{t('chart.style.num.plain', '原始')}</option>
            <option value="thousand">{t('chart.style.num.thousand', '千分位')}</option>
            <option value="percent">{t('chart.style.num.percent', '百分比')}</option>
          </select>
          <select
            value={c.decimal_places ?? 0}
            onChange={e => onChange(patchCommon(value, { decimal_places: Number(e.target.value) }))}
            className={inputClass}
          >
            <option value={0}>{t('chart.style.decimal0', '整數')}</option>
            <option value={1}>1 {t('chart.style.decimalUnit', '位小數')}</option>
            <option value={2}>2 {t('chart.style.decimalUnit', '位小數')}</option>
          </select>
        </div>
      </div>

      {/* ── 圖型個別設定 ─────────────────────── */}
      {has('bar') && (
        <div className={fieldGap}>
          <div className={sectionTitle}>{t('chart.style.bar', '長條圖')}</div>

          {/* 圓角 / 透明 */}
          <div className="grid grid-cols-2 gap-1.5 mt-1">
            <div>
              <div className={labelClass}>{t('chart.style.borderRadius', '圓角')}</div>
              <select
                value={value.perType?.bar?.border_radius ?? 4}
                onChange={e => onChange(patchPerType(value, 'bar', { border_radius: Number(e.target.value) }))}
                className={inputClass}
              >
                <option value={0}>0 {t('chart.style.px', 'px')}</option>
                <option value={2}>2 px</option>
                <option value={4}>4 px</option>
                <option value={8}>8 px</option>
              </select>
            </div>
            <div>
              <div className={labelClass}>{t('chart.style.opacity', '透明度')}</div>
              <select
                value={value.perType?.bar?.opacity ?? 1}
                onChange={e => onChange(patchPerType(value, 'bar', { opacity: Number(e.target.value) }))}
                className={inputClass}
              >
                <option value={1}>100%</option>
                <option value={0.85}>85%</option>
                <option value={0.7}>70%</option>
                <option value={0.5}>50%</option>
              </select>
            </div>
          </div>

          {/* 陰影 + 單系列多色 */}
          <div className="flex flex-col gap-1 mt-1.5">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={value.perType?.bar?.shadow ?? false}
                onChange={e => onChange(patchPerType(value, 'bar', { shadow: e.target.checked }))}
              />
              {t('chart.style.shadow', '陰影效果(立體感)')}
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={value.perType?.bar?.single_series_multi_color ?? false}
                onChange={e => onChange(patchPerType(value, 'bar', { single_series_multi_color: e.target.checked }))}
              />
              {t('chart.style.multiColor', '每支 bar 不同色(單系列時)')}
            </label>
          </div>

          {/* 動畫 */}
          <div className="grid grid-cols-2 gap-1.5 mt-2">
            <div>
              <div className={labelClass}>{t('chart.style.animation', '動畫')}</div>
              <select
                value={value.perType?.bar?.animation_style ?? 'grow'}
                onChange={e => onChange(patchPerType(value, 'bar', { animation_style: e.target.value }))}
                className={inputClass}
              >
                <option value="none">{t('chart.style.anim.none', '關閉')}</option>
                <option value="grow">{t('chart.style.anim.grow', '從底部長出')}</option>
                <option value="fade">{t('chart.style.anim.fade', '淡入')}</option>
                <option value="bounce">{t('chart.style.anim.bounce', '彈跳')}</option>
              </select>
            </div>
            <label className="flex items-end pb-1 gap-1.5 text-[11px] text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={value.perType?.bar?.animation_stagger ?? false}
                onChange={e => onChange(patchPerType(value, 'bar', { animation_stagger: e.target.checked }))}
              />
              {t('chart.style.stagger', '逐個浮現')}
            </label>
          </div>

          {/* 自訂每根 bar 顏色(最多 8 組,不夠時循環) */}
          <div className="mt-2">
            <div className={labelClass}>
              {t('chart.style.customBarColors', '自訂每根 bar 顏色(依序對應,留空用 palette)')}
            </div>
            <div className="flex gap-1 flex-wrap mt-1">
              {Array.from({ length: 8 }).map((_, i) => {
                const cur = value.perType?.bar?.custom_bar_colors || []
                const hex = cur[i] || ''
                return (
                  <div key={i} className="relative">
                    <input
                      type="color"
                      value={hex || '#94a3b8'}
                      onChange={e => {
                        const next = [...cur]
                        while (next.length <= i) next.push('')
                        next[i] = e.target.value
                        onChange(patchPerType(value, 'bar', { custom_bar_colors: next }))
                      }}
                      className={`w-6 h-6 rounded cursor-pointer border ${hex ? 'border-slate-400' : 'border-dashed border-slate-300 opacity-40'}`}
                      title={`Bar ${i + 1}`}
                    />
                    {hex && (
                      <button
                        onClick={() => {
                          const next = [...cur]
                          next[i] = ''
                          onChange(patchPerType(value, 'bar', { custom_bar_colors: next.filter((_, j) => j < cur.length) }))
                        }}
                        className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 text-white rounded-full text-[8px] leading-3 flex items-center justify-center"
                        title={t('chart.style.clear', '清除')}
                      >
                        ×
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="text-[9px] text-slate-400 mt-1">
              {t('chart.style.customBarHint', '有設值就用自訂色,沒設的位置會 fallback 回 palette')}
            </div>
          </div>
        </div>
      )}
      {has('line') && (
        <div className={fieldGap}>
          <div className={sectionTitle}>{t('chart.style.line', '折線圖')}</div>
          <label className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={value.perType?.line?.smooth ?? false}
              onChange={e => onChange(patchPerType(value, 'line', { smooth: e.target.checked }))}
            />
            {t('chart.style.smooth', '平滑曲線')}
          </label>
        </div>
      )}
      {has('pie') && (
        <div className={fieldGap}>
          <div className={sectionTitle}>{t('chart.style.pie', '圓餅圖')}</div>
          <label className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={value.perType?.pie?.doughnut ?? true}
              onChange={e => onChange(patchPerType(value, 'pie', { doughnut: e.target.checked }))}
            />
            {t('chart.style.doughnut', '甜甜圈樣式')}
          </label>
        </div>
      )}
    </div>
  )
}
