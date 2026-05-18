/**
 * Dashboard — 跨專案儀表板(主管視角 BI)
 *
 * 對齊 PPT slide 13-14 + HTML demo renderDashboard()
 *
 * 7 widget:
 *   1. SLA 燈號(超期/接近/正常/暫停)
 *   2. 我的關注專案 Watchlist(priority_score ≥ 6 自動訂閱)+ hover 顯示完整 Status SUMMARY
 *   3. 我的 Task(紅/黃/綠 計數)
 *   4. 待 Review(form / task)
 *   5. Delay 熱點(per stage)
 *   6. 本期 KPI
 *   7. 成員負載熱圖
 *
 * + AI 預測警示 3 phase 卡(規則式 ✓ / RAG ⏳ / ML ○)
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Flame, Star, CheckCircle2, ClipboardList, TrendingUp, Users as UsersIcon, Sparkles,
  Download, Settings, Sun, Loader2, X,
} from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { api, type DashboardData, type StatusSummary, type SlaLight } from '../api'
import { useCrumbs, usePlatform } from '../Shell/PlatformContext'
import WatchlistTooltip from './WatchlistTooltip'

const SLA_STYLE: Record<SlaLight, { dot: string; bg: string; text: string; border: string; label: string }> = {
  red:    { dot: 'bg-cortex-red',    bg: 'bg-cortex-red-bg',     text: 'text-red-700',    border: 'border-red-300',    label: '超期' },
  yellow: { dot: 'bg-cortex-amber',  bg: 'bg-cortex-amber-bg',   text: 'text-amber-700',  border: 'border-amber-300',  label: '接近' },
  green:  { dot: 'bg-cortex-green',  bg: 'bg-cortex-green-bg',   text: 'text-green-700',  border: 'border-green-300',  label: '正常' },
  gray:   { dot: 'bg-cortex-muted',  bg: 'bg-cortex-line-2',     text: 'text-cortex-muted', border: 'border-cortex-line', label: '暫停' },
}

export default function Dashboard() {
  useCrumbs([{ label: '跨專案儀表板' }])
  const { token } = useAuth() as any
  const { demoRole } = usePlatform()
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = async () => {
    if (!token) return
    setLoading(true)
    setErr(null)
    try {
      const d = await api.get<DashboardData>(token, '/dashboard')
      setData(d)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, demoRole])

  if (err) {
    return <div className="p-4 bg-cortex-red-bg border border-red-200 rounded text-red-700 text-sm">無法載入儀表板:{err}</div>
  }
  if (!data) return <div className="text-cortex-muted text-sm p-4">Loading dashboard…</div>

  return (
    <div className="space-y-4">
      {/* Page head */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-cortex-ink tracking-tight">跨專案儀表板</h1>
          <div className="text-[12px] text-cortex-muted mt-1">
            主管視角 BI · 7 widget 即時 query · spec §16.3 · 從燈號到專案頁最多 2 次點擊
          </div>
        </div>
        <div className="flex gap-2">
          <DailyReportButton />
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] border border-cortex-line bg-white rounded hover:bg-cortex-bg">
            <Download size={13} /> 匯出 PDF
          </button>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] border border-cortex-line bg-white rounded text-cortex-muted">
            <Settings size={13} /> 自訂 widget (Phase 2)
          </button>
        </div>
      </div>

      {/* Widget 1: SLA Lights */}
      <Widget icon="🚦" title="Widget 1 · SLA 燈號統計" action="點燈號 drill-down">
        <div className="grid grid-cols-4 gap-2.5">
          {(['red', 'yellow', 'green', 'gray'] as SlaLight[]).map((c) => {
            const s = SLA_STYLE[c]
            return (
              <button
                key={c}
                onClick={() => navigate('/projects-platform')}
                className={`${s.bg} ${s.text} ${s.border} border rounded-lg p-3.5 text-left hover:-translate-y-px transition`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} />
                  <span className="text-[11px] font-bold">{s.label}</span>
                </div>
                <div className="text-[28px] font-mono font-extrabold leading-none">{data.sla_lights[c]}</div>
                <div className="text-[10px] mt-1.5">點 → {c === 'red' ? '超期清單' : c === 'yellow' ? '預警清單' : c === 'green' ? '進行中' : 'PAUSED'}</div>
              </button>
            )
          })}
        </div>
      </Widget>

      <div className="grid grid-cols-[2fr_1fr] gap-3.5">
        {/* Widget 2: Watchlist */}
        <Widget
          icon={<Star size={14} />}
          title="Widget 2 · 我的關注專案"
          action={<span className="text-[10px] bg-cortex-cyan-bg text-cortex-teal px-1.5 py-0.5 rounded">priority_score ≥ 6 自動訂閱</span>}
        >
          <div className="space-y-1.5">
            {data.watchlist.length === 0 && (
              <div className="text-center text-cortex-muted text-sm py-6">尚無關注專案(priority_score &gt;= 6 自動加入)</div>
            )}
            {data.watchlist.map((w) => (
              <WatchlistRow key={w.id} item={w} onClick={() => navigate(`/projects-platform/projects/${w.project_id}`)} />
            ))}
          </div>
        </Widget>

        {/* Widget 3 + 4 在同一欄,垂直疊 */}
        <div className="flex flex-col gap-3.5">
          <Widget icon={<CheckCircle2 size={14} className="text-cortex-ocean" />} title="Widget 3 · 我的 Task">
            <div className="flex justify-around items-center py-3">
              <TaskCount color="red"    count={data.my_tasks.red} />
              <TaskCount color="yellow" count={data.my_tasks.yellow} />
              <TaskCount color="green"  count={data.my_tasks.green} />
            </div>
            <button
              onClick={() => alert('跨專案 Task 清單 — Sprint 後續上獨立頁')}
              className="w-full text-[11px] py-1.5 text-cortex-muted hover:text-cortex-teal transition"
            >
              → 跨專案 Task 清單(總計 {data.my_tasks.total})
            </button>
          </Widget>
          <Widget icon={<ClipboardList size={14} className="text-purple-700" />} title="Widget 4 · 待 Review">
            <div className="py-2">
              <ReviewRow label="Form 待 review" value={data.review_queue.form_review} />
              <ReviewRow label="Task 待 review" value={data.review_queue.task_review} />
            </div>
          </Widget>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        {/* Widget 5: Delay Hotspot */}
        <Widget icon={<Flame size={14} className="text-red-700" />} title="Widget 5 · Delay 熱點">
          <div className="py-1.5">
            {data.delay_hotspot.length === 0 && (
              <div className="text-center text-cortex-muted text-sm py-6">🟢 無 stage 卡關</div>
            )}
            {data.delay_hotspot.map((d) => (
              <div key={d.stage} className="mb-2.5">
                <div className="flex items-center justify-between text-[12px] mb-1">
                  <span className="text-cortex-text font-semibold font-mono">{d.stage} 卡 {d.cnt} 件</span>
                  <span className="font-mono text-cortex-red font-bold">{d.cnt}</span>
                </div>
                <div className="h-1.5 bg-cortex-line-2 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-cortex-red" style={{ width: `${d.ratio}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Widget>

        {/* Widget 6: KPI */}
        <Widget icon={<TrendingUp size={14} />} title="Widget 6 · 本期 KPI">
          <div className="grid grid-cols-2 gap-3 py-1.5">
            <KpiBlock label="本週新增報價" value={String(data.kpi.new_this_week)} />
            <KpiBlock label={`${data.kpi.period_label}結案`} value={String(data.kpi.closed_this_week)} />
            <KpiBlock
              label="本月贏單率"
              value={`${Math.round(data.kpi.win_rate * 100)}%`}
              color="text-cortex-green"
            />
            <KpiBlock label="平均回應時間" value={`${data.kpi.avg_response_hours}h`} />
          </div>
        </Widget>
      </div>

      {/* Widget 7: Member Load */}
      <Widget
        icon={<UsersIcon size={14} className="text-pink-700" />}
        title="Widget 7 · 成員負載熱圖"
        badge="BU 視角"
      >
        <div className="py-1">
          {data.member_load.length === 0 && (
            <div className="text-center text-cortex-muted text-sm py-4">尚無資料</div>
          )}
          {data.member_load.map((m) => {
            const barColor = m.color === 'red' ? 'from-cortex-red to-cortex-red'
                            : m.color === 'amber' ? 'from-cortex-amber to-orange-500'
                            : 'from-cortex-green to-cortex-green'
            return (
              <div key={m.user_id} className="grid grid-cols-[130px_1fr_80px_90px] gap-3 items-center py-2 border-b border-cortex-line-2 text-[12px] last:border-b-0">
                <span className="font-semibold text-cortex-ink truncate">{m.name}</span>
                <div className="h-3.5 bg-cortex-line-2 rounded-full overflow-hidden relative">
                  <div className={`h-full bg-gradient-to-r ${barColor} rounded-full transition-all`} style={{ width: `${m.load_percent}%` }} />
                </div>
                <span className="font-mono font-bold text-cortex-ink">{m.total_projects} 案</span>
                <span className={`text-[10px] font-${m.alert ? 'bold' : 'medium'} ${m.alert ? 'text-cortex-red' : 'text-cortex-muted'}`}>
                  {m.alert || '正常'}
                </span>
              </div>
            )
          })}
        </div>
      </Widget>

      {/* AI 預測警示 */}
      <Widget
        icon={<Sparkles size={14} className="text-cortex-cyan" />}
        title="AI 預測警示(3 種能力分 Phase 上 · spec §16.4)"
        className="bg-gradient-to-b from-cortex-cyan-bg/60 to-white border-cortex-cyan/30"
      >
        <div className="grid grid-cols-3 gap-2.5 py-1.5">
          <AiPhaseCard
            phase="A · 規則式警示"
            example="「目前完成度 < 預期 → 將超期」"
            status="✓ Phase 1 末已啟用"
            statusColor="text-cortex-green"
          />
          <AiPhaseCard
            phase="B · RAG 類似案推論"
            example="「歷史 5 案 → 3W/2L · 平均 Tier-M」"
            status="⏳ Phase 2 規劃中"
            statusColor="text-cortex-amber"
          />
          <AiPhaseCard
            phase="C · ML 預測模型"
            example="「贏單機率 73%(BOM/客戶/季節)」"
            status="○ Phase 3 待評估"
            statusColor="text-cortex-muted"
          />
        </div>
      </Widget>

      <div className="text-[11px] text-cortex-muted text-right">
        Generated at {new Date(data.generated_at).toLocaleString('zh-TW')} ·
        <button onClick={reload} className="ml-2 text-cortex-ocean hover:underline">
          {loading ? '更新中…' : '重新整理'}
        </button>
      </div>
    </div>
  )
}

// ─── Widget shell ────────────────────────────────────────────────────
function Widget({
  icon, title, action, badge, className, children,
}: {
  icon?: React.ReactNode
  title: string
  action?: React.ReactNode
  badge?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`bg-white border border-cortex-line rounded-xl p-4 shadow-cortex-sm ${className || ''}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {typeof icon === 'string' ? <span className="w-7 h-7 bg-cortex-line-2 rounded-md flex items-center justify-center text-sm">{icon}</span> : (
            <span className="w-7 h-7 bg-cortex-line-2 rounded-md flex items-center justify-center">{icon}</span>
          )}
          <span className="text-[13px] font-bold text-cortex-ink">{title}</span>
          {badge && (
            <span className="text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold tracking-wider ml-1">
              {badge}
            </span>
          )}
        </div>
        {action && <div className="text-[11px] text-cortex-muted">{action}</div>}
      </div>
      {children}
    </div>
  )
}

// ─── Watchlist row with hover SUMMARY tooltip ────────────────────────
function WatchlistRow({ item, onClick }: { item: DashboardData['watchlist'][number]; onClick: () => void }) {
  const s = SLA_STYLE[item.sla_light]
  const [hover, setHover] = useState(false)

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative"
    >
      <button
        onClick={onClick}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded border border-cortex-line bg-white hover:border-cortex-cyan hover:bg-cortex-bg transition text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[11px] font-bold text-cortex-ocean">{item.id}</div>
          <div className="text-[12px] text-cortex-text truncate">
            {item.title} · <span className="text-cortex-muted">{item.hint}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} title={s.label} />
          <span className="text-cortex-muted text-base">›</span>
        </div>
      </button>
      {hover && <WatchlistTooltip projectId={item.project_id} />}
    </div>
  )
}

function TaskCount({ color, count }: { color: 'red' | 'yellow' | 'green'; count: number }) {
  const cls =
    color === 'red'    ? 'bg-cortex-red text-cortex-red' :
    color === 'yellow' ? 'bg-cortex-amber text-cortex-amber' :
                         'bg-cortex-green text-cortex-green'
  return (
    <div className="text-center">
      <span className={`w-3 h-3 rounded-full mx-auto block ${cls.split(' ')[0]}`} />
      <div className={`text-[22px] font-mono font-extrabold leading-none mt-1 ${cls.split(' ')[1]}`}>{count}</div>
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-[12px] py-1.5 border-b border-cortex-line-2 last:border-b-0">
      <span className="text-cortex-text">{label}</span>
      <span className="font-mono font-bold text-cortex-ocean">{value}</span>
    </div>
  )
}

function KpiBlock({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] text-cortex-muted font-semibold tracking-wider">{label}</div>
      <div className={`text-[22px] font-mono font-extrabold ${color || 'text-cortex-ink'} mt-0.5`}>{value}</div>
    </div>
  )
}

function AiPhaseCard({ phase, example, status, statusColor }: { phase: string; example: string; status: string; statusColor: string }) {
  return (
    <div className="bg-white border border-cortex-cyan-bg rounded-lg p-3">
      <div className="text-[10px] font-bold text-cortex-teal tracking-wide mb-1">{phase}</div>
      <div className="text-[11px] text-cortex-text leading-relaxed">{example}</div>
      <div className={`text-[10px] font-bold mt-1.5 ${statusColor}`}>{status}</div>
    </div>
  )
}

// ─── Sprint M-13 · 主管日報按鈕 + modal ────────────────────────────────
function DailyReportButton() {
  const { token } = useAuth() as any
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [markdown, setMarkdown] = useState<string>('')
  const [meta, setMeta] = useState<{ summaries_count?: number; channels?: string[]; skipped?: boolean; reason?: string } | null>(null)
  const [period, setPeriod] = useState<'daily' | 'weekly'>('daily')
  const [err, setErr] = useState<string | null>(null)

  const run = async (sendNotif: boolean) => {
    setLoading(true)
    setErr(null)
    setMarkdown('')
    setMeta(null)
    try {
      const r: any = await api.post(token, '/ai/daily-report/run', {
        period,
        dry_run: !sendNotif,
      })
      if (r.markdown) setMarkdown(r.markdown)
      setMeta({
        summaries_count: r.summaries_count,
        channels: r.channels,
        skipped: r.skipped,
        reason: r.reason,
      })
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-gradient-to-r from-amber-400 to-amber-500 text-white rounded hover:opacity-90 font-semibold"
        title="AI #33 主管日報 — 我的關注專案彙整"
      >
        <Sun size={13} /> 我的日報
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-[720px] w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="bg-gradient-to-r from-amber-400 to-amber-500 px-5 py-3.5 text-white flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-amber-100 font-bold inline-flex items-center gap-1">
                  <Sun size={11} /> AI #33 主管日報 / 週報
                </div>
                <div className="text-base font-bold">我的關注專案 AI 彙整</div>
              </div>
              <button onClick={() => setOpen(false)} className="text-amber-100 hover:text-white"><X size={18} /></button>
            </div>

            <div className="p-4 border-b border-cortex-line flex items-center gap-2">
              <div className="inline-flex rounded-md border border-cortex-line bg-white overflow-hidden">
                <button
                  onClick={() => setPeriod('daily')}
                  className={`px-3 py-1.5 text-[11px] font-semibold ${period === 'daily' ? 'bg-amber-500 text-white' : 'text-cortex-text'}`}
                >☀️ 日報</button>
                <button
                  onClick={() => setPeriod('weekly')}
                  className={`px-3 py-1.5 text-[11px] font-semibold ${period === 'weekly' ? 'bg-amber-500 text-white' : 'text-cortex-text'}`}
                >📊 週報</button>
              </div>
              <button
                onClick={() => run(false)}
                disabled={loading}
                className="px-3 py-1.5 text-[11px] border border-cortex-line bg-white rounded hover:bg-cortex-bg disabled:opacity-50 inline-flex items-center gap-1"
              >
                {loading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                預覽(不寄)
              </button>
              <button
                onClick={() => run(true)}
                disabled={loading}
                className="px-3 py-1.5 text-[11px] bg-cortex-cyan text-cortex-navy rounded hover:opacity-90 disabled:opacity-50 font-bold inline-flex items-center gap-1"
              >
                {loading ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                生成 + 寄出
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {err && (
                <div className="bg-cortex-red-bg/40 border border-red-200 rounded p-2 text-[12px] text-red-700 mb-2">
                  {err}
                </div>
              )}
              {meta?.skipped && (
                <div className="bg-cortex-amber-bg/40 border border-amber-200 rounded p-3 text-[12px] text-amber-800">
                  跳過 — {meta.reason || '無 active 專案可彙整'}
                </div>
              )}
              {meta && !meta.skipped && (
                <div className="bg-cortex-green-bg/30 border border-cortex-green/30 rounded p-2 text-[11px] text-cortex-green mb-3">
                  ✓ 已彙整 {meta.summaries_count} 個專案
                  {meta.channels && meta.channels.length > 0 && (
                    <> · 發送通道:<strong className="font-mono">{meta.channels.join(' · ')}</strong></>
                  )}
                </div>
              )}
              {markdown ? (
                <div className="bg-cortex-bg/30 border border-cortex-line rounded-lg p-4 text-[12px] text-cortex-ink leading-relaxed whitespace-pre-wrap font-mono">
                  {markdown}
                </div>
              ) : !loading && !meta && (
                <div className="text-center text-cortex-muted text-[12px] py-8">
                  點上方「預覽」看內容,或「生成 + 寄出」推到鈴鐺 + email
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Re-export the type for inner use ─────────────────────────────────
export type { DashboardData, StatusSummary }
