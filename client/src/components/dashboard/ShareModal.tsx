/**
 * ShareModal — 通用分享設定 Modal
 * 支援：使用者 / 角色 / 部門 / 利潤中心 / 事業處 / 事業群
 */
import { useState, useEffect } from 'react'
import api from '../../lib/api'
import type { AiSavedQueryShare, AiReportDashboardShare } from '../../types'
import UserPicker from '../common/UserPicker'

type Share = AiSavedQueryShare | AiReportDashboardShare

type GranteeType = 'user' | 'role' | 'department' | 'cost_center' | 'division' | 'org_group'
type ShareType = 'use' | 'manage'

interface GranteeOption { id: string; name: string; sub?: string }

interface Props {
  title: string
  sharesUrl: string           // e.g. /dashboard/saved-queries/5/shares
  onClose: () => void
}

const GRANTEE_TYPE_LABELS: Record<GranteeType, string> = {
  user:         '使用者',
  role:         '角色',
  department:   '部門',
  cost_center:  '利潤中心',
  division:     '事業處',
  org_group:    '事業群',
}

export default function ShareModal({ title, sharesUrl, onClose }: Props) {
  const [shares, setShares] = useState<Share[]>([])
  const [loading, setLoading] = useState(true)
  const [granteeType, setGranteeType] = useState<GranteeType>('user')
  const [shareType, setShareType] = useState<ShareType>('use')
  const [userPickerDisplay, setUserPickerDisplay] = useState('')
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<GranteeOption[]>([])
  const [optLoading, setOptLoading] = useState(false)
  const [selected, setSelected] = useState<GranteeOption | null>(null)
  const [saving, setSaving] = useState(false)
  const [orgs, setOrgs] = useState<{
    depts: { code: string; name: string }[]
    profit_centers: { code: string; name: string }[]
    org_sections: { code: string; name: string }[]
    org_groups: { name: string }[]
  } | null>(null)

  useEffect(() => {
    loadShares()
    api.get('/dashboard/orgs').then(r => setOrgs(r.data)).catch(console.error)
  }, [])

  async function loadShares() {
    setLoading(true)
    try {
      const r = await api.get(sharesUrl)
      setShares(r.data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // 根據 granteeType + search 拉候選清單 (user 改用 UserPicker，其他類型仍走這裡)
  useEffect(() => {
    if (granteeType === 'user') { setOptions([]); return }
    const isOrgType = ['department','cost_center','division','org_group'].includes(granteeType)
    if (!search.trim() && !isOrgType && granteeType !== 'role') {
      setOptions([])
      return
    }
    // org 類型用 free-text：selected 由 onChange 管理，不在 effect 裡清掉
    if (!isOrgType) setSelected(null)

    if (granteeType === 'role') {
      setOptLoading(true)
      api.get('/roles').then((r: { data: { id: number; name: string }[] }) => {
        const filtered = (r.data || []).filter(rl =>
          !search || rl.name.toLowerCase().includes(search.toLowerCase()))
        setOptions(filtered.map(rl => ({ id: String(rl.id), name: rl.name })))
      }).catch(console.error).finally(() => setOptLoading(false))
    } else if (granteeType === 'department') {
      const all = (orgs?.depts || []).filter(d =>
        !search || d.code.toLowerCase().includes(search.toLowerCase()) || (d.name || '').toLowerCase().includes(search.toLowerCase()))
      setOptions(all.map(d => ({ id: d.code, name: d.name || d.code, sub: d.code })))
    } else if (granteeType === 'cost_center') {
      const all = (orgs?.profit_centers || []).filter(d =>
        !search || d.code.toLowerCase().includes(search.toLowerCase()) || (d.name || '').toLowerCase().includes(search.toLowerCase()))
      setOptions(all.map(d => ({ id: d.code, name: d.name || d.code, sub: d.code })))
    } else if (granteeType === 'division') {
      const all = (orgs?.org_sections || []).filter(d =>
        !search || d.code.toLowerCase().includes(search.toLowerCase()) || (d.name || '').toLowerCase().includes(search.toLowerCase()))
      setOptions(all.map(d => ({ id: d.code, name: d.name || d.code, sub: d.code })))
    } else if (granteeType === 'org_group') {
      const all = (orgs?.org_groups || []).filter(d =>
        !search || d.name.toLowerCase().includes(search.toLowerCase()))
      setOptions(all.map(d => ({ id: d.name, name: d.name })))
    }
  }, [granteeType, search, orgs])

  async function handleAdd() {
    const granteeId = granteeType === 'user'
      ? (selected?.id || '')
      : (selected?.id || '')
    if (!granteeId) return
    setSaving(true)
    try {
      const updated = await api.post(sharesUrl, {
        grantee_type: granteeType,
        grantee_id: granteeId,
        share_type: shareType,
      })
      setShares(updated.data)
      setSelected(null)
      setUserPickerDisplay('')
      setSearch('')
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  async function handleChangeShareType(shareId: number, newType: ShareType) {
    try {
      const updated = await api.post(sharesUrl, {
        grantee_type: (shares.find(s => s.id === shareId) as Share)?.grantee_type,
        grantee_id: (shares.find(s => s.id === shareId) as Share)?.grantee_id,
        share_type: newType,
      })
      setShares(updated.data)
    } catch (e) {
      console.error(e)
    }
  }

  async function handleRemove(shareId: number) {
    try {
      await api.delete(`${sharesUrl}/${shareId}`)
      setShares(prev => prev.filter(s => s.id !== shareId))
    } catch (e) {
      console.error(e)
    }
  }


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-800">分享設定</h3>
            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-sm">{title}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Add new share */}
        <div className="px-5 py-4 border-b border-gray-100 space-y-3">
          <p className="text-sm font-medium text-gray-700">新增共享對象</p>
          <div className="flex gap-2">
            {/* Type selector */}
            <select
              value={granteeType}
              onChange={e => { setGranteeType(e.target.value as GranteeType); setSearch(''); setSelected(null); setUserPickerDisplay('') }}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white"
            >
              {Object.entries(GRANTEE_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>

            {/* Search or select */}
            {granteeType === 'user' ? (
              <UserPicker
                value={selected?.id || ''}
                display={userPickerDisplay}
                onChange={(id, disp) => {
                  setSelected(id ? { id, name: disp, sub: '' } : null)
                  setUserPickerDisplay(disp)
                }}
                className="flex-1"
              />
            ) : (
              <div className="flex-1 relative">
                <input
                  type="text"
                  placeholder={options.length > 0 ? `篩選${GRANTEE_TYPE_LABELS[granteeType]}...` : `輸入${GRANTEE_TYPE_LABELS[granteeType]}代碼或名稱`}
                  value={search}
                  onChange={e => {
                    const v = e.target.value
                    setSearch(v)
                    // 對 org 類型允許直接手打：有值就暫存為 selected，讓「新增」可以按
                    const isOrgType = ['department','cost_center','division','org_group'].includes(granteeType)
                    if (isOrgType && v.trim()) setSelected({ id: v.trim(), name: v.trim() })
                    else if (isOrgType) setSelected(null)
                  }}
                  className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                />
                {/* Dropdown */}
                {options.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg z-10 max-h-40 overflow-y-auto">
                    {optLoading && <div className="px-3 py-2 text-xs text-gray-400">搜尋中...</div>}
                    {options.map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => { setSelected(opt); setSearch(opt.name) }}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center justify-between
                          ${selected?.id === opt.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                      >
                        <span>{opt.name}</span>
                        {opt.sub && <span className="text-xs text-gray-400">{opt.sub}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Share type */}
            <select
              value={shareType}
              onChange={e => setShareType(e.target.value as ShareType)}
              className="border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white"
            >
              <option value="use">使用權限</option>
              <option value="manage">管理權限</option>
            </select>

            <button
              onClick={handleAdd}
              disabled={!selected || saving}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap"
            >
              + 新增
            </button>
          </div>
          <p className="text-xs text-gray-400">
            使用權限：可查詢執行、另存為自己的版本｜管理權限：可修改設定、管理分享
          </p>
        </div>

        {/* Current shares */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="text-sm text-gray-400 text-center py-4">載入中...</div>
          ) : shares.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-4">尚無共享設定</div>
          ) : (
            <div className="space-y-2">
              {shares.map(share => (
                <div key={share.id} className="flex items-center gap-3 py-2 border-b border-gray-50">
                  <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xs flex-shrink-0">
                    {share.grantee_type === 'user' ? '👤' :
                     share.grantee_type === 'role' ? '🔑' : '👥'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-800 truncate">
                      {share.grantee_name || share.grantee_id}
                    </div>
                    <div className="text-xs text-gray-400">
                      {GRANTEE_TYPE_LABELS[share.grantee_type as GranteeType]} · {share.grantee_id}
                    </div>
                  </div>
                  <select
                    value={share.share_type}
                    onChange={e => handleChangeShareType(share.id, e.target.value as ShareType)}
                    className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400 bg-white"
                  >
                    <option value="use">使用權限</option>
                    <option value="manage">管理權限</option>
                  </select>
                  <button
                    onClick={() => handleRemove(share.id)}
                    className="text-gray-400 hover:text-red-500 flex-shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
