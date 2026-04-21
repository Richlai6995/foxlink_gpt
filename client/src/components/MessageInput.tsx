import { useState, useRef, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react'
import { Send, Paperclip, X, FileText, Image, Music, AlertCircle, Search, LayoutTemplate, Sparkles, Palette, Database, Loader2, Upload } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import TemplatePickerPopover from './templates/TemplatePickerPopover'
import { DocTemplate, TemplateSchema } from '../types'
import MicButton from './MicButton'
import {
  classifyUpload,
  isEnvFile,
  buildAcceptAttr,
  TEXT_HARD_CAP_BYTES,
  TEXT_WARN_BYTES,
} from '../lib/uploadFileTypes'

interface Props {
  /** attachmentIds：已 pre-uploaded 的 server side id；有值時 ChatPage 應跳過 File[] 的 multipart 上傳 */
  onSend: (message: string, files: File[], attachmentIds?: string[]) => void
  onResearch?: () => void
  onErpTool?: () => void
  disabled?: boolean
  /** message 發送時的整體進度（附檔走 pre-upload 後這裡幾乎瞬間；但沒附檔只有訊息時仍適用） */
  uploadProgress?: number
  canResearch?: boolean
}

export interface MessageInputHandle {
  addFiles: (files: File[]) => void
  getQuestion: () => string
  getFiles: () => File[]
}

interface FileEntry {
  id: string          // local React key
  file: File
  progress: number    // 0..1；1 表示 server 已回 attachmentId
  attachmentId?: string // server 回傳的 att_* id
  error?: string
  xhr?: XMLHttpRequest
}

const ACCEPT_ATTR = buildAcceptAttr()

function getFileIcon(type: string) {
  if (type.startsWith('image/')) return <Image size={14} className="text-blue-400" />
  if (type.startsWith('audio/')) return <Music size={14} className="text-purple-400" />
  return <FileText size={14} className="text-slate-400" />
}

function ProgressRing({ progress, size = 14 }: { progress: number; size?: number }) {
  const stroke = 2
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.max(0, Math.min(1, progress)))
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} stroke="#e2e8f0" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        stroke="#3b82f6" strokeWidth={stroke} fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.15s ease-out' }}
      />
    </svg>
  )
}

function localEntryId() {
  try { return crypto.randomUUID() } catch { return `e_${Date.now()}_${Math.random().toString(36).slice(2)}` }
}

const MessageInput = forwardRef<MessageInputHandle, Props>(function MessageInput({ onSend, onResearch, onErpTool, disabled, uploadProgress, canResearch }, ref) {
  const { user } = useAuth()
  const [message, setMessage] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [fileError, setFileError] = useState('')
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<DocTemplate | null>(null)
  const [tplOutputFmt, setTplOutputFmt] = useState<'pdf' | 'docx'>('pdf')
  const [pptxMode, setPptxMode] = useState<'template' | 'rich'>('template')
  const [pptxTheme, setPptxTheme] = useState<'dark' | 'light' | 'corporate'>('dark')
  const [voicePreview, setVoicePreview] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 在游標位置插入文字（語音輸入結果）
  const insertAtCursor = useCallback((text: string) => {
    if (!text) return
    const ta = textareaRef.current
    if (!ta) {
      setMessage((prev) => (prev ? prev + ' ' + text : text))
      return
    }
    const start = ta.selectionStart ?? message.length
    const end = ta.selectionEnd ?? message.length
    setMessage((prev) => prev.slice(0, start) + text + prev.slice(end))
    requestAnimationFrame(() => {
      try {
        ta.focus()
        const pos = start + text.length
        ta.selectionStart = ta.selectionEnd = pos
        ta.style.height = 'auto'
        ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
      } catch {}
    })
    setVoicePreview('')
  }, [message.length])

  // Detect if selected PPTX template has layout_template slides (supports rich mode)
  const isPptxWithLayout = useMemo(() => {
    if (!selectedTemplate || selectedTemplate.format !== 'pptx' || !selectedTemplate.schema_json) return false
    try {
      const schema: TemplateSchema = typeof selectedTemplate.schema_json === 'string'
        ? JSON.parse(selectedTemplate.schema_json) : selectedTemplate.schema_json
      return schema.pptx_settings?.slide_config?.some(c => c.type === 'layout_template') ?? false
    } catch { return false }
  }, [selectedTemplate])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const u = user as any
  const allowText = u?.allow_text_upload !== 0
  const textMaxMb: number = u?.text_max_mb || 10
  const allowAudio = u?.allow_audio_upload === 1
  const audioMaxMb: number = u?.audio_max_mb || 50

  // 啟動單檔 pre-upload 到 /api/chat/attachments；進度寫入 entry
  const uploadEntry = useCallback((entry: FileEntry) => {
    const fd = new FormData()
    fd.append('file', entry.file)
    const xhr = new XMLHttpRequest()
    entry.xhr = xhr
    xhr.open('POST', '/api/chat/attachments')
    xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('token') || ''}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        // 上傳 bytes 進度只到 99%，100% 等 server 回 id 才標記
        const p = Math.min(0.99, e.loaded / e.total)
        setEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, progress: p } : x)))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText)
          setEntries((prev) => prev.map((x) => (x.id === entry.id
            ? { ...x, progress: 1, attachmentId: body.id, xhr: undefined }
            : x)))
        } catch {
          setEntries((prev) => prev.map((x) => (x.id === entry.id
            ? { ...x, error: '回應解析失敗', xhr: undefined } : x)))
        }
      } else {
        let msg = `HTTP ${xhr.status}`
        try { msg = JSON.parse(xhr.responseText).error || msg } catch {}
        setEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, error: msg, xhr: undefined } : x)))
      }
    }
    xhr.onerror = () => setEntries((prev) => prev.map((x) => (x.id === entry.id
      ? { ...x, error: '網路錯誤', xhr: undefined } : x)))
    xhr.onabort = () => { /* removeEntry 會自己過濾掉此 entry */ }
    xhr.send(fd)
  }, [])

  const handleFiles = useCallback((newFiles: File[]) => {
    const valid: File[] = []
    const warnings: string[] = []
    let errMsg = ''
    const setErr = (m: string) => { errMsg = m }
    for (const f of newFiles) {
      const c = classifyUpload(f.name, f.type)
      if (!c.ok) {
        setErr(c.reason || `不支援的檔案格式: ${f.name}`)
        continue
      }
      if (c.kind === 'audio') {
        if (!allowAudio) { setErr(`無聲音檔上傳權限，請聯絡管理員開啟`); continue }
        if (f.size > audioMaxMb * 1024 * 1024) {
          setErr(`${f.name} 超過聲音檔上限 ${audioMaxMb}MB`)
          continue
        }
      } else if (c.kind === 'text' || c.kind === 'pdf' || c.kind === 'office') {
        if (!allowText) { setErr(`無文字檔上傳權限，請聯絡管理員開啟`); continue }
        const userMax = textMaxMb * 1024 * 1024
        const isNewTextType = c.kind === 'text' && !!c.subtype && c.subtype !== 'doc'
        const maxBytes = isNewTextType ? Math.min(userMax, TEXT_HARD_CAP_BYTES) : userMax
        if (f.size > maxBytes) {
          const capMb = (maxBytes / 1024 / 1024).toFixed(1)
          setErr(`${f.name} 超過檔案上限 ${capMb}MB`)
          continue
        }
        if (c.kind === 'text' && isEnvFile(c.basename)) {
          const proceed = window.confirm(
            `⚠️ ${f.name}\n\n此類檔案常含 API key／密碼／連線字串。\n請務必確認檔案不含機敏資訊後再上傳。\n\n仍要上傳嗎？`
          )
          if (!proceed) continue
        }
        if (
          c.kind === 'text' &&
          (c.subtype === 'code' || c.subtype === 'config' || c.subtype === 'log') &&
          f.size > TEXT_WARN_BYTES
        ) {
          warnings.push(`${f.name} 較大 (${(f.size / 1024).toFixed(0)}KB)，將增加 token 用量`)
        }
      }
      valid.push(f)
    }
    // 建立 entry 並啟動上傳
    const newEntries: FileEntry[] = valid.map((f) => ({ id: localEntryId(), file: f, progress: 0 }))
    setEntries((prev) => [...prev, ...newEntries])
    newEntries.forEach(uploadEntry)

    if (errMsg) setFileError(errMsg)
    else if (warnings.length) setFileError(`提示：${warnings.join('；')}`)
    else setFileError('')
  }, [allowText, textMaxMb, allowAudio, audioMaxMb, uploadEntry])

  // 移除單筆 entry：上傳中 → abort XHR；已傳完 → DELETE server staging
  const removeEntry = useCallback((entryId: string) => {
    setEntries((prev) => {
      const target = prev.find((e) => e.id === entryId)
      if (target) {
        if (target.xhr && !target.attachmentId) {
          try { target.xhr.abort() } catch {}
        }
        if (target.attachmentId) {
          const token = localStorage.getItem('token') || ''
          fetch(`/api/chat/attachments/${target.attachmentId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {})
        }
      }
      return prev.filter((e) => e.id !== entryId)
    })
  }, [])

  const hasUploading = entries.some((e) => !e.attachmentId && !e.error)

  useImperativeHandle(ref, () => ({
    addFiles: (newFiles: File[]) => handleFiles(newFiles),
    getQuestion: () => message,
    // 回原始 File[]（研究 modal 會自己做上傳，不依賴 chat 的 pre-upload）
    getFiles: () => entries.map((e) => e.file),
  }), [handleFiles, message, entries])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      handleFiles(Array.from(e.dataTransfer.files))
    },
    [handleFiles]
  )

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items)
    const imageItems = items.filter((item) => item.type.startsWith('image/'))
    if (imageItems.length > 0) {
      e.preventDefault() // 有圖片時阻止預設貼上行為
      const imageFiles = imageItems
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null)
        .map((f) => {
          // 給截圖一個有意義的檔名
          const ext = f.type.split('/')[1] || 'png'
          return new File([f], `clipboard_${Date.now()}.${ext}`, { type: f.type })
        })
      handleFiles(imageFiles)
    }
    // 純文字讓 textarea 預設行為處理，不需要額外處理
  }, [handleFiles])

  const handleSubmit = () => {
    if (disabled) return
    if (hasUploading) return // 任一檔案還沒傳完就擋住
    if (!message.trim() && entries.length === 0) return
    const outFmt = selectedTemplate?.format === 'pdf' ? tplOutputFmt : selectedTemplate?.format
    const pptxSuffix = (isPptxWithLayout && pptxMode === 'rich') ? `:rich:${pptxTheme}` : ''
    const finalMsg = selectedTemplate
      ? `[使用範本:${selectedTemplate.id}:${selectedTemplate.name}:${outFmt}${pptxSuffix}] ${message.trim()}`
      : message.trim()
    const successful = entries.filter((e) => e.attachmentId)
    const files = successful.map((e) => e.file)
    const attachmentIds = successful.map((e) => e.attachmentId!)
    onSend(finalMsg, files, attachmentIds)
    setMessage('')
    setEntries([])
    setFileError('')
    setSelectedTemplate(null)
    setTplOutputFmt('pdf')
    setPptxMode('template')
    setPptxTheme('dark')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const autoResize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  return (
    <div className="p-4 bg-white border-t border-slate-200">
      {/* Selected template badge */}
      {selectedTemplate && (
        <div className="flex items-center gap-2 mb-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5 text-xs text-indigo-700 flex-wrap">
          <LayoutTemplate size={13} />
          <span>使用範本：<strong>{selectedTemplate.name}</strong></span>
          {/* PDF output format toggle */}
          {selectedTemplate.format === 'pdf' && (
            <div className="flex rounded border border-indigo-300 overflow-hidden text-[11px] ml-1">
              {(['pdf', 'docx'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setTplOutputFmt(f)}
                  className={`px-2 py-0.5 transition ${tplOutputFmt === f ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 hover:bg-indigo-50'}`}
                >
                  {f === 'pdf' ? 'PDF' : 'Word'}
                </button>
              ))}
            </div>
          )}
          {/* PPTX: content mode toggle (template vs AI rich) */}
          {isPptxWithLayout && (
            <div className="flex rounded border border-indigo-300 overflow-hidden text-[11px] ml-1">
              <button
                onClick={() => setPptxMode('template')}
                className={`px-2 py-0.5 transition flex items-center gap-1 ${pptxMode === 'template' ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 hover:bg-indigo-50'}`}
              >
                <LayoutTemplate size={10} />依範本格式
              </button>
              <button
                onClick={() => setPptxMode('rich')}
                className={`px-2 py-0.5 transition flex items-center gap-1 ${pptxMode === 'rich' ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 hover:bg-indigo-50'}`}
              >
                <Sparkles size={10} />AI 自由設計
              </button>
            </div>
          )}
          {/* PPTX: theme selector (only in rich mode) */}
          {isPptxWithLayout && pptxMode === 'rich' && (
            <div className="flex rounded border border-indigo-300 overflow-hidden text-[11px] ml-1">
              {([
                { value: 'dark' as const, label: '深色', icon: '🌙' },
                { value: 'light' as const, label: '淺色', icon: '☀️' },
                { value: 'corporate' as const, label: '企業', icon: '🏢' },
              ]).map(t => (
                <button
                  key={t.value}
                  onClick={() => setPptxTheme(t.value)}
                  className={`px-2 py-0.5 transition ${pptxTheme === t.value ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 hover:bg-indigo-50'}`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setSelectedTemplate(null)} className="ml-auto text-indigo-400 hover:text-indigo-600">
            <X size={12} />
          </button>
        </div>
      )}

      {/* File previews with per-file upload progress */}
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {entries.map((e) => {
            const uploading = !e.attachmentId && !e.error
            const percent = Math.round(e.progress * 100)
            return (
              <div
                key={e.id}
                className={`flex items-center gap-1.5 border rounded-lg px-2.5 py-1.5 text-xs transition ${
                  e.error
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : uploading
                      ? 'bg-blue-50 border-blue-200 text-slate-700'
                      : 'bg-slate-100 border-slate-200 text-slate-700'
                }`}
                title={e.error ? `上傳失敗: ${e.error}` : uploading ? `上傳中 ${percent}%` : undefined}
              >
                {e.error
                  ? <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                  : uploading
                    ? <ProgressRing progress={e.progress} size={14} />
                    : getFileIcon(e.file.type)}
                <span className="max-w-[150px] truncate">{e.file.name}</span>
                {uploading && <span className="text-[10px] text-blue-500 tabular-nums">{percent}%</span>}
                {e.error && <span className="text-[10px] text-red-500">失敗</span>}
                <button
                  onClick={() => removeEntry(e.id)}
                  className="text-slate-400 hover:text-red-500 transition ml-1"
                  title={uploading ? '取消上傳' : '移除'}
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Error */}
      {fileError && (
        <div className="flex items-center gap-1.5 text-red-500 text-xs mb-2">
          <AlertCircle size={12} />
          {fileError}
        </div>
      )}

      {/* Upload progress bar */}
      {uploadProgress !== undefined && uploadProgress < 1 && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span className="flex items-center gap-1"><Upload size={11} />檔案上傳中...</span>
            <span>{Math.round(uploadProgress * 100)}%</span>
          </div>
          <div className="w-full h-1 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-150"
              style={{ width: `${Math.round(uploadProgress * 100)}%` }}
            />
          </div>
        </div>
      )}
      {uploadProgress === 1 && (
        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2">
          <Loader2 size={11} className="animate-spin" />AI 處理中...
        </div>
      )}

      {/* Input area */}
      <div
        className="flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400 transition"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        {/* Attach */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="text-slate-400 hover:text-blue-500 transition p-1 flex-shrink-0 mb-0.5 disabled:opacity-50"
          title="上傳檔案"
        >
          <Paperclip size={18} />
        </button>

        {/* Template Picker */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowTemplatePicker(!showTemplatePicker)}
            disabled={disabled}
            className={`transition p-1 mb-0.5 disabled:opacity-50 ${selectedTemplate ? 'text-indigo-500' : 'text-slate-400 hover:text-indigo-500'}`}
            title="使用文件範本"
          >
            <LayoutTemplate size={18} />
          </button>
          {showTemplatePicker && (
            <TemplatePickerPopover
              onSelect={t => { setSelectedTemplate(t); setShowTemplatePicker(false) }}
              onClose={() => setShowTemplatePicker(false)}
            />
          )}
        </div>

        {/* Deep Research */}
        {canResearch && (
          <button
            onClick={onResearch}
            disabled={disabled}
            className="text-slate-400 hover:text-purple-500 transition p-1 flex-shrink-0 mb-0.5 disabled:opacity-50"
            title="深度研究"
          >
            <Search size={18} />
          </button>
        )}

        {/* ERP Tool 手動觸發 */}
        {onErpTool && (
          <button
            onClick={onErpTool}
            disabled={disabled}
            className="text-slate-400 hover:text-sky-600 transition p-1 flex-shrink-0 mb-0.5 disabled:opacity-50"
            title="ERP 工具"
          >
            <Database size={18} />
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept={ACCEPT_ATTR}
          onChange={(e) => {
            if (e.target.files) handleFiles(Array.from(e.target.files))
            e.target.value = ''
          }}
        />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value)
            autoResize()
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
          placeholder={disabled ? 'AI 正在回覆中...' : '輸入訊息... (Enter 送出, Shift+Enter 換行, Ctrl+V 貼上圖片)'}
          rows={1}
          className="flex-1 bg-transparent resize-none outline-none text-sm text-slate-800 placeholder-slate-400 py-1 min-h-[36px] max-h-[200px] overflow-y-auto"
        />

        {/* Mic — 語音輸入 */}
        <div className="flex-shrink-0 mb-0.5">
          <MicButton
            onTranscript={insertAtCursor}
            onInterim={setVoicePreview}
            maxDuration={60}
            source="chat"
          />
        </div>

        {/* Send */}
        <button
          onClick={handleSubmit}
          disabled={disabled || hasUploading || (!message.trim() && entries.length === 0)}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl p-2 flex-shrink-0 mb-0.5 transition"
          title={
            hasUploading ? '檔案上傳中，請稍候'
              : uploadProgress !== undefined && uploadProgress < 1 ? '傳送中'
                : undefined
          }
        >
          {hasUploading || (uploadProgress !== undefined && uploadProgress < 1)
            ? <Loader2 size={16} className="animate-spin" />
            : <Send size={16} />}
        </button>
      </div>

      {/* Voice interim 預覽條 */}
      {voicePreview && (
        <div className="mt-1 px-3 py-1 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700 italic flex items-center gap-1.5">
          <span className="text-blue-400">›</span>
          <span className="truncate">{voicePreview}</span>
        </div>
      )}

      <p className="text-center text-slate-400 text-xs mt-2">
        支援 圖片{allowText ? `、PDF/Word/Excel/PPT（限 ${textMaxMb}MB）` : ''}{allowAudio ? `、音訊（限 ${audioMaxMb}MB）` : ''}
      </p>
    </div>
  )
})

export default MessageInput
