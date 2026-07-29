/**
 * bomWorkflowChecklistService.js — 🎬 操作流程 checklist(v0.16 plan #2)
 *
 * 26 步(Stage 4–7 · 對齊 v0.16 workflow_checklist 15139–15271,語意調成平台功能)。
 * D4:自動判定為主(auto(ctx) 從 DB 資料判),無資料可判的步驟 manual(手動勾,存 form.workflow.done)。
 * D5:每步可附圖(form.workflow.images[stepId] = [{url, caption, at}])。
 */

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const pick = (row, name) => { if (!row) return undefined; const lc = String(name).toLowerCase(); for (const k of Object.keys(row)) if (k.toLowerCase() === lc) return row[k]; return undefined; };

// ctx 一次撈齊(每步 auto 只讀 ctx,不重複打 DB)
async function _buildCtx(db, projectId) {
  const g = async (sql, ...b) => db.prepare(sql).get(...b).catch(() => null);
  const inst = await g(`SELECT id FROM bom_instance WHERE project_id=? ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`, projectId);
  const instId = inst ? num(pick(inst, 'id')) : null;
  const ctx = { instId, sections: 0, items: 0, pending: 0, effItems: 0, dims: 0, cfs: 0, baselines: 0, chosen: 0, nre: 0, nreNeg: 0, pkgItems: 0, qtyScen: 0, runs: 0, matrixFull: false, submitted: 0, approved: 0, rounds: 0 };
  if (instId) {
    const s = await g(`SELECT COUNT(*) AS n FROM bom_section WHERE bom_instance_id=?`, instId);
    ctx.sections = s ? num(pick(s, 'n')) : 0;
    const it = await g(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN ch.ap IS NULL THEN 1 ELSE 0 END) AS pend
         FROM bom_item i JOIN bom_category c ON c.id=i.bom_category_id JOIN bom_section s ON s.id=c.bom_section_id
         LEFT JOIN (SELECT bom_item_id, MAX(applied_price_usd) ap FROM bom_item_price_snapshot WHERE is_chosen=1 GROUP BY bom_item_id) ch ON ch.bom_item_id=i.id
        WHERE s.bom_instance_id=?`, instId);
    ctx.items = it ? num(pick(it, 'n')) : 0;
    ctx.pending = it ? num(pick(it, 'pend')) : 0;
    ctx.chosen = ctx.items - ctx.pending;
    const ef = await g(
      `SELECT COUNT(DISTINCT e.bom_item_id) AS n FROM bom_item_effectivity e
         JOIN bom_item i ON i.id=e.bom_item_id JOIN bom_category c ON c.id=i.bom_category_id JOIN bom_section s ON s.id=c.bom_section_id
        WHERE s.bom_instance_id=?`, instId);
    ctx.effItems = ef ? num(pick(ef, 'n')) : 0;
    const pk = await g(
      `SELECT COUNT(*) AS n FROM bom_item i JOIN bom_category c ON c.id=i.bom_category_id JOIN bom_section s ON s.id=c.bom_section_id
        WHERE s.bom_instance_id=? AND s.module_category='PKG'`, instId);
    ctx.pkgItems = pk ? num(pick(pk, 'n')) : 0;
  }
  const d = await g(`SELECT COUNT(*) AS n FROM bom_variant_dimension WHERE project_id=?`, projectId);
  ctx.dims = d ? num(pick(d, 'n')) : 0;
  const cf = await g(`SELECT COUNT(*) AS n, COUNT(baseline_id) AS b FROM bom_cs_case_factory WHERE case_id=?`, projectId);
  ctx.cfs = cf ? num(pick(cf, 'n')) : 0;
  ctx.baselines = cf ? num(pick(cf, 'b')) : 0;
  const nr = await g(`SELECT COUNT(*) AS n FROM bom_nre_item WHERE project_id=?`, projectId);
  ctx.nre = nr ? num(pick(nr, 'n')) : 0;
  const ng = await g(`SELECT COUNT(unit_price_negotiated) AS n FROM bom_nre_item WHERE project_id=?`, projectId);
  ctx.nreNeg = ng ? num(pick(ng, 'n')) : 0;
  const qs = await g(`SELECT COUNT(*) AS n FROM bom_cs_case_qty_scenario s JOIN bom_cs_case_factory cf ON cf.case_factory_id=s.case_factory_id WHERE cf.case_id=?`, projectId);
  ctx.qtyScen = qs ? num(pick(qs, 'n')) : 0;
  const rn = await g(`SELECT COUNT(*) AS n FROM bom_cs_run r JOIN bom_cs_case_factory cf ON cf.case_factory_id=r.case_factory_id WHERE cf.case_id=? AND r.status='ready'`, projectId);
  ctx.runs = rn ? num(pick(rn, 'n')) : 0;
  try {
    const mx = await require('./bomFactoryCompareService').getMatrix(db, { projectId });
    const total = (mx.combos || []).length * (mx.factories || []).length;
    let f = 0;
    for (const c of mx.combos || []) for (const fa of mx.factories || []) if (mx.cells[`${fa.caseFactoryId}|${c.sig}|BASE`]) f += 1;   // BASE 口徑(#8)
    ctx.matrixFull = total > 0 && f >= total;
  } catch (_) { /* noop */ }
  const qv = await g(`SELECT SUM(CASE WHEN status='SUBMITTED' THEN 1 ELSE 0 END) AS s, SUM(CASE WHEN status='APPROVED' THEN 1 ELSE 0 END) AS a FROM bom_quote_version WHERE project_id=?`, projectId);
  ctx.submitted = qv ? num(pick(qv, 's')) : 0;
  ctx.approved = qv ? num(pick(qv, 'a')) : 0;
  const rd = await g(`SELECT COUNT(*) AS n FROM bom_negotiation_round WHERE project_id=?`, projectId);
  ctx.rounds = rd ? num(pick(rd, 'n')) : 0;
  return ctx;
}

// 26 步定義:auto=判定函式(有 → 自動勾);無 auto = manual(手動勾)。goto = UI 跳轉目標(BomSection 區塊)
const STAGES = [
  {
    stage: 4, code: 'BOM_PROVIDE', name: 'BOM 提供', owner: 'RD(EE/ME)', color: 'purple',
    steps: [
      { id: '4.1', name: '上傳 BOM Excel(統一格式)', desc: '下載標準範本 → 填 EE/ME/PKG → 匯入', auto: (c) => !!c.instId, goto: 'bom' },
      { id: '4.2', name: '半成品 / 分類結構確認', desc: '匯入後檢查半成品(Main Board…)與分類樹', auto: (c) => c.sections > 0, goto: 'bom' },
      { id: '4.3', name: '定義變異軸(顏色/包裝)', desc: '先定義才可匯入含適用欄的料(B-3a 硬擋)', auto: (c) => c.dims > 0, goto: 'bom' },
      { id: '4.4', name: '料件適用(effectivity)標記', desc: 'ME 分色 / PKG 分包裝 → 適用欄', auto: (c) => c.effItems > 0, goto: 'bom' },
      { id: '4.5', name: 'EE 共用 / ME·PKG 分變體確認', desc: '共用料不標適用 = 全配置皆含', auto: (c) => c.effItems > 0 && c.items > c.effItems, goto: 'bom' },
    ],
  },
  {
    stage: 5, code: 'PARALLEL_COLLECT', name: '並行 Collect', owner: '採購 + 廠 EPM', color: 'blue',
    steps: [
      { id: '5.1', name: '建立試算廠別(case factory)', desc: '＋廠別 → 從範本庫 provision', auto: (c) => c.cfs > 0, goto: 'bom' },
      { id: '5.2', name: '匯入成本模型(Cleansheet)', desc: '廠別標準 Excel 匯入(baseline/製程/IDL/設備)', auto: (c) => c.baselines > 0, goto: 'bom' },
      { id: '5.3', name: '逐料詢價(vendor + 單價)', desc: '料件明細 → FLK → 供應商/報價', auto: (c) => c.chosen > 0, goto: 'bom' },
      { id: '5.4', name: 'Tier 雙價(量階報價)', desc: '同料多量階價(tier)輸入', auto: null, goto: 'bom' },
      { id: '5.5', name: 'ERP 拉歷史價參考', desc: 'B-6 規劃中 — 先人工參考 ERP', auto: null },
      { id: '5.6', name: '詢價全數完成(無 PENDING)', desc: '所有料都有採用價', auto: (c) => c.items > 0 && c.pending === 0, goto: 'bom' },
      { id: '5.7', name: 'NRE 費用填列', desc: '模具/治具/測試/NPI 一次性費用', auto: (c) => c.nre > 0, goto: 'nre' },
      { id: '5.8', name: 'NRE 議價(Original → Negotiated)', desc: '雙欄議價削減(#7)', auto: (c) => c.nreNeg > 0, goto: 'nre' },
      { id: '5.9', name: '包裝 BOM 完成', desc: 'PKG 模組料 + 包裝變異值', auto: (c) => c.pkgItems > 0, goto: 'packaging' },
      { id: '5.10', name: '數量情境(Qty Scenario)確認', desc: 'BASE/LOW/HIGH 年量情境', auto: (c) => c.qtyScen > 0 },
      { id: '5.11', name: 'Cleansheet 參數 diff 檢視', desc: '與廠別標準版比對差異', auto: null, goto: 'bom' },
      { id: '5.12', name: '客供料確認', desc: 'BOM 案級欄:有無客供 + 明細(#4)', auto: null, goto: 'bom' },
      { id: '5.13', name: '觸發成本試算(Compute)', desc: '④ 算成本 → run', auto: (c) => c.runs > 0, goto: 'bom' },
    ],
  },
  {
    stage: 6, code: 'BOM_COST_REVIEW', name: 'BOM Cost Review', owner: 'EPM / DPM', color: 'teal',
    steps: [
      { id: '6.1', name: '多廠矩陣全格計算', desc: '配置 × 廠別 各算一價', auto: (c) => c.matrixFull, goto: 'cost' },
      { id: '6.2', name: 'Review 矩陣 cells(異常值)', desc: '逐格檢查價格合理性', auto: null, goto: 'cost' },
      { id: '6.3', name: 'Margin 檢視(vs 底線)', desc: 'true / margin(HOST 視角)', auto: null, goto: 'cost' },
      { id: '6.4', name: 'BOM Lock(報價送審)', desc: '選廠 → 送審 = 鎖定', auto: (c) => c.submitted + c.approved > 0, goto: 'cost' },
      { id: '6.5', name: 'AI 比對上代', desc: '選上代案 → diff + AI 摘要', auto: null, goto: 'cost' },
    ],
  },
  {
    stage: 7, code: 'BIZ_GATE', name: '業務 Gate', owner: '業務 / PM', color: 'amber',
    steps: [
      { id: '7.1', name: '報價單 PDF 輸出(中/EN)', desc: '官方版 → 客戶報價單', auto: null, goto: 'cost' },
      { id: '7.2', name: '簽核(官方版核准)', desc: 'SoD:送審者 ≠ 核准者', auto: (c) => c.approved > 0, goto: 'cost' },
      { id: '7.3', name: '議價 / Reprice', desc: '議價紀錄輪次;讓價成立 → 改價重算送審新版', auto: (c) => c.rounds > 0, goto: 'cost' },
    ],
  },
];

const ALL_STEPS = STAGES.flatMap((s) => s.steps);
const TOTAL = ALL_STEPS.length;   // 26

/** checklist 全量(含每步狀態/附圖)*/
async function getChecklist(db, projectId, form = {}) {
  const ctx = await _buildCtx(db, projectId);
  const wf = form.workflow || {};
  const done = wf.done || {};
  const images = wf.images || {};
  let filled = 0;
  const stages = STAGES.map((st) => ({
    stage: st.stage, code: st.code, name: st.name, owner: st.owner, color: st.color,
    steps: st.steps.map((s) => {
      const autoDone = s.auto ? !!s.auto(ctx) : false;
      const manualDone = !!done[s.id];
      const isDone = s.auto ? autoDone : manualDone;
      if (isDone) filled += 1;
      return {
        id: s.id, name: s.name, desc: s.desc, goto: s.goto || null,
        mode: s.auto ? 'auto' : 'manual',
        done: isDone, manualDone,
        images: Array.isArray(images[s.id]) ? images[s.id] : [],
      };
    }),
  }));
  return { projectId, filled, total: TOTAL, stages };
}

/** 完成度(給 bomFormService)*/
async function completion(db, projectId, form = {}) {
  const r = await getChecklist(db, projectId, form);
  return { filled: r.filled, total: r.total };
}

module.exports = { getChecklist, completion, STAGES, TOTAL };
