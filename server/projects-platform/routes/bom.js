/**
 * /api/projects/bom — Cortex BOM dev-test route(admin-only · flag-gated ENABLE_CORTEX_BOM)
 *
 * 讓開發端能互動測 BOM 流程:上傳 Excel → 正規化 → rollup → computeCase → 看 run 結果。
 * 對應 docs/cortex-bom-import-plan.md(dev-test enabler · 非最終產品 UI)。
 *
 * ⚠️ dark-launch:整個 router 只在 ENABLE_CORTEX_BOM=true 時 mount(見 index.js),
 *    且 requireAdminMode(admin only)。未開 flag = 不存在 = 對現有使用者零影響。
 * ⚠️ 權限暫用 admin-only;三軸 RBAC(資料範圍/欄位機密)整合 = S2。
 *
 * Endpoints:
 *   GET  /cases                      列 case_factory(找 caseFactoryId/projectId)
 *   POST /import       multipart     上傳 BOM Excel → 正規化(body: projectId, sheetKeys, variantKey, versionNo)
 *   GET  /instances/:id              instance + sections
 *   GET  /instances/:id/rollup       material rollup byCategory
 *   GET  /instances/:id/items        item 明細(limit)
 *   POST /compute                    computeCase(persist)(body: caseFactoryId, bomInstanceId?, qtyScenarioCode?)
 *   GET  /runs?caseFactoryId=        列該 case 的 run
 *   GET  /runs/:runId                run header + result + cells
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { asyncHandler } = require('../middleware/errorBoundary');
const { requireVisible } = require('../middleware/sidebarPermissionMiddleware');
const importSvc = require('../services/bomImportService');
const profileSvc = require('../services/bomImportProfileService');
const rollupSvc = require('../services/bomMaterialRollup');
const templateSvc = require('../services/bomTemplateService');
const enrichSvc = require('../services/bomEnrichService');
const provisionSvc = require('../services/bomCaseProvisionService');
const compareSvc = require('../services/bomFactoryCompareService');
const nreSvc = require('../services/bomNreService');
const quoteSvc = require('../services/bomQuoteService');
const engine = require('../services/bomCostEngine');
const variantSvc = require('../services/bomVariantService');
const stageSvc = require('../services/bomStageService');
const { canViewTrueCost, maskCostDeep } = require('../middleware/confidentialityMiddleware');

const router = express.Router();

// ── S2 機密遮罩(P1):全 BOM JSON 回應統一過 true-cost 深層遮罩 ─────────────
// 非全視角(PARTICIPANT/OUTSIDER)→ totalTrue/margin/true_cost/markup/unit_true… 一律 null + costMasked
// UI 既有 typeof==='number' guard 自動隱藏;權威在 server,前端切 RoleSwitcher 立即生效。
router.use((req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (body) => origJson(maskCostDeep(body, canViewTrueCost(req)));
  next();
});
function getDb() { return require('../../database-oracle').db; }
// 數字參數防呆:非數字 → 400(避免 Number("<id>")=NaN 打進 Oracle 噴 NJS-105 500)
function reqId(v, res, name = 'id') { const n = Number(v); if (!Number.isFinite(n)) { res.status(400).json({ error: `invalid ${name}: ${v}` }); return null; } return n; }

// 專案成員(含 RD)皆可用(平台可見即可)· 細粒度 RD×資料範圍×欄位機密 = S2 三軸 RBAC
router.use(requireVisible);

// 上傳暫存:UPLOAD_ROOT/projects/bom/{userId}
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || process.env.UPLOAD_DIR || './uploads';
const BOM_DIR = path.join(UPLOAD_ROOT, 'projects', 'bom');
try { fs.mkdirSync(BOM_DIR, { recursive: true }); } catch (_) {}
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const d = path.join(BOM_DIR, String(req.user?.id || 'unknown'));
    try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
    cb(null, d);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.xlsx';
    cb(null, `bom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.xlsx?$/i.test(file.originalname)) return cb(null, true);
    cb(new Error(`need .xlsx/.xls: ${file.originalname}`));
  },
});

// GET /template — 下載標準 BOM 匯入範本(EE/ME/PKG 三分頁 + 說明)
router.get('/template', asyncHandler(async (req, res) => {
  const buf = templateSvc.buildTemplateBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="cortex-bom-template.xlsx"');
  res.send(buf);
}));

// GET /cases[?projectId=] — 列 case_factory + project(可篩單一 project · 專案內用)
router.get('/cases', asyncHandler(async (req, res) => {
  const pid = req.query.projectId ? Number(req.query.projectId) : null;
  if (pid != null && !Number.isFinite(pid)) return res.status(400).json({ error: `invalid projectId: ${req.query.projectId}` });
  // bind 必須綁在 .all() 上(wrapper prepare(sql) 只吃 sql · 見 database-oracle.js:183/213)
  const rows = await getDb().prepare(
    `SELECT cf.case_factory_id, cf.case_id AS project_id, cf.factory_code, cf.costing_model, cf.status, p.project_code
       FROM bom_cs_case_factory cf JOIN projects p ON p.id = cf.case_id
      ${pid != null ? 'WHERE cf.case_id = ?' : ''}
      ORDER BY cf.case_factory_id DESC`,
  ).all(...(pid != null ? [pid] : [])).catch(() => []);
  res.json({ cases: rows });
}));

// GET /summary?projectId= — 成本核算 headline:各 case_factory 最新 run 的 result(唯讀 · 不重算)
router.get('/summary', asyncHandler(async (req, res) => {
  const pid = Number(req.query.projectId);
  if (!pid) return res.status(400).json({ error: 'projectId required' });
  const rows = await getDb().prepare(
    `SELECT cf.case_factory_id, cf.factory_code, cf.costing_model, cf.status AS case_status,
            r.run_id, r.computed_at,
            rr.material_true_usd, rr.material_quote_usd, rr.mva_usd, rr.sga_usd, rr.profit_amount_usd,
            rr.total_true_usd, rr.total_quote_usd, rr.margin_amount_usd, rr.gross_margin_pct,
            rr.nre_per_unit_quote_usd, rr.nre_per_unit_true_usd
       FROM bom_cs_case_factory cf
       LEFT JOIN bom_cs_run r ON r.run_id = (SELECT MAX(run_id) FROM bom_cs_run WHERE case_factory_id = cf.case_factory_id)
       LEFT JOIN bom_cs_run_result rr ON rr.run_id = r.run_id
      WHERE cf.case_id = ?
      ORDER BY cf.case_factory_id`,
  ).all(pid).catch(() => []);
  // 含 NRE 攤提的 total(product total + nre_per_unit)· wrapper 回小寫 key
  const factories = rows.map((r) => {
    const tq = Number(r.total_quote_usd), tt = Number(r.total_true_usd);
    const nreQ = Number(r.nre_per_unit_quote_usd) || 0, nreT = Number(r.nre_per_unit_true_usd) || 0;
    return {
      ...r,
      total_quote_with_nre: Number.isFinite(tq) ? tq + nreQ : null,
      total_true_with_nre: Number.isFinite(tt) ? tt + nreT : null,
    };
  });
  // 標最便宜(依含 NRE 的對客 total)
  const totals = factories.map((f) => f.total_quote_with_nre).filter((n) => Number.isFinite(n) && n > 0);
  const minTotal = totals.length ? Math.min(...totals) : null;
  factories.forEach((f) => { f.isCheapest = minTotal != null && f.total_quote_with_nre === minTotal; });
  res.json({ projectId: pid, factories });
}));

// ── §9.4 開案自動建 case_factory(從範本 clone)──────────────────────────────
// GET /provision/templates — 列可選成本模型範本(廠 / model)
router.get('/provision/templates', asyncHandler(async (req, res) => {
  // C-2:確保範本庫存在 + fixture seed(冪等);C-3:?includeInactive=1 查歷史版
  try { await require('../services/bomCostModelService').ensureTemplateLibrary(getDb()); } catch (e) { /* 庫建失敗仍回列表 */ }
  if (req.query.includeInactive === '1') return res.json({ templates: await provisionSvc.listTemplates(getDb(), { includeInactive: true }) });
  res.json({ templates: await provisionSvc.listTemplates(getDb()) });
}));

// POST /provision-case — 為專案建 case_factory(body: projectId, sourceCaseFactoryId, variantKey?, factoryCode?, baselineId?)
// factoryCode override:clone 範本的成本模型結構,但綁「別的廠 site」(加 CN/VN 多廠差異化用)
router.post('/provision-case', asyncHandler(async (req, res) => {
  const projectId = Number(req.body.projectId);
  const sourceCaseFactoryId = Number(req.body.sourceCaseFactoryId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  if (!sourceCaseFactoryId) return res.status(400).json({ error: 'sourceCaseFactoryId required' });
  const out = await provisionSvc.provisionCase(getDb(), {
    projectId, sourceCaseFactoryId, variantKey: req.body.variantKey || null,
    factoryCode: req.body.factoryCode || null,
    baselineId: req.body.baselineId ? Number(req.body.baselineId) : null,
  });
  res.json({ ok: true, ...out });
}));

// ── C-1 成本模型 通用匯入/匯出(docs/cortex-cost-model-import-plan.md)────────
const costModelSvc = require('../services/bomCostModelService');
const XLSXcm = require('xlsx');
const sendWb = (res, wb, filename) => {
  const buf = XLSXcm.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.send(buf);
};
// 成本模型 Excel(範本/匯出)整包 = 內部參數 → 非全視角 403(S2)
router.use('/cost-model', (req, res, next) => { if (!canViewTrueCost(req)) return res.status(403).json({ error: '成本模型維護需完整成本視角(HOST/admin)' }); next(); });
router.use('/case/:caseFactoryId/cost-model', (req, res, next) => { if (!canViewTrueCost(req)) return res.status(403).json({ error: '成本模型匯出需完整成本視角' }); next(); });

// GET /cost-model/template?model=&blank=1 — 下載範本(blank=1 空白範本+說明對照;否則真實樣例)
router.get('/cost-model/template', asyncHandler(async (req, res) => {
  const model = String(req.query.model || 'SIMPLIFIED_WEARABLE');
  const blank = req.query.blank === '1' || req.query.blank === 'true';
  const { wb } = blank ? await costModelSvc.blankTemplateWorkbook(getDb(), model) : await costModelSvc.templateWorkbook(getDb(), model);
  sendWb(res, wb, `cost-model-${blank ? 'blank' : 'sample'}-${model}.xlsx`);
}));
// GET /case/:caseFactoryId/cost-model — 匯出此廠成本模型(round-trip)
router.get('/case/:caseFactoryId/cost-model', asyncHandler(async (req, res) => {
  const cf = Number(req.params.caseFactoryId);
  if (!cf) return res.status(400).json({ error: 'caseFactoryId required' });
  const { wb, model, factoryCode } = await costModelSvc.exportCostModel(getDb(), cf);
  sendWb(res, wb, `cost-model-${factoryCode}-${model}-cf${cf}.xlsx`);
}));
// POST /cost-model/import-template — 匯入到範本庫(a 路徑 · admin only)(multipart: file, factoryCode?)
router.post('/cost-model/import-template', upload.single('file'), asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') { try { fs.unlinkSync(req.file?.path); } catch (_) {} return res.status(403).json({ error: '範本庫維護限 admin' }); }
  if (!req.file) return res.status(400).json({ error: 'file required' });
  try {
    const out = await costModelSvc.importToTemplateLibrary(getDb(), { filePath: req.file.path, factoryCode: req.body.factoryCode || null, templateLabel: req.body.label || null });
    res.json({ ok: true, ...out });
  } catch (e) {
    if (String(e.code || '').startsWith('COST_MODEL_')) return res.status(409).json({ error: e.message, code: e.code, missing: e.missing || undefined });
    throw e;
  } finally { try { fs.unlinkSync(req.file.path); } catch (_) {} }
}));

// PUT /cost-model/template/:cfId/active — 停用/啟用範本(C-3 · admin)(body: active 0|1)
router.put('/cost-model/template/:cfId/active', asyncHandler(async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '範本庫維護限 admin' });
  const cfId = Number(req.params.cfId);
  if (!cfId) return res.status(400).json({ error: 'cfId required' });
  try { res.json({ ok: true, ...(await costModelSvc.setTemplateActive(getDb(), cfId, req.body.active !== 0 && req.body.active !== '0')) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
}));

// POST /cost-model/import — 匯入成本模型 → 專案(multipart: file, projectId, factoryCode?)
router.post('/cost-model/import', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const projectId = Number(req.body.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try {
    const out = await costModelSvc.importCostModel(getDb(), { filePath: req.file.path, projectId, factoryCode: req.body.factoryCode || null });
    res.json({ ok: true, ...out });
  } catch (e) {
    if (String(e.code || '').startsWith('COST_MODEL_')) return res.status(409).json({ error: e.message, code: e.code, missing: e.missing || undefined });
    throw e;
  } finally { try { fs.unlinkSync(req.file.path); } catch (_) {} }
}));

// GET /project/:projectId/matrix — 多廠矩陣(B-3d):配置組合 × 廠別 · cell 讀 run 快取(缺格前端 on-demand /compute)
router.get('/project/:projectId/matrix', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  res.json(await compareSvc.getMatrix(getDb(), { projectId }));
}));

// POST /compare — 多廠對比(算專案所有 case_factory 的同一 BOM · 標最便宜)(body: projectId, bomInstanceId?, qtyScenarioCode?, force?)
router.post('/compare', asyncHandler(async (req, res) => {
  const projectId = Number(req.body.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  const opts = { projectId, computedBy: req.user?.id || null };
  if (req.body.bomInstanceId) opts.bomInstanceId = Number(req.body.bomInstanceId);
  if (req.body.qtyScenarioCode) opts.qtyScenarioCode = req.body.qtyScenarioCode;
  if (req.body.force === true || req.body.force === 'true' || req.body.allowPending) opts.allowPending = true;
  const cmp = await compareSvc.compareFactories(getDb(), opts);
  stageSvc.autoAdvanceTo(getDb(), projectId, 'BOM_COST_REVIEW', '多廠成本重算').catch(() => {});   // Stage Gate
  res.json(cmp);
}));

// ── Track N NRE(一次性工程費 · project 層)──────────────────────────────────
// GET /nre?projectId= — NRE 明細 + 彙總(雙價)+ 模式 + 攤提每台
router.get('/nre', asyncHandler(async (req, res) => {
  const pid = Number(req.query.projectId);
  if (!pid) return res.status(400).json({ error: 'projectId required' });
  const [rollup, config, amortized] = await Promise.all([
    nreSvc.rollupNre(getDb(), pid), nreSvc.getConfig(getDb(), pid), nreSvc.amortizedPerUnit(getDb(), pid),
  ]);
  res.json({ projectId: pid, rollup, config, amortized });
}));

// POST /nre/item — 新增 NRE 項(body: projectId, category, description, qty, unitPriceTrue, unitPriceQuote, factoryCode, remark)
router.post('/nre/item', asyncHandler(async (req, res) => {
  const pid = Number(req.body.projectId);
  if (!pid) return res.status(400).json({ error: 'projectId required' });
  res.json({ ok: true, ...(await nreSvc.addItem(getDb(), pid, req.body)) });
}));

// DELETE /nre/item/:id
// PUT /nre/item/:id — 議價後價/備註(v0.16 #7)(body: unitPriceNegotiated?, remark?)
router.put('/nre/item/:id', asyncHandler(async (req, res) => {
  const id = reqId(req.params.id, res); if (id === null) return;
  res.json(await nreSvc.updateItem(getDb(), id, { unitPriceNegotiated: req.body.unitPriceNegotiated, remark: req.body.remark }));
}));

router.delete('/nre/item/:id', asyncHandler(async (req, res) => {
  const id = reqId(req.params.id, res); if (id === null) return;
  res.json({ ok: true, ...(await nreSvc.deleteItem(getDb(), id)) });
}));

// PUT /nre/config — 設模式(body: projectId, nreMode SEPARATE|AMORTIZED, nreAmortizeQty, amortizeSide quote|true)
router.put('/nre/config', asyncHandler(async (req, res) => {
  const pid = Number(req.body.projectId);
  if (!pid) return res.status(400).json({ error: 'projectId required' });
  res.json({ ok: true, config: await nreSvc.setConfig(getDb(), pid, req.body) });
}));

// ── 報價定版 / 送審(流程終點)──────────────────────────────────────────────
// GET /quote?projectId= — 版本歷史 + 當前官方(APPROVED)
router.get('/quote', asyncHandler(async (req, res) => {
  const pid = Number(req.query.projectId);
  if (!pid) return res.status(400).json({ error: 'projectId required' });
  res.json(await quoteSvc.listQuotes(getDb(), pid));
}));

// POST /quote/submit — 送審(快照某廠最新 run)(body: projectId, caseFactoryId, note)
router.post('/quote/submit', asyncHandler(async (req, res) => {
  const projectId = Number(req.body.projectId), caseFactoryId = Number(req.body.caseFactoryId);
  if (!projectId || !caseFactoryId) return res.status(400).json({ error: 'projectId + caseFactoryId required' });
  try {
    const out = await quoteSvc.submitQuote(getDb(), { projectId, caseFactoryId, note: req.body.note || null, userId: req.user?.id || null });
    stageSvc.autoAdvanceTo(getDb(), projectId, 'RFQ_COST_REVIEW', '報價送審').catch(() => {});
    res.json({ ok: true, ...out });
  } catch (e) { res.status(400).json({ error: e.message }); }
}));

// POST /quote/approve — 核准(= 官方 · 鎖 case)(body: versionId)· 擋自我核准(SoD)
router.post('/quote/approve', asyncHandler(async (req, res) => {
  const versionId = Number(req.body.versionId);
  if (!versionId) return res.status(400).json({ error: 'versionId required' });
  try {
    const out = await quoteSvc.approveQuote(getDb(), { versionId, userId: req.user?.id || null, isAdmin: req.user?.role === 'admin' });
    if (out.projectId) stageSvc.autoAdvanceTo(getDb(), out.projectId, 'SUBMIT_QUOTE', '報價核准').catch(() => {});
    res.json({ ok: true, ...out });
  } catch (e) {
    if (e.code === 'SELF_APPROVAL_BLOCKED') return res.status(403).json({ error: e.message, code: e.code });
    throw e;
  }
}));

// ── v0.16 #9 Cleansheet 檢視(component × process 矩陣 · run cells pivot)─────
// GET /case/:caseFactoryId/cleansheet?qty= — baseline bar + KPI + 矩陣(整包內部成本 → 非全視角 403)
router.get('/case/:caseFactoryId/cleansheet', asyncHandler(async (req, res) => {
  if (!canViewTrueCost(req)) return res.status(403).json({ error: 'Cleansheet 為內部成本結構,需完整成本視角(HOST/admin)' });
  const cf = reqId(req.params.caseFactoryId, res, 'caseFactoryId'); if (cf === null) return;
  const qty = String(req.query.qty || 'BASE');
  const db = getDb();
  const cfRow = await db.prepare(
    `SELECT cf.case_factory_id, cf.factory_code, cf.costing_model, cf.baseline_id,
            b.version_label, b.effective_from, b.dl_wage_per_hr_usd, b.sga_pct, b.profit_pct,
            b.oh_pct, b.vat_rate_pct, b.annual_demand_default, b.imported_by
       FROM bom_cs_case_factory cf LEFT JOIN bom_factory_baseline b ON b.baseline_id = cf.baseline_id
      WHERE cf.case_factory_id = ?`,
  ).get(cf).catch(() => null);
  if (!cfRow) return res.status(404).json({ error: 'case_factory not found' });
  const runRow = await db.prepare(
    `SELECT run_id, variant_value_ids, computed_at FROM bom_cs_run
      WHERE case_factory_id = ? AND status = 'ready' AND NVL(qty_scenario_code,'BASE') = ?
      ORDER BY run_id DESC FETCH FIRST 1 ROWS ONLY`,
  ).get(cf, qty).catch(() => null);
  let matrix = null, kpi = null, runId = null;
  if (runRow) {
    runId = Number(runRow.run_id || Object.values(runRow)[0]);
    const cells = await db.prepare(
      `SELECT process_code, component_code, cost_per_unit_usd, formula_text
         FROM bom_cs_run_cell WHERE run_id = ?`,
    ).all(runId).catch(() => []);
    const comps = [], procs = [], m = {};
    for (const r of cells) {
      const co = String(r.component_code || Object.values(r)[1]);
      const pr = String(r.process_code || Object.values(r)[0]);
      const v = Number(r.cost_per_unit_usd);
      if (!comps.includes(co)) comps.push(co);
      if (!procs.includes(pr)) procs.push(pr);
      m[co] = m[co] || {};
      m[co][pr] = { v, formula: r.formula_text || null };
    }
    // 排序:demo 順序(LABOR → EQUIP → FACILITY → OTHERS;SMT → ASSY → COMMON)
    const compOrder = ['DL_CPU', 'IDL_CPU', 'EQUIP_MRO', 'EQUIP_DEPR', 'IND_MAT', 'FACILITY', 'FREIGHT', 'VAT', 'LOSS'];
    const procOrder = ['SMT_MAIN', 'WAVE_SOLDER', 'ROUTER_OFFLINE', 'LASER_ETCH', 'BB_ASSY', 'BB_TEST', 'MAT_MGMT', 'Q_SMT', 'Q_BB', 'COMMON'];
    comps.sort((a, b) => (compOrder.indexOf(a) + 99 * (compOrder.indexOf(a) < 0 ? 1 : 0)) - (compOrder.indexOf(b) + 99 * (compOrder.indexOf(b) < 0 ? 1 : 0)));
    procs.sort((a, b) => (procOrder.indexOf(a) + 99 * (procOrder.indexOf(a) < 0 ? 1 : 0)) - (procOrder.indexOf(b) + 99 * (procOrder.indexOf(b) < 0 ? 1 : 0)));
    matrix = { components: comps, processes: procs, cells: m };
    const rr = await engine.loadPersistedRun(db, runId).catch(() => null);
    if (rr) {
      const cb = rr.costBreakdown || {};
      const sumProc = (pred) => { let s = 0; for (const co of comps) for (const pr of procs) if (pred(pr) && m[co][pr]) s += m[co][pr].v; return s; };
      kpi = {
        mvaTotal: cb.mva, sga: cb.sga, profit: cb.profit, total: cb.total, material: cb.material,
        smtMva: sumProc((p) => p.startsWith('SMT') || p === 'WAVE_SOLDER' || p === 'ROUTER_OFFLINE' || p === 'LASER_ETCH' || p === 'Q_SMT'),
        assyMva: sumProc((p) => p.startsWith('BB_') || p === 'MAT_MGMT' || p === 'Q_BB'),
      };
    }
  }
  res.json({
    caseFactoryId: cf, factoryCode: cfRow.factory_code, costingModel: cfRow.costing_model, qty, runId,
    baseline: cfRow.baseline_id ? {
      versionLabel: cfRow.version_label, effectiveFrom: cfRow.effective_from,
      dlWagePerHr: cfRow.dl_wage_per_hr_usd, sgaPct: cfRow.sga_pct, profitPct: cfRow.profit_pct,
      ohPct: cfRow.oh_pct, vatPct: cfRow.vat_rate_pct, annualDemand: cfRow.annual_demand_default,
    } : null,
    matrix, kpi,
  });
}));

// GET /instances/:id/top-markup?limit= — Top Markup 料件(v0.16 #11 · markup 高→低)
router.get('/instances/:id/top-markup', asyncHandler(async (req, res) => {
  const id = reqId(req.params.id, res); if (id === null) return;
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const rows = await getDb().prepare(
    `SELECT sec.module_category, i.customer_item AS item_no, i.description, i.qty,
            ch.applied_price_usd AS quote_price, t.true_cost_usd, t.markup_pct,
            (i.qty * (ch.applied_price_usd - t.true_cost_usd)) AS markup_ext
       FROM bom_item i
       JOIN bom_category c ON c.id = i.bom_category_id
       JOIN bom_section sec ON sec.id = c.bom_section_id
       JOIN (
         SELECT s.id AS snap_id, s.bom_item_id, s.applied_price_usd,
                ROW_NUMBER() OVER (PARTITION BY s.bom_item_id ORDER BY s.applied_price_usd, s.id) AS rn
           FROM bom_item_price_snapshot s WHERE s.is_chosen = 1
       ) ch ON ch.bom_item_id = i.id AND ch.rn = 1
       JOIN (
         SELECT snapshot_id, MAX(true_cost_usd) AS true_cost_usd, MAX(markup_pct) AS markup_pct
           FROM bom_item_price_tier WHERE is_chosen = 1 GROUP BY snapshot_id
       ) t ON t.snapshot_id = ch.snap_id
      WHERE sec.bom_instance_id = ? AND t.markup_pct IS NOT NULL AND t.markup_pct > 0
      ORDER BY (i.qty * (ch.applied_price_usd - t.true_cost_usd)) DESC
      FETCH FIRST ${limit} ROWS ONLY`,
  ).all(id).catch(() => []);
  res.json({ count: rows.length, items: rows });
}));

// GET /project/:id/matrix-excel?qty= — 匯出 RFQ Cost Excel(v0.7 矩陣 · 一 sheet per 包裝)
router.get('/project/:projectId/matrix-excel', asyncHandler(async (req, res) => {
  const projectId = reqId(req.params.projectId, res, 'projectId'); if (projectId === null) return;
  const qty = String(req.query.qty || 'BASE');
  const withTrue = canViewTrueCost(req);
  const XLSX = require('xlsx');
  const mx = await compareSvc.getMatrix(getDb(), { projectId });
  const dims = mx.dimensions || [];
  const colorDim = dims.find((d) => /顏色|COLOR/i.test(d.dimCode));
  const pkgDim = dims.find((d) => /包裝|PKG|PACK/i.test(d.dimCode));
  const colors = colorDim && colorDim.values.length ? colorDim.values : [{ id: null, code: '' }];
  const pkgList = pkgDim && pkgDim.values.length ? pkgDim.values : [{ id: null, code: 'ALL' }];
  const p = await getDb().prepare(`SELECT project_code FROM projects WHERE id=?`).get(projectId).catch(() => null);
  const code = (p && (p.project_code || Object.values(p)[0])) || projectId;
  const wb = XLSX.utils.book_new();
  for (const pk of pkgList) {
    const sig = (cid) => [cid, pk.id].filter(Boolean).sort((a, b) => a - b).join(',');
    const cell = (cf, cid) => mx.cells[`${cf.caseFactoryId}|${sig(cid)}|${qty}`] || null;
    const head = ['', ...mx.factories.map((f) => `${f.factoryCode}(${f.costingModel})`)];
    const rows = [head];
    const push = (label, fn) => rows.push([label, ...mx.factories.map((f) => { const v = fn(f); return typeof v === 'number' ? Number(v.toFixed(6)) : ''; })]);
    push('MVA', (f) => (cell(f, colors[0].id) || {}).mva);
    for (const c of colors) push(`Material (Quote)${c.code ? ': ' + c.code : ''}`, (f) => (cell(f, c.id) || {}).material);
    if (withTrue) for (const c of colors) push(`Material (True)${c.code ? ': ' + c.code : ''}`, (f) => (cell(f, c.id) || {}).materialTrue);
    push('SG&A + Profit', (f) => { const x = cell(f, colors[0].id); return x ? (x.sga || 0) + (x.profit || 0) : undefined; });
    push('NRE 攤提', (f) => (cell(f, colors[0].id) || {}).nreQuote);
    for (const c of colors) push(`Total (Quote)${c.code ? ': ' + c.code : ''}`, (f) => (cell(f, c.id) || {}).total);
    if (withTrue) {
      for (const c of colors) push(`Total (True)${c.code ? ': ' + c.code : ''}`, (f) => (cell(f, c.id) || {}).totalTrue);
      for (const c of colors) push(`Gross Margin %${c.code ? ': ' + c.code : ''}`, (f) => { const x = cell(f, c.id); return x && typeof x.marginPct === 'number' ? Number((x.marginPct * 100).toFixed(2)) : undefined; });
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 28 }, ...mx.factories.map(() => ({ wch: 16 }))];
    XLSX.utils.book_append_sheet(wb, ws, String(pk.code || 'ALL').slice(0, 28));
  }
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(`RFQ-Cost-${code}-${qty}.xlsx`)}"`);
  res.send(buf);
}));

// POST /strategy/ai-suggest — 議價策略 AI 草稿(v0.16 #13 · Pro · 只回建議不落庫)
router.post('/strategy/ai-suggest', asyncHandler(async (req, res) => {
  if (!canViewTrueCost(req)) return res.status(403).json({ error: '議價策略需完整成本視角' });
  const projectId = Number(req.body.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  const db = getDb();
  const official = await db.prepare(
    `SELECT version_no, factory_code, unit_quote_usd, unit_true_usd, nre_total_quote_usd FROM bom_quote_version
      WHERE project_id=? AND status='APPROVED' ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`,
  ).get(projectId).catch(() => null);
  const rounds = await db.prepare(
    `SELECT round_no, customer_target_usd, our_offer_usd, outcome, note FROM bom_negotiation_round WHERE project_id=? ORDER BY round_no`,
  ).all(projectId).catch(() => []);
  const p = await db.prepare(`SELECT project_code, data_payload FROM projects WHERE id=?`).get(projectId).catch(() => null);
  let payload = {}; try { payload = JSON.parse((p && (p.data_payload || Object.values(p)[1])) || '{}'); } catch (_) { /* noop */ }
  const ctx = {
    project: p ? (p.project_code || Object.values(p)[0]) : projectId,
    customer: payload.customer || null, annualQty: payload.quantity || null,
    official: official ? { quote: Number(official.unit_quote_usd), true: Number(official.unit_true_usd), factory: official.factory_code, nre: Number(official.nre_total_quote_usd) } : null,
    negotiationRounds: rounds.map((r) => ({ round: Number(r.round_no), target: r.customer_target_usd, offer: r.our_offer_usd, outcome: r.outcome, note: r.note })),
  };
  const gemini = require('../../services/gemini');
  const prompt = [
    '你是 ODM 業務策略顧問。根據以下報價案脈絡,用繁體中文產出議價策略草稿。',
    '只回 JSON(不要 markdown fence),欄位:',
    '{"cust_room":"客戶議價空間評估(2-3 句)","strategy_note":"議價策略建議(3-4 句,含讓價階梯)","qty_discount":"量價條件建議(1-2 句)","win_prob":"HIGH|MEDIUM|LOW","fallback":"最低可接受價(數字,依底線+合理 margin)"}',
    '鐵則:引用脈絡中的數字,不得虛構;fallback 不得低於 true 成本。',
    `脈絡:${JSON.stringify(ctx)}`,
  ].join('\n');
  const r = await gemini.generateTextSync(process.env.GEMINI_MODEL_PRO, [], prompt, {});
  let suggest = null;
  try { suggest = JSON.parse(String(r.text || '').replace(/^```json?\s*|\s*```$/g, '')); } catch (_) { suggest = { strategy_note: r.text }; }
  res.json({ ok: true, suggest, model: process.env.GEMINI_MODEL_PRO });
}));

// ── v0.16 #2 操作流程 checklist(26 步 · 自動判定 + 手動勾 + 附圖)────────────
// GET /workflow/checklist?projectId=
router.get('/workflow/checklist', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  const formSvc = require('../services/bomFormService');
  const { form } = await formSvc.getForm(getDb(), projectId, { canViewTrue: true });
  res.json(await require('../services/bomWorkflowChecklistService').getChecklist(getDb(), projectId, form));
}));

// 附圖用獨立 multer(BOM 主 upload 的 fileFilter 只收 xlsx)
const imgUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(png|jpe?g|gif|webp)$/i.test(file.originalname) || /^image\//.test(file.mimetype || '')) return cb(null, true);
    cb(new Error(`僅接受圖片檔: ${file.originalname}`));
  },
});

// POST /workflow/step-image — 步驟附圖(multipart: file + projectId + stepId + caption?)(D5)
router.post('/workflow/step-image', imgUpload.single('file'), asyncHandler(async (req, res) => {
  const projectId = Number(req.body.projectId);
  const stepId = String(req.body.stepId || '');
  if (!projectId || !stepId || !req.file) return res.status(400).json({ error: 'projectId + stepId + file required' });
  if (!/\.(png|jpe?g|gif|webp)$/i.test(req.file.originalname) && !/^image\//.test(req.file.mimetype || '')) {
    try { fs.unlinkSync(req.file.path); } catch (_) { /* noop */ }
    return res.status(400).json({ error: '僅接受圖片檔(png/jpg/gif/webp)' });
  }
  // 檔案已由 multer 存到 BOM_DIR/{userId}/;記相對 /uploads URL 進 form.workflow.images
  const rel = path.relative(UPLOAD_ROOT, req.file.path).replace(/\\/g, '/');
  const url = `/uploads/${rel}`;
  const formSvc = require('../services/bomFormService');
  const { form } = await formSvc.getForm(getDb(), projectId, { canViewTrue: true });
  const wf = form.workflow || {};
  const images = wf.images || {};
  images[stepId] = [...(images[stepId] || []), { url, caption: String(req.body.caption || '').slice(0, 200), at: new Date().toISOString(), by: req.user?.id || null }];
  await formSvc.patchForm(getDb(), projectId, 'workflow', { images }, { canViewTrue: true });
  res.json({ ok: true, stepId, url });
}));

// DELETE /workflow/step-image — 移除附圖(body: projectId, stepId, url)
router.delete('/workflow/step-image', asyncHandler(async (req, res) => {
  const projectId = Number(req.body.projectId);
  const stepId = String(req.body.stepId || '');
  const url = String(req.body.url || '');
  if (!projectId || !stepId || !url) return res.status(400).json({ error: 'projectId + stepId + url required' });
  const formSvc = require('../services/bomFormService');
  const { form } = await formSvc.getForm(getDb(), projectId, { canViewTrue: true });
  const images = (form.workflow || {}).images || {};
  images[stepId] = (images[stepId] || []).filter((x) => x.url !== url);
  await formSvc.patchForm(getDb(), projectId, 'workflow', { images }, { canViewTrue: true });
  res.json({ ok: true });
}));

// ── v0.16 報價 Form:案級欄位 + 完成度(plan #0 · data_payload.form)──────────
// GET /form?projectId= — form 值 + 各段完成度(機密段非全視角遮 ▒▒▒)
router.get('/form', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  res.json(await require('../services/bomFormService').getForm(getDb(), projectId, { canViewTrue: canViewTrueCost(req) }));
}));

// PUT /form/:section — patch 一段欄位(body: {projectId, fields});機密段非全視角 403
router.put('/form/:section', asyncHandler(async (req, res) => {
  const projectId = Number(req.body.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try {
    res.json(await require('../services/bomFormService').patchForm(getDb(), projectId, String(req.params.section), req.body.fields, { canViewTrue: canViewTrueCost(req) }));
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
}));

// POST /compare-legacy — AI 比對上代(body: projectId, legacyProjectId, withAi?)(P1)
// diff 程式算(quote 側);withAi=1 → Gemini Pro 摘要(只解讀不算數)
router.post('/compare-legacy', asyncHandler(async (req, res) => {
  const svc = require('../services/bomLegacyCompareService');
  try {
    res.json(await svc.compareLegacy(getDb(), {
      projectId: Number(req.body.projectId), legacyProjectId: Number(req.body.legacyProjectId),
      withAi: req.body.withAi === true || req.body.withAi === 'true' || req.body.withAi === 1,
    }));
  } catch (e) { res.status(400).json({ error: e.message }); }
}));

// ── P1 議價紀錄(定版後輪次 · vs 底線 margin 走 S2 遮罩)────────────────────
// GET /negotiation?projectId= — 輪次列表 + 對照官方版(quote/true)
router.get('/negotiation', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  const db = getDb();
  const official = await db.prepare(
    `SELECT id, version_no, factory_code, unit_quote_usd, unit_true_usd FROM bom_quote_version
      WHERE project_id=? AND status='APPROVED' ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`,
  ).get(projectId).catch(() => null);
  const rows = await db.prepare(
    `SELECT n.id, n.round_no, n.quote_version_id, n.customer_target_usd, n.our_offer_usd, n.outcome, n.note, n.created_at,
            u.name AS created_by_name
       FROM bom_negotiation_round n LEFT JOIN users u ON u.id = n.created_by
      WHERE n.project_id=? ORDER BY n.round_no`,
  ).all(projectId).catch(() => []);
  const trueUsd = official ? Number(official.unit_true_usd) : null;
  const rounds = rows.map((r) => ({
    ...r,
    // vs 底線(true):S2 wrapper 依欄名(marginUsd/marginPct)對非全視角自動砍
    marginUsd: (trueUsd != null && r.our_offer_usd != null) ? Number(r.our_offer_usd) - trueUsd : null,
    marginPct: (trueUsd != null && r.our_offer_usd != null && Number(r.our_offer_usd) > 0) ? (Number(r.our_offer_usd) - trueUsd) / Number(r.our_offer_usd) : null,
  }));
  res.json({ projectId, official, rounds });
}));

// POST /negotiation — 新增一輪(body: projectId, customerTargetUsd?, ourOfferUsd?, note?, outcome?)
router.post('/negotiation', asyncHandler(async (req, res) => {
  const projectId = Number(req.body.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  if (req.body.customerTargetUsd == null && req.body.ourOfferUsd == null) return res.status(400).json({ error: '至少填 客戶目標價 或 我方回應價' });
  const db = getDb();
  const official = await db.prepare(
    `SELECT id FROM bom_quote_version WHERE project_id=? AND status='APPROVED' ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`,
  ).get(projectId).catch(() => null);
  const mx = await db.prepare(`SELECT NVL(MAX(round_no),0) AS m FROM bom_negotiation_round WHERE project_id=?`).get(projectId);
  const roundNo = Number(Object.values(mx)[0]) + 1;
  await db.prepare(
    `INSERT INTO bom_negotiation_round (project_id, quote_version_id, round_no, customer_target_usd, our_offer_usd, outcome, note, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(projectId, official ? Number(official.id) : null, roundNo,
    req.body.customerTargetUsd != null && req.body.customerTargetUsd !== '' ? Number(req.body.customerTargetUsd) : null,
    req.body.ourOfferUsd != null && req.body.ourOfferUsd !== '' ? Number(req.body.ourOfferUsd) : null,
    ['OPEN', 'COUNTER', 'ACCEPTED', 'REJECTED'].includes(req.body.outcome) ? req.body.outcome : 'OPEN',
    req.body.note ? String(req.body.note).slice(0, 1000) : null, req.user?.id || null);
  res.json({ ok: true, roundNo });
}));

// PUT /negotiation/:id — 改結果/備註(body: outcome?, note?, ourOfferUsd?, customerTargetUsd?)
router.put('/negotiation/:id', asyncHandler(async (req, res) => {
  const id = reqId(req.params.id, res); if (id === null) return;
  const sets = [], binds = [];
  if (['OPEN', 'COUNTER', 'ACCEPTED', 'REJECTED'].includes(req.body.outcome)) { sets.push('outcome=?'); binds.push(req.body.outcome); }
  if ('note' in req.body) { sets.push('note=?'); binds.push(req.body.note ? String(req.body.note).slice(0, 1000) : null); }
  if ('ourOfferUsd' in req.body) { sets.push('our_offer_usd=?'); binds.push(req.body.ourOfferUsd === '' || req.body.ourOfferUsd == null ? null : Number(req.body.ourOfferUsd)); }
  if ('customerTargetUsd' in req.body) { sets.push('customer_target_usd=?'); binds.push(req.body.customerTargetUsd === '' || req.body.customerTargetUsd == null ? null : Number(req.body.customerTargetUsd)); }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  binds.push(id);
  await getDb().prepare(`UPDATE bom_negotiation_round SET ${sets.join(', ')} WHERE id=?`).run(...binds);
  res.json({ ok: true });
}));

// DELETE /negotiation/:id
router.delete('/negotiation/:id', asyncHandler(async (req, res) => {
  const id = reqId(req.params.id, res); if (id === null) return;
  await getDb().prepare(`DELETE FROM bom_negotiation_round WHERE id=?`).run(id);
  res.json({ ok: true, deleted: id });
}));

// GET /quote/:versionId/pdf — 報價單 PDF(P1 · 全 quote 側 · 非 APPROVED 蓋 DRAFT 浮水印)
router.get('/quote/:versionId/pdf', asyncHandler(async (req, res) => {
  const versionId = Number(req.params.versionId);
  if (!versionId) return res.status(400).json({ error: 'versionId required' });
  const lang = String(req.query.lang || 'zh').toLowerCase() === 'en' ? 'en' : 'zh';   // ?lang=en 英文版
  const { doc, filename } = await require('../services/bomQuotePdfService').renderQuotePdf(getDb(), versionId, lang);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  doc.pipe(res);
  doc.end();
}));

// POST /quote/supersede — 作廢版本(admin 解鎖)(body: versionId)
router.post('/quote/supersede', asyncHandler(async (req, res) => {
  const versionId = Number(req.body.versionId);
  if (!versionId) return res.status(400).json({ error: 'versionId required' });
  res.json({ ok: true, ...(await quoteSvc.supersedeQuote(getDb(), versionId)) });
}));

// POST /import — 上傳 BOM Excel → 正規化
router.post('/import', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required (multipart field: file)' });
  const projectId = Number(req.body.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  const variantKey = req.body.variantKey || null;
  const versionNo = Number(req.body.versionNo) || 1;
  // 統一格式:profileCode(CANONICAL/WHOOP-GEN4/…)→ importCanonicalBom;無則回退 legacy format(過渡)
  const profileCode = req.body.profileCode || null;
  const format = String(req.body.format || 'template');
  try {
    let r;
    if (profileCode) {
      const mergeMode = req.body.mergeMode === 'true' || req.body.mergeMode === true;   // B-3b 分開匯入
      r = await importSvc.importCanonicalBom(getDb(), { filePath: req.file.path, projectId, profileCode, variantKey, versionNo, mergeMode });
    } else if (format === 'rival3') {
      const sheetKeys = String(req.body.sheetKeys || 'EE,ME,PKG').split(',').map((s) => s.trim()).filter(Boolean);
      r = await importSvc.importBom(getDb(), { filePath: req.file.path, projectId, sheetKeys, variantKey, versionNo });
    } else if (format === 'multiboard') {
      r = await importSvc.importMultiBoardBom(getDb(), { filePath: req.file.path, projectId, variantKey, versionNo });
    } else {
      r = await importSvc.importBomTemplate(getDb(), { filePath: req.file.path, projectId, variantKey, versionNo });
    }
    const roll = await rollupSvc.rollupMaterial(getDb(), r.bomInstanceId);
    stageSvc.autoAdvanceTo(getDb(), projectId, 'BOM_PROVIDE', 'BOM 匯入').catch(() => {});   // Stage Gate 自動推進
    res.json({ ok: true, format, profileCode, ...r, rollup: roll });
  } catch (e) {
    // B-3a:未定義變異值 → 409 + 清單(前端引導去設定)
    if (e.code === 'BOM_UNDEFINED_VARIANT_VALUES') {
      return res.status(409).json({ error: e.message, code: e.code, undefinedValues: e.undefinedValues || [] });
    }
    throw e;
  } finally {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
  }
}));

// ── 匯入設定檔(統一格式 · 各專案差異 = profile 設定)──────────────────────
// GET /profiles — 列 profile(CANONICAL/WHOOP-GEN4/RIVAL3-GEN2/自訂)
router.get('/profiles', asyncHandler(async (req, res) => {
  res.json({ profiles: await profileSvc.listProfiles(getDb()) });
}));
// GET /profiles/:code — 單一(含 config_json · 給 admin 編輯)
router.get('/profiles/:code', asyncHandler(async (req, res) => {
  const p = await profileSvc.getProfile(getDb(), req.params.code);
  if (!p) return res.status(404).json({ error: 'profile not found' });
  res.json(p);
}));
// POST /profiles — 新增/更新(body: profileCode, name, description, sourceKind, config)
router.post('/profiles', asyncHandler(async (req, res) => {
  if (!req.body.profileCode) return res.status(400).json({ error: 'profileCode required' });
  res.json({ ok: true, profile: await profileSvc.saveProfile(getDb(), req.body, req.user?.id || null) });
}));
// DELETE /profiles/:code(內建不可刪)
router.delete('/profiles/:code', asyncHandler(async (req, res) => {
  try { res.json({ ok: true, ...(await profileSvc.deleteProfile(getDb(), req.params.code)) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
}));

// GET /project/:projectId/latest-instance — 撈此專案最新 bom_instance(還原 import 結果 · 重整不消失)
// 回傳 shape 對齊 /import 回應:{ bomInstanceId, itemCount, mfgCount, pricedCount, pendingCount, sections[], rollup }
router.get('/project/:projectId/latest-instance', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  const db = getDb();
  const inst = await db.prepare(
    `SELECT id FROM bom_instance WHERE project_id = ? ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`,   // 最近建立(re-import 必增 id)
  ).get(projectId).catch(() => null);
  if (!inst) return res.json({ bomInstanceId: null });
  const instId = Number(inst.id);
  const roll = await rollupSvc.rollupMaterial(db, instId).catch(() => ({}));
  const secRows = await db.prepare(
    `SELECT sec.name AS name, sec.module_category AS module_category, COUNT(i.id) AS cnt
       FROM bom_section sec
       LEFT JOIN bom_category c ON c.bom_section_id = sec.id
       LEFT JOIN bom_item i ON i.bom_category_id = c.id
      WHERE sec.bom_instance_id = ?
      GROUP BY sec.id, sec.name, sec.module_category, sec.display_order
      ORDER BY sec.display_order`,
  ).all(instId).catch(() => []);
  const sections = secRows.map((r) => ({ section: r.name, category: r.module_category, itemCount: Number(r.cnt) }));
  const mfgRow = await db.prepare(
    `SELECT COUNT(*) AS cnt FROM bom_item_mfg m
       JOIN bom_item i ON i.id = m.bom_item_id
       JOIN bom_category c ON c.id = i.bom_category_id
       JOIN bom_section sec ON sec.id = c.bom_section_id
      WHERE sec.bom_instance_id = ?`,
  ).get(instId).catch(() => ({ cnt: 0 }));
  const pricedCount = roll.pricedCount || 0, pendingCount = roll.pendingCount || 0;
  res.json({
    bomInstanceId: instId,
    itemCount: pricedCount + pendingCount,
    mfgCount: Number(mfgRow?.cnt || 0),
    pricedCount, pendingCount, sections, rollup: roll,
  });
}));

// GET /project/:projectId/variants — 此專案已存在的 variant/顏色(顏色下拉來源 · 不硬編 LOV)
router.get('/project/:projectId/variants', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  const rows = await getDb().prepare(
    `SELECT DISTINCT variant_key FROM bom_instance WHERE project_id = ? AND variant_key IS NOT NULL ORDER BY variant_key`,
  ).all(projectId).catch(() => []);
  res.json({ variants: rows.map((r) => r.variant_key).filter(Boolean) });
}));

// GET /instances/:id — instance + sections
router.get('/instances/:id', asyncHandler(async (req, res) => {
  const id = reqId(req.params.id, res); if (id === null) return;
  const inst = await getDb().prepare(`SELECT id, project_id, version_no, variant_key, state, price_strategy FROM bom_instance WHERE id=?`).get(id);
  if (!inst) return res.status(404).json({ error: 'instance not found' });
  const secs = await getDb().prepare(
    `SELECT sec.id, sec.module_category, sec.name, COUNT(i.id) AS item_count
       FROM bom_section sec
       LEFT JOIN bom_category c ON c.bom_section_id = sec.id
       LEFT JOIN bom_item i ON i.bom_category_id = c.id
      WHERE sec.bom_instance_id = ?
      GROUP BY sec.id, sec.module_category, sec.name ORDER BY sec.id`,
  ).all(id).catch(() => []);
  res.json({ instance: inst, sections: secs });
}));

// GET /instances/:id/rollup — material rollup byCategory(?valueIds=1,2 → config resolve · B-2)
router.get('/instances/:id/rollup', asyncHandler(async (req, res) => {
  const id = reqId(req.params.id, res); if (id === null) return;
  const valueIds = String(req.query.valueIds || '').split(',').map(Number).filter(Boolean);
  res.json(await rollupSvc.rollupMaterial(getDb(), id, { valueIds }));
}));

// GET /project/:projectId/dimensions — 變異維度 + 值(config 選擇器 + 設定畫面來源 · B-2/B-3a)
router.get('/project/:projectId/dimensions', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  res.json({ dimensions: await variantSvc.listDimensions(getDb(), projectId) });
}));

// ── 變異軸設定 CRUD(B-3a:先定義,非臨時 LOV)──────────────────────────────
// POST /project/:projectId/dimensions — 新增維度(body: dimCode, dimName)
router.post('/project/:projectId/dimensions', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try { res.json({ ok: true, dimensionId: await variantSvc.createDimension(getDb(), projectId, req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
}));
// POST /project/:projectId/dimensions/:dimId/values — 新增值(body: valueCode, valueName)
router.post('/project/:projectId/dimensions/:dimId/values', asyncHandler(async (req, res) => {
  const dimId = Number(req.params.dimId);
  if (!dimId) return res.status(400).json({ error: 'dimId required' });
  try { res.json({ ok: true, valueId: await variantSvc.addValue(getDb(), dimId, req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
}));
// DELETE /project/:projectId/dimensions/:dimId — 刪維度(被料件用到 → 擋)
router.delete('/project/:projectId/dimensions/:dimId', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId), dimId = Number(req.params.dimId);
  try { res.json({ ok: true, ...(await variantSvc.deleteDimension(getDb(), projectId, dimId)) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
}));
// DELETE /project/:projectId/values/:valueId — 刪值(被料件用到 → 擋)
router.delete('/project/:projectId/values/:valueId', asyncHandler(async (req, res) => {
  const valueId = Number(req.params.valueId);
  try { res.json({ ok: true, ...(await variantSvc.deleteValue(getDb(), valueId)) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
}));

// GET /instances/:id/items — item 明細(chosen snapshot 取價 + 狀態 + vendor 數 · B-5b)
//   ?valueIds=1,2 → 按產品配置 resolve(共用 + tag 全命中的料;明細跟配置連動)
router.get('/instances/:id/items', asyncHandler(async (req, res) => {
  const id = reqId(req.params.id, res); if (id === null) return;
  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  const valueIds = String(req.query.valueIds || '').split(',').map(Number).filter(Boolean);
  const ef = variantSvc.effectivityFilter(valueIds, 'i');
  const rows = await getDb().prepare(
    `SELECT sec.module_category, sec.name AS sub_assembly, sec.part_number AS sub_assy_pn, c.name AS category, i.id, i.item_sequence,
            i.customer_item AS item_no, i.qty, NVL(ff.flk_part_number, i.fpn) AS fpn, i.description, i.reference AS remark,
            ch.applied_price_usd AS applied_price,
            (i.qty * ch.applied_price_usd) AS extended,
            CASE WHEN ch.applied_price_usd IS NULL THEN 'pending' ELSE 'priced' END AS status,
            (SELECT COUNT(*) FROM bom_item_mfg m WHERE m.bom_item_id = i.id) AS vendor_count,
            (SELECT COUNT(*) FROM bom_item_flk fl WHERE fl.bom_item_id = i.id) AS flk_count
       FROM bom_item i
       LEFT JOIN bom_item_flk ff ON ff.id = i.final_flk_id
       JOIN bom_category c ON c.id = i.bom_category_id
       JOIN bom_section sec ON sec.id = c.bom_section_id
       LEFT JOIN (
         SELECT bom_item_id, MAX(applied_price_usd) AS applied_price_usd
           FROM bom_item_price_snapshot WHERE is_chosen = 1 GROUP BY bom_item_id
       ) ch ON ch.bom_item_id = i.id
      WHERE sec.bom_instance_id = ?${ef.clause}
      ORDER BY sec.display_order, c.display_order,
               REGEXP_SUBSTR(i.customer_item, '^\\D*'),                    -- Item No 自然排序:前綴文字(空=純數字排最前)
               TO_NUMBER(REGEXP_SUBSTR(i.customer_item, '\\d+')),          -- 內嵌數字數值排(P9 < P10 · 1 < 10)
               i.customer_item, i.item_sequence
      FETCH FIRST ${limit} ROWS ONLY`,
  ).all(id, ...ef.binds).catch(() => []);
  // B-1:附 effectivity tags(明細徽章 · 共用 vs 顏色/包裝)
  const effMap = await variantSvc.effectivityByInstance(getDb(), id).catch(() => ({}));
  const items = rows.map((r) => ({ ...r, effectivity: effMap[Number(r.id)] || [] }));
  res.json({ count: items.length, items });
}));

// GET /instances/:id/sourcing — 採購策略總覽(v0.16 #4):每料 chosen vendor + price 一覽
router.get('/instances/:id/sourcing', asyncHandler(async (req, res) => {
  const id = reqId(req.params.id, res); if (id === null) return;
  const rows = await getDb().prepare(
    `SELECT sec.module_category, c.name AS category, i.customer_item AS item_no,
            NVL(ff.flk_part_number, i.fpn) AS fpn, i.description, i.qty,
            ch.applied_price_usd AS price, (i.qty * ch.applied_price_usd) AS extended,
            m.manufacturer_name AS vendor, m.mfg_part_number AS mfg_pn,
            (SELECT COUNT(*) FROM bom_item_mfg mm WHERE mm.bom_item_id = i.id) AS vendor_count
       FROM bom_item i
       LEFT JOIN bom_item_flk ff ON ff.id = i.final_flk_id
       JOIN bom_category c ON c.id = i.bom_category_id
       JOIN bom_section sec ON sec.id = c.bom_section_id
       LEFT JOIN (
         SELECT s.bom_item_id, s.applied_price_usd, s.bom_item_mfg_id,
                ROW_NUMBER() OVER (PARTITION BY s.bom_item_id ORDER BY s.applied_price_usd, s.id) AS rn
           FROM bom_item_price_snapshot s WHERE s.is_chosen = 1
       ) ch ON ch.bom_item_id = i.id AND ch.rn = 1
       LEFT JOIN bom_item_mfg m ON m.id = ch.bom_item_mfg_id
      WHERE sec.bom_instance_id = ?
      ORDER BY sec.display_order, c.display_order,
               REGEXP_SUBSTR(i.customer_item, '^\\D*'),
               TO_NUMBER(REGEXP_SUBSTR(i.customer_item, '\\d+')),
               i.customer_item, i.item_sequence`,
  ).all(id).catch(() => []);
  const singleSource = rows.filter((r) => Number(r.vendor_count) === 1).length;
  res.json({ count: rows.length, singleSource, items: rows });
}));

// GET /instances/:id/packaging?valueIds= — 包裝 BOM 視圖(v0.16 #5):PKG 料 true/quote/markup
router.get('/instances/:id/packaging', asyncHandler(async (req, res) => {
  const id = reqId(req.params.id, res); if (id === null) return;
  const valueIds = String(req.query.valueIds || '').split(',').map(Number).filter(Boolean);
  const ef = variantSvc.effectivityFilter(valueIds, 'i');
  const rows = await getDb().prepare(
    `SELECT c.name AS category, i.customer_item AS item_no, i.description, i.qty,
            NVL(ff.flk_part_number, i.fpn) AS fpn,
            ch.applied_price_usd AS quote_price,
            t.true_cost_usd, t.markup_pct,
            m.manufacturer_name AS vendor,
            (i.qty * ch.applied_price_usd) AS ext_quote,
            (i.qty * t.true_cost_usd) AS ext_true
       FROM bom_item i
       LEFT JOIN bom_item_flk ff ON ff.id = i.final_flk_id
       JOIN bom_category c ON c.id = i.bom_category_id
       JOIN bom_section sec ON sec.id = c.bom_section_id
       LEFT JOIN (
         SELECT s.id AS snap_id, s.bom_item_id, s.applied_price_usd, s.bom_item_mfg_id,
                ROW_NUMBER() OVER (PARTITION BY s.bom_item_id ORDER BY s.applied_price_usd, s.id) AS rn
           FROM bom_item_price_snapshot s WHERE s.is_chosen = 1
       ) ch ON ch.bom_item_id = i.id AND ch.rn = 1
       LEFT JOIN (
         SELECT snapshot_id, MAX(true_cost_usd) AS true_cost_usd, MAX(markup_pct) AS markup_pct
           FROM bom_item_price_tier WHERE is_chosen = 1 GROUP BY snapshot_id
       ) t ON t.snapshot_id = ch.snap_id
       LEFT JOIN bom_item_mfg m ON m.id = ch.bom_item_mfg_id
      WHERE sec.bom_instance_id = ? AND sec.module_category = 'PKG'${ef.clause}
      ORDER BY c.display_order,
               REGEXP_SUBSTR(i.customer_item, '^\\D*'),
               TO_NUMBER(REGEXP_SUBSTR(i.customer_item, '\\d+')),
               i.customer_item, i.item_sequence`,
  ).all(id, ...ef.binds).catch(() => []);
  const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const totalQuote = sum('ext_quote'), totalTrue = sum('ext_true');
  res.json({
    count: rows.length, items: rows,
    totalQuote, totalTrue: totalTrue || null,
    markupAvg: totalQuote > 0 && totalTrue > 0 ? (totalQuote - totalTrue) / totalQuote : null,
  });
}));

// PUT /items/batch — 批次存回主列欄位(Item No/描述/料號/Qty/Remark)· 前端「存檔」按鈕
// body: { items:[{ id, itemNo?, description?, fpn?, qty?, remark? }] } · 只更新有帶的欄位
router.put('/items/batch', asyncHandler(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'items required' });
  const db = getDb();
  let updated = 0;
  for (const it of items) {
    const id = Number(it.id); if (!id) continue;
    const sets = [], binds = [];
    if ('itemNo' in it) { sets.push('customer_item = ?'); binds.push(it.itemNo == null || it.itemNo === '' ? null : String(it.itemNo)); }
    if ('description' in it) { sets.push('description = ?'); binds.push(it.description == null ? null : String(it.description)); }
    if ('fpn' in it) { sets.push('fpn = ?'); binds.push(it.fpn == null || it.fpn === '' ? null : String(it.fpn)); }
    if ('qty' in it) { const q = Number(it.qty); if (Number.isFinite(q)) { sets.push('qty = ?'); binds.push(q); } }
    if ('remark' in it) { sets.push('reference = ?'); binds.push(it.remark == null || it.remark === '' ? null : String(it.remark)); }
    if (!sets.length) continue;
    binds.push(id);
    await db.prepare(`UPDATE bom_item SET ${sets.join(', ')} WHERE id = ?`).run(...binds).catch(() => {});
    updated += 1;
  }
  res.json({ ok: true, updated });
}));

// ── B-5b 採購 enrich(per-vendor 報價)──────────────────────────────────────
// GET /items/:itemId/detail — 料件明細(vendors + 每 vendor snapshot 含 tiers + 狀態)
router.get('/items/:itemId/detail', asyncHandler(async (req, res) => {
  const id = reqId(req.params.itemId, res, 'itemId'); if (id === null) return;
  const d = await enrichSvc.getItemDetail(getDb(), id);
  if (!d) return res.status(404).json({ error: 'item not found' });
  res.json(d);
}));

// POST /items/:itemId/vendor — 加替代供應商(body: vendor, mfgPn, flkId? 掛哪顆 FLK,預設採用料號)
router.post('/items/:itemId/vendor', asyncHandler(async (req, res) => {
  const id = reqId(req.params.itemId, res, 'itemId'); if (id === null) return;
  const out = await enrichSvc.addVendor(getDb(), id, { vendor: req.body.vendor, mfgPn: req.body.mfgPn, flkId: req.body.flkId || null });
  res.json({ ok: true, ...out });
}));

// POST /items/:itemId/flk — 加 FLK 候選料號(body: fpn, desc)(R-3)
router.post('/items/:itemId/flk', asyncHandler(async (req, res) => {
  const id = reqId(req.params.itemId, res, 'itemId'); if (id === null) return;
  const out = await enrichSvc.addFlk(getDb(), id, { fpn: req.body.fpn, desc: req.body.desc });
  res.json({ ok: true, ...out });
}));

// PUT /items/:itemId/choose-flk — 選採用料號(body: flkId)· chosen 自動跳該 FLK 首價(R-3)
router.put('/items/:itemId/choose-flk', asyncHandler(async (req, res) => {
  const id = reqId(req.params.itemId, res, 'itemId'); if (id === null) return;
  const flkId = Number(req.body.flkId);
  if (!flkId) return res.status(400).json({ error: 'flkId required' });
  const out = await enrichSvc.chooseFlk(getDb(), id, flkId);
  res.json({ ok: true, ...out });
}));

// POST /items/:itemId/price — 加報價(body: mfgId?, flkId?, sourceCurrency?, tiers[{…}])· flkId 指定掛哪顆 FLK
router.post('/items/:itemId/price', asyncHandler(async (req, res) => {
  const id = reqId(req.params.itemId, res, 'itemId'); if (id === null) return;
  if (!Array.isArray(req.body.tiers) || !req.body.tiers.length) return res.status(400).json({ error: 'tiers required (>=1)' });
  const out = await enrichSvc.addPrice(getDb(), id, { mfgId: req.body.mfgId || null, flkId: req.body.flkId || null, sourceCurrency: req.body.sourceCurrency || 'USD', tiers: req.body.tiers });
  // Stage Gate:此 instance 詢價全完成 → PARALLEL_COLLECT
  stageSvc.pendingCountByItem(getDb(), id).then((r) => { if (r && r.pending === 0) return stageSvc.autoAdvanceTo(getDb(), r.projectId, 'PARALLEL_COLLECT', '詢價完成'); }).catch(() => {});
  res.json({ ok: true, ...out });
}));

// PUT /items/:itemId/price/:snapshotId — 改既有報價(body: vendor?, mfgPn?, sourceCurrency?, trueCostSource?, fxRate?, quotePrice?)
router.put('/items/:itemId/price/:snapshotId', asyncHandler(async (req, res) => {
  const id = reqId(req.params.itemId, res, 'itemId'); if (id === null) return;
  const snapshotId = Number(req.params.snapshotId);
  if (!snapshotId) return res.status(400).json({ error: 'snapshotId required' });
  const out = await enrichSvc.updatePrice(getDb(), id, snapshotId, req.body || {});
  res.json({ ok: true, ...out });
}));

// DELETE /items/:itemId/price/:snapshotId — 刪一筆報價
router.delete('/items/:itemId/price/:snapshotId', asyncHandler(async (req, res) => {
  const id = reqId(req.params.itemId, res, 'itemId'); if (id === null) return;
  const snapshotId = Number(req.params.snapshotId);
  if (!snapshotId) return res.status(400).json({ error: 'snapshotId required' });
  const out = await enrichSvc.deletePrice(getDb(), id, snapshotId);
  res.json({ ok: true, ...out });
}));

// PUT /items/:itemId/choose — 選定某 vendor snapshot 為此料件的價(body: snapshotId)
router.put('/items/:itemId/choose', asyncHandler(async (req, res) => {
  const id = reqId(req.params.itemId, res, 'itemId'); if (id === null) return;
  const snapshotId = Number(req.body.snapshotId);
  if (!snapshotId) return res.status(400).json({ error: 'snapshotId required' });
  const out = await enrichSvc.chooseSnapshot(getDb(), id, snapshotId);
  res.json({ ok: true, ...out });
}));

// POST /compute — computeCase(persist)· B-5a:有未詢價料件回 409(帶 force=true 才放行)
router.post('/compute', asyncHandler(async (req, res) => {
  const caseFactoryId = Number(req.body.caseFactoryId);
  if (!caseFactoryId) return res.status(400).json({ error: 'caseFactoryId required' });
  const opts = { caseFactoryId, persist: true, computedBy: req.user?.id || null };
  if (req.body.bomInstanceId) opts.bomInstanceId = Number(req.body.bomInstanceId);
  if (req.body.qtyScenarioCode) opts.qtyScenarioCode = req.body.qtyScenarioCode;
  if (Array.isArray(req.body.valueIds) && req.body.valueIds.length) opts.valueIds = req.body.valueIds.map(Number).filter(Boolean);  // B-2 config resolve
  if (req.body.force === true || req.body.force === 'true' || req.body.allowPending) opts.allowPending = true;
  try {
    const out = await engine.computeCase(getDb(), opts);
    // Stage Gate:首次/每次試算 → BOM_COST_REVIEW(冪等)
    getDb().prepare(`SELECT case_id FROM bom_cs_case_factory WHERE case_factory_id=?`).get(caseFactoryId)
      .then((r) => { const pid = r && Number(Object.values(r)[0]); if (pid) return stageSvc.autoAdvanceTo(getDb(), pid, 'BOM_COST_REVIEW', '成本試算'); }).catch(() => {});
    res.json({ ok: true, runId: out.runId, costingModel: out.costingModel, costBreakdown: out.costBreakdown });
  } catch (e) {
    if (e.code === 'BOM_HAS_PENDING_PRICES') {
      return res.status(409).json({ error: e.message, code: e.code, pendingCount: e.pendingCount });
    }
    throw e;
  }
}));

// GET /runs?caseFactoryId= — 列 run
router.get('/runs', asyncHandler(async (req, res) => {
  const cf = Number(req.query.caseFactoryId);
  if (!cf) return res.status(400).json({ error: 'caseFactoryId query required' });
  const rows = await getDb().prepare(
    `SELECT run_id, status, compute_engine, computed_at FROM bom_cs_run WHERE case_factory_id=? ORDER BY run_id DESC`,
  ).all(cf).catch(() => []);
  res.json({ runs: rows });
}));

// GET /runs/:runId — run header + result + cells
router.get('/runs/:runId', asyncHandler(async (req, res) => {
  const id = reqId(req.params.runId, res, 'runId'); if (id === null) return;
  const run = await getDb().prepare(`SELECT run_id, case_factory_id, status, compute_engine, computed_by, computed_at FROM bom_cs_run WHERE run_id=?`).get(id);
  if (!run) return res.status(404).json({ error: 'run not found' });
  const result = await getDb().prepare(`SELECT * FROM bom_cs_run_result WHERE run_id=?`).get(id);
  const cells = await getDb().prepare(
    `SELECT process_code, component_code, cost_per_unit_usd FROM bom_cs_run_cell WHERE run_id=? ORDER BY process_code, component_code`,
  ).all(id).catch(() => []);
  res.json({ run, result, cells });
}));

// GET /case/:caseFactoryId/latest-run?valueIds=1,2 — 某(廠別, config)最近一次 compute 結果
//   試算廠別 ↔ 成本結果 + 產品配置 ↔ 成本結果 雙耦合(切廠別/切配置都會換 ⑤)
router.get('/case/:caseFactoryId/latest-run', asyncHandler(async (req, res) => {
  const cf = Number(req.params.caseFactoryId);
  if (!cf) return res.status(400).json({ error: 'caseFactoryId required' });
  const sig = String(req.query.valueIds || '').split(',').map(Number).filter(Boolean).sort((a, b) => a - b).join(',');
  const qty = String(req.query.qty || 'BASE');   // v0.16 #8:qty scenario 軸(預設 BASE · 既有 run NULL=BASE)
  const row = await getDb().prepare(
    `SELECT run_id FROM bom_cs_run WHERE case_factory_id = ? AND NVL(variant_value_ids,'_NONE_') = ? AND NVL(qty_scenario_code,'BASE') = ? ORDER BY run_id DESC FETCH FIRST 1 ROWS ONLY`,   // Oracle ''=NULL → sentinel
  ).get(cf, sig || '_NONE_', qty).catch(() => null);
  if (!row) return res.json({ runId: null });
  const out = await engine.loadPersistedRun(getDb(), Number(row.run_id));
  if (!out) return res.json({ runId: null });
  res.json({ ...out, caseFactoryId: cf });
}));

// GET /project/:projectId/latest-run — 此專案最近一次 compute 結果(還原 ⑤ 成本結果 · 重整不消失)
router.get('/project/:projectId/latest-run', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  const row = await getDb().prepare(
    `SELECT run.run_id, run.case_factory_id
       FROM bom_cs_run run
       JOIN bom_cs_case_factory cf ON cf.case_factory_id = run.case_factory_id
      WHERE cf.case_id = ?
      ORDER BY run.run_id DESC FETCH FIRST 1 ROWS ONLY`,
  ).get(projectId).catch(() => null);
  if (!row) return res.json({ runId: null });
  const out = await engine.loadPersistedRun(getDb(), Number(row.run_id));
  if (!out) return res.json({ runId: null });
  res.json({ ...out, caseFactoryId: Number(row.case_factory_id) });
}));

module.exports = router;
