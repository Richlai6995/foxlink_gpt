/**
 * TemplateShareModal — 文件模板分享設定
 * 使用共用元件 ShareGranteePicker (見 docs/factory-share-layer-plan.md §3.2)
 */
import { useState, useEffect } from 'react'
import { X, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import ShareGranteePicker from '../common/ShareGranteePicker'
import { DocTemplate, DocTemplateShare } from '../../types'
import type { GranteeSelection } from '../../types'

interface Props {
  template: DocTemplate
  onClose: () => void
  onPublicChange: (isPublic: boolean) => void
}

export default function TemplateShareModal({ template, onClose, onPublicChange }: Props) {
  const { t } = useTranslation()

  const [shares, setShares] = useState<DocTemplateShare[]>([])
  const [selected, setSelected] = useState<GranteeSelection | null>(null)
  const [shareType, setShareType] = useState<'use' | 'edit'>('use')
  const [adding, setAdding] = useState(false)
  const [isPublic, setIsPublic] = useState(template.is_public === 1)

  useEffect(() => { fetchShares() }, [])

  const fetchShares = async () => {
    try {
      const { data } = await api.get(`/doc-templates/${template.id}/shares`)
      setShares(data)
    } catch { /* ignore */ }
  }

  const addShare = async () => {
    if (!selected) return
    setAdding(true)
    try {
      await api.post(`/doc-templates/${template.id}/shares`, {
        share_type: shareType,
        grantee_type: selected.type,
        grantee_id: selected.id,
      })
      setSelected(null)
      await fetchShares()
    } catch { /* ignore */ } finally { setAdding(false) }
  }

  const removeShare = async (shareId: number) => {
    await api.delete(`/doc-templates/${template.id}/shares/${shareId}`)
    setShares(shares.filter(s => s.id !== shareId))
  }

  const togglePublic = async () => {
    const next = !isPublic
    const msg = next ? t('tpl.share.publicConfirm') : t('tpl.share.unpublicConfirm')
    if (!window.confirm(msg)) return
    try {
      await api.put(`/doc-templates/${template.id}`, { is_public: next ? 1 : 0 })
      setIsPublic(next)
      onPublicChange(next)
    } catch { /* ignore */ }
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
      <div className="bg-white rounded-lg w-[540px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-medium text-sm">{t('tpl.share.title', { name: template.name })}</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          {/* Add share */}
          <div>
            <div className="text-xs font-medium text-slate-700 mb-2">{t('tpl.share.addTarget')}</div>
            <ShareGranteePicker
              value={selected}
              onChange={setSelected}
              shareType={shareType}
              onShareTypeChange={v => setShareType(v as 'use' | 'edit')}
              shareTypeOptions={[
                { value: 'use',  label: t('tpl.share.permUse') },
                { value: 'edit', label: t('tpl.share.permEdit') },
              ]}
              onAdd={addShare}
              adding={adding}
              orgsUrl="/kb/orgs"
            />
          </div>

          {/* Current shares */}
          {shares.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-700 mb-2">{t('tpl.share.currentShares')}</div>
              <div className="space-y-1">
                {shares.map(s => (
                  <div key={s.id} className="flex items-center gap-2 text-xs bg-slate-50 border rounded px-3 py-1.5">
                    <span>{iconFor(s.grantee_type)}</span>
                    <span className="flex-1">{s.grantee_name || s.grantee_id}</span>
                    <span className="text-slate-400 text-[10px]">{t(`grantee.type.${s.grantee_type}`)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${s.share_type === 'edit' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                      {s.share_type === 'edit' ? t('tpl.share.permEdit') : t('tpl.share.permUse')}
                    </span>
                    <button onClick={() => removeShare(s.id)} className="text-red-400 hover:text-red-600">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
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
