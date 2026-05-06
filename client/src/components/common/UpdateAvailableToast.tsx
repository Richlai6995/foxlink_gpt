// 新版可用提示 toast — 桌機/手機都顯示在右下角(手機右下安全區)
// 點「更新」→ skipWaiting + reload;點 ✕ 暫時關閉(下次刷新前不再煩,但下次有新版會再彈)
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, X } from 'lucide-react'
import { onUpdateAvailable, applyUpdate } from '../../lib/pwa'

export default function UpdateAvailableToast() {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    return onUpdateAvailable((needRefresh) => {
      if (needRefresh) setShow(true)
    })
  }, [])

  if (!show) return null

  const handleUpdate = async () => {
    setReloading(true)
    await applyUpdate()
    // applyUpdate 會觸發 controllerchange → 自動 reload,這裡保險再 reload 一次
    setTimeout(() => window.location.reload(), 1000)
  }

  return (
    <div className="fixed z-[70] bottom-4 left-3 right-3 sm:left-auto sm:right-4 sm:max-w-sm pb-safe">
      <div className="bg-white border border-blue-200 rounded-xl shadow-lg p-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
          <RefreshCw size={18} className={`text-blue-600 ${reloading ? 'animate-spin' : ''}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">
            {t('pwa.update.title', '新版本可用')}
          </p>
          <p className="text-xs text-slate-500 truncate">
            {t('pwa.update.desc', '點「更新」載入最新功能')}
          </p>
        </div>
        <button
          onClick={handleUpdate}
          disabled={reloading}
          className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg px-3 py-2 flex-shrink-0 inline-flex items-center gap-1.5"
        >
          <RefreshCw size={12} className={reloading ? 'animate-spin' : ''} />
          {reloading ? t('pwa.update.applying', '更新中…') : t('pwa.update.action', '更新')}
        </button>
        <button
          onClick={() => setShow(false)}
          aria-label={t('common.close')}
          className="text-slate-400 hover:text-slate-600 p-1 flex-shrink-0"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
