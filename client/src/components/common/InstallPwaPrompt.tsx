// PWA「加到主畫面」提示 — 只在 mobile 顯示,user 拒絕後 7 天內不再煩
// 桌機 / 已 standalone 模式 / 已關閉過 → 不顯示
import { useEffect, useState } from 'react'
import { Smartphone, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { onInstallPromptChange, isStandalone, type InstallPromptHandle } from '../../lib/pwa'
import { useDeviceProfile } from '../../hooks/useDeviceProfile'

const DISMISS_KEY = 'pwa_install_dismissed_at'
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000

function isDismissedRecently(): boolean {
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY) || 0)
    return ts > 0 && Date.now() - ts < DISMISS_TTL_MS
  } catch {
    return false
  }
}

export default function InstallPwaPrompt() {
  const { t } = useTranslation()
  const { isMobile } = useDeviceProfile()
  const [handle, setHandle] = useState<InstallPromptHandle | null>(null)
  const [hidden, setHidden] = useState(() => isStandalone() || isDismissedRecently())

  useEffect(() => {
    return onInstallPromptChange((h) => setHandle(h))
  }, [])

  if (!isMobile) return null
  if (hidden) return null
  if (!handle) return null // 還沒收到 beforeinstallprompt(iOS 永遠不會收到)

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}
    setHidden(true)
  }

  const install = async () => {
    try {
      const r = await handle.prompt()
      if (r === 'dismissed') dismiss()
    } catch {
      dismiss()
    }
  }

  return (
    <div className="fixed bottom-4 left-3 right-3 z-50 bg-white border border-blue-200 rounded-xl shadow-lg p-3 flex items-center gap-3 pb-safe">
      <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
        <Smartphone size={20} className="text-blue-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800">{t('mobile.install.title')}</p>
        <p className="text-xs text-slate-500">{t('mobile.install.desc')}</p>
      </div>
      <button
        onClick={install}
        className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-2"
      >
        {t('mobile.install.action')}
      </button>
      <button
        onClick={dismiss}
        className="text-slate-400 hover:text-slate-600 p-1"
        aria-label={t('common.close')}
      >
        <X size={16} />
      </button>
    </div>
  )
}
