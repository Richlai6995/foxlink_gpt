import { useState, useRef } from 'react'
import { Upload, X, Wand2, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import api from '../../../lib/api'

interface Props {
  courseId: number
  lessonId: number
  onComplete: () => void
  onClose: () => void
}

interface ImportResult {
  index: number
  filename: string
  regions?: any[]
  instruction?: string
  error?: string
  status: 'pending' | 'uploading' | 'analyzing' | 'done' | 'error'
}

export default function BatchImport({ courseId, lessonId, onComplete, onClose }: Props) {
  const [files, setFiles] = useState<File[]>([])
  const [results, setResults] = useState<ImportResult[]>([])
  const [processing, setProcessing] = useState(false)
  const [aiAnalyze, setAiAnalyze] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  const addFiles = (newFiles: FileList | null) => {
    if (!newFiles) return
    const arr = Array.from(newFiles).filter(f => f.type.startsWith('image/'))
    setFiles(prev => [...prev, ...arr])
  }

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  const startImport = async () => {
    if (files.length === 0) return
    setProcessing(true)

    const importResults: ImportResult[] = files.map((f, i) => ({
      index: i, filename: f.name, status: 'pending'
    }))
    setResults(importResults)

    for (let i = 0; i < files.length; i++) {
      // Update status: uploading
      setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'uploading' } : r))

      try {
        // Upload image
        const form = new FormData()
        form.append('file', files[i])
        const uploadRes = await api.post(`/training/courses/${courseId}/upload`, form)
        const imageUrl = uploadRes.data.url

        let regions: any[] = []
        let instruction = ''

        // AI analyze if enabled
        if (aiAnalyze) {
          setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'analyzing' } : r))
          try {
            const aiRes = await api.post('/training/ai/analyze-screenshot', {
              screenshot_url: imageUrl,
              context: `批次匯入截圖第 ${i + 1}/${files.length} 張`
            })
            regions = (aiRes.data.regions || []).map((r: any, ri: number) => ({
              id: `r${Date.now()}_${ri}`,
              shape: 'rect',
              coords: r.coords,
              correct: r.is_primary || false,
              feedback: r.is_primary ? `正確！這是「${r.label}」。` : `這是「${r.label}」。`
            }))
            instruction = aiRes.data.instruction || ''
          } catch (e) {
            console.warn('AI analyze failed for', files[i].name)
          }
        }

        // Create slide
        const hasPrimary = regions.some((r: any) => r.correct)
        const slideType = hasPrimary ? 'hotspot' : 'content'
        const contentJson = hasPrimary
          ? [{ type: 'hotspot', image: imageUrl, instruction: instruction || `步驟 ${i + 1}`, regions, max_attempts: 3, show_hint_after: 2 }]
          : [{ type: 'image', src: imageUrl, alt: '' }, ...(instruction ? [{ type: 'text', content: instruction }] : [])]

        await api.post(`/training/lessons/${lessonId}/slides`, {
          slide_type: slideType,
          content_json: contentJson,
          notes: instruction || null
        })

        setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'done', regions, instruction } : r))
      } catch (e: any) {
        setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', error: e.message } : r))
      }
    }

    setProcessing(false)
  }

  const doneCount = results.filter(r => r.status === 'done').length
  const allDone = results.length > 0 && results.every(r => r.status === 'done' || r.status === 'error')

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="rounded-xl border w-[600px] max-h-[80vh] flex flex-col"
        style={{ backgroundColor: 'var(--t-bg-card)', borderColor: 'var(--t-border)' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--t-border)' }}>
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--t-text)' }}>
            <Upload size={14} style={{ color: 'var(--t-accent)' }} /> 批次匯入截圖
          </h3>
          <button onClick={onClose} style={{ color: 'var(--t-text-muted)' }}><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* File picker */}
          {!processing && (
            <>
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed rounded-lg py-8 flex flex-col items-center cursor-pointer transition hover:opacity-80"
                style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-dim)' }}
              >
                <Upload size={24} className="mb-2" />
                <p className="text-xs">點擊選擇多張截圖，或拖放到此處</p>
                <p className="text-[10px] mt-1 opacity-60">支援 PNG / JPG，每張截圖會建立一個投影片</p>
              </div>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                onChange={e => addFiles(e.target.files)} />

              {/* AI toggle */}
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--t-text-secondary)' }}>
                <input type="checkbox" checked={aiAnalyze} onChange={e => setAiAnalyze(e.target.checked)} className="rounded" />
                <Wand2 size={12} style={{ color: 'var(--t-accent)' }} />
                AI 自動辨識互動區域（每張截圖用 Gemini Vision 分析）
              </label>
            </>
          )}

          {/* File list */}
          {files.length > 0 && !processing && (
            <div className="space-y-1">
              <div className="text-xs font-medium" style={{ color: 'var(--t-text-muted)' }}>
                已選擇 {files.length} 張截圖
              </div>
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded"
                  style={{ backgroundColor: 'var(--t-bg-inset)', color: 'var(--t-text-secondary)' }}>
                  <span className="w-5" style={{ color: 'var(--t-text-dim)' }}>{i + 1}.</span>
                  <span className="flex-1 truncate">{f.name}</span>
                  <span style={{ color: 'var(--t-text-dim)' }}>{(f.size / 1024).toFixed(0)} KB</span>
                  <button onClick={() => removeFile(i)} className="text-red-400 hover:text-red-300">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Progress */}
          {results.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium" style={{ color: 'var(--t-text-muted)' }}>
                處理進度：{doneCount}/{results.length}
              </div>
              {results.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded"
                  style={{ backgroundColor: 'var(--t-bg-inset)', color: 'var(--t-text-secondary)' }}>
                  <span className="w-5" style={{ color: 'var(--t-text-dim)' }}>{i + 1}.</span>
                  <span className="flex-1 truncate">{r.filename}</span>
                  {r.status === 'pending' && <span style={{ color: 'var(--t-text-dim)' }}>等待中</span>}
                  {r.status === 'uploading' && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--t-accent)' }} />}
                  {r.status === 'analyzing' && <><Wand2 size={12} className="animate-pulse" style={{ color: 'var(--t-accent)' }} /><span style={{ color: 'var(--t-accent)' }}>AI 分析中</span></>}
                  {r.status === 'done' && <><CheckCircle2 size={12} className="text-green-500" /><span className="text-green-500">{r.regions?.length || 0} 區域</span></>}
                  {r.status === 'error' && <><AlertCircle size={12} className="text-red-400" /><span className="text-red-400">失敗</span></>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t px-4 py-3 flex items-center gap-3" style={{ borderColor: 'var(--t-border)' }}>
          {!processing && !allDone && (
            <button onClick={startImport} disabled={files.length === 0}
              className="flex items-center gap-1.5 text-white px-4 py-2 rounded-lg text-xs font-medium transition disabled:opacity-50"
              style={{ backgroundColor: 'var(--t-accent-bg)' }}>
              <Upload size={14} /> 開始匯入 ({files.length} 張)
            </button>
          )}
          {allDone && (
            <button onClick={() => { onComplete(); onClose() }}
              className="flex items-center gap-1.5 text-white px-4 py-2 rounded-lg text-xs font-medium transition"
              style={{ backgroundColor: 'var(--t-accent-bg)' }}>
              <CheckCircle2 size={14} /> 完成，返回編輯器
            </button>
          )}
          {processing && (
            <span className="text-xs flex items-center gap-2" style={{ color: 'var(--t-text-muted)' }}>
              <Loader2 size={14} className="animate-spin" /> 處理中，請勿關閉...
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
