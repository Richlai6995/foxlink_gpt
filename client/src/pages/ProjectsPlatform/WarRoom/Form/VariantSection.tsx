/**
 * VariantSection — v0.5 §11.3.5 CMF Variant Dimension(唯讀)
 *
 * 從 data_payload.variants 讀,顯示:
 *   - axis_key + variant_values
 *   - per_variant 表格(qty / share / material_cost / ME BOM)
 *   - Roll-up:加權平均 material cost + 總年材料成本
 */

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { ProjectDetail } from '../../api'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'

const fmtMoney = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(4)}` : '—')

/**
 * v0.16 #3:真 BOM 專案的 CMF 變體 —— 顏色維度值 × share/qty(存 form.variant.shares)
 * 材料成本 = 該顏色 config 的 rollup(動態);加權平均 = Σ(mat×qty)/Σqty
 */
function CmfSharesCard({ project }: { project: ProjectDetail }) {
  const { token } = useAuth() as any
  const projectId = project.id
  const [vals, setVals] = useState<{ id: number; code: string; mat: number | null }[]>([])
  const [shares, setShares] = useState<Record<string, { share?: string; qty?: string }>>({})
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!token) return
    ;(async () => {
      try {
        const dims = await api.get<any>(token, `/bom/project/${projectId}/dimensions`)
        const colorDim = (dims.dimensions || []).find((d: any) => /顏色|COLOR/i.test(d.dimCode))
        if (!colorDim?.values?.length) { setLoaded(true); return }
        const inst = await api.get<any>(token, `/bom/project/${projectId}/latest-instance`).catch(() => null)
        const rows: { id: number; code: string; mat: number | null }[] = []
        for (const v of colorDim.values) {
          let mat: number | null = null
          if (inst?.bomInstanceId) {
            const roll = await api.get<any>(token, `/bom/instances/${inst.bomInstanceId}/rollup?valueIds=${v.id}`).catch(() => null)
            const n = Number(roll?.materialUsd)
            mat = Number.isFinite(n) ? n : null
          }
          rows.push({ id: v.id, code: v.valueCode, mat })
        }
        setVals(rows)
        const f = await api.get<any>(token, `/bom/form?projectId=${projectId}`)
        setShares((f.form?.variant?.shares) || {})
      } catch { /* noop */ } finally { setLoaded(true) }
    })()
  }, [token, projectId])   // eslint-disable-line

  if (!loaded) return <div className="text-[12px] text-cortex-muted"><Loader2 className="w-3.5 h-3.5 inline animate-spin" /> 載入變體…</div>
  if (!vals.length) return null

  const set = (id: number, k: 'share' | 'qty', v: string) => { setShares((p) => ({ ...p, [id]: { ...(p[id] || {}), [k]: v } })); setDirty(true) }
  async function save() {
    setBusy(true); setMsg('')
    try {
      await api.put(token, '/bom/form/variant', { projectId, fields: { shares } })
      setDirty(false); setMsg('✓ 已存檔'); window.dispatchEvent(new CustomEvent('cortex:form-refresh'))
      setTimeout(() => setMsg(''), 2500)
    } catch (e: any) { setMsg(`存檔失敗:${e.message}`) } finally { setBusy(false) }
  }
  // 加權平均(share 正規化;qty 有填優先用 qty 權重)
  const rows = vals.map((v) => ({ ...v, share: Number(shares[v.id]?.share) || 0, qty: Number(shares[v.id]?.qty) || 0 }))
  const qtySum = rows.reduce((a, r) => a + r.qty, 0)
  const shareSum = rows.reduce((a, r) => a + r.share, 0)
  const weights = rows.map((r) => (qtySum > 0 ? r.qty / qtySum : shareSum > 0 ? r.share / shareSum : 0))
  const wAvg = rows.every((r) => r.mat != null) && (qtySum > 0 || shareSum > 0)
    ? rows.reduce((a, r, i) => a + (r.mat as number) * weights[i], 0) : null

  return (
    <div className="border border-cortex-line rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-bold text-cortex-ink">🎨 CMF 變體 · 佔比 / 數量
          <span className="text-[10px] text-cortex-muted font-normal ml-1.5">材料成本 = 該顏色配置 rollup(動態)· 加權平均供成本核算參考</span>
        </div>
        <div className="flex items-center gap-2">
          {msg && <span className={`text-[10px] ${msg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{msg}</span>}
          <button onClick={save} disabled={busy || !dirty}
            className="px-2.5 py-1 bg-cortex-navy text-white rounded hover:opacity-90 disabled:opacity-40 text-[11px]">
            {busy ? <Loader2 className="w-3 h-3 inline animate-spin" /> : null} 存檔
          </button>
        </div>
      </div>
      <table className="w-full text-[11px]">
        <thead className="text-cortex-muted border-b border-cortex-line"><tr>
          <th className="text-left px-2 py-1">變體(顏色)</th>
          <th className="text-right px-2 py-1">佔比 %</th>
          <th className="text-right px-2 py-1">年量(pcs)</th>
          <th className="text-right px-2 py-1">材料成本(rollup)</th>
          <th className="text-right px-2 py-1">權重</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="border-b border-cortex-line/40">
              <td className="px-2 py-1.5"><span className="text-[10px] bg-purple-50 text-purple-700 border border-purple-200 rounded px-1.5 py-0.5">{r.code}</span></td>
              <td className="px-2 py-1.5 text-right">
                <input value={shares[r.id]?.share || ''} onChange={(e) => set(r.id, 'share', e.target.value)} placeholder="80"
                  className="w-16 border border-cortex-line rounded px-1.5 py-0.5 text-right font-mono text-[11px]" />
              </td>
              <td className="px-2 py-1.5 text-right">
                <input value={shares[r.id]?.qty || ''} onChange={(e) => set(r.id, 'qty', e.target.value)} placeholder="334400"
                  className="w-24 border border-cortex-line rounded px-1.5 py-0.5 text-right font-mono text-[11px]" />
              </td>
              <td className="px-2 py-1.5 text-right font-mono">{fmtMoney(r.mat)}</td>
              <td className="px-2 py-1.5 text-right font-mono text-cortex-muted">{(weights[i] * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-4 text-[11px] bg-cortex-cyan-bg/40 border border-cortex-teal/30 rounded p-2">
        <span>加權平均材料成本:<span className="font-mono font-bold text-cortex-teal">{fmtMoney(wAvg)}</span></span>
        <span className="text-cortex-muted">總年量:<span className="font-mono">{qtySum ? qtySum.toLocaleString('en-US') : '—'}</span></span>
        {shareSum > 0 && Math.abs(shareSum - 100) > 0.01 && qtySum === 0 && <span className="text-amber-600">⚠ 佔比合計 {shareSum}%(非 100,已自動正規化)</span>}
      </div>
    </div>
  )
}

type Variant = {
  key: string
  label: string
  share: number
  qty: number
  material_cost: number
  me_bom?: string
  note?: string
}

type VariantData = {
  axis_key: string
  axis_label?: string
  cardinality: number
  items: Variant[]
}

export default function VariantSection({ project }: { project: ProjectDetail }) {
  const dp = (project.data_payload as any) || {}
  const data: VariantData | undefined = dp.variants

  if (!data?.items?.length) {
    // 真 BOM 專案:走變異軸(顏色維度)share/qty 卡(v0.16 #3)
    return (
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-cortex-ink">🎨 CMF 變體</h3>
        <CmfSharesCard project={project} />
      </div>
    )
  }

  const totalQty = data.items.reduce((a, v) => a + v.qty, 0)
  const wAvgMat = data.items.reduce((a, v) => a + v.material_cost * v.qty, 0) / totalQty

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-bold text-cortex-ink flex items-center gap-2">
            🎨 CMF 變體
            <span className="text-[9px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">v0.5 §11.3.5</span>
            <span className="text-[9px] font-bold bg-cortex-green-bg text-cortex-green px-1.5 py-0.5 rounded">✓ DONE</span>
          </h3>
          <p className="text-[12px] text-cortex-muted mt-0.5">
            單軸 ≤ 5 variant · variant-aware fields · UI tab switcher + Roll-up
          </p>
        </div>
      </div>

      {/* Spec banner */}
      <div className="bg-cortex-cyan-bg/40 border border-cortex-cyan/40 rounded-lg p-3 text-[12px] text-cortex-teal leading-relaxed">
        <strong className="text-cortex-navy">📐 Variant 模型(spec §11.3.5)</strong><br />
        此專案宣告 <code className="bg-white px-1 py-0.5 rounded text-cortex-ocean font-mono text-[11px]">axis_key={data.axis_key}</code>,{data.cardinality} 個 variant({data.items.map((v) => v.label).join(' / ')}),共用 EE BOM、PKG;ME BOM / material cost / qty 為 <code className="bg-white px-1 py-0.5 rounded text-cortex-ocean font-mono text-[11px]">per_variant</code>。年量 <strong>{totalQty.toLocaleString()}</strong> 依比例分配。
      </div>

      {/* Variant axis 定義 */}
      <div className="bg-white border border-cortex-line rounded-lg p-3">
        <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-2">
          Variant 軸定義 · AXIS
        </div>
        <div className="flex items-center gap-2 text-[12px]">
          <input value={data.axis_key} disabled className="px-2 py-1 border border-cortex-line rounded font-mono w-44 bg-cortex-bg" />
          <span className="text-cortex-muted">→</span>
          {data.items.map((v) => (
            <span
              key={v.key}
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                v.key === 'black' ? 'bg-slate-800 text-white border-slate-800' :
                v.key === 'white' ? 'bg-white text-slate-800 border-cortex-line' :
                                    'bg-cortex-cyan-bg text-cortex-teal border-cortex-cyan/30'
              }`}
            >
              {v.label}
            </span>
          ))}
          <span className="ml-auto text-[10px] text-cortex-muted">cardinality = {data.cardinality}(限 ≤ 5)</span>
        </div>
      </div>

      {/* Variant 配置表 */}
      <div className="bg-white border border-cortex-line rounded-lg p-3">
        <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-2 flex items-center gap-2">
          變體配置與用量 · TABLE · per_variant
          <span className="text-[8px] text-amber-700 bg-cortex-amber-bg px-1 py-0.5 rounded">每 variant 一個值</span>
        </div>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-cortex-muted border-b border-cortex-line">
              <th className="text-left py-1 px-1.5">Variant</th>
              <th className="text-right py-1 px-1.5">佔比</th>
              <th className="text-right py-1 px-1.5">年量</th>
              <th className="text-left py-1 px-1.5">ME BOM</th>
              <th className="text-right py-1 px-1.5">Material Cost</th>
              <th className="text-left py-1 px-1.5">備註</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((v) => (
              <tr key={v.key} className="border-b border-cortex-line/40">
                <td className="py-1.5 px-1.5">
                  <span className={`inline-block w-2.5 h-2.5 rounded-sm mr-1.5 border ${v.key === 'black' ? 'bg-slate-800 border-slate-800' : 'bg-slate-100 border-cortex-line'}`} />
                  <span className="font-bold text-cortex-ink">{v.label}</span>
                </td>
                <td className="py-1.5 px-1.5 text-right text-cortex-text font-mono">{(v.share * 100).toFixed(0)}%</td>
                <td className="py-1.5 px-1.5 text-right font-mono text-cortex-ocean font-bold">{v.qty.toLocaleString()}</td>
                <td className="py-1.5 px-1.5 font-mono text-[10px] text-cortex-text">{v.me_bom || '—'}</td>
                <td className="py-1.5 px-1.5 text-right font-mono text-cortex-ink font-bold">${v.material_cost.toFixed(2)}</td>
                <td className="py-1.5 px-1.5 text-[10px] text-cortex-muted">{v.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-[10px] text-cortex-muted mt-2 flex items-center justify-between">
          <span>👤 Alvin (ME) · Mike Chen 共同編 · 4/22</span>
          <span className="text-cortex-green font-bold">✓ 已存</span>
        </div>
      </div>

      {/* Roll-up */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-cortex-cyan-bg/40 to-white border border-cortex-cyan/30 rounded-lg p-3">
          <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">
            Variant Roll-up · 加權平均 material cost
          </div>
          <div className="text-2xl font-bold text-cortex-navy font-mono mt-1">${wAvgMat.toFixed(3)}</div>
          <div className="text-[10px] text-cortex-muted mt-0.5">/ unit · SUMPRODUCT(qty × cost) / total_qty</div>
        </div>
        <div className="bg-gradient-to-br from-cortex-cyan-bg/40 to-white border border-cortex-cyan/30 rounded-lg p-3">
          <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">
            Variant Roll-up · 總年材料成本
          </div>
          <div className="text-2xl font-bold text-cortex-navy font-mono mt-1">
            ${(wAvgMat * totalQty).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[10px] text-cortex-muted mt-0.5">/ yr · 不含 NRE / 不含 transformation</div>
        </div>
      </div>

      <div className="bg-cortex-bg/60 border-l-2 border-cortex-cyan rounded-r p-2.5 text-[10px] text-cortex-text leading-relaxed">
        <strong className="text-cortex-ocean">spec §11.3.5.4 UI 設計</strong><br />
        正常會有 Variant Tab Switcher: <code className="bg-white px-1 rounded">[ 全部 | Black | White ]</code>。
        本 demo 為簡化展示,直接同畫面呈現 per-variant 表格。實作時切到「Black」tab 只顯示 Black 那列。
      </div>
    </div>
  )
}
