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

const router = express.Router();
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
  // C-2:確保範本庫存在 + fixture seed(冪等 · 首次呼叫建庫)
  try { await require('../services/bomCostModelService').ensureTemplateLibrary(getDb()); } catch (e) { /* 庫建失敗仍回列表 */ }
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
// GET /cost-model/template?model=SIMPLIFIED_WEARABLE|FULL_MVA — 下載範本(fixture 真實樣例)
router.get('/cost-model/template', asyncHandler(async (req, res) => {
  const model = String(req.query.model || 'SIMPLIFIED_WEARABLE');
  const { wb } = await costModelSvc.templateWorkbook(getDb(), model);
  sendWb(res, wb, `cost-model-template-${model}.xlsx`);
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
    const out = await costModelSvc.importToTemplateLibrary(getDb(), { filePath: req.file.path, factoryCode: req.body.factoryCode || null });
    res.json({ ok: true, ...out });
  } catch (e) {
    if (String(e.code || '').startsWith('COST_MODEL_')) return res.status(409).json({ error: e.message, code: e.code, missing: e.missing || undefined });
    throw e;
  } finally { try { fs.unlinkSync(req.file.path); } catch (_) {} }
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
  res.json(await compareSvc.compareFactories(getDb(), opts));
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
    res.json({ ok: true, ...(await quoteSvc.submitQuote(getDb(), { projectId, caseFactoryId, note: req.body.note || null, userId: req.user?.id || null })) });
  } catch (e) { res.status(400).json({ error: e.message }); }
}));

// POST /quote/approve — 核准(= 官方 · 鎖 case)(body: versionId)· 擋自我核准(SoD)
router.post('/quote/approve', asyncHandler(async (req, res) => {
  const versionId = Number(req.body.versionId);
  if (!versionId) return res.status(400).json({ error: 'versionId required' });
  try {
    res.json({ ok: true, ...(await quoteSvc.approveQuote(getDb(), { versionId, userId: req.user?.id || null, isAdmin: req.user?.role === 'admin' })) });
  } catch (e) {
    if (e.code === 'SELF_APPROVAL_BLOCKED') return res.status(403).json({ error: e.message, code: e.code });
    throw e;
  }
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
  const row = await getDb().prepare(
    `SELECT run_id FROM bom_cs_run WHERE case_factory_id = ? AND NVL(variant_value_ids,'_NONE_') = ? ORDER BY run_id DESC FETCH FIRST 1 ROWS ONLY`,   // Oracle ''=NULL → sentinel
  ).get(cf, sig || '_NONE_').catch(() => null);
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
