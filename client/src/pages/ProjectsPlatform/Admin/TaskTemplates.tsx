/**
 * Task Templates — EPIC × SUBTASK 標準作業流程
 *
 * 對齊 HTML demo renderTaskTemplates() + spec §14.3
 *
 * QUOTE 預設 6 EPIC × 24 SUBTASK
 * 開案套用後自動建立 task instances(走 dependency-based deadline)
 */

import { useState } from 'react'
import { ListTodo, AlertTriangle, ChevronDown, ChevronRight, Plus, Eye, Rocket, GitBranch } from 'lucide-react'
import AdminPageShell, { type Scope } from './AdminPageShell'
import { useCrumbs } from '../Shell/PlatformContext'

type Subtask = {
  id: string
  title: string
  sla_hours: number
  owner_role: string
  responsible_role: string  // R
  depends_on?: string
  dep_delay?: string   // "+1d" 等
  critical?: boolean
  confidential?: boolean
}

type Epic = {
  id: string
  title: string
  icon: string
  sla_days: number
  owner_role: string  // A
  related_section?: string  // form.section
  critical?: boolean
  confidential?: boolean
  subtasks: Subtask[]
}

const QUOTE_EPICS: Epic[] = [
  {
    id: 'epic-inquiry', title: '收 RFQ + 詢價', icon: '📥', sla_days: 1, owner_role: 'sales',
    related_section: 'sec-customer', critical: true,
    subtasks: [
      { id: 'sub-rfq-recv',    title: '接收 RFQ PDF',     sla_hours: 1,  owner_role: 'sales',  responsible_role: 'sales',  critical: true },
      { id: 'sub-rfq-parse',   title: 'AI 解析 + 預填',   sla_hours: 0.1, owner_role: 'system', responsible_role: 'system' },
      { id: 'sub-qa-draft',    title: 'Q&A 清單建立',     sla_hours: 4,  owner_role: 'DPM',    responsible_role: 'DPM',     depends_on: 'sub-rfq-parse', dep_delay: '+0' },
      { id: 'sub-customer-qa', title: '送客戶 Q&A',       sla_hours: 8,  owner_role: 'BPM',    responsible_role: 'BPM',     depends_on: 'sub-qa-draft',  dep_delay: '+1d' },
    ],
  },
  {
    id: 'epic-bom', title: 'BOM 設計 + 詢價', icon: '📋', sla_days: 3, owner_role: 'DPM',
    related_section: 'sec-bom',
    subtasks: [
      { id: 'sub-ee-bom',  title: 'EE BOM',     sla_hours: 24, owner_role: 'DPM', responsible_role: 'EE',  depends_on: 'sub-customer-qa', dep_delay: '+3d' },
      { id: 'sub-me-bom',  title: 'ME BOM',     sla_hours: 24, owner_role: 'DPM', responsible_role: 'ME',  depends_on: 'sub-customer-qa', dep_delay: '+3d' },
      { id: 'sub-pkg',     title: 'PKG 詢價',   sla_hours: 48, owner_role: 'MPM', responsible_role: '塑件廠商' },
      { id: 'sub-bom-cost',title: 'BOM Cost 整合', sla_hours: 12, owner_role: 'DPM', responsible_role: '台北採購', depends_on: 'sub-ee-bom', dep_delay: '+3d' },
    ],
  },
  {
    id: 'epic-parallel', title: '並行 Collect', icon: '⚡', sla_days: 5, owner_role: 'MPM',
    subtasks: [
      { id: 'sub-cleansheet', title: 'Cleansheet 三廠版', sla_hours: 48, owner_role: 'MPM', responsible_role: '工廠採購', depends_on: 'sub-bom-cost', dep_delay: '+1d' },
      { id: 'sub-nre-tool',   title: 'NRE - ME Tooling', sla_hours: 48, owner_role: 'DPM', responsible_role: '塑件 PM' },
      { id: 'sub-emi-cert',   title: 'EMI 認證',         sla_hours: 24, owner_role: 'EPM', responsible_role: 'EPM' },
    ],
  },
  {
    id: 'epic-cost-review', title: 'BOM Cost Review', icon: '⚖', sla_days: 1, owner_role: 'DPM',
    related_section: 'sec-cost', confidential: true,
    subtasks: [
      { id: 'sub-internal-review', title: 'Internal BOM Review', sla_hours: 6, owner_role: 'DPM', responsible_role: 'DPM', depends_on: 'sub-bom-cost', dep_delay: '+1d', confidential: true },
      { id: 'sub-cs-vp',           title: 'Cleansheet → VP', sla_hours: 4, owner_role: 'MPM', responsible_role: 'MPM', depends_on: 'sub-bom-cost', dep_delay: '+1d' },
    ],
  },
  {
    id: 'epic-rfq-review', title: 'RFQ Cost Review', icon: '💰', sla_days: 1, owner_role: 'DPM', confidential: true,
    subtasks: [
      { id: 'sub-true-cost',  title: 'True cost / Profit 計算', sla_hours: 4, owner_role: 'DPM', responsible_role: '財務', confidential: true },
      { id: 'sub-strategy',   title: '議價策略', sla_hours: 4, owner_role: 'BPM', responsible_role: 'BPM', confidential: true },
      { id: 'sub-quote-draft',title: '報價 Excel 草稿', sla_hours: 4, owner_role: 'BPM', responsible_role: 'BPM', depends_on: 'sub-bom-cost', dep_delay: '+2d' },
    ],
  },
  {
    id: 'epic-submit', title: 'Submit Final Quote', icon: '🚀', sla_days: 0.5, owner_role: 'BPM',
    subtasks: [
      { id: 'sub-final-review', title: 'Sales + BPM 共審', sla_hours: 2, owner_role: 'sales', responsible_role: 'sales' },
      { id: 'sub-send-customer',title: '寄出客戶 (Excel + Email)', sla_hours: 1, owner_role: 'BPM', responsible_role: 'BPM' },
    ],
  },
]

const TYPE_TABS = [
  { key: 'QUOTE',    label: '$ 業務報價', count: '6 EPIC · 24 SUB' },
  { key: 'IT',       label: '🖥 IT 維護', count: '尚未' },
  { key: 'GENERAL',  label: '📌 通用',   count: '尚未' },
  { key: 'TRAINING', label: '🎓 教育訓練', count: '尚未' },
]

function fmtSla(hours: number): string {
  if (hours >= 24) return `${(hours / 24).toFixed(hours % 24 === 0 ? 0 : 1)}d`
  if (hours < 1) return `${Math.round(hours * 60)}m`
  return `${hours}h`
}

export default function TaskTemplates() {
  useCrumbs([{ label: '管理' }, { label: '任務模板' }])
  const [scope, setScope] = useState<Scope>('SYSTEM')
  const [activeType, setActiveType] = useState('QUOTE')
  const [activeEpic, setActiveEpic] = useState<string>(QUOTE_EPICS[0].id)
  const [activeSub, setActiveSub] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const totalEpics = QUOTE_EPICS.length
  const totalSubs = QUOTE_EPICS.reduce((a, e) => a + e.subtasks.length, 0)
  const totalHours = QUOTE_EPICS.reduce((a, e) => a + e.subtasks.reduce((b, s) => b + s.sla_hours, 0), 0)

  const epic = QUOTE_EPICS.find((e) => e.id === activeEpic) || QUOTE_EPICS[0]
  const sub = activeSub ? epic.subtasks.find((s) => s.id === activeSub) : null

  const toggleEpic = (id: string) => {
    setCollapsed((c) => {
      const n = new Set(c)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  return (
    <AdminPageShell
      title="任務模板管理"
      subtitle={`定義 EPIC × SUBTASK 標準作業流程 · 開案套用後自動建立 task instances · 走 dependency-based deadline`}
      specLink={{ label: 'spec §14.3', href: '/docs/projects-platform-spec.md' }}
      scope={scope} onScope={setScope} scopeOwnerId="SYSTEM"
      actions={
        <>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-cortex-line bg-white rounded"><GitBranch size={12} /> 依賴關係圖</button>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-cortex-line bg-white rounded"><Eye size={12} /> 預覽實例化</button>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-cortex-cyan text-cortex-navy font-bold rounded"><Rocket size={12} /> 發布 v2</button>
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
          <ListTodo size={32} className="mx-auto opacity-30 mb-3" />
          <p className="text-base font-bold text-cortex-ink">{TYPE_TABS.find((t) => t.key === activeType)?.label} 任務模板尚未配置</p>
          <p className="text-[12px] text-cortex-muted mt-1.5">本 project type 尚未定義 EPIC × SUBTASK · 可從 QUOTE 複製</p>
        </div>
      )}

      {activeType === 'QUOTE' && (
        <div className="bg-white border border-cortex-line rounded-xl overflow-hidden grid grid-cols-[1fr_360px] divide-x divide-cortex-line min-h-[500px]">
          {/* EPIC tree */}
          <div className="overflow-y-auto">
            <div className="px-4 py-3 border-b border-cortex-line bg-cortex-line-2/30 flex items-center justify-between">
              <div>
                <div className="font-bold text-cortex-ink text-[14px]">📋 QUOTE · 標準工作流程</div>
                <div className="text-[11px] text-cortex-muted mt-0.5">{totalEpics} EPIC · {totalSubs} SUBTASK · 總 SLA ≈ {fmtSla(totalHours)}(含並行)</div>
              </div>
              <button className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-cortex-cyan text-cortex-navy font-bold rounded">
                <Plus size={11} /> 加 EPIC
              </button>
            </div>

            <div className="p-3">
              {QUOTE_EPICS.map((e) => {
                const isCollapsed = collapsed.has(e.id)
                const isActive = activeEpic === e.id && !activeSub
                return (
                  <div key={e.id} className={`mb-2 rounded border ${e.critical ? 'border-red-300' : 'border-cortex-line'} ${isActive ? 'ring-1 ring-cortex-cyan' : ''}`}>
                    <button
                      onClick={() => { setActiveEpic(e.id); setActiveSub(null) }}
                      className={`w-full p-2.5 flex items-center gap-2 ${e.critical ? 'bg-red-50' : 'bg-white'} hover:brightness-95 rounded-t`}
                    >
                      <button onClick={(ev) => { ev.stopPropagation(); toggleEpic(e.id) }} className="text-cortex-muted">
                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <span className="text-base">{e.icon}</span>
                      <div className="flex-1 text-left">
                        <div className="text-[13px] font-bold text-cortex-ink flex items-center gap-1.5">
                          {e.title}
                          {e.critical && <span className="text-[9px] bg-cortex-red-bg text-red-700 px-1.5 py-px rounded font-bold">CRITICAL</span>}
                          {e.confidential && <span className="text-[11px]">🔒</span>}
                        </div>
                        <div className="text-[10px] text-cortex-muted font-mono">{e.id} → {e.related_section ? `form.${e.related_section}` : '—'}</div>
                      </div>
                      <span className="text-[11px] font-mono text-cortex-muted">{e.sla_days}d</span>
                      <span className="text-[10px] font-bold text-cortex-teal bg-cortex-cyan-bg px-1.5 py-0.5 rounded border border-cortex-cyan/30">{e.owner_role}</span>
                      <span className="text-[10px] text-cortex-muted">{e.subtasks.length} sub</span>
                    </button>
                    {!isCollapsed && (
                      <div className="border-t border-cortex-line bg-cortex-bg/50">
                        {e.subtasks.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => { setActiveEpic(e.id); setActiveSub(s.id) }}
                            className={`w-full grid grid-cols-[1fr_60px_50px_50px_120px] gap-2 px-3 py-1.5 items-center text-[11px] text-left hover:bg-white transition ${
                              activeSub === s.id ? 'bg-white ring-1 ring-cortex-cyan' : ''
                            }`}
                          >
                            <div className="text-cortex-ink flex items-center gap-1.5">
                              <span className="text-cortex-muted">└</span>
                              {s.title}
                              {s.critical && <AlertTriangle size={9} className="text-red-600" />}
                              {s.confidential && <span>🔒</span>}
                            </div>
                            <span className="font-mono text-cortex-muted">{fmtSla(s.sla_hours)}</span>
                            <span className="text-[9px] bg-red-100 text-red-700 px-1 py-px rounded font-bold text-center">A·{s.owner_role}</span>
                            <span className="text-[9px] bg-blue-100 text-blue-700 px-1 py-px rounded font-bold text-center">R·{s.responsible_role}</span>
                            <span className="text-[9px] text-cortex-muted text-right truncate">
                              {s.depends_on ? `⏰ ${s.depends_on.slice(4)} ${s.dep_delay}` : ''}
                            </span>
                          </button>
                        ))}
                        <button className="w-full px-3 py-1.5 text-[10px] text-cortex-muted hover:text-cortex-teal text-left">
                          <Plus size={10} className="inline -mt-px mr-1" /> 加 SUBTASK 到此 EPIC
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Properties panel */}
          <aside className="p-4 bg-cortex-bg overflow-y-auto">
            {sub ? <SubtaskProps sub={sub} /> : <EpicProps epic={epic} />}
          </aside>
        </div>
      )}
    </AdminPageShell>
  )
}

function EpicProps({ epic: e }: { epic: Epic }) {
  return (
    <div className="space-y-3 text-[12px]">
      <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">EPIC 屬性</div>
      <KV label="ID" value={<span className="font-mono">{e.id}</span>} />
      <KV label="名稱" value={e.title} />
      <KV label="SLA" value={`${e.sla_days} 天`} />
      <KV label="A · Accountable" value={<span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">{e.owner_role}</span>} />
      <KV label="關聯 section" value={e.related_section || '—'} />
      <KV label="SUBTASK 數" value={e.subtasks.length} />
      {e.critical && (
        <div className="bg-cortex-red-bg border-l-2 border-cortex-red rounded-r p-2.5">
          <div className="text-[10px] font-bold text-red-700 mb-0.5">CRITICAL EPIC</div>
          <div className="text-[11px] text-red-700">此 EPIC delay 直接影響後續所有 dependency · escalation chain 優先觸發</div>
        </div>
      )}
    </div>
  )
}

function SubtaskProps({ sub: s }: { sub: Subtask }) {
  return (
    <div className="space-y-3 text-[12px]">
      <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">SUBTASK 屬性</div>
      <KV label="ID" value={<span className="font-mono">{s.id}</span>} />
      <KV label="名稱" value={s.title} />
      <KV label="SLA" value={fmtSla(s.sla_hours)} />
      <KV label="A · Accountable" value={<span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">{s.owner_role}</span>} />
      <KV label="R · Responsible" value={<span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">{s.responsible_role}</span>} />
      {s.depends_on && (
        <div className="bg-cortex-bg border border-cortex-line rounded p-2.5">
          <div className="text-[10px] font-bold text-cortex-muted mb-1">⏰ Dependency</div>
          <div className="text-[11px] text-cortex-ink">
            依賴 <span className="font-mono">{s.depends_on}</span> 完成 + <strong>{s.dep_delay}</strong>
          </div>
        </div>
      )}
      {s.confidential && (
        <div className="bg-cortex-amber-bg border-l-2 border-cortex-amber rounded-r p-2.5">
          <div className="text-[10px] font-bold text-amber-800 mb-0.5">🔒 機密 SUBTASK</div>
          <div className="text-[11px] text-amber-800">執行 / 完成資訊走 confidentialityMiddleware</div>
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
