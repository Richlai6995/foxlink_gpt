/**
 * QuizManagementTab — 題庫管理(嵌入 CourseEditor)
 * 主要任務:把每題指定到章節(lesson_id),驅動章節制測驗。
 */
import { useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../../lib/api'
import { FileText, Save, AlertCircle } from 'lucide-react'

interface Question {
  id: number
  question_type: string
  question_json: string
  answer_json: string
  points: number
  sort_order: number
  lesson_id: number | null
}

interface Lesson {
  id: number
  title: string
}

export default function QuizManagementTab({ courseId, lessons }: { courseId: number; lessons: Lesson[] }) {
  const { t } = useTranslation()
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState<Record<number, number | null>>({})
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unassigned' | number>('all')

  useEffect(() => { load() }, [courseId])

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get(`/training/courses/${courseId}/questions`)
      setQuestions(res.data)
      setDirty({})
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const groups = useMemo(() => {
    const g: { lessonId: number | null; title: string; items: Question[] }[] = []
    for (const l of lessons) {
      const items = questions.filter(q => (dirty[q.id] !== undefined ? dirty[q.id] : q.lesson_id) === l.id)
      if (items.length > 0) g.push({ lessonId: l.id, title: l.title, items })
    }
    const unassigned = questions.filter(q => (dirty[q.id] !== undefined ? dirty[q.id] : q.lesson_id) == null)
    if (unassigned.length > 0) g.push({ lessonId: null, title: t('training.quizUnassigned', '未分類'), items: unassigned })
    return g
  }, [questions, lessons, dirty, t])

  const filtered = useMemo(() => {
    if (filter === 'all') return questions
    if (filter === 'unassigned') return questions.filter(q => (dirty[q.id] !== undefined ? dirty[q.id] : q.lesson_id) == null)
    return questions.filter(q => (dirty[q.id] !== undefined ? dirty[q.id] : q.lesson_id) === filter)
  }, [questions, filter, dirty])

  const setLesson = (qid: number, lid: number | null) => {
    setDirty(prev => ({ ...prev, [qid]: lid }))
  }

  const saveAll = async () => {
    const assignments = Object.entries(dirty).map(([id, lesson_id]) => ({ id: Number(id), lesson_id }))
    if (assignments.length === 0) return
    setSaving(true)
    try {
      await api.put(`/training/courses/${courseId}/questions/assign-lesson`, { assignments })
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || t('training.saveFailed'))
    } finally { setSaving(false) }
  }

  const autoAssignBySortOrder = () => {
    if (lessons.length === 0) return
    if (!confirm(t('training.quizAutoAssignConfirm', '依題目順序平均分配到所有章節?(只影響未分類題目)'))) return
    const unassigned = questions.filter(q => (dirty[q.id] !== undefined ? dirty[q.id] : q.lesson_id) == null)
                                .sort((a, b) => a.sort_order - b.sort_order)
    if (unassigned.length === 0) return
    const perLesson = Math.ceil(unassigned.length / lessons.length)
    const next = { ...dirty }
    unassigned.forEach((q, i) => {
      const lessonIdx = Math.min(Math.floor(i / perLesson), lessons.length - 1)
      next[q.id] = lessons[lessonIdx].id
    })
    setDirty(next)
  }

  const parseQuestionText = (q: Question) => {
    try { return JSON.parse(q.question_json)?.text || '' } catch { return '' }
  }

  const dirtyCount = Object.keys(dirty).length

  if (loading) return <div className="text-center text-slate-500 py-12 text-sm">{t('common.loading', '載入中...')}</div>

  if (questions.length === 0) {
    return (
      <div className="text-center py-20" style={{ color: 'var(--t-text-dim)' }}>
        <FileText size={48} className="mx-auto mb-3 opacity-50" />
        <p className="text-sm">{t('training.quizNoQuestions', '此課程尚無題目')}</p>
      </div>
    )
  }

  const unassignedCount = questions.filter(q => (dirty[q.id] !== undefined ? dirty[q.id] : q.lesson_id) == null).length

  return (
    <div className="max-w-5xl space-y-4">
      {/* Header / Stats */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--t-text-muted)' }}>
          <span>{t('training.quizTotalQuestions', '共 {{n}} 題', { n: questions.length })}</span>
          <span>·</span>
          <span>{t('training.quizChapterCount', '{{n}} 個章節有題目', { n: groups.filter(g => g.lessonId != null).length })}</span>
          {unassignedCount > 0 && (
            <>
              <span>·</span>
              <span className="text-amber-500 flex items-center gap-1">
                <AlertCircle size={12} />
                {t('training.quizUnassignedCount', '{{n}} 題未分類', { n: unassignedCount })}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unassignedCount > 0 && (
            <button onClick={autoAssignBySortOrder}
              className="text-xs px-3 py-1.5 rounded-lg border transition"
              style={{ borderColor: 'var(--t-border)', color: 'var(--t-text-muted)' }}>
              {t('training.quizAutoAssign', '自動分配')}
            </button>
          )}
          <button onClick={saveAll} disabled={dirtyCount === 0 || saving}
            className="text-xs px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
            <Save size={12} /> {t('common.save', '儲存')} {dirtyCount > 0 && `(${dirtyCount})`}
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <button onClick={() => setFilter('all')}
          className={`px-2.5 py-1 rounded ${filter === 'all' ? 'bg-sky-600 text-white' : 'border'}`}
          style={filter === 'all' ? {} : { borderColor: 'var(--t-border)', color: 'var(--t-text-muted)' }}>
          {t('common.all', '全部')} ({questions.length})
        </button>
        <button onClick={() => setFilter('unassigned')}
          className={`px-2.5 py-1 rounded ${filter === 'unassigned' ? 'bg-amber-600 text-white' : 'border'}`}
          style={filter === 'unassigned' ? {} : { borderColor: 'var(--t-border)', color: 'var(--t-text-muted)' }}>
          {t('training.quizUnassigned', '未分類')} ({unassignedCount})
        </button>
        {lessons.map(l => {
          const cnt = questions.filter(q => (dirty[q.id] !== undefined ? dirty[q.id] : q.lesson_id) === l.id).length
          if (cnt === 0) return null
          return (
            <button key={l.id} onClick={() => setFilter(l.id)}
              className={`px-2.5 py-1 rounded truncate max-w-[200px] ${filter === l.id ? 'bg-sky-600 text-white' : 'border'}`}
              style={filter === l.id ? {} : { borderColor: 'var(--t-border)', color: 'var(--t-text-muted)' }}
              title={l.title}>
              {l.title} ({cnt})
            </button>
          )
        })}
      </div>

      {/* Question table */}
      <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'var(--t-border)' }}>
        <table className="w-full text-xs">
          <thead style={{ backgroundColor: 'var(--t-bg-card)', color: 'var(--t-text-muted)' }}>
            <tr>
              <th className="text-left px-3 py-2 w-12">#</th>
              <th className="text-left px-3 py-2">{t('training.quizQuestion', '題目')}</th>
              <th className="text-left px-3 py-2 w-24">{t('training.quizType', '題型')}</th>
              <th className="text-left px-3 py-2 w-16">{t('training.quizPoints', '分數')}</th>
              <th className="text-left px-3 py-2 w-64">{t('training.quizChapter', '章節')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((q, idx) => {
              const currentLid = dirty[q.id] !== undefined ? dirty[q.id] : q.lesson_id
              const isDirty = dirty[q.id] !== undefined
              return (
                <tr key={q.id} className="border-t" style={{ borderColor: 'var(--t-border)', backgroundColor: isDirty ? 'rgba(56,189,248,0.05)' : undefined }}>
                  <td className="px-3 py-2 text-slate-500">{q.sort_order ?? idx + 1}</td>
                  <td className="px-3 py-2 max-w-md">
                    <div className="truncate" style={{ color: 'var(--t-text)' }}>{parseQuestionText(q) || `#${q.id}`}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{q.question_type}</td>
                  <td className="px-3 py-2 text-slate-500">{q.points}</td>
                  <td className="px-3 py-2">
                    <select
                      value={currentLid ?? ''}
                      onChange={e => setLesson(q.id, e.target.value === '' ? null : Number(e.target.value))}
                      className="w-full text-xs rounded border px-2 py-1 bg-transparent"
                      style={{ borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
                    >
                      <option value="">{t('training.quizUnassigned', '未分類')}</option>
                      {lessons.map(l => (
                        <option key={l.id} value={l.id}>{l.title}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {dirtyCount > 0 && (
        <div className="text-xs text-amber-500 flex items-center gap-1.5">
          <AlertCircle size={12} />
          {t('training.quizUnsavedChanges', '有 {{n}} 項未儲存變更', { n: dirtyCount })}
        </div>
      )}

      <div className="text-xs" style={{ color: 'var(--t-text-dim)' }}>
        {t('training.quizChapterModeHint', '提示:章節制測驗下,學員可分章節作答並暫停;未分類題目會合併為「未分類章節」。建議所有題目都指定章節。')}
      </div>
    </div>
  )
}
