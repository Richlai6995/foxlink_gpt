// READ-ONLY diagnostic script — inspects slide_translations / course_slides state
// Usage: node scripts/diag-translation-state.js [courseId]
require('dotenv').config();
const { db, initDb } = require('../database-oracle');

async function main() {
  const courseId = Number(process.argv[2] || 0);

  await initDb();

  console.log('\n═══ 1. slide_translations 統計(by lang)═══');
  const langStats = await db.prepare(`
    SELECT st.lang,
           COUNT(*) AS total_rows,
           SUM(CASE WHEN st.content_json IS NOT NULL THEN 1 ELSE 0 END) AS with_content,
           SUM(CASE WHEN st.notes IS NOT NULL THEN 1 ELSE 0 END) AS with_notes,
           SUM(CASE WHEN st.regions_json IS NOT NULL THEN 1 ELSE 0 END) AS with_regions,
           SUM(CASE WHEN st.audio_url IS NOT NULL THEN 1 ELSE 0 END) AS with_audio_url
    FROM slide_translations st
    ${courseId ? 'INNER JOIN course_slides cs ON cs.id=st.slide_id INNER JOIN course_lessons cl ON cl.id=cs.lesson_id WHERE cl.course_id=?' : ''}
    GROUP BY st.lang
    ORDER BY st.lang
  `).all(...(courseId ? [courseId] : []));
  console.table(langStats);

  console.log('\n═══ 2. course_slides content 統計 ═══');
  const csStats = await db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN content_json IS NOT NULL THEN 1 ELSE 0 END) AS with_content,
           SUM(CASE WHEN notes IS NOT NULL THEN 1 ELSE 0 END) AS with_notes
    FROM course_slides cs
    ${courseId ? 'INNER JOIN course_lessons cl ON cl.id=cs.lesson_id WHERE cl.course_id=?' : ''}
  `).get(...(courseId ? [courseId] : []));
  console.log(csStats);

  if (courseId) {
    console.log('\n═══ 3. 該課程 slide_translations 前 5 筆 sample(每個 lang 各 1 張)═══');
    const langs = ['zh-TW', 'en', 'vi'];
    for (const lang of langs) {
      const sample = await db.prepare(`
        SELECT st.id, st.slide_id, st.lang,
               DBMS_LOB.getlength(st.content_json) AS content_len,
               DBMS_LOB.getlength(st.notes) AS notes_len,
               DBMS_LOB.getlength(st.regions_json) AS regions_len,
               st.audio_url,
               TO_CHAR(st.translated_at,'YYYY-MM-DD HH24:MI:SS') AS translated_at,
               st.is_auto
        FROM slide_translations st
        INNER JOIN course_slides cs ON cs.id=st.slide_id
        INNER JOIN course_lessons cl ON cl.id=cs.lesson_id
        WHERE cl.course_id=? AND st.lang=?
        ORDER BY st.slide_id
        FETCH FIRST 5 ROWS ONLY
      `).all(courseId, lang);
      console.log(`\n--- lang=${lang} (${sample.length} rows) ---`);
      console.table(sample);
    }

    console.log('\n═══ 4. course_slides 前 5 筆(該課程)═══');
    const csSample = await db.prepare(`
      SELECT cs.id, cs.lesson_id, cs.sort_order, cs.slide_type,
             DBMS_LOB.getlength(cs.content_json) AS content_len,
             DBMS_LOB.getlength(cs.notes) AS notes_len,
             TO_CHAR(cs.updated_at,'YYYY-MM-DD HH24:MI:SS') AS updated_at
      FROM course_slides cs
      INNER JOIN course_lessons cl ON cl.id=cs.lesson_id
      WHERE cl.course_id=?
      ORDER BY cs.id
      FETCH FIRST 5 ROWS ONLY
    `).all(courseId);
    console.table(csSample);

    console.log('\n═══ 5. 最近 2 小時內 translated_at 異動的 slide_translations 行數 ═══');
    const recent = await db.prepare(`
      SELECT st.lang, COUNT(*) AS modified_count
      FROM slide_translations st
      INNER JOIN course_slides cs ON cs.id=st.slide_id
      INNER JOIN course_lessons cl ON cl.id=cs.lesson_id
      WHERE cl.course_id=?
        AND st.translated_at >= SYSTIMESTAMP - INTERVAL '2' HOUR
      GROUP BY st.lang
    `).all(courseId);
    console.table(recent);
  }

  console.log('\n═══ 6. Oracle UNDO retention 設定(決定 flashback 可用時間窗)═══');
  try {
    const undo = await db.prepare(`SELECT name, value FROM v$parameter WHERE name IN ('undo_retention','undo_tablespace')`).all();
    console.table(undo);
    const tuned = await db.prepare(`SELECT MAX(tuned_undoretention) AS max_tuned_secs FROM v$undostat WHERE begin_time > SYSDATE - 1/24`).get();
    console.log('最近 1 小時實際保留時長:', tuned);
  } catch (e) { console.warn('查不到 v$parameter(權限不足):', e.message); }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
