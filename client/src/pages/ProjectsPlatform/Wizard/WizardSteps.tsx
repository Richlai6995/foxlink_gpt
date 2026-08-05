/**
 * Wizard 7 Steps — 對齊 docs/Cortex_互動Demo.html renderWizardStep1-7
 *
 * Sprint B:UI 完整,AI 部分用 mock(對齊 demo 顯示 92% 信心度等)
 *           Sprint F 再接 real Gemini Flash
 */

import { useEffect, Fragment, useRef, useState } from 'react'
import { Upload, CheckCircle2, AlertTriangle, Sparkles, MessageSquare, ListChecks, Bell, Pin, Clock, Loader2, FileText } from 'lucide-react'
import type { WizardData } from './wizardState'
import { useAuth } from '../../../context/AuthContext'

type StepProps = {
  data: WizardData
  onChange: (patch: Partial<WizardData>) => void
}

// ────────────────────────────────────────────────────────────
// Step 1 — 客戶來信 / RFQ 解析
// ────────────────────────────────────────────────────────────
export function Step1Intake({ data, onChange }: StepProps) {
  const { token } = useAuth() as any
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const tplRef = useRef<HTMLInputElement>(null)
  // 2026-08 改版:客戶選單(帶入歷史 8 欄)+ 重複開案偵測 + 專案代碼唯一檢查
  const [custList, setCustList] = useState<any[]>([])
  const [similar, setSimilar] = useState<any[]>([])
  const [codeExists, setCodeExists] = useState(false)
  useEffect(() => {
    if (!token) return
    fetch('/api/projects/wizard/customers', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json()).then((d) => setCustList(d.customers || [])).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])
  const precheck = async (partNo?: string, code?: string) => {
    const q = new URLSearchParams()
    if (partNo) q.set('partNo', partNo)
    if (code) q.set('code', code)
    if (![...q.keys()].length) return
    try {
      const r = await fetch(`/api/projects/wizard/precheck?${q}`, { headers: { Authorization: `Bearer ${token}` } }).then((x) => x.json())
      if (partNo) setSimilar(r.similar || [])
      if (code) setCodeExists(!!r.codeExists)
    } catch { /* noop */ }
  }
  const pickCustomer = (name: string) => {
    const c = custList.find((x) => x.name === name)
    if (!c) { onChange({ customer: name } as any); return }
    onChange({
      customer: c.name, custAlias: c.custAlias || '', taxId: c.taxId || '',
      paymentTerms: c.paymentTerms || '', shipAddress: c.shipAddress || '', contactName: c.contactName || '',
      recommendedPmName: c.lastPmName || '', recommendedPmUserId: c.lastPmUserId || null,
    } as any)
  }
  const handleTemplate = async (file: File) => {
    setUploadErr(null); setUploading(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch('/api/projects/wizard/parse-intake', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      const f = j.fields || {}
      onChange({
        ...(f.customer ? { customer: f.customer } : {}), ...(f.custAlias ? { custAlias: f.custAlias } : {}),
        ...(f.projectCode ? { generatedProjectCode: f.projectCode } : {}),
        ...(f.partNo ? { partNo: f.partNo } : {}), ...(f.quantity ? { quantity: f.quantity } : {}),
        ...(f.dueDate ? { dueDate: f.dueDate } : {}), ...(f.kickoffNote ? { kickoffNote: f.kickoffNote } : {}),
        ...(f.taxId ? { taxId: f.taxId } : {}), ...(f.paymentTerms ? { paymentTerms: f.paymentTerms } : {}),
        ...(f.shipAddress ? { shipAddress: f.shipAddress } : {}), ...(f.contactName ? { contactName: f.contactName } : {}),
      } as any)
      if (f.partNo) precheck(f.partNo)
      if (f.projectCode) precheck(undefined, f.projectCode)
    } catch (e: any) { setUploadErr(e.message || String(e)) } finally { setUploading(false) }
  }
  const dlTemplate = async () => {
    const res = await fetch('/api/projects/wizard/intake-template', { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) { setUploadErr('範本下載失敗'); return }
    const blob = await res.blob(); const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = '開案資料範本.xlsx'; a.click(); URL.revokeObjectURL(url)
  }

  // 是否已抽過(client 端判斷:看是否有 confidence 物件)
  const hasExtracted = !!data.rfqConfidence

  const fields: { key: keyof WizardData; cfKey: keyof NonNullable<WizardData['rfqConfidence']>; label: string }[] = [
    { key: 'customer',  cfKey: 'customer', label: '客戶名' },
    { key: 'partNo',    cfKey: 'part_no',  label: '料號' },
    { key: 'quantity',  cfKey: 'quantity', label: '數量' },
    { key: 'dueDate',   cfKey: 'due_date', label: '交期' },
  ]

  const handleFile = async (file: File) => {
    if (!file) return
    setUploadErr(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/projects/wizard/extract-rfq', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'X-Demo-Role': 'HOST' },
        body: fd,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)

      const ex = json.extracted || {}
      onChange({
        rfqFileName: json.original_name || file.name,
        rfqFilePath: json.file_path,
        rfqMimeType: json.mime_type,
        customer:    ex.customer  || '',
        partNo:      ex.part_no   || '',
        quantity:    ex.quantity != null ? String(ex.quantity) : '',
        dueDate:     ex.due_date  || '',
        specs:       ex.specs || '',
        notes:       ex.notes || '',
        rfqConfidence: ex.confidence || {},
        rfqMissing:    ex.missing || [],
        rfqWarnings:   ex.warnings || [],
        rfqIsStub:     !!ex._stub,
      } as Partial<WizardData>)
    } catch (e: any) {
      setUploadErr(e.message || String(e))
    } finally {
      setUploading(false)
    }
  }

  const overall = data.rfqConfidence?.overall ?? 0
  const overallColor =
    overall >= 80 ? 'text-cortex-green' :
    overall >= 60 ? 'text-amber-300'    :
                    'text-red-300'

  return (
    <div className="grid grid-cols-[1.5fr_1fr] gap-5">
      <div>
        <StepBadge>STEP 1 / 6</StepBadge>
        <h3 className="text-lg font-bold text-cortex-navy mb-1">客戶信息</h3>
        <p className="text-[11px] text-cortex-muted mb-3">三種來源:手填 / 客戶 RFQ AI 解析 / 標準範本 Excel(最可靠)· 全欄可修改</p>
        <div className="flex items-center gap-2 mb-2 text-[11px]">
          <button onClick={dlTemplate} className="px-2 py-1 border border-cortex-teal text-cortex-teal rounded hover:bg-cortex-cyan-bg">📥 下載開案資料範本</button>
          <button onClick={() => tplRef.current?.click()} className="px-2 py-1 border border-cortex-teal text-cortex-teal rounded hover:bg-cortex-cyan-bg">📤 上傳填好的範本</button>
          <input ref={tplRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleTemplate(f); e.target.value = '' }} />
          <span className="text-[10px] text-cortex-muted">或下方拖入客戶 RFQ 由 AI 解析</span>
        </div>

        {/* Drag-drop area — 真檔案上傳 */}
        <div
          className={`border-2 border-dashed rounded-[10px] p-5 text-center mb-4 transition cursor-pointer ${
            uploading ? 'border-cortex-amber bg-cortex-amber-bg/30' :
            hasExtracted ? 'border-cortex-green bg-cortex-green-bg/30' :
            'border-cortex-cyan bg-gradient-to-b from-cortex-cyan-bg to-white hover:from-cortex-cyan/20'
          }`}
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault() }}
          onDrop={(e) => {
            e.preventDefault()
            if (uploading) return
            const f = e.dataTransfer.files?.[0]
            if (f) handleFile(f)
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,image/*,.eml"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />

          {uploading ? (
            <>
              <Loader2 size={28} className="mx-auto text-cortex-amber animate-spin mb-2" />
              <div className="text-[13px] text-cortex-ink font-semibold">解析中…</div>
              <div className="text-[10px] text-cortex-muted mt-1">Gemini Vision · 約 5-30 秒</div>
            </>
          ) : hasExtracted ? (
            <>
              <FileText size={28} className="mx-auto text-cortex-green mb-2" />
              <div className="text-[13px] text-cortex-ink font-semibold">{data.rfqFileName}</div>
              <div className="text-[11px] text-cortex-green font-bold mt-1">
                <CheckCircle2 size={11} className="inline -mt-px mr-0.5" />
                AI 解析完成 · 整體信心 {overall}%
                {data.rfqIsStub && <span className="ml-2 text-amber-700 bg-cortex-amber-bg px-1.5 py-0.5 rounded text-[9px]">stub mock</span>}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}
                className="text-[10px] text-cortex-ocean hover:underline mt-1.5"
              >重新上傳</button>
            </>
          ) : (
            <>
              <Upload size={28} className="mx-auto text-cortex-cyan mb-2" />
              <div className="text-[13px] text-cortex-ink font-semibold">拖檔到此處或點擊選擇</div>
              <div className="text-[11px] text-cortex-muted mt-1">PDF / 圖檔 / .eml · ≤ 25 MB</div>
            </>
          )}

          {uploadErr && (
            <div className="text-[11px] text-red-600 bg-cortex-red-bg/40 mt-2 px-2 py-1.5 rounded">
              <AlertTriangle size={10} className="inline -mt-px mr-1" />
              {uploadErr}
            </div>
          )}
        </div>

        {/* 客戶信息欄位(手填 / AI 預填 / 範本帶入) */}
        <div className="bg-white border border-cortex-line rounded-lg p-3.5">
          <div className="text-[11px] text-cortex-muted font-bold tracking-widest mb-2.5">
            客戶信息 · AI / 範本預填後 confirm 即可
          </div>
          {/* 客戶選單:老客戶帶入 8 欄 */}
          <div className="flex items-center gap-2.5 mb-2 text-[12px]">
            <div className="w-14 text-cortex-muted text-[11px]">老客戶</div>
            <select value="" onChange={(e) => { if (e.target.value) pickCustomer(e.target.value) }}
              className="flex-1 px-2 py-1 border border-cortex-line rounded text-[12px] bg-white text-cortex-ink">
              <option value="">(選擇歷史客戶自動帶入資料,或直接下方手填)</option>
              {custList.map((c) => <option key={c.name} value={c.name}>{c.name}{c.custAlias ? ` · ${c.custAlias}` : ''}(上次 {c.lastProject})</option>)}
            </select>
          </div>
          {/* 客戶代碼 + 專案代碼 */}
          <div className="flex items-center gap-2.5 mb-2 text-[12px]">
            <div className="w-14 text-cortex-muted text-[11px]">客戶代碼</div>
            <input value={data.custAlias || ''} onChange={(e) => onChange({ custAlias: e.target.value } as any)} placeholder="內部代碼 / 機密別名(如 A001-SS)"
              className="flex-1 px-2 py-1 border border-cortex-line rounded text-[12px] font-mono bg-white text-cortex-ink focus:outline-none focus:border-cortex-cyan" />
          </div>
          <div className="flex items-center gap-2.5 mb-2 text-[12px]">
            <div className="w-14 text-cortex-muted text-[11px]">專案代碼</div>
            <input value={data.generatedProjectCode || ''} onChange={(e) => onChange({ generatedProjectCode: e.target.value } as any)}
              onBlur={(e) => precheck(undefined, e.target.value)}
              className={`flex-1 px-2 py-1 border rounded text-[12px] font-mono bg-white text-cortex-ink focus:outline-none ${codeExists ? 'border-red-400' : 'border-cortex-line focus:border-cortex-cyan'}`} />
            {codeExists && <span className="text-[9px] text-red-600 font-bold">已存在!</span>}
          </div>
          {fields.map((f) => {
            const conf = data.rfqConfidence?.[f.cfKey] ?? 0
            const confColor = conf >= 80 ? 'text-cortex-green bg-cortex-green-bg' :
                              conf >= 60 ? 'text-amber-700 bg-cortex-amber-bg'   :
                              conf > 0   ? 'text-red-700 bg-cortex-red-bg/50'     :
                                           'text-cortex-muted bg-cortex-line-2'
            return (
              <div key={f.key} className="flex items-center gap-2.5 mb-2 text-[12px]">
                <div className="w-14 text-cortex-muted text-[11px]">{f.label}</div>
                <input
                  type="text"
                  value={(data as any)[f.key] ?? ''}
                  onChange={(e) => onChange({ [f.key]: e.target.value } as any)}
                  onBlur={(e) => { if (f.key === 'partNo') precheck(e.target.value) }}
                  className="flex-1 px-2 py-1 border border-cortex-line rounded text-[12px] font-mono bg-white text-cortex-ink focus:outline-none focus:border-cortex-cyan"
                  placeholder={!hasExtracted ? '—' : ''}
                />
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${confColor}`}>
                  {conf > 0 ? `${conf}%` : '—'}
                </span>
              </div>
            )
          })}

          {/* 交期合理性紅綠燈(真資料:同客戶案 開案→送審 平均天數) */}
          {(() => {
            const c = custList.find((x) => x.name === data.customer)
            if (!c?.avgCycleDays || !data.dueDate) return null
            const sanity = computeScheduleSanity(_daysBetween(data.dueDate), c.avgCycleDays)
            const cls = sanity.light === 'green' ? 'bg-green-50 border-green-300 text-green-800' :
                        sanity.light === 'amber' ? 'bg-amber-50 border-amber-300 text-amber-800' :
                                                   'bg-red-50 border-red-300 text-red-700'
            return (
              <div className={`border rounded p-2 mb-2 text-[11px] ${cls}`}>
                {sanity.light === 'green' ? '🟢' : sanity.light === 'amber' ? '🟡' : '🔴'} 交期合理性:{sanity.message}
                <span className="block text-[9px] opacity-70">歷史平均 = {c.name} 過往 {c.projectCount} 案(開案→送審)實算</span>
              </div>
            )
          })()}
          {/* 重複開案偵測 */}
          {similar.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded p-2 mb-2 text-[11px] text-amber-800">
              ⚠ 同料號已有 {similar.length} 個專案:
              {similar.map((sp) => (
                <a key={sp.id} href={`/projects-platform/projects/${sp.id}`} target="_blank" rel="noreferrer" className="ml-1 underline font-mono">{sp.projectCode}</a>
              ))}
              <span className="block text-[10px] mt-0.5">確認是否重複開案;新一代/改版案可繼續。</span>
            </div>
          )}
          {/* 開案說明(常駐) */}
          <div className="text-[10px] text-cortex-muted mt-3 mb-1">🗒 開案說明</div>
          <textarea
            value={data.kickoffNote || ''}
            onChange={(e) => onChange({ kickoffNote: e.target.value } as any)}
            className="w-full px-2 py-1.5 border border-cortex-line rounded text-[11px] bg-white text-cortex-ink focus:outline-none focus:border-cortex-cyan resize-y"
            rows={2}
            placeholder="開案緣由 / 特殊需求 / 背景(會寫入專案與知識庫)"
          />
          {/* 規格 / 備註(較長) */}
          {hasExtracted && (
            <>
              <div className="text-[10px] text-cortex-muted mt-3 mb-1">📏 規格摘要</div>
              <textarea
                value={data.specs || ''}
                onChange={(e) => onChange({ specs: e.target.value })}
                className="w-full px-2 py-1.5 border border-cortex-line rounded text-[11px] font-mono bg-white text-cortex-ink focus:outline-none focus:border-cortex-cyan resize-y"
                rows={2}
                placeholder="—"
              />
              <div className="text-[10px] text-cortex-muted mt-2 mb-1">📝 備註</div>
              <textarea
                value={data.notes || ''}
                onChange={(e) => onChange({ notes: e.target.value })}
                className="w-full px-2 py-1.5 border border-cortex-line rounded text-[11px] font-mono bg-white text-cortex-ink focus:outline-none focus:border-cortex-cyan resize-y"
                rows={2}
                placeholder="—"
              />
            </>
          )}
        </div>
      </div>

      {/* AI panel — navy gradient(真資料 driven) */}
      <div className="bg-gradient-to-b from-cortex-navy to-cortex-teal rounded-[10px] p-4 text-white">
        <div className="flex items-center gap-1.5 mb-2.5">
          <span className="text-lg">🤖</span>
          <span className="text-[13px] font-bold text-cortex-cyan tracking-wide">AI 助手 · #1 RFQ 解析</span>
        </div>

        {!hasExtracted ? (
          <div className="text-[11px] text-cortex-cyan-bg leading-relaxed">
            上傳客戶 RFQ(PDF / 圖 / email)→ Gemini Vision 自動抽 customer / part_no / quantity / due_date / specs / notes 6 項<br /><br />
            <span className="text-cortex-amber italic">業務原本 30 分鐘讀完手填,現在 5-30 秒解析完</span>
          </div>
        ) : (
          <>
            <div className="text-[11px] text-cortex-cyan-bg leading-relaxed mb-3.5">
              {data.rfqIsStub
                ? <>📌 LLM 不可用 · 顯示 stub mock<br />(設 <code className="bg-black/30 px-1 rounded">PROJECTS_PLATFORM_USE_LLM=true</code> 後跑真 Gemini)</>
                : <>已掃 RFQ · 抽出 6 欄位<br />整體信心度 <strong className={overallColor}>{overall}%</strong></>}
            </div>

            {(data.rfqWarnings?.length || 0) > 0 && (
              <div className="border-t border-white/15 pt-3">
                <div className="text-[10px] font-bold text-cortex-amber mb-1.5 inline-flex items-center gap-0.5">
                  <AlertTriangle size={10} /> 警示({data.rfqWarnings!.length} 處)
                </div>
                <ul className="text-[10px] text-cortex-cyan-bg leading-relaxed space-y-0.5">
                  {data.rfqWarnings!.map((w, i) => <li key={i}>• {w}</li>)}
                </ul>
                <div className="text-[9px] text-amber-300 mt-2 italic">→ 系統將列入 Step 2 Q&amp;A 草稿</div>
              </div>
            )}

            {(data.rfqMissing?.length || 0) > 0 && (
              <div className="border-t border-white/15 pt-3 mt-3">
                <div className="text-[10px] font-bold text-red-300 mb-1.5">未找到的欄位</div>
                <div className="text-[10px] text-cortex-cyan-bg/80">
                  {data.rfqMissing!.join(' · ')}
                </div>
              </div>
            )}

            <div className="mt-3.5 pt-3 border-t border-white/15 text-[9px] text-slate-400 italic leading-relaxed">
              {data.rfqIsStub ? 'stub mock 模式' : 'Gemini Vision · 自動 fallback stub'}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Step 2 — 歷史參考(2026-08-05 廢除:假資料;真價值遷 Step1 交期紅綠燈 / Step4 PM 推薦 · 保留程式碼供參)
// ────────────────────────────────────────────────────────────
const MOCK_HISTORY = [
  { id: 'QT-2025-0212', cust: 'Apple', similar: 95, result: 'WIN',  margin: 'Tier-M', plant: '越南', cycle: 18, pm: 'Mike Wang' },
  { id: 'QT-2025-0087', cust: 'Apple', similar: 88, result: 'WIN',  margin: 'Tier-L', plant: '中國', cycle: 21, pm: 'Mike Wang' },
  { id: 'QT-2025-0156', cust: 'Sony',  similar: 78, result: 'LOSS', reason: '報價偏高 12%' },
  { id: 'QT-2024-0922', cust: 'Apple', similar: 72, result: 'WIN',  margin: 'Tier-M', plant: '越南', cycle: 25, pm: 'John Lin' },
  { id: 'QT-2024-0741', cust: 'Apple', similar: 68, result: 'WIN',  margin: 'Tier-H', plant: '中國', cycle: 19, pm: 'Mike Wang' },
]

/**
 * AI #32 交期合理性 — 規則式
 * 客戶要的天數 vs 歷史平均週期(目前在 data.estimatedCycleDays)
 *   ≥ 1.5x → green
 *   1.0~1.5x → amber
 *   < 1.0x → red
 */
function computeScheduleSanity(customerDueDays: number, estimatedCycleDays: number): {
  light: 'green' | 'amber' | 'red'
  ratio: number
  message: string
} {
  if (!customerDueDays || !estimatedCycleDays) {
    return { light: 'amber', ratio: 1, message: '資料不足無法判斷' }
  }
  const ratio = customerDueDays / estimatedCycleDays
  if (ratio >= 1.5) return { light: 'green', ratio, message: `客戶要 ${customerDueDays} 天 · 歷史平均 ${estimatedCycleDays} 天 · 寬鬆 ${(ratio * 100).toFixed(0)}%` }
  if (ratio >= 1.0) return { light: 'amber', ratio, message: `客戶要 ${customerDueDays} 天 · 歷史平均 ${estimatedCycleDays} 天 · 剛好 (${(ratio * 100).toFixed(0)}%)` }
  return { light: 'red', ratio, message: `⚠ 客戶要 ${customerDueDays} 天 · 歷史平均 ${estimatedCycleDays} 天 · 不可行 (${(ratio * 100).toFixed(0)}%)` }
}

function _daysBetween(dateStr: string): number {
  if (!dateStr) return 0
  const due = new Date(dateStr).getTime()
  const now = Date.now()
  return Math.max(0, Math.floor((due - now) / 86400000))
}

export function Step2History({ data, onChange }: StepProps) {
  // AI #32 真算 — 用 dueDate 跟 estimatedCycleDays
  const customerDueDays = _daysBetween(data.dueDate)
  const sanity = computeScheduleSanity(customerDueDays, data.estimatedCycleDays)
  return (
    <div className="grid grid-cols-[1.6fr_1fr] gap-5">
      <div>
        <StepBadge>STEP 2 / 7</StepBadge>
        <h3 className="text-lg font-bold text-cortex-navy mb-3.5">歷史參考 · AI 推薦類似 5 案</h3>

        {MOCK_HISTORY.slice(0, 3).map((c) => {
          const isLoss = c.result === 'LOSS'
          const selected = data.selectedHistoryId === c.id
          return (
            <button
              key={c.id}
              onClick={() => onChange({ selectedHistoryId: c.id, recommendedPmName: c.pm || data.recommendedPmName })}
              className={`w-full text-left bg-white border rounded-lg px-3.5 py-3 mb-2.5 transition ${
                selected
                  ? 'border-cortex-cyan ring-2 ring-cortex-cyan/20 bg-cortex-cyan-bg/30'
                  : isLoss
                  ? 'border-red-200 hover:border-red-300'
                  : 'border-cortex-line hover:border-cortex-cyan/50'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-bold text-cortex-ocean">{c.id}</span>
                  <span className="text-[11px] text-cortex-text">{c.cust}</span>
                  {!isLoss && (
                    <span className="text-[9px] bg-cortex-green-bg text-green-800 px-1.5 py-0.5 rounded font-bold">WIN</span>
                  )}
                  {isLoss && (
                    <span className="text-[9px] bg-cortex-red-bg text-red-800 px-1.5 py-0.5 rounded font-bold">LOSS</span>
                  )}
                </div>
                <span className="text-[10px] font-bold text-cortex-teal">相似度 {c.similar}%</span>
              </div>
              <div className="text-[11px] text-cortex-text leading-relaxed">
                {isLoss
                  ? `原因:${(c as any).reason}`
                  : <>毛利 <strong>{c.margin}</strong> · 廠區 <strong>{c.plant}</strong> · 週期 <strong>{c.cycle} 天</strong> · PM <strong>{c.pm}</strong></>
                }
              </div>
            </button>
          )
        })}
        <div className="text-[10px] text-cortex-muted text-center mt-1.5">+ 還有 2 案(展開查看)</div>
      </div>

      {/* AI panel */}
      <div className="bg-white border border-cortex-line rounded-[10px] p-3.5">
        <div className="text-[11px] text-cortex-cyan font-bold tracking-wide mb-2.5">
          <Sparkles size={11} className="inline -mt-px mr-1" /> AI 觀察
        </div>

        <div className="bg-cortex-cyan-bg border-l-[3px] border-cortex-cyan p-2.5 rounded mb-3">
          <div className="text-[10px] font-bold text-cortex-teal mb-1">推薦主 PM (DPM)</div>
          <div className="text-[13px] font-bold text-cortex-navy">{data.recommendedPmName || 'Mike Wang'}</div>
          <div className="text-[10px] text-cortex-text mt-0.5">處理過 3 個 Apple USB-C 案</div>
        </div>

        <div className="bg-cortex-ocean-bg border-l-[3px] border-cortex-ocean p-2.5 rounded mb-3">
          <div className="text-[10px] font-bold text-cortex-ocean mb-1">推薦 Workflow</div>
          <div className="text-[12px] font-bold text-cortex-navy font-mono">{data.workflowTemplateCode}</div>
          <div className="text-[10px] text-cortex-text mt-0.5">8 stages,對齊 OIBG flow</div>
        </div>

        <div className="bg-cortex-bg p-2.5 rounded mb-3">
          <div className="text-[10px] font-bold text-cortex-muted mb-1">預估完成週期</div>
          <div className="text-[18px] font-extrabold text-cortex-ink font-mono">{data.estimatedCycleDays} 天</div>
        </div>

        <div
          className={`border-l-[3px] p-2.5 rounded ${
            sanity.light === 'green' ? 'bg-cortex-green-bg border-cortex-green'
            : sanity.light === 'amber' ? 'bg-cortex-amber-bg border-cortex-amber'
            : 'bg-cortex-red-bg border-cortex-red'
          }`}
        >
          <div className={`text-[10px] font-bold mb-0.5 ${
            sanity.light === 'green' ? 'text-green-800'
            : sanity.light === 'amber' ? 'text-amber-800'
            : 'text-red-800'
          }`}>
            🚦 #32 交期合理性
          </div>
          <div className={`text-[11px] font-bold ${
            sanity.light === 'green' ? 'text-green-800'
            : sanity.light === 'amber' ? 'text-amber-800'
            : 'text-red-800'
          }`}>
            {sanity.light === 'green' ? '✅ 綠燈' : sanity.light === 'amber' ? '⚠ 黃燈' : '🚫 紅燈'}
          </div>
          <div className="text-[10px] text-cortex-text mt-0.5 leading-relaxed">{sanity.message}</div>
        </div>

        <div className="text-[9px] text-cortex-muted italic mt-2.5 text-center">整合 #2 / #32 / #37</div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Step 3 — 機密設定
// ────────────────────────────────────────────────────────────
const CONFIDENTIAL_FIELDS_META: { key: string; label: string; defaultStrategy: 'TIER' | 'ALIAS' | 'MASK' | 'RANGE' | 'NONE'; aiReason: string }[] = [
  { key: 'amount',         label: 'amount(報價金額)',         defaultStrategy: 'TIER',  aiReason: '非成員看等級(Tier-A/M/L),不看實際金額' },
  { key: 'margin',         label: 'margin(毛利率)',           defaultStrategy: 'TIER',  aiReason: '非成員看等級(Tier-H/M/L),不看實際 %' },
  { key: 'cost_breakdown', label: 'cost_breakdown(成本明細)', defaultStrategy: 'TIER',  aiReason: '成本結構整段遮蔽(供應鏈機密常見)' },
  { key: 'customer_name',  label: 'customer_name(客戶名)',    defaultStrategy: 'ALIAS', aiReason: '非成員看代號(A001),隱藏真實客戶' },
  { key: 'quantity',       label: 'quantity(數量)',           defaultStrategy: 'RANGE', aiReason: '非成員看區間(100K~500K),不看精確量' },
  { key: 'due_date',       label: 'due_date(交期)',           defaultStrategy: 'NONE',  aiReason: '通常不遮(排程協作需要)' },
]

export function Step3Confidentiality({ data, onChange }: StepProps) {
  const toggle = (k: string, enabled: boolean) => {
    onChange({ confidentialFields: { ...data.confidentialFields, [k]: { ...data.confidentialFields[k], enabled } } })
  }
  return (
    <div>
      <StepBadge>STEP 2 / 6</StepBadge>
      <h3 className="text-lg font-bold text-cortex-navy mb-1.5">機密設定</h3>
      <div className="text-[11px] text-cortex-muted mb-3.5">一般案保持關閉直接下一步;機密案打開開關並勾選要遮罩的欄位(非成員依策略看 遮蔽/代號/區間)</div>

      {/* 機密 banner */}
      <div className="bg-gradient-to-br from-cortex-amber-bg to-amber-50 border border-amber-300 rounded-lg px-3.5 py-3 mb-3 flex items-center gap-2.5">
        <span className="text-lg">🔒</span>
        <div className="flex-1">
          <div className="text-[12px] font-bold text-amber-900">標記為機密案{data.isConfidential ? ' · 已開啟' : '(預設關閉)'}</div>
          <div className="text-[10px] text-amber-800 mt-0.5">
            {data.isConfidential
              ? `${Object.values(data.confidentialFields).filter((x: any) => x.enabled).length} 個欄位將遮罩;非成員依策略看 遮蔽 / 代號 / 區間`
              : '開啟後下方勾選的欄位對非成員遮罩;成員邀請時可個別授權'}
          </div>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={data.isConfidential}
            onChange={(e) => onChange({ isConfidential: e.target.checked })}
            className="w-9 h-5 appearance-none bg-slate-300 rounded-full relative cursor-pointer transition checked:bg-cortex-cyan
                       before:content-[''] before:absolute before:w-4 before:h-4 before:bg-white before:rounded-full before:top-0.5 before:left-0.5 before:transition
                       checked:before:translate-x-4"
          />
        </label>
      </div>

      {/* Fields table */}
      <div className="bg-white border border-cortex-line rounded-lg overflow-hidden">
        <div className="bg-cortex-bg px-3.5 py-2 grid grid-cols-[30px_2fr_1fr_2fr] gap-2.5 text-[10px] font-bold text-cortex-muted tracking-widest">
          <div></div><div>欄位</div><div>策略</div><div>遮罩效果說明</div>
        </div>
        {CONFIDENTIAL_FIELDS_META.map((f) => {
          const v = data.confidentialFields[f.key] || { enabled: false, strategy: f.defaultStrategy }
          return (
            <div key={f.key} className="px-3.5 py-2.5 grid grid-cols-[30px_2fr_1fr_2fr] gap-2.5 items-center border-t border-cortex-line text-[11px]">
              <div className="flex justify-center">
                <input
                  type="checkbox"
                  checked={v.enabled}
                  onChange={(e) => toggle(f.key, e.target.checked)}
                  className="w-4 h-4 cursor-pointer accent-cortex-cyan"
                />
              </div>
              <div className="font-mono text-cortex-ink">{f.label}</div>
              <div>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${v.enabled ? 'bg-cortex-amber-bg text-amber-900' : 'bg-cortex-bg text-cortex-muted'}`}>
                  {v.strategy}
                </span>
              </div>
              <div className="text-cortex-text text-[10px]">{f.aiReason}</div>
            </div>
          )
        })}
      </div>

      <div className="bg-cortex-cyan-bg rounded px-3 py-2 mt-3 text-[10px] text-cortex-teal">
        💡 業務可手動勾選/取消 · 邀請成員時可再個別授權(例:John 看「成本明細」但不看「金額」)
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Step 4 — PM/Team
// ────────────────────────────────────────────────────────────
const PM_ROLES = [
  { key: 'dpm' as const, sub: 'DPM', label: 'Design PM',          desc: 'Design PM(主導)· 可套用上次合作 PM' },
  { key: 'bpm' as const, sub: 'BPM', label: 'Business PM',        desc: '對客戶 / Q&A / 提交' },
  { key: 'mpm' as const, sub: 'MPM', label: 'Manufacturing PM',   desc: '工廠端 / Cleansheet' },
  { key: 'epm' as const, sub: 'EPM', label: 'NPI Engineering PM', desc: 'NPI 工程細項' },
]

// 真使用者搜尋選擇器:打字搜 users 表(姓名/工號/帳號),下拉附部門 + 在手 PM 案數
function UserPicker({ token, value, userId, onPick, placeholder }: {
  token: string
  value: string
  userId: number | null
  onPick: (p: { id: number | null; name: string }) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<any>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const search = (q: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setLoading(true)
      fetch(`/api/projects/wizard/users?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json()).then((d) => setList(d.users || [])).catch(() => {})
        .finally(() => setLoading(false))
    }, 250)
  }
  useEffect(() => {
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as any)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => { onPick({ id: null, name: e.target.value }); search(e.target.value); setOpen(true) }}
          onFocus={() => { search(value); setOpen(true) }}
          placeholder={placeholder}
          className="text-[12px] font-semibold text-cortex-ink bg-transparent focus:outline-none w-full border-b border-transparent focus:border-cortex-cyan"
        />
        {value && (
          <button onClick={() => onPick({ id: null, name: '' })} className="text-cortex-muted hover:text-red-600 text-[12px] leading-none shrink-0" title="清除">×</button>
        )}
      </div>
      {open && (
        <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-cortex-line rounded-lg shadow-lg max-h-52 overflow-auto">
          {loading && <div className="px-3 py-2 text-[10px] text-cortex-muted">搜尋中…</div>}
          {!loading && list.length === 0 && (
            <div className="px-3 py-2 text-[10px] text-cortex-muted">無符合使用者 — 輸入姓名 / 工號 / 帳號搜尋</div>
          )}
          {!loading && list.map((u) => (
            <button
              key={u.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick({ id: u.id, name: u.name }); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 hover:bg-cortex-cyan-bg flex items-center justify-between gap-2 ${u.id === userId ? 'bg-cortex-cyan-bg/60' : ''}`}
            >
              <span className="text-[11px] font-semibold text-cortex-ink truncate">{u.name}</span>
              <span className="text-[9px] text-cortex-muted whitespace-nowrap shrink-0">
                {u.deptName ? `${u.deptName} · ` : ''}{u.employeeId || u.username} · 在手 {u.activePmCount} 案
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Step4PmTeam({ data, onChange }: StepProps) {
  const { token } = useAuth() as any
  return (
    <div className="grid grid-cols-[1.4fr_1fr] gap-5">
      <div>
        <StepBadge>STEP 3 / 6</StepBadge>
        <h3 className="text-lg font-bold text-cortex-navy mb-3.5">PM / Team 指派</h3>

        {/* HOST 業務 */}
        <div className="bg-white border border-cortex-line rounded-lg p-3.5 mb-3">
          <div className="text-[11px] font-bold text-cortex-muted tracking-widest mb-2.5">業務側 HOST</div>
          <div className="flex gap-2.5 items-center bg-red-50 border-l-[3px] border-red-600 px-3 py-2 rounded mb-1.5">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-red-600 to-orange-600 text-white text-[11px] font-bold flex items-center justify-center">我</div>
            <div className="flex-1">
              <div className="text-[12px] font-bold text-cortex-ink">{data.salesName || '(當前登入者)'}</div>
              <div className="text-[10px] text-cortex-muted">project.sales · HOST = 開案人本人(自動帶入)</div>
            </div>
            <span className="text-[9px] bg-red-600 text-white px-1.5 py-0.5 rounded">業務(主)</span>
          </div>
          <div className="flex gap-2.5 items-center bg-orange-50 border-l-[3px] border-orange-500 px-3 py-2 rounded">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-500 to-orange-400 text-white text-[11px] font-bold flex items-center justify-center">助</div>
            <div className="flex-1">
              <UserPicker
                token={token}
                value={data.salesAssistantName}
                userId={data.salesAssistantUserId}
                placeholder="業務助理(選填 · 搜尋姓名/工號)"
                onPick={(p) => onChange({ salesAssistantName: p.name, salesAssistantUserId: p.id })}
              />
              <div className="text-[10px] text-cortex-muted">業務不在線時可代行 Stage Gate;啟動時以 sales 角色加入成員</div>
            </div>
          </div>
        </div>

        {/* 4 種 PM */}
        <div className="bg-white border border-cortex-line rounded-lg p-3.5">
          <div className="text-[11px] font-bold text-cortex-muted tracking-widest mb-2.5">指派 4 種 PM</div>
          {PM_ROLES.map((pm, i) => {
            const nameKey = (pm.key + 'Name') as keyof WizardData
            const idKey = (pm.key + 'UserId') as keyof WizardData
            const val = (data[nameKey] as string) || ''
            const uid = (data[idKey] as number | null) ?? null
            const showRec = pm.key === 'dpm' && !!data.recommendedPmUserId && !!data.recommendedPmName && data.recommendedPmName !== val
            return (
              <div key={pm.key} className={`grid grid-cols-[50px_1fr_auto] gap-2.5 items-center py-2 ${i > 0 ? 'border-t border-cortex-line' : ''}`}>
                <span className="font-mono text-[10px] font-bold text-purple-700 bg-purple-100 px-1.5 py-1 rounded text-center">{pm.sub}</span>
                <div>
                  <UserPicker
                    token={token}
                    value={val}
                    userId={uid}
                    placeholder={`${pm.label}${pm.key === 'epm' ? '(選填)' : ''} · 搜尋姓名/工號`}
                    onPick={(p) => onChange({ [nameKey]: p.name, [idKey]: p.id } as any)}
                  />
                  <div className="text-[10px] text-cortex-muted mt-0.5">{pm.desc}</div>
                  {showRec && (
                    <button
                      onClick={() => onChange({ [nameKey]: data.recommendedPmName, [idKey]: data.recommendedPmUserId } as any)}
                      className="mt-1 text-[9px] bg-cortex-cyan-bg text-cortex-teal px-1.5 py-0.5 rounded font-bold hover:bg-cortex-teal hover:text-white transition"
                    >
                      ⭐ 上次合作 DPM:{data.recommendedPmName} · 一鍵套用
                    </button>
                  )}
                </div>
                {val && uid != null ? (
                  <span className="text-[9px] text-cortex-green font-bold whitespace-nowrap">✓ 已指派</span>
                ) : val ? (
                  <span className="text-[9px] text-amber-600 font-bold whitespace-nowrap" title="非系統帳號:啟動時不會加入專案成員,僅記錄名字">⚠ 未連結</span>
                ) : (
                  <span className="text-[9px] text-cortex-muted whitespace-nowrap">待邀請</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="bg-white border border-cortex-line rounded-[10px] p-3.5">
        <div className="text-[11px] text-cortex-cyan font-bold tracking-wide mb-2.5">
          <Sparkles size={11} className="inline -mt-px mr-1" /> 推薦來源
        </div>
        <div className="text-[10px] text-cortex-text leading-relaxed mb-3">
          {data.recommendedPmName && data.recommendedPmUserId ? (
            <>客戶 <strong>{data.customer || '—'}</strong> 最近一案的 DPM 是 <strong>{data.recommendedPmName}</strong>(真實歷史),左側可一鍵套用。</>
          ) : (
            <>Step 1 選「老客戶」後自動帶出該客戶上次合作的 DPM 供一鍵套用;新客戶直接搜尋指派。</>
          )}
        </div>
        <div className="text-[10px] text-cortex-text leading-relaxed mb-3 bg-cortex-cyan-bg/40 rounded p-2">
          下拉的「在手 N 案」= 該使用者目前擔任 PM 的進行中案量(DRAFT / ACTIVE),供負載平衡參考。
        </div>
        <div className="border-t border-dashed border-cortex-line pt-3 mb-3">
          <div className="text-[10px] font-bold text-cortex-muted mb-2">啟動時自動生效</div>
          <div className="text-[10px] text-cortex-text leading-relaxed">
            • DPM → project.pm(Stage Gate 推進權限)<br />
            • BPM / MPM / EPM → 成員(PM 角色 + 子角色)<br />
            • 業務助理 → 成員(sales 角色,可代行 Gate)<br />
            • 以上自動進 公告 / General 頻道
          </div>
        </div>
        <div className="border-t border-dashed border-cortex-line pt-3">
          <div className="text-[10px] font-bold text-cortex-muted mb-2">PM Team 邏輯</div>
          <div className="text-[10px] text-cortex-text leading-relaxed">
            • 各 PM 帶自己 team(invited_by_pm_user_id 自然涌現)<br />
            • DPM 邀 EE/ME/RD<br />
            • MPM 邀 SMT/EPM/工廠採購<br />
            • BPM 帶客戶窗口
          </div>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Step 5 — 流程模板
// ────────────────────────────────────────────────────────────
const QUOTE_STAGES = [
  { num: 1, name: 'Receive RFQ',         sla: '4h',       who: '業務 → DPM',     gate: true,  parallel: false },
  { num: 2, name: 'Q&A Collect',         sla: '24h',      who: 'DPM + Team',     gate: false, parallel: false },
  { num: 3, name: 'Q&A Feedback',        sla: '8h',       who: 'BPM 對客戶',     gate: false, parallel: false },
  { num: 4, name: 'BOM 提供',            sla: '24-72h',   who: 'EE + ME',        gate: false, parallel: false },
  { num: 5, name: '並行 Collect',         sla: 'parallel', who: 'MPM + DPM 同時', gate: false, parallel: true },
  { num: 6, name: 'BOM Cost Review',     sla: '8h',       who: '集合會議',       gate: true,  parallel: false },
  { num: 7, name: 'RFQ Cost Review',     sla: '16h',      who: '算毛利',         gate: true,  parallel: false },
  { num: 8, name: 'Submit Final Quote',  sla: '4h',       who: 'BPM 發',         gate: true,  parallel: false },
]

export function Step5Workflow(_props: StepProps) {
  return (
    <div>
      <StepBadge>STEP 4 / 6</StepBadge>
      <h3 className="text-lg font-bold text-cortex-navy mb-1.5">流程模板 · QUOTE_STANDARD</h3>
      <div className="text-[11px] text-cortex-muted mb-3.5">
        8 stages 對齊 OIBG RFQ flow · AI 自動推算 dependency deadline · 全程約 21 天
      </div>

      <div className="grid grid-cols-4 gap-2.5">
        {QUOTE_STAGES.map((st) => {
          const accent = st.gate ? 'border-cortex-amber bg-cortex-amber-bg' : st.parallel ? 'border-cortex-cyan bg-cortex-cyan-bg' : 'border-cortex-teal bg-white'
          const stageBadgeColor = st.gate ? 'bg-cortex-amber' : st.parallel ? 'bg-cortex-cyan' : 'bg-cortex-teal'
          return (
            <div key={st.num} className={`border rounded-md p-2.5 ${accent}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className={`font-mono text-[9px] font-bold text-white px-1.5 py-0.5 rounded ${stageBadgeColor}`}>
                  STAGE {st.num}
                </span>
                {st.gate && <span className="text-[9px] text-amber-900 font-bold">⚖ GATE</span>}
                {st.parallel && <span className="text-[9px] text-cortex-teal font-bold">⚡ 並行</span>}
              </div>
              <div className="text-[11px] font-bold text-cortex-navy mb-0.5 leading-tight">{st.name}</div>
              <div className={`text-[10px] font-mono font-bold ${st.gate ? 'text-amber-700' : st.parallel ? 'text-cortex-teal' : 'text-cortex-teal'}`}>
                {st.sla}
              </div>
              <div className="text-[9px] text-cortex-muted mt-0.5">{st.who}</div>
            </div>
          )
        })}
      </div>

      <div className="bg-gradient-to-br from-cortex-navy to-cortex-teal text-white rounded-lg px-4 py-3 mt-3.5">
        <div className="text-[10px] font-bold text-cortex-cyan tracking-wide mb-1.5">
          <Sparkles size={10} className="inline -mt-px mr-1" /> AI 自動算 Dependency Deadlines
        </div>
        <div className="text-[11px] text-cortex-cyan-bg leading-relaxed font-mono space-y-0.5">
          <div>• Schedule update (DPM, QA response+1day)</div>
          <div>• RET Plan and Cost (RET, QA response+3days)</div>
          <div>• EE BOM cost (採購, EE BOM+3days)</div>
          <div>• Internal BOM review (DPM, EE BOM Cost+1day)</div>
          <div>• Cleansheet send to VP (MPM, EE BOM Cost+1day)</div>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Step 6 — priority_score 矩陣
// ────────────────────────────────────────────────────────────
const PRIORITY_MATRIX = [
  // [低急, 中急, 高急]
  [{ score: 3, lvl: 3 }, { score: 5, lvl: 5 }, { score: 6, lvl: 6 }], // 高重
  [{ score: 2, lvl: 2 }, { score: 3, lvl: 3 }, { score: 4, lvl: 4 }], // 中重
  [{ score: 1, lvl: 1 }, { score: 1, lvl: 1 }, { score: 2, lvl: 2 }], // 低重
]
const Y_LABELS = ['高重', '中重', '低重']
const X_LABELS = ['低急', '中急', '高急']

function priorityColor(lvl: number): string {
  if (lvl >= 6) return 'bg-red-100 border-red-300 text-red-700'
  if (lvl >= 4) return 'bg-orange-100 border-orange-300 text-orange-700'
  if (lvl >= 2) return 'bg-yellow-100 border-yellow-300 text-yellow-700'
  return 'bg-cortex-line-2 border-cortex-line text-cortex-muted'
}

export function Step6Priority({ data, onChange }: StepProps) {
  return (
    <div>
      <StepBadge>STEP 5 / 6</StepBadge>
      <h3 className="text-lg font-bold text-cortex-navy mb-1.5">重要 × 緊急 priority_score</h3>
      <div className="text-[11px] text-cortex-muted mb-3.5">
        AI 依客戶等級 + 案值 + 交期建議 score = 6,業務可手動覆寫
      </div>

      <div className="grid grid-cols-[1.5fr_1fr] gap-5">
        <div>
          <div className="inline-grid grid-cols-4 gap-1.5">
            <div></div>
            {X_LABELS.map((x) => (
              <div key={x} className="text-[10px] text-cortex-muted text-center font-bold">{x}</div>
            ))}
            {PRIORITY_MATRIX.map((row, ri) => (
              <Fragment key={`row-${ri}`}>
                <div className="text-[10px] text-cortex-muted text-right pr-1 font-bold self-center">
                  {Y_LABELS[ri]}
                </div>
                {row.map((cell, ci) => {
                  const selected = data.priorityScore === cell.score
                  return (
                    <button
                      key={`${ri}-${ci}`}
                      onClick={() => onChange({ priorityScore: cell.score })}
                      className={`w-14 h-14 rounded-md border-2 text-[18px] font-extrabold font-mono transition ${
                        selected
                          ? 'border-cortex-navy ring-2 ring-cortex-cyan bg-cortex-navy text-white scale-105'
                          : priorityColor(cell.lvl) + ' hover:scale-105'
                      }`}
                    >
                      {cell.score}
                    </button>
                  )
                })}
              </Fragment>
            ))}
          </div>
          <div className="mt-2.5 text-[11px] text-cortex-muted text-center">
            已選 <strong className="text-cortex-red font-mono">priority_score = {data.priorityScore}</strong>
          </div>
        </div>

        <div className="bg-white border border-cortex-line rounded-lg p-3.5">
          <div className="text-[10px] font-bold text-cortex-cyan tracking-wide mb-2.5">
            <Sparkles size={10} className="inline -mt-px mr-1" /> AI 推薦理由
          </div>
          <div className="text-[11px] text-cortex-text leading-relaxed mb-3">
            • 客戶 {data.customer} = Tier-1 戰略客戶<br />
            • 案值 ~$1.2M USD = 高重要<br />
            • 交期 60 天 ≈ 歷史平均 = 高急<br />
            <strong className="text-cortex-red">→ score 6(高重 × 高急)</strong>
          </div>

          <div className="border-t border-dashed border-cortex-line pt-2.5">
            <div className="text-[10px] font-bold text-cortex-muted mb-1.5">score ≥ 6 的影響</div>
            <div className="text-[10px] text-cortex-text leading-relaxed">
              • 自動進主管 Watchlist<br />
              • Escalation chain trigger 縮短<br />
              • Bot 主動提醒頻率增加
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Step 7 — 確認啟動
// ────────────────────────────────────────────────────────────
const STARTUP_ACTIONS = [
  { Icon: MessageSquare, t: '建立 7 個 channels',         d: 'announcement / general / qa-customer / engineering / sourcing / factory / cost-review' },
  { Icon: ListChecks,    t: '建立 8 stages 任務',          d: '依 RACI 表自動指派 A/R · dependency deadline 自動推算' },
  { Icon: Bell,          t: '通知所有相關人員',             d: 'Webex 群組 + 站內 Badge + Email 三通道' },
  { Icon: Pin,           t: '#announcement Pin 啟動訊息', d: '業務發布「專案啟動」公告 + 已讀回執' },
  { Icon: Clock,         t: '啟動 SLA 倒數',               d: 'Stage 1 SLA 4h 開始計時 · escalation chain ready' },
]

export function Step7Confirm({ data }: StepProps) {
  return (
    <div>
      <StepBadge>STEP 6 / 6</StepBadge>
      <h3 className="text-lg font-bold text-cortex-navy mb-3.5">確認與啟動</h3>

      <div className="bg-gradient-to-b from-cortex-cyan-bg to-white border border-cortex-cyan rounded-[10px] p-4 mb-3.5">
        <div className="grid grid-cols-2 gap-3.5 text-[11px]">
          <SummaryRow label="專案編號" mono>
            <span className="text-cortex-navy font-bold text-[14px]">{data.generatedProjectCode || '(啟動時生成)'}</span>
          </SummaryRow>
          <SummaryRow label="客戶 / 料號">
            <span className="text-cortex-ink font-semibold">{data.customer} · {data.partNo}</span>
          </SummaryRow>
          <SummaryRow label="業務 + 助理">
            <span className="text-cortex-ink">{data.salesName || '(當前 user)'}{data.salesAssistantName ? ` + ${data.salesAssistantName}` : ''}</span>
          </SummaryRow>
          <SummaryRow label="Multi-PM">
            <span className="text-cortex-ink text-[10px]">
              DPM {data.dpmName || '(你自己)'} · BPM {data.bpmName || '—'} · MPM {data.mpmName || '—'} · EPM {data.epmName || '—'}
            </span>
            {(() => {
              const missing = [
                !data.bpmName && 'BPM', !data.mpmName && 'MPM', !data.epmName && 'EPM',
              ].filter(Boolean) as string[]
              const unlinked = [
                data.dpmName && data.dpmUserId == null && `DPM「${data.dpmName}」`,
                data.bpmName && data.bpmUserId == null && `BPM「${data.bpmName}」`,
                data.mpmName && data.mpmUserId == null && `MPM「${data.mpmName}」`,
                data.epmName && data.epmUserId == null && `EPM「${data.epmName}」`,
                data.salesAssistantName && data.salesAssistantUserId == null && `助理「${data.salesAssistantName}」`,
              ].filter(Boolean) as string[]
              if (!missing.length && !unlinked.length && data.dpmName) return null
              return (
                <div className="mt-1 text-[9px] leading-relaxed">
                  {!data.dpmName && <div className="text-cortex-muted">ℹ DPM 未指派 → 開案人自任 PM(Stage Gate 由你推進)</div>}
                  {missing.length > 0 && <div className="text-amber-600">⚠ 未指派:{missing.join(' · ')}(可事後在 WarRoom 邀請)</div>}
                  {unlinked.length > 0 && <div className="text-amber-600">⚠ 未連結帳號:{unlinked.join(' · ')} — 不會加入成員,僅記名字</div>}
                </div>
              )
            })()}
          </SummaryRow>
          <SummaryRow label="Workflow / 週期">
            <span className="text-cortex-ink">{data.workflowTemplateCode}(8 stages)· {data.estimatedCycleDays} 天</span>
          </SummaryRow>
          <SummaryRow label="機密 / 優先序">
            <span className="text-cortex-ink">
              {data.isConfidential ? '🔒 ON · ' : ''}
              {Object.values(data.confidentialFields).filter(f => f.enabled).length} 欄位加密 · score 🟠 {data.priorityScore}
            </span>
          </SummaryRow>
        </div>
      </div>

      <div className="bg-white border border-cortex-line rounded-[10px] p-3.5">
        <div className="text-[11px] font-bold text-cortex-teal tracking-wide mb-2.5">點啟動後系統會自動執行 ↓</div>
        {STARTUP_ACTIONS.map((it, i) => {
          const Icon = it.Icon
          return (
            <div key={i} className="flex gap-2.5 py-1.5 items-start">
              <Icon size={14} className="text-cortex-teal flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-[11px] font-bold text-cortex-ink">
                  <CheckCircle2 size={11} className="inline -mt-px mr-1 text-cortex-green" />
                  {it.t}
                </div>
                <div className="text-[10px] text-cortex-muted mt-0.5">{it.d}</div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="text-center mt-3.5 text-[10px] text-cortex-muted italic">
        從 Step 1 拖檔到此處 · 5 分鐘完成(原本 30 分鐘)
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function StepBadge({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] text-cortex-cyan font-bold tracking-[2px] mb-1">{children}</div>
  )
}

function SummaryRow({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-cortex-muted text-[9px] font-bold tracking-widest mb-0.5">{label}</div>
      <div className={mono ? 'font-mono' : ''}>{children}</div>
    </div>
  )
}
