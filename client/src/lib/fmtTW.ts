/** Format ISO/Date to Asia/Taipei locale string */
const TZ = 'Asia/Taipei'

/** 2026/03/29 18:43 */
export function fmtTW(v: string | Date | undefined | null): string {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-TW', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** 2026/03/29 */
export function fmtDateTW(v: string | Date | undefined | null): string {
  if (!v) return ''
  return new Date(v).toLocaleString('zh-TW', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  })
}
