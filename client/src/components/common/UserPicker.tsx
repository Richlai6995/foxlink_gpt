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
}

interface Props {
  value: string        // grantee_id (user.id as string)
  display: string      // 顯示用文字 (name + username)
  onChange: (id: string, display: string) => void
  placeholder?: string
  className?: string
}

let cachedUsers: User[] | null = null

export default function UserPicker({ value, display, onChange, placeholder = '搜尋姓名 / 帳號 / 工號', className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState(display)
  const [users, setUsers] = useState<User[]>(cachedUsers || [])
  const ref = useRef<HTMLDivElement>(null)

  // 載入全部使用者（只載一次，cache 在 module level）
  useEffect(() => {
    if (cachedUsers) { setUsers(cachedUsers); return }
    api.get('/users').then(r => {
      const list: User[] = r.data || []
      cachedUsers = list
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
        (u.employee_id || '').toLowerCase().includes(filter.toLowerCase())
      )
    : users

  const select = (u: User) => {
    onChange(String(u.id), `${u.name} (${u.username})`)
    setFilter(`${u.name} (${u.username})`)
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
                className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-50 last:border-0 flex items-center justify-between
                  ${value === String(u.id) ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
              >
                <span className="font-medium">{u.name}</span>
                <span className="text-xs text-gray-400">{u.username}{u.employee_id ? ` · ${u.employee_id}` : ''}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
