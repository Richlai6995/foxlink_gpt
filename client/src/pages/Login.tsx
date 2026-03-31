import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { Eye, EyeOff, X, Mail, Shield, Globe } from 'lucide-react'
import api from '../lib/api'
import { useTranslation } from 'react-i18next'
import i18n, { SUPPORTED_LANGUAGES, type LangCode } from '../i18n'

export default function Login() {
  const { login, loginWithSsoToken } = useAuth()
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [ssoLoading, setSsoLoading] = useState(false)
  const [showLangMenu, setShowLangMenu] = useState(false)

  const handleLangChange = (lang: LangCode) => {
    i18n.changeLanguage(lang)
    localStorage.setItem('preferred_language', lang)
    setShowLangMenu(false)
  }

  // Handle SSO callback: ?sso_token=xxx or ?sso_error=xxx
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ssoToken = params.get('sso_token')
    const ssoError = params.get('sso_error')
    if (ssoError) {
      setError(decodeURIComponent(ssoError))
      window.history.replaceState({}, '', '/login')
    } else if (ssoToken) {
      setSsoLoading(true)
      window.history.replaceState({}, '', '/login')
      loginWithSsoToken(ssoToken).catch((err) => {
        setError(err?.message || 'SSO 登入失敗')
        setSsoLoading(false)
      })
    }
  }, [loginWithSsoToken])

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
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('login.requestFailed')
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
        t('login.loginFailed')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      {/* Language switcher — top right */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => setShowLangMenu(v => !v)}
          className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 transition"
        >
          <Globe size={13} />
          {SUPPORTED_LANGUAGES.find(l => l.code === i18n.language)?.label || i18n.language}
        </button>
        {showLangMenu && (
          <div className="absolute right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-2xl min-w-[130px]">
            {SUPPORTED_LANGUAGES.map(lang => (
              <button
                key={lang.code}
                onClick={() => handleLangChange(lang.code as LangCode)}
                className={`w-full text-left px-4 py-2 text-xs hover:bg-slate-700 transition ${i18n.language === lang.code ? 'text-blue-400 font-medium' : 'text-slate-300'}`}
              >
                {lang.label}
                {i18n.language === lang.code && <span className="float-right">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 mb-4">
            <img src="/favicon.png" alt="Foxlink GPT to Cortex" className="w-20 h-20 object-contain drop-shadow-lg" />
          </div>
          <h1 className="text-2xl font-bold text-white">Foxlink GPT to Cortex</h1>
          <p className="text-slate-400 text-sm mt-1">{t('login.title')}</p>
        </div>

        {/* Login hint */}
        <div className="bg-white/5 border border-white/10 rounded-xl px-5 py-4 mb-4 text-sm text-slate-300">
          <p className="font-medium text-slate-200 mb-2">{t('login.loginHintTitle')}</p>
          <ol className="space-y-1 list-none">
            <li className="flex gap-2"><span className="text-blue-400 font-bold shrink-0">1.</span>{t('login.loginHint1')}</li>
            <li className="flex gap-2"><span className="text-orange-400 font-bold shrink-0">2.</span>{t('login.loginHint2')}</li>
            <li className="flex gap-2"><span className="text-slate-400 font-bold shrink-0">3.</span>{t('login.loginHint3')}</li>
          </ol>
        </div>

        {/* Card */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">{t('login.username')}</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                placeholder={t('login.usernamePlaceholder')}
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">{t('login.password')}</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 pr-12 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                  placeholder={t('login.passwordPlaceholder')}
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
              {loading ? t('login.submitting') : t('login.submit')}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                className="text-slate-500 hover:text-slate-300 text-sm transition"
              >
                {t('login.forgotPassword')}
              </button>
            </div>
          </form>

          {/* SSO Divider & Button */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-slate-500 text-xs">{t('login.or', 'OR')}</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>
          <button
            type="button"
            onClick={() => { window.location.href = '/api/auth/sso/login' }}
            disabled={ssoLoading}
            className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition shadow-lg shadow-orange-500/30"
          >
            <Shield size={18} />
            {ssoLoading ? t('login.ssoLoading', 'SSO 登入中...') : t('login.ssoButton', 'Foxlink SSO 登入')}
          </button>
        </div>

        {/* Forgot Password Modal */}
        {showForgot && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-white font-semibold">
                  <Mail size={18} className="text-blue-400" />
                  {t('login.resetTitle')}
                </div>
                <button onClick={closeForgot} className="text-slate-400 hover:text-white"><X size={18} /></button>
              </div>
              <p className="text-slate-400 text-sm mb-4">
                {t('login.resetDesc')}
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
                    placeholder={t('login.resetUsernamePlaceholder')}
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
                    {forgotLoading ? t('login.resetSubmitting') : t('login.resetSubmit')}
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
