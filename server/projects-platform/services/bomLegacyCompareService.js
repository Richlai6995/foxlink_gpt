/**
 * bomLegacyCompareService.js — AI 比對上代(P1)
 *
 * 原則:程式算數字(deterministic diff),LLM(Pro)只解讀摘要,不生成數字。
 * 三層 diff:料件(FPN 匹配 · 替換料偵測)/ 結構(模組 rollup)/ 成本(quote 側 bridge)。
 * S2:全程只用 quote 側(true/margin 不進 prompt 不出現在輸出);route 層 wrapper 再兜底。
 */

const { makeLogger } = require('./logger');
const log = makeLogger('bomLegacyCompare');

const num = (v) => (typeof v === 'number' ? v : (v == null || v === '' ? 0 : Number(v) || 0));
const pick = (row, name) => { if (!row) return undefined; const lc = String(name).toLowerCase(); for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k]; return undefined; };
const normFpn = (s) => (s ? String(s).toUpperCase().replace(/\s+/g, '') : null);
const normDesc = (s) => (s ? String(s).toUpperCase().replace(/[\s,()\-_./]+/g, '') : '');

/** 專案快照:料件(全含口徑 · chosen 價)+ 成本(official run 優先 · quote 側)*/
async function loadSnapshot(db, projectId) {
  const inst = await db.prepare(
    `SELECT id FROM bom_instance WHERE project_id=? ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`,
  ).get(projectId).catch(() => null);
  const instId = inst ? num(pick(inst, 'id')) : null;
  let items = [];
  if (instId) {
    items = (await db.prepare(
      `SELECT sec.module_category AS module, sec.name AS section, c.name AS category,
              i.customer_item AS item_no, i.fpn, i.description, i.qty,
              ch.applied_price_usd AS price
         FROM bom_item i
         JOIN bom_category c ON c.id=i.bom_category_id
         JOIN bom_section sec ON sec.id=c.bom_section_id
         LEFT JOIN (SELECT bom_item_id, MAX(applied_price_usd) AS applied_price_usd FROM bom_item_price_snapshot WHERE is_chosen=1 GROUP BY bom_item_id) ch ON ch.bom_item_id=i.id
        WHERE sec.bom_instance_id=?`,
    ).all(instId).catch(() => [])).map((r) => ({
      module: pick(r, 'module'), section: pick(r, 'section'), category: pick(r, 'category'),
      itemNo: pick(r, 'item_no'), fpn: pick(r, 'fpn'), desc: pick(r, 'description'),
      qty: num(pick(r, 'qty')), price: pick(r, 'price') != null ? num(pick(r, 'price')) : null,
    }));
  }
  // 成本:official 版 run 優先,fallback 最新 ready run
  const engine = require('./bomCostEngine');
  let runRow = await db.prepare(
    `SELECT run_id FROM bom_quote_version WHERE project_id=? AND status='APPROVED' ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`,
  ).get(projectId).catch(() => null);
  if (!runRow) {
    runRow = await db.prepare(
      `SELECT r.run_id FROM bom_cs_run r JOIN bom_cs_case_factory cf ON cf.case_factory_id=r.case_factory_id
        WHERE cf.case_id=? AND r.status='ready' ORDER BY r.run_id DESC FETCH FIRST 1 ROWS ONLY`,
    ).get(projectId).catch(() => null);
  }
  let cost = null;
  const runId = runRow ? num(pick(runRow, 'run_id')) : null;
  if (runId) {
    const r = await engine.loadPersistedRun(db, runId).catch(() => null);
    if (r) cost = { runId, material: r.costBreakdown.material, mva: r.costBreakdown.mva, sga: r.costBreakdown.sga, profit: r.costBreakdown.profit, nreAmort: r.costBreakdown.nreAmort, total: r.costBreakdown.total };
  }
  const p = await db.prepare(`SELECT project_code, data_payload FROM projects WHERE id=?`).get(projectId).catch(() => null);
  let title = null; try { title = JSON.parse(pick(p, 'data_payload') || '{}').title || null; } catch (_) { /* noop */ }
  return { projectId, projectCode: pick(p, 'project_code') || `#${projectId}`, title, itemCount: items.length, items, cost };
}

/** diff(legacy=上代 a, current=本案 b)· 全 quote 側 */
function diffBoms(a, b) {
  const keyOf = (it) => normFpn(it.fpn) || `D:${normDesc(it.desc)}`;
  const mapA = new Map(); a.items.forEach((it) => { if (!mapA.has(keyOf(it))) mapA.set(keyOf(it), it); });
  const mapB = new Map(); b.items.forEach((it) => { if (!mapB.has(keyOf(it))) mapB.set(keyOf(it), it); });

  const common = [], added = [], removed = [];
  for (const [k, ib] of mapB) {
    const ia = mapA.get(k);
    if (ia) {
      const impact = (ib.qty * num(ib.price)) - (ia.qty * num(ia.price));
      common.push({ fpn: ib.fpn, desc: ib.desc, module: ib.module, oldQty: ia.qty, newQty: ib.qty, oldPrice: ia.price, newPrice: ib.price, impact });
    } else added.push({ fpn: ib.fpn, desc: ib.desc, module: ib.module, qty: ib.qty, price: ib.price, impact: ib.qty * num(ib.price) });
  }
  for (const [k, ia] of mapA) if (!mapB.has(k)) removed.push({ fpn: ia.fpn, desc: ia.desc, module: ia.module, qty: ia.qty, price: ia.price, impact: -(ia.qty * num(ia.price)) });

  // 替換料偵測:added × removed 描述正規化相同 → 配對
  const replaced = [];
  for (const ad of [...added]) {
    const ri = removed.findIndex((rm) => normDesc(rm.desc) && normDesc(rm.desc) === normDesc(ad.desc));
    if (ri >= 0) {
      const rm = removed[ri];
      replaced.push({ desc: ad.desc, module: ad.module, oldFpn: rm.fpn, newFpn: ad.fpn, oldPrice: rm.price, newPrice: ad.price, impact: ad.impact + rm.impact });
      removed.splice(ri, 1); added.splice(added.indexOf(ad), 1);
    }
  }

  const changed = common.filter((c) => Math.abs(c.impact) > 1e-9).sort((x, y) => Math.abs(y.impact) - Math.abs(x.impact));
  added.sort((x, y) => Math.abs(y.impact) - Math.abs(x.impact));
  removed.sort((x, y) => Math.abs(y.impact) - Math.abs(x.impact));

  // 結構層:module rollup(qty×price)
  const modSum = (items) => { const m = {}; for (const it of items) m[it.module] = (m[it.module] || 0) + it.qty * num(it.price); return m; };
  const ma = modSum(a.items), mb = modSum(b.items);
  const moduleDiff = [...new Set([...Object.keys(ma), ...Object.keys(mb)])].map((k) => ({ module: k, legacy: ma[k] || 0, current: mb[k] || 0, delta: (mb[k] || 0) - (ma[k] || 0) }));

  // 成本橋(材料層分解 + 非材料差)
  const sum = (arr) => arr.reduce((s, x) => s + x.impact, 0);
  const bridge = {
    addedSum: sum(added), removedSum: sum(removed), replacedSum: sum(replaced),
    priceUpSum: sum(changed.filter((c) => c.impact > 0)), priceDownSum: sum(changed.filter((c) => c.impact < 0)),
    materialDelta: sum(added) + sum(removed) + sum(replaced) + sum(changed),
    legacyTotal: a.cost ? a.cost.total : null, currentTotal: b.cost ? b.cost.total : null,
    nonMaterialDelta: (a.cost && b.cost) ? (b.cost.total - a.cost.total) - ((b.cost.material || 0) - (a.cost.material || 0)) : null,
  };
  return {
    counts: { legacyItems: a.itemCount, currentItems: b.itemCount, added: added.length, removed: removed.length, replaced: replaced.length, changed: changed.length },
    added: added.slice(0, 30), removed: removed.slice(0, 30), replaced: replaced.slice(0, 30), changed: changed.slice(0, 30),
    moduleDiff, bridge,
    legacyCost: a.cost, currentCost: b.cost,
  };
}

/** LLM 摘要(Pro · 只解讀,不算數)*/
async function aiSummary(diff, legacyLabel, currentLabel) {
  const gemini = require('../../services/gemini');
  const model = process.env.GEMINI_MODEL_PRO;
  const payload = JSON.stringify(diff).slice(0, 60000);
  const prompt = [
    `你是製造業報價分析師。以下是「本案(${currentLabel})」vs「上代(${legacyLabel})」的 BOM/成本差異分析結果(程式計算,數字為權威)。`,
    `用繁體中文輸出 markdown,分四段:`,
    `## 執行摘要(3-5 句:總價差多少、主因是什麼)`,
    `## 漲跌主因 Top 5(每條引用具體料件與金額)`,
    `## 異常警示(疑似錯價/量綱錯/重複,如同料價差超過 10 倍;沒有就寫「無明顯異常」)`,
    `## 對客談判要點(3 條內,把漲價歸因到可辯護的理由)`,
    `鐵則:只引用資料中的數字,不得自行計算、推估或修改任何數字;金額格式照原樣引用即可。`,
    `資料(JSON):`, payload,
  ].join('\n');
  const r = await gemini.generateTextSync(model, [], prompt, {});
  return { text: r.text, model, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
}

async function compareLegacy(db, { projectId, legacyProjectId, withAi = false }) {
  if (!projectId || !legacyProjectId) throw new Error('projectId + legacyProjectId required');
  if (Number(projectId) === Number(legacyProjectId)) throw new Error('不能跟自己比');
  const [cur, leg] = await Promise.all([loadSnapshot(db, projectId), loadSnapshot(db, legacyProjectId)]);
  if (!cur.itemCount) throw new Error('本案尚未匯入 BOM');
  if (!leg.itemCount) throw new Error('上代專案尚未匯入 BOM');
  const diff = diffBoms(leg, cur);
  const out = {
    current: { projectId: cur.projectId, projectCode: cur.projectCode, title: cur.title, itemCount: cur.itemCount, cost: cur.cost },
    legacy: { projectId: leg.projectId, projectCode: leg.projectCode, title: leg.title, itemCount: leg.itemCount, cost: leg.cost },
    diff,
  };
  if (withAi) {
    try { out.ai = await aiSummary(diff, `${leg.projectCode}${leg.title ? ' ' + leg.title : ''}`, `${cur.projectCode}${cur.title ? ' ' + cur.title : ''}`); }
    catch (e) { log.warn('aiSummary:', e.message); out.aiError = e.message; }
  }
  return out;
}

module.exports = { compareLegacy, loadSnapshot, diffBoms };
