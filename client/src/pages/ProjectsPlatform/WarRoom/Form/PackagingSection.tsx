/**
 * PackagingSection — v0.5 §11.3.7 Packaging Sub-form(唯讀)
 *
 * 從 data_payload.packaging 讀,顯示:
 *   - 16 項 child-table(NO / Part / Spec / Qty / Unit Price / Vendor / LT / Note)
 *   - 計算:pkg_total_per_unit / vendor_count
 *   - pallet_compliance enum
 */

import type { ProjectDetail } from '../../api'

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
    return (
      <div className="p-4 text-center text-cortex-muted text-[12px] italic">
        此專案未啟用 Packaging Sub-form
      </div>
    )
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
