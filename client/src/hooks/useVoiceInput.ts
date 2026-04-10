import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../lib/api'

/**
 * useVoiceInput — A+B 雙軌語音輸入
 *
 * A 路線（前端）：Web Speech API（SpeechRecognition）即時邊講邊出字。
 *                  Chrome/Edge OK；Firefox/Safari 多半不支援；內網封外網時會壞。
 * B 路線（後端）：MediaRecorder 同步背景錄音 → POST /api/transcribe → Gemini Flash。
 *
 * 雙軌策略：
 *   - 兩路同時跑（共用一個 MediaStream），A 成功用 A、A 壞了就送 B 的 blob
 *   - sessionStorage 記住「本 tab A 已知壞」→ 下次不再嘗試 A
 *   - 2 秒內 A 完全沒任何 event → 視同 A 壞，靜默繼續 B
 *
 * 三個輸出：
 *   - state: 'idle' | 'requesting' | 'recording' | 'processing'
 *   - volume: 0~1 浮點數（給 UI 畫音量 bar）
 *   - countdown: 剩餘秒數（給 UI 顯示倒數）
 *
 * 兩個 callback：
 *   - onInterim(text): A 路線即時 partial 結果（給預覽條）
 *   - onFinal(text):   最終結果（A 或 B 任一）
 */

export type VoiceInputState = 'idle' | 'requesting' | 'recording' | 'processing'

export type VoiceInputErrorType =
  | 'permission'
  | 'no_mic'
  | 'transcribe_failed'
  | 'too_long'
  | 'unsupported'
  | 'unknown'

interface UseVoiceInputOptions {
  lang?: 'zh-TW' | 'en' | 'vi' | string
  maxDuration?: number // 秒
  source?: 'chat' | 'feedback' | string
  preferBackendOnly?: boolean
  onInterim?: (text: string) => void
  onFinal?: (text: string) => void
  onError?: (type: VoiceInputErrorType, msg?: string) => void
}

const SESSION_KEY_A_BROKEN = 'fl_voice_a_broken'

// SpeechRecognition browser detection
function getSpeechRecognition(): any {
  if (typeof window === 'undefined') return null
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null
}

// 選擇 MediaRecorder 支援的最佳 mimeType（Safari 走 mp4）
function pickBestMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/wav',
  ]
  for (const c of candidates) {
    try {
      if ((MediaRecorder as any).isTypeSupported?.(c)) return c
    } catch {}
  }
  return '' // 讓瀏覽器決定
}

export function useVoiceInput(opts: UseVoiceInputOptions = {}) {
  const {
    lang = 'zh-TW',
    maxDuration = 60,
    source = 'unknown',
    preferBackendOnly = false,
    onInterim,
    onFinal,
    onError,
  } = opts

  const [state, setState] = useState<VoiceInputState>('idle')
  const [volume, setVolume] = useState(0)
  const [countdown, setCountdown] = useState(maxDuration)

  // refs (避免閉包陷阱)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recognitionRef = useRef<any>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const startedAtRef = useRef<number>(0)
  const aBufferRef = useRef<string>('')         // A 路線累積的 final 文字
  const aGotResultRef = useRef<boolean>(false)  // A 是否曾收到任何 result
  const aBrokenRef = useRef<boolean>(false)
  const chunksRef = useRef<BlobPart[]>([])
  const mimeRef = useRef<string>('')
  const unmountedRef = useRef<boolean>(false)
  const stopRequestedRef = useRef<boolean>(false)

  const optsRef = useRef(opts)
  optsRef.current = opts

  // ─── cleanup ───────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    try { recognitionRef.current?.stop?.() } catch {}
    recognitionRef.current = null
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
    } catch {}
    recorderRef.current = null
    try { audioCtxRef.current?.close?.() } catch {}
    audioCtxRef.current = null
    analyserRef.current = null
    if (streamRef.current) {
      try { streamRef.current.getTracks().forEach((t) => t.stop()) } catch {}
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      unmountedRef.current = true
      cleanup()
    }
  }, [cleanup])

  // ─── volume bar ────────────────────────────────────────────────────────────
  const tickVolume = useCallback(() => {
    const an = analyserRef.current
    if (!an) return
    const data = new Uint8Array(an.frequencyBinCount)
    an.getByteFrequencyData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) sum += data[i]
    const avg = sum / data.length / 255 // 0~1
    setVolume(avg)
    rafRef.current = requestAnimationFrame(tickVolume)
  }, [])

  // ─── 真正停止錄音並決定送哪一邊 ────────────────────────────────────────────
  const finalize = useCallback(async () => {
    if (unmountedRef.current) return
    setState('processing')

    // 關閉 RAF + timer + recognition，但 recorder 還要等 onstop 拿到 blob
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null }
    try { recognitionRef.current?.stop?.() } catch {}

    // 等 MediaRecorder 出齊資料
    const recorder = recorderRef.current
    const blob: Blob | null = await new Promise((resolve) => {
      if (!recorder || recorder.state === 'inactive') return resolve(null)
      const handle = () => {
        const b = chunksRef.current.length > 0
          ? new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' })
          : null
        resolve(b)
      }
      recorder.addEventListener('stop', handle, { once: true })
      try { recorder.stop() } catch { resolve(null) }
    })

    // 釋放 mic
    if (streamRef.current) {
      try { streamRef.current.getTracks().forEach((t) => t.stop()) } catch {}
      streamRef.current = null
    }
    try { audioCtxRef.current?.close?.() } catch {}
    audioCtxRef.current = null

    // 決策：A 沒壞且有結果 → 用 A
    const aText = aBufferRef.current.trim()
    if (!aBrokenRef.current && aGotResultRef.current && aText) {
      try { optsRef.current.onFinal?.(aText) } catch {}
      setState('idle')
      return
    }

    // 否則送 B
    if (!blob || blob.size < 100) {
      try { optsRef.current.onError?.('transcribe_failed', '沒有錄到音訊') } catch {}
      setState('idle')
      return
    }
    try {
      const fd = new FormData()
      const ext = (mimeRef.current.includes('mp4') ? 'm4a'
        : mimeRef.current.includes('wav') ? 'wav'
        : mimeRef.current.includes('ogg') ? 'ogg'
        : 'webm')
      fd.append('audio', blob, `voice.${ext}`)
      fd.append('lang', String(optsRef.current.lang || 'zh-TW'))
      fd.append('source', String(optsRef.current.source || 'unknown'))
      const { data } = await api.post('/transcribe', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      })
      const text = (data?.text || '').trim()
      if (text) {
        try { optsRef.current.onFinal?.(text) } catch {}
      } else {
        try { optsRef.current.onError?.('transcribe_failed', '辨識結果為空') } catch {}
      }
    } catch (e: any) {
      try { optsRef.current.onError?.('transcribe_failed', e?.response?.data?.error || e?.message) } catch {}
    } finally {
      setState('idle')
    }
  }, [])

  // ─── 啟動錄音 ──────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (state !== 'idle') return
    stopRequestedRef.current = false
    aBufferRef.current = ''
    aGotResultRef.current = false
    aBrokenRef.current = false
    chunksRef.current = []
    setVolume(0)
    setCountdown(maxDuration)
    setState('requesting')

    // 取麥克風
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e: any) {
      setState('idle')
      const msg = (e?.message || '').toLowerCase()
      if (e?.name === 'NotAllowedError' || msg.includes('denied')) {
        optsRef.current.onError?.('permission')
      } else if (e?.name === 'NotFoundError' || msg.includes('not found')) {
        optsRef.current.onError?.('no_mic')
      } else {
        optsRef.current.onError?.('unknown', e?.message)
      }
      return
    }
    streamRef.current = stream

    // 建 MediaRecorder
    const mime = pickBestMimeType()
    mimeRef.current = mime
    let recorder: MediaRecorder
    try {
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream)
    } catch (e: any) {
      cleanup()
      setState('idle')
      optsRef.current.onError?.('unsupported', e?.message)
      return
    }
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorderRef.current = recorder
    recorder.start(250) // 每 250ms 切一次 chunk

    // 建 AudioContext + Analyser → 音量 bar
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext
      const ac: AudioContext = new AC()
      const src = ac.createMediaStreamSource(stream)
      const analyser = ac.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      audioCtxRef.current = ac
      analyserRef.current = analyser
      rafRef.current = requestAnimationFrame(tickVolume)
    } catch {}

    // 嘗試 A 路線
    const SR = getSpeechRecognition()
    const aBrokenFromSession = sessionStorage.getItem(SESSION_KEY_A_BROKEN) === '1'
    if (SR && !preferBackendOnly && !aBrokenFromSession) {
      try {
        const rec: any = new SR()
        rec.continuous = true
        rec.interimResults = true
        rec.lang = lang
        rec.onresult = (ev: any) => {
          aGotResultRef.current = true
          let interim = ''
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i]
            if (r.isFinal) {
              aBufferRef.current += r[0].transcript
            } else {
              interim += r[0].transcript
            }
          }
          if (interim) {
            try { optsRef.current.onInterim?.(aBufferRef.current + interim) } catch {}
          } else {
            try { optsRef.current.onInterim?.(aBufferRef.current) } catch {}
          }
        }
        rec.onerror = (ev: any) => {
          // network / service-not-allowed / not-allowed → A 壞了
          const err = ev?.error || ''
          if (err === 'network' || err === 'service-not-allowed') {
            aBrokenRef.current = true
            sessionStorage.setItem(SESSION_KEY_A_BROKEN, '1')
            console.warn('[useVoiceInput] SpeechRecognition error, fallback to backend:', err)
          } else if (err === 'not-allowed') {
            // 通常是 mic 權限被擋
            aBrokenRef.current = true
          } else if (err === 'no-speech' || err === 'aborted') {
            // ignore
          } else {
            aBrokenRef.current = true
            console.warn('[useVoiceInput] SR error:', err)
          }
        }
        rec.onend = () => {
          // SpeechRecognition 會自己結束（continuous 在某些瀏覽器仍會 timeout），這裡不主動重啟
        }
        recognitionRef.current = rec
        rec.start()
      } catch (e) {
        aBrokenRef.current = true
        recognitionRef.current = null
        console.warn('[useVoiceInput] SR start failed:', e)
      }
    } else {
      aBrokenRef.current = true // 沒 A 可用
    }

    setState('recording')
    startedAtRef.current = Date.now()

    // 倒數 + maxDuration 強制停止
    timerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000)
      const remain = Math.max(0, maxDuration - elapsed)
      setCountdown(remain)
      if (remain === 0) {
        stopRequestedRef.current = true
        try { optsRef.current.onError?.('too_long') } catch {}
        finalize()
      }
    }, 200)

    // A 路線 2 秒守門：若 2 秒內毫無 result，視為 A 壞掉
    window.setTimeout(() => {
      if (state === 'idle') return
      if (!aGotResultRef.current && !aBrokenRef.current && recognitionRef.current) {
        // 還沒收到任何 event，標記 A 為不可靠（但繼續錄）
        // 注意：不立刻切 broken，給 A 多 2 秒機會
      }
      window.setTimeout(() => {
        if (!aGotResultRef.current && recognitionRef.current) {
          aBrokenRef.current = true
          sessionStorage.setItem(SESSION_KEY_A_BROKEN, '1')
          console.warn('[useVoiceInput] SR silent for 4s, marking as broken')
        }
      }, 2000)
    }, 2000)
  }, [state, maxDuration, lang, preferBackendOnly, tickVolume, finalize, cleanup])

  // 使用者主動停止
  const stop = useCallback(() => {
    if (state !== 'recording') return
    stopRequestedRef.current = true
    finalize()
  }, [state, finalize])

  // ESC 鍵停止
  useEffect(() => {
    if (state !== 'recording') return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [state, stop])

  return {
    state,
    volume,
    countdown,
    start,
    stop,
    isSpeechRecognitionAvailable: !!getSpeechRecognition(),
  }
}
