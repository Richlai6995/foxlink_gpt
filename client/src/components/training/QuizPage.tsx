import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { ArrowLeft, Clock, CheckCircle2, XCircle, ChevronRight, ChevronLeft, Play, Lock, AlertTriangle, RotateCcw, Flag, ListOrdered } from 'lucide-react'

interface Question {
  id: number
  question_type: string
  question_json: string
  scoring_json: string | null
  points: number
  explanation: string | null
  lesson_id: number | null
}

interface ParsedQ {
  id: number
  type: string
  points: number
  explanation: string | null
  question: any
  scoring: any
  lesson_id: number | null
}

interface ChapterRow {
  lesson_id: number | null
  title: string
  question_count: number
  max_score: number
  status: 'not_started' | 'in_progress' | 'completed' | 'timeout'
  score: number | null
  passed: boolean
  elapsed_seconds: number | null
  completed_at: string | null
  is_suggested: boolean
  is_sequential_locked: boolean
}

interface Overview {
  course: { id: number; title: string; time_limit_minutes: number | null; pass_score: number | null; max_attempts: number | null; quiz_sequential: boolean }
  attempt: { id: number; attempt_number: number; completed_at: string | null; score: number | null; total_points: number | null; passed: boolean } | null
  total_seconds: number
  used_seconds: number
  remaining_seconds: number
  chapters: ChapterRow[]
  total_attempts: number
  next_suggested_lesson_id: number | null
  in_progress_lesson_id: number | null
  can_finalize: boolean
}

const formatTime = (s: number) => {
  if (s == null || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

const lessonKeyOf = (lid: number | null) => (lid == null ? 0 : lid)

export default function QuizPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()

  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeLesson, setActiveLesson] = useState<number | null | 'starting'>(null)
  const [questions, setQuestions] = useState<ParsedQ[]>([])
  const [answers, setAnswers] = useState<Record<number, any>>({})
  const [currentIdx, setCurrentIdx] = useState(0)
  const [chapterTimeLeft, setChapterTimeLeft] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [chapterResult, setChapterResult] = useState<any>(null)
  const [finalizing, setFinalizing] = useState(false)
  const timerRef = useRef<any>(null)

  useEffect(() => { loadOverview() }, [id])
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const loadOverview = async () => {
    setLoading(true)
    try {
      const res = await api.get(`/training/courses/${id}/quiz/overview`)
      setOverview(res.data)
    } catch (e: any) {
      alert(e.response?.data?.error || t('common.loadFailed', '載入失敗'))
    } finally { setLoading(false) }
  }

  const startChapter = async (lessonId: number | null) => {
    setActiveLesson('starting')
    setAnswers({}); setCurrentIdx(0); setChapterResult(null)
    try {
      const res = await api.post(`/training/courses/${id}/quiz/chapter/${lessonKeyOf(lessonId)}/start`)
      const data = res.data
      const parsed: ParsedQ[] = (data.questions || []).map((q: Question) => ({
        id: q.id,
        type: q.question_type,
        points: q.points,
        explanation: q.explanation,
        question: typeof q.question_json === 'string' ? JSON.parse(q.question_json) : q.question_json,
        scoring: q.scoring_json ? (typeof q.scoring_json === 'string' ? JSON.parse(q.scoring_json) : q.scoring_json) : null,
        lesson_id: q.lesson_id
      }))
      setQuestions(parsed)
      setActiveLesson(lessonId == null ? 0 : lessonId)
      const initialLeft = data.chapter_remaining_seconds ?? data.time_budget_seconds
      if (initialLeft != null) {
        setChapterTimeLeft(initialLeft)
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = setInterval(() => {
          setChapterTimeLeft(prev => {
            if (prev == null) return null
            if (prev <= 1) { clearInterval(timerRef.current); submitChapter(true); return 0 }
            return prev - 1
          })
        }, 1000)
      } else {
        setChapterTimeLeft(null)
      }
    } catch (e: any) {
      setActiveLesson(null)
      alert(e.response?.data?.error || t('training.quizStartFailed', '無法開始章節'))
      await loadOverview()
    }
  }

  const submitChapter = async (auto = false) => {
    if (submitting) return
    if (!auto) {
      const answered = Object.keys(answers).length
      if (!confirm(t('training.quizSubmitConfirm', '確定提交?已作答 {{a}}/{{n}} 題', { a: answered, n: questions.length }))) return
    }
    setSubmitting(true)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    try {
      const lessonId = activeLesson === 0 ? null : (activeLesson as number)
      const res = await api.post(`/training/courses/${id}/quiz/chapter/${lessonKeyOf(lessonId)}/submit`, { answers })
      setChapterResult(res.data)
    } catch (e: any) {
      alert(e.response?.data?.error || t('training.quizSubmitFailed', '提交失敗'))
    } finally { setSubmitting(false) }
  }

  const backToOverview = async () => {
    setActiveLesson(null); setQuestions([]); setAnswers({})
    setChapterResult(null); setChapterTimeLeft(null)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    await loadOverview()
  }

  const finalizeAttempt = async () => {
    if (!confirm(t('training.quizFinalizeConfirm', '確定結束本次測驗?未做完的章節將以 0 分計算,且時間將被扣到上限。'))) return
    setFinalizing(true)
    try {
      await api.post(`/training/courses/${id}/quiz/finalize`)
      await loadOverview()
    } catch (e: any) {
      alert(e.response?.data?.error || t('training.quizFinalizeFailed', '結算失敗'))
    } finally { setFinalizing(false) }
  }

  const setAnswer = (qId: number, value: any) => setAnswers(prev => ({ ...prev, [qId]: value }))

  if (loading) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-500">{t('common.loading', '載入中...')}</div>
  }

  // ── Chapter result view ─────────────────────────────────────
  if (chapterResult) {
    const finalized = chapterResult.finalized
    const passed = chapterResult.passed
    const chapterPercent = chapterResult.max_score > 0 ? Math.round((chapterResult.score / chapterResult.max_score) * 100) : 0
    const nextId = chapterResult.next_suggested_lesson_id
    const nextChapter = nextId != null ? overview?.chapters.find(c => lessonKeyOf(c.lesson_id) === lessonKeyOf(nextId)) : null
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-8">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 max-w-md w-full text-center space-y-4">
          {!finalized ? (
            <>
              {passed ? (
                <CheckCircle2 size={48} className="mx-auto text-green-400" />
              ) : (
                <XCircle size={48} className="mx-auto text-amber-400" />
              )}
              <div className="text-2xl font-bold">{t('training.quizChapterDone', '章節完成')}</div>
              <div className={`text-3xl font-bold ${passed ? 'text-green-400' : 'text-amber-400'}`}>
                {chapterResult.score} <span className="text-base text-slate-400">/ {chapterResult.max_score}</span>
              </div>
              <div className="text-xs text-slate-500">
                {t('training.quizChapterAccuracy', '正確率 {{p}}%', { p: chapterPercent })}
              </div>
              <div className={`text-xs font-semibold ${passed ? 'text-green-400' : 'text-amber-400'}`}>
                {passed ? t('training.quizChapterPassed', '✓ 章節通過') : t('training.quizChapterFailed', '✗ 章節未通過,可重做')}
              </div>
              {chapterResult.timed_out && (
                <div className="text-xs text-amber-400 flex items-center justify-center gap-1">
                  <AlertTriangle size={12} /> {t('training.quizChapterTimedOut', '本章節已超時')}
                </div>
              )}
              <div className="pt-3 space-y-2">
                {nextChapter ? (
                  <button onClick={async () => { await backToOverview(); await startChapter(nextChapter.lesson_id) }}
                    className="w-full bg-sky-600 hover:bg-sky-500 px-6 py-2 rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2">
                    <Play size={14} /> {t('training.quizGoNextChapter', '繼續下一章:{{title}}', { title: nextChapter.title })}
                  </button>
                ) : (
                  <button onClick={backToOverview}
                    className="w-full bg-sky-600 hover:bg-sky-500 px-6 py-2 rounded-lg text-sm font-semibold transition">
                    {t('training.quizContinueOther', '回章節列表')}
                  </button>
                )}
                <button onClick={backToOverview}
                  className="w-full bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-xs transition">
                  {t('training.quizPickAnother', '我要選別章')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={`text-5xl font-bold ${chapterResult.final?.passed ? 'text-green-400' : 'text-red-400'}`}>
                {chapterResult.final?.score} <span className="text-lg text-slate-400">/ {chapterResult.final?.total_points}</span>
              </div>
              <div className={`text-lg font-semibold ${chapterResult.final?.passed ? 'text-green-400' : 'text-red-400'}`}>
                {chapterResult.final?.passed ? t('training.quizPassed', '✓ 通過') : t('training.quizFailed', '✗ 未通過')}
              </div>
              <div className="text-xs text-slate-500">
                {t('training.quizFinalSummary', '本次章節得分 {{s}}/{{m}}', { s: chapterResult.score, m: chapterResult.max_score })}
              </div>
              <div className="flex gap-3 justify-center pt-4">
                <button onClick={() => navigate(`/training/course/${id}`)}
                  className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm transition">
                  {t('training.backToCourse', '返回課程')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── In-chapter quiz view ────────────────────────────────────
  if (activeLesson !== null && activeLesson !== 'starting') {
    const q = questions[currentIdx]
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
        <div className="bg-slate-800 border-b border-slate-700 px-4 py-2 flex items-center gap-3 shrink-0">
          <button onClick={() => {
            if (confirm(t('training.quizLeaveWarning', '離開此頁,本章 timer 仍會繼續扣!確定離開?')))
              backToOverview()
          }} className="text-slate-400 hover:text-slate-200">
            <ArrowLeft size={18} />
          </button>
          <span className="text-sm font-medium">{overview?.course?.title} — {t('training.quiz', '測驗')}</span>
          <div className="flex-1" />
          {chapterTimeLeft != null && (
            <span className={`text-sm font-mono ${chapterTimeLeft < 60 ? 'text-red-400 animate-pulse' : 'text-slate-400'}`}>
              <Clock size={14} className="inline mr-1" /> {formatTime(chapterTimeLeft)}
            </span>
          )}
          <span className="text-xs text-slate-500">{currentIdx + 1} / {questions.length}</span>
        </div>

        <div className="bg-slate-850 px-4 py-2 flex gap-1.5 flex-wrap">
          {questions.map((_, i) => (
            <button key={i} onClick={() => setCurrentIdx(i)}
              className={`w-7 h-7 rounded-full text-[10px] font-bold transition ${
                i === currentIdx ? 'bg-sky-600 text-white' :
                answers[questions[i].id] !== undefined ? 'bg-green-600/30 text-green-400' :
                'bg-slate-700 text-slate-400 hover:bg-slate-600'
              }`}
            >{i + 1}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex items-start justify-center">
          {q && (
            <div className="max-w-2xl w-full space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">{t('training.quizQuestionN', '第 {{n}} 題', { n: currentIdx + 1 })}({q.points} {t('training.quizPointsUnit', '分')})</span>
                <span className="text-[10px] text-slate-600">{q.type}</span>
              </div>

              <p className="text-sm font-medium">{q.question.text}</p>
              {q.question.image && <img src={q.question.image} alt="" className="max-w-full rounded-lg" />}

              {(q.type === 'single_choice' || q.type === 'multi_choice') && (
                <div className="space-y-1.5">
                  {(q.question.options || []).map((opt: string, oi: number) => {
                    const sel = answers[q.id]
                    const isSelected = q.type === 'single_choice' ? sel === oi : (sel || []).includes(oi)
                    return (
                      <button key={oi}
                        onClick={() => {
                          if (q.type === 'single_choice') setAnswer(q.id, oi)
                          else {
                            const prev: number[] = answers[q.id] || []
                            setAnswer(q.id, prev.includes(oi) ? prev.filter((x: number) => x !== oi) : [...prev, oi])
                          }
                        }}
                        className={`w-full text-left flex items-center gap-3 px-4 py-2.5 rounded-lg border transition ${
                          isSelected ? 'border-sky-500 bg-sky-500/10' : 'border-slate-700 hover:border-slate-600'
                        }`}>
                        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] ${
                          isSelected ? 'border-sky-400 bg-sky-400/20' : 'border-slate-600'
                        }`}>{isSelected && '●'}</span>
                        <span className="text-sm">{opt}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {q.type === 'fill_blank' && (
                <input value={answers[q.id] || ''} onChange={e => setAnswer(q.id, e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-sky-500"
                  placeholder={t('training.quizFillPlaceholder', '輸入答案...')} />
              )}

              {q.type === 'matching' && (
                <div className="space-y-2">
                  {(q.question.items || []).map((item: string, mi: number) => (
                    <div key={mi} className="flex items-center gap-3">
                      <span className="text-sm w-1/3">{item}</span>
                      <span className="text-slate-600">→</span>
                      <select value={(answers[q.id] || {})[mi] ?? ''}
                        onChange={e => setAnswer(q.id, { ...(answers[q.id] || {}), [mi]: Number(e.target.value) })}
                        className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm">
                        <option value="">{t('training.quizMatchPlaceholder', '-- 選擇 --')}</option>
                        {(q.question.targets || []).map((tg: string, ti: number) => (
                          <option key={ti} value={ti}>{tg}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}

              {q.type === 'ordering' && (
                <div className="text-xs text-slate-500">
                  <p className="mb-2">{t('training.quizOrderHint', '請用數字輸入正確順序(如 2,0,1,3):')}</p>
                  <input value={answers[q.id] || ''} onChange={e => setAnswer(q.id, e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" placeholder="0,1,2,3" />
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

        <div className="bg-slate-800 border-t border-slate-700 px-4 py-3 flex items-center gap-3 shrink-0">
          <button onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))} disabled={currentIdx === 0}
            className="text-slate-400 hover:text-slate-200 disabled:opacity-30">
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1" />
          {currentIdx < questions.length - 1 ? (
            <button onClick={() => setCurrentIdx(currentIdx + 1)}
              className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 px-4 py-1.5 rounded-lg text-sm transition">
              {t('training.quizNext', '下一題')} <ChevronRight size={16} />
            </button>
          ) : (
            <button onClick={() => submitChapter(false)} disabled={submitting}
              className="bg-sky-600 hover:bg-sky-500 text-white px-6 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-40">
              {t('training.quizSubmitChapter', '提交本章節')}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Overview / chapter list view ────────────────────────────
  const ov = overview
  if (!ov) return null
  const finalized = !!ov.attempt?.completed_at
  const allPassed = ov.chapters.length > 0 && ov.chapters.every(c => c.passed)
  const isSequential = ov.course.quiz_sequential
  const nextSuggested = ov.chapters.find(c => lessonKeyOf(c.lesson_id) === lessonKeyOf(ov.next_suggested_lesson_id))
  const inProgressChapter = ov.chapters.find(c => c.status === 'in_progress')

  // 主按鈕邏輯:
  //  • 有 in_progress → 「繼續章節 X」
  //  • 否則 next_suggested → 「開始章節 X」
  //  • 全 passed / finalized → 不顯示
  const primaryAction = inProgressChapter ?? nextSuggested ?? null
  const primaryLabel = inProgressChapter
    ? t('training.quizResumeChapterX', '繼續章節:{{title}}', { title: inProgressChapter.title })
    : (nextSuggested ? t('training.quizStartChapterX', '開始章節:{{title}}', { title: nextSuggested.title }) : '')

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/training/course/${id}`)} className="text-slate-400 hover:text-slate-200">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold">{ov.course.title}</h1>
          {isSequential && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 flex items-center gap-1">
              <ListOrdered size={10} /> {t('training.quizSequentialBadge', '依序測驗')}
            </span>
          )}
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-xs text-slate-500">{t('training.quizTotalTime', '總時間')}</div>
              <div className="text-2xl font-mono font-bold">
                {ov.course.time_limit_minutes ? formatTime(ov.remaining_seconds) : '∞'}
                {ov.course.time_limit_minutes != null && (
                  <span className="text-xs text-slate-500 font-normal ml-2">
                    / {ov.course.time_limit_minutes} {t('training.quizMinutes', '分')}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {t('training.quizTimeUsed', '已用 {{u}} 分', { u: Math.floor(ov.used_seconds / 60) })}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">{t('training.quizPassScore', '及格標準')}</div>
              <div className="text-lg font-semibold">{ov.course.pass_score} {t('training.quizPointsUnit', '分')}</div>
              <div className="text-xs text-slate-500 mt-1">
                {t('training.quizAttempt', '第 {{n}} 次測驗', { n: (ov.attempt?.attempt_number || ov.total_attempts + 1) })}
              </div>
            </div>
          </div>

          {/* Primary action button */}
          {!finalized && primaryAction && (
            <button onClick={() => startChapter(primaryAction.lesson_id)}
              disabled={ov.course.time_limit_minutes != null && ov.remaining_seconds <= 0}
              className="w-full bg-sky-600 hover:bg-sky-500 px-4 py-3 rounded-lg text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              <Play size={16} /> {primaryLabel}
            </button>
          )}

          {/* Finalize button — 至少 1 章做過,還沒 finalize */}
          {!finalized && ov.can_finalize && (
            <button onClick={finalizeAttempt} disabled={finalizing}
              className="w-full border border-slate-600 hover:bg-slate-700 px-4 py-2 rounded-lg text-xs transition flex items-center justify-center gap-2 text-slate-300">
              <Flag size={12} /> {finalizing ? t('training.quizFinalizing', '結算中...') : t('training.quizFinalizeNow', '結束測驗,馬上結算')}
            </button>
          )}

          {finalized && ov.attempt && (
            <div className={`rounded-lg p-4 border ${ov.attempt.passed ? 'border-green-500/40 bg-green-500/10' : 'border-red-500/40 bg-red-500/10'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-2xl font-bold ${ov.attempt.passed ? 'text-green-400' : 'text-red-400'}`}>
                    {ov.attempt.score} <span className="text-base text-slate-400">/ {ov.attempt.total_points}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {ov.attempt.passed ? t('training.quizPassed', '✓ 通過') : t('training.quizFailed', '✗ 未通過')}
                  </div>
                </div>
                <button onClick={() => navigate(`/training/course/${id}`)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600">
                  {t('training.backToCourse', '返回課程')}
                </button>
              </div>
            </div>
          )}

          {!finalized && allPassed && (
            <div className="rounded-lg p-3 border border-green-500/40 bg-green-500/10 text-xs text-green-300 text-center">
              {t('training.quizAllChaptersPassed', '🎉 所有章節都通過了!正在結算...')}
            </div>
          )}
        </div>

        {/* Chapter list */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-500 uppercase tracking-wide">{t('training.quizChapterList', '章節列表')}</div>
            {!finalized && (
              <div className="text-[10px] text-slate-600">
                {t('training.quizChapterHelp', '通過的章節會鎖住,未通過可重做')}
              </div>
            )}
          </div>
          {ov.chapters.map(c => {
            const lkey = lessonKeyOf(c.lesson_id)
            const isPassed = c.passed
            const isFailed = (c.status === 'completed' || c.status === 'timeout') && !c.passed
            const isInProg = c.status === 'in_progress'
            const hasInProgressOther = inProgressChapter && lessonKeyOf(inProgressChapter.lesson_id) !== lkey
            const sequentialLocked = c.is_sequential_locked && !isInProg && !isPassed && !isFailed
            const lockedByOther = hasInProgressOther && !isPassed && !isFailed
            const isSuggested = c.is_suggested && !isInProg

            const percent = c.max_score && c.score != null ? Math.round((c.score / c.max_score) * 100) : null

            return (
              <div key={lkey} className={`bg-slate-800 border rounded-xl p-4 flex items-center gap-3 ${
                isInProg ? 'border-sky-500/50' :
                isPassed ? 'border-green-500/30' :
                isFailed ? 'border-amber-500/30' :
                isSuggested ? 'border-sky-500/30' :
                'border-slate-700'
              }`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {isPassed ? <CheckCircle2 size={16} className="text-green-400 shrink-0" /> :
                     isFailed ? <XCircle size={16} className="text-amber-400 shrink-0" /> :
                     isInProg ? <Clock size={16} className="text-sky-400 shrink-0 animate-pulse" /> :
                     (sequentialLocked || lockedByOther) ? <Lock size={16} className="text-slate-600 shrink-0" /> :
                     <Play size={16} className="text-slate-400 shrink-0" />}
                    <div className="text-sm font-medium truncate">{c.title}</div>
                    {isSuggested && !finalized && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 shrink-0">
                        {t('training.quizSuggestedBadge', '建議下一章')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                    <span>{c.question_count} {t('training.quizItems', '題')}</span>
                    <span>·</span>
                    <span>{t('training.quizMaxScore', '滿分 {{n}}', { n: c.max_score })}</span>
                    {(isPassed || isFailed) && c.score != null && (
                      <>
                        <span>·</span>
                        <span className={isPassed ? 'text-green-400' : 'text-amber-400'}>
                          {t('training.quizScored', '得分 {{s}}/{{m}} ({{p}}%)', { s: c.score, m: c.max_score, p: percent })}
                        </span>
                      </>
                    )}
                    {c.status === 'timeout' && (
                      <span className="text-amber-400 flex items-center gap-1"><AlertTriangle size={10} /> {t('training.quizChapterTimedOut', '已超時')}</span>
                    )}
                    {isInProg && (
                      <span className="text-sky-400">{t('training.quizChapterInProgress', '進行中(timer 持續扣)')}</span>
                    )}
                  </div>
                </div>
                <div>
                  {isPassed ? (
                    <button disabled className="text-xs px-3 py-1.5 rounded-lg bg-green-700/30 text-green-400 cursor-not-allowed">
                      {t('training.quizChapterPassedShort', '已通過')}
                    </button>
                  ) : lockedByOther ? (
                    <button disabled className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-500 cursor-not-allowed">
                      {t('training.quizChapterLocked', '其他章節進行中')}
                    </button>
                  ) : sequentialLocked ? (
                    <button disabled className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-500 cursor-not-allowed">
                      {t('training.quizSequentialLocked', '依序鎖定')}
                    </button>
                  ) : (
                    <button
                      onClick={() => startChapter(c.lesson_id)}
                      disabled={ov.course.time_limit_minutes != null && ov.remaining_seconds <= 0}
                      className={`text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 ${
                        isFailed ? 'bg-amber-600 hover:bg-amber-500 text-white' :
                        isInProg ? 'bg-sky-600 hover:bg-sky-500 text-white' :
                        'bg-sky-600 hover:bg-sky-500 text-white'
                      }`}>
                      {isFailed && <RotateCcw size={11} />}
                      {isFailed ? t('training.quizRetryChapter', '重做') :
                       isInProg ? t('training.quizResumeChapter', '繼續') :
                       t('training.quizStartChapter', '開始')}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {ov.course.time_limit_minutes != null && ov.remaining_seconds <= 0 && !finalized && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-4 text-sm text-red-300 flex items-center gap-2">
            <AlertTriangle size={16} /> {t('training.quizTimeUp', '總測驗時間已用完')}
          </div>
        )}
      </div>
    </div>
  )
}
