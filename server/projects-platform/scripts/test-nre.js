#!/usr/bin/env node
/**
 * test-nre.js — Track N NRE regression + demo 資料 seed
 *
 * 驗:seed Rival3 NRE Summary golden 10 項 → rollup 對 Total quote 37876 / true 123566 →
 *     AMORTIZED 每台攤提 = Σquote/分攤基數。
 * 副作用(刻意保留):在 CORTEX-FIX-RIVAL3-CN(專案 82)灌 golden NRE 供瀏覽器實測(SEPARATE 模式)。
 * idempotent。用法(server/):node projects-platform/scripts/test-nre.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { init } = require('../../database-oracle');
const nre = require('../services/bomNreService');

const val = (r) => (r ? Object.values(r)[0] : undefined);

// [category, itemNo, description, qty, unit_true, unit_quote, sort]  Σquote=37876 Σtrue=123566
const GOLDEN = [
  ['BUILD', '1', 'Build Cost (EV/DV/PV/MP)', 1, 33900, 13600, 10],
  ['EMC', '3', 'EMC Debugging', 1, 3750, 3750, 20],
  ['DVE', '6', 'DVE Chromebook', 1, 165, 165, 30],
  ['TRAVEL', '7', 'Travel Expense (waived)', 1, 0, 0, 40],
  ['DEV_LABOR', '8', 'Dev + NPI Labor', 1, 0, 10000, 50],
  ['RELIABILITY', '9a', 'RET (Reliability)', 1, 2305, 1500, 60],
  ['RELIABILITY', '9b', 'ORT', 1, 500, 500, 70],
  ['RELIABILITY', '9c', 'PKG RET', 1, 361, 361, 80],
  ['MTE_FIXTURE', '10', 'Unique Fixtures (MTE)', 1, 80184, 5000, 90],
  ['TOOLING', '11', 'Tooling', 1, 2401, 3000, 100],
];

(async () => {
  await init();
  const db = require('../../database-oracle').db;
  const get = (s, ...a) => db.prepare(s).get(...a);
  const run = (s, ...a) => db.prepare(s).run(...a);
  let pass = true; const mark = (ok) => { if (!ok) pass = false; return ok ? '✓' : '✗'; };
  console.log('\n=== Track N · NRE ===\n');

  const p = await get(`SELECT id FROM projects WHERE project_code='CORTEX-FIX-RIVAL3-CN'`);
  const pid = Number(val(p));
  console.log(`${mark(!!pid)} 專案 CORTEX-FIX-RIVAL3-CN = #${pid}`);

  await run(`DELETE FROM bom_nre_item WHERE project_id=?`, pid);
  for (const g of GOLDEN) await nre.addItem(db, pid, { category: g[0], itemNo: g[1], description: g[2], qty: g[3], unitPriceTrue: g[4], unitPriceQuote: g[5], sortOrder: g[6] });

  const roll = await nre.rollupNre(db, pid);
  console.log(`items=${roll.items.length} · totalQuote=${roll.totalQuote} · totalTrue=${roll.totalTrue} · margin=${roll.marginUsd}`);
  console.log(`${mark(Math.abs(roll.totalQuote - 37876) < 0.01)} Total quote = 37876`);
  console.log(`${mark(Math.abs(roll.totalTrue - 123566) < 0.01)} Total true  = 123566`);
  console.log(`  byCategory: ${Object.entries(roll.byCategory).map(([k, v]) => `${k}(q${v.quote})`).join(' ')}`);

  // AMORTIZED
  await nre.setConfig(db, pid, { nreMode: 'AMORTIZED', nreAmortizeQty: 418000, amortizeSide: 'quote' });
  const am = await nre.amortizedPerUnit(db, pid);
  const expect = 37876 / 418000;
  console.log(`\namortized: mode=${am.mode} · nrePerUnit=${am.nrePerUnit?.toFixed(6)} (expect ${expect.toFixed(6)})`);
  console.log(`${mark(am.mode === 'AMORTIZED' && Math.abs(am.nrePerUnit - expect) < 1e-6)} AMORTIZED 每台攤提 = Σquote / 分攤基數`);

  // reset SEPARATE(NRE 10 項保留供 demo)
  await nre.setConfig(db, pid, { nreMode: 'SEPARATE' });
  console.log('config reset → SEPARATE(NRE 10 項保留供瀏覽器 demo)');

  console.log(`\n=== ${pass ? 'ALL PASS ✓' : 'SOME FAIL ✗'} ===\n`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
