// programScoreCalculator.js
// 共用的訓練專案成績計算邏輯 — 學員端 my-scores、admin 報表、Excel 匯出共用同一套
//
// 設計重點:
// 1. computeUserCourseScore(...) 是 pure function,完全對齊學員端原本算法
//    (見 server/routes/training.js 4178-4308 那段抽出來的)
// 2. loadProgramScoringCtx() 一次撈完所有 program / course / lesson / slide 結構資料
//    (per-program,不 per-user — 1378 人共用同一份 context)
// 3. loadUsersInteractionData() 批次撈一群 user 的 browse / best / last / attempts
//    用 IN list + GROUP BY + window function,把 ~80,000 round-trip 壓到 ~5 個 query
//
// ⚠️ 不要再寫一套算法 — admin 報表跟學員端必須完全一致

const ORACLE_IN_CHUNK = 800; // Oracle IN list 上限 1000,留 buffer

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function safeJsonParse(s, fallback = null) {
  if (s == null) return fallback;
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return fallback; }
}

/**
 * 載入專案層級的靜態資料(課程設定、章節、slide 數、互動 flag)
 * 1378 個學員共用這份 context — 只查 5~6 個 query
 */
async function loadProgramScoringCtx(db, progId) {
  const program = await db.prepare(
    'SELECT id, title, program_pass_score FROM training_programs WHERE id=?'
  ).get(progId);
  if (!program) return null;

  // 1) program_courses + course settings_json(用來 fallback only_count_mandatory)
  const coursesRaw = await db.prepare(`
    SELECT pc.course_id, pc.exam_config, pc.lesson_ids, pc.is_required, pc.sort_order,
           c.title AS course_title, c.pass_score AS course_pass_score,
           c.settings_json AS course_settings_json
    FROM program_courses pc
    JOIN courses c ON c.id = pc.course_id
    WHERE pc.program_id = ?
    ORDER BY pc.sort_order
  `).all(progId);

  if (coursesRaw.length === 0) {
    return { program, courses: [], lessonsByCourse: new Map(), totalSlideByLesson: new Map(), hasInteractiveByLesson: new Map() };
  }

  const courses = coursesRaw.map(pc => {
    const examConfig = safeJsonParse(pc.exam_config, {}) || {};
    // Fallback:program 沒設 only_count_mandatory 就繼承 course settings.exam
    if (examConfig.only_count_mandatory === undefined && pc.course_settings_json) {
      const cs = safeJsonParse(pc.course_settings_json, null);
      if (cs?.exam?.only_count_mandatory !== undefined) {
        examConfig.only_count_mandatory = !!cs.exam.only_count_mandatory;
      }
    }
    return {
      course_id: pc.course_id,
      course_title: pc.course_title,
      is_required: pc.is_required,
      sort_order: pc.sort_order,
      lesson_ids: safeJsonParse(pc.lesson_ids, null),
      exam_config: examConfig,
      course_pass_score: pc.course_pass_score,
      course_total_score: examConfig.total_score || 100,
      course_pass_score_effective: examConfig.pass_score || pc.course_pass_score || 60,
      max_attempts: examConfig.max_attempts || 0,
    };
  });

  const courseIds = courses.map(c => c.course_id);

  // 2) 所有 lesson(過濾 lesson_ids 留到計算時做)
  const allLessons = [];
  for (const ids of chunk(courseIds, ORACLE_IN_CHUNK)) {
    const ph = ids.map(() => '?').join(',');
    const rows = await db.prepare(
      `SELECT id, course_id, title, is_mandatory, score_weight, sort_order
       FROM course_lessons WHERE course_id IN (${ph}) ORDER BY course_id, sort_order, id`
    ).all(...ids);
    allLessons.push(...rows);
  }
  const lessonsByCourse = new Map();
  for (const l of allLessons) {
    if (!lessonsByCourse.has(l.course_id)) lessonsByCourse.set(l.course_id, []);
    lessonsByCourse.get(l.course_id).push(l);
  }

  // 3) 每個 lesson 的 slide 總數 + 互動 slide_id 清單
  //    為了「必修全部做完才判定及格」,需要知道 mandatory lesson 裡每個互動 slide 的 id,
  //    才能比對 user 是否每題都答過(不只 count 對得上,要 set ⊇ mandatory set)
  const lessonIds = allLessons.map(l => l.id);
  const totalSlideByLesson = new Map();
  const interactiveSlideIdsByLesson = new Map(); // lesson_id → Set<slide_id>
  const hasInteractiveByLesson = new Map();      // 保留 boolean 版本給舊呼叫
  for (const ids of chunk(lessonIds, ORACLE_IN_CHUNK)) {
    if (ids.length === 0) continue;
    const ph = ids.map(() => '?').join(',');
    // 撈所有 slide(含 content_json LIKE 判斷互動 type)
    const rows = await db.prepare(`
      SELECT id, lesson_id,
             CASE WHEN content_json LIKE '%"type":"hotspot"%'
                   OR content_json LIKE '%"type":"dragdrop"%'
                   OR content_json LIKE '%"type":"quiz_inline"%'
                  THEN 1 ELSE 0 END AS is_interactive
      FROM course_slides
      WHERE lesson_id IN (${ph})
    `).all(...ids);
    for (const r of rows) {
      const lid = Number(r.lesson_id);
      const sid = Number(r.id);
      totalSlideByLesson.set(lid, (totalSlideByLesson.get(lid) || 0) + 1);
      if (Number(r.is_interactive) === 1) {
        if (!interactiveSlideIdsByLesson.has(lid)) interactiveSlideIdsByLesson.set(lid, new Set());
        interactiveSlideIdsByLesson.get(lid).add(sid);
        hasInteractiveByLesson.set(lid, true);
      }
    }
  }
  // 沒查到的 lesson 預設 0
  for (const lid of lessonIds) {
    if (!totalSlideByLesson.has(lid)) totalSlideByLesson.set(lid, 0);
    if (!hasInteractiveByLesson.has(lid)) hasInteractiveByLesson.set(lid, false);
    if (!interactiveSlideIdsByLesson.has(lid)) interactiveSlideIdsByLesson.set(lid, new Set());
  }

  return {
    program, courses, lessonsByCourse,
    totalSlideByLesson, hasInteractiveByLesson, interactiveSlideIdsByLesson,
  };
}

/**
 * 批次撈一群 user 的所有互動資料(browse / best session / last session / attempts)
 * 回傳 Map 結構,供 computeUserCourseScore 取用
 */
async function loadUsersInteractionData(db, progId, userIds, courseIds, lessonIds) {
  // browseViewByUserLesson: Map<`${user_id}|${lesson_id}`, viewedCount>
  const browseViewByUserLesson = new Map();
  // bestByUserCourse: Map<`${user_id}|${course_id}`, { session_score, session_max, session_at, session_id }>
  const bestByUserCourse = new Map();
  // lastByUserCourse: Map<`${user_id}|${course_id}`, { session_score, session_max, session_at, session_id }>
  const lastByUserCourse = new Map();
  // attemptsByUserCourse: Map<`${user_id}|${course_id}`, count>
  const attemptsByUserCourse = new Map();
  // answeredSlidesByUserCourse: Map<`${user_id}|${course_id}`, Set<slide_id>>
  // — 用來判定「必修題目是否全部做完」(across ALL test sessions,只要 user 曾經
  //   答過該題就算)。比 best session 寬鬆,符合「做完後再判及格」的語意
  const answeredSlidesByUserCourse = new Map();

  if (userIds.length === 0 || courseIds.length === 0) {
    return {
      browseViewByUserLesson, bestByUserCourse, lastByUserCourse,
      attemptsByUserCourse, answeredSlidesByUserCourse,
    };
  }

  for (const userChunk of chunk(userIds, ORACLE_IN_CHUNK)) {
    const userPh = userChunk.map(() => '?').join(',');

    // (A) browse views — 按 lesson 計數
    if (lessonIds.length > 0) {
      for (const lessonChunk of chunk(lessonIds, ORACLE_IN_CHUNK)) {
        const lessonPh = lessonChunk.map(() => '?').join(',');
        const rows = await db.prepare(`
          SELECT user_id, lesson_id, COUNT(*) AS viewed
          FROM user_slide_views
          WHERE program_id = ?
            AND user_id IN (${userPh})
            AND lesson_id IN (${lessonPh})
          GROUP BY user_id, lesson_id
        `).all(progId, ...userChunk, ...lessonChunk);
        for (const r of rows) {
          browseViewByUserLesson.set(`${r.user_id}|${r.lesson_id}`, Number(r.viewed) || 0);
        }
      }
    }

    // (B) best session per (user, course) — 用 window function 一次撈完
    for (const courseChunk of chunk(courseIds, ORACLE_IN_CHUNK)) {
      const coursePh = courseChunk.map(() => '?').join(',');
      const bestRows = await db.prepare(`
        SELECT user_id, course_id, session_id, session_score, session_max, session_at
        FROM (
          SELECT user_id, course_id, session_id,
                 SUM(COALESCE(weighted_score, score)) AS session_score,
                 SUM(COALESCE(weighted_max, max_score)) AS session_max,
                 MAX(created_at) AS session_at,
                 ROW_NUMBER() OVER (
                   PARTITION BY user_id, course_id
                   ORDER BY SUM(COALESCE(weighted_score, score)) DESC,
                            MAX(created_at) DESC
                 ) AS rn
          FROM interaction_results
          WHERE session_id IS NOT NULL AND player_mode = 'test'
            AND user_id IN (${userPh})
            AND course_id IN (${coursePh})
          GROUP BY user_id, course_id, session_id
        )
        WHERE rn = 1
      `).all(...userChunk, ...courseChunk);
      for (const r of bestRows) {
        bestByUserCourse.set(`${r.user_id}|${r.course_id}`, {
          session_id: r.session_id,
          session_score: Number(r.session_score) || 0,
          session_max: Number(r.session_max) || 0,
          session_at: r.session_at || null,
        });
      }

      // (C) last session per (user, course)
      const lastRows = await db.prepare(`
        SELECT user_id, course_id, session_id, session_score, session_max, session_at
        FROM (
          SELECT user_id, course_id, session_id,
                 SUM(COALESCE(weighted_score, score)) AS session_score,
                 SUM(COALESCE(weighted_max, max_score)) AS session_max,
                 MAX(created_at) AS session_at,
                 ROW_NUMBER() OVER (
                   PARTITION BY user_id, course_id
                   ORDER BY MAX(created_at) DESC
                 ) AS rn
          FROM interaction_results
          WHERE session_id IS NOT NULL AND player_mode = 'test'
            AND user_id IN (${userPh})
            AND course_id IN (${coursePh})
          GROUP BY user_id, course_id, session_id
        )
        WHERE rn = 1
      `).all(...userChunk, ...courseChunk);
      for (const r of lastRows) {
        lastByUserCourse.set(`${r.user_id}|${r.course_id}`, {
          session_id: r.session_id,
          session_score: Number(r.session_score) || 0,
          session_max: Number(r.session_max) || 0,
          session_at: r.session_at || null,
        });
      }

      // (D) attempts count — DISTINCT session_id per (user, course)
      const attRows = await db.prepare(`
        SELECT user_id, course_id, COUNT(DISTINCT session_id) AS cnt
        FROM interaction_results
        WHERE session_id IS NOT NULL AND player_mode = 'test'
          AND user_id IN (${userPh})
          AND course_id IN (${coursePh})
        GROUP BY user_id, course_id
      `).all(...userChunk, ...courseChunk);
      for (const r of attRows) {
        attemptsByUserCourse.set(`${r.user_id}|${r.course_id}`, Number(r.cnt) || 0);
      }

      // (E) 所有曾經答過的 slide_id per (user, course) — 跨所有 test sessions
      //     拿來判定「必修互動題目是否全部做完」(set ⊇ mandatory interactive slides)
      const ansRows = await db.prepare(`
        SELECT user_id, course_id, slide_id
        FROM interaction_results
        WHERE session_id IS NOT NULL AND player_mode = 'test'
          AND user_id IN (${userPh})
          AND course_id IN (${coursePh})
        GROUP BY user_id, course_id, slide_id
      `).all(...userChunk, ...courseChunk);
      for (const r of ansRows) {
        const key = `${r.user_id}|${r.course_id}`;
        if (!answeredSlidesByUserCourse.has(key)) answeredSlidesByUserCourse.set(key, new Set());
        answeredSlidesByUserCourse.get(key).add(Number(r.slide_id));
      }
    }
  }

  return {
    browseViewByUserLesson, bestByUserCourse, lastByUserCourse,
    attemptsByUserCourse, answeredSlidesByUserCourse,
  };
}

/**
 * 計算單一 user 在單一 course 的加權分數 — pure function
 *
 * 算法完全對齊學員端 my-scores(server/routes/training.js 4178-4308)
 *
 * 關鍵 fix:
 * - bestMax/lastMax 是「該次 session 出題的 max」,但 weightedScore 是用
 *   interactiveLessonsWeight(課程設定的互動章節權重總和)當分母,不再用 bestMax
 * - 處理 only_count_mandatory:非必修章節的 effectiveWeight = 0
 * - 處理 lesson_mandatory override + lesson_weights override
 *
 * 回傳 { weighted, lastWeighted, attempts, lastAt, browseTotal, browseViewed,
 *        coursePassed, courseTotalScore, coursePassScore, bestScore, bestMax,
 *        lastScoreRaw, lastMaxRaw }
 */
function computeUserCourseScore({
  userId,
  course,                       // 從 ctx.courses 來的單一 course 結構
  lessonsByCourse,              // ctx.lessonsByCourse
  totalSlideByLesson,           // ctx.totalSlideByLesson
  hasInteractiveByLesson,       // ctx.hasInteractiveByLesson
  interactiveSlideIdsByLesson,  // ctx.interactiveSlideIdsByLesson — 必修完成度比對用
  browseViewByUserLesson,       // from loadUsersInteractionData
  bestByUserCourse,             // from loadUsersInteractionData
  lastByUserCourse,             // from loadUsersInteractionData
  attemptsByUserCourse,         // from loadUsersInteractionData
  answeredSlidesByUserCourse,   // from loadUsersInteractionData — 必修完成度比對用
}) {
  const examConfig = course.exam_config || {};
  const courseTotalScore = course.course_total_score;
  const coursePassScore = course.course_pass_score_effective;
  const lessonWeights = examConfig.lesson_weights || {};
  const lessonMandatoryOverride = examConfig.lesson_mandatory || {};
  const onlyCountMandatory = !!examConfig.only_count_mandatory;

  let lessons = lessonsByCourse.get(course.course_id) || [];
  if (course.lesson_ids && course.lesson_ids.length > 0) {
    const allow = new Set(course.lesson_ids.map(Number));
    lessons = lessons.filter(l => allow.has(Number(l.id)));
  }

  let browseTotal = 0;
  let browseViewed = 0;
  let browseOnlyScore = 0;
  let interactiveLessonsWeight = 0;
  let totalEffectiveWeight = 0;

  // 必修完成度追蹤
  let mandatoryBrowseTotal = 0;
  let mandatoryBrowseViewed = 0;
  const mandatoryInteractiveSlideIds = new Set();
  let hasAnyMandatoryLesson = false;

  for (const l of lessons) {
    const total = totalSlideByLesson.get(Number(l.id)) || 0;
    const viewedRaw = browseViewByUserLesson.get(`${userId}|${l.id}`) || 0;
    const viewed = Math.min(viewedRaw, total);
    browseTotal += total;
    browseViewed += viewed;

    const hasInteractive = hasInteractiveByLesson.get(Number(l.id)) || false;

    // mandatory:program 層的 lesson_mandatory override 優先,否則用 course_lessons.is_mandatory
    const ov = lessonMandatoryOverride[`lesson_${l.id}`];
    const mandatory = (ov === 0 || ov === 1) ? ov === 1 : ((l.is_mandatory ?? 1) === 1);

    if (mandatory) {
      hasAnyMandatoryLesson = true;
      mandatoryBrowseTotal += total;
      mandatoryBrowseViewed += viewed;
      if (hasInteractive && interactiveSlideIdsByLesson) {
        const ids = interactiveSlideIdsByLesson.get(Number(l.id));
        if (ids) for (const sid of ids) mandatoryInteractiveSlideIds.add(sid);
      }
    }

    // weight:program 層 lesson_weights override 優先,否則用 course_lessons.score_weight
    const lwKey = `lesson_${l.id}`;
    const baseWeight = lessonWeights[lwKey] != null
      ? Number(lessonWeights[lwKey])
      : (l.score_weight ?? 0);
    const effectiveWeight = (onlyCountMandatory && !mandatory) ? 0 : baseWeight;

    totalEffectiveWeight += effectiveWeight;
    if (hasInteractive) {
      interactiveLessonsWeight += effectiveWeight;
    } else if (effectiveWeight > 0 && total > 0) {
      browseOnlyScore += Math.round((viewed / total) * effectiveWeight);
    }
  }

  const bestKey = `${userId}|${course.course_id}`;
  const best = bestByUserCourse.get(bestKey) || null;
  const last = lastByUserCourse.get(bestKey) || null;
  const attempts = attemptsByUserCourse.get(bestKey) || 0;

  const bestScore = best?.session_score || 0;
  const bestMax = best?.session_max || 0;
  const examRatio = bestMax > 0 ? bestScore / bestMax : 0;

  let weighted;
  if (totalEffectiveWeight > 0) {
    const interactiveEarned = examRatio * interactiveLessonsWeight;
    const earnedTotal = browseOnlyScore + interactiveEarned;
    weighted = Math.round((earnedTotal / totalEffectiveWeight) * courseTotalScore);
  } else {
    weighted = Math.round(examRatio * courseTotalScore);
  }

  // last attempt 的加權分(同公式但用 lastRatio + 同一個 browseOnlyScore)
  const lastScoreRaw = last?.session_score || 0;
  const lastMaxRaw = last?.session_max || 0;
  const lastRatio = lastMaxRaw > 0 ? lastScoreRaw / lastMaxRaw : 0;
  let lastWeighted = 0;
  if (attempts > 0) {
    if (totalEffectiveWeight > 0) {
      const interactiveEarnedLast = lastRatio * interactiveLessonsWeight;
      const earnedTotalLast = browseOnlyScore + interactiveEarnedLast;
      lastWeighted = Math.round((earnedTotalLast / totalEffectiveWeight) * courseTotalScore);
    } else {
      lastWeighted = Math.round(lastRatio * courseTotalScore);
    }
  }

  const courseScorePct = courseTotalScore > 0 ? (weighted / courseTotalScore) * 100 : 0;

  // ── 必修完成度判定 ──────────────────────────────────────────────
  // 規則(2026-05-26):
  // - 沒任何必修章節 → mandatoryComplete=true(沒東西要完成)
  // - 有必修章節 →
  //     1) 必修章節的所有 slide 都瀏覽過(browseViewed >= browseTotal)
  //     2) 必修章節裡的所有互動 slide 都至少答過一次(across all sessions)
  //   兩個都要過才算「必修做完」
  // - coursePassed = mandatoryComplete && score >= passScore
  //   做完才有資格被判定及格,沒做完不管分數多高都不算過
  const answeredSlides = answeredSlidesByUserCourse?.get(`${userId}|${course.course_id}`) || new Set();
  const mandatoryBrowseComplete = !hasAnyMandatoryLesson
    || mandatoryBrowseTotal === 0
    || mandatoryBrowseViewed >= mandatoryBrowseTotal;

  let mandatoryExamMissing = 0;
  for (const sid of mandatoryInteractiveSlideIds) {
    if (!answeredSlides.has(sid)) mandatoryExamMissing++;
  }
  const mandatoryExamComplete = mandatoryExamMissing === 0;
  const mandatoryComplete = mandatoryBrowseComplete && mandatoryExamComplete;

  const coursePassed = mandatoryComplete && courseScorePct >= coursePassScore;

  return {
    weighted,
    lastWeighted,
    attempts,
    lastAt: last?.session_at || null,
    browseTotal,
    browseViewed,
    coursePassed,
    courseTotalScore,
    coursePassScore,
    bestScore,
    bestMax,
    lastScoreRaw,
    lastMaxRaw,
    onlyCountMandatory,
    // 必修完成度(給前端顯示「缺 N 題」/「未瀏覽完」)
    has_mandatory: hasAnyMandatoryLesson,
    mandatory_browse_total: mandatoryBrowseTotal,
    mandatory_browse_viewed: mandatoryBrowseViewed,
    mandatory_browse_complete: mandatoryBrowseComplete,
    mandatory_exam_total: mandatoryInteractiveSlideIds.size,
    mandatory_exam_missing: mandatoryExamMissing,
    mandatory_exam_complete: mandatoryExamComplete,
    mandatory_complete: mandatoryComplete,
  };
}

/**
 * 算整個 program 的 user 總成績 — 把所有 course 的 weighted 累加,套 program_pass_score
 */
function computeUserProgramScore(userId, ctx, interactionData) {
  let programTotal = 0;
  let programMax = 0;
  let programLastTotal = 0;
  let programLastMax = 0;
  let programLastAt = null;
  let programAttempts = 0;
  let allRequiredPassed = true;
  let allRequiredMandatoryComplete = true;
  let anyBrowseViewed = 0;
  let browseTotal = 0;
  let programMandatoryExamTotal = 0;
  let programMandatoryExamMissing = 0;
  const courseDetails = [];

  for (const course of ctx.courses) {
    const r = computeUserCourseScore({
      userId,
      course,
      lessonsByCourse: ctx.lessonsByCourse,
      totalSlideByLesson: ctx.totalSlideByLesson,
      hasInteractiveByLesson: ctx.hasInteractiveByLesson,
      interactiveSlideIdsByLesson: ctx.interactiveSlideIdsByLesson,
      ...interactionData,
    });

    programTotal += r.weighted;
    programMax += r.courseTotalScore;
    anyBrowseViewed += r.browseViewed;
    browseTotal += r.browseTotal;

    if (course.is_required) {
      if (!r.coursePassed) allRequiredPassed = false;
      if (!r.mandatory_complete) allRequiredMandatoryComplete = false;
      programMandatoryExamTotal += r.mandatory_exam_total;
      programMandatoryExamMissing += r.mandatory_exam_missing;
    }

    if (r.attempts > 0) {
      programLastTotal += r.lastWeighted;
      programLastMax += r.courseTotalScore;
      programAttempts += r.attempts;
      if (r.lastAt && (!programLastAt || new Date(r.lastAt) > new Date(programLastAt))) {
        programLastAt = r.lastAt;
      }
    }

    courseDetails.push({
      course_id: course.course_id,
      title: course.course_title,
      browse_total: r.browseTotal,
      browse_viewed: r.browseViewed,
      best_score: r.bestScore,
      attempts: r.attempts,
      last_score: r.lastWeighted,
      last_attempt_at: r.lastAt,
      weighted: r.weighted,
      total_score: r.courseTotalScore,
      pass_score: r.coursePassScore,
      passed: r.coursePassed,
      mandatory_complete: r.mandatory_complete,
      mandatory_browse_complete: r.mandatory_browse_complete,
      mandatory_exam_complete: r.mandatory_exam_complete,
      mandatory_exam_missing: r.mandatory_exam_missing,
      mandatory_exam_total: r.mandatory_exam_total,
    });
  }

  const programPassScore = ctx.program.program_pass_score || 60;
  // 程式級及格 = 所有必修課都「做完 + 過分」
  const programPassed = allRequiredPassed
    && (programMax > 0 ? (programTotal / programMax * 100) >= programPassScore : false);
  const examStarted = programAttempts > 0;
  const status = (anyBrowseViewed === 0 && !examStarted)
    ? 'not_started'
    : (programPassed ? 'passed' : 'in_progress');

  return {
    program_total: programTotal,
    program_max: programMax,
    program_passed: programPassed,
    program_pass_score: programPassScore,
    last_score: programLastTotal,
    last_score_max: programLastMax,
    last_attempt_at: programLastAt,
    total_attempts: programAttempts,
    exam_started: examStarted,
    browse_total: browseTotal,
    browse_viewed: anyBrowseViewed,
    browse_pct: browseTotal > 0 ? Math.round(anyBrowseViewed / browseTotal * 100) : 0,
    status,
    courses: courseDetails,
    // 必修完成度 rollup(前端 row hint 用)
    mandatory_complete: allRequiredMandatoryComplete,
    mandatory_exam_total: programMandatoryExamTotal,
    mandatory_exam_missing: programMandatoryExamMissing,
  };
}

/**
 * 細節版:給學員端 my-scores 用,回傳每個 lesson 的進度 + 權重 + browse_score
 * 與 computeUserCourseScore 的算法 100% 一致,差別在於回傳 lessonProgress[]
 */
function buildLessonBreakdown({
  userId,
  course,
  lessonsByCourse,
  totalSlideByLesson,
  hasInteractiveByLesson,
  browseViewByUserLesson,
}) {
  const examConfig = course.exam_config || {};
  const lessonWeights = examConfig.lesson_weights || {};
  const lessonMandatoryOverride = examConfig.lesson_mandatory || {};
  const onlyCountMandatory = !!examConfig.only_count_mandatory;

  let lessons = lessonsByCourse.get(course.course_id) || [];
  if (course.lesson_ids && course.lesson_ids.length > 0) {
    const allow = new Set(course.lesson_ids.map(Number));
    lessons = lessons.filter(l => allow.has(Number(l.id)));
  }

  const lessonProgress = [];
  let browseOnlyScore = 0;
  let totalSlides = 0;
  let viewedSlides = 0;

  for (const l of lessons) {
    const total = totalSlideByLesson.get(Number(l.id)) || 0;
    const viewedRaw = browseViewByUserLesson.get(`${userId}|${l.id}`) || 0;
    const viewed = Math.min(viewedRaw, total);
    totalSlides += total;
    viewedSlides += viewed;

    const hasInteractive = hasInteractiveByLesson.get(Number(l.id)) || false;
    const ov = lessonMandatoryOverride[`lesson_${l.id}`];
    const mandatory = (ov === 0 || ov === 1) ? ov === 1 : ((l.is_mandatory ?? 1) === 1);

    const lwKey = `lesson_${l.id}`;
    const baseWeight = lessonWeights[lwKey] != null
      ? Number(lessonWeights[lwKey])
      : (l.score_weight ?? 0);
    const effectiveWeight = (onlyCountMandatory && !mandatory) ? 0 : baseWeight;

    let lessonBrowseScore = 0;
    if (!hasInteractive && effectiveWeight > 0 && total > 0) {
      lessonBrowseScore = Math.round((viewed / total) * effectiveWeight);
      browseOnlyScore += lessonBrowseScore;
    }

    lessonProgress.push({
      lesson_id: l.id,
      title: l.title,
      total,
      viewed,
      has_interactive: hasInteractive,
      browse_score: lessonBrowseScore,
      lesson_weight: effectiveWeight,
      base_weight: baseWeight,
      is_mandatory: mandatory ? 1 : 0,
      not_counted: onlyCountMandatory && !mandatory,
    });
  }

  return { lessonProgress, browseOnlyScore, totalSlides, viewedSlides, onlyCountMandatory };
}

module.exports = {
  loadProgramScoringCtx,
  loadUsersInteractionData,
  computeUserCourseScore,
  computeUserProgramScore,
  buildLessonBreakdown,
  _internal: { chunk, safeJsonParse },
};
