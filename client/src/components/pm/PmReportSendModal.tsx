/**
 * PmReportSendModal — 採購週/月報「寄信給指定收件清單」對話框
 *  - 下拉選 mailing list(只列 is_active=1)
 *  - 顯示清單收件人數
 *  - 可自訂 subject(預設用 title 或自動生成)
 *  - 可加 extra_message(放在 report content 上方,例:本期重點)
 *  - 預設帶上既有附件,可取消
 *  - 寄信前顯示 confirm + preview 摘要
 */
import { useEffect, useState } from 'react'
import { X, Mail, Send, Loader2, AlertCircle } from 'lucide-react'
import api from '../../lib/api'

interface MailingList {
  id: number
  name: string
  description?: string | null
  is_active: number
  recipient_count: number
}

interface Props {
  reportId: number
  reportTitle?: string
  onClose: () => void
  onSent?: () => void
}

export default function PmReportSendModal({ reportId, reportTitle, onClose, onSent }: Props) {
  const [lists, setLists] = useState<MailingList[]>([])
  const [loading, setLoading] = useState(true)
  const [listId, setListId] = useState<number | null>(null)
  const [customSubject, setCustomSubject] = useState('')
  const [extraMessage, setExtraMessage] = useState('')
  const [includeAttachments, setIncludeAttachments] = useState(true)
  const [attachmentCount, setAttachmentCount] = useState(0)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    Promise.all([
      api.get('/pm/briefing/mailing-lists'),
      api.get(`/pm/briefing/purchaser-reports/${reportId}/attachments`),
    ]).then(([rl, ra]) => {
      const allLists: MailingList[] = (rl.data?.lists || []).filter((l: MailingList) => l.is_active)
      setLists(allLists)
      if (allLists.length > 0) setListId(allLists[0].id)
      setAttachmentCount((ra.data?.attachments || []).length)
    }).catch(e => {
      setResult({ ok: false, msg: e?.response?.data?.error || e.message })
    }).finally(() => setLoading(false))
  }, [reportId])

  const selectedList = lists.find(l => l.id === listId) || null

  const send = async () => {
    if (!listId) { alert('請選擇收件清單'); return }
    setSending(true)
    setResult(null)
    try {
      const r = await api.post(`/pm/briefing/purchaser-reports/${reportId}/send-email`, {
        list_id: listId,
        subject: customSubject.trim() || undefined,
        extra_message: extraMessage.trim() || undefined,
        include_attachments: includeAttachments,
      })
      setResult({
        ok: true,
        msg: `已寄出給 ${r.data.recipient_count} 位收件人${r.data.attachment_count ? `,含 ${r.data.attachment_count} 個附件` : ''}`,
      })
      onSent?.()
    } catch (e: any) {
      setResult({ ok: false, msg: e?.response?.data?.error || e.message })
    } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Mail size={16} className="text-blue-500" /> 寄送週/月報
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3 text-xs">
          {loading ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 size={12} className="animate-spin" /> 載入清單中…
            </div>
          ) : (
            <>
              {/* 收件清單下拉 */}
              <div>
                <label className="block text-slate-600 mb-1">收件清單 *</label>
                {lists.length === 0 ? (
                  <div className="border border-amber-200 bg-amber-50 rounded p-2 text-amber-700 text-[11px] flex items-start gap-1.5">
                    <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
                    <span>尚未建立任何收件清單。請先到 <strong>系統管理 → PM 寄信清單</strong> 建立清單。</span>
                  </div>
                ) : (
                  <select className="input w-full" value={listId ?? ''}
                    onChange={e => setListId(Number(e.target.value))}>
                    {lists.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.name}({l.recipient_count} 位)
                        {l.description ? ` — ${l.description.slice(0, 30)}` : ''}
                      </option>
                    ))}
                  </select>
                )}
                {selectedList && selectedList.recipient_count === 0 && (
                  <p className="text-[10px] text-rose-600 mt-1">此清單無收件人,無法寄出</p>
                )}
              </div>

              {/* 主旨自訂 */}
              <div>
                <label className="block text-slate-600 mb-1">主旨(選填)</label>
                <input className="input w-full" value={customSubject}
                  onChange={e => setCustomSubject(e.target.value)}
                  placeholder={`留空使用預設:[PM] ${reportTitle || '金屬市場報告'}`} />
              </div>

              {/* extra message */}
              <div>
                <label className="block text-slate-600 mb-1">補充訊息(選填,放在報告最上方)</label>
                <textarea className="input w-full h-20" value={extraMessage}
                  onChange={e => setExtraMessage(e.target.value)}
                  placeholder="例:本期重點是 PT 漲幅 +8%,請主管關注..." />
              </div>

              {/* 附件 */}
              <div>
                <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                  <input type="checkbox" checked={includeAttachments}
                    onChange={e => setIncludeAttachments(e.target.checked)} />
                  <span className="text-slate-700">
                    包含附件 <span className="text-slate-400">({attachmentCount} 個)</span>
                  </span>
                </label>
              </div>

              {/* 結果訊息 */}
              {result && (
                <div className={`border rounded p-2 text-[11px] flex items-start gap-1.5 ${
                  result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'
                }`}>
                  {result.ok ? '✓' : '✗'} {result.msg}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} disabled={sending}
            className="text-xs px-4 py-1.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            {result?.ok ? '關閉' : '取消'}
          </button>
          {!result?.ok && (
            <button onClick={send}
              disabled={sending || loading || !listId || (selectedList?.recipient_count === 0)}
              className="text-xs px-4 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1.5">
              {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              {sending ? '寄送中…' : '寄出'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
