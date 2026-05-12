/**
 * Notification Rules — 通知規則管理
 *
 * 對齊 HTML demo renderNotifications() + spec §14.9
 *
 * 5 通道(Webex DM / Webex 群組 / Email / 站內 Badge / Browser Push)
 * 8 規則 demo + Escalation chain
 *
 * Sprint E.1:UI 完整,實際 routing engine 留 Sprint F
 */

import { useState } from 'react'
import { MessageCircle, Users, Mail, BellRing, Globe, ChevronRight, Plus } from 'lucide-react'
import AdminPageShell, { type Scope } from './AdminPageShell'
import { useCrumbs } from '../Shell/PlatformContext'

const CHANNELS = [
  { key: 'webex_dm',     label: 'Webex DM',     Icon: MessageCircle, color: 'text-emerald-600 bg-emerald-50',    enabled: true,  count: 8 },
  { key: 'webex_group',  label: 'Webex 群組',   Icon: Users,         color: 'text-cyan-600 bg-cyan-50',           enabled: true,  count: 5 },
  { key: 'email',        label: 'Email',        Icon: Mail,          color: 'text-cortex-ocean bg-cortex-ocean-bg', enabled: true,  count: 3 },
  { key: 'in_app_badge', label: '站內 Badge',   Icon: BellRing,      color: 'text-amber-600 bg-amber-50',         enabled: true,  count: 8 },
  { key: 'browser_push', label: 'Browser Push', Icon: Globe,         color: 'text-purple-600 bg-purple-50',       enabled: false, count: 0 },
]

const RULES = [
  { code: 'TASK_OVERDUE',     name: '任務逾期',     scope: 'SYSTEM', trigger: 'task.computed_due_at < now AND status != DONE', target: 'A(accountable_role)', channels: ['webex_dm', 'in_app_badge', 'email'], enabled: true,  priority: 'HIGH' },
  { code: 'TASK_AT_70',       name: '任務 SLA 70%', scope: 'SYSTEM', trigger: 'task.now / sla > 0.7',                            target: 'R(primary_owner)',     channels: ['webex_dm', 'in_app_badge'],           enabled: true,  priority: 'NORMAL' },
  { code: 'DECISION_NEW',     name: '新決議',       scope: 'SYSTEM', trigger: 'message.type = DECISION',                          target: 'project members',      channels: ['in_app_badge', 'email'],              enabled: true,  priority: 'NORMAL' },
  { code: 'BLOCKER_NEW',      name: '新卡關',       scope: 'SYSTEM', trigger: 'message.type = BLOCKER OR task.status = BLOCKED', target: 'PM + 業務',           channels: ['webex_dm', 'in_app_badge', 'email'], enabled: true,  priority: 'HIGH' },
  { code: 'STAGE_GATE',       name: 'Stage Gate 觸發', scope: 'SYSTEM', trigger: 'stage.status = READY_FOR_GATE',                target: '業務(HOST) + 助理',   channels: ['webex_dm', 'in_app_badge'],           enabled: true,  priority: 'HIGH' },
  { code: 'PROJECT_PAUSED',   name: '專案暫停',     scope: 'SYSTEM', trigger: 'project.lifecycle = PAUSED',                       target: 'project members',      channels: ['in_app_badge'],                       enabled: true,  priority: 'LOW' },
  { code: 'CONF_FIELD_CHG',   name: '機密欄位變更', scope: 'SYSTEM', trigger: 'project.confidential_fields 異動',                  target: 'admin + super_user',   channels: ['email'],                              enabled: true,  priority: 'HIGH' },
  { code: 'SUMMARY_DAILY',    name: '⭐ Daily SUMMARY 09:00', scope: 'SYSTEM', trigger: 'cron 09:00 (project.lifecycle = ACTIVE)', target: '#announcement Pin', channels: ['in_app_badge'],                       enabled: true,  priority: 'NORMAL' },
]

const ESCALATIONS = [
  {
    name: 'Blocker 升級鏈',
    trigger: 'BLOCKER 持續 > 24h',
    steps: [
      { after: '24h',  to: 'A · accountable_role' },
      { after: '48h',  to: 'PM' },
      { after: '72h',  to: 'BU 主管 + 業務' },
      { after: '120h', to: 'HQ 主管' },
    ],
  },
  {
    name: '逾期升級鏈',
    trigger: 'task 逾期 > 8h',
    steps: [
      { after: '8h',  to: 'R + A' },
      { after: '24h', to: 'PM(全 channel @)' },
      { after: '48h', to: 'BU 主管' },
    ],
  },
]

const PRIORITY_COLOR: Record<string, string> = {
  HIGH:   'bg-cortex-red-bg text-red-700 border-red-300',
  NORMAL: 'bg-cortex-cyan-bg text-cortex-teal border-cortex-cyan/30',
  LOW:    'bg-cortex-line-2 text-cortex-muted border-cortex-line',
}

export default function NotificationRules() {
  useCrumbs([{ label: '管理' }, { label: '通知規則' }])
  const [scope, setScope] = useState<Scope>('SYSTEM')
  const [rules, setRules] = useState(RULES)

  const toggle = (code: string) => {
    setRules((rs) => rs.map((r) => r.code === code ? { ...r, enabled: !r.enabled } : r))
  }

  return (
    <AdminPageShell
      title="通知規則管理"
      subtitle="5 通道 × 8 規則 × 2 escalation chain"
      specLink={{ label: 'spec §14.9', href: '/docs/projects-platform-spec.md' }}
      scope={scope} onScope={setScope} scopeOwnerId="SYSTEM"
      actions={
        <>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-cortex-line bg-white rounded">📊 觸發歷史</button>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-cortex-cyan text-cortex-navy font-bold rounded"><Plus size={12} /> 新規則</button>
        </>
      }
    >
      {/* Channels grid */}
      <div className="bg-white border border-cortex-line rounded-xl p-4">
        <div className="text-[11px] font-bold text-cortex-muted uppercase tracking-widest mb-2.5">通知通道 ({CHANNELS.length})</div>
        <div className="grid grid-cols-5 gap-2.5">
          {CHANNELS.map((c) => {
            const Icon = c.Icon
            return (
              <div key={c.key} className={`border rounded-lg p-3 ${c.enabled ? 'border-cortex-line bg-white' : 'border-cortex-line bg-cortex-line-2/30 opacity-70'}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className={`w-8 h-8 rounded-md flex items-center justify-center ${c.color}`}>
                    <Icon size={14} />
                  </div>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.enabled ? 'bg-cortex-green-bg text-cortex-green' : 'bg-cortex-line-2 text-cortex-muted'}`}>
                    {c.enabled ? '啟用' : '停用'}
                  </span>
                </div>
                <div className="text-[12px] font-bold text-cortex-ink">{c.label}</div>
                <div className="text-[10px] text-cortex-muted mt-0.5">{c.count} 規則使用</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Rules table */}
      <div className="bg-white border border-cortex-line rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-cortex-line bg-cortex-bg flex items-center justify-between">
          <div className="text-[13px] font-bold text-cortex-ink">通知規則 ({rules.length})</div>
          <span className="text-[10px] text-cortex-muted">Scope: SYSTEM · BU/PROJECT_TYPE Phase 2</span>
        </div>
        <div className="divide-y divide-cortex-line">
          <div className="grid grid-cols-[110px_1fr_1fr_2fr_140px_70px_60px] gap-3 px-4 py-2 bg-cortex-line-2/30 text-[10px] font-bold text-cortex-muted uppercase tracking-widest">
            <div>Code</div>
            <div>名稱</div>
            <div>對象</div>
            <div>觸發條件</div>
            <div>通道</div>
            <div>優先</div>
            <div className="text-center">啟用</div>
          </div>
          {rules.map((r) => (
            <div key={r.code} className="grid grid-cols-[110px_1fr_1fr_2fr_140px_70px_60px] gap-3 px-4 py-2.5 items-center text-[11px] hover:bg-cortex-bg">
              <span className="font-mono text-cortex-ocean font-bold text-[10px]">{r.code}</span>
              <span className="text-cortex-ink font-semibold">{r.name}</span>
              <span className="text-cortex-text">{r.target}</span>
              <span className="text-cortex-muted text-[10px] font-mono">{r.trigger}</span>
              <div className="flex flex-wrap gap-1">
                {r.channels.map((ch) => {
                  const c = CHANNELS.find((cc) => cc.key === ch)
                  if (!c) return null
                  const Icon = c.Icon
                  return (
                    <span key={ch} className={`inline-flex items-center justify-center w-6 h-6 rounded ${c.color}`} title={c.label}>
                      <Icon size={11} />
                    </span>
                  )
                })}
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border text-center ${PRIORITY_COLOR[r.priority]}`}>{r.priority}</span>
              <div className="text-center">
                <label className="inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={() => toggle(r.code)}
                    className="w-8 h-4 appearance-none bg-slate-300 rounded-full relative cursor-pointer transition checked:bg-cortex-cyan
                      before:content-[''] before:absolute before:w-3 before:h-3 before:bg-white before:rounded-full before:top-0.5 before:left-0.5 before:transition checked:before:translate-x-4"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Escalation chains */}
      <div className="bg-white border border-cortex-line rounded-xl p-4">
        <div className="text-[11px] font-bold text-cortex-muted uppercase tracking-widest mb-3">Escalation Chain · 升級鏈</div>
        <div className="space-y-3">
          {ESCALATIONS.map((esc) => (
            <div key={esc.name} className="bg-gradient-to-r from-cortex-amber-bg/40 to-white border border-amber-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-[13px] font-bold text-amber-900">{esc.name}</span>
                <span className="text-[10px] text-amber-800 bg-cortex-amber-bg px-2 py-0.5 rounded font-mono">{esc.trigger}</span>
              </div>
              <div className="flex items-center gap-1 flex-wrap text-[11px]">
                {esc.steps.map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    <span className="bg-white border border-amber-300 rounded px-2 py-1">
                      <span className="font-mono text-amber-700 font-bold">{s.after}</span>
                      <span className="text-cortex-text"> → </span>
                      <span className="text-cortex-ink">{s.to}</span>
                    </span>
                    {i < esc.steps.length - 1 && <ChevronRight size={12} className="text-amber-500" />}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminPageShell>
  )
}
