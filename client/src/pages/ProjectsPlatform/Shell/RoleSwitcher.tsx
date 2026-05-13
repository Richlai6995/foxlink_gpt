/**
 * RoleSwitcher — 6 種 demo 視角切換 dropdown
 *
 * 對應 HTML demo .role-switch + .dropdown-menu
 * 切換後在頁面內所有「機密欄位顯示」走對應 displayStrategy
 *
 * 注意:dropdown 內所有文字用 inline style 強制設色,
 * 避免被 navy topbar 的 color:white 繼承導致白底白字。
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { DEMO_ROLES, TOKENS, type DemoRole } from '../tokens'
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
        className="flex items-center gap-2 px-3 py-1.5 border rounded-md text-xs transition"
        style={{
          background: 'rgba(255,255,255,0.06)',
          borderColor: 'rgba(255,255,255,0.10)',
          color: '#fff',
        }}
        title="切換角色觀察機密策略效果"
      >
        <span style={{ color: TOKENS.cyan, fontWeight: 600 }}>視角</span>
        <span className="font-semibold">{current.label}</span>
        <ChevronDown size={10} className="opacity-50" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-[110%] w-[320px] rounded-lg overflow-hidden z-[200] shadow-cortex-lg border"
          style={{
            background: '#fff',
            borderColor: TOKENS.line,
            color: TOKENS.text,
          }}
        >
          <div
            className="px-3 py-2 text-[11px] uppercase font-bold tracking-widest border-b"
            style={{ color: TOKENS.muted, background: TOKENS.bg, borderColor: TOKENS.line }}
          >
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
                className="w-full text-left px-3 py-2.5 text-sm flex items-start gap-2 transition"
                style={{
                  background: active ? TOKENS.cyanBg : '#fff',
                  color: TOKENS.text,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = active ? TOKENS.cyanBg : TOKENS.line2 }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = active ? TOKENS.cyanBg : '#fff' }}
              >
                <span style={{ color: active ? TOKENS.cyan : 'transparent', marginTop: 2 }}>
                  <Check size={14} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-semibold" style={{ color: TOKENS.ink }}>{r.label}</span>
                  <span className="block text-[11px] mt-0.5 leading-tight" style={{ color: TOKENS.muted }}>
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
