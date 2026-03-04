import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import type { User } from '../types'
import api from '../lib/api'

interface AuthContextType {
  user: User | null
  token: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  isAuthenticated: boolean
  isAdmin: boolean
  canSchedule: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('user')
    return saved ? JSON.parse(saved) : null
  })
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))

  // Refresh user profile from server on startup (picks up permission changes without re-login)
  useEffect(() => {
    const t = localStorage.getItem('token')
    if (!t) return
    api.get('/auth/me').then((r) => {
      const u = r.data
      localStorage.setItem('user', JSON.stringify(u))
      setUser(u)
    }).catch(() => {})
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post('/auth/login', { username, password })
    const { token: t, user: u } = res.data
    localStorage.setItem('token', t)
    localStorage.setItem('user', JSON.stringify(u))
    setToken(t)
    setUser(u)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } catch (_) {}
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setToken(null)
    setUser(null)
  }, [])

  const isAdmin = user?.role === 'admin'
  const canSchedule = isAdmin || (user as any)?.allow_scheduled_tasks === 1

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        isAuthenticated: !!token && !!user,
        isAdmin,
        canSchedule,
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
