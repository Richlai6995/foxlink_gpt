import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Cpu } from 'lucide-react'
import ScheduledTasksPanel from '../components/admin/ScheduledTasksPanel'

export default function ScheduledTasksPage() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <Cpu size={14} className="text-white" />
          </div>
          <span className="font-bold">FOXLINK GPT</span>
          <span className="text-slate-500 text-sm">/ 排程任務</span>
        </div>
        <button
          onClick={() => navigate('/chat')}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition"
        >
          <ArrowLeft size={15} /> 返回聊天
        </button>
      </header>
      <div className="p-6 max-w-6xl mx-auto">
        <ScheduledTasksPanel />
      </div>
    </div>
  )
}
