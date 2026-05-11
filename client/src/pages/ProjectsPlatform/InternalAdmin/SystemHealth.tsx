/**
 * System Health 頁
 *
 * 顯示 module 狀態:Feature flag / Workers / LLM Queue / Plugins / Sprint progress
 */

import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'

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
      <div className="p-4 bg-red-900/20 border border-red-800 rounded text-red-300 text-sm">
        無法載入 System Health:{err}
      </div>
    )
  }
  if (!data) return <div className="text-slate-500 text-sm">Loading...</div>

  return (
    <div className="space-y-4">
      {/* Module Info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Module" value={data.module} />
        <Card label="Version" value={data.version} />
        <Card label="Uptime" value={fmtUptime(data.runtime.uptime_seconds)} />
        <Card
          label="Status"
          value={data.runtime.enabled ? '🟢 Enabled' : '🔴 Disabled'}
          color={data.runtime.enabled ? 'emerald' : 'red'}
        />
      </div>

      {/* Feature Flags */}
      <Section title="🎛 Feature Flags">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Object.entries(data.feature_flag).map(([key, val]) => (
            <div key={key} className="flex justify-between text-sm py-1.5 px-3 bg-slate-900/50 rounded">
              <span className="text-slate-400 font-mono text-xs">{key}</span>
              <span className="text-cyan-300 font-mono text-xs">{String(val)}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* LLM Queue */}
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

      {/* Plugins */}
      <Section title="🧩 Plugins Registered">
        {data.plugins.length === 0 ? (
          <p className="text-slate-500 text-sm">No plugins registered.</p>
        ) : (
          <div className="space-y-1">
            {data.plugins.map((p) => (
              <div key={p.type_code} className="flex items-center gap-4 text-sm py-1.5 px-3 bg-slate-900/50 rounded">
                <span className="text-cyan-300 font-mono">{p.type_code}</span>
                <span className="text-slate-500">{p.default_channels} channels</span>
                <span className="text-slate-500">{p.default_stages} stages</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Sprint Progress */}
      <Section title="📅 Sprint Progress">
        <div className="space-y-1">
          {Object.entries(data.sprint_progress).map(([sprint, status]) => (
            <div key={sprint} className="flex justify-between text-sm py-1.5 px-3 bg-slate-900/50 rounded">
              <span className="text-slate-400">{sprint}</span>
              <span className={status.includes('completed') ? 'text-emerald-300' : 'text-slate-500'}>
                {status}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <div className="text-xs text-slate-600 text-right">
        Server time: {data.server_time} · 自動 refresh 每 10 秒
      </div>
    </div>
  )
}

function Card({ label, value, color }: { label: string; value: string; color?: string }) {
  const colorClass = color === 'emerald'
    ? 'text-emerald-300'
    : color === 'red'
    ? 'text-red-300'
    : color === 'cyan'
    ? 'text-cyan-300'
    : 'text-slate-200'
  return (
    <div className="p-3 bg-slate-800/50 border border-slate-700 rounded">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-sm font-medium ${colorClass}`}>{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700">
      <h3 className="text-sm font-semibold text-cyan-200 mb-3">{title}</h3>
      {children}
    </div>
  )
}
