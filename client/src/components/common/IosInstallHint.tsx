// iOS Safari 在非 standalone 模式時顯示「加到主畫面」教學
// iOS 不支援 beforeinstallprompt,所以 InstallPwaPrompt 對 iOS 永遠不彈
// 這個 component 補上 iOS 專屬教學:點分享 → 加到主畫面
import { useState } from 'react'
import { Share, Plus, X } from 'lucide-react'
import { useDeviceProfile } from '../../hooks/useDeviceProfile'
import { isStandalone, isIOS } from '../../lib/pwa'

const DISMISS_KEY = 'ios_install_hint_dismissed_at'
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000

function isDismissedRecently(): boolean {
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY) || 0)
    return ts > 0 && Date.now() - ts < DISMISS_TTL_MS
  } catch {
    return false
  }
}

export default function IosInstallHint() {
  const { isMobile } = useDeviceProfile()
  const [hidden, setHidden] = useState(() => isStandalone() || isDismissedRecently())
  const [expanded, setExpanded] = useState(false)

  if (!isMobile || !isIOS() || hidden) return null

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}
    setHidden(true)
  }

  return (
    <div className="fixed bottom-4 left-3 right-3 z-50 bg-white border border-blue-200 rounded-xl shadow-lg pb-safe">
      <div className="p-3 flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
          <Plus size={20} className="text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800">加到主畫面</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            點 Safari 底部的{' '}
            <Share size={11} className="inline align-text-top text-blue-600" />{' '}
            <span className="text-blue-600">「分享」</span>
            ,選「<span className="text-blue-600">加入主畫面</span>」即可全螢幕使用
          </p>
          {expanded && (
            <ol className="mt-2 text-xs text-slate-600 space-y-1 list-decimal list-inside">
              <li>點底部的 <Share size={11} className="inline align-text-top text-blue-600" /> 分享按鈕</li>
              <li>下滑找到「加入主畫面」(Add to Home Screen)</li>
              <li>右上角點「加入」</li>
              <li>從主畫面開啟即可全螢幕</li>
            </ol>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] text-blue-600 mt-1"
          >
            {expanded ? '收起' : '看詳細步驟'}
          </button>
        </div>
        <button
          onClick={dismiss}
          aria-label="關閉"
          className="text-slate-400 p-1 flex-shrink-0"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
