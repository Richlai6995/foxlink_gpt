/**
 * BomSection — WarRoom > 報價 Form > BOM / 材料匯入(專案內 · RD 可用)
 *
 * 架構修正(2026-07-02 · doc §9):BOM 匯入/成本試算是「專案內」功能,不是 standalone admin 頁。
 * scoped 到當前 project:
 *   - 下載標準範本 → 填 → 上傳(projectId = 本專案)→ 正規化 bom_* + material rollup
 *   - 若本專案已設 case_factory(成本模型)→ 可「算成本」(computeCase)→ run_result
 *   - 無 case_factory → 只做匯入/rollup,算成本提示需先設定廠別/baseline(§9.4)
 *
 * 後端:/api/projects/bom/*(template / import / cases?projectId / compute / runs)
 * 註:i18n 待補;細粒度 RD×資料範圍×欄位機密 = S2 三軸 RBAC。
 */

import { useEffect, useState } from 'react'
import type { ProjectDetail } from '../../api'
import { api, ApiError } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { Download, Upload, Calculator, Loader2, CheckCircle2, AlertCircle, Info } from 'lucide-react'

type CaseRow = { case_factory_id: number; project_id: number; factory_code: string; costing_model: string; status: string; project_code: string }

export default function BomSection({ project }: { project: ProjectDetail }) {
  const { token } = useAuth() as any
  const projectId = project.id
  const [cases, setCases] = useState<CaseRow[]>([])
  const [caseFactoryId, setCaseFactoryId] = useState<number | ''>('')
  const [variantKey, setVariantKey] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [computing, setComputing] = useState(false)
  const [importResult, setImportResult] = useState<any>(null)
  const [runResult, setRunResult] = useState<any>(null)
  const [pendingGate, setPendingGate] = useState<{ pendingCount: number } | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!token) return
    api.get<{ cases: CaseRow[] }>(token, `/bom/cases?projectId=${projectId}`)
      .then((r) => {
        setCases(r.cases || [])
        if (r.cases?.length) setCaseFactoryId(r.cases[0].case_factory_id)
      })
      .catch((e) => setErr(e.message))
  }, [token, projectId])

  const hasCase = cases.length > 0

  async function downloadTemplate() {
    setErr('')
    try {
      const res = await fetch('/api/projects/bom/template', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`範本下載失敗 (HTTP ${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'cortex-bom-template.xlsx'; a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) { setErr(e.message) }
  }

  async function doImport() {
    if (!file) { setErr('請選擇填好的 BOM 範本檔'); return }
    setImporting(true); setErr(''); setImportResult(null); setRunResult(null); setPendingGate(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('projectId', String(projectId))
      if (variantKey) fd.append('variantKey', variantKey)
      const res = await fetch('/api/projects/bom/import', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `匯入失敗 (HTTP ${res.status})`)
      setImportResult(data)
    } catch (e: any) { setErr(e.message) } finally { setImporting(false) }
  }

  async function doCompute(force = false) {
    if (!caseFactoryId || !importResult?.bomInstanceId) { setErr('需先匯入 + 本專案有成本模型(case_factory)'); return }
    setComputing(true); setErr('')
    try {
      const r = await api.post(token, '/bom/compute', { caseFactoryId, bomInstanceId: importResult.bomInstanceId, ...(force ? { force: true } : {}) })
      setRunResult(r); setPendingGate(null)
    } catch (e: any) {
      // B-5a:有未詢價料件 → 409,提示可「強制試算」只算已詢價材料
      if (e instanceof ApiError && e.status === 409 && e.body?.code === 'BOM_HAS_PENDING_PRICES') {
        setPendingGate({ pendingCount: e.body.pendingCount || 0 })
      } else { setErr(e.message) }
    } finally { setComputing(false) }
  }

  const money = (v: any) => (typeof v === 'number' ? `$${v.toFixed(4)}` : '—')

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold text-cortex-ink flex items-center gap-2">
          📦 BOM / 材料匯入
          <span className="text-[9px] font-bold bg-cortex-cyan-bg text-cortex-teal px-1.5 py-0.5 rounded">專案內 · RD</span>
        </h3>
        <p className="text-[12px] text-cortex-muted mt-0.5">下載標準範本 → 填料件(EE/ME/PKG）→ 上傳到本專案 → 材料 rollup → 算成本。</p>
      </div>

      {err && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded p-2.5 text-[12px]">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span className="break-all">{err}</span>
        </div>
      )}

      {/* ① 下載範本 */}
      <div className="flex items-center justify-between bg-cortex-bg/40 border border-cortex-line rounded-lg p-3">
        <div className="text-[12px]">
          <div className="font-semibold text-cortex-ink">① 下載匯入範本</div>
          <div className="text-cortex-muted mt-0.5">EE / ME / PKG 三分頁。必填:Category / Qty / Unit Price (USD)。</div>
        </div>
        <button onClick={downloadTemplate} disabled={!token}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-cortex-navy text-white text-[12px] rounded hover:opacity-90 disabled:opacity-40 shrink-0">
          <Download className="w-3.5 h-3.5" /> 下載範本
        </button>
      </div>

      {/* ② 上傳 */}
      <div className="bg-cortex-bg/40 border border-cortex-line rounded-lg p-3 space-y-2.5">
        <div className="text-[12px] font-semibold text-cortex-ink">② 上傳填好的範本(→ 本專案 #{projectId})</div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-[12px] text-cortex-text file:mr-2 file:px-2.5 file:py-1 file:border-0 file:rounded file:bg-white file:text-cortex-ink file:cursor-pointer file:text-[12px]" />
          <input value={variantKey} onChange={(e) => setVariantKey(e.target.value)} placeholder="variant(選填 black/white)"
            className="border border-cortex-line rounded px-2 py-1 text-[12px] w-44" />
          <button onClick={doImport} disabled={importing || !file}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cortex-teal text-white text-[12px] rounded hover:opacity-90 disabled:opacity-40 shrink-0">
            {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} 匯入
          </button>
        </div>
      </div>

      {/* ③ rollup 結果 */}
      {importResult && (
        <div className="bg-white border border-cortex-line rounded-lg p-3 space-y-2">
          <div className="text-[12px] font-semibold text-cortex-ink flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-cortex-teal" /> ③ 匯入結果 · bom_instance #{importResult.bomInstanceId}
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="px-2 py-0.5 bg-cortex-bg border border-cortex-line rounded">料件 {importResult.itemCount}</span>
            <span className="px-2 py-0.5 bg-cortex-bg border border-cortex-line rounded">供應商 {importResult.mfgCount}</span>
            {importResult.sections?.map((s: any) => (
              <span key={s.category} className="px-2 py-0.5 bg-cortex-bg border border-cortex-line rounded">{s.category}: {s.itemCount}</span>
            ))}
          </div>
          <div className="bg-cortex-bg/60 border border-cortex-line rounded p-2.5 text-[12px]">
            <div className="font-semibold text-cortex-ink mb-1">材料成本 rollup / unit</div>
            {importResult.rollup?.byCategory && Object.entries(importResult.rollup.byCategory).map(([k, v]) => (
              <div key={k} className="flex justify-between"><span className="text-cortex-muted">{k}</span><span className="font-mono">{money(v)}</span></div>
            ))}
            <div className="flex justify-between border-t border-cortex-line mt-1 pt-1 font-semibold">
              <span>全材料</span><span className="font-mono">{money(importResult.rollup?.materialUsd)}</span>
            </div>
            {importResult.rollup?.pendingCount > 0 && (
              <div className="mt-1 text-[11px] text-amber-700">⚠️ {importResult.rollup.pendingCount} 筆待詢價(採購後補價)· 材料僅計 {importResult.rollup.pricedCount} 筆已詢價</div>
            )}
          </div>

          {/* ④ 算成本 */}
          {hasCase ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {cases.length > 1 && (
                  <select value={caseFactoryId} onChange={(e) => setCaseFactoryId(Number(e.target.value))}
                    className="border border-cortex-line rounded px-2 py-1 text-[12px]">
                    {cases.map((c) => <option key={c.case_factory_id} value={c.case_factory_id}>#{c.case_factory_id} · {c.factory_code} · {c.costing_model}</option>)}
                  </select>
                )}
                <button onClick={() => doCompute()} disabled={computing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-cortex-navy text-white text-[12px] rounded hover:opacity-90 disabled:opacity-40">
                  {computing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calculator className="w-3.5 h-3.5" />} ④ 算成本
                </button>
              </div>
              {pendingGate && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded p-2.5 text-[11px]">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    有 <b>{pendingGate.pendingCount}</b> 筆料件尚未詢價,成本不完整(採購補價後再重算)。可先只算已詢價材料 →
                    <button onClick={() => doCompute(true)} disabled={computing}
                      className="ml-2 px-2 py-0.5 bg-amber-600 text-white rounded hover:opacity-90 disabled:opacity-40">強制試算</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded p-2.5 text-[11px]">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              此專案尚未設定成本模型(case_factory / baseline · 廠別+製程+設備參數)。已可匯入材料 + 看 rollup;完整算成本需先設定(後續開案流程 §9.4)。
            </div>
          )}
        </div>
      )}

      {/* ⑤ 成本結果 */}
      {runResult && (
        <div className="bg-white border border-cortex-line rounded-lg p-3 space-y-1.5">
          <div className="text-[12px] font-semibold text-cortex-ink flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-cortex-teal" /> ⑤ 成本結果 · run #{runResult.runId} · {runResult.costingModel}
          </div>
          <table className="w-full text-[12px]">
            <tbody>
              {[
                ['材料 (material_true)', runResult.costBreakdown?.material],
                ['MVA', runResult.costBreakdown?.mva],
                ['SG&A', runResult.costBreakdown?.sga],
                ['Profit', runResult.costBreakdown?.profit],
              ].map(([k, v]) => (
                <tr key={k as string} className="border-b border-cortex-line/50">
                  <td className="py-1 text-cortex-muted">{k as string}</td><td className="py-1 text-right font-mono">{money(v)}</td>
                </tr>
              ))}
              <tr className="font-bold text-cortex-ink">
                <td className="py-1.5">Total / unit</td><td className="py-1.5 text-right font-mono">{money(runResult.costBreakdown?.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
