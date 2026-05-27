/**
 * NreSection — v0.5 §11.3.6 NRE Costs Section(唯讀)
 *
 * 從 data_payload.nre 讀,顯示:
 *   - 4 個 derived widget(Original / Negotiated / Delta / 攤提)
 *   - 11+ NRE items 表格(Original vs Negotiated 雙欄)
 *   - 機密 mask(host 看明文 / 其他 mask)
 */

import type { ProjectDetail } from '../../api'
import { useAuth } from '../../../../context/AuthContext'

type NreItem = {
  key: string
  label: string
  qty: number
  original: number
  updated: number
  remark?: string
  responsible?: string
  accountable?: string
  status?: 'done' | 'pending'
  sla_color?: 'amber' | 'red'
}

type NreData = {
  total_original: number
  total_negotiated: number
  delta_pct: number
  amortize_per_unit: number
  items_count: number
  items_done: number
  items: NreItem[]
}

export default function NreSection({ project }: { project: ProjectDetail }) {
  const { user } = useAuth() as any
  const dp = (project.data_payload as any) || {}
  const data: NreData | undefined = dp.nre

  // 機密 mask 邏輯(簡化):confidential=1 + 非 host/admin → mask
  const isConf = !!project.is_confidential
  const isHostOrAdmin =
    user?.role === 'admin' ||
    Number(project.pm_user_id) === Number(user?.id) ||
    Number((project as any).sales_user_id) === Number(user?.id)
  const masked = isConf && !isHostOrAdmin

  if (!data?.items?.length) {
    return (
      <div className="p-4 text-center text-cortex-muted text-[12px] italic">
        此專案未啟用 NRE section
      </div>
    )
  }

  const totalOrig = data.total_original
  const totalNeg = data.total_negotiated
  const delta = totalOrig - totalNeg
  const deltaPct = data.delta_pct

  const moneyOr = (n: number) => masked ? '▒▒▒▒' : '$' + n.toLocaleString()

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-bold text-cortex-ink flex items-center gap-2">
            🔧 NRE 成本
            <span className="text-[9px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">v0.5 §11.3.6</span>
            <span className="text-[9px] font-bold bg-cortex-amber-bg text-amber-800 px-1.5 py-0.5 rounded">
              {data.items_done}/{data.items_count} 項已確認
            </span>
            {isConf && (
              <span className="text-[9px] font-bold bg-cortex-amber-bg text-amber-800 px-1.5 py-0.5 rounded">🔒 機密 section</span>
            )}
          </h3>
          <p className="text-[12px] text-cortex-muted mt-0.5">
            11 標準 + 自訂 child-table · 雙欄 Original vs Negotiated · 攤提 not 加進 unit cost
          </p>
        </div>
      </div>

      {masked && (
        <div className="bg-cortex-amber-bg/60 border border-amber-300 rounded-lg p-3 text-[12px] text-amber-800 leading-relaxed">
          <strong>⚠ 你目前的視角無法看到本 section 明細數字。</strong>
          切到 HOST(PM / sales / admin)視角即可看明文。
        </div>
      )}

      {/* 4 個 widget */}
      <div className="grid grid-cols-4 gap-2">
        <div className={`border rounded-lg p-3 ${isConf ? 'bg-cortex-amber-bg/30 border-amber-200' : 'bg-white border-cortex-line'}`}>
          <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">
            原始 NRE 總額 {isConf && '🔒'}
          </div>
          <div className="text-xl font-bold text-cortex-ink font-mono mt-1">{moneyOr(totalOrig)}</div>
          <div className="text-[9px] text-cortex-muted">廠商初版報價</div>
        </div>
        <div className={`border rounded-lg p-3 ${isConf ? 'bg-cortex-amber-bg/30 border-amber-200' : 'bg-white border-cortex-line'}`}>
          <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">
            議價後 NRE {isConf && '🔒'}
          </div>
          <div className="text-xl font-bold text-cortex-teal font-mono mt-1">{moneyOr(totalNeg)}</div>
          <div className="text-[9px] text-cortex-muted">partnership 議價後</div>
        </div>
        <div className="bg-cortex-green-bg/30 border border-cortex-green/30 rounded-lg p-3">
          <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">節省金額 / 比例</div>
          <div className="text-xl font-bold text-cortex-green font-mono mt-1">
            {masked ? '▒▒▒▒' : '-$' + delta.toLocaleString()}
          </div>
          <div className="text-[9px] text-cortex-muted">{masked ? '' : `↓ ${deltaPct}% · auto SUM`}</div>
        </div>
        <div className="bg-white border border-cortex-line rounded-lg p-3">
          <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">攤提到單價</div>
          <div className="text-xl font-bold text-cortex-ocean font-mono mt-1">
            {masked ? '▒▒▒' : '$' + data.amortize_per_unit.toFixed(4)}
          </div>
          <div className="text-[9px] text-cortex-muted">/ unit · 不加進 cost · 僅附註</div>
        </div>
      </div>

      {/* 11 項 NRE 表格 */}
      <div className="bg-white border border-cortex-line rounded-lg p-3">
        <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-2 flex items-center justify-between">
          <span>NRE 項目明細(11 項標準 + 自訂)· TABLE</span>
          {isConf && <span className="text-[9px] text-amber-700">🔒 金額機密</span>}
        </div>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-cortex-muted border-b border-cortex-line">
              <th className="text-left py-1 px-1.5">NRE Item</th>
              <th className="text-right py-1 px-1.5">Qty</th>
              <th className="text-right py-1 px-1.5">Original</th>
              <th className="text-right py-1 px-1.5">Negotiated</th>
              <th className="text-right py-1 px-1.5">Δ%</th>
              <th className="text-left py-1 px-1.5">Remark</th>
              <th className="text-left py-1 px-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => {
              const dPct = it.original > 0 ? ((it.original - it.updated) / it.original * 100) : 0
              const dPctStr = it.original > 0 ? (dPct > 0 ? `↓${dPct.toFixed(0)}%` : (dPct < 0 ? `↑${Math.abs(dPct).toFixed(0)}%` : '—')) : '—'
              const dColor =
                dPct > 50 ? 'text-cortex-green font-bold' :
                dPct > 0 ? 'text-cortex-teal' :
                            'text-cortex-muted'
              return (
                <tr key={it.key} className={`border-b border-cortex-line/40 ${it.sla_color === 'amber' ? 'bg-cortex-amber-bg/30' : ''}`}>
                  <td className="py-1.5 px-1.5 text-cortex-ink font-semibold">{it.label}</td>
                  <td className="py-1.5 px-1.5 text-right font-mono text-cortex-text">{it.qty}</td>
                  <td className="py-1.5 px-1.5 text-right font-mono text-cortex-ink">{moneyOr(it.original)}</td>
                  <td className="py-1.5 px-1.5 text-right font-mono text-cortex-teal font-bold">{moneyOr(it.updated)}</td>
                  <td className={`py-1.5 px-1.5 text-right font-mono ${dColor}`}>{masked ? '' : dPctStr}</td>
                  <td className="py-1.5 px-1.5 text-[10px] text-cortex-muted">{it.remark || '—'}</td>
                  <td className="py-1.5 px-1.5">
                    {it.status === 'pending' ? (
                      <span className="text-[9px] bg-cortex-amber-bg text-amber-800 px-1 py-0.5 rounded font-bold">待回</span>
                    ) : (
                      <span className="text-[9px] bg-cortex-green-bg text-cortex-green px-1 py-0.5 rounded font-bold">DONE</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="text-[10px] text-cortex-muted mt-2 flex items-center gap-3 flex-wrap">
          <span>👤 DPM Mike · MPM Tony 共填 · 議價 by 業務 Amy</span>
          {data.items.some((i) => i.status === 'pending') && (
            <span className="text-amber-700 font-bold">⚠ {data.items.filter((i) => i.status === 'pending').length} 項待客戶回覆</span>
          )}
          <span className="ml-auto text-cortex-green font-bold">✓ 已存</span>
        </div>
      </div>

      <div className="bg-cortex-green-bg/30 border-l-2 border-cortex-green rounded-r p-2.5 text-[11px] text-cortex-text leading-relaxed">
        <strong className="text-cortex-green">📌 議價成果亮點</strong><br />
        Original NRE {moneyOr(totalOrig)} → Negotiated {moneyOr(totalNeg)} · <strong>{masked ? '' : `↓ ${deltaPct}%`}</strong>
        透過 partnership 議價 + Foxlink 自吸收 MP fixture / travel / NPI labor · 客戶滿意度提升。
      </div>
    </div>
  )
}
