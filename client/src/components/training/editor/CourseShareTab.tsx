/**
 * CourseShareTab — 課程分享設定（嵌入 CourseEditor tab）
 * 使用共用元件 ShareGranteePicker (見 docs/factory-share-layer-plan.md §3.2)
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../../lib/api'
import ShareGranteePicker from '../../common/ShareGranteePicker'
import { X, Users } from 'lucide-react'
import type { GranteeSelection } from '../../../types'

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

export default function CourseShareTab({ courseId }: { courseId: number }) {
  const { t } = useTranslation()
  const granteeLabel = (type: string) => t(`grantee.type.${type}`, { defaultValue: type })

  const [entries, setEntries] = useState<AccessEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<GranteeSelection | null>(null)
  const [permission, setPermission] = useState<Permission>('view')
  const [adding, setAdding] = useState(false)

  useEffect(() => { loadAccess() }, [])

  const loadAccess = async () => {
    setLoading(true)
    try {
      const res = await api.get(`/training/courses/${courseId}/access`)
      setEntries(res.data || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const handleAdd = async () => {
    if (!selected) return
    setAdding(true)
    try {
      await api.post(`/training/courses/${courseId}/access`, {
        grantee_type: selected.type,
        grantee_id: selected.id,
        permission,
      })
      setSelected(null)
      loadAccess()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Error')
    } finally {
      setAdding(false)
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

      <div className="mb-4">
        <ShareGranteePicker
          value={selected}
          onChange={setSelected}
          shareType={permission}
          onShareTypeChange={v => setPermission(v as Permission)}
          shareTypeOptions={[
            { value: 'view',    label: t('training.share.permView') },
            { value: 'develop', label: t('training.share.permDevelop') },
          ]}
          onAdd={handleAdd}
          adding={adding}
        />
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
