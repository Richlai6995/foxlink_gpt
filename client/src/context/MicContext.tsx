import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import api from '../lib/api'

/**
 * MicContext — 全域麥克風狀態管理
 *
 * 1. 互鎖：同一時間只有一個 MicButton 可錄音（誰先搶到誰錄）
 * 2. 全域設定：voice_input.enabled / preferBackendOnly
 *    （server `/api/transcribe/status` 提供，整個 app 共用一份）
 */

interface MicContextType {
  enabled: boolean
  preferBackendOnly: boolean
  loaded: boolean
  // 互鎖
  activeMicId: string | null
  acquireLock: (id: string) => boolean
  releaseLock: (id: string) => void
}

const MicContext = createContext<MicContextType | null>(null)

export const MicProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [enabled, setEnabled] = useState(true)
  const [preferBackendOnly, setPreferBackendOnly] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [activeMicId, setActiveMicId] = useState<string | null>(null)

  // 啟動時拉一次設定（登入後才有 token，axios interceptor 會自動帶上）
  useEffect(() => {
    let cancelled = false
    const fetchStatus = async () => {
      try {
        const { data } = await api.get('/transcribe/status')
        if (cancelled) return
        setEnabled(!!data.enabled)
        setPreferBackendOnly(!!data.preferBackendOnly)
      } catch {
        // 沒登入或 server 沒這個端點時，預設啟用、走後端
        if (!cancelled) {
          setEnabled(true)
          setPreferBackendOnly(false)
        }
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    fetchStatus()
    return () => { cancelled = true }
  }, [])

  const acquireLock = useCallback((id: string) => {
    if (activeMicId && activeMicId !== id) return false
    setActiveMicId(id)
    return true
  }, [activeMicId])

  const releaseLock = useCallback((id: string) => {
    setActiveMicId((prev) => (prev === id ? null : prev))
  }, [])

  return (
    <MicContext.Provider value={{ enabled, preferBackendOnly, loaded, activeMicId, acquireLock, releaseLock }}>
      {children}
    </MicContext.Provider>
  )
}

export function useMic() {
  const ctx = useContext(MicContext)
  if (!ctx) {
    // 讓沒包 Provider 的地方也能呼叫但 disabled，避免炸掉
    return {
      enabled: false,
      preferBackendOnly: false,
      loaded: true,
      activeMicId: null,
      acquireLock: () => false,
      releaseLock: () => {},
    } as MicContextType
  }
  return ctx
}
