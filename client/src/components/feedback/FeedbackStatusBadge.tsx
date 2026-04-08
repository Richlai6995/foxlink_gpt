import { useTranslation } from 'react-i18next'

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-50 text-gray-500 border-gray-200',
  open: 'bg-blue-50 text-blue-700 border-blue-200',
  processing: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  pending_user: 'bg-purple-50 text-purple-700 border-purple-200',
  resolved: 'bg-green-50 text-green-700 border-green-200',
  closed: 'bg-gray-100 text-gray-500 border-gray-200',
  reopened: 'bg-orange-50 text-orange-700 border-orange-200',
}

export default function FeedbackStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  const color = STATUS_COLORS[status] || STATUS_COLORS.open
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${color}`}>
      {t(`feedback.statusLabels.${status}`, status)}
    </span>
  )
}
