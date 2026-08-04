/**
 * metalDisplay — 金屬代碼「顯示用」轉換(第二字起小寫)
 *
 *   AU → Au   AG → Ag   CU → Cu   AL → Al   NI → Ni
 *   ZN → Zn   PB → Pb   SN → Sn   PT → Pt   PD → Pd   RH → Rh
 *
 * ⚠️ 只用於「畫面顯示 / 報表輸出」的那一刻。
 *    絕不可用在:API 參數(metal=/metals=)、SQL WHERE、JSON key、
 *    lookup / map key、Webex card 的 data 回傳值、別名 normalize。
 *    那些識別用途一律維持 DB 大寫,否則抓取 / 比對會壞。
 *
 * 規則:首字大寫 + 其餘小寫(通用,未來三字母代碼也對)。
 */
export function metalDisplay(code: string | null | undefined): string {
  if (!code) return ''
  const c = String(code).trim()
  if (!c) return ''
  return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase()
}
