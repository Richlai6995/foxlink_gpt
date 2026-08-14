/* TW exec-level PII protection deck — blue corporate, line-art (vector) icons, larger fonts. <=8 slides. */
const path = require('path');
const pptxgen = require(path.join(__dirname, '../server/node_modules/pptxgenjs'));

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'FOXLINK GPT (CORTEX)';
pptx.title = 'CORTEX 個人資料保護說明';

const NAVY = '13365C', BLUE = '2E6CA8', SKY = '4A90D9';
const LIGHT = 'EAF1F9', LIGHT2 = 'F4F8FC', LINE = 'CBDBEC';
const DARK = '2B2B2B', GRAY = '63707E', WHITE = 'FFFFFF';
const F = 'Microsoft JhengHei';
const S = pptx.ShapeType;
const T = 0.026;   // stroke thickness (in)
const LW = 2;      // outline width (pt)

/* ---- line-art primitives (stroke only) ---- */
const elps = (s, x, y, w, h, c, w2) => s.addShape(S.ellipse, { x, y, w, h, fill: { type: 'none' }, line: { color: c, width: w2 || LW } });
const rect = (s, x, y, w, h, c, w2) => s.addShape(S.rect, { x, y, w, h, fill: { type: 'none' }, line: { color: c, width: w2 || LW } });
const rrect = (s, x, y, w, h, c, r, w2) => s.addShape(S.roundRect, { x, y, w, h, fill: { type: 'none' }, line: { color: c, width: w2 || LW }, rectRadius: r || 0.04 });
const hbar = (s, x, y, w, c) => s.addShape(S.rect, { x, y, w, h: T, fill: { color: c }, line: { type: 'none' } });
const vbar = (s, x, y, h, c) => s.addShape(S.rect, { x, y, w: T, h, fill: { color: c }, line: { type: 'none' } });
const diag = (s, x, y, w, h, c, flipV) => s.addShape(S.line, { x, y, w, h, line: { color: c, width: LW }, flipV: !!flipV });
const mask = (s, x, y, w, h, bg) => s.addShape(S.rect, { x, y, w, h, fill: { color: bg }, line: { type: 'none' } });
function check(s, vx, vy, c) { diag(s, vx - 0.07, vy - 0.07, 0.07, 0.07, c, false); diag(s, vx, vy - 0.17, 0.18, 0.17, c, true); }

/* ---- icons: draw inside box (x,y,sz) with stroke color c; bg = surrounding fill for masking ---- */
function icoDoc(s, x, y, sz, c) {       // 法規 / 規範文件
  const w = sz * 0.62, h = sz * 0.82, px = x + (sz - w) / 2, py = y + (sz - h) / 2;
  rect(s, px, py, w, h, c);
  hbar(s, px + w * 0.18, py + h * 0.3, w * 0.64, c);
  hbar(s, px + w * 0.18, py + h * 0.5, w * 0.64, c);
  hbar(s, px + w * 0.18, py + h * 0.7, w * 0.45, c);
}
function icoSearch(s, x, y, sz, c) {     // 蒐集 / 放大鏡
  const d = sz * 0.58; elps(s, x + sz * 0.06, y + sz * 0.06, d, d, c);
  diag(s, x + sz * 0.52, y + sz * 0.52, sz * 0.36, sz * 0.36, c);
}
function icoLock(s, x, y, sz, c, bg) {   // 儲存安全 / 鎖
  const bw = sz * 0.6, bh = sz * 0.46, bx = x + (sz - bw) / 2, by = y + sz * 0.44;
  const shw = bw * 0.62, shx = x + (sz - shw) / 2, shy = by - bh * 0.62, shh = bh * 0.95;
  elps(s, shx, shy, shw, shh, c);
  mask(s, shx - 0.03, by, shw + 0.06, bh * 0.6, bg);
  rrect(s, bx, by, bw, bh, c, 0.04);
  s.addShape(S.ellipse, { x: bx + bw / 2 - 0.035, y: by + bh * 0.3, w: 0.07, h: 0.07, fill: { color: c }, line: { type: 'none' } });
}
function icoGlobe(s, x, y, sz, c) {      // 第三方 / 地球
  const d = sz * 0.66, gx = x + (sz - d) / 2, gy = y + (sz - d) / 2;
  elps(s, gx, gy, d, d, c);
  elps(s, gx + d * 0.3, gy, d * 0.4, d, c, 1.4);
  hbar(s, gx, gy + d / 2 - T / 2, d, c);
}
function icoPerson(s, x, y, sz, c, bg) { // 當事人 / 人
  const hd = sz * 0.3, hx = x + (sz - hd) / 2, hy = y + sz * 0.1;
  elps(s, hx, hy, hd, hd, c);
  const sw = sz * 0.62, sx = x + (sz - sw) / 2, sy = y + sz * 0.46, sh = sz * 0.52;
  elps(s, sx, sy, sw, sh, c);
  mask(s, sx - 0.03, sy + sh * 0.5, sw + 0.06, sh * 0.62, bg);
}
function icoCompass(s, x, y, sz, c) {    // 定調 / 指南針
  const d = sz * 0.72, gx = x + (sz - d) / 2, gy = y + (sz - d) / 2;
  elps(s, gx, gy, d, d, c);
  diag(s, gx + d * 0.36, gy + d * 0.28, d * 0.16, d * 0.36, c, true);
  diag(s, gx + d * 0.5, gy + d * 0.36, d * 0.18, d * 0.34, c, false);
}
function icoNo(s, x, y, sz, c) {         // 不追蹤不販售 / 禁止
  const d = sz * 0.72, gx = x + (sz - d) / 2, gy = y + (sz - d) / 2;
  elps(s, gx, gy, d, d, c); diag(s, gx + d * 0.15, gy + d * 0.15, d * 0.7, d * 0.7, c);
}
function icoFunnel(s, x, y, sz, c) {     // 最少蒐集 / 漏斗
  const w = sz * 0.66, gx = x + (sz - w) / 2, gy = y + sz * 0.16;
  s.addShape(S.trapezoid, { x: gx, y: gy, w, h: sz * 0.34, fill: { type: 'none' }, line: { color: c, width: LW }, flipV: true });
  vbar(s, x + sz / 2 - T / 2, gy + sz * 0.34, sz * 0.3, c);
}
function icoKey(s, x, y, sz, c) {        // 嚴格分權 / 鑰匙
  const d = sz * 0.36; elps(s, x + sz * 0.06, y + sz * 0.32, d, d, c);
  const sy = x + sz * 0.06 + d, my = y + sz * 0.32 + d / 2 - T / 2;
  hbar(s, sy, my, sz * 0.5, c);
  vbar(s, sy + sz * 0.34, my, sz * 0.12, c);
  vbar(s, sy + sz * 0.46, my, sz * 0.18, c);
}
function icoTrash(s, x, y, sz, c) {      // 定期清除 / 垃圾桶
  const w = sz * 0.5, gx = x + (sz - w) / 2, gy = y + sz * 0.34;
  hbar(s, gx - sz * 0.07, gy - 0.05, w + sz * 0.14, c);
  hbar(s, gx + w * 0.3, gy - sz * 0.13, w * 0.4, c);
  s.addShape(S.trapezoid, { x: gx, y: gy, w, h: sz * 0.5, fill: { type: 'none' }, line: { color: c, width: LW } });
  vbar(s, gx + w * 0.32, gy + sz * 0.08, sz * 0.3, c);
  vbar(s, gx + w * 0.6, gy + sz * 0.08, sz * 0.3, c);
}
function icoLog(s, x, y, sz, c) {        // 全程留痕 / 清單+勾
  const w = sz * 0.58, gx = x + (sz - w) / 2, gy = y + sz * 0.22;
  hbar(s, gx, gy, w * 0.9, c); hbar(s, gx, gy + sz * 0.22, w * 0.9, c); hbar(s, gx, gy + sz * 0.44, w * 0.6, c);
  check(s, gx + w * 0.55, gy + sz * 0.62, c);
}
function icoClip(s, x, y, sz, c) {       // 結語 / 板夾
  const w = sz * 0.6, h = sz * 0.78, px = x + (sz - w) / 2, py = y + (sz - h) / 2 + 0.03;
  rrect(s, px, py, w, h, c, 0.05);
  s.addShape(S.roundRect, { x: px + w * 0.3, y: py - 0.06, w: w * 0.4, h: 0.12, fill: { type: 'none' }, line: { color: c, width: 1.4 }, rectRadius: 0.03 });
  check(s, px + w * 0.42, py + h * 0.62, c);
  hbar(s, px + w * 0.18, py + h * 0.32, w * 0.64, c);
}
function icoShieldBig(s, x, y, sz, c) {  // 封面浮水印 / 盾+勾
  const d = sz; elps(s, x, y, d, d, c, 6);
  s.addShape(S.line, { x: x + d * 0.28, y: y + d * 0.5, w: d * 0.13, h: d * 0.13, line: { color: c, width: 6 }, flipV: false });
  s.addShape(S.line, { x: x + d * 0.41, y: y + d * 0.4, w: d * 0.32, h: d * 0.32, line: { color: c, width: 6 }, flipV: true });
}

/* ---- chrome ---- */
function footer(s, num) {
  s.addText('CORTEX 個人資料保護說明　·　正崴 AI 整合平台', { x: 0.5, y: 7.06, w: 9, h: 0.3, color: GRAY, fontSize: 9.5, fontFace: F });
  s.addText(String(num), { x: 12.4, y: 7.06, w: 0.5, h: 0.3, color: GRAY, fontSize: 9.5, align: 'right', fontFace: F });
}
function header(s, drawIcon, title) {
  s.addShape(S.rect, { x: 0, y: 0, w: '100%', h: 1.05, fill: { color: NAVY } });
  s.addShape(S.rect, { x: 0, y: 1.05, w: '100%', h: 0.05, fill: { color: SKY } });
  s.addShape(S.ellipse, { x: 0.45, y: 0.2, w: 0.66, h: 0.66, fill: { color: WHITE } });
  drawIcon(s, 0.61, 0.36, 0.36, BLUE, WHITE);
  s.addText(title, { x: 1.32, y: 0, w: 11.4, h: 1.05, color: WHITE, bold: true, fontSize: 25, valign: 'middle', fontFace: F });
}
function bulletObjs(items) {
  const out = [];
  items.forEach((it) => {
    out.push({ text: '▪  ', options: { color: SKY, bold: true, fontSize: 17, fontFace: F } });
    out.push({ text: it, options: { color: DARK, fontSize: 17, fontFace: F, breakLine: true, paraSpaceAfter: 11 } });
  });
  return out;
}
function section(num, drawIcon, title, concern, bullets) {
  const s = pptx.addSlide(); s.background = { color: WHITE };
  header(s, drawIcon, title);
  s.addShape(S.roundRect, { x: 0.55, y: 1.35, w: 12.25, h: 0.82, fill: { color: LIGHT }, line: { color: LINE, width: 1 }, rectRadius: 0.05 });
  s.addShape(S.rect, { x: 0.55, y: 1.35, w: 0.1, h: 0.82, fill: { color: SKY } });
  s.addText([
    { text: '客戶關注　', options: { color: BLUE, bold: true, fontSize: 15, fontFace: F } },
    { text: concern, options: { color: GRAY, italic: true, fontSize: 15, fontFace: F } },
  ], { x: 0.82, y: 1.35, w: 11.85, h: 0.82, valign: 'middle', fontFace: F });
  s.addText('我們的做法', { x: 0.6, y: 2.42, w: 6, h: 0.45, color: NAVY, bold: true, fontSize: 19, fontFace: F });
  s.addText(bulletObjs(bullets), { x: 0.65, y: 2.98, w: 12.15, h: 3.95, valign: 'top', fontFace: F, lineSpacingMultiple: 1.05 });
  footer(s, num);
  return s;
}

/* ---------- Slide 1 — Title ---------- */
(() => {
  const s = pptx.addSlide(); s.background = { color: NAVY };
  s.addShape(S.rect, { x: 0, y: 0, w: 0.35, h: '100%', fill: { color: SKY } });
  icoShieldBig(s, 9.9, 1.0, 2.7, '24466F');
  s.addText('CORTEX', { x: 0.95, y: 1.65, w: 9, h: 1.0, color: WHITE, bold: true, fontSize: 54, fontFace: F, charSpacing: 3 });
  s.addText('個人資料保護說明', { x: 0.95, y: 2.75, w: 10, h: 0.85, color: WHITE, fontSize: 33, fontFace: F });
  s.addShape(S.rect, { x: 1.0, y: 3.78, w: 3.8, h: 0.06, fill: { color: SKY } });
  s.addText('回應客戶資安稽核　·　個人資料（PII）面向', { x: 0.97, y: 3.98, w: 11, h: 0.5, color: 'BBD2EC', fontSize: 18, fontFace: F });
  s.addText('正崴 AI 整合平台　·　2026-06-11', { x: 0.97, y: 6.45, w: 11, h: 0.4, color: '7FA0C4', fontSize: 12.5, fontFace: F });
})();

/* ---------- Slide 2 — 定調 ---------- */
(() => {
  const s = pptx.addSlide(); s.background = { color: WHITE };
  header(s, icoCompass, 'CORTEX 是什麼？會碰到哪些個資');
  s.addShape(S.roundRect, { x: 0.55, y: 1.4, w: 12.25, h: 1.2, fill: { color: LIGHT }, line: { color: LINE, width: 1 }, rectRadius: 0.06 });
  s.addText(
    'CORTEX 是正崴「內部員工使用」的 AI 工作平台，協助處理公司營運資料（訂單、採購、BOM、生產資訊）。\n它不是對外蒐集消費者個資的系統。',
    { x: 0.85, y: 1.4, w: 11.7, h: 1.2, color: NAVY, bold: true, fontSize: 17, valign: 'middle', fontFace: F, lineSpacingMultiple: 1.12 });
  const cards = [
    [icoNo, '不追蹤、不販售', '沒有廣告追蹤、不販售，也不對外分享任何個人資料。'],
    [icoPerson, '只碰兩類個資', '① 員工身份（工號 / Email / 部門）— 用於權限控管　② 業務文件中可能夾帶的個資。'],
  ];
  let y = 2.9; const h = 1.32;
  cards.forEach(([draw, t, d]) => {
    s.addShape(S.roundRect, { x: 0.55, y, w: 12.25, h, fill: { color: LIGHT2 }, line: { color: LINE, width: 1 }, rectRadius: 0.06 });
    s.addShape(S.ellipse, { x: 0.85, y: y + 0.31, w: 0.7, h: 0.7, fill: { color: NAVY } });
    draw(s, 0.99, y + 0.45, 0.42, SKY, NAVY);
    s.addText(t, { x: 1.85, y: y + 0.2, w: 10.7, h: 0.5, color: NAVY, bold: true, fontSize: 19, fontFace: F });
    s.addText(d, { x: 1.85, y: y + 0.7, w: 10.7, h: 0.55, color: DARK, fontSize: 16, fontFace: F });
    y += h + 0.16;
  });
  s.addText('➜　個資風險面，遠小於一般對外蒐集個資的系統', { x: 0.55, y: 6.55, w: 12.25, h: 0.4, color: BLUE, bold: true, fontSize: 16, align: 'center', fontFace: F });
  footer(s, 2);
})();

/* ---------- Slides 3–7 ---------- */
section(3, icoDoc, '一、法規遵循', '是否符合 GDPR／CCPA、有無取得同意、會不會跨境', [
  '處理的是公司內部營運資料，基於員工執行職務所需使用，不做對外蒐集或行銷。',
  '設計遵循個資保護核心原則：最少蒐集、限定用途、設定保留期限、可依要求刪除。',
  '跨境：AI 運算採 Google／Microsoft 企業級雲端，合約含「不用於訓練 AI」；資料存放區域可依客戶要求評估。',
]);
section(4, icoSearch, '二、蒐集方式', '是否蒐集過多、用途清不清楚、有無敏感個資、會不會暗中追蹤', [
  '只蒐集營運與權限所需的最少資料；員工身份來自公司既有人事／帳號系統，並非額外蒐集。',
  '不蒐集健康、生物特徵、種族等特殊敏感類別個資。',
  '沒有任何暗中追蹤；操作紀錄僅為資安與事後可追溯，屬透明的內部控管措施。',
]);
section(5, icoLock, '三、儲存與安全', '有無加密、誰能存取、會不會留太久、外洩怎麼辦', [
  '嚴格分權：每人只看到被授權的資料，不同事業單位彼此隔離；機密資料連系統管理員都看不到內容。',
  '傳輸全程加密，系統各項金鑰與憑證皆以加密方式保存。',
  '資料設有保留期限、到期自動清除（一般約 90 天、含敏感字保留一年、暫存檔約 7 天）。',
  '具備完整稽核軌跡、集中式日誌與健康監控，發現異常可即時通報管理員。',
]);
section(6, icoGlobe, '四、第三方與資料流向', '會不會給第三方、流向清不清楚、匿名化後會不會被反推', [
  '不對外販售或分享資料；唯一會接觸資料的外部服務，僅限提供 AI 運算的雲端供應商（Google／Microsoft），且均有企業合約。',
  '資料流向清楚，可提供「資料流向說明圖」供稽核檢視。',
  '不採用「匿名化後再對外分享」這類做法，因此沒有被反推回個人身份（再識別）的風險。',
]);
section(7, icoPerson, '五、當事人權利', '個人能否查詢、更正、刪除自己的資料', [
  '帳號與其資料由管理者統一管理；員工離職或提出要求時，可停用帳號並讓其所有登入立即失效。',
  '資料保留到期會自動刪除，亦可依正當請求刪除特定資料。',
  '每個人可存取的資料範圍，會隨職務調整即時生效。',
]);

/* ---------- Slide 8 — 結語 ---------- */
(() => {
  const s = pptx.addSlide(); s.background = { color: WHITE };
  header(s, icoClip, '結語：四個原則');
  const chips = [[icoFunnel, '最少蒐集'], [icoKey, '嚴格分權'], [icoTrash, '定期清除'], [icoLog, '全程留痕']];
  const cw = 2.92, gap = 0.18; let x = 0.6;
  chips.forEach(([draw, t]) => {
    s.addShape(S.roundRect, { x, y: 1.35, w: cw, h: 1.0, fill: { color: NAVY }, rectRadius: 0.06 });
    s.addShape(S.ellipse, { x: x + 0.2, y: 1.5, w: 0.7, h: 0.7, fill: { type: 'none' }, line: { color: SKY, width: 1 } });
    draw(s, x + 0.34, 1.64, 0.42, SKY);
    s.addText(t, { x: x + 1.0, y: 1.35, w: cw - 1.1, h: 1.0, color: WHITE, bold: true, fontSize: 17, valign: 'middle', fontFace: F });
    x += cw + gap;
  });
  const cell = (t, opts) => ({ text: t, options: Object.assign({ fontFace: F, fontSize: 15, valign: 'middle', margin: [5, 8, 5, 8] }, opts) });
  const rows = [
    [cell('客戶疑慮', { color: WHITE, bold: true, fill: NAVY, fontSize: 15 }), cell('CORTEX 的回應（一句話）', { color: WHITE, bold: true, fill: NAVY, fontSize: 15 })],
    [cell('會不會蒐集太多個資', { color: NAVY, bold: true, fill: LIGHT }), cell('只取營運與權限所需的最少資料，不碰敏感類別', { color: DARK })],
    [cell('資料安不安全', { color: NAVY, bold: true, fill: LIGHT2 }), cell('嚴格分權 + 傳輸加密 + 機密內容連管理員都看不到', { color: DARK })],
    [cell('會不會留太久', { color: NAVY, bold: true, fill: LIGHT }), cell('全部設有保留期限，到期自動清除', { color: DARK })],
    [cell('會不會外流給第三方', { color: NAVY, bold: true, fill: LIGHT2 }), cell('不販售、不分享；僅限有企業合約的雲端供應商', { color: DARK })],
    [cell('個人能否管自己的資料', { color: NAVY, bold: true, fill: LIGHT }), cell('可停用、可刪除，權限隨職務即時調整', { color: DARK })],
  ];
  s.addTable(rows, { x: 0.6, y: 2.65, w: 12.15, colW: [3.7, 8.45], border: { type: 'solid', color: LINE, pt: 1 }, rowH: 0.54, valign: 'middle', fontFace: F });
  s.addText('若客戶提供正式稽核問卷，我們可就每一項逐條對應、提供佐證。', { x: 0.6, y: 6.55, w: 12.15, h: 0.4, color: BLUE, italic: true, bold: true, fontSize: 14.5, align: 'center', fontFace: F });
  footer(s, 8);
})();

const OUT = path.join(__dirname, '../docs/CORTEX-PII-Protection-TW.pptx');
pptx.writeFile({ fileName: OUT }).then((f) => console.log('WROTE', f));
