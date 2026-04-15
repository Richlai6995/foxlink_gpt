/**
 * ShareModal — 通用分享設定 Modal
 * 支援：使用者 / 角色 / 廠區 / 部門 / 利潤中心 / 事業處 / 事業群
 * 使用共用元件 ShareGranteePicker (見 docs/factory-share-layer-plan.md §3.2)
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import ShareGranteePicker from '../common/ShareGranteePicker'
import type { AiSavedQueryShare, AiReportDashboardShare, GranteeSelection, GranteeType } from '../../types'

type Share = AiSavedQueryShare | AiReportDashboardShare
type ShareType = 'use' | 'manage'

interface Props {
  title: string
  sharesUrl: string
  onClose: () => void
}

export default function ShareModal({ title, sharesUrl, onClose }: Props) {
  const { t } = useTranslation()
  const [shares, setShares] = useState<Share[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<GranteeSelection | null>(null)
  const [shareType, setShareType] = useState<ShareType>('use')
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadShares() }, [])

  async function loadShares() {
    setLoading(true)
    try {
      const r = await api.get(sharesUrl)
      setShares(r.data)
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  async function handleAdd() {
    if (!selected) return
    setSaving(true)
    try {
      const updated = await api.post(sharesUrl, {
        grantee_type: selected.type,
        grantee_id: selected.id,
        share_type: shareType,
      })
      // 後端回傳更新後的完整列表
      if (Array.isArray(updated.data)) setShares(updated.data)
      else await loadShares()
      setSelected(null)
    } catch (e) { console.error(e) } finally { setSaving(false) }
  }

  async function handleChangeShareType(shareId: number, newType: ShareType) {
    try {
      const cur = shares.find(s => s.id === shareId) as Share | undefined
      if (!cur) return
      const updated = await api.post(sharesUrl, {
        grantee_type: cur.grantee_type,
        grantee_id: cur.grantee_id,
        share_type: newType,
      })
      if (Array.isArray(updated.data)) setShares(updated.data)
      else await loadShares()
    } catch (e) { console.error(e) }
  }

  async function handleRemove(shareId: number) {
    try {
      await api.delete(`${sharesUrl}/${shareId}`)
      setShares(prev => prev.filter(s => s.id !== shareId))
    } catch (e) { console.error(e) }
  }

  const iconFor = (type: string) => {
    if (type === 'user') return '👤'
    if (type === 'role') return '🔑'
    if (type === 'factory') return '🏭'
    return '👥'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-800">{t('common.share', '分享設定')}</h3>
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
          <ShareGranteePicker
            value={selected}
            onChange={setSelected}
            shareType={shareType}
            onShareTypeChange={v => setShareType(v as ShareType)}
            shareTypeOptions={[
              { value: 'use',    label: '使用權限' },
              { value: 'manage', label: '管理權限' },
            ]}
            onAdd={handleAdd}
            adding={saving}
          />
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
                    {iconFor(share.grantee_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-800 truncate">
                      {share.grantee_name || share.grantee_id}
                    </div>
                    <div className="text-xs text-gray-400">
                      {t(`grantee.type.${share.grantee_type}`)} · {share.grantee_id}
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

// re-exports for backward compat (if any caller imports types)
export type { GranteeType }
