const path = require('path');
const fs = require('fs');
const { Worker, isMainThread } = require('worker_threads');

/**
 * Strip inline markdown symbols from a text line.
 * Removes **bold**, *italic*, __bold__, _italic_, `code`, and leading ● bullets.
 */
function stripInlineMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/gs, '$1')   // **bold**
    .replace(/\*(.+?)\*/gs, '$1')        // *italic*
    .replace(/__(.+?)__/gs, '$1')        // __bold__
    .replace(/_(.+?)_/gs, '$1')          // _italic_
    .replace(/`([^`]+)`/g, '$1')         // `code`
    .replace(/^[●•]\s*/u, '')            // leading bullet ●•
    .trim();
}

const { UPLOAD_DIR } = require('../config/paths');

// CPU-intensive types that should run in a worker thread
const WORKER_TYPES = new Set(['pdf', 'pptx', 'docx', 'foxlink_pptx', 'rich_pptx']);

/**
 * Run a CPU-intensive file generation in a dedicated worker thread.
 * Returns a Promise that resolves with the output file path.
 */
function runInWorker(type, filename, content, sessionId) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '../workers/fileGenWorker.js'), {
      workerData: { type, filename, content, sessionId },
    });
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error(`[FileGen] Worker timeout for type=${type}`));
    }, 5 * 60 * 1000); // 5 minutes max

    worker.on('message', (msg) => {
      clearTimeout(timeout);
      if (msg.success) resolve(msg.outputPath);
      else reject(new Error(msg.error));
    });
    worker.on('error', (err) => { clearTimeout(timeout); reject(err); });
    worker.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}

/**
 * Parse generate blocks from AI response text
 * Returns array of { type, filename, content, filePath, publicUrl }
 */
async function processGenerateBlocks(responseText, sessionId) {
  const blocks = [];
  const regex = /```generate_(\w+):([^\n]+)\n([\s\S]*?)```/g;
  let match;
  let matchCount = 0;

  console.log(`[FileGen] processGenerateBlocks: responseText.length=${responseText.length}`);

  while ((match = regex.exec(responseText)) !== null) {
    matchCount++;
    const type = match[1]; // xlsx, docx, pdf, pptx, txt
    // Strip trailing metadata AI may append (space, [, backtick).
    // Note: do NOT split on `{` — it breaks {{date}} and other template variables.
    const filename = match[2].trim().split(/[\s\[\`]/)[0];
    const content = match[3].trim();
    console.log(`[FileGen] Block #${matchCount}: type=${type}, filename=${filename}, content.length=${content.length}`);

    try {
      const filePath = await generateFile(type, filename, content, sessionId);
      if (filePath) {
        const publicUrl = `/uploads/generated/${path.basename(filePath)}`;
        blocks.push({ type, filename, filePath, publicUrl });
        console.log(`[FileGen] Generated: ${publicUrl}`);
      }
    } catch (e) {
      console.error(`[FileGen] Error generating ${type} file:`, e.message);
      console.error(`[FileGen] Stack:`, e.stack);
    }
  }

  if (matchCount === 0) {
    console.log(`[FileGen] No generate blocks found in response`);
  }

  return blocks;
}

const EXT_BY_TYPE = {
  xlsx: '.xlsx',
  docx: '.docx',
  pdf: '.pdf',
  pptx: '.pptx',
  foxlink_pptx: '.pptx',
  rich_pptx: '.pptx',
  txt: '.txt',
};

async function generateFile(type, filename, content, sessionId) {
  // Offload CPU-intensive generation to worker thread (main thread only)
  if (isMainThread && WORKER_TYPES.has(type)) {
    return runInWorker(type, filename, content, sessionId);
  }

  const outputDir = path.join(UPLOAD_DIR, 'generated');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = Date.now();
  // 強制副檔名對齊 type：避免 UI 檔名寫 .pdf 但 type=docx 時寫出騙人的副檔名
  const baseFilename = filename.replace(/\.[a-zA-Z0-9]{2,5}$/, '');
  const safeFilename = baseFilename.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
  const ext = EXT_BY_TYPE[type] || '';
  const outputPath = path.join(outputDir, `${timestamp}_${safeFilename}${ext}`);

  switch (type) {
    case 'xlsx':
      return await generateXlsx(content, outputPath);
    case 'docx':
      return await generateDocx(content, outputPath);
    case 'pdf':
      return await generatePdf(content, outputPath);
    case 'pptx':
      return await generatePptx(content, outputPath);
    case 'foxlink_pptx':
      return await generateFoxlinkPptx(content, outputPath);
    case 'rich_pptx':
      return await generateRichPptx(content, outputPath);
    case 'txt': {
      // Strip markdown symbols from each line
      const cleanTxt = content.split('\n').map((line) => {
        if (line.startsWith('# ')) return line.slice(2);
        if (line.startsWith('## ')) return line.slice(3);
        if (line.startsWith('### ')) return line.slice(4);
        if (line.startsWith('- ') || line.startsWith('* ')) return '• ' + stripInlineMarkdown(line.slice(2));
        if (/^[●•]\s/.test(line)) return '• ' + stripInlineMarkdown(line.replace(/^[●•]\s*/, ''));
        return stripInlineMarkdown(line);
      }).join('\n');
      fs.writeFileSync(outputPath, cleanTxt, 'utf-8');
      return outputPath;
    }
    default:
      return null;
  }
}

async function generateXlsx(content, outputPath) {
  const ExcelJS = require('exceljs');
  let data;
  try {
    // Strip any leading description text the AI might prepend (e.g. "JSON 陣列: ")
    const jsonStr = content.replace(/^[^[{]*/s, '').replace(/[^}\]]*$/s, '');
    data = JSON.parse(jsonStr);
  } catch (e) {
    console.error('[FileGen] xlsx JSON parse failed, content snippet:', content.slice(0, 200));
    data = [{ sheetName: 'Sheet1', data: content.split('\n').map((r) => r.split(',')) }];
  }
  if (!Array.isArray(data)) data = [data];

  const wb = new ExcelJS.Workbook();

  // Header style
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }; // blue-600
  const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  const headerAlignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
  const borderStyle = { style: 'thin', color: { argb: 'FF94A3B8' } }; // slate-400 - visible border
  const cellBorder = { top: borderStyle, left: borderStyle, bottom: borderStyle, right: borderStyle };
  const altFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }; // blue-100

  for (const sheet of data) {
    const rows = sheet.data || [];
    if (rows.length === 0) continue;

    const ws = wb.addWorksheet(sheet.sheetName || 'Sheet1');

    // Track max content length per column for auto-fit
    const colWidths = [];

    rows.forEach((row, rIdx) => {
      const wsRow = ws.addRow(row.map((v) => v ?? ''));
      if (rIdx === 0) wsRow.height = 24; // header fixed height

      row.forEach((cell, cIdx) => {
        const wsCell = wsRow.getCell(cIdx + 1);
        const cellStr = String(cell ?? '');

        // Column width: CJK chars count as 2, cap at 60, min 12
        const len = [...cellStr].reduce((acc, c) => acc + (c.charCodeAt(0) > 127 ? 2 : 1), 0);
        colWidths[cIdx] = Math.min(60, Math.max(colWidths[cIdx] || 12, len + 2));

        // Borders on all cells
        wsCell.border = cellBorder;

        if (rIdx === 0) {
          // Header row
          wsCell.fill = headerFill;
          wsCell.font = headerFont;
          wsCell.alignment = headerAlignment;
        } else {
          wsCell.font = { size: 11 };
          wsCell.alignment = { vertical: 'top', wrapText: true };
          // Alternating row background (odd data rows: 1,3,5...)
          if (rIdx % 2 === 1) {
            wsCell.fill = altFill;
          }
        }
      });
    });

    // Apply column widths
    colWidths.forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });

    // Freeze header row
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }

  await wb.xlsx.writeFile(outputPath);
  return outputPath;
}

async function generateDocx(content, outputPath) {
  console.log(`[FileGen] generateDocx: ${content.length} chars → ${path.basename(outputPath)}`);
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');

  const lines = content.split('\n');
  const children = [];

  for (const line of lines) {
    if (line.startsWith('# ')) {
      children.push(new Paragraph({ text: stripInlineMarkdown(line.slice(2)), heading: HeadingLevel.HEADING_1 }));
    } else if (line.startsWith('## ')) {
      children.push(new Paragraph({ text: stripInlineMarkdown(line.slice(3)), heading: HeadingLevel.HEADING_2 }));
    } else if (line.startsWith('### ')) {
      children.push(new Paragraph({ text: stripInlineMarkdown(line.slice(4)), heading: HeadingLevel.HEADING_3 }));
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      children.push(new Paragraph({ text: stripInlineMarkdown(line.slice(2)), bullet: { level: 0 } }));
    } else if (/^[●•]\s/.test(line)) {
      children.push(new Paragraph({ text: stripInlineMarkdown(line.replace(/^[●•]\s*/, '')), bullet: { level: 0 } }));
    } else {
      children.push(new Paragraph({ children: [new TextRun(stripInlineMarkdown(line))] }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

// Render a text line with clickable hyperlinks
// Supports: [text](url), (url), and bare https://... URLs
function renderLineWithLinks(doc, text) {
  // Order matters: markdown links first, then parenthesized URLs, then bare URLs
  const tokenRe = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|\(\s*(https?:\/\/[^\s)]+)\s*\)|(https?:\/\/[^\s,;)）\]<]+)/g;
  const parts = [];
  let cursor = 0;
  let match;

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push({ type: 'text', value: text.slice(cursor, match.index) });
    }
    if (match[1]) {
      // Markdown link [text](url)
      parts.push({ type: 'link', display: match[1], url: match[2] });
    } else if (match[3]) {
      // Parenthesized URL (url)
      parts.push({ type: 'link', display: match[3], url: match[3] });
    } else if (match[4]) {
      // Bare URL https://...
      parts.push({ type: 'link', display: match[4], url: match[4] });
    }
    cursor = match.index + match[0].length;
  }

  if (parts.length === 0) return false; // no links found
  if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) });

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    if (part.type === 'link') {
      doc.fillColor('#1d4ed8').text(part.display, { link: part.url, underline: true, continued: !isLast });
    } else {
      doc.fillColor('#1a1a1a').text(part.value, { continued: !isLast });
    }
  }
  doc.fillColor('#1a1a1a'); // reset color
  return true;
}

async function generatePdf(content, outputPath) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ margin: 50 });
  const stream = fs.createWriteStream(outputPath);

  return new Promise((resolve, reject) => {
    doc.pipe(stream);

    // CJK font search order: bundled → Windows system → Linux system
    const fontPaths = [
      // Bundled fonts (place in server/fonts/ or project root fonts/)
      path.join(__dirname, '../fonts/NotoSansTC-Regular.ttf'),
      path.join(__dirname, '../fonts/NotoSansTC-Regular.otf'),
      path.join(__dirname, '../fonts/NotoSansCJK-Regular.ttc'),
      // Docker: mounted from ./fonts → /app/fonts/
      '/app/fonts/NotoSansTC-Regular.ttf',
      '/app/fonts/NotoSansTC-Regular.otf',
      // Windows system fonts (TTF format for pdfkit compatibility)
      'C:\\Windows\\Fonts\\kaiu.ttf',      // DFKai-SB 標楷體 (繁中) ✓
      'C:\\Windows\\Fonts\\simhei.ttf',    // 黑體 (簡中)
      'C:\\Windows\\Fonts\\simfang.ttf',   // 仿宋 (簡中)
      'C:\\Windows\\Fonts\\simsun.ttf',    // 宋體 (簡中)
      // Linux / Docker fonts (Debian/Ubuntu paths)
      '/usr/share/fonts/truetype/arphic/uming.ttf',
      '/usr/share/fonts/truetype/arphic/ukai.ttf',
      '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttf',
      '/usr/share/fonts/truetype/wqy/wqy-microhei.ttf',
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      // Alpine Linux paths (apk add font-wqy-zenhei from community repo)
      '/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttf',
      '/usr/share/fonts/wqy-microhei/wqy-microhei.ttf',
      // Alpine: wget downloaded to app/fonts/
      path.join(__dirname, '../fonts/NotoSansCJKtc-Regular.otf'),
    ];
    let fontLoaded = false;
    for (const fp of fontPaths) {
      if (!fs.existsSync(fp)) continue;
      try {
        doc.font(fp);
        console.log(`[FileGen] PDF font loaded: ${fp}`);
        fontLoaded = true;
        break;
      } catch (e) {
        console.warn(`[FileGen] Font ${path.basename(fp)} failed (${e.message}), trying next...`);
      }
    }
    if (!fontLoaded) {
      console.warn('[FileGen] No CJK font loaded - PDF may show garbled Chinese. Add NotoSansTC-Regular.ttf to server/fonts/');
    }

    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('# ')) {
        doc.fontSize(20).text(stripInlineMarkdown(line.slice(2))).moveDown(0.5);
        doc.fontSize(12);
      } else if (line.startsWith('## ')) {
        doc.fontSize(16).text(stripInlineMarkdown(line.slice(3))).moveDown(0.3);
        doc.fontSize(12);
      } else if (line.startsWith('### ')) {
        doc.fontSize(14).text(stripInlineMarkdown(line.slice(4))).moveDown(0.3);
        doc.fontSize(12);
      } else if (line.trim() === '') {
        doc.moveDown(0.5);
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        const t = '• ' + stripInlineMarkdown(line.slice(2));
        if (!renderLineWithLinks(doc, t)) doc.text(t);
      } else if (/^[●•]\s/.test(line)) {
        const t = '• ' + stripInlineMarkdown(line.replace(/^[●•]\s*/, ''));
        if (!renderLineWithLinks(doc, t)) doc.text(t);
      } else {
        const t = stripInlineMarkdown(line);
        if (!renderLineWithLinks(doc, t)) doc.text(t);
      }
    }

    doc.end();
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

async function generatePptx(content, outputPath) {
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();

  // Slide dimensions: 10" x 5.625" (widescreen 16:9)
  pptx.layout = 'LAYOUT_WIDE';

  let data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    data = { slides: [{ type: 'title', title: 'Presentation', subtitle: content.slice(0, 100) }] };
  }

  // Strip markdown from all text fields in a slide object
  function cleanSlide(slide) {
    const s = (v) => (typeof v === 'string' ? stripInlineMarkdown(v) : v);
    const sa = (arr) => (Array.isArray(arr) ? arr.map(s) : arr);
    return {
      ...slide,
      title: s(slide.title),
      subtitle: s(slide.subtitle),
      content: s(slide.content),
      highlight: s(slide.highlight),
      left_title: s(slide.left_title),
      right_title: s(slide.right_title),
      quote: s(slide.quote),
      author: s(slide.author),
      bullets: sa(slide.bullets),
      items: sa(slide.items),
      left_bullets: sa(slide.left_bullets),
      right_bullets: sa(slide.right_bullets),
    };
  }

  const slides = (data.slides || []).map(cleanSlide);

  // Theme definitions: bg=background, header=header bar, text=body text, accent=highlight, dim=muted
  const themes = {
    corporate: { bg: '1e3a5f', header: '2563eb', text: 'FFFFFF', accent: '93c5fd', dim: '94a3b8', line: '3b82f6', dark: true },
    blue:      { bg: '1d4ed8', header: '1e40af', text: 'FFFFFF', accent: 'bfdbfe', dim: '93c5fd', line: '60a5fa', dark: true },
    dark:      { bg: '0f172a', header: '1e293b', text: 'e2e8f0', accent: '38bdf8', dim: '64748b', line: '0ea5e9', dark: true },
    green:     { bg: '14532d', header: '15803d', text: 'FFFFFF', accent: '86efac', dim: '4ade80', line: '22c55e', dark: true },
    orange:    { bg: '7c2d12', header: 'c2410c', text: 'FFFFFF', accent: 'fdba74', dim: 'fb923c', line: 'f97316', dark: true },
    purple:    { bg: '4c1d95', header: '7e22ce', text: 'FFFFFF', accent: 'd8b4fe', dim: 'a78bfa', line: '8b5cf6', dark: true },
    // Light themes
    white:     { bg: 'FFFFFF', header: '1e3a5f', text: '1e293b', accent: '2563eb', dim: '94a3b8', line: '3b82f6', dark: false },
    light:     { bg: 'f8fafc', header: '1e40af', text: '1e293b', accent: '2563eb', dim: '94a3b8', line: '3b82f6', dark: false },
    light_green:  { bg: 'f0fdf4', header: '15803d', text: '14532d', accent: '16a34a', dim: '86efac', line: '22c55e', dark: false },
    light_purple: { bg: 'faf5ff', header: '7e22ce', text: '4c1d95', accent: '7c3aed', dim: 'd8b4fe', line: '8b5cf6', dark: false },
  };

  // Resolve global theme (fallback: corporate)
  const globalThemeName = data.global_theme || 'corporate';
  const globalTheme = themes[globalThemeName] || themes.corporate;

  function resolveTheme(slide) {
    return themes[slide.theme] || globalTheme;
  }

  // Helper: draw header bar with optional icon
  function drawHeader(s, t, title, icon) {
    // Header gradient bar
    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: '100%', h: 0.95,
      fill: { color: t.header },
      line: { width: 0 },
    });
    // Accent bottom line
    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0.92, w: '100%', h: 0.06,
      fill: { color: t.line },
      line: { width: 0 },
    });
    // Icon + title
    const iconStr = icon ? `${icon}  ` : '';
    s.addText(`${iconStr}${title}`, {
      x: 0.3, y: 0.08, w: 9.2, h: 0.78,
      fontSize: 22, bold: true, color: 'FFFFFF',
      fontFace: 'Arial',
    });
  }

  // Helper: slide number footer
  function drawFooter(s, t, pageNum, total) {
    s.addText(`${pageNum} / ${total}`, {
      x: 8.8, y: 5.3, w: 1.0, h: 0.25,
      fontSize: 9, color: t.dim, align: 'right',
    });
    // Bottom accent line
    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: 5.55, w: '100%', h: 0.04,
      fill: { color: t.line, transparency: 60 },
      line: { width: 0 },
    });
  }

  const total = slides.length;

  for (let idx = 0; idx < slides.length; idx++) {
    const slide = slides[idx];
    const s = pptx.addSlide();
    const t = resolveTheme(slide);

    s.background = { color: t.bg };

    switch (slide.type) {

      // ── TITLE SLIDE ──────────────────────────────────────────
      case 'title': {
        // Decorative diagonal band
        s.addShape(pptx.ShapeType.rect, {
          x: 0, y: 3.8, w: '100%', h: 1.85,
          fill: { color: t.header, transparency: 30 },
          line: { width: 0 },
        });
        // Top accent line
        s.addShape(pptx.ShapeType.rect, {
          x: 0, y: 0, w: '100%', h: 0.06,
          fill: { color: t.line },
          line: { width: 0 },
        });
        // Icon
        if (slide.icon) {
          s.addText(slide.icon, {
            x: 4.0, y: 0.5, w: 2.0, h: 0.8,
            fontSize: 36, align: 'center',
          });
        }
        // Main title
        s.addText(slide.title || '', {
          x: 0.5, y: slide.icon ? 1.3 : 1.0, w: 9.0, h: 1.6,
          fontSize: 40, bold: true, color: t.text, align: 'center',
          fontFace: 'Arial',
        });
        // Divider line
        s.addShape(pptx.ShapeType.rect, {
          x: 3.5, y: slide.icon ? 3.0 : 2.7, w: 3.0, h: 0.05,
          fill: { color: t.accent },
          line: { width: 0 },
        });
        // Subtitle
        if (slide.subtitle) {
          s.addText(slide.subtitle, {
            x: 0.5, y: slide.icon ? 3.15 : 2.85, w: 9.0, h: 0.7,
            fontSize: 18, color: t.accent, align: 'center', italic: true,
          });
        }
        break;
      }

      // ── AGENDA SLIDE ─────────────────────────────────────────
      case 'agenda': {
        drawHeader(s, t, (slide.icon ? slide.icon + '  ' : '') + (slide.title || '議程'), '');
        const items = slide.items || slide.bullets || [];
        items.forEach((item, i) => {
          const yPos = 1.15 + i * 0.72;
          // Number badge
          s.addShape(pptx.ShapeType.ellipse, {
            x: 0.35, y: yPos, w: 0.42, h: 0.42,
            fill: { color: t.line },
            line: { width: 0 },
          });
          s.addText(String(i + 1), {
            x: 0.35, y: yPos, w: 0.42, h: 0.42,
            fontSize: 13, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle',
          });
          // Item text
          s.addText(item, {
            x: 0.9, y: yPos + 0.02, w: 8.5, h: 0.4,
            fontSize: 16, color: t.text, valign: 'middle',
          });
          // Separator line (except last)
          if (i < items.length - 1) {
            s.addShape(pptx.ShapeType.rect, {
              x: 0.35, y: yPos + 0.52, w: 9.1, h: 0.01,
              fill: { color: t.dim, transparency: 70 },
              line: { width: 0 },
            });
          }
        });
        drawFooter(s, t, idx + 1, total);
        break;
      }

      // ── CONTENT SLIDE ────────────────────────────────────────
      case 'content':
      default: {
        const headerTitle = (slide.icon ? slide.icon + '  ' : '') + (slide.title || '');
        drawHeader(s, t, headerTitle, '');

        // Highlight box (optional)
        if (slide.highlight) {
          s.addShape(pptx.ShapeType.rect, {
            x: 0.35, y: 1.05, w: 9.1, h: 0.5,
            fill: { color: t.line, transparency: 75 },
            line: { color: t.line, width: 1 },
          });
          s.addText(slide.highlight, {
            x: 0.5, y: 1.08, w: 8.9, h: 0.44,
            fontSize: 13, color: t.accent, italic: true, bold: true,
          });
        }

        const bulletY = slide.highlight ? 1.65 : 1.1;
        const bulletH = slide.highlight ? 3.7 : 4.3;

        if (slide.bullets && slide.bullets.length > 0) {
          const bulletItems = slide.bullets.map((b) => ({
            text: b,
            options: {
              bullet: { type: 'bullet', indent: 15 },
              paraSpaceAfter: 6,
            },
          }));
          s.addText(bulletItems, {
            x: 0.4, y: bulletY, w: 9.1, h: bulletH,
            fontSize: 16, color: t.text, valign: 'top', lineSpacingMultiple: 1.3,
          });
        } else if (slide.content) {
          s.addText(slide.content, {
            x: 0.4, y: bulletY, w: 9.1, h: bulletH,
            fontSize: 16, color: t.text, valign: 'top',
          });
        }
        drawFooter(s, t, idx + 1, total);
        break;
      }

      // ── TWO COLUMN ───────────────────────────────────────────
      case 'two_col': {
        const headerTitle = (slide.icon ? slide.icon + '  ' : '') + (slide.title || '');
        drawHeader(s, t, headerTitle, '');

        // Vertical divider
        s.addShape(pptx.ShapeType.rect, {
          x: 4.95, y: 1.05, w: 0.05, h: 4.3,
          fill: { color: t.line, transparency: 50 },
          line: { width: 0 },
        });

        // Left column
        s.addText(slide.left_title || '', {
          x: 0.35, y: 1.05, w: 4.4, h: 0.45,
          fontSize: 15, bold: true, color: t.accent,
        });
        const lb = (slide.left_bullets || []).map((b) => ({ text: b, options: { bullet: true, paraSpaceAfter: 4 } }));
        s.addText(lb.length ? lb : [{ text: '' }], {
          x: 0.35, y: 1.55, w: 4.4, h: 3.8,
          fontSize: 14, color: t.text, valign: 'top',
        });

        // Right column
        s.addText(slide.right_title || '', {
          x: 5.2, y: 1.05, w: 4.4, h: 0.45,
          fontSize: 15, bold: true, color: t.accent,
        });
        const rb = (slide.right_bullets || []).map((b) => ({ text: b, options: { bullet: true, paraSpaceAfter: 4 } }));
        s.addText(rb.length ? rb : [{ text: '' }], {
          x: 5.2, y: 1.55, w: 4.4, h: 3.8,
          fontSize: 14, color: t.text, valign: 'top',
        });
        drawFooter(s, t, idx + 1, total);
        break;
      }

      // ── SECTION BREAK ────────────────────────────────────────
      case 'section': {
        // Full background with side accent bar
        s.addShape(pptx.ShapeType.rect, {
          x: 0, y: 0, w: 0.18, h: '100%',
          fill: { color: t.line },
          line: { width: 0 },
        });
        s.addShape(pptx.ShapeType.rect, {
          x: 0.18, y: 0, w: 0.06, h: '100%',
          fill: { color: t.accent, transparency: 40 },
          line: { width: 0 },
        });
        if (slide.icon) {
          s.addText(slide.icon, {
            x: 1.0, y: 1.5, w: 1.2, h: 1.0,
            fontSize: 48, align: 'center',
          });
        }
        s.addText(slide.title || '', {
          x: slide.icon ? 2.0 : 1.0, y: 1.8, w: 7.5, h: 1.2,
          fontSize: 36, bold: true, color: t.text,
        });
        if (slide.subtitle) {
          s.addText(slide.subtitle, {
            x: slide.icon ? 2.0 : 1.0, y: 3.1, w: 7.5, h: 0.7,
            fontSize: 18, color: t.accent, italic: true,
          });
        }
        drawFooter(s, t, idx + 1, total);
        break;
      }

      // ── QUOTE ────────────────────────────────────────────────
      case 'quote': {
        // Large decorative quote mark
        s.addText('\u201C', {
          x: 0.3, y: 0.3, w: 1.5, h: 1.5,
          fontSize: 120, color: t.line, transparency: 40,
          fontFace: 'Georgia',
        });
        s.addText(slide.quote || '', {
          x: 0.8, y: 1.2, w: 8.4, h: 2.8,
          fontSize: 22, color: t.text, italic: true, align: 'center',
          lineSpacingMultiple: 1.5, fontFace: 'Georgia',
        });
        // Bottom line
        s.addShape(pptx.ShapeType.rect, {
          x: 3.5, y: 4.1, w: 3.0, h: 0.05,
          fill: { color: t.accent },
          line: { width: 0 },
        });
        if (slide.author) {
          s.addText(`— ${slide.author}`, {
            x: 0.5, y: 4.25, w: 9.0, h: 0.5,
            fontSize: 14, color: t.accent, align: 'center', bold: true,
          });
        }
        break;
      }

      // ── CLOSING ──────────────────────────────────────────────
      case 'closing': {
        // Radial glow effect via layered circles
        s.addShape(pptx.ShapeType.ellipse, {
          x: 3.0, y: 0.8, w: 4.0, h: 4.0,
          fill: { color: t.line, transparency: 85 },
          line: { width: 0 },
        });
        s.addShape(pptx.ShapeType.ellipse, {
          x: 3.8, y: 1.6, w: 2.4, h: 2.4,
          fill: { color: t.line, transparency: 65 },
          line: { width: 0 },
        });
        if (slide.icon) {
          s.addText(slide.icon, {
            x: 4.0, y: 1.5, w: 2.0, h: 1.0,
            fontSize: 48, align: 'center',
          });
        }
        s.addText(slide.title || '感謝聆聽', {
          x: 0.5, y: slide.icon ? 2.6 : 2.0, w: 9.0, h: 1.2,
          fontSize: 38, bold: true, color: t.text, align: 'center',
        });
        s.addShape(pptx.ShapeType.rect, {
          x: 3.5, y: slide.icon ? 3.85 : 3.3, w: 3.0, h: 0.05,
          fill: { color: t.accent },
          line: { width: 0 },
        });
        if (slide.subtitle) {
          s.addText(slide.subtitle, {
            x: 0.5, y: slide.icon ? 4.0 : 3.5, w: 9.0, h: 0.7,
            fontSize: 16, color: t.accent, align: 'center', italic: true,
          });
        }
        break;
      }
    }

    if (slide.notes) {
      s.addNotes(slide.notes);
    }
  }

  await pptx.writeFile({ fileName: outputPath });
  return outputPath;
}

// ─── Foxlink Corporate PPT ────────────────────────────────────────────────────
async function generateFoxlinkPptx(content, outputPath) {
  const PptxGenJS = require('pptxgenjs');
  const { getIconDataUri } = require('./pptIcons');

  let data;
  try {
    data = JSON.parse(content);
  } catch (_) {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Invalid JSON for Foxlink PPTX');
    data = JSON.parse(m[0]);
  }

  const C = {
    BLUE:       '4F81BD',
    YELLOW:     'FFC000',
    TEXT:       '595959',
    WHITE:      'FFFFFF',
    NAVY:       '1F3864',
    LIGHT_BLUE: 'D9E2F3',
    CARD_BG:    'F0F5FB',
    HIGHLIGHT:  'FFF9E6',
    DIM:        '8E8E8E',
    DASH_TEXT:  '7D5A00',
  };

  const author = data.author || '';
  const date   = data.date   || new Date().toISOString().split('T')[0];
  const slides = (data.slides || []).map((slide) => {
    // Strip markdown from text fields
    const s = (v) => (typeof v === 'string' ? stripInlineMarkdown(v) : v);
    const sa = (arr) => (Array.isArray(arr) ? arr.map(s) : arr);
    return {
      ...slide,
      title:     s(slide.title),
      subtitle:  s(slide.subtitle),
      highlight: s(slide.highlight),
      bullets:   sa(slide.bullets),
      columns:   (slide.columns || []).map((c) => ({ ...c, title: s(c.title), bullets: sa(c.bullets) })),
      steps:     (slide.steps  || []).map((st) => ({ ...st, title: s(st.title), desc: s(st.desc) })),
    };
  });

  const pptx = new PptxGenJS();
  pptx.layout  = 'LAYOUT_16x9'; // 10" × 5.625" — all coordinates designed for this
  pptx.author  = author;
  pptx.subject = 'Foxlink Presentation';

  const total = slides.length;

  // ── helpers ──────────────────────────────────────────────────────────────────
  function drawHeader(s, title, iconName) {
    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: '100%', h: 0.9,
      fill: { color: C.BLUE }, line: { width: 0 },
    });
    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0.87, w: '100%', h: 0.06,
      fill: { color: C.YELLOW }, line: { width: 0 },
    });
    let titleX = 0.35;
    if (iconName) {
      const uri = getIconDataUri(iconName, C.WHITE, 48);
      if (uri) {
        s.addImage({ data: uri, x: 0.18, y: 0.14, w: 0.52, h: 0.52 });
        titleX = 0.82;
      }
    }
    s.addText(title || '', {
      x: titleX, y: 0.06, w: 9.6 - titleX, h: 0.78,
      fontSize: 20, bold: true, color: C.WHITE,
      fontFace: 'Arial', valign: 'middle',
    });
  }

  function drawFooter(s, pageNum, totalPages) {
    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: 5.42, w: '100%', h: 0.03,
      fill: { color: C.BLUE }, line: { width: 0 },
    });
    const footerText =
      'Foxlink confidential & Proprietary  |  ' +
      date + '  |  ' +
      (author || '') + '  |  ' +
      pageNum + ' / ' + totalPages;
    s.addText(footerText, {
      x: 0.2, y: 5.37, w: 9.6, h: 0.24,
      fontSize: 10, color: C.BLUE, align: 'center',
    });
  }

  // ── slides ────────────────────────────────────────────────────────────────────
  for (let idx = 0; idx < slides.length; idx++) {
    const slide = slides[idx];
    const s = pptx.addSlide();
    s.background = { color: C.WHITE };

    switch (slide.type) {

      // ── TITLE ────────────────────────────────────────────────────────────────
      case 'title': {
        // Blue block, covers top 62%
        s.addShape(pptx.ShapeType.rect, {
          x: 0, y: 0, w: '100%', h: 3.58,
          fill: { color: C.BLUE }, line: { width: 0 },
        });
        // Dark navy right accent band
        s.addShape(pptx.ShapeType.rect, {
          x: 7.2, y: 0, w: 2.8, h: 3.58,
          fill: { color: C.NAVY }, line: { width: 0 },
        });
        // FOXLINK brand
        s.addText('FOXLINK', {
          x: 7.35, y: 0.22, w: 2.4, h: 0.55,
          fontSize: 22, bold: true, color: C.WHITE,
          fontFace: 'Arial', align: 'right',
        });
        // Yellow separator
        s.addShape(pptx.ShapeType.rect, {
          x: 0, y: 3.55, w: '100%', h: 0.1,
          fill: { color: C.YELLOW }, line: { width: 0 },
        });
        // Main title
        s.addText(slide.title || '', {
          x: 0.5, y: 0.85, w: 6.5, h: 2.5,
          fontSize: 36, bold: true, color: C.WHITE,
          fontFace: 'Arial', valign: 'middle', lineSpacingMultiple: 1.2,
        });
        // Subtitle
        if (slide.subtitle) {
          s.addText(slide.subtitle, {
            x: 0.5, y: 3.75, w: 9.0, h: 0.72,
            fontSize: 18, color: C.TEXT, italic: true, fontFace: 'Arial',
          });
        }
        // Author / date meta
        const meta = [date, author].filter(Boolean).join('   |   ');
        if (meta) {
          s.addText(meta, {
            x: 0.5, y: 4.95, w: 9.0, h: 0.28,
            fontSize: 12, color: C.LIGHT_BLUE,
          });
        }
        break;
      }

      // ── BULLETS / CONTENT ─────────────────────────────────────────────────
      case 'bullets':
      case 'content':
      default: {
        drawHeader(s, slide.title, slide.icon || null);

        let bodyY = 1.05;

        if (slide.highlight) {
          s.addShape(pptx.ShapeType.rect, {
            x: 0.35, y: bodyY, w: 9.3, h: 0.56,
            fill: { color: C.HIGHLIGHT },
            line: { color: C.YELLOW, width: 1.5, dashType: 'dash' },
          });
          s.addText(slide.highlight, {
            x: 0.5, y: bodyY + 0.04, w: 9.1, h: 0.48,
            fontSize: 14, color: C.DASH_TEXT, italic: true, bold: true,
            valign: 'middle',
          });
          bodyY += 0.66;
        }

        const bullets = slide.bullets || (slide.content ? [slide.content] : []);
        if (bullets.length > 0) {
          const items = bullets.map((b) => ({
            text: typeof b === 'string' ? b : String(b),
            options: {
              bullet: { type: 'bullet', indent: 15, color: C.BLUE },
              paraSpaceAfter: 5,
            },
          }));
          s.addText(items, {
            x: 0.4, y: bodyY, w: 9.2, h: 5.35 - bodyY,
            fontSize: 17, color: C.NAVY, valign: 'top',
            lineSpacingMultiple: 1.35,
          });
        }
        drawFooter(s, idx + 1, total);
        break;
      }

      // ── 3-COLUMN ──────────────────────────────────────────────────────────
      case '3col': {
        drawHeader(s, slide.title, null);
        const cols = (slide.columns || []).slice(0, 3);
        const colW = 2.92;
        const colXs = [0.28, 3.54, 6.8];
        const colY = 1.05;
        const colH = 4.25;

        cols.forEach((col, ci) => {
          const cx = colXs[ci];
          s.addShape(pptx.ShapeType.rect, {
            x: cx, y: colY, w: colW, h: colH,
            fill: { color: C.CARD_BG },
            line: { color: C.LIGHT_BLUE, width: 1 },
          });
          s.addShape(pptx.ShapeType.rect, {
            x: cx, y: colY, w: colW, h: 0.07,
            fill: { color: C.BLUE }, line: { width: 0 },
          });

          let titleY = colY + 0.2;
          if (col.icon) {
            const uri = getIconDataUri(col.icon, C.BLUE, 48);
            if (uri) {
              s.addImage({ data: uri, x: cx + colW / 2 - 0.3, y: colY + 0.13, w: 0.6, h: 0.6 });
              titleY = colY + 0.8;
            }
          }
          s.addText(col.title || '', {
            x: cx + 0.1, y: titleY, w: colW - 0.2, h: 0.48,
            fontSize: 15, bold: true, color: C.NAVY, align: 'center',
          });

          const cb = (col.bullets || []).map((b) => ({
            text: b,
            options: { bullet: { type: 'bullet', indent: 10, color: C.BLUE }, paraSpaceAfter: 4 },
          }));
          if (cb.length > 0) {
            s.addText(cb, {
              x: cx + 0.15, y: titleY + 0.52, w: colW - 0.3, h: colH - (titleY - colY) - 0.62,
              fontSize: 14, color: '2E5B8A', valign: 'top',
            });
          }
        });
        drawFooter(s, idx + 1, total);
        break;
      }

      // ── FLOW ──────────────────────────────────────────────────────────────
      case 'flow': {
        drawHeader(s, slide.title, null);
        const steps = (slide.steps || []).slice(0, 5);
        const n = steps.length;
        if (n === 0) { drawFooter(s, idx + 1, total); break; }

        const arrowW = 0.32;
        const totalW = 9.44;
        const boxW = (totalW - arrowW * (n - 1)) / n;
        const startX = 0.28;
        const boxY = 1.2;
        const boxH = 4.1;

        steps.forEach((step, si) => {
          const bx = startX + si * (boxW + arrowW);

          s.addShape(pptx.ShapeType.rect, {
            x: bx, y: boxY, w: boxW, h: boxH,
            fill: { color: C.CARD_BG },
            line: { color: C.BLUE, width: 1.5 },
          });
          s.addShape(pptx.ShapeType.rect, {
            x: bx, y: boxY, w: boxW, h: 0.08,
            fill: { color: C.BLUE }, line: { width: 0 },
          });

          // Step number badge
          s.addShape(pptx.ShapeType.ellipse, {
            x: bx + boxW / 2 - 0.3, y: boxY + 0.15, w: 0.6, h: 0.6,
            fill: { color: C.BLUE }, line: { width: 0 },
          });
          s.addText(String(si + 1), {
            x: bx + boxW / 2 - 0.3, y: boxY + 0.15, w: 0.6, h: 0.6,
            fontSize: 17, bold: true, color: C.WHITE, align: 'center', valign: 'middle',
          });

          let descY = boxY + 0.88;
          if (step.icon) {
            const uri = getIconDataUri(step.icon, C.BLUE, 48);
            if (uri) {
              s.addImage({ data: uri, x: bx + boxW / 2 - 0.3, y: boxY + 0.82, w: 0.6, h: 0.6 });
              descY = boxY + 1.48;
            }
          }

          s.addText(step.title || '', {
            x: bx + 0.08, y: descY, w: boxW - 0.16, h: 0.55,
            fontSize: 14, bold: true, color: C.NAVY, align: 'center', valign: 'middle',
            lineSpacingMultiple: 1.2,
          });

          if (step.desc) {
            s.addText(step.desc, {
              x: bx + 0.1, y: descY + 0.6, w: boxW - 0.2, h: boxH - (descY - boxY) - 0.72,
              fontSize: 12, color: '2E5B8A', align: 'center', valign: 'top',
              lineSpacingMultiple: 1.3,
            });
          }

          // Arrow
          if (si < n - 1) {
            s.addText('\u25B6', {
              x: bx + boxW + 0.01, y: boxY + boxH / 2 - 0.2, w: arrowW - 0.02, h: 0.4,
              fontSize: 15, color: C.YELLOW, align: 'center', valign: 'middle',
            });
          }
        });
        drawFooter(s, idx + 1, total);
        break;
      }
    }

    if (slide.notes) s.addNotes(slide.notes);
  }

  await pptx.writeFile({ fileName: outputPath });
  return outputPath;
}

// ─── Rich PPTX (dashboard, charts, tables, infographics, etc.) ───────────────
async function generateRichPptx(content, outputPath) {
  const PptxGenJS = require('pptxgenjs');
  const { renderRichSlides } = require('./richSlideRenderer');

  let data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    // Try to extract JSON from surrounding text
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Invalid JSON for rich PPTX');
    data = JSON.parse(m[0]);
  }

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = data.author || '';
  pptx.subject = data.subject || 'Rich Presentation';

  renderRichSlides(pptx, data);
  await pptx.writeFile({ fileName: outputPath });
  return outputPath;
}

module.exports = { processGenerateBlocks, generateFile };
