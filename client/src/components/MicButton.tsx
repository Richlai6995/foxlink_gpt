import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Mic, MicOff, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useVoiceInput, type VoiceInputErrorType } from '../hooks/useVoiceInput'
import { useMic } from '../context/MicContext'

interface Props {
  /** 文字結果（最終）— 由父元件決定要插入哪個 textarea 的游標位置 */
  onTranscript: (text: string) => void
  /** 即時 partial 結果（A 路線專用，會出現在預覽條） */
  onInterim?: (text: string) => void
  /** 錄音上限秒數 — chat 60 / feedback 180 */
  maxDuration?: number
  /** 哪個情境呼叫的，後端會記到 log 方便追 */
  source?: 'chat' | 'feedback' | string
  /** 語系（預設跟著 i18n） */
  lang?: 'zh-TW' | 'en' | 'vi' | string
  disabled?: boolean
  /** 圖示大小 */
  size?: number
  /** 額外 className */
  className?: string
  /** 顯示在 button 旁邊（給聊天輸入框用，預覽條獨立 render） */
  showInlineStatus?: boolean
}

/**
 * MicButton — 麥克風語音輸入按鈕（chat + feedback 共用）
 *
 * 互鎖、權限偵測、UI 狀態（idle/recording/processing）、音量 bar、倒數、ESC 取消
 * 全部封裝在這個元件裡。父元件只要給 onTranscript callback。
 */
export default function MicButton({
  onTranscript,
  onInterim,
  maxDuration = 60,
  source = 'chat',
  lang,
  disabled = false,
  size = 18,
  className = '',
  showInlineStatus = true,
}: Props) {
  const { t, i18n } = useTranslation()
  const mic = useMic()
  const id = useId()

  const [permState, setPermState] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown')
  const [errorMsg, setErrorMsg] = useState<string>('')

  const effectiveLang = useMemo(() => {
    if (lang) return lang
    const cur = i18n.language || 'zh-TW'
    if (cur.startsWith('en')) return 'en'
    if (cur.startsWith('vi')) return 'vi'
    return 'zh-TW'
  }, [lang, i18n.language])

  const handleError = (type: VoiceInputErrorType, msg?: string) => {
    const map: Record<VoiceInputErrorType, string> = {
      permission:        t('voice_input.error.permission', '請允許麥克風權限'),
      no_mic:            t('voice_input.error.no_mic', '找不到麥克風'),
      transcribe_failed: t('voice_input.error.transcribe_failed', '辨識失敗，請重試'),
      too_long:          t('voice_input.error.too_long', '錄音已達上限，自動停止'),
      unsupported:       t('voice_input.error.unsupported', '瀏覽器不支援錄音'),
      unknown:           t('voice_input.error.unknown', '發生錯誤'),
    }
    setErrorMsg(map[type] || msg || '')
    // 3 秒後自動清掉
    window.setTimeout(() => setErrorMsg(''), 3000)
    if (type === 'permission') setPermState('denied')
  }

  const { state, volume, countdown, start, stop, isSpeechRecognitionAvailable } = useVoiceInput({
    lang: effectiveLang,
    maxDuration,
    source,
    preferBackendOnly: mic.preferBackendOnly,
    onInterim,
    onFinal: (text) => {
      onTranscript(text)
      mic.releaseLock(id)
    },
    onError: (type, msg) => {
      handleError(type, msg)
      mic.releaseLock(id)
    },
  })

  // 偵測麥克風權限狀態（瀏覽器支援的話）
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions) return
    let cancelled = false
    ;(navigator.permissions as any)
      .query({ name: 'microphone' })
      .then((res: any) => {
        if (cancelled) return
        setPermState(res.state)
        res.onchange = () => setPermState(res.state)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // 互鎖：別的 MicButton 開始錄時，自己若也在錄就被踢
  useEffect(() => {
    if (state === 'recording' && mic.activeMicId && mic.activeMicId !== id) {
      stop()
    }
  }, [mic.activeMicId, id, state, stop])

  const handleClick = () => {
    if (disabled) return
    if (state === 'recording') {
      stop()
      return
    }
    if (state === 'processing' || state === 'requesting') return
    if (permState === 'denied') {
      handleError('permission')
      return
    }
    if (!mic.acquireLock(id)) {
      // 別人正在錄
      return
    }
    start()
  }

  // 整個 voice_input 被 admin 關掉
  if (mic.loaded && !mic.enabled) return null

  const isDisabled =
    disabled ||
    permState === 'denied' ||
    (mic.activeMicId !== null && mic.activeMicId !== id)

  // ─── icon + colors ────────────────────────────────────────────────────────
  let icon = <Mic size={size} />
  let colorCls = 'text-slate-400 hover:text-blue-500'
  let title = t('voice_input.start', '點擊開始錄音')

  if (permState === 'denied') {
    icon = <MicOff size={size} />
    colorCls = 'text-slate-300 cursor-not-allowed'
    title = t('voice_input.error.permission', '請允許麥克風權限')
  } else if (state === 'requesting') {
    icon = <Loader2 size={size} className="animate-spin" />
    colorCls = 'text-blue-500'
    title = t('voice_input.requesting', '正在啟動麥克風...')
  } else if (state === 'recording') {
    icon = <Mic size={size} />
    colorCls = 'text-red-500 animate-pulse'
    title = t('voice_input.stop', '點擊停止')
  } else if (state === 'processing') {
    icon = <Loader2 size={size} className="animate-spin" />
    colorCls = 'text-blue-500'
    title = t('voice_input.processing', '辨識中...')
  }

  // 5 格音量條 (0~1 → 0~5)
  const bars = 5
  const activeBars = Math.min(bars, Math.ceil(volume * bars * 1.6))

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled && state !== 'recording'}
        className={`transition p-1 mb-0.5 disabled:opacity-50 ${colorCls}`}
        title={title}
        aria-label={title}
      >
        {icon}
      </button>

      {showInlineStatus && state === 'recording' && (
        <div className="flex items-center gap-1.5 text-[11px] text-red-500 select-none">
          {/* 音量 bar */}
          <div className="flex items-end gap-0.5 h-3.5">
            {Array.from({ length: bars }).map((_, i) => (
              <span
                key={i}
                className={`w-[3px] rounded-sm transition-all ${i < activeBars ? 'bg-red-500' : 'bg-red-200'}`}
                style={{ height: `${4 + i * 2}px` }}
              />
            ))}
          </div>
          <span className="tabular-nums">{countdown}s</span>
        </div>
      )}

      {showInlineStatus && state === 'processing' && (
        <span className="text-[11px] text-blue-500 select-none">
          {t('voice_input.processing', '辨識中...')}
        </span>
      )}

      {errorMsg && (
        <span className="text-[11px] text-red-500 select-none">{errorMsg}</span>
      )}
    </div>
  )
}
