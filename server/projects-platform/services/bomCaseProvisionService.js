/**
 * bomCaseProvisionService.js — §9.4 開案自動建 case_factory(從範本 clone)· 獨立 service
 *
 * 對應 docs/cortex-bom-import-plan.md §9.4。
 * 問題:真實專案(非 fixture)沒有成本模型(case_factory + 9 張 case 級表)→ 算不了成本。
 * 解:選一個「範本」case_factory(廠+model,e.g. fixture CN FULL_MVA),為目標專案建新 case_factory
 *     (共享 baseline_id)+ 複製全部 case 級 rows。之後 RD/採購再依產品實況調整。
 *
 * 空 case 會讓 MVA≈0(無製程/設備)沒用 → 一定要 clone 範本當起點。
 * baseline / process_catalog / linedep_wage 等「廠級」reference 為共享,不 clone。
 * 純寫 013b/c/f/i 結構表;不碰引擎計算。
 */

const pick = (row, name) => { if (!row) return undefined; const lc = name.toLowerCase(); for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k]; return undefined; };

// 引擎 loadCaseInputs 讀的全部 case 級子表(keyed by case_factory_id)· 全 clone
const CASE_CHILD_TABLES = [
  'bom_cs_case_process',
  'bom_cs_case_idl_alloc',
  'bom_cs_case_equip_area',
  'bom_cs_case_facility',
  'bom_cs_case_consumable',
  'bom_cs_case_simplified_line',
  'bom_cs_case_smt_point',
  'bom_cs_case_macro_process',
  'bom_cs_case_qty_scenario',
];

/** 通用 clone:INSERT..SELECT 一張 case 表(排除 identity/virtual 欄 · 把 case_factory_id 換成 newCf)*/
async function cloneCaseTable(db, table, srcCf, newCf) {
  // 非虛擬 + 非 identity 欄(identity/虛擬欄不能 INSERT)
  // bind 綁在 .all() 上(wrapper prepare(sql) 只吃 sql · 見 database-oracle.js:183/213)
  const rows = await db.prepare(
    `SELECT column_name FROM user_tab_cols
      WHERE table_name = UPPER(?) AND virtual_column = 'NO'
        AND column_name NOT IN (SELECT column_name FROM user_tab_columns WHERE table_name = UPPER(?) AND identity_column = 'YES')
      ORDER BY column_id`,
  ).all(table, table).catch(() => []);
  const cols = rows.map((r) => Object.values(r)[0]);
  if (!cols.length) return 0; // 表不存在或全 identity → 跳過
  const insertList = cols.join(', ');
  const selectList = cols.map((c) => (String(c).toUpperCase() === 'CASE_FACTORY_ID' ? String(Number(newCf)) : c)).join(', ');
  const res = await db.prepare(
    `INSERT INTO ${table} (${insertList}) SELECT ${selectList} FROM ${table} WHERE case_factory_id = ?`,
  ).run(srcCf);
  return res.changes || 0;
}

/** 列可選範本(MVP:fixtures CORTEX-FIX-* 當 golden 範本 · 之後可換 is_template flag)*/
async function listTemplates(db) {
  const rows = await db.prepare(
    `SELECT cf.case_factory_id, cf.factory_code, cf.costing_model, cf.baseline_id, p.project_code
       FROM bom_cs_case_factory cf JOIN projects p ON p.id = cf.case_id
      WHERE p.project_code LIKE 'CORTEX-FIX-%'
      ORDER BY cf.case_factory_id`,
  ).all().catch(() => []);
  return rows.map((r) => ({
    caseFactoryId: Number(pick(r, 'case_factory_id')),
    factoryCode: pick(r, 'factory_code'),
    costingModel: pick(r, 'costing_model'),
    projectCode: pick(r, 'project_code'),
  }));
}

/**
 * 為 projectId 建 case_factory(clone 自 sourceCaseFactoryId 範本)。
 * 冪等:同 (project, factory, variant) 已存在 → 回傳既有(reused）。
 */
async function provisionCase(db, { projectId, sourceCaseFactoryId, variantKey = null }) {
  if (!projectId) throw new Error('projectId required');
  if (!sourceCaseFactoryId) throw new Error('sourceCaseFactoryId required');
  const tpl = await db.prepare(`SELECT * FROM bom_cs_case_factory WHERE case_factory_id = ?`).get(sourceCaseFactoryId);
  if (!tpl) throw new Error('template case_factory not found');
  const factoryCode = pick(tpl, 'factory_code');
  const baselineId = pick(tpl, 'baseline_id');
  const model = pick(tpl, 'costing_model');

  const findSql = `SELECT case_factory_id FROM bom_cs_case_factory WHERE case_id=? AND factory_code=? AND ${variantKey == null ? 'variant_key IS NULL' : 'variant_key=?'}`;
  const findBinds = variantKey == null ? [projectId, factoryCode] : [projectId, factoryCode, variantKey];
  const existing = await db.prepare(findSql).get(...findBinds).catch(() => null);
  if (existing) return { caseFactoryId: Number(pick(existing, 'case_factory_id')), factoryCode, costingModel: model, reused: true, cloned: {} };

  // case_factory PK = case_factory_id(非 id)→ wrapper 拿不到 lastInsertRowid,插完 SELECT 回
  await db.prepare(
    `INSERT INTO bom_cs_case_factory (case_id, factory_code, baseline_id, variant_key, costing_model, status)
     VALUES (?, ?, ?, ?, ?, 'draft')`,
  ).run(projectId, factoryCode, baselineId, variantKey, model);
  const created = await db.prepare(findSql).get(...findBinds);
  const newCf = Number(pick(created, 'case_factory_id'));

  const cloned = {};
  for (const t of CASE_CHILD_TABLES) cloned[t.replace('bom_cs_case_', '')] = await cloneCaseTable(db, t, sourceCaseFactoryId, newCf);
  return { caseFactoryId: newCf, factoryCode, costingModel: model, reused: false, cloned };
}

module.exports = { listTemplates, provisionCase, CASE_CHILD_TABLES };
