/**
 * Form Templates — 表單範本管理
 *
 * 對齊 HTML demo renderSchema() + PPT slide 21
 *
 * 3-pane designer(sections / fields / properties):
 *   左:6 sections(客戶資料 / 規格 / BOM / 成本 / 議價 / 結案)
 *   中:該 section 的 fields(欄位列表)
 *   右:選中 field 的屬性(機密策略矩陣)
 *
 * Sprint E.1:UI 完整,實際 form template CRUD 留 Sprint F
 */

import { useState } from 'react'
import { FileText, Lock, Sparkles, Plus, Eye, History, Rocket } from 'lucide-react'
import AdminPageShell, { type Scope } from './AdminPageShell'
import { useCrumbs } from '../Shell/PlatformContext'

type Field = {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select' | 'textarea'
  required: boolean
  confidential?: boolean
  strategy?: 'TIER' | 'ALIAS' | 'MASK' | 'RANGE'
  ai_hint?: string
}

type Section = {
  id: string
  name: string
  ico: string
  fields: Field[]
}

const QUOTE_FORM: Section[] = [
  {
    id: 'sec-customer', name: '客戶資料', ico: '👤',
    fields: [
      { key: 'customer_name', label: '客戶名稱', type: 'text', required: true, confidential: true, strategy: 'ALIAS', ai_hint: 'ERP 拉值' },
      { key: 'customer_code', label: '客戶代號', type: 'text', required: true },
      { key: 'contact_email', label: '聯絡 Email', type: 'text', required: false },
    ],
  },
  {
    id: 'sec-spec', name: '規格', ico: '📐',
    fields: [
      { key: 'part_no',  label: '料號', type: 'text', required: true },
      { key: 'quantity', label: '數量', type: 'number', required: true, confidential: true, strategy: 'RANGE' },
      { key: 'voltage',  label: '電壓', type: 'text', required: false },
      { key: 'rohs',     label: 'RoHS', type: 'select', required: false },
    ],
  },
  {
    id: 'sec-bom', name: 'BOM', ico: '📋',
    fields: [
      { key: 'bom_version', label: 'BOM 版本', type: 'text', required: true },
      { key: 'bom_cost',    label: 'BOM Cost', type: 'number', required: true, confidential: true, strategy: 'TIER', ai_hint: '#29 AI 拆解' },
      { key: 'lead_time',   label: 'Lead Time', type: 'number', required: true },
    ],
  },
  {
    id: 'sec-cost', name: '成本核算', ico: '💰',
    fields: [
      { key: 'amount',         label: '報價金額', type: 'number', required: true, confidential: true, strategy: 'TIER' },
      { key: 'margin',         label: '毛利率',   type: 'number', required: true, confidential: true, strategy: 'TIER' },
      { key: 'cost_breakdown', label: '成本明細', type: 'textarea', required: false, confidential: true, strategy: 'TIER' },
    ],
  },
  {
    id: 'sec-negotiation', name: '議價策略', ico: '🤝',
    fields: [
      { key: 'tactic',     label: '策略', type: 'select', required: true, confidential: true, strategy: 'MASK' },
      { key: 'concession', label: '可讓步幅度', type: 'number', required: false, confidential: true, strategy: 'TIER' },
    ],
  },
  {
    id: 'sec-close', name: '結案', ico: '✅',
    fields: [
      { key: 'win_loss', label: 'WIN/LOSS', type: 'select', required: true },
      { key: 'note',     label: '結案備註', type: 'textarea', required: false },
    ],
  },
]

const TYPE_TABS = [
  { key: 'QUOTE',    label: '$ 業務報價', count: '6 sections · 18 fields' },
  { key: 'IT',       label: '🖥 IT 維護',   count: '尚未配置' },
  { key: 'GENERAL',  label: '📌 通用',     count: '尚未配置' },
  { key: 'TRAINING', label: '🎓 教育訓練', count: '尚未配置' },
]

const STRATEGY_COLOR: Record<string, string> = {
  TIER:  'bg-cortex-amber-bg text-amber-800 border-amber-300',
  ALIAS: 'bg-cortex-red-bg text-red-700 border-red-300',
  MASK:  'bg-slate-200 text-slate-700 border-slate-300',
  RANGE: 'bg-cortex-ocean-bg text-cortex-ocean border-blue-300',
}

export default function FormTemplates() {
  useCrumbs([{ label: '管理' }, { label: '表單範本' }])
  const [scope, setScope] = useState<Scope>('SYSTEM')
  const [activeType, setActiveType] = useState('QUOTE')
  const [activeSection, setActiveSection] = useState(QUOTE_FORM[0].id)
  const [activeField, setActiveField] = useState<string | null>(null)

  const section = QUOTE_FORM.find((s) => s.id === activeSection)!
  const field = activeField ? section.fields.find((f) => f.key === activeField) : null

  return (
    <AdminPageShell
      title="表單範本管理"
      subtitle="GUI Form Builder · sections × fields × 機密策略矩陣"
      specLink={{ label: 'spec §11', href: '/docs/projects-platform-spec.md' }}
      scope={scope}
      onScope={setScope}
      scopeOwnerId="SYSTEM"
      actions={
        <>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-cortex-line bg-white rounded hover:bg-cortex-bg"><Eye size={12} /> 預覽實例化</button>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-cortex-line bg-white rounded hover:bg-cortex-bg"><History size={12} /> 版本歷史</button>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-cortex-cyan text-cortex-navy font-bold rounded hover:bg-[#04D9AC]"><Rocket size={12} /> 發布 v3</button>
        </>
      }
    >
      {/* Type tabs */}
      <div className="flex gap-2 border-b border-cortex-line">
        {TYPE_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveType(t.key)}
            className={`px-4 py-2 text-[13px] inline-flex items-center gap-2 border-b-2 transition ${
              activeType === t.key
                ? 'border-cortex-cyan text-cortex-teal font-semibold bg-white'
                : 'border-transparent text-cortex-muted hover:text-cortex-ink'
            }`}
          >
            {t.label}
            <span className="text-[9px] text-cortex-muted">{t.count}</span>
          </button>
        ))}
      </div>

      {activeType !== 'QUOTE' && (
        <div className="bg-white border border-cortex-line rounded-xl p-12 text-center">
          <FileText size={32} className="mx-auto opacity-30 mb-3" />
          <p className="text-base font-bold text-cortex-ink">{TYPE_TABS.find((t) => t.key === activeType)?.label} 表單範本尚未配置</p>
          <p className="text-[12px] text-cortex-muted mt-1.5 mb-3">本 project type 的標準表單尚未定義 · 可從 QUOTE 複製或從零建立</p>
          <div className="flex gap-2 justify-center">
            <button className="px-3 py-1.5 text-[12px] border border-cortex-line bg-white rounded">📋 從 QUOTE 範本複製</button>
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-cortex-cyan text-cortex-navy font-bold rounded">
              <Plus size={12} /> 從零建立
            </button>
          </div>
        </div>
      )}

      {/* 3-pane designer */}
      {activeType === 'QUOTE' && (
        <div className="bg-white border border-cortex-line rounded-xl overflow-hidden grid grid-cols-[200px_1fr_320px] divide-x divide-cortex-line min-h-[500px]">
          {/* Sections list */}
          <aside className="p-3 bg-cortex-line-2/30 overflow-y-auto">
            <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest px-1 mb-2">
              Sections ({QUOTE_FORM.length})
            </div>
            {QUOTE_FORM.map((s) => (
              <button
                key={s.id}
                onClick={() => { setActiveSection(s.id); setActiveField(null) }}
                className={`w-full text-left px-2.5 py-2 rounded mb-1 text-[12px] flex items-center gap-2 ${
                  activeSection === s.id ? 'bg-white text-cortex-teal font-bold shadow-cortex-sm' : 'text-cortex-text hover:bg-white/70'
                }`}
              >
                <span>{s.ico}</span>
                <span className="flex-1">{s.name}</span>
                <span className="text-[10px] text-cortex-muted">{s.fields.length}</span>
              </button>
            ))}
            <button className="w-full mt-2 px-2.5 py-1.5 text-[11px] text-cortex-muted hover:text-cortex-teal inline-flex items-center gap-1">
              <Plus size={11} /> 加 section
            </button>
          </aside>

          {/* Fields list */}
          <main className="p-4 overflow-y-auto">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-base font-bold text-cortex-ink">{section.ico} {section.name}</h3>
              <span className="text-[11px] text-cortex-muted">{section.fields.length} fields</span>
              <button className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-cortex-cyan text-cortex-navy font-bold rounded">
                <Plus size={11} /> 加 field
              </button>
            </div>

            <div className="space-y-1.5">
              {section.fields.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setActiveField(f.key)}
                  className={`w-full text-left bg-white border rounded p-2.5 transition ${
                    activeField === f.key ? 'border-cortex-cyan ring-1 ring-cortex-cyan/20' : 'border-cortex-line hover:border-cortex-cyan/50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[11px] text-cortex-ocean font-bold">{f.key}</span>
                    {f.required && <span className="text-[9px] bg-red-100 text-red-700 px-1 py-px rounded font-bold">REQ</span>}
                    {f.confidential && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border inline-flex items-center gap-0.5 ${STRATEGY_COLOR[f.strategy || 'TIER']}`}>
                        <Lock size={8} /> {f.strategy}
                      </span>
                    )}
                    {f.ai_hint && (
                      <span className="text-[9px] bg-cortex-cyan-bg text-cortex-teal px-1 py-px rounded font-bold inline-flex items-center gap-0.5">
                        <Sparkles size={8} /> {f.ai_hint}
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-cortex-ink">{f.label}</div>
                  <div className="text-[10px] text-cortex-muted mt-0.5">type: {f.type}</div>
                </button>
              ))}
            </div>
          </main>

          {/* Properties panel */}
          <aside className="p-4 bg-cortex-bg overflow-y-auto">
            {!field ? (
              <div className="text-center text-cortex-muted text-[12px] py-12">
                選擇欄位以編輯屬性
              </div>
            ) : (
              <FieldProps field={field} />
            )}
          </aside>
        </div>
      )}
    </AdminPageShell>
  )
}

function FieldProps({ field: f }: { field: Field }) {
  return (
    <div className="space-y-3 text-[12px]">
      <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">欄位屬性</div>

      <KV label="key" value={<span className="font-mono">{f.key}</span>} />
      <KV label="label" value={f.label} />
      <KV label="type" value={f.type} />
      <KV label="required" value={f.required ? '✓ 是' : '× 否'} />

      <div className="border-t border-cortex-line pt-3">
        <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest mb-2">機密策略</div>
        <div className="bg-white border border-cortex-line rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px]">標記為機密</span>
            <label className="inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked={!!f.confidential} className="w-9 h-5 appearance-none bg-slate-300 rounded-full relative cursor-pointer transition checked:bg-cortex-cyan
                before:content-[''] before:absolute before:w-4 before:h-4 before:bg-white before:rounded-full before:top-0.5 before:left-0.5 before:transition checked:before:translate-x-4" />
            </label>
          </div>
          <div>
            <div className="text-[10px] font-bold text-cortex-muted mb-1.5">顯示策略</div>
            <div className="grid grid-cols-2 gap-1.5">
              {(['TIER', 'ALIAS', 'MASK', 'RANGE'] as const).map((s) => (
                <button
                  key={s}
                  className={`px-2 py-1 text-[11px] font-bold rounded border ${
                    f.strategy === s
                      ? STRATEGY_COLOR[s]
                      : 'bg-cortex-line-2 text-cortex-muted border-cortex-line'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-cortex-muted mt-2 leading-relaxed">
              <strong>TIER</strong>:分級(Tier-A/M/L)· <strong>ALIAS</strong>:代號(A001)<br />
              <strong>MASK</strong>:打星(蘋果****)· <strong>RANGE</strong>:區間(100~500)
            </div>
          </div>
        </div>
      </div>

      {f.ai_hint && (
        <div className="bg-cortex-cyan-bg border-l-2 border-cortex-cyan rounded-r p-2.5">
          <div className="text-[10px] font-bold text-cortex-teal mb-0.5">
            <Sparkles size={10} className="inline -mt-px mr-0.5" /> AI 整合
          </div>
          <div className="text-[11px] text-cortex-text">{f.ai_hint}</div>
        </div>
      )}
    </div>
  )
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-cortex-muted">{label}</span>
      <span className="text-cortex-ink font-medium">{value}</span>
    </div>
  )
}
