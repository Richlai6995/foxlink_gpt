import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Eye, EyeOff, X, Mail } from 'lucide-react'
import api from '../lib/api'

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Forgot password modal state
  const [showForgot, setShowForgot] = useState(false)
  const [forgotUsername, setForgotUsername] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotMsg, setForgotMsg] = useState('')
  const [forgotError, setForgotError] = useState('')

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setForgotLoading(true)
    setForgotMsg('')
    setForgotError('')
    try {
      const res = await api.post('/auth/forgot-password', { username: forgotUsername })
      setForgotMsg(res.data.message)
    } catch (err: unknown) {
      setForgotError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '請求失敗，請稍後再試'
      )
    } finally {
      setForgotLoading(false)
    }
  }

  const closeForgot = () => {
    setShowForgot(false)
    setForgotUsername('')
    setForgotMsg('')
    setForgotError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        '登入失敗，請稍後再試'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 mb-4">
            <img src="/favicon.png" alt="FOXLINK GPT" className="w-20 h-20 object-contain drop-shadow-lg" />
          </div>
          <h1 className="text-2xl font-bold text-white">FOXLINK GPT</h1>
          <p className="text-slate-400 text-sm mt-1">企業智慧對話系統</p>
        </div>

        {/* Card */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">帳號</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                placeholder="請輸入帳號"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">密碼</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 pr-12 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                  placeholder="請輸入密碼"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/20 border border-red-500/30 rounded-xl px-4 py-3 text-red-300 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition shadow-lg shadow-blue-600/30"
            >
              {loading ? '登入中...' : '登入'}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                className="text-slate-500 hover:text-slate-300 text-sm transition"
              >
                忘記密碼？
              </button>
            </div>
          </form>
        </div>

        {/* Forgot Password Modal */}
        {showForgot && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-white font-semibold">
                  <Mail size={18} className="text-blue-400" />
                  重置密碼
                </div>
                <button onClick={closeForgot} className="text-slate-400 hover:text-white"><X size={18} /></button>
              </div>
              <p className="text-slate-400 text-sm mb-4">
                輸入您的帳號，系統將寄送重置連結至您的電子郵件（僅適用手動建立帳號）。
              </p>
              {forgotMsg ? (
                <div className="bg-green-500/20 border border-green-500/30 rounded-xl px-4 py-3 text-green-300 text-sm">
                  {forgotMsg}
                </div>
              ) : (
                <form onSubmit={handleForgot} className="space-y-4">
                  <input
                    type="text"
                    value={forgotUsername}
                    onChange={e => setForgotUsername(e.target.value)}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
                    placeholder="請輸入帳號"
                    required
                    autoFocus
                  />
                  {forgotError && (
                    <p className="text-red-400 text-sm">{forgotError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition"
                  >
                    {forgotLoading ? '寄送中...' : '寄送重置連結'}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        <p className="text-center text-slate-600 text-xs mt-6">
          © {new Date().getFullYear()} Foxlink Group. All rights reserved.
        </p>
      </div>
    </div>
  )
}
