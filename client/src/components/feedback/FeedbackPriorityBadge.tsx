import { useTranslation } from 'react-i18next'

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-500',
  medium: 'bg-blue-50 text-blue-700',
  high: 'bg-orange-50 text-orange-700',
  urgent: 'bg-red-50 text-red-700',
}

const PRIORITY_DOTS: Record<string, string> = {
  low: 'bg-gray-400',
  medium: 'bg-blue-500',
  high: 'bg-orange-500',
  urgent: 'bg-red-500 animate-pulse',
}

export default function FeedbackPriorityBadge({ priority }: { priority: string }) {
  const { t } = useTranslation()
  const color = PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium
  const dot = PRIORITY_DOTS[priority] || PRIORITY_DOTS.medium
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {t(`feedback.priorityLabels.${priority}`, priority)}
    </span>
  )
}
