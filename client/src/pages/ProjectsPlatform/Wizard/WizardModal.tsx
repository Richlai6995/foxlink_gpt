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

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Loader2, Rocket } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api } from '../api'
import WizardStepper from './WizardStepper'
import { INITIAL_WIZARD, type WizardData, generateProjectCode } from './wizardState'
import {
  Step1Intake, Step2History, Step3Confidentiality, Step4PmTeam,
  Step5Workflow, Step6Priority, Step7Confirm,
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
    generatedProjectCode: generateProjectCode('Q'),
  }))
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!open) return null

  const patch = (p: Partial<WizardData>) => setData((d) => ({ ...d, ...p }))

  const next = async () => {
    if (step < 7) {
      setStep(step + 1)
      return
    }
    // Step 7 — 啟動
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
        bu_id: 1,
        importance: data.priorityScore >= 5 ? 'HIGH' : data.priorityScore >= 3 ? 'NORMAL' : 'LOW',
        urgency: data.priorityScore >= 5 ? 'HIGH' : data.priorityScore >= 3 ? 'NORMAL' : 'LOW',
        data_payload: {
          title: `${data.customer} · ${data.partNo}`,
          customer: data.customer,
          partNo: data.partNo,
          quantity: data.quantity,
          dueDate: data.dueDate,
          rfqFileName: data.rfqFileName,
          // Step 2 結果
          selectedHistoryId: data.selectedHistoryId,
          recommendedPmName: data.recommendedPmName,
          estimatedCycleDays: data.estimatedCycleDays,
          // Step 3
          isConfidential: data.isConfidential,
          confidentialFields: confidentialFieldsArr,
          confidentialPolicies: data.confidentialFields,
          // Step 4
          pms: {
            sales: data.salesName,
            salesAssistant: data.salesAssistantName,
            dpm: data.dpmName,
            bpm: data.bpmName,
            mpm: data.mpmName,
            epm: data.epmName,
          },
          // Step 6
          priorityScore: data.priorityScore,
        },
      })
      onClose()
      navigate(`/projects-platform/projects/${r.project.id}`)
    } catch (e: any) {
      setErr(e.message || '啟動失敗')
    } finally {
      setSubmitting(false)
    }
  }

  const prev = () => { if (step > 1) setStep(step - 1) }

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4 font-cortex">
      <div className="bg-white rounded-xl shadow-cortex-lg w-full max-w-[920px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-cortex-line flex items-center justify-between bg-cortex-navy text-white">
          <div className="flex items-center gap-2">
            <Rocket size={16} className="text-cortex-cyan" />
            <span className="font-bold text-[15px]">⭐ 開案 Wizard · 7 步驟</span>
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 bg-cortex-bg min-h-[420px]">
          {step === 1 && <Step1Intake          data={data} onChange={patch} />}
          {step === 2 && <Step2History         data={data} onChange={patch} />}
          {step === 3 && <Step3Confidentiality data={data} onChange={patch} />}
          {step === 4 && <Step4PmTeam          data={data} onChange={patch} />}
          {step === 5 && <Step5Workflow        data={data} onChange={patch} />}
          {step === 6 && <Step6Priority        data={data} onChange={patch} />}
          {step === 7 && <Step7Confirm         data={data} onChange={patch} />}
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
          <div className="text-[11px] text-cortex-muted">Step {step} / 7</div>
          <button
            onClick={next}
            disabled={submitting}
            className={`px-5 py-2 text-[13px] font-bold rounded-md transition inline-flex items-center gap-1.5 disabled:opacity-50 ${
              step === 7
                ? 'bg-gradient-to-br from-cortex-cyan to-cortex-teal text-white hover:brightness-105 shadow-cortex-sm'
                : 'bg-cortex-cyan text-cortex-navy hover:bg-[#04D9AC]'
            }`}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                啟動中…
              </>
            ) : step === 7 ? (
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
