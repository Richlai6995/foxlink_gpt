/**
 * TaskGantt — Dependency-based Gantt 視圖
 *
 * 對齊 PPT slide 12 + Demo 手冊 §6
 *
 * 純 SVG render(避免拉 ECharts dep)。
 *   - 每 task 一條 bar(start = computed_due_at - sla, end = computed_due_at)
 *   - 同 stage 同色
 *   - 有 depends_on_task_id → 畫箭頭(粗略)
 *   - status BLOCKED 紅邊 / DONE 綠 / 其他正常
 */

import { useMemo } from 'react'
import type { Task } from '../api'
import { TOKENS } from '../tokens'

type Props = {
  tasks: Task[]
  onClick?: (t: Task) => void
}

const STATUS_COLOR: Record<string, string> = {
  PENDING:          TOKENS.line,
  IN_PROGRESS:      TOKENS.cyan,
  BLOCKED:          TOKENS.red,
  READY_FOR_REVIEW: TOKENS.amber,
  DONE:             TOKENS.green,
  CANCELLED:        TOKENS.muted,
}

export default function TaskGantt({ tasks, onClick }: Props) {
  // 計算範圍
  const { rangeStart, rangeEnd, days } = useMemo(() => {
    const now = Date.now()
    let min = now
    let max = now + 14 * 86400000
    for (const t of tasks) {
      if (t.computed_due_at) {
        const due = new Date(t.computed_due_at).getTime()
        if (due > max) max = due
        // start = due - 4h(粗略)
        const start = due - 4 * 3600000
        if (start < min) min = start
      }
    }
    const days = Math.max(7, Math.ceil((max - min) / 86400000) + 2)
    return { rangeStart: min, rangeEnd: max, days }
  }, [tasks])

  if (tasks.length === 0) {
    return (
      <div className="p-12 text-center text-cortex-muted text-sm bg-white border border-cortex-line rounded-lg">
        尚無任務 · 加幾筆後 Gantt 圖會自動顯示
      </div>
    )
  }

  const ROW_H = 28
  const HEADER_H = 28
  const LABEL_W = 200
  const dayW = 60  // 一天 60px
  const totalW = LABEL_W + dayW * days
  const totalH = HEADER_H + tasks.length * ROW_H + 10

  // 日期 ticks
  const startDay = new Date(rangeStart)
  startDay.setHours(0, 0, 0, 0)

  return (
    <div className="bg-white border border-cortex-line rounded-lg overflow-auto">
      <svg width={totalW} height={totalH} className="block">
        {/* Day header */}
        <g>
          <rect x={0} y={0} width={totalW} height={HEADER_H} fill={TOKENS.bg} />
          <rect x={0} y={0} width={LABEL_W} height={HEADER_H} fill={TOKENS.line2} />
          <text x={10} y={18} fontSize="11" fill={TOKENS.muted} fontWeight="bold">任務</text>
          {Array.from({ length: days }).map((_, i) => {
            const d = new Date(startDay.getTime() + i * 86400000)
            const x = LABEL_W + i * dayW
            return (
              <g key={i}>
                <line x1={x} y1={0} x2={x} y2={totalH} stroke={TOKENS.line} strokeWidth={0.5} />
                <text x={x + 4} y={11} fontSize="9" fill={TOKENS.muted}>
                  {`${d.getMonth() + 1}/${d.getDate()}`}
                </text>
                <text x={x + 4} y={22} fontSize="9" fill={TOKENS.text} fontFamily="monospace">
                  {['日', '一', '二', '三', '四', '五', '六'][d.getDay()]}
                </text>
              </g>
            )
          })}
          <line x1={0} y1={HEADER_H} x2={totalW} y2={HEADER_H} stroke={TOKENS.line} />
        </g>

        {/* Today line */}
        {(() => {
          const todayX = LABEL_W + (Date.now() - rangeStart) / 86400000 * dayW
          if (todayX < LABEL_W) return null
          return (
            <g>
              <line x1={todayX} y1={HEADER_H} x2={todayX} y2={totalH} stroke={TOKENS.cyan} strokeWidth={2} strokeDasharray="4 4" />
              <text x={todayX + 4} y={HEADER_H - 4} fontSize="9" fill={TOKENS.cyan} fontWeight="bold">今天</text>
            </g>
          )
        })()}

        {/* Task rows */}
        {tasks.map((t, i) => {
          const y = HEADER_H + i * ROW_H + 4
          const due = t.computed_due_at ? new Date(t.computed_due_at).getTime() : null

          // bar:沒 due 給 fallback(從今天起 1 天)
          const barEnd   = due || (Date.now() + 86400000)
          const barStart = due
            ? (due - (Math.max(4, 0) + 12) * 3600000)  // 預估 12h 起跑
            : Date.now()
          const x1 = LABEL_W + (barStart - rangeStart) / 86400000 * dayW
          const x2 = LABEL_W + (barEnd - rangeStart) / 86400000 * dayW
          const barW = Math.max(8, x2 - x1)

          const color = STATUS_COLOR[t.status] || TOKENS.line
          const isOverdue = due && due < Date.now() && t.status !== 'DONE'

          return (
            <g key={t.id} className="cursor-pointer" onClick={() => onClick?.(t)}>
              {/* Row bg */}
              <rect x={0} y={y - 4} width={totalW} height={ROW_H} fill={i % 2 === 0 ? '#fff' : TOKENS.line2 + '40'} />

              {/* Label */}
              <text x={10} y={y + 14} fontSize="11" fill={TOKENS.ink} className="select-none">
                {t.title.length > 24 ? t.title.slice(0, 22) + '…' : t.title}
              </text>
              {t.accountable_role && (
                <text x={LABEL_W - 6} y={y + 14} fontSize="9" fill={'#b91c1c'} textAnchor="end" fontWeight="bold">
                  A:{t.accountable_role}
                </text>
              )}

              {/* Bar */}
              <rect
                x={x1} y={y + 4} width={barW} height={ROW_H - 12}
                fill={color}
                stroke={isOverdue ? TOKENS.red : 'none'}
                strokeWidth={isOverdue ? 2 : 0}
                rx={3}
              />
              {t.progress_percent > 0 && (
                <rect
                  x={x1} y={y + 4} width={barW * t.progress_percent / 100} height={ROW_H - 12}
                  fill={TOKENS.navy} opacity={0.3} rx={3}
                />
              )}
              {due && (
                <text
                  x={x2 + 4} y={y + 17} fontSize="9"
                  fill={isOverdue ? TOKENS.red : TOKENS.muted}
                  fontFamily="monospace"
                >
                  {`${new Date(due).getMonth() + 1}/${new Date(due).getDate()}`}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
