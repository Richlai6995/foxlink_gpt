/**
 * bomImportProfileService.js — BOM 匯入設定檔(統一 canonical 格式 + mapping profile)
 *
 * 對應統一格式討論:系統只認 canonical row,各專案 raw Excel 用 profile 轉進來。
 * canonical row = { subAssembly(半成品), module(EE/ME/PKG), itemNo, desc, fpn, qty, unitPrice, vendor, mfgPn, remark }
 *
 * profile.source_kind:
 *   CANONICAL — 檔案已是 canonical(每 sheet 一半成品 或 半成品當欄 · header-based)
 *   MAPPED    — raw Excel,config_json.sheets 定義各 sheet → canonical 欄位對映
 */

const XLSX = require('xlsx');
const num = (v) => (typeof v === 'number' ? v : (v == null || v === '' ? 0 : Number(String(v).replace(/[$,\s]/g, '')) || 0));
const isNum = (v) => v != null && v !== '' && !isNaN(Number(String(v).replace(/[$,\s]/g, '')));
const str = (v) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim() || null);
const pick = (row, name) => { if (!row) return undefined; const lc = name.toLowerCase(); for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k]; return undefined; };
const lc = (row) => { const o = {}; if (row) for (const k of Object.keys(row)) o[k.toLowerCase()] = row[k]; return o; };
const SKIP_SHEET = /說明|instruction|readme|工作表|^sheet\d|history/i;

// canonical header 名(小寫 contains)→ 欄位
function resolveCanonicalHeader(hdr) {
  const m = {};
  (hdr || []).forEach((h, i) => {
    const s = String(h == null ? '' : h).trim().toLowerCase();
    if (!s) return;
    if (s.includes('sub-assembly') || s.includes('sub assembly') || s.includes('半成品') || s === 'board' || s.includes('assembly name')) m.subAssembly = i;
    else if (s === 'module' || s.includes('模組') || s === 'category' || s.includes('類別')) m.module = i;
    else if (s.includes('item no') || s.includes('item#') || s === 'item') m.itemNo = i;
    else if (s.includes('description') || s.includes('描述')) m.desc = i;
    else if (s.includes('foxlink') || s.includes('flk p/n') || s.includes('foxlink p/n')) m.fpn = i;
    else if (s === 'qty' || s.includes('數量') || s.includes("qt'y")) m.qty = i;
    else if (s.includes('unit price') || s.includes('u/p') || s.includes('單價')) m.unitPrice = i;
    else if (s.includes('mfg p/n') || s.includes('mfg part') || s.includes('廠商料號')) m.mfgPn = i;
    else if (s === 'vendor' || s.includes('供應商') || s.includes('廠商')) m.vendor = i;
    else if (s.includes('remark') || s.includes('備註')) m.remark = i;
  });
  return m;
}

// 依 match(exact 或 prefix* )找實際 sheet 名
function matchSheets(names, pattern) {
  if (pattern.endsWith('*')) { const p = pattern.slice(0, -1); return names.filter((n) => n.startsWith(p)); }
  return names.filter((n) => n === pattern);
}

/** raw workbook + profile → canonical rows[] */
function transformToCanonical(wb, profile) {
  const rows = [];
  const cfg = profile.config ? (typeof profile.config === 'string' ? JSON.parse(profile.config) : profile.config) : null;
  const kind = profile.sourceKind || profile.source_kind || 'CANONICAL';

  if (kind === 'MAPPED' && cfg && Array.isArray(cfg.sheets)) {
    for (const sc of cfg.sheets) {
      for (const sheetName of matchSheets(wb.SheetNames, sc.match)) {
        const ws = wb.Sheets[sheetName]; if (!ws) continue;
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
        const start = sc.startRow || 1;
        const c = sc.cols || {};
        for (let r = start; r < data.length; r++) {
          const row = data[r]; if (!row) continue;
          const qty = c.qty != null ? row[c.qty] : null;
          if (!isNum(qty)) continue;
          const subAssembly = sc.subAssembly && sc.subAssembly.fromCol != null ? str(row[sc.subAssembly.fromCol]) : (sc.subAssembly || sheetName);
          const module = sc.module && sc.module.fromCol != null ? str(row[sc.module.fromCol]) : (sc.module || 'EE');
          rows.push(canonRow(subAssembly, module, row, c));
        }
      }
    }
    return rows;
  }

  // CANONICAL:每 sheet 一半成品(或半成品當欄)· header-based
  for (const sheetName of wb.SheetNames) {
    if (SKIP_SHEET.test(sheetName)) continue;
    const ws = wb.Sheets[sheetName]; if (!ws) continue;
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (!data.length) continue;
    const H = resolveCanonicalHeader(data[0] || []);
    if (H.qty == null) continue;
    for (let r = 1; r < data.length; r++) {
      const row = data[r]; if (!row) continue;
      if (!isNum(row[H.qty])) continue;
      const subAssembly = (H.subAssembly != null && str(row[H.subAssembly])) || sheetName;
      const module = (H.module != null && str(row[H.module])) || 'EE';
      rows.push(canonRow(subAssembly, module, row, H));
    }
  }
  return rows;
}

function canonRow(subAssembly, module, row, c) {
  const g = (k) => (c[k] != null ? row[c[k]] : null);
  const mod = String(module || 'EE').toUpperCase();
  return {
    subAssembly: str(subAssembly) || 'MAIN',
    module: /^(EE|ME|PKG)$/.test(mod) ? mod : 'EE',
    itemNo: str(g('itemNo')), desc: str(g('desc')), fpn: str(g('fpn')),
    qty: num(g('qty')), unitPrice: isNum(g('unitPrice')) ? num(g('unitPrice')) : null,
    vendor: str(g('vendor')), mfgPn: str(g('mfgPn')), remark: str(g('remark')),
  };
}

// ── CRUD ────────────────────────────────────────────────────────────────────
async function listProfiles(db) {
  const rows = await db.prepare(`SELECT id, profile_code, name, description, source_kind, is_active, is_builtin FROM bom_import_profile WHERE is_active=1 ORDER BY is_builtin DESC, profile_code`).all().catch(() => []);
  return rows.map(lc);
}
async function getProfile(db, code) {
  const r = await db.prepare(`SELECT id, profile_code, name, description, source_kind, config_json, is_builtin FROM bom_import_profile WHERE profile_code=?`).get(code).catch(() => null);
  if (!r) return null;
  const o = lc(r);
  return { ...o, sourceKind: o.source_kind, config: o.config_json };
}
async function saveProfile(db, p, userId = null) {
  const ex = await db.prepare(`SELECT id, is_builtin FROM bom_import_profile WHERE profile_code=?`).get(p.profileCode).catch(() => null);
  const cfg = p.config != null ? (typeof p.config === 'string' ? p.config : JSON.stringify(p.config)) : null;
  if (ex) {
    await db.prepare(`UPDATE bom_import_profile SET name=?, description=?, source_kind=?, config_json=?, updated_at=SYSTIMESTAMP WHERE profile_code=?`)
      .run(p.name || null, p.description || null, p.sourceKind || 'MAPPED', cfg, p.profileCode);
  } else {
    await db.prepare(`INSERT INTO bom_import_profile (profile_code, name, description, source_kind, config_json, is_builtin, created_by) VALUES (?,?,?,?,?,0,?)`)
      .run(p.profileCode, p.name || null, p.description || null, p.sourceKind || 'MAPPED', cfg, userId);
  }
  return getProfile(db, p.profileCode);
}
async function deleteProfile(db, code) {
  const r = await db.prepare(`SELECT is_builtin FROM bom_import_profile WHERE profile_code=?`).get(code).catch(() => null);
  if (r && Number(pick(r, 'is_builtin'))) throw new Error('內建 profile 不可刪');
  await db.prepare(`DELETE FROM bom_import_profile WHERE profile_code=?`).run(code);
  return { deleted: code };
}

// ── 內建 profile(seed · 把原 format enum 變成設定)──────────────────────────
const BUILTIN = [
  { profileCode: 'CANONICAL', name: '標準統一格式', description: '半成品(Sub-Assembly)當欄 或 每分頁一半成品 · Module=EE/ME/PKG · header-based', sourceKind: 'CANONICAL', config: null },
  {
    profileCode: 'WHOOP-GEN4', name: 'WHOOP Gen4 quotation book', description: '多板(Harvard/Bird…)raw Excel → canonical 對映', sourceKind: 'MAPPED',
    config: { sheets: [
      { match: 'Harvard Sensor (G)', subAssembly: 'Harvard Sensor', module: 'EE', startRow: 2, cols: { itemNo: 0, fpn: 1, desc: 2, qty: 5, vendor: 8 } },
      { match: 'Harvard MainBoard (F3)', subAssembly: 'Harvard MainBoard', module: 'EE', startRow: 2, cols: { itemNo: 0, fpn: 1, desc: 3, qty: 6, vendor: 8, unitPrice: 13 } },
      { match: 'Bird Main Board (J4)', subAssembly: 'Bird MainBoard', module: 'EE', startRow: 2, cols: { itemNo: 0, fpn: 1, desc: 5, qty: 6, vendor: 10 } },
      { match: 'Bird NFC', subAssembly: 'Bird NFC', module: 'EE', startRow: 2, cols: { itemNo: 0, fpn: 1, desc: 3, qty: 5, vendor: 8, unitPrice: 10 } },
      { match: 'Harvard Assembly', subAssembly: 'Harvard Assembly', module: 'EE', startRow: 2, cols: { itemNo: 0, fpn: 4, desc: 3, qty: 5, vendor: 8, unitPrice: 10 } },
      { match: 'Bird Assembly', subAssembly: 'Bird Assembly', module: 'EE', startRow: 2, cols: { itemNo: 0, fpn: 1, desc: 3, qty: 6, vendor: 9, unitPrice: 11 } },
      { match: 'STRAP', subAssembly: 'Strap', module: 'ME', startRow: 2, cols: { itemNo: 0, fpn: 4, desc: 1, qty: 6, vendor: 8 } },
      { match: 'BATTERY_PACK', subAssembly: 'Battery Pack', module: 'ME', startRow: 4, cols: { itemNo: 0, fpn: 5, desc: 1, qty: 8, vendor: 9, unitPrice: 10 } },
      { match: 'Retail', subAssembly: 'Retail PKG', module: 'PKG', startRow: 2, cols: { itemNo: 0, fpn: 2, desc: 3, qty: 4, vendor: 8, unitPrice: 6 } },
    ] },
  },
  {
    profileCode: 'RIVAL3-GEN2', name: 'Rival3 Gen2 uni BOM', description: 'SteelSeries Rival3 EE/ME/PKG raw Excel → canonical 對映', sourceKind: 'MAPPED',
    config: { sheets: [
      { match: 'EE bom 0227', subAssembly: 'EE BOM', module: 'EE', startRow: 4, cols: { itemNo: 1, fpn: 5, desc: 8, qty: 4, unitPrice: 18, vendor: 10, mfgPn: 11 } },
      { match: 'ME bom 0618_Black', subAssembly: 'ME BOM', module: 'ME', startRow: 7, cols: { itemNo: 0, fpn: 6, desc: 5, qty: 8, unitPrice: 20, vendor: 15 } },
      { match: 'PKG BOM 20241023_Amber', subAssembly: 'Packaging', module: 'PKG', startRow: 4, cols: { itemNo: 0, fpn: 2, desc: 8, qty: 10, unitPrice: 11 } },
    ] },
  },
];

async function seedBuiltin(db) {
  for (const p of BUILTIN) {
    const cfg = p.config ? JSON.stringify(p.config) : null;
    const ex = await db.prepare(`SELECT id FROM bom_import_profile WHERE profile_code=?`).get(p.profileCode).catch(() => null);
    if (ex) await db.prepare(`UPDATE bom_import_profile SET name=?, description=?, source_kind=?, config_json=?, is_builtin=1 WHERE profile_code=?`).run(p.name, p.description, p.sourceKind, cfg, p.profileCode);
    else await db.prepare(`INSERT INTO bom_import_profile (profile_code, name, description, source_kind, config_json, is_builtin) VALUES (?,?,?,?,?,1)`).run(p.profileCode, p.name, p.description, p.sourceKind, cfg);
  }
}

module.exports = { transformToCanonical, resolveCanonicalHeader, listProfiles, getProfile, saveProfile, deleteProfile, seedBuiltin };
