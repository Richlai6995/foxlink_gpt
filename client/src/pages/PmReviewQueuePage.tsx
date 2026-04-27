/**
 * /pm/review — standalone wrapper(deep link / 通知信仍可用)
 * 主邏輯已抽到 components/pm/PmReviewQueueView.tsx,/pm/briefing 第 4 tab 也用該 component
 */
import PmReviewQueueView from '../components/pm/PmReviewQueueView'

export default function PmReviewQueuePage() {
  return <PmReviewQueueView />
}
