/**
 * bomCostModelService.js — 成本模型通用匯入/匯出(C-1 · docs/cortex-cost-model-import-plan.md)
 *
 * 單一 workbook 多分頁(固定分頁名 · header = DB 欄名 · runtime introspection → round-trip 保證):
 *   [Baseline] 廠別基準(單列 · 含薪資換算輔助欄:月薪→時薪,拍板§5)
 *   [SimplifiedLine][QtyScenario](SIMPLIFIED 必要)
 *   [Process][IDL-LineWage][IDL-Role][Equipment][Facility](FULL 必要;Consumable/SmtPoint/Macro 留 C-2)
 * 匯入 = 建新 baseline + 新 case_factory 掛專案(b 路徑 · 不動共用 baseline);缺頁/缺廠別 → 硬擋。
 * 範本 = 匯出 fixture 模型(真實樣例,改參數後匯回)。
 */

const XLSX = require('xlsx');
const { makeLogger } = require('./logger');
const log = makeLogger('bomCostModel');

const num = (v) => (typeof v === 'number' ? v : (v == null || v === '' ? null : (isNaN(Number(String(v).replace(/[$,%\s]/g, ''))) ? null : Number(String(v).replace(/[$,%\s]/g, '')))));
const str = (v) => (v == null ? null : String(v).trim() || null);
const pick = (row, name) => { if (!row) return undefined; const lc = String(name).toLowerCase(); for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k]; return undefined; };

// 分頁 ↔ 表(scope:baseline=掛 baseline_id · case=掛 case_factory_id)
const SHEETS = [
  { sheet: 'Baseline',       table: 'bom_factory_baseline',          scope: 'baseline', single: true },
  { sheet: 'SimplifiedLine', table: 'bom_cs_case_simplified_line',   scope: 'case' },
  { sheet: 'QtyScenario',    table: 'bom_cs_case_qty_scenario',      scope: 'case' },
  { sheet: 'Process',        table: 'bom_cs_case_process',           scope: 'case' },
  { sheet: 'IDL-Alloc',      table: 'bom_cs_case_idl_alloc',         scope: 'case' },     // 案級 IDL 分攤(FULL MVA 的 IDL_CPU)
  { sheet: 'IDL-LineWage',   table: 'bom_factory_idl_linedep_wage',  scope: 'baseline' },
  { sheet: 'IDL-Role',       table: 'bom_factory_idl_role',          scope: 'baseline' },
  { sheet: 'Equipment',      table: 'bom_cs_case_equip_area',        scope: 'case' },
  { sheet: 'Facility',       table: 'bom_cs_case_facility',          scope: 'case' },
  { sheet: 'Consumable',     special: 'consumable' },   // master(factory)+case 合併分頁(FULL 用 · 見下方特殊處理)
];
const REQUIRED = {
  SIMPLIFIED_WEARABLE: ['Baseline', 'SimplifiedLine', 'QtyScenario'],
  FULL_MVA: ['Baseline', 'Process', 'IDL-Alloc', 'IDL-LineWage', 'IDL-Role', 'Equipment', 'Facility', 'Consumable'],
};
// Consumable 合併欄(master:code/desc/單價/單位/預設製程 + case:製程/年用量/單價override)
const CONSUMABLE_COLS = ['CONSUMABLE_CODE', 'DESCRIPTION', 'FOXLINK_PART_NO', 'UNIT_COST_USD', 'UNIT_OF_MEASURE', 'DEFAULT_PROCESS_CODE', 'PROCESS_CODE', 'ANNUAL_USAGE_QTY', 'UNIT_COST_OVERRIDE_USD'];
// 不進 Excel 的欄(PK/FK/稽核)· 匯入時也不吃
const SKIP_COLS = new Set(['ID', 'BASELINE_ID', 'CASE_FACTORY_ID', 'SCENARIO_ID', 'LINE_ID', 'TIER_ID', 'CREATED_AT', 'UPDATED_AT', 'CREATED_BY', 'UPDATED_BY', 'AI_CACHE_ID']);
// Baseline 薪資換算輔助欄(拍板§5:月薪 → 時薪;引擎不改)
const WAGE_HELPERS = ['月薪(當地幣)', '薪資匯率', '週工作天', '日工時'];

async function tableCols(db, table) {
  // user_tab_cols(非 columns)才有 virtual/hidden 標記 — VIRTUAL 欄不可 INSERT(如 equip 年化欄)
  const rows = await db.prepare(
    `SELECT column_name FROM user_tab_cols WHERE table_name = ? AND virtual_column='NO' AND hidden_column='NO' ORDER BY column_id`,
  ).all(table.toUpperCase()).catch(() => []);
  return rows.map((r) => String(pick(r, 'column_name'))).filter((c) => !SKIP_COLS.has(c));
}

/** 匯出 caseFactoryId 的完整成本模型 → workbook(範本 = 匯出 fixture)*/
async function exportCostModel(db, caseFactoryId) {
  const cf = await db.prepare(`SELECT case_factory_id, factory_code, costing_model, baseline_id FROM bom_cs_case_factory WHERE case_factory_id=?`).get(caseFactoryId);
  if (!cf) throw new Error('case_factory not found');
  const baselineId = num(pick(cf, 'baseline_id'));
  const model = pick(cf, 'costing_model') || 'SIMPLIFIED_WEARABLE';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Cortex 成本模型(統一格式)'],
    [`costing_model = ${model} · 匯出自 case_factory #${caseFactoryId}(${pick(cf, 'factory_code')})`],
    ['必要分頁:SIMPLIFIED = Baseline+SimplifiedLine+QtyScenario;FULL = Baseline+Process+IDL-LineWage+IDL-Role+Equipment+Facility'],
    ['Baseline.FACTORY_CODE = 目標廠別(需為系統已建廠別 CN/VN/TW…);% 欄整數口徑(4 = 4%)'],
    ['薪資:可直填 DL_WAGE_PER_HR_USD(時薪);或填 月薪(當地幣)+薪資匯率+週工作天+日工時 → 系統自動換算'],
    ['匯入:專案 BOM 區「上傳成本模型」;同專案同廠別已存在 → 擋(避免覆蓋)'],
  ]), '說明');

  for (const s of SHEETS) {
    if (s.special === 'consumable') {
      // 合併匯出:case JOIN master(一列一耗材)
      const rows = await db.prepare(
        `SELECT m.consumable_code, m.description, NVL(cc.foxlink_part_no, m.foxlink_part_no) AS foxlink_part_no,
                m.unit_cost_usd, m.unit_of_measure, m.default_process_code,
                cc.process_code, cc.annual_usage_qty, cc.unit_cost_override_usd
           FROM bom_cs_case_consumable cc JOIN bom_factory_consumable m ON m.consumable_id = cc.consumable_id
          WHERE cc.case_factory_id = ?`,
      ).all(caseFactoryId).catch(() => []);
      const aoa = [CONSUMABLE_COLS, ...rows.map((r) => CONSUMABLE_COLS.map((c) => { const v = pick(r, c); return v == null ? '' : v; }))];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), s.sheet);
      continue;
    }
    const cols = await tableCols(db, s.table);
    if (!cols.length) continue;
    const keyCol = s.scope === 'baseline' ? 'baseline_id' : 'case_factory_id';
    const keyVal = s.scope === 'baseline' ? baselineId : caseFactoryId;
    const rows = await db.prepare(`SELECT ${cols.join(',')} FROM ${s.table} WHERE ${keyCol}=?`).all(keyVal).catch(() => []);
    const header = s.sheet === 'Baseline' ? [...cols, ...WAGE_HELPERS] : cols;
    const aoa = [header, ...rows.map((r) => cols.map((c) => { const v = pick(r, c); return v == null ? '' : v; }))];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), s.sheet);
  }
  return { wb, model, factoryCode: pick(cf, 'factory_code') };
}

/** 找 fixture 範本 cf(costing_model 相符的 CORTEX-FIX-%)→ 匯出當空白範本 */
async function templateWorkbook(db, model) {
  const row = await db.prepare(
    `SELECT cf.case_factory_id FROM bom_cs_case_factory cf JOIN projects p ON p.id = cf.case_id
      WHERE p.project_code LIKE 'CORTEX-FIX-%' AND cf.costing_model = ? ORDER BY cf.case_factory_id FETCH FIRST 1 ROWS ONLY`,
  ).get(model);
  if (!row) throw new Error(`無 ${model} 範本來源(fixture)`);
  return exportCostModel(db, num(pick(row, 'case_factory_id')));
}

/** 薪資換算:月薪(當地幣)/匯率/週工作天/日工時 → 時薪 USD(月工作天 = 週工作天×52/12)*/
function hourlyFromMonthly(row) {
  const monthly = num(pick(row, WAGE_HELPERS[0])), fx = num(pick(row, WAGE_HELPERS[1])) || 1;
  const daysWk = num(pick(row, WAGE_HELPERS[2])), hrsDay = num(pick(row, WAGE_HELPERS[3]));
  if (monthly == null || !daysWk || !hrsDay) return null;
  const daysMonth = daysWk * 52 / 12;
  return (monthly / fx) / (daysMonth * hrsDay);
}

/**
 * 匯入成本模型 → 專案(b 路徑):新 baseline + 新 case_factory + case/baseline 子表。
 * 硬擋:缺必要分頁 / 廠別不存在 / 同專案同廠別已有 case_factory。
 */
async function importCostModel(db, { filePath, projectId, factoryCode: fcOverride = null }) {
  if (!filePath || !projectId) throw new Error('filePath + projectId required');
  const wb = XLSX.readFile(filePath);
  const sheetJson = (name) => {
    const ws = wb.Sheets[name]; if (!ws) return null;
    return XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });   // header-based objects
  };

  const base = sheetJson('Baseline');
  if (!base || !base.length) { const e = new Error('COST_MODEL_MISSING_SHEETS: 缺 Baseline 分頁'); e.code = 'COST_MODEL_MISSING_SHEETS'; e.missing = ['Baseline']; throw e; }
  const bRow = base[0];
  const model = str(pick(bRow, 'costing_model')) || 'SIMPLIFIED_WEARABLE';
  const required = REQUIRED[model] || REQUIRED.SIMPLIFIED_WEARABLE;
  const missing = required.filter((s) => { const d = sheetJson(s); return !d || !d.length; });
  if (missing.length) { const e = new Error(`COST_MODEL_MISSING_SHEETS: ${model} 缺必要分頁 ${missing.join(', ')}`); e.code = 'COST_MODEL_MISSING_SHEETS'; e.missing = missing; throw e; }

  const factoryCode = str(fcOverride) || str(pick(bRow, 'factory_code'));
  if (!factoryCode) throw new Error('factory_code required(Baseline 分頁或參數)');
  const fac = await db.prepare(`SELECT factory_code FROM bom_factory WHERE factory_code=?`).get(factoryCode);
  if (!fac) { const e = new Error(`COST_MODEL_FACTORY_NOT_FOUND: 廠別 ${factoryCode} 不存在(需先建廠別主檔)`); e.code = 'COST_MODEL_FACTORY_NOT_FOUND'; throw e; }
  const dup = await db.prepare(`SELECT case_factory_id FROM bom_cs_case_factory WHERE case_id=? AND factory_code=? AND costing_model=?`).get(projectId, factoryCode, model);
  if (dup) { const e = new Error(`COST_MODEL_CASE_EXISTS: 已存在 ${factoryCode}·${model} 成本模型(cf#${num(pick(dup, 'case_factory_id'))}),不可覆蓋`); e.code = 'COST_MODEL_CASE_EXISTS'; throw e; }

  // 1) baseline(新列 · 薪資換算:時薪空 + 月薪有 → 算)
  const bCols = await tableCols(db, 'bom_factory_baseline');
  const bVals = {};
  for (const c of bCols) { const v = pick(bRow, c); if (v != null && v !== '') bVals[c] = v; }
  bVals.FACTORY_CODE = factoryCode;
  bVals.COSTING_MODEL = model;
  if (bVals.DL_WAGE_PER_HR_USD == null) { const h = hourlyFromMonthly(bRow); if (h != null) bVals.DL_WAGE_PER_HR_USD = Math.round(h * 10000) / 10000; }
  const ins = Object.keys(bVals);
  await db.prepare(`INSERT INTO bom_factory_baseline (${ins.join(',')}) VALUES (${ins.map(() => '?').join(',')})`).run(...ins.map((k) => bVals[k]));
  const baselineId = num(Object.values(await db.prepare(`SELECT MAX(baseline_id) AS m FROM bom_factory_baseline WHERE factory_code=?`).get(factoryCode))[0]);

  // 2) case_factory
  await db.prepare(`INSERT INTO bom_cs_case_factory (case_id, factory_code, baseline_id, costing_model, status) VALUES (?,?,?,?,'draft')`).run(projectId, factoryCode, baselineId, model);
  const caseFactoryId = num(Object.values(await db.prepare(`SELECT MAX(case_factory_id) AS m FROM bom_cs_case_factory WHERE case_id=? AND factory_code=?`).get(projectId, factoryCode))[0]);

  // 3) 子表(header = DB 欄名 · introspection 白名單)· 薪資換算:IDL 週薪空 + 月薪有 → 時薪×日工時×週工作天
  const counts = {};
  const baseDaysWk = num(pick(bRow, WAGE_HELPERS[2])), baseHrsDay = num(pick(bRow, WAGE_HELPERS[3]));
  for (const s of SHEETS) {
    if (s.sheet === 'Baseline') continue;
    const data = sheetJson(s.sheet); if (!data || !data.length) continue;
    if (s.special === 'consumable') {
      // master upsert by (廠別, consumable_code) → case insert(製程取 PROCESS_CODE || 預設)
      let n = 0;
      for (const r of data) {
        const code = str(pick(r, 'CONSUMABLE_CODE')); if (!code) continue;
        let m = await db.prepare(`SELECT consumable_id FROM bom_factory_consumable WHERE factory_code=? AND consumable_code=?`).get(factoryCode, code).catch(() => null);
        if (!m) {
          await db.prepare(
            `INSERT INTO bom_factory_consumable (factory_code, consumable_code, description, foxlink_part_no, unit_cost_usd, unit_of_measure, default_process_code, is_active)
             VALUES (?,?,?,?,?,?,?,1)`,
          ).run(factoryCode, code, str(pick(r, 'DESCRIPTION')), str(pick(r, 'FOXLINK_PART_NO')), num(pick(r, 'UNIT_COST_USD')), str(pick(r, 'UNIT_OF_MEASURE')), str(pick(r, 'DEFAULT_PROCESS_CODE')));
          m = await db.prepare(`SELECT consumable_id FROM bom_factory_consumable WHERE factory_code=? AND consumable_code=?`).get(factoryCode, code);
        }
        await db.prepare(
          `INSERT INTO bom_cs_case_consumable (case_factory_id, consumable_id, process_code, annual_usage_qty, unit_cost_override_usd, foxlink_part_no) VALUES (?,?,?,?,?,?)`,
        ).run(caseFactoryId, num(Object.values(m)[0]), str(pick(r, 'PROCESS_CODE')) || str(pick(r, 'DEFAULT_PROCESS_CODE')), num(pick(r, 'ANNUAL_USAGE_QTY')), num(pick(r, 'UNIT_COST_OVERRIDE_USD')), str(pick(r, 'FOXLINK_PART_NO')));
        n += 1;
      }
      counts[s.sheet] = n;
      continue;
    }
    const cols = await tableCols(db, s.table); if (!cols.length) continue;
    const keyCol = s.scope === 'baseline' ? 'baseline_id' : 'case_factory_id';
    const keyVal = s.scope === 'baseline' ? baselineId : caseFactoryId;
    let n = 0;
    for (const r of data) {
      const vals = {};
      for (const c of cols) { const v = pick(r, c); if (v != null && v !== '') vals[c] = v; }
      if (!Object.keys(vals).length) continue;
      if (s.table === 'bom_factory_idl_linedep_wage' && vals.WEEKLY_WAGE_USD == null) {
        const h = hourlyFromMonthly(r); const dw = num(pick(r, WAGE_HELPERS[2])) || baseDaysWk, hd = num(pick(r, WAGE_HELPERS[3])) || baseHrsDay;
        if (h != null && dw && hd) vals.WEEKLY_WAGE_USD = Math.round(h * hd * dw * 100) / 100;
      }
      const ks = Object.keys(vals);
      await db.prepare(`INSERT INTO ${s.table} (${keyCol},${ks.join(',')}) VALUES (?,${ks.map(() => '?').join(',')})`).run(keyVal, ...ks.map((k) => vals[k]));
      n += 1;
    }
    counts[s.sheet] = n;
  }
  log.log(`importCostModel: project=${projectId} factory=${factoryCode} model=${model} cf#${caseFactoryId} baseline#${baselineId}`, counts);
  return { caseFactoryId, baselineId, factoryCode, costingModel: model, imported: counts };
}

// ── C-2 範本庫(系統保留「範本專案」· 拍板 1=(i))────────────────────────────
const TPL_PROJECT_CODE = 'CORTEX-COST-TPL';

/**
 * ensureTemplateLibrary — 確保範本專案存在(insert-from-select clone fixture 專案列 · 蓋 code/title)
 * + 首次 seed:把 fixture(CORTEX-FIX-%)各 (廠別, 模型) clone 進庫(variantKey=模型 → 同廠多模型共存)。
 * 範本專案不出現在一般專案列表(projectsService.list 過濾)。
 */
async function ensureTemplateLibrary(db) {
  let p = await db.prepare(`SELECT id FROM projects WHERE project_code=?`).get(TPL_PROJECT_CODE).catch(() => null);
  if (!p) {
    const cols = (await db.prepare(
      `SELECT column_name FROM user_tab_cols WHERE table_name='PROJECTS' AND virtual_column='NO' AND hidden_column='NO' ORDER BY column_id`,
    ).all().catch(() => [])).map((r) => String(pick(r, 'column_name'))).filter((c) => c !== 'ID');
    const sel = cols.map((c) => {
      if (c === 'PROJECT_CODE') return `'${TPL_PROJECT_CODE}'`;
      if (c === 'TITLE') return `'成本模型範本庫(系統)'`;
      if (c === 'DATA_PAYLOAD') return `'{"title":"成本模型範本庫(系統)","system":true}'`;
      return c;
    }).join(',');
    await db.prepare(`INSERT INTO projects (${cols.join(',')}) SELECT ${sel} FROM projects WHERE project_code='CORTEX-FIX-WHOOP'`).run();
    p = await db.prepare(`SELECT id FROM projects WHERE project_code=?`).get(TPL_PROJECT_CODE);
    log.log(`ensureTemplateLibrary: created template project #${num(pick(p, 'id'))}`);
  }
  const libId = num(pick(p, 'id'));

  // seed:fixture 各 (廠別, 模型) 尚未入庫 → clone(provisionCase variantKey=模型)
  const provisionSvc = require('./bomCaseProvisionService');
  const fixtures = await db.prepare(
    `SELECT cf.case_factory_id, cf.factory_code, cf.costing_model
       FROM bom_cs_case_factory cf JOIN projects fp ON fp.id = cf.case_id
      WHERE fp.project_code LIKE 'CORTEX-FIX-%' ORDER BY cf.case_factory_id`,
  ).all().catch(() => []);
  const seen = new Set();
  for (const f of fixtures) {
    const fc = pick(f, 'factory_code'), model = pick(f, 'costing_model');
    const key = `${fc}|${model}`;
    if (!fc || !model || seen.has(key)) continue;
    seen.add(key);
    const ex = await db.prepare(`SELECT case_factory_id FROM bom_cs_case_factory WHERE case_id=? AND factory_code=? AND costing_model=?`).get(libId, fc, model).catch(() => null);
    if (ex) continue;
    try {
      await provisionSvc.provisionCase(db, { projectId: libId, sourceCaseFactoryId: num(pick(f, 'case_factory_id')), factoryCode: fc, variantKey: model });
      log.log(`ensureTemplateLibrary: seeded ${fc}·${model} from cf#${num(pick(f, 'case_factory_id'))}`);
    } catch (e) { log.warn(`seed ${key}:`, e.message); }
  }
  return { projectId: libId };
}

/** 匯入到範本庫(a 路徑)*/
async function importToTemplateLibrary(db, { filePath, factoryCode = null }) {
  const lib = await ensureTemplateLibrary(db);
  return importCostModel(db, { filePath, projectId: lib.projectId, factoryCode });
}

module.exports = { exportCostModel, templateWorkbook, importCostModel, ensureTemplateLibrary, importToTemplateLibrary, TPL_PROJECT_CODE };
