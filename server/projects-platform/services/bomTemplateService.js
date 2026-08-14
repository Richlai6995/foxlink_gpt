/**
 * bomTemplateService.js — Cortex BOM 匯入標準範本(產生供下載)
 *
 * 2026-08-14 升級:對齊「標準統一格式 v2」(canonical · importCanonicalBom 主匯入路徑)。
 * 舊三分頁(EE/ME/PKG)範本與主匯入路徑(統一格式)不一致 → 改為:
 *   說明     — 填寫規則 + 範例
 *   BOM      — 單一分頁 · header-based(半成品/Module/分類/FLK/適用/區域價 全欄)
 *   變異軸   — 維度 | 值1 | 值2 …(匯入時自動建定義;# 開頭列略過)
 *
 * header 對應 bomImportProfileService.resolveCanonicalHeader(名稱匹配 · 不怕欄序調整):
 *   半成品 | 半成品料號 | Module | 分類 | Item No | Description | Foxlink P/N | Qty
 *   | Unit Price (USD) | U/P@VN | TRUE@VN | Vendor | Mfg P/N | 適用 | Remark
 * 材料成本 = Σ(Qty × Unit Price);U/P@區 = 該生產區交貨價覆寫(013ad)。
 */

const XLSX = require('xlsx');

// 統一格式 v2 全欄(含 013ad 區域價示範欄 @VN — 不需要可整欄刪除或留空)
const HEADERS = [
  '半成品', '半成品料號', 'Module', '分類', 'Item No', 'Description', 'Foxlink P/N',
  'Qty', 'Unit Price (USD)', 'U/P@VN', 'TRUE@VN', 'Vendor', 'Mfg P/N', '適用', 'Remark',
];
const MODULES = ['EE', 'ME', 'PKG'];   // Module 欄合法值(向下相容 export)

/** 產生範本 xlsx buffer(統一格式 v2)*/
function buildTemplateBuffer() {
  const wb = XLSX.utils.book_new();

  const instr = [
    ['Cortex BOM 匯入範本 — 填寫說明(標準統一格式 v2)'],
    [''],
    ['1. 全部料件填「BOM」單一分頁;一列一料件。半成品(板/組件)當欄位區分,不用分頁。'],
    ['2. 必填欄:半成品(如 MainBoard / Strap;同板料件填同名)、Module(EE/ME/PKG)、Qty(數量/台)。'],
    ['3. 價格欄:Unit Price (USD) = 主單價;RD 結構匯入可留空(=待詢價,採購之後補價)。'],
    ['4. 區域價(選填 · 013ad):U/P@VN = 越南生產區交貨 quote、TRUE@VN = 該區 true 成本;'],
    ['   欄名 @後綴 = 區碼(VN/US/IN…可自加欄如 U/P@US);沒填的料 fallback 主單價。'],
    ['   算某廠成本時依「廠別→價格區域」映射自動取價(管理→廠級成本範本 頁尾維護)。'],
    ['5. 適用欄(選填 · 變異料):格式「維度=值」分號分隔 —— 例「顏色=Black」「包裝=Retail;顏色=White」。'],
    ['   填了 = 該料只在該產品配置計入(effectivity);空 = 所有配置都含。'],
    ['   ⚠ 適用欄用到的維度/值,必須先在「變異軸」分頁定義(或系統變異軸設定已有),否則匯入會中止提示。'],
    ['6. 其他選填:半成品料號(可空 → 系統自動暫編)、分類(Capacitor/Resistor…)、Item No、'],
    ['   Description、Foxlink P/N、Vendor、Mfg P/N、Remark。'],
    ['7. 材料成本 = Σ(Qty × Unit Price),依 Module(EE/ME/PKG)與半成品分組 rollup。'],
    ['8. 請勿更動標題列文字(系統依標題名對應欄位;欄序可調、不用的欄可刪)。'],
    ['9. 替代供應商 / 替代料:同一料件緊接著多列(料號欄留空 = 上一顆料的另一組 vendor/價)。'],
    [''],
    ['── 範例(比照填入 BOM 分頁)──'],
    HEADERS,
    ['MainBoard', '', 'EE', 'Capacitor', 1, 'C-SMD,CERAMIC,10V,10uF,0603', '07CA-106M-A3A0', 3, 0.01125, 0.0121, '', 'Semco', 'CL10A106MP8NNNC', '', ''],
    ['MainBoard', '', 'EE', 'IC', 2, 'IC,MICRO CONTROLLER,USB2.0', '0629-00xx', 1, 0.726, 0.78, 0.7, 'PIXART', 'PAWxxxx', '', '主控'],
    ['Strap', '', 'ME', 'Plastic', 1, 'STRAP,BLACK', '094A-xxxx', 1, 0.35, '', '', 'ABC塑膠', '', '顏色=Black', '黑色版專用'],
    ['PKG Retail', '', 'PKG', 'Packaging', 1, 'RETAIL BOX', '07PK-xxxx', 1, 0.6, '', '', '', '', '包裝=Retail', ''],
  ];
  const wsInstr = XLSX.utils.aoa_to_sheet(instr);
  wsInstr['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 30 }, { wch: 16 }, { wch: 6 }, { wch: 12 }, { wch: 9 }, { wch: 9 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, '說明');

  // BOM 分頁(只留 header · 範例見說明頁)
  const wsBom = XLSX.utils.aoa_to_sheet([HEADERS]);
  wsBom['!cols'] = wsInstr['!cols'];
  XLSX.utils.book_append_sheet(wb, wsBom, 'BOM');

  // 變異軸分頁(維度 | 值…;# 開頭列匯入自動略過)
  const wsDim = XLSX.utils.aoa_to_sheet([
    ['維度', '值1', '值2', '值3', '值4', '值5'],
    ['# 範例:顏色', 'Black', 'White'],
    ['# 範例:包裝', 'Retail', 'WB-Suit', 'WB-Strap'],
    ['# 把 # 拿掉即生效;適用欄用到的維度/值都要在這裡列出'],
  ]);
  wsDim['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsDim, '變異軸');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildTemplateBuffer, MODULES, HEADERS };
