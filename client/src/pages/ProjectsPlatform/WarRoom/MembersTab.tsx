/**
 * MembersTab — Multi-PM Team 分組視覺化
 *
 * 對齊 PPT slide 15 + Demo 手冊 §10 + Wizard Step 4
 *
 * 分組:
 *   業務 HOST(sales / sales_assistant)
 *   DPM Team(invited_by_pm_user_id = DPM_id)
 *   BPM Team
 *   MPM Team
 *   EPM
 *   採購跨 team(role = 'sourcing'/'procurement')
 *
 * 後端:project.members 已 ready(role + sub_role + invited_by_pm_user_id)
 * Sprint A 砸 data_payload 進的 pms 結構(從 Wizard)— 此處讀來建分組
 */

import { Crown, ShieldCheck, Wrench, Factory, Building2, ShoppingCart } from 'lucide-react'
import type { ProjectDetail, Member } from '../api'

type TeamGroup = {
  key: string
  label: string
  Icon: any
  color: string  // text color
  bg: string     // bg color
  members: Member[]
}

export default function MembersTab({ project }: { project: ProjectDetail }) {
  // 從 data_payload.pms 拿 wizard 填的 PM 名字(若無則顯示「待邀」)
  const pms = (project.data_payload as any)?.pms || {}

  const groups: TeamGroup[] = [
    {
      key: 'host',
      label: '業務 HOST',
      Icon: Crown,
      color: 'text-red-700',
      bg: 'bg-red-50 border-red-200',
      members: project.members.filter((m) => m.role === 'PM' || m.role === 'sales' || m.role === 'observer'),
    },
    {
      key: 'dpm',
      label: 'DPM Team(Design)',
      Icon: Wrench,
      color: 'text-purple-700',
      bg: 'bg-purple-50 border-purple-200',
      members: project.members.filter((m) => m.sub_role === 'DPM' || m.role === 'engineering'),
    },
    {
      key: 'bpm',
      label: 'BPM Team(Business)',
      Icon: Building2,
      color: 'text-cortex-ocean',
      bg: 'bg-cortex-ocean-bg border-blue-200',
      members: project.members.filter((m) => m.sub_role === 'BPM'),
    },
    {
      key: 'mpm',
      label: 'MPM Team(Manufacturing)',
      Icon: Factory,
      color: 'text-cortex-teal',
      bg: 'bg-cortex-cyan-bg border-cortex-cyan/30',
      members: project.members.filter((m) => m.sub_role === 'MPM' || m.role === 'factory'),
    },
    {
      key: 'epm',
      label: 'EPM(NPI Engineering)',
      Icon: ShieldCheck,
      color: 'text-cortex-green',
      bg: 'bg-cortex-green-bg border-cortex-green/30',
      members: project.members.filter((m) => m.sub_role === 'EPM'),
    },
    {
      key: 'sourcing',
      label: '採購跨 team',
      Icon: ShoppingCart,
      color: 'text-amber-700',
      bg: 'bg-cortex-amber-bg border-amber-300',
      members: project.members.filter((m) => m.role === 'sourcing' || m.role === 'procurement'),
    },
  ]

  // 沒分到 group 的丟到 misc
  const grouped = new Set(groups.flatMap((g) => g.members.map((m) => m.id)))
  const misc = project.members.filter((m) => !grouped.has(m.id))
  if (misc.length > 0) {
    groups.push({
      key: 'misc', label: '其他成員', Icon: Crown, color: 'text-cortex-muted', bg: 'bg-cortex-line-2 border-cortex-line', members: misc,
    })
  }

  return (
    <div className="p-5 max-w-[920px] mx-auto">
      <h3 className="text-lg font-bold text-cortex-ink mb-1">
        成員 ({project.members.length})
        <span className="ml-2 text-[11px] font-normal text-cortex-muted">Multi-PM Team 模型</span>
      </h3>
      <p className="text-[12px] text-cortex-muted mb-5">
        對齊 OIBG flow:業務 HOST + 4 種 PM 各帶自己 team(invited_by_pm_user_id 自然涌現)
      </p>

      {/* Wizard 填的 PM 預覽 */}
      {(pms.dpm || pms.bpm || pms.mpm || pms.epm) && (
        <div className="bg-gradient-to-br from-cortex-cyan-bg/50 to-white border border-cortex-cyan/30 rounded-lg p-4 mb-5">
          <div className="text-[10px] font-bold text-cortex-teal uppercase tracking-widest mb-2">
            ⭐ Wizard 指派的 PM 三劍客
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-[12px]">
            <PmCard sub="DPM" name={pms.dpm} role="Design" />
            <PmCard sub="BPM" name={pms.bpm} role="Business" />
            <PmCard sub="MPM" name={pms.mpm} role="Manufacturing" />
            <PmCard sub="EPM" name={pms.epm} role="NPI Eng." />
          </div>
        </div>
      )}

      {/* Team groups */}
      <div className="space-y-4">
        {groups.filter((g) => g.members.length > 0).map((g) => {
          const Icon = g.Icon
          return (
            <div key={g.key} className={`border rounded-lg p-3.5 ${g.bg}`}>
              <div className={`text-[11px] font-bold uppercase tracking-widest mb-2.5 flex items-center gap-1.5 ${g.color}`}>
                <Icon size={13} />
                {g.label} ({g.members.length})
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {g.members.map((m) => (
                  <div key={m.id} className="bg-white border border-cortex-line/60 rounded p-2.5 text-[12px] flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-cyan-400 text-white text-[12px] font-bold flex items-center justify-center shrink-0">
                      {String(m.user_id).slice(-2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-cortex-ink truncate">user#{m.user_id}</div>
                      <div className="text-[10px] text-cortex-muted">
                        {m.role}{m.sub_role && ` · ${m.sub_role}`}
                      </div>
                    </div>
                    {m.invited_by_pm_user_id && (
                      <span className="text-[9px] text-cortex-muted">
                        ← {m.invited_by_pm_user_id}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-5 text-[11px] text-cortex-muted bg-cortex-bg border border-cortex-line rounded p-3">
        💡 <strong>邀請邏輯</strong>:DPM 邀 EE/ME/RD;MPM 邀 SMT/EPM/工廠採購;BPM 帶客戶窗口。<br />
        Sprint E 上「邀請成員」UI;目前 demo 只顯示 backend 已 seed 的成員。
      </div>
    </div>
  )
}

function PmCard({ sub, name, role }: { sub: string; name?: string; role: string }) {
  const filled = !!name
  return (
    <div className={`rounded-md p-2.5 border ${filled ? 'bg-white border-cortex-line' : 'bg-cortex-line-2/40 border-dashed border-cortex-line'}`}>
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[9px] font-bold text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded">{sub}</span>
        <span className="text-[10px] text-cortex-muted">{role}</span>
      </div>
      <div className={`text-[12px] font-semibold mt-1 ${filled ? 'text-cortex-ink' : 'text-cortex-muted italic'}`}>
        {name || '(待邀)'}
      </div>
    </div>
  )
}
