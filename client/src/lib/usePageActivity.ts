import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import api from './api'

// 頁面路由 → 中文名稱對照
const PAGE_TITLES: Record<string, string> = {
  '/':            '對話',
  '/chat':        '對話',
  '/skills':      '技能市場',
  '/knowledge':   '知識庫',
  '/dify':        'API 連接器',
  '/mcp':         'MCP',
  '/research':    '深度研究',
  '/monitor':     'AI 戰情',
  '/dashboard':   'AI 戰情',
  '/admin':       '系統管理',
  '/help':        '說明',
}

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]
  for (const [k, v] of Object.entries(PAGE_TITLES)) {
    if (k !== '/' && pathname.startsWith(k)) return v
  }
  return pathname
}

/**
 * 在 App 頂層 mount 一次，每次換頁 + 每 60 秒定期上報目前頁面到 session。
 */
export function usePageActivity() {
  const location = useLocation()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const report = (pathname: string) => {
    // 沒 token 不打 — 否則 401 → axios interceptor 強制 reload → 死循環（在 /login 也會觸發）
    if (!localStorage.getItem('token')) return
    api.post('/auth/activity', {
      page: pathname,
      page_title: getPageTitle(pathname),
    }).catch(() => {})
  }

  useEffect(() => {
    report(location.pathname)

    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => report(location.pathname), 60_000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [location.pathname])
}
