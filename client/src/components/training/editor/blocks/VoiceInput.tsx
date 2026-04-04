/**
 * VoiceInput — TTS + 麥克風錄音 + 上傳音訊 三合一元件
 * 用於語音導覽面板的每段語音
 */
import { useState, useRef } from 'react'
import { Volume2, Mic, Square, Upload, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import api from '../../../../lib/api'

interface Props {
  text: string
  audioUrl: string | null
  slideId: number
  regionId: string
  language?: string
  onAudioChange: (url: string | null) => void
}

export default function VoiceInput({ text, audioUrl, slideId, regionId, language, onAudioChange }: Props) {
  const [generating, setGenerating] = useState(false)
  const [recording, setRecording] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const generateTTS = async () => {
    if (!text.trim()) return
    try {
      setGenerating(true)
      const res = await api.post(`/training/slides/${slideId}/region-tts`, {
        region_id: regionId, text, language: language || 'zh-TW'
      })
      onAudioChange(res.data.audio_url)
    } catch (e: any) {
      alert(e.response?.data?.error || 'TTS failed')
    } finally { setGenerating(false) }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      mr.ondataavailable = e => chunksRef.current.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        await uploadBlob(blob, 'recording.webm')
      }
      mr.start()
      mediaRecorderRef.current = mr
      setRecording(true)
    } catch {
      alert('Cannot access microphone')
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setRecording(false)
  }

  const uploadBlob = async (blob: Blob, filename: string) => {
    try {
      setUploading(true)
      const form = new FormData()
      form.append('file', blob, filename)
      const res = await api.post(`/training/courses/0/upload-audio`, form)
      onAudioChange(res.data.audio_url)
    } catch { /* fallback: use region-tts upload path */ }
    finally { setUploading(false) }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setUploading(true)
      const form = new FormData()
      form.append('audio', file)
      const res = await api.post(`/training/slides/${slideId}/audio`, form)
      // Use the uploaded audio_url but don't save to slide — just pass back
      onAudioChange(res.data.audio_url)
    } catch {}
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const busy = generating || recording || uploading

  if (!audioUrl) {
    // No audio — show generation options
    return (
      <div className="flex items-center gap-1 mt-0.5">
        <button onClick={generateTTS} disabled={busy || !text.trim()}
          className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded transition disabled:opacity-30"
          style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}>
          {generating ? <Loader2 size={8} className="animate-spin" /> : <Volume2 size={8} />} TTS
        </button>
        {recording ? (
          <button onClick={stopRecording}
            className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 animate-pulse">
            <Square size={8} /> Stop
          </button>
        ) : (
          <button onClick={startRecording} disabled={busy}
            className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded transition disabled:opacity-30"
            style={{ color: 'var(--t-text-dim)', border: '1px solid var(--t-border)' }}>
            <Mic size={8} />
          </button>
        )}
        <label className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded transition cursor-pointer"
          style={{ color: 'var(--t-text-dim)', border: '1px solid var(--t-border)' }}>
          <Upload size={8} />
          <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={handleFileUpload} disabled={busy} />
        </label>
        {uploading && <Loader2 size={9} className="animate-spin" style={{ color: 'var(--t-text-dim)' }} />}
      </div>
    )
  }

  // Has audio — show player + replace menu
  return (
    <div className="flex items-center gap-1 mt-0.5">
      <audio src={audioUrl} controls className="h-5 flex-1" style={{ maxHeight: '20px' }} />
      <div className="relative">
        <button onClick={() => setShowMenu(!showMenu)}
          className="text-[9px] px-1 py-0.5 rounded transition"
          style={{ color: 'var(--t-text-dim)', border: '1px solid var(--t-border)' }}>
          <RotateCcw size={8} />
        </button>
        {showMenu && (
          <>
            <div className="fixed inset-0 z-[9]" onClick={() => setShowMenu(false)} />
            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border rounded shadow-lg z-10 min-w-[100px]"
              style={{ borderColor: 'var(--t-border)' }}>
              <button onClick={() => { setShowMenu(false); generateTTS() }} disabled={!text.trim()}
                className="flex items-center gap-1.5 w-full text-left px-2 py-1 text-[9px] hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30"
                style={{ color: 'var(--t-text)' }}>
                <Volume2 size={9} /> TTS
              </button>
              <button onClick={() => { setShowMenu(false); recording ? stopRecording() : startRecording() }}
                className="flex items-center gap-1.5 w-full text-left px-2 py-1 text-[9px] hover:bg-gray-100 dark:hover:bg-gray-700"
                style={{ color: 'var(--t-text)' }}>
                <Mic size={9} /> {recording ? 'Stop' : 'Mic'}
              </button>
              <label className="flex items-center gap-1.5 w-full text-left px-2 py-1 text-[9px] hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                style={{ color: 'var(--t-text)' }}>
                <Upload size={9} /> Upload
                <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={e => { setShowMenu(false); handleFileUpload(e) }} />
              </label>
              <button onClick={() => { setShowMenu(false); onAudioChange(null) }}
                className="flex items-center gap-1.5 w-full text-left px-2 py-1 text-[9px] hover:bg-gray-100 dark:hover:bg-gray-700 text-red-400">
                <Trash2 size={9} /> Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
