import { useEffect, useState } from 'react'
import { Search, Play, Database, Bug } from 'lucide-react'
import api from '../../lib/api'

interface KbOpt {
  id: string
  name: string
  chunk_count: number
  embedding_dims: number | null
}

interface SlimChunk {
  id: string
  filename: string
  score: number
  match_type?: string
  content: string
  rerank_score?: number | null
}

interface DebugStats {
  backend: string
  mode: string
  tokens_extracted: string[]
  ctx_query: string | null
  fusion_method: string
  vec_fetched: number
  ft_fetched: number
  fused: number
  after_threshold: number
  rerank_applied: boolean
  rerank_model: string | null
  final: number
  elapsed_ms: number
  stages?: {
    vector:   SlimChunk[]
    fulltext: SlimChunk[]
    fused:    SlimChunk[]
    rerank:   SlimChunk[]
  }
  resolved_config?: Record<string, unknown>
}

type Stage = 'vector' | 'fulltext' | 'fused' | 'rerank'

export default function KbRetrievalDebug() {
  const [kbs,    setKbs]    = useState<KbOpt[]>([])
  const [kbId,   setKbId]   = useState('')
  const [query,  setQuery]  = useState('')
  const [topK,   setTopK]   = useState(10)
  const [busy,   setBusy]   = useState(false)
  const [err,    setErr]    = useState('')
  const [stats,  setStats]  = useState<DebugStats | null>(null)
  const [ovBackend, setOvBackend] = useState<'' | 'like' | 'oracle_text'>('')
  const [ovFusion,  setOvFusion]  = useState<'' | 'weighted' | 'rrf'>('')

  useEffect(() => {
    api.get('/admin/kb/list-simple').then((r) => {
      setKbs(r.data)
      if (r.data.length > 0) setKbId(r.data[0].id)
    }).catch((e) => setErr(e.response?.data?.error || '載入 KB 列表失敗'))
  }, [])

  const run = async () => {
    if (!kbId || !query.trim()) return
    setBusy(true); setErr(''); setStats(null)
    try {
      const config_override: Record<string, unknown> = {}
      if (ovBackend) config_override.backend = ovBackend
      if (ovFusion)  config_override.fusion_method = ovFusion
      const res = await api.post('/admin/kb/debug-search', {
        kb_id: kbId,
        query,
        topK,
        config_override: Object.keys(config_override).length > 0 ? config_override : undefined,
      })
      setStats(res.data.stats)
    } catch (e: any) {
      setErr(e.response?.data?.error || '查詢失敗')
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center gap-2">
        <Bug size={18} className="text-slate-600" />
        <h2 className="text-base font-semibold text-slate-800">KB 檢索調校</h2>
      </div>
      <p className="text-xs text-slate-500">
        同一 query 對同一 KB 跑檢索，並排顯示各階段（Vector / Fulltext / Fused / Rerank）結果，用於 tuning。
      </p>

      {/* Query panel */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="grid grid-cols-4 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-slate-500">知識庫</label>
            <select className="input w-full" value={kbId} onChange={(e) => setKbId(e.target.value)}>
              {kbs.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} — {k.chunk_count.toLocaleString()} chunks ({k.embedding_dims ?? '—'}d)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">TopK</label>
            <input
              type="number" min={1} max={50}
              className="input w-full"
              value={topK}
              onChange={(e) => setTopK(parseInt(e.target.value) || 10)}
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={run}
              disabled={busy || !kbId || !query.trim()}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              <Play size={14} /> {busy ? '檢索中…' : '執行'}
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500">Query</label>
          <input
            type="text"
            className="input w-full"
            placeholder="輸入檢索詞…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) run() }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500">Backend 臨時覆寫</label>
            <select className="input w-full" value={ovBackend} onChange={(e) => setOvBackend(e.target.value as any)}>
              <option value="">— 使用 KB 設定 —</option>
              <option value="like">LIKE</option>
              <option value="oracle_text">Oracle Text</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Fusion 臨時覆寫</label>
            <select className="input w-full" value={ovFusion} onChange={(e) => setOvFusion(e.target.value as any)}>
              <option value="">— 使用 KB 設定 —</option>
              <option value="weighted">Weighted</option>
              <option value="rrf">RRF</option>
            </select>
          </div>
        </div>
      </div>

      {err && <div className="text-sm text-red-500">{err}</div>}

      {/* Results */}
      {stats && (
        <>
          {/* Summary */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
            <div className="text-sm font-medium text-slate-700">檢索摘要</div>
            <div className="grid grid-cols-4 gap-3 text-xs">
              <Stat label="Backend" value={stats.backend} />
              <Stat label="Mode" value={stats.mode} />
              <Stat label="Fusion" value={stats.fusion_method} />
              <Stat label="Elapsed" value={`${stats.elapsed_ms}ms`} />
              <Stat label="Vector 撈到" value={stats.vec_fetched} />
              <Stat label="Fulltext 撈到" value={stats.ft_fetched} />
              <Stat label="Fused" value={stats.fused} />
              <Stat label="After threshold" value={stats.after_threshold} />
              <Stat label="Rerank" value={stats.rerank_applied ? (stats.rerank_model || 'yes') : 'no'} />
              <Stat label="Final" value={stats.final} />
            </div>
            {stats.tokens_extracted.length > 0 && (
              <div className="text-xs text-slate-500 pt-1">
                Tokens: {stats.tokens_extracted.map((t, i) => (
                  <code key={i} className="mr-1 px-1.5 py-0.5 bg-slate-200 rounded">{t}</code>
                ))}
              </div>
            )}
            {stats.ctx_query && (
              <div className="text-xs text-slate-500">
                CONTAINS query: <code className="bg-slate-200 px-1 rounded">{stats.ctx_query}</code>
              </div>
            )}
          </div>

          {/* Stages side by side */}
          {stats.stages && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StageColumn title="Vector"   items={stats.stages.vector}   />
              <StageColumn title="Fulltext" items={stats.stages.fulltext} />
              <StageColumn title="Fused"    items={stats.stages.fused}    />
              <StageColumn title="Rerank"   items={stats.stages.rerank}   showRerankScore />
            </div>
          )}

          {/* Resolved config */}
          {stats.resolved_config && (
            <details className="bg-slate-50 rounded-xl border border-slate-200 p-4">
              <summary className="text-sm font-medium text-slate-700 cursor-pointer">解析後的 config（kb + system + hardcoded）</summary>
              <pre className="mt-3 text-xs font-mono bg-white p-3 rounded border border-slate-200 overflow-x-auto">
                {JSON.stringify(stats.resolved_config, null, 2)}
              </pre>
            </details>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-slate-500">{label}</div>
      <div className="font-mono text-slate-800">{String(value)}</div>
    </div>
  )
}

function StageColumn({ title, items, showRerankScore }: { title: string; items: SlimChunk[]; showRerankScore?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col">
      <div className="px-3 py-2 bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5">
        <Database size={12} /> {title} ({items.length})
      </div>
      <div className="flex-1 overflow-y-auto max-h-[540px] divide-y divide-slate-100">
        {items.length === 0 && (
          <div className="p-3 text-xs text-slate-400 italic">（無結果）</div>
        )}
        {items.map((it, i) => (
          <div key={`${it.id}-${i}`} className="p-3 space-y-1">
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span className="truncate" title={it.filename}>#{i + 1} {it.filename}</span>
              <span className="font-mono text-slate-700 whitespace-nowrap ml-2">
                {showRerankScore && it.rerank_score != null
                  ? `r=${it.rerank_score.toFixed(3)}`
                  : (it.score != null ? it.score.toFixed(3) : '—')}
              </span>
            </div>
            <div className="text-[11px] text-slate-600 line-clamp-3 leading-snug">{it.content}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
