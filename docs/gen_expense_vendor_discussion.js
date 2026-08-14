// 產生「費用性無料號採購 — 自然語言找供應商」初步討論 pptx
// 執行: node docs/gen_expense_vendor_discussion.js

const path = require('path');
const PptxGenJS = require(path.resolve(__dirname, '..', 'server', 'node_modules', 'pptxgenjs'));

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 inch
pptx.title = '費用性無料號採購 — 自然語言找供應商';
pptx.author = 'Cortex 規劃小組';
pptx.company = '正崴';

const C = {
  primary: '1F3A68',
  accent: 'E0A030',
  light: 'F4F6FA',
  gray: '6B7280',
  green: '15803D',
  red: 'B91C1C',
  blue: '2563EB',
  dark: '111827',
  white: 'FFFFFF',
};
const FONT = 'Microsoft JhengHei';
const DATE = '2026-06-09';

pptx.defineSlideMaster({
  title: 'MAIN',
  background: { color: C.white },
  objects: [
    { rect: { x: 0, y: 0, w: 13.333, h: 0.45, fill: { color: C.primary } } },
    { text: { text: '費用性無料號採購 · 自然語言找供應商 · 初步討論',
              options: { x: 0.3, y: 0.05, w: 10, h: 0.35, fontSize: 11, color: C.white, bold: true, fontFace: FONT } } },
    { text: { text: DATE,
              options: { x: 12.0, y: 0.05, w: 1.2, h: 0.35, fontSize: 10, color: C.white, align: 'right', fontFace: FONT } } },
    { rect: { x: 0, y: 7.35, w: 13.333, h: 0.15, fill: { color: C.accent } } },
  ],
});

function addTitle(slide, title, subtitle) {
  slide.addText(title, {
    x: 0.5, y: 0.6, w: 12.3, h: 0.7,
    fontSize: 28, bold: true, color: C.primary, fontFace: FONT,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.5, y: 1.28, w: 12.3, h: 0.35,
      fontSize: 14, color: C.gray, fontFace: FONT, italic: true,
    });
  }
  slide.addShape(pptx.ShapeType.line, {
    x: 0.5, y: subtitle ? 1.68 : 1.4, w: 1.2, h: 0,
    line: { color: C.accent, width: 3 },
  });
}

// bullets: [{ t, lvl, color, bold }]
function bulletText(items, opts = {}) {
  return items.map((it) => ({
    text: it.t,
    options: {
      bullet: it.bullet === false ? false : { indent: 18 },
      indentLevel: it.lvl || 0,
      fontSize: it.fontSize || (it.lvl ? 14 : 16),
      color: it.color || (it.lvl ? C.gray : C.dark),
      bold: !!it.bold,
      fontFace: FONT,
      paraSpaceAfter: it.lvl ? 4 : 8,
      breakLine: true,
    },
  }));
}

// === Slide 1 · Cover ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  s.background = { color: C.primary };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.45, fill: { color: C.primary } });
  s.addShape(pptx.ShapeType.rect, { x: 0.9, y: 2.5, w: 0.18, h: 2.2, fill: { color: C.accent } });
  s.addText('費用性無料號採購', {
    x: 1.3, y: 2.5, w: 11, h: 0.9, fontSize: 40, bold: true, color: C.white, fontFace: FONT,
  });
  s.addText('自然語言查詢供貨廠商 — 向量檢索可行性初步討論', {
    x: 1.3, y: 3.5, w: 11, h: 0.6, fontSize: 22, color: 'D7E0EE', fontFace: FONT,
  });
  s.addText('Cortex × Oracle ERP(EBS)  ·  RAG over PO 採購紀錄', {
    x: 1.3, y: 4.25, w: 11, h: 0.5, fontSize: 15, color: C.accent, fontFace: FONT, italic: true,
  });
  s.addText(`規劃小組  ·  ${DATE}`, {
    x: 1.3, y: 5.5, w: 11, h: 0.4, fontSize: 13, color: 'AEBBD0', fontFace: FONT,
  });
}

// === Slide 2 · 需求背景與目標 ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  addTitle(s, '需求背景與目標', '採購要的不是「哪張 PO」,而是「這東西以前誰供過」');
  s.addText(bulletText([
    { t: '現況', bold: true, color: C.primary },
    { t: '費用性、無料號商品 = EBS 中 ITEM_ID 為空、僅以純文字描述的採購行', lvl: 1 },
    { t: '採購只能憑經驗或人工翻歷史 PO,找「這類東西過去由誰供應、大約多少錢」', lvl: 1 },
    { t: '痛點', bold: true, color: C.primary },
    { t: '描述自由文字、無料號可比對 → 無結構化欄位可查、無法用既有報表撈', lvl: 1 },
    { t: '知識散在個人經驗,人員異動即流失', lvl: 1 },
    { t: '目標', bold: true, color: C.green },
    { t: '採購輸入一句自然語言描述 → 系統回「候選供應商 + 佐證(歷史 PO / 均價 / 最近一次採購)」', lvl: 1 },
  ]), { x: 0.7, y: 2.0, w: 12, h: 5 });
}

// === Slide 3 · 核心構想 ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  addTitle(s, '核心構想', '本質:對結構化 PO 資料做 RAG(檢索增強)');
  // flow boxes
  const boxes = [
    { t: 'PO 描述欄位\n(ITEM_DESCRIPTION)', c: C.primary },
    { t: '向量化\n存入 Cortex 向量庫', c: C.blue },
    { t: '自然語言查詢\n→ 向量 + 關鍵字混合檢索', c: C.accent, tc: C.dark },
    { t: '命中 PO 行\n→ 聚合對應供應商', c: C.green },
  ];
  const bw = 2.85, gap = 0.45, y = 2.5, h = 1.5;
  let x = 0.7;
  boxes.forEach((b, i) => {
    s.addShape(pptx.ShapeType.roundRect, {
      x, y, w: bw, h, fill: { color: b.c }, rectRadius: 0.1, line: { color: b.c, width: 1 },
    });
    s.addText(b.t, { x, y, w: bw, h, align: 'center', valign: 'middle', fontSize: 14, bold: true, color: b.tc || C.white, fontFace: FONT });
    if (i < boxes.length - 1) {
      s.addText('▶', { x: x + bw, y, w: gap, h, align: 'center', valign: 'middle', fontSize: 16, color: C.gray, fontFace: FONT });
    }
    x += bw + gap;
  });
  s.addText(bulletText([
    { t: '供應商歸屬:PO Header 的 VENDOR_ID → 供應商主檔,歸屬明確、不需推測', },
    { t: '回傳不只清單,最後交給 chat LLM 收斂成可讀結論(「主要由 A/B/C 供,A 最常 12 筆均價 X,最近 2026-03」)', },
    { t: '與 AI 戰情室解耦:這是「採購助手」場景,走獨立 KB / 檢索設定', color: C.gray, fontSize: 14 },
  ]), { x: 0.7, y: 4.5, w: 12, h: 2.4 });
}

// === Slide 4 · 前提(已拍板) ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  addTitle(s, '前提(本次已拍板)', '一定要有 PO、不允許直接結報');
  s.addShape(pptx.ShapeType.roundRect, { x: 0.7, y: 2.0, w: 12, h: 1.1, fill: { color: 'EAF5EC' }, line: { color: C.green, width: 1 }, rectRadius: 0.08 });
  s.addText([
    { text: '✅  ', options: { fontSize: 20, color: C.green, fontFace: FONT } },
    { text: '所有費用性採購一律走 PO,不允許直接結報(AP 非 PO 請款路徑全部排除)', options: { fontSize: 17, bold: true, color: C.dark, fontFace: FONT } },
  ], { x: 1.0, y: 2.0, w: 11.4, h: 1.1, valign: 'middle' });

  s.addText(bulletText([
    { t: '對本案的影響', bold: true, color: C.primary },
    { t: '資料源單一明確:只看 PO_LINES_ALL 中 ITEM_ID IS NULL 的費用行', lvl: 1 },
    { t: '不需處理 AP_INVOICE_LINES(非 PO 直接請款)→ ETL 大幅簡化、口徑一致', lvl: 1 },
    { t: '供應商歸屬乾淨:每筆描述都對得到 PO header 的 VENDOR_ID', lvl: 1 },
    { t: '隱含限制(需留意)', bold: true, color: C.red },
    { t: '若某些費用過去曾走非 PO,歷史資料涵蓋度會有缺口 → 範圍須界定起算時間', lvl: 1, color: C.gray },
  ]), { x: 0.7, y: 3.4, w: 12, h: 3.5 });
}

// === Slide 5 · 架構主張 ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  addTitle(s, '架構主張:複用現有積木,不另起爐灶', '需求 = 既有兩塊能力的組合,工作量在「接」不在「建」');
  // two cards
  const cardY = 2.1, cardH = 3.0, cardW = 5.85;
  // card 1 ETL
  s.addShape(pptx.ShapeType.roundRect, { x: 0.7, y: cardY, w: cardW, h: cardH, fill: { color: C.light }, line: { color: C.primary, width: 1 }, rectRadius: 0.08 });
  s.addText('① ETL 同步層', { x: 0.95, y: cardY + 0.15, w: cardW - 0.5, h: 0.4, fontSize: 17, bold: true, color: C.primary, fontFace: FONT });
  s.addText(bulletText([
    { t: '抄 pmErpSyncService 的 pattern', fontSize: 14 },
    { t: 'ERP SELECT → MERGE 進本地表', lvl: 1 },
    { t: 'watermark 增量同步 + 同步 log', lvl: 1 },
    { t: '已含 preview / 失敗重跑機制', lvl: 1 },
  ]), { x: 0.95, y: cardY + 0.6, w: cardW - 0.5, h: cardH - 0.7 });
  // card 2 向量檢索
  s.addShape(pptx.ShapeType.roundRect, { x: 6.85, y: cardY, w: cardW, h: cardH, fill: { color: C.light }, line: { color: C.blue, width: 1 }, rectRadius: 0.08 });
  s.addText('② 向量 + 檢索層', { x: 7.1, y: cardY + 0.15, w: cardW - 0.5, h: 0.4, fontSize: 17, bold: true, color: C.blue, fontFace: FONT });
  s.addText(bulletText([
    { t: '複用 kb_chunks + kbRetrieval', fontSize: 14 },
    { t: 'VECTOR + Oracle Text 混合檢索', lvl: 1 },
    { t: '同義詞展開、multi-vector 現成', lvl: 1 },
    { t: 'PO 描述=chunk;廠商/價/日期/類別=metadata', lvl: 1 },
  ]), { x: 7.1, y: cardY + 0.6, w: cardW - 0.5, h: cardH - 0.7 });

  s.addText([
    { text: '免費繼承:', options: { bold: true, color: C.accent, fontFace: FONT } },
    { text: ' hybrid 檢索、同義詞、metadata 過濾、資料政策權限 — 無需重寫一套 RAG', options: { color: C.dark, fontFace: FONT } },
  ], { x: 0.7, y: 5.5, w: 12, h: 0.8, fontSize: 15, valign: 'middle' });
}

// === Slide 6 · 關鍵設計原則 / 討論重點 ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  addTitle(s, '關鍵設計原則(討論重點)', '純向量做成 demo 會過、上線會被嫌不準 — 以下是落地關鍵');
  s.addText(bulletText([
    { t: '1. 必須 hybrid 檢索(最重要)', bold: true, color: C.red },
    { t: '描述夾型號/廠牌/規格精確 token(3M 9448 vs 9449),純向量會拉成幾乎重疊;要 vector 召回語意 + Oracle Text 對精確 token 加權', lvl: 1 },
    { t: '2. 答案聚合到「供應商」層,而非 top-k PO 行', bold: true, color: C.primary },
    { t: 're-rank = 語意分 × 出現次數 × recency 衰減;避免同一廠商洗版或冷門單筆壓過常態供應商', lvl: 1 },
    { t: '3. 描述需清洗 /(可選)結構化抽取', bold: true, color: C.primary },
    { t: '髒資料:全半形、夾備註、料號-規格混寫;可用 LLM 抽 {品名/規格/廠牌/型號/單位} 當 metadata', lvl: 1 },
    { t: '4. structured 粗篩 + 向量', bold: true, color: C.primary },
    { t: '先用 PO 的 CATEGORY 過濾縮範圍再向量;長尾(不知歸類)才靠純語意', lvl: 1 },
    { t: '5. 增量同步 + reconcile', bold: true, color: C.primary },
    { t: 'watermark by LAST_UPDATE_DATE;PO 取消 / 改描述要能更新並 re-embed 對應 chunk', lvl: 1 },
    { t: '6. 評估用 golden set', bold: true, color: C.primary },
    { t: '採購提供真實查詢 + 期望廠商,否則 hybrid 權重沒方向可調', lvl: 1 },
  ]), { x: 0.7, y: 1.95, w: 12.2, h: 5.2 });
}

// === Slide 7 · 待決議事項 ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  addTitle(s, '待決議事項(Open Decisions)');
  const head = ['議題', '選項 / 待確認', '暫定方向'].map((t) => ({
    text: t, options: { bold: true, color: C.white, fill: { color: C.primary }, fontSize: 13, fontFace: FONT, valign: 'middle', align: 'left' },
  }));
  const rows = [
    ['ERP DB 版本', 'EBS 是否為 23ai?(決定是否必須把資料同步出來)', '多半非 23ai → 同步進 Cortex'],
    ['歷史涵蓋範圍', '回溯幾年 PO、哪些 OU / 廠區納入', '待採購界定(建議近 3 年起跑)'],
    ['描述清洗深度', '僅正規化 vs LLM 結構化抽取欄位', 'P1 先正規化,結構化列 P2'],
    ['供應商 re-rank 公式', '次數 / recency / 價格 各佔權重', 'golden set 出來後再調'],
    ['權限與價格揭露', '誰能查、價格資訊揭露給誰', '綁資料政策分類'],
    ['同步頻率', '即時 / 每日 / 每週', '建議每日排程(接 AI 戰情 pipeline)'],
    ['評估資料', 'golden set 由誰提供、幾筆', '採購提供 ~20 筆真實查詢'],
    ['embedding 模型', '版本鎖定與換模型策略', 'Vertex 768,版本寫入 metadata'],
  ];
  const body = rows.map((r, i) => r.map((c, j) => ({
    text: c,
    options: {
      fontSize: 12, fontFace: FONT, color: C.dark, valign: 'middle',
      bold: j === 0,
      fill: { color: i % 2 ? 'EEF1F6' : C.white },
    },
  })));
  s.addTable([head, ...body], {
    x: 0.6, y: 1.7, w: 12.1, colW: [2.8, 5.6, 3.7],
    border: { type: 'solid', color: 'D0D6E0', pt: 0.5 },
    rowH: 0.55, fontFace: FONT, valign: 'middle', autoPage: false,
  });
}

// === Slide 8 · 初步 Phase 切分 ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  addTitle(s, '初步 Phase 切分', '先小步驗證資料真實樣貌,再投入建置');
  const phases = [
    { p: 'P0', t: '探勘', d: '確認 ERP 版本;撈 PO_LINES 無料號費用行真實 sample → 看筆數量級、描述髒度、category 覆蓋率', c: C.gray },
    { p: 'P1', t: 'ETL + 向量化', d: 'sync job(抄 pmErpSyncService)→ 描述 embed + 廠商/價/日期/類別寫入 metadata', c: C.blue },
    { p: 'P2', t: '檢索 + 聚合', d: 'hybrid 檢索 → 供應商 re-rank → chat LLM 收斂成結論', c: C.accent },
    { p: 'P3', t: '評估 + 上線', d: 'golden set 調 hybrid 權重 + 資料政策綁定 + 排程同步', c: C.green },
  ];
  let y = 2.0;
  phases.forEach((ph) => {
    s.addShape(pptx.ShapeType.roundRect, { x: 0.7, y, w: 1.0, h: 1.05, fill: { color: ph.c }, rectRadius: 0.08 });
    s.addText(ph.p, { x: 0.7, y, w: 1.0, h: 1.05, align: 'center', valign: 'middle', fontSize: 20, bold: true, color: C.white, fontFace: FONT });
    s.addText(ph.t, { x: 1.9, y: y + 0.1, w: 10.8, h: 0.45, fontSize: 17, bold: true, color: C.primary, fontFace: FONT });
    s.addText(ph.d, { x: 1.9, y: y + 0.55, w: 10.8, h: 0.5, fontSize: 13, color: C.dark, fontFace: FONT });
    y += 1.25;
  });
}

// === Slide 9 · Next Step ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  addTitle(s, 'Next Step');
  s.addText(bulletText([
    { t: '請先拍板上頁「待決議事項」(尤其 ERP 版本、歷史範圍、權限口徑)', bold: true },
    { t: '拍板後執行 P0 spike:', },
    { t: '撈 PO_LINES_ALL 中 ITEM_ID IS NULL 的費用行 sample', lvl: 1 },
    { t: '統計:總筆數量級、描述平均長度與髒度、category 覆蓋率、供應商分佈', lvl: 1 },
    { t: 'P0 結果決定 schema(metadata 欄位)與清洗策略,再進 P1', },
  ]), { x: 0.7, y: 2.0, w: 12, h: 3.2 });

  s.addShape(pptx.ShapeType.roundRect, { x: 0.7, y: 5.3, w: 12, h: 1.0, fill: { color: C.light }, line: { color: C.accent, width: 1 }, rectRadius: 0.08 });
  s.addText([
    { text: '一句話總結:', options: { bold: true, color: C.accent, fontFace: FONT } },
    { text: '方向可行,但別搬一套新向量系統 — 用「PO 增量同步 + 既有 hybrid 檢索 + 供應商聚合」三件事接起來即可。', options: { color: C.dark, fontFace: FONT } },
  ], { x: 1.0, y: 5.3, w: 11.4, h: 1.0, fontSize: 14, valign: 'middle' });
}

const out = path.resolve(__dirname, '費用性無料號採購_自然語言找供應商_討論_v1.pptx');
pptx.writeFile({ fileName: out }).then(() => {
  console.log('✅ 產出:', out);
}).catch((e) => {
  console.error('❌ 失敗:', e);
  process.exit(1);
});
