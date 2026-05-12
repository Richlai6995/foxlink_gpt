/**
 * PlatformContext — Cortex Projects Platform 內部 shell 共用 state
 *
 * 共用:
 *   - sidebar open / toggle
 *   - 當前 demo role(6 種角色切換,影響機密欄位顯示)
 *   - breadcrumb 動態設定(子頁 useEffect 設,topbar 顯示)
 *
 * 範圍只在 /projects-platform/* 內,不影響 Cortex 主站。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { DemoRole } from '../tokens'
import { setApiDemoRole } from '../api'

type Crumb = { label: string; to?: string }

type Ctx = {
  sidebarOpen: boolean
  toggleSidebar: () => void
  closeSidebar: () => void

  demoRole: DemoRole
  setDemoRole: (r: DemoRole) => void

  crumbs: Crumb[]
  setCrumbs: (c: Crumb[]) => void
}

const PlatformCtx = createContext<Ctx | null>(null)

export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [demoRole, _setDemoRole] = useState<DemoRole>('HOST')
  const [crumbs, setCrumbs] = useState<Crumb[]>([])

  // 同步 demo role 進 api 全局,然後 broadcast event 讓 active page reload
  const setDemoRole = useCallback((r: DemoRole) => {
    _setDemoRole(r)
    setApiDemoRole(r)
    window.dispatchEvent(new CustomEvent('projectsPlatformDemoRoleChange', { detail: { role: r } }))
  }, [])

  // 初始同步
  useEffect(() => { setApiDemoRole(demoRole) }, [demoRole])

  // 鍵盤快捷鍵:M 切 sidebar、Esc 關
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'm' || e.key === 'M') {
        setSidebarOpen((v) => !v)
      } else if (e.key === 'Escape') {
        // Modal 開時別關 sidebar(由 modal 自己處理)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const value = useMemo<Ctx>(() => ({
    sidebarOpen,
    toggleSidebar: () => setSidebarOpen((v) => !v),
    closeSidebar: () => setSidebarOpen(false),
    demoRole,
    setDemoRole,
    crumbs,
    setCrumbs,
  }), [sidebarOpen, demoRole, crumbs, setDemoRole])

  return <PlatformCtx.Provider value={value}>{children}</PlatformCtx.Provider>
}

export function usePlatform() {
  const v = useContext(PlatformCtx)
  if (!v) throw new Error('usePlatform must be inside PlatformProvider')
  return v
}

/**
 * 在子頁 useEffect 內呼叫,設定 topbar breadcrumb
 *
 * @example
 *   useCrumbs([{ label: '我的專案', to: '/projects-platform' }, { label: 'QT-2026-0143' }])
 */
export function useCrumbs(crumbs: Crumb[]) {
  const { setCrumbs } = usePlatform()
  // 序列化 deps 避免 array reference 不穩
  const key = JSON.stringify(crumbs)
  const stable = useCallback(() => setCrumbs(crumbs), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    stable()
    return () => setCrumbs([])
  }, [stable, setCrumbs])
}
