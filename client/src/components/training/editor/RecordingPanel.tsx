import { useState, useEffect, useRef, useCallback } from 'react'
import { Camera, Square, Play, Loader2, CheckCircle2, AlertCircle, X, ExternalLink,
         Wand2, Trash2, Star, GripVertical, ClipboardPaste, Plus, Image, Eye } from 'lucide-react'
import api from '../../../lib/api'

interface Props {
  courseId: number
  lessonId: number | null
  onComplete: (result: { course_id: number; lesson_id: number; slides_created: number }) => void
  onClose: () => void
}

interface CapturedStep {
  id: string
  imageDataUrl: string          // base64 data URL (暫存前端，不需存檔)
  thumbnail: string             // 縮圖
  note: string                  // 備註
  isKeyStep: boolean            // 重點步驟標記
  pageUrl?: string
  pageTitle?: string
  elementInfo?: any
  status: 'captured' | 'uploading' | 'analyzing' | 'done' | 'error'
}

interface HelpSection {
  id: string
  title: string
}

export default function RecordingPanel({ courseId, lessonId, onComplete, onClose }: Props) {
  const [steps, setSteps] = useState<CapturedStep[]>([])
  const [recording, setRecording] = useState(false)
  const [targetUrl, setTargetUrl] = useState(window.location.origin)
  const [helpSections, setHelpSections] = useState<HelpSection[]>([])
  const [selectedSection, setSelectedSection] = useState('')
  const [outline, setOutline] = useState<any[]>([])
  const [outlineLoading, setOutlineLoading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [processProgress, setProcessProgress] = useState({ current: 0, total: 0 })
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [previewStepId, setPreviewStepId] = useState<string | null>(null)
  const [autoCapture, setAutoCapture] = useState(false)
  const targetWindowRef = useRef<Window | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Auto-focus panel on mount so Ctrl+V works immediately
  useEffect(() => {
    setTimeout(() => panelRef.current?.focus(), 100)
  }, [])

  useEffect(() => {
    loadHelpSections()
    // Listen for paste events
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const blob = item.getAsFile()
          if (blob) addImageFromBlob(blob)
          return
        }
      }
    }
    document.addEventListener('paste', handlePaste)

    // Listen for Extension messages
    window.addEventListener('message', handleExtensionMessage)

    return () => {
      document.removeEventListener('paste', handlePaste)
      window.removeEventListener('message', handleExtensionMessage)
    }
  }, [])

  const loadHelpSections = async () => {
    try {
      const res = await api.get('/help/sections?lang=zh-TW')
      setHelpSections(res.data.map((s: any) => ({ id: s.id, title: s.title })))
    } catch (e) { console.error(e) }
  }

  // Add image from various sources
  const addImageFromBlob = useCallback((blob: Blob) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      addCapturedStep(dataUrl)
    }
    reader.readAsDataURL(blob)
  }, [])

  const addCapturedStep = useCallback((imageDataUrl: string, extra?: Partial<CapturedStep>) => {
    // Create thumbnail (resize to 160px width)
    const img = new window.Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const scale = 160 / img.width
      canvas.width = 160
      canvas.height = img.height * scale
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
      const thumbnail = canvas.toDataURL('image/jpeg', 0.6)

      const step: CapturedStep = {
        id: `s${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        imageDataUrl,
        thumbnail,
        note: '',
        isKeyStep: false,
        status: 'captured',
        ...extra
      }
      setSteps(prev => [...prev, step])
    }
    img.src = imageDataUrl
  }, [])

  // Handle Extension auto-capture messages
  const handleExtensionMessage = useCallback((e: MessageEvent) => {
    if (e.data?.type === 'TRAINING_CAPTURE') {
      addCapturedStep(e.data.screenshot, {
        pageUrl: e.data.url,
        pageTitle: e.data.title,
        elementInfo: e.data.element
      })
    }
  }, [])

  // File drop/select
  const handleFileInput = (files: FileList | null) => {
    if (!files) return
    Array.from(files).filter(f => f.type.startsWith('image/')).forEach(addImageFromBlob)
  }

  // Manual screenshot via Extension
  const captureCurrentTab = () => {
    // Send message to Extension to capture
    window.postMessage({ type: 'TRAINING_REQUEST_CAPTURE' }, '*')
  }

  // Step operations
  const removeStep = (id: string) => {
    setSteps(prev => prev.filter(s => s.id !== id))
    if (selectedStepId === id) setSelectedStepId(null)
  }

  const updateStepNote = (id: string, note: string) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, note } : s))
  }

  const toggleKeyStep = (id: string) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, isKeyStep: !s.isKeyStep } : s))
  }

  const moveStep = (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= steps.length) return
    const newSteps = [...steps]
    const [moved] = newSteps.splice(fromIdx, 1)
    newSteps.splice(toIdx, 0, moved)
    setSteps(newSteps)
  }

  const clearAll = () => {
    if (!confirm(`確定要清空所有 ${steps.length} 張截圖？`)) return
    setSteps([])
    setSelectedStepId(null)
  }

  // Generate outline from help section
  const generateOutline = async () => {
    if (!selectedSection) return
    try {
      setOutlineLoading(true)
      const res = await api.post('/training/ai/generate-outline', {
        help_section_id: selectedSection,
        system_url: targetUrl
      })
      setOutline(res.data.steps || [])
    } catch (e: any) { alert(e.response?.data?.error || '生成大綱失敗') }
    finally { setOutlineLoading(false) }
  }

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [extensionConnected, setExtensionConnected] = useState(false)

  // Check if Extension is available — multiple detection methods
  useEffect(() => {
    let found = false

    const markConnected = () => {
      if (!found) { found = true; setExtensionConnected(true) }
    }

    const handleMessage = (e: MessageEvent) => {
      // Method 1: content script PONG
      if (e.data?.type === 'FOXLINK_TRAINING_PONG') markConnected()
      // Extension stopped from popup → auto-pull
      if (e.data?.type === 'FOXLINK_TRAINING_STOPPED' && e.data.sessionId) {
        markConnected()
        setSessionId(e.data.sessionId)
        stopExtensionRecording()
      }
      // Extension sends captured screenshots (live relay — bonus, not critical)
      if (e.data?.type === 'TRAINING_CAPTURE') {
        markConnected()
        addCapturedStep(e.data.screenshot, {
          pageUrl: e.data.url,
          pageTitle: e.data.title,
          elementInfo: e.data.element
        })
      }
    }
    window.addEventListener('message', handleMessage)

    // Method 2: check if chrome.runtime.sendMessage is available (Extension context)
    try {
      if ((window as any).chrome?.runtime?.sendMessage) {
        (window as any).chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res: any) => {
          if (res) markConnected()
        })
      }
    } catch {}

    // Method 3: ping via postMessage every 2s
    const ping = () => { if (!found) window.postMessage({ type: 'FOXLINK_TRAINING_PING' }, '*') }
    ping()
    const interval = setInterval(ping, 2000)

    return () => {
      window.removeEventListener('message', handleMessage)
      clearInterval(interval)
    }
  }, [])

  const [serverStepCount, setServerStepCount] = useState(0)
  const [pulling, setPulling] = useState(false)
  const sessionIdRef = useRef<string | null>(null)

  // Start Extension recording — creates session + notifies Extension
  const startExtensionRecording = async () => {
    try {
      const res = await api.post('/training/recording/start', {
        course_id: courseId, lesson_id: lessonId,
        config: { target_url: targetUrl }
      })
      const sid = res.data.session_id
      setSessionId(sid)
      sessionIdRef.current = sid
      setRecording(true)
      setServerStepCount(0)
      // Notify Extension via postMessage (content script on this page picks it up)
      window.postMessage({ type: 'FOXLINK_TRAINING_START', sessionId: sid }, '*')
    } catch (e: any) { alert(e.response?.data?.error || '建立錄製階段失敗') }
  }

  // Poll server for step count during recording
  useEffect(() => {
    if (!recording || !sessionIdRef.current) return
    const sid = sessionIdRef.current
    const poll = async () => {
      try {
        const res = await api.get(`/training/recording/${sid}`)
        setServerStepCount(res.data.steps_count || res.data.steps?.length || 0)
      } catch {}
    }
    poll()
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [recording, sessionId])

  // Pull screenshots from server → load into panel
  const pullFromServer = async (sid?: string) => {
    const targetSid = sid || sessionIdRef.current || sessionId
    if (!targetSid) { alert('無 Session ID，請先開始錄製'); return }
    try {
      setPulling(true)
      await new Promise(r => setTimeout(r, 1000))
      const res = await api.get(`/training/recording/${targetSid}`)
      const serverSteps = res.data.steps || []

      const pulled: CapturedStep[] = serverSteps
        .filter((s: any) => s.screenshot_url)
        .map((s: any) => ({
          id: `server_${s.id}`,
          imageDataUrl: s.screenshot_url,
          thumbnail: s.screenshot_url,
          note: s.ai_instruction || s.page_title || '',
          isKeyStep: s.action_type === 'click' || s.action_type === 'key_action',
          pageUrl: s.page_url,
          pageTitle: s.page_title,
          elementInfo: s.element_json ? (() => { try { return JSON.parse(s.element_json) } catch { return null } })() : null,
          status: 'captured' as const
        }))
      setSteps(pulled)
      setServerStepCount(pulled.length)
    } catch (e) { console.error('Pull screenshots failed:', e); alert('拉取截圖失敗') }
    finally { setPulling(false) }
  }

  const stopExtensionRecording = async () => {
    setRecording(false)
    window.postMessage({ type: 'FOXLINK_TRAINING_STOP' }, '*')
    await pullFromServer()
  }

  // Open target window
  const openTarget = () => {
    targetWindowRef.current = window.open(targetUrl, 'training_target', 'width=1280,height=900')
  }

  // Process all: upload + AI analyze + generate slides
  const processAll = async () => {
    if (steps.length === 0) return
    try {
      setProcessing(true)
      setProcessProgress({ current: 0, total: steps.length })

      // 1. Create recording session
      const sessionRes = await api.post('/training/recording/start', {
        course_id: courseId,
        lesson_id: lessonId,
        config: { target_url: targetUrl, auto_capture: autoCapture }
      })
      const sessionId = sessionRes.data.session_id

      // 2. Upload all steps
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        setProcessProgress({ current: i + 1, total: steps.length })
        setSteps(prev => prev.map(s => s.id === step.id ? { ...s, status: 'uploading' } : s))

        try {
          await api.post(`/training/recording/${sessionId}/step`, {
            step_number: i + 1,
            action_type: step.isKeyStep ? 'key_action' : 'screenshot',
            screenshot_base64: step.imageDataUrl,
            element_info: step.elementInfo || null,
            page_url: step.pageUrl || targetUrl,
            page_title: step.pageTitle || step.note || `步驟 ${i + 1}`
          })
          setSteps(prev => prev.map(s => s.id === step.id ? { ...s, status: 'analyzing' } : s))
        } catch {
          setSteps(prev => prev.map(s => s.id === step.id ? { ...s, status: 'error' } : s))
        }
      }

      // 3. Complete & AI analyze
      await api.post(`/training/recording/${sessionId}/complete`)
      await api.post(`/training/recording/${sessionId}/analyze`)

      // 4. Generate slides
      const genRes = await api.post(`/training/recording/${sessionId}/generate`)

      setSteps(prev => prev.map(s => ({ ...s, status: 'done' })))
      setTimeout(() => onComplete(genRes.data), 500)
    } catch (e: any) {
      alert(e.response?.data?.error || '處理失敗')
    } finally { setProcessing(false) }
  }

  const selectedStep = steps.find(s => s.id === selectedStepId)
  const previewStep = steps.find(s => s.id === previewStepId)

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div ref={panelRef} tabIndex={-1}
        className="rounded-xl border w-[900px] max-h-[90vh] flex flex-col outline-none"
        style={{ backgroundColor: 'var(--t-bg-card)', borderColor: 'var(--t-border)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--t-border)' }}>
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--t-text)' }}>
            <Camera size={14} style={{ color: 'var(--t-accent)' }} />
            AI 輔助錄製
            <span className="text-[10px] px-2 py-0.5 rounded-full font-normal"
              style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}>
              已截 {steps.length} 張
            </span>
          </h3>
          <button onClick={onClose} style={{ color: 'var(--t-text-muted)' }}><X size={16} /></button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Setup + Outline */}
          <div className="w-64 border-r overflow-y-auto p-3 space-y-3 shrink-0" style={{ borderColor: 'var(--t-border)' }}>
            {/* Help section */}
            <div>
              <label className="text-[10px] font-medium mb-1 block" style={{ color: 'var(--t-text-dim)' }}>來源章節</label>
              <select value={selectedSection} onChange={e => setSelectedSection(e.target.value)}
                className="w-full border rounded px-2 py-1 text-[10px]"
                style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}>
                <option value="">-- 選填 --</option>
                {helpSections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              {selectedSection && (
                <button onClick={generateOutline} disabled={outlineLoading}
                  className="mt-1 w-full text-[10px] py-1 rounded transition disabled:opacity-50"
                  style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}>
                  <Wand2 size={10} className="inline mr-1" /> {outlineLoading ? '生成中...' : 'AI 生成大綱'}
                </button>
              )}
            </div>

            {/* Outline */}
            {outline.length > 0 && (
              <div className="space-y-0.5">
                <div className="text-[10px] font-medium" style={{ color: 'var(--t-text-dim)' }}>操作大綱 ({outline.length} 步)</div>
                {outline.map((s: any, i: number) => (
                  <div key={i} className="text-[10px] flex gap-1 py-0.5" style={{ color: 'var(--t-text-secondary)' }}>
                    <span style={{ color: 'var(--t-text-dim)' }}>{s.order}.</span>
                    <span>{s.instruction}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Target URL */}
            <div>
              <label className="text-[10px] font-medium mb-1 block" style={{ color: 'var(--t-text-dim)' }}>目標 URL</label>
              <div className="flex gap-1">
                <input value={targetUrl} onChange={e => setTargetUrl(e.target.value)}
                  className="flex-1 border rounded px-2 py-1 text-[10px]"
                  style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }} />
                <button onClick={openTarget} className="px-1.5 rounded border" style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-muted)' }}>
                  <ExternalLink size={10} />
                </button>
              </div>
            </div>

            {/* Capture buttons */}
            <div className="space-y-1.5 pt-2 border-t" style={{ borderColor: 'var(--t-border)' }}>

              {/* Extension auto-recording */}
              {extensionConnected && (
                <div className="rounded-lg p-2 text-[10px] space-y-1.5" style={{ backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}>
                  <div className="font-semibold text-green-500 flex items-center gap-1">✓ Chrome Extension 已連線</div>
                  {!recording ? (
                    <button onClick={startExtensionRecording}
                      className="w-full py-1.5 rounded-lg text-white text-[10px] font-medium bg-green-600 hover:bg-green-500 transition">
                      ▶ 開始自動錄製
                    </button>
                  ) : (
                    <button onClick={stopExtensionRecording}
                      className="w-full py-1.5 rounded-lg text-white text-[10px] font-medium bg-red-600 hover:bg-red-500 transition flex items-center justify-center gap-1">
                      <Square size={10} /> 停止錄製
                    </button>
                  )}
                  <div style={{ color: 'var(--t-text-dim)' }}>
                    {recording ? (
                      <div className="space-y-1">
                        <div>切到目標視窗操作，每次 click 自動截圖上傳</div>
                        <div className="flex items-center gap-2 mt-1" style={{ color: 'var(--t-text-secondary)' }}>
                          <span className="text-lg font-bold" style={{ color: 'var(--t-accent)' }}>{serverStepCount}</span>
                          <span>張截圖已上傳到 server</span>
                          <Loader2 size={10} className="animate-spin" />
                        </div>
                      </div>
                    ) : pulling ? (
                      <div className="flex items-center gap-2">
                        <Loader2 size={10} className="animate-spin" /> 從 server 載入截圖...
                      </div>
                    ) : (
                      '點擊開始後，到目標系統操作即可'
                    )}
                  </div>
                  {/* Manual pull button */}
                  {!recording && sessionIdRef.current && steps.length === 0 && !pulling && (
                    <button onClick={() => pullFromServer()}
                      className="w-full mt-1 py-1 rounded text-[10px] transition"
                      style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}>
                      📥 手動拉取截圖
                    </button>
                  )}
                </div>
              )}

              {/* Manual Session ID input (fallback) */}
              {!recording && !sessionIdRef.current && (
                <div className="rounded-lg p-2 text-[10px] space-y-1.5 border" style={{ borderColor: 'var(--t-border)' }}>
                  <div className="font-medium" style={{ color: 'var(--t-text-dim)' }}>手動輸入 Session ID（從 Extension 取得）</div>
                  <div className="flex gap-1">
                    <input
                      placeholder="Session ID"
                      className="flex-1 border rounded px-2 py-1 text-[10px]"
                      style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          const val = (e.target as HTMLInputElement).value.trim()
                          if (val) { setSessionId(val); sessionIdRef.current = val; pullFromServer(val) }
                        }
                      }}
                    />
                    <button onClick={() => {
                      const input = document.querySelector('input[placeholder="Session ID"]') as HTMLInputElement
                      const val = input?.value?.trim()
                      if (val) { setSessionId(val); sessionIdRef.current = val; pullFromServer(val) }
                    }}
                      className="px-2 py-1 rounded text-white text-[10px]"
                      style={{ backgroundColor: 'var(--t-accent-bg)' }}>
                      拉取
                    </button>
                  </div>
                </div>
              )}

              {/* Manual capture instructions */}
              <div className="rounded-lg p-2 text-[10px] space-y-1.5" style={{ backgroundColor: 'var(--t-accent-subtle)', color: 'var(--t-accent)' }}>
                <div className="font-semibold">📸 {extensionConnected ? '手動截圖（備用）' : '截圖方式'}</div>
                <div style={{ color: 'var(--t-text-secondary)' }}>
                  <div>1. 到目標視窗按 <kbd className="px-1 py-0.5 rounded text-[9px]" style={{ backgroundColor: 'var(--t-bg)', border: '1px solid var(--t-border)' }}>Win+Shift+S</kbd> 截圖</div>
                  <div>2. 切回此面板按 <kbd className="px-1 py-0.5 rounded text-[9px]" style={{ backgroundColor: 'var(--t-bg)', border: '1px solid var(--t-border)' }}>Ctrl+V</kbd> 貼上</div>
                  {!extensionConnected && (
                    <div className="text-[9px] mt-1 space-y-0.5" style={{ color: 'var(--t-text-dim)' }}>
                      <div>安裝 Chrome Extension 可自動截圖（無需手動切換視窗）</div>
                      <div>⚠ 若已安裝 Extension 但未偵測到，請<button
                        onClick={() => window.location.reload()}
                        className="underline hover:opacity-80"
                        style={{ color: 'var(--t-accent)' }}>重新整理頁面</button></div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-1.5">
                <label className="flex-1 flex items-center justify-center gap-1.5 text-[10px] py-2 rounded-lg border cursor-pointer transition hover:opacity-80"
                  style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-muted)' }}>
                  <Plus size={11} /> 選擇圖片檔
                  <input type="file" accept="image/*" multiple className="hidden"
                    onChange={e => handleFileInput(e.target.files)} />
                </label>
              </div>

              <div
                className="border-2 border-dashed rounded-lg py-4 text-center cursor-pointer transition hover:opacity-80"
                style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-dim)' }}
                onClick={() => panelRef.current?.focus()}
                onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
                onDrop={e => {
                  e.preventDefault(); e.stopPropagation()
                  handleFileInput(e.dataTransfer.files)
                }}
              >
                <ClipboardPaste size={16} className="mx-auto mb-1" />
                <div className="text-[10px]">Ctrl+V 貼上截圖</div>
                <div className="text-[9px]">或拖放圖片到此處</div>
              </div>
            </div>
          </div>

          {/* Center: Screenshot gallery */}
          <div className="flex-1 overflow-y-auto p-3">
            {steps.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--t-text-dim)' }}>
                <Image size={40} className="mb-3 opacity-30" />
                <p className="text-sm">開始截圖或貼上圖片</p>
                <p className="text-[10px] mt-1 opacity-60">截圖會暫存在這裡，完成後一鍵送 AI 處理</p>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {steps.map((step, idx) => (
                  <div key={step.id}
                    onClick={() => setSelectedStepId(step.id)}
                    className={`relative rounded-lg border overflow-hidden cursor-pointer transition group ${
                      selectedStepId === step.id ? 'ring-2' : ''
                    }`}
                    style={{
                      borderColor: selectedStepId === step.id ? 'var(--t-accent)' : 'var(--t-border)',
                      ringColor: 'var(--t-accent)'
                    }}>
                    {/* Thumbnail */}
                    <img src={step.thumbnail} alt="" className="w-full aspect-video object-cover" />

                    {/* Step number */}
                    <div className="absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--t-bg)', color: 'var(--t-text-muted)' }}>
                      #{idx + 1}
                    </div>

                    {/* Key step star */}
                    {step.isKeyStep && (
                      <Star size={12} className="absolute top-1 right-1 text-yellow-400 fill-yellow-400" />
                    )}

                    {/* Status badge */}
                    {step.status !== 'captured' && (
                      <div className="absolute bottom-1 right-1 text-[8px] px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--t-bg)' }}>
                        {step.status === 'uploading' && <Loader2 size={8} className="inline animate-spin" style={{ color: 'var(--t-accent)' }} />}
                        {step.status === 'analyzing' && <Wand2 size={8} className="inline animate-pulse" style={{ color: 'var(--t-accent)' }} />}
                        {step.status === 'done' && <CheckCircle2 size={8} className="inline text-green-500" />}
                        {step.status === 'error' && <AlertCircle size={8} className="inline text-red-400" />}
                      </div>
                    )}

                    {/* Hover actions */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                      <button onClick={e => { e.stopPropagation(); setPreviewStepId(step.id) }}
                        className="p-1.5 rounded-full bg-white/20 text-white hover:bg-white/30">
                        <Eye size={12} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); toggleKeyStep(step.id) }}
                        className="p-1.5 rounded-full bg-white/20 text-white hover:bg-white/30">
                        <Star size={12} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); removeStep(step.id) }}
                        className="p-1.5 rounded-full bg-white/20 text-white hover:bg-red-500/50">
                        <Trash2 size={12} />
                      </button>
                    </div>

                    {/* Note preview */}
                    {step.note && (
                      <div className="absolute bottom-0 left-0 right-0 text-[8px] px-1.5 py-0.5 truncate"
                        style={{ backgroundColor: 'var(--t-bg)', color: 'var(--t-text-dim)' }}>
                        {step.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Selected step details */}
          {selectedStep && (
            <div className="w-56 border-l overflow-y-auto p-3 space-y-3 shrink-0" style={{ borderColor: 'var(--t-border)' }}>
              <div className="text-xs font-medium" style={{ color: 'var(--t-text-secondary)' }}>
                步驟 #{steps.indexOf(selectedStep) + 1}
              </div>

              <img src={selectedStep.thumbnail} alt="" className="w-full rounded border" style={{ borderColor: 'var(--t-border)' }} />

              <div>
                <label className="text-[10px] mb-1 block" style={{ color: 'var(--t-text-dim)' }}>備註 / 操作說明</label>
                <textarea
                  value={selectedStep.note}
                  onChange={e => updateStepNote(selectedStep.id, e.target.value)}
                  rows={3}
                  className="w-full border rounded px-2 py-1 text-[10px] resize-none focus:outline-none"
                  style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
                  placeholder="AI 會參考此備註生成操作說明..."
                />
              </div>

              <label className="flex items-center gap-1.5 text-[10px] cursor-pointer" style={{ color: 'var(--t-text-secondary)' }}>
                <input type="checkbox" checked={selectedStep.isKeyStep}
                  onChange={() => toggleKeyStep(selectedStep.id)} className="rounded" />
                <Star size={10} className="text-yellow-400" /> 重點步驟（互動 hotspot）
              </label>

              <div className="flex gap-1.5">
                <button onClick={() => moveStep(steps.indexOf(selectedStep), steps.indexOf(selectedStep) - 1)}
                  disabled={steps.indexOf(selectedStep) === 0}
                  className="flex-1 text-[10px] py-1 rounded border disabled:opacity-30"
                  style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-muted)' }}>
                  ↑ 上移
                </button>
                <button onClick={() => moveStep(steps.indexOf(selectedStep), steps.indexOf(selectedStep) + 1)}
                  disabled={steps.indexOf(selectedStep) === steps.length - 1}
                  className="flex-1 text-[10px] py-1 rounded border disabled:opacity-30"
                  style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-muted)' }}>
                  ↓ 下移
                </button>
              </div>

              <button onClick={() => removeStep(selectedStep.id)}
                className="w-full text-[10px] py-1 rounded text-red-400 border border-red-400/30 hover:bg-red-500/10">
                <Trash2 size={10} className="inline mr-1" /> 刪除此截圖
              </button>
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div className="border-t px-4 py-3 flex items-center gap-3 shrink-0" style={{ borderColor: 'var(--t-border)' }}>
          {!processing ? (
            <>
              <button onClick={processAll} disabled={steps.length === 0}
                className="flex items-center gap-1.5 text-white px-4 py-2 rounded-lg text-xs font-medium transition disabled:opacity-40"
                style={{ backgroundColor: 'var(--t-accent-bg)' }}>
                <Wand2 size={14} /> 全部送 AI 處理 ({steps.length} 張)
              </button>
              {steps.length > 0 && (
                <button onClick={clearAll} className="text-xs text-red-400 hover:text-red-300">
                  <Trash2 size={12} className="inline mr-1" /> 清空
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Loader2 size={14} className="animate-spin" style={{ color: 'var(--t-accent)' }} />
              <span className="text-xs" style={{ color: 'var(--t-text-muted)' }}>
                處理中 {processProgress.current}/{processProgress.total}...
              </span>
              <div className="w-32 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--t-border)' }}>
                <div className="h-full rounded-full transition-all" style={{
                  backgroundColor: 'var(--t-accent)',
                  width: `${(processProgress.current / processProgress.total) * 100}%`
                }} />
              </div>
            </div>
          )}
          <div className="flex-1" />
          <span className="text-[9px]" style={{ color: 'var(--t-text-dim)' }}>
            💡 Ctrl+V 貼上 | 拖放圖片 | Chrome Extension 自動截圖
          </span>
        </div>
      </div>

      {/* Full preview overlay */}
      {previewStep && (
        <div className="fixed inset-0 z-60 bg-black/80 flex items-center justify-center cursor-pointer"
          onClick={() => setPreviewStepId(null)}>
          <img src={previewStep.imageDataUrl} alt="" className="max-w-[90vw] max-h-[90vh] rounded-lg" />
          <button className="absolute top-4 right-4 text-white/80 hover:text-white" onClick={() => setPreviewStepId(null)}>
            <X size={24} />
          </button>
        </div>
      )}
    </div>
  )
}
