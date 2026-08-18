'use strict';

/**
 * cjkFont — pdfkit 用的 CJK 字型解析器(保證挑到「glyf(TrueType 輪廓)」字型)
 *
 * 背景 / 為什麼需要這支:
 *   pdfkit 嵌入子集字型時會產生 /ToUnicode CMap 供「複製貼上 / 全文檢索」用。
 *   對 **CID-keyed CFF(Noto Sans CJK 的 .otf 正是這種)** 字型,pdfkit 子集化後
 *   ToUnicode 會壞掉 → PDF 畫面正常、但複製出來變 PUA 私用區亂碼(􀃶􀃷…)。
 *   而 **glyf(TrueType 輪廓)** 字型(如 Noto Sans TC 的 .ttf 靜態版)不受此 bug 影響。
 *
 *   生產環境的 /app/fonts 是掛載 volume(Docker `./fonts` / K8s NFS subPath),
 *   內容常被 ops 換成 Noto CJK 的 CFF .otf(rename 成 .ttf 以對上寫死路徑)→ 中招。
 *   解法:優先載入「baked 進 image、volume 蓋不到」的 glyf 字型
 *   (server/assets/fonts/,對應容器內 /app/assets/fonts/),並驗 sfnt 只收 glyf。
 *
 * 用法:
 *   const { resolveCjkFontPath } = require('./cjkFont');
 *   const p = resolveCjkFontPath();          // 保證 glyf(找不到 glyf 才退而求其次)
 *   if (p) doc.registerFont('cjk', p); else doc.registerFont('cjk', 'Helvetica');
 */

const fs = require('fs');
const path = require('path');

// ── 讀 sfnt 表頭,判斷是 glyf(TrueType)還是 CFF(OpenType/CFF)──────────────
// 回傳 'glyf' | 'cff' | null(讀不到)。ttc(字型集合)看第一個子字型。
function detectSfntKind(filePath) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(12);
    if (fs.readSync(fd, head, 0, 12, 0) < 12) return null;
    let tableDirOffset = 0;
    const tag = head.toString('latin1', 0, 4);
    if (tag === 'ttcf') {
      // TrueType/OpenType Collection:讀第一個字型的 offset
      const off = Buffer.alloc(4);
      fs.readSync(fd, off, 0, 4, 12); // 第一個 font offset 在 header 之後
      tableDirOffset = off.readUInt32BE(0);
      // 重讀該子字型的 sfnt header
      const sub = Buffer.alloc(12);
      fs.readSync(fd, sub, 0, 12, tableDirOffset);
      head.set(sub);
    }
    const sfntVer = head.readUInt32BE(0);
    const numTables = head.readUInt16BE(4);
    // sfntVer: 0x00010000 或 'true' = TrueType;'OTTO' = CFF
    const dirStart = tableDirOffset + 12;
    let hasGlyf = false, hasCFF = false;
    const rec = Buffer.alloc(16);
    for (let i = 0; i < numTables; i++) {
      if (fs.readSync(fd, rec, 0, 16, dirStart + i * 16) < 16) break;
      const t = rec.toString('latin1', 0, 4);
      if (t === 'glyf') hasGlyf = true;
      if (t === 'CFF ') hasCFF = true;
    }
    if (hasGlyf) return 'glyf';
    if (hasCFF) return 'cff';
    // 沒有明確表 → 用 sfntVer 猜
    if (sfntVer === 0x4f54544f /* 'OTTO' */) return 'cff';
    return 'glyf';
  } catch (_) {
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

// 候選清單(順序 = 優先序)。前段是「image 內 volume 蓋不到」的 baked 路徑。
function candidatePaths() {
  const list = [];
  if (process.env.CJK_FONT_PATH) list.push(process.env.CJK_FONT_PATH); // ops 逃生口
  // baked 進 image(server/assets/fonts → 容器 /app/assets/fonts),volume-proof
  list.push(path.join(__dirname, '../assets/fonts/NotoSansTC-Regular.ttf'));
  list.push('/app/assets/fonts/NotoSansTC-Regular.ttf');
  // 開發機 / legacy 位置(server/fonts,gitignored,本機自帶)
  list.push(path.join(__dirname, '../fonts/NotoSansTC-Regular.ttf'));
  // 掛載 volume(最後才用;很可能是壞掉的 CID-CFF,故排最後 + 會被 sfnt 檢查降級)
  list.push('/app/fonts/NotoSansTC-Regular.ttf');
  // 系統字型(部分發行版 Noto TC glyf)
  list.push('/usr/share/fonts/truetype/noto/NotoSansTC-Regular.ttf');
  list.push('/usr/share/fonts/truetype/app/NotoSansTC-Regular.ttf');
  return list;
}

let _cached; // { path, kind } | null
function resolveCjkFont() {
  if (_cached !== undefined) return _cached;
  const cands = candidatePaths();
  let firstExisting = null;
  for (const p of cands) {
    if (!p || !fs.existsSync(p)) continue;
    const kind = detectSfntKind(p);
    if (firstExisting === null) firstExisting = { path: p, kind };
    if (kind === 'glyf') { _cached = { path: p, kind }; return _cached; }
    // CFF / 讀不到 → 跳過,繼續找 glyf(避免 CID-CFF 複製亂碼)
    console.warn(`[cjkFont] 略過非 glyf 字型(可能導致複製亂碼):${p} (kind=${kind})`);
  }
  // 全部候選都不是 glyf → 退而求其次用第一個存在的(至少畫面能出中文,勝過 tofu)
  if (firstExisting) {
    console.warn(`[cjkFont] 找不到 glyf 字型,退用 ${firstExisting.path}(kind=${firstExisting.kind});複製可能亂碼`);
    _cached = firstExisting;
    return _cached;
  }
  console.warn('[cjkFont] 找不到任何 CJK 字型,PDF 中文將顯示 tofu');
  _cached = null;
  return _cached;
}

function resolveCjkFontPath() {
  const r = resolveCjkFont();
  return r ? r.path : null;
}

module.exports = { resolveCjkFont, resolveCjkFontPath, detectSfntKind };
