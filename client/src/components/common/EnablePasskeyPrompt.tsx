// 登入後第一次提示「啟用 Face ID / 指紋 快速登入?」
// 偵測:isPlatformBiometricAvailable && !已綁定 && 未拒絕
// 7 天 dismiss TTL,user 一直拒絕就不打擾
import { useEffect, useState } from 'react'
import { Fingerprint, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  isWebAuthnSupported,
  isPlatformBiometricAvailable,
  registerPasskey,
  listMyCredentials,
} from '../../lib/webauthn'

const DISMISS_KEY = 'passkey_prompt_dismissed_at'
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000

function isDismissedRecently(): boolean {
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY) || 0)
    return ts > 0 && Date.now() - ts < DISMISS_TTL_MS
  } catch {
    return false
  }
}

export default function EnablePasskeyPrompt() {
  const { isAuthenticated } = useAuth()
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthenticated) return
    if (!isWebAuthnSupported()) return
    if (isDismissedRecently()) return

    let cancelled = false
    ;(async () => {
      try {
        const platformOk = await isPlatformBiometricAvailable()
        if (!platformOk || cancelled) return
        // 已綁過任意 credential 就不再彈
        const list = await listMyCredentials().catch(() => [])
        if (cancelled) return
        if (Array.isArray(list) && list.length > 0) return
        setShow(true)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [isAuthenticated])

  if (!show) return null

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}
    setShow(false)
  }

  const enable = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await registerPasskey()
      if (r.ok) {
        setShow(false)
      } else if (r.error && r.error !== '使用者取消或裝置拒絕') {
        setError(r.error)
      } else {
        // user cancel — 不顯示錯誤,但暫時關掉(下次登入會再問)
        setShow(false)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={dismiss}>
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center flex-shrink-0">
            <Fingerprint size={26} className="text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-slate-800">啟用快速登入</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              用 Face ID / 指紋 / Windows Hello 取代密碼登入,更快也更安全。
              此設定僅綁定當前裝置,不影響其他登入方式。
            </p>
          </div>
          <button onClick={dismiss} aria-label="關閉" className="text-slate-400 hover:text-slate-600 p-1">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={enable}
            disabled={busy}
            className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white text-sm font-medium rounded-xl py-3 inline-flex items-center justify-center gap-2"
          >
            <Fingerprint size={16} />
            {busy ? '驗證中…' : '立即啟用'}
          </button>
          <button
            onClick={dismiss}
            className="w-full text-slate-500 hover:text-slate-700 text-sm py-2"
          >
            稍後再說
          </button>
        </div>

        <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
          本系統不會儲存你的生物特徵,僅在裝置本機驗證。可隨時在「設定 → 已綁定裝置」中移除。
        </p>
      </div>
    </div>
  )
}
