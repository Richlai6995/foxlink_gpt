/**
 * HelpBookShareModal — 特殊說明書分享 modal 殼,內嵌 HelpBookShareInline
 *
 * 主邏輯抽到 HelpBookShareInline.tsx(讓「PM 平台設定」也能直接內嵌)。
 * 兩個入口管同一份資料(help_book_shares),改任一邊另一邊立即同步。
 */
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import HelpBookShareInline from './HelpBookShareInline'

interface HelpBookLite {
  id: number
  code: string
  name: string
}

interface Props {
  book: HelpBookLite
  onClose: () => void
}

export default function HelpBookShareModal({ book, onClose }: Props) {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[560px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-medium text-sm">
            {t('help.share.title', '分享設定')} — {book.name}
          </span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-auto p-5">
          <HelpBookShareInline bookId={book.id} />
        </div>
        <div className="flex justify-end px-5 py-3 border-t">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-600 hover:text-slate-800">
            {t('common.close', '關閉')}
          </button>
        </div>
      </div>
    </div>
  )
}
