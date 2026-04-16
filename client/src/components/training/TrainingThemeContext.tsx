// Deprecated: theme 已全局化（見 ../../context/ThemeContext.tsx）
// 保留此檔案做為相容 shim，讓舊 import 繼續可用。
import { useTheme, THEMES as GLOBAL_THEMES } from '../../context/ThemeContext'
import type { UITheme } from '../../context/ThemeContext'

export type TrainingTheme = UITheme
export const THEMES = GLOBAL_THEMES

export function useTrainingTheme() {
  return useTheme()
}

// 舊版 Provider 仍被某些檔案 import — 現在是 no-op（實際 Provider 在 App 根層）
export function TrainingThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
