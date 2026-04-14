import { useState, useEffect, useRef } from 'react'
import { X, Search, UserCog, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'

interface UserRow {
  id: number
  username: string
  name: string
  employee_id?: string
  email?: string
  role: string
  status: string
  dept_name?: string
}

interface Props {
  onClose: () => void
}

export default function ImpersonateDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const { startImpersonate, user } = useAuth()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState<number | null>(null)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.get('/users', { params: q ? { search: q } : {} })
        const list: UserRow[] = (res.data || [])
          .filter((u: UserRow) => u.id !== user?.id && u.status === 'active')
        setRows(list.slice(0, 50))
      } catch (e: any) {
        setError(e?.response?.data?.error || t('sidebar.impersonateFailed'))
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current) }
  }, [q, user?.id, t])

  const handleSelect = async (target: UserRow) => {
    if (!confirm(t('sidebar.impersonateConfirm', { name: target.name || target.username }))) return
    setSubmitting(target.id)
    setError('')
    try {
      await startImpersonate(target.id)
    } catch (e: any) {
      setError(e?.response?.data?.error || t('sidebar.impersonateFailed'))
      setSubmitting(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-white font-semibold">
            <UserCog size={16} className="text-amber-400" />
            {t('sidebar.impersonateTitle')}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18} /></button>
        </div>

        <p className="text-slate-400 text-xs mb-3">{t('sidebar.impersonateDesc')}</p>

        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            autoFocus
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('sidebar.impersonateSearch')}
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        {error && (
          <div className="mb-3 p-2 rounded bg-red-900/40 border border-red-700/40 text-red-200 text-xs">{error}</div>
        )}

        <div className="max-h-80 overflow-y-auto border border-white/5 rounded-lg divide-y divide-white/5">
          {loading && (
            <div className="p-6 text-center text-slate-500 text-sm flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> {t('sidebar.impersonateLoading')}
            </div>
          )}
          {!loading && rows.length === 0 && (
            <div className="p-6 text-center text-slate-500 text-sm">{t('sidebar.impersonateEmpty')}</div>
          )}
          {!loading && rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-3 hover:bg-slate-800/60">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-white text-sm font-medium truncate">
                  <span className="truncate">{r.name || r.username}</span>
                  {r.role === 'admin' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300 border border-amber-700/40">admin</span>
                  )}
                </div>
                <div className="text-slate-500 text-xs truncate">
                  {r.username}{r.employee_id ? ` · ${r.employee_id}` : ''}{r.dept_name ? ` · ${r.dept_name}` : ''}
                </div>
              </div>
              <button
                onClick={() => handleSelect(r)}
                disabled={submitting !== null}
                className="shrink-0 px-3 py-1.5 text-xs rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white transition flex items-center gap-1"
              >
                {submitting === r.id ? <Loader2 size={12} className="animate-spin" /> : <UserCog size={12} />}
                {t('sidebar.impersonateSelect')}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
