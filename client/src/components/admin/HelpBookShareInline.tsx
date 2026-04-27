/**
 * HelpBookShareInline — 特殊說明書分享授權設定(無 modal 殼,可內嵌)
 *
 * 抽自 HelpBookShareModal,給多入口共用:
 *   - 「特殊說明書管理」 → 包 modal 殼用
 *   - 「PM 平台設定」    → 直接內嵌,Hardcode 綁 'precious-metals' book
 *
 * 兩個入口管同一份資料(help_book_shares),改任一邊另一邊立即同步。
 *
 * Q2 拍板「只 view 一種權限」,所以 shareTypeOptions 只給一個。
 */
import { useState, useEffect } from 'react'
import { Trash2 } from 'lucide-react'
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

interface Props {
  /** book id;若給了直接用,否則用 bookCode 撈 */
  bookId?: number
  /** book code(例 'precious-metals')— 若 bookId 沒給,用 code 撈 book.id */
  bookCode?: string
}

export default function HelpBookShareInline({ bookId: propBookId, bookCode }: Props) {
  const { t } = useTranslation()
  const [bookId, setBookId] = useState<number | null>(propBookId || null)
  const [shares, setShares] = useState<BookShare[]>([])
  const [selected, setSelected] = useState<GranteeSelection | null>(null)
  const [shareType, setShareType] = useState<'view'>('view')
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(false)

  // 若沒給 bookId,用 bookCode 撈
  useEffect(() => {
    if (propBookId) { setBookId(propBookId); return }
    if (!bookCode) return
    api.get('/help/admin/books').then(r => {
      const b = (r.data || []).find((x: any) => x.code === bookCode)
      if (b) setBookId(b.id)
    }).catch(() => {})
  }, [propBookId, bookCode])

  useEffect(() => {
    if (bookId) fetchShares()
  }, [bookId])

  const fetchShares = async () => {
    if (!bookId) return
    setLoading(true)
    try {
      const { data } = await api.get(`/help/admin/books/${bookId}/shares`)
      setShares(Array.isArray(data) ? data : [])
    } finally { setLoading(false) }
  }

  const addShare = async () => {
    if (!selected || !bookId) return
    setAdding(true)
    try {
      await api.post(`/help/admin/books/${bookId}/shares`, {
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
    if (!bookId) return
    if (!window.confirm(t('help.share.removeConfirm', '移除此分享?'))) return
    await api.delete(`/help/admin/books/${bookId}/shares/${shareId}`)
    setShares(shares.filter(s => s.id !== shareId))
  }

  const iconFor = (type: string) => {
    const map: Record<string, string> = {
      user: '👤', role: '👥', factory: '🏭',
      department: '🏢', cost_center: '💰', division: '🏭', org_group: '🌐',
    }
    return map[type] || '👥'
  }

  if (!bookId) {
    return <div className="text-xs text-slate-400 py-3">載入分享設定…</div>
  }

  return (
    <div className="space-y-4">
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
          💡 建議用 <strong>department</strong>(部門)或 <strong>role</strong>(角色)整批授權,
          人事異動會自動跟,不用 admin 手動改 user 清單。
        </p>
      </div>

      {loading ? (
        <div className="text-xs text-slate-400 text-center py-3">載入中…</div>
      ) : shares.length > 0 ? (
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
  )
}
