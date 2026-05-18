/**
 * BiTab — Sprint L · AI 戰情 embed 進專案頁
 *
 * 對應 spec §10.5。不重做 BI,沿用 Cortex 既有 /dashboard 平台。
 *
 * UI:
 *   - 左欄:設計列表(filter by 我可看 / BU)
 *   - 右欄:iframe embed selected design with project_id context
 *     · URL:/dashboard?design={id}&project_id={pid}&embed=1
 *     · 開啟「在新分頁打開」按鈕(若 iframe 太擠)
 *
 * 注意:iframe 走相同 origin(同 host)無 CSP 問題。
 *       無 sandbox(沿用 user 既有權限,Cortex 既有 auth 自動帶 cookie)
 */

import { useEffect, useState } from 'react'
import { BarChart3, ExternalLink, Search, Loader2, Eye, Sparkles, BookOpen } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import api from '../../../lib/api'
import type { ProjectDetail } from '../api'

type Design = {
  id: number
  name?: string | null
  name_zh?: string | null
  name_en?: string | null
  name_vi?: string | null
  description?: string | null
  desc_zh?: string | null
  desc_en?: string | null
  bu_id?: number | null
  is_suspended?: number
  thumbnail_url?: string | null
}

type Topic = {
  id: number
  name?: string | null
  name_zh?: string | null
  designs?: Design[]
}

type Props = { project: ProjectDetail }

export default function BiTab({ project }: Props) {
  const { user, isAdmin } = useAuth() as any
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [selectedDesign, setSelectedDesign] = useState<Design | null>(null)
  const [q, setQ] = useState('')
  const [onlyMyBu, setOnlyMyBu] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get<Topic[]>('/dashboard/topics')
      .then((r) => {
        setTopics(r.data || [])
      })
      .catch((e: any) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  // 攤平 designs + filter
  const allDesigns: { design: Design; topic: Topic }[] = []
  for (const t of topics) {
    for (const d of (t.designs || [])) {
      if (Number(d.is_suspended) === 1) continue
      allDesigns.push({ design: d, topic: t })
    }
  }

  const filtered = allDesigns.filter(({ design, topic }) => {
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      const hay = [
        design.name, design.name_zh, design.name_en, design.description, design.desc_zh,
        topic.name, topic.name_zh,
      ].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(needle)) return false
    }
    if (onlyMyBu && project.bu_id) {
      if (design.bu_id && Number(design.bu_id) !== Number(project.bu_id)) return false
    }
    return true
  })

  if (loading) {
    return (
      <div className="p-8 text-center text-cortex-muted">
        <Loader2 size={20} className="inline animate-spin mr-1" /> 載入 BI 設計清單…
      </div>
    )
  }

  if (err) {
    return (
      <div className="p-6">
        <div className="bg-cortex-red-bg/40 border border-red-200 rounded p-3 text-[12px] text-red-700">
          無法載入 BI 戰情清單:{err}
          <div className="text-[11px] text-cortex-muted mt-2 italic">
            可能因素:Cortex AI 戰情未啟用 / 此 user 無 can_use_ai_dashboard 權限
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[280px_1fr] h-[600px] divide-x divide-cortex-line">
      {/* Left: design list */}
      <aside className="overflow-y-auto bg-cortex-bg/40">
        <div className="p-3 border-b border-cortex-line space-y-2">
          <div className="text-[11px] font-bold text-cortex-muted uppercase tracking-widest inline-flex items-center gap-1">
            <BarChart3 size={11} /> Cortex BI 設計 ({filtered.length})
          </div>
          <div className="relative">
            <Search size={11} className="absolute left-2 top-2 text-cortex-muted" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜尋設計 / topic…"
              className="w-full pl-7 pr-2 py-1 border border-cortex-line rounded text-[11px] bg-white focus:outline-none focus:border-cortex-cyan"
            />
          </div>
          {project.bu_id && (
            <label className="text-[10px] text-cortex-text flex items-center gap-1">
              <input
                type="checkbox"
                checked={onlyMyBu}
                onChange={(e) => setOnlyMyBu(e.target.checked)}
              />
              只看本案 BU(#{project.bu_id})
            </label>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-cortex-muted italic">
            無符合的設計
          </div>
        ) : (
          <ul>
            {filtered.map(({ design, topic }) => {
              const active = selectedDesign?.id === design.id
              const name = design.name_zh || design.name || `design#${design.id}`
              const desc = design.desc_zh || design.description || ''
              return (
                <li key={design.id}>
                  <button
                    onClick={() => setSelectedDesign(design)}
                    className={`block w-full text-left px-3 py-2 border-b border-cortex-line/50 transition ${
                      active ? 'bg-cortex-cyan-bg' : 'hover:bg-cortex-line-2/40'
                    }`}
                  >
                    <div className={`text-[12px] font-semibold truncate ${active ? 'text-cortex-teal' : 'text-cortex-ink'}`}>
                      {name}
                    </div>
                    <div className="text-[9px] text-cortex-muted mt-0.5">
                      {topic.name_zh || topic.name || '—'}
                      {design.bu_id && <span className="ml-1 font-mono">· BU#{design.bu_id}</span>}
                    </div>
                    {desc && (
                      <div className="text-[10px] text-cortex-text mt-0.5 line-clamp-2">{desc}</div>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </aside>

      {/* Right: iframe embed */}
      <main className="bg-white flex flex-col min-w-0">
        {!selectedDesign ? (
          <Placeholder project={project} />
        ) : (
          <DesignEmbed design={selectedDesign} project={project} isAdmin={isAdmin} userId={user?.id} />
        )}
      </main>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
function Placeholder({ project }: { project: ProjectDetail }) {
  return (
    <div className="p-8 flex items-center justify-center h-full">
      <div className="max-w-md text-center">
        <BarChart3 size={48} className="mx-auto text-cortex-muted mb-3" />
        <div className="text-[14px] font-bold text-cortex-ink mb-1">📊 BI 戰情 · embed</div>
        <div className="text-[12px] text-cortex-muted leading-relaxed">
          spec §10.5 — 不重做 BI,沿用 Cortex 既有 AI 戰情。<br />
          從左欄選一個設計 → 即時顯示對應 chart。
        </div>
        <div className="mt-4 inline-block text-[10px] text-cortex-text bg-cortex-bg border border-cortex-line rounded px-3 py-2 font-mono">
          專案 BU: {project.bu_id ?? '—'}<br />
          專案類型: {project.type_code}<br />
          lifecycle: {project.lifecycle_status}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
function DesignEmbed({ design, project, isAdmin, userId }: { design: Design; project: ProjectDetail; isAdmin: boolean; userId?: number }) {
  const [reloadKey, setReloadKey] = useState(0)
  const name = design.name_zh || design.name || `design#${design.id}`

  // 走 same-origin /dashboard?design=N · 加 project_id 給後續 dashboard query 用
  const url = `/dashboard?design=${design.id}&project_id=${project.id}&embed=1`
  const openExternal = `/dashboard?design=${design.id}&project_id=${project.id}`

  return (
    <>
      <div className="border-b border-cortex-line px-4 py-2 flex items-center gap-2 bg-cortex-bg/30">
        <BarChart3 size={14} className="text-cortex-teal" />
        <span className="text-[13px] font-bold text-cortex-ink">{name}</span>
        {design.bu_id && (
          <span className="text-[9px] font-mono bg-cortex-cyan-bg text-cortex-teal px-1.5 py-0.5 rounded">
            BU#{design.bu_id}
          </span>
        )}
        <span className="text-[10px] text-cortex-muted">
          · spec §10.5 embed · context: project #{project.id} ({project.bu_id ? `BU#${project.bu_id}` : 'no-bu'})
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="text-[10px] text-cortex-ocean hover:underline inline-flex items-center gap-0.5"
            title="重新載入 iframe"
          >
            <Loader2 size={10} /> reload
          </button>
          <span className="text-cortex-muted mx-1">·</span>
          <a
            href={openExternal}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-cortex-ocean hover:underline inline-flex items-center gap-0.5"
          >
            <ExternalLink size={10} /> 新分頁打開
          </a>
        </div>
      </div>

      {/* spec §10.5.2 iframe 安全:同源不另設 sandbox,沿用 user 既有 cookie auth */}
      <iframe
        key={reloadKey}
        src={url}
        className="flex-1 w-full border-0 bg-white"
        title={`BI design ${design.id}`}
      />

      <div className="px-4 py-1.5 border-t border-cortex-line bg-cortex-bg/30 text-[10px] text-cortex-muted flex items-center gap-3">
        <Eye size={10} /> 你的視角 user#{userId || '—'}{isAdmin && <span className="text-amber-600 font-bold">[admin]</span>}
        <span className="mx-1">·</span>
        <Sparkles size={10} /> 機密欄位走平台 confidentialityMiddleware(spec §10.6)
        <span className="mx-1">·</span>
        <BookOpen size={10} /> spec §10.5 embed
      </div>
    </>
  )
}
