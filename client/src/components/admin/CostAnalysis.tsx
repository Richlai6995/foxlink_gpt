import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as BarTooltip,
  Cell as BarCell,
} from 'recharts'
import { RefreshCw, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'

function fmtFactory(code?: string | null, name?: string | null, otherCount?: number) {
  if (!code) return '-'
  const tail = otherCount && otherCount > 0 ? ` (+${otherCount})` : ''
  return `${code}${name ? ' ' + name : ''}${tail}`
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface SummaryRow {
  profit_center: string
  profit_center_name: string
  org_section: string
  org_section_name: string
  org_group_name: string
  factory_code?: string
  factory_name?: string
  factory_other_count?: number
  input_tokens: number
  output_tokens: number
  cost: number
  account_count: number
  user_count: number
  indirect_emp_count: number
  avg_cost: number
  currency: string
  dept_breakdown: { dept_code: string; dept_name: string; cost: number }[]
  no_account?: boolean
}

interface MonthlyRow {
  profit_center: string
  profit_center_name: string
  org_section: string
  org_section_name: string
  org_group_name: string
  factory_code?: string
  factory_name?: string
  factory_other_count?: number
  month: string
  input_tokens: number
  output_tokens: number
  cost: number
  account_count: number
  user_count: number
  indirect_emp_count: number
  avg_cost: number
  currency: string
  no_account?: boolean
}

interface FactoryRow {
  profit_center: string
  profit_center_name: string
  org_section: string
  org_section_name: string
  org_group_name: string
  factory_code: string
  factory_name?: string
  input_tokens: number
  output_tokens: number
  cost: number
  account_count: number
  user_count: number
  indirect_emp_count: number
  avg_cost: number
  currency: string
}

interface FactoryMonthlyRow extends FactoryRow {
  month: string
}

interface EmpRow {
  user_id: number | null
  employee_id: string
  user_name: string
  user_email: string
  dept_code: string
  dept_name: string
  profit_center: string
  profit_center_name: string
  org_section: string
  org_section_name: string
  org_group_name: string
  factory_code: string
  factory_name?: string
  input_tokens: number
  output_tokens: number
  cost: number
  currency: string
  has_account?: boolean
  has_usage?: boolean
}

// ─── Colors ────────────────────────────────────────────────────────────────

const CHART_COLORS = [
  '#2563EB', '#7C3AED', '#059669', '#D97706', '#DC2626',
  '#0891B2', '#9333EA', '#16A34A', '#EA580C', '#BE185D',
]

function fmtCost(v: number | null | undefined, currency = 'USD') {
  if (v == null) return '-'
  return `${v.toFixed(4)} ${currency}`
}

function fmtTokens(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(v)
}

// ─── Sub-components ────────────────────────────────────────────────────────

function ExportBtn({ href, label, filename }: { href: string; label: string; filename?: string }) {
  const handleClick = async () => {
    try {
      const res = await api.get(href.replace(/^\/api/, ''), { responseType: 'blob' })
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename || 'export.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Export failed:', e)
      alert('匯出失敗')
    }
  }
  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 text-gray-700"
    >
      <Download size={12} /> {label}
    </button>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function CostAnalysis() {
  const { i18n } = useTranslation()
  const today = new Date().toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  const [startDate, setStartDate] = useState(thirtyDaysAgo)
  const [endDate, setEndDate] = useState(today)
  const [includeAllPC, setIncludeAllPC] = useState(false)
  const [onlyFoxlinkGroup, setOnlyFoxlinkGroup] = useState(true)
  const [requireEmployeeId, setRequireEmployeeId] = useState(true)
  const [showAllEmployees, setShowAllEmployees] = useState(false)
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [monthly, setMonthly] = useState<MonthlyRow[]>([])
  const [factoryRows, setFactoryRows] = useState<FactoryRow[]>([])
  const [factoryMonthly, setFactoryMonthly] = useState<FactoryMonthlyRow[]>([])
  const [employees, setEmployees] = useState<EmpRow[]>([])
  const [totalAccounts, setTotalAccounts] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 篩選 state:下拉 + 圖表點擊共用,會傳到 API filter query params
  const [selectedPC, setSelectedPC] = useState<string | null>(null)          // 利潤中心(點 pie / 下拉)
  const [selectedDept, setSelectedDept] = useState<string | null>(null)      // 部門(點 bar / 下拉)
  const [selectedFactory, setSelectedFactory] = useState<string | null>(null)       // 廠區(下拉)
  const [selectedOrgSection, setSelectedOrgSection] = useState<string | null>(null) // 事業處(下拉)
  const [selectedOrgGroup, setSelectedOrgGroup] = useState<string | null>(null)     // 事業群(下拉)



  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // 全域過濾(套到所有 endpoint):正崴集團 + 有工號
      const globalFilterParam = `&onlyFoxlinkGroup=${onlyFoxlinkGroup ? '1' : '0'}&requireEmployeeId=${requireEmployeeId ? '1' : '0'}`
      const incParam = includeAllPC ? `&includeAllPC=1` : ''
      const empParam = showAllEmployees ? `&showAllEmployees=1` : ''
      const langParam = `&lang=${encodeURIComponent(i18n.language || 'zh-TW')}`
      const filterParts = [
        selectedFactory    ? `&factoryCode=${encodeURIComponent(selectedFactory)}`   : '',
        selectedDept       ? `&deptCode=${encodeURIComponent(selectedDept)}`         : '',
        selectedPC         ? `&profitCenter=${encodeURIComponent(selectedPC)}`       : '',
        selectedOrgSection ? `&orgSection=${encodeURIComponent(selectedOrgSection)}` : '',
        selectedOrgGroup   ? `&orgGroup=${encodeURIComponent(selectedOrgGroup)}`     : '',
      ]
      const filterParam = filterParts.join('') + globalFilterParam
      const [s, m, sf, mf, e, t] = await Promise.all([
        api.get(`/admin/cost-stats/summary?startDate=${startDate}&endDate=${endDate}${incParam}${langParam}${filterParam}`),
        api.get(`/admin/cost-stats/monthly?startDate=${startDate}&endDate=${endDate}${incParam}${langParam}${filterParam}`),
        api.get(`/admin/cost-stats/summary-by-factory?startDate=${startDate}&endDate=${endDate}${langParam}${filterParam}`),
        api.get(`/admin/cost-stats/monthly-by-factory?startDate=${startDate}&endDate=${endDate}${langParam}${filterParam}`),
        api.get(`/admin/cost-stats/employees?startDate=${startDate}&endDate=${endDate}${empParam}${langParam}${filterParam}`),
        api.get(`/admin/cost-stats/total-accounts`),
      ])
      setSummary(s.data)
      setMonthly(m.data)
      setFactoryRows(sf.data)
      setFactoryMonthly(mf.data)
      setEmployees(e.data)
      setTotalAccounts(t.data?.total ?? null)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, includeAllPC, onlyFoxlinkGroup, requireEmployeeId, showAllEmployees, i18n.language,
      selectedFactory, selectedDept, selectedPC, selectedOrgSection, selectedOrgGroup])

  // filter state 變動自動 reload(取代原本 mount-only load);日期 / checkbox 仍需按「查詢」鈕
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [selectedFactory, selectedDept, selectedPC, selectedOrgSection, selectedOrgGroup])


  // ── Derived data ────────────────────────────────────────────────────────

  // Pie chart data
  const pieData = summary.map((r, i) => ({
    name: r.profit_center_name || r.profit_center || '(未設定)',
    value: r.cost,
    color: CHART_COLORS[i % CHART_COLORS.length],
    profit_center: r.profit_center,
  }))

  // Bar chart data: dept breakdown filtered by selectedPC
  const barData = (() => {
    if (selectedPC) {
      const pc = summary.find((r) => r.profit_center === selectedPC)
      return (pc?.dept_breakdown || []).map((d, i) => ({
        name: d.dept_name || d.dept_code,
        dept_code: d.dept_code,
        value: d.cost,
        color: CHART_COLORS[i % CHART_COLORS.length],
      }))
    }
    // No selection: show all depts merged
    const dMap: Record<string, { name: string; dept_code: string; value: number }> = {}
    for (const pc of summary) {
      for (const d of pc.dept_breakdown) {
        const k = d.dept_code
        if (!dMap[k]) dMap[k] = { name: d.dept_name || d.dept_code, dept_code: d.dept_code, value: 0 }
        dMap[k].value += d.cost
      }
    }
    return Object.values(dMap)
      .sort((a, b) => b.value - a.value)
      .slice(0, 20)
      .map((d, i) => ({ ...d, color: CHART_COLORS[i % CHART_COLORS.length] }))
  })()

  // Monthly pie data: same profit centers
  const monthlyPieData = (() => {
    const map: Record<string, { name: string; value: number; profit_center: string }> = {}
    for (const r of monthly) {
      if (!map[r.profit_center]) {
        map[r.profit_center] = { name: r.profit_center_name || r.profit_center || '(未設定)', value: 0, profit_center: r.profit_center }
      }
      map[r.profit_center].value += r.cost
    }
    return Object.values(map).map((r, i) => ({ ...r, color: CHART_COLORS[i % CHART_COLORS.length] }))
  })()

  // Monthly bar: month × cost (filtered by selectedPC)
  const monthlyBarData = (() => {
    const src = selectedPC ? monthly.filter((r) => r.profit_center === selectedPC) : monthly
    const map: Record<string, number> = {}
    for (const r of src) { map[r.month] = (map[r.month] || 0) + r.cost }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([month, value], i) => ({
      name: month, value, color: CHART_COLORS[i % CHART_COLORS.length],
    }))
  })()

  // Filtered employees
  const filteredEmps = employees.filter((e) => {
    if (selectedPC && e.profit_center !== selectedPC) return false
    if (selectedDept && e.dept_code !== selectedDept) return false
    return true
  })

  // Total cost
  const totalCost = summary.reduce((s, r) => s + r.cost, 0)
  const currency = summary[0]?.currency || 'USD'

  // ── 下拉選項(從當期資料 distinct) ──────────────────────────────────────
  const factoryOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of employees) if (e.factory_code && !m.has(e.factory_code)) m.set(e.factory_code, e.factory_name || '')
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([code, name]) => ({ code, name }))
  }, [employees])

  const deptOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of employees) if (e.dept_code && !m.has(e.dept_code)) m.set(e.dept_code, e.dept_name || '')
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([code, name]) => ({ code, name }))
  }, [employees])

  const pcOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of summary) if (s.profit_center && !m.has(s.profit_center)) m.set(s.profit_center, s.profit_center_name || '')
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([code, name]) => ({ code, name }))
  }, [summary])

  const orgSectionOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of summary) if (s.org_section && !m.has(s.org_section)) m.set(s.org_section, s.org_section_name || '')
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([code, name]) => ({ code, name }))
  }, [summary])

  const orgGroupOptions = useMemo(() => {
    const set = new Set<string>()
    for (const s of summary) if (s.org_group_name) set.add(s.org_group_name)
    return Array.from(set).sort().map((name) => ({ code: name, name }))
  }, [summary])

  // ── CSV export URLs ──────────────────────────────────────────────────────
  const qs = `startDate=${startDate}&endDate=${endDate}`
  const incQs = includeAllPC ? `&includeAllPC=1` : ''
  const langQs = `&lang=${encodeURIComponent(i18n.language || 'zh-TW')}`
  const globalQs = `&onlyFoxlinkGroup=${onlyFoxlinkGroup ? '1' : '0'}&requireEmployeeId=${requireEmployeeId ? '1' : '0'}`
  const filterQs = [
    selectedFactory    ? `&factoryCode=${encodeURIComponent(selectedFactory)}`   : '',
    selectedDept       ? `&deptCode=${encodeURIComponent(selectedDept)}`         : '',
    selectedPC         ? `&profitCenter=${encodeURIComponent(selectedPC)}`       : '',
    selectedOrgSection ? `&orgSection=${encodeURIComponent(selectedOrgSection)}` : '',
    selectedOrgGroup   ? `&orgGroup=${encodeURIComponent(selectedOrgGroup)}`     : '',
  ].join('') + globalQs
  const empExportUrl            = `/api/admin/cost-stats/export/employees?${qs}${showAllEmployees ? `&showAllEmployees=1` : ''}${langQs}${filterQs}`
  const summaryExportUrl        = `/api/admin/cost-stats/export/summary?${qs}${incQs}${langQs}${filterQs}`
  const monthlyExportUrl        = `/api/admin/cost-stats/export/monthly?${qs}${incQs}${langQs}${filterQs}`
  const summaryFactoryExportUrl = `/api/admin/cost-stats/export/summary-by-factory?${qs}${langQs}${filterQs}`
  const monthlyFactoryExportUrl = `/api/admin/cost-stats/export/monthly-by-factory?${qs}${langQs}${filterQs}`

  // ── Chart handlers ───────────────────────────────────────────────────────
  const handlePieClick = (data: { profit_center?: string } | null) => {
    if (!data) return
    const pc = data.profit_center
    setSelectedPC(pc === selectedPC ? null : (pc ?? null))
    setSelectedDept(null)
  }

  const handleBarClick = (data: { dept_code?: string } | null) => {
    if (!data) return
    const dc = data.dept_code
    setSelectedDept(dc === selectedDept ? null : (dc ?? null))
  }

  // ── Pie selected color (bar follows pie selection) ────────────────────────
  const pcColorMap: Record<string, string> = {}
  pieData.forEach((d) => { pcColorMap[d.profit_center] = d.color })
  const selectedColor = selectedPC ? (pcColorMap[selectedPC] || CHART_COLORS[0]) : undefined

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 space-y-6">
      {/* Header / Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">開始日期</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="border rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">結束日期</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="border rounded px-2 py-1 text-sm" />
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1 px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? '載入中...' : '查詢'}
        </button>
        <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
          <input type="checkbox" checked={includeAllPC}
            onChange={(e) => setIncludeAllPC(e.target.checked)}
            className="rounded" />
          包含無帳號利潤中心
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
          <input type="checkbox" checked={onlyFoxlinkGroup}
            onChange={(e) => setOnlyFoxlinkGroup(e.target.checked)}
            className="rounded" />
          僅限正崴集團
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
          <input type="checkbox" checked={requireEmployeeId}
            onChange={(e) => setRequireEmployeeId(e.target.checked)}
            className="rounded" />
          有工號
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
          <input type="checkbox" checked={showAllEmployees}
            onChange={(e) => setShowAllEmployees(e.target.checked)}
            className="rounded" />
          顯示所有員工（含未使用/無帳號）
        </label>
        {error && <span className="text-xs text-red-600">{error}</span>}
        {(selectedPC || selectedDept || selectedFactory || selectedOrgSection || selectedOrgGroup) && (
          <button onClick={() => {
            setSelectedPC(null); setSelectedDept(null);
            setSelectedFactory(null); setSelectedOrgSection(null); setSelectedOrgGroup(null);
          }}
            className="px-3 py-1.5 text-sm bg-yellow-100 border border-yellow-400 text-yellow-800 rounded hover:bg-yellow-200">
            顯示全部
          </button>
        )}
      </div>

      {/* 第二行:篩選下拉(選完會在下次「查詢」生效 — 若要立即生效請按查詢按鈕) */}
      <div className="flex flex-wrap items-end gap-3 -mt-2">
        <div>
          <label className="block text-xs text-gray-500 mb-1">廠區</label>
          <select value={selectedFactory ?? ''} onChange={(e) => setSelectedFactory(e.target.value || null)}
            className="border rounded px-2 py-1 text-sm min-w-[140px]">
            <option value="">全部</option>
            {factoryOptions.map(o => <option key={o.code} value={o.code}>{o.code}{o.name ? ` ${o.name}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">部門</label>
          <select value={selectedDept ?? ''} onChange={(e) => setSelectedDept(e.target.value || null)}
            className="border rounded px-2 py-1 text-sm min-w-[180px]">
            <option value="">全部</option>
            {deptOptions.map(o => <option key={o.code} value={o.code}>{o.code}{o.name ? ` ${o.name}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">利潤中心</label>
          <select value={selectedPC ?? ''} onChange={(e) => setSelectedPC(e.target.value || null)}
            className="border rounded px-2 py-1 text-sm min-w-[180px]">
            <option value="">全部</option>
            {pcOptions.map(o => <option key={o.code} value={o.code}>{o.code}{o.name ? ` ${o.name}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">事業處</label>
          <select value={selectedOrgSection ?? ''} onChange={(e) => setSelectedOrgSection(e.target.value || null)}
            className="border rounded px-2 py-1 text-sm min-w-[180px]">
            <option value="">全部</option>
            {orgSectionOptions.map(o => <option key={o.code} value={o.code}>{o.code}{o.name ? ` ${o.name}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">事業群</label>
          <select value={selectedOrgGroup ?? ''} onChange={(e) => setSelectedOrgGroup(e.target.value || null)}
            className="border rounded px-2 py-1 text-sm min-w-[160px]">
            <option value="">全部</option>
            {orgGroupOptions.map(o => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
        </div>
      </div>

      {/* Summary total */}
      {summary.length > 0 && (
        <div className="flex gap-4 text-sm text-gray-600">
          <span>總費用: <strong className="text-blue-700">{fmtCost(totalCost, currency)}</strong></span>
          <span>利潤中心數: <strong>{summary.length}</strong></span>
          <span>員工人數: <strong>{employees.length}</strong></span>
          <span>帳號人數: <strong>{totalAccounts ?? '-'}</strong></span>
          {showAllEmployees && (
            <>
              <span className="text-red-600">未使用: <strong>{employees.filter(e => e.has_usage === false).length}</strong></span>
              <span className="text-orange-600">無帳號: <strong>{employees.filter(e => e.has_account === false).length}</strong></span>
            </>
          )}
          {selectedPC && (
            <span className="text-blue-600 font-medium">
              篩選中: {summary.find(r => r.profit_center === selectedPC)?.profit_center_name || selectedPC}
              {selectedDept && ` > ${barData.find(d => d.dept_code === selectedDept)?.name || selectedDept}`}
            </span>
          )}
        </div>
      )}

      {/* ── Charts row ── */}
      {summary.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

          {/* Summary Pie */}
          <div className="bg-white border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">費用佔比 (利潤中心) — 點擊篩選</h3>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie dataKey="value" data={pieData} cx="50%" cy="50%" outerRadius={90}
                  onClick={handlePieClick} cursor="pointer"
                  label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(1)}%`}
                  labelLine={false}>
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color}
                      opacity={selectedPC && entry.profit_center !== selectedPC ? 0.3 : 1}
                      stroke={selectedPC === entry.profit_center ? '#1e40af' : 'none'}
                      strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number | undefined) => fmtCost(v, currency)} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Dept Bar */}
          <div className="bg-white border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              部門費用 (由高到低){selectedPC ? ` — ${summary.find(r => r.profit_center === selectedPC)?.profit_center_name}` : ''} — 點擊篩選
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <BarChart data={barData} margin={{ left: 10, right: 10, bottom: 40 }}
                onClick={(d: any) => d?.activePayload?.[0] && handleBarClick(d.activePayload[0].payload)}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(3)} />
                <BarTooltip formatter={(v: number | undefined) => fmtCost(v, currency)} />
                <Bar dataKey="value" radius={[3, 3, 0, 0]} cursor="pointer">
                  {barData.map((entry, i) => (
                    <BarCell key={i}
                      fill={selectedColor || entry.color}
                      opacity={selectedDept && entry.dept_code !== selectedDept ? 0.3 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Monthly Pie */}
          <div className="bg-white border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">月份費用佔比 (利潤中心) — 點擊篩選</h3>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie dataKey="value" data={monthlyPieData} cx="50%" cy="50%" outerRadius={90}
                  onClick={handlePieClick} cursor="pointer"
                  label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(1)}%`}
                  labelLine={false}>
                  {monthlyPieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color}
                      opacity={selectedPC && entry.profit_center !== selectedPC ? 0.3 : 1}
                      stroke={selectedPC === entry.profit_center ? '#1e40af' : 'none'}
                      strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number | undefined) => fmtCost(v, currency)} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Monthly Bar */}
          <div className="bg-white border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              月份費用趨勢{selectedPC ? ` — ${summary.find(r => r.profit_center === selectedPC)?.profit_center_name}` : ''}
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyBarData} margin={{ left: 10, right: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(3)} />
                <BarTooltip formatter={(v: number | undefined) => fmtCost(v, currency)} />
                <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                  {monthlyBarData.map((entry, i) => (
                    <BarCell key={i} fill={selectedColor || entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── 利潤中心 總表 ── */}
      <div className="bg-white border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">利潤中心費用總表</h3>
          <ExportBtn href={summaryExportUrl} label="匯出 CSV" filename={`summary_${startDate}_${endDate}.csv`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-blue-600 text-white">
                <th className="px-3 py-2 text-left">利潤中心代碼</th>
                <th className="px-3 py-2 text-left">利潤中心名稱</th>
                <th className="px-3 py-2 text-left">事業處代碼</th>
                <th className="px-3 py-2 text-left">事業處名稱</th>
                <th className="px-3 py-2 text-left">事業群名稱</th>
                <th className="px-3 py-2 text-left">廠區</th>
                <th className="px-3 py-2 text-right">間接員工數</th>
                <th className="px-3 py-2 text-right">帳號人數</th>
                <th className="px-3 py-2 text-right">使用人數</th>
                <th className="px-3 py-2 text-right">費用金額</th>
                <th className="px-3 py-2 text-right">人均費用</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((r, i) => (
                <tr key={i}
                  onClick={() => { setSelectedPC(r.profit_center === selectedPC ? null : r.profit_center); setSelectedDept(null) }}
                  className={`cursor-pointer border-b transition-colors ${selectedPC === r.profit_center ? 'bg-blue-100 font-medium' :
                    r.no_account ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' :
                    i % 2 === 1 ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'
                    }`}>
                  <td className="px-3 py-1.5">
                    {r.profit_center}
                    {r.no_account && <span className="ml-1 text-[10px] text-gray-400">(無帳號)</span>}
                  </td>
                  <td className="px-3 py-1.5">{r.profit_center_name}</td>
                  <td className="px-3 py-1.5">{r.org_section}</td>
                  <td className="px-3 py-1.5">{r.org_section_name}</td>
                  <td className="px-3 py-1.5">{r.org_group_name}</td>
                  <td className="px-3 py-1.5" title={r.factory_other_count ? `含另外 ${r.factory_other_count} 個廠區` : ''}>
                    {fmtFactory(r.factory_code, r.factory_name, r.factory_other_count)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-gray-600">{r.indirect_emp_count}</td>
                  <td className="px-3 py-1.5 text-right text-gray-500">{r.account_count}</td>
                  <td className="px-3 py-1.5 text-right">{r.user_count}</td>
                  <td className="px-3 py-1.5 text-right font-medium text-blue-700">{fmtCost(r.cost, r.currency)}</td>
                  <td className="px-3 py-1.5 text-right text-gray-600">{fmtCost(r.avg_cost, r.currency)}</td>
                </tr>
              ))}
              {summary.length === 0 && (
                <tr><td colSpan={11} className="px-3 py-4 text-center text-gray-400">無資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 利潤中心 × 廠區 明細表 ── */}
      <div className="bg-white border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">
            利潤中心 × 廠區 明細表{selectedPC ? ` — ${summary.find(r => r.profit_center === selectedPC)?.profit_center_name}` : ''}
          </h3>
          <ExportBtn href={summaryFactoryExportUrl} label="匯出 CSV" filename={`summary_by_factory_${startDate}_${endDate}.csv`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-indigo-600 text-white">
                <th className="px-3 py-2 text-left">利潤中心代碼</th>
                <th className="px-3 py-2 text-left">利潤中心名稱</th>
                <th className="px-3 py-2 text-left">事業處代碼</th>
                <th className="px-3 py-2 text-left">事業處名稱</th>
                <th className="px-3 py-2 text-left">事業群名稱</th>
                <th className="px-3 py-2 text-left">廠區代碼</th>
                <th className="px-3 py-2 text-left">廠區名稱</th>
                <th className="px-3 py-2 text-right">間接員工數</th>
                <th className="px-3 py-2 text-right">帳號人數</th>
                <th className="px-3 py-2 text-right">使用人數</th>
                <th className="px-3 py-2 text-right">費用金額</th>
                <th className="px-3 py-2 text-right">人均費用</th>
              </tr>
            </thead>
            <tbody>
              {(selectedPC ? factoryRows.filter((r) => r.profit_center === selectedPC) : factoryRows).map((r, i) => {
                const unassigned = !r.factory_code
                return (
                  <tr key={i} className={`border-b ${
                    unassigned ? 'bg-gray-100 text-gray-500' :
                    i % 2 === 1 ? 'bg-indigo-50' : ''
                  }`}>
                    <td className="px-3 py-1.5">{r.profit_center}</td>
                    <td className="px-3 py-1.5">{r.profit_center_name}</td>
                    <td className="px-3 py-1.5">{r.org_section}</td>
                    <td className="px-3 py-1.5">{r.org_section_name}</td>
                    <td className="px-3 py-1.5">{r.org_group_name}</td>
                    <td className="px-3 py-1.5 font-mono">{r.factory_code || <span className="text-gray-400">(未歸屬)</span>}</td>
                    <td className="px-3 py-1.5">{r.factory_name || '-'}</td>
                    <td className="px-3 py-1.5 text-right text-gray-600">{r.indirect_emp_count}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500">{r.account_count}</td>
                    <td className="px-3 py-1.5 text-right">{r.user_count}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-indigo-700">{fmtCost(r.cost, r.currency)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-600">{fmtCost(r.avg_cost, r.currency)}</td>
                  </tr>
                )
              })}
              {factoryRows.length === 0 && (
                <tr><td colSpan={12} className="px-3 py-4 text-center text-gray-400">無資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 月分析表 ── */}
      <div className="bg-white border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">
            月份費用分析表{selectedPC ? ` — ${summary.find(r => r.profit_center === selectedPC)?.profit_center_name}` : ''}
          </h3>
          <ExportBtn href={monthlyExportUrl} label="匯出 CSV" filename={`monthly_${startDate}_${endDate}.csv`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-blue-600 text-white">
                <th className="px-3 py-2 text-left">利潤中心代碼</th>
                <th className="px-3 py-2 text-left">利潤中心名稱</th>
                <th className="px-3 py-2 text-left">事業處代碼</th>
                <th className="px-3 py-2 text-left">事業處名稱</th>
                <th className="px-3 py-2 text-left">事業群名稱</th>
                <th className="px-3 py-2 text-left">月份</th>
                <th className="px-3 py-2 text-left">廠區</th>
                <th className="px-3 py-2 text-right">間接員工數</th>
                <th className="px-3 py-2 text-right">帳號人數</th>
                <th className="px-3 py-2 text-right">使用人數</th>
                <th className="px-3 py-2 text-right">費用金額</th>
                <th className="px-3 py-2 text-right">人均費用</th>
              </tr>
            </thead>
            <tbody>
              {(selectedPC ? monthly.filter((r) => r.profit_center === selectedPC) : monthly).map((r, i) => (
                <tr key={i} className={`border-b ${
                  r.no_account ? 'bg-gray-100 text-gray-500' :
                  i % 2 === 1 ? 'bg-blue-50' : ''
                }`}>
                  <td className="px-3 py-1.5">
                    {r.profit_center}
                    {r.no_account && <span className="ml-1 text-[10px] text-gray-400">(無帳號)</span>}
                  </td>
                  <td className="px-3 py-1.5">{r.profit_center_name}</td>
                  <td className="px-3 py-1.5">{r.org_section}</td>
                  <td className="px-3 py-1.5">{r.org_section_name}</td>
                  <td className="px-3 py-1.5">{r.org_group_name}</td>
                  <td className="px-3 py-1.5 font-medium">{r.month}</td>
                  <td className="px-3 py-1.5" title={r.factory_other_count ? `含另外 ${r.factory_other_count} 個廠區` : ''}>
                    {fmtFactory(r.factory_code, r.factory_name, r.factory_other_count)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-gray-600">{r.indirect_emp_count}</td>
                  <td className="px-3 py-1.5 text-right text-gray-500">{r.account_count}</td>
                  <td className="px-3 py-1.5 text-right">{r.user_count}</td>
                  <td className="px-3 py-1.5 text-right font-medium text-blue-700">{fmtCost(r.cost, r.currency)}</td>
                  <td className="px-3 py-1.5 text-right text-gray-600">{fmtCost(r.avg_cost, r.currency)}</td>
                </tr>
              ))}
              {monthly.length === 0 && (
                <tr><td colSpan={12} className="px-3 py-4 text-center text-gray-400">無資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 利潤中心 × 月份 × 廠區 明細表 ── */}
      <div className="bg-white border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">
            利潤中心 × 月份 × 廠區 明細表{selectedPC ? ` — ${summary.find(r => r.profit_center === selectedPC)?.profit_center_name}` : ''}
          </h3>
          <ExportBtn href={monthlyFactoryExportUrl} label="匯出 CSV" filename={`monthly_by_factory_${startDate}_${endDate}.csv`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-indigo-600 text-white">
                <th className="px-3 py-2 text-left">利潤中心代碼</th>
                <th className="px-3 py-2 text-left">利潤中心名稱</th>
                <th className="px-3 py-2 text-left">事業處代碼</th>
                <th className="px-3 py-2 text-left">事業處名稱</th>
                <th className="px-3 py-2 text-left">事業群名稱</th>
                <th className="px-3 py-2 text-left">月份</th>
                <th className="px-3 py-2 text-left">廠區代碼</th>
                <th className="px-3 py-2 text-left">廠區名稱</th>
                <th className="px-3 py-2 text-right">間接員工數</th>
                <th className="px-3 py-2 text-right">帳號人數</th>
                <th className="px-3 py-2 text-right">使用人數</th>
                <th className="px-3 py-2 text-right">費用金額</th>
                <th className="px-3 py-2 text-right">人均費用</th>
              </tr>
            </thead>
            <tbody>
              {(selectedPC ? factoryMonthly.filter((r) => r.profit_center === selectedPC) : factoryMonthly).map((r, i) => {
                const unassigned = !r.factory_code
                return (
                  <tr key={i} className={`border-b ${
                    unassigned ? 'bg-gray-100 text-gray-500' :
                    i % 2 === 1 ? 'bg-indigo-50' : ''
                  }`}>
                    <td className="px-3 py-1.5">{r.profit_center}</td>
                    <td className="px-3 py-1.5">{r.profit_center_name}</td>
                    <td className="px-3 py-1.5">{r.org_section}</td>
                    <td className="px-3 py-1.5">{r.org_section_name}</td>
                    <td className="px-3 py-1.5">{r.org_group_name}</td>
                    <td className="px-3 py-1.5 font-medium">{r.month}</td>
                    <td className="px-3 py-1.5 font-mono">{r.factory_code || <span className="text-gray-400">(未歸屬)</span>}</td>
                    <td className="px-3 py-1.5">{r.factory_name || '-'}</td>
                    <td className="px-3 py-1.5 text-right text-gray-600">{r.indirect_emp_count}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500">{r.account_count}</td>
                    <td className="px-3 py-1.5 text-right">{r.user_count}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-indigo-700">{fmtCost(r.cost, r.currency)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-600">{fmtCost(r.avg_cost, r.currency)}</td>
                  </tr>
                )
              })}
              {factoryMonthly.length === 0 && (
                <tr><td colSpan={13} className="px-3 py-4 text-center text-gray-400">無資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 員工明細 ── */}
      <div className="bg-white border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">
            Token 使用清單
            {filteredEmps.length !== employees.length && ` (篩選後 ${filteredEmps.length}/${employees.length} 人)`}
          </h3>
          <ExportBtn href={empExportUrl} label="匯出 CSV" filename={`employees_${startDate}_${endDate}.csv`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-blue-600 text-white">
                <th className="px-3 py-2 text-left">工號</th>
                <th className="px-3 py-2 text-left">姓名</th>
                <th className="px-3 py-2 text-center">有帳號</th>
                <th className="px-3 py-2 text-left">部門代碼</th>
                <th className="px-3 py-2 text-left">部門名稱</th>
                <th className="px-3 py-2 text-left">利潤中心</th>
                <th className="px-3 py-2 text-left">事業處</th>
                <th className="px-3 py-2 text-left">事業群</th>
                <th className="px-3 py-2 text-left">廠區</th>
                <th className="px-3 py-2 text-right">Input Tokens</th>
                <th className="px-3 py-2 text-right">Output Tokens</th>
                <th className="px-3 py-2 text-right">費用金額</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmps.map((r, i) => {
                const noUsage = r.has_usage === false
                return (
                  <tr key={i} className={`border-b ${
                    noUsage ? 'bg-gray-50 text-gray-500' :
                    i % 2 === 1 ? 'bg-blue-50' : ''
                  }`}>
                    <td className="px-3 py-1.5 font-mono">{r.employee_id || '-'}</td>
                    <td className="px-3 py-1.5">{r.user_name}</td>
                    <td className="px-3 py-1.5 text-center">
                      {r.has_account === false ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-700 font-medium">無</span>
                      ) : (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-green-100 text-green-700 font-medium">✓</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">{r.dept_code || '-'}</td>
                    <td className="px-3 py-1.5">{r.dept_name || '-'}</td>
                    <td className="px-3 py-1.5">{r.profit_center_name || r.profit_center || '-'}</td>
                    <td className="px-3 py-1.5">{r.org_section_name || r.org_section || '-'}</td>
                    <td className="px-3 py-1.5">{r.org_group_name || '-'}</td>
                    <td className="px-3 py-1.5">{fmtFactory(r.factory_code, r.factory_name)}</td>
                    <td className="px-3 py-1.5 text-right">{fmtTokens(r.input_tokens)}</td>
                    <td className="px-3 py-1.5 text-right">{fmtTokens(r.output_tokens)}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-blue-700">{fmtCost(r.cost, r.currency)}</td>
                  </tr>
                )
              })}
              {filteredEmps.length === 0 && (
                <tr><td colSpan={12} className="px-3 py-4 text-center text-gray-400">無資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
