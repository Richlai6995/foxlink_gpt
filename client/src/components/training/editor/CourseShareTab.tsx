/**
 * CourseShareTab — 課程分享設定（嵌入 CourseEditor tab）
 * 支援：view（預覽）/ develop（協同開發）權限
 * Grantee types: user / role / department / cost_center / division / org_group
 */
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../../lib/api'
import UserPicker from '../../common/UserPicker'
import { Plus, X, Users } from 'lucide-react'

type GranteeType = 'user' | 'role' | 'department' | 'cost_center' | 'division' | 'org_group'
type Permission = 'view' | 'develop'

interface AccessEntry {
  id: number
  course_id: number
  grantee_type: string
  grantee_id: string
  grantee_name?: string
  permission: string
  granted_by: number
  granted_at: string
}

interface GranteeOption { id: string; name: string; sub?: string }

const GRANTEE_KEYS: GranteeType[] = ['user', 'role', 'department', 'cost_center', 'division', 'org_group']

export default function CourseShareTab({ courseId }: { courseId: number }) {
  const { t } = useTranslation()
  const granteeLabel = (type: string) => t(`training.grantee.${type}`) || type
  const [entries, setEntries] = useState<AccessEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [granteeType, setGranteeType] = useState<GranteeType>('user')
  const [permission, setPermission] = useState<Permission>('view')
  const [search, setSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [options, setOptions] = useState<GranteeOption[]>([])
  const [selected, setSelected] = useState<GranteeOption | null>(null)
  const [userPickerDisplay, setUserPickerDisplay] = useState('')
  const [orgs, setOrgs] = useState<any>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Cache for name resolution
  const cacheRef = useRef<{ users: any[]; roles: any[]; orgsData: any }>({ users: [], roles: [], orgsData: null })

  useEffect(() => {
    init()
  }, [])

  const init = async () => {
    // Load orgs first (needed for both dropdown and name resolution)
    try {
      const orgRes = await api.get('/dashboard/orgs')
      setOrgs(orgRes.data)
      cacheRef.current.orgsData = orgRes.data
    } catch {}
    // Then load access entries (orgs is now available via cacheRef)
    await loadAccess()
  }

  // Outside click to close dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const loadAccess = async () => {
    setLoading(true)
    try {
      const res = await api.get(`/training/courses/${courseId}/access`)
      const resolved = await resolveEntryNames(res.data)
      setEntries(resolved)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  // Resolve grantee_id → display name (fetches users/roles/orgs as needed)
  const resolveEntryNames = async (data: AccessEntry[]): Promise<AccessEntry[]> => {
    if (data.length === 0) return data

    const hasUser = data.some(e => e.grantee_type === 'user')
    const hasRole = data.some(e => e.grantee_type === 'role')

    if (hasUser && cacheRef.current.users.length === 0) {
      try { cacheRef.current.users = (await api.get('/users')).data || [] } catch {}
    }
    if (hasRole && cacheRef.current.roles.length === 0) {
      try { cacheRef.current.roles = (await api.get('/roles')).data || [] } catch {}
    }

    const { users, roles, orgsData } = cacheRef.current

    return data.map(entry => {
      let name = entry.grantee_id
      if (entry.grantee_type === 'user') {
        const u = users.find((u: any) => String(u.id) === entry.grantee_id)
        if (u) name = `${u.name} (${u.username})`
      } else if (entry.grantee_type === 'role') {
        const r = roles.find((r: any) => String(r.id) === entry.grantee_id)
        if (r) name = r.name
      } else if (entry.grantee_type === 'department' || entry.grantee_type === 'dept') {
        const d = orgsData?.depts?.find((d: any) => d.code === entry.grantee_id)
        if (d) name = `${d.name} (${d.code})`
      } else if (entry.grantee_type === 'cost_center') {
        const d = orgsData?.profit_centers?.find((d: any) => d.code === entry.grantee_id)
        if (d) name = `${d.name} (${d.code})`
      } else if (entry.grantee_type === 'division') {
        const d = orgsData?.org_sections?.find((d: any) => d.code === entry.grantee_id)
        if (d) name = `${d.name} (${d.code})`
      }
      return { ...entry, grantee_name: name }
    })
  }

  // Build options based on type + search
  const buildOptions = (searchVal: string) => {
    if (granteeType === 'user') return
    const s = searchVal.toLowerCase()
    if (granteeType === 'role') {
      api.get('/roles').then(r => {
        const filtered = (r.data || []).filter((rl: any) =>
          !searchVal || rl.name.toLowerCase().includes(s))
        setOptions(filtered.map((rl: any) => ({ id: String(rl.id), name: rl.name })))
      }).catch(() => {})
    } else if (granteeType === 'department') {
      setOptions((orgs?.depts || []).filter((d: any) =>
        !searchVal || d.code.toLowerCase().includes(s) || (d.name || '').toLowerCase().includes(s))
        .map((d: any) => ({ id: d.code, name: `${d.name || d.code}`, sub: d.code })))
    } else if (granteeType === 'cost_center') {
      setOptions((orgs?.profit_centers || []).filter((d: any) =>
        !searchVal || d.code.toLowerCase().includes(s) || (d.name || '').toLowerCase().includes(s))
        .map((d: any) => ({ id: d.code, name: `${d.name || d.code}`, sub: d.code })))
    } else if (granteeType === 'division') {
      setOptions((orgs?.org_sections || []).filter((d: any) =>
        !searchVal || d.code.toLowerCase().includes(s) || (d.name || '').toLowerCase().includes(s))
        .map((d: any) => ({ id: d.code, name: `${d.name || d.code}`, sub: d.code })))
    } else if (granteeType === 'org_group') {
      setOptions((orgs?.org_groups || []).filter((d: any) =>
        !searchVal || d.name.toLowerCase().includes(s))
        .map((d: any) => ({ id: d.name, name: d.name })))
    }
  }

  // When type changes, reset and build options
  useEffect(() => {
    if (granteeType !== 'user') {
      buildOptions('')
    }
  }, [granteeType, orgs])

  const handleSearchChange = (val: string) => {
    setSearch(val)
    setSelected(null)
    setShowDropdown(true)
    buildOptions(val)
  }

  const handleSelect = (opt: GranteeOption) => {
    setSelected(opt)
    setSearch(opt.sub ? `${opt.name} (${opt.sub})` : opt.name)
    setShowDropdown(false)
  }

  const handleAdd = async () => {
    if (!selected) return
    try {
      await api.post(`/training/courses/${courseId}/access`, {
        grantee_type: granteeType,
        grantee_id: selected.id,
        permission,
      })
      setSelected(null)
      setSearch('')
      setShowDropdown(false)
      setUserPickerDisplay('')
      loadAccess()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    }
  }

  const handleUpdate = async (entryId: number, newPerm: Permission) => {
    try {
      await api.put(`/training/courses/${courseId}/access/${entryId}`, { permission: newPerm })
      loadAccess()
    } catch (e) { console.error(e) }
  }

  const handleRemove = async (entryId: number) => {
    try {
      await api.delete(`/training/courses/${courseId}/access/${entryId}`)
      setEntries(prev => prev.filter(e => e.id !== entryId))
    } catch (e) { console.error(e) }
  }

  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
      <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--t-text)' }}>{t('training.share.title')}</h3>
      <p className="text-[10px] mb-4" style={{ color: 'var(--t-text-dim)' }}>{t('training.share.description')}</p>

      {/* Add new share */}
      <div className="flex gap-2 mb-4">
        <select value={granteeType}
          onChange={e => { setGranteeType(e.target.value as GranteeType); setSearch(''); setSelected(null); setUserPickerDisplay(''); setShowDropdown(false) }}
          className="border rounded-lg px-2 py-1.5 text-xs"
          style={{ borderColor: 'var(--t-border)', backgroundColor: 'var(--t-bg-input)', color: 'var(--t-text)' }}>
          {GRANTEE_KEYS.map(k => (
            <option key={k} value={k}>{granteeLabel(k)}</option>
          ))}
        </select>

        {granteeType === 'user' ? (
          <div className="flex-1">
            <UserPicker
              value={selected?.id || ''}
              display={userPickerDisplay}
              onChange={(id: string, disp: string) => {
                setSelected(id ? { id, name: disp } : null)
                setUserPickerDisplay(disp)
              }}
              placeholder={t('training.share.searchUser')}
              apiUrl="/training/users-list"
            />
          </div>
        ) : (
          <div className="flex-1 relative" ref={dropdownRef}>
            <input value={search}
              onChange={e => handleSearchChange(e.target.value)}
              onFocus={() => { if (!selected) setShowDropdown(true) }}
              placeholder={t('training.share.searchTarget')}
              className="w-full border rounded-lg px-3 py-1.5 text-xs focus:outline-none"
              style={{ borderColor: 'var(--t-border)', backgroundColor: 'var(--t-bg-input)', color: 'var(--t-text)' }} />
            {showDropdown && !selected && options.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto z-10">
                {options.map(opt => (
                  <button key={opt.id} onClick={() => handleSelect(opt)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex gap-2">
                    <span className="font-medium">{opt.name}</span>
                    {opt.sub && <span className="text-slate-400">{opt.sub}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <select value={permission} onChange={e => setPermission(e.target.value as Permission)}
          className="border rounded-lg px-2 py-1.5 text-xs"
          style={{ borderColor: 'var(--t-border)', backgroundColor: 'var(--t-bg-input)', color: 'var(--t-text)' }}>
          <option value="view">{t('training.share.permView')}</option>
          <option value="develop">{t('training.share.permDevelop')}</option>
        </select>

        <button onClick={handleAdd} disabled={!selected}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-40"
          style={{ backgroundColor: 'var(--t-accent-bg)', color: 'white' }}>
          <Plus size={13} /> {t('training.share.add')}
        </button>
      </div>

      {/* Existing shares */}
      {loading ? (
        <div className="text-center py-4 text-xs" style={{ color: 'var(--t-text-dim)' }}>{t('training.loading')}</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-6 text-xs" style={{ color: 'var(--t-text-dim)' }}>{t('training.share.empty')}</div>
      ) : (
        <div className="space-y-1.5">
          {entries.map(entry => (
            <div key={entry.id}
              className="flex items-center gap-2 rounded-lg px-3 py-2"
              style={{ backgroundColor: 'var(--t-bg)', border: '1px solid var(--t-border-subtle)' }}>
              <Users size={14} style={{ color: 'var(--t-accent)' }} />
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}>
                {granteeLabel(entry.grantee_type)}
              </span>
              <span className="text-xs flex-1" style={{ color: 'var(--t-text)' }}>
                {entry.grantee_name || entry.grantee_id}
              </span>
              <select value={entry.permission}
                onChange={e => handleUpdate(entry.id, e.target.value as Permission)}
                className="border rounded px-1.5 py-0.5 text-[11px]"
                style={{ borderColor: 'var(--t-border)', backgroundColor: 'var(--t-bg-input)', color: 'var(--t-text)' }}>
                <option value="view">{t('training.share.permView')}</option>
                <option value="develop">{t('training.share.permDevelop')}</option>
              </select>
              <button onClick={() => handleRemove(entry.id)}
                className="text-red-400 hover:text-red-600 p-1 transition">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
