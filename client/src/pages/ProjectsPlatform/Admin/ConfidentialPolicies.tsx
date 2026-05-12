/**
 * Confidential Policies — 機密欄位 4 種顯示策略
 *
 * 對齊 PPT slide 17 + Demo 手冊 §8 + spec §12
 *
 * 4 策略:
 *   TIER  — 分級(Tier-A/M/L)
 *   ALIAS — 代號(A001)
 *   MASK  — 打星(蘋果****)
 *   RANGE — 區間(100~500)
 *
 * Sprint E.1:UI explainer + 6 角色 demo;真實 displayStrategy middleware 留 Sprint E.2 / F
 */

import { useState } from 'react'
import { ShieldCheck, Eye, EyeOff, Layers, Hash, Sparkles } from 'lucide-react'
import AdminPageShell from './AdminPageShell'
import { useCrumbs, usePlatform } from '../Shell/PlatformContext'
import { DEMO_ROLES, type DemoRole } from '../tokens'

type Strategy = 'TIER' | 'ALIAS' | 'MASK' | 'RANGE'

const STRATEGIES: { key: Strategy; label: string; desc: string; example: string; useCase: string; color: string }[] = [
  {
    key: 'TIER',
    label: '分級(TIER)',
    desc: '把數值對應到分級代碼 — A/M/L 或 1/2/3',
    example: '$2,143 → Tier-A',
    useCase: '報價金額 / 毛利率 / 成本明細',
    color: 'bg-cortex-amber-bg border-amber-300 text-amber-800',
  },
  {
    key: 'ALIAS',
    label: '代號(ALIAS)',
    desc: '把名稱替換為內部代號',
    example: 'Apple Inc. → A001',
    useCase: '客戶名稱 / 供應商',
    color: 'bg-cortex-red-bg border-red-300 text-red-700',
  },
  {
    key: 'MASK',
    label: '打星(MASK)',
    desc: '字串部分隱藏,保留首尾',
    example: '蘋果連接器 → 蘋果****',
    useCase: '專案名 / 議價策略文字',
    color: 'bg-slate-200 border-slate-300 text-slate-700',
  },
  {
    key: 'RANGE',
    label: '區間(RANGE)',
    desc: '數值轉成區間範圍',
    example: '15,000 → 10K~20K',
    useCase: '數量 / 工時 / 預估值',
    color: 'bg-cortex-ocean-bg border-blue-300 text-cortex-ocean',
  },
]

const SAMPLE_PROJECT = {
  customer_name: 'Apple Inc.',
  customer_code: 'A001',
  amount:        182500,
  margin:        0.166,
  cost_breakdown: 'EE 35% / ME 28% / 採購 22% / 製造 15%',
  quantity:      100000,
  due_date:      '2026-08-15',
}

const FIELD_POLICIES: { key: string; label: string; strategy: Strategy | 'NONE' }[] = [
  { key: 'customer_name',  label: '客戶名稱', strategy: 'ALIAS' },
  { key: 'amount',         label: '報價金額', strategy: 'TIER' },
  { key: 'margin',         label: '毛利率',   strategy: 'TIER' },
  { key: 'cost_breakdown', label: '成本明細', strategy: 'MASK' },
  { key: 'quantity',       label: '數量',     strategy: 'RANGE' },
  { key: 'due_date',       label: '交期',     strategy: 'NONE' },
]

function applyStrategy(value: any, strategy: Strategy | 'NONE'): { val: string; kind: 'plain' | 'tier' | 'alias' | 'mask' | 'range' } {
  if (strategy === 'NONE') return { val: String(value), kind: 'plain' }
  if (strategy === 'TIER') {
    if (typeof value === 'number') {
      if (value >= 100000) return { val: 'Tier-A', kind: 'tier' }
      if (value >= 10000)  return { val: 'Tier-M', kind: 'tier' }
      return { val: 'Tier-L', kind: 'tier' }
    }
    if (typeof value === 'number' && value < 1) {
      // margin
      return { val: value >= 0.2 ? 'Tier-H' : value >= 0.1 ? 'Tier-M' : 'Tier-L', kind: 'tier' }
    }
    return { val: 'Tier-?', kind: 'tier' }
  }
  if (strategy === 'ALIAS') return { val: 'A001', kind: 'alias' }
  if (strategy === 'MASK') {
    const s = String(value)
    return { val: s.slice(0, 2) + '****', kind: 'mask' }
  }
  if (strategy === 'RANGE') {
    if (typeof value === 'number') {
      if (value >= 100000) return { val: '100K~500K', kind: 'range' }
      if (value >= 10000)  return { val: '10K~100K', kind: 'range' }
      return { val: '<10K', kind: 'range' }
    }
    return { val: '—~—', kind: 'range' }
  }
  return { val: String(value), kind: 'plain' }
}

/** Role → 看欄位的權限(對齊 demo 手冊 §10)*/
function getRoleAccess(role: DemoRole, fieldKey: string): { strategy: Strategy | 'NONE' | 'BLOCKED' } {
  // HOST / OBSERVER / SUPER:全明文
  if (role === 'HOST' || role === 'OBSERVER' || role === 'SUPER_PARTICIPANT') {
    return { strategy: 'NONE' }
  }
  // OUTSIDER:全擋
  if (role === 'OUTSIDER') {
    return { strategy: 'BLOCKED' }
  }
  // CHAT_GUEST:form 全擋
  if (role === 'CHAT_GUEST') {
    return { strategy: 'BLOCKED' }
  }
  // PARTICIPANT:走 displayStrategy
  const policy = FIELD_POLICIES.find((p) => p.key === fieldKey)
  return { strategy: policy?.strategy || 'NONE' }
}

export default function ConfidentialPolicies() {
  useCrumbs([{ label: '管理' }, { label: '機密策略' }])
  const { demoRole, setDemoRole } = usePlatform()

  return (
    <AdminPageShell
      title="機密欄位策略管理"
      subtitle="4 種顯示策略 + 6 角色 displayStrategy 套用 demo"
      specLink={{ label: 'spec §12', href: '/docs/projects-platform-spec.md' }}
      actions={
        <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-cortex-line bg-white rounded">📋 套用 audit log</button>
      }
    >
      {/* 4 策略 explainer */}
      <div>
        <div className="text-[11px] font-bold text-cortex-muted uppercase tracking-widest mb-2.5">4 顯示策略</div>
        <div className="grid grid-cols-4 gap-3">
          {STRATEGIES.map((s) => (
            <div key={s.key} className="bg-white border border-cortex-line rounded-xl p-3.5">
              <div className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded border mb-2 ${s.color}`}>
                {s.label}
              </div>
              <div className="text-[11px] text-cortex-text mb-2 leading-relaxed">{s.desc}</div>
              <div className="bg-cortex-bg border border-cortex-line rounded px-2.5 py-2 text-[11px] font-mono mb-2">
                {s.example}
              </div>
              <div className="text-[10px] text-cortex-muted">適用:{s.useCase}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Role demo */}
      <div className="bg-gradient-to-br from-cortex-navy/90 to-cortex-teal/90 text-white rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} className="text-cortex-cyan" />
          <span className="text-[11px] font-bold text-cortex-cyan tracking-widest">⭐ 6 角色 displayStrategy DEMO</span>
          <span className="text-[10px] text-cortex-cyan-bg/60 ml-auto">切換右上角「視角」dropdown 即時看效果</span>
        </div>

        {/* Current role pill */}
        <div className="bg-white/10 border border-white/20 rounded-lg p-3 mb-3 flex items-center gap-3">
          <span className="text-[10px] font-bold text-cortex-cyan tracking-widest">當前視角</span>
          <div className="flex flex-wrap gap-1.5">
            {DEMO_ROLES.map((r) => (
              <button
                key={r.key}
                onClick={() => setDemoRole(r.key as DemoRole)}
                className={`text-[11px] px-2.5 py-1 rounded transition ${
                  demoRole === r.key
                    ? 'bg-cortex-cyan text-cortex-navy font-bold'
                    : 'bg-white/10 text-cortex-cyan-bg hover:bg-white/20'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-cortex-cyan-bg mb-2.5">
          範例專案:Apple AirPods 連接器 (QT-2026-0143) · is_confidential=ON · 3 機密欄位
        </div>

        <div className="bg-white rounded-lg p-3.5 text-cortex-text">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-cortex-line text-cortex-muted text-[10px] uppercase tracking-widest">
                <th className="text-left py-2">欄位</th>
                <th className="text-left py-2">原值</th>
                <th className="text-left py-2">策略</th>
                <th className="text-left py-2">你看到的(視角 {demoRole})</th>
              </tr>
            </thead>
            <tbody>
              {FIELD_POLICIES.map((p) => {
                const access = getRoleAccess(demoRole, p.key)
                const orig = (SAMPLE_PROJECT as any)[p.key]
                const result =
                  access.strategy === 'BLOCKED'
                    ? { val: '🔒 403 無權限', kind: 'blocked' as const }
                    : access.strategy === 'NONE'
                    ? { val: String(orig), kind: 'plain' as const }
                    : applyStrategy(orig, access.strategy)

                const valColor =
                  result.kind === 'blocked' ? 'text-red-600 italic' :
                  result.kind === 'plain'   ? 'text-cortex-ink' :
                  result.kind === 'tier'    ? 'text-amber-800 bg-cortex-amber-bg' :
                  result.kind === 'alias'   ? 'text-red-700 bg-cortex-red-bg' :
                  result.kind === 'mask'    ? 'text-slate-700 bg-slate-200' :
                  result.kind === 'range'   ? 'text-cortex-ocean bg-cortex-ocean-bg' :
                  'text-cortex-ink'

                return (
                  <tr key={p.key} className="border-b border-cortex-line last:border-b-0">
                    <td className="py-2 font-mono text-[11px]">{p.key}</td>
                    <td className="py-2 text-cortex-muted">{String(orig)}</td>
                    <td className="py-2">
                      <span className="text-[10px] font-bold bg-cortex-line-2 text-cortex-muted px-1.5 py-0.5 rounded">
                        {p.strategy === 'NONE' ? '— 不機密' : p.strategy}
                      </span>
                    </td>
                    <td className="py-2">
                      <span className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold ${valColor}`}>
                        {result.val}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="text-[10px] text-cortex-cyan-bg/70 italic mt-3 leading-relaxed">
          Sprint E.1 視覺化 demo · Sprint F 接後端 confidentialityMiddleware 真實套用(GET /projects/:id 走 X-Demo-Role header / 真實 role)
        </div>
      </div>

      {/* 規則摘要 */}
      <div className="grid grid-cols-2 gap-3.5">
        <div className="bg-white border border-cortex-line rounded-xl p-4">
          <div className="text-[12px] font-bold text-cortex-ink mb-2">
            <ShieldCheck size={13} className="inline -mt-px mr-1 text-cortex-cyan" />
            機密設定流程
          </div>
          <ol className="text-[11px] text-cortex-text space-y-1.5 leading-relaxed list-decimal pl-4">
            <li>開案 Wizard Step 3 勾選機密欄位 + AI 預判策略</li>
            <li>邀請成員時(<code className="font-mono bg-cortex-bg px-1">project_members.field_grants</code>)個別授權</li>
            <li>渲染時走 <code className="font-mono bg-cortex-bg px-1">confidentialityMiddleware</code> 中央集中</li>
            <li>非成員 GET 機密案 → <strong className="text-red-700">403</strong>(對齊 OUTSIDER 角色)</li>
            <li>機密旗標切換:<strong className="text-cortex-green">non-conf → conf 可</strong>,<strong className="text-red-700">反向禁</strong>(避免資訊洩漏)</li>
          </ol>
        </div>

        <div className="bg-white border border-cortex-line rounded-xl p-4">
          <div className="text-[12px] font-bold text-cortex-ink mb-2">
            <Layers size={13} className="inline -mt-px mr-1 text-cortex-cyan" />
            集中設計
          </div>
          <ul className="text-[11px] text-cortex-text space-y-1.5 leading-relaxed">
            <li>• 所有模組(Chat / Form / Task / KB / Dashboard)走 <strong>同一份策略表</strong></li>
            <li>• AES-256-GCM 加密 at rest(DB 看不到明文)</li>
            <li>• Oracle TDE 表空間 + audit log</li>
            <li>• 結案 fork 進沉澱 KB 前必走 scrub pipeline(spec §7.14)</li>
          </ul>
        </div>
      </div>
    </AdminPageShell>
  )
}
