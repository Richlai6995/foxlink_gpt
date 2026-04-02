import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type TrainingTheme = 'dark' | 'light-blue' | 'light-green'

export const THEMES: { id: TrainingTheme; label: string; preview: string; desc: string }[] = [
  { id: 'dark',        label: '深色',     preview: 'bg-slate-900',   desc: '深色底（預設）' },
  { id: 'light-blue',  label: '藍色調',   preview: 'bg-blue-100',    desc: '白底藍色調' },
  { id: 'light-green', label: '綠色調',   preview: 'bg-emerald-100', desc: '白底綠色調' },
]

interface ThemeContextType {
  theme: TrainingTheme
  setTheme: (t: TrainingTheme) => void
}

const ThemeContext = createContext<ThemeContextType>({ theme: 'dark', setTheme: () => {} })

const STORAGE_KEY = 'foxlink-training-theme'

export function TrainingThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<TrainingTheme>(() => {
    return (localStorage.getItem(STORAGE_KEY) as TrainingTheme) || 'dark'
  })

  const setTheme = (t: TrainingTheme) => {
    setThemeState(t)
    localStorage.setItem(STORAGE_KEY, t)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <div data-training-theme={theme} className="h-full">
        {children}
      </div>
    </ThemeContext.Provider>
  )
}

export function useTrainingTheme() {
  return useContext(ThemeContext)
}
