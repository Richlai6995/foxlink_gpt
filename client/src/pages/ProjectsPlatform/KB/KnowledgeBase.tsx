/**
 * KB / 知識庫 — Live KB + 沉澱 KB 雙層
 *
 * 對齊 PPT slide 18 + Demo 手冊 Story 9 + spec §7-§8
 *
 * Live KB:進行中專案的 chat / form / task chunk · ACL 跟原專案
 * 沉澱 KB:結案 fork 後的不可逆快照 · 已 scrub 機密 · RAG 廣泛召回
 *
 * 結案 fork 流程(spec §7.14 + §8.1):
 *   ACTIVE → CLOSED → fork → scrub pipeline → 進沉澱 KB
 */

import { useEffect, useState } from 'react'
import { Database, Archive, MessageSquare, FileText, ListChecks, Paperclip, FolderArchive, Search, AlertTriangle, Lock, Loader2, History, Zap, RefreshCw, Sparkles, Cpu } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api } from '../api'
import { useCrumbs } from '../Shell/PlatformContext'

type Layer = 'live' | 'archived'

type LiveItem = {
  id: string
  kind: 'chat' | 'form' | 'task' | 'attach'
  title: string
  project: string
  confidential: boolean
  size: string
  updated: string
  tags: string[]
}

type ArchivedItem = {
  id: string
  title: string
  orig_project: string
  size: string
  archived_at: string
  tags: string[]
  scrub_note: string
}

const LIVE: LiveItem[] = [
  { id: 'L-2026-1142', kind: 'chat',   title: 'Apple AirPods · R0.8 設計變更討論', project: 'QT-2026-0143', confidential: true,  size: '12 chunks', updated: '今天 13:42', tags: ['結構','FEM','BOM 變更'] },
  { id: 'L-2026-1138', kind: 'form',   title: 'Tesla 高壓系列 · v3 議價策略筆記',  project: 'QT-2026-0156', confidential: true,  size: '8 chunks',  updated: '昨天 16:20', tags: ['議價','客戶溝通'] },
  { id: 'L-2026-1135', kind: 'task',   title: 'NPI Q3 · 結構應力分析報告',         project: 'GP-2026-0048', confidential: false, size: '4 chunks',  updated: '昨天 11:30', tags: ['工程','測試報告'] },
  { id: 'L-2026-1130', kind: 'chat',   title: 'IT S/4HANA 升級 · MM module 對應', project: 'IT-2026-0012', confidential: false, size: '18 chunks', updated: '4/29 14:15', tags: ['ERP','module 對應'] },
  { id: 'L-2026-1125', kind: 'attach', title: 'Sony 醫療 · 良率推估模型(xlsx)',   project: 'QT-2026-0161', confidential: false, size: '1 file',    updated: '4/28 10:00', tags: ['模型','數據'] },
]

const ARCHIVED: ArchivedItem[] = [
  { id: 'A-2025-0089', title: 'Apple 連接器 BOM 報價 · CLOSED_WIN', orig_project: 'QT-2025-0089', size: '42 chunks', archived_at: '2025-12-15', tags: ['Apple 系列','BOM','贏單'], scrub_note: '已 scrub:客戶名→A001、金額→Tier-A、毛利→MASKED' },
  { id: 'A-2025-0076', title: 'Garmin 定位模組詢價 · CLOSED_LOSS', orig_project: 'QT-2025-0076', size: '28 chunks', archived_at: '2025-11-08', tags: ['Garmin 系列','詢價','失單分析'], scrub_note: '已 scrub' },
  { id: 'A-2025-0064', title: 'Samsung 顯示連接 · CLOSED_HOLD',    orig_project: 'QT-2025-0064', size: '34 chunks', archived_at: '2025-09-22', tags: ['Samsung','顯示','客戶 hold'], scrub_note: '已 scrub' },
  { id: 'A-2025-0048', title: 'BYD 電池連接器 · CLOSED_WIN',       orig_project: 'QT-2025-0048', size: '56 chunks', archived_at: '2025-08-04', tags: ['BYD','電池','贏單'], scrub_note: '已 scrub:價格走 Tier-S' },
]

const KIND_BADGE: Record<string, { label: string; bg: string; Icon: any }> = {
  chat:   { label: '💬 chat',   bg: 'bg-cortex-cyan-bg text-cortex-teal',   Icon: MessageSquare },
  form:   { label: '📋 form',   bg: 'bg-purple-100 text-purple-700',        Icon: FileText },
  task:   { label: '✓ task',    bg: 'bg-cortex-green-bg text-cortex-green', Icon: ListChecks },
  attach: { label: '📎 attach', bg: 'bg-cortex-amber-bg text-amber-800',    Icon: Paperclip },
}

type RealChunk = {
  id: number
  project_id: number
  kind: string
  content: string
  title?: string | null
  is_sediment: number
  scrubbed: number
  scrub_note?: string | null
  created_at: string
  _signal?: 'vector' | 'fulltext' | 'hybrid' | 'like'
  _score?: number
  embedding_model?: string | null
  embedded_at?: string | null
}

type SearchMode = 'auto' | 'vector' | 'fulltext' | 'like'

type AuditRow = {
  id: number
  project_id: number
  action: string
  actor_user_id: number | null
  actor_name?: string | null
  chunks_total: number
  chunks_copied: number
  chunks_scrubbed: number
  embed_model?: string | null
  embed_count?: number
  duration_ms?: number | null
  notes?: string | null
  created_at: string
}

const SIGNAL_BADGE: Record<string, { label: string; bg: string; Icon: any }> = {
  vector:   { label: '向量',      bg: 'bg-purple-100 text-purple-700',    Icon: Sparkles },
  fulltext: { label: '全文索引',  bg: 'bg-cortex-cyan-bg text-cortex-teal', Icon: Zap },
  hybrid:   { label: '混合 RRF',  bg: 'bg-gradient-to-r from-purple-100 to-cortex-cyan-bg text-cortex-teal', Icon: Sparkles },
  like:     { label: 'LIKE 退化', bg: 'bg-cortex-amber-bg text-amber-800',  Icon: Search },
}

export default function KnowledgeBase() {
  useCrumbs([{ label: 'KB / 知識庫' }])
  const { token, user } = useAuth() as any
  const [layer, setLayer] = useState<Layer>('live')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<RealChunk[]>([])
  const [searching, setSearching] = useState(false)
  const [mode, setMode] = useState<SearchMode>('auto')
  const [projectFilter, setProjectFilter] = useState('')

  // Audit
  const [auditOpen, setAuditOpen] = useState(false)
  const [auditRows, setAuditRows] = useState<AuditRow[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [refork, setRefork] = useState(false)

  const isAdmin = user?.role === 'admin'

  const runSearch = async () => {
    if (!search.trim()) { setResults([]); return }
    setSearching(true)
    try {
      const params = new URLSearchParams({
        q: search,
        layer,
        mode,
      })
      if (projectFilter && Number(projectFilter) > 0) params.set('project_id', String(projectFilter))
      const r = await api.get<{ results: RealChunk[]; mode?: string }>(
        token,
        `/kb/search?${params}`,
      )
      setResults(r.results || [])
    } catch (e: any) {
      console.error('kb search:', e.message)
    } finally {
      setSearching(false)
    }
  }

  const loadAudit = async (pid: number) => {
    setAuditLoading(true)
    try {
      const r = await api.get<{ audit: AuditRow[] }>(token, `/kb/audit/${pid}`)
      setAuditRows(r.audit || [])
    } catch (e: any) {
      setAuditRows([])
    } finally {
      setAuditLoading(false)
    }
  }

  const doRefork = async () => {
    if (!projectFilter || Number(projectFilter) <= 0) {
      alert('請先在「project filter」輸入專案 id')
      return
    }
    if (!window.confirm(`確定要重 fork project #${projectFilter}? (force 會刪舊沉澱 chunk)`)) return
    setRefork(true)
    try {
      const r = await api.post(token, `/kb/fork/${Number(projectFilter)}`, { force: true, notes: 'manual UI re-fork' })
      alert(`重 fork OK · copied=${(r as any).copied} scrubbed=${(r as any).scrubbed}`)
      loadAudit(Number(projectFilter))
    } catch (e: any) {
      alert('重 fork 失敗:' + e.message)
    } finally {
      setRefork(false)
    }
  }

  // 切到「審計」自動載 audit(若有 project_id)
  useEffect(() => {
    if (auditOpen && projectFilter && Number(projectFilter) > 0) {
      loadAudit(Number(projectFilter))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditOpen, projectFilter])

  return (
    <div className="space-y-4">
      {/* Page head */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-cortex-ink tracking-tight">📚 KB · 知識庫</h1>
          <div className="text-[12px] text-cortex-muted mt-1">spec §7 · 雙層架構(Live + 沉澱)· RAG 友善 · 機密 / 非機密不混(§7.10)</div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            type="number"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            placeholder="project id(可空)"
            className="h-8 px-2 border border-cortex-line bg-white rounded text-[12px] focus:outline-none focus:border-cortex-cyan w-32 font-mono"
          />
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as SearchMode)}
            className="h-8 px-2 border border-cortex-line bg-white rounded text-[12px] focus:outline-none focus:border-cortex-cyan"
            title="搜尋模式"
          >
            <option value="auto">auto (hybrid)</option>
            <option value="vector">vector only</option>
            <option value="fulltext">Oracle Text</option>
            <option value="like">LIKE only</option>
          </select>
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-cortex-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch() }}
              placeholder="搜 KB chunk(後端真實)..."
              className="h-8 pl-8 pr-3 border border-cortex-line bg-white rounded text-[12px] focus:outline-none focus:border-cortex-cyan w-60"
            />
          </div>
          <button
            onClick={runSearch}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-cortex-line bg-white rounded hover:bg-cortex-bg"
          >
            {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            搜尋
          </button>
          <button
            onClick={() => setAuditOpen((v) => !v)}
            disabled={!projectFilter}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-cortex-line bg-white rounded hover:bg-cortex-bg disabled:opacity-40"
            title="須輸入 project id"
          >
            <History size={12} /> 審計
          </button>
          {isAdmin && (
            <button
              onClick={doRefork}
              disabled={refork || !projectFilter}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-cortex-amber text-cortex-navy rounded hover:opacity-90 disabled:opacity-40 font-semibold"
              title="強制重 fork(會刪舊沉澱 chunk · admin only)"
            >
              {refork ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              重 fork
            </button>
          )}
        </div>
      </div>

      {/* Audit log panel(toggle 開才顯)*/}
      {auditOpen && projectFilter && (
        <div className="bg-white border border-cortex-line rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] font-bold text-cortex-ink inline-flex items-center gap-1.5">
              <History size={13} /> Sediment 審計記錄 · project #{projectFilter}
            </div>
            <span className="text-[10px] text-cortex-muted">{auditRows.length} 筆</span>
          </div>
          {auditLoading ? (
            <div className="text-center text-cortex-muted text-[12px] py-3">
              <Loader2 size={14} className="inline animate-spin mr-1" /> 載入中…
            </div>
          ) : auditRows.length === 0 ? (
            <div className="text-center text-cortex-muted text-[12px] py-3 italic">
              尚無記錄 · 結案 fork 觸發時會在此列出
            </div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="text-[9px] text-cortex-muted uppercase tracking-wider border-b border-cortex-line">
                <tr>
                  <th className="text-left py-1 px-2">動作</th>
                  <th className="text-left py-1 px-2">執行者</th>
                  <th className="text-right py-1 px-2">chunks</th>
                  <th className="text-right py-1 px-2">scrubbed</th>
                  <th className="text-right py-1 px-2">embed</th>
                  <th className="text-right py-1 px-2">耗時 (ms)</th>
                  <th className="text-left py-1 px-2">時間</th>
                  <th className="text-left py-1 px-2">備註</th>
                </tr>
              </thead>
              <tbody>
                {auditRows.map((a) => (
                  <tr key={a.id} className="border-b border-cortex-line/40 hover:bg-cortex-line-2/30">
                    <td className="py-1.5 px-2">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        a.action === 'fork' ? 'bg-cortex-green-bg text-cortex-green' :
                        a.action === 're_fork' ? 'bg-cortex-amber-bg text-amber-800' :
                        a.action === 'embed' ? 'bg-purple-100 text-purple-700' :
                        a.action === 'error' ? 'bg-cortex-red-bg text-red-700' :
                        'bg-cortex-line-2 text-cortex-text'
                      }`}>{a.action}</span>
                    </td>
                    <td className="py-1.5 px-2">{a.actor_name || `user#${a.actor_user_id || '?'}`}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{a.chunks_copied}/{a.chunks_total}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{a.chunks_scrubbed}</td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      {a.embed_model ? `${a.embed_count} · ${a.embed_model.split('-').pop()}` : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-right text-cortex-muted">{a.duration_ms || '—'}</td>
                    <td className="py-1.5 px-2 text-cortex-muted text-[10px]">
                      {new Date(a.created_at).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-1.5 px-2 text-[10px] text-cortex-text">{a.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Layer toggle */}
      <div className="bg-white border border-cortex-line rounded-xl p-3.5 flex items-center gap-3.5 flex-wrap">
        <div className="inline-flex rounded-md border border-cortex-line bg-cortex-line-2/40 overflow-hidden">
          <button
            onClick={() => setLayer('live')}
            className={`px-3.5 py-2 text-[13px] font-semibold inline-flex items-center gap-1.5 transition ${
              layer === 'live' ? 'bg-cortex-cyan text-cortex-navy' : 'text-cortex-text hover:bg-white'
            }`}
          >
            <Database size={13} /> Live KB
          </button>
          <button
            onClick={() => setLayer('archived')}
            className={`px-3.5 py-2 text-[13px] font-semibold inline-flex items-center gap-1.5 transition ${
              layer === 'archived' ? 'bg-cortex-amber text-cortex-navy' : 'text-cortex-text hover:bg-white'
            }`}
          >
            <Archive size={13} /> 沉澱 KB
          </button>
        </div>
        <div className="text-[12px] text-cortex-muted">
          {layer === 'live'
            ? '進行中專案的 chat/form/task chunk · ACL 跟原專案 · 結案後 fork 進沉澱 KB(走 §8 scrub)'
            : '結案專案 fork 後的不可逆快照 · 已 scrub 機密欄位 · 給未來 RAG 召回用'}
        </div>
        <div className="ml-auto text-[11px] font-mono text-cortex-muted">
          Live: <strong className="text-cortex-ocean">{LIVE.length}</strong> ·
          {' '}沉澱: <strong className="text-cortex-teal">{ARCHIVED.length}</strong>
        </div>
      </div>

      {/* Info banner */}
      {layer === 'live' ? (
        <div className="bg-gradient-to-b from-cortex-cyan-bg/40 to-white border border-cortex-cyan/30 rounded-lg p-3.5 text-[12px] text-cortex-teal leading-relaxed">
          <strong className="text-cortex-navy">💡 Live KB 特性</strong>(spec §7.7、§7.8)
          <ul className="mt-1 space-y-0.5">
            <li>• 進行中專案的 chunk <strong>即時可被 RAG 召回</strong>(§7.7 一致性策略)</li>
            <li>• ACL 完全跟原專案的 confidentiality + project_members</li>
            <li>• 結案時走 <strong>Archive Pipeline → 沉澱 KB</strong>(§7.8、§8 scrub 必須在進 KB 之前)</li>
            <li>• Phase 2 加 Title embedding 強化(§7.9.3)</li>
          </ul>
        </div>
      ) : (
        <div className="bg-gradient-to-b from-cortex-amber-bg/50 to-white border border-amber-300 rounded-lg p-3.5 text-[12px] text-amber-900 leading-relaxed">
          <strong>📦 沉澱 KB 特性</strong>(spec §8 結案 fork)
          <ul className="mt-1 space-y-0.5">
            <li>• 結案後 fork 的 <strong>不可逆</strong>快照(§8.2)</li>
            <li>• 機密欄位已 scrub:客戶名 → Alias / 金額 → Tier / 毛利 → MASKED</li>
            <li>• 召回時不需要原專案 ACL,可被廣泛 RAG 檢索</li>
            <li>• 走 §8 fork(不用 view)是因為要切斷與原 source data 的關聯</li>
          </ul>
        </div>
      )}

      {/* Real KB search results(後端真實 chunk)*/}
      {results.length > 0 && (
        <div className="bg-gradient-to-br from-cortex-cyan-bg/40 to-white border border-cortex-cyan/30 rounded-xl p-4">
          <div className="text-[11px] font-bold text-cortex-teal mb-2">
            🔍 後端真實搜尋結果(query: "{search}" · {layer} · mode={mode})· {results.length} 筆
          </div>
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {results.map((c) => {
              const sig = c._signal && SIGNAL_BADGE[c._signal]
              return (
                <div key={c.id} className="bg-white border border-cortex-line rounded p-2.5 text-[12px]">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[10px] font-mono text-cortex-ocean font-bold">#{c.id}</span>
                    <span className="text-[10px] bg-cortex-bg text-cortex-text px-1.5 py-0.5 rounded">{c.kind}</span>
                    <span className="text-[10px] text-cortex-muted">project #{c.project_id}</span>
                    {sig && (
                      <span className={`text-[10px] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-bold ${sig.bg}`}>
                        <sig.Icon size={9} /> {sig.label}
                      </span>
                    )}
                    {typeof c._score === 'number' && (
                      <span className="text-[9px] font-mono text-cortex-ocean">
                        score {c._score.toFixed(3)}
                      </span>
                    )}
                    {c.embedding_model && (
                      <span className="text-[9px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded font-mono inline-flex items-center gap-0.5">
                        <Cpu size={8} /> {c.embedding_model.split('-').pop()}
                      </span>
                    )}
                    {Number(c.scrubbed) === 1 && (
                      <span className="text-[10px] bg-cortex-amber-bg text-amber-800 px-1.5 py-0.5 rounded font-bold">已 scrub</span>
                    )}
                    {Number(c.is_sediment) === 1 && (
                      <span className="text-[10px] bg-cortex-amber-bg text-amber-800 px-1.5 py-0.5 rounded font-bold">📦 沉澱</span>
                    )}
                    <span className="ml-auto text-[10px] text-cortex-muted">{new Date(c.created_at).toLocaleString('zh-TW')}</span>
                  </div>
                  {c.title && (
                    <div className="text-[11px] font-semibold text-cortex-ink mb-0.5">{c.title}</div>
                  )}
                  <div className="text-cortex-ink leading-relaxed line-clamp-3">{c.content}</div>
                  {c.scrub_note && (
                    <div className="text-[10px] text-amber-700 mt-1 italic">{c.scrub_note}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* KB items table(mock 展示)*/}
      <div className="bg-white border border-cortex-line rounded-xl overflow-hidden">
        <div className="grid grid-cols-[100px_1fr_140px_100px_120px] gap-3 px-4 py-2.5 bg-cortex-bg border-b border-cortex-line text-[10px] font-bold text-cortex-muted uppercase tracking-widest">
          <div>類型</div>
          <div>標題</div>
          <div>{layer === 'live' ? '專案' : '原專案'}</div>
          <div>規模</div>
          <div>{layer === 'live' ? '更新' : '歸檔'}</div>
        </div>

        {layer === 'live' && LIVE.map((it) => {
          const k = KIND_BADGE[it.kind]
          return (
            <div key={it.id} className="grid grid-cols-[100px_1fr_140px_100px_120px] gap-3 px-4 py-3 items-center border-b border-cortex-line last:border-b-0 hover:bg-cortex-bg cursor-pointer text-[12px]">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded inline-block w-fit ${k.bg}`}>
                {k.label}
              </span>
              <div>
                <div className="text-[13px] font-semibold text-cortex-ink flex items-center gap-2">
                  {it.title}
                  {it.confidential && (
                    <span className="text-[9px] bg-cortex-amber-bg text-amber-800 px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-0.5">
                      <Lock size={8} /> 機密
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-cortex-muted mt-0.5 flex flex-wrap gap-1">
                  {it.tags.map((t) => (
                    <span key={t} className="bg-cortex-ocean-bg text-cortex-ocean px-1.5 py-0.5 rounded">{t}</span>
                  ))}
                </div>
              </div>
              <span className="font-mono text-[11px] text-cortex-ocean font-semibold">{it.project}</span>
              <span className="font-mono text-[11px] text-cortex-muted">{it.size}</span>
              <span className="font-mono text-[11px] text-cortex-text">{it.updated}</span>
            </div>
          )
        })}

        {layer === 'archived' && ARCHIVED.map((it) => (
          <div key={it.id} className="grid grid-cols-[100px_1fr_140px_100px_120px] gap-3 px-4 py-3 items-center border-b border-cortex-line last:border-b-0 hover:bg-cortex-bg cursor-pointer text-[12px]">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 inline-block w-fit">
              📂 case
            </span>
            <div>
              <div className="text-[13px] font-semibold text-cortex-ink">{it.title}</div>
              <div className="text-[10px] text-cortex-muted mt-0.5 flex flex-wrap gap-1">
                {it.tags.map((t) => (
                  <span key={t} className="bg-cortex-ocean-bg text-cortex-ocean px-1.5 py-0.5 rounded">{t}</span>
                ))}
              </div>
              <div className="text-[10px] text-amber-800 bg-cortex-amber-bg/60 mt-1 px-2 py-0.5 rounded inline-block">
                ⚠ {it.scrub_note}
              </div>
            </div>
            <span className="font-mono text-[11px] text-cortex-ocean font-semibold">{it.orig_project}</span>
            <span className="font-mono text-[11px] text-cortex-muted">{it.size}</span>
            <span className="font-mono text-[11px] text-cortex-text">{it.archived_at}</span>
          </div>
        ))}
      </div>

      {/* Archive Pipeline 流程 */}
      {layer === 'archived' && (
        <div className="bg-white border border-dashed border-cortex-line rounded-xl p-4 text-[12px] text-cortex-text leading-relaxed">
          <div className="font-bold text-cortex-ink mb-2 flex items-center gap-1.5">
            <FolderArchive size={14} className="text-cortex-teal" />
            🔁 Archive Pipeline 流程(spec §7.14、§8.1)
          </div>
          <ol className="space-y-1 list-decimal pl-5">
            <li>專案 lifecycle:ACTIVE → CLOSED · PM 觸發結案</li>
            <li>系統 fork 專案 → 建立 archived snapshot</li>
            <li>走 <strong>scrub pipeline</strong>(§7.14、§8.1)— 客戶名 / 金額 / 毛利 等欄位走 confidentialityMiddleware 替換</li>
            <li>scrub 後的 chunk 進沉澱 KB(走 RAG embedding pipeline)</li>
            <li>原 Live KB chunk 標 archived,但 Live KB 仍可在過渡期查到(§7.7 一致性)</li>
          </ol>
          <div className="mt-3 bg-cortex-red-bg/50 border-l-2 border-cortex-red rounded-r p-2.5 text-[11px] text-red-700">
            <AlertTriangle size={11} className="inline -mt-px mr-0.5" />
            <strong>不可逆</strong>:沉澱 KB 一旦寫入無法回退 · 機密 scrub 必須在進 KB 前完成
          </div>
        </div>
      )}

      {/* Sample RAG query */}
      <div className="bg-gradient-to-br from-cortex-navy to-cortex-teal text-white rounded-xl p-4">
        <div className="text-[10px] font-bold text-cortex-cyan tracking-widest mb-2">💬 範例 RAG 查詢</div>
        <div className="text-[12px] italic mb-2 leading-relaxed">
          "USB-C 給車用客戶過去策略?"
        </div>
        <div className="text-[11px] text-cortex-cyan-bg/90 leading-relaxed">
          → 找到 <strong className="text-cortex-cyan">3 案</strong> → <strong>2 Win / 1 Loss</strong> · 平均毛利 Tier-M<br />
          → 依 fork 後 scrub 過的內容,跨專案 RAG 召回,不需要原 ACL
        </div>
      </div>
    </div>
  )
}
