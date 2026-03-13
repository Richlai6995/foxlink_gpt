import { useState, useRef } from 'react'
import {
  X, Search, GripVertical, Plus, Trash2, ChevronRight,
  Globe, Database, Loader2, CheckCircle, AlertCircle,
} from 'lucide-react'
import api from '../lib/api'

interface SubQuestion { id: number; question: string }
interface Plan {
  title: string
  objective: string
  language: string
  sub_questions: SubQuestion[]
}

interface Props {
  sessionId: string | null
  onClose: () => void
  onJobCreated: (jobId: string) => void
}

const FORMAT_OPTIONS = [
  { value: 'docx', label: 'Word' },
  { value: 'pdf',  label: 'PDF'  },
  { value: 'pptx', label: 'PPT'  },
  { value: 'xlsx', label: 'Excel'},
]

export default function ResearchModal({ sessionId, onClose, onJobCreated }: Props) {
  // Step 1: question + options
  const [question,   setQuestion]   = useState('')
  const [depth,      setDepth]      = useState(5)
  const [formats,    setFormats]    = useState<string[]>(['docx'])
  const [generating, setGenerating] = useState(false)
  const [genError,   setGenError]   = useState('')

  // Step 2: plan review
  const [plan,       setPlan]       = useState<Plan | null>(null)
  const [hasKb,      setHasKb]      = useState(false)
  const [starting,   setStarting]   = useState(false)
  const [startError, setStartError] = useState('')

  // Step 3: started
  const [jobId,      setJobId]      = useState<string | null>(null)

  const step = jobId ? 3 : plan ? 2 : 1

  // ── Drag-to-sort state ──────────────────────────────────────────────────────
  const dragIdx     = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const moveItem = (from: number, to: number) => {
    if (!plan || from === to) return
    const sqs = [...plan.sub_questions]
    const [item] = sqs.splice(from, 1)
    sqs.splice(to, 0, item)
    setPlan({ ...plan, sub_questions: sqs })
  }

  const toggleFormat = (fmt: string) => {
    setFormats((prev) =>
      prev.includes(fmt) ? (prev.length > 1 ? prev.filter((f) => f !== fmt) : prev) : [...prev, fmt]
    )
  }

  // ── Step 1: generate plan ───────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!question.trim()) { setGenError('請輸入研究問題'); return }
    setGenerating(true); setGenError('')
    try {
      const res = await api.post('/research/plan', { question: question.trim(), depth })
      setPlan(res.data.plan)
      setHasKb(res.data.has_kb)
    } catch (e: any) {
      setGenError(e.response?.data?.error || '計畫生成失敗，請稍後再試')
    } finally {
      setGenerating(false)
    }
  }

  // ── Step 2: start job ───────────────────────────────────────────────────────
  const handleStart = async () => {
    if (!plan) return
    setStarting(true); setStartError('')
    try {
      const res = await api.post('/research/jobs', {
        question:       question.trim(),
        plan:           plan,
        session_id:     sessionId,
        output_formats: formats.join(','),
        use_web_search: !hasKb, // web search only if no KB data
      })
      setJobId(res.data.id)
      onJobCreated(res.data.id)
    } catch (e: any) {
      setStartError(e.response?.data?.error || '無法啟動研究，請稍後再試')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Search size={18} className="text-blue-500" />
            <span className="font-semibold text-slate-800">深度研究</span>
            <span className="text-xs text-slate-400 ml-1">
              {step === 1 && '設定問題'} {step === 2 && '確認計畫'} {step === 3 && '研究已啟動'}
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5">
          {/* ── Step 1 ─────────────────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">研究問題</label>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate() }}
                  rows={3}
                  placeholder="請輸入您想深入研究的問題或主題，例如：「台灣半導體產業的未來發展趨勢與挑戰」"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  研究深度：<span className="text-blue-600 font-semibold">{depth} 個子問題</span>
                </label>
                <input
                  type="range" min={2} max={8} value={depth}
                  onChange={(e) => setDepth(Number(e.target.value))}
                  className="w-full accent-blue-600"
                />
                <div className="flex justify-between text-xs text-slate-400 mt-1">
                  <span>快速（2）</span><span>標準（5）</span><span>深入（8）</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">輸出格式</label>
                <div className="flex flex-wrap gap-2">
                  {FORMAT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => toggleFormat(opt.value)}
                      className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                        formats.includes(opt.value)
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'text-slate-600 border-slate-300 hover:border-blue-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {genError && (
                <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle size={14} /> {genError}
                </div>
              )}
            </div>
          )}

          {/* ── Step 2 ─────────────────────────────────────────────────────── */}
          {step === 2 && plan && (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-xl p-4 space-y-1.5">
                <p className="text-xs text-slate-500 uppercase tracking-wide">研究主題</p>
                <p className="text-base font-semibold text-slate-800">{plan.title}</p>
                <p className="text-sm text-slate-500">{plan.objective}</p>
              </div>

              {/* Web search indicator */}
              <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
                hasKb
                  ? 'bg-green-50 border border-green-200 text-green-700'
                  : 'bg-blue-50 border border-blue-200 text-blue-700'
              }`}>
                {hasKb
                  ? <><Database size={13} />將優先使用您的知識庫資料進行研究</>
                  : <><Globe size={13} />將使用 Google 搜尋進行網路研究</>
                }
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-700">研究子問題（可拖曳排序）</p>
                  <button
                    onClick={() => setPlan({
                      ...plan,
                      sub_questions: [...plan.sub_questions, { id: Date.now(), question: '' }],
                    })}
                    className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    <Plus size={13} /> 新增
                  </button>
                </div>
                <div className="space-y-2">
                  {plan.sub_questions.map((sq, i) => (
                    <div
                      key={sq.id}
                      draggable
                      onDragStart={() => { dragIdx.current = i }}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(i) }}
                      onDrop={() => {
                        if (dragIdx.current !== null) moveItem(dragIdx.current, i)
                        dragIdx.current = null; setDragOver(null)
                      }}
                      onDragEnd={() => { dragIdx.current = null; setDragOver(null) }}
                      className={`flex items-start gap-2 border rounded-xl p-3 bg-white transition ${
                        dragOver === i ? 'border-blue-400 bg-blue-50' : 'border-slate-200'
                      }`}
                    >
                      <GripVertical size={16} className="text-slate-300 mt-0.5 cursor-grab flex-shrink-0" />
                      <span className="text-xs font-semibold text-blue-500 mt-0.5 w-5 flex-shrink-0">{i + 1}</span>
                      <input
                        value={sq.question}
                        onChange={(e) => {
                          const sqs = [...plan.sub_questions]
                          sqs[i] = { ...sqs[i], question: e.target.value }
                          setPlan({ ...plan, sub_questions: sqs })
                        }}
                        className="flex-1 text-sm text-slate-700 outline-none bg-transparent"
                      />
                      {plan.sub_questions.length > 2 && (
                        <button
                          onClick={() => setPlan({ ...plan, sub_questions: plan.sub_questions.filter((_, j) => j !== i) })}
                          className="text-slate-300 hover:text-red-400 flex-shrink-0"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {startError && (
                <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle size={14} /> {startError}
                </div>
              )}
            </div>
          )}

          {/* ── Step 3 ─────────────────────────────────────────────────────── */}
          {step === 3 && (
            <div className="text-center py-8 space-y-4">
              <CheckCircle size={48} className="mx-auto text-green-500" />
              <div>
                <p className="text-base font-semibold text-slate-800">研究已在背景啟動</p>
                <p className="text-sm text-slate-500 mt-1">您可以繼續使用聊天，研究完成後會在頂部顯示通知。</p>
                <p className="text-sm text-slate-500 mt-1">研究進度也會顯示在對話中。</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center">
          {step === 1 && (
            <>
              <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">
                取消
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating || !question.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {generating
                  ? <><Loader2 size={15} className="animate-spin" /> 生成計畫中...</>
                  : <>生成研究計畫 <ChevronRight size={15} /></>
                }
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button
                onClick={() => setPlan(null)}
                className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2"
              >
                ← 修改問題
              </button>
              <button
                onClick={handleStart}
                disabled={starting || !plan || plan.sub_questions.some((sq) => !sq.question.trim())}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {starting
                  ? <><Loader2 size={15} className="animate-spin" /> 啟動中...</>
                  : <>確認並開始研究 <ChevronRight size={15} /></>
                }
              </button>
            </>
          )}
          {step === 3 && (
            <button
              onClick={onClose}
              className="ml-auto px-5 py-2 bg-slate-100 text-slate-700 text-sm rounded-xl hover:bg-slate-200 transition"
            >
              關閉
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
