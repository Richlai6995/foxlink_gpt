import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import api from '../lib/api'

export type UITheme = 'dark' | 'dark-dimmed' | 'light-blue' | 'light-green' | 'light-yellow'

// label / desc 由 ThemePicker 透過 i18n key 取得（見 locale 檔 theme.*）
export const THEMES: { id: UITheme; labelKey: string; preview: string; descKey: string }[] = [
  { id: 'dark',         labelKey: 'theme.dark.label',        preview: 'bg-slate-900',   descKey: 'theme.dark.desc' },
  { id: 'dark-dimmed',  labelKey: 'theme.darkDimmed.label',  preview: 'bg-[#1c1e24]',   descKey: 'theme.darkDimmed.desc' },
  { id: 'light-blue',   labelKey: 'theme.lightBlue.label',   preview: 'bg-blue-100',    descKey: 'theme.lightBlue.desc' },
  { id: 'light-green',  labelKey: 'theme.lightGreen.label',  preview: 'bg-emerald-100', descKey: 'theme.lightGreen.desc' },
  { id: 'light-yellow', labelKey: 'theme.lightYellow.label', preview: 'bg-amber-100',   descKey: 'theme.lightYellow.desc' },
]

const VALID: UITheme[] = ['dark', 'dark-dimmed', 'light-blue', 'light-green', 'light-yellow']
export const DEFAULT_THEME: UITheme = 'dark'

const STORAGE_KEY = 'foxlink-theme'
const LEGACY_KEY = 'foxlink-training-theme' // 舊 training-only key，啟動時遷移

function sanitize(v: any): UITheme | null {
  return VALID.includes(v) ? (v as UITheme) : null
}

function getInitialTheme(): UITheme {
  // 優先序：localStorage 新 key → 舊 key 遷移 → cached user.theme → 預設
  const fromNew = sanitize(localStorage.getItem(STORAGE_KEY))
  if (fromNew) return fromNew

  const fromLegacy = sanitize(localStorage.getItem(LEGACY_KEY))
  if (fromLegacy) {
    localStorage.setItem(STORAGE_KEY, fromLegacy)
    localStorage.removeItem(LEGACY_KEY)
    return fromLegacy
  }

  try {
    const cached = localStorage.getItem('user')
    if (cached) {
      const u = JSON.parse(cached)
      const fromUser = sanitize(u?.theme)
      if (fromUser) {
        localStorage.setItem(STORAGE_KEY, fromUser)
        return fromUser
      }
    }
  } catch (_) {}

  return DEFAULT_THEME
}

interface ThemeContextType {
  theme: UITheme
  setTheme: (t: UITheme) => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
})

export function GlobalThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<UITheme>(() => getInitialTheme())

  // 把 data-theme 寫到 <html>，讓 CSS 全域生效（包含 portal/modal）
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // 登入後從 server 同步 user.theme（若跟本地不同）
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    // 不用 await，非同步跟 /auth/me 並行
    try {
      const cached = localStorage.getItem('user')
      if (!cached) return
      const u = JSON.parse(cached)
      const serverTheme = sanitize(u?.theme)
      if (serverTheme && serverTheme !== theme) {
        setThemeState(serverTheme)
        localStorage.setItem(STORAGE_KEY, serverTheme)
      }
    } catch (_) {}
  }, [])

  // 監聽 storage 事件：另一個分頁改主題時，本頁也跟著變
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      const next = sanitize(e.newValue)
      if (next && next !== theme) setThemeState(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [theme])

  const setTheme = useCallback((t: UITheme) => {
    if (!VALID.includes(t)) return
    setThemeState(t)
    localStorage.setItem(STORAGE_KEY, t)
    // 同步更新 cached user.theme，避免下次 reload 時舊值覆蓋
    try {
      const cached = localStorage.getItem('user')
      if (cached) {
        const u = JSON.parse(cached)
        u.theme = t
        localStorage.setItem('user', JSON.stringify(u))
      }
    } catch (_) {}
    // 背景寫回後端（未登入時 silently 失敗）
    if (localStorage.getItem('token')) {
      api.put('/auth/theme', { theme: t }).catch(() => {})
    }
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
