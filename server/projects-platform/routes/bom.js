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
const rollupSvc = require('../services/bomMaterialRollup');
const templateSvc = require('../services/bomTemplateService');
const engine = require('../services/bomCostEngine');

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

// POST /import — 上傳 BOM Excel → 正規化
router.post('/import', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required (multipart field: file)' });
  const projectId = Number(req.body.projectId);
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  const variantKey = req.body.variantKey || null;
  const versionNo = Number(req.body.versionNo) || 1;
  // format:'template'(預設 · 使用者填標準範本)| 'rival3'(dev fixture · 硬解 Rival3 Gen2 原始 BOM)
  const format = String(req.body.format || 'template');
  try {
    let r;
    if (format === 'rival3') {
      const sheetKeys = String(req.body.sheetKeys || 'EE,ME,PKG').split(',').map((s) => s.trim()).filter(Boolean);
      r = await importSvc.importBom(getDb(), { filePath: req.file.path, projectId, sheetKeys, variantKey, versionNo });
    } else {
      r = await importSvc.importBomTemplate(getDb(), { filePath: req.file.path, projectId, variantKey, versionNo });
    }
    const roll = await rollupSvc.rollupMaterial(getDb(), r.bomInstanceId);
    res.json({ ok: true, format, ...r, rollup: roll });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
  }
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

// GET /instances/:id/rollup — material rollup byCategory
router.get('/instances/:id/rollup', asyncHandler(async (req, res) => {
  const id = reqId(req.params.id, res); if (id === null) return;
  res.json(await rollupSvc.rollupMaterial(getDb(), id));
}));

// GET /instances/:id/items — item 明細(limit)
router.get('/instances/:id/items', asyncHandler(async (req, res) => {
  const id = reqId(req.params.id, res); if (id === null) return;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const rows = await getDb().prepare(
    `SELECT sec.module_category, c.name AS category, i.id, i.item_sequence, i.qty, i.fpn, i.description,
            s.applied_price_usd, (i.qty * s.applied_price_usd) AS extended
       FROM bom_item i
       JOIN bom_category c ON c.id = i.bom_category_id
       JOIN bom_section sec ON sec.id = c.bom_section_id
       LEFT JOIN bom_item_price_snapshot s ON s.bom_item_id = i.id
      WHERE sec.bom_instance_id = ?
      ORDER BY sec.id, i.item_sequence FETCH FIRST ${limit} ROWS ONLY`,
  ).all(id).catch(() => []);
  res.json({ count: rows.length, items: rows });
}));

// POST /compute — computeCase(persist)
router.post('/compute', asyncHandler(async (req, res) => {
  const caseFactoryId = Number(req.body.caseFactoryId);
  if (!caseFactoryId) return res.status(400).json({ error: 'caseFactoryId required' });
  const opts = { caseFactoryId, persist: true, computedBy: req.user?.id || null };
  if (req.body.bomInstanceId) opts.bomInstanceId = Number(req.body.bomInstanceId);
  if (req.body.qtyScenarioCode) opts.qtyScenarioCode = req.body.qtyScenarioCode;
  const out = await engine.computeCase(getDb(), opts);
  res.json({ ok: true, runId: out.runId, costingModel: out.costingModel, costBreakdown: out.costBreakdown });
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

module.exports = router;
