/**
 * HelpBookShareModal — 特殊說明書(help_books, is_special=1)分享設定
 *
 * 復用 common/ShareGranteePicker。Q2 拍板「只 view 一種權限」,所以 shareTypeOptions 只給一個。
 * 路徑:/api/help/admin/books/:id/shares
 */
import { useState, useEffect } from 'react'
import { X, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import ShareGranteePicker from '../common/ShareGranteePicker'
import type { GranteeSelection } from '../../types'

interface BookShare {
  id: number
  book_id: number
  grantee_type: string
  grantee_id: string
  granted_by: number | null
  granted_at: string
  granted_by_name?: string | null
  grantee_name?: string | null
}

interface HelpBookLite {
  id: number
  code: string
  name: string
}

interface Props {
  book: HelpBookLite
  onClose: () => void
}

export default function HelpBookShareModal({ book, onClose }: Props) {
  const { t } = useTranslation()
  const [shares, setShares] = useState<BookShare[]>([])
  const [selected, setSelected] = useState<GranteeSelection | null>(null)
  const [shareType, setShareType] = useState<'view'>('view')
  const [adding, setAdding] = useState(false)

  useEffect(() => { fetchShares() }, [])

  const fetchShares = async () => {
    try {
      const { data } = await api.get(`/help/admin/books/${book.id}/shares`)
      setShares(Array.isArray(data) ? data : [])
    } catch { /* ignore */ }
  }

  const addShare = async () => {
    if (!selected) return
    setAdding(true)
    try {
      await api.post(`/help/admin/books/${book.id}/shares`, {
        grantee_type: selected.type,
        grantee_id: selected.id,
      })
      setSelected(null)
      await fetchShares()
    } catch (e: any) {
      alert(e?.response?.data?.error || String(e))
    } finally { setAdding(false) }
  }

  const removeShare = async (shareId: number) => {
    if (!window.confirm(t('help.share.removeConfirm', '移除此分享?'))) return
    await api.delete(`/help/admin/books/${book.id}/shares/${shareId}`)
    setShares(shares.filter(s => s.id !== shareId))
  }

  const iconFor = (type: string) => {
    const map: Record<string, string> = {
      user: '👤', role: '👥', factory: '🏭',
      department: '🏢', cost_center: '💰', division: '🏭', org_group: '🌐',
    }
    return map[type] || '👥'
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[560px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-medium text-sm">
            {t('help.share.title', '分享設定')} — {book.name}
          </span>
          <button onClick={onClose}><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          <div>
            <div className="text-xs font-medium text-slate-700 mb-2">
              {t('help.share.addTarget', '新增分享對象')}
            </div>
            <ShareGranteePicker
              value={selected}
              onChange={setSelected}
              shareType={shareType}
              onShareTypeChange={(v) => setShareType(v as 'view')}
              shareTypeOptions={[
                { value: 'view', label: t('help.share.permView', '可閱讀') },
              ]}
              onAdd={addShare}
              adding={adding}
              orgsUrl="/kb/orgs"
            />
            <p className="text-xs text-slate-400 mt-2">
              {t('help.share.viewOnlyHint', '此說明書目前只支援「閱讀」權限。')}
            </p>
          </div>

          {shares.length > 0 ? (
            <div>
              <div className="text-xs font-medium text-slate-700 mb-2">
                {t('help.share.currentShares', '目前分享')}({shares.length})
              </div>
              <div className="space-y-1">
                {shares.map(s => (
                  <div key={s.id} className="flex items-center gap-2 text-xs bg-slate-50 border rounded px-3 py-1.5">
                    <span>{iconFor(s.grantee_type)}</span>
                    <span className="flex-1 truncate">
                      {s.grantee_name || s.grantee_id}
                    </span>
                    <span className="text-slate-400 text-[10px]">
                      {t(`grantee.type.${s.grantee_type}`)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                      {t('help.share.permView', '可閱讀')}
                    </span>
                    <button onClick={() => removeShare(s.id)} className="text-red-400 hover:text-red-600">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400 text-center py-4 border border-dashed rounded">
              {t('help.share.empty', '尚未設定任何分享 — 此說明書目前僅 admin 可閱讀')}
            </div>
          )}
        </div>

        <div className="flex justify-end px-5 py-3 border-t">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-600 hover:text-slate-800">
            {t('common.close', '關閉')}
          </button>
        </div>
      </div>
    </div>
  )
}
