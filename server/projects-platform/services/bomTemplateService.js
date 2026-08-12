/**
 * bomTemplateService.js — Cortex BOM 匯入標準範本(產生供下載)
 *
 * 對應 docs/cortex-bom-import-plan.md(B-3.5 template 上傳)。
 *
 * 範本 = 4 分頁工作簿:
 *   說明     — 填寫規則 + 範例
 *   EE/ME/PKG — 各模組料件(header 列 · 使用者照填)
 * 欄位(header-based · importBomTemplate 依 header 名對應,不怕使用者微調欄序):
 *   Category | Item No | Description | Foxlink P/N | Qty | Unit Price (USD) | Vendor | Mfg P/N | Remark
 * 材料成本 = Σ(Qty × Unit Price) 逐模組加總(對齊已驗 rollup)。
 */

const XLSX = require('xlsx');

const MODULES = ['EE', 'ME', 'PKG'];
const HEADERS = ['Category', 'Item No', 'Description', 'Foxlink P/N', 'Qty', 'Unit Price (USD)', 'Vendor', 'Mfg P/N', 'Remark'];

/** 產生範本 xlsx buffer */
function buildTemplateBuffer() {
  const wb = XLSX.utils.book_new();

  const instr = [
    ['Cortex BOM 匯入範本 — 填寫說明'],
    [''],
    ['1. EE / ME / PKG 三個分頁,分別填該模組料件(電子 / 機構 / 包裝)。用不到的分頁留空即可。'],
    ['2. 必填欄:Category(類別)、Qty(數量/台)、Unit Price (USD)(單價)。'],
    ['3. 選填欄:Item No、Description、Foxlink P/N、Vendor、Mfg P/N、Remark。'],
    ['4. 材料成本 = Σ(Qty × Unit Price),系統逐模組加總(EE/ME/PKG)。'],
    ['5. 專案、變體(Black/White)、廠別於「上傳時」選取,不需填在表內。'],
    ['6. 每列一個料件;替代供應商可另開列(同料件 · 之後版本支援),目前一列一主供應商。'],
    ['7. 請勿更動各分頁的標題列文字(系統依標題名對應欄位)。'],
    ['8. 進階 · 區域價:單價欄名加 @區碼 可帶各生產區交貨價 —— 例 U/P@VN(越南交貨 quote)、TRUE@VN(越南交貨 true)。'],
    ['   沒填該區的料 fallback 主單價;算某廠成本時依「廠別→價格區域」映射自動取對應區價(管理→廠級成本範本 維護)。'],
    [''],
    ['── 範例(比照填入 EE 分頁)──'],
    HEADERS,
    ['Capacitor', '1', 'C-SMD,CERAMIC,10V,10uF,0603', '07CA-106M-A3A0', 3, 0.01125, 'Semco', 'CL10A106MP8NNNC', ''],
    ['IC', '2', 'IC,MICRO CONTROLLER,USB2.0', '0629-00xx', 1, 0.726, 'PIXART', 'PAWxxxx', '主控'],
    ['LED', '3', 'LED,RGB,3.5x2.8mm', '07LD-xxxx', 5, 0.098, '', '', ''],
  ];
  const wsInstr = XLSX.utils.aoa_to_sheet(instr);
  wsInstr['!cols'] = HEADERS.map(() => ({ wch: 20 }));
  XLSX.utils.book_append_sheet(wb, wsInstr, '說明');

  for (const m of MODULES) {
    const ws = XLSX.utils.aoa_to_sheet([HEADERS]);
    ws['!cols'] = [{ wch: 16 }, { wch: 8 }, { wch: 34 }, { wch: 18 }, { wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, m);
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildTemplateBuffer, MODULES, HEADERS };
