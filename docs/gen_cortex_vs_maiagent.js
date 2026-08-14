// 產生 Cortex(原既有功能,排除開發中的「通用專案管理平台」)vs MaiAgent 比較投影片
// 執行: node docs/gen_cortex_vs_maiagent.js

const path = require('path');
const PptxGenJS = require(path.resolve(__dirname, '..', 'server', 'node_modules', 'pptxgenjs'));

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 inch
pptx.title = 'Cortex vs MaiAgent 功能比較';
pptx.author = 'Cortex 規劃小組';
pptx.company = '正崴';

const C = {
  primary: '1F3A68',
  accent:  'E0A030',
  light:   'F4F6FA',
  gray:    '6B7280',
  green:   '15803D',
  red:     'B91C1C',
  blue:    '2563EB',
  dark:    '111827',
  white:   'FFFFFF',
};

const FONT = 'Microsoft JhengHei';

pptx.defineSlideMaster({
  title: 'MAIN',
  background: { color: C.white },
  objects: [
    { rect: { x: 0, y: 0, w: 13.333, h: 0.45, fill: { color: C.primary } } },
    { text: { text: 'Cortex vs MaiAgent · 功能比較',
              options: { x: 0.3, y: 0.05, w: 9, h: 0.35, fontSize: 11, color: C.white, bold: true, fontFace: FONT } } },
    { text: { text: '2026-06-04',
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
      x: 0.5, y: 1.25, w: 12.3, h: 0.35,
      fontSize: 14, color: C.gray, fontFace: FONT, italic: true,
    });
  }
  slide.addShape(pptx.ShapeType.line, {
    x: 0.5, y: subtitle ? 1.65 : 1.35, w: 1.2, h: 0,
    line: { color: C.accent, width: 3 },
  });
}

// === Slide 1 · Cover ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  s.background = { color: C.primary };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 6.8, w: 13.333, h: 0.55, fill: { color: C.accent } });
  s.addText('Cortex vs MaiAgent', {
    x: 0.7, y: 2.2, w: 12, h: 1.2,
    fontSize: 54, bold: true, color: C.white, fontFace: FONT,
  });
  s.addText('功能比較簡報', {
    x: 0.7, y: 3.4, w: 12, h: 0.8,
    fontSize: 36, color: C.accent, fontFace: FONT,
  });
  s.addText('正崴內部整合 AI 平台 ‧ vs ‧ 商用 AI Agent 平台', {
    x: 0.7, y: 4.4, w: 12, h: 0.5,
    fontSize: 18, color: 'BFD0E8', fontFace: FONT, italic: true,
  });
  s.addText('本簡報範圍:Cortex 已上線 / 既有功能(排除開發中的「通用專案管理平台」)  ·  maiagent.ai 官網公開資訊', {
    x: 0.7, y: 5.5, w: 12, h: 0.4,
    fontSize: 12, color: 'A8BFD9', fontFace: FONT,
  });
  s.addText('Cortex 規劃小組  ·  2026-06-04', {
    x: 0.7, y: 6.9, w: 12, h: 0.4,
    fontSize: 14, color: C.primary, bold: true, fontFace: FONT,
  });
}

// === Slide 2 · TL;DR ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  addTitle(s, 'TL;DR · 一頁看懂兩者差異', '產品定位、整合策略、目標使用者');

  const cards = [
    {
      title: 'Cortex(正崴內部整合 AI 平台)',
      color: C.primary,
      bullets: [
        '✦ 內部自建 · 深度整合 Foxlink ERP / Webex / LDAP / Oracle 23 AI',
        '✦ 「對話 + KB + 教育訓練 + AI 戰情 + 排程 + 工具」一站整合',
        '✦ 多模型:Gemini 3.1 Pro/Flash(Vertex)+ Azure GPT-5 + 多家 LLM',
        '✦ KB v2 Hybrid 檢索:vector + Oracle Text + 同義詞展開 + multi-vector',
        '✦ 機密欄位 + 敏感詞警示 + AES-256 + Audit log',
        '✦ K8s 內部部署(3 replicas + Redis)· 100% 留正崴內網',
      ],
    },
    {
      title: 'MaiAgent / MaiGPT(商用 AI Agent 平台)',
      color: C.accent,
      bullets: [
        '✦ 商用 SaaS / 私有雲(AWS/GCP/Azure)/ 地端三模式',
        '✦ 4 條產品線:MaiGPT、AI KM、AI Meeting、Agent Builder(no-code)',
        '✦ 多模型:Claude/GPT/Gemini/DeepSeek/Llama/Grok/Qwen/Mistral 20+',
        '✦ 通訊渠道廣:LINE/WhatsApp/Teams/Messenger/IG/Telegram/Email',
        '✦ ISO 27001:2022 + ISO 27701:2019 認證 · RBAC + SSO',
        '✦ Token-based billing · 100+ 企業客戶 · 14 天導入',
      ],
    },
  ];

  cards.forEach((card, i) => {
    const x = 0.5 + i * 6.3;
    s.addShape(pptx.ShapeType.roundRect, {
      x, y: 2.0, w: 6.0, h: 5.0,
      fill: { color: C.light }, line: { color: card.color, width: 2 }, rectRadius: 0.1,
    });
    s.addShape(pptx.ShapeType.rect, { x, y: 2.0, w: 6.0, h: 0.6, fill: { color: card.color } });
    s.addText(card.title, {
      x: x + 0.2, y: 2.0, w: 5.8, h: 0.6,
      fontSize: 17, bold: true, color: C.white, fontFace: FONT, valign: 'middle',
    });
    s.addText(card.bullets.map(b => ({ text: b, options: { color: C.dark } })), {
      x: x + 0.3, y: 2.75, w: 5.6, h: 4.0,
      fontSize: 13, fontFace: FONT, valign: 'top', paraSpaceAfter: 6,
    });
  });
}

// === Slide 3 · 產品定位差異 ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  addTitle(s, '產品定位差異', '為誰、解什麼、怎麼整合、怎麼交付');

  const rows = [
    ['構面',           'Cortex',                                          'MaiAgent / MaiGPT'],
    ['類型',           '內部自建整合 AI 平台',                              '商用 AI Agent 平台供應商'],
    ['主要使用者',     '正崴員工(業務 / RD / 工廠 / 採購 / 主管 / IT)',  '企業客戶員工 + 終端消費者'],
    ['核心場景',       'LLM 對話 / KB 查詢 / 教育訓練 / BI 對話 / 排程報表',  '客服 / KM / 會議 / 自訂 Agent / Chatbot'],
    ['競爭優勢',       '深度整合 ERP / Webex / LDAP + 內網安全',         '多模型廣度 + 多渠道 + 合規認證 + no-code'],
    ['交付模式',       'K8s 內部部署(3 replicas + Redis + Oracle 23 AI)','SaaS / 私有雲 / 地端可選'],
    ['資料邊界',       '100% 留正崴內網,DBA 看不到機密欄位明文',         '宣稱「資料不用於公共模型訓練」'],
    ['計費模式',       '內部攤提(token + infra)',                       'Token-based billing(無人頭費)'],
  ];

  s.addTable(rows, {
    x: 0.5, y: 1.8, w: 12.3, h: 5.3,
    colW: [2.3, 5.0, 5.0],
    fontSize: 13, fontFace: FONT,
    border: { type: 'solid', pt: 1, color: 'D1D5DB' },
    rowH: 0.6,
  });
}

// === Slide 4 · Cortex 既有功能地圖 ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  addTitle(s, 'Cortex 既有功能地圖', '已上線 / 生產中的模組 · 排除開發中專案管理平台');

  const modules = [
    { title: '對話 LLM',         items: '多模型切換(Gemini 3.1 / Azure GPT-5)\nSSE streaming · reasoning_effort\n圖片 / 音訊 / 檔案 multimodal' },
    { title: '深度研究模式',     items: 'researchService 多步 RAG\n跨來源驗證 · 獨立 admin 介面\n可控的 thinking budget' },
    { title: '知識庫 KB v2',     items: 'Hybrid:vector + Oracle Text + 同義詞\nMulti-vector(title+content)\nper-KB retrieval_config 覆寫' },
    { title: '技能 / MCP / DIFY', items: 'ERP FUNCTION/PROCEDURE 工具化\nMCP User Identity(RS256 JWT)\nDIFY workflow / chatflow as tool' },
    { title: 'AI 戰情(NL → BI)', items: '自然語言 → SQL → ECharts\nDashboard pipeline + Excel 合併\n排程 + Email/Webex 推送' },
    { title: '教育訓練平台',     items: '課程 / 章節 / 投影片 / Quiz\nChrome Extension 截圖錄製\nLLM 自動生成 + 三語翻譯' },
    { title: '排程任務',         items: 'Cron scheduled task\n7 grantee × 兩級權限分享\n戰情整合 + 多 sheet xlsx' },
    { title: '問題反饋平台',     items: '工單系統 + 通知\n敏感詞偵測 + 自動發信\nAdmin 處理流程' },
    { title: '文件生成 / 範本',  items: '```generate_xlsx/docx/pdf/pptx```\npptxgenjs / docx / pdfkit / xlsx\nCJK PDF(Noto Sans TC)' },
    { title: '通訊整合',         items: 'Webex Bot(webhook + WebSocket)\nGmail API + SMTP\n站內 Badge + Email 多通道' },
    { title: '身份 / SSO',       items: 'LDAP(AD)+ SSO\nWebAuthn(passkey)\n離職自動撤權 · token 走 Redis' },
    { title: '安全 / 治理',      items: '機密欄位策略 + 敏感詞警示\nAES-256 + Oracle TDE\nAudit log + 多語言 i18n' },
  ];

  const cols = 4, rows = 3;
  const cellW = 3.10, cellH = 1.65;
  const startX = 0.4, startY = 1.85;

  modules.forEach((m, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = startX + c * (cellW + 0.05);
    const y = startY + r * (cellH + 0.05);
    s.addShape(pptx.ShapeType.roundRect, {
      x, y, w: cellW, h: cellH,
      fill: { color: C.light }, line: { color: C.primary, width: 1 }, rectRadius: 0.05,
    });
    s.addShape(pptx.ShapeType.rect, { x, y, w: cellW, h: 0.4, fill: { color: C.primary } });
    s.addText(m.title, {
      x: x + 0.1, y, w: cellW - 0.2, h: 0.4,
      fontSize: 12, bold: true, color: C.white, fontFace: FONT, valign: 'middle',
    });
    s.addText(m.items, {
      x: x + 0.15, y: y + 0.45, w: cellW - 0.3, h: cellH - 0.5,
      fontSize: 9.5, color: C.dark, fontFace: FONT, valign: 'top',
    });
  });
}

// === Slide 5 · MaiAgent 產品線地圖 ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  addTitle(s, 'MaiAgent 產品線地圖', '4 條核心產品線 · 多渠道整合 · 企業級合規');

  const lines = [
    { title: 'MaiGPT',         items: '企業級對話介面\n20+ LLM 模型切換\nCanvas 視覺化協作\nAI 圖片生成(Nano Banana Pro)\n企業級 Prompt 管理 + 模板庫' },
    { title: 'AI KM',          items: '企業知識庫\nRAG 精準問答\n權限管理\n文件處理(PDF/Word/Excel)' },
    { title: 'AI Meeting',     items: '會議錄音轉逐字\n自動摘要\nAction item 追蹤' },
    { title: 'Agent Builder',  items: 'No-code / Low-code\n自訂 AI Agent\nAPI 整合\nMCP 連接器(Notion/Asana/GitHub/Sentry)' },
    { title: '通訊渠道整合',     items: 'LINE / WhatsApp / Teams\nMessenger / IG / Telegram\nEmail / REST API / WebSocket / Widget' },
    { title: '企業合規 + 部署', items: 'ISO 27001:2022 / 27701:2019\nSaaS / AWS / GCP / Azure / 地端\nSSO / RBAC / Audit log / AES-256 + TLS 1.3' },
  ];

  const cols = 3, rows = 2;
  const cellW = 4.1, cellH = 2.4;
  const startX = 0.5, startY = 1.85;

  lines.forEach((m, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = startX + c * (cellW + 0.05);
    const y = startY + r * (cellH + 0.1);
    s.addShape(pptx.ShapeType.roundRect, {
      x, y, w: cellW, h: cellH,
      fill: { color: C.light }, line: { color: C.accent, width: 1 }, rectRadius: 0.05,
    });
    s.addShape(pptx.ShapeType.rect, { x, y, w: cellW, h: 0.45, fill: { color: C.accent } });
    s.addText(m.title, {
      x: x + 0.1, y, w: cellW - 0.2, h: 0.45,
      fontSize: 14, bold: true, color: C.white, fontFace: FONT, valign: 'middle',
    });
    s.addText(m.items, {
      x: x + 0.15, y: y + 0.5, w: cellW - 0.3, h: cellH - 0.55,
      fontSize: 11, color: C.dark, fontFace: FONT, valign: 'top',
    });
  });
}

// 共用:比較表
function compareSlide(title, subtitle, rows) {
  const s = pptx.addSlide({ masterName: 'MAIN' });
  addTitle(s, title, subtitle);

  const data = [
    [
      { text: '功能 / 構面',             options: { bold: true, color: C.white, fill: { color: C.primary }, align: 'center', valign: 'middle', fontSize: 13 } },
      { text: 'Cortex',                  options: { bold: true, color: C.white, fill: { color: C.primary }, align: 'center', valign: 'middle', fontSize: 13 } },
      { text: 'MaiAgent / MaiGPT',       options: { bold: true, color: C.white, fill: { color: C.primary }, align: 'center', valign: 'middle', fontSize: 13 } },
      { text: '勝出',                    options: { bold: true, color: C.white, fill: { color: C.primary }, align: 'center', valign: 'middle', fontSize: 13 } },
    ],
    ...rows.map(r => [
      { text: r[0], options: { bold: true, color: C.dark, fill: { color: C.light }, fontSize: 11.5, valign: 'middle' } },
      { text: r[1], options: { color: C.dark, fontSize: 10.5, valign: 'middle' } },
      { text: r[2], options: { color: C.dark, fontSize: 10.5, valign: 'middle' } },
      { text: r[3], options: {
          bold: true,
          color: r[3] === 'Cortex' ? C.blue : r[3] === 'MaiAgent' ? C.accent : C.gray,
          fontSize: 11, align: 'center', valign: 'middle',
        } },
    ]),
  ];

  s.addTable(data, {
    x: 0.4, y: 1.85, w: 12.5,
    colW: [2.2, 4.5, 4.5, 1.3],
    fontFace: FONT,
    border: { type: 'solid', pt: 0.75, color: 'D1D5DB' },
    autoPage: false,
  });
}

// === Slide 6 · 對話 / 多模型 / 多模態 ===
compareSlide(
  '比較表 ① 對話、多模型、多模態',
  'LLM 串接、模型支援、輸入類型',
  [
    ['模型支援數',
      'Gemini 3.1 Pro/Flash(Vertex)+ Azure GPT-5 + 多家 LLM,可在 admin 自加',
      'Claude / GPT-4o / Gemini / DeepSeek / Llama / Grok / Qwen / Mistral 20+',
      'MaiAgent'],
    ['SSE 串流',
      '✅ chat / 翻譯 / 戰情對話 全用 SSE,K8s ingress 已調 3600s timeout',
      '✅ 標準',
      '平手'],
    ['多模態(圖/音/檔)',
      '✅ Vision、長音訊背景 STT job、PDF/Excel/Word/PPT 解析',
      '✅ 圖片 OCR、PDF/Word/Excel、語音輸入',
      '平手'],
    ['圖片生成',
      '✅ Gemini 3 pro-image 模型可選 · 對話 / 教材封面直接產',
      '✅ Nano Banana Pro · 主打繁中渲染',
      '平手'],
    ['深度研究模式',
      '✅ researchService 多步 RAG + 跨來源 + admin 介面調 thinking budget',
      '✅ 自動規劃 + 多輪搜尋 + 交叉驗證',
      '平手'],
    ['reasoning_effort 細控',
      '✅ low/medium/high per-message;Gemini 3.x + Azure GPT-5 一致 UI',
      '⚠ 官網未明示',
      'Cortex'],
    ['即時聯網搜尋',
      '⚠ 有 web tool 但非預設',
      '✅ 內建',
      'MaiAgent'],
    ['多語言介面',
      '✅ zh-TW / en / vi 完整 i18n + DB 動態內容自動翻譯',
      '✅ 中英',
      'Cortex(含越南文)'],
  ]
);

// === Slide 7 · 知識庫 / RAG ===
compareSlide(
  '比較表 ② 知識庫(RAG)',
  '檢索架構、向量、同義詞、生命週期',
  [
    ['檢索策略',
      '✅ Hybrid:vector + Oracle Text FT + 同義詞 OR 展開(kb_thesauri)',
      '✅ RAG(細節未公開)',
      'Cortex'],
    ['Multi-vector',
      '✅ title_embedding + content_embedding 雙路召回',
      '⚠ 未明示',
      'Cortex'],
    ['同義詞 / 別名',
      '✅ kb_thesauri + chat LLM 提示「X=Y 同實體」',
      '⚠ 未明示',
      'Cortex'],
    ['Per-KB 檢索覆寫',
      '✅ retrieval_config CLOB,每 KB 可獨立調參',
      '⚠ 未明示',
      'Cortex'],
    ['知識來源',
      '檔案 + chat 訊息 + ERP 快照 + 對話 history',
      '檔案上傳為主',
      'Cortex'],
    ['No-code KM 介面',
      '⚠ 有 admin UI,偏技術型',
      '✅ AI KM 獨立產品 · 商用就緒',
      'MaiAgent'],
    ['向量模型',
      'Vertex text-embedding(VECTOR(768))',
      '可選(隨 LLM 供應商)',
      '平手'],
    ['全文索引',
      'Oracle Text CTX_FTX · SYNC every 1 min',
      '雲端 search engine',
      '平手'],
  ]
);

// === Slide 8 · Agent / 工具整合 ===
compareSlide(
  '比較表 ③ Agent、工具、整合',
  'Tool calling、MCP、外部系統',
  [
    ['MCP 支援',
      '✅ MCP client + User Identity(RS256 JWT, 5min TTL)+ stdio per-call spawn',
      '✅ MCP 連接器(Notion / Asana / GitHub / Sentry)',
      'Cortex(認證更嚴)'],
    ['ERP 整合',
      '✅ ERP FUNCTION/PROCEDURE 工具化 · LLM tool-calling 直接呼叫 EBS',
      '⚠ 需自寫 Agent + REST',
      'Cortex'],
    ['DIFY 整合',
      '✅ 原生支援 DIFY workflow / chatflow as tool',
      '⚠ 未提',
      'Cortex'],
    ['自訂技能 runner',
      '✅ 技能 4 型:內建 Prompt / 外部 Endpoint / 內部程式(Node.js code runner)/ 工作流',
      '✅ Agent Builder(no-code 拖拉)',
      '平手(MaiAgent UI 更直覺 · Cortex 更彈性)'],
    ['Tool 能力分級',
      '✅ 問答 / 讀工具 / 產內容 / 寫入 4 級;寫入需 user 二次確認',
      '⚠ 未明示',
      'Cortex'],
    ['BI / NL → SQL',
      '✅ AI 戰情:NL → SQL → ECharts → Excel 合併 → 排程',
      '⚠ 未主打',
      'Cortex'],
    ['檔案生成',
      '✅ pptx/docx/pdf/xlsx 從 LLM 回應自動產(```generate_xlsx:```)',
      '⚠ 未提',
      'Cortex'],
    ['Workflow 圖形化編輯',
      '✅ 工作流型技能 · 含節點編輯 · 可組多步驟',
      '✅ Agent Builder 拖拉介面 · 對外定位主打',
      'MaiAgent(UI 體驗) · Cortex(整合深度)'],
  ]
);

// === Slide 9 · 企業整合 / 通訊渠道 ===
compareSlide(
  '比較表 ④ 企業整合與通訊渠道',
  '帳號 / 通訊 / 排程 / 內部系統',
  [
    ['SSO / 身份',
      '✅ LDAP(AD)+ SSO + WebAuthn(passkey)+ 離職自動撤權',
      '✅ SSO',
      'Cortex(passkey)'],
    ['通訊渠道',
      '✅ Webex Bot(webhook + WS)+ Email(SMTP)+ 站內 Badge',
      '✅ LINE / WhatsApp / Teams / Messenger / IG / Telegram / Email / Widget',
      'MaiAgent(渠道廣)'],
    ['Webex 深度整合',
      '✅ Webhook + WebSocket + Akamai WAF 兼容(白名單已設定)',
      '⚠ Teams 為主 · Webex 未列',
      'Cortex'],
    ['Email 自動發信',
      '✅ SMTP 範本 + 排程報表 + 敏感詞警示 + 反饋通知',
      '✅ Email 渠道',
      '平手'],
    ['排程任務(Cron)',
      '✅ Scheduled task + 7 grantee × 兩級權限分享 + Dashboard 整合',
      '⚠ 未主打',
      'Cortex'],
    ['ERP 直連',
      '✅ Oracle EBS · 多 DB source(source_db_id 路由 pool)',
      '⚠ 需自串',
      'Cortex'],
    ['REST API / Webhook out',
      '✅ /api/* + scheduled webhook',
      '✅ REST API / WebSocket / Widget',
      '平手'],
    ['Chrome Extension',
      '✅ 操作截圖錄製 → AI 自動生成教育訓練教材',
      '⚠ 未提',
      'Cortex'],
  ]
);

// === Slide 10 · 部署 / 安全 / 合規 ===
compareSlide(
  '比較表 ⑤ 部署、安全、合規',
  '部署形態、加密、權限、稽核',
  [
    ['部署形態',
      'K8s 內部叢集(3 replicas + Redis + NFS 500Gi + Oracle 23 AI)',
      'SaaS / 私有雲(AWS/GCP/Azure)/ 地端',
      'MaiAgent(彈性)'],
    ['資料邊界',
      '✅ 100% 留正崴內網 · DBA 看不到機密欄位明文(AES-256 欄位加密)',
      '✅ 地端可零資料外洩 · SaaS 宣稱不訓練',
      'Cortex(物理隔離)'],
    ['機密策略粒度',
      '✅ 欄位級 · 多角色 · 顯示策略(MASK / ALIAS / RANGE / TIER)',
      '✅ RBAC 權限',
      'Cortex'],
    ['敏感詞偵測',
      '✅ 對話自動偵測 + 標記 + 自動 Email 通知 admin',
      '⚠ 未公開',
      'Cortex'],
    ['Audit log',
      '✅ audit_logs(永久保留)+ 操作紀錄',
      '✅ 完整稽核',
      '平手'],
    ['加密',
      '✅ 欄位 AES-256 + Oracle TDE 表空間 + TLS',
      '✅ AES-256 + TLS 1.3',
      '平手'],
    ['ISO / 合規認證',
      '⚠ 無第三方認證(內部使用)',
      '✅ ISO 27001:2022 + ISO 27701:2019',
      'MaiAgent'],
    ['Token store',
      'Redis(K8s 多 Pod 共享 session)',
      '商用標準',
      '平手'],
  ]
);

// === Slide 11 · Cortex 獨家功能 ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  addTitle(s, 'Cortex 獨家功能(MaiAgent 沒有 / 未公開)', '為什麼正崴自建而不買 SaaS');

  const items = [
    { title: '⭐ AI 輔助系統設計(Self-Building)', detail: '排程 / Code Runner / 技能 / 工作流 都可請 AI 從需求描述直接產代碼 · 平台用 AI 蓋自己' },
    { title: 'ERP 工具(LLM / 手動 / Inject)', detail: 'EBS FUNCTION/PROC 工具集 · Picker / Invoke Modal / 結果圖表 / LOV / 詞彙表 / 審計 · 三種呼叫模式' },
    { title: '深度 ERP 整合',           detail: '多 DB source 自動路由 pool · KB 直接索引 ERP 快照 · 員工問「上個月毛利」直接拉值' },
    { title: '全站欄位語音輸入',         detail: '對話 / 表單 / 教材編輯 / KB 上傳 所有 textarea / input 皆支援語音輸入 · 含 hotkey 提示' },
    { title: 'AI 戰情 NL → BI',         detail: '自然語言 → SQL → ECharts → 多 sheet Excel 合併 → 排程 → Webex/Email 推送' },
    { title: 'KB v2 Hybrid 多路檢索',   detail: 'vector + Oracle Text FT + 同義詞 OR 展開 + multi-vector · per-KB config 覆寫' },
    { title: 'KB 圖片 I/O multimodal',  detail: 'KB 支援圖片匯入(KbImage)+ 輸出 · multimodal RAG · LLM 可看圖回答' },
    { title: 'MCP User Identity JWT',   detail: 'RS256 簽 X-User-Token(5min TTL · per-call spawn)· MCP 伺服器可驗簽真實身份' },
    { title: '教育訓練平台',             detail: '課程 / 章節 / 投影片 / Quiz · LLM 自動生成教材 · 三語翻譯 · 學習評分 + 教室模式' },
    { title: 'Chrome Extension 錄製',   detail: '在目標系統錄操作 → 自動截圖上傳 → AI 辨識生成互動教材 · 內部 SOP 半自動化' },
    { title: 'STT + 會議紀錄自動產生',   detail: '長音訊背景 job + 會議文件範本 + LLM 摘要 + action item · ffmpeg 切片' },
    { title: 'Prompt 技能含版本 + 多語', detail: '內建 Prompt 技能 = Prompt 庫 + System Prompt + 標籤 + 版本歷史 + 三語自動翻譯' },
    { title: '文件範本管理',             detail: 'TemplatesPage · 自訂 docx/xlsx/pptx 範本 · LLM 套填欄位 · 可分享 / 多語' },
    { title: '我的圖庫',                 detail: '對話 / 教育訓練 / KB 跨來源圖片庫 · 個人收藏 · 一鍵插入後續對話 / 教材' },
    { title: '檔案生成觸發',             detail: '```generate_xlsx/docx/pdf/pptx``` 從 LLM 回應自動產檔下載 · CJK PDF' },
    { title: 'Token 費用統計儀表板',     detail: '帳號 / 利潤中心 / 部門 / 事業處 多軸切片 · 月份趨勢 · 攤算成本到 BU' },
    { title: '排程任務 + 戰情整合',     detail: 'Cron + 7 grantee × 兩級權限分享 + 多 dashboard 合併 xlsx + 失敗節點追蹤' },
    { title: '問題工單系統',             detail: '使用者回報 → admin 處理 → 通知三通道(Email / Webex / Badge)· 含 SLA' },
  ];

  const cols = 4, rows = 5;
  const cellW = 3.10, cellH = 1.03;
  const startX = 0.4, startY = 1.85;
  items.forEach((it, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = startX + c * (cellW + 0.05);
    const y = startY + r * (cellH + 0.06);
    s.addShape(pptx.ShapeType.roundRect, {
      x, y, w: cellW, h: cellH,
      fill: { color: C.light }, line: { color: C.blue, width: 1 }, rectRadius: 0.04,
    });
    s.addText(it.title, {
      x: x + 0.08, y: y + 0.03, w: cellW - 0.16, h: 0.32,
      fontSize: 9.5, bold: true, color: C.primary, fontFace: FONT,
    });
    s.addText(it.detail, {
      x: x + 0.08, y: y + 0.33, w: cellW - 0.16, h: cellH - 0.36,
      fontSize: 7.5, color: C.dark, fontFace: FONT, valign: 'top',
    });
  });
}

// === Slide 12 · MaiAgent 領先處 / Cortex 護城河 ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  addTitle(s, 'MaiAgent 領先處 · Cortex 護城河', '對方做得好的、我們可以借鑒 / 我們抄不來的');

  const lefts = [
    { t: 'ISO 27001:2022 + 27701:2019', d: '若 Cortex 對外授權(子公司 / 客戶 portal),認證會是門票' },
    { t: '通訊渠道廣',                   d: 'LINE / WhatsApp / Teams / Messenger / IG / Telegram · 對外客戶 / B2C 場景剛需' },
    { t: '20+ 模型廣度',                 d: 'DeepSeek / Qwen / Mistral / Llama / Grok 等 Cortex 沒接的 open-weight 模型' },
    { t: 'Canvas 文件協作',             d: '類 Notion 即時協作畫面 · Cortex 對話為主,沒有共筆文件 UI' },
    { t: 'Agent-as-a-Service',           d: '客戶可直接把 Agent 掛到自家 LINE 商家 / FB 粉專自動客服 · Cortex 偏內部工具' },
    { t: '100+ 企業客戶生態',           d: '金融 / 保險 / 製造跨產業案例;Cortex 是單一企業內部系統,無外部標竿' },
    { t: '14 天導入方法論',              d: '商用顧問流程 · 諮詢 → POC → 部署 · Cortex 對 BU 推廣可參考做 kickoff 模板' },
    { t: 'no-code 介面更直覺',           d: 'Agent Builder UI 拖拉,業務不寫 code 也能組;Cortex 工作流 + code runner 偏 IT' },
  ];

  const rights = [
    { t: '⭐ AI 輔助系統設計(Self-Building)', d: '排程 / Code Runner / 技能 / 工作流 都可請 AI 從需求描述產代碼 · 平台用 AI 蓋自己 · SaaS 沒有' },
    { t: '深度 ERP / Oracle 23 AI 整合',  d: 'EBS function-as-tool · KB 直接索引 ERP 快照 · SaaS 抄不來' },
    { t: '機密策略粒度遠勝 SaaS',         d: '欄位級 + 多顯示策略 · 商用平台不可能為單一客戶做這麼細' },
    { t: '資料 100% 留內網',              d: 'BOM / 報價 / 客戶料號外洩風險巨大 · SaaS 永遠是疑慮' },
    { t: 'Token 費用統計儀表板',          d: '帳號/利潤中心/部門/事業處多軸切片 + 月份趨勢 · 內部成本治理現成可用' },
    { t: 'AI 戰情 NL → BI',               d: '自助分析 + Excel 合併 + 排程推送 · 是 Cortex 跟 MaiAgent 最大差異' },
    { t: '會議紀錄自動產生',              d: 'STT(>50MB 背景 job)+ 會議文件範本 + LLM 摘要 · 等同 MaiAgent AI Meeting' },
    { t: '檔案生成 + LLM 觸發',            d: '```generate_xlsx``` 自動下載成檔 · 業務體感最強 · MaiAgent 未提' },
    { t: 'Chrome Extension 錄製教材',     d: '內部 SOP 半自動化教材 · SaaS 沒有對應 plugin' },
  ];

  s.addText('MaiAgent 領先(Cortex 可考慮補)', {
    x: 0.5, y: 1.85, w: 6.2, h: 0.4,
    fontSize: 14, bold: true, color: C.accent, fontFace: FONT,
  });
  s.addText('Cortex 護城河(MaiAgent 抄不來)', {
    x: 6.85, y: 1.85, w: 6.0, h: 0.4,
    fontSize: 14, bold: true, color: C.blue, fontFace: FONT,
  });

  lefts.forEach((it, i) => {
    const y = 2.3 + i * 0.55;
    s.addShape(pptx.ShapeType.roundRect, {
      x: 0.5, y, w: 6.2, h: 0.5,
      fill: { color: 'FFF7E6' }, line: { color: C.accent, width: 0.75 }, rectRadius: 0.03,
    });
    s.addText([
      { text: it.t + '  ', options: { bold: true, color: C.dark, fontSize: 10 } },
      { text: it.d, options: { color: C.gray, fontSize: 8.5 } },
    ], { x: 0.6, y, w: 6.0, h: 0.5, fontFace: FONT, valign: 'middle' });
  });

  rights.forEach((it, i) => {
    const y = 2.3 + i * 0.55;
    s.addShape(pptx.ShapeType.roundRect, {
      x: 6.85, y, w: 6.0, h: 0.5,
      fill: { color: 'E6EEF8' }, line: { color: C.blue, width: 0.75 }, rectRadius: 0.03,
    });
    s.addText([
      { text: it.t + '  ', options: { bold: true, color: C.dark, fontSize: 10 } },
      { text: it.d, options: { color: C.gray, fontSize: 8.5 } },
    ], { x: 6.95, y, w: 5.8, h: 0.5, fontFace: FONT, valign: 'middle' });
  });
}

// === Slide 13 · 結論與建議 ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  addTitle(s, '結論與建議', '兩平台不是替代,是不同層面的工具');

  s.addShape(pptx.ShapeType.roundRect, {
    x: 0.5, y: 1.9, w: 12.3, h: 1.3,
    fill: { color: '1F3A68' }, line: { color: C.primary, width: 0 }, rectRadius: 0.08,
  });
  s.addText('一句話結論', {
    x: 0.7, y: 2.0, w: 12, h: 0.4,
    fontSize: 14, bold: true, color: C.accent, fontFace: FONT,
  });
  s.addText('Cortex 是「深度整合的內部 OS」,MaiAgent 是「廣度通用的 SaaS」。前者贏在 ERP / KB / BI 對話 / 教育訓練,後者贏在合規 / 渠道 / no-code。', {
    x: 0.7, y: 2.4, w: 12, h: 0.75,
    fontSize: 15, color: C.white, fontFace: FONT, valign: 'top',
  });

  const advice = [
    { num: '①', t: '繼續強化 Cortex 護城河',     d: 'ERP 整合 / KB v2 / AI 戰情 / 機密策略 — SaaS 永遠做不到的深度,是真正的價值' },
    { num: '②', t: '技能 UI 朝 no-code 拖拉演化', d: '工作流型技能已有 · 可加圖形化編輯器,讓業務 / PM 不寫 code 自己組,降低依賴 IT' },
    { num: '③', t: '渠道延伸補 LINE / Teams',     d: 'Webex 主導,但外部協作時 LINE / Teams 不可缺 · webhook 架構已通用,加 adapter 即可' },
    { num: '④', t: '推 ISO 認證(長期)',           d: '若 Cortex 要對外授權(供應商 portal / 客戶 API),ISO 27001 是必要門票' },
    { num: '⑤', t: '不需替換 · 可並用',             d: '可考慮 MaiAgent 處理「對外客戶 / 行銷 chatbot」,Cortex 處理「對內 RFQ / KB / BI / 訓練」' },
  ];

  advice.forEach((a, i) => {
    const y = 3.4 + i * 0.72;
    s.addShape(pptx.ShapeType.roundRect, {
      x: 0.5, y, w: 12.3, h: 0.65,
      fill: { color: C.light }, line: { color: C.primary, width: 0.75 }, rectRadius: 0.04,
    });
    s.addText(a.num, {
      x: 0.6, y, w: 0.7, h: 0.65,
      fontSize: 22, bold: true, color: C.accent, fontFace: FONT, valign: 'middle', align: 'center',
    });
    s.addText([
      { text: a.t + '  ', options: { bold: true, color: C.primary, fontSize: 13 } },
      { text: a.d, options: { color: C.dark, fontSize: 11 } },
    ], { x: 1.4, y, w: 11.3, h: 0.65, fontFace: FONT, valign: 'middle' });
  });
}

// === Slide 14 · Q&A ===
{
  const s = pptx.addSlide({ masterName: 'MAIN' });
  s.background = { color: C.primary };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 6.8, w: 13.333, h: 0.55, fill: { color: C.accent } });
  s.addText('Questions & Discussion', {
    x: 0.7, y: 2.8, w: 12, h: 1.2,
    fontSize: 56, bold: true, color: C.white, fontFace: FONT,
  });
  s.addText('歡迎針對任一比較項目深入討論', {
    x: 0.7, y: 4.0, w: 12, h: 0.6,
    fontSize: 20, color: C.accent, fontFace: FONT,
  });
  s.addText('參考:Cortex 主程式碼 / docs/kb-retrieval-architecture-v2.md / docs/gemini-sdk-migration-plan.md / maiagent.ai', {
    x: 0.7, y: 5.0, w: 12, h: 0.4,
    fontSize: 12, color: 'A8BFD9', fontFace: FONT,
  });
}

const outPath = path.resolve(__dirname, 'Cortex_vs_MaiAgent_比較_v6.pptx');
pptx.writeFile({ fileName: outPath }).then(f => {
  console.log('OK:', f);
}).catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
