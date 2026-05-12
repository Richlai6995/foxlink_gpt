/**
 * Internal Admin Overview 頁(對齊 Ocean Depth 亮色)
 *
 * 顯示各子頁的啟用狀態 — 配合 Sprint A 重新設計的 platform shell
 */

import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { useCrumbs } from '../Shell/PlatformContext'

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
  useCrumbs([{ label: 'Internal Admin', to: '/projects-platform' }, { label: 'Overview' }])
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
      <div className="p-4 bg-cortex-red-bg border border-red-200 rounded text-red-700 text-sm">
        無法載入 Internal Admin Overview:{err}
      </div>
    )
  }
  if (!data) return <div className="text-cortex-muted text-sm p-4">Loading...</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-cortex-ink mb-1">{data.title || '專案管理平台設定'}</h1>
        <div className="text-sm text-cortex-muted">Sprint 進度檢視 + 各子頁啟用狀態</div>
      </div>

      <div className="p-4 bg-cortex-amber-bg border border-amber-200 rounded">
        <p className="text-amber-800 text-sm">⚠ {data.status_note}</p>
      </div>

      {data.sections.map((sec) => (
        <div key={sec.title} className="bg-white rounded-lg p-5 border border-cortex-line shadow-cortex-sm">
          <h2 className="text-lg font-bold text-cortex-teal mb-3">{sec.title}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {sec.items.map((item) => (
              <div
                key={item.key}
                className={`p-3 rounded border flex items-center justify-between transition ${
                  item.enabled
                    ? 'bg-cortex-green-bg border-cortex-green/40 hover:border-cortex-green cursor-pointer'
                    : 'bg-cortex-line-2/40 border-cortex-line opacity-70'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">{item.enabled ? '✅' : '⏳'}</span>
                  <div>
                    <div className="text-sm font-semibold text-cortex-ink">{item.name}</div>
                    <div className="text-xs text-cortex-muted">{item.sprint}</div>
                  </div>
                </div>
                {item.enabled ? (
                  <span className="text-xs text-cortex-green font-semibold">已啟用</span>
                ) : (
                  <span className="text-xs text-cortex-muted">待 sprint</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="p-4 bg-cortex-line-2/40 border border-cortex-line rounded text-xs text-cortex-muted">
        對應規格書:
        <a className="text-cortex-ocean hover:underline ml-1" href="/docs/projects-platform-spec.md" target="_blank" rel="noreferrer">
          projects-platform-spec.md
        </a>
        {' · '}
        <a className="text-cortex-ocean hover:underline" href="/docs/projects-platform-implementation-roadmap.md" target="_blank" rel="noreferrer">
          implementation-roadmap.md
        </a>
        {' · '}
        <a className="text-cortex-ocean hover:underline" href="/docs/projects-platform-internal-admin-plan.md" target="_blank" rel="noreferrer">
          internal-admin-plan.md
        </a>
      </div>
    </div>
  )
}
