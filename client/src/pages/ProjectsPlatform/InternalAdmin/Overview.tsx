/**
 * Internal Admin Overview 頁
 *
 * 顯示各子頁的啟用狀態(目前 Phase 0,大部分 disabled,顯示 sprint roadmap)
 */

import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'

type Section = {
  title: string
  items: { key: string; name: string; enabled: boolean; sprint: string }[]
}

type Overview = {
  title: string
  status_note: string
  sections: Section[]
}

export default function InternalAdminOverview() {
  const { token } = useAuth() as any
  const [data, setData] = useState<Overview | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    fetch('/api/projects/internal-admin/overview', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch((e) => setErr(String(e?.message || e)))
  }, [token])

  if (err) {
    return (
      <div className="p-4 bg-red-900/20 border border-red-800 rounded text-red-300 text-sm">
        無法載入 Internal Admin Overview:{err}
      </div>
    )
  }
  if (!data) return <div className="text-slate-500 text-sm">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="p-4 bg-amber-900/10 border border-amber-800/40 rounded">
        <p className="text-amber-200 text-sm">⚠ {data.status_note}</p>
      </div>

      {data.sections.map((sec) => (
        <div key={sec.title} className="bg-slate-800/50 rounded-lg p-5 border border-slate-700">
          <h2 className="text-lg font-semibold text-sky-200 mb-3">{sec.title}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {sec.items.map((item) => (
              <div
                key={item.key}
                className={`p-3 rounded border flex items-center justify-between transition ${
                  item.enabled
                    ? 'bg-green-900/20 border-green-700/50 hover:border-green-500 cursor-pointer'
                    : 'bg-slate-900/50 border-slate-700/50 opacity-60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">
                    {item.enabled ? '✅' : '⏳'}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-slate-200">{item.name}</div>
                    <div className="text-xs text-slate-500">{item.sprint}</div>
                  </div>
                </div>
                {item.enabled && (
                  <span className="text-xs text-green-300">已啟用</span>
                )}
                {!item.enabled && (
                  <span className="text-xs text-slate-500">待 sprint</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="mt-8 p-4 bg-slate-800/30 border border-slate-700/50 rounded text-xs text-slate-500">
        對應規格書:
        <a className="text-sky-400 hover:underline ml-1" href="/docs/projects-platform-spec.md" target="_blank">
          projects-platform-spec.md
        </a>
        {' · '}
        <a className="text-sky-400 hover:underline" href="/docs/projects-platform-implementation-roadmap.md" target="_blank">
          implementation-roadmap.md
        </a>
        {' · '}
        <a className="text-sky-400 hover:underline" href="/docs/projects-platform-internal-admin-plan.md" target="_blank">
          internal-admin-plan.md
        </a>
      </div>
    </div>
  )
}
