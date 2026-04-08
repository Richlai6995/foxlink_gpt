const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('./auth');

// ── Public: GET sections for a given language ────────────────────────────────

// GET /api/help/sections?lang=zh-TW
// Falls back to zh-TW for sections missing the requested language translation
router.get('/sections', verifyToken, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const lang = req.query.lang || 'zh-TW';

    // Use COALESCE to fallback to zh-TW when target lang translation is missing
    const rows = await db.prepare(`
      SELECT s.id, s.section_type, s.sort_order, s.icon, s.icon_color,
             s.last_modified, s.linked_course_id, s.linked_lesson_id,
             COALESCE(t.title, tzh.title)               AS title,
             COALESCE(t.sidebar_label, tzh.sidebar_label) AS sidebar_label,
             COALESCE(t.blocks_json, tzh.blocks_json)     AS blocks_json,
             t.translated_at,
             CASE WHEN t.lang IS NOT NULL THEN t.lang ELSE 'zh-TW' END AS actual_lang
      FROM help_sections s
      LEFT JOIN help_translations t   ON t.section_id = s.id AND t.lang = ?
      LEFT JOIN help_translations tzh ON tzh.section_id = s.id AND tzh.lang = 'zh-TW'
      ORDER BY s.sort_order
    `).all(lang);

    const sections = rows.map(r => ({
      id: r.id,
      sectionType: r.section_type,
      sortOrder: r.sort_order,
      icon: r.icon,
      iconColor: r.icon_color,
      lastModified: r.last_modified,
      linkedCourseId: r.linked_course_id || null,
      linkedLessonId: r.linked_lesson_id || null,
      title: r.title || '',
      sidebarLabel: r.sidebar_label || '',
      blocks: (() => { try { const b = r.blocks_json ? JSON.parse(r.blocks_json) : []; return Array.isArray(b) ? b : []; } catch { return []; } })(),
      translatedAt: r.translated_at,
      actualLang: r.actual_lang,
    }));

    res.json(sections);
  } catch (err) {
    console.error('[HelpSections] GET /sections error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: translation status overview ───────────────────────────────────────

// GET /api/help/admin/status
router.get('/admin/status', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;

    const sections = await db.prepare(`
      SELECT s.id, s.section_type, s.sort_order, s.icon, s.icon_color, s.last_modified,
             s.linked_course_id, s.linked_lesson_id
      FROM help_sections s
      ORDER BY s.sort_order
    `).all();

    const translations = await db.prepare(`
      SELECT section_id, lang, title, sidebar_label, translated_at
      FROM help_translations
    `).all();

    // group translations by section_id
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
      translations: transMap[s.id] || {},
    }));

    res.json(result);
  } catch (err) {
    console.error('[HelpSections] GET /admin/status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: get single section with all translations ──────────────────────────

// GET /api/help/admin/sections/:id
router.get('/admin/sections/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { id } = req.params;

    const section = await db.prepare(`
      SELECT id, section_type, sort_order, icon, icon_color, last_modified
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

    res.json({
      ...section,
      translations: transMap,
    });
  } catch (err) {
    console.error('[HelpSections] GET /admin/sections/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: update a section's translation for a specific lang ────────────────

// PUT /api/help/admin/sections/:id/translations/:lang
router.put('/admin/sections/:id/translations/:lang', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { id, lang } = req.params;
    const { title, sidebarLabel, blocks } = req.body;

    const blocksJson = JSON.stringify(blocks);
    const now = new Date().toISOString().slice(0, 10);

    // upsert
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

    // if updating zh-TW (source), also bump lastModified on section
    if (lang === 'zh-TW') {
      await db.prepare('UPDATE help_sections SET last_modified = ? WHERE id = ?').run(now, id);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[HelpSections] PUT translation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── In-memory progress store for translation jobs ────────────────────────────
const jobProgress = new Map(); // jobId → { sections: Record<sectionId, status>, done: bool, results, aborted }

// POST /api/help/admin/translate — starts background translation, returns immediately
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

  // Init progress store
  const progress = { sections: {}, done: false, results: null, aborted: false, total: sectionIds.length };
  for (const id of sectionIds) progress.sections[id] = { status: 'pending' };
  jobProgress.set(jobId, progress);

  // Progress callback — stores status + chunk progress
  const onProgress = ({ sectionId, status, error, index, total, chunk, totalChunks }) => {
    const p = jobProgress.get(jobId);
    if (!p) return;
    if (status === 'done') {
      p.sections[sectionId] = { status: 'done' };
    } else if (status === 'error') {
      p.sections[sectionId] = { status: 'error', error: error || '' };
    } else if (status === 'aborted') {
      p.sections[sectionId] = { status: 'aborted' };
    } else {
      // translating — include chunk progress
      p.sections[sectionId] = { status, chunk: chunk ?? 0, totalChunks: totalChunks ?? 1 };
    }
    p.total = total;
  };

  // Start translation in background
  const { translateHelpSections } = require('../services/helpTranslator');
  translateHelpSections(db, sectionIds, targetLang, modelKey || 'flash', jobId, onProgress)
    .then(({ results, aborted }) => {
      const p = jobProgress.get(jobId);
      if (p) { p.done = true; p.results = results; p.aborted = aborted; }
      // Auto-clean after 5 minutes
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

// GET /api/help/admin/translate/progress/:jobId — poll translation progress
router.get('/admin/translate/progress/:jobId', verifyToken, verifyAdmin, (req, res) => {
  const p = jobProgress.get(req.params.jobId);
  if (!p) return res.json({ found: false });
  res.json({ found: true, sections: p.sections, done: p.done, results: p.results, aborted: p.aborted, total: p.total });
});

// POST /api/help/admin/translate/abort
router.post('/admin/translate/abort', verifyToken, verifyAdmin, (req, res) => {
  const { jobId } = req.body;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });

  const { abortTranslation } = require('../services/helpTranslator');
  const aborted = abortTranslation(jobId);
  res.json({ ok: true, aborted });
});

// ── Admin: seed data from helpSeedData.js (one-time init) ────────────────────

// POST /api/help/admin/seed
router.post('/admin/seed', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = require('../database-oracle').db;
    const { userSections } = require('../data/helpSeedData');

    let inserted = 0;
    for (const section of userSections) {
      // upsert section
      const existing = await db.prepare('SELECT id FROM help_sections WHERE id = ?').get(section.id);
      if (!existing) {
        await db.prepare(`
          INSERT INTO help_sections (id, section_type, sort_order, icon, icon_color, last_modified)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(section.id, 'user', section.sort_order, section.icon, section.icon_color, section.last_modified);
      } else {
        await db.prepare(`
          UPDATE help_sections SET sort_order=?, icon=?, icon_color=?, last_modified=? WHERE id=?
        `).run(section.sort_order, section.icon, section.icon_color, section.last_modified, section.id);
      }

      // upsert zh-TW translation
      const blocksJson = JSON.stringify(section.blocks);
      const existingTrans = await db.prepare(
        'SELECT id FROM help_translations WHERE section_id = ? AND lang = ?'
      ).get(section.id, 'zh-TW');

      if (!existingTrans) {
        await db.prepare(`
          INSERT INTO help_translations (section_id, lang, title, sidebar_label, blocks_json, translated_at)
          VALUES (?, 'zh-TW', ?, ?, ?, ?)
        `).run(section.id, section.title, section.sidebar_label, blocksJson, section.last_modified);
        inserted++;
      } else {
        await db.prepare(`
          UPDATE help_translations
          SET title=?, sidebar_label=?, blocks_json=?, translated_at=?, updated_at=SYSTIMESTAMP
          WHERE section_id=? AND lang='zh-TW'
        `).run(section.title, section.sidebar_label, blocksJson, section.last_modified, section.id);
      }
    }

    res.json({ ok: true, total: userSections.length, inserted });
  } catch (err) {
    console.error('[HelpSections] POST /admin/seed error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/help/admin/sections/:id/link — bind training course to help section
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

module.exports = router;
