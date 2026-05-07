// 一鍵清掉所有 service worker + Cache Storage + IndexedDB(嚴格版)後 hard reload
// 場景:PWA 白屏(stale chunk / 舊 manifest 卡住)/ user 自助逃生
//
// Android Chrome 特別頑固:
//   - SW 不 unregister 它會繼續攔截 fetch
//   - Cache Storage 不清會繼續供舊版 chunk
//   - 所以兩個都要清

let resetInProgress = false

export async function clearSwAndCachesAndReload(reason: string = 'manual'): Promise<void> {
  if (resetInProgress) return
  resetInProgress = true
  // eslint-disable-next-line no-console
  console.warn(`[swReset] clearing all SW + caches (reason=${reason})`)

  // 1. unregister 所有 service workers
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})))
    }
  } catch {}

  // 2. 清 Cache Storage(vite-plugin-pwa precache + runtime caches)
  try {
    if ('caches' in window) {
      const names = await caches.keys()
      await Promise.all(names.map((n) => caches.delete(n).catch(() => false)))
    }
  } catch {}

  // 3. hard reload — 加 _r 參數 bypass disk cache
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('_r', String(Date.now()))
    window.location.replace(url.toString())
  } catch {
    window.location.reload()
  }
}

// 偵測 chunk 載入失敗(stale SW / 部署後舊 user 開頁)— 自動清掉走一輪
// 第一次失敗就清 + reload;reload 後若仍失敗,第二次以上不再 auto 重置(避免 loop)
const RESET_FLAG_KEY = 'sw_reset_attempted_at'
const RESET_COOLDOWN_MS = 60_000  // 1 分鐘內已重置過就不再 auto 重置

function shouldAutoReset(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RESET_FLAG_KEY) || '0')
    if (Date.now() - last < RESET_COOLDOWN_MS) return false
    sessionStorage.setItem(RESET_FLAG_KEY, String(Date.now()))
    return true
  } catch {
    return true  // sessionStorage 不可用就放行
  }
}

function isChunkLoadError(err: unknown): boolean {
  if (!err) return false
  const msg = (err as { message?: string })?.message || String(err)
  return /Failed to fetch dynamically imported module|Loading chunk \d+ failed|Loading CSS chunk|ChunkLoadError|Importing a module script failed/i.test(msg)
}

export function installChunkErrorAutoReset() {
  if (typeof window === 'undefined') return

  // window.error(synchronous error — script load fail)
  window.addEventListener('error', (e) => {
    if (isChunkLoadError(e.error || e.message)) {
      if (shouldAutoReset()) clearSwAndCachesAndReload('chunk-error')
    }
  })

  // unhandledrejection(promise reject — dynamic import 失敗)
  window.addEventListener('unhandledrejection', (e) => {
    if (isChunkLoadError(e.reason)) {
      if (shouldAutoReset()) clearSwAndCachesAndReload('chunk-rejection')
    }
  })
}
