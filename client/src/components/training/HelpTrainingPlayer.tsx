import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { X, Maximize2, Minimize2, Play, BarChart3, ChevronDown, ChevronRight } from 'lucide-react'
import { CoursePlayerInner } from './CoursePlayer'

interface Props {
  courseId: number
  lessonId?: number | null
  onClose: () => void
}

type SizeMode = 'default' | 'shrink' | 'fullscreen'

export default function HelpTrainingPlayer({ courseId, lessonId, onClose }: Props) {
  const { t, i18n } = useTranslation()
  const [activeTab, setActiveTab] = useState<'player' | 'history'>('player')
  const [sizeMode, setSizeMode] = useState<SizeMode>('default')
  const sessionId = useMemo(() => crypto.randomUUID(), [courseId, lessonId])

  // ESC: fullscreen → default → close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (sizeMode === 'fullscreen') setSizeMode('default')
        else onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [sizeMode, onClose])

  const sizeStyles: Record<SizeMode, string> = {
    default: 'w-[90vw] h-[90vh]',
    shrink: 'w-[70vw] h-[70vh]',
    fullscreen: 'w-screen h-screen',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
        <div
          className={`${sizeStyles[sizeMode]} flex flex-col rounded-xl overflow-hidden shadow-2xl transition-all duration-300`}
          style={{ backgroundColor: 'var(--t-bg)', color: 'var(--t-text)', border: sizeMode === 'fullscreen' ? 'none' : '1px solid var(--t-border)' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-2 shrink-0 border-b" style={{ backgroundColor: 'var(--t-bg-elevated)', borderColor: 'var(--t-border)' }}>
            {/* Tabs */}
            <button onClick={() => setActiveTab('player')}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition ${activeTab === 'player' ? 'text-white' : ''}`}
              style={{ backgroundColor: activeTab === 'player' ? 'var(--t-accent-bg)' : 'transparent', color: activeTab === 'player' ? 'white' : 'var(--t-text-dim)' }}>
              <Play size={12} /> {t('help.courseTab')}
            </button>
            <button onClick={() => setActiveTab('history')}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition ${activeTab === 'history' ? 'text-white' : ''}`}
              style={{ backgroundColor: activeTab === 'history' ? 'var(--t-accent-bg)' : 'transparent', color: activeTab === 'history' ? 'white' : 'var(--t-text-dim)' }}>
              <BarChart3 size={12} /> {t('help.scoreHistory')}
            </button>
            <div className="flex-1" />
            <button onClick={() => setSizeMode(sizeMode === 'shrink' ? 'default' : 'shrink')}
              className="hover:opacity-70 p-1" style={{ color: 'var(--t-text-muted)' }} title={t('help.shrink')}>
              <Minimize2 size={14} />
            </button>
            <button onClick={() => setSizeMode(sizeMode === 'fullscreen' ? 'default' : 'fullscreen')}
              className="hover:opacity-70 p-1" style={{ color: 'var(--t-text-muted)' }} title={t('help.fullscreen')}>
              <Maximize2 size={14} />
            </button>
            <button onClick={onClose} className="hover:opacity-70 p-1" style={{ color: 'var(--t-text-muted)' }}>
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          {activeTab === 'player' ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <CoursePlayerInner
                courseId={courseId}
                lessonId={lessonId}
                sessionId={sessionId}
                skipAccessCheck
                lang={i18n.language}
                onClose={onClose}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4">
              <ScoreHistoryPanel courseId={courseId} lessonId={lessonId} />
            </div>
          )}
        </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ScoreHistoryPanel — session-grouped interaction history
// ═══════════════════════════════════════════════════════════════════════════════

interface SessionData {
  session_id: string
  player_mode: string
  total_score: number
  total_max: number
  interactions: number
  total_time: number
  started_at: string
  ended_at: string
  exam_topic_id?: number | null
  exam_topic_title?: string | null
  details: { slide_id: number; slide_title?: string | null; slide_order?: number; block_type: string; score: number; max_score: number; total_time_seconds: number; wrong_clicks: number; steps_completed: number; total_steps: number }[]
}

function ScoreHistoryPanel({ courseId, lessonId }: { courseId: number; lessonId?: number | null }) {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<SessionData[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    loadHistory()
  }, [courseId, lessonId])

  const loadHistory = async () => {
    try {
      setLoading(true)
      const params: any = {}
      if (lessonId) params.lesson_id = lessonId
      const res = await api.get(`/training/courses/${courseId}/my-interaction-history`, { params })
      setSessions(res.data.sessions || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div className="text-center py-12 text-xs" style={{ color: 'var(--t-text-dim)' }}>{t('training.loading')}</div>

  if (sessions.length === 0) {
    return (
      <div className="text-center py-12">
        <BarChart3 size={40} className="mx-auto mb-3 opacity-20" />
        <p className="text-sm" style={{ color: 'var(--t-text-dim)' }}>{t('help.noHistory')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {sessions.map((s, idx) => {
        const pct = s.total_max > 0 ? Math.round((s.total_score / s.total_max) * 100) : 0
        const isExpanded = expanded === s.session_id
        return (
          <div key={s.session_id} className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--t-border)' }}>
            <button
              onClick={() => setExpanded(isExpanded ? null : s.session_id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:opacity-90 transition"
              style={{ backgroundColor: 'var(--t-bg-card)' }}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="text-xs font-medium" style={{ color: 'var(--t-text)' }}>
                {t('help.session', { n: sessions.length - idx })}
                {s.exam_topic_title && <span className="ml-1 text-[10px] font-normal" style={{ color: 'var(--t-text-dim)' }}>— {s.exam_topic_title}</span>}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                backgroundColor: s.player_mode === 'test' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)',
                color: s.player_mode === 'test' ? '#f59e0b' : '#3b82f6'
              }}>
                {s.player_mode === 'test' ? '📝' : '📖'} {s.player_mode}
              </span>
              <div className="flex-1 mx-3">
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--t-border)' }}>
                  <div className="h-full rounded-full transition-all" style={{
                    width: `${pct}%`,
                    backgroundColor: pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444'
                  }} />
                </div>
              </div>
              <span className="text-sm font-bold min-w-[60px] text-right" style={{
                color: pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444'
              }}>
                {s.total_score}/{s.total_max}
              </span>
              <span className="text-[10px] min-w-[40px] text-right" style={{ color: 'var(--t-text-dim)' }}>{s.total_time}s</span>
              <span className="text-[10px] min-w-[70px] text-right" style={{ color: 'var(--t-text-dim)' }}>
                {s.started_at ? new Date(s.started_at).toLocaleString() : ''}
              </span>
            </button>

            {isExpanded && s.details && (
              <div className="px-4 pb-3" style={{ backgroundColor: 'var(--t-bg)' }}>
                <table className="w-full text-[11px] mt-2">
                  <thead>
                    <tr>
                      <th className="text-left py-1 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.slideId')}</th>
                      <th className="text-left py-1 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.blockType')}</th>
                      <th className="text-right py-1 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.score')}</th>
                      <th className="text-right py-1 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.stepsCol')}</th>
                      <th className="text-right py-1 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.wrongClicksCol')}</th>
                      <th className="text-right py-1 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.timeCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.details.map((d, i) => (
                      <tr key={i}>
                        <td className="py-1 max-w-[240px] truncate" title={d.slide_title || `#${d.slide_id}`} style={{ color: 'var(--t-text)' }}>
                          {d.slide_title || `#${d.slide_id}`}
                        </td>
                        <td className="py-1">
                          <span className="px-1 py-0.5 rounded text-[9px] bg-sky-500/15 text-sky-400">{d.block_type}</span>
                        </td>
                        <td className="py-1 text-right" style={{ color: d.score >= d.max_score * 0.6 ? '#22c55e' : '#ef4444' }}>
                          {d.score}/{d.max_score}
                        </td>
                        <td className="py-1 text-right" style={{ color: 'var(--t-text)' }}>{d.steps_completed}/{d.total_steps}</td>
                        <td className="py-1 text-right" style={{ color: 'var(--t-text)' }}>{d.wrong_clicks}</td>
                        <td className="py-1 text-right" style={{ color: 'var(--t-text)' }}>{d.total_time_seconds}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
