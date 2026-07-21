/**
 * bomMaterialRollup.js — BOM material rollup(B-2 · 獨立 service · 引擎解耦)
 *
 * 對應 docs/cortex-bom-import-plan.md §4:「rollup 是獨立 service,computeCase 只收一個數」。
 *
 * rollupMaterial:Σ(bom_item.qty × snapshot.applied_price)over 一個 bom_instance 的所有 section。
 *   - B-1 現況:instance 只有 EE section → = EE 材料(6.0168)
 *   - B-2b/B-4:同 instance 匯入 ME/PKG section 後,**自動含 EE+ME+PKG**(本函數無需改)
 *     → 對 Unit Cost「Black/White Material Cost」(8.517/8.732)
 *
 * 只讀 013b 結構表,不碰引擎;computeCase 在 FULL 路徑用它當 material_true(motherboard)。
 */

const num = (v) => (typeof v === 'number' ? v : (v == null || v === '' ? 0 : Number(v) || 0));
const pick = (row, name) => { if (!row) return undefined; const lc = name.toLowerCase(); for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k]; return undefined; };

/**
 * @param {number} bomInstanceId
 * @param {object} [opts] { sectionCategory: 'EE'|'ME'|null }(選填 · 限某料別)
 * @returns { materialUsd, itemCount, byCategory: {EE, ME, ...} }
 */
async function rollupMaterial(db, bomInstanceId, opts = {}) {
  const all = (sql, ...a) => db.prepare(sql).all(...a).catch(() => []);
  if (!bomInstanceId) return { materialUsd: 0, itemCount: 0, pricedCount: 0, pendingCount: 0, byCategory: {} };

  // B-5b per-vendor:一料件可有多筆 snapshot(每 vendor 一筆),只取 is_chosen=1 那筆的 applied_price。
  //   chosen 但 applied=NULL(PENDING placeholder)→ 待詢價;無任何 snapshot 也算 pending(LEFT JOIN)。
  //   pending_n = 待詢價料件數;priced_n = 已有價料件數;materialUsd 只算已詢價。
  // chosen snapshot 的 quote(applied_price)+ chosen tier 的 true_cost(無 tier → fallback quote)
  //   materialUsd = Σ qty×quote(對客報價材料)· materialTrueUsd = Σ qty×true(內部真實成本材料)
  //   兩者差 = 料件層 markup(SD §19:利潤主要藏這)· B-5a template 料 true=quote(無 markup)
  // B-2 super-BOM:opts.valueIds(config 選中的值)→ 只 rollup resolve 後的料(無 tag 恆含 · 空=全含)
  const ef = require('./bomVariantService').effectivityFilter(opts.valueIds, 'i');
  const binds = [bomInstanceId];
  if (opts.sectionCategory) binds.push(opts.sectionCategory);
  binds.push(...ef.binds);
  const rows = await all(
    `SELECT sec.module_category AS cat,
            NVL(SUM(i.qty * ch.quote_price),0) AS mat,
            NVL(SUM(i.qty * ch.true_cost),0)   AS mat_true,
            COUNT(*) AS n,
            COUNT(ch.quote_price) AS priced_n,
            COUNT(CASE WHEN ch.quote_price IS NULL THEN 1 END) AS pending_n
       FROM bom_item i
       JOIN bom_category c   ON c.id = i.bom_category_id
       JOIN bom_section  sec ON sec.id = c.bom_section_id
       LEFT JOIN (
         SELECT s.bom_item_id,
                s.applied_price_usd AS quote_price,
                NVL(MAX(t.true_cost_usd), s.applied_price_usd) AS true_cost
           FROM bom_item_price_snapshot s
           LEFT JOIN bom_item_price_tier t ON t.snapshot_id = s.id AND t.is_chosen = 1
          WHERE s.is_chosen = 1
          GROUP BY s.bom_item_id, s.applied_price_usd
       ) ch ON ch.bom_item_id = i.id
      WHERE sec.bom_instance_id = ?
      ${opts.sectionCategory ? 'AND sec.module_category = ?' : ''}${ef.clause}
      GROUP BY sec.module_category`,
    ...binds,
  );

  const byCategory = {};
  let materialUsd = 0, materialTrueUsd = 0, itemCount = 0, pricedCount = 0, pendingCount = 0;
  for (const r of rows) {
    const cat = pick(r, 'cat') || 'UNKNOWN';
    const mat = num(pick(r, 'mat'));
    byCategory[cat] = mat;
    materialUsd += mat;
    materialTrueUsd += num(pick(r, 'mat_true'));
    itemCount += num(pick(r, 'n'));
    pricedCount += num(pick(r, 'priced_n'));
    pendingCount += num(pick(r, 'pending_n'));
  }
  return { materialUsd, materialTrueUsd, itemCount, pricedCount, pendingCount, byCategory };
}

module.exports = { rollupMaterial };
