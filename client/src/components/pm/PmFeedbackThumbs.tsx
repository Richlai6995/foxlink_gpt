/**
 * PmFeedbackThumbs — 通用 thumbs up/down,寫 pm_feedback_signal
 *
 * 用法:
 *   <PmFeedbackThumbs targetType="forecast" targetRef={String(forecastId)} />
 *   <PmFeedbackThumbs targetType="report"   targetRef={`daily-${date}`} compact />
 *   <PmFeedbackThumbs targetType="alert"    targetRef={String(alertId)} />
 *
 * Permission gate 由後端走(non-PM-user 收 403,UI 隱藏)。
 */
import { useEffect, useState } from 'react'
import { ThumbsUp, ThumbsDown, MessageSquare, Loader2, X } from 'lucide-react'
import api from '../../lib/api'

interface Props {
  targetType: 'forecast' | 'report' | 'alert'
  targetRef: string
  compact?: boolean
  contextMeta?: Record<string, any>
}

interface Summary {
  up: number
  down: number
  total: number
}

export default function PmFeedbackThumbs({ targetType, targetRef, compact, contextMeta }: Props) {
  const [myVote, setMyVote] = useState<0 | 1 | -1>(0)
  const [summary, setSummary] = useState<Summary>({ up: 0, down: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState(false)
  const [showCommentBox, setShowCommentBox] = useState(false)
  const [comment, setComment] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      api.get('/pm/feedback/my', { params: { target_type: targetType, target_ref: targetRef } }),
      api.get('/pm/feedback/summary', { params: { target_type: targetType, target_ref: targetRef } }),
    ]).then(([myRes, sumRes]) => {
      if (cancelled) return
      setMyVote((myRes.data?.vote || 0) as 0 | 1 | -1)
      setComment(myRes.data?.comment || '')
      setSummary(sumRes.data || { up: 0, down: 0, total: 0 })
    }).catch(err => {
      if (cancelled) return
      if (err?.response?.status === 403) setDenied(true)
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [targetType, targetRef])

  if (denied) return null
  if (loading && !compact) return <div className="text-xs text-slate-400 inline-flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> 載入回饋…</div>

  const submit = async (vote: 1 | -1, withComment?: string) => {
    setBusy(true)
    try {
      await api.post('/pm/feedback', {
        target_type: targetType, target_ref: targetRef,
        vote, comment: withComment || null,
        context_meta: contextMeta || null,
      })
      // 重撈 summary + my
      const [myRes, sumRes] = await Promise.all([
        api.get('/pm/feedback/my', { params: { target_type: targetType, target_ref: targetRef } }),
        api.get('/pm/feedback/summary', { params: { target_type: targetType, target_ref: targetRef } }),
      ])
      setMyVote((myRes.data?.vote || 0) as 0 | 1 | -1)
      setSummary(sumRes.data || { up: 0, down: 0, total: 0 })
      if (withComment !== undefined) setShowCommentBox(false)
    } catch (e: any) {
      alert(e?.response?.data?.error || String(e))
    } finally { setBusy(false) }
  }

  const onUp   = () => submit(1)
  const onDown = () => {
    // 倒讚先選擇是否要附 comment
    if (myVote === -1) { submit(-1) ; return }  // toggle 切換
    setShowCommentBox(true)
  }

  const submitDownWithComment = () => submit(-1, comment.trim() || undefined)

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <button
          onClick={onUp}
          disabled={busy}
          title="這個分析有用"
          className={`p-1 rounded hover:bg-emerald-50 ${myVote === 1 ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400'}`}
        >
          <ThumbsUp size={12} />
        </button>
        {summary.up > 0 && <span className="text-slate-500">{summary.up}</span>}
        <button
          onClick={onDown}
          disabled={busy}
          title="這個分析不準/沒用"
          className={`p-1 rounded hover:bg-red-50 ${myVote === -1 ? 'text-red-600 bg-red-50' : 'text-slate-400'}`}
        >
          <ThumbsDown size={12} />
        </button>
        {summary.down > 0 && <span className="text-slate-500">{summary.down}</span>}
        {showCommentBox && <CommentInline comment={comment} setComment={setComment} onSubmit={submitDownWithComment} onClose={() => setShowCommentBox(false)} busy={busy} />}
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2 text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white">
      <span className="text-slate-500 mr-1">這份分析是否有幫助?</span>
      <button
        onClick={onUp}
        disabled={busy}
        className={`flex items-center gap-1 px-2 py-1 rounded transition ${
          myVote === 1 ? 'bg-emerald-100 text-emerald-700' : 'text-slate-500 hover:bg-emerald-50 hover:text-emerald-700'
        }`}
      >
        <ThumbsUp size={14} />
        <span>有幫助 ({summary.up})</span>
      </button>
      <button
        onClick={onDown}
        disabled={busy}
        className={`flex items-center gap-1 px-2 py-1 rounded transition ${
          myVote === -1 ? 'bg-red-100 text-red-700' : 'text-slate-500 hover:bg-red-50 hover:text-red-700'
        }`}
      >
        <ThumbsDown size={14} />
        <span>不準/沒用 ({summary.down})</span>
      </button>
      {showCommentBox && (
        <CommentInline comment={comment} setComment={setComment} onSubmit={submitDownWithComment} onClose={() => setShowCommentBox(false)} busy={busy} />
      )}
    </div>
  )
}

function CommentInline({
  comment, setComment, onSubmit, onClose, busy,
}: {
  comment: string;
  setComment: (s: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center gap-1 ml-2 bg-slate-50 rounded px-2 py-1 border border-slate-200">
      <MessageSquare size={12} className="text-slate-400" />
      <input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="哪裡不準?(選填)"
        className="bg-transparent text-xs focus:outline-none w-32"
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit() }}
      />
      <button onClick={onSubmit} disabled={busy} className="text-blue-600 text-xs px-2 py-0.5 rounded hover:bg-blue-100">
        送出
      </button>
      <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
        <X size={12} />
      </button>
    </div>
  )
}
