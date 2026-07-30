/**
 * CleansheetSection — 🧮 Cleansheet (MVA) 檢視(v0.16 原設計重寫 · plan #9 v2)
 *
 * 照 demo renderFormCleansheet 版面:廠 tabs(國旗/廠色)→ Baseline bar → Qty bar → KPI 4 卡 →
 * Step trace(1 製程輸入(可編輯)/2 IDL 矩陣/3 設備+廠房/4 耗材/5 Compute Trace 揭露式)→
 * Step 6 主矩陣(MVA Subtotal · 色階)→ SMT vs Assy 卡 → Final TC waterfall → spec 註。
 * 平台超越 demo:參數「真的可改」(PUT /cleansheet-param)→ 改完按 🔄 重算 生效。
 * 整包內部成本 → server 403 gate;PARTICIPANT 顯鎖定卡。
 */

import { useEffect, useState } from 'react'
import type { ProjectDetail } from '../../api'
import { api } from '../../api'
import { useAuth } from '../../../../context/AuthContext'
import { Loader2, Lock, RefreshCw } from 'lucide-react'

const m4 = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(4)}` : '—')
const m2 = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—')
const nf = (v: any, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—')

const FLAG: Record<string, string> = { CN: '🇨🇳', VN: '🇻🇳', TW: '🇹🇼', TH: '🇹🇭', MY: '🇲🇾' }
const FCOLOR: Record<string, string> = { CN: '#3730A3', VN: '#9A3412', TW: '#166534' }
const COMP_LABEL: Record<string, string> = {
  DL_CPU: 'DL 直接人力', IDL_CPU: 'IDL 間接人力', EQUIP_MRO: '設備 MRO', EQUIP_DEPR: '設備折舊',
  IND_MAT: '間接材料', FACILITY: '廠房', FREIGHT: '運費', VAT: 'VAT', LOSS: 'Loss',
}
const COMMON_ONLY = new Set(['FREIGHT', 'VAT', 'LOSS'])
const PROC_LABEL: Record<string, string> = {
  SMT_MAIN: 'SMT 主線', WAVE_SOLDER: '波峰焊', ROUTER_OFFLINE: '分板', LASER_ETCH: '雷雕',
  BB_ASSY: '成品組裝', BB_TEST: '成品測試', MAT_MGMT: '物料管理', Q_SMT: '品檢(SMT)', Q_BB: '品檢(BB)', COMMON: '共同',
}
const SMT_PROCS = ['SMT_MAIN', 'WAVE_SOLDER', 'ROUTER_OFFLINE', 'LASER_ETCH', 'Q_SMT']

type CaseRow = { case_factory_id: number; factory_code: string; costing_model: string }

// 可編輯數字欄(blur 存 → onSaved 通知 dirty)
function EditNum({ value, onSave, w = 'w-16', suffix }: { value: any; onSave: (v: string) => Promise<void>; w?: string; suffix?: string }) {
  const [v, setV] = useState(value == null ? '' : String(value))
  const [busy, setBusy] = useState(false)
  useEffect(() => { setV(value == null ? '' : String(value)) }, [value])
  return (
    <span className="inline-flex items-center gap-0.5">
      <input value={v} onChange={(e) => setV(e.target.value)} disabled={busy}
        onBlur={async () => { if (v === (value == null ? '' : String(value))) return; setBusy(true); try { await onSave(v) } finally { setBusy(false) } }}
        className={`${w} border border-cortex-line rounded px-1 py-0.5 text-right font-mono text-[11px] focus:border-cortex-teal ${busy ? 'opacity-50' : ''}`} />
      {suffix && <span className="text-[9px] text-cortex-muted">{suffix}</span>}
    </span>
  )
}

export default function CleansheetSection({ project }: { project: ProjectDetail }) {
  const { token } = useAuth() as any
  const projectId = project.id
  const [cases, setCases] = useState<CaseRow[]>([])
  const [activeCf, setActiveCf] = useState<number | ''>('')
  const [qtys, setQtys] = useState<{ code: string; targetQty: number | null }[]>([{ code: 'BASE', targetQty: null }])
  const [qty, setQty] = useState('BASE')
  const [data, setData] = useState<any>(null)
  const [detail, setDetail] = useState<any>(null)
  const [locked, setLocked] = useState(false)
  const [err, setErr] = useState('')
  const [dirty, setDirty] = useState(false)
  const [note, setNote] = useState('')
  const [computing, setComputing] = useState(false)
  // step trace 狀態
  const [step, setStep] = useState<'inputs' | 'idl' | 'equip' | 'cons' | 'compute'>('inputs')
  const [activeProc, setActiveProc] = useState('SMT_MAIN')
  const [zone, setZone] = useState<'A' | 'B' | 'C' | 'D' | 'F'>('A')
  const [reveal, setReveal] = useState(0)

  useEffect(() => {
    if (!token) return
    api.get<{ cases: CaseRow[] }>(token, `/bom/cases?projectId=${projectId}`).then((r) => {
      setCases(r.cases || [])
      if (r.cases?.length) setActiveCf((p) => p || r.cases[0].case_factory_id)
    }).catch(() => {})
    api.get<any>(token, `/bom/project/${projectId}/matrix`).then((m) => {
      if (m?.qtyScenarioDetails?.length) setQtys(m.qtyScenarioDetails)
    }).catch(() => {})
  }, [token, projectId])

  async function loadAll(cf: number) {
    setErr(''); setLocked(false)
    try {
      const [d1, d2] = await Promise.all([
        api.get<any>(token, `/bom/case/${cf}/cleansheet?qty=${qty}`),
        api.get<any>(token, `/bom/case/${cf}/cleansheet-detail`),
      ])
      setData(d1); setDetail(d2)
      if (d2.processes?.length && !d2.processes.some((p: any) => p.process_code === activeProc)) setActiveProc(d2.processes[0].process_code)
    } catch (e: any) { if (/403|視角/.test(e.message)) setLocked(true); else setErr(e.message) }
  }
  useEffect(() => { if (token && activeCf) { setData(null); setDetail(null); loadAll(Number(activeCf)) } }, [token, activeCf, qty])   // eslint-disable-line

  async function saveParam(kind: string, field: string, keys: any, value: string) {
    try {
      const r = await api.put<any>(token, `/bom/case/${activeCf}/cleansheet-param`, { kind, field, keys, value })
      setDirty(true)
      if (r?.cloned) setNote(r.note); else setNote('')
      await loadAll(Number(activeCf))
    } catch (e: any) { setErr(e.message) }
  }
  async function recompute() {
    setComputing(true); setErr('')
    try {
      await api.post(token, '/bom/compute', { caseFactoryId: activeCf, qtyScenarioCode: qty, force: true })
      setDirty(false)
      await loadAll(Number(activeCf))
      window.dispatchEvent(new CustomEvent('cortex:stage-refresh'))
    } catch (e: any) { setErr(e.message) } finally { setComputing(false) }
  }

  if (locked) return (
    <div className="p-6 text-center space-y-2">
      <Lock className="w-8 h-8 mx-auto text-cortex-muted" />
      <div className="text-[13px] font-bold text-cortex-ink">Cleansheet 已鎖定</div>
      <div className="text-[11px] text-cortex-muted">內部成本結構需完整成本視角(HOST/admin)。</div>
    </div>
  )

  const mx = data?.matrix
  const bl = data?.baseline
  const kpi = data?.kpi
  const procs: any[] = detail?.processes || []
  const curProc = procs.find((p) => p.process_code === activeProc)
  const isFull = (cases.find((c) => c.case_factory_id === activeCf)?.costing_model) === 'FULL_MVA'
  const annualDemand = bl?.annualDemand || qtys.find((q) => q.code === qty)?.targetQty || null

  // derived
  const uphOf = (p: any) => (p && p.takt_seconds > 0 ? (3600 / p.takt_seconds) * (p.yield_pct || 1) * (p.efficiency_pct || 1) : null)
  const rowSum = (co: string) => (mx ? mx.processes.reduce((a: number, pr: string) => a + (mx.cells[co]?.[pr]?.v || 0), 0) : 0)
  const colSum = (pr: string) => (mx ? mx.components.reduce((a: number, c: string) => a + (mx.cells[c]?.[pr]?.v || 0), 0) : 0)
  const smtMva = kpi?.smtMva || 0, assyMva = (kpi?.mvaTotal || 0) - smtMva

  // ── Step 5 Compute Trace steps(公式 + 平台真值帶入)────────────────────────
  const dlIm = mx?.cells?.DL_CPU?.[activeProc]?.im?.[0]
  const dlCell = mx?.cells?.DL_CPU?.[activeProc]?.v
  const zoneDefs: Record<string, { icon: string; label: string; formula: string; steps: { label: string; formula: string; calc: string; value: string }[] }> = {
    A: {
      icon: '👷', label: 'Direct Labor', formula: 'DL_wage × 工時 × Total_DL / weekly_output',
      steps: !isFull || !curProc ? [] : [
        { label: 'UPH (units / hour)', formula: '3600 / TAKT × Yield × Eff', calc: `3600 / ${nf(curProc.takt_seconds)} × ${nf((curProc.yield_pct || 0) * 100, 0)}% × ${nf((curProc.efficiency_pct || 0) * 100, 0)}%`, value: nf(dlIm?.uph ?? uphOf(curProc), 2) },
        { label: '週產出 (weekly output)', formula: curProc.weekly_output_override ? 'override(承線速率)' : 'UPH × 週工時 × 線數', calc: curProc.weekly_output_override ? `override = ${curProc.weekly_output_override}` : `${nf(dlIm?.uph ?? uphOf(curProc), 1)} × ${nf(curProc.working_hours_per_day * curProc.days_per_week, 0)} hr × ${curProc.lines_installed || 1} 線`, value: String(dlIm?.weekly_output ?? '—') },
        { label: 'Total DL / day(4 類合計)', formula: '(DL + Debug + Functional + Warehouse) × shifts', calc: `(${curProc.dl_per_shift || 0} + ${curProc.debug_dl_per_shift || 0} + ${curProc.functional_dl_per_shift || 0} + ${curProc.warehouse_dl_per_shift || 0}) × ${curProc.shifts_per_day || 1} 班`, value: String(dlIm?.total_dl_day ?? '—') },
        { label: 'DL cost / week', formula: 'DL_wage × 週工時 × Total_DL', calc: `$${nf(bl?.dlWagePerHr)}/hr × ${nf(curProc.working_hours_per_day * curProc.days_per_week, 0)} hr × ${dlIm?.total_dl_day ?? '?'} 人`, value: m2(dlIm?.dl_cost_wk) },
        { label: '+ IDL line-dep / week(線長/技術員)', formula: 'Σ 線級 IDL 週薪', calc: `line leader ${curProc.line_leader_per_shift || 0}/shift · tech ${curProc.technician_per_shift || 0}/shift`, value: m2(dlIm?.idl_line_dep) },
        { label: 'DL_CPU (final)', formula: '(DL_cost_wk + IDL_line_dep) / weekly_output', calc: `(${m2(dlIm?.dl_cost_wk)} + ${m2(dlIm?.idl_line_dep)}) / ${dlIm?.weekly_output ?? '?'}`, value: m4(dlCell) },
      ],
    },
    B: {
      icon: '👥', label: 'Indirect Labor', formula: 'Σ (role.annual × multiplier) / 50 / weekly_output',
      steps: (() => {
        const rows = (detail?.idl || []).filter((r: any) => r.process_code === activeProc && r.multiplier > 0)
        const top = [...rows].sort((a: any, b: any) => (b.annual_rate_usd * b.multiplier) - (a.annual_rate_usd * a.multiplier)).slice(0, 3)
        const sum = rows.reduce((a: number, r: any) => a + (r.annual_rate_usd || 0) * (r.multiplier || 0), 0)
        return [
          { label: `角色 × multiplier(本製程 ${rows.length} 角色)`, formula: 'Σ (role.annual × multiplier)', calc: top.map((r: any) => `${r.display_name_zh_tw || r.role_code}×${r.multiplier}`).join(' + ') || '(無配置)', value: m2(sum) + '/yr' },
          { label: '週攤(÷50 週)', formula: 'annual / 50', calc: `${m2(sum)} / 50`, value: m2(sum / 50) },
          { label: 'IDL_CPU (final)', formula: '週攤 / weekly_output', calc: `${m2(sum / 50)} / ${dlIm?.weekly_output ?? '?'}`, value: m4(mx?.cells?.IDL_CPU?.[activeProc]?.v) },
        ]
      })(),
    },
    C: {
      icon: '🏭', label: 'Equipment', formula: '(annual_cost × util) / annual_output',
      steps: (() => {
        const rows = (detail?.equipment || []).filter((r: any) => r.process_code === activeProc)
        const sum = rows.reduce((a: number, r: any) => a + (r.annual_cost_usd || 0), 0)
        return [
          { label: `設備 bucket(本製程 ${rows.length} 筆)`, formula: 'Σ annual_cost_usd', calc: rows.map((r: any) => `${r.bucket} $${nf(r.annual_cost_usd, 0)}`).join(' + ') || '(無)', value: m2(sum) + '/yr' },
          { label: 'util 修正', formula: 'apply_util=1 → × 線稼動', calc: rows.map((r: any) => `${r.bucket}:${r.apply_util ? 'util' : '全額'}`).join(' · ') || '—', value: '—' },
          { label: 'DEPR+MRO / unit (final)', formula: 'Σ / annual_demand', calc: `${m2(sum)} / ${annualDemand ?? '?'}`, value: m4((mx?.cells?.EQUIP_DEPR?.[activeProc]?.v || 0) + (mx?.cells?.EQUIP_MRO?.[activeProc]?.v || 0)) },
        ]
      })(),
    },
    D: {
      icon: '🏗️', label: 'Facility + 間材', formula: '(sqft × $/sqft × util + Σ 耗材) / annual_output',
      steps: (() => {
        const f = (detail?.facility || []).find((r: any) => r.process_code === activeProc)
        const fim = mx?.cells?.FACILITY?.[activeProc]?.im?.[0]
        const cons = (detail?.consumables || []).filter((r: any) => r.process_code === activeProc)
        const consSum = cons.reduce((a: number, r: any) => a + (r.annual_usage_qty || 0) * ((r.unit_cost_override_usd ?? r.unit_cost_usd) || 0), 0)
        return [
          { label: '廠房面積 × 單價', formula: 'sqft × $/sqft/yr', calc: f ? `${f.sqft} sqft × $${nf(f.sqft_unit_cost_usd)}` : '(本製程無廠房配置)', value: f ? m2(f.sqft * f.sqft_unit_cost_usd) + '/yr' : '—' },
          { label: '× util(稼動修正)', formula: 'apply_util → × utilFactor', calc: fim ? `util = ${nf(fim.util ?? fim.utilFactor, 3)}` : '—', value: m4(mx?.cells?.FACILITY?.[activeProc]?.v) },
          { label: '間接材料(耗材)', formula: 'Σ annual_qty × unit_cost / demand', calc: cons.map((r: any) => r.consumable_code).join(' + ') || '(本製程無)', value: consSum ? m2(consSum) + '/yr' : m4(mx?.cells?.IND_MAT?.[activeProc]?.v) },
        ]
      })(),
    },
    F: {
      icon: '💰', label: 'Total Roll-up', formula: 'Material + MVA + SG&A + Profit',
      steps: [
        { label: 'MVA Σ(9 製程 × 9 component)', formula: 'Σ cs_run_cell.cost_per_unit_usd', calc: '主矩陣全格加總', value: m4(kpi?.mvaTotal) },
        { label: 'SG&A', formula: `material × sga_pct(${nf((bl?.sgaPct || 0) * 100, 1)}%)`, calc: `${m4(kpi?.material)} × ${nf((bl?.sgaPct || 0) * 100, 1)}%`, value: m4(kpi?.sga) },
        { label: 'Profit', formula: `(MVA + material) × profit_pct(${nf((bl?.profitPct || 0) * 100, 1)}%)`, calc: `(${m4(kpi?.mvaTotal)} + ${m4(kpi?.material)}) × ${nf((bl?.profitPct || 0) * 100, 1)}%`, value: m4(kpi?.profit) },
        { label: 'Total Cost / unit (TC)', formula: 'Material + MVA + SGA + Profit', calc: `${m4(kpi?.material)} + ${m4(kpi?.mvaTotal)} + ${m4(kpi?.sga)} + ${m4(kpi?.profit)}`, value: m4(kpi?.total) },
      ],
    },
  }
  const zoneSteps = zoneDefs[zone]?.steps || []

  const STEP_TABS = [
    { code: 'inputs', icon: '📋', label: '案級製程輸入', sub: `${procs.length} 製程 × 22 欄`, color: '#0EA5E9' },
    { code: 'idl', icon: '👥', label: 'IDL multiplier', sub: `${new Set((detail?.idl || []).map((r: any) => r.role_code)).size} 角色矩陣`, color: '#7C3AED' },
    { code: 'equip', icon: '🏭', label: '設備 + 廠房', sub: `${(detail?.equipment || []).length + (detail?.facility || []).length} 筆`, color: '#0891B2' },
    { code: 'cons', icon: '📦', label: '案級耗材', sub: `${(detail?.consumables || []).length} 件`, color: '#CA8A04' },
    { code: 'compute', icon: '⚙️', label: 'Compute Trace', sub: '逐步公式展開', color: '#DC2626' },
  ] as const

  const idlRoles: string[] = [...new Set((detail?.idl || []).map((r: any) => r.role_code))] as string[]
  const idlProcs: string[] = [...new Set((detail?.idl || []).map((r: any) => r.process_code))] as string[]
  const idlCell = (role: string, proc: string) => (detail?.idl || []).find((r: any) => r.role_code === role && r.process_code === proc)
  const roleInfo = (role: string) => (detail?.idl || []).find((r: any) => r.role_code === role)

  const grpCard = (title: string, color: string, fields: { label: string; node: any }[]) => (
    <div className="border border-cortex-line rounded-lg overflow-hidden">
      <div className="px-2.5 py-1 text-[10px] font-bold text-white" style={{ background: color }}>{title}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 p-2.5 text-[10px]">
        {fields.map((f, i) => <div key={i} className="flex items-center justify-between gap-2"><span className="text-cortex-muted">{f.label}</span>{f.node}</div>)}
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      {/* header:標題 + 廠 tabs + qty + 重算 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-bold text-cortex-ink">🧮 Cleansheet (MVA 計算)</h3>
          <p className="text-[10px] text-cortex-muted">9 製程 × 9 cost component · 每一步輸入/公式可展開 · 參數可修正後重算</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {cases.map((c) => (
            <button key={c.case_factory_id} onClick={() => setActiveCf(c.case_factory_id)}
              style={activeCf === c.case_factory_id ? { background: FCOLOR[c.factory_code] || '#334155', color: '#fff', borderColor: FCOLOR[c.factory_code] || '#334155' } : {}}
              className={`px-2.5 py-1 rounded text-[11px] border ${activeCf === c.case_factory_id ? '' : 'bg-white border-cortex-line text-cortex-muted'}`}>
              {FLAG[c.factory_code] || '🏳️'} {c.factory_code} <span className="text-[8px] opacity-80">{c.costing_model === 'FULL_MVA' ? 'FULL' : 'SIMP'}</span>
            </button>
          ))}
          {qtys.length > 1 && qtys.map((q) => (
            <button key={q.code} onClick={() => setQty(q.code)}
              className={`px-1.5 py-0.5 rounded text-[10px] border ${qty === q.code ? 'bg-cortex-teal text-white border-cortex-teal' : 'bg-white border-cortex-line text-cortex-muted'}`}>{q.code}</button>
          ))}
          <button onClick={recompute} disabled={computing || !activeCf}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] text-white disabled:opacity-40 ${dirty ? 'bg-red-600 animate-pulse' : 'bg-cortex-navy'}`}>
            {computing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} {dirty ? '參數已改 → 重算' : '🔄 Compute'}
          </button>
        </div>
      </div>
      {err && <div className="text-[11px] text-red-600">{err}</div>}
      {note && <div className="text-[11px] text-cortex-teal bg-cortex-cyan-bg/40 border border-cortex-teal/30 rounded px-2 py-1">ℹ️ {note}</div>}
      {!data && !err && <div className="text-[12px] text-cortex-muted"><Loader2 className="w-3.5 h-3.5 inline animate-spin" /> 載入 Cleansheet…</div>}

      {/* Baseline bar */}
      {data && (
        <div className="rounded-lg p-2 text-[10px] text-white flex items-center gap-3 flex-wrap"
          style={{ background: `linear-gradient(90deg, ${FCOLOR[data.factoryCode] || '#334155'}, ${FCOLOR[data.factoryCode] || '#334155'}CC)` }}>
          <b className="text-[11px]">{FLAG[data.factoryCode]} {data.factoryCode} Factory</b>
          {bl ? (
            <>
              <span>版本 <b className="font-mono">{bl.versionLabel || '—'}</b></span>
              <span className="flex items-center gap-1">DL wage <EditNum value={bl.dlWagePerHr} w="w-14" suffix="/hr"
                onSave={(v) => saveParam('baseline', 'dl_wage_per_hr_usd', {}, v)} /></span>
              <span className="flex items-center gap-1">SG&A <EditNum value={Number(((bl.sgaPct || 0) * 100).toFixed(2))} w="w-12" suffix="%"
                onSave={(v) => saveParam('baseline', 'sga_pct', {}, String(Number(v) / 100))} /></span>
              <span className="flex items-center gap-1">Profit <EditNum value={Number(((bl.profitPct || 0) * 100).toFixed(2))} w="w-12" suffix="%"
                onSave={(v) => saveParam('baseline', 'profit_pct', {}, String(Number(v) / 100))} /></span>
              <span className="flex items-center gap-1">年量 <EditNum value={bl.annualDemand} w="w-20"
                onSave={(v) => saveParam('baseline', 'annual_demand_default', {}, v)} /></span>
            </>
          ) : <span>(未綁 baseline)</span>}
          {data.runId && <span className="ml-auto opacity-80">run#{data.runId} · {data.qty}</span>}
        </div>
      )}

      {/* KPI 4 卡 */}
      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            ['MVA Total', kpi.mvaTotal, '/ unit · 9 製程合計'],
            ['SG&A + Profit', (kpi.sga || 0) + (kpi.profit || 0), `${nf((bl?.sgaPct || 0) * 100, 1)}% + ${nf((bl?.profitPct || 0) * 100, 1)}%`],
            ['SMT MVA', smtMva, 'SMT + Wave + Router + Laser + Q-SMT'],
            ['Assy MVA', assyMva, 'Common + Assy + Test + Mat + Q-BB'],
          ].map(([l, v, meta]: any) => (
            <div key={l} className="border border-cortex-line rounded-lg p-2 text-center">
              <div className="text-[9px] text-cortex-muted">{l}</div>
              <div className="text-[15px] font-mono font-bold text-cortex-teal">{m4(v)}</div>
              <div className="text-[8px] text-cortex-muted">{meta}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Step trace 導覽 ─────────────────────────────── */}
      {detail && (
        <div className="border border-cortex-line rounded-lg p-2.5 space-y-2.5">
          <div className="text-[10px] text-cortex-muted">🎬 MVA 每一步展開 · 點 step 看該階段輸入 / 系統實際算什麼 · <b className="text-cortex-ink">輸入值可直接修改(改完按上方重算)</b></div>
          <div className="flex gap-1.5 flex-wrap">
            {STEP_TABS.map((t, i) => (
              <button key={t.code} onClick={() => { setStep(t.code as any); setReveal(0) }}
                style={step === t.code ? { background: t.color, color: '#fff', borderColor: t.color } : {}}
                className={`px-2 py-1 rounded text-[10px] border ${step === t.code ? '' : 'bg-white border-cortex-line text-cortex-muted'}`}>
                {t.icon} Step {i + 1} · {t.label} <span className="opacity-70">({t.sub})</span>
              </button>
            ))}
          </div>

          {/* Step 1:案級製程輸入(可編輯) */}
          {step === 'inputs' && (isFull ? (
            <div className="space-y-2">
              <div className="flex gap-1 flex-wrap">
                {procs.map((p) => (
                  <button key={p.process_code} onClick={() => setActiveProc(p.process_code)}
                    className={`px-2 py-0.5 rounded text-[10px] border ${activeProc === p.process_code ? (SMT_PROCS.includes(p.process_code) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-green-600 text-white border-green-600') : 'bg-white border-cortex-line text-cortex-muted'}`}>
                    {PROC_LABEL[p.process_code] || p.process_code}{p.weekly_output_override ? ' •' : ''}
                  </button>
                ))}
              </div>
              {curProc && (
                <div className="grid md:grid-cols-2 gap-2">
                  {grpCard('⏱ Staffed Hours(班表)', '#0EA5E9', [
                    { label: '日工時 hr', node: <EditNum value={curProc.working_hours_per_day} onSave={(v) => saveParam('process', 'working_hours_per_day', { process_code: activeProc }, v)} /> },
                    { label: '週工作天', node: <EditNum value={curProc.days_per_week} onSave={(v) => saveParam('process', 'days_per_week', { process_code: activeProc }, v)} /> },
                    { label: '週工時(derived)', node: <b className="font-mono text-purple-700">{nf(curProc.working_hours_per_day * curProc.days_per_week, 0)} hr</b> },
                    { label: '班次/日', node: <EditNum value={curProc.shifts_per_day} onSave={(v) => saveParam('process', 'shifts_per_day', { process_code: activeProc }, v)} /> },
                  ])}
                  {grpCard('⚡ Throughput(產出)', '#16A34A', [
                    { label: 'TAKT (s)', node: <EditNum value={curProc.takt_seconds} onSave={(v) => saveParam('process', 'takt_seconds', { process_code: activeProc }, v)} /> },
                    { label: 'UPH(derived)', node: <b className="font-mono text-purple-700">{nf(uphOf(curProc), 1)}</b> },
                    { label: 'Yield(0~1)', node: <EditNum value={curProc.yield_pct} onSave={(v) => saveParam('process', 'yield_pct', { process_code: activeProc }, v)} /> },
                    { label: 'Efficiency(0~1)', node: <EditNum value={curProc.efficiency_pct} onSave={(v) => saveParam('process', 'efficiency_pct', { process_code: activeProc }, v)} /> },
                  ])}
                  {grpCard('👷 DL Config(4 類 / shift)', '#DC2626', [
                    { label: 'DL / shift', node: <EditNum value={curProc.dl_per_shift} onSave={(v) => saveParam('process', 'dl_per_shift', { process_code: activeProc }, v)} /> },
                    { label: 'Debug DL', node: <EditNum value={curProc.debug_dl_per_shift} onSave={(v) => saveParam('process', 'debug_dl_per_shift', { process_code: activeProc }, v)} /> },
                    { label: 'Functional DL', node: <EditNum value={curProc.functional_dl_per_shift} onSave={(v) => saveParam('process', 'functional_dl_per_shift', { process_code: activeProc }, v)} /> },
                    { label: 'Warehouse DL', node: <EditNum value={curProc.warehouse_dl_per_shift} onSave={(v) => saveParam('process', 'warehouse_dl_per_shift', { process_code: activeProc }, v)} /> },
                  ])}
                  {grpCard('👔 IDL Line-dep(線級)', '#7C3AED', [
                    { label: 'Line Leader / shift', node: <EditNum value={curProc.line_leader_per_shift} onSave={(v) => saveParam('process', 'line_leader_per_shift', { process_code: activeProc }, v)} /> },
                    { label: 'Technician / shift', node: <EditNum value={curProc.technician_per_shift} onSave={(v) => saveParam('process', 'technician_per_shift', { process_code: activeProc }, v)} /> },
                    { label: 'IQC / day', node: <EditNum value={curProc.iqc_per_day} onSave={(v) => saveParam('process', 'iqc_per_day', { process_code: activeProc }, v)} /> },
                    { label: 'Supervisor / day', node: <EditNum value={curProc.supervisor_per_day} onSave={(v) => saveParam('process', 'supervisor_per_day', { process_code: activeProc }, v)} /> },
                  ])}
                  {grpCard('📊 Volume / 線', '#CA8A04', [
                    { label: '線數', node: <EditNum value={curProc.lines_installed} onSave={(v) => saveParam('process', 'lines_installed', { process_code: activeProc }, v)} /> },
                    { label: 'Debug 線數', node: <EditNum value={curProc.debug_lines_installed} onSave={(v) => saveParam('process', 'debug_lines_installed', { process_code: activeProc }, v)} /> },
                    { label: '週產出 override', node: <EditNum value={curProc.weekly_output_override} onSave={(v) => saveParam('process', 'weekly_output_override', { process_code: activeProc }, v)} w="w-20" /> },
                    { label: '年量(baseline)', node: <b className="font-mono">{annualDemand ? Number(annualDemand).toLocaleString('en-US') : '—'}</b> },
                  ])}
                </div>
              )}
              <div className="text-[9px] font-mono text-cortex-muted">↳ 寫入 bom_cs_case_process WHERE process_code='{activeProc}' · 改完按上方「重算」生效</div>
            </div>
          ) : <div className="text-[11px] text-cortex-muted p-2">此廠為 SIMPLIFIED 模型:製程參數在「成本模型 Excel(SimplifiedLine 分頁)」維護,匯入即生效。</div>)}

          {/* Step 2:IDL multiplier 熱力矩陣(multiplier 可編輯) */}
          {step === 'idl' && (idlRoles.length ? (
            <div className="overflow-x-auto">
              <table className="text-[9.5px] min-w-full">
                <thead className="text-cortex-muted border-b border-cortex-line">
                  <tr>
                    <th className="text-left px-1.5 py-1 sticky left-0 bg-white">IDL 角色</th>
                    <th className="text-right px-1.5 py-1">年薪 USD</th>
                    {idlProcs.map((p) => <th key={p} className="text-center px-1 py-1 whitespace-nowrap">{PROC_LABEL[p] || p}</th>)}
                    <th className="text-right px-1.5 py-1 bg-purple-50">Row Σ</th>
                  </tr>
                </thead>
                <tbody>
                  {idlRoles.map((role) => {
                    const info = roleInfo(role)
                    const rsum = idlProcs.reduce((a, p) => a + (idlCell(role, p)?.multiplier || 0), 0)
                    return (
                      <tr key={role} className="border-b border-cortex-line/30">
                        <td className="px-1.5 py-0.5 whitespace-nowrap sticky left-0 bg-white">{info?.display_name_zh_tw || role}<span className="text-cortex-muted font-mono ml-1 text-[8px]">{info?.category}</span></td>
                        <td className="px-1.5 py-0.5 text-right font-mono">{info?.annual_rate_usd ? `$${Number(info.annual_rate_usd).toLocaleString('en-US')}` : '—'}</td>
                        {idlProcs.map((p) => {
                          const c = idlCell(role, p)
                          const v = c?.multiplier || 0
                          return (
                            <td key={p} className="px-1 py-0.5 text-center font-mono" style={v > 0 ? { background: `rgba(124,58,237,${0.05 + Math.min(1, v / 0.3) * 0.3})` } : {}}>
                              {c ? <EditNum value={c.multiplier} w="w-12" onSave={(nv) => saveParam('idl', 'multiplier', { process_code: p, role_code: role }, nv)} /> : '—'}
                            </td>
                          )
                        })}
                        <td className="px-1.5 py-0.5 text-right font-mono bg-purple-50 font-bold">{nf(rsum, 3)}</td>
                      </tr>
                    )
                  })}
                  <tr className="text-white font-bold" style={{ background: '#5B21B6' }}>
                    <td className="px-1.5 py-1">Col Σ (per process)</td>
                    <td className="px-1.5 py-1 text-right">—</td>
                    {idlProcs.map((p) => <td key={p} className="px-1 py-1 text-center font-mono">{nf(idlRoles.reduce((a, r) => a + (idlCell(r, p)?.multiplier || 0), 0), 2)}</td>)}
                    <td className="px-1.5 py-1 text-right font-mono">{nf((detail?.idl || []).reduce((a: number, r: any) => a + (r.multiplier || 0), 0), 2)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="text-[9px] font-mono text-cortex-muted mt-1">↳ bom_cs_case_idl_alloc(multiplier 可直接改 · 年薪在廠 baseline)</div>
            </div>
          ) : <div className="text-[11px] text-cortex-muted p-2">此廠無 IDL 配置(SIMPLIFIED 模型或未匯入)。</div>)}

          {/* Step 3:設備 + 廠房(可編輯) */}
          {step === 'equip' && (
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] font-bold text-cortex-ink mb-1">🏭 設備(製程 × bucket 年費)</div>
                <table className="w-full text-[10px]">
                  <thead className="text-cortex-muted border-b border-cortex-line"><tr>
                    <th className="text-left px-1.5 py-0.5">製程</th><th className="text-left px-1.5 py-0.5">Bucket</th>
                    <th className="text-right px-1.5 py-0.5">年費 USD</th><th className="text-center px-1.5 py-0.5">吃稼動</th>
                  </tr></thead>
                  <tbody>
                    {(detail?.equipment || []).map((r: any, i: number) => (
                      <tr key={i} className="border-b border-cortex-line/30">
                        <td className="px-1.5 py-0.5">{PROC_LABEL[r.process_code] || r.process_code}</td>
                        <td className="px-1.5 py-0.5 font-mono">{r.bucket}</td>
                        <td className="px-1.5 py-0.5 text-right"><EditNum value={r.annual_cost_usd} w="w-20" onSave={(v) => saveParam('equipment', 'annual_cost_usd', { process_code: r.process_code, bucket: r.bucket }, v)} /></td>
                        <td className="px-1.5 py-0.5 text-center"><EditNum value={r.apply_util} w="w-10" onSave={(v) => saveParam('equipment', 'apply_util', { process_code: r.process_code, bucket: r.bucket }, v)} /></td>
                      </tr>
                    ))}
                    {!(detail?.equipment || []).length && <tr><td colSpan={4} className="px-2 py-2 text-center text-cortex-muted">無設備配置</td></tr>}
                  </tbody>
                </table>
              </div>
              <div>
                <div className="text-[10px] font-bold text-cortex-ink mb-1">🏗️ 廠房(sqft × 單價)</div>
                <table className="w-full text-[10px]">
                  <thead className="text-cortex-muted border-b border-cortex-line"><tr>
                    <th className="text-left px-1.5 py-0.5">製程</th><th className="text-right px-1.5 py-0.5">sqft</th>
                    <th className="text-right px-1.5 py-0.5">$/sqft/yr</th><th className="text-center px-1.5 py-0.5">吃稼動</th>
                  </tr></thead>
                  <tbody>
                    {(detail?.facility || []).map((r: any, i: number) => (
                      <tr key={i} className="border-b border-cortex-line/30">
                        <td className="px-1.5 py-0.5">{PROC_LABEL[r.process_code] || r.process_code}</td>
                        <td className="px-1.5 py-0.5 text-right"><EditNum value={r.sqft} w="w-16" onSave={(v) => saveParam('facility', 'sqft', { process_code: r.process_code }, v)} /></td>
                        <td className="px-1.5 py-0.5 text-right"><EditNum value={r.sqft_unit_cost_usd} w="w-16" onSave={(v) => saveParam('facility', 'sqft_unit_cost_usd', { process_code: r.process_code }, v)} /></td>
                        <td className="px-1.5 py-0.5 text-center"><EditNum value={r.apply_util} w="w-10" onSave={(v) => saveParam('facility', 'apply_util', { process_code: r.process_code }, v)} /></td>
                      </tr>
                    ))}
                    {!(detail?.facility || []).length && <tr><td colSpan={4} className="px-2 py-2 text-center text-cortex-muted">無廠房配置</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step 4:耗材(可編輯) */}
          {step === 'cons' && (
            <div>
              <table className="w-full text-[10px]">
                <thead className="text-cortex-muted border-b border-cortex-line"><tr>
                  <th className="text-left px-1.5 py-0.5">Consumable</th><th className="text-left px-1.5 py-0.5">UOM</th>
                  <th className="text-left px-1.5 py-0.5">Process</th><th className="text-right px-1.5 py-0.5">Annual qty</th>
                  <th className="text-right px-1.5 py-0.5">Unit cost</th><th className="text-right px-1.5 py-0.5">年成本</th><th className="text-right px-1.5 py-0.5">/ unit</th>
                </tr></thead>
                <tbody>
                  {(detail?.consumables || []).map((r: any, i: number) => {
                    const uc = r.unit_cost_override_usd ?? r.unit_cost_usd
                    const annual = (r.annual_usage_qty || 0) * (uc || 0)
                    return (
                      <tr key={i} className="border-b border-cortex-line/30">
                        <td className="px-1.5 py-0.5"><span className="font-mono text-[8px] text-cortex-muted">{r.consumable_code}</span> {r.description}</td>
                        <td className="px-1.5 py-0.5">{r.unit_of_measure || '—'}</td>
                        <td className="px-1.5 py-0.5">{PROC_LABEL[r.process_code] || r.process_code}</td>
                        <td className="px-1.5 py-0.5 text-right"><EditNum value={r.annual_usage_qty} w="w-16" onSave={(v) => saveParam('consumable', 'annual_usage_qty', { consumable_id: r.consumable_id, process_code: r.process_code }, v)} /></td>
                        <td className="px-1.5 py-0.5 text-right"><EditNum value={r.unit_cost_override_usd ?? ''} w="w-16" onSave={(v) => saveParam('consumable', 'unit_cost_override_usd', { consumable_id: r.consumable_id, process_code: r.process_code }, v)} suffix={r.unit_cost_override_usd == null ? `(廠 $${nf(r.unit_cost_usd)})` : ''} /></td>
                        <td className="px-1.5 py-0.5 text-right font-mono">{m2(annual)}</td>
                        <td className="px-1.5 py-0.5 text-right font-mono">{annualDemand ? m4(annual / Number(annualDemand)) : '—'}</td>
                      </tr>
                    )
                  })}
                  {!(detail?.consumables || []).length && <tr><td colSpan={7} className="px-2 py-2 text-center text-cortex-muted">無耗材配置</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* Step 5:Compute Trace(揭露式) */}
          {step === 'compute' && (
            <div className="space-y-2">
              <div className="flex gap-1 flex-wrap">
                {(['A', 'B', 'C', 'D', 'F'] as const).map((z) => (
                  <button key={z} onClick={() => { setZone(z); setReveal(0) }}
                    className={`px-2 py-1 rounded text-[10px] border ${zone === z ? 'bg-red-600 text-white border-red-600' : 'bg-white border-cortex-line text-cortex-muted'}`}>
                    {zoneDefs[z].icon} 區 {z} · {zoneDefs[z].label} <span className="opacity-70">({zoneDefs[z].steps.length} 步)</span>
                  </button>
                ))}
              </div>
              {zone !== 'F' && isFull && (
                <div className="flex gap-1 flex-wrap">
                  {procs.map((p) => (
                    <button key={p.process_code} onClick={() => { setActiveProc(p.process_code); setReveal(0) }}
                      className={`px-1.5 py-0.5 rounded text-[9px] border ${activeProc === p.process_code ? 'bg-cortex-navy text-white border-cortex-navy' : 'bg-white border-cortex-line text-cortex-muted'}`}>
                      {PROC_LABEL[p.process_code] || p.process_code}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded p-1.5 text-[10px]">
                <b className="text-red-700">▶ 區 {zone} · {zoneDefs[zone].label}</b>
                <span className="font-mono text-red-600">{zoneDefs[zone].formula}</span>
                <span className="ml-auto text-cortex-muted">當前 {Math.min(reveal, zoneSteps.length)}/{zoneSteps.length}</span>
                <button onClick={() => setReveal(0)} className="px-1.5 py-0.5 border border-red-300 rounded text-red-700">⟲ Reset</button>
                <button onClick={() => setReveal((r) => Math.min(r + 1, zoneSteps.length))} className="px-1.5 py-0.5 bg-red-600 text-white rounded">▶ 下一步</button>
                <button onClick={() => setReveal(zoneSteps.length)} className="px-1.5 py-0.5 border border-red-300 rounded text-red-700">⏭ 全部跑完</button>
              </div>
              <div className="space-y-1">
                {zoneSteps.map((s, i) => {
                  const shown = i < reveal
                  return (
                    <div key={i} className={`flex items-start gap-2 border rounded p-1.5 text-[10px] transition ${shown ? 'border-red-200 bg-white' : 'border-cortex-line/50 opacity-40'}`}>
                      <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${shown ? 'bg-red-600 text-white' : 'bg-cortex-line text-cortex-muted'}`}>{i + 1}</span>
                      <span className="flex-1 min-w-0">
                        <b className="text-cortex-ink">{s.label}</b>
                        <span className="block font-mono text-cortex-muted">公式: {s.formula}</span>
                        {shown && <span className="block font-mono text-purple-700 bg-purple-50 rounded px-1 mt-0.5">↳ {s.calc}</span>}
                      </span>
                      <b className="font-mono text-[11px] text-cortex-ink shrink-0">{shown ? s.value : '···'}</b>
                    </div>
                  )
                })}
                {!zoneSteps.length && <div className="text-[11px] text-cortex-muted p-2">此廠 / 製程無此區資料(SIMPLIFIED 模型走 Line 結構)。</div>}
              </div>
              {reveal >= zoneSteps.length && zoneSteps.length > 0 && (
                <div className="rounded p-2 text-white text-[11px] font-bold" style={{ background: 'linear-gradient(90deg,#DC2626,#B91C1C)' }}>
                  ✓ 區 {zone} 計算完成 · {zoneSteps[zoneSteps.length - 1].label} = {zoneSteps[zoneSteps.length - 1].value}
                  <span className="block text-[8.5px] font-mono font-normal opacity-80">↳ 寫入 bom_cs_run_cell (run#{data?.runId} · {zone !== 'F' ? activeProc : 'ALL'})</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 6:主矩陣 */}
      {mx ? (
        <div className="border border-cortex-line rounded-lg overflow-hidden">
          <div className="px-3 py-1.5 text-[11px] font-bold text-cortex-ink bg-cortex-bg/40 border-b border-cortex-line">Step 6 · Cost Component × Process Matrix(最終結果)</div>
          <div className="overflow-x-auto">
            <table className="text-[10px] min-w-full">
              <thead className="text-cortex-muted border-b border-cortex-line bg-cortex-bg/40">
                <tr>
                  <th className="text-left px-2 py-1 sticky left-0 bg-cortex-bg/90">Cost Component / $ / unit</th>
                  {mx.processes.map((p: string) => (
                    <th key={p} className={`text-right px-2 py-1 whitespace-nowrap ${SMT_PROCS.includes(p) ? 'text-indigo-700' : p === 'COMMON' ? 'text-cortex-muted' : 'text-green-700'}`}>
                      <span className="font-mono">{p}</span><br /><span className="font-normal">{PROC_LABEL[p] || ''}</span>
                    </th>
                  ))}
                  <th className="text-right px-2 py-1 font-bold">Total</th>
                </tr>
              </thead>
              <tbody>
                {mx.components.map((co: string) => (
                  <tr key={co} className="border-b border-cortex-line/30">
                    <td className="px-2 py-1 whitespace-nowrap sticky left-0 bg-white">
                      {COMP_LABEL[co] || co} <span className="font-mono text-[8px] text-cortex-muted">{co}{COMMON_ONLY.has(co) ? ' · Common only' : ''}</span>
                    </td>
                    {mx.processes.map((pr: string) => {
                      const v = mx.cells[co]?.[pr]?.v || 0
                      return (
                        <td key={pr} title={mx.cells[co]?.[pr]?.formula || undefined}
                          className={`px-2 py-1 text-right font-mono ${v > 0.05 ? 'bg-teal-50 font-bold text-teal-900' : v > 0 ? 'text-cortex-ink' : 'text-cortex-line'}`}>
                          {v === 0 ? '—' : v < 0.0001 ? v.toExponential(2) : m4(v)}
                        </td>
                      )
                    })}
                    <td className="px-2 py-1 text-right font-mono font-bold">{m4(rowSum(co))}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-cortex-line font-bold bg-cortex-cyan-bg/40">
                  <td className="px-2 py-1 sticky left-0 bg-cortex-cyan-bg/70">MVA Subtotal</td>
                  {mx.processes.map((pr: string) => <td key={pr} className="px-2 py-1 text-right font-mono">{m4(colSum(pr))}</td>)}
                  <td className="px-2 py-1 text-right font-mono text-cortex-teal text-[12px]">{m4(kpi?.mvaTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : data && (
        <div className="text-[11px] text-cortex-muted">此廠 / 量情境尚無試算 run —— 按上方 🔄 Compute。</div>
      )}

      {/* SMT vs Assy */}
      {kpi && kpi.mvaTotal > 0 && (
        <div className="grid md:grid-cols-2 gap-2">
          {[['📦 SMT-side MVA', smtMva, '#6366F1'], ['🔧 Assy-side MVA', assyMva, '#16A34A']].map(([l, v, c]: any) => (
            <div key={l} className="border border-cortex-line rounded-lg p-2.5">
              <div className="flex items-center justify-between text-[10px]"><b className="text-cortex-ink">{l}</b><span className="font-mono font-bold">{m4(v)} · {nf((v / kpi.mvaTotal) * 100, 1)}% of MVA</span></div>
              <div className="h-1.5 bg-cortex-line/50 rounded mt-1.5 overflow-hidden"><div className="h-full rounded" style={{ width: `${(v / kpi.mvaTotal) * 100}%`, background: c }} /></div>
            </div>
          ))}
        </div>
      )}

      {/* Final TC waterfall */}
      {kpi && (
        <div className="border border-cortex-line rounded-lg overflow-hidden">
          <div className="px-3 py-1.5 text-[11px] font-bold text-cortex-ink bg-cortex-bg/40 border-b border-cortex-line">Final TC Waterfall</div>
          <table className="w-full text-[11px]">
            <tbody>
              <tr className="border-b border-cortex-line/30"><td className="px-3 py-1">Material(from BOM · 對客報價)</td><td className="px-3 py-1 text-right font-mono">{m4(kpi.material)}</td></tr>
              <tr className="border-b border-cortex-line/30"><td className="px-3 py-1 text-cortex-teal font-bold">+ MVA(9 製程合計)</td><td className="px-3 py-1 text-right font-mono font-bold text-cortex-teal">{m4(kpi.mvaTotal)}</td></tr>
              <tr className="border-b border-cortex-line/30"><td className="px-3 py-1">+ SG&A({nf((bl?.sgaPct || 0) * 100, 1)}%)</td><td className="px-3 py-1 text-right font-mono">{m4(kpi.sga)}</td></tr>
              <tr className="border-b border-cortex-line/30"><td className="px-3 py-1">+ Profit({nf((bl?.profitPct || 0) * 100, 1)}%)</td><td className="px-3 py-1 text-right font-mono">{m4(kpi.profit)}</td></tr>
              <tr className="font-bold bg-cortex-cyan-bg/40"><td className="px-3 py-1.5">= Total Cost / unit</td><td className="px-3 py-1.5 text-right font-mono text-[13px] text-cortex-teal">{m4(kpi.total)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[10px] text-cortex-muted">參數修改即寫入案級表(bom_cs_case_*),按 🔄 Compute 重算 → 主矩陣 / 矩陣快取 / 成本核算同步更新 · 對照 §多廠矩陣 同 run 快取</div>
    </div>
  )
}
