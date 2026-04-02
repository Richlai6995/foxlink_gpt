import { useState, useRef } from 'react'
import { Volume2, Mic, MicOff, Upload, Trash2, Play, Square, Wand2 } from 'lucide-react'
import api from '../../../lib/api'

interface Props {
  slideId: number
  courseId: number
  audioUrl: string | null
  notes: string
  onAudioChange: (url: string | null) => void
  onNotesChange: (notes: string) => void
}

export default function AudioPanel({ slideId, courseId, audioUrl, notes, onAudioChange, onNotesChange }: Props) {
  const [recording, setRecording] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [sttListening, setSttListening] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recognitionRef = useRef<any>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── TTS: Generate from notes ──
  const generateTTS = async () => {
    if (!notes.trim()) return alert('請先輸入旁白文字')
    try {
      setGenerating(true)
      const res = await api.post(`/training/slides/${slideId}/tts`, { text: notes })
      onAudioChange(res.data.audio_url)
    } catch (e: any) {
      alert(e.response?.data?.error || 'TTS 生成失敗')
    } finally { setGenerating(false) }
  }

  // ── Mic Recording ──
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      mr.ondataavailable = e => chunksRef.current.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        await uploadAudio(blob)
      }
      mr.start()
      mediaRecorderRef.current = mr
      setRecording(true)
    } catch (e) {
      alert('無法存取麥克風')
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setRecording(false)
  }

  const uploadAudio = async (blob: Blob) => {
    try {
      setUploading(true)
      const form = new FormData()
      form.append('audio', blob, 'recording.webm')
      form.append('transcribe', 'true')
      const res = await api.post(`/training/slides/${slideId}/audio`, form)
      onAudioChange(res.data.audio_url)
      if (res.data.transcription && !notes.trim()) {
        onNotesChange(res.data.transcription)
      }
    } catch (e) { console.error(e) }
    finally { setUploading(false) }
  }

  // ── File upload ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('audio', file)
    form.append('transcribe', 'true')
    try {
      setUploading(true)
      const res = await api.post(`/training/slides/${slideId}/audio`, form)
      onAudioChange(res.data.audio_url)
      if (res.data.transcription && !notes.trim()) onNotesChange(res.data.transcription)
    } catch (e) { console.error(e) }
    finally { setUploading(false) }
  }

  // ── STT: Real-time speech input (Web Speech API) ──
  const toggleSTT = () => {
    if (sttListening) {
      recognitionRef.current?.stop()
      setSttListening(false)
      return
    }
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
    if (!SpeechRecognition) return alert('瀏覽器不支援語音輸入，請使用 Chrome')

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'zh-TW'
    recognition.onresult = (event: any) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      onNotesChange(notes + transcript)
    }
    recognition.onerror = () => setSttListening(false)
    recognition.onend = () => setSttListening(false)
    recognition.start()
    recognitionRef.current = recognition
    setSttListening(true)
  }

  const deleteAudio = async () => {
    try {
      await api.delete(`/training/slides/${slideId}/audio`)
      onAudioChange(null)
    } catch (e) { console.error(e) }
  }

  return (
    <div className="border-t border-slate-700 p-3 space-y-3">
      <div className="flex items-center gap-2 text-[10px] text-slate-400 font-semibold uppercase">
        <Volume2 size={12} /> 音訊 & 旁白
      </div>

      {/* Notes textarea with STT */}
      <div className="relative">
        <textarea
          value={notes}
          onChange={e => onNotesChange(e.target.value)}
          rows={3}
          className="w-full bg-slate-800 border border-slate-700 rounded text-xs px-2 py-1.5 pr-8 resize-none focus:outline-none focus:border-sky-500"
          placeholder="輸入旁白文字（可用語音輸入或 TTS 生成語音）..."
        />
        <button
          onClick={toggleSTT}
          className={`absolute right-2 top-2 p-1 rounded transition ${
            sttListening ? 'bg-red-500/20 text-red-400 animate-pulse' : 'text-slate-500 hover:text-sky-400'
          }`}
          title="語音輸入"
        >
          {sttListening ? <MicOff size={12} /> : <Mic size={12} />}
        </button>
      </div>

      {/* Audio controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={generateTTS} disabled={generating || !notes.trim()}
          className="flex items-center gap-1 text-[10px] bg-sky-600/20 text-sky-400 hover:bg-sky-600/30 px-2 py-1 rounded transition disabled:opacity-40">
          <Wand2 size={10} /> {generating ? 'TTS 生成中...' : 'TTS 生成語音'}
        </button>

        {recording ? (
          <button onClick={stopRecording}
            className="flex items-center gap-1 text-[10px] bg-red-600/20 text-red-400 px-2 py-1 rounded animate-pulse">
            <Square size={10} /> 停止錄音
          </button>
        ) : (
          <button onClick={startRecording} disabled={uploading}
            className="flex items-center gap-1 text-[10px] bg-slate-700 text-slate-300 hover:bg-slate-600 px-2 py-1 rounded transition">
            <Mic size={10} /> 麥克風錄音
          </button>
        )}

        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="flex items-center gap-1 text-[10px] bg-slate-700 text-slate-300 hover:bg-slate-600 px-2 py-1 rounded transition">
          <Upload size={10} /> {uploading ? '上傳中...' : '上傳音訊'}
        </button>
        <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={handleFileUpload} />

        {audioUrl && (
          <>
            <audio src={audioUrl} controls className="h-7" />
            <button onClick={deleteAudio} className="text-slate-500 hover:text-red-400">
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
