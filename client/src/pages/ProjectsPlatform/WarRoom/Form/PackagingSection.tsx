/**
 * PackagingSection — v0.5 §11.3.7 Packaging Sub-form(唯讀)
 *
 * 從 data_payload.packaging 讀,顯示:
 *   - 16 項 child-table(NO / Part / Spec / Qty / Unit Price / Vendor / LT / Note)
 *   - 計算:pkg_total_per_unit / vendor_count
 *   - pallet_compliance enum
 */

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { ProjectDetail } from '../../api'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'

const m4 = (v: any) => (typeof v === 'number' ? `$${v.toFixed(4)}` : '—')
const m6 = (v: any) => (typeof v === 'number' ? `$${v.toFixed(6)}` : '—')
const pc = (v: any) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—')

const PALLETS = [
  { key: 'EPAL', label: 'EU EPAL(歐標)' },
  { key: 'GMA', label: 'US GMA(美標)' },
  { key: 'PLYWOOD', label: 'APAC Plywood(亞太合板)' },
]

/**
 * v0.16 #5:真 BOM 專案包裝視圖 —— 包裝變異值 tabs × PKG 料 true/quote/markup + Pallet Compliance
 */
function RealPackagingView({ project }: { project: ProjectDetail }) {
  const { token } = useAuth() as any
  const projectId = project.id
  const [inst, setInst] = useState<number | null>(null)
  const [pkgVals, setPkgVals] = useState<{ id: number; code: string }[]>([])
  const [active, setActive] = useState<number | 0>(0)   // 0 = 全部
  const [data, setData] = useState<any>(null)
  const [pallet, setPallet] = useState<string[]>([])
  const [palletDirty, setPalletDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!token) return
    ;(async () => {
      try {
        const i = await api.get<any>(token, `/bom/project/${projectId}/latest-instance`).catch(() => null)
        if (i?.bomInstanceId) setInst(i.bomInstanceId)
        const dims = await api.get<any>(token, `/bom/project/${projectId}/dimensions`)
        const pkgDim = (dims.dimensions || []).find((d: any) => /包裝|PKG|PACK/i.test(d.dimCode))
        setPkgVals((pkgDim?.values || []).map((v: any) => ({ id: v.id, code: v.valueCode })))
        const f = await api.get<any>(token, `/bom/form?projectId=${projectId}`)
        setPallet(f.form?.pkg_meta?.pallet_compliance || [])
      } catch { /* noop */ } finally { setLoaded(true) }
    })()
  }, [token, projectId])   // eslint-disable-line

  useEffect(() => {
    if (!token || !inst) return
    const q = active ? `?valueIds=${active}` : ''
    api.get<any>(token, `/bom/instances/${inst}/packaging${q}`).then(setData).catch(() => setData(null))
  }, [token, inst, active])

  async function savePallet(next: string[]) {
    setPallet(next); setPalletDirty(false); setBusy(true)
    try {
      await api.put(token, '/bom/form/pkg_meta', { projectId, fields: { pallet_compliance: next } })
      window.dispatchEvent(new CustomEvent('cortex:form-refresh'))
    } catch { setPalletDirty(true) } finally { setBusy(false) }
  }

  if (!loaded) return <div className="text-[12px] text-cortex-muted"><Loader2 className="w-3.5 h-3.5 inline animate-spin" /> 載入包裝…</div>
  if (!inst) return <div className="p-4 text-center text-cortex-muted text-[12px] italic">此專案尚未匯入 BOM(PKG 料隨 BOM 匯入)</div>

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-bold text-cortex-ink">📦 包裝 BOM</h3>
      {/* 包裝變異 tabs */}
      {pkgVals.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setActive(0)}
            className={`px-2.5 py-1 rounded text-[11px] border ${active === 0 ? 'bg-cortex-navy text-white border-cortex-navy' : 'bg-white border-cortex-line text-cortex-muted'}`}>全部</button>
          {pkgVals.map((v) => (
            <button key={v.id} onClick={() => setActive(v.id)}
              className={`px-2.5 py-1 rounded text-[11px] border ${active === v.id ? 'bg-cortex-navy text-white border-cortex-navy' : 'bg-white border-cortex-line text-cortex-muted'}`}>{v.code}</button>
          ))}
        </div>
      )}
      {/* 合計卡 */}
      {data && (
        <div className="flex items-center gap-4 text-[11px] bg-cortex-cyan-bg/40 border border-cortex-teal/30 rounded p-2 flex-wrap">
          <span>包裝單件 Quote:<span className="font-mono font-bold text-cortex-teal">{m4(data.totalQuote)}</span></span>
          {typeof data.totalTrue === 'number' && <span>True Cost:<span className="font-mono">{m4(data.totalTrue)}</span></span>}
          {typeof data.markupAvg === 'number' && <span>Markup:<span className="font-mono">{pc(data.markupAvg)}</span></span>}
          <span className="text-cortex-muted">{data.count} 項</span>
        </div>
      )}
      {/* 明細 */}
      {data && data.items.length > 0 ? (
        <div className="overflow-x-auto border border-cortex-line rounded-lg">
          <table className="w-full text-[10px]">
            <thead className="text-cortex-muted border-b border-cortex-line bg-cortex-bg/40"><tr>
              <th className="text-left px-2 py-1">分類</th><th className="text-left px-2 py-1">Item</th>
              <th className="text-left px-2 py-1">Description</th><th className="text-right px-2 py-1">Qty</th>
              <th className="text-left px-2 py-1">Vendor</th>
              <th className="text-right px-2 py-1">True</th><th className="text-right px-2 py-1">Quote</th>
              <th className="text-right px-2 py-1">Markup</th><th className="text-right px-2 py-1">小計(Quote)</th>
            </tr></thead>
            <tbody>
              {data.items.map((r: any, i: number) => (
                <tr key={i} className={`border-b border-cortex-line/30 ${!r.quote_price ? 'bg-amber-50/50' : ''}`}>
                  <td className="px-2 py-1">{r.category}</td>
                  <td className="px-2 py-1 font-mono">{r.item_no || '—'}</td>
                  <td className="px-2 py-1 max-w-[260px] truncate" title={r.description}>{r.description}</td>
                  <td className="px-2 py-1 text-right font-mono">{r.qty}</td>
                  <td className="px-2 py-1">{r.vendor || '—'}</td>
                  <td className="px-2 py-1 text-right font-mono text-cortex-muted">{m6(r.true_cost_usd)}</td>
                  <td className="px-2 py-1 text-right font-mono">{m6(r.quote_price)}</td>
                  <td className="px-2 py-1 text-right font-mono">{pc(r.markup_pct)}</td>
                  <td className="px-2 py-1 text-right font-mono">{m6(r.ext_quote)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-[11px] text-cortex-muted">此配置下無 PKG 料。</div>
      )}
      {/* Pallet Compliance */}
      <div className="border border-cortex-line rounded-lg p-2.5 flex items-center gap-3 flex-wrap text-[11px]">
        <span className="font-semibold text-cortex-ink">Pallet Compliance:</span>
        {PALLETS.map((p) => {
          const on = pallet.includes(p.key)
          return (
            <label key={p.key} className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={on} disabled={busy}
                onChange={() => savePallet(on ? pallet.filter((x) => x !== p.key) : [...pallet, p.key])} />
              {p.label}
            </label>
          )
        })}
        {palletDirty && <span className="text-red-600 text-[10px]">存檔失敗,再點一次</span>}
      </div>
    </div>
  )
}

type PackagingItem = {
  no: number
  part_name: string
  spec?: string
  qty: number
  unit_price: number
  vendor?: string
  lead_time_wk?: number
  note?: string
}

type PackagingData = {
  template?: string
  items_count: number
  pallet_compliance?: string
  total_per_unit: number
  vendor_count: number
  items: PackagingItem[]
}

export default function PackagingSection({ project }: { project: ProjectDetail }) {
  const dp = (project.data_payload as any) || {}
  const data: PackagingData | undefined = dp.packaging

  if (!data?.items?.length) {
    // 真 BOM 專案:PKG 模組料視圖(v0.16 #5)
    return <RealPackagingView project={project} />
  }

  const total = data.total_per_unit
  const vendorCount = data.vendor_count

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-bold text-cortex-ink flex items-center gap-2">
            📦 Packaging
            <span className="text-[9px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">v0.5 §11.3.7</span>
            <span className="text-[9px] font-bold bg-cortex-cyan-bg text-cortex-teal px-1.5 py-0.5 rounded">
              {data.items.length} 項
            </span>
          </h3>
          <p className="text-[12px] text-cortex-muted mt-0.5">
            child-table 8 欄 · 範本「{data.template || '自訂'}」· pallet compliance: <strong>{data.pallet_compliance || '—'}</strong>
          </p>
        </div>
      </div>

      {/* 3 個 derived widget */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white border border-cortex-line rounded-lg p-3">
          <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">PKG Total / unit</div>
          <div className="text-xl font-bold text-cortex-navy font-mono mt-1">${total.toFixed(3)}</div>
          <div className="text-[9px] text-cortex-muted">/ unit · SUM(qty × price)</div>
        </div>
        <div className="bg-white border border-cortex-line rounded-lg p-3">
          <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">Vendor 數</div>
          <div className="text-xl font-bold text-cortex-teal font-mono mt-1">{vendorCount}</div>
          <div className="text-[9px] text-cortex-muted">DISTINCT vendor</div>
        </div>
        <div className="bg-white border border-cortex-line rounded-lg p-3">
          <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">Pallet 規範</div>
          <div className="text-xl font-bold text-cortex-ocean font-mono mt-1">{data.pallet_compliance || '—'}</div>
          <div className="text-[9px] text-cortex-muted">影響運費 / 重量</div>
        </div>
      </div>

      {/* Packaging 16 項表格 */}
      <div className="bg-white border border-cortex-line rounded-lg p-3">
        <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-2">
          Packaging BOM · child-table
        </div>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-cortex-muted border-b border-cortex-line">
              <th className="text-right py-1 px-1.5">#</th>
              <th className="text-left py-1 px-1.5">Part Name</th>
              <th className="text-left py-1 px-1.5">Specifications</th>
              <th className="text-right py-1 px-1.5">Qty</th>
              <th className="text-right py-1 px-1.5">Unit Price</th>
              <th className="text-left py-1 px-1.5">Vendor</th>
              <th className="text-right py-1 px-1.5">LT(週)</th>
              <th className="text-left py-1 px-1.5">Note</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.no} className="border-b border-cortex-line/40 hover:bg-cortex-bg/30">
                <td className="py-1 px-1.5 text-right font-mono text-cortex-muted">{it.no}</td>
                <td className="py-1 px-1.5 text-cortex-ink font-semibold">{it.part_name}</td>
                <td className="py-1 px-1.5 text-[10px] text-cortex-text">{it.spec || '—'}</td>
                <td className="py-1 px-1.5 text-right font-mono text-cortex-text">{it.qty}</td>
                <td className="py-1 px-1.5 text-right font-mono text-cortex-ink">${it.unit_price.toFixed(3)}</td>
                <td className="py-1 px-1.5 text-cortex-text text-[10px]">{it.vendor || '—'}</td>
                <td className="py-1 px-1.5 text-right font-mono text-cortex-muted">{it.lead_time_wk ?? '—'}</td>
                <td className="py-1 px-1.5 text-[10px] text-cortex-muted">{it.note || '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-cortex-cyan bg-cortex-cyan-bg/20">
              <td colSpan={4} className="py-1.5 px-1.5 text-right font-bold text-cortex-teal">合計 / unit</td>
              <td className="py-1.5 px-1.5 text-right font-mono font-bold text-cortex-navy">${total.toFixed(3)}</td>
              <td colSpan={3} className="py-1.5 px-1.5 text-[10px] text-cortex-muted">propagate 到 cost section 的 material_cost_pkg</td>
            </tr>
          </tfoot>
        </table>
        <div className="text-[10px] text-cortex-muted mt-2 flex items-center gap-3 flex-wrap">
          <span>👤 MPM Tony · 工廠採購 Ken 共填</span>
          <span className="ml-auto text-cortex-green font-bold">✓ 已存</span>
        </div>
      </div>

      <div className="bg-cortex-bg/60 border-l-2 border-cortex-cyan rounded-r p-2.5 text-[10px] text-cortex-text leading-relaxed">
        <strong className="text-cortex-ocean">spec §11.3.7 設計</strong>:
        各 vendor 走「詢價彙總」section 同一 vendor master(可 cross-reference)· 變更 propagate 到 cost section 的 material_cost_pkg
        · 不獨立成 child project · 預設 3 範本(Mouse / Headset / Connector)
      </div>
    </div>
  )
}
