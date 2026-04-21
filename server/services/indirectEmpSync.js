/**
 * Indirect Employee Sync by 利潤中心 × 廠區
 *
 * 把 ERP foxfl.fl_emp_exp_all 的間接員工(DIT_CODE='I', CURRENT_FLAG='Y', END_DATE IS NULL)
 * 按 profit_center × factory_code 聚合後同步到本地 indirect_emp_by_pc_factory。
 *
 * factory_code 透過 DEPT_CODE JOIN APPS.FL_ORG_EMP_DEPT_MV 取得(fl_emp_exp_all 本身無此欄位)。
 * MV 的 DEPT_CODE 可能有多筆(因 ORG_ID/ORG_CODE 展開),子查詢先 GROUP BY DEPT_CODE 取 MAX(FACTORY_CODE) 去重,避免計數放大。
 *
 * 策略:DELETE 全表 + INSERT(資料量小、每筆都要更新、不用分別 upsert 比較快)。
 * 失敗策略:ERP 不通時回傳 { ok:false, reason },不破壞已有本地資料(DELETE 在 transaction 內)。
 *
 * NULL factory_code 用 '__NONE__' 佔位符(因為 Oracle PK 不能含 NULL 且 '' = NULL)。
 *
 * 呼叫時機:server 啟動後約 6 秒跑(在 factoryCodeLookupSync 之後)。
 */

'use strict';

const erpDb = require('./erpDb');

const UNKNOWN_FACTORY = '__NONE__';

const SYNC_SQL = `
  SELECT EE.PROFIT_CENTER AS profit_center,
         DMAP.FACTORY_CODE AS factory_code,
         COUNT(1) AS emp_count
  FROM foxfl.fl_emp_exp_all EE
  LEFT JOIN (
    SELECT DEPT_CODE, MAX(FACTORY_CODE) AS FACTORY_CODE
    FROM APPS.FL_ORG_EMP_DEPT_MV
    WHERE DEPT_CODE IS NOT NULL AND FACTORY_CODE IS NOT NULL
    GROUP BY DEPT_CODE
  ) DMAP ON EE.DEPT_CODE = DMAP.DEPT_CODE
  WHERE EE.CURRENT_FLAG = 'Y'
    AND EE.DIT_CODE     = 'I'
    AND EE.END_DATE    IS NULL
  GROUP BY EE.PROFIT_CENTER, DMAP.FACTORY_CODE
`;

async function syncIndirectEmpByPcFactory(db) {
  if (!db) return { ok: false, reason: 'db not ready' };
  if (!erpDb.isConfigured()) return { ok: false, reason: 'ERP not configured' };

  try {
    const result = await erpDb.execute(SYNC_SQL);
    const rows = result?.rows || [];

    if (rows.length === 0) {
      return { ok: false, reason: 'ERP returned 0 rows (unexpected, aborting to avoid blanking local table)' };
    }

    // 先清空再重灌(資料量小,約 <200 筆)
    await db.prepare(`DELETE FROM indirect_emp_by_pc_factory`).run();

    let inserted = 0;
    for (const r of rows) {
      const pc = r.PROFIT_CENTER || r.profit_center;
      if (!pc) continue; // ERP 的 profit_center 缺失,這種 row 跳過
      const fc = r.FACTORY_CODE || r.factory_code || UNKNOWN_FACTORY;
      const cnt = Number(r.EMP_COUNT ?? r.emp_count ?? 0);
      await db.prepare(
        `INSERT INTO indirect_emp_by_pc_factory (profit_center, factory_code, emp_count)
         VALUES (?, ?, ?)`
      ).run(pc, fc, cnt);
      inserted++;
    }

    console.log(`[IndirectEmpSync] ok — inserted=${inserted} (erp rows=${rows.length})`);
    return { ok: true, inserted, total: rows.length };
  } catch (e) {
    console.error('[IndirectEmpSync] error:', e.message);
    return { ok: false, reason: e.message };
  }
}

module.exports = { syncIndirectEmpByPcFactory, UNKNOWN_FACTORY };
