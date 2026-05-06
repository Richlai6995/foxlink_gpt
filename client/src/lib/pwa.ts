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

  // 第二層保險:每 5 分鐘 poll /api/version,版本變了就提示
  // 不依賴 SW(SW 卡住時這條路仍能救回)
  startVersionPolling()

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
    // 沒 SW 就直接 hard reload(加 query 強制 bypass HTTP cache)
    window.location.href = window.location.pathname + '?_nocache=' + Date.now()
    return
  }
  try {
    await updateSWFn(true)
  } catch {
    window.location.reload()
  }
}

// ── 版本輪詢:不依賴 SW,每 5 分鐘問 server /api/version,版本變了就觸發 toast
let knownVersion: string | null = null
let pollTimerId: number | null = null
function startVersionPolling() {
  const POLL_INTERVAL_MS = 5 * 60 * 1000 // 5 分鐘
  const check = async () => {
    try {
      const r = await fetch('/api/version', { cache: 'no-store', credentials: 'omit' })
      if (!r.ok) return
      const { version } = await r.json()
      if (!version) return
      if (knownVersion && knownVersion !== version) {
        // 版本變了 → 通知 listener
        needRefresh = true
        for (const fn of updateListeners) fn(true)
      }
      knownVersion = version
    } catch {
      // network 失敗 silent
    }
  }
  // 延遲 30s 第一次 check(避免阻擋首屏)+ 之後每 5min
  setTimeout(() => {
    void check()
    pollTimerId = window.setInterval(check, POLL_INTERVAL_MS)
  }, 30000)
  // tab 從背景回前景時也立即 check 一次(常見場景:user 鎖屏一下午)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
}

/** 停止輪詢(測試用) */
export function stopVersionPolling() {
  if (pollTimerId) { clearInterval(pollTimerId); pollTimerId = null }
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
