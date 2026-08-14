/* One-off: convert the customer confidentiality markdown into a review .docx */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, ShadingType,
} = require(path.join(__dirname, '../server/node_modules/docx'));

const SRC = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '../docs/cortex-customer-data-confidentiality.md');
const OUT = process.argv[3]
  ? path.resolve(process.argv[3])
  : SRC.replace(/\.md$/i, '.docx');
const FONT = 'Microsoft JhengHei';

const md = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const lines = md.split('\n');

// --- inline parser: **bold**, `code`, plain ---
function runs(text, base = {}) {
  const out = [];
  // split keeping delimiters for ** and `
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, ...base }));
    const tok = m[0];
    if (tok.startsWith('**')) {
      out.push(new TextRun({ text: tok.slice(2, -2), bold: true, font: FONT, ...base }));
    } else {
      out.push(new TextRun({ text: tok.slice(1, -1), font: 'Consolas', size: 18, ...base }));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: FONT, ...base }));
  if (out.length === 0) out.push(new TextRun({ text: '', font: FONT, ...base }));
  return out;
}

const children = [];
let i = 0;

function cellShade(fill) {
  return { type: ShadingType.CLEAR, color: 'auto', fill };
}

while (i < lines.length) {
  let line = lines[i];

  // table block
  if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
    const block = [];
    while (i < lines.length && /^\s*\|/.test(lines[i])) { block.push(lines[i]); i++; }
    const parse = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const header = parse(block[0]);
    const body = block.slice(2).map(parse);
    const colW = Math.floor(9000 / header.length);
    const mkCell = (txt, isHeader) => new TableCell({
      width: { size: colW, type: WidthType.DXA },
      shading: isHeader ? cellShade('1F4E79') : undefined,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      children: [new Paragraph({ children: runs(txt, isHeader ? { bold: true, color: 'FFFFFF' } : {}), spacing: { after: 0 } })],
    });
    const rows = [];
    rows.push(new TableRow({ tableHeader: true, children: header.map((h) => mkCell(h, true)) }));
    body.forEach((r, idx) => {
      const cells = header.map((_, c) => mkCell(r[c] || '', false));
      rows.push(new TableRow({ children: cells }));
    });
    children.push(new Table({
      width: { size: 9000, type: WidthType.DXA },
      rows,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
        left: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
        right: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
        insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
      },
    }));
    children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
    continue;
  }

  // headings
  if (/^#{1,4}\s/.test(line)) {
    const level = line.match(/^(#+)/)[1].length;
    const text = line.replace(/^#+\s/, '');
    const hl = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][level - 1];
    children.push(new Paragraph({
      heading: hl,
      spacing: { before: level <= 2 ? 240 : 160, after: 100 },
      children: runs(text, { bold: true, color: level === 1 ? '1F4E79' : '2E5496' }),
    }));
    i++; continue;
  }

  // horizontal rule
  if (/^---+\s*$/.test(line)) {
    children.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA', space: 1 } },
      spacing: { before: 80, after: 120 }, children: [new TextRun({ text: '', font: FONT })],
    }));
    i++; continue;
  }

  // blockquote
  if (/^>\s?/.test(line)) {
    const text = line.replace(/^>\s?/, '');
    children.push(new Paragraph({
      shading: cellShade('FFF4E6'),
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'E8A33D', space: 8 } },
      spacing: { before: 40, after: 80 }, indent: { left: 120 },
      children: runs(text, { italics: true, color: '7A4E12' }),
    }));
    i++; continue;
  }

  // bullet list
  if (/^\s*[-*]\s+/.test(line)) {
    const indent = line.match(/^(\s*)/)[1].length;
    const text = line.replace(/^\s*[-*]\s+/, '');
    children.push(new Paragraph({
      bullet: { level: indent >= 2 ? 1 : 0 },
      spacing: { after: 40 },
      children: runs(text),
    }));
    i++; continue;
  }

  // blank
  if (/^\s*$/.test(line)) { i++; continue; }

  // normal paragraph
  children.push(new Paragraph({ spacing: { after: 80 }, children: runs(line) }));
  i++;
}

const doc = new Document({
  creator: 'FOXLINK GPT (CORTEX)',
  title: 'CORTEX 客戶資料保密控制說明',
  styles: {
    default: {
      document: { run: { font: FONT, size: 21 } },
    },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', run: { font: FONT, size: 30, bold: true, color: '1F4E79' } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', run: { font: FONT, size: 26, bold: true, color: '2E5496' } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', run: { font: FONT, size: 23, bold: true, color: '2E5496' } },
      { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', run: { font: FONT, size: 21, bold: true, color: '404040' } },
    ],
  },
  sections: [{
    properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log('WROTE', OUT, (buf.length / 1024).toFixed(1) + ' KB');
});
