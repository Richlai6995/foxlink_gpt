'use strict';

/**
 * metalDisplay — 金屬代碼「顯示用」轉換(第二字起小寫)
 *
 *   AU → Au   AG → Ag   CU → Cu   AL → Al   NI → Ni
 *   ZN → Zn   PB → Pb   SN → Sn   PT → Pt   PD → Pd   RH → Rh
 *
 * ⚠️ 只用於「畫面 / 報表 / Webex 卡片標題」等輸出的那一刻。
 *    絕不可用在:SQL WHERE(UPPER(metal_code))、entity_code JSON 欄位、
 *    Webex card 的 data 回傳值、別名 normalize、DB 寫入 transform。
 *    那些識別用途一律維持大寫,否則抓取 / 比對會壞。
 *
 * 規則:首字大寫 + 其餘小寫(通用,未來三字母代碼也對)。
 */
function metalDisplay(code) {
  if (code == null) return '';
  const c = String(code).trim();
  if (!c) return '';
  return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
}

/** 逗號分隔的多代碼字串 → 顯示字串(保留分隔符) */
function metalDisplayList(csv, sep = ',') {
  if (!csv) return '';
  return String(csv)
    .split(',')
    .map(s => metalDisplay(s.trim()))
    .filter(Boolean)
    .join(sep);
}

module.exports = { metalDisplay, metalDisplayList };
