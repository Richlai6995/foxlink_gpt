/**
 * RoleSwitcher — 6 種 demo 視角切換 dropdown
 *
 * 對應 HTML demo .role-switch + .dropdown-menu
 * 切換後在頁面內所有「機密欄位顯示」走對應 displayStrategy(後續 sprint 接)
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { DEMO_ROLES, type DemoRole } from '../tokens'
import { usePlatform } from './PlatformContext'

export default function RoleSwitcher() {
  const { demoRole, setDemoRole } = usePlatform()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const current = DEMO_ROLES.find((r) => r.key === demoRole)!

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.06] border border-white/10 rounded-md text-white text-xs hover:bg-white/10 transition"
        title="切換角色觀察機密策略效果(R)"
      >
        <span className="text-cortex-cyan font-semibold">視角</span>
        <span className="font-semibold">{current.label}</span>
        <ChevronDown size={10} className="opacity-50" />
      </button>

      {open && (
        <div className="absolute right-0 top-[110%] w-[300px] bg-white border border-cortex-line rounded-lg shadow-cortex-lg overflow-hidden z-[200] text-cortex-text">
          <div className="px-3 py-2 text-[11px] uppercase font-bold tracking-widest text-cortex-muted bg-cortex-bg border-b border-cortex-line">
            DEMO 視角(模擬機密策略)
          </div>
          {DEMO_ROLES.map((r) => {
            const active = r.key === demoRole
            return (
              <button
                key={r.key}
                onClick={() => {
                  setDemoRole(r.key as DemoRole)
                  setOpen(false)
                }}
                className={`w-full text-left px-3 py-2 text-sm transition flex items-start gap-2 hover:bg-cortex-line-2 ${
                  active ? 'bg-cortex-cyan-bg/40' : ''
                }`}
              >
                <span className={`mt-0.5 ${active ? 'text-cortex-cyan' : 'opacity-0'}`}>
                  <Check size={14} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-semibold text-cortex-ink">{r.label}</span>
                  <span className="block text-[11px] text-cortex-muted mt-0.5 leading-tight">
                    {r.desc}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
