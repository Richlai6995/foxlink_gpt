/**
 * /api/projects/wizard — AI-assisted 開案 Wizard helpers
 *
 * Endpoints:
 *   POST /extract-rfq      multipart file → Gemini Vision 抽欄位
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { asyncHandler } = require('../middleware/errorBoundary');
const rfqExtractor = require('../services/rfqExtractor');

const router = express.Router();

// 上傳暫存:UPLOAD_ROOT/projects/rfq/{userId}/{uuid}.{ext}
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || process.env.UPLOAD_DIR || './uploads';
const RFQ_DIR = path.join(UPLOAD_ROOT, 'projects', 'rfq');
try { fs.mkdirSync(RFQ_DIR, { recursive: true }); } catch (_) {}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = path.join(RFQ_DIR, String(req.user?.id || 'unknown'));
    try { fs.mkdirSync(userDir, { recursive: true }); } catch (_) {}
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const stamp = Date.now();
    const rnd = Math.random().toString(36).slice(2, 8);
    cb(null, `rfq_${stamp}_${rnd}${ext}`);
  },
});

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'message/rfc822',  // .eml
]);

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) return cb(null, true);
    cb(new Error(`unsupported file type: ${file.mimetype}`));
  },
});

/**
 * POST /api/projects/wizard/extract-rfq
 *  multipart field: file (PDF/img/eml)
 *  回 {
 *    file_path, original_name, mime_type, size,
 *    extracted: { customer, part_no, quantity, due_date, specs, notes, confidence, missing, warnings }
 *  }
 */
router.post('/extract-rfq',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    try {
      const extracted = await rfqExtractor.extract(req.file.path, req.file.mimetype);
      res.json({
        file_path:     req.file.path,
        original_name: req.file.originalname,
        mime_type:     req.file.mimetype,
        size:          req.file.size,
        extracted,
      });
    } catch (e) {
      console.error('[wizard] extract-rfq error:', e);
      // 清掉 upload 殘檔
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      res.status(500).json({ error: e.message, code: 'EXTRACT_FAILED' });
    }
  }),
);

// ── Step1 客戶信息(2026-08 改版)────────────────────────────────────────────
const INTAKE_FIELDS = [
  { key: 'customer', label: '客戶名稱', req: true, note: '對客抬頭(如 SteelSeries ApS)', sample: 'SteelSeries ApS' },
  { key: 'custAlias', label: '客戶代碼', req: false, note: '本公司內部客戶代碼 / 機密案別名(如 A001)', sample: 'A001-SS' },
  { key: 'projectCode', label: '專案代碼', req: false, note: '空 = 系統自動編(Q-YYYY-####);填了會檢查唯一', sample: '' },
  { key: 'partNo', label: '料號', req: true, note: '客戶料號 / 產品型號', sample: 'SS-RIVAL3P-WIRED' },
  { key: 'quantity', label: '數量(年量 pcs)', req: true, note: '數字', sample: '418000' },
  { key: 'dueDate', label: '交期', req: false, note: 'YYYY-MM-DD', sample: '2026-09-15' },
  { key: 'kickoffNote', label: '開案說明', req: false, note: '開案緣由 / 特殊需求 / 背景', sample: '客戶新一代電競滑鼠,Q4 上市,三廠比價' },
  { key: 'taxId', label: '統編 / Tax ID', req: false, note: '', sample: '04541302' },
  { key: 'paymentTerms', label: '付款條件', req: false, note: '月結 30/45/60 天 · T/T · L/C', sample: '月結 45 天' },
  { key: 'shipAddress', label: '收貨地址', req: false, note: '', sample: '' },
  { key: 'contactName', label: '採購窗口', req: false, note: '姓名(職稱)', sample: 'David Chang (procurement)' },
];

// GET /intake-template — 開案客戶資料範本 xlsx(直式 key-value,確定性解析)
router.get('/intake-template', asyncHandler(async (req, res) => {
  const XLSX = require('xlsx');
  const rows = [['欄位', '值(請填 B 欄)', '說明', '範例']];
  for (const f of INTAKE_FIELDS) rows.push([`${f.label}${f.req ? '*' : ''}`, '', f.note, f.sample]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 18 }, { wch: 34 }, { wch: 44 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '客戶信息');
  const guide = XLSX.utils.aoa_to_sheet([
    ['開案資料範本 · 填寫說明'],
    ['1. 只填「客戶信息」分頁的 B 欄;帶 * 為必填。'],
    ['2. 填完存檔 → 開案 Wizard Step 1「上傳範本」→ 全欄自動帶入(非 AI,確定性解析)。'],
    ['3. 客戶 RFQ(PDF/email)也可直接上傳,由 AI 盡力解析後人工確認;範本路徑最可靠。'],
  ]);
  guide['!cols'] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, guide, '說明');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent('開案資料範本.xlsx')}"`);
  res.send(buf);
}));

// POST /parse-intake — 上傳填好的範本 → 確定性解析(A 欄比對 label,取 B 欄)
const xlsxUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (/\.xlsx?$/i.test(file.originalname) ? cb(null, true) : cb(new Error('unsupported file type: need .xlsx'))),
});
router.post('/parse-intake', xlsxUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  try {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets['客戶信息'] || wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const out = {};
    for (const r of rows) {
      const label = String(r[0] || '').replace(/\*$/, '').trim();
      const f = INTAKE_FIELDS.find((x) => x.label === label);
      if (f && r[1] != null && String(r[1]).trim() !== '') out[f.key] = String(r[1]).trim();
    }
    try { fs.unlinkSync(req.file.path); } catch (_) { /* noop */ }
    res.json({ ok: true, fields: out, filled: Object.keys(out).length });
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch (_) { /* noop */ }
    res.status(400).json({ error: `範本解析失敗:${e.message}` });
  }
}));

// GET /customers — 歷史客戶主檔(distinct · 帶最近案的 form.customer 8 欄供帶入)
router.get('/customers', asyncHandler(async (req, res) => {
  const db = require('../../database-oracle').db;
  const rows = await db.prepare(
    `SELECT id, project_code, data_payload, pm_user_id FROM projects
      WHERE project_code <> 'CORTEX-COST-TPL'
      ORDER BY id DESC FETCH FIRST 300 ROWS ONLY`,
  ).all().catch(() => []);
  // 週期(真資料):開案 → SUBMIT_QUOTE stage DONE 的天數(給 Step1 交期紅綠燈)
  const cyc = await db.prepare(
    `SELECT p.id, ROUND(CAST(s.completed_at AS DATE) - CAST(p.created_at AS DATE)) AS days
       FROM projects p JOIN project_stages s ON s.project_id = p.id
      WHERE s.stage_code = 'SUBMIT_QUOTE' AND s.status = 'DONE'`,
  ).all().catch(() => []);
  const cycleByPid = new Map(cyc.map((r) => [Number(r.id || Object.values(r)[0]), Number(r.days ?? Object.values(r)[1])]));
  const seen = new Map();
  for (const r of rows) {
    let dp = {}; try { dp = JSON.parse(String(r.data_payload || Object.values(r)[2] || '{}')) || {}; } catch (_) { continue; }
    const fc = (dp.form && dp.form.customer) || {};
    const name = fc.cust_name || dp.customer;
    if (!name) continue;
    const pid = Number(r.id || Object.values(r)[0]);
    if (!seen.has(name)) {
      seen.set(name, {
        name,
        custAlias: fc.cust_alias || dp.customer_alias || null,
        taxId: fc.tax_id || null,
        paymentTerms: fc.payment_terms || null,
        shipAddress: fc.ship_address || null,
        contactName: fc.contact_name || null,
        lastProject: r.project_code || Object.values(r)[1],
        lastPmUserId: Number(r.pm_user_id ?? Object.values(r)[3]) || null,
        projectCount: 0, _cycles: [],
      });
    }
    const c = seen.get(name);
    c.projectCount += 1;
    const d = cycleByPid.get(pid);
    if (Number.isFinite(d) && d >= 0) c._cycles.push(d);
  }
  const pmIds = [...new Set([...seen.values()].map((c) => c.lastPmUserId).filter(Boolean))];
  const pmName = new Map();
  if (pmIds.length) {
    const us = await db.prepare(
      `SELECT id, username, name FROM users WHERE id IN (${pmIds.map(() => '?').join(',')})`,
    ).all(...pmIds).catch(() => []);
    for (const u of us) pmName.set(Number(u.id ?? Object.values(u)[0]), (u.name ?? Object.values(u)[2]) || (u.username ?? Object.values(u)[1]));
  }
  const customers = [...seen.values()].map((c) => ({
    ...c, _cycles: undefined,
    lastPmName: c.lastPmUserId ? (pmName.get(c.lastPmUserId) || null) : null,
    avgCycleDays: c._cycles.length ? Math.round(c._cycles.reduce((a, b) => a + b, 0) / c._cycles.length) : null,
  }));
  res.json({ customers });
}));

// GET /users?q= — Step3 PM/Team 使用者搜尋(active users + 在手 PM 案數供負載參考)
router.get('/users', asyncHandler(async (req, res) => {
  const db = require('../../database-oracle').db;
  const q = String(req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = await db.prepare(
      `SELECT id, username, name, employee_id, dept_name FROM users
        WHERE status = 'active'
          AND (UPPER(username) LIKE UPPER(?) OR UPPER(name) LIKE UPPER(?) OR employee_id LIKE ?)
        ORDER BY username FETCH FIRST 20 ROWS ONLY`,
    ).all(like, like, like).catch(() => []);
  } else {
    rows = await db.prepare(
      `SELECT id, username, name, employee_id, dept_name FROM users
        WHERE status = 'active' ORDER BY id DESC FETCH FIRST 20 ROWS ONLY`,
    ).all().catch(() => []);
  }
  const load = await db.prepare(
    `SELECT pm_user_id, COUNT(*) AS n FROM projects
      WHERE lifecycle_status IN ('DRAFT', 'ACTIVE') AND project_code <> 'CORTEX-COST-TPL'
      GROUP BY pm_user_id`,
  ).all().catch(() => []);
  const loadBy = new Map(load.map((r) => [Number(r.pm_user_id ?? Object.values(r)[0]), Number(r.n ?? Object.values(r)[1])]));
  res.json({
    users: rows.map((u) => {
      const id = Number(u.id ?? Object.values(u)[0]);
      return {
        id,
        username: u.username ?? Object.values(u)[1],
        name: (u.name ?? Object.values(u)[2]) || (u.username ?? Object.values(u)[1]),
        employeeId: u.employee_id ?? Object.values(u)[3] ?? null,
        deptName: u.dept_name ?? Object.values(u)[4] ?? null,
        activePmCount: loadBy.get(id) || 0,
      };
    }),
  });
}));

// GET /workflow-template?type=QUOTE — Step4 顯示真流程範本(啟動時 create 會用同一份建 stages)
router.get('/workflow-template', asyncHandler(async (req, res) => {
  const db = require('../../database-oracle').db;
  const typeCode = String(req.query.type || 'QUOTE');
  const t = await db.prepare(
    `SELECT wt.id, wt.code, wt.name_i18n
       FROM workflow_templates wt
       JOIN project_types pt ON pt.default_workflow_template_id = wt.id
      WHERE pt.type_code = ?`,
  ).get(typeCode).catch(() => null);
  if (!t) return res.json({ template: null, stages: [] });
  const rows = await db.prepare(
    `SELECT stage_code, stage_order, sla_hours, required_role, gate_required
       FROM workflow_template_stages WHERE template_id = ? ORDER BY stage_order`,
  ).all(Number(t.id ?? Object.values(t)[0])).catch(() => []);
  let name = null;
  try { name = JSON.parse(String(t.name_i18n ?? Object.values(t)[2] ?? '{}'))['zh-TW'] || null; } catch (_) { /* noop */ }
  res.json({
    template: { id: Number(t.id ?? Object.values(t)[0]), code: t.code ?? Object.values(t)[1], name },
    stages: rows.map((s) => ({
      code: s.stage_code ?? Object.values(s)[0],
      order: Number(s.stage_order ?? Object.values(s)[1]),
      slaHours: (s.sla_hours ?? Object.values(s)[2]) != null ? Number(s.sla_hours ?? Object.values(s)[2]) : null,
      role: s.required_role ?? Object.values(s)[3] ?? null,
      gate: Number(s.gate_required ?? Object.values(s)[4]) === 1,
    })),
  });
}));

// GET /precheck?partNo=&code= — 重複開案偵測(同料號案)+ 專案代碼唯一檢查
router.get('/precheck', asyncHandler(async (req, res) => {
  const db = require('../../database-oracle').db;
  const partNo = String(req.query.partNo || '').trim();
  const code = String(req.query.code || '').trim();
  const out = { similar: [], codeExists: false };
  if (code) {
    const r = await db.prepare(`SELECT COUNT(*) AS n FROM projects WHERE project_code = ?`).get(code).catch(() => null);
    out.codeExists = !!(r && Number(Object.values(r)[0]) > 0);
  }
  if (partNo) {
    const rows = await db.prepare(
      `SELECT id, project_code, data_payload, created_at FROM projects
        WHERE project_code <> 'CORTEX-COST-TPL' ORDER BY id DESC FETCH FIRST 300 ROWS ONLY`,
    ).all().catch(() => []);
    const q = partNo.toLowerCase();
    for (const r of rows) {
      let dp = {}; try { dp = JSON.parse(String(r.data_payload || Object.values(r)[2] || '{}')) || {}; } catch (_) { continue; }
      const pn = String(dp.partNo || '').toLowerCase();
      if (pn && (pn.includes(q) || q.includes(pn))) {
        out.similar.push({ id: Number(r.id || Object.values(r)[0]), projectCode: r.project_code || Object.values(r)[1], partNo: dp.partNo, title: dp.title || null });
        if (out.similar.length >= 5) break;
      }
    }
  }
  res.json(out);
}));

// multer error handler — 大檔 / 副檔限制
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  if (err && /unsupported file type/.test(err.message || '')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
