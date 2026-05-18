// 公告即時 push — server 端 admin 變動公告時 emit 'announcement:changed'
// client 收到後 callback 觸發 refetch
import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'

let sharedSocket: Socket | null = null
let refCount = 0

function getOrCreateSocket(): Socket | null {
  if (sharedSocket) return sharedSocket
  const token = localStorage.getItem('token')
  if (!token) return null
  sharedSocket = io({
    path: '/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 20,
  })
  return sharedSocket
}

export function useAnnouncementSocket(onChanged: () => void, onProjectNotification?: (n: any) => void) {
  // 用 ref 抓最新 callback 避免 socket 反覆重連
  const cbRef = useRef(onChanged)
  cbRef.current = onChanged
  const projNotifRef = useRef(onProjectNotification)
  projNotifRef.current = onProjectNotification

  useEffect(() => {
    const socket = getOrCreateSocket()
    if (!socket) return
    refCount++
    const handler      = () => cbRef.current?.()
    const projHandler  = (n: any) => projNotifRef.current?.(n)
    socket.on('announcement:changed', handler)
    socket.on('proj_notification', projHandler)
    return () => {
      socket.off('announcement:changed', handler)
      socket.off('proj_notification', projHandler)
      refCount--
      if (refCount <= 0 && sharedSocket) {
        sharedSocket.disconnect()
        sharedSocket = null
        refCount = 0
      }
    }
  }, [])
}
