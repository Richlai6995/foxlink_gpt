import { useState, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Send, Paperclip, X, FileText, Image, Music, AlertCircle, Search, LayoutTemplate } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import TemplatePickerPopover from './templates/TemplatePickerPopover'
import { DocTemplate } from '../types'

interface Props {
  onSend: (message: string, files: File[]) => void
  onResearch?: () => void
  disabled?: boolean
  canResearch?: boolean
}

export interface MessageInputHandle {
  addFiles: (files: File[]) => void
  getQuestion: () => string
  getFiles: () => File[]
}

const ALLOWED_TYPES = [
  'text/plain',
  'text/csv',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
]

function getFileIcon(type: string) {
  if (type.startsWith('image/')) return <Image size={14} className="text-blue-400" />
  if (type.startsWith('audio/')) return <Music size={14} className="text-purple-400" />
  return <FileText size={14} className="text-slate-400" />
}

const MessageInput = forwardRef<MessageInputHandle, Props>(function MessageInput({ onSend, onResearch, disabled, canResearch }, ref) {
  const { user } = useAuth()
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState('')
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<DocTemplate | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const u = user as any
  const allowText = u?.allow_text_upload !== 0
  const textMaxMb: number = u?.text_max_mb || 10
  const allowAudio = u?.allow_audio_upload === 1
  const audioMaxMb: number = u?.audio_max_mb || 50

  const handleFiles = useCallback((newFiles: File[]) => {
    setFileError('')
    const valid: File[] = []
    for (const f of newFiles) {
      if (f.type.startsWith('video/')) {
        setFileError('不允許上傳影片檔案')
        continue
      }
      if (!ALLOWED_TYPES.includes(f.type) && !f.type.startsWith('text/')) {
        setFileError(`不支援的檔案格式: ${f.name}`)
        continue
      }
      if (f.type.startsWith('audio/')) {
        if (!allowAudio) {
          setFileError(`無聲音檔上傳權限，請聯絡管理員開啟`)
          continue
        }
        if (f.size > audioMaxMb * 1024 * 1024) {
          setFileError(`${f.name} 超過聲音檔上限 ${audioMaxMb}MB`)
          continue
        }
      } else if (!f.type.startsWith('image/')) {
        // text-type file
        if (!allowText) {
          setFileError(`無文字檔上傳權限，請聯絡管理員開啟`)
          continue
        }
        if (f.size > textMaxMb * 1024 * 1024) {
          setFileError(`${f.name} 超過文字檔上限 ${textMaxMb}MB`)
          continue
        }
      }
      valid.push(f)
    }
    setFiles((prev) => [...prev, ...valid])
  }, [allowText, textMaxMb, allowAudio, audioMaxMb])

  useImperativeHandle(ref, () => ({
    addFiles: (newFiles: File[]) => handleFiles(newFiles),
    getQuestion: () => message,
    getFiles: () => files,
  }), [handleFiles, message, files])

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
    if (!message.trim() && files.length === 0) return
    const finalMsg = selectedTemplate
      ? `[使用範本:${selectedTemplate.id}:${selectedTemplate.name}] ${message.trim()}`
      : message.trim()
    onSend(finalMsg, files)
    setMessage('')
    setFiles([])
    setFileError('')
    setSelectedTemplate(null)
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
        <div className="flex items-center gap-2 mb-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5 text-xs text-indigo-700">
          <LayoutTemplate size={13} />
          <span>使用範本：<strong>{selectedTemplate.name}</strong></span>
          <button onClick={() => setSelectedTemplate(null)} className="ml-auto text-indigo-400 hover:text-indigo-600">
            <X size={12} />
          </button>
        </div>
      )}

      {/* File previews */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {files.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700"
            >
              {getFileIcon(f.type)}
              <span className="max-w-[150px] truncate">{f.name}</span>
              <button
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                className="text-slate-400 hover:text-red-500 transition ml-1"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {fileError && (
        <div className="flex items-center gap-1.5 text-red-500 text-xs mb-2">
          <AlertCircle size={12} />
          {fileError}
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
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept={ALLOWED_TYPES.join(',')}
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

        {/* Send */}
        <button
          onClick={handleSubmit}
          disabled={disabled || (!message.trim() && files.length === 0)}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl p-2 flex-shrink-0 mb-0.5 transition"
        >
          <Send size={16} />
        </button>
      </div>

      <p className="text-center text-slate-400 text-xs mt-2">
        支援 圖片{allowText ? `、PDF/Word/Excel/PPT（限 ${textMaxMb}MB）` : ''}{allowAudio ? `、音訊（限 ${audioMaxMb}MB）` : ''}
      </p>
    </div>
  )
})

export default MessageInput
