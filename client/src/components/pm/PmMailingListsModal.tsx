/**
 * PmMailingListsModal — 把 PmMailingListsPanel 包成 modal 給精簡版採購用
 *
 * Mailing list 之前放在 admin tab,但採購沒 admin 權限。改放到精簡版
 * toolbar(/metals 頁面右上),點開 modal 自己管(後端 verifyPmUser 已允許)。
 */
import { X } from 'lucide-react'
import PmMailingListsPanel from '../admin/PmMailingListsPanel'

interface Props {
  onClose: () => void
}

export default function PmMailingListsModal({ onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
      <div className="bg-white rounded-xl w-full h-full max-w-5xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            📧 PM 寄信清單管理
            <span className="text-[10px] text-slate-400 font-normal">(全採購共用)</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <PmMailingListsPanel />
        </div>
      </div>
    </div>
  )
}
