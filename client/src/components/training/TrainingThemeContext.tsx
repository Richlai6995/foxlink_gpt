// Deprecated: theme 已全局化（見 ../../context/ThemeContext.tsx）
// 保留此檔案做為相容 shim，讓舊 import 繼續可用。
import { useTheme, THEMES as GLOBAL_THEMES } from '../../context/ThemeContext'
import type { UITheme } from '../../context/ThemeContext'

export type TrainingTheme = UITheme
export const THEMES = GLOBAL_THEMES

export function useTrainingTheme() {
  return useTheme()
}

// dark 模式：Training 頁面跟其他頁面（Chat/Admin/Help）一樣用白底
// → data-surface="light" 局部覆蓋 CSS 變數成淺色
// dark-dimmed / light-*：跟全局走，不覆蓋
export function TrainingThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme()
  return (
    <div className="h-full" data-surface={theme === 'dark' ? 'light' : undefined}>
      {children}
    </div>
  )
}
