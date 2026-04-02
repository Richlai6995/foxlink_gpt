import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../../lib/api'
import { ArrowLeft, Clock, CheckCircle2, XCircle, ChevronRight, ChevronLeft, BarChart3 } from 'lucide-react'

interface Question {
  id: number
  question_type: string
  question_json: string
  answer_json: string
  scoring_json: string | null
  points: number
  explanation: string | null
}

interface ParsedQ {
  id: number
  type: string
  points: number
  explanation: string | null
  question: any
  answer: any
  scoring: any
}

export default function QuizPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [course, setCourse] = useState<any>(null)
  const [questions, setQuestions] = useState<ParsedQ[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<number, any>>({})
  const [submitted, setSubmitted] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const timerRef = useRef<any>(null)

  useEffect(() => {
    loadQuiz()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [id])

  const loadQuiz = async () => {
    try {
      const [courseRes, qRes] = await Promise.all([
        api.get(`/training/courses/${id}`),
        api.get(`/training/courses/${id}/questions`)
      ])
      setCourse(courseRes.data)
      const parsed: ParsedQ[] = qRes.data.map((q: Question) => ({
        id: q.id,
        type: q.question_type,
        points: q.points,
        explanation: q.explanation,
        question: JSON.parse(q.question_json),
        answer: JSON.parse(q.answer_json),
        scoring: q.scoring_json ? JSON.parse(q.scoring_json) : null
      }))
      setQuestions(parsed)

      // Start timer if time limit
      if (courseRes.data.time_limit_minutes) {
        setTimeLeft(courseRes.data.time_limit_minutes * 60)
        timerRef.current = setInterval(() => {
          setTimeLeft(prev => {
            if (prev !== null && prev <= 1) { clearInterval(timerRef.current); handleSubmit(); return 0 }
            return prev ? prev - 1 : null
          })
        }, 1000)
      }

      // Create attempt
      await api.post(`/training/courses/${id}/quiz/start`).catch(() => {})
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const setAnswer = (qId: number, value: any) => {
    setAnswers(prev => ({ ...prev, [qId]: value }))
  }

  const handleSubmit = async () => {
    if (timerRef.current) clearInterval(timerRef.current)
    try {
      const res = await api.post(`/training/courses/${id}/quiz/submit`, { answers })
      setResult(res.data)
      setSubmitted(true)
    } catch (e: any) {
      alert(e.response?.data?.error || '提交失敗')
    }
  }

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  if (loading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-500">載入中...</div>

  const q = questions[currentIdx]
  const totalPoints = questions.reduce((s, q) => s + q.points, 0)

  // Result view
  if (submitted && result) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-8">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 max-w-md w-full text-center space-y-4">
          <div className={`text-5xl font-bold ${result.passed ? 'text-green-400' : 'text-red-400'}`}>
            {result.score} <span className="text-lg text-slate-400">/ {result.total_points}</span>
          </div>
          <div className={`text-lg font-semibold ${result.passed ? 'text-green-400' : 'text-red-400'}`}>
            {result.passed ? '✓ 通過' : '✗ 未通過'}
          </div>
          <div className="text-xs text-slate-500">
            及格標準: {course?.pass_score || 60} 分 | 正確率: {Math.round((result.score / result.total_points) * 100)}%
          </div>
          <div className="flex gap-3 justify-center pt-4">
            <button onClick={() => navigate(`/training/course/${id}`)}
              className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm transition">
              返回課程
            </button>
            {!result.passed && (
              <button onClick={() => { setSubmitted(false); setResult(null); setAnswers({}); setCurrentIdx(0) }}
                className="bg-sky-600 hover:bg-sky-500 px-4 py-2 rounded-lg text-sm transition">
                重新測驗
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-2 flex items-center gap-3 shrink-0">
        <button onClick={() => navigate(`/training/course/${id}`)} className="text-slate-400 hover:text-slate-200">
          <ArrowLeft size={18} />
        </button>
        <span className="text-sm font-medium">{course?.title} — 測驗</span>
        <div className="flex-1" />
        {timeLeft !== null && (
          <span className={`text-sm font-mono ${timeLeft < 60 ? 'text-red-400 animate-pulse' : 'text-slate-400'}`}>
            <Clock size={14} className="inline mr-1" /> {formatTime(timeLeft)}
          </span>
        )}
        <span className="text-xs text-slate-500">{currentIdx + 1} / {questions.length}</span>
      </div>

      {/* Question nav dots */}
      <div className="bg-slate-850 px-4 py-2 flex gap-1.5 flex-wrap">
        {questions.map((_, i) => (
          <button key={i} onClick={() => setCurrentIdx(i)}
            className={`w-7 h-7 rounded-full text-[10px] font-bold transition ${
              i === currentIdx ? 'bg-sky-600 text-white' :
              answers[questions[i].id] !== undefined ? 'bg-green-600/30 text-green-400' :
              'bg-slate-700 text-slate-400 hover:bg-slate-600'
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* Question content */}
      <div className="flex-1 overflow-y-auto p-6 flex items-start justify-center">
        {q && (
          <div className="max-w-2xl w-full space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">第 {currentIdx + 1} 題（{q.points} 分）</span>
              <span className="text-[10px] text-slate-600">{q.type}</span>
            </div>

            <p className="text-sm font-medium">{q.question.text}</p>
            {q.question.image && <img src={q.question.image} alt="" className="max-w-full rounded-lg" />}

            {/* Single/Multi choice */}
            {(q.type === 'single_choice' || q.type === 'multi_choice') && (
              <div className="space-y-1.5">
                {(q.question.options || []).map((opt: string, oi: number) => {
                  const sel = answers[q.id]
                  const isSelected = q.type === 'single_choice' ? sel === oi : (sel || []).includes(oi)
                  return (
                    <button key={oi}
                      onClick={() => {
                        if (q.type === 'single_choice') {
                          setAnswer(q.id, oi)
                        } else {
                          const prev: number[] = answers[q.id] || []
                          setAnswer(q.id, prev.includes(oi) ? prev.filter((x: number) => x !== oi) : [...prev, oi])
                        }
                      }}
                      className={`w-full text-left flex items-center gap-3 px-4 py-2.5 rounded-lg border transition ${
                        isSelected ? 'border-sky-500 bg-sky-500/10' : 'border-slate-700 hover:border-slate-600'
                      }`}
                    >
                      <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] ${
                        isSelected ? 'border-sky-400 bg-sky-400/20' : 'border-slate-600'
                      }`}>{isSelected && '●'}</span>
                      <span className="text-sm">{opt}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Fill blank */}
            {q.type === 'fill_blank' && (
              <input
                value={answers[q.id] || ''}
                onChange={e => setAnswer(q.id, e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-sky-500"
                placeholder="輸入答案..."
              />
            )}

            {/* Matching */}
            {q.type === 'matching' && (
              <div className="space-y-2">
                {(q.question.items || []).map((item: string, mi: number) => (
                  <div key={mi} className="flex items-center gap-3">
                    <span className="text-sm w-1/3">{item}</span>
                    <span className="text-slate-600">→</span>
                    <select
                      value={(answers[q.id] || {})[mi] ?? ''}
                      onChange={e => setAnswer(q.id, { ...(answers[q.id] || {}), [mi]: Number(e.target.value) })}
                      className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm"
                    >
                      <option value="">-- 選擇 --</option>
                      {(q.question.targets || []).map((t: string, ti: number) => (
                        <option key={ti} value={ti}>{t}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            {/* Ordering */}
            {q.type === 'ordering' && (
              <div className="text-xs text-slate-500">
                <p className="mb-2">請用數字輸入正確順序（如 2,0,1,3）：</p>
                <input
                  value={answers[q.id] || ''}
                  onChange={e => setAnswer(q.id, e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
                  placeholder="0,1,2,3"
                />
                <div className="mt-2 space-y-1">
                  {(q.question.items || []).map((item: string, idx: number) => (
                    <div key={idx} className="text-slate-400">#{idx}: {item}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="bg-slate-800 border-t border-slate-700 px-4 py-3 flex items-center gap-3 shrink-0">
        <button onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))} disabled={currentIdx === 0}
          className="text-slate-400 hover:text-slate-200 disabled:opacity-30">
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1" />
        {currentIdx < questions.length - 1 ? (
          <button onClick={() => setCurrentIdx(currentIdx + 1)}
            className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 px-4 py-1.5 rounded-lg text-sm transition">
            下一題 <ChevronRight size={16} />
          </button>
        ) : (
          <button onClick={() => {
            if (confirm(`確定要提交？已作答 ${Object.keys(answers).length}/${questions.length} 題`)) handleSubmit()
          }}
            className="bg-sky-600 hover:bg-sky-500 text-white px-6 py-2 rounded-lg text-sm font-semibold transition">
            提交測驗
          </button>
        )}
      </div>
    </div>
  )
}
