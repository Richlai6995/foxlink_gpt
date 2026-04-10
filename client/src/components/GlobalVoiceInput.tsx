import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useVoiceInput, type VoiceInputErrorType } from '../hooks/useVoiceInput'
import { useMic } from '../context/MicContext'

/**
 * GlobalVoiceInput — 全域語音輸入熱鍵
 *
 * 操作:
 *   1. 點到任何 <input> / <textarea> / contenteditable
 *   2. 按 Alt+M 開始錄音 (右下角浮出小 UI)
 *   3. 講話 → 再按 Alt+M 或 Esc 停止
 *   4. 結果插入到剛剛的游標位置 (不覆蓋原文字)
 *
 * 沿用 useVoiceInput hook,所以 A+B 雙軌、互鎖、語系自動偵測都繼承。
 *
 * 寫入 React-controlled input 的關鍵 trick:
 *   用 native value setter + dispatch synthetic input event,
 *   這樣 React useState 管的 textarea 才會收到更新。
 */

const LOCK_ID = 'global-voice-hotkey'

function isEditableElement(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false
  if (el instanceof HTMLTextAreaElement) {
    return !el.disabled && !el.readOnly
  }
  if (el instanceof HTMLInputElement) {
    const allowed = ['text', 'search', 'url', 'tel', 'email', 'password', '']
    return !el.disabled && !el.readOnly && allowed.includes(el.type || 'text')
  }
  if (el.isContentEditable) return true
  return false
}

/** 寫入 React-controlled input/textarea — 觸發 onChange handler */
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) {
    setter.call(el, value)
  } else {
    el.value = value
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export default function GlobalVoiceInput() {
  const { t, i18n } = useTranslation()
  const mic = useMic()

  const targetRef = useRef<HTMLElement | null>(null)
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 })
  const [voicePreview, setVoicePreview] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const lang = i18n.language?.startsWith('en')
    ? 'en'
    : i18n.language?.startsWith('vi')
    ? 'vi'
    : 'zh-TW'

  const handleError = useCallback(
    (type: VoiceInputErrorType, msg?: string) => {
      const map: Record<VoiceInputErrorType, string> = {
        permission:        t('voice_input.error.permission', '請允許麥克風權限'),
        no_mic:            t('voice_input.error.no_mic', '找不到麥克風'),
        transcribe_failed: t('voice_input.error.transcribe_failed', '辨識失敗,請重試'),
        too_long:          t('voice_input.error.too_long', '錄音已達上限,自動停止'),
        unsupported:       t('voice_input.error.unsupported', '瀏覽器不支援錄音'),
        unknown:           t('voice_input.error.unknown', '發生錯誤'),
      }
      setErrorMsg(map[type] || msg || '')
      setTimeout(() => setErrorMsg(''), 3000)
      mic.releaseLock(LOCK_ID)
    },
    [t, mic],
  )

  const handleFinal = useCallback(
    (text: string) => {
      const el = targetRef.current
      mic.releaseLock(LOCK_ID)
      setVoicePreview('')
      if (!el || !text) return

      try {
        if (
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement
        ) {
          const { start, end } = selectionRef.current
          const cur = el.value || ''
          const safeStart = Math.min(Math.max(0, start), cur.length)
          const safeEnd = Math.min(Math.max(safeStart, end), cur.length)
          const newValue = cur.slice(0, safeStart) + text + cur.slice(safeEnd)
          setNativeValue(el, newValue)
          requestAnimationFrame(() => {
            try {
              el.focus()
              const pos = safeStart + text.length
              el.selectionStart = el.selectionEnd = pos
            } catch {}
          })
        } else if (el.isContentEditable) {
          el.focus()
          // contenteditable 用 execCommand 插入 (deprecated 但跨瀏覽器最穩)
          document.execCommand('insertText', false, text)
        }
      } catch (e) {
        console.warn('[GlobalVoiceInput] insert failed:', e)
      }
    },
    [mic],
  )

  const { state, volume, countdown, start, stop } = useVoiceInput({
    lang,
    maxDuration: 180,
    source: 'global-hotkey',
    preferBackendOnly: mic.preferBackendOnly,
    onInterim: setVoicePreview,
    onFinal: handleFinal,
    onError: handleError,
  })

  // ─── 全域 keydown listener: Alt+M ────────────────────────────────────────
  useEffect(() => {
    if (!mic.enabled) return

    const handler = (e: KeyboardEvent) => {
      // Alt+M (不分大小寫)
      if (!e.altKey) return
      if (e.key !== 'm' && e.key !== 'M') return
      // 排除其他 modifier
      if (e.ctrlKey || e.metaKey) return

      e.preventDefault()
      e.stopPropagation()

      // 已在錄音 → 停止
      if (state === 'recording') {
        stop()
        return
      }
      if (state === 'requesting' || state === 'processing') return

      const el = document.activeElement
      if (!isEditableElement(el)) {
        setErrorMsg(t('voice_input.no_target', '請先點到輸入框'))
        setTimeout(() => setErrorMsg(''), 3000)
        return
      }

      // 記錄目標 + 游標位置
      targetRef.current = el as HTMLElement
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement
      ) {
        selectionRef.current = {
          start: el.selectionStart ?? el.value.length,
          end: el.selectionEnd ?? el.value.length,
        }
      } else {
        // contenteditable: 試著抓 selection
        const sel = window.getSelection()
        selectionRef.current = {
          start: sel?.anchorOffset ?? 0,
          end: sel?.focusOffset ?? 0,
        }
      }

      // 試取鎖 (有別的 MicButton 在錄就放棄)
      if (!mic.acquireLock(LOCK_ID)) return

      start()
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [mic, state, start, stop, t])

  // 整個 voice_input 被 admin 關掉 → 不渲染
  if (mic.loaded && !mic.enabled) return null

  // 沒在錄音 + 沒有錯誤訊息 → 不渲染任何東西
  if (state === 'idle' && !errorMsg && !voicePreview) return null

  // ── 浮動 UI (右下角) ──
  const bars = 5
  const activeBars = Math.min(bars, Math.ceil(volume * bars * 1.6))

  return (
    <div className="fixed bottom-6 right-6 z-[9999] pointer-events-none">
      {errorMsg && state === 'idle' && (
        <div className="pointer-events-auto bg-red-500 text-white text-xs px-3 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <X size={14} />
          {errorMsg}
        </div>
      )}

      {state === 'recording' && (
        <div className="pointer-events-auto bg-white border-2 border-red-400 rounded-2xl shadow-xl px-4 py-3 flex items-center gap-3 min-w-[200px] animate-in fade-in slide-in-from-bottom-2">
          <div className="relative">
            <Mic size={20} className="text-red-500" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          </div>
          <div className="flex items-end gap-0.5 h-4">
            {Array.from({ length: bars }).map((_, i) => (
              <span
                key={i}
                className={`w-[3px] rounded-sm transition-all ${
                  i < activeBars ? 'bg-red-500' : 'bg-red-200'
                }`}
                style={{ height: `${5 + i * 2}px` }}
              />
            ))}
          </div>
          <span className="text-xs text-red-600 font-medium tabular-nums">
            {countdown}s
          </span>
          <button
            onClick={stop}
            className="ml-1 text-slate-400 hover:text-slate-700 transition"
            title="Esc / Alt+M"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {state === 'processing' && (
        <div className="pointer-events-auto bg-white border-2 border-blue-300 rounded-2xl shadow-xl px-4 py-3 flex items-center gap-2.5">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-blue-600 font-medium">
            {t('voice_input.processing', '辨識中...')}
          </span>
        </div>
      )}

      {state === 'requesting' && (
        <div className="pointer-events-auto bg-white border-2 border-blue-300 rounded-2xl shadow-xl px-4 py-3 flex items-center gap-2.5">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-blue-600 font-medium">
            {t('voice_input.requesting', '正在啟動麥克風...')}
          </span>
        </div>
      )}

      {voicePreview && state === 'recording' && (
        <div className="pointer-events-auto mt-2 max-w-[320px] bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 text-xs text-blue-700 italic shadow">
          <span className="text-blue-400 mr-1">›</span>
          {voicePreview}
        </div>
      )}
    </div>
  )
}
