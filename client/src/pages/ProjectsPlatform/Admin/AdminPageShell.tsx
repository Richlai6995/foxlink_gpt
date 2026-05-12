/**
 * AdminPageShell — admin 頁面共用 layout
 *
 * 對齊 HTML demo 各 admin 頁:
 *   - Page head(title + subtitle + actions)
 *   - Scope toggle (SYSTEM / BU / USER)— spec §5.1
 *   - Content slot
 */

import { Globe, Building2, User, BookOpen } from 'lucide-react'

export type Scope = 'SYSTEM' | 'BU' | 'USER'

type Props = {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  scope?: Scope
  onScope?: (s: Scope) => void
  scopeOwnerId?: string
  banner?: React.ReactNode
  specLink?: { label: string; href: string }
  children: React.ReactNode
}

export default function AdminPageShell({
  title, subtitle, actions, scope, onScope, scopeOwnerId, banner, specLink, children,
}: Props) {
  return (
    <div className="space-y-3.5">
      {/* Page head */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-cortex-ink tracking-tight">{title}</h1>
          {subtitle && (
            <div className="text-[12px] text-cortex-muted mt-1">
              {subtitle}
              {specLink && (
                <>
                  {' · '}
                  <a className="text-cortex-ocean hover:underline" href={specLink.href} target="_blank" rel="noreferrer">
                    <BookOpen size={11} className="inline -mt-px mr-0.5" />
                    {specLink.label}
                  </a>
                </>
              )}
            </div>
          )}
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>

      {/* Scope toggle */}
      {scope && onScope && (
        <div className="bg-gradient-to-b from-cortex-line-2/50 to-white border border-cortex-line rounded-xl px-4 py-2.5 flex items-center gap-3.5 flex-wrap">
          <div className="text-[11px] font-bold text-cortex-muted tracking-wider uppercase">
            Workflow Template Scope (spec §5.1)
          </div>
          <div className="inline-flex rounded-md border border-cortex-line bg-white overflow-hidden">
            <ScopeBtn active={scope === 'SYSTEM'} onClick={() => onScope('SYSTEM')} icon={<Globe size={11} />}>
              SYSTEM
            </ScopeBtn>
            <ScopeBtn active={scope === 'BU'} onClick={() => onScope('BU')} icon={<Building2 size={11} />}>
              BU (A001)
            </ScopeBtn>
            <ScopeBtn active={scope === 'USER'} onClick={() => onScope('USER')} icon={<User size={11} />}>
              USER
            </ScopeBtn>
          </div>
          <span className="text-[11px] text-cortex-muted">
            → 解析優先序:USER &gt; BU &gt; SYSTEM (§5.2)
          </span>
          {scopeOwnerId && (
            <span className="ml-auto font-mono text-[10px] text-cortex-ocean bg-cortex-ocean-bg px-2 py-1 rounded font-semibold">
              scope_owner_id: {scopeOwnerId}
            </span>
          )}
        </div>
      )}

      {banner}

      {children}
    </div>
  )
}

function ScopeBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1.5 transition ${
        active ? 'bg-cortex-navy text-white' : 'text-cortex-text hover:bg-cortex-bg'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}
