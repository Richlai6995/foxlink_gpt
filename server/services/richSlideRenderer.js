'use strict';
/**
 * Rich Slide Renderer — High-level slide types → pptxgenjs rendering
 *
 * Supported slide types:
 *   title, closing, section, bullets, two_col, 3col, quote,
 *   dashboard, data_table, chart, infographic, timeline,
 *   comparison, process_flow, image_text
 */

const { getIconDataUri, ICON_NAMES } = require('./pptIcons');

// ── Strip markdown ──────────────────────────────────────────────────────────────
function strip(text) {
  if (typeof text !== 'string') return String(text ?? '');
  return text
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/\*(.+?)\*/gs, '$1')
    .replace(/__(.+?)__/gs, '$1')
    .replace(/_(.+?)_/gs, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[●•]\s*/u, '')
    .trim();
}
function sa(arr) { return Array.isArray(arr) ? arr.map(strip) : []; }

// ── Theme System ────────────────────────────────────────────────────────────────
const THEMES = {
  dark: {
    bg: '0F172A', headerBg: '1E293B', headerLine: '3B82F6', headerText: 'F1F5F9',
    cardBg: '1E293B', cardBorder: '334155',
    text: 'F1F5F9', dim: '94A3B8', accent: '60A5FA', line: '3B82F6',
    tableHeaderBg: '1E3A5F', tableHeaderText: 'F1F5F9',
    tableRowBg: '0F172A', tableAltBg: '1E293B', tableBorder: '334155',
    chartColors: ['3B82F6', '10B981', 'F59E0B', 'EF4444', '8B5CF6', '06B6D4', 'EC4899', '84CC16'],
    isDark: true,
  },
  light: {
    bg: 'FFFFFF', headerBg: '1F3864', headerLine: '3B82F6', headerText: 'FFFFFF',
    cardBg: 'F8FAFC', cardBorder: 'E2E8F0',
    text: '1E293B', dim: '64748B', accent: '2563EB', line: '3B82F6',
    tableHeaderBg: '1F3864', tableHeaderText: 'FFFFFF',
    tableRowBg: 'FFFFFF', tableAltBg: 'F1F5F9', tableBorder: 'E2E8F0',
    chartColors: ['2563EB', '059669', 'D97706', 'DC2626', '7C3AED', '0891B2', 'DB2777', '65A30D'],
    isDark: false,
  },
  corporate: {
    bg: 'FFFFFF', headerBg: '4F81BD', headerLine: 'FFC000', headerText: 'FFFFFF',
    cardBg: 'F0F5FB', cardBorder: '4F81BD',
    text: '333333', dim: '8E8E8E', accent: '4F81BD', line: 'FFC000',
    tableHeaderBg: '4F81BD', tableHeaderText: 'FFFFFF',
    tableRowBg: 'FFFFFF', tableAltBg: 'D9E2F3', tableBorder: '4F81BD',
    chartColors: ['4F81BD', 'FFC000', 'C0504D', '9BBB59', '8064A2', '4BACC6', 'F79646', '7F6084'],
    isDark: false,
  },
};

// Card color presets per theme darkness
const CARD_COLORS = {
  blue:    { light: { bg: 'DBEAFE', border: '3B82F6', text: '1E40AF', num: '1E3A5F' }, dark: { bg: '1E3A5F', border: '3B82F6', text: 'BFDBFE', num: 'FFFFFF' } },
  green:   { light: { bg: 'D1FAE5', border: '10B981', text: '065F46', num: '065F46' }, dark: { bg: '064E3B', border: '10B981', text: 'A7F3D0', num: 'FFFFFF' } },
  yellow:  { light: { bg: 'FEF3C7', border: 'F59E0B', text: '92400E', num: '78350F' }, dark: { bg: '78350F', border: 'F59E0B', text: 'FDE68A', num: 'FFFFFF' } },
  red:     { light: { bg: 'FEE2E2', border: 'EF4444', text: '991B1B', num: '7F1D1D' }, dark: { bg: '7F1D1D', border: 'EF4444', text: 'FECACA', num: 'FFFFFF' } },
  orange:  { light: { bg: 'FFEDD5', border: 'F97316', text: '9A3412', num: '7C2D12' }, dark: { bg: '7C2D12', border: 'F97316', text: 'FED7AA', num: 'FFFFFF' } },
  purple:  { light: { bg: 'EDE9FE', border: '8B5CF6', text: '5B21B6', num: '4C1D95' }, dark: { bg: '4C1D95', border: '8B5CF6', text: 'DDD6FE', num: 'FFFFFF' } },
  gray:    { light: { bg: 'F1F5F9', border: '94A3B8', text: '475569', num: '334155' }, dark: { bg: '374151', border: '6B7280', text: 'D1D5DB', num: 'FFFFFF' } },
  default: { light: { bg: 'F0F5FB', border: '4F81BD', text: '1F3864', num: '1F3864' }, dark: { bg: '334155', border: '64748B', text: 'CBD5E1', num: 'FFFFFF' } },
};

function getCardColor(name, isDark) {
  const preset = CARD_COLORS[name] || CARD_COLORS.default;
  return isDark ? preset.dark : preset.light;
}

// Status color map for data tables
const STATUS_DEFAULTS = {
  '上線': '22C55E', '已完成': '22C55E', 'live': '22C55E', 'done': '22C55E', 'completed': '22C55E',
  '進行中': 'EAB308', 'in progress': 'EAB308', 'active': 'EAB308',
  'poc': 'F97316', 'pilot': 'F97316', '試點': 'F97316',
  '規劃中': '94A3B8', 'planned': '94A3B8', '待開始': '94A3B8',
  '暫停': 'EF4444', '取消': 'EF4444', 'cancelled': 'EF4444',
};

// ── Shared Drawing Helpers ──────────────────────────────────────────────────────
let W = 10.0;   // slide width — overridable via renderRichInnerSlides options
let H = 5.625;  // slide height
let DRAW_FOOTER = true; // set false in template-merge mode

function drawHeader(pptx, s, t, title, iconName) {
  // Header bar — scale height proportionally to slide height
  const hdrH = Math.max(0.9, H * 0.14);
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: '100%', h: hdrH,
    fill: { color: t.headerBg }, line: { width: 0 },
  });
  // Accent bottom line
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: hdrH - 0.06, w: '100%', h: 0.06,
    fill: { color: t.headerLine }, line: { width: 0 },
  });
  let titleX = 0.35;
  if (iconName) {
    const uri = getIconDataUri(iconName, t.headerText, 48);
    if (uri) {
      s.addImage({ data: uri, x: 0.18, y: (hdrH - 0.52) / 2, w: 0.52, h: 0.52 });
      titleX = 0.82;
    }
  }
  s.addText(strip(title || ''), {
    x: titleX, y: 0.06, w: W - titleX - 0.3, h: hdrH - 0.12,
    fontSize: 26, bold: true, color: t.headerText,
    fontFace: 'Arial', valign: 'middle', shrinkText: true,
  });
}

function drawFooter(pptx, s, t, pageNum, total, meta) {
  if (!DRAW_FOOTER) return; // Template merge mode: template handles footer
  // Bottom line
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: H - 0.35, w: '100%', h: 0.03,
    fill: { color: t.line, transparency: 50 }, line: { width: 0 },
  });
  // Page number
  s.addText(`${pageNum} / ${total}`, {
    x: W - 1.2, y: H - 0.32, w: 1.0, h: 0.28,
    fontSize: 9, color: t.dim, align: 'right',
  });
  // Meta info (date, author)
  if (meta) {
    s.addText(meta, {
      x: 0.2, y: H - 0.32, w: W - 2.0, h: 0.28,
      fontSize: 9, color: t.dim,
    });
  }
}

/** Content area boundaries (below header, above footer) */
function contentTop() { return Math.max(0.9, H * 0.14) + 0.15; }
function contentBottom() { return DRAW_FOOTER ? H - 0.4 : H - 0.15; }
function contentH() { return contentBottom() - contentTop(); }

// ── TITLE SLIDE ─────────────────────────────────────────────────────────────────
function renderTitle(pptx, s, d, t) {
  // Upper decorative block
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: '100%', h: 3.6,
    fill: { color: t.headerBg }, line: { width: 0 },
  });
  // Dark accent band (right)
  const navy = t.isDark ? '0A0F1E' : '142244';
  s.addShape(pptx.ShapeType.rect, {
    x: 7.2, y: 0, w: 2.8, h: 3.6,
    fill: { color: navy }, line: { width: 0 },
  });
  // Brand text (top right)
  s.addText(d.brand || 'FOXLINK', {
    x: 7.35, y: 0.22, w: 2.4, h: 0.55,
    fontSize: 22, bold: true, color: 'FFFFFF',
    fontFace: 'Arial', align: 'right',
  });
  // Accent line
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: 3.57, w: '100%', h: 0.1,
    fill: { color: t.line }, line: { width: 0 },
  });
  // Main title
  s.addText(strip(d.title || ''), {
    x: 0.5, y: 0.8, w: 6.5, h: 2.5,
    fontSize: 36, bold: true, color: 'FFFFFF',
    fontFace: 'Arial', valign: 'middle', lineSpacingMultiple: 1.2,
  });
  // Subtitle
  if (d.subtitle) {
    s.addText(strip(d.subtitle), {
      x: 0.5, y: 3.78, w: 9.0, h: 0.7,
      fontSize: 18, color: t.text, italic: true,
    });
  }
  // Author / date
  const meta = [d.date, d.author].filter(Boolean).join('   |   ');
  if (meta) {
    s.addText(meta, {
      x: 0.5, y: 4.95, w: 9.0, h: 0.28,
      fontSize: 12, color: t.dim,
    });
  }
}

// ── CLOSING SLIDE ───────────────────────────────────────────────────────────────
function renderClosing(pptx, s, d, t) {
  // Glow circles
  s.addShape(pptx.ShapeType.ellipse, {
    x: 3.0, y: 0.8, w: 4.0, h: 4.0,
    fill: { color: t.line, transparency: 85 }, line: { width: 0 },
  });
  s.addShape(pptx.ShapeType.ellipse, {
    x: 3.8, y: 1.6, w: 2.4, h: 2.4,
    fill: { color: t.line, transparency: 65 }, line: { width: 0 },
  });
  // Icon
  if (d.icon) {
    s.addText(d.icon, {
      x: 4.0, y: 1.5, w: 2.0, h: 1.0,
      fontSize: 48, align: 'center',
    });
  }
  // Title
  s.addText(strip(d.title || '感謝聆聽'), {
    x: 0.5, y: d.icon ? 2.6 : 2.0, w: 9.0, h: 1.2,
    fontSize: 38, bold: true, color: t.text, align: 'center',
  });
  // Divider
  s.addShape(pptx.ShapeType.rect, {
    x: 3.5, y: d.icon ? 3.85 : 3.3, w: 3.0, h: 0.05,
    fill: { color: t.accent }, line: { width: 0 },
  });
  // Subtitle
  if (d.subtitle) {
    s.addText(strip(d.subtitle), {
      x: 0.5, y: d.icon ? 4.0 : 3.5, w: 9.0, h: 0.7,
      fontSize: 16, color: t.accent, align: 'center', italic: true,
    });
  }
}

// ── SECTION BREAK ───────────────────────────────────────────────────────────────
function renderSection(pptx, s, d, t, pn, tot) {
  // Left accent bar
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.18, h: '100%',
    fill: { color: t.line }, line: { width: 0 },
  });
  s.addShape(pptx.ShapeType.rect, {
    x: 0.18, y: 0, w: 0.06, h: '100%',
    fill: { color: t.accent, transparency: 40 }, line: { width: 0 },
  });
  if (d.icon) {
    s.addText(d.icon, { x: 1.0, y: 1.5, w: 1.2, h: 1.0, fontSize: 48, align: 'center' });
  }
  s.addText(strip(d.title || ''), {
    x: d.icon ? 2.0 : 1.0, y: 1.8, w: 7.5, h: 1.2,
    fontSize: 36, bold: true, color: t.text,
  });
  if (d.subtitle) {
    s.addText(strip(d.subtitle), {
      x: d.icon ? 2.0 : 1.0, y: 3.1, w: 7.5, h: 0.7,
      fontSize: 18, color: t.accent, italic: true,
    });
  }
  drawFooter(pptx, s, t, pn, tot);
}

// ── BULLETS SLIDE ───────────────────────────────────────────────────────────────
function renderBullets(pptx, s, d, t, pn, tot, meta) {
  drawHeader(pptx, s, t, d.title, d.icon || null);
  let bodyY = 1.05;

  // Highlight box
  if (d.highlight) {
    const hlBg = t.isDark ? '1E3A5F' : 'FEF3C7';
    const hlBorder = t.isDark ? '3B82F6' : 'F59E0B';
    const hlText = t.isDark ? 'BFDBFE' : '854D0E';
    s.addShape(pptx.ShapeType.rect, {
      x: 0.35, y: bodyY, w: 9.3, h: 0.56,
      fill: { color: hlBg },
      line: { color: hlBorder, width: 1.5, dashType: 'dash' },
    });
    s.addText(strip(d.highlight), {
      x: 0.5, y: bodyY + 0.04, w: 9.1, h: 0.48,
      fontSize: 14, color: hlText, italic: true, bold: true, valign: 'middle',
    });
    bodyY += 0.66;
  }

  const bullets = sa(d.bullets || (d.content ? [d.content] : []));
  if (bullets.length > 0) {
    const items = bullets.map(b => ({
      text: b,
      options: {
        bullet: { type: 'bullet', indent: 15, color: t.accent },
        paraSpaceAfter: 5,
      },
    }));
    s.addText(items, {
      x: 0.4, y: bodyY, w: 9.2, h: H - bodyY - 0.4,
      fontSize: 17, color: t.text, valign: 'top', lineSpacingMultiple: 1.35,
    });
  }
  drawFooter(pptx, s, t, pn, tot, meta);
}

// ── TWO COLUMN SLIDE ────────────────────────────────────────────────────────────
function renderTwoCol(pptx, s, d, t, pn, tot, meta) {
  drawHeader(pptx, s, t, d.title, d.icon || null);
  // Vertical divider
  s.addShape(pptx.ShapeType.rect, {
    x: 4.95, y: 1.05, w: 0.04, h: 4.1,
    fill: { color: t.line, transparency: 50 }, line: { width: 0 },
  });
  // Left column
  s.addText(strip(d.left_title || ''), {
    x: 0.35, y: 1.05, w: 4.4, h: 0.45,
    fontSize: 15, bold: true, color: t.accent,
  });
  const lb = sa(d.left_bullets || []).map(b => ({ text: b, options: { bullet: true, paraSpaceAfter: 4 } }));
  s.addText(lb.length ? lb : [{ text: '' }], {
    x: 0.35, y: 1.55, w: 4.4, h: 3.6, fontSize: 14, color: t.text, valign: 'top',
  });
  // Right column
  s.addText(strip(d.right_title || ''), {
    x: 5.2, y: 1.05, w: 4.4, h: 0.45,
    fontSize: 15, bold: true, color: t.accent,
  });
  const rb = sa(d.right_bullets || []).map(b => ({ text: b, options: { bullet: true, paraSpaceAfter: 4 } }));
  s.addText(rb.length ? rb : [{ text: '' }], {
    x: 5.2, y: 1.55, w: 4.4, h: 3.6, fontSize: 14, color: t.text, valign: 'top',
  });
  drawFooter(pptx, s, t, pn, tot, meta);
}

// ── 3-COLUMN CARDS ──────────────────────────────────────────────────────────────
function render3Col(pptx, s, d, t, pn, tot, meta) {
  drawHeader(pptx, s, t, d.title, null);
  const cols = (d.columns || []).slice(0, 3);
  const colW = 2.92, colXs = [0.28, 3.54, 6.8], colY = 1.05, colH = 4.1;

  cols.forEach((col, ci) => {
    const cx = colXs[ci];
    s.addShape(pptx.ShapeType.rect, {
      x: cx, y: colY, w: colW, h: colH,
      fill: { color: t.cardBg }, line: { color: t.cardBorder, width: 1 },
    });
    s.addShape(pptx.ShapeType.rect, {
      x: cx, y: colY, w: colW, h: 0.07,
      fill: { color: t.accent }, line: { width: 0 },
    });
    let titleY = colY + 0.2;
    if (col.icon) {
      const uri = getIconDataUri(col.icon, t.isDark ? t.accent : t.headerBg, 48);
      if (uri) {
        s.addImage({ data: uri, x: cx + colW / 2 - 0.3, y: colY + 0.13, w: 0.6, h: 0.6 });
        titleY = colY + 0.8;
      }
    }
    s.addText(strip(col.title || ''), {
      x: cx + 0.1, y: titleY, w: colW - 0.2, h: 0.48,
      fontSize: 15, bold: true, color: t.isDark ? t.text : t.headerBg, align: 'center',
    });
    const cb = sa(col.bullets || []).map(b => ({
      text: b,
      options: { bullet: { type: 'bullet', indent: 10, color: t.accent }, paraSpaceAfter: 4 },
    }));
    if (cb.length > 0) {
      s.addText(cb, {
        x: cx + 0.15, y: titleY + 0.52, w: colW - 0.3, h: colH - (titleY - colY) - 0.62,
        fontSize: 14, color: t.text, valign: 'top',
      });
    }
  });
  drawFooter(pptx, s, t, pn, tot, meta);
}

// ── QUOTE SLIDE ─────────────────────────────────────────────────────────────────
function renderQuote(pptx, s, d, t, pn, tot) {
  s.addText('\u201C', {
    x: 0.3, y: 0.3, w: 1.5, h: 1.5,
    fontSize: 120, color: t.line, transparency: 40, fontFace: 'Georgia',
  });
  s.addText(strip(d.quote || ''), {
    x: 0.8, y: 1.2, w: 8.4, h: 2.8,
    fontSize: 22, color: t.text, italic: true, align: 'center',
    lineSpacingMultiple: 1.5, fontFace: 'Georgia',
  });
  s.addShape(pptx.ShapeType.rect, {
    x: 3.5, y: 4.1, w: 3.0, h: 0.05,
    fill: { color: t.accent }, line: { width: 0 },
  });
  if (d.author) {
    s.addText(`— ${strip(d.author)}`, {
      x: 0.5, y: 4.25, w: 9.0, h: 0.5,
      fontSize: 14, color: t.accent, align: 'center', bold: true,
    });
  }
}

// ── DASHBOARD SLIDE ─────────────────────────────────────────────────────────────
function renderDashboard(pptx, s, d, t, pn, tot, meta) {
  // Title area (no header bar — dashboard uses full slide)
  s.addText(strip(d.title || ''), {
    x: 0.4, y: 0.2, w: 9.2, h: 0.55,
    fontSize: 24, bold: true, color: t.text, fontFace: 'Arial',
  });
  if (d.subtitle) {
    s.addText(strip(d.subtitle), {
      x: 0.4, y: 0.72, w: 9.2, h: 0.3,
      fontSize: 12, color: t.dim,
    });
  }

  // KPI Cards
  const cards = (d.cards || []).slice(0, 6);
  const cardsY = 1.15;
  const cardsH = 1.1;
  const gap = 0.15;
  const totalGap = gap * (cards.length - 1);
  const availW = W - 0.6;
  const cardW = (availW - totalGap) / cards.length;
  const startX = 0.3;

  cards.forEach((card, i) => {
    const cx = startX + i * (cardW + gap);
    const cc = getCardColor(card.color || 'default', t.isDark);

    // Card background
    s.addShape(pptx.ShapeType.rect, {
      x: cx, y: cardsY, w: cardW, h: cardsH,
      fill: { color: cc.bg },
      line: { color: cc.border, width: 1.5 },
      rectRadius: 0.06,
    });
    // Top accent
    s.addShape(pptx.ShapeType.rect, {
      x: cx, y: cardsY, w: cardW, h: 0.05,
      fill: { color: cc.border }, line: { width: 0 },
    });
    // Number
    s.addText(strip(card.number || '0'), {
      x: cx, y: cardsY + 0.12, w: cardW, h: 0.55,
      fontSize: 32, bold: true, color: cc.num, align: 'center', fontFace: 'Arial',
    });
    // Label
    s.addText(strip(card.label || ''), {
      x: cx, y: cardsY + 0.68, w: cardW, h: 0.32,
      fontSize: 11, color: cc.text, align: 'center',
    });
  });

  // Optional section title + table below cards
  let tableY = cardsY + cardsH + 0.2;
  if (d.section_title) {
    s.addText(strip(d.section_title), {
      x: 0.4, y: tableY, w: 9.2, h: 0.35,
      fontSize: 14, bold: true, color: t.text,
    });
    tableY += 0.4;
  }

  if (d.table && d.table.rows && d.table.rows.length > 0) {
    _drawSimpleTable(s, t, d.table, 0.3, tableY, W - 0.6, H - tableY - 0.35);
  }

  drawFooter(pptx, s, t, pn, tot, meta);
}

// ── DATA TABLE SLIDE ────────────────────────────────────────────────────────────
function renderDataTable(pptx, s, d, t, pn, tot, meta) {
  drawHeader(pptx, s, t, d.title, d.icon || null);

  const columns = d.columns || [];
  const rows = d.rows || [];
  if (rows.length === 0) { drawFooter(pptx, s, t, pn, tot, meta); return; }

  // Build status color map from column definitions
  const statusColors = {};
  columns.forEach(col => {
    if (col.statusColors) Object.assign(statusColors, col.statusColors);
  });
  // Merge with defaults
  const colorMap = { ...STATUS_DEFAULTS, ...statusColors };

  // Calculate column widths
  const tableW = W - 0.6;
  const totalWeight = columns.reduce((sum, c) => sum + (c.width || 15), 0);
  const colWidths = columns.map(c => (c.width || 15) / totalWeight * tableW);

  // Build table data for pptxgenjs
  const tableData = [];

  // Header row
  tableData.push(columns.map((col, ci) => ({
    text: strip(col.name || col.header || ''),
    options: {
      bold: true,
      color: t.tableHeaderText,
      fill: { color: t.tableHeaderBg },
      fontSize: 11,
      align: ci === 0 ? 'left' : 'center',
      valign: 'middle',
    },
  })));

  // Data rows
  rows.forEach((row, ri) => {
    const cells = (Array.isArray(row) ? row : Object.values(row)).slice(0, columns.length);
    tableData.push(cells.map((cell, ci) => {
      const cellText = strip(cell);
      const col = columns[ci] || {};
      const isStatusCol = !!col.statusColors;

      // Find matching status color
      let cellColor = t.text;
      if (isStatusCol) {
        const lower = cellText.toLowerCase();
        for (const [key, color] of Object.entries(colorMap)) {
          if (lower.includes(key.toLowerCase())) {
            cellColor = color;
            break;
          }
        }
      }

      return {
        text: cellText,
        options: {
          color: cellColor,
          fill: { color: ri % 2 === 0 ? t.tableRowBg : t.tableAltBg },
          fontSize: 10,
          align: ci === 0 ? 'left' : 'center',
          valign: 'middle',
          bold: isStatusCol,
        },
      };
    }));
  });

  // Compute row height to fit available space
  const tableY = 1.0;
  const availH = H - tableY - 0.45;
  const rowH = Math.min(0.38, availH / tableData.length);

  s.addTable(tableData, {
    x: 0.3, y: tableY, w: tableW, colW: colWidths,
    rowH,
    border: { type: 'solid', pt: 0.5, color: t.tableBorder },
    autoPage: false,
    autoPageRepeatHeader: true,
  });

  // Legend row (from statusColors)
  const legendItems = Object.entries(colorMap).filter(([k]) => {
    const flat = rows.flat().join(' ').toLowerCase();
    return flat.includes(k.toLowerCase());
  });
  if (legendItems.length > 0) {
    const legendY = H - 0.32;
    let lx = 0.4;
    legendItems.forEach(([label, color]) => {
      // Color dot
      s.addShape(pptx.ShapeType.ellipse, {
        x: lx, y: legendY + 0.04, w: 0.12, h: 0.12,
        fill: { color }, line: { width: 0 },
      });
      s.addText(label, {
        x: lx + 0.16, y: legendY, w: 1.0, h: 0.2,
        fontSize: 8, color: t.dim,
      });
      lx += 1.0;
    });
  }

  drawFooter(pptx, s, t, pn, tot, meta);
}

// ── CHART SLIDE ─────────────────────────────────────────────────────────────────
function renderChart(pptx, s, d, t, pn, tot, meta) {
  drawHeader(pptx, s, t, d.title, d.icon || null);

  const chartTypeMap = {
    bar: pptx.charts.BAR,
    line: pptx.charts.LINE,
    pie: pptx.charts.PIE,
    doughnut: pptx.charts.DOUGHNUT,
    radar: pptx.charts.RADAR,
    area: pptx.charts.AREA,
    scatter: pptx.charts.SCATTER,
  };
  const chartType = chartTypeMap[(d.chartType || 'bar').toLowerCase()] || pptx.charts.BAR;
  const isPie = ['pie', 'doughnut'].includes((d.chartType || '').toLowerCase());

  const series = (d.data || []).map(s => ({
    name: s.name || '',
    labels: s.labels || [],
    values: (s.values || []).map(Number),
  }));

  if (series.length === 0) {
    s.addText('(無資料)', { x: 1, y: 2, w: 8, h: 1, fontSize: 16, color: t.dim, align: 'center' });
    drawFooter(pptx, s, t, pn, tot, meta);
    return;
  }

  const chartY = d.description ? 1.0 : 1.0;
  const chartH = d.description ? 3.2 : 4.0;

  const chartOpts = {
    x: 0.5, y: chartY, w: 9.0, h: chartH,
    chartColors: d.colors || t.chartColors,
    showTitle: false,
    showValue: d.showValue !== false,
    showLegend: d.showLegend !== false,
    legendPos: 'b',
    legendColor: t.dim,
    legendFontSize: 10,
  };

  if (!isPie) {
    Object.assign(chartOpts, {
      catAxisLabelColor: t.dim,
      catAxisLabelFontSize: 10,
      valAxisLabelColor: t.dim,
      valAxisLabelFontSize: 10,
      catAxisLineColor: t.isDark ? '334155' : 'E2E8F0',
      valAxisLineColor: t.isDark ? '334155' : 'E2E8F0',
      valGridLine: { color: t.isDark ? '1E293B' : 'F1F5F9', width: 1 },
    });
  } else {
    Object.assign(chartOpts, {
      showPercent: d.showPercent !== false,
      dataLabelColor: t.text,
      dataLabelFontSize: 10,
    });
  }

  s.addChart(chartType, series, chartOpts);

  if (d.description) {
    s.addText(strip(d.description), {
      x: 0.5, y: chartY + chartH + 0.15, w: 9.0, h: 0.5,
      fontSize: 12, color: t.dim, italic: true,
    });
  }

  drawFooter(pptx, s, t, pn, tot, meta);
}

// ── INFOGRAPHIC SLIDE ───────────────────────────────────────────────────────────
function renderInfographic(pptx, s, d, t, pn, tot, meta) {
  drawHeader(pptx, s, t, d.title, null);
  const items = (d.items || []).slice(0, 8);
  if (items.length === 0) { drawFooter(pptx, s, t, pn, tot, meta); return; }

  // Grid: up to 4 per row, max 2 rows
  const cols = Math.min(items.length, 4);
  const rows = Math.ceil(items.length / cols);
  const gap = 0.2;
  const totalW = W - 0.8;
  const itemW = (totalW - gap * (cols - 1)) / cols;
  const totalH = H - 1.5;
  const itemH = (totalH - gap * (rows - 1)) / rows;
  const startX = 0.4;
  const startY = 1.1;

  items.forEach((item, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const ix = startX + col * (itemW + gap);
    const iy = startY + row * (itemH + gap);
    const cc = getCardColor(item.color || 'default', t.isDark);

    // Card bg
    s.addShape(pptx.ShapeType.rect, {
      x: ix, y: iy, w: itemW, h: itemH,
      fill: { color: cc.bg },
      line: { color: cc.border, width: 1 },
      rectRadius: 0.06,
    });

    // Icon
    const iconColor = t.isDark ? cc.border : cc.border;
    if (item.icon) {
      const uri = getIconDataUri(item.icon, iconColor, 48);
      if (uri) {
        s.addImage({ data: uri, x: ix + itemW / 2 - 0.25, y: iy + 0.15, w: 0.5, h: 0.5 });
      }
    }

    const hasIcon = !!item.icon;
    // Big number
    s.addText(strip(item.number || ''), {
      x: ix, y: iy + (hasIcon ? 0.65 : 0.2), w: itemW, h: itemH * 0.35,
      fontSize: 28, bold: true, color: cc.num, align: 'center', fontFace: 'Arial',
    });
    // Label
    s.addText(strip(item.label || ''), {
      x: ix + 0.1, y: iy + (hasIcon ? 0.65 : 0.2) + itemH * 0.35, w: itemW - 0.2, h: 0.35,
      fontSize: 12, color: cc.text, align: 'center',
    });
    // Description (if provided)
    if (item.desc) {
      s.addText(strip(item.desc), {
        x: ix + 0.1, y: iy + itemH - 0.5, w: itemW - 0.2, h: 0.4,
        fontSize: 9, color: t.dim, align: 'center',
      });
    }
  });

  drawFooter(pptx, s, t, pn, tot, meta);
}

// ── TIMELINE SLIDE ──────────────────────────────────────────────────────────────
function renderTimeline(pptx, s, d, t, pn, tot, meta) {
  drawHeader(pptx, s, t, d.title, d.icon || null);
  const events = (d.events || []).slice(0, 6);
  if (events.length === 0) { drawFooter(pptx, s, t, pn, tot, meta); return; }

  const cTop = contentTop();
  const cBot = contentBottom();
  const cH = cBot - cTop;
  const n = events.length;
  const lineY = cTop + cH * 0.45; // timeline line at ~45% of content area
  const margin = 0.8;
  const startX = margin;
  const endX = W - margin;
  const step = (endX - startX) / (n - 1 || 1);

  // Horizontal line
  s.addShape(pptx.ShapeType.rect, {
    x: startX - 0.2, y: lineY, w: endX - startX + 0.4, h: 0.04,
    fill: { color: t.line }, line: { width: 0 },
  });

  const cardH = Math.min(cH * 0.35, 1.4);
  const connH = Math.min(cH * 0.1, 0.6);

  events.forEach((ev, i) => {
    const cx = n === 1 ? (startX + endX) / 2 : startX + i * step;
    const isAbove = i % 2 === 0;
    const dotColor = t.chartColors[i % t.chartColors.length];

    // Dot on timeline
    s.addShape(pptx.ShapeType.ellipse, {
      x: cx - 0.12, y: lineY - 0.1, w: 0.24, h: 0.24,
      fill: { color: dotColor }, line: { color: t.bg, width: 2 },
    });

    // Vertical connector
    if (isAbove) {
      s.addShape(pptx.ShapeType.rect, {
        x: cx - 0.01, y: lineY - connH, w: 0.02, h: connH - 0.1,
        fill: { color: t.dim, transparency: 50 }, line: { width: 0 },
      });
    } else {
      s.addShape(pptx.ShapeType.rect, {
        x: cx - 0.01, y: lineY + 0.14, w: 0.02, h: connH - 0.1,
        fill: { color: t.dim, transparency: 50 }, line: { width: 0 },
      });
    }

    // Content card — clamp within slide bounds
    const cardW = Math.min(step * 0.85, 1.8);
    let cardX = cx - cardW / 2;
    cardX = Math.max(0.1, Math.min(cardX, W - cardW - 0.1)); // clamp X
    const cardY = isAbove ? lineY - connH - cardH : lineY + connH + 0.04;

    s.addShape(pptx.ShapeType.rect, {
      x: cardX, y: cardY, w: cardW, h: cardH,
      fill: { color: t.cardBg },
      line: { color: dotColor, width: 1 },
      rectRadius: 0.04,
    });
    // Date
    s.addText(strip(ev.date || ''), {
      x: cardX + 0.05, y: cardY + 0.06, w: cardW - 0.1, h: 0.28,
      fontSize: 11, bold: true, color: dotColor, align: 'center',
    });
    // Title
    s.addText(strip(ev.title || ''), {
      x: cardX + 0.05, y: cardY + 0.32, w: cardW - 0.1, h: 0.38,
      fontSize: 13, bold: true, color: t.text, align: 'center', shrinkText: true,
    });
    // Description
    if (ev.desc) {
      s.addText(strip(ev.desc), {
        x: cardX + 0.05, y: cardY + 0.68, w: cardW - 0.1, h: cardH - 0.75,
        fontSize: 10, color: t.dim, align: 'center', shrinkText: true,
      });
    }
  });

  drawFooter(pptx, s, t, pn, tot, meta);
}

// ── COMPARISON SLIDE ────────────────────────────────────────────────────────────
function renderComparison(pptx, s, d, t, pn, tot, meta) {
  drawHeader(pptx, s, t, d.title, d.icon || null);
  const left = d.left || {};
  const right = d.right || {};

  const colW = 4.35;
  const colH = 4.0;
  const colY = 1.1;
  const panels = [
    { data: left, x: 0.35 },
    { data: right, x: 5.3 },
  ];

  // VS badge
  s.addShape(pptx.ShapeType.ellipse, {
    x: 4.6, y: 2.6, w: 0.8, h: 0.8,
    fill: { color: t.headerBg }, line: { color: t.line, width: 2 },
  });
  s.addText('VS', {
    x: 4.6, y: 2.6, w: 0.8, h: 0.8,
    fontSize: 14, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle',
  });

  panels.forEach(({ data: panel, x }) => {
    const panelColor = panel.color || 'blue';
    const cc = getCardColor(panelColor, t.isDark);

    // Card background
    s.addShape(pptx.ShapeType.rect, {
      x, y: colY, w: colW, h: colH,
      fill: { color: t.cardBg },
      line: { color: cc.border, width: 1.5 },
      rectRadius: 0.06,
    });
    // Top color bar
    s.addShape(pptx.ShapeType.rect, {
      x, y: colY, w: colW, h: 0.06,
      fill: { color: cc.border }, line: { width: 0 },
    });

    let titleY = colY + 0.2;
    // Icon
    if (panel.icon) {
      const uri = getIconDataUri(panel.icon, cc.border, 48);
      if (uri) {
        s.addImage({ data: uri, x: x + colW / 2 - 0.3, y: colY + 0.15, w: 0.6, h: 0.6 });
        titleY = colY + 0.8;
      }
    }
    // Title
    s.addText(strip(panel.title || ''), {
      x: x + 0.1, y: titleY, w: colW - 0.2, h: 0.4,
      fontSize: 16, bold: true, color: cc.num, align: 'center',
    });

    // Items
    const items = sa(panel.items || []).map(b => ({
      text: b,
      options: { bullet: { type: 'bullet', indent: 10, color: cc.border }, paraSpaceAfter: 4 },
    }));
    if (items.length > 0) {
      s.addText(items, {
        x: x + 0.15, y: titleY + 0.5, w: colW - 0.3, h: colH - (titleY - colY) - 0.6,
        fontSize: 13, color: t.text, valign: 'top',
      });
    }
  });

  drawFooter(pptx, s, t, pn, tot, meta);
}

// ── PROCESS FLOW SLIDE ──────────────────────────────────────────────────────────
function renderProcessFlow(pptx, s, d, t, pn, tot, meta) {
  drawHeader(pptx, s, t, d.title, d.icon || null);
  const steps = (d.steps || []).slice(0, 5);
  if (steps.length === 0) { drawFooter(pptx, s, t, pn, tot, meta); return; }

  const n = steps.length;
  const arrowW = 0.32;
  const totalW = 9.44;
  const boxW = (totalW - arrowW * (n - 1)) / n;
  const startX = 0.28;
  const boxY = 1.2;
  const boxH = 3.9;

  steps.forEach((step, si) => {
    const bx = startX + si * (boxW + arrowW);
    const stepColor = t.chartColors[si % t.chartColors.length];

    // Card
    s.addShape(pptx.ShapeType.rect, {
      x: bx, y: boxY, w: boxW, h: boxH,
      fill: { color: t.cardBg },
      line: { color: stepColor, width: 1.5 },
      rectRadius: 0.04,
    });
    // Top accent
    s.addShape(pptx.ShapeType.rect, {
      x: bx, y: boxY, w: boxW, h: 0.08,
      fill: { color: stepColor }, line: { width: 0 },
    });
    // Number badge
    s.addShape(pptx.ShapeType.ellipse, {
      x: bx + boxW / 2 - 0.25, y: boxY + 0.18, w: 0.5, h: 0.5,
      fill: { color: stepColor }, line: { width: 0 },
    });
    s.addText(String(si + 1), {
      x: bx + boxW / 2 - 0.25, y: boxY + 0.18, w: 0.5, h: 0.5,
      fontSize: 16, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle',
    });

    let descY = boxY + 0.78;
    if (step.icon) {
      const uri = getIconDataUri(step.icon, stepColor, 48);
      if (uri) {
        s.addImage({ data: uri, x: bx + boxW / 2 - 0.25, y: boxY + 0.75, w: 0.5, h: 0.5 });
        descY = boxY + 1.35;
      }
    }

    // Step title
    s.addText(strip(step.title || ''), {
      x: bx + 0.08, y: descY, w: boxW - 0.16, h: 0.5,
      fontSize: 13, bold: true, color: t.isDark ? t.text : t.headerBg, align: 'center', valign: 'middle',
      lineSpacingMultiple: 1.15,
    });
    // Description
    if (step.desc) {
      s.addText(strip(step.desc), {
        x: bx + 0.1, y: descY + 0.55, w: boxW - 0.2, h: boxH - (descY - boxY) - 0.65,
        fontSize: 10, color: t.dim, align: 'center', valign: 'top', lineSpacingMultiple: 1.3,
      });
    }

    // Arrow
    if (si < n - 1) {
      s.addText('\u25B6', {
        x: bx + boxW + 0.01, y: boxY + boxH / 2 - 0.2, w: arrowW - 0.02, h: 0.4,
        fontSize: 15, color: t.line, align: 'center', valign: 'middle',
      });
    }
  });

  drawFooter(pptx, s, t, pn, tot, meta);
}

// ── IMAGE + TEXT SLIDE ──────────────────────────────────────────────────────────
function renderImageText(pptx, s, d, t, pn, tot, meta) {
  drawHeader(pptx, s, t, d.title, d.icon || null);

  const isLeftImage = d.layout !== 'text_left';
  const imgX = isLeftImage ? 0.3 : 5.3;
  const txtX = isLeftImage ? 5.1 : 0.3;

  // Image placeholder (icon-based since AI can't generate actual images)
  if (d.image_icon) {
    const uri = getIconDataUri(d.image_icon, t.accent, 96);
    if (uri) {
      s.addImage({ data: uri, x: imgX + 1.4, y: 2.0, w: 1.5, h: 1.5 });
    }
  }
  // Image area card
  s.addShape(pptx.ShapeType.rect, {
    x: imgX, y: 1.1, w: 4.4, h: 3.9,
    fill: { color: t.cardBg },
    line: { color: t.cardBorder, width: 1, dashType: 'dash' },
    rectRadius: 0.06,
  });
  if (d.image_caption) {
    s.addText(strip(d.image_caption), {
      x: imgX + 0.1, y: 4.2, w: 4.2, h: 0.4,
      fontSize: 10, color: t.dim, align: 'center', italic: true,
    });
  }

  // Text content
  s.addText(strip(d.subtitle || ''), {
    x: txtX, y: 1.1, w: 4.4, h: 0.4,
    fontSize: 14, bold: true, color: t.accent,
  });
  const bullets = sa(d.bullets || []).map(b => ({
    text: b,
    options: { bullet: { type: 'bullet', indent: 10, color: t.accent }, paraSpaceAfter: 4 },
  }));
  if (bullets.length > 0) {
    s.addText(bullets, {
      x: txtX, y: 1.6, w: 4.4, h: 3.5,
      fontSize: 13, color: t.text, valign: 'top',
    });
  }

  drawFooter(pptx, s, t, pn, tot, meta);
}

// ── Simple Table Helper (for dashboard sub-table) ───────────────────────────────
function _drawSimpleTable(s, t, tableData, x, y, w, maxH) {
  const headers = tableData.headers || [];
  const rows = tableData.rows || [];
  if (rows.length === 0) return;

  const nCols = headers.length || (rows[0] ? rows[0].length : 0);
  const colW = Array(nCols).fill(w / nCols);

  const allRows = [];
  // Header
  if (headers.length > 0) {
    allRows.push(headers.map(h => ({
      text: strip(h),
      options: {
        bold: true, color: t.tableHeaderText,
        fill: { color: t.tableHeaderBg },
        fontSize: 10, align: 'center', valign: 'middle',
      },
    })));
  }
  // Data
  rows.forEach((row, ri) => {
    const cells = (Array.isArray(row) ? row : Object.values(row)).slice(0, nCols);
    allRows.push(cells.map((cell, ci) => ({
      text: strip(cell),
      options: {
        color: t.text, fontSize: 10,
        fill: { color: ri % 2 === 0 ? t.tableRowBg : t.tableAltBg },
        align: ci === 0 ? 'left' : 'center',
        valign: 'middle',
      },
    })));
  });

  const rowH = Math.min(0.35, maxH / allRows.length);
  s.addTable(allRows, {
    x, y, w, colW, rowH,
    border: { type: 'solid', pt: 0.5, color: t.tableBorder },
    autoPage: false,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Render rich slides into a PptxGenJS instance.
 * @param {import('pptxgenjs')} pptx - PptxGenJS instance (already configured)
 * @param {object} data - Rich slide JSON data
 * @param {string} [data.theme] - 'dark' | 'light' | 'corporate'
 * @param {string} [data.author]
 * @param {string} [data.date]
 * @param {string} [data.brand] - Brand name for title slide (default: FOXLINK)
 * @param {Array}  data.slides - Array of slide objects
 */
function renderRichSlides(pptx, data) {
  const themeName = data.theme || 'dark';
  const theme = THEMES[themeName] || THEMES.dark;
  const slides = data.slides || [];
  const total = slides.length;
  const author = data.author || '';
  const date = data.date || '';
  const meta = [date, author].filter(Boolean).join('  |  ');

  for (let i = 0; i < slides.length; i++) {
    const d = slides[i];
    // Normalize title field — AI sometimes returns slide_title instead of title
    if (!d.title && d.slide_title) d.title = d.slide_title;
    const s = pptx.addSlide();
    s.background = { color: theme.bg };
    const pn = i + 1;

    // Inject brand into title/closing slides
    if (!d.brand && data.brand) d.brand = data.brand;
    if (!d.author && author) d.author = author;
    if (!d.date && date) d.date = date;

    switch (d.type) {
      case 'title':        renderTitle(pptx, s, d, theme); break;
      case 'closing':      renderClosing(pptx, s, d, theme); break;
      case 'section':      renderSection(pptx, s, d, theme, pn, total); break;
      case 'bullets':      renderBullets(pptx, s, d, theme, pn, total, meta); break;
      case 'two_col':      renderTwoCol(pptx, s, d, theme, pn, total, meta); break;
      case '3col':         render3Col(pptx, s, d, theme, pn, total, meta); break;
      case 'quote':        renderQuote(pptx, s, d, theme, pn, total); break;
      case 'dashboard':    renderDashboard(pptx, s, d, theme, pn, total, meta); break;
      case 'data_table':   renderDataTable(pptx, s, d, theme, pn, total, meta); break;
      case 'chart':        renderChart(pptx, s, d, theme, pn, total, meta); break;
      case 'infographic':  renderInfographic(pptx, s, d, theme, pn, total, meta); break;
      case 'timeline':     renderTimeline(pptx, s, d, theme, pn, total, meta); break;
      case 'comparison':   renderComparison(pptx, s, d, theme, pn, total, meta); break;
      case 'process_flow': renderProcessFlow(pptx, s, d, theme, pn, total, meta); break;
      case 'image_text':   renderImageText(pptx, s, d, theme, pn, total, meta); break;
      default:
        // Fallback to bullets for unknown types
        renderBullets(pptx, s, d, theme, pn, total, meta);
        break;
    }

    if (d.notes) s.addNotes(strip(d.notes));
  }
}

/**
 * Render ONLY inner slides (no title/closing) — used by template merge path.
 * Returns number of slides added.
 */
function renderRichInnerSlides(pptx, slidesArray, themeName, options = {}) {
  // Allow caller to override slide dimensions and footer
  const prevW = W, prevH = H, prevFooter = DRAW_FOOTER;
  if (options.width)  W = options.width;
  if (options.height) H = options.height;
  if (options.noFooter) DRAW_FOOTER = false;

  try {
    const theme = THEMES[themeName] || THEMES.dark;
    const total = slidesArray.length;
    const meta = '';

    for (let i = 0; i < slidesArray.length; i++) {
      const d = slidesArray[i];
      // Normalize title field — AI sometimes returns slide_title instead of title
      if (!d.title && d.slide_title) d.title = d.slide_title;
      console.log(`[RichRenderer] slide ${i + 1}: type=${d.type}, title="${(d.title || '').substring(0, 40)}", keys=${Object.keys(d).join(',')}`);
      const s = pptx.addSlide();
      s.background = { color: theme.bg };
      const pn = i + 1;

      switch (d.type) {
        case 'dashboard':    renderDashboard(pptx, s, d, theme, pn, total, meta); break;
        case 'data_table':   renderDataTable(pptx, s, d, theme, pn, total, meta); break;
        case 'chart':        renderChart(pptx, s, d, theme, pn, total, meta); break;
        case 'infographic':  renderInfographic(pptx, s, d, theme, pn, total, meta); break;
        case 'timeline':     renderTimeline(pptx, s, d, theme, pn, total, meta); break;
        case 'comparison':   renderComparison(pptx, s, d, theme, pn, total, meta); break;
        case 'process_flow': renderProcessFlow(pptx, s, d, theme, pn, total, meta); break;
        case 'image_text':   renderImageText(pptx, s, d, theme, pn, total, meta); break;
        case 'bullets':      renderBullets(pptx, s, d, theme, pn, total, meta); break;
        case 'two_col':      renderTwoCol(pptx, s, d, theme, pn, total, meta); break;
        case '3col':         render3Col(pptx, s, d, theme, pn, total, meta); break;
        case 'quote':        renderQuote(pptx, s, d, theme, pn, total); break;
        case 'section':      renderSection(pptx, s, d, theme, pn, total); break;
        default:             renderBullets(pptx, s, d, theme, pn, total, meta); break;
      }
      if (d.notes) s.addNotes(strip(d.notes));
    }
    return slidesArray.length;
  } finally {
    // Always restore globals — prevents stale values on error
    W = prevW; H = prevH; DRAW_FOOTER = prevFooter;
  }
}

module.exports = {
  renderRichSlides,
  renderRichInnerSlides,
  THEMES,
  ICON_NAMES,
};
