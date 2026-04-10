import { useEffect, useState } from 'react'
import { Mic, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useMic } from '../context/MicContext'

/**
 * VoiceHotkeyHint — 首次 focus textarea/input 時提示「按 Alt+M 可語音輸入」
 *
 * 邏輯:
 *   - 監聽全域 focusin
 *   - 第一次焦點進入可編輯元素時,延遲 800ms 跳出提示 (避免閃太快)
 *   - 點 X 永久關掉,記到 localStorage
 *   - 自動 12 秒後消失 (但不算 dismiss,下次 focus 還會出現,直到使用者手動關)
 */

const STORAGE_KEY = 'fl_voice_hotkey_hint_dismissed'

export default function VoiceHotkeyHint() {
  const { t } = useTranslation()
  const mic = useMic()
  const [show, setShow] = useState(false)
  const [dismissed, setDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1',
  )

  useEffect(() => {
    if (dismissed || !mic.enabled) return

    let pendingTimer: number | null = null
    let autoHideTimer: number | null = null

    const isEditable = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false
      if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly
      if (el instanceof HTMLInputElement) {
        const ok = ['text', 'search', 'url', 'tel', 'email', 'password', '']
        return !el.disabled && !el.readOnly && ok.includes(el.type || 'text')
      }
      if (el.isContentEditable) return true
      return false
    }

    const handler = (e: FocusEvent) => {
      if (!isEditable(e.target)) return
      if (pendingTimer) window.clearTimeout(pendingTimer)
      pendingTimer = window.setTimeout(() => {
        setShow(true)
        if (autoHideTimer) window.clearTimeout(autoHideTimer)
        autoHideTimer = window.setTimeout(() => setShow(false), 12000)
      }, 800)
    }

    document.addEventListener('focusin', handler)
    return () => {
      document.removeEventListener('focusin', handler)
      if (pendingTimer) window.clearTimeout(pendingTimer)
      if (autoHideTimer) window.clearTimeout(autoHideTimer)
    }
  }, [dismissed, mic.enabled])

  const handleDismiss = () => {
    setShow(false)
    setDismissed(true)
    try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
  }

  if (!show || dismissed || !mic.enabled) return null

  return (
    <div className="fixed bottom-24 right-6 z-[9998] max-w-[280px] animate-in fade-in slide-in-from-bottom-2">
      <div className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-2xl shadow-2xl p-4 relative">
        <button
          onClick={handleDismiss}
          className="absolute top-2 right-2 text-white/70 hover:text-white transition"
          title={t('voice_input.hotkey_close', '知道了')}
        >
          <X size={14} />
        </button>
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
            <Mic size={16} />
          </div>
          <div className="flex-1 pr-3">
            <div className="text-xs font-semibold mb-1">
              {t('voice_input.hotkey_hint_title', '小提示')}
            </div>
            <div className="text-xs leading-relaxed text-white/95">
              {t(
                'voice_input.hotkey_hint',
                '在任何輸入框按 Alt+M 可使用語音輸入,把麥克風講的話自動轉成文字。',
              )}
            </div>
            <button
              onClick={handleDismiss}
              className="mt-2 text-[11px] bg-white/20 hover:bg-white/30 transition px-2.5 py-1 rounded-full"
            >
              {t('voice_input.hotkey_close', '知道了,不再顯示')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
