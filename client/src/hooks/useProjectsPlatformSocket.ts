/**
 * useProjectsPlatformSocket — 專案管理平台即時推播
 *
 * 用 Cortex 既有的 /socket.io 連線(socketService.js),server 上加了:
 *   - room: proj:{projectId} / proj:channel:{channelId} / user:{userId}
 *   - events: proj_new_message / proj_stage_advanced / proj_lifecycle_changed / proj_notification
 *
 * 用法:
 *   const { lastEvent, connected } = useProjectsPlatformSocket({ projectId, channelId })
 *   useEffect(() => { if (lastEvent?.type === 'proj_new_message') reload(...) }, [lastEvent])
 *
 * Note: channelId 變動會自動 leave 舊 / join 新。
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'

export type ProjectsSocketEvent =
  | { type: 'proj_new_message'; data: { channel_id: number; message: any }; _seq: number }
  | { type: 'proj_stage_advanced'; data: { project_id: number; from_stage_code?: string; to_stage_code?: string; project_closed?: boolean; actor_user_id?: number }; _seq: number }
  | { type: 'proj_lifecycle_changed'; data: { project_id: number; from?: string; to?: string; actor_user_id?: number; reason?: string | null }; _seq: number }
  | { type: 'proj_notification'; data: { id?: number; title: string; message?: string; link_url?: string; project_id?: number | null; priority?: string }; _seq: number }

let _shared: Socket | null = null  // 全程式共用一條 socket(同時兩個 WarRoom tab 也只開一條)
let _refCount = 0

function _getSocket(): Socket | null {
  if (_shared) return _shared
  const token = localStorage.getItem('token')
  if (!token) return null
  _shared = io({
    path: '/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 20,
  })
  return _shared
}

function _releaseSocket() {
  _refCount--
  if (_refCount <= 0 && _shared) {
    _shared.disconnect()
    _shared = null
    _refCount = 0
  }
}

type Opts = {
  projectId?: number | null
  channelId?: number | null
}

export function useProjectsPlatformSocket({ projectId, channelId }: Opts = {}) {
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<ProjectsSocketEvent | null>(null)
  const seqRef = useRef(0)

  const fire = useCallback((type: ProjectsSocketEvent['type'], data: any) => {
    seqRef.current++
    setLastEvent({ type, data, _seq: seqRef.current } as ProjectsSocketEvent)
  }, [])

  useEffect(() => {
    const socket = _getSocket()
    if (!socket) return
    socketRef.current = socket
    _refCount++

    const joinRooms = () => {
      if (projectId) socket.emit('join_project', { projectId })
      if (channelId && projectId) socket.emit('join_project_channel', { projectId, channelId })
    }

    const onConnect = () => { setConnected(true); joinRooms() }
    const onReconnect = () => joinRooms()
    const onDisconnect = () => setConnected(false)

    socket.on('connect', onConnect)
    socket.on('reconnect', onReconnect)
    socket.on('disconnect', onDisconnect)

    const onMsg     = (d: any) => fire('proj_new_message',       d)
    const onStage   = (d: any) => fire('proj_stage_advanced',    d)
    const onLife    = (d: any) => fire('proj_lifecycle_changed', d)
    const onNotif   = (d: any) => fire('proj_notification',      d)
    socket.on('proj_new_message',       onMsg)
    socket.on('proj_stage_advanced',    onStage)
    socket.on('proj_lifecycle_changed', onLife)
    socket.on('proj_notification',      onNotif)

    // 已連線就立刻 join(socket reuse 場景)
    if (socket.connected) {
      setConnected(true)
      joinRooms()
    }

    return () => {
      if (channelId) socket.emit('leave_project_channel', { channelId })
      if (projectId) socket.emit('leave_project', { projectId })
      socket.off('connect',                onConnect)
      socket.off('reconnect',              onReconnect)
      socket.off('disconnect',             onDisconnect)
      socket.off('proj_new_message',       onMsg)
      socket.off('proj_stage_advanced',    onStage)
      socket.off('proj_lifecycle_changed', onLife)
      socket.off('proj_notification',      onNotif)
      _releaseSocket()
    }
  }, [projectId, channelId, fire])

  return { connected, lastEvent }
}
