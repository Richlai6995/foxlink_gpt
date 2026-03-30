import { useState, useEffect } from 'react'
import { X, Trash2, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { DocTemplate, DocTemplateShare } from '../../types'

interface Props {
  template: DocTemplate
  onClose: () => void
  onPublicChange: (isPublic: boolean) => void
}

interface OrgOption { code?: string; name: string }
interface OrgData {
  depts: OrgOption[]
  profit_centers: OrgOption[]
  org_sections: OrgOption[]
  org_groups: OrgOption[]
}

export default function TemplateShareModal({ template, onClose, onPublicChange }: Props) {
  const { t } = useTranslation()

  const GRANTEE_TYPES = [
    { value: 'user',       label: t('tpl.share.granteeUser'),       icon: '👤' },
    { value: 'role',       label: t('tpl.share.granteeRole'),       icon: '👥' },
    { value: 'department', label: t('tpl.share.granteeDepartment'), icon: '🏢' },
    { value: 'cost_center',label: t('tpl.share.granteeCostCenter'), icon: '💰' },
    { value: 'division',   label: t('tpl.share.granteeDivision'),   icon: '🏭' },
    { value: 'org_group',  label: t('tpl.share.granteeOrgGroup'),   icon: '🌐' },
  ]

  const [shares, setShares]           = useState<DocTemplateShare[]>([])
  const [orgs, setOrgs]               = useState<OrgData>({ depts: [], profit_centers: [], org_sections: [], org_groups: [] })
  const [roles, setRoles]             = useState<{ id: number; name: string }[]>([])
  const [granteeType, setGranteeType] = useState<string>('user')
  const [granteeId, setGranteeId]     = useState('')
  const [shareType, setShareType]     = useState<'use' | 'edit'>('use')
  const [userSearch, setUserSearch]   = useState('')
  const [userResults, setUserResults] = useState<{ id: number; name: string; username: string }[]>([])
  const [adding, setAdding]           = useState(false)
  const [isPublic, setIsPublic]       = useState(template.is_public === 1)

  useEffect(() => {
    fetchShares()
    api.get('/kb/orgs').then(r => setOrgs(r.data)).catch(() => {})
    api.get('/roles').then(r => setRoles(r.data || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (granteeType !== 'user') { setUserSearch(''); setUserResults([]); setGranteeId('') }
    else { setGranteeId('') }
  }, [granteeType])

  const fetchShares = async () => {
    try {
      const { data } = await api.get(`/doc-templates/${template.id}/shares`)
      setShares(data)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (granteeType !== 'user' || userSearch.length < 2) { setUserResults([]); return }
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get(`/users?search=${encodeURIComponent(userSearch)}&limit=10`)
        setUserResults(data.users || data || [])
      } catch { /* ignore */ }
    }, 300)
    return () => clearTimeout(timer)
  }, [userSearch, granteeType])

  const getLovOptions = (): { id: string; label: string }[] => {
    if (granteeType === 'role')        return roles.map(r => ({ id: String(r.id), label: r.name }))
    if (granteeType === 'department')  return orgs.depts.map(d => ({ id: d.code || '', label: `${d.code} ${d.name}` }))
    if (granteeType === 'cost_center') return orgs.profit_centers.map(d => ({ id: d.code || '', label: `${d.code} ${d.name}` }))
    if (granteeType === 'division')    return orgs.org_sections.map(d => ({ id: d.code || '', label: `${d.code} ${d.name}` }))
    if (granteeType === 'org_group')   return orgs.org_groups.map(d => ({ id: d.name || '', label: d.name }))
    return []
  }

  const addShare = async () => {
    if (!granteeId) return
    setAdding(true)
    try {
      await api.post(`/doc-templates/${template.id}/shares`, {
        share_type: shareType,
        grantee_type: granteeType,
        grantee_id: String(granteeId),
      })
      setGranteeId('')
      setUserSearch('')
      setUserResults([])
      await fetchShares()
    } catch { /* ignore */ } finally { setAdding(false) }
  }

  const removeShare = async (shareId: number) => {
    await api.delete(`/doc-templates/${template.id}/shares/${shareId}`)
    setShares(shares.filter(s => s.id !== shareId))
  }

  const togglePublic = async () => {
    const next = !isPublic
    if (next) {
      if (!window.confirm(t('tpl.share.publicConfirm'))) return
    } else {
      if (!window.confirm(t('tpl.share.unpublicConfirm'))) return
    }
    try {
      await api.put(`/doc-templates/${template.id}`, { is_public: next ? 1 : 0 })
      setIsPublic(next)
      onPublicChange(next)
    } catch { /* ignore */ }
  }

  const lovOptions = getLovOptions()

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[540px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-medium text-sm">{t('tpl.share.title', { name: template.name })}</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          {/* Add share */}
          <div>
            <div className="text-xs font-medium text-slate-700 mb-2">{t('tpl.share.addTarget')}</div>
            <div className="flex gap-2 flex-wrap">
              <select
                className="text-xs border rounded px-2 py-1.5"
                value={granteeType}
                onChange={e => setGranteeType(e.target.value)}
              >
                {GRANTEE_TYPES.map(gt => (
                  <option key={gt.value} value={gt.value}>{gt.icon} {gt.label}</option>
                ))}
              </select>
              <select
                className="text-xs border rounded px-2 py-1.5"
                value={shareType}
                onChange={e => setShareType(e.target.value as 'use' | 'edit')}
              >
                <option value="use">{t('tpl.share.permUse')}</option>
                <option value="edit">{t('tpl.share.permEdit')}</option>
              </select>
            </div>
            <div className="mt-2 relative">
              {granteeType === 'user' ? (
                <>
                  <div className="relative">
                    <Search size={13} className="absolute left-2 top-2 text-slate-400" />
                    <input
                      className="w-full border rounded pl-7 pr-3 py-1.5 text-xs"
                      placeholder={t('tpl.share.searchUser')}
                      value={userSearch}
                      onChange={e => { setUserSearch(e.target.value); setGranteeId('') }}
                    />
                  </div>
                  {userResults.length > 0 && (
                    <div className="absolute z-10 w-full bg-white border rounded shadow mt-0.5 max-h-40 overflow-auto">
                      {userResults.map(u => (
                        <button
                          key={u.id}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50"
                          onClick={() => { setGranteeId(String(u.id)); setUserSearch(`${u.name} (${u.username})`); setUserResults([]) }}
                        >
                          {u.name} <span className="text-slate-400">{u.username}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <select
                  className="w-full border rounded px-3 py-1.5 text-xs"
                  value={granteeId}
                  onChange={e => setGranteeId(e.target.value)}
                >
                  <option value="">-- {t('tpl.share.selectPlaceholder', { type: GRANTEE_TYPES.find(gt => gt.value === granteeType)?.label })} --</option>
                  {lovOptions.map(o => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              )}
            </div>
            <button
              onClick={addShare}
              disabled={adding || !granteeId}
              className="mt-2 px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {adding ? t('tpl.share.adding') : t('tpl.share.addShare')}
            </button>
          </div>

          {/* Current shares */}
          {shares.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-700 mb-2">{t('tpl.share.currentShares')}</div>
              <div className="space-y-1">
                {shares.map(s => {
                  const gt = GRANTEE_TYPES.find(g => g.value === s.grantee_type)
                  return (
                    <div key={s.id} className="flex items-center gap-2 text-xs bg-slate-50 border rounded px-3 py-1.5">
                      <span>{gt?.icon}</span>
                      <span className="flex-1">{s.grantee_name || s.grantee_id}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${s.share_type === 'edit' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                        {s.share_type === 'edit' ? t('tpl.share.permEdit') : t('tpl.share.permUse')}
                      </span>
                      <button onClick={() => removeShare(s.id)} className="text-red-400 hover:text-red-600">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Public toggle */}
          <div className="border-t pt-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="text-xs font-medium text-slate-700">{t('tpl.share.publicTemplate')}</div>
                <div className="text-xs text-slate-400">{t('tpl.share.publicDesc')}</div>
              </div>
              <button
                onClick={togglePublic}
                className={`w-10 h-5 rounded-full transition relative ${isPublic ? 'bg-blue-600' : 'bg-slate-300'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition ${isPublic ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
            {isPublic && <div className="text-xs text-blue-600 mt-1">{t('tpl.share.publicStatus')}</div>}
          </div>
        </div>

        <div className="flex justify-end px-5 py-3 border-t">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-600 hover:text-slate-800">{t('tpl.share.close')}</button>
        </div>
      </div>
    </div>
  )
}
