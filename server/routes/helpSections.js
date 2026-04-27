const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('./auth');
const { resolveGranteeNamesInRows, getLangFromReq } = require('../services/granteeNameResolver');

// ── Helpers ──────────────────────────────────────────────────────────────────

const VALID_GRANTEE_TYPES = ['user', 'role', 'factory', 'department', 'cost_center', 'division', 'org_group'];

/**
 * 把 session user 攤開成 (grantee_type, grantee_id) tuples,給 share matching 用。
 */
function userGranteeTuples(user) {
  const map = [
    ['user',        String(user?.id ?? '')],
    ['role',        String(user?.role_id ?? '')],
    ['factory',     String(user?.factory_code ?? '')],
    ['department',  String(user?.dept_code ?? '')],
    ['cost_center', String(user?.profit_center ?? '')],
    ['division',    String(user?.org_section ?? '')],
    ['org_group',   String(user?.org_group_name ?? '')],
  ];
  return map.filter(([_, v]) => v && v !== 'null' && v !== 'undefined');
}

async function userHasBookAccess(db, user, bookId) {
  if (!user || !bookId) return false;
  if (user.role === 'admin') return true;
  const book = await db.prepare(`SELECT is_special, is_active FROM help_books WHERE id=?`).get(bookId);
  if (!book || Number(book.is_active) === 0) return false;
  if (Number(book.is_special) === 0) return true;  // 主說明書全員可讀

  const tuples = userGranteeTuples(user);
  if (tuples.length === 0) return false;

  const orClauses = tuples.map(() => '(grantee_type = ? AND grantee_id = ?)').join(' OR ');
  const params = tuples.flatMap(([t, v]) => [t, v]);
  const row = await db.prepare(`
    SELECT 1 AS hit FROM help_book_shares
    WHERE book_id = ? AND (${orClauses})
    FETCH FIRST 1 ROWS ONLY
  `).get(bookId, ...params);
  return !!row;
}

async function listAccessibleBookIds(db, user) {
  if (!user) return [];
  const all = await db.prepare(`
    SELECT id, code, name, description, icon, is_special, sort_order
    FROM help_books WHERE is_active = 1 ORDER BY sort_order, id
  `).all();
  if (user.role === 'admin') return all;

  const tuples = userGranteeTuples(user);
  const result = [];
  for (const b of all) {
    if (Number(b.is_special) === 0) { result.push(b); continue; }
    if (tuples.length === 0) continue;
    const orClauses = tuples.map(() => '(grantee_type = ? AND grantee_id = ?)').join(' OR ');
    const params = tuples.flatMap(([t, v]) => [t, v]);
    const row = await db.prepare(`
      SELECT 1 AS hit FROM help_book_shares
      WHERE book_id = ? AND (${orClauses})
      FETCH FIRST 1 ROWS ONLY
    `).get(b.id, ...params);
    if (row) result.push(b);
  }
  return result;
}

async function getBookByCodeOrId(db, codeOrId) {
  if (!codeOrId) return null;
  const isNum = /^\d+$/.test(String(codeOrId));
  if (isNum) {
    return await db.prepare(`SELECT * FROM help_books WHERE id=?`).get(Number(codeOrId));
  }
  return await db.prepare(`SELECT * FROM help_books WHERE code=?`).get(String(codeOrId));
}

// ── Public: 列出當前 user 可看到的 books ───────────────────────────────────────

// GET /api/help/books?lang=zh-TW — return accessible books for current user
router.get('/books', verifyToken, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const books = await listAccessibleBookIds(db, req.user);
    res.json(books.map(b => ({
      id: b.id, code: b.code, name: b.name, description: b.description,
      icon: b.icon, isSpecial: Number(b.is_special) === 1, sortOrder: b.sort_order,
    })));
  } catch (err) {
    console.error('[HelpSections] GET /books error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Public: GET sections for a given language + book ─────────────────────────

// GET /api/help/sections?lang=zh-TW&book=cortex|precious-metals|<id>
// 不傳 book 預設 cortex(向下相容既有前端)
router.get('/sections', verifyToken, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const lang = req.query.lang || 'zh-TW';
    const bookKey = req.query.book || 'cortex';

    const book = await getBookByCodeOrId(db, bookKey);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    if (Number(book.is_active) === 0) return res.status(404).json({ error: 'Book inactive' });

    const allowed = await userHasBookAccess(db, req.user, book.id);
    if (!allowed) return res.status(403).json({ error: '無權閱讀此說明書' });

    const rows = await db.prepare(`
      SELECT s.id, s.section_type, s.sort_order, s.icon, s.icon_color,
             s.last_modified, s.linked_course_id, s.linked_lesson_id, s.book_id,
             l.is_mandatory                            AS linked_lesson_mandatory,
             COALESCE(t.title, tzh.title)               AS title,
             COALESCE(t.sidebar_label, tzh.sidebar_label) AS sidebar_label,
             COALESCE(t.blocks_json, tzh.blocks_json)     AS blocks_json,
             t.translated_at,
             CASE WHEN t.lang IS NOT NULL THEN t.lang ELSE 'zh-TW' END AS actual_lang
      FROM help_sections s
      LEFT JOIN help_translations t   ON t.section_id = s.id AND t.lang = ?
      LEFT JOIN help_translations tzh ON tzh.section_id = s.id AND tzh.lang = 'zh-TW'
      LEFT JOIN course_lessons l      ON l.id = s.linked_lesson_id
      WHERE s.book_id = ?
      ORDER BY s.sort_order
    `).all(lang, book.id);

    const sections = rows.map(r => ({
      id: r.id,
      sectionType: r.section_type,
      sortOrder: r.sort_order,
      icon: r.icon,
      iconColor: r.icon_color,
      lastModified: r.last_modified,
      linkedCourseId: r.linked_course_id || null,
      linkedLessonId: r.linked_lesson_id || null,
      linkedLessonMandatory: r.linked_lesson_mandatory == null ? null : Number(r.linked_lesson_mandatory),
      title: r.title || '',
      sidebarLabel: r.sidebar_label || '',
      blocks: (() => { try { const b = r.blocks_json ? JSON.parse(r.blocks_json) : []; return Array.isArray(b) ? b : []; } catch { return []; } })(),
      translatedAt: r.translated_at,
      actualLang: r.actual_lang,
      bookId: r.book_id,
    }));

    res.json(sections);
  } catch (err) {
    console.error('[HelpSections] GET /sections error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: translation status overview ───────────────────────────────────────

// GET /api/help/admin/status?book=<code|id>(預設 cortex)
router.get('/admin/status', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const bookKey = req.query.book || 'cortex';
    const book = await getBookByCodeOrId(db, bookKey);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const sections = await db.prepare(`
      SELECT s.id, s.section_type, s.sort_order, s.icon, s.icon_color, s.last_modified,
             s.linked_course_id, s.linked_lesson_id, s.book_id,
             c.title  AS linked_course_title,
             l.title  AS linked_lesson_title
      FROM help_sections s
      LEFT JOIN courses        c ON c.id = s.linked_course_id
      LEFT JOIN course_lessons l ON l.id = s.linked_lesson_id
      WHERE s.book_id = ?
      ORDER BY s.sort_order
    `).all(book.id);

    const translations = await db.prepare(`
      SELECT t.section_id, t.lang, t.title, t.sidebar_label, t.translated_at
      FROM help_translations t
      JOIN help_sections s ON s.id = t.section_id
      WHERE s.book_id = ?
    `).all(book.id);

    const transMap = {};
    for (const t of translations) {
      if (!transMap[t.section_id]) transMap[t.section_id] = {};
      transMap[t.section_id][t.lang] = {
        title: t.title,
        sidebarLabel: t.sidebar_label,
        translatedAt: t.translated_at,
      };
    }

    const result = sections.map(s => ({
      id: s.id,
      sectionType: s.section_type,
      sortOrder: s.sort_order,
      icon: s.icon,
      iconColor: s.icon_color,
      lastModified: s.last_modified,
      linkedCourseId: s.linked_course_id || null,
      linkedLessonId: s.linked_lesson_id || null,
      linkedCourseTitle: s.linked_course_title || null,
      linkedLessonTitle: s.linked_lesson_title || null,
      bookId: s.book_id,
      translations: transMap[s.id] || {},
    }));

    res.json({
      book: { id: book.id, code: book.code, name: book.name, isSpecial: Number(book.is_special) === 1 },
      sections: result,
    });
  } catch (err) {
    console.error('[HelpSections] GET /admin/status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: get single section with all translations ──────────────────────────

router.get('/admin/sections/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { id } = req.params;

    const section = await db.prepare(`
      SELECT id, section_type, sort_order, icon, icon_color, last_modified, book_id
      FROM help_sections WHERE id = ?
    `).get(id);

    if (!section) return res.status(404).json({ error: 'Section not found' });

    const translations = await db.prepare(`
      SELECT lang, title, sidebar_label, blocks_json, translated_at, updated_at
      FROM help_translations WHERE section_id = ?
    `).all(id);

    const transMap = {};
    for (const t of translations) {
      transMap[t.lang] = {
        title: t.title,
        sidebarLabel: t.sidebar_label,
        blocks: (() => { try { const b = t.blocks_json ? JSON.parse(t.blocks_json) : []; return Array.isArray(b) ? b : []; } catch { return []; } })(),
        translatedAt: t.translated_at,
        updatedAt: t.updated_at,
      };
    }

    res.json({ ...section, translations: transMap });
  } catch (err) {
    console.error('[HelpSections] GET /admin/sections/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: update a section's translation for a specific lang ────────────────

router.put('/admin/sections/:id/translations/:lang', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { id, lang } = req.params;
    const { title, sidebarLabel, blocks } = req.body;

    const blocksJson = JSON.stringify(blocks);
    const now = new Date().toISOString().slice(0, 10);

    const existing = await db.prepare(
      'SELECT id FROM help_translations WHERE section_id = ? AND lang = ?'
    ).get(id, lang);

    if (existing) {
      await db.prepare(`
        UPDATE help_translations
        SET title = ?, sidebar_label = ?, blocks_json = ?, translated_at = ?, updated_at = SYSTIMESTAMP
        WHERE section_id = ? AND lang = ?
      `).run(title, sidebarLabel, blocksJson, now, id, lang);
    } else {
      await db.prepare(`
        INSERT INTO help_translations (section_id, lang, title, sidebar_label, blocks_json, translated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, lang, title, sidebarLabel, blocksJson, now);
    }

    if (lang === 'zh-TW') {
      await db.prepare('UPDATE help_sections SET last_modified = ? WHERE id = ?').run(now, id);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[HelpSections] PUT translation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Translation jobs(舊邏輯保留)──────────────────────────────────────────

const jobProgress = new Map();

router.post('/admin/translate', verifyToken, verifyAdmin, (req, res) => {
  const db = require('../database-oracle').db;
  const { sectionIds, targetLang, modelKey, jobId } = req.body;

  if (!targetLang || !['en', 'vi'].includes(targetLang)) {
    return res.status(400).json({ error: 'targetLang must be "en" or "vi"' });
  }
  if (!Array.isArray(sectionIds) || sectionIds.length === 0) {
    return res.status(400).json({ error: 'sectionIds required' });
  }
  if (!jobId) {
    return res.status(400).json({ error: 'jobId required' });
  }

  const progress = { sections: {}, done: false, results: null, aborted: false, total: sectionIds.length };
  for (const id of sectionIds) progress.sections[id] = { status: 'pending' };
  jobProgress.set(jobId, progress);

  const onProgress = ({ sectionId, status, error, index, total, chunk, totalChunks }) => {
    const p = jobProgress.get(jobId);
    if (!p) return;
    if (status === 'done') p.sections[sectionId] = { status: 'done' };
    else if (status === 'error') p.sections[sectionId] = { status: 'error', error: error || '' };
    else if (status === 'aborted') p.sections[sectionId] = { status: 'aborted' };
    else p.sections[sectionId] = { status, chunk: chunk ?? 0, totalChunks: totalChunks ?? 1 };
    p.total = total;
  };

  const { translateHelpSections } = require('../services/helpTranslator');
  translateHelpSections(db, sectionIds, targetLang, modelKey || 'flash', jobId, onProgress)
    .then(({ results, aborted }) => {
      const p = jobProgress.get(jobId);
      if (p) { p.done = true; p.results = results; p.aborted = aborted; }
      setTimeout(() => jobProgress.delete(jobId), 5 * 60 * 1000);
    })
    .catch(err => {
      console.error('[HelpSections] translate error:', err);
      const p = jobProgress.get(jobId);
      if (p) { p.done = true; p.results = []; p.aborted = false; }
      setTimeout(() => jobProgress.delete(jobId), 5 * 60 * 1000);
    });

  res.json({ ok: true, jobId });
});

router.get('/admin/translate/progress/:jobId', verifyToken, verifyAdmin, (req, res) => {
  const p = jobProgress.get(req.params.jobId);
  if (!p) return res.json({ found: false });
  res.json({ found: true, sections: p.sections, done: p.done, results: p.results, aborted: p.aborted, total: p.total });
});

router.post('/admin/translate/abort', verifyToken, verifyAdmin, (req, res) => {
  const { jobId } = req.body;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });
  const { abortTranslation } = require('../services/helpTranslator');
  const aborted = abortTranslation(jobId);
  res.json({ ok: true, aborted });
});

// ── Admin: 一次性 seed (cortex book only,維持舊行為,multi-book 走 autoSeedHelp) ──

router.post('/admin/seed', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { autoSeedHelp } = require('../services/helpAutoSeed');
    await autoSeedHelp(db);
    res.json({ ok: true });
  } catch (err) {
    console.error('[HelpSections] POST /admin/seed error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/sections/:id/link', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { linked_course_id, linked_lesson_id } = req.body;
    await db.prepare(`
      UPDATE help_sections SET linked_course_id=?, linked_lesson_id=? WHERE id=?
    `).run(linked_course_id || null, linked_lesson_id || null, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[HelpSections] PUT /admin/sections/:id/link error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 多本說明書管理(Admin only)
// ────────────────────────────────────────────────────────────────────────────

// GET /api/help/admin/books — list all books (active + inactive)
router.get('/admin/books', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(`
      SELECT b.id, b.code, b.name, b.description, b.icon, b.is_special, b.is_active,
             b.sort_order, b.created_at, b.last_modified,
             (SELECT COUNT(*) FROM help_sections s WHERE s.book_id = b.id) AS section_count,
             (SELECT COUNT(*) FROM help_book_shares h WHERE h.book_id = b.id) AS share_count
      FROM help_books b
      ORDER BY b.sort_order, b.id
    `).all();
    res.json(rows.map(b => ({
      id: b.id, code: b.code, name: b.name, description: b.description, icon: b.icon,
      isSpecial: Number(b.is_special) === 1, isActive: Number(b.is_active) === 1,
      sortOrder: b.sort_order, createdAt: b.created_at, lastModified: b.last_modified,
      sectionCount: Number(b.section_count || 0), shareCount: Number(b.share_count || 0),
    })));
  } catch (err) {
    console.error('[HelpSections] GET /admin/books error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/help/admin/books — create new (special) book(主 cortex book 由 migration 種,不從這建)
router.post('/admin/books', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { code, name, description, icon, sortOrder, isSpecial } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'code 與 name 必填' });
    const trimCode = String(code).trim();
    if (!/^[a-z0-9-]{2,60}$/.test(trimCode)) {
      return res.status(400).json({ error: 'code 僅允許 a-z 0-9 連字號,長度 2-60' });
    }
    const dup = await db.prepare(`SELECT id FROM help_books WHERE code=?`).get(trimCode);
    if (dup) return res.status(400).json({ error: 'code 已存在' });

    const now = new Date().toISOString().slice(0, 10);
    await db.prepare(`
      INSERT INTO help_books (code, name, description, icon, is_special, is_active, sort_order, last_modified)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(trimCode, name, description || null, icon || 'book_open_text',
           isSpecial != null ? Number(isSpecial) : 1, Number(sortOrder || 100), now);
    const created = await db.prepare(`SELECT id FROM help_books WHERE code=?`).get(trimCode);

    // 套用全域預設分享範本(only special book)
    if (created?.id && (isSpecial == null || Number(isSpecial) === 1)) {
      const tpl = await db.prepare(`SELECT grantee_type, grantee_id FROM help_default_share`).all();
      const list = Array.isArray(tpl) ? tpl : (tpl?.rows || []);
      let copied = 0;
      for (const t of list) {
        try {
          await db.prepare(`
            INSERT INTO help_book_shares (book_id, grantee_type, grantee_id, granted_by)
            VALUES (?, ?, ?, ?)
          `).run(created.id, t.grantee_type, t.grantee_id, req.user?.id || null);
          copied++;
        } catch { /* unique conflict */ }
      }
      if (copied > 0) console.log(`[HelpBooks] Applied default-share template (${copied} entries) to new book "${trimCode}"`);
    }

    res.json({ ok: true, id: created.id });
  } catch (err) {
    console.error('[HelpSections] POST /admin/books error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/help/admin/books/:id — update book metadata
router.patch('/admin/books/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { id } = req.params;
    const { name, description, icon, sortOrder, isActive, isSpecial } = req.body;
    const cur = await db.prepare(`SELECT id, code FROM help_books WHERE id=?`).get(id);
    if (!cur) return res.status(404).json({ error: 'Book not found' });
    if (cur.code === 'cortex' && (isSpecial != null && Number(isSpecial) === 1)) {
      return res.status(400).json({ error: 'cortex 主說明書不可改為 special' });
    }
    await db.prepare(`
      UPDATE help_books SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        icon = COALESCE(?, icon),
        sort_order = COALESCE(?, sort_order),
        is_active = COALESCE(?, is_active),
        is_special = COALESCE(?, is_special)
      WHERE id = ?
    `).run(
      name ?? null, description ?? null, icon ?? null,
      sortOrder != null ? Number(sortOrder) : null,
      isActive != null ? Number(isActive) : null,
      isSpecial != null ? Number(isSpecial) : null,
      id,
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[HelpSections] PATCH /admin/books/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/help/admin/books/:id — 軟刪(設為 inactive)。cortex 不可刪
router.delete('/admin/books/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const cur = await db.prepare(`SELECT id, code FROM help_books WHERE id=?`).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Book not found' });
    if (cur.code === 'cortex') return res.status(400).json({ error: 'cortex 主說明書不可刪除' });
    await db.prepare(`UPDATE help_books SET is_active = 0 WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[HelpSections] DELETE /admin/books/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Book shares ──────────────────────────────────────────────────────────────

// GET /api/help/admin/books/:id/shares
router.get('/admin/books/:id/shares', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(`
      SELECT s.id, s.book_id, s.grantee_type, s.grantee_id, s.granted_by, s.granted_at,
             u.name AS granted_by_name
      FROM help_book_shares s
      LEFT JOIN users u ON u.id = s.granted_by
      WHERE s.book_id = ?
      ORDER BY s.granted_at DESC, s.id DESC
    `).all(req.params.id);
    // 統一補 grantee_name(跟 AI 戰情 / DesignerPanel / 其他分享元件同 pattern)
    await resolveGranteeNamesInRows(rows, getLangFromReq(req), db);
    res.json(rows);
  } catch (err) {
    console.error('[HelpSections] GET /admin/books/:id/shares error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/help/admin/books/:id/shares  body: { grantee_type, grantee_id }
router.post('/admin/books/:id/shares', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { grantee_type, grantee_id } = req.body || {};
    if (!grantee_type || !grantee_id) return res.status(400).json({ error: 'grantee_type 與 grantee_id 必填' });
    if (!VALID_GRANTEE_TYPES.includes(grantee_type)) return res.status(400).json({ error: '無效 grantee_type' });

    const book = await db.prepare(`SELECT id FROM help_books WHERE id=?`).get(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    try {
      await db.prepare(`
        INSERT INTO help_book_shares (book_id, grantee_type, grantee_id, granted_by)
        VALUES (?, ?, ?, ?)
      `).run(book.id, grantee_type, String(grantee_id), req.user?.id || null);
    } catch (e) {
      if (String(e.message || '').includes('ORA-00001') || String(e.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: '已存在相同分享' });
      }
      throw e;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[HelpSections] POST /admin/books/:id/shares error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/help/admin/books/:id/shares/:shareId
router.delete('/admin/books/:id/shares/:shareId', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(`DELETE FROM help_book_shares WHERE id = ? AND book_id = ?`)
      .run(req.params.shareId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[HelpSections] DELETE /admin/books/:id/shares/:shareId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Default share template(全域,新建 special book 時複製來源)──────────────

// GET /api/help/admin/default-share
router.get('/admin/default-share', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const rows = await db.prepare(`
      SELECT id, grantee_type, grantee_id, created_at
      FROM help_default_share ORDER BY created_at DESC, id DESC
    `).all();
    res.json(rows);
  } catch (err) {
    console.error('[HelpSections] GET /admin/default-share error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/help/admin/default-share  body: { grantee_type, grantee_id }
router.post('/admin/default-share', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { grantee_type, grantee_id } = req.body || {};
    if (!grantee_type || !grantee_id) return res.status(400).json({ error: 'grantee_type 與 grantee_id 必填' });
    if (!VALID_GRANTEE_TYPES.includes(grantee_type)) return res.status(400).json({ error: '無效 grantee_type' });
    try {
      await db.prepare(`
        INSERT INTO help_default_share (grantee_type, grantee_id) VALUES (?, ?)
      `).run(grantee_type, String(grantee_id));
    } catch (e) {
      if (String(e.message || '').includes('ORA-00001') || String(e.message || '').includes('UNIQUE')) {
        return res.status(409).json({ error: '已存在相同預設分享' });
      }
      throw e;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[HelpSections] POST /admin/default-share error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/help/admin/default-share/:id
router.delete('/admin/default-share/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    await db.prepare(`DELETE FROM help_default_share WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[HelpSections] DELETE /admin/default-share/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
