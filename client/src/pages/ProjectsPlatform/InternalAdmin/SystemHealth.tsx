/**
 * System Health 頁(Ocean Depth 亮色)
 *
 * 顯示 module 狀態:Feature flag / Workers / LLM Queue / Plugins / Sprint progress
 */

import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { useCrumbs } from '../Shell/PlatformContext'

type Health = {
  module: string
  version: string
  feature_flag: Record<string, any>
  runtime: { enabled: boolean; workers_enabled: boolean; uptime_seconds: number }
  llm_queue: { available_tokens: number; burst_capacity: number; rate_per_sec: number }
  plugins: { type_code: string; default_channels: number; default_stages: number }[]
  sprint_progress: Record<string, string>
  server_time: string
}

function fmtUptime(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  return `${h}h ${m}m ${s}s`
}

export default function SystemHealthPage() {
  useCrumbs([{ label: 'Internal Admin', to: '/projects-platform' }, { label: 'System Health' }])
  const { token } = useAuth() as any
  const [data, setData] = useState<Health | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const reload = async () => {
    if (!token) return
    setErr(null)
    try {
      const r = await fetch('/api/projects/internal-admin/system-health', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setData(await r.json())
    } catch (e: any) {
      setErr(String(e?.message || e))
    }
  }

  useEffect(() => {
    reload()
    const id = setInterval(reload, 10000)
    return () => clearInterval(id)
  }, [token])

  if (err) {
    return (
      <div className="p-4 bg-cortex-red-bg border border-red-200 rounded text-red-700 text-sm">
        無法載入 System Health:{err}
      </div>
    )
  }
  if (!data) return <div className="text-cortex-muted text-sm p-4">Loading...</div>

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold text-cortex-ink">System Health</h1>

      {/* Module Info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Module" value={data.module} />
        <Card label="Version" value={data.version} />
        <Card label="Uptime" value={fmtUptime(data.runtime.uptime_seconds)} />
        <Card
          label="Status"
          value={data.runtime.enabled ? '🟢 Enabled' : '🔴 Disabled'}
          color={data.runtime.enabled ? 'green' : 'red'}
        />
      </div>

      <Section title="🎛 Feature Flags">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Object.entries(data.feature_flag).map(([key, val]) => (
            <div key={key} className="flex justify-between text-sm py-1.5 px-3 bg-cortex-line-2/60 rounded">
              <span className="text-cortex-muted font-mono text-xs">{key}</span>
              <span className="text-cortex-teal font-mono text-xs font-semibold">{String(val)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="🤖 LLM Queue(Rate Limiter)">
        <div className="grid grid-cols-3 gap-3">
          <Card
            label="Available Tokens"
            value={`${data.llm_queue.available_tokens} / ${data.llm_queue.burst_capacity}`}
            color="cyan"
          />
          <Card label="Burst Capacity" value={data.llm_queue.burst_capacity.toString()} />
          <Card label="Rate / sec" value={`${data.llm_queue.rate_per_sec}/s`} />
        </div>
      </Section>

      <Section title="🧩 Plugins Registered">
        {data.plugins.length === 0 ? (
          <p className="text-cortex-muted text-sm">No plugins registered.</p>
        ) : (
          <div className="space-y-1">
            {data.plugins.map((p) => (
              <div key={p.type_code} className="flex items-center gap-4 text-sm py-1.5 px-3 bg-cortex-line-2/60 rounded">
                <span className="text-cortex-teal font-mono font-bold">{p.type_code}</span>
                <span className="text-cortex-muted">{p.default_channels} channels</span>
                <span className="text-cortex-muted">{p.default_stages} stages</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="📅 Sprint Progress">
        <div className="space-y-1">
          {Object.entries(data.sprint_progress).map(([sprint, status]) => (
            <div key={sprint} className="flex justify-between text-sm py-1.5 px-3 bg-cortex-line-2/60 rounded">
              <span className="text-cortex-text">{sprint}</span>
              <span className={status.includes('completed') ? 'text-cortex-green font-semibold' : 'text-cortex-muted'}>
                {status}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <div className="text-xs text-cortex-muted text-right">
        Server time: {data.server_time} · 自動 refresh 每 10 秒
      </div>
    </div>
  )
}

function Card({ label, value, color }: { label: string; value: string; color?: 'green' | 'red' | 'cyan' }) {
  const colorClass = color === 'green'
    ? 'text-cortex-green'
    : color === 'red'
    ? 'text-cortex-red'
    : color === 'cyan'
    ? 'text-cortex-teal'
    : 'text-cortex-ink'
  return (
    <div className="p-3 bg-white border border-cortex-line rounded shadow-cortex-sm">
      <div className="text-xs text-cortex-muted mb-1">{label}</div>
      <div className={`text-sm font-bold ${colorClass}`}>{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg p-4 border border-cortex-line shadow-cortex-sm">
      <h3 className="text-sm font-bold text-cortex-teal mb-3">{title}</h3>
      {children}
    </div>
  )
}
