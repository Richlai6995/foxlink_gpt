import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import type { User } from '../types'
import api from '../lib/api'
import i18n from '../i18n'
import type { LangCode } from '../i18n'
import { clearAdminOverrideStorage } from './AdminOverrideContext'
import { useTheme, DEFAULT_THEME } from './ThemeContext'
import type { UITheme } from './ThemeContext'
import { isMobileSync } from '../hooks/useDeviceProfile'

const VALID_THEMES: UITheme[] = ['dark', 'dark-dimmed', 'light-blue', 'light-green', 'light-yellow']
function applyUserTheme(u: any, setTheme: (t: UITheme) => void) {
  // 2026-05-12 改成本地優先:有 localStorage 值就絕不被 server 覆蓋,避免 refresh 後
  // server 端值(可能是 default 'dark' 或舊值)蓋掉使用者剛切的主題。
  // server 端值只在「全新瀏覽器 / 首次登入」(local 沒值)時當 initial fallback,
  // 之後使用者切主題會背景 PUT 同步,跨裝置改也是用第一次登入該裝置時拉一次。
  const local = localStorage.getItem('foxlink-theme') as UITheme | null
  if (local && VALID_THEMES.includes(local as UITheme)) return // 本地優先,直接 return
  const t = u?.theme
  if (t && VALID_THEMES.includes(t)) {
    setTheme(t)
  } else {
    setTheme(DEFAULT_THEME)
  }
}

export interface ImpersonationStatus {
  impersonating: true
  original_username: string
  target_username: string
  target_name: string
  started_at: string
}

// MFA(外網登入二階段驗證):login 可能直接回 session,也可能回需 MFA
export type LoginResult =
  | { kind: 'session' }
  | { kind: 'mfa'; challengeId: string; maskedEmail: string }

interface AuthContextType {
  user: User | null
  token: string | null
  login: (username: string, password: string) => Promise<LoginResult>
  verifyMfa: (challengeId: string, code: string) => Promise<void>
  resendMfa: (challengeId: string) => Promise<void>
  loginWithSsoToken: (ssoToken: string) => Promise<void>
  loginWithPasskeyToken: (token: string, user: any) => void
  logout: () => Promise<void>
  isAuthenticated: boolean
  isAdmin: boolean
  canSchedule: boolean
  canCreateKb: boolean
  canUseDashboard: boolean
  canDesignAiSelect: boolean
  canAccessTraining: boolean
  canEditTraining: boolean
  canAccessTrainingDev: boolean
  canPublishTraining: boolean
  setLanguage: (lang: LangCode) => Promise<void>
  impersonation: ImpersonationStatus | null
  startImpersonate: (targetUserId: number) => Promise<void>
  exitImpersonate: () => Promise<void>
  refreshImpersonation: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

function applyLanguage(u: any) {
  // Login page selection (localStorage) takes priority over server profile
  const localPref = localStorage.getItem('preferred_language')
  const lang = (localPref || u?.resolved_language || u?.preferred_language || 'zh-TW') as LangCode
  if (['zh-TW', 'en', 'vi'].includes(lang)) i18n.changeLanguage(lang)
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { setTheme } = useTheme()
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('user')
    return saved ? JSON.parse(saved) : null
  })
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))
  const [impersonation, setImpersonation] = useState<ImpersonationStatus | null>(null)

  // Apply language from cached user on initial load
  useEffect(() => {
    if (user) applyLanguage(user)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh user profile from server on startup (picks up permission/language changes without re-login)
  useEffect(() => {
    const t = localStorage.getItem('token')
    if (!t) return
    api.get('/auth/me').then((r) => {
      const u = r.data
      localStorage.setItem('user', JSON.stringify(u))
      setUser(u)
      // Server 的 preferred_language 是權威值（另一裝置改過也同步過來）
      const serverLang = u?.resolved_language || u?.preferred_language
      if (serverLang && ['zh-TW','en','vi'].includes(serverLang)) {
        localStorage.setItem('preferred_language', serverLang)
      }
      applyLanguage(u)
      applyUserTheme(u, setTheme)
    }).catch((e) => {
      if (e.response?.status === 401) {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        setToken(null)
        setUser(null)
      }
    })
    api.get('/auth/impersonate/status')
      .then((r) => setImpersonation(r.data?.impersonating ? r.data : null))
      .catch(() => setImpersonation(null))
  }, [])

  // 防呆：另一個分頁 / 視窗改了 localStorage.token（例如重新登入）會把 impersonation token 蓋掉，
  // 但本分頁的 React state 還停留在「模擬中」，導致 exit 按鈕誤觸發 → 「不在模擬中」。
  // 監聽 storage 事件，token 一變立刻重抓 impersonation 狀態同步。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'token') return
      setToken(e.newValue)
      if (!e.newValue) {
        setUser(null)
        setImpersonation(null)
        return
      }
      api.get('/auth/impersonate/status')
        .then((r) => setImpersonation(r.data?.impersonating ? r.data : null))
        .catch(() => setImpersonation(null))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // MFA 通過後實際寫入 token + user 並套用偏好設定(login / verifyMfa / loginWithSsoToken 共用)
  const finalizeSession = useCallback((t: string, u: any) => {
    localStorage.setItem('token', t)
    localStorage.setItem('user', JSON.stringify(u))
    setToken(t)
    setUser(u)
    const currentLang = i18n.language || 'zh-TW'
    if (!localStorage.getItem('preferred_language')) {
      localStorage.setItem('preferred_language', currentLang)
    }
    applyLanguage(u)
    applyUserTheme(u, setTheme)
    const localPref = localStorage.getItem('preferred_language')
    if (localPref && localPref !== (u?.resolved_language || u?.preferred_language)) {
      api.put('/auth/language', { language_code: localPref }).catch(() => {})
    }
    // 一次性裝置 telemetry — silent fail
    try {
      api.post('/telemetry/device', {
        profile: isMobileSync() ? 'mobile' : 'desktop',
        ua: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      }).catch(() => {})
    } catch {}
  }, [setTheme])

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    const res = await api.post('/auth/login', { username, password })
    // 外網需要 MFA → server 回 { require_2fa: true, challenge_id, masked_email }
    if (res.data?.require_2fa) {
      return {
        kind: 'mfa',
        challengeId: res.data.challenge_id,
        maskedEmail: res.data.masked_email || '',
      }
    }
    // 內網 / IP 已信任 → 直接拿到 token
    const { token: t, user: u } = res.data
    finalizeSession(t, u)
    return { kind: 'session' }
  }, [finalizeSession])

  const verifyMfa = useCallback(async (challengeId: string, code: string) => {
    const res = await api.post('/auth/2fa/verify', { challenge_id: challengeId, code })
    const { token: t, user: u } = res.data
    finalizeSession(t, u)
  }, [finalizeSession])

  const resendMfa = useCallback(async (challengeId: string) => {
    await api.post('/auth/2fa/resend', { challenge_id: challengeId })
  }, [])

  const loginWithSsoToken = useCallback(async (ssoToken: string) => {
    // 用 Authorization header 取代 query string,避免 token 進 server access log
    const res = await api.get('/auth/sso/user', {
      headers: { Authorization: `Bearer ${ssoToken}` },
    })
    const { token: t, user: u } = res.data
    finalizeSession(t, u)
  }, [finalizeSession])

  // Passkey / 生物辨識成功後吃 token + user → 同密碼登入流程
  const loginWithPasskeyToken = useCallback((t: string, u: any) => {
    finalizeSession(t, u)
  }, [finalizeSession])

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout') } catch (_) {}
    const uid = (user as any)?.id
    if (uid) clearAdminOverrideStorage(uid)
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setToken(null)
    setUser(null)
    i18n.changeLanguage('zh-TW')
  }, [user])

  const startImpersonate = useCallback(async (targetUserId: number) => {
    const res = await api.post('/auth/impersonate', { target_user_id: targetUserId })
    const newToken = res.data?.token
    if (!newToken) throw new Error('No token returned')
    localStorage.setItem('token', newToken)
    localStorage.removeItem('user')
    window.location.href = '/'
  }, [])

  const exitImpersonate = useCallback(async () => {
    const res = await api.post('/auth/impersonate/exit')
    const origToken = res.data?.token
    if (!origToken) throw new Error('No original token returned')
    localStorage.setItem('token', origToken)
    localStorage.removeItem('user')
    window.location.href = '/'
  }, [])

  const refreshImpersonation = useCallback(async () => {
    try {
      const r = await api.get('/auth/impersonate/status')
      setImpersonation(r.data?.impersonating ? r.data : null)
    } catch {
      setImpersonation(null)
    }
  }, [])

  const setLanguage = useCallback(async (lang: LangCode) => {
    // Optimistic: update UI immediately, then persist to server
    i18n.changeLanguage(lang)
    // 同步 localStorage 的 preferred_language，避免 refresh 後 UI（讀 localStorage）
    // 跟後端 chat（讀 DB）用不同語言答題
    localStorage.setItem('preferred_language', lang)
    setUser((prev) => {
      if (!prev) return prev
      const updated = { ...prev, resolved_language: lang, preferred_language: lang } as any
      localStorage.setItem('user', JSON.stringify(updated))
      return updated
    })
    try {
      await api.put('/auth/language', { language_code: lang })
    } catch (e) {
      console.warn('[i18n] Failed to persist language preference:', e)
    }
  }, [])

  const isAdmin          = user?.role === 'admin'
  const canSchedule      = isAdmin || (user as any)?.allow_scheduled_tasks === 1
  const canCreateKb      = isAdmin || (user as any)?.effective_can_create_kb === true
  const canUseDashboard  = isAdmin || (user as any)?.effective_can_use_ai_dashboard === true
  const canDesignAiSelect = isAdmin || (user as any)?.effective_can_design_ai_select === true
  const trainingPermission: string = (user as any)?.effective_training_permission || 'none'
  const canAccessTraining = true // 訓練教室：所有登入使用者都可進入
  const canEditTraining   = isAdmin || trainingPermission === 'publish_edit'
  const canAccessTrainingDev = isAdmin || ['publish', 'publish_edit'].includes(trainingPermission)
  const canPublishTraining   = isAdmin || ['publish', 'publish_edit'].includes(trainingPermission)

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        verifyMfa,
        resendMfa,
        loginWithSsoToken,
        loginWithPasskeyToken,
        logout,
        isAuthenticated: !!token && !!user,
        isAdmin,
        canSchedule,
        canCreateKb,
        canUseDashboard,
        canDesignAiSelect,
        canAccessTraining,
        canEditTraining,
        canAccessTrainingDev,
        canPublishTraining,
        setLanguage,
        impersonation,
        startImpersonate,
        exitImpersonate,
        refreshImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
