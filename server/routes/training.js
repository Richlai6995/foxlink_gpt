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
if (process.env.UPLOAD_DIR) {
  const envDir = path.resolve(process.env.UPLOAD_DIR);
  try { if (!fs.existsSync(envDir)) fs.mkdirSync(envDir, { recursive: true }); UPLOAD_ROOT = envDir; }
  catch { console.warn('[Training] UPLOAD_DIR not accessible, fallback to', localUploads); }
}
const uploadDir = path.join(UPLOAD_ROOT, 'training');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Serve training uploads as static files (fallback if main UPLOAD_DIR differs)
router.use('/files', express.static(uploadDir));

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

// All routes require auth
router.use(verifyToken);

// Resolve effective_training_permission for current user
router.use(async (req, res, next) => {
  if (req.user.role === 'admin') {
    req.user.effective_training_permission = 'edit';
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
      OR (grantee_type = 'dept' AND grantee_id = ? AND ? IS NOT NULL)
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
  return { access: false };
}

// Middleware: attach coursePermission to req
async function loadCoursePermission(req, res, next) {
  const courseId = req.params.id || req.params.courseId;
  if (!courseId) return res.status(400).json({ error: 'Missing course ID' });
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
    if (req.user.role !== 'admin' && req.user.effective_training_permission !== 'edit')
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
    if (req.user.role !== 'admin' && req.user.effective_training_permission !== 'edit')
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
    if (req.user.role !== 'admin' && req.user.effective_training_permission !== 'edit')
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
      sql += ` AND c.created_by = ?`;
      params.push(user.id);
    } else if (user.role !== 'admin') {
      // User can see: own + public published + shared
      sql += ` AND (
        c.created_by = ?
        OR (c.is_public = 1 AND c.status = 'published')
        OR EXISTS (
          SELECT 1 FROM course_access ca WHERE ca.course_id = c.id AND (
            (ca.grantee_type='user' AND ca.grantee_id=TO_CHAR(?))
            OR (ca.grantee_type='role' AND ca.grantee_id=?)
            OR (ca.grantee_type='dept' AND ca.grantee_id=? AND ? IS NOT NULL)
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

    const result = courses.map(c => ({
      ...c,
      my_progress: progressMap[c.id] || null
    }));

    res.json(result);
  } catch (e) {
    console.error('[Training] GET courses:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/training/courses — create
router.post('/courses', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.effective_training_permission !== 'edit')
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

    res.json({
      ...course,
      permission: req.coursePermission,
      lessons,
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
    const { title, description, category_id, pass_score, max_attempts, time_limit_minutes } = req.body;
    await db.prepare(`
      UPDATE courses SET title=?, description=?, category_id=?,
             pass_score=?, max_attempts=?, time_limit_minutes=?,
             updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(title, description || null, category_id || null,
           pass_score || 60, max_attempts || null, time_limit_minutes || null,
           req.courseId);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Training] PUT course:', e.message);
    res.status(500).json({ error: e.message });
  }
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

// POST /api/training/courses/:id/publish
router.post('/courses/:id/publish', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    await db.prepare(`UPDATE courses SET status='published', updated_at=SYSTIMESTAMP WHERE id=?`).run(req.courseId);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Training] publish:', e.message);
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
async function verifyLessonAccess(lessonId, user, requireEdit = false) {
  const lesson = await db.prepare('SELECT course_id FROM course_lessons WHERE id=?').get(lessonId);
  if (!lesson) return { error: '章節不存在', status: 404 };
  const perm = await canUserAccessCourse(lesson.course_id, user);
  if (!perm.access) return { error: '權限不足', status: 403 };
  if (requireEdit && !['owner', 'admin', 'develop'].includes(perm.permission))
    return { error: '權限不足', status: 403 };
  return { lesson, permission: perm.permission, courseId: lesson.course_id };
}

// GET /api/training/lessons/:lid/slides?lang=en
router.get('/lessons/:lid/slides', async (req, res) => {
  try {
    const check = await verifyLessonAccess(req.params.lid, req.user);
    if (check.error) return res.status(check.status).json({ error: check.error });

    const lang = req.query.lang;
    const slides = await db.prepare(
      'SELECT * FROM course_slides WHERE lesson_id=? ORDER BY sort_order, id'
    ).all(req.params.lid);

    // If non-zh-TW language requested, merge translations
    if (lang && lang !== 'zh-TW') {
      for (const slide of slides) {
        try {
          const trans = await db.prepare(
            'SELECT content_json, notes, audio_url FROM slide_translations WHERE slide_id=? AND lang=?'
          ).get(slide.id, lang);
          if (trans) {
            if (trans.content_json) slide.content_json = trans.content_json;
            if (trans.notes) slide.notes = trans.notes;
            if (trans.audio_url) slide.audio_url = trans.audio_url;
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

    const { slide_type, content_json, notes, duration_seconds, sort_order } = req.body;
    const contentStr = typeof content_json === 'string' ? content_json : JSON.stringify(content_json);

    await db.prepare(`
      UPDATE course_slides SET slide_type=?, content_json=?, notes=?,
             duration_seconds=?, sort_order=?, updated_at=SYSTIMESTAMP
      WHERE id=?
    `).run(slide_type, contentStr, notes || null, duration_seconds || null, sort_order, req.params.sid);
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

// POST /api/training/slides/:sid/tts — generate TTS
router.post('/slides/:sid/tts', async (req, res) => {
  try {
    const slide = await db.prepare('SELECT lesson_id, notes FROM course_slides WHERE id=?').get(req.params.sid);
    if (!slide) return res.status(404).json({ error: '投影片不存在' });
    const check = await verifyLessonAccess(slide.lesson_id, req.user, true);
    if (check.error) return res.status(check.status).json({ error: check.error });

    const text = req.body.text || slide.notes;
    if (!text) return res.status(400).json({ error: '沒有旁白文字' });

    // Call existing TTS skill endpoint internally
    const ttsModel = await db.prepare(
      `SELECT api_model, api_key_enc FROM llm_models WHERE model_role='tts' AND is_active=1
       ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
    ).get();
    if (!ttsModel) return res.status(500).json({ error: 'TTS 模型未設定' });

    const { decryptKey } = require('../utils/dbCrypto');
    const apiKey = decryptKey(ttsModel.api_key_enc);
    const language = req.body.language || 'zh-TW';
    const voice = req.body.voice || ttsModel.api_model || 'cmn-TW-Wavenet-A';

    const ttsUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
    const langMap = { 'zh-TW': 'cmn-TW', 'en': 'en-US', 'vi': 'vi-VN' };
    const langCode = langMap[language] || 'cmn-TW';

    const ttsRes = await fetch(ttsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: langCode, name: voice },
        audioConfig: { audioEncoding: 'MP3', speakingRate: req.body.speakingRate || 1.0, pitch: req.body.pitch || 0 }
      })
    });

    if (!ttsRes.ok) {
      const err = await ttsRes.text();
      return res.status(500).json({ error: `TTS API error: ${err}` });
    }

    const { audioContent } = await ttsRes.json();
    const audioBuffer = Buffer.from(audioContent, 'base64');
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

    const existing = await db.prepare(
      'SELECT id FROM user_course_progress WHERE user_id=? AND course_id=? AND lesson_id=?'
    ).get(req.user.id, req.courseId, lesson_id || null);

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
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Parse JSON from response
    let questions;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      questions = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
    } catch {
      return res.status(500).json({ error: 'AI 回覆格式錯誤', raw: text.slice(0, 500) });
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
    const systemPrompt = `你是 FOXLINK GPT 教育訓練平台的 AI 助教。
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
  try {
    const rows = await db.prepare(`
      SELECT tp.*, u.name AS creator_name
      FROM training_programs tp
      LEFT JOIN users u ON u.id = tp.created_by
      ORDER BY tp.created_at DESC
    `).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/programs', async (req, res) => {
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
  try {
    const program = await db.prepare('SELECT * FROM training_programs WHERE id=?').get(req.params.id);
    if (!program) return res.status(404).json({ error: '培訓專案不存在' });

    const targets = await db.prepare('SELECT * FROM program_targets WHERE program_id=?').all(req.params.id);
    const courses = await db.prepare(`
      SELECT pc.*, c.title AS course_title
      FROM program_courses pc JOIN courses c ON c.id = pc.course_id
      WHERE pc.program_id = ? ORDER BY pc.sort_order
    `).all(req.params.id);
    const assignmentStats = await db.prepare(`
      SELECT status, COUNT(*) AS cnt FROM program_assignments WHERE program_id=? GROUP BY status
    `).all(req.params.id);

    res.json({ ...program, targets, courses, assignment_stats: assignmentStats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/training/programs/:id/targets
router.post('/programs/:id/targets', async (req, res) => {
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
  try {
    const { course_id, is_required } = req.body;
    const max = await db.prepare('SELECT MAX(sort_order) AS mx FROM program_courses WHERE program_id=?').get(req.params.id);
    const result = await db.prepare(
      'INSERT INTO program_courses (program_id, course_id, sort_order, is_required) VALUES (?,?,?,?)'
    ).run(req.params.id, course_id, (max?.mx || 0) + 1, is_required ?? 1);
    res.json({ id: result.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/training/programs/:id/activate — expand assignments
router.post('/programs/:id/activate', async (req, res) => {
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

    // Resolve target users
    const targets = await db.prepare('SELECT * FROM program_targets WHERE program_id=?').all(req.params.id);
    const userIdSet = new Set();
    for (const t of targets) {
      let users = [];
      if (t.target_type === 'user') {
        users = [{ id: Number(t.target_id) }];
      } else if (t.target_type === 'dept') {
        users = await db.prepare('SELECT id FROM users WHERE dept_code=? AND status=?').all(t.target_id, 'active');
      } else if (t.target_type === 'role') {
        users = await db.prepare('SELECT id FROM users WHERE role=? AND status=?').all(t.target_id, 'active');
      }
      for (const u of users) userIdSet.add(u.id);
    }

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

router.post('/courses/:id/translate', loadCoursePermission, requirePermission('owner', 'admin', 'develop'), async (req, res) => {
  try {
    const { target_lang } = req.body;
    if (!target_lang || target_lang === 'zh-TW')
      return res.status(400).json({ error: 'target_lang must be en or vi' });

    // Translate course title & description
    const course = await db.prepare('SELECT title, description FROM courses WHERE id=?').get(req.courseId);
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const flashRow = await db.prepare(
      `SELECT api_model FROM llm_models WHERE model_role='chat' AND is_active=1 AND provider_type='gemini' ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
    ).get();
    const model = genAI.getGenerativeModel({ model: flashRow?.api_model || 'gemini-2.0-flash' });

    const langName = target_lang === 'en' ? 'English' : 'Vietnamese';
    const translateText = async (text) => {
      if (!text) return null;
      const r = await model.generateContent(
        `Translate the following Traditional Chinese text to ${langName}. Do not translate product names or technical terms. Return only the translation:\n\n${text}`
      );
      return r.response.text().trim();
    };

    // Course metadata
    const titleTrans = await translateText(course.title);
    const descTrans = await translateText(course.description);
    const existingCT = await db.prepare('SELECT id FROM course_translations WHERE course_id=? AND lang=?').get(req.courseId, target_lang);
    if (existingCT) {
      await db.prepare('UPDATE course_translations SET title=?, description=?, translated_at=SYSTIMESTAMP, is_auto=1 WHERE id=?')
        .run(titleTrans, descTrans, existingCT.id);
    } else {
      await db.prepare('INSERT INTO course_translations (course_id, lang, title, description, is_auto) VALUES (?,?,?,?,1)')
        .run(req.courseId, target_lang, titleTrans, descTrans);
    }

    // Translate lessons
    const lessons = await db.prepare('SELECT id, title FROM course_lessons WHERE course_id=?').all(req.courseId);
    for (const lesson of lessons) {
      const lt = await translateText(lesson.title);
      const existingLT = await db.prepare('SELECT id FROM lesson_translations WHERE lesson_id=? AND lang=?').get(lesson.id, target_lang);
      if (existingLT) {
        await db.prepare('UPDATE lesson_translations SET title=?, translated_at=SYSTIMESTAMP, is_auto=1 WHERE id=?').run(lt, existingLT.id);
      } else {
        await db.prepare('INSERT INTO lesson_translations (lesson_id, lang, title, is_auto) VALUES (?,?,?,1)').run(lesson.id, target_lang, lt);
      }

      // Translate slides
      const slides = await db.prepare('SELECT id, content_json, notes FROM course_slides WHERE lesson_id=?').all(lesson.id);
      for (const slide of slides) {
        let translatedContent = null;
        if (slide.content_json) {
          const transResult = await model.generateContent(
            `Translate the text values in this JSON from Traditional Chinese to ${langName}. Keep JSON structure, keys, and type fields unchanged. Do not translate product names. Return only valid JSON:\n\n${slide.content_json}`
          );
          translatedContent = transResult.response.text().trim();
          // Clean potential markdown wrapping
          translatedContent = translatedContent.replace(/^```json\s*/,'').replace(/```$/,'').trim();
        }
        const translatedNotes = await translateText(slide.notes);

        const existingST = await db.prepare('SELECT id FROM slide_translations WHERE slide_id=? AND lang=?').get(slide.id, target_lang);
        if (existingST) {
          await db.prepare('UPDATE slide_translations SET content_json=?, notes=?, translated_at=SYSTIMESTAMP, is_auto=1 WHERE id=?')
            .run(translatedContent, translatedNotes, existingST.id);
        } else {
          await db.prepare('INSERT INTO slide_translations (slide_id, lang, content_json, notes, is_auto) VALUES (?,?,?,?,1)')
            .run(slide.id, target_lang, translatedContent, translatedNotes);
        }
      }
    }

    // Translate quiz
    const questions = await db.prepare('SELECT id, question_json, explanation FROM quiz_questions WHERE course_id=?').all(req.courseId);
    for (const q of questions) {
      const transQ = await model.generateContent(
        `Translate the text values in this JSON from Traditional Chinese to ${langName}. Keep JSON structure unchanged. Return only valid JSON:\n\n${q.question_json}`
      );
      let translatedQ = transQ.response.text().trim().replace(/^```json\s*/,'').replace(/```$/,'').trim();
      const translatedExp = await translateText(q.explanation);

      const existingQT = await db.prepare('SELECT id FROM quiz_translations WHERE question_id=? AND lang=?').get(q.id, target_lang);
      if (existingQT) {
        await db.prepare('UPDATE quiz_translations SET question_json=?, explanation=?, translated_at=SYSTIMESTAMP, is_auto=1 WHERE id=?')
          .run(translatedQ, translatedExp, existingQT.id);
      } else {
        await db.prepare('INSERT INTO quiz_translations (question_id, lang, question_json, explanation, is_auto) VALUES (?,?,?,?,1)')
          .run(q.id, target_lang, translatedQ, translatedExp);
      }
    }

    res.json({ ok: true, translated: { lessons: lessons.length, questions: questions.length } });
  } catch (e) {
    console.error('[Training] translate:', e.message);
    res.status(500).json({ error: e.message });
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
    const model = genAI.getGenerativeModel({ model: flashRow?.api_model || 'gemini-2.0-flash' });

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

    const result = await model.generateContent([
      { inlineData: { mimeType: 'image/png', data: imageBase64 } },
      { text: prompt }
    ]);
    const text = result.response.text();

    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
    } catch {
      return res.status(500).json({ error: 'AI 回覆格式錯誤', raw: text.slice(0, 500) });
    }

    // Clean up uploaded temp file
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}

    res.json(parsed);
  } catch (e) {
    console.error('[Training] AI analyze screenshot:', e.message);
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
    const model = genAI.getGenerativeModel({ model: flashRow?.api_model || 'gemini-2.0-flash' });

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

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    let steps;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      steps = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
    } catch {
      return res.status(500).json({ error: 'AI 回覆格式錯誤', raw: text.slice(0, 500) });
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
    const model = genAI.getGenerativeModel({ model: flashRow?.api_model || 'gemini-2.0-flash' });

    const results = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
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
        results.push({ index: i, filename: file.originalname, ...parsed });
      } catch (err) {
        results.push({ index: i, filename: file.originalname, error: err.message, regions: [] });
      }

      // Cleanup
      try { fs.unlinkSync(file.path); } catch {}
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
router.post('/recording/:sessionId/step', upload.single('screenshot'), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { step_number, action_type, screenshot_base64, element_info, viewport, page_url, page_title } = req.body;

    // Save screenshot
    let screenshotUrl = null;
    if (req.file) {
      screenshotUrl = `/api/training/files/${req.file.filename}`;
    } else if (screenshot_base64) {
      const base64Data = screenshot_base64.replace(/^data:image\/\w+;base64,/, '');
      const filename = `rec_${sessionId}_${step_number}_${Date.now()}.png`;
      const dir = path.join(uploadDir, 'recordings');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), Buffer.from(base64Data, 'base64'));
      screenshotUrl = `/api/training/files/recordings/${filename}`;
    }

    const elementJson = typeof element_info === 'string' ? element_info : JSON.stringify(element_info || null);
    const viewportJson = typeof viewport === 'string' ? viewport : JSON.stringify(viewport || null);

    const result = await db.prepare(`
      INSERT INTO recording_steps (session_id, step_number, action_type, screenshot_url,
                                    element_json, viewport_json, page_url, page_title)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, step_number || 0, action_type || 'screenshot',
           screenshotUrl, elementJson, viewportJson, page_url || null, page_title || null);

    // Update session step count
    await db.prepare('UPDATE recording_sessions SET steps_count=steps_count+1 WHERE id=?').run(sessionId);

    res.json({ step_id: result.lastInsertRowid, screenshot_url: screenshotUrl });
  } catch (e) {
    console.error('[Training] recording step:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/training/recording/:sessionId — get session + all steps
router.get('/recording/:sessionId', async (req, res) => {
  try {
    const session = await db.prepare('SELECT * FROM recording_sessions WHERE id=?').get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: '錄製工作階段不存在' });
    const steps = await db.prepare(
      'SELECT * FROM recording_steps WHERE session_id=? ORDER BY step_number'
    ).all(req.params.sessionId);
    res.json({ ...session, steps });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
router.post('/recording/:sessionId/analyze-step/:stepId', async (req, res) => {
  try {
    const step = await db.prepare(
      'SELECT * FROM recording_steps WHERE id=? AND session_id=?'
    ).get(req.params.stepId, req.params.sessionId);
    if (!step) return res.status(404).json({ error: '步驟不存在' });
    if (!step.screenshot_url) return res.json({ ok: false, error: '無截圖' });

    const filePath = path.join(uploadDir, step.screenshot_url.replace('/api/training/files/', ''));
    if (!fs.existsSync(filePath)) return res.json({ ok: false, error: '截圖檔案不存在' });

    const imageBase64 = fs.readFileSync(filePath).toString('base64');
    const elementInfo = step.element_json ? (() => { try { return JSON.parse(step.element_json) } catch { return null } })() : null;
    const clickInfo = elementInfo?.rect
      ? `使用者點擊了 (${elementInfo.rect.x}, ${elementInfo.rect.y}) 的 ${elementInfo.tag || ''} 元素「${elementInfo.text || ''}」。`
      : '';

    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const flashRow = await db.prepare(
      `SELECT api_model FROM llm_models WHERE model_role='chat' AND is_active=1 AND provider_type='gemini' ORDER BY sort_order FETCH FIRST 1 ROWS ONLY`
    ).get();
    const model = genAI.getGenerativeModel({ model: flashRow?.api_model || 'gemini-2.0-flash' });

    const prompt = `分析這張系統操作截圖（步驟 ${step.step_number}）。${clickInfo}
識別所有可互動 UI 元素，回傳 JSON：
{ "regions": [{ "type": "...", "label": "...", "coords": { "x": 0, "y": 0, "w": 0, "h": 0 }, "is_primary": false }],
  "instruction": "操作說明", "narration": "旁白文字",
  "sensitive_areas": [{ "type": "password", "coords": { "x": 0, "y": 0, "w": 0, "h": 0 } }] }
只回傳 JSON。`;

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

    res.json({ ok: true, step_id: step.id, ...parsed });
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
    const model = genAI.getGenerativeModel({ model: flashRow?.api_model || 'gemini-2.0-flash' });

    let analyzed = 0;
    for (const step of steps) {
      if (!step.screenshot_url) continue;

      // Read screenshot
      const filePath = path.join(uploadDir, step.screenshot_url.replace('/api/training/files/', ''));
      if (!fs.existsSync(filePath)) continue;
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

    // Create slides from steps — every step gets instruction text + screenshot
    let slideCount = 0;
    for (const step of steps) {
      if (!step.screenshot_url) continue;

      const regions = step.ai_regions_json ? (() => { try { return JSON.parse(step.ai_regions_json) } catch { return [] } })() : [];
      const instruction = step.ai_instruction || step.final_instruction || `步驟 ${step.step_number}`;
      const narration = step.ai_narration || instruction;

      // Build hotspot regions with label, type, and feedback
      const hotspotRegions = regions.map((r, i) => ({
        id: `r${i + 1}`,
        shape: 'rect',
        coords: r.coords,
        correct: r.is_primary || false,
        label: r.label || `元素 ${i + 1}`,
        type: r.type || '',
        feedback: r.is_primary
          ? `正確！${r.label ? '這就是「' + r.label + '」。' : ''}`
          : `這是「${r.label || '其他元素'}」(${r.type || ''})，請找到正確的操作位置。`
      }));

      const hasPrimary = regions.some(r => r.is_primary);
      const slideType = hasPrimary ? 'hotspot' : 'content';

      // Build content blocks:
      // 1. Text instruction (title + description)
      // 2. Hotspot or Image
      const blocks = [];

      // Always add instruction text first
      blocks.push({
        type: 'text',
        content: `## 步驟 ${step.step_number}\n\n${instruction}`
      });

      if (slideType === 'hotspot') {
        blocks.push({
          type: 'hotspot',
          image: step.screenshot_url,
          instruction: instruction,
          regions: hotspotRegions,
          max_attempts: 3,
          show_hint_after: 2
        });
      } else {
        blocks.push({
          type: 'image',
          src: step.screenshot_url,
          alt: instruction
        });
      }

      // Add callout if there are tips from AI
      if (regions.length > 0 && !hasPrimary) {
        const elementList = regions.map(r => `**${r.label}** (${r.type})`).join('、');
        blocks.push({
          type: 'callout',
          variant: 'tip',
          content: `此畫面包含以下操作元素：${elementList}`
        });
      }

      const contentJson = JSON.stringify(blocks);

      await db.prepare(`
        INSERT INTO course_slides (lesson_id, sort_order, slide_type, content_json, notes)
        VALUES (?, ?, ?, ?, ?)
      `).run(lessonId, step.step_number, slideType, contentJson, narration);
      slideCount++;
    }

    res.json({ ok: true, course_id: courseId, lesson_id: lessonId, slides_created: slideCount });
  } catch (e) {
    console.error('[Training] generate from recording:', e.message);
    res.status(500).json({ error: e.message });
  }
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

module.exports = router;
