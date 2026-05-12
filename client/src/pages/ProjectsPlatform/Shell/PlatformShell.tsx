/**
 * PlatformShell — 完整 page chrome:Topbar + Sidebar + main 容器
 *
 * 對應 HTML demo 的 <header.topbar> + <aside.sidebar> + <main.main>
 *
 * 對主站完全獨立(覆蓋 Cortex 主站 sidebar + topbar 之外的版面)。
 * Cortex 全域元件(FeedbackFAB / Voice / Toast)仍會 mount,但 z-index 我們有控制不會干擾。
 */

import { usePlatform } from './PlatformContext'
import Topbar from './Topbar'
import Sidebar from './Sidebar'

export default function PlatformShell({ children }: { children: React.ReactNode }) {
  const { sidebarOpen } = usePlatform()

  return (
    <div className="min-h-screen bg-cortex-bg text-cortex-text font-cortex">
      <Topbar />
      <Sidebar />

      {/* Main content — sidebar 開時 240px shift,關時全寬 */}
      <main
        className={`pt-14 min-h-screen transition-[padding-left] duration-200 ${
          sidebarOpen ? 'lg:pl-60' : 'pl-0'
        }`}
      >
        <div className="max-w-[1440px] mx-auto px-7 py-6 pb-20">
          {children}
        </div>
      </main>
    </div>
  )
}
