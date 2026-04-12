const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { verifyToken } = require('./auth');
const { db } = require('../database-oracle');

// ─── File upload config ──────────────────────────────────────────────────────
const localUploads = path.join(__dirname, '..', 'uploads');
let UPLOAD_ROOT = localUploads;
const altUploadDir = path.resolve('/app/uploads/training'); // Docker legacy path on Windows
if (process.env.UPLOAD_DIR) {
  const envDir = path.resolve(process.env.UPLOAD_DIR);
  try { if (!fs.existsSync(envDir)) fs.mkdirSync(envDir, { recursive: true }); UPLOAD_ROOT = envDir; }
  catch { console.warn('[Training] UPLOAD_DIR not accessible, fallback to', localUploads); }
}
const uploadDir = path.join(UPLOAD_ROOT, 'training');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Serve training uploads — try primary dir first, fallback to alt dir
router.use('/files', express.static(uploadDir));
if (fs.existsSync(altUploadDir) && altUploadDir !== uploadDir) {
  router.use('/files', express.static(altUploadDir));
  console.log('[Training] Also serving files from fallback:', altUploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const courseId = req.params.id || req.params.courseId || 'tmp';
    const dir = path.join(uploadDir, `course_${courseId}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Concurrency limiter (used by translate / TTS batch / etc.) ──────────────
function pLimit(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

// All routes require auth
router.use(verifyToken);

// Resolve effective_training_permission for current user
// Values: 'none' | 'publish' | 'publish_edit'
router.use(async (req, res, next) => {
  if (req.user.role === 'admin') {
    req.user.effective_training_permission = 'publish_edit';
    return next();
  }
  // User-level override takes precedence, then role-level, then 'none'
  if (req.user.training_permission) {
    req.user.effective_training_permission = req.user.training_permission;
    return next();
  }
  // Look up role-level
  if (req.user.role_id) {
    try {
      const role = await db.prepare('SELECT training_permission FROM roles WHERE id=?').get(req.user.role_id);
      req.user.effective_training_permission = role?.training_permission || 'none';
    } catch { req.user.effective_training_permission = 'none'; }
  } else {
    req.user.effective_training_permission = 'none';
  }
  next();
});

// Permission helpers for Phase 4A
function canPublish(req) {
  return ['publish', 'publish_edit'].includes(req.user.effective_training_permission);
}
function canEditCourse(req) {
  return req.user.effective_training_permission === 'publish_edit';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Permission helpers
// ═══════════════════════════════════════════════════════════════════════════════

async function canUserAccessCourse(courseId, user) {
  const course = await db.prepare(
    'SELECT created_by, is_public, status FROM courses WHERE id = ?'
  ).get(courseId);
  if (!course) return { access: false };
  if (course.created_by === user.id) return { access: true, permission: 'owner' };
  if (user.role === 'admin') return { access: true, permission: 'admin' };
  if (course.is_public === 1 && course.status === 'published')
    return { access: true, permission: 'view' };

  const access = await db.prepare(`
    SELECT permission FROM course_access WHERE course_id = ? AND (
      (grantee_type = 'user' AND grantee_id = TO_CHAR(?))
      OR (grantee_type = 'role' AND grantee_id = ?)
      OR (grantee_type IN ('dept','department') AND grantee_id = ? AND ? IS NOT NULL)
      OR (grantee_type = 'profit_center' AND grantee_id = ? AND ? IS NOT NULL)
      OR (grantee_type = 'org_section' AND grantee_id = ? AND ? IS NOT NULL)
      OR (grantee_type = 'org_group' AND grantee_id = ? AND ? IS NOT NULL)
    ) ORDER BY CASE permission WHEN 'develop' THEN 0 ELSE 1 END
    FETCH FIRST 1 ROWS ONLY
  `).get(
    courseId,
    user.id, user.role,
    user.dept_code, user.dept_code,
    user.profit_center, user.profit_center,
    user.org_section, user.org_section,
    user.org_group, user.org_group
  );
  if (access) return { access: true, permission: access.permission };

  // Check program assignments — user assigned to a program containing this course
  const assignment = await db.prepare(`
    SELECT pa.id FROM program_assignments pa
    JOIN training_programs tp ON tp.id = pa.program_id
    WHERE pa.course_id = ? AND pa.user_id = ? AND pa.status != 'exempted'
      AND tp.status IN ('active', 'paused')
    FETCH FIRST 1 ROWS ONLY
  `).get(courseId, user.id);
  if (assignment) return { access: true, permission: 'view' };

  return { access: false };
}

// Middleware: attach coursePermission to req
async function loadCoursePermission(req, res, next) {
  const courseId = req.params.id || req.params.courseId;
  if (!courseId) return res.status(400).json({ error: 'Missing course ID' });

  // Help integration: skip access check when help=1 (all logged-in users can learn Help-linked courses)
  if (req.query.help === '1' || req.body?.help === true) {
    const course = await db.prepare('SELECT id FROM courses WHERE id=?').get(Number(courseId));
    if (!course) return res.status(404).json({ error: '課程不存在' });
    req.coursePermission = 'view';
    req.courseId = Number(courseId);
    return next();
  }

  const result = await canUserAccessCourse(courseId, req.user);
  if (!result.access) return res.status(403).json({ error: '權限不足' });
  req.coursePermission = result.permission;
  req.courseId = Number(courseId);
  next();
}

function requirePermission(...allowed) {
  return (req, res, next) => {
    if (!allowed.includes(req.coursePermission))
      return res.status(403).json({ error: '權限不足' });
    next();
  };
}

function canEdit(req) {
  return ['owner', 'admin', 'develop'].includes(req.coursePermission);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Categories
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/training/categories — tree
router.get('/categories', async (req, res) => {
  try {
    const lang = req.query.lang || 'zh-TW';
    const rows = await db.prepare(`
      SELECT c.id, c.parent_id, c.name, c.sort_order,
             ct.name AS translated_name
      FROM course_categories c
      LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.lang = ?
      ORDER BY c.sort_order, c.id
    `).all(lang === 'zh-TW' ? '__none__' : lang);

    const categories = rows.map(r => ({
      id: r.id,
      parent_id: r.parent_id,
      name: (lang !== 'zh-TW' && r.translated_name) ? r.translated_name : r.name,
      name_zh: r.name,
      sort_order: r.sort_order
    }));
    res.json(categories);
  } catch (e) {
    console.error('[Training] GET categories:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/categories
router.post('/categories', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.effective_training_permission !== 'publish_edit')
      return res.status(403).json({ error: '需要教材編輯權限' });

    const { name, parent_id, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    // Enforce max 3 levels
    if (parent_id) {
      const parent = await db.prepare('SELECT parent_id FROM course_categories WHERE id = ?').get(parent_id);
      if (parent && parent.parent_id) {
        const grandparent = await db.prepare('SELECT parent_id FROM course_categories WHERE id = ?').get(parent.parent_id);
        if (grandparent && grandparent.parent_id)
          return res.status(400).json({ error: '分類最多 3 層' });
      }
    }

    const result = await db.prepare(
      `INSERT INTO course_categories (name, parent_id, sort_order, created_by)
       VALUES (?, ?, ?, ?)`
    ).run(name, parent_id || null, sort_order || 0, req.user.id);
    res.json({ id: result.lastInsertRowid, name, parent_id, sort_order: sort_order || 0 });
  } catch (e) {
    console.error('[Training] POST categories:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/training/categories/:id
router.put('/categories/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.effective_training_permission !== 'publish_edit')
      return res.status(403).json({ error: '需要教材編輯權限' });
    const { name, parent_id, sort_order } = req.body;
    await db.prepare(
      `UPDATE course_categories SET name=?, parent_id=?, sort_order=? WHERE id=?`
    ).run(name, parent_id || null, sort_order || 0, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Training] PUT categories:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/training/categories/:id
router.delete('/categories/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.effective_training_permission !== 'publish_edit')
      return res.status(403).json({ error: '需要教材編輯權限' });
    // Move children to parent of deleted category
    const cat = await db.prepare('SELECT parent_id FROM course_categories WHERE id=?').get(req.params.id);
    if (cat) {
      await db.prepare('UPDATE course_categories SET parent_id=? WHERE parent_id=?')
        .run(cat.parent_id || null, req.params.id);
      await db.prepare('UPDATE courses SET category_id=NULL WHERE category_id=?')
        .run(req.params.id);
    }
    await db.prepare('DELETE FROM course_categories WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Training] DELETE categories:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Courses
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/training/courses — list with permission filtering
router.get('/courses', async (req, res) => {
  try {
    const user = req.user;
    const { category_id, status, search, my_only } = req.query;

    let sql = `
      SELECT c.id, c.title, c.description, c.cover_image, c.category_id,
             c.created_by, c.status, c.is_public, c.pass_score,
             c.max_attempts, c.time_limit_minutes,
             c.created_at, c.updated_at,
             u.name AS creator_name,
             cat.name AS category_name
      FROM courses c
      LEFT JOIN users u ON u.id = c.created_by
      LEFT JOIN course_categories cat ON cat.id = c.category_id
      WHERE 1=1
    `;
    const params = [];

    if (my_only === '1') {
      // Show own courses + courses shared to this user (for publish users in dev area)
      sql += ` AND (
        c.created_by = ?
        OR EXISTS (
          SELECT 1 FROM course_access ca WHERE ca.course_id = c.id AND (
            (ca.grantee_type='user' AND ca.grantee_id=TO_CHAR(?))
            OR (ca.grantee_type='role' AND ca.grantee_id=?)
            OR (ca.grantee_type IN ('dept','department') AND ca.grantee_id=? AND ? IS NOT NULL)
            OR (ca.grantee_type='cost_center' AND ca.grantee_id=? AND ? IS NOT NULL)
            OR (ca.grantee_type='division' AND ca.grantee_id=? AND ? IS NOT NULL)
            OR (ca.grantee_type='org_group' AND ca.grantee_id=? AND ? IS NOT NULL)
          )
        )
      )`;
      params.push(user.id,
        user.id, user.role,
        user.dept_code, user.dept_code,
        user.profit_center, user.profit_center,
        user.org_section, user.org_section,
        user.org_group, user.org_group);
    } else if (user.role !== 'admin') {
      // User can see: own + public published + shared
      sql += ` AND (
        c.created_by = ?
        OR (c.is_public = 1 AND c.status = 'published')
        OR EXISTS (
          SELECT 1 FROM course_access ca WHERE ca.course_id = c.id AND (
            (ca.grantee_type='user' AND ca.grantee_id=TO_CHAR(?))
            OR (ca.grantee_type='role' AND ca.grantee_id=?)
            OR (ca.grantee_type IN ('dept','department') AND ca.grantee_id=? AND ? IS NOT NULL)
          )
        )
      )`;
      params.push(user.id, user.id, user.role, user.dept_code, user.dept_code);
    }

    if (category_id) {
      sql += ` AND c.category_id = ?`;
      params.push(Number(category_id));
    }
    if (status) {
      sql += ` AND c.status = ?`;
      params.push(status);
    }
    if (search) {
      sql += ` AND (LOWER(c.title) LIKE ? OR LOWER(c.description) LIKE ?)`;
      const s = `%${search.toLowerCase()}%`;
      params.push(s, s);
    }

    sql += ` ORDER BY c.updated_at DESC`;

    const courses = await db.prepare(sql).all(...params);

    // Attach progress for current user
    const progressRows = await db.prepare(`
      SELECT course_id, status, completed_at
      FROM user_course_progress
      WHERE user_id = ? AND lesson_id IS NULL
    `).all(user.id);
    const progressMap = {};
    for (const p of progressRows) progressMap[p.course_id] = p;

    // Merge translations if lang != zh-TW
    const lang = req.query.lang || 'zh-TW';
    let transMap = {};
    let catTransMap = {};
    if (lang !== 'zh-TW') {
      const courseIds = courses.map(c => c.id);
      if (courseIds.length > 0) {
        const placeholders = courseIds.map(() => '?').join(',');
        const ctRows = await db.prepare(
          `SELECT course_id, title, description FROM course_translations WHERE lang=? AND course_id IN (${placeholders})`
        ).all(lang, ...courseIds);
        for (const ct of ctRows) transMap[ct.course_id] = ct;
      }
      const catIds = [...new Set(courses.map(c => c.category_id).filter(Boolean))];
      if (catIds.length > 0) {
        const placeholders = catIds.map(() => '?').join(',');
        const catRows = await db.prepare(
          `SELECT category_id, name FROM category_translations WHERE lang=? AND category_id IN (${placeholders})`
        ).all(lang, ...catIds);
        for (const ct of catRows) catTransMap[ct.category_id] = ct.name;
      }
    }

    // Exam summary per course for current user
    const examSummaryRows = await db.prepare(`
      SELECT course_id,
             COUNT(DISTINCT session_id) AS exam_count,
             ROUND(AVG(session_score), 1) AS avg_score,
             MAX(session_score) AS best_score,
             MAX(session_max) AS best_max,
             MAX(last_at) AS last_exam_at,
             MAX(last_topic) AS last_exam_topic
      FROM (
        SELECT ir.course_id, ir.session_id,
               SUM(COALESCE(ir.weighted_score, ir.score)) AS session_score,
               SUM(COALESCE(ir.weighted_max, ir.max_score)) AS session_max,
               MAX(ir.created_at) AS last_at,
               MAX(et.title) AS last_topic
        FROM interaction_results ir
        LEFT JOIN exam_topics et ON et.id = ir.exam_topic_id
        WHERE ir.user_id = ? AND ir.session_id IS NOT NULL AND ir.player_mode = 'test'
        GROUP BY ir.course_id, ir.session_id
      )
      GROUP BY course_id
    `).all(user.id);
    const examMap = {};
    for (const e of examSummaryRows) examMap[e.course_id] = e;

    const result = courses.map(c => {
      const ct = transMap[c.id];
      return {
        ...c,
        title: ct?.title || c.title,
        description: ct?.description || c.description,
        category_name: catTransMap[c.category_id] || c.category_name,
        my_progress: progressMap[c.id] || null,
        my_exam_summary: examMap[c.id] || null
      };
    });

    res.json(result);
  } catch (e) {
    console.error('[Training] GET courses:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/courses — create
router.post('/courses', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.effective_training_permission !== 'publish_edit')
      return res.status(403).json({ error: '需要教材編輯權限' });

    const { title, description, category_id, pass_score, max_attempts, time_limit_minutes } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });

    const result = await db.prepare(`
      INSERT INTO courses (title, description, category_id, created_by, pass_score, max_attempts, time_limit_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(title, description || null, category_id || null, req.user.id,
           pass_score || 60, max_attempts || null, time_limit_minutes || null);

    res.json({ id: result.lastInsertRowid, title });
  } catch (e) {
    console.error('[Training] POST courses:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/courses/:id — detail
router.get('/courses/:id', loadCoursePermission, async (req, res) => {
  try {
    const course = await db.prepare(`
      SELECT c.*, u.name AS creator_name, cat.name AS category_name
      FROM courses c
      LEFT JOIN users u ON u.id = c.created_by
      LEFT JOIN course_categories cat ON cat.id = c.category_id
      WHERE c.id = ?
    `).get(req.courseId);
    if (!course) return res.status(404).json({ error: '課程不存在' });

    const lessons = await db.prepare(
      'SELECT * FROM course_lessons WHERE course_id = ? ORDER BY sort_order, id'
    ).all(req.courseId);

    const quizCount = await db.prepare(
      'SELECT COUNT(*) AS cnt FROM quiz_questions WHERE course_id = ?'
    ).get(req.courseId);

    // Merge translations if lang != zh-TW
    const lang = req.query.lang || 'zh-TW';
    let translatedCourse = { ...course };
    let translatedLessons = lessons;
    if (lang !== 'zh-TW') {
      const ct = await db.prepare(
        'SELECT title, description FROM course_translations WHERE course_id=? AND lang=?'
      ).get(req.courseId, lang);
      if (ct) {
        if (ct.title) translatedCourse.title = ct.title;
        if (ct.description) translatedCourse.description = ct.description;
      }
      // Category translation
      if (course.category_id) {
        const catT = await db.prepare(
          'SELECT name FROM category_translations WHERE category_id=? AND lang=?'
        ).get(course.category_id, lang);
        if (catT?.name) translatedCourse.category_name = catT.name;
      }
      // Lesson translations
      const lessonIds = lessons.map(l => l.id);
      if (lessonIds.length > 0) {
        const placeholders = lessonIds.map(() => '?').join(',');
        const ltRows = await db.prepare(
          `SELECT lesson_id, title FROM lesson_translations WHERE lang=? AND lesson_id IN (${placeholders})`
        ).all(lang, ...lessonIds);
        const ltMap = {};
        for (const lt of ltRows) ltMap[lt.lesson_id] = lt.title;
        translatedLessons = lessons.map(l => ({
          ...l,
          title: ltMap[l.id] || l.title
        }));
      }
    }

    res.json({
      ...translatedCourse,
      permission: req.coursePermission,
      lessons: translatedLessons,
      quiz_count: quizCount?.cnt || 0
    });
  } catch (e) {
    console.error('[Training] GET course detail:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/training/courses/:id — update
router.put('/courses/:id', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const { title, description, category_id, pass_score, max_attempts, time_limit_minutes, settings_json } = req.body;
    await db.prepare(`
      UPDATE courses SET title=?, description=?, category_id=?,
             pass_score=?, max_attempts=?, time_limit_minutes=?,
             settings_json=?, updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(title, description || null, category_id || null,
           pass_score || 60, max_attempts || null, time_limit_minutes || null,
           settings_json ? (typeof settings_json === 'string' ? settings_json : JSON.stringify(settings_json)) : null,
           req.courseId);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Training] PUT course:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/courses/:id/tts-settings — get TTS voice settings
router.get('/courses/:id/tts-settings', async (req, res) => {
  try {
    const row = await db.prepare('SELECT settings_json FROM courses WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: '課程不存在' });
    let settings = {};
    if (row.settings_json) { try { settings = JSON.parse(row.settings_json); } catch {} }
    res.json({
      tts_voice_gender: settings.tts_voice_gender || 'female',
      tts_speed: settings.tts_speed || 1.0,
      tts_pitch: settings.tts_pitch || 0
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/training/courses/:id
router.delete('/courses/:id', loadCoursePermission, requirePermission('owner', 'admin'), async (req, res) => {
  try {
    // Cascade handled by DB or manual cleanup
    await db.prepare('DELETE FROM courses WHERE id=?').run(req.courseId);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Training] DELETE course:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/courses/:id/publish-check — pre-publish validation
router.get('/courses/:id/publish-check', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const checks = [];

    // 1. At least 1 lesson
    const lessonCount = await db.prepare(
      'SELECT COUNT(*) AS cnt FROM course_lessons WHERE course_id=?'
    ).get(req.courseId);
    checks.push({ key: 'has_lessons', pass: lessonCount.cnt > 0, detail: `${lessonCount.cnt} lessons` });

    // 2. At least 1 slide
    const slideCount = await db.prepare(
      'SELECT COUNT(*) AS cnt FROM course_slides s JOIN course_lessons cl ON cl.id=s.lesson_id WHERE cl.course_id=?'
    ).get(req.courseId);
    checks.push({ key: 'has_slides', pass: slideCount.cnt > 0, detail: `${slideCount.cnt} slides` });

    // 3. Hotspot slides must have >= 1 correct region
    const hotspotSlides = await db.prepare(
      `SELECT s.id, s.content_json FROM course_slides s
       JOIN course_lessons cl ON cl.id=s.lesson_id
       WHERE cl.course_id=?`
    ).all(req.courseId);

    let hotspotIssues = 0;
    for (const slide of hotspotSlides) {
      try {
        const blocks = JSON.parse(slide.content_json || '[]');
        for (const block of blocks) {
          if (block.type === 'hotspot') {
            const regions = block.regions || [];
            const hasCorrect = regions.some(r => r.correct);
            if (!hasCorrect) hotspotIssues++;
          }
        }
      } catch {}
    }
    checks.push({ key: 'hotspot_regions', pass: hotspotIssues === 0, detail: hotspotIssues > 0 ? `${hotspotIssues} hotspot(s) missing correct region` : 'OK' });

    // 4. Optional: has audio
    const audioCount = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM course_slides s
       JOIN course_lessons cl ON cl.id=s.lesson_id
       WHERE cl.course_id=? AND s.audio_url IS NOT NULL`
    ).get(req.courseId);
    checks.push({ key: 'has_audio', pass: audioCount.cnt > 0, detail: `${audioCount.cnt} slides with audio`, optional: true });

    const allRequired = checks.filter(c => !c.optional).every(c => c.pass);
    res.json({ checks, can_publish: allRequired });
  } catch (e) {
    console.error('[Training] publish-check:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/courses/:id/publish — with validation + notification
router.post('/courses/:id/publish', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const { force } = req.body || {};

    // Pre-publish check (unless forced)
    if (!force) {
      const lessonCount = await db.prepare('SELECT COUNT(*) AS cnt FROM course_lessons WHERE course_id=?').get(req.courseId);
      if (lessonCount.cnt === 0) return res.status(400).json({ error: '至少需要 1 個章節' });

      const slideCount = await db.prepare(
        'SELECT COUNT(*) AS cnt FROM course_slides s JOIN course_lessons cl ON cl.id=s.lesson_id WHERE cl.course_id=?'
      ).get(req.courseId);
      if (slideCount.cnt === 0) return res.status(400).json({ error: '至少需要 1 張投影片' });
    }

    await db.prepare(`UPDATE courses SET status='published', updated_at=SYSTIMESTAMP WHERE id=?`).run(req.courseId);

    // Notify shared users
    try {
      const course = await db.prepare('SELECT title FROM courses WHERE id=?').get(req.courseId);
      const accessRows = await db.prepare(
        `SELECT DISTINCT grantee_id FROM course_access WHERE course_id=? AND grantee_type='user'`
      ).all(req.courseId);
      for (const row of accessRows) {
        await db.prepare(`
          INSERT INTO training_notifications (user_id, type, title, message, course_id, link_url)
          VALUES (?, 'course_published', ?, ?, ?, ?)
        `).run(
          Number(row.grantee_id), `${course?.title || '課程'} 已發佈`,
          `課程「${course?.title}」已發佈，可以開始學習。`,
          req.courseId, `/training/course/${req.courseId}`
        );
      }
    } catch (notifErr) {
      console.error('[Training] publish notification:', notifErr.message);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[Training] publish:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/courses/:id/unpublish — revert to draft
router.post('/courses/:id/unpublish', loadCoursePermission, requirePermission('owner', 'admin'), async (req, res) => {
  try {
    await db.prepare(`UPDATE courses SET status='draft', updated_at=SYSTIMESTAMP WHERE id=?`).run(req.courseId);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Training] unpublish:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/courses/:id/archive
router.post('/courses/:id/archive', loadCoursePermission, requirePermission('owner', 'admin'), async (req, res) => {
  try {
    await db.prepare(`UPDATE courses SET status='archived', updated_at=SYSTIMESTAMP WHERE id=?`).run(req.courseId);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Training] archive:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/courses/:id/unarchive — restore from archived to draft
router.post('/courses/:id/unarchive', loadCoursePermission, requirePermission('owner', 'admin'), async (req, res) => {
  try {
    await db.prepare(`UPDATE courses SET status='draft', updated_at=SYSTIMESTAMP WHERE id=? AND status='archived'`).run(req.courseId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/training/courses/:id/duplicate
router.post('/courses/:id/duplicate', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const src = await db.prepare('SELECT * FROM courses WHERE id=?').get(req.courseId);
    if (!src) return res.status(404).json({ error: '課程不存在' });

    const result = await db.prepare(`
      INSERT INTO courses (title, description, category_id, created_by, pass_score, max_attempts, time_limit_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(`${src.title} (副本)`, src.description, src.category_id, req.user.id,
           src.pass_score, src.max_attempts, src.time_limit_minutes);
    const newCourseId = result.lastInsertRowid;

    // Copy lessons + slides
    const lessons = await db.prepare('SELECT * FROM course_lessons WHERE course_id=? ORDER BY sort_order').all(req.courseId);
    for (const lesson of lessons) {
      const lr = await db.prepare(
        `INSERT INTO course_lessons (course_id, title, sort_order, lesson_type) VALUES (?,?,?,?)`
      ).run(newCourseId, lesson.title, lesson.sort_order, lesson.lesson_type);
      const newLessonId = lr.lastInsertRowid;

      const slides = await db.prepare('SELECT * FROM course_slides WHERE lesson_id=? ORDER BY sort_order').all(lesson.id);
      for (const slide of slides) {
        await db.prepare(`
          INSERT INTO course_slides (lesson_id, sort_order, slide_type, content_json, notes, duration_seconds)
          VALUES (?,?,?,?,?,?)
        `).run(newLessonId, slide.sort_order, slide.slide_type, slide.content_json, slide.notes, slide.duration_seconds);
      }
    }

    // Copy quiz
    const questions = await db.prepare('SELECT * FROM quiz_questions WHERE course_id=? ORDER BY sort_order').all(req.courseId);
    for (const q of questions) {
      await db.prepare(`
        INSERT INTO quiz_questions (course_id, question_type, question_json, answer_json, scoring_json, points, explanation, sort_order)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(newCourseId, q.question_type, q.question_json, q.answer_json, q.scoring_json, q.points, q.explanation, q.sort_order);
    }

    res.json({ id: newCourseId });
  } catch (e) {
    console.error('[Training] duplicate:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/courses/:id/upload — generic image/file upload (returns URL only, no DB update)
router.post('/courses/:id/upload', loadCoursePermission, requirePermission('owner', 'admin', 'develop'),
  upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const relativePath = `/api/training/files/course_${req.courseId}/${req.file.filename}`;
    res.json({ url: relativePath });
  } catch (e) {
    console.error('[Training] upload file:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/courses/:id/cover — upload cover image
router.post('/courses/:id/cover', loadCoursePermission, requirePermission('owner', 'admin', 'develop'),
  upload.single('cover'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const relativePath = `/api/training/files/course_${req.courseId}/${req.file.filename}`;
    await db.prepare('UPDATE courses SET cover_image=?, updated_at=SYSTIMESTAMP WHERE id=?')
      .run(relativePath, req.courseId);
    res.json({ cover_image: relativePath });
  } catch (e) {
    console.error('[Training] upload cover:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Course Access (sharing)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/training/courses/:id/access
router.get('/courses/:id/access', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT ca.*, u.name AS granted_by_name
      FROM course_access ca
      LEFT JOIN users u ON u.id = ca.granted_by
      WHERE ca.course_id = ?
      ORDER BY ca.granted_at DESC
    `).all(req.courseId);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/courses/:id/access
router.post('/courses/:id/access', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const { grantee_type, grantee_id, permission } = req.body;
    if (!grantee_type || !grantee_id) return res.status(400).json({ error: 'grantee required' });

    const id = uuidv4();
    await db.prepare(`
      INSERT INTO course_access (id, course_id, grantee_type, grantee_id, permission, granted_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, req.courseId, grantee_type, grantee_id, permission || 'view', req.user.id);
    res.json({ id });
  } catch (e) {
    if (e.message?.includes('UQ_COURSE_ACCESS') || e.message?.includes('ORA-00001'))
      return res.status(409).json({ error: '已存在相同授權' });
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/training/courses/:id/access/:aid — update permission
router.put('/courses/:id/access/:aid', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const { permission } = req.body;
    await db.prepare('UPDATE course_access SET permission=? WHERE id=? AND course_id=?')
      .run(permission || 'view', req.params.aid, req.courseId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/training/courses/:id/access/:aid
router.delete('/courses/:id/access/:aid', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    await db.prepare('DELETE FROM course_access WHERE id=? AND course_id=?')
      .run(req.params.aid, req.courseId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/courses/:id/request-public
router.post('/courses/:id/request-public', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      await db.prepare('UPDATE courses SET is_public=1, updated_at=SYSTIMESTAMP WHERE id=?').run(req.courseId);
      return res.json({ is_public: 1, approved: true });
    }
    // Non-admin: could implement approval flow; for now auto-approve
    await db.prepare('UPDATE courses SET is_public=1, updated_at=SYSTIMESTAMP WHERE id=?').run(req.courseId);
    res.json({ is_public: 1 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lessons
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/training/courses/:id/lessons
router.get('/courses/:id/lessons', loadCoursePermission, async (req, res) => {
  try {
    const lessons = await db.prepare(
      'SELECT * FROM course_lessons WHERE course_id=? ORDER BY sort_order, id'
    ).all(req.courseId);

    // Merge lesson translations
    const lang = req.query.lang || 'zh-TW';
    if (lang !== 'zh-TW' && lessons.length > 0) {
      const placeholders = lessons.map(() => '?').join(',');
      const ltRows = await db.prepare(
        `SELECT lesson_id, title FROM lesson_translations WHERE lang=? AND lesson_id IN (${placeholders})`
      ).all(lang, ...lessons.map(l => l.id));
      const ltMap = {};
      for (const lt of ltRows) ltMap[lt.lesson_id] = lt.title;
      for (const l of lessons) {
        if (ltMap[l.id]) l.title = ltMap[l.id];
      }
    }

    res.json(lessons);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/courses/:id/lessons
router.post('/courses/:id/lessons', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const { title, lesson_type, sort_order } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });

    // Auto sort_order: max + 1
    let order = sort_order;
    if (order == null) {
      const max = await db.prepare('SELECT MAX(sort_order) AS mx FROM course_lessons WHERE course_id=?').get(req.courseId);
      order = (max?.mx || 0) + 1;
    }

    const result = await db.prepare(`
      INSERT INTO course_lessons (course_id, title, sort_order, lesson_type)
      VALUES (?, ?, ?, ?)
    `).run(req.courseId, title, order, lesson_type || 'slides');

    res.json({ id: result.lastInsertRowid, title, sort_order: order, lesson_type: lesson_type || 'slides' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/training/lessons/:lid
router.put('/lessons/:lid', async (req, res) => {
  try {
    const lesson = await db.prepare('SELECT course_id FROM course_lessons WHERE id=?').get(req.params.lid);
    if (!lesson) return res.status(404).json({ error: '章節不存在' });

    const perm = await canUserAccessCourse(lesson.course_id, req.user);
    if (!perm.access || !['owner', 'admin', 'develop'].includes(perm.permission))
      return res.status(403).json({ error: '權限不足' });

    const { title, lesson_type, sort_order } = req.body;
    await db.prepare(
      'UPDATE course_lessons SET title=?, lesson_type=?, sort_order=?, updated_at=SYSTIMESTAMP WHERE id=?'
    ).run(title, lesson_type, sort_order, req.params.lid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/training/lessons/:lid
router.delete('/lessons/:lid', async (req, res) => {
  try {
    const lesson = await db.prepare('SELECT course_id FROM course_lessons WHERE id=?').get(req.params.lid);
    if (!lesson) return res.status(404).json({ error: '章節不存在' });

    const perm = await canUserAccessCourse(lesson.course_id, req.user);
    if (!perm.access || !['owner', 'admin', 'develop'].includes(perm.permission))
      return res.status(403).json({ error: '權限不足' });

    await db.prepare('DELETE FROM course_slides WHERE lesson_id=?').run(req.params.lid);
    await db.prepare('DELETE FROM video_interactions WHERE lesson_id=?').run(req.params.lid);
    await db.prepare('DELETE FROM course_lessons WHERE id=?').run(req.params.lid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/training/courses/:id/lessons/reorder
router.put('/courses/:id/lessons/reorder', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const { order } = req.body; // [{ id, sort_order }]
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
    for (const item of order) {
      await db.prepare('UPDATE course_lessons SET sort_order=? WHERE id=? AND course_id=?')
        .run(item.sort_order, item.id, req.courseId);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Slides
// ═══════════════════════════════════════════════════════════════════════════════

// Helper: verify lesson belongs to an accessible course
async function verifyLessonAccess(lessonId, user, requireEdit = false, helpBypass = false) {
  const lesson = await db.prepare('SELECT course_id FROM course_lessons WHERE id=?').get(lessonId);
  if (!lesson) return { error: '章節不存在', status: 404 };
  if (helpBypass) return { lesson, permission: 'view', courseId: lesson.course_id };
  const perm = await canUserAccessCourse(lesson.course_id, user);
  if (!perm.access) return { error: '權限不足', status: 403 };
  if (requireEdit && !['owner', 'admin', 'develop'].includes(perm.permission))
    return { error: '權限不足', status: 403 };
  return { lesson, permission: perm.permission, courseId: lesson.course_id };
}

// GET /api/training/lessons/:lid/slides?lang=en&help=1
router.get('/lessons/:lid/slides', async (req, res) => {
  try {
    const check = await verifyLessonAccess(req.params.lid, req.user, false, req.query.help === '1');
    if (check.error) return res.status(check.status).json({ error: check.error });

    const lang = req.query.lang;
    const slides = await db.prepare(
      'SELECT * FROM course_slides WHERE lesson_id=? ORDER BY sort_order, id'
    ).all(req.params.lid);

    // If non-zh-TW language requested, merge translations + image overrides
    if (lang && lang !== 'zh-TW') {
      for (const slide of slides) {
        try {
          const trans = await db.prepare(
            'SELECT content_json, notes, audio_url, image_overrides, regions_json FROM slide_translations WHERE slide_id=? AND lang=?'
          ).get(slide.id, lang);
          if (trans) {
            if (trans.content_json) slide.content_json = trans.content_json;
            if (trans.notes) slide.notes = trans.notes;
            if (trans.audio_url) slide.audio_url = trans.audio_url;
            // Phase 3A-2: Apply image overrides + region overrides for this language
            if (trans.image_overrides) {
              try {
                const overrides = JSON.parse(trans.image_overrides);
                const blocks = JSON.parse(slide.content_json || '[]');
                let changed = false;
                // Image overrides: { "0": "/img/en_step1.png", ... }
                for (const [idx, val] of Object.entries(overrides)) {
                  if (idx === 'region_overrides') continue; // handled below
                  const block = blocks[Number(idx)];
                  if (block && typeof val === 'string') {
                    if (block.image) { block.image = val; changed = true; }
                    if (block.src) { block.src = val; changed = true; }
                  }
                }
                // Region overrides: { "region_overrides": { "r1": {x,y,w,h}, ... } }
                const regionOvr = overrides.region_overrides;
                if (regionOvr) {
                  for (const block of blocks) {
                    if (block.regions) {
                      block.regions = block.regions.map(r => {
                        const ovr = regionOvr[r.id];
                        return ovr ? { ...r, coords: { ...r.coords, ...ovr } } : r;
                      });
                      changed = true;
                    }
                  }
                }
                if (changed) slide.content_json = JSON.stringify(blocks);
              } catch {}
            }
            // Phase 3B: Independent language regions + intro audio take highest priority
            if (trans.regions_json) {
              try {
                const langRegions = JSON.parse(trans.regions_json);
                const blocks = JSON.parse(slide.content_json || '[]');
                let changed = false;
                for (const [idx, regs] of Object.entries(langRegions)) {
                  if (idx === '_intro') continue; // handled below
                  const block = blocks[Number(idx)];
                  if (block && Array.isArray(regs)) {
                    // Independent regions (regions_json) are the source of truth —
                    // they contain their own label/narration/audio set by LanguageImagePanel.
                    // Only fall back to translated content_json when a voice field is missing.
                    const transRegions = block.regions || [];
                    const voiceFields = ['narration', 'audio_url', 'test_hint', 'test_audio_url', 'explore_desc', 'explore_audio_url', 'feedback', 'feedback_wrong'];
                    for (const reg of regs) {
                      const transMatch = transRegions.find(tr => tr.id === reg.id);
                      if (transMatch) {
                        for (const vf of voiceFields) {
                          if (!reg[vf] && transMatch[vf]) reg[vf] = transMatch[vf];
                        }
                        // Fill label from translated content if not set in regions_json
                        if (!reg.label && transMatch.label) reg.label = transMatch.label;
                      }
                    }
                    block.regions = regs;
                    changed = true;
                  }
                }
                // Merge _intro (language-specific intro narrations) into hotspot blocks
                if (langRegions._intro) {
                  const intro = langRegions._intro;
                  for (const block of blocks) {
                    if (block.type === 'hotspot') {
                      const introFields = ['slide_narration', 'slide_narration_audio',
                        'slide_narration_test', 'slide_narration_test_audio',
                        'slide_narration_explore', 'slide_narration_explore_audio',
                        'completion_message'];
                      for (const f of introFields) {
                        if (intro[f]) { block[f] = intro[f]; changed = true; }
                      }
                    }
                  }
                }
                if (changed) slide.content_json = JSON.stringify(blocks);
              } catch {}
            }
          }
        } catch {}
      }
    }

    res.json(slides);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/lessons/:lid/slides
router.post('/lessons/:lid/slides', async (req, res) => {
  try {
    const check = await verifyLessonAccess(req.params.lid, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });

    const { slide_type, content_json, notes, duration_seconds, sort_order } = req.body;

    let order = sort_order;
    if (order == null) {
      const max = await db.prepare('SELECT MAX(sort_order) AS mx FROM course_slides WHERE lesson_id=?').get(req.params.lid);
      order = (max?.mx || 0) + 1;
    }

    const contentStr = typeof content_json === 'string' ? content_json : JSON.stringify(content_json || []);

    const result = await db.prepare(`
      INSERT INTO course_slides (lesson_id, sort_order, slide_type, content_json, notes, duration_seconds)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.params.lid, order, slide_type || 'content', contentStr, notes || null, duration_seconds || null);

    res.json({ id: result.lastInsertRowid, sort_order: order, slide_type: slide_type || 'content' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/slides/:sid
router.get('/slides/:sid', async (req, res) => {
  try {
    const slide = await db.prepare('SELECT * FROM course_slides WHERE id=?').get(req.params.sid);
    if (!slide) return res.status(404).json({ error: '投影片不存在' });
    const check = await verifyLessonAccess(slide.lesson_id, req.user);
    if (check.error) return res.status(check.status).json({ error: check.error });
    res.json(slide);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/training/slides/:sid
router.put('/slides/:sid', async (req, res) => {
  try {
    const slide = await db.prepare('SELECT lesson_id FROM course_slides WHERE id=?').get(req.params.sid);
    if (!slide) return res.status(404).json({ error: '投影片不存在' });

    const check = await verifyLessonAccess(slide.lesson_id, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });

    let { slide_type, content_json, notes, duration_seconds, sort_order } = req.body;
    const contentStr = typeof content_json === 'string' ? content_json : JSON.stringify(content_json);

    // Auto-detect slide_type from content_json if blocks contain hotspot
    if (contentStr) {
      try {
        const blocks = JSON.parse(contentStr);
        if (Array.isArray(blocks) && blocks.some(b => b.type === 'hotspot')) {
          slide_type = 'hotspot';
        }
      } catch {}
    }

    // Only update sort_order if explicitly provided (avoid nullifying it on content-only saves)
    if (sort_order !== undefined && sort_order !== null) {
      await db.prepare(`
        UPDATE course_slides SET slide_type=?, content_json=?, notes=?,
               duration_seconds=?, sort_order=?, updated_at=SYSTIMESTAMP
        WHERE id=?
      `).run(slide_type, contentStr, notes || null, duration_seconds || null, sort_order, req.params.sid);
    } else {
      await db.prepare(`
        UPDATE course_slides SET slide_type=?, content_json=?, notes=?,
               duration_seconds=?, updated_at=SYSTIMESTAMP
        WHERE id=?
      `).run(slide_type, contentStr, notes || null, duration_seconds || null, req.params.sid);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/training/slides/:sid
router.delete('/slides/:sid', async (req, res) => {
  try {
    const slide = await db.prepare('SELECT lesson_id FROM course_slides WHERE id=?').get(req.params.sid);
    if (!slide) return res.status(404).json({ error: '投影片不存在' });

    const check = await verifyLessonAccess(slide.lesson_id, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });

    await db.prepare('DELETE FROM slide_branches WHERE slide_id=?').run(req.params.sid);
    await db.prepare('DELETE FROM course_slides WHERE id=?').run(req.params.sid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/slides/:sid/duplicate — copy a slide
router.post('/slides/:sid/duplicate', async (req, res) => {
  try {
    const slide = await db.prepare(
      'SELECT lesson_id, slide_type, content_json, notes, duration_seconds, sort_order FROM course_slides WHERE id=?'
    ).get(req.params.sid);
    if (!slide) return res.status(404).json({ error: '投影片不存在' });

    const check = await verifyLessonAccess(slide.lesson_id, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });

    // Shift subsequent slides' sort_order to make room
    const insertOrder = (slide.sort_order || 0) + 1;
    await db.prepare(
      'UPDATE course_slides SET sort_order = sort_order + 1 WHERE lesson_id=? AND sort_order >= ?'
    ).run(slide.lesson_id, insertOrder);

    // Insert duplicate
    const result = await db.prepare(`
      INSERT INTO course_slides (lesson_id, slide_type, content_json, notes, duration_seconds, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      slide.lesson_id, slide.slide_type, slide.content_json,
      slide.notes ? slide.notes + ' (副本)' : '(副本)',
      slide.duration_seconds, insertOrder
    );

    const newId = result.lastInsertRowId || result.id;
    res.json({ ok: true, id: newId, sort_order: insertOrder });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/training/lessons/:lid/slides/reorder
router.put('/lessons/:lid/slides/reorder', async (req, res) => {
  try {
    const check = await verifyLessonAccess(req.params.lid, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });

    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
    for (const item of order) {
      await db.prepare('UPDATE course_slides SET sort_order=? WHERE id=? AND lesson_id=?')
        .run(item.sort_order, item.id, req.params.lid);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Slide Audio
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/training/slides/:sid/audio — upload audio
router.post('/slides/:sid/audio', upload.single('audio'), async (req, res) => {
  try {
    const slide = await db.prepare('SELECT lesson_id FROM course_slides WHERE id=?').get(req.params.sid);
    if (!slide) return res.status(404).json({ error: '投影片不存在' });
    const check = await verifyLessonAccess(slide.lesson_id, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });

    if (!req.file) return res.status(400).json({ error: 'No audio file' });
    const relativePath = `/api/training/files/course_${check.courseId}/${req.file.filename}`;
    await db.prepare('UPDATE course_slides SET audio_url=?, updated_at=SYSTIMESTAMP WHERE id=?')
      .run(relativePath, req.params.sid);

    let transcription = null;
    if (req.body.transcribe === 'true') {
      try {
        const { transcribeAudio } = require('../services/gemini');
        const result = await transcribeAudio(req.file.path, req.file.mimetype);
        transcription = result.text;
      } catch (e) {
        console.warn('[Training] STT failed:', e.message);
      }
    }

    res.json({ audio_url: relativePath, transcription });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── TTS Helper: resolve voice from course settings ──
// Pre-process text for TTS — fix common pronunciation issues
function preprocessTtsText(text) {
  if (!text) return text;
  return text
    // "AI" in Chinese context → "A I" with space so TTS reads both letters
    .replace(/\bAI\b/g, 'A.I.')
    .replace(/\bAPI\b/g, 'A.P.I.')
    .replace(/\bMCP\b/g, 'M.C.P.')
    .replace(/\bSSO\b/g, 'S.S.O.')
    .replace(/\bERP\b/g, 'E.R.P.')
    .replace(/\bGPT\b/g, 'G.P.T.')
    .replace(/\bLLM\b/g, 'L.L.M.')
    .replace(/\bUI\b/g, 'U.I.')
    .replace(/\bURL\b/g, 'U.R.L.')
}

async function resolveTtsVoice(courseId, language) {
  const voiceMap = {
    'zh-TW': { female: 'cmn-TW-Wavenet-A', male: 'cmn-TW-Wavenet-C' },
    'en':    { female: 'en-US-Wavenet-F', male: 'en-US-Wavenet-D' },
    'vi':    { female: 'vi-VN-Wavenet-A', male: 'vi-VN-Wavenet-B' },
  };
  let gender = 'female', speed = 1.0, pitch = 0;
  if (courseId) {
    try {
      const row = await db.prepare('SELECT settings_json FROM courses WHERE id=?').get(courseId);
      if (row?.settings_json) {
        const s = JSON.parse(row.settings_json);
        if (s.tts_voice_gender) gender = s.tts_voice_gender;
        if (s.tts_speed) speed = s.tts_speed;
        if (s.tts_pitch !== undefined) pitch = s.tts_pitch;
      }
    } catch {}
  }
  const lang = language || 'zh-TW';
  const voiceName = voiceMap[lang]?.[gender] || voiceMap['zh-TW'][gender];
  const langMap = { 'zh-TW': 'cmn-TW', 'en': 'en-US', 'vi': 'vi-VN' };
  return { voiceName, langCode: langMap[lang] || 'cmn-TW', speed, pitch };
}

// POST /api/training/slides/:sid/tts — generate TTS
router.post('/slides/:sid/tts', async (req, res) => {
  try {
    const slide = await db.prepare('SELECT lesson_id, notes FROM course_slides WHERE id=?').get(req.params.sid);
    if (!slide) return res.status(404).json({ error: '投影片不存在' });
    const check = await verifyLessonAccess(slide.lesson_id, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });

    const text = req.body.text || slide.notes;
    if (!text) return res.status(400).json({ error: '沒有旁白文字' });

    const ttsModel = await db.prepare(
      `SELECT api_model, api_key_enc FROM llm_models WHERE model_role='tts' AND is_active=1
       ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
    ).get();
    if (!ttsModel) return res.status(500).json({ error: 'TTS 模型未設定' });

    const { decryptKey } = require('../services/llmKeyService');
    const apiKey = decryptKey(ttsModel.api_key_enc);
    const language = req.body.language || 'zh-TW';
    const { voiceName, langCode, speed, pitch } = await resolveTtsVoice(check.courseId, language);

    const ttsUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;

    const ttsRes = await fetch(ttsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: preprocessTtsText(text) },
        voice: { languageCode: langCode, name: req.body.voice || voiceName },
        audioConfig: { audioEncoding: 'MP3', speakingRate: req.body.speakingRate || speed, pitch: req.body.pitch ?? pitch }
      })
    });

    if (!ttsRes.ok) {
      const err = await ttsRes.text();
      return res.status(500).json({ error: `TTS API error: ${err}` });
    }

    const ttsJson = await ttsRes.json();
    if (!ttsJson.audioContent) {
      console.error('[Training] TTS: API returned empty audioContent', { sid: req.params.sid, error: ttsJson.error });
      return res.status(500).json({ error: 'TTS API 回傳空的 audioContent' });
    }
    const audioBuffer = Buffer.from(ttsJson.audioContent, 'base64');
    if (audioBuffer.length < 100) return res.status(500).json({ error: 'TTS 回傳的音訊資料異常（太短）' });

    const filename = `tts_${req.params.sid}_${Date.now()}.mp3`;
    const dir = path.join(uploadDir, `course_${check.courseId}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, audioBuffer);

    const relativePath = `/api/training/files/course_${check.courseId}/${filename}`;
    await db.prepare('UPDATE course_slides SET audio_url=?, updated_at=SYSTIMESTAMP WHERE id=?')
      .run(relativePath, req.params.sid);

    res.json({ audio_url: relativePath });
  } catch (e) {
    console.error('[Training] TTS:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/slides/:sid/region-tts — generate TTS for individual regions
router.post('/slides/:sid/region-tts', async (req, res) => {
  try {
    const slide = await db.prepare('SELECT lesson_id, content_json FROM course_slides WHERE id=?').get(req.params.sid);
    if (!slide) return res.status(404).json({ error: '投影片不存在' });
    const check = await verifyLessonAccess(slide.lesson_id, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });

    const { block_index, region_id, text, language } = req.body;
    if (!text) return res.status(400).json({ error: '沒有語音文稿' });

    const ttsModel = await db.prepare(
      `SELECT api_model, api_key_enc FROM llm_models WHERE model_role='tts' AND is_active=1
       ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
    ).get();
    if (!ttsModel) return res.status(500).json({ error: 'TTS 模型未設定' });

    const { decryptKey } = require('../services/llmKeyService');
    const apiKey = decryptKey(ttsModel.api_key_enc);
    const lang = language || 'zh-TW';
    const { voiceName, langCode, speed, pitch } = await resolveTtsVoice(check.courseId, lang);

    const ttsUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
    const ttsRes = await fetch(ttsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: preprocessTtsText(text) },
        voice: { languageCode: langCode, name: voiceName },
        audioConfig: { audioEncoding: 'MP3', speakingRate: speed, pitch }
      })
    });
    if (!ttsRes.ok) {
      const err = await ttsRes.text();
      return res.status(500).json({ error: `TTS API error: ${err}` });
    }

    const ttsJson = await ttsRes.json();
    if (!ttsJson.audioContent) {
      console.error('[Training] Region TTS: empty audioContent', { region_id, lang });
      return res.status(500).json({ error: 'TTS API 回傳空的 audioContent' });
    }
    const audioBuffer = Buffer.from(ttsJson.audioContent, 'base64');
    if (audioBuffer.length < 100) return res.status(500).json({ error: 'TTS 回傳的音訊資料異常（太短）' });

    const filename = `tts_region_${region_id || 'r'}_${Date.now()}.mp3`;
    const dir = path.join(uploadDir, `course_${check.courseId}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), audioBuffer);

    const audioUrl = `/api/training/files/course_${check.courseId}/${filename}`;
    res.json({ audio_url: audioUrl });
  } catch (e) {
    console.error('[Training] Region TTS:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/training/slides/:sid/audio
router.delete('/slides/:sid/audio', async (req, res) => {
  try {
    const slide = await db.prepare('SELECT lesson_id, audio_url FROM course_slides WHERE id=?').get(req.params.sid);
    if (!slide) return res.status(404).json({ error: '投影片不存在' });
    const check = await verifyLessonAccess(slide.lesson_id, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });

    if (slide.audio_url) {
      const absPath = path.join(__dirname, '..', slide.audio_url);
      if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
    }
    await db.prepare('UPDATE course_slides SET audio_url=NULL, updated_at=SYSTIMESTAMP WHERE id=?')
      .run(req.params.sid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Video Interactions
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/lessons/:lid/video-interactions', async (req, res) => {
  try {
    const check = await verifyLessonAccess(req.params.lid, req.user);
    if (check.error) return res.status(check.status).json({ error: check.error });
    const rows = await db.prepare(
      'SELECT * FROM video_interactions WHERE lesson_id=? ORDER BY timestamp_seconds, sort_order'
    ).all(req.params.lid);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/lessons/:lid/video-interactions', async (req, res) => {
  try {
    const check = await verifyLessonAccess(req.params.lid, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });

    const { timestamp_seconds, interaction_type, content_json, must_answer, pause_video } = req.body;
    const contentStr = typeof content_json === 'string' ? content_json : JSON.stringify(content_json);

    const result = await db.prepare(`
      INSERT INTO video_interactions (lesson_id, timestamp_seconds, interaction_type, content_json, must_answer, pause_video)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.params.lid, timestamp_seconds, interaction_type, contentStr,
           must_answer != null ? must_answer : 1, pause_video != null ? pause_video : 1);
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/video-interactions/:vid', async (req, res) => {
  try {
    const vi = await db.prepare('SELECT lesson_id FROM video_interactions WHERE id=?').get(req.params.vid);
    if (!vi) return res.status(404).json({ error: '互動節點不存在' });
    const check = await verifyLessonAccess(vi.lesson_id, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });

    const { timestamp_seconds, interaction_type, content_json, must_answer, pause_video } = req.body;
    const contentStr = typeof content_json === 'string' ? content_json : JSON.stringify(content_json);
    await db.prepare(`
      UPDATE video_interactions SET timestamp_seconds=?, interaction_type=?, content_json=?,
             must_answer=?, pause_video=? WHERE id=?
    `).run(timestamp_seconds, interaction_type, contentStr, must_answer, pause_video, req.params.vid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/video-interactions/:vid', async (req, res) => {
  try {
    const vi = await db.prepare('SELECT lesson_id FROM video_interactions WHERE id=?').get(req.params.vid);
    if (!vi) return res.status(404).json({ error: '互動節點不存在' });
    const check = await verifyLessonAccess(vi.lesson_id, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });
    await db.prepare('DELETE FROM video_interactions WHERE id=?').run(req.params.vid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Quiz Questions
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/courses/:id/questions', loadCoursePermission, async (req, res) => {
  try {
    const rows = await db.prepare(
      'SELECT * FROM quiz_questions WHERE course_id=? ORDER BY sort_order, id'
    ).all(req.courseId);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/courses/:id/questions', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const { question_type, question_json, answer_json, scoring_json, points, explanation, sort_order } = req.body;
    const qStr = typeof question_json === 'string' ? question_json : JSON.stringify(question_json);
    const aStr = typeof answer_json === 'string' ? answer_json : JSON.stringify(answer_json);
    const sStr = scoring_json ? (typeof scoring_json === 'string' ? scoring_json : JSON.stringify(scoring_json)) : null;

    let order = sort_order;
    if (order == null) {
      const max = await db.prepare('SELECT MAX(sort_order) AS mx FROM quiz_questions WHERE course_id=?').get(req.courseId);
      order = (max?.mx || 0) + 1;
    }

    const result = await db.prepare(`
      INSERT INTO quiz_questions (course_id, question_type, question_json, answer_json, scoring_json, points, explanation, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.courseId, question_type, qStr, aStr, sStr, points || 10, explanation || null, order);
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/questions/:qid', async (req, res) => {
  try {
    const q = await db.prepare('SELECT course_id FROM quiz_questions WHERE id=?').get(req.params.qid);
    if (!q) return res.status(404).json({ error: '題目不存在' });
    const perm = await canUserAccessCourse(q.course_id, req.user);
    if (!perm.access || !['owner', 'admin', 'develop'].includes(perm.permission))
      return res.status(403).json({ error: '權限不足' });

    const { question_type, question_json, answer_json, scoring_json, points, explanation, sort_order } = req.body;
    const qStr = typeof question_json === 'string' ? question_json : JSON.stringify(question_json);
    const aStr = typeof answer_json === 'string' ? answer_json : JSON.stringify(answer_json);
    const sStr = scoring_json ? (typeof scoring_json === 'string' ? scoring_json : JSON.stringify(scoring_json)) : null;

    await db.prepare(`
      UPDATE quiz_questions SET question_type=?, question_json=?, answer_json=?,
             scoring_json=?, points=?, explanation=?, sort_order=?, updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(question_type, qStr, aStr, sStr, points, explanation, sort_order, req.params.qid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/questions/:qid', async (req, res) => {
  try {
    const q = await db.prepare('SELECT course_id FROM quiz_questions WHERE id=?').get(req.params.qid);
    if (!q) return res.status(404).json({ error: '題目不存在' });
    const perm = await canUserAccessCourse(q.course_id, req.user);
    if (!perm.access || !['owner', 'admin', 'develop'].includes(perm.permission))
      return res.status(403).json({ error: '權限不足' });
    await db.prepare('DELETE FROM quiz_questions WHERE id=?').run(req.params.qid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/training/courses/:id/questions/reorder
router.put('/courses/:id/questions/reorder', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
    for (const item of order) {
      await db.prepare('UPDATE quiz_questions SET sort_order=? WHERE id=? AND course_id=?')
        .run(item.sort_order, item.id, req.courseId);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// User Progress
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/training/courses/:id/progress — update progress
router.post('/courses/:id/progress', loadCoursePermission, async (req, res) => {
  try {
    const { lesson_id, current_slide_index, status, time_spent_seconds } = req.body;

    const lid = lesson_id || null;
    const existing = await db.prepare(
      lid ? 'SELECT id FROM user_course_progress WHERE user_id=? AND course_id=? AND lesson_id=?'
          : 'SELECT id FROM user_course_progress WHERE user_id=? AND course_id=? AND lesson_id IS NULL'
    ).get(...(lid ? [req.user.id, req.courseId, lid] : [req.user.id, req.courseId]));

    if (existing) {
      await db.prepare(`
        UPDATE user_course_progress SET current_slide_index=?, status=?,
               time_spent_seconds=COALESCE(time_spent_seconds,0)+?,
               started_at=COALESCE(started_at, SYSTIMESTAMP),
               completed_at=CASE WHEN ?='completed' THEN SYSTIMESTAMP ELSE completed_at END
        WHERE id=?
      `).run(current_slide_index || 0, status || 'in_progress',
             time_spent_seconds || 0, status || 'in_progress', existing.id);
    } else {
      await db.prepare(`
        INSERT INTO user_course_progress (user_id, course_id, lesson_id, current_slide_index, status, time_spent_seconds, started_at)
        VALUES (?, ?, ?, ?, ?, ?, SYSTIMESTAMP)
      `).run(req.user.id, req.courseId, lesson_id || null, current_slide_index || 0,
             status || 'in_progress', time_spent_seconds || 0);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[Progress] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/my-progress
router.get('/my-progress', async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT ucp.*, c.title AS course_title, c.status AS course_status
      FROM user_course_progress ucp
      JOIN courses c ON c.id = ucp.course_id
      WHERE ucp.user_id = ?
      ORDER BY ucp.started_at DESC NULLS LAST
    `).all(req.user.id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/courses/:id/my-progress
router.get('/courses/:id/my-progress', loadCoursePermission, async (req, res) => {
  try {
    const rows = await db.prepare(
      'SELECT * FROM user_course_progress WHERE user_id=? AND course_id=?'
    ).all(req.user.id, req.courseId);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// User Notes & Bookmarks
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/courses/:id/my-notes', loadCoursePermission, async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT n.*, cs.sort_order AS slide_order, cl.title AS lesson_title, cl.sort_order AS lesson_order
      FROM user_course_notes n
      LEFT JOIN course_slides cs ON cs.id = n.slide_id
      LEFT JOIN course_lessons cl ON cl.id = cs.lesson_id
      WHERE n.user_id=? AND n.course_id=?
      ORDER BY cl.sort_order, cs.sort_order
    `).all(req.user.id, req.courseId);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/notes', async (req, res) => {
  try {
    const { course_id, slide_id, content, bookmarked } = req.body;
    const existing = await db.prepare(
      'SELECT id FROM user_course_notes WHERE user_id=? AND slide_id=?'
    ).get(req.user.id, slide_id);

    if (existing) {
      await db.prepare(
        'UPDATE user_course_notes SET content=?, bookmarked=?, updated_at=SYSTIMESTAMP WHERE id=?'
      ).run(content || null, bookmarked ? 1 : 0, existing.id);
      res.json({ id: existing.id });
    } else {
      const result = await db.prepare(`
        INSERT INTO user_course_notes (user_id, course_id, slide_id, content, bookmarked)
        VALUES (?, ?, ?, ?, ?)
      `).run(req.user.id, course_id, slide_id, content || null, bookmarked ? 1 : 0);
      res.json({ id: result.lastInsertRowid });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/notes/:nid', async (req, res) => {
  try {
    await db.prepare('DELETE FROM user_course_notes WHERE id=? AND user_id=?')
      .run(req.params.nid, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Exam Topics
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/training/courses/:id/exam-topics
router.get('/courses/:id/exam-topics', loadCoursePermission, async (req, res) => {
  try {
    const topics = await db.prepare('SELECT * FROM exam_topics WHERE course_id=? ORDER BY sort_order, id').all(req.courseId);
    for (const t of topics) {
      t.lessons = await db.prepare(
        'SELECT etl.lesson_id, etl.sort_order, cl.title FROM exam_topic_lessons etl JOIN course_lessons cl ON cl.id=etl.lesson_id WHERE etl.exam_topic_id=? ORDER BY etl.sort_order'
      ).all(t.id);
      try { t.custom_weights = JSON.parse(t.custom_weights || '{}'); } catch { t.custom_weights = {}; }
    }
    res.json(topics);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/training/courses/:id/exam-topics
router.post('/courses/:id/exam-topics', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const { title, description, lesson_ids, total_score, pass_score, time_limit_minutes,
            time_limit_enabled, overtime_action, scoring_mode, custom_weights } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title required' });

    const result = await db.prepare(`
      INSERT INTO exam_topics (course_id, title, description, total_score, pass_score, time_limit_minutes,
        time_limit_enabled, overtime_action, scoring_mode, custom_weights, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.courseId, title.trim(), description || null, total_score || 100, pass_score || 60,
      time_limit_minutes || 10, time_limit_enabled === false ? 0 : 1,
      overtime_action || 'auto_submit', scoring_mode || 'even',
      custom_weights ? JSON.stringify(custom_weights) : null, req.user.id);

    const topicId = result.lastInsertRowid;
    if (Array.isArray(lesson_ids)) {
      for (let i = 0; i < lesson_ids.length; i++) {
        await db.prepare('INSERT INTO exam_topic_lessons (exam_topic_id, lesson_id, sort_order) VALUES (?, ?, ?)')
          .run(topicId, lesson_ids[i], i);
      }
    }
    res.json({ id: topicId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/training/exam-topics/:tid
router.put('/exam-topics/:tid', async (req, res) => {
  try {
    const topic = await db.prepare('SELECT course_id FROM exam_topics WHERE id=?').get(req.params.tid);
    if (!topic) return res.status(404).json({ error: 'Not found' });

    const { title, description, lesson_ids, total_score, pass_score, time_limit_minutes,
            time_limit_enabled, overtime_action, scoring_mode, custom_weights } = req.body;

    await db.prepare(`
      UPDATE exam_topics SET title=?, description=?, total_score=?, pass_score=?, time_limit_minutes=?,
        time_limit_enabled=?, overtime_action=?, scoring_mode=?, custom_weights=?
      WHERE id=?
    `).run(title, description || null, total_score || 100, pass_score || 60,
      time_limit_minutes || 10, time_limit_enabled === false ? 0 : 1,
      overtime_action || 'auto_submit', scoring_mode || 'even',
      custom_weights ? JSON.stringify(custom_weights) : null, req.params.tid);

    // Rebuild lesson associations
    if (Array.isArray(lesson_ids)) {
      await db.prepare('DELETE FROM exam_topic_lessons WHERE exam_topic_id=?').run(req.params.tid);
      for (let i = 0; i < lesson_ids.length; i++) {
        await db.prepare('INSERT INTO exam_topic_lessons (exam_topic_id, lesson_id, sort_order) VALUES (?, ?, ?)')
          .run(req.params.tid, lesson_ids[i], i);
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/training/exam-topics/:tid
router.delete('/exam-topics/:tid', async (req, res) => {
  try {
    await db.prepare('DELETE FROM exam_topic_lessons WHERE exam_topic_id=?').run(req.params.tid);
    await db.prepare('DELETE FROM exam_topics WHERE id=?').run(req.params.tid);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Interaction Results (Hotspot / DragDrop / QuizInline)
// ═══════════════════════════════════════════════════════════════════════════════

const { scoreHotspot, scoreDragDrop, scoreQuizInline } = require('../services/interactionScorer');

// POST /api/training/slides/:sid/interaction-result
router.post('/slides/:sid/interaction-result', async (req, res) => {
  try {
    const slideId = Number(req.params.sid);
    const slide = await db.prepare(
      'SELECT s.id, s.lesson_id, cl.course_id FROM course_slides s JOIN course_lessons cl ON cl.id=s.lesson_id WHERE s.id=?'
    ).get(slideId);
    if (!slide) return res.status(404).json({ error: 'Slide not found' });

    const { block_index, block_type, player_mode, action_log, total_time_seconds,
            steps_completed, total_steps, wrong_clicks,
            interaction_mode, user_answer, correct_answer, mode: ddMode,
            question_type, points, session_id, exam_topic_id,
            weighted_max: reqWeightedMax } = req.body;

    // Load course scoring config
    const course = await db.prepare('SELECT settings_json FROM courses WHERE id=?').get(slide.course_id);
    let scoringConfig = null;
    try {
      const settings = typeof course?.settings_json === 'string' ? JSON.parse(course.settings_json) : course?.settings_json;
      scoringConfig = settings?.scoring || null;
    } catch {}

    let result;
    if (block_type === 'hotspot') {
      result = scoreHotspot({ action_log, total_steps, steps_completed, wrong_clicks, total_time_seconds, interaction_mode }, scoringConfig);
    } else if (block_type === 'dragdrop') {
      result = scoreDragDrop({ mode: ddMode, user_answer, correct_answer, total_time_seconds }, scoringConfig);
    } else if (block_type === 'quiz_inline') {
      result = scoreQuizInline({ question_type, user_answer, correct_answer, points }, scoringConfig);
    } else {
      result = { score: 0, max_score: 0, breakdown: {} };
    }

    await db.prepare(`
      INSERT INTO interaction_results
        (user_id, slide_id, course_id, block_index, block_type, player_mode,
         action_log, total_time_seconds, steps_completed, total_steps, wrong_clicks,
         score, max_score, score_breakdown, session_id, exam_topic_id,
         weighted_score, weighted_max)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id, slideId, slide.course_id,
      block_index || 0, block_type || null, player_mode || null,
      JSON.stringify(action_log || []), total_time_seconds || 0,
      steps_completed || 0, total_steps || 0, wrong_clicks || 0,
      result.score, result.max_score, JSON.stringify(result.breakdown),
      session_id || null, exam_topic_id || null,
      reqWeightedMax ? Math.round((result.max_score > 0 ? result.score / result.max_score : 0) * reqWeightedMax) : null,
      reqWeightedMax ?? null
    );

    res.json({ ok: true, score: result.score, max_score: result.max_score, score_breakdown: result.breakdown });
  } catch (e) {
    console.error('[Training] interaction-result:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Quiz: Start & Submit
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/courses/:id/quiz/start', loadCoursePermission, async (req, res) => {
  try {
    // Count existing attempts
    const count = await db.prepare(
      'SELECT COUNT(*) AS cnt FROM quiz_attempts WHERE course_id=? AND user_id=?'
    ).get(req.courseId, req.user.id);
    const attemptNum = (count?.cnt || 0) + 1;

    // Check max attempts
    const course = await db.prepare('SELECT max_attempts FROM courses WHERE id=?').get(req.courseId);
    if (course?.max_attempts && attemptNum > course.max_attempts)
      return res.status(400).json({ error: `已達最大測驗次數 (${course.max_attempts})` });

    const result = await db.prepare(`
      INSERT INTO quiz_attempts (course_id, user_id, attempt_number)
      VALUES (?, ?, ?)
    `).run(req.courseId, req.user.id, attemptNum);
    res.json({ attempt_id: result.lastInsertRowid, attempt_number: attemptNum });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/courses/:id/quiz/submit', loadCoursePermission, async (req, res) => {
  try {
    const { answers } = req.body; // { questionId: userAnswer }
    const questions = await db.prepare(
      'SELECT * FROM quiz_questions WHERE course_id=? ORDER BY sort_order'
    ).all(req.courseId);

    let totalScore = 0;
    let totalPoints = 0;
    const detailedAnswers = [];

    for (const q of questions) {
      const correctAnswer = JSON.parse(q.answer_json);
      const scoringRule = q.scoring_json ? JSON.parse(q.scoring_json) : { mode: 'exact' };
      const userAnswer = answers?.[q.id];
      totalPoints += q.points;

      let earned = 0;
      if (userAnswer !== undefined && userAnswer !== null) {
        earned = scoreQuestion(q.question_type, correctAnswer, userAnswer, scoringRule, q.points);
      }
      totalScore += earned;

      detailedAnswers.push({
        question_id: q.id,
        user_answer: userAnswer,
        earned,
        max: q.points,
        correct: earned >= q.points
      });
    }

    const course = await db.prepare('SELECT pass_score FROM courses WHERE id=?').get(req.courseId);
    const passScore = course?.pass_score || 60;
    const percent = totalPoints > 0 ? (totalScore / totalPoints) * 100 : 0;
    const passed = percent >= passScore ? 1 : 0;

    // Update the latest attempt
    await db.prepare(`
      UPDATE quiz_attempts SET score=?, total_points=?, passed=?,
             answers_json=?, completed_at=SYSTIMESTAMP
      WHERE course_id=? AND user_id=? AND completed_at IS NULL
      AND ROWNUM=1
    `).run(totalScore, totalPoints, passed, JSON.stringify(detailedAnswers),
           req.courseId, req.user.id);

    // Update progress if passed
    if (passed) {
      const existing = await db.prepare(
        'SELECT id FROM user_course_progress WHERE user_id=? AND course_id=? AND lesson_id IS NULL'
      ).get(req.user.id, req.courseId);
      if (existing) {
        await db.prepare(`UPDATE user_course_progress SET status='completed', completed_at=SYSTIMESTAMP WHERE id=?`)
          .run(existing.id);
      } else {
        await db.prepare(`
          INSERT INTO user_course_progress (user_id, course_id, status, completed_at)
          VALUES (?, ?, 'completed', SYSTIMESTAMP)
        `).run(req.user.id, req.courseId);
      }
    }

    res.json({ score: totalScore, total_points: totalPoints, passed: !!passed, details: detailedAnswers });
  } catch (e) {
    console.error('[Training] quiz submit:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Scoring engine
function scoreQuestion(type, correctAnswer, userAnswer, rule, maxPoints) {
  const mode = rule.mode || 'exact';

  switch (type) {
    case 'single_choice':
      return userAnswer === correctAnswer.correct ? maxPoints : 0;

    case 'multi_choice': {
      const correctSet = new Set(correctAnswer.correct || []);
      const userSet = new Set(Array.isArray(userAnswer) ? userAnswer : []);
      if (mode === 'partial' || rule.partial_credit) {
        let correct = 0, wrong = 0;
        for (const u of userSet) { correctSet.has(u) ? correct++ : wrong++; }
        const penalty = (rule.wrong_penalty || 0) * wrong;
        const score = (correct / correctSet.size) * maxPoints + penalty;
        return Math.max(rule.min_score || 0, Math.min(score, maxPoints));
      }
      // exact
      if (userSet.size !== correctSet.size) return 0;
      for (const u of userSet) { if (!correctSet.has(u)) return 0; }
      return maxPoints;
    }

    case 'fill_blank': {
      const accepts = correctAnswer.correct || [];
      const caseSensitive = correctAnswer.case_sensitive ?? false;
      const ua = (userAnswer || '').trim();
      const match = accepts.some(a =>
        caseSensitive ? a.trim() === ua : a.trim().toLowerCase() === ua.toLowerCase()
      );
      return match ? maxPoints : 0;
    }

    case 'matching': {
      const pairs = correctAnswer.correct_pairs || [];
      if (!userAnswer || typeof userAnswer !== 'object') return 0;
      let correct = 0;
      for (const [itemIdx, targetIdx] of pairs) {
        if (Number(userAnswer[itemIdx]) === targetIdx) correct++;
      }
      if (mode === 'partial') return Math.round((correct / pairs.length) * maxPoints);
      return correct === pairs.length ? maxPoints : 0;
    }

    case 'ordering': {
      const correctOrder = correctAnswer.correct_order || [];
      const userOrder = typeof userAnswer === 'string'
        ? userAnswer.split(',').map(s => Number(s.trim()))
        : (Array.isArray(userAnswer) ? userAnswer : []);
      if (mode === 'partial') {
        let correct = 0;
        for (let i = 0; i < correctOrder.length; i++) {
          if (userOrder[i] === correctOrder[i]) correct++;
        }
        return Math.round((correct / correctOrder.length) * maxPoints);
      }
      return JSON.stringify(userOrder) === JSON.stringify(correctOrder) ? maxPoints : 0;
    }

    default:
      return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI Quiz Generation
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/courses/:id/ai-generate-quiz', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const { question_count, question_types, difficulty, model_key } = req.body;

    // Gather all slide content
    const lessons = await db.prepare('SELECT id FROM course_lessons WHERE course_id=?').all(req.courseId);
    let content = '';
    for (const l of lessons) {
      const slides = await db.prepare('SELECT content_json, notes FROM course_slides WHERE lesson_id=?').all(l.id);
      for (const s of slides) {
        try {
          const blocks = JSON.parse(s.content_json || '[]');
          for (const b of blocks) {
            if (b.content) content += b.content + '\n';
            if (b.text) content += b.text + '\n';
            if (b.instruction) content += b.instruction + '\n';
            if (b.scenario) content += b.scenario + '\n';
          }
        } catch {}
        if (s.notes) content += s.notes + '\n';
      }
    }

    if (!content.trim()) return res.status(400).json({ error: '課程內容為空，無法出題' });

    // Use Gemini to generate
    const { streamChat } = require('../services/gemini');
    const prompt = `你是一位教育訓練測驗出題專家。根據以下教材內容，生成 ${question_count || 10} 道測驗題目。

要求：
1. 題目必須基於教材內容
2. 難度等級: ${difficulty || 'medium'}
3. 題型: ${(question_types || ['single_choice', 'multi_choice']).join(', ')}
4. 每題附上正確答案和解析
5. 回傳純 JSON 陣列

教材內容：
---
${content.slice(0, 8000)}
---

回傳格式（純 JSON，不要 markdown）：
[{
  "question_type": "single_choice",
  "question_json": { "text": "題目", "options": ["A", "B", "C", "D"] },
  "answer_json": { "correct": 0 },
  "scoring_json": { "mode": "exact", "full_score": 10 },
  "explanation": "解析",
  "points": 10
}]`;

    const key = model_key || 'flash';
    const modelRow = await db.prepare(
      `SELECT api_model FROM llm_models WHERE key=? AND is_active=1`
    ).get(key);

    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: modelRow?.api_model || 'gemini-2.0-flash' });
    let questions, lastRaw = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        lastRaw = text;
        const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
        questions = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(cleaned);
        break;
      } catch (parseErr) {
        console.warn(`[Training] AI quiz attempt ${attempt + 1} failed:`, parseErr.message);
        if (attempt === 2) return res.status(500).json({ error: 'AI 回覆格式錯誤（已重試 3 次）', raw: lastRaw.slice(0, 500) });
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    res.json({ questions });
  } catch (e) {
    console.error('[Training] AI generate quiz:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AI Tutor
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/courses/:id/ai-tutor', loadCoursePermission, async (req, res) => {
  try {
    const { message, lesson_id, slide_id } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    // Get slide context
    let slideContent = '';
    if (slide_id) {
      const slide = await db.prepare('SELECT content_json, notes FROM course_slides WHERE id=?').get(slide_id);
      if (slide) {
        try {
          const blocks = JSON.parse(slide.content_json || '[]');
          slideContent = blocks.map(b => b.content || b.text || b.instruction || '').filter(Boolean).join('\n');
        } catch {}
        if (slide.notes) slideContent += '\n' + slide.notes;
      }
    }

    const course = await db.prepare('SELECT title, description FROM courses WHERE id=?').get(req.courseId);
    const systemPrompt = `你是 Cortex 教育訓練平台的 AI 助教。
學員正在學習課程「${course?.title || ''}」。
${slideContent ? `\n當前投影片內容：\n${slideContent}\n` : ''}
規則：
1. 只根據課程內容回答
2. 回答要簡潔
3. 用繁體中文回答`;

    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const flashModel = await db.prepare(
      `SELECT api_model FROM llm_models WHERE model_role='chat' AND is_active=1 AND provider_type='gemini' ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
    ).get();
    const model = genAI.getGenerativeModel({ model: flashModel?.api_model || 'gemini-2.0-flash' });
    const result = await model.generateContent([
      { text: systemPrompt },
      { text: message }
    ]);
    const answer = result.response.text();
    const usage = result.response.usageMetadata || {};

    // Log conversation
    await db.prepare(`
      INSERT INTO tutor_conversations (course_id, lesson_id, slide_id, user_id, question, answer, model_key, input_tokens, output_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.courseId, lesson_id || null, slide_id || null, req.user.id,
           message, answer, 'flash', usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);

    res.json({ answer });
  } catch (e) {
    console.error('[Training] AI tutor:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Learning Paths
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/paths', async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT lp.*, u.name AS creator_name,
             (SELECT COUNT(*) FROM learning_path_courses WHERE path_id=lp.id) AS course_count
      FROM learning_paths lp
      LEFT JOIN users u ON u.id = lp.created_by
      ORDER BY lp.updated_at DESC
    `).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/paths', async (req, res) => {
  try {
    const { title, description } = req.body;
    const result = await db.prepare(
      'INSERT INTO learning_paths (title, description, created_by) VALUES (?,?,?)'
    ).run(title, description || null, req.user.id);
    res.json({ id: result.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/paths/:id', async (req, res) => {
  try {
    const path = await db.prepare('SELECT * FROM learning_paths WHERE id=?').get(req.params.id);
    if (!path) return res.status(404).json({ error: '學習路徑不存在' });
    const courses = await db.prepare(`
      SELECT lpc.*, c.title AS course_title, c.status AS course_status
      FROM learning_path_courses lpc
      JOIN courses c ON c.id = lpc.course_id
      WHERE lpc.path_id = ?
      ORDER BY lpc.sort_order
    `).all(req.params.id);
    res.json({ ...path, courses });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/paths/:id/courses', async (req, res) => {
  try {
    const { course_id, is_required, prerequisite_course_id } = req.body;
    const max = await db.prepare('SELECT MAX(sort_order) AS mx FROM learning_path_courses WHERE path_id=?').get(req.params.id);
    const result = await db.prepare(`
      INSERT INTO learning_path_courses (path_id, course_id, sort_order, is_required, prerequisite_course_id)
      VALUES (?,?,?,?,?)
    `).run(req.params.id, course_id, (max?.mx || 0) + 1, is_required ?? 1, prerequisite_course_id || null);
    res.json({ id: result.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/paths/:id/courses/:cid', async (req, res) => {
  try {
    await db.prepare('DELETE FROM learning_path_courses WHERE path_id=? AND course_id=?')
      .run(req.params.id, req.params.cid);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Training Programs
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/programs', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    // All publish/publish_edit users can see all programs (for collaboration)
    const includeArchived = req.query.status === 'archived'
    const statusFilter = req.query.status && req.query.status !== 'archived' ? req.query.status : null
    const rows = await db.prepare(`
      SELECT tp.*, u.name AS creator_name,
             (SELECT COUNT(*) FROM program_courses pc WHERE pc.program_id = tp.id) AS course_count,
             (SELECT COUNT(DISTINCT pa.user_id) FROM program_assignments pa WHERE pa.program_id = tp.id) AS target_user_count
      FROM training_programs tp
      LEFT JOIN users u ON u.id = tp.created_by
      ${includeArchived ? "WHERE tp.status = 'archived'" : statusFilter ? 'WHERE tp.status = ?' : "WHERE tp.status != 'archived'"}
      ORDER BY tp.created_at DESC
    `).all(...(statusFilter ? [statusFilter] : []));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/programs', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    const { title, description, purpose, start_date, end_date, learning_path_id,
            remind_before_days, email_enabled } = req.body;
    const result = await db.prepare(`
      INSERT INTO training_programs (title, description, purpose, created_by, start_date, end_date,
                                     learning_path_id, remind_before_days, email_enabled)
      VALUES (?,?,?,?, TO_DATE(?,'YYYY-MM-DD'), TO_DATE(?,'YYYY-MM-DD'), ?,?,?)
    `).run(title, description || null, purpose || null, req.user.id,
           start_date, end_date, learning_path_id || null,
           remind_before_days || 3, email_enabled ?? 1);
    res.json({ id: result.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/programs/:id', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    const program = await db.prepare('SELECT * FROM training_programs WHERE id=?').get(req.params.id);
    if (!program) return res.status(404).json({ error: '培訓專案不存在' });

    const targets = await db.prepare('SELECT * FROM program_targets WHERE program_id=?').all(req.params.id);
    // Resolve target labels
    for (const t of targets) {
      if (t.target_type === 'public') {
        t.target_label = 'all';
      } else if (t.target_type === 'user') {
        const u = await db.prepare('SELECT name, employee_id FROM users WHERE id=?').get(Number(t.target_id));
        t.target_label = u ? `${u.name}${u.employee_id ? ' (' + u.employee_id + ')' : ''}` : t.target_id;
      } else if (t.target_type === 'role') {
        const r = await db.prepare('SELECT name FROM roles WHERE id=?').get(Number(t.target_id));
        t.target_label = r?.name || t.target_id;
      } else if (t.target_type === 'dept' || t.target_type === 'department') {
        const d = await db.prepare('SELECT dept_name FROM (SELECT DISTINCT dept_code, dept_name FROM users WHERE dept_code=?) WHERE ROWNUM=1').get(t.target_id);
        t.target_label = d?.dept_name ? `${d.dept_name} (${t.target_id})` : t.target_id;
      } else if (t.target_type === 'cost_center') {
        const d = await db.prepare('SELECT profit_center_name FROM (SELECT DISTINCT profit_center_code, profit_center_name FROM users WHERE profit_center_code=?) WHERE ROWNUM=1').get(t.target_id);
        t.target_label = d?.profit_center_name ? `${d.profit_center_name} (${t.target_id})` : t.target_id;
      } else if (t.target_type === 'division') {
        const d = await db.prepare('SELECT org_section_name FROM (SELECT DISTINCT org_section, org_section_name FROM users WHERE org_section=?) WHERE ROWNUM=1').get(t.target_id);
        t.target_label = d?.org_section_name ? `${d.org_section_name} (${t.target_id})` : t.target_id;
      } else if (t.target_type === 'org_group') {
        t.target_label = t.target_id;
      } else {
        t.target_label = t.target_id;
      }
    }
    const coursesRaw = await db.prepare(`
      SELECT pc.id, pc.program_id, pc.course_id, pc.sort_order, pc.is_required, pc.lesson_ids, pc.exam_config,
             c.title AS course_title
      FROM program_courses pc JOIN courses c ON c.id = pc.course_id
      WHERE pc.program_id = ? ORDER BY pc.sort_order
    `).all(req.params.id);
    // Parse lesson_ids + exam_config CLOB to objects
    const courses = coursesRaw.map(c => ({
      ...c,
      lesson_ids: c.lesson_ids ? (typeof c.lesson_ids === 'string' ? JSON.parse(c.lesson_ids) : c.lesson_ids) : null,
      exam_config: c.exam_config ? (typeof c.exam_config === 'string' ? JSON.parse(c.exam_config) : c.exam_config) : null
    }));
    const assignmentStats = await db.prepare(`
      SELECT status, COUNT(*) AS cnt FROM program_assignments WHERE program_id=? GROUP BY status
    `).all(req.params.id);

    res.json({ ...program, targets, courses, assignment_stats: assignmentStats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/training/programs/:id/targets
router.post('/programs/:id/targets', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    const { target_type, target_id } = req.body;
    const result = await db.prepare(
      'INSERT INTO program_targets (program_id, target_type, target_id) VALUES (?,?,?)'
    ).run(req.params.id, target_type, target_id);
    res.json({ id: result.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/training/programs/:id/courses
router.post('/programs/:id/courses', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    const { course_id, is_required, lesson_ids } = req.body;
    const max = await db.prepare('SELECT MAX(sort_order) AS mx FROM program_courses WHERE program_id=?').get(req.params.id);
    const lessonIdsJson = lesson_ids && lesson_ids.length > 0 ? JSON.stringify(lesson_ids) : null;
    const result = await db.prepare(
      'INSERT INTO program_courses (program_id, course_id, sort_order, is_required, lesson_ids) VALUES (?,?,?,?,?)'
    ).run(req.params.id, course_id, (max?.mx || 0) + 1, is_required ?? 1, lessonIdsJson);
    res.json({ id: result.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/training/programs/:id/courses/:cid/lessons — update lesson selection + exam config
router.put('/programs/:id/courses/:cid/lessons', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    const { lesson_ids, exam_config } = req.body;
    const lessonIdsJson = lesson_ids && lesson_ids.length > 0 ? JSON.stringify(lesson_ids) : null;
    const examConfigJson = exam_config ? JSON.stringify(exam_config) : null;
    await db.prepare('UPDATE program_courses SET lesson_ids=?, exam_config=? WHERE id=? AND program_id=?')
      .run(lessonIdsJson, examConfigJson, req.params.cid, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/training/programs/:id — update program
router.put('/programs/:id', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    const { title, description, purpose, start_date, end_date,
            remind_before_days, email_enabled, notify_overdue,
            program_pass_score, sequential_lessons } = req.body;
    await db.prepare(`
      UPDATE training_programs
      SET title=?, description=?, purpose=?,
          start_date=TO_DATE(?,'YYYY-MM-DD'), end_date=TO_DATE(?,'YYYY-MM-DD'),
          remind_before_days=?, email_enabled=?, notify_overdue=?,
          program_pass_score=?, sequential_lessons=?,
          updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(title, description || null, purpose || null,
           start_date, end_date,
           remind_before_days ?? 3, email_enabled ?? 1, notify_overdue ?? 1,
           program_pass_score ?? 60, sequential_lessons ?? 0,
           req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/training/programs/:id — delete program (draft only)
router.delete('/programs/:id', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    const prog = await db.prepare('SELECT status FROM training_programs WHERE id=?').get(req.params.id);
    if (!prog) return res.status(404).json({ error: '專案不存在' });
    if (prog.status !== 'draft' && prog.status !== 'completed') {
      return res.status(400).json({ error: '只能刪除草稿或已結束的專案' });
    }
    await db.prepare('DELETE FROM program_assignments WHERE program_id=?').run(req.params.id);
    await db.prepare('DELETE FROM program_targets WHERE program_id=?').run(req.params.id);
    await db.prepare('DELETE FROM program_courses WHERE program_id=?').run(req.params.id);
    await db.prepare('DELETE FROM training_programs WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/training/programs/:id/targets/:tid
router.delete('/programs/:id/targets/:tid', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    await db.prepare('DELETE FROM program_targets WHERE id=? AND program_id=?')
      .run(req.params.tid, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/training/programs/:id/courses/:cid
router.delete('/programs/:id/courses/:cid', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    await db.prepare('DELETE FROM program_courses WHERE id=? AND program_id=?')
      .run(req.params.cid, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/training/programs/:id/pause
router.put('/programs/:id/pause', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    await db.prepare(`UPDATE training_programs SET status='paused', paused_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP WHERE id=? AND status='active'`)
      .run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/training/programs/:id/resume
router.put('/programs/:id/resume', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    await db.prepare(`UPDATE training_programs SET status='active', updated_at=SYSTIMESTAMP WHERE id=? AND status='paused'`)
      .run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/training/programs/:id/deactivate — 下架（改回 draft，可修改後重新上架）
router.put('/programs/:id/deactivate', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    await db.prepare(`UPDATE training_programs SET status='draft', updated_at=SYSTIMESTAMP WHERE id=? AND status IN ('active','paused')`)
      .run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/training/programs/:id/archive — 封存
router.put('/programs/:id/archive', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    await db.prepare(`UPDATE training_programs SET status='archived', updated_at=SYSTIMESTAMP WHERE id=?`)
      .run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/training/programs/:id/unarchive — 解封（回 draft）
router.put('/programs/:id/unarchive', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    await db.prepare(`UPDATE training_programs SET status='draft', updated_at=SYSTIMESTAMP WHERE id=? AND status='archived'`)
      .run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/training/programs/:id/reactivate — re-publish with new dates
router.put('/programs/:id/reactivate', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    const { start_date, end_date } = req.body;
    if (!start_date || !end_date) return res.status(400).json({ error: '需要有效期間' });
    await db.prepare(`
      UPDATE training_programs
      SET status='draft', start_date=TO_DATE(?,'YYYY-MM-DD'), end_date=TO_DATE(?,'YYYY-MM-DD'), updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(start_date, end_date, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/training/programs/:id/activate — expand assignments
router.post('/programs/:id/activate', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    const program = await db.prepare('SELECT * FROM training_programs WHERE id=?').get(req.params.id);
    if (!program) return res.status(404).json({ error: '培訓專案不存在' });

    // Get courses (from program_courses or learning_path)
    let courseIds = [];
    if (program.learning_path_id) {
      const pathCourses = await db.prepare(
        'SELECT course_id FROM learning_path_courses WHERE path_id=? ORDER BY sort_order'
      ).all(program.learning_path_id);
      courseIds = pathCourses.map(c => c.course_id);
    } else {
      const progCourses = await db.prepare(
        'SELECT course_id FROM program_courses WHERE program_id=? ORDER BY sort_order'
      ).all(req.params.id);
      courseIds = progCourses.map(c => c.course_id);
    }

    // Resolve target users (supports all grantee types)
    const targets = await db.prepare('SELECT * FROM program_targets WHERE program_id=?').all(req.params.id);
    const userIdSet = new Set();
    for (const t of targets) {
      let users = [];
      if (t.target_type === 'public') {
        users = await db.prepare("SELECT id FROM users WHERE status='active'").all();
      } else if (t.target_type === 'user') {
        users = [{ id: Number(t.target_id) }];
      } else if (t.target_type === 'dept' || t.target_type === 'department') {
        users = await db.prepare("SELECT id FROM users WHERE dept_code=? AND status='active'").all(t.target_id);
      } else if (t.target_type === 'role') {
        users = await db.prepare("SELECT id FROM users WHERE role=? AND status='active'").all(t.target_id);
      } else if (t.target_type === 'cost_center') {
        users = await db.prepare("SELECT id FROM users WHERE profit_center_code=? AND status='active'").all(t.target_id);
      } else if (t.target_type === 'division') {
        users = await db.prepare("SELECT id FROM users WHERE org_section=? AND status='active'").all(t.target_id);
      } else if (t.target_type === 'org_group') {
        users = await db.prepare("SELECT id FROM users WHERE org_group=? AND status='active'").all(t.target_id);
      }
      for (const u of users) userIdSet.add(u.id);
    }

    // Clean up orphaned assignments (courses that were removed from program)
    await db.prepare(`
      DELETE FROM program_assignments
      WHERE program_id = ? AND course_id NOT IN (
        SELECT course_id FROM program_courses WHERE program_id = ?
      )
    `).run(req.params.id, req.params.id);

    // Create assignments
    let created = 0;
    for (const userId of userIdSet) {
      for (const courseId of courseIds) {
        try {
          await db.prepare(`
            INSERT INTO program_assignments (program_id, course_id, user_id, due_date, status)
            VALUES (?, ?, ?, (SELECT end_date FROM training_programs WHERE id=?), 'pending')
          `).run(req.params.id, courseId, userId, req.params.id);
          created++;
        } catch (e) {
          // Unique constraint — already assigned
          if (!e.message?.includes('UQ_PROG_ASSIGN')) throw e;
        }
      }
    }

    await db.prepare(`UPDATE training_programs SET status='active', updated_at=SYSTIMESTAMP WHERE id=?`)
      .run(req.params.id);

    // Send notifications if requested
    const { send_notification } = req.body;
    if (send_notification && userIdSet.size > 0) {
      const courseList = await db.prepare(`
        SELECT c.title FROM program_courses pc JOIN courses c ON c.id=pc.course_id WHERE pc.program_id=? ORDER BY pc.sort_order
      `).all(req.params.id);
      const courseTitles = courseList.map(c => c.title).join('、');

      for (const userId of userIdSet) {
        // In-app notification
        try {
          await db.prepare(`
            INSERT INTO training_notifications (user_id, type, title, message, link_url)
            VALUES (?, 'program_assigned', ?, ?, ?)
          `).run(userId, program.title,
            `您已被指派訓練專案「${program.title}」，包含課程：${courseTitles}`,
            '/training/classroom');
        } catch (e) { /* ignore notification insert errors */ }
      }

      // Email notification (if email_enabled)
      if (program.email_enabled) {
        try {
          const mailService = require('../services/mailService');
          const targetUsers = await db.prepare(
            `SELECT email, name FROM users WHERE id IN (${[...userIdSet].join(',')}) AND email IS NOT NULL`
          ).all();
          for (const u of targetUsers) {
            if (!u.email) continue;
            mailService.sendMail({
              to: u.email,
              subject: `[訓練通知] ${program.title}`,
              html: `<p>${u.name} 您好，</p>
                <p>您已被指派訓練專案「<b>${program.title}</b>」</p>
                <p><b>目的</b>：${program.purpose || '—'}</p>
                <p><b>課程</b>：${courseTitles}</p>
                <p><b>到期日</b>：${program.end_date}</p>
                <p>請前往訓練教室完成學習。</p>`
            }).catch(() => {});
          }
        } catch (e) { console.warn('[Training] email notification error:', e.message); }
      }
    }

    res.json({ ok: true, assignments_created: created, users: userIdSet.size, courses: courseIds.length });
  } catch (e) {
    console.error('[Training] activate program:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/programs/:id/assignments
router.get('/programs/:id/assignments', async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT pa.*, u.name AS user_name, u.employee_id, c.title AS course_title
      FROM program_assignments pa
      JOIN users u ON u.id = pa.user_id
      JOIN courses c ON c.id = pa.course_id
      WHERE pa.program_id = ?
      ORDER BY u.name, c.title
    `).all(req.params.id);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/training/my-assignments
router.get('/my-assignments', async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT pa.*, c.title AS course_title, tp.title AS program_title
      FROM program_assignments pa
      JOIN courses c ON c.id = pa.course_id
      JOIN training_programs tp ON tp.id = pa.program_id
      WHERE pa.user_id = ? AND pa.status != 'exempted'
      ORDER BY pa.due_date
    `).all(req.user.id);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/training/assignments/:aid/exempt
router.put('/assignments/:aid/exempt', async (req, res) => {
  try {
    await db.prepare(
      `UPDATE program_assignments SET status='exempted', exempted_by=?, exempted_reason=? WHERE id=?`
    ).run(req.user.id, req.body.reason || null, req.params.aid);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// User list for training (publish users can search users for targets)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/users-list', async (req, res) => {
  try {
    const rows = await db.prepare(
      "SELECT id, username, name, employee_id FROM users WHERE status='active' ORDER BY name"
    ).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/training/program-exam-config — get exam config override from program_courses
router.get('/program-exam-config', async (req, res) => {
  try {
    const { program_id, course_id } = req.query;
    if (!program_id || !course_id) return res.json(null);
    const row = await db.prepare(
      'SELECT exam_config FROM program_courses WHERE program_id=? AND course_id=?'
    ).get(Number(program_id), Number(course_id));
    if (!row?.exam_config) return res.json(null);
    const config = typeof row.exam_config === 'string' ? JSON.parse(row.exam_config) : row.exam_config;
    res.json(config);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Slide View Tracking (Phase 5)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/training/slides/:id/view — record slide view (upsert)
router.post('/slides/:sid/view', async (req, res) => {
  try {
    const { course_id, lesson_id, program_id, duration_seconds, interaction_done } = req.body;
    const slideId = Number(req.params.sid);
    // Upsert: try insert, on conflict update
    try {
      await db.prepare(`
        INSERT INTO user_slide_views (user_id, slide_id, course_id, lesson_id, program_id, duration_seconds, interaction_done)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(req.user.id, slideId, course_id, lesson_id, program_id || null, duration_seconds || 0, interaction_done ? 1 : 0);
    } catch (e) {
      if (e.message?.includes('UQ_SLIDE_VIEW')) {
        // Already exists — update duration + viewed_at
        await db.prepare(`
          UPDATE user_slide_views
          SET duration_seconds = duration_seconds + ?, viewed_at = SYSTIMESTAMP
              ${interaction_done ? ', interaction_done = 1' : ''}
          WHERE user_id = ? AND slide_id = ? AND ${program_id ? 'program_id = ?' : 'program_id IS NULL'}
        `).run(duration_seconds || 0, req.user.id, slideId, ...(program_id ? [program_id] : []));
      } else throw e;
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/training/slides/:sid/view/done — mark interaction done
router.put('/slides/:sid/view/done', async (req, res) => {
  try {
    const { program_id } = req.body;
    await db.prepare(`
      UPDATE user_slide_views SET interaction_done = 1, viewed_at = SYSTIMESTAMP
      WHERE user_id = ? AND slide_id = ? AND ${program_id ? 'program_id = ?' : 'program_id IS NULL'}
    `).run(req.user.id, Number(req.params.sid), ...(program_id ? [program_id] : []));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/training/classroom/programs/:id/my-scores — learner's scores + progress
router.get('/classroom/programs/:id/my-scores', async (req, res) => {
  try {
    const progId = Number(req.params.id);
    const userId = req.user.id;

    // Get program info
    const program = await db.prepare('SELECT program_pass_score FROM training_programs WHERE id=?').get(progId);
    if (!program) return res.status(404).json({ error: '專案不存在' });

    // Get program courses with exam_config
    const coursesRaw = await db.prepare(`
      SELECT pc.id AS pc_id, pc.course_id, pc.lesson_ids, pc.exam_config, pc.is_required,
             c.title AS course_title, c.pass_score AS course_pass_score
      FROM program_courses pc
      JOIN courses c ON c.id = pc.course_id
      WHERE pc.program_id = ? ORDER BY pc.sort_order
    `).all(progId);

    const result = [];
    let programTotal = 0, programMax = 0;
    let allCoursePassed = true;

    for (const pc of coursesRaw) {
      const lessonIds = pc.lesson_ids ? JSON.parse(pc.lesson_ids) : null;
      const examConfig = pc.exam_config ? JSON.parse(pc.exam_config) : {};
      const courseTotalScore = examConfig.total_score || 100;
      const coursePassScore = examConfig.pass_score || pc.course_pass_score || 60;
      const maxAttempts = examConfig.max_attempts || 0;

      // Get lessons for this course (filtered by lesson_ids)
      let lessons = await db.prepare('SELECT id, title FROM course_lessons WHERE course_id=? ORDER BY sort_order, id').all(pc.course_id);
      if (lessonIds && lessonIds.length > 0) {
        lessons = lessons.filter(l => lessonIds.includes(l.id));
      }

      // Get total slides per lesson + check if lesson has interactive blocks
      const lessonProgress = [];
      let totalSlides = 0, viewedSlides = 0;
      let browseOnlyScore = 0; // score from non-interactive lessons (browse completion)
      const lessonWeights = examConfig.lesson_weights || {};

      for (const lesson of lessons) {
        const slideCount = await db.prepare('SELECT COUNT(*) AS cnt FROM course_slides WHERE lesson_id=?').get(lesson.id);
        const viewed = await db.prepare(`
          SELECT COUNT(*) AS cnt FROM user_slide_views
          WHERE user_id=? AND lesson_id=? AND ${progId ? 'program_id=?' : 'program_id IS NULL'}
        `).get(userId, lesson.id, ...(progId ? [progId] : []));

        const total = slideCount?.cnt || 0;
        const done = Math.min(viewed?.cnt || 0, total);
        totalSlides += total;
        viewedSlides += done;

        // Check if this lesson has any interactive slides (hotspot/dragdrop/quiz_inline)
        const interactiveCount = await db.prepare(`
          SELECT COUNT(*) AS cnt FROM course_slides cs
          WHERE cs.lesson_id = ? AND (
            cs.content_json LIKE '%"type":"hotspot"%'
            OR cs.content_json LIKE '%"type":"dragdrop"%'
            OR cs.content_json LIKE '%"type":"quiz_inline"%'
          )
        `).get(lesson.id);
        const hasInteractive = (interactiveCount?.cnt || 0) > 0;

        // For non-interactive lessons: score = browse completion × lesson weight
        const lessonWeight = lessonWeights[`lesson_${lesson.id}`] || 0;
        let lessonBrowseScore = 0;
        if (!hasInteractive && lessonWeight > 0 && total > 0) {
          lessonBrowseScore = Math.round((done / total) * lessonWeight);
          browseOnlyScore += lessonBrowseScore;
        }

        lessonProgress.push({
          lesson_id: lesson.id, title: lesson.title, total, viewed: done,
          has_interactive: hasInteractive, browse_score: lessonBrowseScore, lesson_weight: lessonWeight
        });
      }

      // Get best exam score (from interaction_results grouped by session_id)
      // This covers ONLY interactive lessons
      const bestSession = await db.prepare(`
        SELECT SUM(COALESCE(weighted_score, score)) AS session_score,
               SUM(COALESCE(weighted_max, max_score)) AS session_max,
               MAX(created_at) AS session_at
        FROM interaction_results
        WHERE user_id=? AND course_id=? AND session_id IS NOT NULL AND player_mode='test'
        GROUP BY session_id
        ORDER BY SUM(COALESCE(weighted_score, score)) DESC
        FETCH FIRST 1 ROW ONLY
      `).get(userId, pc.course_id);

      // Get exam attempt count
      const attemptCount = await db.prepare(`
        SELECT COUNT(DISTINCT session_id) AS cnt FROM interaction_results
        WHERE user_id=? AND course_id=? AND session_id IS NOT NULL AND player_mode='test'
      `).get(userId, pc.course_id);

      // Get exam history (all sessions) with per-slide details
      const examHistoryRaw = await db.prepare(`
        SELECT session_id, SUM(COALESCE(weighted_score, score)) AS score,
               SUM(COALESCE(weighted_max, max_score)) AS max_score,
               MAX(created_at) AS exam_at
        FROM interaction_results
        WHERE user_id=? AND course_id=? AND session_id IS NOT NULL AND player_mode='test'
        GROUP BY session_id ORDER BY MAX(created_at) DESC
      `).all(userId, pc.course_id);

      // Load slide details for each session
      const examHistory = [];
      for (const sess of examHistoryRaw) {
        const slides = await db.prepare(`
          SELECT ir.slide_id, ir.block_type, ir.score, ir.max_score,
                 COALESCE(ir.weighted_score, ir.score) AS weighted_score,
                 COALESCE(ir.weighted_max, ir.max_score) AS weighted_max,
                 ir.steps_completed, ir.total_steps, ir.wrong_clicks,
                 ir.score_breakdown, ir.action_log
          FROM interaction_results ir
          WHERE ir.session_id = ? AND ir.user_id = ?
          ORDER BY ir.id
        `).all(sess.session_id, userId);
        // Parse CLOB fields
        const parsedSlides = slides.map(s => ({
          ...s,
          score_breakdown: s.score_breakdown ? (typeof s.score_breakdown === 'string' ? JSON.parse(s.score_breakdown) : s.score_breakdown) : null,
          action_log: s.action_log ? (typeof s.action_log === 'string' ? JSON.parse(s.action_log) : s.action_log) : null
        }));
        examHistory.push({ ...sess, slides: parsedSlides });
      }

      const bestScore = bestSession?.session_score || 0;
      const bestMax = bestSession?.session_max || 100;
      const examRatio = bestMax > 0 ? bestScore / bestMax : 0;

      // Calculate interactive lessons' weighted score
      const interactiveLessonsWeight = lessonProgress
        .filter(l => l.has_interactive)
        .reduce((s, l) => s + l.lesson_weight, 0);
      const interactiveWeightedScore = interactiveLessonsWeight > 0
        ? Math.round(examRatio * interactiveLessonsWeight)
        : Math.round(examRatio * courseTotalScore);

      // Total = browse-only score + interactive score
      // If no lesson_weights configured, fall back to exam-only scoring
      const hasLessonWeights = Object.keys(lessonWeights).length > 0;
      const weightedScore = hasLessonWeights
        ? browseOnlyScore + interactiveWeightedScore
        : Math.round(examRatio * courseTotalScore);

      const courseScorePct = courseTotalScore > 0 ? (weightedScore / courseTotalScore) * 100 : 0;
      const coursePassed = courseScorePct >= coursePassScore;
      if (pc.is_required && !coursePassed) allCoursePassed = false;

      programTotal += weightedScore;
      programMax += courseTotalScore;

      result.push({
        course_id: pc.course_id,
        course_title: pc.course_title,
        total_score: courseTotalScore,
        pass_score: coursePassScore,
        max_attempts: maxAttempts,
        browse_progress: { total: totalSlides, viewed: viewedSlides, pct: totalSlides > 0 ? Math.round(viewedSlides / totalSlides * 100) : 0, lessons: lessonProgress },
        browse_only_score: browseOnlyScore,
        exam: {
          best_score: bestScore, best_max: bestMax,
          attempts: attemptCount?.cnt || 0, max_attempts: maxAttempts,
          passed: coursePassed,
          weighted_score: weightedScore,
          history: examHistory.map((h, i) => ({ attempt: examHistory.length - i, score: h.score, max_score: h.max_score, exam_at: h.exam_at, slides: h.slides }))
        }
      });
    }

    const programPassScore = program.program_pass_score || 60;
    const programPassed = allCoursePassed && (programMax > 0 ? programTotal / programMax * 100 >= programPassScore : false);

    res.json({
      courses: result,
      program_total: programTotal,
      program_max: programMax,
      program_pass_score: programPassScore,
      program_passed: programPassed
    });
  } catch (e) {
    console.error('[Scores] my-scores error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/programs/:id/report — admin report
router.get('/programs/:id/report', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    const progId = Number(req.params.id);
    const program = await db.prepare('SELECT title, program_pass_score FROM training_programs WHERE id=?').get(progId);
    if (!program) return res.status(404).json({ error: '專案不存在' });

    // All assigned users
    const users = await db.prepare(`
      SELECT DISTINCT pa.user_id, u.name, u.employee_id, u.dept_code
      FROM program_assignments pa
      JOIN users u ON u.id = pa.user_id
      WHERE pa.program_id = ? AND pa.status != 'exempted'
      ORDER BY u.name
    `).all(progId);

    // Program courses
    const courses = await db.prepare(`
      SELECT pc.course_id, pc.exam_config, pc.lesson_ids, pc.is_required,
             c.title AS course_title, c.pass_score AS course_pass_score
      FROM program_courses pc JOIN courses c ON c.id = pc.course_id
      WHERE pc.program_id = ? ORDER BY pc.sort_order
    `).all(progId);

    // For each user, get progress + scores
    const usersReport = [];
    let totalCompleted = 0, totalPassed = 0, totalNotStarted = 0;

    for (const u of users) {
      let browseTotal = 0, browseViewed = 0;
      let programTotal = 0, programMax = 0;
      let allPassed = true;
      const courseDetails = [];

      for (const pc of courses) {
        const examConfig = pc.exam_config ? JSON.parse(pc.exam_config) : {};
        const courseTotalScore = examConfig.total_score || 100;
        const coursePassScore = examConfig.pass_score || pc.course_pass_score || 60;
        const lessonIds = pc.lesson_ids ? JSON.parse(pc.lesson_ids) : null;

        // Slide count
        let slideCountSql = 'SELECT COUNT(*) AS cnt FROM course_slides cs JOIN course_lessons cl ON cl.id = cs.lesson_id WHERE cl.course_id=?';
        const scParams = [pc.course_id];
        if (lessonIds && lessonIds.length) {
          const ph = lessonIds.map(() => '?').join(',');
          slideCountSql += ` AND cs.lesson_id IN (${ph})`;
          scParams.push(...lessonIds.map(Number));
        }
        const slideCount = await db.prepare(slideCountSql).get(...scParams);

        const viewedCount = await db.prepare(`
          SELECT COUNT(*) AS cnt FROM user_slide_views WHERE user_id=? AND course_id=? AND program_id=?
        `).get(u.user_id, pc.course_id, progId);

        const total = slideCount?.cnt || 0;
        const viewed = Math.min(viewedCount?.cnt || 0, total);
        browseTotal += total;
        browseViewed += viewed;

        // Best exam score
        const best = await db.prepare(`
          SELECT SUM(COALESCE(weighted_score, score)) AS session_score,
                 SUM(COALESCE(weighted_max, max_score)) AS session_max
          FROM interaction_results WHERE user_id=? AND course_id=? AND session_id IS NOT NULL AND player_mode='test'
          GROUP BY session_id ORDER BY SUM(COALESCE(weighted_score, score)) DESC
          FETCH FIRST 1 ROW ONLY
        `).get(u.user_id, pc.course_id);

        const attempts = await db.prepare(
          "SELECT COUNT(DISTINCT session_id) AS cnt FROM interaction_results WHERE user_id=? AND course_id=? AND session_id IS NOT NULL AND player_mode='test'"
        ).get(u.user_id, pc.course_id);

        // Browse-only score for non-interactive lessons
        const lessonWeights = examConfig.lesson_weights || {};
        const hasLessonWeights = Object.keys(lessonWeights).length > 0;
        let browseOnlyScore = 0;
        if (hasLessonWeights) {
          let lessonsForCourse = await db.prepare('SELECT id FROM course_lessons WHERE course_id=? ORDER BY sort_order, id').all(pc.course_id);
          if (lessonIds?.length) lessonsForCourse = lessonsForCourse.filter(l => lessonIds.includes(l.id));
          for (const les of lessonsForCourse) {
            const iCnt = await db.prepare(`SELECT COUNT(*) AS cnt FROM course_slides WHERE lesson_id=? AND (content_json LIKE '%"type":"hotspot"%' OR content_json LIKE '%"type":"dragdrop"%' OR content_json LIKE '%"type":"quiz_inline"%')`).get(les.id);
            if ((iCnt?.cnt || 0) === 0) {
              const lw = lessonWeights[`lesson_${les.id}`] || 0;
              if (lw > 0) {
                const lTotal = await db.prepare('SELECT COUNT(*) AS cnt FROM course_slides WHERE lesson_id=?').get(les.id);
                const lViewed = await db.prepare('SELECT COUNT(*) AS cnt FROM user_slide_views WHERE user_id=? AND lesson_id=? AND program_id=?').get(u.user_id, les.id, progId);
                const lt = lTotal?.cnt || 0; const lv = Math.min(lViewed?.cnt || 0, lt);
                browseOnlyScore += lt > 0 ? Math.round((lv / lt) * lw) : 0;
              }
            }
          }
        }

        const bestScore = best?.session_score || 0;
        const bestMax = best?.session_max || 100;
        const ratio = bestMax > 0 ? bestScore / bestMax : 0;
        const interactiveWeight = hasLessonWeights
          ? Object.entries(lessonWeights).reduce((s, [k, v]) => s + (typeof v === 'number' ? v : 0), 0) - browseOnlyScore
          : courseTotalScore;
        const weighted = hasLessonWeights
          ? browseOnlyScore + Math.round(ratio * (interactiveWeight > 0 ? interactiveWeight : courseTotalScore))
          : Math.round(ratio * courseTotalScore);
        const passed = ratio * 100 >= coursePassScore;
        if (pc.is_required && !passed) allPassed = false;
        programTotal += weighted;
        programMax += courseTotalScore;

        courseDetails.push({
          course_id: pc.course_id, title: pc.course_title,
          browse_total: total, browse_viewed: viewed,
          best_score: bestScore, attempts: attempts?.cnt || 0,
          weighted, total_score: courseTotalScore, passed
        });
      }

      const pPassScore = program.program_pass_score || 60;
      const pPassed = allPassed && (programMax > 0 ? programTotal / programMax * 100 >= pPassScore : false);
      const status = browseViewed === 0 && programTotal === 0 ? 'not_started' : pPassed ? 'passed' : 'in_progress';
      if (status === 'not_started') totalNotStarted++;
      else if (status === 'passed') totalPassed++;

      usersReport.push({
        user_id: u.user_id, name: u.name, employee_id: u.employee_id, dept_code: u.dept_code,
        browse_total: browseTotal, browse_viewed: browseViewed, browse_pct: browseTotal > 0 ? Math.round(browseViewed / browseTotal * 100) : 0,
        courses: courseDetails,
        program_total: programTotal, program_max: programMax, program_passed: pPassed, status
      });
    }

    totalCompleted = usersReport.filter(u => u.browse_pct === 100).length;

    res.json({
      program_title: program.title,
      program_pass_score: program.program_pass_score || 60,
      summary: { total: users.length, completed_browse: totalCompleted, passed: totalPassed, not_started: totalNotStarted },
      users: usersReport
    });
  } catch (e) {
    console.error('[Report] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/programs/:id/report/export — Excel export
router.get('/programs/:id/report/export', async (req, res) => {
  if (!canPublish(req)) return res.status(403).json({ error: '需要上架權限' });
  try {
    // Reuse report logic
    const progId = Number(req.params.id);
    const reportRes = { json: null };
    // Inline the report generation (call the same logic)
    const program = await db.prepare('SELECT title, program_pass_score FROM training_programs WHERE id=?').get(progId);
    if (!program) return res.status(404).json({ error: '專案不存在' });

    const courses = await db.prepare(`
      SELECT pc.course_id, pc.exam_config, pc.lesson_ids, pc.is_required,
             c.title AS course_title, c.pass_score AS course_pass_score
      FROM program_courses pc JOIN courses c ON c.id = pc.course_id
      WHERE pc.program_id = ? ORDER BY pc.sort_order
    `).all(progId);

    const users = await db.prepare(`
      SELECT DISTINCT pa.user_id, u.name, u.employee_id, u.dept_code,
             (SELECT name FROM (SELECT DISTINCT dept_code, dept_name AS name FROM users WHERE dept_code IS NOT NULL) WHERE dept_code = u.dept_code AND ROWNUM=1) AS dept_name
      FROM program_assignments pa
      JOIN users u ON u.id = pa.user_id
      WHERE pa.program_id = ? AND pa.status != 'exempted'
      ORDER BY u.name
    `).all(progId);

    // Build Excel — i18n headers based on request language
    const XLSX = require('xlsx');
    const lang = req.query.lang || req.headers['accept-language']?.split(',')[0]?.split('-')[0] || 'zh';
    const labels = lang === 'en' ? { name: 'Name', eid: 'Employee ID', dept: 'Department', browse: 'Browse', browseAll: 'Browse Progress', score: 'Score', total: 'Program Total', pass: 'Pass' }
      : lang === 'vi' ? { name: 'Tên', eid: 'Mã NV', dept: 'Phòng ban', browse: 'Duyệt', browseAll: 'Tiến độ', score: 'Điểm', total: 'Tổng điểm', pass: 'Đạt' }
      : { name: '姓名', eid: '工號', dept: '部門', browse: '導覽', browseAll: '導覽進度', score: '成績', total: '專案總分', pass: '及格' };
    const headers = [labels.name, labels.eid, labels.dept, labels.browseAll];
    for (const c of courses) { headers.push(`${c.course_title} ${labels.browse}`, `${c.course_title} ${labels.score}`); }
    headers.push(labels.total, labels.pass);

    const rows = [];
    for (const u of users) {
      const row = [u.name, u.employee_id || '', u.dept_name || u.dept_code || ''];
      let browseTotal = 0, browseViewed = 0, programTotal = 0, programMax = 0;
      let allPassed = true;

      for (const pc of courses) {
        const examConfig = pc.exam_config ? JSON.parse(pc.exam_config) : {};
        const courseTotalScore = examConfig.total_score || 100;
        const coursePassScore = examConfig.pass_score || pc.course_pass_score || 60;
        const lessonIds = pc.lesson_ids ? JSON.parse(pc.lesson_ids) : null;

        let scSql = 'SELECT COUNT(*) AS cnt FROM course_slides cs JOIN course_lessons cl ON cl.id=cs.lesson_id WHERE cl.course_id=?';
        const scParams2 = [pc.course_id];
        if (lessonIds?.length) {
          const ph = lessonIds.map(() => '?').join(',');
          scSql += ` AND cs.lesson_id IN (${ph})`;
          scParams2.push(...lessonIds.map(Number));
        }
        const sc = await db.prepare(scSql).get(...scParams2);
        const vc = await db.prepare('SELECT COUNT(*) AS cnt FROM user_slide_views WHERE user_id=? AND course_id=? AND program_id=?').get(u.user_id, pc.course_id, progId);
        const total = sc?.cnt || 0; const viewed = Math.min(vc?.cnt || 0, total);
        browseTotal += total; browseViewed += viewed;
        row.push(`${viewed}/${total}`);

        // Browse-only score for non-interactive lessons
        const eLessonWeights = examConfig.lesson_weights || {};
        const eHasLW = Object.keys(eLessonWeights).length > 0;
        let eBrowseScore = 0;
        if (eHasLW) {
          let eLessons = await db.prepare('SELECT id FROM course_lessons WHERE course_id=?').all(pc.course_id);
          if (lessonIds?.length) eLessons = eLessons.filter(l => lessonIds.includes(l.id));
          for (const el of eLessons) {
            const ic = await db.prepare(`SELECT COUNT(*) AS cnt FROM course_slides WHERE lesson_id=? AND (content_json LIKE '%"type":"hotspot"%' OR content_json LIKE '%"type":"dragdrop"%' OR content_json LIKE '%"type":"quiz_inline"%')`).get(el.id);
            if ((ic?.cnt || 0) === 0) {
              const lw = eLessonWeights[`lesson_${el.id}`] || 0;
              if (lw > 0) {
                const lt = await db.prepare('SELECT COUNT(*) AS cnt FROM course_slides WHERE lesson_id=?').get(el.id);
                const lv = await db.prepare('SELECT COUNT(*) AS cnt FROM user_slide_views WHERE user_id=? AND lesson_id=? AND program_id=?').get(u.user_id, el.id, progId);
                eBrowseScore += (lt?.cnt || 0) > 0 ? Math.round((Math.min(lv?.cnt || 0, lt.cnt) / lt.cnt) * lw) : 0;
              }
            }
          }
        }
        const best = await db.prepare(`SELECT SUM(COALESCE(weighted_score,score)) AS session_score, SUM(COALESCE(weighted_max,max_score)) AS session_max FROM interaction_results WHERE user_id=? AND course_id=? AND session_id IS NOT NULL AND player_mode='test' GROUP BY session_id ORDER BY SUM(COALESCE(weighted_score,score)) DESC FETCH FIRST 1 ROW ONLY`).get(u.user_id, pc.course_id);
        const bs = best?.session_score || 0;
        const bm = best?.session_max || 100;
        const ratio = bm > 0 ? bs / bm : 0;
        const weighted = eHasLW ? eBrowseScore + Math.round(ratio * (courseTotalScore - eBrowseScore)) : Math.round(ratio * courseTotalScore);
        const scorePct = courseTotalScore > 0 ? (weighted / courseTotalScore) * 100 : 0;
        if (pc.is_required && scorePct < coursePassScore) allPassed = false;
        programTotal += weighted; programMax += courseTotalScore;
        row.push(bs > 0 ? `${bs}` : '—');
      }

      row.splice(3, 0, `${browseViewed}/${browseTotal}`);
      const pPass = allPassed && (programMax > 0 ? programTotal / programMax * 100 >= (program.program_pass_score || 60) : false);
      const passYes = lang === 'en' ? 'Yes' : lang === 'vi' ? 'Có' : '是';
      const passNo = lang === 'en' ? 'No' : lang === 'vi' ? 'Không' : '否';
      row.push(`${programTotal}/${programMax}`, pPass ? passYes : passNo);
      rows.push(row);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, '成績報表');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(program.title)}_report.xlsx"`);
    res.send(buf);
  } catch (e) {
    console.error('[Export] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Training Classroom APIs
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/training/classroom/my-programs — program-oriented view for learners
router.get('/classroom/my-programs', async (req, res) => {
  try {
    // Auto-enroll: find active programs targeting this user (public, user, role, dept, etc.)
    // Build conditions dynamically to avoid NULL bind issues
    const conditions = ["pt.target_type = 'public'"];
    const params = [];
    conditions.push(`(pt.target_type = 'user' AND pt.target_id = TO_CHAR(?))`);
    params.push(req.user.id);
    if (req.user.role_id) {
      conditions.push(`(pt.target_type = 'role' AND pt.target_id = TO_CHAR(?))`);
      params.push(req.user.role_id);
    }
    if (req.user.dept_code) {
      conditions.push(`(pt.target_type IN ('dept','department') AND pt.target_id = ?)`);
      params.push(req.user.dept_code);
    }
    if (req.user.profit_center) {
      conditions.push(`(pt.target_type = 'cost_center' AND pt.target_id = ?)`);
      params.push(req.user.profit_center);
    }
    if (req.user.org_section) {
      conditions.push(`(pt.target_type = 'division' AND pt.target_id = ?)`);
      params.push(req.user.org_section);
    }
    if (req.user.org_group) {
      conditions.push(`(pt.target_type = 'org_group' AND pt.target_id = ?)`);
      params.push(req.user.org_group);
    }
    const sql = `SELECT DISTINCT tp.id
      FROM training_programs tp
      JOIN program_targets pt ON pt.program_id = tp.id
      WHERE tp.status = 'active' AND (${conditions.join(' OR ')})`
    const publicPrograms = await db.prepare(sql).all(...params);

    for (const prog of publicPrograms) {
      // Get current program courses
      const progCourses = await db.prepare(
        'SELECT course_id FROM program_courses WHERE program_id=? ORDER BY sort_order'
      ).all(prog.id);
      // Check each course — create assignment if missing
      for (const c of progCourses) {
        const existing = await db.prepare(
          'SELECT id FROM program_assignments WHERE program_id=? AND course_id=? AND user_id=? FETCH FIRST 1 ROWS ONLY'
        ).get(prog.id, c.course_id, req.user.id);
        if (!existing) {
          try {
            await db.prepare(`
              INSERT INTO program_assignments (program_id, course_id, user_id, due_date, status)
              VALUES (?, ?, ?, (SELECT end_date FROM training_programs WHERE id=?), 'pending')
            `).run(prog.id, c.course_id, req.user.id, prog.id);
          } catch (e) { /* unique constraint */ }
        }
      }
    }

    // Get distinct programs this user is assigned to (only active programs)
    const programs = await db.prepare(`
      SELECT tp.id, tp.title, tp.description, tp.purpose, tp.status,
             tp.start_date, tp.end_date
      FROM training_programs tp
      WHERE tp.id IN (SELECT DISTINCT pa.program_id FROM program_assignments pa WHERE pa.user_id = ?)
        AND tp.status IN ('active', 'completed')
      ORDER BY CASE tp.status WHEN 'active' THEN 0 ELSE 1 END, tp.end_date
    `).all(req.user.id);

    // For each program, compute real progress (browse + exam per course)
    for (const prog of programs) {
      const courseRows = await db.prepare(`
        SELECT pc.course_id, pc.lesson_ids, pc.exam_config, c.pass_score AS course_pass_score
        FROM program_courses pc JOIN courses c ON c.id = pc.course_id
        WHERE pc.program_id = ?
      `).all(prog.id);
      let total = courseRows.length, completed = 0, in_progress = 0;
      for (const cr of courseRows) {
        let examConfig = {};
        try { if (cr.exam_config) examConfig = typeof cr.exam_config === 'string' ? JSON.parse(cr.exam_config) : cr.exam_config; } catch {}
        const passScore = examConfig.pass_score || cr.course_pass_score || 60;
        let lessonIds = null;
        try { if (cr.lesson_ids) lessonIds = typeof cr.lesson_ids === 'string' ? JSON.parse(cr.lesson_ids) : cr.lesson_ids; } catch {}

        // Browse: count total slides vs viewed
        let slideSql = 'SELECT COUNT(*) AS cnt FROM course_slides cs JOIN course_lessons cl ON cl.id=cs.lesson_id WHERE cl.course_id=?';
        const slideParams = [cr.course_id];
        if (lessonIds?.length) { slideSql += ` AND cs.lesson_id IN (${lessonIds.map(() => '?').join(',')})`; slideParams.push(...lessonIds); }
        const slideCount = await db.prepare(slideSql).get(...slideParams);
        let viewedCount = { cnt: 0 };
        try { viewedCount = await db.prepare('SELECT COUNT(*) AS cnt FROM user_slide_views WHERE user_id=? AND course_id=? AND program_id=?').get(req.user.id, cr.course_id, prog.id) || { cnt: 0 }; } catch {}
        const browseOk = (slideCount?.cnt || 0) > 0 && (viewedCount?.cnt || 0) >= (slideCount?.cnt || 0);

        // Check if course has ANY interactive slides
        let iSql = `SELECT COUNT(*) AS cnt FROM course_slides cs JOIN course_lessons cl ON cl.id=cs.lesson_id WHERE cl.course_id=? AND (cs.content_json LIKE '%"type":"hotspot"%' OR cs.content_json LIKE '%"type":"dragdrop"%' OR cs.content_json LIKE '%"type":"quiz_inline"%')`;
        const iParams = [cr.course_id];
        if (lessonIds?.length) { iSql += ` AND cs.lesson_id IN (${lessonIds.map(() => '?').join(',')})`; iParams.push(...lessonIds); }
        const interactiveSlides = await db.prepare(iSql).get(...iParams);
        const hasInteractive = (interactiveSlides?.cnt || 0) > 0;

        // Exam: best score (only matters if course has interactive content)
        let examOk = !hasInteractive; // no interactive = auto pass
        let best = null;
        if (hasInteractive) {
          best = await db.prepare(`SELECT SUM(COALESCE(weighted_score,score)) AS s, SUM(COALESCE(weighted_max,max_score)) AS m FROM interaction_results WHERE user_id=? AND course_id=? AND session_id IS NOT NULL AND player_mode='test' GROUP BY session_id ORDER BY SUM(COALESCE(weighted_score,score)) DESC FETCH FIRST 1 ROW ONLY`).get(req.user.id, cr.course_id);
          examOk = best && best.m > 0 && (best.s / best.m * 100) >= passScore;
        }

        if (browseOk && examOk) completed++;
        else if ((viewedCount?.cnt || 0) > 0 || best) in_progress++;
      }
      prog.stats = { total, completed, in_progress, pending: total - completed - in_progress };
    }
    res.json(programs);
  } catch (e) {
    console.error('[Classroom] ERROR:', e.message, e.stack?.split('\n').slice(0, 3).join(' '));
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/classroom/programs/:id — program detail for learner
router.get('/classroom/programs/:id', async (req, res) => {
  try {
    const program = await db.prepare('SELECT * FROM training_programs WHERE id=?').get(req.params.id);
    if (!program) return res.status(404).json({ error: '專案不存在' });

    const assignmentsRaw = await db.prepare(`
      SELECT pa.*, c.title AS course_title, c.cover_image, c.description AS course_description,
             pc.lesson_ids
      FROM program_assignments pa
      JOIN courses c ON c.id = pa.course_id
      LEFT JOIN program_courses pc ON pc.program_id = pa.program_id AND pc.course_id = pa.course_id
      WHERE pa.program_id = ? AND pa.user_id = ? AND pa.status != 'exempted'
      ORDER BY COALESCE(pc.sort_order, pa.id)
    `).all(req.params.id, req.user.id);
    // Parse lesson_ids + compute lesson progress + exam topics
    const isSequential = program.sequential_lessons === 1;
    const assignments = [];
    for (const a of assignmentsRaw) {
      const parsed = {
        ...a,
        lesson_ids: a.lesson_ids ? (typeof a.lesson_ids === 'string' ? JSON.parse(a.lesson_ids) : a.lesson_ids) : null
      };

      // Always compute lesson_status for chapter display
      let lessons = await db.prepare('SELECT id, title, sort_order FROM course_lessons WHERE course_id=? ORDER BY sort_order, id').all(a.course_id);
      if (parsed.lesson_ids && parsed.lesson_ids.length > 0) {
        lessons = lessons.filter(l => parsed.lesson_ids.includes(l.id));
      }
      const lessonStatus = [];
      let allPrevDone = true;
      for (const lesson of lessons) {
        const slideCount = await db.prepare('SELECT COUNT(*) AS cnt FROM course_slides WHERE lesson_id=?').get(lesson.id);
        const viewedCount = await db.prepare(
          'SELECT COUNT(*) AS cnt FROM user_slide_views WHERE user_id=? AND lesson_id=? AND program_id=?'
        ).get(req.user.id, lesson.id, Number(req.params.id));
        const total = slideCount?.cnt || 0;
        const viewed = Math.min(viewedCount?.cnt || 0, total);
        const done = total > 0 && viewed >= total;
        lessonStatus.push({ lesson_id: lesson.id, title: lesson.title, total, viewed, done, locked: isSequential && !allPrevDone });
        if (!done) allPrevDone = false;
      }
      parsed.lesson_status = lessonStatus;

      // Get exam topics for this course
      try {
        const topics = await db.prepare('SELECT id, title, total_score, time_limit_minutes FROM exam_topics WHERE course_id=? ORDER BY id').all(a.course_id);
        parsed.exam_topics = topics || [];
      } catch { parsed.exam_topics = []; }

      assignments.push(parsed);
    }

    res.json({ ...program, sequential_lessons: program.sequential_lessons, assignments });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/training/classroom/assignments/:aid/start
router.put('/classroom/assignments/:aid/start', async (req, res) => {
  try {
    await db.prepare(`
      UPDATE program_assignments SET status='in_progress', started_at=SYSTIMESTAMP
      WHERE id=? AND user_id=? AND status='pending'
    `).run(req.params.aid, req.user.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/training/classroom/assignments/:aid/complete
router.put('/classroom/assignments/:aid/complete', async (req, res) => {
  try {
    const { score, passed } = req.body;
    await db.prepare(`
      UPDATE program_assignments
      SET status='completed', completed_at=SYSTIMESTAMP, score=?, passed=?
      WHERE id=? AND user_id=?
    `).run(score ?? null, passed ?? null, req.params.aid, req.user.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Notifications
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/notifications', async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT * FROM training_notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      FETCH FIRST 50 ROWS ONLY
    `).all(req.user.id);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/notifications/unread-count', async (req, res) => {
  try {
    const row = await db.prepare(
      'SELECT COUNT(*) AS cnt FROM training_notifications WHERE user_id=? AND is_read=0'
    ).get(req.user.id);
    res.json({ count: row?.cnt || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/notifications/:nid/read', async (req, res) => {
  try {
    await db.prepare('UPDATE training_notifications SET is_read=1 WHERE id=? AND user_id=?')
      .run(req.params.nid, req.user.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/notifications/read-all', async (req, res) => {
  try {
    await db.prepare('UPDATE training_notifications SET is_read=1 WHERE user_id=? AND is_read=0')
      .run(req.user.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/training/courses/:id/send-notification — manual notification
router.post('/courses/:id/send-notification', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const { user_ids, message, type } = req.body;
    const course = await db.prepare('SELECT title FROM courses WHERE id=?').get(req.courseId);

    for (const uid of (user_ids || [])) {
      await db.prepare(`
        INSERT INTO training_notifications (user_id, type, title, message, course_id, link_url)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(uid, type || 'custom', `${course?.title || '課程'}通知`, message,
             req.courseId, `/training/course/${req.courseId}`);
    }
    res.json({ ok: true, sent: (user_ids || []).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Translation
// ═══════════════════════════════════════════════════════════════════════════════

// POST /courses/:id/translate — SSE streaming progress
router.post('/courses/:id/translate', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  const { target_lang, model: requestModel } = req.body;
  if (!target_lang || target_lang === 'zh-TW')
    return res.status(400).json({ error: 'target_lang must be en or vi' });

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (type, data) => { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); };

  try {
    const course = await db.prepare('SELECT title, description FROM courses WHERE id=?').get(req.courseId);
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Phase 2E: support model selection (from request or system_settings or llm_models)
    let modelName = requestModel || null;
    if (!modelName) {
      const setting = await db.prepare(`SELECT value FROM system_settings WHERE key='training_translate_model'`).get();
      modelName = setting?.value || null;
    }
    if (!modelName) {
      const flashRow = await db.prepare(
        `SELECT api_model FROM llm_models WHERE model_role='chat' AND is_active=1 AND provider_type='gemini' ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
      ).get();
      modelName = flashRow?.api_model || process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview';
    }
    const model = genAI.getGenerativeModel({ model: modelName });
    send('status', { message: `使用模型: ${modelName}` });

    const langName = target_lang === 'en' ? 'English' : 'Vietnamese';
    const translateText = async (text) => {
      if (!text) return null;
      const r = await model.generateContent(
        `Translate the following Traditional Chinese text to ${langName}. Do not translate product names or technical terms. Return only the translation:\n\n${text}`
      );
      return r.response.text().trim();
    };

    // Count total work items (optionally filter by lesson_ids)
    const { lesson_ids: filterLessonIds } = req.body;
    let lessons = await db.prepare('SELECT id, title FROM course_lessons WHERE course_id=?').all(req.courseId);
    if (filterLessonIds && filterLessonIds.length > 0) {
      lessons = lessons.filter(l => filterLessonIds.includes(l.id));
    }
    let totalSlides = 0;
    const lessonSlideMap = {};
    for (const lesson of lessons) {
      const slides = await db.prepare('SELECT id, content_json, notes FROM course_slides WHERE lesson_id=?').all(lesson.id);
      lessonSlideMap[lesson.id] = slides;
      totalSlides += slides.length;
    }
    const questions = await db.prepare('SELECT id, question_json, explanation FROM quiz_questions WHERE course_id=?').all(req.courseId);
    const totalItems = 1 + lessons.length + totalSlides + questions.length; // course + lessons + slides + questions
    let doneItems = 0;

    const CONCURRENCY = 10;    // parallel LLM calls (paid Gemini tier)
    const SLIDE_BATCH = 5;     // slides packed per LLM call
    const QUIZ_BATCH = 5;      // quiz questions packed per LLM call

    const stripFence = (s) => s.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();

    // 1. Course metadata — title + description in parallel
    send('progress', { current: doneItems, total: totalItems, step: '翻譯課程標題...' });
    const [titleTrans, descTrans] = await Promise.all([
      translateText(course.title),
      translateText(course.description)
    ]);
    const existingCT = await db.prepare('SELECT id FROM course_translations WHERE course_id=? AND lang=?').get(req.courseId, target_lang);
    if (existingCT) {
      await db.prepare('UPDATE course_translations SET title=?, description=?, translated_at=SYSTIMESTAMP, is_auto=1 WHERE id=?')
        .run(titleTrans, descTrans, existingCT.id);
    } else {
      await db.prepare('INSERT INTO course_translations (course_id, lang, title, description, is_auto) VALUES (?,?,?,?,1)')
        .run(req.courseId, target_lang, titleTrans, descTrans);
    }
    doneItems++;
    send('progress', { current: doneItems, total: totalItems, step: '課程標題完成' });

    // 2. Lessons — titles all parallel
    send('progress', { current: doneItems, total: totalItems, step: `翻譯 ${lessons.length} 個章節標題...` });
    await Promise.all(lessons.map(async (lesson) => {
      try {
        const lt = await translateText(lesson.title);
        const existingLT = await db.prepare('SELECT id FROM lesson_translations WHERE lesson_id=? AND lang=?').get(lesson.id, target_lang);
        if (existingLT) {
          await db.prepare('UPDATE lesson_translations SET title=?, translated_at=SYSTIMESTAMP, is_auto=1 WHERE id=?').run(lt, existingLT.id);
        } else {
          await db.prepare('INSERT INTO lesson_translations (lesson_id, lang, title, is_auto) VALUES (?,?,?,1)').run(lesson.id, target_lang, lt);
        }
      } catch (e) { console.warn(`[Translate] lesson ${lesson.id}:`, e.message); }
    }));
    doneItems += lessons.length;

    // 3. Slides — flatten across lessons
    // regions_json source = zh-TW row (master). Content/notes source = course_slides (master).
    // If any source field is null/empty, target is wiped to match — we always full re-translate.
    const allSlides = [];
    for (const lesson of lessons) {
      for (const slide of lessonSlideMap[lesson.id] || []) {
        const zhTwRow = await db.prepare(
          `SELECT regions_json FROM slide_translations WHERE slide_id=? AND lang='zh-TW'`
        ).get(slide.id);
        const existingST = await db.prepare(
          'SELECT id FROM slide_translations WHERE slide_id=? AND lang=?'
        ).get(slide.id, target_lang);
        allSlides.push({
          id: slide.id,
          content_json: slide.content_json || null,
          notes: slide.notes || null,
          regions_json: zhTwRow?.regions_json || null,  // SOURCE from zh-TW
          existing_st_id: existingST?.id || null,
        });
      }
    }

    // Build the JSON payload sent to LLM for ONE slide — only include fields that have source text
    const buildSlidePayload = (s) => {
      const o = { id: s.id };
      if (s.content_json) { try { o.content = JSON.parse(s.content_json); } catch { o.content = s.content_json; } }
      if (s.notes) o.notes = s.notes;
      if (s.regions_json) { try { o.regions = JSON.parse(s.regions_json); } catch { /* skip */ } }
      return o;
    };

    // Extract translated fields from LLM response; throw if any expected field is missing
    // so the slide falls through to single-retry (avoids wiping a field on partial LLM responses).
    const extractSlideResult = (src, resp) => {
      const out = { content: null, notes: null, regions: null };
      if (src.content_json) {
        if (resp?.content == null) throw new Error('missing content in response');
        out.content = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
        try { JSON.parse(out.content); } catch { throw new Error('invalid content JSON'); }
      }
      if (src.notes) {
        // notes can legitimately be a short/empty string — accept anything string-y
        out.notes = typeof resp?.notes === 'string' ? resp.notes : (resp?.notes ? String(resp.notes) : null);
      }
      if (src.regions_json) {
        if (resp?.regions == null) throw new Error('missing regions in response');
        out.regions = typeof resp.regions === 'string' ? resp.regions : JSON.stringify(resp.regions);
        try { JSON.parse(out.regions); } catch { throw new Error('invalid regions JSON'); }
      }
      return out;
    };

    // Full overwrite — null wipes existing (user wants fresh re-translate every run)
    const writeSlideTranslation = async (slide, t) => {
      if (slide.existing_st_id) {
        await db.prepare(
          `UPDATE slide_translations
           SET content_json=?, notes=?, regions_json=?,
               translated_at=SYSTIMESTAMP, is_auto=1
           WHERE id=?`
        ).run(t.content, t.notes, t.regions, slide.existing_st_id);
      } else {
        await db.prepare(
          'INSERT INTO slide_translations (slide_id, lang, content_json, notes, regions_json, is_auto) VALUES (?,?,?,?,?,1)'
        ).run(slide.id, target_lang, t.content, t.notes, t.regions);
      }
    };

    // Shared slide-translation prompt header
    const slidePromptHeader = `Translate from Traditional Chinese to ${langName}.
Rules:
- Do not translate product names, technical identifiers, or code-like tokens.
- Keep JSON structure, keys, type fields, booleans, numbers, IDs, coords, and audio_url values unchanged.
- For the "regions" object, only translate these string fields if present: label, narration, feedback, feedback_wrong, test_hint, explore_desc, slide_narration, slide_narration_test, slide_narration_explore, completion_message. Leave everything else (coords, id, correct, audio_url) untouched.
- Only translate fields that appear in the input. Do not invent fields.`;

    // Translate one slide (used for single-item batches and as fallback for failed multi-item batches)
    const translateOneSlide = async (slide) => {
      const payload = buildSlidePayload(slide);
      if (Object.keys(payload).length === 1) { // only has id — nothing to translate
        return { content: null, notes: null, regions: null };
      }
      const prompt = `${slidePromptHeader}

Input (a single slide object):
${JSON.stringify(payload)}

Return a JSON object with the SAME "id" and translated fields. Return only valid JSON, no code fences.`;
      const r = await model.generateContent(prompt);
      const parsed = JSON.parse(stripFence(r.response.text()));
      return extractSlideResult(slide, parsed);
    };

    // Translate a batch of N slides in one LLM call; on any failure, retry the batch one-by-one
    const translateSlideBatch = async (batch) => {
      if (batch.length === 1) {
        try {
          const t = await translateOneSlide(batch[0]);
          await writeSlideTranslation(batch[0], t);
          return 1;
        } catch (e) {
          console.warn(`[Translate] slide ${batch[0].id} failed:`, e.message);
          return 0;
        }
      }
      const payload = batch.map(buildSlidePayload);
      const prompt = `${slidePromptHeader}

Input is an array of ${batch.length} slide objects. Translate each one independently.

Input:
${JSON.stringify(payload)}

Return a JSON array of ${batch.length} objects in the SAME order, each with the original "id" and translated fields. Return only valid JSON, no code fences.`;
      let arr;
      try {
        const r = await model.generateContent(prompt);
        arr = JSON.parse(stripFence(r.response.text()));
        if (!Array.isArray(arr)) throw new Error('batch response not an array');
        if (arr.length !== batch.length) throw new Error(`batch length mismatch: got ${arr.length}, want ${batch.length}`);
      } catch (err) {
        // Whole-batch failure — retry every slide singly
        console.warn(`[Translate] batch of ${batch.length} slides failed (${err.message}), retrying one-by-one`);
        let ok = 0;
        for (const slide of batch) {
          try {
            const t = await translateOneSlide(slide);
            await writeSlideTranslation(slide, t);
            ok++;
          } catch (e) { console.warn(`[Translate] slide ${slide.id} single retry failed:`, e.message); }
        }
        return ok;
      }

      // Per-slide apply; queue any item that's missing / malformed for single retry
      const byId = new Map(arr.map(x => [Number(x?.id), x]));
      const retryList = [];
      let ok = 0;
      for (const slide of batch) {
        const resp = byId.get(Number(slide.id));
        if (!resp) { console.warn(`[Translate] slide ${slide.id} missing in batch response`); retryList.push(slide); continue; }
        try {
          const t = extractSlideResult(slide, resp);
          await writeSlideTranslation(slide, t);
          ok++;
        } catch (e) {
          console.warn(`[Translate] slide ${slide.id} extract failed (${e.message}), queuing retry`);
          retryList.push(slide);
        }
      }
      if (retryList.length > 0) {
        console.warn(`[Translate] batch partial (${ok}/${batch.length}), retrying ${retryList.length} singly`);
        for (const slide of retryList) {
          try {
            const t = await translateOneSlide(slide);
            await writeSlideTranslation(slide, t);
            ok++;
          } catch (e) { console.warn(`[Translate] slide ${slide.id} single retry failed:`, e.message); }
        }
      }
      return ok;
    };

    // Quiz batch — same shape
    const writeQuizTranslation = async (q, translatedQ, translatedExp) => {
      const existingQT = await db.prepare('SELECT id FROM quiz_translations WHERE question_id=? AND lang=?').get(q.id, target_lang);
      if (existingQT) {
        await db.prepare('UPDATE quiz_translations SET question_json=?, explanation=?, translated_at=SYSTIMESTAMP, is_auto=1 WHERE id=?')
          .run(translatedQ, translatedExp, existingQT.id);
      } else {
        await db.prepare('INSERT INTO quiz_translations (question_id, lang, question_json, explanation, is_auto) VALUES (?,?,?,?,1)')
          .run(q.id, target_lang, translatedQ, translatedExp);
      }
    };

    const translateOneQuiz = async (q) => {
      const r = await model.generateContent(
        `Translate from Traditional Chinese to ${langName}. Return JSON with two keys: "question_json" (translated JSON) and "explanation" (translated text). Do not translate product names. Keep JSON structure, keys, booleans, numbers, IDs unchanged.
Input: {"question_json": ${q.question_json}, "explanation": ${JSON.stringify(q.explanation || '')}}
Return only valid JSON, no code fences.`
      );
      const parsed = JSON.parse(stripFence(r.response.text()));
      const translatedQ = typeof parsed.question_json === 'string' ? parsed.question_json : JSON.stringify(parsed.question_json);
      const translatedExp = parsed.explanation || null;
      await writeQuizTranslation(q, translatedQ, translatedExp);
    };

    const translateQuizBatch = async (batch) => {
      if (batch.length === 1) {
        try { await translateOneQuiz(batch[0]); return 1; }
        catch (e) { console.warn(`[Translate] question ${batch[0].id} failed:`, e.message); return 0; }
      }
      const payload = batch.map(q => ({
        id: q.id,
        question: (() => { try { return JSON.parse(q.question_json); } catch { return q.question_json; } })(),
        explanation: q.explanation || null,
      }));
      const prompt = `Translate from Traditional Chinese to ${langName}.
Rules:
- Do not translate product names or technical identifiers.
- Keep JSON structure, keys, booleans, numbers, IDs unchanged.
- Input is an array of ${batch.length} quiz question objects.

Input:
${JSON.stringify(payload)}

Return a JSON array of ${batch.length} objects in the SAME order, each with original "id" and translated "question" and "explanation". Return only valid JSON, no code fences.`;
      try {
        const r = await model.generateContent(prompt);
        const arr = JSON.parse(stripFence(r.response.text()));
        if (!Array.isArray(arr) || arr.length !== batch.length) throw new Error('quiz batch length mismatch');
        const byId = new Map(arr.map(x => [Number(x?.id), x]));
        let ok = 0;
        for (const q of batch) {
          const resp = byId.get(Number(q.id));
          if (!resp) break;
          const translatedQ = typeof resp.question === 'string' ? resp.question : JSON.stringify(resp.question);
          const translatedExp = resp.explanation || null;
          await writeQuizTranslation(q, translatedQ, translatedExp);
          ok++;
        }
        if (ok === batch.length) return ok;
        for (const q of batch.slice(ok)) {
          try { await translateOneQuiz(q); ok++; }
          catch (e) { console.warn(`[Translate] question ${q.id} single retry failed:`, e.message); }
        }
        return ok;
      } catch (err) {
        console.warn(`[Translate] quiz batch of ${batch.length} failed (${err.message}), retrying one-by-one`);
        let ok = 0;
        for (const q of batch) {
          try { await translateOneQuiz(q); ok++; }
          catch (e) { console.warn(`[Translate] question ${q.id} single retry failed:`, e.message); }
        }
        return ok;
      }
    };

    // Chunk helpers
    const chunk = (arr, size) => {
      const out = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };
    const slideBatches = chunk(allSlides, SLIDE_BATCH);
    const quizBatches = chunk(questions, QUIZ_BATCH);

    // Run slide batches + quiz batches in parallel with shared CONCURRENCY limiter
    const limit = pLimit(CONCURRENCY);
    let slidesDoneCount = 0;
    let quizDoneCount = 0;

    const slideJobs = slideBatches.map(batch => limit(async () => {
      await translateSlideBatch(batch);
      slidesDoneCount += batch.length;
      doneItems += batch.length;
      send('progress', {
        current: doneItems, total: totalItems,
        step: `翻譯投影片 ${slidesDoneCount}/${totalSlides}...`,
        slides_done: slidesDoneCount, slides_total: totalSlides,
      });
    }));

    const quizJobs = quizBatches.map(batch => limit(async () => {
      await translateQuizBatch(batch);
      quizDoneCount += batch.length;
      doneItems += batch.length;
      send('progress', {
        current: doneItems, total: totalItems,
        step: `翻譯題目 ${quizDoneCount}/${questions.length}...`,
      });
    }));

    await Promise.all([...slideJobs, ...quizJobs]);

    send('done', { ok: true, translated: { lessons: lessons.length, slides: totalSlides, questions: questions.length } });
  } catch (e) {
    console.error('[Training] translate:', e.message);
    send('error', { error: e.message });
  } finally {
    res.end();
  }
});

// POST /api/training/courses/:id/generate-lang-tts — SSE streaming, parallel TTS generation
router.post('/courses/:id/generate-lang-tts', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  const { target_lang } = req.body;
  if (!target_lang || target_lang === 'zh-TW') return res.status(400).json({ error: 'target_lang required (en/vi)' });

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (type, data) => { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); };

  try {
    const lessons = await db.prepare('SELECT id FROM course_lessons WHERE course_id=? ORDER BY sort_order').all(req.courseId);
    const ttsModel = await db.prepare(
      `SELECT api_key_enc FROM llm_models WHERE model_role='tts' AND is_active=1 ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
    ).get();
    if (!ttsModel) { send('error', { error: 'TTS 模型未設定' }); return res.end(); }

    const { decryptKey } = require('../services/llmKeyService');
    const ttsApiKey = decryptKey(ttsModel.api_key_enc);
    const { voiceName, langCode, speed, pitch } = await resolveTtsVoice(req.courseId, target_lang);
    const ttsUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${ttsApiKey}`;
    const dir = path.join(uploadDir, `course_${req.courseId}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    const genAudio = async (text, fileId, retries = 2) => {
      if (!text || !text.trim()) return null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          if (attempt > 0) await delay(1500 * attempt); // backoff: 1.5s, 3s
          const r = await fetch(ttsUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: { text: preprocessTtsText(text) }, voice: { languageCode: langCode, name: voiceName }, audioConfig: { audioEncoding: 'MP3', speakingRate: speed, pitch } })
          });
          if (r.status === 429) {
            console.warn(`[TTS batch] Rate limited (429) for ${fileId}, attempt ${attempt + 1}`);
            if (attempt < retries) continue;
            return null;
          }
          if (!r.ok) {
            const errText = await r.text().catch(() => '');
            console.error(`[TTS batch] API error ${r.status} for ${fileId}:`, errText.slice(0, 200));
            return null;
          }
          const json = await r.json();
          if (!json.audioContent) { console.error(`[TTS batch] Empty audioContent for ${fileId}`); return null; }
          const buf = Buffer.from(json.audioContent, 'base64');
          if (buf.length < 100) { console.error(`[TTS batch] Audio too short for ${fileId}: ${buf.length}b`); return null; }
          const fn = `tts_${target_lang}_${fileId}_${Date.now()}.mp3`;
          fs.writeFileSync(path.join(dir, fn), buf);
          return `/api/training/files/course_${req.courseId}/${fn}`;
        } catch (e) {
          console.error(`[TTS batch] Exception for ${fileId} attempt ${attempt + 1}:`, e.message);
          if (attempt >= retries) return null;
        }
      }
      return null;
    };

    // ─── Phase 1: preload all slides and build a flat task list ───────────────
    send('status', { message: '掃描投影片...' });
    const slideEntries = []; // { transId, blocks, notesText, notesUrl, contentChanged }
    const tasks = [];        // { kind, text, fileId, apply: (url) => void }

    for (const lesson of lessons) {
      const slides = await db.prepare('SELECT id FROM course_slides WHERE lesson_id=? ORDER BY sort_order').all(lesson.id);
      for (const slide of slides) {
        const trans = await db.prepare(
          'SELECT id, content_json, notes, audio_url FROM slide_translations WHERE slide_id=? AND lang=?'
        ).get(slide.id, target_lang);
        if (!trans) continue;

        const entry = { transId: trans.id, blocks: null, notesUrl: null, contentChanged: false };
        slideEntries.push(entry);

        // Slide-level notes audio
        if (trans.notes && trans.notes.trim()) {
          tasks.push({
            kind: 'slide_notes',
            text: trans.notes,
            fileId: `slide_${slide.id}_notes`,
            apply: (url) => { entry.notesUrl = url; },
          });
        }

        if (!trans.content_json) continue;
        let blocks;
        try { blocks = JSON.parse(trans.content_json); } catch { continue; }
        entry.blocks = blocks;

        for (const tb of blocks) {
          if (tb.type !== 'hotspot') continue;
          // Intro narrations
          for (const f of ['slide_narration', 'slide_narration_test', 'slide_narration_explore']) {
            if (tb[f]) {
              tasks.push({
                kind: 'intro',
                text: tb[f],
                fileId: `${slide.id}_${f}`,
                apply: (url) => { tb[f + '_audio'] = url; entry.contentChanged = true; },
              });
            }
          }
          // Region narrations
          if (tb.regions) {
            for (const reg of tb.regions.filter(r => r.correct)) {
              for (const p of [
                { text: 'narration', audio: 'audio_url' },
                { text: 'test_hint', audio: 'test_audio_url' },
                { text: 'explore_desc', audio: 'explore_audio_url' },
              ]) {
                if (reg[p.text]) {
                  tasks.push({
                    kind: 'region',
                    text: reg[p.text],
                    fileId: `${slide.id}_${p.text}_${reg.id}`,
                    apply: (url) => { reg[p.audio] = url; entry.contentChanged = true; },
                  });
                }
              }
            }
          }
        }
      }
    }

    const total = tasks.length;
    send('progress', { current: 0, total, step: `準備生成 ${total} 個語音檔...` });

    if (total === 0) {
      send('done', { ok: true, generated: 0, failed: 0 });
      return res.end();
    }

    // ─── Phase 2: run all TTS tasks in parallel with pLimit(10) ───────────────
    const TTS_CONCURRENCY = 10;
    const limit = pLimit(TTS_CONCURRENCY);
    let done = 0, generated = 0, failed = 0;

    await Promise.all(tasks.map(task => limit(async () => {
      const url = await genAudio(task.text, task.fileId);
      if (url) { task.apply(url); generated++; }
      else { failed++; }
      done++;
      send('progress', {
        current: done, total,
        step: `生成語音 ${done}/${total}(成功 ${generated},失敗 ${failed})...`,
        generated, failed,
      });
    })));

    // ─── Phase 3: flush DB updates per slide ──────────────────────────────────
    send('status', { message: '寫入資料庫...' });
    for (const entry of slideEntries) {
      if (entry.notesUrl) {
        await db.prepare('UPDATE slide_translations SET audio_url=? WHERE id=?').run(entry.notesUrl, entry.transId);
      }
      if (entry.contentChanged && entry.blocks) {
        await db.prepare('UPDATE slide_translations SET content_json=? WHERE id=?').run(JSON.stringify(entry.blocks), entry.transId);
      }
    }

    console.log(`[TTS batch] ${target_lang}: generated=${generated} failed=${failed} total=${total}`);
    send('done', { ok: true, generated, failed, total });
    res.end();
  } catch (e) {
    console.error('[Training] generate-lang-tts:', e.message);
    try { send('error', { error: e.message }); } catch {}
    try { res.end(); } catch {}
  }
});

// GET translation status
router.get('/courses/:id/translate/status', loadCoursePermission, async (req, res) => {
  try {
    const langs = ['en', 'vi'];
    const status = {};
    for (const lang of langs) {
      const ct = await db.prepare('SELECT translated_at FROM course_translations WHERE course_id=? AND lang=?').get(req.courseId, lang);
      const slideTotal = await db.prepare(`
        SELECT COUNT(*) AS total FROM course_slides WHERE lesson_id IN (SELECT id FROM course_lessons WHERE course_id=?)
      `).get(req.courseId);
      const slideTrans = await db.prepare(`
        SELECT COUNT(*) AS cnt FROM slide_translations WHERE lang=? AND slide_id IN (
          SELECT id FROM course_slides WHERE lesson_id IN (SELECT id FROM course_lessons WHERE course_id=?)
        )
      `).get(lang, req.courseId);
      status[lang] = {
        course_translated: !!ct,
        slides_total: slideTotal?.total || 0,
        slides_translated: slideTrans?.cnt || 0,
        last_translated: ct?.translated_at || null
      };
    }
    res.json(status);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Admin Reports
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/admin/reports/overview', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });

    const totalCourses = await db.prepare("SELECT COUNT(*) AS cnt FROM courses WHERE status='published'").get();
    const totalUsers = await db.prepare("SELECT COUNT(DISTINCT user_id) AS cnt FROM user_course_progress").get();
    const completions = await db.prepare("SELECT COUNT(*) AS cnt FROM user_course_progress WHERE status='completed' AND lesson_id IS NULL").get();
    const avgScore = await db.prepare("SELECT AVG(score) AS avg_score FROM quiz_attempts WHERE completed_at IS NOT NULL").get();
    const passRate = await db.prepare(`
      SELECT COUNT(CASE WHEN passed=1 THEN 1 END) AS passed,
             COUNT(*) AS total
      FROM quiz_attempts WHERE completed_at IS NOT NULL
    `).get();

    res.json({
      total_courses: totalCourses?.cnt || 0,
      active_learners: totalUsers?.cnt || 0,
      completions: completions?.cnt || 0,
      avg_score: Math.round(avgScore?.avg_score || 0),
      pass_rate: passRate?.total > 0 ? Math.round((passRate.passed / passRate.total) * 100) : 0
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/reports/by-course', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
    const rows = await db.prepare(`
      SELECT c.id, c.title,
             COUNT(DISTINCT ucp.user_id) AS learners,
             COUNT(CASE WHEN ucp.status='completed' THEN 1 END) AS completions,
             (SELECT AVG(score) FROM quiz_attempts qa WHERE qa.course_id=c.id AND qa.completed_at IS NOT NULL) AS avg_score
      FROM courses c
      LEFT JOIN user_course_progress ucp ON ucp.course_id=c.id AND ucp.lesson_id IS NULL
      WHERE c.status='published'
      GROUP BY c.id, c.title
      ORDER BY learners DESC
    `).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/reports/by-user', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
    const rows = await db.prepare(`
      SELECT u.id, u.name, u.employee_id, u.dept_code,
             COUNT(DISTINCT ucp.course_id) AS courses_started,
             COUNT(CASE WHEN ucp.status='completed' THEN 1 END) AS courses_completed,
             (SELECT AVG(score) FROM quiz_attempts qa WHERE qa.user_id=u.id AND qa.completed_at IS NOT NULL) AS avg_score
      FROM users u
      JOIN user_course_progress ucp ON ucp.user_id=u.id AND ucp.lesson_id IS NULL
      GROUP BY u.id, u.name, u.employee_id, u.dept_code
      ORDER BY courses_completed DESC
    `).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2A: AI Screenshot Analysis
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/training/ai/analyze-screenshot — single screenshot → hotspot regions
router.post('/ai/analyze-screenshot', upload.single('screenshot'), async (req, res) => {
  try {
    let imageBase64;
    if (req.file) {
      imageBase64 = fs.readFileSync(req.file.path).toString('base64');
    } else if (req.body.screenshot_base64) {
      imageBase64 = req.body.screenshot_base64.replace(/^data:image\/\w+;base64,/, '');
    } else if (req.body.screenshot_url) {
      const absPath = path.join(UPLOAD_ROOT, req.body.screenshot_url.replace(/^\/api\/training\/files\//, ''));
      if (fs.existsSync(absPath)) imageBase64 = fs.readFileSync(absPath).toString('base64');
      else return res.status(404).json({ error: '截圖檔案不存在' });
    } else {
      return res.status(400).json({ error: '需提供 screenshot (file/base64/url)' });
    }

    const clickCoords = req.body.click_coords || null;
    const context = req.body.context || '';

    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const flashRow = await db.prepare(
      `SELECT api_model FROM llm_models WHERE model_role='chat' AND is_active=1 AND provider_type='gemini' ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
    ).get();
    const model = genAI.getGenerativeModel({ model: flashRow?.api_model || process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview' });

    const clickInfo = clickCoords ? `使用者剛點擊了位於 (x:${clickCoords.x}px, y:${clickCoords.y}px) 的元素。` : '';

    const prompt = `分析這張系統操作截圖。${clickInfo}${context ? `背景: ${context}` : ''}

請完成以下任務：
1. 識別畫面中所有可互動的 UI 元素（按鈕、輸入框、連結、下拉選單、checkbox、tab 等）
2. 回傳每個元素的：
   - coords: { x, y, w, h } 百分比座標（相對於圖片左上角，0-100）
   - type: button | input | link | select | checkbox | tab | menu | icon
   - label: 元素的文字或功能說明（繁體中文）
   - is_primary: 是否為此畫面的主要操作點${clickCoords ? '（使用者剛點擊的元素 = true）' : ''}
3. 生成此畫面的操作說明（instruction，1-2 句）
4. 生成旁白文字（narration，口語化，適合 TTS 朗讀）
5. 偵測是否包含敏感資訊（密碼欄位、個資、帳號密碼）

只回傳 JSON，不要 markdown code fence：
{
  "regions": [{ "type": "...", "label": "...", "coords": { "x": 0, "y": 0, "w": 0, "h": 0 }, "is_primary": false }],
  "instruction": "...",
  "narration": "...",
  "sensitive_areas": [{ "type": "password", "coords": { "x": 0, "y": 0, "w": 0, "h": 0 } }]
}`;

    let parsed, lastRaw = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await model.generateContent([
          { inlineData: { mimeType: 'image/png', data: imageBase64 } },
          { text: prompt }
        ]);
        const text = result.response.text();
        lastRaw = text;
        const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(cleaned);
        break;
      } catch (parseErr) {
        console.warn(`[Training] AI analyze attempt ${attempt + 1} failed:`, parseErr.message);
        if (attempt === 2) {
          if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
          return res.status(500).json({ error: 'AI 回覆格式錯誤（已重試 3 次）', raw: lastRaw.slice(0, 500) });
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Clean up uploaded temp file
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}

    res.json(parsed);
  } catch (e) {
    console.error('[Training] AI analyze screenshot:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/slides/:sid/generate-narration — AI generates full narration suite
router.post('/slides/:sid/generate-narration', async (req, res) => {
  // Phase 1: All DB queries upfront
  let slideData, checkResult, flashModel, langRegionsData, langImageOverrides;
  try {
    const slide = await db.prepare('SELECT lesson_id, content_json FROM course_slides WHERE id=?').get(req.params.sid);
    if (!slide) return res.status(404).json({ error: '投影片不存在' });
    const check = await verifyLessonAccess(slide.lesson_id, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });
    const flashRow = await db.prepare(
      `SELECT api_model FROM llm_models WHERE model_role='chat' AND is_active=1 AND provider_type='gemini' ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
    ).get();
    // If lang specified, load independent regions + language image
    const lang = req.body.lang;
    if (lang && lang !== 'zh-TW') {
      const trans = await db.prepare('SELECT regions_json, image_overrides FROM slide_translations WHERE slide_id=? AND lang=?').get(req.params.sid, lang);
      if (trans?.regions_json) { try { langRegionsData = JSON.parse(trans.regions_json); } catch {} }
      if (trans?.image_overrides) { try { langImageOverrides = JSON.parse(trans.image_overrides); } catch {} }
    }
    slideData = slide;
    checkResult = check;
    flashModel = flashRow?.api_model || process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview';
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  // Phase 2: Process data + call Gemini
  try {
    const { block_index, editor_context, lang } = req.body;
    const idx = Number(block_index || 0);
    let blocks;
    try { blocks = JSON.parse(slideData.content_json || '[]'); } catch { blocks = []; }
    const block = blocks[idx];
    if (!block) return res.status(400).json({ error: '找不到指定的 block' });

    // Use independent regions if available for this language
    const regions = (lang && langRegionsData?.[String(idx)]) || block.regions || [];
    const correctRegions = regions.filter(r => r.correct);
    // Use language-specific image if available
    const langImage = langImageOverrides?.[String(idx)] || null;
    const regionDesc = correctRegions.map((r, i) =>
      `步驟${i + 1}: 「${r.label || r.id}」(${r.type || 'element'}) - ${r.feedback || ''}`
    ).join('\n');

    let imageParts = [];
    const imageUrl = langImage || block.image;
    if (imageUrl) {
      const imgPath = path.join(UPLOAD_ROOT, imageUrl.replace(/^\/api\/training\/files\//, ''));
      if (fs.existsSync(imgPath)) {
        const imgBase64 = fs.readFileSync(imgPath).toString('base64');
        const ext = path.extname(imgPath).toLowerCase();
        const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
        imageParts = [{ inlineData: { mimeType: mimeMap[ext] || 'image/png', data: imgBase64 } }];
      }
    }

    const langNames = { 'zh-TW': '繁體中文', 'en': 'English', 'vi': 'Tiếng Việt' };
    const targetLang = lang || 'zh-TW';
    const targetLangName = langNames[targetLang] || targetLang;
    const langInstruction = targetLang !== 'zh-TW' ? `\n\n## 重要：請用 ${targetLangName} 生成所有文字內容（narration, test_hint, explore_desc, feedback 等）\n` : '';

    const isDemoMode = block.interaction_mode === 'demo';
    const prompt = isDemoMode
    ? `你是教育訓練語音導覽腳本生成專家。這是一個「展示模式」投影片，只需要解說，不需要任何互動操作。${langInstruction}

## 畫面說明
${block.instruction || '（無）'}

## 解說重點（共 ${correctRegions.length} 個）
${regionDesc || '（無）'}

## 編輯者補充說明
${editor_context || '（無）'}

## 重要規則
- 這是純展示模式，**不要**使用「請點擊」「請操作」「試試看」等互動用語
- 用「這裡是」「接下來看到的是」「畫面上方的是」等解說用語
- 語氣像導覽員介紹系統功能，不是要求學員操作

## 請生成以下內容（全部口語化，適合 TTS 朗讀）

### 1. 前導語音
- **slide_narration**：完整介紹這個畫面的功能和用途。2-4 句。

### 2. 每個解說點的語音（按順序）
每個解說點需要：
- **narration**：解說這個區域是什麼、有什麼功能。1-2 句。用「這裡是」「這個區域用來」等說明語氣。

### 3. 完成訊息
- **completion_message**：解說完成的結語。1 句。

只回傳 JSON，不要 markdown code fence：
{
  "slide_narration": "現在讓我們來了解...",
  "slide_narration_test": "",
  "slide_narration_explore": "",
  "regions": [
    {
      "id": "region id",
      "narration": "這裡是...",
      "test_hint": "",
      "explore_desc": "",
      "feedback_correct": "",
      "feedback_wrong": ""
    }
  ],
  "completion_message": "以上就是..."
}`
    : `你是教育訓練語音導覽腳本生成專家。請根據以下資訊，生成完整的三種模式語音導覽腳本。${langInstruction}

## 畫面操作指引
${block.instruction || '（無）'}

## 操作步驟（共 ${correctRegions.length} 步）
${regionDesc || '（無步驟資訊）'}

## 編輯者補充說明
${editor_context || '（無）'}

## 請生成以下內容（全部口語化，適合 TTS 朗讀，自然親切）

### 1. 三種模式的前導語音
- **slide_narration**（🎯 導引模式）：完整介紹畫面功能、操作目的、步驟概述。融入編輯者補充說明。2-4 句。
- **slide_narration_test**（📝 測驗模式）：簡短告知要完成什麼任務，不劇透步驟細節。1-2 句，帶鼓勵語氣。
- **slide_narration_explore**（🔍 探索模式）：引導自由探索，提示畫面上有哪些元素可以點擊了解。1-2 句。

### 2. 每個步驟的語音（按 regions 順序）
每個步驟需要：
- **narration**：導引模式 — 告訴學員具體操作位置和方法，像老師在旁邊指導。1-2 句。
- **test_hint**：測驗模式 — 不直接告訴位置，給方向性提示，帶鼓勵語氣。1 句。
- **explore_desc**：探索模式 — 說明這個元素的功能和用途，像導覽員介紹。1-2 句。
- **feedback_correct**：點對時的鼓勵回饋。短句，有變化不重複。
- **feedback_wrong**：點錯時的友善引導回饋。短句。

### 3. 完成訊息
- **completion_message**：全部完成時的恭喜訊息。1 句。

只回傳 JSON，不要 markdown code fence：
{
  "slide_narration": "歡迎來到...",
  "slide_narration_test": "接下來請...",
  "slide_narration_explore": "這是...",
  "regions": [
    {
      "id": "步驟對應的 region id",
      "narration": "請在...",
      "test_hint": "提示：...",
      "explore_desc": "這個是...",
      "feedback_correct": "太棒了！...",
      "feedback_wrong": "不太對，..."
    }
  ],
  "completion_message": "恭喜！你已經..."
}`;

    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: flashModel });

    // Retry up to 3 times on JSON parse failure (Gemini occasionally returns malformed JSON)
    let parsed, lastRaw = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [...imageParts, { text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        });
        const text = result.response.text();
        lastRaw = text;

        // Strip markdown code fences if present
        const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        // Try direct parse first, then regex extraction, then position-based truncation
        try {
          parsed = JSON.parse(cleaned);
        } catch (directErr) {
          // Fallback 1: extract outermost { ... } with balanced braces
          const start = cleaned.indexOf('{');
          if (start >= 0) {
            let depth = 0, end = -1;
            for (let i = start; i < cleaned.length; i++) {
              if (cleaned[i] === '{') depth++;
              else if (cleaned[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
            }
            if (end > start) {
              try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch {}
            }
          }
          // Fallback 2: error tells us the valid JSON length — truncate there
          if (!parsed) {
            const posMatch = directErr.message.match(/position\s+(\d+)/i);
            if (posMatch) {
              try { parsed = JSON.parse(cleaned.slice(0, parseInt(posMatch[1]))); } catch {}
            }
          }
          if (!parsed) throw directErr;
        }
        break; // success
      } catch (parseErr) {
        console.warn(`[Training] Generate narration attempt ${attempt + 1} failed:`, parseErr.message);
        if (attempt === 2) {
          return res.status(500).json({ error: 'AI 回覆格式錯誤（已重試 3 次）', raw: lastRaw.slice(0, 500) });
        }
        // Brief delay before retry
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    res.json(parsed);
  } catch (e) {
    console.error('[Training] Generate narration:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/ai/generate-outline — from help section → operation steps
router.post('/ai/generate-outline', async (req, res) => {
  try {
    const { system_id, help_section_id, help_content, system_url } = req.body;

    let content = help_content || '';

    // If help_section_id provided, read from DB or seed data
    if (help_section_id && !content) {
      // Try help_translations first
      try {
        const section = await db.prepare(
          `SELECT t.blocks_json FROM help_translations t WHERE t.section_id=? AND t.lang='zh-TW'`
        ).get(help_section_id);
        if (section?.blocks_json) {
          const blocks = JSON.parse(section.blocks_json);
          const extractText = (bls) => {
            if (!Array.isArray(bls)) return '';
            return bls.map(b => {
              const parts = [];
              if (b.title) parts.push(b.title);
              if (b.text) parts.push(b.text);
              if (b.items) parts.push(b.items.map(i => typeof i === 'string' ? i : `${i.title || ''}${i.desc ? ': ' + i.desc : ''}`).join('\n'));
              if (b.blocks) parts.push(extractText(b.blocks));
              return parts.filter(Boolean).join('\n');
            }).filter(Boolean).join('\n');
          };
          content = extractText(blocks);
        }
      } catch {}
      // Fallback: try helpSeedData.js directly
      if (!content) {
        try {
          const seedData = require('../data/helpSeedData');
          const allSections = [...(seedData.userSections || []), ...(seedData.adminSections || [])];
          const seed = allSections.find(s => s.id === help_section_id);
          if (seed?.blocks) {
            // Recursive block text extraction
            const extractText = (blocks) => {
              if (!Array.isArray(blocks)) return '';
              return blocks.map(b => {
                const parts = [];
                if (b.title) parts.push(b.title);
                if (b.text) parts.push(b.text);
                if (b.items) parts.push(b.items.map(i => typeof i === 'string' ? i : `${i.title || ''}${i.desc ? ': ' + i.desc : ''}`).join('\n'));
                if (b.blocks) parts.push(extractText(b.blocks)); // subsection
                if (b.headers) parts.push(b.headers.join(' | ')); // table
                if (b.rows) parts.push(b.rows.map(r => r.join(' | ')).join('\n'));
                return parts.filter(Boolean).join('\n');
              }).filter(Boolean).join('\n');
            };
            content = extractText(seed.blocks);
          }
        } catch (e) { console.warn('[Training] helpSeedData fallback:', e.message); }
      }
    }

    if (!content.trim()) return res.status(400).json({ error: '無法取得章節內容' });

    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const flashRow = await db.prepare(
      `SELECT api_model FROM llm_models WHERE model_role='chat' AND is_active=1 AND provider_type='gemini' ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
    ).get();
    const model = genAI.getGenerativeModel({ model: flashRow?.api_model || process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview' });

    const prompt = `根據以下系統操作說明文件，拆解成詳細的操作步驟清單。
${system_url ? `目標系統 URL: ${system_url}` : ''}

說明文件內容：
---
${content.slice(0, 6000)}
---

回傳 JSON 陣列，每個步驟包含：
- order: 步驟序號
- instruction: 操作指示（清楚描述要做什麼）
- expected_element: 預期要操作的 UI 元素描述（如「登入按鈕」、「帳號輸入框」）
- tips: 操作提示或注意事項
- action_type: click | input | navigate | select | confirm

只回傳 JSON 陣列，不要 markdown：
[{ "order": 1, "instruction": "...", "expected_element": "...", "tips": "...", "action_type": "..." }]`;

    let steps, lastRaw = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        lastRaw = text;
        const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
        steps = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(cleaned);
        break;
      } catch (parseErr) {
        console.warn(`[Training] AI outline attempt ${attempt + 1} failed:`, parseErr.message);
        if (attempt === 2) return res.status(500).json({ error: 'AI 回覆格式錯誤（已重試 3 次）', raw: lastRaw.slice(0, 500) });
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    res.json({ steps });
  } catch (e) {
    console.error('[Training] AI generate outline:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/ai/batch-analyze — analyze multiple screenshots at once
router.post('/ai/batch-analyze', upload.array('screenshots', 50), async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: '需提供截圖檔案' });

    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const flashRow = await db.prepare(
      `SELECT api_model FROM llm_models WHERE model_role='chat' AND is_active=1 AND provider_type='gemini' ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
    ).get();
    const model = genAI.getGenerativeModel({ model: flashRow?.api_model || process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview' });

    // Parallel analysis in batches of 3
    const BATCH = 3;
    const analyzeOne = async (file, i) => {
      const imageBase64 = fs.readFileSync(file.path).toString('base64');
      const prompt = `分析這張系統操作截圖（第 ${i + 1}/${files.length} 張）。
識別所有可互動的 UI 元素，回傳 JSON：
{
  "regions": [{ "type": "button|input|link|select", "label": "...", "coords": { "x": 0, "y": 0, "w": 0, "h": 0 }, "is_primary": false }],
  "instruction": "這個畫面的操作說明",
  "narration": "旁白文字（口語化）"
}
只回傳 JSON。`;
      try {
        const result = await model.generateContent([
          { inlineData: { mimeType: file.mimetype, data: imageBase64 } },
          { text: prompt }
        ]);
        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { regions: [], instruction: '', narration: '' };
        return { index: i, filename: file.originalname, ...parsed };
      } catch (err) {
        return { index: i, filename: file.originalname, error: err.message, regions: [] };
      } finally {
        try { fs.unlinkSync(file.path); } catch {}
      }
    };

    const results = [];
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const batchResults = await Promise.all(batch.map((f, j) => analyzeOne(f, i + j)));
      results.push(...batchResults);
    }

    res.json({ results, total: files.length });
  } catch (e) {
    console.error('[Training] AI batch analyze:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2B+C: Recording Sessions
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/training/recording/start
router.post('/recording/start', async (req, res) => {
  try {
    const { course_id, lesson_id, system_id, script_id, config } = req.body;
    const id = uuidv4();
    await db.prepare(`
      INSERT INTO recording_sessions (id, course_id, lesson_id, system_id, script_id, config_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, course_id || null, lesson_id || null, system_id || null, script_id || null,
           config ? JSON.stringify(config) : null, req.user.id);
    res.json({ session_id: id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/recording/:sessionId/step — Extension uploads a step
// Phase 2E: supports screenshot_raw_base64 + annotations_json
// Phase 3A-1: screenshot_base64 is ALWAYS a clean image (no burned annotations).
// Annotations stored separately in annotations_json. No more screenshot_raw_base64.
router.post('/recording/:sessionId/step', upload.single('screenshot'), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { step_number, action_type, screenshot_base64, screenshot_raw_base64,
            annotations_json, lang, element_info, viewport, page_url, page_title } = req.body;

    const dir = path.join(uploadDir, 'recordings');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Save screenshot (always clean — no burned annotations)
    let screenshotUrl = null;
    if (req.file) {
      screenshotUrl = `/api/training/files/${req.file.filename}`;
    } else if (screenshot_base64) {
      const base64Data = screenshot_base64.replace(/^data:image\/\w+;base64,/, '');
      const filename = `rec_${sessionId}_${step_number}_${Date.now()}.png`;
      fs.writeFileSync(path.join(dir, filename), Buffer.from(base64Data, 'base64'));
      screenshotUrl = `/api/training/files/recordings/${filename}`;
    }

    // Backward compat: if old extension still sends screenshot_raw_base64, save it as primary
    if (!screenshotUrl && screenshot_raw_base64) {
      const rawBase64 = screenshot_raw_base64.replace(/^data:image\/\w+;base64,/, '');
      const filename = `rec_${sessionId}_${step_number}_${Date.now()}.png`;
      fs.writeFileSync(path.join(dir, filename), Buffer.from(rawBase64, 'base64'));
      screenshotUrl = `/api/training/files/recordings/${filename}`;
    }

    const elementJson = typeof element_info === 'string' ? element_info : JSON.stringify(element_info || null);
    const viewportJson = typeof viewport === 'string' ? viewport : JSON.stringify(viewport || null);
    const annotationsStr = annotations_json || null;

    const result = await db.prepare(`
      INSERT INTO recording_steps (session_id, step_number, action_type, screenshot_url,
                                    annotations_json, lang, element_json, viewport_json, page_url, page_title)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, step_number || 0, action_type || 'screenshot',
           screenshotUrl, annotationsStr, lang || 'zh-TW',
           elementJson, viewportJson, page_url || null, page_title || null);

    await db.prepare('UPDATE recording_sessions SET steps_count=steps_count+1 WHERE id=?').run(sessionId);

    console.log(`[Recording DEBUG] INSERT OK: sid="${sessionId}" step_id=${result.lastInsertRowid} screenshot=${screenshotUrl}`);
    // Verify the insert is readable
    const verify = await db.prepare('SELECT COUNT(*) AS cnt FROM recording_steps WHERE session_id=?').get(sessionId);
    console.log(`[Recording DEBUG] Verify: ${verify?.cnt} steps for sid="${sessionId}"`);

    res.json({ step_id: result.lastInsertRowid, screenshot_url: screenshotUrl });
  } catch (e) {
    console.error('[Training] recording step:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/recording/:sessionId — get session + all steps
router.get('/recording/:sessionId', async (req, res) => {
  try {
    const sid = req.params.sessionId;
    const session = await db.prepare('SELECT * FROM recording_sessions WHERE id=?').get(sid);
    if (!session) return res.status(404).json({ error: '錄製工作階段不存在' });
    const steps = await db.prepare(
      'SELECT * FROM recording_steps WHERE session_id=? ORDER BY step_number'
    ).all(sid);
    // Debug: if no steps found, check total count and sample
    if (steps.length === 0) {
      const total = await db.prepare('SELECT COUNT(*) AS cnt FROM recording_steps WHERE session_id=?').get(sid);
      const anyStep = await db.prepare('SELECT id, session_id, step_number FROM recording_steps WHERE ROWNUM <= 3 ORDER BY id DESC').get();
      console.log(`[Recording DEBUG] sid="${sid}" steps=0, count=${total?.cnt}, session.steps_count=${session.steps_count}, latest_step=`, anyStep);
    }
    res.json({ ...session, steps });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/training/recording/:sessionId/steps — batch update step_number + lang + annotations_json
router.put('/recording/:sessionId/steps', async (req, res) => {
  try {
    const { updates } = req.body; // [{ id, step_number, lang, annotations_json }, ...]
    if (!Array.isArray(updates)) return res.status(400).json({ error: 'updates array required' });
    for (const u of updates) {
      if (!u.id) continue;
      const sets = [];
      const params = [];
      if (u.step_number !== undefined) { sets.push('step_number=?'); params.push(u.step_number); }
      if (u.lang !== undefined) { sets.push('lang=?'); params.push(u.lang); }
      if (u.annotations_json !== undefined) { sets.push('annotations_json=?'); params.push(u.annotations_json); }
      if (sets.length === 0) continue;
      params.push(u.id, req.params.sessionId);
      await db.prepare(`UPDATE recording_steps SET ${sets.join(',')} WHERE id=? AND session_id=?`).run(...params);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/training/recording/:sessionId/steps — bulk delete (for draft sync)
// Body: { ids: number[] } — step IDs to remove (must belong to this session)
// Also unlinks the screenshot files on disk best-effort.
router.delete('/recording/:sessionId/steps', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.json({ ok: true, deleted: 0 });
    }
    let deleted = 0;
    for (const rawId of ids) {
      const id = Number(rawId);
      if (!id) continue;
      // Fetch screenshot_url BEFORE delete so we can unlink the file
      const row = await db.prepare(
        'SELECT screenshot_url FROM recording_steps WHERE id=? AND session_id=?'
      ).get(id, sessionId);
      if (!row) continue;
      const result = await db.prepare(
        'DELETE FROM recording_steps WHERE id=? AND session_id=?'
      ).run(id, sessionId);
      if (result.changes > 0 || result.lastInsertRowid !== undefined) deleted++;
      // Best-effort file unlink
      if (row.screenshot_url) {
        try {
          const rel = String(row.screenshot_url).replace(/^\/api\/training\/files\//, '');
          const abs = path.join(UPLOAD_ROOT, 'training', rel);
          if (fs.existsSync(abs)) fs.unlinkSync(abs);
        } catch (err) {
          console.warn('[Training] unlink step file failed:', err.message);
        }
      }
    }
    // Refresh session steps_count to reality (avoid drift)
    await db.prepare(
      'UPDATE recording_sessions SET steps_count=(SELECT COUNT(*) FROM recording_steps WHERE session_id=?) WHERE id=?'
    ).run(sessionId, sessionId);
    res.json({ ok: true, deleted });
  } catch (e) {
    console.error('[Training] delete steps:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/recording/:sessionId/complete
router.post('/recording/:sessionId/complete', async (req, res) => {
  try {
    await db.prepare(
      `UPDATE recording_sessions SET status='processing', completed_at=SYSTIMESTAMP WHERE id=?`
    ).run(req.params.sessionId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/training/recording/:sessionId/analyze-step/:stepId — analyze single step
// Phase 2E: integrates user annotations into AI prompt
router.post('/recording/:sessionId/analyze-step/:stepId', async (req, res) => {
  try {
    const step = await db.prepare(
      'SELECT * FROM recording_steps WHERE id=? AND session_id=?'
    ).get(req.params.stepId, req.params.sessionId);
    if (!step) return res.status(404).json({ error: '步驟不存在' });
    if (!step.screenshot_url) return res.json({ ok: false, error: '無截圖' });

    // Phase 3A-1: screenshot_url is always clean now; fallback to raw for old data
    const imgUrl = step.screenshot_raw_url || step.screenshot_url;
    let filePath = path.join(uploadDir, imgUrl.replace('/api/training/files/', ''));
    // Fallback to alt upload dir
    if (!fs.existsSync(filePath) && fs.existsSync(altUploadDir)) {
      const alt = path.join(altUploadDir, imgUrl.replace('/api/training/files/', ''));
      if (fs.existsSync(alt)) filePath = alt;
    }
    if (!fs.existsSync(filePath)) return res.json({ ok: false, error: '截圖檔案不存在' });

    const imageBase64 = fs.readFileSync(filePath).toString('base64');
    const elementInfo = step.element_json ? (() => { try { return JSON.parse(step.element_json) } catch { return null } })() : null;
    const clickInfo = elementInfo?.rect
      ? `使用者點擊了 (${elementInfo.rect.x}, ${elementInfo.rect.y}) 的 ${elementInfo.tag || ''} 元素「${elementInfo.text || ''}」。`
      : '';

    // Phase 2E: Parse user annotations for prompt enrichment
    let annotationPrompt = '';
    if (step.annotations_json) {
      try {
        const annots = JSON.parse(step.annotations_json);
        if (annots.length > 0) {
          const stepAnnots = annots.filter(a => a.type === 'number').sort((a, b) => a.stepNumber - b.stepNumber);
          const otherAnnots = annots.filter(a => a.type !== 'number');
          const lines = [];
          lines.push('使用者在截圖上做了以下標註（表示操作重點和順序）：');
          stepAnnots.forEach(a => {
            lines.push(`步驟 ${a.stepNumber}: ${a.type === 'number' ? '編號' : a.type}在座標 (${a.coords.x.toFixed(1)}%, ${a.coords.y.toFixed(1)}%)${a.label ? `，標註「${a.label}」` : ''}`);
          });
          otherAnnots.forEach(a => {
            const typeNames = { circle: '紅色圓圈', rect: '矩形框', arrow: '箭頭', text: '文字標註', freehand: '手繪', mosaic: '馬賽克遮蔽' };
            const tn = typeNames[a.type] || a.type;
            if (a.type === 'arrow') {
              lines.push(`${tn}從 (${a.coords.x.toFixed(1)}%, ${a.coords.y.toFixed(1)}%) 指向 (${a.coords.x2.toFixed(1)}%, ${a.coords.y2.toFixed(1)}%)${a.label ? `，標註「${a.label}」` : ''}`);
            } else if (a.type === 'text') {
              lines.push(`文字標註: 「${a.label}」在 (${a.coords.x.toFixed(1)}%, ${a.coords.y.toFixed(1)}%)`);
            } else if (a.type !== 'mosaic') {
              lines.push(`${tn}在 (${a.coords.x.toFixed(1)}%, ${a.coords.y.toFixed(1)}%)${a.label ? `，標註「${a.label}」` : ''}`);
            }
          });
          lines.push('');
          lines.push('請根據使用者的標註：');
          lines.push('1. 以標註的步驟編號順序生成操作說明');
          lines.push('2. 標註圈住/指向的元素就是該步驟的主要操作目標（設為 is_primary）');
          lines.push('3. 文字標註作為額外說明補充到操作說明中');
          lines.push('4. 生成旁白時按步驟順序描述');
          annotationPrompt = '\n' + lines.join('\n') + '\n';
        }
      } catch { /* ignore parse errors */ }
    }

    // Phase 2E: model priority — request body > system_settings > llm_models > default
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    let modelName = req.body.model || null;
    if (!modelName) {
      const setting = await db.prepare(`SELECT value FROM system_settings WHERE key='training_analyze_model'`).get();
      modelName = setting?.value || null;
    }
    if (!modelName) {
      const flashRow = await db.prepare(
        `SELECT api_model FROM llm_models WHERE model_role='chat' AND is_active=1 AND provider_type='gemini' ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
      ).get();
      modelName = flashRow?.api_model || process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview';
    }
    const model = genAI.getGenerativeModel({ model: modelName });

    const prompt = `分析這張系統操作截圖（步驟 ${step.step_number}）。${clickInfo}${annotationPrompt}
識別所有可互動 UI 元素，回傳 JSON：
{ "regions": [{ "type": "...", "label": "...", "coords": { "x": 0, "y": 0, "w": 0, "h": 0 }, "is_primary": false }],
  "instruction": "操作說明", "narration": "旁白文字",
  "sensitive_areas": [{ "type": "password", "coords": { "x": 0, "y": 0, "w": 0, "h": 0 } }] }
注意：coords 的 x, y, w, h 必須是百分比 (0-100)，相對於圖片寬高。x, y 是左上角百分比。
只回傳 JSON。`;

    const result = await model.generateContent([
      { inlineData: { mimeType: 'image/png', data: imageBase64 } },
      { text: prompt }
    ]);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    // Phase 3A-1: Normalize coordinates to percentage (0-100) if AI returned pixels
    const sizeOf = require('image-size');
    let imgW = 1920, imgH = 1080;
    try { const dim = sizeOf(fs.readFileSync(filePath)); if (dim.width) { imgW = dim.width; imgH = dim.height; } } catch {}

    const normalizedRegions = (parsed.regions || []).map(r => {
      const c = r.coords;
      if (c.x > 100 || c.y > 100 || c.w > 100 || c.h > 100) {
        return { ...r, coords: { x: c.x / imgW * 100, y: c.y / imgH * 100, w: c.w / imgW * 100, h: c.h / imgH * 100 } };
      }
      return r;
    });

    await db.prepare(`
      UPDATE recording_steps SET ai_regions_json=?, ai_instruction=?, ai_narration=?,
             is_sensitive=? WHERE id=?
    `).run(
      JSON.stringify(normalizedRegions),
      parsed.instruction || null,
      parsed.narration || null,
      (parsed.sensitive_areas?.length > 0) ? 1 : 0,
      step.id
    );

    res.json({ ok: true, step_id: step.id, regions: normalizedRegions, instruction: parsed.instruction, narration: parsed.narration });
  } catch (e) {
    console.error('[Training] analyze step:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/recording/:sessionId/analyze — AI analyze all steps (batch)
router.post('/recording/:sessionId/analyze', async (req, res) => {
  try {
    const steps = await db.prepare(
      'SELECT * FROM recording_steps WHERE session_id=? ORDER BY step_number'
    ).all(req.params.sessionId);

    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const flashRow = await db.prepare(
      `SELECT api_model FROM llm_models WHERE model_role='chat' AND is_active=1 AND provider_type='gemini' ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
    ).get();
    const model = genAI.getGenerativeModel({ model: flashRow?.api_model || process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview' });

    // Parallel analysis in batches of 3
    const BATCH = 3;
    let analyzed = 0;
    const validSteps = steps.filter(s => {
      if (!s.screenshot_url) return false;
      const fp = path.join(uploadDir, s.screenshot_url.replace('/api/training/files/', ''));
      return fs.existsSync(fp);
    });

    const analyzeStep = async (step) => {
      const filePath = path.join(uploadDir, step.screenshot_url.replace('/api/training/files/', ''));
      const imageBase64 = fs.readFileSync(filePath).toString('base64');

      const elementInfo = step.element_json ? JSON.parse(step.element_json) : null;
      const clickInfo = elementInfo?.rect
        ? `使用者點擊了 (${elementInfo.rect.x}, ${elementInfo.rect.y}) 的 ${elementInfo.tag || ''} 元素「${elementInfo.text || ''}」。`
        : '';

      const prompt = `分析這張系統操作截圖（步驟 ${step.step_number}）。${clickInfo}
識別所有可互動 UI 元素，回傳 JSON：
{ "regions": [{ "type": "...", "label": "...", "coords": { "x": 0, "y": 0, "w": 0, "h": 0 }, "is_primary": false }],
  "instruction": "操作說明", "narration": "旁白文字",
  "sensitive_areas": [{ "type": "password", "coords": { "x": 0, "y": 0, "w": 0, "h": 0 } }] }
只回傳 JSON。`;

      try {
        const result = await model.generateContent([
          { inlineData: { mimeType: 'image/png', data: imageBase64 } },
          { text: prompt }
        ]);
        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

        await db.prepare(`
          UPDATE recording_steps SET ai_regions_json=?, ai_instruction=?, ai_narration=?,
                 is_sensitive=? WHERE id=?
        `).run(
          JSON.stringify(parsed.regions || []),
          parsed.instruction || null,
          parsed.narration || null,
          (parsed.sensitive_areas?.length > 0) ? 1 : 0,
          step.id
        );
        analyzed++;
      } catch (err) {
        console.warn(`[Recording] analyze step ${step.step_number}:`, err.message);
      }
    };

    for (let i = 0; i < validSteps.length; i += BATCH) {
      const batch = validSteps.slice(i, i + BATCH);
      await Promise.all(batch.map(s => analyzeStep(s)));
    }

    await db.prepare(
      `UPDATE recording_sessions SET status='completed' WHERE id=?`
    ).run(req.params.sessionId);

    res.json({ ok: true, analyzed, total: steps.length });
  } catch (e) {
    console.error('[Training] analyze recording:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/recording/:sessionId/generate — create slides from recording
router.post('/recording/:sessionId/generate', async (req, res) => {
  try {
    const session = await db.prepare('SELECT * FROM recording_sessions WHERE id=?').get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: '錄製工作階段不存在' });

    const steps = await db.prepare(
      'SELECT * FROM recording_steps WHERE session_id=? ORDER BY step_number'
    ).all(req.params.sessionId);

    let courseId = session.course_id;
    let lessonId = session.lesson_id;

    // Create course if not provided
    if (!courseId) {
      const r = await db.prepare(
        `INSERT INTO courses (title, description, created_by) VALUES (?, ?, ?)`
      ).run(`錄製教材 ${new Date().toLocaleDateString('zh-TW')}`, '由 AI 輔助錄製自動生成', req.user.id);
      courseId = r.lastInsertRowid;
    }

    // Create lesson if not provided
    if (!lessonId) {
      const r = await db.prepare(
        `INSERT INTO course_lessons (course_id, title, sort_order, lesson_type) VALUES (?, ?, ?, ?)`
      ).run(courseId, '錄製章節', 1, 'slides');
      lessonId = r.lastInsertRowid;
    }

    // Phase 3A-2: separate steps by language — zh-TW builds main slides, others become image_overrides
    const zhSteps = steps.filter(s => !s.lang || s.lang === 'zh-TW');
    const otherLangSteps = steps.filter(s => s.lang && s.lang !== 'zh-TW');

    // Create slides from zh-TW steps
    let slideCount = 0;
    const stepToSlideId = {}; // map step_number → slide id (for image_overrides)
    for (const step of zhSteps) {
      if (!step.screenshot_url) continue;

      // Phase 3A-1: Simplified slide generation — clean image + annotations layer
      const aiRegions = step.ai_regions_json ? (() => { try { return JSON.parse(step.ai_regions_json) } catch { return [] } })() : [];
      const instruction = step.ai_instruction || step.final_instruction || `步驟 ${step.step_number}`;
      const narration = step.ai_narration || instruction;

      // Parse user annotations
      const userAnnotations = step.annotations_json
        ? (() => { try { return JSON.parse(step.annotations_json) } catch { return [] } })()
        : [];

      // Only keep AI regions that overlap with user annotation positions (correct targets)
      // If user annotated specific spots, those are the intended interactive targets
      const userNumberAnnotations = userAnnotations.filter(a => a.type === 'number');
      let hotspotRegions;
      if (userNumberAnnotations.length > 0 && aiRegions.length > 0) {
        // Match: find AI regions closest to each user number annotation
        hotspotRegions = userNumberAnnotations.map((ua, i) => {
          const closest = aiRegions.reduce((best, r) => {
            const cx = r.coords.x + (r.coords.w || 0) / 2;
            const cy = r.coords.y + (r.coords.h || 0) / 2;
            const dist = Math.sqrt((cx - ua.coords.x) ** 2 + (cy - ua.coords.y) ** 2);
            return dist < best.dist ? { r, dist } : best;
          }, { r: null, dist: Infinity });
          if (closest.r && closest.dist < 30) { // within 30% proximity
            return {
              id: `r${i + 1}`, shape: 'rect', coords: closest.r.coords,
              correct: true, label: closest.r.label || ua.label || `步驟 ${ua.stepNumber}`,
              type: closest.r.type || '',
              feedback: `正確！${closest.r.label ? '這就是「' + closest.r.label + '」。' : ''}`
            };
          }
          return null;
        }).filter(Boolean);
      } else {
        // No user annotations or no AI regions: only keep is_primary
        hotspotRegions = aiRegions.filter(r => r.is_primary).map((r, i) => ({
          id: `r${i + 1}`, shape: 'rect', coords: r.coords,
          correct: true, label: r.label || `元素 ${i + 1}`, type: r.type || '',
          feedback: `正確！${r.label ? '這就是「' + r.label + '」。' : ''}`
        }));
      }

      const slideType = hotspotRegions.length > 0 ? 'hotspot' : 'content';

      // Image: always use clean screenshot (Phase 3A-1: screenshot_url is always clean for new data)
      const displayImage = step.screenshot_raw_url || step.screenshot_url;

      // Read image dimensions
      const sizeOf = require('image-size');
      let imageDimensions = null;
      try {
        let imgPath = path.join(uploadDir, displayImage.replace('/api/training/files/', ''));
        if (!fs.existsSync(imgPath) && fs.existsSync(altUploadDir)) {
          imgPath = path.join(altUploadDir, displayImage.replace('/api/training/files/', ''));
        }
        if (fs.existsSync(imgPath)) {
          const dim = sizeOf(fs.readFileSync(imgPath));
          if (dim.width) imageDimensions = { w: dim.width, h: dim.height };
        }
      } catch {}

      // Always keep annotations data — editor will decide how to display
      const hasRaw = !!step.screenshot_raw_url;
      const slideAnnotations = userAnnotations.filter(a => a.visible !== false);

      const blocks = [];

      if (slideType === 'hotspot') {
        blocks.push({
          type: 'hotspot',
          image: displayImage,
          instruction: instruction,
          regions: hotspotRegions,
          annotations: slideAnnotations,
          annotations_in_image: !hasRaw && userAnnotations.length > 0,
          coordinate_system: 'percent',
          image_dimensions: imageDimensions,
          max_attempts: 3,
          show_hint_after: 2
        });
      } else {
        blocks.push({
          type: 'text',
          content: `## 步驟 ${step.step_number}\n\n${instruction}`
        });
        blocks.push({
          type: 'image',
          src: displayImage,
          alt: instruction,
          annotations: slideAnnotations,
          annotations_in_image: !hasRaw && userAnnotations.length > 0,
          coordinate_system: 'percent',
          image_dimensions: imageDimensions
        });
      }

      const contentJson = JSON.stringify(blocks);

      const slideResult = await db.prepare(`
        INSERT INTO course_slides (lesson_id, sort_order, slide_type, content_json, notes)
        VALUES (?, ?, ?, ?, ?)
      `).run(lessonId, step.step_number, slideType, contentJson, narration);
      stepToSlideId[step.step_number] = slideResult.lastInsertRowid;
      slideCount++;
    }

    // Phase 3A-2: Map other-language screenshots to image_overrides
    for (const langStep of otherLangSteps) {
      if (!langStep.screenshot_url) continue;
      const slideId = stepToSlideId[langStep.step_number];
      if (!slideId) continue;

      const lang = langStep.lang;
      // Find the image block index (hotspot or image block in content_json)
      const slide = await db.prepare('SELECT content_json FROM course_slides WHERE id=?').get(slideId);
      if (!slide) continue;
      let blocks;
      try { blocks = JSON.parse(slide.content_json || '[]'); } catch { continue; }
      const imgBlockIdx = blocks.findIndex(b => b.type === 'hotspot' || b.type === 'image');
      if (imgBlockIdx < 0) continue;

      // Upsert slide_translations with image_overrides
      const existing = await db.prepare('SELECT id, image_overrides FROM slide_translations WHERE slide_id=? AND lang=?').get(slideId, lang);
      let overrides = {};
      if (existing?.image_overrides) { try { overrides = JSON.parse(existing.image_overrides); } catch {} }
      overrides[String(imgBlockIdx)] = langStep.screenshot_url;
      const overridesJson = JSON.stringify(overrides);

      if (existing) {
        await db.prepare('UPDATE slide_translations SET image_overrides=? WHERE id=?').run(overridesJson, existing.id);
      } else {
        await db.prepare('INSERT INTO slide_translations (slide_id, lang, image_overrides) VALUES (?,?,?)').run(slideId, lang, overridesJson);
      }
    }

    res.json({ ok: true, course_id: courseId, lesson_id: lessonId, slides_created: slideCount });
  } catch (e) {
    console.error('[Training] generate from recording:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2F: HTML5 Single-file Export
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/courses/:id/export', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const { languages = ['zh-TW'], include_quiz = true, include_audio = true, include_annotations = true, compress_images = true, lesson_ids } = req.body;
    const courseId = req.courseId;

    // 1. Load course
    const course = await db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);
    if (!course) return res.status(404).json({ error: '課程不存在' });

    // 2. Load lessons (filter by lesson_ids if provided)
    let lessons = await db.prepare('SELECT * FROM course_lessons WHERE course_id=? ORDER BY sort_order').all(courseId);
    if (Array.isArray(lesson_ids) && lesson_ids.length > 0) {
      const idSet = new Set(lesson_ids.map(Number));
      lessons = lessons.filter(l => idSet.has(l.id));
    }

    // 3. Build slide data per language
    const slidesByLang = {};
    const titleByLang = {};
    const descByLang = {};

    for (const lang of languages) {
      titleByLang[lang] = course.title;
      descByLang[lang] = course.description;

      // Course translation
      if (lang !== 'zh-TW') {
        const ct = await db.prepare('SELECT title, description FROM course_translations WHERE course_id=? AND lang=?').get(courseId, lang);
        if (ct?.title) titleByLang[lang] = ct.title;
        if (ct?.description) descByLang[lang] = ct.description;
      }

      const allSlides = [];
      for (const lesson of lessons) {
        let lessonTitle = lesson.title;
        if (lang !== 'zh-TW') {
          const lt = await db.prepare('SELECT title FROM lesson_translations WHERE lesson_id=? AND lang=?').get(lesson.id, lang);
          if (lt?.title) lessonTitle = lt.title;
        }

        const slides = await db.prepare('SELECT * FROM course_slides WHERE lesson_id=? ORDER BY sort_order').all(lesson.id);
        for (const slide of slides) {
          let contentJson = slide.content_json;
          let notes = slide.notes;

          // Helper to resolve file paths
          const findFile = (rel) => {
            const p1 = path.join(uploadDir, rel);
            if (fs.existsSync(p1)) return p1;
            if (fs.existsSync(altUploadDir)) {
              const p2 = path.join(altUploadDir, rel);
              if (fs.existsSync(p2)) return p2;
            }
            return null;
          };
          const embedAudioUrl = (url) => {
            if (!url || !url.startsWith('/api/training/files/')) return url;
            const ap = findFile(url.replace('/api/training/files/', ''));
            if (ap) return `data:audio/mpeg;base64,${fs.readFileSync(ap).toString('base64')}`;
            return null;
          };

          let slideAudioUrl = slide.audio_url;

          // Translated content + image overrides + regions_json
          if (lang !== 'zh-TW') {
            const st = await db.prepare(
              'SELECT content_json, notes, audio_url, image_overrides, regions_json FROM slide_translations WHERE slide_id=? AND lang=?'
            ).get(slide.id, lang);
            if (st) {
              // Apply translated content_json — merge back image/hotspot fields from original
              if (st.content_json) {
                try {
                  const origBlocks = JSON.parse(slide.content_json || '[]');
                  const transBlocks = JSON.parse(st.content_json || '[]');
                  const preserveFields = ['image', 'src', 'regions', 'coordinate_system', 'image_dimensions',
                    'interaction_mode', 'max_attempts', 'show_hint_after', 'annotations', 'annotations_in_image',
                    'slide_narration', 'slide_narration_audio', 'slide_narration_test', 'slide_narration_test_audio',
                    'slide_narration_explore', 'slide_narration_explore_audio', 'completion_message'];
                  for (let bi = 0; bi < transBlocks.length && bi < origBlocks.length; bi++) {
                    const tb = transBlocks[bi], ob = origBlocks[bi];
                    for (const f of preserveFields) {
                      if (ob[f] !== undefined && (tb[f] === undefined || tb[f] === null)) tb[f] = ob[f];
                    }
                    // Preserve items images
                    if (ob.items && tb.items) {
                      for (let ii = 0; ii < tb.items.length && ii < ob.items.length; ii++) {
                        if (ob.items[ii].image && !tb.items[ii].image) tb.items[ii].image = ob.items[ii].image;
                      }
                    }
                  }
                  contentJson = JSON.stringify(transBlocks);
                } catch { contentJson = st.content_json; }
              }
              if (st.notes) notes = st.notes;
              if (st.audio_url) slideAudioUrl = st.audio_url;

              // Apply image overrides
              if (st.image_overrides) {
                try {
                  const overrides = JSON.parse(st.image_overrides);
                  const tmpBlocks = JSON.parse(contentJson || '[]');
                  for (const [idx, val] of Object.entries(overrides)) {
                    if (idx === 'region_overrides') continue;
                    const block = tmpBlocks[Number(idx)];
                    if (block && typeof val === 'string') {
                      if (block.image) block.image = val;
                      if (block.src) block.src = val;
                    }
                  }
                  const regionOvr = overrides.region_overrides;
                  if (regionOvr) {
                    for (const block of tmpBlocks) {
                      if (block.regions) {
                        block.regions = block.regions.map(r => {
                          const ovr = regionOvr[r.id];
                          return ovr ? { ...r, coords: { ...r.coords, ...ovr } } : r;
                        });
                      }
                    }
                  }
                  contentJson = JSON.stringify(tmpBlocks);
                } catch {}
              }

              // Apply regions_json (independent language regions + intro narration)
              if (st.regions_json) {
                try {
                  const langRegions = JSON.parse(st.regions_json);
                  const tmpBlocks = JSON.parse(contentJson || '[]');
                  for (const [idx, regs] of Object.entries(langRegions)) {
                    if (idx === '_intro') {
                      for (const block of tmpBlocks) {
                        if (block.type === 'hotspot') {
                          for (const f of ['slide_narration', 'slide_narration_audio',
                            'slide_narration_test', 'slide_narration_test_audio',
                            'slide_narration_explore', 'slide_narration_explore_audio', 'completion_message']) {
                            if (langRegions._intro[f]) block[f] = langRegions._intro[f];
                          }
                        }
                      }
                      continue;
                    }
                    const block = tmpBlocks[Number(idx)];
                    if (block && Array.isArray(regs)) {
                      const existingRegs = block.regions || [];
                      for (const reg of regs) {
                        const match = existingRegs.find(er => er.id === reg.id);
                        if (match) {
                          for (const vf of ['narration', 'audio_url', 'test_hint', 'test_audio_url',
                            'explore_desc', 'explore_audio_url', 'feedback', 'feedback_wrong']) {
                            if (!reg[vf] && match[vf]) reg[vf] = match[vf];
                          }
                          if (!reg.label && match.label) reg.label = match.label;
                        }
                      }
                      block.regions = regs;
                    }
                  }
                  contentJson = JSON.stringify(tmpBlocks);
                } catch {}
              }
            }
          }

          // Parse and embed images as base64
          let blocks = [];
          try { blocks = JSON.parse(contentJson || '[]'); } catch {}

          const sizeOf = require('image-size');
          for (const block of blocks) {
            const imgFields = ['image', 'src'];
            for (const field of imgFields) {
              if (block[field] && block[field].startsWith('/api/training/files/')) {
                const rel = block[field].replace('/api/training/files/', '');
                const imgPath = findFile(rel);
                if (imgPath) {
                  const buf = fs.readFileSync(imgPath);
                  try {
                    const dim = sizeOf(buf);
                    if (dim.width && dim.height) { block._imgW = dim.width; block._imgH = dim.height; }
                  } catch {}
                  const ext = path.extname(imgPath).toLowerCase();
                  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
                  block[field] = `data:${mime};base64,${buf.toString('base64')}`;
                }
              }
            }
            // Embed step images
            if (block.items) {
              for (const item of block.items) {
                if (item.image && item.image.startsWith('/api/training/files/')) {
                  const imgPath = findFile(item.image.replace('/api/training/files/', ''));
                  if (imgPath) {
                    item.image = `data:image/png;base64,${fs.readFileSync(imgPath).toString('base64')}`;
                  }
                }
              }
            }
            // Remove annotations if not requested
            if (!include_annotations && block.annotations) {
              delete block.annotations;
            }
            // Embed block-level audio (intro narration, etc.)
            if (include_audio) {
              for (const af of ['slide_narration_audio', 'slide_narration_test_audio', 'slide_narration_explore_audio']) {
                if (block[af]) block[af] = embedAudioUrl(block[af]);
              }
              // Embed region-level audio
              if (block.regions) {
                for (const region of block.regions) {
                  for (const af of ['audio_url', 'test_audio_url', 'explore_audio_url']) {
                    if (region[af]) region[af] = embedAudioUrl(region[af]);
                  }
                }
              }
            }
          }

          // Slide-level audio embed
          let audioData = null;
          if (include_audio && slideAudioUrl) {
            audioData = embedAudioUrl(slideAudioUrl);
          }

          allSlides.push({
            lesson: lessonTitle,
            type: slide.slide_type,
            blocks,
            notes,
            audio: audioData
          });
        }
      }
      slidesByLang[lang] = allSlides;
    }

    // 4. Load quiz if requested
    const quizByLang = {};
    if (include_quiz) {
      const questions = await db.prepare('SELECT * FROM quiz_questions WHERE course_id=? ORDER BY sort_order').all(courseId);
      for (const lang of languages) {
        const langQuestions = [];
        for (const q of questions) {
          let questionJson = q.question_json;
          let explanation = q.explanation;
          if (lang !== 'zh-TW') {
            const qt = await db.prepare('SELECT question_json, explanation FROM quiz_translations WHERE question_id=? AND lang=?').get(q.id, lang);
            if (qt?.question_json) questionJson = qt.question_json;
            if (qt?.explanation) explanation = qt.explanation;
          }
          langQuestions.push({ question_json: questionJson, explanation, points: q.points });
        }
        quizByLang[lang] = langQuestions;
      }
    }

    // 5. Build HTML
    const courseData = {
      title: titleByLang,
      description: descByLang,
      slides: slidesByLang,
      quiz: quizByLang,
      settings: {
        passScore: course.pass_score || 70,
        languages,
        exportedAt: new Date().toISOString(),
        exportedBy: req.user.name || req.user.username
      }
    };

    const html = buildExportHtml(courseData);

    // 6. Save and return
    const exportDir = path.join(uploadDir, 'exports');
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
    const filename = `course_${courseId}_${Date.now()}.html`;
    const filePath = path.join(exportDir, filename);
    fs.writeFileSync(filePath, html, 'utf-8');

    res.json({
      ok: true,
      download_url: `/api/training/files/exports/${filename}`,
      file_size_bytes: Buffer.byteLength(html, 'utf-8'),
      filename
    });
  } catch (e) {
    console.error('[Training] export:', e.message);
    res.status(500).json({ error: e.message });
  }
});

function buildExportHtml(courseData) {
  const dataJson = JSON.stringify(courseData);
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${courseData.title['zh-TW'] || 'FOXLINK 教育訓練'}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f1f5f9;color:#1e293b}
#app{max-width:1200px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column}
.topbar{background:#fff;border-bottom:1px solid #e2e8f0;padding:10px 20px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10}
.topbar h1{font-size:15px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.topbar select,.topbar button{border:1px solid #cbd5e1;border-radius:6px;padding:4px 8px;font-size:12px;background:#fff;cursor:pointer}
.topbar button.active{background:#2563eb;color:#fff;border-color:#2563eb}
.main{flex:1;padding:20px;display:flex;flex-direction:column;gap:16px}
.slide-card{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);overflow:hidden}
.slide-content{display:flex;gap:16px;padding:16px;align-items:flex-start}
.slide-img-wrap{flex:1;position:relative;border-radius:8px;overflow:hidden;background:#0f172a;cursor:pointer;transition:border-color .3s}
.slide-img-wrap.completed{outline:2px solid #22c55e;outline-offset:-2px;cursor:default}
.slide-img-wrap img{width:100%;display:block}
.slide-info{width:240px;flex-shrink:0;display:flex;flex-direction:column;gap:8px}
.info-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;font-size:13px;line-height:1.6}
.info-card .label{font-size:10px;font-weight:600;color:#64748b;margin-bottom:4px;text-transform:uppercase}
.text-block{padding:16px;font-size:14px;line-height:1.7}
.text-block h1,.text-block h2,.text-block h3{margin:8px 0 4px;color:#1e293b}
.text-block h2{font-size:16px}
.callout{padding:12px 16px;border-left:4px solid #0ea5e9;background:rgba(14,165,233,.06);margin:8px 16px;border-radius:0 8px 8px 0;font-size:13px}
.callout.warning{border-color:#eab308;background:rgba(234,179,8,.06)}
.callout.important{border-color:#ef4444;background:rgba(239,68,68,.06)}
.bottom{background:#fff;border-top:1px solid #e2e8f0;padding:10px 20px;display:flex;align-items:center;gap:12px;position:sticky;bottom:0}
.bottom button{border:none;background:#2563eb;color:#fff;border-radius:8px;padding:8px 16px;font-size:13px;cursor:pointer;font-weight:500}
.bottom button:hover{background:#1d4ed8}
.bottom button:disabled{opacity:.3;cursor:default}
.bottom .bar{flex:1;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden}
.bottom .bar div{height:100%;background:#2563eb;border-radius:3px;transition:width .3s}
.bottom .counter{font-size:12px;color:#64748b;width:60px;text-align:center}
/* Regions */
.regions{position:absolute;inset:0}
.region-box{position:absolute;border-radius:4px;transition:all .3s;pointer-events:none}
.region-box .tag{position:absolute;top:-20px;left:0;font-size:9px;font-weight:700;background:#3b82f6;color:#fff;padding:1px 6px;border-radius:3px;white-space:nowrap}
.region-box.current{border:2px solid #3b82f6;background:rgba(59,130,246,.08)}
.region-box.done{border:2px solid rgba(34,197,94,.4);background:rgba(34,197,94,.08)}
.region-box.dimmed{border:1px solid rgba(100,116,139,.15);background:rgba(0,0,0,.25);opacity:.3}
.region-box.hit-ok{border:3px solid #22c55e;background:rgba(34,197,94,.2)}
.region-box.hit-bad{border:3px solid #ef4444;background:rgba(239,68,68,.15);animation:shake .4s}
/* Step progress */
.step-dots{display:flex;align-items:center;gap:4px;padding:8px 16px}
.step-dot{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;transition:all .3s}
.step-dot.pending{background:#cbd5e1;color:#64748b}
.step-dot.current{background:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.3)}
.step-dot.done{background:#22c55e}
.step-line{width:12px;height:2px;border-radius:1px;background:#e2e8f0;transition:background .3s}
.step-line.done{background:#22c55e}
/* Narration card */
.narr-card{border:2px solid #3b82f6;background:rgba(59,130,246,.06);border-radius:8px;padding:10px}
.narr-card.auto{border-color:#22c55e;background:rgba(34,197,94,.06)}
.narr-card .step-badge{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;font-size:10px;font-weight:700;color:#fff;margin-right:6px}
/* Feedback */
.fb-card{border-radius:8px;padding:8px 10px;font-size:12px;display:flex;align-items:flex-start;gap:6px;animation:fadeIn .3s}
.fb-card.ok{background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);color:#16a34a}
.fb-card.err{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);color:#dc2626}
/* Completion */
.complete-card{border:1px solid #22c55e;background:rgba(34,197,94,.08);border-radius:8px;padding:10px;text-align:center}
.complete-card .msg{color:#22c55e;font-weight:600;font-size:13px}
/* Checkmark overlay */
.checkmark-overlay{position:absolute;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:10}
.checkmark-circle{width:48px;height:48px;border-radius:50%;background:#22c55e;display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px;font-weight:bold;box-shadow:0 0 20px rgba(34,197,94,.5);animation:cb .6s ease-out}
/* Controls bar */
.ctrl-bar{display:flex;align-items:center;gap:8px;font-size:11px;color:#64748b}
.ctrl-btn{border:none;background:#eff6ff;color:#2563eb;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;transition:all .15s}
.ctrl-btn:hover{background:#dbeafe}
.ctrl-btn.auto-active{background:#22c55e;color:#fff}
.ctrl-btn.muted{background:#f1f5f9;color:#94a3b8}
/* Annotation SVG */
.ann-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
/* Quiz */
.quiz-wrap{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:20px;margin:16px 0}
.quiz-q{margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #f1f5f9}
.quiz-q:last-child{border:none}
.quiz-q h4{font-size:14px;margin-bottom:8px}
.quiz-q label{display:block;padding:6px 10px;margin:3px 0;border-radius:6px;cursor:pointer;font-size:13px;border:1px solid #e2e8f0;transition:.15s}
.quiz-q label:hover{background:#f8fafc}
.quiz-q label.selected{background:#eff6ff;border-color:#93c5fd}
.quiz-q label.correct{background:#f0fdf4;border-color:#86efac}
.quiz-q label.wrong{background:#fef2f2;border-color:#fca5a5}
.quiz-result{text-align:center;padding:20px;font-size:18px;font-weight:700}
.quiz-result.pass{color:#16a34a}
.quiz-result.fail{color:#dc2626}
.badge{display:inline-block;font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;background:#eff6ff;color:#2563eb}
@keyframes cb{0%{transform:scale(0);opacity:0}50%{transform:scale(1.3)}100%{transform:scale(1);opacity:1}}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse-ring{0%{box-shadow:0 0 0 0 rgba(59,130,246,.4)}100%{box-shadow:0 0 0 8px rgba(59,130,246,0)}}
@media(max-width:768px){.slide-content{flex-direction:column}.slide-info{width:100%}}
</style>
</head>
<body>
<div id="app"></div>
<audio id="globalAudio"></audio>
<script>
(function(){
var D=${dataJson};
var langs=D.settings.languages||['zh-TW'];
var lang=langs[0],idx=0,quizMode=false,quizAnswers={},quizSubmitted=false;
// Guided tour state (per slide)
var gStep=0,gCompleted=false,gFeedback=null,gHitRegion=null,gAttempts=0,gStepAttempts=0;
var autoPlaying=false,muted=false,autoTimer=null,guidedStarted=false;
var $=function(s){return document.querySelector(s)};
var app=$('#app');
var audio=document.getElementById('globalAudio');

function resetGuided(full){gStep=0;gCompleted=false;gFeedback=null;gHitRegion=null;gAttempts=0;gStepAttempts=0;if(full)guidedStarted=false;stopAuto()}
function stopAuto(){autoPlaying=false;if(autoTimer){clearTimeout(autoTimer);autoTimer=null}if(audio){audio.pause();audio.currentTime=0;audio.onended=null}}

function playAudio(url,cb){
  if(!url||muted||!audio){if(cb)cb();return}
  audio.pause();audio.currentTime=0;audio.onended=null;
  audio.src=url;
  audio.onended=function(){audio.onended=null;if(cb)cb()};
  audio.play().catch(function(){audio.onended=null;if(cb)cb()});
}

function getHotspotBlock(s){
  if(!s)return null;
  for(var i=0;i<(s.blocks||[]).length;i++){
    var b=s.blocks[i];
    if((b.type==='hotspot'||b.type==='image')&&(b.image||b.src)&&b.regions&&b.regions.length)return b;
  }
  return null;
}
function getCorrectRegions(b){return(b&&b.regions||[]).filter(function(r){return r.correct})}
// Coordinate conversion — match HotspotBlock.tsx logic exactly
function calcCoordSystem(b){
  var allR=b.regions||[];
  if(b.coordinate_system==='pixel')return'pixel';
  if(b.coordinate_system==='percent')return'percent';
  // Heuristic: if ANY region has coords > 100, treat all as pixel
  var hasBig=allR.some(function(r){return r.coords.x>100||r.coords.y>100||r.coords.w>100||r.coords.h>100});
  return hasBig?'pixel':'percent';
}
function toPercent(b,c){
  var sys=calcCoordSystem(b);
  if(sys==='percent')return c;
  var dim=b.image_dimensions||{};
  var allR=b.regions||[];
  var sw=b._imgW||dim.w||Math.max.apply(null,allR.map(function(r){return r.coords.x+(r.coords.w||0)}).concat([200]))*1.05;
  var sh=b._imgH||dim.h||Math.max.apply(null,allR.map(function(r){return r.coords.y+(r.coords.h||0)}).concat([200]))*1.05;
  return{x:c.x/sw*100,y:c.y/sh*100,w:c.w/sw*100,h:c.h/sh*100};
}

// Auto-play logic
function startAuto(){
  autoPlaying=true;guidedStarted=true;gStep=0;gCompleted=false;gFeedback=null;gHitRegion=null;
  render();
  var s=getSlides()[idx];
  var hb=getHotspotBlock(s);
  if(!hb){autoPlaying=false;render();return}
  var introUrl=hb.slide_narration_audio||s.audio||null;
  playAudio(introUrl,function(){autoAdvance()});
}
function autoAdvance(){
  if(!autoPlaying)return;
  var s=getSlides()[idx];var hb=getHotspotBlock(s);
  if(!hb){stopAuto();render();return}
  var crs=getCorrectRegions(hb);
  if(gStep>=crs.length){
    gCompleted=true;render();
    // Auto-advance to next slide after delay
    autoTimer=setTimeout(function(){
      var sl=getSlides();
      if(idx<sl.length-1){idx++;resetGuided();autoPlaying=true;guidedStarted=true;render();startAuto()}
      else{autoPlaying=false;render()}
    },1500);
    return;
  }
  render();
  var region=crs[gStep];
  var regionAudio=region.audio_url||null;
  playAudio(regionAudio,function(){
    if(!autoPlaying)return;
    gHitRegion=region.id;
    gFeedback={text:region.feedback||'\\u2713',correct:true};
    render();
    autoTimer=setTimeout(function(){
      if(!autoPlaying)return;
      gStep++;gFeedback=null;gHitRegion=null;
      render();autoAdvance()
    },800);
  });
}

function getSlides(){return D.slides[lang]||[]}

function render(){
  var slides=getSlides();
  var title=D.title[lang]||D.title['zh-TW']||'';
  var s=slides[idx];

  var topHtml='<div class="topbar"><h1>'+esc(title)+'</h1>';
  if(langs.length>1){
    topHtml+='<select id="langSel">';
    var ln={'zh-TW':'\\u7e41\\u9ad4\\u4e2d\\u6587','en':'English','vi':'Ti\\u1ebfng Vi\\u1ec7t'};
    langs.forEach(function(l){topHtml+='<option value="'+l+'"'+(l===lang?' selected':'')+'>'+ln[l]+'</option>'});
    topHtml+='</select>';
  }
  topHtml+='<button id="muteBtn" class="'+(muted?'':'active')+'" title="'+(muted?'\\u53d6\\u6d88\\u975c\\u97f3':'\\u975c\\u97f3')+'">'+(muted?'\\ud83d\\udd07':'\\ud83d\\udd0a')+'</button>';
  topHtml+='<span class="badge">'+esc(D.settings.exportedBy||'')+'</span></div>';

  var mainHtml='<div class="main">';
  if(s&&s.lesson){
    mainHtml+='<div style="font-size:11px;font-weight:600;color:#64748b;padding:0 4px">\\ud83d\\udcd6 '+esc(s.lesson)+'</div>';
  }
  if(quizMode){mainHtml+=renderQuiz()}
  else if(s){mainHtml+=renderSlide(s,idx)}
  mainHtml+='</div>';

  var total=slides.length+(D.quiz[lang]&&D.quiz[lang].length?1:0);
  var cur=quizMode?total:idx+1;
  var botHtml='<div class="bottom">';
  botHtml+='<button id="prev" '+(cur<=1?'disabled':'')+'>\\u25c0</button>';
  botHtml+='<div class="bar"><div style="width:'+((cur/total)*100)+'%"></div></div>';
  botHtml+='<span class="counter">'+cur+' / '+total+'</span>';
  botHtml+='<button id="next" '+(cur>=total?'disabled':'')+'>\\u25b6</button>';
  botHtml+='</div>';

  app.innerHTML=topHtml+mainHtml+botHtml;

  var langSel=$('#langSel');
  if(langSel)langSel.onchange=function(){lang=this.value;idx=0;quizMode=false;resetGuided(true);render()};
  var muteBtn=$('#muteBtn');
  if(muteBtn)muteBtn.onclick=function(){muted=!muted;if(muted&&audio){audio.pause()}render()};
  var prev=$('#prev'),next=$('#next');
  if(prev)prev.onclick=function(){if(quizMode){quizMode=false;idx=getSlides().length-1}else if(idx>0)idx--;resetGuided();render();if(guidedStarted)playSlideIntro()};
  if(next)next.onclick=function(){var sl=getSlides();if(!quizMode&&idx<sl.length-1){idx++;resetGuided();render();if(guidedStarted)playSlideIntro()}else if(!quizMode&&idx===sl.length-1&&D.quiz[lang]&&D.quiz[lang].length){quizMode=true;render()}};
  var autoBtn=$('#autoPlayBtn');
  if(autoBtn)autoBtn.onclick=function(){if(autoPlaying){stopAuto();render()}else{startAuto()}};
  var resetBtn=$('#resetBtn');
  if(resetBtn)resetBtn.onclick=function(){resetGuided(true);render()};
  var startBtn=$('#startGuidedBtn');
  if(startBtn)startBtn.onclick=function(){guidedStarted=true;render();playSlideIntro()};
}

function playSlideIntro(){
  var s=getSlides()[idx];if(!s)return;
  var hb=getHotspotBlock(s);
  if(hb){var u=hb.slide_narration_audio||s.audio||null;if(u)playAudio(u)}
  else if(s.audio)playAudio(s.audio);
}

function renderSlide(s,i){
  var h='<div class="slide-card">';
  var blocks=s.blocks||[];
  var hb=getHotspotBlock(s);
  var hasImg=false,imgHtml='',infoHtml='';
  var hotspotInstruction='';

  for(var bi=0;bi<blocks.length;bi++){
    var b=blocks[bi];
    if((b.type==='hotspot'||b.type==='image')&&(b.image||b.src)){
      hasImg=true;
      hotspotInstruction=b.instruction||'';
      var imgSrc=b.image||b.src;
      imgHtml='<div class="slide-img-wrap'+(gCompleted?' completed':'')+'" id="imgWrap" data-slide="'+i+'"><img src="'+imgSrc+'" alt="">';
      var hasAnnotations=b.annotations&&b.annotations.length>0&&!b.annotations_in_image;
      if(hasAnnotations)imgHtml+=renderAnnotationsSvg(b.annotations);
      var correctRegs=getCorrectRegions(b);
      if(correctRegs.length>0&&guidedStarted){
        imgHtml+='<div class="regions">';
        correctRegs.forEach(function(r,ri){
          var c=toPercent(b,r.coords);
          var cls='region-box';
          if(gCompleted){cls+=' done'}
          else if(ri===gStep){
            cls+=' current';
            if(gHitRegion===r.id&&gFeedback&&gFeedback.correct)cls+=' hit-ok';
            else if(gHitRegion===r.id&&gFeedback&&!gFeedback.correct)cls+=' hit-bad';
          }
          else if(ri<gStep){cls+=' done'}
          else{cls+=' dimmed'}
          imgHtml+='<div class="'+cls+'" style="left:'+c.x+'%;top:'+c.y+'%;width:'+c.w+'%;height:'+c.h+'%">';
          if(ri===gStep&&!gCompleted)imgHtml+='<span class="tag">'+esc(r.label||(ri+1+''))+'</span>';
          imgHtml+='</div>';
          if(gHitRegion===r.id&&gFeedback&&gFeedback.correct){
            imgHtml+='<div class="checkmark-overlay" style="left:'+c.x+'%;top:'+c.y+'%;width:'+c.w+'%;height:'+c.h+'%"><div class="checkmark-circle" style="width:32px;height:32px;font-size:18px">\\u2713</div></div>';
          }
        });
        imgHtml+='</div>';
      }
      imgHtml+='</div>';
    } else if(b.type==='text'&&b.content){
      infoHtml+='<!--text:'+esc(b.content)+'-->';
    } else if(b.type==='callout'){
      var v=b.variant||'tip';
      var labels={tip:'\\u63d0\\u793a',warning:'\\u8b66\\u544a',note:'\\u6ce8\\u610f',important:'\\u91cd\\u8981'};
      infoHtml+='<div class="callout '+v+'"><strong>'+(labels[v]||v)+'\\uff1a</strong>'+esc(b.content||'')+'</div>';
    } else if(b.type==='steps'&&b.items){
      var st='<div class="info-card"><div class="label">\\u64cd\\u4f5c\\u6b65\\u9a5f</div><ol style="padding-left:16px;margin:4px 0">';
      b.items.forEach(function(it){st+='<li style="margin:4px 0"><strong>'+esc(it.title||'')+'</strong>'+(it.desc?' \\u2014 '+esc(it.desc):'')+'</li>'});
      st+='</ol></div>';
      infoHtml+=st;
    }
  }

  if(hotspotInstruction){infoHtml=infoHtml.replace(/<!--text:.*?-->/g,'')}
  else{infoHtml=infoHtml.replace(/<!--text:(.*?)-->/g,function(m,txt){
    return '<div class="info-card"><div class="label">\\u6b65\\u9a5f\\u8aaa\\u660e</div>'+simpleMarkdown(decEsc(txt))+'</div>';
  })}

  if(hasImg&&hb){
    var correctRegs2=getCorrectRegions(hb);
    var hasGuided=correctRegs2.length>0;

    if(hb.instruction){
      infoHtml+='<div class="info-card"><div class="label">\\u64cd\\u4f5c\\u8aaa\\u660e</div>'+simpleMarkdown(hb.instruction)+'</div>';
    }

    if(hasGuided&&!guidedStarted){
      // Show start button before guided tour begins
      infoHtml+='<div style="text-align:center;padding:12px 0">'
        +'<button class="ctrl-btn" id="startGuidedBtn" style="background:#2563eb;color:#fff;padding:8px 20px;font-size:13px;border-radius:8px">\\u25b6 \\u958b\\u59cb\\u5c0e\\u89bd</button>'
        +'<div style="margin-top:6px"><button class="ctrl-btn" id="autoPlayBtn" style="font-size:11px">\\u25b6 \\u81ea\\u52d5\\u64ad\\u653e\\u5168\\u90e8</button></div>'
        +'</div>';
    }

    if(hasGuided&&guidedStarted){
      infoHtml+='<div class="ctrl-bar">';
      infoHtml+='<button class="ctrl-btn'+(autoPlaying?' auto-active':'')+'" id="autoPlayBtn">'+(autoPlaying?'\\u23f9 \\u505c\\u6b62':'\\u25b6 \\u81ea\\u52d5\\u5c0e\\u89bd')+'</button>';
      if(gCompleted||gStep>0)infoHtml+='<button class="ctrl-btn" id="resetBtn">\\u21ba \\u91cd\\u4f86</button>';
      infoHtml+='<span>\\u6b65\\u9a5f '+(gCompleted?correctRegs2.length:gStep+1)+'/'+correctRegs2.length+'</span>';
      infoHtml+='</div>';
    }

    if(hasGuided&&guidedStarted&&!gCompleted){
      var cur=correctRegs2[gStep];
      if(cur){
        var narr=autoPlaying?(cur.narration||cur.label||''):(cur.narration||'\\u8acb\\u9ede\\u64ca\\u300c'+(cur.label||'\\u76ee\\u6a19')+'\\u300d');
        infoHtml+='<div class="narr-card'+(autoPlaying?' auto':'')+'">'
          +'<span class="step-badge" style="background:'+(autoPlaying?'#22c55e':'#3b82f6')+'">'+(gStep+1)+'</span>'
          +'<span style="font-size:11px;font-weight:600;color:'+(autoPlaying?'#22c55e':'#3b82f6')+'">'+(!autoPlaying?'\\u6b65\\u9a5f':'\\u5c0e\\u89bd')+' '+(gStep+1)+'/'+correctRegs2.length+'</span>'
          +'<p style="font-size:12px;margin-top:6px;line-height:1.5;color:#1e293b">'+esc(narr)+'</p></div>';
      }
    }

    if(gFeedback){
      infoHtml+='<div class="fb-card '+(gFeedback.correct?'ok':'err')+'">'
        +'<span>'+(gFeedback.correct?'\\u2705':'\\u274c')+'</span><span>'+esc(gFeedback.text)+'</span></div>';
    }

    if(gCompleted){
      var cmsg=hb.completion_message||'\\u6240\\u6709\\u6b65\\u9a5f\\u5df2\\u5b8c\\u6210\\uff01';
      infoHtml+='<div class="complete-card"><div class="msg">\\u2705 '+esc(cmsg)+'</div>'
        +'<div style="margin-top:8px;display:flex;gap:8px;justify-content:center">'
        +'<button class="ctrl-btn" id="resetBtn">\\u21ba \\u91cd\\u8a66</button>'
        +'<button class="ctrl-btn" style="background:#22c55e;color:#fff" onclick="document.getElementById(\\x27next\\x27).click()">\\u4e0b\\u4e00\\u9801 \\u25b6</button>'
        +'</div></div>';
    }

    if(hasGuided){
      infoHtml+='<div class="info-card" style="padding:8px"><div class="label">\\u64cd\\u4f5c\\u6b65\\u9a5f</div>';
      correctRegs2.forEach(function(r,ri){
        var isDone=ri<gStep||gCompleted;
        var isCur=ri===gStep&&!gCompleted;
        infoHtml+='<div style="display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:4px;'
          +(isCur?'background:rgba(59,130,246,.08)':'')+'"><span class="step-dot'
          +(isDone?' done':isCur?' current':' pending')+'" style="width:16px;height:16px;font-size:8px">'
          +(isDone?'\\u2713':(ri+1))+'</span>'
          +'<span style="font-size:11px;color:'+(isCur?'#3b82f6':isDone?'#64748b':'#94a3b8')
          +';font-weight:'+(isCur?600:400)
          +(isDone&&!isCur?';text-decoration:line-through':'')
          +'">'+esc(r.label||'\\u6b65\\u9a5f '+(ri+1))+'</span></div>';
      });
      infoHtml+='</div>';
    }

    h+='<div class="slide-content">'+imgHtml+'<div class="slide-info">'+infoHtml+'</div></div>';

    if(hasGuided&&guidedStarted&&correctRegs2.length>1){
      h+='<div class="step-dots">';
      correctRegs2.forEach(function(r,ri){
        var isDone=ri<gStep||gCompleted;
        var isCur=ri===gStep&&!gCompleted;
        if(ri>0)h+='<div class="step-line'+(ri<=gStep||gCompleted?' done':'')+'"></div>';
        h+='<div class="step-dot'+(isDone?' done':isCur?' current':' pending')+'">'+
          (isDone?'\\u2713':(ri+1))+'</div>';
      });
      h+='</div>';
    }
  } else if(hasImg){
    if(hotspotInstruction)infoHtml+='<div class="info-card"><div class="label">\\u8aaa\\u660e</div>'+simpleMarkdown(hotspotInstruction)+'</div>';
    h+='<div class="slide-content">'+imgHtml+'<div class="slide-info">'+infoHtml+'</div></div>';
  } else {
    for(var ti=0;ti<blocks.length;ti++){
      var tb=blocks[ti];
      if(tb.type==='text')h+='<div class="text-block">'+simpleMarkdown(tb.content||'')+'</div>';
      else if(tb.type==='callout'){var tv=tb.variant||'tip';h+='<div class="callout '+tv+'"><strong>'+(tv==='tip'?'\\u63d0\\u793a':tv==='warning'?'\\u8b66\\u544a':'\\u6ce8\\u610f')+'\\uff1a</strong>'+esc(tb.content||'')+'</div>'}
    }
  }

  if(s.audio){h+='<div style="padding:8px 16px"><audio controls src="'+s.audio+'" style="height:32px;width:100%"></audio></div>'}

  h+='</div>';
  return h;
}

function renderAnnotationsSvg(anns){
  var svg='<svg class="ann-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"><defs>'
    +'<marker id="ah" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0,10 3.5,0 7" fill="currentColor"/></marker></defs>';
  anns.forEach(function(a){
    if(a.visible===false)return;
    var c=a.color||'#ef4444';
    var sw=((a.strokeWidth||3)/3)*0.3;
    switch(a.type){
      case'number':
        svg+='<circle cx="'+a.coords.x+'" cy="'+a.coords.y+'" r="2.2" fill="'+c+'" stroke="#fff" stroke-width="0.15"/>';
        svg+='<text x="'+a.coords.x+'" y="'+a.coords.y+'" fill="#fff" font-size="2" text-anchor="middle" dominant-baseline="central" font-weight="bold">'+a.stepNumber+'</text>';
        if(a.label)svg+='<text x="'+(a.coords.x+3.5)+'" y="'+(a.coords.y+0.5)+'" fill="'+c+'" font-size="1.6" font-weight="600" stroke="#000" stroke-width="0.1" paint-order="stroke">'+esc(a.label)+'</text>';
        break;
      case'circle':svg+='<ellipse cx="'+a.coords.x+'" cy="'+a.coords.y+'" rx="'+(a.coords.rx||5)+'" ry="'+(a.coords.ry||5)+'" fill="none" stroke="'+c+'" stroke-width="'+sw+'"/>';break;
      case'rect':svg+='<rect x="'+a.coords.x+'" y="'+a.coords.y+'" width="'+(a.coords.w||10)+'" height="'+(a.coords.h||5)+'" fill="none" stroke="'+c+'" stroke-width="'+sw+'"/>';break;
      case'arrow':svg+='<g style="color:'+c+'"><line x1="'+a.coords.x+'" y1="'+a.coords.y+'" x2="'+(a.coords.x2||a.coords.x+10)+'" y2="'+(a.coords.y2||a.coords.y)+'" stroke="'+c+'" stroke-width="'+sw+'" marker-end="url(#ah)"/></g>';break;
      case'text':svg+='<text x="'+a.coords.x+'" y="'+a.coords.y+'" fill="'+c+'" font-size="2" font-weight="600" stroke="#000" stroke-width="0.1" paint-order="stroke">'+esc(a.label||'')+'</text>';break;
      case'freehand':
        if(a.coords.points&&a.coords.points.length>1){
          var d=a.coords.points.map(function(p,pi){return(pi?'L':'M')+' '+p.x+' '+p.y}).join(' ');
          svg+='<path d="'+d+'" fill="none" stroke="'+c+'" stroke-width="'+sw+'" stroke-linecap="round"/>';
        }
        break;
    }
  });
  svg+='</svg>';
  return svg;
}

function renderQuiz(){
  var qs=D.quiz[lang]||[];
  if(!qs.length)return'<div class="quiz-wrap"><p>\\u7121\\u6e2c\\u9a57\\u984c</p></div>';
  var h='<div class="quiz-wrap"><h3 style="margin-bottom:16px;font-size:16px">\\u6e2c\\u9a57</h3>';
  qs.forEach(function(q,qi){
    var qd={};try{qd=JSON.parse(q.question_json)}catch(e){}
    h+='<div class="quiz-q"><h4>'+(qi+1)+'. '+esc(qd.question||qd.text||'')+'</h4>';
    (qd.options||[]).forEach(function(opt,oi){
      var sel=quizAnswers[qi]===oi;
      var cls=sel?'selected':'';
      if(quizSubmitted){cls=opt.correct?'correct':(sel?'wrong':'')}
      h+='<label class="'+cls+'" data-q="'+qi+'" data-o="'+oi+'"><input type="radio" name="q'+qi+'" style="margin-right:6px"'+(sel?' checked':'')+'>'+esc(typeof opt==='string'?opt:opt.text||'')+'</label>';
    });
    if(quizSubmitted&&q.explanation){h+='<div style="margin-top:8px;font-size:12px;color:#64748b">\\ud83d\\udca1 '+esc(q.explanation)+'</div>'}
    h+='</div>';
  });
  if(!quizSubmitted){
    h+='<button id="submitQuiz" style="background:#2563eb;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:14px;cursor:pointer">\\u63d0\\u4ea4\\u7b54\\u6848</button>';
  } else {
    var score=0,total=0;
    qs.forEach(function(q,qi){
      var qd={};try{qd=JSON.parse(q.question_json)}catch(e){}
      var pts=q.points||10;total+=pts;
      var selOpt=(qd.options||[])[quizAnswers[qi]];
      if(selOpt&&(selOpt.correct||selOpt.is_correct))score+=pts;
    });
    var pass=score>=D.settings.passScore*(total/100);
    h+='<div class="quiz-result '+(pass?'pass':'fail')+'">'+(pass?'\\u2705 \\u901a\\u904e':'\\u274c \\u672a\\u901a\\u904e')+' \\u2014 '+score+'/'+total+' \\u5206</div>';
  }
  h+='</div>';
  return h;
}

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function decEsc(s){return String(s||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')}
function simpleMarkdown(s){
  var t=esc(s);
  t=t.split(String.fromCharCode(10)).join('<br>');
  t=t.replace(new RegExp('([.:'+String.fromCharCode(12290)+'])\\\\s*'+String.fromCharCode(27493,39519),'g'),'$1<br>'+String.fromCharCode(27493,39519));
  t=t.replace(new RegExp('^## (.+)$','gm'),'<h2 style="font-size:15px;margin:6px 0">$1</h2>');
  t=t.replace(new RegExp('^### (.+)$','gm'),'<h3 style="font-size:14px;margin:4px 0">$1</h3>');
  t=t.replace(new RegExp('[*][*](.+?)[*][*]','g'),'<strong>$1</strong>');
  var bt=String.fromCharCode(96);
  t=t.replace(new RegExp(bt+'(.+?)'+bt,'g'),'<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px">$1</code>');
  t=t.replace(new RegExp('^(<br>)+'),'');
  return t;
}

// Init — no auto-play on load; user clicks "start" button
render();

// Key nav
document.addEventListener('keydown',function(e){
  if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();var nb=$('#next');if(nb)nb.click()}
  if(e.key==='ArrowLeft'){e.preventDefault();var pb=$('#prev');if(pb)pb.click()}
});

// Click interaction
document.addEventListener('click',function(e){
  var imgWrap=e.target.closest&&e.target.closest('#imgWrap');
  if(imgWrap&&!gCompleted&&!autoPlaying&&guidedStarted){
    var s=getSlides()[idx];
    var hb=getHotspotBlock(s);
    if(!hb)return;
    var crs=getCorrectRegions(hb);
    if(crs.length===0)return;
    var rect=imgWrap.getBoundingClientRect();
    var x=((e.clientX-rect.left)/rect.width)*100;
    var y=((e.clientY-rect.top)/rect.height)*100;

    var hit=null;
    crs.forEach(function(r,ri){
      var c=toPercent(hb,r.coords);
      if(x>=c.x&&x<=c.x+c.w&&y>=c.y&&y<=c.y+c.h)hit={r:r,i:ri};
    });

    gAttempts++;

    if(!hit){
      gStepAttempts++;
      var hints=['\\u518d\\u8a66\\u4e00\\u6b21','\\u4e0d\\u662f\\u9019\\u88e1\\uff0c\\u8acb\\u4ed4\\u7d30\\u770b\\u770b','\\u63d0\\u793a\\uff1a\\u6ce8\\u610f\\u6a19\\u8a18\\u7684\\u4f4d\\u7f6e'];
      gFeedback={text:hints[Math.min(gStepAttempts-1,hints.length-1)],correct:false};
      gHitRegion=null;
      render();
      return;
    }

    if(hit.i===gStep){
      if(audio){audio.pause();audio.currentTime=0}
      gFeedback={text:hit.r.feedback||'\\u6b63\\u78ba\\uff01',correct:true};
      gHitRegion=hit.r.id;
      render();
      setTimeout(function(){
        gStep++;gFeedback=null;gHitRegion=null;gStepAttempts=0;
        if(gStep>=crs.length){
          gCompleted=true;
          render();
        } else {
          render();
          var nextR=crs[gStep];
          if(nextR&&nextR.audio_url)playAudio(nextR.audio_url);
        }
      },1200);
    } else {
      gStepAttempts++;
      var target=crs[gStep];
      if(gStepAttempts>=3&&target){
        gFeedback={text:'\\u63d0\\u793a\\uff1a\\u8acb\\u627e\\u5230\\u300c'+(target.label||'\\u76ee\\u6a19')+'\\u300d',correct:false};
      } else {
        gFeedback={text:hit.r.feedback_wrong||hit.r.feedback||'\\u4e0d\\u662f\\u9019\\u500b\\uff0c\\u518d\\u8a66\\u8a66',correct:false};
      }
      gHitRegion=hit.r.id;
      render();
      setTimeout(function(){gHitRegion=null;render()},600);
    }
    return;
  }

  var label=e.target.closest&&e.target.closest('label[data-q]');
  if(label&&!quizSubmitted){
    quizAnswers[label.dataset.q]=parseInt(label.dataset.o);
    render();
  }
  if(e.target.id==='submitQuiz'){quizSubmitted=true;render()}
});
})();
</script>
</body>
</html>`;
}


// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3A: AI Re-analyze a single slide
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/slides/:sid/ai-analyze', async (req, res) => {
  try {
    const slide = await db.prepare('SELECT * FROM course_slides WHERE id=?').get(req.params.sid);
    if (!slide) return res.status(404).json({ error: '投影片不存在' });

    const check = await verifyLessonAccess(slide.lesson_id, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });

    // Parse content_json to find the image block
    let blocks;
    try { blocks = JSON.parse(slide.content_json || '[]'); } catch { return res.status(400).json({ error: 'Invalid content_json' }); }
    const imgBlock = blocks.find(b => (b.type === 'hotspot' || b.type === 'image') && (b.image || b.src));
    if (!imgBlock) return res.status(400).json({ error: '投影片無截圖' });

    const imgUrl = imgBlock.image || imgBlock.src;
    let filePath = path.join(uploadDir, imgUrl.replace('/api/training/files/', ''));
    if (!fs.existsSync(filePath) && fs.existsSync(altUploadDir)) {
      const alt = path.join(altUploadDir, imgUrl.replace('/api/training/files/', ''));
      if (fs.existsSync(alt)) filePath = alt;
    }
    if (!fs.existsSync(filePath)) return res.status(400).json({ error: '截圖檔案不存在' });

    const imageBase64 = fs.readFileSync(filePath).toString('base64');

    // Build annotation prompt from existing annotations
    let annotationPrompt = '';
    const annotations = imgBlock.annotations || [];
    if (annotations.length > 0) {
      const stepAnnots = annotations.filter(a => a.type === 'number').sort((a, b) => (a.stepNumber || 0) - (b.stepNumber || 0));
      if (stepAnnots.length > 0) {
        const lines = ['使用者在截圖上做了以下標註：'];
        stepAnnots.forEach(a => {
          lines.push(`步驟 ${a.stepNumber}: 在座標 (${a.coords.x?.toFixed?.(1) || a.coords.x}%, ${a.coords.y?.toFixed?.(1) || a.coords.y}%)${a.label ? `，標註「${a.label}」` : ''}`);
        });
        lines.push('請根據標註的步驟順序生成操作說明，標註的元素設為 is_primary。');
        annotationPrompt = '\n' + lines.join('\n') + '\n';
      }
    }

    // AI model selection
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    let modelName = req.body.model || null;
    if (!modelName) {
      const setting = await db.prepare(`SELECT value FROM system_settings WHERE key='training_analyze_model'`).get();
      modelName = setting?.value || null;
    }
    if (!modelName) {
      const flashRow = await db.prepare(
        `SELECT api_model FROM llm_models WHERE model_role='chat' AND is_active=1 AND provider_type='gemini' ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
      ).get();
      modelName = flashRow?.api_model || process.env.GEMINI_MODEL_FLASH || 'gemini-3-flash-preview';
    }
    const model = genAI.getGenerativeModel({ model: modelName });

    const prompt = `分析這張系統操作截圖。${annotationPrompt}
識別所有可互動 UI 元素，回傳 JSON：
{ "regions": [{ "type": "...", "label": "...", "coords": { "x": 0, "y": 0, "w": 0, "h": 0 }, "is_primary": false }],
  "instruction": "操作說明", "narration": "旁白文字" }
注意：coords 的 x, y, w, h 必須是百分比 (0-100)，相對於圖片寬高。
只回傳 JSON。`;

    const result = await model.generateContent([
      { inlineData: { mimeType: 'image/png', data: imageBase64 } },
      { text: prompt }
    ]);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    // Normalize coordinates
    const sizeOf = require('image-size');
    let imgW = 1920, imgH = 1080;
    try { const dim = sizeOf(fs.readFileSync(filePath)); if (dim.width) { imgW = dim.width; imgH = dim.height; } } catch {}

    const regions = (parsed.regions || []).map(r => {
      const c = r.coords;
      if (c.x > 100 || c.y > 100 || c.w > 100 || c.h > 100) {
        return { ...r, coords: { x: c.x / imgW * 100, y: c.y / imgH * 100, w: c.w / imgW * 100, h: c.h / imgH * 100 } };
      }
      return r;
    });

    // Match user annotations to find correct regions
    const userNumbers = annotations.filter(a => a.type === 'number');
    let hotspotRegions;
    if (userNumbers.length > 0 && regions.length > 0) {
      hotspotRegions = userNumbers.map((ua, i) => {
        const closest = regions.reduce((best, r) => {
          const cx = r.coords.x + (r.coords.w || 0) / 2;
          const cy = r.coords.y + (r.coords.h || 0) / 2;
          const dist = Math.sqrt((cx - ua.coords.x) ** 2 + (cy - ua.coords.y) ** 2);
          return dist < best.dist ? { r, dist } : best;
        }, { r: null, dist: Infinity });
        if (closest.r && closest.dist < 30) {
          return {
            id: `r${i + 1}`, shape: 'rect', coords: closest.r.coords,
            correct: true, label: closest.r.label || ua.label || `步驟 ${ua.stepNumber}`,
            type: closest.r.type || '',
            feedback: `正確！${closest.r.label ? '這就是「' + closest.r.label + '」。' : ''}`
          };
        }
        return null;
      }).filter(Boolean);
    } else {
      hotspotRegions = regions.filter(r => r.is_primary).map((r, i) => ({
        id: `r${i + 1}`, shape: 'rect', coords: r.coords,
        correct: true, label: r.label || `元素 ${i + 1}`, type: r.type || '',
        feedback: `正確！${r.label ? '這就是「' + r.label + '」。' : ''}`
      }));
    }

    // Update the slide's content_json
    const blockIdx = blocks.indexOf(imgBlock);
    imgBlock.regions = hotspotRegions;
    imgBlock.instruction = parsed.instruction || imgBlock.instruction;
    imgBlock.coordinate_system = 'percent';
    imgBlock.image_dimensions = { w: imgW, h: imgH };
    if (hotspotRegions.length > 0 && imgBlock.type === 'image') {
      imgBlock.type = 'hotspot';
      imgBlock.max_attempts = imgBlock.max_attempts || 3;
      imgBlock.show_hint_after = imgBlock.show_hint_after || 2;
    }

    const newSlideType = hotspotRegions.length > 0 ? 'hotspot' : slide.slide_type;
    if (parsed.narration) {
      await db.prepare('UPDATE course_slides SET content_json=?, slide_type=?, notes=? WHERE id=?')
        .run(JSON.stringify(blocks), newSlideType, parsed.narration, slide.id);
    } else {
      await db.prepare('UPDATE course_slides SET content_json=?, slide_type=? WHERE id=?')
        .run(JSON.stringify(blocks), newSlideType, slide.id);
    }

    res.json({
      ok: true,
      instruction: parsed.instruction,
      narration: parsed.narration,
      regions: hotspotRegions,
      block_index: blockIdx
    });
  } catch (e) {
    console.error('[Training] slide ai-analyze:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3A-2: Language-specific Image Upload
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/training/slides/:sid/lang-image — upload language-specific base image
router.post('/slides/:sid/lang-image', upload.single('file'), async (req, res) => {
  try {
    const { lang, block_index } = req.body;
    if (!lang || lang === 'zh-TW') return res.status(400).json({ error: 'lang must be en or vi' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const slide = await db.prepare('SELECT lesson_id FROM course_slides WHERE id=?').get(req.params.sid);
    if (!slide) return res.status(404).json({ error: '投影片不存在' });

    const check = await verifyLessonAccess(slide.lesson_id, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });

    // Multer may save to course_tmp/ when :sid doesn't match :id — move to correct dir
    const correctDir = path.join(uploadDir, `course_${check.courseId}`);
    if (!fs.existsSync(correctDir)) fs.mkdirSync(correctDir, { recursive: true });
    const correctPath = path.join(correctDir, req.file.filename);
    if (req.file.path !== correctPath && !fs.existsSync(correctPath)) {
      fs.renameSync(req.file.path, correctPath);
    }

    const imgUrl = `/api/training/files/course_${check.courseId}/${req.file.filename}`;
    const idx = block_index || '0';

    // Upsert slide_translations.image_overrides
    const existing = await db.prepare('SELECT id, image_overrides FROM slide_translations WHERE slide_id=? AND lang=?').get(req.params.sid, lang);
    let overrides = {};
    if (existing?.image_overrides) { try { overrides = JSON.parse(existing.image_overrides); } catch {} }
    overrides[String(idx)] = imgUrl;
    const overridesJson = JSON.stringify(overrides);

    if (existing) {
      await db.prepare('UPDATE slide_translations SET image_overrides=? WHERE id=?').run(overridesJson, existing.id);
    } else {
      await db.prepare('INSERT INTO slide_translations (slide_id, lang, image_overrides) VALUES (?,?,?)').run(req.params.sid, lang, overridesJson);
    }

    res.json({ ok: true, image_url: imgUrl, overrides });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/training/slides/:sid/lang-image — remove language-specific image
router.delete('/slides/:sid/lang-image', async (req, res) => {
  try {
    const { lang, block_index } = req.body;
    const existing = await db.prepare('SELECT id, image_overrides FROM slide_translations WHERE slide_id=? AND lang=?').get(req.params.sid, lang);
    if (!existing) return res.json({ ok: true });

    let overrides = {};
    if (existing.image_overrides) { try { overrides = JSON.parse(existing.image_overrides); } catch {} }
    delete overrides[String(block_index || '0')];
    await db.prepare('UPDATE slide_translations SET image_overrides=? WHERE id=?').run(JSON.stringify(overrides), existing.id);
    res.json({ ok: true, overrides });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/slides/:sid/lang-images — get all language image overrides
router.get('/slides/:sid/lang-images', async (req, res) => {
  try {
    const rows = await db.prepare('SELECT lang, image_overrides FROM slide_translations WHERE slide_id=? AND image_overrides IS NOT NULL').all(req.params.sid);
    const result = {};
    rows.forEach(r => { try { result[r.lang] = JSON.parse(r.image_overrides); } catch {} });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/training/slides/:sid/region-overrides — save per-language region positions
router.put('/slides/:sid/region-overrides', async (req, res) => {
  try {
    const { lang, region_overrides } = req.body;
    if (!lang || lang === 'zh-TW') return res.status(400).json({ error: 'lang must be en or vi' });

    const existing = await db.prepare('SELECT id, image_overrides FROM slide_translations WHERE slide_id=? AND lang=?').get(req.params.sid, lang);
    let overrides = {};
    if (existing?.image_overrides) { try { overrides = JSON.parse(existing.image_overrides); } catch {} }
    overrides.region_overrides = region_overrides || {};
    const overridesJson = JSON.stringify(overrides);

    if (existing) {
      await db.prepare('UPDATE slide_translations SET image_overrides=? WHERE id=?').run(overridesJson, existing.id);
    } else {
      await db.prepare('INSERT INTO slide_translations (slide_id, lang, image_overrides) VALUES (?,?,?)').run(req.params.sid, lang, overridesJson);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3B: Language-independent Regions
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/training/slides/:sid/lang-regions — get independent regions + translated block data
router.get('/slides/:sid/lang-regions', async (req, res) => {
  try {
    // 1. Independent regions (existing)
    const rows = await db.prepare(
      'SELECT lang, regions_json FROM slide_translations WHERE slide_id=? AND regions_json IS NOT NULL'
    ).all(req.params.sid);
    const result = {};
    rows.forEach(r => { try { result[r.lang] = JSON.parse(r.regions_json); } catch {} });

    // 2. Translated block data — extract hotspot regions + intro from content_json per lang
    const transRows = await db.prepare(
      `SELECT lang, content_json FROM slide_translations WHERE slide_id=? AND content_json IS NOT NULL AND lang<>'zh-TW'`
    ).all(req.params.sid);
    const _translated = {};
    const INTRO_FIELDS = [
      'slide_narration', 'slide_narration_audio',
      'slide_narration_test', 'slide_narration_test_audio',
      'slide_narration_explore', 'slide_narration_explore_audio',
      'completion_message'
    ];
    for (const row of transRows) {
      let blocks;
      try { blocks = JSON.parse(row.content_json); } catch { continue; }
      if (!Array.isArray(blocks)) continue;
      const langBlocks = {};
      blocks.forEach((block, idx) => {
        if (block.type !== 'hotspot') return;
        const intro = {};
        for (const f of INTRO_FIELDS) { if (block[f]) intro[f] = block[f]; }
        langBlocks[String(idx)] = {
          regions: block.regions || [],
          intro: Object.keys(intro).length > 0 ? intro : null,
        };
      });
      if (Object.keys(langBlocks).length > 0) {
        _translated[row.lang] = langBlocks;
      }
    }
    result._translated = _translated;

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/training/slides/:sid/lang-regions — save language-specific independent regions
router.put('/slides/:sid/lang-regions', async (req, res) => {
  try {
    const { lang, block_index, regions, _intro } = req.body;
    if (!lang) return res.status(400).json({ error: 'lang is required' });

    const slide = await db.prepare('SELECT lesson_id FROM course_slides WHERE id=?').get(req.params.sid);
    if (!slide) return res.status(404).json({ error: '投影片不存在' });

    const check = await verifyLessonAccess(slide.lesson_id, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });

    const idx = String(block_index || 0);
    const existing = await db.prepare(
      'SELECT id, regions_json FROM slide_translations WHERE slide_id=? AND lang=?'
    ).get(req.params.sid, lang);

    let regionsMap = {};
    if (existing?.regions_json) { try { regionsMap = JSON.parse(existing.regions_json); } catch {} }
    if (regions) regionsMap[idx] = regions;
    if (_intro) regionsMap._intro = _intro;
    const regionsStr = JSON.stringify(regionsMap);

    if (existing) {
      await db.prepare('UPDATE slide_translations SET regions_json=? WHERE id=?').run(regionsStr, existing.id);
    } else {
      await db.prepare('INSERT INTO slide_translations (slide_id, lang, regions_json) VALUES (?,?,?)').run(req.params.sid, lang, regionsStr);
    }
    res.json({ ok: true, regions_json: regionsMap });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/training/slides/:sid/lang-regions — remove language-specific regions (revert to inherit)
router.delete('/slides/:sid/lang-regions', async (req, res) => {
  try {
    const { lang, block_index } = req.body;
    if (!lang) return res.status(400).json({ error: 'lang is required' });

    const existing = await db.prepare(
      'SELECT id, regions_json FROM slide_translations WHERE slide_id=? AND lang=?'
    ).get(req.params.sid, lang);
    if (!existing) return res.json({ ok: true });

    let regionsMap = {};
    if (existing.regions_json) { try { regionsMap = JSON.parse(existing.regions_json); } catch {} }
    if (block_index !== undefined) {
      delete regionsMap[String(block_index)];
    } else {
      regionsMap = {}; // clear all
    }

    const val = Object.keys(regionsMap).length > 0 ? JSON.stringify(regionsMap) : null;
    await db.prepare('UPDATE slide_translations SET regions_json=? WHERE id=?').run(val, existing.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2E: AI Model Selector
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/training/ai/models — list available Gemini models for training AI features
router.get('/ai/models', async (req, res) => {
  try {
    const models = await db.prepare(
      `SELECT id, name AS display_name, api_model, model_role, sort_order
       FROM llm_models WHERE is_active=1 AND provider_type='gemini'
       ORDER BY sort_order`
    ).all();
    res.json(models);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/training/ai/settings — read AI model settings
router.get('/ai/settings', async (req, res) => {
  try {
    const keys = ['training_analyze_model', 'training_translate_model'];
    const result = {};
    for (const key of keys) {
      const row = await db.prepare('SELECT value FROM system_settings WHERE key=?').get(key);
      result[key] = row?.value || '';
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/training/ai/settings — save AI model settings (admin only)
router.put('/ai/settings', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
  try {
    const { training_analyze_model, training_translate_model } = req.body;
    const upsert = async (key, value) => {
      const existing = await db.prepare('SELECT key FROM system_settings WHERE key=?').get(key);
      if (existing) {
        await db.prepare('UPDATE system_settings SET value=? WHERE key=?').run(value || '', key);
      } else {
        await db.prepare('INSERT INTO system_settings (key, value) VALUES (?,?)').run(key, value || '');
      }
    };
    if (training_analyze_model !== undefined) await upsert('training_analyze_model', training_analyze_model);
    if (training_translate_model !== undefined) await upsert('training_translate_model', training_translate_model);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2D: Cross-system Management
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/systems', async (req, res) => {
  try {
    const rows = await db.prepare('SELECT * FROM training_systems ORDER BY created_at').all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/systems', async (req, res) => {
  try {
    const { name, url, description, icon, login_url, login_config, help_source } = req.body;
    const result = await db.prepare(`
      INSERT INTO training_systems (name, url, description, icon, login_url, login_config, help_source, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, url || null, description || null, icon || null, login_url || null,
           login_config ? JSON.stringify(login_config) : null, help_source || 'manual', req.user.id);
    res.json({ id: result.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/systems/:id', async (req, res) => {
  try {
    const { name, url, description, icon, login_url, login_config, help_source } = req.body;
    await db.prepare(`
      UPDATE training_systems SET name=?, url=?, description=?, icon=?, login_url=?, login_config=?, help_source=?
      WHERE id=?
    `).run(name, url || null, description || null, icon || null, login_url || null,
           login_config ? JSON.stringify(login_config) : null, help_source || 'manual', req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/systems/:id', async (req, res) => {
  try {
    await db.prepare('DELETE FROM training_systems WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Teaching Scripts
router.get('/systems/:id/scripts', async (req, res) => {
  try {
    const rows = await db.prepare(
      'SELECT * FROM teaching_scripts WHERE system_id=? ORDER BY sort_order, id'
    ).all(req.params.id);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/systems/:id/scripts', async (req, res) => {
  try {
    const { module: mod, title, steps_json, prerequisites, estimated_time } = req.body;
    const stepsStr = typeof steps_json === 'string' ? steps_json : JSON.stringify(steps_json || []);
    const result = await db.prepare(`
      INSERT INTO teaching_scripts (system_id, module, title, steps_json, prerequisites, estimated_time, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, mod || null, title, stepsStr, prerequisites || null, estimated_time || null, req.user.id);
    res.json({ id: result.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/scripts/:id', async (req, res) => {
  try {
    const { module: mod, title, steps_json, prerequisites, estimated_time } = req.body;
    const stepsStr = typeof steps_json === 'string' ? steps_json : JSON.stringify(steps_json || []);
    await db.prepare(`
      UPDATE teaching_scripts SET module=?, title=?, steps_json=?, prerequisites=?,
             estimated_time=?, updated_at=SYSTIMESTAMP WHERE id=?
    `).run(mod || null, title, stepsStr, prerequisites || null, estimated_time || null, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/scripts/:id', async (req, res) => {
  try {
    await db.prepare('DELETE FROM teaching_scripts WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Import scripts (batch)
router.post('/scripts/import', async (req, res) => {
  try {
    const { system_id, scripts } = req.body;
    if (!Array.isArray(scripts)) return res.status(400).json({ error: 'scripts array required' });
    let created = 0;
    for (const s of scripts) {
      await db.prepare(`
        INSERT INTO teaching_scripts (system_id, module, title, steps_json, prerequisites, estimated_time, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(system_id, s.module || null, s.title, JSON.stringify(s.steps || []),
             s.prerequisites || null, s.estimated_time || null, req.user.id);
      created++;
    }
    res.json({ ok: true, created });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Interaction Reports (Admin / Owner)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/training/courses/:id/interaction-report — course-level summary + per-slide stats
router.get('/courses/:id/interaction-report', loadCoursePermission, requirePermission('owner', 'admin'), async (req, res) => {
  try {
    // Course summary
    const summary = await db.prepare(`
      SELECT COUNT(DISTINCT user_id) AS total_users,
             ROUND(AVG(score), 1) AS avg_score,
             ROUND(AVG(total_time_seconds), 1) AS avg_time,
             ROUND(AVG(CASE WHEN steps_completed = total_steps THEN 1 ELSE 0 END) * 100, 1) AS completion_rate
      FROM interaction_results WHERE course_id=?
    `).get(req.courseId);

    // Per-slide stats
    const slides = await db.prepare(`
      SELECT ir.slide_id, ir.block_type,
             COUNT(*) AS attempts,
             COUNT(DISTINCT ir.user_id) AS user_count,
             ROUND(AVG(ir.score), 1) AS avg_score,
             ROUND(AVG(ir.max_score), 1) AS avg_max_score,
             ROUND(AVG(ir.wrong_clicks), 1) AS avg_wrong_clicks,
             ROUND(AVG(ir.total_time_seconds), 1) AS avg_time,
             MAX(cs.sort_order) AS slide_order,
             MAX(cs.content_json) AS slide_content_json
      FROM interaction_results ir
      LEFT JOIN course_slides cs ON cs.id = ir.slide_id
      WHERE ir.course_id=?
      GROUP BY ir.slide_id, ir.block_type
      ORDER BY ir.slide_id
    `).all(req.courseId);
    // Extract slide title from content_json (first block's instruction/content/text)
    for (const s of slides) {
      let title = null;
      try {
        const blocks = JSON.parse(s.slide_content_json || '[]');
        const first = blocks[0];
        if (first) {
          const raw = first.instruction || first.content || first.text || '';
          if (raw) title = String(raw).slice(0, 40);
        }
      } catch {}
      s.slide_title = title;
      delete s.slide_content_json;
    }

    // Per-user summary
    const users = await db.prepare(`
      SELECT ir.user_id, u.name AS user_name, u.employee_id,
             COUNT(*) AS total_interactions,
             ROUND(AVG(ir.score), 1) AS avg_score,
             ROUND(SUM(ir.total_time_seconds), 0) AS total_time
      FROM interaction_results ir
      JOIN users u ON u.id = ir.user_id
      WHERE ir.course_id=?
      GROUP BY ir.user_id, u.name, u.employee_id
      ORDER BY u.name
    `).all(req.courseId);

    res.json({ summary, slides, users });
  } catch (e) {
    console.error('[Training] interaction-report:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/courses/:id/interaction-report/:userId — per-user detail
router.get('/courses/:id/interaction-report/:userId', loadCoursePermission, requirePermission('owner', 'admin'), async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const user = await db.prepare('SELECT name, employee_id FROM users WHERE id=?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const results = await db.prepare(`
      SELECT ir.*, cs.sort_order AS slide_order, cs.content_json AS slide_content_json
      FROM interaction_results ir
      LEFT JOIN course_slides cs ON cs.id = ir.slide_id
      WHERE ir.course_id=? AND ir.user_id=?
      ORDER BY cs.sort_order, ir.created_at
    `).all(req.courseId, userId);

    // Parse CLOB fields + extract slide title
    for (const r of results) {
      try { r.action_log = JSON.parse(r.action_log || '[]'); } catch { r.action_log = []; }
      try { r.score_breakdown = JSON.parse(r.score_breakdown || '{}'); } catch { r.score_breakdown = {}; }
      let title = null;
      try {
        const blocks = JSON.parse(r.slide_content_json || '[]');
        const first = blocks[0];
        if (first) {
          const raw = first.instruction || first.content || first.text || '';
          if (raw) title = String(raw).slice(0, 40);
        }
      } catch {}
      r.slide_title = title;
      delete r.slide_content_json;
    }

    res.json({ user, results });
  } catch (e) {
    console.error('[Training] interaction-report user:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/courses/:id/my-interaction-history — user's own session-grouped history
router.get('/courses/:id/my-interaction-history', async (req, res) => {
  try {
    const courseId = Number(req.params.id);
    const lessonId = req.query.lesson_id ? Number(req.query.lesson_id) : null;

    let whereExtra = '';
    const params = [req.user.id, courseId];
    if (lessonId) {
      whereExtra = ` AND ir.slide_id IN (SELECT id FROM course_slides WHERE lesson_id=?)`;
      params.push(lessonId);
    }

    // Session-level aggregation — use weighted scores when available, fallback to raw
    const sessions = await db.prepare(`
      SELECT ir.session_id, ir.player_mode,
             SUM(COALESCE(ir.weighted_score, ir.score)) AS total_score,
             SUM(COALESCE(ir.weighted_max, ir.max_score)) AS total_max,
             COUNT(*) AS interactions,
             ROUND(SUM(ir.total_time_seconds)) AS total_time,
             MIN(ir.created_at) AS started_at,
             MAX(ir.created_at) AS ended_at,
             MAX(ir.exam_topic_id) AS exam_topic_id,
             MAX(et.title) AS exam_topic_title
      FROM interaction_results ir
      LEFT JOIN exam_topics et ON et.id = ir.exam_topic_id
      WHERE ir.user_id=? AND ir.course_id=? AND ir.session_id IS NOT NULL${whereExtra}
      GROUP BY ir.session_id, ir.player_mode
      ORDER BY MAX(ir.created_at) DESC
      FETCH FIRST 50 ROWS ONLY
    `).all(...params);

    // Fetch details for each session
    for (const s of sessions) {
      const detailParams = [req.user.id, courseId, s.session_id];
      if (lessonId) detailParams.push(lessonId);
      s.details = await db.prepare(`
        SELECT ir.slide_id, ir.block_type, ir.score, ir.max_score,
               ir.total_time_seconds, ir.wrong_clicks, ir.steps_completed, ir.total_steps,
               cs.sort_order AS slide_order, cs.content_json AS slide_content_json
        FROM interaction_results ir
        LEFT JOIN course_slides cs ON cs.id = ir.slide_id
        WHERE ir.user_id=? AND ir.course_id=? AND ir.session_id=?${lessonId ? ' AND ir.slide_id IN (SELECT id FROM course_slides WHERE lesson_id=?)' : ''}
        ORDER BY ir.created_at
      `).all(...detailParams);
      // Extract slide title from content_json (first block's instruction/content/text)
      for (const d of s.details) {
        let title = null;
        try {
          const blocks = JSON.parse(d.slide_content_json || '[]');
          const first = blocks[0];
          if (first) {
            const raw = first.instruction || first.content || first.text || '';
            if (raw) title = String(raw).slice(0, 40);
          }
        } catch {}
        d.slide_title = title;
        delete d.slide_content_json; // don't ship CLOB to client
      }
    }

    res.json({ sessions });
  } catch (e) {
    console.error('[Training] my-interaction-history:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Course Package Export / Import (環境遷移用)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/training/courses/:id/export-package — download ZIP with full course data + files
router.get('/courses/:id/export-package', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const courseId = req.courseId;
    const archiver = require('archiver');

    // 1. Course metadata
    const course = await db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);
    if (!course) return res.status(404).json({ error: '課程不存在' });

    // 2. Lessons
    const lessons = await db.prepare('SELECT * FROM course_lessons WHERE course_id=? ORDER BY sort_order').all(courseId);

    // 3. Slides (per lesson)
    const slides = [];
    for (const lesson of lessons) {
      const lessonSlides = await db.prepare('SELECT * FROM course_slides WHERE lesson_id=? ORDER BY sort_order').all(lesson.id);
      slides.push(...lessonSlides.map(s => ({ ...s, _lesson_sort: lesson.sort_order })));
    }

    // 4. Quiz questions
    const questions = await db.prepare('SELECT * FROM quiz_questions WHERE course_id=? ORDER BY sort_order').all(courseId);

    // 5. Translations
    const courseTranslations = await db.prepare('SELECT * FROM course_translations WHERE course_id=?').all(courseId);
    const lessonIds = lessons.map(l => l.id);
    let lessonTranslations = [];
    if (lessonIds.length > 0) {
      const ph = lessonIds.map(() => '?').join(',');
      lessonTranslations = await db.prepare(`SELECT * FROM lesson_translations WHERE lesson_id IN (${ph})`).all(...lessonIds);
    }
    const slideIds = slides.map(s => s.id);
    let slideTranslations = [];
    if (slideIds.length > 0) {
      const ph = slideIds.map(() => '?').join(',');
      slideTranslations = await db.prepare(`SELECT * FROM slide_translations WHERE slide_id IN (${ph})`).all(...slideIds);
    }
    const questionIds = questions.map(q => q.id);
    let quizTranslations = [];
    if (questionIds.length > 0) {
      const ph = questionIds.map(() => '?').join(',');
      quizTranslations = await db.prepare(`SELECT * FROM quiz_translations WHERE question_id IN (${ph})`).all(...questionIds);
    }

    // 6. Slide branches
    let slideBranches = [];
    if (slideIds.length > 0) {
      const ph = slideIds.map(() => '?').join(',');
      slideBranches = await db.prepare(`SELECT * FROM slide_branches WHERE slide_id IN (${ph})`).all(...slideIds);
    }

    // 7. Collect referenced files
    const fileRefs = new Set();
    const collectFileRefs = (json) => {
      if (!json) return;
      const str = typeof json === 'string' ? json : JSON.stringify(json);
      // Match both /api/training/files/... and /uploads/training/... formats
      const matches = str.match(/(?:\/api\/training\/files\/|\/uploads\/training\/)[^"'\s,)}\]]+/g);
      if (matches) matches.forEach(m => {
        const ref = m.replace('/api/training/files/', '').replace(/^\/?(uploads\/training\/)/, '');
        fileRefs.add(ref);
      });
    };
    for (const s of slides) {
      collectFileRefs(s.content_json);
      if (s.audio_url) fileRefs.add(s.audio_url.replace('/api/training/files/', ''));
    }
    for (const st of slideTranslations) {
      collectFileRefs(st.content_json);
      collectFileRefs(st.image_overrides);
      collectFileRefs(st.regions_json);
      if (st.audio_url) fileRefs.add(st.audio_url.replace('/api/training/files/', ''));
    }
    // Cover image — may be stored as /api/training/files/... or /uploads/training/...
    if (course.cover_image) {
      const coverRef = course.cover_image
        .replace('/api/training/files/', '')
        .replace(/^\/?(uploads\/training\/)/, '');
      fileRefs.add(coverRef);
    }

    // Build manifest
    const manifest = {
      version: 1,
      exported_at: new Date().toISOString(),
      course: {
        title: course.title,
        description: course.description,
        category_name: course.category_id ? (await db.prepare('SELECT name FROM course_categories WHERE id=?').get(course.category_id))?.name : null,
        pass_score: course.pass_score,
        max_attempts: course.max_attempts,
        time_limit_minutes: course.time_limit_minutes,
        is_public: course.is_public,
        settings_json: course.settings_json,
        cover_image: course.cover_image,
      },
      lessons: lessons.map(l => ({
        _orig_id: l.id,
        title: l.title,
        sort_order: l.sort_order,
        lesson_type: l.lesson_type,
      })),
      slides: slides.map(s => ({
        _orig_id: s.id,
        _orig_lesson_id: s.lesson_id,
        slide_type: s.slide_type,
        content_json: s.content_json,
        notes: s.notes,
        audio_url: s.audio_url,
        duration_seconds: s.duration_seconds,
        sort_order: s.sort_order,
      })),
      questions: questions.map(q => ({
        _orig_id: q.id,
        question_type: q.question_type,
        question_json: q.question_json,
        answer_json: q.answer_json,
        scoring_json: q.scoring_json,
        points: q.points,
        explanation: q.explanation,
        sort_order: q.sort_order,
      })),
      slide_branches: slideBranches.map(b => ({
        _orig_slide_id: b.slide_id,
        option_text: b.option_text,
        option_index: b.option_index,
        _orig_target_slide_id: b.target_slide_id,
        _orig_target_lesson_id: b.target_lesson_id,
      })),
      translations: {
        course: courseTranslations.map(ct => ({ lang: ct.lang, title: ct.title, description: ct.description })),
        lessons: lessonTranslations.map(lt => ({ _orig_lesson_id: lt.lesson_id, lang: lt.lang, title: lt.title })),
        slides: slideTranslations.map(st => ({
          _orig_slide_id: st.slide_id, lang: st.lang,
          content_json: st.content_json, notes: st.notes, audio_url: st.audio_url,
          image_overrides: st.image_overrides, regions_json: st.regions_json,
        })),
        questions: quizTranslations.map(qt => ({
          _orig_question_id: qt.question_id, lang: qt.lang,
          question_json: qt.question_json, explanation: qt.explanation,
        })),
      },
    };

    // Stream ZIP response
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="course_${courseId}_export.zip"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', (err) => {
      console.error('[Export] Archiver error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    archive.on('warning', (err) => {
      console.warn('[Export] Archiver warning:', err.message);
    });
    archive.on('end', () => {
      console.log(`[Export] Course ${courseId}: ZIP finalized, ${archive.pointer()} bytes`);
    });
    archive.pipe(res);
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    // Add files (uploadDir = UPLOAD_ROOT/training/, which is where express.static serves from)
    let filesFound = 0;
    for (const ref of fileRefs) {
      let filePath = path.join(uploadDir, ref);
      if (!fs.existsSync(filePath)) {
        // Fallback: try alternative upload dir (Docker legacy)
        const altPath = path.join(altUploadDir, ref);
        if (fs.existsSync(altPath)) filePath = altPath;
        else { console.warn(`[Export] File not found: ${ref} (tried ${uploadDir})`); continue; }
      }
      archive.file(filePath, { name: `files/${ref}` });
      filesFound++;
    }
    console.log(`[Export] Course ${courseId}: ${fileRefs.size} refs, ${filesFound} files queued`);

    await archive.finalize();
  } catch (e) {
    console.error('[Training] export-package:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// POST /api/training/courses/import-package — upload ZIP, create full course
router.post('/courses/import-package', upload.single('package'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (req.user.role !== 'admin' && req.user.effective_training_permission !== 'publish_edit')
      return res.status(403).json({ error: '權限不足' });

    const JSZip = require('jszip');
    const zipData = fs.readFileSync(req.file.path);
    const zip = await JSZip.loadAsync(zipData);

    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) return res.status(400).json({ error: 'Invalid package: missing manifest.json' });
    const manifest = JSON.parse(await manifestFile.async('text'));
    if (!manifest.version || !manifest.course) return res.status(400).json({ error: 'Invalid manifest format' });

    const c = manifest.course;

    // 1. Find or create category
    let categoryId = null;
    if (c.category_name) {
      const existing = await db.prepare('SELECT id FROM course_categories WHERE name=?').get(c.category_name);
      if (existing) {
        categoryId = existing.id;
      } else {
        const catResult = await db.prepare('INSERT INTO course_categories (name, created_by) VALUES (?, ?)').run(c.category_name, req.user.id);
        categoryId = catResult.lastInsertRowid;
      }
    }

    // 2. Create course
    const courseResult = await db.prepare(`
      INSERT INTO courses (title, description, category_id, pass_score, max_attempts, time_limit_minutes, is_public, settings_json, created_by, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `).run(
      c.title, c.description, categoryId,
      c.pass_score || 60, c.max_attempts || null, c.time_limit_minutes || null,
      c.is_public || 0, c.settings_json || null, req.user.id
    );
    const newCourseId = courseResult.lastInsertRowid;

    // ID mapping
    const lessonIdMap = {};  // orig_id → new_id
    const slideIdMap = {};   // orig_id → new_id
    const questionIdMap = {}; // orig_id → new_id

    // 3. Create lessons
    for (const l of (manifest.lessons || [])) {
      const lr = await db.prepare(`
        INSERT INTO course_lessons (course_id, title, sort_order, lesson_type) VALUES (?, ?, ?, ?)
      `).run(newCourseId, l.title, l.sort_order || 0, l.lesson_type || 'standard');
      lessonIdMap[l._orig_id] = lr.lastInsertRowid;
    }

    // 4. Extract files first (so slides can reference them)
    const courseDir = `course_${newCourseId}`;
    const targetDir = path.join(uploadDir, courseDir);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const filePathMap = {}; // old relative path → new relative path
    const filesFolder = zip.folder('files');
    if (filesFolder) {
      const fileEntries = [];
      filesFolder.forEach((relativePath, file) => {
        if (!file.dir) fileEntries.push({ relativePath, file });
      });
      for (const { relativePath, file } of fileEntries) {
        const content = await file.async('nodebuffer');
        const fileName = path.basename(relativePath);
        const newPath = path.join(targetDir, fileName);
        fs.writeFileSync(newPath, content);
        filePathMap[relativePath] = `${courseDir}/${fileName}`;
      }
      console.log(`[Import] Extracted ${fileEntries.length} files to ${targetDir}`);
    }

    // Helper: remap file paths in JSON string (handles both /api/training/files/ and /uploads/training/)
    const remapPaths = (jsonStr) => {
      if (!jsonStr) return jsonStr;
      let result = jsonStr;
      for (const [oldPath, newPath] of Object.entries(filePathMap)) {
        result = result.split(`/api/training/files/${oldPath}`).join(`/api/training/files/${newPath}`);
        result = result.split(`/uploads/training/${oldPath}`).join(`/api/training/files/${newPath}`);
      }
      return result;
    };

    // 5. Create slides
    for (const s of (manifest.slides || [])) {
      const newLessonId = lessonIdMap[s._orig_lesson_id];
      if (!newLessonId) continue;

      const contentJson = remapPaths(s.content_json);
      const audioUrl = s.audio_url ? remapPaths(s.audio_url) : null;

      const sr = await db.prepare(`
        INSERT INTO course_slides (lesson_id, slide_type, content_json, notes, audio_url, duration_seconds, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(newLessonId, s.slide_type || 'content', contentJson, s.notes, audioUrl, s.duration_seconds || null, s.sort_order || 0);
      slideIdMap[s._orig_id] = sr.lastInsertRowid;
    }

    // 6. Create quiz questions
    for (const q of (manifest.questions || [])) {
      const qr = await db.prepare(`
        INSERT INTO quiz_questions (course_id, question_type, question_json, answer_json, scoring_json, points, explanation, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(newCourseId, q.question_type, q.question_json, q.answer_json, q.scoring_json || null, q.points || 10, q.explanation || null, q.sort_order || 0);
      questionIdMap[q._orig_id] = qr.lastInsertRowid;
    }

    // 7. Create slide branches (remap IDs)
    for (const b of (manifest.slide_branches || [])) {
      const newSlideId = slideIdMap[b._orig_slide_id];
      if (!newSlideId) continue;
      await db.prepare(`
        INSERT INTO slide_branches (slide_id, option_text, option_index, target_slide_id, target_lesson_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(newSlideId, b.option_text, b.option_index || 0,
        b._orig_target_slide_id ? (slideIdMap[b._orig_target_slide_id] || null) : null,
        b._orig_target_lesson_id ? (lessonIdMap[b._orig_target_lesson_id] || null) : null
      );
    }

    // 8. Import translations
    const trans = manifest.translations || {};

    for (const ct of (trans.course || [])) {
      await db.prepare(`INSERT INTO course_translations (course_id, lang, title, description) VALUES (?, ?, ?, ?)`)
        .run(newCourseId, ct.lang, ct.title, ct.description);
    }

    for (const lt of (trans.lessons || [])) {
      const newLessonId = lessonIdMap[lt._orig_lesson_id];
      if (!newLessonId) continue;
      await db.prepare(`INSERT INTO lesson_translations (lesson_id, lang, title) VALUES (?, ?, ?)`)
        .run(newLessonId, lt.lang, lt.title);
    }

    for (const st of (trans.slides || [])) {
      const newSlideId = slideIdMap[st._orig_slide_id];
      if (!newSlideId) continue;
      const contentJson = remapPaths(st.content_json);
      const audioUrl = st.audio_url ? remapPaths(st.audio_url) : null;
      await db.prepare(`
        INSERT INTO slide_translations (slide_id, lang, content_json, notes, audio_url, image_overrides, regions_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(newSlideId, st.lang, contentJson, st.notes || null, audioUrl,
        st.image_overrides ? remapPaths(st.image_overrides) : null,
        st.regions_json || null);
    }

    for (const qt of (trans.questions || [])) {
      const newQid = questionIdMap[qt._orig_question_id];
      if (!newQid) continue;
      await db.prepare(`INSERT INTO quiz_translations (question_id, lang, question_json, explanation) VALUES (?, ?, ?, ?)`)
        .run(newQid, qt.lang, qt.question_json, qt.explanation || null);
    }

    // 9. Cover image
    if (c.cover_image) {
      const newCover = remapPaths(c.cover_image);
      await db.prepare('UPDATE courses SET cover_image=? WHERE id=?').run(newCover, newCourseId);
    }

    res.json({
      ok: true,
      course_id: newCourseId,
      stats: {
        lessons: Object.keys(lessonIdMap).length,
        slides: Object.keys(slideIdMap).length,
        questions: Object.keys(questionIdMap).length,
        files: Object.keys(filePathMap).length,
        translations: {
          course: (trans.course || []).length,
          lessons: (trans.lessons || []).length,
          slides: (trans.slides || []).length,
          questions: (trans.questions || []).length,
        }
      }
    });
  } catch (e) {
    console.error('[Training] import-package:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LESSON QUIZ RESULTS — 章節級測驗成績
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/training/lesson-quiz-result — 寫入章節測驗成績
router.post('/lesson-quiz-result', async (req, res) => {
  try {
    const { course_id, lesson_id, session_id, score, max_score, source } = req.body;
    if (!course_id || !lesson_id) return res.status(400).json({ error: 'Missing course_id or lesson_id' });

    const course = await db.prepare('SELECT pass_score FROM courses WHERE id=?').get(course_id);
    const passScore = course?.pass_score || 60;
    const percent = max_score > 0 ? (score / max_score) * 100 : 0;
    const passed = percent >= passScore ? 1 : 0;

    // Upsert: same user + course + lesson + session → update
    const sid = session_id || null;
    const existing = await db.prepare(
      sid
        ? 'SELECT id FROM lesson_quiz_results WHERE user_id=? AND course_id=? AND lesson_id=? AND session_id=?'
        : 'SELECT id FROM lesson_quiz_results WHERE user_id=? AND course_id=? AND lesson_id=? AND session_id IS NULL'
    ).get(...(sid ? [req.user.id, course_id, lesson_id, sid] : [req.user.id, course_id, lesson_id]));

    if (existing) {
      await db.prepare(`
        UPDATE lesson_quiz_results SET score=?, max_score=?, passed=?, completed_at=SYSTIMESTAMP
        WHERE id=?
      `).run(score, max_score, passed, existing.id);
    } else {
      await db.prepare(`
        INSERT INTO lesson_quiz_results (user_id, course_id, lesson_id, source, session_id, score, max_score, passed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(req.user.id, course_id, lesson_id, source || 'classroom', sid, score, max_score, passed);
    }

    res.json({ ok: true, passed: !!passed, score, max_score, percent: Math.round(percent) });
  } catch (e) {
    console.error('[Training] lesson-quiz-result:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/lesson-completion-report — 課程章節完成率報表 (admin)
router.get('/lesson-completion-report', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.effective_training_permission !== 'publish_edit')
      return res.status(403).json({ error: '權限不足' });

    const { course_id } = req.query;
    if (!course_id) return res.status(400).json({ error: 'Missing course_id' });

    const course = await db.prepare('SELECT id, title, pass_score, is_public FROM courses WHERE id=?').get(Number(course_id));
    if (!course) return res.status(404).json({ error: '課程不存在' });

    // 取所有 lesson
    const lessons = await db.prepare(
      'SELECT id, title, sort_order FROM course_lessons WHERE course_id=? ORDER BY sort_order'
    ).all(Number(course_id));

    // 需要完成的人：訓練專案指派 + 公開課程全員
    let targetUsers;
    if (course.is_public) {
      targetUsers = await db.prepare("SELECT id, name, employee_id FROM users WHERE status='active'").all();
    } else {
      targetUsers = await db.prepare(`
        SELECT DISTINCT u.id, u.name, u.employee_id
        FROM program_assignments pa
        JOIN program_courses pc ON pc.program_id = pa.program_id AND pc.course_id = pa.course_id
        JOIN users u ON u.id = pa.user_id
        WHERE pc.course_id = ? AND pa.status != 'exempted'
      `).all(Number(course_id));
    }

    // 每個 lesson 的最佳成績 (per user)
    const results = await db.prepare(`
      SELECT lesson_id, user_id, MAX(passed) AS best_passed,
             MAX(score) AS best_score, MAX(max_score) AS best_max_score,
             MAX(completed_at) AS last_completed
      FROM lesson_quiz_results
      WHERE course_id = ?
      GROUP BY lesson_id, user_id
    `).all(Number(course_id));

    // Build lookup: lesson_id → user_id → result
    const resultMap = {};
    for (const r of results) {
      if (!resultMap[r.lesson_id]) resultMap[r.lesson_id] = {};
      resultMap[r.lesson_id][r.user_id] = r;
    }

    const lessonReport = lessons.map(l => {
      const totalUsers = targetUsers.length;
      const lessonResults = resultMap[l.id] || {};
      let passedCount = 0;
      let failedCount = 0;
      let notAttempted = 0;
      const userDetails = targetUsers.map(u => {
        const r = lessonResults[u.id];
        let status = 'not_attempted';
        if (r) {
          if (r.best_passed) { status = 'passed'; passedCount++; }
          else { status = 'failed'; failedCount++; }
        } else {
          notAttempted++;
        }
        return {
          user_id: u.id, name: u.name, employee_id: u.employee_id,
          status,
          best_score: r?.best_score ?? null,
          max_score: r?.best_max_score ?? null,
          last_completed: r?.last_completed ?? null,
        };
      });
      return {
        lesson_id: l.id, title: l.title, sort_order: l.sort_order,
        total_users: totalUsers, passed: passedCount, failed: failedCount, not_attempted: notAttempted,
        pass_rate: totalUsers > 0 ? Math.round((passedCount / totalUsers) * 100) : 0,
        users: userDetails,
      };
    });

    res.json({
      course_id: course.id, course_title: course.title, pass_score: course.pass_score,
      is_public: !!course.is_public, total_target_users: targetUsers.length,
      lessons: lessonReport,
    });
  } catch (e) {
    console.error('[Training] lesson-completion-report:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/help-completion-report — 使用手冊章節完成率報表 (admin)
// Query: ?lang=&section_ids=id1,id2&dept_code=&profit_center_code=&org_section=&org_group=
router.get('/help-completion-report', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.effective_training_permission !== 'publish_edit')
      return res.status(403).json({ error: '權限不足' });

    const lang = req.query.lang || 'zh-TW';
    const filterSectionIds = req.query.section_ids ? String(req.query.section_ids).split(',').filter(Boolean) : null;
    const filterDept = req.query.dept_code || null;
    const filterProfitCenter = req.query.profit_center || null;
    const filterOrgSection = req.query.org_section || null;
    const filterOrgGroup = req.query.org_group_name || null;

    // 取所有有連結課程的 help sections
    const allSections = await db.prepare(`
      SELECT s.id, s.sort_order, s.linked_course_id, s.linked_lesson_id,
             COALESCE(t.title, tzh.title) AS title,
             c.pass_score, c.is_public
      FROM help_sections s
      LEFT JOIN help_translations t ON t.section_id = s.id AND t.lang = ?
      LEFT JOIN help_translations tzh ON tzh.section_id = s.id AND tzh.lang = 'zh-TW'
      LEFT JOIN courses c ON c.id = s.linked_course_id
      WHERE s.linked_course_id IS NOT NULL AND s.section_type = 'user'
      ORDER BY s.sort_order
    `).all(lang);

    if (!allSections.length) return res.json({ sections: [], users: [], summary: { total: 0, all_passed: 0, some_tested: 0, not_tested: 0 } });

    // 篩選的章節
    const sections = filterSectionIds ? allSections.filter(s => filterSectionIds.includes(s.id)) : allSections;

    // 取所有使用者（含組織資料）
    let userQuery = `SELECT id, name, employee_id, dept_code, dept_name, profit_center, profit_center_name, org_section, org_section_name, org_group_name FROM users WHERE status='active'`;
    const userParams = [];
    if (filterDept) { userQuery += ' AND dept_code=?'; userParams.push(filterDept); }
    if (filterProfitCenter) { userQuery += ' AND profit_center=?'; userParams.push(filterProfitCenter); }
    if (filterOrgSection) { userQuery += ' AND org_section=?'; userParams.push(filterOrgSection); }
    if (filterOrgGroup) { userQuery += ' AND org_group_name=?'; userParams.push(filterOrgGroup); }
    const allUsers = await db.prepare(userQuery).all(...userParams);

    // 每個 section 的成績查詢
    const sectionResults = {}; // section_id → { user_id → result }
    for (const sec of sections) {
      if (!sec.linked_lesson_id) { sectionResults[sec.id] = {}; continue; }
      const results = await db.prepare(`
        SELECT user_id, MAX(passed) AS best_passed,
               MAX(score) AS best_score, MAX(max_score) AS best_max_score,
               MAX(completed_at) AS last_completed
        FROM lesson_quiz_results
        WHERE course_id = ? AND lesson_id = ?
        GROUP BY user_id
      `).all(sec.linked_course_id, sec.linked_lesson_id);
      const map = {};
      for (const r of results) map[r.user_id] = r;
      sectionResults[sec.id] = map;
    }

    // 每個 section 的統計 (for section list)
    const sectionReport = allSections.map(sec => {
      const isSelected = !filterSectionIds || filterSectionIds.includes(sec.id);
      const results = sectionResults[sec.id] || {};
      let passed = 0, failed = 0, notAttempted = 0;
      for (const u of allUsers) {
        const r = results[u.id];
        if (r) { r.best_passed ? passed++ : failed++; }
        else notAttempted++;
      }
      return {
        section_id: sec.id, title: sec.title, sort_order: sec.sort_order,
        linked_course_id: sec.linked_course_id, linked_lesson_id: sec.linked_lesson_id,
        selected: isSelected,
        total_users: allUsers.length, passed, failed, not_attempted: notAttempted,
        pass_rate: allUsers.length > 0 ? Math.round((passed / allUsers.length) * 100) : 0,
      };
    });

    // User-centric view: 每個 user × 篩選的 sections
    const userRows = allUsers.map(u => {
      let passedCount = 0;
      const sectionStatuses = {};
      for (const sec of sections) {
        const r = (sectionResults[sec.id] || {})[u.id];
        if (r && r.best_passed) { sectionStatuses[sec.id] = 'passed'; passedCount++; }
        else if (r) { sectionStatuses[sec.id] = 'failed'; }
        else { sectionStatuses[sec.id] = 'not_attempted'; }
      }
      const tested = Object.values(sectionStatuses).some(s => s !== 'not_attempted');
      return {
        user_id: u.id, name: u.name, employee_id: u.employee_id,
        dept_code: u.dept_code, dept_name: u.dept_name,
        profit_center: u.profit_center, profit_center_name: u.profit_center_name,
        org_section: u.org_section, org_section_name: u.org_section_name,
        org_group_name: u.org_group_name,
        passed_count: passedCount, total_sections: sections.length,
        all_passed: passedCount === sections.length && sections.length > 0,
        tested,
        sections: sectionStatuses,
      };
    });

    // Summary stats
    const totalUsers = userRows.length;
    const allPassedCount = userRows.filter(u => u.all_passed).length;
    const someTestedCount = userRows.filter(u => u.tested).length;
    const notTestedCount = userRows.filter(u => !u.tested).length;

    // Org filter options (for dropdowns)
    const orgOptions = {
      depts: [...new Set(allUsers.filter(u => u.dept_code).map(u => JSON.stringify({ code: u.dept_code, name: u.dept_name })))].map(s => JSON.parse(s)),
      profit_centers: [...new Set(allUsers.filter(u => u.profit_center).map(u => JSON.stringify({ code: u.profit_center, name: u.profit_center_name })))].map(s => JSON.parse(s)),
      org_sections: [...new Set(allUsers.filter(u => u.org_section).map(u => JSON.stringify({ code: u.org_section, name: u.org_section_name })))].map(s => JSON.parse(s)),
      org_groups: [...new Set(allUsers.filter(u => u.org_group_name).map(u => u.org_group_name))].filter(Boolean),
    };

    res.json({
      sections: sectionReport,
      users: userRows,
      summary: { total: totalUsers, all_passed: allPassedCount, some_tested: someTestedCount, not_tested: notTestedCount },
      org_options: orgOptions,
    });
  } catch (e) {
    console.error('[Training] help-completion-report:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
