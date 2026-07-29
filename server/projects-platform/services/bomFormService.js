/**
 * bomFormService.js — 報價 Form 案級欄位 + 完成度計算(v0.16 對齊 · plan #0)
 *
 * D2:欄位存 projects.data_payload.form.{section}.{field}(免 migration)。
 * D3:完成度真計算混合制 —— 欄位型段=必填欄有值 n/m;資料型段=資料條件規則。
 * S2:機密段(strategy)非全視角 GET 遮 ▒▒▒、PUT 403。
 * SECTION_DEFS 集中一處;後續 section(#2~#13)逐步在此擴充規則。
 */

const { makeLogger } = require('./logger');
const log = makeLogger('bomForm');

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const pick = (row, name) => { if (!row) return undefined; const lc = String(name).toLowerCase(); for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k]; return undefined; };
const filled = (v) => v != null && String(v).trim() !== '';

// 段定義:type=fields(欄位型)|data(資料型)|mixed;confidential=非全視角遮值
// fields: [{key, required}] — filled 計「有值欄數 / 全欄數」(對齊 demo n/m 口徑)
const SECTION_DEFS = [
  {
    key: 'customer', label: '客戶資料', type: 'fields',
    fields: ['cust_name', 'cust_alias', 'tax_id', 'cust_code_erp', 'po_number', 'payment_terms', 'ship_address', 'contact_name'],
  },
  {
    key: 'workflow', label: '操作流程', type: 'data',
    // #2 實作:26 步自動判定 + 手動勾;先回 checklist service 的完成數
    async count(db, projectId, form) {
      try { return await require('./bomWorkflowChecklistService').completion(db, projectId, form); }
      catch (_) { return { filled: 0, total: 26 }; }
    },
  },
  {
    key: 'variant', label: 'CMF 變體', type: 'data',
    // #3:每個「顏色」維度值有 share/qty 設定 → 計數(無顏色維度 → total 0 = 不顯)
    async count(db, projectId, form) {
      const vals = await db.prepare(
        `SELECT vv.id, vv.value_code FROM bom_variant_value vv JOIN bom_variant_dimension d ON d.id=vv.dimension_id
          WHERE d.project_id=? AND (d.dim_code LIKE '%顏色%' OR UPPER(d.dim_code) LIKE '%COLOR%')`,
      ).all(projectId).catch(() => []);
      if (!vals.length) return { filled: 0, total: 0 };
      const shares = (form.variant && form.variant.shares) || {};
      const n = vals.filter((v) => shares[String(pick(v, 'id'))] && filled(shares[String(pick(v, 'id'))].share)).length;
      return { filled: n, total: vals.length };
    },
  },
  {
    key: 'bom', label: 'BOM 結構', type: 'data',
    // 有 instance / items>0 / 詢價全完成 / ECN / 客供料欄
    async count(db, projectId, form) {
      const meta = form.bom_meta || {};
      let f = 0; const total = 5;
      const inst = await db.prepare(`SELECT id FROM bom_instance WHERE project_id=? ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`).get(projectId).catch(() => null);
      if (inst) f += 1;
      if (inst) {
        const c = await db.prepare(
          `SELECT COUNT(*) AS n, SUM(CASE WHEN ch.ap IS NULL THEN 1 ELSE 0 END) AS pend
             FROM bom_item i JOIN bom_category c ON c.id=i.bom_category_id JOIN bom_section s ON s.id=c.bom_section_id
             LEFT JOIN (SELECT bom_item_id, MAX(applied_price_usd) ap FROM bom_item_price_snapshot WHERE is_chosen=1 GROUP BY bom_item_id) ch ON ch.bom_item_id=i.id
            WHERE s.bom_instance_id=?`,
        ).get(num(pick(inst, 'id'))).catch(() => null);
        if (c && num(pick(c, 'n')) > 0) f += 1;
        if (c && num(pick(c, 'n')) > 0 && num(pick(c, 'pend')) === 0) f += 1;
      }
      if (filled(meta.ecn_version)) f += 1;
      if (filled(meta.has_consign) && (meta.has_consign === '無' || filled(meta.consign_list))) f += 1;
      return { filled: f, total };
    },
  },
  {
    key: 'packaging', label: '包裝 BOM', type: 'data',
    // #5:有 PKG 模組料 + pallet_compliance 已選
    async count(db, projectId, form) {
      const inst = await db.prepare(`SELECT id FROM bom_instance WHERE project_id=? ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`).get(projectId).catch(() => null);
      if (!inst) return { filled: 0, total: 2 };
      const c = await db.prepare(
        `SELECT COUNT(*) AS n FROM bom_item i JOIN bom_category c ON c.id=i.bom_category_id JOIN bom_section s ON s.id=c.bom_section_id
          WHERE s.bom_instance_id=? AND s.module_category='PKG'`,
      ).get(num(pick(inst, 'id'))).catch(() => null);
      let f = 0;
      if (c && num(pick(c, 'n')) > 0) f += 1;
      if (Array.isArray((form.pkg_meta || {}).pallet_compliance) && form.pkg_meta.pallet_compliance.length) f += 1;
      return { filled: f, total: 2 };
    },
  },
  {
    key: 'nre', label: 'NRE 成本', type: 'data', confidential: true,
    // config 已設 / 有 items / 有 negotiated(#7)
    async count(db, projectId, form) {
      let f = 0; const total = 3;
      const cfg = await db.prepare(`SELECT nre_mode FROM bom_nre_config WHERE project_id=?`).get(projectId).catch(() => null);
      if (cfg) f += 1;
      const c = await db.prepare(`SELECT COUNT(*) AS n FROM bom_nre_item WHERE project_id=?`).get(projectId).catch(() => null);
      if (c && num(pick(c, 'n')) > 0) f += 1;
      // negotiated 欄 #7 才有 → 獨立 try(欄不存在不影響前兩項)
      const g = await db.prepare(`SELECT COUNT(unit_price_negotiated) AS neg FROM bom_nre_item WHERE project_id=?`).get(projectId).catch(() => null);
      if (g && num(pick(g, 'neg')) > 0) f += 1;
      return { filled: f, total };
    },
  },
  {
    key: 'factory_matrix', label: '多廠矩陣', type: 'data', confidential: true,
    // cells 滿格(配置×廠 全算過)
    async count(db, projectId) {
      try {
        const compareSvc = require('./bomFactoryCompareService');
        const mx = await compareSvc.getMatrix(db, { projectId });
        const total = (mx.combos || []).length * (mx.factories || []).length;
        if (!total) return { filled: 0, total: 0 };
        let f = 0;
        for (const c of mx.combos) for (const fa of mx.factories) if (mx.cells[`${fa.caseFactoryId}|${c.sig}`]) f += 1;
        return { filled: f, total };
      } catch (_) { return { filled: 0, total: 0 }; }
    },
  },
  {
    key: 'cleansheet', label: 'Cleansheet (MVA)', type: 'data', confidential: true,
    // 各 case_factory 有 baseline(成本模型已 provision)
    async count(db, projectId) {
      const r = await db.prepare(
        `SELECT COUNT(*) AS n, COUNT(baseline_id) AS b FROM bom_cs_case_factory WHERE case_id=?`,
      ).get(projectId).catch(() => null);
      const total = r ? num(pick(r, 'n')) : 0;
      return { filled: r ? num(pick(r, 'b')) : 0, total };
    },
  },
  {
    key: 'cost', label: '成本核算', type: 'data', confidential: true,
    // 有 run / 有送審版 / 有官方版 / 建議售價草
    async count(db, projectId, form) {
      let f = 0; const total = 4;
      const run = await db.prepare(
        `SELECT COUNT(*) AS n FROM bom_cs_run r JOIN bom_cs_case_factory cf ON cf.case_factory_id=r.case_factory_id WHERE cf.case_id=? AND r.status='ready'`,
      ).get(projectId).catch(() => null);
      if (run && num(pick(run, 'n')) > 0) f += 1;
      const qv = await db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN status='APPROVED' THEN 1 ELSE 0 END) AS ap FROM bom_quote_version WHERE project_id=?`).get(projectId).catch(() => null);
      if (qv && num(pick(qv, 'n')) > 0) f += 1;
      if (qv && num(pick(qv, 'ap')) > 0) f += 1;
      if (filled((form.cost_meta || {}).sale_price_draft)) f += 1;
      return { filled: f, total };
    },
  },
  {
    key: 'strategy', label: '議價策略', type: 'fields', confidential: true,
    fields: ['min_margin', 'compete_price', 'cust_room', 'past_discount', 'strategy_note', 'win_prob', 'fallback', 'qty_discount', 'special_terms'],
    // round_no 自動(有議價輪次即 +1)→ extra
    async extra(db, projectId) {
      const r = await db.prepare(`SELECT COUNT(*) AS n FROM bom_negotiation_round WHERE project_id=?`).get(projectId).catch(() => null);
      return { filled: r && num(pick(r, 'n')) > 0 ? 1 : 0, total: 1 };
    },
  },
];

async function _loadPayload(db, projectId) {
  const p = await db.prepare(`SELECT data_payload FROM projects WHERE id=?`).get(projectId);
  if (!p) throw new Error('project not found');
  let dp = {};
  try { dp = JSON.parse(pick(p, 'data_payload') || '{}') || {}; } catch (_) { dp = {}; }
  return dp;
}

/** GET:form + 完成度(canViewTrue=false → 機密段值遮 ▒▒▒)*/
async function getForm(db, projectId, { canViewTrue = true } = {}) {
  const dp = await _loadPayload(db, projectId);
  const form = dp.form || {};
  const completion = [];
  for (const def of SECTION_DEFS) {
    let f = 0, t = 0;
    if (def.type === 'fields') {
      const sec = form[def.key === 'customer' ? 'customer' : def.key] || {};
      t = def.fields.length;
      f = def.fields.filter((k) => filled(sec[k])).length;
    }
    if (def.count) { const c = await def.count(db, projectId, form); f += c.filled; t += c.total; }
    if (def.extra) { const c = await def.extra(db, projectId); f += c.filled; t += c.total; }
    completion.push({
      key: def.key, label: def.label, filled: f, total: t,
      status: t === 0 ? 'na' : f >= t ? 'done' : f > 0 ? 'warn' : 'empty',
      confidential: !!def.confidential,
    });
  }
  // 機密段遮值(server 權威;wrapper 另兜 true-cost 欄)
  const outForm = JSON.parse(JSON.stringify(form));
  if (!canViewTrue && outForm.strategy) {
    for (const k of Object.keys(outForm.strategy)) outForm.strategy[k] = '▒▒▒';
  }
  return { projectId, form: outForm, completion };
}

const EDITABLE_SECTIONS = new Set(['customer', 'bom_meta', 'strategy', 'cost_meta', 'pkg_meta', 'variant', 'workflow']);
const CONF_SECTIONS = new Set(['strategy', 'cost_meta']);

/** PUT:patch 一段欄位(merge)*/
async function patchForm(db, projectId, section, fields, { canViewTrue = true } = {}) {
  if (!EDITABLE_SECTIONS.has(section)) throw new Error(`section 不可編輯: ${section}`);
  if (CONF_SECTIONS.has(section) && !canViewTrue) { const e = new Error('此段需完整成本視角(HOST/admin)'); e.status = 403; throw e; }
  if (!fields || typeof fields !== 'object') throw new Error('fields required');
  const dp = await _loadPayload(db, projectId);
  dp.form = dp.form || {};
  dp.form[section] = { ...(dp.form[section] || {}), ...fields };
  // 值全走字串/數字/陣列;去掉 undefined
  for (const k of Object.keys(dp.form[section])) if (dp.form[section][k] === undefined) delete dp.form[section][k];
  await db.prepare(`UPDATE projects SET data_payload=?, updated_at=SYSTIMESTAMP WHERE id=?`).run(JSON.stringify(dp), projectId);
  log.log(`patchForm p${projectId} ${section}: ${Object.keys(fields).join(',')}`);
  return { ok: true, section, form: dp.form[section] };
}

module.exports = { getForm, patchForm, SECTION_DEFS };
