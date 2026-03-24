import { useState, useMemo } from 'react'
import { Users } from 'lucide-react'
import ReactECharts from 'echarts-for-react'

interface OnlineUser {
  id: number
  username: string
  name: string
  employee_id: string
  email: string | null
  role: string
  loginTime: string | null
}

interface Snapshot {
  online_count: number
  collected_at: string
}

interface Props {
  current: { count: number; users: OnlineUser[] }
  history: Snapshot[]
  loading: boolean
}

export default function OnlineUsersPanel({ current, history, loading }: Props) {
  const [showUsers, setShowUsers] = useState(true)

  const chartOption = useMemo(() => ({
    tooltip: { trigger: 'axis' as const },
    grid: { top: 20, right: 20, bottom: 30, left: 40 },
    xAxis: {
      type: 'category' as const,
      data: history.map(h => {
        const d = new Date(h.collected_at)
        return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
      }),
      axisLabel: { fontSize: 10 },
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
  }), [history])

  if (loading) return <div className="animate-pulse h-48 bg-white border rounded-lg" />

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Users size={14} className="text-blue-500" />
        <span className="text-sm font-medium text-slate-700">線上人數</span>
        <span className="text-lg font-bold text-blue-600 ml-2">{current.count}</span>
        <button
          onClick={() => setShowUsers(!showUsers)}
          className="ml-auto text-xs text-blue-500 hover:text-blue-700"
        >
          {showUsers ? '隱藏清單' : '顯示清單'}
        </button>
      </div>

      {showUsers && current.users.length > 0 && (
        <div className="max-h-52 overflow-auto border rounded">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1 text-slate-500">工號</th>
                <th className="text-left px-2 py-1 text-slate-500">姓名</th>
                <th className="text-left px-2 py-1 text-slate-500">帳號</th>
                <th className="text-left px-2 py-1 text-slate-500">角色</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {current.users.map(u => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-2 py-1 font-mono">{u.employee_id || '-'}</td>
                  <td className="px-2 py-1">{u.name}</td>
                  <td className="px-2 py-1 text-slate-400">{u.username}</td>
                  <td className="px-2 py-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${u.role === 'admin' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                      {u.role === 'admin' ? '管理員' : '使用者'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {history.length > 0 && (
        <ReactECharts option={chartOption} style={{ height: 160 }} opts={{ renderer: 'svg' }} />
      )}
      {history.length === 0 && (
        <div className="text-xs text-slate-400 text-center py-4">尚無歷史資料</div>
      )}
    </div>
  )
}
