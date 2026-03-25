import { useState, useEffect, useMemo, useCallback } from 'react'
import { Users, X, Download, Maximize2 } from 'lucide-react'
import ReactECharts from 'echarts-for-react'
import api from '../../lib/api'

interface OnlineUser {
  id: number
  username: string
  name: string
  employee_id: string
  email: string | null
  role: string
  loginTime: string | null
  dept_code: string | null
  profit_center: string | null
  org_section: string | null
  org_group_name: string | null
}

interface Snapshot {
  online_count: number
  collected_at: string
}

interface Props {
  current: { count: number; users: OnlineUser[] }
  loading: boolean
}

export default function OnlineUsersPanel({ current, loading }: Props) {
  const [showModal, setShowModal] = useState(false)
  const [hours, setHours] = useState(24)
  const [history, setHistory] = useState<Snapshot[]>([])

  useEffect(() => {
    api.get(`/monitor/online-users/history?hours=${hours}`)
      .then(({ data }) => setHistory(data || []))
      .catch(() => setHistory([]))
  }, [hours])

  const chartOption = useMemo(() => ({
    tooltip: { trigger: 'axis' as const },
    grid: { top: 20, right: 20, bottom: 30, left: 40 },
    xAxis: {
      type: 'category' as const,
      data: history.map(h => {
        const d = new Date(h.collected_at)
        return hours > 48
          ? `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
          : `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
      }),
      axisLabel: { fontSize: 9, rotate: hours > 48 ? 30 : 0 },
    },
    yAxis: { type: 'value' as const, minInterval: 1, axisLabel: { fontSize: 10 } },
    series: [{
      type: 'line',
      data: history.map(h => h.online_count),
      smooth: true,
      areaStyle: { opacity: 0.15 },
      lineStyle: { width: 2 },
      itemStyle: { color: '#3b82f6' },
    }],
  }), [history, hours])

  const exportCsv = useCallback(() => {
    const BOM = '\uFEFF'
    const headers = ['工號', '姓名', '帳號', '角色', '部門', '利潤中心', '事業處', '事業群']
    const rows = current.users.map(u => [
      u.employee_id || '',
      u.name || '',
      u.username || '',
      u.role === 'admin' ? '管理員' : '使用者',
      u.dept_code || '',
      u.profit_center || '',
      u.org_section || '',
      u.org_group_name || '',
    ])
    const csv = BOM + [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `online_users_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [current.users])

  if (loading) return <div className="animate-pulse h-48 bg-white border rounded-lg" />

  const compactTable = (
    <div className="max-h-40 overflow-auto border rounded text-xs">
      <table className="w-full">
        <thead className="bg-slate-50 sticky top-0">
          <tr>
            <th className="text-left px-2 py-1 text-slate-500">工號</th>
            <th className="text-left px-2 py-1 text-slate-500">姓名</th>
            <th className="text-left px-2 py-1 text-slate-500">角色</th>
            <th className="text-left px-2 py-1 text-slate-500">部門</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {current.users.map(u => (
            <tr key={u.id} className="hover:bg-slate-50">
              <td className="px-2 py-1 font-mono">{u.employee_id || '-'}</td>
              <td className="px-2 py-1">{u.name}</td>
              <td className="px-2 py-1">
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${u.role === 'admin' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                  {u.role === 'admin' ? '管理員' : '使用者'}
                </span>
              </td>
              <td className="px-2 py-1 text-slate-500">{u.dept_code || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Users size={14} className="text-blue-500" />
          <span className="text-sm font-medium text-slate-700">線上人數</span>
          <span className="text-lg font-bold text-blue-600 ml-2">{current.count}</span>
          <div className="ml-auto flex items-center gap-1">
            <select
              value={hours}
              onChange={e => setHours(Number(e.target.value))}
              className="text-xs border rounded px-1.5 py-0.5"
            >
              <option value={6}>6h</option>
              <option value={12}>12h</option>
              <option value={24}>24h</option>
              <option value={72}>3d</option>
              <option value={168}>7d</option>
              <option value={336}>14d</option>
              <option value={720}>30d</option>
            </select>
            <button
              onClick={exportCsv}
              className="p-1 text-slate-400 hover:text-blue-600 rounded"
              title="匯出 CSV"
            >
              <Download size={14} />
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="p-1 text-slate-400 hover:text-blue-600 rounded"
              title="展開完整清單"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>

        {current.users.length > 0 && compactTable}

        {history.length > 0 && (
          <ReactECharts option={chartOption} style={{ height: 160 }} opts={{ renderer: 'svg' }} />
        )}
        {history.length === 0 && (
          <div className="text-xs text-slate-400 text-center py-4">尚無歷史資料</div>
        )}
      </div>

      {/* Full detail modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-blue-500" />
                <span className="font-semibold text-slate-700">線上人員清單</span>
                <span className="text-sm text-slate-400">({current.count} 人)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={exportCsv}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition"
                >
                  <Download size={13} />
                  匯出 CSV
                </button>
                <button onClick={() => setShowModal(false)} className="p-1 text-slate-400 hover:text-slate-600">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 text-slate-500 font-medium whitespace-nowrap">工號</th>
                    <th className="text-left px-3 py-2 text-slate-500 font-medium whitespace-nowrap">姓名</th>
                    <th className="text-left px-3 py-2 text-slate-500 font-medium whitespace-nowrap">帳號</th>
                    <th className="text-left px-3 py-2 text-slate-500 font-medium whitespace-nowrap">角色</th>
                    <th className="text-left px-3 py-2 text-slate-500 font-medium whitespace-nowrap">部門</th>
                    <th className="text-left px-3 py-2 text-slate-500 font-medium whitespace-nowrap">利潤中心</th>
                    <th className="text-left px-3 py-2 text-slate-500 font-medium whitespace-nowrap">事業處</th>
                    <th className="text-left px-3 py-2 text-slate-500 font-medium whitespace-nowrap">事業群</th>
                    <th className="text-left px-3 py-2 text-slate-500 font-medium whitespace-nowrap">Email</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {current.users.map(u => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono text-xs">{u.employee_id || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{u.name}</td>
                      <td className="px-3 py-2 text-slate-400">{u.username}</td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${u.role === 'admin' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                          {u.role === 'admin' ? '管理員' : '使用者'}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{u.dept_code || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{u.profit_center || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{u.org_section || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{u.org_group_name || '-'}</td>
                      <td className="px-3 py-2 text-slate-400 text-xs">{u.email || '-'}</td>
                    </tr>
                  ))}
                  {current.users.length === 0 && (
                    <tr><td colSpan={9} className="text-center py-8 text-slate-400">目前無線上人員</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
