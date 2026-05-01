'use strict';
/**
 * Backfill script:對 pm_price_history 既有 row 重跑 metal_price_normalize,把
 * USD/lb / USD/Lbs / USD/T / USD/MT 等混亂單位統一成 standard:
 *   • 工業金屬(CU/AL/NI/SN/ZN/PB)→ USD/ton
 *   • 貴金屬(AU/AG/PT/PD/RH)→ USD/oz
 *
 * 跑法(K8s pod 內):
 *   kubectl exec -n foxlink <pod> -- node /app/scripts/backfill-metal-price-normalize.js [--dry-run]
 *
 * --dry-run:只列出會改的 row,不實際 UPDATE。先跑這個確認再正式跑。
 *
 * 注意:script 不動 original_price / original_currency / original_unit(audit fields,保留 LLM 原樣)
 *      只改 price_usd 跟 unit。
 */

// 兼容 local + K8s 兩種位置:K8s 由 secret 注入 env 不需 dotenv
try { require('dotenv').config({ path: require('path').join(__dirname, '../.env') }); }
catch (_) { /* K8s pod 沒 dotenv,跳過 */ }

let db;
try { db = require('../database-oracle').db; }
catch (_) { db = require('/app/database-oracle').db; }

// 從 pipelineDbWriter 直接 import normalizeMetalPrice(避免複製邏輯)
let normalizeMetalPrice;
try { ({ normalizeMetalPrice } = require('../services/pipelineDbWriter')); }
catch (_) { ({ normalizeMetalPrice } = require('/app/services/pipelineDbWriter')); }
if (typeof normalizeMetalPrice !== 'function') {
  console.error('FATAL: normalizeMetalPrice 沒從 pipelineDbWriter exports 出來,先確認該模組 module.exports');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

(async () => {
  console.log(`Backfill pm_price_history.unit/price_usd  ${dryRun ? '(DRY-RUN)' : '(LIVE)'}`);
  console.log('---');

  // 撈所有 row(不限日期 — backfill 一次把歷史都倒對)
  const rows = await db.prepare(
    `SELECT id, metal_code, price_usd, unit, original_price, original_unit, as_of_date
       FROM pm_price_history`
  ).all();

  console.log(`Loaded ${rows.length} rows`);

  let toUpdate = 0;
  let unchanged = 0;
  let unknownUnit = 0;
  const samples = [];

  for (const r of rows) {
    const code = r.metal_code || r.METAL_CODE;
    const price = r.price_usd ?? r.PRICE_USD;
    const unit = r.unit || r.UNIT;
    const id = r.id || r.ID;
    const norm = normalizeMetalPrice(code, price, unit);
    const newPrice = Number(norm.price);
    const newUnit = norm.unit;
    const priceChanged = Number.isFinite(newPrice) && Math.abs(newPrice - Number(price)) > 0.001;
    const unitChanged = newUnit !== unit;
    if (!priceChanged && !unitChanged) {
      unchanged++;
      continue;
    }
    if (norm.reason && norm.reason.startsWith('unknown_unit')) unknownUnit++;
    toUpdate++;
    if (samples.length < 20) {
      samples.push({
        id, code,
        from: `${price} ${unit}`,
        to: `${newPrice} ${newUnit}`,
        reason: norm.reason || (norm.converted ? 'converted' : 'unit_relabel'),
      });
    }
    if (!dryRun) {
      await db.prepare(
        `UPDATE pm_price_history SET price_usd=?, unit=? WHERE id=?`
      ).run(newPrice, newUnit, id);
    }
  }

  console.log('---');
  console.log(`Result: ${toUpdate} rows ${dryRun ? 'would be' : 'were'} updated, ${unchanged} unchanged, ${unknownUnit} 不認識的 unit (relabel only)`);
  console.log('Sample changes (first 20):');
  for (const s of samples) {
    console.log(`  #${s.id} ${s.code}: ${s.from}  →  ${s.to}  (${s.reason})`);
  }
  if (dryRun) console.log('\n*** DRY-RUN — 沒實際更新。確認 sample OK 後拿掉 --dry-run 再跑一次 ***');
  process.exit(0);
})().catch((e) => {
  console.error('ERROR:', e.message);
  if (e.stack) console.error(e.stack.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
});
