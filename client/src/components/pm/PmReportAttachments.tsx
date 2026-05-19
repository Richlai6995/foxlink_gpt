/**
 * PmReportAttachments — 採購週/月報的附件區
 *  - 列出已上傳附件
 *  - 支援多檔上傳(最多 5 個,每檔 20MB 上限,server 側 multer)
 *  - 下載 / 刪除單一附件
 */
import { useEffect, useState, useRef } from 'react'
import { Paperclip, Upload, Trash2, Download, Loader2 } from 'lucide-react'
import api from '../../lib/api'

interface Attachment {
  id: number
  filename: string
  size_bytes?: number
  mime_type?: string
  uploaded_at?: string
  uploaded_by?: number
  uploader_name?: string
}

interface Props {
  reportId: number
  onChanged?: () => void   // 改動時通知 parent(例:更新附件數 badge)
}

function fmtSize(b?: number) {
  if (b == null) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

export default function PmReportAttachments({ reportId, onChanged }: Props) {
  const [list, setList] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get(`/pm/briefing/purchaser-reports/${reportId}/attachments`)
      setList(r.data?.attachments || [])
    } catch (e: any) {
      // 沒附件 endpoint 也不顯示 alert(避免每次編輯 popup),只記 console
      console.warn('[PmReportAttachments] load failed:', e?.response?.data?.error || e.message)
    } finally { setLoading(false) }
  }

  useEffect(() => { if (reportId) load() }, [reportId])

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const form = new FormData()
    Array.from(files).slice(0, 5).forEach(f => form.append('files', f))
    setUploading(true)
    try {
      await api.post(`/pm/briefing/purchaser-reports/${reportId}/attachments`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      await load()
      onChanged?.()
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const remove = async (att: Attachment) => {
    if (!confirm(`刪除附件「${att.filename}」?`)) return
    try {
      await api.delete(`/pm/briefing/purchaser-reports/${reportId}/attachments/${att.id}`)
      await load()
      onChanged?.()
    } catch (e: any) {
      alert(e?.response?.data?.error || e.message)
    }
  }

  const download = (att: Attachment) => {
    // 用 anchor + token 通過 Bearer header — api 已含 interceptor,直接 GET 用 blob
    api.get(`/pm/briefing/purchaser-reports/${reportId}/attachments/${att.id}/download`, { responseType: 'blob' })
      .then(r => {
        const blob = new Blob([r.data], { type: r.headers['content-type'] || 'application/octet-stream' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = att.filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      })
      .catch(e => alert(e?.response?.data?.error || e.message))
  }

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/40">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <Paperclip size={13} className="text-slate-500" /> 附件
          <span className="text-[10px] text-slate-400 font-normal">({list.length})</span>
        </label>
        <div>
          <input ref={inputRef} type="file" multiple style={{ display: 'none' }}
            onChange={e => onUpload(e.target.files)} />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {uploading ? '上傳中…' : '上傳附件'}
          </button>
        </div>
      </div>
      <p className="text-[10px] text-slate-400 mb-2">
        最多 5 檔,每檔 ≤ 20MB。寄信時自動附上(可在寄信時取消)。
      </p>
      {loading ? (
        <div className="text-[11px] text-slate-400 italic">載入中…</div>
      ) : list.length === 0 ? (
        <div className="text-[11px] text-slate-400 italic">尚無附件</div>
      ) : (
        <div className="space-y-1">
          {list.map(att => (
            <div key={att.id} className="flex items-center gap-2 bg-white border border-slate-200 rounded px-2 py-1.5 text-xs">
              <Paperclip size={11} className="text-slate-400 flex-shrink-0" />
              <span className="text-slate-700 truncate flex-1" title={att.filename}>{att.filename}</span>
              <span className="text-[10px] text-slate-400">{fmtSize(att.size_bytes)}</span>
              <button onClick={() => download(att)} className="p-1 text-slate-400 hover:text-blue-600" title="下載">
                <Download size={12} />
              </button>
              <button onClick={() => remove(att)} className="p-1 text-slate-400 hover:text-rose-500" title="刪除">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
