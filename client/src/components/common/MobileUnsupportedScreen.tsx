// 手機不支援的頁面攔截
// admin / training / dashboard / scheduled-tasks / kb / pm 等重型頁面在手機難用,
// 顯示「請使用桌機開啟」+ 回 chat / 登出 入口
import { useNavigate } from 'react-router-dom'
import { Monitor, MessageSquare, LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'

interface Props {
  /** i18n key 路徑(例如:admin, training, dashboard);未提供則用 generic 標題 */
  pageKey?: string
  /** legacy 直接傳譯文(向下相容) */
  pageName?: string
}

export default function MobileUnsupportedScreen({ pageKey, pageName }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { logout } = useAuth()

  const localizedPageName = pageKey
    ? t(`mobile.unsupported.page.${pageKey}`)
    : pageName

  const title = localizedPageName
    ? t('mobile.unsupported.title', { page: localizedPageName })
    : t('mobile.unsupported.titleGeneric')

  return (
    <div className="min-h-dvh bg-slate-50 flex flex-col items-center justify-center px-6 pt-safe pb-safe">
      <div className="max-w-sm w-full text-center space-y-5">
        <div className="w-20 h-20 mx-auto rounded-2xl bg-blue-100 border border-blue-200 flex items-center justify-center">
          <Monitor size={36} className="text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-800 mb-2">{title}</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            {t('mobile.unsupported.desc')}
          </p>
        </div>

        <div className="pt-2 space-y-2">
          <button
            onClick={() => navigate('/chat')}
            className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium rounded-lg py-3 inline-flex items-center justify-center gap-2 transition"
          >
            <MessageSquare size={16} />
            {t('mobile.unsupported.backToChat')}
          </button>
          <button
            onClick={logout}
            className="w-full border border-slate-300 hover:bg-slate-100 active:bg-slate-200 text-slate-700 text-sm rounded-lg py-3 inline-flex items-center justify-center gap-2 transition"
          >
            <LogOut size={14} />
            {t('mobile.unsupported.logout')}
          </button>
        </div>
      </div>
    </div>
  )
}
