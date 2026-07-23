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
import { Download, Upload, Calculator, Loader2, CheckCircle2, AlertCircle, Info, Settings, Factory, Layers, ChevronDown, ChevronUp } from 'lucide-react'
import BomItemsPanel from './BomItemsPanel'
import BomFactoryCompare from './BomFactoryCompare'
import BomVariantSetup from './BomVariantSetup'

type CaseRow = { case_factory_id: number; project_id: number; factory_code: string; costing_model: string; status: string; project_code: string }

export default function BomSection({ project }: { project: ProjectDetail }) {
  const { token } = useAuth() as any
  const projectId = project.id
  const [cases, setCases] = useState<CaseRow[]>([])
  const [caseFactoryId, setCaseFactoryId] = useState<number | ''>('')
  const [variantKey, setVariantKey] = useState('')
  const [variants, setVariants] = useState<string[]>([])
  const [customVariant, setCustomVariant] = useState(false)
  // B-2 super-BOM:結構變異維度(顏色/包裝)+ 當前 config
  const [dimensions, setDimensions] = useState<any[]>([])
  const [config, setConfig] = useState<Record<string, number>>({})
  const [showSetup, setShowSetup] = useState(false)
  const [undefVals, setUndefVals] = useState<{ dimCode: string; valueCode: string }[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [mergeMode, setMergeMode] = useState(false)
  const [profiles, setProfiles] = useState<any[]>([])
  const [profileCode, setProfileCode] = useState('CANONICAL')
  const [importing, setImporting] = useState(false)
  const [computing, setComputing] = useState(false)
  const [importResult, setImportResult] = useState<any>(null)
  const [runResult, setRunResult] = useState<any>(null)
  const [pendingGate, setPendingGate] = useState<{ pendingCount: number } | null>(null)
  const [templates, setTemplates] = useState<any[]>([])
  const [tplId, setTplId] = useState<number | ''>('')
  const [provisioning, setProvisioning] = useState(false)
  // C-1 成本模型 Excel 匯入
  const [cmFile, setCmFile] = useState<File | null>(null)
  const [cmFactory, setCmFactory] = useState('')
  const [cmBusy, setCmBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!token) return
    api.get<{ cases: CaseRow[] }>(token, `/bom/cases?projectId=${projectId}`)
      .then((r) => {
        setCases(r.cases || [])
        if (r.cases?.length) setCaseFactoryId((prev) => prev || r.cases[0].case_factory_id)
      })
      .catch((e) => setErr(e.message))
    api.get<{ templates: any[] }>(token, `/bom/provision/templates`).then((r) => setTemplates(r.templates || [])).catch(() => {})
    api.get<{ profiles: any[] }>(token, `/bom/profiles`).then((r) => { setProfiles(r.profiles || []); if (r.profiles?.length) setProfileCode(r.profiles[0].profile_code) }).catch(() => {})
    // 還原:此專案已有匯入的 bom_instance → 重整不消失(#2 修)
    api.get<any>(token, `/bom/project/${projectId}/latest-instance`).then((r) => { if (r?.bomInstanceId) setImportResult(r) }).catch(() => {})
    // 顏色/variant 下拉來源(此專案已存在的)
    api.get<{ variants: string[] }>(token, `/bom/project/${projectId}/variants`).then((r) => setVariants(r.variants || [])).catch(() => {})
    // B-2:結構變異維度(顏色/包裝)+ 預設 config(每維度第一個值)
    reloadDimensions()
  }, [token, projectId])   // eslint-disable-line

  // 變異軸設定變更 / mount → 重載維度 + 補預設 config(保留已選)
  function reloadDimensions() {
    api.get<{ dimensions: any[] }>(token, `/bom/project/${projectId}/dimensions`).then((r) => {
      const dims = r.dimensions || []; setDimensions(dims)
      setConfig((prev) => { const c = { ...prev }; dims.forEach((d) => { if (d.values?.length && !c[d.dimCode]) c[d.dimCode] = d.values[0].id }); return c })
    }).catch(() => {})
  }

  const configValueIds = Object.values(config).filter(Boolean)

  // config(顏色/包裝)變 → 重抓該 config 的 rollup(EE 共用不變、ME/PKG 隨 config)
  useEffect(() => {
    if (!token || !importResult?.bomInstanceId) return
    const q = configValueIds.length ? `?valueIds=${configValueIds.join(',')}` : ''
    api.get<any>(token, `/bom/instances/${importResult.bomInstanceId}/rollup${q}`)
      .then((roll) => setImportResult((prev: any) => (prev ? { ...prev, rollup: roll } : prev)))
      .catch(() => {})
  }, [token, importResult?.bomInstanceId, JSON.stringify(config)])   // eslint-disable-line

  // 試算廠別 + 產品配置 ↔ 成本結果 雙耦合:切廠別/切配置 → 撈該 (廠別,config) 最近 run(無則清空 ⑤)
  useEffect(() => {
    if (!token || !caseFactoryId) { setRunResult(null); return }
    const vids = Object.values(config).filter(Boolean)
    const q = vids.length ? `?valueIds=${vids.join(',')}` : ''
    api.get<any>(token, `/bom/case/${caseFactoryId}/latest-run${q}`)
      .then((r) => setRunResult(r?.runId ? r : null))
      .catch(() => setRunResult(null))
  }, [token, caseFactoryId, JSON.stringify(config)])   // eslint-disable-line

  const hasCase = cases.length > 0
  const activeFactory = cases.find((c) => c.case_factory_id === caseFactoryId)

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
      fd.append('profileCode', profileCode)
      if (mergeMode) fd.append('mergeMode', 'true')   // B-3b 分開匯入(併入現有)
      if (variantKey) fd.append('variantKey', variantKey)
      const res = await fetch('/api/projects/bom/import', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      const data = await res.json()
      // B-3a:未定義變異值 → 開設定 + 標示要補的值(硬擋)
      if (res.status === 409 && data.code === 'BOM_UNDEFINED_VARIANT_VALUES') {
        setUndefVals(data.undefinedValues || []); setShowSetup(true)
        setErr(`匯入含未定義的變異值:${(data.undefinedValues || []).map((u: any) => `${u.dimCode}=${u.valueCode}`).join('、')} —— 請先在下方「變異軸設定」新增後再匯入`)
        return
      }
      if (!res.ok) throw new Error(data.error || `匯入失敗 (HTTP ${res.status})`)
      setUndefVals([])
      // 分開匯入(merge):回應只含本次 section → 重載完整 instance 顯總量;整份匯入直接用回應
      if (data.merged) {
        const full = await api.get<any>(token, `/bom/project/${projectId}/latest-instance`).catch(() => null)
        setImportResult(full?.bomInstanceId ? full : data)
      } else { setImportResult(data) }
      // 新顏色 → 刷新下拉
      api.get<{ variants: string[] }>(token, `/bom/project/${projectId}/variants`).then((r) => setVariants(r.variants || [])).catch(() => {})
    } catch (e: any) { setErr(e.message) } finally { setImporting(false) }
  }

  async function doCompute(force = false) {
    if (!caseFactoryId || !importResult?.bomInstanceId) { setErr('需先匯入 + 本專案有成本模型(case_factory)'); return }
    setComputing(true); setErr('')
    try {
      const r = await api.post(token, '/bom/compute', { caseFactoryId, bomInstanceId: importResult.bomInstanceId, valueIds: configValueIds, ...(force ? { force: true } : {}) })
      setRunResult(r); setPendingGate(null)
    } catch (e: any) {
      // B-5a:有未詢價料件 → 409,提示可「強制試算」只算已詢價材料
      if (e instanceof ApiError && e.status === 409 && e.body?.code === 'BOM_HAS_PENDING_PRICES') {
        setPendingGate({ pendingCount: e.body.pendingCount || 0 })
      } else { setErr(e.message) }
    } finally { setComputing(false) }
  }

  // B-5b:採購 enrich(加價/選 vendor)後重抓 rollup,更新材料 + 待詢價數 + 清 gate
  async function refreshRollup() {
    if (!importResult?.bomInstanceId) return
    try {
      const q = configValueIds.length ? `?valueIds=${configValueIds.join(',')}` : ''
      const roll = await api.get(token, `/bom/instances/${importResult.bomInstanceId}/rollup${q}`)
      setImportResult((prev: any) => (prev ? { ...prev, rollup: roll } : prev))
      setPendingGate(null)
    } catch { /* noop */ }
  }

  // C-1:成本模型 Excel(下載檔案共用 helper)
  async function dlBlob(path: string, filename: string) {
    setErr('')
    try {
      const res = await fetch(`/api/projects/bom${path}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`下載失敗 (HTTP ${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) { setErr(e.message) }
  }
  async function doImportCostModel() {
    if (!cmFile) { setErr('請選成本模型 Excel'); return }
    setCmBusy(true); setErr('')
    try {
      const fd = new FormData()
      fd.append('file', cmFile); fd.append('projectId', String(projectId))
      if (cmFactory.trim()) fd.append('factoryCode', cmFactory.trim().toUpperCase())
      const res = await fetch('/api/projects/bom/cost-model/import', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `匯入失敗 (HTTP ${res.status})`)
      setCmFile(null); setCmFactory('')
      const r = await api.get<{ cases: CaseRow[] }>(token, `/bom/cases?projectId=${projectId}`)
      setCases(r.cases || [])
      if (data.caseFactoryId) setCaseFactoryId(data.caseFactoryId)
    } catch (e: any) { setErr(e.message) } finally { setCmBusy(false) }
  }
  const costModelTools = (
    <div className="flex items-center gap-2 flex-wrap text-[11px]">
      <span className="text-cortex-muted">成本模型 Excel:</span>
      <input type="file" accept=".xlsx" onChange={(e) => setCmFile(e.target.files?.[0] || null)}
        className="text-[11px] file:mr-1.5 file:px-2 file:py-0.5 file:border-0 file:rounded file:bg-white file:cursor-pointer file:text-[11px]" />
      <input value={cmFactory} onChange={(e) => setCmFactory(e.target.value)} placeholder="廠別碼(空=用檔內)" className="border border-cortex-line rounded px-1.5 py-0.5 text-[11px] w-32" />
      <button onClick={doImportCostModel} disabled={cmBusy || !cmFile}
        className="flex items-center gap-1 px-2 py-0.5 bg-cortex-teal text-white rounded hover:opacity-90 disabled:opacity-40">
        {cmBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} 匯入模型
      </button>
      <span className="text-cortex-muted">·</span>
      <button onClick={() => dlBlob('/cost-model/template?model=SIMPLIFIED_WEARABLE', 'cost-model-template-SIMPLIFIED.xlsx')} className="text-cortex-teal hover:underline">範本(穿戴 SIMPLIFIED)</button>
      <button onClick={() => dlBlob('/cost-model/template?model=FULL_MVA', 'cost-model-template-FULL.xlsx')} className="text-cortex-teal hover:underline">範本(FULL)</button>
      {activeFactory && (
        <>
          <span className="text-cortex-muted">·</span>
          <button onClick={() => dlBlob(`/case/${activeFactory.case_factory_id}/cost-model`, `cost-model-${activeFactory.factory_code}.xlsx`)} className="text-cortex-teal hover:underline">
            匯出 {activeFactory.factory_code} 模型
          </button>
        </>
      )}
    </div>
  )

  // §9.4:此專案無 case_factory 時,從範本 clone 建立成本模型(製程/設備/人力/廠房)
  async function doProvision() {
    if (!tplId) { setErr('請選擇成本模型範本'); return }
    setProvisioning(true); setErr('')
    try {
      await api.post(token, '/bom/provision-case', { projectId, sourceCaseFactoryId: tplId })
      const r = await api.get<{ cases: CaseRow[] }>(token, `/bom/cases?projectId=${projectId}`)
      setCases(r.cases || [])
      if (r.cases?.length) setCaseFactoryId(r.cases[0].case_factory_id)
    } catch (e: any) { setErr(e.message) } finally { setProvisioning(false) }
  }

  const money = (v: any) => (typeof v === 'number' ? `$${v.toFixed(4)}` : '—')
  const pctFmt = (v: any) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—')

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

      {/* §9.4 無 case_factory → 從範本建立成本模型 */}
      {!hasCase && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
          <div className="text-[12px] font-semibold text-amber-800 flex items-center gap-1.5"><Settings className="w-4 h-4" /> 此專案尚未設定成本模型</div>
          <div className="text-[11px] text-amber-700">選一個廠別範本建立成本模型(製程/設備/人力/廠房),之後可依產品調整。建立後才能算成本;未建立仍可先匯入材料看 rollup。</div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={tplId} onChange={(e) => setTplId(e.target.value ? Number(e.target.value) : '')} className="border border-cortex-line rounded px-2 py-1 text-[12px]">
              <option value="">選擇範本…</option>
              {templates.map((t) => <option key={t.caseFactoryId} value={t.caseFactoryId}>{t.factoryCode} · {t.costingModel} ({t.projectCode})</option>)}
            </select>
            <button onClick={doProvision} disabled={provisioning || !tplId}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-[12px] rounded hover:opacity-90 disabled:opacity-40 shrink-0">
              {provisioning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Settings className="w-3.5 h-3.5" />} 建立成本模型
            </button>
          </div>
          <div className="pt-1 border-t border-amber-200">{costModelTools}</div>
        </div>
      )}

      {/* A: 頂部試算廠別切換器 — 結構/材料全廠共用,廠別只換加工成本模型(人力/設備/OH) */}
      {hasCase && (
        <div className="flex items-center gap-2 flex-wrap bg-cortex-navy/5 border border-cortex-navy/20 rounded-lg p-2.5">
          <span className="text-[12px] font-semibold text-cortex-ink flex items-center gap-1.5"><Factory className="w-4 h-4 text-cortex-navy" /> 試算廠別</span>
          <select value={caseFactoryId} onChange={(e) => setCaseFactoryId(e.target.value ? Number(e.target.value) : '')}
            className="border border-cortex-line rounded px-2 py-1 text-[12px] font-medium">
            {cases.map((c) => <option key={c.case_factory_id} value={c.case_factory_id}>{c.factory_code} · {c.costing_model}</option>)}
          </select>
          <span className="text-[10px] text-cortex-muted flex-1 min-w-[200px]">
            料表結構 / 材料 rollup <b className="text-cortex-ink">全廠共用</b>;切廠別 → 換加工成本模型(人力 / 設備 / OH / SGA),按下方「算成本」重算此廠 total。
          </span>
        </div>
      )}

      {/* B-3a: 變異軸設定(折疊)· 先定義顏色/包裝值,import 才放行 */}
      <div className={`border rounded-lg ${undefVals.length ? 'border-red-300 bg-red-50/40' : 'border-cortex-line bg-cortex-bg/40'}`}>
        <button onClick={() => setShowSetup((s) => !s)} className="w-full flex items-center justify-between px-3 py-2 text-[12px] font-semibold text-cortex-ink">
          <span className="flex items-center gap-1.5">
            <Settings className="w-4 h-4" /> 變異軸設定
            {dimensions.length > 0 && <span className="text-cortex-muted font-normal">({dimensions.map((d) => d.dimName || d.dimCode).join(' / ')})</span>}
            {undefVals.length > 0 && <span className="text-[10px] text-red-600 font-normal">· 需補 {undefVals.length} 值</span>}
          </span>
          {showSetup ? <ChevronUp className="w-4 h-4 text-cortex-muted" /> : <ChevronDown className="w-4 h-4 text-cortex-muted" />}
        </button>
        {showSetup && <div className="px-3 pb-3 border-t border-cortex-line pt-2"><BomVariantSetup projectId={projectId} onChanged={() => { reloadDimensions(); setUndefVals([]) }} /></div>}
      </div>

      {/* B-2: 產品配置(結構變異維度 · 顏色/包裝)· 切配置 → rollup/算成本用 resolve 後的料 */}
      {dimensions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap bg-cortex-cyan-bg/40 border border-cortex-teal/30 rounded-lg p-2.5">
          <span className="text-[12px] font-semibold text-cortex-ink flex items-center gap-1.5"><Layers className="w-4 h-4 text-cortex-teal" /> 產品配置</span>
          {dimensions.map((d) => (
            <label key={d.id} className="text-[11px] text-cortex-muted flex items-center gap-1">
              {d.dimName || d.dimCode}
              <select value={config[d.dimCode] || ''} onChange={(e) => setConfig({ ...config, [d.dimCode]: Number(e.target.value) })}
                className="border border-cortex-line rounded px-2 py-1 text-[12px] font-medium text-cortex-ink">
                {d.values.map((v: any) => <option key={v.id} value={v.id}>{v.valueName || v.valueCode}</option>)}
              </select>
            </label>
          ))}
          <span className="text-[10px] text-cortex-muted flex-1 min-w-[180px]">同一份 super-BOM;切配置 → 共用料(EE)不變、變異料(ME/PKG)換該配置 → rollup / 算成本用此配置</span>
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
          <select value={profileCode} onChange={(e) => setProfileCode(e.target.value)} title="一般使用統一格式;「進階轉檔」= 原始廠商 Excel 對映(power-user)"
            className="border border-cortex-line rounded px-2 py-1 text-[12px]">
            {profiles.map((p) => <option key={p.profile_code} value={p.profile_code}>{(p.source_kind === 'MAPPED' ? '進階轉檔 · ' : '') + (p.name || p.profile_code)}</option>)}
          </select>
          {/* 顏色/variant 下拉(正式化 · 結構層維度 · 空=共用)· 不硬編顏色,選項來自此專案已存在的 */}
          <select value={customVariant ? '__custom__' : variantKey}
            onChange={(e) => {
              if (e.target.value === '__custom__') { setCustomVariant(true); setVariantKey('') }
              else { setCustomVariant(false); setVariantKey(e.target.value) }
            }}
            title="顏色/variant — 不同顏色=不同結構(cosmetic 件 PN 不同)" className="border border-cortex-line rounded px-2 py-1 text-[12px]">
            <option value="">顏色/variant:共用</option>
            {variants.map((v) => <option key={v} value={v}>{v}</option>)}
            <option value="__custom__">＋ 自訂顏色…</option>
          </select>
          {customVariant && (
            <input value={variantKey} onChange={(e) => setVariantKey(e.target.value)} placeholder="輸入顏色(如 Black)" autoFocus
              className="border border-cortex-line rounded px-2 py-1 text-[12px] w-36" />
          )}
          <label className="flex items-center gap-1 text-[11px] text-cortex-muted cursor-pointer" title="勾選=併入現有 BOM(只覆蓋此檔涵蓋的變異範圍,不動 EE/其他顏色包裝)· 不勾=整份取代">
            <input type="checkbox" checked={mergeMode} onChange={(e) => setMergeMode(e.target.checked)} /> 分開匯入(併入)
          </label>
          <button onClick={doImport} disabled={importing || !file}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cortex-teal text-white text-[12px] rounded hover:opacity-90 disabled:opacity-40 shrink-0">
            {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} {mergeMode ? '併入匯入' : '匯入'}
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

          {/* B-5b 採購 enrich:料件明細(R-3 樹狀 · 跟產品配置連動 resolve) */}
          <BomItemsPanel bomInstanceId={importResult.bomInstanceId} configValueIds={configValueIds} onChanged={refreshRollup} />

          {/* ④ 算成本 */}
          {hasCase ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => doCompute()} disabled={computing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-cortex-navy text-white text-[12px] rounded hover:opacity-90 disabled:opacity-40">
                  {computing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calculator className="w-3.5 h-3.5" />} ④ 算成本{activeFactory ? ` · ${activeFactory.factory_code}` : ''}
                </button>
                {cases.length > 1 && <span className="text-[10px] text-cortex-muted">廠別在上方「試算廠別」切換</span>}
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
                ['材料 (對客報價)', runResult.costBreakdown?.material],
                ['MVA', runResult.costBreakdown?.mva],
                ['SG&A', runResult.costBreakdown?.sga],
                ['Profit', runResult.costBreakdown?.profit],
              ].map(([k, v]) => (
                <tr key={k as string} className="border-b border-cortex-line/50">
                  <td className="py-1 text-cortex-muted">{k as string}</td><td className="py-1 text-right font-mono">{money(v)}</td>
                </tr>
              ))}
              {runResult.costBreakdown?.nreAmort > 0 && (
                <tr className="border-b border-cortex-line/50 text-amber-700">
                  <td className="py-1">NRE 攤提 (AMORTIZED)</td><td className="py-1 text-right font-mono">+{money(runResult.costBreakdown?.nreAmort)}</td>
                </tr>
              )}
              <tr className="font-bold text-cortex-ink border-b border-cortex-line">
                <td className="py-1.5">報價 Total / unit</td><td className="py-1.5 text-right font-mono">{money(runResult.costBreakdown?.total)}</td>
              </tr>
              {/* true/quote 雙軌:內部真實成本 + margin(採購 true/quote 價差) */}
              {typeof runResult.costBreakdown?.totalTrue === 'number' && (
                <>
                  <tr className="text-cortex-muted">
                    <td className="py-1">內部真實成本 (true)</td><td className="py-1 text-right font-mono">{money(runResult.costBreakdown?.totalTrue)}</td>
                  </tr>
                  <tr className="font-semibold text-cortex-teal">
                    <td className="py-1">Margin (報價 − 真實)</td>
                    <td className="py-1 text-right font-mono">{money(runResult.costBreakdown?.marginUsd)} · {pctFmt(runResult.costBreakdown?.marginPct)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* FM 多廠成本比較(≥2 廠才顯)+ 新增廠別 */}
      {hasCase && (
        <div className="space-y-2">
          <BomFactoryCompare projectId={projectId} bomInstanceId={importResult?.bomInstanceId} factoryCount={cases.length} />
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <span className="text-cortex-muted">已設廠別:{cases.map((c) => c.factory_code).join(' / ') || '—'}</span>
            <span className="text-cortex-muted">·</span>
            <select value={tplId} onChange={(e) => setTplId(e.target.value ? Number(e.target.value) : '')} className="border border-cortex-line rounded px-1.5 py-0.5 text-[11px]">
              <option value="">＋新增廠別範本…</option>
              {templates.map((t) => <option key={t.caseFactoryId} value={t.caseFactoryId}>{t.factoryCode} · {t.costingModel}</option>)}
            </select>
            <button onClick={doProvision} disabled={provisioning || !tplId} className="px-2 py-0.5 border border-cortex-line rounded hover:bg-cortex-bg disabled:opacity-40">
              {provisioning ? '建立中…' : '建立'}
            </button>
          </div>
          {costModelTools}
        </div>
      )}
    </div>
  )
}
