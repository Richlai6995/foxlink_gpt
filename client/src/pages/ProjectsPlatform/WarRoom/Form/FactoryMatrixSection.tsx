/**
 * FactoryMatrixSection — v0.5 §11.3.8 Multi-Factory Cost Matrix(唯讀 · 資料層)
 *
 * 從 data_payload.factory_matrix 讀,顯示:
 *   - 3 廠 × 3 PKG option 9-cell 矩陣(black/white tab 切換)
 *   - 各 cell 色彩深淺對應價差 (heatmap)
 *   - MVA / SG&A+Profit / 推薦單價 / 年總營收
 *   - 推薦組合 + 「客戶指定廠」flag(若有)
 *
 * AI 解讀 / 推薦留 Phase 2+(spec §11.3.8.2)
 */

import { useState } from 'react'
import type { ProjectDetail } from '../../api'
import { useAuth } from '../../../../context/AuthContext'

type FactoryMatrix = {
  axes: { factory: string[]; pkg_option: string[] }
  mandatory_factory: string | null
  recommended: { factory: string; pkg_option: string }
  cheapest: { factory: string; pkg_option: string; value: number }
  spread: number
  cells: {
    [variantKey: string]: { [key: string]: number }  // e.g. cells.black['CN-A'] = 11.12
  }
  mva: { [factory: string]: number }
  sga_profit: number
  suggested_quote: number
  annual_revenue: number
}

const FACTORY_FLAG: Record<string, string> = { CN: '🇨🇳', VN: '🇻🇳', TW: '🇹🇼', IN: '🇮🇳', MX: '🇲🇽' }
const FACTORY_NAME: Record<string, string> = { CN: '中國', VN: '越南', TW: '台灣', IN: '印度', MX: '墨西哥' }
const PKG_DESC: Record<string, string> = { A: '標準包裝', B: '減塑版', C: 'FSC premium' }

export default function FactoryMatrixSection({ project }: { project: ProjectDetail }) {
  const { user } = useAuth() as any
  const dp = (project.data_payload as any) || {}
  const data: FactoryMatrix | undefined = dp.factory_matrix
  const variants = dp.variants?.items || [{ key: 'default', label: 'All', qty: dp.quantity || 0 }]

  const [activeVariant, setActiveVariant] = useState<string>(variants[0]?.key || 'black')

  // 機密 mask
  const isConf = !!project.is_confidential
  const isHostOrAdmin =
    user?.role === 'admin' ||
    Number(project.pm_user_id) === Number(user?.id) ||
    Number((project as any).sales_user_id) === Number(user?.id)
  const masked = isConf && !isHostOrAdmin

  if (!data?.cells) {
    return (
      <div className="p-4 text-center text-cortex-muted text-[12px] italic">
        此專案未啟用 Multi-Factory Matrix
      </div>
    )
  }

  const variantCells = data.cells[activeVariant] || data.cells[Object.keys(data.cells)[0]] || {}
  const allValues = Object.values(variantCells)
  const minV = Math.min(...allValues)
  const maxV = Math.max(...allValues)
  const spread = (maxV - minV).toFixed(2)
  const cellColor = (val: number) => {
    if (masked) return 'bg-cortex-line-2'
    const ratio = (val - minV) / (maxV - minV || 1)
    if (ratio < 0.33) return 'bg-green-100'
    if (ratio < 0.67) return 'bg-amber-100'
    return 'bg-red-100'
  }
  const isMin = (val: number) => Math.abs(val - minV) < 0.001

  const annualImpact = Number(spread) * (dp.quantity || 0)

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-bold text-cortex-ink flex items-center gap-2">
            🏭 多廠對比矩陣
            <span className="text-[9px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">v0.5 §11.3.8</span>
            {isConf && <span className="text-[9px] font-bold bg-cortex-amber-bg text-amber-800 px-1.5 py-0.5 rounded">🔒 機密</span>}
          </h3>
          <p className="text-[12px] text-cortex-muted mt-0.5">
            Total Cost Ex-Factory ($/unit) · spread ${spread} · 年量 × spread ≈ {masked ? '▒▒▒' : `$${Math.round(annualImpact).toLocaleString()}`}/yr 差距
          </p>
        </div>
      </div>

      {/* Variant tab switcher */}
      {variants.length > 1 && (
        <div className="flex gap-0 border-b border-cortex-line">
          {variants.map((v: any) => (
            <button
              key={v.key}
              onClick={() => setActiveVariant(v.key)}
              className={`px-3 py-2 text-[12px] font-bold transition border-b-2 ${
                activeVariant === v.key
                  ? 'text-cortex-ocean border-cortex-cyan bg-cortex-cyan-bg/30'
                  : 'text-cortex-muted border-transparent hover:text-cortex-ink'
              }`}
            >
              {v.label} {v.share ? `(${(v.share * 100).toFixed(0)}% · ${(v.qty / 1000).toFixed(0)}K/yr)` : ''}
            </button>
          ))}
          <button
            disabled
            className="px-3 py-2 text-[12px] text-cortex-muted/60 italic"
            title="Phase 2 加權平均(雙軸 cross)"
          >
            加權平均 (P2)
          </button>
        </div>
      )}

      {/* 3×3 Matrix */}
      <div className="bg-white border border-cortex-line rounded-lg p-4">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: '90px repeat(3, 1fr)' }}>
          <div />
          {data.axes.pkg_option.map((opt) => (
            <div key={opt} className="text-center text-[11px] font-bold text-cortex-muted py-1">
              📮 PKG Opt {opt}
              <div className="font-normal text-[10px] mt-0.5">{PKG_DESC[opt] || opt}</div>
            </div>
          ))}

          {data.axes.factory.map((fac) => (
            <FactoryRow
              key={fac}
              factory={fac}
              options={data.axes.pkg_option}
              cells={variantCells}
              cellColor={cellColor}
              isMin={isMin}
              masked={masked}
              mandatoryFactory={data.mandatory_factory}
            />
          ))}
        </div>

        {/* Legend */}
        <div className="flex gap-3 items-center text-[10px] text-cortex-muted mt-3">
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 bg-green-100 rounded-sm" /> 低
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 bg-amber-100 rounded-sm" /> 中
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 bg-red-100 rounded-sm" /> 高
          </span>
          <span className="ml-auto text-cortex-ocean font-bold">
            點 cell → drill 到該 (廠 × option) BOM + Cleansheet(Phase 2)
          </span>
        </div>
      </div>

      {/* Recommended */}
      <div className="bg-cortex-cyan-bg/40 border-l-2 border-cortex-cyan rounded-r p-3 text-[11px] text-cortex-text leading-relaxed">
        <strong className="text-cortex-ocean">
          ✓ 推薦組合:{data.recommended.factory}-Opt{data.recommended.pkg_option}
          ({masked ? '▒▒▒' : `$${variantCells[`${data.recommended.factory}-${data.recommended.pkg_option}`]?.toFixed(2)}`})
        </strong>
        {data.mandatory_factory && (
          <> · ⚠ 客戶指定廠:<strong className="text-amber-700">{data.mandatory_factory}</strong></>
        )}
        <br />
        <em className="text-cortex-muted">AI 解讀 / 推薦走 spec §11.3.8 Phase 2+,本層只呈現資料對比。</em>
      </div>

      {/* MVA + Pricing summary */}
      <div className="grid grid-cols-4 gap-2">
        {data.axes.factory.map((fac) => (
          <div key={fac} className="bg-white border border-cortex-line rounded p-2">
            <div className="text-[10px] text-cortex-muted">MVA · {FACTORY_FLAG[fac]} {FACTORY_NAME[fac]}</div>
            <div className="text-[14px] font-bold text-cortex-ink font-mono">
              {masked ? '▒▒▒' : `$${data.mva[fac]?.toFixed(2)}`}
            </div>
          </div>
        ))}
        <div className="bg-cortex-bg/60 border border-cortex-line rounded p-2">
          <div className="text-[10px] text-cortex-muted">SG&A + Profit</div>
          <div className="text-[14px] font-bold text-cortex-ocean font-mono">
            {masked ? '▒▒▒' : `$${data.sga_profit?.toFixed(2)}`}
          </div>
        </div>
      </div>

      {/* Pricing roll-up */}
      <div className="grid grid-cols-3 gap-2">
        <div className={`border rounded-lg p-3 ${isConf ? 'bg-cortex-amber-bg/30 border-amber-200' : 'bg-white border-cortex-line'}`}>
          <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">
            推薦組合 Total Cost {isConf && '🔒'}
          </div>
          <div className="text-xl font-bold text-cortex-navy font-mono mt-1">
            {masked ? '▒▒▒' : `$${variantCells[`${data.recommended.factory}-${data.recommended.pkg_option}`]?.toFixed(2)}`}
          </div>
          <div className="text-[10px] text-cortex-muted">
            / unit · {variants.find((v: any) => v.key === activeVariant)?.label} {data.recommended.factory}-Opt{data.recommended.pkg_option}
          </div>
        </div>
        <div className={`border rounded-lg p-3 ${isConf ? 'bg-cortex-amber-bg/30 border-amber-200' : 'bg-white border-cortex-line'}`}>
          <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">
            建議售價(草){isConf && '🔒'}
          </div>
          <div className="text-xl font-bold text-cortex-navy font-mono mt-1">
            {masked ? '▒▒▒' : `$${data.suggested_quote?.toFixed(2)}`}
          </div>
          <div className="text-[10px] text-cortex-muted">/ unit · 含 SG&A+Profit</div>
        </div>
        <div className="bg-white border border-cortex-line rounded-lg p-3">
          <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">年總營收(估)</div>
          <div className="text-xl font-bold text-cortex-green font-mono mt-1">
            {masked ? '▒▒▒' : `$${(data.annual_revenue / 1000000).toFixed(2)}M`}
          </div>
          <div className="text-[10px] text-cortex-muted">{dp.quantity?.toLocaleString()} × ${data.suggested_quote} · 不含 NRE</div>
        </div>
      </div>
    </div>
  )
}

// ─── single row ────────────────────────────────────────────
function FactoryRow({
  factory, options, cells, cellColor, isMin, masked, mandatoryFactory,
}: {
  factory: string
  options: string[]
  cells: { [key: string]: number }
  cellColor: (val: number) => string
  isMin: (val: number) => boolean
  masked: boolean
  mandatoryFactory: string | null
}) {
  return (
    <>
      <div className={`flex items-center justify-end px-2 py-1.5 text-[12px] font-bold text-cortex-ink ${mandatoryFactory === factory ? 'bg-cortex-amber-bg/40 rounded-l' : ''}`}>
        {FACTORY_FLAG[factory] || ''} {FACTORY_NAME[factory] || factory}
        {mandatoryFactory === factory && <span className="ml-1 text-[8px] text-amber-700">⚠指定</span>}
      </div>
      {options.map((opt) => {
        const cellKey = `${factory}-${opt}`
        const val = cells[cellKey]
        if (val == null) return <div key={cellKey} className="bg-cortex-line-2 rounded p-2 text-center text-cortex-muted text-[10px]">—</div>
        const min = isMin(val)
        return (
          <div
            key={cellKey}
            className={`${cellColor(val)} rounded p-2 text-center relative ${min ? 'ring-2 ring-cortex-cyan' : ''}`}
          >
            <div className={`font-mono text-[13px] font-bold ${min ? 'text-cortex-ocean' : 'text-cortex-ink'}`}>
              {masked ? '▒▒▒' : `$${val.toFixed(2)}`}
            </div>
            {min && !masked && (
              <div className="text-[8px] text-cortex-ocean font-bold mt-0.5">✓ MIN</div>
            )}
          </div>
        )
      })}
    </>
  )
}
