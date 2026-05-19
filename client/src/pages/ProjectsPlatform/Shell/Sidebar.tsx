/**
 * Sidebar — slide-in 左側導覽,240px
 *
 * 對應 HTML demo .sidebar(主入口 / Project Types / 管理 三段)
 *
 * Sprint A:大部分項目目前是 stub,點下去去未實作頁就好
 *   ✅ 我的專案 — Sprint A
 *   ⏳ 我的任務 — Sprint C
 *   ⏳ 跨專案儀表板 — Sprint D
 *   ⏳ KB / 知識庫 — 後續
 *   ⏳ AI 加速 — 後續
 *   ⏳ Project Types(QUOTE/IT/教育訓練)— UX 提示
 *   ⏳ 表單範本 / 任務模板 / 機密策略 / 通知規則 / 連線管理 / 系統設定 — Sprint E
 *
 * 額外:Internal Admin Overview / System Health(我之前 Phase 0 寫的)— admin 看得到
 */

import { useLocation, useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  Briefcase, CheckCircle2, LayoutGrid, BookOpen, Sparkles,
  DollarSign, Server, GraduationCap,
  FileText, ListTodo, ShieldCheck, Bell, Plug, Settings,
  ShieldAlert, HeartPulse, Shield, MessageSquareText, FileCheck,
} from 'lucide-react'
import { useProjectsPlatformVisibility } from '../../../hooks/useProjectsPlatformVisibility'
import { usePlatform } from './PlatformContext'

type ItemProps = {
  to?: string
  icon: LucideIcon
  label: React.ReactNode
  count?: number | string
  stub?: boolean
}

function NavItem({ to, icon: Icon, label, count, stub }: ItemProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { closeSidebar } = usePlatform()
  const active = !!to && (location.pathname === to || (to !== '/projects-platform' && location.pathname.startsWith(to)))

  const onClick = () => {
    if (stub) {
      alert(`「${typeof label === 'string' ? label : 'item'}」尚未實作 — 後續 sprint 上`)
      return
    }
    if (to) navigate(to)
    if (window.matchMedia('(max-width: 1024px)').matches) closeSidebar()
  }

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] mb-0.5 transition group ${
        active
          ? 'bg-cortex-cyan-bg text-cortex-teal font-semibold'
          : stub
          ? 'text-cortex-muted hover:bg-cortex-line-2'
          : 'text-cortex-text hover:bg-cortex-line-2 hover:text-cortex-ink'
      }`}
    >
      <Icon size={16} className={active ? 'text-cortex-cyan' : 'text-cortex-muted group-hover:text-cortex-ink'} />
      <span className="flex-1 text-left">{label}</span>
      {count !== undefined && (
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded-[10px] ${
            active ? 'bg-cortex-cyan text-white' : 'bg-cortex-line text-cortex-muted'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3 mb-4">
      <div className="text-[10px] font-bold text-cortex-muted tracking-[1.2px] uppercase px-3 pt-2 pb-1">
        {label}
      </div>
      {children}
    </div>
  )
}

export default function Sidebar() {
  const { sidebarOpen, closeSidebar } = usePlatform()
  const v = useProjectsPlatformVisibility()

  return (
    <>
      {/* Backdrop on small screens(slide-in overlay)*/}
      <div
        className={`fixed inset-x-0 top-14 bottom-0 bg-cortex-navy/40 z-[70] transition-opacity duration-200 lg:hidden ${
          sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={closeSidebar}
      />

      <aside
        className={`fixed top-14 bottom-0 left-0 w-60 bg-white border-r border-cortex-line overflow-y-auto z-[80] py-4 transition-transform duration-200 font-cortex ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Section label="主入口">
          <NavItem to="/projects-platform" icon={Briefcase} label="我的專案" count={0} />
          <NavItem icon={CheckCircle2} label="我的任務" count={0} stub />
          <NavItem to="/projects-platform/dashboard" icon={LayoutGrid} label="跨專案儀表板" />
          <NavItem to="/projects-platform/messages" icon={MessageSquareText} label={<>💌 訊息 <span className="ml-1 text-[9px] text-cortex-teal font-bold">域內</span></>} />
          <NavItem to="/projects-platform/approvals" icon={FileCheck} label={<>📝 待批 <span className="ml-1 text-[9px] text-amber-600 font-bold">P3</span></>} />
          <NavItem to="/projects-platform/kb" icon={BookOpen} label="KB / 知識庫" />
          <NavItem to="/projects-platform/ai-acceleration" icon={Sparkles} label={<span className="flex items-center gap-1.5">AI 加速 <span className="bg-gradient-to-br from-cortex-cyan to-cortex-teal text-white text-[9px] px-1.5 py-px rounded font-bold">10</span></span>} />
        </Section>

        <Section label="PROJECT TYPES">
          <NavItem icon={DollarSign} label="業務報價(QUOTE)" count={0} stub />
          <NavItem icon={Server} label="IT 維護" count="—" stub />
          <NavItem icon={GraduationCap} label={<>教育訓練 <span className="ml-1 text-[9px] text-cortex-muted">P4</span></>} stub />
        </Section>

        <Section label="管理">
          <NavItem to="/projects-platform/admin/form-templates" icon={FileText} label="表單範本" />
          <NavItem to="/projects-platform/admin/task-templates" icon={ListTodo} label="任務模板" />
          <NavItem to="/projects-platform/admin/confidential-policies" icon={ShieldCheck} label="機密策略" />
          <NavItem to="/projects-platform/admin/notification-rules" icon={Bell} label="通知規則" />
          <NavItem to="/projects-platform/admin/connections" icon={Plug} label="連線管理(ERP/SQL)" />
          <NavItem icon={Settings} label="系統設定" stub />
        </Section>

        {v.mode === 'admin' && (
          <Section label="內部 Admin">
            <NavItem to="/projects-platform/admin/role-grants" icon={Shield} label={<>角色授予 <span className="ml-1 text-[9px] text-cortex-cyan font-bold">13</span></>} />
            <NavItem to="/projects-platform/internal-admin/overview" icon={ShieldAlert} label="Internal Admin" />
            <NavItem to="/projects-platform/internal-admin/system-health" icon={HeartPulse} label="System Health" />
          </Section>
        )}

        <div className="px-6 mt-2 text-[11px] text-cortex-muted/70 leading-relaxed">
          <p>對應 spec v0.4 · Sprint A</p>
          <p className="mt-1">⏳ 標示項目為後續 sprint 開發</p>
        </div>
      </aside>
    </>
  )
}
