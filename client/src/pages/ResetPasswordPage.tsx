import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, KeyRound, CheckCircle2, AlertCircle } from 'lucide-react'
import api from '../lib/api'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) return setError('兩次密碼輸入不一致')
    if (password.length < 6) return setError('密碼至少 6 個字元')
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/reset-password', { token, password })
      setDone(true)
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '重置失敗，請稍後再試'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 mb-4">
            <img src="/favicon.png" alt="FOXLINK GPT" className="w-20 h-20 object-contain drop-shadow-lg" />
          </div>
          <h1 className="text-2xl font-bold text-white">FOXLINK GPT</h1>
          <p className="text-slate-400 text-sm mt-1">重設密碼</p>
        </div>

        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8 shadow-2xl">
          {!token ? (
            <div className="flex items-center gap-3 text-red-300">
              <AlertCircle size={20} />
              <p>無效的重置連結，請重新申請。</p>
            </div>
          ) : done ? (
            <div className="text-center space-y-4">
              <CheckCircle2 size={48} className="text-green-400 mx-auto" />
              <p className="text-white font-medium">密碼已成功重置！</p>
              <button
                onClick={() => navigate('/login')}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition"
              >
                返回登入
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="flex items-center gap-2 text-slate-300 mb-2">
                <KeyRound size={18} />
                <span className="font-medium">設定新密碼</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">新密碼</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 pr-12 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                    placeholder="至少 6 個字元"
                    required
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">確認密碼</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                  placeholder="再輸入一次新密碼"
                  required
                />
              </div>

              {error && (
                <div className="bg-red-500/20 border border-red-500/30 rounded-xl px-4 py-3 text-red-300 text-sm flex items-center gap-2">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition shadow-lg"
              >
                {loading ? '處理中...' : '確認重置密碼'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="w-full text-slate-400 hover:text-slate-200 text-sm transition"
              >
                返回登入
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
