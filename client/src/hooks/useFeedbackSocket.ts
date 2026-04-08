import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'

interface TypingUser {
  userId: number
  name: string
}

export function useFeedbackSocket(ticketId?: number) {
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  // counter 確保每次 event 都觸發 re-render
  const [lastEvent, setLastEvent] = useState<{ type: string; data: any; _seq: number } | null>(null)
  const seqRef = useRef(0)

  const fireEvent = useCallback((type: string, data: any) => {
    seqRef.current++
    setLastEvent({ type, data, _seq: seqRef.current })
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return

    // 連接到 server 根路徑（Vite proxy 會轉發 /socket.io）
    const socket = io({
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 20,
    })

    socketRef.current = socket

    const joinRoom = () => {
      if (ticketId) {
        socket.emit('join_ticket', { ticketId })
      }
    }

    socket.on('connect', () => {
      setConnected(true)
      joinRoom() // connect 後才 join
    })

    socket.on('reconnect', () => {
      joinRoom() // 重連後重新 join
    })

    socket.on('disconnect', () => setConnected(false))

    // 事件監聽
    socket.on('new_message', (data) => fireEvent('new_message', data))
    socket.on('status_changed', (data) => fireEvent('status_changed', data))
    socket.on('new_ticket', (data) => fireEvent('new_ticket', data))
    socket.on('ticket_assigned', (data) => fireEvent('ticket_assigned', data))
    socket.on('notification', (data) => fireEvent('notification', data))

    // Typing indicator
    socket.on('user_typing', ({ userId, name }: TypingUser) => {
      setTypingUsers(prev => {
        if (prev.some(u => u.userId === userId)) return prev
        return [...prev, { userId, name }]
      })
    })

    socket.on('user_stop_typing', ({ userId }: { userId: number }) => {
      setTypingUsers(prev => prev.filter(u => u.userId !== userId))
    })

    socket.on('connect_error', (err) => {
      console.warn('[FeedbackSocket] connect error:', err.message)
    })

    return () => {
      if (ticketId) socket.emit('leave_ticket', { ticketId })
      socket.disconnect()
      socketRef.current = null
    }
  }, [ticketId, fireEvent])

  const sendTyping = useCallback((tid: number) => {
    socketRef.current?.emit('typing', { ticketId: tid })
  }, [])

  const sendStopTyping = useCallback((tid: number) => {
    socketRef.current?.emit('stop_typing', { ticketId: tid })
  }, [])

  return { connected, typingUsers, lastEvent, sendTyping, sendStopTyping }
}
