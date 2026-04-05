import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../lib/api'
import { ChevronDown, ChevronRight, BarChart3, Users, Clock, Target } from 'lucide-react'

interface Props {
  courseId: number
}

interface Summary {
  total_users: number
  avg_score: number
  avg_time: number
  completion_rate: number
}

interface SlideStats {
  slide_id: number
  block_type: string
  attempts: number
  user_count: number
  avg_score: number
  avg_max_score: number
  avg_wrong_clicks: number
  avg_time: number
}

interface UserStats {
  user_id: number
  user_name: string
  employee_id: string
  total_interactions: number
  avg_score: number
  total_time: number
}

interface UserDetail {
  slide_id: number
  block_type: string
  score: number
  max_score: number
  total_time_seconds: number
  wrong_clicks: number
  steps_completed: number
  total_steps: number
  created_at: string
  slide_order: number
}

export default function InteractionReport({ courseId }: Props) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [slides, setSlides] = useState<SlideStats[]>([])
  const [users, setUsers] = useState<UserStats[]>([])
  const [expandedUser, setExpandedUser] = useState<number | null>(null)
  const [userDetails, setUserDetails] = useState<Record<number, UserDetail[]>>({})
  const [loadingDetail, setLoadingDetail] = useState<number | null>(null)

  useEffect(() => {
    loadReport()
  }, [courseId])

  const loadReport = async () => {
    try {
      setLoading(true)
      const res = await api.get(`/training/courses/${courseId}/interaction-report`)
      setSummary(res.data.summary)
      setSlides(res.data.slides || [])
      setUsers(res.data.users || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const toggleUser = async (userId: number) => {
    if (expandedUser === userId) {
      setExpandedUser(null)
      return
    }
    setExpandedUser(userId)
    if (!userDetails[userId]) {
      try {
        setLoadingDetail(userId)
        const res = await api.get(`/training/courses/${courseId}/interaction-report/${userId}`)
        setUserDetails(prev => ({ ...prev, [userId]: res.data.results || [] }))
      } catch (e) {
        console.error(e)
      } finally {
        setLoadingDetail(null)
      }
    }
  }

  if (loading) {
    return <div className="text-center py-12" style={{ color: 'var(--t-text-dim)' }}>{t('training.loading')}</div>
  }

  if (!summary || summary.total_users === 0) {
    return (
      <div className="text-center py-12" style={{ color: 'var(--t-text-dim)' }}>
        <BarChart3 size={40} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">{t('training.noInteractionData')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { icon: Users, label: t('training.totalUsers'), value: summary.total_users, color: '#3b82f6' },
          { icon: Target, label: t('training.avgScore'), value: `${summary.avg_score ?? 0}`, color: '#22c55e' },
          { icon: Clock, label: t('training.avgTime'), value: `${summary.avg_time ?? 0}s`, color: '#f59e0b' },
          { icon: BarChart3, label: t('training.completionRate'), value: `${summary.completion_rate ?? 0}%`, color: '#a855f7' },
        ].map(card => (
          <div key={card.label} className="rounded-xl p-4" style={{ backgroundColor: 'var(--t-bg-card)', border: '1px solid var(--t-border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <card.icon size={14} style={{ color: card.color }} />
              <span className="text-[10px]" style={{ color: 'var(--t-text-dim)' }}>{card.label}</span>
            </div>
            <div className="text-xl font-bold" style={{ color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Per-slide stats */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--t-border)' }}>
        <div className="px-4 py-3" style={{ backgroundColor: 'var(--t-bg-elevated)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--t-text)' }}>{t('training.slideStats')}</h3>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ backgroundColor: 'var(--t-bg-card)' }}>
              <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.slideId')}</th>
              <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.blockType')}</th>
              <th className="text-right px-4 py-2 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.attempts')}</th>
              <th className="text-right px-4 py-2 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.userCount')}</th>
              <th className="text-right px-4 py-2 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.avgScoreCol')}</th>
              <th className="text-right px-4 py-2 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.avgWrongClicks')}</th>
              <th className="text-right px-4 py-2 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.avgTimeCol')}</th>
            </tr>
          </thead>
          <tbody>
            {slides.map((s, idx) => (
              <tr key={`${s.slide_id}-${s.block_type}`}
                style={{ backgroundColor: idx % 2 === 0 ? 'var(--t-bg)' : 'var(--t-bg-card)' }}>
                <td className="px-4 py-2" style={{ color: 'var(--t-text)' }}>#{s.slide_id}</td>
                <td className="px-4 py-2">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-sky-500/15 text-sky-400">{s.block_type}</span>
                </td>
                <td className="px-4 py-2 text-right" style={{ color: 'var(--t-text)' }}>{s.attempts}</td>
                <td className="px-4 py-2 text-right" style={{ color: 'var(--t-text)' }}>{s.user_count}</td>
                <td className="px-4 py-2 text-right">
                  <span style={{ color: s.avg_score >= (s.avg_max_score * 0.6) ? '#22c55e' : '#ef4444' }}>
                    {s.avg_score} / {s.avg_max_score}
                  </span>
                </td>
                <td className="px-4 py-2 text-right" style={{ color: s.avg_wrong_clicks > 3 ? '#ef4444' : 'var(--t-text)' }}>
                  {s.avg_wrong_clicks}
                </td>
                <td className="px-4 py-2 text-right" style={{ color: 'var(--t-text)' }}>{s.avg_time}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Per-user stats with expandable detail */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--t-border)' }}>
        <div className="px-4 py-3" style={{ backgroundColor: 'var(--t-bg-elevated)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--t-text)' }}>{t('training.userStats')}</h3>
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--t-border)' }}>
          {users.map(u => (
            <div key={u.user_id}>
              <button
                onClick={() => toggleUser(u.user_id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:opacity-80 transition text-left"
                style={{ backgroundColor: expandedUser === u.user_id ? 'var(--t-bg-elevated)' : 'var(--t-bg-card)' }}
              >
                {expandedUser === u.user_id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="text-xs font-medium flex-1" style={{ color: 'var(--t-text)' }}>
                  {u.user_name} <span style={{ color: 'var(--t-text-dim)' }}>({u.employee_id})</span>
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded" style={{ color: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)' }}>
                  {t('training.avgScoreCol')}: {u.avg_score}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--t-text-dim)' }}>
                  {u.total_interactions} {t('training.interactions')} | {u.total_time}s
                </span>
              </button>

              {expandedUser === u.user_id && (
                <div className="px-6 pb-3" style={{ backgroundColor: 'var(--t-bg)' }}>
                  {loadingDetail === u.user_id ? (
                    <div className="py-3 text-center text-xs" style={{ color: 'var(--t-text-dim)' }}>{t('training.loading')}</div>
                  ) : (
                    <table className="w-full text-[11px] mt-2">
                      <thead>
                        <tr>
                          <th className="text-left py-1 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.slideId')}</th>
                          <th className="text-left py-1 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.blockType')}</th>
                          <th className="text-right py-1 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.score')}</th>
                          <th className="text-right py-1 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.stepsCol')}</th>
                          <th className="text-right py-1 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.wrongClicksCol')}</th>
                          <th className="text-right py-1 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.timeCol')}</th>
                          <th className="text-right py-1 font-medium" style={{ color: 'var(--t-text-dim)' }}>{t('training.date')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(userDetails[u.user_id] || []).map((d, i) => (
                          <tr key={i}>
                            <td className="py-1" style={{ color: 'var(--t-text)' }}>#{d.slide_id}</td>
                            <td className="py-1">
                              <span className="px-1 py-0.5 rounded text-[9px] bg-sky-500/15 text-sky-400">{d.block_type}</span>
                            </td>
                            <td className="py-1 text-right" style={{ color: d.score >= d.max_score * 0.6 ? '#22c55e' : '#ef4444' }}>
                              {d.score}/{d.max_score}
                            </td>
                            <td className="py-1 text-right" style={{ color: 'var(--t-text)' }}>
                              {d.steps_completed}/{d.total_steps}
                            </td>
                            <td className="py-1 text-right" style={{ color: 'var(--t-text)' }}>{d.wrong_clicks}</td>
                            <td className="py-1 text-right" style={{ color: 'var(--t-text)' }}>{d.total_time_seconds}s</td>
                            <td className="py-1 text-right" style={{ color: 'var(--t-text-dim)' }}>
                              {d.created_at ? new Date(d.created_at).toLocaleString() : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
