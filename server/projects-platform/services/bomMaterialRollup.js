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
  if (!bomInstanceId) return { materialUsd: 0, itemCount: 0, byCategory: {} };

  const rows = await all(
    `SELECT sec.module_category AS cat,
            NVL(SUM(i.qty * s.applied_price_usd),0) AS mat,
            COUNT(*) AS n
       FROM bom_item i
       JOIN bom_category c   ON c.id = i.bom_category_id
       JOIN bom_section  sec ON sec.id = c.bom_section_id
       JOIN bom_item_price_snapshot s ON s.bom_item_id = i.id
      WHERE sec.bom_instance_id = ?
      ${opts.sectionCategory ? 'AND sec.module_category = ?' : ''}
      GROUP BY sec.module_category`,
    ...(opts.sectionCategory ? [bomInstanceId, opts.sectionCategory] : [bomInstanceId]),
  );

  const byCategory = {};
  let materialUsd = 0, itemCount = 0;
  for (const r of rows) {
    const cat = pick(r, 'cat') || 'UNKNOWN';
    const mat = num(pick(r, 'mat'));
    byCategory[cat] = mat;
    materialUsd += mat;
    itemCount += num(pick(r, 'n'));
  }
  return { materialUsd, itemCount, byCategory };
}

module.exports = { rollupMaterial };
