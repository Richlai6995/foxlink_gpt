// PWA service worker 註冊 + install prompt 處理 + 新版可用通知
// 註冊路徑由 vite-plugin-pwa(virtual:pwa-register)注入,scope 全站
// 模式為 'prompt':新版可用時不自動 reload,改透過 UpdateAvailableToast 提示 user

import { registerSW } from 'virtual:pwa-register'

export interface InstallPromptHandle {
  prompt: () => Promise<'accepted' | 'dismissed'>
}

let deferredPrompt: any = null
let installPromptListeners: Array<(handle: InstallPromptHandle | null) => void> = []

// 新版可用通知 — UpdateAvailableToast 訂閱
let updateSWFn: ((reloadPage?: boolean) => Promise<void>) | null = null
let needRefresh = false
let updateListeners: Array<(needRefresh: boolean) => void> = []

export function initPwa() {
  // 1. 註冊 service worker — registerType:'prompt' 模式
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // 新版本就緒,但不自動 reload — 通知 UI 讓 user 點按鈕
      needRefresh = true
      for (const fn of updateListeners) fn(true)
      // eslint-disable-next-line no-console
      console.log('[PWA] new version available, prompting user')
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
  updateSWFn = updateSW

  // 同 origin 載入新 sw 後若 controller 改變(skipWaiting 完成)→ 強制 reload
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return
      refreshing = true
      window.location.reload()
    })
  }

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

/** UpdateAvailableToast 訂閱:當 SW 偵測到新版時 fn(true)被呼叫 */
export function onUpdateAvailable(fn: (needRefresh: boolean) => void): () => void {
  updateListeners.push(fn)
  fn(needRefresh) // 立即推當前狀態
  return () => { updateListeners = updateListeners.filter((f) => f !== fn) }
}

/** user 同意更新 → skipWaiting + reload */
export async function applyUpdate() {
  if (!updateSWFn) {
    window.location.reload()
    return
  }
  try {
    await updateSWFn(true)
  } catch {
    // fallback:直接 reload
    window.location.reload()
  }
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
