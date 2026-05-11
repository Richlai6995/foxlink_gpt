/**
 * useProjectsPlatformVisibility — 取得當前 user 對 projects-platform 的可見性
 *
 * 對應 docs/projects-platform-internal-admin-plan.md §A.3.2
 *
 * 後端 API: GET /api/projects/me/visibility
 *   { can_see, mode, reason, features }
 *
 * Phase 0:預設只給 admin 看;一般 user 完全看不到 sidebar menu。
 */

import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'

type Visibility = {
  can_see: boolean
  mode: 'admin' | 'pilot' | 'user' | 'hidden' | 'loading'
  reason?: string
  features?: {
    internal_admin?: boolean
    dashboard?: boolean
    projects_list?: boolean
    wizard?: boolean
  }
  user?: { id: number; username: string; role: string } | null
  /** debug-only:API call 失敗時的 raw error */
  api_error?: string
}

const HIDDEN:  Visibility = { can_see: false, mode: 'hidden',  reason: 'no-user' }
const LOADING: Visibility = { can_see: false, mode: 'loading', reason: 'pending' }

export function useProjectsPlatformVisibility(): Visibility {
  const { isAuthenticated, token } = useAuth() as any
  const [v, setV] = useState<Visibility>(LOADING)

  useEffect(() => {
    if (!isAuthenticated || !token) {
      setV(HIDDEN)
      return
    }
    let cancelled = false
    setV(LOADING)
    fetch('/api/projects/me/visibility', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) {
          const txt = await r.text().catch(() => '')
          throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`)
        }
        return r.json()
      })
      .then((data) => {
        if (cancelled) return
        if (data && typeof data.can_see === 'boolean') {
          setV(data)
        } else {
          setV({ ...HIDDEN, reason: 'invalid-response', api_error: JSON.stringify(data).slice(0, 200) })
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setV({ ...HIDDEN, reason: 'api-error', api_error: String(e?.message || e) })
        }
      })
    return () => { cancelled = true }
  }, [isAuthenticated, token])

  return v
}
