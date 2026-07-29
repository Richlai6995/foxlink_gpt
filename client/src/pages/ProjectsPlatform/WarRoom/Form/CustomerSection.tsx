/**
 * CustomerSection — 客戶資料 + 規格 / 數量 + 其他(原 FormStub 內容拆出)
 *
 * v0.16 plan #1:上半 = 8 欄可編輯(存 data_payload.form.customer · PUT /bom/form/customer);
 * 下半保留原 data_payload 唯讀摘要(規格/數量 · Wizard 值)。
 */

import { useEffect, useState } from 'react'
import { Lock, Sparkles, Factory, Activity, Loader2 } from 'lucide-react'
import type { ProjectDetail } from '../../api'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import AiSuggestionModal from '../AiSuggestionModal'
import CleansheetPanel from '../CleansheetPanel'
import WhatIfPanel from '../WhatIfPanel'

// v0.16 客戶資料 8 欄(欄位對齊 demo schema 10157–10165)
const CUST_FIELDS: { key: string; label: string; type?: 'textarea' | 'select'; options?: string[]; ph?: string }[] = [
  { key: 'cust_name', label: '客戶名稱', ph: 'SteelSeries ApS' },
  { key: 'cust_alias', label: '客戶代號(別名)', ph: '機密案對外用 A001' },
  { key: 'tax_id', label: '統編 / Tax ID', ph: '04541302' },
  { key: 'cust_code_erp', label: '客戶代號(ERP 主檔)', ph: 'A001-SS-001' },
  { key: 'po_number', label: '客戶 PO 號', ph: 'PO-SS-2026-…' },
  { key: 'payment_terms', label: '付款條件', type: 'select', options: ['月結 30 天', '月結 45 天', '月結 60 天', 'T/T 前付', 'L/C', '其他'] },
  { key: 'ship_address', label: '收貨地址', type: 'textarea' },
  { key: 'contact_name', label: '採購窗口', ph: 'David Chang (procurement)' },
]

function CustomerEditCard({ project }: { project: ProjectDetail }) {
  const { token } = useAuth() as any
  const dp = (project.data_payload as any) || {}
  const [vals, setVals] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!token) return
    api.get<any>(token, `/bom/form?projectId=${project.id}`).then((r) => {
      const f = r.form?.customer || {}
      // prefill:form.customer 優先,退回 Wizard 舊欄位
      setVals({
        cust_name: f.cust_name ?? dp.customer ?? '',
        cust_alias: f.cust_alias ?? dp.customer_alias ?? '',
        tax_id: f.tax_id ?? '',
        cust_code_erp: f.cust_code_erp ?? '',
        po_number: f.po_number ?? '',
        payment_terms: f.payment_terms ?? '',
        ship_address: f.ship_address ?? '',
        contact_name: f.contact_name ?? '',
      })
    }).catch(() => {})
  }, [token, project.id])   // eslint-disable-line
  async function save() {
    setBusy(true); setMsg('')
    try {
      await api.put(token, '/bom/form/customer', { projectId: project.id, fields: vals })
      setDirty(false); setMsg('✓ 已存檔')
      window.dispatchEvent(new CustomEvent('cortex:form-refresh'))
      setTimeout(() => setMsg(''), 2500)
    } catch (e: any) { setMsg(`存檔失敗:${e.message}`) } finally { setBusy(false) }
  }
  const set = (k: string, v: string) => { setVals((p) => ({ ...p, [k]: v })); setDirty(true) }
  const filledN = CUST_FIELDS.filter((f) => (vals[f.key] || '').trim()).length
  return (
    <div className="border border-cortex-line rounded-lg p-3 space-y-2 mb-4">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-bold text-cortex-ink">👥 客戶資料 <span className="text-[10px] text-cortex-muted font-normal">{filledN} / {CUST_FIELDS.length} 欄</span></div>
        <div className="flex items-center gap-2">
          {msg && <span className={`text-[10px] ${msg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{msg}</span>}
          <button onClick={save} disabled={busy || !dirty}
            className="px-2.5 py-1 bg-cortex-navy text-white rounded hover:opacity-90 disabled:opacity-40 text-[11px]">
            {busy ? <Loader2 className="w-3 h-3 inline animate-spin" /> : null} 存檔
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {CUST_FIELDS.map((f) => (
          <label key={f.key} className={`text-[10px] text-cortex-muted ${f.type === 'textarea' ? 'col-span-2' : ''}`}>
            {f.label}
            {f.type === 'select' ? (
              <select value={vals[f.key] || ''} onChange={(e) => set(f.key, e.target.value)}
                className="mt-0.5 w-full border border-cortex-line rounded px-2 py-1 text-[12px] text-cortex-ink bg-white">
                <option value="">—</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea value={vals[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} rows={2} placeholder={f.ph}
                className="mt-0.5 w-full border border-cortex-line rounded px-2 py-1 text-[12px] text-cortex-ink" />
            ) : (
              <input value={vals[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} placeholder={f.ph}
                className="mt-0.5 w-full border border-cortex-line rounded px-2 py-1 text-[12px] text-cortex-ink" />
            )}
          </label>
        ))}
      </div>
    </div>
  )
}

export default function CustomerSection({ project }: { project: ProjectDetail }) {
  const dp = (project.data_payload as any) || {}
  const isConf = !!(project as any).is_confidential
  const [aiField, setAiField] = useState<{ key: string; label: string } | null>(null)
  const [aiAccepted, setAiAccepted] = useState<Record<string, any>>({})
  const [showCleansheet, setShowCleansheet] = useState(false)
  const [showWhatIf, setShowWhatIf] = useState(false)

  const AI_SUGGEST_FIELDS = new Set(['amount', 'margin', 'cost_breakdown', 'priorityScore'])

  const sections: { label: string; fields: { key: string; label: string; confidential?: boolean }[] }[] = [
    {
      label: '規格 / 數量',
      fields: [
        { key: 'quantity', label: '年量', confidential: true },
        { key: 'dueDate',  label: '交期' },
        { key: 'specs',    label: '規格' },
        { key: 'notes',    label: '備註' },
      ],
    },
    {
      label: '價格 / 成本(機密)',
      fields: [
        { key: 'amount',         label: '報價金額',     confidential: true },
        { key: 'margin',         label: '毛利率',       confidential: true },
        { key: 'cost_breakdown', label: '成本明細',     confidential: true },
      ],
    },
    {
      label: '其他',
      fields: [
        { key: 'estimatedCycleDays', label: '預估週期(天)' },
        { key: 'priorityScore',      label: 'priority_score' },
      ],
    },
  ]

  const versions = ['v1', 'v2', 'v3 ★', 'v4 draft']

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between mb-2 flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-bold text-cortex-ink">
            報價 Form
            <span className="ml-2 text-[11px] font-normal text-cortex-muted">spec §11 · Wizard 填的值 + 版本鏈</span>
          </h3>
          <p className="text-[12px] text-cortex-muted mt-0.5">
            Phase 1 demo:Wizard 收的值 + 版本軌跡 · v0.5 sections 切左欄看
          </p>
        </div>
      </div>

      {/* v0.16 #1:客戶資料 8 欄可編輯 */}
      <CustomerEditCard project={project} />

      {/* 版本鏈 */}
      <div className="bg-cortex-line-2/60 border border-cortex-line rounded p-3 flex items-center gap-2 flex-wrap text-[12px]">
        <span className="text-cortex-muted text-[10px] font-bold">版本鏈:</span>
        {versions.map((v) => {
          const isCurrent = v.includes('★')
          const isDraft = v.includes('draft')
          return (
            <span
              key={v}
              className={`px-2 py-0.5 rounded font-mono font-bold ${
                isCurrent ? 'bg-cortex-cyan text-cortex-navy' :
                isDraft   ? 'bg-cortex-amber-bg text-amber-800 border border-amber-300' :
                            'bg-white border border-cortex-line text-cortex-muted'
              }`}
            >
              {v}
            </span>
          )
        })}
        <span className="text-cortex-muted text-[10px]">→</span>
        <span className="px-2 py-0.5 rounded font-mono font-bold bg-cortex-line text-cortex-muted">FINAL(待結案)</span>
      </div>

      <div className="space-y-3">
        {sections.map((sec) => (
          <div key={sec.label} className="bg-white border border-cortex-line rounded-lg p-4">
            <div className="text-[12px] font-bold text-cortex-teal mb-2 flex items-center justify-between">
              <span>{sec.label}</span>
              {sec.label.includes('價格 / 成本') && (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setShowWhatIf(true)}
                    className="text-[10px] inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gradient-to-r from-purple-600 to-cortex-teal text-white font-bold hover:opacity-90"
                    title="AI #18 What-if 模擬器(spec §16.5)"
                  >
                    <Activity size={10} /> What-if 模擬
                  </button>
                  <button
                    onClick={() => setShowCleansheet(true)}
                    className="text-[10px] inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gradient-to-r from-cortex-navy to-cortex-teal text-white font-bold hover:opacity-90"
                    title="AI #12 Cleansheet 三廠成本拆解 + 對比分析"
                  >
                    <Factory size={10} /> Cleansheet AI 分析
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {sec.fields.map((f) => {
                const accepted = aiAccepted[f.key]
                const v = accepted !== undefined ? accepted : dp[f.key]
                const display = v === undefined || v === '' || v === null ? '—' :
                                typeof v === 'object' ? JSON.stringify(v).slice(0, 60) + (JSON.stringify(v).length > 60 ? '…' : '') :
                                String(v)
                const canSuggest = AI_SUGGEST_FIELDS.has(f.key)
                return (
                  <div key={f.key} className="flex items-start gap-2 text-[12px] border-b border-cortex-line/50 pb-1.5 last:border-b-0">
                    <div className="w-24 text-cortex-muted shrink-0 flex items-center gap-1">
                      {f.confidential && <Lock size={10} className="text-amber-700" />}
                      <span>{f.label}</span>
                    </div>
                    <div className="flex-1 font-mono text-cortex-ink flex items-center gap-1.5 min-w-0">
                      {f.confidential && isConf && display !== '—' ? (
                        <span className="text-amber-700 bg-cortex-amber-bg/50 px-1.5 rounded truncate">{display}</span>
                      ) : (
                        <span className="truncate">{display}</span>
                      )}
                      {accepted !== undefined && (
                        <span className="text-[8px] bg-purple-100 text-purple-700 px-1 py-0.5 rounded font-bold shrink-0" title="AI 建議已採用(spec §12.5 走影子表)">
                          AI ✓
                        </span>
                      )}
                      {canSuggest && (
                        <button
                          onClick={() => setAiField(f)}
                          className="text-[10px] text-purple-600 hover:text-purple-700 inline-flex items-center gap-0.5 shrink-0"
                          title="✨ AI 建議(spec §12.5 Form Surface 2)"
                        >
                          <Sparkles size={9} /> AI
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-cortex-cyan-bg/40 border-l-2 border-cortex-cyan rounded-r p-3 text-[11px] text-cortex-teal">
        💡 機密欄位 displayStrategy 已在 admin/機密策略頁套用 — 切右上「視角」dropdown 看不同角色畫面 ·
        ✨ AI 建議(spec §12.5)走影子表 user 採用後才寫進 form(避免 hallucination)
      </div>

      {aiField && (
        <AiSuggestionModal
          project={project}
          field={aiField.key}
          fieldLabel={aiField.label}
          onClose={() => setAiField(null)}
          onAccept={(value) => {
            setAiAccepted((prev) => ({ ...prev, [aiField.key]: value }))
            setAiField(null)
          }}
        />
      )}
      {showCleansheet && (
        <CleansheetPanel project={project} onClose={() => setShowCleansheet(false)} />
      )}
      {showWhatIf && (
        <WhatIfPanel project={project} onClose={() => setShowWhatIf(false)} />
      )}
    </div>
  )
}
