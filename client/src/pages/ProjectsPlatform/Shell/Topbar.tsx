/**
 * Topbar — navy header,固定 56px
 *
 * 對應 HTML demo .topbar
 *   左:menu-btn + brand + breadcrumb
 *   右:role-switch + 通知 icon + avatar
 */

import { Menu, Bell, ChevronRight } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { usePlatform } from './PlatformContext'
import RoleSwitcher from './RoleSwitcher'

export default function Topbar() {
  const { toggleSidebar, crumbs } = usePlatform()
  const { user } = useAuth() as any
  const navigate = useNavigate()

  const initials = (user?.username || user?.name || 'U').slice(0, 1).toUpperCase()

  return (
    <header className="fixed top-0 inset-x-0 h-14 bg-cortex-navy text-white flex items-center px-4 z-[100] shadow-[0_1px_0_rgba(255,255,255,0.04)] font-cortex">
      {/* Left */}
      <div className="flex items-center gap-3.5 flex-1 min-w-0">
        <button
          onClick={toggleSidebar}
          className="w-9 h-9 flex items-center justify-center rounded-md text-white hover:bg-white/10 transition"
          title="顯示 / 隱藏 sidebar (M)"
        >
          <Menu size={20} />
        </button>

        {/* Brand */}
        <Link to="/projects-platform" className="flex items-center gap-2.5 font-bold text-[15px] tracking-wide shrink-0">
          <span className="w-7 h-7 rounded-md bg-gradient-to-br from-cortex-cyan to-cortex-teal text-cortex-navy font-extrabold text-[13px] flex items-center justify-center">
            C
          </span>
          <span className="text-white">Cortex</span>
          <span className="text-[10px] font-medium text-cortex-cyan bg-cortex-cyan/10 px-2 py-0.5 rounded tracking-widest">
            v0.4
          </span>
        </Link>

        {/* Breadcrumb */}
        <nav className="ml-2 text-[13px] text-white/60 flex items-center flex-wrap min-w-0 gap-1.5">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1
            return (
              <span key={i} className="flex items-center gap-1.5">
                {c.to && !isLast ? (
                  <button
                    onClick={() => navigate(c.to!)}
                    className="text-white/65 hover:text-cortex-cyan transition"
                  >
                    {c.label}
                  </button>
                ) : (
                  <span className={isLast ? 'text-white/90 font-medium' : 'text-white/65'}>
                    {c.label}
                  </span>
                )}
                {!isLast && <ChevronRight size={12} className="opacity-40" />}
              </span>
            )
          })}
        </nav>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <RoleSwitcher />

        <button
          className="w-9 h-9 flex items-center justify-center rounded-md text-white/85 hover:bg-white/10 transition relative"
          title="通知"
        >
          <Bell size={18} />
          <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-cortex-red rounded-full ring-2 ring-cortex-navy" />
        </button>

        <button
          className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 text-white font-bold text-xs flex items-center justify-center ml-1 hover:ring-2 hover:ring-white/30 transition"
          title={user?.username || user?.name}
        >
          {initials}
        </button>
      </div>
    </header>
  )
}
