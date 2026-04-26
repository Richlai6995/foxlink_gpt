'use strict';

/**
 * PM ERP Sync Seed — Phase 5 Track A
 *
 * 自動 seed 三個 ERP 同步 job 範本(全部預設 is_active=0 + is_dry_run=1):
 *   1. [PM-ERP] BOM 金屬含量同步       → pm_bom_metal
 *   2. [PM-ERP] 採購單歷史 12 月      → pm_purchase_history
 *   3. [PM-ERP] 在途 + 安全庫存       → pm_inventory
 *
 * SQL 用 EBS 標準 schema(APPS.* / INV.* / PO.* / BOM.*),但實際每家公司
 * customization 不同,user 必須在 admin UI:
 *   1. 改 source_query 對應實際 table / column
 *   2. 改 mapping_json
 *   3. preview 確認 row 對
 *   4. 改 is_dry_run = 0 真執行
 *   5. 改 is_active = 1 開啟 cron
 *
 * 升級策略:跟 forecastSkillSeed 一樣,name UNIQUE → 已存在則 skip(不覆蓋 user 改的 SQL)
 */

const SEEDS = [
  {
    name: '[PM-ERP] BOM 金屬含量同步',
    description: '從 EBS BOM 模組撈每個產品的金屬含量(grams),寫進 pm_bom_metal。取代 admin 手動上傳 CSV。',
    target_pm_table: 'pm_bom_metal',
    source_query: `-- EBS BOM 範本,實際請改成貴公司 customization
-- 假設:item.attribute1 標金屬代碼(Au/Ag/Cu...),component.component_quantity 是含量(g)
SELECT
  msi.segment1               AS product_id,
  msi.attribute1             AS metal_code,
  bbc.component_quantity     AS metal_grams,
  msi.organization_id        AS org_id,
  bbc.creation_date          AS bom_created
FROM apps.bom_components_b bbc
JOIN apps.bom_structures_b bbs ON bbs.bill_sequence_id = bbc.bill_sequence_id
JOIN apps.mtl_system_items_b msi ON msi.inventory_item_id = bbs.assembly_item_id
WHERE bbc.disable_date IS NULL
  AND msi.attribute1 IN ('Au','Ag','Pt','Pd','CU','AL','NI','ZN','PB','SN')
  AND ROWNUM <= 5000`,
    bind_params_json: '[]',
    mapping_json: JSON.stringify({
      PRODUCT_ID:  'product_id',
      METAL_CODE:  'metal_code',
      METAL_GRAMS: 'metal_grams',
    }),
    upsert_mode: 'upsert',
    upsert_keys: 'product_id,metal_code',
    schedule_interval_minutes: 1440,   // daily
  },

  {
    name: '[PM-ERP] 採購單歷史 12 月',
    description: '從 EBS PO 模組撈過去 12 個月各金屬月度採購量 / 均單價 / 供應商數,寫進 pm_purchase_history(by metal × month × factory)',
    target_pm_table: 'pm_purchase_history',
    source_query: `-- EBS PO 範本,實際請依 metal_code 來源(item attribute / category 等)調整
SELECT
  msi.attribute1                                     AS metal_code,
  TO_CHAR(pol.creation_date, 'YYYY-MM')              AS purchase_month,
  SUM(pol.quantity)                                  AS total_qty,
  MAX(pol.unit_meas_lookup_code)                     AS total_qty_unit,
  SUM(pol.quantity * pol.unit_price)                 AS total_amount,
  AVG(pol.unit_price)                                AS avg_unit_price,
  COUNT(DISTINCT pol.po_header_id)                   AS po_count,
  COUNT(DISTINCT pha.vendor_id)                      AS supplier_count,
  hou.short_code                                     AS factory_code
FROM apps.po_lines_all pol
JOIN apps.po_headers_all pha ON pha.po_header_id = pol.po_header_id
JOIN apps.mtl_system_items_b msi ON msi.inventory_item_id = pol.item_id
JOIN apps.hr_operating_units hou ON hou.organization_id = pha.org_id
WHERE pol.creation_date >= ADD_MONTHS(SYSDATE, -12)
  AND msi.attribute1 IN ('Au','Ag','Pt','Pd','CU','AL','NI','ZN','PB','SN')
  AND pha.authorization_status = 'APPROVED'
GROUP BY msi.attribute1, TO_CHAR(pol.creation_date, 'YYYY-MM'), hou.short_code`,
    bind_params_json: '[]',
    mapping_json: JSON.stringify({
      METAL_CODE:      'metal_code',
      PURCHASE_MONTH:  'purchase_month',
      TOTAL_QTY:       'total_qty',
      TOTAL_QTY_UNIT:  'total_qty_unit',
      TOTAL_AMOUNT:    'total_amount',
      AVG_UNIT_PRICE:  'avg_unit_price',
      PO_COUNT:        'po_count',
      SUPPLIER_COUNT:  'supplier_count',
      FACTORY_CODE:    'factory_code',
    }),
    upsert_mode: 'upsert',
    upsert_keys: 'metal_code,purchase_month,factory_code',
    schedule_interval_minutes: 1440,
  },

  {
    name: '[PM-ERP] 在途 + 安全庫存',
    description: '從 EBS INV 撈各金屬在途量 / 在庫量 / 安全庫存(by metal × factory),寫進 pm_inventory。供 AI 戰情新 Design 「庫存 vs 7 日預測缺口」用',
    target_pm_table: 'pm_inventory',
    source_query: `-- EBS INV 範本
SELECT
  msi.attribute1                                                     AS metal_code,
  hou.short_code                                                     AS factory_code,
  SUM(NVL(moq.transaction_quantity, 0))                              AS onhand_qty,
  (SELECT NVL(SUM(rt.primary_quantity), 0)
     FROM apps.rcv_transactions rt
    WHERE rt.organization_id = msi.organization_id
      AND rt.po_line_id IN (SELECT po_line_id FROM apps.po_lines_all WHERE item_id = msi.inventory_item_id)
      AND rt.transaction_type = 'SHIP') AS in_transit_qty,
  NVL(mss.min_minmax_quantity, 0)                                    AS safety_stock_qty,
  msi.primary_uom_code                                               AS qty_unit
FROM apps.mtl_system_items_b msi
LEFT JOIN apps.mtl_onhand_quantities_detail moq
  ON moq.inventory_item_id = msi.inventory_item_id
 AND moq.organization_id = msi.organization_id
LEFT JOIN apps.mtl_safety_stocks mss
  ON mss.inventory_item_id = msi.inventory_item_id
 AND mss.organization_id = msi.organization_id
LEFT JOIN apps.hr_organization_units hou ON hou.organization_id = msi.organization_id
WHERE msi.attribute1 IN ('Au','Ag','Pt','Pd','CU','AL','NI','ZN','PB','SN')
GROUP BY msi.attribute1, hou.short_code, msi.organization_id,
         msi.inventory_item_id, mss.min_minmax_quantity, msi.primary_uom_code`,
    bind_params_json: '[]',
    mapping_json: JSON.stringify({
      METAL_CODE:       'metal_code',
      FACTORY_CODE:     'factory_code',
      ONHAND_QTY:       'onhand_qty',
      IN_TRANSIT_QTY:   'in_transit_qty',
      SAFETY_STOCK_QTY: 'safety_stock_qty',
      QTY_UNIT:         'qty_unit',
    }),
    upsert_mode: 'upsert',
    upsert_keys: 'metal_code,factory_code',
    schedule_interval_minutes: 360,   // 每 6h(在途庫存變動較頻繁)
  },
];

async function autoSeedPmErpSyncJobs(db) {
  if (!db) return;
  let inserted = 0;
  for (const s of SEEDS) {
    try {
      const ex = await db.prepare(`SELECT id FROM pm_erp_sync_job WHERE name = ?`).get(s.name);
      if (ex) continue;  // 已存在 → 不覆蓋(user 可能已改 SQL)
      await db.prepare(`
        INSERT INTO pm_erp_sync_job (
          name, description, target_pm_table, source_query, bind_params_json,
          mapping_json, upsert_mode, upsert_keys, schedule_interval_minutes,
          is_active, is_dry_run
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
      `).run(
        s.name, s.description, s.target_pm_table, s.source_query, s.bind_params_json,
        s.mapping_json, s.upsert_mode, s.upsert_keys, s.schedule_interval_minutes,
      );
      inserted++;
      console.log(`[PmErpSyncSeed] Created template job: ${s.name}`);
    } catch (e) {
      console.warn(`[PmErpSyncSeed] seed "${s.name}":`, e.message);
    }
  }
  if (inserted > 0) console.log(`[PmErpSyncSeed] Inserted ${inserted} template job(s) (all dry_run + inactive)`);
}

module.exports = { autoSeedPmErpSyncJobs };
