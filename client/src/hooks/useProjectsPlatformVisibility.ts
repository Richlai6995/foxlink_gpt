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
  mode: 'admin' | 'pilot' | 'user' | 'hidden'
  reason?: string
  features?: {
    internal_admin?: boolean
    dashboard?: boolean
    projects_list?: boolean
    wizard?: boolean
  }
}

const HIDDEN: Visibility = { can_see: false, mode: 'hidden' }

export function useProjectsPlatformVisibility(): Visibility {
  const { isAuthenticated, token } = useAuth() as any
  const [v, setV] = useState<Visibility>(HIDDEN)

  useEffect(() => {
    if (!isAuthenticated || !token) {
      setV(HIDDEN)
      return
    }
    let cancelled = false
    fetch('/api/projects/me/visibility', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data && typeof data.can_see === 'boolean') {
          setV(data)
        } else {
          setV(HIDDEN)
        }
      })
      .catch(() => {
        if (!cancelled) setV(HIDDEN)
      })
    return () => { cancelled = true }
  }, [isAuthenticated, token])

  return v
}
