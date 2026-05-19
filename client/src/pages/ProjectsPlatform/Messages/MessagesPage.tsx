/**
 * Messages — Sprint K · 域內通訊(跨專案 channel)
 *
 * 對齊 spec §10.4 + §13.5。
 *
 * 三類 room:
 *   - org_group · 跨 BU / 全公司常駐 group
 *   - org_dm    · 跨專案 1:1 私訊
 *
 * Layout(類似 Slack):
 *   ┌────────────┬──────────────────────────────────┐
 *   │ Room list  │ Header (room info + actions)     │
 *   │ + Group    │ Messages stream                  │
 *   │ + DM       │ ───────────────────────────────  │
 *   │ + new...   │ Input                            │
 *   └────────────┴──────────────────────────────────┘
 */

import { useEffect, useState } from 'react'
import { Plus, Hash, MessageSquare, Lock, RefreshCw, Send, Loader2, X, Search, Bot } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api } from '../api'
import { useCrumbs } from '../Shell/PlatformContext'

// ─── Module-level shared socket(全程式共用一條 comm socket,類似 useProjectsPlatformSocket)
let _commSocket: any = null
let _commRefCount = 0

function _getCommSocket(io: any) {
  if (_commSocket) {
    _commRefCount++
    return _commSocket
  }
  const token = localStorage.getItem('token')
  if (!token) return null
  _commSocket = io({
    path: '/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 20,
  })
  _commRefCount = 1
  return _commSocket
}

function _releaseCommSocket() {
  _commRefCount--
  if (_commRefCount <= 0 && _commSocket) {
    _commSocket.disconnect()
    _commSocket = null
    _commRefCount = 0
  }
}

type Room = {
  id: number
  room_type: 'org_group' | 'org_dm'
  name: string
  description?: string | null
  scope?: string
  bu_id?: number | null
  is_confidential: boolean
  is_archived: boolean
  my_role?: string
  dm_user_a_id?: number | null
  dm_user_b_id?: number | null
  unread_count?: number
  last_message_at?: string | null
}

type Message = {
  id: number
  room_id: number
  user_id: number
  content: string
  message_type: string
  is_pinned: number
  pinned_by?: number | null
  deleted_at?: string | null
  created_at: string
  user_username?: string | null
  user_name?: string | null
}

export default function MessagesPage() {
  useCrumbs([{ label: '訊息 · 域內通訊' }])
  const { token, user } = useAuth() as any

  const [rooms, setRooms] = useState<Room[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [showNewDm, setShowNewDm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const reload = async () => {
    if (!token) return
    setLoading(true)
    try {
      const r = await api.get<{ rooms: Room[] }>(token, '/comm-rooms')
      setRooms(r.rooms || [])
      // 預設選第一個(若還沒選)
      if (!activeId && (r.rooms || []).length > 0) setActiveId(r.rooms[0].id)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const active = rooms.find((r) => r.id === activeId)

  return (
    <div className="space-y-3">
      {/* Page head */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-cortex-ink tracking-tight">💌 訊息</h1>
          <div className="text-[12px] text-cortex-muted mt-1">
            spec §10.4 / §13.5 · 跨專案 group + 跨組織 DM · 與專案 channel 解耦
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={reload}
            className="px-3 py-1.5 text-[12px] border border-cortex-line bg-white rounded hover:bg-cortex-bg inline-flex items-center gap-1"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
          <button
            onClick={() => setShowNewDm(true)}
            className="px-3 py-1.5 text-[12px] border border-cortex-line bg-white rounded hover:bg-cortex-bg inline-flex items-center gap-1"
          >
            <Plus size={12} /> 新 DM
          </button>
          <button
            onClick={() => setShowNewGroup(true)}
            className="px-3 py-1.5 text-[12px] bg-cortex-cyan text-cortex-navy rounded hover:opacity-90 font-semibold inline-flex items-center gap-1"
          >
            <Plus size={12} /> 新 Group
          </button>
        </div>
      </div>

      {err && (
        <div className="bg-cortex-red-bg/40 border border-red-200 rounded p-2 text-[12px] text-red-700">
          {err}
        </div>
      )}

      <div className="grid grid-cols-[260px_1fr] gap-3 h-[560px]">
        {/* Room list */}
        <aside className="bg-white border border-cortex-line rounded-lg overflow-y-auto">
          <div className="px-3 py-2 border-b border-cortex-line">
            <div className="text-[10px] font-bold text-cortex-muted uppercase tracking-widest">
              我的 rooms({rooms.length})
            </div>
          </div>
          {rooms.length === 0 ? (
            <div className="p-3 text-[11px] text-cortex-muted italic">
              尚無 room · 點右上「+ 新 Group / 新 DM」開始
            </div>
          ) : (
            rooms.map((r) => (
              <RoomListItem
                key={r.id}
                room={r}
                active={r.id === activeId}
                onClick={() => setActiveId(r.id)}
                meId={user?.id}
              />
            ))
          )}
        </aside>

        {/* Right: active room */}
        <main className="bg-white border border-cortex-line rounded-lg flex flex-col min-w-0 overflow-hidden">
          {active ? (
            <RoomChat room={active} key={active.id} token={token} meId={user?.id} onRefresh={reload} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-cortex-muted text-[12px]">
              請從左欄選一個 room
            </div>
          )}
        </main>
      </div>

      {showNewGroup && (
        <NewGroupModal
          token={token}
          onClose={() => setShowNewGroup(false)}
          onCreated={(roomId) => { setShowNewGroup(false); reload(); setActiveId(roomId) }}
        />
      )}
      {showNewDm && (
        <NewDmModal
          token={token}
          onClose={() => setShowNewDm(false)}
          onCreated={(roomId) => { setShowNewDm(false); reload(); setActiveId(roomId) }}
        />
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Room list item
// ────────────────────────────────────────────────────────────────────
function RoomListItem({ room, active, onClick, meId }: { room: Room; active: boolean; onClick: () => void; meId?: number }) {
  const Icon = room.room_type === 'org_dm' ? Lock : Hash
  // DM 顯示對方 user id(Phase 2 補對方名字)
  let name = room.name
  if (room.room_type === 'org_dm' && meId) {
    const other = Number(room.dm_user_a_id) === meId ? room.dm_user_b_id : room.dm_user_a_id
    name = `DM · user#${other}`
  }
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 border-b border-cortex-line/50 transition ${
        active ? 'bg-cortex-cyan-bg' : 'hover:bg-cortex-line-2/30'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Icon size={12} className={active ? 'text-cortex-teal' : 'text-cortex-muted'} />
        <span className={`text-[12px] flex-1 truncate ${active ? 'font-bold text-cortex-teal' : 'text-cortex-ink'}`}>
          {name}
        </span>
        {!!room.unread_count && room.unread_count > 0 && (
          <span className="text-[9px] font-bold bg-red-500 text-white px-1.5 rounded-full">
            {room.unread_count > 99 ? '99+' : room.unread_count}
          </span>
        )}
      </div>
      {room.room_type === 'org_group' && (
        <div className="text-[9px] text-cortex-muted mt-0.5 font-mono">
          {room.bu_id ? `BU#${room.bu_id}` : 'global'}
          {room.is_confidential && <span className="ml-1 text-amber-700">🔒 機密</span>}
        </div>
      )}
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────
// Room chat
// ────────────────────────────────────────────────────────────────────
function RoomChat({ room, token, meId, onRefresh }: { room: Room; token: string; meId?: number; onRefresh: () => void }) {
  const [msgs, setMsgs] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [posting, setPosting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const loadMessages = async () => {
    setLoading(true)
    try {
      const r = await api.get<{ messages: Message[] }>(token, `/comm-rooms/${room.id}/messages?limit=100`)
      // backend DESC → reverse
      setMsgs((r.messages || []).slice().reverse())
      // mark read
      api.post(token, `/comm-rooms/${room.id}/read`).catch(() => {})
    } catch (e) {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadMessages() }, [room.id, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // socket
  const { lastEvent, connected } = useCommRoomSocket(room.id)
  useEffect(() => {
    if (!lastEvent) return
    if (lastEvent.type === 'comm_new_message' && Number(lastEvent.data?.room_id) === room.id) {
      setReloadKey((k) => k + 1)
    }
  }, [lastEvent, room.id])

  const send = async () => {
    if (!input.trim()) return
    setPosting(true)
    try {
      await api.post(token, `/comm-rooms/${room.id}/messages`, { content: input.trim() })
      setInput('')
      setReloadKey((k) => k + 1)
      onRefresh()
    } catch (e: any) {
      alert('發送失敗:' + e.message)
    } finally {
      setPosting(false)
    }
  }

  const Icon = room.room_type === 'org_dm' ? Lock : Hash
  let title = room.name
  if (room.room_type === 'org_dm' && meId) {
    const other = Number(room.dm_user_a_id) === meId ? room.dm_user_b_id : room.dm_user_a_id
    title = `DM · user#${other}`
  }

  return (
    <>
      {/* Header */}
      <div className="border-b border-cortex-line px-4 py-2.5 flex items-center gap-2">
        <Icon size={14} className="text-cortex-muted" />
        <span className="text-[14px] font-bold text-cortex-ink">{title}</span>
        <span className="text-[10px] text-cortex-muted">· {room.room_type}</span>
        {room.is_confidential && <span className="text-[9px] bg-cortex-amber-bg text-amber-800 px-1.5 py-0.5 rounded font-bold">🔒 機密</span>}
        {room.description && <span className="text-[11px] text-cortex-muted">— {room.description}</span>}
        <span className={`ml-auto text-[10px] inline-flex items-center gap-0.5 ${connected ? 'text-cortex-green' : 'text-cortex-muted'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-cortex-green' : 'bg-cortex-muted'}`} />
          {connected ? '即時' : '離線'}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5 bg-cortex-bg/30">
        {loading ? (
          <div className="text-center text-cortex-muted text-[12px] py-4">
            <Loader2 size={14} className="inline animate-spin mr-1" /> 載入中…
          </div>
        ) : msgs.length === 0 ? (
          <div className="text-center text-cortex-muted text-[12px] italic py-4">
            尚無訊息 · 開始對話吧
          </div>
        ) : (
          msgs.map((m) => {
            const isMine = Number(m.user_id) === Number(meId)
            const isSystem = m.message_type === 'SYSTEM'
            const isBot = m.message_type === 'AI_INSIGHT'
            return (
              <div
                key={m.id}
                className={`text-[12px] px-2.5 py-1.5 rounded ${
                  isMine ? 'bg-cortex-cyan-bg/50' :
                  isSystem ? 'bg-cortex-line-2/30 italic text-cortex-muted text-[11px]' :
                  isBot ? 'bg-purple-50 border border-purple-200' :
                  'bg-white border border-cortex-line/40'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5 text-[10px] text-cortex-muted">
                  {isBot && <Bot size={10} className="text-purple-600" />}
                  <span className="font-semibold text-cortex-ink">
                    {m.user_name || m.user_username || `user#${m.user_id}`}
                  </span>
                  <span>·</span>
                  <span>{new Date(m.created_at).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  {m.is_pinned ? <span className="text-amber-600 font-bold">📌 pin</span> : null}
                </div>
                <div className="text-cortex-ink whitespace-pre-wrap leading-relaxed">{m.content}</div>
              </div>
            )
          })
        )}
      </div>

      {/* Input */}
      <div className="border-t border-cortex-line p-2 bg-white">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() }
            }}
            placeholder={`在 ${title} 發訊息(Cmd/Ctrl+Enter 送出)`}
            rows={2}
            className="flex-1 px-3 py-1.5 border border-cortex-line rounded text-[12px] text-cortex-ink resize-none focus:outline-none focus:border-cortex-cyan"
          />
          <button
            onClick={send}
            disabled={!input.trim() || posting}
            className="px-3 py-2 bg-cortex-cyan text-cortex-navy rounded text-[12px] font-bold disabled:opacity-40 inline-flex items-center gap-1"
          >
            <Send size={12} /> {posting ? '送出中…' : '送出'}
          </button>
        </div>
      </div>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────
// Modals
// ────────────────────────────────────────────────────────────────────
function NewGroupModal({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [buId, setBuId] = useState('')
  const [confidential, setConfidential] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim()) { setErr('name required'); return }
    setSubmitting(true)
    setErr(null)
    try {
      const r = await api.post<{ room: Room }>(token, '/comm-rooms/groups', {
        name: name.trim(),
        description: description.trim() || undefined,
        bu_id: buId ? Number(buId) : null,
        is_confidential: confidential,
      })
      onCreated(r.room.id)
    } catch (e: any) {
      setErr(e.message || '失敗')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-[480px] w-full overflow-hidden shadow-2xl">
        <div className="bg-gradient-to-r from-cortex-navy to-cortex-teal px-5 py-3 text-white flex items-center justify-between">
          <div className="text-base font-bold">建跨組織 Group</div>
          <button onClick={onClose} className="text-cortex-cyan-bg hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <div className="text-[11px] font-bold text-cortex-muted uppercase tracking-wider mb-1">Group name</div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full px-2 py-1.5 border border-cortex-line rounded text-[12px] focus:outline-none focus:border-cortex-cyan"
              placeholder="e.g. BU1-業務週會"
            />
          </div>
          <div>
            <div className="text-[11px] font-bold text-cortex-muted uppercase tracking-wider mb-1">描述(可空)</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-2 py-1.5 border border-cortex-line rounded text-[12px] focus:outline-none focus:border-cortex-cyan"
            />
          </div>
          <div>
            <div className="text-[11px] font-bold text-cortex-muted uppercase tracking-wider mb-1">BU ID(空 = 全公司)</div>
            <input
              type="number"
              value={buId}
              onChange={(e) => setBuId(e.target.value)}
              className="w-32 px-2 py-1.5 border border-cortex-line rounded text-[12px] focus:outline-none focus:border-cortex-cyan font-mono"
              placeholder="1"
            />
          </div>
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} />
            <span>🔒 機密 group(雙簽邀請 · Phase 2 未啟用 enforcement)</span>
          </label>
          {err && (
            <div className="bg-cortex-red-bg/40 border border-red-200 rounded p-2 text-[11px] text-red-700">{err}</div>
          )}
          <div className="flex justify-end gap-2 pt-1 border-t border-cortex-line">
            <button onClick={onClose} className="px-3 py-1.5 text-[12px] text-cortex-muted">取消</button>
            <button
              onClick={submit}
              disabled={submitting || !name.trim()}
              className="px-4 py-1.5 text-[12px] font-bold bg-cortex-cyan text-cortex-navy rounded disabled:opacity-40 inline-flex items-center gap-1"
            >
              {submitting ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />}
              建立
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function NewDmModal({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: (id: number) => void }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setSearching(true)
      const url = q.trim()
        ? `/internal-admin/users/search?q=${encodeURIComponent(q.trim())}`
        : `/internal-admin/users/search`
      api.get<{ users: any[] }>(token, url)
        .then((r) => setList(r.users || []))
        .catch(() => setList([]))
        .finally(() => setSearching(false))
    }, 250)
    return () => clearTimeout(t)
  }, [q, token])

  const startDm = async (targetUserId: number) => {
    setSubmitting(true)
    setErr(null)
    try {
      const r = await api.post<{ room: Room }>(token, '/comm-rooms/dm', { target_user_id: targetUserId })
      onCreated(r.room.id)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-[480px] w-full overflow-hidden shadow-2xl">
        <div className="bg-gradient-to-r from-cortex-navy to-cortex-teal px-5 py-3 text-white flex items-center justify-between">
          <div className="text-base font-bold">開新 DM</div>
          <button onClick={onClose} className="text-cortex-cyan-bg hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-2.5 text-cortex-muted pointer-events-none" />
            <input
              type="text"
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜尋 user(姓名 / 工號 / email)…"
              className="w-full pl-7 pr-2 py-1.5 border border-cortex-line rounded text-[12px] focus:outline-none focus:border-cortex-cyan"
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto border border-cortex-line rounded">
            {searching && <div className="text-[11px] text-cortex-muted italic p-2">搜尋中…</div>}
            {!searching && list.length === 0 && <div className="text-[11px] text-cortex-muted italic p-2">無結果</div>}
            {list.map((u) => (
              <button
                key={u.user_id}
                onClick={() => startDm(u.user_id)}
                disabled={submitting}
                className="block w-full text-left px-2.5 py-2 hover:bg-cortex-cyan-bg text-[12px] border-b border-cortex-line/40 last:border-b-0 disabled:opacity-50"
              >
                <span className="font-semibold text-cortex-ink">{u.name || u.username}</span>
                <span className="ml-2 text-[10px] font-mono text-cortex-muted">{u.username} · {u.email || '—'}</span>
              </button>
            ))}
          </div>
          {err && (
            <div className="bg-cortex-red-bg/40 border border-red-200 rounded p-2 text-[11px] text-red-700">{err}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Socket hook(專為 comm room · 與 useProjectsPlatformSocket 共用 socket)
// ────────────────────────────────────────────────────────────────────
function useCommRoomSocket(roomId: number | null) {
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<{ type: string; data: any; _seq: number } | null>(null)

  // module-level shared singleton + ref count(同 useProjectsPlatformSocket 模式)
  // 切 room 不重連,只 emit join/leave
  useEffect(() => {
    if (!roomId) return
    let cancelled = false
    let seq = 0
    let socketRef: any = null

    const setup = async () => {
      const { io } = await import('socket.io-client')
      if (cancelled) return
      socketRef = _getCommSocket(io)
      if (!socketRef) return

      const onConnect = () => {
        setConnected(true)
        socketRef.emit('join_comm_room', { roomId })
      }
      const onReconnect = () => socketRef.emit('join_comm_room', { roomId })
      const onDisc = () => setConnected(false)
      const onMsg = (d: any) => {
        if (Number(d?.room_id) !== Number(roomId)) return  // filter:只接收本 room 的訊息
        seq++
        setLastEvent({ type: 'comm_new_message', data: d, _seq: seq })
      }
      socketRef.on('connect',           onConnect)
      socketRef.on('reconnect',         onReconnect)
      socketRef.on('disconnect',        onDisc)
      socketRef.on('comm_new_message',  onMsg)

      // 已連線 → 立即 join + handlers
      if (socketRef.connected) onConnect()

      // cleanup
      (setup as any)._cleanup = () => {
        socketRef.off('connect',          onConnect)
        socketRef.off('reconnect',        onReconnect)
        socketRef.off('disconnect',       onDisc)
        socketRef.off('comm_new_message', onMsg)
        try { socketRef.emit('leave_comm_room', { roomId }) } catch {}
        _releaseCommSocket()
      }
    }
    setup()

    return () => {
      cancelled = true
      if ((setup as any)._cleanup) (setup as any)._cleanup()
    }
  }, [roomId])

  return { connected, lastEvent }
}

