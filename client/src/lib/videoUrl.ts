// 影片 URL 處理 — 偵測外部 NAS / 雲端儲存連結,自動透過 server 的 /api/training/video-proxy
// 中繼後再餵給 <video src>,以避開 Content-Disposition: attachment 跟 cross-origin 限制。
//
// same-origin 或 /api/training/files/ 內部上傳檔不會被代理(直接走 nginx static serve 比較快)。

// 需要走 proxy 的外部 host 白名單 — 跟 server 端 VIDEO_PROXY_ALLOWED_HOSTS env 對齊
const PROXY_HOSTS = ['hqcd.foxlink.com.tw']

export function proxiedVideoUrl(rawUrl: string | undefined | null): string {
  if (!rawUrl) return ''

  // 相對路徑 / 內部上傳檔(/api/training/files/, /uploads/) — 不代理
  if (rawUrl.startsWith('/') || rawUrl.startsWith('blob:') || rawUrl.startsWith('data:')) {
    return rawUrl
  }

  let parsed: URL
  try { parsed = new URL(rawUrl) }
  catch { return rawUrl } // 解析失敗就原樣回(可能是相對路徑或格式怪),交給 <video> 自己 fail

  // same-origin 不代理
  if (parsed.host === window.location.host) return rawUrl

  // 不在白名單就原樣回 — 讓 <video> 直接打,使用者會看到 CORS / decode error,
  // 而非沒人知道的 server 502
  if (!PROXY_HOSTS.includes(parsed.hostname)) return rawUrl

  const token = localStorage.getItem('token') || ''
  return `/api/training/video-proxy?url=${encodeURIComponent(rawUrl)}&token=${encodeURIComponent(token)}`
}
