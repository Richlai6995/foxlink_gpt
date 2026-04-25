'use strict';

/**
 * PM BOM(產品 ⇄ 金屬含量)管理 API — Phase 4 14.1
 *
 * Mount 在 /api/pm-bom:
 *   GET    /              list(支援 ?product_code= / ?metal_code= / ?product_line= 篩選)
 *   GET    /summary       per metal_code 的產品數 / 月總用量(g)摘要
 *   POST   /              create 單筆
 *   PUT    /:id           update 單筆
 *   DELETE /:id           delete
 *   POST   /upload-csv    multipart CSV 批次匯入(admin only)
 *   GET    /export-csv    匯出為 CSV(備份用)
 *
 * 權限:
 *   - admin role 可 CRUD + 上傳
 *   - 一般 user 只能 GET(read-only,給 chat / pipeline 用)
 *
 * CSV 欄位(header 必須對齊):
 *   product_code, product_name, product_line, metal_code, content_gram, monthly_volume, content_source, valid_from, notes
 *
 * 範例 CSV:
 *   product_code,product_name,product_line,metal_code,content_gram,monthly_volume,content_source,valid_from,notes
 *   P-001,Type-C Connector,Connector,CU,12.5,100000,ERP-202604,2026-04-01,
 *   P-002,USB-A Cable,Cable,CU,8.3,50000,manual,2026-04-01,gold-plated 5um
 */

const express = require('express');
const multer = require('multer');
const router = express.Router();
const { verifyToken } = require('./auth');

router.use(verifyToken);

const db = () => require('../database-oracle').db;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });  // 10 MB

function isAdmin(user) {
  return user?.role === 'admin';
}

// ── GET / — list ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const filters = [];
    const binds = [];
    if (req.query.product_code) {
      filters.push(`UPPER(product_code) LIKE UPPER(?)`);
      binds.push(`%${req.query.product_code}%`);
    }
    if (req.query.metal_code) {
      filters.push(`UPPER(metal_code) = UPPER(?)`);
      binds.push(req.query.metal_code);
    }
    if (req.query.product_line) {
      filters.push(`UPPER(product_line) LIKE UPPER(?)`);
      binds.push(`%${req.query.product_line}%`);
    }
    // 預設只看 active(valid_to is NULL or > today)
    if (req.query.include_expired !== '1') {
      filters.push(`(valid_to IS NULL OR valid_to >= TRUNC(SYSDATE))`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const limit = Math.min(2000, Number(req.query.limit) || 500);

    const rows = await db().prepare(`
      SELECT id, product_code, product_name, product_line, metal_code,
             content_gram, content_unit, monthly_volume, content_source,
             valid_from, valid_to, notes, creation_date, last_updated_date
      FROM pm_bom_metal
      ${where}
      ORDER BY product_code, metal_code
      FETCH FIRST ${limit} ROWS ONLY
    `).all(...binds);
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /summary — per metal_code 統計 ─────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const rows = await db().prepare(`
      SELECT metal_code,
             COUNT(DISTINCT product_code) AS product_count,
             SUM(content_gram * NVL(monthly_volume, 0)) AS total_monthly_grams,
             COUNT(DISTINCT product_line) AS product_line_count
      FROM pm_bom_metal
      WHERE valid_to IS NULL OR valid_to >= TRUNC(SYSDATE)
      GROUP BY metal_code
      ORDER BY total_monthly_grams DESC
    `).all();
    res.json(rows || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST / — create ────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: '需 admin 權限' });
  try {
    const b = req.body || {};
    if (!b.product_code || !b.metal_code || b.content_gram == null) {
      return res.status(400).json({ error: 'product_code, metal_code, content_gram 必填' });
    }
    const validFrom = b.valid_from || new Date().toISOString().slice(0, 10);
    const ins = await db().prepare(`
      INSERT INTO pm_bom_metal
        (product_code, product_name, product_line, metal_code,
         content_gram, content_unit, monthly_volume, content_source,
         valid_from, valid_to, notes, creator_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, TO_DATE(?, 'YYYY-MM-DD'),
              ${b.valid_to ? "TO_DATE(?, 'YYYY-MM-DD')" : 'NULL'}, ?, ?)
    `).run(
      String(b.product_code).trim(),
      b.product_name || null,
      b.product_line || null,
      String(b.metal_code).trim().toUpperCase(),
      Number(b.content_gram),
      b.content_unit || 'g',
      b.monthly_volume != null ? Number(b.monthly_volume) : null,
      b.content_source || 'manual',
      validFrom,
      ...(b.valid_to ? [b.valid_to] : []),
      b.notes || null,
      req.user.id,
    );
    const row = await db().prepare(`SELECT * FROM pm_bom_metal WHERE id=?`).get(ins.lastInsertRowid);
    res.json(row);
  } catch (e) {
    if (/ORA-00001/.test(e.message)) {
      return res.status(409).json({ error: '同 (product_code, metal_code, valid_from) 已存在' });
    }
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /:id ────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: '需 admin 權限' });
  try {
    const b = req.body || {};
    const r = await db().prepare(`SELECT * FROM pm_bom_metal WHERE id=?`).get(Number(req.params.id));
    if (!r) return res.status(404).json({ error: 'not found' });

    await db().prepare(`
      UPDATE pm_bom_metal SET
        product_name=?, product_line=?,
        content_gram=?, content_unit=?, monthly_volume=?, content_source=?,
        valid_to=${b.valid_to ? "TO_DATE(?, 'YYYY-MM-DD')" : 'NULL'},
        notes=?, last_updated_date=SYSTIMESTAMP
      WHERE id=?
    `).run(
      b.product_name ?? r.product_name,
      b.product_line ?? r.product_line,
      b.content_gram != null ? Number(b.content_gram) : r.content_gram,
      b.content_unit ?? r.content_unit,
      b.monthly_volume != null ? Number(b.monthly_volume) : r.monthly_volume,
      b.content_source ?? r.content_source,
      ...(b.valid_to ? [b.valid_to] : []),
      b.notes ?? r.notes,
      Number(req.params.id),
    );
    const updated = await db().prepare(`SELECT * FROM pm_bom_metal WHERE id=?`).get(Number(req.params.id));
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /:id ─────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: '需 admin 權限' });
  try {
    await db().prepare(`DELETE FROM pm_bom_metal WHERE id=?`).run(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /upload-csv — 批次匯入 ────────────────────────────────────────────
// Form-data: file=<csv>, mode=insert|upsert(預設 upsert)
router.post('/upload-csv', upload.single('file'), async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: '需 admin 權限' });
  if (!req.file) return res.status(400).json({ error: '需上傳 file 欄位' });
  const mode = req.body.mode === 'insert' ? 'insert' : 'upsert';

  try {
    const csvText = req.file.buffer.toString('utf8');
    const rows = parseCsv(csvText);
    if (!rows.length) return res.status(400).json({ error: 'CSV 沒資料 / 解析失敗' });

    const required = ['product_code', 'metal_code', 'content_gram'];
    const headers = Object.keys(rows[0]);
    const missing = required.filter(h => !headers.includes(h));
    if (missing.length) return res.status(400).json({ error: `CSV 缺必填欄:${missing.join(', ')}` });

    const result = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const today = new Date().toISOString().slice(0, 10);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const productCode = String(r.product_code || '').trim();
        const metalCode = String(r.metal_code || '').trim().toUpperCase();
        const contentGram = Number(r.content_gram);
        if (!productCode || !metalCode || !isFinite(contentGram)) {
          result.skipped++;
          result.errors.push({ row: i + 2, error: 'product_code / metal_code / content_gram 缺或非法' });
          continue;
        }
        const validFrom = r.valid_from && /^\d{4}-\d{2}-\d{2}$/.test(r.valid_from) ? r.valid_from : today;

        if (mode === 'upsert') {
          // 同 (product_code, metal_code, valid_from) 已有 → UPDATE; 沒有 → INSERT
          const existing = await db().prepare(
            `SELECT id FROM pm_bom_metal WHERE product_code=? AND metal_code=? AND valid_from=TO_DATE(?, 'YYYY-MM-DD')`
          ).get(productCode, metalCode, validFrom);
          if (existing) {
            await db().prepare(`
              UPDATE pm_bom_metal SET
                product_name=?, product_line=?,
                content_gram=?, monthly_volume=?, content_source=?, notes=?,
                last_updated_date=SYSTIMESTAMP
              WHERE id=?
            `).run(
              r.product_name || null, r.product_line || null,
              contentGram,
              r.monthly_volume != null && r.monthly_volume !== '' ? Number(r.monthly_volume) : null,
              r.content_source || 'csv-upload', r.notes || null,
              existing.id || existing.ID,
            );
            result.updated++;
            continue;
          }
        }

        try {
          await db().prepare(`
            INSERT INTO pm_bom_metal
              (product_code, product_name, product_line, metal_code,
               content_gram, content_unit, monthly_volume, content_source,
               valid_from, notes, creator_id)
            VALUES (?, ?, ?, ?, ?, 'g', ?, ?, TO_DATE(?, 'YYYY-MM-DD'), ?, ?)
          `).run(
            productCode, r.product_name || null, r.product_line || null, metalCode,
            contentGram,
            r.monthly_volume != null && r.monthly_volume !== '' ? Number(r.monthly_volume) : null,
            r.content_source || 'csv-upload',
            validFrom, r.notes || null, req.user.id,
          );
          result.inserted++;
        } catch (e) {
          if (/ORA-00001/.test(e.message)) {
            result.skipped++;  // insert mode 下重複,skip
          } else throw e;
        }
      } catch (e) {
        result.errors.push({ row: i + 2, error: e.message });
      }
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /export-csv ────────────────────────────────────────────────────────
router.get('/export-csv', async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: '需 admin 權限' });
  try {
    const rows = await db().prepare(`
      SELECT product_code, product_name, product_line, metal_code,
             content_gram, content_unit, monthly_volume, content_source,
             TO_CHAR(valid_from, 'YYYY-MM-DD') AS valid_from,
             TO_CHAR(valid_to, 'YYYY-MM-DD') AS valid_to,
             notes
      FROM pm_bom_metal ORDER BY product_code, metal_code
    `).all();
    const headers = ['product_code', 'product_name', 'product_line', 'metal_code',
                     'content_gram', 'content_unit', 'monthly_volume', 'content_source',
                     'valid_from', 'valid_to', 'notes'];
    const csvLines = [headers.join(',')];
    for (const r of rows || []) {
      const line = headers.map(h => csvEscape(r[h] ?? r[h.toUpperCase()] ?? '')).join(',');
      csvLines.push(line);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pm_bom_metal_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + csvLines.join('\n'));  // BOM for Excel
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 簡易 CSV parser(支援 quoted、雙引號 escape)─────────────────────────
function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length === 0 || cells.every(c => !c)) continue;
    const row = {};
    headers.forEach((h, idx) => row[h] = cells[idx] != null ? cells[idx].trim() : '');
    rows.push(row);
  }
  return rows;
}
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuote = false;
      else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') inQuote = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
function csvEscape(v) {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

module.exports = router;
