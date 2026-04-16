import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../lib/api'
import { ArrowLeft, Upload, X, Loader2 } from 'lucide-react'
import MicButton from '../components/MicButton'

interface Category {
  id: number
  name: string
  icon: string
}

export default function FeedbackNewPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const [voicePreview, setVoicePreview] = useState('')

  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState(searchParams.get('description') || '')
  const [shareLink, setShareLink] = useState(searchParams.get('share_link') || '')
  const [categoryId, setCategoryId] = useState(searchParams.get('category_id') || '')
  const [priority, setPriority] = useState('medium')
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const source = searchParams.get('source') || 'web'
  const sourceSessionId = searchParams.get('source_session_id') || ''

  useEffect(() => {
    api.get(`/feedback/categories?lang=${i18n.language}`).then(r => setCategories(r.data)).catch(() => {})
  }, [i18n.language])

  const addFiles = (newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles)
    setFiles(prev => [...prev, ...arr])
    arr.forEach(f => {
      if (f.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = e => setPreviews(prev => [...prev, e.target?.result as string])
        reader.readAsDataURL(f)
      } else {
        setPreviews(prev => [...prev, ''])
      }
    })
  }

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
    setPreviews(prev => prev.filter((_, i) => i !== idx))
  }

  // Ctrl+V paste handler — 重命名貼上的圖片，避免預設檔名全是 image.png
  const renamePastedFile = (file: File, idx: number): File => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    const suffix = idx > 0 ? `_${idx}` : ''
    const m = (file.name || '').match(/\.[^.]+$/)
    const ext = m ? m[0] : (file.type.startsWith('image/') ? `.${file.type.split('/')[1].replace('jpeg', 'jpg')}` : '.bin')
    const baseRaw = (file.name || '').replace(/\.[^.]+$/, '').trim()
    const base = !baseRaw || /^image$/i.test(baseRaw) ? 'paste' : baseRaw
    return new File([file], `${base}_${stamp}${suffix}${ext}`, { type: file.type })
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault()
      addFiles(imageFiles.map((f, i) => renamePastedFile(f, i)))
    }
  }

  // 在游標位置插入文字（語音輸入）
  const insertAtCursor = useCallback((text: string) => {
    if (!text) return
    const ta = descriptionRef.current
    if (!ta) {
      setDescription((prev) => (prev ? prev + ' ' + text : text))
      return
    }
    const start = ta.selectionStart ?? description.length
    const end = ta.selectionEnd ?? description.length
    setDescription((prev) => prev.slice(0, start) + text + prev.slice(end))
    requestAnimationFrame(() => {
      try {
        ta.focus()
        const pos = start + text.length
        ta.selectionStart = ta.selectionEnd = pos
      } catch {}
    })
    setVoicePreview('')
  }, [description.length])

  // Drag & drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files)
    }
  }

  const buildFormData = () => {
    const formData = new FormData()
    formData.append('subject', subject.trim())
    if (description) formData.append('description', description)
    if (shareLink) formData.append('share_link', shareLink)
    if (categoryId) formData.append('category_id', categoryId)
    formData.append('priority', priority)
    if (source) formData.append('source', source)
    if (sourceSessionId) formData.append('source_session_id', sourceSessionId)
    files.forEach(f => formData.append('files', f))
    return formData
  }

  const handleSaveDraft = async () => {
    if (!subject.trim()) { setError(t('feedback.subjectRequired')); return }
    setSubmitting(true); setError('')
    try {
      const formData = buildFormData()
      formData.append('is_draft', 'true')
      const { data } = await api.post('/feedback/tickets', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      navigate(`/feedback/${data.id}`)
    } catch (e: any) {
      setError(e.response?.data?.error || 'Error')
    } finally { setSubmitting(false) }
  }

  const handleSubmit = async () => {
    if (!subject.trim()) { setError(t('feedback.subjectRequired')); return }
    setSubmitting(true); setError('')
    try {
      const formData = buildFormData()
      const { data } = await api.post('/feedback/tickets', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      navigate(`/feedback/${data.id}`)
    } catch (e: any) {
      setError(e.response?.data?.error || 'Error')
    } finally { setSubmitting(false) }
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/feedback')} className="text-gray-400 hover:text-gray-900">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-bold">{t('feedback.newTicket')}</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="space-y-5">
          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('feedback.subject')} *</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              onPaste={handlePaste}
              className="w-full bg-white border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
              placeholder={t('feedback.subject')}
              autoFocus
            />
          </div>

          {/* Category + Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('feedback.category')}</label>
              <select
                value={categoryId}
                onChange={e => setCategoryId(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900"
              >
                <option value="">-- {t('feedback.category')} --</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('feedback.priority')}</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900"
              >
                <option value="low">{t('feedback.priorityLabels.low')}</option>
                <option value="medium">{t('feedback.priorityLabels.medium')}</option>
                <option value="high">{t('feedback.priorityLabels.high')}</option>
                <option value="urgent">{t('feedback.priorityLabels.urgent')}</option>
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-gray-700">{t('feedback.description')}</label>
              <MicButton
                onTranscript={insertAtCursor}
                onInterim={setVoicePreview}
                maxDuration={180}
                source="feedback"
                size={16}
              />
            </div>
            <textarea
              ref={descriptionRef}
              value={description}
              onChange={e => setDescription(e.target.value)}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              rows={6}
              className="w-full bg-white border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 resize-y"
              placeholder={t('feedback.description')}
            />
            {voicePreview && (
              <div className="mt-1 px-3 py-1 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700 italic flex items-center gap-1.5">
                <span className="text-blue-400">›</span>
                <span className="truncate">{voicePreview}</span>
              </div>
            )}
          </div>

          {/* Share Link */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('feedback.shareLink')}</label>
            <input
              type="url"
              value={shareLink}
              onChange={e => setShareLink(e.target.value)}
              className="w-full bg-white border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
              placeholder="https://..."
            />
          </div>

          {/* Attachments */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('feedback.attachFiles')}</label>
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={24} className="mx-auto mb-2 text-gray-400" />
              <p className="text-sm text-gray-500">
                {t('feedback.attachFiles')} / {t('feedback.pasteImage')} (Ctrl+V)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={e => e.target.files && addFiles(e.target.files)}
              />
            </div>

            {files.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-3">
                {files.map((f, i) => (
                  <div key={i} className="relative group bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                    {previews[i] ? (
                      <img src={previews[i]} alt="" className="w-20 h-20 object-cover" />
                    ) : (
                      <div className="w-20 h-20 flex items-center justify-center text-xs text-gray-500 px-1 text-center">
                        {f.name.length > 15 ? f.name.slice(0, 12) + '...' : f.name}
                      </div>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); removeFile(i) }}
                      className="absolute top-0.5 right-0.5 bg-red-600 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition"
                    >
                      <X size={10} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              onClick={() => navigate('/feedback')}
              className="px-5 py-2.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSaveDraft}
              disabled={submitting}
              className="px-5 py-2.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition flex items-center gap-2"
            >
              {t('common.save')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-5 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition flex items-center gap-2"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {t('feedback.submit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
