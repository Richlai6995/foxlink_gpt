/**
 * UserPicker — LOV 使用者選擇器
 * 載入全部使用者，點選輸入框就展開，即時 filter
 */
import { useState, useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import api from '../../lib/api'

interface User {
  id: number
  name: string
  username: string
  employee_id?: string
  email?: string                // 2026-06-03: /users/lov 加回 email,讓 caller 能拿
}

interface Props {
  value: string        // grantee_id (user.id as string)
  display: string      // 顯示用文字 (name + username)
  onChange: (id: string, display: string) => void
  onUserSelect?: (user: User) => void  // 2026-06-03: 拿完整 user 物件(含 email)給 caller 用
  placeholder?: string
  className?: string
  apiUrl?: string      // override API endpoint (default: /users)
}

let cachedUsers: Record<string, User[]> = {}

export default function UserPicker({ value, display, onChange, onUserSelect, placeholder = '搜尋姓名 / 帳號 / 工號 / Email', className = '', apiUrl = '/users/lov' }: Props) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState(display)
  const [users, setUsers] = useState<User[]>(cachedUsers[apiUrl] || [])
  const ref = useRef<HTMLDivElement>(null)

  // 載入全部使用者（只載一次，cache 在 module level per apiUrl）
  useEffect(() => {
    if (cachedUsers[apiUrl]) { setUsers(cachedUsers[apiUrl]); return }
    api.get(apiUrl).then(r => {
      const list: User[] = r.data || []
      cachedUsers[apiUrl] = list
      setUsers(list)
    }).catch(() => {})
  }, [])

  // 外部 display 改變時同步
  useEffect(() => { setFilter(display) }, [display])

  // outside click 收起
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        // 若沒選到有效值，清空
        if (!value) setFilter('')
        else setFilter(display)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [value, display])

  const filtered = filter.trim()
    ? users.filter(u =>
        u.name?.toLowerCase().includes(filter.toLowerCase()) ||
        u.username?.toLowerCase().includes(filter.toLowerCase()) ||
        (u.employee_id || '').toLowerCase().includes(filter.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(filter.toLowerCase())  // 2026-06-03: email 也納入搜尋
      )
    : users

  const select = (u: User) => {
    onChange(String(u.id), `${u.name} (${u.username})`)
    setFilter(`${u.name} (${u.username})`)
    if (onUserSelect) onUserSelect(u)  // 2026-06-03: 回傳完整 user 物件(含 email)
    setOpen(false)
  }

  const clear = () => {
    onChange('', '')
    setFilter('')
    setOpen(false)
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <Search size={13} className="absolute left-2.5 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={filter}
          placeholder={placeholder}
          onChange={e => { setFilter(e.target.value); if (!open) setOpen(true) }}
          onFocus={() => setOpen(true)}
          className="w-full pl-7 pr-6 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {(filter || value) && (
          <button type="button" onClick={clear} className="absolute right-2 text-gray-400 hover:text-gray-600">
            <X size={13} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">無符合結果</div>
          ) : (
            filtered.slice(0, 50).map(u => (
              <button
                key={u.id}
                type="button"
                onClick={() => select(u)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-50 last:border-0 flex items-center justify-between gap-2
                  ${value === String(u.id) ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
              >
                <span className="font-medium truncate">{u.name}</span>
                <span className="text-xs text-gray-400 shrink-0 truncate max-w-[60%] text-right">
                  {u.username}{u.employee_id ? ` · ${u.employee_id}` : ''}
                  {u.email ? ` · ${u.email}` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
