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
  { sheet: 'MacroProcess',   table: 'bom_cs_case_macro_process',     scope: 'case' },     // 製程段(M3 · SIMPLIFIED 選填)
  { sheet: 'MacroStation',   special: 'macroStation' },  // 製程站(M3 · MACRO_CODE → macro_id 映射)
  { sheet: 'SmtPoint',       table: 'bom_cs_case_smt_point',         scope: 'case' },     // SMT 點數(M3 · SIMPLIFIED 選填)
  { sheet: 'QtyScenario',    table: 'bom_cs_case_qty_scenario',      scope: 'case' },
  { sheet: 'Process',        table: 'bom_cs_case_process',           scope: 'case' },
  { sheet: 'IDL-Alloc',      table: 'bom_cs_case_idl_alloc',         scope: 'case' },     // 案級 IDL 分攤(FULL MVA 的 IDL_CPU)
  { sheet: 'IDL-LineWage',   table: 'bom_factory_idl_linedep_wage',  scope: 'baseline' },
  { sheet: 'IDL-Role',       table: 'bom_factory_idl_role',          scope: 'baseline' },
  { sheet: 'Equipment',      table: 'bom_cs_case_equip_area',        scope: 'case' },
  { sheet: 'Facility',       table: 'bom_cs_case_facility',          scope: 'case' },
  { sheet: 'Consumable',     special: 'consumable' },   // master(factory)+case 合併分頁(FULL 用 · 見下方特殊處理)
  { sheet: 'NRE',            special: 'nre' },          // 專案級一次性工程費(bom_nre_item · 選填)
  { sheet: 'NRE-Config',     special: 'nreConfig' },    // NRE 模式(SEPARATE/AMORTIZED + 攤提量 · 選填)
];
const NRE_COLS = ['CATEGORY', 'ITEM_NO', 'DESCRIPTION', 'QTY', 'UNIT_PRICE_QUOTE', 'UNIT_PRICE_TRUE', 'FACTORY_CODE', 'REMARK'];
const NRE_CFG_COLS = ['NRE_MODE', 'NRE_AMORTIZE_QTY', 'AMORTIZE_SIDE'];
const REQUIRED = {
  SIMPLIFIED_WEARABLE: ['Baseline', 'SimplifiedLine', 'QtyScenario'],
  FULL_MVA: ['Baseline', 'Process', 'IDL-Alloc', 'IDL-LineWage', 'IDL-Role', 'Equipment', 'Facility', 'Consumable'],
};
// Consumable 合併欄(master:code/desc/單價/單位/預設製程 + case:製程/年用量/單價override)
const CONSUMABLE_COLS = ['CONSUMABLE_CODE', 'DESCRIPTION', 'FOXLINK_PART_NO', 'UNIT_COST_USD', 'UNIT_OF_MEASURE', 'DEFAULT_PROCESS_CODE', 'PROCESS_CODE', 'ANNUAL_USAGE_QTY', 'UNIT_COST_OVERRIDE_USD'];
const MACRO_STATION_COLS = ['MACRO_CODE', 'STATION_CODE', 'NAME', 'SFC', 'NUM_STATIONS', 'UPH', 'YIELD_PCT', 'WORK_TIME_SEC', 'DL_HEADCOUNT', 'SORT_ORDER'];
// 不進 Excel 的欄(PK/FK/稽核)· 匯入時也不吃
const SKIP_COLS = new Set(['ID', 'BASELINE_ID', 'CASE_FACTORY_ID', 'SCENARIO_ID', 'LINE_ID', 'TIER_ID', 'CREATED_AT', 'UPDATED_AT', 'CREATED_BY', 'UPDATED_BY', 'AI_CACHE_ID', 'MACRO_ID', 'SMT_POINT_ID', 'STATION_ID']);
// Baseline 薪資換算輔助欄(拍板§5:月薪 → 時薪;引擎不改)
const WAGE_HELPERS = ['月薪(當地幣)', '薪資匯率', '週工作天', '日工時'];

// ── C-2.5 欄位對照(中文/單位/必填)· 必填 = 引擎實際消費;未列欄 = 選填 ──────
// req: 'ALL' | 'SIMPLIFIED' | 'FULL'(該模型必填)
const FIELD_META = {
  Baseline: [
    ['FACTORY_CODE', '廠別碼', 'CN/VN/TW(需為系統廠別)', 'ALL'],
    ['COSTING_MODEL', '成本模型', 'SIMPLIFIED_WEARABLE 或 FULL_MVA', 'ALL'],
    ['DL_WAGE_PER_HR_USD', 'DL 直接人工時薪', 'USD/hr(可空 → 用月薪欄換算)', 'FULL'],
    ['OH_PCT', '製造費用率 OH%', '整數口徑:4 = 4%', 'SIMPLIFIED'],
    ['SGA_PCT', '管銷費率 SGA%', '整數口徑', 'SIMPLIFIED'],
    ['PROFIT_PCT', '利潤率%', '整數口徑', 'SIMPLIFIED'],
    ['OUTBOUND_TRANSPORTATION_PER_UNIT_USD', '每台外運費', 'USD/unit', ''],
    ['ANNUAL_DEMAND_DEFAULT', '預設年需求量', 'pcs/年', ''],
    ['VERSION_LABEL', '基準版本標籤', '如 2026Q3', ''],
    ['月薪(當地幣)', 'DL 月薪(換算用)', '當地幣;搭配匯率/工作天/工時 → 自動算時薪', ''],
    ['薪資匯率', '當地幣→USD 匯率', '如 TWD 31 / RMB 7.2', ''],
    ['週工作天', '每週工作天數', '如 6', ''],
    ['日工時', '每日工時', '如 10', ''],
  ],
  SimplifiedLine: [
    ['LINE_CODE', '成本線代碼', '如 MATERIAL / SMT / FATP / SMT_LOSS', 'SIMPLIFIED'],
    ['LINE_GROUP', '群組', 'MATERIAL(材料·有BOM時自動改用rollup)/ PROCESS(製程)/ LOSS(損耗)', 'SIMPLIFIED'],
    ['COST_PER_UNIT_USD', '每台成本', 'USD/unit', 'SIMPLIFIED'],
    ['SORT_ORDER', '排序', '數字', ''],
  ],
  QtyScenario: [
    ['SCENARIO_CODE', '情境代碼', '如 BASE', 'ALL'],
    ['TARGET_QTY', '目標年量', 'pcs', 'ALL'],
    ['IS_BASELINE', '是否基準情境', '1/0', ''],
  ],
  Process: [
    ['PROCESS_CODE', '製程代碼', '如 SMT_MAIN / BB_ASSY / FATP', 'FULL'],
    ['TAKT_SECONDS', 'TAKT 秒數', '秒/台', ''],
    ['YIELD_PCT', '良率%', '整數口徑', ''],
    ['DL_PER_SHIFT', '每班 DL 人數', '人', ''],
    ['WEEKLY_OUTPUT_OVERRIDE', '週產出覆寫', '台/週(空=由 TAKT 推)', ''],
  ],
  'IDL-Alloc': [
    ['PROCESS_CODE', '製程代碼', '對應 Process 分頁', 'FULL'],
    ['ROLE_CODE', 'IDL 角色代碼', '對應 IDL-Role 分頁', 'FULL'],
    ['MULTIPLIER', '分攤倍率', '如 0.5 = 半個人力', 'FULL'],
  ],
  'IDL-LineWage': [
    ['ROLE_CODE', '線級角色', 'LINE_LEADER / TECHNICIAN / IQC / SUPERVISOR', 'FULL'],
    ['WEEKLY_WAGE_USD', '週薪', 'USD/週(可空 → 月薪欄換算)', ''],
  ],
  'IDL-Role': [
    ['ROLE_CODE', 'IDL 角色代碼', '', 'FULL'],
    ['ANNUAL_RATE_USD', '年薪', 'USD/年', ''],
    ['DISPLAY_NAME_ZH_TW', '中文名稱', '', ''],
  ],
  Equipment: [
    ['PROCESS_CODE', '製程代碼', '', 'FULL'],
    ['BUCKET', '分類', 'EQUIP / MRO', ''],
    ['ANNUAL_COST_USD', '年化成本', 'USD/年(Σ 設備價/年限)', 'FULL'],
    ['APPLY_UTIL', '套稼動率', '1=套(SMT)/ 0=全額', ''],
  ],
  Facility: [
    ['PROCESS_CODE', '製程代碼', '', 'FULL'],
    ['SQFT', '面積', '平方英尺', ''],
    ['SQFT_UNIT_COST_USD', '單位面積年費', 'USD/sqft/年', ''],
  ],
  Consumable: [
    ['CONSUMABLE_CODE', '耗材代碼', '廠內唯一(如 SMT_INDMAT)', 'FULL'],
    ['DESCRIPTION', '描述', '', ''],
    ['UNIT_COST_USD', '單價', 'USD', ''],
    ['PROCESS_CODE', '歸屬製程', '空=用預設製程', ''],
    ['ANNUAL_USAGE_QTY', '年用量', '', ''],
  ],
};
const _reqFields = (sheet, model) => (FIELD_META[sheet] || [])
  .filter(([, , , req]) => req === 'ALL' || (req === 'SIMPLIFIED' && model === 'SIMPLIFIED_WEARABLE') || (req === 'FULL' && model === 'FULL_MVA'))
  .map(([col]) => col);
// #EXAMPLE 註解列(空白範本示範用 · 匯入一律略過)
const _isCommentRow = (r) => Object.values(r || {}).some((v) => typeof v === 'string' && v.trim().startsWith('#'));

async function tableCols(db, table) {
  // user_tab_cols(非 columns)才有 virtual/hidden 標記 — VIRTUAL 欄不可 INSERT(如 equip 年化欄)
  const rows = await db.prepare(
    `SELECT column_name FROM user_tab_cols WHERE table_name = ? AND virtual_column='NO' AND hidden_column='NO' ORDER BY column_id`,
  ).all(table.toUpperCase()).catch(() => []);
  return rows.map((r) => String(pick(r, 'column_name'))).filter((c) => !SKIP_COLS.has(c));
}

/** 匯出 caseFactoryId 的完整成本模型 → workbook(範本 = 匯出 fixture)*/
async function exportCostModel(db, caseFactoryId) {
  const cf = await db.prepare(`SELECT case_factory_id, case_id, factory_code, costing_model, baseline_id FROM bom_cs_case_factory WHERE case_factory_id=?`).get(caseFactoryId);
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

  const projId = num(pick(cf, 'case_id'));
  for (const s of SHEETS) {
    if (s.special === 'nre') {
      const rows = await db.prepare(
        `SELECT category, item_no, description, qty, unit_price_quote, unit_price_true, factory_code, remark FROM bom_nre_item WHERE project_id=? ORDER BY sort_order, id`,
      ).all(projId).catch(() => []);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([NRE_COLS, ...rows.map((r) => NRE_COLS.map((c) => { const v = pick(r, c); return v == null ? '' : v; }))]), s.sheet);
      continue;
    }
    if (s.special === 'nreConfig') {
      const r = await db.prepare(`SELECT nre_mode, nre_amortize_qty, amortize_side FROM bom_nre_config WHERE project_id=?`).get(projId).catch(() => null);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([NRE_CFG_COLS, r ? NRE_CFG_COLS.map((c) => { const v = pick(r, c); return v == null ? '' : v; }) : []]), s.sheet);
      continue;
    }
    if (s.special === 'macroStation') {
      const rows = await db.prepare(
        `SELECT mp.macro_code, ms.station_code, ms.name, ms.sfc, ms.num_stations, ms.uph, ms.yield_pct, ms.work_time_sec, ms.dl_headcount, ms.sort_order
           FROM bom_cs_case_macro_station ms JOIN bom_cs_case_macro_process mp ON mp.macro_id = ms.macro_id
          WHERE ms.case_factory_id = ? ORDER BY mp.macro_code, ms.sort_order, ms.station_code`,
      ).all(caseFactoryId).catch(() => []);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(
        [MACRO_STATION_COLS, ...rows.map((r) => MACRO_STATION_COLS.map((c) => { const v = pick(r, c); return v == null ? '' : v; }))],
      ), s.sheet);
      continue;
    }
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

/** 找 fixture/庫 範本 cf(costing_model 相符)→ 匯出當樣例範本 */
async function templateWorkbook(db, model) {
  const row = await db.prepare(
    `SELECT cf.case_factory_id FROM bom_cs_case_factory cf JOIN projects p ON p.id = cf.case_id
      WHERE (p.project_code LIKE 'CORTEX-FIX-%' OR p.project_code = 'CORTEX-COST-TPL') AND cf.costing_model = ?
      ORDER BY cf.case_factory_id FETCH FIRST 1 ROWS ONLY`,
  ).get(model);
  if (!row) throw new Error(`無 ${model} 範本來源(fixture)`);
  return exportCostModel(db, num(pick(row, 'case_factory_id')));
}

/**
 * 空白範本(C-2.5):header + #EXAMPLE 範例列(取樣例前 2 列 · 首格前綴 # → 匯入自動略過)
 * + 「說明」分頁 = 完整欄位對照總表(分頁/欄位/中文/單位口徑/必填/該模型必要分頁)。
 */
// 逐頁簽填寫指南(C-2.5+:成本模型比 BOM 複雜,每頁簽講清楚 作用/誰填/怎麼填)
const SHEET_GUIDE = {
  Baseline: ['廠別成本基準(兩種模型都必填 · 一列 = 一廠別)', 'EPM / 成本中心', [
    'FACTORY_CODE(CN/VN/TW)+ COSTING_MODEL 必填,決定整份檔的模型與必要頁簽',
    'SIMPLIFIED 必填:OH_PCT / SGA_PCT / PROFIT_PCT(整數口徑 4 = 4%);選填 OUTBOUND_TRANSPORTATION_PER_UNIT_USD(每台運費)',
    'FULL 必填:DL_WAGE_PER_HR_USD(DL 時薪 USD)— 或改填「月薪(當地幣)+薪資匯率+週工作天+日工時」由系統換算',
    'ANNUAL_DEMAND_DEFAULT = 預設年需求量(無 QtyScenario 時的分攤基礎)',
  ]],
  SimplifiedLine: ['SIMPLIFIED 每台成本線(穿戴模型的核心 · 一列 = 一條線)', 'EPM', [
    'LINE_GROUP 三選一:MATERIAL(材料/台 · 專案匯入 BOM 後自動改用 BOM rollup,此處為 fallback)',
    'PROCESS(加工費/台:SMT、組裝測試、FATP…)· LOSS(良率損耗/台)',
    'COST_PER_UNIT_USD = 每台 USD;SORT_ORDER 控制顯示順序',
    '成本公式:Σ(MATERIAL+PROCESS+LOSS) = subtotal → ×OH% ×SGA% ×Profit% + 運費 = 報價',
  ]],
  QtyScenario: ['數量情境(一列 = 一個年量)', 'EPM / PM', [
    'SCENARIO_CODE 必填(至少一筆,慣用 BASE)· TARGET_QTY = 年量(設備/NRE 攤提分母)',
    'IS_BASELINE = 1 標記基準情境',
  ]],
  Process: ['製程站設定(FULL · 一列 = 一站:SMT_MAIN / BB_ASSY / FATP…)', 'EPM / IE', [
    'TAKT_SECONDS + EFFICIENCY_PCT + YIELD_PCT → 推算週產出;WEEKLY_OUTPUT_OVERRIDE 可直接指定(蓋過推算)',
    'DL_PER_SHIFT 等人力欄 → DL 成本;WORKING_HOURS_PER_DAY / DAYS_PER_WEEK / SHIFTS_PER_DAY 決定工時基礎',
    'PROCESS_CODE 是其他頁簽(IDL-Alloc / Equipment / Facility / Consumable)的關聯鍵,要一致',
  ]],
  'IDL-Alloc': ['IDL 分攤(FULL · 一列 = 製程 × 角色 × 倍率)', 'EPM', [
    'ROLE_CODE 需在 IDL-Role 頁定義;MULTIPLIER = 分攤倍率(0.5 = 半個人力攤到此製程)',
    '漏填會讓 MVA 少算 IDL 分項(系統擋必填)',
  ]],
  'IDL-LineWage': ['線級 IDL 週薪(FULL · LINE_LEADER / TECHNICIAN / IQC / SUPERVISOR)', 'EPM / HR', [
    'WEEKLY_WAGE_USD 直填;或填月薪欄位由系統換算(時薪 × 日工時 × 週工作天)',
  ]],
  'IDL-Role': ['廠務/工程 IDL 角色年薪(FULL)', 'EPM / HR', [
    'ROLE_CODE + ANNUAL_RATE_USD(年薪 USD);IDL-Alloc 引用這裡的 ROLE_CODE',
  ]],
  Equipment: ['設備年化(FULL · 一列 = 一製程的設備分攤)', 'EPM / 設備', [
    'ANNUAL_COST_USD = Σ(設備購置價 ÷ 使用年限);BUCKET = EQUIP(設備)/ MRO(維護)',
    'APPLY_UTIL = 1 → 按 SMT 稼動率折算(SMT 區);0 → 全額分攤(BB/組裝區)',
  ]],
  Facility: ['廠房分攤(FULL · 面積 × 單價)', 'EPM / 廠務', [
    'SQFT(面積)× SQFT_UNIT_COST_USD(USD/sqft/年)= 年廠房費;APPLY_UTIL 同 Equipment',
  ]],
  Consumable: ['耗材(FULL · 主檔+用量一頁搞定)', 'EPM / 採購', [
    'CONSUMABLE_CODE 廠內唯一(如 SMT_INDMAT);UNIT_COST_USD 單價;ANNUAL_USAGE_QTY 年用量',
    'PROCESS_CODE = 歸屬製程(決定分攤位置,空 = 用 DEFAULT_PROCESS_CODE)',
  ]],
};

async function blankTemplateWorkbook(db, model) {
  const { wb: src } = await templateWorkbook(db, model);
  const wb = XLSX.utils.book_new();
  const required = REQUIRED[model] || REQUIRED.SIMPLIFIED_WEARABLE;

  // ① 說明:總覽 + 快速開始 + 模型差異
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Cortex 成本模型 — 標準範本(非 BOM 成本:費率 / 製程 / 人力 / 設備 / 廠房 / 耗材)'],
    [],
    ['█ 快速開始'],
    ['1. 選成本模型:SIMPLIFIED_WEARABLE(穿戴/簡化)或 FULL_MVA(完整製造分攤)— 填在 Baseline.COSTING_MODEL'],
    [`2. 本檔 model = ${model};必要頁簽:${required.join(' + ')}(缺 → 匯入擋下並列出)`],
    ['3. #EXAMPLE 開頭的列是範例(匯入自動略過),請填在範例列下方'],
    ['4. % 一律整數口徑(4 = 4%);金額 USD;薪資可填「月薪(當地幣)+匯率+週工作天+日工時」自動換算'],
    ['5. 填完 → 專案 📦 BOM「匯入模型」(單案用)或「存入範本庫」命名(各專案可 ＋廠別 clone)'],
    ['6. 同名稱再存入範本庫 = 新版生效、舊版自動留歷史(版本化)'],
    [],
    ['█ 兩種模型差異'],
    ['SIMPLIFIED_WEARABLE:材料+製程線+損耗 → subtotal → ×OH% ×SGA% ×Profit% + 運費(WHOOP 型)'],
    ['  只填 3 頁:Baseline / SimplifiedLine / QtyScenario'],
    ['FULL_MVA:BOM 材料 + MVA(DL/IDL/設備/廠房/耗材逐項分攤)+ SGA/Profit(Rival3 型)'],
    ['  填 8 頁:Baseline / Process / IDL-Alloc / IDL-LineWage / IDL-Role / Equipment / Facility / Consumable'],
    [],
    ['█ 各頁簽怎麼填 → 見「填寫指南」分頁;逐欄定義 → 見「欄位對照」分頁'],
  ]), '說明');
  wb.Sheets['說明']['!cols'] = [{ wch: 110 }];

  // ② 填寫指南:逐頁簽敘事(作用 / 誰填 / 怎麼填)
  const g2 = [['頁簽', '作用', '誰填', '填寫要點']];
  for (const s of SHEETS) {
    const gd = SHEET_GUIDE[s.sheet]; if (!gd) continue;
    const isReq = required.includes(s.sheet);
    const [role, owner, points] = gd;
    g2.push([`${s.sheet}${isReq ? '(必要)' : '(此模型免填)'}`, role, owner, points[0] || '']);
    for (let i = 1; i < points.length; i++) g2.push(['', '', '', points[i]]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(g2), '填寫指南');
  wb.Sheets['填寫指南']['!cols'] = [{ wch: 24 }, { wch: 44 }, { wch: 14 }, { wch: 96 }];

  // ③ 欄位對照:逐欄定義表
  const g3 = [['頁簽', '欄位', '中文說明', '單位 / 口徑', '必填']];
  for (const s of SHEETS) {
    const metas = FIELD_META[s.sheet] || [];
    const reqSet = new Set(_reqFields(s.sheet, model));
    const isReqSheet = required.includes(s.sheet);
    for (const [col, zh, unit] of metas) {
      g3.push([s.sheet + (isReqSheet ? '' : '(選填頁)'), col, zh, unit, reqSet.has(col) ? '必填' : '']);
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(g3), '欄位對照');
  wb.Sheets['欄位對照']['!cols'] = [{ wch: 22 }, { wch: 34 }, { wch: 24 }, { wch: 40 }, { wch: 6 }];
  for (const name of src.SheetNames) {
    if (name === '說明') continue;
    const aoa = XLSX.utils.sheet_to_json(src.Sheets[name], { header: 1, raw: true, defval: '' });
    if (!aoa.length) continue;
    const out = [aoa[0]];
    for (const r of aoa.slice(1, 3)) {   // 樣例前 2 列 → #EXAMPLE
      const row = [...r];
      row[0] = `#EXAMPLE ${row[0] ?? ''}`.trim();
      out.push(row);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(out), name);
  }
  return { wb, model };
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
async function importCostModel(db, { filePath, projectId, factoryCode: fcOverride = null, templateLabel = null, isTemplateLib = false }) {
  if (!filePath || !projectId) throw new Error('filePath + projectId required');
  const wb = XLSX.readFile(filePath);
  const sheetJson = (name) => {
    const ws = wb.Sheets[name]; if (!ws) return null;
    const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });   // header-based objects
    return rows.filter((r) => !_isCommentRow(r));                             // C-2.5:#EXAMPLE 範例列略過
  };

  const base = sheetJson('Baseline');
  if (!base || !base.length) { const e = new Error('COST_MODEL_MISSING_SHEETS: 缺 Baseline 分頁(或只有範例列)'); e.code = 'COST_MODEL_MISSING_SHEETS'; e.missing = ['Baseline']; throw e; }
  const bRow = base[0];
  const model = str(pick(bRow, 'costing_model')) || 'SIMPLIFIED_WEARABLE';
  const required = REQUIRED[model] || REQUIRED.SIMPLIFIED_WEARABLE;
  const missing = required.filter((s) => { const d = sheetJson(s); return !d || !d.length; });
  if (missing.length) { const e = new Error(`COST_MODEL_MISSING_SHEETS: ${model} 缺必要分頁 ${missing.join(', ')}`); e.code = 'COST_MODEL_MISSING_SHEETS'; e.missing = missing; throw e; }

  // C-2.5 必填欄硬擋(逐分頁逐列)+ 數值異常警告(不擋)
  const fieldErrors = [], warnings = [];
  const pctCols = new Set(['OH_PCT', 'SGA_PCT', 'PROFIT_PCT', 'YIELD_PCT', 'EFFICIENCY_PCT', 'VAT_RATE_PCT', 'SMT_ALLOWANCE_PCT', 'LOSS_FACTOR_PCT']);
  for (const s of SHEETS) {
    const data = sheetJson(s.sheet); if (!data || !data.length) continue;
    const reqCols = _reqFields(s.sheet, model);
    data.forEach((r, i) => {
      for (const c of reqCols) {
        const v = pick(r, c);
        if (v == null || v === '') {
          if (s.sheet === 'Baseline' && c === 'DL_WAGE_PER_HR_USD' && hourlyFromMonthly(r) != null) continue;   // 月薪換算可補
          fieldErrors.push(`[${s.sheet}] 第 ${i + 1} 列缺必填欄 ${c}`);
        }
      }
      for (const [k, v] of Object.entries(r)) {
        const kk = String(k).toUpperCase();
        // % 超界 = 硬擋(DB NUMBER(6,4) 也塞不下;給乾淨錯誤而非 ORA-01438)
        if (pctCols.has(kk) && v != null && v !== '' && (num(v) < 0 || num(v) > 100)) fieldErrors.push(`[${s.sheet}] 第 ${i + 1} 列 ${kk}=${v} 超出 0–100(整數口徑 4=4%)`);
        if ((kk === 'DL_WAGE_PER_HR_USD' || kk === 'WEEKLY_WAGE_USD' || kk === 'ANNUAL_RATE_USD') && v != null && v !== '' && num(v) <= 0) warnings.push(`[${s.sheet}] 第 ${i + 1} 列 ${kk}=${v} ≤ 0`);
        if (kk === 'LINE_GROUP' && v && !/^(MATERIAL|PROCESS|LOSS)$/i.test(String(v))) warnings.push(`[${s.sheet}] 第 ${i + 1} 列 LINE_GROUP=${v} 不在 MATERIAL/PROCESS/LOSS`);
        if (kk === 'TARGET_QTY' && v != null && v !== '' && num(v) <= 0) warnings.push(`[${s.sheet}] 第 ${i + 1} 列 TARGET_QTY ≤ 0`);
      }
    });
  }
  if (fieldErrors.length) { const e = new Error(`COST_MODEL_MISSING_FIELDS: ${fieldErrors.slice(0, 10).join(';')}${fieldErrors.length > 10 ? ` …共 ${fieldErrors.length} 項` : ''}`); e.code = 'COST_MODEL_MISSING_FIELDS'; e.fieldErrors = fieldErrors; throw e; }

  const factoryCode = str(fcOverride) || str(pick(bRow, 'factory_code'));
  if (!factoryCode) throw new Error('factory_code required(Baseline 分頁或參數)');
  const fac = await db.prepare(`SELECT factory_code FROM bom_factory WHERE factory_code=?`).get(factoryCode);
  if (!fac) { const e = new Error(`COST_MODEL_FACTORY_NOT_FOUND: 廠別 ${factoryCode} 不存在(需先建廠別主檔)`); e.code = 'COST_MODEL_FACTORY_NOT_FOUND'; throw e; }
  // dup 檢查:一般專案 = (專案, 廠別, 模型);範本庫 = label 對現行版唯一
  // C-3 版本化:同 label 再存 → 舊版自動停用(is_active=0 留歷史),新版入庫
  let supersededCf = null;
  if (isTemplateLib) {
    if (!str(templateLabel)) { const e = new Error('COST_MODEL_LABEL_REQUIRED: 存入範本庫需填範本名稱(label)'); e.code = 'COST_MODEL_LABEL_REQUIRED'; throw e; }
    const dupL = await db.prepare(`SELECT case_factory_id FROM bom_cs_case_factory WHERE case_id=? AND template_label=? AND NVL(is_active,1)=1`).get(projectId, str(templateLabel));
    if (dupL) {
      supersededCf = num(pick(dupL, 'case_factory_id'));
      await db.prepare(`UPDATE bom_cs_case_factory SET is_active=0 WHERE case_factory_id=?`).run(supersededCf);
      log.log(`importCostModel: template label「${str(templateLabel)}」新版取代 → 舊版 cf#${supersededCf} 停用(留歷史)`);
    }
  } else {
    const dup = await db.prepare(`SELECT case_factory_id FROM bom_cs_case_factory WHERE case_id=? AND factory_code=? AND costing_model=?`).get(projectId, factoryCode, model);
    if (dup) { const e = new Error(`COST_MODEL_CASE_EXISTS: 已存在 ${factoryCode}·${model} 成本模型(cf#${num(pick(dup, 'case_factory_id'))}),不可覆蓋`); e.code = 'COST_MODEL_CASE_EXISTS'; throw e; }
  }

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

  // 2) case_factory(範本庫帶 label;variant_key = TPL-{baselineId}:每版唯一 · 不撞 UQ_CSF(case,factory,variant)
  //    CJK label 不可直塞(VARCHAR2(40) byte 上限);同 label 版本化後 hash 也會撞 → 用 baselineId)
  const vkey = isTemplateLib ? `TPL-${baselineId}` : null;
  await db.prepare(
    `INSERT INTO bom_cs_case_factory (case_id, factory_code, baseline_id, costing_model, status, template_label, variant_key, is_active, effective_from) VALUES (?,?,?,?,'draft',?,?,1,SYSTIMESTAMP)`,
  ).run(projectId, factoryCode, baselineId, model, str(templateLabel), vkey);
  const caseFactoryId = num(Object.values(await db.prepare(`SELECT MAX(case_factory_id) AS m FROM bom_cs_case_factory WHERE case_id=? AND factory_code=?`).get(projectId, factoryCode))[0]);

  // 3) 子表(header = DB 欄名 · introspection 白名單)· 薪資換算:IDL 週薪空 + 月薪有 → 時薪×日工時×週工作天
  const counts = {};
  const baseDaysWk = num(pick(bRow, WAGE_HELPERS[2])), baseHrsDay = num(pick(bRow, WAGE_HELPERS[3]));
  for (const s of SHEETS) {
    if (s.sheet === 'Baseline') continue;
    const data = sheetJson(s.sheet); if (!data || !data.length) continue;
    if (s.special === 'nre') {
      // 專案級 NRE:replace(範本檔為 SOT)· 一般專案/範本庫都寫在該 project 下
      await db.prepare(`DELETE FROM bom_nre_item WHERE project_id=?`).run(projectId).catch(() => {});
      let n = 0;
      for (const r of data) {
        const desc = str(pick(r, 'DESCRIPTION')); const cat = str(pick(r, 'CATEGORY'));
        if (!desc && !cat) continue;
        await db.prepare(
          `INSERT INTO bom_nre_item (project_id, category, item_no, description, qty, unit_price_quote, unit_price_true, factory_code, remark, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(projectId, cat || 'OTHER', str(pick(r, 'ITEM_NO')), desc, num(pick(r, 'QTY')) ?? 1, num(pick(r, 'UNIT_PRICE_QUOTE')), num(pick(r, 'UNIT_PRICE_TRUE')), str(pick(r, 'FACTORY_CODE')), str(pick(r, 'REMARK')), (n + 1) * 10);
        n += 1;
      }
      counts[s.sheet] = n;
      continue;
    }
    if (s.special === 'nreConfig') {
      const r = data[0];
      const mode = str(pick(r, 'NRE_MODE'));
      if (mode) {
        const ex = await db.prepare(`SELECT project_id FROM bom_nre_config WHERE project_id=?`).get(projectId).catch(() => null);
        const qty = num(pick(r, 'NRE_AMORTIZE_QTY')); const side = str(pick(r, 'AMORTIZE_SIDE')) || 'quote';
        if (ex) await db.prepare(`UPDATE bom_nre_config SET nre_mode=?, nre_amortize_qty=?, amortize_side=?, updated_at=SYSTIMESTAMP WHERE project_id=?`).run(mode, qty, side, projectId);
        else await db.prepare(`INSERT INTO bom_nre_config (project_id, nre_mode, nre_amortize_qty, amortize_side) VALUES (?,?,?,?)`).run(projectId, mode, qty, side);
        counts[s.sheet] = 1;
      }
      continue;
    }
    if (s.special === 'macroStation') {
      // MACRO_CODE → macro_id(段須先由 MacroProcess 分頁建立;新 cf 空表直插)
      let n = 0;
      for (const r of data) {
        const mcode = str(pick(r, 'MACRO_CODE')); const scode = str(pick(r, 'STATION_CODE'));
        if (!mcode || !scode) continue;
        const mp = await db.prepare(
          `SELECT macro_id FROM bom_cs_case_macro_process WHERE case_factory_id=? AND UPPER(macro_code)=UPPER(?)`,
        ).get(caseFactoryId, mcode).catch(() => null);
        if (!mp) { warnings.push(`MacroStation:段 ${mcode} 不存在(MacroProcess 分頁未定義)→ 站 ${scode} 跳過`); continue; }
        await db.prepare(
          `INSERT INTO bom_cs_case_macro_station (case_factory_id, macro_id, station_code, name, sfc, num_stations, uph, yield_pct, work_time_sec, dl_headcount, sort_order)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(caseFactoryId, num(Object.values(mp)[0]), scode, str(pick(r, 'NAME')), str(pick(r, 'SFC')),
          num(pick(r, 'NUM_STATIONS')) ?? 1, num(pick(r, 'UPH')), num(pick(r, 'YIELD_PCT')) ?? 1,
          num(pick(r, 'WORK_TIME_SEC')), num(pick(r, 'DL_HEADCOUNT')) ?? 1, num(pick(r, 'SORT_ORDER')) ?? ((n + 1) * 10));
        n += 1;
      }
      counts[s.sheet] = n;
      continue;
    }
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
  log.log(`importCostModel: project=${projectId} factory=${factoryCode} model=${model} cf#${caseFactoryId} baseline#${baselineId} warn=${warnings.length}`, counts);
  return { caseFactoryId, baselineId, factoryCode, costingModel: model, templateLabel: str(templateLabel), imported: counts, warnings, supersededCf };
}

/** 停用/啟用 範本(C-3 · 範本庫內)*/
async function setTemplateActive(db, caseFactoryId, active) {
  const lib = await ensureTemplateLibrary(db);
  const r = await db.prepare(`SELECT case_factory_id FROM bom_cs_case_factory WHERE case_factory_id=? AND case_id=?`).get(caseFactoryId, lib.projectId);
  if (!r) throw new Error('template not found in library');
  await db.prepare(`UPDATE bom_cs_case_factory SET is_active=? WHERE case_factory_id=?`).run(active ? 1 : 0, caseFactoryId);
  return { caseFactoryId: num(caseFactoryId), isActive: active ? 1 : 0 };
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

/** 匯入到範本庫(a 路徑 · label 必填 · 同組合多套)*/
async function importToTemplateLibrary(db, { filePath, factoryCode = null, templateLabel = null }) {
  const lib = await ensureTemplateLibrary(db);
  return importCostModel(db, { filePath, projectId: lib.projectId, factoryCode, templateLabel, isTemplateLib: true });
}

module.exports = { exportCostModel, templateWorkbook, blankTemplateWorkbook, importCostModel, ensureTemplateLibrary, importToTemplateLibrary, setTemplateActive, TPL_PROJECT_CODE };
