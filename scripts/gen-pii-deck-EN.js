/* EN exec-level PII protection deck — blue corporate, line-art (vector) icons. <=8 slides. */
const path = require('path');
const pptxgen = require(path.join(__dirname, '../server/node_modules/pptxgenjs'));

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'FOXLINK GPT (CORTEX)';
pptx.title = 'CORTEX — Personal Data (PII) Protection Statement';

const NAVY = '13365C', BLUE = '2E6CA8', SKY = '4A90D9';
const LIGHT = 'EAF1F9', LIGHT2 = 'F4F8FC', LINE = 'CBDBEC';
const DARK = '2B2B2B', GRAY = '63707E', WHITE = 'FFFFFF';
const F = 'Segoe UI';
const S = pptx.ShapeType;
const T = 0.026, LW = 2;

/* ---- line-art primitives ---- */
const elps = (s, x, y, w, h, c, w2) => s.addShape(S.ellipse, { x, y, w, h, fill: { type: 'none' }, line: { color: c, width: w2 || LW } });
const rect = (s, x, y, w, h, c, w2) => s.addShape(S.rect, { x, y, w, h, fill: { type: 'none' }, line: { color: c, width: w2 || LW } });
const rrect = (s, x, y, w, h, c, r, w2) => s.addShape(S.roundRect, { x, y, w, h, fill: { type: 'none' }, line: { color: c, width: w2 || LW }, rectRadius: r || 0.04 });
const hbar = (s, x, y, w, c) => s.addShape(S.rect, { x, y, w, h: T, fill: { color: c }, line: { type: 'none' } });
const vbar = (s, x, y, h, c) => s.addShape(S.rect, { x, y, w: T, h, fill: { color: c }, line: { type: 'none' } });
const diag = (s, x, y, w, h, c, flipV) => s.addShape(S.line, { x, y, w, h, line: { color: c, width: LW }, flipV: !!flipV });
const mask = (s, x, y, w, h, bg) => s.addShape(S.rect, { x, y, w, h, fill: { color: bg }, line: { type: 'none' } });
function check(s, vx, vy, c) { diag(s, vx - 0.07, vy - 0.07, 0.07, 0.07, c, false); diag(s, vx, vy - 0.17, 0.18, 0.17, c, true); }

function icoDoc(s, x, y, sz, c) {
  const w = sz * 0.62, h = sz * 0.82, px = x + (sz - w) / 2, py = y + (sz - h) / 2;
  rect(s, px, py, w, h, c);
  hbar(s, px + w * 0.18, py + h * 0.3, w * 0.64, c); hbar(s, px + w * 0.18, py + h * 0.5, w * 0.64, c); hbar(s, px + w * 0.18, py + h * 0.7, w * 0.45, c);
}
function icoSearch(s, x, y, sz, c) { const d = sz * 0.58; elps(s, x + sz * 0.06, y + sz * 0.06, d, d, c); diag(s, x + sz * 0.52, y + sz * 0.52, sz * 0.36, sz * 0.36, c); }
function icoLock(s, x, y, sz, c, bg) {
  const bw = sz * 0.6, bh = sz * 0.46, bx = x + (sz - bw) / 2, by = y + sz * 0.44;
  const shw = bw * 0.62, shx = x + (sz - shw) / 2, shy = by - bh * 0.62, shh = bh * 0.95;
  elps(s, shx, shy, shw, shh, c); mask(s, shx - 0.03, by, shw + 0.06, bh * 0.6, bg);
  rrect(s, bx, by, bw, bh, c, 0.04);
  s.addShape(S.ellipse, { x: bx + bw / 2 - 0.035, y: by + bh * 0.3, w: 0.07, h: 0.07, fill: { color: c }, line: { type: 'none' } });
}
function icoGlobe(s, x, y, sz, c) { const d = sz * 0.66, gx = x + (sz - d) / 2, gy = y + (sz - d) / 2; elps(s, gx, gy, d, d, c); elps(s, gx + d * 0.3, gy, d * 0.4, d, c, 1.4); hbar(s, gx, gy + d / 2 - T / 2, d, c); }
function icoPerson(s, x, y, sz, c, bg) {
  const hd = sz * 0.3, hx = x + (sz - hd) / 2, hy = y + sz * 0.1; elps(s, hx, hy, hd, hd, c);
  const sw = sz * 0.62, sx = x + (sz - sw) / 2, sy = y + sz * 0.46, sh = sz * 0.52; elps(s, sx, sy, sw, sh, c);
  mask(s, sx - 0.03, sy + sh * 0.5, sw + 0.06, sh * 0.62, bg);
}
function icoCompass(s, x, y, sz, c) { const d = sz * 0.72, gx = x + (sz - d) / 2, gy = y + (sz - d) / 2; elps(s, gx, gy, d, d, c); diag(s, gx + d * 0.36, gy + d * 0.28, d * 0.16, d * 0.36, c, true); diag(s, gx + d * 0.5, gy + d * 0.36, d * 0.18, d * 0.34, c, false); }
function icoNo(s, x, y, sz, c) { const d = sz * 0.72, gx = x + (sz - d) / 2, gy = y + (sz - d) / 2; elps(s, gx, gy, d, d, c); diag(s, gx + d * 0.15, gy + d * 0.15, d * 0.7, d * 0.7, c); }
function icoFunnel(s, x, y, sz, c) { const w = sz * 0.66, gx = x + (sz - w) / 2, gy = y + sz * 0.16; s.addShape(S.trapezoid, { x: gx, y: gy, w, h: sz * 0.34, fill: { type: 'none' }, line: { color: c, width: LW }, flipV: true }); vbar(s, x + sz / 2 - T / 2, gy + sz * 0.34, sz * 0.3, c); }
function icoKey(s, x, y, sz, c) { const d = sz * 0.36; elps(s, x + sz * 0.06, y + sz * 0.32, d, d, c); const sy = x + sz * 0.06 + d, my = y + sz * 0.32 + d / 2 - T / 2; hbar(s, sy, my, sz * 0.5, c); vbar(s, sy + sz * 0.34, my, sz * 0.12, c); vbar(s, sy + sz * 0.46, my, sz * 0.18, c); }
function icoTrash(s, x, y, sz, c) {
  const w = sz * 0.5, gx = x + (sz - w) / 2, gy = y + sz * 0.34;
  hbar(s, gx - sz * 0.07, gy - 0.05, w + sz * 0.14, c); hbar(s, gx + w * 0.3, gy - sz * 0.13, w * 0.4, c);
  s.addShape(S.trapezoid, { x: gx, y: gy, w, h: sz * 0.5, fill: { type: 'none' }, line: { color: c, width: LW } });
  vbar(s, gx + w * 0.32, gy + sz * 0.08, sz * 0.3, c); vbar(s, gx + w * 0.6, gy + sz * 0.08, sz * 0.3, c);
}
function icoLog(s, x, y, sz, c) { const w = sz * 0.58, gx = x + (sz - w) / 2, gy = y + sz * 0.22; hbar(s, gx, gy, w * 0.9, c); hbar(s, gx, gy + sz * 0.22, w * 0.9, c); hbar(s, gx, gy + sz * 0.44, w * 0.6, c); check(s, gx + w * 0.55, gy + sz * 0.62, c); }
function icoClip(s, x, y, sz, c) {
  const w = sz * 0.6, h = sz * 0.78, px = x + (sz - w) / 2, py = y + (sz - h) / 2 + 0.03;
  rrect(s, px, py, w, h, c, 0.05);
  s.addShape(S.roundRect, { x: px + w * 0.3, y: py - 0.06, w: w * 0.4, h: 0.12, fill: { type: 'none' }, line: { color: c, width: 1.4 }, rectRadius: 0.03 });
  check(s, px + w * 0.42, py + h * 0.62, c); hbar(s, px + w * 0.18, py + h * 0.32, w * 0.64, c);
}
function icoShieldBig(s, x, y, sz, c) {
  const d = sz; elps(s, x, y, d, d, c, 6);
  s.addShape(S.line, { x: x + d * 0.28, y: y + d * 0.5, w: d * 0.13, h: d * 0.13, line: { color: c, width: 6 }, flipV: false });
  s.addShape(S.line, { x: x + d * 0.41, y: y + d * 0.4, w: d * 0.32, h: d * 0.32, line: { color: c, width: 6 }, flipV: true });
}

/* ---- chrome ---- */
function footer(s, num) {
  s.addText('CORTEX Personal Data Protection  ·  Foxlink AI Integration Platform', { x: 0.5, y: 7.06, w: 10, h: 0.3, color: GRAY, fontSize: 9.5, fontFace: F });
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
    out.push({ text: '▪  ', options: { color: SKY, bold: true, fontSize: 16.5, fontFace: F } });
    out.push({ text: it, options: { color: DARK, fontSize: 16.5, fontFace: F, breakLine: true, paraSpaceAfter: 11 } });
  });
  return out;
}
function section(num, drawIcon, title, concern, bullets) {
  const s = pptx.addSlide(); s.background = { color: WHITE };
  header(s, drawIcon, title);
  s.addShape(S.roundRect, { x: 0.55, y: 1.35, w: 12.25, h: 0.82, fill: { color: LIGHT }, line: { color: LINE, width: 1 }, rectRadius: 0.05 });
  s.addShape(S.rect, { x: 0.55, y: 1.35, w: 0.1, h: 0.82, fill: { color: SKY } });
  s.addText([
    { text: 'Customer concern   ', options: { color: BLUE, bold: true, fontSize: 14.5, fontFace: F } },
    { text: concern, options: { color: GRAY, italic: true, fontSize: 14.5, fontFace: F } },
  ], { x: 0.82, y: 1.35, w: 11.85, h: 0.82, valign: 'middle', fontFace: F });
  s.addText('Our approach', { x: 0.6, y: 2.42, w: 6, h: 0.45, color: NAVY, bold: true, fontSize: 19, fontFace: F });
  s.addText(bulletObjs(bullets), { x: 0.65, y: 2.98, w: 12.15, h: 3.95, valign: 'top', fontFace: F, lineSpacingMultiple: 1.05 });
  footer(s, num);
  return s;
}

/* ---------- Slide 1 — Title ---------- */
(() => {
  const s = pptx.addSlide(); s.background = { color: NAVY };
  s.addShape(S.rect, { x: 0, y: 0, w: 0.35, h: '100%', fill: { color: SKY } });
  icoShieldBig(s, 9.9, 1.0, 2.7, '24466F');
  s.addText('CORTEX', { x: 0.95, y: 1.55, w: 9, h: 1.0, color: WHITE, bold: true, fontSize: 54, fontFace: F, charSpacing: 3 });
  s.addText('Personal Data (PII) Protection Statement', { x: 0.95, y: 2.65, w: 11.2, h: 0.85, color: WHITE, fontSize: 28, fontFace: F });
  s.addShape(S.rect, { x: 1.0, y: 3.7, w: 3.8, h: 0.06, fill: { color: SKY } });
  s.addText('In response to customer security audit  ·  Personal-data (PII) scope', { x: 0.97, y: 3.9, w: 11.5, h: 0.5, color: 'BBD2EC', fontSize: 17, fontFace: F });
  s.addText('Foxlink AI Integration Platform  ·  2026-06-11', { x: 0.97, y: 6.45, w: 11, h: 0.4, color: '7FA0C4', fontSize: 12.5, fontFace: F });
})();

/* ---------- Slide 2 — Framing ---------- */
(() => {
  const s = pptx.addSlide(); s.background = { color: WHITE };
  header(s, icoCompass, 'What CORTEX Is — and What Personal Data It Touches');
  s.addShape(S.roundRect, { x: 0.55, y: 1.4, w: 12.25, h: 1.2, fill: { color: LIGHT }, line: { color: LINE, width: 1 }, rectRadius: 0.06 });
  s.addText(
    'CORTEX is an AI workplace platform used by Foxlink’s own employees to handle internal business data\n(orders, procurement, BOM, production information).  It is not a system that collects consumer personal data.',
    { x: 0.85, y: 1.4, w: 11.7, h: 1.2, color: NAVY, bold: true, fontSize: 16, valign: 'middle', fontFace: F, lineSpacingMultiple: 1.12 });
  const cards = [
    [icoNo, 'No tracking, no selling', 'No advertising trackers; personal data is never sold or shared with outside parties.'],
    [icoPerson, 'Only two kinds of personal data', '① Employee identity (ID / email / department) — used for access control   ② Personal data that may appear inside business documents.'],
  ];
  let y = 2.9; const h = 1.32;
  cards.forEach(([draw, t, d]) => {
    s.addShape(S.roundRect, { x: 0.55, y, w: 12.25, h, fill: { color: LIGHT2 }, line: { color: LINE, width: 1 }, rectRadius: 0.06 });
    s.addShape(S.ellipse, { x: 0.85, y: y + 0.31, w: 0.7, h: 0.7, fill: { color: NAVY } });
    draw(s, 0.99, y + 0.45, 0.42, SKY, NAVY);
    s.addText(t, { x: 1.85, y: y + 0.2, w: 10.7, h: 0.5, color: NAVY, bold: true, fontSize: 18, fontFace: F });
    s.addText(d, { x: 1.85, y: y + 0.7, w: 10.7, h: 0.55, color: DARK, fontSize: 15, fontFace: F });
    y += h + 0.16;
  });
  s.addText('➜  Its personal-data risk surface is far smaller than a consumer data-collection system.', { x: 0.55, y: 6.55, w: 12.25, h: 0.4, color: BLUE, bold: true, fontSize: 15.5, align: 'center', fontFace: F });
  footer(s, 2);
})();

/* ---------- Slides 3–7 ---------- */
section(3, icoDoc, '1. Legal & Regulatory', 'GDPR / CCPA alignment, consent, and cross-border transfer.', [
  'Processes internal business data for legitimate work purposes only — no external collection or marketing use.',
  'Designed around core privacy principles: minimal collection, purpose limitation, defined retention, and deletion on request.',
  'Cross-border: AI runs on enterprise-grade Google / Microsoft clouds under contracts that exclude using data to train AI; data-residency region can be assessed per customer requirement.',
]);
section(4, icoSearch, '2. Data Collection', 'Over-collection, unclear purpose, sensitive categories, covert tracking.', [
  'Collects only the minimum data needed for operations and access control; employee identity comes from existing HR / account systems, not gathered anew.',
  'Does not collect special categories such as health, biometric, or race / ethnicity data.',
  'No covert tracking — activity logs exist solely for security and traceability, as a transparent internal control.',
]);
section(5, icoLock, '3. Storage & Security', 'Encryption, who can access, retention length, breach response.', [
  'Strict access control: each user sees only authorized data; business units are isolated from one another; confidential content is hidden even from system administrators.',
  'All transmission is encrypted; system keys and credentials are stored in encrypted form.',
  'Data carries retention limits and is auto-purged (general records ~90 days, sensitive-flagged records 1 year, temporary outputs ~7 days).',
  'Full audit trail, centralized logging and health monitoring — anomalies are alerted to administrators in real time.',
]);
section(6, icoGlobe, '4. Third Parties & Data Flow', 'Sharing with third parties, flow transparency, re-identification risk.', [
  'Data is never sold or shared externally; the only outside services that touch data are the cloud AI providers (Google / Microsoft), all under enterprise contracts.',
  'Data flows are clearly documented — a data-flow diagram can be provided for audit.',
  'We do not rely on “anonymize-then-share” practices, so there is no re-identification risk.',
]);
section(7, icoPerson, '5. Data-Subject Rights', 'Whether individuals can access, correct, or delete their data.', [
  'Accounts and their data are centrally managed; on departure or request, an account can be disabled and all of its sessions revoked immediately.',
  'Data is auto-deleted at end of retention, and specific data can be deleted on legitimate request.',
  'Each person’s accessible scope adjusts with their role and takes effect immediately.',
]);

/* ---------- Slide 8 — Summary ---------- */
(() => {
  const s = pptx.addSlide(); s.background = { color: WHITE };
  header(s, icoClip, 'Summary: Four Principles');
  const chips = [[icoFunnel, 'Collect minimally'], [icoKey, 'Strict access'], [icoTrash, 'Purge regularly'], [icoLog, 'Full audit trail']];
  const cw = 2.92, gap = 0.18; let x = 0.6;
  chips.forEach(([draw, t]) => {
    s.addShape(S.roundRect, { x, y: 1.35, w: cw, h: 1.0, fill: { color: NAVY }, rectRadius: 0.06 });
    s.addShape(S.ellipse, { x: x + 0.2, y: 1.5, w: 0.7, h: 0.7, fill: { type: 'none' }, line: { color: SKY, width: 1 } });
    draw(s, x + 0.34, 1.64, 0.42, SKY);
    s.addText(t, { x: x + 1.0, y: 1.35, w: cw - 1.1, h: 1.0, color: WHITE, bold: true, fontSize: 15.5, valign: 'middle', fontFace: F });
    x += cw + gap;
  });
  const cell = (t, opts) => ({ text: t, options: Object.assign({ fontFace: F, fontSize: 14.5, valign: 'middle', margin: [5, 8, 5, 8] }, opts) });
  const rows = [
    [cell('Customer concern', { color: WHITE, bold: true, fill: NAVY, fontSize: 14.5 }), cell('CORTEX’s answer (in one line)', { color: WHITE, bold: true, fill: NAVY, fontSize: 14.5 })],
    [cell('Collecting too much data?', { color: NAVY, bold: true, fill: LIGHT }), cell('Only the minimum needed for operations & access — no sensitive categories', { color: DARK })],
    [cell('Is the data secure?', { color: NAVY, bold: true, fill: LIGHT2 }), cell('Strict access control + encrypted transit + confidential content hidden even from admins', { color: DARK })],
    [cell('Kept too long?', { color: NAVY, bold: true, fill: LIGHT }), cell('Everything has a retention limit and is auto-purged', { color: DARK })],
    [cell('Leaked to third parties?', { color: NAVY, bold: true, fill: LIGHT2 }), cell('Never sold or shared; only cloud providers under enterprise contracts', { color: DARK })],
    [cell('Can individuals manage their data?', { color: NAVY, bold: true, fill: LIGHT }), cell('Can be disabled and deleted; access adjusts with role in real time', { color: DARK })],
  ];
  s.addTable(rows, { x: 0.6, y: 2.65, w: 12.15, colW: [3.9, 8.25], border: { type: 'solid', color: LINE, pt: 1 }, rowH: 0.54, valign: 'middle', fontFace: F });
  s.addText('Given a formal audit questionnaire, we can map each item point-by-point with supporting evidence.', { x: 0.6, y: 6.55, w: 12.15, h: 0.4, color: BLUE, italic: true, bold: true, fontSize: 14, align: 'center', fontFace: F });
  footer(s, 8);
})();

const OUT = path.join(__dirname, '../docs/CORTEX-PII-Protection-EN.pptx');
pptx.writeFile({ fileName: OUT }).then((f) => console.log('WROTE', f));
