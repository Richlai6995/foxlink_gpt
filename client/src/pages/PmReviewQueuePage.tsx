/**
 * PM Prompt Review Queue Page — Phase 5 Track B-4 採購員審 LLM v2 prompt
 *
 * Permission gate 由 /api/pm/* 後端走(復用 help_book_shares for 'precious-metals')
 * — non-PM-user 直接收 403 → 顯示權限提示
 *
 * UI:
 *   - 左側列 queue (pending / approved / rejected / all 切換)
 *   - 右側 detail panel(diff view + rationale + eval summary + approve/reject buttons)
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, GitCompare, CheckCircle2, XCircle, RefreshCw,
  AlertCircle, Loader2, FileText, Sparkles,
} from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'

interface QueueItem {
  id: number
  skill_name: string
  skill_id: number | null
  status: 'pending' | 'approved' | 'rejected'
  submitted_by: string
  submitted_at: string
  reviewed_by: number | null
  reviewed_by_name: string | null
  decided_at: string | null
  review_comment: string | null
}

interface QueueDetail extends QueueItem {
  original_prompt: string
  proposed_prompt: string
  rationale: string | null
  eval_summary: string | null
}

type FilterStatus = 'pending' | 'approved' | 'rejected' | 'all'

export default function PmReviewQueuePage() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [list, setList] = useState<QueueItem[]>([])
  const [filter, setFilter] = useState<FilterStatus>('pending')
  const [selected, setSelected] = useState<QueueDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [denied, setDenied] = useState(false)
  const [decideBusy, setDecideBusy] = useState(false)
  const [decideComment, setDecideComment] = useState('')
  const [showCompare, setShowCompare] = useState<'diff' | 'side'>('side')
  const [runningSelfImprove, setRunningSelfImprove] = useState(false)

  const fetchList = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/pm/review/queue', { params: { status: filter } })
      setList(Array.isArray(data) ? data : [])
    } catch (err: any) {
      if (err?.response?.status === 403) setDenied(true)
      else alert(err?.response?.data?.error || String(err))
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchList() }, [filter])

  const openDetail = async (id: number) => {
    setSelected(null)
    setDecideComment('')
    try {
      const { data } = await api.get(`/pm/review/queue/${id}`)
      setSelected(data)
    } catch (err: any) {
      alert(err?.response?.data?.error || String(err))
    }
  }

  const decide = async (action: 'approve' | 'reject') => {
    if (!selected) return
    if (!window.confirm(action === 'approve'
      ? `批准後將立即套用 v2 prompt 到 skill「${selected.skill_name}」(此動作不可復原)。確定?`
      : '駁回?(可加 comment 說明原因)')) return
    setDecideBusy(true)
    try {
      await api.post(`/pm/review/queue/${selected.id}/decide`, { action, comment: decideComment.trim() || null })
      setSelected(null)
      setDecideComment('')
      await fetchList()
    } catch (err: any) {
      alert(err?.response?.data?.error || String(err))
    } finally { setDecideBusy(false) }
  }

  const runSelfImprove = async () => {
    if (!isAdmin) return
    if (!window.confirm('立即執行 prompt self-improve(會跑 LLM 分析過去 30 天失敗案例,需 ~30-60 秒)?')) return
    setRunningSelfImprove(true)
    try {
      const { data } = await api.post('/pm/review/run-self-improve')
      alert(data?.queued ? '已產生 v2 prompt,請至 pending queue 審閱' : `未產生:${data?.reason || '未知原因'}`)
      await fetchList()
    } catch (err: any) {
      alert(err?.response?.data?.error || String(err))
    } finally { setRunningSelfImprove(false) }
  }

  if (denied) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 text-slate-500 gap-3">
        <AlertCircle size={48} className="text-amber-400" />
        <div className="text-lg font-medium">需要貴金屬平台閱讀權限</div>
        <div className="text-sm">請洽 admin 在「特殊說明書管理」加你進貴金屬書的分享名單</div>
        <button onClick={() => navigate('/chat')} className="mt-3 px-4 py-2 text-sm rounded bg-slate-800 text-white hover:bg-slate-900">回到對話</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Top bar */}
      <header className="bg-white border-b px-6 py-3 flex items-center gap-4 shadow-sm">
        <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-slate-800 text-sm flex items-center gap-1">
          <ArrowLeft size={16} /> 返回
        </button>
        <Sparkles size={18} className="text-amber-500" />
        <h1 className="text-lg font-bold text-slate-800">PM Prompt Review Queue</h1>
        <span className="text-xs text-slate-400">採購員審 LLM 自動產生的 v2 prompt</span>
        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={runSelfImprove} disabled={runningSelfImprove}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >
              {runningSelfImprove ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              手動跑 self-improve
            </button>
          )}
          <button onClick={fetchList} className="p-1.5 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-100">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: queue list */}
        <aside className="w-96 bg-white border-r overflow-y-auto flex flex-col">
          <div className="p-3 border-b flex gap-1">
            {(['pending', 'approved', 'rejected', 'all'] as FilterStatus[]).map(s => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`flex-1 px-2 py-1 text-xs rounded transition ${
                  filter === s ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && <div className="p-6 text-center text-slate-400 text-sm flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> 載入中…</div>}
            {!loading && list.length === 0 && (
              <div className="p-6 text-center text-slate-400 text-sm">無項目 — {filter === 'pending' ? '所有 prompt 都已處理' : '此狀態目前無資料'}</div>
            )}
            {list.map(item => (
              <button
                key={item.id}
                onClick={() => openDetail(item.id)}
                className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-blue-50 transition ${
                  selected?.id === item.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''
                }`}
              >
                <div className="flex items-start gap-2 mb-1">
                  <FileText size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />
                  <span className="font-mono text-sm font-medium text-slate-800 truncate">{item.skill_name}</span>
                  <StatusBadge status={item.status} />
                </div>
                <div className="text-xs text-slate-500 ml-5">
                  {new Date(item.submitted_at).toLocaleString()} · 由 {item.submitted_by}
                </div>
                {item.reviewed_by_name && (
                  <div className="text-xs text-slate-500 ml-5 mt-0.5">
                    審核:{item.reviewed_by_name}{item.review_comment ? ` — “${item.review_comment}”` : ''}
                  </div>
                )}
              </button>
            ))}
          </div>
        </aside>

        {/* Right: detail */}
        <main className="flex-1 overflow-y-auto bg-white">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">
              ← 從左側選擇一個項目檢視 prompt diff
            </div>
          ) : (
            <DetailPanel
              item={selected}
              showCompare={showCompare}
              setShowCompare={setShowCompare}
              decideBusy={decideBusy}
              decideComment={decideComment}
              setDecideComment={setDecideComment}
              onApprove={() => decide('approve')}
              onReject={() => decide('reject')}
            />
          )}
        </main>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'pending'   ? 'bg-amber-100 text-amber-700' :
              status === 'approved'  ? 'bg-emerald-100 text-emerald-700' :
                                       'bg-slate-100 text-slate-600'
  return <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>{status}</span>
}

function DetailPanel({
  item, showCompare, setShowCompare,
  decideBusy, decideComment, setDecideComment,
  onApprove, onReject,
}: {
  item: QueueDetail
  showCompare: 'diff' | 'side'
  setShowCompare: (v: 'diff' | 'side') => void
  decideBusy: boolean
  decideComment: string
  setDecideComment: (s: string) => void
  onApprove: () => void
  onReject: () => void
}) {
  let evalParsed: any = null
  try { evalParsed = item.eval_summary ? JSON.parse(item.eval_summary) : null } catch { /* keep raw */ }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-3 border-b pb-4">
        <div>
          <div className="text-sm text-slate-500">改進對象 skill</div>
          <div className="font-mono font-medium text-slate-800">{item.skill_name}</div>
        </div>
        <div className="ml-auto flex items-center gap-1 text-xs">
          <button
            onClick={() => setShowCompare('side')}
            className={`px-2 py-1 rounded ${showCompare === 'side' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
          >並列</button>
          <button
            onClick={() => setShowCompare('diff')}
            className={`px-2 py-1 rounded flex items-center gap-1 ${showCompare === 'diff' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
          ><GitCompare size={12} /> diff</button>
        </div>
      </div>

      {/* rationale */}
      {item.rationale && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
          <div className="text-xs font-semibold text-blue-700 mb-1">LLM 改進理由</div>
          <div className="text-slate-700 whitespace-pre-wrap">{item.rationale}</div>
        </div>
      )}

      {/* eval summary */}
      {evalParsed && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm">
          <div className="text-xs font-semibold text-amber-700 mb-2">基於樣本</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-slate-500">失敗案例數:</span> <span className="font-mono">{evalParsed.bad_cases_count}</span></div>
            <div><span className="text-slate-500">平均誤差 %:</span> <span className="font-mono">{Number(evalParsed.avg_pct_error || 0).toFixed(2)}</span></div>
          </div>
          {evalParsed.sample && (
            <div className="mt-2 text-xs">
              <div className="text-slate-500 mb-1">前 5 筆樣本:</div>
              <ul className="space-y-0.5 font-mono text-[11px]">
                {evalParsed.sample.map((s: any, i: number) => (
                  <li key={i}>
                    {s.metal} @ {s.target_date} — pred {s.predicted}, actual {s.actual}, 誤差 {Number(s.pct_error || 0).toFixed(2)}%
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* diff / side-by-side */}
      {showCompare === 'side' ? (
        <div className="grid grid-cols-2 gap-3">
          <PromptCard title="原始 prompt" text={item.original_prompt} accent="text-slate-500" />
          <PromptCard title="提議 v2 prompt" text={item.proposed_prompt} accent="text-emerald-600" />
        </div>
      ) : (
        <DiffView original={item.original_prompt} proposed={item.proposed_prompt} />
      )}

      {/* approve / reject */}
      {item.status === 'pending' && (
        <div className="border-t pt-4 mt-4 space-y-3">
          <textarea
            value={decideComment}
            onChange={(e) => setDecideComment(e.target.value)}
            placeholder="審核意見(選填)— 例:「規則 7 範例不對,改成 X 後 OK」"
            rows={2}
            className="w-full border border-slate-200 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-400"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={onReject} disabled={decideBusy}
              className="flex items-center gap-1.5 px-4 py-2 text-sm rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              <XCircle size={14} /> 駁回
            </button>
            <button
              onClick={onApprove} disabled={decideBusy}
              className="flex items-center gap-1.5 px-4 py-2 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {decideBusy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              批准並套用
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PromptCard({ title, text, accent }: { title: string; text: string; accent: string }) {
  return (
    <div className="border border-slate-200 rounded">
      <div className={`px-3 py-2 text-xs font-semibold border-b bg-slate-50 ${accent}`}>{title}</div>
      <pre className="p-3 text-xs whitespace-pre-wrap break-words font-mono text-slate-700 max-h-[60vh] overflow-y-auto">
        {text || '(空)'}
      </pre>
    </div>
  )
}

// 簡單行級 diff(只標示新增/刪除/相同),沒有 word-level 但夠用
function DiffView({ original, proposed }: { original: string; proposed: string }) {
  const oLines = (original || '').split('\n')
  const pLines = (proposed || '').split('\n')
  const oSet = new Set(oLines)
  const pSet = new Set(pLines)
  const rows: { type: 'same' | 'add' | 'del'; text: string }[] = []
  for (const line of oLines) {
    if (pSet.has(line)) rows.push({ type: 'same', text: line })
    else rows.push({ type: 'del', text: line })
  }
  for (const line of pLines) {
    if (!oSet.has(line)) rows.push({ type: 'add', text: line })
  }
  return (
    <div className="border border-slate-200 rounded">
      <div className="px-3 py-2 text-xs font-semibold border-b bg-slate-50 text-slate-700">行級 diff</div>
      <pre className="p-3 text-xs font-mono max-h-[60vh] overflow-y-auto">
        {rows.map((r, i) => (
          <div key={i} className={`whitespace-pre-wrap break-words ${
            r.type === 'add' ? 'bg-emerald-50 text-emerald-800' :
            r.type === 'del' ? 'bg-red-50 text-red-800 line-through opacity-70' :
                               'text-slate-600'
          }`}>
            {r.type === 'add' ? '+ ' : r.type === 'del' ? '- ' : '  '}
            {r.text}
          </div>
        ))}
      </pre>
    </div>
  )
}
