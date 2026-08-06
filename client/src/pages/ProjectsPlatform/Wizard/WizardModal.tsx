/**
 * WizardModal — ⭐ 開案 7 步驟 Wizard
 *
 * 對齊 docs/Cortex_互動Demo.html `#createModal` + renderWizard()
 *
 * Flow:
 *   1. ProjectsList 「+ 新增專案」按鈕觸發 onClick → 開 modal
 *   2. 7 步 stepper(可跳)+ 每步內容 + 上/下一步
 *   3. Step 7 「✓ 啟動專案」 → POST /api/projects/projects → 跳 WarRoom
 *
 * 後續 Sprint 補:
 *   - 真實 RFQ PDF 拖檔上傳 + AI #1 解析(Sprint F)
 *   - 真實歷史相似案 RAG(Sprint F)
 *   - 真實 PM 推薦 / 交期合理性 / priority AI(Sprint F)
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Loader2, Rocket } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api } from '../api'
import { TOKENS } from '../tokens'
import WizardStepper from './WizardStepper'
import { INITIAL_WIZARD, type WizardData, generateProjectCode } from './wizardState'
import {
  Step1Intake, Step3Confidentiality, Step4PmTeam,
  Step5Workflow, Step7Confirm,
} from './WizardSteps'

type Props = {
  open: boolean
  onClose: () => void
}

export default function WizardModal({ open, onClose }: Props) {
  const { user, token } = useAuth() as any
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [data, setData] = useState<WizardData>(() => ({
    ...INITIAL_WIZARD,
    salesName: user?.name || user?.username || '',
    salesUserId: user?.id ?? null,
    generatedProjectCode: generateProjectCode('Q'),
  }))
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // P1 報價設定(Step 5 附掛):廠別成本模型(範本庫多選)+ 變異軸 + NRE — 建案後自動 provision
  const [cmTemplates, setCmTemplates] = useState<any[]>([])
  const [selTpl, setSelTpl] = useState<number[]>([])
  const [dimText, setDimText] = useState('')          // 一行一維度:顏色=Black,White
  const [nreMode, setNreMode] = useState<'SEPARATE' | 'AMORTIZED'>('SEPARATE')
  const [nreQty, setNreQty] = useState('')
  useEffect(() => {
    if (!open || !token) return
    api.get<{ templates: any[] }>(token, '/bom/provision/templates').then((r) => setCmTemplates(r.templates || [])).catch(() => {})
  }, [open, token])

  if (!open) return null

  const patch = (p: Partial<WizardData>) => setData((d) => ({ ...d, ...p }))

  const next = async () => {
    if (step < 5) {
      setStep(step + 1)
      return
    }
    // 最終步 — 啟動
    setSubmitting(true)
    setErr(null)
    try {
      const confidentialFieldsArr = Object.entries(data.confidentialFields)
        .filter(([, v]) => v.enabled)
        .map(([k]) => k)

      const r = await api.post<{ project: { id: number } }>(token, '/projects', {
        project_code: data.generatedProjectCode,
        type_code: 'QUOTE',
        title: `${data.customer} · ${data.partNo}`,
        pm_user_id: data.dpmUserId || undefined,
        sales_user_id: data.salesUserId || undefined,
        bu_id: 1,
        importance: data.priorityScore >= 5 ? 'HIGH' : data.priorityScore >= 3 ? 'NORMAL' : 'LOW',
        urgency: data.priorityScore >= 5 ? 'HIGH' : data.priorityScore >= 3 ? 'NORMAL' : 'LOW',
        priority_score: data.priorityScore,
        data_payload: {
          title: `${data.customer} · ${data.partNo}`,
          customer: data.customer,
          customer_alias: data.custAlias || undefined,
          kickoffNote: data.kickoffNote || undefined,
          partNo: data.partNo,
          // Step1 客戶信息 → 直通報價 Form customer 段(免二次輸入 · 完成度直接有分)
          form: {
            customer: {
              cust_name: data.customer || '',
              cust_alias: data.custAlias || '',
              tax_id: data.taxId || '',
              po_number: '',
              payment_terms: data.paymentTerms || '',
              ship_address: data.shipAddress || '',
              contact_name: data.contactName || '',
              cust_code_erp: '',
            },
          },
          quantity: data.quantity,
          dueDate: data.dueDate,
          // Step 1 AI #1 RFQ extract 結果(Sprint J 補:寫 attach chunk 進 KB)
          rfqFileName: data.rfqFileName,
          rfqFilePath: data.rfqFilePath,
          rfqMimeType: data.rfqMimeType,
          specs: data.specs,
          notes: data.notes,
          // Step 2 結果
          selectedHistoryId: data.selectedHistoryId,
          recommendedPmName: data.recommendedPmName,
          estimatedCycleDays: data.custAvgCycleDays,
          // Step 3
          isConfidential: data.isConfidential,
          confidentialFields: confidentialFieldsArr,
          confidentialPolicies: data.confidentialFields,
          // Step 4
          pms: {
            sales: data.salesName, salesUserId: data.salesUserId,
            salesAssistant: data.salesAssistantName, salesAssistantUserId: data.salesAssistantUserId,
            dpm: data.dpmName, dpmUserId: data.dpmUserId,
            bpm: data.bpmName, bpmUserId: data.bpmUserId,
            mpm: data.mpmName, mpmUserId: data.mpmUserId,
            epm: data.epmName, epmUserId: data.epmUserId,
          },
          // Step 6
          priorityScore: data.priorityScore,
        },
      })
      // P1 報價設定:建案後自動 provision 廠別 / 變異軸 / NRE(單項失敗不擋進 WarRoom)
      const pid = r.project.id
      const warns: string[] = []
      // Step 3 PM/Team:選了系統帳號的 → 啟動即加入成員(DPM/業務由 create 自動;單筆失敗不擋)
      const invitees = [
        { id: data.bpmUserId, role: 'PM', sub: 'BPM', label: 'BPM' },
        { id: data.mpmUserId, role: 'PM', sub: 'MPM', label: 'MPM' },
        { id: data.epmUserId, role: 'PM', sub: 'EPM', label: 'EPM' },
        { id: data.salesAssistantUserId, role: 'sales', sub: null, label: '業務助理' },
      ]
      const invitedIds = new Set<number>([data.dpmUserId || 0, data.salesUserId || 0, user?.id || 0])
      for (const iv of invitees) {
        if (!iv.id || invitedIds.has(iv.id)) continue
        invitedIds.add(iv.id)
        try {
          await api.post(token, `/projects/${pid}/members`, {
            user_id: iv.id, role: iv.role, sub_role: iv.sub,
            invited_by_pm_user_id: data.dpmUserId || undefined,
          })
        } catch (e: any) { warns.push(`成員 ${iv.label}:${e.message}`) }
      }
      for (const tid of selTpl) {
        try { await api.post(token, '/bom/provision-case', { projectId: pid, sourceCaseFactoryId: tid }) }
        catch (e: any) { warns.push(`廠別範本 #${tid}:${e.message}`) }
      }
      for (const line of dimText.split('\n').map((l) => l.trim()).filter(Boolean)) {
        const m = line.match(/^([^=:]+)[=:](.+)$/)
        if (!m) { warns.push(`變異軸格式不對:${line}`); continue }
        try {
          const d = await api.post<{ dimensionId: number }>(token, `/bom/project/${pid}/dimensions`, { dimCode: m[1].trim() })
          for (const v of m[2].split(/[,、;]/).map((x) => x.trim()).filter(Boolean)) {
            await api.post(token, `/bom/project/${pid}/dimensions/${d.dimensionId}/values`, { valueCode: v })
          }
        } catch (e: any) { warns.push(`變異軸 ${m[1]}:${e.message}`) }
      }
      if (nreMode === 'AMORTIZED' || nreQty) {
        try { await api.put(token, '/bom/nre/config', { projectId: pid, nreMode, nreAmortizeQty: nreQty ? Number(nreQty) : (Number(data.quantity) || null) }) }
        catch (e: any) { warns.push(`NRE 設定:${e.message}`) }
      }
      if (warns.length) console.warn('[Wizard 報價設定]', warns)
      onClose()
      navigate(`/projects-platform/projects/${pid}`)
    } catch (e: any) {
      setErr(e.message || '啟動失敗')
    } finally {
      setSubmitting(false)
    }
  }

  const prev = () => { if (step > 1) setStep(step - 1) }

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4 font-cortex">
      <div className="bg-white rounded-xl shadow-cortex-lg w-full max-w-[920px] h-[min(640px,calc(100vh-2rem))] flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="px-5 py-3 border-b border-cortex-line flex items-center justify-between text-white"
          style={{ backgroundColor: TOKENS.navy }}
        >
          <div className="flex items-center gap-2">
            <Rocket size={16} className="text-cortex-cyan" />
            <span className="font-bold text-[15px]">⭐ 開案 Wizard · 5 步驟</span>
            <span className="text-[10px] font-bold tracking-widest text-cortex-cyan bg-cortex-cyan/10 px-2 py-0.5 rounded">
              30min → 5min
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-md text-white/85 hover:bg-white/10 flex items-center justify-center transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Stepper */}
        <WizardStepper current={step} onJump={setStep} />

        {/* Content — flex-1 + min-h-0 讓 overflow-y-auto 真的生效,footer 才不會被擠出 */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 bg-cortex-bg">
          {step === 1 && <Step1Intake          data={data} onChange={patch} />}
          {step === 2 && <Step3Confidentiality data={data} onChange={patch} />}
          {step === 3 && <Step4PmTeam          data={data} onChange={patch} />}
          {step === 4 && (
            <>
              <Step5Workflow data={data} onChange={patch} />
              {/* P1 報價設定:廠別成本模型 / 變異軸 / NRE — 建案時自動帶好,免去 BOM 區拼裝 */}
              <div className="mt-4 border border-cortex-teal/30 bg-cortex-cyan-bg/30 rounded-lg p-3 space-y-2.5">
                <div className="text-[12px] font-bold text-cortex-ink">💰 報價設定(建案自動帶入)</div>
                <div>
                  <div className="text-[11px] text-cortex-muted mb-1">生產廠別 × 成本模型(範本庫 · 可多選,之後仍可在 BOM 區加)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {cmTemplates.map((t) => {
                      const on = selTpl.includes(t.caseFactoryId)
                      return (
                        <button key={t.caseFactoryId} type="button"
                          onClick={() => setSelTpl((p) => {
                            if (on) return p.filter((x) => x !== t.caseFactoryId)
                            // 同廠單選(一專案一廠一模型):點同廠另一模型 = 替換
                            const sameFactory = cmTemplates.filter((c) => c.factoryCode === t.factoryCode).map((c) => c.caseFactoryId)
                            return [...p.filter((x) => !sameFactory.includes(x)), t.caseFactoryId]
                          })}
                          className={`text-[11px] px-2 py-1 rounded border ${on ? 'bg-cortex-teal text-white border-cortex-teal' : 'bg-white border-cortex-line text-cortex-muted hover:border-cortex-teal'}`}>
                          {t.factoryCode}{t.buCode ? `/${t.buCode}` : ''} · {t.costingModel === 'FULL_MVA' ? 'FULL' : 'SIMP'}{t.templateLabel ? ` · ${t.templateLabel}` : ''}
                        </button>
                      )
                    })}
                    {cmTemplates.length === 0 && <span className="text-[11px] text-cortex-muted">(範本庫載入中/為空)</span>}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-cortex-muted mb-1">產品變異軸(一行一軸:<span className="font-mono">顏色=Black,White</span>;沒有可留空)</div>
                  <textarea value={dimText} onChange={(e) => setDimText(e.target.value)} rows={2}
                    placeholder={'顏色=Black,White\n包裝=Retail,WB-Suit'}
                    className="w-full border border-cortex-line rounded px-2 py-1 text-[11px] font-mono" />
                </div>
                <div className="flex items-end gap-2 flex-wrap">
                  <label className="text-[11px] text-cortex-muted">NRE 模式<br />
                    <select value={nreMode} onChange={(e) => setNreMode(e.target.value as any)} className="border border-cortex-line rounded px-2 py-1 text-[12px]">
                      <option value="SEPARATE">SEPARATE(另計)</option>
                      <option value="AMORTIZED">AMORTIZED(攤入單價)</option>
                    </select>
                  </label>
                  {nreMode === 'AMORTIZED' && (
                    <label className="text-[11px] text-cortex-muted">攤提量(空=用年量)<br />
                      <input value={nreQty} onChange={(e) => setNreQty(e.target.value)} placeholder={String(data.quantity || 100000)}
                        className="border border-cortex-line rounded px-2 py-1 text-[12px] w-28 font-mono" />
                    </label>
                  )}
                </div>
              </div>
            </>
          )}
          {step === 5 && <Step7Confirm         data={data} onChange={patch} />}
        </div>

        {err && (
          <div className="px-5 py-2 bg-cortex-red-bg border-t border-red-200 text-red-700 text-xs">
            ⚠ {err}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3 border-t border-cortex-line flex items-center justify-between bg-white">
          <button
            onClick={prev}
            disabled={step === 1}
            className="px-4 py-2 text-[13px] font-semibold rounded-md border border-cortex-line text-cortex-text bg-white hover:bg-cortex-bg disabled:invisible transition"
          >
            ← 上一步
          </button>
          <div className="text-[11px] text-cortex-muted">Step {step} / 5</div>
          <button
            onClick={next}
            disabled={submitting}
            className="px-5 py-2 text-[13px] font-bold rounded-md transition inline-flex items-center gap-1.5 disabled:opacity-50 hover:brightness-110 shadow-cortex-sm"
            style={
              step === 5
                ? { background: `linear-gradient(135deg, ${TOKENS.cyan}, ${TOKENS.teal})`, color: '#fff' }
                : { background: TOKENS.cyan, color: TOKENS.navy }
            }
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                啟動中…
              </>
            ) : step === 5 ? (
              <>
                <Rocket size={14} /> ✓ 啟動專案
              </>
            ) : (
              '下一步 →'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
