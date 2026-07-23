/**
 * bomVariantService.js — BOM 變異維度 + 逐料 effectivity(super-BOM · B-1/B-2)
 *
 * 對應 docs/cortex-bom-source-excel-structure.md §3。
 * 維度(顏色/包裝)per-project 定義;每料 0..N tag;resolve(config)= 共用料 ∪ tag 全命中的料。
 * 匯入自動 upsert 維度/值(不用先設定);向下相容(無 effectivity 列 → 全含)。
 */

const pick = (row, name) => { if (!row) return undefined; const lc = name.toLowerCase(); for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k]; return undefined; };
const str = (v) => (v == null ? null : String(v).trim() || null);

async function ensureDimension(db, projectId, dimCode, dimName = null) {
  const code = str(dimCode); if (!code) return null;
  const ex = await db.prepare(`SELECT id FROM bom_variant_dimension WHERE project_id=? AND dim_code=?`).get(projectId, code).catch(() => null);
  if (ex) return Number(pick(ex, 'id'));
  const r = await db.prepare(`INSERT INTO bom_variant_dimension (project_id, dim_code, dim_name) VALUES (?, ?, ?)`).run(projectId, code, str(dimName) || code);
  return Number(r.lastInsertRowid);
}

async function ensureValue(db, dimensionId, valueCode, valueName = null) {
  const code = str(valueCode); if (!code || !dimensionId) return null;
  const ex = await db.prepare(`SELECT id FROM bom_variant_value WHERE dimension_id=? AND value_code=?`).get(dimensionId, code).catch(() => null);
  if (ex) return Number(pick(ex, 'id'));
  const r = await db.prepare(`INSERT INTO bom_variant_value (dimension_id, value_code, value_name) VALUES (?, ?, ?)`).run(dimensionId, code, str(valueName) || code);
  return Number(r.lastInsertRowid);
}

/** upsert (維度,值) → { dimensionId, valueId }(匯入用 · 不用先設定) */
async function ensureDimensionValue(db, projectId, dimCode, valueCode) {
  const dimensionId = await ensureDimension(db, projectId, dimCode);
  if (!dimensionId) return null;
  const valueId = await ensureValue(db, dimensionId, valueCode);
  if (!valueId) return null;
  return { dimensionId, valueId };
}

/** tag 一料(PK(item,dim) → 先刪再插,避免 dup) */
async function tagItem(db, itemId, dimensionId, valueId) {
  await db.prepare(`DELETE FROM bom_item_effectivity WHERE bom_item_id=? AND dimension_id=?`).run(itemId, dimensionId).catch(() => {});
  await db.prepare(`INSERT INTO bom_item_effectivity (bom_item_id, dimension_id, value_id) VALUES (?, ?, ?)`).run(itemId, dimensionId, valueId);
}

/** lookup(不建)· 回 {dimensionId,valueId} 或 null(B-3a:值必須先定義) */
async function resolveDimensionValue(db, projectId, dimCode, valueCode) {
  const dc = str(dimCode), vc = str(valueCode);
  if (!dc || !vc) return null;
  const r = await db.prepare(
    `SELECT d.id AS dimension_id, v.id AS value_id
       FROM bom_variant_dimension d JOIN bom_variant_value v ON v.dimension_id = d.id
      WHERE d.project_id=? AND d.dim_code=? AND v.value_code=?`,
  ).get(projectId, dc, vc).catch(() => null);
  return r ? { dimensionId: Number(pick(r, 'dimension_id')), valueId: Number(pick(r, 'value_id')) } : null;
}

/** 掃 canonical rows 的 effectivity → 回未定義的 [{dimCode,valueCode}](import 前置驗證 · 硬擋) */
async function collectUndefinedValues(db, projectId, rows) {
  const seen = new Set(), undef = [];
  for (const r of rows || []) {
    for (const e of (r.effectivity || [])) {
      const dc = str(e.dimCode || e.dim), vc = str(e.valueCode || e.value);
      if (!dc || !vc) continue;
      const key = `${dc}=${vc}`; if (seen.has(key)) continue; seen.add(key);
      if (!(await resolveDimensionValue(db, projectId, dc, vc))) undef.push({ dimCode: dc, valueCode: vc });
    }
  }
  return undef;
}

/**
 * MERGE 分開匯入用:刪某 section 內「effectivity 集合 exact = valueIds」的料件(cascade 清 price/flk/mfg/tag)。
 * valueIds 空 → 刪共用料(無 effectivity);非空 → 刪 tag 集合完全等於 valueIds 的料。回刪除數。
 */
async function deleteItemsByScope(db, sectionId, valueIds) {
  const ids = (valueIds || []).map(Number).filter(Boolean);
  let sql, binds;
  if (!ids.length) {
    sql = `SELECT i.id FROM bom_item i JOIN bom_category c ON c.id = i.bom_category_id
            WHERE c.bom_section_id = ? AND NOT EXISTS (SELECT 1 FROM bom_item_effectivity e WHERE e.bom_item_id = i.id)`;
    binds = [sectionId];
  } else {
    const ph = ids.map(() => '?').join(',');
    sql = `SELECT i.id FROM bom_item i JOIN bom_category c ON c.id = i.bom_category_id
            WHERE c.bom_section_id = ?
              AND (SELECT COUNT(*) FROM bom_item_effectivity e WHERE e.bom_item_id = i.id) = ?
              AND NOT EXISTS (SELECT 1 FROM bom_item_effectivity e WHERE e.bom_item_id = i.id AND e.value_id NOT IN (${ph}))`;
    binds = [sectionId, ids.length, ...ids];
  }
  const items = await db.prepare(sql).all(...binds).catch(() => []);
  for (const it of items) await db.prepare(`DELETE FROM bom_item WHERE id=?`).run(Number(pick(it, 'id'))).catch(() => {});
  return items.length;
}

/** 匯入 helper:effectivity=[{dimCode,valueCode}] → lookup(不建)+ tag(未定義跳過 · import 已前置驗證擋下) */
async function applyEffectivity(db, projectId, itemId, effectivity) {
  if (!Array.isArray(effectivity) || !effectivity.length) return 0;
  let n = 0;
  for (const e of effectivity) {
    const dv = await resolveDimensionValue(db, projectId, e.dimCode || e.dim, e.valueCode || e.value);
    if (dv) { await tagItem(db, itemId, dv.dimensionId, dv.valueId); n += 1; }
  }
  return n;
}

// ── 變異軸設定 CRUD(B-3a:先定義,非臨時 LOV)──────────────────────────────
async function createDimension(db, projectId, { dimCode, dimName, sortOrder } = {}) {
  const code = str(dimCode); if (!code) throw new Error('dimCode required');
  const ex = await db.prepare(`SELECT id FROM bom_variant_dimension WHERE project_id=? AND dim_code=?`).get(projectId, code).catch(() => null);
  if (ex) { if (dimName) await db.prepare(`UPDATE bom_variant_dimension SET dim_name=? WHERE id=?`).run(str(dimName), Number(pick(ex, 'id'))); return Number(pick(ex, 'id')); }
  const r = await db.prepare(`INSERT INTO bom_variant_dimension (project_id, dim_code, dim_name, sort_order) VALUES (?,?,?,?)`).run(projectId, code, str(dimName) || code, Number(sortOrder) || 10);
  return Number(r.lastInsertRowid);
}
async function addValue(db, dimensionId, { valueCode, valueName, sortOrder } = {}) {
  const code = str(valueCode); if (!code) throw new Error('valueCode required');
  const ex = await db.prepare(`SELECT id FROM bom_variant_value WHERE dimension_id=? AND value_code=?`).get(dimensionId, code).catch(() => null);
  if (ex) { if (valueName) await db.prepare(`UPDATE bom_variant_value SET value_name=? WHERE id=?`).run(str(valueName), Number(pick(ex, 'id'))); return Number(pick(ex, 'id')); }
  const r = await db.prepare(`INSERT INTO bom_variant_value (dimension_id, value_code, value_name, sort_order) VALUES (?,?,?,?)`).run(dimensionId, code, str(valueName) || code, Number(sortOrder) || 10);
  return Number(r.lastInsertRowid);
}
async function _valueInUse(db, valueId) { return Number(pick(await db.prepare(`SELECT COUNT(*) AS c FROM bom_item_effectivity WHERE value_id=?`).get(valueId).catch(() => ({})), 'c')) || 0; }
// run 引用(variant_value_ids = sorted CSV)· 精確 token 比對避免 '1' 誤中 '11'
async function _valueUsedByRuns(db, valueId) {
  const v = String(Number(valueId));
  const r = await db.prepare(
    `SELECT COUNT(*) AS c FROM bom_cs_run
      WHERE variant_value_ids = ? OR variant_value_ids LIKE ? OR variant_value_ids LIKE ? OR variant_value_ids LIKE ?`,
  ).get(v, `${v},%`, `%,${v}`, `%,${v},%`).catch(() => ({}));
  return Number(pick(r, 'c')) || 0;
}
async function deleteValue(db, valueId) {
  if (await _valueInUse(db, valueId)) throw new Error('此值已被料件使用,不可刪(先重匯或清 tag)');
  if (await _valueUsedByRuns(db, valueId)) throw new Error('此值已有成本試算紀錄引用,不可刪');
  await db.prepare(`DELETE FROM bom_variant_value WHERE id=?`).run(valueId); return { deleted: valueId };
}
async function deleteDimension(db, projectId, dimensionId) {
  const inUse = Number(pick(await db.prepare(`SELECT COUNT(*) AS c FROM bom_item_effectivity WHERE dimension_id=?`).get(dimensionId).catch(() => ({})), 'c')) || 0;
  if (inUse) throw new Error('此維度已被料件使用,不可刪(先重匯或清 tag)');
  const vals = await db.prepare(`SELECT id FROM bom_variant_value WHERE dimension_id=?`).all(dimensionId).catch(() => []);
  for (const v of vals) if (await _valueUsedByRuns(db, Number(pick(v, 'id')))) throw new Error('此維度的值已有成本試算紀錄引用,不可刪');
  await db.prepare(`DELETE FROM bom_variant_dimension WHERE id=? AND project_id=?`).run(dimensionId, projectId); return { deleted: dimensionId };
}

/** 專案的維度 + 值(config 選擇器來源) */
async function listDimensions(db, projectId) {
  const dims = await db.prepare(`SELECT id, dim_code, dim_name, sort_order FROM bom_variant_dimension WHERE project_id=? ORDER BY sort_order, id`).all(projectId).catch(() => []);
  const out = [];
  for (const d of dims) {
    const id = Number(pick(d, 'id'));
    const vals = await db.prepare(`SELECT id, value_code, value_name FROM bom_variant_value WHERE dimension_id=? ORDER BY sort_order, id`).all(id).catch(() => []);
    out.push({
      id, dimCode: pick(d, 'dim_code'), dimName: pick(d, 'dim_name'),
      values: vals.map((v) => ({ id: Number(pick(v, 'id')), valueCode: pick(v, 'value_code'), valueName: pick(v, 'value_name') })),
    });
  }
  return out;
}

/**
 * resolve 過濾 SQL 片段:料件被含 iff 它每個 tag 的 value_id 都在 selectedValueIds 內。
 * selectedValueIds 空 → 不過濾(向下相容 · 無 config = 全含)。
 * 回 { clause, binds };clause 直接接在 WHERE 後(itemAlias.id 需可見)。
 */
function effectivityFilter(selectedValueIds, itemAlias = 'i') {
  const ids = (selectedValueIds || []).map(Number).filter(Boolean);
  if (!ids.length) return { clause: '', binds: [] };
  const ph = ids.map(() => '?').join(',');
  return {
    clause: ` AND NOT EXISTS (SELECT 1 FROM bom_item_effectivity e WHERE e.bom_item_id = ${itemAlias}.id AND e.value_id NOT IN (${ph}))`,
    binds: ids,
  };
}

/** config {dimCode:valueCode} → selectedValueIds(resolve 用) */
async function configToValueIds(db, projectId, config) {
  if (!config || typeof config !== 'object') return [];
  const dims = await listDimensions(db, projectId);
  const ids = [];
  for (const d of dims) {
    const vc = config[d.dimCode] || config[String(d.id)];
    if (vc == null || vc === '') continue;
    const v = d.values.find((x) => x.valueCode === vc || String(x.id) === String(vc));
    if (v) ids.push(v.id);
  }
  return ids;
}

/** instance 內每料的 effectivity tags(明細徽章) → { itemId: [{dim,value}] } */
async function effectivityByInstance(db, instanceId) {
  const rows = await db.prepare(
    `SELECT e.bom_item_id, d.dim_code, v.value_code
       FROM bom_item_effectivity e
       JOIN bom_variant_value v ON v.id = e.value_id
       JOIN bom_variant_dimension d ON d.id = e.dimension_id
       JOIN bom_item i ON i.id = e.bom_item_id
       JOIN bom_category c ON c.id = i.bom_category_id
       JOIN bom_section sec ON sec.id = c.bom_section_id
      WHERE sec.bom_instance_id = ?`,
  ).all(instanceId).catch(() => []);
  const map = {};
  for (const r of rows) {
    const id = Number(pick(r, 'bom_item_id'));
    (map[id] = map[id] || []).push({ dim: pick(r, 'dim_code'), value: pick(r, 'value_code') });
  }
  return map;
}

module.exports = {
  ensureDimension, ensureValue, ensureDimensionValue, tagItem, applyEffectivity,
  resolveDimensionValue, collectUndefinedValues, deleteItemsByScope,
  createDimension, addValue, deleteDimension, deleteValue,
  listDimensions, effectivityFilter, configToValueIds, effectivityByInstance,
};
