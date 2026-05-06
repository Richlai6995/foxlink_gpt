// PWA service worker 註冊 + install prompt 處理
// 註冊路徑由 vite-plugin-pwa(virtual:pwa-register)注入,scope 全站

import { registerSW } from 'virtual:pwa-register'

export interface InstallPromptHandle {
  prompt: () => Promise<'accepted' | 'dismissed'>
}

let deferredPrompt: any = null
let installPromptListeners: Array<(handle: InstallPromptHandle | null) => void> = []

export function initPwa() {
  // 1. 註冊 service worker(autoUpdate:有新版本自動 reload,不打擾)
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // 新版本就緒 — 因為 registerType:'autoUpdate' 會自動 reload,
      // 這裡可選 toast 通知但保持簡單
      // eslint-disable-next-line no-console
      console.log('[PWA] new version available, refreshing...')
    },
    onOfflineReady() {
      // eslint-disable-next-line no-console
      console.log('[PWA] app ready to work offline')
    },
    onRegisterError(err) {
      // eslint-disable-next-line no-console
      console.warn('[PWA] SW registration failed:', err)
    },
  })

  // 2. 攔截 beforeinstallprompt(Android Chrome / Edge)— iOS Safari 不會觸發
  window.addEventListener('beforeinstallprompt', (e: any) => {
    e.preventDefault()
    deferredPrompt = e
    notifyListeners()
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notifyListeners()
    try {
      localStorage.setItem('pwa_installed', '1')
    } catch {}
  })

  return updateSW
}

function notifyListeners() {
  const handle = deferredPrompt
    ? {
        async prompt() {
          if (!deferredPrompt) return 'dismissed' as const
          deferredPrompt.prompt()
          const choice = await deferredPrompt.userChoice
          deferredPrompt = null
          notifyListeners()
          return (choice?.outcome === 'accepted' ? 'accepted' : 'dismissed') as
            | 'accepted'
            | 'dismissed'
        },
      }
    : null
  for (const fn of installPromptListeners) fn(handle)
}

export function onInstallPromptChange(fn: (h: InstallPromptHandle | null) => void): () => void {
  installPromptListeners.push(fn)
  // 立即推送當前狀態
  fn(
    deferredPrompt
      ? {
          async prompt() {
            if (!deferredPrompt) return 'dismissed' as const
            deferredPrompt.prompt()
            const choice = await deferredPrompt.userChoice
            deferredPrompt = null
            notifyListeners()
            return (choice?.outcome === 'accepted' ? 'accepted' : 'dismissed') as
              | 'accepted'
              | 'dismissed'
          },
        }
      : null
  )
  return () => {
    installPromptListeners = installPromptListeners.filter((f) => f !== fn)
  }
}

export function isStandalone(): boolean {
  // 主畫面開啟時 display:standalone;Android 有 (display-mode: standalone),iOS 用 navigator.standalone
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS Safari
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window.navigator as any).standalone === true) return true
  return false
}
