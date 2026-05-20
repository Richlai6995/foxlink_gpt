/**
 * PmNewsExplorerModal — 把採購完整版 PmBriefingPage 的 NewsTab 包成 modal
 * 給精簡版 (/metals) 點放大按鈕後快速瀏覽
 *
 * 完全 reuse 採購版 NewsTab(篩選器 / 搜尋 / 摘要 / 釘選 / 匯出 PDF),
 * 沒複製程式碼 — 採購版改善時自動繼承。
 */
import { X } from 'lucide-react'
import { NewsTab } from '../../pages/PmBriefingPage'

interface Props {
  onClose: () => void
  focusedSet?: Set<string>     // 預設帶入的金屬篩選(精簡版用 user prefs)
  default24h?: boolean          // 預設只看 24h(精簡版預設 false 看近期)
}

export default function PmNewsExplorerModal({ onClose, focusedSet, default24h = false }: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-2">
      <div className="bg-slate-50 rounded-xl w-full h-full max-w-7xl max-h-[95vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="px-4 py-2 border-b border-slate-200 bg-white flex items-center justify-between flex-shrink-0">
          <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            📰 新聞瀏覽 <span className="text-[10px] text-slate-400 font-normal">(完整篩選器版本)</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          <NewsTab focusedSet={focusedSet || new Set()} default24h={default24h} />
        </div>
      </div>
    </div>
  )
}
