import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import type { User } from '../types'
import api from '../lib/api'
import i18n from '../i18n'
import type { LangCode } from '../i18n'
import { clearAdminOverrideStorage } from './AdminOverrideContext'

interface AuthContextType {
  user: User | null
  token: string | null
  login: (username: string, password: string) => Promise<void>
  loginWithSsoToken: (ssoToken: string) => Promise<void>
  logout: () => Promise<void>
  isAuthenticated: boolean
  isAdmin: boolean
  canSchedule: boolean
  canCreateKb: boolean
  canUseDashboard: boolean
  canDesignAiSelect: boolean
  canAccessTraining: boolean
  canEditTraining: boolean
  setLanguage: (lang: LangCode) => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

function applyLanguage(u: any) {
  // Login page selection (localStorage) takes priority over server profile
  const localPref = localStorage.getItem('preferred_language')
  const lang = (localPref || u?.resolved_language || u?.preferred_language || 'zh-TW') as LangCode
  if (['zh-TW', 'en', 'vi'].includes(lang)) i18n.changeLanguage(lang)
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('user')
    return saved ? JSON.parse(saved) : null
  })
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))

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
      applyLanguage(u)
    }).catch((e) => {
      if (e.response?.status === 401) {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        setToken(null)
        setUser(null)
      }
    })
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post('/auth/login', { username, password })
    const { token: t, user: u } = res.data
    localStorage.setItem('token', t)
    localStorage.setItem('user', JSON.stringify(u))
    setToken(t)
    setUser(u)
    // Ensure current i18n language is persisted (even if user never switched on login page)
    const currentLang = i18n.language || 'zh-TW'
    if (!localStorage.getItem('preferred_language')) {
      localStorage.setItem('preferred_language', currentLang)
    }
    applyLanguage(u)
    // Sync login page language choice to server profile
    const localPref = localStorage.getItem('preferred_language')
    if (localPref && localPref !== (u?.resolved_language || u?.preferred_language)) {
      api.put('/auth/language', { language_code: localPref }).catch(() => {})
    }
  }, [])

  const loginWithSsoToken = useCallback(async (ssoToken: string) => {
    const res = await api.get(`/auth/sso/user?token=${ssoToken}`)
    const { token: t, user: u } = res.data
    localStorage.setItem('token', t)
    localStorage.setItem('user', JSON.stringify(u))
    setToken(t)
    setUser(u)
    const currentLang = i18n.language || 'zh-TW'
    if (!localStorage.getItem('preferred_language')) {
      localStorage.setItem('preferred_language', currentLang)
    }
    applyLanguage(u)
    const localPref = localStorage.getItem('preferred_language')
    if (localPref && localPref !== (u?.resolved_language || u?.preferred_language)) {
      api.put('/auth/language', { language_code: localPref }).catch(() => {})
    }
  }, [])

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

  const setLanguage = useCallback(async (lang: LangCode) => {
    // Optimistic: update UI immediately, then persist to server
    i18n.changeLanguage(lang)
    setUser((prev) => {
      if (!prev) return prev
      const updated = { ...prev, resolved_language: lang } as any
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
  const canAccessTraining = isAdmin || trainingPermission === 'use' || trainingPermission === 'edit'
  const canEditTraining   = isAdmin || trainingPermission === 'edit'

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        loginWithSsoToken,
        logout,
        isAuthenticated: !!token && !!user,
        isAdmin,
        canSchedule,
        canCreateKb,
        canUseDashboard,
        canDesignAiSelect,
        canAccessTraining,
        canEditTraining,
        setLanguage,
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
