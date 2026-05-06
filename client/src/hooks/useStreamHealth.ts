// SSE 串流健康偵測 — cheap fix(visibilitychange + online/offline)
// 不做 server-side resume,斷線時只通知 caller 取消 + 顯示「重發」banner
import { useEffect, useRef, useState, useCallback } from 'react'

export interface StreamHealthOptions {
  /** 多久沒收到 chunk 視為 stall(預設 30 秒) */
  stallMs?: number
  /** 偵測到斷線時呼叫 abort */
  onAbort: () => void
  /** 是否正在串流(只在串流期間監測) */
  streaming: boolean
}

export type StallReason = 'offline' | 'background_stall' | null

export function useStreamHealth({ stallMs = 30000, onAbort, streaming }: StreamHealthOptions) {
  const lastChunkAtRef = useRef<number>(0)
  const [stallReason, setStallReason] = useState<StallReason>(null)

  // streaming 啟動時 reset
  useEffect(() => {
    if (streaming) {
      lastChunkAtRef.current = Date.now()
      setStallReason(null)
    }
  }, [streaming])

  // 串流期間呼叫,通知有新 chunk
  const noteChunk = useCallback(() => {
    lastChunkAtRef.current = Date.now()
  }, [])

  // visibilitychange:從背景回前景時,若 streaming 且最後 chunk 太久前 → abort + 顯示 banner
  useEffect(() => {
    if (!streaming) return
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      const elapsed = Date.now() - lastChunkAtRef.current
      if (elapsed > stallMs) {
        setStallReason('background_stall')
        onAbort()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [streaming, stallMs, onAbort])

  // offline:斷網時直接 abort
  useEffect(() => {
    if (!streaming) return
    const onOffline = () => {
      setStallReason('offline')
      onAbort()
    }
    window.addEventListener('offline', onOffline)
    return () => window.removeEventListener('offline', onOffline)
  }, [streaming, onAbort])

  // 定時檢查(每 5s):前景但 streaming 卻長時間沒 chunk → 也視為 stall
  // (有些 mobile browser 不會觸發 visibilitychange,只會 throttle)
  useEffect(() => {
    if (!streaming) return
    const id = window.setInterval(() => {
      const elapsed = Date.now() - lastChunkAtRef.current
      if (elapsed > stallMs && document.visibilityState === 'visible') {
        setStallReason('background_stall')
        onAbort()
      }
    }, 5000)
    return () => window.clearInterval(id)
  }, [streaming, stallMs, onAbort])

  const clearStall = useCallback(() => setStallReason(null), [])

  return { stallReason, noteChunk, clearStall }
}
