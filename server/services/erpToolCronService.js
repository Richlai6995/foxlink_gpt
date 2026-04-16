'use strict';

/**
 * ERP Tool Cron Service
 * - 背景 metadata drift 檢查
 * - drift 發生時更新 metadata_drifted=1 並 log
 */

const cron = require('node-cron');
const metaSvc = require('./erpToolMetadata');
const erpDb = require('./erpDb');

let _db = null;

function initErpToolCron(db) {
  _db = db;
  const schedule = process.env.ERP_TOOL_METADATA_CHECK_CRON || '0 * * * *'; // 每小時
  if (!cron.validate(schedule)) {
    console.warn(`[ErpToolCron] invalid cron: ${schedule} — 停用 drift 檢查`);
    return;
  }
  cron.schedule(schedule, () => {
    runDriftCheck().catch(e => console.error('[ErpToolCron] Error:', e.message));
  }, { timezone: 'Asia/Taipei' });
  console.log(`[ErpToolCron] Scheduled metadata drift check: ${schedule}`);
}

async function runDriftCheck() {
  if (!_db) return;
  if (!erpDb.isConfigured()) return;
  const db = _db;
  const tools = await db.prepare(`SELECT * FROM erp_tools WHERE enabled=1`).all();
  if (!tools || tools.length === 0) return;

  let checked = 0, drifted = 0;
  for (const row of tools) {
    const id = row.id || row.ID;
    const owner = row.db_owner || row.DB_OWNER;
    const pkg = row.package_name || row.PACKAGE_NAME;
    const name = row.object_name || row.OBJECT_NAME;
    const overload = row.overload || row.OVERLOAD;
    const oldHash = row.metadata_hash || row.METADATA_HASH;
    try {
      const latest = await metaSvc.inspectRoutine({ owner, packageName: pkg, objectName: name });
      const ov = latest.overloads.find(o => (o.overload || null) === (overload || null));
      if (!ov) {
        // 找不到對應 overload → 當 drift
        await db.prepare(`
          UPDATE erp_tools SET metadata_drifted = 1, metadata_checked_at = SYSTIMESTAMP WHERE id = ?
        `).run(id);
        drifted++;
        console.warn(`[ErpToolCron] drift:tool id=${id} "${name}" overload 消失`);
        continue;
      }
      const newHash = metaSvc.computeMetadataHash(ov);
      const isDrifted = newHash !== oldHash;
      await db.prepare(`
        UPDATE erp_tools
        SET metadata_hash = ?, metadata_checked_at = SYSTIMESTAMP,
            metadata_drifted = ?
        WHERE id = ?
      `).run(newHash, isDrifted ? 1 : 0, id);
      if (isDrifted) {
        drifted++;
        console.warn(`[ErpToolCron] drift:tool id=${id} "${name}" hash ${oldHash?.slice(0, 8)} → ${newHash.slice(0, 8)}`);
      }
      checked++;
    } catch (e) {
      console.warn(`[ErpToolCron] check id=${id} failed: ${e.message}`);
    }
  }
  if (drifted > 0 || checked > 0) {
    console.log(`[ErpToolCron] drift check: ${checked}/${tools.length} OK, ${drifted} drifted`);
  }
}

module.exports = { initErpToolCron, runDriftCheck };
