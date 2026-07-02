/**
 * BomImport — Cortex BOM 匯入 / 成本試算(admin-only dev-test 頁)
 *
 * 流程:下載標準範本 → 填 → 選 case + 上傳 → 看 rollup → 算成本 → 看 run 結果。
 * 後端:/api/projects/bom/*(template / import / compute / runs)· 見 routes/bom.js。
 * 註:i18n 待補(目前 admin-only dev-test · zh-TW)。
 */

import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { api } from '../api'
import { Download, Upload, Calculator, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

type CaseRow = { case_factory_id: number; project_id: number; factory_code: string; costing_model: string; status: string; project_code: string }

export default function BomImport() {
  const { token } = useAuth() as any
  const [cases, setCases] = useState<CaseRow[]>([])
  const [caseFactoryId, setCaseFactoryId] = useState<number | ''>('')
  const [variantKey, setVariantKey] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [computing, setComputing] = useState(false)
  const [importResult, setImportResult] = useState<any>(null)
  const [runResult, setRunResult] = useState<any>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!token) return
    api.get<{ cases: CaseRow[] }>(token, '/bom/cases').then((r) => setCases(r.cases || [])).catch((e) => setErr(e.message))
  }, [token])

  const selectedCase = cases.find((c) => c.case_factory_id === caseFactoryId)
  const projectId = selectedCase?.project_id

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
    if (!file) { setErr('請選擇 BOM Excel 檔'); return }
    if (!projectId) { setErr('請先選 case（決定 projectId）'); return }
    setImporting(true); setErr(''); setImportResult(null); setRunResult(null)
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

  async function doCompute() {
    if (!caseFactoryId || !importResult?.bomInstanceId) { setErr('需先匯入 + 選 case'); return }
    setComputing(true); setErr('')
    try {
      const r = await api.post(token, '/bom/compute', { caseFactoryId, bomInstanceId: importResult.bomInstanceId })
      setRunResult(r)
    } catch (e: any) { setErr(e.message) } finally { setComputing(false) }
  }

  const money = (v: any) => (typeof v === 'number' ? `$${v.toFixed(4)}` : '—')

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-cortex-ink flex items-center gap-2">📦 BOM 匯入 / 成本試算</h1>
        <p className="text-sm text-cortex-muted mt-1">下載範本 → 填料件（EE/ME/PKG 分頁）→ 選 case 上傳 → 算成本。admin-only dev-test。</p>
      </div>

      {err && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span className="break-all">{err}</span>
        </div>
      )}

      {/* 1. 下載範本 */}
      <section className="bg-white border border-cortex-line rounded-lg shadow-cortex p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-cortex-ink">① 下載匯入範本</h2>
            <p className="text-xs text-cortex-muted mt-0.5">EE / ME / PKG 三分頁 + 說明。必填:Category / Qty / Unit Price (USD)。</p>
          </div>
          <button onClick={downloadTemplate} disabled={!token}
            className="flex items-center gap-1.5 px-3 py-2 bg-cortex-navy text-white text-sm rounded hover:opacity-90 transition disabled:opacity-40">
            <Download className="w-4 h-4" /> 下載範本
          </button>
        </div>
      </section>

      {/* 2. 選 case + 上傳 */}
      <section className="bg-white border border-cortex-line rounded-lg shadow-cortex p-4 space-y-3">
        <h2 className="font-semibold text-cortex-ink">② 選 case + 上傳填好的範本</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="text-cortex-muted text-xs">Case（廠 · 決定 project/costing）</span>
            <select value={caseFactoryId} onChange={(e) => setCaseFactoryId(e.target.value ? Number(e.target.value) : '')}
              className="mt-1 w-full border border-cortex-line rounded px-2 py-1.5 text-sm">
              <option value="">— 選 case —</option>
              {cases.map((c) => (
                <option key={c.case_factory_id} value={c.case_factory_id}>
                  #{c.case_factory_id} · {c.project_code} · {c.factory_code} · {c.costing_model}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-cortex-muted text-xs">Variant（選填 · black/white）</span>
            <input value={variantKey} onChange={(e) => setVariantKey(e.target.value)} placeholder="留空 = shared"
              className="mt-1 w-full border border-cortex-line rounded px-2 py-1.5 text-sm" />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-sm text-cortex-text file:mr-3 file:px-3 file:py-1.5 file:border-0 file:rounded file:bg-cortex-bg file:text-cortex-ink file:cursor-pointer" />
          <button onClick={doImport} disabled={importing || !file || !projectId}
            className="flex items-center gap-1.5 px-3 py-2 bg-cortex-teal text-white text-sm rounded hover:opacity-90 transition disabled:opacity-40 shrink-0">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} 匯入
          </button>
        </div>
        {projectId && <p className="text-xs text-cortex-muted">→ projectId={projectId}</p>}
      </section>

      {/* 3. rollup 結果 */}
      {importResult && (
        <section className="bg-white border border-cortex-line rounded-lg shadow-cortex p-4 space-y-2">
          <h2 className="font-semibold text-cortex-ink flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-cortex-teal" /> ③ 匯入結果</h2>
          <div className="text-sm text-cortex-text">
            bom_instance <b>#{importResult.bomInstanceId}</b> · 料件 <b>{importResult.itemCount}</b> · 供應商 {importResult.mfgCount} · 分類 {importResult.categoryCount}
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {importResult.sections?.map((s: any) => (
              <span key={s.category} className="px-2 py-0.5 bg-cortex-bg border border-cortex-line rounded text-xs">{s.category}: {s.itemCount} 件</span>
            ))}
          </div>
          <div className="bg-cortex-bg border border-cortex-line rounded p-3 text-sm">
            <div className="font-semibold text-cortex-ink mb-1">材料成本 rollup</div>
            {importResult.rollup?.byCategory && Object.entries(importResult.rollup.byCategory).map(([k, v]) => (
              <div key={k} className="flex justify-between"><span className="text-cortex-muted">{k}</span><span className="font-mono">{money(v)}</span></div>
            ))}
            <div className="flex justify-between border-t border-cortex-line mt-1 pt-1 font-semibold">
              <span>全材料 / unit</span><span className="font-mono">{money(importResult.rollup?.materialUsd)}</span>
            </div>
          </div>
          <button onClick={doCompute} disabled={computing || !caseFactoryId}
            className="flex items-center gap-1.5 px-3 py-2 bg-cortex-navy text-white text-sm rounded hover:opacity-90 transition disabled:opacity-40">
            {computing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />} ④ 算成本（material → MVA → 報價）
          </button>
        </section>
      )}

      {/* 4. run 結果 */}
      {runResult && (
        <section className="bg-white border border-cortex-line rounded-lg shadow-cortex p-4 space-y-2">
          <h2 className="font-semibold text-cortex-ink flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-cortex-teal" /> ⑤ 成本結果 · run #{runResult.runId}</h2>
          <div className="text-xs text-cortex-muted">costing_model = {runResult.costingModel}</div>
          <table className="w-full text-sm">
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
                <td className="py-1.5">Total</td><td className="py-1.5 text-right font-mono">{money(runResult.costBreakdown?.total)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
