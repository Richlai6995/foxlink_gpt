// 手機不支援的頁面攔截
// admin / training / dashboard / scheduled-tasks / kb / pm 等重型頁面在手機難用,
// 顯示「請使用桌機開啟」+ 回 chat / 登出 入口
import { useNavigate } from 'react-router-dom'
import { Monitor, MessageSquare, LogOut } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

interface Props {
  /** 頁面名稱(例如:管理後台、教育訓練、AI 戰情)*/
  pageName?: string
}

export default function MobileUnsupportedScreen({ pageName }: Props) {
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <div className="min-h-dvh bg-slate-50 flex flex-col items-center justify-center px-6 pt-safe pb-safe">
      <div className="max-w-sm w-full text-center space-y-5">
        <div className="w-20 h-20 mx-auto rounded-2xl bg-blue-100 border border-blue-200 flex items-center justify-center">
          <Monitor size={36} className="text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-800 mb-2">
            {pageName ? `${pageName}` : '此頁面'}尚未支援手機
          </h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            這個功能介面較複雜,目前請使用桌機瀏覽器開啟,以獲得完整體驗。
          </p>
        </div>

        <div className="pt-2 space-y-2">
          <button
            onClick={() => navigate('/chat')}
            className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium rounded-lg py-3 inline-flex items-center justify-center gap-2 transition"
          >
            <MessageSquare size={16} />
            回到對話
          </button>
          <button
            onClick={logout}
            className="w-full border border-slate-300 hover:bg-slate-100 active:bg-slate-200 text-slate-700 text-sm rounded-lg py-3 inline-flex items-center justify-center gap-2 transition"
          >
            <LogOut size={14} />
            登出
          </button>
        </div>
      </div>
    </div>
  )
}
