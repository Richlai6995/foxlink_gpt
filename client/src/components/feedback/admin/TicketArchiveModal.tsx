import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Clock, FileText, Image, Download, RotateCcw, CheckCircle, Archive as ArchiveIcon } from 'lucide-react'
import api from '../../../lib/api'

interface SnapshotListItem {
  id: number
  ticket_id: number
  ticket_no: string
  snapshot_at: string
  snapshot_trigger: string
  triggered_by: number | null
  triggered_by_name: string | null
  triggered_by_username: string | null
}

interface SnapshotMessage {
  id: number
  sender_id: number
  sender_role: string
  sender_name: string
  content: string
  is_internal: number
  is_system: number
  created_at: string
}

interface SnapshotAttachment {
  id: number
  file_name: string
  file_path: string
  file_size: number
  mime_type: string
  message_id: number | null
  created_at: string
}

interface SnapshotDetail {
  id: number
  ticket_id: number
  ticket_no: string
  snapshot_at: string
  snapshot_trigger: string
  triggered_by_name: string | null
  triggered_by_username: string | null
  messages: SnapshotMessage[]
  attachments: SnapshotAttachment[]
  ticket_snapshot: any
}

export default function TicketArchiveModal({
  ticketId,
  onClose,
}: {
  ticketId: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [list, setList] = useState<SnapshotListItem[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<SnapshotDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const { data } = await api.get<SnapshotListItem[]>(`/feedback/tickets/${ticketId}/archive`)
        setList(data)
        if (data.length > 0) setSelectedId(data[0].id)
      } finally {
        setLoading(false)
      }
    })()
  }, [ticketId])

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null)
      return
    }
    setDetailLoading(true)
    ;(async () => {
      try {
        const { data } = await api.get<SnapshotDetail>(`/feedback/archive/${selectedId}`)
        setDetail(data)
      } finally {
        setDetailLoading(false)
      }
    })()
  }, [selectedId])

  const triggerIcon = (trg: string) => {
    if (trg === 'resolved') return <CheckCircle size={12} className="text-blue-500" />
    if (trg === 'closed') return <CheckCircle size={12} className="text-gray-500" />
    if (trg === 'reopened') return <RotateCcw size={12} className="text-orange-500" />
    return <ArchiveIcon size={12} className="text-gray-400" />
  }

  const triggerLabel = (trg: string) => {
    const map: Record<string, string> = {
      resolved: t('feedback.statusLabels.resolved') || '已解決',
      closed: t('feedback.statusLabels.closed') || '已結案',
      reopened: t('feedback.statusLabels.reopened') || '重新開啟',
      manual: '手動',
      migration: '歷史匯入',
    }
    return map[trg] || trg
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2">
            <ArchiveIcon size={18} className="text-gray-500" />
            <h2 className="text-base font-semibold text-gray-900">{t('feedback.archiveTitle') || '歷史快照'}</h2>
            <span className="text-xs text-gray-400 font-mono">{list[0]?.ticket_no || ''}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 p-1 rounded hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* List sidebar */}
          <div className="w-64 border-r border-gray-200 overflow-y-auto bg-gray-50">
            {loading ? (
              <div className="p-4 text-sm text-gray-400">{t('common.loading') || '載入中...'}</div>
            ) : list.length === 0 ? (
              <div className="p-4 text-sm text-gray-400">{t('feedback.noSnapshots') || '尚無快照'}</div>
            ) : (
              list.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-200 hover:bg-white transition ${
                    selectedId === s.id ? 'bg-white border-l-2 border-l-blue-500' : ''
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-gray-900">
                    {triggerIcon(s.snapshot_trigger)}
                    {triggerLabel(s.snapshot_trigger)}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
                    <Clock size={10} />
                    {new Date(s.snapshot_at).toLocaleString()}
                  </div>
                  {s.triggered_by_name && (
                    <div className="text-[11px] text-gray-400 mt-0.5">by {s.triggered_by_name}</div>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Detail panel */}
          <div className="flex-1 overflow-y-auto">
            {detailLoading ? (
              <div className="p-6 text-sm text-gray-400">{t('common.loading') || '載入中...'}</div>
            ) : !detail ? (
              <div className="p-6 text-sm text-gray-400">{t('feedback.selectSnapshot') || '請選擇快照'}</div>
            ) : (
              <div className="p-5 space-y-4">
                {/* Ticket snapshot summary */}
                {detail.ticket_snapshot && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs space-y-1">
                    <div className="font-semibold text-gray-900 text-sm">{detail.ticket_snapshot.subject}</div>
                    <div className="text-gray-500">
                      <span>{detail.ticket_snapshot.applicant_name || '-'}</span>
                      {detail.ticket_snapshot.applicant_employee_id && (
                        <span className="font-mono ml-2">#{detail.ticket_snapshot.applicant_employee_id}</span>
                      )}
                      {detail.ticket_snapshot.applicant_dept && (
                        <span className="ml-2">· {detail.ticket_snapshot.applicant_dept}</span>
                      )}
                    </div>
                    {detail.ticket_snapshot.resolution_note && (
                      <div className="pt-2 mt-2 border-t border-gray-200">
                        <div className="text-gray-500 text-[11px] mb-0.5">解決說明</div>
                        <div className="text-gray-800 whitespace-pre-wrap">{detail.ticket_snapshot.resolution_note}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Messages */}
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-2">對話 ({detail.messages.length})</div>
                  <div className="space-y-2">
                    {detail.messages.map(m => (
                      <div
                        key={m.id}
                        className={`rounded-lg p-3 border text-sm ${
                          m.is_internal
                            ? 'bg-amber-50 border-amber-200'
                            : m.is_system
                            ? 'bg-gray-100 border-gray-200'
                            : m.sender_role === 'admin'
                            ? 'bg-blue-50 border-blue-100'
                            : 'bg-white border-gray-200'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                          <span className="font-medium text-gray-700">{m.sender_name}</span>
                          <span>·</span>
                          <span>{new Date(m.created_at).toLocaleString()}</span>
                          {m.is_internal ? <span className="text-amber-600">· 內部備註</span> : null}
                          {m.is_system ? <span className="text-gray-500">· 系統訊息</span> : null}
                        </div>
                        <div className="whitespace-pre-wrap break-words text-gray-800">{m.content}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Attachments */}
                {detail.attachments.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-2">附件 ({detail.attachments.length})</div>
                    <div className="grid grid-cols-2 gap-2">
                      {detail.attachments.map(a => (
                        <a
                          key={a.id}
                          href={`/uploads/${a.file_path}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 p-2 bg-gray-50 border border-gray-200 rounded-lg hover:bg-white transition text-xs"
                        >
                          {a.mime_type?.startsWith('image/') ? <Image size={14} /> : <FileText size={14} />}
                          <span className="flex-1 truncate text-gray-800">{a.file_name}</span>
                          <Download size={12} className="text-gray-400" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
