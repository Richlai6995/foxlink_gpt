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

import { useState } from 'react'
import { Database, Archive, MessageSquare, FileText, ListChecks, Paperclip, FolderArchive, Search, AlertTriangle, Lock } from 'lucide-react'
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

export default function KnowledgeBase() {
  useCrumbs([{ label: 'KB / 知識庫' }])
  const [layer, setLayer] = useState<Layer>('live')

  return (
    <div className="space-y-4">
      {/* Page head */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-cortex-ink tracking-tight">📚 KB · 知識庫</h1>
          <div className="text-[12px] text-cortex-muted mt-1">spec §7 · 雙層架構(Live + 沉澱)· RAG 友善 · 機密 / 非機密不混(§7.10)</div>
        </div>
        <div className="flex gap-2">
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-cortex-line bg-white rounded">
            <Search size={12} /> RAG 搜尋
          </button>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-cortex-line bg-white rounded">
            📊 KB 健康度
          </button>
        </div>
      </div>

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

      {/* KB items table */}
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
