/**
 * MetalsShareInline — 採購端管理「金屬情報精簡版(metals-public)」閱讀權限
 *
 * 跟 HelpBookShareInline 同 UI / data model,差別:
 *   - 呼叫 /pm/briefing/metals-share/* (採購可寫,verifyPmUser middleware)
 *   - 而非 /help/admin/books/:id/shares (admin only)
 *
 * admin 在「特殊說明書管理」改的是同一張表(help_book_shares with book='metals-public'),
 * 兩邊改即時同步。
 */
import { useEffect, useState } from 'react'
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

export default function MetalsShareInline() {
  const { t } = useTranslation()
  const [shares, setShares] = useState<BookShare[]>([])
  const [selected, setSelected] = useState<GranteeSelection | null>(null)
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(false)

  const fetchShares = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/pm/briefing/metals-share')
      setShares(Array.isArray(data) ? data : [])
    } finally { setLoading(false) }
  }
  useEffect(() => { fetchShares() }, [])

  const addShare = async () => {
    if (!selected) return
    setAdding(true)
    try {
      await api.post('/pm/briefing/metals-share', {
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
    await api.delete(`/pm/briefing/metals-share/${shareId}`)
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
    <div className="space-y-4">
      <div className="text-xs text-slate-500 leading-relaxed bg-blue-50 border border-blue-200 rounded p-2">
        💡 這份分享名單管理「金屬情報精簡版 (/metals)」的閱讀權限 —
        被加入的對象在 sidebar 會看到「貴金屬情報」入口,點下進精簡版。
        admin 也可從「特殊說明書管理」改同一份名單。
      </div>

      <div>
        <div className="text-xs font-medium text-slate-700 mb-2">
          新增分享對象
        </div>
        <ShareGranteePicker
          value={selected}
          onChange={setSelected}
          shareType="view"
          onShareTypeChange={() => {}}
          shareTypeOptions={[{ value: 'view', label: '可閱讀' }]}
          onAdd={addShare}
          adding={adding}
          orgsUrl="/kb/orgs"
        />
        <p className="text-xs text-slate-400 mt-2">
          💡 建議用 <strong>department</strong>(部門)或 <strong>role</strong>(角色)整批授權,
          人事異動會自動跟,不用採購手動改 user 清單。
        </p>
      </div>

      {loading ? (
        <div className="text-xs text-slate-400 text-center py-3">載入中…</div>
      ) : shares.length > 0 ? (
        <div>
          <div className="text-xs font-medium text-slate-700 mb-2">
            目前分享({shares.length})
          </div>
          <div className="space-y-1">
            {shares.map(s => (
              <div key={s.id} className="flex items-center gap-2 text-xs bg-slate-50 border rounded px-3 py-1.5">
                <span>{iconFor(s.grantee_type)}</span>
                <span className="flex-1 truncate">{s.grantee_name || s.grantee_id}</span>
                <span className="text-slate-400 text-[10px]">{t(`grantee.type.${s.grantee_type}`, s.grantee_type)}</span>
                <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                  可閱讀
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
          尚未設定任何分享 — 目前僅 admin 與你能看到精簡版
        </div>
      )}
    </div>
  )
}
