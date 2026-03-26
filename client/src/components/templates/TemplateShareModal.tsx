import { useState, useEffect } from 'react'
import { X, Trash2, Search } from 'lucide-react'
import api from '../../lib/api'
import { DocTemplate, DocTemplateShare } from '../../types'

interface Props {
  template: DocTemplate
  onClose: () => void
  onPublicChange: (isPublic: boolean) => void
}

const GRANTEE_TYPES = [
  { value: 'user', label: '使用者', icon: '👤' },
  { value: 'role', label: '角色', icon: '👥' },
  { value: 'department', label: '部門', icon: '🏢' },
  { value: 'cost_center', label: '利潤中心', icon: '💰' },
  { value: 'division', label: '事業處', icon: '🏭' },
  { value: 'org_group', label: '事業群', icon: '🌐' },
]

export default function TemplateShareModal({ template, onClose, onPublicChange }: Props) {
  const [shares, setShares] = useState<DocTemplateShare[]>([])
  const [granteeType, setGranteeType] = useState<string>('user')
  const [granteeId, setGranteeId] = useState('')
  const [shareType, setShareType] = useState<'use' | 'edit'>('use')
  const [userSearch, setUserSearch] = useState('')
  const [userResults, setUserResults] = useState<{ id: number; name: string; username: string }[]>([])
  const [adding, setAdding] = useState(false)
  const [isPublic, setIsPublic] = useState(template.is_public === 1)

  useEffect(() => {
    fetchShares()
  }, [])

  useEffect(() => {
    if (granteeType !== 'user') { setUserSearch(''); setUserResults([]); setGranteeId('') }
  }, [granteeType])

  const fetchShares = async () => {
    try {
      const { data } = await api.get(`/doc-templates/${template.id}/shares`)
      setShares(data)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (granteeType !== 'user' || userSearch.length < 2) { setUserResults([]); return }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/users?search=${encodeURIComponent(userSearch)}&limit=10`)
        setUserResults(data.users || data || [])
      } catch { /* ignore */ }
    }, 300)
    return () => clearTimeout(t)
  }, [userSearch, granteeType])

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
      if (!window.confirm('確定要公開此範本嗎？\n\n公開後，所有使用者都可以：\n• 瀏覽此範本的內容與變數設定\n• 使用此範本生成文件\n• 複製此範本為自己的副本')) return
    } else {
      if (!window.confirm('確定要取消公開此範本嗎？\n\n取消後，僅有被分享的使用者可以繼續使用。\n已複製的副本不受影響。')) return
    }
    try {
      await api.put(`/doc-templates/${template.id}`, { is_public: next ? 1 : 0 })
      setIsPublic(next)
      onPublicChange(next)
    } catch { /* ignore */ }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[540px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-medium text-sm">分享設定：{template.name}</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          {/* Add share */}
          <div>
            <div className="text-xs font-medium text-slate-700 mb-2">新增分享對象</div>
            <div className="flex gap-2 flex-wrap">
              <select
                className="text-xs border rounded px-2 py-1.5"
                value={granteeType}
                onChange={e => setGranteeType(e.target.value)}
              >
                {GRANTEE_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                ))}
              </select>
              <select
                className="text-xs border rounded px-2 py-1.5"
                value={shareType}
                onChange={e => setShareType(e.target.value as 'use' | 'edit')}
              >
                <option value="use">使用</option>
                <option value="edit">編輯</option>
              </select>
            </div>
            <div className="mt-2 relative">
              {granteeType === 'user' ? (
                <>
                  <div className="relative">
                    <Search size={13} className="absolute left-2 top-2 text-slate-400" />
                    <input
                      className="w-full border rounded pl-7 pr-3 py-1.5 text-xs"
                      placeholder="搜尋使用者名稱或工號"
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
                <input
                  className="w-full border rounded px-3 py-1.5 text-xs"
                  placeholder={`輸入${GRANTEE_TYPES.find(t => t.value === granteeType)?.label} ID`}
                  value={granteeId}
                  onChange={e => setGranteeId(e.target.value)}
                />
              )}
            </div>
            <button
              onClick={addShare}
              disabled={adding || !granteeId}
              className="mt-2 px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {adding ? '新增中...' : '+ 新增分享'}
            </button>
          </div>

          {/* Current shares */}
          {shares.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-700 mb-2">目前分享</div>
              <div className="space-y-1">
                {shares.map(s => {
                  const gt = GRANTEE_TYPES.find(t => t.value === s.grantee_type)
                  return (
                    <div key={s.id} className="flex items-center gap-2 text-xs bg-slate-50 border rounded px-3 py-1.5">
                      <span>{gt?.icon}</span>
                      <span className="flex-1">{s.grantee_name || s.grantee_id}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${s.share_type === 'edit' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                        {s.share_type === 'edit' ? '編輯' : '使用'}
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
                <div className="text-xs font-medium text-slate-700">公開範本</div>
                <div className="text-xs text-slate-400">所有使用者可瀏覽、使用、複製此範本</div>
              </div>
              <button
                onClick={togglePublic}
                className={`w-10 h-5 rounded-full transition relative ${isPublic ? 'bg-blue-600' : 'bg-slate-300'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition ${isPublic ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
            {isPublic && <div className="text-xs text-blue-600 mt-1">✓ 目前為公開狀態</div>}
          </div>
        </div>

        <div className="flex justify-end px-5 py-3 border-t">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-600 hover:text-slate-800">關閉</button>
        </div>
      </div>
    </div>
  )
}
