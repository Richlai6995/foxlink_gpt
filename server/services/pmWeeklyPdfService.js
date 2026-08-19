'use strict';

/**
 * pmWeeklyPdfService — 金屬市場週報 PDF 產生器(排程用,server-side 無瀏覽器)
 *
 * 產出對齊「人工整理版」週報格式(海軍藍標題橫幅 + 資訊列 + 青色段落標題 +
 * 橘色雙表頭漲跌表 + Foxlink Confidential 頁尾),並「新增」每金屬:
 *   - 近 6 個月每日走勢圖(pdfkit 向量描線,不需 canvas/echarts)
 *   - 月均價 + 月漲跌幅表(數字一律 SQL 算,LLM 不碰)
 *
 * 入口:buildWeeklyPdf({ db, aiOutput, filename, asOfDate, context })
 *   - aiOutput  = 排程主 LLM 回應全文(markdown 報告 + 尾端 ```json``` 落地段)
 *   - 回傳 { filename, publicUrl, filePath } 供 pipeline generatedFiles → email 附件
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { metalDisplay } = require('./metalDisplay');
const { resolveCjkFontPath } = require('./cjkFont');

// ── 金屬定義(固定順序,對齊精簡版 / 週報表格)──────────────────────────────
const BASE_METALS = [
  { code: 'CU', zh: '銅' }, { code: 'AL', zh: '鋁' }, { code: 'NI', zh: '鎳' },
  { code: 'ZN', zh: '鋅' }, { code: 'PB', zh: '鉛' }, { code: 'SN', zh: '錫' },
];
const PRECIOUS_METALS = [
  { code: 'AU', zh: '金' }, { code: 'AG', zh: '銀' }, { code: 'PT', zh: '鉑' },
  { code: 'PD', zh: '鈀' }, { code: 'RH', zh: '銠' },
];
const ALL_METALS = [...BASE_METALS, ...PRECIOUS_METALS];
const isPrecious = (code) => PRECIOUS_METALS.some(m => m.code === String(code).toUpperCase());
const unitOf = (code) => (isPrecious(code) ? 'USD/Troy Oz' : 'USD/Ton');

// ── 視覺主題(取自參考檔配色)───────────────────────────────────────────────
const C = {
  navy:      '#1F3A5F',
  navy2:     '#2E4B73',
  teal:      '#1F7A8C',
  orange:    '#E1701A',
  orangeDk:  '#BF5A10',
  up:        '#C0272D',   // 紅漲(台股慣例)
  down:      '#1F8A3B',   // 綠跌
  flat:      '#6B7280',
  grid:      '#E6EAF0',
  line:      '#D9D9D9',
  text:      '#333333',
  muted:     '#6B7280',
  chart:     '#ED7D31',
  chartFill: '#FBE7D5',
  headBg:    '#F5F7FA',
};

const FONT = 'cjk';
const MARGIN = 42;

// ── 小工具 ───────────────────────────────────────────────────────────────────
function fmtPrice(v) {
  if (v == null) return '—';   // 缺月 avg=null → Number(null)=0 會誤顯 0.000,先擋掉
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const dec = abs >= 1000 ? 1 : (abs >= 100 ? 2 : (abs >= 10 ? 2 : 3));
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtPct(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}
function pctColor(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return C.flat;
  return n > 0 ? C.up : C.down;
}
function isoWeek(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// faux-bold:同字型偏移 0.3pt 疊印,補 NotoSansTC 無 Bold 檔
function drawText(doc, str, x, y, opts = {}, bold = false) {
  const o = { lineBreak: false, ...opts };
  doc.text(str, x, y, o);
  if (bold) doc.text(str, x + 0.35, y, o);
}

// ── SQL:月均價 + 月漲跌幅(取 7 個月算差,顯示最後 6 個)──────────────────────
async function getMonthlySeries(db, code, asOf) {
  let rows = [];
  try {
    rows = await db.prepare(`
      SELECT TO_CHAR(as_of_date,'YYYY-MM') AS ym, AVG(price_usd) AS avg_price
      FROM pm_price_history
      WHERE UPPER(metal_code) = UPPER(?)
        AND price_usd IS NOT NULL
        AND as_of_date >= ADD_MONTHS(TRUNC(TO_DATE(?, 'YYYY-MM-DD'),'MM'), -6)
        AND as_of_date <  ADD_MONTHS(TRUNC(TO_DATE(?, 'YYYY-MM-DD'),'MM'), 1)
      GROUP BY TO_CHAR(as_of_date,'YYYY-MM')
      ORDER BY ym
    `).all(code, asOf, asOf);
  } catch (e) {
    console.warn(`[pmWeeklyPdf] getMonthlySeries ${code} failed:`, e.message);
  }
  // 日曆 spine 對齊:固定回傳 M-5..M0 共 6 個「日曆月」(缺月 avg/chg = null),
  // 月漲跌一律對「真正的上一個日曆月」算,絕不跨資料缺口誤算成單月漲跌。
  // 也讓 PDF 月表(drawMonthlyTable)與 docx 矩陣(lastNMonths)顯示同一組月份。
  const byYm = new Map(rows.map(r => [r.ym || r.YM, Number(r.avg_price ?? r.AVG_PRICE)]));
  const cal = lastNMonths(asOf, 7);            // [M-6 .. M0] 日曆連續
  const withChg = cal.slice(1).map((ym, k) => {
    const prevYm = cal[k];                     // 真正的上一個日曆月
    const avg = byYm.has(ym) ? byYm.get(ym) : null;
    const prev = byYm.has(prevYm) ? byYm.get(prevYm) : null;
    return {
      ym,
      avg,
      chg: Number.isFinite(avg) && Number.isFinite(prev) && prev !== 0
        ? ((avg - prev) / prev) * 100
        : null,
    };
  });
  return withChg;  // 固定 6 個日曆月 M-5..M0
}

// ── SQL:近 ~6 個月每日價(畫線用)────────────────────────────────────────────
async function getDailySeries(db, code, asOf) {
  let rows = [];
  try {
    rows = await db.prepare(`
      SELECT TO_CHAR(as_of_date,'YYYY-MM-DD') AS d, AVG(price_usd) AS price
      FROM pm_price_history
      WHERE UPPER(metal_code) = UPPER(?)
        AND price_usd IS NOT NULL
        AND as_of_date >  TO_DATE(?, 'YYYY-MM-DD') - 184
        AND as_of_date <= TO_DATE(?, 'YYYY-MM-DD')
      GROUP BY as_of_date
      ORDER BY as_of_date
    `).all(code, asOf, asOf);
  } catch (e) {
    console.warn(`[pmWeeklyPdf] getDailySeries ${code} failed:`, e.message);
  }
  return rows.map(r => ({ d: r.d || r.D, price: Number(r.price ?? r.PRICE) }))
    .filter(p => Number.isFinite(p.price));
}

// ── 版面:頁尾 + 首頁標題橫幅 ────────────────────────────────────────────────
function contentWidth(doc) { return doc.page.width - MARGIN * 2; }
function pageBottom(doc) { return doc.page.height - 52; }

function drawHeaderBanner(doc, { asOfDate }) {
  const w = doc.page.width;
  const wk = isoWeek(asOfDate);
  // 主標題橫幅
  doc.save();
  doc.rect(0, 0, w, 62).fill(C.navy);
  doc.fillColor('#FFFFFF');
  doc.font(FONT).fontSize(24);
  drawText(doc, '金屬市場週報', MARGIN, 18, {}, true);
  // 橘色底線 accent
  doc.rect(MARGIN, 50, 150, 3).fill(C.orange);
  // 資訊列
  doc.rect(0, 62, w, 26).fill(C.navy2);
  doc.fillColor('#FFFFFF').fontSize(10.5);
  const info = `報告日期:${asOfDate}${wk ? `(WK${wk})` : ''}      報告單位:策略採購處      分析助理:Cortex`;
  drawText(doc, info, MARGIN, 69, {}, false);
  doc.restore();
  doc.x = MARGIN;
  doc.y = 104;
}

function ensureSpace(doc, need) {
  if (doc.y + need > pageBottom(doc)) { doc.addPage(); doc.x = MARGIN; doc.y = MARGIN; }
}

// ── 段落標題(青色 + 底線)────────────────────────────────────────────────────
function drawSectionTitle(doc, text) {
  const cw = contentWidth(doc);
  doc.fillColor(C.teal).font(FONT).fontSize(15);
  const h = doc.heightOfString(text, { width: cw });   // 給寬度 → 過長自動換行,不被頁緣切
  ensureSpace(doc, h + 24);
  doc.y += 8;
  const y0 = doc.y;
  doc.text(text, MARGIN, y0, { width: cw });
  doc.text(text, MARGIN + 0.35, y0, { width: cw });    // faux-bold 疊印
  const ty = y0 + h + 4;
  doc.moveTo(MARGIN, ty).lineTo(doc.page.width - MARGIN, ty).lineWidth(1).strokeColor(C.teal).stroke();
  doc.y = ty + 8;
  doc.x = MARGIN;
}

function drawSubTitle(doc, text) {
  const cw = contentWidth(doc);
  doc.fillColor(C.text).font(FONT).fontSize(11.5);
  const h = doc.heightOfString(text, { width: cw });
  ensureSpace(doc, h + 10);
  const y0 = doc.y;
  doc.text(text, MARGIN, y0, { width: cw });
  doc.text(text, MARGIN + 0.35, y0, { width: cw });    // faux-bold 疊印
  doc.y = y0 + h + 4;
  doc.x = MARGIN;
}

// ── 內文(bullet / paragraph)──────────────────────────────────────────────────
function stripInline(s) {
  return String(s).replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim();
}
function drawBullet(doc, text) {
  const cw = contentWidth(doc);
  doc.fillColor(C.text).font(FONT).fontSize(10.5);
  const h = doc.heightOfString(text, { width: cw - 16 });
  ensureSpace(doc, h + 4);
  doc.fillColor(C.orange).text('•', MARGIN + 2, doc.y, { lineBreak: false });
  doc.fillColor(C.text).text(text, MARGIN + 16, doc.y, { width: cw - 16 });
  doc.y += 2;
}
function drawParagraph(doc, text) {
  const cw = contentWidth(doc);
  doc.fillColor(C.text).font(FONT).fontSize(10.5);
  const h = doc.heightOfString(text, { width: cw });
  ensureSpace(doc, h + 4);
  doc.text(text, MARGIN, doc.y, { width: cw });
  doc.y += 3;
}

// ── 漲跌統計表(橘色雙表頭,驅動文字換行)──────────────────────────────────────
function drawMetalTable(doc, unit, rows) {
  const cw = contentWidth(doc);
  // 欄寬:金屬品種 / 上週報價 / 本週最新報價 / 週漲跌幅 / 驅動
  const wName = 62, wPrev = 92, wLast = 92, wChg = 58;
  const wDrv = cw - wName - wPrev - wLast - wChg;
  const xs = [MARGIN, MARGIN + wName, MARGIN + wName + wPrev, MARGIN + wName + wPrev + wLast, MARGIN + wName + wPrev + wLast + wChg];
  const ws = [wName, wPrev, wLast, wChg, wDrv];

  // 表頭(兩行:標題 + 單位)— 抽成 helper,跨頁時每頁重畫
  const headH = 30;
  const heads = [
    ['金屬品種', ''],
    ['上週報價', `(${unit})`],
    ['本週最新報價', `(${unit})`],
    ['週漲跌幅', ''],
    ['主要驅動因素與市場現況', ''],
  ];
  const drawHead = (top) => {
    for (let i = 0; i < 5; i++) {
      doc.rect(xs[i], top, ws[i], headH).fill(i === 0 ? C.orangeDk : C.orange);
      doc.fillColor('#FFFFFF').font(FONT).fontSize(9);
      const lines = heads[i].filter(Boolean);
      const th = lines.length * 11;
      let ty = top + (headH - th) / 2;
      for (const ln of lines) {
        const tw = doc.widthOfString(ln);
        const align = i >= 1 && i <= 3 ? xs[i] + (ws[i] - tw) / 2 : xs[i] + 5;
        drawText(doc, ln, align, ty, {}, true);
        ty += 11;
      }
    }
    return top + headH;
  };
  ensureSpace(doc, headH + 30);
  let y = drawHead(doc.y);

  // 資料列
  doc.font(FONT).fontSize(9);
  for (const r of rows) {
    const drvH = doc.heightOfString(r.driver || '—', { width: wDrv - 10 });
    const rowH = Math.max(26, drvH + 10);
    if (y + rowH > pageBottom(doc)) { doc.addPage(); y = drawHead(MARGIN); }
    // 邊框
    for (let i = 0; i < 5; i++) {
      doc.rect(xs[i], y, ws[i], rowH).lineWidth(0.5).strokeColor(C.line).stroke();
    }
    const midY = y + (rowH - 11) / 2;
    // 金屬品種(粗體)
    doc.fillColor(C.text);
    drawText(doc, r.name, xs[0] + 5, midY, { width: wName - 8 }, true);
    // 上週 / 本週(置中)
    for (const [ci, val] of [[1, r.prev], [2, r.last]]) {
      const tw = doc.widthOfString(val);
      doc.fillColor(C.text);
      drawText(doc, val, xs[ci] + (ws[ci] - tw) / 2, midY, {}, false);
    }
    // 週漲跌幅(置中 + 顏色 + 粗體)
    const cw2 = doc.widthOfString(r.change);
    doc.fillColor(pctColor(r.changeNum));
    drawText(doc, r.change, xs[3] + (ws[3] - cw2) / 2, midY, {}, true);
    // 驅動(換行,置中垂直)
    doc.fillColor(C.text).font(FONT).fontSize(9);
    const dY = y + (rowH - drvH) / 2;
    doc.text(r.driver || '—', xs[4] + 5, dY, { width: wDrv - 10 });
    y += rowH;
  }
  doc.y = y + 6;
  doc.x = MARGIN;
}

// ── 每金屬:走勢圖 + 月表 ─────────────────────────────────────────────────────
function drawLineChart(doc, x, y, w, h, points, unit) {
  const padL = 46, padR = 8, padT = 8, padB = 16;
  const px0 = x + padL, px1 = x + w - padR;
  const py0 = y + padT, py1 = y + h - padB;
  // 背景框
  doc.rect(x, y, w, h).lineWidth(0.5).strokeColor(C.line).stroke();
  if (!points || points.length < 2) {
    doc.fillColor(C.muted).font(FONT).fontSize(9);
    drawText(doc, '(近 6 個月無足夠報價資料)', px0 + 10, y + h / 2 - 5, {}, false);
    return;
  }
  const prices = points.map(p => p.price);
  let min = Math.min(...prices), max = Math.max(...prices);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08;
  min -= pad; max += pad;
  const sx = (i) => px0 + (i / (points.length - 1)) * (px1 - px0);
  const sy = (v) => py1 - ((v - min) / (max - min)) * (py1 - py0);

  // 水平格線 + y 軸標
  doc.font(FONT).fontSize(7).fillColor(C.muted);
  const GN = 4;
  for (let g = 0; g <= GN; g++) {
    const gy = py0 + (g / GN) * (py1 - py0);
    doc.moveTo(px0, gy).lineTo(px1, gy).lineWidth(0.4).strokeColor(C.grid).stroke();
    const val = max - (g / GN) * (max - min);
    doc.fillColor(C.muted);
    drawText(doc, fmtPrice(val), x + 2, gy - 3, { width: padL - 6, align: 'right' }, false);
  }
  // x 軸月份標(月變更處)
  let lastMon = '';
  for (let i = 0; i < points.length; i++) {
    const mon = points[i].d.slice(0, 7);
    if (mon !== lastMon) {
      lastMon = mon;
      const lx = sx(i);
      const label = `${Number(points[i].d.slice(5, 7))}/${Number(points[i].d.slice(8, 10))}`;
      doc.fillColor(C.muted).fontSize(7);
      drawText(doc, label, lx - 8, py1 + 4, {}, false);
    }
  }
  // 折線
  doc.save();
  doc.moveTo(sx(0), sy(points[0].price));
  for (let i = 1; i < points.length; i++) doc.lineTo(sx(i), sy(points[i].price));
  doc.lineWidth(1.2).strokeColor(C.chart).stroke();
  doc.restore();
}

// 月表:左側標籤欄(Y/M / MAP / Change(%))+ 各月一欄,對齊使用者提供之附圖格式。
// rowH 可調(compact grid 用較矮列高塞 3 金屬/頁)。回傳底部 y。
function drawMonthlyTable(doc, x, y, w, months, rowH = 15) {
  const n = months.length;
  if (n === 0) return y;
  const fontSz = rowH <= 13 ? 7.2 : 8;
  doc.font(FONT).fontSize(fontSz);
  const rows = [
    { label: 'Year/Month',         fill: C.headBg, cells: months.map(m => m.ym.replace('-', '/')), bold: true,
      color: () => C.text, headRow: true },
    { label: 'Monthly Avg. Price', fill: null,     cells: months.map(m => fmtPrice(m.avg)), bold: false,
      color: () => C.text },
    { label: 'Change(%)',          fill: null,     cells: months.map(m => (m.chg == null ? '—' : fmtPct(m.chg))), bold: true,
      color: (i) => (months[i].chg == null ? C.muted : pctColor(months[i].chg)) },
  ];
  // 標籤欄寬依最長標籤(Monthly Avg. Price)自適應,保持單行不換行、不動 rowH
  const maxLabelW = Math.max(...rows.map(r => doc.widthOfString(r.label)));
  const labelW = Math.min(118, Math.max(58, maxLabelW + 10));
  const colW = (w - labelW) / n;
  // 安全網:月表 3 列不可跨頁(正常已由 block 前置檢查保證同頁)
  if (y + rowH * 3 + 4 > pageBottom(doc)) { doc.addPage(); doc.x = MARGIN; doc.y = MARGIN; y = MARGIN; }
  const cellText = (str, cx, cw, cy, color, bold) => {
    doc.fillColor(color);
    const tw = doc.widthOfString(str);
    const tx = cx + Math.max(2, (cw - tw) / 2);
    drawText(doc, str, tx, cy, {}, bold);
  };
  for (let r = 0; r < rows.length; r++) {
    const ry = y + r * rowH;
    const row = rows[r];
    // 左側標籤格(淺底)
    doc.rect(x, ry, labelW, rowH).fill(C.headBg);
    doc.rect(x, ry, labelW, rowH).lineWidth(0.5).strokeColor(C.line).stroke();
    cellText(row.label, x, labelW, ry + (rowH - fontSz) / 2 - 1, C.text, true);
    // 月份資料格
    for (let i = 0; i < n; i++) {
      const cx = x + labelW + i * colW;
      if (row.fill) doc.rect(cx, ry, colW, rowH).fill(row.fill);
      doc.rect(cx, ry, colW, rowH).lineWidth(0.5).strokeColor(C.line).stroke();
      cellText(row.cells[i], cx, colW, ry + (rowH - fontSz) / 2 - 1, row.color(i), row.bold);
    }
  }
  return y + rowH * 3;
}

// 分組標題橫幅(海軍藍底,每組首頁一條)
function drawGroupTitle(doc, title, sub) {
  const cw = contentWidth(doc);
  const h = 26;
  const y = doc.y;
  doc.rect(MARGIN, y, cw, h).fill(C.navy);
  doc.fillColor('#FFFFFF').font(FONT).fontSize(13);
  const titleX = MARGIN + 8;
  drawText(doc, title, titleX, y + 6, {}, true);
  const titleRight = titleX + doc.widthOfString(title) + 0.35;  // +0.35 = faux-bold 疊印寬
  if (sub) {
    doc.fontSize(8.5).fillColor('#CFE0F5');
    const tw = doc.widthOfString(sub);
    const rightX = MARGIN + cw - tw - 8;             // 預設右對齊
    let subX = Math.max(rightX, titleRight + 16);    // 與大標題至少留 16pt,避免 USD 疊到標題
    if (subX + tw > MARGIN + cw - 6) subX = rightX;  // 放不下才回右對齊(此字串不會發生)
    drawText(doc, sub, subX, y + 9, {}, false);
  }
  doc.y = y + h + 8;
  doc.x = MARGIN;
}

// 單一金屬「緊湊塊」:在給定矩形 (x,y,w,h) 內畫 子標題 + 走勢圖 + 月表(Y/M/MAP/Change)
async function drawCompactMetalBlock(doc, db, metal, asOf, x, y, w, h) {
  const unit = unitOf(metal.code);
  const disp = metalDisplay(metal.code);
  const titleH = 15, tRowH = 13, tableH = tRowH * 3, gap1 = 2, gap2 = 6, botPad = 8;
  const chartH = Math.max(90, h - titleH - gap1 - gap2 - tableH - botPad);
  // 子標題
  doc.fillColor(C.navy).font(FONT).fontSize(10.5);
  drawText(doc, `${metal.zh} ${disp}(${unit})`, x, y, {}, true);
  // 資料
  const [daily, monthly] = await Promise.all([
    getDailySeries(db, metal.code, asOf),
    getMonthlySeries(db, metal.code, asOf),
  ]);
  drawLineChart(doc, x, y + titleH + gap1, w, chartH, daily, unit);
  drawMonthlyTable(doc, x, y + titleH + gap1 + chartH + gap2, w, monthly, tRowH);
}

// 一組金屬(基本 / 貴金屬):自成頁,3 金屬/頁緊湊排,避免頁數過多
async function drawMetalGroupGrid(doc, db, metals, asOf, title, sub) {
  const perPage = 3;
  const cw = contentWidth(doc);
  doc.addPage(); doc.x = MARGIN; doc.y = MARGIN;   // 每組從新頁開始
  drawGroupTitle(doc, title, sub);
  let idx = 0;
  let pageTopY = doc.y;
  while (idx < metals.length) {
    const blockH = (pageBottom(doc) - pageTopY) / perPage;
    const cnt = Math.min(perPage, metals.length - idx);
    for (let b = 0; b < cnt; b++) {
      await drawCompactMetalBlock(doc, db, metals[idx], asOf, MARGIN, pageTopY + b * blockH, cw, blockH);
      idx++;
    }
    if (idx < metals.length) {
      doc.addPage(); doc.x = MARGIN; doc.y = MARGIN;
      pageTopY = MARGIN;   // 續頁無標題,整頁平分 3 塊
    }
  }
  doc.y = pageBottom(doc);
}

// ── markdown 報告本文渲染 ─────────────────────────────────────────────────────
const SECTION_KEYWORDS = /(市場主軸|漲跌幅統計|漲跌統計|重大事件|下週展望|下周展望|採購策略|策略建議|走勢)/;

function parseMetalRow(cells, idx) {
  const nameRaw = stripInline(cells[idx.name] || '');
  // 半形 () 與全形 （）括號都吃(繁中 LLM 常吐全形)
  const codeM = /[\(（]\s*([A-Za-z]{2,3})\s*[\)）]/.exec(nameRaw);
  let code = codeM ? codeM[1].toUpperCase() : '';
  // fallback:沒抓到括號代碼 → 用中文名對 ALL_METALS,避免整列被 filter 丟掉
  if (!code) {
    const hit = ALL_METALS.find(m => m.zh && nameRaw.includes(m.zh));
    if (hit) code = hit.code;
  }
  // 顯示名:有括號 → 標準化為第二字小寫;無括號但有 code → 補上
  const name = code
    ? (codeM
        ? nameRaw.replace(/[\(（]\s*[A-Za-z]{2,3}\s*[\)）]/, `(${metalDisplay(code)})`)
        : `${nameRaw} (${metalDisplay(code)})`)
    : nameRaw;
  const changeStr = stripInline(cells[idx.change] || '');
  const changeNum = parseFloat(changeStr.replace(/[^0-9.\-]/g, ''));
  return {
    code,
    name,
    prev: stripInline(cells[idx.prev] || '—') || '—',
    last: stripInline(cells[idx.last] || '—') || '—',
    change: changeStr || '—',
    changeNum,
    driver: stripInline(cells[idx.driver] || '—') || '—',
  };
}

function renderTableBlock(doc, tableLines) {
  const parse = (ln) => ln.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const header = parse(tableLines[0]);
  const dataRows = tableLines.slice(1).filter(l => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l)).map(parse);

  // 是否為「11 金屬漲跌表」
  const findIdx = (kw) => header.findIndex(h => kw.test(h));
  const idx = {
    name:   findIdx(/品種|金屬/) >= 0 ? header.findIndex(h => /品種|金屬/.test(h) && !/燈號/.test(h)) : -1,
    prev:   findIdx(/上週|上周|前值/),
    last:   findIdx(/本週|本周|最新/),
    change: findIdx(/漲跌/),
    driver: findIdx(/驅動|現況|因素|說明/),
  };
  const isMetalTable = idx.name >= 0 && idx.change >= 0;

  if (isMetalTable) {
    const parsed = dataRows.map(c => parseMetalRow(c, idx)).filter(r => r.code);
    // 防呆:全部列都認不出代碼 → 不讓表整個消失,退回一般格線表照原樣畫
    if (parsed.length === 0 && dataRows.length > 0) {
      console.warn('[pmWeeklyPdf] 漲跌表無法解析任何金屬代碼,退回一般表格渲染');
      drawGenericTable(doc, header, dataRows);
      return;
    }
    const baseRows = parsed.filter(r => !isPrecious(r.code));
    const precRows = parsed.filter(r => isPrecious(r.code));
    if (baseRows.length) {
      drawSubTitle(doc, '(一)基本金屬');
      drawMetalTable(doc, 'USD/Ton', baseRows);
    }
    if (precRows.length) {
      drawSubTitle(doc, '(二)貴金屬');
      drawMetalTable(doc, 'USD/Troy Oz', precRows);
    }
    return;
  }

  // 一般表格 → 簡易格線
  drawGenericTable(doc, header, dataRows);
}

function drawGenericTable(doc, header, rows) {
  const cw = contentWidth(doc);
  const cols = header.length || 1;
  const colW = cw / cols;
  doc.font(FONT).fontSize(8.5);
  let y = doc.y;
  const drawRow = (cells, fill, bold, isHeader) => {
    const hs = cells.map(c => doc.heightOfString(stripInline(c), { width: colW - 8 }));
    const rowH = Math.max(18, Math.max(...hs) + 8);
    // 資料列跨頁 → 新頁先重畫表頭再畫本列(表頭自身不觸發,避免無限遞迴)
    if (!isHeader && y + rowH > pageBottom(doc)) { doc.addPage(); y = MARGIN; drawRow(header, C.orange, true, true); }
    for (let i = 0; i < cols; i++) {
      const cx = MARGIN + i * colW;
      if (fill) doc.rect(cx, y, colW, rowH).fill(fill);
      doc.rect(cx, y, colW, rowH).lineWidth(0.5).strokeColor(C.line).stroke();
      doc.fillColor(fill ? '#FFFFFF' : C.text);
      doc.text(stripInline(cells[i] || ''), cx + 4, y + 4, { width: colW - 8 });
      if (bold) doc.text(stripInline(cells[i] || ''), cx + 4.35, y + 4, { width: colW - 8 });
    }
    y += rowH;
  };
  ensureSpace(doc, 40);
  y = doc.y;
  drawRow(header, C.orange, true, true);
  for (const r of rows) drawRow(r, null, false, false);
  doc.y = y + 6;
  doc.x = MARGIN;
}

function renderReportBody(doc, md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length) {
    let raw = lines[i];
    const line = raw.trim();

    // 跳過 ```json ... ``` 落地段與任何 code fence
    if (/^```/.test(line)) {
      const fenceLang = line.replace(/^```/, '').toLowerCase();
      i++;
      const inner = [];
      while (i < lines.length && !/^```/.test(lines[i].trim())) { inner.push(lines[i]); i++; }
      i++; // 收 fence
      // 若 fence 內其實是 markdown 表格(LLM 有時把表格包 fence),照表格渲染
      if (!/json/.test(fenceLang) && inner.some(l => /^\s*\|.*\|/.test(l))) {
        const tbl = inner.filter(l => /^\s*\|.*\|/.test(l));
        if (tbl.length >= 2) renderTableBlock(doc, tbl);
      }
      continue;
    }

    if (!line) { doc.y += 4; i++; continue; }

    // markdown 表格區塊
    if (/^\|.*\|/.test(line)) {
      const tbl = [];
      while (i < lines.length && /^\s*\|.*\|/.test(lines[i].trim())) { tbl.push(lines[i].trim()); i++; }
      if (tbl.length >= 2) renderTableBlock(doc, tbl);
      continue;
    }

    // 標題:# / ## / ### 或編號段 或 **section**
    const hMatch = /^#{1,6}\s+(.*)$/.exec(line);
    const numMatch = /^(\d+)[.)、]\s*(.+)$/.exec(line);
    const boldOnly = /^\*\*(.+)\*\*$/.exec(line);
    // boldOnly 只在「短」的情況才當標題;整句 **強調文字** 走段落(drawParagraph 會換行)
    const headingText = hMatch ? hMatch[1]
      : (boldOnly && stripInline(boldOnly[1]).length <= 24 ? boldOnly[1]
      : (numMatch && SECTION_KEYWORDS.test(numMatch[2]) && numMatch[2].length <= 20 ? numMatch[2] : null));
    if (headingText != null) {
      const t = stripInline(headingText);
      if (SECTION_KEYWORDS.test(t) || (hMatch && /^#{1,2}\s/.test(line))) drawSectionTitle(doc, t);
      else drawSubTitle(doc, t);
      i++;
      continue;
    }

    // bullet
    if (/^[-*•]\s+/.test(line)) {
      drawBullet(doc, stripInline(line.replace(/^[-*•]\s+/, '')));
      i++;
      continue;
    }
    // 編號清單(非 section)
    if (numMatch) {
      drawBullet(doc, `${numMatch[1]}. ${stripInline(numMatch[2])}`);
      i++;
      continue;
    }

    // 一般段落
    drawParagraph(doc, stripInline(line));
    i++;
  }
}

// ── 解析 aiOutput:取 report markdown + as_of_date ──────────────────────────────
function extractReport(aiOutput, asOfHint) {
  let md = String(aiOutput || '');
  let asOf = asOfHint || null;
  // 嘗試從 ```json``` 落地段拿 full_content / as_of_date
  const jm = /```json\s*([\s\S]*?)```/i.exec(md);
  if (jm) {
    try {
      const obj = JSON.parse(jm[1]);
      if (obj && typeof obj.full_content === 'string' && obj.full_content.trim().length > 40) {
        md = obj.full_content;
      } else {
        md = md.slice(0, jm.index); // 拿掉 JSON 落地段,留上方報告
      }
      if (!asOf && obj && obj.as_of_date) asOf = String(obj.as_of_date).slice(0, 10);
    } catch (_) {
      md = md.slice(0, jm.index);
    }
  }
  if (!asOf) {
    const dm = /(\d{4}-\d{2}-\d{2})/.exec(md);
    asOf = dm ? dm[1] : new Date().toISOString().slice(0, 10);
  }
  return { md: md.trim(), asOf };
}

// ── 月均價 / 月漲跌幅 markdown 表格(給 docx 附加用;數字全 SQL 算)──────────────
function lastNMonths(asOf, n) {
  const m = /^(\d{4})-(\d{2})/.exec(String(asOf || ''));
  let y = m ? +m[1] : new Date().getFullYear();
  let mo = m ? +m[2] : new Date().getMonth() + 1;
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    let yy = y, mm = mo - k;
    while (mm <= 0) { mm += 12; yy--; }
    out.push(`${yy}-${String(mm).padStart(2, '0')}`);
  }
  return out;
}

async function buildMonthlyTablesMarkdown(db, asOf) {
  const months = lastNMonths(asOf, 6);
  const ymHead = months.map(ym => ym.replace('-', '/'));   // 2026-03 → 2026/03
  // 表頭依使用者附圖:第一欄 Year/Month,列 Monthly Avg. Price / Change(%)
  const headRow = `| Year/Month | ${ymHead.join(' | ')} |`;
  const sepRow = `| :--- | ${months.map(() => '---:').join(' | ')} |`;

  // 先撈全部金屬的月資料
  const data = {};
  for (const m of ALL_METALS) {
    const series = await getMonthlySeries(db, m.code, asOf);
    data[m.code] = new Map(series.map(s => [s.ym, s]));
  }

  // 每金屬一張 3 列表(Y/M / MAP / Change(%)),對齊附圖格式
  const metalTables = (metals) => metals.flatMap(m => {
    const map = data[m.code];
    const mapRow = months.map(ym => {
      const s = map.get(ym);
      return s && Number.isFinite(s.avg) ? fmtPrice(s.avg) : '—';
    });
    const chgRow = months.map(ym => {
      const s = map.get(ym);
      return s && s.chg != null ? fmtPct(s.chg) : '—';
    });
    return [
      `**${m.zh}(${metalDisplay(m.code)})— ${unitOf(m.code)}**`,
      '',
      headRow,
      sepRow,
      `| Monthly Avg. Price | ${mapRow.join(' | ')} |`,
      `| Change(%) | ${chgRow.join(' | ')} |`,
      '',
    ];
  });

  return [
    '## 各金屬近 6 個月 MAP(月均價)與 Change(%)',
    '',
    '> Y/M=年月;MAP=各月日均價;Change(%)=相鄰月漲跌幅。數字由 PM 價格庫 SQL 統計,供重新出資料 / 追溯用。',
    '',
    '### 基本金屬(USD/Ton)',
    '',
    ...metalTables(BASE_METALS),
    '### 貴金屬(USD/Troy Oz)',
    '',
    ...metalTables(PRECIOUS_METALS),
  ].join('\n');
}

// ── 主入口 ───────────────────────────────────────────────────────────────────
async function buildWeeklyPdf({ db, aiOutput, filename, asOfDate, context }) {
  const { md, asOf } = extractReport(aiOutput, asOfDate);

  const UPLOAD_DIR = process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(__dirname, '../uploads');
  const outDir = path.join(UPLOAD_DIR, 'generated');
  fs.mkdirSync(outDir, { recursive: true });
  const safeName = String(filename || `金屬市場週報_${asOf}.pdf`).replace(/[\\/:*?"<>|]/g, '_');
  const filePath = path.join(outDir, safeName);

  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  // 只挑 glyf 字型:避開 CID-CFF(Noto CJK .otf)造成 PDF 複製貼上變 PUA 亂碼(見 cjkFont.js)
  const fontPath = resolveCjkFontPath();
  if (fontPath) doc.registerFont(FONT, fontPath);
  else doc.registerFont(FONT, 'Helvetica');

  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // 首頁標題橫幅
  drawHeaderBanner(doc, { asOfDate: asOf });

  // 報告本文(市場主軸 / 漲跌表 / 重大事件 / 下週展望 / 採購策略)
  renderReportBody(doc, md);

  // 新增段落:各金屬近 6 個月走勢圖 + 月表(Y/M / MAP / Change(%))。
  // 與報告本文(前兩頁)分開,自第 3 頁起;基本金屬、貴金屬各縮排成 2 頁(3 金屬/頁),避免頁數過多。
  await drawMetalGroupGrid(
    doc, db, BASE_METALS, asOf,
    '基本金屬 — 近 6 個月走勢與 Monthly Avg. Price / 漲跌幅',
    'USD/Ton｜Change = 相鄰月漲跌幅',
  );
  await drawMetalGroupGrid(
    doc, db, PRECIOUS_METALS, asOf,
    '貴金屬 — 近 6 個月走勢與 Monthly Avg. Price / 漲跌幅',
    'USD/Troy Oz｜Change = 相鄰月漲跌幅',
  );

  // 頁尾(所有頁)
  const range = doc.bufferedPageRange();
  for (let p = 0; p < range.count; p++) {
    doc.switchToPage(range.start + p);
    doc.fillColor(C.muted).font(FONT).fontSize(8);
    const txt = 'Foxlink Confidential';
    const tw = doc.widthOfString(txt);
    // features:[] 關掉 OpenType 連字(fi),避免 PDF 文字層抽取掉字
    doc.text(txt, (doc.page.width - tw) / 2, doc.page.height - 30, { lineBreak: false, features: [] });
  }

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  const publicUrl = `/uploads/generated/${path.basename(filePath)}`;
  console.log(`[pmWeeklyPdf] generated ${publicUrl} (as_of=${asOf})`);
  return { filename: safeName, publicUrl, filePath };
}

module.exports = { buildWeeklyPdf, getMonthlySeries, getDailySeries, buildMonthlyTablesMarkdown, extractReport };
